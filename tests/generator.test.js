import { describe, it, expect, beforeEach } from 'vitest';
import { AudioEngine } from '../src/audio/audio-engine.js';
import { Sequencer } from '../src/sequencer/sequencer.js';
import { Generator, GENERATOR_EVENTS } from '../src/compose/generator.js';
import { EventBus } from '../src/core/event-bus.js';
import { FakeAudioContext } from './helpers/fake-audio-context.js';

async function makeGenerator() {
    const context = new FakeAudioContext();
    const engine = new AudioEngine({ createContext: () => context });
    await engine.init();

    const bus = new EventBus();
    const sequencer = new Sequencer(engine, { bus });
    const generator = new Generator(sequencer, { bus });

    return { engine, bus, sequencer, generator };
}

/** Every note of a pattern, as comparable text. */
function patternFingerprint(sequencer, patternIndex = sequencer.currentPattern) {
    return JSON.stringify(sequencer.patterns[patternIndex]);
}

function countNotes(sequencer, track, patternIndex = sequencer.currentPattern) {
    return sequencer.patterns[patternIndex][track].filter(Boolean).length;
}

describe('Generator parameters', () => {
    let generator;

    beforeEach(async () => {
        ({ generator } = await makeGenerator());
    });

    it('starts on sensible defaults', () => {
        expect(generator.getState()).toMatchObject({
            chaos: 50,
            complexity: 50,
            density: 50,
            rootKey: 'C',
            scaleType: 'major',
            genre: 'chiptune',
            mood: 'epic'
        });
    });

    it('keeps the note range in order', () => {
        // The two drop-downs are independent and nothing stops the low
        // one being set above the high one. This used to answer 4 and 4
        // - an empty range - because it raised the top to meet the
        // bottom instead of swapping them, and `_clamp(v, lo, hi)` with
        // lo above hi pins every note to lo.
        generator.setNoteRange(4, 2);
        expect(generator.octaveMin).toBe(2);
        expect(generator.octaveMax).toBe(4);
    });

    it('refuses a range that is not a pair of numbers', () => {
        // The drop-downs are labelled C1 to C7 and were read with
        // Number(), so every choice wrote NaN into octaveMin, then into
        // _clamp, then into the octave of every note written - with
        // nothing anywhere to report it. The panel converts now; this
        // is the second lock, because of how quietly the first failed.
        generator.setNoteRange(2, 5);
        generator.setNoteRange('C4', 'C6');

        expect(generator.octaveMin).toBe(2);
        expect(generator.octaveMax).toBe(5);
    });

    it('clamps the seed to a usable range', () => {
        generator.setSeed(-5);
        expect(generator.seed).toBe(0);
        generator.setSeed(9e12);
        expect(generator.seed).toBe(2147483647);
        generator.setSeed('nonsense');
        expect(generator.seed).toBe(0);
    });

    it('round-trips its state and announces the change', async () => {
        const { generator: gen, bus } = await makeGenerator();
        const events = [];
        bus.on(GENERATOR_EVENTS.changed, (state) => events.push(state));

        gen.setGenre('synthwave');
        gen.setMood('dark');
        gen.setChaos(75);
        const saved = gen.getState();

        const { generator: fresh } = await makeGenerator();
        fresh.loadState(saved);

        expect(fresh.getState()).toEqual(saved);
        expect(events).toHaveLength(0); // loading elsewhere, not here
    });

    it('announces a loaded state', async () => {
        const { generator: gen, bus } = await makeGenerator();
        const events = [];
        bus.on(GENERATOR_EVENTS.changed, (state) => events.push(state));

        gen.loadState({ genre: 'techno', chaos: 20 });

        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ genre: 'techno', chaos: 20 });
    });

    it('ignores a load of nothing', () => {
        const before = generator.getState();
        generator.loadState(null);
        expect(generator.getState()).toEqual(before);
    });
});

describe('Generator music theory', () => {
    let generator;

    beforeEach(async () => {
        ({ generator } = await makeGenerator());
    });

    it('builds the scale of the chosen key', () => {
        generator.setRootKey('C');
        generator.setScaleType('major');
        expect(generator.getScale()).toEqual(['C', 'D', 'E', 'F', 'G', 'A', 'B']);

        generator.setRootKey('A');
        generator.setScaleType('minor');
        expect(generator.getScale()).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
    });

    it('spreads euclidean pulses evenly over the steps', () => {
        expect(generator.euclideanRhythm(4, 16)).toEqual([
            true,
            false,
            false,
            false,
            true,
            false,
            false,
            false,
            true,
            false,
            false,
            false,
            true,
            false,
            false,
            false
        ]);

        const three = generator.euclideanRhythm(3, 8);
        expect(three.filter(Boolean)).toHaveLength(3);
        expect(three).toHaveLength(8);
    });

    it('places each track in its own register, inside the chosen range', () => {
        generator.setNoteRange(1, 6);
        const kick = generator.getOctaveForTrack(4);
        const lead = generator.getOctaveForTrack(0);
        const hihat = generator.getOctaveForTrack(6);

        expect(kick).toBeLessThan(lead);
        expect(hihat).toBeGreaterThan(lead);

        // A narrow range pulls every track into it
        generator.setNoteRange(3, 5);
        expect(generator.getOctaveForTrack(4)).toBe(3);
        expect(generator.getOctaveForTrack(6)).toBe(5);
    });
});

