/**
 * Per-track effects: one serial chain per track.
 *
 * Signal: input → distortion → chorus → delay → reverb → bitcrusher → output
 *
 * The bitcrusher runs in an AudioWorklet, which the Web Audio API requires to
 * live in its own file. The URL is resolved relative to this module so the
 * bundler emits the worklet as an asset and it works under both the web and
 * the app:// origin. When the worklet cannot be loaded the chain falls back to
 * a ScriptProcessor.
 *
 * Construction is asynchronous: await `ready` before touching the chains.
 */

const WORKLET_URL = new URL('./worklets/bitcrusher.js', import.meta.url);

/** How many tracks have a chain. */
const TRACK_COUNT = 8;

/**
 * A chain that is doing nothing: dry all the way through. These are the
 * values `createTrackEffectsChain` builds a node with, written out so that a
 * new project has something to save and restore before any audio exists.
 */
export const DEFAULT_TRACK_FX = Object.freeze({
    distortion: 0,
    delayTime: 0.25,
    delayFeedback: 0.3,
    delayMix: 0,
    reverbMix: 0,
    reverbDecay: 0.5,
    chorusRate: 1,
    chorusDepth: 0,
    chorusMix: 0,
    crushBits: 16,
    crushRate: 1
});

export class TrackEffects {
    /** @param {import('./audio-engine.js').AudioEngine} audioEngine */
    constructor(audioEngine) {
        this.audioEngine = audioEngine;
        this.trackEffects = [];
        this._workletReady = false;

        /** Resolves once the worklet is loaded and the eight chains exist. */
        this.ready = this._init();
    }

    async _init() {
        const ctx = this.audioEngine.audioContext;
        if (ctx && typeof ctx.audioWorklet !== 'undefined') {
            try {
                await ctx.audioWorklet.addModule(WORKLET_URL);
                this._workletReady = true;
            } catch (err) {
                console.warn('[TrackEffects] AudioWorklet unavailable, using fallback:', err);
            }
        }

        // Create effect chains (uses worklet if available)
        for (let track = 0; track < TRACK_COUNT; track++) {
            this.trackEffects[track] = this.createTrackEffectsChain();
        }
    }

    createTrackEffectsChain() {
        const ctx = this.audioEngine.audioContext;
        if (!ctx) return null;

        // Serial chain: input → dist → chorus → delay → reverb → crush → output
        const chain = {
            input: ctx.createGain(),

            // Distortion (waveshaper)
            distortion: ctx.createWaveShaper(),
            distortionGain: ctx.createGain(), // wet level
            distortionDry: ctx.createGain(), // dry bypass
            distortionMix: ctx.createGain(), // merge point

            // Chorus (modulated delay)
            chorusDelay: ctx.createDelay(0.1),
            chorusLfo: ctx.createOscillator(),
            chorusLfoGain: ctx.createGain(),
            chorusWet: ctx.createGain(),
            chorusDry: ctx.createGain(),
            chorusMix: ctx.createGain(),

            // Delay (feedback delay)
            delay: ctx.createDelay(2.0),
            delayFeedback: ctx.createGain(),
            delayWet: ctx.createGain(),
            delayDry: ctx.createGain(),
            delayMix: ctx.createGain(),

            // Reverb (convolution)
            reverb: ctx.createConvolver(),
            reverbWet: ctx.createGain(),
            reverbDry: ctx.createGain(),
            reverbMix: ctx.createGain(),
            reverbDecay: 0.5, // stored so getTrackParams() can return the real value
            distortionAmount: 0, // likewise: a waveshaper curve cannot be read back

            // Bitcrusher (AudioWorklet or fallback ScriptProcessor)
            crusher: null,
            crusherBits: 16,
            crusherRate: 1,
            crusherWet: ctx.createGain(),
            crusherDry: ctx.createGain(),
            crusherMix: ctx.createGain(),

            // Final output
            output: ctx.createGain()
        };

        // Create bitcrusher node (AudioWorklet preferred, ScriptProcessor fallback)
        if (this._workletReady) {
            chain.crusher = new AudioWorkletNode(ctx, 'bitcrusher-processor');
            chain._isWorklet = true;
        } else {
            chain.crusher = ctx.createScriptProcessor(4096, 1, 1);
            chain._isWorklet = false;
        }

        // Defaults: all effects bypassed (dry=1, wet=0)
        chain.input.gain.value = 1;

        // Distortion defaults (off)
        chain.distortionGain.gain.value = 0;
        chain.distortionDry.gain.value = 1;

        // Chorus defaults (off)
        chain.chorusDelay.delayTime.value = 0.005;
        chain.chorusLfo.frequency.value = 1;
        chain.chorusLfoGain.gain.value = 0;
        chain.chorusWet.gain.value = 0;
        chain.chorusDry.gain.value = 1;

        // Chorus LFO → delayTime modulation
        chain.chorusLfo.connect(chain.chorusLfoGain);
        chain.chorusLfoGain.connect(chain.chorusDelay.delayTime);
        chain.chorusLfo.start();

        // Delay defaults (off)
        chain.delay.delayTime.value = 0.25;
        chain.delayFeedback.gain.value = 0.3;
        chain.delayWet.gain.value = 0;
        chain.delayDry.gain.value = 1;

        // Reverb defaults (off)
        chain.reverbWet.gain.value = 0;
        chain.reverbDry.gain.value = 1;

        // Bitcrusher defaults (off)
        chain.crusherWet.gain.value = 0;
        chain.crusherDry.gain.value = 1;
        if (!chain._isWorklet) {
            // ScriptProcessor fallback (deprecated but functional)
            chain.crusher.onaudioprocess = (e) => {
                const input = e.inputBuffer.getChannelData(0);
                const output = e.outputBuffer.getChannelData(0);
                const step = Math.pow(0.5, chain.crusherBits);
                const srFactor = Math.max(1, Math.round(1 / Math.max(0.01, chain.crusherRate)));
                let lastSample = 0;
                for (let i = 0; i < input.length; i++) {
                    if (i % srFactor === 0) {
                        lastSample = Math.floor(input[i] / step) * step;
                    }
                    output[i] = lastSample;
                }
            };
        }

        // Reverb impulse
        this.createReverbImpulse(chain.reverb, 2, 0.5);

        // Wire the serial chain
        this.connectEffectsChain(chain);

        return chain;
    }

