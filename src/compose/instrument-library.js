/**
 * Instrument library: the built-in sounds.
 *
 * A preset describes one instrument: oscillator, envelope, filter, LFOs, and
 * optionally its track effects and arpeggiator. A kit is a set of eight, one
 * per track, so a whole project changes character in a single move.
 *
 * Loading a preset resets the track first, so nothing is left over from the
 * instrument that was there before.
 *
 * User and community presets are not here: they arrive with the storage and
 * cloud modules, through the same shape as these built-ins.
 */

//
// ═══════════════════════════════════════════════════════════════════
// PRESET PARAMETER REFERENCE
// ═══════════════════════════════════════════════════════════════════
//
// OSCILLATOR
//   type            : 'square' | 'triangle' | 'sawtooth' | 'sine' | 'noise'
//   dutyCycle       : 0-1          pulse width (square only, 0.5 = symmetric)
//   volume          : 0-1          note amplitude
//   detune          : -100-100     cents offset
//   pitchEnv        : -36-36       semitones (positive = start HIGH sweep DOWN)
//   glide           : 0-0.5        portamento time (seconds)
//   octaveOffset    : -2-2         octave shift
//   semitoneOffset  : -12-12       semitone shift
//   phase           : 0-360        degrees into the cycle the wave starts at
//
// ENVELOPE (ADSR)
//   envelope.attack  : 0.001-2     seconds
//   envelope.decay   : 0.01-2      seconds
//   envelope.sustain : 0-1         level
//   envelope.release : 0.01-2      seconds
//
// VIBRATO
//   vibrato.rate    : 0-20         Hz
//   vibrato.depth   : 0-50         cents
//
// FILTER
//   filterEnabled    : true/false
//   filterType       : 'lowpass' | 'highpass' | 'bandpass'
//   filterCutoff     : 20-20000    Hz
//   filterQ          : 0.1-100     resonance
//   filterKeyTrack   : 0-1         keyboard tracking
//   filterEnvAmount  : -24-24      semitones
//   filterEnvAttack  : 0.001-2     seconds
//   filterEnvRelease : 0.01-2      seconds
//   filterLfoRate    : 0-20        Hz  (filter LFO speed)
//   filterLfoDepth   : 0-100       (filter LFO amount)
//   lfoFilterRate    : 0-20        Hz  (LFO→filter speed)
//   lfoFilterDepth   : 0-100       (LFO→filter amount)
//
// TREMOLO
//   tremoloRate      : 0-20        Hz
//   tremoloDepth     : 0-100
//
// LFO (3 independent)
//   lfo1Wave / lfo2Wave / lfo3Wave   : 'sine' | 'triangle' | 'sawtooth' | 'square'
//   lfo1Sync / lfo2Sync / lfo3Sync   : true/false (sync to tempo)
//   lfo1Delay / lfo2Delay / lfo3Delay : 0-5 seconds (fade-in delay)
//
// UNISON
//   unisonVoices    : 1-16         number of detuned voices
//   unisonDetune    : 0-100        cents spread
//   unisonSpread    : 0-100        stereo spread %
//
// FX (per-track effects chain)
//   fx.distortion    : 0-1
//   fx.delayTime     : 0-2         seconds
//   fx.delayFeedback : 0-0.9
//   fx.delayMix      : 0-1
//   fx.reverbMix     : 0-1
//   fx.reverbDecay   : 0-1
//   fx.chorusRate    : 0.1-10      Hz
//   fx.chorusDepth   : 0-1
//   fx.chorusMix     : 0-1
//   fx.crushBits     : 1-16        bit depth (16 = no crush)
//   fx.crushRate     : 0.01-1      sample rate factor (1 = no downsample)
//
// ARPEGGIATOR
//   arp.mode         : 'off' | 'up' | 'down' | 'updown' | 'random'
//   arp.rate         : '1/32' | '1/16' | '1/8' | '1/4' | '1/2' | '1' | '2'
//   arp.octaves      : 1-4
//   arp.gate         : 0-1         note length ratio
//
// ═══════════════════════════════════════════════════════════════════

