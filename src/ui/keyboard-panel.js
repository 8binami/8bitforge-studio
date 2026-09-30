/**
 * The keyboard.
 *
 * Sixty-five keys, C1 to E6, played with the mouse, the computer keyboard, or
 * a MIDI keyboard. Two octaves of the computer keyboard are mapped onto the
 * piano at a time; the frame drawn over the keys says which two, and it can be
 * dragged, nudged with the octave keys, or moved from the bar underneath.
 *
 * The computer mapping goes by physical key position (`event.code`) rather
 * than by the letter printed on the cap, so the same three rows fall under the
 * same fingers on AZERTY and on QWERTY. Only the labels drawn on the keys
 * differ, and which layout to print is worked out from the first key pressed.
 *
 * A held key is a held note: it sounds until it is let go, and the envelope's
 * release is what ends it. When the track has its arpeggiator running, the
 * note is handed to that instead, and let go of the same way.
 */

import { AudioEngine } from '../audio/audio-engine.js';

export const KEYBOARD_EVENTS = Object.freeze({
    noteOn: 'keyboard:note-on',
    noteOff: 'keyboard:note-off',
    octaveChanged: 'keyboard:octave'
});

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** The range drawn: C1 up to E6. */
const FIRST_OCTAVE = 1;
const LAST_OCTAVE = 6;
const LAST_OCTAVE_NOTES = ['C', 'C#', 'D', 'D#', 'E'];

/** How far the mapped window can travel, in octaves. */
const MIN_OCTAVE = 1;
const MAX_OCTAVE = 5;

/** White keys the frame covers: two octaves and the C above them. */
const FRAME_WHITE_KEYS = 15;

/** How long a held note is asked to last. It is released by hand long first. */
const HELD_NOTE_SECONDS = 30;

/**
 * Physical keys to notes. A trailing `+` means the octave above the one the
 * frame starts on, so two octaves fit under the two rows.
 */
const KEY_MAP = {
    KeyA: 'C',
    KeyS: 'D',
    KeyD: 'E',
    KeyF: 'F',
    KeyG: 'G',
    KeyH: 'A',
    KeyJ: 'B',
    KeyK: 'C+',
    KeyL: 'D+',
    Semicolon: 'E+',
    Quote: 'F+',
    KeyW: 'C#',
    KeyE: 'D#',
    KeyT: 'F#',
    KeyY: 'G#',
    KeyU: 'A#',
    KeyO: 'C#+',
    KeyP: 'D#+'
};

/** What is printed on those keys, on either layout. */
const LABELS = {
    AZERTY: {
        C: 'Q',
        D: 'S',
        E: 'D',
        F: 'F',
        G: 'G',
        A: 'H',
        B: 'J',
        'C+': 'K',
        'D+': 'L',
        'E+': 'M',
        'F+': 'Ù',
        'C#': 'Z',
        'D#': 'E',
        'F#': 'T',
        'G#': 'Y',
        'A#': 'U',
        'C#+': 'O',
        'D#+': 'P'
    },
    QWERTY: {
        C: 'A',
        D: 'S',
        E: 'D',
        F: 'F',
        G: 'G',
        A: 'H',
        B: 'J',
        'C+': 'K',
        'D+': 'L',
        'E+': ';',
        'F+': "'",
        'C#': 'W',
        'D#': 'E',
        'F#': 'T',
        'G#': 'Y',
        'A#': 'U',
        'C#+': 'O',
        'D#+': 'P'
    }
};

/** The two keys that move the window, by position: W/Z and X. */
const OCTAVE_DOWN_CODE = 'KeyZ';
const OCTAVE_UP_CODE = 'KeyX';

/** Where a black key sits, in white keys from the start of its octave. */
const BLACK_KEY_OFFSETS = { 'C#': 0.6, 'D#': 1.6, 'F#': 3.6, 'G#': 4.6, 'A#': 5.6 };

/**
 * The two places a keyboard stands, and the class names each was written
 * with. The instrument is the same one: same range, same mapping, same
 * frame, so what differs is a handful of names and one rule: the card
 * keyboard stands down while a window is open over the studio, and the one
 * *inside* that window is precisely the one that must not.
 *
 * The stylesheet carries both sets already; neither was invented here.
 */
