/**
 * Which view is on screen, and whether the chain is driving playback.
 *
 * The answer depends on two things that change independently: the view the
 * user is looking at, and the chain the project brought with it. Getting it
 * wrong is silent and sounds like a bug in the sequencer: an empty chain
 * left enabled plays nothing, a full one left disabled plays one pattern
 * round and round.
 *
 * The tabs themselves need a browser. What is here is the decision.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus } from '../src/core/event-bus.js';
import { Sequencer } from '../src/sequencer/sequencer.js';
import { Arrangement } from '../src/sequencer/arrangement.js';
import { ViewTabs, VIEWS } from '../src/ui/views.js';

function makeTabs(chain = []) {
    const bus = new EventBus();
    const sequencer = new Sequencer({ audioContext: null }, { bus });
    const arrangement = new Arrangement(sequencer, { bus });
    arrangement.setChain(chain);

    const tabs = new ViewTabs({
        // `realign` touches neither, so a window is not needed to ask it.
        root: { querySelector: () => null },
        studio: { sequencer, arrangement },
        cards: { save() {}, setView() {} }
    });

    return { tabs, arrangement };
}

describe('realigning the arrangement with the view', () => {
    let tabs;
    let arrangement;

    beforeEach(() => {
        ({ tabs, arrangement } = makeTabs([0, 1, 0]));
    });

    it('switches the chain off in the sequencer view', () => {
        arrangement.enable();
        tabs.view = VIEWS.sequencer;

        tabs.realign();

        expect(arrangement.enabled).toBe(false);
    });

    it('switches it on in the arrangement view when there is a song', () => {
        tabs.view = VIEWS.arrangement;

        tabs.realign();

        expect(arrangement.enabled).toBe(true);
    });

    it('leaves it off for a chain of nothing but silence', () => {
        arrangement.setChain([null, null]);
        tabs.view = VIEWS.arrangement;

        tabs.realign();

        // Enabled, this would play silence and read as a broken transport.
        expect(arrangement.enabled).toBe(false);
    });

    it('turns it off when a project arrives with an empty chain', () => {
        tabs.view = VIEWS.arrangement;
        tabs.realign();
        expect(arrangement.enabled).toBe(true);

        // What opening a project does: the chain is replaced under the view.
        arrangement.setChain([]);
        tabs.realign();

        expect(arrangement.enabled).toBe(false);
    });

    it('starts the chain from its first measure', () => {
        tabs.view = VIEWS.arrangement;
        arrangement.enable();
        arrangement.seekTo(2);

        tabs.realign();

        // Both answers reset the position on their way through, which is why
        // realigning does not ask for it a third time.
        expect(arrangement.currentChainIndex).toBe(0);
        expect(arrangement.hasPlayedFirstStep).toBe(false);
    });
});
