/**
 * Development launcher for the desktop target.
 *
 * Starts the Vite dev server, waits for it to answer, then opens Electron
 * pointed at it through FORGE_DEV_SERVER_URL. Hot reload in the shell.
 *
 *   npm run dev:desktop
 */

import { spawn } from 'node:child_process';
import process from 'node:process';

const DEV_URL = 'http://localhost:5173';
const READY_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 300;

const isWindows = process.platform === 'win32';
const npx = isWindows ? 'npx.cmd' : 'npx';

const children = [];

function run(command, args, extraEnv = {}) {
    const child = spawn(command, args, {
        stdio: 'inherit',
        env: { ...process.env, ...extraEnv },
        shell: isWindows
    });
    children.push(child);
    return child;
}

async function waitForServer(url, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(url, { method: 'HEAD' });
            if (res.ok || res.status === 404) return true;
        } catch {
            // server not up yet
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    return false;
}

function shutdown(code = 0) {
    for (const child of children) {
        if (!child.killed) child.kill();
    }
    process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const vite = run(npx, ['vite']);
vite.on('exit', (code) => shutdown(code ?? 0));

console.info(`[dev:desktop] waiting for ${DEV_URL} …`);
if (!(await waitForServer(DEV_URL, READY_TIMEOUT_MS))) {
    console.error('[dev:desktop] dev server did not start in time');
    shutdown(1);
}

const electron = run(npx, ['electron', '.'], { FORGE_DEV_SERVER_URL: DEV_URL });
electron.on('exit', (code) => shutdown(code ?? 0));
