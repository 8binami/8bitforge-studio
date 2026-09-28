/**
 * The envelopes you drew, in the file you export.
 *
 * In playback a lane is written one step at a time, by the sequencer.
 * An offline render has no sequencer: it builds the whole graph, books
 * everything against a timeline and runs faster than real time. So the
 * envelopes have to be booked too: and for a long time nobody booked
 * them, so a filter sweep or a fader ride was in the studio and not in
 * the WAV, with nothing to say so. The whole point of these is that the
 * graph is inspected after the render rather than the code being read.
 *
 * The other half of the point is that the export and playback do the
 * same arithmetic. The conversion from a 0..1 lane value to hertz or
 * decibels comes from the automation module itself, so a test that
 * pins a number here would only be pinning that module twice; what is
 * pinned instead is that the two agree.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AudioEngine } from '../src/audio/audio-engine.js';
import { MasterFx } from '../src/audio/master-fx.js';
import { MasteringEngine } from '../src/audio/mastering.js';
import { Sequencer } from '../src/sequencer/sequencer.js';
import { Arrangement } from '../src/sequencer/arrangement.js';
import { FxAutomation } from '../src/automation/fx-automation.js';
import { MixerAutomation } from '../src/automation/mixer-automation.js';
import { EventBus } from '../src/core/event-bus.js';
import { renderSong } from '../src/export/render.js';
import { FakeAudioContext, fakeOfflineContextFactory } from './helpers/fake-audio-context.js';

async function makeStudio() {
    const liveContext = new FakeAudioContext();
    const audioEngine = new AudioEngine({ createContext: () => liveContext });
    await audioEngine.init();

    const bus = new EventBus();
    const sequencer = new Sequencer(audioEngine, { bus });
    const arrangement = new Arrangement({ sequencer, bus });
    const masterFx = new MasterFx(audioEngine, { bus });
    const mastering = new MasteringEngine(audioEngine, { bus });
    audioEngine.masterFx = masterFx;
    audioEngine.mastering = mastering;

    const fxAutomation = new FxAutomation({
        masterFx,
        mastering,
        arrangement,
        sequencer,
        bus
    });
    const mixerAutomation = new MixerAutomation({ audioEngine, arrangement, sequencer, bus });

    return {
        audioEngine,
        sequencer,
        arrangement,
        masterFx,
        mastering,
        fxAutomation,
        mixerAutomation
    };
}

async function render(studio, options = {}) {
    const record = {};
    await renderSong(studio, { createContext: fakeOfflineContextFactory(record), ...options });
    return record.context;
}

/** Seconds per sixteenth, as the renderer works it out. */
const stepDuration = (studio) => 60 / studio.sequencer.bpm / 4;

/** Every automation call booked on one parameter of one node. */
const booked = (param) => param?.automation ?? [];

