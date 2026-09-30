/**
 * A browser over one kind of saved thing.
 *
 * Projects, generator presets, kits and instrument presets are all browsed
 * the same way in this studio, and the markup says so: each window is the
 * same `preset-browser`: a search box, a filter on category, a favourites
 * toggle, a shuffle, and a table whose columns sort. This is that behaviour,
 * once.
 *
 * A subclass says which part of the page it owns, what its categories are,
 * where its entries come from, what a row of them looks like, and what
 * happens when one is clicked. Everything else is here.
 *
 * The listing is fetched when the window opens and filtered in memory after
 * that: the header a backend keeps beside each file has all a row needs, so
 * a keystroke costs no reads.
 *
 * Every window also does the same four things with files and with the
 * community: an Import button in its toolbar, Export and Share at the end of
 * the user's own rows, and a Community chip, shown to someone signed in:
 * that swaps the listing for what people shared. A shared row opens without
 * being kept, so it can be tried; the button at its end keeps it.
 */

import { LIBRARY_EVENTS } from '../storage/library.js';
import { normalize } from '../storage/library-search.js';
import { translateOr } from '../i18n/i18n.js';

/**
 * What a row is drawn from, whatever kind it is. A subclass builds these in
 * `fetch()` out of whatever its own source gives it.
 *
 * @typedef {object} BrowserEntry
 * @property {string} id
 * @property {string} name
 * @property {string} category
 * @property {string} designer     who made it, or an em dash
 * @property {string[]} tags
 * @property {string|null} [updatedAt]
 * @property {string|null} [cover]
 * @property {'library'|'builtin'|'community'} [source]
 * @property {object} [item]       whatever the subclass needs on open
 */

export class PresetBrowser {
    /**
     * @param {object} options
     * @param {ParentNode} options.root
     * @param {import('../studio.js').Studio} options.studio
     * @param {import('../storage/favorites.js').Favorites} options.favorites
     * @param {import('../storage/library.js').LibraryKind} options.kind
     * @param {object} options.elements   the ids this window owns
     * @param {readonly string[]} options.categories
     * @param {number} options.columns    how wide the table is, for a placeholder
     * @param {string[]} [options.hiddenFilters]  chips with nothing behind them here
     * @param {import('../account/community.js').Community|null} [options.community]
     * @param {(text: string) => void} [options.onStatus]
     */
    constructor({
        root,
        studio,
        favorites,
        kind,
        elements,
        categories,
        columns,
        hiddenFilters = [],
        community = null,
        onStatus = () => {}
    }) {
        this.root = root;
        this.studio = studio;
        this.favorites = favorites;
        this.kind = kind;
        this.elements = elements;
        this.categories = categories;
        this.columns = columns;
        this.hiddenFilters = hiddenFilters;
        this.community = community;
        this.onStatus = onStatus;

        /** @type {BrowserEntry[]} */
        this.entries = [];
        this._query = '';
        /** @type {Set<string>} */
        this._categoryFilter = new Set();
        this._favoritesOnly = false;
        /** Whether the listing is the community's rather than this studio's. */
        this._communityOn = false;

        const sort = this.defaultSort();
        this._sortColumn = sort.column;
        this._sortDescending = sort.descending;
        /** The row drawn as current, so reopening the window shows it. */
        this.openId = null;
    }

    bind() {
        this._element = this._el(this.elements.modal);
        if (!this._element) return;

        this._fields = {
            search: this._el(this.elements.search),
            count: this._el(this.elements.count),
            body: this._el(this.elements.body),
            empty: this._el(this.elements.empty),
            table: this._element.querySelector('.preset-browser-table-wrapper')
        };

        for (const id of this.hiddenFilters) this._el(id)?.classList.add('d-none');

        this._bindSearch();
        this._bindCategoryFilter();
        this._bindFavorites();
        this._bindSorting();
        this._bindRows();
        this._el(this.elements.shuffle)?.addEventListener('click', () => this._openRandom());
        this._bindCommunity();
        this._el(this.elements.import)?.addEventListener('click', () => this.importFiles());

        // A save from anywhere belongs in the list without waiting for the
        // window to be closed and reopened.
        this.studio.bus.on(LIBRARY_EVENTS.changed, ({ kind }) => {
            if (kind === this.kind && this.isOpen) this.reload();
        });

        this.bound();
    }

