/**
 * The generator panel.
 *
 * Key, scale, genre, mood, the three character sliders, and the buttons that
 * write music into the patterns. The panel only reads and writes the
 * generator's own state: the composing is entirely in `compose/generator.js`.
 *
 * Generating is undoable: each button records the state it produced, so a
 * result you dislike costs one Ctrl+Z rather than the work that came before
 * it.
 */

import { GENERATOR_EVENTS } from '../compose/generator.js';
import { TRACK_COUNT } from '../sequencer/sequencer.js';

/**
 * A control bound to a setter, and the label that shows its value.
 *
 * Exported with the others so a test can hold every id here against the
 * markup: `_el` returns null for an id that is not there and the panel
 * carries on, which is how `phraseSelect` sat beside a
 * `phraseLengthSelect` in the page and froze the phrase length at its
 * default for every piece the generator wrote.
 */
export const SLIDERS = [
    { id: 'chaosSlider', set: 'setChaos', value: 'chaosValue' },
    { id: 'complexitySlider', set: 'setComplexity', value: 'complexityValue' },
    { id: 'densitySlider', set: 'setDensity', value: 'densityValue' },
    { id: 'swingGenSlider', set: 'setSwing', value: 'swingGenValue' },
    { id: 'humanizeSlider', set: 'setHumanize', value: 'humanizeValue' }
];

/**
 * The two register drop-downs are labelled with notes - C1 up to C7 -
 * and the generator counts plain octaves. `Number('C4')` is NaN, and a
 * NaN octave reaches every note written and is reported by nothing, so
 * the two are translated rather than assumed to be the same thing.
 */
const octaveOf = (value) => Number.parseInt(String(value ?? '').replace(/\D/g, ''), 10);
const noteAt = (octave) => `C${octave}`;

export const SELECTS = [
    { id: 'genRootKey', set: 'setRootKey' },
    { id: 'genScaleType', set: 'setScaleType' },
    { id: 'genreSelect', set: 'setGenre' },
    { id: 'moodSelect', set: 'setMood' },
    { id: 'phraseLengthSelect', set: 'setPhraseLength' }
];

/** Which track each single-track button writes to. */
export const TRACK_BUTTONS = {
    genMelody: 0,
    genHarmony: 1,
    genBass: 2,
    genArp: 3,
    genFX: 7
};

/** How long the copy button shows a tick before going back to its icon. */
const COPIED_MS = 1200;

/** Transformations that rework what is already there. */
export const VARIATIONS = {
    genVariation: 'variation',
    genFill: 'fill',
    genSimplify: 'simplify',
    genComplexify: 'complexify'
};

export class GeneratorPanel {
    /**
     * @param {object} options
     * @param {ParentNode} options.root
     * @param {import('../studio.js').Studio} options.studio
     * @param {() => void} [options.onGenerated]  redraw the grid
     */
    constructor({ root, studio, onGenerated = () => {} }) {
        this.root = root;
        this.studio = studio;
        this.onGenerated = onGenerated;
    }

    bind() {
        this._bindParameters();
        this._bindButtons();
        this.sync();

        this.studio.bus.on(GENERATOR_EVENTS.changed, () => this.sync());
    }

    _el(id) {
        return this.root.querySelector(`#${id}`);
    }

    // ── Parameters ───────────────────────────────────────────────────────

    _bindParameters() {
        const { generator } = this.studio;

        for (const { id, set, value } of SLIDERS) {
            const slider = this._el(id);
            if (!slider) continue;

            slider.addEventListener('input', () => {
                generator[set](Number(slider.value));
                const label = this._el(value);
                if (label) label.textContent = slider.value;
            });
        }

        for (const { id, set } of SELECTS) {
            const select = this._el(id);
            select?.addEventListener('change', () => generator[set](select.value));
        }

        const seed = this._el('seedInput');
        seed?.addEventListener('change', () => generator.setSeed(seed.value));

        this._el('seedCopyBtn')?.addEventListener('click', () => this._copySeed());

        this._el('seedRefreshBtn')?.addEventListener('click', () => {
            // A fresh seed is a new piece; zero means "draw one each time".
            const drawn = Math.floor(Math.random() * 2147483647);
            generator.setSeed(drawn);
            if (seed) seed.value = String(drawn);
        });

        const min = this._el('genNoteMin');
        const max = this._el('genNoteMax');
        for (const select of [min, max]) {
            select?.addEventListener('change', () => {
                generator.setNoteRange(octaveOf(min?.value), octaveOf(max?.value));

                // The generator puts the pair in order, and the two
                // drop-downs have to agree with it: picking C5 below and
                // C3 above is a range of C3 to C5, and should read as one.
                if (min) min.value = noteAt(generator.octaveMin);
                if (max) max.value = noteAt(generator.octaveMax);
            });
        }
    }

