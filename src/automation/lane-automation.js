/**
 * Automation lanes.
 *
 * A lane is a list of breakpoints: `{ step, value }`, where the step is
 * absolute across the whole arrangement (measure × pattern length + step) and
 * the value is 0..1. Between two points the value is interpolated; before the
 * first and after the last it holds. On every step the sequencer plays, each
 * lane says what its parameter should be, and this module writes it.
 *
 * Values are normalised so that a lane is a shape, not a list of hertz: the
 * same envelope reads the same whether it drives a filter across four octaves
 * or a fader from silence to full. A parameter table holds that conversion,
 * and how to read and write each parameter, in one place: the modules being
 * automated keep their own units and know nothing about this one.
 *
 * Recording captures the parameters that are armed, once per step, from
 * wherever they happen to be. Nothing is recorded for a lane that is not
 * armed, and an armed lane is not played back while it is being recorded:
 * you would be fighting your own envelope.
 *
 * Automation only runs with the arrangement: it is written against the song,
 * and a single pattern on repeat has no place to put it. What the parameters
 * were before the song started is kept, and put back when it stops.
 *
 * This is the part the master effects and the mixer share. What differs is
 * the table of parameters and which of them are worth showing, so those are
 * what a subclass supplies.
 */

import { bus as sharedBus } from '../core/event-bus.js';
import { SEQUENCER_EVENTS } from '../sequencer/sequencer.js';

/** The smallest value a logarithmic parameter is mapped from. */
const LOG_FLOOR = 0.001;

export class LaneAutomation {
    /**
     * @param {object} options
     * @param {Record<string, object>} options.params  the parameter table
     * @param {{changed: string, applied: string, recording: string}} options.events
     * @param {() => object} options.targets  what `read` and `write` are given
     * @param {import('../sequencer/arrangement.js').Arrangement} options.arrangement
     * @param {import('../sequencer/sequencer.js').Sequencer} options.sequencer
     * @param {import('../core/event-bus.js').EventBus} [options.bus]
     */
    constructor({ params, events, targets, arrangement, sequencer, bus = sharedBus }) {
        this.params = params;
        this.events = events;
        this._targets = targets;
        this.arrangement = arrangement;
        this.sequencer = sequencer;
        this._bus = bus;

        /** @type {Record<string, Array<{step: number, value: number}>>} */
        this.lanes = {};

        this.isRecording = false;
        /** @type {Set<string>} lanes that recording writes to */
        this.armedParams = new Set();

        /** The step last played, for the panel's playhead. */
        this.currentStep = 0;

        /** What the automated parameters were before the song started. */
        this._snapshot = null;

        this._unsubscribe = [
            bus.on(SEQUENCER_EVENTS.step, ({ step, chainIndex }) => {
                if (!this.arrangement.enabled) return;
                this.onStep(chainIndex * this.sequencer.steps + step);
            }),
            bus.on(SEQUENCER_EVENTS.play, () => {
                if (this.arrangement.enabled) this.takeSnapshot();
            }),
            bus.on(SEQUENCER_EVENTS.stop, () => {
                if (this.isRecording) this.stopRecording();
                this.restoreSnapshot();
            })
        ];
    }

    dispose() {
        for (const off of this._unsubscribe) off?.();
        this._unsubscribe = [];
    }

    // ── What a lane reaches ──────────────────────────────────────────────

    /** @param {string} key */
    readParam(key) {
        return this.params[key]?.read(this._targets()) ?? 0;
    }

    /** @param {string} key */
    writeParam(key, value) {
        this.params[key]?.write(this._targets(), value);
    }

    // ── Normalising ──────────────────────────────────────────────────────

    /** A parameter's value as 0..1. */
    normalize(key, value) {
        const def = this.params[key];
        if (!def) return 0;

        if (def.log) {
            const low = Math.log(Math.max(def.min, LOG_FLOOR));
            const high = Math.log(def.max);
            return (Math.log(Math.max(value, LOG_FLOOR)) - low) / (high - low);
        }
        return (value - def.min) / (def.max - def.min);
    }

