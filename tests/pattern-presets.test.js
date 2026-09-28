import { describe, it, expect, beforeEach } from 'vitest';
import { AudioEngine } from '../src/audio/audio-engine.js';
import { Sequencer, SEQUENCER_EVENTS } from '../src/sequencer/sequencer.js';
import { PatternPresets } from '../src/compose/pattern-presets.js';
import { EventBus } from '../src/core/event-bus.js';
import { FakeAudioContext } from './helpers/fake-audio-context.js';

async function makePresets() {
    const context = new FakeAudioContext();
    const engine = new AudioEngine({ createContext: () => context });
    await engine.init();

    const bus = new EventBus();
    const sequencer = new Sequencer(engine, { bus });
    const presets = new PatternPresets(sequencer, engine, { bus });

    return { engine, bus, sequencer, presets };
}

const DRUM_TRACKS = [4, 5, 6];

function countDrumNotes(sequencer) {
    return DRUM_TRACKS.reduce(
        (total, track) => total + sequencer.patterns[0][track].filter(Boolean).length,
        0
    );
}

/** The first preset key of a category, so the tests do not pin one by name. */
function anyPresetKey(presets, category = 'electronic') {
    return presets.getPresetList().find((preset) => preset.category === category).id;
}

describe('PatternPresets catalogue', () => {
    let presets;

    beforeEach(async () => {
        ({ presets } = await makePresets());
    });

    it('lists presets with a name and a category', () => {
        const list = presets.getPresetList();

        expect(list.length).toBeGreaterThan(10);
        for (const preset of list) {
            expect(preset.name).toBeTruthy();
            expect(preset.category).toBeTruthy();
        }
    });

    it('groups them under the declared categories', () => {
        const categories = presets.getCategories().map((category) => category.id);
        const grouped = presets.getPresetsByCategory();

        expect(Object.keys(grouped).sort()).toEqual([...categories].sort());
        const total = Object.values(grouped).reduce((sum, c) => sum + c.presets.length, 0);
        expect(total).toBe(presets.getPresetList().length);
    });
});

describe('PatternPresets applying', () => {
    let sequencer;
    let presets;

    beforeEach(async () => {
        ({ sequencer, presets } = await makePresets());
    });

    it('writes a rhythm into the drum tracks', () => {
        expect(presets.applyPreset(anyPresetKey(presets))).toBe(true);

        expect(countDrumNotes(sequencer)).toBeGreaterThan(0);
        // ...and leaves the melodic tracks alone
        expect(sequencer.patterns[0][0].filter(Boolean)).toHaveLength(0);
    });

    it('reports an unknown preset', () => {
        expect(presets.applyPreset('not-a-preset')).toBe(false);
        expect(countDrumNotes(sequencer)).toBe(0);
    });

    it('tiles a sixteen-step rhythm across a thirty-two-step pattern', () => {
        sequencer.setSteps(32);
        presets.applyPreset(anyPresetKey(presets));

        for (const track of DRUM_TRACKS) {
            const cells = sequencer.patterns[0][track];
            for (let step = 0; step < 16; step++) {
                expect(Boolean(cells[step + 16])).toBe(Boolean(cells[step]));
            }
        }
    });

    it('replaces what was there when filling', () => {
        sequencer.setCell(4, 3, 'C', 2);
        sequencer.setCell(4, 7, 'C', 2);
        const key = anyPresetKey(presets);

        presets.applyPreset(key, 'fill');
        const filled = JSON.stringify(sequencer.patterns[0][4]);

        presets.applyPreset(key, 'fill');
        expect(JSON.stringify(sequencer.patterns[0][4])).toBe(filled);
    });

    it('appends after the existing rhythm', () => {
        sequencer.setSteps(32);
        const key = anyPresetKey(presets);
        presets.applyPreset(key, 'fill');

        // Keep only the first half, then append into the space that frees up
        for (let step = 16; step < 32; step++) {
            for (const track of DRUM_TRACKS) sequencer.patterns[0][track][step] = null;
        }
        const firstHalf = countDrumNotes(sequencer);

        expect(presets.applyPreset(key, 'append')).toBe(true);
        expect(countDrumNotes(sequencer)).toBeGreaterThan(firstHalf);
    });

    it('says so when there is no room left to append', () => {
        sequencer.setSteps(16);
        const key = anyPresetKey(presets);
        presets.applyPreset(key, 'fill');

        expect(presets.applyPreset(key, 'append')).toBe('full');
    });

    it('applies a variant when the preset has one', () => {
        const withVariation = presets
            .getPresetList()
            .map((item) => item.id)
            .find((id) => presets.presets[id].variants?.variation);

        // No early return. Every shipped rhythm has all three variants, and
        // an escape hatch here is how this test spent a while passing
        // without running: when the closures became data the old lookup
        // stopped matching anything and the check quietly skipped itself.
        expect(withVariation).toBeTruthy();

        presets.applyPreset(withVariation, 'fill', { variant: 'base' });
        const base = JSON.stringify(sequencer.patterns[0].slice(4, 7));

        presets.applyPreset(withVariation, 'fill', { variant: 'variation' });
        expect(JSON.stringify(sequencer.patterns[0].slice(4, 7))).not.toBe(base);
    });

    it('falls back to the base when a preset lacks the variant asked for', () => {
        const id = presets.getPresetList()[0].id;

        presets.applyPreset(id, 'fill', { variant: 'base' });
        const base = JSON.stringify(sequencer.patterns[0].slice(4, 7));

        presets.applyPreset(id, 'fill', { variant: 'nonsense' });

        expect(JSON.stringify(sequencer.patterns[0].slice(4, 7))).toBe(base);
    });

    it('announces the change so the grid redraws', async () => {
        const { presets: p, bus } = await makePresets();
        const events = [];
        bus.on(SEQUENCER_EVENTS.cellsChanged, (event) => events.push(event));

        p.applyPreset(anyPresetKey(p));

        expect(events).toHaveLength(1);
        expect(events[0]).toEqual({ pattern: 0, track: null });
    });
});

describe('PatternPresets drum instruments', () => {
    it('restores the factory drum sounds on request', async () => {
        const { engine, presets } = await makePresets();

        engine.tracks[4].type = 'sawtooth';
        engine.tracks[4].volume = 1.4;
        engine.envelopes[4].decay = 2;

        presets.applyPreset(anyPresetKey(presets), 'fill', { resetInstruments: true });

        expect(engine.tracks[4].type).toBe('sine');
        expect(engine.tracks[4].volume).toBe(0.5);
        expect(engine.envelopes[4].decay).toBe(0.3);
    });

    it('leaves the drum sounds alone by default', async () => {
        const { engine, presets } = await makePresets();
        engine.tracks[4].volume = 1.2;

        presets.applyPreset(anyPresetKey(presets));

        expect(engine.tracks[4].volume).toBe(1.2);
    });

    it('wipes any leftover from a previous instrument', async () => {
        const { engine, presets } = await makePresets();
        engine.tracks[5].filterEnabled = true;
        engine.tracks[5].filterCutoff = 400;

        presets.resetDrumInstruments();

        expect(engine.tracks[5].filterEnabled).toBe(false);
        expect(engine.tracks[5].filterCutoff).toBe(20000);
    });
});
