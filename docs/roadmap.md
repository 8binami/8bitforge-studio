# Roadmap

The studio is being rebuilt from the web app that runs at
`8bitforge.8binami.app`. That app works, but it is tied to a server: accounts,
licence tiers, an admin panel, a commercial UI theme and an obfuscated build.
This repository keeps the part that matters (the audio engine) and rebuilds
everything around it as a local-first application.

Phases land in order; each one leaves the repository in a working state.

## Phase 0: Bootstrap ✅

Repository, tooling, licence, the platform abstraction, the `.8bitforge` file
format with its migrations, the project session, and an Electron shell that
serves the renderer over `app://`. A temporary screen exercises the open/save
round trip on both targets.

## Phase 1: Audio core (in progress)

Port the engine to ES modules, unchanged in behaviour. No DOM, no globals:
dependencies are injected, and anything a view used to read is announced on the
event bus instead.

| Module          | State   | Notes                                                                          |
| --------------- | ------- | ------------------------------------------------------------------------------ |
| `audio-engine`  | done    | audio context and FX chains injected                                           |
| `synthesizer`   | done    | DOM writes replaced by `synth:changed` events                                  |
| `track-effects` | done    | worklet moved next to the module, URL resolved by the bundler                  |
| `master-fx`     | done    | audio half only; the wheels and XY pad are interface code                      |
| `mastering`     | done    | EQ and compressor; the spectrum canvas is interface code                       |
| `effects`       | dropped | dead code: a DOM wrapper whose audio calls were commented out                  |
| `sequencer`     | done    | playback and patterns; the grid, note editor and drag-and-drop stay for the UI |

Ported alongside them, for the modules the studio cannot work without:
`arrangement`, `automation` (XY pad), `arpeggiator`, `undo-redo`, `generator`.

Tests run on Node against a Web Audio double (`tests/helpers/fake-audio-context.js`)
that records the graph: which nodes exist, how they are connected, what was
automated. Rendered-audio comparison comes once the sequencer can play.

Two pieces of the generator did not come across: listing community presets,
which belongs to the optional cloud module (phase 6), and preset favourites,
which are a per-viewer preference rather than part of composition.

### Export

Underway alongside the audio core, because it decided what could be shipped:
the bundled FFmpeg build turned out to be GPL, so the studio encodes with
permissively licensed encoders instead. See [licensing.md](licensing.md).

| Piece                   | State | Notes                                              |
| ----------------------- | ----- | -------------------------------------------------- |
| WAV writer              | done  | 16, 24 and 32 bit                                  |
| File naming templates   | done  | PHP-style date letters, as the other tools use     |
| ZIP writer              | done  | stored entries; audio does not deflate usefully    |
| MIDI                    | done  | timing bug fixed on the way over                   |
| Offline render          | done  | the whole graph, rebuilt in an OfflineAudioContext |
| Encoder registry        | done  | a format is a module, not a branch                 |
| Export modes            | done  | full mix, stems, patterns; files out, saving apart |
| MP3, FLAC, OGG encoders | todo  | the libraries themselves, still to be chosen       |

## Phase 2: Local storage ✅

A managed library: projects, kits, presets and generator presets, kept between
sessions on the user's own machine.

| Piece                 | State | Notes                                                        |
| --------------------- | ----- | ------------------------------------------------------------ |
| Library               | done  | four operations over a backend; events per kind              |
| Desktop backend       | done  | a folder under Documents, one file per item                  |
| Web backend           | done  | IndexedDB, with a memory fallback when site data is blocked  |
| Searching and tagging | done  | a pure function over a listing; accents and case folded      |
| Import and export     | done  | a `.8bitforge` in, an item out; old files migrate on the way |

A backend says whether it persists, so the interface can call a scratch space
a scratch space rather than let someone believe their work is being kept.

### Translation

Ported alongside, because the interface needs it from its first component: ten
languages as flat JSON dictionaries, 751 keys each, all at parity. Three tests
per language keep them that way. The engine holds strings only; putting them on
the page is the interface's job.

## Phase 3: Interface

Rebuild the UI without the commercial theme: a plain Bootstrap layout and our
own CSS, `app.html` split into components. Same screens, same shortcuts.

## Phase 4: Studio wiring

Split the legacy `app.js` (about 12 600 lines) into the `ui/` and `core/`
modules it is made of. The largest piece of work in the rewrite.

Every panel and every window now has its module, but "every module exists" is
not "every behaviour arrived". [`port-audit.md`](port-audit.md) is the
line-by-line sweep of the original against this repository: what is still
missing, what is wired to nothing, and what the port gets wrong. Phase 4 closes
when that list does.

## Phase 5: Desktop polish

Native menus, `.8bitforge` file association, recent files, window state,
optional auto-update, packaging for Windows, macOS and Linux.

## Phase 6: Optional online features

The cloud module, off by default: sign in, browse and download resources shared
by other users, publish your own. Plus the export of the official kits and
presets into `content/` so they ship with the app.

## Phase 7: Release

Contribution guide, packaged builds, documentation, first public release.
