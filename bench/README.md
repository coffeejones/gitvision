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

### Following re-exports

Python stayed far behind TypeScript even after the cap went up, so the graph
was still hiding the right tests. Two mechanisms were missing, both of them
things a path-based rule cannot see.

**1. A package root hides the file that defines the symbol.**
`src/flask/__init__.py` does `from .blueprints import Blueprint`. A caller
writes `import flask` then `flask.Blueprint(...)`. Every rule stops at the
package root: `blueprints.py` is neither the file the caller imported nor named
after what they typed. `ParsedImport` now carries the names an import BINDS, so
the resolver can follow `pkg.name` to the file that defines `name`. Symbol-
precise on purpose — widening `importsByFile` transitively instead would make
every consumer of a package depend on every module inside it, which is false
and would wreck the safety tiers.

**2. Languages with no `new` keyword never resolved a class at all.**
`flask.Blueprint(...)` sets no `isConstructor` flag, and `Blueprint` is a
*containerType*, not a function name, so the candidate list was empty before
any resolution ran. The constructor is now looked up under the language's own
convention (`__init__`, `constructor`) — but only when the plain lookup found
nothing, and under the same import proof the flagged path demands. That proof
is load-bearing: matching a class by name alone once added 104 edges to zod, 84
of which the import graph could not justify.

Measured on Flask — 0 of 2428 test calls resolved before, 231 after mechanism 1:

| | Python recall |
|---|---:|
| after the resolver + cap work | 0.314 |
| + re-export following | 0.357 |
| + constructor lookup | **0.529** |

TypeScript unchanged at 0.955 throughout, and the security benchmark is
byte-identical at every step — tuned 193/18, held-out 375/42, traps 262/262,
production 68. That was the thing to watch: this changes call resolution for
every language, not just Python.

### What the receiver calls actually were

`bench/receiverProbe.ts` classifies unresolved calls by cause instead of
guessing. On Flask's tests, 1673 calls have a receiver:

| n | share | cause |
|---:|---:|---|
| 996 | 60% | **local variable — the callee IS a method we define, but we cannot type `app`** |
| 306 | 18% | resolved |
| 287 | 17% | callee unknown to the graph — external, correctly declined |
| 41 | 2% | receiver names a class we define |
| 29 | 2% | receiver is a module we import |

**Local type inference is the whole remaining story**, not import mechanics:
`app.app_context()` where `app` came from a pytest fixture. That is a different
kind of work from anything done here.

Finding the 7% that *should* already have resolved turned up a real bug: a
package root re-exports one name per line (`from .helpers import abort as
abort`, thirty times), and import edges are deduped by spec — correct, one edge
per target — but that dropped every symbol after the first. `flask.abort`
resolved; `flask.url_for` did not. Merging the names lifted resolved receiver
calls from 218 to 306.

### A better graph made the advice worse

That fix is unambiguously correct, and blast recall **fell**: 0.529 → 0.486
(precision rose, 0.411 → 0.425). Per file, `__init__.py` was gained while
`sessions.py` and `debughelpers.py` were lost — their guards are broad tests
with no name relation, so the affinity rung has no signal, and a richer graph
means more files qualify as "affected", more tests qualify as guards, and a
fixed ten-slot budget spreads thinner.

Ranking the tail by *specificity* instead of breadth was tried and is worse on
both languages (Python 0.457, TypeScript 0.909). Breadth-first stands.

The fix stays. Resolving `flask.url_for` to `helpers.py` is simply true, the
security layer depends on graph accuracy far more than this surface does, and
reverting a correct fix to flatter a metric is how a benchmark starts lying.
But it is worth recording plainly: **on this surface, accuracy and advice are
not the same axis.**

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

---

# Entry points: does the framework agree?

The rarest kind of oracle — exact, free, and produced by the system under test.
Flask and Django both know precisely which routes they serve and which function
each dispatches to, so `app.url_map` and `get_resolver().url_patterns` settle
the question with no third party involved.

```bash
# Flask
"$BENCH/pymut/flask/.venv/bin/python" bench/entrypointOracle.py flask \
    "$BENCH/pymut/flask/examples/tutorial" \
    "__import__('flaskr').create_app({'TESTING': True})" > /tmp/ep.json
npx tsx bench/entrypointScore.ts /tmp/ep.json "$BENCH/pymut/flask/examples/tutorial"

# Django
(cd "$BENCH/rvrepos/realvuln-pygoat" && .venv/bin/python \
    <repo>/bench/entrypointOracle.py django . pygoat.settings) > /tmp/ep.json
npx tsx bench/entrypointScore.ts /tmp/ep.json "$BENCH/rvrepos/realvuln-pygoat"
```

