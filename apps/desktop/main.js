/**
 * 8BitForge Studio: Electron main process.
 *
 * The renderer is the exact same bundle the web build ships. It is served
 * from disk through a privileged `app://` scheme rather than `file://`, for
 * three reasons:
 *   - AudioWorklet and ES modules need a proper origin
 *   - SharedArrayBuffer needs COOP/COEP response headers
 *   - one origin means one set of relative URLs for both targets
 *
 * The renderer has no Node access. File system work happens here, and only
 * for paths the user picked in a dialog during this session.
 */

import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, shell } from 'electron';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const RENDERER_DIR = path.join(ROOT, 'dist', 'web');

/** Dev server URL, set by scripts/dev-desktop.js. */
const DEV_SERVER_URL = process.env.FORGE_DEV_SERVER_URL || null;

const APP_SCHEME = 'app';
const APP_ORIGIN = `${APP_SCHEME}://studio`;
const PROJECT_EXTENSION = '8bitforge';
const SHOW_ANYWAY_MS = 4000;

const SECURITY_HEADERS = {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'credentialless'
};

const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.wasm': 'application/wasm',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg'
};

/**
 * Paths the renderer is allowed to write to. A path lands here only when the
 * user chose it in an open or save dialog, so a compromised renderer cannot
 * reach arbitrary files.
 * @type {Set<string>}
 */
const grantedPaths = new Set();

/** @type {BrowserWindow|null} */
let mainWindow = null;

// ── Protocol registration (must run before app is ready) ──────────────────

protocol.registerSchemesAsPrivileged([
    {
        scheme: APP_SCHEME,
        privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
            corsEnabled: true,
            stream: true
        }
    }
]);

// ── Window ────────────────────────────────────────────────────────────────

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1100,
        minHeight: 720,
        backgroundColor: '#12131a',
        // Windows and macOS take it from the executable; X11 from the window.
        ...(process.platform === 'linux' && { icon: path.join(__dirname, 'resources/icons/512x512.png') }),
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            spellcheck: false
        }
    });

    reportRendererTrouble(mainWindow.webContents);

    // Shown once painted, so it never opens blank. A page that never paints
    // (a GPU that fails in a virtual machine, say) must not leave the app
    // running with no window: past a few seconds it is shown anyway.
    mainWindow.once('ready-to-show', () => mainWindow?.show());
    const shown = mainWindow;
    setTimeout(() => {
        if (shown === mainWindow && !shown.isDestroyed() && !shown.isVisible()) shown.show();
    }, SHOW_ANYWAY_MS);
    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // External links open in the user's browser, never in the app window.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:$/.test(safeProtocol(url))) shell.openExternal(url);
        return { action: 'deny' };
    });
    mainWindow.webContents.on('will-navigate', (event, url) => {
        if (!url.startsWith(APP_ORIGIN) && url !== DEV_SERVER_URL) event.preventDefault();
    });

    if (DEV_SERVER_URL) {
        mainWindow.loadURL(DEV_SERVER_URL);
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    } else {
        mainWindow.loadURL(`${APP_ORIGIN}/index.html`);
    }
}

/**
 * Say, where someone can see it, when the window fails.
 *
 * A packaged app has no console to open. Without this, a renderer that
 * cannot load a file, throws on startup or is killed outright shows a blank
 * window and says nothing anywhere: the same symptom for three very
 * different causes.
 *
 * @param {import('electron').WebContents} contents
 */
function reportRendererTrouble(contents) {
    contents.on('did-fail-load', (_event, code, description, url) => {
        // -3 is an aborted load, which is what a redirect looks like.
        if (code === -3) return;
        console.error(`[renderer] could not load ${url}: ${description} (${code})`);
    });

    contents.on('render-process-gone', (_event, details) => {
        console.error(`[renderer] gone: ${details.reason}`);
    });

    contents.on('preload-error', (_event, preloadPath, error) => {
        console.error(`[preload] ${preloadPath}: ${error.message}`);
    });

    // Only what went wrong: a renderer that logs as it works is not news.
    contents.on('console-message', ({ level, message, sourceId, lineNumber }) => {
        if (level === 'error') console.error(`[renderer] ${message}  (${sourceId}:${lineNumber})`);
    });
}

function safeProtocol(url) {
    try {
        return new URL(url).protocol;
    } catch {
        return '';
    }
}

// ── app:// handler ────────────────────────────────────────────────────────

