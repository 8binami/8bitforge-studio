# What the port still owes the original

An audit of `8bitforge.8binami.app` against this repository, run in September
2026 at commit `9018d34`. The original was read domain by domain, looking for
each behaviour in `src/`; a second pass tried to refute every claim
against the port's source. What follows is what survived, deduplicated, with the
original's line and the port's evidence for each.

It exists because the port was believed finished. It was not: the remaining-work
list had been kept by hand, so it recorded what someone remembered writing down.
`js/keyboard-shortcuts.js`: 311 lines, seventeen keys, four buttons whose
tooltips promised them: sat unported for the whole project without appearing on
any list.

Nothing here is a plan. It is an inventory, ordered by how much it costs the
person using the studio. What has since been done says so on its heading;
nothing is deleted, so the list stays readable against the commits that
closed it.

## How to read a line

Each entry names the original's file and line, then what the port has instead.
Where the port has something and it is wrong, that is a **bug** and comes first,
because a control that lies is worse than one that is visibly absent.

Out of scope throughout, and not listed: accounts, login, the admin surface,
licensing, guest mode, collaboration, sharing, the docs and news iframes, the
embeddable player, the API client and server sync. The studio is local-first and
those were never part of it.

---

## 1. Wrong behaviour

### 1.1 Touching any slider or select kills the keyboard: **done**, `src/ui/focus-release.js`

`js/app.js:849-862` installs two document-level handlers that blur an
`input[type=range]` 50 ms after a drag ends and a `<select>` 100 ms after a
choice. The comment says why: _"so keyboard resumes playing"_.

The port has no equivalent. `src/ui/keyboard-panel.js:456` (`_accepts`) and
`src/ui/shortcuts.js:32` (`TYPING`) both stand aside for `INPUT`, `TEXTAREA` and
`SELECT`: correctly, because typing is not a shortcut. But focus stays on the
control after the user lets go, so `document.activeElement` remains an input and
**every shortcut and the whole typed piano stay dead until the user clicks
somewhere else**. `app-shell.html` holds 45 range inputs and 63 selects.

### 1.2 The generator's note range produces NaN: **done**

The two register selects hold note names: `app-shell.html:1221-1235` has
`value="C5"` down to `value="C1"`. `src/ui/generator-panel.js:104-108` reads them
with `Number(min.value)`, which is `NaN`, and hands that to
`generator.setNoteRange`. `src/compose/generator.js:133-135` (`_clamp`) then
propagates it into every note's octave. Reading back is broken the same way:
`generator-panel.js:205-206` writes the numeric `octaveMin` into a select whose
values are note names, so both selects blank on every change event.

The original strips the letters (`parseInt(value.replace(/\D/g, ''))`) and orders
the pair with `Math.min`/`Math.max`: `js/app.js:3556-3570`. `setNoteRange` in
the port does not order them either.

### 1.3 The generator's phrase length is frozen at 8: **done**, and held by `tests/markup-ids.test.js`

`src/ui/generator-panel.js:28` binds `#phraseSelect`. The markup id is
`#phraseLengthSelect` (`app-shell.html:1187`). The select changes nothing, and
`phraseLength` keeps its default for every generation. The model side is intact.

### 1.4 Playing a note no longer arms the next step you click: **done**, `sequencer.rememberNote`

`src/sequencer/sequencer.js:127` reads `this.lastPlayedNote` to decide what a
switched-on cell holds, and `sequencer.js:84` declares it: but nothing in `src/`
ever writes it. In the original (`js/sequencer.js:113-118`, written from
`js/keyboard.js:450` and `js/virtual-keyboard.js:221,394`) this is how a melody
gets written: play D♯4, then click the steps you want it on. In the port every
clicked step takes the track default.

The three `KEYBOARD_EVENTS.noteOn` listeners that exist
(`visualizer-panel.js:72`, `recording.js:70`, `piano-roll.js:185`) all do
something else. The same silence is why the step note editor no longer follows
the keyboard.

