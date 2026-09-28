/**
 * Audio encoders.
 *
 * One registry, one interface. WAV is built in because the studio writes it
 * itself; every other format is a module that registers at load time, so a
 * build that leaves an encoder out simply offers one format fewer instead of
 * failing at the branch that assumed it.
 *
 * That also keeps the licensing honest: see docs/licensing.md. The encoders
 * are chosen for permissive licences, and the one LGPL encoder (MP3) stays a
 * file of its own that anyone can drop.
 *
 *   registerEncoder({
 *       format: 'flac',
 *       extension: 'flac',
 *       mimeType: 'audio/flac',
 *       lossless: true,
 *       licence: 'BSD-3-Clause',
 *       encode: async (buffer, options) => new Blob([...])
 *   });
 */

import { encodeWavBlob } from './wav.js';
import { encodeAiffBlob, BIT_DEPTHS as AIFF_BIT_DEPTHS } from './aiff.js';

/**
 * @typedef {object} Encoder
 * @property {string} format      the key the interface asks for
 * @property {string} name        what to show in a menu
 * @property {string} extension
 * @property {string} mimeType
 * @property {boolean} lossless
 * @property {string} licence     the licence of the encoder itself
 * @property {(buffer: AudioBuffer, options?: object) => Promise<Blob>|Blob} encode
 */

/** @type {Map<string, Encoder>} */
const encoders = new Map();

/** @param {Encoder} encoder */
export function registerEncoder(encoder) {
    for (const field of ['format', 'extension', 'mimeType', 'encode']) {
        if (!encoder?.[field]) throw new TypeError(`An encoder needs a ${field}`);
    }
    encoders.set(encoder.format, {
        name: encoder.format.toUpperCase(),
        lossless: false,
        licence: 'unknown',
        ...encoder
    });
    return encoder.format;
}

/** Remove an encoder. Mostly for tests and for builds that strip a format. */
export function unregisterEncoder(format) {
    return encoders.delete(format);
}

/** @returns {Encoder|null} */
export function getEncoder(format) {
    return encoders.get(format) ?? null;
}

export function hasEncoder(format) {
    return encoders.has(format);
}

/** @returns {Encoder[]} every format this build can write */
export function listEncoders() {
    return [...encoders.values()];
}

/**
 * Encode a rendered buffer.
 *
 * @param {AudioBuffer} buffer
 * @param {string} format
 * @param {object} [options]  passed through: bitDepth, bitrate, quality…
 * @returns {Promise<{blob: Blob, extension: string}>}
 */
export async function encodeAudio(buffer, format, options = {}) {
    const encoder = getEncoder(format);
    if (!encoder) {
        const available = listEncoders()
            .map((item) => item.format)
            .join(', ');
        throw new Error(`No encoder for "${format}". This build has: ${available}`);
    }

    const blob = await encoder.encode(buffer, options);
    return { blob, extension: encoder.extension };
}

// ── Built in: the two the studio writes itself ───────────────────────────
//
// Neither needs a library, so neither is a module that registers itself:
// there is no licence and no download to weigh, and a build has no reason
// to want one of them gone.

registerEncoder({
    format: 'wav',
    name: 'WAV',
    extension: 'wav',
    mimeType: 'audio/wav',
    lossless: true,
    licence: 'AGPL-3.0-or-later',
    encode: (buffer, { bitDepth = 16 } = {}) => encodeWavBlob(buffer, bitDepth)
});

registerEncoder({
    format: 'aiff',
    name: 'AIFF',
    extension: 'aiff',
    mimeType: 'audio/aiff',
    lossless: true,
    licence: 'AGPL-3.0-or-later',
    // The same samples a WAV would hold, so the same choice of depth: minus
    // 32-bit float, which AIFF cannot carry without becoming AIFF-C.
    bitDepths: AIFF_BIT_DEPTHS,
    // Asked for a depth it cannot hold, it says so rather than quietly
    // writing a different file from the one that was chosen.
    encode: (buffer, { bitDepth = 16 } = {}) => encodeAiffBlob(buffer, bitDepth)
});
