/**
 * Bringing what the old site kept into this studio's library.
 *
 * The API hands each creation back as the file the studio already opens: a
 * project in the old app's format, or a library item: so it goes through the
 * same import as a file somebody drops in, migrations and all. Only once the
 * library has it is the API told to forget it: a failure on the way leaves it
 * where it was, to try again.
 */

import { LIBRARY_KINDS } from '../storage/library.js';

const KINDS = new Set(Object.values(LIBRARY_KINDS));

/**
 * Import one old creation.
 *
 * @param {object} options
 * @param {import('./account.js').Account} options.account
 * @param {import('../storage/library.js').Library} options.library
 * @param {number} options.id
 * @returns {Promise<{kind: string, name: string, forgotten: boolean}>}
 *          forgotten is false when the library has it but the API could not
 *          be told; it will be offered again, and is harmless to take twice
 */
export async function importLegacyItem({ account, library, id }) {
    const { kind, file } = await account.legacyTake(id);
    const { name } = await importIntoLibrary(library, kind, file);

    try {
        await account.legacyForget(id);
        return { kind, name, forgotten: true };
    } catch {
        return { kind, name, forgotten: false };
    }
}

/**
 * Put one file into the library through its own import: a project through
 * the project import and its migrations, anything else as a library item.
 * Shared by what the old site kept and what the community shares.
 *
 * @param {import('../storage/library.js').Library} library
 * @param {string} kind a library kind
 * @param {object} file the parsed file
 * @returns {Promise<{id: string, name: string}>}
 */
export async function importIntoLibrary(library, kind, file) {
    if (!KINDS.has(kind)) throw new Error(`Unknown kind "${kind}"`);
    const contents = JSON.stringify(file);
    return kind === LIBRARY_KINDS.projects ? library.importProject(contents) : library.importItem(kind, contents);
}

/**
 * Import several, one after another, reporting each as it lands.
 *
 * @param {object} options
 * @param {import('./account.js').Account} options.account
 * @param {import('../storage/library.js').Library} options.library
 * @param {number[]} options.ids
 * @param {(done: number, total: number) => void} [options.onProgress]
 * @returns {Promise<{imported: Array<{id: number, kind: string, name: string}>, failed: Array<{id: number, error: Error}>}>}
 */
export async function importLegacyItems({ account, library, ids, onProgress = () => {} }) {
    const imported = [];
    const failed = [];
    for (const [index, id] of ids.entries()) {
        try {
            imported.push({ id, ...(await importLegacyItem({ account, library, id })) });
        } catch (error) {
            failed.push({ id, error });
        }
        onProgress(index + 1, ids.length);
    }
    return { imported, failed };
}
