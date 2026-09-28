/**
 * The effects graph, rebuilt for an offline render.
 *
 * The live chains belong to a running audio context and stay wired while the
 * studio is open. An export needs the same chains in a fresh
 * OfflineAudioContext, built from the current settings rather than moved.
 *
 * Each builder takes plain state: what `serialize()` or `getTrackParams()`
 * returns: and gives back `{ input, output }`, or null when nothing is
 * switched on and the signal should pass straight through.
 */

/** Impulse response length for a track reverb, in seconds. */
const TRACK_REVERB_SECONDS = 2;

/**
 * Per-track chain: distortion → chorus → delay → reverb → bitcrusher.
 *
 * @param {BaseAudioContext} context
 * @param {object|null} params  from TrackEffects.getTrackParams()
 * @param {object} [options]
 * @param {boolean} [options.workletReady]  the bitcrusher worklet is loaded
 * @returns {{input: AudioNode, output: AudioNode}|null}
 */
export function buildOfflineTrackFx(context, params, { workletReady = false } = {}) {
    if (!params) return null;

    const hasDistortion = params.distortion > 0;
    const hasChorus = params.chorusMix > 0;
    const hasDelay = params.delayMix > 0;
    const hasReverb = params.reverbMix > 0;
    const hasCrusher = params.crushBits < 16 || params.crushRate < 1;

    if (!hasDistortion && !hasChorus && !hasDelay && !hasReverb && !hasCrusher) return null;

    const input = context.createGain();
    input.gain.value = 1;
    let current = input;

    if (hasDistortion) {
        const shaper = context.createWaveShaper();
        shaper.curve = distortionCurve(params.distortion * 100);
        shaper.oversample = '4x';
        current.connect(shaper);
        current = shaper;
    }

    if (hasChorus) {
        const delay = context.createDelay(0.1);
        delay.delayTime.value = 0.005;

        const lfo = context.createOscillator();
        lfo.frequency.value = params.chorusRate;
        const lfoDepth = context.createGain();
        lfoDepth.gain.value = params.chorusDepth * 0.003;
        lfo.connect(lfoDepth);
        lfoDepth.connect(delay.delayTime);
        lfo.start(0);

        current = crossfade(context, current, delay, params.chorusMix);
    }

    if (hasDelay) {
        const delay = context.createDelay(2);
        delay.delayTime.value = params.delayTime;
        const feedback = context.createGain();
        feedback.gain.value = Math.min(0.9, params.delayFeedback);
        delay.connect(feedback);
        feedback.connect(delay);

        current = crossfade(context, current, delay, params.delayMix);
    }

    if (hasReverb) {
        const convolver = context.createConvolver();
        convolver.buffer = reverbImpulse(context, TRACK_REVERB_SECONDS, params.reverbDecay || 0.5);
        current = crossfade(context, current, convolver, params.reverbMix);
    }

    if (hasCrusher) {
        current = appendBitcrusher(context, current, params, workletReady);
    }

    return { input, output: current };
}

/**
 * Master chain: filter as an insert, then chorus, delay and reverb as
 * dry/wet crossfades.
 *
 * @param {BaseAudioContext} context
 * @param {object|null} state  from MasterFx.serialize()
 * @param {object} [options]
 * @param {number} [options.reverbDecay]  overrides the stored decay
 * @returns {{input: AudioNode, output: AudioNode, nodes: object}|null}
 */
