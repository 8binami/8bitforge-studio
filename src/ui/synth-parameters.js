/**
 * Every control in the synth window, as data.
 *
 * The window has seventy-odd controls and they all do the same thing: read a
 * number off a track, put it on a slider, and put it back when the slider
 * moves. Written out as code that is seventy near-identical pairs of
 * listeners, and the two halves drift: a control that sets something it
 * never reads back is the classic bug of a panel this size.
 *
 * So each control is one entry with a `read` and a `write`, and the panel
 * walks the list twice: once to listen, once to sync. A control that appears
 * here works in both directions or not at all.
 *
 * Nothing here touches the DOM. `read` is given the studio and the track
 * being edited; `write` is given the studio and the new value, in whatever
 * unit the slider in the markup is labelled with.
 *
 * @typedef {object} SynthControl
 * @property {string} id          the element in `app-shell.html`
 * @property {string} [value]     the span that prints it, for a slider
 * @property {'range'|'select'|'toggle'} kind
 * @property {(context: SynthContext) => number|string|boolean} read
 * @property {(context: SynthContext, value: *) => void} write
 *
 * @typedef {object} SynthContext
 * @property {import('../studio.js').Studio} studio
 * @property {number} track           which track is being edited
 * @property {object} settings        audioEngine.tracks[track]
 * @property {object} envelope        audioEngine.envelopes[track]
 * @property {object} vibrato         audioEngine.vibrato[track]
 * @property {object|null} effects    trackEffects params, before the audio starts
 */

/** The oscillator: what shape it is, what pitch, how loud. */
const OSCILLATOR = [
    {
        id: 'm-waveformSelect',
        kind: 'select',
        read: ({ settings }) => settings.type ?? 'square',
        write: ({ studio }, value) => studio.synthesizer.setWaveform(value)
    },
    {
        id: 'm-dutyCycle',
        kind: 'select',
        read: ({ settings }) => String(settings.dutyCycle ?? 0.5),
        write: ({ studio }, value) => studio.synthesizer.setDutyCycle(Number(value))
    },
    {
        id: 'm-phaseSlider',
        value: 'm-phaseValue',
        kind: 'range',
        read: ({ settings }) => settings.phase ?? 0,
        write: ({ studio }, value) => studio.synthesizer.setPhase(value)
    },
    {
        id: 'm-octaveOffsetSelect',
        kind: 'select',
        read: ({ settings }) => String(settings.octaveOffset ?? 0),
        write: ({ studio }, value) => studio.synthesizer.setOctaveOffset(Number(value))
    },
    {
        id: 'm-semitoneSlider',
        value: 'm-semitoneValue',
        kind: 'range',
        read: ({ settings }) => settings.semitoneOffset ?? 0,
        write: ({ studio }, value) => studio.synthesizer.setSemitoneOffset(value)
    },
    {
        id: 'm-detuneSlider',
        value: 'm-detuneValue',
        kind: 'range',
        read: ({ settings }) => settings.detune ?? 0,
        write: ({ studio }, value) => studio.synthesizer.setDetune(value)
    },
    {
        id: 'm-pitchEnvSlider',
        value: 'm-pitchEnvValue',
        kind: 'range',
        read: ({ settings }) => settings.pitchEnv ?? 0,
        write: ({ studio }, value) => studio.synthesizer.setPitchEnv(value)
    },
    {
        id: 'm-glideSlider',
        value: 'm-glideValue',
        kind: 'range',
        read: ({ settings }) => settings.glide ?? 0,
        write: ({ studio }, value) => studio.synthesizer.setGlide(value)
    },
    {
        id: 'm-unisonVoicesSelect',
        kind: 'select',
        read: ({ settings }) => String(settings.unisonVoices ?? 1),
        write: ({ studio }, value) => studio.synthesizer.setUnisonVoices(Number(value))
    },
    {
        id: 'm-unisonDetuneSlider',
        value: 'm-unisonDetuneValue',
        kind: 'range',
        read: ({ settings }) => settings.unisonDetune ?? 0,
        write: ({ studio }, value) => studio.synthesizer.setUnisonDetune(value)
    },
    {
        id: 'm-unisonSpreadSlider',
        value: 'm-unisonSpreadValue',
        kind: 'range',
        read: ({ settings }) => settings.unisonSpread ?? 0,
        write: ({ studio }, value) => studio.synthesizer.setUnisonSpread(value)
    },
    {
        id: 'm-volumeSlider',
        value: 'm-volumeValue',
        kind: 'range',
        read: ({ settings }) => settings.volume ?? 0.3,
        write: ({ studio }, value) => studio.synthesizer.setVolume(value)
    }
];

/**
 * The filter. Cutoff and resonance are not here: they are the XY pad's, and
 * a pad is not a slider.
 */
const FILTER = [
    {
        id: 'm-filterTypeSelect',
        kind: 'select',
        read: ({ settings }) => settings.filterType ?? 'lowpass',
        write: ({ studio }, value) => studio.synthesizer.setFilterType(value)
    },
    {
        id: 'm-filterKeyTrackSlider',
        value: 'm-filterKeyTrackValue',
        kind: 'range',
        read: ({ settings }) => settings.filterKeyTrack ?? 0,
        write: ({ studio }, value) => studio.synthesizer.setFilterKeyTrack(value)
    },
    {
        id: 'm-filterEnvAmountSlider',
        value: 'm-filterEnvAmountValue',
        kind: 'range',
        read: ({ settings }) => settings.filterEnvAmount ?? 0,
        write: ({ studio }, value) => studio.synthesizer.setFilterEnvAmount(value)
    }
];

