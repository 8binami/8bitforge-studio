/**
 * Favourites.
 *
 * A small store, but one with two traps: it has to survive the JSON round
 * trip through local storage without turning Sets into nothing, and it has
 * to cope with a store that refuses to answer, because a browser in private
 * mode is not a broken browser.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventBus } from '../src/core/event-bus.js';
import { Favorites, FAVORITE_EVENTS } from '../src/storage/favorites.js';

/** A local store that behaves like a browser's, since node's does not. */
function useStorage(initial = {}) {
    const entries = new Map(Object.entries(initial));

    vi.stubGlobal('localStorage', {
        getItem: (key) => entries.get(key) ?? null,
        setItem: (key, value) => entries.set(key, String(value)),
        removeItem: (key) => entries.delete(key)
    });

    return entries;
}

const KEY = '8bitforge-favorites';

describe('favorites', () => {
    beforeEach(() => {
        useStorage();
    });

    it('starts with nothing starred', () => {
        const favorites = new Favorites({ bus: new EventBus() });

        expect(favorites.has('projects', 'anything')).toBe(false);
        expect(favorites.all('projects').size).toBe(0);
    });

    it('stars and unstars, saying which it became', () => {
        const favorites = new Favorites({ bus: new EventBus() });

        expect(favorites.toggle('projects', 'a')).toBe(true);
        expect(favorites.has('projects', 'a')).toBe(true);

        expect(favorites.toggle('projects', 'a')).toBe(false);
        expect(favorites.has('projects', 'a')).toBe(false);
    });

    it('keeps the kinds apart', () => {
        const favorites = new Favorites({ bus: new EventBus() });

        favorites.toggle('projects', 'shared-id');

        expect(favorites.has('projects', 'shared-id')).toBe(true);
        expect(favorites.has('kits', 'shared-id')).toBe(false);
    });

    it('survives a reload', () => {
        const entries = useStorage();
        new Favorites({ bus: new EventBus() }).toggle('projects', 'kept');

        // What went into the store is a plain array, not a stringified Set.
        expect(JSON.parse(entries.get(KEY))).toEqual({ projects: ['kept'] });
        expect(new Favorites({ bus: new EventBus() }).has('projects', 'kept')).toBe(true);
    });

    it('drops a kind once its last favourite is gone', () => {
        const entries = useStorage();
        const favorites = new Favorites({ bus: new EventBus() });

        favorites.toggle('projects', 'only');
        favorites.toggle('projects', 'only');

        expect(JSON.parse(entries.get(KEY))).toEqual({});
    });

    it('forgets an id whether or not it was starred', () => {
        const favorites = new Favorites({ bus: new EventBus() });
        favorites.toggle('projects', 'deleted');

        favorites.forget('projects', 'deleted');
        favorites.forget('projects', 'never-there');

        expect(favorites.has('projects', 'deleted')).toBe(false);
    });

    it('announces what changed', () => {
        const bus = new EventBus();
        const seen = [];
        bus.on(FAVORITE_EVENTS.changed, (event) => seen.push(event));

        const favorites = new Favorites({ bus });
        favorites.toggle('projects', 'a');
        favorites.toggle('projects', 'a');
        favorites.forget('projects', 'absent');

        expect(seen).toEqual([
            { kind: 'projects', id: 'a', isFavorite: true },
            { kind: 'projects', id: 'a', isFavorite: false }
        ]);
    });

    it('hands out a copy, not the store', () => {
        const favorites = new Favorites({ bus: new EventBus() });
        favorites.toggle('projects', 'a');

        favorites.all('projects').add('b');

        expect(favorites.has('projects', 'b')).toBe(false);
    });

    it('ignores a stored value it cannot read', () => {
        useStorage({ [KEY]: 'not json' });

        expect(new Favorites({ bus: new EventBus() }).all('projects').size).toBe(0);
    });

    it('ignores stored entries of the wrong shape', () => {
        useStorage({ [KEY]: JSON.stringify({ projects: 'nope', kits: ['ok', 7] }) });
        const favorites = new Favorites({ bus: new EventBus() });

        expect(favorites.all('projects').size).toBe(0);
        expect([...favorites.all('kits')]).toEqual(['ok']);
    });

    it('keeps working when the store refuses to write', () => {
        vi.stubGlobal('localStorage', {
            getItem: () => null,
            setItem: () => {
                throw new Error('quota exceeded');
            }
        });

        const favorites = new Favorites({ bus: new EventBus() });

        expect(() => favorites.toggle('projects', 'a')).not.toThrow();
        expect(favorites.has('projects', 'a')).toBe(true);
    });
});
