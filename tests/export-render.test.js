import { describe, it, expect, beforeEach } from 'vitest';
import { AudioEngine } from '../src/audio/audio-engine.js';
import { MasterFx } from '../src/audio/master-fx.js';
import { MasteringEngine } from '../src/audio/mastering.js';
import { Sequencer } from '../src/sequencer/sequencer.js';
import { EventBus } from '../src/core/event-bus.js';
import { renderSong, renderStem, estimateDuration } from '../src/export/render.js';
import { FakeAudioContext, fakeOfflineContextFactory } from './helpers/fake-audio-context.js';

async function makeStudio() {
    const liveContext = new FakeAudioContext();
    const engine = new AudioEngine({ createContext: () => liveContext });
    await engine.init();

    const bus = new EventBus();
    const sequencer = new Sequencer(engine, { bus });
    const masterFx = new MasterFx(engine, { bus });
    const mastering = new MasteringEngine(engine, { bus });
    engine.masterFx = masterFx;
    engine.mastering = mastering;

    // `audioEngine` is the name the renderer reads; `engine` is for the tests.
    return { audioEngine: engine, engine, sequencer, masterFx, mastering, bus };
}

/** Render, and hand back the offline context so the graph can be inspected. */
async function render(studio, options = {}) {
    const record = {};
    const buffer = await renderSong(studio, {
        createContext: fakeOfflineContextFactory(record),
        ...options
    });
    return { buffer, context: record.context };
}

describe('renderSong length', () => {
    let studio;

    beforeEach(async () => {
        studio = await makeStudio();
    });

    it('renders one pattern plus a release tail', async () => {
        const { context } = await render(studio, { patterns: [0], sampleRate: 48000 });

        // 16 steps at 120 BPM is 2 s, plus 1 s of tail
        expect(context.length).toBe(Math.ceil(48000 * 3));
        expect(context.sampleRate).toBe(48000);
        expect(context.numberOfChannels).toBe(2);
    });

    it('cuts the tail off for a loop-ready render', async () => {
        const { context } = await render(studio, { loopReady: true, sampleRate: 48000 });
        expect(context.length).toBe(Math.ceil(48000 * 2));
    });

    it('grows with the number of measures', async () => {
        const { context } = await render(studio, { patterns: [0, 1, 2], sampleRate: 48000 });
        expect(context.length).toBe(Math.ceil(48000 * (6 + 1)));
    });

    it('drops trailing silent measures instead of rendering silence', async () => {
        const { context } = await render(studio, {
            patterns: [0, 1, null, null],
            sampleRate: 48000
        });
        expect(context.length).toBe(Math.ceil(48000 * (4 + 1)));
    });

    it('follows the tempo', async () => {
        studio.sequencer.setBPM(240);
        const { context } = await render(studio, { sampleRate: 48000 });

        expect(context.length).toBe(Math.ceil(48000 * 2)); // one second of music
    });

    it('estimates the same duration it renders', () => {
        expect(estimateDuration(studio.sequencer, 2)).toBeCloseTo(4, 6);
    });
});

describe('renderSong graph', () => {
    let studio;

    beforeEach(async () => {
        studio = await makeStudio();
    });

    it('ends on a limiter into the destination', async () => {
        const { context } = await render(studio);

        const limiter = context.nodesOfKind('compressor').at(-1);
        expect(limiter.threshold.value).toBe(-3);
        expect(limiter.ratio.value).toBe(20);
        expect(limiter.outputs).toContain(context.destination);
    });

    it('builds eight channel strips', async () => {
        const { context } = await render(studio);
        expect(context.nodesOfKind('panner')).toHaveLength(8);
    });

    // 8 strips × 3 EQ bands, plus the 5 mastering bands, which are on by
    // default: the high-pass at 40 Hz and low-pass at 18 kHz shape the sound
    // even with every gain at zero, so they are not no-ops to be skipped.
    const BASELINE_FILTERS = 24 + 5;

    it('leaves the master FX chain out when no effect is on', async () => {
        const { context } = await render(studio);
        expect(context.nodesOfKind('biquad')).toHaveLength(BASELINE_FILTERS);
    });

    it('inserts the master filter when it is on', async () => {
        studio.masterFx.setFilterEnabled(true);
        studio.masterFx.setFilterFrequency(800);

        const { context } = await render(studio);
        const filters = context.nodesOfKind('biquad');

        expect(filters).toHaveLength(BASELINE_FILTERS + 1);
        expect(filters.some((filter) => filter.frequency.value === 800)).toBe(true);
    });

    it('adds the mastering compressor when it is on', async () => {
        const off = await render(studio);
        expect(off.context.nodesOfKind('compressor')).toHaveLength(1); // the limiter alone

        studio.mastering.setCompParam('enabled', true);
        const on = await render(studio);
        expect(on.context.nodesOfKind('compressor')).toHaveLength(2);
    });

    it('skips a bypassed mastering stage entirely', async () => {
        studio.mastering.setCompParam('enabled', true);
        studio.mastering.setBypass(true);

        const { context } = await render(studio);

        expect(context.nodesOfKind('biquad')).toHaveLength(24); // strips only
        expect(context.nodesOfKind('compressor')).toHaveLength(1);
    });

    it('carries the mixer settings into the strips', async () => {
        studio.engine.setTrackFaderVolume(0, 0.4);
        studio.engine.setTrackPan(0, -0.5);

        const { context } = await render(studio);

        expect(context.nodesOfKind('panner')[0].pan.value).toBe(-0.5);
        expect(context.nodesOfKind('gain')[0].gain.value).toBeCloseTo(0.5, 6); // master
    });

    it('feeds the wheels in as constant sources only when they are off centre', async () => {
        const idle = await render(studio);
        expect(idle.context.nodesOfKind('constantSource')).toHaveLength(0);

        studio.masterFx.setPitchBend(0.5);
        studio.masterFx.setModulation(0.5);
        const moved = await render(studio);

        const constants = moved.context.nodesOfKind('constantSource');
        expect(constants).toHaveLength(2);
        expect(constants[0].offset.value).toBe(100); // cents
        expect(constants[1].offset.value).toBe(7.5); // hertz
    });
});

