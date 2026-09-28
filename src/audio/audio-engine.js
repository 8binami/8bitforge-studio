/**
 * Audio engine: 8-bit sound generation on the Web Audio API.
 *
 * Owns the audio graph: oscillators and noise, per-track ADSR, filters, LFOs,
 * the channel strips (fader, pan, 3-band EQ, compressor, analyser) and the
 * master bus.
 *
 * It never touches the DOM and never reaches for globals. The optional
 * master-FX and track-FX chains are injected, so the engine can render in an
 * OfflineAudioContext with nothing else present.
 */

import { setOscillatorWave } from './waveforms.js';

/**
 * Where the master fader sits in a new project. Half, not full: the eight
 * tracks sum to roughly twice unity, so this is what lands at 0 dBFS.
 */
export const DEFAULT_MASTER_VOLUME = 0.5;

export class AudioEngine {
    /**
     * @param {object} [options]
     * @param {() => BaseAudioContext} [options.createContext]  audio context factory
     * @param {object|null} [options.masterFx]      master FX chain, attachable later
     * @param {object|null} [options.trackEffects]  per-track FX chain, attachable later
     */
    constructor({ createContext = null, masterFx = null, trackEffects = null } = {}) {
        this._createContext = createContext || defaultContextFactory;

        /** Optional FX chains. Null until the studio attaches them. */
        this.masterFx = masterFx;
        this.trackEffects = trackEffects;

        /** Optional mastering stage, inserted before the master analyser. */
        this.mastering = null;

        this.audioContext = null;
        this.masterGain = null;
        /**
         * The master fader, kept here and not only on the gain node: the
         * node does not exist until the first user gesture, and a project
         * saved or loaded before then must not lose its level.
         */
        this.masterVolume = DEFAULT_MASTER_VOLUME;
        this.analyser = null;
        this.initialized = false;

        // Track configurations (8 tracks) - Drums use positive pitchEnv (start HIGH, sweep DOWN)
        // Per-track filter: filterCutoff (Hz), filterQ (resonance), filterEnabled
        // Per-track modulations: filterLfoRate/Depth, lfoFilterRate/Depth, tremoloRate/Depth
        // Per-track filter envelope: filterEnvAmount (semitones), filterEnvAttack, filterEnvRelease
        const defaultTrackMod = {
            filterCutoff: 20000,
            filterQ: 0.1,
            filterEnabled: false,
            filterType: 'lowpass',
            filterKeyTrack: 0,
            filterLfoRate: 0,
            filterLfoDepth: 0,
            lfoFilterRate: 0,
            lfoFilterDepth: 0,
            tremoloRate: 0,
            tremoloDepth: 0,
            filterEnvAmount: 0,
            filterEnvAttack: 0.01,
            filterEnvRelease: 0.2,
            // OSC extensions
            unisonVoices: 1,
            unisonDetune: 0,
            unisonSpread: 0,
            octaveOffset: 0,
            semitoneOffset: 0,
            phase: 0,
            // LFO waveform/sync/delay
            lfo1Wave: 'sine',
            lfo1Sync: false,
            lfo1Delay: 0,
            lfo2Wave: 'sine',
            lfo2Sync: false,
            lfo2Delay: 0,
            lfo3Wave: 'sine',
            lfo3Sync: false,
            lfo3Delay: 0
        };
        // Volume v2: rebalanced for proper gain staging (sum ≈ 2.06 × masterGain 0.5 ≈ 0 dBFS)
        this.tracks = [
            {
                type: 'square',
                volume: 0.2,
                dutyCycle: 0.5,
                detune: 0,
                pitchEnv: 0,
                glide: 0,
                ...defaultTrackMod
            }, // Lead
            {
                type: 'square',
                volume: 0.15,
                dutyCycle: 0.25,
                detune: 0,
                pitchEnv: 0,
                glide: 0,
                ...defaultTrackMod
            }, // Harmony
            {
                type: 'triangle',
                volume: 0.25,
                dutyCycle: 0.5,
                detune: 0,
                pitchEnv: 0,
                glide: 0.1,
                ...defaultTrackMod
            }, // Bass
            {
                type: 'sawtooth',
                volume: 0.18,
                dutyCycle: 0.5,
                detune: 0,
                pitchEnv: 0,
                glide: 0,
                ...defaultTrackMod
            }, // Arp
            {
                type: 'sine',
                volume: 0.5,
                dutyCycle: 0.5,
                detune: 0,
                pitchEnv: 36,
                glide: 0,
                ...defaultTrackMod
            }, // Kick
            {
                type: 'noise',
                volume: 0.35,
                dutyCycle: 0.5,
                detune: 0,
                pitchEnv: 0,
                glide: 0,
                ...defaultTrackMod
            }, // Snare
            {
                type: 'noise',
                volume: 0.25,
                dutyCycle: 0.5,
                detune: 0,
                pitchEnv: 0,
                glide: 0,
                ...defaultTrackMod
            }, // Hi-hat
            {
                type: 'square',
                volume: 0.18,
                dutyCycle: 0.125,
                detune: 0,
                pitchEnv: 0,
                glide: 0,
                ...defaultTrackMod
            } // FX
        ];

        // ADSR settings per track (optimized for each instrument)
        this.envelopes = [
            { attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.2 }, // Lead
            { attack: 0.02, decay: 0.15, sustain: 0.6, release: 0.3 }, // Harmony
            { attack: 0.01, decay: 0.2, sustain: 0.8, release: 0.15 }, // Bass
            { attack: 0.001, decay: 0.05, sustain: 0.5, release: 0.1 }, // Arp
            { attack: 0.001, decay: 0.3, sustain: 0.0, release: 0.02 }, // Kick (fast attack, long decay, no sustain)
            { attack: 0.001, decay: 0.1, sustain: 0.0, release: 0.05 }, // Snare (short burst)
            { attack: 0.001, decay: 0.06, sustain: 0.0, release: 0.01 }, // Hi-hat (increased decay for audibility)
            { attack: 0.005, decay: 0.3, sustain: 0.0, release: 0.2 } // FX (sweep)
        ];

        // Effects
        this.effects = {
            filter: { enabled: false, type: 'lowpass', frequency: 1000, q: 1 },
            delay: { enabled: false, time: 0.25, feedback: 0.3 }
        };

        // Vibrato settings per track
        this.vibrato = [
            { rate: 0, depth: 0 },
            { rate: 0, depth: 0 },
            { rate: 0, depth: 0 },
            { rate: 0, depth: 0 },
            { rate: 0, depth: 0 },
            { rate: 0, depth: 0 },
            { rate: 0, depth: 0 },
            { rate: 0, depth: 0 }
        ];

        // Per-track mixer settings (fader volume, pan, EQ gains)
        this.mixerSettings = AudioEngine.defaultMixerSettings();

        // Per-track channel strip nodes (created in init)
        this.channelStrips = [];

        // Active notes
        this.activeNotes = new Map();
        this._noteIdCounter = 0;

        // Effect nodes
        this.effectNodes = {};

        // Cached noise buffer (created once in init, reused for all noise notes)
        this._noiseBuffer = null;

        // One PeriodicWave per shape asked for, a duty cycle, a start phase:
        // rather than one per note: building the arrays is the expensive part.
        this._periodicWaveCache = new Map();

        // Pre-allocated analyser buffers (avoids GC pressure in animation loops)
        this._analyserTimeData = null; // for getAnalyserData()
        this._analyserFreqData = null; // for getFrequencyData()
        this._trackLevelData = []; // for getTrackLevel() per track
        this._trackWaveData = []; // for getTrackWaveform() per track
        this._trackSpectrumData = []; // for getTrackSpectrum() per track
        this._masterLevelData = null; // for getMasterLevel()
    }

