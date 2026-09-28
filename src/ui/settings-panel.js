/**
 * The settings panel, in the right sidebar.
 *
 * Language, automatic saving, what a new project starts at, how exports are
 * named, and the visual theme. Most of these belong to the person rather than
 * to a project, so they live in `Preferences` and follow the browser; the
 * language and the theme are kept by the modules that own them, since both
 * have to be applied before anything is drawn.
 *
 * The export naming row is the only one that needs explaining: a template of
 * tokens, a row of badges that insert them, and a preview of what the next
 * file would be called, built from the project as it stands.
 */

import { PREFERENCE_EVENTS } from '../core/preferences.js';
import { THEME_EVENTS } from './theme-engine.js';
import { translateOr } from '../i18n/i18n.js';
import { resolveExportFilename, abbreviateScale } from '../export/filename.js';
import { capturePointer, releaseCapture } from './pointer-capture.js';
import { ANY_INPUT, NO_INPUT } from './midi-access.js';

/** What the stylesheet gives the panel, and how much of the window it may take. */
const MIN_SIDEBAR_WIDTH = 340;
const MAX_SIDEBAR_SHARE = 0.6;

/** The plain controls: an element, a preference, and how to read it back. */
const FIELDS = [
    { id: 'settingsAutosave', key: 'autosaveSeconds', read: (el) => Number(el.value) },
    { id: 'settingsConfirmNew', key: 'confirmNewProject', read: (el) => el.checked },
    { id: 'settingsDefaultBpm', key: 'defaultBpm', read: (el) => Number(el.value) },
    { id: 'settingsMidiInput', key: 'midiInput', read: (el) => el.value },
    { id: 'settingsSidebarAutoOpen', key: 'sidebarAutoOpen', read: (el) => el.checked },
    { id: 'settingsExportTemplate', key: 'exportTemplate', read: (el) => el.value }
];

/** What the topbar button flips between: full dark, and no theme at all. */
const DARK_THEME = 'inverse';
const LIGHT_THEME = 'default';

export class SettingsPanel {
    /**
     * @param {object} options
     * @param {ParentNode} options.root
     * @param {import('../studio.js').Studio} options.studio
     * @param {import('../core/preferences.js').Preferences} options.preferences
     * @param {import('../i18n/i18n.js').I18n} options.i18n
     * @param {import('./theme-engine.js').ThemeEngine} options.themes
     * @param {import('../project/project-session.js').ProjectSession} [options.session]
     * @param {import('./midi-access.js').MidiAccess} [options.midi]
     */
    constructor({ root, studio, preferences, i18n, themes, session = null, midi = null }) {
        this.root = root;
        this.studio = studio;
        this.preferences = preferences;
        this.i18n = i18n;
        this.themes = themes;
        this.session = session;
        this.midi = midi;
    }

    bind() {
        this._bindFields();
        this._bindLanguage();
        this._bindTheme();
        this._bindExportNaming();
        this._bindSidebar();
        this._bindMidiInputs();

        this.studio.bus.on(PREFERENCE_EVENTS.changed, () => this.sync());
        this.studio.bus.on(THEME_EVENTS.changed, () => this.sync());
        this.sync();
    }

    _el(id) {
        return this.root.querySelector(`#${id}`);
    }

    _bindFields() {
        for (const { id, key, read } of FIELDS) {
            const element = this._el(id);
            element?.addEventListener('change', () => this.preferences.set(key, read(element)));
        }
    }

    _bindLanguage() {
        const select = this._el('settingsLang');
        select?.addEventListener('change', () => this.i18n.setLanguage(select.value));
    }

    /**
     * The theme, from the drop-down here and from the topbar button.
     *
     * Both are bound in one place because they are one setting: the
     * button is a shortcut to Inverse and back, and the list has to
     * follow it. The button's own icon is the other half of saying
     * which way it goes - a moon to turn the lights off, a sun to turn
     * them on - and it was showing a moon whatever the theme.
     */
    _bindTheme() {
        const select = this._el('settingsTheme');
        const toggle = this._el('toggleDarkLight');

        select?.addEventListener('change', () => this.themes.apply(select.value));

        toggle?.addEventListener('click', () => {
            this.themes.apply(this.themes.current === DARK_THEME ? LIGHT_THEME : DARK_THEME);
        });

        this.studio.bus.on(THEME_EVENTS.changed, (theme) => this._showTheme(theme));
        this._showTheme(this.themes.current);
    }

