/**
 * Sequencer: eight patterns of eight tracks, and the clock that plays them.
 *
 * Timing comes from the Web Audio clock, not from setTimeout: a scheduler
 * wakes up every 25 ms and books every step that falls inside a 100 ms
 * lookahead window. Notes are therefore scheduled sample-accurately, ahead of
 * time, while the display is updated separately at the moment each step is
 * actually heard.
 *
 * This module holds no view. It announces what happened on the event bus and
 * the grid redraws itself:
 *
 *   sequencer:step             a step is being heard now
 *   sequencer:pattern-changed  the current pattern changed
 *   sequencer:cells-changed    pattern content changed
 *   sequencer:play / pause / stop
 */

import { bus as sharedBus } from '../core/event-bus.js';
import { AudioEngine } from '../audio/audio-engine.js';

export const SEQUENCER_EVENTS = Object.freeze({
    step: 'sequencer:step',
    play: 'sequencer:play',
    pause: 'sequencer:pause',
    stop: 'sequencer:stop',
    /**
     * A step has been booked, with the audio time it will be heard at and
     * the measure of the chain it belongs to. Anything that has to sound
     * *with* a step rather than react to one listens here: by the time
     * `step` is announced, that moment has come. So does the playhead, for
     * which two consecutive bookings are the span it has to cross.
     */
    scheduled: 'sequencer:scheduled',
    patternChanged: 'sequencer:pattern-changed',
    cellsChanged: 'sequencer:cells-changed',
    tempoChanged: 'sequencer:tempo-changed',
    stepsChanged: 'sequencer:steps-changed'
});

export const PATTERN_COUNT = 8;
export const TRACK_COUNT = 8;
/** Steps are stored at full length whatever the pattern length in use. */
export const MAX_STEPS = 32;

/**
 * The note a cell gets when it is switched on with nothing else to go by.
 * Bass sits low, the kick at C2 so its pitch envelope sweeps down from ~523 Hz,
 * and the noise tracks take a nominal pitch that does not change their sound.
 */
export const TRACK_DEFAULT_NOTES = [
    { note: 'C', octave: 4 }, // 0 lead
    { note: 'C', octave: 4 }, // 1 harmony
    { note: 'C', octave: 2 }, // 2 bass
    { note: 'C', octave: 4 }, // 3 arp
    { note: 'C', octave: 2 }, // 4 kick
    { note: 'C', octave: 3 }, // 5 snare
    { note: 'C', octave: 5 }, // 6 hi-hat
    { note: 'C', octave: 4 } // 7 fx
];

const MIN_BPM = 20;
const MAX_BPM = 300;

export class Sequencer {
    /**
     * @param {import('../audio/audio-engine.js').AudioEngine} audioEngine
     * @param {object} [options]
     * @param {import('../core/event-bus.js').EventBus} [options.bus]
     * @param {object|null} [options.arrangement]  pattern chain, attachable later
     */
    constructor(audioEngine, { bus = sharedBus, arrangement = null } = {}) {
        this.audioEngine = audioEngine;
        this._bus = bus;
        this.arrangement = arrangement;

        this.bpm = 120;
        this.steps = 16;
        this.swing = 0;
        this.isLooping = true;

        this.isPlaying = false;
        this.isPaused = false;
        this.currentStep = 0;
        this.currentPattern = 0;

        /**
         * Last note played, whatever played it. When set, switching a cell
         * on uses it instead of the track default. Written through
         * `rememberNote`, which the interface calls for every note the
         * keyboard, the mouse or MIDI announces.
         * @type {{note: string, octave: number}|null}
         */
        this.lastPlayedNote = null;

        this.patterns = emptyPatterns();
        this.trackStates = emptyTrackStates();

        // Lookahead scheduling
        this.scheduleAheadTime = 0.1; // seconds booked in advance
        this.schedulerInterval = 25; // milliseconds between wake-ups
        this._schedulerTimer = null;
        this._nextStepTime = 0;
        this._pausedAtStep = 0;
        /** True while booking ahead, so pattern switches do not redraw early. */
        this._scheduling = false;

        /** Audio time of the step currently being heard, for the playhead. */
        this.displayStep = 0;
        this.displayStepAudioTime = 0;
        this.playStartAudioTime = 0;
        this.nextLoopAudioTime = undefined;

        // Notes used when randomising a melodic track
        this.scale = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
        this.octaves = [2, 3, 4, 5];
    }

