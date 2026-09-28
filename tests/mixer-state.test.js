/**
 * What you hear after opening a project.
 *
 * The mixer is kept twice over: once as a record on the engine, and once
 * as values on eight channel strips of audio nodes. Every setter writes
 * both, which is right for a control being moved: and left one case
 * with no owner. Opening a project replaces the whole record, and a
 * replacement is not a control being moved, so nothing reached the
 * graph: the faders, pans, EQ and compressors you heard afterwards were
 * the previous project's, while the mixer on screen showed the new one's.
 * Nothing said so. It is the kind of fault you blame on your ears.
 *
 * So these are about the two staying in step, from all four directions
 * they can fall out of it: a load, a load before the audio exists, a
 * reset, and a compressor that is off.
 */

import { describe, it, expect } from 'vitest';
import { AudioEngine } from '../src/audio/audio-engine.js';
import { Studio } from '../src/studio.js';
import { EventBus } from '../src/core/event-bus.js';
import { FakeAudioContext } from './helpers/fake-audio-context.js';

function makeStudio() {
    const context = new FakeAudioContext();
    return {
        context,
        studio: new Studio({ bus: new EventBus(), createContext: () => context })
    };
}

/** What the audio graph actually has on one strip. */
function onTheGraph(engine, track) {
    const strip = engine.channelStrips[track];
    return {
        volume: strip.gain.gain.value,
        pan: strip.pan.pan.value,
        eqLow: strip.eqLow.gain.value,
        eqMid: strip.eqMid.gain.value,
        eqHigh: strip.eqHigh.gain.value,
        threshold: strip.compressor.threshold.value,
        ratio: strip.compressor.ratio.value,
        attack: strip.compressor.attack.value,
        release: strip.compressor.release.value
    };
}

/** A mixer with one strip pushed well away from unity. */
function mixerWithATrackMoved(track = 3) {
    const settings = AudioEngine.defaultMixerSettings();
    Object.assign(settings[track], {
        volume: 0.42,
        pan: -0.75,
        eqLow: 6,
        eqMid: -3,
        eqHigh: 9
    });
    Object.assign(settings[track].compressor, {
        enabled: true,
        threshold: -18,
        ratio: 8,
        attack: 0.01,
        release: 0.4
    });
    return settings;
}

describe('opening a project', () => {
    it('puts the saved mixer on the audio graph', async () => {
        const { studio } = makeStudio();
        await studio.start();

        const state = studio.getProjectState();
        state.mixerSettings = mixerWithATrackMoved();
        studio.applyProjectState(state);

        expect(onTheGraph(studio.audioEngine, 3)).toEqual({
            volume: 0.42,
            pan: -0.75,
            eqLow: 6,
            eqMid: -3,
            eqHigh: 9,
            threshold: -18,
            ratio: 8,
            attack: 0.01,
            release: 0.4
        });
    });

    it('does not leave the previous project on the faders', async () => {
        const { studio } = makeStudio();
        await studio.start();

        const loud = studio.getProjectState();
        loud.mixerSettings = mixerWithATrackMoved();
        studio.applyProjectState(loud);
        // Without this the test passes for the wrong reason: a graph that
        // was never written is already at unity.
        expect(onTheGraph(studio.audioEngine, 3).volume).toBe(0.42);

        const plain = studio.getProjectState();
        plain.mixerSettings = AudioEngine.defaultMixerSettings();
        studio.applyProjectState(plain);

        expect(onTheGraph(studio.audioEngine, 3)).toMatchObject({
            volume: 1,
            pan: 0,
            eqLow: 0,
            eqHigh: 0
        });
    });

    it('treats a project with no mixer as a mixer at unity', async () => {
        const { studio } = makeStudio();
        await studio.start();

        const loud = studio.getProjectState();
        loud.mixerSettings = mixerWithATrackMoved();
        studio.applyProjectState(loud);
        expect(onTheGraph(studio.audioEngine, 3).volume).toBe(0.42);

        // A payload from a build that did not write one, or a hand-made
        // file. Keeping the last project's mixer would be the quietest
        // possible way of hearing the wrong thing.
        const bare = studio.getProjectState();
        delete bare.mixerSettings;
        studio.applyProjectState(bare);

        expect(studio.audioEngine.mixerSettings[3].volume).toBe(1);
        expect(onTheGraph(studio.audioEngine, 3).volume).toBe(1);
    });

    it('is heard even when the project was opened before the audio started', async () => {
        // The usual order, in fact: a browser gives no audio context
        // until the user has done something, and opening a file is not
        // enough. The strips are built at the first press of Play.
        const { studio } = makeStudio();

        const state = studio.getProjectState();
        state.mixerSettings = mixerWithATrackMoved();
        studio.applyProjectState(state);
        expect(studio.audioEngine.channelStrips).toHaveLength(0);

        await studio.start();

        expect(onTheGraph(studio.audioEngine, 3)).toMatchObject({
            volume: 0.42,
            pan: -0.75,
            threshold: -18
        });
    });
});