import { shipped } from '../content/shipped.js';

/**
 * The shelves the instrument browser has, in the order it shows them.
 * A preset's folder in `library/` is its category, and this is the list
 * those folders are named after.
 */
const PRESET_CATEGORIES = Object.freeze([
    'leads',
    'bass',
    'chords',
    'arps',
    'drums',
    'fx',
    'retro',
    'acoustic',
    'pads',
    'synth'
]);

export class InstrumentLibrary {
    /**
     * @param {import('../audio/audio-engine.js').AudioEngine} audioEngine
     * @param {import('../audio/synthesizer.js').Synthesizer} synthesizer
     * @param {object} [options]
     * @param {object|null} [options.arpeggiator]  optional, for preset recall
     */
    constructor(audioEngine, synthesizer, { arpeggiator = null } = {}) {
        this.audioEngine = audioEngine;
        this.synthesizer = synthesizer;
        this.arpeggiator = arpeggiator;
        this.presets = this.createPresets();
        /**
         * Which shelf each preset belongs on. Kept beside the presets
         * rather than inside them: the category is how a browser window
         * files an instrument, not part of how it sounds, and a preset
         * object is handed out as the payload of a saved instrument.
         * @type {Map<string, string>}
         */
        this._categoryOf = new Map(
            Object.entries(shipped('presets')).map(([id, item]) => [id, item.category])
        );
        /**
         * What was last loaded on each track: what it is called, where it
         * came from, and how it sounded the moment it landed.
         *
         * The fingerprint is what lets the interface say a track has been
         * altered since (and offer to put it back) without a dirty flag
         * to keep in step. A flag has to be cleared everywhere a preset can
         * arrive and set everywhere a knob can move, and it is wrong the
         * first time one of those is missed; comparing the sound against
         * the sound it started as cannot be. It also gets right the case a
         * flag gets wrong: turn a knob and turn it back, and the track is
         * not modified, because it is not.
         *
         * The record keeps the sound itself, not only its fingerprint.
         * "Put it back" cannot be answered by a description of a sound,
         * and reading it back out of the library answers a different
         * question (what that entry holds now) which is the wrong one
         * the moment someone saves over it. It also only worked for the
         * two sources that have a library entry at all: a kit slot and a
         * voice out of a project file had nowhere to be read from, so
         * Reset appeared for them and did nothing.
         *
         * `sound` is null only for a record that came out of a file
         * written by the legacy app, which stored the name and a flag
         * and not the sound the name refers to. Nothing can recover
         * that sound, so those records carry the flag instead: the
         * badge says the track has been edited and Reset stays out of
         * the way, because there is nowhere for it to go.
         *
         * @type {Array<{id: string|null, source: string, name: string|null,
         *               sound: object|null, fingerprint: string|null,
         *               modifiedOnArrival: boolean}|null>}
         */
        this._trackPresets = Array(8).fill(null);
    }

    /** Per-track FX chain, owned by the engine. Null when none is attached. */
    get trackEffects() {
        return this.audioEngine.trackEffects;
    }

    /**
     * The instrument presets the studio ships with, read from `library/`.
     *
     * These were three and a half thousand lines of object literals in this
     * file until the library became a folder of files. The shape handed
     * back is unchanged: the name alongside the parameters, exactly as
     * `loadPreset` and the browser windows expect it: so nothing that
     * reads a preset had to learn anything new.
     */
    createPresets() {
        return Object.fromEntries(
            Object.entries(shipped('presets')).map(([id, item]) => [
                id,
                // The category lives on the envelope, not in the payload: it
                // is how a browser window files a preset, not part of how it
                // sounds, and it would otherwise end up written into a
                // user's project the first time they saved a copy.
                { name: item.name, ...item.data }
            ])
        );
    }

