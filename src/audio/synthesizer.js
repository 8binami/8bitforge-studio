/**
 * Synthesizer: parameter control over the audio engine's tracks.
 *
 * It holds which track is being edited and writes parameters through to the
 * engine. It does not render anything: when a parameter changes it emits
 * `synth:changed` on the bus, and the interface refreshes itself from the
 * engine state. That is what keeps this module testable in Node.
 */

import { bus as sharedBus } from '../core/event-bus.js';

export const SYNTH_EVENTS = Object.freeze({
    changed: 'synth:changed',
    trackSelected: 'synth:track-selected'
});

export class Synthesizer {
    /**
     * @param {import('./audio-engine.js').AudioEngine} audioEngine
     * @param {object} [options]
     * @param {import('../core/event-bus.js').EventBus} [options.bus]
     * @param {object|null} [options.arpeggiator]  optional, for preset recall
     */
    constructor(audioEngine, { bus = sharedBus, arpeggiator = null } = {}) {
        this.audioEngine = audioEngine;
        this.currentTrack = 0;
        this.arpeggiator = arpeggiator;
        this._bus = bus;
    }

    /** Per-track FX chain, owned by the engine. Null when none is attached. */
    get trackEffects() {
        return this.audioEngine.trackEffects;
    }

    setCurrentTrack(trackIndex) {
        this.currentTrack = trackIndex;
        this._bus.emit(SYNTH_EVENTS.trackSelected, trackIndex);
        this._notifyChanged(trackIndex);
    }

    /** Announce that a track's parameters changed, so views can refresh. */
    _notifyChanged(trackIndex = this.currentTrack) {
        this._bus.emit(SYNTH_EVENTS.changed, trackIndex);
    }

    // Push parameter changes to any currently playing notes on this track
    _liveUpdate() {
        this.audioEngine.updateLiveNotes(this.currentTrack);
    }

    setWaveform(waveform) {
        this.audioEngine.updateTrack(this.currentTrack, { type: waveform });
    }

    setDutyCycle(dutyCycle) {
        this.audioEngine.updateTrack(this.currentTrack, { dutyCycle: parseFloat(dutyCycle) });
    }

    setAttack(attack) {
        this.audioEngine.updateEnvelope(this.currentTrack, { attack: parseFloat(attack) });
    }

    setDecay(decay) {
        this.audioEngine.updateEnvelope(this.currentTrack, { decay: parseFloat(decay) });
    }

    setSustain(sustain) {
        this.audioEngine.updateEnvelope(this.currentTrack, { sustain: parseFloat(sustain) });
    }

    setRelease(release) {
        this.audioEngine.updateEnvelope(this.currentTrack, { release: parseFloat(release) });
    }

    setVibratoRate(rate) {
        this.audioEngine.updateVibrato(this.currentTrack, { rate: parseFloat(rate) });
        this._liveUpdate();
    }

    setVibratoDepth(depth) {
        this.audioEngine.updateVibrato(this.currentTrack, { depth: parseFloat(depth) });
        this._liveUpdate();
    }

    setDetune(detune) {
        this.audioEngine.updateTrack(this.currentTrack, { detune: parseFloat(detune) });
    }

    setVolume(volume) {
        this.audioEngine.updateTrack(this.currentTrack, { volume: parseFloat(volume) });
    }

    setPitchEnv(pitchEnv) {
        this.audioEngine.updateTrack(this.currentTrack, { pitchEnv: parseFloat(pitchEnv) });
    }

    setGlide(glide) {
        this.audioEngine.updateTrack(this.currentTrack, { glide: parseFloat(glide) });
    }

    setFilterCutoff(cutoff) {
        this.audioEngine.updateTrack(this.currentTrack, {
            filterCutoff: parseFloat(cutoff),
            filterEnabled: true
        });
        this._liveUpdate();
    }

    setFilterQ(q) {
        this.audioEngine.updateTrack(this.currentTrack, {
            filterQ: parseFloat(q),
            filterEnabled: true
        });
        this._liveUpdate();
    }