### 1.5 Opening a project leaves the mixer sounding like the last one: **done**, `AudioEngine.applyMixerToAudio`

`src/studio.js:187-189` assigns `audioEngine.mixerSettings` and stops there. The
setters that write the live nodes (`src/audio/audio-engine.js:1092-1264`) are
called only from user input, and `resetMixerToDefaults` (`:1183`) is reachable
only from `resetToDefaults`, which no restore path calls. So after a load, the
faders, pans, EQ and compressors you hear are the previous project's.

The original pushes all of it: `js/storage.js:435` resets, then `:469-483` calls
`setTrackFaderVolume`, `setTrackPan`, three `setTrackEQ` and five
`setTrackCompressor*` per track.

Separately, the per-track compressor was hard-coded to pass-through when the
strip is built, so a saved compressor was never applied even on a fresh start,
and `mixer-panel.js` `sync()` never restored it to the widgets. **Both done**:
the strips are built bare and `applyMixerToAudio()` writes them, and `sync()`
reads the compressor back, units and all.

### 1.6 Reset is dead for any sound that did not come from the library: **done**, `instruments.revertTrack`

`src/ui/instrument-presets.js:192` shows Reset whenever the track is modified,
and `instrument-library.js:409` answers that from a fingerprint kept for every
source. But `revert()` (`instrument-presets.js:201-219`) handles only `builtin`
and `library`, and returns from the `else` branch with the comment _"there is
nothing to read it back from"_. Every kit slot and every voice loaded from a
project file is `custom` (`instrument-library.js:436-440`, `:497-500`), so the
button is visible and inert for them.

The original snapshots the whole preset state lazily on the first edit, whatever
its provenance (`js/app.js:5806-5818`), and restores it at `:5831-5844`. The port
keeps a fingerprint, which can answer _"has this changed?"_ but not _"change it
back"_.

### 1.7 The exported audio has no automation in it: **done**, `src/export/offline-automation.js`

`src/export/render.js:56-186` builds the master chain, the eight strips and the
notes, then renders. There is no automation pass: `grep -rni automation
src/export/` returns one comment. A filter sweep or a fader ride you drew is
simply not in the file.

The original schedules every lane onto the offline graph:
`js/export-engine.js:1130-1318` for the FX lanes (master filter, chorus, delay,
reverb, the five mastering EQ bands, the compressor, pitch bend, modulation) and
`:1321-1377` for the mixer lanes (per-track volume, pan, three EQ bands, four
compressor params, master volume), denormalising each breakpoint through its
`paramDef` and scheduling it at `breakpoint.step * stepDuration`. It also builds
the reverb impulse from the decay lane's first breakpoint
(`js/export-engine.js:1036-1042`) rather than the current widget value.

**Done** for every lane this studio can draw: the eight master-effects
parameters, the reverb tail, the two wheels, and the console's nine parameters
a track plus the master fader. The conversion comes from the automation module
itself rather than being written out a second time, so the export cannot drift
from playback.

**One piece is not done, and it is not the export's fault.** The original's
automation table also covers the mastering stage, twelve parameters:
`mastEqB0Freq` through `mastEqB4Freq`, three band gains, the mid Q, the
compressor's threshold, ratio, attack and release, and the makeup gain. This
studio's `src/automation/fx-automation.js` has eleven parameters and none of
them is a mastering one, so there is no lane to schedule. That is a gap in what
can be drawn, not in what is exported; when those lanes exist, they belong in
`MASTER_FX_TARGETS`' sibling in `src/export/offline-automation.js`, and the
test file next to it says what shape that takes.

### 1.8 Smaller ones

All ten are now done. Two things the work turned up, neither of them on the
list: the colour of the status badge was decided in the original by matching
English strings, which cannot work in the nine other languages the studio
ships in, so a caller now says what kind of thing happened rather than passing
text to be matched; and the sidebar's width clamp takes its minimum first, so a
narrow window cannot hand back a panel thinner than the stylesheet's own width
the original clamps the other way and does.