    loadPreset(presetName, track = null) {
        const preset = this.presets[presetName];
        if (!preset) {
            console.error('Preset not found:', presetName);
            return false;
        }

        const targetTrack = track !== null ? track : this.synthesizer.currentTrack;

        // 1. Reset ALL params to clean defaults (synth + FX + arp)
        this.resetTrackToDefaults(targetTrack);

        // 2. Apply oscillator + filter + unison + LFO + tremolo params
        this.audioEngine.updateTrack(targetTrack, {
            type: preset.type || 'square',
            dutyCycle: preset.dutyCycle ?? 0.5,
            volume: preset.volume ?? 0.18,
            detune: preset.detune ?? 0,
            pitchEnv: preset.pitchEnv ?? 0,
            glide: preset.glide ?? 0,
            octaveOffset: preset.octaveOffset ?? 0,
            semitoneOffset: preset.semitoneOffset ?? 0,
            phase: preset.phase ?? 0,
            // Filter
            filterEnabled: preset.filterEnabled ?? false,
            filterType: preset.filterType || 'lowpass',
            filterCutoff: preset.filterCutoff ?? 20000,
            filterQ: preset.filterQ ?? 0.1,
            filterKeyTrack: preset.filterKeyTrack ?? 0,
            filterEnvAmount: preset.filterEnvAmount ?? 0,
            filterEnvAttack: preset.filterEnvAttack ?? 0.01,
            filterEnvRelease: preset.filterEnvRelease ?? 0.2,
            filterLfoRate: preset.filterLfoRate ?? 0,
            filterLfoDepth: preset.filterLfoDepth ?? 0,
            lfoFilterRate: preset.lfoFilterRate ?? 0,
            lfoFilterDepth: preset.lfoFilterDepth ?? 0,
            // Tremolo
            tremoloRate: preset.tremoloRate ?? 0,
            tremoloDepth: preset.tremoloDepth ?? 0,
            // Unison
            unisonVoices: preset.unisonVoices ?? 1,
            unisonDetune: preset.unisonDetune ?? 0,
            unisonSpread: preset.unisonSpread ?? 0,
            // LFO
            lfo1Wave: preset.lfo1Wave || 'sine',
            lfo1Sync: preset.lfo1Sync ?? false,
            lfo1Delay: preset.lfo1Delay ?? 0,
            lfo2Wave: preset.lfo2Wave || 'sine',
            lfo2Sync: preset.lfo2Sync ?? false,
            lfo2Delay: preset.lfo2Delay ?? 0,
            lfo3Wave: preset.lfo3Wave || 'sine',
            lfo3Sync: preset.lfo3Sync ?? false,
            lfo3Delay: preset.lfo3Delay ?? 0
        });

        // 3. Envelope
        if (preset.envelope) {
            this.audioEngine.updateEnvelope(targetTrack, {
                attack: preset.envelope.attack ?? 0.01,
                decay: preset.envelope.decay ?? 0.1,
                sustain: preset.envelope.sustain ?? 0.7,
                release: preset.envelope.release ?? 0.2
            });
        }

        // 4. Vibrato
        if (preset.vibrato) {
            this.audioEngine.updateVibrato(targetTrack, {
                rate: preset.vibrato.rate ?? 0,
                depth: preset.vibrato.depth ?? 0
            });
        }

        // 5. Per-track FX
        if (preset.fx && this.trackEffects) {
            this.trackEffects.setTrackParams(targetTrack, preset.fx);
        }

        // 6. Arpeggiator
        if (preset.arp && this.arpeggiator) {
            this.arpeggiator.updateSettings(targetTrack, {
                mode: preset.arp.mode || 'off',
                rate: preset.arp.rate || '1/8',
                octaves: preset.arp.octaves ?? 1,
                gate: preset.arp.gate ?? 0.5
            });
        }

        // 7. Remember what is on the track, now that it is all the way on:
        // the fingerprint has to be taken of the sound as it ended up.
        this._remember(targetTrack, {
            id: presetName,
            source: 'builtin',
            name: preset.name || presetName
        });

        // 8. Update UI
        if (targetTrack === this.synthesizer.currentTrack) {
            this.synthesizer._notifyChanged();
        }

        return true;
    }

