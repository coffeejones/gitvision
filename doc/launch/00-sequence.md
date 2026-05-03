# Launch sequence — overview

7-day staircase launch. Friendly audience first, fix bugs, gain
momentum, then biggest venues.

## Pre-launch checklist (do these BEFORE day 1)

- [x] gitvision.net domain live with HTTPS
- [x] Railway deployed, latest v0.53 build active
- [x] 4 demo sessions tagged ownerId="demo" (instant load via ⚡)
- [x] Ghost sessions cleaned up (only 4 demos visible on prod)
- [x] ANTHROPIC_API_KEY set on Railway
- [ ] Anthropic console: $50/mo monthly spending cap + email alerts
      at 50/75/90%
- [ ] Railway env: `AI_DAILY_BUDGET=10` for first 24h post-launch
- [ ] All 8 screenshots in `doc/screenshots/` ready
- [ ] README.md updated with screenshots inserted
- [ ] All 5 launch posts drafted in `doc/launch/`
- [ ] Read each draft once more — adjust tone to your voice

## Day 1 — Sunday afternoon (Denmark) / morning (US)

**Soft launch: r/SideProject**

- Friendly audience, low stakes
- Goal: catch first round of bugs / UX issues
- Spend ~2 hours actively replying

**See:** `02-r-sideproject.md`

**Day 1 evening:** triage feedback, ship hot-fixes if any. Update
post with [EDIT: fixed X — try again] if a real bug surfaced.

## Day 2 — Monday

**Indie Hackers product launch + DEV.to "How I built it" post**

- Indie Hackers: cross-post the r/SideProject content with light
  edits ("posted on r/SideProject yesterday, got X feedback, here's
  what I built"). Indie Hackers audience likes maker stories.
- DEV.to: write a 600-1000 word "How I built GitVision in 8 weeks
  on hobby evenings" post. Mention the workspace pivot, the
  tree-sitter integration, the duplicate-detection algorithm. This
  is content marketing — long-tail, slow burn.

**No template files for these — write them in your voice based on
the r/SideProject and HN drafts as reference.**

## Day 3 — Tuesday

**Rest day. Monitor inbound.**

Use the day to:
- Read all comments from D1+D2 carefully
- Ship 1-2 polish fixes if anything obvious surfaced
- Confirm the analytics + feedback channels work (if you have
  Plausible / Tally setup)

## Day 4 — Wednesday

**r/golang (with golang/go finding as hook)**

**See:** `03-r-golang.md`

Post late afternoon Pacific (evening Denmark) when r/golang is
most active.

## Day 5 — Thursday

**r/Python (with pallets/flask demo as hook)**

**See:** `04-r-python.md`

Don't post r/Python and r/golang same day — Reddit users notice
cross-posting and it hurts both threads.

## Day 6 — Friday

**Show HN — the main event**

**See:** `01-show-hn.md`

Submit Tuesday-Thursday 8-9 AM Pacific would be ideal, but Friday
works if your traction from D1-D5 lands well. Be online for at
least 3 hours after posting.

If you have ~50+ upvotes from r/SideProject, r/golang, r/python
combined by this point, you have real traction signal. HN is the
amplifier.

## Day 7 — Saturday

**Twitter / X / Bluesky thread**

**See:** `05-twitter-thread.md`

Reference HN traction in tweet 1 ("on HN this week, ~X upvotes,
here's what I built…"). Pin to profile for the launch week.

## Week 2

- Reply to remaining HN/Reddit comments — many slow-burn comments
  arrive 3-5 days late
- Write a "How launch week went" post for DEV.to or your blog
- Reach out to dev-tool newsletters (TLDR.tech, Bytes.dev,
  Pointer.io) WITH the actual launch numbers (X HN upvotes, Y
  GitHub stars, Z weekly visitors). Cold pitches without data get
  ignored; with data they sometimes don't.

## Realistic expectations

| Outcome | Probability |
|---|---|
| 30-100 HN upvotes, page 2-3 of front page | ~50% |
| 10-30 HN upvotes, no front-page exposure | ~35% |
| 100+ upvotes, front page 4+ hours | ~10% |
| Viral spike (1000+ visitors / day for a week) | ~5% |

Day-7 retention will be low (5-15%) for an alpha tool without a
specific recurring use case. That's normal. The goal is to find
the 5-10% who DO come back — they're the early signal for what
GitVision becomes.

## What to track

For YOUR judgment of how launch went:

1. Total unique visitors over 7 days (Plausible if set up, else
   Railway request count)
2. Sessions created on production (look at /api/sessions count)
3. GitHub stars (visible on the repo page)
4. HN comments + sentiment (qualitative — copy interesting ones to
   a notes doc)
5. Real bug reports + feature requests (file as GitHub issues)

Don't optimize for upvotes / vanity. Optimize for: did at least 3
people give detailed feedback that helps me improve the product?
If yes, launch was a success regardless of upvote count.