describe('renderSong notes', () => {
    let studio;

    beforeEach(async () => {
        studio = await makeStudio();
    });

    it('renders nothing for an empty pattern', async () => {
        const { context } = await render(studio);
        expect(context.nodesOfKind('oscillator')).toHaveLength(0);
    });

    it('renders one voice per note', async () => {
        studio.sequencer.setCell(0, 0, 'C', 4);
        studio.sequencer.setCell(0, 4, 'E', 4);
        studio.sequencer.setCell(2, 0, 'C', 2);

        const { context } = await render(studio);

        expect(context.nodesOfKind('oscillator')).toHaveLength(3);
    });

    it('places the notes in time', async () => {
        studio.sequencer.setCell(0, 0, 'C', 4);
        studio.sequencer.setCell(0, 1, 'C', 4);

        const { context } = await render(studio);
        const [first, second] = context.nodesOfKind('oscillator');

        expect(first.started).toBe(0);
        expect(second.started).toBeCloseTo(0.125, 6); // one sixteenth at 120 BPM
    });

    it('offsets the second measure by a full pattern', async () => {
        studio.sequencer.setCell(0, 0, 'C', 4);
        studio.sequencer.switchPattern(1);
        studio.sequencer.setCell(0, 0, 'E', 4);

        const { context } = await render(studio, { patterns: [0, 1] });
        const [, second] = context.nodesOfKind('oscillator');

        expect(second.started).toBeCloseTo(2, 6);
    });

    it('swings the off-beats', async () => {
        studio.sequencer.setCell(0, 1, 'C', 4);
        studio.sequencer.setSwing(1);

        const { context } = await render(studio);

        expect(context.nodesOfKind('oscillator')[0].started).toBeCloseTo(0.1875, 6);
    });

    it('renders a noise track from a buffer', async () => {
        studio.sequencer.setCell(5, 0, 'C', 3); // snare

        const { context } = await render(studio);

        expect(context.nodesOfKind('oscillator')).toHaveLength(0);
        expect(context.nodesOfKind('bufferSource')).toHaveLength(1);
    });

    it('honours mute and solo in a full mix', async () => {
        studio.sequencer.setCell(0, 0, 'C', 4);
        studio.sequencer.setCell(1, 0, 'E', 4);
        studio.sequencer.toggleMute(1);

        const { context } = await render(studio);

        expect(context.nodesOfKind('oscillator')).toHaveLength(1);
    });

    it('ignores mute and solo when a stem is asked for', async () => {
        studio.sequencer.setCell(1, 0, 'E', 4);
        studio.sequencer.toggleMute(1);

        const record = {};
        await renderStem(studio, 1, { createContext: fakeOfflineContextFactory(record) });

        expect(record.context.nodesOfKind('oscillator')).toHaveLength(1);
    });

    it('renders only the tracks a stem asks for', async () => {
        studio.sequencer.setCell(0, 0, 'C', 4);
        studio.sequencer.setCell(1, 0, 'E', 4);

        const record = {};
        await renderStem(studio, 0, { createContext: fakeOfflineContextFactory(record) });

        expect(record.context.nodesOfKind('oscillator')).toHaveLength(1);
    });

    it('skips a silent measure without shifting what follows', async () => {
        studio.sequencer.setCell(0, 0, 'C', 4);

        const { context } = await render(studio, { patterns: [null, 0] });

        expect(context.nodesOfKind('oscillator')[0].started).toBeCloseTo(2, 6);
    });
});

describe('renderSong output', () => {
    it('normalises by default, and not when told otherwise', async () => {
        const studio = await makeStudio();

        const normalised = await render(studio);
        expect(normalised.buffer).toBeTruthy();

        const raw = await render(studio, { normalize: false });
        expect(raw.buffer).toBeTruthy();
    });

    it('reports progress at both ends', async () => {
        const studio = await makeStudio();
        const progress = [];

        await render(studio, { onProgress: (value) => progress.push(value) });

        expect(progress).toEqual([0, 100]);
    });
});
