/**
 * The window that makes a kit.
 *
 * A kit is eight instruments, one per track, under a name: so this is
 * `ItemDialog` with eight pickers and a cover added to it. The pickers
 * offer every shipped instrument, everything the user has saved, and, at
 * the top of each, whatever is on that track right now.
 *
 * Picking one plays it. Building a kit by reading names and pressing Save
 * is guesswork; the whole value of the window is hearing the eight
 * together, so each choice lands on its track as it is made.
 *
 * Which means the window is editing the project while it is open, and has
 * to put it back if nothing is saved. That is what the snapshot is for:
 * the eight sounds as they were when the window opened, restored the
 * moment it closes on anything but a save. Saving keeps what you built,
 * which is the point of having built it.
 */

import { LIBRARY_KINDS } from '../storage/library.js';
import { ItemDialog } from './item-dialog.js';
import { coverFromFile } from './cover-image.js';
import { escapeHtml } from './preset-browser.js';
import {
    KIT_CATEGORIES,
    DEFAULT_KIT_CATEGORY,
    categoryLabel,
    categoryKey
} from './library-categories.js';
import { translateOr } from '../i18n/i18n.js';

const TRACK_COUNT = 8;

/** What both windows are called and warn about. */
const KEYS = Object.freeze({ delete: 'kit.delete', deleteConfirm: 'kit.deleteConfirm' });

/** The value a picker carries for "leave this track as it is". */
const CURRENT = 'current';

/** How a picker names one of the user's own instruments, to tell it from a key. */
const SAVED = 'saved:';

export class KitDialog extends ItemDialog {
    /**
     * @param {object} options
     * @param {ParentNode} options.root
     * @param {import('../studio.js').Studio} options.studio
     * @param {import('../storage/library.js').Library} options.library
     * @param {import('../storage/favorites.js').Favorites} options.favorites
     * @param {object} options.elements  the ids of this window, plus
     *   `tracks` (the picker id prefix), `cover`, `coverPreview` and
     *   optionally `capture`
     * @param {() => void} [options.onLoaded]  the tracks changed under us
     * @param {(text: string) => void} [options.onStatus]
     */
    constructor({ root, studio, library, favorites, elements, onLoaded = () => {}, ...rest }) {
        super({
            root,
            library,
            favorites,
            kind: LIBRARY_KINDS.kits,
            elements,
            categories: KIT_CATEGORIES,
            defaultCategory: DEFAULT_KIT_CATEGORY,
            categoryLabel: (category) => categoryLabel('kit', category),
            categoryKey: (category) => categoryKey('kit', category),
            keys: KEYS,
            ...rest
        });

        this.studio = studio;
        this.onLoaded = onLoaded;

        /** @type {HTMLSelectElement[]} */
        this._pickers = [];
        /** The slots of the kit being edited, if one is. */
        this._original = null;
        /** Which pickers the user has moved since the window opened. */
        this._touched = [];
        /** The eight sounds as they were when the window opened. */
        this._snapshot = null;
        /** The cover as the window currently shows it, saved only on accept. */
        this._cover = null;
    }

    bound() {
        for (let track = 0; track < TRACK_COUNT; track++) {
            const picker = this._el(`${this.elements.tracks}${track}`);
            this._pickers.push(picker);

            picker?.addEventListener('change', () => {
                this._touched[track] = true;
                this._audition(track, picker.value);
            });
        }

        this._coverInput = this._el(this.elements.cover);
        this._coverPreview = this._el(this.elements.coverPreview);
        this._coverInput?.addEventListener('change', () => this._pickCover());

        // "Capture current" points all eight pickers back at the tracks,
        // which is how you file the sounds you have just spent an hour on
        // rather than a list of names.
        this._el(this.elements.capture)?.addEventListener('click', () => {
            for (const picker of this._pickers) {
                if (picker) picker.value = CURRENT;
            }
            // Pressing it is the clearest statement there is that every
            // slot is meant to change.
            this._touched = Array(TRACK_COUNT).fill(true);
            this._restore();
        });
    }

    // ── The eight pickers ────────────────────────────────────────────────

