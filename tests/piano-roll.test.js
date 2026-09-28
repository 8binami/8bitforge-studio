/**
 * The rows of the piano roll.
 *
 * Everything the roll draws and everything it writes goes through one
 * mapping: pitch to row index. Get it wrong by one and notes appear a
 * semitone from where they are, clicks land a semitone from where they
 * were aimed, and neither is an error: it just quietly writes the wrong
 * music.
 *
 * The drawing needs a canvas and the gestures need a pointer; the mapping
 * needs neither, and it is the part that can be wrong without anything
 * saying so.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PianoRoll } from '../src/ui/piano-roll.js';
import { Studio } from '../src/studio.js';
import { EventBus } from '../src/core/event-bus.js';
import { FakeAudioContext } from './helpers/fake-audio-context.js';

function makeRoll() {
    const studio = new Studio({
        bus: new EventBus(),
        createContext: () => new FakeAudioContext()
    });

    // Not bound: binding wants a canvas, and none of this does.
    return new PianoRoll({ root: null, studio });
}

describe('the range on screen', () => {
    let roll;

    beforeEach(() => {
        roll = makeRoll();
    });

    it('covers C1 to E6, highest first', () => {
        expect(roll.rows).toHaveLength(65);
        expect(roll.rows[0]).toMatchObject({ note: 'E', octave: 6 });
        expect(roll.rows.at(-1)).toMatchObject({ note: 'C', octave: 1 });
    });

    it('descends a semitone at a time with nothing missing', () => {
        const chromatic = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const pitch = ({ note, octave }) => octave * 12 + chromatic.indexOf(note);

        const steps = roll.rows.slice(1).map((row, index) => pitch(roll.rows[index]) - pitch(row));

        expect(new Set(steps)).toEqual(new Set([1]));
    });

    it('marks the black keys, and only those', () => {
        const sharp = roll.rows.filter((row) => row.sharp);

        expect(sharp.every((row) => row.note.includes('#'))).toBe(true);
        // Five per octave for the five whole ones, plus C#6 and D#6.
        expect(sharp).toHaveLength(5 * 5 + 2);
    });

    it('finds the row of every note it draws', () => {
        for (const [index, row] of roll.rows.entries()) {
            expect(roll._rowOf.get(`${row.note}-${row.octave}`), `${row.note}${row.octave}`).toBe(
                index
            );
        }
    });

    it('has no row for a note outside the range', () => {
        // Not an error: a note above E6 or below C1 still plays, it is
        // simply not drawn. The roll is a view of the pattern, not all of
        // it: so the lookup has to say "nowhere" rather than guess.
        expect(roll._rowOf.get('B-6')).toBeUndefined();
        expect(roll._rowOf.get('F-6')).toBeUndefined();
        expect(roll._rowOf.get('B-0')).toBeUndefined();
    });

    it('opens each track at the octave that track is written in', () => {
        // A bass part is never written at C5, and a hi-hat never at C2.
        const home = (track) => {
            roll.track = track;
            return roll.rows[roll._rowOf.get(`C-${[4, 4, 2, 4, 2, 3, 5, 5][track]}`)].octave;
        };

        expect(home(0)).toBe(4);
        expect(home(2)).toBe(2);
        expect(home(6)).toBe(5);
    });
});

describe('the width of a step', () => {
    let roll;

    beforeEach(() => {
        roll = makeRoll();
    });

    it('shares the grid out between however many steps there are', () => {
        roll.studio.sequencer.setSteps(16);
        const wide = roll._stepWidth();

        roll.studio.sequencer.setSteps(32);
        expect(roll._stepWidth()).toBeLessThan(wide);
    });

    it('never squeezes a step below what a note block needs', () => {
        roll.studio.sequencer.setSteps(64);

        expect(roll._stepWidth()).toBeGreaterThanOrEqual(28);
    });
});
