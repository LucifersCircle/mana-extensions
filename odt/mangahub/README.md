# MangaHub isolated on-device trial

This is an unverified on-device trial, not a normal-feed release. It requires a
Mana version implementing the SDK 0.1.1 native AES-GCM bridge. Paperback is unchanged.
Candidate version: 0.0.1-odt.alpha.1.

Local static validation: 183 infrastructure checks, 156 existing source tests,
typecheck, lint and all 13 compiled bundle/metadata checks passed. The existing
12 bundles are byte-identical to the baseline build. Temporary synthetic checks
exercise guards and crypto plumbing; they are not actual provider or device tests.

Related request: https://github.com/LucifersCircle/mana-extensions/issues/74

## Add this test repository in Mana

https://raw.githubusercontent.com/LucifersCircle/mana-extensions/test/mangahub-odt/odt/mangahub/

Keep the normal repository installed. This separate repository contains only MangaHub.
A downloadable feed does not establish that the app can complete provider access.

## Device checks

1. Verify the MangaHub icon and source name. Open Discover and try ordinary search.
2. Open a title's details before chapters. Confirm title, cover and genre metadata;
   exercise native content-rating exclusions. Unknown ratings use an explained
   compatibility fallback, not an invented site classification.
3. Open an ordinary publicly readable chapter. Confirm its title, decimal chapter
   number when applicable, complete image order, and first and last actual pages.
   A nonempty URL or one screenshot alone does not verify the whole chapter.
4. Restart the app and repeat opening details before chapters. Report the exact
   displayed error if session bootstrap, owner validation or native decryption fails.
   Do not send cookies, access tokens or decryption keys.
5. Verify a genuine chapter subtitle and a missing/unknown date if available.
   Unknown dates are represented by the SDK-required epoch, not a real release date.

## Scope and safeguards

- Hosted/native provider access, actual chapter responses and reader image bytes
  have not been verified for this build. An earlier ordinary hosted chapter request
  returned HTTP 403 of unclassified origin. It was stopped and not retried.
- One ordinary homepage request may establish naturally issued in-memory session
  state. If none is issued, this trial stops. It does not fabricate reading history,
  clear access cookies, rotate user agents, reset quotas or use alternate routes.
- Denial, quota, login/payment and GraphQL errors stop processing. Missing or
  mismatched returned manga/chapter identity is an error, not a pages-only fallback.
- Encrypted manifests use authenticated native AES-GCM with strict key-ID checks.
  Authentication failure never returns decrypted content.
- No background retry or post-merge live test is requested. This branch is not
  merged, the normal feed is not changed, and the request remains unresolved pending
  actual device evidence and independent review.

See LICENSE and THIRD_PARTY_NOTICES.md for upstream attribution and bundled notices.

Corresponding source for this exact branch:
https://github.com/LucifersCircle/mana-extensions/tree/test/mangahub-odt/src/sources/MangaHub
