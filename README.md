# GenzToons device-test preview (not a release)

EXPERIMENTAL / UNRELEASED. Native capability result: 6 of 7 pass; the image MIME
check remains failed and actual device compatibility is unverified.

Reviewed local build: GenzToons 0.0.1-alpha.1. This preview contains only this
source. It does not change the production repository/feed and has no workflows.

Known limitation: the provider returns genuine WebP pages as text/plain. The
shared MIME test remains failed; actual Mana reader rendering is unverified.
No image headers or identities are rewritten. Use only to test this limitation.

Once its exact preview repository URL is supplied, add that URL with Mana's normal
repository-add action. Confirm the repository name says GenzToons unpublished
device test. Install GenzToons alpha.1 from this preview, open Senior Disciple Lee
Hwe, and read public Chapter 1. Check all 16 pages, including first and last;
close and reopen the reader. Report Mana build/iOS version and exact errors, if
any. Stop on access or security barriers; do not use paid chapters.

Remove this preview repository/source from Mana after testing, without removing
the production repository. Do not expect this preview to receive updates.

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

Raw-GitHub repository import is itself unverified in Mana. Official developer
code establishes this static layout, not the importer’s allowed hosts or MIME
rules. If the repository URL is rejected, report that error rather than changing
security settings. This preview is not production CI or release verification.
