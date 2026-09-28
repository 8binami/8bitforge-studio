import { describe, it, expect, vi } from 'vitest';
import { Account, ACCOUNT_EVENTS } from '../src/account/account.js';
import { AccountApi, ApiError } from '../src/account/api.js';
import { importLegacyItem, importLegacyItems } from '../src/account/legacy-import.js';
import { EventBus } from '../src/core/event-bus.js';
import { Library, LIBRARY_KINDS } from '../src/storage/library.js';
import { MemoryBackend } from '../src/storage/memory-backend.js';

const USER = { id: 7, email: 'ada@example.com', display_name: null, created_at: 1 };

function session(n = 1, expiresIn = 900) {
    return { access_token: `access-${n}`, expires_in: expiresIn, refresh_token: `refresh-${n}`, user: USER };
}

function memoryStorage(initial = {}) {
    const data = new Map(Object.entries(initial));
    return {
        data,
        getItem: (key) => (data.has(key) ? data.get(key) : null),
        setItem: (key, value) => data.set(key, String(value)),
        removeItem: (key) => data.delete(key)
    };
}

/** An API that answers from the test, and counts. */
function fakeApi(overrides = {}) {
    let issued = 1;
    return {
        requestLink: vi.fn(async () => ({ sent: true })),
        verify: vi.fn(async () => session(issued++)),
        refresh: vi.fn(async () => session(++issued)),
        logout: vi.fn(async () => ({ signed_out: true })),
        me: vi.fn(async () => ({ user: USER })),
        legacyList: vi.fn(async () => ({ items: [] })),
        legacyTake: vi.fn(),
        legacyForget: vi.fn(async () => ({ forgotten: true })),
        ...overrides
    };
}

function make({ api = fakeApi(), storage = memoryStorage(), now = 1_000_000 } = {}) {
    const bus = new EventBus();
    const changes = [];
    bus.on(ACCOUNT_EVENTS.changed, ({ user }) => changes.push(user));
    const clock = { now };
    const account = new Account({ api, storage, bus, clock: () => clock.now });
    return { account, api, storage, bus, changes, clock };
}

const KEY = '8bitforge.account.refresh';

describe('Account: arriving by a sign-in link', () => {
    it('does nothing, and calls nobody, when the address has no token', async () => {
        const { account, api } = make();
        expect(await account.consumeLink('https://studio.8bitforge.com/?lang=fr')).toBeNull();
        expect(api.verify).not.toHaveBeenCalled();
    });

    it('signs in, keeps the refresh token, and says so', async () => {
        const { account, api, storage, changes } = make();
        const result = await account.consumeLink('https://studio.8bitforge.com/?magic_token=abc');

        expect(api.verify).toHaveBeenCalledWith('abc');
        expect(result.signedIn).toBe(true);
        expect(account.user).toEqual(USER);
        expect(storage.data.get(KEY)).toBe('refresh-1');
        expect(changes).toEqual([USER]);
    });

    it('takes the token out of the address, and only the token', async () => {
        const { account } = make();
        const { clean } = await account.consumeLink('https://studio.8bitforge.com/app?lang=fr&magic_token=abc#mixer');
        expect(clean).toBe('https://studio.8bitforge.com/app?lang=fr#mixer');
    });

    it('takes the token out of the address even when the link is refused', async () => {
        const api = fakeApi({ verify: vi.fn(async () => { throw new ApiError(401, 'This link has expired or was already used.'); }) });
        const { account, storage } = make({ api });
        const result = await account.consumeLink('https://studio.8bitforge.com/?magic_token=old');

        expect(result.clean).toBe('https://studio.8bitforge.com/');
        expect(result.signedIn).toBe(false);
        expect(result.error.status).toBe(401);
        expect(account.signedIn).toBe(false);
        expect(storage.data.has(KEY)).toBe(false);
    });
});

