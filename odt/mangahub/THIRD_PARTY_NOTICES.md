# Third-party notices

## Kagane

Kagane's tag grouping, normalization, and duplicate-tag handling are adapted from
[PoppingMangoSources/popmango-extensions-mana](https://github.com/PoppingMangoSources/popmango-extensions-mana/tree/cd6f32f4cea81f77b9c100ba73907e6a0de96148/src/Kagane),
commit `cd6f32f4cea81f77b9c100ba73907e6a0de96148`, licensed GPL-3.0-or-later. The API integration and parser behavior
also reference that project's Kagane implementation.

The Kagane rating compatibility rules, complete chapter-index traversal, and icon
are adapted from the GPL-3.0-or-later Kagane source in
[LucifersCircle/pirate.vodka-extensions](https://github.com/LucifersCircle/pirate.vodka-extensions/tree/ca243f65ceb69398713fc0d7d08f94eb155a43b2/src/Kagane),
reference publication `ca243f65ceb69398713fc0d7d08f94eb155a43b2`, based on the source originally copyright © 2026 Inkdex.

These adaptations remain licensed GPL-3.0-or-later, as is this repository. See LICENSE.

## Hijala

Hijala's icon, source taxonomy, bounded TanStack/Seroval literal decoder, and public
catalog/detail/chapter/reader parsing rules are adapted from
[LucifersCircle/pirate.vodka-extensions](https://github.com/LucifersCircle/pirate.vodka-extensions/tree/410d7e9aa659070d08458b889368b3eb6c746aa1/src/Hijala),
commit `410d7e9aa659070d08458b889368b3eb6c746aa1`, copyright © 2026 Lucifers Circle,
licensed GPL-3.0-or-later. The integration uses native Mana interfaces and does not
execute downloaded site scripts. These adaptations remain GPL-3.0-or-later. See LICENSE.

## Marumaru

Marumaru's icon is the unmodified source-brand PNG also distributed by
[LucifersCircle/pirate.vodka-extensions](https://github.com/LucifersCircle/pirate.vodka-extensions/blob/29e05c0fed61973ed41492cda624e1a718b2eef7/src/Marumaru/static/icon.png).
The source's branding is retained without redesign.

## QiScans

QiScans is adapted from the QiScans source in
[inkdex/general-extensions](https://github.com/inkdex/general-extensions/tree/6a38c563de092342fb8d07913a6ad7d3dcd05bf4/src/QiScans),
commit `6a38c563de092342fb8d07913a6ad7d3dcd05bf4` (0.9/stable),
copyright © 2026 Inkdex, developed by Lucifers Circle, licensed GPL-3.0-or-later.
The original source-brand PNG icon is retained unmodified.
The v1 route shapes, numbered chapter traversal, search normalization and
apostrophe fallback, discovery sections, and metadata/chapter/image parsing
contracts originate there. The adaptation uses native Mana contracts, with
additional completeness, URL and paid-content safeguards. These adaptations
remain GPL-3.0-or-later. See LICENSE.

## GenzToons

Mana-only adaptation of the GenzToons configuration and Keyoapp template in
[Nicartjay/PaperbackExt](https://github.com/Nicartjay/PaperbackExt/tree/a6ef7b8f4f96b37327ab27429fdea7f9e5d8a658/src/GenzToons),
commit `a6ef7b8f4f96b37327ab27429fdea7f9e5d8a658`, specifically
`src/GenzToons/main.ts`, `src/GenzToons/pbconfig.ts`, and
`src/utils/keyoapp/template.ts`, developed by nicartjay and keiyoushi.
Copyright 2024 Paperback Community. The original MIT permission and warranty
notice is retained in `licenses/genz-paperback-MIT`. The unmodified source-brand
icon comes from `src/GenzToons/static/icon.png` at the same pinned commit.
The adaptation adds native Mana HTTP/context contracts, exact canonical ownership,
complete public inventories and explicit paid-content guards, and remains
GPL-3.0-or-later under this repository's LICENSE. No new Paperback implementation.

## Bundled dependencies and browser polyfills

Full third-party license texts and original copyright notices are retained in
[licenses/](licenses/README.md), including Cheerio and its locked dependency
closure, html-entities, @mana-app/types, and builder-injected browser polyfills.
The collection and this file accompany the published bundles. These dependency
licenses are preserved separately from the repository's GPL-3.0-or-later license;
see [licenses/bundled-dependencies/INDEX.json](licenses/bundled-dependencies/INDEX.json)
for exact package provenance and the licenses README for builder-version limits.

## GourmetScans

GourmetScans' public Madara metadata selectors, chapter/reader format and icon are
adapted from [Inkdex madara-extensions](https://github.com/inkdex/madara-extensions/tree/3b123d33ee4fba9c53d752caae5bee6953b18f7b),
commit `3b123d33ee4fba9c53d752caae5bee6953b18f7b`, copyright © 2026 Inkdex,
GPL-3.0-or-later. Modified for native Mana on 2026-10-18 by Lucifers Circle.
No site JavaScript is evaluated. Paid/login-only chapters are not supported.

The bundled deterministic AES-CBC/MD5 reader decoding uses crypto-es 2.1.0.
Its full MIT and retained CryptoJS BSD/MIT notices are reproduced in
[licenses/crypto-es-LICENSE](licenses/crypto-es-LICENSE).

## VyManga (on-device test candidate)

VyManga catalog selectors, search parameters, manga slug identities, full chapter
href identities, decimal chapter extraction and public reader HTML parsing are
adapted from [PoppingMangoSources/general-extensions-mangago](https://github.com/PoppingMangoSources/general-extensions-mangago/tree/2ad28cd5155ef23b09fa2b85a9713ad511730bb6/src/VyManga),
commit `2ad28cd5155ef23b09fa2b85a9713ad511730bb6` (0.9/test, alpha.22),
copyright © 2026 Inkdex, developed by Popmango, GPL-3.0-or-later.
Mana adaptation copyright © 2026 Lucifers Circle. Original notices and developer
credit are retained. The unmodified source-brand PNG icon is retained from
`src/VyManga/static/icon.png` at the same pinned commit. The implementation uses the native Mana SDK, does not execute
site scripts, does not override the catalog base URL, and adds native content-policy,
issued-image and paid/login guards. Relative images use the final reader response
URL, not the catalog origin. Reader redirects, image bytes and complete manifests
remain unverified pending on-device tests. These adaptations remain GPL-3.0-or-later.
See LICENSE and the isolated trial feed documentation; this is not a production release.

## MangaHub isolated on-device candidate

MangaHub route/query shapes, chapter-title normalization and encrypted page-envelope
format are adapted from Elrulia's GPL-3.0-only Paperback 0.9 implementation:
https://github.com/Elrulia/paperback-extension/tree/d7f9ff1f53b8152d4b6947cd4f4a9d618857abfa/src/MangaHub
The original MangaHub source-brand icon is retained without modification.
Chapter owner fields also reference Nicartjay's MangaHub template:
https://github.com/Nicartjay/PaperbackExt/blob/a6ef7b8f4f96b37327ab27429fdea7f9e5d8a658/src/utils/mangahub/template.ts
Nicartjay's MIT notice is retained in licenses/MangaHub-Nicartjay-LICENSE.
Native Mana integration copyright © 2026 Lucifers Circle. The derived MangaHub
source files are GPL-3.0-only; see LICENSE for GPL version 3 terms.
The upstream quota-reset, rotating identity, fabricated history cookies and
alternative-cover lookup behaviors are not included. Native authenticated GCM
uses @mana-app/types and the application's native bridge, not custom cryptography.
This isolated candidate is not a live-verified production release.
