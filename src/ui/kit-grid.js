/**
 * The Kits tab of the studio window.
 *
 * A kit is the whole instrument set of a project in one move: eight
 * instruments, one per track. Twenty ship with the studio and anyone can
 * save their own, so this is a grid of covers rather than the table the
 * other browsers use: a kit is a thing you recognise by its picture more
 * readily than by its name in a column.
 *
 * Each card carries what you can do with it. Play applies it; the heart
 * files it; the pencil edits one of your own; the copy makes one of yours
 * out of one of the studio's, which is how a shipped kit becomes something
 * you can change; the list opens its eight instruments in the Library tab.
 * One of your own can also be exported to a file or shared; the Import
 * button beside Create Kit takes such a file back; and someone signed in
 * gets a Community chip, whose cards apply without being kept until the
 * download button keeps them.
 */

import { LIBRARY_KINDS, LIBRARY_EVENTS } from '../storage/library.js';
import { normalize } from '../storage/library-search.js';
import { escapeHtml } from './preset-browser.js';
import { DEFAULT_COVER, sharedCoverUrl } from './cover-image.js';
import { DEFAULT_KIT_CATEGORY, categoryLabel } from './library-categories.js';
import { translateOr } from '../i18n/i18n.js';

/** The chips above the grid, in the order they appear. */
const CHIPS = Object.freeze([
    { key: 'favorites', icon: 'ti-heart-filled', label: ['kit.favorites', 'Favorites'] },
    { key: 'builtin', label: ['kit.builtin', '8BitForge'] },
    { key: 'library', label: ['kit.user', 'My Kits'] },
    { key: 'community', icon: 'ti-world', label: ['kit.community', 'Community'] }
]);

export class KitGrid {
    /**
     * @param {object} options
     * @param {ParentNode} options.root
     * @param {import('../studio.js').Studio} options.studio
     * @param {import('../storage/library.js').Library} options.library
     * @param {import('../storage/favorites.js').Favorites} options.favorites
     * @param {import('../account/community.js').Community|null} [options.community]
     * @param {(entry: object) => void} [options.onEdit]
     * @param {(entry: object) => void} [options.onDuplicate]
     * @param {(entry: object) => void} [options.onList]   show its instruments
     * @param {() => void} [options.onApplied]
     * @param {(text: string) => void} [options.onStatus]
     */
    constructor({
        root,
        studio,
        library,
        favorites,
        community = null,
        onEdit = () => {},
        onDuplicate = () => {},
        onList = () => {},
        onApplied = () => {},
        onStatus = () => {}
    }) {
        this.root = root;
        this.studio = studio;
        this.library = library;
        this.favorites = favorites;
        this.community = community;
        this.onEdit = onEdit;
        this.onDuplicate = onDuplicate;
        this.onList = onList;
        this.onApplied = onApplied;
        this.onStatus = onStatus;

        /** @type {Array<object>} */
        this.entries = [];
        this._query = '';
        /** @type {'builtin'|'library'|'community'|null} */
        this._source = null;
        this._favoritesOnly = false;
        /** The kit last applied, drawn as current. */
        this.openId = null;
    }

    bind() {
        this._grid = this.root.querySelector('#kitGrid');
        this._empty = this.root.querySelector('#kitEmptyState');
        if (!this._grid) return;

        this.root.querySelector('#kitSearchInput')?.addEventListener('input', (event) => {
            this._query = normalize(event.target.value);
            this.render();
        });

        this._buildChips();
        this._grid.addEventListener('click', (event) => this._onClick(event));
        this.root.querySelector('#kitImportBtn')?.addEventListener('click', () => this.importFiles());

        // A kit saved from anywhere belongs in the grid without waiting for
        // the window to be closed and reopened.
        this.studio.bus.on(LIBRARY_EVENTS.changed, ({ kind }) => {
            if (kind === LIBRARY_KINDS.kits && this._source !== 'community') this.reload();
        });
    }

    // ── The chips ────────────────────────────────────────────────────────

    /**
     * The labels carry `data-i18n`, so a change of language, which
     * re-translates the studio's markup, reaches them too: built once, they
     * used to keep the language they were built in.
     */
    _buildChips() {
        const container = this.root.querySelector('#kitFilterChips');
        if (!container) return;
        this._chips = container;

        container.innerHTML = CHIPS.map(
            ({ key, icon, label }) => `
            <span class="kit-filter-chip" data-chip="${key}">
                ${icon ? `<i class="ti ${icon}" style="font-size: 11px"></i> ` : ''}
                <span data-i18n="${label[0]}">${escapeHtml(translateOr(label[0], label[1]))}</span>
            </span>`
        ).join('');

        container.addEventListener('click', (event) => {
            const chip = event.target.closest('.kit-filter-chip');
            if (!chip) return;

            const key = chip.dataset.chip;
            if (key === 'favorites') {
                this._favoritesOnly = !this._favoritesOnly;
                this._markChips();
                this.render();
                return;
            }
            // Pressing the source already chosen shows all of this
            // studio's again.
            this._setSource(this._source === key ? null : key);
        });

        // The Community chip is there whenever the build has the community:
        // anyone may browse it, signed in or not.
        const syncCommunity = () => {
            const available = Boolean(this.community?.available);
            container.querySelector('[data-chip="community"]')?.classList.toggle('d-none', !available);
            if (!available && this._source === 'community') this._setSource(null);
            else this.render();
        };
        syncCommunity();
        this.community?.onChange(syncCommunity);
    }

