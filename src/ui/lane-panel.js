/**
 * Automation lanes.
 *
 * One lane per automatable parameter, drawn on a canvas the same width as the
 * arrangement grid above it, so a point sits under the measure it belongs to.
 * Click to add a point, drag to move it, right-click to remove it; shift while
 * dragging leaves the step unsnapped.
 *
 * A lane is collapsed to a thumbnail until it is armed. There are dozens of
 * parameters and nobody automates all of them, so clicking a name arms the
 * lane and opens it, and the ones left alone stay out of the way while still
 * showing their shape.
 *
 * Lanes that are hidden go on playing: hiding is a way of looking, not a way
 * of switching off.
 *
 * This is the part the master effects and the mixer share. A subclass says
 * which elements of the page it owns, what its groups are called, and how its
 * filter reads.
 */

import { ARRANGEMENT_EVENTS } from '../sequencer/arrangement.js';
import { translateOr } from '../i18n/i18n.js';

/** The height of an open lane and of a collapsed one, in pixels. */
const LANE_HEIGHT = 60;
const MINI_HEIGHT = 16;

/** How close a click has to be to a point to take hold of it. */
const GRAB_RADIUS = 8;

/** The themes whose lanes are drawn light on dark. */
const DARK_THEMES = new Set(['inverse', 'phosphor', 'midnoir', 'synthwave']);

export class LanePanel {
    /**
     * @param {object} options
     * @param {ParentNode} options.root
     * @param {import('../studio.js').Studio} options.studio
     * @param {import('../automation/lane-automation.js').LaneAutomation} options.automation
     * @param {{lanes: string, rec: string, clear: string, filter: string}} options.elements
     * @param {string} options.label  what an undo entry is called
     */
    constructor({ root, studio, automation, elements, label }) {
        this.root = root;
        this.studio = studio;
        this.automation = automation;
        this.elements = elements;
        this.label = label;

        /** @type {Map<string, {lane: HTMLElement, canvas: HTMLCanvasElement, mini: HTMLCanvasElement}>} */
        this._lanes = new Map();

        /** Which group the list is filtered to, or 'all'. */
        this._section = 'all';

        this._drag = null;
        this._framePending = false;
    }

    bind() {
        this._bindControls();
        this._listen();
        this.build();
    }

    _el(id) {
        return this.root.querySelector(`#${id}`);
    }

    // ── Building the list ────────────────────────────────────────────────

    build() {
        const container = this._el(this.elements.lanes);
        if (!container) return;

        container.innerHTML = '';
        this._lanes.clear();
        this._fillSectionFilter();

        let group = null;
        for (const [key, def] of Object.entries(this.automation.params)) {
            if (def.group !== group) {
                group = def.group;
                container.append(this._buildSeparator(group));
            }
            container.append(this._buildLane(key, def));
        }

        this._observeWidth();
        // The lanes have no width until the browser has laid them out.
        requestAnimationFrame(() => this.renderAll());
    }

    _buildSeparator(group) {
        const separator = document.createElement('div');
        separator.className = 'fxa-group-sep';
        separator.dataset.fxaGroup = group;
        separator.textContent = this.groupLabel(group);
        separator.classList.toggle('hidden', !this._isVisible(group));
        return separator;
    }

    _buildLane(key, def) {
        const armed = this.automation.isArmed(key);

        const lane = document.createElement('div');
        lane.className = `fxa-lane ${armed ? 'expanded' : 'collapsed'}`;
        lane.dataset.param = key;
        lane.classList.toggle('hidden', !this._isVisible(def.group));

        const label = document.createElement('div');
        label.className = `fxa-lane-label${armed ? ' armed' : ''}`;
        label.innerHTML = `
            <span class="fxa-lane-color" style="background:${def.color}"></span>
            <span class="fxa-lane-name">${def.label}</span>
            <button class="fxa-lane-clear" title="Clear lane">&times;</button>
        `;

        label.addEventListener('click', (event) => {
            if (event.target.closest('.fxa-lane-clear')) return;
            this._toggleArm(key);
        });

        label.querySelector('.fxa-lane-clear').addEventListener('click', () => {
            this.automation.clearLane(key);
            this.studio.history.saveState(this.label);
        });

        const mini = document.createElement('canvas');
        mini.className = 'fxa-lane-mini';
        mini.height = MINI_HEIGHT;

        const wrap = document.createElement('div');
        wrap.className = 'fxa-lane-canvas-wrap';
        const canvas = document.createElement('canvas');
        canvas.className = 'fxa-lane-canvas';
        canvas.height = LANE_HEIGHT;
        wrap.append(canvas);

        lane.append(label, mini, wrap);
        this._lanes.set(key, { lane, canvas, mini });
        this._bindCanvas(key, canvas);

        return lane;
    }

