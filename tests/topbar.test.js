/**
 * Two topbar controls that were on screen doing nothing, and the
 * arithmetic behind them.
 *
 * The buttons need a browser and were driven in one. What is here is
 * what a browser would not have told us: that tapping unevenly still
 * gives the tempo you meant, that coming back to the button after a
 * pause does not measure the pause, and that the zoom never asks for a
 * size the page cannot be.
 */

import { describe, it, expect } from 'vitest';
import { TapTempo, TAP_GAP_MS, TAP_MEMORY } from '../src/ui/tap-tempo.js';
import { clampZoom, zoomToFit, pageHeight, MIN_ZOOM, MAX_ZOOM } from '../src/ui/zoom.js';

/** Tap a list of intervals, starting at an arbitrary clock reading. */
function tapAll(intervals, { from = 5000 } = {}) {
    const tapping = new TapTempo();
    let now = from;
    let last = tapping.tap(now);

    for (const gap of intervals) {
        now += gap;
        last = tapping.tap(now);
    }
    return { tapping, bpm: last };
}

describe('tapping a tempo', () => {
    it('says nothing on the first tap', () => {
        expect(new TapTempo().tap(1000)).toBeNull();
    });

    it('reads two taps a beat apart', () => {
        // 500 ms between beats is 120 to the minute.
        expect(tapAll([500]).bpm).toBe(120);
        expect(tapAll([400]).bpm).toBe(150);
        expect(tapAll([1000]).bpm).toBe(60);
    });

    it('averages an uneven hand rather than following the last gap', () => {
        // Four taps around 500 ms, the last one early. Reading only the
        // last interval gives 200; the phrase is 120.
        const { bpm } = tapAll([520, 480, 300]);

        expect(bpm).toBeGreaterThan(130);
        expect(bpm).toBeLessThan(150);
        expect(tapAll([300]).bpm).toBe(200); // what the last gap alone says
    });

    it('settles as the tapping goes on', () => {
        const steady = tapAll([500, 500, 500, 500, 500, 500, 500]);

        expect(steady.bpm).toBe(120);
        expect(steady.tapping.taps).toHaveLength(TAP_MEMORY);
    });

    it('forgets the taps that fall out of memory', () => {
        // The first eight at 120, then eight at 60. Once the old ones
        // have dropped out, the answer is the new tempo and not a blend.
        const tapping = new TapTempo();
        let now = 0;
        for (let i = 0; i < 8; i++) tapping.tap((now += 500));

        let bpm = null;
        for (let i = 0; i < 8; i++) bpm = tapping.tap((now += 1000));

        expect(bpm).toBe(60);
    });

    it('starts a new phrase after a silence', () => {
        // Coming back to the button after a pause must not measure the
        // pause: two taps four seconds apart are fifteen to the minute,
        // which is not what anybody meant.
        const tapping = new TapTempo();
        tapping.tap(0);
        tapping.tap(500);

        expect(tapping.tap(500 + TAP_GAP_MS + 1)).toBeNull();
        expect(tapping.tap(500 + TAP_GAP_MS + 501)).toBe(120);
    });

    it('is quiet again once it is reset', () => {
        const tapping = new TapTempo();
        tapping.tap(0);
        tapping.tap(500);
        tapping.reset();

        expect(tapping.tap(1000)).toBeNull();
    });

    it('says nothing about two taps at the same instant', () => {
        const tapping = new TapTempo();
        tapping.tap(1000);

        // Infinite beats a minute is not a tempo.
        expect(tapping.tap(1000)).toBeNull();
    });
});

describe('the zoom', () => {
    it('stays inside what the list offers', () => {
        expect(clampZoom(10)).toBe(MIN_ZOOM);
        expect(clampZoom(1000)).toBe(MAX_ZOOM);
        expect(clampZoom(87.4)).toBe(87);
    });

    it('fits a tablet held in landscape', () => {
        // 1024 of the 1280 the interface is drawn for.
        expect(zoomToFit(1024, 768)).toBe(80);
        expect(zoomToFit(800, 600)).toBe(63);
    });

    it('never scales up to fill a wide screen', () => {
        expect(zoomToFit(2560, 1440)).toBe(100);
    });

    it('leaves a screen held upright alone', () => {
        // A phone in portrait is not a narrow desktop.
        expect(zoomToFit(768, 1024)).toBeNull();
        expect(zoomToFit(600, 600)).toBeNull();
    });

    it('does not go below the smallest the list offers', () => {
        expect(zoomToFit(320, 200)).toBe(MIN_ZOOM);
    });

    it('asks for the scroll height in the zoomed frame', () => {
        // `100vh` is not affected by body zoom, so at 80 % the area has
        // to ask for 125vh to reach the bottom of the window.
        expect(pageHeight(80)).toBe('calc(125.0000vh - 75px)');
        expect(pageHeight(125)).toBe('calc(80.0000vh - 75px)');
    });

    it('asks for nothing at all at full size', () => {
        // Anything but '' would override a stylesheet that is already right.
        expect(pageHeight(100)).toBe('');
    });
});
