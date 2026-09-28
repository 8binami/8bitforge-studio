/**
 * The MIDI keyboards plugged into this machine.
 *
 * One place asks the browser for MIDI, because asking is a permission prompt
 * and two modules asking is two prompts. The keyboard wants the notes; the
 * settings panel wants the list of devices to choose from. Both come through
 * here, and the choice in `preferences.midiInput` decides which device the
 * notes are taken from: `all`, or one device's id.
 *
 * Access is asked for on a gesture, never on load: a page nobody has touched
 * yet is the wrong moment to put a permission prompt in front of someone.
 * Until then this hands back an empty list and no notes, which is exactly
 * what a machine with no MIDI does.
 */

import { PREFERENCE_EVENTS } from '../core/preferences.js';

/** The preference value meaning "whatever is plugged in". */
export const ANY_INPUT = 'all';

/**
 * And the one meaning "nothing": what the settings menu has always called
 * None. A controller that sends clock or its own transport is a controller
 * someone may want switched off without unplugging it.
 */
export const NO_INPUT = '';

export class MidiAccess {
    /**
     * @param {object} options
     * @param {import('../core/preferences.js').Preferences} options.preferences
     * @param {import('../core/event-bus.js').EventBus} options.bus
     */
    constructor({ preferences, bus }) {
        this.preferences = preferences;

        /** @type {MIDIAccess|null} */
        this._access = null;
        /** @type {Promise<MIDIAccess|null>|null} */
        this._asking = null;

        /** @type {Set<(message: MIDIMessageEvent) => void>} */
        this._handlers = new Set();
        /** Called when the device list changes, so a panel can redraw it. */
        this._onDevices = new Set();

        bus.on(PREFERENCE_EVENTS.changed, ({ key }) => {
            if (key === null || key === 'midiInput') this._wire();
        });
    }

    /**
     * Ask for access, once. Safe to call on every note: the first call does
     * the asking and the rest get the same answer.
     *
     * @returns {Promise<MIDIAccess|null>} null when refused or unavailable
     */
    ensure() {
        if (this._asking) return this._asking;
        if (!globalThis.navigator?.requestMIDIAccess) return Promise.resolve(null);

        this._asking = navigator.requestMIDIAccess().then(
            (access) => {
                this._access = access;
                // A keyboard plugged in later is one someone means to use.
                access.onstatechange = () => {
                    this._wire();
                    for (const listener of this._onDevices) listener(this.inputs());
                };
                this._wire();
                return access;
            },
            () => {
                // Refused, or no MIDI on this machine: the piano still works.
                return null;
            }
        );

        return this._asking;
    }

    /** @returns {Array<{id: string, name: string}>} what is plugged in now */
    inputs() {
        if (!this._access) return [];

        return [...this._access.inputs.values()].map((input) => ({
            id: input.id,
            name: input.name || input.id
        }));
    }

    /**
     * Take the notes from whichever device the preference names.
     * @param {(message: MIDIMessageEvent) => void} handler
     * @returns {() => void} stop listening
     */
    onMessage(handler) {
        this._handlers.add(handler);
        this._wire();

        return () => {
            this._handlers.delete(handler);
            this._wire();
        };
    }

    /** @param {(inputs: Array<{id: string, name: string}>) => void} listener */
    onDevices(listener) {
        this._onDevices.add(listener);
        return () => this._onDevices.delete(listener);
    }

    /**
     * Point every device at this module, or at nothing.
     *
     * Each input takes one handler, so the wiring is rebuilt rather than
     * added to: a device that has just been deselected has to stop sending,
     * and one selected twice must not play every note twice.
     */
    _wire() {
        if (!this._access) return;

        const chosen = this.preferences.get('midiInput') ?? ANY_INPUT;
        const listening = this._handlers.size > 0;

        for (const input of this._access.inputs.values()) {
            const wanted = listening && (chosen === ANY_INPUT || chosen === input.id);
            input.onmidimessage = wanted ? (message) => this._deliver(message) : null;
        }
    }

    _deliver(message) {
        for (const handler of this._handlers) handler(message);
    }
}
