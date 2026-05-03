# GitVision — Progress & Design Notes

> Living document — update as the project evolves. Picks up where the first collab session ended.

---

## The pitch, in one sentence

A desktop-grade repo visualizer that feels like a Figma canvas — paste a GitHub URL, get an explorable map of files, contributors, hotspots, and package-dependency health you can save, update, and screenshot to share.

## Guiding principles (do not compromise on these)

1. **Tell a story, don't just show numbers.** GitHub Insights is boring because it's dry. Every view should give an "aha" moment.
2. **Every view must be screenshot-worthy alone.** If a chart can't stand on its own as a shareable image, it either gets improved or cut.
3. **Exploit the "update" angle.** Refresh isn't just a data-refetch — it's *"what changed since last you looked"*. That's gold for teams and solo devs alike.
4. **Polish on localhost first, port to Tauri later.** Web iteration is 10× faster. Port when the product is ~90% of what we want.
5. **Language-agnostic by architecture.** Anywhere we add language support (imports, dep-health, AST), it's through plugins. Adding a new language should never require touching signals, types, UI, or storage.

---

## Strategy & current focus (post-v0.30)

GitVision deliberately delayed public launch until the core experience covered most languages, most repos, and three actionable insight surfaces (refresh-banner, untested hotspots, near-duplicates). Decision logged end of session 6: rather invest the time polishing than risk a bad first impression on a broader audience.

**Phase 1 + 2 + 3 are now COMPLETE** (end of session 8). Five releases shipped in Phase 3: v0.26 anonymous owner-id session isolation, v0.27 refresh-banner narrative, v0.28 CallEdge.toContainerType overload disambiguation, v0.29 test-to-code mapping with coverage badges + Untested Hotspots panel, v0.30 AST duplicate detection with Near-Duplicates panel.

**Launch readiness is now a genuine decision point** — the core product has the depth (7/8 languages on AST + Phase 5 type-aware), the scaling (subset analysis + job queue, no request-timeout cap), the safety (anonymous session isolation), and the actionable insight panels (story-driven refresh banner + two compute-heavy "what to do next" panels). The 6-step launch-readiness list discussed end of session 6 is unblocked.

### Vision (held open until validated)

A tool people integrate into their daily workflow — solo or team. Not a quick try-it-and-leave SaaS. The bar for launch is therefore high. The "profile · login · upgrade-account" pivot question is genuinely on the table but **paused** until Phase 3 lands and we have a product worth showing. Validation comes from real-user signal post-launch, not up-front investment in tier mechanics.

### Phases (in order)

**✅ Phase 1 — Language coverage (shipped, ~3 evenings total)**
- ✅ v0.21: C# tree-sitter migration. Java-style pattern (package + class FQN indexing), strong type system → Phase 5 type-aware lands cleanly. Live-validated against `serilog/serilog`: 214 files, 1554 functions, 5580 calls, 40.8% resolved.
- ✅ v0.22: PHP tree-sitter migration. Typed signatures where present (PHP 7+), dynamic elsewhere. Live-validated against `Seldaek/monolog`: 121 files, 671 functions, 35% resolved.
- ✅ v0.23: Ruby tree-sitter migration. Fully dynamic — Phase 5 falls back to same-file / imported-file resolver, containerType still holds for class-method scoping. Introduced `ParsedCall.hasReceiver` contract so receiver-having calls without inferable type don't single-candidate-match (cut 76 spurious lib→spec edges in `rspec/rspec-core` to 3). Live-validated: 233 files, 1405 functions, 24,518 calls, 16.2% resolved.
- ⚠️ Kotlin stays blocked (WASM ABI mismatch with web-tree-sitter@0.26.8 — see "Next up" section below).
- Outcome: **7 of 8 supported languages on AST + parseDirect**, only Kotlin on regex-fallback.

Grammar smoke-test passed end of session 6: `tree-sitter-c-sharp.wasm` (5.1 MB), `tree-sitter-php.wasm` (1.0 MB), `tree-sitter-ruby.wasm` (2.1 MB) all ship with `@vscode/tree-sitter-wasm@0.3.1` and load + parse cleanly via `web-tree-sitter@0.26.8`. No Kotlin-style ABI surprise.

**✅ Phase 2 — Big-repo handling (shipped, ~5 evenings total)**
- ✅ v0.24: Subset analysis. `downloadAndExtract` takes optional `{ subdir }` and uses `tar.x`'s filter callback to keep only entries inside that subdir + a curated list of root-level manifest files (package.json, go.mod, tsconfig.json, …). `validateSubdir` rejects path-traversal / over-long inputs. `SubdirNotFoundError` propagates as a 400 (not silently fallback to whole-repo). UI: collapsed disclosure with auto-fill from `https://github.com/owner/repo/tree/branch/path` deep-links. Live-validated: `golang/go` with `src/cmd` → 1909 files, 22,041 functions, 203,558 call-sites — repos that previously timed out on the codeAnalysis stage now analyze end-to-end on localhost.
- ✅ v0.25: Job queue + async. `POST /api/sessions` enqueues a job and returns `{ jobId }` in <1s via Next.js's `after()` hook; the analysis runs detached from the HTTP request. Frontend polls `GET /api/jobs/:id` every 2s. File-based job storage (`<DATA_DIR>/jobs/<id>.json`, atomic write via temp+rename) survives Railway redeploys. Orphan-recovery sweep on first request after a fresh server boot marks `pending`/`running` jobs as failed. Same flow used by `POST /api/sessions/:id/refresh` so refresh is also unbounded by request timeout.
- Outcome: **any repo that fits within reasonable disk + memory budgets analyzes successfully** on Railway, no request-timeout cap.

**✅ Phase 3 — Polish & wow (shipped, ~5 evenings total)**
- ✅ v0.26: Anonymous owner-id session isolation. UUID written to localStorage on first visit, attached as `X-Owner-Id` header to every session-create. Landing page filters to "yours" — no "47 random people's sessions" first-impression.
- ✅ v0.27: Refresh-banner narrative. `pickHeadline` priority logic produces a story-driven headline ("Code complexity grew by 45 — new branching logic added across the codebase") instead of a metadata diff. Primary/secondary chip emphasis, brand line, "ago" wording. Screenshot-worthy alone (Guiding-Principle 2).
- ✅ v0.28: CallEdge.toContainerType extension. Resolved the v0.20 chip-dedup workaround (commit `2d4fede`) — same-named overloads (`Blueprint.__init__` vs `BlueprintSetupState.__init__`) are now distinct function-blast-radius targets. Live-validated on Flask: `Blueprint.add_url_rule` (3 callees) vs `BlueprintSetupState.add_url_rule` (0 callees) prove disambiguation works end-to-end.
- ✅ v0.29: Test-to-code mapping via call-graph. `computeTestCoverage` classifies functions into prod/test by path/filename heuristics (no external coverage data needed), then walks call edges to mark prod functions called by test files as "covered". UI: per-file coverage badge ("5/8" with color scaling 0% rose → 50% amber → 100% accent), Untested Hotspots panel with most-complex-no-test-callers list. Headline stat: "X% prod fns covered".
- ✅ v0.30: AST-based duplicate detection. FNV-1a 64-bit hash over tree-sitter subtrees walks named children + binary/assignment/unary operators but ignores identifier names + literals. All 7 plugins emit `bodyHash` per function. `findDuplicateGroups` filters by complexity ≥5, group size ≥2, sorts by `groupSize × maxComplexity`, caps at 15. Live-validated on golang/go src/cmd: 15 groups, 118 functions, largest ×36 — caught the canonical SSA-rewrite families (`OpAdd16/32/64/8`, `OpLsh<size>x<size>`, ARM register-shift opcodes).

