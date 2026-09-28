/**
 * A library backend on IndexedDB, for the browser.
 *
 * The File System Access API would put the library in a real folder, but it
 * needs a permission prompt and a handle the page has to keep. IndexedDB
 * needs neither, survives reloads, and holds a project of any size: so the
 * web build saves there by default, and the user exports files when they want
 * something they can hold.
 *
 * One store per kind, keyed by item id.
 */

import { readHeader } from './listing.js';

const DATABASE_NAME = '8bitforge-studio';

/**
 * Raised to 2 when rhythms became a kind the user can save into.
 *
 * The upgrade is additive: `onupgradeneeded` creates only the stores that
 * are not there, so an existing database keeps every record it had. What a
 * version change really costs is the case where two tabs disagree about it,
 * which is why `onblocked` and `onversionchange` were wired first.
 */
const DATABASE_VERSION = 2;
const STORES = ['projects', 'kits', 'presets', 'rhythms', 'generator-presets'];

export class IndexedDbBackend {
    /**
     * @param {object} [options]
     * @param {IDBFactory} [options.indexedDB]  injectable for tests
     * @param {string} [options.databaseName]
     */
    constructor({ indexedDB: factory = globalThis.indexedDB, databaseName = DATABASE_NAME } = {}) {
        this._factory = factory;
        this._databaseName = databaseName;
        this._database = null;
    }

    /** True: what is written here comes back after a reload. */
    get isPersistent() {
        return true;
    }

    /** Whether this browser offers IndexedDB at all. */
    static isSupported(factory = globalThis.indexedDB) {
        return Boolean(factory);
    }

    async list(kind) {
        const store = await this._store(kind, 'readonly');
        const records = await request(store.getAll());

        return records
            .map((record) => {
                // A record written before the header widened holds only a
                // name and tags. Parsing its contents here costs one pass
                // over a store that will not grow: the next write of that
                // item stores the whole header beside it.
                const header = 'category' in record ? record : readHeader(record.contents ?? '');

                return {
                    id: record.id,
                    name: header.name ?? record.id,
                    tags: header.tags ?? [],
                    category: header.category ?? null,
                    cover: header.cover ?? null,
                    createdAt: header.createdAt ?? null,
                    meta: header.meta ?? {},
                    updatedAt: record.updatedAt,
                    size: record.contents?.length ?? 0
                };
            })
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    async read(kind, id) {
        const store = await this._store(kind, 'readonly');
        const record = await request(store.get(id));
        return record?.contents ?? null;
    }

    async write(kind, id, contents) {
        const store = await this._store(kind, 'readwrite');
        // The header is stored alongside the contents so that listing and
        // searching never have to parse every item.
        const header = readHeader(contents);

        await request(
            store.put({
                ...header,
                id,
                contents,
                name: header.name ?? id,
                updatedAt: new Date().toISOString()
            })
        );
        return { id };
    }

    async remove(kind, id) {
        const store = await this._store(kind, 'readwrite');
        const existing = await request(store.get(id));
        if (!existing) return false;

        await request(store.delete(id));
        return true;
    }

    /** Close the connection, for instance before deleting the database. */
    close() {
        this._database?.close();
        this._database = null;
    }

    // ── Internals ────────────────────────────────────────────────────────

    async _open() {
        if (this._database) return this._database;
        if (!this._factory) throw new Error('IndexedDB is not available in this browser');

        this._database = await new Promise((resolve, reject) => {
            const opening = this._factory.open(this._databaseName, DATABASE_VERSION);

            opening.onupgradeneeded = () => {
                const database = opening.result;
                for (const store of STORES) {
                    if (!database.objectStoreNames.contains(store)) {
                        database.createObjectStore(store, { keyPath: 'id' });
                    }
                }
            };

            // A second tab still holding the old version blocks the upgrade,
            // and IndexedDB signals that by firing neither success nor
            // error. Without this the promise never settles and every
            // library call after it waits forever: no message, no failure,
            // just a studio that stops saving. It costs nothing while the
            // version never changes, and everything the first time it does.
            opening.onblocked = () =>
                reject(
                    new Error(
                        'Another tab has the library open on an older version. ' +
                            'Close it and reload.'
                    )
                );

            opening.onsuccess = () => {
                const database = opening.result;

                // The mirror of the above, for the tab that is in the way:
                // when another one needs to upgrade, let go rather than
                // block it. Otherwise the person has to find and close this
                // tab to make the other one work.
                database.onversionchange = () => {
                    database.close();
                    this._database = null;
                };

                resolve(database);
            };

            opening.onerror = () => {
                const error = opening.error;
                // Opening at a lower version than the one on disk is a
                // VersionError, and it means the browser has already run a
                // newer build of the studio. "Failed to open" does not help
                // anyone; saying which way round it is does.
                if (error?.name === 'VersionError') {
                    reject(new Error('This library was written by a newer version of the studio.'));
                    return;
                }
                reject(error);
            };
        });

        return this._database;
    }

    async _store(kind, mode) {
        if (!STORES.includes(kind)) throw new Error(`Unknown library kind: ${kind}`);
        const database = await this._open();
        return database.transaction(kind, mode).objectStore(kind);
    }
}

/** Promisify an IDBRequest. */
function request(idbRequest) {
    return new Promise((resolve, reject) => {
        idbRequest.onsuccess = () => resolve(idbRequest.result);
        idbRequest.onerror = () => reject(idbRequest.error);
    });
}
