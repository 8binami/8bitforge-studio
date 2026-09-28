/**
 * Project file migrations.
 *
 * Two independent version numbers live in a project file:
 *
 *   file.version   the envelope (this module)
 *   file.data.*    the studio state payload, owned by the audio and sequencer
 *                  modules and migrated by `migrateStatePayload`
 *
 * Rules:
 *   - a migration never throws; unknown fields are preserved as-is
 *   - migrations run in order, each one upgrading exactly one step
 *   - a file written by an older build must always open
 */

import { CURRENT_VERSION } from './format.js';

/**
 * Envelope versions this build can read, by major.minor.
 * `1.x` covers every file written by the legacy web app.
 */
export const LEGACY_VERSIONS = ['1.0', '1.1', '1.2', '1.3', '1.4'];

/** State payload version produced by this build. */
export const CURRENT_STATE_VERSION = '1.2';

/**
 * Upgrade a parsed project file to the current format.
 * The input is not mutated.
 *
 * @param {object} raw
 * @returns {object} upgraded file
 */
export function migrateProjectFile(raw) {
    const file = structuredClone(raw);

    // ── Envelope 1.x → 2.0 ────────────────────────────────────────────────
    // The legacy envelope carried `exportedAt` only, and left category, tags,
    // meta and cover optional. 2.0 makes the header complete so a library can
    // be listed without reading the payload.
    if (file.version !== CURRENT_VERSION) {
        const exportedAt = typeof file.exportedAt === 'string' ? file.exportedAt : null;

        file.name = typeof file.name === 'string' && file.name ? file.name : 'Untitled';
        file.createdAt = file.createdAt || exportedAt || new Date().toISOString();
        file.updatedAt = file.updatedAt || exportedAt || file.createdAt;
        file.category = file.category || 'custom';
        file.tags = Array.isArray(file.tags) ? file.tags : [];
        file.meta = file.meta && typeof file.meta === 'object' ? file.meta : {};
        file.cover = file.cover ?? null;
        delete file.exportedAt;

        file.version = CURRENT_VERSION;
    }

    file.data = migrateStatePayload(file.data);
    return file;
}

/**
 * Upgrade the studio state payload.
 *
 * v1.1 and earlier → v1.2: oscillator volumes were rebalanced by ×0.60 when
 * the gain staging of the audio engine changed. Files written before that
 * change play back far too loud without this step.
 *
 * Any version → this build: two fields the legacy app names differently, and
 * the two parallel arrays it uses for which instrument is on each track. See
 * `renameFields` and `foldTrackPresets`.
 *
 * @param {object} state
 * @returns {object} upgraded state (the input is not mutated)
 */
export function migrateStatePayload(state) {
    if (!state || typeof state !== 'object') return state;

    const next = foldTrackPresets(renameFields(structuredClone(state)));
    const version = parseFloat(next.version || '1.0');

    if (version < 1.2) {
        const VOLUME_SCALE = 0.6;
        if (Array.isArray(next.tracks)) {
            for (const track of next.tracks) {
                if (track && typeof track.volume === 'number') {
                    track.volume = Math.round(track.volume * VOLUME_SCALE * 100) / 100;
                }
            }
        }
        next.version = '1.2';
    }

    if (!next.version) next.version = CURRENT_STATE_VERSION;
    return next;
}

/**
 * `trackPresetNames` + `trackCustomState` → `trackPresets`.
 *
 * The legacy app keeps the instrument on each track as two arrays of
 * eight read in step (`js/app.js:36-37`, written at `js/storage.js:341`
 * and `:344`): the preset's name, and whether the sound has been edited
 * away from it since. This build keeps one array of records, so that a
 * track cannot end up with a name and no modified flag or the reverse.
 *
 * A name is all the legacy file has (no id, no source) so the record
 * says `custom`: the sound came with the project and is in nobody's
 * library, which is exactly what the port means by that word.
 *
 * A file with neither array is left alone rather than given eight empty
 * records. A project from a build that never wrote this has nothing to
 * say about its tracks, and saying nothing is the truthful version.
 */
function foldTrackPresets(state) {
    const names = state.trackPresetNames;
    const custom = state.trackCustomState;
    if (!Array.isArray(names) && !Array.isArray(custom)) return state;

    if (!Array.isArray(state.trackPresets)) {
        state.trackPresets = Array.from({ length: 8 }, (_unused, track) => {
            const name = Array.isArray(names) ? names[track] : null;
            if (!name || name === '\u2014') return null; // the old app's 'no instrument'

            return {
                id: null,
                source: 'custom',
                name,
                // The legacy app stored the name and the flag and never
                // the sound the name refers to, so there is nothing for
                // Reset to go back to and the flag is all there is.
                sound: null,
                modified: Array.isArray(custom) ? Boolean(custom[track]) : false
            };
        });
    }

    delete state.trackPresetNames;
    delete state.trackCustomState;
    return state;
}

/**
 * Two fields the legacy app files under another name.
 *
 * `trackFx` → `trackEffects` (`js/storage.js:348`) and `arpSettings` →
 * `arpeggiator` (`:354`). Each holds the same eight records, field for
 * field; only the name differs, and this build names every field after
 * the module that owns it.
 *
 * Without the first, a project saved in the live app opened here with
 * every track's distortion, delay, reverb, chorus and bitcrusher back at
 * zero, while the rule at the top of this file says unknown fields are
 * preserved. They were: preserved, and never read.
 *
 * A file that already carries the new name keeps it, so opening one
 * written by this build cannot be undone by a legacy field beside it.
 */
const RENAMED = [
    ['trackFx', 'trackEffects'],
    ['arpSettings', 'arpeggiator']
];

function renameFields(state) {
    for (const [was, now] of RENAMED) {
        if (!Array.isArray(state[was])) continue;

        if (!Array.isArray(state[now])) state[now] = state[was];
        delete state[was];
    }
    return state;
}
