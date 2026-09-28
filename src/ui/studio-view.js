/**
 * The studio screen.
 *
 * The markup is the interface the studio has always had: the sidebar, the
 * topbar, the ten cards, the tabs and the modals: kept in `app-shell.html`
 * and imported as text. Porting it wholesale rather than rewriting it means
 * the app looks and behaves as it did; what changed is everything behind it,
 * which is now the modules in `src/`.
 *
 * This file wires the controls that are connected so far. The rest of the
 * markup is present and inert, and each panel gets its own module as it is
 * brought across.
 */

import shellMarkup from './app-shell.html?raw';
import { SEQUENCER_EVENTS } from '../sequencer/sequencer.js';
import { PROJECT_EVENTS } from '../project/project-session.js';
import { saveOpenProject } from '../project/save.js';
import { UNDO_EVENTS } from '../core/undo-redo.js';
import { translateOr } from '../i18n/i18n.js';
import { bindTranslations } from './i18n-dom.js';
import { bindCards } from './cards.js';
import { GeneratorPanel } from './generator-panel.js';
import { MixerPanel, MIXER_EVENTS } from './mixer-panel.js';
import { ViewTabs, VIEWS } from './views.js';
import { pickPattern } from './pattern-picker.js';
import { Playhead } from './playhead.js';
import { Zoom } from './zoom.js';
import { TapTempo, TAP_GAP_MS } from './tap-tempo.js';
import { MasterFxPanel } from './master-fx-panel.js';
import { ArrangementPanel } from './arrangement-panel.js';
import { FxAutomationPanel } from './fx-automation-panel.js';
import { MixerAutomationPanel } from './mixer-automation-panel.js';
import { KeyboardPanel, KEYBOARD_EVENTS } from './keyboard-panel.js';
import { Recording } from './recording.js';
import { VisualizerPanel } from './visualizer-panel.js';
import { TrackRows } from './track-rows.js';
import { RhythmPanel } from './rhythm-panel.js';
import { MasteringPanel } from './mastering-panel.js';
import { SettingsPanel } from './settings-panel.js';
import { MidiAccess } from './midi-access.js';
import { ProjectBrowser } from './project-browser.js';
import { SaveProjectDialog } from './save-project-dialog.js';
import { EditProjectDialog } from './edit-project-dialog.js';
import { ProjectInfo } from './project-info.js';
import { GeneratorPresets } from './generator-presets.js';
import { StudioModal } from './studio-modal.js';
import { ContextMenu } from './context-menu.js';
import { CellEditor } from './cell-editor.js';
import { Shortcuts } from './shortcuts.js';
import { FocusRelease } from './focus-release.js';
import { confirmAction } from './confirm.js';

/**
 * What the status badge is saying, rather than what colour to paint.
 *
 * The values are Bootstrap's soft-badge variants, which is the only place
 * the colours themselves are named.
 */
export const STATUS_TONES = Object.freeze({
    /** Playing, ready: everything is as it should be. */
    good: 'success',
    /** Something finished and is worth noticing: saved, loaded. */
    done: 'info',
    /** Something is running that takes a while: exporting, saving. */
    busy: 'warning',
    /** Stopped, recording, or a failure. */
    alert: 'danger',
    /** Anything else a panel has to say. */
    note: 'primary'
});

const TRACK_COUNT = 8;
const PATTERN_COUNT = 8;

export class StudioView {
    /**
     * @param {object} options
     * @param {HTMLElement} options.mount
     * @param {import('../studio.js').Studio} options.studio
     * @param {object} [options.dialogs]  windows the menu opens
     * @param {import('../storage/library.js').Library} [options.library]
     * @param {import('../storage/favorites.js').Favorites} [options.favorites]
     * @param {import('../account/community.js').Community} [options.community]
     */
    constructor({
        mount,
        studio,
        dialogs = {},
        preferences = null,
        i18n = null,
        themes = null,
        session = null,
        library = null,
        favorites = null,
        community = null
    }) {
        this.mount = mount;
        this.studio = studio;
        this.dialogs = dialogs;
        this.preferences = preferences;
        this.i18n = i18n;
        this.themes = themes;
        this.session = session;
        this.library = library;
        this.favorites = favorites;
        this.community = community;
        this.bus = studio.bus;

        /** Cell elements by `track:step`, so a redraw touches one node. */
        this._cells = new Map();
        this._playingStep = null;

        // One request for MIDI, shared by the two keyboards and the menu that
        // chooses between the devices. Built here because the studio window
        // is bound before the panels are, and it needs one too.
        this.midi = preferences ? new MidiAccess({ preferences, bus: this.bus }) : null;
    }

