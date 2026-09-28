/**
 * Ask before something irreversible.
 *
 * The browser's own `confirm` blocks the page and looks like the browser
 * rather than the studio, so this is a Bootstrap modal that resolves to true
 * or false. One element is built the first time it is needed and reused after
 * that: these windows are identical apart from their words.
 *
 * If Bootstrap is not there, a test, a page that failed to load its scripts:
 * the answer is no. Refusing to destroy something is the safe way to fail.
 *
 * It is asked from inside other windows: deleting a kit from the edit kit
 * window, which is itself over the studio window: so it is stacked, and the
 * stylesheet puts it above everything else that can be open.
 */

import { translateOr } from '../i18n/i18n.js';
import { stackModal, CONFIRM_BACKDROP } from './modal-stack.js';

let element = null;
let modal = null;

/**
 * @param {object} options
 * @param {string} options.message
 * @param {string} [options.title]
 * @param {string} [options.confirmLabel]
 * @param {'danger'|'primary'} [options.tone]
 * @returns {Promise<boolean>}
 */
export function confirmAction({
    message,
    title = translateOr('confirm.title', 'Are you sure?'),
    confirmLabel = translateOr('confirm.yes', 'Confirm'),
    tone = 'danger'
}) {
    const Modal = globalThis.bootstrap?.Modal;
    if (!Modal) return Promise.resolve(false);

    if (!element) {
        const host = document.createElement('div');
        host.innerHTML = template();
        element = host.firstElementChild;
        document.body.append(element);
        modal = new Modal(element);
        stackModal(element, CONFIRM_BACKDROP);
    }

    element.querySelector('[data-field="title"]').textContent = title;
    element.querySelector('[data-field="message"]').textContent = message;

    const accept = element.querySelector('[data-action="accept"]');
    accept.textContent = confirmLabel;
    accept.className = `btn btn-sm btn-${tone}`;

    return new Promise((resolve) => {
        let answer = false;

        const onAccept = () => {
            answer = true;
            modal.hide();
        };

        // One listener for the answer, whichever way the window closes:
        // the button, the cross, Escape, or a click outside it.
        const onClosed = () => {
            accept.removeEventListener('click', onAccept);
            element.removeEventListener('hidden.bs.modal', onClosed);
            resolve(answer);
        };

        accept.addEventListener('click', onAccept);
        element.addEventListener('hidden.bs.modal', onClosed);
        modal.show();
    });
}

function template() {
    return `
        <div class="modal fade" id="forgeConfirmModal" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-dialog-centered modal-sm">
                <div class="modal-content">
                    <div class="modal-header py-2">
                        <h5 class="modal-title" style="font-size: 13px" data-field="title"></h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"
                            aria-label="Close"></button>
                    </div>
                    <div class="modal-body" style="font-size: 12px" data-field="message"></div>
                    <div class="modal-footer py-2">
                        <button type="button" class="btn btn-sm btn-outline-secondary"
                            data-bs-dismiss="modal" data-i18n="confirm.cancel">Cancel</button>
                        <button type="button" class="btn btn-sm btn-danger" data-action="accept"></button>
                    </div>
                </div>
            </div>
        </div>
    `;
}
