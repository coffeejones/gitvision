# Show HN

## Strategy

- **When:** Tuesday-Thursday, 8-9 AM Pacific (5-6 PM Denmark / CEST)
- **Why this slot:** HN's front-page churn is highest in US morning;
  posts that catch the morning wave have ~3 hours to gain traction.
- **Stay online for the next 3 hours** to reply to comments. HN posts
  live or die by author engagement in the first hour.
- **Submit URL:** the production landing OR a deep-link to a demo
  session showing the strongest finding (see "URL" below).

## Title (80-char limit on HN — pick one)

**Recommended:**
```
Show HN: GitVision – Find risky, duplicated, or untested code in any GitHub repo
```
(78 chars — clear, specific, mentions all three core insights)

**Alternative #1 (more workspace-y):**
```
Show HN: GitVision – AST-based blast radius and duplicate detection for GitHub repos
```

**Alternative #2 (concrete hook — only if you want to lean Go):**
```
Show HN: I found 36 copies of one ARM rewrite pattern in golang/go (and built a tool)
```

## URL

Two options — pick based on goal:

- **`https://gitvision.net`** (default) — lands on the hero with all 4
  demo buttons. Lower friction; users self-select what to try.
- **`https://gitvision.net/session/_W6Bk6XqSq`** — direct deep-link to
  the pre-analyzed colinhacks/zod session. Higher impact ("they're
  already in the product") but skips the hero pitch.

I'd go with the landing for Show HN — the demo buttons + ⚡ icons tell
the "instant load" story visually.

## First comment (post yourself within 1-2 min of submission)

Posting your own first comment as the author gives moderators
context, signals you're around, and seeds the discussion.

```
Hi HN, builder here. Solo dev (24, Denmark), this is alpha. A few notes:

- Tree-sitter AST parsing across 7 languages (JS/TS, Python, Go, Java,
  C#, PHP, Ruby). Kotlin on regex fallback — upstream WASM grammar
  ABI mismatch.

- Hybrid AI: 17 deterministic rule-based signals feed a constrained
  Claude narrative. Every claim grounds in computed data — no
  free-form hallucination.

- Anonymous, no signup. Sessions stored as JSON files. PolyForm
  Noncommercial license (free for personal/learning/nonprofit).

- 4 pre-analyzed demo buttons load instantly so you don't watch a
  20-second progress bar before seeing what the tool does.

The duplicate detection found 36 copies of one ARM rewrite pattern
in golang/go src/cmd. Try the gin or spring-petclinic demo for a
smaller-repo view first.

Built solo on hobby evenings over 8 weeks. Source:
https://github.com/SoosFire/gitvision

Happy to answer technical or design questions.
```

## Likely critical questions — have answers ready

| Question | Answer |
|---|---|
| "Open source?" | Yes, PolyForm Noncommercial. Free for personal/learning/nonprofit. Commercial use needs a license. GitHub link in the comment above. |
| "Why not MIT?" | Hobby project that may become commercial. PolyForm preserves optionality. Will revisit licensing when there's enough signal to commit either way. |
| "Self-hosted?" | Yes, `git clone` + `npm run dev`. File-based storage, no DB. Set GITVISION_DATA_DIR for persistent volume. |
| "Private repos?" | Not yet — uses unauthenticated GitHub API. Self-host with a token if needed. |
| "Why over Sourcegraph / CodeScene / Codacy?" | Different scope. Those are enterprise code intelligence with auth + indexing. GitVision is "paste a URL, get a workspace." Optimized for solo investigation, screenshot-share, and "tell me what's interesting about this repo." |
| "AI = ChatGPT with extra steps?" | The 17 deterministic signals do the analysis. The AI just narrates the signals into prose. Try disabling AI (don't set ANTHROPIC_API_KEY) — every other panel still works because they're not AI-driven. |
| "Big repos?" | Subset analysis: paste a deep-link to a subdir for monorepos. Tested up to golang/go src/cmd (1,909 files, 22k functions). |
| "Kotlin coverage?" | Regex fallback only — upstream tree-sitter-wasm ABI mismatch blocks the AST plugin. Imports work; calls / complexity don't. |
| "Why anonymous owner-id, not auth?" | This is alpha. Adding auth before knowing what users actually want is over-investing. localStorage UUID gives "your sessions" filter without signup. Would revisit if there's demand for cross-device session sync. |
| "What's the cost story?" | Anthropic API caps: console-side $50/mo + app-side daily call budget. Worst case for me is bounded. AI panels gracefully hide if budget exhausted. |

## Anti-patterns to avoid

- DON'T post and disappear — engage every comment for first 2 hours
- DON'T be defensive about criticism — "fair point, that's on the
  list" is fine
- DON'T link-spam other channels in the HN thread
- DON'T pre-warm by asking friends to upvote — HN's vote-ring
  detection kills your post and your account
- DON'T resubmit if it flops — once per launch
