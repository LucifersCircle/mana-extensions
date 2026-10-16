# Pirate Vodka Extensions for Mana

Native extensions for Mana, with source-specific Discover, search, details,
chapters and readers. Available features depend on each website.

## Live extension tests

[![Live Extension Tests](https://github.com/LucifersCircle/mana-extensions/actions/workflows/live-tests.yaml/badge.svg?branch=generic)](https://github.com/LucifersCircle/mana-extensions/actions/workflows/live-tests.yaml)

Every source entry point in `src/sources/*/index.ts` is discovered automatically.
Full live sweeps run twice an hour (at minutes 17 and 47 UTC), and on manual
dispatch. GitHub may delay schedules. Pull requests run live checks for affected
sources; shared or uncertain changes require the full live suite. Merges do not
start another live run. Full offline tests, typecheck, lint and native builds
still run on pull requests and relevant `generic` pushes; publication remains
independent of live sweeps.
Only scheduled and manual full runs on the default branch update this status and
the last 24 runs in [`reports/live-tests-history.json`](reports/live-tests-history.json).
This is the last full sweep at its recorded tested commit, not a pass for newer
commits. PR results remain in job summaries and artifacts, with unselected sources
explicitly identified. README/history commits do not retrigger testing or
publishing. Pull requests never publish sources.

<!-- LIVE_TEST_STATUS:START -->

Last checked: **2026-10-16 15:44:07 UTC** · [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38925226294)
Live scope: all; 6/6 sources selected; 6 complete reports. Non-PR events run the full live suite
Selected tests: 234/234 passed; 0 failed.
Started: 2026-10-16 15:35:54 UTC
Tested commit: `d4924ba`

| Extension | Result | Passed | Failed | Duration |
| --- | --- | ---: | ---: | ---: |
| Hijala | ✅ Pass | 56/56 | 0 | 89.99s |
| Kagane | ✅ Pass | 32/32 | 0 | 48.97s |
| MangaStash | ✅ Pass | 17/17 | 0 | 23.39s |
| MangaSushi | ✅ Pass | 42/42 | 0 | 101.38s |
| ManhwaNex | ✅ Pass | 40/40 | 0 | 166.21s |
| VortexScans | ✅ Pass | 47/47 | 0 | 21.11s |

<details>
<summary>Test output</summary>

| Extension | Test | Result | Duration | Failure |
| --- | --- | --- | ---: | --- |
| Hijala | Built Mana bundle and source metadata | ✅ Pass | 0.04s | — |
| Hijala | Malformed native rating contexts fail closed before provider I/O | ✅ Pass | 0.01s | — |
| Hijala | Native metadata and persistent defaults are honest about genre-based safety | ✅ Pass | 1.50s | — |
| Hijala | Search form exposes every live genre, eight statuses, five types and site filters | ✅ Pass | 0.51s | — |
| Hijala | Catalog is bulk-classified with no per-title detail requests | ✅ Pass | 1.07s | — |
| Hijala | Entire live native catalog has unique accumulated IDs, no lost returned titles and stable reset/repeats | ✅ Pass | 2.67s | — |
| Hijala | Title search and true empty search use source-published titles | ✅ Pass | 0.58s | — |
| Hijala | Every six native site sort orders returns usable live data | ✅ Pass | 2.13s | — |
| Hijala | Native submitted filters are exactly encoded and inclusion/exclusion works | ✅ Pass | 1.49s | — |
| Hijala | Native validation rejects invalid dates, huge integers and inverted ranges | ✅ Pass | 0.31s | — |
| Hijala | Empty native allowed-rating context returns none without network | ✅ Pass | 0.00s | — |
| Hijala | Actual source title, aliases, metadata, full cover and inline chapters agree | ✅ Pass | 0.83s | — |
| Hijala | Complete chapter list is reused, sequentially indexed and paid hidden by default | ✅ Pass | 0.25s | — |
| Hijala | Paid preference persists across instances without enabling paid reading | ✅ Pass | 1.60s | — |
| Hijala | Reader produces ordered native page objects and actual first/middle/last image bytes | ✅ Pass | 0.99s | — |
| Hijala | A second real public chapter reads actual image bytes too | ✅ Pass | 0.73s | — |
| Hijala | Source headers are attached to native metadata and image requests | ✅ Pass | 0.00s | — |
| Hijala | Every current native discovery section resolves without stale Hot or fabricated genre cards | ✅ Pass | 10.76s | — |
| Hijala | Source-disabled known release tabs disappear and stale links do not fetch them | ✅ Pass | 1.53s | — |
| Hijala | Latest and rendered first-nine Popular snapshots match fresh website DOM ordering | ✅ Pass | 2.48s | — |
| Hijala | Canonical New and latest listings match public feed evidence | ✅ Pass | 4.00s | — |
| Hijala | Highest-chapter-count safe title has a complete real large chapter list | ✅ Pass | 2.32s | — |
| Hijala | A genuine live decimal chapter retains its number and reads actual image bytes | ✅ Pass | 2.12s | — |
| Hijala | Deep links preserve encoded IDs and reader links safely resolve to native series | ✅ Pass | 1.54s | — |
| Hijala | NSFW preference persists, known mature titles are excluded end to end | ✅ Pass | 4.57s | — |
| Hijala | Empty types and sections stay empty and native excluded genres are enforced | ✅ Pass | 3.82s | — |
| Hijala | Concurrent native preference callbacks merge without losing fields | ✅ Pass | 1.23s | — |
| Hijala | A read begun during a queued safety save waits before using old permissive cached results | ✅ Pass | 3.70s | — |
| Hijala | Unknown genre metadata fails closed using a fresh live catalog response | ✅ Pass | 2.66s | — |
| Hijala | Partial genre metadata retains valid tags and never bypasses an explicit genre exclusion | ✅ Pass | 4.94s | — |
| Hijala | Native rating authority includes fallback metadata, isolates warm caches and preserves explicit choices | ✅ Pass | 6.03s | — |
| Hijala | Filtered-empty first page advances native continuation from the consumed API page | ✅ Pass | 1.22s | — |
| Hijala | Repeated API pages fail explicitly instead of looping or duplicating native pages | ✅ Pass | 0.81s | — |
| Hijala | Settings changed during a live page2 request reject its stale result | ✅ Pass | 1.33s | — |
| Hijala | Native decimal numbers and semantic chapter titles survive live-derived mutation | ✅ Pass | 0.44s | — |
| Hijala | Earliest paid chapter is filtered before assigning zero-based native indexes | ✅ Pass | 0.59s | — |
| Hijala | Incomplete total and missing access status reject real detail data | ✅ Pass | 1.12s | — |
| Hijala | Protected, mismatched and malformed readers are rejected from fresh live responses | ✅ Pass | 4.07s | — |
| Hijala | Expired native pagination and raw caches refresh instead of pinning Latest forever | ✅ Pass | 1.78s | — |
| Hijala | Ordinary forbidden responses do not become Cloudflare or cross an access boundary | ✅ Pass | 0.50s | — |
| Hijala | Verified challenge responses use the source resolution URL | ✅ Pass | 0.23s | — |
| Hijala | No downloaded script execution or cross-series/invalid chapter fallback occurs | ✅ Pass | 2.34s | — |
| Hijala | Pagination mutation seed is captured once from current public metadata | ✅ Pass | 1.95s | — |
| Hijala | Native Most Chapters accepts the current source response and complete terminal catalog shape | ✅ Pass | 0.50s | — |
| Hijala | Only a complete unique first-page catalog may exceed the requested page size | ✅ Pass | 0.37s | — |
| Hijala | Partial physical-page overlap emits every ID once beyond the nominal last offset | ✅ Pass | 0.31s | — |
| Hijala | Duplicate-only nonterminal physical page is skipped and later fresh rows are never lost | ✅ Pass | 0.25s | — |
| Hijala | Repeated pages, page1 reset and TTL refresh do not carry emitted-ID exclusions | ✅ Pass | 1.38s | — |
| Hijala | Changed query and sort keep independent native continuation and emitted-ID state | ✅ Pass | 0.88s | — |
| Hijala | Changed persistent settings reset continuation without hiding prior IDs | ✅ Pass | 0.95s | — |
| Hijala | Another Target toggling off/on cannot revive an old same-value cursor or raw snapshot | ✅ Pass | 0.63s | — |
| Hijala | Allowed-rating contexts isolate cumulative IDs even across locally filtered pages | ✅ Pass | 0.12s | — |
| Hijala | Changed total fails explicitly and page1 can reset the failed snapshot | ✅ Pass | 0.44s | — |
| Hijala | Missing titles after duplicates and endless repeated pages fail instead of claiming terminal completion | ✅ Pass | 0.26s | — |
| Hijala | Untrusted totals, page counts and cumulative-ID state fail before unbounded traversal or allocation | ✅ Pass | 0.44s | — |
| Hijala | Malformed internal continuation fails before reading an unconsumed provider offset | ✅ Pass | 0.63s | — |
| Kagane | Built Mana bundle and source metadata | ✅ Pass | 0.02s | — |
| Kagane | Malformed native rating contexts fail closed before provider I/O | ✅ Pass | 0.01s | — |
| Kagane | Never-saved source categories follow native policy and explicit source selection persists | ✅ Pass | 8.43s | — |
| Kagane | Search pagination follows upstream completion, not the filtered result count | ✅ Pass | 0.61s | — |
| Kagane | Full title search, details, cover and series deep link retain identity | ✅ Pass | 2.68s | — |
| Kagane | English titles require explicit metadata and retain the original plus aliases | ✅ Pass | 0.48s | — |
| Kagane | Native search form preserves live taxonomy and grouped tag sheets | ✅ Pass | 0.06s | — |
| Kagane | Every native sort and exact-title mode makes a valid live request | ✅ Pass | 6.96s | — |
| Kagane | Include/exclude genres, grouped tags and typed tags use live IDs | ✅ Pass | 3.11s | — |
| Kagane | Unknown malformed and stale tags fail before search; valid native payloads remain exact | ✅ Pass | 0.90s | — |
| Kagane | Native numeric ranges serialize strictly before taxonomy and preserve policies, discovery and cached continuation | ✅ Pass | 1.01s | — |
| Kagane | Live chapter-count and start-year bounds constrain consumed bulk rows without changing native identity or order | ✅ Pass | 2.73s | — |
| Kagane | Format, status and uploader filters round-trip through the native request | ✅ Pass | 0.52s | — |
| Kagane | Negative search is an empty terminal page and invalid pages are rejected | ✅ Pass | 0.36s | — |
| Kagane | All six native discovery sorts preserve live API order and continuation | ✅ Pass | 0.00s | — |
| Kagane | A real 200-plus chapter list matches every live index ID exactly | ✅ Pass | 2.04s | — |
| Kagane | Current live series translation and unknown language preserve native chapter identity | ✅ Pass | 0.07s | — |
| Kagane | Repeated chapter/detail calls reuse bulk data instead of N-plus-one requests | ✅ Pass | 0.47s | — |
| Kagane | First and last actual chapter readers load image bytes with source headers | ✅ Pass | 2.68s | — |
| Kagane | Expired reader sessions refresh once per chapter and retain the actual page identity | ✅ Pass | 0.89s | — |
| Kagane | Data saver uses the supported query and still loads actual reader images | ✅ Pass | 3.23s | — |
| Kagane | Reader rejects a book from another series before requesting access | ✅ Pass | 1.06s | — |
| Kagane | Every rating category selects its exact modern class and an empty selection shows none | ✅ Pass | 5.69s | — |
| Kagane | Mixed rating selections and per-search or host limits cannot widen global choices | ✅ Pass | 1.18s | — |
| Kagane | Previously issued reader URLs cannot evade changed rating settings | ✅ Pass | 0.11s | — |
| Kagane | Setting persistence and explicit content exclusion apply even to title search | ✅ Pass | 2.18s | — |
| Kagane | Unknown and conflicting ratings fail closed for details, chapters and reading | ✅ Pass | 0.00s | — |
| Kagane | Incomplete rating metadata uses native Suggestive fallback without overriding known explicit evidence | ✅ Pass | 0.61s | — |
| Kagane | Native rating policy and accumulated IDs survive partial overlap and duplicate-only physical pages | ✅ Pass | 0.11s | — |
| Kagane | Changing safety preference invalidates an in-flight unfiltered response | ✅ Pass | 0.73s | — |
| Kagane | Malformed pagination and reader manifests are errors, not empty successes | ✅ Pass | 0.00s | — |
| Kagane | Test host permits only exact public Kagane operations and redacts reader tokens | ✅ Pass | 0.01s | — |
| MangaStash | Built Mana bundle and source metadata | ✅ Pass | 0.03s | — |
| MangaStash | Malformed native rating contexts fail closed before provider I/O | ✅ Pass | 0.01s | — |
| MangaStash | MangaStash native initialization and exact browse controls | ✅ Pass | 0.00s | — |
| MangaStash | Catalog same-response identities, source cover provenance and unknown fallback | ✅ Pass | 1.12s | — |
| MangaStash | Exact source home feeds, same-response whole-feed comparison and overlaps | ✅ Pass | 0.75s | — |
| MangaStash | Source-declared compound filters preserve exact page-two scope and ordering | ✅ Pass | 1.78s | — |
| MangaStash | Text search uses q only and authoritative source rating | ✅ Pass | 0.86s | — |
| MangaStash | Complete detail chapters reuse one response, preserve decimal routes and unknown dates | ✅ Pass | 1.19s | — |
| MangaStash | Canonical persisted decimal reader preserves every advertised page and credit page | ✅ Pass | 0.74s | — |
| MangaStash | First, middle, last reader and original cover images deliver complete image bytes | ✅ Pass | 3.72s | — |
| MangaStash | Malformed request shapes, unsupported combinations and IDs fail before HTTP | ✅ Pass | 1.08s | — |
| MangaStash | Deny-all, Safe-only, omitted and concurrent native contexts stay request-scoped | ✅ Pass | 0.53s | — |
| MangaStash | Persisted image grants reject forged URLs, expired evidence and source-setting revocation | ✅ Pass | 2.77s | — |
| MangaStash | Reader ownership, route, configuration, page count and ordering mutations fail closed | ✅ Pass | 8.35s | — |
| MangaStash | Positive source labels, malformed warnings and pagination mutations do not become fallback permission | ✅ Pass | 0.41s | — |
| MangaStash | Locked inventory chapters are not exposed or requested through persisted reader callbacks | ✅ Pass | 0.04s | — |
| MangaStash | Source-setting changes revoke in-flight results without native-context interference | ✅ Pass | 0.01s | — |
| MangaSushi | Built Mana bundle and source metadata | ✅ Pass | 0.03s | — |
| MangaSushi | Malformed native rating contexts fail closed before provider I/O | ✅ Pass | 0.01s | — |
| MangaSushi | Native rating policy is authoritative with no never-saved source cap and reusable context-neutral caches | ✅ Pass | 3.70s | — |
| MangaSushi | Live native parsers map unclassified metadata to Suggestive and keep actual adult warnings Explicit | ✅ Pass | 5.22s | — |
| MangaSushi | Native singleton ratings preserve source markers and use Suggestive only as the unclassified fallback | ✅ Pass | 5.93s | — |
| MangaSushi | Warm native search pages retain a newly observed adult warning instead of relabeling it as unclassified | ✅ Pass | 1.38s | — |
| MangaSushi | Native logical pagination passes excluded-only physical pages without losing later eligible IDs | ✅ Pass | 3.14s | — |
| MangaSushi | Native logical pagination passes duplicate-only physical pages without losing later eligible IDs | ✅ Pass | 3.46s | — |
| MangaSushi | Ordinary genre search proves native Action/Romance taxonomy and preserves exact continuation without added requests | ✅ Pass | 2.48s | — |
| MangaSushi | Cooking ignored-filter response fails visibly after one request, never as unrelated or false empty results | ✅ Pass | 0.66s | — |
| MangaSushi | Genre proof rejects ambiguous query syntax, missing/wrong taxonomy, unknown terms and unrelated raw metadata | ✅ Pass | 2.18s | — |
| MangaSushi | OR/AND genre proof uses real raw memberships and accepts recognized genuine empty searches | ✅ Pass | 0.56s | — |
| MangaSushi | Continuation retains initial native genre scope and rejects ignored or altered taxonomy without scans | ✅ Pass | 0.25s | — |
| MangaSushi | Explicitly saved NSFW exclusion uses native adult=0 | ✅ Pass | 1.08s | — |
| MangaSushi | Native catalog pagination advances without using filtered counts | ✅ Pass | 0.82s | — |
| MangaSushi | Full title search and safe details retain the canonical identity | ✅ Pass | 0.88s | — |
| MangaSushi | English aliases retain canonical IDs, original titles and complete comma-containing alternatives | ✅ Pass | 6.94s | — |
| MangaSushi | Japanese-only alternatives retain the original title in search and details | ✅ Pass | 1.48s | — |
| MangaSushi | Cold metadata classification still queries the source original, not its English display alias | ✅ Pass | 1.08s | — |
| MangaSushi | Removing an English alias from live metadata restores the original search and detail display | ✅ Pass | 1.20s | — |
| MangaSushi | Search exposes live genres, all statuses, site fields and seven orders | ✅ Pass | 5.05s | — |
| MangaSushi | Every native search order returns live results | ✅ Pass | 5.31s | — |
| MangaSushi | Native OR and AND genre conditions and author/artist/year/status filters | ✅ Pass | 9.03s | — |
| MangaSushi | Negative search returns a genuinely empty terminal page | ✅ Pass | 0.62s | — |
| MangaSushi | Preference callback persists across instances and unfiltered catalog is usable | ✅ Pass | 5.25s | — |
| MangaSushi | Discovery mirrors both site rows exactly with no invented popular continuation | ✅ Pass | 2.72s | — |
| MangaSushi | Popular, latest, search and detail covers use the largest advertised same-asset images | ✅ Pass | 3.45s | — |
| MangaSushi | Cover fallbacks reject malformed or unrelated metadata and retain explicitly advertised originals | ✅ Pass | 2.15s | — |
| MangaSushi | Unfiltered discovery keeps English titles with two cold requests and zero warm requests | ✅ Pass | 0.96s | — |
| MangaSushi | Sample details, asynchronous chapters, decimals and original labels | ✅ Pass | 0.65s | — |
| MangaSushi | Multiple readers preserve ordered lazy images and image bytes | ✅ Pass | 1.23s | — |
| MangaSushi | Issued native images survive reload but reject mutation, expiry and actual source-policy changes without requests | ✅ Pass | 0.00s | — |
| MangaSushi | Editorial notices never become reading content, even with exclusion off | ✅ Pass | 1.58s | — |
| MangaSushi | Reader rejects mismatched identity, duplicate URLs and numbered page gaps | ✅ Pass | 0.29s | — |
| MangaSushi | Changing the preference invalidates an in-flight unfiltered response | ✅ Pass | 0.54s | — |
| MangaSushi | Unknown classification is blocked and malformed search is not an empty success | ✅ Pass | 2.62s | — |
| MangaSushi | Re-enabling global exclusion blocks cached NSFW detail, chapters, reader and deep links | ✅ Pass | 1.93s | — |
| MangaSushi | Filtered discovery preserves rows and only returns verifiably safe titles | ✅ Pass | 11.76s | — |
| MangaSushi | Setting changes invalidate a pending discovery metadata batch | ✅ Pass | 1.74s | — |
| MangaSushi | Malformed discovery metadata fails visibly instead of trusting home titles | ✅ Pass | 0.32s | — |
| MangaSushi | Read-only host rejects duplicate AJAX actions before any request | ✅ Pass | 0.00s | — |
| MangaSushi | Repeated provider pages stop within ten consecutive no-new-raw-ID reads | ✅ Pass | 1.67s | — |
| ManhwaNex | Built Mana bundle and source metadata | ✅ Pass | 0.03s | — |
| ManhwaNex | Malformed native rating contexts fail closed before provider I/O | ✅ Pass | 0.01s | — |
| ManhwaNex | Native rating authority defaults to no extra source cap and replays raw cached pages under changed contexts | ✅ Pass | 1.55s | — |
| ManhwaNex | Native details use supported Suggestive fallback for unclassified metadata and retain positive adult warnings | ✅ Pass | 1.57s | — |
| ManhwaNex | Native singleton policy skips excluded-only physical pages and never caches a reader policy | ✅ Pass | 1.65s | — |
| ManhwaNex | Explicitly saved source exclusion uses two cold requests and zero warm requests | ✅ Pass | 0.68s | — |
| ManhwaNex | Native home names, memberships, exact order and pagination are preserved | ✅ Pass | 0.79s | — |
| ManhwaNex | Largest source-advertised covers have real intrinsic image dimensions | ✅ Pass | 2.53s | — |
| ManhwaNex | Native safe search returns exact source page and next-page identities | ✅ Pass | 1.70s | — |
| ManhwaNex | Search form exposes only verified native taxonomy and Relevance sort | ✅ Pass | 0.35s | — |
| ManhwaNex | Native Action archive stays lazy, ordered and complete in both safety modes | ✅ Pass | 11.24s | — |
| ManhwaNex | Native Romance archive stays lazy, ordered and complete in both safety modes | ✅ Pass | 1.81s | — |
| ManhwaNex | Native Fantasy archive stays lazy, ordered and complete in both safety modes | ✅ Pass | 11.01s | — |
| ManhwaNex | Native Martial Arts archive stays lazy, ordered and complete in both safety modes | ✅ Pass | 5.86s | — |
| ManhwaNex | Native Adventure archive stays lazy, ordered and complete in both safety modes | ✅ Pass | 3.24s | — |
| ManhwaNex | Native Ghost archive stays lazy, ordered and complete in both safety modes | ✅ Pass | 1.72s | — |
| ManhwaNex | Native Cultivation archive stays lazy, ordered and complete in both safety modes | ✅ Pass | 1.94s | — |
| ManhwaNex | Native System archive stays lazy, ordered and complete in both safety modes | ✅ Pass | 3.09s | — |
| ManhwaNex | Concurrent lazy archive requests coalesce the native page and bounded metadata batch | ✅ Pass | 0.87s | — |
| ManhwaNex | Distinct native canonical aliases retain separate details and chapter inventories | ✅ Pass | 1.64s | — |
| ManhwaNex | Sequential native pages deduplicate real canonical overlap without losing later titles or terminal state | ✅ Pass | 22.65s | — |
| ManhwaNex | Pagination identity stays scoped to native query, category and current settings | ✅ Pass | 5.45s | — |
| ManhwaNex | Category continuation rejects foreign, switched, nonadvancing and wrong-context archives before following them | ✅ Pass | 5.68s | — |
| ManhwaNex | Raw archive adult evidence cannot be overwritten by complete safe batch metadata | ✅ Pass | 34.92s | — |
| ManhwaNex | All eight native genre filters and OR/AND semantics are honored | ✅ Pass | 5.68s | — |
| ManhwaNex | Native author and artist text filters work while source redirects fail visibly | ✅ Pass | 1.33s | — |
| ManhwaNex | Every source status and release filter uses native parameters | ✅ Pass | 2.66s | — |
| ManhwaNex | Source titles, punctuation, aliases, canonical metadata and deep links survive cold details | ✅ Pass | 2.14s | — |
| ManhwaNex | Source-issued images stay coherent across stale readers, cached writers, concurrent instances and store failures | ✅ Pass | 2.05s | — |
| ManhwaNex | Negative searches terminate honestly without repeating or inventing pages | ✅ Pass | 4.59s | — |
| ManhwaNex | All currently available chapters match the complete native AJAX list, including decimal identity | ✅ Pass | 0.34s | — |
| ManhwaNex | Native chapter pipeline preserves reported container and explicit-label volumes | ✅ Pass | 0.86s | — |
| ManhwaNex | Native oldest reader preserves image order and actual first/last bytes | ✅ Pass | 3.47s | — |
| ManhwaNex | Native newest reader preserves image order and actual first/last bytes | ✅ Pass | 1.20s | — |
| ManhwaNex | Native decimal reader preserves image order and actual first/last bytes | ✅ Pass | 1.08s | — |
| ManhwaNex | A second live title completes details, chapters, reader and both image endpoints | ✅ Pass | 3.11s | — |
| ManhwaNex | Explicit opt-out persists and per-search adult filtering cannot widen global exclusion | ✅ Pass | 2.38s | — |
| ManhwaNex | Unknown and explicit classifications fail closed without treating BL/demographics as adult labels | ✅ Pass | 12.84s | — |
| ManhwaNex | IDs, image origins and exact read-only POST routes reject unsafe inputs | ✅ Pass | 0.00s | — |
| ManhwaNex | Preference changes invalidate in-flight discovery and cannot repopulate stale caches | ✅ Pass | 0.49s | — |
| VortexScans | Built Mana bundle and source metadata | ✅ Pass | 0.03s | — |
| VortexScans | Malformed native rating contexts fail closed before provider I/O | ✅ Pass | 0.01s | — |
| VortexScans | Catalog search returns usable highlights | ✅ Pass | 0.44s | — |
| VortexScans | Catalog pagination advances or explicitly ends | ✅ Pass | 0.21s | — |
| VortexScans | Title search finds a live catalog title | ✅ Pass | 0.21s | — |
| VortexScans | Live content details and cover image | ✅ Pass | 0.56s | — |
| VortexScans | Search form exposes live genres and sort options | ✅ Pass | 0.17s | — |
| VortexScans | Genre inclusion and exclusion affect live results | ✅ Pass | 1.08s | — |
| VortexScans | Home discovers all published sections | ✅ Pass | 0.24s | — |
| VortexScans | Home section: Featured (featured) | ✅ Pass | 1.11s | — |
| VortexScans | Home section: Popular Today (popular-today) | ✅ Pass | 0.42s | — |
| VortexScans | Home section: Latest Releases (latest) | ✅ Pass | 0.00s | — |
| VortexScans | Home section: New (new) | ✅ Pass | 0.31s | — |
| VortexScans | Home section: For beginners (collection:for-beginners) | ✅ Pass | 0.16s | — |
| VortexScans | Home section: Top Picks (collection:top-picks) | ✅ Pass | 0.27s | — |
| VortexScans | Home section: Fantasy Worlds (collection:fantasy-worlds) | ✅ Pass | 0.24s | — |
| VortexScans | Home section: Marathon Reads (collection:marathon-reads) | ✅ Pass | 0.25s | — |
| VortexScans | Home section: Completed Series (collection:completed-series) | ✅ Pass | 0.25s | — |
| VortexScans | Home section: Most Popular (most-popular) | ✅ Pass | 0.00s | — |
| VortexScans | Popular Today uses source-published originals with one homepage request | ✅ Pass | 1.37s | — |
| VortexScans | Popular Today metadata is source-bound and missing or invalid originals retain card images | ✅ Pass | 5.32s | — |
| VortexScans | Search and detail retain source originals including octet-stream WebP bytes | ✅ Pass | 1.99s | — |
| VortexScans | Live chapter list has unique IDs and oldest-first order | ✅ Pass | 0.19s | — |
| VortexScans | Chapter pages are nonempty unique URLs | ✅ Pass | 0.72s | — |
| VortexScans | First and last chapter images load with source headers | ✅ Pass | 0.11s | — |
| VortexScans | Series deep link resolves the same live content | ✅ Pass | 0.20s | — |
| VortexScans | Same-response synopsis maps nonempty text and permits genuine empty text without provider requests | ✅ Pass | 0.00s | — |
| VortexScans | Native policy distinguishes no policy from empty and captures current public catalog once | ✅ Pass | 0.48s | — |
| VortexScans | Native search distinguishes explicit chapter count from latest number and preserves home labels | ✅ Pass | 0.00s | — |
| VortexScans | Known source genres retain native classes and unclassified metadata uses Suggestive details fallback | ✅ Pass | 0.00s | — |
| VortexScans | Native concatenated pages survive partial overlap duplicate-only and rating-excluded physical pages | ✅ Pass | 0.01s | — |
| VortexScans | Discover and view-more retain exact native policy while sparse cards use supported fallback | ✅ Pass | 0.00s | — |
| VortexScans | All real home rows share one cold homepage and repeat without provider requests or N+1 | ✅ Pass | 2.07s | — |
| VortexScans | Featured Popular Today Latest Releases and monthly ranking match exact same-response website IDs order and originals | ✅ Pass | 0.03s | — |
| VortexScans | Bounded Featured Popular Today and monthly snapshots never advertise invented continuation | ✅ Pass | 0.00s | — |
| VortexScans | Latest View More starts at exact home36 then uses real native page2 with cumulative canonical IDs | ✅ Pass | 0.30s | — |
| VortexScans | Home36 continuation survives duplicate-only excluded-only overlap terminal pages and request-scoped policy | ✅ Pass | 0.00s | — |
| VortexScans | Same-response genre enrichment requires exact numeric ID and slug and retains positive warnings and Suggestive unknown fallback | ✅ Pass | 0.18s | — |
| VortexScans | Warm home snapshots rebind complete current native context and empty policy performs no provider work | ✅ Pass | 0.00s | — |
| VortexScans | Ambiguous or conflicting homepage ranking and changed release configuration fail visibly without alternate requests | ✅ Pass | 0.34s | — |
| VortexScans | Native detail to chapters to reader loads complete first and last image bodies with source headers | ✅ Pass | 1.80s | — |
| VortexScans | Native reader preserves canonical, numeric and persisted legacy owner IDs and decimal chapter references | ✅ Pass | 0.00s | — |
| VortexScans | Wrong or incomplete API chapter and owner identities fail without HTML fallback | ✅ Pass | 0.00s | — |
| VortexScans | Malformed native identities and foreign URLs reject before I/O; same-series wrong chapters reject after one API read | ✅ Pass | 0.00s | — |
| VortexScans | Authoritative locks, empty pages and API outages remain errors, never unrelated HTML pages | ✅ Pass | 0.00s | — |
| VortexScans | Malformed saved include and exclude genres fail before I/O without broadening search | ✅ Pass | 0.00s | — |
| VortexScans | Valid native genre IDs retain exact payload, sort, query and rating context without taxonomy requests | ✅ Pass | 0.00s | — |

</details>

<details>
<summary>Recent checks (last 24 runs)</summary>

| Checked (UTC) | Hijala | Kagane | MangaStash | MangaSushi | ManhwaNex | VortexScans | Run |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-10-16 15:44:07 UTC | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38925226294) |
| 2026-10-16 11:42:33 UTC | ✅ Pass | ❌ Fail | ❌ Fail | ✅ Pass | ✅ Pass | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38894698267) |
| 2026-10-16 06:02:57 UTC | ✅ Pass | ✅ Pass | — Not tested | ✅ Pass | ✅ Pass | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38858342066) |
| 2026-10-16 00:56:57 UTC | ✅ Pass | ✅ Pass | — Not tested | ✅ Pass | ✅ Pass | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38831668014) |
| 2026-10-15 22:48:20 UTC | ✅ Pass | ✅ Pass | — Not tested | ✅ Pass | ✅ Pass | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38818829286) |
| 2026-10-15 20:32:03 UTC | ✅ Pass | ✅ Pass | — Not tested | ✅ Pass | ✅ Pass | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38801561745) |
| 2026-10-15 20:25:09 UTC | ✅ Pass | ✅ Pass | — Not tested | ✅ Pass | ✅ Pass | ❌ Fail | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38800771139) |
| 2026-10-15 19:35:01 UTC | ✅ Pass | ✅ Pass | — Not tested | ✅ Pass | ❌ Fail | ❌ Fail | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38794101786) |
| 2026-10-15 17:36:13 UTC | ✅ Pass | ✅ Pass | — Not tested | ✅ Pass | ✅ Pass | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38777761970) |
| 2026-10-15 16:51:20 UTC | ✅ Pass | ✅ Pass | — Not tested | ✅ Pass | ✅ Pass | ❌ Fail | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38771520288) |
| 2026-10-15 15:28:39 UTC | ✅ Pass | ✅ Pass | — Not tested | ✅ Pass | ✅ Pass | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38759506369) |
| 2026-10-15 15:19:26 UTC | ✅ Pass | ✅ Pass | — Not tested | ✅ Pass | ✅ Pass | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38758018828) |
| 2026-10-15 10:29:41 UTC | ✅ Pass | ✅ Pass | — Not tested | ✅ Pass | ✅ Pass | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38719746193) |
| 2026-10-15 08:34:59 UTC | ✅ Pass | ✅ Pass | — Not tested | ✅ Pass | ✅ Pass | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38705834816) |
| 2026-10-15 08:04:00 UTC | ✅ Pass | ✅ Pass | — Not tested | ✅ Pass | ✅ Pass | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38702080694) |
| 2026-10-15 07:57:10 UTC | ✅ Pass | ✅ Pass | — Not tested | ✅ Pass | ✅ Pass | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38701544623) |
| 2026-10-15 07:44:21 UTC | ✅ Pass | ✅ Pass | — Not tested | ✅ Pass | ✅ Pass | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38700007680) |
| 2026-10-15 07:22:33 UTC | ✅ Pass | ✅ Pass | — Not tested | ✅ Pass | ✅ Pass | ❌ Fail | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38697525684) |
| 2026-10-15 07:08:48 UTC | ✅ Pass | ✅ Pass | — Not tested | ✅ Pass | ✅ Pass | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38696076306) |
| 2026-10-15 06:18:04 UTC | ✅ Pass | ✅ Pass | — Not tested | ✅ Pass | ✅ Pass | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38690861264) |
| 2026-10-15 06:11:35 UTC | ✅ Pass | ✅ Pass | — Not tested | ✅ Pass | ✅ Pass | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38690556960) |
| 2026-10-15 05:38:05 UTC | ✅ Pass | ✅ Pass | — Not tested | ✅ Pass | ✅ Pass | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38687447021) |
| 2026-10-15 05:27:22 UTC | — Not tested | ✅ Pass | — Not tested | ✅ Pass | ✅ Pass | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38686593213) |
| 2026-10-15 05:21:38 UTC | — Not tested | ✅ Pass | — Not tested | ✅ Pass | ✅ Pass | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38686085446) |

