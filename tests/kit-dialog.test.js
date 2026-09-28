/**
 * How a kit window turns eight tracks into eight slots.
 *
 * This is the one rule in the kit windows that fails silently. A slot can
 * be stored two ways: by the name of a shipped instrument, or as the
 * sound itself: and picking the wrong one is never an error. Store a
 * sound where a name would do and the kit is twelve kilobytes instead of
 * one, and stops following an instrument that is later improved. Store a
 * name where the sound was needed and the kit plays something else.
 *
 * And a kit opened only to fix its name must come back with the same eight
 * slots it went in with, whatever is on the tracks behind the window.
 *
 * The window itself needs a browser; this does not. It drives the picking
 * directly, with the pickers standing in as the plain `{value}` objects
 * that is all the code reads them as.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Studio } from '../src/studio.js';
import { KitDialog } from '../src/ui/kit-dialog.js';
import { EventBus } from '../src/core/event-bus.js';
import { FakeAudioContext } from './helpers/fake-audio-context.js';

/** A window with no window: nothing here touches the document. */
function makeDialog() {
    const context = new FakeAudioContext();
    const studio = new Studio({ bus: new EventBus(), createContext: () => context });

    const dialog = new KitDialog({
        root: null,
        studio,
        library: null,
        favorites: null,
        elements: {}
    });

    // `bind()` reads them off the page; the code only ever asks for `.value`.
    dialog._pickers = Array.from({ length: 8 }, () => ({ value: 'current' }));
    dialog._touched = Array(8).fill(false);

    return { studio, dialog };
}

describe('a kit slot', () => {
    let studio;
    let dialog;

    beforeEach(() => {
        ({ studio, dialog } = makeDialog());
    });

    it('stores a picked instrument by name', () => {
        dialog._pickers[0].value = 'lead-classic';

        expect(dialog._tracks().tracks[0]).toEqual({
            presetKey: 'lead-classic',
            presetType: 'builtin',
            displayName: studio.instruments.presets['lead-classic'].name
        });
    });

    it('stores a track left on "current" by name, when that is what it is', () => {
        // The common way to build a kit: load eight instruments, then file
        // them. All eight pickers stay where they are, and all eight slots
        // should still be names.
        studio.instruments.loadPreset('bass-sub', 2);

        expect(dialog._tracks().tracks[2]).toMatchObject({
            presetKey: 'bass-sub',
            presetType: 'builtin'
        });
    });

    it('stores the sound itself once the track has been altered', () => {
        studio.instruments.loadPreset('bass-sub', 2);
        studio.audioEngine.tracks[2].detune = 40;

        const slot = dialog._tracks().tracks[2];

        expect(slot.presetKey).toBeNull();
        expect(slot.presetType).toBe('custom');
        // The name would bring back the preset, not what is on the track.
        expect(slot.presetData.detune).toBe(40);
    });

    it('stores the sound itself for a track nothing was ever loaded onto', () => {
        studio.synthesizer.setCurrentTrack(5);
        studio.synthesizer.setWaveform('triangle');

        const slot = dialog._tracks().tracks[5];

        expect(slot.presetKey).toBeNull();
        expect(slot.presetData.type).toBe('triangle');
    });

    it('fills all eight, whatever the mixture', () => {
        studio.instruments.loadPreset('lead-classic', 0);
        dialog._pickers[7].value = 'fx-coin';

        const { tracks } = dialog._tracks();

        expect(tracks).toHaveLength(8);
        expect(tracks.every((slot) => slot.presetKey || slot.presetData)).toBe(true);
    });
});

describe('a kit being edited', () => {
    let studio;
    let dialog;

    beforeEach(() => {
        ({ studio, dialog } = makeDialog());

        // Opened on a stored kit, with quite different sounds on the tracks
        // behind it: someone renaming a kit in the middle of other work.
        dialog._original = Array.from({ length: 8 }, (_, track) => ({
            presetKey: `slot-${track}`,
            presetType: 'builtin',
            displayName: `Slot ${track}`
        }));
        studio.instruments.loadPreset('pad-warm', 0);
        studio.instruments.loadPreset('pad-warm', 4);
    });

    it('keeps every slot nobody moved', () => {
        expect(dialog._tracks().tracks).toEqual(dialog._original);
    });

    it('replaces only the slot that was moved', () => {
        dialog._pickers[3].value = 'arp-bell';
        dialog._touched[3] = true;

        const { tracks } = dialog._tracks();

        expect(tracks[3]).toMatchObject({ presetKey: 'arp-bell' });
        expect(tracks.filter((slot, track) => slot !== dialog._original[track])).toHaveLength(1);
    });

    it('reads the track back for a slot moved to "current"', () => {
        dialog._touched[0] = true;

        expect(dialog._tracks().tracks[0]).toMatchObject({ presetKey: 'pad-warm' });
    });
});
