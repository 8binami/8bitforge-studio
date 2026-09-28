/**
 * The Load Project window.
 *
 * `PresetBrowser` draws the table; this says it is about projects. What it
 * adds on top is the cover column, opening a project into the studio, and
 * taking a `.8bitforge` file that was picked from disk.
 *
 * Three sources, as in the original app: the eight songs the studio ships
 * with, whatever is in the local library, and, for someone signed in:
 * what the community shared.
 */

import { LIBRARY_KINDS } from '../storage/library.js';
import { parseProjectFile, ProjectFormatError } from '../project/format.js';
import { PROJECT_CATEGORIES, DEFAULT_CATEGORY, categoryLabel } from './project-categories.js';
import { PresetBrowser, escapeHtml } from './preset-browser.js';
import { DEFAULT_COVER } from './cover-image.js';
import { demoIndex, loadDemo } from '../content/demos.js';
import { translateOr } from '../i18n/i18n.js';

export class ProjectBrowser extends PresetBrowser {
    /**
     * @param {object} options
     * @param {ParentNode} options.root
     * @param {import('../studio.js').Studio} options.studio
     * @param {import('../storage/library.js').Library} options.library
     * @param {import('../storage/favorites.js').Favorites} options.favorites
     * @param {import('../project/project-session.js').ProjectSession} options.session
     * @param {import('../account/community.js').Community|null} [options.community]
     * @param {(id: string) => void} [options.onEdit]     open the edit window
     * @param {() => void} [options.onLoaded]             the studio changed under us
     * @param {(text: string) => void} [options.onStatus] the transport's line
     */
    constructor({
        root,
        studio,
        library,
        favorites,
        session,
        community = null,
        onEdit = () => {},
        onLoaded = () => {},
        onStatus = () => {}
    }) {
        super({
            root,
            studio,
            favorites,
            kind: LIBRARY_KINDS.projects,
            categories: PROJECT_CATEGORIES,
            columns: 7,
            elements: {
                modal: 'loadModal',
                search: 'projectSearchInput',
                count: 'projectCount',
                body: 'projectTableBody',
                empty: 'projectEmptyState',
                table: 'projectTable',
                typeMenu: 'projectTypeFilterMenu',
                favorites: 'projectFavFilterBtn',
                shuffle: 'projectShuffleBtn',
                community: 'projectCommunityFilterBtn',
                sources: ['projectDemoFilterBtn', 'projectUserFilterBtn']
            },
            community,
            onStatus
        });

        this.library = library;
        this.session = session;
        this.onEdit = onEdit;
        this.onLoaded = onLoaded;

        /** @type {'builtin'|'library'|null} which source, or both. */
        this._source = null;
    }

    bound() {
        const chips = { projectDemoFilterBtn: 'builtin', projectUserFilterBtn: 'library' };

        for (const [id, source] of Object.entries(chips)) {
            this.root.querySelector('#' + id)?.addEventListener('click', (event) => {
                // Pressing the chip that is already down shows both again:
                // with two sources there is no third to fall back to.
                this._source = this._source === source ? null : source;

                for (const other of Object.keys(chips)) {
                    this.root
                        .querySelector('#' + other)
                        ?.classList.toggle('active', chips[other] === this._source);
                }
                event.currentTarget.blur();
                this.render();
            });
        }

        this._import = this.root.querySelector('#importProjectFileInput');
        this._import?.addEventListener('change', async () => {
            const file = this._import.files?.[0];
            // Cleared straight away so that picking the same file twice in a
            // row still fires a change event.
            this._import.value = '';
            if (file) await this._openFile(file);
        });
    }

    keeps(entry) {
        return !this._source || entry.source === this._source;
    }

    /** Someone opening their own work is looking for what they did last. */
    defaultSort() {
        return { column: 'date', descending: true };
    }

    categoryLabel(category) {
        return categoryLabel(category);
    }

