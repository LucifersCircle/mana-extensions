# Pirate Vodka Extensions for Mana

This repository contains native Mana extensions for **VortexScans** and **MangaSushi**.

Mana repository URL: `https://mana.pirate.vodka/sources.json`

The VortexScans implementation is a native Mana port of the Paperback VortexScans source
from [pirate.vodka extensions](https://github.com/LucifersCircle/pirate.vodka-extensions/tree/0.9/stable/src/VortexScans).

## VortexScans features

- Dynamic discovery rows for Popular Today, Latest, New, every published
  collection, and Most Popular
- Search with the live VortexScans genre list, include/exclude genre selection,
  status, type, and sorting filters
- Manga, manhwa, and manhua metadata
- Free chapter discovery with locked chapters excluded
- Ordered webtoon pages from the VortexScans API, with an HTML fallback
- Cloudflare and vShield challenge detection through Mana's built-in resolution flow
- VortexScans deep-link handling and image request headers

## MangaSushi

[MangaSushi](https://mangasushi.org/) is a fresh native implementation, not a
Paperback converter. Version `0.0.1-alpha.3` includes:

- The site's finite **Popular Series** carousel and **What's New** feed, in source
  order. What's New uses the site's actual AJAX Load More query and continuation.
- All seven native search orders, live genre taxonomy with OR/AND matching,
  author, artist, release year, all five statuses and the site's adult selector.
- Full titles, alternative-title text, available authors/artists/status/genres,
  synopsis, asynchronous chapter lists, original chapter labels and decimals.
- Ordered lazy reader images, canonical series/chapter identity checks, duplicate
  and numbered-page-gap detection, source referer headers and series deep links.
- The site's square 192-pixel icon, and a fixed three-requests-per-second limit.

Discovery shares its homepage response and page-sized native AJAX metadata batch
between concurrent sections rather than fetching classification one title at a time.
Short-lived, setting-keyed caches avoid repeat requests on warm loads. Original
homepage order, upstream continuation, explicit-tag exclusions and unknown-title
blocking are preserved; missing batch IDs retain the existing canonical search fallback.

**Exclude NSFW content** is a persistent global preference, enabled by default.
It combines the native `adult=0` filter with explicit Adult, Mature, Smut, Hentai,
Erotica and Ecchi tags. BL, Yuri and demographic genres are not adult classifications
by themselves. Discovery, continuation, search, details, chapters and reading use
the same setting; changing it clears setting-keyed caches and invalidates in-flight
responses. Unknown or unverifiable classifications are hidden, not assumed safe.
Site labels can be incomplete, so this cannot guarantee the content of every image.

MangaSushi omits some detail metadata, so canonical-ID-matched search rows supply
available genres and staff. Missing information is not invented. Consequently,
legitimate but unclassified titles can be hidden by default, including the tested
*Welcome to the Cheap Restaurant of Outcasts!* sample as of 2026-10-15. Disable the
preference to access such titles. Rows can be shorter or empty after exclusion;
no unrelated titles replace them, and continuation follows upstream results rather
than the filtered count. The two verified donation/recruitment notices are excluded
regardless of this preference because they are not reading content.

MangaSushi prefers audited English aliases only while the exact complete alias is
still present in current source metadata. Original titles and full alternative text
remain available, and canonical IDs do not change. Unverified or removed aliases
fall back to the original title; no translations or language guesses are generated.
Discovery reuses the native metadata batch for this in both content-setting modes,
without one request per title. Exact punctuation-sensitive full-title searches use
verified source-title fallbacks; ordinary partial searches are unchanged.

Source: [`src/sources/MangaSushi`](src/sources/MangaSushi).
Icon: [`assets/MangaSushi.png`](assets/MangaSushi.png), from the site's published icon.

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

Last checked: **2026-10-15 02:50:05 UTC** · [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38672948665)
Started: 2026-10-15 02:48:40 UTC
Tested commit: `a83e875`

| Extension | Result | Passed | Failed | Duration |
| --- | --- | ---: | ---: | ---: |
| MangaSushi | ✅ Pass | 27/27 | 0 | 64.87s |
| VortexScans | ✅ Pass | 21/21 | 0 | 6.83s |

<details>
<summary>Test output</summary>

| Extension | Test | Result | Duration | Failure |
| --- | --- | --- | ---: | --- |
| MangaSushi | Built Mana bundle and source metadata | ✅ Pass | 0.04s | — |
| MangaSushi | Global NSFW exclusion defaults on and uses native adult=0 | ✅ Pass | 1.41s | — |
| MangaSushi | Native catalog pagination advances without using filtered counts | ✅ Pass | 0.52s | — |
| MangaSushi | Full title search and safe details retain the canonical identity | ✅ Pass | 0.85s | — |
| MangaSushi | English aliases retain canonical IDs, original titles and complete comma-containing alternatives | ✅ Pass | 6.74s | — |
| MangaSushi | Japanese-only alternatives retain the original title in search and details | ✅ Pass | 1.60s | — |
| MangaSushi | Cold metadata classification still queries the source original, not its English display alias | ✅ Pass | 1.31s | — |
| MangaSushi | Removing an English alias from live metadata restores the original search and detail display | ✅ Pass | 1.01s | — |
| MangaSushi | Search exposes live genres, all statuses, site fields and seven orders | ✅ Pass | 0.60s | — |
| MangaSushi | Every native search order returns live results | ✅ Pass | 7.41s | — |
| MangaSushi | Native OR and AND genre conditions and author/artist/year/status filters | ✅ Pass | 6.76s | — |
| MangaSushi | Negative search returns a genuinely empty terminal page | ✅ Pass | 0.55s | — |
| MangaSushi | Preference callback persists across instances and unfiltered catalog is usable | ✅ Pass | 3.43s | — |
| MangaSushi | Discovery mirrors both site rows exactly with no invented popular continuation | ✅ Pass | 2.76s | — |
| MangaSushi | Unfiltered discovery keeps English titles with two cold requests and zero warm requests | ✅ Pass | 1.54s | — |
| MangaSushi | Sample details, asynchronous chapters, decimals and original labels | ✅ Pass | 1.15s | — |
| MangaSushi | Multiple readers preserve ordered lazy images and image bytes | ✅ Pass | 2.41s | — |
| MangaSushi | Editorial notices never become reading content, even with exclusion off | ✅ Pass | 2.78s | — |
| MangaSushi | Reader rejects mismatched identity, duplicate URLs and numbered page gaps | ✅ Pass | 0.37s | — |
| MangaSushi | Changing the preference invalidates an in-flight unfiltered response | ✅ Pass | 0.85s | — |
| MangaSushi | Unknown classification is blocked and malformed search is not an empty success | ✅ Pass | 2.99s | — |
| MangaSushi | Re-enabling global exclusion blocks cached NSFW detail, chapters, reader and deep links | ✅ Pass | 3.00s | — |
| MangaSushi | Filtered discovery preserves rows and only returns verifiably safe titles | ✅ Pass | 10.27s | — |
| MangaSushi | Setting changes invalidate a pending discovery metadata batch | ✅ Pass | 1.34s | — |
| MangaSushi | Malformed discovery metadata fails visibly instead of trusting home titles | ✅ Pass | 0.33s | — |
| MangaSushi | Read-only host rejects duplicate AJAX actions before any request | ✅ Pass | 0.00s | — |
| MangaSushi | Repeated nonempty AJAX pages fail visibly instead of looping | ✅ Pass | 2.84s | — |
| VortexScans | Built Mana bundle and source metadata | ✅ Pass | 0.04s | — |
| VortexScans | Catalog search returns usable highlights | ✅ Pass | 0.17s | — |
| VortexScans | Catalog pagination advances or explicitly ends | ✅ Pass | 0.27s | — |
| VortexScans | Title search finds a live catalog title | ✅ Pass | 0.20s | — |
| VortexScans | Live content details and cover image | ✅ Pass | 0.43s | — |
| VortexScans | Search form exposes live genres and sort options | ✅ Pass | 0.13s | — |
| VortexScans | Genre inclusion and exclusion affect live results | ✅ Pass | 1.01s | — |
| VortexScans | Home discovers all published sections | ✅ Pass | 0.24s | — |
| VortexScans | Home section: Popular Today (popular-today) | ✅ Pass | 0.87s | — |
| VortexScans | Home section: Latest (latest) | ✅ Pass | 0.48s | — |
| VortexScans | Home section: New (new) | ✅ Pass | 0.50s | — |
| VortexScans | Home section: For beginners (collection:for-beginners) | ✅ Pass | 0.25s | — |
| VortexScans | Home section: Top Picks (collection:top-picks) | ✅ Pass | 0.24s | — |
| VortexScans | Home section: Fantasy Worlds (collection:fantasy-worlds) | ✅ Pass | 0.25s | — |
| VortexScans | Home section: Marathon Reads (collection:marathon-reads) | ✅ Pass | 0.25s | — |
| VortexScans | Home section: Completed Series (collection:completed-series) | ✅ Pass | 0.25s | — |
| VortexScans | Home section: Most Popular (most-popular) | ✅ Pass | 0.50s | — |
| VortexScans | Live chapter list has unique IDs and oldest-first order | ✅ Pass | 0.25s | — |
| VortexScans | Chapter pages are nonempty unique URLs | ✅ Pass | 0.25s | — |
| VortexScans | First and last chapter images load with source headers | ✅ Pass | 0.12s | — |
| VortexScans | Series deep link resolves the same live content | ✅ Pass | 0.13s | — |

</details>

<details>
<summary>Recent checks (last 24 runs)</summary>

| Checked (UTC) | MangaSushi | VortexScans | Run |
| --- | --- | --- | --- |
| 2026-10-15 02:50:05 UTC | ✅ Pass | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38672948665) |
| 2026-10-15 02:29:06 UTC | ✅ Pass | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38671116181) |
| 2026-10-15 01:42:35 UTC | ✅ Pass | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38666999157) |
| 2026-10-15 00:40:42 UTC | — Not tested | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38661349571) |

