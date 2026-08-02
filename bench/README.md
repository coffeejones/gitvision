# Security benchmark harness

How every number in `SECURITY_LAYER_PLAN.md` was produced. If you are changing a
rule in `lib/codeAnalysis/plugins/python.ts` or `lib/security/`, this is the loop.

```bash
bench/bootstrap.sh     # once — clones ~700 MB of corpora into ~/.codetrawl-bench
bench/run.sh           # after every change — analyse both corpora, print both tables
```

Corpora live outside the repo (`$BENCH`, default `~/.codetrawl-bench`). Nothing
there is precious — `bootstrap.sh` rebuilds all of it from public git remotes.

## The two corpora, and why they are never merged

| | what | why it exists |
|---|---|---|
| `rvrepos/` (23) | pygoat, dsvw, vulnpy — deliberately vulnerable **teaching apps** | the rules were built against these |
| `heldout/` (39) | `vc-*` — realistic **business apps** with seeded vulns | the honest test |

Every rule was narrowed by looking at the tuned 23. **A precision number from
that set alone is a fit, not a forecast.** When this was first measured
(§4w), precision was 0.921 on the tuned set and **0.484** on the held-out one —
57% of the new false positives were in test and seed files, a file category
teaching apps do not contain at all.

Quote both numbers or neither.

## The three gates a rule must pass

`run.sh` prints all three. A rule that fails any of them does not ship.

1. **Traps: 262/262 clean.** The benchmark contains 262 deliberately
   safe-looking snippets (107 tuned + 155 held-out). Flagging even one outweighs
   any recall gain. `py-open-redirect` broke this on first measurement and
   needed three guards before it could ship.
