/**
 * Automatic saving.
 *
 * Every so often, if the project has changed, it is written back where it
 * came from: over its file when the platform can do that without asking, and
 * into the library otherwise. It never opens a file dialog: a window asking
 * where to put something, appearing on its own while someone is working, is
 * worse than not saving at all.
 *
 * Nothing runs until an interval is set, and setting it to zero stops it. The
 * clock is only restarted when the interval changes, so a project being
 * edited is not endlessly postponed.
 */

import { bus as sharedBus } from '../core/event-bus.js';
import { PREFERENCE_EVENTS } from '../core/preferences.js';
import { saveProjectToLibrary } from './save-to-library.js';

export const AUTOSAVE_EVENTS = Object.freeze({
    saved: 'autosave:saved',
    failed: 'autosave:failed'
});

export class Autosave {
    /**
     * @param {object} options
     * @param {import('./project-session.js').ProjectSession} options.session
     * @param {import('../storage/library.js').Library} options.library
     * @param {import('../studio.js').Studio} options.studio
     * @param {import('../core/preferences.js').Preferences} options.preferences
     * @param {import('../core/event-bus.js').EventBus} [options.bus]
     */
    constructor({ session, library, studio, preferences, bus = sharedBus }) {
        this.session = session;
        this.library = library;
        this.studio = studio;
        this.preferences = preferences;
        this._bus = bus;

        this._timer = null;

        bus.on(PREFERENCE_EVENTS.changed, ({ key }) => {
            if (key === null || key === 'autosaveSeconds') this.restart();
        });
    }

    /** Start, stop or re-time the clock from the current preference. */
    restart() {
        this.stop();

        const seconds = Number(this.preferences.get('autosaveSeconds'));
        if (!seconds) return;

        this._timer = globalThis.setInterval(() => this.saveNow(), seconds * 1000);
    }

    stop() {
        if (this._timer) globalThis.clearInterval(this._timer);
        this._timer = null;
    }

    /** @returns {Promise<boolean>} whether anything was written */
    async saveNow() {
        if (!this.session.isDirty) return false;

        try {
            if (this.session.canSaveInPlace) {
                const { saved } = await this.session.save();
                if (saved) this._bus.emit(AUTOSAVE_EVENTS.saved, { where: 'file' });
                return saved;
            }

            await saveProjectToLibrary({
                library: this.library,
                session: this.session,
                studio: this.studio
            });

            this._bus.emit(AUTOSAVE_EVENTS.saved, { where: 'library' });
            return true;
        } catch (error) {
            // A failed automatic save is worth saying once, not worth
            // interrupting the work for.
            this._bus.emit(AUTOSAVE_EVENTS.failed, { message: error.message });
            return false;
        }
    }
}
