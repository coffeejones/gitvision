# CodeTrawl Roadmap — H2 2026

*Written 2026-07-06 from a web-grounded market research pass (4 research lenses,
mid-2026 sources) + strategic synthesis, stress-tested against the existing
codebase. Planning session on Fable 5; implementation sessions on Opus.
Companion to PROGRESS.md — this is the WHERE-WE'RE-GOING doc; PROGRESS.md
remains the WHERE-WE-ARE doc.*

---

## The market read (mid-2026)

The market flipped exactly toward CodeTrawl's architecture:

- **Generation is solved; verification and comprehension are the bottleneck.**
  Sonar: 96% of devs don't fully trust AI code, 38% find reviewing it harder
  than human code. DORA 2025: AI adoption still correlates negatively with
  delivery stability absent "control systems". GitClear commit telemetry:
  duplication +81% vs 2023 while refactoring collapsed to ~3.8% of changes.
  The named pains — *comprehension debt* (coined spring 2026), review-burden
  asymmetry ("AI slop"), architectural drift, false-confidence test suites —
  map one-to-one onto signals CodeTrawl already computes deterministically.
- **The low end of code intelligence was structurally vacated.** Sourcegraph
  killed Cody Free/Pro (enterprise-only, ~$16k floor). CodeSee was sunset.
  CodeScene bills per active author — it literally cannot price "a repo I
  don't commit to". The funded money ($420M ARR segment) crowded onto the
  post-hoc PR diff (CodeRabbit, Greptile, Qodo, Ellipsis), per-seat, mid
  trust-crisis (only ~3% of engineers say they trust AI review output).
  Free anchors took "repo summaries" (DeepWiki) and "raw graph over MCP"
  (27k-star OSS servers).
- **The open slot is precisely CodeTrawl's shape**: session-based, pre-change,
  evidence-grounded, flat-priced. Two honest caveats: (1) nobody knows
  CodeTrawl exists yet — distribution is part of every arc, not an
  afterthought; (2) the realistic threat is not a better product but Greptile
  bolting a repo dashboard onto its internal graph, or a hobby MCP server
  maturing into the pre-flight niche. The window is open now.
- **Security/regulatory tailwind with a hard date**: the EU CRA
  vulnerability-reporting duty starts **2026-09-11** (full SBOM/documentation
  compliance 2027-12-11). Supply-chain attacks run ~monthly (chalk/debug,
  Shai-Hulud family, tj-actions CVE-2025-30066, …) with stolen secrets as the
  near-universal payload. Buyers and acquirers now demand *generated, dated
  evidence*, not assurances.

*(Source-confidence note: CRA dates, chalk/debug, Shai-Hulud, tj-actions
verified against independent knowledge. Vendor-sourced stats (GitClear,
Sonar, CodeRabbit) are directionally solid but verify exact numbers before
using them in marketing copy.)*

## Positioning

> **CodeTrawl is the evidence-grounded pre-change layer for AI-era codebases:
> know what's load-bearing, what a change will break, and what's drifting —
> every claim backed by a computed receipt, for humans and their agents.**

Own **one moment** (before the change) and **one property** (a computed
receipt behind every claim). Lead marketing with "know what breaks before you
touch it — with receipts"; keep "maximize your codebase" as the in-product
journey. Tier story: **Free = look. Plus = watch. Pro = prove.**

---

## Arc 1 — Refactor-Confidence Loop ("Can I touch this?")

**Why now:** refactoring is dying because nobody trusts their understanding of
blast radius (GitClear: 21% → 3.8%). Every input already shipped
(complexity, file+function blast, test-mapping v0.29, duplicate groups v0.30)
— this arc is *composition*, not construction, and it is the north-star
moment: from "analysis" to "now I can act".

| Feature | What | Effort |
|---|---|---|
| **Refactor-Safety Radar / Load-Bearing Walls** (one computation, two zooms) | Per file/function safety **tier** from blast reach × complexity × untested dependents × duplicate multiplier; repo-level "walls" index is the zoomed-out view. Every tier expands to its computed inputs — evidence-first, never a bare 0–100 score. | S–M (hard part: honest tier thresholds + evidence-primary UI) |
| **Impact-Ranked Test Prioritizer** | "Before touching X, run these tests" — walk test-mapping in reverse, rank test files by dependents guarded. Labeled explicitly as *static mapping*, not coverage truth. | S (hard part: copy discipline) |
| **Weak-Suite Signal** | Per test file: assertion density + smoke-only-oracle heuristics — flags "coverage that means nothing", the most deceptive metric in AI-heavy repos. Almost nobody surfaces this. JS/TS plugin first. | M (per-language assertion idioms) |
| **Safe-to-Delete candidates** | Zero-inbound exports + no dynamic-import markers + git age → "candidates for review", never "safe". Call-edge languages only. **Ships LAST** — highest trust-risk feature in the roadmap. | M |

