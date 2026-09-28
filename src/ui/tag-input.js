/**
 * The tag field.
 *
 * Tags typed as chips: a word, Enter, and it becomes a chip that can be taken
 * back off. Backspace on an empty field removes the last one, which is what
 * the reflex expects.
 *
 * Suggestions come from a function the caller supplies: in this studio, the
 * tags already in use in the library: so the field never talks to storage
 * itself and can be dropped into any window.
 *
 * Tags are lowercased and stripped of punctuation on the way in. Two people
 * typing "Chiptune" and "chiptune" should land on one tag, not two, or the
 * filter bar fills up with near-duplicates.
 */

import { translateOr } from '../i18n/i18n.js';

const MAX_TAGS = 10;
const MAX_LENGTH = 50;

/** How long the field waits before asking for suggestions. */
const SUGGEST_DELAY_MS = 150;

/** Kept: letters in any script, digits, spaces, hyphens, underscores. */
const ALLOWED = /[^\p{L}\p{N}\s\-_]/gu;

export class TagInput {
    /**
     * @param {object} options
     * @param {HTMLElement} options.container
     * @param {() => (string[]|Promise<string[]>)} [options.suggest]  tags to offer
     * @param {number} [options.maxTags]
     */
    constructor({ container, suggest = null, maxTags = MAX_TAGS }) {
        this.container = container;
        this.suggest = suggest;
        this.maxTags = maxTags;

        /** @type {string[]} */
        this._tags = [];
        this._suggestions = [];
        this._timer = null;

        if (this.container) this._build();
    }

    // ── What the window asks for ─────────────────────────────────────────

    /** @param {string[]} tags */
    setTags(tags) {
        this._tags = [];
        for (const tag of Array.isArray(tags) ? tags : []) this._add(tag, false);
        this._renderChips();
    }

    /** @returns {string[]} */
    getTags() {
        return [...this._tags];
    }

    clear() {
        this._tags = [];
        this._renderChips();
        if (this._input) this._input.value = '';
        this._hideMenu();
    }

    // ── Building ─────────────────────────────────────────────────────────

    _build() {
        this.container.innerHTML = '';
        this.container.classList.add('tag-input-container');

        this._chips = document.createElement('div');
        this._chips.className = 'tag-input-chips';

        // The menu is positioned against this wrapper, not the field, so it
        // stays put while chips above it wrap onto a second line.
        const wrap = document.createElement('div');
        wrap.className = 'tag-input-wrap';

        this._input = document.createElement('input');
        this._input.type = 'text';
        this._input.className = 'tag-input-field';
        this._input.maxLength = MAX_LENGTH;
        this._input.autocomplete = 'off';

        this._menu = document.createElement('div');
        this._menu.className = 'tag-input-dropdown d-none';

        wrap.append(this._input, this._menu);
        this.container.append(this._chips, wrap);

        this._input.addEventListener('input', () => this._onType());
        this._input.addEventListener('keydown', (event) => this._onKey(event));
        // Losing focus has to wait for a click on a suggestion to land.
        this._input.addEventListener('blur', () => setTimeout(() => this._hideMenu(), 200));

        this._menu.addEventListener('mousedown', (event) => event.preventDefault());
        this._menu.addEventListener('click', (event) => {
            const item = event.target.closest('[data-tag]');
            if (!item) return;

            this._add(item.dataset.tag);
            this._input.value = '';
            this._hideMenu();
            this._input.focus();
        });

        this._chips.addEventListener('click', (event) => {
            const button = event.target.closest('[data-remove]');
            if (button) this._remove(button.dataset.remove);
        });

        this._renderChips();
    }

    // ── Typing ───────────────────────────────────────────────────────────

    _onType() {
        clearTimeout(this._timer);

        const typed = this._input.value.trim().toLowerCase();
        if (!typed) return this._hideMenu();

        this._timer = setTimeout(() => this._showMenu(typed), SUGGEST_DELAY_MS);
    }

