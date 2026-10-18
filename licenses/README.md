# Included dependency notices

These notices accompany the published `.mana` bundles. `../LICENSE` covers this
repository's GPL-3.0-or-later code; `../THIRD_PARTY_NOTICES.md` preserves adaptation
attributions. The dependency licenses below remain their respective licenses.
Redistributors should retain these files alongside the bundles, including when
copying an individual bundle out of the repository distribution.

## Locked application dependencies

`bundled-dependencies/` retains the unmodified license files and package metadata
for the complete locked dependency closure of Cheerio, html-entities and
@mana-app/types. Both entities versions (4.5.0 and 6.0.1) are included.
`bundled-dependencies/INDEX.json` records each package's exact version, installed
path, npm tarball URL and integrity from package-lock.json, and SHA-256 hashes of
the retained files. Package metadata is named `package-metadata.json` so tooling
does not resolve the notice directory as executable packages. This is a conservative dependency closure, not a claim that
every package contributes code to every tree-shaken bundle.

boolbase 1.0.0 declares ISC in its published package metadata but omits a standalone
license file. `boolbase-LICENSE` preserves the upstream copyright and full ISC text
from https://github.com/fb55/boolbase/blob/54811f01c797a6bb1c263183ae90b7dd627e0638/LICENSE,
verified byte-for-byte on 2026-10-18.

## Builder-injected browser polyfills

The Mana builder (@mana-app/dev 0.2.0, pinned in package-lock.json) injects browser
polyfills. Their existing legal banners remain unchanged in the bundles. Full
notice texts are additionally retained here:

- `buffer-LICENSE`: buffer 6.0.3 published LICENSE, copyright Feross Aboukhadijeh
  and other contributors (MIT).
- `base64-js-LICENSE`: base64-js 1.5.1 published LICENSE, copyright Jameson Little
  (MIT).
- `ieee754-LICENSE`: ieee754 1.2.1 published LICENSE, copyright Fair Oaks Labs, Inc. (BSD-3-Clause).
- `base64-LICENSE`: base-64 1.0.0 LICENSE-MIT.txt from
  https://github.com/mathiasbynens/base64/blob/v1.0.0/LICENSE-MIT.txt,
  copyright Mathias Bynens (MIT).

The first three versions identify the exact packages from which the full notice
texts were copied, not independently resolved versions of the opaque
builder-embedded code. base-64 1.0.0 is identified by its retained bundle banner.
`SHA256SUMS.json` pins every notice and metadata file in this directory except
itself. No dependency code, bundle bytes, source versions or provider behavior
are changed by adding these notices.

## Publication and maintenance

The publishing workflow runs `scripts/stage-notices.mjs` after the existing build
and bundle verification. It copies LICENSE, THIRD_PARTY_NOTICES.md and this entire
directory into the distribution without editing bundles or their manifest.
The offline report tests check the locked dependency closure, package provenance,
notice hashes and additive staging. Update the collection and recorded hashes
when changing a bundled dependency. No live provider checks are needed for a
notice-only change.
