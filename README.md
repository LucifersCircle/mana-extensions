# GourmetScans unpublished Mana device preview

This isolated preview contains GourmetScans 0.0.1-alpha.6 only. It does not modify the stable repository or represent a hosted live-test pass. Keep your regular Mana repository unchanged.

Alpha.6 replaces the untyped search-backed Discover feed with the site's own Manga, Manhwa and Manhua taxonomy sections. These feeds provide explicit comic/text card types: Discover and its view-more lists admit only positively marked comic cards, excluding text/Novel and unknown cards before display. Provider ordering, exact IDs and raw-page pagination are retained. No per-title metadata requests or guessed title classifications are used. SHA256: 314b74f0872345a24eeb0f1d2e86ec1c2b722c3bab143efd1220f19eae2486a8.

Ordinary public HTTP200 reads verified all three taxonomy first pages and Manga/Manhwa second pages. The sampled first-page inventories contained 12/12/10 comic cards; second pages had 6 Manga and 12 Manhwa cards. These are sampled evidence, not hardcoded source totals. Typed document taxonomy, page, order and page-size metadata are checked before use. A filtered full page is not incorrectly treated as the end of pagination. A wholly empty raw catalog is rejected because no legitimate empty-state marker has been verified.

Limitation: general text search still uses provider cards with no type metadata, so an unclassified novel may appear there until its canonical detail page identifies Type Novel. Confirmed novels are blocked before chapters/reader and suppressed from later results within a bounded source-instance cache. No claim of complete text-search novel exclusion is made. Supported text-search filters and pagination remain unchanged.

The user reports the app developer's novel-capable build is not yet released. The experimental novel HTML path is disabled; prior trials remain in branch history for later. The alpha.2 login-lock inventory fix, exact identity/content-policy checks and encrypted comic reader are retained. The user confirmed one unspecified comic image chapter renders, not full-device/all-title verification.

Hosted run 39146861116 passed static/build and unchanged-existing-source proof but only 2/8 native capabilities due to a managed challenge and bounded test-browser warm-up timeout. No hosted live pass is claimed for this preview. It contains no browser helper or transport bypass.

Suggested device test: refresh this preview source to alpha.6 and reload Discover. Check the Manga, Manhwa and Manhua sections contain comics without first opening novel details, and that view-more stays within its section. A prior working comic should still read. General text-search limitations above remain. If Mana presents a challenge or error, report it rather than changing security settings.

## Corresponding source and reproduction

corresponding-source/ includes the exact Gourmet source, its shared content-rating policy, source icon and pinned build inputs. With Node 24, run npm ci, npm run typecheck, npm run lint and npm run build in that directory. Its dependencies are pinned by package-lock.json. The preview index changes only the repository label and source inventory; emitted source metadata and bundle bytes are unchanged.

Mana adaptation copyright 2026 Lucifers Circle, GPL-3.0-or-later. Original selectors, reader format and unmodified source-brand icon derive from Inkdex madara-extensions commit 3b123d33ee4fba9c53d752caae5bee6953b18f7b, copyright 2026 Inkdex. See LICENSE and THIRD_PARTY_NOTICES.md. Full crypto-es 2.1.0 MIT and retained CryptoJS BSD/MIT notices are in licenses/crypto-es-LICENSE. The locked Cheerio dependency closure, Mana type package and injected polyfill notices are retained under licenses/; see licenses/README.md for provenance.

This is not a stable update channel. Remove the preview repository from Mana after testing if desired. The remote preview branch must not be deleted as routine cleanup: this repository's branch-deletion workflow can modify published Pages content.