    /**
     * Fill the window from a kit, or from nothing for a new one.
     *
     * @param {{item: {tracks: Array<object>}|null}} what
     */
    fill({ item = null } = {}) {
        // The tracks as they are now, to be put back if nothing is saved:
        // and to be offered as the `current` choice while the window is up.
        this._snapshot = this._capture();
        this._cover = item?.cover ?? null;
        this._showCover();

        const options = this._options();
        const tracks = item?.tracks ?? [];

        // A kit being edited keeps every slot the user does not move. The
        // window is usually opened to fix a name, and the tracks behind it
        // are whatever was being worked on: so reading them back into the
        // kit would quietly replace its sounds with the current project's.
        this._original = item ? tracks : null;
        this._touched = Array(TRACK_COUNT).fill(false);

        for (let track = 0; track < TRACK_COUNT; track++) {
            const picker = this._pickers[track];
            if (!picker) continue;

            picker.innerHTML = options;
            picker.value = valueFor(tracks[track]);
            // A kit slot holding a sound rather than a name has nothing in
            // the list to select, so it falls back to the track as it is:
            // which is what the slot was applied onto on the way in.
            if (!picker.value) picker.value = CURRENT;
        }
    }

    /**
     * Open the window. The payload is always the eight pickers, so it is
     * supplied here rather than asked of the caller.
     *
     * @param {Parameters<ItemDialog['open']>[0]} [what]
     */
    open(what = {}) {
        return super.open({ ...what, capture: () => this._tracks() });
    }

    /** The eight tracks, as a kit's payload. */
    _tracks() {
        return {
            tracks: Array.from({ length: TRACK_COUNT }, (_, track) =>
                this._slot(track, this._pickers[track]?.value ?? CURRENT)
            )
        };
    }

    /**
     * One track, as a kit slot.
     *
     * There are two ways to store it and the choice matters. A shipped
     * instrument is stored by name: the kit stays a few hundred bytes, and
     * it follows that instrument if it is ever improved. Anything else is
     * stored as the sound itself, because a kit that pointed at one of the
     * user's own presets would fall silently back to whatever the track
     * happened to hold on the day they deleted that preset.
     *
     * A picker left on "current sound" is whichever of the two the track
     * is, which is worth working out rather than assuming the second: the
     * common way to build a kit is to load eight instruments and then file
     * them, and that should file eight names.
     *
     * A picker nobody moved, in a kit being edited, is the slot the kit
     * already had: read neither from the list nor from the track.
     *
     * @param {number} track
     * @param {string} chosen  a shipped key, `saved:<id>`, or `current`
     */
    _slot(track, chosen) {
        const untouched = this._original?.[track];
        if (untouched && !this._touched[track]) return untouched;

        const named = chosen === CURRENT ? this._builtinOn(track) : chosen;
        const preset = this.studio.instruments.presets[named];

        if (preset) return { presetKey: named, presetType: 'builtin', displayName: preset.name };

        return {
            presetKey: null,
            presetType: 'custom',
            presetData: this.studio.synthesizer.getFullPresetState(track),
            displayName: this.studio.instruments.getTrackPresetName(track)
        };
    }

    /** The shipped instrument a track is playing untouched, if it is one. */
    _builtinOn(track) {
        const held = this.studio.instruments.getTrackPreset(track);
        if (held?.source !== 'builtin' || !held.id) return null;

        // Altered since it was loaded: the name would no longer bring back
        // the sound that is actually on the track.
        return this.studio.instruments.isTrackModified(track) ? null : held.id;
    }

    /** The cover goes on the envelope, beside the name and the tags. */
    collect() {
        return { cover: this._cover };
    }

    closed(written) {
        // Saved: the tracks are the kit that was just filed, and taking
        // them away again would undo the thing the person came to do.
        if (!written) this._restore();

        this._snapshot = null;
        if (this._coverInput) this._coverInput.value = '';
    }

