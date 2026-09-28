/**
 * Recording what you play into the grid.
 *
 * Two ways, and they are less alike than they sound. **Real time** writes
 * each note at the step being heard as the sequencer runs, so you play
 * along with the loop. **Step** ignores the clock entirely: each note lands
 * at a cursor that then moves on by one, so a phrase can be entered a note
 * at a time with no hurry and no timing to get wrong.
 *
 * On top of either, **chord mode** spreads notes struck together across the
 * four melodic tracks. This studio has one note per step per track, so a
 * chord has nowhere to go on a single track: the first note stays where you
 * are playing and the rest fill Lead, Harmony, Bass and Arp in turn. Four
 * notes is therefore the widest chord, and a fifth is dropped.
 *
 * "Struck together" is decided by a short window rather than by any single
 * moment, because ten fingers never land on the same millisecond. The first
 * note of a chord also fixes the step it is written to: by the time the
 * window closes the sequencer may have moved on, and a chord split across
 * two steps is not a chord.
 *
 * Which track a note belongs to comes with the note, from whatever played
 * it. The original kept its own copy of the selected track and had to be
 * told each time it changed; a copy that is only ever right when somebody
 * remembers to update it is a copy worth not having.
 */

import { bus as sharedBus } from '../core/event-bus.js';

export const RECORDER_EVENTS = Object.freeze({
    modeChanged: 'recorder:mode-changed',
    cursorMoved: 'recorder:cursor-moved'
});

/** @typedef {'off'|'realtime'|'step'} RecorderMode */

/** Notes struck within this many milliseconds are one chord. */
export const CHORD_WINDOW_MS = 50;

/** The tracks a chord spreads over, in the order it fills them. */
export const MELODIC_TRACKS = Object.freeze([0, 1, 2, 3]);

export class Recorder {
    /**
     * @param {import('./sequencer.js').Sequencer} sequencer
     * @param {object} [options]
     * @param {import('../core/event-bus.js').EventBus} [options.bus]
     */
    constructor(sequencer, { bus = sharedBus } = {}) {
        this.sequencer = sequencer;
        this._bus = bus;

        /** @type {RecorderMode} */
        this.mode = 'off';
        /** Whether notes played together spread across the melodic tracks. */
        this.chordMode = false;
        /** Where the next note goes in step mode. */
        this.stepCursor = 0;

        /** @type {Array<{note: string, octave: number, track: number, at: number}>} */
        this._chord = [];
        this._chordTimer = null;
        /**
         * The step the chord being collected belongs to, fixed when its
         * first note arrived rather than when the window closes.
         */
        this._chordStep = null;
    }

    get isRecording() {
        return this.mode !== 'off';
    }

    // ── Starting and stopping ────────────────────────────────────────────

    /** Write each note at the step being heard. Does nothing until Play. */
    startRealtime() {
        this._setMode('realtime');
    }

    /** Write each note at the cursor, which then moves on by one. */
    startStep() {
        this.stepCursor = 0;
        this._setMode('step');
        this._announceCursor();
    }

    stop() {
        // Whatever is half-collected is still something the user played.
        this._flush();
        this._setMode('off');
        this._announceCursor();
    }

    /** @param {boolean} enabled */
    setChordMode(enabled) {
        this.chordMode = Boolean(enabled);
    }

    // ── Playing ──────────────────────────────────────────────────────────

    /**
     * A note was played. Whether it is recorded, and where, is all decided
     * here: everything that can play a note simply says so.
     *
     * @param {string} note    'C', 'C#', …
     * @param {number} octave
     * @param {number} track   the track it was played on
     */
    noteOn(note, octave, track) {
        // Real-time recording needs a step to write to, and there is none
        // until the sequencer is running. Playing along with a stopped
        // transport is playing, not recording.
        if (this.mode === 'realtime' && !this.sequencer.isPlaying) return;
        if (this.mode === 'off') return;

        if (this.chordMode) {
            this._collect(note, octave, track);
            return;
        }

        if (this.mode === 'realtime') {
            this.sequencer.setCell(track, this._audibleStep(), note, octave);
        } else {
            this.sequencer.setCell(track, this._cursor(), note, octave);
            this._advance();
        }
    }

