# Pirate Vodka Extensions for Mana

This repository contains native Mana extensions for **VortexScans**, **MangaSushi** and **Kagane**.

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

## Kagane

[Kagane](https://kagane.org/) is a native implementation on the repository's pinned
Mana toolchain. Version `0.0.1-alpha.1` includes:

- The six website discovery rows, all ten native search orders, exact-title mode,
  live genre/uploader taxonomy, format/status filters, and include/exclude matching.
- PoppingMango's grouped tag sheets, spelling/duplicate normalization, any/all tag
  matching, and typed tag names with optional `-` exclusions. Unknown tags retain an
  Other Tags group. Global hidden genres/tags and upload-source choices also guard
  direct reading; language choices filter browsing. Taxonomy and identical in-flight
  requests are reused.
- Full titles, alternate titles, available staff/status/genres, spoiler-tag control,
  source/edition display options, and original chapter-title mode.
- Current chapter index plus complete 200-item `before`-cursor traversal, checked
  for missing/repeated IDs and nonadvancing cursors. The removed `series_books`
  detail field is not required. Native resume indexes start with the earliest chapter.
- Chapter ownership/availability checks, ordered validated reader manifests, source
  image headers, normal public-reader token refresh, and supported data-saver URLs.
  Login, paid and unavailable chapters are not bypassed.

**Content ratings to show** is a persistent four-choice setting: Safe, Suggestive,
Erotica and Pornographic. Safe and Suggestive are selected by default; selecting
none shows none. Per-search choices can narrow, never expand, the global selection.
The setting applies to discovery, title searches, continuation, details, chapter
lists and reading. Changes invalidate setting-dependent caches and active results.

Kagane's API does not reliably enforce its legacy rating filter. The source therefore
maps the current `age_rating` and `is_pornographic` fields locally, distinguishes
Erotica from Pornographic, and rejects unknown or conflicting classifications.
BL/GL and demographic labels are not adult classifications by themselves. Site
labels can be incomplete, so a selected rating is not a guarantee about every image.
Filtered rows may be shorter; continuation follows the upstream response rather
than treating a short filtered page as the end.

An explicitly English-labeled title is preferred in detail metadata, with the original
and aliases retained. Bulk search alternatives currently have no language labels, and
many detail alternatives are labeled `unknown`; these are not guessed from their
script or translated language. Catalog rows are not expanded into per-title requests
just to infer an English title.

Source: [`src/sources/Kagane`](src/sources/Kagane).
GPL-3.0-or-later attribution and pinned upstream references are in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). Upstream repositories are unchanged.

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

Last checked: **2026-10-15 02:29:06 UTC** · [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38671116181)
Started: 2026-10-15 02:27:56 UTC
Tested commit: `cb72e2e`

| Extension | Result | Passed | Failed | Duration |
| --- | --- | ---: | ---: | ---: |
| MangaSushi | ✅ Pass | 22/22 | 0 | 46.65s |
| VortexScans | ✅ Pass | 21/21 | 0 | 7.59s |

<details>
<summary>Test output</summary>

