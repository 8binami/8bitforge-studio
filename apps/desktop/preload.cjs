/**
 * Preload bridge.
 *
 * CommonJS on purpose: a sandboxed preload cannot be an ES module.
 *
 * This file is the entire surface the renderer gets. It exposes named
 * operations, never a generic "run this in Node" escape hatch, so the set of
 * things a compromised page could do stays exactly what is listed below.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('forgeDesktop', {
    isDesktop: true,

    /** @returns {Promise<{path: string, name: string, text: string}|null>} */
    openProjectFile: () => ipcRenderer.invoke('project:open'),

    /**
     * @param {{defaultName: string, text: string}} options
     * @returns {Promise<{path: string, name: string}|null>}
     */
    saveProjectFileAs: (options) => ipcRenderer.invoke('project:saveAs', options),

    /**
     * Write back to a file the user already picked in this session.
     * @returns {Promise<boolean>} false when the path was never granted
     */
    writeProjectFile: (filePath, text) => ipcRenderer.invoke('project:write', filePath, text),

    /**
     * Save a file the studio produced, wherever the user chooses.
     * @param {{defaultName: string, data: ArrayBuffer|string, filters?: object[]}} options
     * @returns {Promise<{path: string, name: string}|null>}
     */
    saveFileAs: (options) => ipcRenderer.invoke('file:saveAs', options),

    /**
     * Save several files into one folder, for stems and pattern exports.
     * @param {Array<{name: string, data: ArrayBuffer|string}>} files
     */
    saveAllTo: (files) => ipcRenderer.invoke('file:saveAllTo', files),

    /**
     * The library: a folder of plain files under the user's Documents.
     * `kind` is one of projects, kits, presets, generator-presets.
     */
    library: {
        list: (kind) => ipcRenderer.invoke('library:list', kind),
        read: (kind, id) => ipcRenderer.invoke('library:read', kind, id),
        write: (kind, id, contents) => ipcRenderer.invoke('library:write', kind, id, contents),
        remove: (kind, id) => ipcRenderer.invoke('library:remove', kind, id),
        /** Open the folder in the system file manager. */
        reveal: (kind) => ipcRenderer.invoke('library:reveal', kind)
    },

    /** @returns {Promise<{version: string, platform: string, store: 'snap'|null, userDataPath: string, documentsPath: string, libraryPath: string}>} */
    getAppInfo: () => ipcRenderer.invoke('app:info'),

    /** Open an http(s) URL in the user's default browser. */
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url)
});
