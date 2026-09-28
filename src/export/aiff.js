/**
 * AIFF encoding.
 *
 * The second format the studio writes itself. AIFF holds the same thing a
 * WAV holds (uncompressed PCM samples, interleaved) in Apple's container
 * rather than Microsoft's, so it needs no library, no wasm and no licence
 * beyond this project's own. Every editor and every DAW reads it.
 *
 * Two differences from `wav.js`, and they are the whole file:
 *
 * **Everything is big-endian.** Where a WAV writes the least significant
 * byte first, an AIFF writes the most significant first. `DataView` takes
 * that as an argument, which is why the two encoders look so alike.
 *
 * **The sample rate is an 80-bit float.** Not a mistake and not a joke: the
 * format predates a settled way of writing one, and carries the rate in the
 * extended precision the Motorola 68881 used: a sign, a 15-bit exponent and
 * a 64-bit mantissa whose leading bit is written out rather than implied.
 * 44100 comes out as `400E AC44 0000 0000 0000`, and `writeExtended` below
 * is the twelve lines that produce it.
 *
 * Integer PCM only. Floating-point samples need AIFF-C, a later revision
 * with a compression field, and nothing that would read a 32-bit float AIFF
 * would refuse a 32-bit float WAV.
 */

/** What a sample may be written as. AIFF-C would add 32-bit float. */
export const BIT_DEPTHS = Object.freeze([16, 24]);

/**
 * Encode an audio buffer as an AIFF file.
 *
 * @param {AudioBuffer} buffer
 * @param {16|24} [bitDepth]
 * @returns {ArrayBuffer}
 */
export function encodeAiff(buffer, bitDepth = 16) {
    if (!BIT_DEPTHS.includes(bitDepth)) {
        throw new RangeError(
            `AIFF holds integer PCM at ${BIT_DEPTHS.join(' or ')} bit, not ${bitDepth}`
        );
    }

    const channelCount = buffer.numberOfChannels;
    const bytesPerSample = bitDepth / 8;
    const dataLength = buffer.length * channelCount * bytesPerSample;

    // FORM header, then the two chunks: what the sound is, and the sound.
    const commLength = 8 + 18;
    const ssndLength = 8 + 8 + dataLength;
    const arrayBuffer = new ArrayBuffer(12 + commLength + ssndLength);
    const view = new DataView(arrayBuffer);

    writeString(view, 0, 'FORM');
    view.setUint32(4, arrayBuffer.byteLength - 8, false);
    writeString(view, 8, 'AIFF');

    writeString(view, 12, 'COMM');
    view.setUint32(16, 18, false);
    view.setUint16(20, channelCount, false);
    // Frames, not samples: a stereo frame holds two of them.
    view.setUint32(22, buffer.length, false);
    view.setUint16(26, bitDepth, false);
    writeExtended(view, 28, buffer.sampleRate);

    writeString(view, 38, 'SSND');
    view.setUint32(42, 8 + dataLength, false);
    // Offset and block size, both zero: the samples start straight away and
    // are not aligned to anything.
    view.setUint32(46, 0, false);
    view.setUint32(50, 0, false);

    const channels = [];
    for (let channel = 0; channel < channelCount; channel++) {
        channels.push(buffer.getChannelData(channel));
    }

    let offset = 54;
    for (let frame = 0; frame < buffer.length; frame++) {
        for (let channel = 0; channel < channelCount; channel++) {
            const sample = Math.max(-1, Math.min(1, channels[channel][frame]));

            if (bitDepth === 16) {
                // Negative samples reach one step further than positive ones.
                view.setInt16(offset, (sample < 0 ? sample * 32768 : sample * 32767) | 0, false);
                offset += 2;
            } else {
                const value = (sample < 0 ? sample * 8388608 : sample * 8388607) | 0;
                view.setUint8(offset, (value >> 16) & 0xff);
                view.setUint8(offset + 1, (value >> 8) & 0xff);
                view.setUint8(offset + 2, value & 0xff);
                offset += 3;
            }
        }
    }

    return arrayBuffer;
}

/**
 * Encode an audio buffer as an AIFF blob, ready to save.
 * @param {AudioBuffer} buffer
 * @param {16|24} [bitDepth]
 * @returns {Blob}
 */
export function encodeAiffBlob(buffer, bitDepth = 16) {
    return new Blob([encodeAiff(buffer, bitDepth)], { type: 'audio/aiff' });
}

/**
 * A sample rate, as ten bytes of 80-bit extended float.
 *
 * The value is taken apart rather than converted: halve it until it sits in
 * [0.5, 1) and the number of halvings is the exponent. The mantissa is then
 * written as two 32-bit halves, most significant first, which is exact for
 * every sample rate anyone has ever used: they are all integers well under
 * 2^53, so nothing is rounded on the way.
 */
function writeExtended(view, offset, value) {
    if (value <= 0) {
        for (let i = 0; i < 10; i++) view.setUint8(offset + i, 0);
        return;
    }

    let exponent = 0;
    let mantissa = value;
    while (mantissa >= 1) {
        mantissa /= 2;
        exponent++;
    }

    // Biased by 16383 for a mantissa in [1, 2); one less for ours in [0.5, 1).
    view.setUint16(offset, exponent + 16382, false);

    const high = Math.floor(mantissa * 2 ** 32);
    view.setUint32(offset + 2, high, false);
    view.setUint32(offset + 6, Math.floor((mantissa * 2 ** 32 - high) * 2 ** 32), false);
}

function writeString(view, offset, text) {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}
