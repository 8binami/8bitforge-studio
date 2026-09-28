/**
 * Flat ESLint configuration.
 *
 * Three environments live in this repository:
 *   - src/            renderer code (browser APIs, ES modules)
 *   - apps/desktop/   Electron main process (Node APIs)
 *   - scripts/, tests/ tooling (Node APIs)
 */

const browserGlobals = {
    window: 'readonly',
    document: 'readonly',
    navigator: 'readonly',
    CSS: 'readonly',
    console: 'readonly',
    fetch: 'readonly',
    localStorage: 'readonly',
    indexedDB: 'readonly',
    setTimeout: 'readonly',
    clearTimeout: 'readonly',
    setInterval: 'readonly',
    clearInterval: 'readonly',
    requestAnimationFrame: 'readonly',
    getComputedStyle: 'readonly',
    ResizeObserver: 'readonly',
    MutationObserver: 'readonly',
    Option: 'readonly',
    cancelAnimationFrame: 'readonly',
    Blob: 'readonly',
    File: 'readonly',
    FileReader: 'readonly',
    Image: 'readonly',
    URL: 'readonly',
    AudioContext: 'readonly',
    OfflineAudioContext: 'readonly',
    AudioWorkletNode: 'readonly',
    CustomEvent: 'readonly',
    Event: 'readonly',
    EventTarget: 'readonly',
    performance: 'readonly',
    structuredClone: 'readonly',
    TextEncoder: 'readonly',
    TextDecoder: 'readonly',
    DataView: 'readonly',
    Worker: 'readonly'
};

const nodeGlobals = {
    console: 'readonly',
    process: 'readonly',
    __dirname: 'readonly',
    Buffer: 'readonly',
    URL: 'readonly',
    setTimeout: 'readonly',
    clearTimeout: 'readonly',
    structuredClone: 'readonly',
    // Web APIs available in modern Node and in the Electron main process
    fetch: 'readonly',
    Response: 'readonly',
    Request: 'readonly',
    Headers: 'readonly',
    Blob: 'readonly',
    TextEncoder: 'readonly',
    TextDecoder: 'readonly'
};

const rules = {
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'no-undef': 'error',
    'no-var': 'error',
    'prefer-const': 'warn',
    eqeqeq: ['warn', 'smart'],
    'no-console': ['warn', { allow: ['warn', 'error', 'info'] }]
};

export default [
    {
        // `public/` and `vendor/` hold third-party assets we neither wrote
        // nor commit; linting them would only report their minifier's habits.
        ignores: ['dist/**', 'release/**', 'node_modules/**', 'public/**', 'vendor/**']
    },
    {
        files: ['src/**/*.js'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'module',
            globals: browserGlobals
        },
        rules
    },
    {
        files: ['apps/desktop/**/*.js', 'apps/desktop/**/*.cjs', 'scripts/**/*.js'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'module',
            globals: nodeGlobals
        },
        rules
    },
    {
        files: ['apps/desktop/**/*.cjs'],
        languageOptions: { sourceType: 'commonjs' }
    },
    {
        // AudioWorklets run in their own global scope, not the window's.
        files: ['src/audio/worklets/*.js'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'module',
            globals: {
                AudioWorkletProcessor: 'readonly',
                registerProcessor: 'readonly',
                sampleRate: 'readonly',
                currentTime: 'readonly',
                currentFrame: 'readonly'
            }
        },
        rules
    },
    {
        files: ['tests/**/*.js'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'module',
            globals: { ...nodeGlobals, ...browserGlobals }
        },
        rules
    }
];