    /** A 0..1 lane value as the parameter's own unit. */
    denormalize(key, normal) {
        const def = this.params[key];
        if (!def) return 0;

        const clamped = Math.min(1, Math.max(0, normal));
        if (def.log) {
            const low = Math.log(Math.max(def.min, LOG_FLOOR));
            const high = Math.log(def.max);
            return Math.exp(low + clamped * (high - low));
        }
        return def.min + clamped * (def.max - def.min);
    }

    // ── Lanes ────────────────────────────────────────────────────────────

    /** @returns {Array<{step: number, value: number}>} */
    getLane(param) {
        return this.lanes[param] ?? [];
    }

    hasLane(param) {
        return this.getLane(param).length > 0;
    }

    /** @returns {number} the new point's index */
    addPoint(param, step, value) {
        const lane = (this.lanes[param] ??= []);
        const clamped = Math.min(1, Math.max(0, value));

        // One point per step: a second click on the same step moves the first
        // rather than hiding it underneath.
        const existing = lane.findIndex((point) => Math.abs(point.step - step) < 1);
        if (existing >= 0) lane[existing].value = clamped;
        else {
            lane.push({ step, value: clamped });
            lane.sort(byStep);
        }

        this._announce();
        return lane.findIndex((point) => Math.abs(point.step - step) < 1);
    }

    removePoint(param, index) {
        this.lanes[param]?.splice(index, 1);
        this._announce();
    }

    /** @returns {number} the point's index after the lane is sorted again */
    movePoint(param, index, step, value) {
        const point = this.lanes[param]?.[index];
        if (!point) return index;

        point.step = step;
        point.value = Math.min(1, Math.max(0, value));
        this.lanes[param].sort(byStep);

        this._announce();
        return this.lanes[param].indexOf(point);
    }

    /**
     * The lane's value at a step, interpolated.
     * @returns {number|null} null when the lane holds nothing
     */
    getValueAt(param, step) {
        const lane = this.lanes[param];
        if (!lane?.length) return null;

        if (step <= lane[0].step) return lane[0].value;

        const last = lane[lane.length - 1];
        if (step >= last.step) return last.value;

        // The lane is sorted, so the two points around the step are found by
        // halving rather than walking: a long lane is played every step.
        let low = 0;
        let high = lane.length - 1;
        while (low < high - 1) {
            const middle = (low + high) >> 1;
            if (lane[middle].step <= step) low = middle;
            else high = middle;
        }

        const from = lane[low];
        const to = lane[high];
        const travelled = (step - from.step) / (to.step - from.step);
        return from.value + travelled * (to.value - from.value);
    }

    clearLane(param) {
        this.lanes[param] = [];
        this.writeParam(param, this.params[param]?.default ?? 0);
        this._announce();
    }

    clearAll() {
        for (const param of Object.keys(this.lanes)) {
            if (this.hasLane(param)) this.writeParam(param, this.params[param].default);
        }
        this.lanes = {};
        this._announce();
    }

    // ── Which lanes are worth showing ────────────────────────────────────

    /**
     * Whether a group's lanes are worth a row at all. Everything is, unless a
     * subclass says otherwise.
     */
    // eslint-disable-next-line no-unused-vars
    isGroupActive(group) {
        return true;
    }

    /**
     * The groups a panel offers to filter by, in order.
     * @returns {Array<{value: string, label: string}>}
     */
    getGroups() {
        const seen = new Map();
        for (const def of Object.values(this.params)) {
            if (!seen.has(def.group)) seen.set(def.group, def.group);
        }
        return [...seen.keys()].map((group) => ({ value: group, label: group }));
    }

    /** @returns {string[]} the parameters of the groups now live */
    getActiveParams() {
        return Object.keys(this.params).filter((key) => this.isGroupActive(this.params[key].group));
    }

