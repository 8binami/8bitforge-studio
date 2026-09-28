/**
 * The pictures in the synth window.
 *
 * Drawing needs a canvas, which these tests do not have. What they check is
 * the part that can be wrong without looking wrong: that every canvas in
 * the markup has an entry, and that each entry draws something rather than
 * throwing, for the states a track can actually be in: including the two
 * the original never survived, a track with no effects chain yet and a
 * preset holding values outside the sliders' ranges.
 *
 * The filter response is checked as arithmetic, because it is arithmetic.
 * The original's lowpass denominator was mistyped in a way that produced a
 * confident, smooth, entirely wrong curve: pinned flat against the top of
 * the canvas over eight octaves at the engine's own default resonance. A
 * picture like that is not obviously broken; it just says the filter does
 * nothing, which is the one thing a filter display must never get wrong.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SYNTH_CANVASES } from '../src/ui/synth-visuals.js';
import { SYNTH_METER_CANVASES } from '../src/ui/synth-meters.js';
import { AudioEngine } from '../src/audio/audio-engine.js';
import { Arpeggiator } from '../src/compose/arpeggiator.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * A canvas context that records nothing and refuses nothing.
 *
 * Every drawing call lands here; the test is that the call was legal and
 * the numbers were finite, not what the picture looked like.
 */
function recorder() {
    const numbers = [];
    const note = (...values) => {
        for (const value of values) if (typeof value === 'number') numbers.push(value);
    };

    const gradient = { addColorStop: () => {} };
    const ctx = new Proxy(
        { numbers },
        {
            get(target, key) {
                if (key === 'numbers') return numbers;
                if (key === 'createLinearGradient') return () => gradient;
                if (key === 'measureText') return () => ({ width: 8 });
                // Everything else is a drawing call or a style assignment.
                return (...values) => note(...values);
            },
            set() {
                return true;
            }
        }
    );

    return ctx;
}

function surfaceOf(width = 300, height = 64) {
    return { ctx: recorder(), width, height };
}

/**
 * A context of the shape `synth-panel.js` hands the drawings.
 *
 * The arpeggiator is real rather than stubbed: it is the only thing here
 * a drawing reads through `studio`, and an arpeggiator set to `off`:
 * which is the default: would leave the pattern canvas drawing two words
 * and never its picture.
 */
function contextOf(overrides = {}) {
    const engine = new AudioEngine();
    const arpeggiator = new Arpeggiator(engine, { getTempo: () => 120 });
    arpeggiator.updateSettings(0, { mode: 'up', ...(overrides.arp ?? {}) });

    return {
        studio: { arpeggiator },
        track: 0,
        settings: { ...engine.tracks[0], ...(overrides.settings ?? {}) },
        envelope: { ...engine.envelopes[0], ...(overrides.envelope ?? {}) },
        vibrato: { ...engine.vibrato[0], ...(overrides.vibrato ?? {}) },
        effects: overrides.effects ?? null
    };
}

describe('the canvases in the window', () => {
    const markup = readFileSync(path.join(ROOT, 'src', 'ui', 'app-shell.html'), 'utf8');

    it('leaves no canvas in the synth pane undrawn', () => {
        // The pane is everything between the synth tab's own pane and the
        // next one, so a canvas added to the markup shows up here: and
        // has to be claimed by one of the two modules, or it stays the
        // black rectangle it starts as.
        const pane = markup.slice(
            markup.indexOf('id="studioSynthPane"'),
            markup.indexOf('id="studioLibPane"')
        );
        const inMarkup = [...new Set([...pane.matchAll(/id="(\w+Canvas)"/g)].map((m) => m[1]))];
        const drawn = [...SYNTH_CANVASES.map((entry) => entry.id), ...SYNTH_METER_CANVASES];

        expect(drawn.sort()).toEqual(inMarkup.sort());
    });

    it('draws each canvas from settings or from the sound, not both', () => {
        const settings = SYNTH_CANVASES.map((entry) => entry.id);

        expect(settings.filter((id) => SYNTH_METER_CANVASES.includes(id))).toEqual([]);
    });

    it('gives each canvas exactly one entry', () => {
        const ids = SYNTH_CANVASES.map((entry) => entry.id);

        expect(ids).toHaveLength(new Set(ids).size);
    });
});

