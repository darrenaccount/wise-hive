# The Wise Hive Lite

**Claude's long-term memory and agent team on your Windows PC, built to use as little of your Claude usage as possible.**

## Install it by asking Claude

> **Install only one edition.** This is Lite; [the full The Wise Hive](https://github.com/darrenaccount/wise-hive/tree/main/1-wise-hive) is the other. Don't install both. To switch later, just install the other one: it replaces this one and keeps your memory.

New to this? Follow the step-by-step guide: **[INSTALL.md](INSTALL.md)**.

Open the **Claude desktop app**, start a chat in the **Code** tab, and paste:

> Install The Wise Hive Lite from https://github.com/darrenaccount/wise-hive/tree/main/2-wise-hive-lite

Claude reads the instructions below, asks you where to keep the memory folder, and does the rest (about 5 minutes). When it's done, start a new chat.

Or run this in PowerShell yourself:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/darrenaccount/wise-hive/main/2-wise-hive-lite/get.ps1))) -InstallMissing
```

**Switching editions:** install the other one the same way. Both use the same brain folder, so your memories, notes and chats carry over; only the app and skills change.

## About

The Wise Hive Lite is the lighter edition of [The Wise Hive](https://github.com/darrenaccount/wise-hive/tree/main/1-wise-hive). You get the same memory, the same brain folder, the same desktop app and the same `/wise-hive` skills. The difference is that the helper agents are trimmed down so your plan's usage limit lasts much longer. Pick Lite if you want your usage to go further, share your limit with a lot of normal Claude work, or just want The Wise Hive without the extra cost. (On Max, the full edition works best.)

**Memory:** a brain folder on your PC holds Claude's memories, project notes, lessons and a readable copy of every conversation. Every new chat reads it first, whether in the Claude desktop app, Claude Code in a terminal, or The Wise Hive app. Your existing Claude memories and past chats are copied in when you install. The folder also opens as an Obsidian vault, with a plugin to ask The Wise Hive questions from your notes.

**Agents:**
- **Council:** up to 13 seats (Believer, Skeptic, Investor, Playtester, Roblox economist, Competitor and more) debate your idea, and a Judge rules.
- **Brainstorm:** researches an idea and writes a plan.
- **Training:** practises skills on its own, even overnight. It watches YouTube tutorials, rebuilds what they teach in Blender or Roblox Studio, and saves the lessons for every future chat. You choose the Claude model and the subjects.
- **Working:** keeps improving one of your projects while you're away. It works on a safe git branch, with a card for every round and a Keep or Discard review.
- **The Boss:** grades every Training and Working round out of 10 from the real result, and sends weak work back for a fix (once per task in Lite).
- **Librarian, Organizer and Trimmer:** keep the memory tidy.
- **Chat helpers:** the Refiner sharpens your prompts, the Clarifier catches what's unclear, and the Inventor suggests next ideas. All three are optional.

**Taste library:** everything the agents make for you to judge, ready to look at. Models spin in colour, animations and VFX play as looping videos, web pages show as pictures, and code is one click away. Approve, deny or comment; comments send work back for a new version, and Claude learns your taste style by style from your reasons.

**Desktop app:** a pixel-art home for all of it.
- Full-power Claude chats, with pictures from chats saved, chat search, a sketch board, and a "while you were away" summary.
- An activity panel showing what's running.
- Plugins and skill building.
- Updates that follow new Claude Code versions (in Lite, you press Re-adapt).
- Usage guards: pause near your plan limit, daily caps, quiet hours, and pausing while you game.
- It lives in the tray, restarts itself if it stops, and talks to your Claude desktop chats.

Everything also works as Claude skills (`/wise-hive:council`, `:brainstorm`, `:train` and more) in any Claude chat. It runs on your own PC with your own Claude account, and nothing is uploaded.

## The Wise Hive vs The Wise Hive Lite

| | The Wise Hive | **The Wise Hive Lite** |
|---|---|---|
| Memory and transcripts | ✓ | ✓ (identical) |
| Memory loaded when a chat starts | the whole recall (~72,000 characters: index, lessons and knowledge notes) | **the essentials only** (~8,600 characters: the index, skills and lesson list); matching notes still arrive with each message |
| Each helper run (Clarifier, Inventor, Refiner, Council, planner) starts with | ~45,000 tokens (all of Claude Code: every tool, MCP server, skill and hook) | **~6,000 tokens** (only the tools the helper needs, plus your memory index) |
| Clarifier (checks your prompt for misunderstandings) | every message, Sonnet, up to 4 questions | **first message of a chat or long prompts only**, Haiku, up to 2 questions |
| Inventor (Claude's take + next ideas) | after every reply, Sonnet, up to 3 ideas | **only when you press Get ideas**, Haiku, up to 2 ideas |
| Council (3 seats by default, 1-5 in Lite, + Judge) | 1 run per seat + 1 on your default model, each started without tools or MCP servers | 1 trimmed Sonnet run per seat + 1; the `/wise-hive:council` skill writes every voice in one answer |
| Training and Working rounds | your default model, up to 80 turns, up to 3 helper agents | **Sonnet unless you pick a model, up to 30 turns, 1 helper agent** |
| Planner that picks each round's task | Sonnet | **Haiku**, trimmed |
| The Boss (grades every round) | on at 8/10, up to 2 redos per task | **off until you turn it on**, 1 redo per task, on Sonnet |
| Questions asked from Obsidian | a full Claude chat | **a small read-only helper** (tasks still get a full chat) |
| Usage guard for the autopilot loops | pauses at 97% of your plan limit | **pauses at 75%** (change it in the app) |
| Prompt-library tidy-up | every 12 refined prompts | every 40 |
| Adapting to Claude Code updates | automatic | **you press Re-adapt** |

In our measurements a trimmed helper run used about 7× fewer tokens than a full one, and with the Clarifier and Inventor no longer running on every message, Lite adds only a small amount on top of the chat itself. The main chats are exactly as capable as in full The Wise Hive; only the helpers around them are lighter.

The app shows a gold **LITE** badge under the logo, the window and shortcut are named **The Wise Hive Lite**, so it's easy to tell which one you have.

## What you get
- **A brain folder** (default `%USERPROFILE%\ClaudeBrain`) with Claude's memories, project notes, lessons and a readable copy of every conversation. Every new chat starts by reading it. Your existing Claude memories and past chats are copied in when you install.
- **Skills in every Claude chat:** `/wise-hive:council`, `:brainstorm`, `:refine`, `:clarify`, `:ideas`, `:tidy`, `:organize`, `:train`, `:work`, `:updates`, `:blender-modeling`.
- **The Wise Hive Lite desktop app:** chats with full Claude Code power, the Council, Library, Training and Working loops, Brainstorm, Plugins, Activity and more, in a pixel-art castle that lives in your tray.
- **Game-dev extras:** Blender modeling with a reviewer pass, Roblox Studio work, and training that can watch tutorial videos (`-WithVideo`).

Everything runs on your PC with your own Claude account. Nothing is uploaded anywhere by The Wise Hive.

## Requirements
- Windows 10 or 11, and a Claude account (Pro or Max)
- The **Claude Code CLI** and **Node.js**: the installer adds both with `-InstallMissing`. If The Wise Hive chats say you're not logged in, open a terminal and run `claude` once to sign in.

## Installer options
| Option | What it does |
|---|---|
| `-Brain <folder>` | Where the memory lives. Default `%USERPROFILE%\ClaudeBrain`, or the existing install when updating. |
| `-InstallMissing` | Install Node.js and the Claude Code CLI if they're missing. |
| `-WithVideo` | Let training rounds watch tutorial videos (installs yt-dlp, FFmpeg and the [Watch plugin](https://github.com/bradautomates/claude-video)). |
| `-NoApp` | Only the memory, hooks and skills; no desktop app. |
| `-NoImport` | Don't copy in existing Claude memories and past conversations. |
| `-NoStart`, `-NoWatchdog` | Don't open the app at the end; don't add the task that restarts it if it stops. |

**Update:** run the install command again; your memories and notes are never overwritten.
**Uninstall:** `powershell -ExecutionPolicy Bypass -File "%USERPROFILE%\.wise-hive\source\uninstall.ps1"` (keeps your brain folder).

## What the installer changes
- Creates the brain folder with the app (`app\`), hooks (`tools\`) and skills plugin (`marketplace\`).
- `%USERPROFILE%\.claude\settings.json` (backed up to `settings.json.before-teamwright`): memory folder, a recall hook at chat start, save-transcript hooks, longer chat history, the brain as an allowed folder.
- `%USERPROFILE%\.claude\CLAUDE.md`: a marked The Wise Hive section.
- The `wise-hive` plugin, Desktop and Start-menu shortcuts, start-with-Windows, and a "Teamwright watchdog" scheduled task.

Your brain folder is personal: back it up, but don't publish it.

---

## For Claude: how to install The Wise Hive Lite

You are installing The Wise Hive Lite for the user from https://github.com/darrenaccount/wise-hive/tree/main/2-wise-hive-lite. Follow these steps exactly.

1. **Check the platform.** The Wise Hive Lite is Windows-only. On another OS, tell the user and stop.
2. **Ask the user two things** (one message, with defaults so they can just say "go"):
   - Where to keep the memory folder (default `%USERPROFILE%\ClaudeBrain`).
   - Whether to install missing requirements (Node.js via winget, the Claude Code CLI via the official claude.ai installer), and whether they want tutorial-video watching for training (`-WithVideo`).
3. **Run the installer** with the PowerShell tool, as one command, in the foreground with a 10-minute timeout:
   ```powershell
   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/darrenaccount/wise-hive/main/2-wise-hive-lite/get.ps1))) -Brain "<folder>" -InstallMissing
   ```
   Add `-WithVideo` if they asked for it; drop `-InstallMissing` if they declined. Don't do the steps by hand: the script merges their settings safely.
4. **Read the output.** It ends with "Done" and may list "Things to look at"; explain those in plain words. If it stopped with an error, say what failed and what to do; don't edit their settings.json by hand.
5. **Tell the user what's next:** start a **new** Claude chat (hooks and `/wise-hive:*` skills load at chat start), open The Wise Hive Lite from the Desktop shortcut, and try `/wise-hive:council <an idea>`. Mention that the brain folder is personal and worth backing up.

Never start the app with `Start-Process` from a Claude session; the installer starts it correctly through `app\start.ps1`.

---

Made by [darrenaccount](https://github.com/darrenaccount). MIT licensed. Full edition: [The Wise Hive](https://github.com/darrenaccount/wise-hive/tree/main/1-wise-hive). Video watching uses [claude-video](https://github.com/bradautomates/claude-video) by Bradley Bonanno.
