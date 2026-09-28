/**
 * An in-memory library backend.
 *
 * Used as the fallback when no storage is available: a browser with site data
 * blocked, a preview, a first run before a folder is chosen: so the studio
 * still works for the length of a session instead of failing at every save.
 * Tests use it too.
 *
 * Nothing survives a reload. `isPersistent` says so, and the interface warns
 * on it rather than letting someone believe their work is safe.
 */

import { readHeader } from './listing.js';

export class MemoryBackend {
    constructor() {
        /** @type {Map<string, Map<string, {contents: string, updatedAt: string}>>} */
        this._store = new Map();
    }

    /** False: the interface should say this is a scratch space. */
    get isPersistent() {
        return false;
    }

    async list(kind) {
        const items = this._store.get(kind);
        if (!items) return [];

        return [...items.entries()]
            .map(([id, entry]) => {
                const header = readHeader(entry.contents);
                return {
                    ...header,
                    id,
                    name: header.name ?? id,
                    updatedAt: entry.updatedAt,
                    size: entry.contents.length
                };
            })
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    async read(kind, id) {
        return this._store.get(kind)?.get(id)?.contents ?? null;
    }

    async write(kind, id, contents) {
        if (!this._store.has(kind)) this._store.set(kind, new Map());
        this._store.get(kind).set(id, { contents, updatedAt: new Date().toISOString() });
        return { id };
    }

    async remove(kind, id) {
        return this._store.get(kind)?.delete(id) ?? false;
    }

    /** Drop everything. Tests and "clear scratch space" use this. */
    clear() {
        this._store.clear();
    }
}
