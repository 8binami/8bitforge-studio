/**
 * Saving the sound on a track.
 *
 * The Library tab lists instruments and puts them on tracks; this is the
 * other direction: the two buttons in the studio window's header that file
 * the sound you have built, the window that names it, and the window that
 * renames or deletes one already filed.
 *
 * It also owns the badge beside the window's title, which is the only thing
 * that tells you whether the track is playing a preset or something you
 * have since altered. That question is answered by comparing the sound
 * against the sound the preset made when it landed, not by a flag: see
 * `isTrackModified` in `src/compose/instrument-library.js`.
 *
 * Save writes over the entry the track was loaded from; Save As always
 * makes a new one. Save only appears when there is something of the user's
 * own to write over: an instrument that ships with the studio is not
 * theirs to overwrite, and a track built from nothing has no entry yet.
 */

import { LIBRARY_KINDS } from '../storage/library.js';
import { SYNTH_EVENTS } from '../audio/synthesizer.js';
import { InstrumentBrowser } from './instrument-browser.js';
import { ItemDialog } from './item-dialog.js';
import { stackModal } from './modal-stack.js';
import {
    INSTRUMENT_CHOICES,
    USER_CATEGORY,
    categoryLabel,
    categoryKey
} from './library-categories.js';
import { translateOr } from '../i18n/i18n.js';

/** What both windows are called and warn about. */
const KEYS = Object.freeze({ delete: 'lib.delete', deleteConfirm: 'lib.deleteConfirm' });

/**
 * The shelf a new instrument is offered, by the track it came off.
 *
 * A guess, and it only fills the field in: the eight tracks of this studio
 * have fixed jobs, so the sound on the bass track is nearly always a bass.
 * A noise oscillator overrides it: that is a drum wherever it sits.
 */
const CATEGORY_BY_TRACK = Object.freeze([
    'leads',
    'chords',
    'bass',
    'arps',
    'drums',
    'drums',
    'drums',
    'fx'
]);

export class InstrumentPresets {
    /**
     * @param {object} options
     * @param {ParentNode} options.root
     * @param {import('../studio.js').Studio} options.studio
     * @param {import('../storage/library.js').Library} options.library
     * @param {import('../storage/favorites.js').Favorites} options.favorites
     * @param {() => void} [options.onLoaded]  the track's sound changed
     * @param {(text: string) => void} [options.onStatus]
     */
    constructor({ root, studio, library, favorites, community = null, onLoaded = () => {}, onStatus = () => {} }) {
        this.root = root;
        this.studio = studio;
        this.library = library;
        this.favorites = favorites;
        this.community = community;
        this.onLoaded = onLoaded;
        this.onStatus = onStatus;
    }

    bind() {
        const shared = {
            root: this.root,
            library: this.library,
            favorites: this.favorites,
            kind: LIBRARY_KINDS.presets,
            categories: INSTRUMENT_CHOICES,
            defaultCategory: USER_CATEGORY,
            categoryLabel: (category) => categoryLabel('instrument', category),
            categoryKey: (category) => categoryKey('instrument', category),
            keys: KEYS,
            onStatus: this.onStatus
        };

        this.saveDialog = new ItemDialog({
            ...shared,
            elements: {
                modal: 'savePresetModal',
                name: 'savePresetName',
                category: 'savePresetCategory',
                tags: 'savePresetTags',
                confirm: 'savePresetConfirmBtn',
                hidden: ['savePresetShare', 'savePresetOfficialWrap']
            }
        });
        this.saveDialog.bind();

        this.editDialog = new ItemDialog({
            ...shared,
            elements: {
                modal: 'editPresetModal',
                name: 'editPresetName',
                category: 'editPresetCategory',
                tags: 'editPresetTags',
                confirm: 'editPresetConfirmBtn',
                delete: 'editPresetDeleteBtn',
                hidden: ['editPresetShare']
            }
        });
        this.editDialog.bind();

        // Both open over the studio window, which Bootstrap does not expect.
        for (const id of ['savePresetModal', 'editPresetModal']) {
            stackModal(this.root.querySelector('#' + id));
        }

        this.browser = new InstrumentBrowser({
            root: this.root,
            studio: this.studio,
            library: this.library,
            favorites: this.favorites,
            community: this.community,
            onEdit: (id) => this.edit(id),
            onLoaded: () => {
                this.sync();
                this.onLoaded();
            },
            onStatus: this.onStatus
        });
        this.browser.bind();

        this._bindHeader();

        // The badge follows the track being edited and the sound on it, and
        // both of those change from places that know nothing about this.
        this.studio.bus.on(SYNTH_EVENTS.changed, () => this.sync());
        this.studio.bus.on(SYNTH_EVENTS.trackSelected, () => this.sync());
    }