    async init() {
        if (this.initialized) return;

        this.audioContext = this._createContext();
        this.masterGain = this.audioContext.createGain();
        this.masterGain.gain.value = this.masterVolume;

        // Analyser for visualizer
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 2048;

        // Setup effect nodes
        this.setupEffects();

        // Setup per-track channel strips: gain → pan → eqLow → eqMid → eqHigh → masterGain
        this.channelStrips = [];
        for (let i = 0; i < 8; i++) {
            const strip = {};

            // Track fader gain (mixer volume, separate from synth note volume)
            strip.gain = this.audioContext.createGain();

            // Pan (stereo panner)
            strip.pan = this.audioContext.createStereoPanner();

            // 3-band EQ
            // Low shelf: 320 Hz
            strip.eqLow = this.audioContext.createBiquadFilter();
            strip.eqLow.type = 'lowshelf';
            strip.eqLow.frequency.value = 320;

            // Mid peaking: 1000 Hz, Q=0.7
            strip.eqMid = this.audioContext.createBiquadFilter();
            strip.eqMid.type = 'peaking';
            strip.eqMid.frequency.value = 1000;
            strip.eqMid.Q.value = 0.7;

            // High shelf: 3200 Hz
            strip.eqHigh = this.audioContext.createBiquadFilter();
            strip.eqHigh.type = 'highshelf';
            strip.eqHigh.frequency.value = 3200;

            // Per-track compressor, always connected and set to do nothing
            // while it is off. Its values come from the settings below,
            // with the rest of the strip.
            strip.compressor = this.audioContext.createDynamicsCompressor();
            strip.compressor.knee.value = 6;

            // Analyser per track (for VU meter)
            strip.analyser = this.audioContext.createAnalyser();
            strip.analyser.fftSize = 256;
            strip.analyser.smoothingTimeConstant = 0.8;

            // Chain: gain → pan → eqLow → eqMid → eqHigh → compressor → analyser → masterGain
            strip.gain.connect(strip.pan);
            strip.pan.connect(strip.eqLow);
            strip.eqLow.connect(strip.eqMid);
            strip.eqMid.connect(strip.eqHigh);
            strip.eqHigh.connect(strip.compressor);
            strip.compressor.connect(strip.analyser);
            strip.analyser.connect(this.masterGain);

            this.channelStrips.push(strip);
        }

        // The strips are built bare and the settings written onto them
        // once, here, so one place decides what a strip sounds like - and
        // a project opened before the audio started is heard as it was
        // saved rather than through eight default strips.
        this.applyMixerToAudio();

        // Limiter (DynamicsCompressor as brick-wall limiter)
        // Placed AFTER analyser so VU meter shows true level, limiter prevents speaker clipping
        this.limiter = this.audioContext.createDynamicsCompressor();
        this.limiter.threshold.value = -3; // Start limiting 3dB below clipping
        this.limiter.knee.value = 0; // Hard knee = true limiter
        this.limiter.ratio.value = 20; // Very high ratio = limiter behavior
        this.limiter.attack.value = 0.001; // 1ms attack (catches transients)
        this.limiter.release.value = 0.01; // 10ms release (fast recovery)

        // Connect to destination: masterGain → analyser → limiter → destination
        this.masterGain.connect(this.analyser);
        this.analyser.connect(this.limiter);
        this.limiter.connect(this.audioContext.destination);

        // Pre-generate cached noise buffer (2 seconds, reused by all noise notes)
        // Amplitude 0.6 (v2: reduced from 0.8 for better headroom with noise tracks)
        const noiseBufSize = this.audioContext.sampleRate * 2;
        this._noiseBuffer = this.audioContext.createBuffer(
            1,
            noiseBufSize,
            this.audioContext.sampleRate
        );
        const noiseData = this._noiseBuffer.getChannelData(0);
        for (let i = 0; i < noiseBufSize; i++) {
            noiseData[i] = (Math.random() * 2 - 1) * 0.6;
        }
        for (let i = 1; i < noiseBufSize; i++) {
            noiseData[i] = noiseData[i] * 0.8 + noiseData[i - 1] * 0.2;
        }

        // Pre-allocate analyser buffers (reused every frame, zero GC pressure)
        // IMPORTANT: Fill with 128 (= silence in byte encoding). Uint8Array defaults to 0,
        // which maps to -1.0 amplitude and causes false 100% VU readings when context is suspended.
        this._analyserTimeData = new Uint8Array(this.analyser.frequencyBinCount);
        this._analyserTimeData.fill(128);
        this._analyserFreqData = new Uint8Array(this.analyser.frequencyBinCount);
        this._masterLevelData = new Uint8Array(this.analyser.frequencyBinCount);
        this._masterLevelData.fill(128);
        this._trackLevelData = [];
        this._trackWaveData = [];
        this._trackSpectrumData = [];
        for (let i = 0; i < 8; i++) {
            const bins = this.channelStrips[i].analyser.frequencyBinCount;

            const level = new Uint8Array(bins);
            level.fill(128);
            this._trackLevelData.push(level);

            const wave = new Uint8Array(bins);
            wave.fill(128);
            this._trackWaveData.push(wave);

            // Frequency data is a magnitude, so zero is silence here and
            // filling with 128 would read as a wall of sound.
            this._trackSpectrumData.push(new Uint8Array(bins));
        }

        this.initialized = true;
    }

