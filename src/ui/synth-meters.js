/**
 * The two pictures in the synth window that watch the sound.
 *
 * Everything else in that window draws a setting: turn a knob, see the
 * shape change. These two draw the audio itself: the band across the top
 * showing the track's spectrum beside its waveform, and the level meter on
 * the oscillator card. They are the only ones that move on their own, so
 * they are the only ones with an animation frame, and they are kept apart
 * from `synth-visuals.js` for exactly that reason.
 *
 * The loop runs when there is something to see: the window open, the Synth
 * tab in front, and an audio context actually running. Before the first
 * Play there is no context at all, so the picture is what the instrument
 * *would* look like: the oscillator's own shape, drawn from its settings,
 * and an unlit meter. That is a truer answer than an empty box, and it is
 * what the card shows for most of the time anyone spends in it.
 *
 * Neither picture reaches into the audio graph. `getTrackWaveform`,
 * `getTrackSpectrum` and `getTrackLevel` on the engine all return null or
 * zero when there is nothing to read, and all three reuse a buffer that
 * was allocated once: a meter that allocates sixty times a second is a
 * meter that makes the thing it is measuring stutter.
 */

/**
 * The canvases this module owns, as against the ones `synth-visuals.js`
 * draws. Named here so a test can hold the two lists against the markup:
 * a canvas added later has to be claimed by one of them or it stays the
 * black rectangle it starts as.
 */
export const SYNTH_METER_CANVASES = Object.freeze(['synthSpectrumCanvas', 'vuCanvas']);

/** The accent of each sub-tab, which the top band takes its colour from. */
const SECTION_COLOURS = Object.freeze({
    synthOscTab: '#4caf50',
    synthFilterTab: '#00bcd4',
    synthModTab: '#e040fb',
    synthEnvTab: '#ff9800',
    synthFxTab: '#f44336',
    synthArpTab: '#ffc107'
});

const DEFAULT_ACCENT = '#4caf50';

const FIELD = '#0a0e14';
const HAIRLINE = 'rgba(255,255,255,0.06)';

/** How much of the top band is spectrum; the rest is the waveform. */
const SPECTRUM_SHARE = 0.4;

/** Bins drawn, of the 128 the strip analyser produces. */
const BARS = 80;

/** The meter's ladder. */
const SEGMENTS = 16;
const AMBER_FROM = 10;
const RED_FROM = 13;

/**
 * How fast the meter falls back.
 *
 * Per frame rather than per second, so it is a little quicker on a 120 Hz
 * screen. The alternative is reading the clock every frame to smooth a
 * sixteen-segment ladder, which is more arithmetic than the difference is
 * worth.
 */
const FALL = 0.7;

/** The meter is full at half scale, so ordinary playing lights it up. */
const METER_BOOST = 2;

export class SynthMeters {
    /**
     * @param {object} options
     * @param {ParentNode} options.root
     * @param {import('../studio.js').Studio} options.studio
     */
    constructor({ root, studio }) {
        this.root = root;
        this.studio = studio;

        this.accent = DEFAULT_ACCENT;
        this._frame = null;
        /** Carried between frames, or the ladder strobes. */
        this._level = 0;
    }

    bind() {
        this._band = surfaceOf(this.root, '#synthSpectrumCanvas');
        this._meter = surfaceOf(this.root, '#vuCanvas');

        // The top band takes the colour of whichever section is in front,
        // which is the one thing here that is about the window rather than
        // the sound.
        for (const [id, colour] of Object.entries(SECTION_COLOURS)) {
            this.root.querySelector(`#${id}`)?.addEventListener('shown.bs.tab', () => {
                this.accent = colour;
                this.draw();
            });
        }
    }

    /** The window is on screen: measure, paint, and start if there is audio. */
    shown() {
        this.draw();
        this.start();
    }

    start() {
        if (this._frame !== null) return;

        const tick = () => {
            this._frame = requestAnimationFrame(tick);
            this.draw();
        };
        tick();
    }

    stop() {
        if (this._frame === null) return;

        cancelAnimationFrame(this._frame);
        this._frame = null;
        // Left mid-fall, the ladder would still be lit when the window is
        // next opened in silence.
        this._level = 0;
    }

