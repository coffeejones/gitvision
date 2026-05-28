# Before v1 (commercial launch)

~32 findings. These don't block today, but should all be resolved before
real paying customers touch the product. Grouped by area so they can be
batched into focused sessions.

---

## Security · session ownership cluster (IDOR)

Triaged 2026-05-14. The audit framed this as "fix together with HMAC
tokens" but reading the actual ownership code revealed nuance the agents
missed: RepoJury's session-GET is intentionally open (the share-by-URL
feature). The only real exploit was AI budget exposure — the other
findings are cosmetic-leak / privacy concerns that are mostly throwaway
work under the OAuth migration on the v2 roadmap.

### Closed in this batch

- [x] `app/api/sessions/[id]/summary/route.ts:17` — AI summary now requires session ownership (SEC-013 / QUAL-001)
  - Extracted `requireSessionOwnership` to shared `lib/ownership.ts`, used in summary + health + (already existing) DELETE/PATCH on the session itself. Order matters: ownership check now fires BEFORE `consumeAiBudget`, so non-owner calls cost nothing.
- [x] `app/api/sessions/[id]/health/route.ts` — same hole, same fix (not in original audit list, found via verification)

### Deferred to OAuth migration (v2)

The remaining items are either by-design (share-by-URL) or cosmetic
leaks (ownerId visible in responses) that get replaced entirely when we
move to OAuth + server-side identity. Fixing them now would be ~50
lines of work that gets deleted again at migration time.

- [ ] `app/api/sessions/[id]/route.ts:22` — Ownership comparison is plain string (SEC-001/002) — **by design** for share feature; gets replaced by signed-session-cookie under OAuth
- [ ] `app/api/sessions/[id]/route.ts:23` — Legacy ownerless sessions accept any caller (SEC-002 r2) — **by design**, documented pre-v0.26 behavior; eventual cleanup is a data-migration concern
- [ ] `app/api/sessions/[id]/route.ts:35` — GET returns `ownerId` to any caller (SEC-003) — cosmetic; share feature means GET is intentionally open. Strip when ownerId becomes user_id under OAuth
- [ ] `app/api/sessions/[id]/route.ts:42` — `secretFindings` via unauth GET (SEC-008) — public-repos-only currently; same as anyone running secretsScan themselves. Re-evaluate if/when private-repo analysis ships
- [ ] `app/api/sessions/route.ts:29` — GET /api/sessions lists all sessions (SEC-004) — privacy leak but no exploit; gets replaced by `WHERE user_id = ?` under OAuth
- [ ] `app/api/jobs/[id]/route.ts:14` — Job record includes ownerId (SEC-009) — privacy leak only; jobs are short-lived. Strip when migrating to user_id

If commercial launch arrives BEFORE OAuth (i.e. paid hobby tier without
real auth), revisit the deferred list — HMAC-signed tokens or similar
becomes warranted at that point. Until then: the AI-budget hole was the
only one with real cost-or-correctness impact.

## Security · rate limiter

- [ ] `lib/rateLimit.ts:51` — `X-Forwarded-For` trusted unconditionally — bypass vector (SEC-005/009)
  - **Fix:** require a proxy allowlist env var; only honor `X-Forwarded-For` when the immediate peer is in the allowlist. Otherwise fall back to direct socket IP.
- [ ] `lib/rateLimit.ts:97` — `cleanupExpired` samples first 6 keys only — never converges on dense Maps (BUG-007 / QUAL-017 / PERF-023)
  - **Fix:** Either sweep all expired entries per call, or run cleanup on a timer rather than per-request.

## Security · feedback webhook

- [ ] `lib/feedback.ts:124` — Webhook URL not validated, no timeout, no abort signal (SEC-012/013/016)
  - **Fix:** Validate env URL against an allowlist (Discord/Slack hosts), wrap fetch in AbortController with 5s timeout.
- [ ] `lib/feedback.ts:107` — Persists caller IP + email + message — PII at rest (SEC-011 r2)
  - **Fix:** Strip IP from persisted form, OR document GDPR-relevant retention. Decide before commercial.
- [ ] `lib/feedback.ts:124` — Description forwarded to webhook with no markdown escaping (SEC-011 r1) — injection-laden inputs become Discord/Slack markdown
  - **Fix:** Escape backticks + markdown markers before posting.

## Security · ownerId + cookies

