/**
 * The arrangement grid.
 *
 * The song as a whole: eight pattern rows against a row of measures, where a
 * cell says "play this pattern here". One pattern per measure: clicking a
 * second one in the same column moves it rather than stacking it: and an
 * empty column is a measure of silence, which is a normal thing to want.
 *
 * Above the grid, the measure numbers seek: clicking one moves the playhead
 * to that measure and switches the sequencer to whatever pattern lives there.
 * Below it, a timeline says when each measure starts and how long the whole
 * thing runs, from the tempo and the pattern length.
 *
 * The grid is rebuilt from the chain rather than patched in place. It is at
 * most eight rows by a few dozen measures, and a rebuild cannot drift from
 * the chain the way a patch can.
 */

import { ARRANGEMENT_EVENTS } from '../sequencer/arrangement.js';
import { SEQUENCER_EVENTS } from '../sequencer/sequencer.js';
import { translateOr } from '../i18n/i18n.js';
import { confirmAction } from './confirm.js';

const PATTERN_COUNT = 8;

/** Where the grid starts, and the fewest measures it will show. */
const DEFAULT_MEASURES = 8;

export class ArrangementPanel {
    /**
     * @param {object} options
     * @param {ParentNode} options.root
     * @param {import('../studio.js').Studio} options.studio
     * @param {(text: string) => void} [options.onStatus]  the transport's line
     */
    constructor({ root, studio, onStatus = () => {} }) {
        this.root = root;
        this.studio = studio;
        this.onStatus = onStatus;

        this.measures = Math.max(studio.arrangement.mixerMeasures || 0, DEFAULT_MEASURES);
    }

    bind() {
        this._bindControls();
        this._listen();
        this.render();
    }

    _el(id) {
        return this.root.querySelector(`#${id}`);
    }

    // ── The grid ─────────────────────────────────────────────────────────

    render() {
        const container = this._el('mixerGridContainer');
        if (!container) return;

        const chain = this.studio.arrangement.getChain();
        this.measures = Math.max(chain.length, this.measures, 1);
        this.studio.arrangement.mixerMeasures = this.measures;

        container.innerHTML = '';
        container.append(this._buildHeader(), ...this._buildRows(chain), this._buildTimeline());

        const count = this._el('mixerMeasureCount');
        if (count) count.textContent = String(this.measures);

        this._syncToggle();
        this._markCurrentMeasure();
    }

    _buildHeader() {
        const header = document.createElement('div');
        header.className = 'mixer-measure-header';

        const spacer = document.createElement('div');
        spacer.className = 'mixer-header-spacer';

        const numbers = document.createElement('div');
        numbers.className = 'mixer-measure-numbers';
        numbers.style.gridTemplateColumns = `repeat(${this.measures}, 1fr)`;

        for (let measure = 0; measure < this.measures; measure++) {
            const number = document.createElement('div');
            number.className = 'mixer-measure-number';
            number.textContent = String(measure + 1);
            number.dataset.measure = String(measure);
            number.style.cursor = 'pointer';
            number.addEventListener('click', () => this._seek(measure));
            numbers.append(number);
        }

        header.append(spacer, numbers);
        return header;
    }

    _buildRows(chain) {
        const colors = trackColors();

        return Array.from({ length: PATTERN_COUNT }, (_, pattern) => {
            const row = document.createElement('div');
            row.className = 'mixer-grid-row';
            row.dataset.pattern = String(pattern);

            const label = document.createElement('div');
            label.className = 'mixer-row-label';
            label.dataset.pattern = String(pattern);
            label.textContent = `${translateOr('arrangement.pattern', 'Pattern')} ${pattern + 1}`;

            const cells = document.createElement('div');
            cells.className = 'mixer-grid-cells';
            cells.style.gridTemplateColumns = `repeat(${this.measures}, 1fr)`;

            for (let measure = 0; measure < this.measures; measure++) {
                cells.append(this._buildCell(pattern, measure, chain, colors));
            }

            row.append(label, cells);
            return row;
        });
    }

    _buildCell(pattern, measure, chain, colors) {
        const cell = document.createElement('div');
        cell.className = 'mixer-cell';
        cell.dataset.pattern = String(pattern);
        cell.dataset.measure = String(measure);

        if (chain[measure] === pattern) {
            cell.classList.add('active');
            cell.style.borderLeftColor = colors[pattern];
            cell.style.backgroundColor = colors[pattern];

            const text = document.createElement('span');
            text.className = 'mixer-cell-label';
            text.textContent = `${translateOr('arrangement.pattern', 'Pattern')} ${pattern + 1}`;
            cell.append(text);
        }

        cell.addEventListener('click', () => this._toggleCell(pattern, measure));
        return cell;
    }

