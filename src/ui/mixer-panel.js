/**
 * The mixing console.
 *
 * Eight channel strips and a master: solo and mute, a three-band EQ, a
 * compressor, pan, a fader and a VU meter. The strips are built here rather
 * than written into the markup because they are eight copies of one thing.
 *
 * Solo and mute here are the mixer's own, separate from the per-pattern ones
 * on the sequencer grid: this pair follows the whole song, that pair follows
 * the pattern. The sequencer settles the two when it decides what to play.
 */

import { createKnob, volumeToDecibels } from './knob.js';
import { MIXER_AUTOMATION_EVENTS } from '../automation/mixer-automation.js';

export const MIXER_EVENTS = Object.freeze({
    soloMuteChanged: 'mixer:solo-mute'
});

const TRACK_NAMES = ['LEAD', 'HARMONY', 'BASS', 'ARP', 'KICK', 'SNARE', 'HI-HAT', 'FX'];

/** The master strip is track −1: it has a fader and an EQ, and nothing else. */
const MASTER = -1;

const EQ_BANDS = [
    { id: 'eqHigh', label: 'HI', color: '#e74c3c' },
    { id: 'eqMid', label: 'MID', color: '#f1c40f' },
    { id: 'eqLow', label: 'LO', color: '#3498db' }
];

/** Compressor controls. Times are milliseconds here, seconds in the engine. */
/**
 * The compressor's four knobs.
 *
 * `scale` is how many of the knob's units make one of the engine's: the
 * two times are set in milliseconds and the Web Audio API takes seconds,
 * while the threshold is in decibels and the ratio is a ratio. Written
 * here rather than worked out at each call site, because the same number
 * has to travel both ways and the two directions used to be written in
 * different places.
 *
 * `format` belongs with it. One shared rule printed a threshold of -24 dB
 * as "-24.0" and a 3 ms attack as "3", which is two units and neither of
 * them stated.
 */
const COMPRESSOR = [
    {
        key: 'threshold',
        label: 'TH',
        min: -60,
        max: 0,
        value: -24,
        step: 1,
        scale: 1,
        color: '#e74c3c',
        format: (value) => `${value.toFixed(0)} dB`
    },
    {
        key: 'ratio',
        label: 'RT',
        min: 1,
        max: 20,
        value: 4,
        step: 0.5,
        scale: 1,
        color: '#f39c12',
        format: (value) => `${value.toFixed(1)}:1`
    },
    {
        key: 'attack',
        label: 'A',
        min: 0.1,
        max: 100,
        value: 3,
        step: 0.1,
        scale: 1000,
        color: '#2ecc71',
        format: (value) => `${value < 10 ? value.toFixed(1) : value.toFixed(0)} ms`
    },
    {
        key: 'release',
        label: 'R',
        min: 10,
        max: 1000,
        value: 250,
        step: 1,
        scale: 1000,
        color: '#3498db',
        format: (value) => `${value.toFixed(0)} ms`
    }
];

const FADER_MARKS = ['+6', '+3', '0', '-6', '-12', '-24', '-∞'];

export class MixerPanel {
    /**
     * @param {object} options
     * @param {ParentNode} options.root
     * @param {import('../studio.js').Studio} options.studio
     */
    constructor({ root, studio }) {
        this.root = root;
        this.studio = studio;

        this._strips = new Map();
        this._meterFrame = null;
    }

    build() {
        const container = this.root.querySelector('#mixingConsole');
        if (!container) return;

        // An envelope moves these controls as the song plays; the console
        // should show where it has been moved to, at most once a frame.
        // Building again reuses the subscription rather than adding a second.
        if (!this._listening) {
            this._listening = true;
            this.studio.bus.on(MIXER_AUTOMATION_EVENTS.applied, ({ applied }) => {
                if (applied) this._scheduleSync();
            });
        }

        container.innerHTML = '';
        this._strips.clear();

        for (let track = 0; track < TRACK_NAMES.length; track++) {
            container.append(this._createStrip(track, TRACK_NAMES[track]));
        }

        const divider = document.createElement('div');
        divider.className = 'mixer-divider';
        container.append(divider, this._createStrip(MASTER, 'MASTER'));

        this._startMeters();
    }

    /** Stop the meter loop: when the card is hidden, or the view torn down. */
    stop() {
        if (this._meterFrame) cancelAnimationFrame(this._meterFrame);
        this._meterFrame = null;
    }

