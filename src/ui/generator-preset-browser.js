/**
 * The Load Generator Preset window.
 *
 * A generator preset is the dozen numbers the generator writes music from:
 * chaos, density, key, genre, mood, the seed: under a name. Loading one
 * does not write anything: it sets the dials, and the next Generate is what
 * makes a pattern from them.
 *
 * Unlike the project browser this one has two sources. The presets that ship
 * with the studio live in the generator module, and the ones someone saves
 * live in the library; the two chips at the top say which you are looking
 * at, and neither of them pressed means both.
 */

import { LIBRARY_KINDS } from '../storage/library.js';
import { PresetBrowser } from './preset-browser.js';
import { GENERATOR_GENRES, DEFAULT_GENRE, genreLabel, genreKey } from './generator-genres.js';
import { translateOr } from '../i18n/i18n.js';

export class GeneratorPresetBrowser extends PresetBrowser {
    /**
     * @param {object} options
     * @param {ParentNode} options.root
     * @param {import('../studio.js').Studio} options.studio
     * @param {import('../storage/library.js').Library} options.library
     * @param {import('../storage/favorites.js').Favorites} options.favorites
     * @param {import('../account/community.js').Community|null} [options.community]
     * @param {(id: string) => void} [options.onEdit]
     * @param {(text: string) => void} [options.onStatus]
     */
    constructor({ root, studio, library, favorites, community = null, onEdit = () => {}, onStatus = () => {} }) {
        super({
            root,
            studio,
            favorites,
            kind: LIBRARY_KINDS.generatorPresets,
            categories: GENERATOR_GENRES,
            columns: 6,
            elements: {
                modal: 'loadGenPresetModal',
                search: 'genPresetSearchInput',
                count: 'genPresetCount',
                body: 'genPresetTableBody',
                empty: 'genPresetEmptyState',
                table: 'genPresetTable',
                typeMenu: 'genTypeFilterMenu',
                favorites: 'genFavFilterBtn',
                shuffle: 'genShuffleBtn',
                community: 'genCommunityFilterBtn',
                sources: ['genBuiltinFilterBtn', 'genUserFilterBtn'],
                import: 'genImportBtn'
            },
            community,
            onStatus
        });

        this.library = library;
        this.onEdit = onEdit;

        /** @type {'builtin'|'library'|null} which source, or both. */
        this._source = null;
    }

    bound() {
        const chips = {
            genBuiltinFilterBtn: 'builtin',
            genUserFilterBtn: 'library'
        };

        for (const [id, source] of Object.entries(chips)) {
            this.root.querySelector(`#${id}`)?.addEventListener('click', (event) => {
                // Pressing the chip that is already down shows both again:
                // there is no third source to fall back to.
                this._source = this._source === source ? null : source;

                for (const other of Object.keys(chips)) {
                    this.root
                        .querySelector(`#${other}`)
                        ?.classList.toggle('active', chips[other] === this._source);
                }
                event.currentTarget.blur();
                this.render();
            });
        }
    }

    categoryLabel(genre) {
        return genreLabel(genre);
    }

    categoryKey(genre) {
        return genreKey(genre);
    }

    countLabel(total) {
        return translateOr('genp.count', '{0} presets').replace('{0}', String(total));
    }

    keeps(entry) {
        return !this._source || entry.source === this._source;
    }

    async fetch() {
        const builtin = this.studio.generator.getBuiltinPresetList().map((preset) => ({
            id: preset.id,
            name: preset.name,
            category: preset.type ?? DEFAULT_GENRE,
            designer: preset.designer,
            tags: [],
            updatedAt: null,
            source: 'builtin',
            item: preset.data
        }));

        const saved = (await this.library.list(LIBRARY_KINDS.generatorPresets)).map((entry) => ({
            id: entry.id,
            name: entry.name,
            category: entry.category ?? DEFAULT_GENRE,
            // Nobody to credit but the person sitting here.
            designer: '-',
            tags: entry.tags ?? [],
            updatedAt: entry.updatedAt,
            source: 'library'
        }));

        return [...builtin, ...saved];
    }

    cells(entry) {
        return this.commonCells(entry);
    }

    defaultCategory() {
        return DEFAULT_GENRE;
    }

    edit(entry) {
        // Both windows are full-width modals; the edit window would open
        // behind this one.
        this.close();
        this.onEdit(entry.id);
    }

    async load(entry) {
        const state = entry.source === 'builtin' ? entry.item : await this._read(entry.id);
        if (!state) return;

        // Loading a preset changes the project, so it is undoable like any
        // other change to it: and the snapshot follows the change, or one
        // undo would step back past the change before it too.
        this.studio.generator.loadState(state);
        this.studio.history.saveState('Generator preset');

        this.openId = entry.id;
        this.onStatus(`${translateOr('library.opened', 'Opened')}: ${entry.name}`);
        this.close();
    }

    /** A shared preset sets the dials; the next Generate is what hears it. */
    async openShared(file, entry) {
        this.studio.generator.loadState(file.data);
        this.studio.history.saveState('Generator preset');
        this.onStatus(`${translateOr('library.opened', 'Opened')}: ${entry.name}`);
        this.close();
    }

    async _read(id) {
        try {
            const stored = await this.library.read(LIBRARY_KINDS.generatorPresets, id);
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
}
