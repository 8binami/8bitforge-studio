import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AudioEngine } from '../src/audio/audio-engine.js';
import { Sequencer, SEQUENCER_EVENTS, MAX_STEPS } from '../src/sequencer/sequencer.js';
import { EventBus } from '../src/core/event-bus.js';
import { FakeAudioContext } from './helpers/fake-audio-context.js';

async function makeSequencer() {
    const context = new FakeAudioContext();
    const engine = new AudioEngine({ createContext: () => context });
    await engine.init();

    const bus = new EventBus();
    const steps = [];
    bus.on(SEQUENCER_EVENTS.step, (event) => steps.push(event));

    const played = [];
    const realPlayNote = engine.playNote.bind(engine);
    engine.playNote = (frequency, track, duration, time) => {
        played.push({ frequency, track, duration, time });
        return realPlayNote(frequency, track, duration, time);
    };

    return { engine, context, bus, steps, played, sequencer: new Sequencer(engine, { bus }) };
}

/** Run the scheduler and the visual callbacks over a stretch of audio time. */
function runAudio(context, ms) {
    const slice = 10;
    for (let elapsed = 0; elapsed < ms; elapsed += slice) {
        context.advance(slice / 1000);
        vi.advanceTimersByTime(slice);
    }
}

describe('Sequencer cells', () => {
    let sequencer;

    beforeEach(async () => {
        ({ sequencer } = await makeSequencer());
    });

    it('starts empty, sixteen steps, at 120 BPM', () => {
        expect(sequencer.bpm).toBe(120);
        expect(sequencer.steps).toBe(16);
        expect(sequencer.patterns).toHaveLength(8);
        expect(sequencer.patterns[0][0]).toHaveLength(MAX_STEPS);
        expect(sequencer.patternHasContent(0)).toBe(false);
    });

    it('toggles a cell on with the track default note', () => {
        sequencer.toggleCell(2, 0); // bass
        sequencer.toggleCell(4, 4); // kick

        expect(sequencer.getCell(2, 0)).toEqual({ note: 'C', octave: 2 });
        expect(sequencer.getCell(4, 4)).toEqual({ note: 'C', octave: 2 });
        expect(sequencer.getCell(0, 0)).toBeNull();
    });

    it('prefers the last note played on the keyboard', () => {
        // How a melody gets written without the piano roll: play the
        // note, then click the steps. For a long time the field this
        // reads was declared, documented and read, and written by
        // nothing at all, so every clicked step took the track default.
        sequencer.rememberNote('F#', 5);
        sequencer.toggleCell(0, 3);

        expect(sequencer.getCell(0, 3)).toEqual({ note: 'F#', octave: 5 });
    });

    it('forgets the note when asked, and the track default comes back', () => {
        sequencer.rememberNote('F#', 5);
        sequencer.rememberNote(null);
        sequencer.toggleCell(2, 0);

        expect(sequencer.getCell(2, 0)).toEqual({ note: 'C', octave: 2 });
    });

    it('toggles a cell back off', () => {
        sequencer.toggleCell(0, 1);
        sequencer.toggleCell(0, 1);

        expect(sequencer.getCell(0, 1)).toBeNull();
    });

    it('clears notes past the visible length when a track is cleared', () => {
        sequencer.setSteps(32);
        sequencer.setCell(0, 31, 'C', 4);
        sequencer.setSteps(16);

        sequencer.clearTrack(0);

        expect(sequencer.getCell(0, 31)).toBeNull();
    });

    it('copies and pastes a track without sharing note objects', () => {
        sequencer.setCell(0, 0, 'E', 4);
        const copied = sequencer.copyTrack(0);

        sequencer.pasteTrack(1, copied);
        sequencer.setCell(0, 0, 'G', 4);

        expect(sequencer.getCell(1, 0)).toEqual({ note: 'E', octave: 4 });
    });

    it('randomises a drum track at a fixed pitch', () => {
        sequencer.randomizeTrack(4);

        const notes = [];
        for (let step = 0; step < sequencer.steps; step++) {
            const cell = sequencer.getCell(4, step);
            if (cell) notes.push(cell);
        }
        expect(notes.length).toBeGreaterThan(0);
        expect(notes.every((cell) => cell.note === 'C' && cell.octave === 2)).toBe(true);
    });

    it('announces cell changes so the grid can redraw', async () => {
        const { sequencer: seq, bus } = await makeSequencer();
        const events = [];
        bus.on(SEQUENCER_EVENTS.cellsChanged, (event) => events.push(event));

        seq.toggleCell(1, 2);

        expect(events).toEqual([{ pattern: 0, track: 1 }]);
    });
});

