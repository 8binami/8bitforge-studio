/**
 * Cards: collapsing, reordering, and what each view shows.
 *
 * The studio is a stack of cards the user arranges to suit how they work:
 * collapse the ones they are not using, drag the rest into the order they
 * want. Both are remembered, because rebuilding a layout on every visit is
 * the kind of small tax that makes a tool tiring.
 *
 * What is collapsed is remembered per view, not once for the whole app: the
 * sequencer and the arrangement are two different jobs, and a card that is in
 * the way of one is the point of the other. The order is shared, since a card
 * that only appears in one view keeps its place in the other's list anyway.
 *
 * Dragging uses SortableJS (MIT). The collapse animation is written here: it
 * is a height transition, not worth a dependency.
 */

import Sortable from 'sortablejs';

const STORAGE_KEY = '8bitforge-card-layout';
const COLLAPSE_MS = 300;

/** The transport is never collapsed: it is how the studio is played. */
const ALWAYS_OPEN = 'transport';

/**
 * Where a first visit starts. `true` means collapsed, and a card the view
 * does not mention starts collapsed too: an open card is a deliberate
 * choice, here and in what the user saves afterwards.
 */
export const DEFAULT_LAYOUT = Object.freeze({
    cardOrder: [
        'spectrum',
        'mastering',
        'sequencer',
        'transport',
        'rhythm',
        'keyboard',
        'effects',
        'mixer',
        'fxautomation',
        'mixerautomation'
    ],
    modes: {
        sequencer: {
            spectrum: true,
            sequencer: false,
            transport: false,
            rhythm: true,
            keyboard: false
        },
        arrangement: {
            spectrum: true,
            mastering: true,
            sequencer: false,
            transport: false,
            mixer: false,
            mixerautomation: true,
            fxautomation: true,
            effects: true
        }
    }
});

/**
 * @param {ParentNode} root
 * @param {object} [options]
 * @param {string} [options.view]  which view's collapse states to apply
 * @returns {{ setView: (view: string) => void, save: () => void }}
 */
export function bindCards(root, { view = 'sequencer' } = {}) {
    const container = root.querySelector('#sortableCards');
    const layout = readLayout();
    let currentView = view;

    const save = () => {
        if (!container) return;
        rememberInto(layout, container, currentView);
        writeLayout(layout);
    };

    bindToggles(root, save);
    if (container) {
        bindDragging(container, save);
        applyOrder(container, layout.cardOrder);
        applyCollapseStates(container, layout, currentView);
    }

    return {
        save,
        /**
         * Switch to another view's collapse states. Call `save` first, while
         * the cards of the view being left are still the ones on screen:
         * what is hidden cannot be read back.
         */
        setView: (next) => {
            currentView = next;
            if (container) applyCollapseStates(container, layout, currentView);
        }
    };
}

// ── Collapsing ───────────────────────────────────────────────────────────

function bindToggles(root, onChange) {
    for (const button of root.querySelectorAll('[data-action="card-toggle"]')) {
        button.addEventListener('click', (event) => {
            event.preventDefault();

            const card = button.closest('.card');
            const body = card?.querySelector('.card-body');
            if (!body) return;

            const collapsing = !card.classList.contains('card-collapse');
            animateHeight(body, collapsing);
            card.classList.toggle('card-collapse', collapsing);
            setChevron(card, collapsing);

            onChange();
        });
    }
}

/**
 * Animate a card body open or shut. A height transition needs a number at
 * both ends, so the natural height is measured first and cleared afterwards:
 * leaving it pinned would stop the card growing with its content.
 */
function animateHeight(body, collapsing) {
    const full = `${body.scrollHeight}px`;
    body.style.overflow = 'hidden';

    if (collapsing) {
        body.style.maxHeight = full;
        requestAnimationFrame(() => {
            body.style.transition = `max-height ${COLLAPSE_MS}ms ease`;
            body.style.maxHeight = '0';
        });
        window.setTimeout(() => {
            body.style.display = 'none';
            body.style.transition = '';
            body.style.overflow = '';
        }, COLLAPSE_MS + 10);
        return;
    }

    body.style.display = '';
    body.style.maxHeight = '0';
    requestAnimationFrame(() => {
        body.style.transition = `max-height ${COLLAPSE_MS}ms ease`;
        body.style.maxHeight = `${body.scrollHeight}px`;
    });
    window.setTimeout(() => {
        body.style.maxHeight = '';
        body.style.overflow = '';
        body.style.transition = '';
    }, COLLAPSE_MS + 10);
}