2. **Production stays quiet.** `pyprobe/` holds Zulip, NetBox and Saleor —
   well-built apps where nearly every finding is noise. Current baseline is
   **68 surfaced findings**; if your change moves that number, read every new
   one before assuming it is a win. This gate is what killed the bare md5/sha1
   rule (19 of Zulip's 25 findings were gravatar hashes).
3. **Precision holds on held-out.** Currently 0.899.

## The standard that decides every rule

**Flag a dangerous DATA FLOW — something untrusted travelling somewhere
dangerous — never a PATTERN.** Seven pattern-rules were built, measured and
deleted. Each looked reasonable before it was measured:

- bare md5/sha1 → gravatar hashes and cache keys
- bare `{{ }}` interpolation → precision 0.919 → 0.684
- `csrf_exempt` → over-generic name
- plaintext password column → 4 TP / 10 FP; Django's `AbstractUser` stores a
  *hash* in exactly that shape
- error-detail leak → NetBox's `Response({'detail': e.message})` is a deliberate
  API contract
- mass assignment → proved untrusted data *arrives* in a dict, never that the
  dict was a dangerous destination
- `py-nosql-injection` → claimed 31 true positives, delivered **zero** when
  actually implemented

The rules that survived all describe travel, or a structure dangerous in itself.

## Gotchas that have cost real time

- **`requiresTaint` without `taint` is invisible.** `classifySinks` drops that
  combination, correctly. A rule can fire in the plugin and score zero here.
- **`ANALYZER_VERSION`** in `lib/shadowGraph/parseCache.ts` must be bumped when
  the sink set or taint engine changes — the parse cache stores findings, not
  just syntax, so a stale entry serves the old rule set to existing users.
- **Ground truth anchors on the function `def`**, not on the vulnerable
  statement, for many families. The scorer matches file + CWE + line ±10, so
  check your emitted line actually lands in that window.
- **`bench/emit.ts` holds the rule → CWE map.** A new rule scores nothing until
  it is added there. This map is also the reason our comparison against
  third-party tools flatters us — we align to the scorer, they do not.

## Files

| | |
|---|---|
| `bootstrap.sh` | clone the benchmark + all corpora |
| `run.sh` | analyse both corpora, print all three gates |
| `emit.ts` | run the engine, write results in the scorer's format |
| `score.py` | score against ground truth; `--compare` ranks every tool present |
| `prod.ts` | the production false-positive gate |
| `e2e.ts` | the product's own render path — catches what the benchmark cannot |

`e2e.ts` is worth running before shipping UI-visible changes. It found that
`request.user` was being treated as untrusted input on NetBox, which the
benchmark scored as *nothing at all* because NetBox has no ground truth.

## Comparing against other tools

```bash
BENCH=~/.codetrawl-bench python3 bench/score.py --compare
```

The benchmark ships results for Semgrep, SonarQube, Snyk and a dozen `kolega-*`
tools. Read that table with two caveats: the benchmark's own author publishes
the `kolega-*` tools *and* the held-out repos, and Semgrep's 0.000 precision is
a scoring artefact (it fires real Django security rules whose line anchors and
CWEs do not align), not evidence it finds nothing.

**Do not put "beats Semgrep/Snyk/SonarQube" in public copy on this evidence.**
That needs a corpus neither party built.

---

# Blast radius: is "the tests worth running" true?

`lib/changeBlast` promises, for a changed file, *"which tests guard it"* — a
falsifiable claim that had never been checked. Unlike the security corpus, the
ground truth here is free, unlimited, and generated from the repo itself.

```bash
bench/testOracle.sh /tmp/cov                    # coverage: which tests EXECUTE each file
npx tsx bench/pickTargets.ts > /tmp/targets.txt # the files testsToRun claims about
MUTANTS=3 npx tsx bench/mutationOracle.ts $(cat /tmp/targets.txt) > /tmp/mutation.json
npx tsx bench/blastScoreMutation.ts /tmp/mutation.json
```

## Use the mutation oracle, not coverage

Coverage answers *"which tests load this file"*, which over-counts badly —
27 test files "cover" `deterministicSort.ts` and none of them test sorting.
Scored against coverage, `testsToRun` looked like recall **0.291**. Scored
against tests that actually *fail* when the file is broken, the same code
scored **0.727**. The first number is not a finding, it is a bad denominator.

`mutationOracle.ts` flips one token per mutant (`===`→`!==`, `true`→`false`)
and only on lines the coverage run proved are executed — a mutation on dead
code measures nothing, which the first version of this did, reporting zero
guards for a file with 17 real tests. Mutations are chosen to keep the file
type-correct; a compile error would fail the whole suite and measure nothing.

## What it found

**Not a graph problem — a ranking problem.** Of the 6 guarding tests missing
from `testsToRun`, **5 were already in the candidate set** and had been sorted
below `.slice(0, 6)`. Only one was genuinely absent from the graph.

The metric was `guards` — how many of the affected files a test happens to
reach. That is *breadth*, and breadth is the wrong thing to put in the top
slots. The clearest case: `testCoverage.test.ts` was ranked out of the top 6
for `testCoverage.ts`. The test named after the file, beaten by broader tests
that catch nothing.

Ranking now goes: reaches the changed file itself → named after it (exact, then
prefix) → breadth → path. Both counter-cases are pinned in
`lib/__tests__/refactorSafety.test.ts`.

| | before | after |
|---|---:|---:|
| recall (mutation oracle) | 0.727 | **0.864** |
| precision | 0.190 | 0.226 |
| files where every guarding test was listed | 11/15 | 13/15 |

Low precision is deliberate and cheap — listing six tests when two would do
costs seconds. **Recall is the safety property**: a guarding test we omit is
one a developer was told they did not need to run.

## Known limits

- **The cap of 6 is a lottery when the field is undifferentiated.**
  `storage.ts` has 20 candidates that all import it directly, so direct-reach
  cannot discriminate and order falls back to alphabetical. The prefix rung
  rescues one; `sessionCompaction.test.ts` has no name relation to `storage.ts`
  and is still missed.
- **`signals.ts` is caught by 6 tests and the cap is 6** — no room for a single
  ranking error.
- One miss was a real graph gap (`evidencePack.test.ts` → `signals.ts`), not a
  ranking failure.
- Measured on this repo only, which is TypeScript. Blast radius also runs on
  Python and five other languages where the graph's edges are weaker, and that
  is unmeasured.
- 5 of 20 sampled files had **no mutant caught by any test** — they have
  coverage but nothing that notices a behaviour change. That is a finding about
  the repo, not about the tool.

## Python: a different failure, and a worse one

Same oracles, run on Flask 2.3.3 (`bench/pyOracle.py`, 21 test files, suite runs
in 1.6s). The result is not "the same but weaker" — it is a *different* defect.

| cap | TypeScript recall | Python recall |
|---:|---:|---:|
| 6 (shipped) | 0.818 | 0.214 |
| 10 | **0.955** | 0.243 |
| 20 | 0.955 | 0.243 |

**TypeScript is cap-bound.** Ceiling at cap 6 is 1.000, so the shortfall is
ranking, and raising the cap to 10 buys 14 points of recall for 3 of precision.
Beyond 10 nothing changes — the candidate lists are exhausted.

**Python is graph-bound.** Raising the cap barely moves it, because the right
tests are not candidates at any cap. Of the tests that catch a mutant in
`helpers.py`, `testing.py` and `blueprints.py`, **every single miss was absent
from the graph** rather than ranked out.

### The root cause: src-layout packages resolve to the wrong file

`tests/test_blueprints.py` does `import flask`, then `flask.Blueprint(...)`.
The graph resolves that import to
`tests/test_apps/blueprintapp/__init__.py` — a fixture app — instead of
`src/flask/__init__.py`, and produces **no call edge at all** for
`flask.Blueprint(...)`. The resolver reports zero unresolved imports, so nothing
looks wrong; it is confidently wrong.

Measured across Flask: **38 test imports land on a fixture app** under
`tests/`, and only 27 of the 128 edges into `src/flask/*` come from tests.

This is not a blast-radius bug. It corrupts the call graph for any Python
project using a `src/` layout — the modern packaging standard — and it will be
understating fan-in, reachability and test mapping everywhere it happens.

### Also fixed here

`isRunnableTestFile`: a conftest, a typing stub, or a fixture app under
`tests/` can never be reported as a failing test, but `isTestFile` counted them
and they were consuming **31% of the six-slot budget** on Flask. Filtering them
is recall-neutral on TypeScript (0.818 both ways, verified by toggling it) and
takes Python from 0.186 to 0.214 with precision 0.265 → 0.366.

### The cap makes the advice unstable

Between two runs, TypeScript recall fell 0.864 → 0.818 with no change to the
ranking code. Cause: another session added `signalCount.test.ts`, which entered
the candidate set for `signals.ts` and pushed a real guard off the end of a
six-item list. A new test file anywhere in the repo can silently remove a real
guard from an unrelated file's advice.

### The Python resolver, fixed

Two defects, both found by this oracle and both language-shaped:

**1. Fuzzy import resolution took the first match, not the best one.**
`resolvePythonImport` fell back to a suffix scan and returned whatever the map
yielded first. On Flask that meant `import flask` resolved to
`tests/test_apps/cliapp/inner1/inner2/flask.py`. Candidates are now collected
and *ranked*: not under a test tree, then `src/` layout, then shallowest, then
path for determinism. Mis-resolutions **38 → 6**; edges into `src/flask/*` from
tests **27 → 60**.

**2. The name-affinity rung only understood JavaScript.** It stripped a
*trailing* `.test`/`.spec`, so `test_blueprints` never matched `blueprints` and
the rung was dead on every Python repo. Now strips both conventions
(`test_x.py`, `x_test.go`, `TestX.java`, `x.test.ts`).

The first fix was invisible at the shipped cap and only showed up when the cap
was lifted — a useful reminder that a metric can hide a real improvement:

| cap | Python before | Python after | TypeScript |
|---:|---:|---:|---:|
| 6 (shipped) | 0.214 | 0.229 | 0.818 |
| 10 | 0.243 | **0.314** | 0.955 |
| 20 | 0.243 | **0.600** | 0.955 |

Before the fix Python was flat from cap 10 — the candidate list was exhausted,
so the right tests were nowhere to be found. It now climbs to 0.600. **Python
was both graph-bound and cap-bound; the graph is fixed and the cap is what
remains.**

Security benchmark unchanged throughout (tuned 193/18, held-out 375/42, traps
262/262, production 68) — the resolver is shared, so that was the thing to
watch.

### The cap: raised to ten

Ten is the knee of the measured curve, not a round number.

| cap | TypeScript recall | Python recall | TS precision |
|---:|---:|---:|---:|
| 6 (was) | 0.818 | 0.229 | 0.214 |
| **10 (now)** | **0.955** | **0.314** | 0.183 |
| 20 | 0.955 | 0.600 | 0.135 |

Four more slots buy TypeScript 14 points of recall for 3 of precision, and
beyond ten nothing improves there at all. Python keeps climbing to 0.600 at
twenty — but a twenty-item "tests worth running" list stops being advice, and
the density argument is weaker than it looks anyway: the refactor page renders
one compact row per file and the test list lives in a drill-down, so the cap
does not affect the page a reader scans.

Low precision remains deliberate. Naming ten tests when three would do costs
seconds; omitting a guarding test is a break shipped.
