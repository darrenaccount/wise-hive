# ClaudeBrain

Claude's long-term memory on this PC, made by [The Wise Hive](https://github.com/darrenaccount/wise-hive). Claude has no memory between chats by itself. Everything it should remember is stored here as plain files, and every Claude Code session (desktop app, terminal, or The Wise Hive app) is told to read it.

## What's here

| Folder | What it holds | Who writes it |
|---|---|---|
| `INDEX.md` | Map of everything; read first each session | Claude |
| `memory\` | Claude Code's memory: facts, preferences, project notes. `MEMORY.md` is the index | Claude |
| `transcripts\raw\` | Exact copy of every session (`.jsonl`) | Automatic (hook) |
| `transcripts\readable\` | Same sessions as readable Markdown, one file each | Automatic (hook) |
| `transcripts\LOG.md` | Table of all sessions: date, project, first request | Automatic (hook) |
| `knowledge\` | Lessons by topic | Claude |
| `projects\` | Current state of each project | Claude |
| `blender\` | `LESSONS.md`, reusable `scripts\`, build records in `builds\` | Claude |
| `roblox\` | Reusable Roblox scripts and notes | Claude |
| `council\`, `brainstorms\`, `ideas\`, `prompts\`, `training\`, `working\` | What The Wise Hive agents produce | The Wise Hive |
| `app\` | The Wise Hive desktop app | Installer |
| `tools\` | Hooks: `recall.ps1` (session start), `save-transcript.ps1` (after each reply) | Installer |
| `marketplace\` | The `wise-hive` skills plugin for Claude Code | Installer |
| `app-settings\` | Your private app settings (`teamwright.json`: extra project folders, git name) | You / the app |

## How it's wired
- `~/.claude/settings.json`: `autoMemoryDirectory` points Claude's memory at `memory\`; a `SessionStart` hook runs `tools\recall.ps1`; `Stop` and `SessionEnd` hooks run `tools\save-transcript.ps1`; `cleanupPeriodDays: 3650` keeps old chats.
- `~/.claude/CLAUDE.md` has a Wise Hive section telling every session to use this folder.

## If something breaks
- Transcripts not appearing: check `transcripts\hook-errors.log`.
- Turn it all off: run `uninstall.ps1` from The Wise Hive download (keeps this folder).
- Back this folder up (OneDrive, a USB drive or a private git repo). It's the only copy of the memory, and it's personal: don't publish it.
