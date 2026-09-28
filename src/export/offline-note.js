/**
 * One note, rendered offline.
 *
 * The live engine builds its voices against the clock, starting them "now".
 * An export builds the same voices into an OfflineAudioContext with every
 * event placed at an absolute time, so a four-minute track renders in a few
 * seconds and sounds exactly like playback.
 *
 * What a voice is made of, in order:
 *
 *   oscillators (or noise) → unison gain → ADSR gain → [track filter]
 *   → [LFO filter] → [global filter] → [track FX] → channel strip
 *
 * Every optional stage is built only when its parameters ask for it, which
 * keeps a plain square wave down to three nodes.
 */

import { AudioEngine, filterEnvelope } from '../audio/audio-engine.js';
import { setOscillatorWave } from '../audio/waveforms.js';

/** Middle C, the reference for filter key tracking. */
const KEY_TRACK_BASE_FREQUENCY = 261.63;

/** A voice is kept alive a moment past its release, to avoid a click. */
const STOP_MARGIN = 0.1;

/**
 * @param {BaseAudioContext} context
 * @param {AudioNode} destination  the channel strip input, or a track FX input
 * @param {object} options
 * @param {{note: string, octave: number}} options.note
 * @param {object} options.trackConfig  the engine's track settings
 * @param {{attack: number, decay: number, sustain: number, release: number}} options.envelope
 * @param {{rate: number, depth: number}} options.vibrato
 * @param {number} options.startTime    seconds into the render
 * @param {number} options.duration     seconds until the release starts
 * @param {{input: AudioNode, output: AudioNode}|null} [options.trackFxChain]
 * @param {AudioNode|null} [options.pitchBendNode]   constant source, in cents
 * @param {AudioNode|null} [options.modulationNode]  constant source, in hertz
 * @param {object|null} [options.globalFilter]       the engine's master filter settings
 * @param {Map<string, PeriodicWave>|null} [options.waveCache]  shared across a render
 */
export function createOfflineNote(context, destination, options) {
    const {
        note,
        trackConfig,
        envelope,
        vibrato,
        startTime,
        duration,
        trackFxChain = null,
        pitchBendNode = null,
        modulationNode = null,
        globalFilter = null,
        waveCache = null
    } = options;

    const frequency = voiceFrequency(note, trackConfig);
    const releaseTime = envelope.release || 0.1;
    const releaseEnd = startTime + duration + releaseTime;
    const stopTime = releaseEnd + STOP_MARGIN;

    const voiceCount = trackConfig.unisonVoices || 1;
    const unisonGain = context.createGain();
    // Equal-power sum: doubling the voices should not double the level.
    unisonGain.gain.value = 1 / Math.sqrt(voiceCount);

    const sources =
        trackConfig.type === 'noise'
            ? [createNoiseSource(context, unisonGain, duration + releaseTime + STOP_MARGIN)]
            : createOscillators(context, unisonGain, {
                  frequency,
                  trackConfig,
                  envelope,
                  startTime,
                  stopTime,
                  vibrato,
                  modulationNode,
                  voiceCount,
                  waveCache
              });

    if (pitchBendNode) {
        for (const source of sources) {
            if (source.detune) pitchBendNode.connect(source.detune);
        }
    }

    const gainNode = context.createGain();
    gainNode.gain.value = 0;
    unisonGain.connect(gainNode);
    applyEnvelope(gainNode.gain, {
        envelope,
        volume: trackConfig.volume,
        startTime,
        duration,
        releaseEnd
    });

    if (trackConfig.tremoloRate > 0 && trackConfig.tremoloDepth > 0) {
        applyTremolo(context, gainNode.gain, trackConfig, startTime, stopTime);
    }

    let output = gainNode;
    output = applyTrackFilter(context, output, {
        trackConfig,
        frequency,
        startTime,
        duration,
        stopTime
    });
    output = applyLfoFilter(context, output, { trackConfig, startTime, stopTime });

    if (globalFilter?.enabled) {
        const filter = context.createBiquadFilter();
        filter.type = globalFilter.type || 'lowpass';
        filter.frequency.value = globalFilter.frequency || 1000;
        filter.Q.value = globalFilter.q || 1;
        output.connect(filter);
        output = filter;
    }

    if (trackFxChain) {
        output.connect(trackFxChain.input);
        output = trackFxChain.output;
    }

    output.connect(destination);

    for (const source of sources) {
        source.start(startTime);
        source.stop(stopTime);
    }

    return { sources, gainNode, output };
}

/** Detune, octave and semitone offsets applied to the written note. */
function voiceFrequency(note, trackConfig) {
    let frequency = AudioEngine.noteToFrequency(note.note, note.octave);
    frequency *= Math.pow(2, (trackConfig.detune || 0) / 1200);
    frequency *= Math.pow(2, trackConfig.octaveOffset || 0);
    frequency *= Math.pow(2, (trackConfig.semitoneOffset || 0) / 12);
    return frequency;
}

