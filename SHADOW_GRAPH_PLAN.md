# Shadow-Graph Patcher — implementation plan

> Status: **DRAFT v2 (2026-07-10)** — revised after an adversarial design review that
> found real holes in v1 (invalidation was JS-centric and wrong for 5/8 languages; the
> synchronous execution model is an event-loop DoS; several config/edge cases undefined).
> v2 answers them by **scoping the fast path to JS/TS-precise** with declared approximations
> elsewhere, and moving all compute **off the request thread**. The keystone engine behind
> Faultline Simulator, The Conscience (`simulate_change`), and The Gate. Engine only;
> consumer features get their own plans.
>
> **v2 changelog (what the review changed):** §1 scope narrowed to JS/TS golden-guarantee;
> §6 invalidation rewritten per-plugin + config-blast pulled out of the fast path; §7 route
> moved to a worker thread with parse-cost bounds + input hardening; §3 cache-write relocated
> to the job/MCP/watch layer and `analyzedSha` dropped; §8 Stage-3 gate changed to a
> contention matrix. Full list in the amended sections.

## 1. Goal

Given a cached analysis of a repo at ref X and a set of file changes (modified/added file
contents, deleted paths, or hypothetical deletions), produce — off the request thread, in
well under a second — a fully updated CodeGraph plus the downstream verdicts (refactor-safety
tiers, ChangeBlastReport old-vs-new, Weak-Suite deltas, machine-readable `requiredActions`),
**without re-cloning or re-parsing the whole repo**.

**Correctness scope (v2):** the fast path GUARANTEES output **byte-identical to a from-scratch
analysis** for **JS/TS-only change sets** — the languages whose cross-file resolution depends
only on the path set + a serializable resolver context (recon-verified). For change sets
touching other languages or a build-config file, the engine returns a **declared
approximation** (`approximations: [...]`) or routes to full re-analysis (§6) — never a silent
divergence. This is a fast-path/slow-path routing decision inside the patcher, NOT a
language branch in the analyzer (invariant #1 intact).

Non-goals (v1): incremental git-history/hotspot/PR metrics (graph-only simulation);
multi-agent shared state (Swarm Conductor — later); private-repo simulate on unauth surfaces;
precise cross-file invalidation for Java/C#/PHP/Ruby/Go/kt/html/css (declared-approximate in
v1 — §6.4); build-config edits in the fast path (routed to full re-analysis — §6.3).

## 2. The core decision: cached-parse + full rebuild (NOT surgical splicing)

Two candidate designs were evaluated against the real pipeline (recon + live benchmarks,
2026-07-10, Apple Silicon, Node 25; script preserved in the session scratchpad):

| Phase | 1× (493 files) | 5× (2,465 files, 117k call edges) |
|---|---:|---:|
| Parse loop (what the cache **skips**) | 703 ms | 3,613 ms |
| `buildCodeGraph` warm (what rebuild **pays**) | **4.7 ms** | **48 ms** |
| `computeRefactorSafety` (withTests) | 5.4 ms | 27 ms |
| `computeChangeBlast` (both graphs) | 14 ms | 66 ms |
| `computeWeakSuite` | 0.05 ms | 0.25 ms |
| Re-parse ONE changed file (worst file) | 15 ms | 18.5 ms |
| **Simulated E2E incremental round trip** | **23 ms** | **92 ms** |
| ParsedFile[] JSON (persist cost) | 2.4 MB / 9 ms rehydrate | 11.9 MB / 46 ms |

Extrapolated to the 5,000-file walker cap: ~300 ms E2E; a 2–3× slower Railway box stays
sub-second. Cold start (WASM init 20 ms + rehydrate ≤46 ms) ≈ 100–250 ms.

> **v2 caveat (review):** these are *idle-machine, real-repo* numbers. They do NOT bound
> (a) adversarial input — one filter-passing ~1 MB dense JS file parses in ~726 ms, and
> deeply-nested content can throw "Maximum call stack size exceeded"; (b) event-loop
> contention — the whole pipeline is *synchronous*, and session-create/refresh/preview
> jobs run in the same process, so an unguarded simulate can block every route for
> seconds. v2 therefore runs the engine **in a worker thread with a wall-clock timeout and
> a cumulative-parse-cost budget** (§7), and Stage 3 re-measures *under contention* on
> Railway before any latency is promised (§8). The architecture verdict below is unchanged;
> the *serving* model is.

