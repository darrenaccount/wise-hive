# The Wise Hive

**The Wise Hive gives Claude a long-term memory and a team of agents on your Windows PC.**

## Install it by asking Claude

> **Install only one edition.** This is the full edition; [The Wise Hive Lite](https://github.com/darrenaccount/wise-hive/tree/main/2-wise-hive-lite) is the other. Don't install both. To switch later, just install the other one: it replaces this one and keeps your memory.

New to this? Follow the step-by-step guide: **[INSTALL.md](INSTALL.md)**.

Open the **Claude desktop app**, start a chat in the **Code** tab, and paste:

> Install The Wise Hive from https://github.com/darrenaccount/wise-hive/tree/main/1-wise-hive

Claude reads the instructions below, asks you where to keep the memory folder, and does the rest (about 5 minutes). When it's done, start a new chat and you're set.

Prefer doing it yourself? Open PowerShell and run:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/darrenaccount/wise-hive/main/1-wise-hive/get.ps1))) -InstallMissing
```

## About

**Memory:** a brain folder on your PC holds Claude's memories, project notes, lessons and a readable copy of every conversation. Every new chat reads it first, whether in the Claude desktop app, Claude Code in a terminal, or The Wise Hive app. Your existing Claude memories and past chats are copied in when you install. The folder also opens as an Obsidian vault, with a plugin to ask The Wise Hive questions from your notes.

**Agents:**
- **Council:** up to 13 seats (Believer, Skeptic, Investor, Playtester, Roblox economist, Competitor and more) debate your idea, and a Judge rules.
- **Brainstorm:** researches an idea and writes a plan.
- **Training:** practises skills on its own, even overnight. It watches YouTube tutorials, rebuilds what they teach in Blender or Roblox Studio, and saves the lessons for every future chat. You choose the Claude model and the subjects.
- **Working:** keeps improving one of your projects while you're away. It works on a safe git branch, with a card for every round and a Keep or Discard review.
- **The Boss:** grades every Training and Working round out of 10 from the real result, and sends weak work back for a fix.
- **Librarian, Organizer and Trimmer:** keep the memory tidy.
- **Chat helpers:** the Refiner sharpens your prompts, the Clarifier catches what's unclear, and the Inventor suggests next ideas. All three are optional.

**Taste library:** everything the agents make for you to judge, ready to look at. Models spin in colour, animations and VFX play as looping videos, web pages show as pictures, and code is one click away. Approve, deny or comment; comments send work back for a new version, and Claude learns your taste style by style from your reasons.

**Desktop app:** a pixel-art home for all of it.
- Full-power Claude chats, with pictures from chats saved, chat search, a sketch board, and a "while you were away" summary.
- An activity panel showing what's running.
- Plugins and skill building.
- Updates that follow new Claude Code versions, with automatic rollback if something breaks.
- Usage guards: pause near your plan limit, daily caps, quiet hours, and pausing while you game.
- It lives in the tray, restarts itself if it stops, and talks to your Claude desktop chats.

Everything also works as Claude skills (`/wise-hive:council`, `:brainstorm`, `:train` and more) in any Claude chat. It runs on your own PC with your own Claude account, and nothing is uploaded.

> **Want it to use less of your Claude usage?** Try [Wise Hive Lite](https://github.com/darrenaccount/wise-hive/tree/main/2-wise-hive-lite): the same memory and app, with trimmed-down helper agents that run less often (about 7× fewer tokens per helper run). Both use the same brain folder, so you can switch any time.

## What you get

| | |
|---|---|
| **Memory that persists** | A brain folder (default `%USERPROFILE%\ClaudeBrain`) with Claude's memories, project notes, lessons and a readable copy of every conversation. Every new chat starts by reading it. Your existing Claude memories and past chats are copied in when you install. |
| **The Wise Hive skills** in every Claude chat | `/wise-hive:council` (Believer, Skeptic and Investor debate an idea by default, or pick seats like a Playtester, Roblox economist or Competitor with `--seats`; a Judge rules), `/wise-hive:brainstorm` (research only, writes a plan), `/wise-hive:refine` (turns a rough prompt into a precise one), `/wise-hive:clarify` (finds what's ambiguous before work starts), `/wise-hive:ideas` (honest take plus next ideas), `/wise-hive:tidy` and `/wise-hive:organize` (keep the memory clean), `/wise-hive:train` and `/wise-hive:work` (practise a skill or improve a project), `/wise-hive:updates`, `/wise-hive:blender-modeling`. |
| **The Wise Hive desktop app** | A pixel-art home for all of it: chats with full Claude Code power, the Council with its gavel, the Library, Training and Working that keep going while you're away (overnight practice, autonomous project work on a safe git branch), Brainstorm, Plugins, Updates, Activity and more. Lives in the tray and talks to your Claude desktop chats. |
| **The Boss** | A strict reviewer that scores every Training and Working round out of 10 from the real result (the code changes, or the renders the round made). Below your bar, the next round fixes exactly its list, at most twice per task. Set it per tab: 7, 8 (default), 9 or Off. |
| **The Taste library** | Everything Claude makes for you to judge, ready to look at: 3D models become colour turntables you can spin, animated scenes and VFX play as looping videos, web pages show as pictures (and videos when they move), code and notes are one click away. Approve, deny or comment; Claude learns your taste from the reasons. |
| **Game-dev extras** | Blender modeling with a reviewer pass and a growing script library, Roblox Studio work, and training rounds that can watch tutorial videos (`-WithVideo`). Pick which model Training uses and which subjects it practises (props, buildings, VFX, Roblox UI and more). |
| **Obsidian** | The memory folder opens as an Obsidian vault, with a plugin to ask The Wise Hive questions from your notes. |

Everything runs on your PC with your own Claude account. Nothing is uploaded anywhere by The Wise Hive.

## Requirements
- Windows 10 or 11
- About **550 MB of free disk space**: the download itself is a few MB, and setup adds the desktop app engine (Electron, about 150 MB download). `-WithVideo` needs extra space for Python, yt-dlp and FFmpeg.
- A Claude account (Pro or Max recommended: the agents use real Claude sessions)
- The **Claude Code CLI** and **Node.js**. The installer adds both if you use `-InstallMissing` (Node.js through winget, Claude Code through its official installer). The first time, open a terminal and run `claude` once to sign in if The Wise Hive chats say you're not logged in.

## Installer options

`install.ps1` (and `get.ps1`, which downloads it first) accepts:

| Option | What it does |
|---|---|
| `-Brain <folder>` | Where the memory lives. Default `%USERPROFILE%\ClaudeBrain`, or the existing install when updating. |
| `-InstallMissing` | Install Node.js and the Claude Code CLI if they're missing. |
| `-WithVideo` | Let training rounds watch tutorial videos: installs yt-dlp, FFmpeg and the [Watch plugin](https://github.com/bradautomates/claude-video). |
| `-NoApp` | Only the memory, hooks and skills; no desktop app. |
| `-NoImport` | Don't copy in existing Claude memories and past conversations. |
| `-NoStart`, `-NoWatchdog` | Don't open the app at the end; don't add the task that restarts it if it stops. |

**Update:** run the same install command again. Your memories and notes are never overwritten.
**Uninstall:** `powershell -ExecutionPolicy Bypass -File "%USERPROFILE%\.wise-hive\source\uninstall.ps1"`. It removes the hooks, skills, app shortcuts and background task, and keeps your brain folder.

## What the installer changes
- Creates the brain folder and puts the app (`app\`), hooks (`tools\`) and skills plugin (`marketplace\`) in it.
- `%USERPROFILE%\.claude\settings.json` (backed up to `settings.json.before-teamwright`): `autoMemoryDirectory` → the brain's `memory\`; a SessionStart hook (recall) and Stop/SessionEnd hooks (save the transcript); `cleanupPeriodDays: 3650` so old chats aren't deleted; the brain as an extra allowed folder.
- `%USERPROFILE%\.claude\CLAUDE.md`: adds a marked The Wise Hive section telling every chat how to use the brain.
- Installs the `wise-hive` plugin from the brain's local marketplace.
- Adds Desktop and Start-menu shortcuts, start-with-Windows (tray), and a "Teamwright watchdog" scheduled task.

Your brain folder is personal: back it up, but don't publish it.

---

## For Claude: how to install The Wise Hive

You are installing The Wise Hive for the user from https://github.com/darrenaccount/wise-hive/tree/main/1-wise-hive. Follow these steps exactly.

1. **Check the platform.** The Wise Hive is Windows-only. On another OS, tell the user and stop.
2. **Ask the user two things** (one message, with defaults so they can just say "go"):
   - Where to keep the memory folder (default `%USERPROFILE%\ClaudeBrain`; suggest another drive if they prefer).
   - Whether to install missing requirements (Node.js via winget, Claude Code CLI via the official claude.ai installer), and whether they want tutorial-video watching for training (`-WithVideo`, installs yt-dlp and FFmpeg).
3. **Run the installer** with the PowerShell tool, as one command, in the foreground (it can take several minutes while it downloads Electron; use a 10-minute timeout):
   ```powershell
   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/darrenaccount/wise-hive/main/1-wise-hive/get.ps1))) -Brain "<folder>" -InstallMissing
   ```
   Add `-WithVideo` if they asked for it; drop `-InstallMissing` if they declined (the installer then stops with a clear message if something is missing). Don't run the steps by hand instead: the script handles merging their settings safely.
4. **Read the output.** It ends with "Done" and may list "Things to look at". Explain any of those in plain words. If it stopped with an error, tell the user what failed and what to do; don't edit their settings.json by hand.
5. **Tell the user what's next:** start a **new** Claude chat (the hooks and `/wise-hive:*` skills load at chat start), open The Wise Hive from the Desktop shortcut, and try `/wise-hive:council <an idea>`. Mention that their brain folder is personal and worth backing up.

Never start the app with `Start-Process` from a Claude session (it would die with the session); the installer starts it correctly through `app\start.ps1`.

---

Made by [darrenaccount](https://github.com/darrenaccount). MIT licensed. Video watching uses [claude-video](https://github.com/bradautomates/claude-video) by Bradley Bonanno.
