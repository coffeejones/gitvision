# Changelog

Notable changes to CodeTrawl. Dates are release-to-prod.

## The Conscience — 2026-07-12

CodeTrawl grew a new spine this cycle: **a deterministic verification layer for
AI-authored code.** One net-new engine — the Shadow-Graph patcher — unlocked a
constellation of surfaces that all answer the same question, *"what does this
change break, and does anything catch it?"*, in under a second, cited to the real
import + call graph. No LLM in any verdict.

### Shadow-Graph patcher (the engine)

- **Sub-second incremental re-analysis.** Splice a proposed diff into a cached
  parse layer and rebuild the code graph from only the touched files — for JS/TS,
  byte-identical to a full re-analysis (a golden-equivalence contract pinned by a
  fixture matrix). A change that used to cost a whole-repo re-parse now costs a
  few milliseconds.
- **Content-addressed parse cache** keyed by a sha256 over the analyzed file set,
  written whenever a session is created, refreshed, or re-swept.
- **Bounded + measured:** a per-IP compute gate sheds load instead of piling up on
  the event loop, a warm in-memory layer cache skips repeat decodes, and
  timing telemetry records p50/p95 so the worker offload is a data decision, not a
  guess.

### Faultline Simulator (the human surface)

- **"What breaks if you change this?" made interactive.** Pick a file and CodeTrawl
  simulates deleting it — rebuilding the graph live to show exactly what it takes
  down, how far the shockwave reaches, and which paths have no test to catch the
  break.
- A focused **blast canvas** fans the direct casualties out from the epicenter,
  the untested ones pulsing red, plus a verdict card, the required-actions
  "conscience", and the concrete affected-file list.
- Plus-gated; deterministic; every number cited to real edges.

### The Gate + Merge Receipt (the PR surface)

- **The Gate** — the GitHub PR bot now posts a **Check Run** driven by the
  deterministic blast verdict: clear → success, review → neutral, high-risk →
  failure. An honest signal on the merge box; the repo decides via branch
  protection whether it blocks.
- **Merge Receipt** — a **signed, verifiable certificate** (HMAC-SHA256) that the
  Gate ran on an exact commit. Permalinked, served without auth, with a trustless
  verify endpoint. "Computed, never generated" applied to PR trust: a third party
  can confirm the verdict was issued for that commit, not fabricated.
- The PR comment now leads with the verdict and links the receipt.

### The Conscience agent-loop (the agent surface)

- **`simulate_change` MCP tool** — an AI coding agent proposes a diff and gets a
  deterministic blast verdict + a machine-readable required-actions list *before*
  committing.
- **A stop/go gate** on the result: `gate.pass` false means the change ships a
  regression nothing would catch (load-bearing code with no guarding test, a
  hollow test, a broken guarding test) — resolve it or justify it, then
  re-simulate.
- **A first-class `conscience` MCP prompt** codifies the loop: propose → simulate
  → resolve the blocking gate → re-simulate → done.

---

Full design notes and the per-version history live in
[PROGRESS.md](./PROGRESS.md).
