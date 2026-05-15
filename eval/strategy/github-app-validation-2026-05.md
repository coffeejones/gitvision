# GitHub App end-to-end validation — 2026-05-15

_Records the first real-world run of the GitVision PR-bot from webhook
delivery to posted comment. Captured immediately after the run so the
trail is concrete, not reconstructed. Skitse:
`github-app-skeleton-2026-05.md`._

## What we tested

After Commits 1-8 of the skeleton implementation shipped to production
(branch `main`, commit `a2c6acc`), we registered the GitHub App on
github.com and ran a single end-to-end test:

- **App**: `GitVision-PR` (registered on `coffeejones` personal account)
- **Permissions**: Contents: Read, Pull requests: Read & Write, Metadata: Read
- **Events subscribed**: Pull request, Installation
- **Webhook URL**: `https://gitvision.net/api/github/webhook`
- **Repo installed on**: `coffeejones/gitvisionTest` (public, freshly created)
- **Test PR**: branch `test-pr-1` → `main`, modified `hello.py::is_even`
  (complexity 1 → 4, Δ+3)

## Verifying the route was live before opening the PR

```
curl -X POST https://gitvision.net/api/github/webhook
→ HTTP 400 "Missing required webhook headers"
```

That's the all-systems-go signal: route exists (no 404), webhook
secret is configured (no 503), signature verifier is correctly
rejecting requests without `X-Hub-Signature-256` and `X-GitHub-Event`.

## Webhook traffic observed in Railway logs

Two webhooks fired during install (BEFORE the test PR opened):

1. `installation.created` — when the app was installed on `gitvisionTest`
2. `ping` — GitHub's standard webhook-config verification

Both returned `200 OK` in ~130ms. The handler's filter for installation
events accepted both correctly and our HMAC signature verification
worked end-to-end on live GitHub-issued signatures (not synthetic test
ones).

Then the test PR fired the actual pipeline:

3. `pull_request.opened` — analyzed `coffeejones/gitvisionTest#1`

## End-to-end pipeline output

The full chain ran without intervention:

1. **Webhook receiver** — verified signature, parsed event, dispatched
2. **Filters** — public ✓, non-draft ✓, human author ✓, repo size ✓,
   rate limit ✓ — all passed, returned `accepted` with backgroundWork
3. **`after()` scheduler** — heavy work scheduled detached from the 200 response
4. **Pipeline orchestration** — concurrency slot acquired, then:
   - `analyzeRepo` at base SHA → snapshot (with `codeGraph`)
   - `analyzeRepo` at head SHA → snapshot (with `codeGraph`)
   - `createSession` × 2 with `installationId` tagged
   - `computeDiff` → diff summary
   - `evaluateVerificationRules` → 0 suggestions (Δ+3 was under the
     calibrated Δ≥4 threshold for `complexity-increase-without-test`)
