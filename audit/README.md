# Audit triage — 2026-05-13

Triaged subset of the 224 raw findings from the 2-round / 6-agent audit.
Rejected ~12 findings as false positives or by-design (listed at bottom);
the remaining items are organized by priority below.

## Buckets

| Folder | Items | What it means |
|---|---:|---|
| [`critical/`](critical/) | 0 | **All resolved 2026-05-13.** 3 real bugs fixed, 2 false positives moved to rejected list below. |
| [`before-v1/`](before-v1/) | ~32 | Real bugs / perf wins / a11y gaps. Must be clean before commercial v1. |
| [`when-time/`](when-time/) | ~60 | Polish, refactors, minor perf. Post-v1 cleanup sprint. |
| [`strategic/`](strategic/) | ~5 | Not bugs — decisions you need to make consciously. |

## How to use this

Each bucket's README is a checklist. Tick items as you fix them.
Move items between buckets if priorities shift. Delete the bucket folder
when it's empty.

Don't try to close all 224 — that's not the job. The job is to act on
the ~30 that move v1 forward and consciously decide what to skip.

## Rejected (not real bugs, do not fix)

### Verified false-positives from the critical bucket (2026-05-13)

- **BUG-006 r2** `lib/depsHealth/ecosystems/npm.ts:31` — "scoped npm packages silently fail"
  - **Verified false** by `curl -H "Accept: application/vnd.npm.install-v1+json" "https://registry.npmjs.org/%40types%2Fnode"` → 200 OK, valid metadata (name, dist-tags.latest=25.7.0, 2333 versions). The npm registry handles `%40%2F`-encoded scoped paths correctly. The agent's "encodes as `%40scope%2Fname`" claim is technically right, but the conclusion that the registry rejects it is wrong.

- **BUG-006/019 both rounds** `lib/depsHealth/index.ts:46` — "ref='HEAD' silently sends literal 'HEAD' to GitHub Trees API"
  - **Verified false** by `GET https://api.github.com/repos/pallets/flask/git/trees/HEAD` → 200 OK, valid tree with 15 entries. GitHub's Trees API accepts the literal `"HEAD"` ref. Confirmed in both audit rounds, but agent consensus does not equal truth — both agents made the same wrong assumption.

### Pre-existing rejections (already triaged)

- **PERF-014** `lib/codeAnalysis/astHash.ts:38-45` — "FNV-1a uses BigInt slower than 32-bit"
  - BigInt is required for 64-bit FNV-1a in JS. Number-type can't hold 64-bit precision. Following the recommendation would BREAK the hash.

- **SEC-018** `mcp/cache.ts:50` — "SHA-1 used for cache key"
  - Cache keys are not authentication. SHA-1 here is a hash function for opaque ID generation. Security-irrelevant.

- **SEC-020** `eval/.env.example:2` — ".env.example contains realistic API keys"
  - That's the entire point of .env.example. Placeholders with realistic shape help users fill them in.

- **QUAL-001** `mcp/__tests__/server.test.ts:9` — "MCP handlers have no functional tests"
  - The eval framework (P1-P8 in `eval/`) tests handler functionality end-to-end against real sessions. Better coverage than the agent realized.

- **SEC-019** `app/layout.tsx:79` — "Plausible loaded without SRI"
  - Plausible script hash changes regularly. SRI would break the script. Conscious tradeoff documented in the migration to .net.

- **BUG-024** `lib/feedback.ts:81` — "clampContext '|| undefined' coerces 0-length email"
  - Intentional: empty-string emails become undefined so the webhook doesn't get confusing empty-email-lead entries. By design.

- **QUAL-019 + BUG-025** `lib/healthAnalysis.ts:86` — "JSON parse fallback dumps text into needsWork"
  - Known graceful-degradation path. User still gets information when the model misbehaves. Not pretty, but conscious.

- **PERF-017** `mcp/cache.ts:67` — "MCP cache: FIFO eviction at 8 entries forces evict-on-second-repo"
  - 8 entries is sized for typical MCP-client session (handful of repos at once). Not a bug — design constraint for memory budget.

- **PERF-016** `lib/codeAnalysis/parse.ts:31-52` — "compiledQueryCache unbounded growth"
  - Max growth is ~30 queries × 8 languages × ~10KB = ~2.4 MB for entire process lifetime. Not a real leak.

## Source

Original audit reports live in `~/Downloads/` (combined/ folder):
- `summary.md` — round 1 + round 2 totals + top hotspots
- `by-file.md` — every finding grouped by file
- `all-findings.json` — flat merged data

This triage is the working subset. Originals remain for cross-reference.
