/**
 * The right-click menu.
 *
 * The five things you do to a project as a whole: new, save, save to a
 * file, load, export: reachable anywhere in the window rather than only
 * from the topbar. The original app had it and the markup came across with
 * everything else; this is what opens it.
 *
 * It gets out of the way of anything that has its own use for a right
 * click. Fields and editable text keep the browser's menu, because cut and
 * paste are worth more there than New Project is; and a part of the window
 * that handles the gesture itself says so, which is how the sequencer grid
 * shows a note editor instead.
 *
 * There is no escape hatch to the browser's own menu. The original had one
 * (control, shift, Q and a right click together) which is a thing you
 * find in the source or never.
 */

/** Where the browser's own menu is worth more than this one. */
const KEEP_NATIVE = 'input, textarea, select, [contenteditable="true"]';

/** A part of the window that handles the gesture itself. */
export const OWN_MENU = 'data-forge-menu';

export class ContextMenu {
    /**
     * @param {object} options
     * @param {ParentNode} options.root
     * @param {Record<string, () => void>} options.actions  by `data-action`
     */
    constructor({ root, actions }) {
        this.root = root;
        this.actions = actions;
    }

    bind() {
        this._element = this.root.querySelector('#forgeContextMenu');
        if (!this._element) return;

        // On the document rather than the mount: the menu answers for the
        // whole window, including the parts of the page around it.
        document.addEventListener('contextmenu', (event) => this._onContextMenu(event));
        document.addEventListener('click', () => this.close());
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') this.close();
        });
        // A menu left open over a scrolled page points at nothing.
        window.addEventListener('scroll', () => this.close(), true);
        window.addEventListener('resize', () => this.close());

        this._element.addEventListener('click', (event) => {
            const item = event.target.closest('.ctx-item');
            if (!item) return;

            this.close();
            this.actions[item.dataset.action]?.();
        });
    }

    _onContextMenu(event) {
        if (event.target.closest(KEEP_NATIVE)) return;
        if (event.target.closest(`[${OWN_MENU}]`)) return;

        event.preventDefault();
        this.open(event.clientX, event.clientY);
    }

    /** @param {number} x @param {number} y */
    open(x, y) {
        if (!this._element) return;

        // Shown before it is measured: a hidden menu has no size, and a
        // menu placed from a size of zero lands off the edge.
        this._element.classList.add('show');
        place(this._element, x, y);
    }

    close() {
        this._element?.classList.remove('show');
    }

    get isOpen() {
        return Boolean(this._element?.classList.contains('show'));
    }
}

/**
 * Put a floating element at a point, kept inside the window.
 *
 * Shared with the cell editor, which has the same problem: a popover
 * opened near the right edge has to come back inside, and one near the
 * bottom has to sit above the pointer rather than below it.
 *
 * @param {HTMLElement} element  already visible, so it can be measured
 * @param {number} x
 * @param {number} y
 */
export function place(element, x, y) {
    const { offsetWidth: width, offsetHeight: height } = element;
    const margin = 4;

    element.style.left = `${Math.max(margin, Math.min(x, window.innerWidth - width - margin))}px`;
    element.style.top = `${Math.max(margin, Math.min(y, window.innerHeight - height - margin))}px`;
}