    _buildTimeline() {
        const timeline = document.createElement('div');
        timeline.className = 'mixer-timeline';

        const label = document.createElement('div');
        label.className = 'mixer-header-spacer mixer-timeline-label';
        label.innerHTML = '<i class="ti ti-clock" style="font-size:10px;opacity:0.5"></i>';

        const markers = document.createElement('div');
        markers.className = 'mixer-timeline-markers';
        markers.style.gridTemplateColumns = `repeat(${this.measures}, 1fr)`;

        const perMeasure = this._measureSeconds();

        for (let measure = 0; measure < this.measures; measure++) {
            const marker = document.createElement('div');
            marker.className = 'mixer-timeline-marker';
            marker.textContent = formatTime(measure * perMeasure);
            marker.title = `${translateOr('arrangement.measure', 'Measure')} ${measure + 1}: ${formatTimeExactly(measure * perMeasure)}`;
            markers.append(marker);
        }

        const total = document.createElement('div');
        total.className = 'mixer-timeline-total';
        total.innerHTML = `<span class="mixer-timeline-total-value">${formatTimeExactly(
            this.measures * perMeasure
        )}</span>`;
        total.title = `${translateOr('arrangement.total', 'Total')}: ${formatTimeExactly(
            this.measures * perMeasure
        )}`;

        timeline.append(label, markers, total);
        return timeline;
    }

    /** How long one measure lasts, at the tempo and pattern length now set. */
    _measureSeconds() {
        const { bpm, steps } = this.studio.sequencer;
        // A step is a sixteenth: four to the beat.
        return steps * (60 / bpm / 4);
    }

    /** Refresh the times alone: the tempo changed, the chain did not. */
    _refreshTimeline() {
        const perMeasure = this._measureSeconds();

        const markers = this.root.querySelectorAll('.mixer-timeline-marker');
        markers.forEach((marker, measure) => {
            marker.textContent = formatTime(measure * perMeasure);
            marker.title = `${translateOr('arrangement.measure', 'Measure')} ${measure + 1}: ${formatTimeExactly(measure * perMeasure)}`;
        });

        const total = this.root.querySelector('.mixer-timeline-total-value');
        if (total) total.textContent = formatTimeExactly(markers.length * perMeasure);
    }

    // ── Editing ──────────────────────────────────────────────────────────

    _toggleCell(pattern, measure) {
        const { arrangement } = this.studio;
        const chain = arrangement.getChain();

        // Clicking past the end of the chain fills what it skipped with
        // silence rather than moving the measure.
        while (chain.length <= measure) chain.push(null);

        chain[measure] = chain[measure] === pattern ? null : pattern;
        arrangement.setChain(chain, true);

        // Placing the first measure of a song should start the song playing
        // as a song, not as whichever pattern happens to be open.
        if (!arrangement.enabled && chain.some((value) => value !== null)) arrangement.enable();

        this.render();
        // Debounced: laying out a section is one edit, not twenty.
        this.studio.history.saveStateDebounced('Arrangement', 800);
    }

    _seek(measure) {
        const { arrangement } = this.studio;
        if (arrangement.chain.length === 0) return;

        if (!arrangement.enabled) arrangement.enable();
        arrangement.seekTo(measure);

        this._markCurrentMeasure();
        this._syncToggle();
        // The status line shouts; the words it borrows are written for
        // labels, where they are not shouting.
        this._flash(
            `${translateOr('arrangement.seek', 'SEEK')} → ${translateOr(
                'arrangement.measure',
                'MEASURE'
            ).toUpperCase()} ${measure + 1}`
        );
    }

    /**
     * @param {number} [index] the measure to mark; the arrangement's own
     *   position by default, which is ahead of what is being heard while the
     *   sequencer books steps in advance.
     */
    _markCurrentMeasure(index) {
        const { arrangement } = this.studio;
        const current = arrangement.enabled ? (index ?? arrangement.currentChainIndex) : -1;

        for (const number of this.root.querySelectorAll('.mixer-measure-number')) {
            number.classList.toggle('seek-active', Number(number.dataset.measure) === current);
        }
    }

    // ── The controls beside the tabs ─────────────────────────────────────

