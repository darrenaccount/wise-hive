---
name: council
description: Convene The Wise Hive idea council on an idea - by default a Believer, a Skeptic and an Investor argue it in parallel, then a Judge rules PURSUE, PIVOT or PASS with a score. Other seats (player, economist, bootstrapper, engineer, competitor, future, moderator, marketer, artist, remixer) sit only when the user names them with --seats. Use when the user asks to judge, evaluate, pressure-test or "council" an idea, or asks whether an idea is worth pursuing.
---

# The Council

Usage: `/wise-hive:council [--seats id,id,... | --seats saved | --seats ?] <idea>`. The idea is everything after the flags (or the idea under discussion). If there is no idea, ask for it in one line.

## 0. Who sits (read seat files only when needed)
- **No `--seats`**: the classic three below. Read no seat files. Never add a seat the user didn't name: each seat is one more subagent.
- **`--seats a,b,c`**: those seats in that order, 1 to 7. If every one is `believer`, `skeptic` or `investor`, use the classic briefs and read nothing. Otherwise read `{{BRAIN}}\app\council-seats.json` once: each entry in `seats` has `id`, `name`, `callsign`, `role`, `blurb` and `brief`; `aliases` maps other spellings to ids (`playtester` is `player`, `builder` is `engineer`, `future-you` is `future`, ...). Drop unknown or repeated ids and say which were dropped.
- **`--seats saved`**: the seats saved in The Wise Hive app, from `seats` in `{{BRAIN}}\app-settings\council.json` (the classic three if it's missing). Then as above.
- **`--seats` alone or `--seats ?`**: read council-seats.json, show the seats as a table (id, name, blurb), and stop.
- If council-seats.json can't be read: the classic three, and say so.

Say in one line who sits.

### Classic briefs
- **Believer** (callsign BELIEVER): make the strongest honest case that the idea works: who exactly buys or plays it, the painful problem it solves, why now, how to reach the first 100 customers or players.
- **Skeptic** (SKEPTIC): attack the idea: competitors and substitutes, why people won't pay or play, build cost and risk, platform or legal risk, hidden assumptions. Rank the top 3 fatal risks first.
- **Investor** (INVESTOR): size the opportunity: rough market size with reasoning, business model and pricing, moat, what it becomes in 3-5 years, and the milestone that would make you invest.

## 1. The seats, in parallel
Launch one subagent per seat in ONE message with the Agent tool (so they run at the same time). Tell each: "You are the <callsign> on an idea council. <brief> Short headings and bullets, under <W> words." W is 250 for up to 3 seats, 200 for 4-5, 150 for 6-7. Give each the idea, and tell each to read `{{BRAIN}}\INDEX.md` and any memory or project note that matters, so it argues with what the hive knows about the user. They must not edit anything.

Show each answer under `## <name>`, in seat order.

## 2. The Judge
Then judge it yourself, fairly weighing every seat that sat. An angle no seat covered counts neither for nor against the idea. Start with this line exactly:

`VERDICT: PURSUE|PIVOT|PASS | SCORE: N/10`

Then `## Why`, `## What would change my mind`, `## Next 3 steps`. Under 300 words. If the user pushes back afterwards, re-judge honestly and restate the VERDICT line first.

## 3. Save the debate
Write the whole debate to `{{BRAIN}}\council\<YYYY-MM-DD>_<short-slug>.md` (create the folder if needed; if that file exists, add `-2`, `-3`, ...) with `# Council: <idea>`, then `## <name>` for each seat in order, then `## Judge`. The Wise Hive app's Council shares this folder. Tell the user where it was saved.
