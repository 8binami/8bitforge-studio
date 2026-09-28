/**
 * The playhead.
 *
 * One property matters and a screenshot cannot show it: the bar is where the
 * sequencer said the step would be heard, not where a formula says it ought
 * to be. So most of this drives a real `Sequencer` and checks the bar against
 * the times that sequencer actually booked: including with swing on, where
 * a bar that worked its position out from the tempo would be wrong on every
 * other step and right at every bar line, which is exactly the kind of error
 * you never catch by looking.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AudioEngine } from '../src/audio/audio-engine.js';
import { Sequencer, SEQUENCER_EVENTS } from '../src/sequencer/sequencer.js';
import { EventBus } from '../src/core/event-bus.js';
import { Playhead, contentBox } from '../src/ui/playhead.js';
import { FakeAudioContext } from './helpers/fake-audio-context.js';

/** A sequencer, a bus, and a playhead listening to it. No DOM, no frames. */
async function makeStudio() {
    const context = new FakeAudioContext();
    const engine = new AudioEngine({ createContext: () => context });
    await engine.init();

    const bus = new EventBus();
    const sequencer = new Sequencer(engine, { bus });

    const booked = [];
    bus.on(SEQUENCER_EVENTS.scheduled, (event) => booked.push(event));

    const playhead = new Playhead({
        sequencer,
        bus,
        bars: [],
        frame: () => 1,
        cancel: () => {}
    });
    playhead.bind();

    return { context, bus, sequencer, playhead, booked };
}

/** Run the scheduler and the visual callbacks over a stretch of audio time. */
function runAudio(context, ms) {
    const slice = 10;
    for (let elapsed = 0; elapsed < ms; elapsed += slice) {
        context.advance(slice / 1000);
        vi.advanceTimersByTime(slice);
    }
}

describe('the playhead', () => {
    let context;
    let sequencer;
    let playhead;
    let booked;

    beforeEach(async () => {
        vi.useFakeTimers();
        ({ context, sequencer, playhead, booked } = await makeStudio());
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('shows nothing until a step has been booked', () => {
        expect(playhead.at(0)).toBeNull();
        expect(playhead.at(99)).toBeNull();
    });

    it('stands on a step at the moment that step is heard', () => {
        sequencer.play();
        runAudio(context, 1000);

        expect(booked.length).toBeGreaterThan(4);

        // Walked forward, because reading the position spends the bookings
        // behind it: which is the whole reason the queue does not grow.
        for (const { step, time } of booked.slice(0, -1)) {
            const at = playhead.at(time);
            expect(at.step, `at the audio time of step ${step}`).toBeCloseTo(step, 6);
        }
    });

    it('crosses the cell in the time the sequencer gave that cell', () => {
        sequencer.play();
        runAudio(context, 1000);

        for (let index = 0; index < booked.length - 1; index++) {
            const here = booked[index];
            const next = booked[index + 1];
            const middle = playhead.at((here.time + next.time) / 2);

            expect(middle.step, `halfway through step ${here.step}`).toBeCloseTo(
                here.step + 0.5,
                6
            );
        }
    });

    it('follows swing rather than the tempo', () => {
        // Swing lengthens the even steps and shortens the odd ones by the
        // same amount, so a bar that divided the bar into equal steps would
        // meet the grid again at every bar line and be wrong in between.
        sequencer.setSwing(0.6);
        sequencer.play();
        runAudio(context, 1000);

        const nominal = 60 / sequencer.bpm / 4;
        const spans = booked.slice(0, -1).map((step, index) => booked[index + 1].time - step.time);

        // The premise: the steps really are of two different lengths.
        expect(spans[0]).toBeGreaterThan(nominal);
        expect(spans[1]).toBeLessThan(nominal);

        // And the bar is halfway across each of them at its own halfway mark,
        // not at the halfway mark of an average step.
        for (let index = 0; index < booked.length - 1; index++) {
            const here = booked[index];
            const middle = playhead.at(here.time + spans[index] / 2);

            expect(middle.step, `halfway through step ${here.step}`).toBeCloseTo(
                here.step + 0.5,
                6
            );
        }
    });

    it('waits on the line rather than running past it', () => {
        // The last booking in hand has nothing after it to measure against.
        // Below about 60 BPM that is the normal state of affairs, because a
        // step then lasts longer than the scheduler books ahead.
        sequencer.play();
        runAudio(context, 200);

        const last = playhead._booked[playhead._booked.length - 1];
        const at = playhead.at(last.time + 60); // an absurd distance later

        expect(at.step).toBe(last.step + 1);
    });

    it('names the measure of the chain each step belongs to', () => {
        sequencer.play();
        runAudio(context, 300);

        // Without an arrangement every step is in the first measure, and the
        // arrangement bar reads this to know which one to stand in.
        for (const booking of booked) expect(booking.chainIndex).toBe(0);
        expect(playhead.at(booked[0].time).chainIndex).toBe(0);
    });

    it('forgets everything when the sequencer stops', () => {
        sequencer.play();
        runAudio(context, 500);
        expect(playhead._booked.length).toBeGreaterThan(0);

        sequencer.stop();

        expect(playhead._booked).toHaveLength(0);
        expect(playhead.at(context.currentTime)).toBeNull();
    });

    it('keeps no more bookings than it can use', () => {
        // Nothing consumes them while the window is in the background:
        // `requestAnimationFrame` does not run there, and the scheduler does.
        sequencer.play();
        runAudio(context, 30_000);

        expect(playhead._booked.length).toBeLessThanOrEqual(64);
    });
});

describe('where a bar may run', () => {
    it('measures the content box, not the rectangle on screen', () => {
        // `offsetLeft` and `clientWidth` are in the same coordinate space as
        // the `left` that will be written; `getBoundingClientRect` is not,
        // once the page is zoomed.
        const grid = { offsetLeft: 204, clientLeft: 1, clientWidth: 608 };
        const box = contentBox(grid, { paddingLeft: '4px', paddingRight: '4px' });

        expect(box).toEqual({ left: 209, width: 600 });
    });

    it('copes with an element that has no padding to speak of', () => {
        const cells = { offsetLeft: 0, clientLeft: 0, clientWidth: 480 };
        const box = contentBox(cells, { paddingLeft: '', paddingRight: 'auto' });

        expect(box).toEqual({ left: 0, width: 480 });
    });
});
