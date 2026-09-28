/**
 * FX automation.
 *
 * The lanes are a shape in normalised space that has to come back as hertz,
 * seconds and decibels at the right step. Everything here is about that
 * round trip, and about the two rules recording depends on: only armed lanes
 * are written, and an armed lane is not played back over the top of itself.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus } from '../src/core/event-bus.js';
import { SEQUENCER_EVENTS } from '../src/sequencer/sequencer.js';
import { FxAutomation, FX_AUTOMATION_EVENTS, PARAMS } from '../src/automation/fx-automation.js';

/** Stand-ins that record what was written, with the same shape as the real ones. */
function makeStudio() {
    const masterFx = {
        filter: { enabled: true, type: 'lowpass', frequency: 1000, q: 1 },
        effects: {
            chorus: { enabled: false, rate: 1, mix: 0.5 },
            delay: { enabled: true, time: 0.25, feedback: 0.3, mix: 0.5 },
            reverb: { enabled: false, decay: 0.5, mix: 0.5 }
        },
        pitchBend: 0,
        modulation: 0,
        setFilterFrequency(hz) {
            this.filter.frequency = hz;
        },
        setFilterQ(q) {
            this.filter.q = q;
        },
        setEffectParam(fx, param, value) {
            this.effects[fx][param] = value;
        },
        setPitchBend(value) {
            this.pitchBend = value;
        },
        setModulation(value) {
            this.modulation = value;
        }
    };

    const mastering = {
        bypassed: false,
        eq: { bands: [{ freq: 40 }, { freq: 200, gain: 0 }, { freq: 1000, gain: 0, q: 1 }] },
        compressor: { threshold: -12, ratio: 4, attack: 0.01, release: 0.1, makeupGain: 0 },
        setEqBand(index, param, value) {
            this.eq.bands[index][param] = value;
        },
        setCompParam(key, value) {
            this.compressor[key] = value;
        }
    };

    const sequencer = { steps: 16, isPlaying: false };
    const arrangement = { enabled: true, chain: [0, 1], getChain: () => [0, 1] };

    const bus = new EventBus();
    const automation = new FxAutomation({ masterFx, mastering, arrangement, sequencer, bus });

    return { automation, masterFx, mastering, sequencer, arrangement, bus };
}

describe('FX automation lanes', () => {
    let studio;

    beforeEach(() => {
        studio = makeStudio();
    });

    it('holds its value before the first point and after the last', () => {
        const { automation } = studio;
        automation.addPoint('delayMix', 8, 0.2);
        automation.addPoint('delayMix', 24, 0.8);

        expect(automation.getValueAt('delayMix', 0)).toBe(0.2);
        expect(automation.getValueAt('delayMix', 99)).toBe(0.8);
    });

    it('interpolates between two points', () => {
        const { automation } = studio;
        automation.addPoint('delayMix', 0, 0);
        automation.addPoint('delayMix', 10, 1);

        expect(automation.getValueAt('delayMix', 5)).toBeCloseTo(0.5);
        expect(automation.getValueAt('delayMix', 2)).toBeCloseTo(0.2);
    });

    it('says nothing for a lane that holds nothing', () => {
        expect(studio.automation.getValueAt('delayMix', 4)).toBeNull();
    });

    it('keeps one point per step, and keeps them in order', () => {
        const { automation } = studio;
        automation.addPoint('delayMix', 12, 0.3);
        automation.addPoint('delayMix', 4, 0.9);
        automation.addPoint('delayMix', 12, 0.6);

        expect(automation.getLane('delayMix')).toEqual([
            { step: 4, value: 0.9 },
            { step: 12, value: 0.6 }
        ]);
    });

    it('hands back where a moved point ended up', () => {
        const { automation } = studio;
        automation.addPoint('delayMix', 4, 0.2);
        automation.addPoint('delayMix', 20, 0.7);

        // Dragging the first point past the second reorders the lane.
        const index = automation.movePoint('delayMix', 0, 30, 0.1);

        expect(index).toBe(1);
        expect(automation.getLane('delayMix')[1]).toEqual({ step: 30, value: 0.1 });
    });
});

describe('normalising', () => {
    it('round-trips a linear parameter', () => {
        const { automation } = makeStudio();
        const normal = automation.normalize('delayMix', 0.3);

        expect(normal).toBeCloseTo(0.3);
        expect(automation.denormalize('delayMix', normal)).toBeCloseTo(0.3);
    });

    it('round-trips a logarithmic one', () => {
        const { automation } = makeStudio();
        const normal = automation.normalize('filterFreq', 1000);

        expect(automation.denormalize('filterFreq', normal)).toBeCloseTo(1000, 3);
        // Halfway along the lane is halfway in octaves, not in hertz.
        expect(automation.denormalize('filterFreq', 0.5)).toBeLessThan(2000);
    });

    it('keeps a value inside its range', () => {
        const { automation } = makeStudio();

        expect(automation.denormalize('filterQ', 2)).toBe(30);
        expect(automation.denormalize('filterQ', -1)).toBeCloseTo(0.1);
    });
});

