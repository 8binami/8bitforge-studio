/**
 * MIDI export.
 *
 * Writes a Standard MIDI File from patterns, so a sketch made here can be
 * finished in a DAW. Drums go to channel 9 with General MIDI note numbers,
 * melodic tracks get a GM program that roughly matches their chiptune voice.
 *
 * The function takes a plain description of the song rather than the studio
 * objects: what it needs is notes, tempo and track settings, nothing else.
 */

const NOTE_OFFSETS = {
    C: 0,
    'C#': 1,
    D: 2,
    'D#': 3,
    E: 4,
    F: 5,
    'F#': 6,
    G: 7,
    'G#': 8,
    A: 9,
    'A#': 10,
    B: 11
};

/** Tracks 4 to 6 are percussion and belong on the GM drum channel. */
const DRUM_TRACKS = new Set([4, 5, 6]);
const DRUM_CHANNEL = 9;

/** GM percussion notes: bass drum, acoustic snare, closed hi-hat. */
const GM_DRUM_NOTES = { 4: 36, 5: 38, 6: 42 };

/** GM programs per track: square lead, saw lead, finger bass, calliope, SFX. */
const GM_PROGRAMS = [80, 81, 33, 82, -1, -1, -1, 127];

/** How far a full swing setting pushes the off-beats, as a share of a step. */
const MAX_SWING_OFFSET = 0.33;

export const MIDI_DEFAULTS = Object.freeze({
    format: 1, // 0 = one track, 1 = a track per instrument
    ticksPerBeat: 480,
    includeCC: true, // volume and pan as control changes
    velocityMode: 'dynamic', // dynamic = from the track volume, or fixed
    fixedVelocity: 100
});

/**
 * @typedef {{note: string, octave: number}|null} Cell
 * @typedef {object} MidiSong
 * @property {Cell[][][]} patterns        [pattern][track][step]
 * @property {number[]} patternOrder      patterns to write, in order
 * @property {number} steps               steps per pattern
 * @property {number} bpm
 * @property {number} [swing]             0..1
 * @property {Array<{name: string, volume: number, pan: number}>} tracks
 * @property {number[]} [activeTracks]    defaults to all eight
 */

/**
 * @param {MidiSong} song
 * @param {Partial<typeof MIDI_DEFAULTS>} [options]
 * @returns {Uint8Array} the bytes of a Standard MIDI File
 */
export function generateMidi(song, options = {}) {
    const { format, ticksPerBeat, includeCC, velocityMode, fixedVelocity } = {
        ...MIDI_DEFAULTS,
        ...options
    };

    const { patterns, patternOrder, steps, bpm, tracks } = song;
    const swing = Math.min(1, Math.max(0, song.swing || 0));
    const activeTracks = song.activeTracks || [0, 1, 2, 3, 4, 5, 6, 7];

    // A step is a sixteenth note, so a quarter of a beat.
    const ticksPerStep = Math.round(ticksPerBeat / 4);
    const noteTicks = Math.round(ticksPerBeat * 0.9); // as played: a touch short
    const drumTicks = Math.round(ticksPerStep / 2); // percussion is a hit, not a note
    const swingTicks = Math.round(ticksPerStep * swing * MAX_SWING_OFFSET);

    const midiTracks = [];

    if (format === 1) {
        // Format 1 keeps tempo and time signature in a track of their own.
        midiTracks.push([
            { delta: 0, type: 'meta', subtype: 'setTempo', microsecondsPerBeat: usPerBeat(bpm) },
            {
                delta: 0,
                type: 'meta',
                subtype: 'timeSignature',
                numerator: 4,
                denominator: 4,
                metronome: 24,
                thirtyseconds: 8
            },
            { delta: 0, type: 'meta', subtype: 'trackName', text: '8BitForge Export' },
            {
                delta: patternOrder.length * steps * ticksPerStep,
                type: 'meta',
                subtype: 'endOfTrack'
            }
        ]);
    }

    for (const trackIndex of activeTracks) {
        const isDrum = DRUM_TRACKS.has(trackIndex);
        const channel = isDrum
            ? DRUM_CHANNEL
            : trackIndex < 4
              ? trackIndex
              : Math.min(trackIndex + 1, 15);
        const settings = tracks[trackIndex] || { name: `Track ${trackIndex}`, volume: 0.5, pan: 0 };
        const events = [];

        events.push({ delta: 0, type: 'meta', subtype: 'trackName', text: settings.name });

        // Channel 9 is always a drum kit in GM, so a program change is noise.
        if (!isDrum && GM_PROGRAMS[trackIndex] >= 0) {
            events.push({
                delta: 0,
                type: 'channel',
                subtype: 'programChange',
                channel,
                programNumber: GM_PROGRAMS[trackIndex]
            });
        }

        if (includeCC) {
            events.push(controller(channel, 7, clamp7bit((settings.volume ?? 0.5) * 127)));
            events.push(controller(channel, 10, clamp7bit(((settings.pan ?? 0) + 1) * 63.5)));
        }

        // Collect the notes at their absolute positions first. Writing note
        // on/off pairs as they come does not work: a note lasts 0.9 of a beat
        // while a step is a quarter of one, so consecutive notes overlap and
        // the running position would go backwards. That is what the original
        // export did, and it stretched any dense pattern out of time.
        const notes = [];
        patternOrder.forEach((patternIndex, position) => {
            const pattern = patterns[patternIndex];
            if (!pattern) return; // a silent measure still takes its time

            for (let step = 0; step < steps; step++) {
                const cell = pattern[trackIndex]?.[step];
                if (!cell) continue;

                // Swing delays the off-beats, which is what gives the shuffle.
                let tick = (position * steps + step) * ticksPerStep;
                if (swing > 0 && step % 2 === 1) tick += swingTicks;

                let noteNumber;
                if (isDrum) {
                    noteNumber = GM_DRUM_NOTES[trackIndex] ?? 36;
                } else {
                    const offset = NOTE_OFFSETS[cell.note];
                    if (offset === undefined) continue;
                    noteNumber = (cell.octave + 1) * 12 + offset;
                }

                notes.push({
                    tick,
                    noteNumber: Math.max(0, Math.min(127, noteNumber)),
                    velocity:
                        velocityMode === 'fixed'
                            ? clamp7bit(fixedVelocity)
                            : Math.max(1, clamp7bit((settings.volume ?? 0.5) * 100 + 27))
                });
            }
        });

        // A note stops when the next one starts, at the latest: overlapping
        // the same pitch on one channel would cut the new note short.
        const baseDuration = isDrum ? drumTicks : noteTicks;
        const timed = notes.map((note, index) => {
            const nextTick = notes[index + 1]?.tick ?? Infinity;
            const available = Math.max(1, nextTick - note.tick);
            return { ...note, duration: Math.min(baseDuration, available) };
        });

        const absolute = [];
        for (const note of timed) {
            absolute.push({
                tick: note.tick,
                order: 1, // a note on comes after any note off at the same tick
                event: {
                    type: 'channel',
                    subtype: 'noteOn',
                    channel,
                    noteNumber: note.noteNumber,
                    velocity: note.velocity
                }
            });
            absolute.push({
                tick: note.tick + note.duration,
                order: 0,
                event: {
                    type: 'channel',
                    subtype: 'noteOff',
                    channel,
                    noteNumber: note.noteNumber,
                    velocity: 64
                }
            });
        }
        absolute.sort((a, b) => a.tick - b.tick || a.order - b.order);

        let currentTick = 0;
        for (const entry of absolute) {
            events.push({ ...entry.event, delta: entry.tick - currentTick });
            currentTick = entry.tick;
        }

        events.push({ delta: 0, type: 'meta', subtype: 'endOfTrack' });
        midiTracks.push(events);
    }

    return encodeMidi(format, ticksPerBeat, midiTracks);
}

