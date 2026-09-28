/**
 * MP3, FLAC and OGG, through FFmpeg.
 *
 * WAV and AIFF the studio writes itself, because uncompressed PCM is a header
 * and the samples. The compressed formats are not that: a usable MP3 encoder
 * is a psychoacoustic model, and writing one to save a download would be a
 * worse use of a year than any other in this repository.
 *
 * So this registers the three, and asks FFmpeg. One dependency with a known
 * provenance rather than three small ones, which is the trade the project's
 * licence made possible: see `docs/licensing.md`. The build is GPL, which
 * could not have been shipped while the studio was MIT and combines with the
 * AGPL without trouble.
 *
 * **Nothing here is downloaded until it is used.** The core is thirty-two
 * megabytes of WebAssembly for four audio codecs, so it is not in the bundle
 * and not fetched at startup: the first compressed export loads it, the
 * browser caches it, and anyone who only ever exports WAV never sees it.
 * That is why `load()` is behind a promise that is kept: a second export
 * waits for the first one's core rather than starting another.
 *
 * The input handed to FFmpeg is a 32-bit float WAV. It is the widest thing
 * `wav.js` writes and it is exactly what the renderer produced, so nothing is
 * rounded on the way in and the only loss is the one that was asked for.
 */

import { registerEncoder } from './encoders.js';
import { encodeWav } from './wav.js';

// Vite turns these into URLs of files it emits; importing them costs a string
// each. The bytes travel only when something asks for them.
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';

/**
 * The worker the wrapper talks to.
 *
 * It would find its own, by resolving a path against its module's URL: but
 * that module has been through a bundler by then, and the file it looks for
 * is not beside it any more. `?worker&url` asks Vite to build the worker and
 * its imports into one file and hand back where it put it, which is true in
 * development and after a build alike.
 */
import workerURL from '@ffmpeg/ffmpeg/worker?worker&url';

/** The one instance, and the promise that is making it. */
let starting = null;

/**
 * LAME's variable-bitrate scale runs 0 (best) to 9, and the window offers
 * constant bitrates. These are the settings that land nearest each one.
 */
const VBR_FOR_BITRATE = Object.freeze({ 320: 0, 256: 2, 192: 4, 128: 6 });

/** What the studio renders at, when nothing says otherwise. */
const DEFAULT_BITRATE = 320;
const DEFAULT_OGG_QUALITY = 8;
const DEFAULT_FLAC_LEVEL = 8;

/**
 * FFmpeg, loaded and ready. The first caller waits for the core to arrive;
 * everyone after that gets the same instance.
 *
 * @returns {Promise<import('@ffmpeg/ffmpeg').FFmpeg>}
 */
export function loadFFmpeg() {
    if (!starting) {
        starting = start().catch((reason) => {
            // A failed load must not poison every later attempt: somebody
            // who was offline when they first pressed Export should be able
            // to press it again.
            starting = null;
            throw reason;
        });
    }
    return starting;
}

async function start() {
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    const instance = new FFmpeg();
    await instance.load({ coreURL, wasmURL, classWorkerURL: workerURL });
    return instance;
}

/** Whether the core has already been fetched, for anything that wants to say so. */
export function ffmpegIsLoaded() {
    return starting !== null;
}

/**
 * Run one file through FFmpeg and read the result back.
 *
 * The files are written to and deleted from FFmpeg's own in-memory
 * filesystem, which outlives the call: leaving a hundred megabytes of
 * exported stems in there is a leak that only shows up on the long session
 * it ruins.
 *
 * @param {AudioBuffer} buffer
 * @param {string[]} args       what to do with it, minus input and output
 * @param {string} extension
 * @param {string} mimeType
 * @returns {Promise<Blob>}
 */
async function transcode(buffer, args, extension, mimeType) {
    const ffmpeg = await loadFFmpeg();

    // Named for this call: two exports running at once must not meet.
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const input = `in-${stamp}.wav`;
    const output = `out-${stamp}.${extension}`;

    try {
        await ffmpeg.writeFile(input, new Uint8Array(encodeWav(buffer, 32)));

        const code = await ffmpeg.exec(['-i', input, ...args, output]);
        if (code !== 0) throw new Error(`FFmpeg refused to write the ${extension} (${code})`);

        const data = await ffmpeg.readFile(output);
        return new Blob([data], { type: mimeType });
    } finally {
        // Both, whatever happened: a failed run still wrote the input.
        for (const name of [input, output]) {
            await ffmpeg.deleteFile(name).catch(() => {});
        }
    }
}

/**
 * The arguments for a format, kept apart from the running of them so they
 * can be read (and tested) without thirty-two megabytes of WebAssembly.
 */
export const ARGUMENTS = Object.freeze({
    /** @param {{bitrate?: number, vbr?: boolean}} options */
    mp3: ({ bitrate = DEFAULT_BITRATE, vbr = false } = {}) => [
        '-c:a',
        'libmp3lame',
        ...(vbr
            ? ['-q:a', String(VBR_FOR_BITRATE[bitrate] ?? VBR_FOR_BITRATE[DEFAULT_BITRATE])]
            : ['-b:a', `${bitrate}k`])
    ],

    /**
     * FLAC's compression level changes how long it takes and how small it
     * gets, never what comes back out: 8 is the slowest and smallest, and on
     * a few minutes of chiptune the difference in time is not noticeable.
     *
     * @param {{sampleRate?: number, level?: number}} options
     */
    flac: ({ sampleRate = 0, level = DEFAULT_FLAC_LEVEL } = {}) => [
        '-c:a',
        'flac',
        '-compression_level',
        String(level),
        ...(sampleRate ? ['-ar', String(sampleRate)] : [])
    ],

    /** @param {{quality?: number}} options */
    ogg: ({ quality = DEFAULT_OGG_QUALITY } = {}) => ['-c:a', 'libvorbis', '-q:a', String(quality)]
});

registerEncoder({
    format: 'mp3',
    name: 'MP3',
    extension: 'mp3',
    mimeType: 'audio/mpeg',
    lossless: false,
    licence: 'GPL-2.0-or-later',
    encode: (buffer, options) => transcode(buffer, ARGUMENTS.mp3(options), 'mp3', 'audio/mpeg')
});

registerEncoder({
    format: 'flac',
    name: 'FLAC',
    extension: 'flac',
    mimeType: 'audio/flac',
    lossless: true,
    licence: 'GPL-2.0-or-later',
    encode: (buffer, options) => transcode(buffer, ARGUMENTS.flac(options), 'flac', 'audio/flac')
});

registerEncoder({
    format: 'ogg',
    name: 'OGG',
    extension: 'ogg',
    mimeType: 'audio/ogg',
    lossless: false,
    licence: 'GPL-2.0-or-later',
    encode: (buffer, options) => transcode(buffer, ARGUMENTS.ogg(options), 'ogg', 'audio/ogg')
});
