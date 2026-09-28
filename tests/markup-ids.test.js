/**
 * Every element a panel reaches for is in the page.
 *
 * A panel asks for its controls by id, and `_el` returns null for an id
 * that is not there. Every call site is written null-safe, correctly:
 * so a mistyped or renamed id is not an error, not a warning and not a
 * crash. It is a control that quietly stops working.
 *
 * That is not hypothetical. `generator-panel.js` bound `phraseSelect`
 * while the markup said `phraseLengthSelect`, so the phrase-length
 * drop-down changed nothing and every generated piece used the default
 * for months. `track-rows.js` carried a `#trackSelect` that has never
 * existed in either application. Both are the same failure, and both
 * are caught here by reading rather than by remembering.
 *
 * Two kinds of reference are checked: an id written into a call, and an
 * id declared in one of the tables a panel drives itself from. Ids a
 * module builds its own markup for are left out: those are its to
 * invent.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SLIDERS, SELECTS, TRACK_BUTTONS, VARIATIONS } from '../src/ui/generator-panel.js';
import { KEYBOARD_SKINS } from '../src/ui/keyboard-panel.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const UI = path.join(ROOT, 'src', 'ui');

const shell = readFileSync(path.join(UI, 'app-shell.html'), 'utf8');

/** @type {Set<string>} every id the studio's markup declares. */
const PAGE = new Set([...shell.matchAll(/id="([\w-]+)"/g)].map((match) => match[1]));

const modules = readdirSync(UI)
    .filter((file) => file.endsWith('.js'))
    .map((file) => ({ name: file, source: readFileSync(path.join(UI, file), 'utf8') }));

describe('the markup a panel expects', () => {
    it('declares enough ids for this test to mean anything', () => {
        // Reading the wrong file would make every assertion below pass.
        expect(PAGE.size).toBeGreaterThan(500);
    });

    it('holds every id a module asks for by name', () => {
        const missing = [];

        for (const { name, source } of modules) {
            // What the module writes itself is its own to name.
            const built = new Set(
                [...source.matchAll(/id=["'](\$\{[^}]*\}|[\w-]+)["']/g)].map((match) => match[1])
            );

            const asked = [
                ...source.matchAll(/_el\(\s*'([\w-]+)'/g),
                ...source.matchAll(/querySelector\(\s*'#([\w-]+)'/g)
            ].map((match) => match[1]);

            for (const id of asked) {
                if (!PAGE.has(id) && !built.has(id)) missing.push(`${name}: #${id}`);
            }
        }

        expect(missing).toEqual([]);
    });
});

describe('the generator panel', () => {
    /** Its four tables, which is the whole of what it binds. */
    const declared = [
        ...SLIDERS.flatMap((row) => [row.id, row.value]),
        ...SELECTS.map((row) => row.id),
        ...Object.keys(TRACK_BUTTONS),
        ...Object.keys(VARIATIONS)
    ];

    it('names an element in the page for every row of every table', () => {
        expect(declared.filter((id) => !PAGE.has(id))).toEqual([]);
    });

    it('has tables worth checking', () => {
        expect(declared.length).toBeGreaterThan(15);
    });
});

describe('the two keyboards', () => {
    const skins = Object.entries(KEYBOARD_SKINS);

    it('each stand somewhere the page has', () => {
        for (const [name, skin] of skins) {
            expect(PAGE.has(skin.container), `${name}: #${skin.container}`).toBe(true);
        }
    });

    it('name every class the panel draws with', () => {
        // A skin missing a name draws `class="undefined"`, which is styled by
        // nothing and reads as a pile of bare divs.
        const [, first] = skins[0];

        for (const [name, skin] of skins) {
            for (const key of Object.keys(first)) {
                expect(key in skin, `${name}: ${key}`).toBe(true);
            }
        }
    });

    it('do not share a class between them', () => {
        const [, card] = skins.find(([name]) => name === 'card');
        const [, window_] = skins.find(([name]) => name === 'window');

        // Two keyboards with one set of class names would answer each other's
        // queries: `_key()` would find whichever came first in the document.
        for (const key of ['container', 'key', 'white', 'black', 'whites', 'blacks', 'pcLabel']) {
            expect(card[key], key).not.toBe(window_[key]);
        }
    });

    it('agrees that only one of them steps aside for a window', () => {
        const standing = skins.filter(([, skin]) => skin.standsDownForWindows);

        expect(standing).toHaveLength(1);
        expect(standing[0][0]).toBe('card');
    });
});