/** @returns {Blob} the same file, ready to save */
export function generateMidiBlob(song, options) {
    return new Blob([generateMidi(song, options)], { type: 'audio/midi' });
}

/**
 * Encode tracks of events into the Standard MIDI File byte layout.
 * @returns {Uint8Array}
 */
export function encodeMidi(format, ticksPerBeat, tracks) {
    const bytes = [];

    pushAscii(bytes, 'MThd');
    pushUint32(bytes, 6);
    pushUint16(bytes, format);
    pushUint16(bytes, tracks.length);
    pushUint16(bytes, ticksPerBeat);

    for (const track of tracks) {
        const trackBytes = [];

        for (const event of track) {
            pushVariableLength(trackBytes, event.delta);

            if (event.type === 'meta') {
                trackBytes.push(0xff);
                if (event.subtype === 'trackName') {
                    trackBytes.push(0x03);
                    pushVariableLength(trackBytes, event.text.length);
                    pushAscii(trackBytes, event.text);
                } else if (event.subtype === 'setTempo') {
                    trackBytes.push(0x51, 3);
                    trackBytes.push((event.microsecondsPerBeat >> 16) & 0xff);
                    trackBytes.push((event.microsecondsPerBeat >> 8) & 0xff);
                    trackBytes.push(event.microsecondsPerBeat & 0xff);
                } else if (event.subtype === 'timeSignature') {
                    trackBytes.push(0x58, 4);
                    trackBytes.push(event.numerator);
                    trackBytes.push(Math.log2(event.denominator));
                    trackBytes.push(event.metronome);
                    trackBytes.push(event.thirtyseconds);
                } else if (event.subtype === 'endOfTrack') {
                    trackBytes.push(0x2f, 0);
                }
            } else if (event.type === 'channel') {
                if (event.subtype === 'noteOn') {
                    trackBytes.push(0x90 | event.channel, event.noteNumber, event.velocity);
                } else if (event.subtype === 'noteOff') {
                    trackBytes.push(0x80 | event.channel, event.noteNumber, event.velocity);
                } else if (event.subtype === 'programChange') {
                    trackBytes.push(0xc0 | event.channel, event.programNumber);
                } else if (event.subtype === 'controller') {
                    trackBytes.push(0xb0 | event.channel, event.controllerType, event.value);
                }
            }
        }

        pushAscii(bytes, 'MTrk');
        pushUint32(bytes, trackBytes.length);
        bytes.push(...trackBytes);
    }

    return new Uint8Array(bytes);
}

function controller(channel, controllerType, value) {
    return { delta: 0, type: 'channel', subtype: 'controller', channel, controllerType, value };
}

function usPerBeat(bpm) {
    return Math.round(60000000 / bpm);
}

function clamp7bit(value) {
    return Math.max(0, Math.min(127, Math.round(value)));
}

function pushAscii(bytes, text) {
    for (let i = 0; i < text.length; i++) bytes.push(text.charCodeAt(i) & 0xff);
}

function pushUint16(bytes, value) {
    bytes.push((value >> 8) & 0xff, value & 0xff);
}

function pushUint32(bytes, value) {
    bytes.push((value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff);
}

/** MIDI delta times are seven bits per byte, high bit set to continue. */
function pushVariableLength(bytes, value) {
    let remaining = Math.max(0, value);
    const chunk = [remaining & 0x7f];
    remaining >>= 7;
    while (remaining > 0) {
        chunk.push((remaining & 0x7f) | 0x80);
        remaining >>= 7;
    }
    chunk.reverse();
    bytes.push(...chunk);
}
