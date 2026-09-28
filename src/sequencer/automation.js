/**
 * Automation: record parameter moves against the step grid.
 *
 * Used by the XY pad: arm a track, move the pad while the sequencer runs, and
 * each move is stored against the step it happened on. On playback the stored
 * value is applied when that step comes round again.
 *
 * Values are stored per track, per parameter, per step:
 *
 *   automationData[track][param][step] = value
 *
 * Only the envelope and track parameters reach the audio engine. The others
 * are recorded because they belong to the project and are read back by the
 * export pipeline, but there is no live parameter to write them to.
 */

import { bus as sharedBus } from '../core/event-bus.js';
import { SEQUENCER_EVENTS } from './sequencer.js';

const TRACK_COUNT = 8;

/** Parameters the engine can apply live, and the method that does it. */
const ENVELOPE_PARAMS = new Set(['attack', 'decay', 'sustain', 'release']);
const TRACK_PARAMS = new Set(['volume', 'detune', 'pitchEnv', 'glide']);

/** Every parameter a lane can hold, applied or not. */
export const AUTOMATION_PARAMS = [
    'filterFreq',
    'filterRes',
    'lfoRate',
    'lfoAmount',
    'attack',
    'decay',
    'sustain',
    'release',
    'volume',
    'detune',
    'pitchEnv',
    'glide',
    'filterCutoff',
    'delayMix',
    'delayFeedback',
    'reverbMix',
    'distortion',
    'chorusMix',
    'crushBits'
];

export class Automation {
    /**
     * @param {import('./sequencer.js').Sequencer} sequencer
     * @param {object} [options]
     * @param {import('../core/event-bus.js').EventBus} [options.bus]
     */
    constructor(sequencer, { bus = sharedBus } = {}) {
        this.sequencer = sequencer;
        this._bus = bus;

        this.isRecording = false;
        this.isPlaying = false;
        this.currentRecordingTrack = null;

        this.automationData = emptyAutomationData();
        this.recordedMoves = [];

        this._unsubscribe = bus.on(SEQUENCER_EVENTS.step, ({ step }) => this.onStep(step));
    }

    /** Detach from the bus. */
    dispose() {
        this._unsubscribe?.();
        this._unsubscribe = null;
    }

    // ── Recording ────────────────────────────────────────────────────────

    startRecording(track) {
        this.isRecording = true;
        this.currentRecordingTrack = track;
        this.recordedMoves = [];
    }

    stopRecording() {
        this.isRecording = false;
        this.applyRecordedMoves();
    }

    /**
     * Record one move. Ignored unless that track is the one being recorded.
     * @param {number} [step] defaults to the step playing right now
     */
    recordMove(track, param, value, step) {
        if (!this.isRecording || track !== this.currentRecordingTrack) return false;

        this.recordedMoves.push({
            track,
            param,
            value,
            step: step ?? this.sequencer.currentStep
        });
        return true;
    }

    /** Commit the buffered moves into the lanes. */
    applyRecordedMoves() {
        for (const move of this.recordedMoves) {
            const track = (this.automationData[move.track] ??= {});
            const lane = (track[move.param] ??= {});
            lane[move.step] = move.value;
        }
        this.recordedMoves = [];
    }

    // ── Playback ─────────────────────────────────────────────────────────

    enablePlayback() {
        this.isPlaying = true;
    }

    disablePlayback() {
        this.isPlaying = false;
    }

    togglePlayback() {
        this.isPlaying = !this.isPlaying;
        return this.isPlaying;
    }

    /** Apply whatever was recorded on this step. */
    onStep(step) {
        if (!this.isPlaying) return;

        for (let track = 0; track < TRACK_COUNT; track++) {
            const lanes = this.automationData[track];
            if (!lanes) continue;

            for (const [param, lane] of Object.entries(lanes)) {
                const value = lane[step];
                if (value !== undefined) this.applyAutomation(track, param, value);
            }
        }
    }

    applyAutomation(track, param, value) {
        const engine = this.sequencer.audioEngine;
        if (!engine) return;

        if (ENVELOPE_PARAMS.has(param)) {
            engine.updateEnvelope(track, { [param]: value });
        } else if (TRACK_PARAMS.has(param)) {
            engine.updateTrack(track, { [param]: value });
        }
        // Other parameters belong to the FX lanes, which own their own playback.
    }

    // ── Lanes ────────────────────────────────────────────────────────────

    clearAutomation(track, param) {
        if (this.automationData[track]?.[param]) this.automationData[track][param] = {};
    }

    clearAllAutomation(track) {
        const lanes = this.automationData[track];
        if (!lanes) return;
        for (const param of Object.keys(lanes)) lanes[param] = {};
    }

    hasAutomation(track, param) {
        return Object.keys(this.automationData[track]?.[param] ?? {}).length > 0;
    }

    /** @returns {number[]} the steps holding a value, in order */
    getAutomationSteps(track, param) {
        return Object.keys(this.automationData[track]?.[param] ?? {})
            .map(Number)
            .sort((a, b) => a - b);
    }

    /**
     * Value of a parameter at a step, interpolated between the recorded ones.
     * @returns {number|null} null when the lane is empty
     */
    interpolate(step, param, track) {
        const steps = this.getAutomationSteps(track, param);
        if (steps.length === 0) return null;

        const lane = this.automationData[track][param];
        let before = null;
        let after = null;
        for (const recorded of steps) {
            if (recorded <= step) before = recorded;
            else if (after === null) after = recorded;
        }

        if (before === step || after === null) return lane[before];
        if (before === null) return lane[after];

        const progress = (step - before) / (after - before);
        return lane[before] + (lane[after] - lane[before]) * progress;
    }

    // ── Persistence ──────────────────────────────────────────────────────

    serialize() {
        return {
            isPlaying: this.isPlaying,
            automationData: structuredClone(this.automationData)
        };
    }

    deserialize(data) {
        if (!data) return;

        this.isPlaying = data.isPlaying || false;
        this.automationData = emptyAutomationData();

        for (const [track, lanes] of Object.entries(data.automationData ?? {})) {
            const target = (this.automationData[track] ??= {});
            for (const [param, lane] of Object.entries(lanes ?? {})) {
                target[param] = { ...lane };
            }
        }
    }
}

function emptyAutomationData() {
    const data = {};
    for (let track = 0; track < TRACK_COUNT; track++) {
        data[track] = {};
        for (const param of AUTOMATION_PARAMS) data[track][param] = {};
    }
    return data;
}
