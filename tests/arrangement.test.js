import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AudioEngine } from '../src/audio/audio-engine.js';
import { Sequencer, SEQUENCER_EVENTS } from '../src/sequencer/sequencer.js';
import { Arrangement, ARRANGEMENT_EVENTS } from '../src/sequencer/arrangement.js';
import { EventBus } from '../src/core/event-bus.js';
import { FakeAudioContext } from './helpers/fake-audio-context.js';

async function makeArrangement(chain = []) {
    const context = new FakeAudioContext();
    const engine = new AudioEngine({ createContext: () => context });
    await engine.init();

    const bus = new EventBus();
    const sequencer = new Sequencer(engine, { bus });
    const arrangement = new Arrangement(sequencer, { bus });
    sequencer.arrangement = arrangement;

    if (chain.length) arrangement.setChain(chain);

    const patternEvents = [];
    bus.on(SEQUENCER_EVENTS.patternChanged, (event) => patternEvents.push(event));

    return { context, engine, bus, sequencer, arrangement, patternEvents };
}

function runAudio(context, ms) {
    const slice = 10;
    for (let elapsed = 0; elapsed < ms; elapsed += slice) {
        context.advance(slice / 1000);
        vi.advanceTimersByTime(slice);
    }
}

/** One bar at 120 BPM with 16 steps. */
const BAR_MS = 2000;

describe('Arrangement chain editing', () => {
    let arrangement;

    beforeEach(async () => {
        ({ arrangement } = await makeArrangement());
    });

    it('starts empty and inactive', () => {
        expect(arrangement.chain).toEqual([]);
        expect(arrangement.enabled).toBe(false);
        expect(arrangement.isActive).toBe(false);
    });

    it('adds, inserts, moves and removes measures', () => {
        arrangement.addToChain(0);
        arrangement.addToChain(2);
        arrangement.insertAtIndex(1, 1);
        expect(arrangement.getChain()).toEqual([0, 1, 2]);

        arrangement.moveInChain(0, 2);
        expect(arrangement.getChain()).toEqual([1, 2, 0]);

        arrangement.removeFromChain(1);
        expect(arrangement.getChain()).toEqual([1, 0]);
    });

    it('turns anything that is not a pattern into a silent measure', () => {
        arrangement.setChain([0, null, 99, undefined, 'x', 3]);
        expect(arrangement.getChain()).toEqual([0, null, null, null, null, 3]);
    });

    it('refuses to add an invalid pattern', () => {
        expect(arrangement.addToChain(8)).toBe(false);
        expect(arrangement.addToChain(-1)).toBe(false);
        expect(arrangement.getChain()).toEqual([]);
    });

    it('hands out a copy of the chain', () => {
        arrangement.setChain([0, 1]);
        arrangement.getChain().push(7);
        expect(arrangement.getChain()).toEqual([0, 1]);
    });

    it('clamps the playback position when the chain shrinks', () => {
        arrangement.setChain([0, 1, 2, 3]);
        arrangement.currentChainIndex = 3;

        arrangement.setChain([0, 1]);

        expect(arrangement.currentChainIndex).toBe(1);
    });

    it('keeps the position when asked to', () => {
        arrangement.setChain([0, 1, 2]);
        arrangement.currentChainIndex = 2;

        arrangement.setChain([0, 1, 2, 3], true);

        expect(arrangement.currentChainIndex).toBe(2);
    });

    it('reads a chain as letters', () => {
        expect(arrangement.getChainString()).toBe('(empty)');
        arrangement.setChain([0, 1, null, 2]);
        expect(arrangement.getChainString()).toBe('A-B---C');
    });

    it('loads a preset structure', () => {
        expect(arrangement.loadPreset('a-b-a')).toBe(true);
        expect(arrangement.getChain()).toEqual([0, 1, 0]);

        expect(arrangement.loadPreset('nope')).toBe(false);
        expect(arrangement.getChain()).toEqual([0, 1, 0]);
    });

    it('announces chain edits', async () => {
        const { arrangement: arr, bus } = await makeArrangement();
        const events = [];
        bus.on(ARRANGEMENT_EVENTS.changed, (event) => events.push(event));

        arr.addToChain(1);

        expect(events).toEqual([{ chain: [1], enabled: false }]);
    });
});

describe('Arrangement mode', () => {
    it('jumps to the first measure when enabled', async () => {
        const { sequencer, arrangement } = await makeArrangement([3, 1]);

        arrangement.enable();

        expect(arrangement.isActive).toBe(true);
        expect(sequencer.currentPattern).toBe(3);
    });

    it('leaves the pattern alone when the first measure is silent', async () => {
        const { sequencer, arrangement } = await makeArrangement([null, 1]);
        sequencer.switchPattern(5);

        arrangement.enable();

        expect(sequencer.currentPattern).toBe(5);
    });

    it('toggles in and out', async () => {
        const { arrangement } = await makeArrangement([0, 1]);

        expect(arrangement.toggle()).toBe(true);
        expect(arrangement.toggle()).toBe(false);
        expect(arrangement.currentChainIndex).toBe(0);
    });

    it('seeks to a measure and rewinds the step', async () => {
        const { sequencer, arrangement } = await makeArrangement([0, 1, 2, 3]);
        arrangement.enable();
        sequencer.currentStep = 7;

        expect(arrangement.seekTo(2)).toBe(true);

        expect(arrangement.currentChainIndex).toBe(2);
        expect(sequencer.currentPattern).toBe(2);
        expect(sequencer.currentStep).toBe(0);
        // The measure seeked to must play, not be skipped past
        expect(arrangement.hasPlayedFirstStep).toBe(false);
    });

    it('clamps a seek past the end of the chain', async () => {
        const { arrangement } = await makeArrangement([0, 1]);
        arrangement.seekTo(99);
        expect(arrangement.currentChainIndex).toBe(1);
    });
});

