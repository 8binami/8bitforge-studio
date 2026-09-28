/**
 * The window that names a saved thing.
 *
 * A generator preset, an instrument preset and a kit are all filed the same
 * way: a name, a category, some tags, and, when the thing already exists,
 * a way to delete it. The studio has six of these windows in its markup and
 * they differ only in which ids they own and what they are called.
 *
 * So this is one class, given a set of element ids. Anything with more to
 * ask for (a kit has eight instruments and a cover) subclasses it and adds
 * its own fields around `collect()` and `fill()`.
 *
 * The payload is never inspected here. Saving takes whatever `capture` hands
 * over; editing without a `capture` reads the stored payload and puts it
 * back untouched, so renaming a preset cannot change what it does.
 */

import { TagInput } from './tag-input.js';
import { confirmAction } from './confirm.js';
import { translateOr } from '../i18n/i18n.js';

export class ItemDialog {
    /**
     * @param {object} options
     * @param {ParentNode} options.root
     * @param {import('../storage/library.js').Library} options.library
     * @param {import('../storage/favorites.js').Favorites} options.favorites
     * @param {import('../storage/library.js').LibraryKind} options.kind
     * @param {object} options.elements  modal, name, category, tags, confirm,
     *                                   and optionally delete and hidden
     * @param {readonly string[]} options.categories
     * @param {string} options.defaultCategory
     * @param {(category: string) => string} options.categoryLabel
     * @param {(category: string) => string} options.categoryKey
     * @param {{delete: string, deleteConfirm: string}} options.keys
     * @param {(text: string) => void} [options.onStatus]
     */
    constructor({
        root,
        library,
        favorites,
        kind,
        elements,
        categories,
        defaultCategory,
        categoryLabel,
        categoryKey,
        keys,
        onStatus = () => {}
    }) {
        this.root = root;
        this.library = library;
        this.favorites = favorites;
        this.kind = kind;
        this.elements = elements;
        this.categories = categories;
        this.defaultCategory = defaultCategory;
        this.categoryLabel = categoryLabel;
        this.categoryKey = categoryKey;
        this.keys = keys;
        this.onStatus = onStatus;
    }

    bind() {
        this._element = this._el(this.elements.modal);
        if (!this._element) return;

        this._fields = {
            name: this._el(this.elements.name),
            category: this._el(this.elements.category),
            confirm: this._el(this.elements.confirm),
            delete: this._el(this.elements.delete)
        };

        this._fillCategories();

        // Sharing and the official badge belonged to the hosted app; there
        // is no community in this build, and a checkbox that saves nowhere
        // is worse than no checkbox.
        for (const id of this.elements.hidden ?? []) {
            const element = this._el(id);
            (element?.closest('.form-check') ?? element)?.classList.add('d-none');
        }

        this._tags = new TagInput({
            container: this._el(this.elements.tags),
            suggest: () => this.library.tagsInUse(this.kind).then(toTagNames)
        });

        this.bound();
    }

    /** For a subclass with fields of its own. */
    bound() {}

