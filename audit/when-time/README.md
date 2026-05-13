# When there's time — post-v1 polish

~60 findings. None block anything. Most are code-quality nits, minor
perf, or refactors that pay aesthetic dividends but not user-facing
value. Plan one dedicated polish-sprint after v1 launch and burn down
a chunk at once.

Don't pull items from here individually unless they're on your path
anyway. Polish is a separate motion, not interleaved work.

---

## God-component refactors (decided as polish)

Big files. Real complexity gravity. But cracking them open while
shipping PR-bot features on top would add change-risk. Refactor when
you have a few quiet days.

- [ ] `components/views/CodePanel.tsx` — 1768 lines, 7 findings (QUAL-003/004 + others)
- [ ] `components/views/Constellation.tsx` — 1138 lines, 10 useState hooks (QUAL-015/023)
- [ ] `lib/github.ts:404` — `analyzeRepo` is 250 lines with nested error paths (QUAL-005/014)
- [ ] `lib/codeAnalysis/plugins/javascript.ts:383-1173` — `parseJsDirect` is 800-line walker (QUAL-014)
- [ ] `lib/codeAnalysis/plugins/csharp.ts` (+ Java + PHP) — FQN-resolution plumbing duplicated across three plugins (QUAL-015)

## Code duplication (DRY pass)

These are all "the same helper exists in two or three places". One pass
to extract shared utilities.

- [ ] `SKIP_DIRS` duplicated across `analyze.ts`, `graph.ts`, `secretsScan.ts` (QUAL-003/006)
- [ ] `atomicWriteJson` reimplemented identically in `jobs.ts` and `feedback.ts` (QUAL-007) — extract to a shared helper as part of the critical bucket's storage fix
- [ ] `jsonResult` / `errorResult` MCP helpers copy-pasted into all 7 tools (QUAL-002 `mcp/tools/analyzeRepo.ts`)
- [ ] Rate-limit boilerplate duplicated across 4+ API routes (QUAL-011 `app/api/sessions/route.ts`)
- [ ] AI route boilerplate duplicated between summary + health endpoints (QUAL-004 `app/api/sessions/[id]/summary/route.ts`)
- [ ] `EXT_COLORS` / `EXT_STYLE` palettes duplicated (QUAL-011 Constellation.tsx)
- [ ] `MAX_FILE_BYTES` / file-cap constants duplicated across walkers (QUAL-013 analyze.ts)
- [ ] `DEFAULT_MAX_CLASSES = 250` duplicated in classCanvas + classDiagram (QUAL-020)
- [ ] `METADATA_BASENAMES` / `isMetadataFile` duplicated verbatim in signals.ts (QUAL-002)
- [ ] `getDependencyHealths` defined twice in signals.ts with same body (QUAL-008)
- [ ] Two Octokit clients with hardcoded user agent in github.ts (QUAL-016)

## Minor performance

Real but bounded. Not on hot paths.

- [ ] `components/views/Constellation.tsx:729` — `authorTintFor` recreated each render (PERF-012)
- [ ] `components/views/Constellation.tsx:833` — `selectedHotspot` computed with `Array.find` on every render (PERF-013)
- [ ] `components/views/Constellation.tsx:416` — `packByFolder` re-sorts each folder per layout call (PERF-024)
- [ ] `components/views/DependencyCanvas.tsx:250` — `byLayer.values()` spread + `Math.max` per layout (PERF-021)
- [ ] `components/views/DependencyCanvas.tsx:326-345` — `visibleEdges` recomputes on edges identity (PERF-026)
- [ ] `components/views/ClassCanvas.tsx:175-185` — Re-runs Dagre layout on every filter change (PERF-020)
- [ ] `components/CommandPalette.tsx:131-156` — Filters allItems on every keystroke without indexing (PERF-015)
- [ ] `lib/depsHealth/index.ts:50-65` — Plugins run sequentially even though independent (PERF-023)
- [ ] `lib/depsHealth/index.ts:98-141` — Manifest content fetched one-by-one via GET /contents rather than from extracted tarball (PERF-024)
- [ ] `lib/depsHealth/ecosystems/npm.ts:31` — Full npm registry JSON fetched per package (PERF-014) — slim header pattern
- [ ] `lib/codeAnalysis/parse.ts:123` — Per-function `decisionPoints.matches` runs over body subtree N+1 times (PERF-010)
- [ ] `lib/codeAnalysis/parse.ts:182` — `findEnclosingFunction` is O(calls * functions) per file (PERF-018/019)
- [ ] `lib/codeAnalysis/codeGraph.ts:157-225` — Class-name disambiguation runs two extra passes (PERF-018)
- [ ] `lib/codeAnalysis/codeGraph.ts:206` — Class method matching walks all functions per class (PERF-020)
- [ ] `lib/storage.ts:23-127` — Sessions hold entire snapshot history in memory and write whole file per append (PERF-022)
- [ ] `lib/storage.ts:43` — Blocking `writeFile` on request path (PERF-015) — covered by atomic-write fix
- [ ] `lib/github.ts:451` — Sort over full commits array allocates copy just for earliest/latest dates (PERF-022)
- [ ] `lib/github.ts:255-263` — `computeCoChange` has O(filesInCommit²) pair generation (PERF-025)
- [ ] `lib/github.ts:513-575` — Tarball downloaded, written to disk, re-read for extraction — extra disk write (PERF-017)
- [ ] `mcp/cache.ts:174` — `setCached` awaits disk write — every MCP `analyze_repo` response blocked by ~MB-write (BUG-010)