</details>

<!-- LIVE_TEST_STATUS:END -->

### What these checks cover

The runner executes the actual `.mana` bundle built by `@mana-app/dev`, using a
small Node host adapter for Mana's network API and real website responses. It
checks catalog search and pagination, title search, genre inclusion/exclusion,
available filter/sort options, all published home sections, details, chapters, chapter-page URLs, cover/page image
responses and deep links. Request logs, individual assertions, counts, timestamps
and the tested commit are retained as workflow artifacts and in the run summary.
Missing, malformed or empty source reports are errors, never passing checks. Each
discovered source needs an explicit live contract; an unimplemented source fails
closed. MangaSushi additionally checks all native orders and filters, setting
persistence and in-flight invalidation, exact home order/continuation, explicit and
unknown exclusions, editorial notices, malformed markup and reader identity/page
integrity against freshly fetched live responses.

Mana's official [development CLI](https://github.com/Mana-iOS/mana-dev) provides
build/serve commands, not a dedicated live source test suite. Its build-time
emulator mocks HTTP, so it is not used for these live checks. This adapter is not
the iOS app: it does not validate UI rendering, persistent cookies/stores, WebViews
or interactive Cloudflare/vShield resolution. A challenge fails visibly rather
than being silently bypassed. New sources must support the exercised contract;
unsupported host APIs or incomplete suites fail closed and need explicit support.
The host supports only GET/HEAD plus MangaSushi’s two verified read-only AJAX
operations. Its small process-local ObjectStore exercises preference callbacks and
new source instances, not iOS persistence. No new offline fixtures or permanent
parser tests are added.

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

The VortexScans source is in [`src/sources/VortexScans`](src/sources/VortexScans) and its
icon is [`assets/VortexScans.png`](assets/VortexScans.png).

## Upstream behavior

The port follows the reworked
[Paperback VortexScans source](https://github.com/LucifersCircle/pirate.vodka-extensions/tree/0.9/stable/src/VortexScans),
while using the live VortexScans JSON detail and chapter endpoints where they
are more reliable than the upstream source's now-stale Astro page parser.

Licensed under [GPL-3.0-or-later](LICENSE).
