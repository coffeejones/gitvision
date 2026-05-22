# Product scope & sequence — May 2026

_Captured during a strategic working session on 2026-05-10/11. This is
the explicit "what we're building, and in what order" decision. It will
go stale — update it when the plan changes, don't retroactively edit it
to look right._

## The vision (the destination, not v1)

RepoBaron is **the codebase intelligence layer for teams where AI
generates code at scale.** Three properties together that no current
competitor offers:

1. **Workspace surface** — always-open analysis dashboard with GitHub
   development view, codebase understanding, diagrams, cohesion view,
   improvement areas. The dev's "second monitor" tool.
2. **PR-bot wedge** — native GitHub App that comments on PRs with
   evidence-grounded signals. Distribution channel + revenue motion.
3. **AI-aware positioning** — explicitly tuned for the workflow where
   AI generates code at scale. Pre-PR self-review ("check this before
   you open it"), duplicate-utility detection, convention drift, blast
   radius vs. existing call graph.

Long-term narrative for external audiences:

> *"RepoBaron is the codebase intelligence layer for teams where AI
> generates code at scale. Before you open a PR: we tell you what your
> AI-generated change collides with. After PR opens: we show reviewers
> the structural facts AI PR-bots miss. We're not another LLM-on-diff
> — we're the deterministic-signals layer that makes AI-augmented
> development reviewable."*

## What we explicitly are NOT doing in v1

- **Pure real-time pub/sub** — webhooks + websocket push for every
  event is 3-5x infrastructure complexity. Out of v1 scope.
- **Tauri desktop app** — wait for data showing workspace adoption
  warrants it. Web first.
- **IDE plugins** — MCP via Claude Code/Cursor covers the integration
  story without per-platform plugin maintenance.
- **30+ language coverage** — keep our 8-language plugin architecture
  as differentiator-by-quality, not differentiator-by-breadth.
- **Marketing-style ROI claims** — eval data demonstrates analysis
  quality lift, not dollar value. Don't overclaim.

## The sequence (this is the plan)

### v1 — months 1-5 (ship-bar)

**Primary surfaces:**
- **GitHub App** (PR-bot) for distribution + revenue motion
- **repobaron.com workspace** (existing, polished) for deep-dive +
  cross-PR view
- Both surfaces share the same signals-pipeline

**Operating model:**
- Snapshot-based with manual refresh on workspace
- "Feels live" via smart caching + ~30s auto-poll on active tab +
  `last updated` timestamp
- GitHub App triggers analysis on PR open / sync events
- No webhooks-to-client push yet

**What we polish to ship-bar:**
- PR comment format (single primary anchor — see open question #3)
- Signal quality across all 8 languages (eval-driven)
- repobaron.com auth + per-user state
- Pricing + plan structure (see open question #2)
- License decision (PolyForm vs. open-core — see open question #1)

### v2 — months 6-9

- **Pre-PR self-review flow** — "Review before submit" UX in the
  workspace; uses the same signals to give the dev an honest read
  before they open the PR
- **Cross-PR trend analytics** — which contributors keep landing in
  hotspots, which files take the most damage, etc.
- **GitHub webhooks → background incremental analysis** — refresh
  happens automatically; user sees fresh data next time they open
  the tab. Not yet websocket push to active tabs.

### v3 — months 10-15

- **Chrome extension** as bridge between PR-bot and workspace
- **Workflow actions** in the workspace (notes, ignore, tag, share,
  refactor planning)
- **WebSocket push** for genuine real-time updates to active tabs
- **Tauri desktop** — only if data shows workspace adoption is high
  enough to warrant the platform overhead

## Why this sequence (rather than big-bang)

Trying to build all five products (workspace, PR-bot, pre-PR review,
real-time, workflow features) at once gives us a 18-36 month v1 that
nothing reaches polish on. The sequenced approach has three properties
the big-bang doesn't:

- Each phase is **independently valuable** — v1 alone is a shippable
  product, not a teaser
- Each phase **funds the next** — PR-bot revenue / OSS adoption
  validates demand before we invest in workspace UX
- Each phase **de-risks the next** — we learn what users actually
  want before building speculative features

The vision isn't compromised — it's protected from the most common
hobby-project failure mode (too ambitious v1 → never ships).

## Open strategic questions (to decide before v1 work starts)

### Q1 — Open-core vs. closed
Current license is PolyForm Noncommercial. For enterprise sales we'd
need either commercial licensing (we can do this — PolyForm allows it)
or pivot to open-core (community tier free, enterprise tier paid under
different license). Need to decide before going-to-market.

### Q2 — Pricing structure
Competitor landscape (May 2026):
- Anthropic Code Review: $15-25/review (token-based)
- CodeRabbit: $24-48/dev/mo (seat-based)
- Greptile: $1/review after 50 (per-review, controversial)
- Codacy: $15/dev/mo+ (seat-based)
- DeepSource: tiered seat-based

We need a position. Per-seat is likely right for workspace, per-review
might suit the PR-bot specifically. Hybrid is possible but adds
complexity. Decide before launch.

### Q3 — PR comment format
The format of the GitHub App's PR comment determines half the
perceived product quality. This needs a dedicated design session —
ideally 2-3 sample comments drafted, validated against "would I as a
reviewer actually click 'see full analysis'?".

### Q4 — Differentiating signals
We need to enumerate explicitly which signals RepoBaron has that
CodeRabbit / Greptile / Anthropic / DeepSource don't. Candidates:
- Blast radius across existing call graph (we have this)
- Duplicate-utility detection at semantic level (need to verify ours)
- Convention drift across many files (need to build this signal)
- Complexity delta tied to AI-generation pattern (need to build)

Without sharp differentiation here, "AI-aware" is just marketing.

## How we'll know the plan is working

v1 success looks like:
- PR-bot installed on ≥50 repos (proves distribution)
- ≥10 paying customers (proves monetization)
- Signal noise rate <15% on real PRs (beats Greptile's 60%, CodeRabbet's 36%)
- Workspace MAU/installer ratio >40% (proves people come back)

v1 failure mode looks like:
- Installer churn — devs install, ignore PR comments after week 1
- Signal noise complaints — same fate as Greptile
- Workspace traffic <5% of bot users — confirms PR-bot is the only
  surface that matters, workspace assumption was wrong

If v1 hits failure-mode signals, **the right move is not to push
harder on the same plan**. It's to revisit Vej A / B / C from the
recon doc and reconsider direction.

---

_Related artifacts:_
- `eval/recon/competitors-2026-05.md` — competitive landscape this
  plan responds to
- `eval/baseline/p1-p2-cells.json` — eval data underpinning "RepoBaron
  delivers grounded answers" claim
