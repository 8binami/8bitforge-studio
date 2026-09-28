/**
 * Platform abstraction.
 *
 * The studio never talks to the file system directly. It asks the platform,
 * and the platform is either the desktop shell (Electron, real files through
 * IPC) or the browser (File System Access API, with a download fallback).
 *
 * Adding a target means adding one file here, not touching the studio.
 *
 * @typedef {Object} FileRef
 * @property {string|null} id    stable handle: absolute path on desktop,
 *                               opaque key in the browser, null when the file
 *                               cannot be written back in place
 * @property {string} name       file name, extension included
 *
 * @typedef {Object} Capabilities
 * @property {boolean} overwriteInPlace  can save back to the opened file
 * @property {boolean} library           has a managed local library folder
 * @property {boolean} recentFiles       the shell tracks recent documents
 *
 * @typedef {Object} Platform
 * @property {'desktop'|'web'} id
 * @property {Capabilities} capabilities
 * @property {() => Promise<{ref: FileRef, text: string}|null>} openProjectFile
 * @property {(defaultName: string, text: string) => Promise<FileRef|null>} saveProjectFileAs
 * @property {(ref: FileRef, text: string) => Promise<boolean>} writeProjectFile
 * @property {() => import('../storage/library.js').LibraryBackend} createLibraryBackend
 */

import { createDesktopPlatform } from './desktop.js';
import { createWebPlatform } from './web.js';

/** @type {Platform|null} */
let current = null;

/** True when running inside the Electron shell. */
export function isDesktop() {
    return typeof window !== 'undefined' && window.forgeDesktop?.isDesktop === true;
}

/**
 * Resolve the platform for this runtime. Cached after the first call.
 * @returns {Platform}
 */
export function getPlatform() {
    if (!current) current = isDesktop() ? createDesktopPlatform() : createWebPlatform();
    return current;
}

/**
 * Override the platform. Tests only.
 * @param {Platform|null} platform
 */
export function setPlatform(platform) {
    current = platform;
}
