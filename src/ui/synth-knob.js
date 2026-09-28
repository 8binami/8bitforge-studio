/**
 * The synth window's knobs.
 *
 * The controls in that window are range inputs in the markup, but the
 * stylesheet draws them as rotary knobs and hides the input itself: zero
 * wide, no pointer events. Without this they cannot be moved at all, so
 * this is not decoration: it is the other half of a control that the CSS
 * only drew.
 *
 * The knob is dragged up and down rather than in a circle. Circular dragging
 * is precise in theory and miserable in practice; the same choice is made in
 * `knob.js` for the mixer, and for the same reason. Shift slows it down, the
 * wheel nudges it, and a double-click returns it to its resting value:
 * zero for a control whose range crosses it, the minimum otherwise.
 *
 * Nothing here knows what a knob is wired to. It moves the input and lets it
 * announce itself, so whatever listens to the input keeps working.
 */

/** Pixels of drag for the whole range, normally and with shift held. */
const DRAG_RANGE = 150;
const FINE_DRAG_RANGE = 400;

/** How far the indicator sweeps, and where it starts. */
const SWEEP_DEGREES = 270;
const START_DEGREES = -135;

/** Notches the wheel moves, normally and with shift held. */
const WHEEL_STEPS = 2;
const FINE_WHEEL_STEPS = 0.5;

/** `Node.TEXT_NODE`, without reaching for a global to read one constant. */
const TEXT_NODE = 3;

/** Controls opted out of the knob look by the stylesheet. */
const NOT_A_KNOB = ':not(.synth-slider):not(.synth-vfader)';

/**
 * Turn every knob-shaped control under a root into a working one.
 *
 * @param {ParentNode} pane
 */
export function bindKnobs(pane) {
    for (const wrap of pane.querySelectorAll(`.forge-control${NOT_A_KNOB}`)) {
        const input = wrap.querySelector('input[type="range"]');
        if (!input || wrap.dataset.forgeKnob) continue;

        wrap.dataset.forgeKnob = 'true';
        splitLabel(wrap);
        bindDrag(wrap, input);
        input.addEventListener('input', () => refreshKnob(input));
        refreshKnob(input);
    }
}

/**
 * Point a knob's indicator at its input's current value. Call this after
 * setting the value in code: an `input` event is only fired by a person.
 *
 * @param {HTMLInputElement} input
 */
export function refreshKnob(input) {
    const wrap = input?.closest('.forge-control');
    if (!wrap?.dataset.forgeKnob) return;

    const min = Number(input.min);
    const max = Number(input.max);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max === min) return;

    const fraction = (Number(input.value) - min) / (max - min);
    wrap.style.setProperty('--knob-pct', fraction.toFixed(4));
    wrap.style.setProperty(
        '--knob-rot',
        `${(fraction * SWEEP_DEGREES + START_DEGREES).toFixed(2)}deg`
    );
}

// ── The label ────────────────────────────────────────────────────────────

/**
 * Split `<label>Atk: <span>0.5</span> ms</label>` into the pieces the
 * stylesheet asks for: the name in `data-param` on the label, the unit in
 * `data-unit` on the span. Both are drawn by CSS, above and after the
 * number, which is how a knob reads: name on top, value under it.
 *
 * The markup keeps the plain wording so it still reads without the
 * stylesheet; this only rearranges what is already there.
 */
function splitLabel(wrap) {
    const label = wrap.querySelector(':scope > label');
    const span = label?.querySelector('span');
    if (!label || !span || label.dataset.param) return;

    let before = '';
    let after = '';
    let passed = false;

    for (const node of [...label.childNodes]) {
        if (node === span) {
            passed = true;
            continue;
        }
        if (node.nodeType === TEXT_NODE) {
            if (passed) after += node.textContent;
            else before += node.textContent;
        }
        node.remove();
    }

    const name = before.replace(/:/g, '').trim();
    const unit = after.trim();
    if (name) label.dataset.param = name;
    if (unit) span.dataset.unit = unit;
}

// ── Moving it ────────────────────────────────────────────────────────────

function bindDrag(wrap, input) {
    wrap.addEventListener('pointerdown', (event) => {
        event.preventDefault();

        const startY = event.clientY;
        const startValue = Number(input.value);

        // The move and release listeners go on the document rather than on
        // the knob: a drag that leaves the knob, which a 24-pixel circle
        // makes easy: has to keep working, and pointer capture throws on a
        // synthetic event.
        const onMove = (moved) => {
            const range = moved.shiftKey ? FINE_DRAG_RANGE : DRAG_RANGE;
            const span = Number(input.max) - Number(input.min);
            set(input, startValue + ((startY - moved.clientY) / range) * span);
        };

        const onUp = () => {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            document.removeEventListener('pointercancel', onUp);
        };

        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onUp);
    });

    wrap.addEventListener(
        'wheel',
        (event) => {
            event.preventDefault();

            const notches = event.shiftKey ? FINE_WHEEL_STEPS : WHEEL_STEPS;
            const direction = event.deltaY < 0 ? 1 : -1;
            set(input, Number(input.value) + direction * stepOf(input) * notches);
        },
        { passive: false }
    );

    wrap.addEventListener('dblclick', (event) => {
        event.preventDefault();

        const min = Number(input.min);
        const max = Number(input.max);
        // A control whose range crosses zero rests there; one that does not
        // rests at the bottom.
        set(input, min < 0 && max > 0 ? 0 : min);
    });
}

/** Put a value on the input, snapped and clamped, and say it moved. */
function set(input, value) {
    const min = Number(input.min);
    const max = Number(input.max);
    const step = stepOf(input);

    const snapped = Math.min(max, Math.max(min, Math.round(value / step) * step));
    // Rounding to the step leaves floating-point dust: 0.30000000000000004
    //: which the value readout would print.
    const clean = Number(snapped.toFixed(6));
    if (Number(input.value) === clean) return;

    input.value = String(clean);
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

function stepOf(input) {
    const step = Number(input.step);
    return Number.isFinite(step) && step > 0 ? step : 1;
}