    // Filter LFO (modulates this track's filter cutoff)
    setFilterLfoRate(rate) {
        this.audioEngine.updateTrack(this.currentTrack, { filterLfoRate: parseFloat(rate) });
        this._liveUpdate();
    }

    setFilterLfoDepth(depth) {
        this.audioEngine.updateTrack(this.currentTrack, { filterLfoDepth: parseFloat(depth) });
        this._liveUpdate();
    }

    // LFO → Filter (creates filter + LFO modulation)
    setLfoFilterRate(rate) {
        this.audioEngine.updateTrack(this.currentTrack, { lfoFilterRate: parseFloat(rate) });
        this._liveUpdate();
    }

    setLfoFilterDepth(depth) {
        this.audioEngine.updateTrack(this.currentTrack, { lfoFilterDepth: parseFloat(depth) });
        this._liveUpdate();
    }

    // Tremolo (LFO → volume)
    setTremoloRate(rate) {
        this.audioEngine.updateTrack(this.currentTrack, { tremoloRate: parseFloat(rate) });
        this._liveUpdate();
    }

    setTremoloDepth(depth) {
        this.audioEngine.updateTrack(this.currentTrack, { tremoloDepth: parseFloat(depth) });
        this._liveUpdate();
    }

    // Filter Envelope
    setFilterEnvAmount(amount) {
        this.audioEngine.updateTrack(this.currentTrack, { filterEnvAmount: parseFloat(amount) });
    }

    setFilterEnvAttack(attack) {
        this.audioEngine.updateTrack(this.currentTrack, { filterEnvAttack: parseFloat(attack) });
    }

    setFilterEnvRelease(release) {
        this.audioEngine.updateTrack(this.currentTrack, { filterEnvRelease: parseFloat(release) });
    }

    // ── NEW: OSC parameters ──
    setUnisonVoices(v) {
        this.audioEngine.updateTrack(this.currentTrack, { unisonVoices: parseInt(v) });
    }
    setUnisonDetune(v) {
        this.audioEngine.updateTrack(this.currentTrack, { unisonDetune: parseFloat(v) });
    }
    setUnisonSpread(v) {
        this.audioEngine.updateTrack(this.currentTrack, { unisonSpread: parseFloat(v) });
    }
    setOctaveOffset(v) {
        this.audioEngine.updateTrack(this.currentTrack, { octaveOffset: parseInt(v) });
    }
    setSemitoneOffset(v) {
        this.audioEngine.updateTrack(this.currentTrack, { semitoneOffset: parseInt(v) });
    }
    setPhase(v) {
        this.audioEngine.updateTrack(this.currentTrack, { phase: parseFloat(v) });
    }

    // ── NEW: Filter parameters ──
    setFilterType(v) {
        this.audioEngine.updateTrack(this.currentTrack, { filterType: v });
        this._liveUpdate();
    }
    setFilterKeyTrack(v) {
        this.audioEngine.updateTrack(this.currentTrack, { filterKeyTrack: parseFloat(v) });
    }

    // ── NEW: LFO parameters ──
    setLfo1Wave(v) {
        this.audioEngine.updateTrack(this.currentTrack, { lfo1Wave: v });
    }
    setLfo1Sync(v) {
        this.audioEngine.updateTrack(this.currentTrack, { lfo1Sync: v });
    }
    setLfo1Delay(v) {
        this.audioEngine.updateTrack(this.currentTrack, { lfo1Delay: parseFloat(v) });
    }
    setLfo2Wave(v) {
        this.audioEngine.updateTrack(this.currentTrack, { lfo2Wave: v });
    }
    setLfo2Sync(v) {
        this.audioEngine.updateTrack(this.currentTrack, { lfo2Sync: v });
    }
    setLfo2Delay(v) {
        this.audioEngine.updateTrack(this.currentTrack, { lfo2Delay: parseFloat(v) });
    }
    setLfo3Wave(v) {
        this.audioEngine.updateTrack(this.currentTrack, { lfo3Wave: v });
    }
    setLfo3Sync(v) {
        this.audioEngine.updateTrack(this.currentTrack, { lfo3Sync: v });
    }
    setLfo3Delay(v) {
        this.audioEngine.updateTrack(this.currentTrack, { lfo3Delay: parseFloat(v) });
    }

