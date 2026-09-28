import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AudioEngine } from '../src/audio/audio-engine.js';
import { MasterFx, MASTER_FX_EVENTS } from '../src/audio/master-fx.js';
import { EventBus } from '../src/core/event-bus.js';
import { FakeAudioContext } from './helpers/fake-audio-context.js';

async function makeMasterFx() {
    const context = new FakeAudioContext();
    const engine = new AudioEngine({ createContext: () => context });
    await engine.init();

    const bus = new EventBus();
    const changes = [];
    bus.on(MASTER_FX_EVENTS.changed, (state) => changes.push(state));

    const fx = new MasterFx(engine, { bus });
    engine.masterFx = fx;
    fx.applyAllToAudio();

    return { engine, context, fx, changes };
}

/** A mastering stage double, shaped the way MasterFx expects to find one. */
function fakeMastering(context, { bypassed = false } = {}) {
    const input = context.createGain();
    const output = context.createGain();
    input.connect(output);
    return { bypassed, getIoNodes: () => ({ input, output }), input, output };
}

describe('MasterFx defaults', () => {
    it('starts flat: no filter, no effects, wheels centred', async () => {
        const { fx } = await makeMasterFx();

        expect(fx.filter).toEqual({ enabled: false, type: 'lowpass', frequency: 1000, q: 1 });
        expect(fx.effects.chorus.enabled).toBe(false);
        expect(fx.effects.delay.enabled).toBe(false);
        expect(fx.effects.reverb.enabled).toBe(false);
        expect(fx.pitchBend).toBe(0);
        expect(fx.modulation).toBe(0);
    });

    it('leaves every send fully dry while disabled', async () => {
        const { fx } = await makeMasterFx();
        const n = fx._nodes;

        expect(n.chorusWet.gain.value).toBe(0);
        expect(n.delayWet.gain.value).toBe(0);
        expect(n.reverbWet.gain.value).toBe(0);
        expect(n.chorusDry.gain.value).toBe(1);
    });
});

describe('MasterFx insert chain', () => {
    let engine;
    let fx;

    beforeEach(async () => {
        ({ engine, fx } = await makeMasterFx());
    });

    it('routes the master bus through the chain and back to the analyser', () => {
        expect(engine.masterGain.reaches(fx._nodes.insertIn)).toBe(true);
        expect(fx._nodes.reverbMerge.reaches(engine.analyser)).toBe(true);
    });

    it('inserts the filter only when it is enabled', () => {
        expect(fx._nodes.insertIn.outputs).not.toContain(fx._nodes.filter);

        fx.setFilterEnabled(true);
        expect(fx._nodes.insertIn.outputs).toContain(fx._nodes.filter);
        expect(fx._nodes.filter.outputs).toContain(fx._nodes.insertOut);

        fx.setFilterEnabled(false);
        expect(fx._nodes.insertIn.outputs).not.toContain(fx._nodes.filter);
        expect(fx._nodes.insertIn.outputs).toContain(fx._nodes.insertOut);
    });

    it('does not stack duplicate connections when rebuilt', () => {
        fx.setFilterEnabled(true);
        fx.setEffectEnabled('delay', true);
        fx.setEffectEnabled('reverb', true);
        fx.setFilterType('highpass');

        const toInsertIn = engine.masterGain.outputs.filter((n) => n === fx._nodes.insertIn);
        expect(toInsertIn).toHaveLength(1);
    });

    it('keeps the delay feedback loop through every rebuild', () => {
        fx.setEffectEnabled('delay', true);
        fx.setEffectEnabled('chorus', true);

        expect(fx._nodes.delay.outputs).toContain(fx._nodes.delayFeedback);
        expect(fx._nodes.delayFeedback.outputs).toContain(fx._nodes.delay);
    });

    it('goes straight to the analyser when bypassed', () => {
        fx.setBypass(true);

        expect(engine.masterGain.outputs).toContain(engine.analyser);
        expect(engine.masterGain.outputs).not.toContain(fx._nodes.insertIn);

        fx.setBypass(false);
        expect(engine.masterGain.outputs).toContain(fx._nodes.insertIn);
    });
});

describe('MasterFx mastering stage', () => {
    it('inserts mastering between the chain and the analyser', async () => {
        const { engine, context, fx } = await makeMasterFx();
        const mastering = fakeMastering(context);
        engine.mastering = mastering;

        fx.applyAllToAudio();

        expect(fx._nodes.reverbMerge.outputs).toContain(mastering.input);
        expect(mastering.output.outputs).toContain(engine.analyser);
    });

    it('skips a bypassed mastering stage', async () => {
        const { engine, context, fx } = await makeMasterFx();
        engine.mastering = fakeMastering(context, { bypassed: true });

        fx.applyAllToAudio();

        expect(fx._nodes.reverbMerge.outputs).toContain(engine.analyser);
    });
});