    /** One frame of both pictures. */
    draw() {
        const track = this.studio.synthesizer.currentTrack;

        this._drawBand(track);
        this._drawMeter(track);
    }

    // ── The band across the top ──────────────────────────────────────────

    _drawBand(track) {
        const surface = measure(this._band);
        if (!surface) return;

        const { ctx, width, height } = surface;
        const waveform = this.studio.audioEngine.getTrackWaveform(track);
        const spectrum = this.studio.audioEngine.getTrackSpectrum(track);

        ctx.fillStyle = FIELD;
        ctx.fillRect(0, 0, width, height);

        ctx.strokeStyle = HAIRLINE;
        ctx.lineWidth = 1;
        stroke(ctx, [
            [0, height / 2],
            [width, height / 2]
        ]);

        // Silence is not the same as nothing to read. A track sitting
        // still while the audio runs should show its own shape, not an
        // empty box, so the idle picture is used for both.
        if (!waveform || !spectrum || !audible(waveform, spectrum)) {
            this._drawIdle(surface, track);
            return;
        }

        const spectrumWidth = width * SPECTRUM_SHARE;
        const barWidth = spectrumWidth / BARS;
        const accent = toRgb(this.accent);

        for (let bar = 0; bar < BARS && bar < spectrum.length; bar++) {
            const level = spectrum[bar] / 255;
            const bandHeight = level * height * 0.9;

            // A loud bin is brighter and whiter than a quiet one, so the
            // shape of the sound reads at a glance rather than a wall of
            // one colour.
            ctx.fillStyle = `rgba(${towardsWhite(accent, level).join(',')},${0.45 + level * 0.55})`;
            ctx.fillRect(
                bar * barWidth,
                height - bandHeight,
                Math.max(1, barWidth - 1),
                bandHeight
            );
        }

        ctx.strokeStyle = 'rgba(255,255,255,0.10)';
        ctx.lineWidth = 1;
        stroke(ctx, [
            [spectrumWidth + 4, 4],
            [spectrumWidth + 4, height - 4]
        ]);

        const scopeAt = spectrumWidth + 10;
        const scopeWidth = width - scopeAt - 4;
        if (scopeWidth < 4) return;

        ctx.strokeStyle = this.accent;
        ctx.lineWidth = 1.5;
        stroke(
            ctx,
            [...waveform].map((sample, index) => [
                scopeAt + (index / (waveform.length - 1)) * scopeWidth,
                // Positive up, the same way round as the idle picture and
                // as every other waveform in the window.
                height / 2 - (sample / 128 - 1) * height * 0.4
            ])
        );
    }

    /**
     * What the oscillator would look like, from its settings.
     *
     * Three cycles rather than the two the small waveform card shows: this
     * canvas is several times wider, and two cycles across it read as a
     * slow wobble rather than as a shape.
     */
    _drawIdle({ ctx, width, height }, track) {
        const settings = this.studio.audioEngine.tracks[track];
        if (!settings) return;

        const shape = settings.type ?? 'square';
        const duty = settings.dutyCycle ?? 0.5;
        const phase = ((settings.phase ?? 0) % 360) / 360;
        const samples = Math.max(256, Math.round(width));

        const points = [];
        for (let i = 0; i < samples; i++) {
            const u = i / (samples - 1);
            const t = (u * 3 + phase) % 1;
            points.push([u * width, height / 2 - idealWave(shape, t, duty, u) * height * 0.4]);
        }

        ctx.strokeStyle = this.accent;
        ctx.lineWidth = 1.6;
        ctx.shadowColor = this.accent;
        ctx.shadowBlur = 6;
        stroke(ctx, points);
        ctx.shadowBlur = 0;
    }

    // ── The level meter ──────────────────────────────────────────────────

