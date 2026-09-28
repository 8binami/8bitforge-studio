/**
 * Recording into the grid.
 *
 * All of this is timing and placement, and both fail quietly: a note one
 * step late still looks like a note, and a chord that lost its fourth
 * voice still sounds like a chord. So the tests are about where things
 * land rather than that anything happened.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Recorder, RECORDER_EVENTS, CHORD_WINDOW_MS } from '../src/sequencer/recorder.js';
import { Sequencer } from '../src/sequencer/sequencer.js';
import { AudioEngine } from '../src/audio/audio-engine.js';
import { EventBus } from '../src/core/event-bus.js';
import { FakeAudioContext } from './helpers/fake-audio-context.js';

function make() {
    const engine = new AudioEngine({ createContext: () => new FakeAudioContext() });
    const bus = new EventBus();
    const sequencer = new Sequencer(engine, { bus });

    return { sequencer, bus, recorder: new Recorder(sequencer, { bus }) };
}

/** What is written on a track, as `step:NOTE` for the steps that have one. */
function notesOn(sequencer, track) {
    const found = [];
    for (let step = 0; step < sequencer.steps; step++) {
        const cell = sequencer.getCell(track, step);
        if (cell) found.push(`${step}:${cell.note}${cell.octave}`);
    }
    return found;
}

describe('the recorder at rest', () => {
    let sequencer;
    let recorder;

    beforeEach(() => {
        ({ sequencer, recorder } = make());
    });

    it('writes nothing when it is not recording', () => {
        recorder.noteOn('C', 4, 0);

        expect(recorder.isRecording).toBe(false);
        expect(notesOn(sequencer, 0)).toEqual([]);
    });

    it('writes nothing in real time until the sequencer is running', () => {
        recorder.startRealtime();
        recorder.noteOn('C', 4, 0);

        // Playing along with a stopped transport is playing, not recording:
        // there is no step to write to.
        expect(notesOn(sequencer, 0)).toEqual([]);
    });

    it('ignores rest and backspace outside step mode', () => {
        recorder.startRealtime();
        recorder.rest();
        recorder.backspace();

        expect(recorder.stepCursor).toBe(0);
    });
});

describe('step recording', () => {
    let sequencer;
    let recorder;

    beforeEach(() => {
        ({ sequencer, recorder } = make());
        recorder.startStep();
    });

    it('writes each note at the cursor and moves on', () => {
        recorder.noteOn('C', 4, 0);
        recorder.noteOn('E', 4, 0);
        recorder.noteOn('G', 4, 0);

        expect(notesOn(sequencer, 0)).toEqual(['0:C4', '1:E4', '2:G4']);
        expect(recorder.stepCursor).toBe(3);
    });

    it('writes to the track the note was played on', () => {
        recorder.noteOn('C', 2, 2);

        expect(notesOn(sequencer, 2)).toEqual(['0:C2']);
        expect(notesOn(sequencer, 0)).toEqual([]);
    });

    it('leaves a gap for a rest', () => {
        recorder.noteOn('C', 4, 0);
        recorder.rest();
        recorder.noteOn('E', 4, 0);

        expect(notesOn(sequencer, 0)).toEqual(['0:C4', '2:E4']);
    });

    it('goes back a step, so the last note can be played again', () => {
        recorder.noteOn('C', 4, 0);
        recorder.backspace();
        recorder.noteOn('D', 4, 0);

        expect(notesOn(sequencer, 0)).toEqual(['0:D4']);
    });

    it('wraps round the end of the pattern in both directions', () => {
        sequencer.setSteps(4);

        for (const note of ['C', 'D', 'E', 'F']) recorder.noteOn(note, 4, 0);
        expect(recorder.stepCursor).toBe(0);

        recorder.backspace();
        expect(recorder.stepCursor).toBe(3);
    });

    it('never writes past the end of a pattern that was shortened under it', () => {
        sequencer.setSteps(32);
        for (let i = 0; i < 20; i++) recorder.noteOn('C', 4, 0);
        expect(recorder.stepCursor).toBe(20);

        sequencer.setSteps(16);
        recorder.noteOn('G', 5, 0);

        // The cursor was past the end; the note goes to the start rather
        // than into a step nobody will ever hear.
        expect(sequencer.getCell(0, 0)).toEqual({ note: 'G', octave: 5 });
        expect(recorder.stepCursor).toBe(1);
    });

    it('starts at the beginning each time it is armed', () => {
        recorder.noteOn('C', 4, 0);
        recorder.noteOn('D', 4, 0);
        recorder.stop();
        recorder.startStep();

        expect(recorder.stepCursor).toBe(0);
    });
});

describe('real-time recording', () => {
    let sequencer;
    let recorder;

    beforeEach(() => {
        ({ sequencer, recorder } = make());
        sequencer.isPlaying = true;
        recorder.startRealtime();
    });

    it('writes at the step being heard, not the one being scheduled', () => {
        // The scheduler books up to a tenth of a second ahead, so
        // `currentStep` is already past what is coming out of the speakers.
        sequencer.currentStep = 9;
        sequencer.displayStep = 6;

        recorder.noteOn('C', 4, 1);

        expect(notesOn(sequencer, 1)).toEqual(['6:C4']);
    });

    it('falls back to the scheduler when nothing has been heard yet', () => {
        sequencer.currentStep = 3;
        sequencer.displayStep = null;

        recorder.noteOn('C', 4, 0);

        expect(notesOn(sequencer, 0)).toEqual(['3:C4']);
    });

    it('overwrites whatever was on that step', () => {
        sequencer.setCell(0, 5, 'A', 3);
        sequencer.displayStep = 5;

        recorder.noteOn('C', 4, 0);

        expect(sequencer.getCell(0, 5)).toEqual({ note: 'C', octave: 4 });
    });
});

