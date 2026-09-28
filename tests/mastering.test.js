import { describe, it, expect, beforeEach } from 'vitest';
import { AudioEngine } from '../src/audio/audio-engine.js';
import { MasterFx } from '../src/audio/master-fx.js';
import { MasteringEngine, MASTERING_EVENTS } from '../src/audio/mastering.js';
import { EventBus } from '../src/core/event-bus.js';
import { FakeAudioContext } from './helpers/fake-audio-context.js';

/** Engine + master FX + mastering, wired the way the studio wires them. */
async function makeMastering() {
    const context = new FakeAudioContext();
    const engine = new AudioEngine({ createContext: () => context });
    await engine.init();

    const bus = new EventBus();
    const changes = [];
    bus.on(MASTERING_EVENTS.changed, (state) => changes.push(state));

    const masterFx = new MasterFx(engine, { bus });
    engine.masterFx = masterFx;

    const mastering = new MasteringEngine(engine, { bus });
    engine.mastering = mastering;

    masterFx.applyAllToAudio();
    mastering.applyAllToAudio();

    return { engine, context, masterFx, mastering, changes };
}

describe('MasteringEngine defaults', () => {
    it('starts with a flat EQ and the compressor off', async () => {
        const { mastering } = await makeMastering();

        expect(mastering.eq.enabled).toBe(true);
        expect(mastering.eq.bands).toHaveLength(5);
        expect(mastering.eq.bands.every((band) => band.gain === 0)).toBe(true);
        expect(mastering.compressor.enabled).toBe(false);
        expect(mastering.bypassed).toBe(false);
    });

    it('lays the five bands out from high-pass to low-pass', async () => {
        const { mastering } = await makeMastering();

        expect(mastering.eq.bands.map((band) => band.type)).toEqual([
            'highpass',
            'lowshelf',
            'peaking',
            'highshelf',
            'lowpass'
        ]);
    });
});

describe('MasteringEngine chain', () => {
    let mastering;

    beforeEach(async () => {
        ({ mastering } = await makeMastering());
    });

    it('runs the input through every band to the output', () => {
        const n = mastering._nodes;

        expect(n.input.outputs).toContain(n.eqBands[0]);
        expect(n.eqBands[0].reaches(n.output)).toBe(true);
        expect(n.analyser.outputs).toContain(n.output);
    });

    it('drops the EQ out of the graph when it is disabled', () => {
        const n = mastering._nodes;

        mastering.setEqEnabled(false);
        expect(n.input.outputs).not.toContain(n.eqBands[0]);
        expect(n.input.outputs).toContain(n.analyser);

        mastering.setEqEnabled(true);
        expect(n.input.outputs).toContain(n.eqBands[0]);
    });

    it('inserts the compressor only when it is enabled', () => {
        const n = mastering._nodes;
        expect(n.eqBands[4].outputs).not.toContain(n.compressor);

        mastering.setCompParam('enabled', true);

        expect(n.eqBands[4].outputs).toContain(n.compressor);
        expect(n.compressor.outputs).toContain(n.makeupGain);
        expect(n.makeupGain.reaches(n.output)).toBe(true);
    });

    it('leaves a disabled compressor neutral', () => {
        const n = mastering._nodes;

        expect(n.compressor.ratio.value).toBe(1);
        expect(n.compressor.threshold.value).toBe(0);
        expect(n.makeupGain.gain.value).toBe(1);
    });
});

describe('MasteringEngine parameters', () => {
    let mastering;

    beforeEach(async () => {
        ({ mastering } = await makeMastering());
    });

    it('writes band changes to the matching filter', () => {
        mastering.setEqBand(2, 'freq', 2500);
        mastering.setEqBand(2, 'gain', -4);
        mastering.setEqBand(2, 'q', 2.5);

        const node = mastering._nodes.eqBands[2];
        expect(node.frequency.value).toBe(2500);
        expect(node.gain.value).toBe(-4);
        expect(node.Q.value).toBe(2.5);
    });

    it('converts makeup gain from decibels', () => {
        mastering.setCompParam('enabled', true);
        mastering.setCompParam('makeupGain', 6);

        expect(mastering._nodes.makeupGain.gain.value).toBeCloseTo(1.995, 3);
    });

    it('holds threshold and ratio back while the compressor is off', () => {
        mastering.setCompParam('threshold', -30);
        mastering.setCompParam('ratio', 8);

        expect(mastering.compressor.threshold).toBe(-30); // remembered
        expect(mastering._nodes.compressor.threshold.value).toBe(0); // not applied
        expect(mastering._nodes.compressor.ratio.value).toBe(1);

        mastering.setCompParam('enabled', true);
        expect(mastering._nodes.compressor.threshold.value).toBe(-30);
        expect(mastering._nodes.compressor.ratio.value).toBe(8);
    });

    it('applies attack and release whether or not it is compressing', () => {
        mastering.setCompParam('attack', 0.05);
        mastering.setCompParam('release', 0.4);

        expect(mastering._nodes.compressor.attack.value).toBe(0.05);
        expect(mastering._nodes.compressor.release.value).toBe(0.4);
    });

    it('ignores unknown bands and parameters', () => {
        expect(() => mastering.setEqBand(9, 'gain', 3)).not.toThrow();
        expect(() => mastering.setEqBand(0, 'colour', 'red')).not.toThrow();
        expect(() => mastering.setCompParam('sheen', 1)).not.toThrow();
        expect(mastering.compressor.sheen).toBeUndefined();
    });
});