/**
 * Noise is a one-shot buffer of the exact length needed, filtered the way the
 * live engine filters its shared buffer.
 */
function createNoiseSource(context, destination, length) {
    const sampleCount = Math.ceil(context.sampleRate * length);
    const buffer = context.createBuffer(1, sampleCount, context.sampleRate);
    const samples = buffer.getChannelData(0);

    for (let i = 0; i < sampleCount; i++) samples[i] = (Math.random() * 2 - 1) * 0.6;
    // A gentle one-pole low pass: white noise alone is harsher than a chip's.
    for (let i = 1; i < sampleCount; i++) samples[i] = samples[i] * 0.8 + samples[i - 1] * 0.2;

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(destination);
    return source;
}

function createOscillators(context, destination, params) {
    const {
        frequency,
        trackConfig,
        envelope,
        startTime,
        stopTime,
        vibrato,
        modulationNode,
        voiceCount,
        waveCache
    } = params;
    const oscillators = [];

    for (let voice = 0; voice < voiceCount; voice++) {
        // Voices spread evenly from -1 to +1, a single voice sitting centre.
        const position = voiceCount === 1 ? 0 : (voice / (voiceCount - 1)) * 2 - 1;
        const voiceFreq =
            frequency * Math.pow(2, (position * (trackConfig.unisonDetune || 0)) / 1200);

        const oscillator = context.createOscillator();
        setOscillatorWave(
            context,
            oscillator,
            {
                type: trackConfig.type,
                dutyCycle: trackConfig.dutyCycle || 0.5,
                phase: trackConfig.phase || 0
            },
            waveCache
        );
        oscillator.frequency.value = voiceFreq;

        applyPitchEnvelope(oscillator, { trackConfig, envelope, voiceFreq, startTime });

        if (voiceCount > 1 && position !== 0) {
            const panner = context.createStereoPanner();
            panner.pan.value = position * ((trackConfig.unisonSpread || 0) / 100);
            oscillator.connect(panner);
            panner.connect(destination);
        } else {
            oscillator.connect(destination);
        }
        oscillators.push(oscillator);
    }

    const hasVibrato = vibrato && vibrato.rate > 0 && vibrato.depth > 0;
    if (hasVibrato || modulationNode) {
        applyVibrato(context, oscillators, {
            trackConfig,
            vibrato,
            hasVibrato,
            modulationNode,
            startTime,
            stopTime
        });
    }

    return oscillators;
}

/**
 * The pitch envelope sweeps from an offset back to the written pitch: this
 * is what gives the kick its thump. Glide only applies when there is none.
 */
function applyPitchEnvelope(oscillator, { trackConfig, envelope, voiceFreq, startTime }) {
    if (trackConfig.pitchEnv) {
        const from = voiceFreq * Math.pow(2, trackConfig.pitchEnv / 12);
        const sweep = (envelope.attack || 0.01) + (envelope.decay || 0.1) * 0.5;
        oscillator.frequency.setValueAtTime(from, startTime);
        oscillator.frequency.exponentialRampToValueAtTime(
            Math.max(20, voiceFreq),
            startTime + Math.max(0.001, sweep)
        );
    } else if (trackConfig.glide > 0) {
        oscillator.frequency.setValueAtTime(voiceFreq * 0.8, startTime);
        oscillator.frequency.exponentialRampToValueAtTime(
            voiceFreq,
            startTime + Math.max(0.001, trackConfig.glide * 0.2)
        );
    }
}

function applyVibrato(context, oscillators, params) {
    const { trackConfig, vibrato, hasVibrato, modulationNode, startTime, stopTime } = params;

    const lfo = context.createOscillator();
    lfo.type = trackConfig.lfo1Wave || 'sine';
    lfo.frequency.value = hasVibrato ? vibrato.rate : 5; // a usable rate for the wheel alone

    const depth = context.createGain();
    if (modulationNode) {
        // The modulation wheel drives the depth, as it does in playback.
        depth.gain.value = 0;
        modulationNode.connect(depth.gain);
    } else if ((trackConfig.lfo1Delay || 0) > 0) {
        depth.gain.setValueAtTime(0, startTime);
        depth.gain.linearRampToValueAtTime(vibrato.depth, startTime + trackConfig.lfo1Delay);
    } else {
        depth.gain.value = vibrato.depth;
    }

    lfo.connect(depth);
    for (const oscillator of oscillators) depth.connect(oscillator.frequency);
    lfo.start(startTime);
    lfo.stop(stopTime);
}