- [ ] `lib/ownerId.ts:33` — `gv_owner_id` cookie set without HttpOnly / Secure flags (SEC-016)
- [ ] `lib/ownerId.ts:64` — `Math.random()` fallback when `crypto.randomUUID` missing (SEC-006/015)
  - Tiny risk surface (modern browsers all have crypto.randomUUID), but no reason to keep the fallback.

## Security · misc

- [ ] `app/api/sessions/[id]/health/route.ts:85` — Upstream Anthropic errors echoed verbatim to clients (SEC-010)
- [ ] `app/session/[id]/page.tsx:197` — `session.repoUrl` rendered as href without scheme validation (SEC-014)
- [ ] `lib/gitLog.ts:112` — Owner/repo interpolated into clone URL with permissive validation (SEC-007)
  - **Fix:** allowlist `[A-Za-z0-9_.-]+` before interpolation.
- [ ] `components/views/PackagesPanel.tsx:41` — Unknown ecosystem falls through to google.com search URL — open-redirect-adjacent (SEC-021)
- [ ] `lib/jobs.ts:151` — Job error field carries raw exception messages from analyze pipeline (SEC-022)
- [ ] `lib/codeAnalysis/analyze.ts:213` — Walker follows symlinks during repo analysis with no protection (SEC-008)
- [ ] `lib/security/patterns.ts:102` — JWT pattern regex has unbounded segment lengths — mild ReDoS risk (SEC-017)

## Performance · hot path