describe('chords', () => {
    let sequencer;
    let recorder;

    beforeEach(() => {
        vi.useFakeTimers();
        ({ sequencer, recorder } = make());
        recorder.setChordMode(true);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('spreads notes played together across the melodic tracks', () => {
        recorder.startStep();
        recorder.noteOn('C', 4, 0);
        recorder.noteOn('E', 4, 0);
        recorder.noteOn('G', 4, 0);
        vi.advanceTimersByTime(CHORD_WINDOW_MS);

        // One note per step per track, so a chord has to go sideways.
        expect(notesOn(sequencer, 0)).toEqual(['0:C4']);
        expect(notesOn(sequencer, 1)).toEqual(['0:E4']);
        expect(notesOn(sequencer, 2)).toEqual(['0:G4']);
    });

    it('keeps the first note on the track it was played on', () => {
        recorder.startStep();
        recorder.noteOn('C', 2, 2);
        recorder.noteOn('E', 3, 2);
        vi.advanceTimersByTime(CHORD_WINDOW_MS);

        expect(notesOn(sequencer, 2)).toEqual(['0:C2']);
        // Track 2 is taken by the note that was played there, so the second
        // note takes the first melodic track still free.
        expect(notesOn(sequencer, 0)).toEqual(['0:E3']);
    });

    it('drops a fifth voice rather than writing it somewhere wrong', () => {
        recorder.startStep();
        for (const note of ['C', 'E', 'G', 'B', 'D']) recorder.noteOn(note, 4, 0);
        vi.advanceTimersByTime(CHORD_WINDOW_MS);

        const written = [0, 1, 2, 3].flatMap((track) => notesOn(sequencer, track));
        expect(written).toHaveLength(4);
        expect(written).not.toContain('0:D4');
    });

    it('moves the cursor on once for the whole chord', () => {
        recorder.startStep();
        recorder.noteOn('C', 4, 0);
        recorder.noteOn('E', 4, 0);
        vi.advanceTimersByTime(CHORD_WINDOW_MS);

        expect(recorder.stepCursor).toBe(1);
    });

    it('keeps waiting while notes are still arriving', () => {
        recorder.startStep();
        recorder.noteOn('C', 4, 0);
        vi.advanceTimersByTime(CHORD_WINDOW_MS - 10);
        recorder.noteOn('E', 4, 0);
        vi.advanceTimersByTime(CHORD_WINDOW_MS - 10);

        // Still inside the window the second note pushed back: a chord is
        // over when the playing stops, not a fixed time after it started.
        expect(notesOn(sequencer, 1)).toEqual([]);

        vi.advanceTimersByTime(10);
        expect(notesOn(sequencer, 1)).toEqual(['0:E4']);
    });

    it('separates two chords played one after the other', () => {
        recorder.startStep();
        recorder.noteOn('C', 4, 0);
        recorder.noteOn('E', 4, 0);
        vi.advanceTimersByTime(CHORD_WINDOW_MS);
        recorder.noteOn('D', 4, 0);
        recorder.noteOn('F', 4, 0);
        vi.advanceTimersByTime(CHORD_WINDOW_MS);

        expect(notesOn(sequencer, 0)).toEqual(['0:C4', '1:D4']);
        expect(notesOn(sequencer, 1)).toEqual(['0:E4', '1:F4']);
    });

    it('writes a chord at the step its first note was played on', () => {
        sequencer.isPlaying = true;
        recorder.startRealtime();

        sequencer.displayStep = 4;
        recorder.noteOn('C', 4, 0);
        // The sequencer moves on while the window is still open. A chord
        // split over two steps is not a chord.
        sequencer.displayStep = 5;
        recorder.noteOn('E', 4, 0);
        vi.advanceTimersByTime(CHORD_WINDOW_MS);

        expect(notesOn(sequencer, 0)).toEqual(['4:C4']);
        expect(notesOn(sequencer, 1)).toEqual(['4:E4']);
    });

    it('writes what was half-played when recording stops', () => {
        recorder.startStep();
        recorder.noteOn('C', 4, 0);
        recorder.noteOn('E', 4, 0);
        recorder.stop();

        // Without waiting for the window: stopping is the end of the chord.
        expect(notesOn(sequencer, 0)).toEqual(['0:C4']);
        expect(notesOn(sequencer, 1)).toEqual(['0:E4']);
    });
});

describe('what the recorder announces', () => {
    let bus;
    let recorder;

    beforeEach(() => {
        ({ bus, recorder } = make());
    });

    it('says when the mode changes, and only then', () => {
        const seen = [];
        bus.on(RECORDER_EVENTS.modeChanged, (mode) => seen.push(mode));

        recorder.startStep();
        recorder.startStep();
        recorder.stop();
        recorder.stop();

        expect(seen).toEqual(['step', 'off']);
    });

    it('says where the cursor is, and that there is none once it stops', () => {
        const seen = [];
        bus.on(RECORDER_EVENTS.cursorMoved, (step) => seen.push(step));

        recorder.startStep();
        recorder.noteOn('C', 4, 0);
        recorder.rest();
        recorder.stop();

        expect(seen).toEqual([0, 1, 2, null]);
    });
});
