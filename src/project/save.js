/**
 * What Ctrl+S does.
 *
 * A project is a file. Saving writes that file: the first time it asks
 * where, every time after that it writes where it was told, and the studio
 * says which file it wrote. That is the whole model, and it is the one
 * every other program the user has ever saved anything in uses.
 *
 * The library is the studio's own shelf, not the save destination: a copy
 * kept inside the application, listed in the Load window, useful for the
 * things you want at hand rather than filed somewhere. "Add to library" puts
 * one there; saving does not.
 *
 * One platform cannot do this: a browser without the File System Access API
 * (Firefox, Safari today) can hand a file to the download folder but cannot
 * write to it again, so a second save would leave a second download. There,
 * and only there, saving means the library, and the studio says so rather
 * than pretending.
 */

import { saveProjectToLibrary } from './save-to-library.js';

/**
 * @typedef {{where: 'file'|'library'|'cancelled', name?: string, path?: string|null}} SaveResult
 */

/**
 * @param {object} options
 * @param {import('./project-session.js').ProjectSession} options.session
 * @param {import('../storage/library.js').Library} options.library
 * @param {import('../studio.js').Studio} options.studio
 * @returns {Promise<SaveResult>}
 */
export async function saveOpenProject({ session, library, studio }) {
    if (canWriteFiles(session)) {
        // Writes the file it came from; asks once for a project that has
        // never been saved, and remembers the answer.
        const { saved, path } = await session.save();
        return saved ? { where: 'file', name: session.name, path } : { where: 'cancelled' };
    }

    const { file } = await saveProjectToLibrary({ library, session, studio });
    return { where: 'library', name: file.name };
}

/** Whether saving can mean a file on this platform. */
export function canWriteFiles(session) {
    return Boolean(session.platform?.capabilities?.overwriteInPlace);
}
