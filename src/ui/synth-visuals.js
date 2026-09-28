/**
 * The little pictures in the synth window.
 *
 * Sixteen read-only canvases, one per card: the oscillator's shape, where
 * it is tuned, how its unison voices sit across the stereo field, the
 * filter's response and its envelope, the amplitude envelope, three LFO
 * shapes, the five per-track effects, and the arpeggiator's pattern. None
 * of them is a control. Every one is a picture of something you set
 * elsewhere, drawn so you can see what you did without reading five
 * numbers.
 *
 * They are a table for the same reason the controls are one. Sixteen
 * canvases written out as sixteen bound methods is sixteen chances to
 * forget a redraw; here each is an entry with an id and a `draw`, and the
 * panel walks the list. A canvas that is in the list is drawn at every
 * moment any of them is, or it is not drawn at all.
 *
 * The two that are not here (the spectrum and the VU meter) show live
 * audio rather than settings, so they belong to whatever owns an
 * animation frame, not to a list redrawn when a knob moves.
 *
 * Nothing here reads the DOM for a value. The original read its numbers off
 * the sliders, which meant a picture could disagree with the sound whenever
 * a preset changed the engine without touching a control: which is exactly
 * what loading a preset does. These read the engine, through the same
 * `SynthContext` the control table reads.
 *
 * Sizing follows `mastering-panel.js`: the backing store is in device
 * pixels and the drawing is in CSS pixels, so a hairline is one pixel wide
 * rather than two blurred ones. Everything below is therefore in CSS
 * pixels, and the canvases are 40, 50, 64 or 80 tall as the stylesheet pins
 * them.
 */

/** The accent each section of the window is drawn in. */
const OSC = '#4caf50';
const FILTER = '#00bcd4';
const MOD = '#e040fb';
const ENV = '#ff9800';
const FX = '#f44336';
const ARP = '#ffc107';

/** The panel behind every picture, and the hairlines on it. */
const FIELD = '#0D1014';
const HAIRLINE = 'rgba(255,255,255,0.05)';
const GRID = 'rgba(255,255,255,0.06)';
const LABEL = 'rgba(255,255,255,0.40)';
const MARKER = 'rgba(255,255,255,0.85)';

const MONO = '8px ui-monospace, "JetBrains Mono", monospace';

/** What the track effects look like before the audio exists to hold them. */
const FX_AT_REST = Object.freeze({
    distortion: 0,
    delayTime: 0.25,
    delayFeedback: 0.3,
    delayMix: 0,
    reverbMix: 0,
    reverbDecay: 0.5,
    chorusRate: 1,
    chorusDepth: 0,
    chorusMix: 0,
    crushBits: 16,
    crushRate: 1
});

/**
 * How strongly an effect's picture is drawn, from how much of it you are
 * hearing.
 *
 * The original made a bypassed effect look fully engaged: the reverb drew
 * a full tail at zero mix, and the chorus got *smaller* as you raised the
 * mix off zero before growing again. The shape is worth showing whatever
 * the mix is, so it stays at full size and fades instead: a ghost at zero,
 * solid at one, and monotonic in between.
 */
function mixAlpha(mix) {
    return 0.25 + 0.75 * clamp(mix ?? 0, 0, 1);
}

