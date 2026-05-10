# gitvision-eval

A/B evaluation harness for GitVision's MCP server. Same prompt, same model,
same target repo — the only variable is whether the MCP is connected.

The output isn't a marketing artifact. It's **internal roadmap input**:
which languages need plugin work, which tools are over- or under-helping,
which prompt shapes Claude struggles with, which features we should drop
or rebuild.

## Design choices

This is a deliberately thinner companion to the previous `gitvision-eval`
external repo. Three differences worth knowing about:

1. **Tightened identifier extraction.** Designed around an existence
   check (look up Claude's mentions in repo's full code graph), but
   MCP's `analyze_repo` returns codeGraph fields as summary INTs —
   the function list lives on disk in the session, not in the tool
   response. Falls back to ground-truth-set comparison (same as the
   existing eval), but with two upgrades: stripped English-word noise
   (drops "Function", "Code", "Test", etc.) AND restricted candidate
   identifiers to those that LOOK like real identifiers (CamelCase or
   underscore present). Cuts false-positive hallucination flags from
   prose words like "describe" or "report".

2. **Cross-language built-in.** `prompts.yaml` lists 6 target repos (one
   per language). One eval run hits all of them; cross-language deltas
   surface automatically.

3. **Findings auto-categorization.** Each (prompt × repo × variant) result
   gets a category tag based on observed metrics:
     - **strong** — recall > 0.8, hallucination < 0.1 (validate, screenshot)
     - **weak-tool** — MCP barely beats baseline (recall delta < 0.1) — the tool doesn't help here, consider Reframe
     - **noisy** — hallucination > 0.3 with MCP — Quick fix or Architectural debt
     - **gap** — recall < 0.3 even with MCP — Architectural debt
     - **acceptable** — anything else (fine, no action needed)

Categorization is a starting point; final roadmap calls happen by humans
reading `findings.md` and adding manual notes.

## Layout


```
eval/
├── README.md          ← you are here
├── prompts.yaml       ← prompts × target repos
├── eval.py            ← single-file pipeline (truth → run → score → report)
├── pyproject.toml     ← deps (anthropic, mcp, pyyaml, python-dotenv)
├── .env.example       ← config template
└── runs/<ts>/         ← per-run artifacts
    ├── manifest.json  ← what config produced this run
    ├── ground_truth/  ← cached MCP responses per repo (10-min reuse window)
    ├── results.json   ← every (prompt, repo, variant) raw output + scores
    └── findings.md    ← human-readable categorized report
```


## Setup

### Build the MCP server


```bash
# From the gitvision repo root
npm install
npx tsc -p mcp/tsconfig.json
node mcp/dist/mcp/server.js   # smoke test — Ctrl+C
```


### Install Python deps


```bash
cd eval
# With uv (faster):
uv sync
# Or with pip:
pip install -e .
```


### Configure


```bash
cp .env.example .env
# Edit .env:
#   - ANTHROPIC_API_KEY
#   - GITHUB_TOKEN  (gitVision needs it to fetch repos)
#   - GITVISION_REPO_PATH  (absolute path to this gitvision checkout)
```


## Running


```bash
# Default: all 6 target repos × all prompts, Sonnet 4.6, 1 run per cell
uv run python eval.py

# Subset: only TypeScript + Go targets
TARGET_LANGUAGES=ts,go uv run python eval.py

# Subset: only one prompt
PROMPT_IDS=P1_top_complexity uv run python eval.py

# Different model
ANTHROPIC_MODEL=claude-haiku-4-5 uv run python eval.py
```


The report is at `runs/<timestamp>/findings.md`.

## What this is NOT for

- **Marketing data.** B4 5.4→2.7 belongs in a Rick email, not here.
- **Claim validation.** "8 languages supported" is unit-test-true; this
  eval tells us whether the practical recall is comparable across them.
- **Continuous integration.** Each run costs $0.50–$2 in API calls.
  Run by hand when you want roadmap input, not on every commit.

