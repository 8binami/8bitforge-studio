/**
 * Master FX: insert effects on the master bus.
 *
 *   masterGain → insertIn → [filter] → insertOut
 *              → chorus → delay → reverb → [mastering] → analyser
 *
 * Each send effect is a dry/wet crossfade rather than a true send, so a mix of
 * 0 leaves the signal untouched and the chain can stay wired at all times.
 *
 * This module holds the state and the graph. Parameters are in natural units:
 * hertz for rates and frequencies, seconds for times, 0..1 for mixes. The
 * panel that drives it converts from whatever its widgets use, and reads the
 * state back when `masterfx:changed` is announced.
 *
 * The wheels (pitch bend, modulation) act on the notes the engine is already
 * playing, which is why they live here and not in the synthesizer.
 */

import { bus as sharedBus } from '../core/event-bus.js';

export const MASTER_FX_EVENTS = Object.freeze({
    changed: 'masterfx:changed'
});

/** Pitch bend range, in cents. ±2 semitones, as on a hardware wheel. */
const PITCH_BEND_CENTS = 200;

/** Modulation wheel fully up, in hertz of vibrato depth. */
const MAX_MODULATION_DEPTH = 15;

/** Regenerating a reverb impulse allocates ~700 KB; don't do it per slider tick. */
const REVERB_REBUILD_DELAY_MS = 100;

const DEFAULT_FILTER = { enabled: false, type: 'lowpass', frequency: 1000, q: 1 };

const DEFAULT_EFFECTS = {
    chorus: { enabled: false, rate: 1, mix: 0.5 },
    delay: { enabled: false, time: 0.25, feedback: 0.3, mix: 0.5 },
    reverb: { enabled: false, decay: 0.5, mix: 0.5 }
};

export class MasterFx {
    /**
     * @param {import('./audio-engine.js').AudioEngine} audioEngine
     * @param {object} [options]
     * @param {import('../core/event-bus.js').EventBus} [options.bus]
     */
    constructor(audioEngine, { bus = sharedBus } = {}) {
        this.audioEngine = audioEngine;
        this._bus = bus;

        this.filter = { ...DEFAULT_FILTER };
        this.effects = structuredClone(DEFAULT_EFFECTS);

        /** When bypassed the master bus goes straight to the analyser. */
        this.bypassed = false;

        this.pitchBend = 0; // -1..+1, springs back to centre
        this.modulation = 0; // 0..1, stays where it is put

        this._nodes = null;
        this._reverbImpulseTimer = null;

        /** Fired when an effect is toggled. FX automation listens to this. */
        this.onEffectToggle = null;
    }

    // ── Filter ───────────────────────────────────────────────────────────

    setFilterEnabled(enabled) {
        this.filter.enabled = Boolean(enabled);
        this._applyFilter();
        this._announce();
    }

    /** @param {'lowpass'|'highpass'|'bandpass'} type */
    setFilterType(type) {
        this.filter.type = type;
        this._applyFilter();
        this._announce();
    }

    setFilterFrequency(hz) {
        this.filter.frequency = clamp(hz, 20, 20000);
        this._applyFilter();
    }

    setFilterQ(q) {
        this.filter.q = clamp(q, 0.1, 30);
        this._applyFilter();
    }

    // ── Send effects ─────────────────────────────────────────────────────

    /**
     * @param {'chorus'|'delay'|'reverb'} fx
     * @param {boolean} enabled
     */
    setEffectEnabled(fx, enabled) {
        const state = this.effects[fx];
        if (!state) return;
        state.enabled = Boolean(enabled);
        this._applyEffect(fx);
        if (this.onEffectToggle) this.onEffectToggle(fx, state.enabled);
        this._announce();
    }

    /**
     * @param {'chorus'|'delay'|'reverb'} fx
     * @param {string} param  rate | mix | time | feedback | decay
     * @param {number} value  natural units: Hz, seconds, or 0..1
     */
    setEffectParam(fx, param, value) {
        const state = this.effects[fx];
        if (!state || !(param in state)) return;

        state[param] = param === 'mix' || param === 'feedback' ? clamp(value, 0, 1) : value;
        this._applyEffect(fx);
    }

