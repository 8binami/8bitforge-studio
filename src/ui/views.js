/**
 * The two views: Sequencer and Arrangement.
 *
 * They are one screen with two jobs. The sequencer is a pattern under the
 * hands: the keyboard and the rhythm presets are what you reach for. The
 * arrangement is the song as a whole, where the mixer, the effects, the
 * automation and the mastering matter and the keyboard is in the way.
 *
 * So the tabs do more than swap a panel: they decide which cards exist at
 * all, and each view remembers its own arrangement of them. Bootstrap swaps
 * the panels; everything else is here.
 *
 * Switching stops the clock. Playback means something different on either
 * side (one pattern against a chain of them) and carrying it across a
 * switch would leave the playhead running over a view that is not the one
 * playing.
 */

export const VIEWS = Object.freeze({
    sequencer: 'sequencer',
    arrangement: 'arrangement'
});

/** The cards each view owns. Anything not listed is shown in both. */
const CARDS = Object.freeze({
    [VIEWS.sequencer]: ['keyboard', 'rhythm'],
    [VIEWS.arrangement]: ['effects', 'mixer', 'fxautomation', 'mixerautomation', 'mastering']
});

export class ViewTabs {
    /**
     * @param {object} options
     * @param {ParentNode} options.root
     * @param {import('../studio.js').Studio} options.studio
     * @param {{ setView: (view: string) => void }} options.cards
     * @param {(view: string) => void} [options.onChange]  panels that need a
     *   refresh once their card is on screen
     */
    constructor({ root, studio, cards, onChange = () => {} }) {
        this.root = root;
        this.studio = studio;
        this.cards = cards;
        this.onChange = onChange;

        this.view = VIEWS.sequencer;
    }

    bind() {
        const tabs = {
            [VIEWS.sequencer]: this.root.querySelector('#tabTracks'),
            [VIEWS.arrangement]: this.root.querySelector('#tabArrangement')
        };

        for (const [view, tab] of Object.entries(tabs)) {
            // Bootstrap announces the switch twice: once as it starts, once
            // when the panel is actually on screen. The clock stops at the
            // first, the layout follows at the second: measuring a card
            // that is still hidden gives a height of nothing.
            tab?.addEventListener('show.bs.tab', () => this.studio.sequencer.stop());
            tab?.addEventListener('shown.bs.tab', () => this._enter(view));
        }

        // The first view is put up, not switched to: there is nothing the
        // user has arranged yet to remember.
        this._enter(this.view, { remember: false });
    }

    _enter(view, { remember = true } = {}) {
        // What the user did to the view being left, while its cards are
        // still the ones on screen.
        if (remember) this.cards.save();

        this.view = view;
        this._showCards(view);
        this._el('arrangementControls')?.classList.toggle('d-none', view !== VIEWS.arrangement);

        this.realign();

        this.cards.setView(view);
        this.onChange(view);
    }

    /**
     * Decide again whether the chain is driving playback.
     *
     * The view says what is being worked on and the chain says whether there
     * is a song to play, so the answer changes on a view switch *and* when a
     * project arrives with a different chain. A project opened while the
     * arrangement was on screen used to keep the previous song's answer: an
     * empty chain left enabled plays silence, and a full one left disabled
     * plays one pattern round and round.
     */
    realign() {
        const { arrangement } = this.studio;

        if (this.view !== VIEWS.arrangement) {
            arrangement.disable();
            return;
        }

        // Both answers below start the chain from its first measure, so
        // there is no `resetPlayback()` here: the original needed one because
        // it also cleared two fields of visual state the sequencer kept, and
        // this one sends the measure along with each scheduled step.
        //
        // A chain that holds nothing would play silence and look broken.
        if (arrangement.getChain().some((pattern) => pattern !== null)) arrangement.enable();
        else arrangement.disable();
    }

    _showCards(view) {
        const container = this.root.querySelector('#sortableCards');
        if (!container) return;

        for (const [owner, ids] of Object.entries(CARDS)) {
            for (const id of ids) {
                container
                    .querySelector(`.sortable-card[data-card-id="${id}"]`)
                    ?.classList.toggle('d-none', owner !== view);
            }
        }
    }

    _el(id) {
        return this.root.querySelector(`#${id}`);
    }
}
