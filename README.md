# GourmetScans unpublished Mana device preview

This isolated preview contains GourmetScans 0.0.1-alpha.1 only. It does not modify the stable repository or represent a hosted live-test pass. Keep your regular Mana repository unchanged.

The unchanged reviewed source bundle is from PR91 head abbfe4c4b95e8c44258db16690ba2be48e90d13f. SHA256: 90afff3b0868a28dbcb0179c54b82803680c7b75e6649da9197774a54665d689.

Current hosted run 39143086521 passed static/build and unchanged-existing-source proof but only 2/8 native capabilities. Its first document received a managed challenge; the anonymous test browser timed out without fetching an assisted document. This preview contains no test-host browser helper or transport bypass. Native app behavior remains unverified.

Suggested device smoke test: install this preview source, open its catalog, search for A Kind Goblin's Bird, open details and its chapter list, then Chapter 34 (end). Check whether actual reader pages render, including first and last. If Mana presents a challenge or error, report the actual message rather than changing security settings. Confirm your Mana/iOS versions when reporting results. This smoke test does not claim complete automated coverage.

## Corresponding source and reproduction

corresponding-source/ includes the exact Gourmet source, its shared content-rating policy, source icon and pinned build inputs. With Node 24, run npm ci, npm run typecheck, npm run lint and npm run build in that directory. Its dependencies are pinned by package-lock.json. The preview index changes only the repository label and source inventory; emitted source metadata and bundle bytes are unchanged.

Mana adaptation copyright 2026 Lucifers Circle, GPL-3.0-or-later. Original selectors, reader format and unmodified source-brand icon derive from Inkdex madara-extensions commit 3b123d33ee4fba9c53d752caae5bee6953b18f7b, copyright 2026 Inkdex. See LICENSE and THIRD_PARTY_NOTICES.md. Full crypto-es 2.1.0 MIT and retained CryptoJS BSD/MIT notices are in licenses/crypto-es-LICENSE. The locked Cheerio dependency closure, Mana type package and injected polyfill notices are retained under licenses/; see licenses/README.md for provenance.

This is not a stable update channel. Remove the preview repository from Mana after testing if desired. The remote preview branch must not be deleted as routine cleanup: this repository's branch-deletion workflow can modify published Pages content.