| What                                                                                                                   | Original                       | Port                                     |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------- |
| ~~The BPM field takes no wheel and no arrow keys, updates only on blur, and a non-digit sets `bpm` to `NaN`~~ **done** | `js/app.js` transport          | `src/ui/studio-view.js` `_bindTransport` |
| ~~The compressor knob readouts print the wrong numbers~~ **done**: each knob states its unit                           | `js/app.js` mixer console      | `src/ui/mixer-panel.js`                  |
| ~~The arrangement's `enabled` flag is not realigned with the active view after a load~~ **done**, `ViewTabs.realign`   | `js/app.js:2122`               | `src/studio.js`, `src/ui/views.js`       |
| ~~Resizing the right sidebar never updates `--asidebar-width`~~ **done**: the width and the variable move together     | `js/app.js`                    | `src/ui/settings-panel.js`               |
| ~~The legacy card-layout array is assigned as ids without mapping `item.id`~~ **done**, `migrateList`                  | `js/app.js:1270`               | `src/ui/cards.js:253`                    |
| ~~`VARY` / `FILL` / `THIN` / `THICK` rework one track where the original reworks all eight~~ **done**                  | `js/app.js` generator controls | `src/ui/generator-panel.js`              |
| ~~Double-clicking a fader to reset it is neither undoable nor saved~~ **done**                                         | `js/app.js`                    | `src/ui/mixer-panel.js`                  |
| ~~The export window keeps the previous run's progress bar and error text~~ **done**, cleared on `show.bs.modal`        | `js/app.js:4764`               | `src/ui/export-dialog.js`                |
| ~~The status badge never changes colour variant and loses its dot icon~~ **done**, `STATUS_TONES`                      | `js/app.js:3907`               | `src/ui/studio-view.js`                  |
| ~~Preset lists open in category order with a misleading Date arrow~~ **done**, `defaultSort`                           | `js/app.js:7816`               | `src/ui/preset-browser.js`               |

---

## 2. Controls that exist on screen and do nothing

The markup came across whole, so every one of these is visible, clickable and
inert. They are cheap, and each one is a small lie the interface tells.

**All eight are now done.** The MIDI setting turned out to be the one with a
decision in it: the browser's MIDI permission is a prompt, so one shared module
asks for it once, on a gesture, and both the keyboard and this menu go through
it. The menu also names the two ends the preference has: every input, and the
None the markup already offered.

| Control                                               | Markup                 | What it should do                                                                                                                                          | Original                            |
| ----------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| ~~**TAP** tempo~~ **done**                            | `app-shell.html:551`   | average the last 8 tap intervals into a BPM, reset after a 3 s gap                                                                                         | `js/app.js:397-422`                 |
| ~~**Zoom** `[-] [%] [+]`~~ **done**, `src/ui/zoom.js` | `:167`, `:170`, `:185` | set `body.style.zoom` 30-150 %, recompute `.content-page` height, persist, and auto-fit on touch in landscape                                              | `js/app.js:558-649`                 |
| ~~**Light / Dark**~~ **done**                         | `:209`                 | flip the Inverse theme, keep `#settingsTheme` in step, swap its own `ti-moon`/`ti-sun` icon                                                                | `js/app.js:1415-1425`, `:1621-1627` |
| ~~**Track highlight style** ×3~~ **done**             | `:287-296`             | switch `data-highlight-style` between `label-glow`, `side-bar`, `track-outline` and remember it, the CSS for all three is already in `studio.css:626-680` | `js/app.js:661-682`                 |
| ~~Sidebar **Sequencer** / **Arrangement**~~ **done**  | `:20`, `:26`           | switch view and track the active one; `studio-view.js:260` actively greys out every unclaimed `.side-nav-link`                                             | `js/app.js:740-758`, `:783-790`     |
| ~~**Copy seed**~~ **done**                            | generator panel        | put the seed on the clipboard: no clipboard code anywhere in `src/`                                                                                       | `js/app.js` generator               |
| ~~**MIDI Input** setting~~ **done**, `midi-access.js` | settings panel         | list the devices and honour the choice                                                                                                                     | `js/app.js:1293`                    |
| ~~Loop-ready hint~~ **done**                          | export window          | un-hide the explanation; the markup is there and not even i18n-wired                                                                                       | `js/app.js` export modal            |