- **Monetization:** Radar view free (the hook); Prioritizer, Weak-Suite,
  Delete-candidates in Plus.
- **Distribution beat:** the "load-bearing wall" card — one-image shareable
  verdict for famous OSS repos + Show HN: *"We measured the files nobody
  dares touch in 50 popular repos."*
- **Risks:** score fatigue (mitigate: named tiers + expandable evidence);
  weak-suite methodology will be publicly contested (publish the math,
  welcome the fight).

## Arc 2 — Agent Pre-Flight (ship the MCP server that already exists)

**Why now:** "productivity ceiling is set by context, not model quality"
(Sourcegraph, May 2026); agents miss cross-cutting effects. "Impact analysis
as pre-change agent context" is shipping only as buried tools in kitchen-sink
graph servers — nobody owns the category. MCP is the universal integration
surface (Copilot Extensions deprecated in its favor). **Decisive local fact:
`mcp/` is a BUILT 8-tool server** (blast_radius, analyze_diff,
compare_sessions, untested_hotspots, find_duplicates, review_changes,
signals, analyze_repo — with caching + tests). Remaining work is hosting,
limits, docs, distribution.

| Feature | What | Effort |
|---|---|---|
| **Public-repo MCP beta** | Host the existing server (remote MCP or npx stdio), keyless + rate-limited, docs page, install recipes for Claude Code + Cursor, MCP registry listings. | S (hosting decision + abuse control) |
| **Pre-flight recipe/skill** | Shipped AGENTS.md/CLAUDE.md snippet + skill that makes agents call `blast_radius` + `untested_hotspots` BEFORE editing. Instrument call-through rate. | S |
| **Token-budgeted output mode** | Rank + cap blast output aider-style so results fit agent context windows without losing the riskiest nodes. | S–M |
| **Private-repo MCP auth** | API keys on Plus/Pro, session-ownership checks. **Deferred until public beta proves call-through.** | M |

- **Monetization:** public free with rate limits (adoption engine); private +
  higher limits = Plus/Pro. Flat, never per-seat.
- **Distribution beat:** 60-second GIF of Claude Code calling `blast_radius`,
  discovering 43 dependents / 0 test callers, and visibly changing its plan.
- **Honesty caveat (v1):** sessions analyze repo-at-commit; agents edit
  working trees. Sell as *pre-planning context* ("before you decide what to
  touch"), not mid-edit truth. Mid-edit = Change Gate moonshot.
- **Anti-goal within the arc:** do NOT sell raw graph queries — the
  peer-reviewed benchmark shows raw-graph MCP *degrades* agent quality.
  CodeTrawl sells **verdicts, not queries**.

## Arc 3 — Temporal Intelligence: drift + regression (the Plus engine)

**Why now:** debt accumulates measurably within months; leaders' top worry is
"losing shared understanding of how the codebase evolves" (54%). Nobody else
has snapshot-diff as a first-class primitive — DeepWiki is days-stale, PR
bots see one diff at a time. verdictDelta, structuralDiff, and Watch plumbing
already exist. **Drift is the only arc no competitor can fast-follow — it
requires accumulated snapshots.**

| Feature | What | Effort |
|---|---|---|
| **Drift signal pack v1** | Persist per-snapshot metrics (duplication % from bodyHash, complexity, connectivity, prod-fn coverage %, assertion density); diff across snapshots into named trend signals. | M (rename-tracking is the credibility killer) |
| **Risk Drift Watch** | Blast-reach deltas on hotspots ("auth.ts blast grew 12 → 31 files since May 3") wired into Watch emails. | S–M (alert-worthiness thresholds) |
| **"Agent era" lookback report** | One-click 6-month story: duplication trend, hotspot churn, coverage trend, verdict trajectory. The report an eng lead circulates. | M |
| **README badge with trend arrow** | Grade + delta ("B+ ↘") as SVG — evergreen backlink exploiting the update angle. | S |

- **Monetization:** THE Plus engine — history, drift, Watch emails = Plus;
  free keeps the single "since last visit" teaser.
- **Distribution beat:** the drift card: *"90 days of AI-assisted coding:
  duplication +34%, refactoring −80%, 2 new load-bearing walls."*
- **Cold-start discipline:** start persisting drift metrics in the **Now**
  horizon even though the drift UI ships a quarter later; pre-bake drift
  stories on the curated demo repos so it never demos empty.

## Arc 4 — Evidence Desk: reports you can hand to someone

**Why now:** CRA reporting duty starts **2026-09-11**; its SBOM floor is
manifest-level — achievable from data CodeTrawl already parses across 6
ecosystems. Attacks run ~monthly; each one is a free, search-driven
distribution event. Secret + incident scanners already exist. CRA
self-assessment is consultancy-priced at €20–50k/product line — small teams
have obvious budget for a tool that generates part of the evidence.

| Feature | What | Effort |
|---|---|---|
| **CI-hardening signals** | Deterministic detectors: Actions pinned to SHA vs mutable tags, third-party action inventory, workflow permission scope — each narrated with the named, dated incident motivating it. | S |
| **Incident-exposure public page** | Template checking any session's dep tree against a curated compromised-package list, published within 24h of each named attack. | S–M (curation is an ops habit — commit to the cadence or don't ship) |
| **SBOM export** (CycloneDX/SPDX, 2025 CISA element set) | Per-snapshot, timestamped, downloadable. | M (purl/component identity + licenses across ecosystems) |
| **Evidence pack** | Timestamped zip/PDF: SBOM + dep-health + secret-hygiene + CI-hardening + re-sweep trail, with explicit scope statement ("manifest-based; ~16% of OSS enters off-manifest"). | M |

