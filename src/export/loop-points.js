/**
 * Loop points: where, in samples, a game should loop an exported song.
 *
 * Game music often has an intro that plays once, then a part that repeats.
 * Leaving the loop to the engine by time (seconds) is not exact, and several
 * engines (RPG Maker, Godot among them) leave an audible gap at every round.
 * Written into the file instead, as sample positions, the loop is exact:
 *
 *   OGG and FLAC   LOOPSTART and LOOPLENGTH Vorbis comments, which RPG Maker
 *                  and several other engines and players read
 *   WAV            a `smpl` chunk, the loop that samplers and many engines read
 *
 * The loop starts at a measure of the arrangement (`loopStart`) and ends
 * where the song does. The render has no release tail when loop points are
 * written: the last sample of the file is the last sample of the loop.
 */

/**
 * @typedef {object} LoopPoints
 * @property {number} start   first sample of the loop
 * @property {number} length  how many samples it lasts, to the end of the file
 */

/**
 * The loop of a render, in samples.
 *
 * A measure seldom starts on a whole sample (at 150 BPM and 44.1 kHz, a
 * measure is 70 560 samples; at 133 BPM, 79 578.95…), so its start is
 * rounded to the nearest one: half a sample at most, 11 µs at 44.1 kHz.
 *
 * @param {object} song
 * @param {number} song.bpm
 * @param {number} song.steps          steps per measure (sixteenth notes)
 * @param {number} song.sampleRate
 * @param {number} song.frames         the render's length, in samples
 * @param {number} [song.loopStart]    the measure the loop starts at, 0-based
 * @returns {LoopPoints|null} null when there is nothing to loop
 */
export function loopPoints({ bpm, steps, sampleRate, frames, loopStart = 0 }) {
    if (!(frames > 0) || !(bpm > 0) || !(steps > 0) || !(sampleRate > 0)) return null;

    const measureSeconds = (steps * 60) / bpm / 4;
    const start = Math.round(Math.max(0, loopStart) * measureSeconds * sampleRate);
    // A loop start at or past the end would leave nothing to loop: the whole
    // song loops instead.
    if (start >= frames) return { start: 0, length: frames };
    return { start, length: frames - start };
}

/**
 * The same loop as Vorbis comments, for FFmpeg's `-metadata`.
 * @param {LoopPoints|null} loop
 * @returns {string[]}
 */
export function loopMetadataArguments(loop) {
    if (!loop) return [];
    return ['-metadata', `LOOPSTART=${loop.start}`, '-metadata', `LOOPLENGTH=${loop.length}`];
}
