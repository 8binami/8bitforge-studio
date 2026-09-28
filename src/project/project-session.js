/**
 * Project session.
 *
 * Owns "which project is open, where it lives on disk, and is it dirty".
 * It does not know what a project contains: the studio state is read and
 * written through the `getState` / `setState` pair given at construction, so
 * this module stays independent from the audio side.
 */

import {
    createProjectFile,
    parseProjectFile,
    serializeProjectFile,
    toFileName,
    ProjectFormatError
} from './format.js';
import { getPlatform } from '../platform/index.js';
import { bus as sharedBus } from '../core/event-bus.js';

export const PROJECT_EVENTS = Object.freeze({
    opened: 'project:opened',
    saved: 'project:saved',
    created: 'project:created',
    dirty: 'project:dirty',
    /** The name, category, tags, cover or metadata changed. */
    described: 'project:described'
});

export class ProjectSession {
    /**
     * @param {object} options
     * @param {() => object} options.getState      read the current studio state
     * @param {(state: object) => void} options.setState  apply a loaded state
     * @param {import('../platform/index.js').Platform} [options.platform]
     * @param {import('../core/event-bus.js').EventBus} [options.bus]
     */
    constructor({ getState, setState, platform = null, bus = sharedBus }) {
        if (typeof getState !== 'function' || typeof setState !== 'function') {
            throw new TypeError('ProjectSession needs getState and setState functions');
        }
        this._getState = getState;
        this._setState = setState;
        this._platform = platform;
        this._bus = bus;

        /** @type {import('../platform/index.js').FileRef|null} */
        this.fileRef = null;
        /** Set when the project came from the library rather than a file. */
        this.libraryId = null;
        this.name = 'Untitled';
        this.category = 'custom';
        this.tags = [];
        this.meta = {};
        this.cover = null;
        this.createdAt = null;
        this.isDirty = false;
    }

    get platform() {
        if (!this._platform) this._platform = getPlatform();
        return this._platform;
    }

    /** True when saving can write back to the file the project came from. */
    get canSaveInPlace() {
        return Boolean(this.fileRef?.id) && this.platform.capabilities.overwriteInPlace;
    }

    /** Mark the project as modified. Call this from the studio's change events. */
    markDirty() {
        if (this.isDirty) return;
        this.isDirty = true;
        this._bus.emit(PROJECT_EVENTS.dirty, true);
    }

    /**
     * Mark the project as saved. Loading seeds the undo history, which reads
     * as a change to anything watching it, so a loader clears the flag itself
     * once it has finished setting up.
     */
    markClean() {
        this._clearDirty();
    }

    /**
     * Note that the project has just been written into the library.
     *
     * A library save goes through the library rather than through this
     * session, so it says so here: clearing the flag alone would leave the
     * interface to infer a save from its absence, and an undo that happens
     * to empty the history looks the same.
     *
     * @param {object} [where]
     * @param {string|null} [where.libraryId]  the entry it landed in
     */
    markSaved({ libraryId = null } = {}) {
        if (libraryId !== null) this.libraryId = libraryId;

        this._clearDirty();
        this._bus.emit(PROJECT_EVENTS.saved, {
            name: this.name,
            libraryId: this.libraryId,
            path: null
        });
    }

    /**
     * Change what the project says about itself. The payload is the file
     * envelope minus the studio state: no audio is touched, but the file on
     * disk is now behind, so this marks the project dirty like any edit.
     *
     * @param {object} description
     * @param {string} [description.name]
     * @param {string} [description.category]
     * @param {string[]} [description.tags]
     * @param {object} [description.meta]
     * @param {string|null} [description.cover]
     */
    describe({ name, category, tags, meta, cover } = {}) {
        if (typeof name === 'string' && name.trim()) this.name = name.trim();
        if (typeof category === 'string') this.category = category;
        if (Array.isArray(tags)) this.tags = [...tags];
        if (meta && typeof meta === 'object') this.meta = { ...meta };
        if (cover !== undefined) this.cover = cover;

        this.markDirty();
        this._bus.emit(PROJECT_EVENTS.described, { name: this.name });
    }

