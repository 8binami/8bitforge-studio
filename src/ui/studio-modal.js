/**
 * The studio window.
 *
 * One window with four tabs over the same track: its voice, the kits it can
 * be loaded from, the instrument library, and the piano roll. The three
 * buttons on every track row open it on the tab they name, which is why it
 * takes a tab to open on rather than always starting where it was left.
 *
 * The header changes with the tab: the synth tab has its save buttons, the
 * piano roll has its track picker and its record buttons: because the
 * window is wide and those controls belong at the top of it rather than
 * inside the pane.
 *
 * Tabs whose panes have no module behind them yet are marked as such. An
 * empty pane behind a live tab reads as a bug; a tab that says it is not
 * ready reads as what it is.
 */

import { SYNTH_EVENTS } from '../audio/synthesizer.js';
import { UNDO_EVENTS } from '../core/undo-redo.js';
import { SynthPanel } from './synth-panel.js';
import { InstrumentPresets } from './instrument-presets.js';
import { Kits } from './kits.js';
import { PianoRoll } from './piano-roll.js';
import { KeyboardPanel, KEYBOARD_SKINS } from './keyboard-panel.js';
import { SynthMeters } from './synth-meters.js';

/** Tab name → the button that selects it and the header it brings with it. */
const TABS = Object.freeze({
    synth: { tab: 'studio-synth-tab', header: 'synthHeaderActions' },
    kits: { tab: 'studio-kits-tab', header: null },
    library: { tab: 'studio-lib-tab', header: null },
    pianoroll: { tab: 'studio-pr-tab', header: 'prHeaderActions' }
});

/**
 * Which of them has a module behind it. The rest are marked unavailable.
 *
 * A tab can also be ready in principle and not here: the Library saves to
 * storage, and a window built without storage has no Library tab. So this
 * is the ceiling, and `_ready` below is what a given window actually has.
 */
const READY = new Set(['synth', 'kits', 'library', 'pianoroll']);

export class StudioModal {
    /**
     * @param {object} options
     * @param {ParentNode} options.root
     * @param {import('../studio.js').Studio} options.studio
     * @param {import('../storage/library.js').Library} [options.library]
     * @param {import('../storage/favorites.js').Favorites} [options.favorites]
     * @param {() => void} [options.onLoaded]  a track's sound changed
     * @param {(text: string) => void} [options.onStatus]
     */
    constructor({
        root,
        studio,
        library = null,
        favorites = null,
        community = null,
        midi = null,
        playhead = null,
        onLoaded = () => {},
        onStatus = () => {}
    }) {
        this.root = root;
        this.studio = studio;
        this.library = library;
        this.favorites = favorites;
        this.community = community;
        this.playhead = playhead;
        this.midi = midi;
        this.onLoaded = onLoaded;
        this.onStatus = onStatus;

        /** The tabs this window can show, settled as it binds. */
        this._ready = new Set(READY);
    }

    bind() {
        this._element = this.root.querySelector('#studioModal');
        if (!this._element) return;

        // Every tab of this window is about one sound, and none of them can
        // be judged without hearing it. The keyboard on the card stands down
        // while a window is open, so the window brings its own.
        this.keyboard = new KeyboardPanel({
            root: this.root,
            studio: this.studio,
            midi: this.midi,
            skin: KEYBOARD_SKINS.window
        });
        this.keyboard.bind();

        this.synth = new SynthPanel({
            root: this.root,
            studio: this.studio,
            // The badge in the header says whether the track still sounds
            // like the preset it was loaded from, and the only way it can
            // know is to be told a knob moved.
            onEdited: () => this.instruments?.sync(),
            onStatus: this.onStatus
        });
        this.synth.bind();

        this.pianoRoll = new PianoRoll({
            root: this.root,
            studio: this.studio,
            playhead: this.playhead,
            onStatus: this.onStatus
        });
        this.pianoRoll.bind();

        this.meters = new SynthMeters({ root: this.root, studio: this.studio });
        this.meters.bind();

        // Without somewhere to save to, these two tabs would list what
        // the studio ships and refuse everything else; they stay marked
        // unavailable instead, the way a tab with no module behind it is.
        if (this.library && this.favorites) {
            this.instruments = new InstrumentPresets({
                root: this.root,
                studio: this.studio,
                library: this.library,
                favorites: this.favorites,
                community: this.community,
                onLoaded: this.onLoaded,
                onStatus: this.onStatus
            });
            this.instruments.bind();

            this.kits = new Kits({
                root: this.root,
                studio: this.studio,
                library: this.library,
                favorites: this.favorites,
                community: this.community,
                onList: (kit) => this.showKitInLibrary(kit),
                onApplied: () => {
                    // A kit changes all eight tracks at once, including the
                    // one this window is showing.
                    this.sync();
                    this.onLoaded();
                },
                onStatus: this.onStatus
            });
            this.kits.bind();
        } else {
            this._ready.delete('library');
            this._ready.delete('kits');
        }

        this._bindTabs();
        this._bindOpeners();

        // The window edits whichever track is selected, and a track row can
        // select one while the window is open.
        this.studio.bus.on(SYNTH_EVENTS.trackSelected, () => this._onTrackChanged());

        // A preset loaded elsewhere changes every control here.
        this.studio.bus.on(SYNTH_EVENTS.changed, () => {
            if (this.isOpen) this.synth.sync();
        });

        // Undo puts a whole project state back on the engine without going
        // through the synthesizer, so it announces nothing this window would
        // otherwise hear: and the controls would go on showing the values
        // that were just undone.
        this.studio.bus.on(UNDO_EVENTS.changed, () => {
            if (this.isOpen) this.sync();
        });

        this._bindLifetime();
        this._showHeaderFor(this._currentTab());
    }