---

## 3. Features not ported

- ~~**No keyboard inside the Studio window.**~~: **done**, and not as a
  second keyboard: reading the original through, it is the same instrument as
  the one on the card, so `KeyboardPanel` takes a skin and the second
  placement is a table of class names. `js/virtual-keyboard.js` (450 lines)
  is a second 65-key keyboard living in `#studioKeyboard`, shared by the Synth,
  Kits, Library and Piano Roll tabs, with its own PC mapping and AZERTY/QWERTY
  detection, its own octave frame, `enable()`/`disable()` that release held and
  arpeggiated notes, `setTrack()` driven by the piano-roll track picker, and
  two-way octave sync with the main keyboard (`js/app.js:5672-5708`). The port
  has the empty div (`app-shell.html:3102`) and nothing else: and because
  `keyboard-panel.js:458` stands down while any modal is open, the main keyboard
  is silent there too. Auditioning a preset, a kit slot or a synth edit means
  closing the window.
- **No metronome.** `js/app.js:2384-2422`: a sine click, 1000 Hz on the downbeat
  and 800 Hz elsewhere, on its own gain node bypassing the master so its volume
  is independent. Note that the original calls it from the display path at
  `currentTime` (`js/app.js:2180`), so it drifts behind the beat by the
  scheduler's lookahead; the port should schedule it at the step's audio time
  like every note. `#metronomeBtn` is hidden until then.
- ~~**No smooth playhead.** Two styled divs are never driven; position shows
  only as a stepped cell highlight.~~, **done**: `src/ui/playhead.js` drives
  both, from the bookings rather than from a clock of its own, so the bar
  follows swing and the chain without knowing what either is.
- **No multi-step selection or group drag** in the grid.
- ~~**Duplicate Pattern has lost its destination picker** and all its feedback,
  and is dead when no pattern is empty (`js/app.js:3699`).~~, **done**:
  `src/ui/pattern-picker.js` asks which of the eight to copy into, greys out
  the one being copied, says where it went, and works with all eight full.
- **Nothing reopens the last session.** Work in progress does not survive a
  reload, although `src/project/autosave.js` writes it.
- **Clear Pattern wipes without confirming.**
- **Stop and switching view leave the recorder armed.**
- ~~**Arpeggiator settings are in no project file and in no undo entry**~~:
  **done**: `arpeggiator` is in the payload, and `arpSettings` from a legacy
  file folds into it. Its pattern display still has no live playhead.
- **The seed actually used is never shown** after generating.
- **A fresh project loads no default kit.**
- **Kit browser**: _view presets in Library_ does not clear the filters already
  on, a kit's custom slots are dropped from the Library kit filter, and the kit
  track pickers lost their search.
- ~~**Preferences read but never acted on**: `sidebarAutoOpen` and the default
  BPM~~, **done**: the panel opens itself when asked, and a new project starts
  at the tempo the settings name.
- **The device gate is absent**: the overlay markup and its script, although the
  CSS and the i18n keys shipped.
- **Changing the measure count is not persisted.**

---

## 4. Files and storage

This is the part no code-to-code sweep can see, and it is where the real data
loss is.

### 4.1 A project saved by the live app loses its per-track effects: **done**, `migrations.js`