## UI/UX polish (not a11y-blocking)

- [ ] Sidebar fixed-width 224px no mobile fallback (UX-013)
- [ ] React Flow canvases lack mobile pinch-zoom hints (UX-014)
- [ ] Marketing hero/footer fixed `px-8` padding (UX-015)
- [ ] `ShareCardModal` uses dark+light Tailwind, others use TOK tokens (UX-017)
- [ ] Hotspot color scale legend doesn't explain interpretation (UX-018)
- [ ] Delete confirm doesn't mention snapshots will be lost (UX-019)
- [ ] "blast radius" appears unexplained on first contact (UX-020)
- [ ] Keyboard shortcuts not documented in-app outside palette footer (UX-021)
- [ ] Session rename has no loading/error feedback (UX-022)
- [ ] First-visit hint `animate-pulse` no `prefers-reduced-motion` override (UX-023)
- [ ] Missing main landmark / skip-nav link (UX-024)
- [ ] Eyebrow labels mix Title Case + sentence case (UX-025)
- [ ] Mixed spacing scale across HeavyFilesList, TopFunctionsList, BlastSection (UX-026)
- [ ] Submit button uses ellipsis-arrow mix and en-dash placeholder (UX-027)
- [ ] Share menu + overflow menu lack ARIA disclosure + keyboard arrow nav (UX-028)
- [ ] Status detail text relies on line-clamp + title-only fallback (UX-012)
- [ ] Sidebar "Search…" button labeled by title attr only (UX-011)
- [ ] `app/layout.tsx:79` — Plausible loaded with `rel="noopener"` but not `noreferrer` on external links (SEC-022 MarketingHome)

## Minor logic nits

- [ ] `lib/codeAnalysis/blastRadius.ts:365` — BFS hop initialization skews entryCount at the cap (BUG-017)
- [ ] `lib/codeAnalysis/codeGraph.ts:248` — `basenameNoExt` drops dot-prefix files inconsistently (BUG-021)
- [ ] `lib/codeAnalysis/analyze.ts:187` — `walkAndRead` can exceed `maxFiles` by one entry (BUG-019)
- [ ] `lib/codeAnalysis/analyze.ts:110` — `prepareForRepo` failures logged but swallowed (BUG-021)
- [ ] `lib/depsHealth/index.ts:186` — `ageMonths` uses 30-day blocks — "stale" fires at ~345 actual days (BUG-019)
- [ ] `lib/storage.ts:67` — `listSessions` silently drops corrupted session files (BUG-022 / QUAL-009)
- [ ] `lib/aiBudget.ts:32` — `nextUtcMidnight` returns yesterday's midnight in DST/leap edge (BUG-018)
- [ ] `lib/aiBudget.ts:28` — Daily AI budget kill-switch is process-local + resets every deploy (SEC-012)
- [ ] `lib/github.ts:187-191` — Per-commit fetch failures swallowed with no diagnostics (BUG-020 / QUAL-008/010)
- [ ] `lib/graph.ts:1043` — `computeLayers` recursion stack-overflows on deep dep chains (BUG-009)
- [ ] `components/views/ArchitecturePanel.tsx:184` — Clipboard write rejection swallowed but not caught (BUG-011)
- [ ] `components/CommandPalette.tsx:79` — `useMemo` on snapshot includes functions list ordered by reference (BUG-023)
- [ ] `lib/feedback.ts:81` — `clampContext` already by-design (in rejected list)
- [ ] `components/views/PRFlow.tsx:132` — `median` picks `Math.floor(len/2)` — wrong on even-length, drifts from signals.ts (BUG-018)
- [ ] `lib/intelligence/structuralDiff.ts:142` — `fnKey` uses `\x1F` but other modules use `\x1E` — inconsistent separators (BUG-020)
- [ ] `lib/healthAnalysis.ts:86` — Already in rejected list (graceful degradation)

