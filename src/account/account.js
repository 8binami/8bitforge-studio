/**
 * The signed-in account, if there is one.
 *
 * Optional through and through: the studio works the same with nobody signed
 * in, and this never contacts the API on its own until someone has signed in
 * at least once: asking for a link, or arriving with one.
 *
 * The session is two tokens. The access token lives only in memory and lasts
 * fifteen minutes; the refresh token is kept in the browser so a reload does
 * not sign anyone out, and is spent every time it is used. Spending the same
 * one twice is how the API recognises a stolen token, and it answers by
 * ending every session of the account: so two refreshes are never allowed
 * to run at once, however many calls want one.
 */

import { bus as sharedBus } from '../core/event-bus.js';
import { ApiError } from './api.js';

export const ACCOUNT_EVENTS = Object.freeze({
    /** The account signed in, signed out, or changed. Payload: { user } */
    changed: 'account:changed'
});

/** The query parameter a sign-in link arrives with. */
export const LINK_PARAM = 'magic_token';

const REFRESH_KEY = '8bitforge.account.refresh';

/** Refresh a little before the access token runs out, not after. */
const EARLY_MS = 30_000;

export class Account {
    /**
     * @param {object} options
     * @param {import('./api.js').AccountApi} options.api
     * @param {{getItem: Function, setItem: Function, removeItem: Function}|null} [options.storage]
     * @param {import('../core/event-bus.js').EventBus} [options.bus]
     * @param {() => number} [options.clock]
     */
    constructor({ api, storage = defaultStorage(), bus = sharedBus, clock = () => Date.now() }) {
        this.api = api;
        this.storage = storage;
        this.bus = bus;
        this.clock = clock;

        this._user = null;
        this._access = null;
        this._accessUntil = 0;
        this._refreshing = null;
        // Where the refresh token lives when the browser refuses storage.
        this._kept = null;
    }

    /** @returns {{id: number, email: string, display_name: string|null}|null} */
    get user() {
        return this._user;
    }

    get signedIn() {
        return this._user !== null;
    }

    /** Whether a session was kept from an earlier visit. No network. */
    get hasStoredSession() {
        return Boolean(this._read());
    }