    _toggleArm(key) {
        const armed = this.automation.toggleArm(key);
        const entry = this._lanes.get(key);
        if (!entry) return;

        entry.lane.querySelector('.fxa-lane-label')?.classList.toggle('armed', armed);
        entry.lane.classList.toggle('expanded', armed);
        entry.lane.classList.toggle('collapsed', !armed);

        // The lane changes size: let it settle before measuring the canvases.
        requestAnimationFrame(() => this.renderAll());
    }

    // ── What is shown ────────────────────────────────────────────────────

    _isVisible(group) {
        if (this._section !== 'all' && group !== this._section) return false;
        return this.automation.isGroupActive(group);
    }

    /** What a group is called, in the page's language. */
    groupLabel(group) {
        return this.automation.getGroups().find((entry) => entry.value === group)?.label ?? group;
    }

    /** The filter's own value as a group name. */
    sectionFromFilter(value) {
        return value;
    }

    /**
     * Fill the filter with the groups that are live. With one group there is
     * nothing to choose between, so the menu goes away. A panel whose filter
     * is written into the page overrides this and leaves it alone.
     */
    _fillSectionFilter() {
        const select = this._el(this.elements.filter);
        if (!select) return;

        const groups = this.automation.getGroups();

        // A section whose effect has just been switched off cannot stay
        // chosen; 'all' is never in the list and is always allowed.
        if (this._section !== 'all' && !groups.some((entry) => entry.value === this._section)) {
            this._section = 'all';
        }

        select.innerHTML = '';
        if (groups.length > 1) {
            select.add(new Option(translateOr('fxa.allsections', 'All Sections'), 'all'));
        }
        for (const group of groups) {
            select.add(new Option(group.label, group.value));
        }

        select.value = this._section;
        select.style.display = groups.length <= 1 ? 'none' : '';
    }

    /** Re-read which groups are live, and show or hide accordingly. */
    refreshVisibility() {
        this._fillSectionFilter();

        for (const separator of this.root.querySelectorAll('.fxa-group-sep')) {
            separator.classList.toggle('hidden', !this._isVisible(separator.dataset.fxaGroup));
        }

        for (const [key, entry] of this._lanes) {
            entry.lane.classList.toggle(
                'hidden',
                !this._isVisible(this.automation.params[key].group)
            );
        }

        this.renderAll();
    }

    // ── Controls ─────────────────────────────────────────────────────────

    _bindControls() {
        this._el(this.elements.rec)?.addEventListener('click', () => {
            this.automation.toggleRecording();
        });

        this._el(this.elements.clear)?.addEventListener('click', () => {
            this.automation.clearAll();
            this.studio.history.saveState(this.label);
        });

        const filter = this._el(this.elements.filter);
        filter?.addEventListener('change', () => {
            this._section = this.sectionFromFilter(filter.value);
            this.refreshVisibility();
        });
    }

    _listen() {
        const { bus } = this.studio;

        const events = this.automation.events;

        bus.on(events.changed, () => this._scheduleRender());
        bus.on(events.applied, () => this._scheduleRender());

        bus.on(events.recording, (recording) => {
            this._el(this.elements.rec)?.classList.toggle('active', recording);
            if (!recording) this._syncArmed();
        });

        // The lanes are as wide as the song is long.
        bus.on(ARRANGEMENT_EVENTS.changed, () => this._scheduleRender());
    }

    /** Draw at most once a frame: a step can arrive faster than a repaint. */
    _scheduleRender() {
        if (this._framePending) return;

        this._framePending = true;
        requestAnimationFrame(() => {
            this._framePending = false;
            this.renderAll();
        });
    }

    _syncArmed() {
        for (const [key, entry] of this._lanes) {
            const armed = this.automation.isArmed(key);
            entry.lane.querySelector('.fxa-lane-label')?.classList.toggle('armed', armed);
            entry.lane.classList.toggle('expanded', armed);
            entry.lane.classList.toggle('collapsed', !armed);
        }
    }

    // ── Drawing ──────────────────────────────────────────────────────────

    renderAll() {
        for (const key of this._lanes.keys()) {
            this._resize(key);
            this._renderLane(key);
            this._renderMini(key);
        }
    }

    /**
     * Match a canvas's pixel buffer to the width it is displayed at, so the
     * lanes line up with the grid above and with each other.
     */
    _resize(key) {
        const entry = this._lanes.get(key);
        if (!entry) return;

        const wrap = entry.lane.querySelector('.fxa-lane-canvas-wrap');
        const width = wrap?.clientWidth > 8 ? wrap.clientWidth - 8 : this._laneWidth();
        if (entry.canvas.width !== width) entry.canvas.width = width;

        const miniWidth = entry.mini.offsetWidth || width;
        if (entry.mini.width !== miniWidth) entry.mini.width = miniWidth;
    }

