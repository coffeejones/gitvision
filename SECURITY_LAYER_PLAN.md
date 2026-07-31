# Security Layer — scope lock (Phase 0)

> Status: **SCOPE LOCKED (2026-07-28)** — output of a scoping survey, revised twice by
> evidence. Two premises in the original brief were false and are corrected here: (1) the
> brief said "nothing is built yet" — dependency scanning and secret scanning are already
> shipped; (2) the brief named a dogfood repo, "Reprise", that does not exist. A third
> revision came from measurement: reachability on Python currently covers **3–9%** of
> functions, which moves graph work ahead of security rules in the build order.
>
> Working title: *Sentinel* (placeholder). No code written yet.

## 1. Thesis (unchanged)

The deterministic layer is the source of truth. The AI is only a translator. **Reachability
is the differentiator.**

- Deterministic layer finds vulnerabilities. The AI may never invent a finding — if it isn't
  in the deterministic output, it doesn't exist.
- The AI triages and explains findings the deterministic layer already produced. Three jobs:
  is this a true positive given context and reachability; explain it in plain language;
  suggest a fix.
- The call graph proves reachability: is this sink reachable from an entry point that takes
  untrusted input? That filter is what turns an unreadable finding list into a short one.

This is SAST. No live systems are touched. Defensive tool, disclosure-friendly output, never
an exploit generator.

## 2. What already exists (do not rebuild)

| Capability | Where | State |
|---|---|---|
| Dependency CVEs via OSV.dev | `lib/depsHealth/osv.ts` | Shipped. npm/pypi/cargo, resolved dep tree, 4 live signals |
| SBOM export | `lib/sbom/` | Shipped. CycloneDX + SPDX + purl |
| Secret scanning | `lib/security/secretsScan.ts` | Shipped. Severity tiers, redacted previews, confidence-based FP filters |
| Known supply-chain incidents | `lib/security/knownIncidents.ts` | Shipped. Drives `/exposure` |
| Risky patterns | `lib/security/riskyPatterns.ts` | **Regex, not AST.** eval / new Function / exec only, JS+Py only, informational only |
| Findings merge + UI | `lib/security/unifiedFindings.ts`, `components/views/security/` | Shipped. `/session/[id]/security`, status grid + severity-sorted list |
| PR bot | `lib/githubApp/` | Real, but comment format is self-described "thin v1" |
| MCP server | `mcp/` | Real, 10 tools, published as `codetrawl-mcp` |

The original brief's Phase 1 (dependencies) and Phase 2 (secrets) are therefore **complete**.
This project starts at the hard part.

## 3. Locked decisions

| Decision | Choice | Why |
|---|---|---|
| Shape | Module inside CodeTrawl | The panel, the merge layer and the graph already exist |
| Surface | Web panel only (`/session/[id]/security`) | One surface done well; no secondary in v1 |
| Language | **Python** | Chosen over Java after both were argued; see §6 |
| Rules engine | Own tree-sitter rules | A 5th query family (`securitySinks`) beside the existing four |
| Claim model | Two axes: sink class → severity, reachability → confidence | "Exploitable" is not claimed until taint exists |
| No-path handling | **Three states: reachable / unknown / provably-unreachable** | Unknown is the default; only genuine dead code is suppressed |
| Taint ambition | Interprocedural is the destination, not v1 | Reachability first, on rails taint reuses |
| LLM | Anthropic, reusing `aiSummary.ts` + `aiBudget.ts` | Already wired, already budgeted |
| Corpus | RealVuln (26 repos, 796 labelled, 120 FP traps) + a golden Python fixture | Labelled ground truth incl. deliberate false positives |
| First visible state | **Hold the panel until findings are filtered** | Deliberately breaks "every phase ships" — the first thing anyone sees is the good version |
| Cadence | Shippable slices, no calendar | Hours per week vary |

### Architecture invariants

1. **The AI never adds a finding.** Enforced by a test, not by prompt wording.
2. **The engine is a pure function from files to findings.** No DB, no network, no server in
   the core. Persistence and AI layer on top. This is what keeps a future desktop build
   possible — the standard objection to hosted SAST is "I'm not uploading my source," and a
   local build answers it completely. The two things that would break this are the AI layer
   (needs a key) and OSV lookups (leak the dependency list, never source); both sit at the
   edges by design.
3. **Absence of evidence is not evidence of safety.** A sink we cannot trace is `unknown`,
   never `safe`. Same discipline that makes hygiene read `ciHardening` green only on named
   evidence rather than on silence.

## 4. The measurement that reordered the plan

Probe: for every function, could we walk back to an entry point? (Measured as forward BFS
from the entry set over resolved edges. Harness in `.scratch/reachProbe.ts`.)

| repo | framework | own-call resolution | route-like entries | **reach from route-like** | orphans |
|---|---|---|---|---|---|
| VAmPI | Flask | 98% | 1 | **9.1%** | 21% |
| pygoat | Django | 25% | 1 | **2.8%** | 80% |
| fastapi | (library) | 67% | 13 | **5.5%** | 59% |

Only route-like entries count, because only they plausibly carry untrusted input; roots and
orchestrators are internal. **At 3–9% coverage, the three-state rule would file 90%+ of
findings as `unknown`.** Honest, and worthless.

Three independent causes:

1. **The entry-point heuristic is blind to Python web frameworks.** `flowTrace.ts:234` matches
   paths named `route|handler|controller|endpoint|main|cmd|server|app|index` and names like
   `handleX` / `*Handler`. Django routes are `def xss(request)` in `introduction/views.py` —
   `views` is absent from the path list and the names match nothing. Flask's are
   `def get_all_users()` in `api_views/` — the pattern wants a directory named exactly `api`.
   0-for-2 on the frameworks that matter. The heuristic's own comment predicts this and says a
   framework-aware pass "would replace this and should."
2. **Django routing is invisible to the call graph by construction.** `urls.py` wires
   `path('xss', views.xss, name="xss")` — a reference, not a call. View functions therefore
   have zero inbound edges no matter how good the resolver gets. Needs a URLconf reader.
3. ~~**Own-call resolution collapses on class-heavy Python**~~ — **diagnosed, and the premise
   was false.** See §4d. Two earlier explanations in this document were both wrong: missing
   variable-type tracking (`parsePyDirect` has it), and then "cause unknown". The 25% was a
   defect in the METRIC, not the resolver. A separate, real resolver bug turned up in the repo
   nobody was looking at.

### 4a. Routing is declared four different ways, and none of them is a call edge

Discovered while building the first reader — the reason the heuristic could never have worked:

| mechanism | example | seen in |
|---|---|---|
| Decorators | `@app.route("/x", methods=["POST"])` | Flask, FastAPI |
| URLconf table | `path('xss', views.xss)` in `urls.py` | Django |
| OpenAPI spec | `operationId: api_views.users.get_all_users` in YAML | connexion (VAmPI) |
| Registration call | `app.router.add_get("/x", handler)` | aiohttp (dvpwa) |

Only the last is a call edge, and even that one passes the handler as a *reference*. So
"framework-aware entry points" is not one feature — it is a small family of readers behind
one interface (`EntryPointInfo`). Which reader a repo needs is decided by its framework, not
by its language.

### 4b. Results — two readers shipped

Shipped: `EntryPointInfo` + `RouteDeclaration` on the parse types, a route-decorator reader
and a Django URLconf reader in `python.ts`, `applyRouteDeclarations()` in `codeGraph.ts`,
`declaredEntries` + `findDeclaredEntryPoints()` in `flowTrace.ts`. `ANALYZER_VERSION` 5 → 6.

| repo | routing | baseline | + decorators | + URLconf |
|---|---|---|---|---|
| full-stack-fastapi-template | decorators | 36.6% | **59.2%** | 59.2% |
| pygoat | Django URLconf | 2.9% | 8.7% | **82.1%** |
| VAmPI | connexion YAML | 9.1% | 9.1% | 9.1% |

Each reader moves exactly the repo whose mechanism it reads, and nothing else — which is the
mechanism table (§4a) showing up in the numbers. pygoat's declared entry points went 10 → 129
and its orphan functions 74.7% → 11.0%. VAmPI stays flat at 9.1% and will until someone
writes the connexion reader; it is the control.

Caveat on pygoat's 82%: it is a vulnerability lab, so an unusually high share of its functions
genuinely *are* views (129 declared of 173 total). A conventional Django app has a smaller
handler-to-helper ratio and should be expected to land lower.

Two measurement errors were corrected along the way, both of which had made the picture look
worse than it was: the population included a repo's React frontend (125 TypeScript component
functions counted as "unreachable from a Python route"), and the original corpus contained no
repo that used decorators at all.

**Verdict: the approach works, and the remaining gap is per-mechanism, not conceptual.**
Two of three corpus repos now sit where a reachability filter is worth building.

### 4c. Resolution rules for table-declared routes

A table names its handler in another file, so `applyRouteDeclarations` resolves it. Three
narrowing steps, each of which can only REMOVE candidates: functions with that name → files
whose module name matches the qualifier (`apis.ping` must not land on `views.ping`) → files
in the table's own directory (a Django app is one folder).

**If more than one candidate survives, nothing is stamped.** An entry point asserts that
untrusted input reaches a function; guessing between two same-named handlers would invent
reachability, and reachability is what this project suppresses findings with. A decorator on
the handler always beats a table pointing at it — it said the same thing more precisely.

Known misses, all silent-and-safe rather than wrong: `include()` rows (delegate to another
table), class-based views via `MyView.as_view()` (names a class, no class→method mapping
yet), and routes whose path is a variable.

### 4d. The resolution gap: one phantom, one real bug