describe('playing a lane', () => {
    it('writes the parameter of the module it belongs to', () => {
        const { automation, masterFx } = makeStudio();
        automation.addPoint('filterFreq', 0, automation.normalize('filterFreq', 200));
        automation.addPoint('filterFreq', 16, automation.normalize('filterFreq', 8000));

        automation.onStep(8);

        // Halfway between 200 and 8000 Hz, in octaves.
        expect(masterFx.filter.frequency).toBeCloseTo(Math.sqrt(200 * 8000), 0);
    });

    it('reaches the mastering stage too', () => {
        const { automation, mastering } = makeStudio();
        automation.addPoint('mastCompThresh', 0, automation.normalize('mastCompThresh', -30));

        automation.onStep(0);

        expect(mastering.compressor.threshold).toBeCloseTo(-30);
    });

    it('follows the sequencer, measure by measure', () => {
        const { automation, masterFx, bus } = makeStudio();
        automation.addPoint('delayMix', 0, 0);
        automation.addPoint('delayMix', 31, 1);

        // Second measure, first step: sixteen steps into a sixteen-step
        // pattern, so halfway along a two-measure lane.
        bus.emit(SEQUENCER_EVENTS.step, { step: 0, chainIndex: 1 });

        expect(masterFx.effects.delay.mix).toBeCloseTo(16 / 31, 2);
    });

    it('stays out of the way when the arrangement is off', () => {
        const { automation, masterFx, arrangement, bus } = makeStudio();
        automation.addPoint('delayMix', 0, 1);
        arrangement.enabled = false;

        bus.emit(SEQUENCER_EVENTS.step, { step: 0, chainIndex: 0 });

        expect(masterFx.effects.delay.mix).toBe(0.5);
    });
});

describe('recording', () => {
    it('captures only the lanes that are armed', () => {
        const { automation, masterFx } = makeStudio();
        masterFx.effects.delay.mix = 0.9;
        masterFx.effects.delay.feedback = 0.1;

        automation.toggleArm('delayMix');
        automation.startRecording();
        automation.onStep(4);

        expect(automation.getLane('delayMix')).toEqual([{ step: 4, value: 0.9 }]);
        expect(automation.hasLane('delayFeedback')).toBe(false);
    });

    it('does not play an armed lane back over what is being recorded', () => {
        const { automation, masterFx } = makeStudio();
        automation.addPoint('delayMix', 0, 0);
        automation.addPoint('delayMix', 16, 0);

        masterFx.effects.delay.mix = 0.75;
        automation.toggleArm('delayMix');
        automation.startRecording();
        automation.onStep(8);

        expect(masterFx.effects.delay.mix).toBe(0.75);
    });

    it('disarms everything when recording stops', () => {
        const { automation } = makeStudio();
        automation.toggleArm('delayMix');
        automation.startRecording();
        automation.stopRecording();

        expect(automation.isArmed('delayMix')).toBe(false);
    });
});

describe('before and after the song', () => {
    it('puts the parameters back where they were', () => {
        const { automation, masterFx, bus } = makeStudio();
        masterFx.effects.delay.mix = 0.2;
        automation.addPoint('delayMix', 0, 1);

        bus.emit(SEQUENCER_EVENTS.play);
        automation.onStep(0);
        expect(masterFx.effects.delay.mix).toBe(1);

        bus.emit(SEQUENCER_EVENTS.stop);
        expect(masterFx.effects.delay.mix).toBe(0.2);
    });

    it('falls back to the defaults when the song was already playing', () => {
        const { automation, masterFx } = makeStudio();
        automation.addPoint('delayMix', 0, 1);
        automation.onStep(0);

        automation.restoreSnapshot();

        expect(masterFx.effects.delay.mix).toBe(PARAMS.delayMix.default);
    });

    it('clears a lane back to its default', () => {
        const { automation, masterFx } = makeStudio();
        automation.addPoint('delayTime', 0, 1);
        automation.onStep(0);

        automation.clearLane('delayTime');

        expect(automation.hasLane('delayTime')).toBe(false);
        expect(masterFx.effects.delay.time).toBe(PARAMS.delayTime.default);
    });
});

describe('the lanes worth showing', () => {
    it('follows whether the effect is switched on', () => {
        const { automation, masterFx, mastering } = makeStudio();

        expect(automation.isGroupActive('delay')).toBe(true);
        expect(automation.isGroupActive('chorus')).toBe(false);

        masterFx.effects.chorus.enabled = true;
        expect(automation.isGroupActive('chorus')).toBe(true);

        mastering.bypassed = true;
        expect(automation.isGroupActive('mastering')).toBe(false);
        // The wheels are always there: they belong to no effect.
        expect(automation.isGroupActive('wheel')).toBe(true);
    });
});

describe('persistence', () => {
    it('survives a round trip through a project file', () => {
        const { automation } = makeStudio();
        automation.addPoint('filterFreq', 3, 0.123456);
        automation.addPoint('filterFreq', 9, 0.9);

        const saved = JSON.parse(JSON.stringify(automation.serialize()));

        const other = makeStudio().automation;
        other.deserialize(saved);

        expect(other.getLane('filterFreq')).toEqual([
            { step: 3, value: 0.123 },
            { step: 9, value: 0.9 }
        ]);
    });

    it('ignores a lane for a parameter this version does not have', () => {
        const { automation } = makeStudio();
        automation.deserialize({ lanes: { somethingElse: [{ s: 0, v: 1 }] } });

        expect(automation.getLane('somethingElse')).toEqual([]);
    });

    it('says when a lane changes, so the panel can redraw', () => {
        const { automation, bus } = makeStudio();
        const seen = [];
        bus.on(FX_AUTOMATION_EVENTS.changed, () => seen.push('changed'));

        automation.addPoint('delayMix', 0, 0.5);
        automation.clearAll();

        expect(seen).toEqual(['changed', 'changed']);
    });
});