    // ── Cells ────────────────────────────────────────────────────────────

    /** @returns {{note: string, octave: number}|null} */
    getCell(track, step, patternIndex = this.currentPattern) {
        return this.patterns[patternIndex]?.[track]?.[step] ?? null;
    }

    /**
     * Remember a note that was just played, so the next cell switched on
     * takes it. Passing nothing forgets, and the track default comes back.
     *
     * @param {string|null} note  'C', 'F#', ...
     * @param {number} [octave]
     */
    rememberNote(note, octave) {
        this.lastPlayedNote = note ? { note, octave } : null;
    }

    /**
     * Switch a cell on or off. A cell being switched on takes the last note
     * played on the keyboard, or the track's default.
     */
    toggleCell(track, step) {
        const pattern = this.patterns[this.currentPattern];
        if (!pattern?.[track]) return;

        if (pattern[track][step]) {
            pattern[track][step] = null;
        } else {
            const source = this.lastPlayedNote || TRACK_DEFAULT_NOTES[track];
            pattern[track][step] = { note: source.note, octave: source.octave };
        }
        this._announceCells(track);
    }

    /** Set or clear a cell. Passing no note clears it. */
    setCell(track, step, note, octave) {
        const pattern = this.patterns[this.currentPattern];
        if (!pattern?.[track]) return;

        pattern[track][step] = note && octave ? { note, octave } : null;
        this._announceCells(track);
    }

    clearTrack(track, patternIndex = this.currentPattern) {
        // Replace the array rather than blanking the visible steps: a pattern
        // shortened from 32 to 16 still holds notes past the end.
        this.patterns[patternIndex][track] = new Array(MAX_STEPS).fill(null);
        this._announceCells(track);
    }

    clearAll() {
        for (let track = 0; track < TRACK_COUNT; track++) {
            this.patterns[this.currentPattern][track] = new Array(MAX_STEPS).fill(null);
        }
        this._announceCells();
    }

    clearPattern(patternIndex = this.currentPattern) {
        for (let track = 0; track < TRACK_COUNT; track++) {
            this.patterns[patternIndex][track] = new Array(MAX_STEPS).fill(null);
            this.trackStates[patternIndex][track] = { solo: false, mute: false };
        }
        this._announceCells();
    }

    /** @returns {Array<{note: string, octave: number}|null>} a copy of the track */
    copyTrack(track) {
        return this.patterns[this.currentPattern][track].map((cell) => (cell ? { ...cell } : null));
    }

    /** @param {Array<{note: string, octave: number}|null>} cells */
    pasteTrack(track, cells) {
        const target = new Array(MAX_STEPS).fill(null);
        cells.slice(0, MAX_STEPS).forEach((cell, index) => {
            target[index] = cell ? { ...cell } : null;
        });
        this.patterns[this.currentPattern][track] = target;
        this._announceCells(track);
    }

    /** Fill a track with a plausible random rhythm. Drums keep a fixed pitch. */
    randomizeTrack(track) {
        const isDrum = track >= 4 && track <= 6;
        const density = isDrum ? 0.35 : 0.3;

        for (let step = 0; step < this.steps; step++) {
            if (Math.random() >= density) {
                this.setCell(track, step, null, null);
                continue;
            }
            if (isDrum) {
                const { note, octave } = TRACK_DEFAULT_NOTES[track];
                this.setCell(track, step, note, octave);
            } else {
                const note = this.scale[Math.floor(Math.random() * this.scale.length)];
                const octave = this.octaves[Math.floor(Math.random() * this.octaves.length)];
                this.setCell(track, step, note, octave);
            }
        }
    }

    // ── Patterns ─────────────────────────────────────────────────────────

