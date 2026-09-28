/**
 * The analyser card.
 *
 * The drawing is `Visualizer`. What is here is the row of mode buttons, and
 * when the thing runs: while the sequencer plays, or while a key is held, and
 * not at all while its card is shut.
 *
 * Which mode was last chosen is remembered, since it is a way of listening
 * rather than part of a project.
 */

import { Visualizer } from './visualizer.js';
import { SEQUENCER_EVENTS } from '../sequencer/sequencer.js';
import { KEYBOARD_EVENTS } from './keyboard-panel.js';
import { STUDIO_EVENTS } from '../studio.js';

const STORAGE_KEY = '8bitforge-visualizer-mode';

/** How long the display keeps running after the last note is let go. */
const IDLE_MS = 2000;

export class VisualizerPanel {
    /**
     * @param {object} options
     * @param {ParentNode} options.root
     * @param {import('../studio.js').Studio} options.studio
     */
    constructor({ root, studio }) {
        this.root = root;
        this.studio = studio;
        this.visualizer = new Visualizer({ root, studio });

        this._idleTimer = null;
    }

    bind() {
        this.visualizer.init();
        this.visualizer.setMode(readMode(this.visualizer.modes));

        this._bindModes();
        this._listen();
        this._watchCard();
    }

    _bindModes() {
        for (const button of this.root.querySelectorAll('[data-viz-mode]')) {
            button.classList.toggle('active', button.dataset.vizMode === this.visualizer.mode);

            button.addEventListener('click', () => {
                this.visualizer.setMode(button.dataset.vizMode);
                writeMode(button.dataset.vizMode);

                for (const other of this.root.querySelectorAll('[data-viz-mode]')) {
                    other.classList.toggle('active', other === button);
                }
            });
        }
    }

    _listen() {
        const { bus } = this.studio;

        // The analyser node does not exist until the audio does.
        bus.on(STUDIO_EVENTS.ready, () => this.visualizer.attach());

        bus.on(SEQUENCER_EVENTS.play, () => this._run());
        bus.on(SEQUENCER_EVENTS.stop, () => this._idle());
        bus.on(SEQUENCER_EVENTS.pause, () => this._idle());

        // A note played by hand is worth watching too, for as long as it
        // takes to die away.
        bus.on(KEYBOARD_EVENTS.noteOn, () => this._run());
        bus.on(KEYBOARD_EVENTS.noteOff, () => {
            if (!this.studio.sequencer.isPlaying) this._idle(IDLE_MS);
        });
    }

    _run() {
        window.clearTimeout(this._idleTimer);
        this.visualizer.attach();
        if (!this._shut) this.visualizer.start();
    }

    _idle(after = 0) {
        window.clearTimeout(this._idleTimer);
        this._idleTimer = window.setTimeout(() => this.visualizer.stop(), after);
    }

    /** A shut card draws nothing; opening it picks up where the studio is. */
    _watchCard() {
        const card = this.root.querySelector('#audioVisualizer')?.closest('.card');
        if (!card) return;

        const follow = () => {
            this._shut =
                card.classList.contains('card-collapse') || card.classList.contains('d-none');

            if (this._shut) this.visualizer.stop();
            else if (this.studio.sequencer.isPlaying) this._run();
        };

        new MutationObserver(follow).observe(card, {
            attributes: true,
            attributeFilter: ['class']
        });
        follow();
    }
}

function readMode(modes) {
    try {
        const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
        if (stored && modes.includes(stored)) return stored;
    } catch {
        // Private window or blocked storage: the spectrum is a fine default.
    }
    return 'spectrum';
}

function writeMode(mode) {
    try {
        globalThis.localStorage?.setItem(STORAGE_KEY, mode);
    } catch {
        // The choice lasts this session.
    }
}