| Extension | Test | Result | Duration | Failure |
| --- | --- | --- | ---: | --- |
| MangaSushi | Built Mana bundle and source metadata | ✅ Pass | 0.04s | — |
| MangaSushi | Global NSFW exclusion defaults on and uses native adult=0 | ✅ Pass | 1.70s | — |
| MangaSushi | Native catalog pagination advances without using filtered counts | ✅ Pass | 0.83s | — |
| MangaSushi | Full title search and safe details retain the canonical identity | ✅ Pass | 1.08s | — |
| MangaSushi | Search exposes live genres, all statuses, site fields and seven orders | ✅ Pass | 0.67s | — |
| MangaSushi | Every native search order returns live results | ✅ Pass | 4.34s | — |
| MangaSushi | Native OR and AND genre conditions and author/artist/year/status filters | ✅ Pass | 6.10s | — |
| MangaSushi | Negative search returns a genuinely empty terminal page | ✅ Pass | 1.04s | — |
| MangaSushi | Preference callback persists across instances and unfiltered catalog is usable | ✅ Pass | 3.85s | — |
| MangaSushi | Discovery mirrors both site rows exactly with no invented popular continuation | ✅ Pass | 1.17s | — |
| MangaSushi | Sample details, asynchronous chapters, decimals and original labels | ✅ Pass | 1.24s | — |
| MangaSushi | Multiple readers preserve ordered lazy images and image bytes | ✅ Pass | 3.34s | — |
| MangaSushi | Editorial notices never become reading content, even with exclusion off | ✅ Pass | 2.39s | — |
| MangaSushi | Reader rejects mismatched identity, duplicate URLs and numbered page gaps | ✅ Pass | 0.37s | — |
| MangaSushi | Changing the preference invalidates an in-flight unfiltered response | ✅ Pass | 0.74s | — |
| MangaSushi | Unknown classification is blocked and malformed search is not an empty success | ✅ Pass | 2.97s | — |
| MangaSushi | Re-enabling global exclusion blocks cached NSFW detail, chapters, reader and deep links | ✅ Pass | 1.88s | — |
| MangaSushi | Filtered discovery preserves rows and only returns verifiably safe titles | ✅ Pass | 10.02s | — |
| MangaSushi | Setting changes invalidate a pending discovery metadata batch | ✅ Pass | 0.96s | — |
| MangaSushi | Malformed discovery metadata fails visibly instead of trusting home titles | ✅ Pass | 0.36s | — |
| MangaSushi | Read-only host rejects duplicate AJAX actions before any request | ✅ Pass | 0.00s | — |
| MangaSushi | Repeated nonempty AJAX pages fail visibly instead of looping | ✅ Pass | 1.56s | — |
| VortexScans | Built Mana bundle and source metadata | ✅ Pass | 0.04s | — |
| VortexScans | Catalog search returns usable highlights | ✅ Pass | 0.52s | — |
| VortexScans | Catalog pagination advances or explicitly ends | ✅ Pass | 0.27s | — |
| VortexScans | Title search finds a live catalog title | ✅ Pass | 0.20s | — |
| VortexScans | Live content details and cover image | ✅ Pass | 0.31s | — |
| VortexScans | Search form exposes live genres and sort options | ✅ Pass | 0.20s | — |
| VortexScans | Genre inclusion and exclusion affect live results | ✅ Pass | 1.00s | — |
| VortexScans | Home discovers all published sections | ✅ Pass | 0.25s | — |
| VortexScans | Home section: Popular Today (popular-today) | ✅ Pass | 1.05s | — |
| VortexScans | Home section: Latest (latest) | ✅ Pass | 0.80s | — |
| VortexScans | Home section: New (new) | ✅ Pass | 0.46s | — |
| VortexScans | Home section: For beginners (collection:for-beginners) | ✅ Pass | 0.27s | — |
| VortexScans | Home section: Top Picks (collection:top-picks) | ✅ Pass | 0.22s | — |
| VortexScans | Home section: Fantasy Worlds (collection:fantasy-worlds) | ✅ Pass | 0.28s | — |
| VortexScans | Home section: Marathon Reads (collection:marathon-reads) | ✅ Pass | 0.22s | — |
| VortexScans | Home section: Completed Series (collection:completed-series) | ✅ Pass | 0.26s | — |
| VortexScans | Home section: Most Popular (most-popular) | ✅ Pass | 0.49s | — |
| VortexScans | Live chapter list has unique IDs and oldest-first order | ✅ Pass | 0.26s | — |
| VortexScans | Chapter pages are nonempty unique URLs | ✅ Pass | 0.24s | — |
| VortexScans | First and last chapter images load with source headers | ✅ Pass | 0.06s | — |
| VortexScans | Series deep link resolves the same live content | ✅ Pass | 0.20s | — |

</details>

<details>
<summary>Recent checks (last 24 runs)</summary>

| Checked (UTC) | MangaSushi | VortexScans | Run |
| --- | --- | --- | --- |
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
integrity against freshly fetched live responses. Kagane additionally checks all
four rating selections and an empty selection, grouped live tags and matching,
all ten orders and six rows, exact identity, a real 200-plus-chapter index/cursor
traversal, complete native chapter metadata, first/last chapter reader image bytes,
data saver, bulk request reuse, explicit English-title metadata, cross-series rejection
and setting invalidation.

Mana's official [development CLI](https://github.com/Mana-iOS/mana-dev) provides
build/serve commands, not a dedicated live source test suite. Its build-time
emulator mocks HTTP, so it is not used for these live checks. This adapter is not
the iOS app: it does not validate UI rendering, persistent cookies/stores, WebViews
or interactive Cloudflare/vShield resolution. CI explicitly opts into a test-only
Chromium transport for Kagane's exact public API routes and cover images, using an
anonymous, short-lived FlareSolverr session. JSON POST bodies and actual binary
image bytes are preserved. Warm-up waits for ordinary noninteractive managed
checks only: CAPTCHA controls are never clicked, and an explicit CAPTCHA or browser
security warning stops the test. TLS verification stays enabled. The native source
still uses Mana's built-in CloudflareError flow; no helper is bundled in extensions.
Without FLARESOLVERR_URL, local checks use ordinary direct requests and challenges
fail visibly. New sources must support the exercised contract; unsupported host
APIs or incomplete suites fail closed and need explicit support.
The host supports GET/HEAD, MangaSushi’s two verified read-only AJAX operations,
and Kagane’s exact public search, uploader-list and reader bootstrap/manifest POST
routes. Other POST operations fail closed. Ephemeral reader tokens are redacted
from retained logs; browser cookies, integrity tokens and reader responses are not
logged. Reader image requests, including kstatic.to, stay direct and their real
first/last image bytes are checked. Its small process-local ObjectStore exercises
preference callbacks and new source instances, not iOS persistence. No new offline fixtures or permanent
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

To use the same optional Kagane browser transport locally:

```sh
docker compose up -d --build --wait
FLARESOLVERR_URL=http://127.0.0.1:8191 npm run test:extensions
docker compose down
```

The helper port is bound only to 127.0.0.1. CI does not retain browser logs or
response bodies.

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
