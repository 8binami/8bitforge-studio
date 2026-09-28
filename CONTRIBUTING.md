# Contributing

Thanks for your interest. The project is in an early rewrite (see
[docs/roadmap.md](docs/roadmap.md)), so the shape of the code still moves
quickly. Issues and small focused pull requests are welcome; please open an
issue before starting anything large.

## Setup

```bash
npm install
npm run dev          # browser target
npm run dev:desktop  # Electron shell against the dev server
```

Node.js 20 or later.

## Before opening a pull request

```bash
npm run lint
npm test
npm run format
```

## Code conventions

- ES modules everywhere, no globals. If a module needs another one, it takes it
  as a constructor argument or imports it explicitly.
- Four spaces, single quotes, semicolons. Prettier settles the rest.
- `audio/`, `sequencer/` and `compose/` must not touch the DOM.
- Only `platform/` may branch on the runtime (Electron vs browser). Elsewhere,
  ask `platform.capabilities`.
- Only `storage/cloud/` may perform a network request, and only behind a
  feature flag.
- Comments explain _why_, not _what_. Skip the ones that restate the code.

## Tests

Unit tests live in `tests/` and run on Node through Vitest. Anything with real
logic, file format, migrations, music theory, the generator, export naming:
should come with tests. Audio rendering is tested through an offline audio
context rather than by listening.

## Commits

Short imperative subject, one logical change per commit:

```
project: reject files written by a newer build
```

## License

By contributing you agree that your work is released under the
[GNU AGPL-3.0-or-later](LICENSE), the licence this project uses.

There is no contributor licence agreement, and so no way to relicense the
project later without asking everyone who has contributed. That is the
intended effect.
