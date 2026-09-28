/**
 * Undo / redo over whole-project snapshots.
 *
 * Every action stores a complete copy of the project state, so anything that
 * ends up in a project file is undoable without each feature having to
 * describe its own inverse operation. Fifty entries of a chiptune project are
 * cheap; the certainty that undo restores exactly what you had is not.
 *
 * It knows nothing about the studio: it is given a way to read the state and
 * a way to put it back.
 *
 *   const history = new UndoRedo({
 *       capture: () => studio.getProjectState(),
 *       restore: (state) => studio.applyProjectState(state)
 *   });
 */

import { bus as sharedBus } from '../core/event-bus.js';

export const UNDO_EVENTS = Object.freeze({
    changed: 'undo:changed'
});

const DEFAULT_MAX_HISTORY = 50;

export class UndoRedo {
    /**
     * @param {object} options
     * @param {() => object} options.capture   read the current state
     * @param {(state: object) => void} options.restore  put a state back
     * @param {number} [options.maxHistory]
     * @param {import('../core/event-bus.js').EventBus} [options.bus]
     */
    constructor({ capture, restore, maxHistory = DEFAULT_MAX_HISTORY, bus = sharedBus }) {
        if (typeof capture !== 'function' || typeof restore !== 'function') {
            throw new TypeError('UndoRedo needs capture and restore functions');
        }
        this._capture = capture;
        this._restore = restore;
        this._bus = bus;

        this.maxHistory = maxHistory;
        /** @type {Array<{action: string, timestamp: number, state: object}>} */
        this.history = [];
        this.currentIndex = -1;

        /** True while restoring, so a restore cannot record itself. */
        this.isRestoring = false;
        /** @type {Map<string, ReturnType<typeof setTimeout>>} */
        this._debounceTimers = new Map();
    }

    /**
     * Record a snapshot.
     * @param {string} [actionName] shown in the interface, e.g. "Cell Edit"
     */
    saveState(actionName = 'Edit') {
        if (this.isRestoring) return false;

        let state;
        try {
            // A deep copy: the captured state holds references to live objects,
            // so without it every entry would point at the same mutable data
            // and undo would restore whatever is current.
            state = structuredClone(this._capture());
        } catch (err) {
            console.warn('[UndoRedo] could not capture the state:', err);
            return false;
        }

        // A new action after an undo drops whatever was ahead.
        if (this.currentIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.currentIndex + 1);
        }

        this.history.push({ action: actionName, timestamp: Date.now(), state });
        while (this.history.length > this.maxHistory) this.history.shift();
        this.currentIndex = this.history.length - 1;

        this._announce();
        return true;
    }

    /**
     * Record a snapshot once the changes settle. Rapid moves of the same
     * control collapse into a single entry.
     * @param {string} [actionName] calls sharing a name collapse together
     * @param {number} [delay] milliseconds of quiet before recording
     */
    saveStateDebounced(actionName = 'Edit', delay = 600) {
        if (this.isRestoring) return;

        clearTimeout(this._debounceTimers.get(actionName));
        this._debounceTimers.set(
            actionName,
            setTimeout(() => {
                this._debounceTimers.delete(actionName);
                this.saveState(actionName);
            }, delay)
        );
    }

    undo() {
        if (!this.canUndo()) return false;
        this.currentIndex--;
        this._applyCurrent();
        return true;
    }

    redo() {
        if (!this.canRedo()) return false;
        this.currentIndex++;
        this._applyCurrent();
        return true;
    }

    canUndo() {
        return this.currentIndex > 0;
    }

    canRedo() {
        return this.currentIndex < this.history.length - 1;
    }

    /** Name of the action undo would take you back through. */
    getUndoAction() {
        return this.canUndo() ? this.history[this.currentIndex].action : null;
    }

    /** Name of the action redo would bring back. */
    getRedoAction() {
        return this.canRedo() ? this.history[this.currentIndex + 1].action : null;
    }

    /** Forget everything, for instance when a project is loaded. */
    clear() {
        this._cancelPending();
        this.history = [];
        this.currentIndex = -1;
        this._announce();
    }

    getStats() {
        return {
            total: this.history.length,
            currentIndex: this.currentIndex,
            canUndo: this.canUndo(),
            canRedo: this.canRedo(),
            undoAction: this.getUndoAction(),
            redoAction: this.getRedoAction()
        };
    }

    // ── Internals ────────────────────────────────────────────────────────

    _applyCurrent() {
        // A pending debounced save would fire after the restore and wipe the
        // forward history, making redo impossible.
        this._cancelPending();

        this.isRestoring = true;
        try {
            this._restore(structuredClone(this.history[this.currentIndex].state));
        } finally {
            this.isRestoring = false;
        }
        this._announce();
    }

    _cancelPending() {
        for (const timer of this._debounceTimers.values()) clearTimeout(timer);
        this._debounceTimers.clear();
    }

    _announce() {
        this._bus.emit(UNDO_EVENTS.changed, this.getStats());
    }
}