**pygoat's 25% was a metric artifact.** Of 138 own-code calls, 103 "failed": 74 were `.get()`
(`request.POST.get()`, `request.META.get()`, `Challenge.objects.get()`,
`form.cleaned_data.get()`), 20 were `.save()` on Django ORM objects, 7 were `logger.error/info`.
The repo defines exactly one `get` — `def get(self, request, challenge)` in
`challenge/views.py` — and **none of the 74 calls target it**. The resolver was right to refuse
every one. Genuine misses: 2.

`FlowResolution.ownMissed` counted any unresolved call whose *name* collided with a function
defined anywhere in the repo. Python is worst hit, because `get`, `save`, `error`, `filter`
and `update` are simultaneously ubiquitous library methods and ordinary function names. This
was shipped and user-visible: FlowsView told users "of the 138 calls that point at this repo's
own functions, 25% were traced" — a claim the metric could not support.

**The real bug was on the FastAPI repo.** `from app import crud` → `crud.get_user_by_email(...)`.
The plugin reports `calleeType="crud"`, but `crud` is a *module*, not a class, so no
`containerType` can match — and `hasReceiver` blocked the single-top-level-candidate
fallthrough. Module-qualified calls, the whole point of `from app import crud`, were dropped.

Both fixed:

| | before | after |
|---|---|---|
| pygoat own-call resolution | 25% | **95%** (the 2 real misses) |
| fsft own-call resolution | 93% | **100%** |
| fastapi own-call resolution | 67% | **96%** |
| VAmPI own-call resolution | 98% | **100%** |
| **fsft reachability** | 59.2% | **66.2%** |

The 45 recovered edges on fsft are `route → crud` and `route → security` — spine, not leaves,
which is why 14 unresolved calls were worth 7 points of reachability.

Validated for false positives by diffing every resolved edge before and after:
**spring-petclinic (Java) +0/−0, this repo (TypeScript) +0/−0**, fsft +45/−0, fastapi +6/−0,
pygoat +1/−0. The change is inert in languages that don't report a bare module name as a
receiver type. The guard requires all three of: candidate is top-level, its filename matches
the receiver, and the caller imports that file or one beside it — then exactly one survivor,
or it declines.

*Method note:* the first A/B run reported 66 new TypeScript edges and was **wrong** — the
throwaway feature-flag patch had matched two identical lines and disabled a pre-existing
resolver path as well. The tell was that `calleeType` was `undefined` on the supposedly-new
edges, meaning the new code could not have produced them.

### 4e. Sinks, and the first end-to-end measurement

Nine rules, in `python.ts` beside the route readers (`SinkFinding` → `ParsedFile.sinks` →
`CodeGraph.sinks`): `py-os-command`, `py-subprocess-shell`, `py-eval`, `py-exec`,
`py-pickle-load`, `py-yaml-unsafe-load`, `py-sql-assembled`, `py-tls-verify-disabled`,
`py-weak-hash`.

| repo | sinks | reachable | unknown | module-scope |
|---|---|---|---|---|
| pygoat | 11 | **10** | 0 | 1 |
| VAmPI | 1 | 0 | **1** | 0 |
| full-stack-fastapi-template | 0 | — | — | — |
| fastapi | 0 | — | — | — |

Every pygoat finding is a genuine vulnerability that maps to one of its advertised lessons —
`pickle.loads(token)` in `insec_des_lab()`, `eval(expression)` in `mitre_lab_25_api()`,
`subprocess.Popen(command, shell=True)` in `command_out()`, `login.objects.raw(sql_query)` in
`sql_lab()`. Zero findings on two well-maintained codebases is the other half of the result.

**The three-state rule earned its keep immediately.** VAmPI's one finding is its real SQL
injection, and it lands in `unknown` — not because the finding is weak, but because VAmPI
routes through a connexion YAML spec no reader covers, so no path can be drawn to it. Under
"suppress anything without a path" (§ Section D, the option not taken) that vulnerability
would have been silently hidden.

Two rules needed more than a call-site match to be worth anything:

- **Bounded lookback for SQL.** Real code assembles the query on one line and executes it on
  the next, so a call-site-only rule fires on almost nothing. A same-function lookup of
  locals assigned an assembled string catches pygoat's lab. It is deliberately *not* taint:
  it establishes that a query was BUILT rather than written, and says nothing about whether
  the parts are untrusted. Marking is sticky — if any assignment in the function assembles
  the string, it stays assembled — because branches would otherwise resolve on AST walk order,
  which is arbitrary.
- **`text()` unwrapping.** SQLAlchemy raw SQL is `execute(text(q))`; without unwrapping, VAmPI's
  injection reads as a function call and is missed.

Known misses, all deliberate and documented in the source: `from os import system` then a bare
`system(...)` (needs import aliasing), and any assembly that crosses a function boundary
(that is slice 5).

### 4f. The reachability filter

`classifySinks(codeGraph)` — pure, no I/O, invariant #2 intact. One multi-source BFS from
every entry point with parent pointers, so each sink gets a path without a walk per finding.

**Four states, not three.** The locked scope said reachable / unknown / provably-unreachable;
module-scope earned its own. A sink at module scope runs at import, so it is neither reachable
from a route nor dead, and saying either would be false. The other three are as locked, with
`unknown` the default.

One rule was added after the fact and matters: **`unreachable` is never claimed when the repo
has zero entry points.** With no entry points our readers didn't understand the framework, and
a zero-caller function is exactly what an unread route handler looks like — VAmPI's shape.
Without that guard the filter would confidently bury findings in precisely the repos it
understands least.