- **Monetization:** Pro's reason to exist. Basic exposure check free; SBOM,
  evidence pack, timestamped trail = Pro. Completes the tier story.
- **Distribution beat:** the next npm/PyPI headline attack → public "check
  your exposure to X" page live within 24h.
- **Legal discipline:** never say "CRA compliant" — always "evidence for
  your technical file".

## Arc 5 — Change-Time Blast: the diff, before it merges

**Why now:** change failure rate up ~30% since AI coding accelerated, yet the
entire $420M AI-review market is post-hoc, per-seat, and mid trust-crisis.
The pre-merge deterministic moment is commercially unoccupied. `analyze_diff`
exists as an MCP tool; `lib/githubApp/` has webhook/comment/guardrails/
runReview plumbing. **This arc deliberately ships LAST — it enters the one
funded, crowded segment, so CodeTrawl arrives with the temporal/session moat
already behind the link.**

| Feature | What | Effort |
|---|---|---|
| **In-app branch/PR blast preview** | Paste base..head or PR URL → changed symbols mapped to blast + risk tiers + tests-to-run + which load-bearing walls the diff touches. Session-shaped: works on repos you don't own, no CI install. | M (diff line-ranges → graph nodes on multi-commit PRs) |
| **Reviewer brief card** | One screenshotable verdict: "touches 2 load-bearing walls · 43 dependents · 0 of 5 mapped tests updated." Reviewer triages in 10 seconds. | S (restraint: evidence only, zero opinions) |
| **Deterministic PR comment (GitHub App)** | ONE comment per PR, only above a risk threshold, zero AI prose, free for public repos, linking to the public read-only session view. The anti-CodeRabbit: it never argues, it just shows the blast. **Gated on the in-app preview proving demand.** | M (ops/abuse at hobby velocity is the real cost) |

- **Monetization:** preview on own repos = Plus; GitHub App free for public
  repos (distribution), private = Pro. Never per-seat, never per-review-credit.
- **Distribution beat:** the comment IS the ad — every deterministic blast
  comment in a real OSS PR is a product demo to everyone watching that repo.
- **Comment etiquette is existential:** comment rarely; silence is a feature.

---

## Sequencing (solo, hobby velocity)

> **Status (2026-07-08):** Arc 1, Arc 2, and Arc 3 have all landed on
> `feat/codetrawl-landing` (adversarially reviewed). The "Now" and most of the
> "Next" horizons below are done in code; what remains is manual infra — MCP
> hosting / `npm publish` / registry listings, the demo re-sweep so drift +
> badges show on public demos, and the Show HN distribution beat. Next feature
> horizon is **Arc 4 (Evidence Desk / CRA)** and **Arc 1 Weak-Suite**.

### Now (~1 month) — harvest, not construction
1. **Arc 1:** Radar + Test Prioritizer composed into ONE "Can I touch this?"
   surface (evidence-expandable tiers, no bare scores) + the load-bearing-wall
   shareable card, pre-baked for demo repos.
2. **Arc 2:** MCP public-repo beta — hosting decision, rate limiting, docs
   page, registry listings, pre-flight recipe with call-through
   instrumentation.