export const SYNTH_CANVASES = [
    // ── Oscillator ───────────────────────────────────────────────────────
    {
        id: 'oscWaveCanvas',
        draw(surface, { settings }) {
            const { ctx, width, height } = surface;
            const shape = settings.type ?? 'square';
            const duty = settings.dutyCycle ?? 0.5;
            // The engine holds phase in degrees; a cycle is one turn.
            const phase = (settings.phase ?? 0) / 360;

            field(surface);
            hairline(ctx, 0, height / 2, width, height / 2);

            trace(surface, OSC, (u) => {
                const t = (u * 2 + phase) % 1;
                return waveform(shape, t, duty, u);
            });
        }
    },
    {
        id: 'tuningCanvas',
        draw(surface, { settings }) {
            const { ctx, width, height } = surface;
            const semitones =
                (settings.octaveOffset ?? 0) * 12 +
                (settings.semitoneOffset ?? 0) +
                (settings.detune ?? 0) / 100;
            const envelope = settings.pitchEnv ?? 0;

            const RANGE = 36;
            const at = (value) => ((clamp(value, -RANGE, RANGE) + RANGE) / (RANGE * 2)) * width;

            field(surface);

            // An octave every twelve semitones, labelled in octaves.
            ctx.font = MONO;
            ctx.textAlign = 'center';
            for (let semi = -RANGE; semi <= RANGE; semi += 12) {
                const x = at(semi);
                ctx.strokeStyle = semi === 0 ? 'rgba(255,255,255,0.18)' : HAIRLINE;
                ctx.lineWidth = 1;
                line(ctx, x, 6, x, height - 14);

                ctx.fillStyle = LABEL;
                ctx.fillText(semi === 0 ? '0' : signed(semi / 12), x, height - 3);
            }

            // How far the pitch envelope will carry the note, as a band
            // between where it starts and where it settles.
            if (envelope !== 0) {
                const from = at(semitones);
                const to = at(semitones + envelope);
                ctx.fillStyle = withAlpha(OSC, 0.2);
                ctx.fillRect(Math.min(from, to), 8, Math.abs(to - from), height - 22);
            }

            const x = at(semitones);
            ctx.strokeStyle = OSC;
            ctx.lineWidth = 2;
            glow(ctx, OSC, 4, () => line(ctx, x, 6, x, height - 14));

            ctx.fillStyle = OSC;
            ctx.beginPath();
            ctx.moveTo(x, 4);
            ctx.lineTo(x + 4, 8);
            ctx.lineTo(x, 12);
            ctx.lineTo(x - 4, 8);
            ctx.closePath();
            ctx.fill();
        }
    },
    {
        id: 'unisonCanvas',
        draw(surface, { settings }) {
            const { ctx, width, height } = surface;
            const voices = settings.unisonVoices ?? 1;
            // Cents of spread, read only as "how ragged", and a percentage
            // of pan, read as "how wide". The same divisor, two meanings.
            const ragged = (settings.unisonDetune ?? 0) / 100;
            const wide = (settings.unisonSpread ?? 0) / 100;

            field(surface);

            ctx.font = MONO;
            ctx.fillStyle = 'rgba(255,255,255,0.30)';
            ctx.textAlign = 'left';
            ctx.fillText('L', 4, height - 4);
            ctx.textAlign = 'right';
            ctx.fillText('R', width - 4, height - 4);

            // The voices live above the labels rather than across them: the
            // original centred this on the canvas and ran its bars into the
            // lettering.
            const band = height - 14;
            const middle = band / 2;
            hairline(ctx, 0, middle, width, middle);

            const centre = width / 2;
            const reach = Math.max(0, width / 2 - 14);

            for (let voice = 0; voice < voices; voice++) {
                // The engine's own spread position: -1 at the left edge of
                // the chorus of voices, +1 at the right.
                const at = voices === 1 ? 0 : (voice / (voices - 1)) * 2 - 1;
                const x = centre + at * reach * wide;
                const wobble = (voice % 2 === 0 ? -1 : 1) * ragged * 8;
                const length = (band - 8) * (1 - Math.abs(at) * 0.25);
                const top = middle - length / 2 + wobble;

                ctx.globalAlpha = voices === 1 ? 1 : 0.55 + (1 - Math.abs(at)) * 0.4;
                ctx.strokeStyle = OSC;
                ctx.lineWidth = 2;
                glow(ctx, OSC, 4, () => {
                    line(ctx, x, top, x, top + length);

                    ctx.fillStyle = OSC;
                    ctx.beginPath();
                    ctx.arc(x, top, 1.8, 0, Math.PI * 2);
                    ctx.fill();
                });
                ctx.globalAlpha = 1;
            }
        }
    },

    // ── Filter ───────────────────────────────────────────────────────────
    {
        id: 'filterRespCanvas',
        draw(surface, { settings }) {
            const { ctx, width, height } = surface;

            // What the engine will actually build. A track whose filter is
            // off is not a lowpass at whatever cutoff was left behind: the
            // engine opens it to 20 kHz and drops the resonance, and the
            // picture should say so rather than draw a peak nobody hears.
            const open = settings.filterEnabled !== true;
            const type = open ? 'lowpass' : (settings.filterType ?? 'lowpass');
            const cutoff = open ? 20000 : (settings.filterCutoff ?? 20000);
            const q = open ? 0.1 : Math.max(0.1, settings.filterQ ?? 0.1);

            const LOW = 20;
            const HIGH = 20000;
            const at = (hz) =>
                (Math.log(clamp(hz, LOW, HIGH) / LOW) / Math.log(HIGH / LOW)) * width;

            // Decibels, from a floor to a ceiling, across the height.
            const FLOOR = -30;
            const CEILING = 12;
            const dbAt = (db) =>
                height - ((clamp(db, FLOOR, CEILING) - FLOOR) / (CEILING - FLOOR)) * height;

            field(surface);

            ctx.strokeStyle = GRID;
            ctx.lineWidth = 1;
            for (const hz of [100, 1000, 10000]) line(ctx, at(hz), 0, at(hz), height);
            line(ctx, 0, dbAt(0), width, dbAt(0));

            const points = [];
            const samples = Math.max(160, Math.round(width));
            for (let i = 0; i < samples; i++) {
                const u = i / (samples - 1);
                const hz = LOW * (HIGH / LOW) ** u;
                points.push({ x: u * width, y: dbAt(decibels(response(type, hz / cutoff, q))) });
            }

            const under = ctx.createLinearGradient(0, 0, 0, height);
            under.addColorStop(0, withAlpha(FILTER, 0.3));
            under.addColorStop(1, withAlpha(FILTER, 0.02));
            ctx.fillStyle = under;
            ctx.beginPath();
            ctx.moveTo(0, height);
            for (const point of points) ctx.lineTo(point.x, point.y);
            ctx.lineTo(width, height);
            ctx.closePath();
            ctx.fill();

            ctx.strokeStyle = FILTER;
            ctx.lineWidth = 1.5;
            glow(ctx, FILTER, 4, () => {
                ctx.beginPath();
                points.forEach((point, i) => {
                    if (i === 0) ctx.moveTo(point.x, point.y);
                    else ctx.lineTo(point.x, point.y);
                });
                ctx.stroke();
            });

            if (open) return;

            ctx.strokeStyle = 'rgba(255,255,255,0.40)';
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 2]);
            line(ctx, at(cutoff), 0, at(cutoff), height);
            ctx.setLineDash([]);
        }
    },
    {
        id: 'filterEnvCanvas',
        draw(surface, { settings }) {
            const { ctx, width, height } = surface;
            // The pads that set these run 0-1 s and 0-2 s; a preset from
            // somewhere else can hold more, and unclamped it draws off the
            // side of the canvas.
            const attack = clamp((settings.filterEnvAttack ?? 0.01) / 1, 0, 1);
            const release = clamp((settings.filterEnvRelease ?? 0.2) / 2, 0, 1);
            const amount = clamp((settings.filterEnvAmount ?? 0) / 48, -1, 1);

            const pad = 4;
            const span = width - pad * 2;
            const middle = height / 2;
            // The plateau is the held part of a note, between the end of
            // the attack and the moment the key is let go. A note has no
            // one length, so it is drawn at a fixed share of the picture.
            const HOLD = 0.5;
            const total = attack + HOLD + release;

            const xAttack = pad + (attack / total) * span;
            const xHold = xAttack + (HOLD / total) * span;
            const xEnd = width - pad;
            const peak = middle - amount * (height * 0.42);

            field(surface);

            ctx.strokeStyle = 'rgba(255,255,255,0.08)';
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 3]);
            line(ctx, 0, middle, width, middle);
            ctx.setLineDash([]);

            const shape = [
                [pad, middle],
                [xAttack, peak],
                [xHold, peak],
                [xEnd, middle]
            ];

            const under = ctx.createLinearGradient(0, 0, 0, height);
            // The dense end of the fade follows the direction the envelope
            // travels, so a negative amount is shaded downwards.
            under.addColorStop(0, withAlpha(FILTER, amount >= 0 ? 0.3 : 0.02));
            under.addColorStop(1, withAlpha(FILTER, amount >= 0 ? 0.02 : 0.3));
            ctx.fillStyle = under;
            polygon(ctx, shape);
            ctx.fill();

            ctx.strokeStyle = FILTER;
            ctx.lineWidth = 1.5;
            glow(ctx, FILTER, 4, () => {
                polyline(ctx, shape);
                ctx.stroke();
            });

            ctx.fillStyle = MARKER;
            for (const [x, y] of shape.slice(1)) dot(ctx, x, y);

            stageLabels(ctx, height, [
                ['A', 4],
                ['H', xAttack - 1],
                ['R', xHold - 1]
            ]);
        }
    },

    // ── Envelope and modulation ──────────────────────────────────────────
    {
        id: 'envAdsrCanvas',
        draw(surface, { envelope }) {
            const { ctx, width, height } = surface;
            // Seconds, against the ranges the sliders offer. Past those the
            // stage simply takes a larger share, which is honest.
            const attack = (envelope.attack ?? 0) / 1;
            const decay = (envelope.decay ?? 0) / 2;
            const release = (envelope.release ?? 0) / 2;
            const sustain = clamp(envelope.sustain ?? 0, 0, 1);

            const pad = 4;
            const span = width - pad * 2;
            const top = pad;
            const bottom = height - pad;
            const HOLD = 0.6;
            const total = attack + decay + HOLD + release;

            const xAttack = pad + (attack / total) * span;
            const xDecay = xAttack + (decay / total) * span;
            const xSustain = xDecay + (HOLD / total) * span;
            const xEnd = width - pad;
            const level = bottom - sustain * (bottom - top);

            field(surface);

            const shape = [
                [pad, bottom],
                [xAttack, top],
                [xDecay, level],
                [xSustain, level],
                [xEnd, bottom]
            ];

            const under = ctx.createLinearGradient(0, top, 0, bottom);
            under.addColorStop(0, withAlpha(ENV, 0.3));
            under.addColorStop(1, withAlpha(ENV, 0.02));
            ctx.fillStyle = under;
            polygon(ctx, shape);
            ctx.fill();

            ctx.strokeStyle = ENV;
            ctx.lineWidth = 1.5;
            glow(ctx, ENV, 4, () => {
                polyline(ctx, shape);
                ctx.stroke();
            });

            ctx.fillStyle = MARKER;
            for (const [x, y] of shape.slice(1)) dot(ctx, x, y);

            stageLabels(ctx, height, [
                ['A', 4],
                ['D', xAttack - 1],
                ['S', xDecay - 1],
                ['R', xEnd - 8]
            ]);
        }
    },
    ...[1, 2, 3].map((number) => ({
        id: `lfo${number}WaveCanvas`,
        draw(surface, { settings }) {
            const { ctx, width, height } = surface;
            const shape = settings[`lfo${number}Wave`] ?? 'sine';

            field(surface);
            hairline(ctx, 0, height / 2, width, height / 2);

            // Two cycles at full height, whatever the rate and depth are:
            // this says what shape the modulation has, not how much of it
            // there is. The depth lives on a knob beside it.
            trace(surface, MOD, (u) => waveform(shape, (u * 2) % 1, 0.5, u));
        }
    })),

    // ── The per-track effects ────────────────────────────────────────────
    {
        id: 'fxDistCanvas',
        draw(surface, context) {
            const { ctx, width, height } = surface;
            const { distortion } = effectsOf(context);

            field(surface);
            hairline(ctx, 0, height / 2, width, height / 2);

            // What goes in against what comes out, with the straight line
            // it would be if nothing happened.
            ctx.strokeStyle = 'rgba(255,255,255,0.08)';
            ctx.lineWidth = 1;
            line(ctx, 0, height, width, 0);

            const drive = 1 + distortion * 14;
            trace(surface, FX, (u) => Math.tanh((u * 2 - 1) * drive), { amplitude: 0.45 });
        }
    },
    {
        id: 'fxDelayCanvas',
        draw(surface, context) {
            const { ctx, width, height } = surface;
            const { delayTime, delayFeedback, delayMix } = effectsOf(context);

            field(surface);

            const SECONDS = 4;
            const spacing = Math.max(0.05, delayTime);
            const base = height - 6;
            const tallest = height - 12;

            // The note you played, at full height and in white, so the
            // echoes have something to be quieter than.
            ctx.fillStyle = 'rgba(255,255,255,0.35)';
            ctx.fillRect(0, base - tallest, 2, tallest);

            ctx.globalAlpha = mixAlpha(delayMix);
            ctx.fillStyle = FX;
            glow(ctx, FX, 4, () => {
                let level = 1;
                // Counted rather than accumulated: eighty additions of a
                // fraction drift far enough to see.
                for (let echo = 1; echo * spacing < SECONDS; echo++) {
                    const x = ((echo * spacing) / SECONDS) * width;
                    ctx.fillRect(x - 1, base - level * tallest, 2, level * tallest);

                    level *= delayFeedback;
                    if (level < 0.02) break;
                }
            });
            ctx.globalAlpha = 1;
        }
    },
    {
        id: 'fxReverbCanvas',
        draw(surface, context) {
            const { ctx, width, height } = surface;
            const { reverbMix, reverbDecay } = effectsOf(context);

            field(surface);

            const base = height - 4;
            const tallest = height - 8;
            const fall = Math.max((0.05 + reverbDecay) / 4, 0.05);
            const envelopeAt = (u) => base - Math.exp(-u / fall) * tallest;

            const points = [];
            for (let i = 0; i <= 150; i++) {
                const u = i / 150;
                points.push([u * width, envelopeAt(u)]);
            }

            ctx.globalAlpha = mixAlpha(reverbMix);

            const under = ctx.createLinearGradient(0, 0, width, 0);
            under.addColorStop(0, withAlpha(FX, 0.4));
            under.addColorStop(1, withAlpha(FX, 0.02));
            ctx.fillStyle = under;
            polygon(ctx, [[0, base], ...points, [width, base]]);
            ctx.fill();

            // Stems down to the floor, to suggest a tail made of echoes
            // rather than a smooth swell.
            ctx.strokeStyle = withAlpha(FX, 0.25);
            ctx.lineWidth = 1;
            for (let stem = 1; stem < 12; stem++) {
                const u = stem / 12;
                line(ctx, u * width, base, u * width, envelopeAt(u));
            }

            ctx.strokeStyle = FX;
            ctx.lineWidth = 1.5;
            glow(ctx, FX, 4, () => {
                polyline(ctx, points);
                ctx.stroke();
            });

            ctx.globalAlpha = 1;
        }
    },
    {
        id: 'fxChorusCanvas',
        draw(surface, context) {
            const { ctx, height } = surface;
            const { chorusRate, chorusDepth, chorusMix } = effectsOf(context);

            field(surface);
            hairline(ctx, 0, height / 2, surface.width, height / 2);

            // The wave that moves the delay line, not the audio: faster
            // packs in more of it, deeper makes it taller.
            const cycles = 0.6 + chorusRate * 0.4;
            const depth = Math.max(0.05, chorusDepth);

            ctx.globalAlpha = mixAlpha(chorusMix);
            trace(surface, FX, (u) => Math.sin(u * cycles * Math.PI * 2) * depth, {
                amplitude: 0.42
            });
            ctx.globalAlpha = 1;
        }
    },
    {
        id: 'fxCrushCanvas',
        draw(surface, context) {
            const { ctx, height } = surface;
            const { crushBits, crushRate } = effectsOf(context);

            field(surface);
            hairline(ctx, 0, height / 2, surface.width, height / 2);

            const levels = Math.max(2, 2 ** crushBits);
            const hold = Math.max(1, Math.round(1 / Math.max(0.02, crushRate)));
            const samples = Math.max(160, Math.round(surface.width));

            // A sine put through the crusher: quantised up and down,
            // held flat across the width. At sixteen bits and full rate
            // the staircase is finer than a pixel, which is the right
            // picture of a crusher doing nothing.
            trace(
                surface,
                FX,
                (u, i) => {
                    const held = (Math.floor(i / hold) * hold) / (samples - 1);
                    const value = Math.sin(held * 2 * Math.PI * 2);
                    return Math.round(value * (levels / 2)) / (levels / 2);
                },
                { amplitude: 0.42, samples, steps: true }
            );
        }
    },

    // ── The arpeggiator ──────────────────────────────────────────────────
    {
        id: 'arpPatternCanvas',
        draw(surface, { studio, track }) {
            const { ctx, width, height } = surface;
            const arp = studio?.arpeggiator?.getSettings(track) ?? { mode: 'off' };

            field(surface);

            if (!arp.mode || arp.mode === 'off') {
                ctx.font = MONO;
                ctx.textAlign = 'center';
                ctx.fillStyle = LABEL;
                ctx.fillText('ARP OFF', width / 2, height / 2 + 4);
                return;
            }

            const octaves = clamp(arp.octaves ?? 1, 1, 8);
            const gate = clamp(arp.gate ?? 0.5, 0, 1);
            const steps = sequenceOf(arp.mode, octaves);

            const padX = 10;
            const legend = 24;
            const floorBand = 14;
            const base = height - floorBand;
            const field_ = base - legend;
            const stepWidth = (width - padX * 2) / steps.length;

            // A triad in each octave, standing for whatever you hold down:
            // the shape of the pattern is the point, not the notes.
            const lowest = Math.min(...steps);
            const highest = Math.max(...steps);
            const reach = highest - lowest || 1;

            ctx.strokeStyle = HAIRLINE;
            ctx.lineWidth = 1;
            for (let octave = 0; octave <= octaves; octave++) {
                const y = base - (octave / octaves) * field_;
                line(ctx, padX, y, width - padX, y);
            }

            ctx.font = MONO;
            ctx.textAlign = 'left';
            ctx.fillStyle = LABEL;
            for (let step = 0; step < steps.length; step += 4) {
                const x = padX + step * stepWidth;
                line(ctx, x, legend, x, base);
                ctx.fillText(String(step + 1), x + 2, height - 4);
            }

            ctx.fillStyle = ARP;
            glow(ctx, ARP, 4, () => {
                steps.forEach((frequency, step) => {
                    // Gate is how much of its step a note fills, so a
                    // short gate is a row of ticks and a long one is a
                    // near-continuous line.
                    const tall = 6 + ((frequency - lowest) / reach) * field_;
                    const wide = Math.max(stepWidth * gate * 0.85 - 2, 3);
                    ctx.fillRect(padX + step * stepWidth + 2, base - tall, wide, tall);
                });
            });

            ctx.fillStyle = LABEL;
            ctx.textAlign = 'left';
            ctx.fillText(
                `${arp.mode.toUpperCase()} · ${arp.rate ?? '1/8'} · ${octaves} OCT · GATE ${Math.round(gate * 100)}%`,
                padX,
                14
            );
            ctx.textAlign = 'right';
            ctx.fillText(DIRECTION[arp.mode] ?? '', width - padX, 14);
        }
    }
];