`js/storage.js:325-390` writes the payload field **`trackFx`**: an array of
eight `trackEffects.getTrackParams(i)` records. `src/studio.js:202` reads
`state.trackEffects`. Nothing reads `state.trackFx`, and
`src/project/migrations.js:70-95` maps only the ×0.60 volume step while promising
that unknown fields are preserved: preserved, never mapped.

So every `.8bitforge` file written by the live app silently loses its per-track
distortion, chorus, delay, reverb and bitcrusher on open, even though the port
implements all of them with the same key names inside each record. Only the
container's name differs. `docs/project-format.md:47` currently claims legacy
`1.x` files _"open and are upgraded"_, which is what makes this a bug rather than
a limitation to document.

The same three lines carry two more fields the port ignores:

- **`effects`**: the global filter/delay block the original restores at
  `js/storage.js:459-462`. **Nothing to do**: `setupEffectsControls`
  (`js/app.js:3312-3346`) wires `filterEnable`, `filterType`, `filterFreq`,
  `delayEnable`, `delayTime` and `delayFeedback`, and **none of those ids
  exists in `app.html`**. The controls were taken out of the original long
  ago and only the engine field and its saving remained, so every file
  written by the live app carries the defaults. The port keeps
  `audioEngine.effects` (`audio-engine.js:175`) and reads it on the note path
  (`:628`, `:644`) and in `offline-graph.js:104-154`, also always at its
  defaults: dead in both applications, and worth deleting from both rather
  than round-tripping.
- ~~**`trackCustomState`** and **`trackPresetNames`**~~, **done**: the two fold
  into one `trackPresets` array of records, and this build writes the sound
  each instrument arrived as beside its name, so Reset survives a reload and
  an undo. A legacy file has no such sound, so those records carry the flag
  instead and say so.

The other direction is fine and was checked: the original writes envelope
`version: '1.4.1'` and `format: '8bit-forge'`, which `parseProjectFile` accepts.
A port file will also load in the live app, since its importer
(`js/app.js:11378-11392`) checks only `format` and `data`: losing whatever the
port added. That is worth a deliberate decision rather than an accident.

### 4.2 localStorage continuity was decided per module, never as a whole

| Original                                                                                                                                                                                                                                                                                                | Port                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `8bitforge-settings`, `8bitforge-lang`, `8bitforge-viz-mode`, `8bitforge-card-layout`, `8bitforge-highlight-style`, `8bitforge-zoom`, `8bitforge-kit-favorites`, `8bitforge-project-favorites`, `8bitforge-gen-preset-favorites`, `8bitforge-project-covers`, `8bit-forge-autosave`, `8bit-forge-retro` | `8bitforge-preferences`, `8bitforge-theme`, `8bitforge-card-layout`, `8bitforge-visualizer-mode`, `8bitforge-favorites`, `8bitforge-language` |

Exactly one key is shared (`8bitforge-card-layout`) and that is precisely the
one whose migration is broken (§1.8). So the port half-commits: it reads the
original's card layout and ignores its language, visualizer mode, settings and
three favourites lists. Either drop the legacy branch in `cards.js` or add the
rest. `8bitforge-project-covers` has no counterpart at all: check whether
`cover-image.js` plus the envelope's `cover` field really replaces it for
projects carried over.

### 4.3 The save dialog, which nobody diffed

`js/app.js:4223-4487` fell between two audit ranges. Local behaviour in it that
`src/ui/save-project-dialog.js` should be checked against: saving a demo prefills
`"<name> (copy)"` and clears the id so it forks (`:4283-4296`); `shown.bs.modal`
focuses **and selects** the name field (`:4310`); Enter in the name field
confirms (`:4354`); an empty or whitespace name silently refuses (`:4325`); tags
are prefilled (`:4304`); Save As sanitises the filename with
`replace(/[^a-zA-Z0-9_\-\s]/g, '')` (`:4409`); the status reads `SAVED` and
returns to `READY` after 3 s (`:4344`).