export const KEYBOARD_SKINS = Object.freeze({
    card: {
        container: 'keyboard',
        outer: null,
        root: 'piano-keyboard',
        wrapper: 'piano-keys-wrapper',
        whites: 'piano-whites',
        blacks: 'piano-blacks',
        key: 'piano-key',
        white: 'piano-key-white',
        black: 'piano-key-black',
        label: 'piano-key-label',
        pcLabel: 'piano-pc-label',
        standsDownForWindows: true
    },
    window: {
        container: 'studioKeyboard',
        outer: 'vk-container',
        root: null,
        wrapper: 'vk-keys-wrapper',
        whites: 'vk-whites',
        blacks: 'vk-black-layer',
        key: 'vk-key',
        white: 'vk-white',
        black: 'vk-black',
        label: 'vk-label',
        pcLabel: 'vk-pc-label',
        standsDownForWindows: false
    }
});

export class KeyboardPanel {
    /**
     * @param {object} options
     * @param {ParentNode} options.root
     * @param {import('../studio.js').Studio} options.studio
     * @param {import('./midi-access.js').MidiAccess} [options.midi]
     * @param {object} [options.skin]  one of `KEYBOARD_SKINS`
     */
    constructor({ root, studio, midi = null, skin = KEYBOARD_SKINS.card }) {
        this.root = root;
        this.studio = studio;
        this.midi = midi;
        this.skin = skin;

        this.octave = 3;
        // The one in a window is dead until the window opens it; the one on
        // the card is live as soon as the card is.
        this.enabled = skin.standsDownForWindows;

        /** Physical keys currently down, so a repeat does not retrigger. */
        this._held = new Set();
        /** Note ids by `note-octave`, to release what was started. */
        this._sounding = new Map();

        this._mouseDown = false;
        this._layout = 'AZERTY';
        this._layoutKnown = false;
        this._midiAsked = false;

        this.keys = buildKeys();
        this.whiteKeyCount = this.keys.filter((key) => !key.isBlack).length;
    }

    bind() {
        this._build();
        this._bindComputerKeys();
        this._followTheOther();

        // Only the one on the card follows a card.
        if (this.skin.standsDownForWindows) this._watchCard();
    }

    /**
     * Keep the two keyboards on the same two octaves.
     *
     * They are one instrument in two places, and someone who moves the frame
     * in the window and then closes it should find the card where they left
     * it. The guard is the comparison in `setOctave`, which does nothing when
     * the octave is already the one asked for: otherwise each would answer
     * the other for ever.
     */
    _followTheOther() {
        this.studio.bus.on(KEYBOARD_EVENTS.octaveChanged, ({ octave, from }) => {
            if (from !== this.skin.container) this.setOctave(octave);
        });
    }

    /** Take the computer keys, and say which keys they are. */
    enable() {
        this.enabled = true;
        this._drawFrame();
        this._drawKeyLabels();
    }

    /** Let go of everything and stop listening. */
    disable() {
        this.enabled = false;
        this.releaseAll();
        this._drawKeyLabels();
    }

    /** The track a played note belongs to: the one the synth is pointed at. */
    get track() {
        return this.studio.synthesizer.currentTrack;
    }

    _el(id) {
        return this.root.querySelector(`#${id}`);
    }

    // ── Building the keys ────────────────────────────────────────────────

    _build() {
        const container = this._el(this.skin.container);
        if (!container) return;

        container.innerHTML = '';
        if (this.skin.root) container.classList.add(this.skin.root);

        // One skin wraps its keys in an element of its own; the other makes
        // the container that element.
        const keyboard = this.skin.outer ? document.createElement('div') : container;
        if (this.skin.outer) {
            keyboard.className = this.skin.outer;
            container.append(keyboard);
        }
        this._keyboard = keyboard;

        const wrapper = document.createElement('div');
        wrapper.className = this.skin.wrapper;

        const whites = document.createElement('div');
        whites.className = this.skin.whites;
        const blacks = document.createElement('div');
        blacks.className = this.skin.blacks;

        for (const key of this.keys) {
            const element = this._buildKey(key);
            (key.isBlack ? blacks : whites).append(element);
        }

        // A drag that starts on one key and crosses others plays them all, so
        // the button going up anywhere has to end it.
        document.addEventListener('mouseup', () => {
            this._mouseDown = false;
        });

        wrapper.append(whites, blacks, this._buildFrame());
        keyboard.append(wrapper, this._buildOctaveBar());

        // The frame is positioned as a percentage of a width the browser has
        // not worked out yet.
        requestAnimationFrame(() => {
            this._drawFrame();
            this._drawKeyLabels();
        });
    }

