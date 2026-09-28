/**
 * What a project is for.
 *
 * A project's category is a loose genre borrowed from the games this studio
 * writes music for. It carries no behaviour: nothing in the audio path reads
 * it: but it is what a library of two hundred tracks is browsed by, and the
 * colour of the badge that makes a row scannable.
 *
 * The list lives here rather than in the markup because three windows offer
 * it: the browser's filter, the save window and the edit window. They must
 * agree, and a badge colour in `studio.css` exists for each of these names.
 */

import { translateOr } from '../i18n/i18n.js';

/** @type {readonly string[]} */
export const PROJECT_CATEGORIES = Object.freeze([
    'platformer',
    'rpg',
    'racing',
    'shooter',
    'puzzle',
    'exploration',
    'action',
    'horror',
    'ambient',
    'custom'
]);

export const DEFAULT_CATEGORY = 'custom';

/**
 * The translated name of a category, or the raw value for one that came out
 * of a file this build does not know about.
 *
 * @param {string} category
 * @returns {string}
 */
export function categoryLabel(category) {
    if (!PROJECT_CATEGORIES.includes(category)) return String(category ?? DEFAULT_CATEGORY);
    return translateOr(`proj.${category}`, capitalize(category));
}

function capitalize(value) {
    return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Rewrite a category picker's options from the list above. The markup ships
 * them in English; this puts them in the user's language and keeps the three
 * project windows offering the same set.
 *
 * @param {HTMLSelectElement|null} select
 */
export function fillCategories(select) {
    if (!select) return;

    const chosen = select.value;
    select.innerHTML = PROJECT_CATEGORIES.map(
        (category) =>
            `<option value="${category}" data-i18n="proj.${category}">${categoryLabel(
                category
            )}</option>`
    ).join('');
    select.value = chosen || DEFAULT_CATEGORY;
}
