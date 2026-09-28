/**
 * The Save Project window.
 *
 * Only shown when there is something to ask: a project that has been saved
 * before goes straight back where it came from. A new one needs a name, and
 * while the window is open it may as well collect the category and the tags
 * that make it findable later.
 *
 * `open()` resolves to whether anything was written, so the caller can chain
 * on it: "save, then close" has to know the save happened.
 */

import { LIBRARY_KINDS } from '../storage/library.js';
import { saveProjectToLibrary } from '../project/save-to-library.js';
import { DEFAULT_CATEGORY, fillCategories } from './project-categories.js';
import { TagInput } from './tag-input.js';
import { translateOr } from '../i18n/i18n.js';

export class SaveProjectDialog {
    /**
     * @param {object} options
     * @param {ParentNode} options.root
     * @param {import('../storage/library.js').Library} options.library
     * @param {import('../project/project-session.js').ProjectSession} options.session
     * @param {import('../studio.js').Studio} options.studio
     * @param {(text: string) => void} [options.onStatus]
     */
    constructor({ root, library, session, studio, onStatus = () => {} }) {
        this.root = root;
        this.library = library;
        this.session = session;
        this.studio = studio;
        this.onStatus = onStatus;
    }

    bind() {
        this._element = this.root.querySelector('#saveProjectModal');
        if (!this._element) return;

        this._fields = {
            name: this.root.querySelector('#saveProjectName'),
            category: this.root.querySelector('#saveProjectCategory'),
            confirm: this.root.querySelector('#saveProjectConfirmBtn')
        };

        fillCategories(this._fields.category);

        // Sharing and the official badge belonged to the hosted app; there is
        // no community in this build, and a checkbox that saves nowhere is
        // worse than no checkbox.
        this.root
            .querySelector('#saveProjectShare')
            ?.closest('.form-check')
            ?.classList.add('d-none');
        this.root.querySelector('#saveProjectOfficialWrap')?.classList.add('d-none');

        this._tags = new TagInput({
            container: this.root.querySelector('#saveProjectTags'),
            suggest: () => this.library.tagsInUse(LIBRARY_KINDS.projects).then(toTagNames)
        });
    }

    /**
     * Save the open project, asking for a name only if it has never had one.
     * @returns {Promise<boolean>} whether anything was written
     */
    async save() {
        if (this.session.libraryId) return this._write();
        return this.open();
    }

    /**
     * Ask for a name, then save under it.
     * @returns {Promise<boolean>}
     */
    open() {
        if (!this._element || !window.bootstrap) return Promise.resolve(false);

        this._fields.name.value = this.session.name;
        this._fields.category.value = this.session.category || DEFAULT_CATEGORY;
        this._tags.setTags(this.session.tags);

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

        return new Promise((resolve) => {
            let saved = false;

            const accept = async () => {
                const name = this._fields.name.value.trim();
                // An unnamed project has nowhere to go: leave the window open
                // on the empty field rather than closing on a silent failure.
                if (!name) return this._fields.name.focus();

                this.session.describe({
                    name,
                    category: this._fields.category.value,
                    tags: this._tags.getTags()
                });

                saved = await this._write();
                modal.hide();
            };

            const onKey = (event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                accept();
            };

            // One exit for every way the window closes: the button, the
            // cross, Escape, a click outside.
            const onClosed = () => {
                this._fields.confirm.removeEventListener('click', accept);
                this._fields.name.removeEventListener('keydown', onKey);
                this._element.removeEventListener('hidden.bs.modal', onClosed);
                resolve(saved);
            };

            this._fields.confirm.addEventListener('click', accept);
            this._fields.name.addEventListener('keydown', onKey);
            this._element.addEventListener('hidden.bs.modal', onClosed);
        });
    }

    /** @returns {Promise<boolean>} */
    async _write() {
        try {
            await saveProjectToLibrary({
                library: this.library,
                session: this.session,
                studio: this.studio
            });
            this.onStatus(`${translateOr('library.saved', 'Saved')}: ${this.session.name}`);
            return true;
        } catch (error) {
            this.onStatus(
                `${translateOr('library.savefailed', 'Could not save')}: ${error.message}`
            );
            return false;
        }
    }
}

function toTagNames(counted) {
    return counted.map(({ tag }) => tag);
}
