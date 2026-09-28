/**
 * Mastering: 5-band parametric EQ and master compressor.
 *
 *   input → [HPF → low shelf → mid bell → high shelf → LPF] →
 *           [compressor → makeup gain] → analyser → output
 *
 * It sits between the master FX chain and the engine's analyser. Master FX
 * asks for `getIoNodes()` and wires the stage in; when this module is bypassed
 * or absent, the signal goes straight through.
 *
 * A stage that is switched off is removed from the graph rather than set to a
 * neutral value: an EQ band at 0 dB still costs a biquad, and a compressor at
 * 1:1 still delays the signal.
 *
 * The spectrum display reads `getSpectrumData()`: no drawing happens here.
 */

import { bus as sharedBus } from '../core/event-bus.js';
import { DEFAULT_COMPRESSOR, DEFAULT_EQ_BANDS, MASTERING_PRESETS } from './mastering-presets.js';

export const MASTERING_EVENTS = Object.freeze({
    changed: 'mastering:changed',
    bypassChanged: 'mastering:bypass'
});

/** Bands whose gain control does nothing. */
const GAINLESS_BAND_TYPES = new Set(['highpass', 'lowpass']);

export class MasteringEngine {
    /**
     * @param {import('./audio-engine.js').AudioEngine} audioEngine
     * @param {object} [options]
     * @param {import('../core/event-bus.js').EventBus} [options.bus]
     */
    constructor(audioEngine, { bus = sharedBus } = {}) {
        this.audioEngine = audioEngine;
        this._bus = bus;
        this._nodes = null;

        this.bypassed = false;
        this.eq = { enabled: true, bands: structuredClone(DEFAULT_EQ_BANDS) };
        this.compressor = { ...DEFAULT_COMPRESSOR };

        /** Called when the bypass state changes. FX automation listens to it. */
        this.onBypassChange = null;

        this._spectrumData = null;
        this._timeDomainData = null;
    }

    // ── Graph contract with MasterFx ─────────────────────────────────────

    /**
     * The nodes the master chain wires around this stage.
     * @returns {{input: AudioNode, output: AudioNode}|null}
     */
    getIoNodes() {
        this._ensureNodes();
        return this._nodes ? { input: this._nodes.input, output: this._nodes.output } : null;
    }

    setBypass(bypassed) {
        const changed = this.bypassed !== Boolean(bypassed);
        this.bypassed = Boolean(bypassed);
        if (changed) this._rerouteMasterChain();

        if (this.onBypassChange) this.onBypassChange(this.bypassed);
        this._bus.emit(MASTERING_EVENTS.bypassChanged, this.bypassed);
    }

    // ── EQ ───────────────────────────────────────────────────────────────

    /**
     * @param {number} index 0..4
     * @param {'freq'|'gain'|'q'|'type'} param
     * @param {number|string} value
     */
    setEqBand(index, param, value) {
        const band = this.eq.bands[index];
        if (!band || !(param in band)) return;
        band[param] = value;

        const node = this._nodes?.eqBands[index];
        if (node) {
            if (param === 'freq') node.frequency.value = value;
            else if (param === 'gain') node.gain.value = value;
            else if (param === 'q') node.Q.value = value;
            else if (param === 'type') node.type = value;
        }
        this._announce();
    }

    setEqEnabled(enabled) {
        this.eq.enabled = Boolean(enabled);
        this._rebuildChain();
        this._rerouteMasterChain();
        this._announce();
    }

    // ── Compressor ───────────────────────────────────────────────────────

    /**
     * @param {'enabled'|'threshold'|'ratio'|'attack'|'release'|'makeupGain'} key
     * @param {number|boolean} value
     */
    setCompParam(key, value) {
        if (!(key in this.compressor)) return;
        this.compressor[key] = value;

        const n = this._nodes;
        if (n) {
            const on = this.compressor.enabled;
            if (key === 'threshold' && on) n.compressor.threshold.value = value;
            else if (key === 'ratio' && on) n.compressor.ratio.value = value;
            else if (key === 'attack') n.compressor.attack.value = value;
            else if (key === 'release') n.compressor.release.value = value;
            else if (key === 'makeupGain') n.makeupGain.gain.value = on ? dbToGain(value) : 1;
            else if (key === 'enabled') {
                this._applyCompressorState();
                this._rebuildChain();
                this._rerouteMasterChain();
            }
        }
        this._announce();
    }

    /** Current gain reduction in dB, for a meter. Zero when not compressing. */
    getCompressorReduction() {
        return this._nodes?.compressor?.reduction ?? 0;
    }

    // ── Analysis, for the spectrum display ───────────────────────────────

    /** @returns {Uint8Array|null} frequency bins, refreshed in place */
    getSpectrumData() {
        const n = this._nodes;
        if (!n || !this._spectrumData) return null;
        n.analyser.getByteFrequencyData(this._spectrumData);
        return this._spectrumData;
    }

    /** @returns {Uint8Array|null} waveform samples, refreshed in place */
    getTimeDomainData() {
        const n = this._nodes;
        if (!n || !this._timeDomainData) return null;
        n.analyser.getByteTimeDomainData(this._timeDomainData);
        return this._timeDomainData;
    }

    /**
     * Each band's response over a set of frequencies, in decibels.
     *
     * The curve drawn on the display is the sum of these; they are handed
     * back one by one so each band can be shaded in its own colour. The
     * filters answer this themselves, so what is drawn is what is heard
     * rather than an idea of it.
     *
     * @param {Float32Array} frequencies in hertz, ascending
     * @returns {Float32Array[]} one array of decibels per band
     */
    getBandResponses(frequencies) {
        const bands = this._nodes?.eqBands;
        if (!bands) return [];

        const magnitude = new Float32Array(frequencies.length);
        const phase = new Float32Array(frequencies.length);

        return bands.map((band) => {
            band.getFrequencyResponse(frequencies, magnitude, phase);

            const decibels = new Float32Array(frequencies.length);
            for (let i = 0; i < decibels.length; i++) {
                decibels[i] = 20 * Math.log10(Math.max(0.0001, magnitude[i]));
            }
            return decibels;
        });
    }

