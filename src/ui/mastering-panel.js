/**
 * The mastering card.
 *
 * A five-band EQ drawn over the spectrum of what is coming through it, with a
 * handle per band: drag sideways for frequency, up and down for gain, and the
 * wheel for Q. The two bands that only cut, the high-pass and the low-pass:
 * have no gain to drag, so their handles stay on the zero line.
 *
 * Beside it, the compressor's five knobs and three meters: what goes in, what
 * comes out, and how much the compressor is taking off. The clip light stays
 * on once it has seen a peak at full scale, because a clip you have already
 * missed is exactly the one worth knowing about; it is cleared by hand.
 *
 * The display only runs while the card is open and the audio is playing.
 */

import { MASTERING_EVENTS } from '../audio/mastering.js';
import { createKnob } from './knob.js';
import { translateOr } from '../i18n/i18n.js';

/** The display's axes: 20 Hz to 20 kHz across, ±24 dB up. */
const MIN_HZ = 20;
const MAX_HZ = 20000;
const DB_RANGE = 48;

/** How close a click has to be to a handle to take hold of it. */
const GRAB_RADIUS = 12;

const BAND_COLORS = ['#e74c3c', '#f39c12', '#2ecc71', '#3498db', '#9b59b6'];
const BAND_NAMES = ['HPF', 'Low Shelf', 'Mid Bell', 'High Shelf', 'LPF'];

/** Bands with nothing to gain: their handle sits on the zero line. */
const CUT_ONLY = new Set(['highpass', 'lowpass']);

/** The frequencies the response curve is measured at. */
const CURVE_POINTS = 200;

/** The compressor's knobs. Times read in milliseconds, seconds underneath. */
const COMP_KNOBS = [
    {
        key: 'threshold',
        label: 'THRESH',
        min: -60,
        max: 0,
        step: 1,
        color: '#e74c3c',
        format: (value) => `${value}dB`
    },
    {
        key: 'ratio',
        label: 'RATIO',
        min: 1,
        max: 20,
        step: 0.5,
        color: '#f39c12',
        format: (value) => `${value.toFixed(1)}:1`
    },
    {
        key: 'attack',
        label: 'ATK',
        min: 0.1,
        max: 100,
        step: 0.1,
        color: '#2ecc71',
        format: (value) => `${value.toFixed(1)}ms`,
        toUi: (seconds) => seconds * 1000,
        toModel: (ms) => ms / 1000
    },
    {
        key: 'release',
        label: 'REL',
        min: 10,
        max: 1000,
        step: 10,
        color: '#3498db',
        format: (value) => `${Math.round(value)}ms`,
        toUi: (seconds) => seconds * 1000,
        toModel: (ms) => ms / 1000
    },
    {
        key: 'makeupGain',
        label: 'GAIN',
        min: 0,
        max: 24,
        step: 0.5,
        color: '#9b59b6',
        format: (value) => `+${value.toFixed(1)}dB`
    }
];

export class MasteringPanel {
    /**
     * @param {object} options
     * @param {ParentNode} options.root
     * @param {import('../studio.js').Studio} options.studio
     */
    constructor({ root, studio }) {
        this.root = root;
        this.studio = studio;
        this.mastering = studio.mastering;

        this._dragging = -1;
        this._hovered = -1;
        this._frame = null;
        this._clipping = false;

        /** Where the response curve is sampled, logarithmically. */
        this._curveHz = new Float32Array(CURVE_POINTS);
        for (let i = 0; i < CURVE_POINTS; i++) {
            this._curveHz[i] = MIN_HZ * (MAX_HZ / MIN_HZ) ** (i / (CURVE_POINTS - 1));
        }
    }

    bind() {
        this._canvas = this.root.querySelector('#masteringEqCanvas');
        this._context = this._canvas?.getContext('2d');

        this._buildCompressor();
        this._buildPresets();
        this._bindButtons();
        this._bindCanvas();
        this._watchSize();
        this._watchCard();

        this.studio.bus.on(MASTERING_EVENTS.changed, () => this.sync());
        this.sync();
    }

