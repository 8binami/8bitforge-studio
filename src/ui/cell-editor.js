/**
 * Editing a step of the grid directly.
 *
 * A left click turns a step on and off, and has since the grid existed.
 * What it cannot do is say *which* note: a new step takes the last note
 * played on the keyboard, or the track's default, and changing it meant
 * opening the piano roll. These are the two gestures that close that gap
 * without leaving the grid.
 *
 * **Click the note on a step, or right-click the step**, and a small picker
 * opens above it: the twelve notes in two rows, the octave under them, the
 * current one lit. It writes as you choose and stays open, so picking the
 * note and then the octave is one visit rather than two: which is how the
 * original behaved, and what anyone who used it reaches for.
 *
 * It has no Clear of its own. Clicking the step itself already empties it,
 * and a button that removes what you came here to edit, sitting among the
 * notes, is a button people press by accident.
 *
 * **Drag a step onto another** and the note moves. Dragging is how anyone
 * expects to shift a note one step late, and doing it by clearing one cell
 * and clicking another loses its pitch on the way.
 *
 * A drag has to be told apart from a click, since a click is a drag of no
 * distance: nothing happens until the pointer has moved a few pixels, and
 * under that the grid's own click handler deals with it as it always did.
 */

import { OWN_MENU } from './context-menu.js';
import { AudioEngine } from '../audio/audio-engine.js';
import { translateOr } from '../i18n/i18n.js';

