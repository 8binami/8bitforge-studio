/**
 * The shortcut table.
 *
 * The keys themselves need a browser, and were checked in one. What is
 * here is the table they and the help window both read: the whole point
 * of there being one table is that a row cannot work without being listed
 * or be listed without working, and that is a property of the data.
 *
 * Plus the accelerator spelling, which is the only arithmetic in the
 * module and the one thing that fails silently: a key spelled one way in
 * the table and another by the event simply never fires, with nothing
 * anywhere to say so.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SHORTCUTS, SHORTCUT_GROUPS, acceleratorOf, keycaps } from '../src/ui/shortcuts.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** A keydown as the browser would report it. */
function keydown(key, { ctrl = false, shift = false, meta = false } = {}) {
    return { key, ctrlKey: ctrl, shiftKey: shift, metaKey: meta };
}

describe('the table', () => {
    it('gives every shortcut a group the help window shows', () => {
        const groups = new Set(SHORTCUT_GROUPS.map((group) => group.id));
        const orphans = SHORTCUTS.filter((shortcut) => !groups.has(shortcut.group));

        // A row in no group is a shortcut that works and is documented
        // nowhere, which is the failure this table exists to prevent.
        expect(orphans.map((shortcut) => shortcut.keys[0])).toEqual([]);
    });

    it('gives every group at least one shortcut', () => {
        const used = new Set(SHORTCUTS.map((shortcut) => shortcut.group));

        expect(SHORTCUT_GROUPS.filter((group) => !used.has(group.id))).toEqual([]);
    });

    it('claims no key twice', () => {
        const claimed = SHORTCUTS.flatMap((shortcut) => shortcut.keys);

        // Two rows on one key means whichever was written second never
        // runs, and both appear in the list.
        expect(claimed).toHaveLength(new Set(claimed).size);
    });

    it('spells every key the way an event is spelled', () => {
        // Lower case, `ctrl` then `shift`, and a literal key at the end.
        // A row spelled `Ctrl+S` or `shift+ctrl+z` would never match.
        const wrong = SHORTCUTS.flatMap((shortcut) => shortcut.keys).filter(
            (key) => !/^(ctrl\+)?(shift\+)?[^+]+$|^(ctrl\+)?(shift\+)?\+$/.test(key)
        );

        expect(wrong).toEqual([]);
    });

    it('prints a key on every cap the help window draws', () => {
        // An empty `<kbd>` is the one way this window fails without saying
        // so: the row is there, the description is there, and the cap beside
        // it is a blank box. It happened to `+`, which is both the key that
        // raises the tempo and the character that joins two keys together.
        const blank = SHORTCUTS.map((shortcut) => shortcut.shown ?? shortcut.keys[0])
            .map((shown) => [shown, keycaps(shown)])
            .filter(([, html]) => html.includes('<kbd></kbd>'))
            .map(([shown]) => shown);

        expect(blank).toEqual([]);
    });

    it('reads a plus as a joiner only between two keys', () => {
        expect(keycaps('Ctrl+S')).toBe('<kbd>Ctrl</kbd> + <kbd>S</kbd>');
        expect(keycaps('+')).toBe('<kbd>+</kbd>');
        expect(keycaps('A S D')).toBe('<kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd>');
    });

    it('gives every shortcut something to run and something to say', () => {
        for (const shortcut of SHORTCUTS) {
            expect(typeof shortcut.run, shortcut.keys[0]).toBe('function');
            expect(shortcut.label, shortcut.keys[0]).toMatch(/^sc\./);
            expect(shortcut.fallback, shortcut.keys[0]).toBeTruthy();
        }
    });

    it('describes every shortcut in a language the studio ships', () => {
        const english = JSON.parse(
            readFileSync(path.join(ROOT, 'src', 'i18n', 'locales', 'en.json'), 'utf8')
        );
        const keys = [
            ...SHORTCUTS.map((shortcut) => shortcut.label),
            ...SHORTCUT_GROUPS.map((group) => group.label)
        ];

        expect(keys.filter((key) => !(key in english))).toEqual([]);
    });
});