    connectEffectsChain(chain) {
        // === Stage 1: Distortion ===
        // input → distortion → distortionGain ─┐
        // input → distortionDry ────────────────┤→ distortionMix
        chain.input.connect(chain.distortion);
        chain.distortion.connect(chain.distortionGain);
        chain.distortionGain.connect(chain.distortionMix);
        chain.input.connect(chain.distortionDry);
        chain.distortionDry.connect(chain.distortionMix);

        // === Stage 2: Chorus ===
        // distortionMix → chorusDelay → chorusWet ─┐
        // distortionMix → chorusDry ────────────────┤→ chorusMix
        chain.distortionMix.connect(chain.chorusDelay);
        chain.chorusDelay.connect(chain.chorusWet);
        chain.chorusWet.connect(chain.chorusMix);
        chain.distortionMix.connect(chain.chorusDry);
        chain.chorusDry.connect(chain.chorusMix);

        // === Stage 3: Delay ===
        // chorusMix → delay → delayWet ─┐
        // chorusMix → delayDry ──────────┤→ delayMix
        // delay → delayFeedback → delay (feedback loop)
        chain.chorusMix.connect(chain.delay);
        chain.delay.connect(chain.delayFeedback);
        chain.delayFeedback.connect(chain.delay);
        chain.delay.connect(chain.delayWet);
        chain.delayWet.connect(chain.delayMix);
        chain.chorusMix.connect(chain.delayDry);
        chain.delayDry.connect(chain.delayMix);

        // === Stage 4: Reverb ===
        // delayMix → reverb → reverbWet ─┐
        // delayMix → reverbDry ───────────┤→ reverbMix
        chain.delayMix.connect(chain.reverb);
        chain.reverb.connect(chain.reverbWet);
        chain.reverbWet.connect(chain.reverbMix);
        chain.delayMix.connect(chain.reverbDry);
        chain.reverbDry.connect(chain.reverbMix);

        // === Stage 5: Bitcrusher ===
        // reverbMix → crusher → crusherWet ─┐
        // reverbMix → crusherDry ────────────┤→ crusherMix → output
        chain.reverbMix.connect(chain.crusher);
        chain.crusher.connect(chain.crusherWet);
        chain.crusherWet.connect(chain.crusherMix);
        chain.reverbMix.connect(chain.crusherDry);
        chain.crusherDry.connect(chain.crusherMix);

        // Final output
        chain.crusherMix.connect(chain.output);
    }

    // Créer une impulse response pour le reverb
    createReverbImpulse(convolver, duration, decay) {
        const ctx = this.audioEngine.audioContext;
        const sampleRate = ctx.sampleRate;
        const length = sampleRate * duration;
        const impulse = ctx.createBuffer(2, length, sampleRate);

        for (let channel = 0; channel < 2; channel++) {
            const channelData = impulse.getChannelData(channel);
            for (let i = 0; i < length; i++) {
                channelData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
            }
        }

        convolver.buffer = impulse;
    }

