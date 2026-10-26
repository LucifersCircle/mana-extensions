# Pirate Vodka Extensions for Mana

Native extensions for Mana, with source-specific Discover, search, details,
chapters and readers. Available features depend on each website.

## Test layout

Extension implementation files live in `src/sources/<Source>/`. Source-specific
Jest tests live separately in `src/tests/<Source>/`, and shared policy tests live
directly in `src/tests/`. Keep new tests in these locations, not in extension
directories. These tests are excluded from compiled extension output.

The native live contracts and their infrastructure tests remain in `scripts/`.
Run `npm test` for Jest tests and `npm run test:report` for test infrastructure;
`npm run test:extensions` exercises the built sources against real responses.
Per-source test edits select their owning source; shared or uncertain dependencies
still require full live coverage.

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

Last checked: **2026-10-26 07:55:48 UTC** · [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/40288615006)
Live scope: all; 12/12 sources selected; 11 complete reports. Non-PR events run the full live suite
Selected tests: 68/87 passed; 5 failed; 6 Cloudflared; 8 blocked. Cloudflared and blocked tests are not verified passes.
Started: 2026-10-26 07:53:54 UTC
Tested commit: `784c888`

| Extension | Result | Passed | Failed | Cloudflared | Blocked | Duration |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| GenzToons | ✅ Pass | 8/8 | 0 | 0 | 0 | 7.61s |
| GourmetScans | ☁️ Cloudflared | 2/8 | 0 | 3 | 3 | 1.07s |
| Hijala | ✅ Pass | 8/8 | 0 | 0 | 0 | 5.49s |
| Kagane | ✅ Pass | 8/8 | 0 | 0 | 0 | 15.10s |
| MangaStash | ❌ Fail | 6/8 | 2 | 0 | 0 | 6.64s |
| MangaSushi | ✅ Pass | 8/8 | 0 | 0 | 0 | 7.23s |
| MangaTaro | ✅ Pass | 8/8 | 0 | 0 | 0 | 4.40s |
| ManhwaNex | ✅ Pass | 8/8 | 0 | 0 | 0 | 4.32s |
| Marumaru | ❌ Fail | 2/7 | 3 | 0 | 2 | 2.89s |
| QiScans | ☁️ Cloudflared | 2/8 | 0 | 3 | 3 | 0.74s |
| VortexScans | ✅ Pass | 8/8 | 0 | 0 | 0 | 4.00s |
| VyManga | ⚠️ Error | 0/0 | 0 | 0 | 0 | 0.03s |

