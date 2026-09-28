/**
 * Favourites.
 *
 * A starred project, kit or preset, remembered per kind. This belongs to the
 * person and not to the library: the same folder opened on another machine is
 * the same library, but the handful of things they reach for often is theirs.
 * So it lives in local storage, beside the preferences, rather than in the
 * saved files.
 *
 * Ids are kept as plain arrays on the way in and out of storage: a Set does
 * not survive JSON: and as a Set in memory, where every lookup is a "is this
 * row starred" during a render.
 */

import { bus as sharedBus } from '../core/event-bus.js';

export const FAVORITE_EVENTS = Object.freeze({
    changed: 'favorites:changed'
});

const STORAGE_KEY = '8bitforge-favorites';

export class Favorites {
    /**
     * @param {object} [options]
     * @param {import('../core/event-bus.js').EventBus} [options.bus]
     */
    constructor({ bus = sharedBus } = {}) {
        this._bus = bus;
        /** @type {Map<string, Set<string>>} kind → ids */
        this._byKind = read();
    }

    /**
     * @param {string} kind
     * @param {string} id
     * @returns {boolean}
     */
    has(kind, id) {
        return this._byKind.get(kind)?.has(id) ?? false;
    }

    /**
     * @param {string} kind
     * @returns {Set<string>}  a copy: callers must not edit the store by hand
     */
    all(kind) {
        return new Set(this._byKind.get(kind) ?? []);
    }

    /**
     * Star or unstar, and say which it became.
     * @param {string} kind
     * @param {string} id
     * @returns {boolean} whether it is now a favourite
     */
    toggle(kind, id) {
        if (!id) return false;

        const ids = this._byKind.get(kind) ?? new Set();
        const isFavorite = !ids.has(id);

        if (isFavorite) ids.add(id);
        else ids.delete(id);

        // Drop an empty kind rather than storing an empty list for it.
        if (ids.size > 0) this._byKind.set(kind, ids);
        else this._byKind.delete(kind);

        write(this._byKind);
        this._bus.emit(FAVORITE_EVENTS.changed, { kind, id, isFavorite });
        return isFavorite;
    }

    /**
     * Forget one, whether or not it was starred. Called when an item is
     * deleted, so its id does not linger and land on a future item that
     * happens to be saved under the same name.
     *
     * @param {string} kind
     * @param {string} id
     */
    forget(kind, id) {
        const ids = this._byKind.get(kind);
        if (!ids?.delete(id)) return;

        if (ids.size === 0) this._byKind.delete(kind);
        write(this._byKind);
        this._bus.emit(FAVORITE_EVENTS.changed, { kind, id, isFavorite: false });
    }
}

/** @returns {Map<string, Set<string>>} */
function read() {
    try {
        const stored = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? 'null');
        if (!stored || typeof stored !== 'object') return new Map();

        return new Map(
            Object.entries(stored)
                .filter(([, ids]) => Array.isArray(ids))
                .map(([kind, ids]) => [kind, new Set(ids.filter((id) => typeof id === 'string'))])
        );
    } catch {
        return new Map();
    }
}

/** @param {Map<string, Set<string>>} byKind */
function write(byKind) {
    try {
        const plain = Object.fromEntries([...byKind].map(([kind, ids]) => [kind, [...ids]]));
        globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(plain));
    } catch {
        // Private window or a full store: they last this session.
    }
}