export function buildOfflineMasterFx(context, state, { reverbDecay = null } = {}) {
    if (!state) return null;

    const { filter, effects } = state;
    if (
        !filter.enabled &&
        !effects.chorus.enabled &&
        !effects.delay.enabled &&
        !effects.reverb.enabled
    ) {
        return null;
    }

    const nodes = {};
    const input = context.createGain();
    input.gain.value = 1;
    let current = input;

    if (filter.enabled) {
        nodes.filter = context.createBiquadFilter();
        nodes.filter.type = filter.type;
        nodes.filter.frequency.value = filter.frequency;
        nodes.filter.Q.value = filter.q;
        current.connect(nodes.filter);
        current = nodes.filter;
    }

    const insertOut = context.createGain();
    current.connect(insertOut);
    nodes.insertOut = insertOut;
    current = insertOut;

    if (effects.chorus.enabled) {
        const delay = context.createDelay(0.05);
        delay.delayTime.value = 0.005;

        nodes.chorusLfo = context.createOscillator();
        nodes.chorusLfo.frequency.value = effects.chorus.rate;
        const lfoDepth = context.createGain();
        lfoDepth.gain.value = 0.001 + (effects.chorus.rate / 10) * 0.003;
        nodes.chorusLfo.connect(lfoDepth);
        lfoDepth.connect(delay.delayTime);
        nodes.chorusLfo.start(0);

        const mix = crossfade(context, current, delay, effects.chorus.mix);
        nodes.chorusWet = mix.wet;
        current = mix;
    }

    if (effects.delay.enabled) {
        nodes.delay = context.createDelay(2);
        nodes.delay.delayTime.value = effects.delay.time;
        nodes.delayFeedback = context.createGain();
        nodes.delayFeedback.gain.value = effects.delay.feedback;
        nodes.delay.connect(nodes.delayFeedback);
        nodes.delayFeedback.connect(nodes.delay);

        const mix = crossfade(context, current, nodes.delay, effects.delay.mix);
        nodes.delayWet = mix.wet;
        current = mix;
    }

    if (effects.reverb.enabled) {
        const convolver = context.createConvolver();
        // A decay lane starts the song somewhere: render the tail it starts on.
        const decay = reverbDecay ?? effects.reverb.decay;
        convolver.buffer = reverbImpulse(context, Math.max(0.2, decay * 3), decay * 2);

        const mix = crossfade(context, current, convolver, effects.reverb.mix);
        nodes.reverbWet = mix.wet;
        current = mix;
    }

    return { input, output: current, nodes };
}

/**
 * Mastering chain: the five EQ bands in series, then the compressor and its
 * makeup gain. Stages that are off are left out entirely.
 *
 * @param {BaseAudioContext} context
 * @param {object|null} state  from MasteringEngine.serialize(), plus `bypassed`
 * @returns {{input: AudioNode, output: AudioNode, eqBands: AudioNode[], compressor: AudioNode|null, makeupGain: AudioNode|null}|null}
 */
export function buildOfflineMastering(context, state) {
    if (!state || state.bypassed) return null;

    const input = context.createGain();
    input.gain.value = 1;
    let current = input;

    const eqBands = [];
    if (state.eq?.enabled) {
        for (const band of state.eq.bands) {
            const filter = context.createBiquadFilter();
            filter.type = band.type;
            filter.frequency.value = band.freq;
            filter.gain.value = band.gain;
            filter.Q.value = band.q;
            current.connect(filter);
            current = filter;
            eqBands.push(filter);
        }
    }

    let compressor = null;
    let makeupGain = null;
    if (state.compressor?.enabled) {
        compressor = context.createDynamicsCompressor();
        compressor.threshold.value = state.compressor.threshold;
        compressor.ratio.value = state.compressor.ratio;
        compressor.attack.value = state.compressor.attack;
        compressor.release.value = state.compressor.release;
        compressor.knee.value = 6;
        current.connect(compressor);

        makeupGain = context.createGain();
        makeupGain.gain.value = Math.pow(10, (state.compressor.makeupGain || 0) / 20);
        compressor.connect(makeupGain);
        current = makeupGain;
    }

    return { input, output: current, eqBands, compressor, makeupGain };
}

/**
 * One channel strip: fader → pan → three EQ bands → optional compressor.
 *
 * @param {BaseAudioContext} context
 * @param {object} settings  one entry of AudioEngine.mixerSettings
 * @param {AudioNode} destination
 * @returns {{gain: AudioNode, pan: AudioNode, eqLow: AudioNode, eqMid: AudioNode, eqHigh: AudioNode, compressor: AudioNode|null}}
 */