describe('Arrangement playback', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('plays one measure per pattern loop', async () => {
        const { context, sequencer, arrangement } = await makeArrangement([0, 1, 2]);
        arrangement.enable();
        sequencer.play();

        expect(arrangement.currentChainIndex).toBe(0);

        runAudio(context, BAR_MS);
        expect(arrangement.currentChainIndex).toBe(1);
        expect(sequencer.currentPattern).toBe(1);

        runAudio(context, BAR_MS);
        expect(arrangement.currentChainIndex).toBe(2);
    });

    it('does not advance on the very first step', async () => {
        const { context, sequencer, arrangement } = await makeArrangement([0, 1]);
        arrangement.enable();
        sequencer.play();

        runAudio(context, 200); // well inside the first measure

        expect(arrangement.currentChainIndex).toBe(0);
    });

    it('loops back to the top of the chain', async () => {
        const { context, sequencer, arrangement } = await makeArrangement([0, 1]);
        arrangement.enable();
        sequencer.play();

        runAudio(context, BAR_MS * 2);

        expect(arrangement.currentChainIndex).toBe(0);
        expect(sequencer.isPlaying).toBe(true);
    });

    it('stops at the end of the song when looping is off', async () => {
        const { context, sequencer, arrangement } = await makeArrangement([0, 1]);
        arrangement.enable();
        sequencer.toggleLoop(); // looping off
        sequencer.play();

        runAudio(context, BAR_MS * 2);

        expect(sequencer.isPlaying).toBe(false);
        expect(arrangement.currentChainIndex).toBe(0);
        expect(arrangement.hasPlayedFirstStep).toBe(false);
    });

    it('announces a measure change only when it is heard', async () => {
        const { context, sequencer, arrangement, patternEvents } = await makeArrangement([0, 1]);
        arrangement.enable();
        patternEvents.length = 0;

        sequencer.play();
        runAudio(context, BAR_MS);

        const chained = patternEvents.filter((event) => event.chainIndex !== undefined);
        expect(chained.at(-1)).toEqual({ pattern: 1, chainIndex: 1 });
    });

    it('silences a null measure but keeps playing', async () => {
        const { context, engine, sequencer, arrangement } = await makeArrangement([0, null, 0]);
        const played = [];
        engine.playNote = (frequency, track) => played.push(track);

        sequencer.setCell(0, 0, 'C', 4);
        arrangement.enable();
        sequencer.play();

        runAudio(context, BAR_MS); // now on the silent measure
        const afterFirst = played.length;
        // Stop short of the next measure: the scheduler books 100 ms ahead, so
        // running the silent bar to its very end already reaches the one after.
        runAudio(context, BAR_MS - 300);

        expect(afterFirst).toBeGreaterThan(0);
        expect(arrangement.currentChainIndex).toBe(1);
        expect(played.length).toBe(afterFirst); // nothing played while silent
        expect(sequencer.isPlaying).toBe(true);
    });

    it('returns to the first measure when playback stops', async () => {
        const { context, sequencer, arrangement } = await makeArrangement([0, 1, 2]);
        arrangement.enable();
        sequencer.play();
        runAudio(context, BAR_MS);

        sequencer.stop();

        expect(arrangement.currentChainIndex).toBe(0);
        expect(sequencer.currentPattern).toBe(0);
    });
});

describe('Arrangement persistence', () => {
    it('round-trips its state', async () => {
        const { arrangement } = await makeArrangement([0, null, 2]);
        arrangement.enable();
        arrangement.mixerMeasures = 16;
        const saved = arrangement.serialize();

        const { arrangement: fresh } = await makeArrangement();
        fresh.deserialize(saved);

        expect(fresh.serialize()).toEqual(saved);
        expect(fresh.getChain()).toEqual([0, null, 2]);
        expect(fresh.mixerMeasures).toBe(16);
    });

    it('defaults a project saved without mixer measures', async () => {
        const { arrangement } = await makeArrangement();
        arrangement.deserialize({ enabled: true, chain: [1] });

        expect(arrangement.mixerMeasures).toBe(8);
    });

    it('empties the song for a project that has none, instead of keeping the last one', async () => {
        const { arrangement } = await makeArrangement([0, 1]);
        arrangement.enable();
        arrangement.mixerMeasures = 22;

        arrangement.deserialize(null);

        expect(arrangement.getChain()).toEqual([]);
        expect(arrangement.enabled).toBe(false);
        expect(arrangement.mixerMeasures).toBe(8);
    });

    it('takes the measure count of the project it opens, smaller as well', async () => {
        const { arrangement } = await makeArrangement();
        arrangement.mixerMeasures = 22;

        arrangement.deserialize({ enabled: true, chain: [0, 1, 2], mixerMeasures: 16 });

        expect(arrangement.mixerMeasures).toBe(16);
    });
});