    /**
     * Note what a track is playing and how it sounds as it starts.
     *
     * @param {number} track
     * @param {{id: string|null, source: string, name: string|null}} what
     */
    _remember(track, { id, source, name }) {
        // Cloned, although the synthesizer builds a fresh object every
        // call: a snapshot that quietly became a live reference would
        // turn Reset into a no-op and say nothing about it.
        this.rememberTrackPreset(track, {
            id,
            source,
            name,
            sound: this.synthesizer.getFullPresetState(track)
        });
    }

    /**
     * Take one record back exactly as it was handed out.
     *
     * The sound comes from the record, never from the engine. A record
     * travels through a project file and through every undo entry, and
     * both of those also carry the sound that is on the track: which
     * is the edited one whenever the track has been edited. Reading the
     * engine here would make the edit its own baseline, so an undo
     * through a modified track used to make the edit permanent and take
     * Reset away.
     *
     * @param {number} track
     * @param {{id?: string|null, source?: string, name?: string|null,
     *          sound?: object|null, modified?: boolean}|null} record
     */
    rememberTrackPreset(track, record) {
        if (!record) {
            this._trackPresets[track] = null;
            return;
        }

        const sound = record.sound ? structuredClone(record.sound) : null;

        this._trackPresets[track] = {
            id: record.id ?? null,
            source: record.source ?? 'custom',
            name: record.name ?? null,
            sound,
            fingerprint: sound ? fingerprint(sound) : null,
            modifiedOnArrival: Boolean(record.modified)
        };
    }

    /**
     * Fill in the part of each snapshot that did not exist yet.
     *
     * A track's effects are not on the engine until the chain is built,
     * and the chain is not built until the first press of Play: which
     * normally comes after the project was opened. A sound remembered
     * before then has `fx: null` in it, so the moment the chain arrives
     * every named track reads as edited and Reset has nothing to put
     * back. Only the missing part is filled: a knob moved before Play
     * is a real edit and stays one.
     */
    adoptTrackEffects() {
        for (let track = 0; track < 8; track++) {
            const record = this._trackPresets[track];
            if (!record?.sound || record.sound.fx) continue;

            record.sound.fx = this.trackEffects?.getTrackParams(track) ?? null;
            record.fingerprint = fingerprint(record.sound);
        }
    }

    /**
     * Put a track back to the sound that was loaded onto it.
     *
     * Works whatever the sound came from: a shipped instrument, a saved
     * one, a kit slot, a project file: because it replays what was
     * recorded rather than fetching the source again. Replaying is also
     * the honest answer: fetching would give whatever that library entry
     * holds now, which is not what the track had.
     *
     * @param {number} trackIndex
     * @returns {boolean} false when there is nothing recorded for it
     */
    revertTrack(trackIndex) {
        const record = this._trackPresets?.[trackIndex];
        if (!record?.sound) return false;

        this.synthesizer.applyFullPresetState(structuredClone(record.sound), trackIndex);
        return true;
    }

    /**
     * Whether Reset has anywhere to go.
     *
     * Not the same question as "has this been modified": a sound that
     * arrived already edited away from its preset reads as modified and
     * has nothing to go back to, and a button offering to restore
     * nothing is worse than no button.
     *
     * @param {number} trackIndex
     * @returns {boolean}
     */
    canRevertTrack(trackIndex) {
        const record = this._trackPresets?.[trackIndex];
        if (!record?.sound) return false;

        return this._soundDiffers(trackIndex, record);
    }