    setupEffects() {
        // Filter
        this.effectNodes.filter = this.audioContext.createBiquadFilter();
        this.effectNodes.filter.type = 'lowpass';
        this.effectNodes.filter.frequency.value = 1000;

        // Delay
        this.effectNodes.delay = this.audioContext.createDelay(1.0);
        this.effectNodes.delayFeedback = this.audioContext.createGain();
        this.effectNodes.delayGain = this.audioContext.createGain();

        this.effectNodes.delay.delayTime.value = 0.25;
        this.effectNodes.delayFeedback.gain.value = 0.3;
        this.effectNodes.delayGain.gain.value = 0.5;
    }

    /**
     * One oscillator, shaped and tuned.
     *
     * `phase` is where in its cycle the wave starts, in degrees. Noise has no
     * cycle and therefore no phase: it is a looping buffer, and where that
     * loop is cut into is not something a track describes.
     */
    createOscillator(frequency, waveform, dutyCycle = 0.5, phase = 0) {
        if (waveform === 'noise') {
            return this.createNoiseNode();
        }

        const osc = this.audioContext.createOscillator();
        setOscillatorWave(
            this.audioContext,
            osc,
            { type: waveform, dutyCycle, phase },
            this._periodicWaveCache
        );

        osc.frequency.value = frequency;
        return osc;
    }

    createNoiseNode() {
        // Reuse the pre-generated noise buffer (created once in init)
        const noise = this.audioContext.createBufferSource();
        noise.buffer = this._noiseBuffer;
        noise.loop = true;
        return noise;
    }

