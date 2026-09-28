/**
 * The genres a generator preset is filed under.
 *
 * The generator already takes a genre as a parameter: it changes what it
 * writes. A preset's genre is that same value, which is why the list is the
 * generator's and not a second one: saving a preset files it under whatever
 * it was set to generate.
 *
 * `custom` is the exception. It is not something the generator can be set to;
 * it is where a preset goes when it was built by hand rather than from a
 * genre, and it has a badge colour like the rest.
 */

import { translateOr } from '../i18n/i18n.js';

/** @type {readonly string[]} */
export const GENERATOR_GENRES = Object.freeze([
    'chiptune',
    'synthwave',
    'techno',
    'lofi',
    'dnb',
    'ambient',
    'funk',
    'boss',
    'menu',
    'waltz',
    'custom'
]);

export const DEFAULT_GENRE = 'custom';

/** English names, for a language that has no dictionary entry of its own. */
const FALLBACKS = Object.freeze({
    chiptune: 'Chiptune Classic',
    synthwave: 'Synthwave',
    techno: 'Techno',
    lofi: 'Lo-Fi',
    dnb: 'Drum & Bass',
    ambient: 'Ambient',
    funk: 'Funk',
    boss: 'Boss Battle',
    menu: 'Menu Theme',
    waltz: 'Waltz',
    custom: 'Custom'
});

/** @param {string} genre */
export function genreLabel(genre) {
    if (!GENERATOR_GENRES.includes(genre)) return String(genre ?? DEFAULT_GENRE);
    // `custom` is shared with the project categories rather than duplicated.
    if (genre === DEFAULT_GENRE) return translateOr('proj.custom', FALLBACKS.custom);
    return translateOr(`genre.${genre}`, FALLBACKS[genre]);
}

/** @param {string} genre */
export function genreKey(genre) {
    return genre === DEFAULT_GENRE ? 'proj.custom' : `genre.${genre}`;
}
