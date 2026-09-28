/**
 * Offline rendering.
 *
 * Plays the song into an OfflineAudioContext, which runs as fast as the
 * machine allows rather than in real time, and hands back the audio buffer
 * every encoder starts from.
 *
 * The graph mirrors playback exactly:
 *
 *   note → [track FX] → channel strip → master gain
 *        → [master FX] → [mastering] → limiter → destination
 *
 * Anything switched off is left out of the graph rather than set to a neutral
 * value, so an empty project renders through three nodes.
 */

import { createOfflineNote } from './offline-note.js';
import {
    buildOfflineChannelStrip,
    buildOfflineLimiter,
    buildOfflineMasterFx,
    buildOfflineMastering,
    buildOfflineTrackFx
} from './offline-graph.js';
import { normalizeBuffer } from './wav.js';
import {
    scheduleFxAutomation,
    scheduleMixerAutomation,
    startingReverbDecay,
    willBeAutomated
} from './offline-automation.js';

const TRACK_COUNT = 8;

/** Seconds of silence kept after the last note, for release tails to finish. */
const DEFAULT_TAIL_SECONDS = 1;

/** Where the bitcrusher worklet lives, resolved by the bundler. */
const WORKLET_URL = new URL('../audio/worklets/bitcrusher.js', import.meta.url);

/**
 * @typedef {object} RenderSources
 * @property {import('../audio/audio-engine.js').AudioEngine} audioEngine
 * @property {import('../sequencer/sequencer.js').Sequencer} sequencer
 * @property {object|null} [masterFx]
 * @property {object|null} [mastering]
 * @property {object|null} [trackEffects]
 * @property {object|null} [fxAutomation]
 * @property {object|null} [mixerAutomation]
 */

/**
 * @param {RenderSources} sources
 * @param {object} [options]
 * @param {Array<number|null>} [options.patterns]  pattern order; null is a silent measure
 * @param {number[]|null} [options.tracks]         a subset, for stems; null renders the mix
 * @param {number} [options.sampleRate]
 * @param {boolean} [options.normalize]
 * @param {boolean} [options.loopReady]            cut at the loop point, no release tail
 * @param {(progress: number) => void} [options.onProgress]
 * @param {(channels: number, length: number, sampleRate: number) => BaseAudioContext} [options.createContext]
 * @returns {Promise<AudioBuffer>}
 */
