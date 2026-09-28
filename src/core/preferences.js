/**
 * Preferences.
 *
 * The handful of choices that belong to the person rather than to a project:
 * how often work is saved by itself, whether starting a new project asks
 * first, what tempo a new project opens at, how exported files are named.
 *
 * They are kept in local storage, so they follow the browser rather than the
 * file, and a blocked or full store costs the session's preferences and
 * nothing else. The language and the theme are not here: those modules keep
 * their own, because they have to read them before anything else starts.
 */

import { bus as sharedBus } from './event-bus.js';
import { DEFAULT_TEMPLATE } from '../export/filename.js';

export const PREFERENCE_EVENTS = Object.freeze({
    changed: 'preferences:changed'
});

const STORAGE_KEY = '8bitforge-preferences';

export const DEFAULT_PREFERENCES = Object.freeze({
    /** Seconds between automatic saves; 0 is off. */
    autosaveSeconds: 0,
    confirmNewProject: true,
    defaultBpm: 120,
    /** The MIDI input to listen to, or 'all'. */
    midiInput: 'all',
    sidebarAutoOpen: true,
    exportTemplate: DEFAULT_TEMPLATE,
    /** How big the whole page is drawn, 30 to 150; 0 means never chosen. */
    zoom: 0,
    /** How the selected track is marked: label-glow, side-bar, track-outline. */
    highlightStyle: 'track-outline'
});

export class Preferences {
    /**
     * @param {object} [options]
     * @param {import('./event-bus.js').EventBus} [options.bus]
     */
    constructor({ bus = sharedBus } = {}) {
        this._bus = bus;
        this.values = { ...DEFAULT_PREFERENCES, ...read() };
    }

    /** @param {keyof DEFAULT_PREFERENCES} key */
    get(key) {
        return this.values[key];
    }

    /**
     * @param {keyof DEFAULT_PREFERENCES} key
     * @param {*} value
     */
    set(key, value) {
        if (!(key in DEFAULT_PREFERENCES) || this.values[key] === value) return;

        this.values[key] = value;
        write(this.values);
        this._bus.emit(PREFERENCE_EVENTS.changed, { key, value });
    }

    reset() {
        this.values = { ...DEFAULT_PREFERENCES };
        write(this.values);
        this._bus.emit(PREFERENCE_EVENTS.changed, { key: null, value: null });
    }
}

function read() {
    try {
        const stored = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? 'null');
        // Only what this version knows about: a preference that has been
        // removed should not come back through a stored file.
        return Object.fromEntries(
            Object.entries(stored ?? {}).filter(([key]) => key in DEFAULT_PREFERENCES)
        );
    } catch {
        return {};
    }
}

function write(values) {
    try {
        globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(values));
    } catch {
        // Private window or a full store: they last this session.
    }
}