function applyEnvelope(gain, { envelope, volume, startTime, duration, releaseEnd }) {
    const attack = envelope.attack || 0.01;
    const decay = envelope.decay || 0.1;
    const sustain = (envelope.sustain ?? 0.5) * volume;

    gain.setValueAtTime(0, startTime);
    gain.linearRampToValueAtTime(volume, startTime + attack);
    gain.linearRampToValueAtTime(sustain, startTime + attack + decay);
    gain.setValueAtTime(sustain, startTime + duration);
    gain.linearRampToValueAtTime(0, releaseEnd);
}

function applyTremolo(context, gain, trackConfig, startTime, stopTime) {
    const lfo = context.createOscillator();
    lfo.type = trackConfig.lfo3Wave || 'sine';
    lfo.frequency.value = trackConfig.tremoloRate;

    const depth = context.createGain();
    const target = (trackConfig.tremoloDepth / 100) * 0.5;
    if ((trackConfig.lfo3Delay || 0) > 0) {
        depth.gain.setValueAtTime(0, startTime);
        depth.gain.linearRampToValueAtTime(target, startTime + trackConfig.lfo3Delay);
    } else {
        depth.gain.value = target;
    }

    lfo.connect(depth);
    depth.connect(gain);
    lfo.start(startTime);
    lfo.stop(stopTime);
}

/** @returns {AudioNode} the new end of the chain */
function applyTrackFilter(
    context,
    input,
    { trackConfig, frequency, startTime, duration, stopTime }
) {
    // A cutoff at the top of the range is no filter at all; skip the node.
    if (!trackConfig.filterEnabled || trackConfig.filterCutoff >= 19999) return input;

    const filter = context.createBiquadFilter();
    filter.type = trackConfig.filterType || 'lowpass';
    filter.Q.value = trackConfig.filterQ || 0.1;

    let cutoff = trackConfig.filterCutoff;
    if ((trackConfig.filterKeyTrack || 0) > 0) {
        // Key tracking moves the cutoff with the note, so high notes stay bright.
        const amount = trackConfig.filterKeyTrack / 100;
        const octaves = Math.log2(frequency / KEY_TRACK_BASE_FREQUENCY) * amount;
        cutoff = Math.max(20, Math.min(20000, cutoff * Math.pow(2, octaves)));
    }
    filter.frequency.value = cutoff;

    input.connect(filter);

    if (trackConfig.filterLfoRate > 0 && trackConfig.filterLfoDepth > 0) {
        const lfo = context.createOscillator();
        lfo.type = trackConfig.lfo2Wave || 'sine';
        lfo.frequency.value = trackConfig.filterLfoRate;

        const depth = context.createGain();
        const target = (trackConfig.filterLfoDepth / 100) * trackConfig.filterCutoff * 0.5;
        if ((trackConfig.lfo2Delay || 0) > 0) {
            depth.gain.setValueAtTime(0, startTime);
            depth.gain.linearRampToValueAtTime(target, startTime + trackConfig.lfo2Delay);
        } else {
            depth.gain.value = target;
        }

        lfo.connect(depth);
        depth.connect(filter.frequency);
        lfo.start(startTime);
        lfo.stop(stopTime);
    }

    const envelope = filterEnvelope(trackConfig, cutoff);
    if (envelope) {
        // Open, hold for the length of the note, close again. A note shorter
        // than its own attack closes as soon as it has finished opening,
        // which keeps the two ramps in the order they were scheduled.
        const closeFrom = Math.max(startTime + envelope.attack, startTime + duration);
        filter.frequency.setValueAtTime(envelope.base, startTime);
        filter.frequency.exponentialRampToValueAtTime(envelope.peak, startTime + envelope.attack);
        filter.frequency.setValueAtTime(envelope.peak, closeFrom);
        filter.frequency.exponentialRampToValueAtTime(envelope.base, closeFrom + envelope.release);
    }

    return filter;
}

/**
 * The LFO section can sweep a filter of its own, but only when the track
 * filter is not already there to be swept.
 */
function applyLfoFilter(context, input, { trackConfig, startTime, stopTime }) {
    const wanted = trackConfig.lfoFilterRate > 0 && trackConfig.lfoFilterDepth > 0;
    const trackFilterPresent = trackConfig.filterEnabled && trackConfig.filterCutoff < 19999;
    if (!wanted || trackFilterPresent) return input;

    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 10000;
    filter.Q.value = 2;
    input.connect(filter);

    const lfo = context.createOscillator();
    lfo.type = trackConfig.lfo2Wave || 'sine';
    lfo.frequency.value = trackConfig.lfoFilterRate;

    const depth = context.createGain();
    depth.gain.value = (trackConfig.lfoFilterDepth / 100) * 5000;
    lfo.connect(depth);
    depth.connect(filter.frequency);
    lfo.start(startTime);
    lfo.stop(stopTime);

    return filter;
}