    _el(id) {
        return this.root.querySelector(`#${id}`);
    }

    // ── The controls ─────────────────────────────────────────────────────

    _buildCompressor() {
        const container = this._el('masteringCompKnobs');
        if (!container) return;

        container.innerHTML = '';
        this._knobs = new Map();

        for (const knob of COMP_KNOBS) {
            const value = this.mastering.compressor[knob.key];

            const element = createKnob({
                label: knob.label,
                min: knob.min,
                max: knob.max,
                value: knob.toUi ? knob.toUi(value) : value,
                step: knob.step,
                size: 36,
                arcColor: knob.color,
                className: `knob-mst-${knob.key}`,
                formatValue: knob.format,
                onChange: (next) => {
                    this.mastering.setCompParam(knob.key, knob.toModel ? knob.toModel(next) : next);
                    this.studio.history.saveStateDebounced('Mastering compressor', 600);
                }
            });

            this._knobs.set(knob.key, element);
            container.append(element);
        }
    }

    _buildPresets() {
        const select = this._el('masteringPresetSelect');
        if (!select) return;

        for (const [key, preset] of Object.entries(
            this.mastering.constructor.getMasteringPresets()
        )) {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = translateOr(preset.i18nKey, preset.name);
            option.dataset.i18n = preset.i18nKey;
            select.append(option);
        }

        select.addEventListener('change', () => {
            if (!select.value) return;

            this.mastering.applyPreset(select.value);
            this.studio.history.saveState('Mastering preset');
        });
    }

    _bindButtons() {
        this._el('masteringCompEnable')?.addEventListener('click', () => {
            this.mastering.setCompParam('enabled', !this.mastering.compressor.enabled);
            this.studio.history.saveState('Mastering compressor');
        });

        this._el('masteringBypass')?.addEventListener('click', () => {
            this.mastering.setBypass(!this.mastering.bypassed);
            this.studio.history.saveState('Mastering bypass');
        });

        this._el('masteringReset')?.addEventListener('click', () => {
            this.mastering.resetToDefaults();
            this.studio.history.saveState('Mastering reset');
        });

        for (const id of ['masteringClipLed', 'masteringClipReset']) {
            this._el(id)?.addEventListener('click', () => this._clearClip());
        }
    }

    _clearClip() {
        this._clipping = false;
        this._el('masteringClipLed')?.classList.remove('clip');
    }

    // ── The band handles ─────────────────────────────────────────────────

    _bindCanvas() {
        const canvas = this._canvas;
        if (!canvas) return;

        canvas.addEventListener('pointerdown', (event) => {
            const { x, y } = this._at(event);
            this._dragging = this._hitTest(x, y);
            if (this._dragging >= 0) canvas.setPointerCapture?.(event.pointerId);
        });

        canvas.addEventListener('pointermove', (event) => {
            const { x, y } = this._at(event);

            if (this._dragging < 0) {
                this._hovered = this._hitTest(x, y);
                canvas.style.cursor = this._hovered >= 0 ? 'pointer' : 'default';
                return;
            }

            const band = this.mastering.eq.bands[this._dragging];
            this.mastering.setEqBand(
                this._dragging,
                'freq',
                clamp(xToHz(x, this._width), MIN_HZ, MAX_HZ)
            );

            if (!CUT_ONLY.has(band.type)) {
                // Half a decibel is as fine as this display can be read.
                const gain = clamp(yToDb(y, this._height), -24, 24);
                this.mastering.setEqBand(this._dragging, 'gain', Math.round(gain * 2) / 2);
            }

            this._showBand(this._dragging);
            this._draw();
        });

        const release = (event) => {
            if (this._dragging < 0) return;

            this._dragging = -1;
            canvas.releasePointerCapture?.(event.pointerId);
            this.studio.history.saveState('Mastering EQ');
        };

        canvas.addEventListener('pointerup', release);
        canvas.addEventListener('pointercancel', release);

        canvas.addEventListener(
            'wheel',
            (event) => {
                if (this._hovered < 0) return;

                event.preventDefault();
                const band = this.mastering.eq.bands[this._hovered];
                const q = clamp(band.q + (event.deltaY > 0 ? -0.1 : 0.1), 0.1, 18);

                this.mastering.setEqBand(this._hovered, 'q', Math.round(q * 10) / 10);
                this._showBand(this._hovered);
                this._draw();
                this.studio.history.saveStateDebounced('Mastering EQ', 500);
            },
            { passive: false }
        );
    }

