# r/python (and r/flask)

## Strategy

- **When:** Day 5 of launch sequence — one day after r/golang post
- **Subreddits:**
  - https://www.reddit.com/r/Python/ — bigger, more general
  - https://www.reddit.com/r/flask/ — smaller, more targeted, less
    risk of moderation removal
- **Pick one or post to both** (at least 24h apart).
- **Karma requirement:** r/Python is strict — needs comment karma
  history. r/flask is laxer.

## Title (r/Python)

**Recommended:**
```
Built an AST-based code analysis workspace, demoed on pallets/flask
```

**Alternative (more finding-led):**
```
Mapped pallets/flask with a structural-duplicate / blast-radius tool I built
```

## Title (r/flask, if you also post there)

```
Built a code analysis tool — flask is one of the 4 instant demos
```

## Body (r/Python)

```
I built GitVision: paste any GitHub URL, get a workspace with blast
radius (call graph, 3 hops deep), structural duplicate detection,
untested-hotspot ranking, and an AI health verdict grounded in
deterministic signals.

Live at gitvision.net — pallets/flask is one of 4 pre-analyzed demo
repos that load instantly. Click it on the landing.

Tech: tree-sitter via WASM (full AST + Phase 5 type-aware call
resolution for Python). Parses type hints, PEP-526 class
attributes, __init__ self.X = typed_param patterns, and class-
instantiation inference (x = SomeClass()). Untyped Python falls
back to name-match.

Insight panels on the Code tab:

- Blast radius: click a function, see callers + callees three hops
  deep
- Untested hotspots: most-complex production functions with zero
  test caller (computed from the call graph, no external coverage
  tool)
- Near-duplicates: structural AST-hash groups across all parsed
  files

Hybrid AI: 17 deterministic signals feed a constrained Claude
prompt. The signals do the analysis; the AI just narrates them.
Zero hallucination room — try disabling AI (don't set
ANTHROPIC_API_KEY), every other panel still works.

Solo dev, hobby project, alpha. PolyForm Noncommercial license.

Source: https://github.com/coffeejones/gitvision

Curious what Django / Pyramid / FastAPI / Sanic codebases look like
under this — try analyzing your favorite Python repo and let me know
what surfaces.
```

## Likely conversations

- "Compared to Pyflakes / pylint / mypy?" → Different layer. Linters
  catch syntax-level / type-level bugs. GitVision shows
  architectural patterns: duplicates, blast radius, what's untested.
- "Does it handle async / decorators / dataclasses?" → Tree-sitter
  parses all of them; type-aware resolution handles common cases
  (async fns, decorated methods). Edge cases: dynamic decorators
  that swap function signatures may not resolve perfectly.
- "Black / Ruff integration?" → Out of scope. We're not a formatter
  or linter; we're a workspace for understanding repos.

## Anti-patterns

- DON'T use the same wording as the r/golang post — Reddit users
  see cross-posts and downvote
- DON'T claim "Python-first" or anything that implies the tool is
  primarily for Python — it's multi-language; make Python the
  framing, not the focus

## What to bookmark from this thread

- Any Python codebase someone says "tried it on $X, found $Y" →
  potential demo candidate or follow-up Twitter thread
- Specific bugs in Python parsing → file as GitHub issues + ship
  fixes within 48h
