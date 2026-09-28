import { describe, it, expect, beforeEach } from 'vitest';
import { AudioEngine } from '../src/audio/audio-engine.js';
import { TrackEffects, DEFAULT_TRACK_FX } from '../src/audio/track-effects.js';
import { FakeAudioContext } from './helpers/fake-audio-context.js';

/**
 * The fake context has no AudioWorklet, so these runs exercise the
 * ScriptProcessor fallback: the path users on older browsers get.
 */
async function makeEffects() {
    const context = new FakeAudioContext();
    const engine = new AudioEngine({ createContext: () => context });
    await engine.init();

    const fx = new TrackEffects(engine);
    await fx.ready;
    return { engine, context, fx };
}

describe('TrackEffects chains', () => {
    let fx;
    let context;

    beforeEach(async () => {
        ({ fx, context } = await makeEffects());
    });

    it('builds one chain per track', () => {
        expect(fx.trackEffects).toHaveLength(8);
        for (let track = 0; track < 8; track++) {
            expect(fx.getTrackChain(track)).toBeTruthy();
        }
    });

    it('wires input to output through every stage', () => {
        const chain = fx.getTrackChain(0);

        expect(chain.input.reaches(chain.distortionMix)).toBe(true);
        expect(chain.distortionMix.reaches(chain.chorusMix)).toBe(true);
        expect(chain.chorusMix.reaches(chain.delayMix)).toBe(true);
        expect(chain.delayMix.reaches(chain.reverbMix)).toBe(true);
        expect(chain.reverbMix.reaches(chain.output)).toBe(true);
        expect(chain.input.reaches(chain.output)).toBe(true);
    });

    it('starts fully dry, so a fresh chain is transparent', () => {
        const chain = fx.getTrackChain(0);

        expect(chain.distortionGain.gain.value).toBe(0);
        expect(chain.distortionDry.gain.value).toBe(1);
        expect(chain.chorusWet.gain.value).toBe(0);
        expect(chain.delayWet.gain.value).toBe(0);
        expect(chain.reverbWet.gain.value).toBe(0);
        expect(chain.crusherWet.gain.value).toBe(0);
    });

    it('feeds the delay back into itself', () => {
        const chain = fx.getTrackChain(0);
        expect(chain.delay.outputs).toContain(chain.delayFeedback);
        expect(chain.delayFeedback.outputs).toContain(chain.delay);
    });

    it('falls back to a ScriptProcessor when no worklet is available', () => {
        const chain = fx.getTrackChain(0);
        expect(chain._isWorklet).toBe(false);
        expect(chain.crusher.kind).toBe('scriptProcessor');
        expect(typeof chain.crusher.onaudioprocess).toBe('function');
    });

    it('fills the reverb convolver with an impulse response', () => {
        const chain = fx.getTrackChain(0);
        expect(chain.reverb.buffer.numberOfChannels).toBe(2);
        expect(chain.reverb.buffer.length).toBe(context.sampleRate * 2);
    });

    it('returns the chain output when a source is connected', () => {
        const source = context.createGain();
        const output = fx.connectSource(source, 3);

        expect(output).toBe(fx.getTrackChain(3).output);
        expect(source.outputs).toContain(fx.getTrackChain(3).input);
    });

    it('passes the source straight through for an unknown track', () => {
        const source = context.createGain();
        expect(fx.connectSource(source, 99)).toBe(source);
    });
});

describe('TrackEffects parameters', () => {
    let fx;

    beforeEach(async () => {
        ({ fx } = await makeEffects());
    });

    it('swaps dry for wet when distortion is engaged', () => {
        const chain = fx.getTrackChain(1);

        fx.setDistortion(1, 0.5);
        expect(chain.distortionGain.gain.value).toBe(1);
        expect(chain.distortionDry.gain.value).toBe(0);
        expect(chain.distortion.curve).toBeInstanceOf(Float32Array);
        expect(chain.distortion.oversample).toBe('4x');

        fx.setDistortion(1, 0);
        expect(chain.distortionGain.gain.value).toBe(0);
        expect(chain.distortionDry.gain.value).toBe(1);
    });

    it('clamps delay time and feedback to safe ranges', () => {
        const chain = fx.getTrackChain(0);

        fx.setDelayTime(0, 99);
        fx.setDelayFeedback(0, 5); // runaway feedback would never decay
        expect(chain.delay.delayTime.value).toBe(2);
        expect(chain.delayFeedback.gain.value).toBe(0.9);

        fx.setDelayTime(0, -1);
        fx.setDelayFeedback(0, -1);
        expect(chain.delay.delayTime.value).toBe(0);
        expect(chain.delayFeedback.gain.value).toBe(0);
    });

    it('keeps wet and dry complementary on a mix control', () => {
        const chain = fx.getTrackChain(0);
        fx.setDelayMix(0, 0.3);

        expect(chain.delayWet.gain.value).toBe(0.3);
        expect(chain.delayDry.gain.value).toBeCloseTo(0.7, 10);
    });

    it('engages the bitcrusher only when it would change the signal', () => {
        const chain = fx.getTrackChain(0);

        fx.setBitcrusherBits(0, 16);
        fx.setBitcrusherRate(0, 1);
        expect(chain.crusherWet.gain.value).toBe(0); // transparent settings stay bypassed

        fx.setBitcrusherBits(0, 8);
        expect(chain.crusherWet.gain.value).toBe(1);
        expect(chain.crusherDry.gain.value).toBe(0);
    });

    it('clamps bitcrusher settings', () => {
        const chain = fx.getTrackChain(0);

        fx.setBitcrusherBits(0, 99);
        fx.setBitcrusherRate(0, 0);
        expect(chain.crusherBits).toBe(16);
        expect(chain.crusherRate).toBe(0.01);
    });

    it('ignores parameters aimed at a track that has no chain', () => {
        expect(() => fx.setDistortion(99, 0.5)).not.toThrow();
        expect(fx.getTrackParams(99)).toBeNull();
    });
});

