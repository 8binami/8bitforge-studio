/**
 * Take the demo songs out of the old program and into the library.
 *
 *   node scripts/extract-demos.js
 *
 * Eight pieces of music written to show what the studio can do. They were
 * never ported, because in the old program they were not files: they were a
 * thousand lines of note arrays in `js/game-demos.js`, assembled into a
 * project by a function at load time.
 *
 * So the function is run, once, and what it produces is written out as
 * ordinary `.8bitforge` project files. From then on a demo is exactly what
 * a person's own song is: openable, copyable, and the same thing the Load
 * window lists.
 *
 * Like `extract-library.js` before it, this is a migration and not a build
 * step: run it, commit what it writes, and it has no further job. It is
 * kept as the record of where the demos came from.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

import { createProjectFile, serializeProjectFile } from '../src/project/format.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEMOS = path.join(ROOT, 'library', 'demos');
const LEGACY = path.resolve(ROOT, '..', '8bitforge.8binami.app', 'js', 'game-demos.js');

/**
 * What the Load window reads to draw its rows.
 *
 * A demo is a whole song (sixty kilobytes of note grid) and the studio
 * only needs one of those when somebody asks for it. What it needs always
 * is the name, the tempo and the category, so those are kept apart and the
 * songs themselves are fetched on demand.
 */
const INDEX_FILE = 'index.json';

/**
 * Two demos were named after a television series.
 *
 * The music is original (it was written for this studio) but the titles
 * borrowed a trademarked setting and its coined proper nouns, which is not
 * something this repository should carry. The pieces keep their character
 * and their own descriptions; only the names that pointed somewhere else
 * are replaced.
 */
const RENAMED = Object.freeze({
    'land-of-ooo': {
        id: 'sugar-kingdom',
        name: 'Sugar Kingdom'
    },
    'nightosphere-blues': {
        id: 'midnight-blues',
        name: 'Midnight Blues'
    }
});

/**
 * Keys the old exporter emits that this studio must not be handed.
 *
 *   mixerSettings   the exporter invents a 0-127 scale: `volume: 80`,
 *                   `pan: 64`: that no engine, old or new, ever used. The
 *                   real save path wrote the engine's own 0-1 gains. Left
 *                   in, a demo would open every fader eighty times over.
 *                   They are all defaults anyway, so dropping them lets the
 *                   engine keep its own.
 *   effects         always `{}`.
 *   timestamp       `Date.now()`, which would make every run of this script
 *                   produce a different file.
 *   trackPresetNames  the names shown beside each track, which this studio
 *                   derives from the preset it loaded rather than storing.
 */
const DROPPED = ['mixerSettings', 'effects', 'timestamp', 'trackPresetNames'];

/** Load the old module, which predates ES modules and exports nothing. */
async function legacyDemos() {
    const source = await fs.readFile(LEGACY, 'utf8');
    const temporary = path.join(ROOT, 'node_modules', '.game-demos.mjs');

    await fs.writeFile(temporary, `${source}\nexport { GameDemos };\n`, 'utf8');
    try {
        const { GameDemos } = await import(pathToFileURL(temporary).href);
        return new GameDemos();
    } finally {
        await fs.rm(temporary, { force: true });
    }
}

async function main() {
    const demos = await legacyDemos();
    await fs.mkdir(DEMOS, { recursive: true });

    const manifest = [];
    let written = 0;

    for (const [legacyId, demo] of Object.entries(demos.demos)) {
        const state = demos.exportDemoAsProjectData(legacyId);
        if (!state) throw new Error(`${legacyId} produced nothing`);

        for (const key of DROPPED) delete state[key];

        const { id, name } = RENAMED[legacyId] ?? { id: legacyId, name: demo.name };

        const file = createProjectFile({
            name,
            data: state,
            category: demo.category ?? 'custom',
            tags: ['demo'],
            meta: { composer: '8BitForge', comment: demo.description ?? '' },
            // A fixed date: these were written once, and a timestamp that
            // moved on every run would churn the diff for no reason.
            createdAt: '2026-01-01T00:00:00.000Z'
        });
        // `createProjectFile` stamps `updatedAt` with the current time, for
        // the same reason it must not here.
        file.updatedAt = file.createdAt;

        await fs.writeFile(path.join(DEMOS, `${id}.8bitforge`), serializeProjectFile(file), 'utf8');
        written++;

        manifest.push({
            id,
            name,
            category: file.category,
            bpm: state.sequencer.bpm,
            steps: state.sequencer.steps,
            description: demo.description ?? ''
        });

        const renamed = RENAMED[legacyId] ? `  (was ${legacyId})` : '';
        console.info(`  ${id.padEnd(18)} ${state.sequencer.bpm} BPM${renamed}`);
    }

    await fs.writeFile(
        path.join(DEMOS, INDEX_FILE),
        `${JSON.stringify(manifest, null, 2)}\n`,
        'utf8'
    );

    console.info(`\n${written} demos written to ${path.relative(ROOT, DEMOS)}/`);
}

await main();
