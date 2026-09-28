/**
 * Pattern presets: rhythmic templates for the drum tracks.
 *
 * A preset writes a rhythm into tracks 4 to 6 (kick, snare, hi-hat). Each one
 * can carry three variants: the base groove, a variation and a fill.
 *
 * Applying one either fills the pattern, tiling the rhythm to cover every
 * step, or appends it after what is already there.
 */

import { bus as sharedBus } from '../core/event-bus.js';
import { SEQUENCER_EVENTS } from '../sequencer/sequencer.js';

import { shipped } from '../content/shipped.js';
import { writeRhythm } from './rhythm-grid.js';

export class PatternPresets {
    /**
     * @param {import('../sequencer/sequencer.js').Sequencer} sequencer
     * @param {import('../audio/audio-engine.js').AudioEngine} audioEngine
     * @param {object} [options]
     * @param {import('../core/event-bus.js').EventBus} [options.bus]
     */
    constructor(sequencer, audioEngine, { bus = sharedBus } = {}) {
        this.sequencer = sequencer;
        this.audioEngine = audioEngine;
        this._bus = bus;
        this.presets = this.initPresets();
    }

    // Reset drum tracks (4/5/6) to factory instrument settings
    // Remplace les objets entiers pour éliminer tout résidu
    resetDrumInstruments() {
        if (!this.audioEngine) return;

        const defaultMod = {
            filterCutoff: 20000,
            filterQ: 0.1,
            filterEnabled: false,
            filterType: 'lowpass',
            filterKeyTrack: 0,
            filterLfoRate: 0,
            filterLfoDepth: 0,
            lfoFilterRate: 0,
            lfoFilterDepth: 0,
            tremoloRate: 0,
            tremoloDepth: 0,
            filterEnvAmount: 0,
            filterEnvAttack: 0.01,
            filterEnvRelease: 0.2,
            unisonVoices: 1,
            unisonDetune: 0,
            unisonSpread: 0,
            octaveOffset: 0,
            semitoneOffset: 0,
            phase: 0,
            lfo1Wave: 'sine',
            lfo1Sync: false,
            lfo1Delay: 0,
            lfo2Wave: 'sine',
            lfo2Sync: false,
            lfo2Delay: 0,
            lfo3Wave: 'sine',
            lfo3Sync: false,
            lfo3Delay: 0
        };

        // Track 4: Kick (v2: volume 0.80 -> 0.50)
        this.audioEngine.tracks[4] = {
            type: 'sine',
            volume: 0.5,
            dutyCycle: 0.5,
            detune: 0,
            pitchEnv: 36,
            glide: 0,
            ...defaultMod
        };
        this.audioEngine.envelopes[4] = { attack: 0.001, decay: 0.3, sustain: 0.0, release: 0.02 };
        this.audioEngine.vibrato[4] = { rate: 0, depth: 0 };

        // Track 5: Snare (v2: volume 0.60 -> 0.35)
        this.audioEngine.tracks[5] = {
            type: 'noise',
            volume: 0.35,
            dutyCycle: 0.5,
            detune: 0,
            pitchEnv: 0,
            glide: 0,
            ...defaultMod
        };
        this.audioEngine.envelopes[5] = { attack: 0.001, decay: 0.15, sustain: 0.0, release: 0.05 };
        this.audioEngine.vibrato[5] = { rate: 0, depth: 0 };

        // Track 6: Hi-hat (v2: volume 0.45 -> 0.25)
        this.audioEngine.tracks[6] = {
            type: 'noise',
            volume: 0.25,
            dutyCycle: 0.5,
            detune: 0,
            pitchEnv: 0,
            glide: 0,
            ...defaultMod
        };
        this.audioEngine.envelopes[6] = { attack: 0.001, decay: 0.06, sustain: 0.0, release: 0.01 };
        this.audioEngine.vibrato[6] = { rate: 0, depth: 0 };
    }