/** The glyph in the corner that says which way the pattern runs. */
const DIRECTION = Object.freeze({ up: '↑', down: '↓', updown: '↕', random: '?' });

/**
 * The notes an arpeggio would play, as frequencies.
 *
 * A major triad per octave standing in for whatever is held down: the
 * picture is of the pattern's shape, and the shape does not depend on the
 * chord. Random draws like up, because there is no one order to draw.
 */
function sequenceOf(mode, octaves) {
    const notes = [];
    for (let octave = 0; octave < octaves; octave++) {
        for (const semitones of [0, 4, 7]) notes.push(261.63 * 2 ** (octave + semitones / 12));
    }

    if (mode === 'down') return notes.reverse();
    // Up and back without repeating the turning points.
    if (mode === 'updown') return notes.concat([...notes].reverse().slice(1, -1));
    return notes;
}

export class SynthVisuals {
    /**
     * @param {object} options
     * @param {ParentNode} options.root
     */
    constructor({ root }) {
        this.root = root;
        /** @type {Array<{entry: object, canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D}>} */
        this._surfaces = [];
    }

    bind() {
        for (const entry of SYNTH_CANVASES) {
            const canvas = this.root.querySelector(`#${entry.id}`);
            const ctx = canvas?.getContext('2d');
            if (canvas && ctx) this._surfaces.push({ entry, canvas, ctx });
        }
    }

