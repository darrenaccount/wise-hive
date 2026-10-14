---
name: work
description: Run The Wise Hive Foreman - pick and build the next well-scoped improvement to a project (e.g. a Roblox game or a website) on its own, safely on a git branch, logging every change; either one task here or continuously via The Wise Hive app. Use when the user asks Claude to keep working on, improve or add to a project by itself, or to work while they're away.
---

# The Foreman

The project is the folder or game the user named, with any direction they gave. If they didn't name one, take the project they worked on most recently (`{{BRAIN}}\INDEX.md`, `projects\`, `transcripts\LOG.md`) and say which one you picked.

## Continuous or one task?
- If the user wants it to keep going (overnight, "until I stop it", "while I'm away"), hand it to The Wise Hive app's always-on loop. It survives this window closing and keeps the PC awake:
  ```powershell
  $b = [Text.Encoding]::UTF8.GetBytes((@{ goal = "<their direction>"; permission = "safe"; project = "<project folder>" } | ConvertTo-Json -Compress))
  Invoke-RestMethod http://127.0.0.1:4747/api/autopilot/working/start -Method Post -Headers @{ "X-Hive" = "1" } -ContentType "application/json" -Body $b
  ```
  Tell the user to watch it in The Wise Hive's Working tab and end it with **End work** (or POST `.../api/autopilot/working/stop`). If the app isn't reachable, run `powershell -File {{BRAIN}}\app\start.ps1 -NoWindow` first.
- Otherwise, do **one task** here (below). For repeated tasks in this window, suggest `/loop 30m /wise-hive:work <project>`.

## One task
The Wise Hive Lite: keep the task small, work yourself, and use at most one subagent, only for a short review at the end.

1. **Plan.** Look at the project (`CLAUDE.md`, `DECISIONS.md`, README, recent git log, `{{BRAIN}}\projects\`, `{{BRAIN}}\working\<project>\log.md`). Think of your own ideas for what to build or improve next (features, content, polish, fixes, tests), and pick ONE well-scoped task. Say what and why in two lines.
2. **Rules**:
   - Keep the task small, and finish it. Follow the project's CLAUDE.md conventions.
   - If the folder is a git repo, work on the branch `teamwright/autowork`: create it from the current branch if missing, otherwise switch to it. Never push, force or rewrite history. Leave uncommitted changes that aren't yours alone. Commit your own changes at the end with a clear message.
   - If the project keeps a change log or ledger (AgentLedger, DEVLOG, patch notes), add an entry.
   - Roblox Studio changes are live, so record exactly what you changed so it can be undone.
   - Never publish the game or change its settings or monetization. Don't delete the user's work.
   - Test what you changed if you can.
3. **Log it.** Append a block to `{{BRAIN}}\working\<project-slug>\log.md` in the same shape The Wise Hive app writes for its rounds (blank line before it; `Changed:` items indented by two spaces):
   ```
   ## In chat · <YYYY-MM-DD HH:MM> · <focus> · <title>
   Summary: what you did and what it means, in plain English
   Changed:
     - one line per file or Studio place, and what changed
   Undo: exactly how to undo it (the commit on teamwright/autowork, or the Studio steps)
   Next: 1-3 ideas for the next round
   ```
4. **Critique and Taste** (the user judges visible work in The Wise Hive app's Taste tab; you never approve it yourself):
   - At the end, have a separate critic (an Agent subagent, fresh eyes, read-only) review the work against the task's goal (for anything the user sees: from many screenshots or renders, and against the project's Taste style); fix its must-fix issues or list them, and put its score and must-fix list in the log block as `Critique:`. (The Wise Hive Lite, or the critic switched off in the Taste tab: one short self-check.)
   - **Style**: the one the user named, else the project's pick or the best fit from `{{BRAIN}}\taste\taste.md`; read only its `{{BRAIN}}\taste\styles\<style>\summary.md`.
   - If the task made something judged by eye or ear (UI, art, pixel art, a sound, lighting, a model), hand in its FINAL version: a folder `{{BRAIN}}\taste\inbox\<short-name>\` with its files (or full paths) and item.json written LAST: `{"kind":"image|pixel|audio|video|text|lighting|model|other","title":"..","style":"<id>","source":{"type":"working","project":"<name>"},"files":[".."],"about":"..","critique":{"score":7,"summary":"..","mustFix":[],"fixed":[],"passes":2}}`.
   - **Lighting** (Roblox Studio or Blender): only in a test place unless the user named the place; never publish. Save the old values first (`{{BRAIN}}\roblox\scripts\taste_lighting.luau`: run it with execute_luau, then `print(snapshot())`; `camera()` saves/moves fixed camera views; `restore(json)` puts a snapshot back). Shoot the same 3-6 views before and after; hand it in as kind "lighting" with lighting.json (`platform`, `place`, `test`, `views` with before/after pictures, `before`/`after` snapshots, `undo`). The Taste tab shows the diff and an Undo script.
5. Finish with a 3-6 line summary.
