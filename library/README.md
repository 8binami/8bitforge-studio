# The library

Everything 8BitForge Studio ships with, as files you can read.

Four hundred and six of them: instrument presets, kits, drum patterns,
generator settings, and seventy songs. They used to be JavaScript, buried in
modules thousands of lines long. Now each one is a file, so you can open it,
copy it, send it to someone, or add one of your own with a pull request:
without writing a line of code.

```
library/
  instruments/   232 sounds, in ten folders by what they are
  kits/           26 sets of eight instruments, one per track
  rhythms/        60 drum patterns, in five folders by style
  generators/     18 sets of generator settings
  demos/          70 songs, and the list the Load window draws from
  order.json       the order the studio shows them in
```

## The one idea worth knowing

**A file here is the same thing the studio writes when you save.** One
format, not two. Export a preset from the app and you get a file that could
be committed to this folder. Commit a file here and it is one the app could
have written. Importing, exporting and contributing are the same gesture.

**The filename is the id.** `instruments/leads/lead-classic.json` is
`lead-classic`. Nothing stores the id inside the file, so the two can never
disagree. Rename the file and you have renamed the preset.

## Adding one

Copy the nearest existing file, change what you want, and run:

```bash
npm run library:check
```

It reads every file and tells you what is wrong with each one: not the
first problem, all of them. Then `npm test`, which checks the same rules
plus the ones that need the audio engine.

The rules, in short:

- Lower-case filename, digits and hyphens: `warm-analogue.json`.
- The folder you put it in **is** its category, and the file must say the
  same: a file in `instruments/pads/` says `"category": "pads"`.
- **Write the name and description in English.** They are content and they
  live in your file, not in a dictionary. This is the one rule that is about
  people rather than code: the repository has one shared language, and a
  preset nobody can read the name of is a preset nobody loads. (The category
  labels _are_ translated, in `src/ui/library-categories.js`: but those are
  a closed set the studio owns, not something your file invents.)
- **Name it yourself.** A title that belongs to another record: a song
  from a game's soundtrack, a track off an album: points somewhere this
  repository cannot follow, whatever the music under it is. Three demos and
  two before them were renamed for this; the pieces kept their character and
  lost the borrowed name.
- Keep an instrument's `volume` between 0 and 0.5. Above that it is not
  louder, it is clipped, and it drags the whole mix down with it.

You do not have to touch `order.json`. Anything it does not name sorts after
everything it does, which is where a new preset belongs.

## A drum pattern

Written the way a drum machine writes one, `x` is a hit, `.` is silence:

```json
"base": {
  "kick":  "x...x...x...x...",
  "snare": "....x.......x...",
  "hihat": "x.x.x.x.x.x.x.x."
}
```

**The length of the row is the length of the pattern.** A sixteen-step
groove dropped into a thirty-two-step bar is repeated to fill it; one padded
out to thirty-two dots would play once and then go quiet. Write the groove,
not the silence after it.

All three lanes of a variant must be the same length, and that length is a
whole number of bars: 8, 16, 24 or 32. A lane with nothing in it is left
out rather than written as a row of dots.

`base` is required. `variation` and `fill` are optional; a pattern without
them falls back to its base.

## A kit

Eight tracks, each naming an instrument preset by its id:

```json
"tracks": [
  { "presetKey": "retro-nes-pulse", "presetType": "builtin" },
  …
]
```

Get one of those ids wrong and nothing crashes: the track simply keeps
whatever instrument was loaded before, with nothing on screen to say so.
That is why `npm run library:check` refuses a kit whose presets are not
here, and it is the single most useful thing it does.

## Where it goes at build time

Vite reads this folder at build time and inlines the presets into the
bundle. No network, no fetches, works offline, works the same in the browser
and in the desktop app. The demos are the exception: a song is sixty
kilobytes and only needed when somebody opens one, so each is its own chunk
and only the small list is loaded up front.

## Provenance

Everything here was written for 8BitForge and carries the repository's
licence, the AGPL-3.0. If you contribute a preset you are licensing it the
same way.

Do not copy presets out of another product. A preset is a handful of
numbers and it is tempting to think of them as facts; the arrangement of
them is someone's work.
