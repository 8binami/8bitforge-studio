/**
 * The master FX rack.
 *
 * A filter with an XY pad, three send effects, and the two wheels a keyboard
 * would have. The rack is the one place where a change is heard on everything
 * at once, so every control here writes straight through to the audio graph.
 *
 * The widgets read in the units a musician expects: milliseconds, percent,
 * seconds: while `MasterFx` keeps everything in natural units. The table
 * below is that conversion, in both directions: `toNatural` for what the
 * slider sends, `toUi` for reading the state back after a project loads.
 *
 * Dragging uses pointer events rather than a mouse and touch pair: the pad and
 * the wheels are the controls most likely to be used on a tablet.
 */

import { MASTER_FX_EVENTS } from '../audio/master-fx.js';
import { FX_AUTOMATION_EVENTS } from '../automation/fx-automation.js';
import { capturePointer, releaseCapture } from './pointer-capture.js';

/** The pad's axes: frequency logarithmically across, Q up. */
const FILTER = { minHz: 20, maxHz: 20000, minQ: 0.1, maxQ: 30 };

/** One colour per filter type, so the pad says which one is live. */
const FILTER_COLORS = {
    lowpass: '13, 202, 240',
    highpass: '231, 76, 60',
    bandpass: '241, 196, 15'
};

/** Pixels of drag for a wheel's full travel. */
const WHEEL_DRAG_RANGE = 150;

const PERCENT = {
    toNatural: (value) => value / 100,
    toUi: (value) => value * 100,
    format: (value) => `${Math.round(value)}%`
};

/** Slider conversions and readouts, keyed `effect:parameter`. */
export const MASTER_FX_PARAMS = {
    'chorus:rate': {
        toNatural: (value) => value,
        toUi: (value) => value,
        format: (value) => value.toFixed(1)
    },
    'chorus:mix': PERCENT,
    'delay:time': {
        toNatural: (value) => value / 1000,
        toUi: (value) => value * 1000,
        format: (value) => `${Math.round(value)}ms`
    },
    'delay:feedback': PERCENT,
    'delay:mix': PERCENT,
    'reverb:decay': {
        toNatural: (value) => value / 10,
        toUi: (value) => value * 10,
        format: (value) => `${(value / 10).toFixed(1)}s`
    },
    'reverb:mix': PERCENT
};

export class MasterFxPanel {
    /**
     * @param {object} options
     * @param {ParentNode} options.root
     * @param {import('../studio.js').Studio} options.studio
     */
    constructor({ root, studio }) {
        this.root = root;
        this.studio = studio;
        this.masterFx = studio.masterFx;

        /** Wheel setters, so a loaded project can move them. */
        this._wheels = new Map();
    }

    bind() {
        this._bindFilter();
        this._bindEffects();
        this._bindWheels();

        this.sync();
        this.studio.bus.on(MASTER_FX_EVENTS.changed, () => this.sync());

        // An envelope moves these controls as the song plays; the rack should
        // show where it has been moved to, at most once a frame.
        this.studio.bus.on(FX_AUTOMATION_EVENTS.applied, ({ applied }) => {
            if (applied) this._scheduleSync();
        });
    }

    _scheduleSync() {
        if (this._framePending) return;

        this._framePending = true;
        requestAnimationFrame(() => {
            this._framePending = false;
            this.sync();
        });
    }

    /** @param {string} id */
    _el(id) {
        return this.root.querySelector(`#${id}`);
    }

    // ── Filter ───────────────────────────────────────────────────────────

    _bindFilter() {
        const pad = this._el('mfxFilterPad');
        const enable = this._el('mfxFilterEnable');

        enable?.addEventListener('change', () => {
            this.masterFx.setFilterEnabled(enable.checked);
            this.studio.history.saveState('Master filter');
        });

        for (const button of this.root.querySelectorAll('.mfx-type-btn')) {
            button.addEventListener('click', () => {
                this.masterFx.setFilterType(button.dataset.type);
                this.studio.history.saveState('Master filter type');
            });
        }

        if (!pad) return;

        let dragging = false;

        pad.addEventListener('pointerdown', (event) => {
            // A disabled filter still shows where it would land; it just does
            // not take the drag.
            if (!this.masterFx.filter.enabled) return;

            event.preventDefault();
            dragging = true;
            capturePointer(pad, event.pointerId);
            this._moveFilter(event, pad);
        });

        pad.addEventListener('pointermove', (event) => {
            if (dragging) this._moveFilter(event, pad);
        });

        const release = (event) => {
            if (!dragging) return;

            dragging = false;
            releaseCapture(pad, event.pointerId);
            this.studio.history.saveStateDebounced('Master filter', 400);
        };

        pad.addEventListener('pointerup', release);
        pad.addEventListener('pointercancel', release);
    }