Rendered in `/session/[id]/security`: a fourth status tile ("Code paths — N reachable, traced
from M entry points"), and finding rows carrying severity and reachability as **separate**
axes plus the path itself. Only proven reach counts toward the high rollup — an unresolved
path is a gap in our readers, not a claim about the code, and letting it inflate the headline
would undo the filtering. `unreachable` findings are the one class demoted out of the list.

Verified in the browser against a session carrying real classifier output from pygoat:
`POST /deserialize → deserialize_data()`, and the multi-hop
`ANY mitre/17/lab/api → mitre_lab_17_api() → command_out()`. The page's "Three deterministic
scanners" line was stale on arrival and now says four, plus what a traced path does and does
not mean.

### 4g. Three large real Django/Python apps — and what they say about the thesis

The lab corpus couldn't test the premise, so: Zulip (2,012 `.py`), Saleor (4,196), NetBox (1,212).

| repo | functions | entry points (declared) | reach | sinks | reachable | unknown | unreachable |
|---|---|---|---|---|---|---|---|
| zulip | 6,913 | 592 (146) | 26.0% | 25 | 9 | 6 | **10** |
| netbox | 2,400 | 112 (**0**) | 8.8% | 5 | 1 | 2 | 2 |
| saleor | 6,985 | 84 (4) | 12.6% | 3 | 2 | 1 | 0 |

Four findings, and the first one is uncomfortable.

**1. "400 findings → 6" does not describe this tool.** Real codebases produce **3 to 25** sinks,
not 400. That number comes from scanners with hundreds of rules; nine conservative ones with
tight discriminators produce a short list before any filtering. On Zulip the filter does real
work — 10 of 25 demoted as unreachable, 40% — but the headline the original brief imagined
isn't available at this rule count. Two honest ways forward: add many more rules and let
reachability do the suppression it was designed for, or accept that the value here is
precision-by-construction and stop quoting a ratio nobody's corpus produces.

**2. `py-weak-hash` is the noise.** 19 of Zulip's 25 sinks, and essentially all of them are
SHA-1/MD5 for **cache keys and gravatar hashes** — legitimate non-cryptographic uses. The rule
is honestly *labelled* (it is a weak hash) but its actionable rate is near zero, and it drowns
the list. Candidates: drop it, or leave it to AI triage in slice 4. Product call, not a code
call.

**3. NetBox found ZERO declared entry points — a fifth routing mechanism.** Every route is
`path(..., include(get_model_urls(...)))`, where the URL list is *generated at import time*
from a registry populated by **1,142 `@register_model_view(...)` decorators**. No static reader
can resolve that; the paths do not exist until the code runs. Related and bigger: NetBox and
Saleor are **class-based-view** codebases, and the entry-point machinery marks functions.
Zulip scores well precisely because it is function-view-based. CBVs are not an edge case in
large Django — they are the norm, and they are the single biggest gap in the reader set.

**4. Running on real code found a real false positive.** Zulip's only reachable high-severity
finding was `query += sql.SQL(...).format(field=sql.Identifier(f))` — psycopg2's composition
API, which exists to build dynamic SQL *safely*. The `+=` rule marked any augmented-assignment
target as assembled without looking at what was appended. Now it requires text: an assembled
expression or a bare name counts, a call or a plain literal does not. Zulip 5 → 4 SQL findings,
and the wrong one is the one that went.

Reach of 26% on Zulip against 83% on pygoat is not a regression: a real app has migrations,
management commands, workers and libraries that genuinely aren't behind a route.

### 4h. `py-weak-hash` dropped, and class-based views

**`py-weak-hash` is gone.** It was 19 of Zulip's 25 findings and essentially all of it was
cache keys and gravatar hashes. The rule was honestly labelled and still drowned the list.
Zulip's sink count fell 25 → 6, and with it every "reachable" finding it had — which is the
correct answer for a well-maintained codebase, not a regression.

**Class-based views**, the mechanism that made large Django invisible. Two readers added:
`views.MyView.as_view()` rows, and DRF `router.register('sites', views.SiteViewSet)` — gated on
the `ViewSet` naming convention, because `register` is also what signal handlers, plugin
registries and admin sites call.

Resolving a class target is not the same as resolving a function. The entry point is not the
class, it is the methods the framework invokes on it (`get`/`post`/`dispatch`, and DRF's
`list`/`create`/`retrieve`/…), which nothing in the repo calls. And a registered class is
routinely pure configuration — `class WirelessLANViewSet(NetBoxModelViewSet)` declaring only
`queryset` and `serializer_class` — so the resolver climbs the inheritance chain to the nearest
repo-defined ancestor that actually defines handlers.

| repo | entry points before | after | declared | reach before | after |
|---|---|---|---|---|---|
| netbox | 112 | **137** | 0 → **39** | 8.8% | **13.5%** |
| pygoat | 130 | 134 | 129 → 133 | 82.7% | 85.5% |
| zulip | 592 | 592 | 146 | 26.0% | 26.0% |
| saleor | 84 | 84 | 4 | 12.6% | 12.6% |

Zulip and Saleor are unchanged and should be: Zulip is function-view-based, and Saleor is
GraphQL with essentially no Django views at all — which is also why its 84 entry points are
almost entirely heuristic.

**Two limits, and one of them is not fixable here.**

1. *Mixin-first multiple inheritance breaks the chain.* `ParsedClass` carries one parent, the
   first non-ABC name, so `class NetBoxModelViewSet(ETagMixin, mixins.CustomFieldsMixin, …)`
   walks into the mixin. Fixable — carry all bases — but it touches ParsedClass, ClassDef and
   the Architecture tab, so it is its own change.
2. *DRF owns the dispatch.* Only 31 classes in all of NetBox define `list`/`create`/`retrieve`;
   the rest live in DRF itself. There is nothing of ours to mark, and inventing an entry point
   would be worse than the miss. Sinks in DRF hook methods land in `unknown` — visible, not
   suppressed, which is the correct behaviour.

That caps NetBox at 39 declared entry points against 223 registrations, and the ceiling is
structural rather than a bug.

### 4i. The mixin fix — and the ceiling it turned out not to be

`ParsedClass.baseClasses` now carries EVERY base in source order (`parentClass` unchanged, so
class diagrams are untouched), and the entry-point walk is breadth-first over all of them,
stopping at the first level that defines handlers. Where a plugin hasn't adopted the field the
walk falls back to `[parentClass, ...implements]`, which gives Java/C#/PHP the same multi-base
traversal for free.

It works — `NetBoxModelViewSet`'s twelve bases are all captured — **and it moves this corpus
not at all.** NetBox stayed at 39 declared entry points. The chains here find their handlers
at the first base anyway; mixin-first ordering was a hazard I could construct a test for, not
one the corpus was actually hitting. Predicted ceiling, wrong ceiling. Kept because it is
correct and cheap, and because the next Django codebase may well need it.

**The real ceiling is node identity.** 224 route declarations resolve to **99 marked
functions**, which collapse into **41 flow-graph nodes**, because `flowNodeId` is
`(file, function name)`:

```
get() in netbox/account/views.py  ←  LoginView, LogoutView, ProfileView,
                                     UserConfigView, ChangePasswordView, UserTokenListView
```

Six classes, one node. For class-based codebases — where `get`, `post`, `list` and `retrieve`
repeat throughout a single file — this collapses both the entry-point count and the precision
of every path through them. A sink in `LoginView.get()` and one in `ProfileView.get()` are
currently indistinguishable to the walk.

`flowTrace.ts` documents the reason: node ids had to match what call edges could address, and
edges resolved to `(file, function)`. **That is no longer true** — `CallEdge` has carried
`fromContainerType` and `toContainerType` since v0.44/v0.28, so container-qualified ids are now
constructible. It is a change to the identity of every node in the graph, so it affects Flows,
blast radius and the reach diagrams as much as security. Its own piece of work, and the one
that would actually raise NetBox's number.

### 4j. More rules — and the trap they walked into twice

§4g said nine rules were too thin for reachability to have work to do, so: five added
(`py-ssti`, `py-mark-safe`, `py-jwt-unverified`, `py-debug-server`, and `marshal` folded into
the deserialisation rule).

The first pass added `py-csrf-exempt` too, and it went straight into the `py-weak-hash` trap —
30 of Zulip's 42 findings. Looking at them: `@csrf_exempt @require_POST @typed_endpoint` on
token-authenticated API endpoints, an unsubscribe view guarded by a confirmation key, a Sentry
tunnel. CSRF exemption on an endpoint that does not use cookie auth is **correct design**.
Dropped.

`py-mark-safe` walked into the same trap from a different direction and took three passes to
land:

| pass | rule | NetBox | Zulip |
|---|---|---|---|
| 1 | argument is not a string literal | 32 | 6 |
| 2 | + must be assembled or a bare name | 33 | 1 |
| 3 | + every interpolation escaped ⇒ safe | 31 | 1 |
| 4 | + bare name only if assembled in this function | **25** | **0** |

Pass 1 flagged `mark_safe(_("Values must match <code>{regex}</code>"))` — gettext-wrapped
constants. Pass 3 stopped flagging `mark_safe(f'<a href="{escape(v)}">{escape(v)}</a>')`, the
documented safe form. Pass 4 reused the SQL rule's same-function lookback so `mark_safe(html)`
counts only when `html` was built here.

**The lesson, stated once so it does not have to be relearned: a rule that flags a PATTERN
rather than a dangerous DATA FLOW produces volume without actionability.** `weak-hash`,
`csrf_exempt` and loose `mark_safe` all share the shape — the syntax is present, but whether
it is a vulnerability depends on what flows through it, which is taint, not pattern matching.
The rules that survived scrutiny are the ones where the operation is dangerous regardless of
input (`eval`, `pickle`, `yaml.load`, `shell=True`, unverified JWT) or where the discriminator
already encodes dynamism (`sql-assembled`, `ssti`, narrowed `mark_safe`).

Where the corpus landed:

| repo | sinks | reachable | unknown | unreachable | module-scope |
|---|---|---|---|---|---|
| pygoat | 11 | 9 | 0 | 0 | 2 |
| netbox | 30 | 3 | 11 | 10 | 6 |
| zulip | 6 | 0 | 1 | 5 | 0 |
| saleor | 2 | 0 | 2 | 0 | 0 |
| VAmPI | 2 | 0 | 1 | 0 | 1 |

NetBox's remaining 25 `mark_safe` findings are f-strings with unescaped interpolations in
table-rendering code. Genuinely ambiguous XSS territory that only taint resolves — left
visible rather than guessed at either way.

### 4k. Intraprocedural taint — what it proves, and where it stops

`TaintEvidence` on `SinkFinding`: which untrusted expression reached the call, the line it
entered, and the local that carried it.

- **Sources**: any path segment `request.*` (Django, Flask and DRF all name it that, including
  `self.request` in class-based views), `sys.argv`, `sys.stdin`, `os.environ`, `input()`, and
  a declared route handler's own parameters — FastAPI has no request object, the parameters
  ARE the input.
- **Propagation**: assignment, f-string interpolation, `+` and `%`, `.format()`, subscript and
  attribute access, and method calls on a tainted receiver (`value.strip()` stays tainted).
- **Sanitisers end the flow**: `int`, `float`, `escape`, `conditional_escape`, `quote`,
  `urlencode`, `UUID` and friends. Anything not on the list keeps the taint.

Ranking is now reachability → **taint** → severity. Taint outranks severity on purpose: "this
codebase feeds untrusted input to this call" is a demonstrated fact, while severity is a
property of the operation's class. A tainted medium is a described vulnerability; an untainted
high is a dangerous call nobody has been shown able to reach.

On pygoat it traces the real thing, three hops:

```
request.POST (line 150) → name → sql_query → login.objects.raw(sql_query) (line 162)
```

8 of 11 findings tainted. And on real applications:

| repo | sinks | tainted |
|---|---|---|
| pygoat | 11 | **8** |
| netbox | 30 | **0** |
| zulip | 6 | **0** |
| saleor | 2 | **0** |
| VAmPI | 2 | **0** |

**Zero out of forty.** Not a bug — the definition of the slice. A lab puts
`request.POST.get()` and the sink in one function; real code puts a view, a service and a
repository between them. VAmPI's SQL injection takes `username` as a parameter of a static
method the route handler calls. Zulip's is in `do_update_user_presence(...)`, several layers
below any view. NetBox's `mark_safe` calls take `value` as a method parameter.

So the honest summary of slice 5: it proves the machinery works, it is worth having, and it
answers approximately nothing on production code by itself.

**One architectural finding, which decides how slice 6 is built.** Taint currently lives in
the plugin walk, but a URLconf- or CBV-declared handler gets its `entryPoint` stamped in
`buildCodeGraph`, cross-file, long AFTER parsing. The plugin therefore cannot taint those
handlers' parameters — only decorator-declared ones. The same layering that forced routing to
be resolved at the graph level forces taint there too: **interprocedural taint cannot be a
plugin feature.** It belongs beside `classifySinks`, walking the same call graph reachability
already walks, with per-function summaries (which parameters flow to which sinks and returns)
stitched over the resolved edges.

### 4l. Interprocedural taint

Built where §4k said it had to be: beside `classifySinks`, on the same resolved call graph,
**not** in the plugin. The plugin contributes two halves that are worthless alone —

  - *"this call passes `request.POST['cmd']` as argument 0"* (`CallEdge.taintedArgs`)
  - *"this sink consumes my parameter `cmd`"* (`SinkFinding.taintedByParam`)

— and the graph pass decides whether argument 0 of that call actually IS that parameter. A
parameter is not untrusted because it is a parameter; it is untrusted when somebody fills it
with user input, and only the graph knows if anybody does.

The pass also seeds a declared route handler's own parameters, which slice 5 structurally
could not: a plugin looking at `def search(request, q)` cannot know it is a route handler,
because the URLconf saying so is in another file.

Same discipline as everywhere: resolved edges only, decline on ambiguity, six-hop cap, and the
shortest itinerary wins.

**A real bug fell out of building it.** Tree-sitter's `typed_parameter` — `def f(x: str)` —
carries no `name` field, only an anonymous identifier child. Reading the field returned null,
which silently skipped every annotated parameter and so disabled taint across all typed
Python. Zulip recorded parameters for **1,220 of 21,274** functions; after the fix, **6,517**,
and its sinks awaiting a parameter went 0 → 5.

| repo | sinks | tainted (slice 5) | tainted (slice 6) |
|---|---|---|---|
| pygoat | 11 | 8 | **9** |
| netbox | 30 | 0 | **1** |
| zulip | 6 | 0 | 0 |
| saleor | 2 | 0 | 0 |
| VAmPI | 2 | 0 | 0 |

Modest, and the reasons are structural rather than fixable by tuning:

- **NetBox**: 12 sinks wait on a parameter, 1 connects. The other 11 are django-tables2
  `render(self, value, record, table)` methods — invoked by the framework, so no caller in the
  repo passes anything into them. The same wall as DRF owning viewset dispatch (§4h).
- **Zulip**: 5 sinks wait on a parameter and none is fed untrusted input by any resolved
  caller. That is a plausible true negative for a codebase this well maintained, not a gap we
  have evidence of.
- **VAmPI**: still needs the connexion reader before anything can be seeded at all.

The recurring limit across §4h, §4i and here is one thing said three ways: **where a framework
owns the dispatch, the repo contains only the handler bodies, and static analysis of the repo
cannot see who calls them.** That is not an argument for more taint work — it is the boundary
of what analysing this repository can establish.

### 4m. End-to-end test — the seam runs, and it found one bug

The one thing never executed was `classifySinks` inside the real `analyzeRepo` pipeline. Run
for real (GitHub fetch → tarball → extract → analyze → classify → snapshot), against the
compiled build the MCP server ships:

| repo | via analyzeRepo | matches the probe? |
|---|---|---|
| pygoat | 11 sinks, 134 entry points, 9 reachable, 9 tainted, 11.6s | yes, exactly |
| netbox | 30 sinks, 137 entry points, 3 reachable, 1 tainted | yes, exactly |

NetBox at 11.6s clears the pipeline's 25s `CODE_ANALYSIS_TIMEOUT_MS`. Both snapshots were then
written as real sessions and opened in the panel.

**The bug it found.** NetBox's strongest finding — `mark_safe` fed `request.POST` across two
functions AND traced from a route — ranked BELOW two `exec()` calls with no path to them at
all, because `exec` is high and `mark_safe` is medium. `classifySinks` ranks correctly;
`buildUnifiedFindings` then re-sorted on severity alone and threw the reachability work away at
the last step. Nothing unit-testable had caught it, because each half was right on its own.

Fixed with an evidence tier ahead of severity: reachable-and-tainted, then reachable, then
everything else, with severity ordering inside each tier. The list header said "Sorted by
severity" and now says what it actually does. Three tests pin it.

Note for whoever reads the panel next: session creation is auth-gated, so this was driven
through `analyzeRepo` directly rather than the HTTP route. The auth and HTTP layers are
untouched by this work; the seam under test was the analysis pipeline.

### 4n. Disclosure surface — the "#1" layer, wired into the panel

The engine (§4m predecessor, `lib/security/disclosure.ts`) now has a UI:

- `POST /api/sessions/[id]/security/disclose` — same gate stack as the Source
  explainer (AI configured → AI rate-limit bucket → session → read access →
  auth → finding exists AND is reachable → in-memory cache → daily budget →
  generate). Re-classifies from the graph rather than trusting the client, so a
  report can only be asked for on a real deterministic finding.
- `DisclosureButton` — one button per REACHABLE sink row; reveals the report
  inline. Private repos get the same one-time consent the explainer uses, since
  the flagged line is private source.

**The structural gate is in the route, not a checkbox:** ownership is hardcoded
to `third-party`, and the client cannot override it. The hosted endpoint is
therefore incapable of emitting a concrete payload for anyone's code. The
`owned` calibration — the concrete PoC sketch — is reserved for the desktop
build (where by construction you run your own uploaded project) or a future
verified-ownership signal. This is the split from the vision, enforced in code.

Verified in the browser against pygoat: the button renders on exactly the 9
reachable findings and nowhere else; a click runs the full client → route →
gate path; the gate progression is correct (no key → "not set"; key present →
"sign in"). The happy-path report render sits behind the auth gate, which is
pre-existing infrastructure, not this work — the engine's real output was
verified live earlier, both calibrations.

That closes "#1". "#2" — local dynamic confirmation on your own uploaded
project — remains the desktop pillar: quarters of work, its own hard problems
(booting an arbitrary project, sandboxing, the confirmation oracle).

### 4n. RealVuln — measured against Semgrep, SonarQube and Snyk

The corpus we chose in scope, finally run. 23 of the 26 canonical `realvuln-*` repos
(3 had dead/renamed URLs — 63 vulns, 13 traps unrecoverable), each cloned at its pinned
commit, scored with RealVuln's OWN matcher (`scorer.matcher.match_findings`, ±10-line window,
CWE-in-acceptable-set) so the numbers are directly comparable to their leaderboard.

