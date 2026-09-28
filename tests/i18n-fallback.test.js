import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { translateOr, i18n } from '../src/i18n/i18n.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('translateOr', () => {
    it('translates a key that exists', () => {
        expect(translateOr('menu.library', 'Library')).toBe('Library');
    });

    it('uses the fallback for a key nothing has', () => {
        expect(translateOr('nowhere.at.all', 'Written here')).toBe('Written here');
    });

    it('fills placeholders when the key exists', () => {
        expect(translateOr('export.summary', 'fallback', { files: 3, duration: '2s' })).toContain(
            '3'
        );
    });

    it('never shows a key to the reader', () => {
        expect(translateOr('nowhere.at.all', 'Written here')).not.toContain('nowhere');
    });
});

describe('interface strings', () => {
    const english = JSON.parse(
        readFileSync(path.join(ROOT, 'src', 'i18n', 'locales', 'en.json'), 'utf8')
    );

    /**
     * Every source file under src/ui, so a new window is covered by default.
     *
     * The markup counts. It holds 235 of the studio's keys against the
     * modules' own handful, and for a while this test skipped it: three
     * theme names carried keys no dictionary had, and every language
     * showed them in English with nothing to say so.
     */
    const uiFiles = readdirSync(path.join(ROOT, 'src', 'ui'))
        .filter((file) => file.endsWith('.js') || file.endsWith('.html'))
        .map((file) => ({
            name: file,
            source: readFileSync(path.join(ROOT, 'src', 'ui', file), 'utf8')
        }));

    it('never falls back with `||`, which cannot work', () => {
        // `t('x') || 'Fallback'` reads as a fallback but is not one: t returns
        // the key itself when it is missing, and a key is truthy.
        for (const { name, source } of uiFiles) {
            const broken = source.match(/\bt\(['"][\w.]+['"][^)]*\)\s*\|\|/g) ?? [];
            expect(broken, `${name} uses a fallback that cannot fire`).toEqual([]);
        }
    });

    it('declares every data-i18n key the markup uses', () => {
        const missing = [];
        let seen = 0;

        for (const { name, source } of uiFiles) {
            for (const match of source.matchAll(/data-i18n(?:-\w+)?="([\w.]+)"/g)) {
                seen += 1;
                if (!(match[1] in english)) missing.push(`${name}: ${match[1]}`);
            }
        }

        expect(missing).toEqual([]);
        // A test that reads no attributes passes for the wrong reason. If the
        // shell is ever renamed or moved, this is what says so.
        expect(seen).toBeGreaterThan(200);
    });

    it('declares every key passed to the translator', () => {
        const missing = [];

        for (const { name, source } of uiFiles) {
            for (const match of source.matchAll(/\btranslateOr\(\s*['"]([\w.]+)['"]/g)) {
                if (!(match[1] in english)) missing.push(`${name}: ${match[1]}`);
            }
            for (const match of source.matchAll(/\bt\(\s*['"]([\w.]+)['"]/g)) {
                if (!(match[1] in english)) missing.push(`${name}: ${match[1]}`);
            }
        }

        expect(missing).toEqual([]);
    });

    it('ships the studio in the language the dictionaries are written for', () => {
        expect(i18n.language).toBe('en');
        expect(i18n.has('menu.sequencer')).toBe(true);
    });
});
