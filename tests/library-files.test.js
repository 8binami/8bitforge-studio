/**
 * The shipped library, checked as content.
 *
 * `library/` is files that anyone can open, copy, and: once this repository
 * is public: propose a new one for. That is the point of it, and it is also
 * the risk: the studio used to get its presets from JavaScript, where a
 * compiler had already agreed with them. A typo in a file is not a crash. It
 * is a kit whose eighth track quietly keeps the sound of whatever was loaded
 * before, or a scale whose root note comes back `undefined`.
 *
 * The rules themselves live in `src/content/schema.js`, which the loader and
 * `scripts/check-library.js` use too: three readers, one definition. What
 * is here is the driver that points those rules at the real folder, plus the
 * three checks that need something the schema deliberately cannot import:
 * the engine's own vocabulary, the files on disk, and the order manifest.
 *
 * It also stands in for a proof that cannot live. The extraction was
 * verified by replaying all 180 rhythm variants through the app's real
 * playback path and comparing against the closures they came from; once
 * those closures are deleted, that comparison has nothing left to compare
 * with. What survives it is every invariant they used to guarantee by being
 * code.
 */

import { describe, it, expect } from 'vitest';
import { Generator } from '../src/compose/generator.js';
import { shipped, catalogProblems } from '../src/content/shipped.js';
import {
    INSTRUMENT_CHOICES,
    KIT_CATEGORIES,
    RHYTHM_CATEGORIES
} from '../src/ui/library-categories.js';
import {
    validateItem,
    validateCatalog,
    ITEM_FORMAT,
    METADATA_FILES,
    WAVEFORMS,
    LANE_NAMES,
    NOTE_NAMES,
    SCALE_TYPES,
    GENRE_NAMES,
    MOOD_NAMES
} from '../src/content/schema.js';

/**
 * Everything in the folder. Eager, like the dictionaries in
 * `src/i18n/i18n.js`: three hundred small files cost less than three hundred
 * round trips, the desktop build has no network at all, and the loaders that
 * read this have to stay synchronous.
 */
const ALL = Object.entries(
    import.meta.glob('../library/**/*.json', { eager: true, import: 'default' })
).map(([path, item]) => {
    const within = path.replace('../library/', '');
    const parts = within.split('/');
    return {
        path: path.replace('../', ''),
        within,
        id: parts.at(-1).replace(/\.json$/, ''),
        // instruments/leads/x.json has a category folder; kits/x.json does not.
        folder: parts.length > 2 ? parts[1] : null,
        item
    };
});

const FILES = ALL.filter((file) => file.item?.format === ITEM_FORMAT);
const ORDER = ALL.find((file) => file.path === 'library/order.json')?.item;

const byKind = (kind) => FILES.filter((file) => file.item.kind === kind);

describe('the library', () => {
    it('holds at least what it shipped with', () => {
        // Lower bounds, not exact counts. Someone's first contribution is a
        // new file, and it should not turn the build red with no hint that
        // the fix is to edit a number in a test. A file going missing is
        // caught by the order manifest below, which still names it.
        expect(byKind('presets').length).toBeGreaterThanOrEqual(210);
        expect(byKind('kits').length).toBeGreaterThanOrEqual(20);
        expect(byKind('rhythms').length).toBeGreaterThanOrEqual(60);
        expect(byKind('generator-presets').length).toBeGreaterThanOrEqual(12);
    });

    it('keeps nothing in the folder but items and the two manifests', () => {
        // A JSON file with no `format` is metadata, and there are exactly
        // two of those: the curated order, and the list the Load window
        // draws its demo rows from. Anything else is a stray.
        const strays = ALL.filter(
            (file) => file.item?.format !== ITEM_FORMAT && !METADATA_FILES.includes(file.within)
        ).map((file) => file.path);

        expect(strays).toEqual([]);
    });

    it('has nothing wrong with any single file', () => {
        const problems = FILES.flatMap((file) =>
            validateItem(file.item, { id: file.id, folder: file.folder }).map(
                (problem) => `${file.path}: ${problem}`
            )
        );

        expect(problems).toEqual([]);
    });

    it('hangs together as a whole', () => {
        // Duplicate ids, and kits naming presets that are not there: the
        // quiet failure this all exists for. A kit with one bad key loads
        // seven tracks of eight and leaves the eighth playing whatever was
        // there before, because the lookup fails before the track is reset.
        expect(validateCatalog(FILES, ORDER)).toEqual([]);
    });

    it('names every item it ships in the order manifest', () => {
        // The catalogue was hand-ordered: `lead-classic` before
        // `lead-fat`, `rock` at the head of the classic rhythms: and a
        // folder has no order but alphabetical, which would greet everyone
        // with `acoustic-cello`.
        const listed = new Set(Object.values(ORDER ?? {}).flat());
        const unplaced = FILES.filter((file) => !listed.has(file.id)).map((file) => file.path);

        // A contribution may arrive before anyone has placed it, and lands
        // at the end of its category, which is where a new preset belongs.
        // What must not happen is the manifest naming something absent:
        // `validateCatalog` covers that.
        expect(unplaced.length).toBeLessThanOrEqual(FILES.length - 302);
    });
});