describe('Account: keeping the session', () => {
    it('never calls the API on its own when nobody ever signed in', async () => {
        const { account, api } = make();
        expect(account.hasStoredSession).toBe(false);
        expect(await account.resume()).toBe(false);
        expect(api.refresh).not.toHaveBeenCalled();
    });

    it('picks up the session a reload left behind', async () => {
        const { account, api } = make({ storage: memoryStorage({ [KEY]: 'refresh-kept' }) });
        expect(await account.resume()).toBe(true);
        expect(api.refresh).toHaveBeenCalledWith('refresh-kept');
        expect(account.user).toEqual(USER);
    });

    it('refreshes a token that has run out before calling', async () => {
        const { account, api, clock } = make();
        await account.consumeLink('https://s.test/?magic_token=t');
        clock.now += 900_000;

        const seen = [];
        await account.withAccess(async (token) => seen.push(token));
        expect(api.refresh).toHaveBeenCalledTimes(1);
        expect(seen).toEqual(['access-3']);
    });

    it('does not refresh a token that is still good', async () => {
        const { account, api, clock } = make();
        await account.consumeLink('https://s.test/?magic_token=t');
        clock.now += 60_000;
        await account.withAccess(async () => {});
        expect(api.refresh).not.toHaveBeenCalled();
    });

    it('refreshes once, however many calls need it at the same moment', async () => {
        // Spending one refresh token twice is what a thief does, and the API
        // answers by ending every session of the account.
        let release;
        const gate = new Promise((resolve) => (release = resolve));
        const api = fakeApi({ refresh: vi.fn(async () => { await gate; return session(9); }) });
        const { account, clock } = make({ api });
        await account.consumeLink('https://s.test/?magic_token=t');
        clock.now += 900_000;

        const calls = [1, 2, 3].map(() => account.withAccess(async (token) => token));
        release();
        expect(await Promise.all(calls)).toEqual(['access-9', 'access-9', 'access-9']);
        expect(api.refresh).toHaveBeenCalledTimes(1);
    });

    it('refreshes and tries once more when the API refuses the access token', async () => {
        const { account, api } = make();
        await account.consumeLink('https://s.test/?magic_token=t');
        let first = true;
        const result = await account.withAccess(async (token) => {
            if (first) { first = false; throw new ApiError(401, 'Please sign in.'); }
            return token;
        });
        expect(result).toBe('access-3');
        expect(api.refresh).toHaveBeenCalledTimes(1);
    });

    it('signs out when the refresh token is refused', async () => {
        const api = fakeApi({ refresh: vi.fn(async () => { throw new ApiError(401, 'Please sign in.'); }) });
        const { account, storage, changes, clock } = make({ api });
        await account.consumeLink('https://s.test/?magic_token=t');
        clock.now += 900_000;

        await expect(account.withAccess(async () => 'x')).rejects.toMatchObject({ status: 401 });
        expect(account.signedIn).toBe(false);
        expect(storage.data.has(KEY)).toBe(false);
        expect(changes).toEqual([USER, null]);
    });

    it('keeps the refresh token when the API cannot be reached', async () => {
        const api = fakeApi({ refresh: vi.fn(async () => { throw new ApiError(0, 'offline'); }) });
        const { account, storage } = make({ api, storage: memoryStorage({ [KEY]: 'refresh-kept' }) });
        expect(await account.resume()).toBe(false);
        expect(storage.data.get(KEY)).toBe('refresh-kept');
    });

    it('works in a window that refuses storage, for as long as the tab lives', async () => {
        const refusing = {
            getItem: () => { throw new Error('SecurityError'); },
            setItem: () => { throw new Error('SecurityError'); },
            removeItem: () => { throw new Error('SecurityError'); }
        };
        const { account, api, clock } = make({ storage: refusing });
        await account.consumeLink('https://s.test/?magic_token=t');
        clock.now += 900_000;
        await account.withAccess(async () => {});
        expect(api.refresh).toHaveBeenCalledWith('refresh-1');
        expect(account.signedIn).toBe(true);
    });

    it('signs out here and on the server, and here even when the server is away', async () => {
        const { account, api, storage } = make();
        await account.consumeLink('https://s.test/?magic_token=t');
        await account.signOut();
        expect(api.logout).toHaveBeenCalledWith('refresh-1');
        expect(account.signedIn).toBe(false);
        expect(storage.data.has(KEY)).toBe(false);

        const away = make({ api: fakeApi({ logout: vi.fn(async () => { throw new ApiError(0, 'offline'); }) }) });
        await away.account.consumeLink('https://s.test/?magic_token=t');
        await away.account.signOut();
        expect(away.account.signedIn).toBe(false);
    });
});

