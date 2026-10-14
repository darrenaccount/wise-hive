# The Wise Hive change log

Newest first. Details, decisions and mistakes for each item are in `<brain>\projects\wise-hive.md`.

## 2026-10-13 — activity panel, council seats, chat media, round cards, Taste, usage savers
Branches (stacked, not merged into main yet): activity-panel → council-seats → chat-media → working-cards →
taste-library → taste-tab.

- **Live activity panel** (right column): every job The Wise Hive starts (chats, Training/Working rounds and planners,
  Updates, the council and its members, Librarian, Organizer, Trimmer, Skillsmith) with subagents indented; status,
  time running, seconds since output, **tokens used**; amber after 3 min quiet, red after 10; "While you were away"
  (last 20, survives restarts); header count; short job names (full name on hover); drag to resize; a small pixel strip
  (Queen + one worker per running job). Built only from The Wise Hive's own stdout stream (gate check: subagent
  `task_started` / `task_updated` / `task_notification` events with timestamps). restart-when-idle unaffected.
- **Council seats**: 13 seats (classic three + Playtester, Roblox economist, Bootstrapper, Engineer, Competitor,
  Future You, Moderator, Marketer, Artist, Remixer); add/remove/swap 1-7 seats (Lite 1-5), remembered; Swap a seat or
  hear one more after a verdict (2 runs); seats run without tools/MCP (~6.5k tokens to start instead of ~32k). A
  running council counts as busy for restarts. `/wise-hive:council --seats`.
- **Chat**: images and files Claude makes or mentions show inline (enlarge, Open/Show in folder/Copy path; strict
  allow-listed roots); right-click spelling suggestions, Add to dictionary, Cut/Copy/Paste.
- **Chat options**: a Helpers dropdown turns the Clarifier and Inventor on/off (their icons stay in the corner and open
  their results); **Usage saver** picks Haiku/Sonnet/Opus per prompt when the model is on Default (free rules); Agents:
  one agent / team / **team of cheaper helpers** (subagents on Haiku/Sonnet via the Agent tool's model parameter).
- **Working tab**: a round card per round (summary, what changed, how to undo, pictures before/after, open chat).
- **Taste tab** (its own tab): curates the user's taste for any kind of work — 3D models (spin view), images, graphic
  and UI designs, pixel art, audio, video, text, **lighting** (before/after per fixed camera view, settings diff,
  presets, Undo in Studio). **Styles** (one short summary each; picked by the user or the planner). Claude iterates with
  many screenshots and a critic before anything reaches the queue (critic on by default; off in Lite); the user only
  approves, denies or **comments** (a comment sends it back for a linked revision). Fed by Training, Working, chats and
  uploads. Verdicts can only be saved from The Wise Hive window. Stored in `<brain>\taste\` (moved from
  `training\taste\` with a backup).
- **Library**: **Trim notes** (asks first; rewrites notes in fewer words, backs up, a free check puts back any file
  that lost a path/command/link/header, undo per file) and the **Skillsmith** (turns proven lessons into skills; a
  separate reviewer must score 8/10+; project-only skills go into `<project>\.claude\skills`; remove = move to backup).
- **Left rail**: drag tabs to reorder (saved; Home stays on top).
- **The Wise Hive Lite** switch (`app\edition.json`): lean helpers, fewer automatic runs (also in the public Lite release).
- Note: commit 70e7b2d (Trim notes) also carried the Working build's optional git identity for rounds (startChat
  `env`), committed early by mistake; harmless, and its autopilot.js half landed in the Working commits.
- **Usage savings the user approved** (from the usage audit; nothing that weakens a feature):
  - Full and Lite: Clarifier, Refiner and Inventor start lean (same models), with the hive's projects, about-the-user
    and the whole memory index as a cached system prompt (`hiveContext()`), ~32k -> ~8k tokens to start.
  - Full and Lite: Training, Working and Updates runs can't schedule wake-ups or cron jobs and wait for their own
    subagents (fixes rounds ending on a stale wake-up reply).
  - Lite only: no Refiner on short follow-ups, lean Librarian/Organizer, tutorial videos inside one subagent, and a
    cheap read-only "reviewer" subagent type for each round's check.
  - Declined: Sonnet workers, Sonnet council seats, Haiku Clarifier/Inventor in full.
- **Memory recall fix** (`tools\recall.ps1`): it built ~24,000 characters and Claude Code cuts session-start context
  over 10,000 to a 2 KB preview, so sessions lost most of their recall. It now stays under 9,500 (INDEX, skills, one-line
  pointers to lessons and knowledge, recent real sessions; skips MEMORY.md when Claude Code loads it itself). Verified:
  a new session sees every section and no "too large" note.
- **Smart split + per-message recall** (`tools\recall.js`, replaces recall.ps1 in settings.json): the 10,000 limit is
  per hook, so start-up recall is 14 SessionStart hooks that each send one ≤9,300-char part (core index; all knowledge
  notes; the full Blender lessons only in Blender/Roblox folders, the app's project folders, or Training rounds via
  `TEAMWRIGHT_RECALL=blender`). App chats get ~32k chars, game chats ~90k. A UserPromptSubmit hook adds up to 5
  matching memories/lessons/project notes (≤3,000 chars) to each message, never repeating one in the same chat. The
  public installer registers the same hooks (old recall.ps1 entries replaced, other hooks kept, uninstall removes them).
