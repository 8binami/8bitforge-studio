/**
 * Rhythms, between a file and the grid.
 *
 * A rhythm in the library is written the way a drum machine writes one: a
 * row per lane, `x` for a hit, `.` for silence:
 *
 *     "kick":  "x...x...x...x..."
 *     "snare": "....x.......x..."
 *
 * The length of the row is the length of the rhythm. That is not shorthand,
 * it is the whole rule: a sixteen-step groove dropped into a thirty-two-step
 * pattern is repeated to fill it, and the only thing that says how far to
 * repeat is how long the row is. Store the length separately and one day the
 * two disagree.
 *
 * These rhythms used to be JavaScript: three closures per preset, writing
 * into the live grid with strided loops. This is what replaces them, and the
 * shapes it deals in are deliberately the same, so that the proof taken
 * before the closures were deleted describes the code that runs now.
 */

/**
 * The three drum tracks a rhythm may write to, and the one pitch each ever
 * sounds. All sixty shipped rhythms were checked: a kick is always C2, a
 * snare always C3, a hi-hat always C5. That is what makes a row of `x` and
 * `.` lossless: there is no pitch left to record.
 */
export const DRUM_LANES = Object.freeze({
    kick: Object.freeze({ track: 4, note: 'C', octave: 2 }),
    snare: Object.freeze({ track: 5, note: 'C', octave: 3 }),
    hihat: Object.freeze({ track: 6, note: 'C', octave: 5 })
});

/** A bar. Lengths round up to one, which is the sequencer's own rule. */
export const BAR = 8;

/** The longest a pattern can be. */
export const MAX_STEPS = 32;

/**
 * How long a rhythm is, from the rows themselves.
 *
 * @param {Record<string, string>} lanes  lane name → step row
 * @returns {number} steps, 0 when nothing sounds
 */
export function rhythmLength(lanes) {
    let longest = 0;
    for (const row of Object.values(lanes ?? {})) {
        if (typeof row === 'string' && row.includes('x')) longest = Math.max(longest, row.length);
    }
    return longest;
}

/**
 * Write a rhythm into a pattern.
 *
 * @param {Record<string, string>} lanes  lane name → step row
 * @param {Array<Array<object|null>>} pattern  the grid, written in place
 * @param {object} [options]
 * @param {number} [options.clearTo]  clear the drum tracks this far first
 * @param {number} [options.tileTo]   repeat the rhythm out to this many steps
 * @param {number} [options.offset]   start here instead of at the beginning
 * @returns {number} the rhythm's own length, before any repeating
 */
export function writeRhythm(lanes, pattern, { clearTo = 0, tileTo = 0, offset = 0 } = {}) {
    for (let step = 0; step < clearTo; step++) {
        for (const { track } of Object.values(DRUM_LANES)) {
            if (pattern[track]) pattern[track][step] = null;
        }
    }

    const length = rhythmLength(lanes);
    if (length === 0) return 0;

    // Without tiling the rhythm is written once, at its own length: that is
    // what appending after existing content needs, and what the extractor
    // reads back.
    const until = Math.max(tileTo, length);

    for (const [lane, row] of Object.entries(lanes)) {
        const target = DRUM_LANES[lane];
        // A lane the drums do not have is ignored rather than fatal. A file
        // from a newer version of the studio should lose a lane, not refuse
        // to play.
        if (!target || !pattern[target.track]) continue;

        for (let step = 0; step < until; step++) {
            const at = offset + step;
            if (at >= pattern[target.track].length) break;
            if (row[step % row.length] !== 'x') continue;

            pattern[target.track][at] = { note: target.note, octave: target.octave };
        }
    }

    return length;
}

/**
 * Read a pattern's drum tracks back out as rows: the inverse of writing
 * one, and how the shipped rhythms were harvested from the code that used
 * to generate them.
 *
 * @param {Array<Array<object|null>>} pattern
 * @param {object} [options]
 * @param {boolean} [options.strict]  refuse a pitch the notation cannot hold
 * @returns {Record<string, string>} lane name → step row, silent lanes omitted
 */
export function readRhythm(pattern, { strict = false } = {}) {
    const rows = new Map();
    const drums = new Set(Object.values(DRUM_LANES).map((lane) => lane.track));

    // Under strict reading, anything on a melodic track is content the
    // notation has no room for, and dropping it silently is how a harvest
    // loses a preset's character without anyone noticing.
    if (strict) {
        for (let track = 0; track < pattern.length; track++) {
            if (drums.has(track)) continue;
            if (pattern[track]?.some(Boolean)) {
                throw new Error(`track ${track} has notes, and it is not a drum track`);
            }
        }
    }

    for (const [lane, { track, note, octave }] of Object.entries(DRUM_LANES)) {
        const row = [];

        for (let step = 0; step < MAX_STEPS; step++) {
            const cell = pattern[track]?.[step];
            if (!cell) {
                row.push('.');
                continue;
            }
            if (strict && (cell.note !== note || cell.octave !== octave)) {
                throw new Error(
                    `${lane} at step ${step} is ${cell.note}${cell.octave}, not ${note}${octave}`
                );
            }
            row.push('x');
        }

        rows.set(lane, row);
    }

    // Every lane is cut to the same length (the rhythm's) so that the rows
    // stay in step with each other when they repeat.
    const length = lengthOfRows(rows);
    const lanes = {};
    for (const [lane, row] of rows) {
        // A silent lane is left out rather than written as a row of dots.
        if (row.includes('x')) lanes[lane] = row.slice(0, length).join('');
    }

    return lanes;
}

/** Up to the last hit on any lane, rounded up to a whole bar. */
function lengthOfRows(rows) {
    let last = -1;
    for (const row of rows.values()) last = Math.max(last, row.lastIndexOf('x'));
    if (last < 0) return 0;

    return Math.ceil((last + 1) / BAR) * BAR;
}