### Unblocked — Phase 3 has landed

Items that were on hold pending Phase 3 are now genuine candidates:

- **Launch-prep** (landing copy, public-beta framing, feedback channel, analytics tagging) — actionable now. Anonymous owner-id (v0.26) makes the first-impression UX safe; the three insight panels make the value proposition obvious in screenshot form.
- **OAuth / "Login with GitHub"** — still a pivot question, not a feature. Validates whether the SaaS-platform direction is justified. Worth deferring until real-user signal post-launch tells us whether day-2+ retention exists.
- **"Upgrade account" / SaaS billing** — depends entirely on real-user signal post-launch.
- ~~Token-felt as launch fallback~~ — obviated by job queue + anonymous sessions.
- ~~Big-repo gate as graceful-skip patch~~ — Phase 2's job queue obsoleted it.

---

## Current state (v0.30, end of session 8)

### What works end-to-end

- Paste a public GitHub URL → session created with full initial snapshot
- Sessions saved as JSON files on disk, listed on landing page
- Session page tabs: **Canvas / Imports / Code / Packages / PRs / Overview**
- Loading UI during analysis: 5-stage progress with gradient bar, not a blank 30s wait
- **Canvas (hero view):**
  - Folder frames with labels (`● foldername · N files`)
  - File cards sized uniformly (150px), color-coded by file extension
  - Shelf-packed layout: guaranteed zero overlap
  - Ambiguous basenames like `package.json` shown as `parent/basename` (monorepo disambiguation)
  - Click a card → side panel with authors, co-change partners, recent commits
  - `filter path…` search input (debounced, auto-refit)
  - Min-churn slider (debounced via `useDeferredValue`)
  - **Color by type / by author** — contributor overlay with up to 10 distinct palette colors + legend
  - **Time-scrubber** (week / day / commit granularity) — spans FULL reachable history (v0.4)
  - All edges / minimap toggles (off by default for perf)
  - Auto-fit on mount + after any filter change
  - Drag, zoom, pan — full React Flow interaction set
- **Imports tab** (v0.3, renamed from "Dependencies" in v0.9): file-to-file import graph with brick-staggered layer layout
  - Languages: **JS/TS/JSX/TSX/MJS/CJS, Java, Kotlin, C#, PHP, Ruby, Python, Go** + HTML/CSS as render targets
  - Edge kinds: `import`, `renders` (Spring MVC controller → template), `extends`, `implements`
  - Toggleable per kind, path-search filter, "hide isolated" toggle, click to isolate 1-hop neighborhood
  - Backed by `lib/graph.ts` regex pipeline; in v0.10 this also drives `codeAnalysis`'s regex-fallback plugin for the 7 non-JS languages so a single tarball-extract feeds both panels