describe('AccountApi', () => {
    function recorder(reply = { ok: true, status: 200, body: { sent: true } }) {
        const calls = [];
        const fetch = vi.fn(async (url, init) => {
            calls.push({ url, ...init });
            if (reply instanceof Error) throw reply;
            return { ok: reply.ok, status: reply.status, json: async () => reply.body };
        });
        return { calls, api: new AccountApi({ baseUrl: 'https://api.8bitforge.com/', fetch }) };
    }

    it('asks for a link with the address to come back to, and no cookie', async () => {
        const { calls, api } = recorder();
        await api.requestLink('ada@example.com', 'https://studio.8bitforge.com/');
        expect(calls[0].url).toBe('https://api.8bitforge.com/v1/auth/magic-link');
        expect(calls[0].method).toBe('POST');
        expect(JSON.parse(calls[0].body)).toEqual({ email: 'ada@example.com', return_url: 'https://studio.8bitforge.com/' });
        expect(calls[0].credentials).toBe('omit');
    });

    it('sends the access token as a bearer, and nothing else that identifies', async () => {
        const { calls, api } = recorder({ ok: true, status: 200, body: { items: [] } });
        await api.legacyList('tok');
        expect(calls[0].headers.Authorization).toBe('Bearer tok');
        expect(calls[0].body).toBeUndefined();
        await api.legacyForget('tok', 12);
        expect(calls[1].method).toBe('DELETE');
        expect(calls[1].url).toBe('https://api.8bitforge.com/v1/me/legacy/12');
    });

    it("turns a refusal into an ApiError with the server's words", async () => {
        const { api } = recorder({ ok: false, status: 429, body: { error: 'Too many requests.' } });
        await expect(api.requestLink('a@b.c', 'x')).rejects.toMatchObject({ status: 429, message: 'Too many requests.' });
    });

    it('turns no answer at all into status 0', async () => {
        const { api } = recorder(new TypeError('Failed to fetch'));
        await expect(api.me('t')).rejects.toMatchObject({ status: 0 });
    });
});

describe('Bringing old creations into the library', () => {
    const projectFile = {
        format: '8bit-forge', version: '1.4', name: 'Forest Theme', category: 'rpg', tags: [], meta: {},
        cover: null, createdAt: '2026-03-10T12:00:00.000Z', updatedAt: '2026-03-11T12:00:00.000Z',
        data: { version: '1.2', tracks: [{ volume: 1 }], sequencer: { bpm: 120 } }
    };
    const presetFile = {
        format: '8bit-forge-item', version: '1.0', kind: 'presets', name: 'My Lead', category: 'leads', tags: [],
        cover: null, data: { type: 'square', volume: 0.2, envelope: { attack: 0, decay: 0.1, sustain: 0.5, release: 0.2 }, vibrato: { rate: 0, depth: 0 } }
    };

    async function setup(files) {
        const api = fakeApi({
            legacyTake: vi.fn(async (_token, id) => files[id]),
            legacyForget: vi.fn(async () => ({ forgotten: true }))
        });
        const { account } = make({ api });
        await account.consumeLink('https://s.test/?magic_token=t');
        const library = new Library(new MemoryBackend(), { bus: new EventBus() });
        return { account, api, library };
    }

    it('a project lands among the projects, upgraded, and the server forgets it after', async () => {
        const { account, api, library } = await setup({ 1: { id: 1, kind: 'projects', file: projectFile } });
        const order = [];
        const importProject = library.importProject.bind(library);
        library.importProject = async (...args) => { order.push('import'); return importProject(...args); };
        api.legacyForget.mockImplementation(async () => { order.push('forget'); return { forgotten: true }; });

        expect(await importLegacyItem({ account, library, id: 1 })).toEqual({ kind: 'projects', name: 'Forest Theme', forgotten: true });
        expect(order).toEqual(['import', 'forget']);
        const [listed] = await library.listProjects();
        const { file } = await library.readProject(listed.id);
        expect(file.version).toBe('2.0');
        expect(file.name).toBe('Forest Theme');
    });

    it('a preset lands among the presets', async () => {
        const { account, library } = await setup({ 2: { id: 2, kind: 'presets', file: presetFile } });
        await importLegacyItem({ account, library, id: 2 });
        const listed = await library.list(LIBRARY_KINDS.presets);
        expect(listed.map((item) => item.name)).toEqual(['My Lead']);
    });

    it('the server is not told to forget what the library could not take', async () => {
        const { account, api, library } = await setup({ 3: { id: 3, kind: 'projects', file: { format: 'nonsense' } } });
        await expect(importLegacyItem({ account, library, id: 3 })).rejects.toThrow();
        expect(api.legacyForget).not.toHaveBeenCalled();
    });

    it('an item the server could not forget is still imported, and says so', async () => {
        const { account, api, library } = await setup({ 2: { id: 2, kind: 'presets', file: presetFile } });
        api.legacyForget.mockImplementation(async () => { throw new ApiError(0, 'offline'); });
        expect(await importLegacyItem({ account, library, id: 2 })).toMatchObject({ forgotten: false });
        expect(await library.list(LIBRARY_KINDS.presets)).toHaveLength(1);
    });

    it('several at once: one failure does not stop the others', async () => {
        const { account, library } = await setup({
            1: { id: 1, kind: 'projects', file: projectFile },
            3: { id: 3, kind: 'projects', file: { format: 'nonsense' } },
            2: { id: 2, kind: 'presets', file: presetFile }
        });
        const progress = [];
        const { imported, failed } = await importLegacyItems({ account, library, ids: [1, 3, 2], onProgress: (d, t) => progress.push(`${d}/${t}`) });
        expect(imported.map((i) => i.id)).toEqual([1, 2]);
        expect(failed.map((f) => f.id)).toEqual([3]);
        expect(progress).toEqual(['1/3', '2/3', '3/3']);
    });

    it('a kind the studio does not know is refused before anything is written', async () => {
        const { account, api, library } = await setup({ 4: { id: 4, kind: 'plugins', file: presetFile } });
        await expect(importLegacyItem({ account, library, id: 4 })).rejects.toThrow('Unknown kind');
        expect(api.legacyForget).not.toHaveBeenCalled();
    });
});