export function buildOfflineChannelStrip(context, settings, destination) {
    const strip = {};

    strip.gain = context.createGain();
    strip.gain.gain.value = settings.volume;

    strip.pan = context.createStereoPanner();
    strip.pan.pan.value = settings.pan;

    strip.eqLow = shelf(context, 'lowshelf', 320, settings.eqLow);
    strip.eqMid = context.createBiquadFilter();
    strip.eqMid.type = 'peaking';
    strip.eqMid.frequency.value = 1000;
    strip.eqMid.Q.value = 0.7;
    strip.eqMid.gain.value = settings.eqMid;
    strip.eqHigh = shelf(context, 'highshelf', 3200, settings.eqHigh);

    strip.gain.connect(strip.pan);
    strip.pan.connect(strip.eqLow);
    strip.eqLow.connect(strip.eqMid);
    strip.eqMid.connect(strip.eqHigh);

    strip.compressor = null;
    if (settings.compressor?.enabled) {
        strip.compressor = context.createDynamicsCompressor();
        strip.compressor.threshold.value = settings.compressor.threshold ?? -24;
        strip.compressor.ratio.value = settings.compressor.ratio ?? 4;
        strip.compressor.attack.value = settings.compressor.attack ?? 0.003;
        strip.compressor.release.value = settings.compressor.release ?? 0.25;
        strip.compressor.knee.value = 6;
        strip.eqHigh.connect(strip.compressor);
        strip.compressor.connect(destination);
    } else {
        strip.eqHigh.connect(destination);
    }

    return strip;
}

/** The brick-wall limiter that ends the chain, as in playback. */
export function buildOfflineLimiter(context) {
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -3; // start limiting below clipping
    limiter.knee.value = 0; // hard knee: a limiter, not a compressor
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.01;
    return limiter;
}

/** Noise decaying over time: a plausible reverb tail without an IR file. */
export function reverbImpulse(context, seconds, decay) {
    const length = Math.floor(context.sampleRate * seconds);
    const buffer = context.createBuffer(2, length, context.sampleRate);

    for (let channel = 0; channel < 2; channel++) {
        const samples = buffer.getChannelData(channel);
        for (let i = 0; i < length; i++) {
            samples[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
        }
    }
    return buffer;
}

/** The waveshaper curve used for distortion, as in the live chain. */
export function distortionCurve(amount) {
    const samples = 44100;
    const curve = new Float32Array(samples);
    const degrees = Math.PI / 180;

    for (let i = 0; i < samples; i++) {
        const x = (i * 2) / samples - 1;
        curve[i] = ((3 + amount) * x * 20 * degrees) / (Math.PI + amount * Math.abs(x));
    }
    return curve;
}

/**
 * Split a signal into a dry path and a path through `effect`, and merge them.
 * The merge node is returned with `wet` on it, for automation to reach.
 */
function crossfade(context, source, effect, mix) {
    const wet = context.createGain();
    wet.gain.value = mix;
    const dry = context.createGain();
    dry.gain.value = 1 - mix;
    const merge = context.createGain();

    source.connect(effect);
    effect.connect(wet);
    wet.connect(merge);
    source.connect(dry);
    dry.connect(merge);

    merge.wet = wet;
    merge.dry = dry;
    return merge;
}

function shelf(context, type, frequency, gain) {
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.gain.value = gain;
    return filter;
}

/**
 * The bitcrusher, as a worklet when one is loaded. The fallback quantises
 * with a waveshaper: it reproduces the bit depth but not the sample-rate
 * reduction, which needs a processor.
 */
function appendBitcrusher(context, current, params, workletReady) {
    if (workletReady) {
        try {
            const crusher = new AudioWorkletNode(context, 'bitcrusher-processor');
            crusher.parameters.get('bits').value = params.crushBits;
            crusher.parameters.get('rate').value = params.crushRate;
            current.connect(crusher);
            return crusher;
        } catch {
            // fall through to the waveshaper
        }
    }

    const bits = Math.max(1, Math.min(15, Math.round(params.crushBits)));
    const step = Math.pow(0.5, bits - 1);
    const length = 65536;
    const curve = new Float32Array(length);
    for (let i = 0; i < length; i++) {
        const x = (i * 2) / length - 1;
        curve[i] = Math.round(x / step) * step;
    }

    const crusher = context.createWaveShaper();
    crusher.curve = curve;
    current.connect(crusher);
    return crusher;
}
