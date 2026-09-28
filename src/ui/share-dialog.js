/**
 * The Share window: one thing from the library, to everyone, under a licence
 * its author chooses.
 *
 * What is sent is the file the library already holds: the same bytes an
 * export would write: so what others open is exactly what was shared. A
 * handle is needed first, since a shared source lives under its author's
 * profile; without one, the account page on the site opens and the status
 * line says why.
 */

import { LIBRARY_KINDS } from '../storage/library.js';
import { translateOr } from '../i18n/i18n.js';
import { escapeHtml } from './preset-browser.js';

export class ShareDialog {
    /**
     * @param {object} options
     * @param {ParentNode} options.root
     * @param {import('../account/account.js').Account} options.account
     * @param {import('../storage/library.js').Library} options.library
     * @param {() => void} [options.onNeedsHandle] there is no username yet
     * @param {(text: string) => void} [options.onStatus]
     */
    constructor({ root, account, library, onNeedsHandle = () => {}, onStatus = () => {} }) {
        this.root = root;
        this.account = account;
        this.library = library;
        this.onNeedsHandle = onNeedsHandle;
        this.onStatus = onStatus;
    }

    bind() {
        const $ = (id) => this.root.querySelector(`#${id}`);
        this.el = {
            modal: $('shareModal'),
            kind: $('shareKind'),
            item: $('shareItem'),
            description: $('shareDescription'),
            message: $('shareMessage'),
            submit: $('shareSubmit')
        };
        if (!this.el.modal) return;

        this.el.kind.addEventListener('change', () => this._fillItems());
        this.el.submit.addEventListener('click', () => this._share());
    }

    /** @param {{kind?: string, id?: string}} [preselect] */
    async open(preselect = {}) {
        if (!this.account.user || !this.el?.modal) return;
        if (!this.account.user.handle) {
            this.onNeedsHandle();
            return;
        }

        if (preselect.kind) this.el.kind.value = preselect.kind;
        this.el.description.value = '';
        this._message(null);
        this.el.submit.disabled = false;
        await this._fillItems(preselect.id);
        window.bootstrap.Modal.getOrCreateInstance(this.el.modal).show();
    }

    async _fillItems(selectId = null) {
        const kind = this.el.kind.value;
        let items = [];
        try {
            items = kind === LIBRARY_KINDS.projects ? await this.library.listProjects() : await this.library.list(kind);
        } catch {
            items = [];
        }
        items = [...items].sort((a, b) => String(a.name).localeCompare(String(b.name)));

        this.el.item.innerHTML = items.length
            ? items.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('')
            : `<option value="" disabled selected>${escapeHtml(translateOr('share.empty', 'Nothing of this kind in your library yet.'))}</option>`;
        if (selectId) this.el.item.value = selectId;
        this.el.submit.disabled = items.length === 0;
    }

    async _share() {
        const kind = this.el.kind.value;
        const id = this.el.item.value;
        if (!id) return;

        this.el.submit.disabled = true;
        try {
            const file =
                kind === LIBRARY_KINDS.projects ? (await this.library.readProject(id))?.file : await this.library.read(kind, id);
            if (!file) throw new Error(translateOr('share.missing', 'That item is no longer in your library.'));

            const license = this.root.querySelector('input[name="shareLicense"]:checked')?.value || 'CC-BY-4.0';
            const { item } = await this.account.share({
                kind,
                license,
                description: this.el.description.value.trim() || null,
                file
            });
            const done = translateOr('share.done', '"{name}" is shared with the community.', { name: item.name });
            this._message(done, 'good');
            this.onStatus(done);
        } catch (error) {
            this._message(error?.message || String(error), 'bad');
            this.el.submit.disabled = false;
        }
    }

    _message(text, tone = null) {
        this.el.message.textContent = text || '';
        this.el.message.classList.toggle('d-none', !text);
        this.el.message.classList.toggle('text-success', tone === 'good');
        this.el.message.classList.toggle('text-danger', tone === 'bad');
    }
}
