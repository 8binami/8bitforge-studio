/**
 * The FX automation card.
 *
 * The lanes themselves are `LanePanel`. What is here is which part of the
 * page they live in, and the one thing this card does that the mixer's does
 * not: its list follows what is switched on. Turn the delay off and its three
 * lanes leave the list, along with its entry in the section filter.
 */

import { LanePanel } from './lane-panel.js';
import { GROUP_LABELS } from '../automation/fx-automation.js';
import { MASTER_FX_EVENTS } from '../audio/master-fx.js';
import { MASTERING_EVENTS } from '../audio/mastering.js';
import { translateOr } from '../i18n/i18n.js';

export class FxAutomationPanel extends LanePanel {
    /**
     * @param {object} options
     * @param {ParentNode} options.root
     * @param {import('../studio.js').Studio} options.studio
     */
    constructor({ root, studio }) {
        super({
            root,
            studio,
            automation: studio.fxAutomation,
            elements: {
                lanes: 'fxaLanes',
                rec: 'fxaRecBtn',
                clear: 'fxaClearAll',
                filter: 'fxAutoSectionFilter'
            },
            label: 'FX automation'
        });
    }

    groupLabel(group) {
        return translateOr(`fxa.group.${group}`, GROUP_LABELS[group] ?? group);
    }

    _listen() {
        super._listen();

        // Switching an effect on or off changes which lanes are worth a row.
        this.studio.bus.on(MASTER_FX_EVENTS.changed, () => this.refreshVisibility());
        this.studio.bus.on(MASTERING_EVENTS.bypassChanged, () => this.refreshVisibility());
    }
}
