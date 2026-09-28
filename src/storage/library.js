/**
 * The local library.
 *
 * Everything the studio keeps between sessions: projects, kits, instrument
 * presets, generator presets: lives here, on the user's own disk. No account,
 * no server, no sync: a folder of readable JSON files they can back up, copy
 * to another machine, or open in a text editor.
 *
 * The library does not know how those files are stored. It talks to a backend
 * with four operations (list, read, write, remove), which the desktop fulfils
 * with real files and the browser with IndexedDB.
 *
 * @typedef {'projects'|'kits'|'presets'|'rhythms'|'generator-presets'} LibraryKind
 *
 * @typedef {import('./listing.js').ItemHeader & {id: string, name: string,
 *   updatedAt?: string, size?: number}} LibraryEntry
 *
 * @typedef {object} LibraryBackend
 * @property {(kind: LibraryKind) => Promise<LibraryEntry[]>} list
 * @property {(kind: LibraryKind, id: string) => Promise<string|null>} read
 * @property {(kind: LibraryKind, id: string, contents: string) => Promise<{id: string}>} write
 * @property {(kind: LibraryKind, id: string) => Promise<boolean>} remove
 */

import { bus as sharedBus } from '../core/event-bus.js';
import { PROJECT_EXTENSION } from '../core/config.js';
import {
    createProjectFile,
    parseProjectFile,
    serializeProjectFile,
    toFileName,
    ProjectFormatError
} from '../project/format.js';
import { collectTags, searchLibrary } from './library-search.js';

export const LIBRARY_KINDS = Object.freeze({
    projects: 'projects',
    kits: 'kits',
    presets: 'presets',
    rhythms: 'rhythms',
    generatorPresets: 'generator-presets'
});

export const LIBRARY_EVENTS = Object.freeze({
    changed: 'library:changed'
});

/** The envelope around anything that is not a project. */
const ITEM_FORMAT = '8bit-forge-item';
const ITEM_VERSION = '1.0';

export class Library {
    /**
     * @param {LibraryBackend} backend
     * @param {object} [options]
     * @param {import('../core/event-bus.js').EventBus} [options.bus]
     */
    constructor(backend, { bus = sharedBus } = {}) {
        if (!backend) throw new TypeError('A library needs a backend');
        this.backend = backend;
        this._bus = bus;
    }

    // ── Projects ─────────────────────────────────────────────────────────

    /** @returns {Promise<LibraryEntry[]>} */
    listProjects() {
        return this.backend.list(LIBRARY_KINDS.projects);
    }

    /**
     * @param {string} id
     * @returns {Promise<{file: object, migrated: boolean}|null>} null when absent
     * @throws {ProjectFormatError} when the file is not a readable project
     */
    async readProject(id) {
        const contents = await this.backend.read(LIBRARY_KINDS.projects, id);
        if (contents == null) return null;

        const { file, migrated } = parseProjectFile(contents);
        return { file, migrated };
    }

    /**
     * Save a project. Writing over an existing id keeps its creation date,
     * and renaming one moves it rather than leaving the old file behind.
     *
     * @param {object} options  what createProjectFile takes, plus an optional id
     * @returns {Promise<{id: string, file: object}>}
     */
    async writeProject({ id = null, name, data, ...rest }) {
        const { targetId, previousId } = await this._placeFor(LIBRARY_KINDS.projects, id, name);

        let createdAt = rest.createdAt ?? null;
        if (!createdAt && id) {
            // Keep the date the project was first saved on.
            const existing = await this._tryReadProject(id);
            createdAt = existing?.file.createdAt ?? null;
        }

        const file = createProjectFile({ name, data, ...rest, createdAt });
        await this.backend.write(LIBRARY_KINDS.projects, targetId, serializeProjectFile(file));
        if (previousId) await this.backend.remove(LIBRARY_KINDS.projects, previousId);

        this._announce(LIBRARY_KINDS.projects);
        return { id: targetId, file };
    }

