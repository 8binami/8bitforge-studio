/**
 * FX automation: envelopes for the master effects and the mastering stage.
 *
 * The lanes themselves are `LaneAutomation`. What is here is the table of
 * what can be automated: each parameter's range, how it is drawn, and how to
 * reach the module that owns it: through that module's own interface, never
 * into its audio graph. A lane is a musical idea, not a shortcut.
 *
 * A group is only offered when its effect is switched on. An envelope for a
 * delay that is off would draw a line that does nothing.
 */

import { LaneAutomation } from './lane-automation.js';

export const FX_AUTOMATION_EVENTS = Object.freeze({
    /** A lane was edited, cleared or loaded. */
    changed: 'fxauto:changed',
    /** A step was played and parameters were written. */
    applied: 'fxauto:applied',
    recording: 'fxauto:recording'
});

/**
 * Every automatable parameter: its range, how it is drawn, and the two
 * functions that reach the module owning it.
 *
 * `read` and `write` take `{ masterFx, mastering }`. They use those modules'
 * own interfaces rather than their audio nodes: a lane is a musical idea,
 * not a shortcut into the graph.
 */
export const PARAMS = Object.freeze({
    filterFreq: {
        label: 'Filter Freq',
        min: 20,
        max: 20000,
        default: 1000,
        log: true,
        color: '#f39c12',
        group: 'filter',
        read: ({ masterFx }) => masterFx.filter.frequency,
        write: ({ masterFx }, value) => masterFx.setFilterFrequency(value)
    },
    filterQ: {
        label: 'Filter Q',
        min: 0.1,
        max: 30,
        default: 1,
        log: false,
        color: '#e67e22',
        group: 'filter',
        read: ({ masterFx }) => masterFx.filter.q,
        write: ({ masterFx }, value) => masterFx.setFilterQ(value)
    },
    chorusRate: {
        label: 'Chorus Rate',
        min: 0,
        max: 10,
        default: 1,
        log: false,
        color: '#9b59b6',
        group: 'chorus',
        read: ({ masterFx }) => masterFx.effects.chorus.rate,
        write: ({ masterFx }, value) => masterFx.setEffectParam('chorus', 'rate', value)
    },
    chorusMix: {
        label: 'Chorus Mix',
        min: 0,
        max: 1,
        default: 0.5,
        log: false,
        color: '#8e44ad',
        group: 'chorus',
        read: ({ masterFx }) => masterFx.effects.chorus.mix,
        write: ({ masterFx }, value) => masterFx.setEffectParam('chorus', 'mix', value)
    },
    delayTime: {
        label: 'Delay Time',
        min: 0,
        max: 2,
        default: 0.25,
        log: false,
        color: '#3498db',
        group: 'delay',
        read: ({ masterFx }) => masterFx.effects.delay.time,
        write: ({ masterFx }, value) => masterFx.setEffectParam('delay', 'time', value)
    },
    delayFeedback: {
        label: 'Delay FB',
        min: 0,
        max: 1,
        default: 0.3,
        log: false,
        color: '#2980b9',
        group: 'delay',
        read: ({ masterFx }) => masterFx.effects.delay.feedback,
        write: ({ masterFx }, value) => masterFx.setEffectParam('delay', 'feedback', value)
    },
    delayMix: {
        label: 'Delay Mix',
        min: 0,
        max: 1,
        default: 0.5,
        log: false,
        color: '#2471a3',
        group: 'delay',
        read: ({ masterFx }) => masterFx.effects.delay.mix,
        write: ({ masterFx }, value) => masterFx.setEffectParam('delay', 'mix', value)
    },
    reverbDecay: {
        label: 'Reverb Decay',
        min: 0,
        max: 5,
        default: 0.5,
        log: false,
        color: '#1abc9c',
        group: 'reverb',
        read: ({ masterFx }) => masterFx.effects.reverb.decay,
        write: ({ masterFx }, value) => masterFx.setEffectParam('reverb', 'decay', value)
    },
    reverbMix: {
        label: 'Reverb Mix',
        min: 0,
        max: 1,
        default: 0.5,
        log: false,
        color: '#16a085',
        group: 'reverb',
        read: ({ masterFx }) => masterFx.effects.reverb.mix,
        write: ({ masterFx }, value) => masterFx.setEffectParam('reverb', 'mix', value)
    },
    pitchBend: {
        label: 'Pitch Bend',
        min: -1,
        max: 1,
        default: 0,
        log: false,
        color: '#e91e63',
        group: 'wheel',
        read: ({ masterFx }) => masterFx.pitchBend,
        write: ({ masterFx }, value) => masterFx.setPitchBend(value)
    },
    modulation: {
        label: 'Modulation',
        min: 0,
        max: 1,
        default: 0,
        log: false,
        color: '#00bcd4',
        group: 'wheel',
        read: ({ masterFx }) => masterFx.modulation,
        write: ({ masterFx }, value) => masterFx.setModulation(value)
    },

    ...eqBand(0, 'Mst HPF Freq', 'freq', 20, 500, 40, true, '#e74c3c'),
    ...eqBand(1, 'Mst LowSh Freq', 'freq', 60, 1000, 200, true, '#f39c12'),
    ...eqBand(1, 'Mst LowSh Gain', 'gain', -24, 24, 0, false, '#f39c12'),
    ...eqBand(2, 'Mst Mid Freq', 'freq', 200, 8000, 1000, true, '#2ecc71'),
    ...eqBand(2, 'Mst Mid Gain', 'gain', -24, 24, 0, false, '#2ecc71'),
    ...eqBand(2, 'Mst Mid Q', 'q', 0.1, 18, 1, true, '#27ae60'),
    ...eqBand(3, 'Mst HiSh Freq', 'freq', 1000, 16000, 6000, true, '#3498db'),
    ...eqBand(3, 'Mst HiSh Gain', 'gain', -24, 24, 0, false, '#3498db'),
    ...eqBand(4, 'Mst LPF Freq', 'freq', 2000, 20000, 18000, true, '#9b59b6'),

    ...compressor('mastCompThresh', 'Mst Comp Thresh', 'threshold', -60, 0, -12, false, '#c0392b'),
    ...compressor('mastCompRatio', 'Mst Comp Ratio', 'ratio', 1, 20, 4, false, '#d35400'),
    ...compressor('mastCompAttack', 'Mst Comp Atk', 'attack', 0.001, 0.1, 0.01, true, '#27ae60'),
    ...compressor('mastCompRelease', 'Mst Comp Rel', 'release', 0.01, 1, 0.1, true, '#2980b9'),
    ...compressor('mastCompMakeup', 'Mst Comp Gain', 'makeupGain', 0, 24, 0, false, '#8e44ad')
});