</details>

<!-- LIVE_TEST_STATUS:END -->

## Installation

Add this repository URL in Mana:

`https://mana.pirate.vodka/`

## Available extensions

- [Hijala](src/sources/Hijala)
- [Kagane](src/sources/Kagane)
- [MangaStash](src/sources/MangaStash)
- [MangaSushi](src/sources/MangaSushi)
- [ManhwaNex](src/sources/ManhwaNex)
- [VortexScans](src/sources/VortexScans)

## Native content-rating policy

The pinned native SDK supports Safe, Suggestive, Mature and Explicit item ratings.
Sources honor a supplied `SourceContext.allowedContentRatings` on search, Discover,
continuation and details. An empty list permits no titles; an omitted policy does
not silently imply Safe-only. Native context stays request-scoped, not a global
reader setting. Source catalogs remain `CatalogRating.MIXED`, a separate enum.

The SDK has no Unknown item rating. Missing or unreliable rating metadata uses
`ContentRating.SUGGESTIVE` as an **app-compatibility fallback**, not a site-reported age
classification. Details include a single incomplete-metadata note; titles/cards
are not renamed. Known source rating evidence is preserved, including explicit
warnings. BL/GL, demographics and relationship tags alone do not imply sexuality.

Previously implicit source adult caps are no longer enabled for never-saved
preferences. Identifiable deliberate source selections remain extra filters.
Sources advertise their supported native preference hooks, but this does not prove
where an installed Mana app exposes their UI. Paid/access restrictions and explicit
content-type/genre filters remain independent. Source labels cannot guarantee the
content of every image.

