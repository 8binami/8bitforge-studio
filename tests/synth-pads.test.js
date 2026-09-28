/**
 * The synth window's pads.
 *
 * A pad is two parameters and the scale that puts them on a square, and the
 * scale has to work both ways: the pad that sets a cutoff is also the pad
 * that shows where the cutoff already is. A one-way scale looks right until
 * the window is reopened and the cursor has jumped.
 *
 * Three of these pads are the only way to reach their parameters at all, so
 * a pad that writes nowhere is a parameter nobody can set.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Studio } from '../src/studio.js';
import { EventBus } from '../src/core/event-bus.js';
import { SYNTH_PADS } from '../src/ui/synth-pads.js';
import { SYNTH_CONTROLS } from '../src/ui/synth-parameters.js';
import { FakeAudioContext } from './helpers/fake-audio-context.js';

const SHELL = readFileSync(
    fileURLToPath(new URL('../src/ui/app-shell.html', import.meta.url)),
    'utf8'
);
const SHELL_IDS = new Set([...SHELL.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));

const AXES = SYNTH_PADS.flatMap((pad) => [
    [`${pad.label} · x`, pad, pad.x],
    [`${pad.label} · y`, pad, pad.y]
]);

function contextFor(studio, track) {
    return {
        studio,
        track,
        settings: studio.audioEngine.tracks[track],
        envelope: studio.audioEngine.envelopes[track],
        vibrato: studio.audioEngine.vibrato[track]
    };
}

describe('the synth pads', () => {
    it('name elements the shell actually has', () => {
        const missing = SYNTH_PADS.flatMap((pad) =>
            [pad.pad, pad.cursor, pad.grid, pad.x.display, pad.y.display].filter(
                (id) => !SHELL_IDS.has(id)
            )
        );

        expect(missing).toEqual([]);
    });

    it('shadow knobs that exist in the control table', () => {
        const known = new Set(SYNTH_CONTROLS.map((control) => control.id));
        const unknown = AXES.map(([, , axis]) => axis.knob)
            .filter(Boolean)
            .filter((id) => !known.has(id));

        expect(unknown).toEqual([]);
    });

    it('leaves the three filter pads without a knob to shadow', () => {
        // These are the parameters the window has no slider for. If one
        // ever grows a knob, this is the reminder to wire the two together.
        const soloPads = SYNTH_PADS.filter((pad) => !pad.x.knob && !pad.y.knob);

        expect(soloPads.map((pad) => pad.label)).toEqual([
            'Filter',
            'Filter envelope',
            'Filter LFO',
            'LFO to filter',
            'Tremolo'
        ]);
    });

    it.each(AXES)('%s maps a fraction back to itself', (_name, _pad, axis) => {
        for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
            const value = axis.fromFraction(fraction);
            expect(axis.toFraction(value)).toBeCloseTo(fraction, 5);
        }
    });

    it('puts a filter cutoff on a scale that spreads the octaves evenly', () => {
        const cutoff = SYNTH_PADS.find((pad) => pad.label === 'Filter').x;

        // Half way across the pad is the geometric middle of 20 Hz-20 kHz,
        // not the arithmetic one: on a linear scale everything under a
        // kilohertz would be crushed into the left edge.
        expect(cutoff.fromFraction(0)).toBeCloseTo(20, 3);
        expect(cutoff.fromFraction(0.5)).toBeCloseTo(632.46, 1);
        expect(cutoff.fromFraction(1)).toBeCloseTo(20000, 0);
    });

    it('centres the pitch envelope, whose range crosses zero', () => {
        const amount = SYNTH_PADS.find((pad) => pad.label === 'Pitch envelope').x;

        expect(amount.fromFraction(0.5)).toBeCloseTo(0, 5);
    });
});

describe('the synth pads, against a studio', () => {
    let studio;

    beforeAll(async () => {
        studio = new Studio({
            bus: new EventBus(),
            createContext: () => new FakeAudioContext()
        });
        await studio.start();
    });

    it.each(AXES)('%s reads back what it was written', (_name, _pad, axis) => {
        const track = 2;
        studio.synthesizer.setCurrentTrack(track);

        // A quarter of the way along: inside the range, and away from the
        // defaults every parameter already sits at.
        const probe = axis.fromFraction(0.25);
        axis.write(studio, probe);

        expect(axis.read(contextFor(studio, track))).toBeCloseTo(probe, 3);
    });
});