describe('MasterFx parameters', () => {
    let fx;

    beforeEach(async () => {
        ({ fx } = await makeMasterFx());
    });

    it('writes filter settings to the node', () => {
        fx.setFilterType('bandpass');
        fx.setFilterFrequency(2500);
        fx.setFilterQ(8);

        expect(fx._nodes.filter.type).toBe('bandpass');
        expect(fx._nodes.filter.frequency.value).toBe(2500);
        expect(fx._nodes.filter.Q.value).toBe(8);
    });

    it('clamps values that would break the audio', () => {
        fx.setFilterFrequency(99000);
        fx.setFilterQ(0);
        fx.setEffectParam('delay', 'feedback', 4);

        expect(fx._nodes.filter.frequency.value).toBe(20000);
        expect(fx._nodes.filter.Q.value).toBe(0.1);
        expect(fx.effects.delay.feedback).toBe(1);
    });

    it('crossfades dry and wet from the mix of an enabled effect', () => {
        fx.setEffectEnabled('reverb', true);
        fx.setEffectParam('reverb', 'mix', 0.25);

        expect(fx._nodes.reverbWet.gain.value).toBeCloseTo(0.25, 10);
        expect(fx._nodes.reverbDry.gain.value).toBeCloseTo(0.75, 10);
    });

    it('takes delay time in seconds', () => {
        fx.setEffectEnabled('delay', true);
        fx.setEffectParam('delay', 'time', 0.375);

        expect(fx._nodes.delay.delayTime.value).toBe(0.375);
    });

    it('debounces the reverb impulse rebuild', async () => {
        vi.useFakeTimers();
        try {
            const before = fx._nodes.reverb.buffer;
            fx.setEffectParam('reverb', 'decay', 0.9);
            fx.setEffectParam('reverb', 'decay', 1.2);

            expect(fx._nodes.reverb.buffer).toBe(before); // nothing yet
            vi.advanceTimersByTime(200);
            expect(fx._nodes.reverb.buffer).not.toBe(before);
        } finally {
            vi.useRealTimers();
        }
    });

    it('ignores unknown effects and parameters', () => {
        expect(() => fx.setEffectEnabled('phaser', true)).not.toThrow();
        expect(() => fx.setEffectParam('delay', 'wobble', 1)).not.toThrow();
        expect(fx.effects.delay.wobble).toBeUndefined();
    });

    it('notifies the toggle callback that FX automation listens to', () => {
        const toggles = [];
        fx.onEffectToggle = (name, enabled) => toggles.push([name, enabled]);

        fx.setEffectEnabled('chorus', true);
        fx.setEffectParam('chorus', 'rate', 3); // a parameter is not a toggle

        expect(toggles).toEqual([['chorus', true]]);
    });
});

describe('MasterFx wheels', () => {
    it('bends notes that are already playing', async () => {
        const { engine, fx } = await makeMasterFx();
        engine.playNote(440, 0, 2);

        fx.setPitchBend(0.5);

        const note = [...engine.activeNotes.values()][0];
        expect(note.oscillators[0].detune.value).toBe(100); // half of ±2 semitones
    });

    it('drives vibrato depth from the modulation wheel', async () => {
        const { engine, fx } = await makeMasterFx();
        engine.vibrato[0] = { rate: 5, depth: 2 };
        engine.playNote(440, 0, 2);

        fx.setModulation(1);

        const note = [...engine.activeNotes.values()][0];
        expect(note.lfoGain.gain.value).toBe(15);
    });

    it('clamps the wheels to their travel', async () => {
        const { fx } = await makeMasterFx();

        fx.setPitchBend(9);
        fx.setModulation(-3);

        expect(fx.pitchBend).toBe(1);
        expect(fx.modulation).toBe(0);
    });
});

describe('MasterFx persistence', () => {
    it('round-trips its state', async () => {
        const { fx } = await makeMasterFx();

        fx.setFilterEnabled(true);
        fx.setFilterType('highpass');
        fx.setEffectEnabled('delay', true);
        fx.setEffectParam('delay', 'time', 0.5);
        fx.setModulation(0.4);
        const saved = fx.serialize();

        fx.reset();
        expect(fx.filter.enabled).toBe(false);

        fx.deserialize(saved);
        expect(fx.serialize()).toEqual(saved);
        expect(fx._nodes.delay.delayTime.value).toBe(0.5);
    });

    it('reads the three-filter layout written by 1.x projects', async () => {
        const { fx } = await makeMasterFx();

        fx.deserialize({
            filters: {
                lowpass: { enabled: false, frequency: 1000, q: 1 },
                highpass: { enabled: true, frequency: 300, q: 2 },
                bandpass: { enabled: false, frequency: 2000, q: 1 }
            }
        });

        expect(fx.filter).toEqual({ enabled: true, type: 'highpass', frequency: 300, q: 2 });
        expect(fx._nodes.filter.type).toBe('highpass');
    });

    it('announces changes so the panel can refresh', async () => {
        const { fx, changes } = await makeMasterFx();

        fx.setFilterEnabled(true);
        fx.setEffectEnabled('chorus', true);

        expect(changes).toHaveLength(2);
        expect(changes.at(-1).effects.chorus.enabled).toBe(true);
    });

    it('survives a deserialize of nothing', async () => {
        const { fx } = await makeMasterFx();
        const before = fx.serialize();

        fx.deserialize(null);

        expect(fx.serialize()).toEqual(before);
    });
});
