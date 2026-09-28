/**
 * What a listing knows about a stored item.
 *
 * A project file is an envelope around an opaque `data` payload, and
 * everything a browser needs to draw a row: the name, the category, the
 * tags, the cover, the dates: is in that envelope. Reading it once at write
 * time and keeping it beside the contents means a window listing two hundred
 * projects parses nothing, and a search runs on every keystroke for free.
 *
 * Library items that are not projects (kits, presets) carry a smaller
 * envelope; the fields they do not have come back as null or empty, which is
 * what a row for them shows anyway.
 *
 * The desktop's main process has its own copy of this, because it reads files
 * in a Node context that the renderer's sources are not shipped to. The two
 * have to agree; that is the price of not shipping `src/` inside the app.
 */

/**
 * @typedef {object} ItemHeader
 * @property {string|null} name
 * @property {string[]} tags
 * @property {string|null} category
 * @property {string|null} cover       a data URL, small enough to list
 * @property {string|null} createdAt   ISO date
 * @property {object} meta             the free-form metadata block
 */

/**
 * @param {string} contents  the stored JSON
 * @returns {ItemHeader}
 */
export function readHeader(contents) {
    try {
        return headerFrom(JSON.parse(contents));
    } catch {
        return emptyHeader();
    }
}

/**
 * @param {object} parsed  an already-parsed item or project file
 * @returns {ItemHeader}
 */
export function headerFrom(parsed) {
    if (!parsed || typeof parsed !== 'object') return emptyHeader();

    return {
        name: typeof parsed.name === 'string' && parsed.name ? parsed.name : null,
        tags: Array.isArray(parsed.tags) ? parsed.tags : [],
        category: typeof parsed.category === 'string' ? parsed.category : null,
        cover: typeof parsed.cover === 'string' ? parsed.cover : null,
        createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : null,
        meta: parsed.meta && typeof parsed.meta === 'object' ? parsed.meta : {}
    };
}

function emptyHeader() {
    return { name: null, tags: [], category: null, cover: null, createdAt: null, meta: {} };
}
