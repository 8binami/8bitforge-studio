import { describe, it, expect } from 'vitest';
import {
    searchLibrary,
    collectTags,
    sortEntries,
    normalize,
    SORT_ORDERS
} from '../src/storage/library-search.js';

const ENTRIES = [
    { id: 'a', name: 'Demo Track', tags: ['chiptune', 'demo'], updatedAt: '2026-01-10T10:00:00Z' },
    { id: 'b', name: 'Épique', tags: ['orchestral'], updatedAt: '2026-03-02T10:00:00Z' },
    { id: 'c', name: 'bass sketch', tags: ['chiptune', 'wip'], updatedAt: '2026-02-01T10:00:00Z' },
    { id: 'd', name: 'Track 10', updatedAt: '2026-02-15T10:00:00Z' },
    { id: 'e', name: 'Track 2', tags: [], updatedAt: '2026-02-20T10:00:00Z' }
];

const names = (entries) => entries.map((entry) => entry.name);

describe('searchLibrary', () => {
    it('returns everything for an empty search', () => {
        expect(searchLibrary(ENTRIES)).toHaveLength(ENTRIES.length);
    });

    it('matches anywhere in the name, whatever the case', () => {
        expect(names(searchLibrary(ENTRIES, { query: 'track' }))).toEqual([
            'Demo Track',
            'Track 2',
            'Track 10'
        ]);
    });

    it('ignores accents, so démo finds Demo', () => {
        expect(names(searchLibrary(ENTRIES, { query: 'épiq' }))).toEqual(['Épique']);
        expect(names(searchLibrary(ENTRIES, { query: 'epiq' }))).toEqual(['Épique']);
    });

    it('ignores surrounding space', () => {
        expect(names(searchLibrary(ENTRIES, { query: '  bass ' }))).toEqual(['bass sketch']);
    });

    it('filters by tag', () => {
        expect(names(searchLibrary(ENTRIES, { tags: ['chiptune'] }))).toEqual([
            'bass sketch',
            'Demo Track'
        ]);
    });

    it('narrows, not widens, with several tags', () => {
        expect(names(searchLibrary(ENTRIES, { tags: ['chiptune', 'wip'] }))).toEqual([
            'bass sketch'
        ]);
    });

    it('combines a query with tags', () => {
        expect(names(searchLibrary(ENTRIES, { query: 'demo', tags: ['chiptune'] }))).toEqual([
            'Demo Track'
        ]);
        expect(searchLibrary(ENTRIES, { query: 'bass', tags: ['orchestral'] })).toEqual([]);
    });

    it('treats an untagged item as having no tags', () => {
        expect(searchLibrary(ENTRIES, { tags: ['anything'] })).toEqual([]);
    });

    it('returns nothing rather than everything when nothing matches', () => {
        expect(searchLibrary(ENTRIES, { query: 'zzz' })).toEqual([]);
    });
});

describe('sortEntries', () => {
    it('sorts by name, reading numbers as numbers', () => {
        expect(names(sortEntries(ENTRIES))).toEqual([
            'bass sketch',
            'Demo Track',
            'Épique',
            'Track 2',
            'Track 10'
        ]);
    });

    it('sorts by most recent', () => {
        expect(names(sortEntries(ENTRIES, SORT_ORDERS.recent))[0]).toBe('Épique');
    });

    it('sorts by oldest', () => {
        expect(names(sortEntries(ENTRIES, SORT_ORDERS.oldest))[0]).toBe('Demo Track');
    });

    it('puts an item with no date last when sorting by recent', () => {
        const withUndated = [...ENTRIES, { id: 'f', name: 'Undated' }];
        expect(names(sortEntries(withUndated, SORT_ORDERS.recent)).at(-1)).toBe('Undated');
    });

    it('does not modify the list it was given', () => {
        const original = [...ENTRIES];
        sortEntries(ENTRIES, SORT_ORDERS.recent);
        expect(ENTRIES).toEqual(original);
    });
});

describe('collectTags', () => {
    it('counts each tag once per item, most used first', () => {
        expect(collectTags(ENTRIES)).toEqual([
            { tag: 'chiptune', count: 2 },
            { tag: 'demo', count: 1 },
            { tag: 'orchestral', count: 1 },
            { tag: 'wip', count: 1 }
        ]);
    });

    it('does not double-count a tag repeated on one item', () => {
        const entries = [{ id: 'a', name: 'A', tags: ['demo', 'Demo', 'demo'] }];
        expect(collectTags(entries)).toEqual([{ tag: 'demo', count: 1 }]);
    });

    it('returns nothing when no item is tagged', () => {
        expect(collectTags([{ id: 'a', name: 'A' }])).toEqual([]);
    });
});

describe('normalize', () => {
    it('lowercases, strips accents and trims', () => {
        expect(normalize('  Épique  ')).toBe('epique');
        expect(normalize('Crème Brûlée')).toBe('creme brulee');
    });

    it('handles nothing at all', () => {
        expect(normalize(null)).toBe('');
        expect(normalize(undefined)).toBe('');
    });
});
