/**
 * Factory mastering presets.
 *
 * Kept apart from the engine so they read as data: a preset is exactly what
 * `MasteringEngine.deserialize` accepts, nothing more. `i18nKey` is the
 * translation key for the display name; `name` is the English fallback.
 */

const band = (type, freq, gain, q) => ({ type, freq, gain, q });

/** The flat, factory-default EQ curve. */
export const DEFAULT_EQ_BANDS = [
    band('highpass', 40, 0, 0.7),
    band('lowshelf', 200, 0, 0.7),
    band('peaking', 1000, 0, 1.0),
    band('highshelf', 6000, 0, 0.7),
    band('lowpass', 18000, 0, 0.7)
];

/** The factory-default compressor, disabled. */
export const DEFAULT_COMPRESSOR = {
    enabled: false,
    threshold: -12,
    ratio: 4,
    attack: 0.01,
    release: 0.1,
    makeupGain: 0
};

export const MASTERING_PRESETS = {
    default: {
        name: 'Default (Flat)',
        i18nKey: 'mst.preset.default',
        eq: { enabled: true, bands: DEFAULT_EQ_BANDS },
        compressor: DEFAULT_COMPRESSOR
    },
    'gentle-master': {
        name: 'Gentle Master',
        i18nKey: 'mst.preset.gentleMaster',
        eq: {
            enabled: true,
            bands: [
                band('highpass', 30, 0, 0.7),
                band('lowshelf', 150, 2, 0.7),
                band('peaking', 3000, 1, 0.8),
                band('highshelf', 8000, 1.5, 0.7),
                band('lowpass', 18000, 0, 0.7)
            ]
        },
        compressor: {
            enabled: true,
            threshold: -18,
            ratio: 2,
            attack: 0.02,
            release: 0.15,
            makeupGain: 2
        }
    },
    'loud-master': {
        name: 'Loud Master',
        i18nKey: 'mst.preset.loudMaster',
        eq: {
            enabled: true,
            bands: [
                band('highpass', 35, 0, 0.7),
                band('lowshelf', 100, 3, 0.7),
                band('peaking', 2500, 2, 1.2),
                band('highshelf', 10000, 2, 0.7),
                band('lowpass', 18000, 0, 0.7)
            ]
        },
        compressor: {
            enabled: true,
            threshold: -8,
            ratio: 6,
            attack: 0.005,
            release: 0.08,
            makeupGain: 6
        }
    },
    'bright-pop': {
        name: 'Bright Pop',
        i18nKey: 'mst.preset.brightPop',
        eq: {
            enabled: true,
            bands: [
                band('highpass', 40, 0, 0.7),
                band('lowshelf', 200, 1, 0.7),
                band('peaking', 800, -2, 1.0),
                band('highshelf', 8000, 4, 0.7),
                band('lowpass', 18000, 0, 0.7)
            ]
        },
        compressor: {
            enabled: true,
            threshold: -14,
            ratio: 3.5,
            attack: 0.01,
            release: 0.12,
            makeupGain: 3
        }
    },
    'warm-vintage': {
        name: 'Warm Vintage',
        i18nKey: 'mst.preset.warmVintage',
        eq: {
            enabled: true,
            bands: [
                band('highpass', 30, 0, 0.7),
                band('lowshelf', 250, 3, 0.7),
                band('peaking', 1000, 1, 0.8),
                band('highshelf', 5000, -2, 0.7),
                band('lowpass', 14000, 0, 0.7)
            ]
        },
        compressor: {
            enabled: true,
            threshold: -20,
            ratio: 2.5,
            attack: 0.025,
            release: 0.2,
            makeupGain: 2
        }
    },
    'edm-punch': {
        name: 'EDM Punch',
        i18nKey: 'mst.preset.edmPunch',
        eq: {
            enabled: true,
            bands: [
                band('highpass', 40, 0, 0.9),
                band('lowshelf', 80, 4, 0.7),
                band('peaking', 3500, 2, 1.5),
                band('highshelf', 10000, 3, 0.7),
                band('lowpass', 18000, 0, 0.7)
            ]
        },
        compressor: {
            enabled: true,
            threshold: -10,
            ratio: 5,
            attack: 0.003,
            release: 0.06,
            makeupGain: 5
        }
    },
    'lo-fi': {
        name: 'Lo-Fi',
        i18nKey: 'mst.preset.loFi',
        eq: {
            enabled: true,
            bands: [
                band('highpass', 60, 0, 0.7),
                band('lowshelf', 300, 3, 0.7),
                band('peaking', 2000, -1, 0.8),
                band('highshelf', 4000, -4, 0.7),
                band('lowpass', 12000, 0, 0.7)
            ]
        },
        compressor: DEFAULT_COMPRESSOR
    },
    orchestral: {
        name: 'Orchestral',
        i18nKey: 'mst.preset.orchestral',
        eq: {
            enabled: true,
            bands: [
                band('highpass', 25, 0, 0.5),
                band('lowshelf', 150, 1, 0.7),
                band('peaking', 2000, 0.5, 0.6),
                band('highshelf', 8000, 1, 0.7),
                band('lowpass', 18000, 0, 0.7)
            ]
        },
        compressor: {
            enabled: true,
            threshold: -24,
            ratio: 1.5,
            attack: 0.03,
            release: 0.25,
            makeupGain: 1
        }
    }
};

/** @returns {string[]} preset keys, in display order */
export function listMasteringPresets() {
    return Object.keys(MASTERING_PRESETS);
}