    // Play note with ADSR envelope
    playNote(frequency, trackIndex = 0, duration = 0.5, startTime = null) {
        if (!this.initialized) {
            console.warn('Audio Engine not initialized');
            return;
        }

        // Use provided startTime for lookahead scheduling, or currentTime for live play
        const now = startTime !== null ? startTime : this.audioContext.currentTime;

        const track = this.tracks[trackIndex];
        const envelope = this.envelopes[trackIndex];
        const vib = this.vibrato[trackIndex];

        // Apply detune + octave/semitone offsets
        let finalFrequency = frequency * Math.pow(2, track.detune / 1200);
        finalFrequency *= Math.pow(2, track.octaveOffset || 0);
        finalFrequency *= Math.pow(2, (track.semitoneOffset || 0) / 12);

        // Gain node for envelope
        const gainNode = this.audioContext.createGain();
        gainNode.gain.value = 0;

        // Unison: create multiple oscillators
        const voices = track.unisonVoices || 1;
        const oscillators = [];
        const unisonGain = this.audioContext.createGain();
        unisonGain.gain.value = 1 / Math.sqrt(voices);

        for (let v = 0; v < voices; v++) {
            const spreadPos = voices === 1 ? 0 : (v / (voices - 1)) * 2 - 1;
            const voiceDetune = spreadPos * (track.unisonDetune || 0);
            const voiceFreq = finalFrequency * Math.pow(2, voiceDetune / 1200);
            const vosc = this.createOscillator(voiceFreq, track.type, track.dutyCycle, track.phase);

            // Pitch envelope per voice
            if (track.pitchEnv !== 0 && vosc.frequency) {
                const pitchEnvTarget = voiceFreq * Math.pow(2, track.pitchEnv / 12);
                const pitchEnvTime = envelope.attack + envelope.decay * 0.5;
                vosc.frequency.setValueAtTime(pitchEnvTarget, now);
                vosc.frequency.exponentialRampToValueAtTime(voiceFreq, now + pitchEnvTime);
            }
            // Glide per voice
            if (track.glide > 0 && vosc.frequency) {
                const glideTime = track.glide * 0.2;
                vosc.frequency.setValueAtTime(voiceFreq * 0.8, now);
                vosc.frequency.exponentialRampToValueAtTime(voiceFreq, now + glideTime);
            }

            // Stereo spread for unison voices
            if (voices > 1 && spreadPos !== 0) {
                const voicePan = spreadPos * ((track.unisonSpread || 0) / 100);
                const panner = this.audioContext.createStereoPanner();
                panner.pan.value = voicePan;
                vosc.connect(panner);
                panner.connect(unisonGain);
            } else {
                vosc.connect(unisonGain);
            }
            oscillators.push(vosc);
        }
        unisonGain.connect(gainNode);

        // Primary oscillator reference
        const osc = oscillators[0];

        // All per-note optional nodes: null by default, only created when needed
        let lfo = null,
            lfoGain = null;
        let tremoloLfo = null,
            tremoloGain = null;
        let trackFilter = null;
        let filtLfo = null,
            filtLfoGain = null;
        let lfoFilt = null,
            lfoFiltGain = null;
        /** Where the filter envelope is going and how long it takes to come home. */
        let filterEnv = null;
        const extraLfos = []; // collects all extra LFOs for scheduled stop()

        const mfx = this.masterFx;

        // === Vibrato LFO: only created when actually needed ===
        const needsVibrato =
            osc.frequency && ((vib.rate > 0 && vib.depth > 0) || (mfx && mfx.modulation > 0));
        if (needsVibrato) {
            lfo = this.audioContext.createOscillator();
            lfo.type = track.lfo1Wave || 'sine';
            lfo.frequency.value = vib.rate || 0;
            lfoGain = this.audioContext.createGain();
            let lfoTargetGain = vib.rate > 0 && vib.depth > 0 ? vib.depth : 0;
            if (mfx && mfx.modulation > 0) {
                const modDepth = mfx.modulation * 15;
                lfoTargetGain = Math.max(lfoTargetGain, modDepth);
                if (lfo.frequency.value < 0.5) lfo.frequency.value = 5;
            }
            if ((track.lfo1Delay || 0) > 0 && lfoTargetGain > 0) {
                lfoGain.gain.setValueAtTime(0, now);
                lfoGain.gain.linearRampToValueAtTime(lfoTargetGain, now + track.lfo1Delay);
            } else {
                lfoGain.gain.value = lfoTargetGain;
            }
            lfo.connect(lfoGain);
            for (const vosc of oscillators) {
                if (vosc.frequency) lfoGain.connect(vosc.frequency);
            }
            lfo.start(now);
        }

        // Pitch bend: applied independently of vibrato LFO
        if (mfx && mfx.pitchBend !== 0) {
            const cents = mfx.pitchBend * 200;
            for (const vosc of oscillators) {
                if (vosc.detune) vosc.detune.value = cents;
            }
        }

        let outputNode = gainNode;

        // === Per-track filter: only created when filter or filter LFOs are active ===
        const needsFilter =
            track.filterEnabled ||
            (track.filterLfoRate > 0 && track.filterLfoDepth > 0) ||
            (track.lfoFilterRate > 0 && track.lfoFilterDepth > 0);

        if (needsFilter) {
            trackFilter = this.audioContext.createBiquadFilter();
            trackFilter.type = track.filterType || 'lowpass';
            let filterCutoffValue =
                track.filterEnabled && track.filterCutoff < 19999 ? track.filterCutoff : 20000;
            // Filter key tracking
            if ((track.filterKeyTrack || 0) > 0 && track.filterEnabled) {
                const keyTrackAmt = track.filterKeyTrack / 100;
                const baseFreq = 261.63; // C4
                const keyTrackOffset = Math.log2(finalFrequency / baseFreq) * keyTrackAmt;
                filterCutoffValue *= Math.pow(2, keyTrackOffset);
                filterCutoffValue = Math.max(20, Math.min(20000, filterCutoffValue));
            }
            trackFilter.frequency.value = filterCutoffValue;
            trackFilter.Q.value = track.filterEnabled ? track.filterQ : 0.1;
            outputNode.connect(trackFilter);
            outputNode = trackFilter;

            // === Filter LFO: only if active ===
            if (track.filterLfoRate > 0 && track.filterLfoDepth > 0) {
                filtLfo = this.audioContext.createOscillator();
                filtLfo.type = track.lfo2Wave || 'sine';
                filtLfo.frequency.value = track.filterLfoRate;
                filtLfoGain = this.audioContext.createGain();
                const filtLfoTarget = (track.filterLfoDepth / 100) * track.filterCutoff * 0.5;
                if ((track.lfo2Delay || 0) > 0 && filtLfoTarget > 0) {
                    filtLfoGain.gain.setValueAtTime(0, now);
                    filtLfoGain.gain.linearRampToValueAtTime(filtLfoTarget, now + track.lfo2Delay);
                } else {
                    filtLfoGain.gain.value = filtLfoTarget;
                }
                filtLfo.connect(filtLfoGain);
                filtLfoGain.connect(trackFilter.frequency);
                filtLfo.start(now);
                extraLfos.push(filtLfo);
            }

            // === LFO Filter: only if active ===
            if (track.lfoFilterRate > 0 && track.lfoFilterDepth > 0) {
                lfoFilt = this.audioContext.createOscillator();
                lfoFilt.type = track.lfo2Wave || 'sine';
                lfoFilt.frequency.value = track.lfoFilterRate;
                lfoFiltGain = this.audioContext.createGain();
                lfoFiltGain.gain.value = (track.lfoFilterDepth / 100) * 5000;
                lfoFilt.connect(lfoFiltGain);
                lfoFiltGain.connect(trackFilter.frequency);
                lfoFilt.start(now);
                extraLfos.push(lfoFilt);
            }

            // Filter envelope: the cutoff opens over the attack, stays open
            // for as long as the note is held, and closes again over the
            // release. The closing half is scheduled with the amplitude
            // release further down, or by stopNote for a held note.
            filterEnv = filterEnvelope(track, filterCutoffValue);
            if (filterEnv) {
                trackFilter.frequency.setValueAtTime(filterEnv.base, now);
                trackFilter.frequency.exponentialRampToValueAtTime(
                    filterEnv.peak,
                    now + filterEnv.attack
                );
            }
        }

        // === Tremolo LFO: only created when actually needed ===
        if (track.tremoloRate > 0 && track.tremoloDepth > 0) {
            tremoloLfo = this.audioContext.createOscillator();
            tremoloLfo.type = track.lfo3Wave || 'sine';
            tremoloLfo.frequency.value = track.tremoloRate;
            tremoloGain = this.audioContext.createGain();
            const tremoloTarget = (track.tremoloDepth / 100) * 0.5;
            if ((track.lfo3Delay || 0) > 0 && tremoloTarget > 0) {
                tremoloGain.gain.setValueAtTime(0, now);
                tremoloGain.gain.linearRampToValueAtTime(tremoloTarget, now + track.lfo3Delay);
            } else {
                tremoloGain.gain.value = tremoloTarget;
            }
            tremoloLfo.connect(tremoloGain);
            tremoloGain.connect(gainNode.gain);
            tremoloLfo.start(now);
            extraLfos.push(tremoloLfo);
        }

        // Global effects filter (from sidebar effects panel)
        if (this.effects.filter.enabled) {
            outputNode.connect(this.effectNodes.filter);
            outputNode = this.effectNodes.filter;
        }

        // Per-track FX chain (distortion, delay, reverb, chorus, bitcrusher)
        const trackFx = this.trackEffects;
        if (trackFx) {
            const fxOut = trackFx.connectSource(outputNode, trackIndex);
            if (fxOut) outputNode = fxOut;
        }

        // Route through per-track channel strip (gain → pan → EQ → master)
        const channelStrip = this.channelStrips[trackIndex];
        const stripInput = channelStrip ? channelStrip.gain : this.masterGain;

        if (this.effects.delay.enabled) {
            outputNode.connect(this.effectNodes.delayGain);
            this.effectNodes.delayGain.connect(this.effectNodes.delay);
            this.effectNodes.delay.connect(this.effectNodes.delayFeedback);
            this.effectNodes.delayFeedback.connect(this.effectNodes.delay);
            this.effectNodes.delay.connect(stripInput);
        }

        outputNode.connect(stripInput);

        // ADSR Envelope
        const attackTime = envelope.attack;
        const decayTime = envelope.decay;
        const sustainLevel = envelope.sustain * track.volume;
        const releaseTime = envelope.release;

        // Attack
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(track.volume, now + attackTime);

        // Decay → Sustain level
        gainNode.gain.linearRampToValueAtTime(sustainLevel, now + attackTime + decayTime);

        // Start all oscillators
        for (const vosc of oscillators) {
            vosc.start(now);
        }

        // Sustained notes (keyboard/MIDI, duration >= 10s): don't schedule release
        // Short notes (sequencer): schedule full ADSR release
        const sustained = duration >= 10;

        if (!sustained) {
            const releaseStart = now + duration;
            gainNode.gain.setValueAtTime(sustainLevel, releaseStart);
            gainNode.gain.linearRampToValueAtTime(0, releaseStart + releaseTime);

            if (filterEnv) {
                // Never before the attack has finished: a sixteenth under a
                // slow attack would otherwise ask the filter to close at a
                // time it is still scheduled to be opening at, and the two
                // ramps would run out of order.
                const closeFrom = Math.max(now + filterEnv.attack, releaseStart);
                trackFilter.frequency.setValueAtTime(filterEnv.peak, closeFrom);
                trackFilter.frequency.exponentialRampToValueAtTime(
                    filterEnv.base,
                    closeFrom + filterEnv.release
                );
            }

            const stopTime = releaseStart + releaseTime + 0.1;
            for (const vosc of oscillators) {
                vosc.stop(stopTime);
            }
            if (lfo) lfo.stop(stopTime);
            extraLfos.forEach((l) => l.stop(stopTime));
        }

        // Unique noteId to avoid collisions when same note played multiple times
        const noteId = `note-${++this._noteIdCounter}`;
        this.activeNotes.set(noteId, {
            osc,
            oscillators,
            gainNode,
            unisonGain,
            lfo,
            lfoGain,
            tremoloLfo,
            tremoloGain,
            filtLfo,
            filtLfoGain,
            lfoFilt,
            lfoFiltGain,
            trackFilter,
            filterEnv,
            extraLfos,
            trackIndex
        });

        // Cleanup via onended: fires precisely when primary oscillator stops,
        // replacing setTimeout which was imprecise and accumulated in the JS queue.
        oscillators[0].onended = () => {
            this.activeNotes.delete(noteId);
            try {
                oscillators.forEach((v) => {
                    try {
                        v.disconnect();
                    } catch {}
                });
                unisonGain.disconnect();
                gainNode.disconnect();
                if (lfo) {
                    lfo.disconnect();
                    if (lfoGain) lfoGain.disconnect();
                }
                if (trackFilter) trackFilter.disconnect();
                if (tremoloLfo) {
                    tremoloLfo.disconnect();
                    if (tremoloGain) tremoloGain.disconnect();
                }
                if (filtLfo) {
                    filtLfo.disconnect();
                    if (filtLfoGain) filtLfoGain.disconnect();
                }
                if (lfoFilt) {
                    lfoFilt.disconnect();
                    if (lfoFiltGain) lfoFiltGain.disconnect();
                }
            } catch {}
        };

        return noteId;
    }

