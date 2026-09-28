/**
 * Applies electron-builder PR #10176 until a release carries it.
 *
 * Its core24 snap target sets apps.<app>.desktop to meta/gui/<name>.desktop
 * and also writes snap/gui/<name>.desktop. snapcraft 9 looks for the first
 * one before meta/gui exists and stops: "Failed to generate desktop file
 * ... file does not exist". The fix upstream drops the desktop key and keeps
 * the generated file, which snapcraft copies to meta/gui by itself.
 *
 * Run by npm after every install (postinstall). Once electron-builder no
 * longer has the line, there is nothing to do and this says nothing.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const BROKEN = 'desktop: `meta/gui/${desktopBaseName}.desktop`,';
const FIXED = 'desktop: undefined, // electron-builder#10176, see scripts/patch-electron-builder.js';

let file;
try {
    file = path.join(path.dirname(require.resolve('app-builder-lib/package.json')), 'out/targets/snap/core24.js');
} catch {
    process.exit(0); // not installed (a production install): nothing to patch
}

const source = await readFile(file, 'utf8').catch(() => null);
if (source?.includes(BROKEN)) {
    await writeFile(file, source.replace(BROKEN, FIXED));
    console.info('[patch-electron-builder] core24 snap: duplicate desktop entry removed (electron-builder#10176)');
}