    /** Choose a source. The community's is fetched; the others are filtered. */
    async _setSource(source) {
        const refetch = this._source === 'community' || source === 'community';
        this._source = source;
        this._markChips();
        if (refetch) await this.reload();
        else this.render();
    }

    _markChips() {
        for (const chip of this._chips?.querySelectorAll('.kit-filter-chip') ?? []) {
            const on = chip.dataset.chip === 'favorites' ? this._favoritesOnly : chip.dataset.chip === this._source;
            chip.classList.toggle('active', on);
        }
    }

    // ── Listing ──────────────────────────────────────────────────────────

    async reload() {
        try {
            this.entries = this._source === 'community' ? await this.fetchCommunity() : await this.fetch();
        } catch (error) {
            this.entries = [];
            this.onStatus(
                `${translateOr('library.unavailable', 'Library unavailable')}: ${error.message}`
            );
        }

        this.render();
    }

    async fetch() {
        const builtin = this.studio.instruments.getBuiltinKitList().map((kit) => ({
            id: kit.key,
            name: kit.name,
            category: kit.category ?? DEFAULT_KIT_CATEGORY,
            cover: kit.cover,
            designer: '8BitForge',
            tags: [],
            source: 'builtin',
            data: kit.data
        }));

        const saved = (await this.library.list(LIBRARY_KINDS.kits)).map((entry) => ({
            id: entry.id,
            name: entry.name,
            category: entry.category ?? DEFAULT_KIT_CATEGORY,
            cover: entry.cover,
            // Nobody to credit but the person sitting here.
            designer: null,
            tags: entry.tags ?? [],
            source: 'library'
        }));

        return [...builtin, ...saved];
    }

    /** What people shared, as cards, with the cover the API keeps for each. */
    async fetchCommunity() {
        const { items } = await this.community.list(LIBRARY_KINDS.kits);
        return items.map((item) => ({
            id: `community:${item.id}`,
            name: item.name,
            category: item.category ?? DEFAULT_KIT_CATEGORY,
            cover: sharedCoverUrl(item),
            designer: item.author?.handle ? `@${item.author.handle}` : '-',
            tags: [],
            source: 'community',
            shared: item
        }));
    }

    render() {
        if (!this._grid) return;

        const kits = this.entries.filter((entry) => this._keeps(entry));

        this._empty?.classList.toggle('d-none', kits.length > 0);
        this._grid.innerHTML = kits.map((entry) => this._card(entry)).join('');
    }

    _keeps(entry) {
        if (this._favoritesOnly && !this.favorites.has(LIBRARY_KINDS.kits, entry.id)) return false;
        if (this._source && entry.source !== this._source) return false;
        if (!this._query) return true;

        return [entry.name, entry.category, entry.designer ?? '', ...entry.tags].some((value) =>
            normalize(value).includes(this._query)
        );
    }

    _card(entry) {
        const favorite = this.favorites.has(LIBRARY_KINDS.kits, entry.id);
        const button = (action, icon, title, extra = '') => `
            <button class="kit-action-btn${extra}" data-action="${action}" title="${escapeHtml(title)}">
                <i class="ti ${icon}"></i>
            </button>`;

        const actions = [
            `<button class="kit-apply-btn" data-action="apply"
                title="${escapeHtml(translateOr('kit.apply', 'Apply'))}">
                <i class="ti ti-player-play"></i>
            </button>`
        ];

        if (entry.source === 'community') {
            actions.push(button('take', 'ti-download', translateOr('community.take', 'Add to my library')));
        } else {
            actions.push(
                button(
                    'fav',
                    `ti-heart${favorite ? '-filled' : ''}`,
                    translateOr('kit.favorites', 'Favorites'),
                    ` favorite${favorite ? ' active' : ''}`
                )
            );
            if (entry.source === 'library') {
                actions.push(button('edit', 'ti-pencil', translateOr('kit.editTitle', 'Edit Kit')));
                if (this.community) {
                    actions.push(button('export', 'ti-file-export', translateOr('library.export', 'Export to a file')));
                }
                if (this.community?.canShare) {
                    actions.push(button('share', 'ti-share', translateOr('share.button', 'Share with the community')));
                }
            } else {
                // A kit that ships with the studio is not the user's to
                // change; copying it is how they get one that is.
                actions.push(button('dup', 'ti-copy', translateOr('kit.duplicate', 'Duplicate')));
            }
            actions.push(button('list', 'ti-list', translateOr('kit.viewPresets', 'View presets in Library')));
        }

        const tags = entry.tags
            .slice(0, 3)
            .map((tag) => `<span class="tag-badge">${escapeHtml(tag)}</span>`)
            .join('');

        return `
            <div class="kit-card${entry.id === this.openId ? ' active' : ''}"
                data-id="${escapeHtml(entry.id)}">
                <div class="kit-card-cover">
                    <img src="${escapeHtml(entry.cover || DEFAULT_COVER)}"
                        alt="" loading="lazy" />
                    <div class="kit-card-overlay">${actions.join('')}</div>
                </div>
                <div class="kit-card-info">
                    <div class="kit-card-name" title="${escapeHtml(entry.name)}">${escapeHtml(
                        entry.name
                    )}</div>
                    <div class="kit-card-meta">
                        <span class="badge badge-kit-${escapeHtml(entry.category)}"
                            style="font-size: 9px; padding: 1px 5px">${escapeHtml(
                                categoryLabel('kit', entry.category)
                            )}</span>
                        <span class="kit-card-type">${escapeHtml(
                            entry.designer ?? translateOr('kit.user', 'My Kits')
                        )}</span>
                    </div>
                    ${tags ? `<div class="tag-badges-wrap mt-1">${tags}</div>` : ''}
                </div>
            </div>`;
    }