    render() {
        this.mount.innerHTML = shellMarkup;

        // First, because the Studio window's piano roll draws a playhead of
        // its own and reads this one for where it stands.
        this._bindPlayhead();

        this._bindProject();
        this._bindStudioModal();
        this._bindNavigation();
        this._bindTransport();
        this._bindPatterns();
        this._bindGenerator();
        this._bindPanels();
        this._buildGrid();
        this._listen();
        this._syncTransport();

        this._cards = bindCards(this.mount);
        this._bindViews();
        this._bindRightClick();
        this._bindShortcuts();

        this.zoom = new Zoom({ root: this.mount, preferences: this.preferences });
        this.zoom.bind();

        // Sliders and drop-downs hand focus back once the pointer is done
        // with them, so the shortcuts above and the piano below keep
        // answering. Document-wide: most of the sliders are in a window.
        new FocusRelease().bind();

        bindTranslations(this.mount, this.bus);
    }

    /** @param {string} id */
    _el(id) {
        return this.mount.querySelector(`#${id}`);
    }

    /**
     * What a right click does, which depends on where it lands.
     *
     * Over the grid it is a note editor for that step; anywhere else it
     * is the project menu. Bound after the grid exists, since the editor
     * marks the track grids as handling the gesture themselves.
     */
    _bindRightClick() {
        this.cellEditor = new CellEditor({
            root: this.mount,
            studio: this.studio,
            onEdited: () => {
                this._refreshCells();
                this._syncPatterns();
            }
        });
        this.cellEditor.bind();

        this.contextMenu = new ContextMenu({
            root: this.mount,
            actions: {
                new: () => this._newProject(),
                save: () => this._saveProject(),
                'save-as': () => this._el('saveAsProject')?.click(),
                load: () => this.projectBrowser?.open(),
                export: () => this.dialogs.export?.open()
            }
        });
        this.contextMenu.bind();

        // One at a time: opening either closes the other.
        document.addEventListener('pointerdown', () => this.cellEditor.close());
    }

    /**
     * What a key does, said once.
     *
     * The shortcut table names the verbs; this supplies them, so the
     * table stays readable and the same list can drive the buttons that
     * do the same jobs. Everything here goes through the studio the way
     * the buttons do: nothing reaches around them.
     */
    _bindShortcuts() {
        const { sequencer, history } = this.studio;

        const actions = {
            playPause: async () => {
                // While step recording, the space bar is a rest: that is
                // the one place it means something else.
                if (this.studio.recorder.mode === 'step') return this.studio.recorder.rest();

                await this.studio.start();
                if (sequencer.isPlaying) sequencer.pause();
                else sequencer.play();
                this._syncTransport();
            },
            stepBack: () => this.studio.recorder.backspace(),
            record: () => this.recording?.arm('realtime'),
            metronome: () => this._toggleMetronome(),
            nudgeTempo: (by) => this._nudgeTempo(by),

            switchPattern: (index) => {
                sequencer.switchPattern(index);
                this._syncPatterns();
                this._refreshCells();
                this._flash(`${translateOr('transport.pattern', 'Pattern: ').trim()} ${index + 1}`);
            },
            duplicatePattern: () => this._el('duplicatePattern')?.click(),
            clearPattern: () => this._el('clearPattern')?.click(),

            save: () => this._saveProject(),
            open: () => this.projectBrowser?.open(),
            export: () => this.dialogs.export?.open(),

            undo: () => this._stepHistory('undo'),
            redo: () => this._stepHistory('redo'),
            pianoRoll: () => this.studioModal?.open('pianoroll'),
            mute: () => {
                sequencer.toggleMute(this.studio.synthesizer.currentTrack);
                history.saveState('Mute');
                this.trackRows?.sync();
            },
            solo: () => {
                sequencer.toggleSolo(this.studio.synthesizer.currentTrack);
                history.saveState('Solo');
                this.trackRows?.sync();
            }
        };

        this.shortcuts = new Shortcuts({
            root: this.mount,
            actions,
            // Its eighteen letters are notes while its card is open.
            pianoClaims: (event) =>
                Boolean(this.keyboard?.claims(event) || this.studioModal?.keyboard?.claims(event))
        });
        this.shortcuts.bind();

        // Two of the transport buttons that say what they do in their own
        // tooltips and have never done it. REC is the third, and belongs
        // to the recording panel, which arms it and lights it up with the
        // three record buttons it already owns.
        this._el('undoBtn')?.addEventListener('click', () => actions.undo());
        this._el('redoBtn')?.addEventListener('click', () => actions.redo());

        this.bus.on(UNDO_EVENTS.changed, () => this._syncHistoryButtons());
        this._syncHistoryButtons();
    }