    /** A pointer's position in the canvas's own coordinates. */
    _at(event) {
        const rect = this._canvas.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    _hitTest(x, y) {
        return this.mastering.eq.bands.findIndex((band, index) => {
            const dx = x - hzToX(band.freq, this._width);
            const dy = y - this._handleY(index);
            return Math.hypot(dx, dy) < GRAB_RADIUS;
        });
    }

    _handleY(index) {
        const band = this.mastering.eq.bands[index];
        return dbToY(CUT_ONLY.has(band.type) ? 0 : band.gain, this._height);
    }

    /** Print what a band is set to, under the display. */
    _showBand(index) {
        const bar = this._el('masteringStatus');
        if (!bar) return;

        const band = this.mastering.eq.bands[index];
        const hz =
            band.freq >= 1000
                ? `${(band.freq / 1000).toFixed(1)} kHz`
                : `${Math.round(band.freq)} Hz`;
        const gain = CUT_ONLY.has(band.type)
            ? ''
            : ` | Gain: ${band.gain >= 0 ? '+' : ''}${band.gain.toFixed(1)} dB`;

        bar.textContent = `${BAND_NAMES[index]} | Freq: ${hz}${gain} | Q: ${band.q.toFixed(1)}`;
    }

    // ── Drawing ──────────────────────────────────────────────────────────

    _resize() {
        const canvas = this._canvas;
        if (!canvas || !this._context) return;

        const rect = canvas.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) return;

        // The buffer is in device pixels and the drawing is in CSS pixels, so
        // a line is one pixel wide rather than two blurred ones.
        const ratio = window.devicePixelRatio || 1;
        canvas.width = rect.width * ratio;
        canvas.height = rect.height * ratio;
        this._width = rect.width;
        this._height = rect.height;
        this._context.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    _draw() {
        const context = this._context;
        if (!context || !this._width) return;

        const width = this._width;
        const height = this._height;

        context.clearRect(0, 0, width, height);
        context.fillStyle = '#0a0a18';
        context.fillRect(0, 0, width, height);

        this._drawGrid(context, width, height);
        this._drawSpectrum(context, width, height);
        this._drawCurve(context, width, height);
        this._drawHandles(context, width, height);
    }

    _drawGrid(context, width, height) {
        context.strokeStyle = 'rgba(255,255,255,0.06)';
        context.lineWidth = 0.5;
        context.font = '8px sans-serif';
        context.fillStyle = 'rgba(255,255,255,0.2)';

        for (const hz of [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]) {
            const x = hzToX(hz, width);
            line(context, x, 0, x, height);
            context.fillText(hz >= 1000 ? `${hz / 1000}k` : String(hz), x + 2, height - 3);
        }

        for (const db of [-24, -18, -12, -6, 0, 6, 12, 18, 24]) {
            const y = dbToY(db, height);
            line(context, 0, y, width, y);
            if (db !== 0) context.fillText(`${db > 0 ? '+' : ''}${db} dB`, 2, y - 2);
        }

        context.strokeStyle = 'rgba(255,255,255,0.15)';
        context.lineWidth = 1;
        line(context, 0, dbToY(0, height), width, dbToY(0, height));
    }

    /** What is coming through, behind the curve. */
    _drawSpectrum(context, width, height) {
        const bins = this.mastering.getSpectrumData();
        if (!bins) return;

        const rate = this.studio.audioEngine.audioContext?.sampleRate ?? 44100;
        const bars = 128;
        context.fillStyle = 'rgba(100, 130, 255, 0.12)';

        for (let bar = 0; bar < bars; bar++) {
            const from = MIN_HZ * (MAX_HZ / MIN_HZ) ** (bar / bars);
            const to = MIN_HZ * (MAX_HZ / MIN_HZ) ** ((bar + 1) / bars);

            // One bar covers several bins low down and less than one high up.
            const first = Math.max(0, Math.floor((from * bins.length * 2) / rate));
            const last = Math.min(bins.length - 1, Math.floor((to * bins.length * 2) / rate));
            if (last < first) continue;

            let sum = 0;
            for (let bin = first; bin <= last; bin++) sum += bins[bin];

            const level = sum / (last - first + 1) / 255;
            const x = hzToX(from, width);
            context.fillRect(
                x,
                height - level * height * 0.85,
                Math.max(1, hzToX(to, width) - x),
                level * height * 0.85
            );
        }
    }

    _drawCurve(context, width, height) {
        if (!this.mastering.eq.enabled) return;

        const responses = this.mastering.getBandResponses(this._curveHz);
        if (!responses.length) return;

        const zero = dbToY(0, height);
        const shape = (decibels) => {
            context.beginPath();
            context.moveTo(hzToX(this._curveHz[0], width), zero);
            for (let i = 0; i < decibels.length; i++) {
                context.lineTo(hzToX(this._curveHz[i], width), dbToY(decibels[i], height));
            }
            context.lineTo(hzToX(this._curveHz[this._curveHz.length - 1], width), zero);
            context.closePath();
        };

        // Each band in its own colour, so a handle can be told from its effect.
        for (const [index, decibels] of responses.entries()) {
            if (!decibels.some((db) => Math.abs(db) > 0.3)) continue;

            shape(decibels);
            context.fillStyle = `${BAND_COLORS[index]}25`;
            context.fill();
        }

        const combined = new Float32Array(this._curveHz.length);
        for (const decibels of responses) {
            for (let i = 0; i < combined.length; i++) combined[i] += decibels[i];
        }

        shape(combined);
        context.fillStyle = 'rgba(255,255,255,0.04)';
        context.fill();

        context.beginPath();
        for (let i = 0; i < combined.length; i++) {
            const x = hzToX(this._curveHz[i], width);
            const y = dbToY(combined[i], height);
            if (i === 0) context.moveTo(x, y);
            else context.lineTo(x, y);
        }
        context.strokeStyle = 'rgba(255,255,255,0.85)';
        context.lineWidth = 1.5;
        context.stroke();
    }

    _drawHandles(context, width) {
        for (const [index, band] of this.mastering.eq.bands.entries()) {
            const x = hzToX(band.freq, width);
            const y = this._handleY(index);
            const radius = index === this._dragging || index === this._hovered ? 8 : 6;

            context.beginPath();
            context.arc(x, y, radius + 3, 0, Math.PI * 2);
            context.fillStyle = `${BAND_COLORS[index]}30`;
            context.fill();

            context.beginPath();
            context.arc(x, y, radius, 0, Math.PI * 2);
            context.fillStyle = BAND_COLORS[index];
            context.fill();
            context.strokeStyle = '#fff';
            context.lineWidth = 1.5;
            context.stroke();
        }
    }

    // ── Meters ───────────────────────────────────────────────────────────

    _drawMeters() {
        const samples = this.mastering.getTimeDomainData();

        if (samples) {
            let squares = 0;
            let peak = 0;

            for (const sample of samples) {
                const value = (sample - 128) / 128;
                squares += value * value;
                peak = Math.max(peak, Math.abs(value));
            }

            const rms = Math.sqrt(squares / samples.length);
            this._setMeter('masteringMeterOut', 'masteringDbOut', rms, decibels(peak));

            // A peak at full scale means the master bus is clipping. The light
            // stays on until it is cleared: the clip you missed is the one
            // worth being told about.
            if (decibels(peak) >= -0.1) {
                this._clipping = true;
                this._el('masteringClipLed')?.classList.add('clip');
            }
        }

        const input = this.studio.audioEngine.getMasterLevel?.() ?? 0;
        this._setMeter('masteringMeterIn', 'masteringDbIn', input, decibels(input));

        const reduction = this.mastering.getCompressorReduction();
        const fill = this._el('masteringGrFill');
        if (fill) {
            fill.style.width = `${Math.min(100, (Math.abs(reduction) / 24) * 100)}%`;
            const label = this._el('masteringGrLabel');
            if (label) {
                label.textContent = reduction < -0.1 ? `${reduction.toFixed(1)} dB` : '0 dB';
            }
        }
    }

    /** A meter reads from −60 dB to full scale. */
    _setMeter(fillId, labelId, level, shownDb) {
        const fill = this._el(fillId);
        if (fill) {
            fill.style.width = `${clamp(((decibels(level) + 60) / 60) * 100, 0, 100)}%`;
        }

        const label = this._el(labelId);
        if (label) label.textContent = shownDb > -60 ? shownDb.toFixed(1) : '-∞';
    }

    // ── When it runs ─────────────────────────────────────────────────────

    start() {
        if (this._frame) return;

        this._resize();
        const step = () => {
            this._frame = requestAnimationFrame(step);
            this._draw();
            this._drawMeters();
        };
        step();
    }

    stop() {
        if (this._frame) cancelAnimationFrame(this._frame);
        this._frame = null;
    }

    _watchSize() {
        if (typeof ResizeObserver !== 'function' || !this._canvas) return;

        this._observer = new ResizeObserver(() => {
            this._resize();
            if (!this._frame) this._draw();
        });
        this._observer.observe(this._canvas);
    }

    _watchCard() {
        const card = this._canvas?.closest('.card');
        if (!card) return;

        const follow = () => {
            const shut =
                card.classList.contains('card-collapse') || card.classList.contains('d-none');

            if (shut) this.stop();
            else this.start();
        };

        new MutationObserver(follow).observe(card, {
            attributes: true,
            attributeFilter: ['class']
        });
        follow();
    }

    // ── Reading the state back ───────────────────────────────────────────

    sync() {
        const { compressor, bypassed } = this.mastering;

        for (const knob of COMP_KNOBS) {
            const value = compressor[knob.key];
            this._knobs?.get(knob.key)?.setValue(knob.toUi ? knob.toUi(value) : value);
        }

        const enable = this._el('masteringCompEnable');
        enable?.classList.toggle('active', compressor.enabled);
        this.root
            .querySelector('.mastering-comp-body')
            ?.classList.toggle('d-none', !compressor.enabled);

        this._el('masteringBypass')?.classList.toggle('active', bypassed);
        this._showBand(this._dragging >= 0 ? this._dragging : 0);
        this._draw();
    }
}

// ── The display's two axes ───────────────────────────────────────────────

function hzToX(hz, width) {
    return (Math.log10(hz / MIN_HZ) / Math.log10(MAX_HZ / MIN_HZ)) * width;
}

function xToHz(x, width) {
    return MIN_HZ * (MAX_HZ / MIN_HZ) ** (x / width);
}

function dbToY(db, height) {
    return height / 2 - (db / DB_RANGE) * height;
}

function yToDb(y, height) {
    return (-(y - height / 2) / height) * DB_RANGE;
}

function decibels(level) {
    return level > 0 ? 20 * Math.log10(level) : -100;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function line(context, x1, y1, x2, y2) {
    context.beginPath();
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
    context.stroke();
}
