# 8BitForge Studio

Open-source chiptune and 8-bit music studio. Sequencer, synthesizer, effects,
mastering, arrangement, procedural generator and audio/MIDI export: running
entirely on your machine.

> **Status: early rewrite.** The studio is being rebuilt from the web app that
> powers [8bitforge.com](https://8bitforge.com). The plumbing (project format,
> platform layer, desktop shell) is in place; the audio engine is being ported
> module by module. Not usable for music yet.

## Principles

- **Local first.** Projects, kits and presets live on your disk. No account, no
  server, no network call at startup.
- **One codebase.** The same renderer runs in a browser and inside the desktop
  shell. Platform differences are isolated in `src/platform/`.
- **Online is optional.** Signing in, browsing resources shared by other users
  and publishing your own are feature flags, off by default.

## Requirements

- Node.js 20 or later

## Getting started

On Windows, `run.bat` does everything: it installs the dependencies on first
run, then offers a menu (web app, desktop app, build, tests, lint). It also
takes the mode as an argument, for example `run.bat desktop`.

Otherwise:

```bash
npm install
npm run dev
```

Then open the URL Vite prints (default `http://localhost:5173`).

To run the desktop shell against the dev server:

```bash
npm run dev:desktop
```

## Scripts

| Command                 | What it does                                          |
| ----------------------- | ----------------------------------------------------- |
| `npm run dev`           | Vite dev server for the browser target                |
| `npm run dev:desktop`   | Dev server + Electron shell pointed at it             |
| `npm run build`         | Build the renderer into `dist/web`                    |
| `npm run start:desktop` | Build, then run the packaged renderer in Electron     |
| `npm run build:desktop` | Build installers into `release/` via electron-builder |
| `npm test`              | Run the test suite                                    |
| `npm run lint`          | Lint the whole repository                             |
| `npm run format`        | Format with Prettier                                  |

## Layout

```
apps/desktop/   Electron shell: main process, preload bridge, packaging
src/            The studio (shared by web and desktop)
  core/         Event bus, configuration, feature flags
  platform/     File system and runtime abstraction, one file per target
  project/      .8bitforge file format, migrations, project session
  ui/           Interface
assets/         Styles, fonts, icons
tests/          Unit tests
docs/           Architecture and file format documentation
```

`docs/architecture.md` explains how the pieces fit together.

## Project files

Projects are JSON with a `.8bitforge` extension, readable and diffable. Files
written by the legacy web app (format 1.x) open and are upgraded automatically.
See `docs/project-format.md`.

## License

[GNU AGPL-3.0-or-later](LICENSE) © 8Binami

Use it, change it, share it. If you distribute a modified version you publish
your changes, and (this is what the Affero clause adds) **that includes
running one on a server people can reach**. A studio that anyone can host is
a studio anyone can fork into a service, and this is the licence that keeps
those forks open.