    switchPattern(patternIndex) {
        if (patternIndex < 0 || patternIndex >= PATTERN_COUNT) return;
        this.currentPattern = patternIndex;

        // While booking ahead, the switch is announced later by the step that
        // actually reaches the speakers: otherwise the grid jumps early.
        if (!this._scheduling) {
            this._bus.emit(SEQUENCER_EVENTS.patternChanged, { pattern: patternIndex });
        }
    }

    duplicatePattern(sourceIndex, targetIndex) {
        if (!isPatternIndex(sourceIndex) || !isPatternIndex(targetIndex)) return false;

        for (let track = 0; track < TRACK_COUNT; track++) {
            this.patterns[targetIndex][track] = this.patterns[sourceIndex][track].map((cell) =>
                cell ? { ...cell } : null
            );
            this.trackStates[targetIndex][track] = { ...this.trackStates[sourceIndex][track] };
        }
        this._announceCells();
        return true;
    }

    /** True when the pattern holds at least one note. */
    patternHasContent(patternIndex) {
        return this.patterns[patternIndex].some((track) => track.some((cell) => cell !== null));
    }

    // ── Transport ────────────────────────────────────────────────────────

    setBPM(bpm) {
        // The scheduler reads bpm on its next wake-up, so no restart is needed.
        this.bpm = Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm)));
        this._bus.emit(SEQUENCER_EVENTS.tempoChanged, this.bpm);
        return this.bpm;
    }

    /** @param {number} swing 0..1, how far the off-beats are pushed back */
    setSwing(swing) {
        this.swing = Math.min(1, Math.max(0, swing));
    }

    /** @param {number} steps pattern length, 1..32 */
    setSteps(steps) {
        this.steps = Math.min(MAX_STEPS, Math.max(1, Math.round(steps)));
        this._bus.emit(SEQUENCER_EVENTS.stepsChanged, this.steps);
        this._announceCells();
        return this.steps;
    }

    toggleLoop() {
        this.isLooping = !this.isLooping;
        return this.isLooping;
    }

    play() {
        if (this.isPlaying) return;
        this.isPlaying = true;

        if (this.isPaused) {
            this.isPaused = false;
            this.currentStep = this._pausedAtStep;
        } else {
            this.currentStep = 0;
        }
        this.displayStep = this.currentStep;

        // One reading of the clock: the playhead animation and the scheduler
        // must start from the exact same instant or they drift apart.
        const startTime = this.audioEngine.audioContext.currentTime;
        this.playStartAudioTime = startTime;
        this.nextLoopAudioTime = undefined;
        this._nextStepTime = startTime;

        this._scheduler();
        this._bus.emit(SEQUENCER_EVENTS.play);
    }

    pause() {
        if (!this.isPlaying) return;
        this.isPaused = true;
        this._pausedAtStep = this.currentStep;
        this.isPlaying = false;
        this._stopScheduler();
        this._bus.emit(SEQUENCER_EVENTS.pause, { step: this._pausedAtStep });
    }

    stop() {
        this.isPlaying = false;
        this.isPaused = false;
        this._pausedAtStep = 0;
        this.currentStep = 0;
        this._stopScheduler();
        this.arrangement?.resetPlayback?.();
        this._bus.emit(SEQUENCER_EVENTS.stop);
    }

    // ── Solo and mute, per pattern ───────────────────────────────────────

    toggleSolo(track) {
        const state = this.trackStates[this.currentPattern][track];
        state.solo = !state.solo;
        return state.solo;
    }

    toggleMute(track) {
        const state = this.trackStates[this.currentPattern][track];
        state.mute = !state.mute;
        return state.mute;
    }

    getTrackStates(patternIndex = this.currentPattern) {
        return this.trackStates[patternIndex];
    }

    /**
     * Whether a track is heard, given the per-pattern solo/mute of the
     * sequencer and the global solo/mute of the mixer. The mixer wins: a
     * global solo silences everything else, whatever the pattern says.
     */
    isTrackAudible(track, patternIndex = this.currentPattern) {
        const mixer = this.audioEngine.mixerSettings;
        if (mixer[track].mute) return false;

        const hasGlobalSolo = mixer.some((strip) => strip.solo);
        if (hasGlobalSolo) return Boolean(mixer[track].solo);

        const states = this.trackStates[patternIndex];
        if (states[track].mute) return false;

        const hasSolo = states.some((state) => state.solo);
        return !hasSolo || states[track].solo;
    }

    // ── Persistence ──────────────────────────────────────────────────────

    getState() {
        return {
            bpm: this.bpm,
            steps: this.steps,
            swing: this.swing,
            currentPattern: this.currentPattern,
            patterns: this.patterns.map((pattern) =>
                pattern.map((track) => track.map((cell) => (cell ? { ...cell } : null)))
            ),
            trackStates: this.trackStates.map((pattern) => pattern.map((state) => ({ ...state })))
        };
    }

    setState(state) {
        if (!state) return;

        this.bpm = state.bpm || 120;
        this.steps = state.steps || 16;
        this.swing = state.swing || 0;
        this.currentPattern = state.currentPattern || 0;

        this.patterns = emptyPatterns();
        if (Array.isArray(state.patterns)) {
            if (Array.isArray(state.patterns[0]?.[0])) {
                // Current layout: patterns[pattern][track][step]
                state.patterns.forEach((pattern, p) => {
                    if (p >= PATTERN_COUNT) return;
                    pattern.forEach((track, t) => {
                        if (t >= TRACK_COUNT) return;
                        this.patterns[p][t] = padTrack(track);
                    });
                });
            } else {
                // 1.x layout: a single pattern, patterns[track][step]
                state.patterns.forEach((track, t) => {
                    if (t < TRACK_COUNT) this.patterns[0][t] = padTrack(track);
                });
            }
        }

        // Rebuilt from scratch so nothing bleeds through from the last project.
        this.trackStates = emptyTrackStates();
        if (Array.isArray(state.trackStates)) {
            const perPattern = Array.isArray(state.trackStates[0]);
            if (perPattern) {
                state.trackStates.forEach((pattern, p) => {
                    if (p >= PATTERN_COUNT) return;
                    pattern.forEach((st, t) => {
                        if (t < TRACK_COUNT) this.trackStates[p][t] = { ...st };
                    });
                });
            } else if (state.trackStates[0] && 'solo' in state.trackStates[0]) {
                // 1.x layout: one flat set of states, shared by every pattern
                for (let p = 0; p < PATTERN_COUNT; p++) {
                    for (let t = 0; t < TRACK_COUNT; t++) {
                        this.trackStates[p][t] = { ...state.trackStates[t] };
                    }
                }
            }
        }

        this._bus.emit(SEQUENCER_EVENTS.patternChanged, { pattern: this.currentPattern });
        this._announceCells();
    }

    // ── Scheduling ───────────────────────────────────────────────────────

    _stopScheduler() {
        if (this._schedulerTimer) {
            clearTimeout(this._schedulerTimer);
            this._schedulerTimer = null;
        }
    }

    _scheduler() {
        if (!this.isPlaying) return;
        const ctx = this.audioEngine.audioContext;

        while (this.isPlaying && this._nextStepTime < ctx.currentTime + this.scheduleAheadTime) {
            this._scheduleStep(this.currentStep, this._nextStepTime);
            // The arrangement may have reached its end and stopped playback.
            if (!this.isPlaying) break;
            this._advanceStep();
        }

        if (this.isPlaying) {
            this._schedulerTimer = setTimeout(() => this._scheduler(), this.schedulerInterval);
        }
    }

    _scheduleStep(stepIndex, time) {
        let patternSwitched = false;

        if (this.arrangement) {
            this._scheduling = true;
            const previousPattern = this.currentPattern;
            this.arrangement.onStep(stepIndex);
            this._scheduling = false;
            if (!this.isPlaying) return;
            patternSwitched = this.currentPattern !== previousPattern;
        }

        const chainIndex = this.arrangement?.currentChainIndex ?? 0;

        // Announced once the chain has moved, so the measure named here is
        // the one this step belongs to rather than the one before it.
        this._bus.emit(SEQUENCER_EVENTS.scheduled, { step: stepIndex, time, chainIndex });

        // An empty measure in the chain is silent, but still moves the display.
        if (this.arrangement?.enabled && this.arrangement.chain?.length > 0) {
            const chained = this.arrangement.getCurrentPattern();
            if (chained === null || chained === undefined) {
                this._scheduleVisual(stepIndex, time, [], patternSwitched, chainIndex);
                return;
            }
        }

        const pattern = this.patterns[this.currentPattern];
        const duration = (60 / this.bpm) * 0.9; // a touch short, so notes separate
        const playedTracks = [];

        for (let track = 0; track < TRACK_COUNT; track++) {
            if (!this.isTrackAudible(track)) continue;

            const cell = pattern[track][stepIndex];
            if (!cell) continue;

            const frequency = AudioEngine.noteToFrequency(cell.note, cell.octave);
            this.audioEngine.playNote(frequency, track, duration, time);
            playedTracks.push(track);
        }

        this._scheduleVisual(stepIndex, time, playedTracks, patternSwitched, chainIndex);
    }

    /** Announce a step at the moment it is heard, not when it was booked. */
    _scheduleVisual(stepIndex, time, playedTracks, patternSwitched, chainIndex) {
        const ctx = this.audioEngine.audioContext;
        const delay = Math.max(0, (time - ctx.currentTime) * 1000);

        setTimeout(() => {
            if (!this.isPlaying) return;

            this.displayStep = stepIndex;
            this.displayStepAudioTime = time;

            if (patternSwitched) {
                // Carries the chain index, so the arrangement view can follow
                // along without a callback of its own.
                this._bus.emit(SEQUENCER_EVENTS.patternChanged, {
                    pattern: this.currentPattern,
                    chainIndex
                });
            }

            this._bus.emit(SEQUENCER_EVENTS.step, {
                step: stepIndex,
                time,
                playedTracks,
                pattern: this.currentPattern,
                chainIndex
            });
        }, delay);
    }

    _advanceStep() {
        // Steps are sixteenth notes. Swing delays the odd ones by taking the
        // time from the even ones, so a bar still lasts exactly as long.
        const stepDuration = 60 / this.bpm / 4;
        const swing = Math.min(1, Math.max(0, this.swing || 0));
        const isOdd = this.currentStep % 2 === 1;
        this._nextStepTime += stepDuration * (isOdd ? 1 - swing * 0.5 : 1 + swing * 0.5);

        this.currentStep++;
        if (this.currentStep < this.steps) return;

        const arrangementActive = Boolean(
            this.arrangement?.enabled && this.arrangement.chain?.length > 0
        );
        if (arrangementActive || this.isLooping) {
            this.currentStep = 0;
            // Exact audio time of the next loop, read synchronously so the
            // playhead animation can switch over without drifting.
            this.nextLoopAudioTime = this._nextStepTime;
        } else {
            this.stop();
        }
    }

    _announceCells(track) {
        this._bus.emit(SEQUENCER_EVENTS.cellsChanged, {
            pattern: this.currentPattern,
            track: track ?? null
        });
    }
}

function emptyPatterns() {
    return Array.from({ length: PATTERN_COUNT }, () =>
        Array.from({ length: TRACK_COUNT }, () => new Array(MAX_STEPS).fill(null))
    );
}

function emptyTrackStates() {
    return Array.from({ length: PATTERN_COUNT }, () =>
        Array.from({ length: TRACK_COUNT }, () => ({ solo: false, mute: false }))
    );
}

/** Copy a saved track into a full-length array. */
function padTrack(track) {
    const cells = new Array(MAX_STEPS).fill(null);
    if (!Array.isArray(track)) return cells;
    track.slice(0, MAX_STEPS).forEach((cell, index) => {
        cells[index] = cell ? { ...cell } : null;
    });
    return cells;
}

function isPatternIndex(value) {
    return Number.isInteger(value) && value >= 0 && value < PATTERN_COUNT;
}
