/**
 * The rhythm presets.
 *
 * Ready-made drum patterns, grouped by family. Each one offers itself three
 * ways: the pattern, a variation of it, and a fill. Clicking fills the whole
 * track; holding shift appends after what is already there, which is how a
 * fill is normally used: at the end of a bar, not instead of it.
 *
 * The list is built from what `PatternPresets` holds rather than written into
 * the markup, so adding a preset there is enough to make it appear.
 */

import { translateOr, I18N_EVENTS } from '../i18n/i18n.js';
import { categoryLabel } from './library-categories.js';

/**
 * The three buttons a preset row offers, and what each writes.
 *
 * The base button is the wide one and carries the preset's own name, so it
 * has no label of its own; the other two are narrow and carry a word. Those
 * words were English in the code while translations for them sat unread in
 * all ten dictionaries.
 */
const VARIANTS = [
    { variant: 'base', className: 'btn-rhythm-preset', key: null, fallback: null },
    {
        variant: 'variation',
        className: 'btn-rhythm-var',
        key: 'rhythm.variant.variation',
        fallback: 'VAR'
    },
    { variant: 'fill', className: 'btn-rhythm-fill', key: 'rhythm.variant.fill', fallback: 'FILL' }
];

/** How long a pressed button stays lit. */
const FLASH_MS = 800;

export class RhythmPanel {
    /**
     * @param {object} options
     * @param {ParentNode} options.root
     * @param {import('../studio.js').Studio} options.studio
     * @param {() => void} [options.onApplied]  redraw the grid
     * @param {(text: string) => void} [options.onStatus]  the transport's line
     */
    constructor({ root, studio, onApplied = () => {}, onStatus = () => {} }) {
        this.root = root;
        this.studio = studio;
        this.onApplied = onApplied;
        this.onStatus = onStatus;
    }

    bind() {
        const container = this.root.querySelector('#rhythmPresetsContainer');
        if (!container) return;

        this._build(container);
        container.addEventListener('click', (event) => this._onClick(event));

        // The category headings and the two variant buttons are translated
        // now, and this list is built rather than written into the markup,
        // so `bindTranslations` cannot reach it. It rebuilds itself.
        this.studio.bus.on(I18N_EVENTS.changed, () => this._build(container));
    }

    _build(container) {
        container.innerHTML = '';

        for (const category of Object.values(this.studio.patternPresets.getPresetsByCategory())) {
            if (!category.presets.length) continue;
            container.append(this._buildCategory(category));
        }
    }

    _buildCategory(category) {
        const section = document.createElement('div');
        section.className = 'rhythm-category p-2';
        section.dataset.category = category.id;

        const header = document.createElement('div');
        header.className = 'rhythm-cat-header mb-2';
        header.style.setProperty('--cat-color', category.color);
        header.innerHTML = `
            <span class="rhythm-cat-icon" style="background:${category.color}">
                <i class="ti ${category.icon}"></i>
            </span>
            <span class="rhythm-cat-name"></span>
        `;
        // The name is set as text, not markup: it comes from a preset file.
        header.querySelector('.rhythm-cat-name').textContent = categoryLabel('rhythm', category.id);

        const presets = document.createElement('div');
        presets.className = 'rhythm-cat-presets';
        for (const preset of category.presets) presets.append(this._buildRow(preset));

        section.append(header, presets);
        return section;
    }

    _buildRow(preset) {
        const row = document.createElement('div');
        row.className = 'rhythm-preset-row';

        for (const { variant, className, key, fallback } of VARIANTS) {
            const label = key ? translateOr(key, fallback).toUpperCase() : null;
            const button = document.createElement('button');
            button.className = `btn btn-outline-secondary ${className}`;
            button.dataset.preset = preset.id;
            button.dataset.variant = variant;
            button.textContent = label ?? preset.name;
            button.title = label ? `${preset.name}: ${label}` : preset.description;

            row.append(button);
        }

        return row;
    }

    async _onClick(event) {
        const button = event.target.closest('[data-preset]');
        if (!button) return;

        const { preset, variant } = button.dataset;
        const mode = event.shiftKey ? 'append' : 'fill';

        await this.studio.start();

        const result = this.studio.patternPresets.applyPreset(preset, mode, { variant });

        if (result === 'full') {
            this.onStatus(translateOr('rhythm.full', 'NO ROOM TO APPEND'));
            return;
        }
        if (result !== true) return;

        // After the change, and after the two ways of not making one: an
        // entry identical to the one before it is an undo that does nothing.
        this.studio.history.saveState(`Rhythm ${mode}`);

        this._flash(button);
        this.onApplied();

        const name =
            preset.toUpperCase() + (variant === 'base' ? '' : ` [${variant.toUpperCase()}]`);
        this.onStatus(`${translateOr('rhythm.applied', 'RHYTHM')}: ${name}`);
    }

    /** Light the button that was pressed, and dim the others on its row. */
    _flash(button) {
        for (const other of button.closest('.rhythm-preset-row')?.children ?? []) {
            other.classList.remove('active');
        }

        button.classList.add('active');
        window.setTimeout(() => button.classList.remove('active'), FLASH_MS);
    }
}
