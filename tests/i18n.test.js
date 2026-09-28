import { describe, it, expect, beforeEach } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { I18n, I18N_EVENTS, SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE } from '../src/i18n/i18n.js';
import { EventBus } from '../src/core/event-bus.js';

const LOCALES_DIR = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'src',
    'i18n',
    'locales'
);

const readLocale = (code) =>
    JSON.parse(readFileSync(path.join(LOCALES_DIR, `${code}.json`), 'utf8'));

function makeI18n(dictionaries) {
    const bus = new EventBus();
    const changes = [];
    bus.on(I18N_EVENTS.changed, (code) => changes.push(code));

    return { bus, changes, i18n: new I18n({ bus, dictionaries }) };
}

const DICTIONARIES = {
    en: { 'menu.play': 'Play', 'menu.stop': 'Stop', greeting: 'Hello {name}' },
    fr: { 'menu.play': 'Lecture', greeting: 'Bonjour {name}' }
};

describe('I18n', () => {
    let i18n;

    beforeEach(() => {
        ({ i18n } = makeI18n(DICTIONARIES));
    });

    it('starts in English', () => {
        expect(i18n.language).toBe(DEFAULT_LANGUAGE);
        expect(i18n.t('menu.play')).toBe('Play');
    });

    it('translates once a language is chosen', () => {
        i18n.setLanguage('fr');
        expect(i18n.t('menu.play')).toBe('Lecture');
    });

    it('falls back to English for a key a translation lacks', () => {
        i18n.setLanguage('fr');
        expect(i18n.t('menu.stop')).toBe('Stop');
    });

    it('shows the key itself when nothing has it, and remembers that it did', () => {
        expect(i18n.t('menu.nowhere')).toBe('menu.nowhere');
        expect([...i18n.missing]).toEqual(['menu.nowhere']);
    });

    it('fills placeholders', () => {
        expect(i18n.t('greeting', { name: 'Dbenkei' })).toBe('Hello Dbenkei');

        i18n.setLanguage('fr');
        expect(i18n.t('greeting', { name: 'Dbenkei' })).toBe('Bonjour Dbenkei');
    });

    it('fills a placeholder used more than once', () => {
        const { i18n: repeated } = makeI18n({ en: { echo: '{word} {word}' } });
        expect(repeated.t('echo', { word: 'hi' })).toBe('hi hi');
    });

    it('ignores a language it does not ship', () => {
        expect(i18n.setLanguage('xx')).toBe('en');
        expect(i18n.language).toBe('en');
    });

    it('says whether a key exists', () => {
        expect(i18n.has('menu.play')).toBe(true);
        expect(i18n.has('menu.nowhere')).toBe(false);
    });

    it('announces a language change', () => {
        const { i18n: announced, changes } = makeI18n(DICTIONARIES);
        announced.setLanguage('fr');
        expect(changes).toEqual(['fr']);
    });

    it('reports how much of English a language covers', () => {
        expect(i18n.coverage('en')).toBe(1);
        expect(i18n.coverage('fr')).toBeCloseTo(2 / 3, 5);
        expect(i18n.coverage('xx')).toBe(0);
    });

    it('lists the languages it offers', () => {
        expect(i18n.languages).toBe(SUPPORTED_LANGUAGES);
        expect(SUPPORTED_LANGUAGES[0].code).toBe('en');
    });
});

describe('the shipped dictionaries', () => {
    const codes = SUPPORTED_LANGUAGES.map((language) => language.code);
    const english = readLocale('en');

    it('ships a file for every language on offer, and no other', () => {
        const files = readdirSync(LOCALES_DIR)
            .filter((file) => file.endsWith('.json'))
            .map((file) => file.replace('.json', ''))
            .sort();

        expect(files).toEqual([...codes].sort());
    });

    it('has a decent number of keys to begin with', () => {
        expect(Object.keys(english).length).toBeGreaterThan(500);
    });

    for (const code of codes.filter((item) => item !== 'en')) {
        it(`${code} translates every English key`, () => {
            const dictionary = readLocale(code);
            const missing = Object.keys(english).filter((key) => !(key in dictionary));

            expect(missing).toEqual([]);
        });

        it(`${code} has no key English does not`, () => {
            const dictionary = readLocale(code);
            const extra = Object.keys(dictionary).filter((key) => !(key in english));

            expect(extra).toEqual([]);
        });

        it(`${code} leaves no translation empty`, () => {
            const dictionary = readLocale(code);
            const empty = Object.entries(dictionary)
                .filter(([, value]) => typeof value !== 'string' || value.trim() === '')
                .map(([key]) => key);

            expect(empty).toEqual([]);
        });
    }
});