    /** For a subclass with more to wire up. */
    bound() {}

    async open() {
        if (!this._element) return;

        // Something loading under a playing sequencer would leave the two
        // disagreeing about what is playing.
        this.studio.sequencer.stop();

        await this.reload();
        window.bootstrap?.Modal.getOrCreateInstance(this._element).show();
    }

    close() {
        if (!this._element) return;
        window.bootstrap?.Modal.getOrCreateInstance(this._element).hide();
    }

    get isOpen() {
        return Boolean(this._element?.classList.contains('show'));
    }

    // ── What a subclass provides ─────────────────────────────────────────

    /**
     * Everything this window can show.
     * @returns {Promise<BrowserEntry[]>}
     * @abstract
     */
    async fetch() {
        return [];
    }

    /**
     * The cells between the favourite and the actions, as markup.
     * @param {BrowserEntry} _entry
     * @returns {string}
     * @abstract
     */
    cells(_entry) {
        return '';
    }

    /**
     * Take this one up.
     * @param {BrowserEntry} _entry
     * @abstract
     */
    async load(_entry) {}

    /**
     * Open something the community shared, from its file, without keeping
     * it: the button at the end of the row is what keeps it.
     * @param {object} _file
     * @param {BrowserEntry} _entry
     * @abstract
     */
    async openShared(_file, _entry) {}

    /**
     * The buttons at the end of a row. What ships with the studio is not
     * the user's to change or to hand out as theirs; what the community
     * shared can be kept; the user's own can be exported, shared and edited.
     */
    actions(entry) {
        if (entry.source === 'builtin') return '';
        if (entry.source === 'community') {
            return iconButton('preset-take-btn', 'ti-download', translateOr('community.take', 'Add to my library'));
        }
        const share = this.community?.canShare
            ? iconButton('preset-share-btn', 'ti-share', translateOr('share.button', 'Share with the community'))
            : '';
        const exporter = this.community
            ? iconButton('preset-export-btn', 'ti-file-export', translateOr('library.export', 'Export to a file'))
            : '';
        return exporter + share + iconButton('preset-edit-btn', 'ti-pencil', this.editLabel());
    }

    /** Where a shared item that names no category is filed. */
    defaultCategory() {
        return this.categories[0];
    }

    /** What the pencil's tooltip says. */
    editLabel() {
        return translateOr('gen.edit', 'Edit');
    }

    /** What a subclass does when the pencil is clicked. */
    edit(_entry) {}

    /** The translated name of a category. */
    categoryLabel(category) {
        return category;
    }

    /** A filter of the window's own, on top of the shared ones. */
    keeps(_entry) {
        return true;
    }

    // ── The controls ─────────────────────────────────────────────────────

    _el(id) {
        return id ? this.root.querySelector(`#${id}`) : null;
    }

    _bindSearch() {
        this._fields.search?.addEventListener('input', (event) => {
            this._query = normalize(event.target.value);
            this.render();
        });
    }

    /**
     * The category filter is built here rather than written into the markup
     * so that it stays in step with the list the save and edit windows offer.
     */
    _bindCategoryFilter() {
        const menu = this._el(this.elements.typeMenu);
        const button = this._el(this.elements.typeMenu)?.parentElement?.querySelector('button');
        if (!menu) return;

        menu.innerHTML = this.categories
            .map(
                (category) => `
                <li>
                    <label class="dropdown-item d-flex align-items-center gap-2 preset-type-option">
                        <input type="checkbox" class="form-check-input m-0" value="${category}" />
                        <span class="preset-type-badge badge-${category}"
                            data-i18n="${this.categoryKey(category)}">${escapeHtml(
                                this.categoryLabel(category)
                            )}</span>
                    </label>
                </li>`
            )
            .join('');

        menu.addEventListener('change', (event) => {
            const checkbox = event.target.closest('input[type="checkbox"]');
            if (!checkbox) return;

            if (checkbox.checked) this._categoryFilter.add(checkbox.value);
            else this._categoryFilter.delete(checkbox.value);

            button?.classList.toggle('active', this._categoryFilter.size > 0);
            this.render();
        });
    }

