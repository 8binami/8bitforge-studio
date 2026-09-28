/**
 * Choosing which pattern to copy into.
 *
 * Duplicating a pattern has to land somewhere, and there are eight places it
 * could go. Picking one for you is the wrong answer twice over: into the
 * first empty slot and the copy turns up somewhere nobody asked for, and
 * when none is empty there is nothing to do at all: which is how the button
 * came to be dead on a project with eight patterns in it.
 *
 * So it asks. Eight buttons, the one you are copying from greyed out, and
 * the answer is a promise: the number chosen, or null if the window was
 * closed without choosing.
 *
 * As with `confirm.js`, one element is built the first time it is needed and
 * reused after that, and without Bootstrap the answer is null: refusing to
 * overwrite a pattern is the safe way to fail.
 */

import { translateOr } from '../i18n/i18n.js';

let element = null;
let modal = null;

/**
 * @param {object} options
 * @param {number} options.source  the pattern being copied, counted from zero
 * @param {number} [options.count]  how many there are
 * @returns {Promise<number|null>}
 */
export function pickPattern({ source, count = 8 }) {
    const Modal = globalThis.bootstrap?.Modal;
    if (!Modal) return Promise.resolve(null);

    if (!element) {
        const host = document.createElement('div');
        host.innerHTML = template();
        element = host.firstElementChild;
        document.body.append(element);
        modal = new Modal(element);
    }

    element.querySelector('[data-field="title"]').textContent = translateOr(
        'transport.dupTitle',
        'Duplicate Pattern'
    );
    element.querySelector('[data-field="from"]').textContent = `${translateOr(
        'transport.dupFrom',
        'Pattern'
    )} ${source + 1} →`;

    const grid = element.querySelector('[data-field="grid"]');
    grid.innerHTML = '';

    for (let index = 0; index < count; index++) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'pattern-pick-btn';
        button.textContent = String(index + 1);
        button.dataset.target = String(index);

        // Copying a pattern onto itself is the one choice that cannot mean
        // anything, so it is shown and not offered.
        if (index === source) button.classList.add('disabled');

        grid.append(button);
    }

    return new Promise((resolve) => {
        /** @type {number|null} */
        let answer = null;

        const onPick = (event) => {
            const button = event.target.closest('.pattern-pick-btn');
            if (!button || button.classList.contains('disabled')) return;

            answer = Number(button.dataset.target);
            modal.hide();
        };

        // One listener for the answer, whichever way the window closes: a
        // button, the cross, Escape, or a click outside it.
        const onClosed = () => {
            grid.removeEventListener('click', onPick);
            element.removeEventListener('hidden.bs.modal', onClosed);
            resolve(answer);
        };

        grid.addEventListener('click', onPick);
        element.addEventListener('hidden.bs.modal', onClosed);
        modal.show();
    });
}

function template() {
    return `
        <div class="modal fade" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-dialog-centered modal-sm">
                <div class="modal-content">
                    <div class="modal-header py-2">
                        <h6 class="modal-title" data-field="title"></h6>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"
                            aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <div class="pattern-pick-from" data-field="from"></div>
                        <div class="pattern-pick-grid" data-field="grid"></div>
                    </div>
                </div>
            </div>
        </div>`;
}