    /**
     * Ask, then write.
     *
     * @param {object} what
     * @param {string|null} [what.id]        the entry being edited, if any
     * @param {string} [what.name]
     * @param {string} [what.category]
     * @param {string[]} [what.tags]
     * @param {object} [what.item]           whatever a subclass needs to fill
     * @param {(() => object)|null} [what.capture]  the payload to store; left
     *   out, the entry keeps the payload it already has
     * @returns {Promise<string|null>} the id written, or null
     */
    open({ id = null, name = '', category = null, tags = [], item = null, capture = null } = {}) {
        if (!this._element || !window.bootstrap) return Promise.resolve(null);

        this._fields.name.value = name;
        if (this._fields.category) {
            this._fields.category.value = category || this.defaultCategory;
        }
        this._tags.setTags(tags);
        this.fill({ id, name, category, tags, item });

        // Only something already stored can be deleted.
        this._fields.delete?.classList.toggle('d-none', !id);

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
            let written = null;

            const accept = async () => {
                const typed = this._fields.name.value.trim();
                // An unnamed item has nowhere to go: leave the window open on
                // the empty field rather than closing on a silent failure.
                if (!typed) return this._fields.name.focus();

                written = await this._write(id, typed, capture);
                modal.hide();
            };

            const remove = async () => {
                // The window stays up while the question is asked, and the
                // order matters twice over. Cancelling puts you back where
                // you were rather than closing the window you did not ask
                // to close; and whoever is awaiting this call learns that
                // the entry is gone after it is gone, not before: which
                // is the difference between a caller seeing a delete and a
                // caller seeing a window dismissed.
                if (await this._delete(id, name)) modal.hide();
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
                this._fields.delete?.removeEventListener('click', remove);
                this._fields.name.removeEventListener('keydown', onKey);
                this._element.removeEventListener('hidden.bs.modal', onClosed);
                this.closed(written);
                resolve(written);
            };

            this._fields.confirm.addEventListener('click', accept);
            this._fields.delete?.addEventListener('click', remove);
            this._fields.name.addEventListener('keydown', onKey);
            this._element.addEventListener('hidden.bs.modal', onClosed);
        });
    }

    // ── What a subclass adds ─────────────────────────────────────────────

    /** Put the extra fields on screen. */
    fill(_what) {}

    /** What the extra fields say, merged into what is written. */
    collect() {
        return {};
    }

    /**
     * The window has gone, however it went.
     *
     * For a subclass that changed something outside itself while it was
     * open (the kit window auditions each instrument on its track) and
     * has to put it back when nothing was saved.
     *
     * @param {string|null} _written  the id written, or null
     */
    closed(_written) {}

    // ── Writing ──────────────────────────────────────────────────────────

    async _write(id, name, capture) {
        try {
            // Editing without a capture keeps the payload the entry already
            // holds: this window renames things, it does not rewrite them.
            const data = capture
                ? capture()
                : ((await this.library.read(this.kind, id))?.data ?? {});

            const { id: written } = await this.library.write(this.kind, {
                id,
                name,
                data,
                category: this._fields.category?.value ?? this.defaultCategory,
                tags: this._tags.getTags(),
                ...this.collect()
            });

            this.onStatus(`${translateOr('library.saved', 'Saved')}: ${name}`);
            return written;
        } catch (error) {
            this.onStatus(
                `${translateOr('library.savefailed', 'Could not save')}: ${error.message}`
            );
            return null;
        }
    }

    /** @returns {Promise<boolean>} whether the entry is now gone */
    async _delete(id, name) {
        if (!id) return false;

        const confirmed = await confirmAction({
            message: translateOr(this.keys.deleteConfirm, 'Delete this?'),
            title: translateOr(this.keys.delete, 'Delete'),
            confirmLabel: translateOr(this.keys.delete, 'Delete')
        });
        if (!confirmed) return false;

        await this.library.remove(this.kind, id);
        // An id freed up can be taken by the next item saved under the same
        // name, so the favourite goes with it.
        this.favorites.forget(this.kind, id);
        this.onStatus(`${translateOr('proj.deleted', 'Deleted')}: ${name}`);
        return true;
    }

    // ── Internals ────────────────────────────────────────────────────────

    _el(id) {
        return id ? this.root.querySelector(`#${id}`) : null;
    }

    /**
     * Rewrite the category picker from the shared list. The markup ships the
     * options in English; this puts them in the user's language and keeps
     * every window offering the same set.
     */
    _fillCategories() {
        const select = this._fields.category;
        if (!select) return;

        const chosen = select.value;
        select.innerHTML = this.categories
            .map(
                (category) =>
                    `<option value="${category}" data-i18n="${this.categoryKey(
                        category
                    )}">${this.categoryLabel(category)}</option>`
            )
            .join('');
        select.value = chosen || this.defaultCategory;
    }
}

function toTagNames(counted) {
    return counted.map(({ tag }) => tag);
}
