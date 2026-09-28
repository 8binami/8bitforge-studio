import { describe, it, expect, beforeEach } from 'vitest';
import { AudioEngine, DEFAULT_MASTER_VOLUME } from '../src/audio/audio-engine.js';
import { FakeAudioContext } from './helpers/fake-audio-context.js';

/** Engine wired to a fake context, already initialized. */
async function makeEngine(options = {}) {
    const context = new FakeAudioContext();
    const engine = new AudioEngine({ createContext: () => context, ...options });
    await engine.init();
    return { engine, context };
}

describe('AudioEngine defaults', () => {
    it('describes eight tracks with their envelopes and vibrato', () => {
        const engine = new AudioEngine();

        expect(engine.tracks).toHaveLength(8);
        expect(engine.envelopes).toHaveLength(8);
        expect(engine.vibrato).toHaveLength(8);
        expect(engine.mixerSettings).toHaveLength(8);

        // The instrument layout the sequencer relies on
        expect(engine.tracks.map((t) => t.type)).toEqual([
            'square',
            'square',
            'triangle',
            'sawtooth',
            'sine',
            'noise',
            'noise',
            'square'
        ]);
        // Kick sweeps down from a high pitch
        expect(engine.tracks[4].pitchEnv).toBe(36);
    });

    it('does not touch any audio API before init', () => {
        const engine = new AudioEngine();
        expect(engine.initialized).toBe(false);
        expect(engine.audioContext).toBeNull();
    });
});

describe('AudioEngine.init', () => {
    it('builds one channel strip per track, routed to the master bus', async () => {
        const { engine, context } = await makeEngine();

        expect(engine.initialized).toBe(true);
        expect(engine.channelStrips).toHaveLength(8);

        for (const strip of engine.channelStrips) {
            // gain → pan → eqLow → eqMid → eqHigh → compressor → analyser → master
            expect(strip.gain.reaches(engine.masterGain)).toBe(true);
            expect(strip.eqLow.type).toBe('lowshelf');
            expect(strip.eqMid.type).toBe('peaking');
            expect(strip.eqHigh.type).toBe('highshelf');
        }

        // master → analyser → limiter → destination
        expect(engine.masterGain.reaches(context.destination)).toBe(true);
        expect(engine.limiter.reaches(context.destination)).toBe(true);
        expect(engine.limiter.threshold.value).toBe(-3);
        expect(engine.masterGain.gain.value).toBe(0.5);
    });

    it('pre-generates the shared noise buffer', async () => {
        const { engine, context } = await makeEngine();

        expect(engine._noiseBuffer.length).toBe(context.sampleRate * 2);
        const data = engine._noiseBuffer.getChannelData(0);
        expect(data.some((sample) => sample !== 0)).toBe(true);
        expect(Math.max(...data)).toBeLessThanOrEqual(0.6);
    });

    it('is idempotent', async () => {
        const { engine, context } = await makeEngine();
        const nodeCount = context.nodes.length;

        await engine.init();

        expect(context.nodes.length).toBe(nodeCount);
    });
});

