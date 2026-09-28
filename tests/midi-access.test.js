/**
 * Which MIDI keyboard the studio listens to.
 *
 * One request for access is shared, so the rules about who hears what live
 * in one place: a device stops sending the moment it is deselected, two
 * listeners on one device do not play every note twice, and nothing is asked
 * of the browser until something actually wants it: a permission prompt on
 * load is a prompt nobody asked for.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventBus } from '../src/core/event-bus.js';
import { Preferences } from '../src/core/preferences.js';
import { MidiAccess, ANY_INPUT } from '../src/ui/midi-access.js';

/** A stand-in for the browser's MIDI access, with two keyboards plugged in. */
function fakeAccess(names = ['Keystation', 'Launchkey']) {
    const inputs = new Map(
        names.map((name, index) => [
            `in-${index}`,
            { id: `in-${index}`, name, onmidimessage: null }
        ])
    );

    return {
        inputs,
        onstatechange: null,
        /** Play a note on one of them, as the browser would deliver it. */
        send(id, data) {
            inputs.get(id)?.onmidimessage?.({ data });
        }
    };
}

function setup({ granted = true, names } = {}) {
    const bus = new EventBus();
    const store = new Map();
    vi.stubGlobal('localStorage', {
        getItem: (key) => store.get(key) ?? null,
        setItem: (key, value) => store.set(key, String(value)),
        removeItem: (key) => store.delete(key)
    });

    const preferences = new Preferences({ bus });
    const access = fakeAccess(names);
    const request = vi.fn(() => (granted ? Promise.resolve(access) : Promise.reject(new Error())));
    vi.stubGlobal('navigator', { requestMIDIAccess: request });

    return { bus, preferences, access, request, midi: new MidiAccess({ preferences, bus }) };
}

describe('asking for MIDI', () => {
    beforeEach(() => {
        vi.unstubAllGlobals();
    });

    it('asks nothing until something wants it', () => {
        const { request } = setup();

        expect(request).not.toHaveBeenCalled();
    });

    it('asks once, however many times it is called', async () => {
        const { midi, request } = setup();

        await Promise.all([midi.ensure(), midi.ensure(), midi.ensure()]);

        expect(request).toHaveBeenCalledTimes(1);
    });

    it('carries on when the browser refuses', async () => {
        const { midi } = setup({ granted: false });

        expect(await midi.ensure()).toBeNull();
        expect(midi.inputs()).toEqual([]);
    });

    it('has nothing to offer on a machine with no MIDI', async () => {
        vi.stubGlobal('navigator', {});
        const bus = new EventBus();
        const midi = new MidiAccess({ preferences: new Preferences({ bus }), bus });

        expect(await midi.ensure()).toBeNull();
    });

    it('lists what is plugged in', async () => {
        const { midi } = setup();
        await midi.ensure();

        expect(midi.inputs()).toEqual([
            { id: 'in-0', name: 'Keystation' },
            { id: 'in-1', name: 'Launchkey' }
        ]);
    });
});

describe('choosing a device', () => {
    beforeEach(() => {
        vi.unstubAllGlobals();
    });

    it('takes notes from every device by default', async () => {
        const { midi, access } = setup();
        const heard = [];

        midi.onMessage((message) => heard.push(message.data[1]));
        await midi.ensure();

        access.send('in-0', [144, 60, 100]);
        access.send('in-1', [144, 62, 100]);

        expect(heard).toEqual([60, 62]);
    });

    it('takes them from one device when one is chosen', async () => {
        const { midi, access, preferences } = setup();
        const heard = [];

        midi.onMessage((message) => heard.push(message.data[1]));
        await midi.ensure();
        preferences.set('midiInput', 'in-1');

        access.send('in-0', [144, 60, 100]);
        access.send('in-1', [144, 62, 100]);

        expect(heard).toEqual([62]);
    });

    it('stops the device that was just deselected', async () => {
        const { midi, access, preferences } = setup();
        const heard = [];

        midi.onMessage((message) => heard.push(message.data[1]));
        await midi.ensure();
        preferences.set('midiInput', 'in-0');
        preferences.set('midiInput', 'in-1');

        access.send('in-0', [144, 60, 100]);

        // Left wired, the old choice would keep playing alongside the new one.
        expect(heard).toEqual([]);
    });

    it('plays a note once when two listeners are on', async () => {
        const { midi, access } = setup();
        const first = [];
        const second = [];

        midi.onMessage((message) => first.push(message.data[1]));
        midi.onMessage((message) => second.push(message.data[1]));
        await midi.ensure();

        access.send('in-0', [144, 60, 100]);

        expect(first).toEqual([60]);
        expect(second).toEqual([60]);
    });

    it('goes quiet when the last listener leaves', async () => {
        const { midi, access } = setup();
        const heard = [];

        const stop = midi.onMessage((message) => heard.push(message.data[1]));
        await midi.ensure();
        stop();

        access.send('in-0', [144, 60, 100]);

        expect(heard).toEqual([]);
    });

    it('tells a panel when a keyboard is plugged in or out', async () => {
        const { midi, access } = setup();
        const seen = [];

        midi.onDevices((inputs) => seen.push(inputs.length));
        await midi.ensure();

        access.inputs.delete('in-1');
        access.onstatechange();

        expect(seen).toEqual([1]);
    });

    it('keeps the default meaning every device', () => {
        expect(ANY_INPUT).toBe('all');
    });
});
