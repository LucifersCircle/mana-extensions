# VyManga on-device test candidate

Version: 0.0.1-alpha.1. This isolated feed is a test build, not a verified release.
It is not published to the normal Mana repository and is not merged into generic.
Related request: https://github.com/LucifersCircle/mana-extensions/issues/73

## Add the isolated test repository in Mana

Use this repository URL in Mana's repository manager:

https://raw.githubusercontent.com/LucifersCircle/mana-extensions/test/vymanga-odt/odt/vymanga/

Select VyManga version 0.0.1-alpha.1. Do not replace the normal production repository.
If Mana rejects the raw-GitHub repository URL, report the exact error. The SDK feed
layout is verified, but importing this raw-GitHub feed has not yet been tested in
Mana on a device. No default-branch or GitHub Pages deployment is needed for this feed.

## What to verify on your device

1. Discover sections, text search, a genre filter and an offered next page.
2. Open a title's details before its chapters. Check its actual title, cover,
   description and genres. Test Mana's rating exclusions too.
3. Check a decimal chapter and a genuine chapter subtitle if available.
4. Open the chapter previously shown in your screenshot: Don't Mess With Puppy,
   chapter 73 / SS19, server 5. Report the actual final reader URL/domain and any
   other reader domains reached by chapters. The source follows only chapter links
   issued by the title's public inventory; it does not guess alternate servers.
5. Verify the full page sequence, first and last page, and that pages are chapter
   content rather than just a promotional image. A screenshot of one image does
   not prove complete reading. Paid/login-only chapters are intentionally excluded.
6. Restart Mana and reopen details and the chapter before retrying images: issuance
   and policy state are intentionally in memory. Image allowlisting is provenance,
   not revocable permission; already issued public URLs and cached bytes are not revoked
   by a later rating-policy change. Report any displayed error verbatim.

## Important limits

- No live site or reader requests were made to verify this candidate.
- Automated native live validation remains pending; there is deliberately no live
  contract registered for VyManga yet, so unchanged CI fails before VyManga network I/O.
  This is not a live pass or a reason to merge/close the request.
- Catalog origins are mangavyvy.net and mangavyvy.com. Reader links/redirects can use
  other public HTTPS domains only when the public title inventory issued the chapter
  link. Relative page images resolve against the final reader URL. No site JavaScript,
  paid/login access, CAPTCHA solving, credential handling or TLS weakening is added.
- Page parsing prefers div.carousel-item[data-page] images. The lozad/d-block fallback
  is restricted to an identifiable reader container rather than arbitrary page images.
  Unknown layouts fail clearly instead of returning logos or a guessed manifest.
- Source-genre evidence maps explicit/mature genres; otherwise Mana's documented
  Suggestive compatibility fallback applies. It is not a verified site age rating.
- Missing/unparseable chapter dates use the epoch because the pinned SDK requires a
  Date; this means unknown, not a real 1970 publication date. No translated metadata
  or rating score is invented. Paperback has not been changed by this candidate.

GPL-3.0-or-later. Copyright © 2026 Inkdex and © 2026 Lucifers Circle.
Adapted from Popmango's VyManga at pinned commit
2ad28cd5155ef23b09fa2b85a9713ad511730bb6. See LICENSE, THIRD_PARTY_NOTICES.md and licenses/.

## Build and review evidence for this candidate

- Original repository Jest suite: 156/156 passed; no new offline fixture test layer
  is included in this branch.
- Test/report infrastructure: 177/177 passed.
- Typecheck passed. Lint passed with the same 15 existing warnings, none in VyManga.
- Native build and independent bundle/metadata verification: all 12 sources passed.
- Independent compiled SDK-bridge synthetic checks passed for source identities,
  decimals, subtitles, final-reader-relative images, ordered repeated pages, image
  origins and Referer, paid guards, native resource cleanup, and four rating-policy
  concurrency scenarios. Literal escaped HTML entity fidelity was checked too.
- VyManga bundle SHA-256:
  bcb82adfc4ad8aa6438d231ba80da5dd1e98ac44ec3dd41abd74145ad469a634
- Feed manifest SHA-256:
  53c0e7e932762d48783090f39659aeaf2e9b8340a74b3f3d99ed41125586da0c

These checks establish a reviewed build candidate, not live behavior, successful
in-app feed import, actual image validity, complete reader sequence or ODT success.