describe('the master effects', () => {
    let studio;

    beforeEach(async () => {
        studio = await makeStudio();
        studio.masterFx.setFilterEnabled(true);
    });

    it('books a filter sweep against the song, in seconds', async () => {
        studio.fxAutomation.addPoint('filterFreq', 0, 0.1);
        studio.fxAutomation.addPoint('filterFreq', 16, 0.9);

        const context = await render(studio, { patterns: [0, 0] });
        const filter = context
            .nodesOfKind('biquad')
            .find((node) => node.frequency?.automation.length);

        expect(filter, 'no filter was booked at all').toBeTruthy();
        const calls = booked(filter.frequency);

        // One hold at zero, then the two breakpoints.
        expect(calls.map((call) => call.method)).toEqual([
            'setValueAtTime',
            'setValueAtTime',
            'exponentialRampToValueAtTime'
        ]);
        expect(calls[1].args[1]).toBe(0);
        expect(calls[2].args[1]).toBeCloseTo(16 * stepDuration(studio), 6);
    });

    it('sweeps a logarithmic parameter exponentially', async () => {
        // Linearly, four fifths of a filter sweep happens in the last
        // few steps and it does not sound like one sweep.
        studio.fxAutomation.addPoint('filterFreq', 0, 0);
        studio.fxAutomation.addPoint('filterFreq', 8, 1);

        const context = await render(studio, { patterns: [0] });
        const filter = context
            .nodesOfKind('biquad')
            .find((node) => node.frequency?.automation.length);

        expect(booked(filter.frequency).at(-1).method).toBe('exponentialRampToValueAtTime');
    });

    it('ramps a parameter that is not logarithmic in a straight line', async () => {
        studio.fxAutomation.addPoint('filterQ', 0, 0);
        studio.fxAutomation.addPoint('filterQ', 8, 1);

        const context = await render(studio, { patterns: [0] });
        const filter = context.nodesOfKind('biquad').find((node) => node.Q?.automation.length);

        expect(booked(filter.Q).at(-1).method).toBe('linearRampToValueAtTime');
    });

    it('books the value playback would write, not one of its own', async () => {
        studio.fxAutomation.addPoint('filterFreq', 0, 0.25);
        studio.fxAutomation.addPoint('filterFreq', 8, 0.75);

        const context = await render(studio, { patterns: [0] });
        const filter = context
            .nodesOfKind('biquad')
            .find((node) => node.frequency?.automation.length);
        const calls = booked(filter.frequency);

        expect(calls[1].args[0]).toBeCloseTo(
            studio.fxAutomation.denormalize('filterFreq', 0.25),
            6
        );
        expect(calls[2].args[0]).toBeCloseTo(
            studio.fxAutomation.denormalize('filterFreq', 0.75),
            6
        );
    });

    it('holds the first value from the start of the file', async () => {
        // Without it the parameter starts wherever the control was left
        // and jumps when the first breakpoint arrives.
        studio.fxAutomation.addPoint('filterFreq', 24, 0.8);

        const context = await render(studio, { patterns: [0, 0] });
        const filter = context
            .nodesOfKind('biquad')
            .find((node) => node.frequency?.automation.length);
        const calls = booked(filter.frequency);

        expect(calls[0]).toMatchObject({ method: 'setValueAtTime' });
        expect(calls[0].args[1]).toBe(0);
        expect(calls[0].args[0]).toBeCloseTo(calls[1].args[0], 6);
    });

    it('writes nowhere for an effect that is switched off', async () => {
        const quiet = await makeStudio();
        quiet.fxAutomation.addPoint('delayMix', 0, 0.9);

        // A delay that is not in the chain has no node to move, exactly
        // as in playback. The render must not mind.
        const context = await render(quiet, { patterns: [0] });

        const ridden = context
            .nodesOfKind('delay')
            .filter((node) => node.delayTime.automation.length);
        expect(ridden).toEqual([]);
    });

    it('leaves a parameter alone when its lane is empty', async () => {
        const context = await render(studio, { patterns: [0] });
        const filter = context.nodesOfKind('biquad').find((node) => node.type === 'lowpass');

        expect(booked(filter?.frequency)).toEqual([]);
    });
});

describe('the two wheels', () => {
    it('gives a wheel at rest a node when a lane is about to move it', async () => {
        const studio = await makeStudio();
        expect(studio.masterFx.pitchBend).toBe(0);

        studio.fxAutomation.addPoint('pitchBend', 0, 0.5);
        studio.fxAutomation.addPoint('pitchBend', 8, 1);

        const context = await render(studio, { patterns: [0] });
        const constants = context.nodesOfKind('constantSource');

        expect(constants.length).toBeGreaterThan(0);
        expect(booked(constants[0].offset).length).toBeGreaterThan(1);
    });

    it('books a bend in cents, as the engine reads it', async () => {
        const studio = await makeStudio();
        studio.fxAutomation.addPoint('pitchBend', 0, 1);

        const context = await render(studio, { patterns: [0] });
        const offset = context.nodesOfKind('constantSource')[0].offset;

        const semitones = studio.fxAutomation.denormalize('pitchBend', 1);
        expect(booked(offset)[0].args[0]).toBeCloseTo(semitones * 200, 6);
    });

    it('makes no node for a wheel at rest with no lane', async () => {
        const studio = await makeStudio();

        const context = await render(studio, { patterns: [0] });

        expect(context.nodesOfKind('constantSource')).toEqual([]);
    });
});