describe('drawing a track', () => {
    let context;

    beforeEach(() => {
        context = contextOf();
    });

    it.each(SYNTH_CANVASES.map((entry) => [entry.id, entry]))(
        '%s draws a fresh track without throwing',
        (_id, entry) => {
            const surface = surfaceOf();

            expect(() => entry.draw(surface, context)).not.toThrow();
            expect(surface.ctx.numbers.length).toBeGreaterThan(0);
        }
    );

    it.each(SYNTH_CANVASES.map((entry) => [entry.id, entry]))(
        '%s puts no NaN or Infinity on the canvas',
        (_id, entry) => {
            // A single NaN coordinate silently drops the whole path, so a
            // picture can vanish with no error anywhere.
            const surface = surfaceOf();
            entry.draw(surface, context);

            expect(surface.ctx.numbers.filter((value) => !Number.isFinite(value))).toEqual([]);
        }
    );

    it.each(SYNTH_CANVASES.map((entry) => [entry.id, entry]))(
        '%s survives values from beyond the sliders',
        (_id, entry) => {
            // What a preset, an imported project or automation can hold.
            // The filter envelope in particular divides by its pad's range
            // and drew itself off the side of the canvas when a stored
            // value exceeded it.
            const extreme = contextOf({
                settings: {
                    type: 'nonsense',
                    dutyCycle: 2,
                    phase: 3600,
                    detune: 5000,
                    octaveOffset: 9,
                    semitoneOffset: 99,
                    pitchEnv: 999,
                    unisonVoices: 64,
                    unisonDetune: 400,
                    unisonSpread: 400,
                    filterEnabled: true,
                    filterType: 'nonsense',
                    filterCutoff: 0,
                    filterQ: 0,
                    filterEnvAmount: 500,
                    filterEnvAttack: 30,
                    filterEnvRelease: 30,
                    lfo1Wave: 'nonsense'
                },
                envelope: { attack: 60, decay: 60, sustain: 5, release: 60 },
                arp: { mode: 'nonsense', rate: 'nonsense', octaves: 99, gate: 9 },
                effects: {
                    distortion: 9,
                    delayTime: 0,
                    delayFeedback: 1,
                    delayMix: 9,
                    reverbMix: 9,
                    reverbDecay: 0,
                    chorusRate: 0,
                    chorusDepth: 9,
                    chorusMix: 9,
                    crushBits: 0,
                    crushRate: 0
                }
            });
            const surface = surfaceOf();

            expect(() => entry.draw(surface, extreme)).not.toThrow();
            expect(surface.ctx.numbers.filter((value) => !Number.isFinite(value))).toEqual([]);
        }
    );

    it.each(SYNTH_CANVASES.map((entry) => [entry.id, entry]))(
        '%s draws before the audio exists',
        (_id, entry) => {
            // `trackEffects` is built on the first Play, so `effects` is
            // null every time the window is opened first: which is the
            // usual way round.
            const surface = surfaceOf();

            expect(() => entry.draw(surface, contextOf({ effects: null }))).not.toThrow();
            expect(surface.ctx.numbers.filter((value) => !Number.isFinite(value))).toEqual([]);
        }
    );

    it.each(['up', 'down', 'updown', 'random', 'off'])('draws an arpeggio set to %s', (mode) => {
        const entry = SYNTH_CANVASES.find((one) => one.id === 'arpPatternCanvas');
        const surface = surfaceOf(400, 160);

        entry.draw(surface, contextOf({ arp: { mode, octaves: 3, gate: 0.4 } }));

        expect(surface.ctx.numbers.filter((value) => !Number.isFinite(value))).toEqual([]);
        expect(surface.ctx.numbers.length).toBeGreaterThan(0);
    });

    it('draws every note of an arpeggio inside the canvas', () => {
        // Three notes per octave, and the bars must stay between the
        // legend at the top and the step numbers at the foot.
        const entry = SYNTH_CANVASES.find((one) => one.id === 'arpPatternCanvas');
        const surface = surfaceOf(400, 160);

        entry.draw(surface, contextOf({ arp: { mode: 'updown', octaves: 4, gate: 1 } }));

        const outside = surface.ctx.numbers.filter((value) => value < -1 || value > 400);
        expect(outside).toEqual([]);
    });

    it('draws into a canvas one pixel wide without producing nonsense', () => {
        // The smallest size the panel will still hand over.
        for (const entry of SYNTH_CANVASES) {
            const surface = surfaceOf(1, 1);
            entry.draw(surface, context);

            expect(
                surface.ctx.numbers.filter((value) => !Number.isFinite(value)),
                entry.id
            ).toEqual([]);
        }
    });
});