    async removeProject(id) {
        const removed = await this.backend.remove(LIBRARY_KINDS.projects, id);
        if (removed) this._announce(LIBRARY_KINDS.projects);
        return removed;
    }

    // ── Kits, presets, generator presets ─────────────────────────────────

    /**
     * @param {LibraryKind} kind
     * @returns {Promise<LibraryEntry[]>}
     */
    async list(kind) {
        // Async so that a bad kind rejects like every other call here, rather
        // than throwing before the caller has a promise to catch on.
        assertKind(kind);
        return this.backend.list(kind);
    }

    /**
     * @param {LibraryKind} kind
     * @param {string} id
     * @returns {Promise<{name: string, data: object, tags: string[], updatedAt: string}|null>}
     */
    async read(kind, id) {
        assertKind(kind);
        const contents = await this.backend.read(kind, id);
        if (contents == null) return null;

        let raw;
        try {
            raw = JSON.parse(contents);
        } catch {
            throw new LibraryFormatError(`${kind}/${id} is not valid JSON`);
        }
        if (raw.format !== ITEM_FORMAT) {
            throw new LibraryFormatError(`${kind}/${id} is not a library item`);
        }
        return raw;
    }

    /**
     * @param {LibraryKind} kind
     * @param {object} item
     * @param {string} item.name
     * @param {object} item.data
     * @param {string} [item.id]
     * @param {string[]} [item.tags]
     * @param {string} [item.category]    what a browser files it under
     * @param {string|null} [item.cover]  a data URL, small enough to list
     * @returns {Promise<{id: string, item: object}>}
     */
    async write(kind, { id = null, name, data, tags = [], category = null, cover = null }) {
        assertKind(kind);
        if (!name) throw new TypeError('A library item needs a name');

        const { targetId, previousId } = await this._placeFor(kind, id, name);
        const now = new Date().toISOString();

        let createdAt = now;
        if (id) {
            const existing = await this._tryRead(kind, id);
            createdAt = existing?.createdAt ?? now;
        }

        // The same envelope a project has, minus the fields only a project
        // needs: a browser window reads a kit's row the way it reads a
        // project's, and it reads both without opening the payload.
        const item = {
            format: ITEM_FORMAT,
            version: ITEM_VERSION,
            kind,
            name,
            createdAt,
            updatedAt: now,
            category,
            tags: [...tags],
            cover,
            data
        };

        await this.backend.write(kind, targetId, JSON.stringify(item, null, 2));
        if (previousId) await this.backend.remove(kind, previousId);

        this._announce(kind);
        return { id: targetId, item };
    }

    async remove(kind, id) {
        assertKind(kind);
        const removed = await this.backend.remove(kind, id);
        if (removed) this._announce(kind);
        return removed;
    }

    // ── Searching ────────────────────────────────────────────────────────

    /**
     * @param {LibraryKind} kind
     * @param {Parameters<typeof searchLibrary>[1]} [criteria]
     * @returns {Promise<LibraryEntry[]>}
     */
    async search(kind, criteria = {}) {
        assertKind(kind);
        return searchLibrary(await this.backend.list(kind), criteria);
    }

    /**
     * Every tag in use for a kind, with how many items carry it.
     * @param {LibraryKind} kind
     */
    async tagsInUse(kind) {
        assertKind(kind);
        return collectTags(await this.backend.list(kind));
    }

    // ── Import and export ────────────────────────────────────────────────

    /**
     * Take a `.8bitforge` file into the library: one the user dropped in, or
     * one that came from someone else. Files written by the old app are
     * migrated on the way in.
     *
     * @param {string} contents
     * @param {object} [options]
     * @param {string} [options.name]  overrides the name inside the file
     * @returns {Promise<{id: string, name: string, migrated: boolean}>}
     * @throws {ProjectFormatError}
     */
    async importProject(contents, { name = null } = {}) {
        const { file, migrated } = parseProjectFile(contents);
        const projectName = name || file.name;

        const { id } = await this.writeProject({
            name: projectName,
            data: file.data,
            category: file.category,
            tags: file.tags,
            meta: file.meta,
            cover: file.cover,
            createdAt: file.createdAt
        });

        return { id, name: projectName, migrated };
    }

