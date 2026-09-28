import { describe, it, expect, beforeEach } from 'vitest';
import { createOfflineNote } from '../src/export/offline-note.js';
import { FakeAudioContext } from './helpers/fake-audio-context.js';

/** A track with every optional stage switched off. */
function plainTrack(overrides = {}) {
    return {
        type: 'square',
        volume: 0.2,
        dutyCycle: 0.5,
        detune: 0,
        pitchEnv: 0,
        glide: 0,
        filterEnabled: false,
        filterCutoff: 20000,
        filterQ: 0.1,
        filterType: 'lowpass',
        filterKeyTrack: 0,
        filterLfoRate: 0,
        filterLfoDepth: 0,
        lfoFilterRate: 0,
        lfoFilterDepth: 0,
        tremoloRate: 0,
        tremoloDepth: 0,
        filterEnvAmount: 0,
        unisonVoices: 1,
        unisonDetune: 0,
        unisonSpread: 0,
        octaveOffset: 0,
        semitoneOffset: 0,
        lfo1Wave: 'sine',
        lfo2Wave: 'sine',
        lfo3Wave: 'sine',
        ...overrides
    };
}

const ENVELOPE = { attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.2 };
const NO_VIBRATO = { rate: 0, depth: 0 };

function render(context, options = {}) {
    const destination = context.createGain();
    const result = createOfflineNote(context, destination, {
        note: { note: 'A', octave: 4 },
        trackConfig: plainTrack(options.trackConfig),
        envelope: { ...ENVELOPE, ...options.envelope },
        vibrato: options.vibrato ?? NO_VIBRATO,
        startTime: options.startTime ?? 1,
        duration: options.duration ?? 0.5,
        trackFxChain: options.trackFxChain ?? null,
        pitchBendNode: options.pitchBendNode ?? null,
        modulationNode: options.modulationNode ?? null,
        globalFilter: options.globalFilter ?? null
    });
    return { ...result, destination };
}

describe('createOfflineNote sources', () => {
    let context;

    beforeEach(() => {
        context = new FakeAudioContext();
    });

    it('builds one oscillator that reaches the destination', () => {
        const { sources, destination } = render(context);

        expect(sources).toHaveLength(1);
        expect(sources[0].kind).toBe('oscillator');
        expect(sources[0].reaches(destination)).toBe(true);
    });

    it('places the note in time, release included', () => {
        const { sources } = render(context, { startTime: 2, duration: 0.5 });

        expect(sources[0].started).toBe(2);
        // 2 + 0.5 played + 0.2 release + 0.1 margin
        expect(sources[0].stopped).toBeCloseTo(2.8, 6);
    });

    it('tunes the oscillator to the written note', () => {
        const { sources } = render(context);
        expect(sources[0].frequency.value).toBeCloseTo(440, 3);
    });

    it('applies detune and octave offsets', () => {
        const { sources } = render(context, {
            trackConfig: { detune: 1200, octaveOffset: -1, semitoneOffset: 12 }
        });
        // +1 octave from detune, −1 from the offset, +1 from twelve semitones
        expect(sources[0].frequency.value).toBeCloseTo(880, 3);
    });

    it('gives a square track a periodic wave rather than a built-in type', () => {
        const { sources } = render(context, { trackConfig: { type: 'square' } });
        expect(sources[0].periodicWave).toBeTruthy();
    });

    it('uses the oscillator type for the other waveforms', () => {
        const { sources } = render(context, { trackConfig: { type: 'sawtooth' } });
        expect(sources[0].type).toBe('sawtooth');
        expect(sources[0].periodicWave).toBeUndefined();
    });

    it('starts the wave where the track says, as playback does', () => {
        const { sources } = render(context, { trackConfig: { type: 'sawtooth', phase: 90 } });

        // A shape that had no table of its own now needs one: a start phase
        // is a rotation of the harmonics, which no built-in type can express.
        expect(sources[0].periodicWave).toBeTruthy();
        expect(sources[0].periodicWave.real[1]).not.toBe(0);
    });

    it('builds a shared table once for a whole render', () => {
        const waveCache = new Map();
        const destination = context.createGain();
        const note = {
            note: { note: 'A', octave: 4 },
            trackConfig: plainTrack(),
            envelope: ENVELOPE,
            vibrato: NO_VIBRATO,
            startTime: 0,
            duration: 0.25,
            waveCache
        };

        createOfflineNote(context, destination, note);
        createOfflineNote(context, destination, { ...note, startTime: 0.25 });

        expect(waveCache.size).toBe(1);
    });

    it('renders a noise track from a buffer of its own length', () => {
        const { sources } = render(context, {
            trackConfig: { type: 'noise' },
            duration: 0.5
        });

        expect(sources[0].kind).toBe('bufferSource');
        const expected = Math.ceil(context.sampleRate * (0.5 + 0.2 + 0.1));
        expect(sources[0].buffer.length).toBe(expected);
        expect(sources[0].buffer.getChannelData(0).some((sample) => sample !== 0)).toBe(true);
    });

    it('spreads unison voices and keeps the level even', () => {
        const { sources } = render(context, {
            trackConfig: { unisonVoices: 3, unisonDetune: 20, unisonSpread: 50 }
        });

        expect(sources).toHaveLength(3);
        const [low, centre, high] = sources.map((osc) => osc.frequency.value);
        expect(low).toBeLessThan(centre);
        expect(high).toBeGreaterThan(centre);
        expect(centre).toBeCloseTo(440, 3);

        // The outer voices are panned, the middle one is not
        expect(context.nodesOfKind('panner')).toHaveLength(2);
    });
});