    stopNote(noteId) {
        if (!this.activeNotes.has(noteId)) return;

        const noteData = this.activeNotes.get(noteId);
        const { oscillators, gainNode, lfo, extraLfos, trackIndex, trackFilter, filterEnv } =
            noteData;
        const now = this.audioContext.currentTime;
        // Use the track's ADSR release time for natural fade-out
        const release =
            trackIndex !== undefined && this.envelopes[trackIndex]
                ? Math.max(0.02, this.envelopes[trackIndex].release)
                : 0.1;

        try {
            gainNode.gain.cancelScheduledValues(now);
            gainNode.gain.setValueAtTime(gainNode.gain.value, now);
            gainNode.gain.linearRampToValueAtTime(0, now + release);

            // A held note has no scheduled close, and a note cut short has
            // one that is no longer true. Either way the filter comes home
            // from wherever it has got to, over the release it was given.
            if (trackFilter && filterEnv) {
                const cutoff = trackFilter.frequency;
                cutoff.cancelScheduledValues(now);
                cutoff.setValueAtTime(cutoff.value, now);
                cutoff.exponentialRampToValueAtTime(filterEnv.base, now + filterEnv.release);
            }

            const stopTime = now + release + 0.1;
            if (oscillators) {
                oscillators.forEach((vosc) => {
                    try {
                        vosc.stop(stopTime);
                    } catch {}
                });
            }
            if (lfo) lfo.stop(stopTime);
            if (extraLfos)
                extraLfos.forEach((l) => {
                    try {
                        l.stop(stopTime);
                    } catch {}
                });
        } catch {
            // Oscillator may already be stopped
        }

        // Remove from active notes immediately: onended handler handles node disconnect
        this.activeNotes.delete(noteId);
    }