    /** The translation key a category's badge carries. */
    categoryKey(category) {
        return `proj.${category}`;
    }

    _bindFavorites() {
        this._el(this.elements.favorites)?.addEventListener('click', (event) => {
            this._favoritesOnly = !this._favoritesOnly;
            event.currentTarget.classList.toggle('active', this._favoritesOnly);
            this.render();
        });
    }

    _bindSorting() {
        const headers = [...this.root.querySelectorAll(`#${this.elements.table} th.sortable`)];

        for (const header of headers) {
            header.addEventListener('click', () => {
                const column = header.dataset.sort;
                // Clicking the column already sorted on turns it around;
                // clicking another starts it ascending.
                if (this._sortColumn === column) this._sortDescending = !this._sortDescending;
                else {
                    this._sortColumn = column;
                    this._sortDescending = false;
                }
                this._markSorted(headers);
                this.render();
            });
        }

        this._markSorted(headers);
    }

    _markSorted(headers) {
        for (const header of headers) {
            header.classList.remove('sort-asc', 'sort-desc');
            if (header.dataset.sort !== this._sortColumn) continue;
            header.classList.add(this._sortDescending ? 'sort-desc' : 'sort-asc');
        }
    }

    _bindRows() {
        this._fields.body?.addEventListener('click', (event) => {
            const row = event.target.closest('tr[data-id]');
            if (!row) return;

            const entry = this.entries.find((candidate) => candidate.id === row.dataset.id);
            if (!entry) return;

            if (event.target.closest('.preset-fav-btn')) {
                this._toggleFavorite(entry.id, row);
                return;
            }
            if (event.target.closest('.preset-take-btn')) {
                this.take(entry);
                return;
            }
            if (event.target.closest('.preset-export-btn')) {
                this.exportEntry(entry);
                return;
            }
            if (event.target.closest('.preset-share-btn')) {
                this.community?.requestShare(this.kind, entry.id);
                return;
            }
            if (event.target.closest('.preset-edit-btn')) {
                // Whether the listing gets out of the way is the window's
                // own call: one that fills the screen has to, and one that
                // is a tab inside the studio window would be closing the
                // studio to rename a preset in it.
                this.edit(entry);
                return;
            }

            if (entry.source === 'community') this.loadShared(entry);
            else this.load(entry);
        });
    }

    // ── The community, and files ─────────────────────────────────────────

    /**
     * The Community chip: there only for someone signed in, since that is
     * who the community is for, and gone again on signing out.
     */
    _bindCommunity() {
        const chip = this._el(this.elements.community);
        if (!chip) return;

        const sync = () => {
            const available = Boolean(this.community?.available);
            chip.classList.toggle('d-none', !available);
            if (!available && this._communityOn) this.setCommunity(false);
            else if (this.isOpen) this.render();
        };
        sync();
        this.community?.onChange(sync);

        chip.addEventListener('click', (event) => {
            event.currentTarget.blur();
            this.setCommunity(!this._communityOn);
        });

        // Choosing one of the studio's own sources means leaving the
        // community's listing for this studio's.
        for (const id of this.elements.sources ?? []) {
            this._el(id)?.addEventListener('click', () => {
                if (this._communityOn) this.setCommunity(false);
            });
        }
    }

    /** Swap the listing for the community's, or back. */
    async setCommunity(on) {
        this._communityOn = on;
        this._el(this.elements.community)?.classList.toggle('active', on);
        if (on) {
            // The studio's own sources start from "all" again on the way
            // back, rather than one of them still lit under the community.
            this._source = null;
            for (const id of this.elements.sources ?? []) this._el(id)?.classList.remove('active');
        }
        await this.reload();
    }