describe('AudioEngine.playNote', () => {
    let engine;
    let context;

    beforeEach(async () => {
        ({ engine, context } = await makeEngine());
    });

    it('starts an oscillator on the track it was asked for', () => {
        const before = context.nodesOfKind('oscillator').length;

        engine.playNote(440, 0, 0.5);

        const oscillators = context.nodesOfKind('oscillator');
        expect(oscillators.length).toBeGreaterThan(before);
        expect(oscillators.at(-1).started).not.toBeNull();
        expect(engine.activeNotes.size).toBe(1);
    });

    it('routes a note through its channel strip', () => {
        engine.playNote(440, 2, 0.5);

        const note = [...engine.activeNotes.values()][0];
        expect(note.gainNode.reaches(engine.channelStrips[2].gain)).toBe(true);
    });

    it('uses the shared noise buffer on noise tracks', () => {
        engine.playNote(220, 5, 0.2); // snare

        const source = context.nodesOfKind('bufferSource').at(-1);
        expect(source.buffer).toBe(engine._noiseBuffer);
        expect(source.loop).toBe(true);
    });

    it('applies detune and octave offset to the played frequency', () => {
        engine.tracks[0].detune = 1200; // one octave up, in cents
        engine.playNote(440, 0, 0.5);

        const osc = context.nodesOfKind('oscillator').at(-1);
        expect(osc.frequency.value).toBeCloseTo(880, 5);
    });

    it('keeps one wave table per shape rather than one per note', () => {
        engine.playNote(440, 0, 0.2);
        engine.playNote(494, 0, 0.2);

        engine.tracks[0].phase = 45; // an eighth of a turn

        engine.playNote(440, 0, 0.2);

        expect([...engine._periodicWaveCache.keys()]).toEqual([
            'square:0.5000:0.0000',
            'square:0.5000:0.1250'
        ]);
    });

    it('refuses to play before init', () => {
        const cold = new AudioEngine();
        expect(cold.playNote(440, 0, 0.5)).toBeUndefined();
    });

    it('stops every active note', () => {
        engine.playNote(440, 0, 2);
        engine.playNote(220, 2, 2);
        expect(engine.activeNotes.size).toBe(2);

        engine.stopAllNotes();

        expect(engine.activeNotes.size).toBe(0);
    });
});

describe('AudioEngine mixer', () => {
    it('writes fader, pan and EQ through to the strip', async () => {
        const { engine } = await makeEngine();

        engine.setTrackFaderVolume(3, 1.25);
        engine.setTrackPan(3, -0.5);
        engine.setTrackEQ(3, 'eqMid', 6);

        expect(engine.mixerSettings[3].volume).toBe(1.25);
        expect(engine.channelStrips[3].gain.gain.value).toBe(1.25);
        expect(engine.channelStrips[3].pan.pan.value).toBe(-0.5);
        expect(engine.channelStrips[3].eqMid.gain.value).toBe(6);
    });

    it('reports a silent track as zero level', async () => {
        const { engine } = await makeEngine();
        // The fake analyser returns 128 everywhere, which is silence.
        expect(engine.getTrackLevel(0)).toBe(0);
        expect(engine.getMasterLevel()).toBe(0);
    });

    it('reports zero level while the context is suspended', async () => {
        const { engine, context } = await makeEngine();
        await context.suspend();
        expect(engine.getTrackLevel(0)).toBe(0);
    });

    it('hands out a waveform and a spectrum only once there is audio', async () => {
        const fresh = new AudioEngine();

        // Before init there are no channel strips, so there is nothing to
        // read. Null rather than an empty buffer: a caller must be able to
        // tell "no signal" from "silence", because an unfilled byte buffer
        // reads as full-scale negative, not as nothing.
        expect(fresh.getTrackWaveform(0)).toBeNull();
        expect(fresh.getTrackSpectrum(0)).toBeNull();

        const { engine } = await makeEngine();

        expect(engine.getTrackWaveform(0)).toBeInstanceOf(Uint8Array);
        expect(engine.getTrackSpectrum(0)).toBeInstanceOf(Uint8Array);
        expect(engine.getTrackWaveform(0)).toHaveLength(
            engine.channelStrips[0].analyser.frequencyBinCount
        );
    });

    it('reuses one buffer per track rather than allocating each frame', async () => {
        const { engine } = await makeEngine();

        // A meter reads these sixty times a second; allocating there is
        // how a level display makes the thing it measures stutter.
        expect(engine.getTrackWaveform(2)).toBe(engine.getTrackWaveform(2));
        expect(engine.getTrackSpectrum(2)).toBe(engine.getTrackSpectrum(2));
        expect(engine.getTrackWaveform(2)).not.toBe(engine.getTrackWaveform(3));
    });

    it('says nothing about a track that is not there, or a sleeping context', async () => {
        const { engine, context } = await makeEngine();

        expect(engine.getTrackWaveform(99)).toBeNull();
        expect(engine.getTrackSpectrum(-1)).toBeNull();

        await context.suspend();
        expect(engine.getTrackWaveform(0)).toBeNull();
        expect(engine.getTrackSpectrum(0)).toBeNull();
    });

    it('starts a waveform buffer at silence and a spectrum buffer at nothing', async () => {
        const { engine } = await makeEngine();

        // Two byte encodings that disagree about zero: 128 is the middle
        // of a waveform, and 0 is the bottom of a spectrum. Fill either
        // with the other's and the meters read full scale on an idle
        // track.
        expect(engine._trackWaveData[0].every((byte) => byte === 128)).toBe(true);
        expect(engine._trackSpectrumData[0].every((byte) => byte === 0)).toBe(true);
    });

    it('restores factory defaults', async () => {
        const { engine } = await makeEngine();

        engine.tracks[0].volume = 1.4;
        engine.envelopes[0].attack = 2;
        engine.resetToDefaults();

        expect(engine.tracks[0].volume).toBe(0.2);
        expect(engine.envelopes[0].attack).toBe(0.01);
    });
});