5. **Comment formatter** — rendered empty-state body ("Nothing notable
   on this PR ✅") because suggestions array was empty
6. **Poster** — paginated existing comments, no marker found, called
   `octokit.rest.issues.createComment` with installation-scoped auth
7. **Concurrency slot released** in finally block

Total wall-clock from PR opened to comment posted: <60s on this small repo.

## Posted comment (as it appeared on the PR)

```markdown
GitVision Review

Diff summary: 1 file changed · functions: 1 modified · net complexity +3

Nothing notable on this PR ✅ — no critical/warning signals fired from
our rules engine.

Full analysis ↗ · Signals computed deterministically — no LLM in this comment
```

Posted by user `gitvision-pr[bot]` (the installation-authenticated
identity GitHub assigns), with our invisible HTML marker comment
`<!-- gitvision:pr-review v1 -->` at the top so future `synchronize`
events can find-or-update this comment instead of stacking duplicates.

## What this run validated

Every commit's contract was exercised under real GitHub conditions, not
just under synthetic vitest fixtures:

| Commit | What got real-world proof |
|---|---|
| 1 — webhook receiver | HMAC signature from a live GitHub webhook (not our `sign()` test helper) passed verification |
| 2 — auth helper | JWT was signed with our PEM, exchanged for an installation token, used to make Octokit calls — full chain worked |
| 3 — event filters | `installation.created`, `ping`, and `pull_request.opened` all routed to the right handlers; filters accepted the live payload |
| 4 — pipeline orchestration | `analyzeRepo` ran twice on real refs from a real repo, `createSession` persisted to Railway disk, all deps wired correctly |
| 5 — comment formatter | The "0 suggestions" empty-state branch is what fired — proved the rendering path that's most likely to be misformatted under-tested in unit tests |
| 6 — poster + runReview | Installation token authenticated, `paginate(listComments)` worked on the live API, `createComment` posted successfully |
| 7 — guardrails | Concurrency slot acquired and released cleanly; rate-limit bucket created for installation; no leaks observed in logs |
| 8 — installation events | `installation.created` accepted, GC code path didn't fire (correct — we didn't uninstall yet) |

## Why the comment said "Nothing notable" and not 🔴 CRITICAL

The diff was `is_even`: complexity 1 → 4. Δ+3.

Our `complexity-increase-without-test` rule has threshold **Δ ≥ 4**
after the calibration in `rule-tuning-2026-05.md`. Δ=3 is JUST under
the boundary — the rule correctly didn't fire.

This is by design. From the calibration doc:

> "We aim for 2-5 suggestions on a substantive PR, 0-2 on a patch
> release. ... Above 5: it looks like Greptile (60% nitpick rate)."

If Δ=3 fired a critical signal, we'd be back to noise-bot territory.
The empty-state "Nothing notable ✅" comment is the design's positive
output — reviewers know we ran, nothing crossed our calibrated
threshold.

If we wanted to verify the CRITICAL path works, the next test would
push one more branch into `is_even` to bump Δ to ≥4 and re-fire on
`pull_request.synchronize` (also testing the find-or-update path in
the poster).

## Open verifications for v1.0 beta-readiness

We've proven the chain works for ONE PR. Before opening up to friendly
beta users, we should ALSO observe (each takes <10 min):

1. **Synchronize event → find-or-update**, not duplicate-create. Push
   one more commit to the existing test-pr-1 branch; verify the
   existing comment is edited in-place.
2. **Critical-severity path**: a PR change that crosses the Δ≥4
   threshold; verify the 🔴 CRITICAL bullet renders correctly.
3. **Removed-function path**: delete a function in a PR; verify
   `removed-function-with-impact` rule fires.
4. **Cross-language sanity**: install on a Go or JS repo, verify the
   pipeline doesn't have implicit Python assumptions.
5. **Bot-author skip**: open a PR authored by a known bot (e.g.
   dependabot fork-style); verify our filter skips it cleanly.
6. **Uninstall**: uninstall the app from `gitvisionTest`; verify
   `installation.deleted` fired and the two sessions we created
   (`base of PR #1` + `PR #1`) got GC'd.

Each of these is a low-cost validation we can do solo before any
external beta install. They harden confidence without needing real
beta users.

## Calibration follow-up: should the empty-state be more verbose?

A small open question this run surfaced: the "Nothing notable ✅"
comment is concise (3 lines + footer). On a small PR that's right.
On a substantive PR where we LOOKED HARD and found nothing, we might
want richer reassurance — e.g. "GitVision analyzed 47 functions
across 12 files. Top function complexity didn't change. No new
untested branches. ✅"

Not a blocker. Worth revisiting after we see how it reads on real
medium-size PRs in beta.

---

_Related artifacts:_
- `github-app-skeleton-2026-05.md` — the design that this validation proves
- `rule-tuning-2026-05.md` — the calibration that explains the Δ≥4 threshold
- `pr-comment-format-v1.md` — the comment-format spec the formatter implements