3. **Arc 3 rider:** start persisting per-snapshot drift metrics NOW (the UI
   comes later; the data can't be backfilled).
4. Distribution: Show HN with the wall card + the agent GIF. (Block 3 from
   the previous push finally fires here, with much stronger material.)

*Rationale: both are finishing work on shipped assets; a month of composition
yields two distribution beats and plants the flag in the two unowned
positions (pre-change human surface + pre-change agent context).*

### Next (~quarter)
1. **Arc 3:** drift signal pack v1 + Risk Drift in Watch emails + drift card
   + README badge with trend arrow (the Plus engine).
2. **Arc 2:** private-repo MCP auth — ONLY if public-beta call-through data
   justifies it.
3. **Arc 4 rider:** CI-hardening signals (S) + incident-exposure page
   template ready to fire within 24h of the next named attack. CRA reporting
   start (2026-09-11) lands in this window as a free news hook.
4. **Arc 1:** Weak-Suite assertion-quality signal (JS/TS first).

### Later (~2–3 quarters)
1. **Arc 4:** SBOM export + Pro evidence pack (CRA pressure builds toward
   Dec 2027 — demand strengthens rather than expires).
2. **Arc 5:** in-app branch/PR blast preview + reviewer brief card; then the
   deterministic GitHub App comment only if preview proves demand.
3. **Arc 1:** Safe-to-Delete candidates (call-edge languages, "candidates
   for review" copy, ships last).

## Moonshots (name them, don't schedule them)

1. **The Change Gate — "terraform plan for code changes":** CI- and
   agent-callable gate: proposed diff in → SAFE / WATCH / BREAKING with
   evidence receipts. Requires local working-tree analysis (CLI/daemon
   running the tree-sitter pipeline offline) — the piece that turns CodeTrawl
   from a website into infrastructure.
2. **Architecture contracts + self-updating ADRs:** declare (or infer)
   intended boundaries; score every snapshot against the contract; open
   evidence-backed "your architecture drifted" alerts with the violating
   edges. Revisit once drift v1 has real users.
3. **The Comprehension-Debt Index:** quarterly public index, open
   reproducible methodology, top-1000 OSS repos — duplication, connectivity,
   assertion quality, bus factor. Every citation markets the product; the
   accumulated snapshot dataset becomes an asset nobody can copy without
   re-running years of history.

## Anti-goals (explicitly NOT building)

- **No generic AI PR reviewer** — crowded, trust-crisis, per-seat war.
- **No kitchen-sink MCP graph server** — raw graph-over-MCP is commodity and
  measurably degrades agent quality. Verdicts, not queries.
- **No vulnerability-depth race** with Snyk/Socket — integrate the category's
  outputs into the narrative; don't compete on their axis.
- **No "AI explains your repo"** positioning vs DeepWiki — win on grounded
  verdicts, freshness on demand, and diffs; never on prettier summaries.
- **No per-seat pricing, ever** — flat pricing for repos you don't commit to
  is the one structural wedge incumbents' billing cannot follow.
- **No IDE extension** — MCP already covers the in-editor moment.
- **No "CRA compliant" claims** — timestamped evidence with scope statements.
- **No ungrounded AI output anywhere** (incl. marketing/demos) — the
  zero-hallucination invariant is the single most marketable property in
  2026's hallucination-fatigued market; one violation spends it permanently.
- **No llms.txt bets**; one curated evidence-backed AGENTS.md section, stop.
- **No database / multi-tenant infra** until a real multi-user need exists.

## Key corrections from the strategy pass (vs. earlier internal ideation)

- Radar (#1) and Load-Bearing Walls (#7) are **the same computation at two
  zoom levels** — build once, two views; cheaper than estimated (S–M).
- Test Prioritizer copy must say **static test-mapping**, not coverage truth.
- The ideation list **missed Weak-Suite assertion-quality detection** — the
  sharpest unowned signal in the research; added to Arc 1.
- Safe-to-Delete is the **highest trust-risk item**; gate to call-edge
  languages, ship last, never say "safe" unqualified.
- "Continuous distribution artifacts" is **not an arc — it's a law**: every
  arc's definition-of-done includes its shareable artifact.
- The earlier plan **ignored the security/evidence opportunity** despite the
  scanners already existing and the CRA's hard date; added as Arc 4.
- MCP arc must sell **ranked verdicts** (blast tiers, tests-to-run,
  since-last delta), not raw graph access; and v1 is pre-planning context,
  not mid-edit truth.
- PR bot is **not the natural next step** even though the plumbing exists —
  in-app preview first, bot only on proven demand, ONE deterministic
  comment, zero AI prose.
