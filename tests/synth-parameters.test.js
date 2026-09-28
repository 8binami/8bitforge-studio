/**
 * The synth window's control table.
 *
 * Seventy controls, each with a way in and a way out, is exactly the shape
 * of code where the two halves drift: a knob that sets something it never
 * reads back looks fine until a project is reopened and the number is gone.
 *
 * So these checks are about the table rather than about the sound. Every
 * control has to exist in the markup: a mistyped id is a control that
 * silently does nothing: and every control has to come back saying what it
 * was told.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Studio } from '../src/studio.js';
import { EventBus } from '../src/core/event-bus.js';
import { SYNTH_CONTROLS } from '../src/ui/synth-parameters.js';
import { FakeAudioContext } from './helpers/fake-audio-context.js';

const SHELL = readFileSync(
    fileURLToPath(new URL('../src/ui/app-shell.html', import.meta.url)),
    'utf8'
);

/** Every `id="…"` the shell declares. */
const SHELL_IDS = new Set([...SHELL.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));

/**
 * The values a `<select>` in the shell offers. Parsed rather than listed
 * here, so a test probe can never pick something the markup does not have.
 */
function optionsOf(id) {
    const select = SHELL.match(new RegExp(`<select[^>]*id="${id}"[^>]*>([\\s\\S]*?)</select>`));
    if (!select) return [];
    return [...select[1].matchAll(/value="([^"]*)"/g)].map((match) => match[1]);
}

async function makeStudio() {
    const studio = new Studio({
        bus: new EventBus(),
        createContext: () => new FakeAudioContext()
    });
    // The per-track effect chain only exists once the audio does, and a
    // third of the table writes to it.
    await studio.start();
    return studio;
}

/** The context the table is given, read fresh so it never goes stale. */
function contextFor(studio, track) {
    return {
        studio,
        track,
        settings: studio.audioEngine.tracks[track],
        envelope: studio.audioEngine.envelopes[track],
        vibrato: studio.audioEngine.vibrato[track],
        effects: studio.trackEffects?.getTrackParams(track) ?? null
    };
}

describe('the synth control table', () => {
    it('names an element the shell actually has', () => {
        const missing = SYNTH_CONTROLS.flatMap((control) =>
            [control.id, control.value].filter((id) => id && !SHELL_IDS.has(id))
        );

        expect(missing).toEqual([]);
    });

    it('lists every control once', () => {
        const ids = SYNTH_CONTROLS.map((control) => control.id);

        expect(ids).toHaveLength(new Set(ids).size);
    });

    it('gives every slider a span to print itself in', () => {
        const silent = SYNTH_CONTROLS.filter(
            (control) => control.kind === 'range' && !control.value
        ).map((control) => control.id);

        expect(silent).toEqual([]);
    });

    it('gives every select the markup has a set of options to pick from', () => {
        const empty = SYNTH_CONTROLS.filter(
            (control) => control.kind === 'select' && optionsOf(control.id).length === 0
        ).map((control) => control.id);

        expect(empty).toEqual([]);
    });
});

describe('the synth control table, against a studio', () => {
    let studio;

    beforeAll(async () => {
        studio = await makeStudio();
    });

    it.each(SYNTH_CONTROLS.map((control) => [control.id, control]))(
        '%s reads back what it was written',
        (id, control) => {
            const track = 1;
            studio.synthesizer.setCurrentTrack(track);

            const before = control.read(contextFor(studio, track));
            const probe = probeFor(control, before);

            control.write(contextFor(studio, track), probe);
            const after = control.read(contextFor(studio, track));

            // Audio parameters are 32-bit floats once they reach a node, so
            // a value can come back a whisker off what went in.
            if (typeof probe === 'number') expect(after).toBeCloseTo(probe, 4);
            else expect(after).toEqual(probe);
        }
    );

    it('writes to the track it is given, not to a remembered one', () => {
        const volume = SYNTH_CONTROLS.find((control) => control.id === 'm-volumeSlider');

        studio.synthesizer.setCurrentTrack(3);
        volume.write(contextFor(studio, 3), 0.42);

        expect(studio.audioEngine.tracks[3].volume).toBeCloseTo(0.42, 4);
        expect(studio.audioEngine.tracks[4].volume).not.toBeCloseTo(0.42, 4);
    });
});

/** A value to write that is legal for the control and different from now. */
function probeFor(control, current) {
    if (control.kind === 'toggle') return !current;

    if (control.kind === 'select') {
        const options = optionsOf(control.id);
        return options.find((option) => option !== String(current)) ?? options[0];
    }

    // The middle of the slider's range, snapped to its step: a probe the
    // slider itself could produce. A whole-numbered control rounds what it
    // is given, so an off-step probe would fail for the wrong reason.
    const { min, max, step } = rangeOf(control.id);
    const snap = (value) => Number((Math.round(value / step) * step).toFixed(6));

    const candidate = snap((min + max) / 2);
    return candidate === Number(current) ? snap((candidate + max) / 2) : candidate;
}

function rangeOf(id) {
    const input = SHELL.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))?.[0] ?? '';
    const read = (name) => Number(input.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? 0);
    // A range with no step of its own moves in whole numbers, as the
    // browser's own default does.
    return { min: read('min'), max: read('max') || 1, step: read('step') || 1 };
}
