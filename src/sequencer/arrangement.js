/**
 * Arrangement: chain patterns into a song.
 *
 * The chain is a list of measures. Each measure holds a pattern index, or
 * null for a silent measure. While playback runs, the sequencer calls
 * `onStep` on every step; the chain advances when a pattern wraps round to
 * step 0, which is what makes one measure last exactly one pattern.
 *
 * The first step 0 after starting must not advance: playback is already on
 * the right measure: hence `hasPlayedFirstStep`.
 */

import { bus as sharedBus } from '../core/event-bus.js';
import { PATTERN_COUNT } from './sequencer.js';

export const ARRANGEMENT_EVENTS = Object.freeze({
    changed: 'arrangement:changed',
    advanced: 'arrangement:advanced',
    enabled: 'arrangement:enabled'
});

/** Pattern letters, as shown in the interface. */
export const PATTERN_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

/** Ready-made song structures. */
export const CHAIN_PRESETS = {
    'verse-chorus': {
        name: 'Verse-Chorus',
        i18nKey: 'arr.preset.verseChorus',
        chain: [0, 1, 0, 1]
    },
    'intro-verse-chorus-outro': {
        name: 'Song Structure',
        i18nKey: 'arr.preset.songStructure',
        chain: [0, 1, 2, 1, 2, 3]
    },
    'a-b-a': {
        name: 'A-B-A',
        i18nKey: 'arr.preset.aba',
        chain: [0, 1, 0]
    },
    progressive: {
        name: 'Progressive',
        i18nKey: 'arr.preset.progressive',
        chain: [0, 0, 1, 1, 2, 2, 3, 3]
    },
    '8-bar': {
        name: '8-Bar Loop',
        i18nKey: 'arr.preset.eightBar',
        chain: [0, 1, 2, 3, 4, 5, 6, 7]
    }
};

export class Arrangement {
    /**
     * @param {import('./sequencer.js').Sequencer} sequencer
     * @param {object} [options]
     * @param {import('../core/event-bus.js').EventBus} [options.bus]
     */
    constructor(sequencer, { bus = sharedBus } = {}) {
        this.sequencer = sequencer;
        this._bus = bus;

        this.enabled = false;
        /** @type {Array<number|null>} pattern index per measure, null = silence */
        this.chain = [];
        this.currentChainIndex = 0;

        /** Guards the first step 0, which must not advance the chain. */
        this.hasPlayedFirstStep = false;

        /** How many measures the mixer automation lanes span. */
        this.mixerMeasures = 8;
    }

    // ── Chain editing ────────────────────────────────────────────────────

    /**
     * @param {Array<number|null>} measures
     * @param {boolean} [preservePosition] keep the playback position as it is
     */
    setChain(measures, preservePosition = false) {
        this.chain = measures.map(normalizeMeasure);

        if (!preservePosition && this.currentChainIndex >= this.chain.length) {
            // Clamp rather than rewind: shortening a chain during playback
            // should not throw the song back to its first measure.
            this.currentChainIndex = Math.max(0, this.chain.length - 1);
        }
        this._announce();
    }

    /** @returns {Array<number|null>} a copy of the chain */
    getChain() {
        return [...this.chain];
    }

    addToChain(patternIndex) {
        if (!isPatternIndex(patternIndex)) return false;
        this.chain.push(patternIndex);
        this._announce();
        return true;
    }

    insertAtIndex(patternIndex, position) {
        if (!isPatternIndex(patternIndex)) return false;
        const at = Math.max(0, Math.min(position, this.chain.length));
        this.chain.splice(at, 0, patternIndex);
        this._announce();
        return true;
    }

    removeFromChain(chainIndex) {
        if (chainIndex < 0 || chainIndex >= this.chain.length) return false;
        this.chain.splice(chainIndex, 1);
        if (this.currentChainIndex >= this.chain.length) {
            this.currentChainIndex = Math.max(0, this.chain.length - 1);
        }
        this._announce();
        return true;
    }

    moveInChain(fromIndex, toIndex) {
        const inRange = (i) => i >= 0 && i < this.chain.length;
        if (!inRange(fromIndex) || !inRange(toIndex)) return false;

        const [measure] = this.chain.splice(fromIndex, 1);
        this.chain.splice(toIndex, 0, measure);
        this._announce();
        return true;
    }

    clearChain() {
        this.chain = [];
        this.currentChainIndex = 0;
        this._announce();
    }

    /** @param {string} presetName a key of CHAIN_PRESETS */
    loadPreset(presetName) {
        const preset = CHAIN_PRESETS[presetName];
        if (!preset) return false;

        this.setChain(preset.chain);
        this.currentChainIndex = 0;
        return true;
    }

