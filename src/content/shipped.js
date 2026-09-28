/**
 * The library the studio ships with.
 *
 * `library/` holds three hundred files: every instrument preset, kit,
 * rhythm and generator preset the studio comes with: and this is what
 * reads them. They were JavaScript literals until recently; they are files
 * now so that a person can open one, copy it, send it to someone, or add
 * one by pull request without writing a line of code.
 *
 * The glob is eager, which is the same choice `src/i18n/i18n.js` makes for
 * its ten dictionaries and for the same three reasons: three hundred small
 * files cost less inlined than fetched, the desktop build has no network at
 * all, and the catalogues have to be readable synchronously: `loadPreset`
 * and `applyKit` run with no window open and no promise to await.
 *
 * Nothing here throws. A file that is wrong is left out and recorded in
 * `catalogProblems()`, because a throw while this module is being evaluated
 * is not an error anyone catches: it is a white screen, in an application
 * whose whole point is to keep working offline. Losing one preset is a bad
 * day; losing the studio is a different thing entirely.
 */

import { validateItem, validateCatalog, ITEM_FORMAT, METADATA_FILES } from './schema.js';

/** Everything in the folder, resolved at build time. */
const FILES = import.meta.glob('../../library/**/*.json', { eager: true, import: 'default' });

/** What the glob's keys have in front of a file's place in the library. */
const PREFIX = '../../library/';

/** The one metadata file this reads. The others belong to someone else. */
const ORDER_FILE = 'order.json';

const { catalog, problems } = read();

/**
 * Read the folder once, at module load.
 *
 * @returns {{catalog: Record<string, Record<string, object>>, problems: string[]}}
 */
function read() {
    const found = [];
    const problems = [];
    let order = null;

    for (const [path, item] of Object.entries(FILES)) {
        const within = path.replace(PREFIX, '');

        // The files that describe the collection rather than belong to it.
        // Only one of them is this module's: the demo manifest belongs to
        // `demos.js`: but both have to be recognised, or the one that is
        // not would be reported as a broken preset for the rest of time.
        if (METADATA_FILES.includes(within)) {
            if (within === ORDER_FILE) order = item;
            continue;
        }

        const parts = within.split('/');
        const id = parts.at(-1).replace(/\.json$/, '');
        // instruments/leads/x.json is filed under a category; kits/x.json is not.
        const folder = parts.length > 2 ? parts[1] : null;

        if (item?.format !== ITEM_FORMAT) {
            problems.push(`${path}: is in the library but is not a library item`);
            continue;
        }

        const wrong = validateItem(item, { id, folder });
        if (wrong.length > 0) {
            problems.push(...wrong.map((problem) => `${path}: ${problem}`));
            continue;
        }

        found.push({ id, item });
    }

    problems.push(...validateCatalog(found, order));

    return { catalog: group(found, order), problems };
}

/**
 * Group the items by kind, in the curated order.
 *
 * The catalogue was arranged by hand: `lead-classic` before `lead-fat`,
 * `rock` at the head of the classic rhythms: and a folder has no order but
 * alphabetical, which would greet everyone opening the instrument browser
 * with `acoustic-cello`. `library/order.json` records the arrangement, and
 * anything it does not name follows, alphabetically, which is where a
 * newly contributed preset belongs.
 */
function group(found, order) {
    const byKind = {};
    const rank = new Map();

    for (const ids of Object.values(order ?? {})) {
        ids.forEach((id, index) => rank.set(id, index));
    }

    const placed = (id) => rank.get(id) ?? Number.MAX_SAFE_INTEGER;

    for (const { id, item } of [...found].sort(
        (a, b) => placed(a.id) - placed(b.id) || a.id.localeCompare(b.id)
    )) {
        (byKind[item.kind] ??= {})[id] = item;
    }

    return byKind;
}

/**
 * Every shipped item of one kind, by id, in the order the catalogue is
 * meant to be read in.
 *
 * The objects are the loader's own and are shared by everyone who asks, so
 * a caller that intends to change one has to copy it first. That used to be
 * safe by accident (the catalogue was rebuilt for each instance) and is
 * now safe only by agreement.
 *
 * @param {'presets'|'kits'|'rhythms'|'generator-presets'} kind
 * @returns {Record<string, object>} id → the whole envelope
 */
export function shipped(kind) {
    return catalog[kind] ?? {};
}

/**
 * What was wrong with the library when it was read, if anything.
 *
 * Empty in a build anyone should be using; the test suite and
 * `npm run library:check` both fail before a bad file can get this far.
 * It exists for the case they did not run: someone editing a file by hand,
 * or a contribution merged without the gate.
 *
 * @returns {string[]}
 */
export function catalogProblems() {
    return [...problems];
}
