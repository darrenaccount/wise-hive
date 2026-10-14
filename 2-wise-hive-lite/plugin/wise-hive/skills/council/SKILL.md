---
name: council
description: Convene The Wise Hive idea council on an idea (Lite) - by default a Believer, a Skeptic and an Investor argue it, then a Judge rules PURSUE, PIVOT or PASS with a score, all in one answer to save usage. Other seats (player, economist, bootstrapper, engineer, competitor, future, moderator, marketer, artist, remixer) sit only when the user names them with --seats. Use when the user asks to judge, evaluate, pressure-test or "council" an idea, or asks whether an idea is worth pursuing.
---

# The Council (Lite)

Usage: `/wise-hive:council [--seats id,id,... | --seats saved | --seats ?] <idea>`. The idea is everything after the flags (or the idea under discussion). If there is no idea, ask for it in one line.

This is The Wise Hive Lite: write the whole council yourself in ONE answer. Don't start subagents; each one would reload all of Claude Code and cost far more of the user's usage. Edit nothing except the saved debate.

## 0. Who sits (read seat files only when needed)
- **No `--seats`**: the classic three below. Read no seat files. Never add a seat the user didn't name.
- **`--seats a,b,c`**: those seats in that order, **at most 5** (drop the rest and say so). If every one is `believer`, `skeptic` or `investor`, use the classic briefs and read nothing. Otherwise read `{{BRAIN}}\app\council-seats.json` once: each entry in `seats` has `id`, `name`, `role`, `blurb` and `brief`; `aliases` maps other spellings to ids (`playtester` is `player`, `builder` is `engineer`, `future-you` is `future`, ...). Drop unknown or repeated ids and say which were dropped.
- **`--seats saved`**: the seats saved in The Wise Hive app, from `seats` in `{{BRAIN}}\app-settings\council.json` (the classic three if it's missing). Then as above.
- **`--seats` alone or `--seats ?`**: read council-seats.json, show the seats as a table (id, name, blurb), and stop.
- If council-seats.json can't be read: the classic three, and say so.

Reads, cheapest first: `app-settings\council.json` only with `--seats saved`; `council-seats.json` only when a non-classic seat is named (directly or through `saved`) or the table is asked for; `{{BRAIN}}\INDEX.md` is optional (one glance, so the council argues with what the hive knows about the user). A plain council reads nothing else.

Say in one line who sits.

### Classic briefs
- **Believer**: the strongest honest case that the idea works: who exactly buys or plays it, the painful problem it solves, why now, how to reach the first 100 customers or players.
- **Skeptic**: attack it: competitors and substitutes, why people won't pay or play, build cost and risk, platform or legal risk, hidden assumptions. Top 3 fatal risks first.
- **Investor**: size it: rough market with reasoning, business model and pricing, moat, what it becomes in 3-5 years, the milestone that would make you invest.

## 1. The seats
Give each seat an honest, separate turn under `## <name>`, in seat order, following its brief; don't let them agree with each other to save effort. Short bullets: under 150 words each for up to 3 seats, under 120 for 4-5.

## 2. The Judge
Weigh every seat that sat fairly. An angle no seat covered counts neither for nor against the idea. Start with this line exactly:

`VERDICT: PURSUE|PIVOT|PASS | SCORE: N/10`

Then `## Why`, `## What would change my mind`, `## Next 3 steps`. Under 200 words. If the user pushes back afterwards, re-judge honestly and restate the VERDICT line first.

## 3. Save the debate
Write it to `{{BRAIN}}\council\<YYYY-MM-DD>_<short-slug>.md` (if that file exists, add `-2`, `-3`, ...) with `# Council: <idea>`, then `## <name>` for each seat in order, then `## Judge`. The Wise Hive app's Council shares this folder. Tell the user where it was saved.
