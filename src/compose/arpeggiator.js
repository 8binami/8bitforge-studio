/**
 * Arpeggiator: one per track, synced to the tempo.
 *
 * Holding notes on a track whose arpeggiator is on feeds them into a rolling
 * sequence instead of sounding them together. The pattern is rebuilt from the
 * held notes on every tick, so adding or releasing a note is heard at once.
 *
 * Note: in the legacy code the rate was read from `audioEngine.bpm`, which
 * never existed (the tempo lives on the sequencer) so every arpeggio ran at
 * 120 BPM regardless of the project. The tempo source is injected here.
 */

/** Rate names, as fractions of a beat. */
export const ARP_RATES = {
    '1/4': 1,
    '1/8': 0.5,
    '1/8T': 1 / 3,
    '1/16': 0.25,
    '1/16T': 1 / 6,
    '1/32': 0.125
};

/** @typedef {'off'|'up'|'down'|'updown'|'random'} ArpMode */

export const DEFAULT_ARP_SETTINGS = {
    mode: 'off',
    rate: '1/8',
    octaves: 1,
    gate: 0.5
};

const TRACK_COUNT = 8;

export class Arpeggiator {
    /**
     * @param {import('../audio/audio-engine.js').AudioEngine} audioEngine
     * @param {object} [options]
     * @param {() => number} [options.getTempo]  current tempo in BPM
     */
    constructor(audioEngine, { getTempo = () => 120 } = {}) {
        this.audioEngine = audioEngine;
        this.getTempo = getTempo;

        this.settings = Array.from({ length: TRACK_COUNT }, () => ({ ...DEFAULT_ARP_SETTINGS }));
        /** @type {Map<number, object>} track index → running arpeggio */
        this.activeArps = new Map();
    }

    updateSettings(track, changes) {
        if (!this.settings[track]) return;
        Object.assign(this.settings[track], changes);
    }

    getSettings(track) {
        return { ...this.settings[track] };
    }

    /**
     * The eight tracks' settings, for a project file.
     *
     * An arpeggio is part of an instrument - `getFullPresetState`
     * counts it in what a sound is, and a preset carries one - so a
     * project that left it out reopened with one track in eight
     * playing something else and saying so on its badge.
     */
    serialize() {
        return this.settings.map((settings) => ({ ...settings }));
    }

    /** @param {Array<object>|null} data */
    deserialize(data) {
        this.settings = Array.from({ length: TRACK_COUNT }, (_unused, track) => ({
            ...DEFAULT_ARP_SETTINGS,
            ...(data?.[track] ?? {})
        }));
    }

    isEnabled(track) {
        return this.settings[track]?.mode !== 'off';
    }

    /**
     * Take a note the player pressed.
     * @returns {'arp'|null} 'arp' when the arpeggiator took the note over,
     *                       null when the caller should play it normally
     */
    noteOn(track, frequency) {
        const settings = this.settings[track];
        if (!settings || settings.mode === 'off') return null;

        if (!this.activeArps.has(track)) {
            this.activeArps.set(track, {
                heldNotes: [],
                currentIndex: 0,
                direction: 1,
                activeNoteId: null,
                timerId: null
            });
        }

        const arp = this.activeArps.get(track);
        arp.heldNotes.push(frequency);
        arp.heldNotes.sort((a, b) => a - b);

        // The first held note starts the run; the others join the sequence.
        if (arp.heldNotes.length === 1) this._startArp(track);
        return 'arp';
    }

    noteOff(track, frequency) {
        const arp = this.activeArps.get(track);
        if (!arp) return;

        // Frequencies are floats: match on proximity, not equality.
        arp.heldNotes = arp.heldNotes.filter((held) => Math.abs(held - frequency) > 0.01);
        if (arp.heldNotes.length === 0) this._stopArp(track);
    }

    /** Silence every running arpeggio. */
    stopAll() {
        for (const track of [...this.activeArps.keys()]) this._stopArp(track);
    }

    /** Milliseconds between two arpeggio notes on this track. */
    getIntervalMs(track) {
        const bpm = this.getTempo() || 120;
        const beatMs = 60000 / bpm;
        return beatMs * (ARP_RATES[this.settings[track]?.rate] ?? ARP_RATES['1/8']);
    }

    // ── Internals ────────────────────────────────────────────────────────

    _startArp(track) {
        const arp = this.activeArps.get(track);
        if (!arp) return;
        arp.currentIndex = 0;
        arp.direction = 1;
        this._scheduleNext(track);
    }

    _stopArp(track) {
        const arp = this.activeArps.get(track);
        if (!arp) return;

        if (arp.timerId) clearTimeout(arp.timerId);
        if (arp.activeNoteId) this.audioEngine.stopNote(arp.activeNoteId);
        this.activeArps.delete(track);
    }

    _scheduleNext(track) {
        const arp = this.activeArps.get(track);
        if (!arp || arp.heldNotes.length === 0) return;

        const settings = this.settings[track];
        const intervalMs = this.getIntervalMs(track);
        const sequence = this.buildSequence(arp.heldNotes, settings);
        if (sequence.length === 0) return;

        const frequency = sequence[arp.currentIndex % sequence.length];

        if (arp.activeNoteId) this.audioEngine.stopNote(arp.activeNoteId);
        arp.activeNoteId = this.audioEngine.playNote(
            frequency,
            track,
            (intervalMs / 1000) * settings.gate
        );

        this._advanceIndex(arp, settings, sequence.length);
        arp.timerId = setTimeout(() => this._scheduleNext(track), intervalMs);
    }

    _advanceIndex(arp, settings, length) {
        if (settings.mode === 'updown') {
            arp.currentIndex += arp.direction;
            if (arp.currentIndex >= length - 1) arp.direction = -1;
            if (arp.currentIndex <= 0) arp.direction = 1;
        } else if (settings.mode === 'random') {
            arp.currentIndex = Math.floor(Math.random() * length);
        } else {
            arp.currentIndex++;
        }
    }

    /**
     * The frequencies to play, in order: the held notes, repeated an octave
     * higher for each extra octave, reversed for a downward arpeggio.
     * @param {number[]} heldNotes
     * @param {{mode: ArpMode, octaves: number}} settings
     */
    buildSequence(heldNotes, settings) {
        const notes = [];
        for (let octave = 0; octave < settings.octaves; octave++) {
            for (const frequency of heldNotes) notes.push(frequency * Math.pow(2, octave));
        }
        // up, updown and random all read from the ascending order.
        return settings.mode === 'down' ? notes.reverse() : notes;
    }
}
