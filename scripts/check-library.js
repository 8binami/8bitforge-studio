/**
 * Check the library before it reaches anyone.
 *
 *   npm run library:check
 *
 * This reads `library/` off the disk with nothing but `fs`, and that is the
 * point of it. The studio loads the same files through Vite, which means the
 * loader cannot be reused here: `import.meta.glob` does not exist outside a
 * Vite build, so a checker that went through the loader would stop working
 * on the very day the loader started being used.
 *
 * It shares its rules with the loader and the test suite through
 * `src/content/schema.js`, which imports nothing for the same reason.
 *
 * There is no CI behind this repository yet, so this is a gate someone runs.
 * It prints every problem it finds rather than the first, because the person
 * running it wants the list, not a game of whack-a-mole.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    validateItem,
    validateCatalog,
    ITEM_FORMAT,
    METADATA_FILES
} from '../src/content/schema.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIBRARY = path.join(ROOT, 'library');
const ORDER_FILE = 'order.json';
const DEMO_INDEX = 'demos/index.json';

/** Every `.json` under a folder, with the path it was found at. */
async function walk(directory) {
    const found = [];

    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) found.push(...(await walk(full)));
        else if (entry.name.endsWith('.json') || entry.name.endsWith('.8bitforge')) {
            found.push(full);
        }
    }

    return found;
}

/**
 * The demo manifest against the songs beside it.
 *
 * A row the Load window can draw but not open is worse than no row, and a
 * song nobody can find is a song that may as well not ship: so the two
 * lists have to match exactly.
 */
function checkDemos(index, files) {
    const songs = new Set(
        files
            .filter((file) => file.endsWith('.8bitforge'))
            .map((file) => path.basename(file, '.8bitforge'))
    );

    if (!index) return songs.size > 0 ? ['there are demo songs but no demos/index.json'] : [];
    if (!Array.isArray(index)) return ['demos/index.json is not a list'];

    const listed = new Set(index.map((demo) => demo.id));

    return [
        ...index
            .filter((demo) => !songs.has(demo.id))
            .map((demo) => `demos/index.json names a song that is not there: "${demo.id}"`),
        ...[...songs]
            .filter((id) => !listed.has(id))
            .map((id) => `demos/${id}.8bitforge is not in demos/index.json, so nothing lists it`)
    ];
}

async function main() {
    const files = (await walk(LIBRARY).catch(() => [])).sort();
    if (files.length === 0) {
        console.error(`nothing found in ${path.relative(ROOT, LIBRARY)}/`);
        process.exitCode = 1;
        return;
    }

    const problems = [];
    const items = [];
    let order = null;
    let demoIndex = null;

    for (const file of files) {
        const relative = path.relative(ROOT, file).replaceAll('\\', '/');
        const parts = path.relative(LIBRARY, file).replaceAll('\\', '/').split('/');
        const id = parts.at(-1).replace(/\.json$/, '');

        let parsed;
        try {
            parsed = JSON.parse(await fs.readFile(file, 'utf8'));
        } catch (error) {
            problems.push(`${relative}: is not valid JSON, ${error.message}`);
            continue;
        }

        // A demo is a whole project file, not a library item. It is checked
        // against the manifest instead, further down.
        if (file.endsWith('.8bitforge')) {
            if (parsed?.format !== '8bit-forge') {
                problems.push(`${relative}: is not a project file`);
            }
            continue;
        }

        // Two files in here describe the collection rather than belong to
        // it: the curated order, and the list the Load window draws its
        // demo rows from. Neither is an item and neither has a `format`.
        const within = parts.join('/');
        if (METADATA_FILES.includes(within)) {
            if (within === ORDER_FILE) order = parsed;
            if (within === DEMO_INDEX) demoIndex = parsed;
            continue;
        }
        if (parsed?.format !== ITEM_FORMAT) {
            problems.push(`${relative}: is in the library but is not a library item`);
            continue;
        }

        // instruments/leads/x.json has a category folder; kits/x.json does not.
        const folder = parts.length > 2 ? parts[1] : null;
        for (const problem of validateItem(parsed, { id, folder })) {
            problems.push(`${relative}: ${problem}`);
        }

        items.push({ id, item: parsed });
    }

    problems.push(...validateCatalog(items, order));
    problems.push(...checkDemos(demoIndex, files));

    if (problems.length === 0) {
        const demos = Array.isArray(demoIndex) ? demoIndex.length : 0;
        console.info(
            `${items.length} library files and ${demos} demos, nothing wrong with any of them`
        );
        return;
    }

    console.error(`${problems.length} problem(s) in ${path.relative(ROOT, LIBRARY)}/:\n`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exitCode = 1;
}

await main();