Like-for-like on the same 23 repos (107 deliberate false-positive traps):

| scanner | precision | recall | F3 | TP | FP | **traps hit** |
|---|---|---|---|---|---|---|
| **CodeTrawl** | **0.951** | 0.120 | 0.132 | 77 | 4 | **0 / 107** |
| Semgrep | 0.273 | 0.193 | 0.199 | 124 | 331 | 4 |
| Snyk | 0.411 | 0.179 | 0.190 | 115 | 165 | 3 |
| SonarQube | 0.615 | 0.062 | 0.069 | 40 | 25 | 1 |
| kolega-devsec (LLM) | 0.346 | 0.824 | 0.724 | 528 | 1000 | 11 |

**The thesis, measured.** CodeTrawl has the highest precision of every rule-based tool here —
0.95 against Semgrep's 0.27, Snyk's 0.41, SonarQube's 0.62 — and is the **only** scanner that
flagged **zero** of the 107 traps. Semgrep hit 4, Snyk 3, SonarQube 1, the recall-maximizing
LLM scanner 11. In raw noise: Semgrep emits 455 findings, 73% of them false; CodeTrawl emits
81, 5% false. That is "400 findings nobody reads → the handful people act on," as a number.

**The cost is coverage, by design.** Overall recall is 0.12 because we target ~6 of 18+ CWE
families. On the injection / code-execution / deserialization families we actually built rules
for, recall is **~59%** (54/92: sql 27/41, command 9/18, code-exec 7/12, deserialization 9/16,
ssti 2/5) — competitive with any rule-based tool, at a fraction of the noise. Outside that:
near zero, and honestly so. The single biggest in-scope gap is XSS (0/79) — `py-mark-safe` is a
weak stand-in and RealVuln's XSS is template-level (`{{ }}` in `.html`), which we don't parse.

**The reachability filter's cost is visible here too.** "Surfaced" (what the panel shows,
dropping `unreachable`) scores 64 TP vs. detection's 77 — the filter demotes 13 real vulns as
unreachable on these tiny CTF apps, where the entry-point readers cover fewer frameworks. On
the large real apps earlier it demoted correctly; on toy apps it over-demotes. A real trade-off
to keep measuring, not a bug.

Caveats kept on the record: 23/26 repos (dead URLs); the peer tools are scored from the
benchmark authors' own scan outputs (their configs, one run), matched identically to ours.

**Bottom line for the value claim:** the number to put next to SonarQube is **95% precision,
0 / 107 traps** — the quietest, most trustworthy scanner in the comparison, at the cost of
being a focused injection/RCE detector rather than a general-purpose one.

### 4o. Template XSS — closing the biggest measured gap

§4n named XSS (0/79) as the single largest in-scope hole, and diagnosed why: the XSS lives in
TEMPLATE files (`.html`, `.jinja2`), not in the Python AST the plugins parse. `lib/security/
templateScan.ts` scans them, wired into `analyzeDirectory` so `codeGraph.sinks` is complete for
every consumer.

Two rules, chosen from what the ground truth actually labels (calibrated against RealVuln, not
guessed):

- **`py-template-safe-filter`** — `{{ x | safe }}`. The `safe` filter disables the engine's
  auto-escaping; it is the template equivalent of `mark_safe`, a deliberate escape-off shared
  by Django and Jinja. `\bsafe\b` so `safely` / `safe_html` don't match. `csrf_token` is
  excluded (a framework value, not user input) — the one unambiguous FP source.
- **`py-template-autoescape-off`** — `{% autoescape off %}` / `{% autoescape false %}`.

**Deliberately NOT flagged: a bare `{{ x }}`.** In an auto-escaping template (the default) that
is safe, and flagging it would wreck precision. The cases where a bare interpolation IS XSS
depend on `autoescape=False` set in Python config (a cross-file read we don't do) — a
documented miss.

Reachability: a template sink is `unknown` — no function, no call edge, no view→template
linkage yet. Surfaced, never suppressed, never mislabelled module-scope.

Re-measured on the same 23 repos:

| | before | after |
|---|---|---|
| true positives | 77 | **97** (+20) |
| precision | 0.951 | **0.924** |
| reflected_xss | 0/44 | 13/44 |
| stored_xss | 0/24 | 7/24 |
| in-scope recall | 0.363 | **0.458** |
| **traps hit** | 0/107 | **0/107** |

+20 real XSS at a 3-point precision cost, traps still perfect. The residual XSS gap is bare
`{{ }}` under config-level autoescape (needs a Jinja-config reader) and DOM XSS in `.js`
(a JavaScript sink, separate). Both are honest, documented misses — not noise we chose to add.

### 4p. Two measurement-driven extensions

With RealVuln in hand, the next work was chosen from the recall-by-class table rather than
guessed. Two extensions, both reusing existing machinery, both gated on the measurement holding
precision + zero traps.

**SQL recall — parenthesized / concatenated assembly.** dvpwa builds
`q = ("INSERT ..." "VALUES ('%(n)s')" % {...})` — the whole RHS parenthesised, with adjacent
string literals — and `isAssembledString` unwrapped neither. Now it unwraps
`parenthesized_expression` and accepts `concatenated_string` on either side of `+`/`%`. Our
strongest class, zero precision risk.

**Reflected XSS in Python.** The biggest single in-scope gap was reflected_xss, and much of it
is *not* in templates — it is a Python view building an HTML response from request data
(`HttpResponse(f"<p>{request.GET['q']}</p>")`). New `py-reflected-xss` rule on the HTML-defaulting
response constructors (Django `HttpResponse*`, Flask `Response`/`make_response`). **Taint is
REQUIRED** — "an assembled HTML response" is far too broad, so the rule fires only when the value
provably carries untrusted input. That is what keeps it precise.

Cumulative on the same 23 repos, across this session's three additions (template XSS → SQL →
reflected XSS):

