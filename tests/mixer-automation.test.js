/**
 * Mixer automation.
 *
 * The lane mechanics are shared with the FX automation and tested there.
 * What is particular here is the table: nine parameters for each of eight
 * tracks plus the master fader, each reaching the engine's own setter, so
 * these are about that wiring.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus } from '../src/core/event-bus.js';
import { MixerAutomation, PARAMS, TRACK_NAMES } from '../src/automation/mixer-automation.js';

function makeEngine() {
    const track = () => ({
        volume: 1,
        pan: 0,
        eqLow: 0,
        eqMid: 0,
        eqHigh: 0,
        compressor: { enabled: false, threshold: -24, ratio: 4, attack: 0.003, release: 0.25 }
    });

    return {
        mixerSettings: Array.from({ length: 8 }, track),
        masterVolume: 0.5,
        getMasterVolume() {
            return this.masterVolume;
        },
        setMasterVolume(value) {
            this.masterVolume = value;
        },
        setTrackFaderVolume(index, value) {
            this.mixerSettings[index].volume = value;
        },
        setTrackPan(index, value) {
            this.mixerSettings[index].pan = value;
        },
        setTrackEQ(index, band, value) {
            this.mixerSettings[index][band] = value;
        },
        setTrackCompressorThreshold(index, value) {
            this.mixerSettings[index].compressor.threshold = value;
        },
        setTrackCompressorRatio(index, value) {
            this.mixerSettings[index].compressor.ratio = value;
        },
        setTrackCompressorAttack(index, value) {
            this.mixerSettings[index].compressor.attack = value;
        },
        setTrackCompressorRelease(index, value) {
            this.mixerSettings[index].compressor.release = value;
        }
    };
}

function makeAutomation() {
    const audioEngine = makeEngine();
    const sequencer = { steps: 16, isPlaying: false };
    const arrangement = { enabled: true, chain: [0, 1], getChain: () => [0, 1] };
    const bus = new EventBus();

    return {
        audioEngine,
        bus,
        automation: new MixerAutomation({ audioEngine, arrangement, sequencer, bus })
    };
}

describe('the mixer automation table', () => {
    it('covers every track and the master', () => {
        // Nine lanes a track, and one for the master fader.
        expect(Object.keys(PARAMS)).toHaveLength(TRACK_NAMES.length * 9 + 1);
        expect(PARAMS.masterVol.group).toBe('master');
        expect(PARAMS.t7CompRel.group).toBe('track7');
    });

    it('names a lane after its track', () => {
        expect(PARAMS.t0Vol.label).toBe('Lead Vol');
        expect(PARAMS.t6EqHigh.label).toBe('Hi-Hat EQ Hi');
    });

    it('offers every track and the master to filter by', () => {
        const groups = makeAutomation().automation.getGroups();

        expect(groups).toHaveLength(9);
        expect(groups[0]).toEqual({ value: 'track0', label: 'Lead' });
        expect(groups.at(-1)).toEqual({ value: 'master', label: 'Master' });
    });
});

describe('reading and writing the console', () => {
    let studio;

    beforeEach(() => {
        studio = makeAutomation();
    });

    it('reads a track through the engine settings', () => {
        studio.audioEngine.mixerSettings[2].pan = -0.5;

        expect(studio.automation.readParam('t2Pan')).toBe(-0.5);
    });

    it('writes a fader, a pan and an EQ band', () => {
        const { automation, audioEngine } = studio;

        automation.writeParam('t1Vol', 1.25);
        automation.writeParam('t1Pan', 0.4);
        automation.writeParam('t1EqMid', -6);

        expect(audioEngine.mixerSettings[1]).toMatchObject({
            volume: 1.25,
            pan: 0.4,
            eqMid: -6
        });
    });

    it('writes the compressor through its own setters', () => {
        const { automation, audioEngine } = studio;

        automation.writeParam('t3CompTh', -40);
        automation.writeParam('t3CompRt', 8);

        expect(audioEngine.mixerSettings[3].compressor).toMatchObject({
            threshold: -40,
            ratio: 8
        });
    });

    it('writes the master fader', () => {
        studio.automation.writeParam('masterVol', 1.2);

        expect(studio.audioEngine.getMasterVolume()).toBe(1.2);
    });

    it('plays an envelope onto a fader', () => {
        const { automation, audioEngine } = studio;
        // A fade-in across the first measure: 0 to full, on a 0..1.5 range.
        automation.addPoint('t0Vol', 0, 0);
        automation.addPoint('t0Vol', 16, 1);

        automation.onStep(8);

        expect(audioEngine.mixerSettings[0].volume).toBeCloseTo(0.75);
    });

    it('keeps a pan lane centred at the middle of its range', () => {
        const { automation, audioEngine } = studio;
        automation.addPoint('t4Pan', 0, 0.5);

        automation.onStep(0);

        expect(audioEngine.mixerSettings[4].pan).toBeCloseTo(0);
    });
});
