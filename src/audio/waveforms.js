/**
 * The tables an oscillator plays.
 *
 * Three of the four tonal shapes are built into the Web Audio oscillator and
 * cost nothing to ask for by name. A pulse wave is not: a duty cycle has to
 * be spelled out as harmonics: and neither is a start phase, which is a
 * rotation of those harmonics and so has to be spelled out too.
 *
 * The rule here is therefore: a built-in type whenever one will do, a table
 * only when the sound asks for something the built-ins cannot say.
 *
 * The live engine and the offline renderer both come through this module.
 * They build the same voice against different clocks, and a wave that
 * differed between them would be an export that does not sound like what
 * was played.
 */

/**
 * How many harmonics a table carries.
 *
 * The pulse table has used thirty-two since the first version of the engine,
 * and rotating a wave must not change how bright it is, so that number stays
 * where it is: at phase zero the table below is the one the engine has always
 * built.
 *
 * The other three shapes have no table until a phase is asked for. Giving
 * them thirty-two would dull a bass sawtooth the moment the slider left
 * zero (thirty-two harmonics of a 55 Hz note stop at 1.8 kHz) so they are
 * written out in full instead. The browser drops whatever sits above Nyquist
 * for the pitch actually being played, which is what the built-in types do,
 * so a generous series costs nothing and a low note keeps its edge.
 */
const PULSE_HARMONICS = 32;
const PHASE_HARMONICS = 256;

/** Shapes the oscillator can produce on its own, given no phase. */
const BUILT_IN = new Set(['sine', 'triangle', 'sawtooth']);

/** Phase in degrees as a fraction of one turn, in 0..1. */
function turns(phase) {
    return ((((phase || 0) % 360) + 360) % 360) / 360;
}

/**
 * The sine coefficients of one shape, harmonic by harmonic.
 *
 * Index zero is the constant term, which none of these shapes has. Each
 * series is the textbook one for its waveform, matched to what the browser's
 * own oscillator produces so that turning the phase past zero does not also
 * change the sound.
 */
function series(type, dutyCycle) {
    if (type === 'sine') {
        const imag = new Float32Array(2);
        imag[1] = 1;
        return imag;
    }

    if (type === 'square') {
        const imag = new Float32Array(PULSE_HARMONICS);
        for (let n = 1; n < PULSE_HARMONICS; n++) {
            imag[n] = (4 / (Math.PI * n)) * Math.sin(n * Math.PI * dutyCycle);
        }
        return imag;
    }

    const imag = new Float32Array(PHASE_HARMONICS);
    if (type === 'sawtooth') {
        // A ramp rising from -1 to 1, the way the built-in sawtooth runs.
        for (let n = 1; n < PHASE_HARMONICS; n++) {
            imag[n] = (n % 2 ? 2 : -2) / (Math.PI * n);
        }
    } else {
        // Triangle: odd harmonics only, falling as 1/n², alternating sign.
        for (let n = 1; n < PHASE_HARMONICS; n += 2) {
            const sign = ((n - 1) / 2) % 2 === 0 ? 1 : -1;
            imag[n] = (sign * 8) / (Math.PI * Math.PI * n * n);
        }
    }
    return imag;
}

/**
 * The same shape, read from `phase` degrees into its cycle.
 *
 * Moving the angle turns one sine term into a sine and a cosine of the same
 * harmonic: sin(n(θ+φ)) = sin(nθ)·cos(nφ) + cos(nθ)·sin(nφ). The nth harmonic
 * turns n times as fast as the first, which is why every term is rotated by
 * its own multiple of the angle and not by the angle itself: rotating them
 * all equally would bend the shape rather than slide it.
 *
 * At phase zero this is the identity: cos 0 is one and sin 0 is nothing.
 */
function rotate(imag, phase) {
    const angle = turns(phase) * 2 * Math.PI;
    const real = new Float32Array(imag.length);
    if (angle === 0) return { real, imag };

    const turned = new Float32Array(imag.length);
    for (let n = 1; n < imag.length; n++) {
        if (imag[n] === 0) continue;
        real[n] = imag[n] * Math.sin(n * angle);
        turned[n] = imag[n] * Math.cos(n * angle);
    }
    return { real, imag: turned };
}

/**
 * True when this combination needs a table rather than a built-in type.
 *
 * Noise is a buffer rather than an oscillator and has no cycle to start in,
 * so it has no phase either; an unknown shape is handed to the oscillator
 * as it is, which is what the engine has always done with it.
 */
export function needsWaveTable(type, phase = 0) {
    if (type === 'square') return true;
    return BUILT_IN.has(type) && turns(phase) !== 0;
}

/** What a built table is stored under. Duty only says anything for a pulse. */
export function waveKey(type, dutyCycle = 0.5, phase = 0) {
    const turn = turns(phase).toFixed(4);
    return type === 'square'
        ? `square:${(dutyCycle ?? 0.5).toFixed(4)}:${turn}`
        : `${type}:${turn}`;
}

/** @returns {PeriodicWave} */
export function buildWaveTable(context, type, dutyCycle = 0.5, phase = 0) {
    const { real, imag } = rotate(series(type, dutyCycle ?? 0.5), phase);
    // Normalized, so that a rotated wave comes out at the level of the one
    // it replaces rather than at whatever its own peak happens to be.
    return context.createPeriodicWave(real, imag, { disableNormalization: false });
}

/**
 * Give an oscillator the shape a track asks for.
 *
 * `cache` is a Map the caller keeps: one per engine, one per render. Without
 * it every note would rebuild the same two arrays, which is what the note
 * scheduler can least afford.
 *
 * @param {BaseAudioContext} context
 * @param {OscillatorNode} oscillator
 * @param {{type: string, dutyCycle?: number, phase?: number}} shape
 * @param {Map<string, PeriodicWave>|null} [cache]
 */
export function setOscillatorWave(context, oscillator, shape, cache = null) {
    const { type, dutyCycle = 0.5, phase = 0 } = shape;

    if (!needsWaveTable(type, phase)) {
        oscillator.type = type;
        return;
    }

    if (!cache) {
        oscillator.setPeriodicWave(buildWaveTable(context, type, dutyCycle, phase));
        return;
    }

    const key = waveKey(type, dutyCycle, phase);
    let wave = cache.get(key);
    if (!wave) {
        wave = buildWaveTable(context, type, dutyCycle, phase);
        cache.set(key, wave);
    }
    oscillator.setPeriodicWave(wave);
}
