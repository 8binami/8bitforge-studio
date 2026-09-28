/**
 * The record buttons.
 *
 * Four of them, over two arming modes. STEP and CHORD sit on the Keyboard
 * card, where you play; REC and STEP again sit in the piano roll's header,
 * where you watch what you played arrive. The pair in the header is the
 * same pair: pressing either STEP does the same thing, and both show the
 * same state, because there is one recorder behind them.
 *
 * What plays a note and what records it are kept apart. The keyboard,
 * whether tapped, typed or driven over MIDI, announces the note it played
 * and the track it played it on; this passes that to the recorder. So the
 * keyboard knows nothing about recording, the recorder knows nothing about
 * keyboards, and MIDI needed no wiring of its own.
 *
 * A take is one undo entry, recorded when it ends. Recording writes cell by
 * cell and an entry per cell would bury the rest of the history under a
 * scale.
 */

import { RECORDER_EVENTS } from '../sequencer/recorder.js';
import { KEYBOARD_EVENTS } from './keyboard-panel.js';
import { translateOr } from '../i18n/i18n.js';

/** Which button shows which mode, and the class it wears while it is on. */
const BUTTONS = Object.freeze({
    recBtn: { mode: 'realtime', on: 'rec-active' },
    prRecBtn: { mode: 'realtime', on: 'rec-active' },
    stepRecBtn: { mode: 'step', on: 'step-rec-active' },
    prStepRecBtn: { mode: 'step', on: 'step-rec-active' }
});

/** The two that fill in solid, so REC reads as armed from across the room. */
const FILLED = ['recBtn', 'prRecBtn'];

export class Recording {
    /**
     * @param {object} options
     * @param {ParentNode} options.root
     * @param {import('../studio.js').Studio} options.studio
     * @param {() => void} [options.onCellsChanged]  redraw the grid
     * @param {(text: string) => void} [options.onStatus]
     */
    constructor({ root, studio, onCellsChanged = () => {}, onStatus = () => {} }) {
        this.root = root;
        this.studio = studio;
        this.onCellsChanged = onCellsChanged;
        this.onStatus = onStatus;
    }

    get recorder() {
        return this.studio.recorder;
    }

    bind() {
        for (const [id, { mode }] of Object.entries(BUTTONS)) {
            this.root.querySelector('#' + id)?.addEventListener('click', () => this.arm(mode));
        }

        const chord = this.root.querySelector('#chordModeBtn');
        chord?.addEventListener('click', () => {
            const enabled = !this.recorder.chordMode;
            this.recorder.setChordMode(enabled);
            chord.classList.toggle('chord-mode-active', enabled);
        });

        // Everything that can play a note says so on the bus, and the track
        // comes with it: the recorder never has to be told which one is
        // selected, so it can never be told late.
        this.studio.bus.on(KEYBOARD_EVENTS.noteOn, ({ note, octave, track }) => {
            this.recorder.noteOn(note, octave, track);
        });

        this.studio.bus.on(RECORDER_EVENTS.modeChanged, (mode) => this._showMode(mode));
        this.studio.bus.on(RECORDER_EVENTS.cursorMoved, (step) => this._showCursor(step));

        this._showMode(this.recorder.mode);
    }

    /**
     * Turn a mode on, or off if it is already on. Arming one disarms the
     * other: a note cannot go to a cursor and to the playhead at once.
     *
     * @param {'realtime'|'step'} mode
     */
    async arm(mode) {
        if (this.recorder.mode === mode) {
            const label = mode === 'step' ? 'Step record' : 'Record';
            this.recorder.stop();

            // One entry for the take, recorded when it ends. A snapshot per
            // cell would bury the rest of the history under a scale, and
            // one taken at the start would be a snapshot of the state
            // before it: which is one change too early to undo to.
            this.studio.history.saveState(label);
            this.onCellsChanged();
            this.onStatus(translateOr('status.ready', 'Ready'));
            return;
        }

        if (mode === 'realtime') {
            this.recorder.startRealtime();
            // Real-time recording with nothing playing records nothing, so
            // pressing REC starts the transport rather than waiting to be
            // asked twice.
            await this.studio.start();
            if (!this.studio.sequencer.isPlaying) this.studio.sequencer.play();
            this.onStatus(translateOr('status.rec', 'REC'));
        } else {
            this.recorder.startStep();
            this.onStatus(translateOr('status.steprec', 'STEP REC'));
        }
    }

    // ── Showing it ───────────────────────────────────────────────────────

    /** @param {'off'|'realtime'|'step'} mode */
    _showMode(mode) {
        for (const [id, button] of Object.entries(BUTTONS)) {
            const element = this.root.querySelector('#' + id);
            element?.classList.toggle(button.on, mode === button.mode);
        }

        // Both REC buttons fill in while it is recording, so the state
        // reads from across the window rather than from a thin outline.
        for (const id of FILLED) {
            const rec = this.root.querySelector('#' + id);
            rec?.classList.toggle('btn-danger', mode === 'realtime');
            rec?.classList.toggle('btn-outline-danger', mode !== 'realtime');
        }

        if (mode === 'off') this.onCellsChanged();
    }

    /**
     * Mark the column the next note will land in.
     *
     * Down the whole grid rather than on one track: in chord mode the note
     * may not go to the track you are playing, and the column is the part
     * that is certain.
     *
     * @param {number|null} step  null when nothing is armed
     */
    _showCursor(step) {
        for (const cell of this.root.querySelectorAll('.grid-cell.step-cursor-col')) {
            cell.classList.remove('step-cursor-col');
        }
        if (step === null) return;

        for (const cell of this.root.querySelectorAll(`.grid-cell[data-step="${step}"]`)) {
            cell.classList.add('step-cursor-col');
        }
    }
}
