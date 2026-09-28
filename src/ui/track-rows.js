/**
 * The buttons beside each track of the grid.
 *
 * Solo and mute here belong to the pattern, not to the song: soloing the bass
 * while writing a bassline should not follow that pattern into the
 * arrangement. The mixer's own pair does that, and the two layers are settled
 * together when a row is greyed out: a track silenced either way is shown as
 * silenced, whichever decided it.
 *
 * The dice generates this track alone, using whatever the generator panel is
 * set to. The three remaining buttons point at windows that are not ported
 * yet; they select the track and say so rather than doing nothing at all.
 */

import { SEQUENCER_EVENTS } from '../sequencer/sequencer.js';
import { translateOr } from '../i18n/i18n.js';

const TRACK_COUNT = 8;

const TRACK_NAMES = ['LEAD', 'HARMONY', 'BASS', 'ARP', 'KICK', 'SNARE', 'HI-HAT', 'FX'];

export class TrackRows {
    /**
     * @param {object} options
     * @param {ParentNode} options.root
     * @param {import('../studio.js').Studio} options.studio
     * @param {() => void} [options.onGenerated]  redraw the grid
     * @param {(text: string) => void} [options.onStatus]  the transport's line
     */
    constructor({
        root,
        studio,
        preferences = null,
        onGenerated = () => {},
        onStatus = () => {},
        studioModal = null
    }) {
        this.root = root;
        this.studio = studio;
        this.preferences = preferences;
        this.onGenerated = onGenerated;
        this.onStatus = onStatus;
        this.studioModal = studioModal;
    }

    bind() {
        for (let track = 0; track < TRACK_COUNT; track++) {
            const row = this.root.querySelector(`.track[data-track="${track}"]`);
            if (row) this._bindRow(row, track);
        }

        this._bindHighlightStyles();

        // A pattern has its own solo and mute, so switching pattern changes
        // what these buttons say.
        this.studio.bus.on(SEQUENCER_EVENTS.patternChanged, () => this.sync());
        this.sync();
    }

    /**
     * How the selected track is marked: a glow on its label, a bar down
     * its side, or an outline round the whole row.
     *
     * Three buttons over a `data-highlight-style` attribute, and the CSS
     * for all three shipped with the rest of it - `studio.css:626-680`
     * has been carrying the two nobody could choose. It is a matter of
     * eyes rather than of taste, so the choice is remembered.
     */
    _bindHighlightStyles() {
        const group = this.root.querySelector('#trackHighlightModes');
        const container = this.root.querySelector('.tracks-container');
        if (!group || !container) return;

        const buttons = [...group.querySelectorAll('[data-highlight-style]')];

        const show = (style) => {
            container.dataset.highlightStyle = style;
            for (const button of buttons) {
                button.classList.toggle('active', button.dataset.highlightStyle === style);
            }
        };

        for (const button of buttons) {
            button.addEventListener('click', () => {
                show(button.dataset.highlightStyle);
                this.preferences?.set('highlightStyle', button.dataset.highlightStyle);
            });
        }

        const saved = this.preferences?.get('highlightStyle');
        // An unknown style would leave the row marked in no way at all.
        if (buttons.some((button) => button.dataset.highlightStyle === saved)) show(saved);
    }

    _bindRow(row, track) {
        row.querySelector('.track-label')?.addEventListener('click', () => this.selectTrack(track));

        row.querySelector('.solo')?.addEventListener('click', () => {
            this.studio.sequencer.toggleSolo(track);
            this.studio.history.saveState('Solo');
            this.sync();
        });

        row.querySelector('.mute')?.addEventListener('click', () => {
            this.studio.sequencer.toggleMute(track);
            this.studio.history.saveState('Mute');
            this.sync();
        });

        row.querySelector('.randomize')?.addEventListener('click', async () => {
            await this.studio.start();
            this.studio.history.saveState(`Randomize ${TRACK_NAMES[track]}`);

            this.studio.generator.generateForTrack(track);
            this.onGenerated();
            this.onStatus(`${translateOr('status.generating', 'GEN')}: ${TRACK_NAMES[track]}`);
        });

        // Each of the three opens the studio window on its own tab. They
        // select the track first, so the window shows the row it was opened
        // from rather than whichever was last selected.
        const tabs = { '.track-synth': 'synth', '.track-pr': 'pianoroll', '.track-lib': 'library' };

        for (const [selector, tab] of Object.entries(tabs)) {
            const button = row.querySelector(selector);
            if (!button) continue;

            const ready = Boolean(this.studioModal?.canOpen(tab));
            button.classList.toggle('disabled', !ready);

            button.addEventListener('click', () => {
                this.selectTrack(track);
                if (ready) this.studioModal.open(tab);
            });
        }
    }

    /** Point the studio at a track: what the keyboard plays, what a window edits. */
    selectTrack(track) {
        this.studio.synthesizer.setCurrentTrack(track);

        for (const row of this.root.querySelectorAll('.track')) {
            row.classList.toggle('track-selected', Number(row.dataset.track) === track);
        }
    }

    /** Read the two layers of solo and mute back onto the rows. */
    sync() {
        const states = this.studio.sequencer.getTrackStates();
        const mixer = this.studio.audioEngine.mixerSettings;

        const soloedInPattern = states.some((state) => state.solo);
        const soloedInMixer = mixer.some((settings) => settings.solo);

        for (let track = 0; track < TRACK_COUNT; track++) {
            const row = this.root.querySelector(`.track[data-track="${track}"]`);
            if (!row) continue;

            row.querySelector('.solo')?.classList.toggle('active', states[track].solo);
            row.querySelector('.mute')?.classList.toggle('active', states[track].mute);

            // A solo anywhere in the mixer decides the whole song, so the
            // pattern's own solo only speaks when the mixer is not soloing.
            const silencedByMixer = mixer[track].mute || (soloedInMixer && !mixer[track].solo);
            const silencedByPattern =
                !soloedInMixer && (states[track].mute || (soloedInPattern && !states[track].solo));

            row.classList.toggle('track-muted', silencedByMixer || silencedByPattern);
        }
    }
}