    /**
     * @param {keyof TABS} [tab]  which tab to show; the last one otherwise
     */
    open(tab = null) {
        if (!this._element || !window.bootstrap) return;

        if (tab && this._ready.has(tab)) this._select(tab);
        this.sync();

        window.bootstrap.Modal.getOrCreateInstance(this._element).show();

        // Filling the two listings is the only thing here that reads
        // storage, so it happens after the window is up rather than
        // delaying it.
        this.instruments?.open();
        this.kits?.open();
        this.pianoRoll?.open();
    }

    /**
     * Show the instruments of one kit in the Library tab.
     *
     * @param {{name: string, presets: string[]}} kit
     */
    showKitInLibrary(kit) {
        if (!this.instruments || !this._ready.has('library')) return;

        this.instruments.browser.showKit(kit);
        this._select('library');
    }

    close() {
        if (!this._element) return;
        window.bootstrap?.Modal.getOrCreateInstance(this._element).hide();
    }

    /**
     * Who is drawing, and when to stop them.
     *
     * The piano roll runs an animation frame for its playhead while the
     * sequencer plays, and the meters run one for as long as the Synth
     * tab is in front. Off screen either would go on doing it, so the
     * window says when it is gone: whichever way it was closed.
     */
    _bindLifetime() {
        this._element.addEventListener('hidden.bs.modal', () => {
            this.pianoRoll?.close();
            this.meters?.stop();
            // Closing the window with a key held would leave the note
            // sounding, with nothing left on screen to let go of it.
            this.keyboard?.disable();
        });
        this._element.addEventListener('shown.bs.modal', () => {
            // A canvas laid out while its window was hidden has no width
            // to measure, so the first honest size it can take is here.
            this.synth.redraw();
            this.pianoRoll?.shown();
            if (this._currentTab() === 'synth') this.meters?.shown();
            this.keyboard?.enable();
        });

        // The meters watch the sound sixty times a second, which is worth
        // doing while you are looking at them and not otherwise.
        for (const [name, { tab }] of Object.entries(TABS)) {
            this.root.querySelector(`#${tab}`)?.addEventListener('shown.bs.tab', () => {
                if (name === 'synth') this.meters?.shown();
                else this.meters?.stop();
            });
        }
    }

    get isOpen() {
        return Boolean(this._element?.classList.contains('show'));
    }

    /** Read the whole window back from the studio. */
    sync() {
        this.synth.sync();
        this.instruments?.sync();
        this._syncTitle();
    }

    // ── Tabs ─────────────────────────────────────────────────────────────

    _bindTabs() {
        for (const [name, { tab }] of Object.entries(TABS)) {
            const button = this.root.querySelector(`#${tab}`);
            if (!button) continue;

            if (!this._ready.has(name)) {
                // Bootstrap's own guard: a disabled tab button does not
                // switch panes, and the styling says why.
                button.classList.add('disabled');
                button.setAttribute('aria-disabled', 'true');
                button.removeAttribute('data-bs-toggle');
                button.addEventListener('click', (event) => event.preventDefault());
                continue;
            }

            button.addEventListener('shown.bs.tab', () => this._showHeaderFor(name));
        }
    }

    _select(name) {
        const button = this.root.querySelector(`#${TABS[name].tab}`);
        if (!button) return;

        window.bootstrap?.Tab.getOrCreateInstance(button).show();
        this._showHeaderFor(name);
    }

    /** Which tab is on screen now. */
    _currentTab() {
        for (const [name, { tab }] of Object.entries(TABS)) {
            if (this.root.querySelector(`#${tab}`)?.classList.contains('active')) return name;
        }
        return 'synth';
    }

    _showHeaderFor(name) {
        for (const { header } of Object.values(TABS)) {
            if (!header) continue;
            this.root.querySelector(`#${header}`)?.classList.add('d-none');
        }

        const header = TABS[name]?.header;
        this.root.querySelector(`#${header}`)?.classList.remove('d-none');
    }

    // ── Getting in ───────────────────────────────────────────────────────

    /** Whether a tab has a module behind it yet. */
    canOpen(tab) {
        return this._ready.has(tab);
    }

    /**
     * The sidebar entries that open this window. The three buttons on every
     * track row open it too, but those belong to the track rows: the track
     * has to be selected before the window is told to show it.
     */
    _bindOpeners() {
        const sidebar = {
            navOpenAdvanced: 'synth',
            navOpenKits: 'kits',
            navOpenInstruments: 'library',
            navOpenPianoRoll: 'pianoroll'
        };

        for (const [id, tab] of Object.entries(sidebar)) {
            const link = this.root.querySelector(`#${id}`);
            if (!link || !this._ready.has(tab)) continue;

            link.classList.remove('disabled');
            link.dataset.forgeBound = 'true';
            link.addEventListener('click', (event) => {
                event.preventDefault();
                this.open(tab);
            });
        }
    }

    // ── Keeping up ───────────────────────────────────────────────────────

    _onTrackChanged() {
        this.sync();
    }

    /**
     * The window's title carries the track it is editing: with eight voices
     * and one window, "Studio" on its own says too little.
     */
    _syncTitle() {
        const track = this.studio.synthesizer.currentTrack;
        const label = this.root
            .querySelector(`.track[data-track="${track}"] .track-label`)
            ?.textContent.trim();

        const badge = this.root.querySelector('#studioTrackName');
        if (badge) badge.textContent = label ?? '';
    }
}