- **Packages tab (v0.9):** multi-ecosystem dependency health — see "Dependency-health pipeline" below
- **PRs tab** (v0.3): sankey of cycle-time flow (Opened → Merged / Closed / Still-open → time-to-merge bucket). Powered by d3-sankey. Median-time-to-merge + merged-% stats.
- **Overview tab:** hotspot treemap (muted teal→emerald→amber→rose palette, label truncation with ellipsis), contributor list, language mix, bus factor per folder, weekly commit activity.
- **Share cards** (v0.3): branded 1200×630 (landscape) and 1080×1080 (square) layouts.
- **Contributor Wrapped** (v0.3): Spotify-style portrait cards per top contributor.
- **AI summary** (v0.5, tuned in v0.8): Claude Sonnet 4.5 profile per snapshot. 150-200 word prose with hard rules + few-shot example prompt. Stored on snapshot — regeneration is explicit. Requires `ANTHROPIC_API_KEY` (panel gracefully hides the feature when missing).
- **Health Check (v0.6):** three-column verdict (What works / Where to dig deeper / Open questions) via hybrid rule-based signals + Claude narrative. **17 deterministic signal detectors** as of v0.9 (see "Signal catalog" below).
- **Screenshot:** PNG export of whole session page via `html-to-image`.
- **Refresh:** append snapshot, show "Since your last visit" diff banner with emerald gradient.
- **Session CRUD:** rename, delete, multiple sessions. Session actions grouped: Share dropdown (Wrapped / Share card / Screenshot), primary Refresh, overflow menu for Delete.
- **Rate-limit aware:** shows remaining in footer.
- **Code tab (v0.11, function-level blast radius added in v0.20, three insight panels added in v0.28-v0.30):** AST-based blast-radius UI on top of the codeAnalysis pipeline. Picks the heaviest file by default, shows incoming + outgoing dependency hops (3 deep, capped at 200 files per direction), the file's top-6 functions in the header (now clickable), plus side-by-side "heaviest files" and "most complex functions" lists for quick navigation. **Click a function chip or a top-functions item → zooms into function-level blast radius**: callers (functions that call this) and callees (functions this calls), same hop-3 / cap-200 BFS, distinct icons (PhoneIncoming/PhoneOutgoing), `(file, name, containerType)` tuple targeting since v0.28 keeps overloads distinct. Empty-state hint when a function has no resolved calls. Coverage chip (generalized in v0.21) sums across every AST plugin and lists active languages inline ("214 AST files (C#)"). **Untested Hotspots panel (v0.29):** most-complex production functions with no test caller, ranked, click to zoom blast radius. Per-file coverage badges ("5/8") on the heaviest-files list with color scaling 0% rose → 50% amber → 100% accent. **Near-Duplicates panel (v0.30):** structural duplicate groups detected via per-function `bodyHash`, sorted by `groupSize × maxComplexity`, expandable with click-to-zoom on each member. Header stat: "X groups · Y fns · largest ×Z". New snapshots get `codeGraph` populated automatically; old snapshots show an empty state pointing to the Refresh button.
- **Code-analysis pipeline (v0.10 foundation, expanded through v0.23):** AST-based parsers via tree-sitter (WASM) for **7 of 8 supported languages** (JS/TS, Python, Go, Java, C#, PHP, Ruby); regex-fallback only handles Kotlin (blocked by WASM ABI mismatch) plus HTML/CSS as render-target file types. Unified `CodeGraph` aggregate persisted on every fresh snapshot since Phase 4a. Also exposed standalone via `/api/debug/code-analysis` for live testing and `npm run analyze <path>` for local inspection. See "Code-analysis pipeline" below.

### Dependency-health pipeline (v0.9 architecture)

Plugin-based architecture designed so adding a new ecosystem is one file:

```
lib/depsHealth/
├── index.ts              Orchestrator — runs every plugin whose
│                         manifests are present. One DependencyHealth
│                         per ecosystem, aggregated at signal/UI level.
├── types.ts              EcosystemPlugin contract + shared types.
├── tree.ts               GitHub Trees API fetch (recursive=true,
│                         universal skip-patterns).
├── osv.ts                OSV.dev batch query (ecosystem-agnostic).
├── pool.ts               Concurrency-limited map helper.
└── ecosystems/
    ├── npm.ts            registry.npmjs.org     → OSV "npm"
    ├── cargo.ts          crates.io              → OSV "crates.io"
    └── pypi.ts           pypi.org               → OSV "PyPI"
```

Per-ecosystem the pipeline is: fetch manifests → parse → dedupe (name,version)
→ registry meta → OSV batch → categorize into outdated / vulnerable / deprecated
with `sources[]` tracking which manifest files declared each dep.

**Outputs per snapshot:**

| Field | Shape |
|---|---|
| `dependencyHealths` | `DependencyHealth[]` (one per detected ecosystem) |
| *each entry* | `{ ecosystem, total, uniquePackages, packageFiles, outdated, vulnerable, deprecated, note? }` |

Backward-compat: pre-v0.9 snapshots stored singular `dependencyHealth`.
Read-side helper `getDependencyHealths()` normalizes both shapes.

### Code-analysis pipeline (v0.10 architecture)

Plugin-based, designed so adding a new language (or migrating one off regex
to AST) is a single file. Same mindset as `lib/depsHealth/`.

```
lib/codeAnalysis/
├── analyze.ts              Orchestrator — walks a directory, runs every
│                           plugin whose extensions are present, aggregates
│                           results into a CodeGraph.
├── codeGraph.ts            Cross-file aggregator: function index, call
│                           resolution + disambiguation, import dedup,
│                           per-plugin stats roll-up.
├── parse.ts                Per-file dispatcher — tree-sitter pipeline OR
│                           plugin-supplied parseDirect (regex / non-AST).
├── runtime.ts              web-tree-sitter WASM bootstrap + grammar cache.
├── tsconfig.ts             tsconfig/jsconfig loader for path mappings.
├── workspaces.ts           pnpm/yarn/npm workspace package discovery.
├── types.ts                Plugin contract + CodeGraph types.
├── cli.ts                  Dev CLI: `npm run analyze <path>`.
└── plugins/
    ├── javascript.ts       Tree-sitter (JS/TS/TSX/MJS/CJS/MTS/CTS) — full
    │                       imports + functions + calls + complexity, plus
    │                       type-aware call resolution since v0.17.
    │                       parseDirect with manual AST walk that tracks
    │                       class fields (TS public_field_definition with
    │                       type_annotation), constructor parameter
    │                       properties (`constructor(private x: Foo)`),
    │                       method parameter types, typed local var
    │                       declarations, and `new Foo()` initializer
    │                       inference. JS files (no annotations) gracefully
    │                       degrade — only containerType from class context.
    ├── python.ts           Tree-sitter (.py) — same coverage as
    │                       javascript.ts PLUS type-aware call resolution
    │                       since v0.18. parseDirect tracks class-level
    │                       annotated fields (PEP 526), self.X assignments
    │                       in __init__ (when the param is typed), function
    │                       parameter type hints, and `x: Foo = ...` typed
    │                       local assignments. Untyped Python falls back
    │                       to name-match gracefully.
    ├── go.ts               Tree-sitter (.go) — same coverage as
    │                       javascript.ts PLUS type-aware call resolution
    │                       since v0.16. parseDirect with two-pass walk:
    │                       pass 1 collects struct field types; pass 2
    │                       walks methods tracking receiver types,
    │                       parameter types, and `var x Type` declarations.
    │                       prepareForRepo still reads go.mod for module-
    │                       prefix-aware import resolution.
    ├── java.ts             Tree-sitter (.java) — same coverage as
    │                       javascript.ts PLUS type-aware call resolution
    │                       since v0.15. Uses parseDirect with manual AST
    │                       walk to track field types, parameter types,
    │                       and local variable types in scope; resolves
    │                       receiver types on every method_invocation.
    │                       Methods get containerType (their owning class).
    └── regexFallback.ts    Wraps lib/graph.ts's per-language regex parsers
                            (Kotlin, C#, PHP, Ruby + HTML/CSS as passive).
                            Imports-only — no functions/calls/complexity
                            from regex.
```

**Two execution paths in the plugin contract:**
- Tree-sitter plugins implement `languageFor(ext)` + `queriesFor(ext)`. The
  orchestrator compiles S-expression queries and walks captures by canonical
  names (`spec`, `name`, `callee`, `body`, `params`).
- Direct plugins implement `parseDirect(file, ix)`. Used when AST parsing
  doesn't apply (the regex-fallback plugin) or as an escape hatch.

**Coverage matrix (live-tested against real repos):**

| Language family | Plugin | Imports | Functions | Calls | Complexity | Type-aware |
|---|---|---|---|---|---|---|
| JS / JSX / MJS / CJS | `javascript` | ✅ AST | ✅ | ✅ | ✅ | ✅ (v0.17, containerType only — JS has no type annotations) |
| TS / TSX / MTS / CTS | `javascript` | ✅ AST | ✅ | ✅ | ✅ | ✅ (v0.17, full) |
| Python (.py) | `python` | ✅ AST | ✅ | ✅ | ✅ | ✅ (v0.18, type hints) |
| Go (.go) | `go` | ✅ AST | ✅ | ✅ | ✅ | ✅ (v0.16) |
| Java (.java) | `java` | ✅ AST | ✅ | ✅ | ✅ | ✅ (v0.15) |
| Kotlin, C#, PHP, Ruby | `regex-fallback` | ✅ regex | — | — | — | — |

**Resolver features (the JS/TS plugin):**
- TS-ESM convention: `./foo.js` spec → `./foo.ts` file (and the .jsx/.mjs/.cjs ↔ .tsx/.mts/.cts pairs).
- tsconfig path mappings (`@/*`, `~/*`, etc.) loaded per-repo.
- Workspace package resolution (`@scope/name` → `packages/name/src/index.ts`) for pnpm/yarn/npm monorepos.
- Empty / dot path resolution (`import "../.."` → `index.{ts,js,...}` at repo root).
- Vendored / minified file filter — skips `tests/assets/`, `vendor/`, `*.min.js`, and content with avg-line-length signatures of bundled output.

**Live validation matrix** (resolved-imports % is a meaningful proxy for resolver coverage):

| Repo | Stack | Files | Resolved imports |
|---|---|---|---|
| ai/nanoid | JS | 21 | 27.8% (mostly external) |
| colinhacks/zod | TS monorepo | 400 | 67.0% |
| vuejs/core | TS monorepo | 524 | 86.6% |
| vitejs/vite | TS monorepo | 1,434 | 47.0% |
| trpc/trpc | TS monorepo | 902 | 64.1% |
| tanstack/query | TS monorepo | 1,003 | 56.0% |
| vercel/swr | TS | 262 | 35.1% |
| preactjs/preact | JS | 237 | 38.8% |
| expressjs/express | JS (CJS) | 141 | 38.8% |
| microsoft/playwright | TS | 1,526 | 51.9% |
| spring-projects/spring-petclinic | Java | 60 | 100% |
| django/django | Python | 3,360 | 99.99% |
| golang/example | Go | 40 | 100% |

**Outputs per repo (the `CodeGraph` shape):**
- `functions: FunctionDef[]` — name + filePath + rows + complexity
- `calls: CallEdge[]` — fromFile, fromFunction, calleeName, toFile, toFunction
- `imports: ImportEdge[]` — from, to, kind (import / extends / implements / renders)
- `fileComplexity`, `filesByExt`, `byPlugin` — stats for UI/debug
- `truncated`, `generatedAt` — caps + freshness

**Where it's exposed:**
- **Code tab on every session page (v0.11)** — blast radius hero card + heaviest-files + most-complex-functions lists. Reads `snapshot.codeGraph` directly; the BFS runs client-side (`lib/codeAnalysis/blastRadius.ts`) so picking a different file recomputes instantly without a server round-trip.
- `GET /api/debug/code-analysis?repo=owner/name` — full pipeline against a public repo, JSON summary. Auto-deployed on Railway.
- `npm run analyze <local-path>` — same shape, runs against a local checkout.

**Migration story for the 7 fallback languages:** add a tree-sitter plugin file per language (one file each), shrink `regexFallbackPlugin.extensions`, eventually delete `lib/graph.ts` entirely when the last language migrates.

### Signal catalog (v0.9 — 17 detectors)

Every signal is a pure function over an `AnalysisSnapshot`. Unit-tested in `lib/__tests__/signals.test.ts`.

**Positive (working) signals**
- `healthy-pr-throughput` — merged ≥ open among human-authored PRs
- `fast-pr-cycle` — sub-3-day median time-to-merge (human-authored only)
- `broad-ownership` — ≥3 folders with 3+ recent contributors
- `very-active` — last commit within 7 days
- `consistent-cadence` — ≥60% of sampled weeks had activity
- `good-test-presence` — ≥60% of top-churn code files have discoverable tests
- `real-code-activity` — ≤20% of top hotspots are metadata
- `many-contributors` — 20+ contributors with healthy top-5 share
- `fresh-deps` — all ecosystems clean (no CVE, no deprecated, <20% six-month-stale)

**Concerning (needsWork) signals**
- `pr-backlog` — open > merged × 1.5 (human-authored, bot-filtered)
- `slow-pr-cycle` — ≥14-day median time-to-merge (human-authored)
- `bus-factor-risk` — single-owner folders (suppressed on solo projects to avoid double-dipping with `solo-project`)
- `untested-hotspots` — ≥50% of top-churn code files lack tests (gated: suppressed when repo has ≥30 test files globally, to avoid false positives when tests live in unconventional layouts)
- `cross-boundary-coupling` — file pairs across different top-level folders co-change ≥3 times (domain-aware: source→output folder pairs like `scripts→docs` are excluded)
- `vulnerable-deps` — any CVE across any ecosystem (HIGH severity)
- `outdated-deps` — 3+ packages ≥12 months behind
- `deprecated-deps` — any deprecated/yanked packages
- `stale` — last commit >90 days ago

**Questions**
- `solo-project` — only one contributor visible
- `metadata-dominance` — ≥60% of top hotspots are metadata files
- `missing-hygiene` — no LICENSE and/or no README (README check uses the definitive GitHub `/readme` endpoint since v0.6, not path heuristics)

### Data we fetch & compute

Per snapshot:

| Source | What |
|---|---|
| GitHub REST API | Repo metadata, top 100 contributors, language bytes, recent 300 commits, last ~200 PRs, `/readme` existence check |
| Server-side `git clone --bare --filter=blob:none` + `git log --raw --no-renames` (v0.4) | Full reachable history — up to 10 000 commits, 120 000 file-change rows |
| Tarball `/repos/:owner/:repo/tarball` via Octokit + `tar` extraction | Source for file-import graph parsing (regex-based per language) |
| GitHub Trees API (`recursive=true`) | Full file list for dep-health manifest discovery (v0.9) |
| Per-ecosystem registries (v0.9) | npm: registry.npmjs.org, Cargo: crates.io, PyPI: pypi.org |
| OSV.dev `/v1/querybatch` | CVE data per (package, version) across all ecosystems |
| Derived | Hotspots, co-change edges, commit activity, FileGraph, 17 deterministic health signals |

Caps: top 120 hotspots, top 150 co-change edges, `fileGraph` at ≤3 000 files, PR fetch 2 pages, dep-health 50 manifests × 300 unique packages per ecosystem.

Graceful fallback: if `git` isn't on PATH, REST-only path (80-commit sample). If no manifest for a given ecosystem, that plugin silently skips.

### Key design decisions we made

1. **File storage over database.** `.gitvision/sessions/<id>.json` is inspectable, gitignored, portable.
2. **React Flow for every canvas.** Drag/zoom/pan/minimap for free.
3. **Shelf packing for Canvas**, **brick-stagger layered layout for Dep Canvas.**
4. **Folder frames as React Flow nodes** (not overlays) — same coord space as cards.
5. **No blur filters on cards** — killed perf at 120 nodes.
6. **`useDeferredValue` for sliders and filter inputs.**
7. **Defensive fallbacks for old snapshots.** Every new field is optional; read-side helpers normalize legacy shapes.
8. **Ambiguous basename disambiguation** (`next/package.json` rendering).
9. **Server-side `git log --raw` (not `--numstat`).** No blob fetches needed on a blobless clone.
10. **Dep Canvas filters over aggregation.** User validated path-filter + hide-orphans is the right scale strategy.
11. **Client-side layout recompute.** Layout algorithm changes apply to old snapshots without a refresh.
12. **Plugin architecture for dep-health (v0.9).** Adding Cargo / PyPI / future Go-Maven-NuGet is one file. Signals, UI, storage never touched for a new language.
13. **Bot-author filtering** in PR throughput + cycle-time signals. Dependabot/Renovate/release-bot PRs distort human-review metrics; matched by a curated regex list.
14. **Forced dark theme** (v0.7). Removed system-preference conditional — fixes a whole class of "class doesn't apply" bugs and matches Linear's aesthetic. CSS vars + `color-scheme: dark`.
15. **lucide-react for all icons.** Consistent sizing (12-14px), tree-shaken, matches the Linear look. No emoji in UI chrome.
16. **Hybrid rule-based signals + Claude narrative.** Every AI claim is grounded in a computed signal. Zero hallucination room.

### Big-repo limits (the next architectural challenge)

We hit Railway's request timeout on golang/go (~5,000+ Go files). The
debug endpoint succeeds in ~50s but the full session-creation pipeline
exceeds Railway's ~60s budget because it does substantially more work
(git history, dep-health, the codeAnalysis pipeline, etc. all in series
+ parallel).

**v0.19 graceful degradation** (shipped):
- codeAnalysis is wrapped in a 25s timeout. When exceeded, the snapshot
  saves WITHOUT codeGraph but with a `codeGraphSkipReason` string. The
  Code tab shows an explicit "skipped: timeout" empty state instead of
  the generic pre-v0.10 message.
- Frontend surfaces the actual server error (Railway's 502, our
  internal errors, etc.) instead of "Something went wrong".

**Long-term plan** — primary use-case for GitVision is *exactly* the
big repos (golang/go, kubernetes, microsoft/typescript), so the timeout
guard is a stopgap. Real fix is moving codeAnalysis off the request
path:

1. **Job queue + polling.** POST /api/sessions returns immediately with
   a job_id. The full analysis runs in a background worker (separate
   Railway service or in-process). Frontend polls /api/jobs/:id for
   completion. No request timeouts because the response is "accepted",
   not the analysis result.
2. **Streaming progress.** SSE or chunked response from the analysis
   endpoint, sending stage updates ("Parsed 1,000 files...") to keep
   the connection warm and the user informed. Doesn't unlock unlimited
   time but probably 5× more headroom.
3. **Subset analysis.** For monorepos, let the user pick a subdirectory
   (`golang/go/src/cmd` instead of the whole thing). Could be a UI
   choice or auto-detected from go.work / pnpm-workspace.yaml.
4. **Higher MAX_FILES + lazy parsing.** Currently we eagerly parse
   every file we walk. Could delay parsing until Code tab actually
   queries the file. Solves memory + time at once.

The right path is probably (1) — it cleanly unblocks any-size repos.
Estimated 1-2 weeks to retrofit. Not blocking anything else right now.

### Known trade-offs and limits

- **Dep-graph is always HEAD-time.** Imports parsed from latest tarball; no time-travel.
- **Contributors capped at 100** by GitHub API.
- **PR review stages not tracked** — sankey is Opened → Outcome → duration.
- **Linux-kernel-sized repos won't fit** — 10k commit / 120k file-change caps protect the server.
- **Monorepo hotspots still dominated by version-bump files.** Metadata-dominance signal flags it; the `hide-metadata` canvas toggle masks it in the visual.
- **7 of 8 languages on AST + parseDirect with Phase 5 type-aware** (JS/TS, Python, Go, Java, C#, PHP, Ruby — see migration history v0.10 / v0.12 / v0.13 / v0.14 / v0.21 / v0.22 / v0.23). Only Kotlin remains on regex-fallback (`tree-sitter-wasms@0.1.13`'s Kotlin grammar is ABI-incompatible with `web-tree-sitter@0.26.8`; the maintained alternative ships only `.c` source — needs Emscripten setup we haven't tackled yet).
- **Dep-health ecosystem coverage:** npm / Cargo / PyPI only as of v0.9. Go / Maven / NuGet / etc. are plugin-additions (one file each) — not architectural work.
- **React Flow console warning** about fresh `nodeTypes` object refs — harmless but noisy.

### Testing

Vitest-based unit tests (added v0.8 as part of the "eat our own dog food" action; substantially expanded in v0.10 alongside Tier 2 foundation):

```
lib/__tests__/
├── github.test.ts          parseRepoUrl, computeHotspots, computeCoChange,
│                           computeCommitActivity (15 tests)
├── depsHealth.test.ts      npm normalizeVersion (8 tests)
├── cargo.test.ts           Cargo normalizer + parseManifest variants (17 tests)
├── pypi.test.ts            PyPI normalizer + requirements.txt + pyproject.toml
│                           (PEP 621 / Poetry / Flit dialects) (18 tests)
├── signals.test.ts         Detector behavior with mock snapshots (27 tests)
├── codeAnalysis.test.ts    Runtime, plugin contract, queries, parser
│                           extraction, JS/TS resolver across all the
│                           bug fixes, vendored/minified filter (44 tests)
├── tsconfig.test.ts        Tsconfig path-mapping reader: JSONC tolerance,
│                           wildcard substitution, baseUrl handling (12 tests)
├── workspaces.test.ts      Workspace package discovery: Yarn/npm forms,
│                           pnpm fallback, source-entry probing (9 tests)
├── codeGraph.test.ts       Cross-file aggregator: function index, call
│                           disambiguation, import dedup, byPlugin (10 tests)
└── regexFallback.test.ts   extractImportsFromSourceFiles + plugin wiring
                            for Java/Python/Go (9 tests)
```

**501 tests total, all passing.** Run with `npm test` (watch) or `npm run test:run` (CI).

Test-count history:
- v0.17 added 12 in `codeAnalysis.test.ts` for TS/JS type-aware (class fields, constructor parameter properties, method params, typed locals, `new Foo()` inference, generic stripping, `this.method()`, multi-field disambiguation, JS-bare-calls-stay-undefined behavior, arrow-functions-as-named).
- v0.18 added 10 in `python.test.ts` for Python type-aware (containerType, self.method() resolution, PEP 526 fields, typed params, typed locals, `x = SomeClass()` constructor inference, generic stripping for both `subscript` and `generic_type` shapes, untyped fallthrough, multi-field disambiguation, __init__ self.X = typed-param patterns).
- v0.20 added 10 in `blastRadius.test.ts` for function-level blast radius (callers, callees, transitive hops, module-scope skip, unresolved skip, same-name disambiguation across files, function-level cycles, maxHops cap, maxNodes cap with "functions" unit message).
- v0.21 added 24 in `csharp.test.ts` + 2 in `codeGraph.test.ts` for `pickCallTarget` strict-typing semantics (typed receiver that doesn't match → unresolved, not silently fallthrough).
- v0.22 added 25 in `php.test.ts`.
- v0.23 added 24 in `ruby.test.ts` + 3 in `codeGraph.test.ts` for the `hasReceiver` contract (receiver-having calls without resolved type refuse single-candidate-match).
- v0.24 added 17 in `subdir.test.ts` covering `validateSubdir` (path-traversal rejection, length cap, leading-slash strip) and `parseDeepLinkSubdir` (multi-segment / single-segment / non-github URLs / branch-with-slash heuristic limitation).
- v0.25 added 20 in `jobs.test.ts` covering filesystem CRUD, atomic-write contract, `processJob` idempotency across all four states, `recoverOrphanedJobs` on cold start + mixed states + corrupted files.
- v0.26 added tests in `ownerId.test.ts` covering UUID minting, persistence across restarts, header attachment + filtering semantics.
- v0.27 added tests in `refreshHeadline.test.ts` covering `pickHeadline` priority logic (complexity-shift > new functions > author shift > issues > commits) and the diff-fixture for hotspot rank changes.
- v0.28 added tests in `blastRadius.test.ts` for (file, name, containerType) tuple targeting — Blueprint.__init__ vs BlueprintSetupState.__init__ stay distinct.
- v0.29 added tests in `testCoverage.test.ts` covering prod-vs-test classification by path heuristics (including paths only present in `cg.calls` not `cg.functions`), coverage walk via call edges, untestedHotspots ranking, percent-covered totals.
- v0.30 added 28 tests in `duplicates.test.ts` covering FNV-1a basics (5), `hashSubtree` end-to-end with real JS parsing including invariance under identifier rename + literal substitution + sensitivity to operator differences (8), `findDuplicateGroups` filtering + sorting + capping (12), `summarizeDuplicates` totals (3).

Tests have caught real bugs at every stage: v0.8 found `lib/` incorrectly in `OUTPUT_LIKE_FOLDERS`; v0.10 caught query-syntax issues and the `../../` trailing-slash edge case before they shipped to production.

---

## Tech stack reminders

- **Next.js 16 (App Router).** Breaking changes from earlier majors — check `node_modules/next/dist/docs/01-app/` before assuming old patterns work.
  - Dev uses Turbopack (default in v16). **Production build uses webpack** (`next build --webpack`) — Turbopack chokes on Emscripten-style WASM packages like web-tree-sitter. See `next.config.ts` for `serverExternalPackages` + `outputFileTracingIncludes` config.
- **React 19** + TypeScript 5.
- **Tailwind CSS v4** — arbitrary values (`bg-[#...]`) sometimes behave oddly when imported from `"use client"` components. Canvas and dep-health UI use inline `style={}` with TOK tokens for reliability.
- **@xyflow/react (React Flow 12).** CSS imported in `app/globals.css` (NOT inside components — caused silent render failures).
- **D3 v7** — treemap, color scales, hierarchy. `d3-sankey` for PR flow.
- **`@iarna/toml`** — TOML parser used by Cargo + PyPI plugins.
- **`tar` npm package** — for tarball extraction in `lib/graph.ts`.
- **`web-tree-sitter` + `@vscode/tree-sitter-wasm`** (v0.10) — AST parsing for the `codeAnalysis` pipeline. WASM-only so it works identically on Mac, Linux/Railway, Windows, and a future Tauri build. Path resolution uses `process.cwd() + "node_modules/..."` to dodge bundler externalization quirks.
- **Server-side `git` binary** — required on PATH for full history; falls back to REST sample if missing.
- **`@anthropic-ai/sdk`** — Claude Sonnet 4.5 for AI summary + health narrative. Optional.
- **`lucide-react`** — icons.
- **`tsx`** — ESM-native TS runner for the dev CLI (`npm run analyze`).
- **`vitest`** — unit tests (dev dep).

---

## License

**PolyForm Noncommercial License 1.0.0** (changed from MIT in v0.9 to prevent commercial forks).

- Personal use, learning, hobby projects, research, nonprofits → free.
- Commercial/for-profit use → separate license required.

---

## Live deployment

Production deploy on Railway (single service + persistent volume at `/data`):
- URL set via Railway-generated subdomain
- `GITVISION_DATA_DIR=/data` env var for persistent session storage
- `GITHUB_TOKEN` + `ANTHROPIC_API_KEY` set as env vars in Railway UI
- Auto-deploys from `main` branch on every push

---

## The next-steps menu

Ranked "bang per buck". ✅ = shipped.

### Shipped
- ✅ Session 2 (v0.3-v0.5): Canvas hero, Dep-graph tab, PR sankey, share cards, contributor Wrapped, full-history git-log, AI summary
- ✅ v0.6 — Health Check (rule-based signals + Claude narrative, hybrid architecture)
- ✅ v0.7 — Linear-lighter UI rework (forced dark theme, TOK tokens, lucide icons, all components restyled)
- ✅ v0.8 — Dep-health v1 (npm only, monorepo-aware), LICENSE, vitest + 50 tests
- ✅ v0.9 — Plugin architecture + Cargo + PyPI + dedicated Packages panel (+ tab rename "Dependencies" → "Imports")
- ✅ v0.10 — Tier 2 foundation (Phases 1-3): tree-sitter for JS/TS via WASM, regex-fallback wrapper for the other 7 languages, unified `CodeGraph` aggregator, debug API + dev CLI for live testing.
- ✅ v0.11 — Tier 2 complete (Phases 4a-b): `codeGraph` lifted onto `AnalysisSnapshot` via shared tarball-extract with `FileGraph` (Phase 4a). Code tab with Blast Radius UI: heaviest-file default, incoming/outgoing hop lists, twin lists for navigation, honest coverage chip (Phase 4b).
- ✅ v0.12 — Python migrated to its own tree-sitter plugin. Live impact on django/django: 0 → **31,894 functions, 183,798 calls** with full per-function complexity. Top-complex surfaces real Django hotspots like `_alter_field @ 91` (schema migrations) and `__new__ @ 62` (model metaclass).
- ✅ v0.13 — Go migrated to its own tree-sitter plugin. `prepareForRepo` reads `go.mod` for module-prefix-aware import resolution, with a suffix-match heuristic as fallback. Live impact across four repos: gin (1,311 fns), cobra (589), testify (1,519), terraform (16,930). Top-complex surfaces gin's radix-tree router internals, cobra's shell completion, testify's `compare`, terraform's `backendFromConfig`.
- ✅ v0.14 — Java migrated to its own tree-sitter plugin. `prepareForRepo` regex-scans `package` declarations across the FileIndex to build FQN→path + package→members maps; resolver tries direct FQN then falls back to package lookup (which catches wildcard imports). Live impact: spring-petclinic (165 fns), spring-boot (30,116 fns at the 5,000-file cap), guava (56,485), jenkins (19,895). Captures method + constructor invocations + `new Foo<>()` object creation as call sites.
- ✅ v0.15 — **Phase 5a: type-aware call resolution for Java.** `ParsedFunction.containerType` + `ParsedCall.calleeType` (both optional) added to the plugin contract. The Java plugin switched to parseDirect + manual AST walk that tracks class field types, method parameter types, and local variable declarations in scope; resolves the receiver's type on every `obj.method()` call. `codeGraph.pickCallTarget` now uses calleeType + containerType as the primary disambiguator BEFORE falling back to same-file/imported-files. Live impact on the school Spring Boot project (RaceKatteKlubben): the 8 unresolved `validate()` calls dropped to 0; resolvedCalls 198→208. The unresolved list is now exclusively stdlib + Spring (JDBC ResultSet, Model, etc.) — no internal names left.
- ✅ v0.16 — **Phase 5b: type-aware call resolution for Go.** Two-pass parseDirect: pass 1 collects every struct's `field_declaration_list` into a `structName → { fieldName → typeName }` table; pass 2 walks methods tracking receiver type (with `*Service` → `Service` pointer-stripping), parameter types, `var x Type` declarations, and `x := T{}` / `x := &T{}` composite literals. Receiver-types resolve `s.field.method()` chains via the struct field table.
- ✅ v0.17 — **Phase 5c: type-aware call resolution for TypeScript** (and its JS-family siblings, where containerType still applies). javascriptPlugin switched to parseDirect with manual AST walk: tracks `public_field_definition` types, constructor parameter properties (TS shorthand: `constructor(private x: Foo)` creates an implicit `this.x: Foo`), method parameter types via `required_parameter`, typed local `const x: Foo = ...`, and `new Foo()` initializer inference for untyped const declarations. Critical JS-vs-Java/Go difference handled: bare calls inside JS methods do NOT get implicit-this, because that's not how JS works.
- ✅ v0.18 — **Phase 5d: type-aware call resolution for Python.** parseDirect walks class bodies for PEP-526 annotated attributes (`name: Type`), `__init__` self.X assignments (when the source param has a type hint, the field inherits it), function parameter type hints (`def f(x: Foo)`), and typed local assignments (`x: Foo = ...`). Class instantiation patterns like `x = Widget()` are recognized as constructor calls and the variable gets the class type. self/cls in class methods automatically resolve to the enclosing class. Untyped Python falls back to name-match gracefully.

**Phase 5 is complete across all 7 AST-supported languages** (JS/TS, Python, Go, Java, C#, PHP, Ruby). Statically-typed languages do deterministic type-aware call resolution; dynamically-typed languages (Ruby, parts of Python/PHP) fall back gracefully to proximity heuristics. The plugin contract has held up cleanly across very different type systems.

- ✅ v0.20 — **Function-level blast radius + curated demo row.** `computeFunctionBlastRadius(cg, file, fnName)` shares the BFS engine with the file-level version but uses CallEdge endpoints (fromFile, fromFunction) → (toFile, toFunction); module-scope and unresolved calls are skipped. UI: clicking a function chip in the SelectedFileHeader OR an item in TopFunctionsList zooms into function mode, "back to file" button restores file mode. BlastSection refactored to a generic two-line entry shape so file mode shows just the path and function mode shows function name + muted file path underneath. Landing page demo row replaced with a curated 4-pick set spanning each AST plugin (zod TS, gin Go, flask Python, spring-petclinic Java) with muted language labels.
- ✅ v0.21 — **C# tree-sitter migration + chip multi-plugin + pickCallTarget strict-typing.** First Phase-1 migration. Live-validated on serilog/serilog: 145 false-positive resolutions eliminated by the strict-typing fix (typed receivers that don't match any candidate's containerType refuse to silently fallthrough to single-candidate-match). CoverageChip generalized to sum across every AST plugin (was hardcoded to read javascript-only stats — gave "0 call-sites" on a 100% C# repo).
- ✅ v0.22 — **PHP tree-sitter migration.** Property + parameter type tracking (PHP 7+), constructor parameter promotion (PHP 8+), `else_if_clause` as its own decision-point node. Live-validated on Seldaek/monolog.
- ✅ v0.23 — **Ruby tree-sitter migration + `hasReceiver` contract for dynamic langs.** First fully-dynamic language. Phase 5 type-aware works only via constructor-initializer inference (`x = SomeClass.new`, `@x = SomeClass.new`). `Klass.new` is rewritten to `initialize` for constructor matching. New `ParsedCall.hasReceiver?: boolean` lets `pickCallTarget` refuse single-candidate-match when receiver was present but type unknown — cut 76 spurious lib→spec edges in rspec-core to 3 (97% reduction).
- ✅ v0.24 — **Subset analysis.** `downloadAndExtract` filter callback keeps only entries inside the subdir + a curated list of root-level manifest files. `validateSubdir` + `SubdirNotFoundError` for clean error handling. UI: collapsed disclosure with auto-fill from `https://github.com/owner/repo/tree/branch/path` deep-links. Live: golang/go src/cmd → 1909 files, 22,041 functions, 203,558 call-sites (previously hit 25s codeAnalysis timeout).
- ✅ v0.25 — **Job queue + async (Phase 2 complete).** `POST /api/sessions` enqueues a job via Next.js's `after()` hook and returns `{ jobId }` in <1s; the analysis runs detached from the HTTP request. Frontend polls `GET /api/jobs/:id` every 2s until terminal state. File-based job storage with atomic writes (temp+rename), survives Railway redeploys. Orphan-recovery sweep on first request after a fresh server boot. Same flow used by Refresh.
- ✅ v0.26 — **Anonymous owner-id session isolation (Phase 3 step 1).** UUID written to localStorage on first visit, attached to every session-create + list call as `X-Owner-Id` header. Landing page filters its session list to "yours" — no "47 random people's sessions" first-impression on a public deploy. NOT OAuth: no sign-up flow, no server-side identity, no PII. Backward-compat: pre-v0.26 sessions stay accessible by direct URL but don't show on someone else's landing page.
- ✅ v0.27 — **Refresh-banner narrative.** Replaces metadata-diff banner ("3 commits, 2 stars") with story-driven framing. `pickHeadline` priority logic surfaces the most-interesting change per snapshot (code complexity grew/shrank, new functions added, big author shift, issues closed). Primary/secondary chip emphasis in green/orange. Brand line "GitVision · owner/repo" in textSecondary. Time on right as "1d ago" not "earlier" or "since". Screenshot-worthy alone (Guiding-Principle 2). Live-validated on golang/go: `Code complexity grew by 45 — new branching logic added across the codebase`.
- ✅ v0.28 — **CallEdge.toContainerType — overload disambiguation in blast radius.** Resolved the v0.20 chip-dedup workaround (commit `2d4fede`). Plugins now emit `CallEdge.toContainerType` alongside `toFunction`; `computeFunctionBlastRadius` uses (file, name, containerType) as its target tuple. Live-validated on Flask: `Blueprint.add_url_rule` (3 callees) vs `BlueprintSetupState.add_url_rule` (0 callees) prove distinct overloads now produce distinct blast radii. Chip dedup logic deleted.
- ✅ v0.29 — **Test-to-code mapping — coverage badges + Untested Hotspots panel.** `computeTestCoverage(cg)` classifies every function path/file into prod or test by convention heuristics (no external coverage data: looks at `__tests__/`, `*.test.*`, `*.spec.*`, `tests/`, `_test.go`, `_spec.rb`, etc.). Walks call edges to mark prod functions called by test files as "covered". UI: per-file coverage badge ("5/8" with color scaling 0% rose → 50% amber → 100% accent) on the heaviest-files list. Untested Hotspots panel: most-complex prod functions with zero test callers, ranked, click to zoom blast radius. Header stat: "X% prod fns covered". Panel hidden on repos with zero test files (no false-positive lecture).
- ✅ v0.30 — **AST duplicate detection — bodyHash + Near-Duplicates panel (Phase 3 complete).** FNV-1a 64-bit hash over each function's tree-sitter subtree, walking named children + capturing binary/assignment/unary operator tokens but ignoring identifier names + literal values. All 7 AST plugins emit `bodyHash` per function. `findDuplicateGroups` filters by complexity ≥5, group size ≥2, sorts by `groupSize × maxComplexity` descending, caps at 15. Near-Duplicates panel: collapsible group rows, top group expanded by default, members clickable to zoom blast radius into that exact (file, name, containerType) copy. Live-validated on golang/go src/cmd: 15 groups · 118 functions · largest ×36. Caught canonical SSA-rewrite families: `OpAdd16/32/64/8` (×4 at complexity 176), `OpLsh<size>x<size>` (×36 across 4×4 grid + signed variants), ARM register-shift opcodes (×36). Hash invariance under literal/identifier changes proven: `OpAdd8` and `OpAdd64` share a hash despite different opcodes/literals, identical structure.

### Next up — post-Phase 3 menu

See the "Strategy & current focus" section near the top for context: Phase 1 + 2 + 3 are all shipped, launch readiness is now a genuine decision point. Candidates:

- **Public launch.** Landing copy, public-beta framing, feedback channel, analytics tagging. Anonymous owner-id (v0.26) makes the first-impression UX safe; the three insight panels (refresh banner, untested hotspots, near-duplicates) make the value proposition obvious in screenshot form. Lowest implementation cost, highest signal — real users will tell us where the next effort should go.
- **Phase 4: deeper insights.** Candidates: PR-level blast radius ("this PR touches X functions with Y callers"), trends-over-time (complexity graph across snapshots), cross-repo comparison (analyze two repos side-by-side), conversational codebase ("chat with your repo").
- **UX polish-pass.** Surface the 15-group cap on the duplicates panel ("showing top 15 of N total"), filter toggles for cross-file vs same-file duplicate groups, sort-by toggle (score / size / complexity).
- **More dep-health ecosystems.** Go modules, Maven, NuGet, RubyGems, Composer — each ~1 evening, plugin-pattern.

⚠️ **Kotlin migration: still blocked.** Attempted in v0.20 — `tree-sitter-wasms@0.1.13`'s Kotlin grammar fails ABI compatibility with `web-tree-sitter@0.26.8` (`failIf` at `getDylinkMetadata`). The maintained alternative `@tree-sitter-grammars/tree-sitter-kotlin@1.1.0` ships only `.c` source — building WASM ourselves needs Emscripten setup. Kotlin stays on regex-fallback until a compatible WASM grammar appears upstream.

### Dep-health follow-ups (small, anytime)

Each is ~1 evening of work, no blocking:

- Go modules plugin (`go.mod` + `proxy.golang.org`)
- Maven plugin (`pom.xml` + Maven Central) — Java
- NuGet plugin (`*.csproj` + `nuget.org`) — C#
- Gradle plugin — harder, Java/Kotlin DSL parsing
- Conan + vcpkg plugins — C/C++ (for projects that use a package manager)
- RubyGems, Composer (PHP), pub (Dart/Flutter) — quick additions

### Other polish candidates

- Rate-limit friendly error states
- Empty states polish (fresh session, no data)
- Memoize `nodeTypes` (silence React Flow console warning)
- Auto-upgrade old snapshots on first view (currently user must click Refresh)
- Landing-page hero illustration (demo-repo row landed in v0.20)
- Per-contributor "Wrapped"-style achievements — extended cards
- *(Done in v0.10 for JS/TS via tree-sitter; Java + the other 5 languages are one-file plugin migrations whenever we want them.)*

### Big swings (non-blocking, for when core features settle)

- Tauri desktop app (see section below)
- Multi-user + real DB (only if going public)
- Conversational codebase ("chat with your repo")
- Predictive health (learn from 10k+ repos)
- Temporal knowledge graph — "why did we switch to Redux here?"

---

## Tauri port — the plan

### Why still deferred

Wrapping doesn't fix render perf — both Tauri and Electron use a webview. Iteration is still 10× faster on localhost than in a packaged webview. We port when the web version is ~90% of what we want feature-wise.

### When to pull the trigger

Any of:
- Want a downloadable `.app` / `.exe` to share
- Want to analyze user's **local** repos (not GitHub-hosted ones)
- Core features done and iteration is now polish-only

### The migration work (estimate: 2-3 hours)

1. `npm create tauri-app` inside existing project
2. Next.js static export (`output: "export"`)
3. Rewrite `app/api/*` — either Tauri commands in Rust, or direct-from-client GitHub API calls
4. Replace `lib/storage.ts` fs calls with Tauri's `@tauri-apps/api/fs`
5. Mac build + Windows cross-compile

Full-history analysis already works server-side in Node (v0.4) — Tauri port no longer needs Rust for that.

---

## Running locally on a fresh machine

```bash
git clone https://github.com/coffeejones/gitvision
cd gitvision
npm install
cp .env.example .env.local
# paste your GitHub token + optional Anthropic key into .env.local
npm run dev
```

**Node version required:** 20.9+ (tested on 25.x).

Run tests: `npm test` (watch) or `npm run test:run` (single pass).

Sessions stored in `.gitvision/sessions/` — not committed, machine-local.

---

## Security / credentials note

- `.env.local` is gitignored. Your `GITHUB_TOKEN` and `ANTHROPIC_API_KEY` stay local.
- **Minimum scope tokens only** — read-only `public_repo` is plenty.
- If a token ever leaks (chat, screen-share, commit message), **rotate it immediately** at the issuer's UI.

---

## Open questions / future thinking

- **Where does GitVision live long-term?** Self-hosted open-source core + commercial hosted? Pure personal tool that happens to be public? Both are valid — decide when a real user base tells us.
- **When do we add auth/multi-user?** Currently single-user architecture. A multi-tenant move requires rethinking storage, session ownership, rate-limit pooling. Non-trivial but not urgent.
- **Brand direction.** GitVision name is fine. No logo/wordmark yet — low priority until we have a reason.

---

*Last updated: end of session 8 (Phase 1 + Phase 2 + Phase 3 complete). Five releases shipped in this session-cluster: v0.26 anonymous owner-id session isolation, v0.27 refresh-banner narrative ("Code complexity grew by 45 — new branching logic added across the codebase"), v0.28 CallEdge.toContainerType for overload disambiguation in blast radius, v0.29 test-to-code mapping with coverage badges + Untested Hotspots panel, v0.30 AST duplicate detection with bodyHash + Near-Duplicates panel. The Code tab now ships three actionable insight surfaces beyond the blast-radius hero: untested hotspots ("most complex functions with no test caller"), per-file coverage badges, and near-duplicates ("structurally identical bodies — candidates for extraction"). Live-validated v0.30 on golang/go src/cmd: 15 groups, 118 functions, largest ×36, caught the canonical SSA-rewrite families. Test-count history: 393 (end of session 7) → 501 (end of session 8). Launch readiness is now a genuine decision point — the core product has the depth, scaling, safety, and screenshot-worthy panels for a public soft-launch. Post-Phase 3 menu: public launch / Phase 4 deeper insights / UX polish-pass / more dep-health ecosystems.*