    /**
     * Returns category metadata for UI rendering
     */
    getCategories() {
        // The shelves a rhythm can sit on, with the icon and colour the
        // panel paints each header in. No names: what a shelf is called is
        // the interface's business, and `src/ui/library-categories.js`
        // holds the labels where the translation test can see them.
        return [
            { id: 'electronic', icon: 'ti-bolt', color: '#3498db' },
            { id: 'urban', icon: 'ti-microphone-2', color: '#e74c3c' },
            { id: 'world', icon: 'ti-world', color: '#f39c12' },
            { id: 'classic', icon: 'ti-guitar-pick', color: '#2ecc71' },
            { id: 'retro', icon: 'ti-device-gamepad-2', color: '#9b59b6' }
        ];
    }

    /**
     * The rhythms the studio ships with, read from `library/`.
     *
     * These were not data at all until recently: each of the sixty was
     * three closures that wrote into the live grid with strided loops, and
     * between them they were most of this file. They are rows of `x` and
     * `.` now (see `rhythm-grid.js`) which is a shape a person can read
     * in a file and a shape this module can play.
     */
    initPresets() {
        return Object.fromEntries(
            Object.entries(shipped('rhythms')).map(([id, item]) => [
                id,
                {
                    name: item.name,
                    category: item.category,
                    description: item.data.description,
                    variants: item.data.variants
                }
            ])
        );
    }

    /** Helper: get current pattern data array */
    _pattern() {
        return this.sequencer.patterns[this.sequencer.currentPattern];
    }

    /**
     * Apply a rhythm preset with mode support
     * @param {string} presetName - preset key
     * @param {'fill'|'append'} mode - 'fill' (default): tile to cover all steps; 'append': add after existing content
     * @param {Object} options
     * @param {boolean} options.resetInstruments - reset drum sounds to factory defaults
     * @param {'base'|'variation'|'fill'} options.variant - which variant to apply
     * @returns {boolean|string} true on success, false on error, 'full' if no room to append
     */
    applyPreset(presetName, mode = 'fill', { resetInstruments = false, variant = 'base' } = {}) {
        const preset = this.presets[presetName];
        if (!preset) {
            console.error('Preset not found:', presetName);
            return false;
        }

        const steps = this.sequencer.steps;
        const pattern = this._pattern();

        // A variant the preset does not have falls back to its base, which
        // is why `base` is the one a rhythm file cannot leave out.
        const rows = preset.variants?.[variant] ?? preset.variants?.base;
        const applyFn = () => writeRhythm(rows, pattern);

        if (mode === 'append') {
            return this._applyAppend({ ...preset, apply: applyFn }, pattern, steps);
        }

        // === FILL mode (default) ===

        // 1. Reset drum instruments to factory defaults (skip when called from generator)
        if (resetInstruments) this.resetDrumInstruments();

        // 2. Clear drum tracks (full range up to steps or 32, whichever is larger)
        const clearMax = Math.max(steps, 32);
        for (let track = 4; track < 7; track++) {
            for (let step = 0; step < clearMax; step++) {
                pattern[track][step] = null;
            }
        }

        // 3. Apply the preset variant
        applyFn();

        // 4. Detect native preset length
        const presetLength = this._detectPresetLength(pattern);

        // 5. Tile to fill all steps if preset is shorter
        if (presetLength > 0 && presetLength < steps) {
            this._tileToLength(pattern, presetLength, steps);
        }

        // 6. Refresh the grid
        this._announce();
        return true;
    }