    // Update parameters on all currently playing notes for a given track (real-time tweaking)
    updateLiveNotes(trackIndex) {
        const track = this.tracks[trackIndex];
        const vib = this.vibrato[trackIndex];

        for (const noteData of this.activeNotes.values()) {
            if (noteData.trackIndex !== trackIndex) continue;

            // Filter cutoff & Q
            if (noteData.trackFilter) {
                const cutoff =
                    track.filterEnabled && track.filterCutoff < 19999 ? track.filterCutoff : 20000;
                noteData.trackFilter.frequency.value = cutoff;
                noteData.trackFilter.Q.value = track.filterEnabled ? track.filterQ : 0.1;
            }

            // Vibrato (LFO → pitch)
            if (noteData.lfo && noteData.lfoGain) {
                noteData.lfo.frequency.value = vib.rate || 0;
                noteData.lfoGain.gain.value = vib.rate > 0 && vib.depth > 0 ? vib.depth : 0;
            }

            // Tremolo (LFO → amplitude)
            if (noteData.tremoloLfo && noteData.tremoloGain) {
                noteData.tremoloLfo.frequency.value = track.tremoloRate || 0.01;
                noteData.tremoloGain.gain.value =
                    track.tremoloRate > 0 && track.tremoloDepth > 0
                        ? (track.tremoloDepth / 100) * 0.5
                        : 0;
            }

            // Filter LFO
            if (noteData.filtLfo && noteData.filtLfoGain) {
                noteData.filtLfo.frequency.value = track.filterLfoRate || 0.01;
                noteData.filtLfoGain.gain.value =
                    track.filterLfoRate > 0 && track.filterLfoDepth > 0
                        ? (track.filterLfoDepth / 100) * track.filterCutoff * 0.5
                        : 0;
            }

            // LFO Filter
            if (noteData.lfoFilt && noteData.lfoFiltGain) {
                noteData.lfoFilt.frequency.value = track.lfoFilterRate || 0.01;
                noteData.lfoFiltGain.gain.value =
                    track.lfoFilterRate > 0 && track.lfoFilterDepth > 0
                        ? (track.lfoFilterDepth / 100) * 5000
                        : 0;
            }
        }
    }

    // Stop all currently sustained notes (panic / all notes off)
    stopAllNotes() {
        for (const noteId of [...this.activeNotes.keys()]) {
            this.stopNote(noteId);
        }
    }

    // Reset all tracks, envelopes, vibrato, and effects to factory defaults
    resetToDefaults() {
        const defaultTrackMod = {
            filterCutoff: 20000,
            filterQ: 0.1,
            filterEnabled: false,
            filterType: 'lowpass',
            filterKeyTrack: 0,
            filterLfoRate: 0,
            filterLfoDepth: 0,
            lfoFilterRate: 0,
            lfoFilterDepth: 0,
            tremoloRate: 0,
            tremoloDepth: 0,
            filterEnvAmount: 0,
            filterEnvAttack: 0.01,
            filterEnvRelease: 0.2,
            unisonVoices: 1,
            unisonDetune: 0,
            unisonSpread: 0,
            octaveOffset: 0,
            semitoneOffset: 0,
            phase: 0,
            lfo1Wave: 'sine',
            lfo1Sync: false,
            lfo1Delay: 0,
            lfo2Wave: 'sine',
            lfo2Sync: false,
            lfo2Delay: 0,
            lfo3Wave: 'sine',
            lfo3Sync: false,
            lfo3Delay: 0
        };

        // Volume v2: rebalanced
        const defaultTracks = [
            {
                type: 'square',
                volume: 0.2,
                dutyCycle: 0.5,
                detune: 0,
                pitchEnv: 0,
                glide: 0,
                ...defaultTrackMod
            },
            {
                type: 'square',
                volume: 0.15,
                dutyCycle: 0.25,
                detune: 0,
                pitchEnv: 0,
                glide: 0,
                ...defaultTrackMod
            },
            {
                type: 'triangle',
                volume: 0.25,
                dutyCycle: 0.5,
                detune: 0,
                pitchEnv: 0,
                glide: 0.1,
                ...defaultTrackMod
            },
            {
                type: 'sawtooth',
                volume: 0.18,
                dutyCycle: 0.5,
                detune: 0,
                pitchEnv: 0,
                glide: 0,
                ...defaultTrackMod
            },
            {
                type: 'sine',
                volume: 0.5,
                dutyCycle: 0.5,
                detune: 0,
                pitchEnv: 36,
                glide: 0,
                ...defaultTrackMod
            },
            {
                type: 'noise',
                volume: 0.35,
                dutyCycle: 0.5,
                detune: 0,
                pitchEnv: 0,
                glide: 0,
                ...defaultTrackMod
            },
            {
                type: 'noise',
                volume: 0.25,
                dutyCycle: 0.5,
                detune: 0,
                pitchEnv: 0,
                glide: 0,
                ...defaultTrackMod
            },
            {
                type: 'square',
                volume: 0.18,
                dutyCycle: 0.125,
                detune: 0,
                pitchEnv: 0,
                glide: 0,
                ...defaultTrackMod
            }
        ];

        const defaultEnvelopes = [
            { attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.2 },
            { attack: 0.02, decay: 0.15, sustain: 0.6, release: 0.3 },
            { attack: 0.01, decay: 0.2, sustain: 0.8, release: 0.15 },
            { attack: 0.001, decay: 0.05, sustain: 0.5, release: 0.1 },
            { attack: 0.001, decay: 0.3, sustain: 0.0, release: 0.02 },
            { attack: 0.001, decay: 0.1, sustain: 0.0, release: 0.05 },
            { attack: 0.001, decay: 0.06, sustain: 0.0, release: 0.01 },
            { attack: 0.005, decay: 0.3, sustain: 0.0, release: 0.2 }
        ];

        // Reset tracks (replace entire objects to clear all properties)
        for (let i = 0; i < 8; i++) {
            this.tracks[i] = { ...defaultTracks[i] };
            this.envelopes[i] = { ...defaultEnvelopes[i] };
            this.vibrato[i] = { rate: 0, depth: 0 };
        }

        // Reset global effects
        this.effects = {
            filter: { enabled: false, type: 'lowpass', frequency: 1000, q: 1 },
            delay: { enabled: false, time: 0.25, feedback: 0.3 }
        };

        // Reset mixer console
        this.resetMixerToDefaults();
    }

