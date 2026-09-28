/**
 * Renderer entry point.
 *
 * Builds the studio and puts its screen on the page. The audio context waits
 * for the first press of Play, which is the user gesture browsers require.
 */

// Bootstrap's behaviour, from the package rather than from a vendor bundle.
//
// The theme used to bring its own copy: the same 5.3 release, inside a
// 670 KB file alongside three libraries this studio never calls. Taking it
// from npm means one version, chosen here, that the bundler can see.
//
// It is put on `window` because that is where the studio's windows look for
// it, and because the markup drives most of its own components through
// `data-bs-*` attributes rather than through our code.
import * as bootstrap from 'bootstrap';

window.bootstrap = bootstrap;

// Styles, in the order they have to land.
//
// Bootstrap's own stylesheet comes first, because everything after it is an
// opinion about what Bootstrap leaves plain. It comes from the package: the
// themed build that used to carry it is gone, and so is the file that had to
// rename its variables back on the way through.
import 'bootstrap/dist/css/bootstrap.css';

// The icon font the markup names on every button, from its own package.
// It is the same Tabler release the theme carried: one of two things in
// that 396 KB stylesheet, the other being a date picker nothing here opens.
import '@tabler/icons-webfont/dist/tabler-icons.css';
import '../assets/css/tabler-filled.css';

import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/700.css';
import '../assets/css/shell.css';
import '../assets/css/studio.css';
import '../assets/css/premium-light.css';
import '../assets/css/studio-view.css';

// The compressed formats, registering themselves. Importing this costs two
// URL strings; the thirty-two megabytes behind them travel the first time
// somebody exports an MP3, a FLAC or an OGG, and never otherwise.
import './export/ffmpeg-encoders.js';
import { listEncoders, encodeAudio } from './export/encoders.js';

import { bus } from './core/event-bus.js';
import { i18n } from './i18n/i18n.js';
import { getPlatform, isDesktop } from './platform/index.js';
import { Library } from './storage/library.js';
import { Favorites } from './storage/favorites.js';
import { ProjectSession } from './project/project-session.js';
import { Studio } from './studio.js';
import { Preferences } from './core/preferences.js';
import { Autosave } from './project/autosave.js';
import { StudioView } from './ui/studio-view.js';
import { ExportDialog } from './ui/export-dialog.js';
import { ThemeEngine } from './ui/theme-engine.js';
import { UNDO_EVENTS } from './core/undo-redo.js';
import { API_URL, isEnabled, setFeature } from './core/config.js';
import { Account, LINK_PARAM } from './account/account.js';
import { AccountApi } from './account/api.js';
import { AccountPanel } from './ui/account-panel.js';
import { ShareDialog } from './ui/share-dialog.js';
import { Community, SHARED_PARAM } from './account/community.js';
import { OnlinePanels } from './ui/online-panels.js';
import { checkForUpdate } from './platform/update-check.js';

i18n.init();

const platform = getPlatform();
const studio = new Studio({ bus });

const session = new ProjectSession({
    platform,
    bus,
    getState: () => studio.getProjectState(),
    setState: (state) => studio.applyProjectState(state)
});

const library = new Library(platform.createLibraryBackend(), { bus });
const favorites = new Favorites({ bus });
const themes = new ThemeEngine({ bus });
themes.init();

const preferences = new Preferences({ bus });

const mount = document.getElementById('app');

/**
 * The export window lives in `app-shell.html`, so it is bound after the
 * view has put the markup on the page.
 *
 * Its naming is read at export time rather than at startup: the template
 * is a setting the user can change, the project can be renamed or another
 * one opened, and the composer comes from whichever project is open. Read
 * once here, every exported file would carry whatever was true when the
 * application started.
 */
const exportDialog = new ExportDialog({
    root: mount,
    studio,
    platform,
    context: () => ({
        template: preferences.get('exportTemplate'),
        designer: session.meta?.composer || '',
        project: session.name
    })
});

const autosave = new Autosave({ session, library, studio, preferences, bus });
autosave.restart();

// Exporting, importing and the community, for every library window. Built
// before the view, since files need no account; the account is plugged in
// below when this build has one.
const community = new Community({
    library,
    platform,
    bus,
    language: () => i18n.language
});

const view = new StudioView({
    mount,
    studio,
    preferences,
    i18n,
    themes,
    session,
    library,
    favorites,
    community,
    dialogs: { export: exportDialog }
});
view.render();
community.onStatus = (text) => view._flash(text);
exportDialog.bind();

// The documentation and the news of the right sidebar, from 8bitforge.com.
new OnlinePanels({ root: mount, bus }).bind();

