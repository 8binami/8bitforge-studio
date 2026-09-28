/**
 * The keyboard.
 *
 * Space to play, Ctrl+Z to undo, 1 to 8 for the patterns: the twenty or
 * so keys that make the studio quick to use once you know them. None of
 * them existed here until now, which was awkward: the buttons have said
 * "Record (R)" and "Undo (Ctrl+Z)" in their tooltips since the markup
 * came across, and the right-click menu prints Ctrl+N and Ctrl+S beside
 * its entries. The interface has been promising these for a while.
 *
 * They are one table, for the same reason the synth controls are: the
 * handler and the help window both read it, so a shortcut cannot work
 * without being listed or be listed without working. Add a row and it
 * does both.
 *
 * A row says *what* it does, never how: `actions.save()`, not a reach
 * into a dialog. The studio view supplies the verbs, which keeps this
 * file readable and lets the table be tested with nothing on screen.
 *
 * Two things hold a key back. Anything typed into a field is typing, not
 * a shortcut. And the musical keyboard claims eighteen letters of its
 * own, so while its card is open a single letter belongs to it: the
 * keyboard is asked, rather than a second list of its keys being kept in
 * step by hand. S is the only shortcut this takes away, and it comes back
 * the moment the card is collapsed or a window opens over the studio.
 */

import { translateOr } from '../i18n/i18n.js';
import { place } from './context-menu.js';

/** Where a keystroke is someone writing something. */
const TYPING = 'input, textarea, select, [contenteditable="true"]';

/** The sections of the help window, in the order it shows them. */
export const SHORTCUT_GROUPS = Object.freeze([
    { id: 'transport', label: 'sc.transport', fallback: 'Transport', icon: 'ti-player-play' },
    { id: 'patterns', label: 'sc.patterns', fallback: 'Patterns', icon: 'ti-layout-grid' },
    { id: 'files', label: 'sc.files', fallback: 'Files', icon: 'ti-file-music' },
    { id: 'editing', label: 'sc.editing', fallback: 'Editing', icon: 'ti-pencil' },
    {
        id: 'interface',
        label: 'sc.interface',
        fallback: 'Interface',
        icon: 'ti-layout-sidebar-right'
    }
]);

/**
 * Every shortcut, once.
 *
 * `keys` are what is matched, in the canonical form `ctrl+shift+z`.
 * `shown` is what the help window prints, when that differs: several
 * keys doing one thing, or a range written as a range.
 */