/** Shut a card outright, with none of the animation. */
function setCollapsed(card, collapsed) {
    const body = card.querySelector('.card-body');
    if (body) {
        body.style.display = collapsed ? 'none' : '';
        // Whatever an interrupted animation left behind goes with it.
        body.style.maxHeight = '';
        body.style.overflow = '';
        body.style.transition = '';
    }

    card.classList.toggle('card-collapse', collapsed);
    setChevron(card, collapsed);
}

function setChevron(card, collapsed) {
    const icon = card.querySelector('[data-action="card-toggle"] i');
    if (!icon) return;

    icon.classList.toggle('ti-chevron-up', !collapsed);
    icon.classList.toggle('ti-chevron-down', collapsed);
}

// ── Reordering ───────────────────────────────────────────────────────────

function bindDragging(container, onChange) {
    return Sortable.create(container, {
        animation: 200,
        // Only the handle drags: the cards are full of controls, and a card
        // that moves when you reach for a slider is worse than one that does
        // not move at all.
        handle: '.drag-handle',
        draggable: '.sortable-card',
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        dragClass: 'sortable-drag',
        easing: 'cubic-bezier(0.25, 1, 0.5, 1)',
        onEnd: onChange
    });
}

// ── Remembering ──────────────────────────────────────────────────────────

/** Read the page back into a layout, for the view now on screen. */
function rememberInto(layout, container, view) {
    layout.cardOrder = [...container.querySelectorAll('.sortable-card')].map(
        (card) => card.dataset.cardId
    );

    const states = { ...(layout.modes[view] ?? {}) };
    for (const card of container.querySelectorAll('.sortable-card')) {
        // A card the other view owns is not on screen to be judged.
        if (card.classList.contains('d-none')) continue;
        states[card.dataset.cardId] = card.classList.contains('card-collapse');
    }

    layout.modes[view] = states;
}

function applyOrder(container, order) {
    // Appending in the saved sequence moves each card into place.
    for (const id of order ?? []) {
        const card = container.querySelector(`.sortable-card[data-card-id="${cssEscape(id)}"]`);
        if (card) container.append(card);
    }
}

function applyCollapseStates(container, layout, view) {
    const states = layout.modes[view] ?? DEFAULT_LAYOUT.modes[view] ?? {};

    for (const card of container.querySelectorAll('.sortable-card')) {
        const id = card.dataset.cardId;
        if (id === ALWAYS_OPEN || card.classList.contains('d-none')) continue;

        setCollapsed(card, states[id] ?? true);
    }
}

function readLayout() {
    let stored = null;
    try {
        stored = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? 'null');
    } catch {
        // Private window, blocked storage, or something that is not a layout.
    }

    const layout = {
        cardOrder: [...DEFAULT_LAYOUT.cardOrder],
        modes: structuredClone(DEFAULT_LAYOUT.modes)
    };

    // An older studio stored the order under another name, or as a list of
    // `{ id, collapsed }`: one view's worth, since it had only one. The
    // order still means what it meant, and what was shut then was shut in
    // the sequencer.
    if (Array.isArray(stored)) Object.assign(layout, migrateList(stored));
    else if (Array.isArray(stored?.cardOrder)) layout.cardOrder = stored.cardOrder;
    else if (Array.isArray(stored?.order)) layout.cardOrder = stored.order;

    if (stored?.modes) {
        for (const [view, states] of Object.entries(stored.modes)) {
            layout.modes[view] = { ...layout.modes[view], ...states };
        }
    }

    return layout;
}

/**
 * A layout from the studio that had one view, as a list of
 * `{ id, collapsed }`. Cards that list does not mention are appended in the
 * default order: the old studio had fewer cards than this one, so a migrated
 * order that dropped them would hide the newcomers rather than place them.
 *
 * @param {Array<{id?: string, collapsed?: boolean}>} list
 * @returns {{cardOrder: string[], modes: object}}
 */
export function migrateList(list) {
    const cardOrder = list.map((card) => card?.id).filter((id) => typeof id === 'string');

    for (const id of DEFAULT_LAYOUT.cardOrder) {
        if (!cardOrder.includes(id)) cardOrder.push(id);
    }

    const sequencer = { ...DEFAULT_LAYOUT.modes.sequencer };
    for (const card of list) {
        if (typeof card?.id === 'string') sequencer[card.id] = Boolean(card.collapsed);
    }

    return {
        cardOrder,
        modes: { sequencer, arrangement: { ...DEFAULT_LAYOUT.modes.arrangement } }
    };
}

function writeLayout(layout) {
    try {
        globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(layout));
    } catch {
        // Private window or blocked storage: the layout lasts this session.
    }
}

/** Card ids come from our own markup, but a selector still deserves care. */
function cssEscape(value) {
    return String(value).replace(/["\\]/g, '\\$&');
}