    /**
     * Start a new empty project. The caller is responsible for resetting the
     * studio state first: this only resets the session metadata.
     * @param {string} [name]
     */
    newProject(name = 'Untitled') {
        this.fileRef = null;
        // Forget where the last project lived, or the first save of this one
        // would write over it.
        this.libraryId = null;
        this.name = name;
        this.category = 'custom';
        this.tags = [];
        this.meta = {};
        this.cover = null;
        this.createdAt = null;
        this._clearDirty();
        this._bus.emit(PROJECT_EVENTS.created, { name: this.name });
    }

    /**
     * Ask the platform for a file, then load it into the studio.
     * @returns {Promise<{opened: boolean, migrated?: boolean, fromVersion?: string, error?: string}>}
     */
    async open() {
        const picked = await this.platform.openProjectFile();
        if (!picked) return { opened: false };

        let parsed;
        try {
            parsed = parseProjectFile(picked.text);
        } catch (err) {
            if (err instanceof ProjectFormatError) return { opened: false, error: err.message };
            throw err;
        }

        const { file, migrated, fromVersion } = parsed;
        this._setState(file.data);

        this.fileRef = picked.ref;
        this.libraryId = null;
        this.name = file.name;
        this.category = file.category;
        this.tags = file.tags;
        this.meta = file.meta;
        this.cover = file.cover;
        this.createdAt = file.createdAt;
        this._clearDirty();

        this._bus.emit(PROJECT_EVENTS.opened, { name: this.name, migrated, fromVersion });
        return { opened: true, migrated, fromVersion };
    }

    /**
     * Adopt an already-parsed project file: one that came from the library
     * rather than from a file the platform opened, so there is no file to
     * save back to until the next Save As.
     *
     * @param {object} file  a parsed project file
     * @param {object} [options]
     * @param {string|null} [options.libraryId]  where it came from, if anywhere
     */
    adopt(file, { libraryId = null } = {}) {
        this._setState(file.data);

        this.fileRef = null;
        this.libraryId = libraryId;
        this.name = file.name;
        this.category = file.category;
        this.tags = file.tags;
        this.meta = file.meta;
        this.cover = file.cover;
        this.createdAt = file.createdAt;
        this._clearDirty();

        this._bus.emit(PROJECT_EVENTS.opened, { name: this.name, libraryId });
    }

    /**
     * Save to the file the project came from, or fall back to Save As.
     * @returns {Promise<{saved: boolean, path?: string|null}>}
     */
    async save() {
        if (!this.canSaveInPlace) return this.saveAs(this.name);

        const written = await this.platform.writeProjectFile(this.fileRef, this._serialize());
        if (!written) return this.saveAs(this.name);

        this._clearDirty();
        this._bus.emit(PROJECT_EVENTS.saved, { name: this.name, path: this.fileRef.id });
        return { saved: true, path: this.fileRef.id };
    }

    /**
     * Save under a new name, letting the platform ask the user where.
     * @param {string} [name]
     * @returns {Promise<{saved: boolean, path?: string|null}>}
     */
    async saveAs(name = this.name) {
        const fileName = toFileName(name);
        const ref = await this.platform.saveProjectFileAs(fileName, this._serialize(name));
        if (!ref) return { saved: false };

        this.name = name;
        // A download-based save gives no handle back: keep the ref only when
        // the platform can actually write to it again.
        this.fileRef = ref.id ? ref : null;
        this._clearDirty();

        this._bus.emit(PROJECT_EVENTS.saved, { name: this.name, path: ref.id });
        return { saved: true, path: ref.id };
    }

    /** @returns {string} the exact bytes of the project file */
    _serialize(name = this.name) {
        const file = createProjectFile({
            name,
            data: this._getState(),
            category: this.category,
            tags: this.tags,
            meta: this.meta,
            cover: this.cover,
            createdAt: this.createdAt
        });
        this.createdAt = file.createdAt;
        return serializeProjectFile(file);
    }

    _clearDirty() {
        if (!this.isDirty) return;
        this.isDirty = false;
        this._bus.emit(PROJECT_EVENTS.dirty, false);
    }
}
