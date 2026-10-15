# VortexScans for Mana

This repository contains one Mana extension: **VortexScans**.

Mana repository URL: `https://mana.pirate.vodka/sources.json`

The implementation is a native Mana port of the Paperback VortexScans source
from [pirate.vodka extensions](https://github.com/LucifersCircle/pirate.vodka-extensions/tree/0.9/stable/src/VortexScans).

## Features

- Dynamic discovery rows for Popular Today, Latest, New, every published
  collection, and Most Popular
- Search with the live VortexScans genre list, include/exclude genre selection,
  status, type, and sorting filters
- Manga, manhwa, and manhua metadata
- Free chapter discovery with locked chapters excluded
- Ordered webtoon pages from the VortexScans API, with an HTML fallback
- Cloudflare and vShield challenge detection through Mana's built-in resolution flow
- VortexScans deep-link handling and image request headers

## Live extension tests

[![Live Extension Tests](https://github.com/LucifersCircle/mana-extensions/actions/workflows/live-tests.yaml/badge.svg?branch=generic)](https://github.com/LucifersCircle/mana-extensions/actions/workflows/live-tests.yaml)

Every source entry point in `src/sources/*/index.ts` is discovered automatically.
The scheduled workflow runs twice an hour (at minutes 17 and 47), on relevant
`generic` pushes, pull requests, and manual dispatch. GitHub may delay schedules.
It runs the existing tests, typecheck, lint and native build before the live checks.
Only default-branch runs update this status and the last 24 runs in
[`reports/live-tests-history.json`](reports/live-tests-history.json). README/history
commits do not retrigger testing or publishing. Pull requests never publish sources.

<!-- LIVE_TEST_STATUS:START -->

Last checked: **2026-10-15 00:40:42 UTC** · [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38661349571)
Started: 2026-10-15 00:40:19 UTC
Tested commit: `498b904`

| Extension | Result | Passed | Failed | Duration |
| --- | --- | ---: | ---: | ---: |
| VortexScans | ✅ Pass | 21/21 | 0 | 7.08s |

<details>
<summary>Test output</summary>

| Extension | Test | Result | Duration | Failure |
| --- | --- | --- | ---: | --- |
| VortexScans | Built Mana bundle and source metadata | ✅ Pass | 0.04s | — |
| VortexScans | Catalog search returns usable highlights | ✅ Pass | 0.25s | — |
| VortexScans | Catalog pagination advances or explicitly ends | ✅ Pass | 0.23s | — |
| VortexScans | Title search finds a live catalog title | ✅ Pass | 0.19s | — |
| VortexScans | Live content details and cover image | ✅ Pass | 0.55s | — |
| VortexScans | Search form exposes live genres and sort options | ✅ Pass | 0.15s | — |
| VortexScans | Genre inclusion and exclusion affect live results | ✅ Pass | 1.00s | — |
| VortexScans | Home discovers all published sections | ✅ Pass | 0.24s | — |
| VortexScans | Home section: Popular Today (popular-today) | ✅ Pass | 0.91s | — |
| VortexScans | Home section: Latest (latest) | ✅ Pass | 0.57s | — |
| VortexScans | Home section: New (new) | ✅ Pass | 0.56s | — |
| VortexScans | Home section: For beginners (collection:for-beginners) | ✅ Pass | 0.17s | — |
| VortexScans | Home section: Top Picks (collection:top-picks) | ✅ Pass | 0.22s | — |
| VortexScans | Home section: Fantasy Worlds (collection:fantasy-worlds) | ✅ Pass | 0.25s | — |
| VortexScans | Home section: Marathon Reads (collection:marathon-reads) | ✅ Pass | 0.27s | — |
| VortexScans | Home section: Completed Series (collection:completed-series) | ✅ Pass | 0.24s | — |
| VortexScans | Home section: Most Popular (most-popular) | ✅ Pass | 0.49s | — |
| VortexScans | Live chapter list has unique IDs and oldest-first order | ✅ Pass | 0.27s | — |
| VortexScans | Chapter pages are nonempty unique URLs | ✅ Pass | 0.24s | — |
| VortexScans | First and last chapter images load with source headers | ✅ Pass | 0.06s | — |
| VortexScans | Series deep link resolves the same live content | ✅ Pass | 0.17s | — |

</details>

<details>
<summary>Recent checks (last 24 runs)</summary>

| Checked (UTC) | VortexScans | Run |
| --- | --- | --- |
| 2026-10-15 00:40:42 UTC | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38661349571) |

</details>

<!-- LIVE_TEST_STATUS:END -->

### What these checks cover

The runner executes the actual `.mana` bundle built by `@mana-app/dev`, using a
small Node host adapter for Mana's network API and real website responses. It
checks catalog search and pagination, title search, genre inclusion/exclusion,
available filter/sort options, all published home sections, details, chapters, chapter-page URLs, cover/page image
responses and deep links. Request logs, individual assertions, counts, timestamps
and the tested commit are retained as workflow artifacts and in the run summary.
Missing, malformed or empty source reports are errors, never passing checks.

Mana's official [development CLI](https://github.com/Mana-iOS/mana-dev) provides
build/serve commands, not a dedicated live source test suite. Its build-time
emulator mocks HTTP, so it is not used for these live checks. This adapter is not
the iOS app: it does not validate UI rendering, persistent cookies/stores, WebViews
or interactive Cloudflare/vShield resolution. A challenge fails visibly rather
than being silently bypassed. New sources must support the exercised contract;
unsupported host APIs or incomplete suites fail closed and need explicit support.
No new offline fixtures or permanent parser tests are added.

Run the same checks locally with Node 24:

```sh
npm ci
npm test
npm run typecheck
npm run lint
npm run build -- --output dist
npm run test:extensions
```

## Development

```sh
npm install
npm test
npm run typecheck
npm run prep
npm run serve
```

The test repository is then available at
`http://127.0.0.1:8080/sources.json`. Use `npm run dev` instead when you want
the server to restart automatically after TypeScript changes.

The source is in [`src/sources/VortexScans`](src/sources/VortexScans) and its
icon is [`assets/VortexScans.png`](assets/VortexScans.png).

## Upstream behavior

The port follows the reworked
[Paperback VortexScans source](https://github.com/LucifersCircle/pirate.vodka-extensions/tree/0.9/stable/src/VortexScans),
while using the live VortexScans JSON detail and chapter endpoints where they
are more reliable than the upstream source's now-stale Astro page parser.

Licensed under [GPL-3.0-or-later](LICENSE).