describe('MasteringEngine in the master chain', () => {
    it('is wired in by master FX', async () => {
        const { engine, masterFx, mastering } = await makeMastering();

        expect(masterFx._nodes.reverbMerge.outputs).toContain(mastering._nodes.input);
        expect(mastering._nodes.output.outputs).toContain(engine.analyser);
    });

    it('drops out of the chain when bypassed, and comes back', async () => {
        const { engine, masterFx, mastering } = await makeMastering();

        mastering.setBypass(true);
        expect(masterFx._nodes.reverbMerge.outputs).toContain(engine.analyser);
        expect(masterFx._nodes.reverbMerge.outputs).not.toContain(mastering._nodes.input);

        mastering.setBypass(false);
        expect(masterFx._nodes.reverbMerge.outputs).toContain(mastering._nodes.input);
    });

    it('tells FX automation about a bypass change, once per change', async () => {
        const { mastering } = await makeMastering();
        const seen = [];
        mastering.onBypassChange = (value) => seen.push(value);

        mastering.setBypass(true);
        mastering.setBypass(true);
        mastering.setBypass(false);

        expect(seen).toEqual([true, true, false]);
    });
});

describe('MasteringEngine presets and persistence', () => {
    it('applies a factory preset to the graph', async () => {
        const { mastering } = await makeMastering();

        expect(mastering.applyPreset('loud-master')).toBe(true);

        expect(mastering.compressor.enabled).toBe(true);
        expect(mastering.compressor.ratio).toBe(6);
        expect(mastering._nodes.compressor.ratio.value).toBe(6);
        expect(mastering._nodes.eqBands[1].gain.value).toBe(3);
    });

    it('reports an unknown preset instead of half-applying it', async () => {
        const { mastering } = await makeMastering();
        const before = mastering.serialize();

        expect(mastering.applyPreset('nope')).toBe(false);
        expect(mastering.serialize()).toEqual(before);
    });

    it('round-trips its state', async () => {
        const { mastering } = await makeMastering();

        mastering.applyPreset('warm-vintage');
        mastering.setEqBand(2, 'gain', 5);
        const saved = mastering.serialize();

        mastering.resetToDefaults();
        expect(mastering.eq.bands[2].gain).toBe(0);

        mastering.deserialize(saved);
        expect(mastering.serialize()).toEqual(saved);
        expect(mastering._nodes.eqBands[2].gain.value).toBe(5);
    });

    it('saves the bypass with the rest, and a factory preset leaves it alone', async () => {
        const { mastering } = await makeMastering();

        mastering.setBypass(true);
        const saved = mastering.serialize();
        expect(saved.bypassed).toBe(true);

        mastering.setBypass(false);
        mastering.deserialize(saved);
        expect(mastering.bypassed).toBe(true);

        mastering.applyPreset('warm-vintage');
        expect(mastering.bypassed).toBe(true);
    });

    it('opens a project as it was saved, not merged into the one before', async () => {
        const { mastering } = await makeMastering();

        mastering.applyPreset('warm-vintage');
        mastering.setEqBand(2, 'gain', 5);
        mastering.setCompParam('threshold', -30);

        // A project that has only part of the state, or none of it.
        mastering.deserialize({ compressor: { enabled: true } });
        expect(mastering.eq.bands.every((band) => band.gain === 0)).toBe(true);
        expect(mastering.compressor.threshold).toBe(MasteringEngine.getMasteringPresets().default.compressor.threshold);
        expect(mastering.compressor.enabled).toBe(true);

        mastering.setEqBand(2, 'gain', 5);
        mastering.deserialize(null);
        expect(mastering.eq.bands[2].gain).toBe(0);
        expect(mastering.compressor.enabled).toBe(false);
    });

    it('does not share state with the preset it was loaded from', async () => {
        const { mastering } = await makeMastering();

        mastering.applyPreset('default');
        mastering.setEqBand(1, 'gain', 6);

        expect(MasteringEngine.getMasteringPresets().default.eq.bands[1].gain).toBe(0);
    });

    it('announces changes for the panel', async () => {
        const { mastering, changes } = await makeMastering();

        mastering.setEqBand(0, 'freq', 60);
        mastering.setCompParam('enabled', true);

        expect(changes).toHaveLength(2);
        expect(changes.at(-1).compressor.enabled).toBe(true);
    });
});

describe('MasteringEngine analysis', () => {
    it('hands out reusable buffers for the spectrum display', async () => {
        const { mastering } = await makeMastering();

        const spectrum = mastering.getSpectrumData();
        const waveform = mastering.getTimeDomainData();

        expect(spectrum).toHaveLength(2048); // fftSize 4096 → 2048 bins
        expect(waveform).toHaveLength(4096);
        expect(mastering.getSpectrumData()).toBe(spectrum); // same buffer, refilled
    });

    it('reports no gain reduction while idle', async () => {
        const { mastering } = await makeMastering();
        expect(mastering.getCompressorReduction()).toBe(0);
    });
});
