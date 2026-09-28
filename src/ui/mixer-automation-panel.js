/**
 * The mixer automation card.
 *
 * The lanes themselves are `LanePanel`. What is here is which part of the
 * page they live in, and the fact that its filter is written into the markup
 * rather than built: the tracks are always all there, so the menu never
 * changes. Its values are track numbers, which this turns into group names.
 */

import { LanePanel } from './lane-panel.js';

/** What the markup's filter uses for "every track" and for the master. */
const ALL_TRACKS = '-1';
const MASTER_OPTION = '8';

export class MixerAutomationPanel extends LanePanel {
    /**
     * @param {object} options
     * @param {ParentNode} options.root
     * @param {import('../studio.js').Studio} options.studio
     */
    constructor({ root, studio }) {
        super({
            root,
            studio,
            automation: studio.mixerAutomation,
            elements: {
                lanes: 'mixerAutoLanes',
                rec: 'mixAutoRecBtn',
                clear: 'mixAutoClearAll',
                filter: 'mixAutoTrackFilter'
            },
            label: 'Mixer automation'
        });
    }

    sectionFromFilter(value) {
        if (value === ALL_TRACKS) return 'all';
        if (value === MASTER_OPTION) return 'master';
        return `track${value}`;
    }

    /** The filter is part of the page; it lists every track whatever happens. */
    _fillSectionFilter() {}
}
