/**
 * The nine pads of the synth window, as data.
 *
 * Each pad is two parameters and the scale that maps them onto the square.
 * Like the knobs' table next door, an entry says how to read a value and
 * how to write it, so the pad that sets a cutoff is also the pad that shows
 * where the cutoff already is.
 *
 * Three of these pads are the only way to reach their parameters at all:
 * cutoff and resonance, the filter envelope, the filter LFO have no slider
 * anywhere in the window. The other six double up with a knob, and both
 * have to end up in step, which is why they carry the id of the knob they
 * shadow: moving a pad refreshes it.
 *
 * Colours are the section's, as the markup already paints its borders:
 * filter cyan, modulation magenta, envelope orange.
 *
 * @typedef {object} PadAxis
 * @property {(context: import('./synth-parameters.js').SynthContext) => number} read
 * @property {(studio: import('../studio.js').Studio, value: number) => void} write
 * @property {(fraction: number) => number} fromFraction
 * @property {(value: number) => number} toFraction
 * @property {string} display      the element that prints the value
 * @property {(value: number) => string} format
 * @property {string} [knob]       a slider showing the same thing
 */

const FILTER_COLOR = '#00bcd4';
const MODULATION_COLOR = '#e040fb';
const ENVELOPE_COLOR = '#ff9800';

/** A value that moves evenly across the pad. */
function linear(min, max) {
    return {
        fromFraction: (fraction) => min + fraction * (max - min),
        toFraction: (value) => (value - min) / (max - min)
    };
}

/**
 * A value that moves by ratio rather than by amount: a filter cutoff, where
 * the octave from 100 to 200 Hz deserves as much of the pad as the one from
 * 5 to 10 kHz.
 */
function logarithmic(min, max) {
    const decades = Math.log(max / min);
    return {
        fromFraction: (fraction) => min * Math.exp(fraction * decades),
        toFraction: (value) => Math.log(Math.max(value, min) / min) / decades
    };
}

/** Rounded to a whole number. */
const whole = (value) => String(Math.round(value));
/** One or two decimals, for a time or a rate. */
const tenths = (value) => value.toFixed(1);
const hundredths = (value) => value.toFixed(2);