    /**
     * APPEND mode: add preset after existing drum content without clearing
     */
    _applyAppend(preset, pattern, steps) {
        // 1. Find insert offset (next aligned position after last drum content)
        const insertOffset = this._findInsertOffset(pattern, steps);
        if (insertOffset >= steps) {
            // Pattern is full, no room to append
            return 'full';
        }

        // 2. Save current drum data
        const saved = {};
        const saveMax = Math.max(steps, 32);
        for (let track = 4; track < 7; track++) {
            saved[track] = [];
            for (let step = 0; step < saveMax; step++) {
                saved[track][step] = pattern[track][step] || null;
            }
        }

        // 3. Clear drum tracks and apply preset to read clean data
        for (let track = 4; track < 7; track++) {
            for (let step = 0; step < saveMax; step++) {
                pattern[track][step] = null;
            }
        }
        preset.apply();

        // 4. Read back the preset data and detect its length
        const presetData = {};
        for (let track = 4; track < 7; track++) {
            presetData[track] = [];
            for (let step = 0; step < 32; step++) {
                presetData[track][step] = pattern[track][step];
            }
        }
        const presetLength = this._detectPresetLength(pattern);

        // 5. Restore original drum data
        for (let track = 4; track < 7; track++) {
            for (let step = 0; step < saveMax; step++) {
                pattern[track][step] = saved[track][step];
            }
        }

        // 6. Copy preset data at insert offset (truncate if exceeds steps)
        if (presetLength > 0) {
            for (let track = 4; track < 7; track++) {
                for (let i = 0; i < presetLength; i++) {
                    const targetStep = insertOffset + i;
                    if (targetStep >= steps) break;
                    if (presetData[track][i]) {
                        pattern[track][targetStep] = { ...presetData[track][i] };
                    }
                }
            }
        }

        this._announce();
        return true;
    }

    /**
     * Detect the native length of a preset by finding the highest occupied step
     * on drum tracks, then rounding up to the next multiple of 8
     */
    _detectPresetLength(pattern) {
        let highestIndex = -1;
        for (let track = 4; track < 7; track++) {
            for (let step = 31; step >= 0; step--) {
                if (pattern[track][step]) {
                    highestIndex = Math.max(highestIndex, step);
                    break;
                }
            }
        }
        if (highestIndex < 0) return 0;
        return Math.ceil((highestIndex + 1) / 8) * 8;
    }

    /**
     * Tile (repeat) drum tracks from [0..presetLength-1] to fill [presetLength..totalSteps-1]
     */
    _tileToLength(pattern, presetLength, totalSteps) {
        for (let track = 4; track < 7; track++) {
            for (let step = presetLength; step < totalSteps; step++) {
                const srcStep = step % presetLength;
                if (pattern[track][srcStep]) {
                    pattern[track][step] = { ...pattern[track][srcStep] };
                } else {
                    pattern[track][step] = null;
                }
            }
        }
    }

    /**
     * Find the insert offset for append mode: next multiple-of-8 boundary
     * after the last occupied drum step
     */
    _findInsertOffset(pattern, steps) {
        let lastOccupied = -1;
        for (let track = 4; track < 7; track++) {
            for (let step = steps - 1; step >= 0; step--) {
                if (pattern[track][step]) {
                    lastOccupied = Math.max(lastOccupied, step);
                    break;
                }
            }
        }
        if (lastOccupied < 0) return 0;
        // Align to next multiple of 8 for clean boundaries
        return Math.ceil((lastOccupied + 1) / 8) * 8;
    }

    getPresetList() {
        return Object.keys(this.presets).map((key) => ({
            id: key,
            name: this.presets[key].name,
            category: this.presets[key].category,
            description: this.presets[key].description
        }));
    }

    /**
     * Get presets grouped by category
     */
    getPresetsByCategory() {
        const categories = this.getCategories();
        const grouped = {};
        categories.forEach((cat) => {
            grouped[cat.id] = {
                ...cat,
                presets: []
            };
        });
        Object.keys(this.presets).forEach((key) => {
            const preset = this.presets[key];
            if (grouped[preset.category]) {
                grouped[preset.category].presets.push({
                    id: key,
                    name: preset.name,
                    description: preset.description
                });
            }
        });
        return grouped;
    }

    /** The drum tracks changed; the grid redraws itself. */
    _announce() {
        this._bus.emit(SEQUENCER_EVENTS.cellsChanged, {
            pattern: this.sequencer.currentPattern,
            track: null
        });
    }
}