    // Obtenir la chaîne d'effets pour une piste
    getTrackChain(track) {
        return this.trackEffects[track];
    }

    // Connecter une source à la chaîne d'effets
    connectSource(source, track) {
        const chain = this.trackEffects[track];
        if (!chain) return source;

        // Connect source to the chain's input node
        source.connect(chain.input);

        return chain.output;
    }

    // === DISTORTION ===
    setDistortion(track, amount) {
        const chain = this.trackEffects[track];
        if (!chain) return;

        // The amount is baked into the waveshaper's curve, and a curve is
        // not something to read a number back out of. The gain beside it is
        // only a wet/dry switch, so without keeping the amount here a saved
        // preset would come back at full distortion or none.
        chain.distortionAmount = amount;

        // amount: 0-1
        if (amount === 0) {
            chain.distortionGain.gain.value = 0;
            chain.distortionDry.gain.value = 1;
        } else {
            chain.distortionGain.gain.value = 1;
            chain.distortionDry.gain.value = 0;
            this.makeDistortionCurve(chain.distortion, amount * 100);
        }
    }

    makeDistortionCurve(waveshaper, amount) {
        const samples = 44100;
        const curve = new Float32Array(samples);
        const deg = Math.PI / 180;

        for (let i = 0; i < samples; i++) {
            const x = (i * 2) / samples - 1;
            curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
        }

        waveshaper.curve = curve;
        waveshaper.oversample = '4x';
    }

    // === DELAY ===
    setDelayTime(track, time) {
        const chain = this.trackEffects[track];
        if (!chain) return;
        chain.delay.delayTime.value = Math.max(0, Math.min(2, time));
    }

    setDelayFeedback(track, feedback) {
        const chain = this.trackEffects[track];
        if (!chain) return;
        chain.delayFeedback.gain.value = Math.max(0, Math.min(0.9, feedback));
    }

    setDelayMix(track, mix) {
        const chain = this.trackEffects[track];
        if (!chain) return;
        chain.delayWet.gain.value = mix;
        chain.delayDry.gain.value = 1 - mix;
    }

    // === REVERB ===
    setReverbMix(track, mix) {
        const chain = this.trackEffects[track];
        if (!chain) return;
        chain.reverbWet.gain.value = mix;
        chain.reverbDry.gain.value = 1 - mix;
    }

    setReverbDecay(track, decay) {
        const chain = this.trackEffects[track];
        if (!chain) return;
        chain.reverbDecay = decay; // persist for getTrackParams() / export
        this.createReverbImpulse(chain.reverb, 2, decay);
    }

    // === CHORUS ===
    setChorusRate(track, rate) {
        const chain = this.trackEffects[track];
        if (!chain) return;
        chain.chorusLfo.frequency.value = Math.max(0.1, Math.min(10, rate));
    }

    setChorusDepth(track, depth) {
        const chain = this.trackEffects[track];
        if (!chain) return;
        chain.chorusLfoGain.gain.value = depth * 0.003;
    }

    setChorusMix(track, mix) {
        const chain = this.trackEffects[track];
        if (!chain) return;
        chain.chorusWet.gain.value = mix;
        chain.chorusDry.gain.value = 1 - mix;
    }

    // === BITCRUSHER ===
    setBitcrusherBits(track, bits) {
        const chain = this.trackEffects[track];
        if (!chain) return;
        chain.crusherBits = Math.max(1, Math.min(16, Math.round(bits)));
        // Update AudioWorklet param if available
        if (chain._isWorklet && chain.crusher?.parameters) {
            chain.crusher.parameters.get('bits').value = chain.crusherBits;
        }
        if (chain.crusherBits < 16 || chain.crusherRate < 1) {
            chain.crusherWet.gain.value = 1;
            chain.crusherDry.gain.value = 0;
        } else {
            chain.crusherWet.gain.value = 0;
            chain.crusherDry.gain.value = 1;
        }
    }

    setBitcrusherRate(track, rate) {
        const chain = this.trackEffects[track];
        if (!chain) return;
        chain.crusherRate = Math.max(0.01, Math.min(1, rate));
        // Update AudioWorklet param if available
        if (chain._isWorklet && chain.crusher?.parameters) {
            chain.crusher.parameters.get('rate').value = chain.crusherRate;
        }
        if (chain.crusherBits < 16 || chain.crusherRate < 1) {
            chain.crusherWet.gain.value = 1;
            chain.crusherDry.gain.value = 0;
        } else {
            chain.crusherWet.gain.value = 0;
            chain.crusherDry.gain.value = 1;
        }
    }