describe('the reverb tail', () => {
    it('is built from where the decay lane starts', async () => {
        // An impulse response is a buffer and cannot be ramped, so the
        // lane decides which tail the render is built on rather than
        // whatever the control read when Export was pressed.
        const studio = await makeStudio();
        studio.masterFx.setEffectEnabled('reverb', true);
        studio.masterFx.setEffectParam('reverb', 'decay', 0.2);
        studio.fxAutomation.addPoint('reverbDecay', 0, 1);

        const context = await render(studio, { patterns: [0] });
        const convolver = context.nodesOfKind('convolver')[0];

        const started = studio.fxAutomation.denormalize('reverbDecay', 1);
        // The impulse runs three times the decay, as the builder says.
        expect(convolver.buffer.duration).toBeCloseTo(started * 3, 2);
    });
});

describe('the console', () => {
    let studio;

    beforeEach(async () => {
        studio = await makeStudio();
    });

    it('books a fader ride on the right strip', async () => {
        studio.mixerAutomation.addPoint('t2Vol', 0, 0);
        studio.mixerAutomation.addPoint('t2Vol', 16, 1);

        const context = await render(studio, { patterns: [0, 0] });
        const ridden = context.nodesOfKind('gain').filter((node) => node.gain.automation.length);

        expect(ridden).toHaveLength(1);
        const calls = booked(ridden[0].gain);
        expect(calls.at(-1).args[0]).toBeCloseTo(studio.mixerAutomation.denormalize('t2Vol', 1), 6);
        expect(calls.at(-1).args[1]).toBeCloseTo(16 * stepDuration(studio), 6);
    });

    it('books a pan on the strip that owns it', async () => {
        studio.mixerAutomation.addPoint('t5Pan', 0, 0);
        studio.mixerAutomation.addPoint('t5Pan', 8, 1);

        const context = await render(studio, { patterns: [0] });
        const panners = context.nodesOfKind('panner').filter((node) => node.pan.automation.length);

        expect(panners).toHaveLength(1);
        expect(booked(panners[0].pan).at(-1).args[0]).toBeCloseTo(1, 6);
    });

    it('books the master fader', async () => {
        studio.mixerAutomation.addPoint('masterVol', 0, 1);
        studio.mixerAutomation.addPoint('masterVol', 8, 0.2);

        const context = await render(studio, { patterns: [0] });
        const ridden = context.nodesOfKind('gain').filter((node) => node.gain.automation.length);

        expect(ridden).toHaveLength(1);
        expect(booked(ridden[0].gain)).toHaveLength(3);
    });

    it('writes nowhere for a compressor the project has switched off', async () => {
        studio.mixerAutomation.addPoint('t0CompTh', 0, 0.5);

        const context = await render(studio, { patterns: [0] });
        const compressors = context
            .nodesOfKind('compressor')
            .filter((node) => node.threshold.automation.length);

        // Only the limiter is built, and nothing rides it.
        expect(compressors).toEqual([]);
    });

    it('books a compressor the project has switched on', async () => {
        studio.audioEngine.setTrackCompressorEnabled(3, true);
        studio.mixerAutomation.addPoint('t3CompRt', 0, 0);
        studio.mixerAutomation.addPoint('t3CompRt', 8, 1);

        const context = await render(studio, { patterns: [0] });
        const ridden = context
            .nodesOfKind('compressor')
            .filter((node) => node.ratio.automation.length);

        expect(ridden).toHaveLength(1);
        expect(booked(ridden[0].ratio).at(-1).args[0]).toBeCloseTo(
            studio.mixerAutomation.denormalize('t3CompRt', 1),
            6
        );
    });

    it('leaves the console alone when nothing was drawn', async () => {
        const context = await render(studio, { patterns: [0] });
        const ridden = context.nodesOfKind('gain').filter((node) => node.gain.automation.length);

        expect(ridden).toEqual([]);
    });
});
