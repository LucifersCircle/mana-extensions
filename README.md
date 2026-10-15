# Pirate Vodka Extensions for Mana

This repository contains native Mana extensions for **VortexScans**, **MangaSushi**, **Kagane** and **ManhwaNex**.

Mana repository URL: `https://mana.pirate.vodka/sources.json`

The VortexScans implementation is a native Mana port of the Paperback VortexScans source
from [pirate.vodka extensions](https://github.com/LucifersCircle/pirate.vodka-extensions/tree/0.9/stable/src/VortexScans).

## VortexScans features

Version `0.0.1-alpha.6` follows the repository's shared alpha-version format.

- Dynamic discovery rows for Popular Today, Latest, New, every published
  collection, and Most Popular
- Search with the live VortexScans genre list, include/exclude genre selection,
  status, type, and sorting filters
- Manga, manhwa, and manhua metadata
- Free chapter discovery with locked chapters excluded
- Ordered webtoon pages from the VortexScans API, with an HTML fallback
- Cloudflare and vShield challenge detection through Mana's built-in resolution flow
- VortexScans deep-link handling and image request headers
- Popular Today uses source-published original covers from the same homepage,
  with the existing card image as fallback and no extra title requests.

## MangaSushi

[MangaSushi](https://mangasushi.org/) is a fresh native implementation, not a
Paperback converter. Version `0.0.1-alpha.5` includes:

- The site's finite **Popular Series** carousel and **What's New** feed, in source
  order. What's New uses the site's actual AJAX Load More query and continuation.
- All seven native search orders, live genre taxonomy with OR/AND matching,
  author, artist, release year, all five statuses and the site's adult selector.
- Full titles, alternative-title text, available authors/artists/status/genres,
  synopsis, asynchronous chapter lists, original chapter labels and decimals.
- Ordered lazy reader images, canonical series/chapter identity checks, duplicate
  and numbered-page-gap detection, source referer headers and series deep links.
- The site's square 192-pixel icon, and a fixed three-requests-per-second limit.

Covers use the largest valid same-asset image advertised by each source image,
including an explicitly listed full original, without extra metadata requests or
guessed URLs. An existing original is never downgraded. Discovery, search and
details deliberately share this largest-image policy, including large discovery
title displays; reader images and existing-cover fallbacks are unchanged.

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

## ManhwaNex

[ManhwaNex](https://manhwanex.com/) is a native Mana source, version `0.0.1-alpha.1`.
It preserves the site's **Popular Series** carousel and **Latest Updates** feed,
source order, real next-page links, English source titles and complete alternative
fields, staff, publication metadata and separately grouped source SEO tags (ten
per group, matching Mana’s persistence limit). Search exposes the eight native genres with OR/AND matching, author,
artist, release, all five statuses and adult filtering. Relevance is the only
advertised site sort. Native chapter lists preserve available chapters, decimal
numbers, labels and dates; any actual chapter pagination is traversed, not inferred
from the largest chapter number. Reader pages retain source order.

Covers use the largest valid rendition advertised in each existing response,
without guessed originals or per-card detail requests. Both discovery sections
share one homepage and one bounded canonical-ID metadata batch; caches are bounded
and setting-aware. Reader selection is independent of cover selection.

**Exclude NSFW content** is persistent and on by default. It requires native
non-adult membership and verified source genres, rejects explicit Adult, Mature,
Smut, Hentai, Erotica and Ecchi labels, and hides unknown classifications. BL/GL
and demographics are not adult labels by themselves. This guards search, discovery,
details, chapters, readers and previously issued image requests, including after
preference changes. The site has no verified graded age-rating taxonomy, so no
invented rating-category settings are shown. The conservative Mature app badge is
separate from adult exclusion; source labels cannot guarantee image content.

Source search has known upstream limitations: leading-numeric author names such as
`3rd Studio` redirect to the homepage and fail visibly instead of returning unrelated
results. Exact punctuation-heavy title searches can return unrelated source matches;
queries are not broadly rewritten. Some series publish only a recent available
chapter subset; missing older chapters are not invented or bypassed.

Source: [`src/sources/ManhwaNex`](src/sources/ManhwaNex).
Icon: [`assets/ManhwaNex.png`](assets/ManhwaNex.png), the site's published 192-pixel icon.

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

Last checked: **2026-10-15 05:16:57 UTC** · [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38685671176)
Started: 2026-10-15 05:14:03 UTC
Tested commit: `7f9b2b8`

| Extension | Result | Passed | Failed | Duration |
| --- | --- | ---: | ---: | ---: |
| Kagane | ✅ Pass | 25/25 | 0 | 35.53s |
| MangaSushi | ✅ Pass | 29/29 | 0 | 60.35s |
| ManhwaNex | ✅ Pass | 21/21 | 0 | 35.59s |
| VortexScans | ✅ Pass | 24/24 | 0 | 9.34s |

<details>
<summary>Test output</summary>

| Extension | Test | Result | Duration | Failure |
| --- | --- | --- | ---: | --- |
| Kagane | Built Mana bundle and source metadata | ✅ Pass | 0.02s | — |
| Kagane | Persistent rating selection defaults to Safe/Suggestive and verifies modern ratings | ✅ Pass | 7.38s | — |
| Kagane | Search pagination follows upstream completion, not the filtered result count | ✅ Pass | 0.64s | — |
| Kagane | Full title search, details, cover and series deep link retain identity | ✅ Pass | 1.97s | — |
| Kagane | English titles require explicit metadata and retain the original plus aliases | ✅ Pass | 0.00s | — |
| Kagane | Native search form preserves live taxonomy and grouped tag sheets | ✅ Pass | 0.06s | — |
| Kagane | Every native sort and exact-title mode makes a valid live request | ✅ Pass | 5.28s | — |
| Kagane | Include/exclude genres, grouped tags and typed tags use live IDs | ✅ Pass | 3.32s | — |
| Kagane | Format, status and uploader filters round-trip through the native request | ✅ Pass | 0.45s | — |
| Kagane | Negative search is an empty terminal page and invalid pages are rejected | ✅ Pass | 0.33s | — |
| Kagane | All six website discovery rows preserve order and native continuation | ✅ Pass | 0.00s | — |
| Kagane | A real 200-plus chapter list matches every live index ID exactly | ✅ Pass | 1.90s | — |
| Kagane | Repeated chapter/detail calls reuse bulk data instead of N-plus-one requests | ✅ Pass | 0.00s | — |
| Kagane | First and last actual chapter readers load image bytes with source headers | ✅ Pass | 2.08s | — |
| Kagane | Expired reader sessions refresh once per chapter and retain the actual page identity | ✅ Pass | 0.78s | — |
| Kagane | Data saver uses the supported query and still loads actual reader images | ✅ Pass | 2.93s | — |
| Kagane | Reader rejects a book from another series before requesting access | ✅ Pass | 1.02s | — |
| Kagane | Every rating category selects its exact modern class and an empty selection shows none | ✅ Pass | 3.81s | — |
| Kagane | Mixed rating selections and per-search or host limits cannot widen global choices | ✅ Pass | 1.10s | — |
| Kagane | Previously issued reader URLs cannot evade changed rating settings | ✅ Pass | 0.08s | — |
| Kagane | Setting persistence and explicit content exclusion apply even to title search | ✅ Pass | 1.58s | — |
| Kagane | Unknown and conflicting ratings fail closed for details, chapters and reading | ✅ Pass | 0.00s | — |
| Kagane | Changing safety preference invalidates an in-flight unfiltered response | ✅ Pass | 0.80s | — |
| Kagane | Malformed pagination and reader manifests are errors, not empty successes | ✅ Pass | 0.00s | — |
| Kagane | Test host permits only exact public Kagane operations and redacts reader tokens | ✅ Pass | 0.01s | — |
| MangaSushi | Built Mana bundle and source metadata | ✅ Pass | 0.02s | — |
| MangaSushi | Global NSFW exclusion defaults on and uses native adult=0 | ✅ Pass | 1.34s | — |
| MangaSushi | Native catalog pagination advances without using filtered counts | ✅ Pass | 0.51s | — |
| MangaSushi | Full title search and safe details retain the canonical identity | ✅ Pass | 0.81s | — |
| MangaSushi | English aliases retain canonical IDs, original titles and complete comma-containing alternatives | ✅ Pass | 5.42s | — |
| MangaSushi | Japanese-only alternatives retain the original title in search and details | ✅ Pass | 1.99s | — |
| MangaSushi | Cold metadata classification still queries the source original, not its English display alias | ✅ Pass | 1.16s | — |
| MangaSushi | Removing an English alias from live metadata restores the original search and detail display | ✅ Pass | 0.77s | — |
| MangaSushi | Search exposes live genres, all statuses, site fields and seven orders | ✅ Pass | 0.66s | — |
| MangaSushi | Every native search order returns live results | ✅ Pass | 5.51s | — |
| MangaSushi | Native OR and AND genre conditions and author/artist/year/status filters | ✅ Pass | 5.85s | — |
| MangaSushi | Negative search returns a genuinely empty terminal page | ✅ Pass | 0.76s | — |
| MangaSushi | Preference callback persists across instances and unfiltered catalog is usable | ✅ Pass | 3.74s | — |
| MangaSushi | Discovery mirrors both site rows exactly with no invented popular continuation | ✅ Pass | 2.32s | — |
| MangaSushi | Popular, latest, search and detail covers use the largest advertised same-asset images | ✅ Pass | 2.27s | — |
| MangaSushi | Cover fallbacks reject malformed or unrelated metadata and retain explicitly advertised originals | ✅ Pass | 1.38s | — |
| MangaSushi | Unfiltered discovery keeps English titles with two cold requests and zero warm requests | ✅ Pass | 1.01s | — |
| MangaSushi | Sample details, asynchronous chapters, decimals and original labels | ✅ Pass | 0.72s | — |
| MangaSushi | Multiple readers preserve ordered lazy images and image bytes | ✅ Pass | 0.70s | — |
| MangaSushi | Editorial notices never become reading content, even with exclusion off | ✅ Pass | 2.18s | — |
| MangaSushi | Reader rejects mismatched identity, duplicate URLs and numbered page gaps | ✅ Pass | 0.38s | — |
| MangaSushi | Changing the preference invalidates an in-flight unfiltered response | ✅ Pass | 1.06s | — |
| MangaSushi | Unknown classification is blocked and malformed search is not an empty success | ✅ Pass | 2.65s | — |
| MangaSushi | Re-enabling global exclusion blocks cached NSFW detail, chapters, reader and deep links | ✅ Pass | 2.12s | — |
| MangaSushi | Filtered discovery preserves rows and only returns verifiably safe titles | ✅ Pass | 10.69s | — |
| MangaSushi | Setting changes invalidate a pending discovery metadata batch | ✅ Pass | 2.63s | — |
| MangaSushi | Malformed discovery metadata fails visibly instead of trusting home titles | ✅ Pass | 0.27s | — |
| MangaSushi | Read-only host rejects duplicate AJAX actions before any request | ✅ Pass | 0.00s | — |
| MangaSushi | Repeated nonempty AJAX pages fail visibly instead of looping | ✅ Pass | 1.45s | — |
| ManhwaNex | Built Mana bundle and source metadata | ✅ Pass | 0.02s | — |
| ManhwaNex | Default-safe native discovery uses two cold requests and zero warm requests | ✅ Pass | 0.77s | — |
| ManhwaNex | Native home names, memberships, exact order and pagination are preserved | ✅ Pass | 0.75s | — |
| ManhwaNex | Largest source-advertised covers have real intrinsic image dimensions | ✅ Pass | 0.24s | — |
| ManhwaNex | Native safe search returns exact source page and next-page identities | ✅ Pass | 1.49s | — |
| ManhwaNex | Search form exposes only verified native taxonomy and Relevance sort | ✅ Pass | 0.40s | — |
| ManhwaNex | All eight native genre filters and OR/AND semantics are honored | ✅ Pass | 4.07s | — |
| ManhwaNex | Native author and artist text filters work while source redirects fail visibly | ✅ Pass | 0.99s | — |
| ManhwaNex | Every source status and release filter uses native parameters | ✅ Pass | 2.11s | — |
| ManhwaNex | Source titles, punctuation, aliases, canonical metadata and deep links survive cold details | ✅ Pass | 1.74s | — |
| ManhwaNex | Negative searches terminate honestly without repeating or inventing pages | ✅ Pass | 3.01s | — |
| ManhwaNex | All currently available chapters match the complete native AJAX list, including decimal identity | ✅ Pass | 0.32s | — |
| ManhwaNex | Native chapter pipeline preserves reported container and explicit-label volumes | ✅ Pass | 0.80s | — |
| ManhwaNex | Native oldest reader preserves image order and actual first/last bytes | ✅ Pass | 1.31s | — |
| ManhwaNex | Native newest reader preserves image order and actual first/last bytes | ✅ Pass | 0.87s | — |
| ManhwaNex | Native decimal reader preserves image order and actual first/last bytes | ✅ Pass | 0.93s | — |
| ManhwaNex | A second live title completes details, chapters, reader and both image endpoints | ✅ Pass | 1.12s | — |
| ManhwaNex | Explicit opt-out persists and per-search adult filtering cannot widen global exclusion | ✅ Pass | 2.08s | — |
| ManhwaNex | Unknown and explicit classifications fail closed without treating BL/demographics as adult labels | ✅ Pass | 12.19s | — |
| ManhwaNex | IDs, image origins and exact read-only POST routes reject unsafe inputs | ✅ Pass | 0.00s | — |
| ManhwaNex | Preference changes invalidate in-flight discovery and cannot repopulate stale caches | ✅ Pass | 0.39s | — |
| VortexScans | Built Mana bundle and source metadata | ✅ Pass | 0.02s | — |
| VortexScans | Catalog search returns usable highlights | ✅ Pass | 0.27s | — |
| VortexScans | Catalog pagination advances or explicitly ends | ✅ Pass | 0.20s | — |
| VortexScans | Title search finds a live catalog title | ✅ Pass | 0.19s | — |
| VortexScans | Live content details and cover image | ✅ Pass | 0.51s | — |
| VortexScans | Search form exposes live genres and sort options | ✅ Pass | 0.15s | — |
| VortexScans | Genre inclusion and exclusion affect live results | ✅ Pass | 1.02s | — |
| VortexScans | Home discovers all published sections | ✅ Pass | 0.26s | — |
| VortexScans | Home section: Popular Today (popular-today) | ✅ Pass | 0.63s | — |
| VortexScans | Home section: Latest (latest) | ✅ Pass | 0.57s | — |
| VortexScans | Home section: New (new) | ✅ Pass | 0.52s | — |
| VortexScans | Home section: For beginners (collection:for-beginners) | ✅ Pass | 0.14s | — |
| VortexScans | Home section: Top Picks (collection:top-picks) | ✅ Pass | 0.25s | — |
| VortexScans | Home section: Fantasy Worlds (collection:fantasy-worlds) | ✅ Pass | 0.24s | — |
| VortexScans | Home section: Marathon Reads (collection:marathon-reads) | ✅ Pass | 0.27s | — |
| VortexScans | Home section: Completed Series (collection:completed-series) | ✅ Pass | 0.25s | — |
| VortexScans | Home section: Most Popular (most-popular) | ✅ Pass | 0.49s | — |
| VortexScans | Popular Today uses source-published originals with one homepage request | ✅ Pass | 0.75s | — |
| VortexScans | Popular Today metadata is source-bound and missing or invalid originals retain card images | ✅ Pass | 1.46s | — |
| VortexScans | Search and detail retain source originals including octet-stream WebP bytes | ✅ Pass | 0.41s | — |
| VortexScans | Live chapter list has unique IDs and oldest-first order | ✅ Pass | 0.23s | — |
| VortexScans | Chapter pages are nonempty unique URLs | ✅ Pass | 0.24s | — |
| VortexScans | First and last chapter images load with source headers | ✅ Pass | 0.08s | — |
| VortexScans | Series deep link resolves the same live content | ✅ Pass | 0.18s | — |

</details>

<details>
<summary>Recent checks (last 24 runs)</summary>

| Checked (UTC) | Kagane | MangaSushi | ManhwaNex | VortexScans | Run |
| --- | --- | --- | --- | --- | --- |
| 2026-10-15 05:16:57 UTC | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38685671176) |
| 2026-10-15 04:52:33 UTC | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38683482227) |
| 2026-10-15 04:40:30 UTC | ✅ Pass | ✅ Pass | — Not tested | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38682488896) |
| 2026-10-15 04:09:40 UTC | ✅ Pass | ✅ Pass | — Not tested | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38679743880) |
| 2026-10-15 03:41:32 UTC | ✅ Pass | ✅ Pass | — Not tested | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38677366237) |
| 2026-10-15 02:58:19 UTC | ✅ Pass | ✅ Pass | — Not tested | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38673577217) |
| 2026-10-15 02:50:05 UTC | — Not tested | ✅ Pass | — Not tested | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38672948665) |
| 2026-10-15 02:29:06 UTC | — Not tested | ✅ Pass | — Not tested | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38671116181) |
| 2026-10-15 01:42:35 UTC | — Not tested | ✅ Pass | — Not tested | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38666999157) |
| 2026-10-15 00:40:42 UTC | — Not tested | — Not tested | — Not tested | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38661349571) |

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
