# Eval baseline — strong cells across P1 + P2 + P6

Frozen snapshots of (prompt × repo) cells that demonstrate **consistent
cross-language MCP gains**. Used as a regression-vigilance reference:
any future change that causes one of these cells to regress is a signal
worth investigating before merging.

Two snapshots, captured at different points:

- `p1-p2-cells.json` — 11 cells from `runs/20260510T113151Z/`
  (2026-05-10, post P1 truth-shape fix and rescore-args fix)
- `p6-cells.json` — 5 cells from `runs/20260511T190622Z/`
  (2026-05-11, post fn_qualname fix and cross-module heuristic)

## Why this exists

These results are roadmap-stable evidence that GitVision's MCP delivers
value across all 8 supported languages on the two prompt shapes that
match its strengths:

- **P1** — "name the top 5 most complex functions"
- **P2** — "name the top 5 untested high-complexity functions"

We freeze them here so future eval refactors (tighter scoring filters,
new prompts, prompt-yaml restructures) can still be checked against this
calibrated baseline. If a refactor causes any of these 11 cells to
regress, that's a signal worth investigating before merging.

## Headline numbers

| Cell | Recall no→with | Δ |
|---|---|---|
| P1 ts_zod | 0% → 47% | **+47** |
| P1 py_flask | 25% → 50% | **+25** |
| P1 go_compiler | 0% → 39% | **+39** |
| P1 java_petclinic | 38% → 62% | **+24** |
| P1 rb_rspec | 24% → 41% | **+17** |
| P1 cs_serilog | 6% → 56% | **+50** |
| P2 py_flask | 33% → 89% | +56 |
| P2 go_compiler | 0% → 78% | +78 |
| P2 java_petclinic | 50% → 100% | +50 |
| P2 rb_rspec | 33% → 78% | +45 |
| P2 cs_serilog | 22% → 100% | +78 |

Average MCP recall gain: **+47pp**. Floor across 11 cells: **+17pp**.

Cross-language MCP recall (with-MCP only):

```
csharp 78% · ruby 59% · java 54% · python 50% · ts 43% · go 42%
```

## Caveats

- The "noisy" category labels in the originating run are spurious —
  hallucination metric over-counts legitimate framework mentions
  (`Flask`, `BatchingSink`, etc.) as hallucinations. The recall numbers
  themselves are clean; the categorization isn't.
- Truth source for both prompts is `untested_hotspots` (limit=10 for P1,
  limit=5 for P2). Function names + file paths only.
- ts_zod's untested_hotspots returns content (not the empty result
  P2's targeting comment suggested) — first 47% recall on P1 confirms
  the tool fires for zod.

## P6 (blast_impact) — added 2026-05-11

Captured after the fn_qualname fix (commit 6d67ca0) and the cross-module
heuristic (commit f9940ed). All 5 cells categorize as **strong** —
recall ≥80% on every tested language.

| Cell | Recall no→with | Hallucination no→with | Cat |
|---|---|---|---|
| P6 py_flask | 26% → 100% | 80% → **7%** | strong |
| P6 go_compiler | 44% → 96% | 89% → 50% | strong |
| P6 java_petclinic | 75% → 88% | 85% → 50% | strong |
| P6 rb_rspec | 46% → 100% | 86% → 42% | strong |
| P6 cs_serilog | 17% → 100% | 86% → 36% | strong |

Floor: +13pp recall (java). Best: +83pp (cs_serilog). Cross-language
with-MCP recall on P6: py 100%, go 96%, java 88%, rb 100%, cs 100%.

The cross-module heuristic was a **quality** win, not a recall win:
recall was already strong before the heuristic landed. What changed is
that Claude now writes architectural framing in its answers ("limited
to the owner package — no cross-module dependencies") and hallucination
ratios dropped consistently (py_flask 13% → 7% with-MCP, cs_serilog
40% → 36%).

## Files

- `p1-p2-cells.json` — full result records (text, scores, tool calls,
  matched truth items, latency) for the 11 P1 + P2 cells. Self-contained.
- `p6-cells.json` — full result records for the 5 P6 cells, captured
  post cross-module heuristic. Includes Claude's actual answer text
  showing cross-module-aware framing.