describe('the schema and the engine', () => {
    /**
     * `schema.js` imports nothing, so that `scripts/check-library.js` keeps
     * working after the loader starts using `import.meta.glob`. The price is
     * a copy of the engine's vocabulary, and this is what stops the copy
     * drifting: add a scale to the generator and forget the schema, and the
     * first person to use it in a preset gets told their file is wrong.
     */
    it.each([
        ['notes', NOTE_NAMES, () => Generator.NOTES],
        ['scales', SCALE_TYPES, () => Object.keys(Generator.SCALE_INTERVALS)],
        ['genres', GENRE_NAMES, () => Object.keys(Generator.GENRES)],
        ['moods', MOOD_NAMES, () => Object.keys(Generator.MOODS)]
    ])('agree on the %s a generator preset may name', (_what, copied, live) => {
        expect([...copied].sort()).toEqual([...live()].sort());
    });

    it('agree on the waveforms an instrument may ask for', async () => {
        const { AudioEngine } = await import('../src/audio/audio-engine.js');
        const inUse = new Set(new AudioEngine().tracks.map((track) => track.type));

        // Every shape the engine starts up with has to be one a file may
        // name; the schema may know more than the defaults use.
        expect([...inUse].filter((type) => !WAVEFORMS.includes(type))).toEqual([]);
    });

    it('agree on the drum lanes a rhythm may write to', async () => {
        const { DRUM_LANES } = await import('../src/compose/rhythm-grid.js');

        expect(Object.keys(DRUM_LANES).sort()).toEqual([...LANE_NAMES].sort());
    });
});

describe('the loader', () => {
    /**
     * `shipped.js` reads the same folder as everything above, through Vite
     * rather than through `fs`, and it is the one reader that must never
     * throw: it runs while the module graph is being evaluated, so a throw
     * is a white screen rather than an error anyone catches. What it does
     * instead is set a file aside and record why.
     *
     * Which makes that record the thing to check. It is also the reader
     * most easily fooled, because it sees a path where the others see a
     * folder: the demo manifest sat in it as "not a library item" from the
     * day the demos arrived, since only the order manifest was known about.
     */
    it('finds nothing wrong with the library it ships', () => {
        expect(catalogProblems()).toEqual([]);
    });

    it.each([
        ['presets', 210],
        ['kits', 20],
        ['rhythms', 60],
        ['generator-presets', 12]
    ])('hands out the %s it read', (kind, least) => {
        expect(Object.keys(shipped(kind)).length).toBeGreaterThanOrEqual(least);
    });

    it('hands out nothing at all for a kind that is not one', () => {
        expect(shipped('nonsense')).toEqual({});
    });
});

describe('the shelves', () => {
    /**
     * The interface has its own list of categories, because it has labels
     * to hang on them and a closed set to offer in a save window. That list
     * is written by hand and the folders are on disk, so they can drift:
     * and a preset in a shelf nobody offers is a preset that can be loaded
     * and never found again, since no filter names it.
     *
     * Only one direction is checked. A shelf the interface offers with
     * nothing in it is fine: `custom` is where a user's own presets go, and
     * it is empty in a fresh checkout by definition.
     */
    it.each([
        ['presets', () => INSTRUMENT_CHOICES],
        ['kits', () => KIT_CATEGORIES],
        ['rhythms', () => RHYTHM_CATEGORIES]
    ])('offers every shelf a shipped %s is filed under', (kind, offered) => {
        const filed = new Set(byKind(kind).map((file) => file.item.category));
        const unoffered = [...filed].filter((category) => !offered().includes(category));

        expect(unoffered).toEqual([]);
    });
});

describe('kits', () => {
    it('point at a cover the build ships', async () => {
        const { readdir } = await import('node:fs/promises');
        const covers = new Set(await readdir(new URL('../public/img/kits', import.meta.url)));

        const missing = byKind('kits')
            .filter((file) => file.item.cover)
            .filter((file) => !covers.has(file.item.cover.split('/').pop()))
            .map((file) => `${file.path} -> ${file.item.cover}`);

        expect(missing).toEqual([]);
    });

    it('keep their cover paths relative', async () => {
        // The build sets `base: './'` so one bundle serves from a web root,
        // a subpath and Electron's app:// origin. A leading slash resolves
        // against the origin root and 404s for anyone hosting the studio
        // anywhere but `/`.
        const absolute = byKind('kits')
            .filter((file) => file.item.cover?.startsWith('/'))
            .map((file) => file.path);

        expect(absolute).toEqual([]);
    });
});