    /**
     * Take an item into the library, from the same JSON it was exported as.
     *
     * @param {LibraryKind} kind
     * @param {string} contents
     * @returns {Promise<{id: string, name: string}>}
     */
    async importItem(kind, contents) {
        assertKind(kind);

        let raw;
        try {
            raw = JSON.parse(contents);
        } catch {
            throw new LibraryFormatError('That file is not valid JSON');
        }
        if (raw.format !== ITEM_FORMAT || !raw.name) {
            throw new LibraryFormatError('That file is not a library item');
        }

        const { id } = await this.write(kind, {
            name: raw.name,
            data: raw.data,
            tags: raw.tags ?? [],
            category: raw.category ?? null,
            cover: raw.cover ?? null
        });
        return { id, name: raw.name };
    }

    /**
     * The bytes of a stored item, for the platform to save wherever the user
     * asks. The library does not save files itself.
     *
     * @param {LibraryKind} kind
     * @param {string} id
     * @returns {Promise<{name: string, contents: string}|null>}
     */
    async exportItem(kind, id) {
        assertKind(kind);
        const contents = await this.backend.read(kind, id);
        if (contents == null) return null;

        const extension = kind === LIBRARY_KINDS.projects ? PROJECT_EXTENSION : 'json';
        const item =
            kind === LIBRARY_KINDS.projects
                ? parseProjectFile(contents).file
                : JSON.parse(contents);

        return { name: `${toFileName(item.name ?? id)}.${extension}`, contents };
    }

    /** Whether the library can be used at all on this platform. */
    get isAvailable() {
        return Boolean(this.backend);
    }

    // ── Internals ────────────────────────────────────────────────────────

    /**
     * Where an item is about to be written, and what it leaves behind.
     *
     * An item's id is the file its name makes, because a library people can
     * open in a file manager is worth more than one keyed by numbers nobody
     * can read. That has two consequences this has to handle:
     *
     *   - two items called the same thing are still two items, so a new one
     *     whose name is taken gets "Name 2" instead of landing on top;
     *   - renaming one moves its file, so the folder never fills with names
     *     that disagree with what is inside them.
     *
     * @param {LibraryKind} kind
     * @param {string|null} id    where it is now, if it is anywhere
     * @param {string} name
     * @returns {Promise<{targetId: string, previousId: string|null}>}
     */
    async _placeFor(kind, id, name) {
        const wanted = toFileName(name);
        if (id === wanted) return { targetId: id, previousId: null };

        const taken = new Set((await this.backend.list(kind)).map((entry) => entry.id));
        // Its own file does not count as being in the way.
        if (id) taken.delete(id);

        let targetId = wanted;
        for (let suffix = 2; taken.has(targetId); suffix++) targetId = `${wanted} ${suffix}`;

        return { targetId, previousId: id && id !== targetId ? id : null };
    }

    async _tryReadProject(id) {
        try {
            return await this.readProject(id);
        } catch (error) {
            if (error instanceof ProjectFormatError) return null;
            throw error;
        }
    }

    async _tryRead(kind, id) {
        try {
            return await this.read(kind, id);
        } catch (error) {
            if (error instanceof LibraryFormatError) return null;
            throw error;
        }
    }

    _announce(kind) {
        this._bus.emit(LIBRARY_EVENTS.changed, { kind });
    }
}

/** Thrown when a stored item cannot be read as one. */
export class LibraryFormatError extends Error {
    constructor(message) {
        super(message);
        this.name = 'LibraryFormatError';
    }
}

function assertKind(kind) {
    if (!Object.values(LIBRARY_KINDS).includes(kind)) {
        throw new TypeError(`Unknown library kind: ${kind}`);
    }
}