    // ── Playback ─────────────────────────────────────────────────────────

    /** How many steps the whole arrangement lasts. */
    getTotalSteps() {
        return Math.max(this.arrangement.getChain().length, 1) * this.sequencer.steps;
    }

    /**
     * Apply every lane at this step, and record the armed ones.
     *
     * A lane whose group is hidden still plays: hiding is a way of looking at
     * the lanes, not a way of switching them off.
     */
    onStep(absoluteStep) {
        this.currentStep = absoluteStep;

        if (this.isRecording) this._record(absoluteStep);

        let applied = false;
        for (const param of Object.keys(this.lanes)) {
            if (!this.hasLane(param)) continue;
            // A lane being recorded is being written, not read.
            if (this.isRecording && this.armedParams.has(param)) continue;

            const value = this.getValueAt(param, absoluteStep);
            if (value === null) continue;

            this.writeParam(param, this.denormalize(param, value));
            applied = true;
        }

        this._bus.emit(this.events.applied, { step: absoluteStep, applied });
    }

    // ── Recording ────────────────────────────────────────────────────────

    startRecording() {
        this.isRecording = true;
        this._bus.emit(this.events.recording, true);
    }

    stopRecording() {
        this.isRecording = false;
        // Disarming on stop means the next take is a deliberate choice, not
        // whatever was left armed from the last one.
        this.armedParams.clear();
        this._bus.emit(this.events.recording, false);
        this._announce();
    }

    toggleRecording() {
        if (this.isRecording) this.stopRecording();
        else this.startRecording();
        return this.isRecording;
    }

    /** @param {string} key */
    toggleArm(key) {
        if (this.armedParams.has(key)) this.armedParams.delete(key);
        else this.armedParams.add(key);
        return this.armedParams.has(key);
    }

    isArmed(key) {
        return this.armedParams.has(key);
    }

    _record(absoluteStep) {
        for (const param of this.armedParams) {
            this.addPoint(param, absoluteStep, this.normalize(param, this.readParam(param)));
        }
    }

    // ── Before and after the song ────────────────────────────────────────

    /** Remember what the automated parameters were set to by hand. */
    takeSnapshot() {
        this._snapshot = {};
        for (const param of Object.keys(this.params)) {
            if (this.hasLane(param)) this._snapshot[param] = this.readParam(param);
        }
    }

    /**
     * Put those values back. Without a snapshot: a song that was already
     * playing when this module arrived: each lane's default is the next best
     * answer, since leaving a parameter wherever the last step left it is the
     * one thing that is certainly wrong.
     */
    restoreSnapshot() {
        if (this._snapshot) {
            for (const [param, value] of Object.entries(this._snapshot)) {
                this.writeParam(param, value);
            }
            this._snapshot = null;
        } else {
            for (const param of Object.keys(this.lanes)) {
                if (this.hasLane(param)) this.writeParam(param, this.params[param].default);
            }
        }

        this._bus.emit(this.events.applied, { step: this.currentStep, applied: true });
    }

    // ── Persistence ──────────────────────────────────────────────────────

    serialize() {
        const lanes = {};
        for (const [param, points] of Object.entries(this.lanes)) {
            if (!points.length) continue;
            // Short keys and three decimals: a lane is dozens of points, and
            // a thousandth of a normalised value is inaudible.
            lanes[param] = points.map((point) => ({
                s: point.step,
                v: Math.round(point.value * 1000) / 1000
            }));
        }
        return { lanes };
    }

    deserialize(data) {
        this.lanes = {};

        for (const [param, points] of Object.entries(data?.lanes ?? {})) {
            if (!this.params[param]) continue;
            this.lanes[param] = points
                .map((point) => ({ step: point.s, value: point.v }))
                .sort(byStep);
        }

        this._announce();
    }

    _announce() {
        this._bus.emit(this.events.changed, { params: Object.keys(this.lanes) });
    }
}

function byStep(a, b) {
    return a.step - b.step;
}