    _bindControls() {
        this._el('toggleArrangement')?.addEventListener('click', () => {
            const enabled = this.studio.arrangement.toggle();
            this.render();
            this._flash(
                enabled
                    ? translateOr('arrangement.on', 'ON')
                    : translateOr('arrangement.off', 'OFF')
            );
        });

        this._el('mixerAddCol')?.addEventListener('click', () => {
            this._setMeasures(this.measures + 1);
            this.render();
        });

        this._el('mixerRemoveCol')?.addEventListener('click', () => {
            if (this.measures <= 1) return;

            this._setMeasures(this.measures - 1);

            // A measure that is no longer shown is no longer part of the song.
            const chain = this.studio.arrangement.getChain();
            if (chain.length > this.measures) {
                this.studio.arrangement.setChain(chain.slice(0, this.measures), true);
            }

            this.render();
        });

        this._el('clearChain')?.addEventListener('click', async () => {
            const answer = await confirmAction({
                message: translateOr('confirm.clearchain', 'Clear the entire arrangement chain?'),
                confirmLabel: translateOr('arrangement.clear', 'Clear')
            });
            if (!answer) return;

            this._setMeasures(DEFAULT_MEASURES);
            this.studio.arrangement.clearChain();
            this.render();
            this.studio.history.saveState('Clear arrangement');
        });

        const presets = this._el('arrangementPresets');
        presets?.addEventListener('change', () => {
            const name = presets.value;
            // The select is a menu of actions, not a setting: it goes back to
            // its placeholder whatever happens.
            presets.value = '';
            if (!name) return;

            if (!this.studio.arrangement.loadPreset(name)) return;
            this.studio.history.saveState('Arrangement preset');

            if (!this.studio.arrangement.enabled) this.studio.arrangement.enable();
            this._setMeasures(Math.max(this.studio.arrangement.getChain().length, DEFAULT_MEASURES));

            this.render();
            this._flash(name.toUpperCase());
        });
    }

    /**
     * The number of measures shown, kept on the arrangement too: it is saved
     * with the project, and the change events below read it back.
     */
    _setMeasures(measures) {
        this.measures = measures;
        this.studio.arrangement.mixerMeasures = measures;
    }

    _syncToggle() {
        const button = this._el('toggleArrangement');
        if (!button) return;

        const { enabled } = this.studio.arrangement;
        button.textContent = enabled
            ? translateOr('arrangement.on', 'ON')
            : translateOr('arrangement.off', 'OFF');
        button.classList.toggle('btn-success', enabled);
        button.classList.toggle('btn-outline-info', !enabled);
    }

    // ── Keeping up with the studio ───────────────────────────────────────

    _listen() {
        const { bus } = this.studio;

        bus.on(ARRANGEMENT_EVENTS.advanced, () => this._markCurrentMeasure());

        // While the song plays, the measure to light up is the one being
        // heard: the step carries the measure it was booked for.
        bus.on(SEQUENCER_EVENTS.step, ({ chainIndex }) => {
            if (this.studio.arrangement.enabled) this._markCurrentMeasure(chainIndex);
        });
        bus.on(ARRANGEMENT_EVENTS.enabled, () => {
            this._syncToggle();
            this._markCurrentMeasure();
        });

        // A chain set from elsewhere: a generated song, an opened project,
        // an undo: is still this panel's business to draw.
        bus.on(ARRANGEMENT_EVENTS.changed, ({ chain }) => {
            // An opened project (or an undo) brings its own number of
            // measures, smaller as well as larger than the one on screen.
            const measures = Math.max(this.studio.arrangement.mixerMeasures || 0, chain.length, 1);
            if (measures !== this.measures) {
                this.measures = measures;
                this.render();
            } else {
                this._redrawCells(chain);
                this._syncToggle();
            }
        });

        bus.on(SEQUENCER_EVENTS.tempoChanged, () => this._refreshTimeline());
        bus.on(SEQUENCER_EVENTS.stepsChanged, () => this._refreshTimeline());
    }

    /** Repaint the cells against a chain, without rebuilding the grid. */
    _redrawCells(chain) {
        const colors = trackColors();

        for (const cell of this.root.querySelectorAll('.mixer-cell')) {
            const pattern = Number(cell.dataset.pattern);
            const measure = Number(cell.dataset.measure);
            const active = chain[measure] === pattern;

            cell.classList.toggle('active', active);
            cell.style.borderLeftColor = active ? colors[pattern] : '';
            cell.style.backgroundColor = active ? colors[pattern] : '';
            cell.innerHTML = active
                ? `<span class="mixer-cell-label">${translateOr('arrangement.pattern', 'Pattern')} ${pattern + 1}</span>`
                : '';
        }
    }

    /** Say something in the transport's status line, then let it settle. */
    _flash(text) {
        this.onStatus(text);
        window.clearTimeout(this._flashTimer);
        this._flashTimer = window.setTimeout(
            () => this.onStatus(translateOr('status.ready', 'READY')),
            1500
        );
    }
}

/** The eight pattern colours, as the stylesheet defines them. */
function trackColors() {
    const style = getComputedStyle(document.documentElement);
    return Array.from({ length: PATTERN_COUNT }, (_, track) =>
        style.getPropertyValue(`--forge-track-${track}`).trim()
    );
}

/** `1:24`: for a marker, where the second is close enough. */
function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

/** `1:24.5`: for a total, where the tenth is the point. */
function formatTimeExactly(seconds) {
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return `${minutes}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`;
}
