/**
 * The piano roll.
 *
 * Sixty-five rows, C1 to E6, against the pattern's steps: the same notes
 * the grid holds, laid out by pitch instead of by track. The grid is for
 * seeing eight parts at once; this is for seeing one of them as a melody.
 *
 * Drawing is on demand. The original redrew sixty times a second for as
 * long as the window was open, whether or not anything had changed: a
 * full canvas of sixty-five rows, every frame, forever. Here a redraw
 * happens when something has changed, and the animation loop runs only
 * while the sequencer is playing, because the playhead is the only thing
 * that moves on its own. It stops when the window closes, when playback
 * stops, and when the tab is hidden.
 *
 * Interaction is a single gesture: press to add a note, or to erase if the
 * note you pressed is already there, then drag to keep doing the same
 * thing. Whichever it turned out to be is decided once, on the way down,
 * so a drag cannot add and erase alternately as it passes over its own
 * work. One gesture is one undo entry.
 */

import { SEQUENCER_EVENTS } from '../sequencer/sequencer.js';
import { SYNTH_EVENTS } from '../audio/synthesizer.js';
import { UNDO_EVENTS } from '../core/undo-redo.js';
import { KEYBOARD_EVENTS } from './keyboard-panel.js';
import { AudioEngine } from '../audio/audio-engine.js';
import { confirmAction } from './confirm.js';
import { translateOr } from '../i18n/i18n.js';

const TRACK_COUNT = 8;

