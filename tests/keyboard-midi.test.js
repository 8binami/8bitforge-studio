import { describe, it, expect } from 'vitest';
import { readNoteMessage } from '../src/ui/keyboard-panel.js';

describe('MIDI keyboard input', () => {
    it('hears notes on every channel, not only the first', () => {
        expect(readNoteMessage([0x90, 60, 100])).toEqual({ on: true, note: 60 });
        expect(readNoteMessage([0x93, 64, 90])).toEqual({ on: true, note: 64 });
        expect(readNoteMessage([0x9f, 67, 1])).toEqual({ on: true, note: 67 });
        expect(readNoteMessage([0x8a, 64, 0])).toEqual({ on: false, note: 64 });
    });

    it('takes a note-on at zero velocity for a note-off', () => {
        expect(readNoteMessage([0x95, 60, 0])).toEqual({ on: false, note: 60 });
    });

    it('ignores what is not a note', () => {
        expect(readNoteMessage([0xb0, 7, 100])).toBeNull(); // a controller
        expect(readNoteMessage([0xf8])).toBeNull(); // clock
        expect(readNoteMessage([0xd0, 40, 0])).toBeNull(); // aftertouch
        expect(readNoteMessage(null)).toBeNull();
    });
});