    /** @param {string} theme */
    _showTheme(theme) {
        const select = this._el('settingsTheme');
        const toggle = this._el('toggleDarkLight');
        const dark = theme === DARK_THEME;

        if (select) select.value = theme;
        if (!toggle) return;

        const icon = toggle.querySelector('i');
        if (icon) icon.className = dark ? 'ti ti-sun' : 'ti ti-moon';
        toggle.title = dark
            ? translateOr('topbar.toLight', 'Switch to Light')
            : translateOr('topbar.toDark', 'Switch to Dark');
    }

    // ── How exported files are named ─────────────────────────────────────

    _bindExportNaming() {
        const template = this._el('settingsExportTemplate');

        // A badge inserts its token where the cursor is, which is how a
        // template is usually built: by pointing at a gap.
        for (const badge of this.root.querySelectorAll('.export-token-badge')) {
            badge.addEventListener('click', () => {
                if (!template) return;

                const at = template.selectionStart ?? template.value.length;
                template.value =
                    template.value.slice(0, at) + badge.dataset.token + template.value.slice(at);

                template.dispatchEvent(new Event('change', { bubbles: true }));
                template.focus();
                template.setSelectionRange(
                    at + badge.dataset.token.length,
                    at + badge.dataset.token.length
                );
            });
        }

        template?.addEventListener('input', () => this._drawPreview());
    }

    /** What the next exported file would be called, as things stand. */
    _drawPreview() {
        const preview = this._el('exportNamingPreview');
        if (!preview) return;

        const { generator, sequencer } = this.studio;
        const state = generator.getState();

        preview.textContent = resolveExportFilename({
            template: this._el('settingsExportTemplate')?.value,
            designer: 'designer',
            project: this.session?.name ?? 'Untitled',
            track: 'Lead',
            scale: abbreviateScale(state.rootKey, state.scaleType),
            bpm: sequencer.bpm,
            pattern: String(sequencer.currentPattern + 1)
        });
    }

    // ── The sidebar the panel lives in ───────────────────────────────────

    _bindSidebar() {
        const sidebar = this.root.querySelector('#asidebar-offcanvas');
        if (!sidebar) return;

        /** A width the user dragged to, restored the next time it opens. */
        this._sidebarWidth = null;

        const open = (yes) => {
            sidebar.classList.toggle('open', yes);
            document.body.classList.toggle('asidebar-open', yes);

            // Closed, the panel goes back to whatever the stylesheet says.
            if (yes && this._sidebarWidth) this._setSidebarWidth(sidebar, this._sidebarWidth);
            else if (!yes) this._setSidebarWidth(sidebar, null);

            sidebar.classList.remove('resizing');
        };

        this._el('toggleAsidebar')?.addEventListener('click', () => {
            const opening = !sidebar.classList.contains('open');
            open(opening);

            // Opening the panel is the gesture that pays for the MIDI prompt:
            // the list of devices is one of the things it shows.
            if (opening) this.midi?.ensure();
        });
        this._el('closeAsidebar')?.addEventListener('click', () => open(false));

        // Someone who wants the controls open wants them open from the start.
        if (this.preferences.get('sidebarAutoOpen')) open(true);

        this._bindSidebarResize(sidebar);
    }

