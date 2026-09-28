/**
 * The card layout, read back from an older studio.
 *
 * The studio that wrote these layouts had one view and stored a list of
 * `{ id, collapsed }`. This one has two views and stores ids. The migration
 * is the only code that ever sees the old shape, it runs once per browser,
 * and when it is wrong the result is silent: cards in an order nobody chose,
 * or a card that no longer appears at all.
 */

import { describe, it, expect } from 'vitest';
import { migrateList, DEFAULT_LAYOUT } from '../src/ui/cards.js';

const OLD = [
    { id: 'sequencer', collapsed: false },
    { id: 'spectrum', collapsed: true },
    { id: 'transport', collapsed: false }
];

describe('a layout from the studio that had one view', () => {
    it('keeps the order the cards were dragged into', () => {
        const { cardOrder } = migrateList(OLD);

        expect(cardOrder.slice(0, 3)).toEqual(['sequencer', 'spectrum', 'transport']);
    });

    it('reads ids, not the objects holding them', () => {
        // Assigning the list straight across gave an order of objects, which
        // matches no card and quietly leaves every card where it was.
        for (const id of migrateList(OLD).cardOrder) {
            expect(typeof id).toBe('string');
        }
    });

    it('appends the cards that studio did not have', () => {
        const { cardOrder } = migrateList(OLD);

        // Dropped instead of appended, the mixer and the automation lanes
        // would never be placed at all.
        for (const id of DEFAULT_LAYOUT.cardOrder) expect(cardOrder).toContain(id);
        expect(cardOrder).toHaveLength(DEFAULT_LAYOUT.cardOrder.length);
    });

    it('takes what was shut into the sequencer view', () => {
        const { modes } = migrateList(OLD);

        expect(modes.sequencer.spectrum).toBe(true);
        expect(modes.sequencer.sequencer).toBe(false);
    });

    it('leaves the arrangement view at its defaults', () => {
        // That studio had no arrangement view, so it has nothing to say
        // about one.
        expect(migrateList(OLD).modes.arrangement).toEqual(DEFAULT_LAYOUT.modes.arrangement);
    });

    it('ignores entries that name no card', () => {
        const { cardOrder } = migrateList([{ collapsed: true }, 'spectrum', null]);

        expect(cardOrder).toEqual(DEFAULT_LAYOUT.cardOrder);
    });
});
