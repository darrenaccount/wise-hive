# The Wise Hive app: map for Claude

A local Windows desktop app. `main.js` (Electron 44, the exe is `node_modules\electron\dist\WiseHive.exe`) runs `server.js`
in-process: a dependency-free Node HTTP server on `127.0.0.1:4747` that serves the page in `public\` and drives Claude Code
(`claude -p --output-format stream-json`). Everything it stores lives in the **brain** folder, one level above `app\`
(also an Obsidian vault). The app was called Hivemind, then Teamwright; see "Old names" below.

## Layout
| File | What it does |
|---|---|
| `main.js` | Window, tray, notifications, shortcuts, login item, single instance, page key; rolls back a failed update on start |
| `server.js` | HTTP server + API guard, chat runs (`startChat` two-way stream, `runClaude`/`askClaude` one-shot jobs), event streams, sessions/memories/library, Link, Librarian/Organizer/Refiner/Clarifier prompts, the module loader (list near the end) |
| `lib/fsx.js` | Shared file helpers: `writeFileAtomic` (tmp + rename) and `readJson`. Use them for every state file |
| `jobs.js` | Live activity panel (what runs right now, history) |
| `council.js` | Idea council: seats in parallel, then the Judge; roster in `council-seats.json` |
| `autopilot.js` | Training and Working loops (planner, rounds, usage gate, keep-awake); `usage.js` reads plan usage; `rounds.js` round cards; `review.js` Working's Keep/Discard review |
| `taste.js` | Taste library: work Claude made for the user to judge (items, styles, verdicts, critics, inbox, uploads) |
| `taste-view.js` | Makes Taste items viewable in the background: each .blend → `blender\taste_render.py` (spin + animation.mp4), each .html → screenshot (+ video if it moves); `view.json` per item |
| `updates.js` | Follows the Claude Code version, adapts the app with backup / verify / rollback |
| `media.js` | Pictures and files shown in chats (served by token) |
| `obsidian.js` | Obsidian bridge; the Obsidian plugin source is `obsidian-plugin\` (copied into the vault on start) |
| `ideas.js` Inventor · `brainstorm.js` · `search.js` chat search · `digest.js` "while you were away" · `memhealth.js` memory check · `cleanup.js` disk cleanup · `phone.js` phone access (own LAN server, `/papi` only) · `plugins.js` · `skillsmith.js` · `trim.js` Trimmer · `limits.js` · `edition.js` (full or lite) · `context-menu.js` | |
| `public\index.html` | Page markup only. Styles: `public\app.css`. Core script: `public\app.js` (shared helpers `$`, `api`, `esc`, `md`, `toast`, chats, Library, Activity, Link, Sketch, Settings, boot) |
| `public\*-client.js` | One per feature, loaded after app.js (classic scripts sharing app.js's top-level names) |
| `public\pixel.js`, `public\scenes\*.js` | Pixel-art canvas engine and its scenes |
| `test\` | `api-test.js` is the gate; unit tests are listed in `test\extra-routes.json` |

### Finding your way in the big files
They are split into sections marked `/* ---------- name ---------- */` (search for the name; line numbers drift):
- `server.js`: transcripts · memory, skills, stats · running Claude (`runClaude`, `askClaude`, `emit`, `subscribe`) · live chats
  (`startChat`) · sketch reader · projects and system status · link with the desktop app · librarian · organizer · prompt
  refiner · clarifier · http (guard, routes, static files, `PAGE_CSP`) · feature modules (`ctx`, `activeRuns`, module list).
- `public/app.js`: pixel mascots (`KIT`) · helpers · navigation (`show`) · shared data · home · chats (`switchTo`,
  `openSession`) · prompt refiner · running a chat (`sendPrompt`, `attachRun`, `onRunEvent`) · attachments · toasts ·
  clarifier · library · link · activity · projects · sketch board · settings & health · live updates · boot.
- `taste.js`: small file helpers · the move from training\taste · settings · verdicts (signed) · Training's state · items ·
  styles · the taste summaries · write side (page only) · critics and curator · the Taste curator · adding work (inbox,
  uploads, round cards, chats) · routes · prompt blocks for Training and Working.
- `autopilot.js`: state · cancellable waits · guards (usage cap, daily caps, quiet hours, gaming) · planner · worker · loop · actions.
- `updates.js`: state · version readers · check · snapshots and backups · git history · verify · adapt · restart · schedule ·
  after a restart · history view and restore · routes.

A feature module is `module.exports = (ctx) => ({ route(p, req, res, url), asset?(p, req, res), start?(), busy?() })`.
`ctx` is defined near the end of `server.js`. `busy()` counts work a restart must wait for.

## Rules that keep it working
- **Gate before every commit:** `node test/api-test.js` (starts its own server on a spare port and runs every unit test).
  All must pass with the same or higher counts. Fix the code, never weaken a test.
- **Adding a module:** add it to the module list in `server.js`, its client script to the end of `index.html`, its GET
  routes to `test\extra-routes.json`, and a unit test to the `unit` list there.
- **Restarting the app:** only `..\tools\restart-when-idle.ps1`, launched through WMI (`Invoke-CimMethod Win32_Process
  Create`). It waits until nothing is busy (`/api/activity` `busy`). Never `Start-Process` the app from a Claude session:
  it would live in that session's job object and app container and die with it.
- **API guard (`server.js`):** Host must be `127.0.0.1:<port>` or `localhost:<port>`; `/api/` needs header `X-Hive: 1` and
  no foreign Origin (`app://obsidian.md` may reach `/api/obsidian/` only). `asset()` handlers have no guard: check paths there.
- **The page has a Content-Security-Policy** (`PAGE_CSP` in `server.js`): no inline `<script>`, no inline event handlers
  (`onclick=`), no `eval`. Put script in `.js` files. Escape everything put into `innerHTML` with `esc()` (or `md()`).
- **State files:** write with `writeFileAtomic`; they are re-read at start.
- **Hidden agent sessions:** the app's own agents start their prompt with `You are the <NAME>` or a tag like
  `[Wise Hive training]`; the HIDE regexes (app.js, server.js, search.js) keep them out of Chats. New agents must follow
  that, and get a `JOB_LABEL` in server.js.
- **Unattended rounds** (autopilot.js) get an allowlist (`TOOLS`) and deny list (`NO_SCHEDULE`, `GIT_DENY`): keep git to the
  exact safe forms there.

## Old names (kept on purpose, don't "fix" them)
Git branch prefix `teamwright/autowork`, commit trailer `Teamwright-Round:`, app id `ClaudeBrain.Teamwright` (taskbar pin
and the login item's Run value), `%APPDATA%\teamwright`, `app-settings\teamwright.json`, `TEAMWRIGHT_*` env vars, the
scheduled task `Teamwright watchdog`, the firewall rule `Teamwright phone`, `teamwright-icon.ico`, localStorage `hive-*`.
Lines marked `keep-old-name` keep an old name on purpose.

## Where things are written up
The full feature history, decisions and verification notes are in the brain's `projects\wise-hive.md`.