describe('Account: code, profile and sharing', () => {
    it('signs in with the code from the email, spaces and all', async () => {
        const api = fakeApi({ verifyCode: vi.fn(async () => session(5)) });
        const { account, storage, changes } = make({ api });
        await account.verifyCode(' ada@example.com ', '482 913');
        expect(api.verifyCode).toHaveBeenCalledWith('ada@example.com', '482913');
        expect(account.user).toEqual(USER);
        expect(storage.data.get(KEY)).toBe('refresh-5');
        expect(changes).toEqual([USER]);
    });

    it('a wrong code leaves nobody signed in', async () => {
        const api = fakeApi({ verifyCode: vi.fn(async () => { throw new ApiError(400, 'This code is invalid or has expired.'); }) });
        const { account, storage } = make({ api });
        await expect(account.verifyCode('ada@example.com', '000000')).rejects.toMatchObject({ status: 400 });
        expect(account.signedIn).toBe(false);
        expect(storage.data.has(KEY)).toBe(false);
    });

    it('a new profile replaces the user, and everyone hears of it', async () => {
        const updated = { ...USER, handle: 'ada', display_name: 'Ada', bio: 'hi' };
        const api = fakeApi({ updateProfile: vi.fn(async () => ({ user: updated })) });
        const { account, changes } = make({ api });
        await account.consumeLink('https://s.test/?magic_token=t');
        await account.updateProfile({ handle: 'ada' });
        expect(api.updateProfile).toHaveBeenCalledWith('access-1', { handle: 'ada' });
        expect(account.user.handle).toBe('ada');
        expect(changes.at(-1)).toEqual(updated);
    });

    it('sharing goes out with the access token', async () => {
        const api = fakeApi({ sharedCreate: vi.fn(async () => ({ item: { id: 1, name: 'X' } })) });
        const { account } = make({ api });
        await account.consumeLink('https://s.test/?magic_token=t');
        const source = { kind: 'presets', license: 'CC0-1.0', description: null, file: { name: 'X' } };
        expect((await account.share(source)).item.id).toBe(1);
        expect(api.sharedCreate).toHaveBeenCalledWith('access-1', source);
    });
});

describe('AccountApi: the community', () => {
    function recorder() {
        const calls = [];
        const fetch = vi.fn(async (url, init) => {
            calls.push({ url, ...init });
            return { ok: true, status: 200, json: async () => ({ items: [], page: 1, more: false }) };
        });
        return { calls, api: new AccountApi({ baseUrl: 'https://api.8bitforge.com', fetch }) };
    }

    it('asks for the list with only the filters given, escaped', async () => {
        const { calls, api } = recorder();
        await api.sharedList();
        await api.sharedList({ kind: 'kits', q: 'rock & roll', page: 2 });
        expect(calls[0].url).toBe('https://api.8bitforge.com/v1/shared');
        expect(calls[1].url).toBe('https://api.8bitforge.com/v1/shared?kind=kits&q=rock%20%26%20roll&page=2');
        expect(calls[1].headers.Authorization).toBeUndefined();
    });

    it('checks a handle without signing in, and sends the code as typed', async () => {
        const { calls, api } = recorder();
        await api.handleCheck('ada/../x');
        await api.verifyCode('ada@example.com', '123456');
        expect(calls[0].url).toBe('https://api.8bitforge.com/v1/handles/ada%2F..%2Fx');
        expect(JSON.parse(calls[1].body)).toEqual({ email: 'ada@example.com', code: '123456' });
    });
});