describe('createOfflineNote envelope', () => {
    it('writes an ADSR onto the gain', () => {
        const context = new FakeAudioContext();
        const { gainNode } = render(context, { startTime: 1, duration: 0.5 });
        const automation = gainNode.gain.automation;

        expect(automation.map((entry) => entry.method)).toEqual([
            'setValueAtTime',
            'linearRampToValueAtTime',
            'linearRampToValueAtTime',
            'setValueAtTime',
            'linearRampToValueAtTime'
        ]);

        const [start, attack, decay, sustain, release] = automation;
        expect(start.args).toEqual([0, 1]);
        expect(attack.args[0]).toBe(0.2); // the track volume
        expect(attack.args[1]).toBeCloseTo(1.01, 6);
        expect(decay.args[0]).toBeCloseTo(0.14, 6); // sustain 0.7 × volume 0.2
        expect(sustain.args[1]).toBeCloseTo(1.5, 6); // release starts at the end of the note
        expect(release.args).toEqual([0, 1.7]);
    });

    it('adds a tremolo LFO onto the gain when asked', () => {
        const context = new FakeAudioContext();
        const { gainNode } = render(context, {
            trackConfig: { tremoloRate: 5, tremoloDepth: 40 }
        });

        const tremoloGain = context
            .nodesOfKind('gain')
            .find((node) => node.outputs.includes(gainNode.gain));
        expect(tremoloGain?.gain.value).toBeCloseTo(0.2, 6); // 40% of a half
    });
});

describe('createOfflineNote modulation', () => {
    it('adds a vibrato LFO on the oscillator frequency', () => {
        const context = new FakeAudioContext();
        const { sources } = render(context, { vibrato: { rate: 6, depth: 8 } });

        const lfo = context.nodesOfKind('oscillator').find((node) => node !== sources[0]);
        expect(lfo.frequency.value).toBe(6);
        expect(lfo.reaches(sources[0].frequency)).toBe(true);
    });

    it('lets the modulation wheel drive the vibrato depth', () => {
        const context = new FakeAudioContext();
        const modulationNode = context.createConstantSource();
        const { sources } = render(context, { modulationNode });

        const lfo = context.nodesOfKind('oscillator').find((node) => node !== sources[0]);
        expect(lfo).toBeTruthy();
        const depth = lfo.outputs[0];
        expect(depth.gain.value).toBe(0); // the wheel sets it, not the track
        expect(modulationNode.outputs).toContain(depth.gain);
    });

    it('feeds pitch bend into every voice', () => {
        const context = new FakeAudioContext();
        const pitchBendNode = context.createConstantSource();
        const { sources } = render(context, {
            trackConfig: { unisonVoices: 2 },
            pitchBendNode
        });

        for (const source of sources) {
            expect(pitchBendNode.outputs).toContain(source.detune);
        }
    });

    it('sweeps the pitch envelope down to the note', () => {
        const context = new FakeAudioContext();
        const { sources } = render(context, { trackConfig: { pitchEnv: 36 } });
        const automation = sources[0].frequency.automation;

        expect(automation[0].method).toBe('setValueAtTime');
        expect(automation[0].args[0]).toBeCloseTo(440 * 8, 1); // three octaves up
        expect(automation[1].method).toBe('exponentialRampToValueAtTime');
        expect(automation[1].args[0]).toBeCloseTo(440, 3);
    });

    it('glides only when there is no pitch envelope', () => {
        const context = new FakeAudioContext();
        const withBoth = render(context, { trackConfig: { pitchEnv: 12, glide: 0.5 } });
        expect(withBoth.sources[0].frequency.automation[0].args[0]).toBeCloseTo(880, 1);

        const glideOnly = render(new FakeAudioContext(), { trackConfig: { glide: 0.5 } });
        expect(glideOnly.sources[0].frequency.automation[0].args[0]).toBeCloseTo(352, 1);
    });
});

