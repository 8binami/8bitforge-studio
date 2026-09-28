/**
 * Translation, applied to the page.
 *
 * The i18n module holds strings; this puts them where they belong. Markup
 * declares what it needs and never calls the translator itself:
 *
 *   <span data-i18n="menu.sequencer">Sequencer</span>
 *   <input data-i18n-placeholder="library.title">
 *   <button data-i18n-title="transport.play">
 *
 * The text written in the markup is the English fallback, so a page that is
 * never translated still reads correctly.
 */

import { i18n, I18N_EVENTS } from '../i18n/i18n.js';
import { bus as sharedBus } from '../core/event-bus.js';

/**
 * Translate everything under a root, in place.
 * @param {ParentNode} [root]
 */
export function applyTranslations(root = document) {
    for (const element of root.querySelectorAll('[data-i18n]')) {
        const text = i18n.t(element.dataset.i18n);
        // A missing key comes back as the key itself: leave the markup's own
        // wording rather than showing `menu.sequencer` to someone.
        if (text !== element.dataset.i18n) element.textContent = text;
    }

    for (const element of root.querySelectorAll('[data-i18n-html]')) {
        const html = i18n.t(element.dataset.i18nHtml);
        if (html !== element.dataset.i18nHtml) element.innerHTML = html;
    }

    for (const element of root.querySelectorAll('[data-i18n-placeholder]')) {
        const text = i18n.t(element.dataset.i18nPlaceholder);
        if (text !== element.dataset.i18nPlaceholder) element.placeholder = text;
    }

    for (const element of root.querySelectorAll('[data-i18n-title]')) {
        const text = i18n.t(element.dataset.i18nTitle);
        if (text !== element.dataset.i18nTitle) element.title = text;
    }

    if (root === document) document.documentElement.lang = i18n.language;
}

/**
 * Translate now, and again whenever the language changes.
 * @returns {() => void} stop listening
 */
export function bindTranslations(root = document, bus = sharedBus) {
    applyTranslations(root);
    return bus.on(I18N_EVENTS.changed, () => applyTranslations(root));
}
