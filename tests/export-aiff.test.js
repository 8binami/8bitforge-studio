/**
 * AIFF encoding.
 *
 * Three things can go wrong here and none of them would show up as anything
 * but a file that will not open: a byte order written the wrong way round,
 * a chunk size that does not match what follows it, and the sample rate:
 * which AIFF carries as an 80-bit extended float, a format nothing else in
 * this studio has any use for. The known encoding of 44100 is checked
 * against the ten bytes the specification prints.
 */

import { describe, it, expect } from 'vitest';
import { encodeAiff, BIT_DEPTHS } from '../src/export/aiff.js';

/** A buffer double: the encoder only needs these four things. */
function makeBuffer(channels, sampleRate = 44100) {
    return {
        numberOfChannels: channels.length,
        length: channels[0].length,
        sampleRate,
        getChannelData: (index) => channels[index]
    };
}

function read(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    const text = (offset) =>
        String.fromCharCode(...new Uint8Array(arrayBuffer, offset, 4).values());
    const hex = (offset, length) =>
        [...new Uint8Array(arrayBuffer, offset, length)]
            .map((byte) => byte.toString(16).padStart(2, '0'))
            .join('');

    return {
        form: text(0),
        formSize: view.getUint32(4, false),
        aiff: text(8),
        comm: text(12),
        commSize: view.getUint32(16, false),
        channels: view.getUint16(20, false),
        frames: view.getUint32(22, false),
        bitDepth: view.getUint16(26, false),
        sampleRate: hex(28, 10),
        ssnd: text(38),
        ssndSize: view.getUint32(42, false),
        offset: view.getUint32(46, false),
        blockSize: view.getUint32(50, false),
        total: arrayBuffer.byteLength
    };
}

describe('encodeAiff', () => {
    it('writes the chunks an AIFF is made of', () => {
        const buffer = makeBuffer([new Float32Array(100), new Float32Array(100)]);
        const file = read(encodeAiff(buffer, 16));

        expect(file.form).toBe('FORM');
        expect(file.aiff).toBe('AIFF');
        expect(file.comm).toBe('COMM');
        expect(file.ssnd).toBe('SSND');

        expect(file.commSize).toBe(18);
        expect(file.channels).toBe(2);
        expect(file.bitDepth).toBe(16);

        // Frames, not samples: a hundred stereo frames, not two hundred.
        expect(file.frames).toBe(100);

        // The samples begin at once and are aligned to nothing.
        expect(file.offset).toBe(0);
        expect(file.blockSize).toBe(0);
    });

    it('declares sizes that match what it actually wrote', () => {
        // A player that trusts these and finds something else is a player
        // that plays noise, or nothing.
        const buffer = makeBuffer([new Float32Array(50), new Float32Array(50)]);

        for (const bitDepth of BIT_DEPTHS) {
            const arrayBuffer = encodeAiff(buffer, bitDepth);
            const file = read(arrayBuffer);
            const audio = 50 * 2 * (bitDepth / 8);

            expect(file.total, `${bitDepth} bit`).toBe(54 + audio);
            expect(file.formSize, `${bitDepth} bit`).toBe(file.total - 8);
            expect(file.ssndSize, `${bitDepth} bit`).toBe(8 + audio);
        }
    });

    it('writes the sample rate as the 80-bit float the format asks for', () => {
        // The encodings printed in the AIFF specification. Getting the
        // exponent's bias wrong shifts the rate by an octave, and the file
        // plays at half or double speed with nothing to say why.
        const rates = {
            44100: '400eac4400000000 0000'.replace(' ', ''),
            48000: '400ebb8000000000 0000'.replace(' ', ''),
            96000: '400fbb8000000000 0000'.replace(' ', ''),
            22050: '400dac4400000000 0000'.replace(' ', '')
        };

        for (const [rate, expected] of Object.entries(rates)) {
            const buffer = makeBuffer([new Float32Array(4)], Number(rate));
            expect(read(encodeAiff(buffer, 16)).sampleRate, `${rate} Hz`).toBe(expected);
        }
    });

    it('writes samples most significant byte first', () => {
        // The one difference from a WAV that a listener would hear: read the
        // other way round, full scale becomes a click.
        const buffer = makeBuffer([Float32Array.from([1, -1, 0])]);
        const bytes = new Uint8Array(encodeAiff(buffer, 16), 54);

        // +1 is 0x7FFF, -1 is 0x8000, silence is zero: high byte first.
        expect([...bytes]).toEqual([0x7f, 0xff, 0x80, 0x00, 0x00, 0x00]);
    });

    it('interleaves the channels, a frame at a time', () => {
        const left = Float32Array.from([1, 0]);
        const right = Float32Array.from([0, -1]);
        const bytes = new Uint8Array(encodeAiff(makeBuffer([left, right]), 16), 54);

        expect([...bytes]).toEqual([0x7f, 0xff, 0x00, 0x00, 0x00, 0x00, 0x80, 0x00]);
    });

    it('holds a sample to full scale in twenty-four bits too', () => {
        const buffer = makeBuffer([Float32Array.from([1, -1])]);
        const bytes = new Uint8Array(encodeAiff(buffer, 24), 54);

        expect([...bytes]).toEqual([0x7f, 0xff, 0xff, 0x80, 0x00, 0x00]);
    });

    it('clips rather than wrapping round', () => {
        // A sample past full scale, written as an integer without clamping,
        // comes back out the other side as the opposite sign.
        const buffer = makeBuffer([Float32Array.from([1.5, -1.5])]);
        const bytes = new Uint8Array(encodeAiff(buffer, 16), 54);

        expect([...bytes]).toEqual([0x7f, 0xff, 0x80, 0x00]);
    });

    it('refuses a depth it cannot hold rather than writing another', () => {
        const buffer = makeBuffer([new Float32Array(8)]);

        // 32-bit float needs AIFF-C. Quietly writing 24 instead would give
        // someone a file that is not the one they chose.
        expect(() => encodeAiff(buffer, 32)).toThrow(/32/);
        expect(() => encodeAiff(buffer, 8)).toThrow();
    });
});