    /**
     * The eight records, to be handed straight back later.
     *
     * Used for a project file, for every undo entry, and by the kit
     * window to put the tracks back if nothing is saved.
     * `rememberTrackPresets` is its inverse and keeps whatever this
     * writes, including a record with no name: a kit slot that never
     * had a display name still has a sound to go back to.
     *
     * @returns {Array<object|null>}
     */
    captureTrackPresets() {
        return this._trackPresets.map((record) =>
            record
                ? {
                      id: record.id,
                      source: record.source,
                      name: record.name,
                      // By reference, as the engine's own arrays are in
                      // `getProjectState`: whoever keeps it clones it.
                      sound: record.sound,
                      // Only worth writing when there is no sound to
                      // derive it from. Two ways of saying one thing is
                      // how the legacy app's two arrays came to disagree.
                      ...(record.sound ? {} : { modified: record.modifiedOnArrival })
                  }
                : null
        );
    }

    /**
     * Take back eight records that `captureTrackPresets` handed out.
     *
     * @param {Array<object|null>|null} records
     */
    rememberTrackPresets(records) {
        this.forgetTrackPresets();
        if (!Array.isArray(records)) return;

        for (let track = 0; track < 8 && track < records.length; track++) {
            this.rememberTrackPreset(track, records[track]);
        }
    }

    /**
     * Forget what every track was playing.
     *
     * A project arriving (opened, or put back by undo) writes the tracks
     * straight onto the engine without passing through here, so afterwards
     * every record describes a project that is no longer open. Kept, they
     * would name a preset that is not loaded and offer to restore a sound
     * from it.
     *
     * `rememberTrackPresets` is what a project load calls instead: the
     * old records go, and the ones the file carries take their place.
     */
    forgetTrackPresets() {
        this._trackPresets = Array(8).fill(null);
    }

    // Réinitialiser une piste aux valeurs par défaut (synth + effets per-track)
    // IMPORTANT: remplace l'objet entier pour éliminer tout résidu de l'ancien preset
    resetTrackToDefaults(trackIndex) {
        const cleanTrack = {
            type: 'square',
            volume: 0.18,
            dutyCycle: 0.5,
            detune: 0,
            pitchEnv: 0,
            glide: 0,
            filterCutoff: 20000,
            filterQ: 0.1,
            filterEnabled: false,
            filterType: 'lowpass',
            filterKeyTrack: 0,
            filterLfoRate: 0,
            filterLfoDepth: 0,
            lfoFilterRate: 0,
            lfoFilterDepth: 0,
            tremoloRate: 0,
            tremoloDepth: 0,
            filterEnvAmount: 0,
            filterEnvAttack: 0.01,
            filterEnvRelease: 0.2,
            unisonVoices: 1,
            unisonDetune: 0,
            unisonSpread: 0,
            octaveOffset: 0,
            semitoneOffset: 0,
            phase: 0,
            lfo1Wave: 'sine',
            lfo1Sync: false,
            lfo1Delay: 0,
            lfo2Wave: 'sine',
            lfo2Sync: false,
            lfo2Delay: 0,
            lfo3Wave: 'sine',
            lfo3Sync: false,
            lfo3Delay: 0
        };

        // Remplacer l'objet track ENTIER (pas de merge: élimine toute propriété résiduelle)
        this.audioEngine.tracks[trackIndex] = { ...cleanTrack };

        // Reset envelope aux valeurs neutres
        this.audioEngine.envelopes[trackIndex] = {
            attack: 0.01,
            decay: 0.1,
            sustain: 0.7,
            release: 0.2
        };

        // Reset vibrato
        this.audioEngine.vibrato[trackIndex] = { rate: 0, depth: 0 };

        // Reset des effets per-track (distortion, delay, reverb, chorus, bitcrusher) via TrackEffects
        if (this.trackEffects) {
            this.trackEffects.loadPreset(trackIndex, 'clean');
        }

        // Reset arpeggiator
        if (this.arpeggiator) {
            this.arpeggiator.updateSettings(trackIndex, {
                mode: 'off',
                rate: '1/8',
                octaves: 1,
                gate: 0.5
            });
        }
    }

