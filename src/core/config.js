/**
 * Application configuration and feature flags.
 *
 * 8BitForge Studio is local-first: everything works with no account and no
 * network. Anything that talks to a server is a feature flag, disabled by
 * default, that the user turns on from the settings panel.
 */

export const APP_NAME = '8BitForge Studio';

/** File extension and MIME type of a project file. */
export const PROJECT_EXTENSION = '8bitforge';
export const PROJECT_MIME = 'application/json';

/** Default feature flags. Persisted preferences override these at startup. */
export const DEFAULT_FEATURES = Object.freeze({
    /**
     * Sign in to a 8BitForge account. The hosted web build turns it on
     * (VITE_ACCOUNT=1); arriving by a sign-in link turns it on for that
     * visit. On, it still calls nothing until someone signs in.
     */
    account: false,
    /** Browse and download resources shared by other users. */
    community: false,
    /** Publish your own kits, presets and projects. */
    publishing: false,
    /** Real-time collaboration on a project. */
    collaboration: false
});

/**
 * Base URL of the optional 8BitForge API.
 * Only ever contacted when one of the online features above is enabled.
 * A build can point elsewhere with VITE_API_URL, for a local API.
 */
export const DEFAULT_API_URL = 'https://api.8bitforge.com';
export const API_URL = import.meta.env.VITE_API_URL || DEFAULT_API_URL;

/**
 * Runtime feature state. Mutated through `setFeature`, read through `isEnabled`,
 * so that call sites never have to know where the preference came from.
 */
const features = { ...DEFAULT_FEATURES };

/** @param {keyof typeof DEFAULT_FEATURES} name */
export function isEnabled(name) {
    return features[name] === true;
}

/**
 * @param {keyof typeof DEFAULT_FEATURES} name
 * @param {boolean} value
 */
export function setFeature(name, value) {
    if (!(name in features)) throw new Error(`Unknown feature flag: ${name}`);
    features[name] = value === true;
}

/** @param {Partial<typeof DEFAULT_FEATURES>} stored */
export function loadFeatures(stored) {
    if (!stored) return;
    for (const [name, value] of Object.entries(stored)) {
        if (name in features) features[name] = value === true;
    }
}

/** @returns {typeof DEFAULT_FEATURES} */
export function getFeatures() {
    return { ...features };
}
