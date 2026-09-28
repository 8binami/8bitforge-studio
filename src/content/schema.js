/**
 * What makes a library file a library file.
 *
 * The studio used to get its presets from JavaScript, where a compiler had
 * already agreed with them. It gets them from `library/` now, where anyone
 * can write one by hand, and where being wrong does not look like an error.
 * A mistyped `presetKey` in a kit loads seven tracks of eight and leaves the
 * eighth playing whatever was there before. A mistyped `rootKey` makes a
 * scale of `undefined` and generates silence. Neither throws.
 *
 * So this says what a file has to be, and it is the only place that says it.
 * Three things use it and they must agree: the loader that feeds the studio,
 * the test suite, and `scripts/check-library.js`.
 *
 * It imports nothing, on purpose. The checker has to keep working after the
 * loader starts using `import.meta.glob`, and that is undefined outside
 * Vite: a validator that imported the loader would stop running exactly
 * when it became load-bearing.
 *
 * Every function here RETURNS problems rather than throwing them. A bad file
 * should cost you that file, not the application: the studio has no CI
 * behind it today, and a throw during module evaluation is a white screen.
 */

export const ITEM_FORMAT = '8bit-forge-item';
export const ITEM_VERSION = '1.0';

/**
 * The files in `library/` that describe the collection rather than belong
 * to it. They carry no `format`, which is how everything reading the
 * library tells them from an item; naming them here is what stops a stray
 * JSON file being mistaken for one.
 */
export const METADATA_FILES = Object.freeze(['order.json', 'demos/index.json']);

/** The kinds a shipped file can declare, and the folder each lives in. */
export const KIND_FOLDERS = Object.freeze({
    presets: 'instruments',
    kits: 'kits',
    rhythms: 'rhythms',
    'generator-presets': 'generators'
});

/** Oscillator shapes the audio engine knows how to build. */
export const WAVEFORMS = Object.freeze(['square', 'triangle', 'sawtooth', 'sine', 'noise']);

/** The drum lanes a rhythm may write to. */
export const LANE_NAMES = Object.freeze(['kick', 'snare', 'hihat']);

/**
 * The vocabulary a generator preset draws on.
 *
 * Copied from the generator's own tables rather than imported, for the same
 * reason as everything else here: and `tests/library-files.test.js` holds
 * the two to the same lists, so the copy cannot drift in silence.
 */
export const NOTE_NAMES = Object.freeze([
    'C',
    'C#',
    'D',
    'D#',
    'E',
    'F',
    'F#',
    'G',
    'G#',
    'A',
    'A#',
    'B'
]);

export const SCALE_TYPES = Object.freeze([
    'major',
    'minor',
    'dorian',
    'mixolydian',
    'pentatonic_major',
    'pentatonic_minor',
    'blues',
    'harmonic_minor',
    'phrygian',
    'lydian',
    'whole_tone',
    'hirajoshi',
    'hungarian_minor',
    'phrygian_dominant',
    'chromatic'
]);

export const GENRE_NAMES = Object.freeze([
    'chiptune',
    'synthwave',
    'techno',
    'lofi',
    'dnb',
    'ambient',
    'funk',
    'boss',
    'menu',
    'waltz'
]);

export const MOOD_NAMES = Object.freeze([
    'epic',
    'happy',
    'dark',
    'atmospheric',
    'melancholy',
    'energetic',
    'mysterious',
    'aggressive',
    'peaceful',
    'triumphant'
]);

/** A bar. A rhythm's length is always a whole number of them. */
const BAR = 8;
/** The longest a pattern can be. */
const MAX_STEPS = 32;

/** What the interface offers for each generator dial, so a file cannot exceed it. */
const GENERATOR_RANGES = Object.freeze({
    chaos: [0, 100],
    complexity: [0, 100],
    density: [0, 100],
    swing: [0, 100],
    humanize: [0, 100],
    octaveMin: [0, 8],
    octaveMax: [0, 8],
    phraseLength: [1, 64],
    seed: [0, Number.MAX_SAFE_INTEGER]
});