| | start | template XSS | + SQL | + reflected XSS |
|---|---|---|---|---|
| true positives | 77 | 97 | 98 | **101** |
| precision | 0.951 | 0.924 | 0.925 | **0.927** |
| in-scope recall | 0.363 | 0.458 | 0.462 | **0.476** |
| traps hit | 0/107 | 0/107 | 0/107 | **0/107** |

+24 real vulnerabilities this session, precision still 92.7%, still zero of 107 traps. The
reflected-XSS rule even nudged precision UP — its taint requirement added only true positives.

### 4q. Hardcoded secrets — the biggest single win

The largest out-of-scope family in §4p's gap table (58 vulns, zero coverage): framework signing
keys and credentials committed as literals. New `py-hardcoded-secret`, assignment-shaped:

    SECRET_KEY = 'lr66%-a!$km5ed@...'      module-level name
    app.secret_key = 'super secret key'    attribute target
    app.config['SECRET_KEY'] = 'dvga'      subscript target
    jwt.encode(payload, 'literal')         literal signing key (call-shaped)

**Why the shipped `secretsScan` did not already cover this.** That scanner hunts HIGH-ENTROPY
API keys and private-key blocks. `SECRET_COOKIE_KEY = "PYGOAT"` is low-entropy *by construction*
— which is precisely why it is a finding, and precisely why an entropy scanner cannot see it.
A different rule class, not a wiring gap.

**Precision was designed against the corpus's own traps**, all three of which this rule must
not hit:

| trap | why it isn't a finding | how we avoid it |
|---|---|---|
| `CONFIG = {'app_name': ...}` | benign dict literal | match the assignment TARGET, never a dict key |
| `reviewer_data = (112, …, "auth_token")` | the word is the VALUE | never match string CONTENTS |
| `USER_A7_LAB3 = {"password": "<sha256>"}` | hashed demo data | target name is benign; a key-matching rule would fire |

One decision does all three: **match only the assignment target's name.** And the value must be
a plain string literal — a call or subscript (`os.environ["SECRET_KEY"]`) is config being read,
the correct pattern, and never flagged.

`KEY` and `USERNAME` are deliberately excluded as too generic, costing a couple of true
positives to protect the trap record.

| | before | after |
|---|---|---|
| true positives | 101 | **135** (+34) |
| precision | 0.927 | **0.925** |
| in-scope recall | 0.476 | **0.551** |
| overall recall | 0.158 | **0.211** |
| traps hit | 0/107 | **0/107** |

The biggest single jump of the project, at no precision cost. All three new "false positives"
are real hardcoded secrets the ground truth simply did not label at those exact lines
(`app.config["JWT_SECRET_KEY"] = 'dvga'`, and two `jwt.decode` calls sharing the literal GT
labelled only on the `encode` line) — so true precision is higher than 0.925.

### 4r. Path traversal + SSRF — and the rule class they forced us to invent

Both are taint-shaped, so they reused the `py-reflected-xss` pattern. The naive version cost
the project its first trap hit, and the fix is the interesting part.

**Naive attempt:** `open(tainted)` → path traversal, `requests.get(tainted)` → SSRF, accepting
either real-source taint or parameter-derived taint (as every earlier rule does).

| | before | naive | fixed |
|---|---|---|---|
| true positives | 135 | 144 | **139** |
| false positives | 11 | 20 | **11** |
| precision | 0.925 | 0.878 | **0.927** |
| **traps hit** | 0/107 | **1/107** | **0/107** |

Two distinct causes, both instructive:

**1. A plain bug.** `session` was in the HTTP-client receiver set, so SQLAlchemy's
`session.delete(row)` was reported as SSRF. `session` is a database session far more often than
an HTTP one — the same over-generic-name mistake as `weak-hash` and `csrf_exempt`. Removed.

**2. A new rule class: `requiresTaint`.** The remaining false positives were `open(filename)` and
`requests.get(url)` inside *utility scripts*, where the "taint" was only a bare function
parameter. The trap we hit was vulnpy's `get_template(path)` — genuinely traversal-shaped, but
the ground truth notes every caller passes code-controlled values.

That exposed a distinction the rule set had never needed to make:

- **Dangerous in itself** — `eval`, `pickle.loads`, an assembled SQL query. Worth surfacing even
  unproven, because the operation is a problem regardless of what reaches it.
- **Dangerous only with untrusted input** — `open()` and `requests.get()` are among the most
  common calls in Python and appear constantly in ordinary code. Without confirmed taint they
  are noise.

`SinkFinding.requiresTaint` encodes it: the finding is emitted by the plugin, then **dropped by
`classifySinks` unless taint survives the interprocedural pass**. A parameter later shown to be
fed request data survives; a helper nobody feeds does not. Placing the filter after slice 6 is
what keeps the genuine cross-function cases.

One ordering fix fell out: `verify=False` is now checked before SSRF. A call can be both, a rule
returns one hit, and an unconditional config fact should beat a taint-dependent inference.

Net: +4 true positives, precision UP from 0.925 to 0.927, trap record intact.

### 4s. Security misconfiguration — and one rule that didn't earn its place

The last of the §4p "pile 1" families (66 vulns, and notably **zero traps** in this class).
Four rules were built; three shipped.

**Shipped** — all assignment- or kwarg-shaped, matched on the target name, same discipline as
the secret rule:

- `py-debug-enabled` — `DEBUG = True`, `app.debug = True`. Included deliberately even though it
  is Django's own generated default: shipped that way it leaks tracebacks and, on Flask, a
  remote console. Being a common default is what makes it worth reporting.
- `py-wildcard-allowed-hosts` — `ALLOWED_HOSTS = ['*']`.
- `py-autoescape-disabled` — `autoescape=False` in a template environment. **This is the other
  half of the template XSS story**: §4o documented bare `{{ }}` as a miss precisely because
  autoescape is configured in Python, and this is that configuration.

**Dropped: `py-insecure-cookie-flag`** (`set_cookie(..., secure=False)`). Measured at **1 true
positive against 3 false positives** — the flag alone doesn't establish the cookie carries
anything worth protecting, so it fires where it is irrelevant. The rule is right in principle
and needs a discriminator (session/auth cookie names, or taint on the value) before it earns a
place. Kept out rather than shipped at a 1:3 ratio.

| | before | with cookie rule | shipped |
|---|---|---|---|
| true positives | 139 | 148 | **147** |
| false positives | 11 | 16 | **13** |
| precision | 0.927 | 0.902 | **0.919** |
| in-scope recall | 0.558 | 0.587 | **0.586** |
| traps hit | 0/107 | 0/107 | **0/107** |

Per-rule contribution made the call obvious: debug 13 TP / 2 FP, the CWE-16 pair 3 TP / 0 FP,
cookies 1 TP / 3 FP.

### 4t. Pile 2 — DOM XSS, and the security layer stops being Python-only

Until now every JavaScript or TypeScript repository analysed returned zero security findings.
Not "clean" — **unexamined**. `js-dom-xss` and `js-eval` in `javascript.ts` are the first
non-Python sinks, built with the same taint discipline the Python rules arrived at the hard way.

- **Sources**: `location.search/hash/href`, `document.URL/referrer`, `window.name` — the
  attacker-controllable parts of the browser environment.
- **Sinks**: `innerHTML`/`outerHTML` assignment, `document.write(ln)`, `insertAdjacentHTML`
  (second argument — the position is the first), jQuery `.html()`, and `eval`.
- **Propagation** through assignment, template literals and `+`; sanitisers
  (`encodeURIComponent`, `DOMPurify.sanitize`, `Number`) end the flow.

**Taint is required, and that is the whole design.** `el.innerHTML = x` is one of the most
common lines in front-end code and is usually harmless. Flagging it unconditionally is the
precision disaster this project has walked into three times.

**The measurement that matters is not RealVuln.** That corpus is Python: it contains 3 JS XSS
findings, of which this catches 1 (the other two are a jQuery selector and a `fetch` response —
neither is a DOM source). +1 TP, no new FPs, traps still 0/107.

The result worth having is the negative one:

| codebase | JS findings |
|---|---|
| this repo (~1,200 TS files) | **0** |
| full-stack-fastapi-template React frontend | **0** |
| dsvpwa (`document.write(location.hash)`) | 1 — correct |

Zero false positives on two real TypeScript codebases is what makes the rule shippable, and it
is the reason to build it: CodeTrawl's users are heavily JS/TS, and the security panel was
silent on all of them.

*Side effect worth noting:* the landing page quotes `lookupVariableType` from `javascript.ts`
at a pinned line number, and a lockstep test caught the line moving. Re-pinned 696 → 816. The
test did exactly what it was written for.

## 5. Build order

Reordered by §4. Slice 1 is graph work, not security work — and it pays for itself across
Flows, blast radius and the reach diagrams, so it is not security-only spend.

**Slice 1 — Make reachability mean something in Python.** *(the gate)*
Framework-aware entry points, one reader per mechanism (§4a). Ship nothing user-visible.