    /** The width a lane's canvas should have, when it cannot measure itself. */
    _laneWidth() {
        for (const { lane } of this._lanes.values()) {
            // The label is 120 wide and the wrap has 8 of padding.
            if (!lane.classList.contains('hidden') && lane.clientWidth > 128) {
                return lane.clientWidth - 128;
            }
        }
        return 400;
    }

    _renderLane(key) {
        const entry = this._lanes.get(key);
        const context = entry?.canvas.getContext('2d');
        if (!context) return;

        const { width, height } = entry.canvas;
        const colors = themeColors();
        const def = this.automation.params[key];
        const points = this.automation.getLane(key);

        context.clearRect(0, 0, width, height);
        context.fillStyle = colors.background;
        context.fillRect(0, 0, width, height);

        this._drawMeasures(context, width, height, colors.gridMain);

        context.strokeStyle = colors.gridSub;
        context.setLineDash([3, 3]);
        for (const fraction of [0.25, 0.5, 0.75]) {
            line(context, 0, (1 - fraction) * height, width, (1 - fraction) * height);
        }
        context.setLineDash([]);

        if (!points.length) {
            context.fillStyle = colors.hint;
            context.font = '10px sans-serif';
            context.textAlign = 'center';
            context.fillText(
                translateOr('fxa.hint', 'Click to add points'),
                width / 2,
                height / 2 + 3
            );
            this._drawPlayhead(context, width, height, colors.playhead);
            return;
        }

        this._drawEnvelope(context, points, width, height, def.color, '1A', 1.5);

        const total = this.automation.getTotalSteps();
        for (const [index, point] of points.entries()) {
            const held = this._drag?.param === key && this._drag.index === index;

            context.beginPath();
            context.arc(
                stepToX(point.step, total, width),
                (1 - point.value) * height,
                held ? 5 : 4,
                0,
                Math.PI * 2
            );
            context.fillStyle = def.color;
            context.fill();
            context.strokeStyle = colors.dot;
            context.lineWidth = 1.5;
            context.stroke();
        }

        this._drawPlayhead(context, width, height, colors.playhead);
    }

    /** The thumbnail of a collapsed lane: the shape, and nothing else. */
    _renderMini(key) {
        const entry = this._lanes.get(key);
        const context = entry?.mini.getContext('2d');
        if (!context) return;

        const { width, height } = entry.mini;
        const colors = themeColors();

        context.clearRect(0, 0, width, height);
        context.fillStyle = colors.background;
        context.fillRect(0, 0, width, height);

        this._drawMeasures(context, width, height, colors.gridMain);

        const points = this.automation.getLane(key);
        if (points.length) {
            this._drawEnvelope(
                context,
                points,
                width,
                height,
                this.automation.params[key].color,
                '33',
                1
            );
        }
    }

    _drawMeasures(context, width, height, color) {
        const measures = Math.max(this.studio.arrangement.getChain().length, 1);
        context.strokeStyle = color;
        context.lineWidth = 1;

        for (let measure = 1; measure < measures; measure++) {
            const x = (measure / measures) * width;
            line(context, x, 0, x, height);
        }
    }

    _drawEnvelope(context, points, width, height, color, fillAlpha, lineWidth) {
        const total = this.automation.getTotalSteps();
        const x = (point) => stepToX(point.step, total, width);
        const y = (point) => (1 - point.value) * height;

        context.beginPath();
        context.moveTo(x(points[0]), height);
        for (const point of points) context.lineTo(x(point), y(point));
        context.lineTo(x(points[points.length - 1]), height);
        context.closePath();
        context.fillStyle = color + fillAlpha;
        context.fill();

        context.beginPath();
        points.forEach((point, index) => {
            if (index === 0) context.moveTo(x(point), y(point));
            else context.lineTo(x(point), y(point));
        });
        context.strokeStyle = color;
        context.lineWidth = lineWidth;
        context.stroke();
    }

    _drawPlayhead(context, width, height, color) {
        const { sequencer, arrangement } = this.studio;
        if (!sequencer.isPlaying || !arrangement.enabled) return;

        context.strokeStyle = color;
        context.lineWidth = 1;
        const x = stepToX(this.automation.currentStep, this.automation.getTotalSteps(), width);
        line(context, x, 0, x, height);
    }

    // ── Editing ──────────────────────────────────────────────────────────

