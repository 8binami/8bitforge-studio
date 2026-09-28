# The `.8bitforge` project format

A project file is a UTF-8 JSON document, written indented so it stays readable
and diffable in version control.

## Envelope

```json
{
  "format": "8bit-forge",
  "version": "2.0",
  "name": "My Track",
  "createdAt": "2026-09-17T10:00:00.000Z",
  "updatedAt": "2026-09-17T10:42:00.000Z",
  "category": "custom",
  "tags": ["chiptune", "uplifting"],
  "meta": { "composer": "", "genre": "", "year": 2026, "comment": "" },
  "cover": null,
  "data": { "...": "studio state" }
}
```

| Field       | Type            | Notes                                              |
| ----------- | --------------- | -------------------------------------------------- |
| `format`    | string          | always `8bit-forge`; anything else is rejected     |
| `version`   | string          | envelope version, currently `2.0`                  |
| `name`      | string          | project name, not necessarily the file name        |
| `createdAt` | ISO 8601 string | first save                                         |
| `updatedAt` | ISO 8601 string | last save                                          |
| `category`  | string          | free-form, `custom` by default                     |
| `tags`      | string[]        | may be empty                                       |
| `meta`      | object          | composer, genre, year, comment…                    |
| `cover`     | string \| null  | data URL of the cover image                        |
| `data`      | object          | studio state, owned by the audio/sequencer modules |

Everything a library listing needs is in the envelope, so a folder of projects
can be indexed without parsing payloads.

## Two version numbers

`version` describes the envelope. `data.version` describes the studio state.
They move independently: adding a field to the header does not invalidate a
payload, and vice versa.

## Compatibility

Files written by the legacy web app (envelope `1.x`) open and are upgraded on
read by `src/project/migrations.js`:

- `exportedAt` becomes `createdAt`, and `updatedAt` starts equal to it
- `category`, `tags`, `meta` and `cover` are filled with their defaults
- payloads at state version `1.1` or earlier get their oscillator volumes
  rescaled by ×0.60, matching the gain-staging change made in the web app
- `trackFx` becomes `trackEffects`, and `arpSettings` becomes `arpeggiator`.
  Each holds the same eight records field for field; only the name they are
  filed under differs
- `trackPresetNames` and `trackCustomState`, two arrays of eight read in step,
  become one `trackPresets` array of `{id, source, name, sound, modified}`. The
  legacy file has only a name, so `source` is `custom`: the sound came with
  the project and is in no library: and `sound` is null, because the legacy
  app never stored the sound a name refers to. `modified` is written only for
  a record with no `sound`: where there is one, the two are compared instead

The last two are renames, not defaults: a file that carries neither is left
saying nothing rather than given eight empty records, and a file that already
carries the new field keeps it.

A migration never throws and never drops a field it has not understood. A file
from a _newer_ build is refused with a clear message rather than opened
partially.

## Writing a migration

1. Bump `CURRENT_VERSION` in `src/project/format.js` (envelope) or
   `CURRENT_STATE_VERSION` in `src/project/migrations.js` (payload).
2. Add the upgrade step in `migrations.js`, guarded by a version comparison.
3. Add the previous version to `LEGACY_VERSIONS`.
4. Add a test in `tests/project-format.test.js` that opens a file written in
   the old shape and asserts the upgraded result.