VyManga: Source suite aborted before completion; remaining checks were not run. AssertionError [ERR_ASSERTION]: No native contract configuration for VyManga     at testNativeContract (file:///home/runner/work/mana-extensions/mana-extensions/scripts/native-contracts.mjs:161:3)     at file:///home/runner/work/mana-extensions/mana-extensions/scripts/live-tests.mjs:46:13     at process.processTicksAndRejection

<details>
<summary>Test output</summary>

| Extension | Test | Result | Duration | Failure |
| --- | --- | --- | ---: | --- |
| GenzToons | Native initialization and advertised capabilities | ✅ Pass | 0.00s | — |
| GenzToons | Native discovery schema and representative section | ✅ Pass | 1.98s | — |
| GenzToons | Native catalog search and offered continuation | ✅ Pass | 0.38s | — |
| GenzToons | Native details identity, metadata and complete cover bytes | ✅ Pass | 1.62s | — |
| GenzToons | Native complete chapter inventory, identity and ordering | ✅ Pass | 1.22s | — |
| GenzToons | Native reader identity, ordered manifest and first/last image bytes | ✅ Pass | 1.83s | — |
| GenzToons | Native advertised controls and representative filtered search | ✅ Pass | 0.53s | — |
| GenzToons | Native policy and image-origin guards fail before network | ✅ Pass | 0.00s | — |
| GourmetScans | Native initialization and advertised capabilities | ✅ Pass | 0.00s | — |
| GourmetScans | Native discovery schema and representative section | ☁️ Cloudflared | 0.11s | CloudflareError: The requested resource is Cloudflare protected     at RequestExecution.&lt;anonymous&gt; (evalmachine.&lt;anonymous&gt;:41:62410)     at Generator.next (&lt;anonymous&gt;)     at evalmachine.&lt;anonymous&gt;:41:54597     at new Promise (&lt;anonymous&gt;)     at __awaiter (evalmachine.&lt;anonymous&gt;:41:54238)     at RequestExecution.checkChallenge (evalmachine.&lt;anonymous&gt |
| GourmetScans | Native catalog search and offered continuation | ☁️ Cloudflared | 0.43s | CloudflareError: The requested resource is Cloudflare protected     at RequestExecution.&lt;anonymous&gt; (evalmachine.&lt;anonymous&gt;:41:62410)     at Generator.next (&lt;anonymous&gt;)     at evalmachine.&lt;anonymous&gt;:41:54597     at new Promise (&lt;anonymous&gt;)     at __awaiter (evalmachine.&lt;anonymous&gt;:41:54238)     at RequestExecution.checkChallenge (evalmachine.&lt;anonymous&gt |
| GourmetScans | Native details identity, metadata and complete cover bytes | ☁️ Cloudflared | 0.50s | CloudflareError: The requested resource is Cloudflare protected     at RequestExecution.&lt;anonymous&gt; (evalmachine.&lt;anonymous&gt;:41:62410)     at Generator.next (&lt;anonymous&gt;)     at evalmachine.&lt;anonymous&gt;:41:54597     at new Promise (&lt;anonymous&gt;)     at __awaiter (evalmachine.&lt;anonymous&gt;:41:54238)     at RequestExecution.checkChallenge (evalmachine.&lt;anonymous&gt |
| GourmetScans | Native complete chapter inventory, identity and ordering | ⏸️ Blocked | 0.00s | Error: Native prerequisite was not verified: Native details identity, metadata and complete cover bytes     at file:///home/runner/work/mana-extensions/mana-extensions/scripts/native-contracts.mjs:167:72     at check (file:///home/runner/work/mana-extensions/mana-extensions/scripts/live-tests.mjs:25:19)     at check (file:///home/runner/work/mana-extensions/mana-extensions/scripts/native-contracts |
| GourmetScans | Native reader identity, ordered manifest and first/last image bytes | ⏸️ Blocked | 0.00s | Error: Native prerequisite was not verified: Native complete chapter inventory, identity and ordering     at file:///home/runner/work/mana-extensions/mana-extensions/scripts/native-contracts.mjs:167:72     at check (file:///home/runner/work/mana-extensions/mana-extensions/scripts/live-tests.mjs:25:19)     at check (file:///home/runner/work/mana-extensions/mana-extensions/scripts/native-contracts.m |
| GourmetScans | Native advertised controls and representative filtered search | ⏸️ Blocked | 0.00s | Error: Native prerequisite was not verified: Native details identity, metadata and complete cover bytes     at file:///home/runner/work/mana-extensions/mana-extensions/scripts/native-contracts.mjs:167:72     at check (file:///home/runner/work/mana-extensions/mana-extensions/scripts/live-tests.mjs:25:19)     at check (file:///home/runner/work/mana-extensions/mana-extensions/scripts/native-contracts |
| GourmetScans | Native policy and image-origin guards fail before network | ✅ Pass | 0.00s | — |
| Hijala | Native initialization and advertised capabilities | ✅ Pass | 0.00s | — |
| Hijala | Native discovery schema and representative section | ✅ Pass | 1.41s | — |
| Hijala | Native catalog search and offered continuation | ✅ Pass | 1.02s | — |
| Hijala | Native details identity, metadata and complete cover bytes | ✅ Pass | 1.21s | — |
| Hijala | Native complete chapter inventory, identity and ordering | ✅ Pass | 0.23s | — |
| Hijala | Native reader identity, ordered manifest and first/last image bytes | ✅ Pass | 0.74s | — |
| Hijala | Native advertised controls and representative filtered search | ✅ Pass | 0.84s | — |
| Hijala | Native policy and image-origin guards fail before network | ✅ Pass | 0.00s | — |
| Kagane | Native initialization and advertised capabilities | ✅ Pass | 0.00s | — |
| Kagane | Native discovery schema and representative section | ✅ Pass | 4.47s | — |
| Kagane | Native catalog search and offered continuation | ✅ Pass | 1.91s | — |
| Kagane | Native details identity, metadata and complete cover bytes | ✅ Pass | 4.28s | — |
| Kagane | Native complete chapter inventory, identity and ordering | ✅ Pass | 0.51s | — |
| Kagane | Native reader identity, ordered manifest and first/last image bytes | ✅ Pass | 1.89s | — |
| Kagane | Native advertised controls and representative filtered search | ✅ Pass | 2.02s | — |
| Kagane | Native policy and image-origin guards fail before network | ✅ Pass | 0.00s | — |
| MangaStash | Native initialization and advertised capabilities | ✅ Pass | 0.00s | — |
| MangaStash | Native discovery schema and representative section | ❌ Fail | 0.89s | Error: MangaStash home section changed     at parseHome (evalmachine.&lt;anonymous&gt;:48:270399)     at Target.&lt;anonymous&gt; (evalmachine.&lt;anonymous&gt;:49:11801)     at Generator.next (&lt;anonymous&gt;)     at fulfilled (evalmachine.&lt;anonymous&gt;:41:1186)     at /home/runner/work/mana-extensions/mana-extensions/node_modules/@mana-app/types/dist/runtime/http-host.generated.js:293:55   |
| MangaStash | Native catalog search and offered continuation | ✅ Pass | 2.87s | — |
| MangaStash | Native details identity, metadata and complete cover bytes | ✅ Pass | 0.98s | — |
| MangaStash | Native complete chapter inventory, identity and ordering | ✅ Pass | 0.02s | — |
| MangaStash | Native reader identity, ordered manifest and first/last image bytes | ❌ Fail | 0.87s | Error: MangaStash reader owner mismatch     at parseReader (evalmachine.&lt;anonymous&gt;:48:279538)     at Target.&lt;anonymous&gt; (evalmachine.&lt;anonymous&gt;:49:15292)     at Generator.next (&lt;anonymous&gt;)     at fulfilled (evalmachine.&lt;anonymous&gt;:41:1186)     at /home/runner/work/mana-extensions/mana-extensions/node_modules/@mana-app/types/dist/runtime/http-host.generated.js:293:5 |
| MangaStash | Native advertised controls and representative filtered search | ✅ Pass | 0.96s | — |
| MangaStash | Native policy and image-origin guards fail before network | ✅ Pass | 0.00s | — |
| MangaSushi | Native initialization and advertised capabilities | ✅ Pass | 0.00s | — |
| MangaSushi | Native discovery schema and representative section | ✅ Pass | 1.77s | — |
| MangaSushi | Native catalog search and offered continuation | ✅ Pass | 2.02s | — |
| MangaSushi | Native details identity, metadata and complete cover bytes | ✅ Pass | 0.60s | — |
| MangaSushi | Native complete chapter inventory, identity and ordering | ✅ Pass | 0.61s | — |
| MangaSushi | Native reader identity, ordered manifest and first/last image bytes | ✅ Pass | 0.62s | — |
| MangaSushi | Native advertised controls and representative filtered search | ✅ Pass | 1.57s | — |
| MangaSushi | Native policy and image-origin guards fail before network | ✅ Pass | 0.00s | — |
| MangaTaro | Native initialization and advertised capabilities | ✅ Pass | 0.00s | — |
| MangaTaro | Native discovery schema and representative section | ✅ Pass | 0.67s | — |
| MangaTaro | Native catalog search and offered continuation | ✅ Pass | 1.15s | — |
| MangaTaro | Native details identity, metadata and complete cover bytes | ✅ Pass | 0.93s | — |
| MangaTaro | Native complete chapter inventory, identity and ordering | ✅ Pass | 0.75s | — |
| MangaTaro | Native reader identity, ordered manifest and first/last image bytes | ✅ Pass | 0.53s | — |
| MangaTaro | Native advertised controls and representative filtered search | ✅ Pass | 0.33s | — |
| MangaTaro | Native policy and image-origin guards fail before network | ✅ Pass | 0.00s | — |
| ManhwaNex | Native initialization and advertised capabilities | ✅ Pass | 0.00s | — |
| ManhwaNex | Native discovery schema and representative section | ✅ Pass | 0.93s | — |
| ManhwaNex | Native catalog search and offered continuation | ✅ Pass | 1.50s | — |
| ManhwaNex | Native details identity, metadata and complete cover bytes | ✅ Pass | 0.22s | — |
| ManhwaNex | Native complete chapter inventory, identity and ordering | ✅ Pass | 0.28s | — |
| ManhwaNex | Native reader identity, ordered manifest and first/last image bytes | ✅ Pass | 0.53s | — |
| ManhwaNex | Native advertised controls and representative filtered search | ✅ Pass | 0.82s | — |
| ManhwaNex | Native policy and image-origin guards fail before network | ✅ Pass | 0.00s | — |
| Marumaru | Native initialization and advertised capabilities | ✅ Pass | 0.00s | — |
| Marumaru | Native discovery schema and representative section | ❌ Fail | 2.53s | NetworkError: Live-test Chromium request failed or managed challenge did not finish     at transportError (evalmachine.&lt;anonymous&gt;:41:64131)     at RequestExecution.&lt;anonymous&gt; (evalmachine.&lt;anonymous&gt;:41:60389)     at Generator.throw (&lt;anonymous&gt;)     at rejected (evalmachine.&lt;anonymous&gt;:41:54248)     at /home/runner/work/mana-extensions/mana-extensions/node_modules/ |
| Marumaru | Native catalog search and offered continuation | ❌ Fail | 0.00s | NetworkError: Live-test Chromium request failed or managed challenge did not finish     at transportError (evalmachine.&lt;anonymous&gt;:41:64131)     at RequestExecution.&lt;anonymous&gt; (evalmachine.&lt;anonymous&gt;:41:60389)     at Generator.throw (&lt;anonymous&gt;)     at rejected (evalmachine.&lt;anonymous&gt;:41:54248)     at /home/runner/work/mana-extensions/mana-extensions/node_modules/ |
| Marumaru | Native details identity, metadata and complete cover bytes | ❌ Fail | 0.34s | NetworkError: Live-test Chromium request failed or managed challenge did not finish     at transportError (evalmachine.&lt;anonymous&gt;:41:64131)     at RequestExecution.&lt;anonymous&gt; (evalmachine.&lt;anonymous&gt;:41:60389)     at Generator.throw (&lt;anonymous&gt;)     at rejected (evalmachine.&lt;anonymous&gt;:41:54248)     at /home/runner/work/mana-extensions/mana-extensions/node_modules/ |
| Marumaru | Native complete chapter inventory, identity and ordering | ⏸️ Blocked | 0.00s | Error: Native prerequisite was not verified: Native details identity, metadata and complete cover bytes     at file:///home/runner/work/mana-extensions/mana-extensions/scripts/native-contracts.mjs:167:72     at check (file:///home/runner/work/mana-extensions/mana-extensions/scripts/live-tests.mjs:25:19)     at check (file:///home/runner/work/mana-extensions/mana-extensions/scripts/native-contracts |
| Marumaru | Native reader identity, ordered manifest and first/last image bytes | ⏸️ Blocked | 0.00s | Error: Native prerequisite was not verified: Native complete chapter inventory, identity and ordering     at file:///home/runner/work/mana-extensions/mana-extensions/scripts/native-contracts.mjs:167:72     at check (file:///home/runner/work/mana-extensions/mana-extensions/scripts/live-tests.mjs:25:19)     at check (file:///home/runner/work/mana-extensions/mana-extensions/scripts/native-contracts.m |
| Marumaru | Native policy and image-origin guards fail before network | ✅ Pass | 0.00s | — |
| QiScans | Native initialization and advertised capabilities | ✅ Pass | 0.00s | — |
| QiScans | Native discovery schema and representative section | ☁️ Cloudflared | 0.06s | CloudflareError: The requested resource is Cloudflare protected     at RequestExecution.&lt;anonymous&gt; (evalmachine.&lt;anonymous&gt;:41:62370)     at Generator.next (&lt;anonymous&gt;)     at evalmachine.&lt;anonymous&gt;:41:54561     at new Promise (&lt;anonymous&gt;)     at __awaiter (evalmachine.&lt;anonymous&gt;:41:54202)     at RequestExecution.checkChallenge (evalmachine.&lt;anonymous&gt |
| QiScans | Native catalog search and offered continuation | ☁️ Cloudflared | 0.31s | CloudflareError: The requested resource is Cloudflare protected     at RequestExecution.&lt;anonymous&gt; (evalmachine.&lt;anonymous&gt;:41:62370)     at Generator.next (&lt;anonymous&gt;)     at evalmachine.&lt;anonymous&gt;:41:54561     at new Promise (&lt;anonymous&gt;)     at __awaiter (evalmachine.&lt;anonymous&gt;:41:54202)     at RequestExecution.checkChallenge (evalmachine.&lt;anonymous&gt |
| QiScans | Native details identity, metadata and complete cover bytes | ☁️ Cloudflared | 0.33s | CloudflareError: The requested resource is Cloudflare protected     at RequestExecution.&lt;anonymous&gt; (evalmachine.&lt;anonymous&gt;:41:62370)     at Generator.next (&lt;anonymous&gt;)     at evalmachine.&lt;anonymous&gt;:41:54561     at new Promise (&lt;anonymous&gt;)     at __awaiter (evalmachine.&lt;anonymous&gt;:41:54202)     at RequestExecution.checkChallenge (evalmachine.&lt;anonymous&gt |
| QiScans | Native complete chapter inventory, identity and ordering | ⏸️ Blocked | 0.00s | Error: Native prerequisite was not verified: Native details identity, metadata and complete cover bytes     at file:///home/runner/work/mana-extensions/mana-extensions/scripts/native-contracts.mjs:167:72     at check (file:///home/runner/work/mana-extensions/mana-extensions/scripts/live-tests.mjs:25:19)     at check (file:///home/runner/work/mana-extensions/mana-extensions/scripts/native-contracts |
| QiScans | Native reader identity, ordered manifest and first/last image bytes | ⏸️ Blocked | 0.00s | Error: Native prerequisite was not verified: Native complete chapter inventory, identity and ordering     at file:///home/runner/work/mana-extensions/mana-extensions/scripts/native-contracts.mjs:167:72     at check (file:///home/runner/work/mana-extensions/mana-extensions/scripts/live-tests.mjs:25:19)     at check (file:///home/runner/work/mana-extensions/mana-extensions/scripts/native-contracts.m |
| QiScans | Native advertised controls and representative filtered search | ⏸️ Blocked | 0.00s | Error: Native prerequisite was not verified: Native details identity, metadata and complete cover bytes     at file:///home/runner/work/mana-extensions/mana-extensions/scripts/native-contracts.mjs:167:72     at check (file:///home/runner/work/mana-extensions/mana-extensions/scripts/live-tests.mjs:25:19)     at check (file:///home/runner/work/mana-extensions/mana-extensions/scripts/native-contracts |
| QiScans | Native policy and image-origin guards fail before network | ✅ Pass | 0.00s | — |
| VortexScans | Native initialization and advertised capabilities | ✅ Pass | 0.00s | — |
| VortexScans | Native discovery schema and representative section | ✅ Pass | 1.25s | — |
| VortexScans | Native catalog search and offered continuation | ✅ Pass | 0.69s | — |
| VortexScans | Native details identity, metadata and complete cover bytes | ✅ Pass | 0.72s | — |
| VortexScans | Native complete chapter inventory, identity and ordering | ✅ Pass | 0.56s | — |
| VortexScans | Native reader identity, ordered manifest and first/last image bytes | ✅ Pass | 0.27s | — |
| VortexScans | Native advertised controls and representative filtered search | ✅ Pass | 0.47s | — |
| VortexScans | Native policy and image-origin guards fail before network | ✅ Pass | 0.00s | — |
| VyManga | — | ⚠️ Error | — | Source suite aborted before completion; remaining checks were not run. AssertionError [ERR_ASSERTION]: No native contract configuration for VyManga     at testNativeContract (file:///home/runner/work/mana-extensions/mana-extensions/scripts/native-contracts.mjs:161:3)     at file:///home/runner/work/mana-extensions/mana-extensions/scripts/live-tests.mjs:46:13     at process.processTicksAndRejection |

</details>

<details>
<summary>Recent checks (last 24 runs)</summary>

| Checked (UTC) | GenzToons | GourmetScans | Hijala | Kagane | MangaStash | MangaSushi | MangaTaro | ManhwaNex | Marumaru | QiScans | VortexScans | VyManga | Run |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-10-26 07:55:48 UTC | ✅ Pass | ☁️ Cloudflared | ✅ Pass | ✅ Pass | ❌ Fail | ✅ Pass | ✅ Pass | ✅ Pass | ❌ Fail | ☁️ Cloudflared | ✅ Pass | ⚠️ Error | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/40288615006) |
| 2026-10-26 01:50:07 UTC | ✅ Pass | ☁️ Cloudflared | ✅ Pass | ✅ Pass | ❌ Fail | ✅ Pass | ✅ Pass | ✅ Pass | ❌ Fail | ☁️ Cloudflared | ✅ Pass | ⚠️ Error | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/40256016584) |
| 2026-10-25 23:21:54 UTC | ✅ Pass | ☁️ Cloudflared | ✅ Pass | ✅ Pass | ❌ Fail | ✅ Pass | ✅ Pass | ✅ Pass | ❌ Fail | ☁️ Cloudflared | ✅ Pass | ⚠️ Error | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/40244270940) |
| 2026-10-25 20:58:51 UTC | ✅ Pass | ☁️ Cloudflared | ✅ Pass | ✅ Pass | ❌ Fail | ✅ Pass | ✅ Pass | ✅ Pass | ❌ Fail | ☁️ Cloudflared | ✅ Pass | ⚠️ Error | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/40233161726) |
| 2026-10-25 17:55:33 UTC | ✅ Pass | ☁️ Cloudflared | ✅ Pass | ✅ Pass | ❌ Fail | ✅ Pass | ✅ Pass | ✅ Pass | ❌ Fail | ☁️ Cloudflared | ❌ Fail | ⚠️ Error | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/40218628302) |
| 2026-10-25 14:27:57 UTC | ✅ Pass | ☁️ Cloudflared | ✅ Pass | ✅ Pass | ❌ Fail | ✅ Pass | ✅ Pass | ✅ Pass | ❌ Fail | ☁️ Cloudflared | ✅ Pass | ⚠️ Error | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/40202217790) |
| 2026-10-25 09:55:14 UTC | ✅ Pass | ☁️ Cloudflared | ✅ Pass | ✅ Pass | ❌ Fail | ✅ Pass | ✅ Pass | ✅ Pass | ❌ Fail | ☁️ Cloudflared | ✅ Pass | ⚠️ Error | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/40182507808) |
| 2026-10-25 04:55:30 UTC | ✅ Pass | ☁️ Cloudflared | ✅ Pass | ✅ Pass | ❌ Fail | ✅ Pass | ✅ Pass | ✅ Pass | ❌ Fail | ☁️ Cloudflared | ✅ Pass | ⚠️ Error | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/40163534558) |
| 2026-10-24 23:49:11 UTC | ✅ Pass | ☁️ Cloudflared | ✅ Pass | ✅ Pass | ❌ Fail | ✅ Pass | ✅ Pass | ✅ Pass | ❌ Fail | ☁️ Cloudflared | ✅ Pass | ⚠️ Error | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/40144138004) |
| 2026-10-24 21:41:41 UTC | ✅ Pass | ☁️ Cloudflared | ✅ Pass | ✅ Pass | ❌ Fail | ✅ Pass | ✅ Pass | ✅ Pass | ❌ Fail | ☁️ Cloudflared | ✅ Pass | ⚠️ Error | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/40135203621) |
| 2026-10-24 18:52:01 UTC | ✅ Pass | ☁️ Cloudflared | ✅ Pass | ✅ Pass | ❌ Fail | ✅ Pass | ✅ Pass | ✅ Pass | ❌ Fail | ☁️ Cloudflared | ✅ Pass | ⚠️ Error | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/40122531815) |
| 2026-10-24 16:06:54 UTC | ✅ Pass | ☁️ Cloudflared | ✅ Pass | ✅ Pass | ❌ Fail | ✅ Pass | ✅ Pass | ✅ Pass | ❌ Fail | ☁️ Cloudflared | ✅ Pass | ⚠️ Error | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/40109909217) |
| 2026-10-24 12:16:30 UTC | ✅ Pass | ☁️ Cloudflared | ✅ Pass | ✅ Pass | ❌ Fail | ✅ Pass | ✅ Pass | ✅ Pass | ❌ Fail | ☁️ Cloudflared | ✅ Pass | ⚠️ Error | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/40093145721) |
| 2026-10-24 07:25:36 UTC | ✅ Pass | ☁️ Cloudflared | ✅ Pass | ✅ Pass | ❌ Fail | ✅ Pass | ✅ Pass | ✅ Pass | ❌ Fail | ☁️ Cloudflared | ✅ Pass | ⚠️ Error | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/40073967288) |
| 2026-10-24 02:03:05 UTC | ✅ Pass | ☁️ Cloudflared | ✅ Pass | ✅ Pass | ❌ Fail | ✅ Pass | ✅ Pass | ✅ Pass | ❌ Fail | ☁️ Cloudflared | ✅ Pass | ⚠️ Error | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/40052372520) |
| 2026-10-23 23:36:00 UTC | ✅ Pass | ☁️ Cloudflared | ✅ Pass | ✅ Pass | ❌ Fail | ✅ Pass | ✅ Pass | ✅ Pass | ❌ Fail | ☁️ Cloudflared | ✅ Pass | ⚠️ Error | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/40040400235) |
| 2026-10-23 20:33:29 UTC | ✅ Pass | ☁️ Cloudflared | ✅ Pass | ✅ Pass | ❌ Fail | ✅ Pass | ✅ Pass | ✅ Pass | ❌ Fail | ☁️ Cloudflared | ✅ Pass | ⚠️ Error | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/40019855894) |
| 2026-10-23 17:17:56 UTC | ✅ Pass | ☁️ Cloudflared | ✅ Pass | ✅ Pass | ❌ Fail | ✅ Pass | ✅ Pass | ✅ Pass | ❌ Fail | ☁️ Cloudflared | ✅ Pass | ⚠️ Error | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/39993635449) |
| 2026-10-23 12:13:57 UTC | ✅ Pass | ☁️ Cloudflared | ✅ Pass | ✅ Pass | ❌ Fail | ✅ Pass | ✅ Pass | ✅ Pass | ❌ Fail | ☁️ Cloudflared | ✅ Pass | ⚠️ Error | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/39951536428) |
| 2026-10-23 06:35:24 UTC | ✅ Pass | ☁️ Cloudflared | ✅ Pass | ✅ Pass | ❌ Fail | ✅ Pass | ✅ Pass | ✅ Pass | ❌ Fail | ☁️ Cloudflared | ✅ Pass | ⚠️ Error | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/39912226359) |
| 2026-10-23 01:38:40 UTC | ✅ Pass | ☁️ Cloudflared | ✅ Pass | ✅ Pass | ❌ Fail | ✅ Pass | ✅ Pass | ✅ Pass | ❌ Fail | ☁️ Cloudflared | ✅ Pass | ⚠️ Error | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/39885001222) |
| 2026-10-22 22:49:47 UTC | ✅ Pass | ☁️ Cloudflared | ✅ Pass | ✅ Pass | ❌ Fail | ✅ Pass | ✅ Pass | ✅ Pass | ❌ Fail | ☁️ Cloudflared | ✅ Pass | ⚠️ Error | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/39867518144) |
| 2026-10-22 19:35:26 UTC | ✅ Pass | ☁️ Cloudflared | ✅ Pass | ✅ Pass | ❌ Fail | ✅ Pass | ✅ Pass | ✅ Pass | ❌ Fail | ☁️ Cloudflared | ✅ Pass | ⚠️ Error | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/39841128760) |
| 2026-10-22 15:43:22 UTC | ✅ Pass | ☁️ Cloudflared | ✅ Pass | ✅ Pass | ❌ Fail | ✅ Pass | ✅ Pass | ✅ Pass | ❌ Fail | ☁️ Cloudflared | ✅ Pass | ⚠️ Error | [Run](https://github.com/LucifersCircle/mana-extensions/actions/runs/39807182316) |

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
- [MangaTaro](src/sources/MangaTaro)
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
- Public images reuse separate Cover and Page clients per source instance, with
  existing URL validation and provider headers. Same-role clients accept another
  valid URL, including the SDK's normal fragment stripping; no image ledger,
  metadata fetch or preference read is added. This is client allocation reuse,
  not a claim about native image caching or device performance.

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
  reading pages. Reader ownership, complete inventory and locked chapters are
  checked before a reader request; source-advertised image ownership is validated
  while parsing the metadata and reader response.
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
- Public-image transport uses two reusable native clients with strict asset-URL,
  origin and header checks, not persistent image permissions. Unissued valid
  public URLs are accepted, and returned URLs do not expire or get revoked when
  settings change. Native rating filtering remains request-local on metadata;
  the bounded metadata/chapter cache and optional source filter remain intact.
  This does not promise native app cache invalidation or image-display behavior.
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
- Setting changes invalidate metadata caches and active metadata/chapter results.
  Bounded, 24-hour title-classification evidence retains response ordering and
  observed warnings across callbacks; it is not an image permission ledger. One
  metadata-only generation high-water mark replaces the old image-grant scan on
  partial metadata resets; erasing all metadata keys is outside that guarantee.
  Final result checks inspect each title once, not each reader image, without
  additional provider requests.
- Public covers and pages reuse one HttpClient per origin, preserving strict
  source URL validation, GET, Referer and Accept headers. Transport does not read
  ObjectStore, fetch metadata, require prior issuance, expire URLs, remember native
  rating scopes or revoke public image bytes on a source-setting change. Legacy
  `MangaSushi.issuedImages` data is no longer read or written. Native application
  display, cancellation and cache behavior are not guaranteed by this transport.
- Filtered or duplicate-only pages are traversed within bounded limits without
  losing eligible titles. Verified donation/recruitment announcements are excluded
  as non-reading content.
- Exact punctuation-sensitive titles use verified source-title fallbacks; ordinary
  partial search is unchanged. Login, paid access and security gates are not bypassed.

Implementation: [`src/sources/MangaSushi`](src/sources/MangaSushi).
The [icon](assets/MangaSushi.png) comes from the website's published icon.

</details>

<details>
<summary>MangaTaro</summary>

[MangaTaro](https://mangataro.org/home) is a native Mana source. Its chapter
flow adapts the GPL-3.0-or-later [Inkdex MangaTaro implementation](https://github.com/inkdex/general-extensions/tree/0.9/stable/src/MangaTaro),
Copyright © 2026 Inkdex, with Mana-specific parsing and transport.

- Discover preserves Featured, Recently Added, Popular Manga, High Score Manga and
  Completed from one shared homepage response, plus the public Popular Chapters
  (Today), Manga by Status (Reading), Most Followed New Manga (7 Days) and Most
  Followed Manga (Today) feeds. A fresh successful load of all sections uses five document
  requests, shared within one source instance for three minutes; image loads and
  retries after a failed load are separate. Personal reading history and account notifications are not used.
- Public catalog search uses the website’s real JSON POST browse endpoint,
  with complete live tag/year/type/status choices, any/all tag matching and
  both directions of the website’s four sort keys. Text novels are omitted.
  Pagination follows the website’s empty-page terminator, not a guessed count.
- Details preserve full descriptions, alternate titles, creator credit, original
  release year and separately labeled MangaTaro user score. MAL identity is a
  tracker ID, not a replacement for the website’s user score.
- Full chapter pagination uses the public website’s timestamp/UTC-hour token,
  not login credentials. IDs, advertised totals and continuation progress are
  checked; subtitles, decimal numbers, special labels and group credits survive.
  Relative dates are approximate and unavailable dates use the unknown-date sentinel.
- The image reader preserves the complete ordered source manifest. Text chapters,
  locked/paid/login-only chapters and failed access responses are not bypassed.
- Covers and pages use reusable native HttpClient transports with the website
  Referer and explicit public URL validation. Actual advertised image URLs are
  retained without thumbnail rewriting. When a catalog card has no cover, the
  website’s exact placeholder is retained; it is not claimed to be a real cover.
  Public image handling has no persistent permission ledger.
- Adult/Hentai/Smut/18+/19+ labels are Explicit, Mature is Mature and Ecchi is
  Suggestive. Adult Cast, demographics and relationship labels do not imply an
  adult rating. Unclassified items use the documented Suggestive compatibility
  fallback, never an invented Safe label.

The eight compact native live checks cover discovery, paginated/text/combined
search, complete details/chapter inventory, reader order, real cover and first/last
image bytes, and guards. The host uses the official SDK, not a physical Mana
installation; device verification is separate. No account login is needed.

Implementation: [`src/sources/MangaTaro`](src/sources/MangaTaro).
The [icon](assets/MangaTaro.png) comes from the website’s published logo.

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
- Readers retain ordered source images. Separate reusable Cover/Page SDK clients
  validate the exact HTTPS URL, trusted host/path and native origin, and provide
  the required headers. Reader checks load actual image bodies.

**Settings and limitations**

- Native allowed-content-rating policy applies to search, discovery and details.
  Optional source NSFW exclusion also checks chapter access against verified
  metadata; an unset preference adds no silent adult cap. Known warnings remain
  authoritative across in-flight metadata and chapter work.
- Public images no longer require a persisted URL-to-title permission record.
  Unissued but valid public image URLs work. This extension no longer rechecks
  title policy or revokes returned URLs/in-flight images when settings change. Image transport
  does not read ObjectStore or refetch title metadata. Old `ManhwaNex.issuedImages`
  data is ignored and left untouched, with no library or global-cache migration.
  This intentionally removes the extra image-stage replay/revocation checks; it
  does not assert that Mana's native cache or UI implements equivalent checks.
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
- Cover and page transport each reuse one role-bound client per source instance,
  preserving the existing Referer and Accept headers without capturing image URLs.
  Same-role public URLs and SDK fragment stripping no longer require an exact URL match.
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

The CI runner executes the actual `.mana` bundle built by `@mana-app/dev` through
its installed official `@mana-app/types@0.1.0` HTTP runtime and real website
responses. Every source uses the same small native-method contract:

1. Initialization, version identity and advertised methods.
2. Discovery definitions and one representative content section.
3. Catalog search, one offered continuation, and exact title/ID lookup.
4. Content identity, metadata, complete cover image bytes and optional deep links.
5. The complete available chapter inventory, source IDs and native ordering.
6. One reader manifest and the first/last unique image's complete bytes.
7. Advertised search, sort and preference forms plus one representative filter.
8. Native policy and image-origin rejection before provider network activity.

A capability that is not advertised is recorded in `notApplicable`, not counted
as a passing test. Marumaru has no custom controls and therefore has seven rather
than eight contracts. Missing advertised methods, blocked requests, incomplete
inventories and unsupported native host operations remain failures. A successful
Node/Chromium check is not a physical-device test.

Image checks consume the full response body and validate PNG/JPEG/WebP container
boundaries and dimensions. Other formats fail as unverified rather than passing
from a file signature alone; these checks are not native pixel-rendering proof.

The default budget is 12 document/API requests and three image transfers per
source. Failed transport attempts count too. Kagane has a documented 20-document
budget for native taxonomy, editions, its complete multi-page chapter inventory
and reader bootstrap. Requests stop before exceeding the limit; chapter lists
are never truncated to make a budget pass. The report retains measured request
counts and the reason for any exception. Method outputs, native source caches
and the exact consumed responses are reused; no duplicate reference fetches,
per-card detail sweeps, all-section loops or automatic retry loops are added.

Layout, exact section counts, all-sort/filter permutations and broader regression
sweeps are developer-only diagnostics, available separately with `npm run
test:local`. That command refuses CI and writes `bundles/local-test-results.json`,
not the CI report. Static checks, existing native policy/transport guards and
report/discovery infrastructure tests are separate from the live source counts.
The CI report preserves individual pass/fail results, timestamps and the exact
tested commit. Missing, malformed or incomplete reports still fail closed;
changed-source PR runs do not become full-source history entries.

Mana's official [development CLI](https://github.com/Mana-iOS/mana-dev) provides
build/serve commands, not a dedicated live source test suite. Its build-time
emulator rejects network access, so it is not used as live-test evidence. The live host supplies the official HTTP runtime with operation-scoped body storage, cancellation, and constrained real transport; it does not reimplement HttpClient. This adapter is not
the iOS app: it does not validate native UI rendering, persistent cookies/stores,
WKWebView-specific behavior or interactive Cloudflare/vShield resolution. CI explicitly opts into a test-only
Chromium transport for Kagane's exact public API routes and cover images and
Marumaru's public catalog/search/work and advertised reader GET routes, using
separate anonymous, short-lived FlareSolverr sessions for each host. JSON POST bodies and actual binary
image bytes are preserved. Warm-up waits for ordinary noninteractive managed
checks only: CAPTCHA controls are never clicked, and an explicit CAPTCHA or browser
security warning stops the test. TLS verification stays enabled. The native source
still uses Mana's built-in CloudflareError flow; no helper is bundled in extensions.
Marumaru's bundled [icon](assets/Marumaru.png) preserves the same source-brand PNG used by the Paperback extension.
Marumaru uses the site's ordinary JSON catalog/search/work APIs and the exact public
reader API advertised by each work. Metadata, complete chapter inventories and reader
pages use reusable SDK HTTP clients; no WebView navigation or per-card detail request
is needed. The complete advertised inventory is validated before hiding only chapters with
`ready === false`; unknown availability remains visible. Native chapter IDs, numbers,
labels and order are preserved, including multipart labels. Refreshing the chapter
list rechecks bulk availability without per-chapter requests. Counts and first/last
page comparisons come from live advertised inventories, not saved provider fixtures.

Title access is persisted separately from catalog snapshots so overlapping
source contexts cannot erase a completed detail grant. Grants retain their native
rating scope, original one-hour lifetime and revocation generation; positive adult
evidence cannot be downgraded by a stale catalog snapshot. Missing or expired access
still requires a successful title refresh with native content-policy context.

Cover and page images use separate reusable SDK clients and synchronous transport
factories. Stateless request/response interceptors retain exact-URL, role-specific
trusted-path, native-origin, GET and header checks without ObjectStore or per-image
metadata requests. Valid public URLs no longer require issuance, expire with metadata,
or get revoked by later metadata/access changes. Legacy image records are ignored and
omitted from subsequent metadata writes; this is not a library or app-cache migration.
Request-local native rating filters, bounded title/access arrays, one-hour evidence
lifetimes and contextless chapter access checks remain. Final metadata and reader checks retain
positive adult evidence, policy revision and access-generation safeguards. This does
not claim native display, cancellation or cache behavior. The SDK's native Cloudflare
challenge handling is unchanged. API and image clients send the Marumaru site origin as Referer;
X-Site remains limited to the Marumaru site API. The source does not replace the native host's User-Agent: the
current Mana SDK has no Paperback-style default-UA getter, so a Node-host check
must not be reported as proof of the iOS host's identity. In CI, the catalog API
uses Chromium's ordinary anonymous browser identity because the provider returns
HTTP 406 `/seo-gate` to the Node transport. Its advertised reader API has a separate
anonymous browser session for Cloudflare challenges seen on the CI runner.
The unchanged native source receives the actual response status, headers and body.
Reader images remain direct. After a native cover `CloudflareError` with the exact
requested URL and a `cf-mitigated: challenge` response, the test host can resolve
that same cover through the ordinary title-page hero load. The existing resolver
requires matching network evidence, complete bytes and a decoded image, then
reruns the source's native image authorization/response interceptors. Its single
browser capture counts alongside the failed native attempt and two reader images
against Marumaru's four-transfer limit. An `application/octet-stream` cover must return its
exact requested URL and pass independent full JPEG/PNG/WebP container/dimension checks.
The test-only WebView/browser image adapter is not part of Marumaru's source.
Passing the SDK test host is not physical iOS device validation.
Without FLARESOLVERR_URL, local network checks use ordinary direct requests,
challenges fail visibly, and WebView-dependent checks report a missing real browser
rather than being skipped or receiving substitute data. New sources must support the exercised contract; unsupported host
APIs or incomplete suites fail closed and need explicit support.
The host supports GET/HEAD, MangaSushi’s two verified read-only AJAX operations,
and Kagane’s exact public search, uploader-list and reader bootstrap/manifest POST
routes. Other POST operations fail closed. Ephemeral reader tokens are redacted
from retained logs; browser cookies, integrity tokens and reader responses are not
logged. Reader image requests, including kstatic.to, stay direct and their real
first/last image bytes are checked. Its small process-local ObjectStore supports native preference reads, not proof of iOS persistence. Broader callback/revocation regressions remain available in local diagnostics and the existing zero-network infrastructure guards. No new offline fixtures or permanent
parser tests are added.

Run the same checks locally with Node 24:

```sh
npm ci
npm test
npm run typecheck
npm run lint
npm run build -- --output dist
npm run verify:bundles
npm run test:extensions
```

To use the same Kagane browser transport and retained test-only WebView host locally:

```sh
docker compose up -d --build --wait
FLARESOLVERR_URL=http://127.0.0.1:8191 npm run test:extensions
docker compose down
```

The helper port is bound only to 127.0.0.1. CI does not retain browser logs or
response bodies.

## Development

This repository pairs `@mana-app/dev@0.2.0` with `@mana-app/types@0.1.0`.
Its rebuilt extensions use the new HTTP/image transport contract, not the legacy
NetworkClient/image-hook API. Use the corresponding new Mana app build; the SDK
release does not document a minimum app version, so no guessed version gate is
published. Chromium/Node results do not establish physical-device compatibility.
CI independently verifies the full source inventory, bundle versions and both
cover/page intent bits after every build; a successful CLI exit alone is insufficient.

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
