import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbBackend } from '../src/storage/idb-backend.js';
import { Library, LIBRARY_KINDS } from '../src/storage/library.js';
import { EventBus } from '../src/core/event-bus.js';

/** A backend on a throwaway database, so tests never share state. */
function makeBackend() {
    return new IndexedDbBackend({
        indexedDB: new IDBFactory(),
        databaseName: `test-${Math.random().toString(36).slice(2)}`
    });
}

describe('IndexedDbBackend', () => {
    let backend;

    beforeEach(() => {
        backend = makeBackend();
    });

    it('says it persists', () => {
        expect(backend.isPersistent).toBe(true);
    });

    it('detects whether the browser has IndexedDB', () => {
        expect(IndexedDbBackend.isSupported(new IDBFactory())).toBe(true);
        expect(IndexedDbBackend.isSupported(undefined)).toBe(false);
    });

    it('reports nothing before anything is written', async () => {
        expect(await backend.list(LIBRARY_KINDS.projects)).toEqual([]);
        expect(await backend.read(LIBRARY_KINDS.projects, 'ghost')).toBeNull();
    });

    it('writes and reads an item back', async () => {
        await backend.write(LIBRARY_KINDS.kits, 'my-kit', '{"name":"My Kit"}');

        expect(await backend.read(LIBRARY_KINDS.kits, 'my-kit')).toBe('{"name":"My Kit"}');
    });

    it('lists items by name, with their dates', async () => {
        await backend.write(LIBRARY_KINDS.kits, 'b', '{"name":"Zebra"}');
        await backend.write(LIBRARY_KINDS.kits, 'a', '{"name":"Apple"}');

        const listed = await backend.list(LIBRARY_KINDS.kits);

        expect(listed.map((item) => item.name)).toEqual(['Apple', 'Zebra']);
        expect(listed[0].updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(listed[0].size).toBeGreaterThan(0);
    });

    it('falls back to the id when an item has no readable name', async () => {
        await backend.write(LIBRARY_KINDS.kits, 'odd', 'not json');
        expect((await backend.list(LIBRARY_KINDS.kits))[0].name).toBe('odd');
    });

    it('overwrites an item rather than duplicating it', async () => {
        await backend.write(LIBRARY_KINDS.presets, 'lead', '{"name":"First"}');
        await backend.write(LIBRARY_KINDS.presets, 'lead', '{"name":"Second"}');

        const listed = await backend.list(LIBRARY_KINDS.presets);
        expect(listed).toHaveLength(1);
        expect(listed[0].name).toBe('Second');
    });

    it('keeps the kinds apart', async () => {
        await backend.write(LIBRARY_KINDS.kits, 'same-id', '{"name":"A kit"}');
        await backend.write(LIBRARY_KINDS.presets, 'same-id', '{"name":"A preset"}');

        expect(await backend.read(LIBRARY_KINDS.kits, 'same-id')).toContain('A kit');
        expect(await backend.read(LIBRARY_KINDS.presets, 'same-id')).toContain('A preset');
    });

    it('removes an item, and says when there was nothing to remove', async () => {
        await backend.write(LIBRARY_KINDS.kits, 'doomed', '{"name":"Doomed"}');

        expect(await backend.remove(LIBRARY_KINDS.kits, 'doomed')).toBe(true);
        expect(await backend.remove(LIBRARY_KINDS.kits, 'doomed')).toBe(false);
        expect(await backend.list(LIBRARY_KINDS.kits)).toEqual([]);
    });

    it('refuses a kind it does not know', async () => {
        await expect(backend.read('songs', 'x')).rejects.toThrow(/Unknown library kind/);
    });

    it('keeps what was written across a reopen', async () => {
        const factory = new IDBFactory();
        const name = 'persistent-test';

        const first = new IndexedDbBackend({ indexedDB: factory, databaseName: name });
        await first.write(LIBRARY_KINDS.projects, 'track', '{"name":"Track"}');
        first.close();

        const second = new IndexedDbBackend({ indexedDB: factory, databaseName: name });
        expect(await second.read(LIBRARY_KINDS.projects, 'track')).toBe('{"name":"Track"}');
    });

    it('reports plainly when the browser has no IndexedDB', async () => {
        const none = new IndexedDbBackend({ indexedDB: null });
        await expect(none.list(LIBRARY_KINDS.kits)).rejects.toThrow(/not available/);
    });
});

describe('Library on IndexedDB', () => {
    it('round-trips a project through the real backend', async () => {
        const library = new Library(makeBackend(), { bus: new EventBus() });

        const { id } = await library.writeProject({
            name: 'Saved Track',
            data: { version: '1.2', sequencer: { bpm: 133 } },
            tags: ['demo']
        });

        const listed = await library.listProjects();
        expect(listed).toMatchObject([{ id, name: 'Saved Track' }]);

        const { file } = await library.readProject(id);
        expect(file.data.sequencer.bpm).toBe(133);
        expect(file.tags).toEqual(['demo']);
    });

    it('round-trips a preset through the real backend', async () => {
        const library = new Library(makeBackend(), { bus: new EventBus() });

        const { id } = await library.write(LIBRARY_KINDS.presets, {
            name: 'My Lead',
            data: { type: 'square', volume: 0.2 }
        });

        const item = await library.read(LIBRARY_KINDS.presets, id);
        expect(item.data.type).toBe('square');
    });
});

describe('IndexedDbBackend concurrency', () => {
    /**
     * A version bump with another tab still holding the old database is the
     * one failure mode that does not look like one: IndexedDB fires neither
     * success nor error, so a promise that only handles those two never
     * settles, and every library call queues behind it forever.
     */
    it('reports a blocked upgrade instead of hanging', async () => {
        const factory = new IDBFactory();
        const databaseName = `blocked-${Math.random().toString(36).slice(2)}`;

        // A connection at version 1 that does not listen for versionchange,
        // standing in for a tab running an older build.
        const stale = await new Promise((resolve, reject) => {
            const opening = factory.open(databaseName, 1);
            opening.onupgradeneeded = () =>
                opening.result.createObjectStore('projects', { keyPath: 'id' });
            opening.onsuccess = () => resolve(opening.result);
            opening.onerror = () => reject(opening.error);
        });

        const upgrading = new Promise((resolve, reject) => {
            const opening = factory.open(databaseName, 2);
            opening.onblocked = () => reject(new Error('blocked'));
            opening.onsuccess = () => resolve('opened');
            opening.onerror = () => reject(opening.error);
        });

        await expect(upgrading).rejects.toThrow('blocked');
        stale.close();
    });

    it('steps aside when another connection needs to upgrade', async () => {
        const factory = new IDBFactory();
        const backend = new IndexedDbBackend({
            indexedDB: factory,
            databaseName: `versionchange-${Math.random().toString(36).slice(2)}`
        });

        await backend.write(LIBRARY_KINDS.projects, 'a', '{"name":"A"}');

        // The backend's own connection now listens for versionchange and
        // closes itself, so a newer build opening the same database is not
        // blocked by a tab nobody is looking at.
        const database = await backend._open();
        expect(typeof database.onversionchange).toBe('function');

        database.onversionchange();
        expect(backend._database).toBeNull();
    });
});

describe('IndexedDbBackend version 2', () => {
    /**
     * Version 2 added the `rhythms` store. This is the only change in the
     * whole library migration that touches data a person already has, so
     * what matters is not that the new store works: it is that opening at
     * the new version leaves everything that was there alone.
     */
    it('keeps what a version 1 database held', async () => {
        const factory = new IDBFactory();
        const databaseName = `upgrade-${Math.random().toString(36).slice(2)}`;

        // A database as an older build of the studio left it: the four
        // original stores, with a project saved in one of them.
        await new Promise((resolve, reject) => {
            const opening = factory.open(databaseName, 1);
            opening.onupgradeneeded = () => {
                for (const store of ['projects', 'kits', 'presets', 'generator-presets']) {
                    opening.result.createObjectStore(store, { keyPath: 'id' });
                }
            };
            opening.onsuccess = () => {
                const database = opening.result;
                const put = database
                    .transaction('projects', 'readwrite')
                    .objectStore('projects')
                    .put({ id: 'old-song', contents: '{"name":"Old Song"}', name: 'Old Song' });
                put.onsuccess = () => {
                    database.close();
                    resolve();
                };
                put.onerror = () => reject(put.error);
            };
            opening.onerror = () => reject(opening.error);
        });

        const backend = new IndexedDbBackend({ indexedDB: factory, databaseName });

        expect(await backend.read(LIBRARY_KINDS.projects, 'old-song')).toBe('{"name":"Old Song"}');
        expect((await backend.list(LIBRARY_KINDS.projects)).map((e) => e.id)).toEqual(['old-song']);
    });

    it('opens the new store the upgrade added', async () => {
        const backend = makeBackend();

        await backend.write(LIBRARY_KINDS.rhythms, 'my-groove', '{"name":"My Groove"}');

        expect(await backend.read(LIBRARY_KINDS.rhythms, 'my-groove')).toBe('{"name":"My Groove"}');
        expect((await backend.list(LIBRARY_KINDS.rhythms)).map((e) => e.name)).toEqual([
            'My Groove'
        ]);
    });
});
