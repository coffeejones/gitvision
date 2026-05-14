# Verification-rules calibration — 2026-05-14

Threshold + new-rule tuning of `lib/codeAnalysis/verificationRules.ts`
based on real-world validation against Flask refs. Captured here so
future-us knows WHY thresholds are what they are and what the data
trail was.

## The data trail

### Datapoint 1: P8 eval, 2026-05-11

Flask 3.0.0 → main (eval run `20260511T233556Z`). Claude with MCP
manually wrote a PR review listing 4 top concerns. Concern #3 was
`load_dotenv` complexity 9 → 13 (Δ=4). Our rule's threshold at the
time was Δ ≥ 5, so the engine would NOT have flagged it. We noted the
miss in the eval analysis and called it "a tuning signal, not a bug."

### Datapoint 2: Real-world validation v1, 2026-05-14

Flask 3.1.2 → 3.1.3 (a real patch release, 15 changes). Our engine
produced **zero suggestions**. But the diff included 3 methods removed
from `SecureCookieSession` — a meaningful API-surface change. Each
individual method was complexity 1, so all four existing rules sat
silent. Reviewer's mental model wouldn't be silent on this.

### Datapoint 3: Real-world validation v2, 2026-05-14

Flask 3.0.3 → 3.1.0 (a real minor version bump, 109 changes across 23
files). Our engine again produced **zero suggestions**. But the diff
included:

  - `load_dotenv` complexity 9 → 13 (Δ=4) — still under Δ ≥ 5 threshold
  - Net complexity +13 — under > 20 threshold
  - 23 files changed — no rule existed for this pattern

Three thresholds all "lige under" what real PRs produce. That's a
calibration tell.

## Before/after data

### Threshold changes

| Rule | Before | After | Why |
|---|---|---|---|
| `complexity-increase-without-test` | Δ ≥ 5 | Δ ≥ 4 | Catches `load_dotenv`-class changes (security-sensitive functions with subtle bumps) |
| `new-complex-function-untested` | ≥ 5 | ≥ 4 | Symmetry with above |
| `removed-function-with-impact` | ≥ 3 | ≥ 2 | Simple method removals still count as API-surface — catches `_path_is_relative_to`-class cases |
| `high-net-complexity-delta` | > 20 | > 10 | 23-file minor-bump PRs with net +13 are "real PR" sized and should get an overview signal |

### New rules

- **`multiple-removals-from-container`** (warning) — fires when ≥ 3
  functions are removed from the same `containerType`. Catches API
  surface changes where individual removals are below per-function
  complexity thresholds. Motivated directly by the `SecureCookieSession`
  miss above.

- **`large-pr-overview`** (info) — fires when `filesChanged > 10`.
  Info-severity so it sorts below critical/warning. Gives reviewers
  scope context when otherwise-quiet rules leave them wondering "is
  this PR big?"

### Validation results after tuning

**Flask 3.1.2 → 3.1.3** (15 changes — patch release):

```
1 × multiple-removals-from-container · warning · impact=3
    "3 methods were removed from SecureCookieSession: __getitem__,
     get, setdefault. This is an API-surface change..."
```

One suggestion, exactly the API-surface change a reviewer would care
about. No false-positives on the test changes (test files are
filtered).

**Flask 3.0.3 → 3.1.0** (109 changes — minor bump):

```
1 × complexity-increase-without-test · critical · impact=4
    "load_dotenv grew by +4 cyclomatic complexity (9 → 13). No tests
     in the same module were changed — add a regression test..."

1 × removed-function-with-impact · warning · impact=2
    "_path_is_relative_to was removed (original complexity 2). Verify
     no callers in this repo still depend on it..."

1 × large-pr-overview · info · impact=23
    "Sizeable PR — touches 23 files with 109 function-level changes..."

1 × high-net-complexity-delta · info · impact=13   (below top-3 cap)
    "+13 cyclomatic complexity points across 32 modified and 42 added
     functions..."
```

Four suggestions, top-3 displayed (the high-net-complexity-delta
suggestion gets dropped at the cap because the critical/warning ones
have higher severity). The critical surfaces `load_dotenv` — the
exact function our P8 manual review also flagged.

## Calibration philosophy after this pass

We aim for **2-5 suggestions on a substantive PR, 0-2 on a patch
release.** That's the band reviewers can actually read without
tuning out. Below 2: the bot looks asleep. Above 5: it looks like
Greptile (60% nitpick rate that drove the audit's complaint
against existing tools).

If we ever expand the rule set further, target the same band. If a
new rule reliably fires on every PR, it's wallpaper and should be
demoted from warning to info, or have a higher threshold.

## What's still uncalibrated

- We've validated on **Python (Flask)** only. Java/Go/C# may behave
  differently — patterns like Java getter-removal might fire too
  aggressively on the `removed-function-with-impact` rule at complexity
  ≥ 2. Worth validating on petclinic / a Go repo before shipping
  publicly.
- Threshold validity probably holds for small-medium PRs. **Mega-PRs
  (500+ changes) might over-fire** — the rules engine has no
  saturation cap. Consider adding "if > N suggestions would fire,
  promote large-pr-overview to warning and drop per-function rules
  to top-3" as a future polish.
- `test_server_name_matching` (added test file, complexity 3) wasn't
  flagged by any rule — correct, but it's worth noting that the
  threshold for new-complex-function-untested is now 4, which would
  miss a complexity-3 production function being added without tests.
  Calibration tradeoff: lower → more noise, higher → more misses.
