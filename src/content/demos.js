/**
 * The songs the studio ships with.
 *
 * Eight pieces written to show what the studio can do. They were a thousand
 * lines of note arrays inside the old program; they are ordinary
 * `.8bitforge` project files now, which means a demo is exactly what one of
 * your own songs is: the Load window lists it beside them, opening one
 * opens it, and saving over it is your business.
 *
 * Unlike the presets, these are not bundled. A song is sixty kilobytes of
 * note grid and the studio needs one only when somebody picks it, so the
 * list comes in eagerly: a name, a tempo, a category per demo, under two
 * kilobytes for all eight: and the songs are fetched on demand. Vite
 * splits each one into its own chunk, so they still ship inside the app and
 * still work with no network.
 */

import { parseProjectFile } from '../project/format.js';
import DEMO_INDEX from '../../library/demos/index.json';

/**
 * One loader per song, keyed by path. Not eager: calling one is what
 * fetches that song's chunk.
 */
const SONGS = import.meta.glob('../../library/demos/*.8bitforge', {
    query: '?raw',
    import: 'default'
});

/** Path → id, so a row can find the loader that belongs to it. */
const BY_ID = new Map(
    Object.keys(SONGS).map((path) => [
        path
            .split('/')
            .pop()
            .replace(/\.8bitforge$/, ''),
        path
    ])
);

/**
 * Every demo, as much as can be known without opening one.
 *
 * @returns {Array<{id: string, name: string, category: string, bpm: number,
 *   steps: number, description: string}>}
 */
export function demoIndex() {
    // Only the ones whose song is actually present: a manifest naming a
    // missing file would draw a row that does nothing when clicked.
    return DEMO_INDEX.filter((demo) => BY_ID.has(demo.id));
}

/**
 * Open one.
 *
 * @param {string} id
 * @returns {Promise<object|null>} a parsed project file, or null if there
 *   is no demo by that name
 * @throws {import('../project/format.js').ProjectFormatError}
 */
export async function loadDemo(id) {
    const path = BY_ID.get(id);
    if (!path) return null;

    const text = await SONGS[path]();
    return parseProjectFile(text).file;
}
