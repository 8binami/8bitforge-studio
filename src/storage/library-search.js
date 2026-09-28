/**
 * Searching the library.
 *
 * A pure function over a listing: the backend hands over what it knows about
 * each item (name, tags, dates) and this filters and orders it. Nothing here
 * touches storage, so a search costs no reads and can run on every keystroke.
 *
 * Matching is deliberately forgiving: case and accents are ignored, and a
 * query matches anywhere in the name: because someone looking for "démo"
 * should find "Demo Track" without thinking about it.
 */

/** @typedef {{id: string, name: string, tags?: string[], updatedAt?: string}} LibraryEntry */

export const SORT_ORDERS = Object.freeze({
    name: 'name',
    recent: 'recent',
    oldest: 'oldest'
});

/**
 * @param {LibraryEntry[]} entries
 * @param {object} [criteria]
 * @param {string} [criteria.query]     matched against the name
 * @param {string[]} [criteria.tags]    every one must be present
 * @param {'name'|'recent'|'oldest'} [criteria.sort]
 * @returns {LibraryEntry[]}
 */
export function searchLibrary(entries, { query = '', tags = [], sort = SORT_ORDERS.name } = {}) {
    const needle = normalize(query);
    const wanted = tags.map(normalize).filter(Boolean);

    const matched = entries.filter((entry) => {
        if (needle && !normalize(entry.name).includes(needle)) return false;
        if (wanted.length === 0) return true;

        const entryTags = (entry.tags ?? []).map(normalize);
        // Every tag asked for has to be there: narrowing a search should
        // narrow it, not widen it.
        return wanted.every((tag) => entryTags.includes(tag));
    });

    return sortEntries(matched, sort);
}

/**
 * Every tag in use, with how many items carry it: for a filter bar that
 * shows what is actually there rather than a free-text box.
 *
 * @param {LibraryEntry[]} entries
 * @returns {Array<{tag: string, count: number}>}
 */
export function collectTags(entries) {
    const counts = new Map();

    for (const entry of entries) {
        // Count a tag once per item, whatever case it was typed in.
        const seen = new Set();
        for (const tag of entry.tags ?? []) {
            const key = normalize(tag);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            counts.set(tag, (counts.get(tag) ?? 0) + 1);
        }
    }

    return [...counts.entries()]
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** @param {'name'|'recent'|'oldest'} sort */
export function sortEntries(entries, sort = SORT_ORDERS.name) {
    const sorted = [...entries];

    if (sort === SORT_ORDERS.recent) {
        return sorted.sort((a, b) => dateOf(b) - dateOf(a) || a.name.localeCompare(b.name));
    }
    if (sort === SORT_ORDERS.oldest) {
        return sorted.sort((a, b) => dateOf(a) - dateOf(b) || a.name.localeCompare(b.name));
    }
    return sorted.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

/** Lower case, accents removed, trimmed: what two names are compared on. */
export function normalize(value) {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .trim();
}

function dateOf(entry) {
    const time = Date.parse(entry.updatedAt ?? '');
    return Number.isNaN(time) ? 0 : time;
}
