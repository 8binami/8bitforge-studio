# Architecture

## One renderer, two shells

The studio is a single ES module application. It is built once by Vite into
`dist/web`, and that same bundle is what both targets run:

| Target  | How it is served                                  | File access                                               |
| ------- | ------------------------------------------------- | --------------------------------------------------------- |
| Web     | static files over HTTP                            | File System Access API, download fallback                 |
| Desktop | Electron main process, `app://` privileged scheme | real files through IPC, dialogs owned by the main process |

`file://` is deliberately not used on the desktop: an opaque origin breaks ES
modules and AudioWorklet, and cannot carry the COOP/COEP headers that
SharedArrayBuffer needs for audio export. `app://studio/…` is registered as a
standard, secure scheme and answers with those headers.

## Dependency direction

```
        ui/  ──────────────┐
                           ▼
 compose/ ── sequencer/ ── audio/ ── core/
                 │            │
              project/ ─── storage/ ── platform/
```

Rules that keep the graph one-way:

- `core/` depends on nothing. It holds the event bus, configuration and
  feature flags.
- `audio/`, `sequencer/` and `compose/` never touch the DOM. They are testable
  in Node with an offline audio context.
- `ui/` may read from any module, but talks back only through method calls on
  the objects it was given, or by emitting events on the bus.
- `platform/` is the only module allowed to know whether it is running in
  Electron or in a browser. Nothing else branches on the runtime.
- Nothing outside `storage/cloud/` performs a network request.

## The platform layer

`src/platform/index.js` picks an implementation at startup:

- `desktop.js`: calls `window.forgeDesktop`, the bridge exposed by the preload
  script. The renderer never gets Node APIs.
- `web.js`: File System Access API when available, otherwise a file input to
  open and a download to save.

Both satisfy the same interface, and both report what they can do through
`capabilities`. The UI asks the capability, it does not ask the platform name:

```js
const platform = getPlatform();
if (platform.capabilities.overwriteInPlace) {
  // show a "Save" button next to "Save as…"
}
```

Adding a target (a Tauri shell, a mobile wrapper) is one new file here.

## Desktop security model

The Electron shell follows the defaults Electron recommends, and adds one rule:

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- the preload exposes named operations only, never a generic evaluation channel
- the main process keeps a set of paths the user picked in a dialog during this
  session, and refuses to write anywhere else
- `app://` refuses any path that resolves outside `dist/web`
- external links open in the user's browser; in-app navigation away from the
  app origin is blocked

## Local first, cloud optional

Nothing contacts a server unless a feature flag in `src/core/config.js` is
turned on: `account`, `community`, `publishing`, `collaboration`. All
default to `false`.

Resources (kits, presets, projects) are read through one interface with several
sources:

| Source      | Where it lives                | Always available  |
| ----------- | ----------------------------- | ----------------- |
| `builtin`   | `content/` in this repository | yes               |
| `user`      | the user's disk               | yes               |
| `community` | the 8BitForge API             | only when enabled |

The UI lists whichever sources are present. With every flag off, the studio is
a complete offline application.

### The account

`account` is the one flag a build turns on: `npm run build:hosted` (mode
`hosted`, `.env.hosted`) is what is served at `studio.8bitforge.com`, and the
desktop app has it too. Both offer **Community** and **Sign in** in the
topbar. Arriving by a sign-in link turns it on for that visit. Anyone's own
web build leaves it off, and the topbar shows nothing.

The email carries a link and a six-digit code. The web studio takes either;
the desktop app, where a link cannot come back, asks for the code.

On, it still calls nothing until someone signs in. Signing in is by emailed
link only (`src/account/`): the API at `api.8bitforge.com` sends it, the link
opens the studio with `?magic_token=`, which is taken out of the address before
anything else and exchanged for a session. The access token lives in memory,
the refresh token in `localStorage`, spent on every use and never refreshed
twice at once: the API ends every session of an account that reuses one.

Signed in, people choose a handle: their profile's address,
`8bitforge.com/{handle}`: and share projects, instruments, kits and
generator presets from their library under CC BY 4.0 or CC0. The Community
window lists what everyone shared and needs no account to browse or take;
taking goes through the library's own import.

Signed in, the studio also offers what the old site kept for that account
(`GET /v1/me/legacy`): projects, instruments, kits and generator presets, each
imported through the library's own import, migrations and all, and only then
removed from the server. `VITE_API_URL` points a build at another API.

## Project files

A project is a JSON document with a stable envelope and an opaque payload: see
[project-format.md](project-format.md). `ProjectSession` owns which project is
open, whether it is dirty, and where it came from; it delegates the bytes to
`project/format.js` and the file system to the platform.