/**
 * Check one file on its own.
 *
 * @param {*} item  the parsed JSON, which may be anything at all
 * @param {object} where
 * @param {string} where.id      the file's name without its extension
 * @param {string} [where.folder] the folder inside its section, if it has one
 * @returns {string[]} what is wrong with it, empty when nothing is
 */
export function validateItem(item, { id, folder = null } = {}) {
    const problems = [];
    const wrong = (message) => problems.push(message);

    if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return ['is not an object'];
    }
    if (item.format !== ITEM_FORMAT) return [`is not a library item (format "${item.format}")`];
    if (item.version !== ITEM_VERSION) wrong(`has version "${item.version}", expected 1.0`);

    if (!(item.kind in KIND_FOLDERS)) wrong(`has an unknown kind "${item.kind}"`);
    if (typeof item.name !== 'string' || !item.name.trim()) wrong('has no name');
    if (!item.data || typeof item.data !== 'object') wrong('has no data');
    if (item.tags !== undefined && !Array.isArray(item.tags)) wrong('has tags that are not a list');

    // The filename is the id. Nothing stores it inside the file, so the two
    // can never disagree: but the filename still has to be usable as one.
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
        wrong(`is named "${id}", which is not a usable id (lower case, digits and hyphens)`);
    }

    if (folder && item.category !== folder) {
        wrong(`sits in "${folder}" but says its category is "${item.category}"`);
    }

    // The library is English. A contributor writes the name and description
    // in their file, and this is the shallow check that they wrote them in
    // the language everyone reading the repository shares.
    const prose = `${item.name ?? ''} ${item.data?.description ?? ''}`;
    if (/[àâäéèêëïîôöùûüÿçñ]/i.test(prose)) wrong('has accented text; the library is in English');

    if (problems.length > 0 || !item.data) return problems;

    if (item.kind === 'presets') problems.push(...checkInstrument(item.data));
    if (item.kind === 'kits') problems.push(...checkKit(item.data));
    if (item.kind === 'rhythms') problems.push(...checkRhythm(item.data));
    if (item.kind === 'generator-presets') problems.push(...checkGenerator(item, item.data));

    return problems;
}

function checkInstrument(data) {
    const problems = [];

    if (!WAVEFORMS.includes(data.type)) problems.push(`has an unknown waveform "${data.type}"`);

    // Sparse fields are fine everywhere else: the engine fills them in.
    // These two it reads whole.
    for (const stage of ['attack', 'decay', 'sustain', 'release']) {
        if (typeof data.envelope?.[stage] !== 'number') {
            problems.push(`is missing envelope.${stage}`);
        }
    }
    for (const field of ['rate', 'depth']) {
        if (typeof data.vibrato?.[field] !== 'number') problems.push(`is missing vibrato.${field}`);
    }

    // A preset at full scale is not louder, it is clipped, and it drags the
    // whole mix down with it.
    if (!(data.volume > 0 && data.volume <= 0.5)) {
        problems.push(`has a volume of ${data.volume}; the range that mixes is 0 to 0.5`);
    }

    return problems;
}

function checkKit(data) {
    if (!Array.isArray(data.tracks)) return ['has no track list'];
    if (data.tracks.length !== 8) return [`fills ${data.tracks.length} tracks, not 8`];

    return data.tracks.flatMap((track, slot) =>
        typeof track?.presetKey === 'string' && track.presetKey
            ? []
            : [`names no preset for track ${slot}`]
    );
}