describe('Sequencer patterns', () => {
    let sequencer;

    beforeEach(async () => {
        ({ sequencer } = await makeSequencer());
    });

    it('duplicates a pattern deeply, states included', () => {
        sequencer.setCell(0, 0, 'A', 4);
        sequencer.toggleMute(0);

        expect(sequencer.duplicatePattern(0, 3)).toBe(true);
        sequencer.setCell(0, 0, 'B', 4);

        expect(sequencer.patterns[3][0][0]).toEqual({ note: 'A', octave: 4 });
        expect(sequencer.trackStates[3][0].mute).toBe(true);
    });

    it('refuses an out-of-range pattern index', () => {
        expect(sequencer.duplicatePattern(0, 99)).toBe(false);
        sequencer.switchPattern(12);
        expect(sequencer.currentPattern).toBe(0);
    });

    it('keeps solo and mute per pattern', () => {
        sequencer.toggleSolo(1);
        sequencer.switchPattern(1);

        expect(sequencer.getTrackStates(1)[1].solo).toBe(false);
        expect(sequencer.getTrackStates(0)[1].solo).toBe(true);
    });

    it('clears a pattern along with its track states', () => {
        sequencer.setCell(0, 0, 'C', 4);
        sequencer.toggleSolo(0);

        sequencer.clearPattern(0);

        expect(sequencer.patternHasContent(0)).toBe(false);
        expect(sequencer.getTrackStates(0)[0].solo).toBe(false);
    });
});

describe('Sequencer audibility', () => {
    let sequencer;
    let engine;

    beforeEach(async () => {
        ({ sequencer, engine } = await makeSequencer());
    });

    it('hears every track by default', () => {
        expect(sequencer.isTrackAudible(0)).toBe(true);
    });

    it('silences the others when a track is soloed in the pattern', () => {
        sequencer.toggleSolo(2);

        expect(sequencer.isTrackAudible(2)).toBe(true);
        expect(sequencer.isTrackAudible(0)).toBe(false);
    });

    it('lets the mixer override the pattern', () => {
        sequencer.toggleSolo(2); // pattern solo on track 2
        engine.mixerSettings[5].solo = true; // mixer solo on track 5

        expect(sequencer.isTrackAudible(5)).toBe(true);
        expect(sequencer.isTrackAudible(2)).toBe(false);
    });

    it('honours a mixer mute whatever else is set', () => {
        sequencer.toggleSolo(3);
        engine.mixerSettings[3].mute = true;

        expect(sequencer.isTrackAudible(3)).toBe(false);
    });
});