`_importProjectFile` (`js/app.js:11378-11399`) refuses a file whose name does not
end in `.8bitforge` and a payload whose `format` is wrong, before touching the
sequencer, and stops and resets the sequencer before restoring. Worth confirming
`project-browser.js` does both.

### 4.4 Where errors go

The original raises 61 `ForgeModal.alert(...)` dialogs. The port has no alert
primitive: only `confirmAction` (`src/ui/confirm.js`), and routes failures to
the transport status line. That is a defensible rewrite with one hole: the status
line is in the topbar, **behind** the Studio window, so a failed instrument save,
kit save or preset duplicate reports somewhere the user cannot see. One decision,
not a gap per call site.

---

## 5. Verified clean: do not spend a session here

- **CSS.** `css/style.css` (4599 lines) and `css/premium-light.css` (5659) against
  the port's. Selectors, the six `@media` conditions, the thirteen `@keyframes`
  and the custom properties all line up. The 88 apparently missing `studio.css`
  selectors are per-track duplications the port collapsed onto `--forge-track-N`;
  the 18 missing `--bs-*` aliases moved to `theme-bridge.css`; the rest is
  `#forgeModal`, deleted on purpose.
- **Markup below the id level.** 175 shared inputs and selects compared on
  `type`, `min`, `max`, `step`, `value`, `maxlength` and `inputmode`: two
  differences, both out-of-scope URL fields. The option lists of all 63 selects
  are identical apart from `midiFormat` losing type 0, which was deliberate.
  `title`, `aria-label`, `data-i18n-title` and `tabindex` all match.
- **The dictionaries.** 751 keys, ten locales, none missing. The 69 keys the
  original has and the port does not are `rhythm.<genre>` and `preset.<name>`
  display names that nothing in the original ever read.
- **The content.** The original's 230 instrument ids are the 20 kits plus 210
  instruments, and those 210 match `library/instruments/**/*.json` exactly, both
  directions, across the same ten categories. 60 rhythms, 20 kits, 12 generator
  presets, 21 kit covers.
- **Files with nothing to port.** `js/offline-manager.js` is cloud sync
  end to end: and note it contains no `beforeunload` and no service worker, so
  there is no crash guard to bring across. `js/audio-exporter.js` is constructed
  once and never called again. `index.html` is a splash that redirects to login.
  `#retro-mode-toggle` (`js/app.js:652`) has no element in `app.html`: dead in
  the original, although the port carried all 51 `html.retro-mode` rules.

---

## 6. What the sweep itself did not cover

- `js/game-demos.js` was nobody's file. The content is out of scope; the
  machinery is not. `loadDemo` (`:746-797`) sets BPM **and step count**, clears
  all eight patterns, pads each into 32 steps and lands on pattern 0. The port's
  demo files carry `data` with `sequencer / tracks / envelopes / vibrato /
masterVolume` and no `arrangement` or `mixerSettings`. One pass should load all
  eight and assert pattern count, steps and BPM against `library/demos/index.json`.
  The original's seeder comments count five demos; the port ships eight.
- **Port-only modules no original-vs-port sweep can reach**: `src/platform/*`,
  the three storage backends, `src/storage/listing.js`,
  `src/project/project-session.js`, `item-dialog.js`, `save-project-dialog.js`,
  `edit-project-dialog.js`, `cover-image.js`, `library-categories.js`,
  `generator-genres.js`, `apps/desktop/*`. Several of §4 land exactly there.
- **A test-shaped blind spot.** The 43 test files cover the model layer
  thoroughly and there is no test for `studio-view.js`, `export-dialog.js`,
  `mixer-panel.js`, `cards.js`, `views.js`, `settings-panel.js`,
  `generator-panel.js`, `preset-browser.js` or `cell-editor.js`: and nearly
  every confirmed gap above lives in one of those nine files. That is not a
  coincidence, and it is the cheapest framing for the next passes: take one
  untested `src/ui/*.js`, diff it against its block of `app.js`, fix what the
  diff shows and leave a test behind.
