<!-- teamwright:start (added by The Wise Hive installer; uninstall.ps1 removes this section) -->
# Long-term memory: {{BRAIN}}

The user wants Claude to remember past work instead of re-learning it. Everything lives in `{{BRAIN}}` (see its README.md). This applies in every project.

## Before starting real work
1. Read `{{BRAIN}}\INDEX.md` (map of what's stored).
2. If the task touches a known project or topic, read the matching file in `projects\` or `knowledge\`.
3. If it relates to something done before, search the full past conversations: `Grep` in `{{BRAIN}}\transcripts\readable\` (one file per session; `transcripts\LOG.md` lists them by date, project and first request). Prefer these exact records over guessing.
4. Blender work: use the `wise-hive:blender-modeling` skill first. It reuses tested scripts from `{{BRAIN}}\blender\scripts\`.
5. Roblox work: check `{{BRAIN}}\roblox\` for saved scripts and notes.

## After finishing real work
- Save working code worth reusing as files (Blender: `blender\scripts\`, Roblox: `roblox\scripts\`), with a short header comment saying what it does and when it was verified.
- Record what happened in the right place: project state in `projects\<name>.md`, lessons in `knowledge\<topic>.md`, Blender build records in `blender\builds\`.
- Record mistakes and their fixes, not just successes.
- Update `INDEX.md` if you added a new file.
- Full transcripts are saved automatically by a hook; don't duplicate them.

Keep notes specific (paths, commands, error text, the fix), not vague summaries.

## The Wise Hive agents
The `wise-hive` plugin's skills share this folder with The Wise Hive app: `/wise-hive:council`, `:brainstorm`, `:refine`, `:clarify`, `:ideas`, `:tidy`, `:organize`, `:train`, `:work`, `:updates`, `:blender-modeling`.

## Talking to The Wise Hive app
The Wise Hive desktop app (`{{BRAIN}}\app`, server on 127.0.0.1:4747) and Claude Desktop sessions stay in touch:
- Messages from The Wise Hive arrive as a peer message starting with `[From The Wise Hive app]`. Treat them as coming from the user (they type them in the app). Reply with:
  `powershell -NoProfile -File {{BRAIN}}\tools\to-app.ps1 -ReplyTo <id> -Text "<reply>"`
- To hand The Wise Hive a task (it starts a chat there right away, even with the window closed):
  `powershell -NoProfile -File {{BRAIN}}\tools\to-app.ps1 -Task -Folder "<project folder>" -Mode edit -Text "<the full task>"`
- Never start The Wise Hive with `Start-Process` from a Claude session: it would run inside that session's job and app container. Use `powershell -File {{BRAIN}}\app\start.ps1` (`-Restart` after code changes).
<!-- teamwright:end -->