    /**
     * Get the last loaded preset name for a track.
     * @param {number} trackIndex
     * @returns {string|null}
     */
    getTrackPresetName(trackIndex) {
        return this._trackPresets?.[trackIndex]?.name || null;
    }

    /**
     * What was last loaded on a track, or null if nothing was.
     * @param {number} trackIndex
     * @returns {{id: string|null, source: string, name: string|null}|null}
     */
    getTrackPreset(trackIndex) {
        const record = this._trackPresets?.[trackIndex];
        return record ? { id: record.id, source: record.source, name: record.name } : null;
    }

    /**
     * Whether a track sounds different from the preset that was put on it.
     *
     * False for a track nothing was loaded onto: there is nothing to differ
     * from, and calling that modified would offer to restore nothing.
     *
     * @param {number} trackIndex
     * @returns {boolean}
     */
    isTrackModified(trackIndex) {
        const record = this._trackPresets?.[trackIndex];
        if (!record) return false;
        // A legacy file only ever said so or did not; there is no sound
        // to compare against and its word is all there is.
        if (!record.sound) return record.modifiedOnArrival;

        return this._soundDiffers(trackIndex, record);
    }

    /**
     * Whether the track sounds different from what was remembered.
     *
     * The effects are left out of the comparison whenever one of the
     * two sides has none. A track has no effects until the chain is
     * built at the first press of Play, and a project is normally
     * opened before that: so a record that came in with its effects
     * would be compared against a track that cannot report any, and
     * eight untouched tracks would read as edited. A difference that
     * cannot be seen is not a difference; `adoptTrackEffects` closes
     * the gap the other way, once there is a chain to read.
     *
     * @param {number} trackIndex
     * @param {{sound: object, fingerprint: string}} record
     */
    _soundDiffers(trackIndex, record) {
        const live = this.synthesizer.getFullPresetState(trackIndex);
        if (live.fx && record.sound.fx) return fingerprint(live) !== record.fingerprint;

        return fingerprint({ ...live, fx: null }) !== fingerprint({ ...record.sound, fx: null });
    }

    /**
     * Load an instrument from preset data rather than from a built-in key:
     * a saved instrument, a kit slot, or one that came out of a project file.
     *
     * @param {object|string} presetData  a full preset state, or its JSON
     * @param {number|null} [targetTrack] defaults to the selected track
     * @param {string|null} [presetName]  what the interface should display
     * @param {object} [origin]
     * @param {string|null} [origin.id]  the library entry it came from
     * @param {string} [origin.source]   'library', or 'custom' for a sound
     *   that is in nobody's library: a kit slot, or a project file
     * @returns {boolean}
     */
    loadPresetData(presetData, targetTrack = null, presetName = null, origin = {}) {
        if (!presetData) return false;

        const track = targetTrack !== null ? targetTrack : this.synthesizer.currentTrack;
        const data = typeof presetData === 'string' ? JSON.parse(presetData) : presetData;

        this.synthesizer.applyFullPresetState(data, track);
        this._remember(track, {
            id: origin.id ?? null,
            source: origin.source ?? 'custom',
            name: presetName
        });
        return true;
    }

    getPresetsByCategory() {
        // Grouped by what each preset says it is, not by what its id starts
        // with. The ladder that used to be here read 'lead-' and 'bass-' off
        // the front of the key and swept everything it did not recognise
        // into `synth`: which was fine while every key was written in this
        // file, and is a trap now that anyone can add one. A contributor's
        // `library/instruments/pads/warm-analogue.json` is a pad; under the
        // old rule it was a synth, silently, because its name did not
        // happen to begin with `pad-`.
        const categories = Object.fromEntries(PRESET_CATEGORIES.map((name) => [name, []]));

        for (const key of Object.keys(this.presets)) {
            // A preset filed under nothing recognisable still has to be
            // reachable: unreachable is worse than miscategorised.
            (categories[this._categoryOf.get(key)] ?? categories.synth).push(key);
        }

        return categories;
    }

