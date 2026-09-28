/**
 * Publish the hosted web build to studio.8bitforge.com.
 *
 *   npm run deploy:web                 build, send, swap in
 *   npm run deploy:web -- rollback     put the previous version back
 *
 * It builds the hosted version itself (`vite build --mode hosted`), so what
 * is sent can only be a build with the account in it, then streams dist/web
 * as a .tar.gz over ssh. On the server the account can run one thing,
 * deploy/studio-deploy.sh, which checks the archive and swaps it in for the
 * live site at once.
 *
 * Where to and as whom is in deploy.config.json, beside package.json, which
 * git ignores: copy deploy.config.example.json. With a password in it, ssh
 * gets it through SSH_ASKPASS from this process's environment: never on the
 * command line, never in a file of its own. Without one, ssh asks.
 *
 * Sourcemaps stay behind: the repository is private, and a .map file is the
 * source in readable form.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist', 'web');
const configPath = path.join(root, 'deploy.config.json');
const command = process.argv[2] === 'rollback' ? 'rollback' : 'publish';

const config = readConfig();
const ssh = findSsh(config.ssh);

if (command === 'publish') {
    // Built here rather than trusted: a build made without `--mode hosted`
    // would publish a studio with no sign-in, and nothing in dist/web says
    // which mode made it.
    const build = spawn('npx', ['vite', 'build', '--mode', 'hosted'], { cwd: root, stdio: 'inherit', shell: true });
    const code = await new Promise((resolve) => build.on('close', resolve));
    if (code !== 0 || !fs.existsSync(path.join(dist, 'index.html'))) {
        console.error('The build failed: nothing sent.');
        process.exit(1);
    }
}

const { env, cleanup } = passwordEnvironment(config.password);
const args = [
    '-p', String(config.port || 22),
    '-o', 'PreferredAuthentications=password,keyboard-interactive',
    '-o', 'PubkeyAuthentication=no',
    // The first connection learns the server's key; after that a different
    // key is refused, as it should be.
    '-o', 'StrictHostKeyChecking=accept-new',
    `${config.user}@${config.host}`,
    command
];
const session = spawn(ssh, args, { env, stdio: [command === 'publish' ? 'pipe' : 'inherit', 'inherit', 'inherit'] });

if (command === 'publish') {
    const tar = spawn('tar', ['-czf', '-', '-C', dist, '--exclude=*.map', '.'], { stdio: ['ignore', 'pipe', 'inherit'] });
    tar.stdout.pipe(session.stdin);
    tar.on('close', (code) => {
        if (code !== 0) {
            console.error(`tar stopped with code ${code}`);
            session.kill();
        }
    });
}

session.on('close', (code) => {
    cleanup();
    process.exit(code ?? 1);
});

// ── Helpers ──────────────────────────────────────────────────────────────

function readConfig() {
    if (!fs.existsSync(configPath)) {
        console.error('deploy.config.json is missing: copy deploy.config.example.json beside it and fill it in.');
        process.exit(1);
    }
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (error) {
        console.error(`deploy.config.json is not valid JSON: ${error.message}`);
        process.exit(1);
    }
    for (const key of ['host', 'user']) {
        if (typeof parsed[key] !== 'string' || !parsed[key].trim()) {
            console.error(`deploy.config.json has no "${key}".`);
            process.exit(1);
        }
    }
    return parsed;
}

/**
 * The ssh to run. On Windows, Git's own: it runs the small askpass script
 * below, which the ssh that ships with Windows cannot.
 */
function findSsh(chosen) {
    if (chosen) return chosen;
    if (process.platform === 'win32') {
        const git = ['C:\\Program Files\\Git\\usr\\bin\\ssh.exe', 'C:\\Program Files (x86)\\Git\\usr\\bin\\ssh.exe'].find((p) =>
            fs.existsSync(p)
        );
        if (git) return git;
    }
    return 'ssh';
}

/**
 * Hand ssh the password without writing it anywhere: the askpass script only
 * prints a variable of the environment ssh passes down to it.
 */
function passwordEnvironment(password) {
    if (!password) return { env: process.env, cleanup: () => {} };

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-deploy-'));
    const askpass = path.join(dir, 'askpass.sh');
    fs.writeFileSync(askpass, '#!/bin/sh\nprintf \'%s\\n\' "$FORGE_DEPLOY_PASSWORD"\n', { mode: 0o700 });

    return {
        env: {
            ...process.env,
            FORGE_DEPLOY_PASSWORD: password,
            SSH_ASKPASS: askpass,
            SSH_ASKPASS_REQUIRE: 'force',
            DISPLAY: process.env.DISPLAY || ':0'
        },
        cleanup: () => fs.rmSync(dir, { recursive: true, force: true })
    };
}
