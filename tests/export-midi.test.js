import { describe, it, expect } from 'vitest';
import { generateMidi, encodeMidi, MIDI_DEFAULTS } from '../src/export/midi.js';

/** A song description with one note on the lead track, unless told otherwise. */
function makeSong(overrides = {}) {
    const emptyPattern = () => Array.from({ length: 8 }, () => new Array(16).fill(null));
    const patterns = [emptyPattern(), emptyPattern()];
    patterns[0][0][0] = { note: 'A', octave: 4 };

    return {
        patterns,
        patternOrder: [0],
        steps: 16,
        bpm: 120,
        swing: 0,
        tracks: Array.from({ length: 8 }, (_, index) => ({
            name: `Track ${index}`,
            volume: 0.5,
            pan: 0
        })),
        ...overrides
    };
}

const ascii = (bytes, offset, length) =>
    String.fromCharCode(...bytes.slice(offset, offset + length));

/** Walk the chunks of a MIDI file: [{ type, length, body }]. */
function readChunks(bytes) {
    const chunks = [];
    let offset = 0;
    while (offset < bytes.length) {
        const type = ascii(bytes, offset, 4);
        const view = new DataView(bytes.buffer, bytes.byteOffset + offset + 4, 4);
        const length = view.getUint32(0);
        chunks.push({ type, length, body: bytes.slice(offset + 8, offset + 8 + length) });
        offset += 8 + length;
    }
    return chunks;
}

/** Every status byte of a track body, skipping delta times and data bytes. */
function readEvents(body) {
    const events = [];
    let i = 0;
    const readDelta = () => {
        let value = 0;
        while (i < body.length) {
            const byte = body[i++];
            value = (value << 7) | (byte & 0x7f);
            if ((byte & 0x80) === 0) break;
        }
        return value;
    };

    while (i < body.length) {
        const delta = readDelta();
        const status = body[i++];

        if (status === 0xff) {
            const subtype = body[i++];
            let length = 0;
            let byte;
            do {
                byte = body[i++];
                length = (length << 7) | (byte & 0x7f);
            } while (byte & 0x80);
            const data = body.slice(i, i + length);
            i += length;
            events.push({ delta, meta: subtype, data });
        } else {
            const type = status & 0xf0;
            const channel = status & 0x0f;
            const dataLength = type === 0xc0 || type === 0xd0 ? 1 : 2;
            const data = body.slice(i, i + dataLength);
            i += dataLength;
            events.push({ delta, type, channel, data });
        }
    }
    return events;
}

describe('generateMidi header', () => {
    it('writes an MThd chunk describing the file', () => {
        const bytes = generateMidi(makeSong());
        const view = new DataView(bytes.buffer, bytes.byteOffset);

        expect(ascii(bytes, 0, 4)).toBe('MThd');
        expect(view.getUint32(4)).toBe(6);
        expect(view.getUint16(8)).toBe(1); // format 1
        expect(view.getUint16(12)).toBe(MIDI_DEFAULTS.ticksPerBeat);
    });

    it('writes a tempo track plus one track per instrument in format 1', () => {
        const chunks = readChunks(generateMidi(makeSong(), { format: 1 }));

        expect(chunks[0].type).toBe('MThd');
        expect(chunks.filter((chunk) => chunk.type === 'MTrk')).toHaveLength(9); // tempo + 8
    });

    it('leaves the tempo track out in format 0', () => {
        const chunks = readChunks(generateMidi(makeSong(), { format: 0 }));
        expect(chunks.filter((chunk) => chunk.type === 'MTrk')).toHaveLength(8);
    });

    it('states the tempo in microseconds per beat', () => {
        const chunks = readChunks(generateMidi(makeSong({ bpm: 150 })));
        const tempo = readEvents(chunks[1].body).find((event) => event.meta === 0x51);
        const value = (tempo.data[0] << 16) | (tempo.data[1] << 8) | tempo.data[2];

        expect(value).toBe(Math.round(60000000 / 150));
    });

    it('closes every track', () => {
        const chunks = readChunks(generateMidi(makeSong()));
        for (const chunk of chunks.filter((c) => c.type === 'MTrk')) {
            const events = readEvents(chunk.body);
            expect(events.at(-1).meta).toBe(0x2f);
        }
    });
});