    /** Push the engine's settings back onto the controls. */
    sync() {
        const { audioEngine } = this.studio;

        for (const [track, strip] of this._strips) {
            if (track === MASTER) {
                strip.fader.value = String(Math.round(audioEngine.getMasterVolume() * 100));
                strip.decibels.textContent = volumeToDecibels(audioEngine.getMasterVolume());
                continue;
            }

            const settings = audioEngine.mixerSettings[track];
            strip.fader.value = String(Math.round(settings.volume * 100));
            strip.decibels.textContent = volumeToDecibels(settings.volume);
            strip.solo?.classList.toggle('active', settings.solo);
            strip.mute?.classList.toggle('active', settings.mute);
            strip.pan?.setValue(settings.pan * 100);

            for (const band of EQ_BANDS) strip.eq[band.id]?.setValue(settings[band.id]);

            // The compressor was left out of this for a long time, so
            // opening a project showed the previous one's threshold and
            // an inactive CMP over a compressor that was on.
            if (strip.comp) {
                for (const control of COMPRESSOR) {
                    const value = settings.compressor?.[control.key];
                    if (typeof value === 'number') {
                        strip.comp.byKey[control.key]?.setValue(value * control.scale);
                    }
                }
                this._showCompressor(strip.comp, Boolean(settings.compressor?.enabled));
            }
        }
    }

    _scheduleSync() {
        if (this._syncPending) return;

        this._syncPending = true;
        requestAnimationFrame(() => {
            this._syncPending = false;
            this.sync();
        });
    }

    // ── One strip ────────────────────────────────────────────────────────

    _createStrip(track, name) {
        const isMaster = track === MASTER;

        const strip = document.createElement('div');
        strip.className = isMaster ? 'channel-strip master-strip' : 'channel-strip';
        strip.dataset.track = String(track);

        const label = document.createElement('div');
        label.className = 'strip-label';
        label.textContent = name;
        label.style.background = isMaster ? '#e74c3c' : `var(--forge-track-${track})`;
        strip.append(label);

        const parts = { eq: {} };

        if (!isMaster) {
            const { buttons, solo, mute } = this._createSoloMute(track);
            strip.append(buttons);
            Object.assign(parts, { solo, mute });
        }

        strip.append(this._createEq(track, isMaster, parts.eq));

        if (!isMaster) {
            strip.append(this._createCompressor(track, parts));
            parts.pan = this._createPan(track);

            const panWrap = document.createElement('div');
            panWrap.className = 'strip-pan-wrap';
            panWrap.append(parts.pan);
            strip.append(panWrap);
        }

        const { section, fader, decibels, meter } = this._createFader(track, isMaster);
        // The readout sits under the whole fader section, not inside it.
        strip.append(section, decibels);

        this._strips.set(track, { ...parts, fader, decibels, meter });
        return strip;
    }

    _createSoloMute(track) {
        const buttons = document.createElement('div');
        buttons.className = 'strip-buttons';

        const make = (text, title, className, key) => {
            const button = document.createElement('button');
            button.className = className;
            button.textContent = text;
            button.title = title;

            button.addEventListener('click', () => {
                const settings = this.studio.audioEngine.mixerSettings[track];
                settings[key] = !settings[key];
                button.classList.toggle('active', settings[key]);
                this.studio.history.saveState(key === 'solo' ? 'Mixer solo' : 'Mixer mute');
                // The grid greys out a track the mixer has silenced.
                this.studio.bus.emit(MIXER_EVENTS.soloMuteChanged);
            });

            buttons.append(button);
            return button;
        };

        const solo = make('S', 'Solo', 'btn btn-outline-warning', 'solo');
        const mute = make('M', 'Mute', 'btn btn-outline-danger', 'mute');
        return { buttons, solo, mute };
    }

    _createEq(track, isMaster, into) {
        const section = document.createElement('div');
        section.className = 'strip-eq';

        for (const band of EQ_BANDS) {
            const knob = createKnob({
                label: band.label,
                min: -12,
                max: 12,
                value: 0,
                step: 0.5,
                size: 32,
                arcColor: band.color,
                className: `knob-${band.id}`,
                formatValue: (value) => `${value >= 0 ? '+' : ''}${value.toFixed(0)}`,
                onChange: (value) => {
                    // The master strip's EQ is decorative: the mastering stage
                    // is where the master bus is shaped.
                    if (isMaster) return;
                    this.studio.audioEngine.setTrackEQ(track, band.id, value);
                    this.studio.history.saveStateDebounced('Mixer EQ', 600);
                }
            });

            into[band.id] = knob;
            section.append(knob);
        }

        return section;
    }