    /**
     * Put the seed on the clipboard.
     *
     * A seed is the one number that makes a piece reproducible, so it is
     * worth passing to someone else: and worth saying it has been copied,
     * since nothing else on screen changes. The button's icon becomes a tick
     * for a moment, as it did before.
     */
    async _copySeed() {
        const button = this._el('seedCopyBtn');
        const seed = this._el('seedInput')?.value || '0';

        try {
            await navigator.clipboard?.writeText(seed);
        } catch {
            // Denied, or no clipboard: better to say nothing than to claim
            // a copy that did not happen.
            return;
        }

        const icon = button?.querySelector('i');
        if (!icon) return;

        icon.className = 'ti ti-check';
        window.setTimeout(() => {
            icon.className = 'ti ti-copy';
        }, COPIED_MS);
    }

    // ── Buttons ──────────────────────────────────────────────────────────

    _bindButtons() {
        this._el('genAll')?.addEventListener('click', () =>
            this._generate('Generate all', () => {
                const result = this.studio.generator.generateAll();
                if (result?.suggestedBPM) this.studio.sequencer.setBPM(result.suggestedBPM);
            })
        );

        for (const [id, track] of Object.entries(TRACK_BUTTONS)) {
            this._el(id)?.addEventListener('click', () =>
                this._generate(`Generate track`, () =>
                    this.studio.generator.generateForTrack(track)
                )
            );
        }

        this._el('genDrum')?.addEventListener('click', () =>
            this._generate('Generate drums', () => {
                // The drum kit is three tracks, generated together so the
                // kick, snare and hi-hat agree with each other.
                for (const track of [4, 5, 6]) this.studio.generator.generateForTrack(track);
            })
        );

        this._el('genMultiPattern')?.addEventListener('click', () =>
            this._generate('Generate song', () => {
                const count = Number(this._el('genMultiCount')?.value ?? 4);
                const result = this.studio.generator.generateMultiPattern(count);

                if (result?.suggestedBPM) this.studio.sequencer.setBPM(result.suggestedBPM);
                // The generator hands back the chain; the arrangement plays it.
                if (result?.songChain?.length) {
                    this.studio.arrangement.setChain(result.songChain);
                    this.studio.arrangement.enable();
                }
            })
        );

        for (const [id, method] of Object.entries(VARIATIONS)) {
            this._el(id)?.addEventListener('click', () =>
                this._generate(method, () => {
                    // These rework the whole arrangement, not the track that
                    // happens to be selected: VARY on a song should vary the
                    // song. Reworking one track left the other seven against
                    // a part that had moved under them.
                    for (let track = 0; track < TRACK_COUNT; track++) {
                        this.studio.generator[method](track);
                    }
                })
            );
        }
    }

    /**
     * Run a generation with the audio started, and record it.
     *
     * The snapshot comes after the work: an entry holds the state that
     * followed the change it is named for, which is what makes one undo
     * reverse one change. See `tests/undo-redo.test.js`.
     */
    async _generate(label, work) {
        await this.studio.start();

        work();

        this.studio.history.saveState(label);
        this.onGenerated();
    }

    // ── Reading the state back ───────────────────────────────────────────

    /** Read every control back from the generator's state. */
    sync() {
        const state = this.studio.generator.getState();

        for (const { id, value } of SLIDERS) {
            const slider = this._el(id);
            const key = id.replace('Slider', '').replace('swingGen', 'swing');
            if (slider && state[key] !== undefined) slider.value = state[key];

            const label = this._el(value);
            if (label && state[key] !== undefined) label.textContent = String(state[key]);
        }

        const set = (id, value) => {
            const element = this._el(id);
            if (element && value !== undefined) element.value = value;
        };

        set('genRootKey', state.rootKey);
        set('genScaleType', state.scaleType);
        set('genreSelect', state.genre);
        set('moodSelect', state.mood);
        set('phraseLengthSelect', state.phraseLength);
        set('seedInput', state.seed);
        set('genNoteMin', noteAt(state.octaveMin));
        set('genNoteMax', noteAt(state.octaveMax));
    }
}
