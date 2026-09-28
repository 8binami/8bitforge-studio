/**
 * What the studio asks FFmpeg for.
 *
 * The encoding itself is thirty-two megabytes of WebAssembly and belongs in a
 * browser; what is testable here (and what actually goes wrong) is the
 * command line. An argument in the wrong place does not fail loudly: FFmpeg
 * ignores what it does not understand and writes a file at some other
 * bitrate, in some other codec, and the only sign is a size that looks a
 * little off.
 */

import { describe, it, expect } from 'vitest';
import { ARGUMENTS } from '../src/export/ffmpeg-encoders.js';
import { listEncoders, getEncoder } from '../src/export/encoders.js';

describe('the arguments', () => {
    it('asks for a constant bitrate when VBR is off', () => {
        expect(ARGUMENTS.mp3({ bitrate: 192 })).toEqual(['-c:a', 'libmp3lame', '-b:a', '192k']);
        expect(ARGUMENTS.mp3({ bitrate: 128, vbr: false })).toEqual([
            '-c:a',
            'libmp3lame',
            '-b:a',
            '128k'
        ]);
    });

    it('asks for a quality instead when VBR is on', () => {
        // `-b:a` and `-q:a` are different questions. Sending both, or the
        // wrong one, is how a 320 kbps export comes out at LAME's default.
        const highest = ARGUMENTS.mp3({ bitrate: 320, vbr: true });

        expect(highest).toEqual(['-c:a', 'libmp3lame', '-q:a', '0']);
        expect(highest).not.toContain('-b:a');
    });

    it('keeps the VBR scale the right way up', () => {
        // LAME counts down: 0 is the best quality, 9 the worst. Reading it
        // as a percentage would turn the best setting into the worst.
        const quality = (bitrate) => Number(ARGUMENTS.mp3({ bitrate, vbr: true })[3]);

        expect(quality(320)).toBeLessThan(quality(256));
        expect(quality(256)).toBeLessThan(quality(192));
        expect(quality(192)).toBeLessThan(quality(128));
    });

    it('falls back to the best VBR setting for a bitrate it does not know', () => {
        expect(ARGUMENTS.mp3({ bitrate: 999, vbr: true })).toEqual([
            '-c:a',
            'libmp3lame',
            '-q:a',
            '0'
        ]);
    });

    it('asks Vorbis for a quality, not a bitrate', () => {
        expect(ARGUMENTS.ogg({ quality: 6 })).toEqual(['-c:a', 'libvorbis', '-q:a', '6']);
        expect(ARGUMENTS.ogg()).toEqual(['-c:a', 'libvorbis', '-q:a', '8']);
    });

    it('leaves the sample rate alone unless one was chosen', () => {
        // `-ar` with nothing behind it resamples to FFmpeg's idea of a
        // default, which is not what "leave it as it is" means.
        expect(ARGUMENTS.flac({})).not.toContain('-ar');
        expect(ARGUMENTS.flac({ sampleRate: 48000 })).toEqual([
            '-c:a',
            'flac',
            '-compression_level',
            '8',
            '-ar',
            '48000'
        ]);
    });

    it('spells every option as its own argument', () => {
        // `['-b:a 192k']` is one argument containing a space, and FFmpeg
        // reads it as a filename.
        for (const build of Object.values(ARGUMENTS)) {
            for (const argument of build({ bitrate: 192, quality: 5, sampleRate: 48000 })) {
                expect(argument, argument).not.toMatch(/\s/);
            }
        }
    });
});

describe('the three formats it registers', () => {
    it('joins the two the studio writes itself', () => {
        expect(listEncoders().map((encoder) => encoder.format)).toEqual([
            'wav',
            'aiff',
            'mp3',
            'flac',
            'ogg'
        ]);
    });

    it('says which of them keep everything and which do not', () => {
        // The window reads this to decide what to call a format, and an
        // export window that calls an MP3 lossless is a window that lies.
        expect(getEncoder('flac').lossless).toBe(true);
        expect(getEncoder('mp3').lossless).toBe(false);
        expect(getEncoder('ogg').lossless).toBe(false);
    });

    it('carries the licence each one is under', () => {
        // Not decoration: `docs/licensing.md` is only true if this is.
        for (const format of ['mp3', 'flac', 'ogg']) {
            expect(getEncoder(format).licence, format).toBe('GPL-2.0-or-later');
        }
        for (const format of ['wav', 'aiff']) {
            expect(getEncoder(format).licence, format).toBe('AGPL-3.0-or-later');
        }
    });
});