    _buildKey({ note, octave, isBlack }) {
        const element = document.createElement('div');
        element.dataset.note = note;
        element.dataset.octave = String(octave);
        element.className = `${this.skin.key} ${isBlack ? this.skin.black : this.skin.white}`;

        if (isBlack) {
            element.style.left = `calc(${blackKeyPosition(note, octave)} / ${this.whiteKeyCount} * 100%)`;
        } else if (note === 'C') {
            // Every C is named: it is how you find your place on a long keyboard.
            const label = document.createElement('span');
            label.className = this.skin.label;
            label.textContent = `C${octave}`;
            element.append(label);
        }

        element.addEventListener('mousedown', (event) => {
            event.preventDefault();
            this._mouseDown = true;
            this._press(element, note, octave);
        });
        element.addEventListener('mouseenter', () => {
            if (this._mouseDown) this._press(element, note, octave);
        });
        element.addEventListener('mouseleave', () => this._release(element, note, octave));
        element.addEventListener('mouseup', () => this._release(element, note, octave));

        element.addEventListener(
            'touchstart',
            (event) => {
                event.preventDefault();
                this._press(element, note, octave);
            },
            { passive: false }
        );
        element.addEventListener(
            'touchend',
            (event) => {
                event.preventDefault();
                this._release(element, note, octave);
            },
            { passive: false }
        );

        return element;
    }

    _buildFrame() {
        const frame = document.createElement('div');
        frame.className = 'piano-octave-frame';
        frame.title = 'Drag to move the computer keyboard';

        // Held as references rather than found by id: there are two of these
        // on the page now, and two elements cannot share an id.
        const label = document.createElement('span');
        label.className = 'piano-octave-frame-label';
        frame.append(label);

        this._frame = frame;
        this._frameLabel = label;
        this._bindFrameDrag(label);

        return frame;
    }

    _buildOctaveBar() {
        const bar = document.createElement('div');
        bar.className = 'piano-octave-bar';
        bar.innerHTML = `
            <span class="piano-octave-bar-note">C${this.octave}</span>
            <span class="piano-octave-bar-text" data-i18n="keyboard.octave">Octave</span>
            <span class="piano-octave-bar-keys">
                <span class="piano-octave-bar-key" data-step="-1">◄ <b>W</b></span>
                <span class="piano-octave-bar-key" data-step="1"><b>X</b> ►</span>
            </span>
        `;

        this._barNote = bar.querySelector('.piano-octave-bar-note');
        this._barDown = bar.querySelector('[data-step="-1"]');

        for (const step of bar.querySelectorAll('[data-step]')) {
            step.addEventListener('click', () => this.nudgeOctave(Number(step.dataset.step)));
        }

        return bar;
    }

    // ── The window the computer keyboard plays ───────────────────────────

    _bindFrameDrag(grip) {
        let startX = 0;
        let startOctave = 0;
        let dragging = false;

        const move = (clientX) => {
            if (!dragging) return;

            const wrapper = this._keyboard.querySelector(`.${this.skin.wrapper}`);
            const width = (wrapper ?? this._keyboard).getBoundingClientRect().width;
            const octaves = Math.round((clientX - startX) / ((width / this.whiteKeyCount) * 7));

            this.setOctave(startOctave + octaves);
        };

        const start = (clientX) => {
            dragging = true;
            startX = clientX;
            startOctave = this.octave;
            this._frame.classList.add('dragging');
        };

        const end = () => {
            dragging = false;
            this._frame.classList.remove('dragging');
        };

        grip.addEventListener('mousedown', (event) => {
            event.preventDefault();
            event.stopPropagation();
            start(event.clientX);
        });
        document.addEventListener('mousemove', (event) => move(event.clientX));
        document.addEventListener('mouseup', end);

        grip.addEventListener(
            'touchstart',
            (event) => {
                event.preventDefault();
                event.stopPropagation();
                start(event.touches[0].clientX);
            },
            { passive: false }
        );
        document.addEventListener('touchmove', (event) => {
            if (dragging) move(event.touches[0].clientX);
        });
        document.addEventListener('touchend', end);
    }

    nudgeOctave(by) {
        this.setOctave(this.octave + by);
    }

    setOctave(octave) {
        const settled = Math.max(MIN_OCTAVE, Math.min(MAX_OCTAVE, octave));
        if (settled === this.octave) return;

        this.octave = settled;
        this._drawFrame();
        this._drawKeyLabels();

        if (this._barNote) this._barNote.textContent = `C${this.octave}`;

        // The hidden field the rest of the studio reads belongs to the card.
        if (this.skin.standsDownForWindows) {
            const value = this._el('octaveValue');
            if (value) value.textContent = String(this.octave);
        }

        // Named, so the other keyboard can follow without answering itself.
        this.studio.bus.emit(KEYBOARD_EVENTS.octaveChanged, {
            octave: this.octave,
            from: this.skin.container
        });
    }