**Why not surgical splicing** (mutating nodes/edges in place): call resolution is
*global-by-name* — `buildCodeGraph` binds every call through a repo-wide `funcsByName`
index with candidate-count-sensitive branches (1 vs 2 same-named functions flips
`pickCallTarget` between single-match and proximity, `codeGraph.ts:339-341`), and class
names are disambiguated against repo-wide counts. Changing file X can rebind call edges
in files that neither import X nor changed. A splicer must model ALL of that or silently
diverge from full analysis. Rebuild reuses the exact production code path, so
**determinism is by construction** — and at 4.7–48 ms it costs ~1% of what the cache saves.

## 3. Architecture

### 3.1 New persisted artifact: the parse cache

`analyzeDirectory` already returns `ParsedFile[]`; `lib/github.ts:840` discards it.
We persist it — the entire engine is "one persistence decision away".

```
<DATA_DIR>/parsecache/<key>.json.gz     (path-traversal-guarded like previewStore; key = §3.1a)
{
  schemaVersion: 1,
  analyzerVersion,                  // bump → cache treated as absent
  repo, ref, universeDigest,        // djb2 of sorted contentHashes — the base-integrity check (§6.7)
  files: ParsedFile[],              // canonical order (sorted by rel — see §5)
  pluginByFile: Record<rel, pluginName>,
  extras: Record<pluginName, json>, // serialized resolver contexts (tsconfig paths,
                                    //   workspace map, Java fqnToPath, C#/PHP/Ruby type
                                    //   maps, regexFallback importsByFile) — see §6.4 for
                                    //   which are patchable vs approximated in v1
  contentHashes: Record<rel, hash>, // the exact parse universe (djb2, already computed)
  scope: { subdir?, excludeFolders?[] },  // MUST match the snapshot's analyzedSubdir /
                                    //   analyzedExcludeFolders so the universe is identical
  truncated?: string,               // if the 5000-file cap was hit — disables the fast path (§6.8)
}
```

**v2 fixes (review):**
- **Dropped `analyzedSha`** — it does not exist in the pipeline today; a moving ref (a
  branch) has no stable SHA at analysis time. Base integrity is instead the
  `universeDigest` + per-file `contentHashes` (§6.7), which the pipeline already computes.
- **Cache-write does NOT live in `github.ts`** — `analyzeRepo` doesn't know the sessionId
  (the job assigns it) and the 25 s timeout race can return a snapshot with no codeGraph.
  So: `analyzeDirectory`/`analyzeRepo` thread `files`+`extras`+`pluginByFile` OUT in their
  return value; the **caller that owns the key writes the cache** — `lib/jobs.ts`
  (create + refresh jobs), the MCP `analyzeRepo` tool, and `watchMonitor.ts` re-sweeps.
  Each of those already has the sessionId/snapshotIdx and only writes on a successful graph.
- **`scope` field:** `watchMonitor` re-sweeps must carry `analyzedExcludeFolders` forward
  (a known gap) so snapshot N and N+1 share a parse universe — else the cache is invalid.

- Separate namespace (NOT on-snapshot): `listSessions` full-reads every session JSON.
- **Async gzip** (`zlib.gzip`/`gunzip`, not `*Sync`) at level 1 — `gzipSync` at cap scale
  blocks the event loop ~140 ms on a fast Mac (~400 ms Railway), inside the already-contended
  web process. Compresses 5–10× (2.4 MB → ~300 KB).