    /** Read a pointer position as a frequency and a Q, and apply them. */
    _moveFilter(event, pad) {
        const rect = pad.getBoundingClientRect();
        const x = clamp01((event.clientX - rect.left) / rect.width);
        const y = clamp01((event.clientY - rect.top) / rect.height);

        const logMin = Math.log(FILTER.minHz);
        const logMax = Math.log(FILTER.maxHz);

        this.masterFx.setFilterFrequency(Math.exp(logMin + x * (logMax - logMin)));
        // The top of the pad is the sharpest resonance, as on a synth.
        this.masterFx.setFilterQ(FILTER.minQ + (1 - y) * (FILTER.maxQ - FILTER.minQ));

        this._drawFilter();
    }

    /** Cursor, readouts and grid, all from the filter's current state. */
    _drawFilter() {
        const { type, frequency, q } = this.masterFx.filter;

        const logMin = Math.log(FILTER.minHz);
        const logMax = Math.log(FILTER.maxHz);
        const x = clamp01(
            (Math.log(Math.max(FILTER.minHz, frequency)) - logMin) / (logMax - logMin)
        );
        const y = clamp01(1 - (q - FILTER.minQ) / (FILTER.maxQ - FILTER.minQ));

        const color = FILTER_COLORS[type] || FILTER_COLORS.lowpass;

        const cursor = this._el('mfxFilterCursor');
        if (cursor) {
            cursor.style.left = `${x * 100}%`;
            cursor.style.top = `${y * 100}%`;
            cursor.style.borderColor = `rgb(${color})`;
            cursor.style.background = `rgba(${color}, 0.3)`;
            cursor.style.boxShadow = `0 0 6px rgba(${color}, 0.4)`;
        }

        const frequencyText = this._el('mfxFilterFreqVal');
        const qText = this._el('mfxFilterQVal');
        if (frequencyText) frequencyText.textContent = String(Math.round(frequency));
        if (qText) qText.textContent = q.toFixed(1);

        this._drawGrid(x, y, color);
    }

    /** The pad's backdrop: a faint grid, a centre cross and a crosshair. */
    _drawGrid(x, y, color) {
        const canvas = this._el('mfxFilterGrid');
        const context = canvas?.getContext?.('2d');
        if (!context) return;

        const { width, height } = canvas;
        context.clearRect(0, 0, width, height);

        const gradient = context.createLinearGradient(0, 0, width, 0);
        gradient.addColorStop(0, `rgba(${color}, 0.02)`);
        gradient.addColorStop(1, `rgba(${color}, 0.08)`);
        context.fillStyle = gradient;
        context.fillRect(0, 0, width, height);

        context.strokeStyle = `rgba(${color}, 0.1)`;
        context.lineWidth = 0.5;
        for (let line = 0; line < width; line += 20) stroke(context, line, 0, line, height);
        for (let line = 0; line < height; line += 18) stroke(context, 0, line, width, line);

        context.strokeStyle = `rgba(${color}, 0.2)`;
        stroke(context, width / 2, 0, width / 2, height);
        stroke(context, 0, height / 2, width, height / 2);

        context.strokeStyle = `rgba(${color}, 0.5)`;
        context.lineWidth = 1;
        context.setLineDash([2, 3]);
        stroke(context, x * width, 0, x * width, height);
        stroke(context, 0, y * height, width, y * height);
        context.setLineDash([]);
    }

    // ── Send effects ─────────────────────────────────────────────────────

    _bindEffects() {
        for (const toggle of this.root.querySelectorAll('.mfx-fx-toggle')) {
            // The filter has its own toggle handler: it drives a pad, not a
            // pair of sliders.
            if (toggle.dataset.fx === 'filter') continue;

            toggle.addEventListener('change', () => {
                this.masterFx.setEffectEnabled(toggle.dataset.fx, toggle.checked);
                this.studio.history.saveState('Master FX');
            });
        }

        for (const slider of this.root.querySelectorAll('.mfx-slider')) {
            const { fx, param } = slider.dataset;
            const units = MASTER_FX_PARAMS[`${fx}:${param}`];
            if (!units) continue;

            slider.addEventListener('input', () => {
                const value = Number(slider.value);
                this.masterFx.setEffectParam(fx, param, units.toNatural(value));
                this._showValue(slider, units.format(value));
                this.studio.history.saveStateDebounced('Master FX', 600);
            });
        }
    }

    _showValue(slider, text) {
        const readout = slider.closest('.mfx-param')?.querySelector('.mfx-val');
        if (readout) readout.textContent = text;
    }

