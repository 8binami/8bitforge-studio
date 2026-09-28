import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { UndoRedo, UNDO_EVENTS } from '../src/core/undo-redo.js';
import { EventBus } from '../src/core/event-bus.js';

/** A tiny document standing in for the studio state. */
function makeHistory({ maxHistory } = {}) {
    const doc = { bpm: 120, notes: [] };
    const bus = new EventBus();
    const stats = [];
    bus.on(UNDO_EVENTS.changed, (event) => stats.push(event));

    const history = new UndoRedo({
        capture: () => doc,
        restore: (state) => Object.assign(doc, state),
        maxHistory,
        bus
    });

    return { doc, history, stats };
}

describe('UndoRedo', () => {
    let doc;
    let history;

    beforeEach(() => {
        ({ doc, history } = makeHistory());
    });

    it('needs a capture and a restore function', () => {
        expect(() => new UndoRedo({})).toThrow(TypeError);
    });

    it('cannot undo the first snapshot', () => {
        history.saveState('Start');
        expect(history.canUndo()).toBe(false);
        expect(history.undo()).toBe(false);
    });

    it('steps back and forward through the history', () => {
        history.saveState('Start');
        doc.bpm = 140;
        history.saveState('Tempo');

        expect(history.undo()).toBe(true);
        expect(doc.bpm).toBe(120);

        expect(history.redo()).toBe(true);
        expect(doc.bpm).toBe(140);

        expect(history.redo()).toBe(false);
    });

    it('snapshots by value, not by reference', () => {
        doc.notes.push('C4');
        history.saveState('First note');
        doc.notes.push('E4');
        history.saveState('Second note');

        history.undo();

        expect(doc.notes).toEqual(['C4']);
    });

    it('does not hand the stored snapshot to the caller', () => {
        history.saveState('Start');
        doc.bpm = 200;
        history.saveState('Tempo');

        history.undo();
        doc.bpm = 999; // mutating the restored document

        history.redo();
        history.undo();
        expect(doc.bpm).toBe(120); // the entry survived the mutation
    });

    it('drops the forward history when a new action follows an undo', () => {
        history.saveState('A');
        doc.bpm = 130;
        history.saveState('B');
        doc.bpm = 140;
        history.saveState('C');

        history.undo(); // back at B
        doc.bpm = 999;
        history.saveState('D');

        expect(history.canRedo()).toBe(false);
        expect(history.getUndoAction()).toBe('D');
    });

    it('never records while restoring', () => {
        const doc2 = { value: 0 };
        const nested = new UndoRedo({
            capture: () => doc2,
            restore: (state) => {
                Object.assign(doc2, state);
                nested.saveState('Reentrant'); // a listener reacting to the change
            }
        });

        nested.saveState('A');
        doc2.value = 1;
        nested.saveState('B');
        nested.undo();

        expect(nested.history.map((entry) => entry.action)).toEqual(['A', 'B']);
    });

    it('forgets the oldest entries past the limit', () => {
        ({ doc, history } = makeHistory({ maxHistory: 3 }));

        for (let i = 0; i < 5; i++) {
            doc.bpm = 100 + i;
            history.saveState(`Edit ${i}`);
        }

        expect(history.history).toHaveLength(3);
        expect(history.currentIndex).toBe(2);
        expect(history.history[0].action).toBe('Edit 2');
    });

    it('names the actions undo and redo would move through', () => {
        history.saveState('A');
        doc.bpm = 130;
        history.saveState('B');

        expect(history.getUndoAction()).toBe('B');
        expect(history.getRedoAction()).toBeNull();

        history.undo();
        expect(history.getRedoAction()).toBe('B');
    });

    it('clears its history', () => {
        history.saveState('A');
        history.saveState('B');

        history.clear();

        expect(history.history).toEqual([]);
        expect(history.canUndo()).toBe(false);
    });

    it('survives a capture that throws', () => {
        const broken = new UndoRedo({
            capture: () => {
                throw new Error('nope');
            },
            restore: () => {}
        });

        expect(broken.saveState('A')).toBe(false);
        expect(broken.history).toEqual([]);
    });

    it('announces its state so the toolbar can follow', () => {
        const { doc: d, history: h, stats } = makeHistory();
        h.saveState('A');
        d.bpm = 130;
        h.saveState('B');
        h.undo();

        expect(stats.at(-1)).toMatchObject({ canUndo: false, canRedo: true, total: 2 });
    });
});

describe('UndoRedo debounced saves', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('collapses a burst of changes into one entry', () => {
        const { doc, history } = makeHistory();

        for (let bpm = 120; bpm <= 130; bpm++) {
            doc.bpm = bpm;
            history.saveStateDebounced('Tempo', 600);
        }
        expect(history.history).toHaveLength(0);

        vi.advanceTimersByTime(600);

        expect(history.history).toHaveLength(1);
        expect(history.history[0].state.bpm).toBe(130);
    });

    it('keeps different actions apart', () => {
        const { history } = makeHistory();

        history.saveStateDebounced('Tempo', 600);
        history.saveStateDebounced('Volume', 600);
        vi.advanceTimersByTime(600);

        expect(history.history.map((entry) => entry.action)).toEqual(['Tempo', 'Volume']);
    });

    it('cancels a pending save when undoing, so redo stays possible', () => {
        const { doc, history } = makeHistory();

        history.saveState('A');
        doc.bpm = 130;
        history.saveState('B');

        doc.bpm = 131;
        history.saveStateDebounced('Tempo', 600); // still pending
        history.undo();
        vi.advanceTimersByTime(600); // would have truncated the forward history

        expect(history.canRedo()).toBe(true);
        expect(history.redo()).toBe(true);
        expect(doc.bpm).toBe(130);
    });
});

describe('when to take a snapshot', () => {
    /**
     * The one thing every caller has to get right, and the one thing
     * nothing tells them about.
     *
     * `saveState` copies the state as it is *now*, and `undo` steps back
     * one entry and restores it. So an entry has to be the state *after*
     * the change it is named for: `history[currentIndex]` is what is on
     * screen. Snapshot before the change instead and the entries are all
     * shifted by one: each undo goes back two changes, and the newest one
     * is in no entry at all, so redo cannot return to it.
     *
     * It reads plausibly either way, which is why nine call sites in the
     * ported interface had it the wrong way round.
     */
    it('takes one undo to reverse one change, when the snapshot follows it', () => {
        let value = 0;
        const history = new UndoRedo({
            capture: () => ({ value }),
            restore: (state) => {
                value = state.value;
            },
            bus: new EventBus()
        });

        history.saveState('start');
        value = 1;
        history.saveState('first');
        value = 2;
        history.saveState('second');

        history.undo();
        expect(value).toBe(1);
        history.undo();
        expect(value).toBe(0);

        history.redo();
        expect(value).toBe(1);
    });

    it('skips a change when the snapshot comes first', () => {
        let value = 0;
        const history = new UndoRedo({
            capture: () => ({ value }),
            restore: (state) => {
                value = state.value;
            },
            bus: new EventBus()
        });

        history.saveState('start');
        history.saveState('first');
        value = 1;
        history.saveState('second');
        value = 2;

        // Not a feature being described: a mistake being pinned, so that
        // the shape of it is on record next to the shape that works.
        history.undo();
        expect(value).toBe(0);
    });
});