export async function renderSong(sources, options = {}) {
    const {
        audioEngine,
        sequencer,
        masterFx = null,
        mastering = null,
        trackEffects = null,
        fxAutomation = null,
        mixerAutomation = null
    } = sources;

    const {
        patterns = [sequencer.currentPattern],
        tracks = null,
        sampleRate = 44100,
        normalize = true,
        loopReady = false,
        onProgress = null,
        createContext = defaultContextFactory
    } = options;

    const steps = sequencer.steps;
    const stepDuration = 60 / sequencer.bpm / 4;
    // As in playback: a note runs a little past its step, and the envelope
    // takes care of the overlap.
    const noteDuration = (60 / sequencer.bpm) * 0.9;
    const patternDuration = steps * stepDuration;
    const swing = Math.min(1, Math.max(0, sequencer.swing || 0));

    // Trailing silent measures would only add silence to the file.
    let measureCount = patterns.length;
    while (measureCount > 0 && patterns[measureCount - 1] == null) measureCount--;

    const duration = Math.max(patternDuration, measureCount * patternDuration);
    const tail = loopReady ? 0 : DEFAULT_TAIL_SECONDS;
    const context = createContext(2, Math.ceil(sampleRate * (duration + tail)), sampleRate);

    const workletReady = await loadBitcrusherWorklet(context);

    // ── Master bus ───────────────────────────────────────────────────────
    const masterGain = context.createGain();
    masterGain.gain.value = audioEngine.getMasterVolume();

    const limiter = buildOfflineLimiter(context);
    const masterFxChain = buildOfflineMasterFx(context, masterFx?.serialize?.() ?? null, {
        // An impulse response cannot be ramped, so a decay lane decides
        // which tail the whole render is built on: the one it starts on.
        reverbDecay: startingReverbDecay(fxAutomation)
    });
    const masteringChain = buildOfflineMastering(
        context,
        mastering ? { ...mastering.serialize(), bypassed: mastering.bypassed } : null
    );

    let masterOut = masterGain;
    if (masterFxChain) {
        masterGain.connect(masterFxChain.input);
        masterOut = masterFxChain.output;
    }
    if (masteringChain) {
        masterOut.connect(masteringChain.input);
        masterOut = masteringChain.output;
    }
    masterOut.connect(limiter);
    limiter.connect(context.destination);

    // ── Wheels, as constant sources every voice can read ─────────────────
    // A wheel at rest needs no node, unless a lane is about to move it.
    const pitchBendNode = createConstant(
        context,
        (masterFx?.pitchBend || 0) * 200,
        willBeAutomated(fxAutomation, 'pitchBend')
    );
    const modulationNode = createConstant(
        context,
        (masterFx?.modulation || 0) * 15,
        willBeAutomated(fxAutomation, 'modulation')
    );

    // ── Channel strips and track FX ──────────────────────────────────────
    const strips = [];
    const trackFxChains = [];
    for (let track = 0; track < TRACK_COUNT; track++) {
        const strip = buildOfflineChannelStrip(
            context,
            audioEngine.mixerSettings[track],
            masterGain
        );
        strips.push(strip);

        const chain = buildOfflineTrackFx(context, trackEffects?.getTrackParams?.(track) ?? null, {
            workletReady
        });
        if (chain) chain.output.connect(strip.gain);
        trackFxChains.push(chain);
    }

    // ── Notes ────────────────────────────────────────────────────────────
    const activeTracks = tracks || [0, 1, 2, 3, 4, 5, 6, 7];
    const globalFilter = audioEngine.effects?.filter ?? null;
    // One wave table per shape for the whole render, the way the live engine
    // keeps one for the whole session: a four-minute song is thousands of
    // notes, and they are playing a handful of shapes between them.
    const waveCache = new Map();

    patterns.forEach((patternIndex, measure) => {
        if (patternIndex == null) return; // a silent measure takes its time and no more

        const pattern = sequencer.patterns[patternIndex];
        if (!pattern) return;

        const measureStart = measure * patternDuration;

        for (let step = 0; step < steps; step++) {
            // Swing delays the off-beats, as the scheduler does in playback.
            const swingDelay = step % 2 === 1 ? swing * stepDuration * 0.5 : 0;
            const startTime = measureStart + step * stepDuration + swingDelay;

            for (const track of activeTracks) {
                const cell = pattern[track][step];
                if (!cell) continue;

                // A stem is asked for by name and renders whatever it holds;
                // a full mix honours the solo and mute of that pattern.
                if (tracks === null && !sequencer.isTrackAudible(track, patternIndex)) continue;

                createOfflineNote(context, trackFxChains[track]?.input ?? strips[track].gain, {
                    note: cell,
                    trackConfig: audioEngine.tracks[track],
                    envelope: audioEngine.envelopes[track],
                    vibrato: audioEngine.vibrato[track],
                    startTime,
                    duration: noteDuration,
                    pitchBendNode,
                    modulationNode,
                    globalFilter,
                    waveCache
                });
            }
        }
    });

    // ── The envelopes ────────────────────────────────────────────────────
    // Booked after the graph exists and before it runs: an offline render
    // has no sequencer to write them one step at a time.
    scheduleFxAutomation(
        { masterFxChain, pitchBendNode, modulationNode },
        fxAutomation,
        stepDuration
    );
    scheduleMixerAutomation(strips, masterGain, mixerAutomation, stepDuration);

    // OfflineAudioContext reports no progress of its own, so the caller is
    // told the render started and told again when the buffer comes back.
    onProgress?.(0);
    const buffer = await context.startRendering();
    onProgress?.(100);

    if (normalize) normalizeBuffer(buffer);
    return buffer;
}

/**
 * Render one track on its own, for stems. Solo and mute are ignored: asking
 * for a stem is asking for that track.
 */
export function renderStem(sources, trackIndex, options = {}) {
    return renderSong(sources, { ...options, tracks: [trackIndex] });
}

/** Total length of a render, in seconds, before the tail. */
export function estimateDuration(sequencer, patternCount) {
    const patternDuration = (sequencer.steps * (60 / sequencer.bpm)) / 4;
    return Math.max(patternDuration, patternCount * patternDuration);
}

async function loadBitcrusherWorklet(context) {
    if (typeof context.audioWorklet === 'undefined') return false;
    try {
        await context.audioWorklet.addModule(WORKLET_URL);
        return true;
    } catch {
        // No worklet offline: the bitcrusher falls back to a waveshaper.
        return false;
    }
}

/** A constant source the voices read, or null when the wheel is at rest. */
function createConstant(context, value, force = false) {
    if (!value && !force) return null;
    const node = context.createConstantSource();
    node.offset.value = value;
    node.start(0);
    return node;
}

function defaultContextFactory(channels, length, sampleRate) {
    const Ctor = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
    if (!Ctor) throw new Error('OfflineAudioContext is not available in this runtime');
    return new Ctor(channels, length, sampleRate);
}