describe('generateMidi notes', () => {
    /** The events of one audio track, skipping the tempo track. */
    const trackEvents = (bytes, trackIndex) =>
        readEvents(readChunks(bytes).filter((c) => c.type === 'MTrk')[trackIndex + 1].body);

    it('converts a note and octave to a MIDI note number', () => {
        const events = trackEvents(generateMidi(makeSong()), 0);
        const noteOn = events.find((event) => event.type === 0x90);

        expect(noteOn.data[0]).toBe(69); // A4
    });

    it('pairs every note on with a note off', () => {
        const song = makeSong();
        song.patterns[0][0][4] = { note: 'C', octave: 5 };
        const events = trackEvents(generateMidi(song), 0);

        expect(events.filter((event) => event.type === 0x90)).toHaveLength(2);
        expect(events.filter((event) => event.type === 0x80)).toHaveLength(2);
    });

    it('keeps consecutive notes one step apart', () => {
        const song = makeSong();
        song.patterns[0][0][1] = { note: 'B', octave: 4 };
        song.patterns[0][0][2] = { note: 'C', octave: 5 };
        const events = trackEvents(generateMidi(song), 0);

        // Deltas are relative, so read the absolute position of each note on.
        let tick = 0;
        const onsets = [];
        for (const event of events) {
            tick += event.delta;
            if (event.type === 0x90) onsets.push(tick);
        }

        // A step is a sixteenth: 120 ticks at 480 per beat.
        expect(onsets).toEqual([0, 120, 240]);
    });

    it('ends a note when the next one starts', () => {
        const song = makeSong();
        song.patterns[0][0][1] = { note: 'A', octave: 4 }; // same pitch, next step
        const events = trackEvents(generateMidi(song), 0);

        let tick = 0;
        const timeline = [];
        for (const event of events) {
            tick += event.delta;
            if (event.type === 0x90 || event.type === 0x80) {
                timeline.push({ tick, on: event.type === 0x90 });
            }
        }

        // off, on, off: never two note ons of the same pitch left hanging
        expect(timeline.map((entry) => entry.on)).toEqual([true, false, true, false]);
        expect(timeline[1].tick).toBe(120); // the first note ends where the second starts
    });

    it('lets an isolated note ring for its full length', () => {
        const events = trackEvents(generateMidi(makeSong()), 0);
        const noteOff = events.find((event) => event.type === 0x80);

        expect(noteOff.delta).toBe(432); // 0.9 of a beat at 480 ticks
    });

    it('sends the drums to the GM percussion channel', () => {
        const song = makeSong();
        song.patterns[0][4][0] = { note: 'C', octave: 2 }; // kick
        const events = trackEvents(generateMidi(song), 4);
        const noteOn = events.find((event) => event.type === 0x90);

        expect(noteOn.channel).toBe(9);
        expect(noteOn.data[0]).toBe(36); // GM bass drum, whatever pitch was stored
    });

    it('gives melodic tracks a General MIDI program', () => {
        const events = trackEvents(generateMidi(makeSong()), 0);
        const program = events.find((event) => event.type === 0xc0);

        expect(program.data[0]).toBe(80); // square lead
    });

    it('sends no program change on the drum channel', () => {
        const song = makeSong();
        song.patterns[0][5][0] = { note: 'C', octave: 3 };
        const events = trackEvents(generateMidi(song), 5);

        expect(events.find((event) => event.type === 0xc0)).toBeUndefined();
    });

    it('writes volume and pan as control changes', () => {
        const song = makeSong();
        song.tracks[0] = { name: 'Lead', volume: 1, pan: -1 };
        const events = trackEvents(generateMidi(song), 0);
        const controllers = events.filter((event) => event.type === 0xb0);

        expect(controllers.find((event) => event.data[0] === 7).data[1]).toBe(127);
        expect(controllers.find((event) => event.data[0] === 10).data[1]).toBe(0);
    });

    it('leaves the control changes out when asked', () => {
        const events = trackEvents(generateMidi(makeSong(), { includeCC: false }), 0);
        expect(events.filter((event) => event.type === 0xb0)).toHaveLength(0);
    });

    it('takes velocity from the track volume, or a fixed value', () => {
        const song = makeSong();
        song.tracks[0] = { name: 'Lead', volume: 1, pan: 0 };

        const dynamic = trackEvents(generateMidi(song), 0).find((e) => e.type === 0x90);
        expect(dynamic.data[1]).toBe(127);

        const fixed = trackEvents(
            generateMidi(song, { velocityMode: 'fixed', fixedVelocity: 64 }),
            0
        ).find((e) => e.type === 0x90);
        expect(fixed.data[1]).toBe(64);
    });

    it('delays the off-beats when the song swings', () => {
        const song = makeSong({ swing: 1 });
        song.patterns[0][0][0] = null;
        song.patterns[0][0][1] = { note: 'A', octave: 4 }; // an off-beat

        const straight = trackEvents(generateMidi({ ...song, swing: 0 }), 0).find(
            (e) => e.type === 0x90
        );
        const swung = trackEvents(generateMidi(song), 0).find((e) => e.type === 0x90);

        expect(swung.delta).toBeGreaterThan(straight.delta);
    });

    it('writes the patterns in the order it is given', () => {
        const song = makeSong({ patternOrder: [1, 0] });
        song.patterns[1][0][0] = { note: 'C', octave: 4 };

        const events = trackEvents(generateMidi(song), 0);
        const [first, second] = events.filter((event) => event.type === 0x90);

        expect(first.data[0]).toBe(60); // C4, from pattern 1
        expect(second.data[0]).toBe(69); // A4, from pattern 0
    });

    it('exports only the tracks it is asked for', () => {
        const chunks = readChunks(generateMidi(makeSong({ activeTracks: [0, 2] })));
        expect(chunks.filter((chunk) => chunk.type === 'MTrk')).toHaveLength(3); // tempo + 2
    });
});

describe('encodeMidi', () => {
    it('writes delta times as variable-length quantities', () => {
        const bytes = encodeMidi(0, 480, [
            [
                {
                    delta: 200,
                    type: 'channel',
                    subtype: 'noteOn',
                    channel: 0,
                    noteNumber: 60,
                    velocity: 100
                },
                { delta: 0, type: 'meta', subtype: 'endOfTrack' }
            ]
        ]);
        const body = readChunks(bytes)[1].body;

        // 200 needs two bytes: 0x81 0x48
        expect([...body.slice(0, 2)]).toEqual([0x81, 0x48]);
    });

    it('writes single-byte delta times as they are', () => {
        const bytes = encodeMidi(0, 480, [[{ delta: 5, type: 'meta', subtype: 'endOfTrack' }]]);
        expect(readChunks(bytes)[1].body[0]).toBe(5);
    });
});
