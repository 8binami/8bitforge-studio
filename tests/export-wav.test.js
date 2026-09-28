import { describe, it, expect } from 'vitest';
import { encodeWav, normalizeBuffer, NORMALIZE_PEAK } from '../src/export/wav.js';

/** A buffer double: the encoder only needs these four things. */
function makeBuffer(channels, sampleRate = 48000) {
    return {
        numberOfChannels: channels.length,
        length: channels[0].length,
        sampleRate,
        getChannelData: (index) => channels[index]
    };
}

function readHeader(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    const text = (offset) =>
        String.fromCharCode(...new Uint8Array(arrayBuffer, offset, 4).values());

    return {
        riff: text(0),
        size: view.getUint32(4, true),
        wave: text(8),
        fmt: text(12),
        audioFormat: view.getUint16(20, true),
        channels: view.getUint16(22, true),
        sampleRate: view.getUint32(24, true),
        byteRate: view.getUint32(28, true),
        blockAlign: view.getUint16(32, true),
        bitDepth: view.getUint16(34, true),
        data: text(36),
        dataSize: view.getUint32(40, true)
    };
}

describe('encodeWav', () => {
    it('writes a RIFF header that describes the audio', () => {
        const buffer = makeBuffer([new Float32Array(100), new Float32Array(100)], 44100);
        const header = readHeader(encodeWav(buffer, 16));

        expect(header.riff).toBe('RIFF');
        expect(header.wave).toBe('WAVE');
        expect(header.fmt).toBe('fmt ');
        expect(header.data).toBe('data');
        expect(header.audioFormat).toBe(1); // PCM
        expect(header.channels).toBe(2);
        expect(header.sampleRate).toBe(44100);
        expect(header.bitDepth).toBe(16);
        expect(header.blockAlign).toBe(4); // 2 channels × 2 bytes
        expect(header.byteRate).toBe(44100 * 4);
    });

    it('states the file and data sizes correctly', () => {
        const frames = 50;
        const buffer = makeBuffer([new Float32Array(frames), new Float32Array(frames)]);
        const encoded = encodeWav(buffer, 16);
        const header = readHeader(encoded);

        expect(encoded.byteLength).toBe(44 + frames * 4);
        expect(header.dataSize).toBe(frames * 4);
        expect(header.size).toBe(encoded.byteLength - 8);
    });

    it('interleaves the channels', () => {
        const left = new Float32Array([1, 1]);
        const right = new Float32Array([-1, -1]);
        const view = new DataView(encodeWav(makeBuffer([left, right]), 16));

        expect(view.getInt16(44, true)).toBe(32767); // left, full scale
        expect(view.getInt16(46, true)).toBe(-32768); // right, full scale
    });

    it('clamps samples beyond full scale', () => {
        const view = new DataView(encodeWav(makeBuffer([new Float32Array([4, -4])]), 16));

        expect(view.getInt16(44, true)).toBe(32767);
        expect(view.getInt16(46, true)).toBe(-32768);
    });

    it('writes 24-bit samples over three bytes', () => {
        const encoded = encodeWav(makeBuffer([new Float32Array([0.5])]), 24);
        const header = readHeader(encoded);
        const bytes = new Uint8Array(encoded, 44, 3);
        const value = bytes[0] | (bytes[1] << 8) | (bytes[2] << 16);

        expect(header.bitDepth).toBe(24);
        expect(encoded.byteLength).toBe(47);
        expect(value).toBeCloseTo(8388607 * 0.5, -2);
    });

    it('writes 32-bit float samples untouched', () => {
        const encoded = encodeWav(makeBuffer([new Float32Array([0.25, -0.75])]), 32);
        const header = readHeader(encoded);
        const view = new DataView(encoded);

        expect(header.audioFormat).toBe(3); // IEEE float
        expect(view.getFloat32(44, true)).toBeCloseTo(0.25, 6);
        expect(view.getFloat32(48, true)).toBeCloseTo(-0.75, 6);
    });

    it('refuses a bit depth it cannot write', () => {
        expect(() => encodeWav(makeBuffer([new Float32Array(1)]), 8)).toThrow(RangeError);
    });
});

describe('normalizeBuffer', () => {
    it('brings a quiet render up to the target peak', () => {
        const samples = new Float32Array([0.1, -0.05, 0.02]);
        const gain = normalizeBuffer(makeBuffer([samples]));

        expect(gain).toBeCloseTo(NORMALIZE_PEAK / 0.1, 6);
        expect(Math.max(...samples)).toBeCloseTo(NORMALIZE_PEAK, 6);
    });

    it('brings a clipped render back down', () => {
        const samples = new Float32Array([1.8, -1.2]);
        normalizeBuffer(makeBuffer([samples]));

        expect(Math.max(...samples.map(Math.abs))).toBeCloseTo(NORMALIZE_PEAK, 6);
    });

    it('scales every channel by the same gain, keeping the stereo image', () => {
        const left = new Float32Array([0.5]);
        const right = new Float32Array([0.25]);
        normalizeBuffer(makeBuffer([left, right]));

        expect(left[0] / right[0]).toBeCloseTo(2, 6);
    });

    it('leaves silence alone', () => {
        const samples = new Float32Array([0, 0, 0]);
        expect(normalizeBuffer(makeBuffer([samples]))).toBe(1);
        expect([...samples]).toEqual([0, 0, 0]);
    });
});