describe('createOfflineNote filters', () => {
    it('adds no filter when the track has none', () => {
        const context = new FakeAudioContext();
        render(context);
        expect(context.nodesOfKind('biquad')).toHaveLength(0);
    });

    it('adds no filter for a cutoff at the top of the range', () => {
        const context = new FakeAudioContext();
        render(context, { trackConfig: { filterEnabled: true, filterCutoff: 20000 } });
        expect(context.nodesOfKind('biquad')).toHaveLength(0);
    });

    it('inserts the track filter in the path', () => {
        const context = new FakeAudioContext();
        const { gainNode, destination } = render(context, {
            trackConfig: { filterEnabled: true, filterCutoff: 800, filterType: 'highpass' }
        });

        const [filter] = context.nodesOfKind('biquad');
        expect(filter.type).toBe('highpass');
        expect(filter.frequency.value).toBe(800);
        expect(gainNode.outputs).toContain(filter);
        expect(filter.reaches(destination)).toBe(true);
    });

    it('moves the cutoff with the note when key tracking is on', () => {
        const context = new FakeAudioContext();
        render(context, {
            trackConfig: { filterEnabled: true, filterCutoff: 1000, filterKeyTrack: 100 }
        });

        // A4 is about 0.75 octaves above middle C, so the cutoff rises with it
        const [filter] = context.nodesOfKind('biquad');
        expect(filter.frequency.value).toBeGreaterThan(1000);
        expect(filter.frequency.value).toBeLessThan(2000);
    });

    it('adds an LFO filter only when the track filter is absent', () => {
        const withTrackFilter = new FakeAudioContext();
        render(withTrackFilter, {
            trackConfig: {
                filterEnabled: true,
                filterCutoff: 900,
                lfoFilterRate: 2,
                lfoFilterDepth: 50
            }
        });
        expect(withTrackFilter.nodesOfKind('biquad')).toHaveLength(1);

        const withoutTrackFilter = new FakeAudioContext();
        render(withoutTrackFilter, {
            trackConfig: { lfoFilterRate: 2, lfoFilterDepth: 50 }
        });
        expect(withoutTrackFilter.nodesOfKind('biquad')).toHaveLength(1);
        expect(withoutTrackFilter.nodesOfKind('biquad')[0].frequency.value).toBe(10000);
    });

    it('inserts the global filter last', () => {
        const context = new FakeAudioContext();
        const { destination } = render(context, {
            globalFilter: { enabled: true, type: 'lowpass', frequency: 2000, q: 1 }
        });

        const [filter] = context.nodesOfKind('biquad');
        expect(filter.frequency.value).toBe(2000);
        expect(filter.outputs).toContain(destination);
    });
});

describe('createOfflineNote routing', () => {
    it('sends the voice through a track FX chain when there is one', () => {
        const context = new FakeAudioContext();
        const input = context.createGain();
        const output = context.createGain();
        const { gainNode, destination } = render(context, {
            trackFxChain: { input, output }
        });

        expect(gainNode.outputs).toContain(input);
        expect(output.outputs).toContain(destination);
    });
});

describe('createOfflineNote filter envelope', () => {
    /** A track whose filter sweeps an octave, opening fast and closing slowly. */
    const SWEEPING = {
        filterEnabled: true,
        filterCutoff: 1000,
        filterEnvAmount: 12,
        filterEnvAttack: 0.05,
        filterEnvRelease: 0.3
    };

    it('opens the cutoff, holds it while the note lasts, and closes it again', () => {
        const context = new FakeAudioContext();
        render(context, { trackConfig: SWEEPING, startTime: 1, duration: 0.5 });

        const [filter] = context.nodesOfKind('biquad');
        const [open, rise, hold, fall] = filter.frequency.automation;

        expect(filter.frequency.automation.map((entry) => entry.method)).toEqual([
            'setValueAtTime',
            'exponentialRampToValueAtTime',
            'setValueAtTime',
            'exponentialRampToValueAtTime'
        ]);
        expect(open.args).toEqual([1000, 1]);
        expect(rise.args[0]).toBeCloseTo(2000, 6); // an octave up
        expect(rise.args[1]).toBeCloseTo(1.05, 6);
        expect(hold.args[1]).toBeCloseTo(1.5, 6);
        expect(fall.args[0]).toBe(1000);
        expect(fall.args[1]).toBeCloseTo(1.8, 6);
    });

    it('never closes the filter before it has finished opening', () => {
        const context = new FakeAudioContext();
        render(context, {
            trackConfig: { ...SWEEPING, filterEnvAttack: 0.8 },
            startTime: 1,
            duration: 0.1
        });

        const [filter] = context.nodesOfKind('biquad');
        const times = filter.frequency.automation.map((entry) => entry.args.at(-1));

        expect(times).toEqual([...times].sort((a, b) => a - b));
        expect(times[2]).toBeCloseTo(1.8, 6);
    });
});
