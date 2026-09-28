/**
 * The envelopes you drew, in the file you export.
 *
 * In playback a lane is written one step at a time: the sequencer says
 * which step is sounding and each lane calls the module that owns its
 * parameter. An offline render has no sequencer and no ticking clock:
 * it builds the whole graph, books everything against a timeline and
 * runs it faster than real time: so there is nothing to call and
 * nowhere to call it from. The envelopes have to be booked too, onto
 * the AudioParams of the offline graph, before the render starts.
 *
 * Which is why they were simply absent: a filter sweep or a fader ride
 * you spent ten minutes drawing was in the studio and not in the WAV,
 * and nothing said so.
 *
 * What is here is the one thing the live path cannot supply: where each
 * lane lands in an offline graph. Everything else is taken from the
 * automation module itself: the range, whether the parameter is
 * logarithmic, and the conversion from a 0..1 lane value to hertz or
 * decibels or seconds. The export cannot drift from playback, because
 * it is doing the same arithmetic out of the same table.
 */

/** Below this an exponential ramp cannot go, and neither can silence. */
const LOG_FLOOR = 0.001;

/**
 * Where each master-effects lane lands in an offline graph.
 *
 * A lane whose effect is switched off has no node to land on, and is
 * skipped: an envelope for a delay that is not in the chain would be
 * drawing a line that does nothing, which is exactly what it does in
 * playback too.
 *
 * `reverbDecay` is not here. It is not an AudioParam but the impulse
 * response itself, which cannot be ramped; the render builds the tail
 * the song starts on instead. See `startingReverbDecay`.
 */
const MASTER_FX_TARGETS = Object.freeze({
    filterFreq: (nodes) => nodes.filter?.frequency,
    filterQ: (nodes) => nodes.filter?.Q,
    chorusRate: (nodes) => nodes.chorusLfo?.frequency,
    chorusMix: (nodes) => nodes.chorusWet?.gain,
    delayTime: (nodes) => nodes.delay?.delayTime,
    delayFeedback: (nodes) => nodes.delayFeedback?.gain,
    delayMix: (nodes) => nodes.delayWet?.gain,
    reverbMix: (nodes) => nodes.reverbWet?.gain
});

/**
 * The two wheels are not part of any one node.
 *
 * Every voice reads them from a constant source, so automating them
 * means booking the constant. The factor is what the live engine
 * multiplies by on its way to the oscillators: a bend in semitones
 * becomes cents, and a modulation of 0..1 becomes hertz of vibrato.
 */
const WHEEL_TARGETS = Object.freeze({
    pitchBend: { node: 'pitchBendNode', factor: 200 },
    modulation: { node: 'modulationNode', factor: 15 }
});

/** What one strip of the console offers, by the suffix its lanes carry. */
const STRIP_TARGETS = Object.freeze({
    Vol: (strip) => strip.gain?.gain,
    Pan: (strip) => strip.pan?.pan,
    EqLow: (strip) => strip.eqLow?.gain,
    EqMid: (strip) => strip.eqMid?.gain,
    EqHigh: (strip) => strip.eqHigh?.gain,
    // The offline strip only has a compressor when the project asked for
    // one, so a lane on a compressor that is switched off writes nowhere.
    CompTh: (strip) => strip.compressor?.threshold,
    CompRt: (strip) => strip.compressor?.ratio,
    CompAtk: (strip) => strip.compressor?.attack,
    CompRel: (strip) => strip.compressor?.release
});

/**
 * The decay the reverb tail should be built from.
 *
 * An impulse response cannot be ramped: it is a buffer, generated once.
 * A decay lane still has to start somewhere, and where it starts is a
 * truer answer than whatever the control happens to read at the moment
 * Export was pressed.
 *
 * @param {object|null} fxAutomation
 * @returns {number|null} the decay in seconds, or null to keep the stored one
 */
export function startingReverbDecay(fxAutomation) {
    const lane = fxAutomation?.getLane?.('reverbDecay');
    if (!lane?.length) return null;

    return fxAutomation.denormalize('reverbDecay', lane[0].value);
}

/**
 * Whether a lane will move something, and so whether the thing has to
 * exist before the render starts.
 *
 * The wheels are the case that matters: a bend at rest needs no node at
 * all, but one that a lane is about to move does.
 *
 * @param {object|null} fxAutomation
 * @param {string} key
 */
export function willBeAutomated(fxAutomation, key) {
    return Boolean(fxAutomation?.getLane?.(key)?.length);
}

/**
 * Book the master effects and the two wheels.
 *
 * @param {object} graph
 * @param {object|null} graph.masterFxChain  from `buildOfflineMasterFx`
 * @param {AudioNode|null} graph.pitchBendNode
 * @param {AudioNode|null} graph.modulationNode
 * @param {object|null} fxAutomation
 * @param {number} stepDuration  seconds per sixteenth
 */
export function scheduleFxAutomation(graph, fxAutomation, stepDuration) {
    if (!fxAutomation) return;

    const nodes = graph.masterFxChain?.nodes;
    if (nodes) {
        for (const [key, find] of Object.entries(MASTER_FX_TARGETS)) {
            scheduleLane(find(nodes), key, fxAutomation, stepDuration);
        }
    }

    for (const [key, { node, factor }] of Object.entries(WHEEL_TARGETS)) {
        scheduleLane(graph[node]?.offset, key, fxAutomation, stepDuration, factor);
    }
}

/**
 * Book the console: eight strips and the master fader.
 *
 * @param {Array<object>} strips  from `buildOfflineChannelStrip`
 * @param {AudioNode} masterGain
 * @param {object|null} mixerAutomation
 * @param {number} stepDuration
 */
export function scheduleMixerAutomation(strips, masterGain, mixerAutomation, stepDuration) {
    if (!mixerAutomation) return;

    strips.forEach((strip, track) => {
        if (!strip) return;

        for (const [suffix, find] of Object.entries(STRIP_TARGETS)) {
            scheduleLane(find(strip), `t${track}${suffix}`, mixerAutomation, stepDuration);
        }
    });

    scheduleLane(masterGain?.gain, 'masterVol', mixerAutomation, stepDuration);
}

/**
 * Write one lane onto one AudioParam.
 *
 * The shape follows playback: the value holds before the first
 * breakpoint and after the last, and moves between them. A logarithmic
 * parameter is ramped exponentially, so a filter sweep sounds like one
 * sweep rather than like most of it happening at the end.
 *
 * @param {AudioParam|undefined} audioParam  absent when the effect is off
 * @param {string} key
 * @param {object} automation  the lane module, for its table and its maths
 * @param {number} stepDuration
 * @param {number} [factor]  applied after the conversion, for the wheels
 */
function scheduleLane(audioParam, key, automation, stepDuration, factor = 1) {
    const lane = automation.getLane(key);
    if (!audioParam || !lane.length) return;

    const definition = automation.params?.[key];
    const logarithmic = Boolean(definition?.log);
    const valueAt = (normal) => automation.denormalize(key, normal) * factor;

    // Before the first breakpoint the lane holds its first value, as it
    // does in playback. Without this the parameter would start at
    // whatever the control was left on and jump at the first point.
    audioParam.setValueAtTime(valueAt(lane[0].value), 0);

    for (const [index, point] of lane.entries()) {
        const time = point.step * stepDuration;
        const value = valueAt(point.value);

        if (index === 0) {
            audioParam.setValueAtTime(value, time);
        } else if (logarithmic && value > 0) {
            audioParam.exponentialRampToValueAtTime(Math.max(LOG_FLOOR, value), time);
        } else {
            audioParam.linearRampToValueAtTime(value, time);
        }
    }
}