function registerAppProtocol() {
    protocol.handle(APP_SCHEME, async (request) => {
        const url = new URL(request.url);
        const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
        const target = path.join(RENDERER_DIR, relative);

        // Path traversal guard: never serve outside the renderer directory.
        if (!target.startsWith(RENDERER_DIR + path.sep) && target !== RENDERER_DIR) {
            return new Response('Forbidden', { status: 403 });
        }

        try {
            await fs.access(target);
        } catch {
            return new Response('Not found', { status: 404 });
        }

        const type = MIME_TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream';
        const body = createReadStream(target);
        return new Response(body, {
            status: 200,
            headers: { 'Content-Type': type, ...SECURITY_HEADERS }
        });
    });
}

// ── IPC: project files ────────────────────────────────────────────────────

function registerIpcHandlers() {
    ipcMain.handle('project:open', async () => {
        const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
            title: 'Open project',
            properties: ['openFile'],
            filters: [
                { name: '8BitForge project', extensions: [PROJECT_EXTENSION] },
                { name: 'All files', extensions: ['*'] }
            ]
        });
        if (canceled || filePaths.length === 0) return null;

        const filePath = filePaths[0];
        const text = await fs.readFile(filePath, 'utf8');
        grantedPaths.add(filePath);
        app.addRecentDocument(filePath);

        return { path: filePath, name: path.basename(filePath), text };
    });

    ipcMain.handle('project:saveAs', async (_event, { defaultName, text }) => {
        if (typeof text !== 'string') throw new TypeError('text must be a string');

        const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
            title: 'Save project',
            defaultPath: defaultName || `Untitled.${PROJECT_EXTENSION}`,
            filters: [{ name: '8BitForge project', extensions: [PROJECT_EXTENSION] }]
        });
        if (canceled || !filePath) return null;

        await fs.writeFile(filePath, text, 'utf8');
        grantedPaths.add(filePath);
        app.addRecentDocument(filePath);

        return { path: filePath, name: path.basename(filePath) };
    });

    /**
     * Save any file the studio produced: a render, a stem archive, a MIDI
     * file. Binary arrives as an ArrayBuffer, which survives the IPC boundary
     * as a structured clone; text arrives as a string.
     */
    ipcMain.handle('file:saveAs', async (_event, { defaultName, data, filters }) => {
        const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
            title: 'Save file',
            defaultPath: defaultName || 'Untitled',
            filters: Array.isArray(filters) && filters.length ? filters : undefined
        });
        if (canceled || !filePath) return null;

        const contents = typeof data === 'string' ? data : Buffer.from(data);
        await fs.writeFile(filePath, contents);
        grantedPaths.add(filePath);

        return { path: filePath, name: path.basename(filePath) };
    });

    /** Save several files into one folder the user picks: stems, patterns. */
    ipcMain.handle('file:saveAllTo', async (_event, files) => {
        const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
            title: 'Choose a folder',
            properties: ['openDirectory', 'createDirectory']
        });
        if (canceled || filePaths.length === 0) return null;

        const directory = filePaths[0];
        const written = [];
        for (const file of files) {
            const target = path.join(directory, path.basename(file.name));
            const contents = typeof file.data === 'string' ? file.data : Buffer.from(file.data);
            await fs.writeFile(target, contents);
            written.push(target);
        }
        return { directory, files: written };
    });

    ipcMain.handle('project:write', async (_event, filePath, text) => {
        if (typeof text !== 'string') throw new TypeError('text must be a string');
        if (!grantedPaths.has(filePath)) {
            console.warn('[ipc] refused write to a path the user never picked:', filePath);
            return false;
        }
        await fs.writeFile(filePath, text, 'utf8');
        return true;
    });

    // ── The library: a folder of plain files the user owns ────────────────

    ipcMain.handle('library:list', async (_event, kind) => {
        const directory = await libraryDirectory(kind);
        let names;
        try {
            names = await fs.readdir(directory);
        } catch {
            return []; // nothing saved yet
        }

        const entries = [];
        for (const name of names) {
            if (!name.endsWith('.json') && !name.endsWith(`.${PROJECT_EXTENSION}`)) continue;
            const file = path.join(directory, name);
            const stats = await fs.stat(file);
            const header = await readHeader(file, name);
            entries.push({
                ...header,
                id: name.replace(/\.(json|8bitforge)$/, ''),
                updatedAt: stats.mtime.toISOString(),
                size: stats.size
            });
        }
        return entries.sort((a, b) => a.name.localeCompare(b.name));
    });

    ipcMain.handle('library:read', async (_event, kind, id) => {
        const file = await libraryFile(kind, id);
        try {
            return await fs.readFile(file, 'utf8');
        } catch {
            return null; // absent, which is not an error to the caller
        }
    });

    ipcMain.handle('library:write', async (_event, kind, id, contents) => {
        if (typeof contents !== 'string') throw new TypeError('contents must be a string');

        const file = await libraryFile(kind, id);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, contents, 'utf8');
        return { id, path: file };
    });

    ipcMain.handle('library:remove', async (_event, kind, id) => {
        const file = await libraryFile(kind, id);
        try {
            await fs.unlink(file);
            return true;
        } catch {
            return false;
        }
    });

    ipcMain.handle('library:reveal', async (_event, kind) => {
        const directory = await libraryDirectory(kind);
        await fs.mkdir(directory, { recursive: true });
        shell.openPath(directory);
        return directory;
    });

    ipcMain.handle('app:info', () => ({
        version: app.getVersion(),
        platform: process.platform,
        // Installed from the Snap Store, which updates the app by itself.
        store: process.env.SNAP ? 'snap' : null,
        userDataPath: app.getPath('userData'),
        documentsPath: app.getPath('documents'),
        libraryPath: libraryRoot()
    }));

    ipcMain.handle('shell:openExternal', async (_event, url) => {
        if (!/^https?:$/.test(safeProtocol(url))) return false;
        await shell.openExternal(url);
        return true;
    });
}