## Source-specific notes

<details>
<summary>Hijala</summary>

[Hijala](https://en-hijala.com/) is a native Mana source.

**Discover and search**

- Featured, Latest Releases, New, Most Popular and Latest Updates follow the
  website. Latest and New remain distinct; Popular uses the rendered homepage
  selection, not a different ranking. Source-disabled tabs are not fabricated.
- Live genres, source sorts, statuses, types, direction, chapter-count bounds and
  creation-date filters are available in native search. Shared bounded caches
  reuse catalog batches rather than fetching each title's details.

**Details and reader**

- Source-provided full covers, original titles/aliases and complete available
  chapter lists. Decimal numbers, chapter identity and ordered public-reader
  pages are retained; native reader checks load actual image bytes.
- Mana's series-only Highlights show the latest visible chapter per series;
  chapter links resolve to their series under the pinned native API.

**Settings and limitations**

- Native allowed-content-rating policy combines with optional source NSFW
  exclusion, excluded genres, content types and paid-chapter hiding.
  Explicit source exclusions remain fail-closed when classification is unverifiable.
- The website has no reliable graded age taxonomy. Incomplete metadata uses an
  explained Suggestive compatibility fallback; actual warning labels stay authoritative.
- Saved deliberate preferences remain honored, without a silent default adult cap
  for never-saved settings. Login, paid and protected content remain on the website.

Implementation: [`src/sources/Hijala`](src/sources/Hijala).
The bounded non-evaluating TanStack/Seroval decoder and GPL attribution are recorded
in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

</details>

<details>
<summary>Kagane</summary>

[Kagane](https://kagane.org/) is a native Mana source.

**Discover and search**

- Popularity-period, Latest Updates and Recently Added rows use source data.
  Native search provides supported directional sorts, exact-title mode, format,
  status, upload sources, chapter-count/start-year ranges and live genres/tags.
- Genre/tag any/all matching, inclusion/exclusion, grouped tag sheets and typed
  names are supported. Taxonomy and identical in-flight requests are reused.
  Cards can show the source format and star score without extra per-title requests.

**Details and reader**

- Available synopsis, star score, views, associated names, staff and validated
  source-provided external links are retained. Explicitly English-labeled titles
  may be preferred; unlabeled alternatives are not translated or guessed.
- Other Editions appears first in the extension's additional detail information.
  This is a bounded same-series edition list, not unrelated recommendations or a
  guarantee about the app's overall screen layout.
- Complete cursor-based chapter traversal preserves canonical ownership,
  availability and native chapter metadata. Ordered public-reader manifests,
  renewable image sessions, source headers and data saver are supported.

**Settings and limitations**

- Persistent source rating choices, hidden genres/tags, languages and upload-source
  preferences combine with native allowed-content-rating policy. Selecting no
  ratings shows none; per-search choices cannot widen persistent restrictions.
- Source/edition labels, clean labels, spoiler visibility and chapter-title style
  are configurable. Other Editions is omitted while hidden genre/tag filters are
  active because its source metadata cannot safely enforce those filters.
- Legacy API rating filters are not assumed reliable. Current source evidence is
  checked locally; explicit warnings cannot be downgraded by incomplete metadata.
  Unknown ratings use an explained Suggestive fallback, not an invented Safe label.
- Login, paid, unavailable and cross-series chapter access is not bypassed.
  Unlabeled bulk aliases do not trigger per-title requests just to infer a language.

Implementation: [`src/sources/Kagane`](src/sources/Kagane).
GPL attribution and pinned upstream references are in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

</details>

<details>
<summary>MangaStash</summary>

[MangaStash](https://mangastash.org/) is a native Mana source.

**Discover and search**

- Popular This Month, New Additions and Latest Updates retain the website's
  distinct feeds. Catalog browsing uses the site's declared filters and sorts;
  title search uses its separate search endpoint rather than silently ignoring
  unsupported combinations.
- Pagination retains the original query scope, canonical IDs and source order.
  Covers use the largest candidate actually advertised in each response, without
  guessed image rewrites or a detail request for every card.

**Details and reader**

- Source titles, synopsis, classifications and the complete available chapter
  inventory retain their canonical routes. Decimal chapter identities are not
  reconstructed from a rounded chapter number.
- Ordered public-reader images preserve the source's credit pages as well as
  reading pages. Reader ownership and issued image URLs are checked before use.
- When bulk chapter dates are unavailable, Mana requires a date, so the extension
  uses an explicitly unknown epoch sentinel, not a claimed 1970 publication date.
  Its visible rendering depends on the app.

**Settings and limitations**

- Native content-rating choices apply independently of the optional source filter.
  Unclassified items use the explained Suggestive compatibility fallback; real
  source classifications stay authoritative.
- The optional extra source exclusion is **off by default**. Enabling it requires
  verified Safe metadata; unclassified home/catalog cards cannot bypass that
  choice. A wholly blocked feed explains the policy limitation instead of
  pretending the provider returned no titles.
- Home/catalog cards do not consistently supply individual age ratings. No
  demographic or review score is treated as an age classification, and no
  per-card requests are added just to infer one. Source access restrictions remain.

Implementation: [`src/sources/MangaStash`](src/sources/MangaStash).

</details>

<details>
<summary>MangaSushi</summary>

[MangaSushi](https://mangasushi.org/) is a native Mana source.

**Discover and search**

- Popular Series and What's New preserve source order and the website's actual
  load-more continuation. Genre browsing uses native search.
- Search follows the website's sorts and genre OR/AND, author, artist, release
  year, status and adult-content filters. Ignored genre filters report an error
  rather than unrelated results.
- Shared homepage responses and bounded page metadata avoid per-title enrichment.
  Missing homepage batch entries retain the canonical-ID search fallback.

**Details and reader**

- Audited English aliases are preferred only while the complete alias remains in
  current source metadata. Originals, full alternatives, available staff/status,
  synopsis and canonical IDs are preserved without invented translations.
- Covers use the largest valid same-asset rendition advertised by the source,
  including originals when available, without guessed URLs or per-card requests.
- Complete asynchronous chapters preserve decimal numbers and genuine labels.
  Readers keep canonical identity and ordered lazy images; native checks verify
  actual first/last image bodies and detect numbered-page gaps.

**Settings and limitations**

- Native allowed-content-rating policy applies per request. Optional source NSFW
  exclusion adds the site's adult filter and verified explicit genre labels across
  browsing, saved details, chapters and reader entry; an unset preference adds no
  silent adult cap. Incomplete ratings use an explained Suggestive fallback.
- Setting changes invalidate caches and active results. Filtered or duplicate-only
  pages are traversed within bounded limits without losing eligible titles.
  Verified donation/recruitment announcements are excluded as non-reading content.
- Exact punctuation-sensitive titles use verified source-title fallbacks; ordinary
  partial search is unchanged. Login, paid access and security gates are not bypassed.

Implementation: [`src/sources/MangaSushi`](src/sources/MangaSushi).
The [icon](assets/MangaSushi.png) comes from the website's published icon.

</details>

<details>
<summary>ManhwaNex</summary>

[ManhwaNex](https://manhwanex.com/) is a native Mana source.

**Discover and search**

- Popular Series, Latest Updates and the homepage-linked genre archives preserve
  native order and continuation. Archives load lazily with bounded page metadata.
- Popular and Latest share homepage metadata rather than fetching each card's
  details. Pagination removes repeated canonical IDs, not distinct source entries.
- Search supports native genre OR/AND, author, artist, release, status and adult
  filters. Relevance is the only advertised website sort.

**Details and reader**

- Original/English source titles, full alternatives, staff, publication metadata
  and separately grouped source SEO tags are retained within native storage limits.
- Covers use the largest valid rendition advertised in the existing response,
  independently of reader image selection. Chapter lists preserve available
  chapters, decimals, labels and dates; actual pagination is traversed.
- Readers retain ordered source images, with native image-registry safeguards
  across cached, concurrent and stale requests. Reader checks load actual image bodies.

**Settings and limitations**

- Native allowed-content-rating policy applies per request. Optional source NSFW
  exclusion adds verified explicit-label filtering; an unset preference adds no
  silent adult cap. Known warnings remain authoritative across in-flight work.
- The website has no verified granular age taxonomy: non-adult/unknown titles use
  the explained Suggestive compatibility bucket and actual adult warnings use Explicit.
- Long punctuated searches can return unrelated native matches; some numeric
  author queries redirect to the homepage and report an error. Queries are not
  broadly rewritten. Only publicly listed chapters are returned, which can be a
  recent subset rather than every historical release.

Implementation: [`src/sources/ManhwaNex`](src/sources/ManhwaNex).
The [icon](assets/ManhwaNex.png) comes from the website's published icon.

</details>

<details>
<summary>VortexScans</summary>

[VortexScans](https://vortexscans.org/) is a native Mana source.

**Discover and search**

- Featured, Popular Today, Latest Releases, New, source collections and the
  rendered Most Popular selection retain website order. Shared homepage data
  avoids per-title enrichment; Latest continues with the source feed.
- Native search provides source genres, inclusion/exclusion, status, type and
  supported sorting filters. Distinct curated sections remain distinct.

**Details and reader**

- Canonical IDs, source titles, available metadata and public chapter identities
  are retained. Popular Today prefers original covers supplied by the same response,
  with its existing card image as fallback.
- Ordered public reader pages, source headers and deep links are supported.
  Native reader checks verify complete first/last image bodies.
- Details may legitimately have no description. The extension does not invent a
  synopsis or substitute generic search-engine text.

**Settings and limitations**

- Native allowed-content-rating policy applies to source warning evidence.
  VortexScans has no source preference menu. Incomplete classification uses an
  explained Suggestive compatibility fallback, not an invented Safe or adult label.
- Locked chapters are excluded. Cloudflare/vShield challenges use Mana's supported
  resolution flow; access restrictions and TLS safeguards remain intact.

Implementation: [`src/sources/VortexScans`](src/sources/VortexScans).
Upstream attribution is retained in [Attribution and license](#attribution-and-license).

</details>

## Live test coverage

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
supported search orders and home rows, exact identity, a real 200-plus-chapter index/cursor
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

Source implementations are in [`src/sources`](src/sources), with icons in
[`assets`](assets).

## Attribution and license

Source-specific upstream references and attribution are recorded in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). VortexScans began as a native
Mana port of the [Paperback VortexScans source](https://github.com/LucifersCircle/pirate.vodka-extensions/tree/0.9/stable/src/VortexScans).

Licensed under [GPL-3.0-or-later](LICENSE).