function checkRhythm(data) {
    const variants = data.variants;
    if (!variants || typeof variants !== 'object') return ['has no variants'];
    if (!variants.base) return ['has no base variant to fall back on'];

    const problems = [];

    for (const [variant, lanes] of Object.entries(variants)) {
        if (!lanes || typeof lanes !== 'object' || Object.keys(lanes).length === 0) {
            problems.push(`has an empty ${variant} variant`);
            continue;
        }

        const lengths = new Set();

        for (const [lane, row] of Object.entries(lanes)) {
            if (!LANE_NAMES.includes(lane)) {
                problems.push(`${variant} names a lane the drums do not have: "${lane}"`);
                continue;
            }
            if (typeof row !== 'string' || !/^[x.]+$/.test(row)) {
                problems.push(`${variant}.${lane} is not a row of hits and rests`);
                continue;
            }
            if (!row.includes('x')) {
                // A silent lane is left out, not written as a row of dots.
                problems.push(`${variant}.${lane} is silent; leave the lane out instead`);
            }
            lengths.add(row.length);
        }

        // The row's length IS the rhythm's length, which is what lets a
        // sixteen-step groove repeat to fill the bar. Lanes of different
        // lengths would each repeat at their own rate and drift apart.
        if (lengths.size > 1) {
            problems.push(`${variant} has lanes of different lengths: ${[...lengths].join(', ')}`);
        }

        for (const length of lengths) {
            if (length % BAR !== 0 || length < BAR || length > MAX_STEPS) {
                problems.push(`${variant} is ${length} steps; it must be 8, 16, 24 or 32`);
            }
        }
    }

    return problems;
}

function checkGenerator(item, data) {
    const problems = [];

    // The one field with no fallback anywhere: an unknown root gives -1 from
    // `indexOf`, the scale fills with `undefined`, and the generator writes
    // nothing. Every other field degrades; this one corrupts.
    if (!NOTE_NAMES.includes(data.rootKey)) {
        problems.push(`has an unknown root note "${data.rootKey}"`);
    }

    // These three do have fallbacks, which is worse in its way: a typo
    // reproduces differently on someone else's machine, and a preset that
    // carries a seed is a promise that it will not.
    if (!SCALE_TYPES.includes(data.scaleType)) {
        problems.push(`has an unknown scale "${data.scaleType}"`);
    }
    if (!GENRE_NAMES.includes(data.genre)) problems.push(`has an unknown genre "${data.genre}"`);
    if (!MOOD_NAMES.includes(data.mood)) problems.push(`has an unknown mood "${data.mood}"`);

    for (const [field, [low, high]] of Object.entries(GENERATOR_RANGES)) {
        const value = data[field];
        if (typeof value !== 'number' || value < low || value > high) {
            problems.push(`has ${field} = ${value}, outside ${low}…${high}`);
        }
    }

    if (data.octaveMax < data.octaveMin) {
        problems.push(`has octaveMax below octaveMin (${data.octaveMax} < ${data.octaveMin})`);
    }

    // The category is what a browser window filters on and the genre is what
    // the generator obeys. Filed under one and generating the other is a
    // preset nobody can find.
    if (item.category !== data.genre) {
        problems.push(`is filed under "${item.category}" but generates "${data.genre}"`);
    }

    return problems;
}

/**
 * Check the library as a whole: the things no single file can know.
 *
 * @param {Array<{id: string, item: object}>} items
 * @param {Record<string, string[]>|null} [order]  the curated order manifest
 * @returns {string[]}
 */
export function validateCatalog(items, order = null) {
    const problems = [];
    const seen = new Map();

    for (const { id, item } of items) {
        if (seen.has(id)) {
            // Two files claiming one id is not a merge, it is a coin toss:
            // whichever the loader read last wins and the other vanishes.
            problems.push(`two files claim the id "${id}"`);
        }
        seen.set(id, item);
    }

    // A kit whose preset is missing is the quiet failure this whole file
    // exists for: the lookup fails before the track is reset, so the track
    // keeps its previous instrument and nothing says so.
    const instruments = new Set(
        items.filter(({ item }) => item.kind === 'presets').map(({ id }) => id)
    );
    for (const { id, item } of items) {
        if (item.kind !== 'kits') continue;
        for (const track of item.data.tracks ?? []) {
            if (!instruments.has(track.presetKey)) {
                problems.push(`kit "${id}" wants a preset that is not here: "${track.presetKey}"`);
            }
        }
    }

    if (order) {
        for (const [kind, ids] of Object.entries(order)) {
            for (const id of ids) {
                if (!seen.has(id))
                    problems.push(`the order manifest names a missing ${kind}: "${id}"`);
            }
        }
    }

    return problems;
}
