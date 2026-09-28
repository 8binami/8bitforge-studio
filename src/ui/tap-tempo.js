/**
 * The tempo you can hear but cannot name.
 *
 * Tap along with it and the button works it out. The average of the
 * last eight intervals rather than the last one, because nobody taps
 * evenly and a single interval jumps by five or ten beats a minute
 * between one press and the next.
 *
 * Three seconds of silence ends the phrase. Without that, coming back
 * to the button after a pause would measure the pause: two taps four
 * seconds apart are fifteen beats a minute, which is not what anybody
 * meant.
 *
 * It is here rather than in the view because it is arithmetic with a
 * clock in it, and arithmetic with a clock in it is exactly what wants
 * testing without a browser.
 */

/** Longer than this between two taps and the phrase has ended. */
export const TAP_GAP_MS = 3000;

/** How many taps the average runs over. */
export const TAP_MEMORY = 8;

export class TapTempo {
    constructor() {
        /** @type {number[]} when each remembered tap happened. */
        this.taps = [];
    }

    /**
     * Record a tap.
     *
     * @param {number} now  a monotonic time in milliseconds
     * @returns {number|null} the tempo, or null on the first tap of a phrase
     */
    tap(now) {
        if (this.taps.length && now - this.taps.at(-1) > TAP_GAP_MS) this.taps = [];

        this.taps.push(now);
        if (this.taps.length > TAP_MEMORY) this.taps.shift();
        if (this.taps.length < 2) return null;

        // The span over the gaps, which is the average interval without
        // having to build the list of them.
        const span = this.taps.at(-1) - this.taps[0];
        if (span <= 0) return null;

        return Math.round(60000 / (span / (this.taps.length - 1)));
    }

    /** Forget the phrase, so the next tap starts a new one. */
    reset() {
        this.taps = [];
    }
}