    // ── Wheels ───────────────────────────────────────────────────────────

    /** @param {number} value -1..+1 */
    setPitchBend(value) {
        this.pitchBend = clamp(value, -1, 1);
        this._applyPitchBend(this.pitchBend);
    }

    /** @param {number} value 0..1 */
    setModulation(value) {
        this.modulation = clamp(value, 0, 1);
        this._applyModulation(this.modulation);
    }

    // ── Bypass ───────────────────────────────────────────────────────────

    setBypass(bypassed) {
        this.bypassed = Boolean(bypassed);
        this._ensureNodes();
        this._rebuildInsertChain();
        this._announce();
    }

    // ── Persistence ──────────────────────────────────────────────────────

    serialize() {
        return {
            filter: { ...this.filter },
            effects: structuredClone(this.effects),
            pitchBend: this.pitchBend,
            modulation: this.modulation
        };
    }

    deserialize(data) {
        if (!data) return;

        if (data.filter) {
            Object.assign(this.filter, data.filter);
        } else if (data.filters) {
            // 1.x files carried three separate filters; keep the active one.
            const types = ['lowpass', 'highpass', 'bandpass'];
            const active = types.find((type) => data.filters[type]?.enabled) || 'lowpass';
            const source = data.filters[active] || data.filters.lowpass;
            if (source) {
                this.filter.type = active;
                this.filter.enabled = source.enabled || false;
                this.filter.frequency = source.frequency || DEFAULT_FILTER.frequency;
                this.filter.q = source.q || DEFAULT_FILTER.q;
            }
        }

        if (data.effects) {
            for (const [fx, state] of Object.entries(data.effects)) {
                if (this.effects[fx]) Object.assign(this.effects[fx], state);
            }
        }

        if (data.pitchBend !== undefined) this.pitchBend = data.pitchBend;
        if (data.modulation !== undefined) this.modulation = data.modulation;

        this.applyAllToAudio();
        if (this.onEffectToggle) this.onEffectToggle();
        this._announce();
    }

    /** Reset to the state a new project starts from. */
    reset() {
        this.filter = { ...DEFAULT_FILTER };
        this.effects = structuredClone(DEFAULT_EFFECTS);
        this.pitchBend = 0;
        this.modulation = 0;
        this.applyAllToAudio();
        this._announce();
    }

    /**
     * Rewire the insert chain without touching parameters. The mastering
     * stage calls this when it is bypassed or switched in, since that changes
     * where the master bus ends up.
     */
    rebuildChain() {
        this._ensureNodes();
        this._rebuildInsertChain();
    }

    /** Push the whole state onto the audio graph, rebuilding the chain. */
    applyAllToAudio() {
        this._ensureNodes();
        const n = this._nodes;
        if (n) {
            n.filter.type = this.filter.type;
            n.filter.frequency.value = this.filter.frequency;
            n.filter.Q.value = this.filter.q;
            n.chorusLfo.frequency.value = this.effects.chorus.rate;
            n.delay.delayTime.value = this.effects.delay.time;
            n.delayFeedback.gain.value = this.effects.delay.feedback;
            this._createReverbImpulse(n.reverb, this.effects.reverb.decay);
        }
        this._rebuildInsertChain();
        this._applyPitchBend(this.pitchBend);
        this._applyModulation(this.modulation);
    }

    // ── Audio graph ──────────────────────────────────────────────────────

