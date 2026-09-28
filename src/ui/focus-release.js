/**
 * Giving the keys back.
 *
 * A shortcut stands aside for anything focused, and so does the typed
 * piano: what you type into a field is typing, not a command. That is
 * right for a text field, where focus is the point and you keep it until
 * you leave. It is wrong for a slider or a drop-down, which keep focus
 * after the pointer has finished with them although nothing is being
 * typed into either. The studio has 45 sliders and 63 drop-downs, so
 * touching almost anything used to leave Space, the eighteen piano
 * letters and every shortcut dead until the user happened to click on
 * some empty part of the page.
 *
 * So a control that holds focus for no reason hands it back once the
 * pointer is done with it. Only the pointer: someone nudging a slider
 * with the arrow keys, or walking a list with them, is using that focus
 * and must keep it. That is the whole of the rule, and it is why this
 * takes events rather than reading `document.activeElement`: which
 * cannot tell you how the focus got there.
 *
 * The original did this too, with two timers (`js/app.js:849-862`,
 * commented "so keyboard resumes playing"), and blurred a drop-down
 * whether the pointer or the keyboard had changed it.
 */

/**
 * Whether this control keeps focus with nothing to do with it.
 *
 * Text, number and search fields are not in it, nor anything editable:
 * those hold focus because someone is writing.
 *
 * @param {{tagName?: string, type?: string}|null} element
 */
export function holdsFocusIdly(element) {
    if (!element?.tagName) return false;
    if (element.tagName === 'SELECT') return true;

    return element.tagName === 'INPUT' && element.type === 'range';
}

/**
 * The rule, with no document in sight.
 *
 * Each method answers with the element to blur, or null. `bind()` is the
 * only part that knows about events, which leaves the decision testable
 * and the wiring trivial.
 */
export class FocusRelease {
    constructor() {
        /** The control the pointer is currently working, if it is one of ours. */
        this._pointed = null;
    }

    /** @param {object|null} element what the pointer went down on */
    pointerDown(element) {
        this._pointed = holdsFocusIdly(element) ? element : null;
    }

    /**
     * A key was pressed. From here the control is being driven by the
     * keyboard, and its focus is doing a job.
     */
    keyDown() {
        this._pointed = null;
    }

    /**
     * The pointer let go. A slider is finished at this moment, even if it
     * ended where it started and reports no change.
     *
     * A drop-down is not: its list is still open and it will say what it
     * is worth in a `change`, so it is left alone here.
     *
     * @returns {object|null} the control to blur
     */
    pointerUp() {
        const element = this._pointed;
        if (!element || element.tagName === 'SELECT') return null;

        this._pointed = null;
        return element;
    }

    /**
     * A control settled on a value. Only the one the pointer is holding:
     * a `change` from anything else came from the keyboard.
     *
     * @param {object|null} element
     * @returns {object|null} the control to blur
     */
    changed(element) {
        if (!element || element !== this._pointed) return null;

        this._pointed = null;
        return element;
    }

    /**
     * Wire it to a document. Blurring happens here and nowhere else.
     * @param {Document} [document_]
     */
    bind(document_ = document) {
        const blur = (element) => element?.blur?.();

        // Capture, so a handler that stops propagation on its own control
        // cannot quietly take the keyboard away from the rest of the studio.
        document_.addEventListener('pointerdown', (event) => this.pointerDown(event.target), true);
        document_.addEventListener('keydown', () => this.keyDown(), true);
        document_.addEventListener('pointerup', () => blur(this.pointerUp()), true);
        document_.addEventListener('change', (event) => blur(this.changed(event.target)), true);
    }
}
