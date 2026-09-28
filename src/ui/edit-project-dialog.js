/**
 * The Edit Project window.
 *
 * Everything a project says about itself and nothing it sounds like: the
 * name, the cover, the category, the tags, and the ID3 fields an exported
 * track carries into a media player. It never touches the studio state.
 *
 * It edits two different things behind one window. Opened from the topbar it
 * edits the project that is open, whether or not it has ever been saved;
 * opened from a row in the browser it edits that stored project, rewriting
 * its envelope in place and leaving its payload alone.
 */

import { LIBRARY_KINDS } from '../storage/library.js';
import { saveProjectToLibrary } from '../project/save-to-library.js';
import { DEFAULT_CATEGORY, fillCategories } from './project-categories.js';
import { coverFromFile, DEFAULT_COVER } from './cover-image.js';
import { TagInput } from './tag-input.js';
import { confirmAction } from './confirm.js';
import { translateOr } from '../i18n/i18n.js';

/** Field id in the markup → key in the project's metadata block. */
const META_FIELDS = Object.freeze({
    editMetaComposer: 'composer',
    editMetaArranger: 'arranger',
    editMetaLabel: 'label',
    editMetaGenre: 'genre',
    editMetaYear: 'year',
    editMetaIsrc: 'isrc',
    editMetaCopyright: 'copyright',
    editMetaComment: 'comment'
});

export class EditProjectDialog {
    /**
     * @param {object} options
     * @param {ParentNode} options.root
     * @param {import('../storage/library.js').Library} options.library
     * @param {import('../storage/favorites.js').Favorites} options.favorites
     * @param {import('../project/project-session.js').ProjectSession} options.session
     * @param {import('../studio.js').Studio} options.studio
     * @param {(text: string) => void} [options.onStatus]
     */
    constructor({ root, library, favorites, session, studio, onStatus = () => {} }) {
        this.root = root;
        this.library = library;
        this.favorites = favorites;
        this.session = session;
        this.studio = studio;
        this.onStatus = onStatus;

        /** The cover as the window currently shows it, saved only on accept. */
        this._cover = null;
    }

    bind() {
        this._element = this.root.querySelector('#editProjectModal');
        if (!this._element) return;

        this._fields = {
            name: this.root.querySelector('#editProjectName'),
            category: this.root.querySelector('#editProjectCategory'),
            cover: this.root.querySelector('#editProjectCoverPreview'),
            coverInput: this.root.querySelector('#editProjectCoverInput'),
            coverRemove: this.root.querySelector('#editProjectCoverRemoveBtn'),
            bpm: this.root.querySelector('#editMetaBpm'),
            confirm: this.root.querySelector('#editProjectConfirmBtn'),
            delete: this.root.querySelector('#editProjectDeleteBtn')
        };

        fillCategories(this._fields.category);

        // No community in this build, so nothing to share with.
        this.root
            .querySelector('#editProjectShare')
            ?.closest('.form-check')
            ?.classList.add('d-none');

        this._tags = new TagInput({
            container: this.root.querySelector('#editProjectTags'),
            suggest: () => this.library.tagsInUse(LIBRARY_KINDS.projects).then(toTagNames)
        });

        this._fields.coverInput?.addEventListener('change', () => this._pickCover());
        this._fields.coverRemove?.addEventListener('click', () => this._setCover(null));
    }

    /**
     * Edit a project.
     *
     * @param {string|null} [libraryId]  a stored project, or the open one
     */
    async open(libraryId = null) {
        if (!this._element || !window.bootstrap) return;

        const target = libraryId ? await this._readStored(libraryId) : this._fromSession();
        if (!target) return;

        this._target = target;
        this._fill(target);

        const modal = window.bootstrap.Modal.getOrCreateInstance(this._element);
        this._element.addEventListener(
            'shown.bs.modal',
            () => {
                this._fields.name.focus();
                this._fields.name.select();
            },
            { once: true }
        );
        modal.show();

        const accept = () => this._accept(modal);
        const remove = () => this._delete(modal);
        const onKey = (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            accept();
        };
        const onClosed = () => {
            this._fields.confirm.removeEventListener('click', accept);
            this._fields.delete.removeEventListener('click', remove);
            this._fields.name.removeEventListener('keydown', onKey);
            this._element.removeEventListener('hidden.bs.modal', onClosed);
        };

        this._fields.confirm.addEventListener('click', accept);
        this._fields.delete.addEventListener('click', remove);
        this._fields.name.addEventListener('keydown', onKey);
        this._element.addEventListener('hidden.bs.modal', onClosed);
    }

    // ── What is being edited ─────────────────────────────────────────────

    /** The project that is open, saved or not. */
    _fromSession() {
        return {
            libraryId: this.session.libraryId,
            isOpen: true,
            name: this.session.name,
            category: this.session.category,
            tags: this.session.tags,
            meta: this.session.meta,
            cover: this.session.cover
        };
    }