    /**
     * The devices to choose between, and the one chosen.
     *
     * The list is only known once the browser has granted MIDI, which it is
     * not asked for until a gesture: so the menu starts with its one written
     * option and grows when the answer arrives.
     */
    _bindMidiInputs() {
        const select = this._el('settingsMidiInput');
        if (!select || !this.midi) return;

        const draw = (inputs) => {
            const chosen = this.preferences.get('midiInput') ?? ANY_INPUT;

            // The whole menu is rebuilt each time, since a keyboard can be
            // unplugged between two draws. The markup writes one option:
            // None: and the studio's own default is the opposite of it, so
            // both ends are named here and the devices sit between them.
            select.innerHTML = '';
            select.add(new Option(translateOr('settings.midiall', 'All inputs'), ANY_INPUT));
            select.add(new Option(translateOr('settings.midinone', 'None'), NO_INPUT));
            for (const input of inputs) select.add(new Option(input.name, input.id));

            // A device that is no longer there cannot stay selected: the menu
            // would show blank while the preference still named it.
            const known =
                chosen === ANY_INPUT ||
                chosen === NO_INPUT ||
                inputs.some((input) => input.id === chosen);
            select.value = known ? chosen : ANY_INPUT;
        };

        this.midi.onDevices(draw);
        draw(this.midi.inputs());
    }

    /**
     * Set the panel's width, and tell the page about it.
     *
     * The studio's margin is `--asidebar-width` (`studio.css`), so a width
     * set on the panel alone widens it *over* the studio instead of pushing
     * it aside: which is what the port did, and why a dragged panel covered
     * the mixer. The two have to move together.
     *
     * @param {HTMLElement} sidebar
     * @param {number|null} width  null restores the stylesheet's own width
     */
    _setSidebarWidth(sidebar, width) {
        if (width === null) {
            sidebar.style.width = '';
            document.documentElement.style.setProperty('--asidebar-width', '');
            return;
        }

        // The stylesheet sets this width with `!important`, so matching it is
        // the only way an inline width wins.
        sidebar.style.setProperty('width', `${width}px`, 'important');
        document.documentElement.style.setProperty('--asidebar-width', `${width}px`);
    }

    /** The sidebar is dragged wider from its left edge. */
    _bindSidebarResize(sidebar) {
        const handle = this._el('asidebarResizeHandle');
        if (!handle) return;

        let startX = 0;
        let startWidth = 0;
        let dragging = false;

        handle.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            dragging = true;
            startX = event.clientX;
            startWidth = sidebar.getBoundingClientRect().width;

            // The panel drops its opening transition while it is dragged, or
            // it lags a frame behind the pointer the whole way.
            sidebar.classList.add('resizing');
            handle.classList.add('dragging');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';

            // Following the pointer off the handle is an improvement, not the
            // drag itself, and asking for it can throw: so it comes last and
            // nothing after it depends on it.
            capturePointer(handle, event.pointerId);
        });

        handle.addEventListener('pointermove', (event) => {
            if (!dragging) return;

            // Dragging left widens it: the handle is on the panel's left edge.
            // It stops at 340 (the stylesheet's own width) and at 60 % of
            // the window, past which there is no studio left to look at.
            const width = clamp(
                startWidth - (event.clientX - startX),
                MIN_SIDEBAR_WIDTH,
                window.innerWidth * MAX_SIDEBAR_SHARE
            );

            this._setSidebarWidth(sidebar, width);
            this._sidebarWidth = width;
        });

        const release = (event) => {
            if (!dragging) return;

            dragging = false;
            releaseCapture(handle, event.pointerId);
            sidebar.classList.remove('resizing');
            handle.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };

        handle.addEventListener('pointerup', release);
        handle.addEventListener('pointercancel', release);
    }

    // ── Reading the state back ───────────────────────────────────────────

    sync() {
        for (const { id, key } of FIELDS) {
            const element = this._el(id);
            if (!element) continue;

            const value = this.preferences.get(key);
            if (element.type === 'checkbox') element.checked = Boolean(value);
            else element.value = String(value);
        }

        const language = this._el('settingsLang');
        if (language) language.value = this.i18n.language;

        const theme = this._el('settingsTheme');
        if (theme) theme.value = this.themes.current;

        this._drawPreview();
    }
}

/**
 * Keep a value between two bounds, with the minimum winning when a narrow
 * window makes the maximum the smaller of the two. The original clamps the
 * other way round, which on a 500-pixel window hands back a panel narrower
 * than the stylesheet's own width.
 */
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
