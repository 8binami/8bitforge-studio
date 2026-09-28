import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ThemeEngine, THEME_EVENTS, DEFAULT_THEME } from '../src/ui/theme-engine.js';
import { EventBus } from '../src/core/event-bus.js';

/**
 * A DOM double: the theme engine only needs to create elements, put them in
 * the page and take them back out.
 */
function fakeDocument() {
    const head = makeElement('head');
    const body = makeElement('body');
    const documentElement = makeElement('html');
    documentElement.dataset = {};
    documentElement.style = {};

    return {
        head,
        body,
        documentElement,
        createElement: (tag) => makeElement(tag),
        querySelectorAll: () => []
    };
}

function makeElement(tag) {
    const element = {
        tag,
        id: '',
        textContent: '',
        style: { cssText: '' },
        dataset: {},
        children: [],
        parent: null,
        appendChild(child) {
            child.parent = element;
            element.children.push(child);
            return child;
        },
        remove() {
            const index = element.parent?.children.indexOf(element) ?? -1;
            if (index >= 0) element.parent.children.splice(index, 1);
            element.parent = null;
        }
    };
    return element;
}

function makeEngine() {
    const bus = new EventBus();
    const changes = [];
    bus.on(THEME_EVENTS.changed, (theme) => changes.push(theme));
    return { bus, changes, engine: new ThemeEngine({ bus }) };
}

let store;

beforeEach(() => {
    vi.stubGlobal('document', fakeDocument());

    store = new Map();
    vi.stubGlobal('localStorage', {
        getItem: (key) => store.get(key) ?? null,
        setItem: (key, value) => store.set(key, value)
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('ThemeEngine catalogue', () => {
    it('lists the themes it ships, with a name and a description', () => {
        const themes = ThemeEngine.getThemeList();

        expect(themes.length).toBeGreaterThan(0);
        for (const theme of themes) {
            expect(theme.id).toBeTruthy();
            expect(theme.name).toBeTruthy();
            expect(typeof theme.description).toBe('string');
        }
    });

    it('gives every theme a stylesheet', () => {
        for (const [id, theme] of Object.entries(ThemeEngine.THEMES)) {
            expect(theme.css, `${id} has no css`).toBeTruthy();
        }
    });
});

describe('ThemeEngine applying', () => {
    let engine;

    beforeEach(() => {
        ({ engine } = makeEngine());
    });

    it('starts on the default, which injects nothing', () => {
        expect(engine.current).toBe(DEFAULT_THEME);
        expect(document.head.children).toHaveLength(0);
    });

    it('injects a stylesheet and marks the page', () => {
        engine.apply('synthwave');

        expect(engine.current).toBe('synthwave');
        expect(document.head.children).toHaveLength(1);
        expect(document.head.children[0].tag).toBe('style');
        expect(document.head.children[0].textContent).toContain('!important');
        expect(document.documentElement.dataset.forgeTheme).toBe('synthwave');
    });

    it('adds the overlay a theme asks for', () => {
        engine.apply('synthwave');
        expect(document.body.children).toHaveLength(1);
        expect(document.body.children[0].style.cssText).toContain('pointer-events:none');
    });

    it('never stacks two themes', () => {
        engine.apply('synthwave');
        engine.apply('midnoir');

        expect(document.head.children).toHaveLength(1);
        expect(document.body.children.length).toBeLessThanOrEqual(1);
        expect(engine.current).toBe('midnoir');
    });

    it('takes everything back out for the default', () => {
        engine.apply('synthwave');
        engine.apply(DEFAULT_THEME);

        expect(document.head.children).toHaveLength(0);
        expect(document.body.children).toHaveLength(0);
        expect(document.documentElement.dataset.forgeTheme).toBeUndefined();
        expect(engine.current).toBe(DEFAULT_THEME);
    });

    it('treats a theme it does not have as the default', () => {
        expect(engine.apply('disco')).toBe(DEFAULT_THEME);
        expect(document.head.children).toHaveLength(0);
    });

    it('announces the change', () => {
        const { engine: announced, changes } = makeEngine();

        announced.apply('warmtape');
        announced.apply(DEFAULT_THEME);

        expect(changes).toEqual(['warmtape', DEFAULT_THEME]);
    });
});

describe('ThemeEngine preference', () => {
    it('remembers the choice and restores it', () => {
        const first = makeEngine().engine;
        first.apply('phosphor');

        const second = makeEngine().engine;
        expect(second.init()).toBe('phosphor');
        expect(second.current).toBe('phosphor');
    });

    it('starts on the default when nothing was chosen', () => {
        expect(makeEngine().engine.init()).toBe(DEFAULT_THEME);
    });

    it('still applies a theme when storage is blocked', () => {
        vi.stubGlobal('localStorage', {
            getItem: () => {
                throw new Error('blocked');
            },
            setItem: () => {
                throw new Error('blocked');
            }
        });

        const { engine } = makeEngine();

        expect(() => engine.apply('inverse')).not.toThrow();
        expect(engine.current).toBe('inverse');
        expect(engine.init()).toBe(DEFAULT_THEME);
    });
});