describe('AudioEngine FX injection', () => {
    it('sends notes through an attached track FX chain', async () => {
        const { engine, context } = await makeEngine();
        const calls = [];
        const fxOutput = context.createGain();

        engine.trackEffects = {
            connectSource(source, trackIndex) {
                calls.push({ source, trackIndex });
                return fxOutput;
            }
        };

        engine.playNote(440, 1, 0.3);

        expect(calls).toHaveLength(1);
        expect(calls[0].trackIndex).toBe(1);
        expect(fxOutput.reaches(engine.channelStrips[1].gain)).toBe(true);
    });

    it('works with no FX chain attached', async () => {
        const { engine } = await makeEngine();
        expect(engine.masterFx).toBeNull();
        expect(() => engine.playNote(440, 0, 0.3)).not.toThrow();
    });
});

describe('AudioEngine master volume', () => {
    it('reports the default before there is any audio', () => {
        // The gain node only exists after the first user gesture, and a
        // project saved before then must not record a silent master.
        expect(new AudioEngine().getMasterVolume()).toBe(DEFAULT_MASTER_VOLUME);
    });

    it('remembers a level set before the audio starts, and applies it', async () => {
        const context = new FakeAudioContext();
        const engine = new AudioEngine({ createContext: () => context });

        engine.setMasterVolume(0.3);
        expect(engine.getMasterVolume()).toBe(0.3);

        await engine.init();

        expect(engine.masterGain.gain.value).toBe(0.3);
    });

    it('keeps the node and the stored level in step once running', async () => {
        const { engine } = await makeEngine();

        engine.setMasterVolume(0.75);

        expect(engine.getMasterVolume()).toBe(0.75);
        expect(engine.masterGain.gain.value).toBe(0.75);
    });
});

describe('AudioEngine oscillator phase', () => {
    it('asks for a built-in shape until a phase is wanted', async () => {
        const { engine, context } = await makeEngine();

        engine.playNote(440, 2, 0.2); // bass: a plain triangle
        const plain = context.nodesOfKind('oscillator').at(-1);
        expect(plain.type).toBe('triangle');
        expect(plain.periodicWave).toBeUndefined();

        engine.tracks[2].phase = 90;
        engine.playNote(440, 2, 0.2);
        const turned = context.nodesOfKind('oscillator').at(-1);

        // A quarter turn moves the first harmonic out of the sine term and
        // into the cosine one, which is what starting a quarter of the way
        // into the cycle means.
        expect(turned.periodicWave).toBeTruthy();
        expect(turned.periodicWave.real[1]).toBeCloseTo(8 / Math.PI ** 2, 5);
        expect(turned.periodicWave.imag[1]).toBeCloseTo(0, 6);
    });

    it('leaves the pulse table where it has always been at phase zero', async () => {
        const { engine, context } = await makeEngine();

        engine.playNote(440, 0, 0.2);
        const { real, imag } = context.nodesOfKind('oscillator').at(-1).periodicWave;

        // Sine terms only, thirty-two of them: rotating a wave must not be a
        // way of quietly rebuilding it brighter or duller than it was.
        expect([...real].every((term) => term === 0)).toBe(true);
        expect(imag).toHaveLength(32);
        expect(imag[1]).toBeCloseTo(4 / Math.PI, 5);
    });

    it('has no phase to give a noise track', async () => {
        const { engine, context } = await makeEngine();
        engine.tracks[5].phase = 180;

        engine.playNote(220, 5, 0.2); // snare

        const source = context.nodesOfKind('bufferSource').at(-1);
        expect(source.buffer).toBe(engine._noiseBuffer);
        expect(source.periodicWave).toBeUndefined();
    });
});

