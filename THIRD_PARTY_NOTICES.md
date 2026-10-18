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

## GourmetScans

GourmetScans' public Madara metadata selectors, chapter/reader format and icon are
adapted from [Inkdex madara-extensions](https://github.com/inkdex/madara-extensions/tree/3b123d33ee4fba9c53d752caae5bee6953b18f7b),
commit `3b123d33ee4fba9c53d752caae5bee6953b18f7b`, copyright © 2026 Inkdex,
GPL-3.0-or-later. Modified for native Mana on 2026-10-18 by Lucifers Circle.
No site JavaScript is evaluated. Paid/login-only chapters are not supported.

The bundled deterministic AES-CBC/MD5 reader decoding uses crypto-es 2.1.0.
Its full MIT and retained CryptoJS BSD/MIT notices are reproduced in
[licenses/crypto-es-LICENSE](licenses/crypto-es-LICENSE).
