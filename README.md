# GenzToons device-test preview (not a release)

EXPERIMENTAL / UNRELEASED. Native capability result: 6 of 7 pass; the image MIME
check remains failed. User device testing confirmed the original test title loads,
but did not confirm all 16 pages or general image compatibility.

Reviewed local build: GenzToons 0.0.1-alpha.2. This preview contains only this
source. It does not change the production repository/feed and has no workflows.

Known limitation: the provider returns genuine WebP pages as text/plain. The
shared MIME test remains failed; headers and image identities are not rewritten.
The user reports Senior Disciple Lee Hwe loads in Mana. The Necromancer Who Spares
No Expense, Chapter 20 instead failed a reader-manifest guard before image loading.
Alpha.2 only distinguishes invalid UID, duplicate UID and count/order failures;
it changes no acceptance rule and is not a fix for that chapter.

Add the supplied preview repository URL using Mana's normal repository action.
Confirm its name is GenzToons unpublished device test and the installed source
version is 0.0.1-alpha.2. A branch-based preview URL can receive later reviewed
updates; an immutable commit URL remains pinned. Keep the production repository.
Open The Necromancer Who Spares No Expense, public Chapter 20, and report the
complete error screenshot plus Mana/iOS versions. Do not test paid chapters or
change security settings. Stop on access/security barriers. No full HTML, raw UID,
cookies or headers are included in the diagnostic message.

Fresh provider validation is stopped after an ordinary detail request received
Cloudflare error 1010 (owner/browser-signature denial). No alternate identity or
route was attempted. Alpha.2 passed static/build, captured-data and negative checks;
it has not received a fresh native live pass. Original native result remains 6/7.

Remove the preview repository/source from Mana after testing if desired, without
removing the production repository. This preview is not a stable update channel.

Mana adaptation © 2026 Lucifers Circle, GPL-3.0-or-later (LICENSE). Keyoapp
selectors, UID loader and source icon adapted from nicartjay / keiyoushi in
Nicartjay/PaperbackExt commit a6ef7b8f4f96b37327ab27429fdea7f9e5d8a658,
Copyright 2024 Paperback Community. Original MIT notice: genz-paperback-MIT.

## Corresponding source and reproduction

Exact source and pinned build inputs are in corresponding-source/. With Node 24,
run npm ci and npm run build inside that folder. It contains only GenzToons plus
the shared rating-policy dependency. The source code and original MIT notice are
provided with this non-source bundle under the included license terms. The
repository name is deliberately changed in the public single-source test index;
the built extension body and emitted source metadata are unchanged.

The user successfully installed the original raw-GitHub preview and opened its
reader. A branch-based URL and alpha.2 refresh still require device verification.
If the repository URL is rejected, report that error rather than changing security
settings. This preview is not production CI or release verification.