    // ── Mode ─────────────────────────────────────────────────────────────

    enable() {
        this.enabled = true;
        this.currentChainIndex = 0;
        this.hasPlayedFirstStep = false;
        this._switchToCurrentMeasure();
        this._bus.emit(ARRANGEMENT_EVENTS.enabled, true);
    }

    disable() {
        this.enabled = false;
        this.currentChainIndex = 0;
        this.hasPlayedFirstStep = false;
        this._bus.emit(ARRANGEMENT_EVENTS.enabled, false);
    }

    toggle() {
        if (this.enabled) this.disable();
        else this.enable();
        return this.enabled;
    }

    /** True when the chain should actually drive playback. */
    get isActive() {
        return this.enabled && this.chain.length > 0;
    }

    // ── Playback ─────────────────────────────────────────────────────────

    /** Called by the sequencer when playback stops. */
    resetPlayback() {
        this.currentChainIndex = 0;
        this.hasPlayedFirstStep = false;
        if (this.enabled) this._switchToCurrentMeasure();
    }

    /** Jump to a measure of the chain. */
    seekTo(measureIndex) {
        if (measureIndex < 0 || this.chain.length === 0) return false;

        this.currentChainIndex = Math.min(measureIndex, this.chain.length - 1);
        // The next step 0 plays this measure instead of moving on from it.
        this.hasPlayedFirstStep = false;

        this._switchToCurrentMeasure();
        this.sequencer.currentStep = 0;
        this._emitAdvanced();
        return true;
    }

    /** Called by the sequencer on every scheduled step. */
    onStep(currentStep) {
        if (!this.isActive) return;
        if (currentStep !== 0 || !this.sequencer.isPlaying) return;

        if (!this.hasPlayedFirstStep) {
            this.hasPlayedFirstStep = true;
            return;
        }
        this.advanceChain();
    }

    advanceChain() {
        if (this.chain.length === 0) return;

        this.currentChainIndex++;
        if (this.currentChainIndex >= this.chain.length) {
            if (!this.sequencer.isLooping) {
                // End of the song. Reset so the next play starts from the top;
                // the interface redraws on the sequencer's stop event.
                this.currentChainIndex = 0;
                this.hasPlayedFirstStep = false;
                this.sequencer.stop();
                return;
            }
            this.currentChainIndex = 0;
        }

        this._switchToCurrentMeasure();
        this._emitAdvanced();
    }

    /** @returns {number|null} the pattern of the current measure */
    getCurrentPattern() {
        if (this.chain.length === 0) return 0;
        return this.chain[this.currentChainIndex];
    }

    /** Human-readable chain, such as `A-B-A-C`; a silent measure shows as `-`. */
    getChainString() {
        if (this.chain.length === 0) return '(empty)';
        return this.chain
            .map((measure) => (measure === null ? '-' : (PATTERN_LETTERS[measure] ?? measure)))
            .join('-');
    }

    // ── Persistence ──────────────────────────────────────────────────────

    serialize() {
        return {
            enabled: this.enabled,
            chain: [...this.chain],
            currentChainIndex: this.currentChainIndex,
            mixerMeasures: this.mixerMeasures
        };
    }

    /** Replaces the whole song: a project with no arrangement has an empty one. */
    deserialize(data) {
        data = data || {};
        this.enabled = data.enabled || false;
        this.chain = Array.isArray(data.chain) ? data.chain.map(normalizeMeasure) : [];
        this.currentChainIndex = data.currentChainIndex || 0;
        this.mixerMeasures = data.mixerMeasures || 8;
        this._announce();
    }

    // ── Internals ────────────────────────────────────────────────────────

    /** Point the sequencer at the current measure, unless it is silent. */
    _switchToCurrentMeasure() {
        const pattern = this.chain[this.currentChainIndex];
        if (pattern !== null && pattern !== undefined) {
            this.sequencer.switchPattern(pattern);
        }
    }

    _emitAdvanced() {
        // While the sequencer books ahead, the move has not been heard yet: it
        // is announced later, with the step it belongs to.
        if (this.sequencer._scheduling) return;
        this._bus.emit(ARRANGEMENT_EVENTS.advanced, {
            chainIndex: this.currentChainIndex,
            pattern: this.getCurrentPattern()
        });
    }

    _announce() {
        this._bus.emit(ARRANGEMENT_EVENTS.changed, {
            chain: [...this.chain],
            enabled: this.enabled
        });
    }
}

/** A measure is a valid pattern index, or null for silence. */
function normalizeMeasure(value) {
    return isPatternIndex(value) ? value : null;
}

function isPatternIndex(value) {
    return Number.isInteger(value) && value >= 0 && value < PATTERN_COUNT;
}
