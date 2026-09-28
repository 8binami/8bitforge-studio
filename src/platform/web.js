/**
 * Web platform: browser.
 *
 * Uses the File System Access API when the browser has it (Chrome, Edge,
 * Opera): the user picks a real file and the studio can save back to it.
 * Everywhere else (Firefox, Safari) it falls back to a file input for opening
 * and a download for saving, which cannot overwrite in place.
 */

import { PROJECT_EXTENSION, PROJECT_MIME } from '../core/config.js';
import { IndexedDbBackend } from '../storage/idb-backend.js';
import { MemoryBackend } from '../storage/memory-backend.js';

const hasFileSystemAccess = () =>
    typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function';

/** Handles cannot cross a structured clone, so they are kept here by key. */
const handles = new Map();
let handleSeq = 0;

const PICKER_TYPES = [
    {
        description: '8BitForge project',
        accept: { [PROJECT_MIME]: [`.${PROJECT_EXTENSION}`] }
    }
];

/** @returns {import('./index.js').Platform} */
export function createWebPlatform() {
    const modern = hasFileSystemAccess();

    return {
        id: 'web',

        capabilities: {
            overwriteInPlace: modern,
            library: IndexedDbBackend.isSupported(),
            recentFiles: false
        },

        /**
         * IndexedDB, or memory when site data is blocked: a private window,
         * an embedded preview. The interface reads `isPersistent` and says so
         * rather than letting someone believe their work is being kept.
         */
        createLibraryBackend() {
            return IndexedDbBackend.isSupported() ? new IndexedDbBackend() : new MemoryBackend();
        },

        /**
         * Save one produced file. A browser gives it to the download folder;
         * where that is, is the browser's business, not ours.
         */
        async saveFile(name, blob) {
            download(name, blob);
            return { path: null, name };
        },

        /**
         * Save several files. There is no folder picker to hand them to, so
         * they go one after another: the caller bundles them into an archive
         * when that makes more sense than a row of downloads.
         */
        async saveFiles(files) {
            for (const file of files) download(file.name, file.blob);
            return { directory: null, count: files.length };
        },

        async openProjectFile() {
            return modern ? openWithPicker() : openWithInput();
        },

        async saveProjectFileAs(defaultName, text) {
            const fileName = `${defaultName}.${PROJECT_EXTENSION}`;
            return modern ? saveWithPicker(fileName, text) : saveWithDownload(fileName, text);
        },

        async writeProjectFile(ref, text) {
            const handle = ref?.id ? handles.get(ref.id) : null;
            if (!handle) return false;
            await writeHandle(handle, text);
            return true;
        }
    };
}

// ── File System Access API ────────────────────────────────────────────────

async function openWithPicker() {
    let handle;
    try {
        [handle] = await window.showOpenFilePicker({ types: PICKER_TYPES, multiple: false });
    } catch {
        return null; // the user cancelled
    }
    const file = await handle.getFile();
    return {
        ref: { id: keepHandle(handle), name: file.name },
        text: await file.text()
    };
}

async function saveWithPicker(fileName, text) {
    let handle;
    try {
        handle = await window.showSaveFilePicker({ suggestedName: fileName, types: PICKER_TYPES });
    } catch {
        return null; // the user cancelled
    }
    await writeHandle(handle, text);
    return { id: keepHandle(handle), name: handle.name };
}

async function writeHandle(handle, text) {
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
}

function keepHandle(handle) {
    const key = `fsa:${++handleSeq}`;
    handles.set(key, handle);
    return key;
}

// ── Fallback: file input + download ───────────────────────────────────────

function openWithInput() {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = `.${PROJECT_EXTENSION},application/json`;
        input.style.display = 'none';

        // `cancel` is not universally supported, so a missing file resolves null
        // through the change handler instead of leaving the promise pending.
        input.addEventListener('change', async () => {
            const file = input.files?.[0];
            input.remove();
            if (!file) return resolve(null);
            resolve({
                ref: { id: null, name: file.name },
                text: await file.text()
            });
        });
        input.addEventListener('cancel', () => {
            input.remove();
            resolve(null);
        });

        document.body.append(input);
        input.click();
    });
}

function saveWithDownload(fileName, text) {
    download(fileName, new Blob([text], { type: PROJECT_MIME }));

    // A download gives no handle back: the file cannot be written in place.
    return { id: null, name: fileName };
}

/** Hand a blob to the browser as a download. */
function download(fileName, blob) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}
