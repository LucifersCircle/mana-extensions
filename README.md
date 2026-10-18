# GourmetScans unpublished Mana device preview

This isolated preview contains GourmetScans 0.0.1-alpha.3 only. It does not modify the stable repository or represent a hosted live-test pass. Keep your regular Mana repository unchanged.

This preview retains the alpha.2 login-lock inventory fix and adds an experimental native HTML document path for titles explicitly identified as novels. It preserves chapter identity, content policy, paid/login checks and the existing comic reader. Novel documents contain only escaped text, paragraphs and simple emphasis, with all provider attributes, styles and external resources removed. SHA256: 2977ca58d34b9027a70586747d4bb5bc9491f2fcb3d8cb0d84e1f58e09b466e4.

The saved free Star Chef chapter 1 response is used for offline native transport and sanitization checks; no copyrighted chapter fixture is included here. These checks do not establish that the iOS reader displays HTML. Actual native novel display remains a device check. The user confirmed basic preview operation and one unspecified image chapter rendering, not full reader validation.

Hosted run 39146861116 passed static/build and unchanged-existing-source proof but only 2/8 native capabilities due to a managed challenge and bounded test-browser warm-up timeout. No hosted live pass is claimed for this preview. It contains no browser helper or transport bypass.

Suggested device test: refresh this preview source to alpha.3, reopen Star Chef, With a Side of Regression details, then chapter 1. Check whether paragraphs and emphasis display as text. Also check A Kind Goblin's Bird chapter 34 (end), including its first and last comic images. If Mana presents a challenge or error, report the actual message rather than changing security settings. Confirm Mana/iOS versions when reporting results. This is an isolated device trial, not complete automated coverage.

## Corresponding source and reproduction

corresponding-source/ includes the exact Gourmet source, its shared content-rating policy, source icon and pinned build inputs. With Node 24, run npm ci, npm run typecheck, npm run lint and npm run build in that directory. Its dependencies are pinned by package-lock.json. The preview index changes only the repository label and source inventory; emitted source metadata and bundle bytes are unchanged.

Mana adaptation copyright 2026 Lucifers Circle, GPL-3.0-or-later. Original selectors, reader format and unmodified source-brand icon derive from Inkdex madara-extensions commit 3b123d33ee4fba9c53d752caae5bee6953b18f7b, copyright 2026 Inkdex. See LICENSE and THIRD_PARTY_NOTICES.md. Full crypto-es 2.1.0 MIT and retained CryptoJS BSD/MIT notices are in licenses/crypto-es-LICENSE. The locked Cheerio dependency closure, Mana type package and injected polyfill notices are retained under licenses/; see licenses/README.md for provenance.

This is not a stable update channel. Remove the preview repository from Mana after testing if desired. The remote preview branch must not be deleted as routine cleanup: this repository's branch-deletion workflow can modify published Pages content.