const CHROMATIC = Object.freeze(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']);

/** The range on screen: C1 at the bottom, E6 at the top. */
const LOWEST_OCTAVE = 1;
const HIGHEST_OCTAVE = 6;
const HIGHEST_NOTES = Object.freeze(['C', 'C#', 'D', 'D#', 'E']);

const ROW_HEIGHT = 14;
const PIANO_WIDTH = 48;
const HEADER_HEIGHT = 20;
const MIN_STEP_WIDTH = 28;
/** The width the grid aims for, shared out between however many steps. */
const GRID_WIDTH = 900;

/** How long a note sounds when it is placed, in seconds. */
const PREVIEW_SECONDS = 0.15;

/**
 * The octave each track opens on, since each has a job in this studio and
 * a bass part is never written up at C5.
 */
const HOME_OCTAVE = Object.freeze([4, 4, 2, 4, 2, 3, 5, 5]);

export class PianoRoll {
    /**
     * @param {object} options
     * @param {ParentNode} options.root
     * @param {import('../studio.js').Studio} options.studio
     * @param {(text: string) => void} [options.onStatus]
     */
    constructor({ root, studio, playhead = null, onStatus = () => {} }) {
        this.root = root;
        this.studio = studio;
        this.playhead = playhead;
        this.onStatus = onStatus;

        /** Highest pitch first, so a row index counts down the screen. */
        this.rows = buildRows();
        /** Row index by `NOTE-OCTAVE`, so a lookup is not a scan of 65. */
        this._rowOf = new Map(this.rows.map((row, index) => [key(row.note, row.octave), index]));

        /** The track being edited. Follows the studio's selection. */
        this.track = 0;
        this.ghostEnabled = false;
        /** @type {Set<number>} the tracks drawn behind the current one */
        this.ghostTracks = new Set();
        /** @type {Set<string>} notes held down, drawn lit on the keyboard */
        this._held = new Set();

        this._drag = null;
        this._frame = null;
    }

    bind() {
        this.canvas = this.root.querySelector('#pianoRollCanvas');
        this.scroller = this.root.querySelector('#pianoRollScroll');
        if (!this.canvas) return;

        this.context = this.canvas.getContext('2d');
        this._colours = trackColours();

        this._bindPointer();
        this._bindControls();
        this._bindStudio();
    }

    // ── Opening and closing ──────────────────────────────────────────────

    /** The studio window is opening. */
    open() {
        if (!this.canvas) return;

        this.track = this.studio.synthesizer.currentTrack;
        this._syncTrackPicker();
        this.resize();
        this._follow();
    }

    /**
     * The studio window is on screen.
     *
     * Separate from `open` because scrolling to an octave needs a height
     * to divide, and the window has none until it has been laid out:
     * asked a moment earlier, the pane measures zero and the roll opens at
     * the top, six octaves above anything anyone writes.
     */
    shown() {
        if (!this.canvas) return;

        this.resize();
        this._scrollHome();
    }

    close() {
        this._stopFollowing();
    }

    /** Lay the canvas out for however many steps the pattern has now. */
    resize() {
        if (!this.canvas) return;

        const steps = this.studio.sequencer.steps;
        this.canvas.width = PIANO_WIDTH + steps * this._stepWidth();
        this.canvas.height = HEADER_HEIGHT + this.rows.length * ROW_HEIGHT;
        this.draw();
    }

    _stepWidth() {
        return Math.max(MIN_STEP_WIDTH, Math.floor(GRID_WIDTH / this.studio.sequencer.steps));
    }

    /** Put the octave this track is usually written in on screen. */
    _scrollHome() {
        if (!this.scroller) return;

        const row = this._rowOf.get(key('C', HOME_OCTAVE[this.track] ?? 4));
        if (row === undefined) return;

        const middle = HEADER_HEIGHT + row * ROW_HEIGHT - this.scroller.clientHeight / 2;
        this.scroller.scrollTop = Math.max(0, middle);
    }

    // ── What it listens to ───────────────────────────────────────────────

    _bindStudio() {
        const { bus } = this.studio;

        // Everything that changes what is on screen, and nothing else: a
        // redraw is sixty-five rows of canvas and it is not free.
        bus.on(SEQUENCER_EVENTS.cellsChanged, () => this.draw());
        bus.on(SEQUENCER_EVENTS.patternChanged, () => this.draw());
        bus.on(SEQUENCER_EVENTS.stepsChanged, () => this.resize());

        // Undo puts a whole pattern back through `setState`, which
        // announces: but the studio's other panels read themselves back
        // on this one, and drawing twice costs less than being wrong.
        bus.on(UNDO_EVENTS.changed, () => this.draw());

        bus.on(SEQUENCER_EVENTS.play, () => this._follow());
        bus.on(SEQUENCER_EVENTS.pause, () => this._stopFollowing());
        bus.on(SEQUENCER_EVENTS.stop, () => {
            this._stopFollowing();
            this.draw();
        });

        // The window edits whichever track is selected, wherever it was
        // selected from.
        bus.on(SYNTH_EVENTS.trackSelected, () => {
            this.setTrack(this.studio.synthesizer.currentTrack);
        });

        // A key held down anywhere lights up on the keyboard at the side,
        // which is how you find where a note you are playing would go.
        bus.on(KEYBOARD_EVENTS.noteOn, ({ note, octave }) => {
            this._held.add(key(note, octave));
            this.draw();
        });
        bus.on(KEYBOARD_EVENTS.noteOff, ({ note, octave }) => {
            this._held.delete(key(note, octave));
            this.draw();
        });
    }

    _bindControls() {
        const picker = this.root.querySelector('#pianoRollTrack');
        picker?.addEventListener('change', () => {
            // Through the studio, so every other view of the selection
            // follows: this window is not the only thing showing it.
            this.studio.synthesizer.setCurrentTrack(Number(picker.value));
        });

        this.root.querySelector('#clearPianoRoll')?.addEventListener('click', async () => {
            const confirmed = await confirmAction({
                message: translateOr('pianoroll.clearConfirm', 'Clear all notes from this track?'),
                title: translateOr('studio.clear', 'Clear'),
                confirmLabel: translateOr('studio.clear', 'Clear')
            });
            if (!confirmed) return;

            this.studio.sequencer.clearTrack(this.track);
            this.studio.history.saveState('Clear track');
        });

        this.root.querySelector('#ghostToggle')?.addEventListener('click', () => {
            this.toggleGhosts();
        });

        this._buildGhostMenu();
    }

    /**
     * The list of tracks that can be shown behind this one.
     *
     * Built rather than written into the markup so that it carries the same
     * eight names the rest of the window uses, in the same language.
     */
    _buildGhostMenu() {
        const menu = this.root.querySelector('#ghostMenu');
        const picker = this.root.querySelector('#pianoRollTrack');
        if (!menu || !picker) return;

        // Choosing which tracks to show behind this one is several ticks,
        // and Bootstrap closes a menu after the first unless it is told
        // that this one is a list rather than a set of commands.
        this.root.querySelector('#ghostSelect')?.setAttribute('data-bs-auto-close', 'outside');

        menu.innerHTML = [...picker.options]
            .map(
                (option) => `
                <li>
                    <label class="dropdown-item d-flex align-items-center gap-2">
                        <input type="checkbox" class="form-check-input m-0"
                            value="${option.value}" />
                        <span>${option.textContent}</span>
                    </label>
                </li>`
            )
            .join('');

        menu.addEventListener('change', (event) => {
            const box = event.target.closest('input[type="checkbox"]');
            if (!box) return;

            const track = Number(box.value);
            if (box.checked) this.ghostTracks.add(track);
            else this.ghostTracks.delete(track);

            // Ticking one is asking to see it, which is also asking for
            // ghosts to be on at all.
            if (box.checked) this._setGhosts(true);
            this.draw();
        });
    }

    // ── Ghost notes ──────────────────────────────────────────────────────

    /** Show the other tracks behind this one, or stop. */
    toggleGhosts() {
        if (!this.ghostEnabled) {
            // Turning it on with nothing chosen shows everything else,
            // which is what somebody pressing it once wants to see.
            this.ghostTracks = new Set(
                Array.from({ length: TRACK_COUNT }, (_, track) => track).filter(
                    (track) => track !== this.track
                )
            );
        }

        this._setGhosts(!this.ghostEnabled);
        this.draw();
    }

    _setGhosts(enabled) {
        this.ghostEnabled = enabled;
        this.root.querySelector('#ghostToggle')?.classList.toggle('active', enabled);
        this._syncGhostMenu();
    }

    _syncGhostMenu() {
        for (const box of this.root.querySelectorAll('#ghostMenu input[type="checkbox"]')) {
            box.checked = this.ghostEnabled && this.ghostTracks.has(Number(box.value));
        }
    }

    // ── The track being edited ───────────────────────────────────────────

    /** @param {number} track */
    setTrack(track) {
        if (track === this.track) return;

        const previous = this.track;
        this.track = track;

        // The track you just left is the one you most want to see behind
        // the one you moved to, and the one you moved to should not be
        // drawn twice.
        if (this.ghostEnabled) {
            this.ghostTracks.add(previous);
            this.ghostTracks.delete(track);
            this._syncGhostMenu();
        }

        this._syncTrackPicker();
        this.draw();
        this._scrollHome();
    }

    _syncTrackPicker() {
        const picker = this.root.querySelector('#pianoRollTrack');
        if (picker) picker.value = String(this.track);
    }

    // ── Writing notes ────────────────────────────────────────────────────

    _bindPointer() {
        this.canvas.addEventListener('pointerdown', (event) => this._onDown(event));
        this.canvas.addEventListener('pointermove', (event) => this._onMove(event));

        for (const name of ['pointerup', 'pointercancel', 'pointerleave']) {
            this.canvas.addEventListener(name, () => this._onUp());
        }

        // The canvas scrolls under the pointer, so a drag across it has to
        // be a drag and not a page scroll.
        this.canvas.style.touchAction = 'none';
    }

    _onDown(event) {
        const cell = this._cellAt(event);
        if (!cell) return;

        // What the gesture is doing is decided here and holds for all of
        // it: pressing a note that is already there erases, and dragging
        // on from it erases the rest of the way. Deciding cell by cell
        // would toggle each one as the pointer crossed its own work.
        const existing = this.studio.sequencer.getCell(this.track, cell.step);
        const row = this.rows[cell.row];
        const erasing = Boolean(
            existing && existing.note === row.note && existing.octave === row.octave
        );

        this._drag = { erasing, last: null, wrote: false };
        // A pointer that leaves the window mid-drag still ends the gesture.
        this.canvas.setPointerCapture?.(event.pointerId);
        this._write(cell);
    }

    _onMove(event) {
        if (!this._drag) return;

        const cell = this._cellAt(event);
        if (cell) this._write(cell);
    }

    _onUp() {
        // One entry for the gesture, and only if it changed anything: a
        // click on empty canvas is not an edit.
        if (this._drag?.wrote) this.studio.history.saveState('Piano roll');
        this._drag = null;
    }

    /** @param {{step: number, row: number}} cell */
    _write(cell) {
        const at = `${cell.step}:${cell.row}`;
        if (this._drag.last === at) return;
        this._drag.last = at;

        const { note, octave } = this.rows[cell.row];

        if (this._drag.erasing) {
            this.studio.sequencer.setCell(this.track, cell.step, null, null);
        } else {
            this.studio.sequencer.setCell(this.track, cell.step, note, octave);
            this._preview(note, octave);
        }

        this._drag.wrote = true;
        this.draw();
    }

    _preview(note, octave) {
        // Only once the audio exists. Placing notes before the first Play
        // is perfectly reasonable; it is just silent.
        if (!this.studio.isStarted) return;

        const frequency = AudioEngine.noteToFrequency(note, octave);
        this.studio.audioEngine.playNote(frequency, this.track, PREVIEW_SECONDS);
    }

    /**
     * Which cell an event is over, or null for the piano, the header, or
     * past the end of the pattern.
     *
     * @param {PointerEvent} event
     */
    _cellAt(event) {
        const box = this.canvas.getBoundingClientRect();
        // The canvas is drawn at its own pixel size and displayed at
        // whatever width it was given, so a click has to be scaled back.
        const x = (event.clientX - box.left) * (this.canvas.width / box.width);
        const y = (event.clientY - box.top) * (this.canvas.height / box.height);

        if (x < PIANO_WIDTH || y < HEADER_HEIGHT) return null;

        const step = Math.floor((x - PIANO_WIDTH) / this._stepWidth());
        const row = Math.floor((y - HEADER_HEIGHT) / ROW_HEIGHT);

        if (step < 0 || step >= this.studio.sequencer.steps) return null;
        if (row < 0 || row >= this.rows.length) return null;

        return { step, row };
    }

    // ── Drawing ──────────────────────────────────────────────────────────

    /** Only the playhead moves on its own, so this runs only while it does. */
    _follow() {
        if (this._frame !== null || !this.studio.sequencer.isPlaying) return;

        const tick = () => {
            this._frame = requestAnimationFrame(tick);
            this.draw();
        };
        tick();
    }

    _stopFollowing() {
        if (this._frame === null) return;

        cancelAnimationFrame(this._frame);
        this._frame = null;
    }

    draw() {
        if (!this.context || !this.canvas) return;

        const steps = this.studio.sequencer.steps;
        const stepWidth = this._stepWidth();

        this.context.fillStyle = '#0a0a1a';
        this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);

        this._drawHeader(stepWidth, steps);
        this._drawGrid(stepWidth, steps);
        this._drawPiano();

        if (this.ghostEnabled) this._drawGhosts(stepWidth);
        this._drawNotes(stepWidth, this._colours[this.track]);

        if (this.studio.sequencer.isPlaying) this._drawPlayhead(stepWidth);
    }

    _drawHeader(stepWidth, steps) {
        const { context } = this;

        context.fillStyle = '#12122a';
        context.fillRect(PIANO_WIDTH, 0, steps * stepWidth, HEADER_HEIGHT);

        context.fillStyle = 'rgba(255,255,255,0.4)';
        context.font = '10px monospace';
        context.textAlign = 'center';

        // Every fourth step: a bar line's worth, and any more is a smear.
        for (let step = 0; step < steps; step += 4) {
            context.fillText(String(step + 1), PIANO_WIDTH + step * stepWidth + stepWidth / 2, 14);
        }

        context.strokeStyle = 'rgba(255,255,255,0.2)';
        context.lineWidth = 1;
        line(context, PIANO_WIDTH, HEADER_HEIGHT, PIANO_WIDTH + steps * stepWidth, HEADER_HEIGHT);
    }

    _drawGrid(stepWidth, steps) {
        const { context } = this;
        const width = steps * stepWidth;

        this.rows.forEach((row, index) => {
            const y = HEADER_HEIGHT + index * ROW_HEIGHT;

            if (row.sharp) {
                context.fillStyle = 'rgba(0,0,0,0.25)';
                context.fillRect(PIANO_WIDTH, y, width, ROW_HEIGHT);
            }

            // A brighter line at each C, so an octave can be counted at a
            // glance rather than by reading the keys.
            if (row.note === 'C') {
                context.strokeStyle = 'rgba(255,255,255,0.15)';
                context.lineWidth = 1;
                line(context, PIANO_WIDTH, y, PIANO_WIDTH + width, y);
            }
        });

        const bottom = HEADER_HEIGHT + this.rows.length * ROW_HEIGHT;
        for (let step = 0; step <= steps; step++) {
            const x = PIANO_WIDTH + step * stepWidth;
            const beat = step % 4 === 0;

            context.strokeStyle = beat ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.06)';
            context.lineWidth = beat ? 1.5 : 0.5;
            line(context, x, HEADER_HEIGHT, x, bottom);
        }
    }

    _drawPiano() {
        const { context } = this;
        const lit = cssColour('--bs-primary', '#1ab394');

        context.fillStyle = '#1a1a2e';
        context.fillRect(0, 0, PIANO_WIDTH, this.canvas.height);

        this.rows.forEach((row, index) => {
            const y = HEADER_HEIGHT + index * ROW_HEIGHT;
            const held = this._held.has(key(row.note, row.octave));
            const width = row.sharp ? PIANO_WIDTH * 0.65 : PIANO_WIDTH;

            context.fillStyle = held ? lit : row.sharp ? '#1a1a1a' : '#d0d0d0';
            context.fillRect(0, y, width, ROW_HEIGHT);

            context.strokeStyle = held ? lit : row.sharp ? '#333' : '#999';
            context.lineWidth = 0.5;
            context.strokeRect(0, y, width, ROW_HEIGHT);

            if (row.note !== 'C') return;

            context.fillStyle = held ? '#fff' : '#333';
            context.font = 'bold 9px monospace';
            context.textAlign = 'right';
            context.fillText(`C${row.octave}`, PIANO_WIDTH - 4, y + ROW_HEIGHT - 3);
        });

        context.strokeStyle = 'rgba(255,255,255,0.3)';
        context.lineWidth = 1;
        line(context, PIANO_WIDTH, 0, PIANO_WIDTH, this.canvas.height);
    }

    /** The other tracks, faint, so a part can be written against them. */
    _drawGhosts(stepWidth) {
        for (const track of this.ghostTracks) {
            if (track === this.track) continue;

            this._eachNote(track, (step, row) => {
                this._block(step, row, stepWidth, {
                    fill: this._colours[track],
                    fillAlpha: 0.18,
                    stroke: this._colours[track],
                    strokeAlpha: 0.35,
                    lineWidth: 0.5
                });
            });
        }
    }

    _drawNotes(stepWidth, colour) {
        const { context } = this;

        this._eachNote(this.track, (step, row, note) => {
            this._block(step, row, stepWidth, {
                fill: colour,
                fillAlpha: 0.85,
                stroke: 'rgba(255,255,255,0.5)',
                strokeAlpha: 1,
                lineWidth: 1
            });

            // Only when there is room for it to be read.
            if (stepWidth < 30) return;

            context.fillStyle = '#fff';
            context.font = '8px monospace';
            context.textAlign = 'center';
            context.fillText(
                `${note.note}${note.octave}`,
                PIANO_WIDTH + step * stepWidth + stepWidth / 2,
                HEADER_HEIGHT + row * ROW_HEIGHT + ROW_HEIGHT / 2 + 3
            );
        });
    }

    /**
     * Every note of a track that has a row on screen.
     * @param {(step: number, row: number, note: object) => void} visit
     */
    _eachNote(track, visit) {
        const steps = this.studio.sequencer.steps;

        for (let step = 0; step < steps; step++) {
            const note = this.studio.sequencer.getCell(track, step);
            if (!note) continue;

            // A note outside C1-E6 is simply not drawn. It still plays; the
            // roll is a view of the pattern, not the whole of it.
            const row = this._rowOf.get(key(note.note, note.octave));
            if (row === undefined) continue;

            visit(step, row, note);
        }
    }

    _block(step, row, stepWidth, { fill, fillAlpha, stroke, strokeAlpha, lineWidth }) {
        const { context } = this;
        const pad = 1;
        const x = PIANO_WIDTH + step * stepWidth + pad;
        const y = HEADER_HEIGHT + row * ROW_HEIGHT + pad;

        roundedRect(context, x, y, stepWidth - pad * 2, ROW_HEIGHT - pad * 2, 2);

        context.globalAlpha = fillAlpha;
        context.fillStyle = fill;
        context.fill();

        context.globalAlpha = strokeAlpha;
        context.strokeStyle = stroke;
        context.lineWidth = lineWidth;
        context.stroke();

        context.globalAlpha = 1;
    }

    _drawPlayhead(stepWidth) {
        const { context } = this;
        // The same position the bar over the grid stands at, so the two
        // windows agree. Without it, the step being heard: which moves
        // once per step, while this redraws sixty times a second.
        const step =
            this.playhead?.stepNow()?.step ??
            this.studio.sequencer.displayStep ??
            this.studio.sequencer.currentStep;
        const x = PIANO_WIDTH + step * stepWidth;

        context.strokeStyle = '#ffcc00';
        context.lineWidth = 2;
        line(context, x, HEADER_HEIGHT, x, this.canvas.height);

        context.shadowBlur = 10;
        context.shadowColor = '#ffcc00';
        context.stroke();
        context.shadowBlur = 0;
    }
}