    _bindCanvas(param, canvas) {
        canvas.addEventListener('contextmenu', (event) => event.preventDefault());

        canvas.addEventListener('pointerdown', (event) => {
            const point = canvasPoint(canvas, event);
            if (!point) return;

            const { x, y } = point;
            const hit = this._hitTest(param, canvas, x, y);

            // Right-click removes a point; on a bare canvas it does nothing,
            // which is better than adding one where a menu was expected.
            if (event.button === 2) {
                if (hit < 0) return;
                this.automation.removePoint(param, hit);
                this.studio.history.saveState(this.label);
                return;
            }

            const index =
                hit >= 0
                    ? hit
                    : this.automation.addPoint(
                          param,
                          // A new point lands on a step. Dragging it is what
                          // allows a value between two of them.
                          this._snap(xToStep(x, canvas.width, this.automation.getTotalSteps())),
                          1 - y / canvas.height
                      );

            this._drag = { param, index };
            canvas.setPointerCapture?.(event.pointerId);
            canvas.style.cursor = 'grabbing';
        });

        canvas.addEventListener('pointermove', (event) => {
            const point = canvasPoint(canvas, event);
            if (!point) return;

            const { x, y } = point;
            if (this._drag?.param !== param) {
                canvas.style.cursor =
                    this._hitTest(param, canvas, x, y) >= 0 ? 'grab' : 'crosshair';
                return;
            }

            const raw = xToStep(x, canvas.width, this.automation.getTotalSteps());
            // Points land on a step unless shift says otherwise: an envelope
            // usually wants to turn where the music does.
            const step = event.shiftKey ? raw : this._snap(raw);

            this._drag.index = this.automation.movePoint(
                param,
                this._drag.index,
                step,
                1 - y / canvas.height
            );
        });

        const release = (event) => {
            if (this._drag?.param !== param) return;

            this._drag = null;
            canvas.releasePointerCapture?.(event.pointerId);
            canvas.style.cursor = 'crosshair';
            this.studio.history.saveState(this.label);
        };

        canvas.addEventListener('pointerup', release);
        canvas.addEventListener('pointercancel', release);
    }

    /** The nearest step, inside the song. */
    _snap(step) {
        return Math.max(0, Math.min(this.automation.getTotalSteps() - 1, Math.round(step)));
    }

    /** @returns {number} the index of the point under the pointer, or -1 */
    _hitTest(param, canvas, x, y) {
        const points = this.automation.getLane(param);
        const total = this.automation.getTotalSteps();

        for (const [index, point] of points.entries()) {
            const dx = x - stepToX(point.step, total, canvas.width);
            const dy = y - (1 - point.value) * canvas.height;
            if (Math.hypot(dx, dy) <= GRAB_RADIUS) return index;
        }
        return -1;
    }

    // ── Staying the width of the grid ────────────────────────────────────

    _observeWidth() {
        this._observer?.disconnect();
        if (typeof ResizeObserver !== 'function') return;

        this._observer = new ResizeObserver(() => this._scheduleRender());

        const cells = this.root.querySelector('#mixerGridContainer .mixer-grid-cells');
        if (cells) this._observer.observe(cells);

        const lanes = this._el(this.elements.lanes);
        if (lanes) this._observer.observe(lanes);
    }
}

// ── Drawing helpers ──────────────────────────────────────────────────────

function stepToX(step, totalSteps, width) {
    return (step / Math.max(totalSteps, 1)) * width;
}

function xToStep(x, width, totalSteps) {
    return (x / Math.max(width, 1)) * totalSteps;
}

/**
 * A pointer's position in the canvas's own pixels, not the page's.
 * @returns {{x: number, y: number}|null} null for a canvas with no size,
 *   a collapsed card, where a coordinate would divide by zero.
 */
function canvasPoint(canvas, event) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    return {
        x: ((event.clientX - rect.left) * canvas.width) / rect.width,
        y: ((event.clientY - rect.top) * canvas.height) / rect.height
    };
}

function line(context, x1, y1, x2, y2) {
    context.beginPath();
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
    context.stroke();
}

/**
 * A canvas cannot inherit a colour, so the few it needs are read from the
 * theme by name. They match what the stylesheet paints around them.
 */
function themeColors() {
    const theme = document.documentElement.dataset.forgeTheme || '';
    const dark = DARK_THEMES.has(theme);

    return {
        background: dark ? '#222736' : theme === 'warmtape' ? '#e8dfc8' : '#eef0f6',
        gridMain: dark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)',
        gridSub: dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)',
        hint: dark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.30)',
        dot: dark ? '#FFFFFF' : '#333333',
        playhead: dark ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.40)'
    };
}
