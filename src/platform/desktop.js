/**
 * Desktop platform: Electron.
 *
 * Every call goes through `window.forgeDesktop`, the bridge exposed by the
 * preload script. The renderer has no Node access: the main process owns the
 * file system and only honours paths the user picked in a dialog.
 */

import { PROJECT_EXTENSION } from '../core/config.js';
import { DesktopBackend } from '../storage/desktop-backend.js';

/** @returns {import('./index.js').Platform} */
export function createDesktopPlatform() {
    const bridge = window.forgeDesktop;
    if (!bridge) throw new Error('Desktop bridge is missing: preload did not run');

    return {
        id: 'desktop',

        capabilities: {
            overwriteInPlace: true,
            library: true,
            recentFiles: true
        },

        /** A folder of files under the user's Documents. */
        createLibraryBackend() {
            return new DesktopBackend(bridge.library);
        },

        /**
         * Save one produced file: a render, a MIDI file, an archive.
         * @param {string} name
         * @param {Blob} blob
         */
        async saveFile(name, blob) {
            const result = await bridge.saveFileAs({
                defaultName: name,
                data: await blob.arrayBuffer(),
                filters: [
                    { name: extensionOf(name).toUpperCase(), extensions: [extensionOf(name)] }
                ]
            });
            return result ? { path: result.path, name: result.name } : null;
        },

        /**
         * Save several files at once. On the desktop the user picks one
         * folder, which beats a save dialog per stem.
         * @param {Array<{name: string, blob: Blob}>} files
         */
        async saveFiles(files) {
            const payload = [];
            for (const file of files) {
                payload.push({ name: file.name, data: await file.blob.arrayBuffer() });
            }
            const result = await bridge.saveAllTo(payload);
            return result ? { directory: result.directory, count: result.files.length } : null;
        },

        async openProjectFile() {
            const result = await bridge.openProjectFile();
            if (!result) return null;
            return {
                ref: { id: result.path, name: result.name },
                text: result.text
            };
        },

        async saveProjectFileAs(defaultName, text) {
            const result = await bridge.saveProjectFileAs({
                defaultName: `${defaultName}.${PROJECT_EXTENSION}`,
                text
            });
            if (!result) return null;
            return { id: result.path, name: result.name };
        },

        async writeProjectFile(ref, text) {
            if (!ref?.id) return false;
            return bridge.writeProjectFile(ref.id, text);
        }
    };
}

function extensionOf(name) {
    return name.split('.').pop() || 'bin';
}