- [ ] `lib/github.ts:172-192` — `fetchCommitFileChanges` runs N+1 serial GitHub API calls (PERF-001, both rounds, audit's #1 ranked fix)
  - **Fix:** Use `mapWithConcurrency` (already exists in `lib/depsHealth/pool.ts`). 5-10x speedup on hot path.
- [ ] `lib/codeAnalysis/blastRadius.ts:343` — BFS uses `Array.shift()` — O(n²) instead of O(n) (PERF-004)
  - **Fix:** Replace queue-via-shift with array+head-index pattern. Touches the file we already edited recently for cross-module.
- [ ] `lib/security/secretsScan.ts:266` — `walkRepoForSecrets` reads files sequentially (PERF-005)
- [ ] `app/session/[id]/page.tsx:123-154` — Overview page recomputes `findDuplicateGroups` + `computeTestCoverage` twice per render (PERF-007)
- [ ] `lib/storage.ts:62` — `listSessions` reads every session JSON sequentially on landing page GET (PERF-003 / PERF-006)
- [ ] `lib/signals.ts:220-262` — `hasTestCoverage` walks all `fileGraph.edges` per hotspot — O(hotspots*edges) (PERF-008)
- [ ] `lib/graph.ts:1001-1022` — Go resolver scans entire `byPath` Map for every import (PERF-002, both rounds)
- [ ] `lib/graph.ts:324-347` — `readCodeFiles` awaits `fs.stat` + `fs.readFile` sequentially per file (PERF-003)
- [ ] `lib/graph.ts:752-760` — C# resolver does linear scan over `csharpFqnToPath` per inheritance match (PERF-008/012)
- [ ] `lib/graph.ts:950-953` — Python resolver fuzzy-matches by scanning all `byPath` keys (PERF-013/025)

## Performance · React render

- [ ] `components/views/Constellation.tsx:471` — `allCoChange` recreated as new array each render (PERF-006)
- [ ] `components/views/Constellation.tsx:21` — `import * as d3 from "d3"` slurps full d3 bundle (PERF-009)
  - **Fix:** Tree-shake — `import { selection, force, … } from "d3-…"` modules.
- [ ] `components/views/HotspotTreemap.tsx:7` — Same d3 star-import issue (PERF-021)
- [ ] `components/views/DependencyCanvas.tsx:357-383` — Fresh data object per node on every selection change defeats `FileNode` memo (PERF-009)
- [ ] `components/views/DependencyCanvas.tsx:133-137` — `FileNode` `onClick` is inline arrow — memo can't help (PERF-010)
- [ ] `components/views/PRFlow.tsx:178-190` — d3-sankey layout runs on every render outside `useMemo` (PERF-011)
- [ ] `components/views/FileDetailsPanel.tsx:32` — `commitsForFile` uses `Array.includes` inside filter — O(commits * hotspotCommits) (PERF-007)
- [ ] `components/views/CodePanel.tsx:263` — `computeTestCoverage` + `findDuplicateGroups` recomputed on every `cg` ref change (PERF-019)

## Bugs · React lifecycle

- [ ] `components/SessionToolbar.tsx:128` — `pollJob` runs indefinitely after navigation/unmount (BUG-004)
- [ ] `components/RepoInputForm.tsx:164` — Same pollJob pattern leaks after unmount (BUG-012)
  - **Fix:** Both share root cause. One `useAbortablePoll` hook with AbortController + cleanup. Apply to both call sites.

## Bugs · logic

- [ ] `lib/security/secretsScan.ts:72` — `continue fileLoop` skips remaining patterns on dense files — late patterns become dead-code (BUG-003)
- [ ] `lib/codeAnalysis/duplicates.ts:62` — Duplicate detection silently skips bodyHash-less functions — false "no duplicates" for regex-fallback languages (BUG-011)
- [ ] `lib/codeAnalysis/blastRanking.ts:167` — `fromContainerType` always undefined in `encodeFn` — recursive self-calls double-count as direct callers (BUG-012)
- [ ] `lib/depsHealth/tree.ts:39` — `fetchRepoTree` ignores `data.truncated` — silent partial dep-health on huge repos (BUG-007)
- [ ] `lib/depsHealth/pool.ts:19` — `mapWithConcurrency` with concurrency=0 hangs / returns array of undefined holes (BUG-015/016)
- [ ] `components/views/Constellation.tsx:836` — `maxChurn` defaults to 1 when scrubber filters all hotspots — slider becomes a 1..1 dead control (BUG-017)
- [ ] `components/views/Constellation.tsx:610` — Autoplay `useEffect` re-creates setTimeout on every timeIndex change — stale timer leaks on rapid pause/play (BUG-013)
- [ ] `components/views/CodePanel.tsx:248` — `useEffect` missing dependency on `cg.fileComplexity` (BUG-013)
- [ ] `components/views/PRFlow.tsx:95` — Invalid PR `createdAt` yields NaN duration → "NaNm" display + sort instability (BUG-005)
- [ ] `lib/signals.ts:265` — `median()` silently returns 0 for empty array, biasing PR signals (BUG-014)
- [ ] `lib/signals.ts:530` — `detectActivityRecency`: NaN days from malformed `latestIso` not guarded (BUG-009)
- [ ] `components/views/CommitActivity.tsx:26` — Division by zero when all commit counts are zero (BUG-010)
- [ ] `lib/codeAnalysis/parse.ts:96` — Tree-sitter Parser/Tree leak on synchronous throw after parse — WASM heap leak (BUG-008)
- [ ] `lib/graph.ts:235` — Tarball downloaded entirely into a Buffer — OOM on multi-GB repos (BUG-001)
- [ ] `lib/graph.ts:247` — Tar extraction has no decompressed-size cap — disk-exhaustion vector (BUG-002)
- [ ] `lib/jobs.ts:128` — `processJob` check-then-act race on status (BUG-005)
- [ ] `components/ContributorWrappedModal.tsx:514` — `download()` finally clause races on rapid clicks — sets `downloading=null` even when another download started (BUG-014)
- [ ] `lib/gitLog.ts:226` — Temp git-clone directory cleanup is fire-and-forget (BUG-003)

## a11y · all modals + clickable divs

Real accessibility gaps. Won't block adoption unless a customer makes a11y
a requirement, but should be polished before charging.

- [ ] `components/CommandPalette.tsx:212` — Modal lacks dialog ARIA + focus trap (UX-003)
- [ ] `components/FeedbackModal.tsx:136` — Same (UX-004)
- [ ] `components/ShareCardModal.tsx:77` — Same + literal ✕ glyph button (UX-005)
- [ ] `components/views/DependencyCanvas.tsx:133` — `FileNode` clickable div without role/keyboard handler (UX-001)
- [ ] `components/views/Constellation.tsx:202` — Same (UX-002)
- [ ] `components/SessionToolbar.tsx:139` — Destructive delete uses native `window.confirm` (UX-006)
- [ ] `components/RepoInputForm.tsx:208` — Repo URL input uses `type="text"` and lacks inline validation (UX-007)
- [ ] `components/RepoInputForm.tsx:312` — Loading progress is faked but not announced to assistive tech (UX-016)
- [ ] `components/AdaptiveHome.tsx:86` — Hydration switch can flash MarketingHome before WorkspaceHome (UX-008)
- [ ] `components/views/CodePanel.tsx:1230` — Expand/collapse toggle buttons have no `aria-expanded` (UX-009)
- [ ] `components/views/HotspotTreemap.tsx:123` — Treemap SVG is unlabeled for assistive tech (UX-010)
