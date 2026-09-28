/**
 * What the shelves of the library are called.
 *
 * A preset's category is the folder it sits in: `library/instruments/leads/`
 *: and a folder name is an identifier, not a label. This turns the one into
 * the other.
 *
 * It lives under `src/ui/` rather than beside the catalogues in `compose/`
 * for a reason that is not architectural: `tests/i18n-fallback.test.js`
 * reads the interface modules to find every key passed to `translateOr`, and
 * a label declared in `compose/` would be invisible to it. Putting the
 * labels where the test looks buys ten-way parity enforcement for nothing.
 *
 * The categories themselves are closed sets: a contributor picks one of
 * these folders rather than inventing a shelf: which is why a label can be
 * a translated string here instead of travelling inside every file.
 */

import { translateOr } from '../i18n/i18n.js';

/** The instrument shelves, in the order the browser shows them. */
export const INSTRUMENT_CATEGORIES = Object.freeze([
    'leads',
    'bass',
    'chords',
    'arps',
    'drums',
    'fx',
    'retro',
    'acoustic',
    'pads',
    'synth'
]);

/**
 * The shelf a preset someone saves themselves lands on.
 *
 * No shipped preset is filed here: `library/instruments/` has no `custom`
 * folder: which is why it is absent from the list `instrument-library.js`
 * groups the catalogue by, and present in the list the browser filters and
 * the save window offers. The two lists answer different questions: what
 * the studio ships, and what a person may choose.
 */
export const USER_CATEGORY = 'custom';

/** What the instrument browser filters on and the save window offers. */
export const INSTRUMENT_CHOICES = Object.freeze([...INSTRUMENT_CATEGORIES, USER_CATEGORY]);

/** The kit shelves, in the order the kit grid shows them. */
export const KIT_CATEGORIES = Object.freeze([
    'retro',
    'synth',
    'acoustic',
    'ambient',
    'electronic',
    USER_CATEGORY
]);

/** Where a kit goes when nobody says otherwise. */
export const DEFAULT_KIT_CATEGORY = USER_CATEGORY;

/** The rhythm shelves, likewise. */
export const RHYTHM_CATEGORIES = Object.freeze([
    'electronic',
    'urban',
    'world',
    'classic',
    'retro'
]);

/**
 * English names, for a language with no dictionary entry of its own.
 *
 * Kept per list rather than in one flat map because `retro` is on both
 * shelves and does not mean the same thing twice: among instruments it is
 * chip-era voices, among rhythms it is game music.
 */
const FALLBACKS = Object.freeze({
    instrument: Object.freeze({
        leads: 'Leads',
        bass: 'Bass',
        chords: 'Chords',
        arps: 'Arps',
        drums: 'Drums',
        fx: 'FX',
        retro: 'Retro',
        acoustic: 'Acoustic',
        pads: 'Pads',
        synth: 'Synth',
        custom: 'Custom'
    }),
    kit: Object.freeze({
        retro: 'Retro',
        synth: 'Synth',
        acoustic: 'Acoustic',
        ambient: 'Ambient',
        electronic: 'Electronic',
        custom: 'Custom'
    }),
    rhythm: Object.freeze({
        electronic: 'Electronic',
        urban: 'Urban / Hip-Hop',
        world: 'World / Latin',
        classic: 'Classic / Rock',
        retro: 'Retro / 8-Bit'
    })
});

/**
 * @param {'instrument'|'kit'|'rhythm'} kind
 * @param {string} category
 * @returns {string}
 */
export function categoryLabel(kind, category) {
    return translateOr(categoryKey(kind, category), FALLBACKS[kind]?.[category] ?? category);
}

/**
 * The key a label carries in the markup, so that a badge already on screen
 * follows a language change without being redrawn.
 *
 * @param {'instrument'|'kit'|'rhythm'} kind
 * @param {string} category
 * @returns {string}
 */
export function categoryKey(kind, category) {
    return `libcat.${kind}.${category}`;
}