describe('TrackEffects presets', () => {
    it('reports back what a preset set', async () => {
        const { fx } = await makeEffects();

        fx.loadPreset(2, 'crush');
        const params = fx.getTrackParams(2);

        expect(params.crushBits).toBe(4);
        expect(params.crushRate).toBeCloseTo(0.2, 10);
        expect(params.delayMix).toBeCloseTo(0.3, 10);
        expect(params.distortion).toBe(1);
    });

    it('returns a chain to silence with the clean preset', async () => {
        const { fx } = await makeEffects();

        fx.loadPreset(2, 'space');
        fx.loadPreset(2, 'clean');
        const params = fx.getTrackParams(2);

        expect(params.distortion).toBe(0);
        expect(params.delayMix).toBe(0);
        expect(params.reverbMix).toBe(0);
        expect(params.chorusMix).toBe(0);
        expect(params.crushBits).toBe(16);
    });

    it('ignores an unknown preset name', async () => {
        const { fx } = await makeEffects();
        const before = fx.getTrackParams(0);

        fx.loadPreset(0, 'nope');

        expect(fx.getTrackParams(0)).toEqual(before);
    });
});

describe('TrackEffects persistence', () => {
    it('reports every track, whatever has been done to them', async () => {
        const { fx } = await makeEffects();
        fx.setTrackParams(2, { distortion: 0.4, delayMix: 0.6, crushBits: 6 });

        const saved = fx.serialize();

        expect(saved).toHaveLength(8);
        expect(saved[2].distortion).toBeCloseTo(0.4, 4);
        expect(saved[2].delayMix).toBeCloseTo(0.6, 4);
        expect(saved[2].crushBits).toBe(6);
        // A track nobody touched still has to say what it is set to, or a
        // project could not put it back.
        expect(saved[0].distortion).toBe(0);
        expect(saved[0].crushBits).toBe(16);
    });

    it('puts a saved state back on every track', async () => {
        const { fx } = await makeEffects();
        fx.setTrackParams(1, { reverbMix: 0.8, chorusMix: 0.3 });
        fx.setTrackParams(5, { distortion: 0.9 });
        const saved = fx.serialize();

        const { fx: restored } = await makeEffects();
        restored.deserialize(saved);

        expect(restored.getTrackParams(1).reverbMix).toBeCloseTo(0.8, 4);
        expect(restored.getTrackParams(1).chorusMix).toBeCloseTo(0.3, 4);
        expect(restored.getTrackParams(5).distortion).toBeCloseTo(0.9, 4);
    });

    it('fills in whatever a partial set of parameters leaves out', async () => {
        const { fx } = await makeEffects();
        fx.setTrackParams(0, { distortion: 0.5, delayMix: 0.5 });

        fx.setTrackParams(0, { distortion: 0.2 });

        // Not "keep the rest": a preset that says nothing about the delay
        // means no delay, or presets would stack on top of each other.
        expect(fx.getTrackParams(0).distortion).toBeCloseTo(0.2, 4);
        expect(fx.getTrackParams(0).delayMix).toBe(0);
    });

    it('ignores a state that is not a list of tracks', async () => {
        const { fx } = await makeEffects();
        fx.setTrackParams(0, { distortion: 0.5 });

        fx.deserialize(null);
        fx.deserialize({ nonsense: true });

        expect(fx.getTrackParams(0).distortion).toBeCloseTo(0.5, 4);
    });

    it('describes a chain that has never existed', () => {
        const blank = TrackEffects.defaultState();

        expect(blank).toHaveLength(8);
        expect(blank[0]).toEqual({ ...DEFAULT_TRACK_FX });
        // Copies, not eight references to one object.
        blank[0].distortion = 1;
        expect(blank[1].distortion).toBe(0);
    });
});