## Quality nits / stale comments

- [ ] `mcp/server.ts:20` — Stale comment says "Five tools" but seven registered (QUAL-021)
- [ ] `mcp/buildServer.ts:41` — Server version pinned in source; drifts from package.json (QUAL-022)
- [ ] `lib/intelligence/healthSummary.ts:4` — Stale comment claims 21 deterministic signals; signals.ts has 17 (QUAL-022)
- [ ] `lib/codeAnalysis/plugins/java.ts:115-125` — Tree-sitter QUERIES object kept "for reference + tests" but referenced only by self-comment (QUAL-027)
- [ ] `lib/github.ts:506` — `CODE_ANALYSIS_TIMEOUT_MS` hardcoded inside `analyzeRepo` (QUAL-017)
- [ ] `lib/github.ts:478` — Magic "120" for hotspot cap with rationale only in comment (QUAL-026)
- [ ] `lib/storage.ts:11` — Captured-at-import `DATA_DIR` breaks process-env-late tests (QUAL-025)
- [ ] `lib/jobs.ts:264-290` — Test-only helpers exported as part of public module surface (QUAL-018)
- [ ] `lib/codeAnalysis/blastRadius.ts:216-223 / 318` — `BfsEntry.filePath` property actually carries an encoded function id — misleading name (QUAL-019/023)
- [ ] `mcp/cache.ts:25-26` — MCP cache imports `AnalysisSnapshot` via relative path from app source tree (QUAL-030)
- [ ] `lib/graph.ts:1279` — Unused imports kept alive with `void` suppressions (QUAL-006)
- [ ] `lib/graph.ts:12` — Regex-based parser pipeline marked deprecated yet still actively used (QUAL-012)
- [ ] `lib/graph.ts:187` — GitHub API failures absorbed silently in three places, each differently (QUAL-018)
- [ ] `lib/signals.ts:18` — Unused type imports (`OutdatedDep`, `VulnerableDep`, `DeprecatedDep`) (QUAL-007)
- [ ] `lib/codeAnalysis/parse.ts:31-52` — Already in rejected list (compiledQueryCache, bounded growth)
- [ ] `mcp/cache.ts` — FIFO 8-entry eviction (in rejected — design choice)
- [ ] `app/api/feedback/route.ts:86` — `console.error` here is correct; the `eslint-disable` comment is the smell (QUAL-024)
- [ ] `app/api/feedback/route.ts:29-44` — Feedback rate-limit error shape differs from every other route (QUAL-025)
- [ ] `app/api/sessions/[id]/summary/route.ts:1` — Zero tests for AI summary/health API routes (QUAL-012)
- [ ] `lib/gitLog.ts:130-135` — Generic git-clone failure surfaces 200 chars of stderr to UI (QUAL-024)
- [ ] `app/api/debug/code-analysis/route.ts:1-15` — Comments already addressed by critical fix (QUAL-029)
- [ ] `components/views/CodePanel.tsx:186-248` — Mount-only `useEffect` with `searchParams` dependency that ignores subsequent changes (QUAL-021)
- [ ] `lib/storage.ts:19` — Session id collisions possible at scale — `nanoid(10)` gives only 10 chars (SEC-018)
- [ ] `package.json:32` — `lucide-react` pinned to `^1.9.0` — version range unusually low for 2026 (SEC-015/017)