describe('spelling a keystroke', () => {
    it('names the plain keys', () => {
        expect(acceleratorOf(keydown(' '))).toBe('space');
        expect(acceleratorOf(keydown('R'))).toBe('r');
        expect(acceleratorOf(keydown('Delete'))).toBe('delete');
        expect(acceleratorOf(keydown('4'))).toBe('4');
    });

    it('puts the modifiers in one order', () => {
        expect(acceleratorOf(keydown('z', { ctrl: true }))).toBe('ctrl+z');
        expect(acceleratorOf(keydown('Z', { ctrl: true, shift: true }))).toBe('ctrl+shift+z');
        expect(acceleratorOf(keydown('M', { shift: true }))).toBe('shift+m');
    });

    it('treats the command key as control', () => {
        // The studio runs on macOS too, and one table serves both.
        expect(acceleratorOf(keydown('s', { meta: true }))).toBe('ctrl+s');
    });

    it('matches a row for every key the studio offers', () => {
        const byKey = new Map(
            SHORTCUTS.flatMap((shortcut) => shortcut.keys.map((key) => [key, shortcut]))
        );

        const expected = [
            [keydown(' '), 'sc.playPause'],
            [keydown('r'), 'sc.record'],
            [keydown('5'), 'sc.switchPattern'],
            [keydown('d', { ctrl: true }), 'sc.dupPattern'],
            [keydown('Delete'), 'sc.clearPattern'],
            [keydown('s', { ctrl: true }), 'sc.save'],
            [keydown('o', { ctrl: true }), 'sc.open'],
            [keydown('e', { ctrl: true }), 'sc.export'],
            [keydown('z', { ctrl: true }), 'sc.undo'],
            [keydown('y', { ctrl: true }), 'sc.redo'],
            [keydown('z', { ctrl: true, shift: true }), 'sc.redo'],
            [keydown('p'), 'sc.pianoRoll'],
            [keydown('m'), 'sc.mute'],
            [keydown('s'), 'sc.solo'],
            [keydown('?'), 'sc.showHelp']
        ];

        for (const [event, label] of expected) {
            expect(byKey.get(acceleratorOf(event))?.label, JSON.stringify(event)).toBe(label);
        }
    });

    it('does not answer a plain S and a Ctrl+S with the same thing', () => {
        const byKey = new Map(
            SHORTCUTS.flatMap((shortcut) => shortcut.keys.map((key) => [key, shortcut]))
        );

        // Solo and Save differ by one modifier, and the spelling has to
        // keep them apart.
        expect(byKey.get('s').label).toBe('sc.solo');
        expect(byKey.get('ctrl+s').label).toBe('sc.save');
    });
});

describe('the verbs', () => {
    it('asks the studio for everything, and reaches for nothing itself', () => {
        // Every row's `run` takes the actions it is given. A row that
        // closed over a DOM node or a studio would work here and be
        // untestable everywhere else.
        const called = [];
        const actions = new Proxy(
            {},
            {
                get:
                    (_target, name) =>
                    (...args) =>
                        called.push([name, ...args])
            }
        );

        for (const shortcut of SHORTCUTS) {
            const shortcuts = { showHelp: () => called.push(['showHelp']) };
            shortcut.run({ actions, key: shortcut.keys[0], shortcuts, event: {} });
        }

        expect(called).toHaveLength(SHORTCUTS.length);
    });

    it('passes the pattern the number that was pressed', () => {
        const pressed = [];
        const actions = { switchPattern: (index) => pressed.push(index) };
        const row = SHORTCUTS.find((shortcut) => shortcut.label === 'sc.switchPattern');

        for (const key of row.keys) row.run({ actions, key });

        // The keys read 1 to 8 and the patterns count from zero.
        expect(pressed).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    });
});
