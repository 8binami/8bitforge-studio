/**
 * The synth tab of the studio window.
 *
 * One track's voice, in six sub-tabs: oscillator, filter, modulation,
 * envelope, effects and arpeggiator. Which track is being edited is the
 * synthesizer's `currentTrack`, so opening the window from a track row edits
 * that row.
 *
 * Every control comes from `synth-parameters.js`, and this walks that list
 * twice: once to listen, once to read back. The number of decimals a value
 * is printed to is taken from the slider's own `step`, because the markup
 * already says how fine each one is and a second list would drift from it.
 *
 * The effects chain is the one thing here that does not exist until the
 * audio does. Its controls stay where the markup left them until the first
 * press of Play, rather than being wound to zero and lying about it.
 */

import { SYNTH_CONTROLS, UNDO_LABEL } from './synth-parameters.js';
import { SYNTH_PADS } from './synth-pads.js';
import { bindKnobs, refreshKnob } from './synth-knob.js';
import { XyPad } from './xy-pad.js';
import { SynthVisuals } from './synth-visuals.js';
import { translateOr } from '../i18n/i18n.js';

/**
 * Moving a control changes the sound without the synthesizer announcing it:
 * the setters write straight through to the engine, which is what keeps a
 * drag from redrawing the window two hundred times. So the panel says when
 * the user has moved something, for the parts of the window that show what
 * the track is rather than what its knobs are at.
 */

/** How long the panel waits, mid-drag, before recording an undo entry. */
const UNDO_DELAY_MS = 800;

export class SynthPanel {
    /**
     * @param {object} options
     * @param {ParentNode} options.root
     * @param {import('../studio.js').Studio} options.studio
     * @param {() => void} [options.onEdited]  the user moved something
     * @param {(text: string) => void} [options.onStatus]
     */
    constructor({ root, studio, onEdited = () => {}, onStatus = () => {} }) {
        this.root = root;
        this.studio = studio;
        this.onEdited = onEdited;
        this.onStatus = onStatus;

        /** @type {Map<string, {control: object, element: HTMLElement, value: HTMLElement|null, decimals: number}>} */
        this._controls = new Map();
        /** @type {Array<{definition: object, pad: XyPad}>} */
        this._pads = [];
        /** Knob id → the pads showing the same parameter. */
        this._shadowedBy = new Map();

        /** The fifteen read-only pictures beside the controls. */
        this.visuals = new SynthVisuals({ root });
    }

    bind() {
        for (const control of SYNTH_CONTROLS) {
            const element = this.root.querySelector(`#${control.id}`);
            if (!element) continue;

            const bound = {
                control,
                element,
                value: control.value ? this.root.querySelector(`#${control.value}`) : null,
                decimals: decimalsOf(element)
            };
            this._controls.set(control.id, bound);

            // A range reports every pixel of a drag; a select or a checkbox
            // only reports when it settles.
            const event = control.kind === 'range' ? 'input' : 'change';
            element.addEventListener(event, () => this._onChange(bound));
        }

        // The stylesheet draws these controls as knobs and hides the input
        // itself, so the knob behaviour is what makes them movable at all.
        const pane = this.root.querySelector('#studioSynthPane');
        if (pane) bindKnobs(pane);

        this._bindPads();
        this.visuals.bind();
        this._bindRedraws();
        this._bindEffectPresets();
        this.sync();
    }

    /**
     * The moments a canvas can first measure itself.
     *
     * A canvas inside a hidden pane has no width, so one drawn before its
     * sub-tab was ever shown comes out empty. Redrawing when a pane appears
     * is cheaper than watching twenty-four of them for a resize.
     */
    _bindRedraws() {
        for (const button of this.root.querySelectorAll('#synthSubTabs [data-bs-toggle="pill"]')) {
            button.addEventListener('shown.bs.tab', () => this.redraw());
        }

        window.addEventListener('resize', () => this.redraw());
    }

    /**
     * Read every control back from the studio. Called when the window opens
     * and whenever the track being edited changes: the two moments nothing
     * else announces.
     */
    sync() {
        const context = this._context();
        if (!context) return;

        for (const bound of this._controls.values()) {
            const current = bound.control.read(context);
            // Undefined means "there is nothing to read yet", which is not
            // the same as zero.
            if (current === undefined) continue;

            this._put(bound, current);
        }

        this._syncPads(context);
        this.visuals.draw(context);
    }

    /**
     * Redraw every canvas in the window at the size it is now.
     *
     * A canvas laid out while its window or its sub-tab was hidden has no
     * width to draw into, so it comes out empty until someone asks for it
     * again. Opening the window asks, and so does choosing a sub-tab.
     */
    redraw() {
        for (const { pad } of this._pads) pad.draw();
        this.visuals.draw(this._context());
    }

    // ── One control ──────────────────────────────────────────────────────

    _onChange(bound) {
        const context = this._context();
        if (!context) return;

        const { control, element } = bound;
        const value =
            control.kind === 'toggle'
                ? element.checked
                : control.kind === 'range'
                  ? Number(element.value)
                  : element.value;

        control.write(context, value);
        this._print(bound, value);
        this._refreshShadows(control.id);

        // A drag is one edit, not two hundred: the entry lands once the
        // control settles.
        this.studio.history.saveStateDebounced(UNDO_LABEL, UNDO_DELAY_MS);
        this.visuals.draw(context);
        this.onEdited();
    }

