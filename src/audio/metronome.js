/**
 * The metronome.
 *
 * A short sine click on every beat, higher and louder on the first beat of
 * the bar so you can hear where you are rather than only how fast you are
 * going. It is a fixed sound with no controls, which is the point: it is a
 * ruler, not an instrument.
 *
 * It runs on its own gain straight into the output, around the master bus.
 * A click that went through the master would be pulled down by the master
 * fader, shaped by the mastering EQ and printed into anything exported: and
 * the one thing a metronome must never do is end up in the file.
 *
 * Each click is booked at the audio time of the step it belongs to, which is
 * how every note is booked. The original plays it from the display path at
 * `currentTime`, so it sounds the scheduler's lookahead late: up to a tenth
 * of a second behind a beat it is supposed to define.
 */

/** Steps to a beat: the grid is sixteenths. */
const STEPS_PER_BEAT = 4;

/** Beats to a bar, for deciding which click is the loud one. */
const BEATS_PER_BAR = 4;

/** How loud the whole thing is, against the studio it plays over. */
const LEVEL = 0.3;

/** The two clicks: the downbeat, and the rest. */
const DOWNBEAT = { frequency: 1000, gain: 0.4, seconds: 0.06 };
const BEAT = { frequency: 800, gain: 0.25, seconds: 0.04 };

/** A click is over well before this; the oscillator is stopped here. */
const TAIL_SECONDS = 0.08;

export class Metronome {
    /**
     * @param {import('./audio-engine.js').AudioEngine} audioEngine
     */
    constructor(audioEngine) {
        this.audioEngine = audioEngine;
        this.enabled = false;

        this._gain = null;
    }

    /** @returns {boolean} whether it is now on */
    toggle() {
        this.enabled = !this.enabled;
        return this.enabled;
    }

    /**
     * Click, if this step is a beat.
     *
     * @param {number} step  the step within the pattern
     * @param {number} time  when that step is heard, on the audio clock
     */
    onStep(step, time) {
        if (!this.enabled || step % STEPS_PER_BEAT !== 0) return;

        const context = this.audioEngine.audioContext;
        // A suspended context books the click for a moment that never comes,
        // and they all arrive at once when it resumes.
        if (!context || context.state !== 'running') return;

        const gain = this._ensureGain(context);
        if (!gain) return;

        const first = step % (STEPS_PER_BEAT * BEATS_PER_BAR) === 0;
        const click = first ? DOWNBEAT : BEAT;

        // A click booked in the past is played now rather than dropped: it is
        // late either way, and silence reads as a broken metronome.
        const at = Math.max(time, context.currentTime);

        const envelope = context.createGain();
        envelope.gain.setValueAtTime(click.gain, at);
        // Exponentially, because a linear fade on a short click clicks twice.
        envelope.gain.exponentialRampToValueAtTime(0.001, at + click.seconds);

        const oscillator = context.createOscillator();
        oscillator.type = 'sine';
        oscillator.frequency.value = click.frequency;

        oscillator.connect(envelope);
        envelope.connect(gain);

        oscillator.start(at);
        oscillator.stop(at + TAIL_SECONDS);
    }

    /** Built on the first click: there is no context before the audio starts. */
    _ensureGain(context) {
        if (this._gain) return this._gain;

        this._gain = context.createGain();
        this._gain.gain.value = LEVEL;
        this._gain.connect(context.destination);
        return this._gain;
    }
}
