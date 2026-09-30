import { describe, it, expect, vi } from 'vitest';
import { Community, NeedsHandle, NeedsSignIn } from '../src/account/community.js';
import { ACCOUNT_EVENTS } from '../src/account/account.js';
import { EventBus } from '../src/core/event-bus.js';
import { Library, LIBRARY_KINDS } from '../src/storage/library.js';
import { MemoryBackend } from '../src/storage/memory-backend.js';

const KIT = { format: '8bit-forge-item', version: 1, name: 'Shared Kit', data: { tracks: [] }, tags: [] };

function setup({ signedIn = true, handle = 'ada' } = {}) {
    const bus = new EventBus();
    const library = new Library(new MemoryBackend(), { bus });
    const saved = [];
    const platform = { saveFile: vi.fn(async (name, blob) => saved.push({ name, blob })) };
    const api = {
        sharedList: vi.fn(async () => ({ items: [{ id: 3, kind: 'kits', name: 'Shared Kit' }], more: false })),
        sharedGet: vi.fn(async () => ({ item: { id: 3, kind: 'kits', name: 'Shared Kit' }, file: KIT }))
    };
    const account = {
        signedIn,
        user: signedIn ? { id: 1, email: 'ada@example.com', handle } : null,
        share: vi.fn(async ({ kind, file }) => ({ item: { id: 9, kind, name: file.name } }))
    };
    const opened = [];
    const statuses = [];
    const community = new Community({
        library,
        platform,
        bus,
        language: () => 'fr',
        openUrl: (url) => opened.push(url),
        onStatus: (text) => statuses.push(text)
    });
    return { bus, library, platform, saved, api, account, community, opened, statuses };
}

describe('Community', () => {
    it('can be browsed by anyone once the account is plugged in; shared to only when signed in', () => {
        const { community, api, account } = setup();
        expect(community.enabled).toBe(false);
        expect(community.available).toBe(false);
        expect(community.canShare).toBe(false);

        community.connect({ api, account });
        expect(community.enabled).toBe(true);
        expect(community.available).toBe(true);
        expect(community.canShare).toBe(true);

        account.signedIn = false;
        expect(community.available).toBe(true);
        expect(community.canShare).toBe(false);
    });

    it('tells the windows when it is plugged in', () => {
        const { community, api, account, bus } = setup();
        const heard = vi.fn();
        community.onChange(heard);
        community.connect({ api, account });
        expect(heard).toHaveBeenCalledOnce();
        bus.emit(ACCOUNT_EVENTS.changed, { user: null });
        expect(heard).toHaveBeenCalledTimes(2);
    });

    it('builds site links in the interface language', () => {
        const { community, opened } = setup();
        expect(community.siteUrl('community')).toBe('https://8bitforge.com/fr/community');
        community.openSite('account');
        expect(opened).toEqual(['https://8bitforge.com/fr/account']);
    });

    it('lists by kind, and takes a shared source into the library', async () => {
        const { community, api, account, library } = setup();
        community.connect({ api, account });

        const { items } = await community.list(LIBRARY_KINDS.kits);
        expect(api.sharedList).toHaveBeenCalledWith({ kind: 'kits', q: '', page: 1 });
        expect(items).toHaveLength(1);

        const taken = await community.take(3);
        expect(taken).toMatchObject({ kind: 'kits', name: 'Shared Kit' });
        const kits = await library.list(LIBRARY_KINDS.kits);
        expect(kits.map((kit) => kit.name)).toEqual(['Shared Kit']);
    });

    it('shares what the library holds, and refuses without an account or a handle', async () => {
        const { community, api, account, library } = setup();
        const { id } = await library.write(LIBRARY_KINDS.kits, { name: 'Mine', data: { tracks: [] } });

        community.connect({ api, account });
        const item = await community.share(LIBRARY_KINDS.kits, id);
        expect(item.name).toBe('Mine');
        expect(account.share.mock.calls[0][0]).toMatchObject({ kind: 'kits', license: 'CC-BY-4.0' });

        account.user.handle = null;
        await expect(community.share(LIBRARY_KINDS.kits, id)).rejects.toBeInstanceOf(NeedsHandle);
        account.signedIn = false;
        await expect(community.share(LIBRARY_KINDS.kits, id)).rejects.toBeInstanceOf(NeedsSignIn);
    });

    it('sends someone without a handle to the site rather than sharing', async () => {
        const { community, api, account, opened, statuses } = setup({ handle: null });
        const shareDialog = { open: vi.fn() };
        community.connect({ api, account, shareDialog });

        await community.requestShare(LIBRARY_KINDS.kits, 'mine');
        expect(shareDialog.open).not.toHaveBeenCalled();
        expect(opened).toEqual(['https://8bitforge.com/fr/account']);
        expect(statuses).toHaveLength(1);
    });

    it('opens the Share window for someone with a handle', async () => {
        const { community, api, account } = setup();
        const shareDialog = { open: vi.fn() };
        community.connect({ api, account, shareDialog });

        await community.requestShare(LIBRARY_KINDS.kits, 'mine');
        expect(shareDialog.open).toHaveBeenCalledWith({ kind: 'kits', id: 'mine' });
    });

    it('exports an item through the platform, with no account at all', async () => {
        const { community, library, saved } = setup();
        const { id } = await library.write(LIBRARY_KINDS.presets, { name: 'Bright Lead', data: { osc: 1 } });

        const name = await community.exportItem(LIBRARY_KINDS.presets, id);
        expect(name).toMatch(/\.json$/);
        expect(saved).toHaveLength(1);

        // What was written imports back as the same item.
        const text = await saved[0].blob.text();
        const again = await library.importItem(LIBRARY_KINDS.presets, text);
        expect(again.name).toBe('Bright Lead');
    });

    it('exports nothing for an item that is gone', async () => {
        const { community, saved } = setup();
        expect(await community.exportItem(LIBRARY_KINDS.presets, 'nope')).toBeNull();
        expect(saved).toHaveLength(0);
    });
});