    _onKey(event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            // Enter takes the highlighted suggestion if there is one, and
            // what was typed otherwise.
            const highlighted = this._menu.querySelector('.tag-input-suggestion.active');
            const value = highlighted?.dataset.tag ?? this._input.value.trim();
            if (!value) return;

            this._add(value);
            this._input.value = '';
            this._hideMenu();
            return;
        }

        if (event.key === 'Backspace' && !this._input.value && this._tags.length) {
            this._remove(this._tags[this._tags.length - 1]);
            return;
        }

        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            this._move(event.key === 'ArrowDown' ? 1 : -1);
            return;
        }

        if (event.key === 'Escape') this._hideMenu();
    }

    // ── Suggestions ──────────────────────────────────────────────────────

    async _showMenu(typed) {
        if (this.suggest) {
            try {
                this._suggestions = (await this.suggest()) ?? [];
            } catch {
                this._suggestions = [];
            }
        }

        const taken = new Set(this._tags);
        const matches = this._suggestions
            .filter((tag) => !taken.has(tag) && tag.includes(typed))
            .slice(0, 8);

        const rows = matches.map(
            (tag) =>
                `<div class="tag-input-suggestion" data-tag="${escapeHtml(tag)}">${highlight(
                    tag,
                    typed
                )}</div>`
        );

        // Offer to make the tag when nothing in the library matches it.
        if (!matches.includes(typed) && !taken.has(typed)) {
            rows.push(`
                <div class="tag-input-suggestion tag-input-create" data-tag="${escapeHtml(typed)}">
                    <i class="ti ti-plus"></i> <strong>${escapeHtml(typed)}</strong>
                </div>
            `);
        }

        this._menu.innerHTML = rows.join('');
        this._menu.classList.toggle('d-none', rows.length === 0);
    }

    _hideMenu() {
        this._menu?.classList.add('d-none');
    }

    _move(by) {
        const items = [...this._menu.querySelectorAll('.tag-input-suggestion')];
        if (items.length === 0) return;

        const current = items.findIndex((item) => item.classList.contains('active'));
        if (current >= 0) items[current].classList.remove('active');

        // Wraps around at both ends: the list is short enough that running
        // off it should come back rather than stop.
        const next = (current + by + items.length + 1) % items.length;
        items[next].classList.add('active');
    }

    // ── The tags themselves ──────────────────────────────────────────────

    _add(raw, render = true) {
        const tag = String(raw).trim().toLowerCase().replace(ALLOWED, '').trim();
        if (!tag || tag.length > MAX_LENGTH) return false;
        if (this._tags.includes(tag) || this._tags.length >= this.maxTags) return false;

        this._tags.push(tag);
        if (render) this._renderChips();
        return true;
    }

    _remove(tag) {
        const index = this._tags.indexOf(tag);
        if (index < 0) return;

        this._tags.splice(index, 1);
        this._renderChips();
    }

    _renderChips() {
        this._chips.innerHTML = this._tags
            .map(
                (tag) => `
                    <span class="tag-input-chip">${escapeHtml(tag)}
                        <span class="tag-input-remove" data-remove="${escapeHtml(
                            tag
                        )}">&times;</span>
                    </span>`
            )
            .join('');

        const full = this._tags.length >= this.maxTags;
        this._input.placeholder = full
            ? translateOr('gen.maxTags', 'Max 10 tags')
            : translateOr('gen.addTag', 'Add tag…');
        this._input.disabled = full;
    }
}

/** The matched run in bold, the rest escaped. */
function highlight(text, query) {
    const at = text.toLowerCase().indexOf(query);
    if (at < 0) return escapeHtml(text);

    return (
        escapeHtml(text.slice(0, at)) +
        `<strong>${escapeHtml(text.slice(at, at + query.length))}</strong>` +
        escapeHtml(text.slice(at + query.length))
    );
}

function escapeHtml(value) {
    return String(value).replace(
        /[&<>"']/g,
        (character) =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]
    );
}
