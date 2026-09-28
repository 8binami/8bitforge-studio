/**
 * WAV encoding.
 *
 * The one format the studio writes itself: a RIFF header and the samples,
 * interleaved. No dependency, no licence question, and it is what every other
 * encoder takes as input.
 *
 * 16 and 24 bit are integer PCM, 32 bit is IEEE float.
 */

/** Peak the normaliser aims for, leaving a little headroom below clipping. */
export const NORMALIZE_PEAK = 0.95;

const HEADER_LENGTH = 44;

/**
 * Scale a buffer so its loudest sample sits at the target peak: quiet
 * renders come up, clipped ones come down. Modifies the buffer in place.
 *
 * @param {AudioBuffer} buffer
 * @param {number} [peak]
 * @returns {number} the gain that was applied
 */
export function normalizeBuffer(buffer, peak = NORMALIZE_PEAK) {
    let loudest = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const samples = buffer.getChannelData(channel);
        for (let i = 0; i < samples.length; i++) {
            const level = Math.abs(samples[i]);
            if (level > loudest) loudest = level;
        }
    }

    if (loudest === 0 || loudest === peak) return 1;

    const gain = peak / loudest;
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const samples = buffer.getChannelData(channel);
        for (let i = 0; i < samples.length; i++) samples[i] *= gain;
    }
    return gain;
}

/**
 * Encode an audio buffer as a WAV file.
 *
 * @param {AudioBuffer} buffer
 * @param {16|24|32} [bitDepth]
 * @returns {ArrayBuffer}
 */
export function encodeWav(buffer, bitDepth = 16) {
    if (![16, 24, 32].includes(bitDepth)) {
        throw new RangeError(`Unsupported bit depth: ${bitDepth}`);
    }

    const channelCount = buffer.numberOfChannels;
    const bytesPerSample = bitDepth / 8;
    const blockAlign = channelCount * bytesPerSample;
    const dataLength = buffer.length * blockAlign;

    const arrayBuffer = new ArrayBuffer(HEADER_LENGTH + dataLength);
    const view = new DataView(arrayBuffer);

    writeString(view, 0, 'RIFF');
    view.setUint32(4, HEADER_LENGTH + dataLength - 8, true);
    writeString(view, 8, 'WAVE');

    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // chunk size
    view.setUint16(20, bitDepth === 32 ? 3 : 1, true); // 1 = PCM, 3 = float
    view.setUint16(22, channelCount, true);
    view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);

    writeString(view, 36, 'data');
    view.setUint32(40, dataLength, true);

    const channels = [];
    for (let channel = 0; channel < channelCount; channel++) {
        channels.push(buffer.getChannelData(channel));
    }

    let offset = HEADER_LENGTH;
    for (let frame = 0; frame < buffer.length; frame++) {
        for (let channel = 0; channel < channelCount; channel++) {
            const sample = Math.max(-1, Math.min(1, channels[channel][frame]));

            if (bitDepth === 16) {
                // Negative samples reach one step further than positive ones.
                view.setInt16(offset, (sample < 0 ? sample * 32768 : sample * 32767) | 0, true);
                offset += 2;
            } else if (bitDepth === 24) {
                const value = (sample < 0 ? sample * 8388608 : sample * 8388607) | 0;
                view.setUint8(offset, value & 0xff);
                view.setUint8(offset + 1, (value >> 8) & 0xff);
                view.setUint8(offset + 2, (value >> 16) & 0xff);
                offset += 3;
            } else {
                view.setFloat32(offset, sample, true);
                offset += 4;
            }
        }
    }

    return arrayBuffer;
}

/**
 * Encode an audio buffer as a WAV blob, ready to save.
 * @param {AudioBuffer} buffer
 * @param {16|24|32} [bitDepth]
 * @returns {Blob}
 */
export function encodeWavBlob(buffer, bitDepth = 16) {
    return new Blob([encodeWav(buffer, bitDepth)], { type: 'audio/wav' });
}

function writeString(view, offset, text) {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}
