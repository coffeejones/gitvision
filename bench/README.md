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
