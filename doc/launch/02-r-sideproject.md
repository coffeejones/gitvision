# r/SideProject

## Strategy

- **When:** Day 1 of launch sequence — friendly audience, low stakes,
  good for catching first round of feedback / bugs
- **Subreddit:** https://www.reddit.com/r/SideProject/
- **Karma requirement:** check current rules; you may need a few
  comments first if account is new there
- **Tone:** humble, curious, "tear it apart" framing works best —
  this audience rewards builders asking for honest feedback

## Title

**Recommended:**
```
Built a workspace for analyzing any GitHub repo — feedback wanted
```

**Alternative (more product-specific):**
```
GitVision: paste a GitHub URL, find risky/duplicated/untested code (alpha)
```

## Body

```
Hey r/SideProject — I'm Jonas (24, Denmark, Datamatiker student). I've
been building GitVision on hobby evenings for 8 weeks: paste a GitHub
URL, get a workspace with blast radius, structural duplicate detection,
untested hotspots, and an AI health verdict.

Live at gitvision.net — click any of the 4 demo buttons (zod / gin /
flask / spring-petclinic) for instant load, no waiting.

Tech: Next.js 16, tree-sitter WASM (AST across 7 languages), 531 unit
tests. Hybrid AI: 17 deterministic signals feed a constrained Claude
prompt so the AI can't hallucinate — every claim grounds in real data.

This is genuinely alpha. I'm specifically looking for:

- Does the workspace UI feel right or kludgy? (Sidebar + main content
  + Cmd+K palette pattern — Linear-inspired.)
- Are the insight panels (Code tab) actually useful or just neat?
- What broke / surprised you / confused you?
- Anything you'd actively use this for?

Source: https://github.com/coffeejones/gitvision (PolyForm Noncommercial)

Tear it apart. Thanks!
```

## What to expect from this sub

- Mostly supportive feedback — this is "where indie devs encourage
  each other"
- Occasional technical critique from a senior dev who happens to be
  scrolling
- Some "I'd use this for X" suggestions — write them down, those are
  feature signals
- Some "have you considered Y" comparisons (Sourcegraph / CodeScene /
  etc.) — answer like in the HN comment table

## Engagement playbook

- Reply to every top-level comment in the first 4 hours
- Like / upvote every comment that adds something — courtesy
- If someone files a real bug report in a comment, thank them and
  ship the fix in the next 24h. Then update the post or reply with
  "fixed in v0.X — try again"

## Avoid

- Cross-posting to r/programming the same day — different culture,
  different expectations, dilutes both threads
- Engaging with trolls — downvote and move on
- Editing the post mid-thread without [EDIT: ...] notation
