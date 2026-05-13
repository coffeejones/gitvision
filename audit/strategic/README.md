# Strategic — decisions, not bugs

These aren't items you fix. They're choices you make consciously.
Each has a real tradeoff that depends on where you take the product.

---

- [ ] **HMAC-signed owner tokens vs. opaque localStorage IDs** — covered functionally in `before-v1/` (the IDOR cluster), but the deeper question: do you want session-ownership to be "just trust the UUID" (current), "signed token" (HMAC, recommended for commercial), or "real authentication" (login, OAuth, multi-tenant)? Decide before committing to the HMAC approach — if real auth is coming in 6 months, HMAC is throwaway work.

- [ ] **God-component refactor timing** — `CodePanel.tsx` (1768 lines) and `Constellation.tsx` (1138 lines) are real complexity gravity. Refactoring them now while shipping diff-aware features on top adds change-risk for no user-facing benefit. Refactoring them post-v1 means you keep accumulating complexity for months. The honest call: when's the next time you'll touch them substantially? Refactor then, not on a dedicated sprint.

- [ ] **Tarball OOM / decompressed-size caps** (`lib/graph.ts:235, 247`) — flagged as HIGH in the audit but only matters for actively malicious or pathologically-large repos. For hobby/portfolio scope: skip. For commercial with adversarial inputs: add caps. The threat-model question is yours.

- [ ] **Symlink-following in walkers** (`lib/codeAnalysis/analyze.ts:213`) — flagged as security but only matters if an attacker can plant symlinks in a repo we extract. Tarball extraction is sandboxed, so the symlink would need to point *outside* the extracted dir — which `tar` extraction generally prevents. Verify the threat model is real before fixing.

- [ ] **`secretFindings` in unauth GET responses** — listed in IDOR cluster. But: if sessions are designed to be shareable via URL (and they are — that's the share feature), then GET-ing a session's content IS the design. The "fix" is to keep secretFindings out of the shared-by-URL session shape, not to lock down the whole GET. Decision: what's actually shareable?

- [ ] **Audit list size signal** — 224 findings on a hobby project is itself a signal. Either (a) the code-base has more complexity than its scope warrants and we have ongoing tech-debt accumulation, or (b) the audit agents are noisy and most isn't real. Probably some of both. Worth one self-check: are we accumulating complexity faster than features we can demo? If yes, slow feature velocity and pay down debt before launching.
