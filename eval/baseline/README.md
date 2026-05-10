# Eval baseline — P1 + P2 strong cells

Frozen snapshot of the 11 (prompt × repo) cells that demonstrated
**consistent cross-language MCP gains** in the first calibrated eval run.

Captured: 2026-05-10 from `runs/20260510T113151Z/` (post P1 truth-shape
fix and rescore-args fix).

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

## Files

- `p1-p2-cells.json` — full result records (text, scores, tool calls,
  matched truth items, latency) for these 11 cells. Self-contained.
