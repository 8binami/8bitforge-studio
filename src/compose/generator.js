/**
 * Generator: procedural composition across the eight tracks.
 *
 * A genre and a mood pick the chord progressions, rhythms, phrase shapes and
 * instrument roles; chaos, complexity and density steer how far it strays.
 * The result is written straight into the sequencer's patterns.
 *
 * Everything runs off a seeded random number generator: the same seed with
 * the same parameters gives the same piece, which is what makes a generated
 * track something you can come back to rather than a one-off accident. Leave
 * the seed at 0 for a fresh piece each time; `lastSeed` reports what was used.
 *
 * It composes, it does not render: the drawing of the result belongs to the
 * interface, which refreshes on `generator:changed`.
 */

import { bus as sharedBus } from '../core/event-bus.js';

export const GENERATOR_EVENTS = Object.freeze({
    changed: 'generator:changed',
    generated: 'generator:generated'
});

import { shipped } from '../content/shipped.js';

export class Generator {
    /**
     * @param {import('../sequencer/sequencer.js').Sequencer} sequencer
     * @param {object} [options]
     * @param {import('../core/event-bus.js').EventBus} [options.bus]
     * @param {object|null} [options.patternPresets] drum preset library, optional
     */
    constructor(sequencer, { bus = sharedBus, patternPresets = null } = {}) {
        this.sequencer = sequencer;
        this._bus = bus;
        this.patternPresets = patternPresets;

        // === Parameters ===
        this.chaos = 50;
        this.complexity = 50;
        this.density = 50;
        this.octaveMin = 3;
        this.octaveMax = 4;
        this.rootKey = 'C';
        this.scaleType = 'major';
        this.genre = 'chiptune';
        this.mood = 'epic';
        this.swing = 0;
        this.humanize = 0;
        this.phraseLength = 8;
        this.seed = 0;
        this._rng = null;
        this._lastSeed = 0; // actual seed used in last generation (readable after gen)
        this._motif = null; // shared motif seed (Phase 3.5)
        this._sharedProg = null; // shared chord progression (multi-pattern mode)
    }

    // =========================================
    // Setters
    // =========================================
    setChaos(v) {
        this.chaos = v;
    }
    setComplexity(v) {
        this.complexity = v;
    }
    setDensity(v) {
        this.density = v;
    }
    /**
     * The register melodies are written in, as a pair of octaves.
     *
     * The two are ordered here rather than trusted: they come from two
     * independent controls, and nothing stops the low one being set
     * above the high one. `_clamp(v, lo, hi)` with lo above hi pins
     * every note to lo, which is silent and wrong.
     *
     * A value that is not a number is refused outright and the last
     * good range kept. One NaN here reaches the octave of every note
     * the generator writes, and nothing downstream would say so.
     */
    setNoteRange(a, b) {
        const lo = Number(a);
        const hi = Number(b);
        if (!Number.isFinite(lo) || !Number.isFinite(hi)) return;

        this.octaveMin = Math.min(lo, hi);
        this.octaveMax = Math.max(lo, hi);
    }
    setRootKey(k) {
        this.rootKey = k;
    }
    setScaleType(t) {
        this.scaleType = t;
    }
    setGenre(g) {
        this.genre = g;
    }
    setMood(m) {
        this.mood = m;
    }
    setSwing(v) {
        this.swing = v;
    }
    setHumanize(v) {
        this.humanize = v;
    }
    setPhraseLength(v) {
        this.phraseLength = parseInt(v) || 8;
    }
    setSeed(s) {
        this.seed = Math.min(2147483647, Math.max(0, parseInt(s) || 0));
    }

    /**
     * The seed the last generation actually ran on. With `seed` left at 0 a
     * fresh one is drawn each time; this is how you get that piece back.
     */
    get lastSeed() {
        return this._lastSeed;
    }