    /**
     * Redraw every picture from the state the panel is showing.
     *
     * All of them, every time. Working out which canvas a given change
     * touches is how a picture ends up stale: and fifteen small canvases
     * cost less to redraw than the bookkeeping would.
     *
     * @param {import('./synth-parameters.js').SynthContext|null} context
     */
    draw(context) {
        if (!context) return;

        for (const { entry, canvas, ctx } of this._surfaces) {
            const box = canvas.getBoundingClientRect();
            // A canvas in a pane that has never been shown measures
            // nothing. Drawing into it would only fill the default 300×150
            // buffer with a stretched picture.
            if (box.width < 1 || box.height < 1) continue;

            const ratio = window.devicePixelRatio || 1;
            canvas.width = Math.round(box.width * ratio);
            canvas.height = Math.round(box.height * ratio);
            // Assigning either size resets the context, so the transform
            // has to go on afterwards. Everything drawn is then in CSS
            // pixels and a hairline is one pixel on any screen.
            ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

            entry.draw({ ctx, width: box.width, height: box.height }, context);
        }
    }
}

// ── The shapes they are all made of ──────────────────────────────────────

/** The panel, painted over whatever was there. */
function field({ ctx, width, height }) {
    ctx.fillStyle = FIELD;
    ctx.fillRect(0, 0, width, height);
}