    /** Put a value on a control without telling the studio about it. */
    _put(bound, value) {
        const { control, element } = bound;

        if (control.kind === 'toggle') element.checked = Boolean(value);
        else element.value = String(value);

        // Setting a value in code fires no `input`, so the knob's indicator
        // has to be pointed at it by hand.
        if (control.kind === 'range') refreshKnob(element);
        this._print(bound, value);
    }

    _print(bound, value) {
        if (!bound.value || bound.control.kind !== 'range') return;
        bound.value.textContent = Number(value).toFixed(bound.decimals);
    }

    // ── The pads ─────────────────────────────────────────────────────────

    _bindPads() {
        for (const definition of SYNTH_PADS) {
            const element = this.root.querySelector(`#${definition.pad}`);
            if (!element) continue;

            const pad = new XyPad({
                pad: element,
                cursor: this.root.querySelector(`#${definition.cursor}`),
                grid: this.root.querySelector(`#${definition.grid}`),
                color: definition.color,
                onMove: (x, y) => this._onPadMoved(definition, x, y),
                onRelease: () => this.studio.history.saveStateDebounced(UNDO_LABEL, UNDO_DELAY_MS)
            });
            pad.bind();

            this._pads.push({ definition, pad });

            // Six of the nine pads show what a knob elsewhere in the window
            // also shows. Moving either has to move the other, so each
            // remembers the pads it has to take with it.
            for (const axis of [definition.x, definition.y]) {
                if (!axis.knob) continue;

                const shadows = this._shadowedBy.get(axis.knob) ?? [];
                shadows.push({ definition, pad });
                this._shadowedBy.set(axis.knob, shadows);
            }
        }
    }

    _onPadMoved(definition, x, y) {
        const context = this._context();
        if (!context) return;

        // Up is more, which is the opposite of how a pad measures itself.
        this._applyAxis(definition.x, x);
        this._applyAxis(definition.y, 1 - y);
        // The filter pads and the response curve are two views of the same
        // two numbers; the original moved one and left the other stale.
        this.visuals.draw(context);
        this.onEdited();
    }

    /** @param {import('./synth-pads.js').PadAxis} axis */
    _applyAxis(axis, fraction) {
        const value = axis.fromFraction(fraction);
        axis.write(this.studio, value);
        this._printAxis(axis, value);

        // Six of the nine pads shadow a knob elsewhere in the window; both
        // have to agree, whichever was the one that moved.
        const knob = axis.knob && this._controls.get(axis.knob);
        if (knob) this._put(knob, value);
    }

    /** Move the pads that show what a knob just changed. */
    _refreshShadows(knobId) {
        const shadows = this._shadowedBy.get(knobId);
        if (!shadows) return;

        const context = this._context();
        if (context) this._syncPads(context, shadows);
    }

    _syncPads(context, only = null) {
        for (const { definition, pad } of only ?? this._pads) {
            const x = definition.x.toFraction(definition.x.read(context));
            const y = definition.y.toFraction(definition.y.read(context));

            pad.setPosition(clamp(x), 1 - clamp(y));
            this._printAxis(definition.x, definition.x.read(context));
            this._printAxis(definition.y, definition.y.read(context));
        }
    }

    _printAxis(axis, value) {
        const display = this.root.querySelector(`#${axis.display}`);
        if (display) display.textContent = axis.format(value);
    }

    // ── The effect presets ───────────────────────────────────────────────

    _bindEffectPresets() {
        for (const button of this.root.querySelectorAll('.fx-preset-btn')) {
            button.addEventListener('click', () => {
                if (!this.studio.trackEffects) {
                    return this.onStatus(translateOr('studio.needsAudio', 'Press play first'));
                }

                this.studio.trackEffects.loadPreset(
                    this.studio.synthesizer.currentTrack,
                    button.dataset.preset
                );
                this.studio.history.saveState('Track FX preset');
                this.sync();
                this.onEdited();
            });
        }
    }

    // ── What the controls are reading and writing ────────────────────────

    /** @returns {import('./synth-parameters.js').SynthContext|null} */
    _context() {
        const { audioEngine, synthesizer, trackEffects } = this.studio;
        const track = synthesizer.currentTrack;

        const settings = audioEngine.tracks[track];
        const envelope = audioEngine.envelopes[track];
        const vibrato = audioEngine.vibrato[track];
        if (!settings || !envelope || !vibrato) return null;

        return {
            studio: this.studio,
            track,
            settings,
            envelope,
            vibrato,
            effects: trackEffects?.getTrackParams(track) ?? null
        };
    }
}

/**
 * How many decimals a slider's value is worth printing to, read from the
 * step the markup gives it. A step of 1: which is also what a slider with
 * no step at all gets: prints a whole number.
 */
function clamp(value) {
    return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function decimalsOf(element) {
    const step = element.getAttribute?.('step');
    if (!step || step === 'any') return 0;

    const fraction = String(step).split('.')[1];
    return fraction ? fraction.length : 0;
}
