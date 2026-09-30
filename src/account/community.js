/**
 * What the library windows do with the community, and with files.
 *
 * One place for the four things every window offers on a row or in its
 * toolbar: take something the community shared, share one of one's own,
 * export a file, import one. The windows only draw the buttons.
 *
 * Browsing and taking need no account; sharing does, and a handle, both of
 * which are made on the site: so a window that needs one opens it. Export
 * and import touch no network at all: they work in every build.
 */

import { importIntoLibrary } from './legacy-import.js';
import { LIBRARY_KINDS } from '../storage/library.js';
import { ACCOUNT_EVENTS } from './account.js';
import { translateOr } from '../i18n/i18n.js';

export const SITE_URL = 'https://8bitforge.com';

/** The query parameter the site's "Open in the studio" links carry. */
export const SHARED_PARAM = 'shared';

/** Raised by share() when the account has no handle yet: the site sets one. */
export class NeedsHandle extends Error {
    constructor() {
        super('Choose a username on 8bitforge.com first.');
        this.name = 'NeedsHandle';
    }
}

/** Raised by share() when nobody is signed in. */
export class NeedsSignIn extends Error {
    constructor() {
        super('Sign in to share.');
        this.name = 'NeedsSignIn';
    }
}

export class Community {
    /**
     * @param {object} options
     * @param {import('../storage/library.js').Library} options.library
     * @param {import('../platform/index.js').Platform} options.platform
     * @param {import('./api.js').AccountApi|null} [options.api]       null when this build has no account
     * @param {import('./account.js').Account|null} [options.account]
     * @param {import('../core/event-bus.js').EventBus} [options.bus]
     * @param {() => string} [options.language]  the interface language, for site links
     * @param {(url: string) => void} [options.openUrl]
     * @param {(text: string) => void} [options.onStatus]
     */
    constructor({
        library,
        platform,
        api = null,
        account = null,
        bus = null,
        language = () => 'en',
        openUrl = (url) => window.open(url, '_blank', 'noopener'),
        onStatus = () => {}
    }) {
        this.library = library;
        this.platform = platform;
        this.api = api;
        this.account = account;
        this.bus = bus;
        this.language = language;
        this.openUrl = openUrl;
        this.onStatus = onStatus;
        /** Asks for a licence and a description before sharing: the Share window. */
        this.shareDialog = null;
    }

    /**
     * Plug the account in. The windows are built before it, since exporting
     * and importing need none; this tells them the community may be there.
     */
    connect({ api, account, shareDialog = null }) {
        this.api = api;
        this.account = account;
        this.shareDialog = shareDialog;
        this.bus?.emit(ACCOUNT_EVENTS.changed, { user: account?.user ?? null });
    }

    /**
     * Whether the community can be browsed from here: in a build with the
     * account, signed in or not. Looking at what people shared and taking it
     * asks the API for nothing private, so it needs no account: only sharing
     * does (`canShare`).
     */
    get available() {
        return Boolean(this.api);
    }

    /** Whether one's own can be shared from here: signed in, in a build with the account. */
    get canShare() {
        return Boolean(this.api && this.account?.signedIn);
    }

    /** Whether this build has the account at all. */
    get enabled() {
        return Boolean(this.api && this.account);
    }

    /** Call back whenever `available` or `canShare` may have changed. */
    onChange(callback) {
        return this.bus?.on(ACCOUNT_EVENTS.changed, callback) ?? (() => {});
    }

    // ── The site ─────────────────────────────────────────────────────────

    /** An address on 8bitforge.com, in the interface's language. */
    siteUrl(path = '') {
        const lang = /^[a-z]{2}$/.test(this.language()) ? this.language() : 'en';
        return `${SITE_URL}/${lang}/${path}`;
    }

    openSite(path = '') {
        this.openUrl(this.siteUrl(path));
    }

    // ── The community ────────────────────────────────────────────────────

    /**
     * What people shared of one kind, as rows a window can draw.
     * @param {string} kind a library kind
     * @param {{q?: string, page?: number}} [filters]
     */
    async list(kind, { q = '', page = 1 } = {}) {
        const { items = [], more = false } = await this.api.sharedList({ kind, q, page });
        return { items, more };
    }

    /** One shared source and its file, without keeping it anywhere. */
    get(sharedId) {
        return this.api.sharedGet(sharedId);
    }

    /**
     * Bring one shared source into the library.
     * @returns {Promise<{kind: string, name: string, id: string}>}
     */
    async take(sharedId) {
        const { item, file } = await this.api.sharedGet(sharedId);
        const { id, name } = await importIntoLibrary(this.library, item.kind, file);
        return { kind: item.kind, name, id };
    }

    /**
     * Share one of one's own, as it is in the library.
     * @param {string} kind
     * @param {string} id
     * @param {{license?: 'CC-BY-4.0'|'CC0-1.0', description?: string|null}} [options]
     */
    async share(kind, id, { license = 'CC-BY-4.0', description = null } = {}) {
        if (!this.account?.signedIn) throw new NeedsSignIn();
        if (!this.account.user?.handle) throw new NeedsHandle();
        const file = await this._file(kind, id);
        const { item } = await this.account.share({ kind, license, description, file });
        return item;
    }

    /**
     * What a Share button does: the Share window for that item, or the site
     * when there is no username yet to put it under.
     */
    async requestShare(kind, id) {
        if (!this.canShare) return;
        if (!this.account.user?.handle) {
            this.askForHandle();
            return;
        }
        if (this.shareDialog) await this.shareDialog.open({ kind, id });
        else await this.share(kind, id);
    }

    /** A username is made on the site's account page: say so, and open it. */
    askForHandle() {
        this.onStatus(
            translateOr('community.needHandle', 'Choose a username on 8bitforge.com first: what you share appears on your profile.')
        );
        this.openSite('account');
    }

    // ── Files ────────────────────────────────────────────────────────────

    /** Save one item of the library as a file, wherever the platform saves. */
    async exportItem(kind, id) {
        const exported = await this.library.exportItem(kind, id);
        if (!exported) return null;
        await this.platform.saveFile(exported.name, new Blob([exported.contents], { type: 'application/json' }));
        return exported.name;
    }

    /**
     * Ask for files and import them into the library as `kind`.
     * @returns {Promise<{imported: string[], failed: Array<{file: string, error: Error}>}>}
     */
    async importFiles(kind) {
        const files = await pickFiles(kind === LIBRARY_KINDS.projects ? '.8bitforge,.json' : '.json');
        const imported = [];
        const failed = [];
        for (const file of files) {
            try {
                const contents = await file.text();
                const { name } =
                    kind === LIBRARY_KINDS.projects
                        ? await this.library.importProject(contents)
                        : await this.library.importItem(kind, contents);
                imported.push(name);
            } catch (error) {
                failed.push({ file: file.name, error });
            }
        }
        return { imported, failed };
    }

    async _file(kind, id) {
        if (kind === LIBRARY_KINDS.projects) return (await this.library.readProject(id))?.file ?? null;
        return this.library.read(kind, id);
    }
}

/** A file picker that works in the browser and in the desktop window alike. */
function pickFiles(accept) {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept;
        input.multiple = true;
        input.style.display = 'none';
        input.addEventListener('change', () => {
            resolve([...(input.files ?? [])]);
            input.remove();
        });
        // Cancelling fires no change; the promise simply never settles,
        // which leaves nothing waiting on it but a closure.
        document.body.append(input);
        input.click();
    });
}