// ── The library folder ────────────────────────────────────────────────────

/** Kinds the renderer may ask for. Anything else is refused. */
const LIBRARY_KINDS = new Set(['projects', 'kits', 'presets', 'rhythms', 'generator-presets']);

/** Projects keep their own extension; everything else is plain JSON. */
const LIBRARY_EXTENSIONS = { projects: PROJECT_EXTENSION };

/**
 * Under Documents rather than hidden in application data: these are the
 * user's files, to back up, copy or open in an editor.
 */
function libraryRoot() {
    return path.join(app.getPath('documents'), '8BitForge Studio');
}

async function libraryDirectory(kind) {
    if (!LIBRARY_KINDS.has(kind)) throw new Error(`Unknown library kind: ${kind}`);
    return path.join(libraryRoot(), kind);
}

/** Resolve an item to a file, refusing any id that tries to leave its folder. */
async function libraryFile(kind, id) {
    const directory = await libraryDirectory(kind);
    const extension = LIBRARY_EXTENSIONS[kind] ?? 'json';
    const file = path.join(directory, `${path.basename(String(id))}.${extension}`);

    if (!file.startsWith(directory + path.sep)) {
        throw new Error('Refusing to leave the library folder');
    }
    return file;
}

/**
 * What a listing shows about a file, read from the envelope around its
 * payload: the name, the category, the tags, the cover and the dates. Falls
 * back to the file name, so a file the user dropped in by hand still shows up.
 *
 * This mirrors `src/storage/listing.js`, which the renderer's two backends
 * share. It cannot import it: `src/` is not shipped inside the packaged app,
 * only the built renderer is. The two have to be kept in step by hand.
 */
async function readHeader(file, fileName) {
    let parsed;
    try {
        parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    } catch {
        parsed = {};
    }

    return {
        name: typeof parsed.name === 'string' && parsed.name ? parsed.name : bare(fileName),
        tags: Array.isArray(parsed.tags) ? parsed.tags : [],
        category: typeof parsed.category === 'string' ? parsed.category : null,
        cover: typeof parsed.cover === 'string' ? parsed.cover : null,
        createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : null,
        meta: parsed.meta && typeof parsed.meta === 'object' ? parsed.meta : {}
    };
}

function bare(fileName) {
    return fileName.replace(/\.(json|8bitforge)$/, '');
}

// ── Lifecycle ─────────────────────────────────────────────────────────────

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
    app.quit();
} else {
    // Launched again: the running app answers. With no window left to show,
    // it opens one rather than staying invisible.
    app.on('second-instance', () => {
        if (!app.isReady()) return;
        if (!mainWindow) {
            createWindow();
            return;
        }
        if (mainWindow.isMinimized()) mainWindow.restore();
        if (!mainWindow.isVisible()) mainWindow.show();
        mainWindow.focus();
    });

    /**
     * The studio has its own menus in the page, so Electron's default one
     * (File, Edit, View, Window) is not shown. macOS keeps a minimal menu:
     * there, copy, paste and Quit only work through it.
     */
    function setApplicationMenu() {
        if (process.platform !== 'darwin') {
            Menu.setApplicationMenu(null);
            return;
        }
        Menu.setApplicationMenu(Menu.buildFromTemplate([
            { role: 'appMenu' },
            { role: 'editMenu' },
            { role: 'windowMenu' }
        ]));
    }

    app.whenReady().then(() => {
        setApplicationMenu();
        if (!DEV_SERVER_URL) registerAppProtocol();
        registerIpcHandlers();
        createWindow();

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindow();
        });
    });

    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') app.quit();
    });
}