    /** @param {object} into  the strip's parts, so `sync` can find these */
    _createCompressor(track, into) {
        const section = document.createElement('div');
        section.className = 'strip-comp';

        const toggle = document.createElement('button');
        toggle.className = 'btn btn-outline-info strip-comp-toggle';
        toggle.textContent = 'CMP';
        toggle.title = 'Compressor';

        const knobs = document.createElement('div');
        knobs.className = 'strip-comp-knobs d-none';

        into.comp = { toggle, knobs, byKey: {} };

        for (const control of COMPRESSOR) {
            const knob = createKnob({
                label: control.label,
                min: control.min,
                max: control.max,
                value: control.value,
                step: control.step,
                size: 24,
                arcColor: control.color,
                className: `knob-comp-${control.key}`,
                formatValue: control.format,
                onChange: (value) => this._setCompressor(track, control, value)
            });

            into.comp.byKey[control.key] = knob;
            knobs.append(knob);
        }

        toggle.addEventListener('click', () => {
            const { compressor } = this.studio.audioEngine.mixerSettings[track];

            this.studio.audioEngine.setTrackCompressorEnabled(track, !compressor.enabled);
            this._showCompressor(into.comp, compressor.enabled);
            this.studio.history.saveState('Mixer compressor');
        });

        section.append(toggle, knobs);
        return section;
    }

    /** @param {{key: string, scale: number}} control */
    _setCompressor(track, control, value) {
        const setter = `setTrackCompressor${control.key[0].toUpperCase()}${control.key.slice(1)}`;

        this.studio.audioEngine[setter]?.(track, value / control.scale);
        this.studio.history.saveStateDebounced('Mixer compressor', 600);
    }

    /** The knobs are only worth showing while the compressor is doing something. */
    _showCompressor(comp, enabled) {
        comp.toggle.classList.toggle('active', enabled);
        comp.knobs.classList.toggle('d-none', !enabled);
    }

    _createPan(track) {
        return createKnob({
            label: 'PAN',
            min: -100,
            max: 100,
            value: 0,
            step: 1,
            size: 32,
            arcColor: '#1abc9c',
            className: 'knob-pan',
            formatValue: (value) =>
                value === 0 ? 'C' : value < 0 ? `L${Math.abs(value)}` : `R${value}`,
            onChange: (value) => {
                this.studio.audioEngine.setTrackPan(track, value / 100);
                this.studio.history.saveStateDebounced('Mixer pan', 600);
            }
        });
    }

    _createFader(track, isMaster) {
        const section = document.createElement('div');
        section.className = 'strip-fader-section';

        const scale = document.createElement('div');
        scale.className = 'strip-fader-scale';
        for (const mark of FADER_MARKS) {
            const step = document.createElement('span');
            step.textContent = mark;
            scale.append(step);
        }

        const meterWrap = document.createElement('div');
        meterWrap.className = 'strip-vu';
        const meter = document.createElement('div');
        meter.className = 'strip-vu-fill';
        meter.dataset.track = String(track);
        meterWrap.append(meter);

        const faderTrack = document.createElement('div');
        faderTrack.className = 'strip-fader-track';

        const fader = document.createElement('input');
        fader.type = 'range';
        fader.min = '0';
        fader.max = '150';
        fader.step = '1';
        fader.value = isMaster ? '50' : '100';
        fader.className = 'volume-fader';
        fader.title = 'Volume';

        const decibels = document.createElement('div');
        decibels.className = 'strip-fader-db';
        decibels.textContent = volumeToDecibels(isMaster ? 0.5 : 1);

        const applyVolume = (percent) => {
            const volume = percent / 100;
            if (isMaster) this.studio.audioEngine.setMasterVolume(volume);
            else this.studio.audioEngine.setTrackFaderVolume(track, volume);

            decibels.textContent = volumeToDecibels(volume);
        };

        fader.addEventListener('input', () => {
            applyVolume(Number(fader.value));
            this.studio.history.saveStateDebounced(isMaster ? 'Master volume' : 'Mixer fader', 800);
        });

        // Double-click returns a fader to unity, as a console would. It is a
        // change like any other: undoable, and in the file if one is saved.
        fader.addEventListener('dblclick', () => {
            fader.value = isMaster ? '50' : '100';
            applyVolume(Number(fader.value));
            this.studio.history.saveState(isMaster ? 'Master volume' : 'Mixer fader');
        });

        faderTrack.append(fader);
        section.append(scale, meterWrap, faderTrack);

        return { section, fader, decibels, meter };
    }

    // ── Meters ───────────────────────────────────────────────────────────

    /**
     * The meters read the engine's analysers every frame. They are only worth
     * drawing while something is playing, so the loop idles otherwise.
     */
    _startMeters() {
        if (this._meterFrame) return;

        const draw = () => {
            this._meterFrame = requestAnimationFrame(draw);

            const { audioEngine, sequencer } = this.studio;
            if (!audioEngine.initialized) return;

            const idle = !sequencer.isPlaying && audioEngine.activeNotes.size === 0;

            for (const [track, strip] of this._strips) {
                if (!strip.meter) continue;

                const level = idle
                    ? 0
                    : track === MASTER
                      ? audioEngine.getMasterLevel()
                      : audioEngine.getTrackLevel(track);

                // Calibrated so that an RMS of 0.707, a sine at full scale:
                // reaches the top of the meter.
                strip.meter.style.height = `${Math.min(100, level * 140)}%`;
            }
        };

        draw();
    }
}
