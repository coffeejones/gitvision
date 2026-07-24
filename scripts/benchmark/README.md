# CodeTrawl MCP benchmark

Measures whether an AI agent answers repo questions **better and cheaper** with
the `codetrawl-mcp` tools than with plain grep+read. Same model, same repo, same
question, two conditions — scored on accuracy (LLM judge vs independently-
verified ground truth), total billed tokens, tool calls, turns, and wall-clock.

> **Status: parked (2026-07-24).** Pilot ran once and validated the methodology.
> Resume when there's budget for the scaled run (cost model below). The harness
> is complete and runnable as-is.

## Run it

```sh
# needs ANTHROPIC_API_KEY (env or .env.local) — the run spends real tokens on it
npm run benchmark:verify   # everything except the Claude calls — no key needed
npm run benchmark          # the real thing
```

Results land in `scripts/benchmark/.work/` (git-ignored): `results.json`,
`results.md`, `run.log`.

## Layout

- `tasks.mjs` — the task set + **ground truth verified by direct grep/read of
  the source** (not from CodeTrawl — so scoring isn't circular). Balanced on
  purpose: some tasks where plain grep should win, so it's not rigged.
- `tools.mjs` — the two conditions: `codetrawlProvider` (bridges the published
  `npx codetrawl-mcp`) and `fileProvider` (list_dir/read_file/grep over a clone).
- `run.mjs` — manual tool-use loop with exact per-turn `usage` accounting (no
  prompt caching, so input tokens reflect true billed cost), the LLM judge, and
  the table renderer.
- `env.mjs` — loads `ANTHROPIC_API_KEY`/`GITHUB_TOKEN` from `.env.local`.

## Pilot findings (expressjs/express @ ae6dd376, opus-4-8)

| Task | Favors | Acc CT | Acc grep | Tok CT | Tok grep | Ratio |
|---|---|---|---|---|---|---|
| read `res.send` | neutral | 95 | 96 | 16.8k | 8.8k | 0.5× |
| locate `res.download` | agent | **55** | **100** | 15.9k | 2.1k | 0.1× |
| deps of `response.js` | codetrawl | 100 | 100 | 15.7k | 6.8k | 0.4× |
| untested fns | codetrawl | 96 | 78 | 18.6k | 67.2k | 3.6× |
| direct-coverage % | codetrawl | **95** | **20** | 16.2k | **239.7k** | **14.8×** |

**The honest story — and it's stronger than "always better":**

1. **CodeTrawl doesn't win everything.** On simple local questions (read a
   function, locate a symbol, find one import) plain grep is as accurate or
   better AND cheaper — the MCP's fixed ~16k analyze_repo overhead isn't worth
   it. On `locate-res-download` the MCP was worse (55 vs 100; it guessed line
   ~550, real answer 435).
2. **The win is whole-repo / cross-cutting structural questions.** As the
   question needs more of the repo, the grep agent's cost explodes and its
   accuracy collapses (coverage: 14.8× the tokens AND wrong — 20 vs 95).
3. **CodeTrawl is flat ~16k tokens / 2 calls per question, size-independent.**
   Grep scales 2k→240k with question breadth. The harder + more cross-cutting
   the question — exactly where real refactor risk lives — the bigger the edge.

**Marketing framing (scoped, defensible):** *not* "4× cheaper" (the average is
misleading). Hero stat: **"test-coverage question — 14.8× fewer tokens, and
correct where the agent was wrong (95 vs 20)."**

**Work item the pilot surfaced:** make "where is symbol X (file:line)" a cheap
first-class MCP answer — the MCP has the line (`untested_hotspots.startRow`) but
the agent didn't reach it and guessed. Fixing this closes the one task where
CodeTrawl lost.

## Cost model (for the scaled run)

Pilot = 5 tasks × 2 conditions + judges on one medium repo ≈ **$2.50**, but
**not** evenly spread:

- **CodeTrawl side of all 5 tasks: $0.48 total** — flat ~$0.10/task, size-independent.
- **grep side: $1.78** — and one task (coverage) was **$1.28** of it (240k tokens).

So the bill scales with **(# hard whole-repo tasks) × repo size** on the grep
side, not with raw task count. Easy tasks are nickels; hard whole-repo tasks are
$0.4–1.4 and grow with size.

**Scaled-run menu** (author task sets + ground truth for new repos on the
orchestration budget, not the API key; add a ~120k per-run token budget cap to
bound grep runaway — which also makes "agent hit its budget and still couldn't
answer" a stronger result):

| Scope | Repos × tasks | Est. API cost | Ceiling |
|---|---|---|---|
| Lean | 3 (S/M/L) × 5 | $6–10 | ~$13 |
| Recommended | 4 (S/M/L/XL) × 5 | $9–15 | ~$18 |
| Publishable table | 5 × 8 | $25–40 | ~$50 |

Candidate repos (JS/TS, tree-sitter-covered, groundable): **chalk** (S),
**express** (M), **axios** (M-L), **fastify** (L).

**Next time:** pick a scope, add the per-run token budget cap, author +
independently verify ground truth for the new repos, run, then render the
publishable table. The size-scaling curve (flat CodeTrawl vs exploding grep) is
the money graph and needs the multi-size repo set to draw.