export const SHORTCUTS = Object.freeze([
    {
        group: 'transport',
        keys: ['space'],
        shown: 'Space',
        label: 'sc.playPause',
        fallback: 'Play / Stop (rest, while step recording)',
        run: ({ actions }) => actions.playPause()
    },
    {
        group: 'transport',
        keys: ['backspace'],
        shown: 'Backspace',
        label: 'sc.stepBack',
        fallback: 'Step back (step-rec)',
        run: ({ actions }) => actions.stepBack()
    },
    {
        group: 'transport',
        keys: ['r'],
        shown: 'R',
        label: 'sc.record',
        fallback: 'Toggle recording',
        run: ({ actions }) => actions.record()
    },
    {
        group: 'transport',
        keys: ['+', '='],
        shown: '+',
        label: 'sc.bpmUp',
        fallback: 'BPM + 5',
        run: ({ actions }) => actions.nudgeTempo(5)
    },
    {
        group: 'transport',
        keys: ['-', '_'],
        shown: '−',
        label: 'sc.bpmDown',
        fallback: 'BPM − 5',
        run: ({ actions }) => actions.nudgeTempo(-5)
    },

    {
        group: 'transport',
        keys: ['shift+m'],
        shown: 'Shift+M',
        label: 'sc.metronome',
        fallback: 'Toggle metronome',
        run: ({ actions }) => actions.metronome()
    },

    {
        group: 'patterns',
        keys: ['1', '2', '3', '4', '5', '6', '7', '8'],
        shown: '1-8',
        label: 'sc.switchPattern',
        fallback: 'Switch pattern',
        run: ({ actions, key }) => actions.switchPattern(Number(key) - 1)
    },
    {
        group: 'patterns',
        keys: ['ctrl+d'],
        shown: 'Ctrl+D',
        label: 'sc.dupPattern',
        fallback: 'Duplicate pattern to the next',
        run: ({ actions }) => actions.duplicatePattern()
    },
    {
        group: 'patterns',
        keys: ['delete'],
        shown: 'Delete',
        label: 'sc.clearPattern',
        fallback: 'Clear current pattern',
        run: ({ actions }) => actions.clearPattern()
    },

    {
        group: 'files',
        keys: ['ctrl+s'],
        shown: 'Ctrl+S',
        label: 'sc.save',
        fallback: 'Save project',
        run: ({ actions }) => actions.save()
    },
    {
        group: 'files',
        keys: ['ctrl+o'],
        shown: 'Ctrl+O',
        label: 'sc.open',
        fallback: 'Open project',
        run: ({ actions }) => actions.open()
    },
    {
        group: 'files',
        keys: ['ctrl+e'],
        shown: 'Ctrl+E',
        label: 'sc.export',
        fallback: 'Export',
        run: ({ actions }) => actions.export()
    },

    {
        group: 'editing',
        keys: ['ctrl+z'],
        shown: 'Ctrl+Z',
        label: 'sc.undo',
        fallback: 'Undo',
        run: ({ actions }) => actions.undo()
    },
    {
        // Both spellings, because both are muscle memory somewhere.
        group: 'editing',
        keys: ['ctrl+y', 'ctrl+shift+z'],
        shown: 'Ctrl+Y',
        label: 'sc.redo',
        fallback: 'Redo',
        run: ({ actions }) => actions.redo()
    },
    {
        group: 'editing',
        keys: ['p'],
        shown: 'P',
        label: 'sc.pianoRoll',
        fallback: 'Open the piano roll',
        run: ({ actions }) => actions.pianoRoll()
    },
    {
        group: 'editing',
        keys: ['m'],
        shown: 'M',
        label: 'sc.mute',
        fallback: 'Mute the selected track',
        run: ({ actions }) => actions.mute()
    },
    {
        group: 'editing',
        keys: ['s'],
        shown: 'S',
        label: 'sc.solo',
        fallback: 'Solo the selected track',
        run: ({ actions }) => actions.solo()
    },

    {
        group: 'interface',
        keys: ['?', 'shift+?', 'shift+/'],
        shown: '?',
        label: 'sc.showHelp',
        fallback: 'Show this list',
        run: ({ shortcuts, event }) => shortcuts.showHelp(event)
    }
]);

export class Shortcuts {
    /**
     * @param {object} options
     * @param {ParentNode} options.root
     * @param {Record<string, Function>} options.actions  what each one does
     * @param {(event: KeyboardEvent) => boolean} [options.pianoClaims]
     *        whether the musical keyboard would play this keystroke
     */
    constructor({ root, actions, pianoClaims = () => false }) {
        this.root = root;
        this.actions = actions;
        this.pianoClaims = pianoClaims;

        /** Accelerator → the row that owns it. */
        this._byKey = new Map();
        for (const shortcut of SHORTCUTS) {
            for (const key of shortcut.keys) this._byKey.set(key, shortcut);
        }

        this._help = null;
    }

    bind() {
        document.addEventListener('keydown', (event) => this._onKeyDown(event));

        // The four places the markup offers this list from.
        for (const id of ['navHelp', 'helpShortcutsBtn', 'helpShortcutsSideBtn']) {
            const opener = this.root.querySelector('#' + id);
            if (!opener) continue;

            opener.classList.remove('disabled');
            opener.dataset.forgeBound = 'true';
            opener.addEventListener('click', (event) => {
                event.preventDefault();
                this.showHelp();
            });
        }
    }

    _onKeyDown(event) {
        if (event.target.closest?.(TYPING)) return;

        const accelerator = acceleratorOf(event);
        const shortcut = this._byKey.get(accelerator);
        if (!shortcut) return;

        // While the keyboard card is open its eighteen letters are notes.
        // The keyboard is asked rather than second-guessed, so its own
        // rules about modifiers and open windows decide this too.
        if (this.pianoClaims(event)) return;

        event.preventDefault();
        shortcut.run({ actions: this.actions, key: accelerator, shortcuts: this, event });
    }

    // ── The list itself ──────────────────────────────────────────────────

    /** @param {{clientX?: number, clientY?: number}} [at] */
    showHelp() {
        this._build();
        this._help.classList.add('show');
        // Centred rather than at the pointer: it is a page of reading,
        // not a menu of choices.
        place(
            this._help,
            (window.innerWidth - this._help.offsetWidth) / 2,
            (window.innerHeight - this._help.offsetHeight) / 2
        );
    }

