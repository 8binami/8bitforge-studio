/**
 * A rotary knob.
 *
 * Drawn as SVG: a track arc, a value arc and an indicator line, over a 270°
 * sweep from 225° round to −45°. A bipolar knob: one whose range crosses
 * zero, like pan or an EQ band: fills its arc outwards from the centre, so
 * "no change" reads at a glance.
 *
 * It is driven by dragging up and down rather than in a circle: circular
 * dragging is precise in theory and miserable in practice. Shift slows it
 * down, the wheel nudges it, and a double-click returns it to centre.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Where the arc starts and how far it travels, in degrees. */
const START_ANGLE = 225;
const SWEEP = 270;

/** Pixels of drag for the full range, normally and with shift held. */
const DRAG_RANGE = 150;
const FINE_DRAG_RANGE = 400;

/**
 * @param {object} options
 * @param {string} options.label
 * @param {number} options.min
 * @param {number} options.max
 * @param {number} [options.value]
 * @param {number} [options.step]
 * @param {number} [options.size]      in pixels
 * @param {string} [options.arcColor]
 * @param {string} [options.className]
 * @param {(value: number) => void} [options.onChange]
 * @param {(value: number) => string} [options.formatValue]
 * @returns {HTMLElement} with `getValue` and `setValue` attached
 */
export function createKnob({
    label,
    min,
    max,
    value = min,
    step = 1,
    size = 32,
    arcColor = '#1abc9c',
    className = '',
    onChange = null,
    formatValue = null
}) {
    const wrap = document.createElement('div');
    wrap.className = className ? `knob-wrap ${className}` : 'knob-wrap';

    const caption = document.createElement('div');
    caption.className = 'knob-label';
    caption.textContent = label;
    wrap.append(caption);

    const centre = size / 2;
    const bodyRadius = centre - 4;
    const arcRadius = centre - 2;

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
    svg.classList.add('knob-svg');

    const track = element('path', { class: 'knob-track' });
    track.setAttribute(
        'd',
        describeArc(centre, centre, arcRadius, START_ANGLE, START_ANGLE - SWEEP)
    );

    const valueArc = element('path', { class: 'knob-value', stroke: arcColor });

    const body = element('circle', { class: 'knob-body', cx: centre, cy: centre, r: bodyRadius });
    const indicator = element('line', { class: 'knob-indicator', stroke: arcColor });

    svg.append(track, valueArc, body, indicator);
    wrap.append(svg);

    const readout = document.createElement('div');
    readout.className = 'knob-value-text';
    wrap.append(readout);

    const bipolar = min < 0 && max > 0;
    let current = clamp(value, min, max);

    function draw(next) {
        const angle = START_ANGLE - ((next - min) / (max - min)) * SWEEP;

        if (bipolar) {
            const zeroAngle = START_ANGLE - ((0 - min) / (max - min)) * SWEEP;
            valueArc.setAttribute(
                'd',
                next >= 0
                    ? describeArc(centre, centre, arcRadius, zeroAngle, angle)
                    : describeArc(centre, centre, arcRadius, angle, zeroAngle)
            );
        } else {
            valueArc.setAttribute('d', describeArc(centre, centre, arcRadius, START_ANGLE, angle));
        }

        const radians = (angle * Math.PI) / 180;
        indicator.setAttribute('x1', centre + (bodyRadius - 5) * Math.cos(radians));
        indicator.setAttribute('y1', centre - (bodyRadius - 5) * Math.sin(radians));
        indicator.setAttribute('x2', centre + (bodyRadius - 1) * Math.cos(radians));
        indicator.setAttribute('y2', centre - (bodyRadius - 1) * Math.sin(radians));

        readout.textContent = formatValue ? formatValue(next) : String(next);
    }

    function apply(next) {
        const settled = clamp(Math.round(next / step) * step, min, max);
        if (settled === current) return;

        current = settled;
        draw(current);
        onChange?.(current);
    }

    draw(current);

    // ── Dragging ─────────────────────────────────────────────────────────

    let startY = 0;
    let startValue = 0;

    const onMove = (event) => {
        const travelled = startY - event.clientY; // up is more
        const range = event.shiftKey ? FINE_DRAG_RANGE : DRAG_RANGE;
        apply(startValue + (travelled / range) * (max - min));
    };

    const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
    };

    svg.addEventListener('mousedown', (event) => {
        event.preventDefault();
        startY = event.clientY;
        startValue = current;
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });

    svg.addEventListener('wheel', (event) => {
        event.preventDefault();
        const direction = event.deltaY < 0 ? 1 : -1;
        apply(current + direction * step * (event.shiftKey ? 0.5 : 2));
    });

    // Back to centre, or to the bottom of a one-sided range.
    svg.addEventListener('dblclick', (event) => {
        event.preventDefault();
        apply(bipolar ? 0 : min);
    });

    wrap.getValue = () => current;
    wrap.setValue = (next) => {
        current = clamp(next, min, max);
        draw(current);
    };

    return wrap;
}

/**
 * An SVG arc path between two angles, measured anticlockwise from east.
 * @returns {string} empty when the two angles meet, which would draw nothing
 */
export function describeArc(cx, cy, radius, startAngle, endAngle) {
    if (Math.abs(startAngle - endAngle) < 0.1) return '';

    const start = pointOnCircle(cx, cy, radius, startAngle);
    const end = pointOnCircle(cx, cy, radius, endAngle);

    let travelled = startAngle - endAngle;
    if (travelled < 0) travelled += 360;

    return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${travelled > 180 ? 1 : 0} 1 ${end.x} ${end.y}`;
}

/** A level as decibels, the way a mixer prints it. */
export function volumeToDecibels(volume) {
    if (volume <= 0) return '-∞';
    const decibels = 20 * Math.log10(volume);
    return `${decibels >= 0 ? '+' : ''}${decibels.toFixed(1)}dB`;
}

function pointOnCircle(cx, cy, radius, angle) {
    const radians = (angle * Math.PI) / 180;
    return {
        // Two decimals: enough to be smooth, short enough to keep paths clean.
        x: +(cx + radius * Math.cos(radians)).toFixed(2),
        y: +(cy - radius * Math.sin(radians)).toFixed(2)
    };
}

function element(tag, attributes) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    return node;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
