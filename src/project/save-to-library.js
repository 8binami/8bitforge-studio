/**
 * Writing the open project into the library.
 *
 * Three things do this: the save window, the edit window and automatic
 * saving, and they have to agree on what a save is: the studio's state as
 * it stands now, under the description the session holds, over the entry the
 * project came from.
 *
 * Keeping it in one function is what stops them drifting apart, and what
 * stops any of them leaving the session pointing at an id the library no
 * longer has. That happens more easily than it sounds: an entry's id follows
 * its name, so renaming a project moves it, and a caller that forgets to
 * take the new id back would save a duplicate the next time round.
 */

/**
 * @param {object} options
 * @param {import('../storage/library.js').Library} options.library
 * @param {import('./project-session.js').ProjectSession} options.session
 * @param {import('../studio.js').Studio} options.studio
 * @returns {Promise<{id: string, file: object}>}
 */
export async function saveProjectToLibrary({ library, session, studio }) {
    const { id, file } = await library.writeProject({
        // Saving over the entry the project came from replaces it rather
        // than leaving a second copy behind.
        id: session.libraryId,
        name: session.name,
        data: studio.getProjectState(),
        category: session.category,
        tags: session.tags,
        meta: session.meta,
        cover: session.cover,
        createdAt: session.createdAt
    });

    // The first save is what fixes the creation date; keeping it on the
    // session stops the next one from moving it.
    session.createdAt = file.createdAt;
    session.markSaved({ libraryId: id });

    return { id, file };
}