    // ========== SOUND KITS ==========

    /**
     * Return built-in kit definitions (6 kits).
     * Each kit: { name, category, cover, tracks: [{ presetKey, presetType }] }
     * Track order: 0=Lead, 1=Harmony, 2=Bass, 3=Arp, 4=Kick, 5=Snare, 6=HiHat, 7=FX
     */
    getBuiltinKits() {
        return Object.fromEntries(
            Object.entries(shipped('kits')).map(([id, item]) => [
                id,
                // A kit carries its category and its cover, unlike a preset:
                // those are what the kit grid draws, so they belong in the
                // shape this hands back.
                { name: item.name, category: item.category, cover: item.cover, ...item.data }
            ])
        );
    }

    /**
     * Apply a kit to all 8 tracks.
     * @param {{ tracks: Array<{ presetKey, presetType, presetData? }> }} kitData
     */
    applyKit(kitData) {
        if (!kitData?.tracks || !Array.isArray(kitData.tracks)) return;
        kitData.tracks.forEach((slot, trackIndex) => {
            if (trackIndex >= 8) return;
            if (!slot) return;
            if (slot.presetType === 'builtin' && slot.presetKey) {
                this.loadPreset(slot.presetKey, trackIndex);
            } else if (slot.presetData) {
                // A slot holding preset data rather than a built-in key: a
                // saved instrument, or one that came from a file.
                this.loadPresetData(slot.presetData, trackIndex, slot.displayName || null);
            }
        });
        // Always refresh synth UI after kit application to reflect current track's new preset
        this.synthesizer._notifyChanged();
    }

    /**
     * Capture current state of all 8 tracks as a kit data object.
     * @returns {{ tracks: Array<{ presetKey: null, presetType: 'custom', presetData: object }> }}
     */
    getCurrentKitState() {
        const tracks = [];
        for (let i = 0; i < 8; i++) {
            tracks.push({
                presetKey: null,
                presetType: 'custom',
                presetData: this.synthesizer.getFullPresetState(i)
            });
        }
        return { tracks };
    }

    /**
     * Build unified kit list: built-in + user + community.
     * Returns array of { id, key, name, category, cover, source, isPublic, data }
     */
    getBuiltinKitList() {
        const kits = this.getBuiltinKits();
        return Object.entries(kits).map(([key, kit]) => ({
            id: 'builtin:' + key,
            key,
            name: kit.name,
            category: kit.category,
            cover: kit.cover,
            source: 'builtin',
            isPublic: false,
            data: { tracks: kit.tracks }
        }));
    }

    // ========== UNIFIED PRESET LIST ==========

    /**
     * Build a unified list of all presets (built-in + user + community)
     * Each entry: { id, name, type, designer, source, isPublic, data }
     */
    getBuiltinPresetList() {
        const categories = this.getPresetsByCategory();
        const list = [];

        for (const [catKey, presetKeys] of Object.entries(categories)) {
            for (const key of presetKeys) {
                const preset = this.presets[key];
                if (!preset) continue;
                // Use preset.name if defined, otherwise build from key
                const displayName =
                    preset.name ||
                    (() => {
                        const prefix = key.indexOf('-');
                        const rawName = prefix >= 0 ? key.substring(prefix + 1) : key;
                        return rawName
                            .split('-')
                            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                            .join(' ');
                    })();
                list.push({
                    id: 'builtin:' + key,
                    presetKey: key,
                    name: displayName,
                    type: catKey,
                    designer: '8BitForge',
                    source: 'builtin',
                    isPublic: false,
                    data: preset
                });
            }
        }
        return list;
    }
}

/**
 * A sound, as a string that can be compared with another.
 *
 * `getFullPresetState` builds its object a field at a time in a fixed
 * order, so two tracks that sound the same serialise the same. That is what
 * makes this a fingerprint rather than merely a dump of the state.
 */
function fingerprint(state) {
    return JSON.stringify(state);
}
