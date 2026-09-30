import { describe, it, expect } from 'vitest';
import { AudioEngine } from '../src/audio/audio-engine.js';
import { Sequencer } from '../src/sequencer/sequencer.js';
import { Arrangement } from '../src/sequencer/arrangement.js';
import { EventBus } from '../src/core/event-bus.js';
import { Exporter } from '../src/export/exporter.js';
import { registerEncoder, unregisterEncoder } from '../src/export/encoders.js';
import { loopPoints, loopMetadataArguments } from '../src/export/loop-points.js';
import { encodeWav, SMPL_CHUNK_LENGTH } from '../src/export/wav.js';
import { ARGUMENTS } from '../src/export/ffmpeg-encoders.js';
import { FakeAudioContext } from './helpers/fake-audio-context.js';

/** A buffer as encodeWav reads it: channels of samples and a rate. */
function buffer({ frames, channels = 2, sampleRate = 44100 }) {
    const data = Array.from({ length: channels }, () => new Float32Array(frames));
    return { numberOfChannels: channels, length: frames, sampleRate, getChannelData: (c) => data[c] };
}

/** The chunks of a RIFF file: id → [offset of its body, size]. */
function chunks(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    const id = (at) => String.fromCharCode(...new Uint8Array(arrayBuffer, at, 4));
    const found = {};
    let at = 12;
    while (at + 8 <= arrayBuffer.byteLength) {
        const size = view.getUint32(at + 4, true);
        found[id(at)] = [at + 8, size];
        at += 8 + size + (size % 2);
    }
    return found;
}

async function makeStudio() {
    const context = new FakeAudioContext();
    const engine = new AudioEngine({ createContext: () => context });
    await engine.init();
    const bus = new EventBus();
    const sequencer = new Sequencer(engine, { bus });
    const arrangement = new Arrangement(sequencer, { bus });
    sequencer.arrangement = arrangement;
    return { audioEngine: engine, sequencer, arrangement };
}

describe('loop points', () => {
    it('start at the loop measure, in samples, and run to the end of the file', () => {
        // 120 BPM, 16 steps: a measure is two seconds, 88 200 samples.
        expect(loopPoints({ bpm: 120, steps: 16, sampleRate: 44100, frames: 88200 * 6, loopStart: 2 })).toEqual({
            start: 176400,
            length: 88200 * 4
        });
    });

    it('round a measure that does not start on a whole sample to the nearest one', () => {
        // 133 BPM: a measure is 79 578.95… samples.
        expect(loopPoints({ bpm: 133, steps: 16, sampleRate: 44100, frames: 400000, loopStart: 1 }).start).toBe(79579);
    });

    it('loop the whole song without an intro, or when the start is past the end', () => {
        expect(loopPoints({ bpm: 120, steps: 16, sampleRate: 48000, frames: 1000 })).toEqual({ start: 0, length: 1000 });
        expect(loopPoints({ bpm: 120, steps: 16, sampleRate: 48000, frames: 1000, loopStart: 5 })).toEqual({ start: 0, length: 1000 });
        expect(loopPoints({ bpm: 120, steps: 16, sampleRate: 48000, frames: 0 })).toBeNull();
    });

    it('become LOOPSTART and LOOPLENGTH comments for OGG and FLAC', () => {
        const loop = { start: 176400, length: 352800 };
        expect(loopMetadataArguments(loop)).toEqual(['-metadata', 'LOOPSTART=176400', '-metadata', 'LOOPLENGTH=352800']);
        expect(ARGUMENTS.ogg({ quality: 8, loop })).toEqual([
            '-c:a', 'libvorbis', '-q:a', '8', '-metadata', 'LOOPSTART=176400', '-metadata', 'LOOPLENGTH=352800'
        ]);
        expect(ARGUMENTS.flac({ loop })).toContain('LOOPLENGTH=352800');
        // Nothing asked, nothing written.
        expect(ARGUMENTS.ogg({ quality: 8 })).toEqual(['-c:a', 'libvorbis', '-q:a', '8']);
        expect(ARGUMENTS.mp3({ loop })).not.toContain('-metadata');
    });
});