- **1a — decorators (Flask/FastAPI). DONE.** 36.6% → 59.2% on a decorator-based app; see §4b.
  10 plugin tests + 5 flowTrace tests, full suite green (2054).
- **1b — Django URLconf reader. DONE.** 2.9% → 82.1% on pygoat; see §4b and §4c.
  9 resolver tests + 8 plugin tests, full suite green (2071).
- **1c — resolution diagnosis. DONE.** No resolver gap existed where the doc said there was
  one; a real one existed elsewhere. Both the metric and the module-qualified bug are fixed —
  see §4d. 10 tests, full suite green (2081).
- **1d — remaining, decide by measurement.** The connexion/OpenAPI reader (VAmPI is still the
  9.1% control), an aiohttp registration-call reader, class-based Django views (`as_view()`).
  Or stop here: two of three repos are at 66% and 83%, which is enough to build a filter on.

**Slice 2 — Sinks. DONE.** ~~A `securitySinks` query family in `parse.ts`~~ — that approach
was wrong: Python parses via `parseDirect` and never touches the query pipeline, so a fifth
query family would have done nothing for it. Sink recognition lives in the plugin's walk,
beside the route readers. See §4e. 19 tests, full suite green (2100). Still not user-visible.

**Slice 3 — Reachability filter. DONE.** `lib/security/reachability.ts` — `classifySinks()`
plus the panel integration. **The differentiator, and the first user-visible slice.** See §4f.
17 tests, full suite green (2117).

**Slice 4 — AI triage + explanation.** Deterministic finding + code context + reachability
path in; `{verdict, confidence, explanation, suggested_fix}` out. Hard test that the AI cannot
introduce a finding absent from the input.

**Slice 5 — Intraprocedural taint. DONE.** Source→sink within one function, attached as
`SinkFinding.taint`. See §4k — it fires on 8 of pygoat's 11 sinks and on **none** of 40
findings across four real applications, which is the measured case for slice 6.

**Slice 6 — Interprocedural taint. DONE.** `lib/security/interproceduralTaint.ts` — a
summary-based fixpoint over the resolved call graph, run inside `classifySinks`. See §4l.
12 tests, full suite green (2161).

## 6. Decisions taken against a recommendation

Recorded so they aren't silently relitigated.

- **Python over Java.** Java was recommended: OWASP Benchmark gives 2,740 labelled cases with
  an official scorecard; the author writes Java (10+ repos); `TheDeckForge` is a real Spring
  dogfood; `java.ts` already tracks variable types. Python was chosen anyway — it is where
  AI-adjacent codebases live, its dangerous idioms are genuinely common, and RealVuln closes
  most of the corpus gap. **Java was never measured**; the §4 numbers are Python-only, and the
  comparison remains measured-vs-assumed.
- **Dogfood corpus is vulnerable apps only.** Consequence: the false-positive rate on real
  code stays unmeasured until real-repo sweeps are enabled. `graph-precision` already has the
  machinery.
- **No repo of the author's own is a Python dogfood.** There is no Python app in the account,
  so the "found a real bug in my own code" story is unavailable in this language.

## 7. Non-goals

- Any claim of exploitability before taint analysis exists.
- Semgrep in v1 (revisit for breadth once the filter can suppress its noise).
- A CLI or GitHub Action surface. The `codetrawl scan ...` commands in the original brief do
  not exist; `npm run analyze` is a dev script.
- Diff-scoped findings on PRs (needs baseline comparison — a separate correctness problem).
- Languages other than Python.
- A desktop build. Kept *possible* by invariant #2, not pursued.

## 8. Open

- Promote `.scratch/reachProbe.ts` to `scripts/reach-probe.mjs` alongside `flow-probe` and
  `graph-precision` once slice 1 starts.
- Pricing: the web panel is free-tier under current free-phase pricing. Not decided, just
  noted.
- Whether slice 1's entry-point work should be generalised to other languages immediately
  (it would benefit Flows everywhere) or kept Python-shaped until the filter proves out.

## §4u — Pile 3, closed: one rule shipped, three built and thrown away

Pile 3 was the leftovers — the families I had ranked as "probably not
mechanical". I had been wrong about that ranking once before
(`security_misconfiguration` was in pile 3 and turned out to have a mechanical
core worth +8 TP), so this pass looked for the same mechanical subsets rather
than declining the pile wholesale.

### What the remaining ground truth actually contains

487 ground-truth vulnerabilities sit outside the classes we detect. Splitting
them by whether they are a *new family* or a *recall gap inside a family we
already cover*:

| Family | n | Verdict |
|---|---:|---|
| `hardcoded_credentials` | 66 | recall gap in a covered class, not a new family |
| `reflected_xss` / `stored_xss` | 72 | recall gap in a covered class |
| `weak_cryptography` | 16 | recall gap in a covered class |
| `sensitive_data_exposure` | 87 | **pile 3** |
| `csrf` | 39 | **pile 3** |
| `denial_of_service` | 22 | **pile 3** |
| `missing_authentication` | 20 | **pile 3** |
| `missing_rate_limiting` | 19 | **pile 3** |
| `broken_access_control` | 18 | **pile 3** |

### Shipped: `py-redos` — 16 TP, 0 FP

`PATTERN = r"((a)+)+"` reaching `re.match/compile/search/...`. A group that is
quantified whose body is *also* quantified backtracks exponentially; that is a
genuinely **syntactic** property, which is what makes it a fair rule in a pile
that is otherwise semantic. The pattern is followed through a module constant,
so a regex defined at the top of a file is judged where it is *used*.

Deliberately narrow: only the classic nested-quantifier shape, never "this
regex looks slow". Result — the only rule in the whole layer that raised
precision while adding recall:

| | before | after |
|---|---:|---:|
| TP | 148 | **164** |
| FP | 13 | **13** |
| precision | 0.919 | **0.927** |
| in-scope recall | 0.590 | **0.614** |
| traps | 0/107 | **0/107** |

It does fire 3× on Zulip's markdown and Slack-import regexes. Those are not in
any ground truth, and a nested quantifier in an importer *is* a real hazard, so
they are left standing rather than special-cased away.

### Built, measured, thrown away

Two rules were written in full, measured, and deleted. Both are recorded here
because the reason they failed is the same reason, and it is the single most
repeated lesson in this document.

**`py-plaintext-password-column`** — `password = db.Column(db.String(60))`.
Measured **4 TP / 10 FP**. It flags a *pattern* (a field named password typed as
a string) rather than a dangerous *data flow*. Django's own `AbstractUser`
stores a hashed password in exactly that shape, so the rule cannot tell storage
from hashing. It scored 0 on Zulip, NetBox and Saleor — which sounds like a
clean bill of health, but only means those apps do not declare the field
themselves. Deleted.

**`py-error-detail-leak`** — the exception bound by `except ... as e` flowing
into a response body (`jsonify({"error": str(e)})`). This one is a real data
flow, not a pattern, and it targeted CWE-209, the second-largest CWE in the
remaining ground truth (21 instances). Measured **4 TP / 2 FP**, dropping
precision 0.927 → 0.918, and it fired 4× on NetBox:

```
netbox/netbox/api/viewsets/__init__.py:213  Response({'detail': e.message}, status=400)
```

That is a deliberate API error contract, not a disclosure. Telling an internal
stack trace from an intended error message requires knowing what the endpoint
promises its clients — semantic, not syntactic. Deleted.

### Declined, with the reason

- **`csrf` (39), `missing_authentication` (20), `missing_rate_limiting` (19)** —
  absence detection. The finding is at `@app.route('/login', methods=['POST'])`
  and consists of what is *not* there. We can see every route; we cannot see
  which ones were *supposed* to have a token, a login check, or a limiter.
  Flagging all of them is flagging the application.
- **`broken_access_control` (18)** — CWE-639 IDOR: `user_id` read from the
  request body instead of the authenticated token. Requires knowing which
  identifier is authoritative. No syntactic difference exists.
- **`denial_of_service` (22)** — CWE-400 resource consumption. Requires cost
  modelling of a loop. The one CWE-1333 instance in the family is now covered by
  `py-redos`.
- **`sensitive_data_exposure` (87)** — CWE-200 (32) needs to know which data is
  sensitive; CWE-209 (21) and CWE-256/312 (18) are the two rules above.

### The standard this pile settled

Four rules were built across piles 2 and 3 that flagged a **pattern** instead of
a **dangerous data flow**. All four had to be deleted after measurement, and
every one of them looked reasonable before it was measured. The bare-`{{ }}`
XSS rule collapsed precision 0.919 → 0.684; the password column landed at 4:10.
The rules that survived — taint-required SQLi, reflected XSS, path traversal,
SSRF, ReDoS — all describe something *travelling* somewhere, or a structure that
is dangerous no matter what surrounds it.

**Pile 3 is closed.** In-scope recall stands at 0.614, precision at 0.927, traps
at 0/107, on 2238 green tests.

## §4v — Recall gaps inside covered families: +22 TP, production still silent

§4u closed the last un-covered family. What remained was 154 ground-truth
vulnerabilities in classes we *already* detect — misses of SHAPE, not of
capability. 86 of them were reachable-in-principle and got a full diagnostic
pass: one agent per family read the **actual source at every missed line**
(the ground-truth description is a hint; the code is the evidence), and every
rule it proposed was then handed to an adversary whose job was to kill it by
finding false positives in Zulip, NetBox and Saleor.

Six rules survived. The measured result:

| | before | after |
|---|---:|---:|
| TP | 164 | **186** |
| FP | 13 | 16 |
| precision | 0.927 | **0.921** |
| in-scope recall | 0.614 | **0.664** |
| traps | 0/107 | **0/107** |
| production hits (zulip+netbox+saleor) | — | **0** |

