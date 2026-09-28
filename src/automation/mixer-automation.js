/**
 * Mixer automation: envelopes for the console, along the song.
 *
 * The lanes themselves are `LaneAutomation`. What is here is the table of
 * what can be automated: for each of the eight tracks a fader, a pan, three
 * EQ bands and a compressor, plus the master fader. That is nine lanes a
 * track, which is why the panel shows one track at a time.
 *
 * Every group is always live: a track exists whether or not anything is
 * playing on it: so the filter is a way of looking at the console rather
 * than a list of what is switched on.
 */

import { LaneAutomation } from './lane-automation.js';

export const MIXER_AUTOMATION_EVENTS = Object.freeze({
    changed: 'mixauto:changed',
    applied: 'mixauto:applied',
    recording: 'mixauto:recording'
});

export const TRACK_NAMES = Object.freeze([
    'Lead',
    'Harmony',
    'Bass',
    'Arp',
    'Kick',
    'Snare',
    'Hi-Hat',
    'FX'
]);

const TRACK_COLORS = [
    '#e74c3c',
    '#e67e22',
    '#f1c40f',
    '#2ecc71',
    '#1abc9c',
    '#3498db',
    '#9b59b6',
    '#e91e63'
];

/** The master strip is track −1, as it is everywhere else in the studio. */
const MASTER = -1;

/** What each track offers, in the order a channel strip has it. */
const TRACK_PARAMS = [
    { suffix: 'Vol', name: 'Vol', min: 0, max: 1.5, default: 1, log: false },
    { suffix: 'Pan', name: 'Pan', min: -1, max: 1, default: 0, log: false },
    { suffix: 'EqLow', name: 'EQ Lo', min: -12, max: 12, default: 0, log: false },
    { suffix: 'EqMid', name: 'EQ Mid', min: -12, max: 12, default: 0, log: false },
    { suffix: 'EqHigh', name: 'EQ Hi', min: -12, max: 12, default: 0, log: false },
    { suffix: 'CompTh', name: 'Comp Th', min: -60, max: 0, default: -24, log: false },
    { suffix: 'CompRt', name: 'Comp Rt', min: 1, max: 20, default: 4, log: false },
    { suffix: 'CompAtk', name: 'Comp Atk', min: 0.001, max: 0.1, default: 0.003, log: true },
    { suffix: 'CompRel', name: 'Comp Rel', min: 0.01, max: 1, default: 0.25, log: true }
];

/**
 * How each one is read from and written to the engine. The engine keeps the
 * mixer's settings itself, so a lane never has to hold them.
 */
const TRACK_BRIDGE = {
    Vol: {
        read: (engine, track) => engine.mixerSettings[track].volume,
        write: (engine, track, value) => engine.setTrackFaderVolume(track, value)
    },
    Pan: {
        read: (engine, track) => engine.mixerSettings[track].pan,
        write: (engine, track, value) => engine.setTrackPan(track, value)
    },
    EqLow: eqBand('eqLow'),
    EqMid: eqBand('eqMid'),
    EqHigh: eqBand('eqHigh'),
    CompTh: compressor('threshold', 'setTrackCompressorThreshold'),
    CompRt: compressor('ratio', 'setTrackCompressorRatio'),
    CompAtk: compressor('attack', 'setTrackCompressorAttack'),
    CompRel: compressor('release', 'setTrackCompressorRelease')
};

/** Every lane, keyed as the saved files already name them: `t3Pan`. */
export const PARAMS = Object.freeze(buildParams());

export class MixerAutomation extends LaneAutomation {
    /**
     * @param {object} options
     * @param {import('../audio/audio-engine.js').AudioEngine} options.audioEngine
     * @param {import('../sequencer/arrangement.js').Arrangement} options.arrangement
     * @param {import('../sequencer/sequencer.js').Sequencer} options.sequencer
     * @param {import('../core/event-bus.js').EventBus} [options.bus]
     */
    constructor({ audioEngine, arrangement, sequencer, bus }) {
        super({
            params: PARAMS,
            events: MIXER_AUTOMATION_EVENTS,
            targets: () => ({ audioEngine: this.audioEngine }),
            arrangement,
            sequencer,
            bus
        });

        this.audioEngine = audioEngine;
    }

    getGroups() {
        return [
            ...TRACK_NAMES.map((name, track) => ({ value: `track${track}`, label: name })),
            { value: 'master', label: 'Master' }
        ];
    }
}

function buildParams() {
    const params = {};

    for (const [track, name] of TRACK_NAMES.entries()) {
        for (const param of TRACK_PARAMS) {
            const bridge = TRACK_BRIDGE[param.suffix];

            params[`t${track}${param.suffix}`] = {
                label: `${name} ${param.name}`,
                trackIndex: track,
                min: param.min,
                max: param.max,
                default: param.default,
                log: param.log,
                color: TRACK_COLORS[track],
                group: `track${track}`,
                read: ({ audioEngine }) => bridge.read(audioEngine, track),
                write: ({ audioEngine }, value) => bridge.write(audioEngine, track, value)
            };
        }
    }

    params.masterVol = {
        label: 'Master Vol',
        trackIndex: MASTER,
        min: 0,
        max: 1.5,
        default: 0.5,
        log: false,
        color: '#ffffff',
        group: 'master',
        read: ({ audioEngine }) => audioEngine.getMasterVolume(),
        write: ({ audioEngine }, value) => audioEngine.setMasterVolume(value)
    };

    return params;
}

function eqBand(band) {
    return {
        read: (engine, track) => engine.mixerSettings[track][band],
        write: (engine, track, value) => engine.setTrackEQ(track, band, value)
    };
}

function compressor(key, setter) {
    return {
        read: (engine, track) => engine.mixerSettings[track].compressor?.[key] ?? 0,
        write: (engine, track, value) => engine[setter](track, value)
    };
}