    /**
     * Put one instrument on one track, so it can be heard in place.
     *
     * @param {number} track
     * @param {string} value  a shipped key, `saved:<id>`, or `current`
     */
    async _audition(track, value) {
        if (value === CURRENT) {
            this._restoreTrack(track);
        } else if (value.startsWith(SAVED)) {
            const id = value.slice(SAVED.length);
            const stored = await this._readPreset(id);

            if (stored) {
                this.studio.instruments.loadPresetData(stored.data, track, stored.name, {
                    id,
                    source: 'library'
                });
            } else {
                // Deleted since the window was opened. The track goes back
                // to what it held rather than keeping a sound that is not
                // the one the picker is naming.
                this._restoreTrack(track);
                this.onStatus(translateOr('library.gone', 'That project is no longer there'));
            }
        } else {
            this.studio.instruments.loadPreset(value, track);
        }

        this.onLoaded();
    }

    async _readPreset(id) {
        try {
            return await this.library.read(LIBRARY_KINDS.presets, id);
        } catch {
            return null;
        }
    }

    /** Everything a picker can offer, as `<optgroup>`s. */
    _options() {
        const groups = [
            `<option value="${CURRENT}">${escapeHtml(
                translateOr('kit.currentSound', '♪ Current sound')
            )}</option>`
        ];

        if (this._saved?.length) {
            groups.push(
                group(
                    translateOr('kit.myPresets', 'My Presets'),
                    this._saved.map((entry) => [SAVED + entry.id, entry.name])
                )
            );
        }

        const byCategory = this.studio.instruments.getPresetsByCategory();
        for (const [category, keys] of Object.entries(byCategory)) {
            if (keys.length === 0) continue;

            groups.push(
                group(
                    categoryLabel('instrument', category),
                    keys.map((key) => [key, this.studio.instruments.presets[key].name ?? key])
                )
            );
        }

        return groups.join('');
    }

    /**
     * Read the user's own instruments, so the pickers can offer them.
     *
     * Done before the window opens rather than inside `fill`, which has to
     * be synchronous: it is filling eight `<select>` elements that are
     * about to be on screen.
     */
    async prepare() {
        try {
            this._saved = await this.library.list(LIBRARY_KINDS.presets);
        } catch {
            // A library that cannot be read costs the user their own
            // instruments in this list, not the window.
            this._saved = [];
        }
    }

    // ── The tracks, before and after ─────────────────────────────────────

    _capture() {
        // The record as well as the sound. Reloading the sound alone
        // makes it its own baseline, so a track that was edited away
        // from its preset came back from a dismissed window claiming to
        // be that preset.
        const records = this.studio.instruments.captureTrackPresets();

        return Array.from({ length: TRACK_COUNT }, (_, track) => ({
            state: this.studio.synthesizer.getFullPresetState(track),
            record: records[track],
            preset: this.studio.instruments.getTrackPreset(track)
        }));
    }

    _restore() {
        for (let track = 0; track < TRACK_COUNT; track++) this._restoreTrack(track);
        this.onLoaded();
    }

    _restoreTrack(track) {
        const held = this._snapshot?.[track];
        if (!held) return;

        this.studio.instruments.loadPresetData(held.state, track, held.preset?.name ?? null, {
            id: held.preset?.id ?? null,
            source: held.preset?.source ?? 'custom'
        });
        // `loadPresetData` has just made the restored sound the new
        // baseline. The old one is what this track actually had.
        this.studio.instruments.rememberTrackPreset(track, held.record);
    }

    // ── The cover ────────────────────────────────────────────────────────

    async _pickCover() {
        const file = this._coverInput?.files?.[0];
        if (!file) return;

        this._cover = await coverFromFile(file);
        this._showCover();
    }

    _showCover() {
        if (!this._coverPreview) return;

        const image = this._coverPreview.querySelector('img');
        if (image) image.src = this._cover ?? '';
        this._coverPreview.classList.toggle('d-none', !this._cover);
    }
}

/** @param {object|undefined} slot */
function valueFor(slot) {
    return slot?.presetType === 'builtin' && slot.presetKey ? slot.presetKey : '';
}

function group(label, entries) {
    const options = entries
        .map(([value, name]) => `<option value="${escapeHtml(value)}">${escapeHtml(name)}</option>`)
        .join('');

    return `<optgroup label="${escapeHtml(label)}">${options}</optgroup>`;
}
