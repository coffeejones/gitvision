# GitVision

> Map any GitHub repo. Find what's risky, duplicated, or untested.

Paste a URL. Get blast radius, structural duplicates, untested hotspots,
and an AI health verdict grounded in 17 deterministic signals — in
under 20 seconds, across 7 languages.

![GitVision alpha](https://img.shields.io/badge/status-alpha-amber)
![Next.js 16](https://img.shields.io/badge/next.js-16-black)
![React 19](https://img.shields.io/badge/react-19-blue)
![Tests](https://img.shields.io/badge/tests-527%20passing-emerald)
![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial-purple)

<!-- TODO: hero screenshot of a session page on a recognizable repo
     (e.g. golang/go src/cmd) showing the Code tab with Near-Duplicates
     panel expanded. -->
<!-- ![GitVision Code tab — Near-Duplicates on golang/go](docs/screenshots/hero.png) -->

## Why GitVision

GitHub Insights gives you commit counts and a contributor list. GitVision
gives you the questions an engineering manager actually asks:

- **What breaks if I change this file?** — three-hop blast radius across
  the call graph, computed from tree-sitter AST parses.
- **Where's the tech debt nobody's looking at?** — structural duplicate
  detection that spotted 36 copies of one ARM rewrite pattern in
  `golang/go/src/cmd`.
- **What complex code is the test suite ignoring?** — per-function test
  coverage estimated by walking the call graph from test files into
  production code. No external coverage tool needed.
- **What changed since I last looked?** — a story-driven refresh banner,
  not a metadata diff.

Every AI claim is grounded in a deterministic signal computed
server-side. Zero hallucination room.

## Try it

<!-- TODO: replace with the live deploy URL once gitvision.app is set up -->
<!-- 👉 [gitvision.app](https://gitvision.app) -->

Or run it locally:

```bash
# 1. Install
git clone https://github.com/SoosFire/gitvision
cd gitvision
npm install

# 2. Recommended: GitHub token (60 → 5000 req/hr)
cp .env.example .env.local
# Edit .env.local — paste your token after GITHUB_TOKEN=
# Generate at https://github.com/settings/tokens/new — tick `public_repo` only.

# 3. Optional: Anthropic key for AI summaries + health verdict
# Edit .env.local — paste after ANTHROPIC_API_KEY=
# Skip this and the AI panels just hide gracefully.

# 4. Run
npm run dev
# → open http://localhost:3000
```

Node 20.9+ required (tested on 25.x).

## What you'll see

Each session page has six tabs:

**Canvas** — Folder frames + file cards laid out as a packed map. Color
by file type or by dominant author. Time-scrub to see the codebase
evolve commit-by-commit.

<!-- ![Canvas tab](docs/screenshots/canvas.png) -->

**Imports** — File-to-file import graph as a brick-stagger layered
layout. Click a file to isolate its 1-hop neighborhood.

**Code** — The AST-based analysis hero. Three insight panels above
twin lists:

- **Blast radius** — file mode shows incoming + outgoing dependency
  hops. Click a function to zoom into function-level: callers and
  callees.
- **Untested hotspots** — most-complex production functions with no
  direct test caller. Per-file coverage badges scaled by ratio.
- **Near-duplicates** — structural AST-hash groups. Sorted by
  `groupSize × maxComplexity` so the worst tech-debt finds rise to
  the top.

<!-- ![Code tab — Near-Duplicates panel expanded](docs/screenshots/code-near-duplicates.png) -->

**Packages** — Multi-ecosystem dependency health (npm, Cargo, PyPI).
Vulnerable / outdated / deprecated packages with direct CVE links.

**PRs** — Sankey of cycle-time flow: Opened → Outcome → time-to-merge
bucket.

**Overview** — Hotspot treemap, contributor list, language mix, weekly
commit activity, bus-factor approximation per folder.

Plus the session header:

- **Refresh banner** — "Since your last visit": story-driven headline
  ("Code complexity grew by 45 — new branching logic added across the
  codebase") + the metric chips behind it.
- **AI summary** — 150-200 word repo profile.
- **AI health verdict** — three-column "What works / Where to dig
  deeper / Open questions" grounded in 17 deterministic signals.

## Language coverage

| Language     | Plugin           | Imports | Functions | Calls | Complexity | Type-aware |
| ------------ | ---------------- | ------- | --------- | ----- | ---------- | ---------- |
| JS / TS      | `javascript`     | ✅ AST  | ✅        | ✅    | ✅         | ✅         |
| Python       | `python`         | ✅ AST  | ✅        | ✅    | ✅         | ✅         |
| Go           | `go`             | ✅ AST  | ✅        | ✅    | ✅         | ✅         |
| Java         | `java`           | ✅ AST  | ✅        | ✅    | ✅         | ✅         |
| C#           | `csharp`         | ✅ AST  | ✅        | ✅    | ✅         | ✅         |
| PHP          | `php`            | ✅ AST  | ✅        | ✅    | ✅         | ✅         |
| Ruby         | `ruby`           | ✅ AST  | ✅        | ✅    | ✅         | partial    |
| Kotlin       | `regex-fallback` | ✅      | —         | —     | —          | —          |
| HTML / CSS   | `regex-fallback` | render-target only — Spring MVC controllers, etc.    |

Kotlin migration is blocked upstream
([`tree-sitter-wasms@0.1.13` ABI mismatch with `web-tree-sitter@0.26.8`](https://github.com/tree-sitter/tree-sitter/discussions/2912)).
Until a compatible WASM grammar appears, Kotlin gets imports only.

## Architecture (light)

```
app/                        Next.js App Router
├─ page.tsx                 Landing
├─ session/[id]/page.tsx    Session dashboard
└─ api/                     POST /sessions, /refresh, /summary, /health, …

components/                 React Flow canvases + panels + UI primitives
lib/
├─ codeAnalysis/            AST pipeline — plugins/ per language + WASM runtime
├─ depsHealth/              Multi-ecosystem dep-health — ecosystems/ per registry
├─ signals.ts               17 deterministic health detectors (no AI)
├─ healthAnalysis.ts        Constrained Claude narrative grounded in signals
├─ aiSummary.ts             Claude repo profile generator
├─ rateLimit.ts             Per-IP rate limiter (alpha launch safety)
├─ aiBudget.ts              Daily Anthropic call kill-switch
└─ storage.ts               File-based sessions (.gitvision/sessions/*.json)
```

Full architecture, design decisions, and a per-version changelog live
in [PROGRESS.md](./PROGRESS.md) — required reading if you're
contributing or branching ideas off the codebase.

## Tech stack

- **Next.js 16** App Router (Turbopack dev, webpack prod)
- **React 19** + TypeScript 5 (strict)
- **Tailwind CSS v4** via `@tailwindcss/postcss`
- **@xyflow/react** (React Flow 12) for both canvases
- **web-tree-sitter** + `@vscode/tree-sitter-wasm` for AST parsing
- **D3 v7** for treemap + sankey + color scales
- **Octokit** for GitHub REST API
- **`@iarna/toml`** for Cargo + PyPI manifest parsing
- **`@anthropic-ai/sdk`** Claude Sonnet 4.5 (optional)
- **vitest** — 527 unit tests across plugins, signals, parsers, and
  the rate-limit / AI-budget rails

Storage is filesystem-based (`.gitvision/sessions/<id>.json`). No
database. Inspectable, portable, gitignored.

## Cross-platform

Runs identically on macOS, Linux (Railway), and Windows. Cross-platform
npm scripts; `.gitattributes` pins LF line endings.

## Contributing

Project status is **alpha**. Bug reports and feature ideas are welcome
via [GitHub Issues](https://github.com/SoosFire/gitvision/issues). Note
the license — see below.

## License

GitVision is licensed under the **PolyForm Noncommercial License 1.0.0**
— see [LICENSE](./LICENSE).

- **Yes** to personal use, learning, experimentation, hobby projects,
  academic research, teaching, nonprofit organizations.
- **No** to using this code (or derivatives) in a commercial product
  or for-profit service without a separate commercial license.

If you want to use GitVision commercially, [open an issue](https://github.com/SoosFire/gitvision/issues)
or get in touch.

Copyright © 2026 Jonas Hansen.