    async _readStored(libraryId) {
        // Editing the project that is open through its row in the browser is
        // still editing the open project: reading it back from storage would
        // lose whatever has not been saved.
        if (libraryId === this.session.libraryId) return this._fromSession();

        let result;
        try {
            result = await this.library.readProject(libraryId);
        } catch (error) {
            this.onStatus(
                `${translateOr('library.openfailed', 'Could not open')}: ${error.message}`
            );
            return null;
        }
        if (!result) {
            this.onStatus(translateOr('library.gone', 'That project is no longer there'));
            return null;
        }

        return {
            libraryId,
            isOpen: false,
            name: result.file.name,
            category: result.file.category,
            tags: result.file.tags,
            meta: result.file.meta,
            cover: result.file.cover
        };
    }

    _fill(target) {
        this._fields.name.value = target.name;
        this._fields.category.value = target.category || DEFAULT_CATEGORY;
        this._tags.setTags(target.tags ?? []);
        this._setCover(target.cover ?? null);

        for (const [id, key] of Object.entries(META_FIELDS)) {
            const field = this.root.querySelector(`#${id}`);
            if (field) field.value = target.meta?.[key] ?? '';
        }

        // The tempo is the sequencer's, not something to type: it is shown so
        // that the metadata block reads complete, and it is read back from
        // the project when it is saved.
        if (this._fields.bpm) this._fields.bpm.value = String(this.studio.sequencer.bpm);

        // Only a stored project can be deleted; the open one is not filed
        // anywhere yet.
        this._fields.delete.classList.toggle('d-none', !target.libraryId);
    }

    // ── The cover ────────────────────────────────────────────────────────

    async _pickCover() {
        const file = this._fields.coverInput.files?.[0];
        this._fields.coverInput.value = '';
        if (!file) return;

        const cover = await coverFromFile(file);
        if (cover) this._setCover(cover);
    }

    _setCover(cover) {
        this._cover = cover;
        if (this._fields.cover) this._fields.cover.src = cover || DEFAULT_COVER;
        this._fields.coverRemove?.classList.toggle('d-none', !cover);
    }

    // ── Saving and deleting ──────────────────────────────────────────────

    async _accept(modal) {
        const name = this._fields.name.value.trim();
        if (!name) return this._fields.name.focus();

        const description = {
            name,
            category: this._fields.category.value,
            tags: this._tags.getTags(),
            meta: this._readMeta(),
            cover: this._cover
        };

        modal.hide();

        if (!this._target.isOpen) {
            // Someone else's row: rewrite that entry and leave the studio
            // alone.
            await this._rewrite(this._target.libraryId, description);
        } else {
            this.session.describe(description);

            // Renaming a stored project moves its entry, so this has to go
            // through the one place that takes the new id back. Writing the
            // studio's current state at the same time is what makes the
            // saved flag honest afterwards.
            if (this.session.libraryId) await this._saveOpen();
        }

        this.onStatus(`${translateOr('proj.updated', 'Updated')}: ${name}`);
    }

    async _saveOpen() {
        try {
            await saveProjectToLibrary({
                library: this.library,
                session: this.session,
                studio: this.studio
            });
        } catch (error) {
            this.onStatus(
                `${translateOr('library.savefailed', 'Could not save')}: ${error.message}`
            );
        }
    }

    /**
     * Write a new envelope around a stored project's payload. The payload is
     * read and put back untouched: this window does not know what is in it,
     * and the project it belongs to is not the one open in the studio.
     */
    async _rewrite(libraryId, description) {
        try {
            const stored = await this.library.readProject(libraryId);
            if (!stored) return;

            await this.library.writeProject({
                id: libraryId,
                ...description,
                data: stored.file.data,
                createdAt: stored.file.createdAt
            });
        } catch (error) {
            this.onStatus(
                `${translateOr('library.savefailed', 'Could not save')}: ${error.message}`
            );
        }
    }

    async _delete(modal) {
        const { libraryId, isOpen, name } = this._target;
        if (!libraryId) return;

        modal.hide();

        const confirmed = await confirmAction({
            message: translateOr('proj.deleteConfirm', 'Delete this project?'),
            title: translateOr('proj.delete', 'Delete'),
            confirmLabel: translateOr('proj.delete', 'Delete')
        });
        if (!confirmed) return;

        await this.library.removeProject(libraryId);
        // An id freed up can be taken by the next project saved under the
        // same name, so the favourite goes with it.
        this.favorites.forget(LIBRARY_KINDS.projects, libraryId);

        // The project stays open and editable; it is simply no longer filed
        // anywhere, so the next save makes a new entry.
        if (isOpen || this.session.libraryId === libraryId) this.session.libraryId = null;

        this.onStatus(`${translateOr('proj.deleted', 'Deleted')}: ${name}`);
    }

    _readMeta() {
        const meta = {};
        for (const [id, key] of Object.entries(META_FIELDS)) {
            const value = this.root.querySelector(`#${id}`)?.value.trim();
            // Only what was filled in: an envelope of empty strings is noise
            // in a file meant to be read.
            if (value) meta[key] = value;
        }
        return meta;
    }
}

function toTagNames(counted) {
    return counted.map(({ tag }) => tag);
}
