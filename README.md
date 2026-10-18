# GourmetScans unpublished Mana device preview

This isolated preview contains GourmetScans 0.0.1-alpha.5 only. It does not modify the stable repository or represent a hosted live-test pass. Keep your regular Mana repository unchanged.

Alpha.5 removes the experimental novel HTML reader path at the user's request. The user reports that the app developer's novel-capable build is not yet released. Titles positively identified by their own canonical detail page as Type Novel are rejected before a chapter list or reader can be returned. Their IDs are then suppressed from subsequent search/Discover results for the lifetime of this source instance, with a bounded cache. No title heuristics, extra per-title requests or unsupported query parameters are used. SHA256: 3df9a2e6cf97e9b65f9b34f989e8182c655ba50e17e57fd284322290eec6cd95.

Limitation: current provider search-backed cards have no type metadata, so an unclassified novel may still appear until its details identify it. This does not claim complete catalog-level novel exclusion. Search pagination and supported filters remain unchanged. The typed homepage and advertised taxonomy routes differ from this search-backed feed; no unverified replacement is used.

The alpha.2 login-lock inventory fix, exact identity/content-policy checks and encrypted comic reader are retained. The user confirmed one unspecified comic image chapter renders. This is not full-device or all-title verification. Novel trials remain in branch history for a future supported app build; no novel document is produced by this version.

Hosted run 39146861116 passed static/build and unchanged-existing-source proof but only 2/8 native capabilities due to a managed challenge and bounded test-browser warm-up timeout. No hosted live pass is claimed for this preview. It contains no browser helper or transport bypass.

Suggested device test: refresh this preview source to alpha.5. Star Chef details should report that novels are unavailable in the current Mana reader, with no unreadable chapter list. Refresh catalog/search afterward to check suppression of that known novel. Check a previously working comic chapter still renders. If Mana presents a challenge or error, report the actual message rather than changing security settings.

## Corresponding source and reproduction

corresponding-source/ includes the exact Gourmet source, its shared content-rating policy, source icon and pinned build inputs. With Node 24, run npm ci, npm run typecheck, npm run lint and npm run build in that directory. Its dependencies are pinned by package-lock.json. The preview index changes only the repository label and source inventory; emitted source metadata and bundle bytes are unchanged.

Mana adaptation copyright 2026 Lucifers Circle, GPL-3.0-or-later. Original selectors, reader format and unmodified source-brand icon derive from Inkdex madara-extensions commit 3b123d33ee4fba9c53d752caae5bee6953b18f7b, copyright 2026 Inkdex. See LICENSE and THIRD_PARTY_NOTICES.md. Full crypto-es 2.1.0 MIT and retained CryptoJS BSD/MIT notices are in licenses/crypto-es-LICENSE. The locked Cheerio dependency closure, Mana type package and injected polyfill notices are retained under licenses/; see licenses/README.md for provenance.

This is not a stable update channel. Remove the preview repository from Mana after testing if desired. The remote preview branch must not be deleted as routine cleanup: this repository's branch-deletion workflow can modify published Pages content.
