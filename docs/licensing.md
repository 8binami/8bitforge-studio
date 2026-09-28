# Licensing

The studio is **GNU AGPL-3.0-or-later**. Everything shipped with it has to be
compatible with that, which is not a formality: the app it grew out of bundles
code that cannot be redistributed at all.

It was MIT until 21 September 2026. The change is deliberate and it is not a
detail of paperwork: a studio anyone can host is a studio anyone can fork into
a service, and the Affero clause is the only one that asks a service to give
its changes back. Permissive was the right licence for a port that had not
been published; copyleft is the right one for a tool people will run for other
people.

What follows the change, and what it costs, is set out below. The short
version: everything the studio depends on is either permissive, which flows
into AGPL without friction: or GPL, which the AGPL was written to combine
with.

## What was removed from the original app

| Component               | Licence              | What happened                                          |
| ----------------------- | -------------------- | ------------------------------------------------------ |
| INSPINIA admin theme    | commercial, per-seat | not carried over; the UI is rebuilt on plain Bootstrap |
| Matomo analytics tag    | -                    | removed: a local-first app phones nobody               |
| JS obfuscation pipeline | -                    | removed: pointless in an open repository               |

## Audio export

The studio writes two formats itself and asks FFmpeg for the rest.

| Format | Encoder                      | Licence           |
| ------ | ---------------------------- | ----------------- |
| WAV    | written by the studio itself | AGPL-3.0-or-later |
| AIFF   | written by the studio itself | AGPL-3.0-or-later |
| MIDI   | written by the studio itself | AGPL-3.0-or-later |
| MP3    | FFmpeg (libmp3lame)          | GPL-2.0-or-later  |
| FLAC   | FFmpeg (libFLAC)             | GPL-2.0-or-later  |
| OGG    | FFmpeg (libvorbis)           | GPL-2.0-or-later  |

WAV and AIFF need nothing: both are uncompressed PCM, one in Microsoft's
container and one in Apple's, and between them they are about two hundred and
seventy lines in `src/export/`. Nothing is downloaded to write them, and a
build that could not reach the network still exports losslessly.

### Why FFmpeg is now the answer

[FFmpeg.wasm](https://ffmpegwasm.netlify.app/) compiled with `--enable-gpl`,
which is the build that carries the encoders worth having, is **GPL-2.0-or-
later**. Under MIT that was disqualifying: shipping it would have put the
distribution as a whole under the GPL, which is not what "MIT" on the tin
promises, and the earlier plan here was three small libraries chosen for
permissive licences instead.

The AGPL removes that objection rather than answering it. GPL-2.0-**or-later**
may be taken under GPL-3.0, and GPL-3.0 and AGPL-3.0 are written to be
combined: each licence names the other in its own section 13. The combined
work is distributed under the AGPL, which is where this project was going
anyway. One dependency replaces three, and every format the original app
offered comes back at once.

That is this project's reading of the licences, not legal advice. Anyone
redistributing a modified build should read sections 13 of both texts.

**What it obliges us to do.** The AGPL asks for the corresponding source of
the whole work, and FFmpeg is part of the whole work. The exact `@ffmpeg/core`
version is pinned in `package.json`, its source is published at
<https://github.com/ffmpegwasm/ffmpeg.wasm>, and `docs/` records which build
was used. Nothing here is a fork: we call it, we do not patch it.

**What it costs.** About 32 MB of wasm for four audio codecs. That is a great
deal of binary, so it is never part of the bundle: the core is fetched the
first time somebody exports a compressed format and cached after that. Anyone
who only ever exports WAV never downloads it, the desktop build ships it
alongside the app, and an offline browser that has not fetched it is told so
rather than left waiting.

## Interface

| Component      | Licence | Notes                                     |
| -------------- | ------- | ----------------------------------------- |
| Bootstrap 5    | MIT     | stock, not a themed build                 |
| Inter          | OFL-1.1 | bundled, via `@fontsource/inter`          |
| JetBrains Mono | OFL-1.1 | bundled, via `@fontsource/jetbrains-mono` |
| Tabler Icons   | MIT     |                                           |

**Fonts are bundled, never fetched.** The original stylesheet pulled Inter and
JetBrains Mono from `fonts.googleapis.com` on every load. That is not
local-first: it does not work offline, and it tells Google the IP address of
everyone who opens the studio. Both faces are open-licensed, so they ship with
the application instead.

No icon set that demands attribution inside the interface, and no webfont with
a licence that restricts redistribution.

## Contributed code

Contributions are accepted under the AGPL: see
[CONTRIBUTING.md](../CONTRIBUTING.md). There is no contributor licence
agreement, which means the project cannot be relicensed later without asking
every contributor. That is the intended effect and not an oversight.

Code from a GPL-3.0 or AGPL-3.0 project may be used here with its notices
kept. Code under a licence this one cannot absorb: anything proprietary, and
the permissive-with-conditions licences that add terms the AGPL does not carry
still may not: relicensing it is not ours to do.