    async fetch() {
        // The demos come from their manifest rather than from the songs
        // themselves: a row needs a name and a tempo, not sixty kilobytes
        // of note grid.
        const demos = demoIndex().map((demo) => ({
            id: demo.id,
            name: demo.name,
            category: demo.category ?? DEFAULT_CATEGORY,
            designer: '8BitForge',
            tags: ['demo'],
            updatedAt: null,
            cover: null,
            source: 'builtin'
        }));

        const saved = (await this.library.listProjects()).map((entry) => ({
            id: entry.id,
            name: entry.name,
            category: entry.category ?? DEFAULT_CATEGORY,
            // The composer from the project's own metadata: the field the
            // edit window sets.
            designer: entry.meta?.composer || '-',
            tags: entry.tags ?? [],
            updatedAt: entry.updatedAt,
            cover: entry.cover,
            source: 'library'
        }));

        return [...demos, ...saved];
    }

    cells(entry) {
        return `
            <td class="col-cover">
                <img src="${escapeHtml(entry.cover || DEFAULT_COVER)}" alt=""
                    class="preset-browser-cover" />
            </td>
            ${this.commonCells(entry)}`;
    }

    defaultCategory() {
        return DEFAULT_CATEGORY;
    }

    editLabel() {
        return translateOr('proj.editTitle', 'Edit Project');
    }

    edit(entry) {
        // Both windows are full-width modals; the edit window would open
        // behind this one.
        this.close();
        this.onEdit(entry.id);
    }

    // ── Opening ──────────────────────────────────────────────────────────

    async load(entry) {
        if (entry.source === 'builtin') return this._loadDemo(entry);

        let result;
        try {
            result = await this.library.readProject(entry.id);
        } catch (error) {
            this.onStatus(
                `${translateOr('library.openfailed', 'Could not open')}: ${error.message}`
            );
            return;
        }

        if (!result) {
            this.onStatus(translateOr('library.gone', 'That project is no longer there'));
            await this.reload();
            return;
        }

        this._adopt(result.file, { libraryId: entry.id });
        this.openId = entry.id;
        this.onStatus(`${translateOr('library.opened', 'Opened')}: ${result.file.name}`);
        this.close();
    }

    /**
     * Open a project the community shared, as a file opened from disk
     * would be: not in the library until it is saved there.
     */
    async openShared(file) {
        const { file: parsed } = parseProjectFile(JSON.stringify(file));
        this._adopt(parsed);
        this.onStatus(`${translateOr('library.opened', 'Opened')}: ${parsed.name}`);
        this.close();
    }

    /**
     * Open one of the songs the studio ships with.
     *
     * Adopted with no library id, so it behaves like a file someone opened
     * from disk: the first save makes a copy of their own rather than
     * writing over something that came with the application.
     */
    async _loadDemo(entry) {
        let file;
        try {
            file = await loadDemo(entry.id);
        } catch (error) {
            this.onStatus(
                translateOr('library.openfailed', 'Could not open') + ': ' + error.message
            );
            return;
        }
        if (!file) return;

        this._adopt(file);
        this.openId = entry.id;
        this.onStatus(translateOr('library.opened', 'Opened') + ': ' + file.name);
        this.close();
    }

    /**
     * Open a `.8bitforge` file the user picked. It is loaded into the studio
     * but not filed in the library: importing was always "open this", and
     * saving afterwards is what decides whether it is kept.
     *
     * @param {File} file
     */
    async _openFile(file) {
        try {
            const { file: parsed } = parseProjectFile(await file.text());
            this._adopt(parsed);
            this.openId = null;
            this.onStatus(`${translateOr('library.opened', 'Opened')}: ${parsed.name}`);
            this.close();
        } catch (error) {
            const detail =
                error instanceof ProjectFormatError
                    ? error.message
                    : translateOr('library.importfailed', 'Could not import');
            this.onStatus(`${translateOr('library.importfailed', 'Could not import')}: ${detail}`);
        }
    }

    /** The one place a loaded project is handed to the studio. */
    _adopt(file, { libraryId = null } = {}) {
        this.session.adopt(file, { libraryId });

        // A fresh project starts a fresh history: undoing past a load would
        // restore the previous project's audio under this project's name.
        this.studio.history.clear();
        this.studio.history.saveState('Project opened');
        // Seeding the history reads as an edit to whatever watches it, so the
        // flag is cleared after, not before.
        this.session.markClean();

        this.onLoaded();
    }
}