    _bindHeader() {
        this._header = {
            badge: this.root.querySelector('#studioPresetName'),
            reset: this.root.querySelector('#presetResetBtn'),
            overwrite: this.root.querySelector('#savePresetOverwriteHeaderBtn'),
            saveAs: this.root.querySelector('#savePresetAsHeaderBtn')
        };

        this._header.saveAs?.addEventListener('click', () => this.saveAs());
        this._header.overwrite?.addEventListener('click', () => this.overwrite());
        this._header.reset?.addEventListener('click', () => this.revert());

        // The second confirm button of the save window belonged to a flow
        // where that window did the overwriting too. The header does it,
        // and a button in two places is two things to keep in step.
        this.root.querySelector('#savePresetOverwriteBtn')?.classList.add('d-none');
    }

    /** Fill the tab. Called as the studio window opens on it. */
    async open() {
        await this.browser.open();
    }

    // ── The header ───────────────────────────────────────────────────────

    /**
     * Read the badge, the Reset button and the Save button back from the
     * track. All three say the same thing in different words: what is on
     * this track, and is it still what was put there.
     */
    sync() {
        if (!this._header) return;

        const track = this.studio.synthesizer.currentTrack;
        const loaded = this.studio.instruments.getTrackPreset(track);
        const modified = this.studio.instruments.isTrackModified(track);

        const { badge, reset, overwrite } = this._header;
        if (badge) {
            const name = loaded?.name ?? '';
            badge.textContent = modified
                ? `${translateOr('lib.modified', 'Modified')}: ${name}`
                : name;
            badge.className = modified
                ? 'badge bg-warning bg-opacity-25 text-warning ms-2'
                : 'badge bg-info bg-opacity-25 text-info ms-2';
            badge.classList.toggle('d-none', !name);
        }

        // Shown when there is somewhere to go, which is not the same as
        // being modified: a sound that arrived already edited away from
        // its preset reads as modified and has nothing to go back to.
        reset?.classList.toggle('d-none', !this.studio.instruments.canRevertTrack(track));

        // Only the user's own entries can be written over. A shipped
        // instrument has no library entry at all, and would not be theirs
        // to change if it had.
        overwrite?.classList.toggle('d-none', loaded?.source !== 'library' || !loaded.id);
    }

    /**
     * Put the track back to the sound that was loaded onto it.
     *
     * The library replays what it recorded when the sound arrived, so
     * this works for a shipped instrument, a saved one, a kit slot and a
     * voice out of a project file alike. It used to fetch the source
     * again, which meant the last two - which have no library entry -
     * were offered a button that returned early and did nothing, and
     * meant that saving over an instrument changed where Reset went.
     */
    revert() {
        const track = this.studio.synthesizer.currentTrack;
        const loaded = this.studio.instruments.getTrackPreset(track);

        if (!this.studio.instruments.revertTrack(track)) return;

        this.studio.history.saveState('Revert instrument');
        this.sync();
        this.onLoaded();
        this.onStatus(
            `${translateOr('lib.reverted', 'Reverted')}${loaded?.name ? `: ${loaded.name}` : ''}`
        );
    }

    // ── Saving ───────────────────────────────────────────────────────────

    /**
     * Name and file the sound on the current track as a new instrument.
     * @returns {Promise<string|null>} the id written, or null
     */
    async saveAs() {
        const track = this.studio.synthesizer.currentTrack;
        const loaded = this.studio.instruments.getTrackPreset(track);

        const id = await this.saveDialog.open({
            // Its own name, so that saving a variation of something starts
            // from what it is a variation of rather than from an empty box.
            name: loaded?.name ?? '',
            category: this._categoryFor(track),
            capture: () => this.studio.synthesizer.getFullPresetState(track)
        });
        if (!id) return null;

        await this._adopt(track, id);
        return id;
    }