/**
 * The three LFOs and the vibrato. The LFOs are identical but for their
 * number, so they are built rather than written out three times.
 */
const MODULATION = [
    ...[1, 2, 3].flatMap((number) => [
        {
            id: `m-lfo${number}WaveSelect`,
            kind: 'select',
            read: ({ settings }) => settings[`lfo${number}Wave`] ?? 'sine',
            write: ({ studio }, value) => studio.synthesizer[`setLfo${number}Wave`](value)
        },
        {
            id: `m-lfo${number}DelaySlider`,
            value: `m-lfo${number}DelayValue`,
            kind: 'range',
            read: ({ settings }) => settings[`lfo${number}Delay`] ?? 0,
            write: ({ studio }, value) => studio.synthesizer[`setLfo${number}Delay`](value)
        },
        {
            id: `m-lfo${number}SyncToggle`,
            kind: 'toggle',
            read: ({ settings }) => Boolean(settings[`lfo${number}Sync`]),
            write: ({ studio }, value) => studio.synthesizer[`setLfo${number}Sync`](value)
        }
    ]),
    {
        id: 'm-vibratoRate',
        value: 'm-vibratoRateValue',
        kind: 'range',
        read: ({ vibrato }) => vibrato.rate ?? 0,
        write: ({ studio }, value) => studio.synthesizer.setVibratoRate(value)
    },
    {
        id: 'm-vibratoDepth',
        value: 'm-vibratoDepthValue',
        kind: 'range',
        read: ({ vibrato }) => vibrato.depth ?? 0,
        write: ({ studio }, value) => studio.synthesizer.setVibratoDepth(value)
    }
];

/** The amplitude envelope. */
const ENVELOPE = [
    ['attack', 0.01],
    ['decay', 0.1],
    ['sustain', 0.7],
    ['release', 0.2]
].map(([stage, fallback]) => ({
    id: `m-${stage}Slider`,
    value: `m-${stage}Value`,
    kind: 'range',
    read: ({ envelope }) => envelope[stage] ?? fallback,
    write: ({ studio }, value) =>
        studio.synthesizer[`set${stage[0].toUpperCase()}${stage.slice(1)}`](value)
}));

/**
 * The per-track effect chain.
 *
 * These are the one group that does not exist before the audio does: the
 * chain is built on the first press of Play. `read` says so by coming back
 * undefined, and the panel leaves the control where the markup put it.
 */
const EFFECTS = [
    ['m-fxDistSlider', 'm-fxDistValue', 'distortion', 'setDistortion'],
    ['m-fxDelayTimeSlider', 'm-fxDelayTimeValue', 'delayTime', 'setDelayTime'],
    ['m-fxDelayFbSlider', 'm-fxDelayFbValue', 'delayFeedback', 'setDelayFeedback'],
    ['m-fxDelayMixSlider', 'm-fxDelayMixValue', 'delayMix', 'setDelayMix'],
    ['m-fxReverbMixSlider', 'm-fxReverbMixValue', 'reverbMix', 'setReverbMix'],
    ['m-fxReverbDecaySlider', 'm-fxReverbDecayValue', 'reverbDecay', 'setReverbDecay'],
    ['m-fxChorusRateSlider', 'm-fxChorusRateValue', 'chorusRate', 'setChorusRate'],
    ['m-fxChorusDepthSlider', 'm-fxChorusDepthValue', 'chorusDepth', 'setChorusDepth'],
    ['m-fxChorusMixSlider', 'm-fxChorusMixValue', 'chorusMix', 'setChorusMix'],
    ['m-fxCrushBitsSlider', 'm-fxCrushBitsValue', 'crushBits', 'setBitcrusherBits'],
    ['m-fxCrushRateSlider', 'm-fxCrushRateValue', 'crushRate', 'setBitcrusherRate']
].map(([id, value, key, setter]) => ({
    id,
    value,
    kind: 'range',
    read: ({ effects }) => effects?.[key],
    write: ({ studio, track }, newValue) => studio.trackEffects?.[setter](track, newValue)
}));

/** The arpeggiator, whose settings are its own rather than the track's. */
const ARPEGGIATOR = [
    {
        id: 'm-arpModeSelect',
        kind: 'select',
        read: ({ studio, track }) => studio.arpeggiator.getSettings(track).mode ?? 'off',
        write: ({ studio, track }, value) =>
            studio.arpeggiator.updateSettings(track, { mode: value })
    },
    {
        id: 'm-arpRateSelect',
        kind: 'select',
        read: ({ studio, track }) => studio.arpeggiator.getSettings(track).rate ?? '1/8',
        write: ({ studio, track }, value) =>
            studio.arpeggiator.updateSettings(track, { rate: value })
    },
    {
        id: 'm-arpOctaveSelect',
        kind: 'select',
        read: ({ studio, track }) => String(studio.arpeggiator.getSettings(track).octaves ?? 1),
        write: ({ studio, track }, value) =>
            studio.arpeggiator.updateSettings(track, { octaves: Number(value) })
    },
    {
        id: 'm-arpGateSlider',
        value: 'm-arpGateValue',
        kind: 'range',
        read: ({ studio, track }) => studio.arpeggiator.getSettings(track).gate ?? 0.5,
        write: ({ studio, track }, value) =>
            studio.arpeggiator.updateSettings(track, { gate: value })
    }
];

/** @type {SynthControl[]} */
export const SYNTH_CONTROLS = Object.freeze([
    ...OSCILLATOR,
    ...FILTER,
    ...MODULATION,
    ...ENVELOPE,
    ...EFFECTS,
    ...ARPEGGIATOR
]);

/** What an undo entry is called for each group, so the list reads sensibly. */
export const UNDO_LABEL = 'Synth parameter';
