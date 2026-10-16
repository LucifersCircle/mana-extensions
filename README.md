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

Last checked: **2026-10-16 06:02:57 UTC** · [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38858342066)
Live scope: all; 5/5 sources selected; 5 complete reports. Non-PR events run the full live suite
Selected tests: 211/211 passed; 0 failed.
Started: 2026-10-16 05:55:37 UTC
Tested commit: `02273d4`

| Extension | Result | Passed | Failed | Duration |
| --- | --- | ---: | ---: | ---: |
| Hijala | ✅ Pass | 55/55 | 0 | 81.95s |
| Kagane | ✅ Pass | 31/31 | 0 | 44.19s |
| MangaSushi | ✅ Pass | 40/40 | 0 | 85.47s |
| ManhwaNex | ✅ Pass | 39/39 | 0 | 159.84s |
| VortexScans | ✅ Pass | 46/46 | 0 | 16.95s |

<details>
<summary>Test output</summary>

| Extension | Test | Result | Duration | Failure |
| --- | --- | --- | ---: | --- |
| Hijala | Built Mana bundle and source metadata | ✅ Pass | 0.03s | — |
| Hijala | Native metadata and persistent defaults are honest about genre-based safety | ✅ Pass | 1.35s | — |
| Hijala | Search form exposes every live genre, eight statuses, five types and site filters | ✅ Pass | 0.59s | — |
| Hijala | Catalog is bulk-classified with no per-title detail requests | ✅ Pass | 0.88s | — |
| Hijala | Entire live native catalog has unique accumulated IDs, no lost returned titles and stable reset/repeats | ✅ Pass | 3.22s | — |
| Hijala | Title search and true empty search use source-published titles | ✅ Pass | 0.60s | — |
| Hijala | Every six native site sort orders returns usable live data | ✅ Pass | 2.88s | — |
| Hijala | Native submitted filters are exactly encoded and inclusion/exclusion works | ✅ Pass | 1.54s | — |
| Hijala | Native validation rejects invalid dates, huge integers and inverted ranges | ✅ Pass | 0.25s | — |
| Hijala | Empty native allowed-rating context returns none without network | ✅ Pass | 0.00s | — |
| Hijala | Actual source title, aliases, metadata, full cover and inline chapters agree | ✅ Pass | 0.84s | — |
| Hijala | Complete chapter list is reused, sequentially indexed and paid hidden by default | ✅ Pass | 0.17s | — |
| Hijala | Paid preference persists across instances without enabling paid reading | ✅ Pass | 1.44s | — |
| Hijala | Reader produces ordered native page objects and actual first/middle/last image bytes | ✅ Pass | 0.93s | — |
| Hijala | A second real public chapter reads actual image bytes too | ✅ Pass | 0.54s | — |
| Hijala | Source headers are attached to native metadata and image requests | ✅ Pass | 0.00s | — |
| Hijala | Every current native discovery section resolves without stale Hot or fabricated genre cards | ✅ Pass | 8.61s | — |
| Hijala | Source-disabled known release tabs disappear and stale links do not fetch them | ✅ Pass | 1.15s | — |
| Hijala | Latest and rendered first-nine Popular snapshots match fresh website DOM ordering | ✅ Pass | 2.43s | — |
| Hijala | Canonical New and latest listings match public feed evidence | ✅ Pass | 3.90s | — |
| Hijala | Highest-chapter-count safe title has a complete real large chapter list | ✅ Pass | 2.37s | — |
| Hijala | A genuine live decimal chapter retains its number and reads actual image bytes | ✅ Pass | 1.31s | — |
| Hijala | Deep links preserve encoded IDs and reader links safely resolve to native series | ✅ Pass | 1.07s | — |
| Hijala | NSFW preference persists, known mature titles are excluded end to end | ✅ Pass | 4.44s | — |
| Hijala | Empty types and sections stay empty and native excluded genres are enforced | ✅ Pass | 3.40s | — |
| Hijala | Concurrent native preference callbacks merge without losing fields | ✅ Pass | 1.02s | — |
| Hijala | A read begun during a queued safety save waits before using old permissive cached results | ✅ Pass | 3.42s | — |
| Hijala | Unknown genre metadata fails closed using a fresh live catalog response | ✅ Pass | 2.76s | — |
| Hijala | Partial genre metadata retains valid tags and never bypasses an explicit genre exclusion | ✅ Pass | 4.69s | — |
| Hijala | Native rating authority includes fallback metadata, isolates warm caches and preserves explicit choices | ✅ Pass | 6.14s | — |
| Hijala | Filtered-empty first page advances native continuation from the consumed API page | ✅ Pass | 1.33s | — |
| Hijala | Repeated API pages fail explicitly instead of looping or duplicating native pages | ✅ Pass | 0.78s | — |
| Hijala | Settings changed during a live page2 request reject its stale result | ✅ Pass | 1.67s | — |
| Hijala | Native decimal numbers and semantic chapter titles survive live-derived mutation | ✅ Pass | 0.43s | — |
| Hijala | Earliest paid chapter is filtered before assigning zero-based native indexes | ✅ Pass | 0.41s | — |
| Hijala | Incomplete total and missing access status reject real detail data | ✅ Pass | 0.87s | — |
| Hijala | Protected, mismatched and malformed readers are rejected from fresh live responses | ✅ Pass | 3.44s | — |
| Hijala | Expired native pagination and raw caches refresh instead of pinning Latest forever | ✅ Pass | 1.65s | — |
| Hijala | Ordinary forbidden responses do not become Cloudflare or cross an access boundary | ✅ Pass | 0.59s | — |
| Hijala | Verified challenge responses use the source resolution URL | ✅ Pass | 0.26s | — |
| Hijala | No downloaded script execution or cross-series/invalid chapter fallback occurs | ✅ Pass | 1.26s | — |
| Hijala | Pagination mutation seed is captured once from current public metadata | ✅ Pass | 1.07s | — |
| Hijala | Native Most Chapters accepts the current source response and complete terminal catalog shape | ✅ Pass | 0.89s | — |
| Hijala | Only a complete unique first-page catalog may exceed the requested page size | ✅ Pass | 0.30s | — |
| Hijala | Partial physical-page overlap emits every ID once beyond the nominal last offset | ✅ Pass | 0.26s | — |
| Hijala | Duplicate-only nonterminal physical page is skipped and later fresh rows are never lost | ✅ Pass | 0.20s | — |
| Hijala | Repeated pages, page1 reset and TTL refresh do not carry emitted-ID exclusions | ✅ Pass | 1.09s | — |
| Hijala | Changed query and sort keep independent native continuation and emitted-ID state | ✅ Pass | 0.71s | — |
| Hijala | Changed persistent settings reset continuation without hiding prior IDs | ✅ Pass | 0.75s | — |
| Hijala | Another Target toggling off/on cannot revive an old same-value cursor or raw snapshot | ✅ Pass | 0.51s | — |
| Hijala | Allowed-rating contexts isolate cumulative IDs even across locally filtered pages | ✅ Pass | 0.09s | — |
| Hijala | Changed total fails explicitly and page1 can reset the failed snapshot | ✅ Pass | 0.35s | — |
| Hijala | Missing titles after duplicates and endless repeated pages fail instead of claiming terminal completion | ✅ Pass | 0.21s | — |
| Hijala | Untrusted totals, page counts and cumulative-ID state fail before unbounded traversal or allocation | ✅ Pass | 0.37s | — |
| Hijala | Malformed internal continuation fails before reading an unconsumed provider offset | ✅ Pass | 0.50s | — |
| Kagane | Built Mana bundle and source metadata | ✅ Pass | 0.02s | — |
| Kagane | Never-saved source categories follow native policy and explicit source selection persists | ✅ Pass | 6.33s | — |
| Kagane | Search pagination follows upstream completion, not the filtered result count | ✅ Pass | 0.55s | — |
| Kagane | Full title search, details, cover and series deep link retain identity | ✅ Pass | 2.48s | — |
| Kagane | English titles require explicit metadata and retain the original plus aliases | ✅ Pass | 0.39s | — |
| Kagane | Native search form preserves live taxonomy and grouped tag sheets | ✅ Pass | 0.05s | — |
| Kagane | Every native sort and exact-title mode makes a valid live request | ✅ Pass | 7.43s | — |
| Kagane | Include/exclude genres, grouped tags and typed tags use live IDs | ✅ Pass | 3.08s | — |
| Kagane | Unknown malformed and stale tags fail before search; valid native payloads remain exact | ✅ Pass | 0.73s | — |
| Kagane | Native numeric ranges serialize strictly before taxonomy and preserve policies, discovery and cached continuation | ✅ Pass | 0.80s | — |
| Kagane | Live chapter-count and start-year bounds constrain consumed bulk rows without changing native identity or order | ✅ Pass | 2.52s | — |
| Kagane | Format, status and uploader filters round-trip through the native request | ✅ Pass | 0.52s | — |
| Kagane | Negative search is an empty terminal page and invalid pages are rejected | ✅ Pass | 0.34s | — |
| Kagane | All six native discovery sorts preserve live API order and continuation | ✅ Pass | 0.00s | — |
| Kagane | A real 200-plus chapter list matches every live index ID exactly | ✅ Pass | 1.93s | — |
| Kagane | Current live series translation and unknown language preserve native chapter identity | ✅ Pass | 0.06s | — |
| Kagane | Repeated chapter/detail calls reuse bulk data instead of N-plus-one requests | ✅ Pass | 0.43s | — |
| Kagane | First and last actual chapter readers load image bytes with source headers | ✅ Pass | 1.88s | — |
| Kagane | Expired reader sessions refresh once per chapter and retain the actual page identity | ✅ Pass | 0.74s | — |
| Kagane | Data saver uses the supported query and still loads actual reader images | ✅ Pass | 3.13s | — |
| Kagane | Reader rejects a book from another series before requesting access | ✅ Pass | 1.05s | — |
| Kagane | Every rating category selects its exact modern class and an empty selection shows none | ✅ Pass | 5.19s | — |
| Kagane | Mixed rating selections and per-search or host limits cannot widen global choices | ✅ Pass | 1.09s | — |
| Kagane | Previously issued reader URLs cannot evade changed rating settings | ✅ Pass | 0.09s | — |
| Kagane | Setting persistence and explicit content exclusion apply even to title search | ✅ Pass | 2.07s | — |
| Kagane | Unknown and conflicting ratings fail closed for details, chapters and reading | ✅ Pass | 0.00s | — |
| Kagane | Incomplete rating metadata uses native Mature fallback without overriding known explicit evidence | ✅ Pass | 0.47s | — |
| Kagane | Native rating policy and accumulated IDs survive partial overlap and duplicate-only physical pages | ✅ Pass | 0.09s | — |
| Kagane | Changing safety preference invalidates an in-flight unfiltered response | ✅ Pass | 0.69s | — |
| Kagane | Malformed pagination and reader manifests are errors, not empty successes | ✅ Pass | 0.00s | — |
| Kagane | Test host permits only exact public Kagane operations and redacts reader tokens | ✅ Pass | 0.01s | — |
| MangaSushi | Built Mana bundle and source metadata | ✅ Pass | 0.02s | — |
| MangaSushi | Native rating policy is authoritative with no never-saved source cap and reusable context-neutral caches | ✅ Pass | 2.47s | — |
| MangaSushi | Live native parsers map incomplete metadata to Mature and keep actual adult warnings Explicit | ✅ Pass | 4.11s | — |
| MangaSushi | Native singleton ratings use only verified coarse source markers and never infer a Suggestive taxonomy | ✅ Pass | 5.18s | — |
| MangaSushi | Warm native search pages retain a newly observed adult warning instead of relabeling it Safe | ✅ Pass | 1.18s | — |
| MangaSushi | Native logical pagination passes excluded-only physical pages without losing later eligible IDs | ✅ Pass | 2.09s | — |
| MangaSushi | Native logical pagination passes duplicate-only physical pages without losing later eligible IDs | ✅ Pass | 1.90s | — |
| MangaSushi | Ordinary genre search proves native Action/Romance taxonomy and preserves exact continuation without added requests | ✅ Pass | 3.75s | — |
| MangaSushi | Cooking ignored-filter response fails visibly after one request, never as unrelated or false empty results | ✅ Pass | 0.72s | — |
| MangaSushi | Genre proof rejects ambiguous query syntax, missing/wrong taxonomy, unknown terms and unrelated raw metadata | ✅ Pass | 1.74s | — |
| MangaSushi | OR/AND genre proof uses real raw memberships and accepts recognized genuine empty searches | ✅ Pass | 0.47s | — |
| MangaSushi | Continuation retains initial native genre scope and rejects ignored or altered taxonomy without scans | ✅ Pass | 0.19s | — |
| MangaSushi | Explicitly saved NSFW exclusion uses native adult=0 | ✅ Pass | 1.10s | — |
| MangaSushi | Native catalog pagination advances without using filtered counts | ✅ Pass | 0.65s | — |
| MangaSushi | Full title search and safe details retain the canonical identity | ✅ Pass | 0.91s | — |
| MangaSushi | English aliases retain canonical IDs, original titles and complete comma-containing alternatives | ✅ Pass | 5.74s | — |
| MangaSushi | Japanese-only alternatives retain the original title in search and details | ✅ Pass | 2.22s | — |
| MangaSushi | Cold metadata classification still queries the source original, not its English display alias | ✅ Pass | 0.97s | — |
| MangaSushi | Removing an English alias from live metadata restores the original search and detail display | ✅ Pass | 1.19s | — |
| MangaSushi | Search exposes live genres, all statuses, site fields and seven orders | ✅ Pass | 0.87s | — |
| MangaSushi | Every native search order returns live results | ✅ Pass | 4.69s | — |
| MangaSushi | Native OR and AND genre conditions and author/artist/year/status filters | ✅ Pass | 7.26s | — |
| MangaSushi | Negative search returns a genuinely empty terminal page | ✅ Pass | 0.58s | — |
| MangaSushi | Preference callback persists across instances and unfiltered catalog is usable | ✅ Pass | 3.59s | — |
| MangaSushi | Discovery mirrors both site rows exactly with no invented popular continuation | ✅ Pass | 2.74s | — |
| MangaSushi | Popular, latest, search and detail covers use the largest advertised same-asset images | ✅ Pass | 2.28s | — |
| MangaSushi | Cover fallbacks reject malformed or unrelated metadata and retain explicitly advertised originals | ✅ Pass | 1.79s | — |
| MangaSushi | Unfiltered discovery keeps English titles with two cold requests and zero warm requests | ✅ Pass | 1.05s | — |
| MangaSushi | Sample details, asynchronous chapters, decimals and original labels | ✅ Pass | 0.77s | — |
| MangaSushi | Multiple readers preserve ordered lazy images and image bytes | ✅ Pass | 1.61s | — |
| MangaSushi | Editorial notices never become reading content, even with exclusion off | ✅ Pass | 1.08s | — |
| MangaSushi | Reader rejects mismatched identity, duplicate URLs and numbered page gaps | ✅ Pass | 0.30s | — |
| MangaSushi | Changing the preference invalidates an in-flight unfiltered response | ✅ Pass | 0.57s | — |
| MangaSushi | Unknown classification is blocked and malformed search is not an empty success | ✅ Pass | 2.96s | — |
| MangaSushi | Re-enabling global exclusion blocks cached NSFW detail, chapters, reader and deep links | ✅ Pass | 2.13s | — |
| MangaSushi | Filtered discovery preserves rows and only returns verifiably safe titles | ✅ Pass | 11.64s | — |
| MangaSushi | Setting changes invalidate a pending discovery metadata batch | ✅ Pass | 1.14s | — |
| MangaSushi | Malformed discovery metadata fails visibly instead of trusting home titles | ✅ Pass | 0.30s | — |
| MangaSushi | Read-only host rejects duplicate AJAX actions before any request | ✅ Pass | 0.00s | — |
| MangaSushi | Repeated provider pages stop within ten consecutive no-new-raw-ID reads | ✅ Pass | 1.54s | — |
| ManhwaNex | Built Mana bundle and source metadata | ✅ Pass | 0.02s | — |
| ManhwaNex | Native rating authority defaults to no extra source cap and replays raw cached pages under changed contexts | ✅ Pass | 1.39s | — |
| ManhwaNex | Native details use supported Mature fallback only for incomplete metadata and retain positive adult warnings | ✅ Pass | 1.82s | — |
| ManhwaNex | Native singleton policy skips excluded-only physical pages and never caches a reader policy | ✅ Pass | 2.21s | — |
| ManhwaNex | Explicitly saved source exclusion uses two cold requests and zero warm requests | ✅ Pass | 0.92s | — |
| ManhwaNex | Native home names, memberships, exact order and pagination are preserved | ✅ Pass | 1.02s | — |
| ManhwaNex | Largest source-advertised covers have real intrinsic image dimensions | ✅ Pass | 1.95s | — |
| ManhwaNex | Native safe search returns exact source page and next-page identities | ✅ Pass | 2.65s | — |
| ManhwaNex | Search form exposes only verified native taxonomy and Relevance sort | ✅ Pass | 0.48s | — |
| ManhwaNex | Native Action archive stays lazy, ordered and complete in both safety modes | ✅ Pass | 11.32s | — |
| ManhwaNex | Native Romance archive stays lazy, ordered and complete in both safety modes | ✅ Pass | 1.85s | — |
| ManhwaNex | Native Fantasy archive stays lazy, ordered and complete in both safety modes | ✅ Pass | 11.06s | — |
| ManhwaNex | Native Martial Arts archive stays lazy, ordered and complete in both safety modes | ✅ Pass | 5.78s | — |
| ManhwaNex | Native Adventure archive stays lazy, ordered and complete in both safety modes | ✅ Pass | 3.23s | — |
| ManhwaNex | Native Ghost archive stays lazy, ordered and complete in both safety modes | ✅ Pass | 1.71s | — |
| ManhwaNex | Native Cultivation archive stays lazy, ordered and complete in both safety modes | ✅ Pass | 1.82s | — |
| ManhwaNex | Native System archive stays lazy, ordered and complete in both safety modes | ✅ Pass | 3.09s | — |
| ManhwaNex | Concurrent lazy archive requests coalesce the native page and bounded metadata batch | ✅ Pass | 0.91s | — |
| ManhwaNex | Distinct native canonical aliases retain separate details and chapter inventories | ✅ Pass | 1.70s | — |
| ManhwaNex | Sequential native pages deduplicate real canonical overlap without losing later titles or terminal state | ✅ Pass | 22.25s | — |
| ManhwaNex | Pagination identity stays scoped to native query, category and current settings | ✅ Pass | 5.38s | — |
| ManhwaNex | Category continuation rejects foreign, switched, nonadvancing and wrong-context archives before following them | ✅ Pass | 5.12s | — |
| ManhwaNex | Raw archive adult evidence cannot be overwritten by complete safe batch metadata | ✅ Pass | 34.56s | — |
| ManhwaNex | All eight native genre filters and OR/AND semantics are honored | ✅ Pass | 5.08s | — |
| ManhwaNex | Native author and artist text filters work while source redirects fail visibly | ✅ Pass | 1.20s | — |
| ManhwaNex | Every source status and release filter uses native parameters | ✅ Pass | 2.30s | — |
| ManhwaNex | Source titles, punctuation, aliases, canonical metadata and deep links survive cold details | ✅ Pass | 2.13s | — |
| ManhwaNex | Source-issued images stay coherent across stale readers, cached writers, concurrent instances and store failures | ✅ Pass | 1.59s | — |
| ManhwaNex | Negative searches terminate honestly without repeating or inventing pages | ✅ Pass | 4.25s | — |
| ManhwaNex | All currently available chapters match the complete native AJAX list, including decimal identity | ✅ Pass | 0.32s | — |
| ManhwaNex | Native chapter pipeline preserves reported container and explicit-label volumes | ✅ Pass | 0.83s | — |
| ManhwaNex | Native oldest reader preserves image order and actual first/last bytes | ✅ Pass | 1.04s | — |
| ManhwaNex | Native newest reader preserves image order and actual first/last bytes | ✅ Pass | 0.99s | — |
| ManhwaNex | Native decimal reader preserves image order and actual first/last bytes | ✅ Pass | 0.93s | — |
| ManhwaNex | A second live title completes details, chapters, reader and both image endpoints | ✅ Pass | 1.12s | — |
| ManhwaNex | Explicit opt-out persists and per-search adult filtering cannot widen global exclusion | ✅ Pass | 2.38s | — |
| ManhwaNex | Unknown and explicit classifications fail closed without treating BL/demographics as adult labels | ✅ Pass | 12.95s | — |
| ManhwaNex | IDs, image origins and exact read-only POST routes reject unsafe inputs | ✅ Pass | 0.00s | — |
| ManhwaNex | Preference changes invalidate in-flight discovery and cannot repopulate stale caches | ✅ Pass | 0.47s | — |
| VortexScans | Built Mana bundle and source metadata | ✅ Pass | 0.03s | — |
| VortexScans | Catalog search returns usable highlights | ✅ Pass | 0.39s | — |
| VortexScans | Catalog pagination advances or explicitly ends | ✅ Pass | 0.24s | — |
| VortexScans | Title search finds a live catalog title | ✅ Pass | 0.21s | — |
| VortexScans | Live content details and cover image | ✅ Pass | 0.72s | — |
| VortexScans | Search form exposes live genres and sort options | ✅ Pass | 0.20s | — |
| VortexScans | Genre inclusion and exclusion affect live results | ✅ Pass | 1.34s | — |
| VortexScans | Home discovers all published sections | ✅ Pass | 0.23s | — |
| VortexScans | Home section: Featured (featured) | ✅ Pass | 0.89s | — |
| VortexScans | Home section: Popular Today (popular-today) | ✅ Pass | 0.32s | — |
| VortexScans | Home section: Latest Releases (latest) | ✅ Pass | 0.00s | — |
| VortexScans | Home section: New (new) | ✅ Pass | 0.39s | — |
| VortexScans | Home section: For beginners (collection:for-beginners) | ✅ Pass | 0.22s | — |
| VortexScans | Home section: Top Picks (collection:top-picks) | ✅ Pass | 0.25s | — |
| VortexScans | Home section: Fantasy Worlds (collection:fantasy-worlds) | ✅ Pass | 0.23s | — |
| VortexScans | Home section: Marathon Reads (collection:marathon-reads) | ✅ Pass | 0.25s | — |
| VortexScans | Home section: Completed Series (collection:completed-series) | ✅ Pass | 0.24s | — |
| VortexScans | Home section: Most Popular (most-popular) | ✅ Pass | 0.00s | — |
| VortexScans | Popular Today uses source-published originals with one homepage request | ✅ Pass | 1.08s | — |
| VortexScans | Popular Today metadata is source-bound and missing or invalid originals retain card images | ✅ Pass | 4.16s | — |
| VortexScans | Search and detail retain source originals including octet-stream WebP bytes | ✅ Pass | 0.53s | — |
| VortexScans | Live chapter list has unique IDs and oldest-first order | ✅ Pass | 0.20s | — |
| VortexScans | Chapter pages are nonempty unique URLs | ✅ Pass | 0.25s | — |
| VortexScans | First and last chapter images load with source headers | ✅ Pass | 0.08s | — |
| VortexScans | Series deep link resolves the same live content | ✅ Pass | 0.20s | — |
| VortexScans | Same-response synopsis maps nonempty text and permits genuine empty text without provider requests | ✅ Pass | 0.00s | — |
| VortexScans | Native policy distinguishes no policy from empty and captures current public catalog once | ✅ Pass | 0.45s | — |
| VortexScans | Native search distinguishes explicit chapter count from latest number and preserves home labels | ✅ Pass | 0.00s | — |
| VortexScans | Known source genres retain native classes and incomplete metadata uses Mature details fallback | ✅ Pass | 0.00s | — |
| VortexScans | Native concatenated pages survive partial overlap duplicate-only and rating-excluded physical pages | ✅ Pass | 0.01s | — |
| VortexScans | Discover and view-more retain exact native policy while sparse cards use supported fallback | ✅ Pass | 0.00s | — |
| VortexScans | All real home rows share one cold homepage and repeat without provider requests or N+1 | ✅ Pass | 2.07s | — |
| VortexScans | Featured Popular Today Latest Releases and monthly ranking match exact same-response website IDs order and originals | ✅ Pass | 0.02s | — |
| VortexScans | Bounded Featured Popular Today and monthly snapshots never advertise invented continuation | ✅ Pass | 0.00s | — |
| VortexScans | Latest View More starts at exact home36 then uses real native page2 with cumulative canonical IDs | ✅ Pass | 0.46s | — |
| VortexScans | Home36 continuation survives duplicate-only excluded-only overlap terminal pages and request-scoped policy | ✅ Pass | 0.00s | — |
| VortexScans | Same-response genre enrichment requires exact numeric ID and slug and retains positive warnings and Mature unknown fallback | ✅ Pass | 0.14s | — |
| VortexScans | Warm home snapshots rebind complete current native context and empty policy performs no provider work | ✅ Pass | 0.00s | — |
| VortexScans | Ambiguous or conflicting homepage ranking and changed release configuration fail visibly without alternate requests | ✅ Pass | 0.26s | — |
| VortexScans | Native detail to chapters to reader loads complete first and last image bodies with source headers | ✅ Pass | 0.86s | — |
| VortexScans | Native reader preserves canonical, numeric and persisted legacy owner IDs and decimal chapter references | ✅ Pass | 0.00s | — |
| VortexScans | Wrong or incomplete API chapter and owner identities fail without HTML fallback | ✅ Pass | 0.00s | — |
| VortexScans | Malformed native identities and foreign URLs reject before I/O; same-series wrong chapters reject after one API read | ✅ Pass | 0.00s | — |
| VortexScans | Authoritative locks, empty pages and API outages remain errors, never unrelated HTML pages | ✅ Pass | 0.00s | — |
| VortexScans | Malformed saved include and exclude genres fail before I/O without broadening search | ✅ Pass | 0.00s | — |
| VortexScans | Valid native genre IDs retain exact payload, sort, query and rating context without taxonomy requests | ✅ Pass | 0.00s | — |

</details>

<details>
<summary>Recent checks (last 24 runs)</summary>

| Checked (UTC) | Hijala | Kagane | MangaSushi | ManhwaNex | VortexScans | Run |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-10-16 06:02:57 UTC | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38858342066) |
| 2026-10-16 00:56:57 UTC | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38831668014) |
| 2026-10-15 22:48:20 UTC | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38818829286) |
| 2026-10-15 20:32:03 UTC | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38801561745) |
| 2026-10-15 20:25:09 UTC | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | ❌ Fail | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38800771139) |
| 2026-10-15 19:35:01 UTC | ✅ Pass | ✅ Pass | ✅ Pass | ❌ Fail | ❌ Fail | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38794101786) |
| 2026-10-15 17:36:13 UTC | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38777761970) |
| 2026-10-15 16:51:20 UTC | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | ❌ Fail | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38771520288) |
| 2026-10-15 15:28:39 UTC | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/38759506369) |
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