    // =========================================
    // PRNG
    // =========================================
    static mulberry32(seed) {
        return function () {
            seed |= 0;
            seed = (seed + 0x6d2b79f5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    _initRng() {
        this._lastSeed = this.seed === 0 ? Math.floor(Math.random() * 2147483647) + 1 : this.seed;
        this._rng = Generator.mulberry32(this._lastSeed);
    }
    _random() {
        if (!this._rng) this._initRng();
        return this._rng();
    }
    _randomInt(max) {
        return Math.floor(this._random() * max);
    }
    _pick(arr) {
        return arr[this._randomInt(arr.length)];
    }
    _clamp(v, lo, hi) {
        return Math.max(lo, Math.min(hi, v));
    }

    // =========================================
    // Scale & Key, Phase 1.1: extended scales
    // =========================================
    static NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

    static SCALE_INTERVALS = {
        major: [0, 2, 4, 5, 7, 9, 11],
        minor: [0, 2, 3, 5, 7, 8, 10],
        dorian: [0, 2, 3, 5, 7, 9, 10],
        mixolydian: [0, 2, 4, 5, 7, 9, 10],
        pentatonic_major: [0, 2, 4, 7, 9],
        pentatonic_minor: [0, 3, 5, 7, 10],
        blues: [0, 3, 5, 6, 7, 10],
        harmonic_minor: [0, 2, 3, 5, 7, 8, 11],
        // Phase 1.1: new scales
        phrygian: [0, 1, 3, 5, 7, 8, 10],
        lydian: [0, 2, 4, 6, 7, 9, 11],
        whole_tone: [0, 2, 4, 6, 8, 10],
        hirajoshi: [0, 2, 3, 7, 8],
        hungarian_minor: [0, 2, 3, 6, 7, 8, 11],
        phrygian_dominant: [0, 1, 4, 5, 7, 8, 10],
        chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
    };

    getScale() {
        const intervals =
            Generator.SCALE_INTERVALS[this.scaleType] || Generator.SCALE_INTERVALS.major;
        const rootIndex = Generator.NOTES.indexOf(this.rootKey);
        return intervals.map((i) => Generator.NOTES[(rootIndex + i) % 12]);
    }

    _degreeToNote(scale, degree, baseOctave) {
        const len = scale.length;
        const octaveShift = Math.floor(degree / len);
        const idx = ((degree % len) + len) % len;
        return {
            note: scale[idx],
            octave: this._clamp(baseOctave + octaveShift, this.octaveMin, this.octaveMax)
        };
    }

    getOctaveForTrack(track) {
        const preferred = [4, 4, 2, 5, 1, 3, 5, 5][track] || 4;
        return this._clamp(preferred, this.octaveMin, this.octaveMax);
    }

    euclideanRhythm(pulses, steps) {
        const p = new Array(steps).fill(false);
        for (let i = 0; i < steps; i++) {
            if (
                i === 0 ||
                Math.floor((i * pulses) / steps) !== Math.floor(((i - 1) * pulses) / steps)
            )
                p[i] = true;
        }
        return p;
    }

    // =========================================
    // Phase 1.2: Motivic Transformations
    // =========================================

    /** Invert intervals: ascending becomes descending */
    _invertPhrase(phrase) {
        const anchor = phrase.find((d) => d !== null);
        if (anchor === undefined) return [...phrase];
        return phrase.map((d) => (d === null ? null : anchor - (d - anchor)));
    }

    /** Retrograde: read the phrase backwards */
    _retrogradePhrase(phrase) {
        return [...phrase].reverse();
    }

    /** Augment, stretch: notes every other step, nulls in between */
    _augmentPhrase(phrase) {
        const result = [];
        for (const deg of phrase) {
            result.push(deg);
            result.push(null);
        }
        return result.slice(0, phrase.length);
    }

    /** Diminish, compress: skip every other note */
    _diminishPhrase(phrase) {
        const result = [];
        for (let i = 0; i < phrase.length; i += 2) {
            result.push(phrase[i]);
        }
        while (result.length < phrase.length) result.push(null);
        return result;
    }

    // =========================================
    // Phase 3.5: Motif Seed System
    // =========================================

    /** Generate a short motif (4-6 degrees) as the musical DNA of the composition */
    _generateMotif() {
        const mood = this._mood();
        const len = 4 + this._randomInt(3); // 4-6 notes
        const motif = [];
        let degree = 0;
        motif.push(degree);

        for (let i = 1; i < len; i++) {
            const feel = mood.rhythmFeel;
            if (feel === 'driving') {
                degree += 1 + this._randomInt(3); // ascending tendency
            } else if (feel === 'sparse' || feel === 'laid-back') {
                degree += (this._random() < 0.5 ? 1 : -1) * (1 + this._randomInt(2));
            } else if (feel === 'bouncy') {
                degree += (this._random() < 0.6 ? 1 : -1) * (1 + this._randomInt(2));
            } else {
                degree += this._random() < 0.5 ? 1 : -1;
            }
            motif.push(degree);
        }
        return motif;
    }

    /** Ensure motif exists (create if needed) */
    _ensureMotif() {
        if (!this._motif) this._motif = this._generateMotif();
        return this._motif;
    }

    // =========================================
    // Phase 2.1: Tension Arc
    // =========================================

    /** Returns tension zone multipliers for a step position */
    _getTensionZone(step, totalSteps) {
        const pct = step / totalSteps;
        if (pct < 0.25) return { zone: 'intro', density: 0.6, chaos: 0.5, octaveBias: -1 };
        if (pct < 0.5) return { zone: 'build', density: 0.8, chaos: 0.8, octaveBias: 0 };
        if (pct < 0.75) return { zone: 'climax', density: 1.3, chaos: 1.2, octaveBias: 1 };
        return { zone: 'resolve', density: 0.7, chaos: 0.4, octaveBias: -1 };
    }

    // =========================================
    // PRE-COMPOSED PHRASE BANKS (Phase 3.1: variable lengths)
    // =========================================

    static MELODY_PHRASES = {
        epic: [
            [0, 2, 4, 7, 4, 2, 4, 0],
            [0, null, 4, 2, 4, 7, 4, null],
            [4, 4, 5, 4, 2, 0, 2, 4],
            [0, 2, 4, 2, 7, 4, 2, 0],
            [7, 4, 2, 4, 0, 2, 4, 7],
            [0, 0, 2, 4, 4, 2, 0, null],
            // Phase 3.1: variable length phrases
            [0, 4, 7, 4, 0], // 5-step fanfare
            [0, 2, 4, 7], // 4-step climb
            [7, 4, 0], // 3-step resolve
            [0, 2, 4, 7, 4, 2] // 6-step arch
        ],
        happy: [
            [0, 2, 4, 2, 0, 4, 2, 0],
            [0, 1, 2, 4, 2, 1, 0, null],
            [4, 2, 0, 2, 4, 4, 2, 0],
            [0, 2, 0, 4, 2, 4, 2, 0],
            [0, null, 2, null, 4, null, 2, 0],
            [2, 4, 2, 0, 2, 4, 7, 4],
            [0, 2, 4, 2, 0], // 5-step bounce
            [0, 4, 2, 0], // 4-step skip
            [0, 2, 4] // 3-step up
        ],
        dark: [
            [0, 1, 0, -1, 0, null, -1, null],
            [0, null, null, 1, 0, null, -1, 0],
            [4, 3, 2, 1, 0, null, null, null],
            [0, 3, 0, 1, 0, null, 3, 0],
            [0, null, 6, null, 0, null, 1, null],
            [0, -1, 0, 1, 0, -1, null, null],
            [0, 1, 0, -1, null], // 5-step creep
            [0, -1, 0, 1], // 4-step oscillation
            [0, 6, 0] // 3-step tritone
        ],
        atmospheric: [
            [0, null, 4, null, null, 2, null, null],
            [0, null, null, 7, null, null, 4, null],
            [4, null, null, null, 0, null, null, 2],
            [0, null, 2, null, 4, null, null, null],
            [7, null, null, 4, null, null, 0, null],
            [0, null, null, null, null, 4, null, null],
            [0, null, 4, null, null], // 5-step breath
            [0, null, null, 4] // 4-step drift
        ],
        melancholy: [
            [4, 3, 2, 0, -1, 0, null, null],
            [0, 2, 4, 3, 2, 0, null, -1],
            [2, 0, -1, 0, 2, 0, null, null],
            [0, 4, 3, 2, 0, null, -1, 0],
            [4, 2, 0, 2, 0, -1, 0, null],
            [0, 2, 3, 2, 0, null, null, 0],
            [4, 2, 0, -1, 0], // 5-step sigh
            [0, 2, 0, -1], // 4-step lament
            [4, 2, 0] // 3-step fall
        ],
        energetic: [
            [0, 2, 4, 0, 2, 4, 7, 4],
            [0, 4, 2, 4, 0, 4, 2, 0],
            [0, 0, 2, 2, 4, 4, 7, 7],
            [4, 2, 0, 4, 2, 0, 7, 4],
            [0, 2, 4, 2, 4, 7, 4, 2],
            [7, 4, 7, 4, 2, 0, 2, 4],
            [0, 2, 4, 7, 4], // 5-step burst
            [0, 4, 7, 4], // 4-step drive
            [0, 4, 0] // 3-step pound
        ],
        mysterious: [
            [0, null, 3, null, 6, null, 3, null],
            [0, 1, null, 4, null, 1, 0, null],
            [0, null, null, 6, 4, null, 1, null],
            [4, null, 3, null, 0, null, 6, null],
            [0, 6, null, 4, null, 1, null, 0],
            [0, null, 1, null, 0, null, 6, null],
            [0, 3, 6, 3, 0], // 5-step augmented
            [0, null, 6, null], // 4-step tritone
            [0, 6, 0] // 3-step tension
        ],
        aggressive: [
            [0, 0, 4, 0, 0, 4, 7, 4],
            [0, 4, 0, 4, 7, 4, 0, 0],
            [7, 7, 4, 4, 0, 0, 4, 7],
            [0, 0, 0, 4, 0, 0, 7, 0],
            [4, 0, 4, 0, 7, 4, 0, 4],
            [0, 7, 0, 4, 0, 7, 4, 0],
            [0, 0, 4, 7, 0], // 5-step riff
            [0, 4, 0, 7], // 4-step power
            [0, 7, 0] // 3-step slam
        ],
        peaceful: [
            [0, null, 2, null, 4, null, 2, null],
            [0, null, null, 2, null, null, 0, null],
            [4, null, 2, null, 0, null, null, null],
            [0, 2, null, null, 4, 2, null, null],
            [0, null, 4, null, 2, null, 0, null],
            [2, null, null, 0, null, null, 2, null],
            [0, null, 2, null, 0], // 5-step gentle
            [0, null, 2, null] // 4-step calm
        ],
        triumphant: [
            [0, 2, 4, 7, 7, 4, 7, null],
            [0, 4, 7, 4, 0, 4, 7, 7],
            [7, 7, 4, 2, 4, 7, 7, null],
            [0, 0, 4, 4, 7, 7, 7, 4],
            [4, 7, 4, 0, 4, 7, 7, null],
            [0, 2, 4, 4, 7, 4, 2, 0],
            [0, 4, 7, 7, 4], // 5-step victory
            [0, 4, 7, 7], // 4-step horn
            [0, 7, 7] // 3-step fanfare
        ]
    };

    static BASS_PATTERNS = {
        driving: [
            [0, null, 0, null, 4, null, 0, null],
            [0, null, 0, 4, 0, null, 4, 0],
            [0, 0, null, 0, 4, 4, null, 0],
            [0, null, 4, null, 0, null, 0, 4],
            [0, null, 0, 4], // 4-step drive
            [0, 0, 4, 0, 0] // 5-step pulse
        ],
        walking: [
            [0, 1, 2, 3, 4, 3, 2, 1],
            [0, 2, 4, 2, 0, -1, 0, 2],
            [0, null, 2, null, 4, null, 3, null],
            [0, 4, 2, 0, -1, 0, 2, 4],
            [0, 1, 2, 4], // 4-step walk
            [0, 2, 4, 2, 0] // 5-step stroll
        ],
        pedal: [
            [0, null, null, null, 0, null, null, null],
            [0, null, null, 0, null, null, null, null],
            [0, null, null, null, null, null, 0, null],
            [0, null, 0, null, null, null, null, null],
            [0, null, null, null] // 4-step sustain
        ],
        rhythmic: [
            [0, null, 0, null, 0, null, 4, null],
            [0, null, null, 0, null, 0, null, null],
            [0, 0, null, 0, null, null, 0, null],
            [null, 0, null, 0, null, 0, null, 0],
            [0, null, 0, null, 4] // 5-step synco
        ],
        sparse: [
            [0, null, null, null, null, null, null, null],
            [0, null, null, null, 4, null, null, null],
            [0, null, null, null, null, null, null, 0],
            [null, null, null, null, 0, null, null, null]
        ]
    };

    static ARP_PATTERNS = {
        heroic: [
            [0, 2, 4, 7, 4, 2, 0, 2],
            [0, 4, 7, 4, 0, 4, 7, null],
            [0, 2, 4, 2, 4, 7, 4, 2],
            [7, 4, 2, 0, 2, 4, 7, 7],
            [0, 4, 7, 4, 0], // 5-step sweep
            [0, 2, 4, 7] // 4-step ascend
        ],
        shimmering: [
            [0, 4, 2, 4, 0, 4, 2, 4],
            [0, 7, 2, 7, 4, 7, 2, 7],
            [4, 0, 4, 2, 4, 0, 4, 2],
            [0, 2, 4, 2, 0, 2, 4, 2],
            [0, 4, 2, 4, 0] // 5-step shimmer
        ],
        pulsing: [
            [0, 0, 2, 0, 0, 4, 0, 0],
            [0, 0, 0, 2, 0, 0, 0, 4],
            [0, 4, 0, 4, 0, 2, 0, 2],
            [0, 0, 4, 4, 0, 0, 2, 2],
            [0, 0, 2, 0, 4] // 5-step pulse
        ],
        broken: [
            [0, 4, 2, null, 4, 0, null, 2],
            [2, null, 0, 4, null, 2, 0, null],
            [4, null, null, 0, 2, null, null, 4],
            [0, null, 4, null, 2, null, 0, null],
            [0, null, 4, 2, null] // 5-step broken
        ],
        cascading: [
            [7, 4, 2, 0, 7, 4, 2, 0],
            [7, 6, 4, 2, 0, null, null, null],
            [4, 2, 0, -1, 4, 2, 0, -1],
            [7, 4, 0, 7, 4, 0, 7, 4],
            [7, 4, 2, 0, -1] // 5-step waterfall
        ]
    };

    // =========================================
    // Phase 1.3: Form Structures
    // =========================================
    // Each section corresponds to phraseLength steps
    // A = original, B = different phrase or transformation, C = inverted/retrograde

    static FORM_STRUCTURES = {
        epic: ['A', 'A', 'B', 'A'],
        happy: ['A', 'B', 'A', 'C'],
        dark: ['A', 'B', 'C', 'B'],
        atmospheric: ['A', 'A', 'A', 'B'],
        melancholy: ['A', 'B', 'A', 'A'],
        energetic: ['A', 'B', 'C', 'A'],
        mysterious: ['A', 'C', 'B', 'A'],
        aggressive: ['A', 'A', 'B', 'B'],
        peaceful: ['A', 'A', 'A', 'A'],
        triumphant: ['A', 'B', 'B', 'A']
    };

    // =========================================
    // MOOD CONFIG (with Phase 2.2 extended progressions)
    // =========================================

    static MOODS = {
        epic: {
            name: 'Epic',
            suggestedScale: 'major',
            harmonyIntervals: [2, 4],
            suspensionChance: 0.15,
            bassStyle: 'driving',
            arpStyle: 'heroic',
            fxStyle: 'dramatic',
            densityMult: 1.0,
            octaveSpread: 2,
            progressions: [
                [0, 5, 3, 4],
                [0, 3, 5, 4],
                [0, 4, 5, 3],
                [0, 5, 3, 4, 0, 5], // 6-chord extended
                [0, 3, 5, 4, 3, 0]
            ],
            rhythmFeel: 'driving'
        },
        happy: {
            name: 'Happy',
            suggestedScale: 'pentatonic_major',
            harmonyIntervals: [2, 4],
            suspensionChance: 0.05,
            bassStyle: 'walking',
            arpStyle: 'shimmering',
            fxStyle: 'subtle',
            densityMult: 0.9,
            octaveSpread: 1,
            progressions: [
                [0, 3, 4, 0],
                [0, 4, 5, 4],
                [0, 3, 4, 3],
                [0, 3, 4, 0, 4, 3],
                [0, 4, 5, 4, 3, 0]
            ],
            rhythmFeel: 'bouncy'
        },
        dark: {
            name: 'Darkness',
            suggestedScale: 'harmonic_minor',
            harmonyIntervals: [1, 3, 5],
            suspensionChance: 0.3,
            bassStyle: 'pedal',
            arpStyle: 'broken',
            fxStyle: 'washy',
            densityMult: 0.5,
            octaveSpread: 0,
            progressions: [
                [0, 5, 3, 4],
                [0, 6, 5, 4],
                [0, 3, 6, 5],
                [0, 5, 6, 3, 4, 5],
                [0, 3, 5, 6, 4, 3]
            ],
            rhythmFeel: 'sparse'
        },
        atmospheric: {
            name: 'Atmospheric',
            suggestedScale: 'pentatonic_minor',
            harmonyIntervals: [4, 2],
            suspensionChance: 0.4,
            bassStyle: 'sparse',
            arpStyle: 'cascading',
            fxStyle: 'pedal',
            densityMult: 0.4,
            octaveSpread: 2,
            progressions: [
                [0, 3, 5, 0],
                [0, 5, 0, 3],
                [0, 4, 0, 5],
                [0, 3, 5, 0, 4, 0]
            ],
            rhythmFeel: 'sparse'
        },
        melancholy: {
            name: 'Melancholy',
            suggestedScale: 'minor',
            harmonyIntervals: [2, 5],
            suspensionChance: 0.25,
            bassStyle: 'walking',
            arpStyle: 'broken',
            fxStyle: 'echo',
            densityMult: 0.7,
            octaveSpread: 1,
            progressions: [
                [0, 3, 4, 3],
                [0, 5, 3, 4],
                [5, 3, 4, 0],
                [0, 3, 4, 3, 5, 4],
                [0, 5, 3, 4, 0, 3]
            ],
            rhythmFeel: 'laid-back'
        },
        energetic: {
            name: 'Energetic',
            suggestedScale: 'mixolydian',
            harmonyIntervals: [2, 4],
            suspensionChance: 0.05,
            bassStyle: 'driving',
            arpStyle: 'pulsing',
            fxStyle: 'percussive',
            densityMult: 1.3,
            octaveSpread: 1,
            progressions: [
                [0, 3, 4, 0],
                [0, 4, 3, 4],
                [0, 3, 0, 4],
                [0, 3, 4, 0, 3, 4],
                [0, 4, 3, 4, 0, 3]
            ],
            rhythmFeel: 'driving'
        },
        mysterious: {
            name: 'Mysterious',
            suggestedScale: 'blues',
            harmonyIntervals: [1, 3, 6],
            suspensionChance: 0.35,
            bassStyle: 'pedal',
            arpStyle: 'broken',
            fxStyle: 'glitchy',
            densityMult: 0.6,
            octaveSpread: 2,
            progressions: [
                [0, 6, 3, 5],
                [0, 5, 6, 3],
                [0, 3, 6, 0],
                [0, 6, 3, 5, 0, 6],
                [0, 3, 6, 5, 3, 0]
            ],
            rhythmFeel: 'sparse'
        },
        aggressive: {
            name: 'Aggressive',
            suggestedScale: 'minor',
            harmonyIntervals: [4, 0],
            suspensionChance: 0.1,
            bassStyle: 'driving',
            arpStyle: 'pulsing',
            fxStyle: 'percussive',
            densityMult: 1.4,
            octaveSpread: 2,
            progressions: [
                [0, 5, 4, 0],
                [0, 6, 5, 4],
                [0, 4, 6, 5],
                [0, 5, 4, 0, 6, 5],
                [0, 4, 6, 5, 4, 0]
            ],
            rhythmFeel: 'driving'
        },
        peaceful: {
            name: 'Peaceful',
            suggestedScale: 'pentatonic_major',
            harmonyIntervals: [2, 4],
            suspensionChance: 0.3,
            bassStyle: 'sparse',
            arpStyle: 'cascading',
            fxStyle: 'pedal',
            densityMult: 0.4,
            octaveSpread: 0,
            progressions: [
                [0, 3, 4, 0],
                [0, 5, 3, 0],
                [0, 4, 0, 3],
                [0, 3, 4, 0, 5, 3]
            ],
            rhythmFeel: 'sparse'
        },
        triumphant: {
            name: 'Triumphant',
            suggestedScale: 'major',
            harmonyIntervals: [2, 4],
            suspensionChance: 0.1,
            bassStyle: 'driving',
            arpStyle: 'heroic',
            fxStyle: 'accent',
            densityMult: 1.1,
            octaveSpread: 2,
            progressions: [
                [0, 3, 4, 0],
                [0, 4, 5, 4],
                [3, 4, 0, 0],
                [0, 3, 4, 0, 4, 5],
                [0, 4, 5, 4, 3, 0]
            ],
            rhythmFeel: 'driving'
        }
    };

    _mood() {
        return Generator.MOODS[this.mood] || Generator.MOODS.epic;
    }

    // =========================================
    // Phase 3.2: Drum Fill Patterns
    // =========================================

    static DRUM_FILLS = {
        snare: [
            [true, true, true, true], // roll
            [true, false, true, true], // gallop
            [false, true, true, true], // pickup
            [true, true, false, true] // syncopated
        ],
        hihat: [
            [true, true, true, true], // open roll
            [true, false, true, false], // half-time
            [false, true, false, true] // off-beat
        ]
    };

    // =========================================
    // Rhythm builder
    // =========================================

    _buildRhythm(steps) {
        const feel = this._mood().rhythmFeel;
        const density = this.density / 100;
        const mask = new Array(steps).fill(false);

        switch (feel) {
            case 'driving': {
                // Euclidean overlay distributes off-beat syncopation evenly across the bar
                const eucl = this.euclideanRhythm(
                    Math.max(1, Math.round(density * steps * 0.5)),
                    steps
                );
                for (let s = 0; s < steps; s++) {
                    if (s % 4 === 0) mask[s] = true;
                    else if (s % 4 === 2) mask[s] = this._random() < 0.6 * density;
                    else mask[s] = eucl[s] && this._random() < 0.35 * density;
                }
                break;
            }
            case 'bouncy': {
                const eucl = this.euclideanRhythm(
                    Math.max(1, Math.round(density * steps * 0.6)),
                    steps
                );
                for (let s = 0; s < steps; s++) {
                    if (s % 4 === 0) mask[s] = true;
                    else if (s % 4 === 1) mask[s] = eucl[s] && this._random() < 0.4 * density;
                    else if (s % 4 === 2) mask[s] = this._random() < 0.5 * density;
                    else mask[s] = eucl[s] && this._random() < 0.35 * density;
                }
                break;
            }
            case 'sparse':
                for (let s = 0; s < steps; s++) {
                    if (s % 8 === 0) mask[s] = true;
                    else if (s % 4 === 0) mask[s] = this._random() < 0.5 * density;
                    else mask[s] = this._random() < 0.1 * density;
                }
                break;
            case 'laid-back':
                for (let s = 0; s < steps; s++) {
                    if (s % 4 === 0) mask[s] = this._random() < 0.85;
                    else if (s % 4 === 1) mask[s] = this._random() < 0.15 * density;
                    else if (s % 4 === 2) mask[s] = this._random() < 0.35 * density;
                    else mask[s] = this._random() < 0.1 * density;
                }
                break;
            default:
                for (let s = 0; s < steps; s++) {
                    mask[s] = s % 4 === 0 || this._random() < 0.3 * density;
                }
        }
        return mask;
    }

    // =========================================
    // Phase 2.2: Extended Chord Progression System
    // =========================================

    _getChordProg() {
        if (this._sharedProg) return this._sharedProg; // multi-pattern: shared harmonic backbone
        const mood = this._mood();
        if (mood.progressions.length > 0 && this._random() < 0.75) {
            return this._pick(mood.progressions);
        }
        const fallbacks = {
            major: [
                [0, 3, 4, 0],
                [0, 4, 3, 4]
            ],
            minor: [
                [0, 3, 4, 3],
                [0, 5, 3, 4]
            ],
            dorian: [[0, 3, 4, 3]],
            mixolydian: [[0, 3, 4, 0]],
            blues: [[0, 3, 4, 3]],
            pentatonic_major: [[0, 2, 3, 0]],
            pentatonic_minor: [[0, 2, 3, 2]],
            harmonic_minor: [[0, 5, 3, 4]],
            phrygian: [[0, 1, 5, 4]],
            lydian: [[0, 1, 4, 0]],
            whole_tone: [[0, 2, 4, 0]],
            hirajoshi: [[0, 2, 3, 0]],
            hungarian_minor: [[0, 5, 3, 4]],
            phrygian_dominant: [[0, 1, 4, 5]],
            chromatic: [[0, 3, 4, 0]]
        };
        const list = fallbacks[this.scaleType] || fallbacks.major;
        return this._pick(list);
    }

    /** Get chord index at a step, supporting asymmetric durations for longer progressions */
    _getChordAtStep(step, totalSteps, prog) {
        const n = prog.length;
        if (n <= 4) {
            const spc = Math.max(1, Math.floor(totalSteps / n));
            return Math.min(n - 1, Math.floor(step / spc));
        }
        // Longer progressions: first and last chords get 1.4x duration
        const baseDur = totalSteps / (n + 0.8);
        const firstDur = Math.floor(baseDur * 1.4);
        const lastDur = Math.floor(baseDur * 1.4);
        const midDur = Math.max(
            1,
            Math.floor((totalSteps - firstDur - lastDur) / Math.max(1, n - 2))
        );

        if (step < firstDur) return 0;
        if (step >= totalSteps - lastDur) return n - 1;
        return Math.min(n - 2, 1 + Math.floor((step - firstDur) / midDur));
    }

    /** Chromatic substitution: chance to replace chord root with tritone sub */
    _maybeChromaticSub(chordRoot, scaleLen) {
        if (this._random() < this.chaos / 300) {
            return (chordRoot + Math.floor(scaleLen / 2)) % scaleLen;
        }
        return chordRoot;
    }

    // =========================================
    // Post-processing
    // =========================================
    _applySwing(track) {
        if (this.swing <= 0) return;
        const p = this.sequencer.patterns[this.sequencer.currentPattern];
        const prob = this.swing / 100;
        for (let s = this.sequencer.steps - 2; s >= 0; s--) {
            if (s % 2 === 1 && p[track][s] && !p[track][s + 1] && this._random() < prob) {
                p[track][s + 1] = p[track][s];
                p[track][s] = null;
            }
        }
    }
    _applyHumanize(track) {
        if (this.humanize <= 0) return;
        const p = this.sequencer.patterns[this.sequencer.currentPattern];
        const skip = (this.humanize / 100) * 0.35,
            vary = (this.humanize / 100) * 0.25;
        for (let s = 0; s < this.sequencer.steps; s++) {
            if (!p[track][s]) continue;
            if (s % 4 !== 0 && this._random() < skip) {
                p[track][s] = null;
                continue;
            }
            if (this._random() < vary) {
                const sh = this._random() < 0.5 ? -1 : 1;
                p[track][s] = {
                    note: p[track][s].note,
                    octave: this._clamp(p[track][s].octave + sh, this.octaveMin, this.octaveMax)
                };
            }
        }
    }
    _postProcess(track) {
        this._applySwing(track);
        this._applyHumanize(track);
    }

    // =========================================
    // GENRE DEFINITIONS
    // =========================================
    static GENRES = {
        chiptune: {
            name: 'Chiptune Classic',
            bpmRange: [120, 150],
            drumPreset: 'chiptune',
            bassKickMode: 'doubling',
            tracks: {
                0: {
                    style: 'melodic',
                    density: 60,
                    complexity: 50,
                    chaos: 30,
                    octaveRange: [4, 5]
                },
                1: {
                    style: 'harmony',
                    density: 40,
                    complexity: 40,
                    chaos: 20,
                    octaveRange: [4, 5]
                },
                2: { style: 'bass', density: 70, complexity: 40, chaos: 20, octaveRange: [2, 3] },
                3: {
                    style: 'arpeggio',
                    density: 60,
                    complexity: 60,
                    chaos: 30,
                    octaveRange: [4, 6]
                },
                7: { style: 'fx', density: 20, complexity: 30, chaos: 40, octaveRange: [5, 6] }
            }
        },
        synthwave: {
            name: 'Synthwave',
            bpmRange: [100, 118],
            drumPreset: '4-on-floor',
            bassKickMode: 'doubling',
            tracks: {
                0: {
                    style: 'melodic',
                    density: 45,
                    complexity: 55,
                    chaos: 25,
                    octaveRange: [4, 5]
                },
                1: {
                    style: 'harmony',
                    density: 30,
                    complexity: 40,
                    chaos: 15,
                    octaveRange: [3, 4]
                },
                2: { style: 'bass', density: 80, complexity: 50, chaos: 15, octaveRange: [1, 2] },
                3: {
                    style: 'arpeggio',
                    density: 80,
                    complexity: 70,
                    chaos: 20,
                    octaveRange: [3, 5]
                },
                7: { style: 'fx', density: 15, complexity: 20, chaos: 30, octaveRange: [4, 6] }
            }
        },
        techno: {
            name: 'Techno',
            bpmRange: [125, 140],
            drumPreset: 'techno',
            bassKickMode: 'complementary',
            tracks: {
                0: {
                    style: 'melodic',
                    density: 35,
                    complexity: 40,
                    chaos: 50,
                    octaveRange: [3, 5]
                },
                1: {
                    style: 'harmony',
                    density: 60,
                    complexity: 60,
                    chaos: 40,
                    octaveRange: [3, 4]
                },
                2: { style: 'bass', density: 80, complexity: 30, chaos: 20, octaveRange: [1, 2] },
                3: {
                    style: 'arpeggio',
                    density: 70,
                    complexity: 80,
                    chaos: 30,
                    octaveRange: [3, 5]
                },
                7: { style: 'fx', density: 25, complexity: 50, chaos: 60, octaveRange: [5, 7] }
            }
        },
        lofi: {
            name: 'Lo-Fi',
            bpmRange: [75, 90],
            drumPreset: 'lofi',
            bassKickMode: 'complementary',
            tracks: {
                0: {
                    style: 'melodic',
                    density: 30,
                    complexity: 40,
                    chaos: 20,
                    octaveRange: [4, 5]
                },
                1: {
                    style: 'harmony',
                    density: 25,
                    complexity: 30,
                    chaos: 15,
                    octaveRange: [3, 4]
                },
                2: { style: 'bass', density: 50, complexity: 30, chaos: 15, octaveRange: [2, 3] },
                3: {
                    style: 'arpeggio',
                    density: 35,
                    complexity: 40,
                    chaos: 20,
                    octaveRange: [4, 5]
                },
                7: { style: 'fx', density: 15, complexity: 20, chaos: 10, octaveRange: [5, 6] }
            }
        },
        dnb: {
            name: 'Drum & Bass',
            bpmRange: [165, 180],
            drumPreset: 'dnb',
            bassKickMode: 'complementary',
            tracks: {
                0: {
                    style: 'melodic',
                    density: 40,
                    complexity: 50,
                    chaos: 40,
                    octaveRange: [4, 5]
                },
                1: {
                    style: 'harmony',
                    density: 50,
                    complexity: 60,
                    chaos: 35,
                    octaveRange: [3, 4]
                },
                2: { style: 'bass', density: 70, complexity: 60, chaos: 30, octaveRange: [1, 2] },
                3: {
                    style: 'arpeggio',
                    density: 55,
                    complexity: 70,
                    chaos: 40,
                    octaveRange: [3, 5]
                },
                7: { style: 'fx', density: 30, complexity: 60, chaos: 50, octaveRange: [5, 7] }
            }
        },
        ambient: {
            name: 'Ambient',
            bpmRange: [60, 80],
            drumPreset: null,
            bassKickMode: 'doubling',
            tracks: {
                0: {
                    style: 'melodic',
                    density: 20,
                    complexity: 30,
                    chaos: 40,
                    octaveRange: [4, 6]
                },
                1: {
                    style: 'harmony',
                    density: 15,
                    complexity: 25,
                    chaos: 30,
                    octaveRange: [3, 5]
                },
                2: { style: 'bass', density: 25, complexity: 20, chaos: 15, octaveRange: [2, 3] },
                3: {
                    style: 'arpeggio',
                    density: 30,
                    complexity: 40,
                    chaos: 25,
                    octaveRange: [4, 6]
                },
                7: { style: 'fx', density: 10, complexity: 15, chaos: 20, octaveRange: [5, 7] }
            }
        },
        funk: {
            name: 'Funk',
            bpmRange: [100, 120],
            drumPreset: 'funk',
            bassKickMode: 'complementary',
            tracks: {
                0: {
                    style: 'melodic',
                    density: 55,
                    complexity: 60,
                    chaos: 35,
                    octaveRange: [4, 5]
                },
                1: {
                    style: 'harmony',
                    density: 70,
                    complexity: 65,
                    chaos: 30,
                    octaveRange: [3, 4]
                },
                2: { style: 'bass', density: 75, complexity: 70, chaos: 25, octaveRange: [2, 3] },
                3: {
                    style: 'arpeggio',
                    density: 50,
                    complexity: 55,
                    chaos: 30,
                    octaveRange: [3, 5]
                },
                7: { style: 'fx', density: 20, complexity: 40, chaos: 35, octaveRange: [5, 6] }
            }
        },
        boss: {
            name: 'Boss Battle',
            bpmRange: [150, 180],
            drumPreset: 'boss',
            bassKickMode: 'doubling',
            tracks: {
                0: {
                    style: 'melodic',
                    density: 70,
                    complexity: 70,
                    chaos: 50,
                    octaveRange: [4, 6]
                },
                1: {
                    style: 'harmony',
                    density: 50,
                    complexity: 50,
                    chaos: 40,
                    octaveRange: [3, 5]
                },
                2: { style: 'bass', density: 80, complexity: 60, chaos: 30, octaveRange: [1, 2] },
                3: {
                    style: 'arpeggio',
                    density: 80,
                    complexity: 80,
                    chaos: 40,
                    octaveRange: [3, 6]
                },
                7: { style: 'fx', density: 35, complexity: 60, chaos: 50, octaveRange: [5, 7] }
            }
        },
        menu: {
            name: 'Menu Theme',
            bpmRange: [90, 110],
            drumPreset: 'platformer',
            bassKickMode: 'doubling',
            tracks: {
                0: {
                    style: 'melodic',
                    density: 40,
                    complexity: 35,
                    chaos: 15,
                    octaveRange: [4, 5]
                },
                1: {
                    style: 'harmony',
                    density: 30,
                    complexity: 30,
                    chaos: 10,
                    octaveRange: [3, 4]
                },
                2: { style: 'bass', density: 45, complexity: 25, chaos: 10, octaveRange: [2, 3] },
                3: {
                    style: 'arpeggio',
                    density: 50,
                    complexity: 50,
                    chaos: 15,
                    octaveRange: [4, 5]
                },
                7: { style: 'fx', density: 10, complexity: 20, chaos: 20, octaveRange: [5, 6] }
            }
        },
        waltz: {
            name: 'Waltz',
            bpmRange: [100, 130],
            drumPreset: 'waltz',
            bassKickMode: 'doubling',
            tracks: {
                0: {
                    style: 'melodic',
                    density: 50,
                    complexity: 40,
                    chaos: 20,
                    octaveRange: [4, 5]
                },
                1: {
                    style: 'harmony',
                    density: 35,
                    complexity: 35,
                    chaos: 15,
                    octaveRange: [3, 4]
                },
                2: { style: 'bass', density: 40, complexity: 30, chaos: 10, octaveRange: [2, 3] },
                3: {
                    style: 'arpeggio',
                    density: 45,
                    complexity: 45,
                    chaos: 20,
                    octaveRange: [3, 5]
                },
                7: { style: 'fx', density: 10, complexity: 15, chaos: 15, octaveRange: [5, 6] }
            }
        }
    };

    // =========================================
    // GENERATE ALL (with Phase 3.5 motif sharing)
    // =========================================

    generateAll() {
        this._initRng();
        this._motif = this._generateMotif(); // Phase 3.5: shared motif seed

        const g = Generator.GENRES[this.genre];
        if (!g) {
            // No genre: drums first so bass kick-reactivity works on fallback path
            this.generateDrumPattern(4);
            this.generateDrumPattern(5);
            this.generateDrumPattern(6);
            this.generateMelody(0);
            this.generateHarmony(1);
            this.generateBassLine(2);
            this.generateArpeggio(3);
            this.generateFX(7);
            this._motif = null;
            return null;
        }

        const saved = {
            density: this.density,
            complexity: this.complexity,
            chaos: this.chaos,
            octaveMin: this.octaveMin,
            octaveMax: this.octaveMax
        };

        // ── Drums FIRST: bass kick-reactivity (Phase 2.3) needs kick data ──────
        if (g.drumPreset && this.patternPresets) {
            this.patternPresets.applyPreset(g.drumPreset, 'fill', { resetInstruments: false });
            if (this.sequencer.steps > 16) {
                const pat = this.sequencer.patterns[this.sequencer.currentPattern];
                for (let tr = 4; tr <= 6; tr++)
                    for (let s = 16; s < this.sequencer.steps; s++)
                        pat[tr][s] = pat[tr][s - 16] ? { ...pat[tr][s - 16] } : null;
            }
        } else if (g.drumPreset === null) {
            this.sequencer.clearTrack(4);
            this.sequencer.clearTrack(5);
            this.sequencer.clearTrack(6);
        } else {
            this.generateDrumPattern(4);
            this.generateDrumPattern(5);
            this.generateDrumPattern(6);
        }

        // ── Melodic tracks: explicit numeric sort ensures melody(0) before harmony(1) ──
        const trackEntries = Object.entries(g.tracks).sort(
            (a, b) => parseInt(a[0]) - parseInt(b[0])
        );
        for (const [t, cfg] of trackEntries) {
            const track = parseInt(t);
            this.density = cfg.density;
            this.complexity = cfg.complexity;
            this.chaos = cfg.chaos;
            this.octaveMin = cfg.octaveRange[0];
            this.octaveMax = cfg.octaveRange[1];
            switch (cfg.style) {
                case 'melodic':
                    this.generateMelody(track);
                    break;
                case 'harmony':
                    this.generateHarmony(track);
                    break;
                case 'bass':
                    this.generateBassLine(track);
                    break;
                case 'arpeggio':
                    this.generateArpeggio(track);
                    break;
                case 'fx':
                    this.generateFX(track);
                    break;
            }
        }

        Object.assign(this, saved);
        this._motif = null; // Clear shared motif

        const result = {
            suggestedBPM: Math.round(
                g.bpmRange[0] + this._random() * (g.bpmRange[1] - g.bpmRange[0])
            ),
            seed: this._lastSeed
        };
        this._bus.emit(GENERATOR_EVENTS.generated, result);
        return result;
    }

    /** Generate a single track by role (for randomize buttons) */
    generateForTrack(track) {
        this._initRng();
        this._motif = this._generateMotif();

        // Apply genre-specific overrides for this track so single-track regen
        // sounds consistent with a full generateAll() of the same genre.
        const g = Generator.GENRES[this.genre];
        const trackCfg = g?.tracks?.[track];
        const saved = trackCfg
            ? {
                  density: this.density,
                  complexity: this.complexity,
                  chaos: this.chaos,
                  octaveMin: this.octaveMin,
                  octaveMax: this.octaveMax
              }
            : null;
        if (trackCfg) {
            this.density = trackCfg.density;
            this.complexity = trackCfg.complexity;
            this.chaos = trackCfg.chaos;
            this.octaveMin = trackCfg.octaveRange[0];
            this.octaveMax = trackCfg.octaveRange[1];
        }

        switch (track) {
            case 0:
                this.generateMelody(0);
                break;
            case 1:
                this.generateHarmony(1);
                break;
            case 2:
                this.generateBassLine(2);
                break;
            case 3:
                this.generateArpeggio(3);
                break;
            case 4:
            case 5:
            case 6:
                this.generateDrumPattern(track);
                break;
            case 7:
                this.generateFX(7);
                break;
        }

        if (saved) Object.assign(this, saved);
        this._motif = null;
    }

    // =========================================
    // MELODY: Phase 1.3 form + Phase 2.1 tension + Phase 3.5 motif
    //          Phase 2.4 call/response (lead rests on even sections when complexity > 60)
    // =========================================

    generateMelody(track = 0) {
        const scale = this.getScale();
        const mood = this._mood();
        const baseOctave = this.getOctaveForTrack(track);
        const spread = mood.octaveSpread;
        const octLow = this._clamp(
            baseOctave - Math.floor(spread / 2),
            this.octaveMin,
            this.octaveMax
        );
        const octHigh = this._clamp(
            baseOctave + Math.ceil(spread / 2),
            this.octaveMin,
            this.octaveMax
        );
        this.sequencer.clearTrack(track);

        const phrases = Generator.MELODY_PHRASES[this.mood] || Generator.MELODY_PHRASES.epic;
        const prog = this._getChordProg();
        const steps = this.sequencer.steps;
        const rhythm = this._buildRhythm(steps);
        const motif = this._ensureMotif();
        const form = Generator.FORM_STRUCTURES[this.mood] || ['A', 'A', 'B', 'A'];

        // Select distinct phrases for sections A, B, C
        const phraseA = this._pick(phrases);
        let phraseB = this._pick(phrases);
        if (phraseB === phraseA && phrases.length > 1)
            phraseB = phrases[(phrases.indexOf(phraseA) + 1) % phrases.length];

        // Phase 1.2: all 4 transformations now used, pick by complexity + RNG
        // augment (stretch), diminish (compress), invert, retrograde
        let phraseC;
        if (this.complexity > 50) {
            const tfm = Math.floor(this._random() * 4);
            phraseC =
                tfm === 0
                    ? this._invertPhrase(phraseA)
                    : tfm === 1
                      ? this._retrogradePhrase(phraseA)
                      : tfm === 2
                        ? this._augmentPhrase(phraseA)
                        : this._diminishPhrase(phraseA);
        } else {
            phraseC =
                phrases.length > 2
                    ? phrases[(phrases.indexOf(phraseA) + 2) % phrases.length]
                    : this._retrogradePhrase(phraseA);
        }

        // Build transformed versions for B section
        const phraseBTransformed = this.complexity > 60 ? this._invertPhrase(phraseB) : phraseB;

        const sectionMap = {
            A: phraseA,
            B: phraseBTransformed,
            C: phraseC
        };

        // Phase 2.4: call/response, lead rests on even-numbered sections when complexity > 60
        const callResponse = this.complexity > 60 && track === 0;

        const stepsPerSection = Math.max(this.phraseLength, Math.floor(steps / form.length));
        let cursor = 0;

        for (let fi = 0; fi < form.length && cursor < steps; fi++) {
            const section = form[fi % form.length];
            const phrase = sectionMap[section] || phraseA;
            const sectionEnd = Math.min(steps, (fi + 1) * stepsPerSection);

            // Phase 2.4: call/response, skip even sections for lead
            if (callResponse && fi % 2 === 1) {
                cursor = sectionEnd;
                continue;
            }

            // Phase 3.5: occasionally inject motif instead of phrase
            const useMotif = this._random() < 0.25;
            const activePhrase = useMotif ? motif : phrase;

            // Write phrase within this section, chaining if shorter
            while (cursor < sectionEnd) {
                // Phase 2.1: tension arc
                const tension = this._getTensionZone(cursor, steps);

                // Phase 2.2: get chord at current step
                const chordIdx = this._getChordAtStep(cursor, steps, prog);
                let chordRoot = prog[chordIdx] % scale.length;
                chordRoot = this._maybeChromaticSub(chordRoot, scale.length);

                // Apply chaos mutations on the fly
                const mutateChance = (this.chaos / 200) * tension.chaos;

                const pLen = activePhrase.length;
                for (let i = 0; i < pLen && cursor < sectionEnd; i++) {
                    let degree = activePhrase[i];

                    if (degree === null) {
                        cursor++;
                        continue;
                    }
                    if (!rhythm[cursor] && i !== 0) {
                        cursor++;
                        continue;
                    }

                    // Chaos mutation
                    if (this._random() < mutateChance) {
                        degree += this._random() < 0.5 ? 1 : -1;
                    }

                    // Transpose by chord root
                    const transposed = degree + chordRoot;
                    const { note, octave } = this._degreeToNote(
                        scale,
                        transposed,
                        baseOctave + tension.octaveBias
                    );
                    const finalOctave = this._clamp(octave, octLow, octHigh);

                    // Tension density gate
                    const tensionDensity =
                        (this.density / 100) * tension.density * (mood.densityMult || 1);
                    if (this._random() < tensionDensity || i === 0) {
                        this.sequencer.setCell(track, cursor, note, finalOctave);
                    }
                    cursor++;
                }
            }
        }

        this._postProcess(track);
    }

    // =========================================
    // HARMONY: Autonomous + voice leading (Phase 1.4)
    //   Works independently or complementary to Lead if present
    // =========================================

    generateHarmony(track = 1) {
        const scale = this.getScale();
        const mood = this._mood();
        const baseOctave = this.getOctaveForTrack(track);
        const spread = mood.octaveSpread;
        const octLow = this._clamp(
            baseOctave - Math.floor(spread / 2),
            this.octaveMin,
            this.octaveMax
        );
        const octHigh = this._clamp(
            baseOctave + Math.ceil(spread / 2),
            this.octaveMin,
            this.octaveMax
        );
        this.sequencer.clearTrack(track);

        const prog = this._getChordProg();
        const steps = this.sequencer.steps;
        const density = this.density / 100;
        const leadPat = this.sequencer.patterns[this.sequencer.currentPattern][0];

        // Check if lead has any content
        const leadHasNotes = leadPat && leadPat.some((n) => n !== null);

        // Phase 1.4: track previous harmony note for smooth voice leading
        let prevHarmIdx = -1;

        if (leadHasNotes) {
            // === Mode complémentaire : dérive de la lead ===
            for (let step = 0; step < steps; step++) {
                const lead = leadPat[step];
                if (!lead) continue;
                if (step % 4 !== 0 && this._random() > density * 0.7) continue;

                const leadIdx = scale.indexOf(lead.note);
                if (leadIdx < 0) continue;

                // Voice leading: choose interval producing closest note to previous
                let bestInterval = this._pick(mood.harmonyIntervals);
                if (prevHarmIdx >= 0 && mood.harmonyIntervals.length > 1) {
                    let bestDist = Infinity;
                    for (const interval of mood.harmonyIntervals) {
                        const hIdx = (leadIdx + interval) % scale.length;
                        const dist = Math.min(
                            Math.abs(hIdx - prevHarmIdx),
                            scale.length - Math.abs(hIdx - prevHarmIdx)
                        );
                        if (dist < bestDist) {
                            bestDist = dist;
                            bestInterval = interval;
                        }
                    }
                }

                const hIdx = (leadIdx + bestInterval) % scale.length;

                // Suspension
                if (this._random() < mood.suspensionChance && step + 1 < steps) {
                    const next = step + 1;
                    if (!this.sequencer.patterns[this.sequencer.currentPattern][track][next]) {
                        let oct = lead.octave;
                        if (hIdx < leadIdx)
                            oct = this._clamp(oct + 1, this.octaveMin, this.octaveMax);
                        this.sequencer.setCell(track, next, scale[hIdx], oct);
                        prevHarmIdx = hIdx;
                        continue;
                    }
                }

                let oct = lead.octave;
                if (hIdx < leadIdx && this._random() < 0.6)
                    oct = this._clamp(oct + 1, this.octaveMin, this.octaveMax);
                this.sequencer.setCell(track, step, scale[hIdx], oct);
                prevHarmIdx = hIdx;
            }
        } else {
            // === Mode autonome : génère sa propre ligne d'harmonie ===
            const phrases = Generator.MELODY_PHRASES[this.mood] || Generator.MELODY_PHRASES.epic;
            const form = Generator.FORM_STRUCTURES[this.mood] || ['A', 'A', 'B', 'A'];
            const rhythm = this._buildRhythm(steps);

            // Pick phrases and apply harmony interval offset
            const phraseA = this._pick(phrases);
            let phraseB = this._pick(phrases);
            if (phraseB === phraseA && phrases.length > 1)
                phraseB = phrases[(phrases.indexOf(phraseA) + 1) % phrases.length];
            const phraseC = this._retrogradePhrase(phraseA);

            // Harmony offset: shift all degrees by a harmony interval
            const harmOffset = this._pick(mood.harmonyIntervals);
            const offsetPhrase = (p) => p.map((d) => (d === null ? null : d + harmOffset));

            const sectionMap = {
                A: offsetPhrase(phraseA),
                B: offsetPhrase(phraseB),
                C: offsetPhrase(phraseC)
            };

            const stepsPerSection = Math.max(this.phraseLength, Math.floor(steps / form.length));
            let cursor = 0;

            for (let fi = 0; fi < form.length && cursor < steps; fi++) {
                const section = form[fi % form.length];
                const phrase = sectionMap[section] || sectionMap['A'];
                const sectionEnd = Math.min(steps, (fi + 1) * stepsPerSection);

                while (cursor < sectionEnd) {
                    const tension = this._getTensionZone(cursor, steps);
                    const chordIdx = this._getChordAtStep(cursor, steps, prog);
                    let chordRoot = prog[chordIdx] % scale.length;
                    chordRoot = this._maybeChromaticSub(chordRoot, scale.length);

                    const pLen = phrase.length;
                    for (let i = 0; i < pLen && cursor < sectionEnd; i++) {
                        let degree = phrase[i];
                        if (degree === null) {
                            cursor++;
                            continue;
                        }
                        if (!rhythm[cursor] && i !== 0) {
                            cursor++;
                            continue;
                        }

                        // Chaos mutation
                        if (this._random() < (this.chaos / 200) * tension.chaos) {
                            degree += this._random() < 0.5 ? 1 : -1;
                        }

                        const transposed = degree + chordRoot;
                        const { note, octave } = this._degreeToNote(
                            scale,
                            transposed,
                            baseOctave + tension.octaveBias
                        );
                        const finalOctave = this._clamp(octave, octLow, octHigh);

                        // Slightly less dense than melody
                        const tensionDensity =
                            density * 0.75 * tension.density * (mood.densityMult || 1);
                        if (this._random() < tensionDensity || i === 0) {
                            // Voice leading: prefer close notes
                            if (prevHarmIdx >= 0) {
                                const noteIdx = scale.indexOf(note);
                                if (
                                    noteIdx >= 0 &&
                                    Math.abs(noteIdx - prevHarmIdx) > scale.length / 2
                                ) {
                                    // Skip if too far: voice leading smoothness
                                    if (this._random() < 0.4) {
                                        cursor++;
                                        continue;
                                    }
                                }
                                prevHarmIdx = noteIdx >= 0 ? noteIdx : prevHarmIdx;
                            } else {
                                prevHarmIdx = scale.indexOf(note);
                            }
                            this.sequencer.setCell(track, cursor, note, finalOctave);
                        }
                        cursor++;
                    }
                }
            }
        }

        this._postProcess(track);
    }

    // =========================================
    // BASS, Phase 2.3: kick-reactive + Phase 2.1: tension + Phase 3.5: motif rhythm
    // =========================================

    generateBassLine(track = 2) {
        const scale = this.getScale();
        const mood = this._mood();
        const octave = this._clamp(2, this.octaveMin, this.octaveMax);
        this.sequencer.clearTrack(track);

        const bassPatterns =
            Generator.BASS_PATTERNS[mood.bassStyle] || Generator.BASS_PATTERNS.driving;
        const prog = this._getChordProg();
        const steps = this.sequencer.steps;
        const motif = this._ensureMotif();

        const patA = this._pick(bassPatterns);
        const patB = this._pick(bassPatterns);

        // Phase 2.3: read kick track for reactive bass
        const kickPat = this.sequencer.patterns[this.sequencer.currentPattern][4];
        const hasKick = kickPat.some((cell) => cell !== null);
        const genreDef = Generator.GENRES[this.genre];
        const kickMode = genreDef?.bassKickMode || 'doubling';

        // Phase 3.5: extract rhythm skeleton from motif, now actually applied as a gate
        const motifRhythm = motif.map((d) => d !== null);

        for (let step = 0; step < steps; step++) {
            // Phase 2.1: tension arc
            const tension = this._getTensionZone(step, steps);

            const chordIdx = this._getChordAtStep(step, steps, prog);
            let chordRoot = prog[chordIdx] % scale.length;
            chordRoot = this._maybeChromaticSub(chordRoot, scale.length);
            const pos = step % Math.max(patA.length, patB.length);

            const pat = chordIdx % 2 === 0 ? patA : patB;
            const degIdx = pos % pat.length;
            const degree = pat[degIdx];

            if (degree === null) continue;

            // Phase 2.3: kick reactivity
            if (hasKick) {
                const kickHere = kickPat[step] !== null;
                if (kickMode === 'complementary' && kickHere && step % 4 === 0) continue;
                if (kickMode === 'doubling' && !kickHere && step % 4 === 0 && this._random() < 0.4)
                    continue;
            }

            // Phase 3.5: motif rhythm gate, off-beat notes follow motif's rhythmic shape
            const motifPos = step % motifRhythm.length;
            if (step % 4 !== 0 && !motifRhythm[motifPos] && this._random() < 0.5) continue;

            // Tension density gate
            const tensionDensity = tension.density * (mood.densityMult || 1);
            if (step % 4 !== 0 && this._random() > tensionDensity * 0.5) continue;

            const transposed = degree + chordRoot;
            const { note, octave: oct } = this._degreeToNote(
                scale,
                transposed,
                octave + tension.octaveBias
            );
            this.sequencer.setCell(
                track,
                step,
                note,
                this._clamp(oct, this.octaveMin, this.octaveMax)
            );
        }

        this._postProcess(track);
    }

    // =========================================
    // ARPEGGIO, Phase 2.4: call/response + Phase 2.1: tension
    // =========================================

    generateArpeggio(track = 3) {
        const scale = this.getScale();
        const mood = this._mood();
        const baseOctave = this.getOctaveForTrack(track);
        this.sequencer.clearTrack(track);

        const arpPatterns = Generator.ARP_PATTERNS[mood.arpStyle] || Generator.ARP_PATTERNS.heroic;
        const prog = this._getChordProg();
        const steps = this.sequencer.steps;
        const density = this.density / 100;

        const patA = this._pick(arpPatterns);
        const patB = this._pick(arpPatterns);

        // Phase 2.4: call/response, arp responds on even sections when complexity > 60
        const callResponse = this.complexity > 60;
        const form = Generator.FORM_STRUCTURES[this.mood] || ['A', 'A', 'B', 'A'];
        const stepsPerSection = Math.max(this.phraseLength, Math.floor(steps / form.length));

        // Read lead pattern for response material
        const leadPat = this.sequencer.patterns[this.sequencer.currentPattern][0];

        for (let step = 0; step < steps; step++) {
            // Phase 2.4: determine if this is a response section
            const sectionIdx = Math.floor(step / stepsPerSection);
            const isResponseSection = callResponse && sectionIdx % 2 === 1;

            // Phase 2.1: tension arc
            const tension = this._getTensionZone(step, steps);

            // Density gate with tension
            const effectiveDensity = density * tension.density * (mood.densityMult || 1);
            if (this._random() > 0.3 + effectiveDensity * 0.6) continue;

            const chordIdx = this._getChordAtStep(step, steps, prog);
            let chordRoot = prog[chordIdx] % scale.length;
            chordRoot = this._maybeChromaticSub(chordRoot, scale.length);

            if (isResponseSection) {
                // Phase 2.4: respond to lead, use lead note transposed
                const leadStep = step - stepsPerSection; // reference previous section
                const leadNote = leadStep >= 0 ? leadPat[leadStep] : null;
                if (leadNote) {
                    const leadIdx = scale.indexOf(leadNote.note);
                    if (leadIdx >= 0) {
                        // Transpose lead motif: shift by +2 or +4 scale degrees
                        const shift = this._pick([2, 4]);
                        const respDeg = leadIdx + shift;
                        const { note, octave } = this._degreeToNote(scale, respDeg, baseOctave);
                        this.sequencer.setCell(
                            track,
                            step,
                            note,
                            this._clamp(octave, this.octaveMin, this.octaveMax)
                        );
                        continue;
                    }
                }
            }

            // Normal arp pattern
            const pos = step % Math.max(patA.length, patB.length);
            const pat = chordIdx % 2 === 0 ? patA : patB;
            const degIdx = pos % pat.length;
            const degree = pat[degIdx];

            if (degree === null) continue;

            const transposed = degree + chordRoot;
            const { note, octave } = this._degreeToNote(
                scale,
                transposed,
                baseOctave + tension.octaveBias
            );
            this.sequencer.setCell(
                track,
                step,
                note,
                this._clamp(octave, this.octaveMin, this.octaveMax)
            );
        }

        this._postProcess(track);
    }

    // =========================================
    // DRUMS, Phase 3.2: intelligent fills
    // =========================================

    generateDrumPattern(track) {
        this.sequencer.clearTrack(track);
        const d = this.density / 100;
        const steps = this.sequencer.steps;

        if (track === 4) {
            // KICK
            const pats = {
                simple: [0, 8],
                medium: [0, 6, 8, 14],
                complex: [0, 3, 6, 8, 11, 14]
            };
            const p =
                this.complexity > 70
                    ? pats.complex
                    : this.complexity > 40
                      ? pats.medium
                      : pats.simple;
            p.forEach((s) => {
                if (s < steps) this.sequencer.setCell(track, s, 'C', 2);
            });
            if (this.chaos > 60) {
                for (let s = 0; s < steps; s++) {
                    if (!p.includes(s) && this._random() < 0.12 * d)
                        this.sequencer.setCell(track, s, 'C', 2);
                }
            }
        } else if (track === 5) {
            // SNARE
            for (let s = 4; s < steps; s += 8) this.sequencer.setCell(track, s, 'C', 3);
            if (this.complexity > 50) {
                for (let s = 0; s < steps; s++) {
                    if (s % 8 !== 4 && this._random() < 0.15 * d * (this.complexity / 100))
                        this.sequencer.setCell(track, s, 'C', 3);
                }
            }
            // Phase 3.2: intelligent fill at section boundaries
            this._generateDrumFill(track, steps, 'snare');
        } else if (track === 6) {
            // HI-HAT
            if (this.complexity > 80) {
                for (let s = 0; s < steps; s++) {
                    if (this._random() < d * 0.9) this.sequencer.setCell(track, s, 'C', 5);
                }
            } else if (this.complexity > 50) {
                for (let s = 0; s < steps; s += 2) this.sequencer.setCell(track, s, 'C', 5);
                for (let s = 1; s < steps; s += 2)
                    if (this._random() < d * 0.35) this.sequencer.setCell(track, s, 'C', 5);
            } else {
                for (let s = 0; s < steps; s += 4) this.sequencer.setCell(track, s, 'C', 5);
            }
            if (this.chaos > 50)
                [2, 6, 10, 14].forEach((s) => {
                    if (s < steps && this._random() < 0.3) this.sequencer.setCell(track, s, 'C', 5);
                });
            // Phase 3.2: fill at boundaries
            this._generateDrumFill(track, steps, 'hihat');
        }
    }

    /** Phase 3.2: Generate drum fill at section boundaries */
    _generateDrumFill(track, steps, type) {
        if (this.complexity < 40) return; // no fills at low complexity

        const fills = type === 'snare' ? Generator.DRUM_FILLS.snare : Generator.DRUM_FILLS.hihat;
        const fillLen = 4;
        const drumNote = type === 'snare' ? { note: 'C', octave: 3 } : { note: 'C', octave: 5 };
        const intensity = this.complexity / 100;

        // Fill at end of each 8 or 16 step section
        const sectionSize = steps >= 32 ? 16 : 8;
        for (let boundary = sectionSize; boundary <= steps; boundary += sectionSize) {
            if (this._random() > intensity * 0.7) continue;
            const fillStart = boundary - fillLen;
            if (fillStart < 0) continue;

            const fill = this._pick(fills);
            for (let i = 0; i < fillLen && fillStart + i < steps; i++) {
                if (fill[i] && this._random() < intensity) {
                    this.sequencer.setCell(track, fillStart + i, drumNote.note, drumNote.octave);
                }
            }
        }
    }

    // =========================================
    // FX, Phase 3.3: contextual, chord-aware + new styles (accent, echo, pedal)
    // =========================================

    generateFX(track = 7) {
        const scale = this.getScale();
        const mood = this._mood();
        this.sequencer.clearTrack(track);
        const steps = this.sequencer.steps;
        const fxBase = this._clamp(this.octaveMax - 1, this.octaveMin, this.octaveMax);
        const d = this.density / 100;

        // Phase 3.3: get chord progression for contextual note selection
        const prog = this._getChordProg();

        // Helper: get chord tones at a step (Phase 3.3)
        const getChordTone = (step) => {
            const chordIdx = this._getChordAtStep(step, steps, prog);
            const chordRoot = prog[chordIdx] % scale.length;
            const chordTones = [
                chordRoot,
                (chordRoot + 2) % scale.length,
                (chordRoot + 4) % scale.length
            ];
            return scale[this._pick(chordTones)];
        };

        switch (mood.fxStyle) {
            case 'dramatic':
                for (let s = 0; s < steps; s++) {
                    const tension = this._getTensionZone(s, steps);
                    let prob = 0.05 * tension.density;
                    if (s % this.phraseLength === 0) prob = 0.55;
                    if (s >= steps - 4) prob = 0.45 * tension.density;
                    if (this._random() < prob * d) {
                        this.sequencer.setCell(
                            track,
                            s,
                            getChordTone(s),
                            this._clamp(
                                fxBase + this._randomInt(2) + tension.octaveBias,
                                this.octaveMin,
                                this.octaveMax
                            )
                        );
                    }
                }
                break;
            case 'subtle':
                for (let s = 0; s < steps; s++) {
                    if (s % 4 === 2 && this._random() < 0.18 * d) {
                        this.sequencer.setCell(
                            track,
                            s,
                            getChordTone(s),
                            this._clamp(fxBase + 1, this.octaveMin, this.octaveMax)
                        );
                    }
                }
                break;
            case 'glitchy':
                for (let s = 0; s < steps; s++) {
                    if (this._random() < 0.1 * d) {
                        const len = 2 + this._randomInt(2);
                        for (let b = 0; b < len && s + b < steps; b++) {
                            this.sequencer.setCell(
                                track,
                                s + b,
                                getChordTone(s + b),
                                this._clamp(
                                    fxBase + this._randomInt(3),
                                    this.octaveMin,
                                    this.octaveMax
                                )
                            );
                        }
                        s += 3;
                    }
                }
                break;
            case 'washy':
                for (let s = 0; s < steps; s += 4 + this._randomInt(8)) {
                    if (this._random() < 0.4 * d) {
                        const note = getChordTone(s);
                        this.sequencer.setCell(track, s, note, fxBase);
                        // Sustain effect
                        if (s + 1 < steps && this._random() < 0.4)
                            this.sequencer.setCell(track, s + 1, note, fxBase);
                    }
                }
                break;
            case 'percussive':
                for (let s = 0; s < steps; s++) {
                    const tension = this._getTensionZone(s, steps);
                    if (s % 2 === 0 && this._random() < 0.22 * d * tension.density) {
                        this.sequencer.setCell(
                            track,
                            s,
                            getChordTone(s),
                            this._clamp(fxBase + 2, this.octaveMin, this.octaveMax)
                        );
                    }
                }
                break;
            // Phase 3.3: new contextual FX styles
            case 'accent': {
                // Strong note on beat 1 of each chord change
                let prevChordIdx = -1;
                for (let s = 0; s < steps; s++) {
                    const chordIdx = this._getChordAtStep(s, steps, prog);
                    if (chordIdx !== prevChordIdx) {
                        if (this._random() < 0.8 * d) {
                            this.sequencer.setCell(
                                track,
                                s,
                                getChordTone(s),
                                this._clamp(fxBase + 1, this.octaveMin, this.octaveMax)
                            );
                        }
                        prevChordIdx = chordIdx;
                    }
                }
                break;
            }
            case 'echo': {
                // Repeat lead notes 2-4 steps later
                const leadPat = this.sequencer.patterns[this.sequencer.currentPattern][0];
                const echoDelay = 2 + this._randomInt(3); // 2-4 steps
                for (let s = 0; s < steps; s++) {
                    const src = s - echoDelay;
                    if (src >= 0 && leadPat[src]) {
                        if (this._random() < 0.5 * d) {
                            this.sequencer.setCell(
                                track,
                                s,
                                leadPat[src].note,
                                this._clamp(leadPat[src].octave - 1, this.octaveMin, this.octaveMax)
                            );
                        }
                    }
                }
                break;
            }
            case 'pedal': {
                // Sustained root note (tonic pedal)
                const rootNote = scale[0];
                for (let s = 0; s < steps; s += 2) {
                    if (this._random() < 0.25 * d) {
                        this.sequencer.setCell(track, s, rootNote, fxBase);
                    }
                }
                break;
            }
            default:
                for (let s = 0; s < steps; s++) {
                    if (this._random() < 0.08 * d) {
                        this.sequencer.setCell(
                            track,
                            s,
                            getChordTone(s),
                            this._clamp(fxBase + 1, this.octaveMin, this.octaveMax)
                        );
                    }
                }
        }
        this._postProcess(track);
    }

    // =========================================
    // Original Variation Tools
    // =========================================

    variation(track) {
        this._initRng();
        const p = this.sequencer.patterns[this.sequencer.currentPattern];
        const scale = this.getScale();
        for (let s = 0; s < this.sequencer.steps; s++) {
            if (!p[track][s] || this._random() > 0.2) continue;
            const idx = scale.indexOf(p[track][s].note);
            if (idx >= 0) {
                const ni = this._clamp(idx + (this._random() < 0.5 ? -1 : 1), 0, scale.length - 1);
                p[track][s] = { note: scale[ni], octave: p[track][s].octave };
            }
        }
        for (let s = this.sequencer.steps - 1; s >= 1; s--) {
            if (p[track][s] && !p[track][s - 1] && this._random() < 0.1) {
                p[track][s - 1] = p[track][s];
                p[track][s] = null;
            }
        }
    }

    fill(track) {
        this._initRng();
        const p = this.sequencer.patterns[this.sequencer.currentPattern];
        const scale = this.getScale();
        const start = Math.max(0, this.sequencer.steps - 4);
        for (let s = start; s < this.sequencer.steps; s++) {
            if (this._random() < 0.7) {
                if (track >= 4 && track <= 6) {
                    p[track][s] = {
                        ...[
                            { note: 'C', octave: 2 },
                            { note: 'C', octave: 3 },
                            { note: 'C', octave: 5 }
                        ][track - 4]
                    };
                } else {
                    p[track][s] = {
                        note: scale[(s - start) % scale.length],
                        octave: this.getOctaveForTrack(track)
                    };
                }
            }
        }
    }

    simplify(track) {
        this._initRng();
        const p = this.sequencer.patterns[this.sequencer.currentPattern];
        for (let s = 0; s < this.sequencer.steps; s++) {
            if (!p[track][s]) continue;
            if (this._random() < (s % 4 === 0 ? 0.1 : 0.4)) p[track][s] = null;
        }
    }

    complexify(track) {
        this._initRng();
        const p = this.sequencer.patterns[this.sequencer.currentPattern];
        const scale = this.getScale();
        for (let s = 0; s < this.sequencer.steps; s++) {
            if (p[track][s] || this._random() > 0.3) continue;
            let ref = null;
            for (let d = 1; d <= 4; d++) {
                if (s - d >= 0 && p[track][s - d]) {
                    ref = p[track][s - d];
                    break;
                }
                if (s + d < this.sequencer.steps && p[track][s + d]) {
                    ref = p[track][s + d];
                    break;
                }
            }
            if (ref && track < 4) {
                const idx = scale.indexOf(ref.note);
                if (idx >= 0) {
                    const ni = this._clamp(
                        idx + (this._random() < 0.5 ? -1 : 1),
                        0,
                        scale.length - 1
                    );
                    p[track][s] = { note: scale[ni], octave: ref.octave };
                }
            } else if (track >= 4 && track <= 6) {
                p[track][s] = {
                    ...[
                        { note: 'C', octave: 2 },
                        { note: 'C', octave: 3 },
                        { note: 'C', octave: 5 }
                    ][track - 4]
                };
            }
        }
    }

    // =========================================
    // Phase 3.4: Advanced Variation Tools
    // =========================================

    /** Transpose all notes by N scale degrees (stays in scale) */
    transpose(track, degrees) {
        const p = this.sequencer.patterns[this.sequencer.currentPattern];
        const scale = this.getScale();
        for (let s = 0; s < this.sequencer.steps; s++) {
            if (!p[track][s]) continue;
            const idx = scale.indexOf(p[track][s].note);
            if (idx < 0) continue;
            const { note, octave } = this._degreeToNote(scale, idx + degrees, p[track][s].octave);
            p[track][s] = { note, octave: this._clamp(octave, this.octaveMin, this.octaveMax) };
        }
    }

    /** Mirror pattern temporally (step 0 ↔ step N-1) */
    mirror(track) {
        const p = this.sequencer.patterns[this.sequencer.currentPattern];
        const n = this.sequencer.steps;
        const temp = [];
        for (let s = 0; s < n; s++) temp[s] = p[track][s] ? { ...p[track][s] } : null;
        for (let s = 0; s < n; s++) p[track][s] = temp[n - 1 - s];
    }

    /** Echo: copy notes N steps later with octave -1 and optional decay */
    echo(track, delay = 4, decay = 0.7) {
        this._initRng();
        const p = this.sequencer.patterns[this.sequencer.currentPattern];
        const n = this.sequencer.steps;
        // Work on a copy to avoid echoing echoes
        const original = [];
        for (let s = 0; s < n; s++) original[s] = p[track][s] ? { ...p[track][s] } : null;

        for (let s = 0; s < n; s++) {
            if (!original[s]) continue;
            const echoStep = s + delay;
            if (echoStep >= n) continue;
            if (p[track][echoStep]) continue; // don't overwrite existing notes
            if (this._random() > decay) continue;
            p[track][echoStep] = {
                note: original[s].note,
                octave: this._clamp(original[s].octave - 1, this.octaveMin, this.octaveMax)
            };
        }
    }

    /** Circular rhythm shift: rotate entire track pattern by N steps */
    rhythmShift(track, amount) {
        const p = this.sequencer.patterns[this.sequencer.currentPattern];
        const n = this.sequencer.steps;
        const shift = ((amount % n) + n) % n;
        const temp = [];
        for (let s = 0; s < n; s++) temp[s] = p[track][s] ? { ...p[track][s] } : null;
        for (let s = 0; s < n; s++) p[track][s] = temp[(s - shift + n) % n];
    }

    // =========================================
    // Multi-Pattern Song Generation
    // =========================================

    /**
     * Section roles: density/complexity/chaos multipliers + active tracks per section type.
     *   0=melody  1=harmony  2=bass  3=arp  4=kick  5=snare  6=hihat  7=fx
     */
    static SECTION_ROLES = {
        intro: {
            densityMult: 0.45,
            chaosMult: 0.6,
            complexityMult: 0.7,
            activeTracks: [0, 2, 4, 5],
            label: 'Intro'
        },
        verse: {
            densityMult: 0.75,
            chaosMult: 0.85,
            complexityMult: 0.85,
            activeTracks: [0, 1, 2, 3, 4, 5, 6],
            label: 'Verse'
        },
        prechorus: {
            densityMult: 0.9,
            chaosMult: 1.0,
            complexityMult: 1.0,
            activeTracks: [0, 1, 2, 3, 4, 5, 6, 7],
            label: 'Pre-Chorus'
        },
        chorus: {
            densityMult: 1.25,
            chaosMult: 1.1,
            complexityMult: 1.1,
            activeTracks: [0, 1, 2, 3, 4, 5, 6, 7],
            label: 'Chorus'
        },
        bridge: {
            densityMult: 0.65,
            chaosMult: 1.25,
            complexityMult: 1.2,
            activeTracks: [1, 2, 3, 4, 5, 6],
            label: 'Bridge'
        },
        breakdown: {
            densityMult: 0.3,
            chaosMult: 0.5,
            complexityMult: 0.5,
            activeTracks: [2, 4, 5],
            label: 'Breakdown'
        },
        buildup: {
            densityMult: 0.85,
            chaosMult: 0.9,
            complexityMult: 1.0,
            activeTracks: [0, 1, 2, 3, 4, 5, 6],
            label: 'Build-up'
        },
        outro: {
            densityMult: 0.5,
            chaosMult: 0.7,
            complexityMult: 0.65,
            activeTracks: [0, 2, 4],
            label: 'Outro'
        },
        fill: {
            densityMult: 1.1,
            chaosMult: 1.35,
            complexityMult: 1.25,
            activeTracks: [0, 2, 3, 4, 5, 6],
            label: 'Fill'
        }
    };

    /** Pre-defined song arcs for 2-8 patterns */
    static SONG_STRUCTURES = {
        2: ['verse', 'chorus'],
        3: ['intro', 'verse', 'chorus'],
        4: ['intro', 'verse', 'chorus', 'outro'],
        5: ['intro', 'verse', 'chorus', 'bridge', 'outro'],
        6: ['intro', 'verse', 'chorus', 'bridge', 'chorus', 'outro'],
        7: ['intro', 'verse', 'chorus', 'breakdown', 'buildup', 'chorus', 'outro'],
        8: ['intro', 'verse', 'chorus', 'breakdown', 'buildup', 'chorus', 'fill', 'outro']
    };

    /**
     * Generate a full multi-pattern song.
     * Fills patterns 0…(count-1) with musically coherent sections
     * (Intro → Verse → Chorus → … → Outro) sharing a single motif and
     * chord progression, and returns the chain that plays them in order.
     *
     * @param {number} count  Number of patterns to fill (2-8)
     * @returns {{ sections: string[], suggestedBPM: number, songChain: number[], seed: number }}
     */
    generateMultiPattern(count = 4) {
        count = this._clamp(Math.round(count), 2, 8);

        this._initRng();
        this._motif = this._generateMotif(); // shared melodic DNA

        const g = Generator.GENRES[this.genre];
        const arc = Generator.SONG_STRUCTURES[count] || Generator.SONG_STRUCTURES[4];
        const sections = arc.slice(0, count);

        // One shared chord progression: harmonic coherence across all patterns
        this._sharedProg = this._getChordProg();

        const savedPattern = this.sequencer.currentPattern;
        const savedParams = {
            density: this.density,
            complexity: this.complexity,
            chaos: this.chaos,
            octaveMin: this.octaveMin,
            octaveMax: this.octaveMax
        };

        const suggestedBPM = g
            ? Math.round(g.bpmRange[0] + this._random() * (g.bpmRange[1] - g.bpmRange[0]))
            : 120;

        const songChain = [];
        const sectionLabels = [];

        for (let pi = 0; pi < sections.length; pi++) {
            const roleName = sections[pi];
            const role = Generator.SECTION_ROLES[roleName] || Generator.SECTION_ROLES.verse;

            // Point all generators at this pattern index
            this.sequencer.currentPattern = pi;

            // Generate the pattern with role-adjusted settings
            this._generatePatternForRole(pi, role, g, savedParams);

            // Post-generation inter-section variations
            if (roleName === 'bridge') {
                // Bridge: shift harmony & arp up 2 scale degrees for tonal contrast
                if (role.activeTracks.includes(1)) this.transpose(1, 2);
                if (role.activeTracks.includes(3)) this.transpose(3, 2);
            } else if (roleName === 'fill') {
                // Fill: echo on melody creates forward-rushing feel
                if (role.activeTracks.includes(0)) this.echo(0, 2, 0.65);
            } else if (roleName === 'outro') {
                // Outro: mirror melody for a "rewound" ending
                if (role.activeTracks.includes(0)) this.mirror(0);
            }

            songChain.push(pi);
            sectionLabels.push(role.label);
        }

        // Restore state
        Object.assign(this, savedParams);
        this.sequencer.currentPattern = savedPattern;
        this._sharedProg = null;
        this._motif = null;

        // The chain is handed back rather than pinned onto the sequencer: the
        // caller passes it to the arrangement, which is what plays chains.
        const result = { sections: sectionLabels, suggestedBPM, songChain, seed: this._lastSeed };
        this._bus.emit(GENERATOR_EVENTS.generated, result);
        return result;
    }

    /**
     * Internal: fill one pattern (already selected via sequencer.currentPattern)
     * according to a section role. Drums are generated first for kick-reactivity.
     */
    _generatePatternForRole(pi, role, g, baseParams) {
        const saved = {
            density: this.density,
            complexity: this.complexity,
            chaos: this.chaos,
            octaveMin: this.octaveMin,
            octaveMax: this.octaveMax
        };

        // ── Drums first ───────────────────────────────────────────────────────
        if (role.activeTracks.some((t) => t >= 4 && t <= 6)) {
            if (g?.drumPreset && this.patternPresets) {
                this.patternPresets.applyPreset(g.drumPreset, 'fill', { resetInstruments: false });
                // Extend pattern to 32 steps if needed
                if (this.sequencer.steps > 16) {
                    const pat = this.sequencer.patterns[pi];
                    for (let tr = 4; tr <= 6; tr++)
                        for (let s = 16; s < this.sequencer.steps; s++)
                            pat[tr][s] = pat[tr][s - 16] ? { ...pat[tr][s - 16] } : null;
                }
                // Thin drums for sparse sections (intro, breakdown, outro)
                if (role.densityMult < 0.55) {
                    const pat = this.sequencer.patterns[pi];
                    for (let tr = 4; tr <= 6; tr++)
                        for (let s = 0; s < this.sequencer.steps; s++)
                            if (s % 4 !== 0 && this._random() > role.densityMult + 0.1)
                                pat[tr][s] = null;
                }
            } else if (g?.drumPreset === null) {
                [4, 5, 6].forEach((t) => this.sequencer.clearTrack(t));
            } else {
                this.density = this._clamp(baseParams.density * role.densityMult, 5, 100);
                this.complexity = this._clamp(baseParams.complexity * role.complexityMult, 5, 100);
                this.chaos = this._clamp(baseParams.chaos * role.chaosMult, 0, 100);
                [4, 5, 6]
                    .filter((t) => role.activeTracks.includes(t))
                    .forEach((t) => this.generateDrumPattern(t));
                [4, 5, 6]
                    .filter((t) => !role.activeTracks.includes(t))
                    .forEach((t) => this.sequencer.clearTrack(t));
            }
        } else {
            [4, 5, 6].forEach((t) => this.sequencer.clearTrack(t));
        }

        // ── Melodic tracks (melody 0 before harmony 1 for voice leading) ─────
        for (const track of [0, 1, 2, 3, 7]) {
            if (!role.activeTracks.includes(track)) {
                this.sequencer.clearTrack(track);
                continue;
            }

            // Genre track config if available, else global base
            const cfg = g?.tracks?.[track];
            const base = cfg
                ? {
                      density: cfg.density,
                      complexity: cfg.complexity,
                      chaos: cfg.chaos,
                      octaveMin: cfg.octaveRange[0],
                      octaveMax: cfg.octaveRange[1]
                  }
                : {
                      density: baseParams.density,
                      complexity: baseParams.complexity,
                      chaos: baseParams.chaos,
                      octaveMin: baseParams.octaveMin,
                      octaveMax: baseParams.octaveMax
                  };

            // Apply role multipliers
            this.density = this._clamp(base.density * role.densityMult, 5, 100);
            this.complexity = this._clamp(base.complexity * role.complexityMult, 5, 100);
            this.chaos = this._clamp(base.chaos * role.chaosMult, 0, 100);
            this.octaveMin = base.octaveMin;
            this.octaveMax = base.octaveMax;

            switch (track) {
                case 0:
                    this.generateMelody(0);
                    break;
                case 1:
                    this.generateHarmony(1);
                    break;
                case 2:
                    this.generateBassLine(2);
                    break;
                case 3:
                    this.generateArpeggio(3);
                    break;
                case 7:
                    this.generateFX(7);
                    break;
            }
        }

        Object.assign(this, saved);
    }

    // =========================================
    // State save / restore for Generator Presets
    // =========================================

    /** Capture all generator parameters into a serializable object */
    getState() {
        return {
            chaos: this.chaos,
            complexity: this.complexity,
            density: this.density,
            swing: this.swing,
            humanize: this.humanize,
            octaveMin: this.octaveMin,
            octaveMax: this.octaveMax,
            rootKey: this.rootKey,
            scaleType: this.scaleType,
            genre: this.genre,
            mood: this.mood,
            phraseLength: this.phraseLength,
            seed: this.seed
        };
    }

    /** Restore generator parameters from a state object and sync UI */
    loadState(state) {
        if (!state) return;
        if (state.chaos !== undefined) this.chaos = state.chaos;
        if (state.complexity !== undefined) this.complexity = state.complexity;
        if (state.density !== undefined) this.density = state.density;
        if (state.swing !== undefined) this.swing = state.swing;
        if (state.humanize !== undefined) this.humanize = state.humanize;
        if (state.octaveMin !== undefined) this.octaveMin = state.octaveMin;
        if (state.octaveMax !== undefined) this.octaveMax = state.octaveMax;
        if (state.rootKey !== undefined) this.rootKey = state.rootKey;
        if (state.scaleType !== undefined) this.scaleType = state.scaleType;
        if (state.genre !== undefined) this.genre = state.genre;
        if (state.mood !== undefined) this.mood = state.mood;
        if (state.phraseLength !== undefined) this.phraseLength = parseInt(state.phraseLength) || 8;
        if (state.seed !== undefined) this.seed = parseInt(state.seed) || 0;

        this._bus.emit(GENERATOR_EVENTS.changed, this.getState());
    }

    // =========================================
    // Built-in Generator Presets
    // =========================================

    /**
     * The generator presets the studio ships with, read from `library/`.
     *
     * A getter rather than a field: the catalogue is loaded when its module
     * is, and a static field would be evaluated while this class is still
     * being defined.
     */
    static get BUILTIN_PRESETS() {
        return Object.fromEntries(
            Object.entries(shipped('generator-presets')).map(([id, item]) => [
                id,
                // The genre is both what files the preset and one of the
                // settings it restores, so it is in the payload already.
                { name: item.name, ...item.data }
            ])
        );
    }

    /** Get built-in presets as unified preset list objects */
    getBuiltinPresetList() {
        return Object.entries(Generator.BUILTIN_PRESETS).map(([key, p]) => ({
            id: 'genbuiltin:' + key,
            presetKey: key,
            name: p.name,
            type: p.genre,
            designer: '8BitForge',
            source: 'builtin',
            isPublic: false,
            data: { ...p },
            created_at: null
        }));
    }
}