    /**
     * Pick up the session an earlier visit left. Signed out, and the stored
     * token dropped, only if the API refuses it; offline, it is kept for later.
     * @returns {Promise<boolean>} signed in
     */
    async resume() {
        if (!this._read()) return false;
        try {
            await this._refresh();
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Email a sign-in link. It brings the person back to `returnUrl`.
     * @returns {Promise<void>}
     */
    async requestLink(email, returnUrl) {
        await this.api.requestLink(String(email).trim(), returnUrl);
    }

    /**
     * Sign in with the token a link arrived with, if the address carries one.
     *
     * The token is taken out of the address before anything else, so it is
     * not left in the history, a bookmark or a screenshot whatever happens
     * next: `clean` is the address without it, for `history.replaceState`.
     *
     * @param {string} href the page's address
     * @returns {Promise<{clean: string, signedIn: boolean, error: ApiError|null}|null>} null when there is no token
     */
    async consumeLink(href) {
        const url = new URL(href);
        const token = url.searchParams.get(LINK_PARAM);
        if (token === null) return null;

        url.searchParams.delete(LINK_PARAM);
        const clean = url.toString();
        if (!token) return { clean, signedIn: false, error: new ApiError(400, 'The link has no token.') };

        try {
            this._open(await this.api.verify(token));
            return { clean, signedIn: true, error: null };
        } catch (error) {
            return { clean, signedIn: false, error: toApiError(error) };
        }
    }

    /**
     * Sign in with the six-digit code the email carries: where a link cannot
     * open, like the desktop app.
     * @returns {Promise<void>} rejects with the API's refusal
     */
    async verifyCode(email, code) {
        this._open(await this.api.verifyCode(String(email).trim(), String(code).replace(/\s+/g, '')));
    }

    /**
     * Change the public profile. The account's user is replaced by what the
     * API answers, so everyone listening sees the new handle or name.
     * @param {{handle?: string, display_name?: string|null, bio?: string|null}} fields
     */
    async updateProfile(fields) {
        const { user } = await this.withAccess((token) => this.api.updateProfile(token, fields));
        this._user = user;
        this.bus.emit(ACCOUNT_EVENTS.changed, { user });
        return user;
    }

    /** Share a source. Needs a handle. */
    share(source) {
        return this.withAccess((token) => this.api.sharedCreate(token, source));
    }

    unshare(id) {
        return this.withAccess((token) => this.api.sharedRemove(token, id));
    }

    /** Sign out here, and end the session on the server when it can be reached. */
    async signOut() {
        const refresh = this._read();
        this._close();
        if (refresh) {
            try {
                await this.api.logout(refresh);
            } catch {
                // Signed out here either way; the token expires on its own.
            }
        }
    }

    /**
     * Call the API with a valid access token, refreshing it when it has run
     * out, and once more if the API still says it has.
     *
     * @template T
     * @param {(accessToken: string) => Promise<T>} call
     * @returns {Promise<T>}
     */
    async withAccess(call) {
        if (!this._access || this.clock() >= this._accessUntil - EARLY_MS) await this._refresh();
        try {
            return await call(this._access);
        } catch (error) {
            if (!(error instanceof ApiError) || error.status !== 401) throw error;
            await this._refresh();
            return call(this._access);
        }
    }

    // ── What the old site kept ───────────────────────────────────────────

    /** @returns {Promise<Array<{id: number, kind: string, name: string, category: string|null, was_public: boolean, updated_at: number}>>} */
    async legacyList() {
        const { items } = await this.withAccess((token) => this.api.legacyList(token));
        return Array.isArray(items) ? items : [];
    }

    /** @returns {Promise<{id: number, kind: string, file: object}>} */
    legacyTake(id) {
        return this.withAccess((token) => this.api.legacyTake(token, id));
    }

    legacyForget(id) {
        return this.withAccess((token) => this.api.legacyForget(token, id));
    }

    // ── Internals ────────────────────────────────────────────────────────

    /** One refresh at a time: every caller waits on the same one. */
    _refresh() {
        if (!this._refreshing) {
            this._refreshing = this._doRefresh().finally(() => {
                this._refreshing = null;
            });
        }
        return this._refreshing;
    }

    async _doRefresh() {
        // Read now rather than remembered: another tab may have spent it and
        // stored the next one.
        const refresh = this._read();
        if (!refresh) {
            this._close();
            throw new ApiError(401, 'Please sign in.');
        }
        try {
            this._open(await this.api.refresh(refresh));
        } catch (error) {
            const apiError = toApiError(error);
            // Offline is not signed out: the token is still good for later.
            if (apiError.status !== 0) this._close();
            throw apiError;
        }
    }

    _open(session) {
        if (!session?.access_token || !session?.refresh_token || !session?.user) {
            throw new ApiError(500, 'The server answered without a session.');
        }
        this._access = session.access_token;
        this._accessUntil = this.clock() + (Number(session.expires_in) || 0) * 1000;
        this._write(session.refresh_token);

        const changed = this._user?.id !== session.user.id || this._user?.email !== session.user.email;
        this._user = session.user;
        if (changed) this.bus.emit(ACCOUNT_EVENTS.changed, { user: this._user });
    }

    _close() {
        const was = this._user;
        this._user = null;
        this._access = null;
        this._accessUntil = 0;
        this._write(null);
        if (was) this.bus.emit(ACCOUNT_EVENTS.changed, { user: null });
    }

    _read() {
        try {
            return this.storage?.getItem(REFRESH_KEY) || this._kept;
        } catch {
            return this._kept;
        }
    }

    _write(value) {
        this._kept = value || null;
        try {
            if (value) this.storage?.setItem(REFRESH_KEY, value);
            else this.storage?.removeItem(REFRESH_KEY);
        } catch {
            // A private window may refuse storage: the session then lasts
            // until the tab closes, which is the most it can do.
        }
    }
}

function toApiError(error) {
    return error instanceof ApiError ? error : new ApiError(0, String(error?.message || error));
}

function defaultStorage() {
    try {
        return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
        return null;
    }
}