    _ensureNodes() {
        if (this._nodes) return;
        const ctx = this.audioEngine?.audioContext;
        if (!ctx) return;

        const n = {};

        n.filter = ctx.createBiquadFilter();
        n.filter.type = this.filter.type;
        n.filter.frequency.value = this.filter.frequency;
        n.filter.Q.value = this.filter.q;

        n.insertIn = ctx.createGain(); // tapped from masterGain
        n.insertOut = ctx.createGain(); // feeds the send effects

        // Chorus: a short delay whose time is modulated by an LFO
        n.chorusDelay = ctx.createDelay(0.05);
        n.chorusLfo = ctx.createOscillator();
        n.chorusLfoGain = ctx.createGain();
        n.chorusDry = ctx.createGain();
        n.chorusWet = ctx.createGain();
        n.chorusDelay.delayTime.value = 0.005;
        n.chorusLfo.frequency.value = this.effects.chorus.rate;
        n.chorusLfoGain.gain.value = 0.002;
        n.chorusDry.gain.value = 1;
        n.chorusWet.gain.value = 0;
        n.chorusLfo.connect(n.chorusLfoGain);
        n.chorusLfoGain.connect(n.chorusDelay.delayTime);
        n.chorusLfo.start();

        // Delay with feedback
        n.delay = ctx.createDelay(2.0);
        n.delayFeedback = ctx.createGain();
        n.delayDry = ctx.createGain();
        n.delayWet = ctx.createGain();
        n.delay.delayTime.value = this.effects.delay.time;
        n.delayFeedback.gain.value = this.effects.delay.feedback;
        n.delayDry.gain.value = 1;
        n.delayWet.gain.value = 0;
        n.delay.connect(n.delayFeedback);
        n.delayFeedback.connect(n.delay);

        // Reverb
        n.reverb = ctx.createConvolver();
        n.reverbDry = ctx.createGain();
        n.reverbWet = ctx.createGain();
        n.reverbDry.gain.value = 1;
        n.reverbWet.gain.value = 0;
        this._createReverbImpulse(n.reverb, this.effects.reverb.decay);

        // Merge points, kept across rebuilds
        n.chorusMerge = ctx.createGain();
        n.delayMerge = ctx.createGain();
        n.reverbMerge = ctx.createGain();

        this._nodes = n;
        this._rebuildInsertChain();
    }

    _rebuildInsertChain() {
        const n = this._nodes;
        const engine = this.audioEngine;
        if (!n || !engine?.audioContext) return;

        const { masterGain, analyser } = engine;
        if (!masterGain || !analyser) return;

        // Tear the chain down before rewiring it: every node below is
        // reconnected explicitly, so a stale connection would double the signal.
        for (const node of [
            masterGain,
            n.insertIn,
            n.filter,
            n.insertOut,
            n.chorusDry,
            n.chorusWet,
            n.chorusMerge,
            n.delayDry,
            n.delayWet,
            n.delayMerge,
            n.reverbDry,
            n.reverbWet,
            n.reverb,
            n.reverbMerge
        ]) {
            safeDisconnect(node);
        }
        safeDisconnect(n.chorusDelay, n.chorusWet);
        safeDisconnect(n.delay, n.delayWet);

        // The feedback loop is internal to the delay and always stands.
        n.delay.connect(n.delayFeedback);
        n.delayFeedback.connect(n.delay);

        if (this.bypassed) {
            this._connectToAnalyser(masterGain, analyser);
            return;
        }

        masterGain.connect(n.insertIn);

        let current = n.insertIn;
        if (this.filter.enabled) {
            current.connect(n.filter);
            current = n.filter;
        }
        current.connect(n.insertOut);

        // Chorus
        const chorusMix = this.effects.chorus.enabled ? this.effects.chorus.mix : 0;
        n.chorusDry.gain.value = 1 - chorusMix;
        n.chorusWet.gain.value = chorusMix;
        n.insertOut.connect(n.chorusDry);
        n.insertOut.connect(n.chorusDelay);
        n.chorusDelay.connect(n.chorusWet);
        n.chorusDry.connect(n.chorusMerge);
        n.chorusWet.connect(n.chorusMerge);

        // Delay
        const delayMix = this.effects.delay.enabled ? this.effects.delay.mix : 0;
        n.delayDry.gain.value = 1 - delayMix;
        n.delayWet.gain.value = delayMix;
        n.chorusMerge.connect(n.delayDry);
        n.chorusMerge.connect(n.delay);
        n.delay.connect(n.delayWet);
        n.delayDry.connect(n.delayMerge);
        n.delayWet.connect(n.delayMerge);

        // Reverb
        const reverbMix = this.effects.reverb.enabled ? this.effects.reverb.mix : 0;
        n.reverbDry.gain.value = 1 - reverbMix;
        n.reverbWet.gain.value = reverbMix;
        n.delayMerge.connect(n.reverbDry);
        n.delayMerge.connect(n.reverb);
        n.reverb.connect(n.reverbWet);
        n.reverbDry.connect(n.reverbMerge);
        n.reverbWet.connect(n.reverbMerge);

        this._connectToAnalyser(n.reverbMerge, analyser);
    }