This matters more than it looks: entry points are what reachability is computed
from, and reachability decides which security findings surface at all. A missed
route makes a real vulnerability invisible.

## Result

| | Flask (flaskr) | Django (pygoat) |
|---|---:|---:|
| handlers the framework serves | 8 | 74 |
| recall | **1.000** | **0.946** |
| genuine misses | 0 | **2** |

Django's raw precision reads 0.526, and **none of the 63 "extra" detections is
wrong**:

- **44** are class-based view *methods*. Django reports the class
  (`DoItFast`); we report `get`/`post`/`put`/`delete`. Ours is the more useful
  answer — it names the function that actually runs.
- **19** are `dockerized_labs/*/app.py`, separate Flask apps living inside the
  pygoat repo. Genuinely entry points; Django simply is not the thing serving
  them.

## Distrust the oracle first

Three of the four apparent Django misses were **oracle bugs, not engine bugs**,
and the first Flask run was worse — 0.625/0.625, entirely my fault:

- `inspect.getsourcefile` on a decorated view returns the *decorator's* file.
  Three flaskr handlers were blamed on `auth.py` because `@login_required`
  lives there. `inspect.unwrap` first, then ask.
- A decorator that skips `functools.wraps` leaves the function named
  `function`, so the oracle reported a handler the engine had located
  correctly under its real name (`a10_lab2`).
- A `.venv` inside the analysed repo made Django's own admin views look like
  app code, adding 94 phantom "misses".

## The two genuine misses — fixed

Both were the same principle: **read the routing table's own import line.** It
is the one place that states unambiguously which definition a route means.
Django recall **0.946 → 0.973**; Flask stays 1.000.

1. **Module alias in a URLconf.** `pygoat/urls.py` writes
   `path("register", v.register)` where `v` is an alias for the views module.
   `narrow()` filters on `moduleOf(filePath) === "v"`, matches nothing, and
   leaves two same-named candidates it then declines to choose between.
2. **Ambiguous bare name.** `path("2021/discussion/A9/target",
   log_function_target)` names a function defined in both `api.py` and
   `archive.py`. The urls.py import line says exactly which.

Two things had to be true before either fix took effect, and both cost time:

- **`narrow()` was only wired to the CLASS branch.** Functions duplicated the
  logic inline, so teaching `narrow` to read imports changed nothing until the
  copy was replaced by a call. The duplication is now gone.
- **`from introduction import views as v` binds a SUBMODULE.** Recording `v`
  against the package root meant the alias resolved to `__init__.py`. The
  binding now goes to the submodule, and only names that are *not* submodules
  stay on the package edge.

### What it cost

Production surfaced findings went 68 → 70. Both new ones were read, and both
are false positives on Zulip: a redirect to a server-built activation URL, and
`open()` on a path assembled from a validated integration name. They are the
same tension recorded above — a richer graph propagates taint further, so
accuracy and quiet are not the same axis. The security benchmark itself is
unchanged (193/18, 375/42, traps 262/262).

A sanitiser for `os.listdir`/`glob` was written to remove the second one and
**reverted**: the taint reaches the sink through `os.path.join`, not through
the listing, so it had no measured effect. Shipping it would have been dead
code that looked like a fix.

---

# Duplicate detection: what the floor was hiding

The audit that flagged this said recall was **0.001** on NetBox — 1 group
reported against 1383 "true clone pairs" — and that removing the complexity
floor recovers 0.998. **That recommendation was wrong**, and measuring it is
what showed why.

```bash
npx tsx bench/dupProbe.ts . ~/.codetrawl-bench/pyprobe/netbox ~/.codetrawl-bench/pymut/flask
```

## Removing the floor is not the fix

At `minComplexity: 1` NetBox reports **104,244 pairs**, and the largest single
group is **288 identical `test_name()` methods** in one Django test module.
That is the framework's own convention; extracting a helper for it would be
wrong. The audit's oracle counted every AST-identical pair as truth, which
counts convention as a finding — and since the oracle and the detector share
the same hash, the recall number was partly circular too.

Pairs is also the wrong unit: a 288-member group is 41,328 "pairs" on its own.
Groups is the honest count.

## Spread is the discriminator complexity could not provide