describe('a WAV with loop points', () => {
    it('carries a smpl chunk after the samples, with one forward loop to the last sample', () => {
        const file = encodeWav(buffer({ frames: 1000 }), 16, { loop: { start: 250, length: 750 } });
        const view = new DataView(file);
        const found = chunks(file);

        expect(Object.keys(found)).toEqual(['fmt ', 'data', 'smpl']);
        expect(view.getUint32(4, true)).toBe(file.byteLength - 8);
        const [smpl, size] = found.smpl;
        expect(size).toBe(SMPL_CHUNK_LENGTH - 8);
        expect(view.getUint32(smpl + 28, true)).toBe(1); // one loop
        expect(view.getUint32(smpl + 40, true)).toBe(0); // forward
        expect(view.getUint32(smpl + 44, true)).toBe(250); // start
        expect(view.getUint32(smpl + 48, true)).toBe(999); // end: the last sample
        expect(view.getUint32(smpl + 56, true)).toBe(0); // forever
    });

    it('pads the samples to an even length before it', () => {
        // 24-bit mono, 3 frames: 9 bytes of samples, then a pad byte.
        const file = encodeWav(buffer({ frames: 3, channels: 1 }), 24, { loop: { start: 0, length: 3 } });
        expect(Object.keys(chunks(file))).toEqual(['fmt ', 'data', 'smpl']);
        expect(file.byteLength).toBe(44 + 9 + 1 + SMPL_CHUNK_LENGTH);
    });

    it('is the plain WAV it always was without them', () => {
        const file = encodeWav(buffer({ frames: 1000 }), 16);
        expect(Object.keys(chunks(file))).toEqual(['fmt ', 'data']);
        expect(file.byteLength).toBe(44 + 4000);
    });
});

describe('the loop start of an arrangement', () => {
    it('is kept with the song, and stays inside it', async () => {
        const { arrangement } = await makeStudio();
        arrangement.setChain([0, 1, 2, 2]);

        expect(arrangement.setLoopStart(1)).toBe(true);
        expect(arrangement.serialize().loopStart).toBe(1);
        expect(arrangement.setLoopStart(9)).toBe(true);
        expect(arrangement.loopStart).toBe(0);

        arrangement.setLoopStart(3);
        arrangement.removeFromChain(3);
        expect(arrangement.loopStart).toBe(0);
    });

    it('comes back with a project, and is absent from older ones', async () => {
        const { arrangement } = await makeStudio();
        arrangement.deserialize({ chain: [0, 1, 2], loopStart: 1 });
        expect(arrangement.loopStart).toBe(1);
        arrangement.deserialize({ chain: [0, 1, 2] });
        expect(arrangement.loopStart).toBe(0);
        arrangement.deserialize({ chain: [0], loopStart: 4 });
        expect(arrangement.loopStart).toBe(0);
    });

    it('is where looped playback goes back to: the intro plays once', async () => {
        const { sequencer, arrangement } = await makeStudio();
        arrangement.setChain([0, 1, 2]);
        arrangement.setLoopStart(1);
        arrangement.enabled = true;
        sequencer.isLooping = true;

        const heard = [];
        for (let i = 0; i < 6; i++) {
            heard.push(arrangement.currentChainIndex);
            arrangement.advanceChain();
        }
        expect(heard).toEqual([0, 1, 2, 1, 2, 1]);
    });
});

describe('an export with loop points', () => {
    it('renders with no tail and hands the loop, past the intro, to the encoder', async () => {
        const studio = await makeStudio();
        studio.sequencer.bpm = 120;
        studio.arrangement.setChain([0, 1, 1, 2]);
        studio.arrangement.setLoopStart(1);

        const seen = [];
        registerEncoder({
            format: 'loop-test',
            extension: 'tst',
            mimeType: 'audio/test',
            encode: (_buffer, options) => {
                seen.push(options.loop);
                return new Blob(['x']);
            }
        });
        const renders = [];
        const exporter = new Exporter(studio, { settings: { format: 'loop-test', loopPoints: true } });
        exporter._render = (options) => {
            renders.push({ loopReady: exporter.settings.loopReady || exporter.settings.loopPoints, ...options });
            return Promise.resolve(buffer({ frames: 88200 * 4 }));
        };

        try {
            await exporter.run();
            await new Exporter(studio, { settings: { format: 'loop-test', mode: 'patterns', loopPoints: true } }).run().catch(() => {});
        } finally {
            unregisterEncoder('loop-test');
        }

        expect(renders[0].loopReady).toBe(true);
        expect(seen[0]).toEqual({ start: 88200, length: 88200 * 3 });
    });

    it('leaves the loop out when not asked', async () => {
        const studio = await makeStudio();
        studio.arrangement.setChain([0, 1]);
        studio.arrangement.setLoopStart(1);
        const seen = [];
        registerEncoder({
            format: 'loop-test',
            extension: 'tst',
            mimeType: 'audio/test',
            encode: (_buffer, options) => {
                seen.push(options.loop);
                return new Blob(['x']);
            }
        });
        const exporter = new Exporter(studio, { settings: { format: 'loop-test' } });
        exporter._render = () => Promise.resolve(buffer({ frames: 1000 }));
        try {
            await exporter.run();
        } finally {
            unregisterEncoder('loop-test');
        }
        expect(seen).toEqual([null]);
    });
});
