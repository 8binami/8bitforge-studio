import { defineConfig } from 'vite';

/**
 * The renderer is built once and reused by both targets:
 *   - web:     served as static files
 *   - desktop: served by the Electron main process through the app:// protocol
 *
 * Relative asset URLs keep the same bundle valid under both origins.
 *
 * COOP/COEP are required for SharedArrayBuffer, which the audio export
 * pipeline needs. The desktop shell sets the same headers on app://.
 */
export default defineConfig({
    base: './',
    build: {
        outDir: 'dist/web',
        emptyOutDir: true,
        target: 'es2022',
        sourcemap: true
    },
    server: {
        port: 5173,
        headers: {
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'credentialless'
        }
    },
    test: {
        environment: 'node',
        include: ['tests/**/*.test.js']
    }
});