    // ── Wheels ───────────────────────────────────────────────────────────

    _bindWheels() {
        this._bindWheel('mfxPitchWheel', 'mfxPitchThumb', 'mfxPitchVal', {
            min: -1,
            max: 1,
            centre: 0,
            // A pitch wheel is sprung: let go and the note comes back in tune.
            springBack: true,
            onChange: (value) => this.masterFx.setPitchBend(value),
            format: (value) =>
                Math.abs(value) < 0.01 ? '0' : `${value > 0 ? '+' : ''}${(value * 100).toFixed(0)}`
        });

        this._bindWheel('mfxModWheel', 'mfxModThumb', 'mfxModVal', {
            min: 0,
            max: 1,
            centre: 0,
            springBack: false,
            onChange: (value) => this.masterFx.setModulation(value),
            format: (value) => String(Math.round(value * 100))
        });
    }

    _bindWheel(wheelId, thumbId, valueId, options) {
        const wheel = this._el(wheelId);
        const thumb = this._el(thumbId);
        const readout = this._el(valueId);
        if (!wheel || !thumb) return;

        let current = options.centre;
        let startY = 0;
        let startValue = 0;

        // The thumb is positioned as a percentage rather than in pixels: the
        // card may be collapsed when this runs, and a percentage still lands
        // in the right place once it opens.
        const draw = (value) => {
            const travel = (value - options.min) / (options.max - options.min);
            thumb.style.top = `${(1 - travel) * 100}%`;
            if (readout) readout.textContent = options.format(value);
        };

        const move = (value) => {
            const settled = Math.max(options.min, Math.min(options.max, value));
            if (settled === current) return;

            current = settled;
            draw(current);
            options.onChange(current);
        };

        draw(current);

        let dragging = false;

        wheel.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            dragging = true;
            capturePointer(wheel, event.pointerId);
            startY = event.clientY;
            startValue = current;
            thumb.classList.add('active');
        });

        wheel.addEventListener('pointermove', (event) => {
            if (!dragging) return;
            const travelled = startY - event.clientY; // up is more
            move(startValue + (travelled / WHEEL_DRAG_RANGE) * (options.max - options.min));
        });

        const release = (event) => {
            if (!dragging) return;

            dragging = false;
            releaseCapture(wheel, event.pointerId);
            thumb.classList.remove('active');

            // A sprung wheel comes back on its own the moment it is let go.
            if (options.springBack) move(options.centre);
            this.studio.history.saveStateDebounced('Master FX wheel', 400);
        };

        wheel.addEventListener('pointerup', release);
        wheel.addEventListener('pointercancel', release);

        wheel.addEventListener('dblclick', () => {
            move(options.centre);
            this.studio.history.saveState('Master FX wheel');
        });

        this._wheels.set(wheelId, (value) => {
            current = Math.max(options.min, Math.min(options.max, value));
            draw(current);
        });
    }

    // ── Reading the state back ───────────────────────────────────────────

    /** Push the rack's state onto the controls, after a load or an undo. */
    sync() {
        const { filter, effects } = this.masterFx;

        const enable = this._el('mfxFilterEnable');
        if (enable) enable.checked = filter.enabled;

        this._el('mfxFilterModule')?.classList.toggle('active', filter.enabled);
        this._el('mfxFilterPad')?.classList.toggle('disabled', !filter.enabled);

        for (const button of this.root.querySelectorAll('.mfx-type-btn')) {
            button.classList.toggle('active', button.dataset.type === filter.type);
        }

        this._drawFilter();

        for (const toggle of this.root.querySelectorAll('.mfx-fx-toggle')) {
            const state = effects[toggle.dataset.fx];
            if (!state) continue;

            toggle.checked = state.enabled;
            toggle.closest('.mfx-module')?.classList.toggle('active', state.enabled);
        }

        for (const slider of this.root.querySelectorAll('.mfx-slider')) {
            const { fx, param } = slider.dataset;
            const units = MASTER_FX_PARAMS[`${fx}:${param}`];
            const state = effects[fx];
            if (!units || state?.[param] === undefined) continue;

            const value = units.toUi(state[param]);
            slider.value = String(value);
            this._showValue(slider, units.format(value));
        }

        this._wheels.get('mfxPitchWheel')?.(this.masterFx.pitchBend);
        this._wheels.get('mfxModWheel')?.(this.masterFx.modulation);
    }
}

function stroke(context, x1, y1, x2, y2) {
    context.beginPath();
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
    context.stroke();
}

function clamp01(value) {
    return Math.min(1, Math.max(0, value));
}