describe('Sequencer playback', () => {
    let context;
    let sequencer;
    let played;
    let steps;
    let bus;

    beforeEach(async () => {
        vi.useFakeTimers();
        ({ context, sequencer, played, steps, bus } = await makeSequencer());
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('books notes ahead of the audio clock', () => {
        sequencer.setCell(0, 0, 'A', 4);
        sequencer.play();

        // Booked immediately, before any time passes
        expect(played).toHaveLength(1);
        expect(played[0].time).toBe(0);
        expect(played[0].frequency).toBeCloseTo(440, 1);
        // ...but not announced as heard yet
        expect(steps).toHaveLength(0);
    });

    it('announces a booked step with the moment it will be heard', () => {
        const booked = [];
        bus.on(SEQUENCER_EVENTS.scheduled, (event) => booked.push(event));

        sequencer.setCell(0, 0, 'A', 4);
        sequencer.play();

        // Anything that has to sound *with* a step (the metronome) has to
        // know before the step is heard, and know when. By the time `step`
        // is announced that moment has arrived and scheduling is too late.
        // The playhead reads the same booking, and needs the measure too.
        expect(booked.length).toBeGreaterThan(0);
        expect(booked[0]).toEqual({ step: 0, time: 0, chainIndex: 0 });
        expect(booked[0].time).toBe(played[0].time);
        expect(steps).toHaveLength(0);
    });

    it('announces a step when it is actually heard', () => {
        sequencer.setCell(0, 0, 'A', 4);
        sequencer.play();

        runAudio(context, 20);

        expect(steps[0]).toMatchObject({ step: 0, playedTracks: [0] });
        expect(sequencer.displayStep).toBe(0);
    });

    it('plays a bar of sixteenths in time', () => {
        for (let step = 0; step < 16; step++) sequencer.setCell(6, step, 'C', 5);
        sequencer.play();

        // At 120 BPM a sixteenth lasts 125 ms; one bar is 2 s.
        runAudio(context, 2000);

        expect(played.length).toBeGreaterThanOrEqual(16);
        expect(played[1].time - played[0].time).toBeCloseTo(0.125, 5);
    });

    it('skips muted tracks when scheduling', () => {
        sequencer.setCell(0, 0, 'C', 4);
        sequencer.setCell(1, 0, 'E', 4);
        sequencer.toggleMute(1);

        sequencer.play();

        expect(played.map((note) => note.track)).toEqual([0]);
    });

    it('loops when it reaches the end of the pattern', () => {
        sequencer.setCell(0, 0, 'C', 4);
        sequencer.play();
        runAudio(context, 2100);

        expect(sequencer.isPlaying).toBe(true);
        expect(played.length).toBeGreaterThan(1); // step 0 came round again
    });

    it('stops at the end of the pattern when looping is off', () => {
        sequencer.toggleLoop();
        expect(sequencer.isLooping).toBe(false);

        sequencer.play();
        runAudio(context, 2100);

        expect(sequencer.isPlaying).toBe(false);
        expect(sequencer.currentStep).toBe(0);
    });

    it('resumes from where it was paused', () => {
        for (let step = 0; step < 16; step++) sequencer.setCell(6, step, 'C', 5);
        sequencer.play();
        runAudio(context, 500); // a few steps in

        sequencer.pause();
        const pausedAt = sequencer.currentStep;
        expect(sequencer.isPlaying).toBe(false);
        expect(pausedAt).toBeGreaterThan(0);

        const before = steps.length;
        sequencer.play();
        runAudio(context, 20);

        // The next step heard is the one the pause landed on, not step 0.
        expect(steps[before].step).toBe(pausedAt);
    });

    it('rewinds to the start on stop', () => {
        sequencer.play();
        runAudio(context, 500);
        sequencer.stop();

        expect(sequencer.currentStep).toBe(0);
        expect(sequencer.isPaused).toBe(false);

        // No stray notes after stopping
        const countAtStop = played.length;
        runAudio(context, 500);
        expect(played).toHaveLength(countAtStop);
    });

    it('swings the off-beats without changing the bar length', () => {
        for (let step = 0; step < 4; step++) sequencer.setCell(6, step, 'C', 5);
        sequencer.setSwing(0.5);
        sequencer.play();
        runAudio(context, 600);

        const [first, second, third] = played.map((note) => note.time);
        expect(second - first).toBeCloseTo(0.125 * 1.25, 5); // even step, stretched
        expect(third - second).toBeCloseTo(0.125 * 0.75, 5); // odd step, shortened
        expect(third - first).toBeCloseTo(0.25, 5); // two steps still take two steps
    });

    it('picks up a tempo change without restarting', () => {
        for (let step = 0; step < 8; step++) sequencer.setCell(6, step, 'C', 5);
        sequencer.play();
        runAudio(context, 300);

        sequencer.setBPM(240);
        const before = played.length;
        runAudio(context, 300);

        expect(played.length).toBeGreaterThan(before);
        const last = played.at(-1).time - played.at(-2).time;
        expect(last).toBeCloseTo(0.0625, 4); // sixteenths at 240 BPM
    });

    it('clamps the tempo to a usable range', () => {
        expect(sequencer.setBPM(5)).toBe(20);
        expect(sequencer.setBPM(9000)).toBe(300);
    });
});

describe('Sequencer arrangement', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('defers a chained pattern switch to the moment it is heard', async () => {
        const { context, sequencer, bus } = await makeSequencer();
        const switches = [];
        bus.on(SEQUENCER_EVENTS.patternChanged, (event) => switches.push(event));

        sequencer.arrangement = {
            enabled: true,
            chain: [0, 1],
            currentChainIndex: 0,
            getCurrentPattern: () => sequencer.currentPattern,
            resetPlayback: () => {},
            onStep: (step) => {
                if (step === 0) sequencer.switchPattern(1);
            }
        };

        sequencer.play();
        expect(switches).toHaveLength(0); // booked ahead, not announced yet

        runAudio(context, 20);
        expect(switches).toEqual([{ pattern: 1, chainIndex: 0 }]);
    });

    it('stays silent on an empty measure but keeps the display moving', async () => {
        const { context, sequencer, played, steps } = await makeSequencer();
        sequencer.setCell(0, 0, 'C', 4);

        sequencer.arrangement = {
            enabled: true,
            chain: [null],
            currentChainIndex: 0,
            getCurrentPattern: () => null,
            resetPlayback: () => {},
            onStep: () => {}
        };

        sequencer.play();
        runAudio(context, 20);

        expect(played).toHaveLength(0);
        expect(steps[0]).toMatchObject({ step: 0, playedTracks: [] });
    });
});

describe('Sequencer persistence', () => {
    it('round-trips its state', async () => {
        const { sequencer } = await makeSequencer();

        sequencer.setBPM(140);
        sequencer.setSteps(32);
        sequencer.setSwing(0.3);
        sequencer.setCell(0, 5, 'D#', 3);
        sequencer.toggleSolo(2);
        sequencer.switchPattern(2);
        const saved = sequencer.getState();

        const { sequencer: fresh } = await makeSequencer();
        fresh.setState(saved);

        expect(fresh.getState()).toEqual(saved);
        expect(fresh.getCell(0, 5, 0)).toEqual({ note: 'D#', octave: 3 });
        expect(fresh.getTrackStates(0)[2].solo).toBe(true);
    });

    it('does not share note objects with the state it was given', async () => {
        const { sequencer } = await makeSequencer();
        sequencer.setCell(0, 0, 'C', 4);
        const saved = sequencer.getState();

        sequencer.setCell(0, 0, 'G', 4);

        expect(saved.patterns[0][0][0]).toEqual({ note: 'C', octave: 4 });
    });

    it('reads the single-pattern layout of 1.x projects', async () => {
        const { sequencer } = await makeSequencer();

        sequencer.setState({
            bpm: 100,
            steps: 16,
            patterns: [
                [{ note: 'C', octave: 4 }, null],
                [null, { note: 'E', octave: 4 }]
            ],
            trackStates: [
                { solo: false, mute: true },
                { solo: false, mute: false }
            ]
        });

        expect(sequencer.bpm).toBe(100);
        expect(sequencer.getCell(0, 0, 0)).toEqual({ note: 'C', octave: 4 });
        expect(sequencer.getCell(1, 1, 0)).toEqual({ note: 'E', octave: 4 });
        // A flat set of states applied to every pattern
        expect(sequencer.getTrackStates(0)[0].mute).toBe(true);
        expect(sequencer.getTrackStates(5)[0].mute).toBe(true);
    });

    it('wipes previous state so nothing bleeds between projects', async () => {
        const { sequencer } = await makeSequencer();
        sequencer.setCell(0, 0, 'C', 4);
        sequencer.toggleMute(0);

        sequencer.setState({ bpm: 90, steps: 16, patterns: [], trackStates: [] });

        expect(sequencer.patternHasContent(0)).toBe(false);
        expect(sequencer.getTrackStates(0)[0].mute).toBe(false);
    });
});
