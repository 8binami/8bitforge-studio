/**
 * The metronome.
 *
 * Two things matter and neither is audible in a screenshot: a click is
 * booked at the audio time of the step it belongs to: not at whatever the
 * clock says when the step is announced, which is a lookahead too late:
 * and it goes to the output around the master bus, so the master fader, the
 * mastering stage and every export leave it alone.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Metronome } from '../src/audio/metronome.js';

/** Enough of an audio context to record what was booked, and when. */
function fakeContext({ state = 'running', currentTime = 10 } = {}) {
    const clicks = [];
    const destination = { id: 'destination' };

    const gainNode = () => {
        const node = {
            gain: {
                value: 1,
                setValueAtTime: (value, at) => node.gain._set.push({ value, at }),
                exponentialRampToValueAtTime: (value, at) => node.gain._ramp.push({ value, at }),
                _set: [],
                _ramp: []
            },
            connectedTo: null,
            connect(target) {
                node.connectedTo = target;
            }
        };
        return node;
    };

    return {
        state,
        currentTime,
        destination,
        clicks,
        createGain: gainNode,
        createOscillator() {
            const oscillator = {
                type: null,
                frequency: { value: 0 },
                connect(target) {
                    oscillator.envelope = target;
                },
                start(at) {
                    oscillator.startedAt = at;
                },
                stop(at) {
                    oscillator.stoppedAt = at;
                    clicks.push(oscillator);
                }
            };
            return oscillator;
        }
    };
}

function setup(options) {
    const context = fakeContext(options);
    const metronome = new Metronome({ audioContext: context });
    return { context, metronome, clicks: context.clicks };
}

describe('when it clicks', () => {
    let metronome;
    let clicks;

    beforeEach(() => {
        ({ metronome, clicks } = setup());
        metronome.toggle();
    });

    it('says nothing until it is switched on', () => {
        const quiet = setup();
        quiet.metronome.onStep(0, 11);

        expect(quiet.clicks).toHaveLength(0);
    });

    it('clicks on the beat and not between beats', () => {
        for (let step = 0; step < 8; step++) metronome.onStep(step, 11 + step * 0.125);

        // Sixteenths: a beat every four steps.
        expect(clicks).toHaveLength(2);
    });

    it('is higher on the first beat of the bar', () => {
        metronome.onStep(0, 11);
        metronome.onStep(4, 11.5);

        expect(clicks[0].frequency.value).toBe(1000);
        expect(clicks[1].frequency.value).toBe(800);
    });

    it('treats the first step of any pattern length as a downbeat', () => {
        // A twelve-step pattern has no sixteenth bar line, and its first
        // step is still where the bar starts.
        metronome.onStep(0, 11);

        expect(clicks[0].frequency.value).toBe(1000);
    });

    it('stays quiet while the context is not running', () => {
        const suspended = setup({ state: 'suspended' });
        suspended.metronome.toggle();
        suspended.metronome.onStep(0, 11);

        // Booked while suspended, every click would arrive at once on resume.
        expect(suspended.clicks).toHaveLength(0);
    });

    it('goes off again', () => {
        expect(metronome.toggle()).toBe(false);
        metronome.onStep(0, 11);

        expect(clicks).toHaveLength(0);
    });
});

describe('when the click is booked', () => {
    it('is at the time of the step, not the time of the call', () => {
        const { metronome, clicks } = setup({ currentTime: 10 });
        metronome.toggle();

        // What the scheduler does: book a step a tenth of a second ahead.
        metronome.onStep(0, 10.1);

        expect(clicks[0].startedAt).toBeCloseTo(10.1);
    });

    it('plays a step already past rather than dropping it', () => {
        const { metronome, clicks } = setup({ currentTime: 10 });
        metronome.toggle();

        metronome.onStep(0, 9.5);

        expect(clicks[0].startedAt).toBe(10);
    });

    it('shapes the click around that same moment', () => {
        const { metronome, clicks } = setup({ currentTime: 10 });
        metronome.toggle();

        metronome.onStep(0, 10.25);

        const envelope = clicks[0].envelope;
        expect(envelope.gain._set[0]).toEqual({ value: 0.4, at: 10.25 });
        expect(envelope.gain._ramp[0].at).toBeCloseTo(10.31);
        expect(clicks[0].stoppedAt).toBeCloseTo(10.33);
    });
});

describe('where the click goes', () => {
    it('reaches the output without passing through the master', () => {
        const { metronome, context, clicks } = setup();
        metronome.toggle();
        metronome.onStep(0, 11);

        // Through the master it would be pulled down by the master fader,
        // shaped by the mastering EQ, and printed into every export.
        expect(clicks[0].envelope.connectedTo.connectedTo).toBe(context.destination);
    });

    it('builds its gain once, whatever it is asked to play', () => {
        const { metronome, clicks } = setup();
        metronome.toggle();

        metronome.onStep(0, 11);
        metronome.onStep(4, 11.5);

        expect(clicks[0].envelope.connectedTo).toBe(clicks[1].envelope.connectedTo);
    });
});