    // Get complete synth state for saving as user preset
    getFullPresetState(trackIndex = null) {
        const idx = trackIndex !== null ? trackIndex : this.currentTrack;
        const track = this.audioEngine.tracks[idx];
        const envelope = this.audioEngine.envelopes[idx];
        const vib = this.audioEngine.vibrato[idx];

        return {
            type: track.type,
            dutyCycle: track.dutyCycle,
            volume: track.volume,
            detune: track.detune,
            pitchEnv: track.pitchEnv,
            glide: track.glide,
            filterCutoff: track.filterCutoff,
            filterQ: track.filterQ,
            filterEnabled: track.filterEnabled,
            filterType: track.filterType || 'lowpass',
            filterKeyTrack: track.filterKeyTrack || 0,
            filterLfoRate: track.filterLfoRate || 0,
            filterLfoDepth: track.filterLfoDepth || 0,
            lfoFilterRate: track.lfoFilterRate || 0,
            lfoFilterDepth: track.lfoFilterDepth || 0,
            tremoloRate: track.tremoloRate || 0,
            tremoloDepth: track.tremoloDepth || 0,
            filterEnvAmount: track.filterEnvAmount || 0,
            // `??`, not `||`: nought is a real setting for both of
            // these - an instant filter attack, an instant release - and
            // `||` would hand back the default instead, so a sound
            // read out of a track would not be the sound in it.
            filterEnvAttack: track.filterEnvAttack ?? 0.01,
            filterEnvRelease: track.filterEnvRelease ?? 0.2,
            unisonVoices: track.unisonVoices || 1,
            unisonDetune: track.unisonDetune || 0,
            unisonSpread: track.unisonSpread || 0,
            octaveOffset: track.octaveOffset || 0,
            semitoneOffset: track.semitoneOffset || 0,
            phase: track.phase || 0,
            lfo1Wave: track.lfo1Wave || 'sine',
            lfo1Sync: track.lfo1Sync || false,
            lfo1Delay: track.lfo1Delay || 0,
            lfo2Wave: track.lfo2Wave || 'sine',
            lfo2Sync: track.lfo2Sync || false,
            lfo2Delay: track.lfo2Delay || 0,
            lfo3Wave: track.lfo3Wave || 'sine',
            lfo3Sync: track.lfo3Sync || false,
            lfo3Delay: track.lfo3Delay || 0,
            envelope: {
                attack: envelope.attack,
                decay: envelope.decay,
                sustain: envelope.sustain,
                release: envelope.release
            },
            vibrato: { rate: vib.rate, depth: vib.depth },
            fx: this.trackEffects?.getTrackParams(idx) || null,
            arp: this.arpeggiator?.getSettings(idx) || null
        };
    }