    // ── Doing something with one ─────────────────────────────────────────

    _onClick(event) {
        const card = event.target.closest('.kit-card[data-id]');
        if (!card) return;

        const entry = this.entries.find((candidate) => candidate.id === card.dataset.id);
        if (!entry) return;

        // Clicking the card anywhere but on a button applies it, which is
        // what the cover is for.
        const action = event.target.closest('[data-action]')?.dataset.action ?? 'apply';

        if (action === 'apply') this.apply(entry);
        else if (action === 'fav') this._toggleFavorite(entry, card);
        else if (action === 'edit') this.onEdit(entry);
        else if (action === 'dup') this.onDuplicate(entry);
        else if (action === 'list') this.onList(entry);
        else if (action === 'take') this.take(entry);
        else if (action === 'export') this.exportEntry(entry);
        else if (action === 'share') this.community?.requestShare(LIBRARY_KINDS.kits, entry.id);
    }

    /** Put a kit's eight instruments on the eight tracks. */
    async apply(entry) {
        const data = await this._dataOf(entry);
        if (!data) return;

        this.studio.instruments.applyKit(data);
        // Eight instruments at once is the largest single change the studio
        // makes; it had better be one undo.
        this.studio.history.saveState('Kit');

        this.openId = entry.id;
        this.render();
        this.onApplied();
        this.onStatus(`${translateOr('kit.applySuccess', 'Kit applied')}: ${entry.name}`);
    }

    async _dataOf(entry) {
        if (entry.source === 'builtin') return entry.data;
        if (entry.source !== 'community') return this._read(entry.id);
        try {
            const { file } = await this.community.get(entry.shared.id);
            return file.data;
        } catch (error) {
            this.onStatus(`${translateOr('library.openfailed', 'Could not open')}: ${error.message}`);
            return null;
        }
    }

    /** Keep a kit the community shared. */
    async take(entry) {
        try {
            const { name } = await this.community.take(entry.shared.id);
            this.onStatus(translateOr('community.taken', '"{name}" is in your library.', { name }));
        } catch (error) {
            this.onStatus(`${translateOr('library.importfailed', 'Could not import')}: ${error.message}`);
        }
    }

    async exportEntry(entry) {
        try {
            const name = await this.community.exportItem(LIBRARY_KINDS.kits, entry.id);
            if (name) this.onStatus(`${translateOr('library.exported', 'Exported')}: ${name}`);
        } catch (error) {
            this.onStatus(`${translateOr('library.exportfailed', 'Could not export')}: ${error.message}`);
        }
    }

    /** The Import button: kit files picked from disk, into the library. */
    async importFiles() {
        if (!this.community) return;
        const { imported, failed } = await this.community.importFiles(LIBRARY_KINDS.kits);
        if (imported.length) {
            this.onStatus(translateOr('library.importedNames', 'Imported: {names}', { names: imported.join(', ') }));
        }
        for (const { file, error } of failed) {
            this.onStatus(`${translateOr('library.importfailed', 'Could not import')} ${file}: ${error.message}`);
        }
    }

    /** The instruments a kit names, for the Library tab to filter on. */
    static presetsOf(data) {
        return (data?.tracks ?? []).map((slot) => slot.presetKey).filter(Boolean);
    }

    async _read(id) {
        try {
            const stored = await this.library.read(LIBRARY_KINDS.kits, id);
            if (stored) return stored.data;

            this.onStatus(translateOr('library.gone', 'That project is no longer there'));
            await this.reload();
        } catch (error) {
            this.onStatus(
                `${translateOr('library.openfailed', 'Could not open')}: ${error.message}`
            );
        }
        return null;
    }

    _toggleFavorite(entry, card) {
        const favorite = this.favorites.toggle(LIBRARY_KINDS.kits, entry.id);
        const button = card.querySelector('[data-action="fav"]');

        button?.classList.toggle('active', favorite);
        const icon = button?.querySelector('i');
        if (icon) icon.className = `ti ti-heart${favorite ? '-filled' : ''}`;

        // Unstarring while the filter is on should take the card away,
        // which only a redraw does.
        if (this._favoritesOnly) this.render();
    }
}
