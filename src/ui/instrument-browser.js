/**
 * The Library tab of the studio window.
 *
 * Two hundred and ten instruments the studio ships with, plus whatever
 * anyone has saved, in the same table the projects and the generator
 * presets are listed in. Clicking a row puts that instrument on the track
 * the studio window is editing.
 *
 * It differs from the other two browsers in two ways, and both come from
 * being a tab rather than a window. It does not close when a row is
 * clicked: auditioning instruments is the point, and closing the studio
 * after each one would make that a chore: and it does not stop the
 * sequencer on the way in, because hearing a new sound in the loop that is
 * already playing is the fastest way to judge it.
 *
 * The thumbnail column says which kit an instrument belongs to, which is
 * the only place in the studio that fact is visible: the kits are the
 * curated groupings, and a preset that is in one is a preset somebody put
 * there on purpose.
 */

import { LIBRARY_KINDS } from '../storage/library.js';
import { shipped } from '../content/shipped.js';
import { PresetBrowser, escapeHtml } from './preset-browser.js';
import { DEFAULT_COVER } from './cover-image.js';
import {
    INSTRUMENT_CHOICES,
    USER_CATEGORY,
    categoryLabel,
    categoryKey
} from './library-categories.js';
import { translateOr } from '../i18n/i18n.js';

export class InstrumentBrowser extends PresetBrowser {
    /**
     * @param {object} options
     * @param {ParentNode} options.root
     * @param {import('../studio.js').Studio} options.studio
     * @param {import('../storage/library.js').Library} options.library
     * @param {import('../storage/favorites.js').Favorites} options.favorites
     * @param {import('../account/community.js').Community|null} [options.community]
     * @param {(id: string) => void} [options.onEdit]     open the edit window
     * @param {() => void} [options.onLoaded]             an instrument landed
     * @param {(text: string) => void} [options.onStatus] the transport's line
     */
    constructor({
        root,
        studio,
        library,
        favorites,
        community = null,
        onEdit = () => {},
        onLoaded = () => {},
        onStatus = () => {}
    }) {
        super({
            root,
            studio,
            favorites,
            kind: LIBRARY_KINDS.presets,
            categories: INSTRUMENT_CHOICES,
            columns: 7,
            elements: {
                // The tab has no window of its own: it lives in the studio
                // window, and that is what has to be on screen for any of
                // this to be visible.
                modal: 'studioModal',
                search: 'presetSearchInput',
                count: 'presetCount',
                body: 'presetTableBody',
                empty: 'presetEmptyState',
                table: 'presetTable',
                typeMenu: 'typeFilterMenu',
                favorites: 'favFilterBtn',
                shuffle: 'shuffleBtn',
                community: 'communityFilterBtn',
                sources: ['builtinFilterBtn', 'userFilterBtn'],
                import: 'presetImportBtn'
            },
            community,
            onStatus
        });

        this.library = library;
        this.onEdit = onEdit;
        this.onLoaded = onLoaded;

        /** @type {'builtin'|'library'|null} which source, or both. */
        this._source = null;
        /**
         * The kit whose instruments the table is narrowed to, set by the
         * list button on a kit card.
         * @type {{name: string, presets: Set<string>}|null}
         */
        this._kit = null;
    }

    bound() {
        const chips = { builtinFilterBtn: 'builtin', userFilterBtn: 'library' };

        for (const [id, source] of Object.entries(chips)) {
            const chip = this.root.querySelector('#' + id);
            // The markup ships with the first of them pressed. Nothing is
            // filtered until someone presses one, so the chips are put in
            // the state the filter is actually in.
            chip?.classList.remove('active');

            chip?.addEventListener('click', (event) => {
                // Pressing the chip that is already down shows both again:
                // with two sources there is no third to fall back to.
                this._source = this._source === source ? null : source;

                for (const other of Object.keys(chips)) {
                    this.root
                        .querySelector('#' + other)
                        ?.classList.toggle('active', chips[other] === this._source);
                }
                event.currentTarget.blur();
                this.render();
            });
        }

        this.root.querySelector('#kitFilterBadge')?.addEventListener('click', () => {
            this.showKit(null);
        });
    }

    categoryLabel(category) {
        return categoryLabel('instrument', category);
    }

    categoryKey(category) {
        return categoryKey('instrument', category);
    }

    countLabel(total) {
        return translateOr('lib.presetCount', '{0} presets').replace('{0}', String(total));
    }

    keeps(entry) {
        if (this._source && entry.source !== this._source) return false;
        if (this._kit && !this._kit.presets.has(entry.id)) return false;
        return true;
    }

