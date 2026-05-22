# GitHub App skeleton — design-skitse 2026-05-15

_The contract for RepoBaron's PR-bot. Captured before any GitHub App code is
written so we agree on scope, architecture, and failure modes upfront.
References `pr-comment-format-v1.md` for the comment spec and
`scope-and-sequence-2026-05.md` for the product context._

## What we're building

A GitHub App named **RepoBaron** that listens for `pull_request` events on
installed repos, runs our existing analysis pipeline against base + head refs,
and posts a comment with prioritized verification suggestions from
`evaluateVerificationRules`.

**One sentence:** "Install the app on a public repo → on every PR, get a
single grounded review comment within ~60 seconds."

## What's IN for v1 (the ship-bar)

- Webhook receiver for `pull_request.opened` and `pull_request.synchronize`
- Public repos only (private-repo support deferred to v2)
- Comment format: thin version (PR diff summary + top-3 suggestions from
  `review_changes`) — see "Comment format" below
- Per-installation rate limit (compute guardrail)
- Max repo-size guardrail at clone time
- Re-analyze on `synchronize` → edit existing comment (don't append)
- `installation.created` and `installation.deleted` housekeeping
- Manual GitHub App registration (Jonas does this once; not automated)

## What's OUT for v1

- Private repos / GitHub Enterprise
- Per-team configuration UI (defer to v2; for now `.gitvision.yml` is the
  config story, not a UI)
- LLM-summarized author narrative (Option Y in comment spec)
- Blast-radius signal in comment (the data is in `lib/`, the orchestration
  isn't — v1.1)
- Webhook-driven workspace refresh (still snapshot-based on repobaron.com)
- Marketplace listing (separate go-to-market step after we have ≥5
  friendly-user installs)
- OAuth flow for end-users on repobaron.com (still localStorage-uuid
  ownership; OAuth is its own migration)

## Architecture: same-repo, direct function calls

GitHub App routes live in **the same Next.js app** as the web UI. The
webhook handler calls `analyzeRepo`, `computeDiff`, `evaluateVerificationRules`
**directly from `lib/`** — no HTTP roundtrip to our own API.

### Why same-repo (not a separate service)

- Both surfaces (workspace + PR bot) **share the same signals**. Splitting
  them creates a versioning problem ("which deploy is the bot on, vs the
  workspace?"). Same repo = always synced.
- Direct function calls are 50-200ms faster than HTTP-self-call, and we
  don't pay for a separate Railway service.
- Webhook events are bursty (50 PRs in a minute when a big repo installs),
  but Next.js handles that fine on Railway with reasonable concurrency.
- We can split later if traffic patterns warrant it — extracting a function
  to its own HTTP service is a 1-day refactor when the time comes. Building
  it that way from day 1 is over-engineering.

### Why direct function calls (not MCP-over-HTTP)

The MCP tools (`analyze_repo`, `analyze_diff`, `review_changes`) are an
**interface for Claude Code / Cursor users**, not our internal architecture.
Internally, they're thin wrappers over `lib/` functions. The webhook handler
should call those library functions directly — same data, no JSON
serialization overhead, easier to stack-trace when things break.

## Route map

Three new App-Router routes:

| Route | Method | Purpose |
|---|---|---|
| `/api/github/webhook` | POST | Webhook receiver. Verifies HMAC signature, dispatches by event type. |
| `/api/github/install` | GET | Post-install redirect target. Shows "RepoBaron is now installed on X repos — visit repobaron.com to configure." |
| `/api/github/setup` | GET | Optional welcome page after first install. Skippable in v1; redirect straight to repobaron.com. |

No new MCP tools. No new public API endpoints for end-users.

## The webhook flow (sequence)

For `pull_request.opened` and `pull_request.synchronize`:

1. **Receive** POST `/api/github/webhook` with raw body + headers
2. **Verify HMAC-SHA256 signature** against `GITHUB_APP_WEBHOOK_SECRET`. Reject 401 if mismatch.
3. **Parse event** — extract `repository`, `pull_request`, `installation.id`
4. **Filter:**
   - Reject if `repository.private === true` (v1 = public only)
   - Reject if author is a known bot (`dependabot[bot]`, `renovate[bot]`, etc.) — matches existing `isBotAuthor` logic
   - Reject if `pull_request.draft === true` (don't analyze drafts; re-trigger on `ready_for_review`)
5. **Rate-limit check:** has this installation processed >N PRs in the last hour? If yes, log + skip with no comment.
6. **Size guardrail:** call GitHub API `GET /repos/{owner}/{repo}` to check `size` field (in KB). Reject + log if > 100 MB.
7. **Get installation token:** sign JWT with app private key (10-min TTL), exchange for installation access token (1-hour TTL). Cache in-memory per `installation_id`.
8. **Resolve refs:** base SHA = `pull_request.base.sha`, head SHA = `pull_request.head.sha`. Use the SHAs, not branch names — branches move.
9. **Run analyzeRepo at base SHA** → snapshot, save to `.gitvision/sessions/<id>.json` with auto-generated session-id derived from `repo + sha`
10. **Run analyzeRepo at head SHA** → snapshot
11. **Run computeDiff(base, head)** → `DiffResult`
12. **Run evaluateVerificationRules** with default `maxResults=3` → suggestions
13. **Format comment** (see "Comment format" below)
14. **Find existing RepoBaron comment** on the PR (search by comment author = our app + marker string in body). If found, update it. If not, create new.
15. **POST comment** via installation token
16. **Return 200** to GitHub. Whole flow target: < 60s for medium repos.

If any step 7-15 fails: log the error, return 200 to GitHub anyway (so they don't retry), and skip commenting. Better silent than broken comment.

## Auth & secrets

### App credentials

GitHub App registration generates three secrets we need:
- **App ID** — public-ish integer, identifies "RepoBaron" to GitHub
- **Private key** — RSA key for signing JWTs. Critical secret.
- **Webhook secret** — HMAC secret for verifying incoming webhook payloads.

### Where they live

| Secret | Local dev | Production (Railway) |
|---|---|---|
| `GITHUB_APP_ID` | `.env.local` plain text | Railway env var |
| `GITHUB_APP_PRIVATE_KEY` | `.env.local`, base64-encoded RSA PEM | Railway env var, base64 |
| `GITHUB_APP_WEBHOOK_SECRET` | `.env.local` plain text | Railway env var |
| `GITHUB_APP_CLIENT_ID` | `.env.local` (needed for install redirect URL) | Railway env var |

The private key is **base64-encoded** in env vars to dodge multi-line escaping issues. Decode at startup in `lib/githubApp/auth.ts`.

### JWT → installation token flow

1. Sign JWT with `{ iss: GITHUB_APP_ID, exp: now+10min }`, RS256, app private key
2. POST `/app/installations/{installation_id}/access_tokens` with `Authorization: Bearer <jwt>` → returns `{ token, expires_at }` (1-hour TTL)
3. Cache `{ token, expires_at }` per `installation_id` in process memory (Map)
4. On cache miss or within-5-min-of-expiry, re-mint

We use Octokit's `App` class (already in `octokit` package we depend on) for this — it handles JWT signing + token caching for us. Don't reinvent.

## Cost guardrails (compute, not LLM)

**Key insight:** v1's pipeline has **zero LLM token cost**.
`review_changes` is pure deterministic rules over `DiffResult`. The only
"cost" is compute (CPU for analysis, network for clone, storage for session
JSONs). That dramatically simplifies the budget story.

What we DO need to guard:

| Guardrail | Threshold | Why |
|---|---|---|
| PRs per installation per hour | 10 | One repo opening 50 PRs in a flood = analysis storm. Soft-fail (skip + log). |
| Repo size at clone time | 100 MB | Mega-repos eat bandwidth + clone time + disk. Reject with friendly comment ("RepoBaron currently supports repos under 100 MB — reach out if you'd like enterprise tier"). |
| Concurrent analyses per installation | 2 | Same-installation back-to-back PRs shouldn't OOM Railway. Queue / skip the third. |
| Total active installations | 50 (soft cap for v1 beta) | At 50 installs we re-evaluate cost trajectory before opening to public. Manual cap, no code enforcement v1; we just track and decide. |
| Session storage per installation | 1 GB | Old sessions are GC'd after 30 days anyway. Cap is mostly belt-and-suspenders. |

**LLM cost** is N/A for v1. When we add LLM-summarized author narrative
(Option Y, v1.5), revisit this section with token-cost guardrails using
the existing `lib/aiBudget.ts` infrastructure.

## File structure

```
lib/githubApp/
├── webhook.ts          # signature verify + event dispatch (entry point)
├── auth.ts             # JWT signing, installation-token cache (Octokit App wrapper)
├── rateLimit.ts        # per-installation hourly counter (Map-backed for now)
├── comment.ts          # markdown renderer for review_changes output
├── events/
│   ├── pullRequest.ts  # handles opened / synchronize / reopened
│   └── installation.ts # handles created / deleted (housekeeping)
└── types.ts            # webhook payload types (use Octokit's types where possible)

app/api/github/
├── webhook/route.ts    # POST handler (delegates to lib/githubApp/webhook.ts)
├── install/route.ts    # GET redirect target after install
└── setup/route.ts      # GET optional welcome page
```

Three rules:
1. **Webhook entry is thin.** `route.ts` only reads body + headers, verifies signature, calls `dispatchEvent()`. Business logic lives in `lib/githubApp/`.
2. **No language-specific code.** All analysis goes through existing `lib/codeAnalysis/` plugin architecture. The GitHub App is a transport layer, not an analysis layer.
3. **Reuse `atomicWriteJson`, `requireSessionOwnership`, etc.** Don't duplicate infrastructure.

## Comment format (v1 thin version)

`pr-comment-format-v1.md` defines the target rich format. For v1 we ship a
**reduced version** that uses only what `review_changes` returns today.
The rich version is v1.1 work (requires orchestrating blast_radius +
untested_hotspots calls per touched function).

### v1 comment (thin)

```markdown
## RepoBaron Review

**Diff summary:** 3 files changed · 5 functions added · 2 removed · 7 modified · net complexity +4

### Suggested verification (top 3)

1. 🔴 **CRITICAL** — `load_dotenv` in `src/flask/cli.py` grew by +4 cyclomatic complexity (9 → 13). No tests in the same module were changed — add a regression test before merge.
2. 🟡 **WARNING** — `_path_is_relative_to` was removed from `src/flask/sansio/scaffold.py` (original complexity 2). Verify no callers in this repo still depend on it.
3. 🟢 **INFO** — Sizeable PR — touches 23 files with 109 function-level changes. Worth a holistic read; not just patch-by-patch review.

---
[Full analysis ↗](https://repobaron.com/...) · _Signals computed deterministically — no LLM in this comment_ · [How to silence ↗](https://repobaron.com/docs/config)
```

Mapping:
- **Diff summary line** — formatted from `DiffResult.summary` (already computed)
- **Suggestion bullets** — formatted from `evaluateVerificationRules` output, using existing severity → emoji map
- **Marker for find-on-update** — invisible HTML comment `<!-- gitvision:pr-review v1 -->` at top of comment body, used in step 14 to find-or-update on `synchronize`

### Edge cases (mirror `pr-comment-format-v1.md`)

| Scenario | v1 behavior |
|---|---|
| `review_changes` returns 0 suggestions | Comment: "RepoBaron Review: nothing notable on this PR ✅" — short, no false alarms |
| `analyzeRepo` fails at base or head | Skip comment, log error (we don't want to ship a half-broken comment) |
| Force-push / `pull_request.synchronize` | Re-run pipeline, edit existing comment via stored comment-id |
| Bot-authored PR | Skip entirely (filter at step 4) |
| Repo too large | Skip with no comment v1; log for telemetry. (v1.1: optional "repo too large for free tier" comment) |
| Same SHA already analyzed | Reuse existing session by `sha`-keyed lookup; don't re-clone |

## Open questions to answer during implementation

### Q1: Where do GitHub-App-created sessions live?

If a PR posts a comment with link `repobaron.com/sessions/<id>`, that session
needs to exist on repobaron.com. Two options:

**A.** PR-bot writes sessions to the **same `.gitvision/sessions/` dir** as
workspace sessions. Public-by-default for now (anyone with the link can view).
**B.** PR-bot writes to a **separate `.gitvision/pr-sessions/` dir** with
its own access model (only visible to installation members).

**Recommendation:** A for v1 (simpler; public-link discoverability is fine
for public repos). Reconsider when we add private-repo support — that
forces B's permission model.

### Q2: How do we authenticate the "Full analysis ↗" link?

Workspace already has localStorage-uuid ownership. A user clicking the link
from a PR has no RepoBaron account or session-cookie yet. Three options:

**A.** Link goes to a public read-only view of the session — no auth.
**B.** Link goes through a one-time-token flow: webhook generates a short
token, repobaron.com trades it for ownership transfer.
**C.** Defer: the link points to a "Sign in to view" page that requires
GitHub OAuth (which we don't have v1).

**Recommendation:** A. Public read-only sessions for public repos is a
feature, not a bug — it's a marketing asset ("here's what RepoBaron found
on this PR"). When OAuth lands, upgrade to B/C selectively for private
repos.

### Q3: When `installation.deleted` fires, do we delete sessions?

Their data, their choice. Options:

**A.** Delete all sessions tied to that installation immediately.
**B.** Soft-delete (mark as orphaned, GC after 30 days).
**C.** Leave them — they're public anyway.

**Recommendation:** A. User uninstalled = they don't want us holding
their analysis. We comply.

### Q4: Manual GitHub App registration parameters

When Jonas creates the app on github.com/settings/apps, we need to specify:

- **Name:** "RepoBaron"
- **Homepage URL:** `https://repobaron.com`
- **User authorization callback URL:** `https://repobaron.com/api/github/install` (not used in v1 — but required field)
- **Webhook URL:** `https://repobaron.com/api/github/webhook`
- **Webhook secret:** generate strong random, store in Railway
- **Permissions:**
  - Repository → Contents: **Read** (for clone access)
  - Repository → Pull requests: **Read & Write** (for comment posting)
  - Repository → Metadata: **Read** (default, required)
- **Subscribe to events:** `Pull request`, `Installation`
- **Where can this be installed:** "Any account" (we want public install)

These are decisions, not implementation. The actual registration is a 10-min
manual step Jonas does once.

## Implementation order (commit-by-commit roadmap)

Each step is **one commit, ships green tests + builds**. Estimated effort is
calendar-time-with-hobby-velocity, not engineering hours.

| # | Commit | Effort | Why this order |
|---|---|---|---|
| 1 | Webhook receiver skeleton — POST route + signature verification, returns 200 on valid, 401 on invalid. No event handling yet. | 1 evening | Signature verify is the security boundary — get it right first. |
| 2 | Auth helper — JWT signing + installation-token exchange. Unit test against a fake private key. | 1 evening | Pre-req for any GitHub API call. |
| 3 | `pull_request` event dispatch + filter logic (bot, draft, private). Log everything. Still no analysis or comment. | 1 evening | Validate we receive + parse events correctly before we touch analysis. |
| 4 | Pipeline orchestration — clone + analyzeRepo at base + head + computeDiff + review_changes. **No comment yet** — just produce + log the suggestions. | 1 weekend | Biggest chunk. Tests against a real test-repo fixture. |
| 5 | Comment formatter (markdown renderer) — pure function, unit-tested against fixture suggestions. | 1 evening | Easy to test in isolation. |
| 6 | Comment poster — find-or-update logic, posts via installation token. Test against a sandbox repo. | 1 evening | Integrates 4 + 5. |
| 7 | Rate limit + size guardrails. Unit + integration tests. | 1 evening | Don't ship without these — analysis-storm is a real risk. |
| 8 | `installation.deleted` housekeeping — delete sessions for that installation. | 1 evening | Compliance / hygiene. |
| 9 | End-to-end test against a friendly real-world repo (e.g. a personal sandbox). Document the install flow in README. | 1 weekend | Real PR closes the loop. |
| 10 | Manual install on 2-3 friendly repos (jonas's own + a friend's). Watch for 1-2 weeks, iterate on noise. | calendar | Before marketing push, validate signal quality. |

Total realistic timeline: **6-10 weeks** of evenings/weekends. Matches the
1-2 weeks in `scope-and-sequence-2026-05.md` × hobby velocity multiplier.

## Failure modes we explicitly accept for v1

- **No retry logic for failed webhooks.** GitHub retries automatically with
  backoff if we 5xx. We always 200 (even on internal failure) to avoid
  duplicate processing.
- **In-memory rate-limit + token cache** is lost on redeploy. That's fine
  for v1 — worst case is one extra PR getting through after a deploy.
- **No comment-edit conflict resolution.** If two webhook events race for
  the same PR (sync + sync), one comment-update may overwrite the other.
  Acceptable; the latest wins.
- **No multi-language comment.** Comment is English-only. Internationalization
  is v3+ work.
- **Session-storage growth is unbounded** until we add GC. Add a simple
  cron'd cleanup of >30-day sessions before we hit 1 GB.

## What we'd need to add to ship to private repos (v2 preview)

- OAuth flow on repobaron.com (already on v2 roadmap)
- Per-installation access model on session storage (Q1 option B)
- "Visible to installation members only" link auth (Q2 option B or C)
- Enterprise-cloud and -server URL support in webhook config

Not v1. Logging the dependencies here so v2 design has a starting list.

---

_Next steps after this doc:_
1. Jonas reviews + approves (this can wait until next session — async)
2. Jonas registers "RepoBaron" on github.com/settings/apps (10 min, one-time)
3. We implement commits 1-9 above, in order, each with green tests
