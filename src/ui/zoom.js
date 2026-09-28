/**
 * The zoom group in the topbar: [−] [%] [+].
 *
 * A chiptune studio is a wall of small controls, and how big they want
 * to be depends on the screen and on the eyes. The three buttons scale
 * the whole page between 30 % and 150 %, and the choice is remembered,
 * because nobody wants to make it twice.
 *
 * Two things make it more than one CSS property:
 *
 * `100vh` is not affected by `body { zoom }`. At 80 % the scrolling area
 * would be four fifths of the window with a gap under it, and at 120 %
 * it would run off the bottom. The height is worked back out in the
 * zoomed frame: `(100 / factor)vh` minus the topbar.
 *
 * And a tablet held in landscape has a viewport narrower than the 1280
 * pixels this interface is drawn for, so it opens at the zoom that makes
 * it fit rather than cut off: but only until someone touches the
 * controls, after which their choice is the answer to that question.
 */

/** The whole range, as the topbar's list offers it. */
export const MIN_ZOOM = 30;
export const MAX_ZOOM = 150;

/** One press of a button. */
const STEP = 10;

/** The width the interface is laid out for. */
const DESIGN_WIDTH = 1280;

/** The topbar the scrolling area sits under, in pixels. */
const TOPBAR_HEIGHT = 75;

/**
 * A level the controls will accept.
 * @param {number} percent
 */
export function clampZoom(percent) {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(percent)));
}

/**
 * The level at which the interface fits a screen, or null when it does
 * not need one.
 *
 * Portrait is left alone: a phone or a tablet held upright is not a
 * narrow desktop, it is a different problem. And the answer is never
 * above 100: a screen wide enough gets the interface at its own size
 * rather than blown up to fill the width.
 *
 * @param {number} width
 * @param {number} height
 * @returns {number|null}
 */
export function zoomToFit(width, height) {
    if (width <= height) return null;

    return Math.min(100, Math.max(MIN_ZOOM, Math.round((width / DESIGN_WIDTH) * 100)));
}

/**
 * The height the scrolling area needs, or '' at full size.
 *
 * `100vh` is not affected by `body { zoom }`, so the area has to be
 * asked for in the zoomed frame: at 80 % it needs 125 vh to cover the
 * window, and at 120 % it needs 83.
 *
 * @param {number} percent
 */
export function pageHeight(percent) {
    if (percent === 100) return '';

    return `calc(${(100 / (percent / 100)).toFixed(4)}vh - ${TOPBAR_HEIGHT}px)`;
}

export class Zoom {
    /**
     * @param {object} options
     * @param {ParentNode} options.root
     * @param {import('../core/preferences.js').Preferences} options.preferences
     */
    constructor({ root, preferences }) {
        this.root = root;
        this.preferences = preferences;

        this.level = 100;
        /** True once the controls have been used: their choice wins after that. */
        this._chosen = false;
    }

    bind() {
        const select = this._el('zoomSelect');

        this._el('zoomIn')?.addEventListener('click', () => this._choose(this.level + STEP));
        this._el('zoomOut')?.addEventListener('click', () => this._choose(this.level - STEP));
        select?.addEventListener('change', () => this._choose(Number(select.value)));

        const saved = this.preferences.get('zoom');
        if (saved) {
            this._chosen = true;
            this.apply(saved);
        } else {
            this._fitTouchScreen();
        }

        // A tablet is rotated far more often than a window is resized, and
        // both change the answer.
        window.addEventListener('orientationchange', () => {
            // The rotation geometry settles a moment after the event.
            setTimeout(() => this._fitTouchScreen(), 300);
        });
        window.addEventListener('resize', () => this._fitTouchScreen(), { passive: true });
    }

    /**
     * Scale the page, and put the scrolling area back to the right height.
     * @param {number} percent
     */
    apply(percent) {
        this.level = clampZoom(percent);
        const factor = this.level / 100;

        const body = document.body;
        if (CSS.supports?.('zoom', '1')) {
            body.style.zoom = String(factor);
        } else {
            // Safari before 18 and older Gecko. `transform` scales without
            // reflowing, which is worse, but it is that or nothing.
            body.style.transform = `scale(${factor})`;
            body.style.transformOrigin = 'top left';
        }

        const select = this._el('zoomSelect');
        if (select) select.value = String(this.level);

        const page =
            this.root.querySelector('.content-page') ?? document.querySelector('.content-page');
        if (page) page.style.height = pageHeight(this.level);

        // Panels that measure themselves - canvases, the grid, the
        // playheads - find out the way they would from a window resize.
        window.dispatchEvent(new Event('resize'));
        refreshScroll(page);
    }

    // ── Internals ────────────────────────────────────────────────────────

    /** @param {string} id */
    _el(id) {
        return this.root.querySelector(`#${id}`);
    }

    /** A level the user asked for, which is remembered and stops the auto-fit. */
    _choose(percent) {
        this._chosen = true;
        this.apply(percent);
        this.preferences.set('zoom', this.level);
    }

    /**
     * Open at a size that fits, on a touch screen held in landscape.
     *
     * Never scales up: a tablet wide enough for the whole interface gets
     * it at its own size, not blown up to fill the width.
     */
    _fitTouchScreen() {
        if (this._chosen || !isTouchScreen()) return;

        const level = zoomToFit(window.innerWidth, window.innerHeight);
        if (level !== null && level !== this.level) this.apply(level);
    }
}

/** A screen you touch rather than point at. */
function isTouchScreen() {
    return navigator.maxTouchPoints > 1 || window.matchMedia('(pointer: coarse)').matches;
}

/**
 * Make the browser work out the scroll height again.
 *
 * Changing the height of a scrolling box while it is zoomed leaves the
 * scrollbar describing the old one until something forces a reflow.
 * Toggling the overflow is what does it.
 */
function refreshScroll(page) {
    if (!page) return;

    page.style.overflowY = 'hidden';
    void page.offsetHeight;
    page.style.overflowY = '';
}