/** @type {ReadonlyArray<{pad: string, cursor: string, grid: string, color: string, label: string, x: PadAxis, y: PadAxis}>} */
export const SYNTH_PADS = Object.freeze([
    {
        pad: 'smFilterPad',
        cursor: 'smFilterCursor',
        grid: 'smFilterGrid',
        color: FILTER_COLOR,
        label: 'Filter',
        x: {
            ...logarithmic(20, 20000),
            read: ({ settings }) => settings.filterCutoff ?? 20000,
            write: (studio, value) => studio.synthesizer.setFilterCutoff(value),
            display: 'smCutoffDisplay',
            format: whole
        },
        y: {
            ...linear(0.1, 30),
            read: ({ settings }) => settings.filterQ ?? 0.1,
            write: (studio, value) => studio.synthesizer.setFilterQ(value),
            display: 'smResDisplay',
            format: tenths
        }
    },
    {
        pad: 'smFilterEnvPad',
        cursor: 'smFilterEnvCursor',
        grid: 'smFilterEnvGrid',
        color: FILTER_COLOR,
        label: 'Filter envelope',
        x: {
            ...linear(0, 1),
            read: ({ settings }) => settings.filterEnvAttack ?? 0.01,
            write: (studio, value) => studio.synthesizer.setFilterEnvAttack(value),
            display: 'smFiltEnvAtkDisplay',
            format: hundredths
        },
        y: {
            ...linear(0, 2),
            read: ({ settings }) => settings.filterEnvRelease ?? 0.2,
            write: (studio, value) => studio.synthesizer.setFilterEnvRelease(value),
            display: 'smFiltEnvRelDisplay',
            format: hundredths
        }
    },
    {
        pad: 'smFilterLfoPad',
        cursor: 'smFilterLfoCursor',
        grid: 'smFilterLfoGrid',
        color: FILTER_COLOR,
        label: 'Filter LFO',
        x: {
            ...linear(0, 20),
            read: ({ settings }) => settings.filterLfoRate ?? 0,
            write: (studio, value) => studio.synthesizer.setFilterLfoRate(value),
            display: 'smFiltLfoRateDisplay',
            format: tenths
        },
        y: {
            ...linear(0, 100),
            read: ({ settings }) => settings.filterLfoDepth ?? 0,
            write: (studio, value) => studio.synthesizer.setFilterLfoDepth(value),
            display: 'smFiltLfoDepthDisplay',
            format: whole
        }
    },
    {
        pad: 'smLfoPitchPad',
        cursor: 'smLfoPitchCursor',
        grid: 'smLfoPitchGrid',
        color: MODULATION_COLOR,
        label: 'Vibrato',
        x: {
            ...linear(0, 20),
            read: ({ vibrato }) => vibrato.rate ?? 0,
            write: (studio, value) => studio.synthesizer.setVibratoRate(value),
            display: 'smLfoPitchRateDisplay',
            format: tenths,
            knob: 'm-vibratoRate'
        },
        y: {
            ...linear(0, 100),
            read: ({ vibrato }) => vibrato.depth ?? 0,
            write: (studio, value) => studio.synthesizer.setVibratoDepth(value),
            display: 'smLfoPitchDepthDisplay',
            format: whole,
            knob: 'm-vibratoDepth'
        }
    },
    {
        pad: 'smLfoFilterPad',
        cursor: 'smLfoFilterCursor',
        grid: 'smLfoFilterGrid',
        color: MODULATION_COLOR,
        label: 'LFO to filter',
        x: {
            ...linear(0, 20),
            read: ({ settings }) => settings.lfoFilterRate ?? 0,
            write: (studio, value) => studio.synthesizer.setLfoFilterRate(value),
            display: 'smLfoFilterRateDisplay',
            format: tenths
        },
        y: {
            ...linear(0, 100),
            read: ({ settings }) => settings.lfoFilterDepth ?? 0,
            write: (studio, value) => studio.synthesizer.setLfoFilterDepth(value),
            display: 'smLfoFilterDepthDisplay',
            format: whole
        }
    },
    {
        pad: 'smLfoTremoloPad',
        cursor: 'smLfoTremoloCursor',
        grid: 'smLfoTremoloGrid',
        color: MODULATION_COLOR,
        label: 'Tremolo',
        x: {
            ...linear(0, 20),
            read: ({ settings }) => settings.tremoloRate ?? 0,
            write: (studio, value) => studio.synthesizer.setTremoloRate(value),
            display: 'smLfoTremoloRateDisplay',
            format: tenths
        },
        y: {
            ...linear(0, 100),
            read: ({ settings }) => settings.tremoloDepth ?? 0,
            write: (studio, value) => studio.synthesizer.setTremoloDepth(value),
            display: 'smLfoTremoloDepthDisplay',
            format: whole
        }
    },
    {
        pad: 'smEnvADPad',
        cursor: 'smEnvADCursor',
        grid: 'smEnvADGrid',
        color: ENVELOPE_COLOR,
        label: 'Attack and decay',
        x: {
            ...linear(0, 1),
            read: ({ envelope }) => envelope.attack ?? 0.01,
            write: (studio, value) => studio.synthesizer.setAttack(value),
            display: 'smEnvAttackDisplay',
            format: hundredths,
            knob: 'm-attackSlider'
        },
        y: {
            ...linear(0, 2),
            read: ({ envelope }) => envelope.decay ?? 0.1,
            write: (studio, value) => studio.synthesizer.setDecay(value),
            display: 'smEnvDecayDisplay',
            format: hundredths,
            knob: 'm-decaySlider'
        }
    },
    {
        pad: 'smEnvSRPad',
        cursor: 'smEnvSRCursor',
        grid: 'smEnvSRGrid',
        color: ENVELOPE_COLOR,
        label: 'Sustain and release',
        x: {
            ...linear(0, 1),
            read: ({ envelope }) => envelope.sustain ?? 0.7,
            write: (studio, value) => studio.synthesizer.setSustain(value),
            display: 'smEnvSustainDisplay',
            format: hundredths,
            knob: 'm-sustainSlider'
        },
        y: {
            ...linear(0, 2),
            read: ({ envelope }) => envelope.release ?? 0.2,
            write: (studio, value) => studio.synthesizer.setRelease(value),
            display: 'smEnvReleaseDisplay',
            format: hundredths,
            knob: 'm-releaseSlider'
        }
    },
    {
        pad: 'smPitchEnvPad',
        cursor: 'smPitchEnvCursor',
        grid: 'smPitchEnvGrid',
        color: ENVELOPE_COLOR,
        label: 'Pitch envelope',
        x: {
            // Crosses zero, so the middle of the pad is no pitch sweep.
            ...linear(-48, 48),
            read: ({ settings }) => settings.pitchEnv ?? 0,
            write: (studio, value) => studio.synthesizer.setPitchEnv(value),
            display: 'smPitchEnvAmtDisplay',
            format: whole,
            knob: 'm-pitchEnvSlider'
        },
        y: {
            ...linear(0, 1),
            read: ({ settings }) => settings.glide ?? 0,
            write: (studio, value) => studio.synthesizer.setGlide(value),
            display: 'smPitchEnvGlideDisplay',
            format: hundredths,
            knob: 'm-glideSlider'
        }
    }
]);
