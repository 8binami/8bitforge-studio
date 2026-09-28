/**
 * Translation.
 *
 * Ten languages, kept as JSON dictionaries of flat keys: no build step, no
 * translation service, nothing to call at runtime. A locale is loaded on
 * demand and English is always loaded as the fallback, so a key missing from
 * a translation shows the English text rather than the raw key.
 *
 * This module holds strings, not markup: applying them to the page belongs to
 * the interface, which listens for `i18n:changed`.
 */

import { bus as sharedBus } from '../core/event-bus.js';

export const I18N_EVENTS = Object.freeze({
    changed: 'i18n:changed'
});

export const DEFAULT_LANGUAGE = 'en';

/** The languages that ship with the studio, in the order a menu lists them. */
export const SUPPORTED_LANGUAGES = Object.freeze([
    { code: 'en', name: 'English' },
    { code: 'fr', name: 'Français' },
    { code: 'de', name: 'Deutsch' },
    { code: 'es', name: 'Español' },
    { code: 'it', name: 'Italiano' },
    { code: 'pt', name: 'Português' },
    { code: 'ru', name: 'Русский' },
    { code: 'ja', name: '日本語' },
    { code: 'ko', name: '한국어' },
    { code: 'zh', name: '中文' }
]);

const LANGUAGE_CODES = SUPPORTED_LANGUAGES.map((language) => language.code);

const STORAGE_KEY = '8bitforge-language';

/**
 * Every dictionary, resolved at build time. The glob is eager on purpose:
 * ten small JSON files cost less than ten round trips, and the desktop build
 * has to work with no network at all.
 */
const DICTIONARIES = import.meta.glob('./locales/*.json', { eager: true, import: 'default' });

export class I18n {
    /**
     * @param {object} [options]
     * @param {import('../core/event-bus.js').EventBus} [options.bus]
     * @param {Record<string, Record<string, string>>} [options.dictionaries] for tests
     */
    constructor({ bus = sharedBus, dictionaries = null } = {}) {
        this._bus = bus;
        this._dictionaries = dictionaries ?? loadBundledDictionaries();

        this.language = DEFAULT_LANGUAGE;
        this.fallback = this._dictionaries[DEFAULT_LANGUAGE] ?? {};
        this.strings = this.fallback;

        /** Keys asked for that no dictionary had. Useful while developing. */
        this.missing = new Set();
    }

    /**
     * Pick the language: the one asked for, the one stored from last time, the
     * browser's, or English.
     *
     * @param {string|null} [language]
     */
    init(language = null) {
        this.setLanguage(
            language || readStoredLanguage() || detectBrowserLanguage() || DEFAULT_LANGUAGE
        );
        return this.language;
    }

    /** @param {string} language */
    setLanguage(language) {
        const code = LANGUAGE_CODES.includes(language) ? language : DEFAULT_LANGUAGE;

        this.language = code;
        this.strings = this._dictionaries[code] ?? this.fallback;
        storeLanguage(code);

        this._bus.emit(I18N_EVENTS.changed, code);
        return code;
    }

    /**
     * Translate a key.
     *
     * @param {string} key
     * @param {Record<string, string|number>} [params]  fills {placeholders}
     * @returns {string} the translation, the English text, or the key itself
     */
    t(key, params = null) {
        let text = this.strings[key] ?? this.fallback[key];

        if (text === undefined) {
            this.missing.add(key);
            text = key;
        }

        if (params) {
            for (const [name, value] of Object.entries(params)) {
                text = text.split(`{${name}}`).join(String(value));
            }
        }
        return text;
    }

    /** Whether a key exists at all, in this language or in English. */
    has(key) {
        return this.strings[key] !== undefined || this.fallback[key] !== undefined;
    }

    /** @returns {typeof SUPPORTED_LANGUAGES} */
    get languages() {
        return SUPPORTED_LANGUAGES;
    }

    /**
     * How much of English a language covers, 0 to 1. The interface can warn
     * about a thin translation instead of quietly showing English.
     */
    coverage(language = this.language) {
        const dictionary = this._dictionaries[language];
        if (!dictionary) return 0;

        const keys = Object.keys(this.fallback);
        if (keys.length === 0) return 1;

        const translated = keys.filter((key) => dictionary[key] !== undefined).length;
        return translated / keys.length;
    }
}

/** The studio's translator. */
export const i18n = new I18n();

/** Shorthand, for modules that only need to translate. */
export const t = (key, params) => i18n.t(key, params);

/**
 * Translate, falling back to text written at the call site.
 *
 * `t` returns the key itself when nothing has it, which is what you want in
 * markup: the key is visible and obviously wrong. In a status line it is
 * not: the reader would see `library.saved`. Use this where a sentence has
 * to read correctly even if the key were ever missing.
 *
 * @param {string} key
 * @param {string} fallback
 * @param {Record<string, string|number>} [params]
 */
export function translateOr(key, fallback, params) {
    return i18n.has(key) ? i18n.t(key, params) : fallback;
}

function loadBundledDictionaries() {
    const dictionaries = {};
    for (const [path, dictionary] of Object.entries(DICTIONARIES)) {
        const code = path.replace('./locales/', '').replace('.json', '');
        dictionaries[code] = dictionary;
    }
    return dictionaries;
}

/**
 * The language is a per-viewer preference, not project data: a blocked or
 * missing storage is not an error, it just means English.
 */
function readStoredLanguage() {
    try {
        return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
    } catch {
        return null;
    }
}

function storeLanguage(code) {
    try {
        globalThis.localStorage?.setItem(STORAGE_KEY, code);
    } catch {
        // private window, blocked site data: the choice lasts this session
    }
}

function detectBrowserLanguage() {
    const preferred = globalThis.navigator?.language;
    if (!preferred) return null;

    const code = preferred.slice(0, 2).toLowerCase();
    return LANGUAGE_CODES.includes(code) ? code : null;
}