    // Update track settings
    updateTrack(trackIndex, settings) {
        Object.assign(this.tracks[trackIndex], settings);
    }

    updateEnvelope(trackIndex, envelope) {
        Object.assign(this.envelopes[trackIndex], envelope);
    }

    updateVibrato(trackIndex, vibrato) {
        Object.assign(this.vibrato[trackIndex], vibrato);
    }

    updateEffect(effectName, settings) {
        if (!this.effects[effectName]) return; // Skip removed effects (backward compat)
        Object.assign(this.effects[effectName], settings);

        // Update actual audio nodes
        if (effectName === 'filter' && this.effectNodes.filter) {
            this.effectNodes.filter.type = settings.type || this.effects.filter.type;
            this.effectNodes.filter.frequency.value =
                settings.frequency || this.effects.filter.frequency;
        }

        if (effectName === 'delay' && this.effectNodes.delay) {
            this.effectNodes.delay.delayTime.value = settings.time || this.effects.delay.time;
            this.effectNodes.delayFeedback.gain.value =
                settings.feedback || this.effects.delay.feedback;
        }
    }

    // Get analyser data for visualizer (reuses pre-allocated buffer: zero GC)
    getAnalyserData() {
        if (!this.analyser) return null;
        this.analyser.getByteTimeDomainData(this._analyserTimeData);
        return this._analyserTimeData;
    }

    getFrequencyData() {
        if (!this.analyser) return null;
        this.analyser.getByteFrequencyData(this._analyserFreqData);
        return this._analyserFreqData;
    }

    // Note to frequency conversion
    static noteToFrequency(note, octave = 4) {
        const noteMap = {
            C: 0,
            'C#': 1,
            D: 2,
            'D#': 3,
            E: 4,
            F: 5,
            'F#': 6,
            G: 7,
            'G#': 8,
            A: 9,
            'A#': 10,
            B: 11
        };

        const noteIndex = noteMap[note];
        if (noteIndex === undefined) return 440;

        const a4 = 440;
        const semitone = Math.pow(2, 1 / 12);
        const steps = (octave - 4) * 12 + (noteIndex - 9); // A4 is reference

        return a4 * Math.pow(semitone, steps);
    }

    // Mute/unmute master
    setMasterVolume(volume) {
        this.masterVolume = volume;
        if (this.masterGain) {
            this.masterGain.gain.value = volume;
        }
    }

    getMasterVolume() {
        return this.masterVolume;
    }

    // =========================================
    // Mixer Console Controls
    // =========================================

    setTrackFaderVolume(trackIndex, volume) {
        this.mixerSettings[trackIndex].volume = volume;
        if (this.channelStrips[trackIndex]) {
            this.channelStrips[trackIndex].gain.gain.value = volume;
        }
    }

    setTrackPan(trackIndex, pan) {
        this.mixerSettings[trackIndex].pan = pan;
        if (this.channelStrips[trackIndex]) {
            this.channelStrips[trackIndex].pan.pan.value = pan;
        }
    }

    setTrackEQ(trackIndex, band, gainDb) {
        this.mixerSettings[trackIndex][band] = gainDb;
        if (this.channelStrips[trackIndex]) {
            const strip = this.channelStrips[trackIndex];
            if (band === 'eqLow') strip.eqLow.gain.value = gainDb;
            else if (band === 'eqMid') strip.eqMid.gain.value = gainDb;
            else if (band === 'eqHigh') strip.eqHigh.gain.value = gainDb;
        }
    }