describe('AudioEngine filter envelope', () => {
    /** A track whose filter sweeps an octave, opening fast and closing slowly. */
    function sweeping(engine, overrides = {}) {
        Object.assign(engine.tracks[0], {
            filterEnabled: true,
            filterCutoff: 1000,
            filterEnvAmount: 12,
            filterEnvAttack: 0.05,
            filterEnvRelease: 0.3,
            ...overrides
        });
    }

    it('opens the cutoff, holds it while the note lasts, and closes it again', async () => {
        const { engine } = await makeEngine();
        sweeping(engine);

        engine.playNote(440, 0, 0.5);

        const { trackFilter } = [...engine.activeNotes.values()][0];
        const [open, rise, hold, fall] = trackFilter.frequency.automation;

        expect(trackFilter.frequency.automation.map((entry) => entry.method)).toEqual([
            'setValueAtTime',
            'exponentialRampToValueAtTime',
            'setValueAtTime',
            'exponentialRampToValueAtTime'
        ]);
        expect(open.args).toEqual([1000, 0]);
        expect(rise.args[0]).toBeCloseTo(2000, 6); // an octave up
        expect(rise.args[1]).toBeCloseTo(0.05, 6);
        expect(hold.args).toEqual([rise.args[0], 0.5]); // held until the note ends
        expect(fall.args[0]).toBe(1000);
        expect(fall.args[1]).toBeCloseTo(0.8, 6);
    });

    it('never closes the filter before it has finished opening', async () => {
        const { engine } = await makeEngine();
        sweeping(engine, { filterEnvAttack: 0.8 });

        engine.playNote(440, 0, 0.1); // a sixteenth, far shorter than the attack

        const { trackFilter } = [...engine.activeNotes.values()][0];
        const times = trackFilter.frequency.automation.map((entry) => entry.args.at(-1));

        // Out of order, the two ramps would be scheduled against each other.
        expect(times).toEqual([...times].sort((a, b) => a - b));
        expect(times[2]).toBeCloseTo(0.8, 6);
    });

    it('closes a held note when it is let go, from wherever it has got to', async () => {
        const { engine, context } = await makeEngine();
        sweeping(engine);

        // Ten seconds or more is the keyboard, not the sequencer: nothing
        // knows when it ends, so nothing can be scheduled for it.
        const noteId = engine.playNote(440, 0, 30);
        const { trackFilter } = engine.activeNotes.get(noteId);
        expect(trackFilter.frequency.automation).toHaveLength(2);

        context.advance(1);
        engine.stopNote(noteId);

        const closing = trackFilter.frequency.automation.slice(2);
        expect(closing.map((entry) => entry.method)).toEqual([
            'cancelScheduledValues',
            'setValueAtTime',
            'exponentialRampToValueAtTime'
        ]);
        expect(closing.at(-1).args[0]).toBe(1000);
        expect(closing.at(-1).args[1]).toBeCloseTo(1.3, 6);
    });

    it('leaves the cutoff alone when there is no envelope to speak of', async () => {
        const { engine } = await makeEngine();
        sweeping(engine, { filterEnvAmount: 0 });

        engine.playNote(440, 0, 0.5);

        const { trackFilter } = [...engine.activeNotes.values()][0];
        expect(trackFilter.frequency.automation).toEqual([]);
        expect(trackFilter.frequency.value).toBe(1000);
    });

    it('comes home to the cutoff the note actually had, key tracking included', async () => {
        const { engine } = await makeEngine();
        sweeping(engine, { filterKeyTrack: 100 });

        engine.playNote(1046.5, 0, 0.5); // two octaves above middle C

        const { trackFilter } = [...engine.activeNotes.values()][0];
        const [open, , , fall] = trackFilter.frequency.automation;

        expect(open.args[0]).toBeGreaterThan(1000);
        expect(fall.args[0]).toBe(open.args[0]);
    });
});
