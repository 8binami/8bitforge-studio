/**
 * The two panels of the right sidebar that show the website: the
 * documentation and the news (the blog). Both are pages of 8bitforge.com in
 * embed mode, content only, loaded the first time their panel opens, in the
 * language of the studio. Offline, a panel says so instead of staying black,
 * and loads as soon as the connection is back.
 */
import { i18n, I18N_EVENTS, translateOr } from '../i18n/i18n.js';

export const SITE_URL = 'https://8bitforge.com';

/** @param {string} path  e.g. 'docs' @param {string} [language] */
export function siteUrl(path, language = i18n.language, { embed = false } = {}) {
    return `${SITE_URL}/${language}/${path}${embed ? '?embed=1' : ''}`;
}

const PANELS = [
    { section: 'helpSection', frame: 'docsIframe', path: 'docs' },
    { section: 'newsSection', frame: 'newsIframe', path: 'blog' }
];

export class OnlinePanels {
    /**
     * @param {object} options
     * @param {ParentNode} options.root
     * @param {import('../core/event-bus.js').EventBus} options.bus
     * @param {(url: string) => void} [options.openUrl] opens a page in the browser
     */
    constructor({ root, bus, openUrl = (url) => window.open(url, '_blank', 'noopener') }) {
        this.root = root;
        this.bus = bus;
        this.openUrl = openUrl;
    }

    bind() {
        for (const panel of PANELS) {
            const section = this.root.querySelector('#' + panel.section);
            const frame = this.root.querySelector('#' + panel.frame);
            if (!section || !frame) continue;
            section.addEventListener('shown.bs.collapse', () => this._load(panel, frame));
            // The news panel is open from the start: no event will come for it.
            if (section.classList.contains('show')) this._load(panel, frame);
        }

        this.root.querySelector('#helpDocsOnlineBtn')?.addEventListener('click', () => this.openUrl(siteUrl('docs')));
        this.root.querySelector('#helpDocsBtn')?.addEventListener('click', (event) => {
            event.preventDefault();
            this.openUrl(siteUrl('docs'));
        });

        // A panel already loaded follows a change of language; the others
        // will pick the new one when they open.
        this.bus.on(I18N_EVENTS.changed, () => {
            for (const panel of PANELS) {
                const frame = this.root.querySelector('#' + panel.frame);
                if (frame?.dataset.loaded) frame.src = siteUrl(panel.path, i18n.language, { embed: true });
            }
        });

        window.addEventListener('online', () => {
            for (const panel of PANELS) {
                const section = this.root.querySelector('#' + panel.section);
                const frame = this.root.querySelector('#' + panel.frame);
                if (section?.classList.contains('show') && frame) this._load(panel, frame);
            }
        });
    }

    _load(panel, frame) {
        const offline = navigator.onLine === false;
        this._placeholder(frame, offline);
        if (offline || frame.dataset.loaded) return;
        frame.dataset.loaded = 'true';
        frame.src = siteUrl(panel.path, i18n.language, { embed: true });
    }

    _placeholder(frame, show) {
        let note = frame.previousElementSibling?.classList.contains('online-panel-offline') ? frame.previousElementSibling : null;
        if (show && !note) {
            note = document.createElement('div');
            note.className = 'online-panel-offline text-center text-muted py-5';
            note.innerHTML = '<i class="ti ti-wifi-off fs-1 d-block mb-3"></i><p class="small mb-0"></p>';
            note.querySelector('p').textContent = translateOr('sidebar.offline', 'Available when you are online.');
            frame.before(note);
        }
        note?.classList.toggle('d-none', !show);
        frame.classList.toggle('d-none', show);
    }
}