    closeHelp() {
        this._help?.classList.remove('show');
    }

    get helpIsOpen() {
        return Boolean(this._help?.classList.contains('show'));
    }

    /**
     * Built from the same table the keys are matched against, so the two
     * cannot drift. The only rows written by hand are the piano's, which
     * belong to the keyboard card rather than to this.
     */
    _build() {
        if (this._help) return;

        const sections = SHORTCUT_GROUPS.map((group) => {
            const rows = SHORTCUTS.filter((shortcut) => shortcut.group === group.id)
                .map(
                    (shortcut) => `
                    <tr>
                        <td class="sc-keys">${keycaps(shortcut.shown ?? shortcut.keys[0])}</td>
                        <td>${escapeText(translateOr(shortcut.label, shortcut.fallback))}</td>
                    </tr>`
                )
                .join('');

            return section(group, rows);
        }).join('');

        const piano = section(
            { label: 'sc.piano', fallback: 'Virtual piano', icon: 'ti-music' },
            `
            <tr><td class="sc-keys">${keycaps('A S D F G H J')}</td>
                <td>${escapeText(translateOr('sc.whiteKeys', 'White keys'))}</td></tr>
            <tr><td class="sc-keys">${keycaps('W E T Y U')}</td>
                <td>${escapeText(translateOr('sc.blackKeys', 'Black keys'))}</td></tr>
            <tr><td class="sc-keys">${keycaps("K L ; '")}</td>
                <td>${escapeText(translateOr('sc.nextOctaveKeys', 'Next octave'))}</td></tr>
            <tr><td class="sc-keys">${keycaps('Z')} / ${keycaps('X')}</td>
                <td>${escapeText(translateOr('sc.octaveShift', 'Octave down / up'))}</td></tr>`
        );

        const host = document.createElement('div');
        host.innerHTML = `
            <div class="shortcuts-help" id="forgeShortcutsHelp">
                <div class="shortcuts-help-head">
                    <span>${escapeText(translateOr('sc.title', 'Keyboard Shortcuts'))}</span>
                    <button type="button" class="shortcuts-help-close" data-close>
                        <i class="ti ti-x"></i>
                    </button>
                </div>
                <div class="shortcuts-help-body">${sections}${piano}</div>
                <p class="shortcuts-help-foot">${escapeText(
                    translateOr(
                        'sc.pianoNote',
                        'While the Keyboard card is open its letters play notes.'
                    )
                )}</p>
            </div>`;

        this._help = host.firstElementChild;
        document.body.append(this._help);

        this._help.querySelector('[data-close]').addEventListener('click', () => this.closeHelp());
        this._help.addEventListener('pointerdown', (event) => event.stopPropagation());

        document.addEventListener('pointerdown', () => this.closeHelp());
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') this.closeHelp();
        });
    }
}

/**
 * A keystroke, as the table spells one.
 *
 * Lower case, modifiers first and always in the same order, so a row can
 * be found with one lookup rather than a ladder of comparisons.
 */
export function acceleratorOf(event) {
    const key = event.key === ' ' ? 'space' : event.key.toLowerCase();
    const parts = [];

    // One name for both, since the studio runs on either platform.
    if (event.ctrlKey || event.metaKey) parts.push('ctrl');
    if (event.shiftKey) parts.push('shift');
    parts.push(key);

    return parts.join('+');
}

function section(group, rows) {
    return `
        <div class="sc-section">
            <h6><i class="ti ${group.icon ?? 'ti-keyboard'}"></i> ${escapeText(
                translateOr(group.label, group.fallback)
            )}</h6>
            <table>${rows}</table>
        </div>`;
}

/**
 * `Ctrl+S` as two keycaps, `A S D` as three.
 *
 * The `+` is only a separator when it has a key on either side of it. On its
 * own it is the key (the one that raises the tempo) and splitting there
 * printed two empty caps joined by a plus, which is what the help window was
 * showing for BPM.
 */
export function keycaps(shown) {
    const combination = /\S\s*\+\s*\S/.test(shown);
    const keys = combination ? shown.split(/\s*\+\s*/) : shown.trim().split(/\s+/);

    return keys.map((key) => `<kbd>${escapeText(key)}</kbd>`).join(combination ? ' + ' : ' ');
}

function escapeText(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}