    /**
     * Route a source to the analyser, through the mastering stage when one is
     * attached and active. Mastering exposes `getIoNodes()` returning its
     * input and output; anything else is treated as absent.
     */
    _connectToAnalyser(source, analyser) {
        const mastering = this.audioEngine.mastering;
        if (mastering && !mastering.bypassed && typeof mastering.getIoNodes === 'function') {
            const io = mastering.getIoNodes();
            if (io?.input && io?.output) {
                // Only the output is disconnected: the input feeds the EQ and
                // compressor chain inside mastering, which must stay wired.
                safeDisconnect(io.output);
                source.connect(io.input);
                io.output.connect(analyser);
                return;
            }
        }
        source.connect(analyser);
    }

    _createReverbImpulse(convolver, decay) {
        const ctx = this.audioEngine?.audioContext;
        if (!ctx) return;

        const duration = Math.max(0.2, decay * 3);
        const length = Math.floor(ctx.sampleRate * duration);
        const impulse = ctx.createBuffer(2, length, ctx.sampleRate);

        for (let channel = 0; channel < 2; channel++) {
            const data = impulse.getChannelData(channel);
            for (let i = 0; i < length; i++) {
                data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay * 2);
            }
        }
        convolver.buffer = impulse;
    }

    _applyFilter() {
        this._ensureNodes();
        const n = this._nodes;
        if (!n) return;

        n.filter.type = this.filter.type;
        n.filter.frequency.value = this.filter.frequency;
        n.filter.Q.value = this.filter.q;
        this._rebuildInsertChain();
    }

    /** @param {'chorus'|'delay'|'reverb'} fx */
    _applyEffect(fx) {
        this._ensureNodes();
        const n = this._nodes;
        if (!n) return;

        const state = this.effects[fx];
        if (fx === 'chorus') {
            n.chorusLfo.frequency.value = state.rate;
            n.chorusLfoGain.gain.value = 0.001 + (state.rate / 10) * 0.003;
        } else if (fx === 'delay') {
            n.delay.delayTime.value = state.time;
            n.delayFeedback.gain.value = state.feedback;
        } else if (fx === 'reverb') {
            clearTimeout(this._reverbImpulseTimer);
            this._reverbImpulseTimer = setTimeout(() => {
                this._createReverbImpulse(n.reverb, state.decay);
            }, REVERB_REBUILD_DELAY_MS);
        }

        this._rebuildInsertChain();
    }

    /** Pitch bend applies to notes that are already sounding. */
    _applyPitchBend(value) {
        const engine = this.audioEngine;
        if (!engine) return;

        const cents = value * PITCH_BEND_CENTS;
        for (const note of engine.activeNotes.values()) {
            if (note.oscillators) {
                for (const osc of note.oscillators) {
                    if (osc.detune) osc.detune.value = cents;
                }
            } else if (note.osc?.detune) {
                note.osc.detune.value = cents;
            }
        }
    }

    /** The modulation wheel drives vibrato depth on sounding notes. */
    _applyModulation(value) {
        const engine = this.audioEngine;
        if (!engine) return;

        const depth = value * MAX_MODULATION_DEPTH;
        for (const note of engine.activeNotes.values()) {
            if (note.lfoGain) note.lfoGain.gain.value = depth;
            // A note whose vibrato was off has an idle LFO: give it a usable rate.
            if (note.lfo && value > 0 && note.lfo.frequency.value < 0.5) {
                note.lfo.frequency.value = 5;
            }
        }
    }

    _announce() {
        this._bus.emit(MASTER_FX_EVENTS.changed, this.serialize());
    }
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number(value)));
}

/** Disconnecting a node that was never connected throws; that is not an error. */
function safeDisconnect(node, target) {
    try {
        if (target) node.disconnect(target);
        else node.disconnect();
    } catch {
        // already disconnected
    }
}
