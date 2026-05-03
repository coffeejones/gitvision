# r/golang

## Strategy

- **When:** Day 4 of launch sequence — after r/SideProject and Indie
  Hackers. Reddit subs hit different audiences; spreading them out
  avoids burnout AND lets you reference earlier traction in later
  posts ("after a good thread on r/SideProject…").
- **Subreddit:** https://www.reddit.com/r/golang/
- **Karma requirement:** higher than r/SideProject. If you don't have
  enough comment karma there, comment helpfully on a few posts in the
  weeks before launch.
- **Tone:** Go-specific, lead with a finding from a Go repo. r/golang
  rewards specificity over generalist tool pitches.

## Title

**Recommended (concrete-finding lead):**
```
Built a tool that finds 36 copies of one ARM rewrite pattern in golang/go src/cmd
```

**Alternative (slightly less Go-specific):**
```
Structural duplicate detection for Go codebases — alpha launch, feedback wanted
```

The first one is stronger — it's a CONCRETE, VERIFIABLE finding from
the most famous Go codebase in existence. Reddit loves "I looked at
golang/go and found X."

## Body

```
I built a code analysis tool that does AST-based structural duplicate
detection — hashing function bodies (modulo identifier names + literal
values) and grouping by hash.

Pointed it at golang/go src/cmd. Top finding: the
rewriteValueARM_OpARMADDSshiftLLreg family — 36 functions with
structurally identical bodies, different opcodes/literals, same
shape. The OpAdd16/32/64/8 family is similar with 4 copies at higher
complexity.

It's the kind of thing you can't easily DRY in Go without generics,
which… yeah, the compiler authors know. But it's a clean illustration
of where structural duplication happens when the language can't
abstract over the difference.

Tool is at gitvision.net — free, no signup. Built solo on hobby
evenings (Datamatiker student here, Denmark).

Try the gin demo button on the landing for an instant view of a more
typical Go codebase.

Curious what other rewrite-heavy Go projects look like under
structural-hash. CockroachDB? K8s? Suggestions welcome.

Source: https://github.com/coffeejones/gitvision (PolyForm Noncommercial)
```

## Likely conversations

- "Tried it on $MY_GO_PROJECT — here's what it found" → these are
  GOLD, they're free QA from real users with real codebases. Reply,
  thank, and bookmark the repo as a future demo candidate.
- "Why not use Sourcegraph code search?" → Sourcegraph is for
  semantic search across many repos. GitVision is for "give me a
  workspace on this one repo." Different shape, complementary tools.
- "Does it understand Go generics?" → Tree-sitter parses type
  parameters, the duplicate detection ignores them like other
  identifiers. So `func F[T any](x T)` and `func G[U any](y U)` would
  hash identically. That's the intended behavior — structure over
  names.
- "Performance on big repos?" → 22k functions in golang/go src/cmd in
  ~10s on Railway Hobby tier. AST parsing is the bottleneck (~2-4s),
  the rest is metadata fetch + I/O.

## Likely critique to handle

- "Why a GUI? CLI tools exist." → Web tools are share-able. You can
  send a teammate a URL to a specific finding (deep-link with
  tab/file/function preserved). CLI output requires copy-paste.
- "Cargo.toml support / non-Go is irrelevant to us." → Fair, but
  duplicate detection is language-agnostic — point at any of your
  repos and it works.

## Posting time

Mid-week, mid-day Pacific (afternoon Denmark) when r/golang is
most active. Sundays are quiet on Reddit dev subs.