    /** What people shared of this kind, as rows. */
    async fetchCommunity() {
        const { items } = await this.community.list(this.kind);
        return items.map((item) => ({
            id: `community:${item.id}`,
            name: item.name,
            category: item.category ?? this.defaultCategory(),
            designer: item.author?.handle ? `@${item.author.handle}` : '-',
            tags: [],
            updatedAt: item.updated_at ? new Date(item.updated_at * 1000).toISOString() : null,
            source: 'community',
            shared: item
        }));
    }

    async loadShared(entry) {
        try {
            const { file } = await this.community.get(entry.shared.id);
            await this.openShared(file, entry);
            this.openId = entry.id;
            this.render();
        } catch (error) {
            this.onStatus(`${translateOr('library.openfailed', 'Could not open')}: ${error.message}`);
        }
    }

    /** Keep something the community shared. */
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
            const name = await this.community.exportItem(this.kind, entry.id);
            if (name) this.onStatus(`${translateOr('library.exported', 'Exported')}: ${name}`);
        } catch (error) {
            this.onStatus(`${translateOr('library.exportfailed', 'Could not export')}: ${error.message}`);
        }
    }

    /** The Import button: files picked from disk, into the library. */
    async importFiles() {
        if (!this.community) return;
        const { imported, failed } = await this.community.importFiles(this.kind);
        if (imported.length) {
            this.onStatus(translateOr('library.importedNames', 'Imported: {names}', { names: imported.join(', ') }));
        }
        for (const { file, error } of failed) {
            this.onStatus(`${translateOr('library.importfailed', 'Could not import')} ${file}: ${error.message}`);
        }
    }

    // ── Listing ──────────────────────────────────────────────────────────

    async reload() {
        this.setPlaceholder(translateOr('library.loading', 'Loading…'));

        try {
            this.entries = this._communityOn ? await this.fetchCommunity() : await this.fetch();
        } catch (error) {
            this.entries = [];
            this.setPlaceholder(
                `${translateOr('library.unavailable', 'Library unavailable')}: ${error.message}`
            );
            return;
        }

        this.render();
    }

    render() {
        const rows = this._sorted(this._filtered());

        if (this._fields.count) {
            this._fields.count.textContent = this.countLabel(rows.length);
        }

        this._fields.empty?.classList.toggle('d-none', rows.length > 0);
        this._fields.table?.classList.toggle('d-none', rows.length === 0);

        if (this._fields.body) {
            this._fields.body.innerHTML = rows.map((entry) => this._row(entry)).join('');
        }
    }

    /** How the window counts what it is showing. */
    countLabel(total) {
        return translateOr('proj.count', '{0} projects').replace('{0}', String(total));
    }

    _filtered() {
        return this.entries.filter((entry) => {
            if (this._favoritesOnly && !this.favorites.has(this.kind, entry.id)) return false;
            if (this._categoryFilter.size > 0 && !this._categoryFilter.has(entry.category)) {
                return false;
            }
            // The window's own filters are about this studio's sources; the
            // community's listing is one source already.
            if (!this._communityOn && !this.keeps(entry)) return false;
            if (!this._query) return true;

            // A search runs over everything a row shows, tags included: the
            // word someone half-remembers is as likely to be a tag as a name.
            return this.searchable(entry).some((value) => normalize(value).includes(this._query));
        });
    }

    /** @param {BrowserEntry} entry */
    searchable(entry) {
        return [entry.name, entry.category, entry.designer, ...(entry.tags ?? [])];
    }

    _sorted(entries) {
        const direction = this._sortDescending ? -1 : 1;

        return [...entries].sort((a, b) => {
            if (this._sortColumn === 'date') return (dateOf(a) - dateOf(b)) * direction;

            const left = normalize(this.sortKey(a, this._sortColumn));
            const right = normalize(this.sortKey(b, this._sortColumn));
            return left.localeCompare(right, undefined, { numeric: true }) * direction;
        });
    }

    /**
     * The order a window opens in, before anyone clicks a column.
     *
     * A list of presets opens alphabetically: they arrive in the order the
     * catalogue happens to hold them, which reads as no order at all, and a
     * shipped preset has no date to sort by: so opening on Date drew an
     * arrow over a column that decided nothing. A list of projects keeps the
     * newest first, which is what someone looking for their own work wants.
     *
     * @returns {{column: string, descending: boolean}}
     */
    defaultSort() {
        return { column: 'name', descending: false };
    }

    /** @param {BrowserEntry} entry */
    sortKey(entry, column) {
        if (column === 'type') return entry.category;
        if (column === 'designer') return entry.designer;
        return entry.name;
    }

    _row(entry) {
        const isFavorite = this.favorites.has(this.kind, entry.id);

        return `
            <tr data-id="${escapeHtml(entry.id)}" class="${
                entry.id === this.openId ? 'active' : ''
            }">
                <td class="col-fav">
                    <button class="preset-fav-btn btn-icon ${isFavorite ? 'is-fav' : ''}">
                        <i class="ti ti-heart${isFavorite ? '-filled' : ''}"></i>
                    </button>
                </td>
                ${this.cells(entry)}
                <td class="col-actions">${this.actions(entry)}</td>
            </tr>`;
    }

    /** The cells every one of these tables has in the middle. */
    commonCells(entry) {
        const tags = (entry.tags ?? [])
            .slice(0, 4)
            .map((tag) => `<span class="tag-badge">${escapeHtml(tag)}</span>`)
            .join('');

        return `
            <td class="col-name">${escapeHtml(entry.name)}${
                tags ? `<div class="tag-badges-wrap mt-1">${tags}</div>` : ''
            }</td>
            <td class="col-type">
                <span class="preset-type-badge badge-${escapeHtml(entry.category)}">${escapeHtml(
                    this.categoryLabel(entry.category)
                )}</span>
            </td>
            <td class="col-designer">${escapeHtml(entry.designer)}</td>
            <td class="col-date">${escapeHtml(formatDate(entry.updatedAt))}</td>`;
    }

    setPlaceholder(text) {
        if (!this._fields.body) return;

        this._fields.empty?.classList.add('d-none');
        this._fields.table?.classList.remove('d-none');
        this._fields.body.innerHTML = `
            <tr><td colspan="${this.columns}" class="preset-browser-placeholder">${escapeHtml(
                text
            )}</td></tr>`;
    }

    // ── Opening ──────────────────────────────────────────────────────────

    _openRandom() {
        const rows = [...(this._fields.body?.querySelectorAll('tr[data-id]') ?? [])];
        if (rows.length === 0) return;

        const row = rows[Math.floor(Math.random() * rows.length)];
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });

        const entry = this.entries.find((candidate) => candidate.id === row.dataset.id);
        if (!entry) return;
        if (entry.source === 'community') this.loadShared(entry);
        else this.load(entry);
    }

    _toggleFavorite(id, row) {
        const isFavorite = this.favorites.toggle(this.kind, id);
        const button = row.querySelector('.preset-fav-btn');

        button?.classList.toggle('is-fav', isFavorite);
        const icon = button?.querySelector('i');
        if (icon) icon.className = `ti ti-heart${isFavorite ? '-filled' : ''}`;

        // Unstarring while the filter is on should take the row away, which
        // only a redraw does.
        if (this._favoritesOnly) this.render();
    }
}

function iconButton(className, icon, title) {
    return `
            <button class="${className} btn-icon" title="${escapeHtml(title)}">
                <i class="ti ${icon}"></i>
            </button>`;
}

function dateOf(entry) {
    const time = Date.parse(entry.updatedAt ?? '');
    return Number.isNaN(time) ? 0 : time;
}

function formatDate(value) {
    const time = Date.parse(value ?? '');
    if (Number.isNaN(time)) return '-';
    return new Date(time).toLocaleDateString();
}

export function escapeHtml(value) {
    return String(value ?? '').replace(
        /[&<>"']/g,
        (character) =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]
    );
}
