/**
 * Tells the desktop app that a newer version is out.
 *
 * It reads the same list the download page of 8bitforge.com shows
 * (api.8binami.com/downloads): the version of a build is the folder its file
 * sits in on the CDN, .../win/2.3.4/8BitForge-2.3.4-win-x64.exe. When this
 * platform has a newer one, the topbar shows a button to the download page,
 * which knows the installer from the portable, the AppImage from the deb.
 * Nothing is downloaded or installed here.
 *
 * One call at startup, never more than once a day, silent when offline or
 * when the API does not answer. A version dismissed stays dismissed until
 * the next one.
 */
import { translateOr } from '../i18n/i18n.js';
import { siteUrl } from '../ui/online-panels.js';

export const DOWNLOADS_URL = 'https://api.8binami.com/downloads';

const CHECKED_KEY = '8bitforge-update-checked';
const LATEST_KEY = '8bitforge-update-latest';
const DISMISSED_KEY = '8bitforge-update-dismissed';
const DAY = 24 * 60 * 60 * 1000;

/** Node's process.platform → the platform ids of the download list. */
const PLATFORMS = { win32: 'windows', darwin: 'macos', linux: 'linux' };

/** -1, 0 or 1, on the numbers of 'x.y.z' (a suffix such as '-beta' is ignored). */
export function compareVersions(a, b) {
    const pa = String(a).split(/[.-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
    const pb = String(b).split(/[.-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < 3; i++) {
        if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
    }
    return 0;
}

/**
 * The newest version the download list offers for a platform, or null.
 * @param {{platforms?: Array<{id: string, enabled?: boolean, builds?: Array<{url?: string}>}>}} list
 * @param {string} platformId  'windows', 'macos' or 'linux'
 */
export function latestVersion(list, platformId) {
    const platform = (list?.platforms ?? []).find((p) => p.id === platformId && p.enabled !== false);
    let best = null;
    for (const build of platform?.builds ?? []) {
        const match = /\/(\d+\.\d+\.\d+[^/]*)\/[^/]+$/.exec(build.url ?? '');
        if (match && (!best || compareVersions(match[1], best) > 0)) best = match[1];
    }
    return best;
}

function read(key) {
    try { return localStorage.getItem(key); } catch { return null; }
}

function write(key, value) {
    try { localStorage.setItem(key, value); } catch { /* private mode: asked again next time */ }
}

/**
 * @param {object} options
 * @param {ParentNode} options.root
 * @param {() => Promise<{version: string, platform: string}>} options.appInfo
 * @param {(url: string) => void} [options.openUrl]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {boolean} [options.force] ignore the once-a-day limit
 * @param {string} [options.simulate] for development: show this version as
 *   out ('next' for the one after the app's), without the API or storage
 * @returns {Promise<string|null>} the newer version shown, if any
 */
export async function checkForUpdate({ root, appInfo, openUrl = (url) => window.open(url, '_blank', 'noopener'), fetchImpl = fetch, force = false, simulate = '' }) {
    if (simulate) {
        const info = await appInfo();
        const latest = simulate === 'next' ? nextVersion(info.version) : simulate;
        return show(root, info, latest, openUrl, { remember: false });
    }
    if (navigator.onLine === false) return null;
    // A store keeps its own installs up to date: pointing at the download
    // page would only make a second install next to the first.
    if ((await appInfo()).store) return null;
    const last = Number(read(CHECKED_KEY)) || 0;
    const known = read(LATEST_KEY);
    if (!force && Date.now() - last < DAY) {
        // Checked today: the version found then is still worth showing.
        return known ? show(root, await appInfo(), known, openUrl) : null;
    }

    try {
        const info = await appInfo();
        const response = await fetchImpl(DOWNLOADS_URL, { headers: { Accept: 'application/json' }, cache: 'no-store' });
        if (!response.ok) return null;
        const latest = latestVersion(await response.json(), PLATFORMS[info.platform]);
        write(CHECKED_KEY, String(Date.now()));
        write(LATEST_KEY, latest ?? '');
        return latest ? show(root, info, latest, openUrl) : null;
    } catch {
        return null;
    }
}

/** '2.3.3' → '2.3.4' */
export function nextVersion(version) {
    const [major = 0, minor = 0, patch = 0] = String(version).split(/[.-]/).map((n) => parseInt(n, 10) || 0);
    return `${major}.${minor}.${patch + 1}`;
}

function show(root, info, latest, openUrl, { remember = true } = {}) {
    if (compareVersions(latest, info.version) <= 0 || (remember && read(DISMISSED_KEY) === latest)) return null;
    const wrapper = root.querySelector('#updateWrapper');
    const button = root.querySelector('#updateBtn');
    if (!wrapper || !button) return null;

    const label = translateOr('update.available', 'Version {version} available', { version: latest });
    button.querySelector('[data-update-text]').textContent = label;
    button.title = translateOr('update.hint', 'Download it from 8bitforge.com (you have {current})', { current: info.version });
    button.onclick = () => openUrl(siteUrl('download'));
    root.querySelector('#updateDismiss')?.addEventListener('click', () => {
        if (remember) write(DISMISSED_KEY, latest);
        wrapper.classList.replace('d-flex', 'd-none');
    }, { once: true });
    wrapper.classList.replace('d-none', 'd-flex');
    return latest;
}
