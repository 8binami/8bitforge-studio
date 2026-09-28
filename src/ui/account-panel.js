/**
 * The account, on screen: the topbar button, the sign-in window, and the
 * window that brings back what the old site kept.
 *
 * Nothing here is shown unless the account feature is on. Signed out, the
 * topbar offers "Sign in"; signed in, a menu with the address, the old
 * creations and "Sign out". Every message about signing in is written in the
 * window it concerns: the topbar status line lasts a second and a half, and
 * "check your inbox" has to still be there when someone looks up.
 *
 * Accounts, profiles and the community's pages live on 8bitforge.com: the
 * links here open the site rather than windows of the studio's own.
 */

import { ACCOUNT_EVENTS } from '../account/account.js';
import { importLegacyItems } from '../account/legacy-import.js';
import { LIBRARY_KINDS } from '../storage/library.js';
import { translateOr, I18N_EVENTS } from '../i18n/i18n.js';
import { escapeHtml } from './preset-browser.js';

/** The order old creations are listed in, and the words for each kind. */
const KIND_ORDER = [LIBRARY_KINDS.projects, LIBRARY_KINDS.presets, LIBRARY_KINDS.kits, LIBRARY_KINDS.generatorPresets];
const KIND_LABELS = {
    [LIBRARY_KINDS.projects]: ['account.kind.projects', 'Projects'],
    [LIBRARY_KINDS.presets]: ['account.kind.presets', 'Instruments'],
    [LIBRARY_KINDS.kits]: ['account.kind.kits', 'Kits'],
    [LIBRARY_KINDS.generatorPresets]: ['account.kind.generators', 'Generator presets']
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class AccountPanel {
    /**
     * @param {object} options
     * @param {ParentNode} options.root
     * @param {import('../account/account.js').Account} options.account
     * @param {import('../storage/library.js').Library} options.library
     * @param {import('../core/event-bus.js').EventBus} options.bus
     * @param {string} options.returnUrl where a sign-in link brings people back
     * @param {boolean} [options.codeFirst] the link cannot come back here (the
     *        desktop app): lead with the code rather than the link
     * @param {{share?: object}} [options.dialogs]
     * @param {import('../account/community.js').Community} [options.community] opens the site
     * @param {() => void} [options.onSignedIn] after signing in with a code
     * @param {(text: string) => void} [options.onStatus]
     */
    constructor({
        root,
        account,
        library,
        bus,
        returnUrl,
        codeFirst = false,
        dialogs = {},
        community = null,
        onSignedIn = () => {},
        onStatus = () => {}
    }) {
        this.root = root;
        this.account = account;
        this.library = library;
        this.bus = bus;
        this.returnUrl = returnUrl;
        this.codeFirst = codeFirst;
        this.dialogs = dialogs;
        this.community = community;
        this.onSignedIn = onSignedIn;
        this.onStatus = onStatus;
        this._items = [];
        this._email = '';
    }

    bind() {
        const $ = (id) => this.root.querySelector(`#${id}`);
        this.el = {
            area: $('accountArea'),
            signIn: $('accountSignIn'),
            menu: $('accountMenu'),
            name: $('accountName'),
            email: $('accountEmail'),
            dot: $('accountLegacyDot'),
            legacy: $('accountLegacy'),
            signOut: $('accountSignOut'),
            signInModal: $('accountSignInModal'),
            form: $('accountSignInForm'),
            input: $('accountEmailInput'),
            send: $('accountSendLink'),
            signInMessage: $('accountSignInMessage'),
            codeStep: $('accountCodeStep'),
            code: $('accountCodeInput'),
            codeSubmit: $('accountCodeSubmit'),
            community: $('communityOpen'),
            profile: $('accountProfile'),
            share: $('accountShare'),
            signUp: $('accountSignUpLink'),
            legacyModal: $('accountLegacyModal'),
            all: $('accountLegacyAll'),
            allWrap: $('accountLegacyAllWrap'),
            list: $('accountLegacyList'),
            legacyMessage: $('accountLegacyMessage'),
            import: $('accountLegacyImport'),
            importLabel: $('accountLegacyImportLabel')
        };
        if (!this.el.area) return;

        this.el.area.classList.replace('d-none', 'd-flex');
        this.el.signIn.addEventListener('click', () => this.openSignIn());
        this.el.form.addEventListener('submit', (event) => {
            event.preventDefault();
            this._sendLink();
        });
        this.el.codeSubmit.addEventListener('click', () => this._verifyCode());
        this.el.code.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                this._verifyCode();
            }
        });
        this.el.legacy.addEventListener('click', (event) => {
            event.preventDefault();
            this.openLegacy();
        });
        this.el.community.addEventListener('click', () => this.community?.openSite('community'));
        this.el.profile.addEventListener('click', (event) => {
            event.preventDefault();
            this.community?.openSite('account');
        });
        this.el.signUp?.addEventListener('click', (event) => {
            event.preventDefault();
            this.community?.openSite('login');
        });
        this.el.share.addEventListener('click', (event) => {
            event.preventDefault();
            this.dialogs.share?.open();
        });
        this.el.signOut.addEventListener('click', async (event) => {
            event.preventDefault();
            await this.account.signOut();
            this.onStatus(translateOr('account.signedOut', 'Signed out'));
        });
        this.el.all.addEventListener('change', () => {
            for (const box of this._boxes()) box.checked = this.el.all.checked;
            this._syncImportButton();
        });
        this.el.list.addEventListener('change', () => {
            const boxes = this._boxes();
            this.el.all.checked = boxes.length > 0 && boxes.every((box) => box.checked);
            this._syncImportButton();
        });
        this.el.import.addEventListener('click', () => this._importChecked());

        this.bus.on(ACCOUNT_EVENTS.changed, () => this._render());
        this.bus.on(I18N_EVENTS.changed, () => {
            this._syncImportButton();
            if (this._items.length) this._renderList();
        });
        this._render();
    }

    /** @param {{message?: string, tone?: 'good'|'bad'}} [notice] */
    openSignIn(notice = null) {
        this.el.input.value = '';
        this.el.code.value = '';
        this.el.codeStep.classList.add('d-none');
        this.el.send.disabled = false;
        this._message(this.el.signInMessage, notice?.message ?? null, notice?.tone);
        this._modal(this.el.signInModal).show();
        this.el.signInModal.addEventListener('shown.bs.modal', () => this.el.input.focus(), { once: true });
    }

    /**
     * Open the old creations. Quietly does nothing when there are none and
     * `onlyIfAny` is set: the call made after signing in.
     */
    async openLegacy({ onlyIfAny = false } = {}) {
        let items;
        try {
            items = await this.account.legacyList();
        } catch (error) {
            if (!onlyIfAny) this.onStatus(this.errorText(error));
            return;
        }
        this._items = items;
        this._markWaiting();
        if (onlyIfAny && items.length === 0) return;

        this._message(
            this.el.legacyMessage,
            items.length ? null : translateOr('account.legacyNone', 'Nothing is waiting for you: everything from the old site is already here.')
        );
        this._renderList();
        this._modal(this.el.legacyModal).show();
    }

    /** Whether anything is waiting, shown as a dot on the menu. Opens nothing. */
    async checkWaiting() {
        try {
            this._items = await this.account.legacyList();
        } catch {
            this._items = [];
        }
        this._markWaiting();
    }

    // ── Signing in ───────────────────────────────────────────────────────

    async _sendLink() {
        const email = this.el.input.value.trim();
        if (!EMAIL.test(email)) {
            this._message(this.el.signInMessage, translateOr('account.invalidEmail', 'That does not look like an email address.'), 'bad');
            return;
        }
        this.el.send.disabled = true;
        try {
            await this.account.requestLink(email, this.returnUrl);
            this._email = email;
            this._message(
                this.el.signInMessage,
                this.codeFirst
                    ? translateOr('account.sentCode', 'Check your inbox: an email to {email} is on its way. Type the code it contains below.', { email })
                    : translateOr('account.sent', 'Check your inbox: a link to {email} is on its way. It works once, for 15 minutes.', { email }),
                'good'
            );
            this.el.codeStep.classList.remove('d-none');
            if (this.codeFirst) this.el.code.focus();
        } catch (error) {
            this.el.send.disabled = false;
            this._message(this.el.signInMessage, this.errorText(error), 'bad');
        }
    }

    async _verifyCode() {
        const code = this.el.code.value.replace(/\s+/g, '');
        if (!/^\d{6}$/.test(code)) {
            this._message(this.el.signInMessage, translateOr('account.codeFormat', 'The code is six digits.'), 'bad');
            return;
        }
        this.el.codeSubmit.disabled = true;
        try {
            await this.account.verifyCode(this._email, code);
            this._modal(this.el.signInModal).hide();
            this.onStatus(translateOr('account.signedIn', 'Signed in as {email}', { email: this.account.user.email }));
            this.onSignedIn();
        } catch (error) {
            this._message(
                this.el.signInMessage,
                error?.status === 0 || error?.status === 429
                    ? this.errorText(error)
                    : translateOr('account.codeWrong', 'This code is wrong or has expired. Check it, or ask for a new email.'),
                'bad'
            );
        } finally {
            this.el.codeSubmit.disabled = false;
        }
    }

    _render() {
        const user = this.account.user;
        this.el.signIn.classList.toggle('d-none', Boolean(user));
        this.el.menu.classList.toggle('d-none', !user);
        this.el.name.textContent = user ? user.display_name || (user.handle ? `@${user.handle}` : user.email) : '';
        this.el.email.textContent = user ? user.email : '';
        if (!user) {
            this._items = [];
            this._markWaiting();
        }
    }

    // ── The old creations ────────────────────────────────────────────────

    _renderList() {
        const groups = KIND_ORDER.map((kind) => [kind, this._items.filter((item) => item.kind === kind)]).filter(
            ([, items]) => items.length > 0
        );
        this.el.allWrap.classList.toggle('d-none', this._items.length === 0);
        this.el.all.checked = true;

        this.el.list.innerHTML = groups
            .map(([kind, items]) => {
                const [key, fallback] = KIND_LABELS[kind];
                const rows = items
                    .map(
                        (item) => `
                    <div class="form-check">
                        <input class="form-check-input" type="checkbox" id="legacy-${item.id}" value="${item.id}" checked />
                        <label class="form-check-label small" for="legacy-${item.id}">
                            ${escapeHtml(item.name)}
                            ${item.category ? `<span class="text-muted">· ${escapeHtml(item.category)}</span>` : ''}
                            ${item.was_public ? `<span class="badge bg-success-subtle text-success-emphasis ms-1">${escapeHtml(translateOr('account.legacyWasPublic', 'was shared'))}</span>` : ''}
                        </label>
                    </div>`
                    )
                    .join('');
                return `<div class="account-legacy-group"><h6>${escapeHtml(translateOr(key, fallback))} (${items.length})</h6>${rows}</div>`;
            })
            .join('');
        this._syncImportButton();
    }

    async _importChecked() {
        const ids = this._boxes()
            .filter((box) => box.checked)
            .map((box) => Number(box.value));
        if (ids.length === 0) return;

        this.el.import.disabled = true;
        for (const box of this._boxes()) box.disabled = true;
        const { imported, failed } = await importLegacyItems({
            account: this.account,
            library: this.library,
            ids,
            onProgress: (done, total) =>
                this._message(this.el.legacyMessage, translateOr('account.legacyImporting', 'Importing {done} of {total}…', { done, total }))
        });

        const lines = [];
        if (imported.length) lines.push(translateOr('account.legacyDone', '{count} imported into your library.', { count: imported.length }));
        if (failed.length) {
            lines.push(
                translateOr('account.legacyFailed', '{count} could not be imported and stay on the server for another try.', {
                    count: failed.length
                })
            );
        }

        // What was forgotten leaves the list; what was not stays, checkable.
        const gone = new Set(imported.filter((item) => item.forgotten).map((item) => item.id));
        this._items = this._items.filter((item) => !gone.has(item.id));
        this._renderList();
        this._markWaiting();
        this._message(this.el.legacyMessage, lines.join(' '), failed.length ? 'bad' : 'good');
        if (imported.length) this.onStatus(lines[0]);
    }

    _boxes() {
        return [...this.el.list.querySelectorAll('input[type="checkbox"]')];
    }

    _syncImportButton() {
        const count = this._boxes().filter((box) => box.checked && !box.disabled).length;
        this.el.importLabel.textContent = translateOr('account.legacyImport', 'Import {count}', { count });
        this.el.import.disabled = count === 0;
        this.el.import.classList.toggle('d-none', this._items.length === 0);
    }

    _markWaiting() {
        this.el.dot.classList.toggle('d-none', this._items.length === 0);
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    /**
     * Why a sign-in link did not work. The API refuses a used, expired or
     * unknown link in more than one way; to the person holding it they are
     * all the same thing, and the same remedy.
     */
    linkErrorText(error) {
        if (error?.status === 0 || error?.status === 429) return this.errorText(error);
        return translateOr('account.linkExpired', 'This sign-in link has expired or was already used. Ask for a new one.');
    }

    errorText(error) {
        if (error?.status === 0) {
            return translateOr('account.offline', 'The 8BitForge server could not be reached. Check your connection and try again.');
        }
        if (error?.status === 429) return translateOr('account.tooMany', 'Too many requests. Wait a little and try again.');
        return error?.message || String(error);
    }

    _message(element, text, tone = null) {
        element.textContent = text || '';
        element.classList.toggle('d-none', !text);
        element.classList.toggle('text-success', tone === 'good');
        element.classList.toggle('text-danger', tone === 'bad');
    }

    _modal(element) {
        return window.bootstrap.Modal.getOrCreateInstance(element);
    }
}
