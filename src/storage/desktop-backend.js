/**
 * A library backend on real files, for the desktop.
 *
 * Everything goes through the preload bridge: the renderer never touches the
 * file system itself. The main process keeps the library under the user's
 * Documents folder, one directory per kind, one file per item: so the
 * library is also just a folder, to copy, back up or edit by hand.
 */

export class DesktopBackend {
    /** @param {object} bridge  window.forgeDesktop.library */
    constructor(bridge) {
        if (!bridge) throw new TypeError('The desktop library bridge is missing');
        this._bridge = bridge;
    }

    /** True: these are files on disk. */
    get isPersistent() {
        return true;
    }

    list(kind) {
        return this._bridge.list(kind);
    }

    read(kind, id) {
        return this._bridge.read(kind, id);
    }

    write(kind, id, contents) {
        return this._bridge.write(kind, id, contents);
    }

    remove(kind, id) {
        return this._bridge.remove(kind, id);
    }

    /** Open the folder in the system file manager. */
    reveal(kind) {
        return this._bridge.reveal?.(kind) ?? null;
    }
}