    _drawFrame() {
        if (!this._frame) return;

        const start = ((this.octave - FIRST_OCTAVE) * 7) / this.whiteKeyCount;
        const width = FRAME_WHITE_KEYS / this.whiteKeyCount;

        this._frame.style.left = `${start * 100}%`;
        this._frame.style.width = `${Math.min(width, 1 - start) * 100}%`;
        this._frameLabel.textContent = `Oct ${this.octave}-${this.octave + 1}`;
    }

    /** Print the computer keys on the piano keys they now play. */
    _drawKeyLabels() {
        for (const label of this._keyboard?.querySelectorAll(`.${this.skin.pcLabel}`) ?? []) {
            label.remove();
        }
        if (!this.enabled) return;

        for (const mapped of Object.values(KEY_MAP)) {
            const { note, octave } = this._resolve(mapped);
            const key = this._key(note, octave);
            const text = LABELS[this._layout][mapped];
            if (!key || !text) continue;

            const label = document.createElement('span');
            label.className = this.skin.pcLabel;
            label.textContent = text;
            key.append(label);
        }
    }

    /** `C#+` is C sharp in the octave above the frame's first. */
    _resolve(mapped) {
        const above = mapped.endsWith('+');
        return {
            note: above ? mapped.slice(0, -1) : mapped,
            octave: above ? this.octave + 1 : this.octave
        };
    }

    _key(note, octave) {
        return this._keyboard?.querySelector(
            `.${this.skin.key}[data-note="${note}"][data-octave="${octave}"]`
        );
    }

    // ── The computer keyboard ────────────────────────────────────────────

    _bindComputerKeys() {
        document.addEventListener('keydown', (event) => {
            if (event.repeat || !this._accepts(event)) return;

            this._detectLayout(event);

            if (event.code === OCTAVE_DOWN_CODE || event.code === OCTAVE_UP_CODE) {
                event.preventDefault();
                this.nudgeOctave(event.code === OCTAVE_UP_CODE ? 1 : -1);
                return;
            }

            const mapped = KEY_MAP[event.code];
            if (!mapped || this._held.has(event.code)) return;

            event.preventDefault();
            this._held.add(event.code);

            const { note, octave } = this._resolve(mapped);
            this._press(this._key(note, octave), note, octave);
        });

        document.addEventListener('keyup', (event) => {
            const mapped = KEY_MAP[event.code];
            if (!mapped || !this._held.delete(event.code)) return;

            const { note, octave } = this._resolve(mapped);
            this._release(this._key(note, octave), note, octave);
        });
    }

    /**
     * Whether this keystroke is a note, so a shortcut on the same letter
     * stands aside. Asked rather than worked out elsewhere: the answer
     * depends on the map, on whether the card is open and on whether a
     * window is over the studio, and all three live here. Adding a key to
     * the map takes the letter away from the shortcuts by itself.
     *
     * @param {KeyboardEvent} event
     */
    claims(event) {
        return Boolean(KEY_MAP[event.code]) && this._accepts(event);
    }

    /** Whether a key press belongs to the piano rather than to the page. */
    _accepts(event) {
        if (!this.enabled) return false;
        // A shortcut is not a note, and neither is anything typed into a field.
        if (event.ctrlKey || event.metaKey) return false;
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return false;

        // A window open over the studio takes the keys from the keyboard on
        // the card: and hands them to the one inside that window, which is
        // why only one of the two stands down.
        return !this.skin.standsDownForWindows || !document.querySelector('.modal.show');
    }

    /**
     * Which layout to print, from the first press of the key that differs:
     * the one under the left little finger says `q` on AZERTY and `a` on
     * QWERTY, whatever its position calls it.
     */
    _detectLayout(event) {
        if (this._layoutKnown || (event.code !== 'KeyA' && event.code !== 'KeyQ')) return;

        this._layoutKnown = true;
        this._layout = event.key.toLowerCase() === 'q' ? 'AZERTY' : 'QWERTY';

        if (this._layout === 'QWERTY' && this._barDown) {
            this._barDown.innerHTML = '◄ <b>Z</b>';
        }
        this._drawKeyLabels();
    }

    // ── Playing ──────────────────────────────────────────────────────────

    _press(element, note, octave) {
        element?.classList.add('pressed');
        this.play(note, octave);
    }

    _release(element, note, octave) {
        element?.classList.remove('pressed');
        this.stop(note, octave);
    }