    /** Write the track's sound over the entry it was loaded from. */
    async overwrite() {
        const track = this.studio.synthesizer.currentTrack;
        const loaded = this.studio.instruments.getTrackPreset(track);
        if (loaded?.source !== 'library' || !loaded.id) return;

        const stored = await this._read(loaded.id);
        if (!stored) return;

        try {
            await this.library.write(LIBRARY_KINDS.presets, {
                id: loaded.id,
                name: stored.name,
                category: stored.category ?? USER_CATEGORY,
                tags: stored.tags ?? [],
                data: this.studio.synthesizer.getFullPresetState(track)
            });
        } catch (error) {
            this.onStatus(
                `${translateOr('library.savefailed', 'Could not save')}: ${error.message}`
            );
            return;
        }

        await this._adopt(track, loaded.id);
        this.onStatus(`${translateOr('library.saved', 'Saved')}: ${stored.name}`);
    }

    /** @param {string} id */
    async edit(id) {
        const stored = await this._read(id);
        if (!stored) return;

        const written = await this.editDialog.open({
            id,
            name: stored.name,
            category: stored.category ?? USER_CATEGORY,
            tags: stored.tags ?? []
        });

        await this._followEdit(id, written);
    }

    /**
     * Keep the tracks in step with what just happened to an entry.
     *
     * An entry's id comes from its name, so renaming one moves it. A track
     * still pointing at where it was would go on showing the old name, and
     * Save would write to an id nothing is filed under any more: quietly
     * putting back the entry the rename took away, or the delete did.
     *
     * @param {string} was      the id before
     * @param {string|null} now the id the window wrote, or null: which it
     *   returns both for a delete and for being dismissed
     */
    async _followEdit(was, now) {
        // Those two nulls mean opposite things, and only the library can
        // say which happened: the entry is either still there or it is not.
        const still = now ?? ((await this._exists(was)) ? was : null);
        if (still === was) {
            this.sync();
            return;
        }

        const entry = still ? await this._read(still) : null;

        for (let track = 0; track < this.studio.audioEngine.tracks.length; track++) {
            const loaded = this.studio.instruments.getTrackPreset(track);
            if (loaded?.source !== 'library' || loaded.id !== was) continue;

            this.studio.instruments.loadPresetData(
                this.studio.synthesizer.getFullPresetState(track),
                track,
                // Deleted: the sound stays on the track, it is simply in
                // nobody's library any more.
                entry?.name ?? null,
                entry ? { id: still, source: 'library' } : { id: null, source: 'custom' }
            );
        }

        this.sync();
    }

    /** @param {string} id */
    async _exists(id) {
        try {
            return (await this.library.read(LIBRARY_KINDS.presets, id)) != null;
        } catch {
            // Unreadable is not absent. Treating a broken file as deleted
            // would orphan a track that is still playing that instrument.
            return true;
        }
    }

    // ── Internals ────────────────────────────────────────────────────────

    /**
     * Say that the track is now playing the entry it was just written to.
     *
     * Without this the sound is in the library and the track still counts
     * as unsaved, so Save stays hidden and the badge goes on calling it
     * modified: the one thing the person who just pressed Save knows to
     * be untrue.
     */
    async _adopt(track, id) {
        // Read back rather than reuse what was typed: saving under a name
        // that is already taken writes to that entry, so the id decides the
        // name and not the other way round.
        const stored = await this._read(id);
        if (!stored) return;

        this.studio.instruments.loadPresetData(
            this.studio.synthesizer.getFullPresetState(track),
            track,
            stored.name,
            { id, source: 'library' }
        );

        // The listing redraws itself: a write announces on the bus and the
        // browser is listening. What it cannot know is which row is now the
        // one playing.
        this.browser.openId = id;
        this.sync();
    }

    /** @param {number} track */
    _categoryFor(track) {
        if (this.studio.audioEngine.tracks[track]?.type === 'noise') return 'drums';
        return CATEGORY_BY_TRACK[track] ?? USER_CATEGORY;
    }

    async _read(id) {
        try {
            const stored = await this.library.read(LIBRARY_KINDS.presets, id);
            if (stored) return stored;

            this.onStatus(translateOr('library.gone', 'That project is no longer there'));
        } catch (error) {
            this.onStatus(
                `${translateOr('library.openfailed', 'Could not open')}: ${error.message}`
            );
        }
        return null;
    }
}