function hairline(ctx, x1, y1, x2, y2) {
    ctx.strokeStyle = HAIRLINE;
    ctx.lineWidth = 1;
    line(ctx, x1, y1, x2, y2);
}

function line(ctx, x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
}

function polyline(ctx, points) {
    ctx.beginPath();
    points.forEach(([x, y], index) => {
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
}

function polygon(ctx, points) {
    polyline(ctx, points);
    ctx.closePath();
}

function dot(ctx, x, y) {
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();
}

/**
 * The letters under an envelope.
 *
 * A stage that has collapsed to nothing has no room for its letter, and
 * two letters in the same three pixels are a smudge rather than a label.
 */
function stageLabels(ctx, height, labels) {
    ctx.font = MONO;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = LABEL;

    let previous = -Infinity;
    for (const [letter, x] of labels) {
        if (x - previous < 8) continue;

        ctx.fillText(letter, x, height - 3);
        previous = x;
    }
}

/**
 * Draw a curve across the full width from a function of position.
 *
 * @param {{ctx: CanvasRenderingContext2D, width: number, height: number}} surface
 * @param {string} colour
 * @param {(u: number, i: number) => number} value  -1 to 1
 * @param {object} [options]
 * @param {number} [options.amplitude]  share of the height, either side
 * @param {number} [options.samples]
 * @param {boolean} [options.steps]  hold each value flat, then jump
 */
function trace({ ctx, width, height }, colour, value, options = {}) {
    const { amplitude = 0.4, steps = false } = options;
    // At least one sample per pixel, or a square wave's edges come out as
    // visible diagonal ramps.
    const samples = options.samples ?? Math.max(160, Math.round(width));
    const middle = height / 2;
    const reach = height * amplitude;

    ctx.strokeStyle = colour;
    ctx.lineWidth = 1.5;

    glow(ctx, colour, 5, () => {
        ctx.beginPath();
        let last = null;

        for (let i = 0; i < samples; i++) {
            const u = i / (samples - 1);
            const x = u * width;
            const y = middle - clamp(value(u, i), -1, 1) * reach;

            if (last === null) ctx.moveTo(x, y);
            else if (steps && y !== last) {
                ctx.lineTo(x, last);
                ctx.lineTo(x, y);
            } else ctx.lineTo(x, y);

            last = y;
        }

        ctx.stroke();
    });
}

/** One of the five shapes, at a position within its cycle. */
function waveform(shape, t, duty, u) {
    switch (shape) {
        case 'sine':
            return Math.sin(t * 2 * Math.PI);
        case 'triangle':
            return t < 0.5 ? 4 * t - 1 : 3 - 4 * t;
        case 'sawtooth':
            return 2 * t - 1;
        case 'noise':
            // A fixed hash of the position, not of the sample number: the
            // same noise at any width, rather than a different picture
            // every time the window is resized.
            return hash(u) * 2 - 1;
        case 'square':
        default:
            return t < duty ? 1 : -1;
    }
}

/** A repeatable number in 0..1 from a position. */
function hash(u) {
    const value = Math.sin(u * 1279.317) * 43758.5453;
    return value - Math.floor(value);
}

/**
 * How loud a filter is at one frequency, as a power ratio.
 *
 * `ratio` is the frequency over the cutoff, which is all the second-order
 * magnitude depends on. The shared denominator is |1 - r²|² + (r/Q)²; the
 * original wrote `1 + r²(1 - 2/Q²) + r⁴` for lowpass and highpass, which
 * is that expression with `1/Q² - 2` mistyped as `1 - 2/Q²`. It goes
 * negative for any Q below about 0.82: including the engine's default of
 * 0.1: where the clamp against zero turned it into +90 dB and pinned the
 * curve flat against the top of the canvas over eight octaves.
 */
function response(type, ratio, q) {
    const squared = ratio * ratio;
    const band = (ratio / q) * (ratio / q);
    const shared = (1 - squared) ** 2 + band;

    switch (type) {
        case 'highpass':
            return (squared * squared) / shared;
        case 'bandpass':
            return band / shared;
        case 'notch':
            return (1 - squared) ** 2 / shared;
        case 'lowpass':
        default:
            return 1 / shared;
    }
}

function decibels(power) {
    return 10 * Math.log10(Math.max(power, 1e-9));
}

/** The per-track effects, or what they are before the audio exists. */
function effectsOf({ effects }) {
    return { ...FX_AT_REST, ...(effects ?? {}) };
}

/**
 * Draw something with a halo, and put the context back.
 *
 * `shadowBlur` is context-wide state, so anything drawn afterwards picks
 * up the glow until it is cleared.
 */
function glow(ctx, colour, blur, drawing) {
    ctx.shadowColor = colour;
    ctx.shadowBlur = blur;
    drawing();
    ctx.shadowBlur = 0;
}

/** `#rrggbb` at some transparency, without a colour library. */
function withAlpha(hex, alpha) {
    const value = Number.parseInt(hex.slice(1), 16);
    const red = (value >> 16) & 255;
    const green = (value >> 8) & 255;
    const blue = value & 255;

    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value));
}

function signed(value) {
    return value > 0 ? `+${value}` : String(value);
}
