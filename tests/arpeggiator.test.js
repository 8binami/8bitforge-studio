import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AudioEngine } from '../src/audio/audio-engine.js';
import { Arpeggiator } from '../src/compose/arpeggiator.js';
import { FakeAudioContext } from './helpers/fake-audio-context.js';

async function makeArpeggiator({ tempo = 120 } = {}) {
    const context = new FakeAudioContext();
    const engine = new AudioEngine({ createContext: () => context });
    await engine.init();

    const played = [];
    const stopped = [];
    let noteId = 0;
    engine.playNote = (frequency, track, duration) => {
        const id = `note-${++noteId}`;
        played.push({ id, frequency, track, duration });
        return id;
    };
    engine.stopNote = (id) => stopped.push(id);

    const arp = new Arpeggiator(engine, { getTempo: () => tempo });
    return { engine, context, arp, played, stopped };
}

describe('Arpeggiator settings', () => {
    it('starts off on every track', async () => {
        const { arp } = await makeArpeggiator();

        expect(arp.getSettings(0)).toEqual({ mode: 'off', rate: '1/8', octaves: 1, gate: 0.5 });
        expect(arp.isEnabled(0)).toBe(false);
    });

    it('hands back a copy of the settings', async () => {
        const { arp } = await makeArpeggiator();
        const settings = arp.getSettings(0);
        settings.mode = 'up';

        expect(arp.getSettings(0).mode).toBe('off');
    });

    it('keeps settings per track', async () => {
        const { arp } = await makeArpeggiator();

        arp.updateSettings(3, { mode: 'down', octaves: 2 });

        expect(arp.getSettings(3)).toMatchObject({ mode: 'down', octaves: 2, rate: '1/8' });
        expect(arp.getSettings(0).mode).toBe('off');
    });
});

describe('Arpeggiator sequence', () => {
    let arp;

    beforeEach(async () => {
        ({ arp } = await makeArpeggiator());
    });

    it('runs up through the held notes', () => {
        expect(arp.buildSequence([220, 330, 440], { mode: 'up', octaves: 1 })).toEqual([
            220, 330, 440
        ]);
    });

    it('runs down', () => {
        expect(arp.buildSequence([220, 330, 440], { mode: 'down', octaves: 1 })).toEqual([
            440, 330, 220
        ]);
    });

    it('repeats the notes an octave up for each extra octave', () => {
        expect(arp.buildSequence([220, 330], { mode: 'up', octaves: 3 })).toEqual([
            220, 330, 440, 660, 880, 1320
        ]);
    });
});

describe('Arpeggiator rate', () => {
    it('follows the project tempo', async () => {
        const { arp } = await makeArpeggiator({ tempo: 120 });
        arp.updateSettings(0, { rate: '1/8' });
        expect(arp.getIntervalMs(0)).toBe(250);

        const fast = await makeArpeggiator({ tempo: 240 });
        fast.arp.updateSettings(0, { rate: '1/8' });
        expect(fast.arp.getIntervalMs(0)).toBe(125);
    });

    it('reads every rate division', async () => {
        const { arp } = await makeArpeggiator({ tempo: 120 });

        arp.updateSettings(0, { rate: '1/4' });
        expect(arp.getIntervalMs(0)).toBe(500);
        arp.updateSettings(0, { rate: '1/16' });
        expect(arp.getIntervalMs(0)).toBe(125);
        arp.updateSettings(0, { rate: '1/8T' });
        expect(arp.getIntervalMs(0)).toBeCloseTo(166.67, 1);
    });

    it('falls back to an eighth on an unknown rate', async () => {
        const { arp } = await makeArpeggiator({ tempo: 120 });
        arp.updateSettings(0, { rate: 'nonsense' });
        expect(arp.getIntervalMs(0)).toBe(250);
    });
});

describe('Arpeggiator playback', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('leaves the note to the caller when it is off', async () => {
        const { arp, played } = await makeArpeggiator();

        expect(arp.noteOn(0, 440)).toBeNull();
        expect(played).toHaveLength(0);
    });

    it('takes the note over and plays the sequence', async () => {
        const { arp, played } = await makeArpeggiator();
        arp.updateSettings(0, { mode: 'up' });

        expect(arp.noteOn(0, 220)).toBe('arp');
        arp.noteOn(0, 330);

        expect(played[0].frequency).toBe(220);

        vi.advanceTimersByTime(250);
        expect(played[1].frequency).toBe(330);

        vi.advanceTimersByTime(250);
        expect(played[2].frequency).toBe(220); // round again
    });

    it('holds each note for the gate fraction of the interval', async () => {
        const { arp, played } = await makeArpeggiator();
        arp.updateSettings(0, { mode: 'up', gate: 0.25 });

        arp.noteOn(0, 440);

        expect(played[0].duration).toBeCloseTo(0.0625, 5); // 250 ms × 0.25
    });

    it('stops the previous note before the next one', async () => {
        const { arp, played, stopped } = await makeArpeggiator();
        arp.updateSettings(0, { mode: 'up' });
        arp.noteOn(0, 440);

        vi.advanceTimersByTime(250);

        expect(stopped).toContain(played[0].id);
    });

    it('picks up a note added while it is running', async () => {
        const { arp, played } = await makeArpeggiator();
        arp.updateSettings(0, { mode: 'up' });
        arp.noteOn(0, 220);

        vi.advanceTimersByTime(250);
        arp.noteOn(0, 440); // joins the held notes
        vi.advanceTimersByTime(750);

        expect(played.map((note) => note.frequency)).toContain(440);
    });

    it('stops when the last note is released', async () => {
        const { arp, played } = await makeArpeggiator();
        arp.updateSettings(0, { mode: 'up' });
        arp.noteOn(0, 220);
        arp.noteOn(0, 440);

        arp.noteOff(0, 220);
        vi.advanceTimersByTime(250);
        const whileHeld = played.length;

        arp.noteOff(0, 440);
        vi.advanceTimersByTime(1000);

        expect(arp.activeArps.size).toBe(0);
        expect(played).toHaveLength(whileHeld);
    });

    it('bounces back and forth in up-down mode', async () => {
        const { arp, played } = await makeArpeggiator();
        arp.updateSettings(0, { mode: 'updown' });
        arp.noteOn(0, 220); // sounds at once, on a chord of one note
        arp.noteOn(0, 330);
        arp.noteOn(0, 440);

        for (let tick = 0; tick < 7; tick++) vi.advanceTimersByTime(250);

        // The first two notes land while the chord is still being built, so
        // the bounce only settles once the three notes are held.
        expect(played.slice(2, 8).map((note) => note.frequency)).toEqual([
            220, 330, 440, 330, 220, 330
        ]);
    });

    it('silences every running arpeggio on panic', async () => {
        const { arp } = await makeArpeggiator();
        arp.updateSettings(0, { mode: 'up' });
        arp.updateSettings(2, { mode: 'up' });
        arp.noteOn(0, 220);
        arp.noteOn(2, 330);

        arp.stopAll();

        expect(arp.activeArps.size).toBe(0);
    });
});