- Backward compat (invariant #2): cache absent (old sessions, GC'd, version bump, `truncated`)
  → simulate returns a clean "base unavailable — refresh the session", never crashes.
- GC: eviction by mtime, cap total namespace size (default 500 MB), delete alongside session.
  **Note:** mtime eviction is write-order, not read-LRU; touch mtime on cache *read* so an
  actively-simulated session isn't evicted by a watch re-sweep churning new files.
- `extras` serialization: contexts use Maps — the writer normalizes Map↔object per plugin
  (one `toJSON`/`fromJSON` pair living IN the plugin file per invariant #1).

**§3.1a — cache key.** `key = sha1(repoUrl [+ '@' + ref] [+ '#' + subdir]) . snapshotIdx`,
mirroring `mcp/cache.ts`'s existing `sessionIdFor` (which today OMITS subdir — fix that so
subdir'd sessions don't collide). Validated by the same `/^[A-Za-z0-9_.@-]+$/`-style guard
`previewStore` uses; `snapshotIdx` is a bounded integer.

### 3.2 The engine: `lib/shadowGraph/`

```
lib/shadowGraph/
  types.ts       // SimulateChange = {path, newContent | null /*null = delete*/}[]
                 // SimulateResult = {report: ChangeBlastReport, requiredActions, tiers deltas, timings}
  parseCache.ts  // write (from analyze pipeline) / read / GC / schema versioning
  stubIndex.ts   // FileIndex from path set + extras — NO contents (JS resolver only
                 //   does byPath.has() key checks; verified javascript.ts:221-261)
  patch.ts       // the engine (below)
```

`patch(cache, changes) → SimulateResult`, in order:

1. **Admission + routing.** Reject if base integrity fails (§6.7) or `truncated` set (§6.8).
   Route by change set:
   - touches a **build-config file** (`tsconfig/jsconfig/package.json/go.mod/*.csproj`…)
     → `{ mode: "needs-full-analysis" }` (§6.3) — NOT fast-patched in v1.
   - touches a **non-JS/TS file** → fast-patch that file's OWN symbols, but the language's
     cross-file import edges are **frozen at base** and `approximations` names them (§6.4).
   - **JS/TS-only** → the precise fast path (steps 2–8), byte-equivalent to full analysis.
2. **Filter added files through the walker's universe gates.** An added `changes[].path`
   must pass the SAME predicates `walkAndRead` applies before parsing — size (1 MB),
   `looksMinifiedByContent`, vendored-path, `SKIP_DIRS`/dot-dirs, and the session's
   `excludeFolders`/`subdir` scope — or the patched graph would include a file full analysis
   never sees. **Extract those predicates from `analyze.ts` into a shared exported
   `fileUniverse.ts`** that both `walkAndRead` and the patcher call (kills the divergence at
   the source; not a new heuristic).
3. **Re-parse touched files only** via `parseFile(plugin, sourceFile, stubIndex)` — each
   needs only its own new content + the stub index (~1.4 ms avg). **Wrap in the same
   try/catch `analyze.ts:135` uses** so a pathological file degrades to `parseError`, never
   crashes the worker. Ensure `plugin.load()` (WASM) ran first.
4. **Re-resolve imports on a path-set change (JS/TS):** for every cached JS/TS file, recompute
   `resolvedPath = plugin.resolveImport(rawSpec, rel, stubIndex)`. Verified contents-free for
   JS (only `byPath.has` + persisted context, `javascript.ts:221-261`). Skipped for pure
   content edits. `rawSpec` is preserved on every ParsedImport precisely for this.
5. **Splice** into a copy of the canonical `files` array (replace in place; delete removed;
   insert adds at canonical sort position). **Update `pluginByFile`** for adds/deletes (else
   `byPlugin` stats + graph equality break) and `contentHashes` (djb2 of new content).
6. **Rebuild wholesale:** run the *production* `buildCodeGraph` on the patched array.
   `generatedAt` injectable (equality, §4).
7. **Verdicts:** wrap base + patched graphs in minimal snapshot-shaped objects →
   `computeChangeBlast(base, patched)` (exact existing report type = zero UI changes),
   plus tier-deltas and `requiredActions` (§7.4 — scoped honestly: two of the four action
   kinds need engine additions, not just report fields).
8. **Memoize the base graph's safety report** in hydrated state — it never changes during a
   simulation session (cuts ~30%; `computeChangeBlast` runs safety on both graphs internally).

Steps 2–8 run **inside the worker thread** (§7.1) under a wall-clock timeout + cumulative
parse-cost budget.

### 3.3 Hydrated-state LRU (warm path)

Module-level Map (established single-container pattern: `changeBlast/preview.ts`,
`rateLimit.ts`, jobs orphan recovery): key = the §3.1a cache key, value
`{files, extras, stubIndex, baseGraph, baseSafetyReport, at}`. TTL ~15 min. **Entry cap by
measured retained heap, not count:** a hydrated large-repo entry retains ~30–60 MB (parsed
arrays + base graph + safety report — the review flagged the naive ~12 MB estimate as 2.5–5×
low), and it co-resides with the preview cache (up to 40 full `AnalysisSnapshot`s) in the
same process — so cap at a **total-MB budget** (e.g. 250 MB) with LRU eviction, not "8
entries". Touch on read. Single-flight guard per key so concurrent simulates don't
double-hydrate. Cold path: async gunzip+parse (≤46 ms).

## 4. Correctness contract (the non-negotiable)

**Golden equivalence (scoped in v2):** for any cached analysis + a **JS/TS-only** change set
that does not touch a build-config file and where the base is not `truncated`,
`patch(cache, changes).graph ≡ analyzeDirectory(patchedTree).codeGraph` byte-for-byte
(modulo injectable `generatedAt` + Record key ordering — see §5). For non-JS/config/truncated
changes the contract is **"declared-approximate, never silently wrong"**: the result carries
`approximations`/`mode:"needs-full-analysis"` and the golden matrix does not assert equality
for them (they're validated only for *not-worse-than-base* + no crash).

- **Harness (net-new infra — no test today calls `analyzeDirectory` on a directory; the
  existing `golden-*` fixtures are in-memory strings).** Build a fixture-directory runner:
  write a fixture tree to a temp dir, run the real `analyzeDirectory`, snapshot its graph;
  then hydrate a parse cache from the *base* fixture, apply the change, and deep-equal the
  patched graph against a full analysis of the *mutated* fixture tree.
- **JS/TS change matrix** (each = a documented cross-file coupling that a naive engine gets
  wrong): content edit (no re-resolution); add `foo.ts` that SHADOWS `foo.js` for `./foo`;
  delete `foo.ts` re-routing `./foo` → `foo/index.ts`; add a 2nd same-named function (flips
  single-candidate binding in an UNRELATED file, `codeGraph.ts:339-341`); add a colliding
  class name (repo-wide `_2` suffix churn); rename (delete+add); edit a test file (Weak-Suite
  delta). Non-JS fixtures assert the *approximation* is returned, not equality.
- Perf regression guard: promote the recon benchmark into `scripts/`, assert rebuild
  < 150 ms at 5× fixture scale on dev hardware, PLUS an adversarial-input case (dense ~1 MB
  file → must be rejected by the parse-cost budget, not parsed).

## 5. Determinism engineering

- **Canonical ordering:** `analyzeDirectory` sorts `parsedFiles` by `rel` before
  `buildCodeGraph`. Today's order is platform-dependent `fs.readdir` (a real Mac/Windows
  divergence). **Blast radius of this change is wider than v1 admitted** — the review is
  right: beyond class-suffixes (`_2`/`_3`), it can rebind *ambiguous call edges* (proximity
  tie-breaks) and reorder `Record` keys, which changes drift fingerprints / `fileSignatures`
  and can produce one-time "since last visit" + risk-drift noise on the next real sweep.
  → **Treat as its own small landed change BEFORE the patcher**: sort, re-baseline the golden
  fixtures + any snapshot-hashing tests, and accept one noisy drift diff (documented in the
  commit). The patcher then splices at canonical positions → patched vs full order identical
  by construction.
- **Byte-equality needs canonical `Record` serialization** (sorted keys) in the equality
  assertion — JS object key order follows insertion, which the splice can perturb; compare
  via a canonicalizing serializer, not raw `JSON.stringify`.
- `generatedAt` injectable; excluded from equality. `analyzerVersion` stamp: any
  plugin/codeGraph/weakSuite logic change bumps it; stale caches treated as absent.

## 6. Invalidation semantics (the hard part — v2 rewrite)

The v1 table was **JS-centric and wrong for 5/8 languages** (recon confirms: Java/C#/PHP/Ruby
build resolver extras from other files' *contents* — package/namespace/type declarations — so
a content edit rebinds imports in unchanged files; regexFallback bakes edges in
`prepareForRepo` and cannot re-resolve; Go needs `go.mod`). v2 draws a hard capability line:

**Per-plugin capability flag** (lives in each plugin, invariant #1):
`fastPatchable: true` only for the JS/TS plugin (resolution = path-set + serializable context,
contents-free, `rawSpec`-re-resolvable). All other plugins: `false`.

| Change class | v2 action |
|---|---|
| **6.1 JS/TS content edit, no path-set delta** | Re-parse touched only. No re-resolution (verified contents-free). GOLDEN. |
| **6.2 JS/TS add/delete/rename** | Re-parse touched + `fileUniverse` filter on adds (§3.2.2) + re-resolve ALL cached JS/TS imports from `rawSpec` (shadowing / index / tsconfig / workspace candidates). GOLDEN. |
| **6.3 Build-config edit** (`tsconfig/jsconfig/package.json`/`go.mod`/`*.csproj`…) | **Not fast-patched in v1** — the workspace map needs N `package.json` files + `fs.stat` probing of `src/index.*` that aren't in the cache and can't be rebuilt from one file's content. Return `mode:"needs-full-analysis"` (web: offer a re-analyze CTA; MCP: tell the agent to re-run `analyze_repo`). Config edits are rare in the per-edit agent loop. *v2-future:* fast-path pure `tsconfig.paths` edits (rebuildable from that one file). |
| **6.4 Non-JS/TS file change** (Py/Go/Java/C#/PHP/Ruby/kt/html/css) | Re-parse the touched file's OWN symbols (functions/calls/complexity/classes/testMeta — content-local, correct), but that language's **cross-file import edges stay frozen at base**; the result names it: `approximations: ["go import edges frozen at base for this change"]`. Honest + bounded. (Blast/walls that don't cross that language's import edges are still right.) *v2-future:* per-file extras patching for Java/C#/PHP (each file's package/type contribution is independent — persist it alongside ParsedFile). |
| **6.5 Non-code side-data** | Hotspots/co-change/PR/drift are git-history-derived and unaffected by a hypothetical edit — the simulated snapshot reuses base values; the report only claims graph-derived facts (all `ChangeBlastReport` uses). |
| **6.6 Oversized diff** (> parse-cost budget, e.g. cumulative touched bytes over a small cap) | Reject with `mode:"too-large"` — do NOT attempt a "route to full-analysis job", which is **unbuildable**: there is no repo tree server-side to analyze a hypothetical patched state, and no job kind for it. (v1 claimed this; it's wrong.) |
| **6.7 Base integrity** | Caller sends each touched file's BASE-content djb2 (both surfaces can compute it — MCP reads the local file, web caller reads it from its own checkout / passes the hash it has) + the `universeDigest`. Engine compares → `baseMismatch:[paths]` instead of silently judging against the wrong base. If the caller genuinely can't produce base hashes, the result is downgraded to `unverified-base` rather than trusted. |
| **6.8 Truncated base** | If the base analysis hit the 5000-file cap (`truncated` set), golden equivalence cannot hold (the universe is incomplete) → fast path disabled, `mode:"needs-full-analysis"`. |

## 7. Surfaces (thin in v1 — the engine is the deliverable)

**7.1 Compute runs in a worker thread (both surfaces).**

> **STATUS 2026-07-23 — worker DEFERRED, confirmed unwarranted by measurement.** The
> `worker_threads` offload was never built (it's Next-fragile). v1 ships the bounded-synchronous
> path (`runPatch.ts` per-file + cumulative byte caps) + a compute gate (`computeGate.ts`, 2
> slots + bounded queue → 503 "busy") + timing telemetry (`simulateTelemetry.ts`), under the rule
> "measure first; build the worker only if p95 drifts past ~1s under load." The prod contention
> re-measure is now done: `npm run faultline-probe` fired 45 delete-sims at the zod demo
> (concurrency 1→2→4) and read the SERVER-side compute timing back from the founder-metrics tap —
> **p50 42ms · p95 87ms · max 102ms, 0 gate sheds.** (Client round-trip was 0.4–1.0s and rose
> with concurrency, but that's network + queueing to Railway, not the compute the worker would
> offload.) ~10× under budget → the offload below stays deferred. Re-run the probe as real
> traffic grows to re-confirm before ever reopening this.

The whole patch/parse/rebuild is
CPU-bound and synchronous, and the web process also runs analysis jobs — so `patch()` runs
in a `worker_threads` Worker with (a) a **wall-clock timeout** that terminates the worker on
breach → `{mode:"timeout"}`, and (b) a **cumulative-parse-cost budget** checked before each
file parse (reject total touched bytes over a small cap — much tighter than the 5 MB payload
cap, since 5×~1 MB dense files = ~3.6 s of parse). This keeps the event loop free under
interactive load. A small worker pool (1–2) bounds concurrent CPU. (MCP side: same worker,
though contention matters less there — one agent, its own process.)

**7.2 MCP `simulate_change` (agent-side).** Stdio ON the agent's machine, imports `lib/`
directly — working tree is local, diffs never upload. Contract: `{sessionId, changes:
[{path, newContent|null, baseHash}]}` → compact SimulateResult (token-budgeted). Base graph
+ parse cache from `~/.gitvision/cache` (add **the same path guard `previewStore` uses** — a
prompt-injected `sessionId` must not become an arbitrary local `.json` read/overwrite; the
cache dir also needs the size cap the web GC has — it's already 67 MB on this machine).
**Reframe:** stdio servers restart often, so *cold is the common case* — but measured cold
cost (WASM 20 ms + gunzip/parse ≤46 ms) is small, so no warm-state engineering needed here.

**7.3 Web `POST /api/sessions/[id]/simulate`.** Answers inline (no job queue — the compute is
sub-second and lives in the worker, not the 60 s-timeout territory jobs exist for). Gate
stack, established order: per-IP rate limit (new `RATE_LIMITS.simulate`, generous ~120/hr) →
auth → **session read-access (404) BEFORE the parse cache is hydrated** (never load a private
repo's cache for a non-owner; `isDemoSession` bypass must not weaken this) → tier gate (new
`BooleanFeature "simulate"`, Plus+) → **input hardening (all net-new — no precedent):**
- **path validation:** canonicalize each `changes[].path` to posix; reject absolute, any `..`
  segment, leading `/`, control chars, `.gitvision` prefixes; dedupe. (Paths flow into
  contentHashes keys, splice targets, and the echoed report → validate before use.)
- **body caps on MEASURED streamed bytes, not `Content-Length`:** per-file 1 MB + the
  `looksMinifiedByContent` gate (the walker's *second* filter — else minified blobs, the
  tree-sitter pathological case, reach the parser); total payload cap; max entries.
- **parse-cost budget** (§7.1) is the real DoS control; body caps are the coarse first gate.

Hypothetical ops (Faultline delete/extract) send `newContent:null` — no content upload.

**7.4 Result type + `requiredActions` (honestly scoped).** Existing `ChangeBlastReport` +
`{requiredActions, tierDeltas, approximations, baseMismatch, mode, timings}` — PreviewClient/
BlastCard consume the report unchanged (the extra fields carry a `pr`-less "working tree vs
base" descriptor). **`requiredActions` is partly a design task, not just field-mapping:** two
of the four intended kinds are *directly* derivable from the report — walls touched (from
`loadBearingTouched`/`changedFiles.tier`) and guarding tests not updated (from
`testsToRun`/`mappedTestsUpdated`); the other two — **"hollow tests added"** and **"new
structural duplicate introduced"** — are NOT in `ChangeBlastReport` today and need small
engine additions (a Weak-Suite delta of *newly-hollow* cases in changed test files; a
duplicate-group delta of *new* bodyHash collisions). Scope these into Stage 1, not hidden in
Stage 2.

## 8. Staged build (each stage gated: tsc + full suite + golden tests + adversarial review)

| Stage | Deliverable | Exit gate |
|---|---|---|
| **0a. Canonical ordering** (S, lands FIRST, standalone) | Sort `parsedFiles` by `rel` in `analyzeDirectory`; re-baseline golden fixtures + snapshot-hash tests; canonical `Record` serializer for equality. | Suite green; one documented drift-noise diff accepted (§5). |
| **0b. Persist the parse layer** (S) | `fileUniverse.ts` (extract walker predicates); `parseCache.ts` write/read/async-gzip/GC + per-plugin extras (de)serialization + `analyzerVersion` + `scope`/`universeDigest`. **Thread `files`/`extras`/`pluginByFile` out of `analyzeDirectory`→`analyzeRepo`; write the cache in the KEY-OWNING callers** (`jobs.ts` create+refresh, MCP `analyzeRepo` tool, `watchMonitor.ts` — the latter must forward `excludeFolders`). Only on a successful `codeGraph`. | Round-trip: cache → rehydrate → `buildCodeGraph` ≡ original graph, for web + MCP + refresh paths. Suite green. |
| **1. The engine** (M–L, the heart) | `stubIndex.ts` + `patch.ts` (§3.2), capability flags (JS/TS `fastPatchable`), the §6 routing (config/non-JS/truncated → declared modes), base-integrity check, worker-thread harness + parse-cost budget, and the two `requiredActions` engine additions (§7.4). | **Golden matrix green for the JS/TS change matrix; approximation-returned assertions green for non-JS/config (§4)** + perf budget incl. adversarial-input rejection. Adversarial re-review of invalidation. |
| **2. Surfaces** (S–M) | MCP `simulate_change` (+ cache path guard + size cap) and web `/simulate` (full gate stack, path validation, streamed body caps, worker offload). | E2E: real repo, real diff → verdict matches a full two-ref analysis of that change. **Security review of the new input surface** (path traversal, parser DoS, private-repo cache-load ordering). |
| **3. Hardening** (S–M) | MB-budgeted hydrated LRU + single-flight + read-touch GC, base-safety memoization, worker pool sizing, prod re-measure. | **Contention matrix (NOT sequential):** simulate p50/p95 (i) idle, (ii) during a running analysis job's parse phase, (iii) 3 concurrent simulates, (iv) adversarial payload → rejected fast. Memory cap held under load. Prod timing in PROGRESS. If p95 misses budget under (ii), also land a `setImmediate` yield in the `analyze.ts` parse loop (helps every route). |

Consumer features (Faultline Simulator UI, Conscience agent-loop packaging, The Gate)
are **separate follow-on plans** on top of the stable engine API.

## 9. Risks & mitigations

- **Silent divergence** (the killer): mitigated structurally (full rebuild via the production
  code path) + the golden matrix as a permanent regression net + the **JS/TS-only guarantee
  with everything else declared-approximate** (v2's core answer — we never claim precision we
  can't prove). Any future plugin change that breaks equivalence fails tests, not users.
- **Event-loop contention / parser DoS** (the review's top finding): compute in a worker
  thread with a wall-clock timeout + cumulative-parse-cost budget; Stage 3 gate is a
  *contention* matrix, not a sequential one. This is the difference between "great in the
  demo" and "survives production".
- **Railway slower + cold:** measured headroom is large but at the 5000-file cap on a 2–3×
  box the margin narrows — Stage 3 re-measures on prod before any latency is promised;
  `mode:"too-large"`/`needs-full-analysis` are honest escape hatches, not failures.
- **Memory:** corrected — a hydrated large-repo entry retains ~30–60 MB (not 12), co-resident
  with the 40-entry preview cache; cap by a **total-MB budget** (~250 MB) with read-LRU, not
  entry count.
- **Analyzer-version skew:** version stamp treats old caches as absent — the known
  analyzer-version follow-up pattern from ROADMAP applies.
- **Approximations are explicit** in the result payload (`approximations`/`mode`), never
  hidden — the "computed, never generated" brand demands we surface uncertainty.
- **Fixture maintenance cost:** the golden matrix is the project's most valuable test asset
  going forward (it also guards ordinary analyzer refactors); worth the upkeep.

## 10. Open items for Jonas

1. **Gating:** new `simulate` BooleanFeature at Plus (recommended — it's the interactive
   hook), or bundle under `refactorGuidance`?
2. **v1 language scope:** confirm JS/TS-precise + declared-approximate elsewhere is the right
   v1 line (recommended — it's where the agent/walls value is and it makes the correctness
   contract provable). Non-JS precision is a v2 follow-on.
3. **Config-edit UX:** `needs-full-analysis` for tsconfig/package.json edits in v1 — acceptable
   (they're rare in the agent per-edit loop), or is a tsconfig-paths fast-path wanted in v1?
4. **Canonical-ordering change (Stage 0a):** approve landing it first as its own commit, with
   one accepted drift-noise diff on the next real sweep.
5. Parse-cache GC budget on the Railway volume (250–500 MB default?) + the MCP `~/.gitvision/cache`
   size cap (yours is already 67 MB).
