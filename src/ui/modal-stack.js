/**
 * Windows on top of windows.
 *
 * Bootstrap opens one modal at a time. The studio window is a modal, and
 * the windows reached from inside it: the four that name and rename kits
 * and instrument presets, the confirmation before a delete, and Share,
 * whose button is in every library window: are opened over it. Two modals on screen at once is a case Bootstrap does
 * not handle, and it goes wrong in three ways.
 *
 * The backdrop is the mildest: every modal gets one and they are all at
 * the same depth, so the second backdrop lands *underneath* the first
 * window and the studio behind stays undimmed. `assets/css/studio.css`
 * lifts these windows above it; this lifts the new backdrop into the gap
 * it leaves.
 *
 * The focus trap is the one that makes a window unusable rather than
 * merely plain. Each open modal runs a trap that pulls focus back inside
 * itself, so the window underneath drags the caret straight out of every
 * field of the window above. The traps below are switched off while
 * something is over them and the topmost is switched back on as it is
 * uncovered.
 *
 * The scroll lock is the quiet one: closing the upper window unlocks the
 * page although the lower one is still open, and the studio behind starts
 * scrolling under the mouse.
 *
 * Which window is on top is the question all three turn on, and the
 * document cannot answer it. `editKitModal` is written above `studioModal`
 * in the markup and opens above it on screen; taking the last open modal
 * in document order would have reached past the window the user is typing
 * in and handed focus back to the one underneath. So the order windows
 * were opened in is kept here, which is the order they are stacked in.
 */

/**
 * Where a backdrop sits so that it dims the window below without covering
 * the window it belongs to. Bootstrap puts a modal at 1055 and a backdrop
 * at 1050; the stylesheet lifts the kit and preset windows to 1070 and the
 * confirmation to 1090, and these are the two gaps that leaves.
 */
export const STACKED_BACKDROP = 1065;
export const CONFIRM_BACKDROP = 1085;

/** The modals on screen, oldest first. The last one is the top. */
const stack = [];

/** Element → the depth its backdrop should sit at. */
const depths = new WeakMap();

let watching = false;

/**
 * Make a modal usable on top of another one.
 *
 * @param {HTMLElement|null} element
 * @param {number} [backdrop]  what depth its backdrop sits at
 */
export function stackModal(element, backdrop = STACKED_BACKDROP) {
    if (!element) return;

    depths.set(element, backdrop);
    watch();
}

/**
 * Follow every modal, not only the registered ones.
 *
 * The stack has to be complete to be right: the studio window is an
 * ordinary modal that registers nothing, and it is the one underneath in
 * every case here. Bootstrap's events bubble, so one pair of listeners on
 * the document sees all of them.
 */
function watch() {
    if (watching || typeof document === 'undefined') return;
    watching = true;

    document.addEventListener('shown.bs.modal', (event) => {
        const element = event.target;
        drop(element);
        stack.push(element);

        // On its own it is an ordinary modal and Bootstrap's own depths
        // are right.
        if (stack.length > 1) raiseBackdrop(depths.get(element) ?? STACKED_BACKDROP);

        for (const below of stack.slice(0, -1)) focusTrapOf(below)?.deactivate();
    });

    document.addEventListener('hidden.bs.modal', (event) => {
        drop(event.target);

        const top = stack.at(-1);
        if (!top) return;

        focusTrapOf(top)?.activate();
        // Bootstrap released the page as this window closed, without
        // asking whether another was still holding it.
        document.body.classList.add('modal-open');
    });
}

function drop(element) {
    const at = stack.indexOf(element);
    if (at >= 0) stack.splice(at, 1);
}

function raiseBackdrop(depth) {
    const backdrops = document.querySelectorAll('.modal-backdrop');
    if (backdrops.length > 1) backdrops[backdrops.length - 1].style.zIndex = String(depth);
}

/**
 * A modal's focus trap.
 *
 * Bootstrap keeps no public handle on it. Reaching for the private one is
 * the only way to stop two traps fighting, and it is guarded: a version
 * that renames it leaves stacked windows looking the way they do today
 * rather than throwing.
 */
function focusTrapOf(element) {
    return globalThis.bootstrap?.Modal.getInstance(element)?._focustrap ?? null;
}