const NOTES = Object.freeze(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']);

/** The octaves a step may sit in, as the original allowed. */
const LOWEST_OCTAVE = 1;
const HIGHEST_OCTAVE = 8;

/** What a step with no note yet opens on. */
const DEFAULT_NOTE = 'C';
const DEFAULT_OCTAVE = 4;

/** The gap between the picker and the step it belongs to. */
const ANCHOR_GAP = 8;

/** How far the pointer moves before it is a drag rather than a click. */
const DRAG_THRESHOLD = 5;

/** How long a picked note sounds, as a share of a beat. */
const PREVIEW_BEATS = 0.5;

export class CellEditor {
    /**
     * @param {object} options
     * @param {ParentNode} options.root
     * @param {import('../studio.js').Studio} options.studio
     * @param {() => void} [options.onEdited]  redraw the grid
     */
    constructor({ root, studio, onEdited = () => {} }) {
        this.root = root;
        this.studio = studio;
        this.onEdited = onEdited;

        this._element = null;
        this._at = null;
        this._drag = null;

        /** What the picker is showing, which is what the step will hold. */
        this._note = DEFAULT_NOTE;
        this._octave = DEFAULT_OCTAVE;
    }

    bind() {
        // The grid answers right-clicks itself, so the project menu leaves
        // it alone.
        for (const grid of this.root.querySelectorAll('.track-grid')) {
            grid.setAttribute(OWN_MENU, 'cell');
        }

        this.root.addEventListener('contextmenu', (event) => {
            const cell = cellUnder(event.target);
            if (!cell) return;

            event.preventDefault();
            this.open(Number(cell.dataset.track), Number(cell.dataset.step), cell);
        });

        this._bindDragging();

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') this.close();
        });
    }

    // ── Picking a note ───────────────────────────────────────────────────

    /**
     * @param {number} track
     * @param {number} step
     * @param {HTMLElement} cell  the step it belongs to, to open above
     */
    open(track, step, cell) {
        this._at = { track, step };
        this._build();

        const current = this.studio.sequencer.getCell(track, step);
        this._note = current?.note ?? DEFAULT_NOTE;
        this._octave = current?.octave ?? DEFAULT_OCTAVE;
        this._sync();

        this._element.classList.add('show');
        this._place(cell);
    }

    close() {
        this._element?.classList.remove('show');
        this._at = null;
    }

    get isOpen() {
        return Boolean(this._element?.classList.contains('show'));
    }

    /**
     * Write what is chosen onto the step, and sound it.
     *
     * The snapshot is taken after the change, the way every other snapshot
     * in the studio is, so undo returns to the note that was there before.
     */
    async apply() {
        if (!this._at) return;

        const { track, step } = this._at;
        this.studio.sequencer.setCell(track, step, this._note, this._octave);
        this.studio.history.saveState('Note');
        this.onEdited();

        // Sound it as it lands, the way a left click on the grid does:
        // choosing a pitch you cannot hear is choosing it blind.
        await this.studio.start();
        this.studio.audioEngine.playNote(
            AudioEngine.noteToFrequency(this._note, this._octave),
            track,
            (60 / this.studio.sequencer.bpm) * PREVIEW_BEATS
        );
    }

    /** Move the octave by one, within what a step may hold. */
    shiftOctave(by) {
        const octave = Math.min(HIGHEST_OCTAVE, Math.max(LOWEST_OCTAVE, this._octave + by));
        if (octave === this._octave) return;

        this._octave = octave;
        this._sync();
        this.apply();
    }

    /** The picker, showing what the step holds. */
    _sync() {
        for (const key of this._element.querySelectorAll('[data-note]')) {
            key.classList.toggle('sne-active', key.dataset.note === this._note);
        }

        this._element.querySelector('.sne-oct-val').textContent = String(this._octave);
    }

    /**
     * Above the step, centred on it, flipping underneath when there is no
     * room over it.
     *
     * The division by the zoom is not decoration. The picker is positioned
     * `fixed`, so `left` is read in the page's own coordinates, while
     * `getBoundingClientRect` answers in what you actually see: and the
     * studio scales the whole page between 30 % and 150 %.
     */
    _place(cell) {
        const zoom = parseFloat(document.body.style.zoom) || 1;
        const rect = cell.getBoundingClientRect();
        const width = this._element.offsetWidth;
        const height = this._element.offsetHeight;
        const edge = ANCHOR_GAP / 2;

        const left = rect.left / zoom + rect.width / zoom / 2 - width / 2;
        const above = rect.top / zoom - height - ANCHOR_GAP;

        this._element.style.left = `${Math.max(
            edge,
            Math.min(left, window.innerWidth / zoom - width - edge)
        )}px`;
        this._element.style.top = `${above < edge ? rect.bottom / zoom + ANCHOR_GAP : above}px`;
    }

    /**
     * Built once, on first use.
     *
     * Twelve keys and an octave that most people will never open do not
     * belong in `app-shell.html`.
     */
    _build() {
        if (this._element) return;

        const keys = NOTES.map(
            (note) => `
            <button type="button" class="sne-note" data-note="${note}">${note}</button>`
        ).join('');

        const host = document.createElement('div');
        host.innerHTML = `
            <div class="step-note-editor" id="forgeCellEditor">
                <div class="sne-notes">${keys}</div>
                <div class="sne-octave">
                    <button type="button" class="sne-oct-dec"
                        title="${escapeText(translateOr('grid.octaveDown', 'Lower octave'))}">
                        &#9664;</button>
                    <span class="sne-oct-val">${DEFAULT_OCTAVE}</span>
                    <button type="button" class="sne-oct-inc"
                        title="${escapeText(translateOr('grid.octaveUp', 'Higher octave'))}">
                        &#9654;</button>
                </div>
            </div>`;

        this._element = host.firstElementChild;
        document.body.append(this._element);

        this._element.addEventListener('click', (event) => {
            if (event.target.closest('.sne-oct-dec')) return void this.shiftOctave(-1);
            if (event.target.closest('.sne-oct-inc')) return void this.shiftOctave(1);

            const key = event.target.closest('[data-note]');
            if (!key) return;

            this._note = key.dataset.note;
            this._sync();
            this.apply();
        });

        // A click inside must not reach the document listener that closes
        // the project menu: and through it, this.
        this._element.addEventListener('pointerdown', (event) => event.stopPropagation());
    }

    // ── Moving a step ────────────────────────────────────────────────────

    _bindDragging() {
        this.root.addEventListener('pointerdown', (event) => {
            // The left button only: the right one opens the editor above.
            if (event.button !== 0) return;

            const cell = cellUnder(event.target);
            if (!cell) return;

            const track = Number(cell.dataset.track);
            const step = Number(cell.dataset.step);
            // Only a step that holds something can be moved. An empty one
            // is a click waiting to fill it.
            if (!this.studio.sequencer.getCell(track, step)) return;

            this._drag = {
                track,
                step,
                from: cell,
                x: event.clientX,
                y: event.clientY,
                live: false
            };
        });

        this.root.addEventListener('pointermove', (event) => {
            if (!this._drag) return;

            if (!this._drag.live) {
                const moved =
                    Math.abs(event.clientX - this._drag.x) + Math.abs(event.clientY - this._drag.y);
                if (moved < DRAG_THRESHOLD) return;

                this._drag.live = true;
                this._drag.from.classList.add('cell-dragging');
            }

            this._mark(cellUnder(document.elementFromPoint(event.clientX, event.clientY)));
        });

        for (const name of ['pointerup', 'pointercancel']) {
            this.root.addEventListener(name, (event) => this._drop(event, name === 'pointerup'));
        }
    }

    _mark(cell) {
        if (this._drag.over === cell) return;

        this._drag.over?.classList.remove('cell-drop');
        this._drag.over = cell && cell !== this._drag.from ? cell : null;
        this._drag.over?.classList.add('cell-drop');
    }

    _drop(event, landed) {
        const drag = this._drag;
        this._drag = null;
        if (!drag) return;

        drag.from.classList.remove('cell-dragging');
        drag.over?.classList.remove('cell-drop');

        // Never started, so the grid's click handler owns this gesture.
        if (!drag.live) return;

        // Swallowed, so the click that follows a pointerup does not also
        // toggle the cell the drag started on.
        event.preventDefault();

        const target = landed && cellUnder(document.elementFromPoint(event.clientX, event.clientY));
        if (!target || target === drag.from) return;

        const to = { track: Number(target.dataset.track), step: Number(target.dataset.step) };
        const note = this.studio.sequencer.getCell(drag.track, drag.step);
        if (!note) return;

        // Cleared first, so dropping a note onto the step it came from in
        // another track cannot clear what was just written.
        this.studio.sequencer.setCell(drag.track, drag.step, null, null);
        this.studio.sequencer.setCell(to.track, to.step, note.note, note.octave);
        this.studio.history.saveState('Move note');
        this.onEdited();
    }
}

/** The grid cell an event landed on, if it was one. */
function cellUnder(target) {
    return target?.closest?.('.grid-cell[data-track]') ?? null;
}

function escapeText(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}
