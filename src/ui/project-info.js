/**
 * What the topbar says about the project.
 *
 * The cover, the name, its category, a line of the things that identify a
 * track at a glance (tempo and key) and when it was last written down. It
 * reads; it never changes anything, except that clicking it opens the window
 * that does.
 *
 * Everything here follows events rather than being pushed: whichever window
 * renamed the project or wrote it to disk, the topbar hears about it.
 */

import { PROJECT_EVENTS } from '../project/project-session.js';
import { AUTOSAVE_EVENTS } from '../project/autosave.js';
import { SEQUENCER_EVENTS } from '../sequencer/sequencer.js';
import { GENERATOR_EVENTS } from '../compose/generator.js';
import { I18N_EVENTS } from '../i18n/i18n.js';
import { categoryLabel } from './project-categories.js';
import { DEFAULT_COVER } from './cover-image.js';
import { translateOr } from '../i18n/i18n.js';

export class ProjectInfo {
    /**
     * @param {object} options
     * @param {ParentNode} options.root
     * @param {import('../studio.js').Studio} options.studio
     * @param {import('../project/project-session.js').ProjectSession} options.session
     * @param {() => void} [options.onEdit]  clicking the area
     */
    constructor({ root, studio, session, onEdit = () => {} }) {
        this.root = root;
        this.studio = studio;
        this.session = session;
        this.onEdit = onEdit;

        /** When the project was last written, as this session saw it. */
        this._savedAt = null;
    }

    bind() {
        this._fields = {
            area: this.root.querySelector('#projectInfoArea'),
            cover: this.root.querySelector('#projectInfoCover'),
            name: this.root.querySelector('#projectInfoName'),
            badge: this.root.querySelector('#projectInfoBadge'),
            details: this.root.querySelector('#projectInfoDetails'),
            saved: this.root.querySelector('#projectInfoSaved'),
            unsaved: this.root.querySelector('#unsavedIndicator')
        };

        this._fields.area?.addEventListener('click', () => this.onEdit());

        const { bus } = this.studio;
        for (const event of [
            PROJECT_EVENTS.opened,
            PROJECT_EVENTS.created,
            PROJECT_EVENTS.described,
            SEQUENCER_EVENTS.tempoChanged,
            GENERATOR_EVENTS.changed,
            I18N_EVENTS.changed
        ]) {
            bus.on(event, () => this.sync());
        }

        bus.on(PROJECT_EVENTS.dirty, () => this._showDirty());
        bus.on(PROJECT_EVENTS.saved, () => this._markSaved());
        bus.on(AUTOSAVE_EVENTS.saved, () => this._markSaved());

        this.sync();
    }

    sync() {
        const { name, cover, category } = this.session;

        if (this._fields.cover) this._fields.cover.src = cover || DEFAULT_COVER;

        if (this._fields.name) {
            const shown = name || translateOr('proj.untitled', 'Untitled');
            this._fields.name.textContent = shown;
            // The name is clipped when the window is narrow, so the whole of
            // it lives in the tooltip.
            this._fields.name.title = shown;
        }

        if (this._fields.badge) {
            this._fields.badge.className = `badge badge-${category} app-project-badge`;
            this._fields.badge.textContent = categoryLabel(category);
        }

        if (this._fields.details) this._fields.details.textContent = this._details();
        this._showSaved();
        this._showDirty();
    }

    /** Tempo and key: what tells two versions of a track apart. */
    _details() {
        const { bpm } = this.studio.sequencer;
        const { rootKey, scaleType } = this.studio.generator;

        return [`${Math.round(bpm)} BPM`, `${rootKey} ${this._scaleName(scaleType)}`].join(' · ');
    }

    /**
     * The scale's name, taken from the generator's own picker rather than
     * from a second list here, which would drift from it.
     *
     * The option is read through its translation key rather than its text,
     * because the topbar is built before the page is translated and would
     * otherwise be left showing the markup's English until the language was
     * changed.
     */
    _scaleName(scaleType) {
        const option = this.root.querySelector(`#genScaleType option[value="${scaleType}"]`);
        if (!option) return scaleType;

        const english = option.textContent.trim() || scaleType;
        return option.dataset.i18n ? translateOr(option.dataset.i18n, english) : english;
    }

    _markSaved() {
        this._savedAt = new Date();
        this._showSaved();
        this._showDirty();
    }

    _showSaved() {
        if (!this._fields.saved) return;

        this._fields.saved.textContent = this._savedAt
            ? `${translateOr('proj.infoSaved', 'Saved')} : ${formatDateTime(this._savedAt)}`
            : translateOr('proj.infoNew', 'New project');
    }

    _showDirty() {
        this._fields.unsaved?.classList.toggle('d-none', !this.session.isDirty);
    }
}

function formatDateTime(date) {
    const pad = (value) => String(value).padStart(2, '0');
    return (
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
        `${pad(date.getHours())}:${pad(date.getMinutes())}`
    );
}