describe('a per-track compressor', () => {
    it('does nothing at all while it is off', async () => {
        const { studio } = makeStudio();
        await studio.start();

        const state = studio.getProjectState();
        state.mixerSettings = mixerWithATrackMoved();
        state.mixerSettings[3].compressor.enabled = false;
        studio.applyProjectState(state);

        // Still in the chain - removing and re-inserting it would click -
        // but at 0 dB and 1:1, which is a compressor that never acts.
        expect(onTheGraph(studio.audioEngine, 3)).toMatchObject({ threshold: 0, ratio: 1 });
    });

    it('keeps its times while it is off, so switching it on uses them', async () => {
        const { studio } = makeStudio();
        await studio.start();

        const state = studio.getProjectState();
        state.mixerSettings = mixerWithATrackMoved();
        state.mixerSettings[3].compressor.enabled = false;
        studio.applyProjectState(state);

        expect(onTheGraph(studio.audioEngine, 3)).toMatchObject({ attack: 0.01, release: 0.4 });

        studio.audioEngine.setTrackCompressorEnabled(3, true);
        expect(onTheGraph(studio.audioEngine, 3)).toMatchObject({ threshold: -18, ratio: 8 });
    });

    it('is off on a fresh studio, whatever the node was built with', async () => {
        const { studio } = makeStudio();
        await studio.start();

        expect(onTheGraph(studio.audioEngine, 0)).toMatchObject({ threshold: 0, ratio: 1 });
    });

    it('remembers a setting made before the audio existed', () => {
        const { studio } = makeStudio();

        studio.audioEngine.setTrackCompressorThreshold(2, -30);
        studio.audioEngine.setTrackCompressorEnabled(2, true);

        expect(studio.audioEngine.mixerSettings[2].compressor).toMatchObject({
            enabled: true,
            threshold: -30
        });
    });
});

describe('resetting the mixer', () => {
    it('puts unity back on the graph as well as in the record', async () => {
        const { studio } = makeStudio();
        await studio.start();

        const state = studio.getProjectState();
        state.mixerSettings = mixerWithATrackMoved();
        studio.applyProjectState(state);

        studio.audioEngine.resetMixerToDefaults();

        expect(studio.audioEngine.mixerSettings[3]).toEqual(AudioEngine.defaultMixerSettings()[3]);
        expect(onTheGraph(studio.audioEngine, 3)).toEqual({
            volume: 1,
            pan: 0,
            eqLow: 0,
            eqMid: 0,
            eqHigh: 0,
            threshold: 0,
            ratio: 1,
            attack: 0.003,
            release: 0.25
        });
    });

    it('hands out a fresh record each time it is asked for one', () => {
        // Two studios sharing one array of settings would be a very
        // confusing afternoon.
        const first = AudioEngine.defaultMixerSettings();
        const second = AudioEngine.defaultMixerSettings();
        first[0].volume = 0.1;
        first[0].compressor.enabled = true;

        expect(second[0].volume).toBe(1);
        expect(second[0].compressor.enabled).toBe(false);
    });
});
