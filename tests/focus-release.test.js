/**
 * Who gets to keep the keyboard.
 *
 * A shortcut stands aside for anything focused, so a control that keeps
 * focus with nothing to do with it takes Space, the piano letters and
 * every shortcut away until the user clicks on nothing in particular.
 * Sliders and drop-downs do exactly that, and there are 108 of them.
 *
 * The rule is only interesting at its edges, which is what is here: a
 * text field must keep focus, a control being driven by the arrow keys
 * must keep it, and a drop-down must not be let go until it has said
 * what it is worth. None of that needs a document, and this has none.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { FocusRelease, holdsFocusIdly } from '../src/ui/focus-release.js';

const slider = { tagName: 'INPUT', type: 'range' };
const dropdown = { tagName: 'SELECT' };
const text = { tagName: 'INPUT', type: 'text' };

describe('which controls hold focus for no reason', () => {
    it('counts sliders and drop-downs', () => {
        expect(holdsFocusIdly(slider)).toBe(true);
        expect(holdsFocusIdly(dropdown)).toBe(true);
    });

    it('leaves anything being written in alone', () => {
        // Focus is the point of a text field, and the studio's shortcuts
        // standing aside for it is correct, not a bug to route around.
        expect(holdsFocusIdly(text)).toBe(false);
        expect(holdsFocusIdly({ tagName: 'INPUT', type: 'number' })).toBe(false);
        expect(holdsFocusIdly({ tagName: 'INPUT', type: 'search' })).toBe(false);
        expect(holdsFocusIdly({ tagName: 'TEXTAREA' })).toBe(false);
    });

    it('says no to nothing at all', () => {
        expect(holdsFocusIdly(null)).toBe(false);
        expect(holdsFocusIdly({})).toBe(false);
    });
});

describe('a slider', () => {
    let release;

    beforeEach(() => {
        release = new FocusRelease();
    });

    it('is let go when the pointer lets go', () => {
        release.pointerDown(slider);

        expect(release.pointerUp()).toBe(slider);
    });

    it('is let go even when the drag ends where it started', () => {
        // A drag that moves nothing fires no change, and the original's
        // version of this rule would have left the keyboard dead.
        release.pointerDown(slider);
        release.pointerUp();

        expect(release.changed(slider)).toBeNull();
    });

    it('keeps focus while the arrow keys are driving it', () => {
        release.pointerDown(slider);
        release.keyDown();

        expect(release.pointerUp()).toBeNull();
        expect(release.changed(slider)).toBeNull();
    });
});

describe('a drop-down', () => {
    let release;

    beforeEach(() => {
        release = new FocusRelease();
    });

    it('keeps focus until it has settled on something', () => {
        release.pointerDown(dropdown);

        // Its list is still open at this point.
        expect(release.pointerUp()).toBeNull();
        expect(release.changed(dropdown)).toBe(dropdown);
    });

    it('is let go once only', () => {
        release.pointerDown(dropdown);
        release.changed(dropdown);

        expect(release.changed(dropdown)).toBeNull();
    });

    it('keeps focus when the keyboard chose the value', () => {
        release.pointerDown(dropdown);
        release.keyDown();

        expect(release.changed(dropdown)).toBeNull();
    });

    it('keeps focus when nothing pointed at it at all', () => {
        // Tabbing to a list and walking it with the arrows.
        expect(release.changed(dropdown)).toBeNull();
    });
});

describe('everything else', () => {
    let release;

    beforeEach(() => {
        release = new FocusRelease();
    });

    it('is never blurred', () => {
        release.pointerDown(text);

        expect(release.pointerUp()).toBeNull();
        expect(release.changed(text)).toBeNull();
    });

    it('takes the pointer away from whatever held it', () => {
        release.pointerDown(slider);
        release.pointerDown(text);

        expect(release.pointerUp()).toBeNull();
    });

    it('survives a pointer that went down on nothing', () => {
        release.pointerDown(null);

        expect(release.pointerUp()).toBeNull();
        expect(release.changed(null)).toBeNull();
    });
});
