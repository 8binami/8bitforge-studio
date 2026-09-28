/**
 * The listing header.
 *
 * What a browser window can show about a stored item without opening it. The
 * point of this is that a window listing two hundred projects parses nothing
 * and a search costs no reads, so the test that matters is that every field a
 * row draws really comes back from a `list()`: through both backends, since
 * one keeps the header beside the record and the other reads it each time.
 */

import { describe, it, expect } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { readHeader, headerFrom } from '../src/storage/listing.js';
import { IndexedDbBackend } from '../src/storage/idb-backend.js';
import { MemoryBackend } from '../src/storage/memory-backend.js';
import { LIBRARY_KINDS } from '../src/storage/library.js';
import { createProjectFile, serializeProjectFile } from '../src/project/format.js';

const PROJECT = serializeProjectFile(
    createProjectFile({
        name: 'Cavern Theme',
        data: { sequencer: {} },
        category: 'platformer',
        tags: ['chiptune', 'loop'],
        meta: { composer: 'Ada', year: '1989' },
        cover: 'data:image/jpeg;base64,AAAA',
        createdAt: '2026-01-02T03:04:05.000Z'
    })
);

describe('the listing header', () => {
    it('reads the envelope and leaves the payload alone', () => {
        const header = readHeader(PROJECT);

        expect(header).toEqual({
            name: 'Cavern Theme',
            tags: ['chiptune', 'loop'],
            category: 'platformer',
            cover: 'data:image/jpeg;base64,AAAA',
            createdAt: '2026-01-02T03:04:05.000Z',
            meta: { composer: 'Ada', year: '1989' }
        });
    });

    it('gives blanks for an item that carries no envelope', () => {
        // A kit or a preset has a name and tags and nothing else; a row for
        // one should draw, not throw.
        expect(readHeader('{"name":"My Kit"}')).toEqual({
            name: 'My Kit',
            tags: [],
            category: null,
            cover: null,
            createdAt: null,
            meta: {}
        });
    });

    it('gives blanks for a file it cannot read at all', () => {
        expect(readHeader('not json').name).toBeNull();
        expect(headerFrom(null).tags).toEqual([]);
        expect(headerFrom([]).meta).toEqual({});
    });

    it('refuses fields of the wrong type', () => {
        const header = readHeader('{"name":42,"tags":"one","category":7,"meta":"x"}');

        expect(header.name).toBeNull();
        expect(header.tags).toEqual([]);
        expect(header.category).toBeNull();
        expect(header.meta).toEqual({});
    });
});

describe.each([
    ['MemoryBackend', () => new MemoryBackend()],
    [
        'IndexedDbBackend',
        () =>
            new IndexedDbBackend({
                indexedDB: new IDBFactory(),
                databaseName: `test-${Math.random().toString(36).slice(2)}`
            })
    ]
])('%s listings', (_name, makeBackend) => {
    it('carries everything a browser row draws', async () => {
        const backend = makeBackend();
        await backend.write(LIBRARY_KINDS.projects, 'cavern', PROJECT);

        const [entry] = await backend.list(LIBRARY_KINDS.projects);

        expect(entry.id).toBe('cavern');
        expect(entry.name).toBe('Cavern Theme');
        expect(entry.category).toBe('platformer');
        expect(entry.tags).toEqual(['chiptune', 'loop']);
        expect(entry.cover).toBe('data:image/jpeg;base64,AAAA');
        expect(entry.createdAt).toBe('2026-01-02T03:04:05.000Z');
        expect(entry.meta.composer).toBe('Ada');
        expect(entry.updatedAt).toEqual(expect.any(String));
    });

    it('never puts the payload in a listing', async () => {
        const backend = makeBackend();
        await backend.write(LIBRARY_KINDS.projects, 'cavern', PROJECT);

        const [entry] = await backend.list(LIBRARY_KINDS.projects);

        expect(entry.data).toBeUndefined();
        expect(entry.contents).toBeUndefined();
    });

    it('falls back to the id for an item with no name', async () => {
        const backend = makeBackend();
        await backend.write(LIBRARY_KINDS.kits, 'nameless', '{}');

        const [entry] = await backend.list(LIBRARY_KINDS.kits);

        expect(entry.name).toBe('nameless');
        expect(entry.category).toBeNull();
    });
});

describe('IndexedDbBackend listings', () => {
    it('reads a record written before the header widened', async () => {
        const factory = new IDBFactory();
        const databaseName = `test-${Math.random().toString(36).slice(2)}`;
        const backend = new IndexedDbBackend({ indexedDB: factory, databaseName });

        // Force a record in the old shape: a name and tags beside the
        // contents, and nothing else.
        await backend.write(LIBRARY_KINDS.projects, 'old', PROJECT);
        const store = await backend._store(LIBRARY_KINDS.projects, 'readwrite');
        await new Promise((resolve, reject) => {
            const request = store.put({
                id: 'old',
                contents: PROJECT,
                name: 'Cavern Theme',
                tags: ['chiptune', 'loop'],
                updatedAt: new Date().toISOString()
            });
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });

        const [entry] = await backend.list(LIBRARY_KINDS.projects);

        expect(entry.category).toBe('platformer');
        expect(entry.cover).toBe('data:image/jpeg;base64,AAAA');
    });
});