    async play(note, octave) {
        const id = `${note}-${octave}`;

        // The same key pressed twice without a release would otherwise leave
        // the first note sounding forever.
        if (this._sounding.has(id)) this.stop(note, octave);

        await this.studio.start();
        this._askForMidi();

        const frequency = AudioEngine.noteToFrequency(note, octave);
        const { arpeggiator, audioEngine } = this.studio;

        if (arpeggiator.noteOn(this.track, frequency) === 'arp') {
            this._sounding.set(id, { arp: true, frequency });
        } else {
            this._sounding.set(id, {
                arp: false,
                noteId: audioEngine.playNote(frequency, this.track, HELD_NOTE_SECONDS)
            });
        }

        this.studio.bus.emit(KEYBOARD_EVENTS.noteOn, { note, octave, track: this.track });
    }

    stop(note, octave) {
        const id = `${note}-${octave}`;
        const sounding = this._sounding.get(id);
        if (!sounding) return;

        this._sounding.delete(id);

        if (sounding.arp) this.studio.arpeggiator.noteOff(this.track, sounding.frequency);
        else this.studio.audioEngine.stopNote(sounding.noteId);

        this.studio.bus.emit(KEYBOARD_EVENTS.noteOff, { note, octave, track: this.track });
    }

    /** Let go of everything: the card was shut, or the view left. */
    releaseAll() {
        for (const id of [...this._sounding.keys()]) {
            const [note, octave] = id.split('-');
            this.stop(note, Number(octave));
        }

        this._held.clear();
        for (const key of this._keyboard?.querySelectorAll('.pressed') ?? []) {
            key.classList.remove('pressed');
        }
    }

    // ── MIDI ─────────────────────────────────────────────────────────────

    /**
     * Ask for MIDI the first time a note is played rather than on load: the
     * browser asks the user, and a permission prompt on opening a page nobody
     * has touched yet is the wrong time to ask.
     *
     * Which device the notes come from is the settings panel's choice, kept
     * in `preferences.midiInput` and applied by the shared access.
     */
    _askForMidi() {
        if (this._midiAsked || !this.midi) return;
        this._midiAsked = true;

        this.midi.onMessage((message) => this._onMidi(message));
        this.midi.ensure();
    }

    _onMidi({ data }) {
        const message = readNoteMessage(data);
        if (!message) return;

        const note = NOTES[message.note % 12];
        const octave = Math.floor(message.note / 12) - 1;
        const key = this._key(note, octave);

        if (message.on) this._press(key, note, octave);
        else this._release(key, note, octave);
    }

    // ── Following the card ───────────────────────────────────────────────

    /**
     * A collapsed card is a keyboard that is not there: it stops taking key
     * presses, and says so, rather than playing notes at a user who cannot
     * see what they are pressing.
     */
    _watchCard() {
        const card = this._keyboard?.closest('.card');
        const indicator = this._el('keyboardActiveIndicator');
        if (!card) return;

        const follow = () => {
            const shut =
                card.classList.contains('card-collapse') || card.classList.contains('d-none');

            this.enabled = !shut;
            if (indicator) indicator.style.display = shut ? 'none' : '';

            if (shut) this.releaseAll();
            this._drawKeyLabels();
            if (!shut) this._drawFrame();
        };

        new MutationObserver(follow).observe(card, {
            attributes: true,
            attributeFilter: ['class']
        });
        follow();
    }
}

function buildKeys() {
    const keys = [];

    for (let octave = FIRST_OCTAVE; octave <= LAST_OCTAVE; octave++) {
        const notes = octave === LAST_OCTAVE ? LAST_OCTAVE_NOTES : NOTES;
        for (const note of notes) keys.push({ note, octave, isBlack: note.includes('#') });
    }

    return keys;
}

/** A black key's position, in white keys from the start of the keyboard. */
function blackKeyPosition(note, octave) {
    return (octave - FIRST_OCTAVE) * 7 + (BLACK_KEY_OFFSETS[note] ?? 0);
}

/**
 * A note message from a MIDI keyboard, on any of the sixteen channels, or
 * null for anything else (clock, controllers, aftertouch…).
 *
 * The status byte holds the message type in its high four bits and the
 * channel in its low four: 0x90 is a note-on on channel 1, 0x93 one on
 * channel 4. Comparing the whole byte heard channel 1 only.
 *
 * @param {ArrayLike<number>} data
 * @returns {{on: boolean, note: number}|null}
 */
export function readNoteMessage(data) {
    if (!data || data.length < 3) return null;
    const type = data[0] & 0xf0;
    const note = data[1];
    // A note-on at zero velocity is how many keyboards say note-off.
    if (type === 0x90) return { on: data[2] > 0, note };
    if (type === 0x80) return { on: false, note };
    return null;
}