    // ── Presets and persistence ──────────────────────────────────────────

    /** @returns {Record<string, object>} the factory presets */
    static getMasteringPresets() {
        return MASTERING_PRESETS;
    }

    /** @param {string} key a key of the factory presets */
    applyPreset(key) {
        const preset = MASTERING_PRESETS[key];
        if (!preset) return false;
        this.deserialize(preset);
        return true;
    }

    resetToDefaults() {
        this.eq = { enabled: true, bands: structuredClone(DEFAULT_EQ_BANDS) };
        this.compressor = { ...DEFAULT_COMPRESSOR };
        this.applyAllToAudio();
        this._announce();
    }

    serialize() {
        return {
            eq: structuredClone(this.eq),
            compressor: { ...this.compressor },
            bypassed: this.bypassed
        };
    }

    /**
     * Replaces the whole state: what the data leaves out is the default, not
     * whatever the previous project had. The bypass is only taken when the
     * data says (a project does, a factory preset does not touch it).
     */
    deserialize(data) {
        if (!data) {
            this.resetToDefaults();
            return;
        }
        if (typeof data.bypassed === 'boolean') this.setBypass(data.bypassed);
        this.eq = data.eq ? structuredClone(data.eq) : { enabled: true, bands: structuredClone(DEFAULT_EQ_BANDS) };
        this.compressor = { ...DEFAULT_COMPRESSOR, ...data.compressor };

        this.applyAllToAudio();
        this._announce();
    }

    /** Push the whole state onto the audio graph. */
    applyAllToAudio() {
        this._ensureNodes();
        const n = this._nodes;
        if (!n) return;

        this.eq.bands.forEach((band, index) => {
            const node = n.eqBands[index];
            if (!node) return;
            node.type = band.type;
            node.frequency.value = band.freq;
            node.Q.value = band.q;
            if (!GAINLESS_BAND_TYPES.has(band.type)) node.gain.value = band.gain;
        });

        this._applyCompressorState();
        n.compressor.attack.value = this.compressor.attack;
        n.compressor.release.value = this.compressor.release;

        this._rebuildChain();
        this._rerouteMasterChain();
    }

    // ── Audio graph ──────────────────────────────────────────────────────

    _ensureNodes() {
        if (this._nodes) return;
        const ctx = this.audioEngine?.audioContext;
        if (!ctx) return;

        const n = {
            input: ctx.createGain(),
            output: ctx.createGain()
        };

        n.eqBands = this.eq.bands.map((band) => {
            const filter = ctx.createBiquadFilter();
            filter.type = band.type;
            filter.frequency.value = band.freq;
            filter.Q.value = band.q;
            if (!GAINLESS_BAND_TYPES.has(band.type)) filter.gain.value = band.gain;
            return filter;
        });

        n.compressor = ctx.createDynamicsCompressor();
        n.compressor.knee.value = 6;
        n.compressor.attack.value = this.compressor.attack;
        n.compressor.release.value = this.compressor.release;

        n.makeupGain = ctx.createGain();

        // A finer FFT than the engine's: this one feeds the spectrum display.
        n.analyser = ctx.createAnalyser();
        n.analyser.fftSize = 4096;
        n.analyser.smoothingTimeConstant = 0.8;

        this._nodes = n;
        this._spectrumData = new Uint8Array(n.analyser.frequencyBinCount);
        this._timeDomainData = new Uint8Array(n.analyser.fftSize);
        this._timeDomainData.fill(128); // byte encoding of silence

        this._applyCompressorState();
        this._rebuildChain();
    }

    _rebuildChain() {
        const n = this._nodes;
        if (!n) return;

        safeDisconnect(n.input);
        for (const band of n.eqBands) safeDisconnect(band);
        safeDisconnect(n.compressor);
        safeDisconnect(n.makeupGain);
        safeDisconnect(n.analyser);

        let current = n.input;

        if (this.eq.enabled) {
            for (const band of n.eqBands) {
                current.connect(band);
                current = band;
            }
        }

        if (this.compressor.enabled) {
            current.connect(n.compressor);
            n.compressor.connect(n.makeupGain);
            current = n.makeupGain;
        }

        current.connect(n.analyser);
        n.analyser.connect(n.output);
    }

    /**
     * A disabled compressor is left neutral as well as unwired, so that a
     * stale node can never colour the signal if the graph is rebuilt.
     */
    _applyCompressorState() {
        const n = this._nodes;
        if (!n) return;

        if (this.compressor.enabled) {
            n.compressor.threshold.value = this.compressor.threshold;
            n.compressor.ratio.value = this.compressor.ratio;
            n.makeupGain.gain.value = dbToGain(this.compressor.makeupGain);
        } else {
            n.compressor.threshold.value = 0;
            n.compressor.ratio.value = 1;
            n.makeupGain.gain.value = 1;
        }
    }

    /** Ask the master chain to rewire, since our position in it changed. */
    _rerouteMasterChain() {
        this.audioEngine?.masterFx?.rebuildChain?.();
    }

    _announce() {
        this._bus.emit(MASTERING_EVENTS.changed, this.serialize());
    }
}

function dbToGain(db) {
    return Math.pow(10, db / 20);
}

function safeDisconnect(node) {
    try {
        node.disconnect();
    } catch {
        // already disconnected
    }
}