    /** @param {'undo'|'redo'} direction */
    _stepHistory(direction) {
        if (!this.studio.history[direction]()) return;

        this._syncAll();
        this._flash(
            direction === 'undo' ? translateOr('sc.undo', 'Undo') : translateOr('sc.redo', 'Redo')
        );
    }

    /** A button that cannot do anything says so. */
    _syncHistoryButtons() {
        const undo = this._el('undoBtn');
        const redo = this._el('redoBtn');

        if (undo) undo.disabled = !this.studio.history.canUndo();
        if (redo) redo.disabled = !this.studio.history.canRedo();
    }

    /**
     * The tempo, from the four places it can be set.
     *
     * The field is a text input rather than a number one, so it comes
     * with none of a spinner's behaviour: it had no arrow keys, no wheel,
     * nothing until it lost focus, and a letter typed into it reached
     * `setBPM` as NaN and stalled the scheduler. Each of those is one
     * line here, and they all go through the same place.
     */
    _bindTempo() {
        const field = this._transport.bpm;
        const setTempo = (bpm) => this._setTempo(bpm);

        field?.addEventListener('change', () => setTempo(Number.parseInt(field.value, 10)));

        field?.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowUp') {
                event.preventDefault();
                setTempo(this.studio.sequencer.bpm + 1);
            } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                setTempo(this.studio.sequencer.bpm - 1);
            } else if (event.key === 'Enter') {
                event.preventDefault();
                field.blur();
            }
        });

        field?.addEventListener(
            'wheel',
            (event) => {
                event.preventDefault();
                setTempo(this.studio.sequencer.bpm + (event.deltaY < 0 ? 1 : -1));
            },
            { passive: false }
        );

        this._transport.bpmUp?.addEventListener('click', () => this._nudgeTempo(1));
        this._transport.bpmDown?.addEventListener('click', () => this._nudgeTempo(-1));

        this._bindTapTempo(setTempo);
    }

    /**
     * The one way the tempo changes, whichever control asked.
     *
     * A field that is not a number puts the sequencer's own tempo back
     * rather than passing NaN on: `setBPM(NaN)` used to stall the
     * scheduler, and the field kept the letter that did it.
     *
     * @param {number} bpm
     */
    _setTempo(bpm) {
        if (Number.isFinite(bpm)) {
            this.studio.sequencer.setBPM(bpm);
            this.studio.history.saveStateDebounced('Tempo', 800);
        }

        const field = this._transport.bpm;
        if (field) field.value = String(this.studio.sequencer.bpm);
    }

    /**
     * TAP. The arithmetic is in `tap-tempo.js`; this is the button.
     *
     * The timer forgets the phrase after the same silence the module
     * would have noticed on the next tap. It is not needed for the
     * answer to be right: it stops a phrase sitting in memory all
     * afternoon waiting to be continued.
     *
     * @param {(bpm: number) => void} setTempo
     */
    _bindTapTempo(setTempo) {
        const tapping = new TapTempo();
        let forget = null;

        this._transport.tap?.addEventListener('click', () => {
            const bpm = tapping.tap(performance.now());
            if (bpm !== null) setTempo(bpm);

            clearTimeout(forget);
            forget = setTimeout(() => tapping.reset(), TAP_GAP_MS);
        });
    }

    // ── Navigation ───────────────────────────────────────────────────────

    _bindNavigation() {
        // The first two entries are the two views, which the tab strip
        // also offers. They were greyed out for want of the one line
        // each that shows the tab - and the sidebar said nothing about
        // which view you were in, although it has the styling for it.
        const views = {
            navSequencer: 'tabTracks',
            navArrangement: 'tabArrangement'
        };

        for (const [id, tabId] of Object.entries(views)) {
            const link = this._el(id);
            link?.addEventListener('click', (event) => {
                event.preventDefault();
                // A window over the studio would hide the view being
                // asked for, so it goes first.
                this.studioModal?.close();
                this._el(tabId)?.click();
            });
            if (link) link.dataset.forgeBound = 'true';
        }

        // The active state follows the view from `ViewTabs.onChange`, not
        // from a `shown.bs.tab` listener here: this runs before the tabs
        // are built, so its listener would fire first and read the view
        // the user has just left.
        this._syncSidebarView(VIEWS.sequencer);

        // The sidebar entries the original app wired to windows.
        const entries = {
            navExport: 'export'
        };

        for (const [id, dialog] of Object.entries(entries)) {
            const link = this._el(id);
            const window_ = this.dialogs[dialog];
            if (!link) continue;

            link.classList.toggle('disabled', !window_);
            link.addEventListener('click', (event) => {
                event.preventDefault();
                window_?.open();
            });
        }

        // Everything else in the sidebar has no module behind it yet. Marking
        // them says so, instead of a link that silently does nothing.
        for (const link of this.mount.querySelectorAll('.side-nav-link')) {
            if (!link.dataset.forgeBound && !Object.keys(entries).includes(link.id)) {
                link.classList.add('disabled');
                link.addEventListener('click', (event) => event.preventDefault());
            }
        }
    }

    /**
     * The sidebar says which of the two views you are looking at.
     * @param {string} view  the one being entered
     */
    _syncSidebarView(view) {
        const arrangement = view === VIEWS.arrangement;

        this._el('navSequencer')
            ?.closest('.side-nav-item')
            ?.classList.toggle('active', !arrangement);
        this._el('navArrangement')
            ?.closest('.side-nav-item')
            ?.classList.toggle('active', arrangement);
    }

    // ── The project ──────────────────────────────────────────────────────

    /**
     * The three windows a project lives through, browse, save, describe:
     * and the topbar buttons that open them. They are bound before anything
     * else so that a panel built afterwards can already reach them.
     */
    _bindProject() {
        if (!this.library || !this.session || !this.favorites) return;

        this.saveProject = new SaveProjectDialog({
            root: this.mount,
            library: this.library,
            session: this.session,
            studio: this.studio,
            onStatus: (text) => this._flash(text)
        });
        this.saveProject.bind();

        this.editProject = new EditProjectDialog({
            root: this.mount,
            library: this.library,
            favorites: this.favorites,
            session: this.session,
            studio: this.studio,
            onStatus: (text) => this._flash(text)
        });
        this.editProject.bind();

        this.projectBrowser = new ProjectBrowser({
            root: this.mount,
            library: this.library,
            favorites: this.favorites,
            session: this.session,
            studio: this.studio,
            community: this.community,
            onEdit: (id) => this.editProject.open(id),
            onLoaded: () => this._syncLoaded(),
            onStatus: (text) => this._flash(text)
        });
        this.projectBrowser.bind();

        this.projectInfo = new ProjectInfo({
            root: this.mount,
            studio: this.studio,
            session: this.session,
            onEdit: () => this.editProject.open()
        });
        this.projectInfo.bind();

        this.generatorPresets = new GeneratorPresets({
            root: this.mount,
            studio: this.studio,
            library: this.library,
            favorites: this.favorites,
            community: this.community,
            onStatus: (text) => this._flash(text)
        });
        this.generatorPresets.bind();

        this._bindProjectButtons();
    }

    _bindProjectButtons() {
        this._el('newProject')?.addEventListener('click', () => this._newProject());
        this._el('loadProject')?.addEventListener('click', () => this.projectBrowser.open());

        // Save writes the project's file. The library is a shelf inside
        // the studio, reached by the entry under it, not by Ctrl+S.
        this._el('saveProjectFile')?.addEventListener('click', (event) => {
            event.preventDefault();
            this._saveProject();
        });

        this._el('saveToLibrary')?.addEventListener('click', (event) => {
            event.preventDefault();
            this.saveProject.save();
        });

        this._el('saveAsProject')?.addEventListener('click', async (event) => {
            event.preventDefault();
            const { saved } = await this.session.saveAs(this.session.name);
            if (saved) this._flash(translateOr('library.saved', 'Saved'), STATUS_TONES.done);
        });

        // The topbar's Export opens the same window as the sidebar's.
        this._el('exportWav')?.addEventListener('click', () => this.dialogs.export?.open());
    }

    /**
     * Save the project: its file, where the platform can write one.
     *
     * The message names what was written, because "Saved" on its own is
     * what left people unsure which of two places their work went to.
     */
    async _saveProject() {
        try {
            const { where, name } = await saveOpenProject({
                session: this.session,
                library: this.library,
                studio: this.studio
            });
            if (where === 'cancelled') return;

            this._flash(
                where === 'file'
                    ? translateOr('project.savedFile', 'Saved: {name}', { name })
                    : translateOr('project.savedLibrary', 'Saved in the library: {name}', { name }),
                STATUS_TONES.done
            );
        } catch (error) {
            this._flash(`${translateOr('library.savefailed', 'Could not save')}: ${error.message}`);
        }
    }

    /**
     * Start again from nothing. Asking first is a preference, because the
     * answer is always yes for someone who presses it deliberately and
     * always no for someone who meant to press Save.
     */
    async _newProject() {
        if (this.preferences?.get('confirmNewProject') && this.session.isDirty) {
            const confirmed = await confirmAction({
                message: translateOr(
                    'proj.newConfirm',
                    'Start a new project? Unsaved changes will be lost.'
                ),
                title: translateOr('topbar.newproject', 'New Project'),
                confirmLabel: translateOr('topbar.new', 'New')
            });
            if (!confirmed) return;
        }

        this.studio.panic();
        this.studio.applyProjectState(this.studio.blankProjectState());
        this.studio.sequencer.setBPM(Number(this.preferences?.get('defaultBpm')) || 120);

        this.session.newProject(translateOr('proj.untitled', 'Untitled'));
        this.studio.history.clear();
        this.studio.history.saveState('New project');
        this.session.markClean();

        this._syncLoaded();
        this._flash(translateOr('status.newproject', 'NEW PROJECT'), STATUS_TONES.done);
    }

    /**
     * The studio window, bound before the sidebar so that the entries it
     * takes over are not swept up as unbound on the way past.
     */
    _bindStudioModal() {
        this.studioModal = new StudioModal({
            root: this.mount,
            studio: this.studio,
            midi: this.midi,
            library: this.library,
            favorites: this.favorites,
            community: this.community,
            // The piano roll draws a playhead too, over the same steps.
            playhead: this.playhead,
            // An instrument landing on a track is a change to the project
            // like any other, and the track rows show the result.
            onLoaded: () => this.trackRows?.sync(),
            onStatus: (text) => this._flash(text)
        });
        this.studioModal.bind();
    }

    // ── Transport ────────────────────────────────────────────────────────

    _bindTransport() {
        this._transport = {
            play: this._el('playBtn'),
            stop: this._el('stopBtn'),
            loop: this._el('loopBtn'),
            bpm: this._el('bpmInput'),
            bpmUp: this._el('bpmUp'),
            bpmDown: this._el('bpmDown'),
            tap: this._el('tapTempoBtn'),
            metronome: this._el('metronomeBtn'),
            steps: this._el('stepsSelect'),
            status: this._el('statusText')
        };

        this._transport.play?.addEventListener('click', async () => {
            await this.studio.start();

            if (this.studio.sequencer.isPlaying) this.studio.sequencer.pause();
            else this.studio.sequencer.play();

            this._syncTransport();
        });

        this._transport.stop?.addEventListener('click', () => {
            this.studio.sequencer.stop();
            this._clearStepHighlight();
            this._syncTransport();
        });

        this._transport.loop?.addEventListener('click', () => {
            this.studio.sequencer.toggleLoop();
            this._syncTransport();
        });

        this._transport.metronome?.addEventListener('click', () => this._toggleMetronome());

        this._bindTempo();

        this._transport.steps?.addEventListener('change', (event) => {
            this.studio.sequencer.setSteps(Number(event.target.value));
            this._buildGrid();
        });
    }

    _nudgeTempo(by) {
        this._setTempo(this.studio.sequencer.bpm + by);
    }

    /**
     * The click on and off.
     *
     * It is not part of a project (it is how you listen to one) so it is
     * not saved, not undoable, and starts off every time.
     */
    async _toggleMetronome() {
        // Nothing is heard before the audio is running, and someone who
        // switches the metronome on expects to hear it.
        await this.studio.start();

        const on = this.studio.metronome.toggle();
        this._transport.metronome?.classList.toggle('active', on);
        this._flash(
            on
                ? translateOr('status.metronomeon', 'METRONOME ON')
                : translateOr('status.metronomeoff', 'METRONOME OFF'),
            on ? STATUS_TONES.good : STATUS_TONES.note
        );
    }

    _syncTransport() {
        const { sequencer } = this.studio;
        const { play, loop, bpm, steps, status } = this._transport;

        if (play) {
            const icon = play.querySelector('i');
            if (icon) {
                icon.className = sequencer.isPlaying
                    ? 'ti ti-player-pause-filled'
                    : 'ti ti-player-play-filled';
            }
            play.classList.toggle('active', sequencer.isPlaying);
        }

        loop?.classList.toggle('active', sequencer.isLooping);
        if (bpm) bpm.value = sequencer.bpm;
        if (steps) steps.value = String(sequencer.steps);

        if (status) {
            status.textContent = sequencer.isPlaying
                ? translateOr('status.playing', 'PLAYING')
                : translateOr('status.ready', 'READY');
        }
    }

    // ── Patterns ─────────────────────────────────────────────────────────

    _bindPatterns() {
        for (let index = 0; index < PATTERN_COUNT; index++) {
            this._el(`patternBtn${index}`)?.addEventListener('click', () => {
                this.studio.sequencer.switchPattern(index);
                this._syncPatterns();
                this._refreshCells();
            });
        }

        this._el('clearPattern')?.addEventListener('click', () => {
            this.studio.sequencer.clearAll();
            this.studio.history.saveState('Clear pattern');
            this._refreshCells();
            this._syncPatterns();
        });

        this._el('duplicatePattern')?.addEventListener('click', async () => {
            const { sequencer } = this.studio;
            const source = sequencer.currentPattern;

            // Asked, not guessed. Copying into the first empty slot puts the
            // duplicate somewhere nobody chose, and on a project with all
            // eight in use there is no empty slot at all: which left the
            // button doing nothing.
            const target = await pickPattern({ source, count: PATTERN_COUNT });
            if (target === null) return;

            sequencer.duplicatePattern(source, target);
            sequencer.switchPattern(target);
            this.studio.history.saveState('Duplicate pattern');

            // The copy is only worth switching to if it can be seen: the
            // grid lives in the sequencer view.
            if (this.views?.view === VIEWS.arrangement) this._el('tabTracks')?.click();

            this._syncPatterns();
            this._refreshCells();
            this._flash(
                `${translateOr('transport.dupFrom', 'Pattern')} ${source + 1} → ${target + 1}`
            );
        });

        this._syncPatterns();
    }

    _syncPatterns() {
        const { sequencer } = this.studio;

        for (let index = 0; index < PATTERN_COUNT; index++) {
            const button = this._el(`patternBtn${index}`);
            if (!button) continue;

            button.classList.toggle('active', index === sequencer.currentPattern);

            // The original marks a pattern that holds notes with a dot.
            let dot = button.querySelector('.pattern-dot');
            const hasContent = sequencer.patternHasContent(index);
            if (hasContent && !dot) {
                dot = document.createElement('span');
                dot.className = 'pattern-dot';
                button.append(dot);
            } else if (!hasContent && dot) {
                dot.remove();
            }
        }

        const display = this._el('currentPatternDisplay');
        if (display) display.textContent = String(sequencer.currentPattern + 1);
    }

    // ── Generator ────────────────────────────────────────────────────────

    _bindGenerator() {
        this._generator = new GeneratorPanel({
            root: this.mount,
            studio: this.studio,
            onGenerated: () => {
                this._refreshCells();
                this._syncPatterns();
                this._syncTransport();
            }
        });
        this._generator.bind();
    }

    // ── Views ────────────────────────────────────────────────────────────

    _bindViews() {
        this.views = new ViewTabs({
            root: this.mount,
            studio: this.studio,
            cards: this._cards,
            onChange: (view) => {
                this._syncSidebarView(view);

                // The mixer's meters and the rack's wheels were laid out
                // while their cards were hidden; this is the first moment
                // they can measure themselves.
                if (view !== VIEWS.arrangement) return;
                this.mixer?.sync();
                this.masterFx?.sync();
            }
        });
        this.views.bind();
    }

    // ── Panels ───────────────────────────────────────────────────────────

    /**
     * The panels that own a card each. They build their own controls into the
     * markup and talk to their own module, so this only has to hand them the
     * studio and the part of the page they live in.
     */
    _bindPanels() {
        this.mixer = new MixerPanel({ root: this.mount, studio: this.studio });
        this.mixer.build();

        this.masterFx = new MasterFxPanel({ root: this.mount, studio: this.studio });
        this.masterFx.bind();

        this.arrangement = new ArrangementPanel({
            root: this.mount,
            studio: this.studio,
            onStatus: (text) => this._say(text)
        });
        this.arrangement.bind();

        this.fxAutomation = new FxAutomationPanel({ root: this.mount, studio: this.studio });
        this.fxAutomation.bind();

        this.mixerAutomation = new MixerAutomationPanel({
            root: this.mount,
            studio: this.studio
        });
        this.mixerAutomation.bind();

        this.keyboard = new KeyboardPanel({
            root: this.mount,
            studio: this.studio,
            midi: this.midi
        });
        this.keyboard.bind();

        // How a melody gets written without opening the piano roll: play
        // the note, then click the steps you want it on. Everything that
        // can play one - the keys, the mouse, MIDI - announces it on the
        // bus, so this one line covers all three.
        this.bus.on(KEYBOARD_EVENTS.noteOn, ({ note, octave }) =>
            this.studio.sequencer.rememberNote(note, octave)
        );

        // After the keyboard, because it listens for what the keyboard
        // announces: though the bus would not care about the order.
        this.recording = new Recording({
            root: this.mount,
            studio: this.studio,
            onCellsChanged: () => {
                this._refreshCells();
                this._syncPatterns();
            },
            onStatus: (text) => this._flash(text)
        });
        this.recording.bind();

        this.visualizer = new VisualizerPanel({ root: this.mount, studio: this.studio });
        this.visualizer.bind();

        this.trackRows = new TrackRows({
            root: this.mount,
            preferences: this.preferences,
            studio: this.studio,
            studioModal: this.studioModal,
            onGenerated: () => this._refreshCells(),
            onStatus: (text) => this._flash(text)
        });
        this.trackRows.bind();

        this.rhythm = new RhythmPanel({
            root: this.mount,
            studio: this.studio,
            onApplied: () => {
                this._refreshCells();
                this._syncPatterns();
            },
            onStatus: (text) => this._flash(text)
        });
        this.rhythm.bind();

        this.mastering = new MasteringPanel({ root: this.mount, studio: this.studio });
        this.mastering.bind();

        if (this.preferences && this.i18n && this.themes) {
            this.settings = new SettingsPanel({
                root: this.mount,
                studio: this.studio,
                preferences: this.preferences,
                i18n: this.i18n,
                themes: this.themes,
                session: this.session,
                midi: this.midi
            });
            this.settings.bind();
        }
    }

    /** Say something in the status line, then let it settle back. */
    _flash(text, tone = STATUS_TONES.note) {
        this._say(text, tone);
        window.clearTimeout(this._flashTimer);
        this._flashTimer = window.setTimeout(
            () => this._say(translateOr('status.ready', 'READY'), STATUS_TONES.good),
            1500
        );
    }

    /**
     * Put a line in the transport's status, in place of what it says.
     *
     * The badge is coloured and carries a dot, as the markup writes it. A
     * caller says what kind of thing happened rather than passing a colour,
     * and never the text itself: the original decided the colour by matching
     * English strings, which stops working the moment the studio is read in
     * another language: and nine of the ten it ships in are not English.
     *
     * @param {string} text
     * @param {string} [tone]  one of `STATUS_TONES`
     */
    _say(text, tone = STATUS_TONES.note) {
        const badge = this._transport.status;
        if (!badge) return;

        badge.className = `topbar-btn status-badge badge-soft-${tone}`;
        badge.replaceChildren(dotIcon(), document.createTextNode(` ${text}`));
    }

    // ── Grid ─────────────────────────────────────────────────────────────

    /**
     * Fill the eight grids the markup provides. The cells are built here
     * rather than written into the markup because their number follows the
     * pattern length.
     */
    _buildGrid() {
        const steps = this.studio.sequencer.steps;
        this._cells.clear();

        for (let track = 0; track < TRACK_COUNT; track++) {
            const grid = this._el(`grid${track}`);
            if (!grid) continue;

            grid.className = `track-grid steps-${steps}`;
            grid.innerHTML = '';

            for (let step = 0; step < steps; step++) {
                const cell = document.createElement('div');
                cell.className = 'grid-cell';
                cell.dataset.track = String(track);
                cell.dataset.step = String(step);

                grid.append(cell);
                this._cells.set(`${track}:${step}`, cell);
            }

            if (!grid.dataset.forgeBound) {
                grid.addEventListener('click', this._onGridClick);
                grid.dataset.forgeBound = 'true';
            }
        }

        this._refreshCells();
    }

    _onGridClick = async (event) => {
        const cell = event.target.closest('.grid-cell');
        if (!cell) return;

        const track = Number(cell.dataset.track);
        const step = Number(cell.dataset.step);

        // The badge is a button in the middle of a bigger one. It opens the
        // editor rather than switching off the step it is sitting on, which
        // is what made it look broken: you reached for the note and the step
        // disappeared.
        if (event.target.closest('.cell-note')) {
            this.cellEditor.open(track, step, cell);
            return;
        }

        this.studio.sequencer.toggleCell(track, step);
        this.studio.history.saveStateDebounced('Cell edit');
        this._refreshCell(track, step);
        this._syncPatterns();

        // Sound the note as it lands: editing a pattern should be audible.
        const note = this.studio.sequencer.getCell(track, step);
        if (!note) return;

        await this.studio.start();
        this.studio.audioEngine.playNote(
            noteFrequency(note),
            track,
            (60 / this.studio.sequencer.bpm) * 0.5
        );
    };

    _refreshCells() {
        const { sequencer } = this.studio;
        for (let track = 0; track < TRACK_COUNT; track++) {
            for (let step = 0; step < sequencer.steps; step++) this._refreshCell(track, step);
        }
    }

    _refreshCell(track, step) {
        const cell = this._cells.get(`${track}:${step}`);
        if (!cell) return;

        const note = this.studio.sequencer.getCell(track, step);
        cell.classList.toggle('active', Boolean(note));

        cell.innerHTML = '';

        // Drum tracks always sound the same pitch: printing it would be noise.
        if (!note || track >= 4) return;

        // A button, and it has to look like one: this is the way into the
        // note editor that anyone finds, and it spent the port as a label
        // that swallowed the click and switched the step off instead.
        const badge = document.createElement('button');
        badge.type = 'button';
        badge.className = 'cell-note';
        badge.dataset.i18nTitle = 'grid.editNote';
        badge.title = translateOr('grid.editNote', 'Edit the note');
        badge.textContent = `${note.note}${note.octave} ✎`;
        cell.append(badge);
    }

    // ── Playhead ─────────────────────────────────────────────────────────

    /**
     * The bar that runs across the grid, and its twin over the arrangement.
     *
     * Both are measured every frame rather than once: the grid is elastic,
     * it follows the window, the right-hand panel and the page zoom: so
     * where a step falls is not something that can be worked out in advance.
     */
    _bindPlayhead() {
        const { sequencer } = this.studio;

        this.playhead = new Playhead({
            sequencer,
            bus: this.bus,
            bars: [
                {
                    element: this._el('tracksPlayhead'),
                    // Every track's grid is the same width; the first one
                    // answers for all eight.
                    strip: () => this._el('grid0'),
                    along: ({ step }) => step / sequencer.steps
                },
                {
                    element: this._el('arrangementPlayhead'),
                    strip: () => this.mount.querySelector('.mixer-grid-cells'),
                    along: ({ step, chainIndex }) => {
                        const arrangement = this.studio.arrangement;
                        if (!arrangement?.enabled || !arrangement.chain?.length) return null;

                        // The strip is as wide as the grid shows, which is at
                        // least the chain and often more.
                        const measures = Math.max(
                            arrangement.mixerMeasures || 0,
                            arrangement.chain.length
                        );
                        return (chainIndex + step / sequencer.steps) / measures;
                    }
                }
            ]
        });

        this.playhead.bind();
    }

    _listen() {
        this.bus.on(SEQUENCER_EVENTS.step, ({ step }) => this._highlightStep(step));
        this.bus.on(SEQUENCER_EVENTS.stop, () => {
            this._clearStepHighlight();
            this._syncTransport();
        });
        this.bus.on(SEQUENCER_EVENTS.patternChanged, () => {
            this._syncPatterns();
            this._refreshCells();
        });
        this.bus.on(SEQUENCER_EVENTS.cellsChanged, () => {
            this._refreshCells();
            this._syncPatterns();
        });

        // The mixer's settings are restored straight onto the engine, without
        // an announcement of their own; these are the two moments that
        // happens: opening a project, and undoing.
        this.bus.on(PROJECT_EVENTS.opened, () => this._syncLoaded());
        this.bus.on(MIXER_EVENTS.soloMuteChanged, () => this.trackRows?.sync());
        this.bus.on(UNDO_EVENTS.changed, () => {
            this.mixer?.sync();
            this.trackRows?.sync();
        });
    }

    /**
     * A project arrived: read everything back, and decide again whether its
     * chain is driving playback.
     *
     * Separate from `_syncAll` because undo goes through that too, and an
     * undo is not a load. Realigning there would override the `enabled` the
     * snapshot just restored, and send the song back to its first measure
     * while it was playing.
     */
    _syncLoaded() {
        this.views?.realign();
        this._syncAll();
    }

    /**
     * Everything the view shows, read back from the studio. Called when a
     * whole project lands at once (opened, or started from nothing) which
     * is the one moment no module announces a change of its own.
     */
    _syncAll() {
        this._syncTransport();
        this._syncPatterns();
        this._buildGrid();
        this.mixer?.sync();
        this.trackRows?.sync();
        this.masterFx?.sync();
        this.mastering?.sync();
        this.generator?.sync();
        this.arrangement?.render();
        // The lanes follow the arrangement's length, so they are rebuilt
        // rather than redrawn.
        this.fxAutomation?.build();
        this.mixerAutomation?.build();
        this.projectInfo?.sync();
        this.studioModal?.sync();
    }

    /**
     * The cells of the step being heard, lit. This is not the playhead: it
     * says which step, the bar says where between two of them, and calling
     * both of them the playhead is how they end up fighting each other.
     */
    _highlightStep(step) {
        this._clearStepHighlight();
        for (let track = 0; track < TRACK_COUNT; track++) {
            this._cells.get(`${track}:${step}`)?.classList.add('playing');
        }
        this._playingStep = step;
    }

    _clearStepHighlight() {
        if (this._playingStep === null) return;
        for (let track = 0; track < TRACK_COUNT; track++) {
            this._cells.get(`${track}:${this._playingStep}`)?.classList.remove('playing');
        }
        this._playingStep = null;
    }
}

/** A cell's pitch, in hertz. */
function noteFrequency(note) {
    const offsets = {
        C: 0,
        'C#': 1,
        D: 2,
        'D#': 3,
        E: 4,
        F: 5,
        'F#': 6,
        G: 7,
        'G#': 8,
        A: 9,
        'A#': 10,
        B: 11
    };
    const semitones = (note.octave + 1) * 12 + (offsets[note.note] ?? 0) - 69;
    return 440 * Math.pow(2, semitones / 12);
}

/** The dot the badge is written with in the markup. */
function dotIcon() {
    const icon = document.createElement('i');
    icon.className = 'ti ti-point-filled';
    return icon;
}