    _drawMeter(track) {
        const surface = measure(this._meter);
        if (!surface) return;

        const { ctx, width, height } = surface;

        // The analyser's own smoothing is for frequency data only, so the
        // time-domain level it gives is raw and jumps about; this is what
        // makes the ladder readable rather than a flicker.
        this._level =
            this._level * FALL + this.studio.audioEngine.getTrackLevel(track) * (1 - FALL);
        const level = Math.min(1, this._level * METER_BOOST);
        const lit = Math.round(level * SEGMENTS);

        ctx.fillStyle = FIELD;
        ctx.fillRect(0, 0, width, height);

        const barWidth = Math.min(18, (width - 12) / 2);
        if (barWidth < 2) return;

        const gap = (width - barWidth * 2) / 3;
        const top = 6;
        const inner = height - top - 14;
        const segment = inner / SEGMENTS;

        ctx.font = '8px ui-monospace, "JetBrains Mono", monospace';
        ctx.textAlign = 'center';

        // Two columns, and they show the same number: the analyser sits
        // after the panner and hands back a mono mix. It is a level meter
        // drawn as a pair, not a stereo meter.
        for (const [column, label] of [
            [0, 'L'],
            [1, 'R']
        ]) {
            const x = gap + column * (barWidth + gap);

            for (let cell = 0; cell < SEGMENTS; cell++) {
                const y = top + (SEGMENTS - 1 - cell) * segment;
                ctx.fillStyle = cellColour(cell, cell < lit);
                ctx.fillRect(x, y + 1, barWidth, Math.max(1, segment - 2));
            }

            ctx.fillStyle = 'rgba(255,255,255,0.45)';
            ctx.fillText(label, x + barWidth / 2, height - 3);
        }
    }
}

/** Green up to the top third, then amber, then red. */
function cellColour(cell, lit) {
    if (cell >= RED_FROM) return lit ? '#f44336' : 'rgba(244,67,54,0.10)';
    if (cell >= AMBER_FROM) return lit ? '#ffc107' : 'rgba(255,193,7,0.10)';
    return lit ? '#4caf50' : 'rgba(76,175,80,0.08)';
}

/**
 * Whether there is a signal worth drawing.
 *
 * A running context with nothing playing gives a flat line and a floor of
 * near-zero bins, which draws as an empty box. The instrument's own shape
 * is a better answer, so the two states share one test.
 */
function audible(waveform, spectrum) {
    let peak = 0;
    let total = 0;

    for (let i = 0; i < waveform.length; i++) {
        const swing = Math.abs(waveform[i] - 128);
        if (swing > peak) peak = swing;
        total += spectrum[i];
    }

    return peak > 4 || total > spectrum.length * 2;
}

function surfaceOf(root, selector) {
    const canvas = root.querySelector(selector);
    return canvas ? { canvas, ctx: canvas.getContext('2d') } : null;
}

/**
 * Size a canvas to the box it occupies, and hand back a drawing surface in
 * CSS pixels. Null when it has no box: a pane that has never been shown.
 */
function measure(surface) {
    if (!surface?.ctx) return null;

    const box = surface.canvas.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return null;

    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(box.width * ratio);
    const height = Math.round(box.height * ratio);

    // Assigning either clears the canvas, so it is only done when the size
    // has actually changed: otherwise every frame starts by throwing the
    // last one away, which is a flicker on some machines.
    if (surface.canvas.width !== width || surface.canvas.height !== height) {
        surface.canvas.width = width;
        surface.canvas.height = height;
    }
    surface.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    return { ctx: surface.ctx, width: box.width, height: box.height };
}

function stroke(ctx, points) {
    ctx.beginPath();
    points.forEach(([x, y], index) => {
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.stroke();
}

function idealWave(shape, t, duty, u) {
    switch (shape) {
        case 'sine':
            return Math.sin(t * 2 * Math.PI);
        case 'triangle':
            return t < 0.5 ? 4 * t - 1 : 3 - 4 * t;
        case 'sawtooth':
            return 2 * t - 1;
        case 'noise': {
            const value = Math.sin(u * 1279.317) * 43758.5453;
            return (value - Math.floor(value)) * 2 - 1;
        }
        case 'square':
        default:
            return t < duty ? 1 : -1;
    }
}

function toRgb(hex) {
    const value = Number.parseInt(hex.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function towardsWhite([red, green, blue], amount) {
    const lift = (channel) => Math.round(channel + (255 - channel) * amount * 0.55);
    return [lift(red), lift(green), lift(blue)];
}
