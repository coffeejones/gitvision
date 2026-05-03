# Twitter / X thread

## Strategy

- **When:** Day 7 of launch sequence — after Show HN. Lets you
  reference HN traction in the thread ("on HN today: …") for social
  proof.
- **Format:** 6-8 tweets, screenshots in tweets 1-4, link in last.
- **First tweet decides everything** — it's what people see in their
  feed before clicking "show more". Lead with the strongest visual
  + the strongest claim.
- **Tag accounts that might re-share:** dev-tools accounts, language-
  specific (@golang, @python, @typescript), and indie-builder folks.

## Pre-tweet prep

- Upload all 8 screenshots to a draft Twitter post FIRST so you have
  the URLs / image references ready when you compose
- Sequence: image first, text second (Twitter's preview crops weird
  if text-first)

## The thread

### Tweet 1 — hook + cover image

**Image:** `Landing.png` (the hero with 4 ⚡ demo buttons)

**Text:**
```
I built GitVision — paste any GitHub repo, get a workspace that finds
risky, duplicated, and untested code. 4 instant demos on the landing.

gitvision.net 🧵
```

(Keep it under 220 chars so the URL still previews. Emoji thread-
indicator is fine on Twitter, less fine on Bluesky — adjust per
platform.)

### Tweet 2 — the big differentiator (Near-Duplicates)

**Image:** `NearDuplicate.png` OR `NearDuplicateZoom.png`

**Text:**
```
Hero feature: AST-based structural duplicate detection across 7
languages. On golang/go src/cmd it found 36 copies of one ARM
rewrite pattern. On zod's locales: 5 groups of structurally-
identical i18n functions.
```

### Tweet 3 — Refresh banner (the "you come back" feature)

**Image:** `Refresh.png`

**Text:**
```
"Since your last visit" isn't a metadata diff — it's a story-driven
banner with a real headline. "1 new contributor joined", "Code
complexity grew by 45 — new branching logic added across the
codebase", etc.
```

### Tweet 4 — workspace shell (this is a TOOL not a dashboard)

**Image:** `Overview.png`

**Text:**
```
Built as a workspace, not a dashboard. Persistent sidebar, slim
topbar, every tab is its own URL (/code, /imports, /insights). Cmd+K
palette navigates pages, files, and functions. Selection state
persists across navigation.
```

### Tweet 5 — AI grounded in signals

**Image:** `HealthCheck.png` (or `AIBriefing.png`)

**Text:**
```
AI health verdict, but grounded: 17 deterministic signals feed a
constrained Claude prompt. Every claim maps back to real data. Zero
hallucination room. Disable AI entirely and every other panel still
works — they're not AI-driven.
```

### Tweet 6 — tech credibility (for the dev audience)

**No image** (or `Palette.png` if you want one)

**Text:**
```
Tech: Next.js 16, tree-sitter WASM (AST + Phase 5 type-aware call
resolution), 531 unit tests, file-based storage. Anonymous, no
signup, free. PolyForm Noncommercial.

Source: https://github.com/SoosFire/gitvision
```

### Tweet 7 — backstory + CTA (the indie hook)

**Text:**
```
Built solo on hobby evenings over 8 weeks. I'm Jonas, 24, Datamatiker
student in Denmark. This is alpha — go try it, break it, tell me
what's broken.

gitvision.net
```

(Optional last tweet — adds personality, attracts the "support indie
devs" crowd. Skip if you want the thread shorter.)

## Tagging suggestions

In the thread (or as quote-RTs after the thread is up):

- Language accounts: @golang, @nodejs (no official @python that I
  know of, but @realpython works)
- Tooling accounts: @vercel, @nextjs, @AnthropicAI (your Claude use)
- Indie-builder: @SwiftOnSecurity (random pick — find your local
  indie-builder mutuals)
- DenmarkTech / nordic-dev mutuals if you have any

DON'T tag big accounts performatively in tweet 1 — looks try-hard.
Use a follow-up reply to thread for tags.

## Bluesky / Mastodon variant

Same content, drop the emoji thread-indicator (🧵), keep tweets
slightly longer (300 chars works on both). Cross-posting same day
is fine.

## What to do AFTER posting

- DM 5-10 dev-tool people you know with "fyi, just shipped" — keep
  it short, no ask. Some of them quote-RT, some don't, no pressure.
- Engage every quote-RT and meaningful reply for first 6 hours
- Pin tweet 1 to your profile for the launch week
- Screenshot the best replies and stitch into a follow-up "how
  launch went" thread next week — content for week 2

## Anti-patterns

- DON'T tag Anthropic / Vercel / Cursor in tweet 1 hoping for an RT
  — looks desperate, hurts thread
- DON'T use thread-bot tools — Twitter algo deboosts them
- DON'T post a v2 thread if v1 underperforms — give it 48h, learn,
  iterate