    // Apply a full preset state (from user preset or built-in)
    // Remplace l'objet track entier pour éliminer tout résidu de l'ancien preset
    applyFullPresetState(presetData, trackIndex = null) {
        const idx = trackIndex !== null ? trackIndex : this.currentTrack;

        // Remplacer l'objet track ENTIER (pas de merge)
        this.audioEngine.tracks[idx] = {
            type: presetData.type || 'square',
            dutyCycle: presetData.dutyCycle !== undefined ? presetData.dutyCycle : 0.5,
            volume: presetData.volume !== undefined ? presetData.volume : 0.3,
            detune: presetData.detune || 0,
            pitchEnv: presetData.pitchEnv || 0,
            glide: presetData.glide || 0,
            filterCutoff: presetData.filterCutoff !== undefined ? presetData.filterCutoff : 20000,
            filterQ: presetData.filterQ !== undefined ? presetData.filterQ : 0.1,
            filterEnabled: presetData.filterEnabled || false,
            filterType: presetData.filterType || 'lowpass',
            filterKeyTrack: presetData.filterKeyTrack || 0,
            filterLfoRate: presetData.filterLfoRate || 0,
            filterLfoDepth: presetData.filterLfoDepth || 0,
            lfoFilterRate: presetData.lfoFilterRate || 0,
            lfoFilterDepth: presetData.lfoFilterDepth || 0,
            tremoloRate: presetData.tremoloRate || 0,
            tremoloDepth: presetData.tremoloDepth || 0,
            filterEnvAmount: presetData.filterEnvAmount || 0,
            filterEnvAttack: presetData.filterEnvAttack ?? 0.01,
            filterEnvRelease: presetData.filterEnvRelease ?? 0.2,
            unisonVoices: presetData.unisonVoices || 1,
            unisonDetune: presetData.unisonDetune || 0,
            unisonSpread: presetData.unisonSpread || 0,
            octaveOffset: presetData.octaveOffset || 0,
            semitoneOffset: presetData.semitoneOffset || 0,
            phase: presetData.phase || 0,
            lfo1Wave: presetData.lfo1Wave || 'sine',
            lfo1Sync: presetData.lfo1Sync || false,
            lfo1Delay: presetData.lfo1Delay || 0,
            lfo2Wave: presetData.lfo2Wave || 'sine',
            lfo2Sync: presetData.lfo2Sync || false,
            lfo2Delay: presetData.lfo2Delay || 0,
            lfo3Wave: presetData.lfo3Wave || 'sine',
            lfo3Sync: presetData.lfo3Sync || false,
            lfo3Delay: presetData.lfo3Delay || 0
        };

        if (presetData.envelope) {
            this.audioEngine.envelopes[idx] = { ...presetData.envelope };
        }
        if (presetData.vibrato) {
            this.audioEngine.vibrato[idx] = { ...presetData.vibrato };
        }

        // Apply FX preset if present
        if (presetData.fx && this.trackEffects) {
            const te = this.trackEffects;
            te.setDistortion(idx, presetData.fx.distortion || 0);
            // The same three again. A delay with no feedback is what
            // the Clean chain is - `delayFeedback: 0` - so loading any
            // instrument built on it used to put 0.3 of feedback back
            // on, audibly, and reloading the same sound twice gave two
            // different sounds.
            te.setDelayTime(idx, presetData.fx.delayTime ?? 0.25);
            te.setDelayFeedback(idx, presetData.fx.delayFeedback ?? 0.3);
            te.setDelayMix(idx, presetData.fx.delayMix || 0);
            te.setReverbMix(idx, presetData.fx.reverbMix || 0);
            // `getTrackParams` reports the decay, so it is part of what a
            // sound is and of the fingerprint that decides whether a
            // track has been edited. Applying ten of the eleven meant a
            // sound could be read out and put back and still not match
            // itself: Reset left the badge on Modified for ever.
            if (te.setReverbDecay) te.setReverbDecay(idx, presetData.fx.reverbDecay ?? 0.5);
            if (te.setChorusRate) {
                te.setChorusRate(idx, presetData.fx.chorusRate ?? 1);
                te.setChorusDepth(idx, presetData.fx.chorusDepth || 0);
                te.setChorusMix(idx, presetData.fx.chorusMix || 0);
            }
            if (te.setBitcrusherBits) {
                te.setBitcrusherBits(idx, presetData.fx.crushBits || 16);
                te.setBitcrusherRate(idx, presetData.fx.crushRate || 1);
            }
        }

        // Apply ARP settings if present
        if (presetData.arp && this.arpeggiator) {
            this.arpeggiator.updateSettings(idx, presetData.arp);
        }

        this._notifyChanged(idx);
    }
}
