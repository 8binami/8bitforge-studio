/**
 * An XY pad.
 *
 * Two parameters at once, under one finger: left to right is the first, top
 * to bottom is the second: inverted, so that "more" is up, which is what a
 * hand expects of anything drawn as a graph.
 *
 * The grid behind the cursor is a canvas rather than a background image
 * because it carries a dashed crosshair at the current position: the pad has
 * to read at a glance from across a window, and a dot alone does not.
 *
 * The pad knows nothing about what it controls. It reports a pair of
 * fractions and leaves the meaning to whoever asked for it: the same pad
 * serves a filter, an envelope and a tremolo.
 */

/** Divisions of the faint grid behind the cursor. */
const DIVISIONS = 10;

/** Length of the tick marks along the bottom and left edges, in pixels. */
const TICK = 6;

export class XyPad {
    /**
     * @param {object} options
     * @param {HTMLElement} options.pad      the square that takes the drag
     * @param {HTMLElement} options.cursor   the dot moved over it
     * @param {HTMLCanvasElement|null} options.grid
     * @param {string} options.color         the pad's section colour
     * @param {(x: number, y: number) => void} options.onMove   while dragging
     * @param {() => void} [options.onRelease]                  once it settles
     */
    constructor({ pad, cursor, grid, color, onMove, onRelease = () => {} }) {
        this.pad = pad;
        this.cursor = cursor;
        this.grid = grid;
        this.color = color;
        this.onMove = onMove;
        this.onRelease = onRelease;

        /** Where the cursor is, as fractions from the top left. */
        this.x = 0;
        this.y = 0;
    }

    bind() {
        if (!this.pad) return;

        this.pad.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            this._takeFrom(event);

            // Move and release are watched on the document: a drag that
            // leaves a small pad has to keep working, and pointer capture
            // throws on a synthetic event.
            const onMove = (moved) => this._takeFrom(moved);
            const onUp = () => {
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onUp);
                document.removeEventListener('pointercancel', onUp);
                this.onRelease();
            };

            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
            document.addEventListener('pointercancel', onUp);
        });
    }

    /**
     * Put the cursor somewhere without reporting it: for reading a track's
     * settings back onto the pad.
     *
     * @param {number} x  0 at the left, 1 at the right
     * @param {number} y  0 at the top, 1 at the bottom
     */
    setPosition(x, y) {
        this.x = clamp(x);
        this.y = clamp(y);

        if (this.cursor) {
            // Percentages, not pixels: the pad is laid out by the grid
            // around it and resizes with the window.
            this.cursor.style.left = `${this.x * 100}%`;
            this.cursor.style.top = `${this.y * 100}%`;
        }
        this.draw();
    }

    /** Redraw the grid. Also the way to pick up a resize. */
    draw() {
        const canvas = this.grid;
        const parent = canvas?.parentElement;
        if (!canvas || !parent) return;

        // A canvas laid out by CSS still has to be told its pixel size, or
        // it draws into its default 300×150 buffer and comes out stretched.
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;

        const context = canvas.getContext('2d');
        if (!context || canvas.width === 0 || canvas.height === 0) return;

        const { width, height } = canvas;
        const tint = (alpha) => withAlpha(this.color, alpha);
        context.clearRect(0, 0, width, height);

        // The faint grid.
        context.lineWidth = 1;
        context.strokeStyle = tint(0.08);
        for (let step = 1; step < DIVISIONS; step++) {
            line(context, (step / DIVISIONS) * width, 0, (step / DIVISIONS) * width, height);
            line(context, 0, (step / DIVISIONS) * height, width, (step / DIVISIONS) * height);
        }

        // The middle, darker, so an eye can find the centre.
        context.strokeStyle = tint(0.25);
        line(context, 0, height / 2, width, height / 2);
        line(context, width / 2, 0, width / 2, height);

        context.strokeStyle = tint(0.15);
        context.lineWidth = 2;
        context.strokeRect(1, 1, width - 2, height - 2);

        // Ticks along the two edges a value is read off.
        context.strokeStyle = tint(0.3);
        context.lineWidth = 1;
        for (let step = 0; step <= DIVISIONS; step++) {
            const x = (step / DIVISIONS) * width;
            const y = (step / DIVISIONS) * height;
            line(context, x, height - TICK, x, height);
            line(context, 0, y, TICK, y);
        }

        // The crosshair, which is what makes the position readable at all.
        context.strokeStyle = tint(0.5);
        context.setLineDash([2, 3]);
        line(context, this.x * width, 0, this.x * width, height);
        line(context, 0, this.y * height, width, this.y * height);
        context.setLineDash([]);
    }

    _takeFrom(event) {
        const rect = this.pad.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        this.setPosition(
            (event.clientX - rect.left) / rect.width,
            (event.clientY - rect.top) / rect.height
        );
        this.onMove(this.x, this.y);
    }
}

function line(context, fromX, fromY, toX, toY) {
    context.beginPath();
    context.moveTo(fromX, fromY);
    context.lineTo(toX, toY);
    context.stroke();
}

function clamp(value) {
    return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

/** `#00bcd4` at some transparency, without a colour library. */
function withAlpha(hex, alpha) {
    const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!match) return `rgba(0, 255, 0, ${alpha})`;

    const [red, green, blue] = match.slice(1).map((part) => parseInt(part, 16));
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}