/** Highest pitch first: E6 down to C1, sixty-five rows. */
function buildRows() {
    const rows = [];

    for (let octave = HIGHEST_OCTAVE; octave >= LOWEST_OCTAVE; octave--) {
        const notes = octave === HIGHEST_OCTAVE ? HIGHEST_NOTES : CHROMATIC;
        for (const note of [...notes].reverse()) {
            rows.push({ note, octave, sharp: note.includes('#') });
        }
    }

    return rows;
}

function key(note, octave) {
    return `${note}-${octave}`;
}

/** The eight track colours the rest of the studio uses. */
function trackColours() {
    const fallback = [
        'rgba(0, 150, 255, 0.8)',
        'rgba(100, 200, 255, 0.8)',
        'rgba(150, 0, 255, 0.8)',
        'rgba(0, 200, 150, 0.8)',
        'rgba(255, 60, 60, 0.8)',
        'rgba(255, 140, 0, 0.8)',
        'rgba(255, 220, 0, 0.8)',
        'rgba(255, 0, 200, 0.8)'
    ];

    return fallback.map((colour, track) => cssColour(`--forge-track-${track}`, colour));
}

function cssColour(name, fallback) {
    try {
        const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return value || fallback;
    } catch {
        return fallback;
    }
}

function line(context, x1, y1, x2, y2) {
    context.beginPath();
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
    context.stroke();
}

function roundedRect(context, x, y, width, height, radius) {
    context.beginPath();
    context.moveTo(x + radius, y);
    context.arcTo(x + width, y, x + width, y + height, radius);
    context.arcTo(x + width, y + height, x, y + height, radius);
    context.arcTo(x, y + height, x, y, radius);
    context.arcTo(x, y, x + width, y, radius);
    context.closePath();
}
