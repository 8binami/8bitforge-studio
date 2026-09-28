/**
 * Kits, held together.
 *
 * The grid that lists them, the window that makes one, and the window that
 * edits one, plus the two things that only make sense between them:
 * copying a shipped kit into the user's own library so it can be changed,
 * and showing a kit's eight instruments in the Library tab beside it.
 */

import { LIBRARY_KINDS } from '../storage/library.js';
import { KitGrid } from './kit-grid.js';
import { KitDialog } from './kit-dialog.js';
import { stackModal } from './modal-stack.js';
import { DEFAULT_KIT_CATEGORY } from './library-categories.js';
import { translateOr } from '../i18n/i18n.js';

export class Kits {
    /**
     * @param {object} options
     * @param {ParentNode} options.root
     * @param {import('../studio.js').Studio} options.studio
     * @param {import('../storage/library.js').Library} options.library
     * @param {import('../storage/favorites.js').Favorites} options.favorites
     * @param {(kit: {name: string, presets: string[]}) => void} [options.onList]
     * @param {() => void} [options.onApplied]  the eight tracks changed
     * @param {(text: string) => void} [options.onStatus]
     */
    constructor({
        root,
        studio,
        library,
        favorites,
        community = null,
        onList = () => {},
        onApplied = () => {},
        onStatus = () => {}
    }) {
        this.root = root;
        this.studio = studio;
        this.library = library;
        this.favorites = favorites;
        this.community = community;
        this.onList = onList;
        this.onApplied = onApplied;
        this.onStatus = onStatus;
    }

    bind() {
        const shared = {
            root: this.root,
            studio: this.studio,
            library: this.library,
            favorites: this.favorites,
            onLoaded: this.onApplied,
            onStatus: this.onStatus
        };

        this.saveDialog = new KitDialog({
            ...shared,
            elements: {
                modal: 'saveKitModal',
                name: 'kitNameInput',
                category: 'kitCategorySelect',
                tags: 'saveKitTags',
                confirm: 'kitSaveConfirm',
                tracks: 'kitTrackSelect',
                cover: 'kitCoverInput',
                coverPreview: 'kitCoverPreview',
                hidden: ['kitShareCheck', 'saveKitOfficialWrap']
            }
        });
        this.saveDialog.bind();

        this.editDialog = new KitDialog({
            ...shared,
            elements: {
                modal: 'editKitModal',
                name: 'editKitName',
                category: 'editKitCategory',
                tags: 'editKitTags',
                confirm: 'editKitConfirmBtn',
                delete: 'editKitDeleteBtn',
                tracks: 'editKitTrackSelect',
                cover: 'editKitCoverInput',
                coverPreview: 'editKitCoverPreview',
                capture: 'editKitCaptureBtn',
                hidden: ['editKitShare', 'editKitOfficialGroup']
            }
        });
        this.editDialog.bind();

        // Both open over the studio window, which Bootstrap does not expect.
        for (const id of ['saveKitModal', 'editKitModal']) {
            stackModal(this.root.querySelector('#' + id));
        }

        this.grid = new KitGrid({
            root: this.root,
            studio: this.studio,
            library: this.library,
            favorites: this.favorites,
            community: this.community,
            onEdit: (entry) => this.edit(entry),
            onDuplicate: (entry) => this.duplicate(entry),
            onList: (entry) => this._list(entry),
            onApplied: this.onApplied,
            onStatus: this.onStatus
        });
        this.grid.bind();

        this.root.querySelector('#saveKitBtn')?.addEventListener('click', () => this.save());
    }

    /** Fill the grid. Called as the studio window opens. */
    async open() {
        await this.grid.reload();
    }

    // ── The two windows ──────────────────────────────────────────────────

    /**
     * Name and file the eight instruments as they are now.
     * @returns {Promise<string|null>} the id written, or null
     */
    async save() {
        await this.saveDialog.prepare();

        // No kit to fill from: the pickers all start on the tracks
        // themselves, which is what someone pressing Create Kit means.
        const id = await this.saveDialog.open({ item: null });
        if (id) this.grid.openId = id;
        return id;
    }

    /**
     * @param {object} entry  a row from the grid
     * @returns {Promise<string|null>} the id written, or null
     */
    async edit(entry) {
        const stored = await this._read(entry.id);
        if (!stored) return null;

        await this.editDialog.prepare();
        const id = await this.editDialog.open({
            id: entry.id,
            name: stored.name,
            category: stored.category ?? DEFAULT_KIT_CATEGORY,
            tags: stored.tags ?? [],
            item: { tracks: stored.data?.tracks ?? [], cover: stored.cover ?? null }
        });

        // Renaming moves a kit, and the grid should stay pointing at the
        // one that is on the tracks.
        if (id && this.grid.openId === entry.id) this.grid.openId = id;
        return id;
    }

    /**
     * Copy a kit into the user's own library.
     *
     * The studio's twenty are read-only, and the way to a variation of one
     * is to have a copy that is yours. The copy is filed straight away
     * rather than opening the edit window on it: it is a copy of something
     * that already works, and naming it can wait until there is something
     * to say about it.
     *
     * @param {object} entry
     */
    async duplicate(entry) {
        const data = entry.source === 'builtin' ? entry.data : (await this._read(entry.id))?.data;
        if (!data) return;

        try {
            const { id } = await this.library.write(LIBRARY_KINDS.kits, {
                name: entry.name,
                category: entry.category ?? DEFAULT_KIT_CATEGORY,
                tags: [...(entry.tags ?? [])],
                cover: entry.cover ?? null,
                data: structuredClone(data)
            });

            this.grid.openId = id;
            this.onStatus(`${translateOr('kit.dupSuccess', 'Kit duplicated')}: ${entry.name}`);
        } catch (error) {
            this.onStatus(
                `${translateOr('library.savefailed', 'Could not save')}: ${error.message}`
            );
        }
    }

    // ── Internals ────────────────────────────────────────────────────────

    /** Show a kit's instruments in the Library tab. */
    async _list(entry) {
        const data = entry.source === 'builtin' ? entry.data : (await this._read(entry.id))?.data;
        if (!data) return;

        this.onList({ name: entry.name, presets: KitGrid.presetsOf(data) });
    }

    async _read(id) {
        try {
            const stored = await this.library.read(LIBRARY_KINDS.kits, id);
            if (stored) return stored;

            this.onStatus(translateOr('library.gone', 'That project is no longer there'));
            await this.grid.reload();
        } catch (error) {
            this.onStatus(
                `${translateOr('library.openfailed', 'Could not open')}: ${error.message}`
            );
        }
        return null;
    }
}
