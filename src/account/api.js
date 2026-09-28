/**
 * The 8BitForge API, as the studio calls it.
 *
 * Only the account and what the old site kept: signing in by emailed link,
 * keeping the session alive, and handing back old creations. Every call is
 * one fetch with a JSON body; nothing here keeps state, `Account` does.
 */

/** A refusal from the API, or no answer at all (status 0). */
export class ApiError extends Error {
    /**
     * @param {number} status  HTTP status, 0 when the API could not be reached
     * @param {string} message what the API said, in English
     */
    constructor(status, message) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
    }
}

export class AccountApi {
    /**
     * @param {object} options
     * @param {string} options.baseUrl  e.g. https://api.8bitforge.com
     * @param {typeof fetch} [options.fetch]
     */
    constructor({ baseUrl, fetch: fetchImpl = (...args) => globalThis.fetch(...args) }) {
        this.baseUrl = baseUrl.replace(/\/+$/, '');
        this._fetch = fetchImpl;
    }

    /** Ask for a sign-in link. The answer is the same whether the address has an account or not. */
    requestLink(email, returnUrl) {
        return this._call('POST', '/v1/auth/magic-link', { body: { email, return_url: returnUrl } });
    }

    /** Exchange the token from a link for a session. Creates the account on its first use. */
    verify(token) {
        return this._call('POST', '/v1/auth/magic-link/verify', { body: { token } });
    }

    /** Exchange the six-digit code from the same email for a session. */
    verifyCode(email, code) {
        return this._call('POST', '/v1/auth/code/verify', { body: { email, code } });
    }

    /** A new session for the refresh token, which is spent. */
    refresh(refreshToken) {
        return this._call('POST', '/v1/auth/refresh', { body: { refresh_token: refreshToken } });
    }

    logout(refreshToken) {
        return this._call('POST', '/v1/auth/logout', { body: { refresh_token: refreshToken } });
    }

    me(accessToken) {
        return this._call('GET', '/v1/me', { token: accessToken });
    }

    /** Change the public profile: any of handle, display_name, bio. */
    updateProfile(accessToken, fields) {
        return this._call('PATCH', '/v1/me', { token: accessToken, body: fields });
    }

    /** Whether a handle can be had, and why not. */
    handleCheck(handle) {
        return this._call('GET', `/v1/handles/${encodeURIComponent(handle)}`);
    }

    /** Sources people shared. Anyone may look. */
    sharedList({ kind = '', user = '', q = '', page = 1 } = {}) {
        const query = Object.entries({ kind, user, q, page: page > 1 ? page : '' })
            .filter(([, value]) => value !== '' && value != null)
            .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
            .join('&');
        return this._call('GET', `/v1/shared${query ? `?${query}` : ''}`);
    }

    /** One shared source, with its file. */
    sharedGet(id) {
        return this._call('GET', `/v1/shared/${encodeURIComponent(id)}`);
    }

    /** Share a source: { kind, license, description, file }. */
    sharedCreate(accessToken, source) {
        return this._call('POST', '/v1/shared', { token: accessToken, body: source });
    }

    sharedRemove(accessToken, id) {
        return this._call('DELETE', `/v1/shared/${encodeURIComponent(id)}`, { token: accessToken });
    }

    /** What the old site kept for this account: names, no payloads. */
    legacyList(accessToken) {
        return this._call('GET', '/v1/me/legacy', { token: accessToken });
    }

    /** One old creation, as the file the studio opens. */
    legacyTake(accessToken, id) {
        return this._call('GET', `/v1/me/legacy/${encodeURIComponent(id)}`, { token: accessToken });
    }

    /** Tell the API it can forget one, now that it is safe here. */
    legacyForget(accessToken, id) {
        return this._call('DELETE', `/v1/me/legacy/${encodeURIComponent(id)}`, { token: accessToken });
    }

    async _call(method, path, { body = null, token = null } = {}) {
        const headers = { Accept: 'application/json' };
        if (body) headers['Content-Type'] = 'application/json';
        if (token) headers.Authorization = `Bearer ${token}`;

        let response;
        try {
            response = await this._fetch(this.baseUrl + path, {
                method,
                headers,
                body: body ? JSON.stringify(body) : undefined,
                // No cookie goes either way: the session is the tokens.
                credentials: 'omit'
            });
        } catch {
            throw new ApiError(0, 'The 8BitForge server could not be reached.');
        }

        let data = null;
        try {
            data = await response.json();
        } catch {
            data = null;
        }
        if (!response.ok) {
            throw new ApiError(response.status, data?.error || `The server answered ${response.status}.`);
        }
        return data ?? {};
    }
}