    getTrackLevel(trackIndex) {
        if (!this.channelStrips[trackIndex]) return 0;
        if (this.audioContext?.state !== 'running') return 0;
        const analyser = this.channelStrips[trackIndex].analyser;
        const data = this._trackLevelData[trackIndex];
        analyser.getByteTimeDomainData(data);
        // Calculate RMS level
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128;
            sum += v * v;
        }
        return Math.sqrt(sum / data.length);
    }

    /**
     * One track's waveform, as the analyser on its channel strip sees it.
     *
     * Byte encoded, 128 being silence, over about three milliseconds. Null
     * before the audio exists and while the context is suspended, which is
     * the difference between "no signal" and "a flat line at full scale":
     * an unfilled buffer reads as -1, not as nothing.
     *
     * @param {number} trackIndex
     * @returns {Uint8Array|null}
     */
    getTrackWaveform(trackIndex) {
        if (!this.channelStrips[trackIndex]) return null;
        if (this.audioContext?.state !== 'running') return null;

        const data = this._trackWaveData[trackIndex];
        this.channelStrips[trackIndex].analyser.getByteTimeDomainData(data);
        return data;
    }

    /**
     * One track's spectrum, in the same 128 bins.
     *
     * Each byte is the analyser's own decibel mapping, so the numbers are
     * already scaled for drawing; bin `i` covers roughly `sampleRate /
     * fftSize` hertz, about 172 Hz at the usual rate.
     *
     * @param {number} trackIndex
     * @returns {Uint8Array|null}
     */
    getTrackSpectrum(trackIndex) {
        if (!this.channelStrips[trackIndex]) return null;
        if (this.audioContext?.state !== 'running') return null;

        const data = this._trackSpectrumData[trackIndex];
        this.channelStrips[trackIndex].analyser.getByteFrequencyData(data);
        return data;
    }

    getMasterLevel() {
        if (!this.analyser) return 0;
        if (this.audioContext?.state !== 'running') return 0;
        const data = this._masterLevelData;
        this.analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128;
            sum += v * v;
        }
        return Math.sqrt(sum / data.length);
    }

    /**
     * Eight channel strips doing nothing: unity, centred, flat, with the
     * compressor off. Said once, so the mixer a studio starts with and
     * the mixer Reset gives back cannot drift apart.
     */
    static defaultMixerSettings() {
        return Array.from({ length: 8 }, () => ({
            volume: 1.0, // Fader volume (0 to 1.5, default 1.0 = unity)
            pan: 0, // -1 (left) to 1 (right)
            eqLow: 0, // dB (-12 to +12)
            eqMid: 0, // dB (-12 to +12)
            eqHigh: 0, // dB (-12 to +12)
            solo: false, // Global mixer solo (overrides per-pattern)
            mute: false, // Global mixer mute (overrides per-pattern)
            compressor: {
                enabled: false,
                threshold: -24,
                ratio: 4,
                attack: 0.003,
                release: 0.25
            }
        }));
    }

    /**
     * Write every channel strip's settings onto its nodes.
     *
     * The setters below each write one value to the record and to the
     * node, which is what a control being moved needs. Replacing the
     * whole record has no control to move: opening a project assigned
     * `mixerSettings` and reached the graph with nothing, so what you
     * heard afterwards was the previous project's faders, pans, EQ and
     * compressors. This is the call that closes that.
     */
    applyMixerToAudio() {
        for (let i = 0; i < 8; i++) {
            const strip = this.channelStrips[i];
            const settings = this.mixerSettings[i];
            if (!strip || !settings) continue;

            strip.gain.gain.value = settings.volume;
            strip.pan.pan.value = settings.pan;
            strip.eqLow.gain.value = settings.eqLow;
            strip.eqMid.gain.value = settings.eqMid;
            strip.eqHigh.gain.value = settings.eqHigh;
            this._applyTrackCompressor(i);
        }
    }

    /**
     * A compressor that is off is a compressor set to do nothing: it
     * stays in the chain, because taking it out and putting it back
     * would click.
     *
     * Attack and release are written either way. They cost nothing while
     * the threshold sits at 0 dB, and it means switching the compressor
     * on uses the times that were stored rather than whatever was left
     * in the node.
     *
     * @param {number} trackIndex
     */
    _applyTrackCompressor(trackIndex) {
        const strip = this.channelStrips[trackIndex];
        const settings = this.mixerSettings[trackIndex]?.compressor;
        if (!strip || !settings) return;

        strip.compressor.threshold.value = settings.enabled ? settings.threshold : 0;
        strip.compressor.ratio.value = settings.enabled ? settings.ratio : 1;
        strip.compressor.attack.value = settings.attack;
        strip.compressor.release.value = settings.release;
    }

    resetMixerToDefaults() {
        this.mixerSettings = AudioEngine.defaultMixerSettings();
        this.applyMixerToAudio();
    }

    // ---- Per-track compressor ----

    /**
     * The five below write the record and then let
     * `_applyTrackCompressor` decide what reaches the node, so the rule
     * about being off is stated once. They also work before the audio has
     * started: the settings they write outlive the graph.
     *
     * @param {number} trackIndex
     * @param {'enabled'|'threshold'|'ratio'|'attack'|'release'} key
     * @param {number|boolean} value
     */
    _setTrackCompressor(trackIndex, key, value) {
        const settings = this.mixerSettings[trackIndex]?.compressor;
        if (!settings) return;

        settings[key] = value;
        this._applyTrackCompressor(trackIndex);
    }

    setTrackCompressorEnabled(trackIndex, enabled) {
        this._setTrackCompressor(trackIndex, 'enabled', enabled);
    }

    setTrackCompressorThreshold(trackIndex, val) {
        this._setTrackCompressor(trackIndex, 'threshold', val);
    }

    setTrackCompressorRatio(trackIndex, val) {
        this._setTrackCompressor(trackIndex, 'ratio', val);
    }

    setTrackCompressorAttack(trackIndex, val) {
        this._setTrackCompressor(trackIndex, 'attack', val);
    }

    setTrackCompressorRelease(trackIndex, val) {
        this._setTrackCompressor(trackIndex, 'release', val);
    }

    getTrackCompressorReduction(trackIndex) {
        const strip = this.channelStrips[trackIndex];
        return strip?.compressor?.reduction ?? 0;
    }

    // Global mixer solo/mute (independent of per-pattern states)
    setGlobalSolo(trackIndex, solo) {
        this.mixerSettings[trackIndex].solo = solo;
    }

    setGlobalMute(trackIndex, mute) {
        this.mixerSettings[trackIndex].mute = mute;
    }

    resetMixerSoloMute() {
        for (let i = 0; i < 8; i++) {
            this.mixerSettings[i].solo = false;
            this.mixerSettings[i].mute = false;
        }
    }
}

/** Default factory: the browser's audio context, Safari prefix included. */
function defaultContextFactory() {
    const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctor) throw new Error('Web Audio API is not available in this runtime');
    return new Ctor();
}

/** A cutoff, kept inside what a biquad can usefully be asked for. */
function clampCutoff(frequency) {
    return Math.max(20, Math.min(20000, frequency));
}

/**
 * The filter envelope of a track, in the terms the ramps need.
 *
 * Shape: the cutoff climbs from where the filter sits to `peak` over
 * `attack`, stays there while the note is held, and comes back down over
 * `release`. That is what the pad's two axes are labelled, and what the
 * picture in the synth window draws.
 *
 * `cutoff` is where the filter already is: the track's cutoff after key
 * tracking, not before it: so the envelope comes home to the note's own
 * cutoff rather than to the number written on the panel.
 *
 * Shared with the offline renderer, which builds the same voice against a
 * different clock: an envelope computed twice is an export that stops
 * sounding like what was played.
 *
 * @returns {{base: number, peak: number, attack: number, release: number}|null}
 *          null when the track has no filter envelope to speak of
 */
export function filterEnvelope(track, cutoff) {
    if (!track.filterEnabled || !track.filterEnvAmount) return null;

    const base = clampCutoff(cutoff);
    return {
        base,
        peak: clampCutoff(base * Math.pow(2, track.filterEnvAmount / 12)),
        attack: Math.max(0.001, track.filterEnvAttack || 0.01),
        release: Math.max(0.001, track.filterEnvRelease || 0.2)
    };
}