All three new FPs are `py-credential-compared-to-literal` firing in pygoat, and
all three were opened and read: `password=='jacktheripper'`,
`password == "P@$$w0rd"`, `password == "admin"` — one of them carrying pygoat's
own comment `# Will implement hashing here`. They are genuine hardcoded
credentials that the ground truth does not label at those lines. The precision
number is reported as measured anyway; it is not adjusted for that.

### `py-broken-hash-credential` — 8 TP, 0 FP

**This is the rule `py-weak-hash` should have been.** The deleted one lived at
the CALL site, where `hashlib.md5(x)` is genuinely undecidable — 19 of Zulip's
25 findings were gravatar hashes and cache keys (§4h). The discriminating
information is one level up, in the **assignment**: what slot the digest is
stored into. `gravatar_hash = md5(email)` is fine. `token = md5(email)` is a
forgeable password-reset token.

Fires only on `<slot> = md5|sha1(ARG).hexdigest()` where the slot name is
credential-ish and ARG is either a password-named value or derived from
`random.*` / `datetime.now` / `time.time`. md5 and sha1 only — sha256 is the
shape of ~15 deliberately-safe trap snippets and of Saleor's legitimate legacy
PBKDF2 hasher, and widening the set is the obvious "improvement" that would
break it. Measured silent across 10,105 production files including the CPython
stdlib.

### `py-credential-compared-to-literal` — 4 TP

`if password == "admin123"`. The credential is never an assignment target, so
the existing secret rule cannot see it — but the literal is just as committed,
and it *is* the authentication decision. Three guards carry the whole margin,
each pinned by a regression test naming the production line it protects:

1. **Never a call as the credential operand** — `os.environ.get("X") == "True"`
   is correct config reading (zulip/zproject/config.py:44).
2. **Only inside an `if`/`while` condition** — a bare `assert password ==
   "secret"` is a test (saleor .../test_plugin.py:355).
3. **Only a plain string literal** on the other side; an f-string is a
   comparison against something computed.

### `py-reflected-xss`, extended two ways — 7 TP

Flask, Bottle and Quart let a view return a bare string as the body, so the
`HttpResponse(...)` anchor the existing rule needs is simply absent. A new
`return_statement` rule fires on an **inline** assembled literal containing a
real tag and carrying proven `source` taint.

Every one of those words was measured. Accepting a bare identifier at a
`return` — the way the response-constructor branch safely does, because there
the constructor is the anchor — fires **26 times on Zulip, 13 on NetBox and 8
on Saleor** (`return absolute_path`, `return full_name`). 47 production false
positives to buy 3 benchmark true positives. Requiring the literal inline takes
all three to zero.

