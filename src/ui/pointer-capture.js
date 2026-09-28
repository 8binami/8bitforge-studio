/**
 * Following a pointer off the control it started on.
 *
 * Pointer capture is an improvement to a drag, never the drag itself: the
 * flag saying a drag is under way belongs to the panel, and this only decides
 * whether events keep arriving once the pointer leaves the element. Asking
 * for it throws when the pointer is not one the browser is tracking: which
 * is every synthetic `PointerEvent`, so any check driven from a console or a
 * test would otherwise take the rest of the handler down with it.
 *
 * Call it last, and let nothing depend on whether it worked.
 */

/** @param {Element} element @param {number} pointerId */
export function capturePointer(element, pointerId) {
    try {
        element.setPointerCapture(pointerId);
    } catch {
        // No such pointer: a synthetic event, or one already released.
    }
}

/** @param {Element} element @param {number} pointerId */
export function releaseCapture(element, pointerId) {
    try {
        element.releasePointerCapture(pointerId);
    } catch {
        // Never captured: nothing to give back.
    }
}