/** The groups, in the order the rack has them, and what they are called. */
export const GROUP_LABELS = Object.freeze({
    filter: 'Filter',
    chorus: 'Chorus',
    delay: 'Delay',
    reverb: 'Reverb',
    wheel: 'Wheel',
    mastering: 'Mastering'
});

export class FxAutomation extends LaneAutomation {
    /**
     * @param {object} options
     * @param {import('../audio/master-fx.js').MasterFx} options.masterFx
     * @param {import('../audio/mastering.js').MasteringEngine} options.mastering
     * @param {import('../sequencer/arrangement.js').Arrangement} options.arrangement
     * @param {import('../sequencer/sequencer.js').Sequencer} options.sequencer
     * @param {import('../core/event-bus.js').EventBus} [options.bus]
     */
    constructor({ masterFx, mastering, arrangement, sequencer, bus }) {
        super({
            params: PARAMS,
            events: FX_AUTOMATION_EVENTS,
            targets: () => ({ masterFx: this.masterFx, mastering: this.mastering }),
            arrangement,
            sequencer,
            bus
        });

        this.masterFx = masterFx;
        this.mastering = mastering;
    }

    /**
     * A group is live when the effect behind it is switched on. An envelope
     * for an effect that is off would draw a line that does nothing.
     */
    isGroupActive(group) {
        switch (group) {
            case 'filter':
                return this.masterFx.filter.enabled;
            case 'chorus':
            case 'delay':
            case 'reverb':
                return this.masterFx.effects[group].enabled;
            case 'wheel':
                return true;
            case 'mastering':
                return !this.mastering.bypassed;
            default:
                return false;
        }
    }

    getGroups() {
        return Object.keys(GROUP_LABELS)
            .filter((group) => this.isGroupActive(group))
            .map((group) => ({
                value: group,
                label: GROUP_LABELS[group]
            }));
    }
}

/** One mastering EQ entry, keyed the way the saved files already name it. */
function eqBand(index, label, param, min, max, value, log, color) {
    const key = `mastEqB${index}${param[0].toUpperCase()}${param.slice(1)}`;
    return {
        [key]: {
            label,
            min,
            max,
            default: value,
            log,
            color,
            group: 'mastering',
            read: ({ mastering }) => mastering.eq.bands[index]?.[param] ?? 0,
            write: ({ mastering }, next) => mastering.setEqBand(index, param, next)
        }
    };
}

function compressor(key, label, param, min, max, value, log, color) {
    return {
        [key]: {
            label,
            min,
            max,
            default: value,
            log,
            color,
            group: 'mastering',
            read: ({ mastering }) => mastering.compressor[param] ?? 0,
            write: ({ mastering }, next) => mastering.setCompParam(param, next)
        }
    };
}
