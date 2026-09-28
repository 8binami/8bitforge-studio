import { describe, it, expect, beforeEach } from 'vitest';
import { AudioEngine } from '../src/audio/audio-engine.js';
import { Synthesizer, SYNTH_EVENTS } from '../src/audio/synthesizer.js';
import { EventBus } from '../src/core/event-bus.js';
import { FakeAudioContext } from './helpers/fake-audio-context.js';

async function makeSynth() {
    const context = new FakeAudioContext();
    const engine = new AudioEngine({ createContext: () => context });
    await engine.init();

    const bus = new EventBus();
    const events = [];
    bus.on(SYNTH_EVENTS.changed, (track) => events.push(track));

    return { engine, bus, events, synth: new Synthesizer(engine, { bus }) };
}

describe('Synthesizer parameters', () => {
    let engine;
    let synth;

    beforeEach(async () => {
        ({ engine, synth } = await makeSynth());
    });

    it('writes parameters to the selected track only', () => {
        synth.setCurrentTrack(2);
        synth.setWaveform('sawtooth');
        synth.setVolume('0.4');

        expect(engine.tracks[2].type).toBe('sawtooth');
        expect(engine.tracks[2].volume).toBe(0.4);
        expect(engine.tracks[0].type).toBe('square'); // untouched
    });

    it('parses numeric input coming from sliders', () => {
        synth.setAttack('0.25');
        synth.setUnisonVoices('3');
        synth.setOctaveOffset('-1');

        expect(engine.envelopes[0].attack).toBe(0.25);
        expect(engine.tracks[0].unisonVoices).toBe(3);
        expect(engine.tracks[0].octaveOffset).toBe(-1);
    });

    it('enables the track filter when a cutoff is set', () => {
        expect(engine.tracks[0].filterEnabled).toBe(false);
        synth.setFilterCutoff('800');

        expect(engine.tracks[0].filterCutoff).toBe(800);
        expect(engine.tracks[0].filterEnabled).toBe(true);
    });
});

describe('Synthesizer presets', () => {
    it('replaces the whole track, leaving no residue from the previous preset', async () => {
        const { engine, synth } = await makeSynth();

        synth.setFilterCutoff('500'); // leaves filterEnabled = true

        // An instrument only carries the parameters it cares about. Every one
        // it omits comes back as its default rather than keeping whatever the
        // track held before: that is the whole point of replacing the object.
        synth.applyFullPresetState({
            type: 'triangle',
            glide: 0.1,
            envelope: { attack: 0.01, decay: 0.2, sustain: 0.8, release: 0.15 }
        });

        expect(engine.tracks[0].type).toBe('triangle');
        expect(engine.tracks[0].glide).toBe(0.1);
        expect(engine.tracks[0].filterEnabled).toBe(false);
        expect(engine.tracks[0].filterCutoff).toBe(20000);
        expect(engine.envelopes[0].sustain).toBe(0.8);
    });

    it('round-trips a full preset state', async () => {
        const { synth } = await makeSynth();

        synth.setWaveform('sawtooth');
        synth.setDetune('12');
        synth.setTremoloDepth('0.4');
        const saved = synth.getFullPresetState();

        // Wipe the track first, so what comes back is restored and not left over.
        synth.applyFullPresetState({});
        expect(synth.getFullPresetState().type).toBe('square');

        synth.applyFullPresetState(saved);

        expect(synth.getFullPresetState()).toEqual(saved);
    });

    it('recalls FX and arpeggiator settings when those modules are attached', async () => {
        const { engine, synth } = await makeSynth();
        const fxCalls = [];
        engine.trackEffects = {
            getTrackParams: () => ({ distortion: 40, delayMix: 0.2 }),
            setDistortion: (idx, value) => fxCalls.push(['distortion', idx, value]),
            setDelayTime: () => {},
            setDelayFeedback: () => {},
            setDelayMix: (idx, value) => fxCalls.push(['delayMix', idx, value]),
            setReverbMix: () => {}
        };
        const arpSettings = [];
        synth.arpeggiator = {
            getSettings: () => ({ enabled: true, mode: 'up' }),
            updateSettings: (idx, settings) => arpSettings.push([idx, settings])
        };

        const saved = synth.getFullPresetState();
        expect(saved.fx.distortion).toBe(40);
        expect(saved.arp.mode).toBe('up');

        synth.applyFullPresetState(saved, 3);

        expect(fxCalls).toContainEqual(['distortion', 3, 40]);
        expect(fxCalls).toContainEqual(['delayMix', 3, 0.2]);
        expect(arpSettings).toEqual([[3, { enabled: true, mode: 'up' }]]);
    });

    it('saves a null FX section when no FX chain is attached', async () => {
        const { synth } = await makeSynth();
        const saved = synth.getFullPresetState();

        expect(saved.fx).toBeNull();
        expect(saved.arp).toBeNull();
    });
});

describe('Synthesizer events', () => {
    it('announces a track change and a preset load, not every slider move', async () => {
        const { synth, events } = await makeSynth();

        synth.setVolume('0.5'); // a slider move: the view already knows
        expect(events).toEqual([]);

        synth.setCurrentTrack(4);
        synth.applyFullPresetState({ type: 'triangle', volume: 0.24 });

        expect(events).toEqual([4, 4]);
    });
});

describe('a setting of nought', () => {
    /**
     * Every default in the two preset-state functions used to be written
     * `value || fallback`, which is right only where the fallback is
     * nought itself. For the five where it is not, a legitimate nought
     * came back as the fallback: a sound read out of a track was not
     * the sound in it, and loading the same instrument twice gave two
     * different sounds.
     */
    it('survives being read out of a track and put back', async () => {
        const { synth, engine } = await makeSynth();

        engine.tracks[0].filterEnvAttack = 0;
        engine.tracks[0].filterEnvRelease = 0;

        const state = synth.getFullPresetState(0);
        expect(state.filterEnvAttack).toBe(0);
        expect(state.filterEnvRelease).toBe(0);

        synth.applyFullPresetState(state, 1);
        expect(engine.tracks[1].filterEnvAttack).toBe(0);
        expect(engine.tracks[1].filterEnvRelease).toBe(0);
    });

    it('survives in the effects a preset carries', async () => {
        // The Clean chain is exactly this: no feedback, no mix. Loading
        // an instrument built on it used to put 0.3 of feedback back on.
        const { synth, engine } = await makeSynth();
        const applied = [];
        engine.trackEffects = new Proxy(
            {},
            { get: (_target, name) => (track, value) => applied.push([name, value]) }
        );

        synth.applyFullPresetState(
            { type: 'square', fx: { delayTime: 0, delayFeedback: 0, chorusRate: 0 } },
            0
        );

        expect(applied).toContainEqual(['setDelayFeedback', 0]);
        expect(applied).toContainEqual(['setDelayTime', 0]);
        expect(applied).toContainEqual(['setChorusRate', 0]);
    });
});
