# Pirate Vodka Extensions for Mana

This repository contains native Mana extensions for **VortexScans**, **MangaSushi**, **Kagane**, **ManhwaNex** and **Hijala**.

Mana repository URL: `https://mana.pirate.vodka/sources.json`

The VortexScans implementation is a native Mana port of the Paperback VortexScans source
from [pirate.vodka extensions](https://github.com/LucifersCircle/pirate.vodka-extensions/tree/0.9/stable/src/VortexScans).

## Native content-rating policy

The pinned native SDK supports Safe, Suggestive, Mature and Explicit item ratings.
Sources honor a supplied `SourceContext.allowedContentRatings` on search, Discover,
continuation and details. An empty list permits no titles; an omitted policy does
not silently imply Safe-only. Native context stays request-scoped, not a global
reader setting. Source catalogs remain `CatalogRating.MIXED`, a separate enum.

The SDK has no Unknown item rating. Missing or unreliable rating metadata uses
`ContentRating.MATURE` as an **app-compatibility fallback**, not a site-reported age
classification. Details include a single incomplete-metadata note; titles/cards
are not renamed. Known source rating evidence is preserved, including explicit
warnings. BL/GL, demographics and relationship tags alone do not imply sexuality.

Previously implicit source adult caps are no longer enabled for never-saved
preferences. Identifiable deliberate source selections remain extra filters.
Native preference hooks are advertised for four sources, but this does not prove
where an installed Mana app exposes their UI. Paid/access restrictions and explicit
content-type/genre filters remain independent. Source labels cannot guarantee the
content of every image.

## VortexScans features

Version `0.0.1-alpha.8` follows the repository's shared alpha-version format.

- Source-faithful Featured, Popular Today, Latest Releases, New, every published
  collection, and the rendered monthly Most Popular snapshot
- One shared homepage response preserves the site's row order; Latest continues
  with the site's 36-item feed, while Featured and monthly rankings stay bounded
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
Paperback converter. Version `0.0.1-alpha.8` includes:

- The site's finite **Popular Series** carousel and **What's New** feed, in source
  order. What's New uses the site's actual AJAX Load More query and continuation.
- All seven native search orders, live genre taxonomy with OR/AND matching,
  author, artist, release year, all five statuses and the site's adult selector.
  If the site ignores a requested genre filter, search reports that visibly rather
  than returning unrelated titles.
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
homepage order, upstream continuation and deliberately selected explicit-tag
exclusions are preserved; missing batch IDs retain the existing canonical search fallback.

**Exclude NSFW content** remains an optional persistent source preference. An
explicitly saved choice is honored, while an unset record follows native rating
policy without adding `adult=0`. A chosen exclusion combines the site's filter
with recognized Adult, Mature, Smut, Hentai, Erotica and Ecchi labels; it applies
to discovery, search, details, chapters and reading and invalidates stale work.

Canonical-ID-matched search rows supply genres/staff omitted by some details.
Missing rating information is not invented or silently classified Safe: it uses
the Mature fallback and a details note. Logical native pages skip excluded-only
or duplicate-only physical pages while retaining all eligible canonical IDs.
The verified donation/recruitment notices remain excluded as non-reading content.

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

[ManhwaNex](https://manhwanex.com/) is a native Mana source, version `0.0.1-alpha.4`.
It preserves the site's **Popular Series** carousel and **Latest Updates** feed,
source order, real next-page links, English source titles and complete alternative
fields, staff, publication metadata and separately grouped source SEO tags (ten
per group, matching Mana’s persistence limit). Search exposes the eight native genres with OR/AND matching, author,
artist, release, all five statuses and adult filtering. Relevance is the only
advertised site sort. Native chapter lists preserve available chapters, decimal
numbers, labels and dates; any actual chapter pagination is traversed, not inferred
from the largest chapter number. Reader pages retain source order.

Covers use the largest valid rendition advertised in each existing response,
without guessed originals or per-card detail requests. Popular Series and Latest
Updates share one homepage and one bounded canonical-ID metadata batch; caches
are bounded and setting-aware. Reader selection is independent of cover selection.

The eight genre archives linked from the homepage are separate Discover sections,
in the site's order. Each archive loads only when requested and uses bounded,
page-sized metadata batches. Native archive order and next-page links are preserved.
Repeated canonical IDs are omitted across a pagination chain, including
duplicate-only or excluded-only intermediate pages; distinct source entries
remain separate even when they share titles or artwork.

**Exclude NSFW content** is optional and persistent; a saved boolean remains
honored, while an unset preference imposes no extra adult cap. Native rating
policy is applied per request to the unfiltered cached metadata and continuation.
Known adult warnings stay authoritative across cached and in-flight work,
including previously issued image requests. The source has no verified graded
age taxonomy: its non-adult titles retain the conservative Mature app bucket,
adult warnings use Explicit, and incomplete metadata carries the fallback note.
No invented four-category source setting is added.

Source search has known upstream limitations: leading-numeric author names such as
`3rd Studio` redirect to the homepage and fail visibly instead of returning unrelated
results. Exact punctuation-heavy title searches can return unrelated source matches;
queries are not broadly rewritten. Some series publish only a recent available
chapter subset; missing older chapters are not invented or bypassed.

Source: [`src/sources/ManhwaNex`](src/sources/ManhwaNex).
Icon: [`assets/ManhwaNex.png`](assets/ManhwaNex.png), the site's published 192-pixel icon.

## Hijala

[Hijala](https://en-hijala.com/) is a native source, version `0.0.1-alpha.3`:

- Current Featured, Latest Releases, New, Most Popular and Latest Updates, in the
  site's published order. Latest/New use the verified current API continuation;
  Popular is the site's first nine ranked titles, not a substituted lifetime sort.
- All live genres in native search, six sorts, include/exclude genres, statuses,
  types, direction, chapter-count bounds and creation-date filters.
- Native request rating policy, optional genre-based source NSFW exclusion,
  and persistent paid-chapter hiding/content types/excluded genres/discovery rows.
  Old preference writes materialized an indistinguishable default exclusion;
  that legacy value no longer silently overrides native policy. Future deliberate
  source exclusions carry a version marker. Incomplete rating metadata uses the
  Mature fallback; explicit genre exclusions still fail closed when unverifiable.
  The site does not supply a reliable four-category age taxonomy.
- Source-provided full covers everywhere, original titles/aliases, complete
  source-count-validated chapter lists, native decimal numbers and public readers.
  Paid/login/protected content remains on the website.
- Bounded three-minute metadata caches reused across callbacks, and shared
  preference-write barriers.
  Current cold discovery uses five requests, including two complete catalog
  batches because the public API caps each at 100; warm discovery adds none.

Latest and New are separate native rows for the site's tabs.
Mana has series-only Highlights, so Latest Updates shows the latest visible
chapter per series. Genre browsing uses native search rather than fabricated
covered cards. Chapter links resolve to the series under the pinned native API.
The built-bundle checks exercise real 410-chapter/159-decimal data, a chapter 112.5
reader, image bytes, native rating policy, settings races and exact site continuation.

Source: [`src/sources/Hijala`](src/sources/Hijala). The bounded non-evaluating
TanStack/Seroval decoder and GPL attribution are recorded in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md); no converter or toolchain upgrade.





## Kagane

[Kagane](https://kagane.org/) is a native implementation on the repository's pinned
Mana toolchain. Version `0.0.1-alpha.2` includes:

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

**Content ratings to show** remains a persistent four-choice source preference:
Safe, Suggestive, Erotica and Pornographic. All are available when no selection
was saved; native rating policy determines request visibility. An explicitly
saved source selection remains an additional cap, and selecting none shows none.
Per-search source-rating choices narrow it. Changes invalidate setting-dependent
caches and active reader results.

Kagane's API does not reliably enforce legacy rating filters, so current
`age_rating`/`is_pornographic` evidence is classified locally. Erotica and
Pornographic remain distinct; positive explicit evidence cannot be downgraded by
incomplete/conflicting fields. Unclassified metadata uses the native Mature
fallback and details note rather than a hidden default exclusion. Native pages
retain cumulative canonical IDs and skip duplicate-only/filtered-out physical
pages to later eligible entries within bounded traversal.

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

Last checked: **2026-10-15 15:19:26 UTC** · [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38758018828)
Live scope: all; 5/5 sources selected; 5 complete reports. Non-PR events run the full live suite
Selected tests: 199/199 passed; 0 failed.
Started: 2026-10-15 15:10:52 UTC
Tested commit: `d5e7aa6`

| Extension | Result | Passed | Failed | Duration |
| --- | --- | ---: | ---: | ---: |
| Hijala | ✅ Pass | 55/55 | 0 | 136.07s |
| Kagane | ✅ Pass | 28/28 | 0 | 50.27s |
| MangaSushi | ✅ Pass | 40/40 | 0 | 93.62s |
| ManhwaNex | ✅ Pass | 38/38 | 0 | 158.32s |
| VortexScans | ✅ Pass | 38/38 | 0 | 30.41s |

<details>
<summary>Test output</summary>

| Extension | Test | Result | Duration | Failure |
| --- | --- | --- | ---: | --- |
| Hijala | Built Mana bundle and source metadata | ✅ Pass | 0.04s | — |
| Hijala | Native metadata and persistent defaults are honest about genre-based safety | ✅ Pass | 1.75s | — |
| Hijala | Search form exposes every live genre, eight statuses, five types and site filters | ✅ Pass | 0.66s | — |
| Hijala | Catalog is bulk-classified with no per-title detail requests | ✅ Pass | 1.26s | — |
| Hijala | Entire live native catalog has unique accumulated IDs, no lost returned titles and stable reset/repeats | ✅ Pass | 6.22s | — |
| Hijala | Title search and true empty search use source-published titles | ✅ Pass | 0.68s | — |
| Hijala | Every six native site sort orders returns usable live data | ✅ Pass | 3.90s | — |
| Hijala | Native submitted filters are exactly encoded and inclusion/exclusion works | ✅ Pass | 1.94s | — |
| Hijala | Native validation rejects invalid dates, huge integers and inverted ranges | ✅ Pass | 0.32s | — |
| Hijala | Empty native allowed-rating context returns none without network | ✅ Pass | 0.00s | — |
| Hijala | Actual source title, aliases, metadata, full cover and inline chapters agree | ✅ Pass | 2.48s | — |
| Hijala | Complete chapter list is reused, sequentially indexed and paid hidden by default | ✅ Pass | 0.23s | — |
| Hijala | Paid preference persists across instances without enabling paid reading | ✅ Pass | 4.71s | — |
| Hijala | Reader produces ordered native page objects and actual first/middle/last image bytes | ✅ Pass | 3.76s | — |
| Hijala | A second real public chapter reads actual image bytes too | ✅ Pass | 1.83s | — |
| Hijala | Source headers are attached to native metadata and image requests | ✅ Pass | 0.00s | — |
| Hijala | Every current native discovery section resolves without stale Hot or fabricated genre cards | ✅ Pass | 16.11s | — |
| Hijala | Source-disabled known release tabs disappear and stale links do not fetch them | ✅ Pass | 1.29s | — |
| Hijala | Latest and rendered first-nine Popular snapshots match fresh website DOM ordering | ✅ Pass | 3.01s | — |
| Hijala | Canonical New and latest listings match public feed evidence | ✅ Pass | 8.07s | — |
| Hijala | Highest-chapter-count safe title has a complete real large chapter list | ✅ Pass | 4.10s | — |
| Hijala | A genuine live decimal chapter retains its number and reads actual image bytes | ✅ Pass | 2.17s | — |
| Hijala | Deep links preserve encoded IDs and reader links safely resolve to native series | ✅ Pass | 1.63s | — |
| Hijala | NSFW preference persists, known mature titles are excluded end to end | ✅ Pass | 6.71s | — |
| Hijala | Empty types and sections stay empty and native excluded genres are enforced | ✅ Pass | 4.51s | — |
| Hijala | Concurrent native preference callbacks merge without losing fields | ✅ Pass | 1.28s | — |
| Hijala | A read begun during a queued safety save waits before using old permissive cached results | ✅ Pass | 6.17s | — |
| Hijala | Unknown genre metadata fails closed using a fresh live catalog response | ✅ Pass | 4.22s | — |
| Hijala | Partial genre metadata retains valid tags and never bypasses an explicit genre exclusion | ✅ Pass | 7.16s | — |
| Hijala | Native rating authority includes fallback metadata, isolates warm caches and preserves explicit choices | ✅ Pass | 10.61s | — |
| Hijala | Filtered-empty first page advances native continuation from the consumed API page | ✅ Pass | 2.41s | — |
| Hijala | Repeated API pages fail explicitly instead of looping or duplicating native pages | ✅ Pass | 1.87s | — |
| Hijala | Settings changed during a live page2 request reject its stale result | ✅ Pass | 3.32s | — |
| Hijala | Native decimal numbers and semantic chapter titles survive live-derived mutation | ✅ Pass | 1.00s | — |
| Hijala | Earliest paid chapter is filtered before assigning zero-based native indexes | ✅ Pass | 0.61s | — |
| Hijala | Incomplete total and missing access status reject real detail data | ✅ Pass | 1.20s | — |
| Hijala | Protected, mismatched and malformed readers are rejected from fresh live responses | ✅ Pass | 4.68s | — |
| Hijala | Expired native pagination and raw caches refresh instead of pinning Latest forever | ✅ Pass | 2.03s | — |
| Hijala | Ordinary forbidden responses do not become Cloudflare or cross an access boundary | ✅ Pass | 0.27s | — |
| Hijala | Verified challenge responses use the source resolution URL | ✅ Pass | 0.34s | — |
| Hijala | No downloaded script execution or cross-series/invalid chapter fallback occurs | ✅ Pass | 2.51s | — |
| Hijala | Pagination mutation seed is captured once from current public metadata | ✅ Pass | 1.77s | — |
| Hijala | Native Most Chapters accepts the current source response and complete terminal catalog shape | ✅ Pass | 0.66s | — |
| Hijala | Only a complete unique first-page catalog may exceed the requested page size | ✅ Pass | 0.36s | — |
| Hijala | Partial physical-page overlap emits every ID once beyond the nominal last offset | ✅ Pass | 0.31s | — |
| Hijala | Duplicate-only nonterminal physical page is skipped and later fresh rows are never lost | ✅ Pass | 0.25s | — |
| Hijala | Repeated pages, page1 reset and TTL refresh do not carry emitted-ID exclusions | ✅ Pass | 1.38s | — |
| Hijala | Changed query and sort keep independent native continuation and emitted-ID state | ✅ Pass | 0.85s | — |
| Hijala | Changed persistent settings reset continuation without hiding prior IDs | ✅ Pass | 0.94s | — |
| Hijala | Another Target toggling off/on cannot revive an old same-value cursor or raw snapshot | ✅ Pass | 0.62s | — |
| Hijala | Allowed-rating contexts isolate cumulative IDs even across locally filtered pages | ✅ Pass | 0.12s | — |
| Hijala | Changed total fails explicitly and page1 can reset the failed snapshot | ✅ Pass | 0.43s | — |
| Hijala | Missing titles after duplicates and endless repeated pages fail instead of claiming terminal completion | ✅ Pass | 0.27s | — |
| Hijala | Untrusted totals, page counts and cumulative-ID state fail before unbounded traversal or allocation | ✅ Pass | 0.44s | — |
| Hijala | Malformed internal continuation fails before reading an unconsumed provider offset | ✅ Pass | 0.61s | — |
| Kagane | Built Mana bundle and source metadata | ✅ Pass | 0.02s | — |
| Kagane | Never-saved source categories follow native policy and explicit source selection persists | ✅ Pass | 12.70s | — |
| Kagane | Search pagination follows upstream completion, not the filtered result count | ✅ Pass | 0.59s | — |
| Kagane | Full title search, details, cover and series deep link retain identity | ✅ Pass | 2.55s | — |
| Kagane | English titles require explicit metadata and retain the original plus aliases | ✅ Pass | 0.00s | — |
| Kagane | Native search form preserves live taxonomy and grouped tag sheets | ✅ Pass | 0.08s | — |
| Kagane | Every native sort and exact-title mode makes a valid live request | ✅ Pass | 7.03s | — |
| Kagane | Include/exclude genres, grouped tags and typed tags use live IDs | ✅ Pass | 4.04s | — |
| Kagane | Format, status and uploader filters round-trip through the native request | ✅ Pass | 0.84s | — |
| Kagane | Negative search is an empty terminal page and invalid pages are rejected | ✅ Pass | 0.45s | — |
| Kagane | All six native discovery sorts preserve live API order and continuation | ✅ Pass | 0.00s | — |
| Kagane | A real 200-plus chapter list matches every live index ID exactly | ✅ Pass | 2.44s | — |
| Kagane | Current live series translation and unknown language preserve native chapter identity | ✅ Pass | 0.09s | — |
| Kagane | Repeated chapter/detail calls reuse bulk data instead of N-plus-one requests | ✅ Pass | 0.00s | — |
| Kagane | First and last actual chapter readers load image bytes with source headers | ✅ Pass | 2.79s | — |
| Kagane | Expired reader sessions refresh once per chapter and retain the actual page identity | ✅ Pass | 1.24s | — |
| Kagane | Data saver uses the supported query and still loads actual reader images | ✅ Pass | 4.43s | — |
| Kagane | Reader rejects a book from another series before requesting access | ✅ Pass | 1.30s | — |
| Kagane | Every rating category selects its exact modern class and an empty selection shows none | ✅ Pass | 4.79s | — |
| Kagane | Mixed rating selections and per-search or host limits cannot widen global choices | ✅ Pass | 1.39s | — |
| Kagane | Previously issued reader URLs cannot evade changed rating settings | ✅ Pass | 0.13s | — |
| Kagane | Setting persistence and explicit content exclusion apply even to title search | ✅ Pass | 2.31s | — |
| Kagane | Unknown and conflicting ratings fail closed for details, chapters and reading | ✅ Pass | 0.00s | — |
| Kagane | Incomplete rating metadata uses native Mature fallback without overriding known explicit evidence | ✅ Pass | 0.13s | — |
| Kagane | Native rating policy and accumulated IDs survive partial overlap and duplicate-only physical pages | ✅ Pass | 0.12s | — |
| Kagane | Changing safety preference invalidates an in-flight unfiltered response | ✅ Pass | 0.77s | — |
| Kagane | Malformed pagination and reader manifests are errors, not empty successes | ✅ Pass | 0.00s | — |
| Kagane | Test host permits only exact public Kagane operations and redacts reader tokens | ✅ Pass | 0.01s | — |
| MangaSushi | Built Mana bundle and source metadata | ✅ Pass | 0.03s | — |
| MangaSushi | Native rating policy is authoritative with no never-saved source cap and reusable context-neutral caches | ✅ Pass | 2.54s | — |
| MangaSushi | Live native parsers map incomplete metadata to Mature and keep actual adult warnings Explicit | ✅ Pass | 4.45s | — |
| MangaSushi | Native singleton ratings use only verified coarse source markers and never infer a Suggestive taxonomy | ✅ Pass | 6.71s | — |
| MangaSushi | Warm native search pages retain a newly observed adult warning instead of relabeling it Safe | ✅ Pass | 1.39s | — |
| MangaSushi | Native logical pagination passes excluded-only physical pages without losing later eligible IDs | ✅ Pass | 1.84s | — |
| MangaSushi | Native logical pagination passes duplicate-only physical pages without losing later eligible IDs | ✅ Pass | 4.69s | — |
| MangaSushi | Ordinary genre search proves native Action/Romance taxonomy and preserves exact continuation without added requests | ✅ Pass | 2.91s | — |
| MangaSushi | Cooking ignored-filter response fails visibly after one request, never as unrelated or false empty results | ✅ Pass | 1.32s | — |
| MangaSushi | Genre proof rejects ambiguous query syntax, missing/wrong taxonomy, unknown terms and unrelated raw metadata | ✅ Pass | 2.21s | — |
| MangaSushi | OR/AND genre proof uses real raw memberships and accepts recognized genuine empty searches | ✅ Pass | 0.56s | — |
| MangaSushi | Continuation retains initial native genre scope and rejects ignored or altered taxonomy without scans | ✅ Pass | 0.24s | — |
| MangaSushi | Explicitly saved NSFW exclusion uses native adult=0 | ✅ Pass | 1.47s | — |
| MangaSushi | Native catalog pagination advances without using filtered counts | ✅ Pass | 0.84s | — |
| MangaSushi | Full title search and safe details retain the canonical identity | ✅ Pass | 0.87s | — |
| MangaSushi | English aliases retain canonical IDs, original titles and complete comma-containing alternatives | ✅ Pass | 6.42s | — |
| MangaSushi | Japanese-only alternatives retain the original title in search and details | ✅ Pass | 1.87s | — |
| MangaSushi | Cold metadata classification still queries the source original, not its English display alias | ✅ Pass | 0.96s | — |
| MangaSushi | Removing an English alias from live metadata restores the original search and detail display | ✅ Pass | 0.91s | — |
| MangaSushi | Search exposes live genres, all statuses, site fields and seven orders | ✅ Pass | 0.60s | — |
| MangaSushi | Every native search order returns live results | ✅ Pass | 5.07s | — |
| MangaSushi | Native OR and AND genre conditions and author/artist/year/status filters | ✅ Pass | 8.61s | — |
| MangaSushi | Negative search returns a genuinely empty terminal page | ✅ Pass | 0.60s | — |
| MangaSushi | Preference callback persists across instances and unfiltered catalog is usable | ✅ Pass | 3.86s | — |
| MangaSushi | Discovery mirrors both site rows exactly with no invented popular continuation | ✅ Pass | 2.23s | — |
| MangaSushi | Popular, latest, search and detail covers use the largest advertised same-asset images | ✅ Pass | 2.63s | — |
| MangaSushi | Cover fallbacks reject malformed or unrelated metadata and retain explicitly advertised originals | ✅ Pass | 2.21s | — |
| MangaSushi | Unfiltered discovery keeps English titles with two cold requests and zero warm requests | ✅ Pass | 1.25s | — |
| MangaSushi | Sample details, asynchronous chapters, decimals and original labels | ✅ Pass | 0.86s | — |
| MangaSushi | Multiple readers preserve ordered lazy images and image bytes | ✅ Pass | 2.16s | — |
| MangaSushi | Editorial notices never become reading content, even with exclusion off | ✅ Pass | 1.97s | — |
| MangaSushi | Reader rejects mismatched identity, duplicate URLs and numbered page gaps | ✅ Pass | 0.37s | — |
| MangaSushi | Changing the preference invalidates an in-flight unfiltered response | ✅ Pass | 0.88s | — |
| MangaSushi | Unknown classification is blocked and malformed search is not an empty success | ✅ Pass | 2.60s | — |
| MangaSushi | Re-enabling global exclusion blocks cached NSFW detail, chapters, reader and deep links | ✅ Pass | 2.08s | — |
| MangaSushi | Filtered discovery preserves rows and only returns verifiably safe titles | ✅ Pass | 10.41s | — |
| MangaSushi | Setting changes invalidate a pending discovery metadata batch | ✅ Pass | 1.23s | — |
| MangaSushi | Malformed discovery metadata fails visibly instead of trusting home titles | ✅ Pass | 0.34s | — |
| MangaSushi | Read-only host rejects duplicate AJAX actions before any request | ✅ Pass | 0.00s | — |
| MangaSushi | Repeated provider pages stop within ten consecutive no-new-raw-ID reads | ✅ Pass | 1.44s | — |
| ManhwaNex | Built Mana bundle and source metadata | ✅ Pass | 0.03s | — |
| ManhwaNex | Native rating authority defaults to no extra source cap and replays raw cached pages under changed contexts | ✅ Pass | 1.50s | — |
| ManhwaNex | Native details use supported Mature fallback only for incomplete metadata and retain positive adult warnings | ✅ Pass | 1.61s | — |
| ManhwaNex | Native singleton policy skips excluded-only physical pages and never caches a reader policy | ✅ Pass | 1.57s | — |
| ManhwaNex | Explicitly saved source exclusion uses two cold requests and zero warm requests | ✅ Pass | 0.70s | — |
| ManhwaNex | Native home names, memberships, exact order and pagination are preserved | ✅ Pass | 0.89s | — |
| ManhwaNex | Largest source-advertised covers have real intrinsic image dimensions | ✅ Pass | 0.45s | — |
| ManhwaNex | Native safe search returns exact source page and next-page identities | ✅ Pass | 2.08s | — |
| ManhwaNex | Search form exposes only verified native taxonomy and Relevance sort | ✅ Pass | 0.48s | — |
| ManhwaNex | Native Action archive stays lazy, ordered and complete in both safety modes | ✅ Pass | 11.45s | — |
| ManhwaNex | Native Romance archive stays lazy, ordered and complete in both safety modes | ✅ Pass | 1.83s | — |
| ManhwaNex | Native Fantasy archive stays lazy, ordered and complete in both safety modes | ✅ Pass | 11.04s | — |
| ManhwaNex | Native Martial Arts archive stays lazy, ordered and complete in both safety modes | ✅ Pass | 5.87s | — |
| ManhwaNex | Native Adventure archive stays lazy, ordered and complete in both safety modes | ✅ Pass | 3.30s | — |
| ManhwaNex | Native Ghost archive stays lazy, ordered and complete in both safety modes | ✅ Pass | 1.76s | — |
| ManhwaNex | Native Cultivation archive stays lazy, ordered and complete in both safety modes | ✅ Pass | 1.94s | — |
| ManhwaNex | Native System archive stays lazy, ordered and complete in both safety modes | ✅ Pass | 3.23s | — |
| ManhwaNex | Concurrent lazy archive requests coalesce the native page and bounded metadata batch | ✅ Pass | 1.01s | — |
| ManhwaNex | Distinct native canonical aliases retain both cards and their separate chapter inventories | ✅ Pass | 2.44s | — |
| ManhwaNex | Sequential native pages deduplicate real canonical overlap without losing later titles or terminal state | ✅ Pass | 21.73s | — |
| ManhwaNex | Pagination identity stays scoped to native query, category and current settings | ✅ Pass | 5.31s | — |
| ManhwaNex | Category continuation rejects foreign, switched, nonadvancing and wrong-context archives before following them | ✅ Pass | 5.25s | — |
| ManhwaNex | Raw archive adult evidence cannot be overwritten by complete safe batch metadata | ✅ Pass | 35.01s | — |
| ManhwaNex | All eight native genre filters and OR/AND semantics are honored | ✅ Pass | 5.19s | — |
| ManhwaNex | Native author and artist text filters work while source redirects fail visibly | ✅ Pass | 1.44s | — |
| ManhwaNex | Every source status and release filter uses native parameters | ✅ Pass | 2.64s | — |
| ManhwaNex | Source titles, punctuation, aliases, canonical metadata and deep links survive cold details | ✅ Pass | 2.19s | — |
| ManhwaNex | Negative searches terminate honestly without repeating or inventing pages | ✅ Pass | 4.86s | — |
| ManhwaNex | All currently available chapters match the complete native AJAX list, including decimal identity | ✅ Pass | 0.39s | — |
| ManhwaNex | Native chapter pipeline preserves reported container and explicit-label volumes | ✅ Pass | 0.85s | — |
| ManhwaNex | Native oldest reader preserves image order and actual first/last bytes | ✅ Pass | 1.44s | — |
| ManhwaNex | Native newest reader preserves image order and actual first/last bytes | ✅ Pass | 0.95s | — |
| ManhwaNex | Native decimal reader preserves image order and actual first/last bytes | ✅ Pass | 0.97s | — |
| ManhwaNex | A second live title completes details, chapters, reader and both image endpoints | ✅ Pass | 1.17s | — |
| ManhwaNex | Explicit opt-out persists and per-search adult filtering cannot widen global exclusion | ✅ Pass | 2.39s | — |
| ManhwaNex | Unknown and explicit classifications fail closed without treating BL/demographics as adult labels | ✅ Pass | 12.90s | — |
| ManhwaNex | IDs, image origins and exact read-only POST routes reject unsafe inputs | ✅ Pass | 0.00s | — |
| ManhwaNex | Preference changes invalidate in-flight discovery and cannot repopulate stale caches | ✅ Pass | 0.48s | — |
| VortexScans | Built Mana bundle and source metadata | ✅ Pass | 0.04s | — |
| VortexScans | Catalog search returns usable highlights | ✅ Pass | 0.64s | — |
| VortexScans | Catalog pagination advances or explicitly ends | ✅ Pass | 0.38s | — |
| VortexScans | Title search finds a live catalog title | ✅ Pass | 0.58s | — |
| VortexScans | Live content details and cover image | ✅ Pass | 1.03s | — |
| VortexScans | Search form exposes live genres and sort options | ✅ Pass | 0.97s | — |
| VortexScans | Genre inclusion and exclusion affect live results | ✅ Pass | 3.94s | — |
| VortexScans | Home discovers all published sections | ✅ Pass | 0.27s | — |
| VortexScans | Home section: Featured (featured) | ✅ Pass | 1.10s | — |
| VortexScans | Home section: Popular Today (popular-today) | ✅ Pass | 0.51s | — |
| VortexScans | Home section: Latest Releases (latest) | ✅ Pass | 0.00s | — |
| VortexScans | Home section: New (new) | ✅ Pass | 0.39s | — |
| VortexScans | Home section: For beginners (collection:for-beginners) | ✅ Pass | 0.51s | — |
| VortexScans | Home section: Top Picks (collection:top-picks) | ✅ Pass | 0.22s | — |
| VortexScans | Home section: Fantasy Worlds (collection:fantasy-worlds) | ✅ Pass | 0.26s | — |
| VortexScans | Home section: Marathon Reads (collection:marathon-reads) | ✅ Pass | 0.61s | — |
| VortexScans | Home section: Completed Series (collection:completed-series) | ✅ Pass | 0.29s | — |
| VortexScans | Home section: Most Popular (most-popular) | ✅ Pass | 0.00s | — |
| VortexScans | Popular Today uses source-published originals with one homepage request | ✅ Pass | 1.92s | — |
| VortexScans | Popular Today metadata is source-bound and missing or invalid originals retain card images | ✅ Pass | 5.48s | — |
| VortexScans | Search and detail retain source originals including octet-stream WebP bytes | ✅ Pass | 2.78s | — |
| VortexScans | Live chapter list has unique IDs and oldest-first order | ✅ Pass | 1.62s | — |
| VortexScans | Chapter pages are nonempty unique URLs | ✅ Pass | 0.70s | — |
| VortexScans | First and last chapter images load with source headers | ✅ Pass | 0.26s | — |
| VortexScans | Series deep link resolves the same live content | ✅ Pass | 0.28s | — |
| VortexScans | Native policy distinguishes no policy from empty and captures current public catalog once | ✅ Pass | 0.84s | — |
| VortexScans | Known source genres retain native classes and incomplete metadata uses Mature details fallback | ✅ Pass | 0.00s | — |
| VortexScans | Native concatenated pages survive partial overlap duplicate-only and rating-excluded physical pages | ✅ Pass | 0.01s | — |
| VortexScans | Discover and view-more retain exact native policy while sparse cards use supported fallback | ✅ Pass | 0.00s | — |
| VortexScans | All real home rows share one cold homepage and repeat without provider requests or N+1 | ✅ Pass | 2.30s | — |
| VortexScans | Featured Popular Today Latest Releases and monthly ranking match exact same-response website IDs order and originals | ✅ Pass | 0.03s | — |
| VortexScans | Bounded Featured Popular Today and monthly snapshots never advertise invented continuation | ✅ Pass | 0.00s | — |
| VortexScans | Latest View More starts at exact home36 then uses real native page2 with cumulative canonical IDs | ✅ Pass | 0.38s | — |
| VortexScans | Home36 continuation survives duplicate-only excluded-only overlap terminal pages and request-scoped policy | ✅ Pass | 0.00s | — |
| VortexScans | Same-response genre enrichment requires exact numeric ID and slug and retains positive warnings and Mature unknown fallback | ✅ Pass | 0.19s | — |
| VortexScans | Warm home snapshots rebind complete current native context and empty policy performs no provider work | ✅ Pass | 0.01s | — |
| VortexScans | Ambiguous or conflicting homepage ranking and changed release configuration fail visibly without alternate requests | ✅ Pass | 0.34s | — |
| VortexScans | Native detail to chapters to reader loads complete first and last image bodies with source headers | ✅ Pass | 1.51s | — |

</details>

<details>
<summary>Recent checks (last 24 runs)</summary>

| Checked (UTC) | Hijala | Kagane | MangaSushi | ManhwaNex | VortexScans | Run |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-10-15 15:19:26 UTC | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38758018828) |
| 2026-10-15 10:29:41 UTC | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38719746193) |
| 2026-10-15 08:34:59 UTC | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38705834816) |
| 2026-10-15 08:04:00 UTC | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38702080694) |
| 2026-10-15 07:57:10 UTC | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38701544623) |
| 2026-10-15 07:44:21 UTC | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38700007680) |
| 2026-10-15 07:22:33 UTC | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | ❌ Fail | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38697525684) |
| 2026-10-15 07:08:48 UTC | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38696076306) |
| 2026-10-15 06:18:04 UTC | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38690861264) |
| 2026-10-15 06:11:35 UTC | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38690556960) |
| 2026-10-15 05:38:05 UTC | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38687447021) |
| 2026-10-15 05:27:22 UTC | — Not tested | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38686593213) |
| 2026-10-15 05:21:38 UTC | — Not tested | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38686085446) |
| 2026-10-15 05:16:57 UTC | — Not tested | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38685671176) |
| 2026-10-15 04:52:33 UTC | — Not tested | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38683482227) |
| 2026-10-15 04:40:30 UTC | — Not tested | ✅ Pass | ✅ Pass | — Not tested | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38682488896) |
| 2026-10-15 04:09:40 UTC | — Not tested | ✅ Pass | ✅ Pass | — Not tested | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38679743880) |
| 2026-10-15 03:41:32 UTC | — Not tested | ✅ Pass | ✅ Pass | — Not tested | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38677366237) |
| 2026-10-15 02:58:19 UTC | — Not tested | ✅ Pass | ✅ Pass | — Not tested | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38673577217) |
| 2026-10-15 02:50:05 UTC | — Not tested | — Not tested | ✅ Pass | — Not tested | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38672948665) |
| 2026-10-15 02:29:06 UTC | — Not tested | — Not tested | ✅ Pass | — Not tested | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38671116181) |
| 2026-10-15 01:42:35 UTC | — Not tested | — Not tested | ✅ Pass | — Not tested | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38666999157) |
| 2026-10-15 00:40:42 UTC | — Not tested | — Not tested | — Not tested | — Not tested | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38661349571) |

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