    /** Step mode: leave this step empty and move on. */
    rest() {
        if (this.mode !== 'step') return;
        this._flush();
        this._advance();
    }

    /** Step mode: go back one step, so the last note can be played again. */
    backspace() {
        if (this.mode !== 'step') return;

        this._flush();
        this.stepCursor = this._cursor() - 1;
        if (this.stepCursor < 0) this.stepCursor = this.sequencer.steps - 1;
        this._announceCursor();
    }

    // ── Chords ───────────────────────────────────────────────────────────

    _collect(note, octave, track) {
        // The step is fixed by the first note of the chord. The window is
        // fifty milliseconds and a step at 120 BPM is a hundred and
        // twenty-five, so a chord straddling two steps is a matter of
        // playing slightly late: and splitting it is much worse than
        // rounding it to where it started.
        if (this._chord.length === 0) {
            this._chordStep = this.mode === 'realtime' ? this._audibleStep() : this._cursor();
        }

        this._chord.push({ note, octave, track, at: this._chord.length });

        // Each new note pushes the window back: a chord is over when the
        // playing stops, not a fixed time after it started.
        if (this._chordTimer) clearTimeout(this._chordTimer);
        this._chordTimer = setTimeout(() => this._flush(), CHORD_WINDOW_MS);
    }

    _flush() {
        if (this._chordTimer) {
            clearTimeout(this._chordTimer);
            this._chordTimer = null;
        }
        if (this._chord.length === 0) return;

        const notes = this._chord;
        const step = this._chordStep ?? this._cursor();
        const wasStep = this.mode === 'step';

        // Cleared before writing: `setCell` announces, and a listener that
        // played something back would re-enter this with a chord already
        // dealt with.
        this._chord = [];
        this._chordStep = null;

        // The first note stays on the track it was played on; the rest take
        // the melodic tracks that are still free, in order. A fifth note
        // has nowhere to go and is dropped, which is the price of one note
        // per step per track.
        const taken = new Set([notes[0].track]);
        this.sequencer.setCell(notes[0].track, step, notes[0].note, notes[0].octave);

        for (const { note, octave } of notes.slice(1)) {
            const free = MELODIC_TRACKS.find((track) => !taken.has(track));
            if (free === undefined) break;

            taken.add(free);
            this.sequencer.setCell(free, step, note, octave);
        }

        if (wasStep) this._advance();
    }

    // ── The cursor ───────────────────────────────────────────────────────

    /**
     * Where the cursor is, kept inside the pattern.
     *
     * The pattern can be shortened while recording, which leaves the cursor
     * past the end; reading it through here means that cannot write a note
     * into a step nobody will ever hear.
     */
    _cursor() {
        const steps = this.sequencer.steps;
        return this.stepCursor >= steps ? 0 : this.stepCursor;
    }

    _advance() {
        this.stepCursor = (this._cursor() + 1) % this.sequencer.steps;
        this._announceCursor();
    }

    /**
     * The step being heard right now.
     *
     * Not `currentStep`, which is where the scheduler has got to: it books
     * notes up to a tenth of a second ahead, so it is already a step or two
     * past whatever is coming out of the speakers. `displayStep` is set at
     * the moment a step is audible, which is the one the player is
     * answering.
     */
    _audibleStep() {
        return this.sequencer.displayStep ?? this.sequencer.currentStep;
    }

    // ── Telling the interface ────────────────────────────────────────────

    /** @param {RecorderMode} mode */
    _setMode(mode) {
        if (this.mode === mode) return;

        this.mode = mode;
        this._bus.emit(RECORDER_EVENTS.modeChanged, mode);
    }

    _announceCursor() {
        this._bus.emit(RECORDER_EVENTS.cursorMoved, this.mode === 'step' ? this._cursor() : null);
    }
}
