/**
 * The generator's presets.
 *
 * Two buttons on the generator card and the three windows behind them: the
 * browser that lists what there is, the window that names a new one, and the
 * window that renames or deletes one that exists.
 *
 * This holds them together so that the generator card itself does not have
 * to know the library exists: it generates music; filing the settings that
 * produced it is a separate job.
 */

import { LIBRARY_KINDS } from '../storage/library.js';
import { GeneratorPresetBrowser } from './generator-preset-browser.js';
import { ItemDialog } from './item-dialog.js';
import { GENERATOR_GENRES, DEFAULT_GENRE, genreLabel, genreKey } from './generator-genres.js';

/** What both windows are called and warn about. */
const KEYS = Object.freeze({ delete: 'genp.delete', deleteConfirm: 'genp.deleteConfirm' });

export class GeneratorPresets {
    /**
     * @param {object} options
     * @param {ParentNode} options.root
     * @param {import('../studio.js').Studio} options.studio
     * @param {import('../storage/library.js').Library} options.library
     * @param {import('../storage/favorites.js').Favorites} options.favorites
     * @param {(text: string) => void} [options.onStatus]
     */
    constructor({ root, studio, library, favorites, community = null, onStatus = () => {} }) {
        this.root = root;
        this.studio = studio;
        this.library = library;
        this.favorites = favorites;
        this.community = community;
        this.onStatus = onStatus;
    }

    bind() {
        const shared = {
            root: this.root,
            library: this.library,
            favorites: this.favorites,
            kind: LIBRARY_KINDS.generatorPresets,
            categories: GENERATOR_GENRES,
            defaultCategory: DEFAULT_GENRE,
            categoryLabel: genreLabel,
            categoryKey: genreKey,
            keys: KEYS,
            onStatus: this.onStatus
        };

        this.saveDialog = new ItemDialog({
            ...shared,
            elements: {
                modal: 'saveGenPresetModal',
                name: 'saveGenPresetName',
                category: 'saveGenPresetCategory',
                tags: 'saveGenPresetTags',
                confirm: 'saveGenPresetConfirmBtn',
                hidden: ['saveGenPresetShare', 'saveGenPresetOfficialWrap']
            }
        });
        this.saveDialog.bind();

        this.editDialog = new ItemDialog({
            ...shared,
            elements: {
                modal: 'editGenPresetModal',
                name: 'editGenPresetName',
                category: 'editGenPresetCategory',
                tags: 'editGenPresetTags',
                confirm: 'editGenPresetConfirmBtn',
                delete: 'editGenPresetDeleteBtn',
                hidden: ['editGenPresetShare']
            }
        });
        this.editDialog.bind();

        this.browser = new GeneratorPresetBrowser({
            root: this.root,
            studio: this.studio,
            library: this.library,
            favorites: this.favorites,
            community: this.community,
            onEdit: (id) => this.edit(id),
            onStatus: this.onStatus
        });
        this.browser.bind();

        this.root.querySelector('#saveGenPresetBtn')?.addEventListener('click', () => this.save());
        this.root.querySelector('#loadGenPresetBtn')?.addEventListener('click', () => {
            this.browser.open();
        });
    }

    /** Name and file the settings the generator is set to now. */
    save() {
        const state = this.studio.generator.getState();

        return this.saveDialog.open({
            // Nothing to pre-fill a name with: a preset is named when it is
            // made, and the generator has no name of its own.
            category: state.genre || DEFAULT_GENRE,
            capture: () => this.studio.generator.getState()
        });
    }

    /** @param {string} id */
    async edit(id) {
        const stored = await this.library.read(LIBRARY_KINDS.generatorPresets, id);
        if (!stored) return;

        await this.editDialog.open({
            id,
            name: stored.name,
            category: stored.category ?? DEFAULT_GENRE,
            tags: stored.tags ?? []
        });
    }
}