describe('Generator output', () => {
    let sequencer;
    let generator;

    beforeEach(async () => {
        ({ sequencer, generator } = await makeGenerator());
    });

    it('fills the pattern with notes', () => {
        const result = generator.generateAll();

        expect(sequencer.patternHasContent(0)).toBe(true);
        expect(result.suggestedBPM).toBeGreaterThan(0);
        expect(Number.isInteger(result.seed)).toBe(true);
    });

    it('writes only within the pattern length', () => {
        sequencer.setSteps(16);
        generator.generateAll();

        for (let track = 0; track < 8; track++) {
            const beyond = sequencer.patterns[0][track].slice(16).filter(Boolean);
            expect(beyond).toHaveLength(0);
        }
    });

    it('repeats itself exactly for a given seed', () => {
        generator.setSeed(4242);
        generator.generateAll();
        const first = patternFingerprint(sequencer);

        sequencer.clearAll();
        generator.setSeed(4242);
        generator.generateAll();

        expect(patternFingerprint(sequencer)).toBe(first);
    });

    it('composes something different on a different seed', () => {
        generator.setSeed(1);
        generator.generateAll();
        const first = patternFingerprint(sequencer);

        sequencer.clearAll();
        generator.setSeed(2);
        generator.generateAll();

        expect(patternFingerprint(sequencer)).not.toBe(first);
    });

    it('draws a fresh seed when none is set, and reports it', () => {
        generator.setSeed(0);
        const result = generator.generateAll();

        expect(result.seed).toBeGreaterThan(0);
        expect(generator.lastSeed).toBe(result.seed);
    });

    it('writes denser patterns as density goes up', () => {
        // A genre sets its own density per track, so this one runs without one.
        generator.setGenre('none');

        generator.setSeed(7);
        generator.setDensity(10);
        generator.generateAll();
        const sparse = countNotes(sequencer, 0) + countNotes(sequencer, 2);

        sequencer.clearAll();
        generator.setSeed(7);
        generator.setDensity(95);
        generator.generateAll();
        const dense = countNotes(sequencer, 0) + countNotes(sequencer, 2);

        expect(dense).toBeGreaterThan(sparse);
    });

    it('stays in key', () => {
        generator.setRootKey('D');
        generator.setScaleType('minor');
        generator.setGenre('chiptune');
        generator.generateAll();

        const inScale = new Set(generator.getScale());
        const melodic = sequencer.patterns[0][0].filter(Boolean);

        expect(melodic.length).toBeGreaterThan(0);
        // Chromatic passing notes are allowed, but the bulk must be in key.
        const inKey = melodic.filter((cell) => inScale.has(cell.note));
        expect(inKey.length / melodic.length).toBeGreaterThan(0.7);
    });

    it('regenerates a single track, leaving the others alone', () => {
        generator.setSeed(11);
        generator.generateAll();
        const bassBefore = JSON.stringify(sequencer.patterns[0][2]);

        generator.setSeed(0);
        generator.generateForTrack(0);

        expect(JSON.stringify(sequencer.patterns[0][2])).toBe(bassBefore);
    });

    it('announces what it generated', async () => {
        const { generator: gen, bus } = await makeGenerator();
        const events = [];
        bus.on(GENERATOR_EVENTS.generated, (event) => events.push(event));

        gen.generateAll();

        expect(events).toHaveLength(1);
        expect(events[0]).toHaveProperty('seed');
    });
});

describe('Generator song mode', () => {
    it('fills several patterns and hands back the chain', async () => {
        const { sequencer, generator } = await makeGenerator();

        const result = generator.generateMultiPattern(4);

        expect(result.sections).toHaveLength(4);
        expect(result.songChain.length).toBeGreaterThanOrEqual(4);
        expect(sequencer.patternHasContent(0)).toBe(true);
        expect(sequencer.patternHasContent(3)).toBe(true);
    });

    it('leaves the sequencer on the pattern it started from', async () => {
        const { sequencer, generator } = await makeGenerator();
        sequencer.switchPattern(1);

        generator.generateMultiPattern(3);

        expect(sequencer.currentPattern).toBe(1);
    });

    it('clamps the number of sections', async () => {
        const { generator } = await makeGenerator();

        expect(generator.generateMultiPattern(1).sections).toHaveLength(2);
        expect(generator.generateMultiPattern(99).sections).toHaveLength(8);
    });

    it('repeats itself for a given seed', async () => {
        const { sequencer, generator } = await makeGenerator();

        generator.setSeed(99);
        const first = generator.generateMultiPattern(3);
        const patterns = [0, 1, 2].map((p) => patternFingerprint(sequencer, p));

        const fresh = await makeGenerator();
        fresh.generator.setSeed(99);
        const second = fresh.generator.generateMultiPattern(3);

        expect(second.songChain).toEqual(first.songChain);
        expect([0, 1, 2].map((p) => patternFingerprint(fresh.sequencer, p))).toEqual(patterns);
    });
});

describe('Generator built-in presets', () => {
    it('lists presets ready for the library', async () => {
        const { generator } = await makeGenerator();
        const presets = generator.getBuiltinPresetList();

        expect(presets.length).toBeGreaterThan(0);
        expect(presets[0]).toMatchObject({ source: 'builtin', designer: '8BitForge' });
        expect(presets[0].data).toHaveProperty('genre');
    });

    it('applies as a state', async () => {
        const { generator } = await makeGenerator();
        const preset = generator
            .getBuiltinPresetList()
            .find((item) => item.presetKey === 'synthwave-nights');

        generator.loadState(preset.data);

        expect(generator.genre).toBe('synthwave');
        expect(generator.rootKey).toBe('A');
        expect(generator.scaleType).toBe('minor');
    });
});