    // Obtenir les paramètres d'une piste
    getTrackParams(track) {
        const chain = this.trackEffects[track];
        if (!chain) return null;

        return {
            distortion: chain.distortionAmount ?? 0,
            delayTime: chain.delay.delayTime.value,
            delayFeedback: chain.delayFeedback.gain.value,
            delayMix: chain.delayWet.gain.value,
            reverbMix: chain.reverbWet.gain.value,
            reverbDecay: chain.reverbDecay ?? 0.5,
            chorusRate: chain.chorusLfo.frequency.value,
            chorusDepth: chain.chorusLfoGain.gain.value / 0.003,
            chorusMix: chain.chorusWet.gain.value,
            crushBits: chain.crusherBits,
            crushRate: chain.crusherRate
        };
    }

    /**
     * Apply a whole set of parameters at once.
     *
     * Three things need this: a preset, an instrument, and a project being
     * opened: and they were each spelling out the same eleven setters.
     *
     * @param {number} track
     * @param {object} params  any subset of DEFAULT_TRACK_FX
     */
    setTrackParams(track, params) {
        if (!params) return;
        const value = (key) => params[key] ?? DEFAULT_TRACK_FX[key];

        this.setDistortion(track, value('distortion'));
        this.setDelayTime(track, value('delayTime'));
        this.setDelayFeedback(track, value('delayFeedback'));
        this.setDelayMix(track, value('delayMix'));
        this.setReverbMix(track, value('reverbMix'));
        this.setReverbDecay(track, value('reverbDecay'));
        this.setChorusRate(track, value('chorusRate'));
        this.setChorusDepth(track, value('chorusDepth'));
        this.setChorusMix(track, value('chorusMix'));
        this.setBitcrusherBits(track, value('crushBits'));
        this.setBitcrusherRate(track, value('crushRate'));
    }

    // ── Persistence ──────────────────────────────────────────────────────

    /**
     * What every track's chain is set to. Part of the project file: an
     * instrument's effects are as much a part of how a track sounds as its
     * waveform is.
     *
     * @returns {Array<object>} one entry per track
     */
    serialize() {
        return Array.from(
            { length: TRACK_COUNT },
            (_unused, track) => this.getTrackParams(track) ?? { ...DEFAULT_TRACK_FX }
        );
    }

    /** @param {Array<object>|null} data */
    deserialize(data) {
        if (!Array.isArray(data)) return;

        for (let track = 0; track < TRACK_COUNT; track++) {
            this.setTrackParams(track, data[track] ?? { ...DEFAULT_TRACK_FX });
        }
    }

    /** What a chain looks like before anything has been done to it. */
    static defaultState() {
        return Array.from({ length: TRACK_COUNT }, () => ({ ...DEFAULT_TRACK_FX }));
    }

    // Appliquer des presets
    loadPreset(track, presetName) {
        const presets = {
            clean: {
                distortion: 0,
                delayTime: 0.25,
                delayFeedback: 0,
                delayMix: 0,
                reverbMix: 0,
                chorusRate: 1,
                chorusDepth: 0,
                chorusMix: 0,
                crushBits: 16,
                crushRate: 1
            },
            space: {
                distortion: 0,
                delayTime: 0.5,
                delayFeedback: 0.4,
                delayMix: 0.3,
                reverbMix: 0.5,
                chorusRate: 2,
                chorusDepth: 0.3,
                chorusMix: 0.2,
                crushBits: 16,
                crushRate: 1
            },
            echo: {
                distortion: 0,
                delayTime: 0.375,
                delayFeedback: 0.6,
                delayMix: 0.5,
                reverbMix: 0.2,
                chorusRate: 1,
                chorusDepth: 0,
                chorusMix: 0,
                crushBits: 16,
                crushRate: 1
            },
            dirty: {
                distortion: 0.7,
                delayTime: 0.25,
                delayFeedback: 0,
                delayMix: 0,
                reverbMix: 0.1,
                chorusRate: 1,
                chorusDepth: 0,
                chorusMix: 0,
                crushBits: 12,
                crushRate: 0.8
            },
            crush: {
                distortion: 1,
                delayTime: 0.1,
                delayFeedback: 0.5,
                delayMix: 0.3,
                reverbMix: 0,
                chorusRate: 1,
                chorusDepth: 0,
                chorusMix: 0,
                crushBits: 4,
                crushRate: 0.2
            }
        };

        const preset = presets[presetName];
        if (!preset) return false;

        this.setTrackParams(track, preset);
        return true;
    }
}
