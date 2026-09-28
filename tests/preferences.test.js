/**
 * Preferences and automatic saving.
 *
 * The preferences are the person's, not the project's, so what matters is
 * that they survive a reload and that a store which refuses to co-operate
 * costs nothing but the session. Autosave's rule is narrower and more
 * important: it writes only what has changed, and it never asks a question.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventBus } from '../src/core/event-bus.js';
import { Preferences, PREFERENCE_EVENTS, DEFAULT_PREFERENCES } from '../src/core/preferences.js';
import { Autosave } from '../src/project/autosave.js';

/** A local store that behaves like a browser's, since node's does not. */
function useStorage() {
    const entries = new Map();

    vi.stubGlobal('localStorage', {
        getItem: (key) => entries.get(key) ?? null,
        setItem: (key, value) => entries.set(key, String(value)),
        removeItem: (key) => entries.delete(key)
    });

    return entries;
}

describe('preferences', () => {
    beforeEach(() => {
        useStorage();
    });

    it('starts at the defaults', () => {
        const preferences = new Preferences({ bus: new EventBus() });

        expect(preferences.get('autosaveSeconds')).toBe(0);
        expect(preferences.get('confirmNewProject')).toBe(true);
        expect(preferences.get('defaultBpm')).toBe(120);
    });

    it('remembers a change for the next visit', () => {
        new Preferences({ bus: new EventBus() }).set('defaultBpm', 140);

        expect(new Preferences({ bus: new EventBus() }).get('defaultBpm')).toBe(140);
    });

    it('says what changed', () => {
        const bus = new EventBus();
        const seen = [];
        bus.on(PREFERENCE_EVENTS.changed, (change) => seen.push(change));

        const preferences = new Preferences({ bus });
        preferences.set('defaultBpm', 90);
        // Setting the same value again is not a change.
        preferences.set('defaultBpm', 90);

        expect(seen).toEqual([{ key: 'defaultBpm', value: 90 }]);
    });

    it('refuses a preference it does not have', () => {
        const preferences = new Preferences({ bus: new EventBus() });
        preferences.set('somethingElse', true);

        expect(preferences.values.somethingElse).toBeUndefined();
    });

    it('ignores a stored preference this version has dropped', () => {
        globalThis.localStorage.setItem(
            '8bitforge-preferences',
            JSON.stringify({ defaultBpm: 100, retiredSetting: 'x' })
        );

        const preferences = new Preferences({ bus: new EventBus() });

        expect(preferences.get('defaultBpm')).toBe(100);
        expect(preferences.values.retiredSetting).toBeUndefined();
    });

    it('survives a store that will not hold anything', () => {
        globalThis.localStorage.setItem('8bitforge-preferences', 'not json at all');

        const preferences = new Preferences({ bus: new EventBus() });

        expect(preferences.values).toEqual({ ...DEFAULT_PREFERENCES });
    });
});

describe('autosave', () => {
    beforeEach(() => {
        useStorage();
    });

    function makeAutosave({ dirty = true, canSaveInPlace = false } = {}) {
        const bus = new EventBus();
        const preferences = new Preferences({ bus });

        const session = {
            isDirty: dirty,
            canSaveInPlace,
            libraryId: null,
            name: 'Song',
            category: 'custom',
            tags: [],
            meta: {},
            cover: null,
            createdAt: null,
            save: vi.fn().mockResolvedValue({ saved: true }),
            markClean: vi.fn(function () {
                this.isDirty = false;
            }),
            markSaved: vi.fn(function ({ libraryId = null } = {}) {
                if (libraryId !== null) this.libraryId = libraryId;
                this.isDirty = false;
            })
        };

        const library = {
            writeProject: vi
                .fn()
                .mockResolvedValue({ id: 'lib-1', file: { createdAt: '2026-01-01T00:00:00.000Z' } })
        };
        const studio = { getProjectState: () => ({ version: '1.2' }) };

        return {
            bus,
            session,
            library,
            preferences,
            autosave: new Autosave({ session, library, studio, preferences, bus })
        };
    }

    it('writes nothing when nothing has changed', async () => {
        const { autosave, library, session } = makeAutosave({ dirty: false });

        expect(await autosave.saveNow()).toBe(false);
        expect(library.writeProject).not.toHaveBeenCalled();
        expect(session.save).not.toHaveBeenCalled();
    });

    it('saves over the file when it can do so without asking', async () => {
        const { autosave, session, library } = makeAutosave({ canSaveInPlace: true });

        expect(await autosave.saveNow()).toBe(true);
        expect(session.save).toHaveBeenCalled();
        expect(library.writeProject).not.toHaveBeenCalled();
    });

    it('saves into the library when there is no file to write to', async () => {
        const { autosave, session, library } = makeAutosave();

        expect(await autosave.saveNow()).toBe(true);
        expect(session.save).not.toHaveBeenCalled();
        expect(library.writeProject).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'Song' })
        );
        // The next automatic save writes over the same entry.
        expect(session.libraryId).toBe('lib-1');
        // And there is nothing left to save until something changes again.
        expect(session.isDirty).toBe(false);
    });

    it('sends the whole description, not only the name', async () => {
        const { autosave, session, library } = makeAutosave();
        session.category = 'platformer';
        session.tags = ['chiptune'];

        await autosave.saveNow();

        // A save that dropped the category would quietly reset it every few
        // minutes while someone worked.
        expect(library.writeProject).toHaveBeenCalledWith(
            expect.objectContaining({ category: 'platformer', tags: ['chiptune'] })
        );
    });

    it('carries on after a failed save', async () => {
        const { autosave, library, bus } = makeAutosave();
        library.writeProject.mockRejectedValueOnce(new Error('storage full'));

        const failures = [];
        bus.on('autosave:failed', (failure) => failures.push(failure));

        expect(await autosave.saveNow()).toBe(false);
        expect(failures).toEqual([{ message: 'storage full' }]);
    });

    it('runs only once an interval is set', () => {
        vi.useFakeTimers();
        const { autosave, preferences, library } = makeAutosave();

        autosave.restart();
        vi.advanceTimersByTime(60_000);
        expect(library.writeProject).not.toHaveBeenCalled();

        preferences.set('autosaveSeconds', 60);
        vi.advanceTimersByTime(60_000);
        expect(library.writeProject).toHaveBeenCalledTimes(1);

        preferences.set('autosaveSeconds', 0);
        vi.advanceTimersByTime(180_000);
        expect(library.writeProject).toHaveBeenCalledTimes(1);

        autosave.stop();
        vi.useRealTimers();
    });
});