// The desktop app says when a newer version is out; the web studio is always
// the latest one. Later than the rest, so it never slows the start.
// VITE_SIMULATE_UPDATE (run.bat, "simulate an update") shows the notice with
// a made-up version, in development only: a release build never has it.
const simulatedUpdate = import.meta.env.DEV ? import.meta.env.VITE_SIMULATE_UPDATE || '' : '';
if (isDesktop()) {
    const appInfo = () => window.forgeDesktop.getAppInfo();
    setTimeout(() => checkForUpdate({ root: mount, appInfo, simulate: simulatedUpdate }), simulatedUpdate ? 1500 : 5000);
}

// The account, when this build has it: the hosted web studio, and the
// desktop app, which signs in with the code from the email since a link
// opens in a browser rather than here.
if (import.meta.env.VITE_ACCOUNT === '1' || isDesktop()) setFeature('account', true);
const arrivedWithLink = new URL(window.location.href).searchParams.has(LINK_PARAM);
if (arrivedWithLink) setFeature('account', true);

let account = null;
if (isEnabled('account')) {
    const api = new AccountApi({ baseUrl: API_URL });
    const flash = (text) => view._flash(text);
    account = new Account({ api, bus });

    const share = new ShareDialog({
        root: mount,
        account,
        library,
        onNeedsHandle: () => community.askForHandle(),
        onStatus: flash
    });
    share.bind();
    community.connect({ api, account, shareDialog: share });

    const accountPanel = new AccountPanel({
        root: mount,
        account,
        library,
        bus,
        // A link cannot open the desktop app: it brings people to the web
        // studio, and the app asks for the code instead.
        returnUrl: isDesktop() ? 'https://studio.8bitforge.com/' : window.location.origin + window.location.pathname,
        codeFirst: isDesktop(),
        dialogs: { share },
        community,
        onSignedIn: () => accountPanel.openLegacy({ onlyIfAny: true }),
        onStatus: flash
    });
    accountPanel.bind();
    startAccount(account, accountPanel);
}

// "Open in the studio" on 8bitforge.com arrives with the shared source's id.
// Nobody needs to be signed in to take it: it goes into the library, and a
// project is opened as well, since that is what the button promised.
const sharedId = new URL(window.location.href).searchParams.get(SHARED_PARAM);
if (sharedId && community.api) takeShared(sharedId);

async function takeShared(id) {
    const url = new URL(window.location.href);
    url.searchParams.delete(SHARED_PARAM);
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    try {
        const { kind, name, id: libraryId } = await community.take(id);
        view._flash(i18n.t('community.taken', { name }));
        if (kind === 'projects') {
            await view.projectBrowser?.load({ id: libraryId, source: 'library' });
        }
    } catch (error) {
        view._flash(`${i18n.t('library.importfailed')}: ${error.message}`);
    }
}

/**
 * Sign in from the link the page arrived with, or pick up the session an
 * earlier visit left. Neither calls the API for someone who never signed in.
 */
async function startAccount(account, panel) {
    const arrival = await account.consumeLink(window.location.href);
    if (arrival) {
        // Out of the address first: not in the history, not in a bookmark.
        window.history.replaceState(window.history.state, '', arrival.clean);
        if (arrival.signedIn) {
            view._flash(i18n.t('account.signedIn', { email: account.user.email }));
            await panel.openLegacy({ onlyIfAny: true });
            return;
        }
        // An old link, clicked by someone still signed in from before: they
        // stay signed in, and are not asked to do anything about it.
        if (account.hasStoredSession && (await account.resume())) {
            await panel.checkWaiting();
            return;
        }
        panel.openSignIn({ message: panel.linkErrorText(arrival.error), tone: 'bad' });
        return;
    }
    // A reload does not open the window again: the dot on the menu says
    // whether anything is still waiting.
    if (account.hasStoredSession && (await account.resume())) await panel.checkWaiting();
}

// What makes a project unsaved. Every action that changes something worth
// keeping records a snapshot, so the history is the one signal that already
// covers all of them; a loader clears the flag once it has seeded its own.
bus.on(UNDO_EVENTS.changed, ({ total }) => {
    if (total > 0) session.markDirty();
});

// Kept reachable for the console, and for the pieces still to be wired up.
Object.assign(window, {
    forge: {
        // What this build can write, and how. Worth having from the console:
        // a format missing from the Export window is a missing encoder, and
        // that is one question rather than an investigation.
        formats: { list: listEncoders, encode: encodeAudio },
        studio,
        session,
        library,
        favorites,
        themes,
        i18n,
        bus,
        view,
        preferences,
        autosave,
        account,
        community
    }
});