| | shipped (cx≥5) | cx≥1 | spread≥2 alone | **cx≥2 AND spread≥2** |
|---|---:|---:|---:|---:|
| this repo | 6 | 113 | — | **15** (panel cap) |
| NetBox | 8 | 563 | 81, worst pile-up **278** | **15** (cap), pile-up 19 |
| Flask | 0 | 96 | 28 | **0** |

A one-liner repeated inside ONE file is that file's idiom. The same helper
appearing once per file across eleven files is copy-paste — and at a floor of 5
the panel could not see `fileBasename()` written eleven times in eleven files,
`onKey()` nine times in nine, `feedbackDir()` eight times in eight.

Flask staying at **0** is the property that matters most: a well-factored
library has no cross-file structural clones, and the surface stays quiet on it.

## Two, not three — a floor tightened and reverted

Spread ≥3 was implemented first and gave tidier counts (15 and 10 groups). It
was reverted after measuring what the panel actually renders: **the top 15 is
identical at spread 2 and 3 on both repos**, because the sort
(`groupSize × maxComplexity`) plus the 15-item cap already handle volume. The
higher floor only trimmed the tail, and on NetBox it was trimming genuine
two-file clones. Tightening a floor to protect a count the cap already protects
is how a surface starts hiding true findings.

It also would have cost 11 test fixtures across 6 files, all of which encode
the reasonable assumption that two files is duplication. They were right.

## The signal had to move with it

`detectDuplicateImplementations` passed an explicit `minComplexity: 5`. Left
alone it would have become cx5 AND spread2 and **silently gone quiet** — 2
groups here, 0 on NetBox. It now uses the panel's defaults so the signal and
the Code tab cannot disagree, and its severity cuts were rescaled 10/5 → 20/10
to preserve their previous meaning. Those cuts are a **calibration, not a
measurement**; the honest severity would key on how much duplicated logic there
is rather than on a group count.

## The cap became visible, so it had to become honest

Replacing the complexity floor made the 15-item cap binding for the first time
— this repo and NetBox both fill every slot, where they previously produced 6
and 8 groups. `summarizeDuplicates` reports `groups.length`, so the header said
"15 groups" when NetBox has 43. `countDuplicateGroups()` now returns the true
figure and the header reads **"15 of 43 groups"**.

That is the same failure as the security rollup saying 25 above a list of 40:
each number defensible alone, together they read as a lie.

## Diagnosed, not built: one idiom fragments into many groups

The structural hash includes arity, so the same boilerplate at different sizes
lands in different groups. Measured:

| | groups | names split across >1 group | share of all groups |
|---|---:|---:|---:|
| this repo | 47 | 3 | 13% |
| **NetBox** | 43 | **4** | **51%** |

NetBox's `search()` splits into **7 groups** of 27, 17, 9, 4, 3, 3, 2 — 65
copies of one Django filterset idiom, competing for seven of the panel's
fifteen slots. Merging them would free nearly half the panel for genuinely
distinct duplication.

Not attempted here because it changes hash semantics, which `driftMetrics`
fingerprints and `structuralDiff` both depend on — and merging by NAME alone
would be wrong, since two unrelated `__init__` are not the same idiom.

---

# Test fixtures: the sessions the brief tests read

```bash
npx tsx bench/makeSessionFixtures.ts     # refresh after the graph changes shape
```

Five test files assert against **real captured analyses** — "agrees on a real
session, not just a fixture", "every subject actually produces something on a
real repo". They read `.gitvision/sessions/<id>.json`, which is gitignored, so
CI had no data and 45 tests failed.

The ten sessions they name are 80 MB live and **2.4 MB gzipped** — a code graph
is mostly repeated key names and compresses about 20:1. They are committed
under `lib/__tests__/fixtures/sessions/` and the helper prefers them, so CI runs
all 93 assertions instead of skipping them.

Two things were tried first and are worth not repeating:

- **A hand-kept list of "fields the tests need"** saved 600 KB and immediately
  broke eight assertions that reach snapshot fields through helpers rather than
  directly. A field list rots every time someone adds a test.
- **Excluding `o5QTmaYTwE`** (this repo) to avoid a self-referential fixture
  made assertions FAIL rather than skip. At 80 KB it is included; a green suite
  is worth more than that tidiness.

**These freeze an analysis.** The engine changed eight times in the session that
built them, so they will drift from what the analyser produces today and the
tests will keep passing while measuring something historical. Re-run the script
when the graph changes shape. `helpers/sessionFixture.ts` still falls back to a
live session when no fixture exists, and resolves it through
`git rev-parse --git-common-dir` so it works from a worktree.
