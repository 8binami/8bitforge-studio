/**
 * Minimal synchronous event bus.
 *
 * Modules communicate through events instead of holding references to each
 * other: the sequencer does not know the UI exists, and the UI does not reach
 * into the audio engine. Keeps the dependency graph one-way.
 */
export class EventBus {
    constructor() {
        /** @type {Map<string, Set<Function>>} */
        this._listeners = new Map();
    }

    /**
     * Subscribe to an event.
     * @param {string} event
     * @param {Function} handler
     * @returns {() => void} unsubscribe function
     */
    on(event, handler) {
        if (typeof handler !== 'function') throw new TypeError('handler must be a function');
        let set = this._listeners.get(event);
        if (!set) {
            set = new Set();
            this._listeners.set(event, set);
        }
        set.add(handler);
        return () => this.off(event, handler);
    }

    /**
     * Subscribe to the next occurrence only.
     * @param {string} event
     * @param {Function} handler
     * @returns {() => void} unsubscribe function
     */
    once(event, handler) {
        const off = this.on(event, (...args) => {
            off();
            handler(...args);
        });
        return off;
    }

    /**
     * @param {string} event
     * @param {Function} handler
     */
    off(event, handler) {
        const set = this._listeners.get(event);
        if (!set) return;
        set.delete(handler);
        if (set.size === 0) this._listeners.delete(event);
    }

    /**
     * Emit an event. A throwing listener is reported but never stops the others.
     * @param {string} event
     * @param {...any} args
     */
    emit(event, ...args) {
        const set = this._listeners.get(event);
        if (!set) return;
        for (const handler of [...set]) {
            try {
                handler(...args);
            } catch (err) {
                console.error(`[EventBus] listener for "${event}" failed:`, err);
            }
        }
    }

    /** Remove every listener, or every listener of one event. */
    clear(event) {
        if (event) this._listeners.delete(event);
        else this._listeners.clear();
    }
}

/** Shared application bus. */
export const bus = new EventBus();