Separately the response anchor was widened along three axes and narrowed back
on two of them by the adversary: `HTMLResponse` added but not `HtmlResponse`
(Scrapy's *inbound* parser, whose first argument is a URL); attribute callees
allowed only for receivers `web` and `http`, because `httpx.Response`,
`responses.Response` and `client.Response` are mock objects that measurably
fired; the `text=` kwarg accepted but not `body=`, which is the name the mock
libraries use.

Two supporting traversals were added to `taintOf` and `isAssembledString`
(`parenthesized_expression`, `conditional_expression`) so that
`"<p>" + (fmt(q) if q else "") + "</p>"` is visible. Both were verified no-ops:
every existing rule's count on all three production apps was unchanged to the row.

### `py-hardcoded-secret`, extended to cipher keys — 1 TP

`Fernet("literal")` and `hmac.new("literal", ...)`. **Guardrail recorded at the
call site:** the key argument is read *without* unwrapping `.encode()` /
`force_bytes()`. That single "improvement" would turn
`zulip/zerver/tests/test_webhooks_common.py:161` into a false positive.

### `py-template-safe-columns` — 2 TP

`{{ render_table(rows, safe_columns=['message']) }}`. Empty list must stay
quiet — that is the escaping-*on* form. Zero hits across 688 production
template files, while NetBox uses the bare name `render_table` 51 times for an
unrelated django_tables2 tag: the silence is discrimination, not absence.

### Declined, with the measurement that declined them

- **Returning a bare variable that holds HTML** (5) — 47 production FPs, above.
- **Hand-rolled `http.server` apps** (5) — the source is `self.path` /
  `self.headers`, which requires knowing that a stdlib base class binds them
  from the wire. Semantic, not syntactic.
- **The storage site of a stored XSS** (rest of the family) — our taint sources
  are `request.*`, `os.environ`/`sys.argv` and `input()`. A datastore read is
  deliberately not a source; making it one turns every ORM read into a source.
  Note 8 of the 17 stored-XSS misses are **location mismatches, not misses** —
  we already report the same vulnerability at its render site.
- **Credentials outside Python** (HTML tables, XML seed files, docker-compose)
  and **credentials inside a string literal's contents** — out of scope for a
  Python AST rule.
- **Seed data as tuples and dict literals** — `assignmentTargetName` returns
  null for these on purpose, and that is what keeps the traps clean.
- **`mark_safe(self.attr)`** — built and adversarially cleared at 0 production
  hits, then declined anyway for ~0 yield: the finding lands in a
  template-invoked method the graph marks `unreachable`, so nothing surfaces.
  The adversary's note is the useful part: **template-invoked methods should be
  `unknown`, not `unreachable`** — a reachability fix, not a rule. Logged as
  backlog.

### What this pass confirms

The standard from §4u held under fan-out: every rule that shipped describes
something *travelling* (taint into a return, a password into a broken hash, a
literal into a cipher) or a structure dangerous in itself. Every shape that was
declined failed on the same test — it flagged a pattern, and the pattern was
common in correct code. The adversarial pass is what turned three of these from
"looks safe" into "measured safe", and it narrowed two of the six before they
shipped.

## §4w — The held-out set: precision generalises, recall does not

Every number in §4a–§4v was measured on 23 repositories. RealVuln has 66. The
other 43 had never been run — and every rule in this document was narrowed
against the 23, which makes those numbers a fit, not a forecast. 39 of the 43
cloned successfully (three had dead URLs, one pointing at
`github.com/yourrepo/...`).

The held-out set is not more of the same. It is a **different kind of code**:

| | tuning set (23) | held-out set (39) |
|---|---|---|
| what they are | pygoat, dsvw, vulnpy — deliberately vulnerable *teaching apps* | `vc-*-seeded-v2-*` — realistic business apps: education LMS, healthcare clinic, fintech lending, HR payroll |
| the vulnerability is | the point of the code | seeded into otherwise ordinary code |
| ground-truth vulns | 641 | 1,171 |
| safe/trap snippets | 107 | 155 |

### First run: precision collapsed

```
TUNED     TP=186  FP=16   precision 0.921
HELD-OUT  TP=60   FP=64   precision 0.484
```

Triaging all 64 false positives gave three mechanical causes covering 81%:

| cause | n | what it was |
|---|---:|---|
| test / seed / fixture files | 37 (57%) | `DEMO_PASSWORD = "Demo!Password123"` in seed scripts and `tests.py` |
| `{{ field.help_text\|safe }}` | 10 (15%) | Django's own form help text, authored in Python |
| constant names read as secrets | 5 (8%) | `API_KEY_HEADER = "X-API-Key"`, `ACTION_API_KEY_CREATED = 'api_key_created'` |

**The first one is the finding.** 57% of all false positives on realistic code
came from a file category the tuning corpus does not contain *at all* — a
deliberately-vulnerable teaching app has no test suite and no seed data. This
is what a held-out set is for: not a harder version of the same test, a
category of mistake the original corpus could not express.

The fix is a reachability judgement, not a rule, so it lives in
`classifySinks`: seed scripts, fixtures, factories, migrations and Django
management commands exist to set the app up, not to serve a request. A demo
password an operator runs from a shell is not a credential an attacker reaches.

### Second run

```
TUNED     TP=186  FP=16   precision 0.921   traps 107/107 clean
HELD-OUT  TP=60   FP=9    precision 0.870   traps 155/155 clean
```

55 false positives removed, **zero true positives lost on either set**.

Two of the three guards had to be loosened after they were measured. The first
version of the enum-tag check killed `app.config['SECRET_KEY_HMAC'] = 'secret'`,
because the value is a substring of the name; requiring the value to be *most*
of the name (≥60%) restores it. The first version of the "names a thing" check
included the `_NAME` suffix and killed `SUPER_SECRET_NAME = "John Ripper"`.
Both counter-cases are now regression tests.

### What did NOT generalise

| | tuned | held-out |
|---|---:|---:|
| precision | 0.921 | **0.870** |
| traps clean | 107/107 | **155/155** |
| in-scope recall | 0.664 | **0.115** |

Precision transfers. The trap record transfers perfectly — 262 of 262
deliberately-safe snippets clean across both corpora, including 155 the tool
had never seen. **Recall does not transfer, and the gap is a factor of six.**

Two separate reasons, and they should not be conflated:

1. **Distribution.** 55% of the held-out ground truth (651 of 1,171) lies
   outside every CWE class we emit, and it is dominated by exactly the families
   §4u declined as absence-detection or semantic: CWE-307 rate limiting (112),
   CWE-312 cleartext storage (53), CWE-532 secrets in logs (51), CWE-639 IDOR
   (39). Those declines were correct on the evidence available then, and this
   set confirms they are also the bulk of what realistic seeded code contains.
   That is an uncomfortable pair of facts to hold together.

2. **Depth.** Even restricted to classes we do detect, recall is 0.115 against
   0.664. In a teaching app the sink is three lines from the route handler. In
   a business app it is behind a service class, a repository, and dependency
   injection. This is a call-graph and taint-depth problem, not a rule-coverage
   problem, and no number of new rules will move it.

### The honest summary

The layer is **precise and trap-safe on code it has never seen** — that
property survived contact with a corpus it was not fitted to, which is the
single most important thing this measurement could have shown. It is **not yet
sensitive on realistic applications**, and the reason is now measured rather
than guessed: interprocedural depth, not missing rules.

Reported figures from here on should quote both corpora. A precision number
from the tuning set alone is a fit.

## §4x — The depth hypothesis was wrong. The engine was blind.

§4w concluded: *"This is a call-graph and taint-depth problem, not a
rule-coverage problem, and no number of new rules will move it."* That was
written without measuring it, and it is **wrong**.

Six diagnostic groups read the real code at all 443 missed in-scope
vulnerabilities on the held-out corpus. Every one of them reported the same
figure for how many misses need taint to cross a function boundary: **zero**.
The missed code looks like this:

```python
def course_shell_probe_400(request):
    import os as _os
    host = request.GET.get("host", "127.0.0.1")
    status = _os.system("ping -c 1 " + host)
```

Four lines. Taint straight from `request.GET` in the same function. We missed
it because the rule matches the literal receiver name `os` and the import is
aliased.

### Result

| | before §4x | after |
|---|---:|---:|
| held-out TP | 60 | **314** |
| held-out FP | 9 | 48 |
| held-out precision | 0.484 → 0.870¹ | **0.867** |
| held-out in-scope recall | 0.115 | **0.604** |
| tuned TP | 186 | 192 |
| tuned precision | 0.921 | 0.914 |
| traps clean | 262/262 | **262/262** |
| production surfaced (zulip+netbox+saleor) | 67 | 72 |

¹ after the §4w test/seed-file fix, before this section's work.

**Recall went up 5.2× on code the tool has never seen, and the trap record
held.** Two thirds of that came from four engine fixes that are not rules at
all.

### The engine was blind in four places

Each of these silently disabled *every* rule that depended on it:

1. **Aliased imports.** `import os as _os` → `_os.system(...)`. Receiver rules
   match the literal identifier, so one alias disabled os-command, subprocess,
   pickle, yaml, jwt, crypto keys, SSRF and ReDoS at once. 30 of 30 command
   injections were exactly this shape. The map drops any alias that is *also*
   bound elsewhere in the file, which closes the only demonstrated
   false-positive class.
2. **`await`.** `taintOf` had no `await` case, so taint was off inside every
   async FastAPI and aiohttp handler. The held-out corpus alone holds 65
   `await request.json()` and 59 `await request.body()`.
3. **Methods called on `request` itself.** The source regex only fired two
   levels down (`request.GET.get`), so `request.json()` read as an ordinary
   call.
4. **Dotted module receivers.** `urllib.request.urlopen(x)` — `plainReceiver`
   refuses to flatten these by design, so SSRF never saw it.

Plus two taint-propagation corrections: `boolean_operator` (`request.body
.decode() or "{}"` — operator-aware, since `a and b` only ever yields `b`), and
`binary_operator` now prefers a non-environment answer so `BASE_DIR /
request.GET["n"]` is attributed to the request rather than to the `os.environ`
the base was rooted in. Without the latter, 31 genuine path findings were
discarded over a labelling artefact.

### Rules built on top

- **`py-ssti`** extended to `Template("Hi " + name).render()` — 35 of 35 SSTI
  misses were this one shape. The judgement is on the *receiver expression*,
  a primitive `matchSinkRule` did not have.
- **`py-path-traversal`** extended to receiver-position sinks
  (`target.write_text(data)`), since pathlib inverts `open()`.
- **`py-open-redirect`** — new; there was no such rule, despite the family
  being claimed as covered.
- **`py-xxe`** — new; narrowed to `XMLParser(load_dtd=True | no_network=False)`.
  `huge_tree=True` is excluded deliberately: it is an oversized-document guard,
  not entity resolution, and reporting it under CWE-611 would state something
  false about the code.
- **`py-cors-origin-reflected`** — new; taint is the entire discriminator, so a
  fixed origin or `'*'` never fires.
- **`py-hardcoded-secret`** extended to `os.getenv("JWT_SECRET", "dev-secret")`
  — the *fallback* ships in every environment where the variable is unset.

### What the adversarial pass caught

- **`py-nosql-injection` was killed.** The diagnosing agent claimed 31 true
  positives; the adversary implemented the spec verbatim and measured **zero**.
  Not built.
- **`py-open-redirect` broke the trap record on first measurement** — 154/155,
  plus 54 findings on production. The trap was a `next` parameter validated
  with `url_has_allowed_host_and_scheme`; the production hits were
  parameter-derived redirects and redirects to the request's own URL. Three
  guards — source-taint only, not the request's own address, and silent when
  the destination is tested in the same function — restored 262/262 and took
  production from 54 to 5.

That regression is the reason the trap corpus exists. It appeared, it was
caught by measurement rather than by review, and it was fixed before the
commit.

### Left undone

`py-unrestricted-upload` (Django storage `.save()` with a tainted name,
adversary verdict *safe*, ~6 TP) is **not built**. It needs the existing
`lookupVariableType` closure threaded into `matchSinkRule`, and it was the
smallest of the measured wins. Recorded here rather than quietly dropped.

### The lesson, again

This is the sixth time in this document that asserting a cause without
measuring it produced a wrong answer, and the second time the wrong answer
made it into a written conclusion. The recall gap looked like depth because
"realistic apps have more layers" is a plausible story. The code says the
vulnerabilities are four lines long and we could not see the fourth line.

## §4y — Two data-flow families reopened, one killed

§4u declined a pile of families as "absence detection or semantic". That
judgement was made on the teaching-app corpus, with an engine that could not
see aliased imports, `await`, or a method called on `request`. Three families
were re-examined once §4x had un-blinded it. Two of them are genuinely data
flows; one is not, and was killed after being fully implemented.

This is **not** a reversal of §4u. The declines there — csrf, rate limiting
(CWE-307, 112 in the held-out corpus), IDOR (CWE-639, 39) — stand. So does
user enumeration (CWE-204, 36), which needs two response paths compared
semantically. CWE-532, CWE-330 and CWE-915 were never examined individually.

### Result

| | before §4y | after |
|---|---:|---:|
| held-out TP | 314 | **375** |
| held-out FP | 50 | 50 |
| held-out precision | 0.867 | **0.882** |
| held-out in-scope recall | 0.604 | **0.623** |
| tuned TP | 192 | 193 |
| traps clean | 262/262 | **262/262** |
| production surfaced | 72 | **72, byte-identical** |

+61 true positives for zero new false positives, and precision went up.

### `py-credential-logged` — 30 TP

```python
body = request.body.decode("utf-8", errors="replace")
logger.warning("ops tally body=%s bearer=%s", body, request.headers.get("authorization"))
```

An Authorization header travelling into a log sink. Logs are shipped, indexed
and read by people who are not meant to hold the caller's bearer token.

**The derivation guard is the rule.** The first version judged taint on
`request.headers` and never on what actually *reached* the log, so it fired on
every safe idiom: `redact(auth)`, `sha256(auth).hexdigest()`, `bool(auth)`,
`len(auth)`, `auth[:6]`. Those are developers doing it right. The shipped
version descends only through nodes that FORMAT a value — f-strings, `%`, `+`,
tuples, keyword args — and stops at any other call. It therefore claims "the
credential itself reaches the log", which is defensible, rather than "something
computed from the credential reaches the log", which is false precisely when
the code is correct.

The header list is short for the same reason: a bare `token` is a device token
or a CSRF token far more often than a credential, and including it was measured
firing on an FCM-registration shape.

### `py-weak-prng-secret` — 31 TP

```python
import random
code = "".join(random.choice(alphabet) for _ in range(length))
```

`random` is the Mersenne Twister: observe a few outputs, predict all the rest.
Fine for a dice roll, fatal for a password-reset code.

**The `.join(` requirement is the whole safety margin.** A value BUILT
character by character is a generated secret; a single draw is a *pick*. Without
it the rule fires on `key = random.choice(list(keys))` (sampling a dict),
`partition_key = random.randint(0, n)` (sharding), and on CPython's own
`email/generator.py`, which does `token = random.randrange(...)` — meaning it
would have fired in every Python installation on earth.

`secrets.*`, `os.urandom`, `uuid4` and `get_random_string` are excluded **by
construction** rather than by a deny-list, because the trigger requires a
module-qualified `random.` draw. `random.SystemRandom` — the one CSPRNG in the
module — is explicitly excluded.

### Killed: `py-mass-assignment`

```python
change_set = json.loads(request.body.decode("utf-8") or "{}")
workset = {"role": "viewer", "is_admin": False, "credit_limit": 5000}
workset.update(change_set)
return JsonResponse(workset)
```

Designed, implemented, and measured at exactly the 31 true positives claimed —
every number the designer gave was true. It was killed anyway, on the
adversary's reasoning:

> The rule is missing the second half of a data flow: it proves untrusted data
> ARRIVES in a dict, never that the dict is a DANGEROUS DESTINATION.
> `dict.update()` is not a sink.

It fired on NetBox's `component_data.update(data)`, on Saleor's
`ALLOWED_MIME_TYPES.update(json.loads(os.environ.get(...)))`, and on the
ordinary Django template-context merge. The narrowing that would make it a real
sink — requiring the dict to reach `Model(**recv)` or a `setattr` loop — kills
all 31, because every seeded case merely *returns* the dict. Nothing is
persisted, so nothing is actually assignable.

**A rule can be perfectly implemented, score exactly what was promised, and
still be wrong.** That is the whole argument for measuring the destination and
not just the arrival.

### One bug worth recording

`py-credential-logged` fired correctly in the plugin and scored **zero** in the
harness. The rule set `requiresTaint: true` but never attached the evidence,
and `classifySinks` drops exactly that combination — correctly. The rule was
invisible for one measurement cycle. Anything with `requiresTaint` must carry
its `taint`, or it silently does not exist.
