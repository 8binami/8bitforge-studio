/**
 * The playhead: the bar that runs across the grid while the sequencer plays.
 *
 * The cells already light up one at a time, which says *which* step is
 * sounding. This says where we are between two of them, which is the other
 * half of the question and the one you watch when you are playing along.
 *
 * It is driven by the bookings, not by a clock of its own and not by the step
 * announcements. The scheduler books each step at an exact audio time up to a
 * tenth of a second ahead; those times arrive here as they are made, and two
 * consecutive ones give the span the bar has to cross. That is why nothing in
 * this file knows what a tempo is, or what swing does to a step: whatever the
 * sequencer decided, the bar follows it, and the two cannot drift apart
 * because there is only one set of numbers.
 *
 * Two bars over one animation: the pattern grid's and the arrangement's.
 * They differ only in what they measure and what a position along it means.
 */

import { SEQUENCER_EVENTS } from '../sequencer/sequencer.js';

/**
 * How many bookings to keep. The scheduler is never more than a handful
 * ahead; this only matters when the animation is not running to consume them,
 * which is what happens while the window is in the background.
 */
const MAX_BOOKED = 64;

/**
 * An element's content box, in the coordinates an absolutely positioned
 * sibling is placed in.
 *
 * Deliberately not `getBoundingClientRect`. That returns visual coordinates,
 * and the studio scales the whole page between 30 % and 150 %; `left` is
 * written in the unscaled space, and so are `offsetLeft` and `clientWidth`.
 * The original app measured the rectangle and divided by the zoom afterwards.
 * Not measuring it in the first place is one fewer thing to keep in step.
 *
 * @param {HTMLElement} element
 * @param {{paddingLeft: string, paddingRight: string}} [style]
 * @returns {{left: number, width: number}}
 */
export function contentBox(element, style = getComputedStyle(element)) {
    const before = parseFloat(style.paddingLeft) || 0;
    const after = parseFloat(style.paddingRight) || 0;

    return {
        left: element.offsetLeft + element.clientLeft + before,
        width: element.clientWidth - before - after
    };
}

/**
 * @typedef {object} Bar
 * @property {HTMLElement|null} element   the bar itself
 * @property {() => HTMLElement|null} strip  what it runs along, measured every
 *           frame because the grid resizes with the window and with the zoom
 * @property {(at: {step: number, chainIndex: number}) => number|null} along
 *           where to put it, from 0 at the left of that strip to 1 at its
 *           right: or null when this bar has nothing to show
 */

export class Playhead {
    /**
     * @param {object} options
     * @param {import('../sequencer/sequencer.js').Sequencer} options.sequencer
     * @param {import('../core/event-bus.js').EventBus} options.bus
     * @param {Bar[]} options.bars
     * @param {(callback: FrameRequestCallback) => number} [options.frame]
     * @param {(id: number) => void} [options.cancel]
     *        The animation, injectable: a class whose whole job is a frame
     *        loop cannot be examined without one, and there is no
     *        `requestAnimationFrame` outside a browser.
     */
    constructor({
        sequencer,
        bus,
        bars,
        frame = (callback) => requestAnimationFrame(callback),
        cancel = (id) => cancelAnimationFrame(id)
    }) {
        this.sequencer = sequencer;
        this.bus = bus;
        this.bars = bars;
        this._requestFrame = frame;
        this._cancelFrame = cancel;

        /** @type {{step: number, time: number, chainIndex: number}[]} */
        this._booked = [];
        /** @type {number|null} */
        this._frame = null;
        /**
         * The last span actually measured between two bookings. Below about
         * 60 BPM a step lasts longer than the lookahead window, so there is
         * only ever one booking in hand and no next one to subtract.
         */
        this._span = 0;
    }

    bind() {
        this.bus.on(SEQUENCER_EVENTS.scheduled, (booking) => this._book(booking));
        this.bus.on(SEQUENCER_EVENTS.play, () => this._follow());
        this.bus.on(SEQUENCER_EVENTS.pause, () => this.stop());
        this.bus.on(SEQUENCER_EVENTS.stop, () => this.stop());
    }

    stop() {
        if (this._frame !== null) {
            this._cancelFrame(this._frame);
            this._frame = null;
        }

        this._booked.length = 0;
        this._span = 0;

        for (const bar of this.bars) bar.element?.classList.remove('active');
    }

    /**
     * Where the bar stands: a step, plus how far through it we are, and the
     * measure of the chain that step belongs to.
     *
     * A booking is spent as soon as the one after it has started, so the
     * queue is trimmed from the front rather than searched.
     *
     * @param {number} now  the audio clock
     * @returns {{step: number, chainIndex: number}|null}
     */
    at(now) {
        const booked = this._booked;
        while (booked.length > 1 && booked[1].time <= now) booked.shift();

        const current = booked[0];
        if (!current || now < current.time) return null;

        const next = booked[1];
        if (next) this._span = next.time - current.time;

        const span = this._span > 0 ? this._span : this._nominalSpan();
        // Clamped: past the end of a step with nothing booked after it, the
        // bar waits on the line rather than running into the next cell.
        const progress = span > 0 ? Math.min(1, (now - current.time) / span) : 0;

        return { step: current.step + progress, chainIndex: current.chainIndex };
    }

    // ── Internals ────────────────────────────────────────────────────────

    /** @param {{step: number, time: number, chainIndex?: number}} booking */
    _book({ step, time, chainIndex = 0 }) {
        this._booked.push({ step, time, chainIndex });
        if (this._booked.length > MAX_BOOKED) this._booked.shift();
    }

    /** A step at this tempo, ignoring swing. Only ever a fallback. */
    _nominalSpan() {
        return 60 / this.sequencer.bpm / 4;
    }

    _follow() {
        if (this._frame !== null) return;

        const tick = () => {
            if (!this.sequencer.isPlaying) {
                this._frame = null;
                return;
            }

            this._frame = this._requestFrame(tick);
            this.draw();
        };

        tick();
    }

    /**
     * Where the bar stands right now: for anything else that draws one and
     * would otherwise have to find the audio clock for itself.
     *
     * @returns {{step: number, chainIndex: number}|null}
     */
    stepNow() {
        const context = this.sequencer.audioEngine?.audioContext;
        return context ? this.at(context.currentTime) : null;
    }

    draw() {
        const at = this.stepNow();

        for (const bar of this.bars) {
            const element = bar.element;
            if (!element) continue;

            const along = at === null ? null : bar.along(at);
            const strip = along === null ? null : bar.strip();

            if (strip === null) {
                element.classList.remove('active');
                continue;
            }

            const box = contentBox(strip);
            element.style.left = `${box.left + Math.min(1, Math.max(0, along)) * box.width}px`;
            element.classList.add('active');
        }
    }
}