    // ── Listing ──────────────────────────────────────────────────────────

    async fetch() {
        const builtin = this.studio.instruments.getBuiltinPresetList().map((preset) => ({
            id: preset.presetKey,
            name: preset.name,
            category: preset.type,
            designer: preset.designer,
            tags: [],
            updatedAt: null,
            source: 'builtin'
        }));

        const saved = (await this.library.list(LIBRARY_KINDS.presets)).map((entry) => ({
            id: entry.id,
            name: entry.name,
            category: entry.category ?? USER_CATEGORY,
            // Nobody to credit but the person sitting here.
            designer: '-',
            tags: entry.tags ?? [],
            updatedAt: entry.updatedAt,
            source: 'library'
        }));

        return [...builtin, ...saved];
    }

    cells(entry) {
        const kit = kitCovers().get(entry.id);

        return `
            <td class="col-thumb">
                <img src="${escapeHtml(kit?.cover || DEFAULT_COVER)}" alt=""
                    class="preset-thumb" loading="lazy"
                    title="${escapeHtml(kit?.name ?? '')}" />
            </td>
            ${this.commonCells(entry)}`;
    }

    defaultCategory() {
        return USER_CATEGORY;
    }

    edit(entry) {
        // No `close()`: the edit window stacks over the studio window, and
        // closing this would take the table out from under it.
        this.onEdit(entry.id);
    }

    // ── Opening ──────────────────────────────────────────────────────────

    /**
     * Refresh the table. The studio window is opened by whoever owns the
     * tab; this only fills it.
     */
    async open() {
        await this.reload();
    }

    /**
     * Narrow the table to one kit's instruments, or widen it again.
     *
     * @param {{name: string, presets: string[]}|null} kit
     */
    showKit(kit) {
        this._kit = kit ? { name: kit.name, presets: new Set(kit.presets) } : null;

        const badge = this.root.querySelector('#kitFilterBadge');
        const name = this.root.querySelector('#kitFilterName');
        if (name) name.textContent = this._kit?.name ?? '';
        badge?.classList.toggle('d-none', !this._kit);

        this.render();
    }

    async load(entry) {
        const track = this.studio.synthesizer.currentTrack;

        if (entry.source === 'builtin') {
            this.studio.instruments.loadPreset(entry.id, track);
        } else if (!(await this._loadSaved(entry, track))) {
            return;
        }

        // Putting an instrument on a track changes the project, so it is
        // undoable like any other change to it: recorded after the change
        // and after the way of failing to make one.
        this.studio.history.saveState('Instrument');

        this.openId = entry.id;
        this.render();
        this.onLoaded();
        this.onStatus(`${translateOr('library.opened', 'Opened')}: ${entry.name}`);
    }

    /** A shared instrument goes on the track like any other: hearing it is the point. */
    async openShared(file, entry) {
        const track = this.studio.synthesizer.currentTrack;
        this.studio.instruments.loadPresetData(file.data, track, file.name, { source: 'community' });
        this.studio.history.saveState('Instrument');
        this.onLoaded();
        this.onStatus(`${translateOr('library.opened', 'Opened')}: ${entry.name}`);
    }

    /** @returns {Promise<boolean>} whether it landed */
    async _loadSaved(entry, track) {
        let stored;
        try {
            stored = await this.library.read(LIBRARY_KINDS.presets, entry.id);
        } catch (error) {
            this.onStatus(
                `${translateOr('library.openfailed', 'Could not open')}: ${error.message}`
            );
            return false;
        }

        if (!stored) {
            this.onStatus(translateOr('library.gone', 'That project is no longer there'));
            await this.reload();
            return false;
        }

        this.studio.instruments.loadPresetData(stored.data, track, stored.name, {
            id: entry.id,
            source: 'library'
        });
        return true;
    }
}

/** @type {Map<string, {cover: string|null, name: string}>|null} */
let covers = null;

/**
 * Which kit each shipped instrument belongs to, worked out once.
 *
 * An instrument can be in more than one kit, the NES pulse is in several:
 * and the first one wins, which is the curated order, so the thumbnail is
 * stable rather than whichever kit happened to be read last.
 */
function kitCovers() {
    if (covers) return covers;

    covers = new Map();
    for (const kit of Object.values(shipped('kits'))) {
        for (const track of kit.data?.tracks ?? []) {
            if (track.presetKey && !covers.has(track.presetKey)) {
                covers.set(track.presetKey, { cover: kit.cover, name: kit.name });
            }
        }
    }
    return covers;
}
