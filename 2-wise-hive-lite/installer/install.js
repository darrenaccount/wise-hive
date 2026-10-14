// The Wise Hive installer (Windows). Run through install.ps1 / uninstall.ps1, which check Node.js and Claude Code first.
//   node install.js [--brain <dir>] [--no-app] [--no-import] [--no-start] [--no-watchdog] [--claude-dir <dir>]
//   node install.js --uninstall [--brain <dir>] [--claude-dir <dir>]
// Safe to run again: it updates the app, tools and skills and never overwrites the user's memories or notes.
// No dependencies. Node 18+.
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const SRC = path.resolve(__dirname, "..");
const VERSION = (read(path.join(SRC, "VERSION")) || "0.0.0").trim();
const MARKET = "wise-hive-local";               // name of the local plugin marketplace in <brain>\marketplace
const PLUGIN = `wise-hive@${MARKET}`;
const TASK = "Teamwright watchdog";
const NAME = fs.existsSync(path.join(SRC, "app", "edition.json")) ? "The Wise Hive Lite" : "The Wise Hive";

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null; };
const HOME = os.homedir();
const CLAUDE_DIR = path.resolve(opt("claude-dir") || process.env.CLAUDE_CONFIG_DIR || path.join(HOME, ".claude"));
// Without --brain, reuse an existing install (found through settings.json's memory folder), else ~/ClaudeBrain.
function detectBrain() {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(CLAUDE_DIR, "settings.json"), "utf8"));
    const b = s.autoMemoryDirectory && path.dirname(path.resolve(s.autoMemoryDirectory));
    if (b && fs.existsSync(path.join(b, "app-settings", "install.json"))) return b;
  } catch {}
  return path.join(HOME, "ClaudeBrain");
}
const BRAIN = path.resolve(opt("brain") || detectBrain());
const fwd = (p) => p.replace(/\\/g, "/");
// Child processes (claude, npm) see the same Claude config folder as this installer.
const ENV = { ...process.env, ...(opt("claude-dir") ? { CLAUDE_CONFIG_DIR: CLAUDE_DIR } : {}) };

function read(p) { try { return fs.readFileSync(p, "utf8"); } catch { return null; } }
function write(p, s) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); }
const notes = [];   // things to tell the user at the end
const say = (s) => console.log(s);
const step = (s) => console.log(`\n== ${s}`);
const warn = (s) => { console.log(`   ! ${s}`); notes.push(s); };

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", env: ENV, windowsHide: true, timeout: 15 * 60 * 1000, ...opts });
  return { code: r.status, out: `${r.stdout || ""}${r.stderr || ""}`.trim(), error: r.error };
}
// One command line through the shell, without an args array (Node 24 warns, DEP0190, when both are given).
function shell(line, opts = {}) {
  const r = spawnSync(line, { encoding: "utf8", env: ENV, windowsHide: true, timeout: 15 * 60 * 1000, shell: true, ...opts });
  return { code: r.status, out: `${r.stdout || ""}${r.stderr || ""}`.trim(), error: r.error };
}
function claudeExe() {
  const local = path.join(HOME, ".local", "bin", "claude.exe");
  if (fs.existsSync(local)) return local;
  return shell("where claude").code === 0 ? "claude" : null;
}
// "claude" from PATH may be a .cmd shim, so it goes through the shell as one quoted line (no args array: DEP0190).
const q = (a) => (/^[\w@./:=-]+$/.test(String(a)) ? String(a) : `"${String(a).replace(/"/g, '\\"')}"`);
const claude = (args) => { const exe = claudeExe(); return !exe ? { code: 1, out: "Claude Code (claude) not found" } : exe === "claude" ? shell(["claude", ...args].map(q).join(" ")) : run(exe, args); };
const hasGit = () => shell("git --version").code === 0;

// ---------- files ----------
function copyDir(src, dst, { skip = () => false, overwrite = true, transform = null } = {}) {
  if (!fs.existsSync(src)) return 0;
  let n = 0;
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name), d = path.join(dst, name);
    if (skip(name, s)) continue;
    if (fs.statSync(s).isDirectory()) { n += copyDir(s, d, { skip, overwrite, transform }); continue; }
    if (!overwrite && fs.existsSync(d)) continue;
    fs.mkdirSync(dst, { recursive: true });
    if (transform && /\.(md|json|txt)$/i.test(name)) write(d, transform(fs.readFileSync(s, "utf8"), name));
    else fs.copyFileSync(s, d);
    n++;
  }
  return n;
}
const fillBrain = (text) => text.split("{{BRAIN}}").join(BRAIN);

const BRAIN_DIRS = ["memory", "projects", "knowledge", "transcripts/raw", "transcripts/readable", "blender/scripts", "blender/builds",
  "blender/practice", "roblox/scripts", "council", "brainstorms", "ideas", "prompts", "clarifier", "librarian", "organizer",
  "training/records", "training/sandbox", "working", "autopilot", "updates", "sketches", "uploads", "app-settings", "link", "digest"];

function makeBrain() {
  step(`Brain folder: ${BRAIN}`);
  const fresh = !fs.existsSync(path.join(BRAIN, "INDEX.md"));
  for (const d of BRAIN_DIRS) fs.mkdirSync(path.join(BRAIN, d), { recursive: true });
  const n = copyDir(path.join(SRC, "templates", "brain"), BRAIN, { overwrite: false, transform: fillBrain });
  say(fresh ? `   created it (${n} starter files)` : `   already there; kept everything in it (${n} missing starter files added)`);
  const cfg = path.join(BRAIN, "app-settings", "teamwright.json");
  if (!fs.existsSync(cfg)) write(cfg, JSON.stringify({ projectFolders: [], projectRoots: [], gitName: "The Wise Hive", gitEmail: "teamwright@localhost" }, null, 2) + "\n");
}

function gitCommit(dir, message) {
  if (!hasGit()) return;
  const g = (args) => run("git", ["-c", "user.name=The Wise Hive", "-c", "user.email=teamwright@localhost", ...args], { cwd: dir });
  if (!fs.existsSync(path.join(dir, ".git"))) g(["init", "-q"]);
  g(["add", "-A"]);
  const r = g(["commit", "-q", "-m", message]);
  if (r.code !== 0 && !/nothing to commit/i.test(r.out)) warn(`git commit in ${dir} failed: ${r.out.split("\n")[0]}`);
}

function installCode() {
  step("Installing the app and tools");
  const appDst = path.join(BRAIN, "app");
  if (path.resolve(SRC, "app") === path.resolve(appDst)) { say("   running from the brain itself; nothing to copy"); return; }
  // The app folder is a git repo: The Wise Hive's Updates agent keeps its history there. Save any local edits first.
  if (fs.existsSync(path.join(appDst, ".git"))) gitCommit(appDst, "Local changes before installing The Wise Hive " + VERSION);
  const keep = new Set(["node_modules", "backups", ".git", ".research"]);
  const n = copyDir(path.join(SRC, "app"), appDst, { skip: (name) => keep.has(name) || /^backup-/.test(name) || /\.log$/.test(name) });
  // The edition (The Wise Hive or The Wise Hive Lite) comes from the release: Lite ships app\edition.json, the full app doesn't.
  if (!fs.existsSync(path.join(SRC, "app", "edition.json"))) fs.rmSync(path.join(appDst, "edition.json"), { force: true });
  const t = copyDir(path.join(SRC, "tools"), path.join(BRAIN, "tools"));
  copyDir(path.join(SRC, "templates", "brain", "blender", "scripts"), path.join(BRAIN, "blender", "scripts"), { overwrite: false });
  gitCommit(appDst, "The Wise Hive " + VERSION);
  say(`   ${n} app files, ${t} tools`);
}

function npmInstall() {
  step("Installing the desktop app's runtime (Electron, about 100 MB; takes a minute)");
  const r = shell("npm install --no-audit --no-fund --loglevel=error", { cwd: path.join(BRAIN, "app") });
  if (r.code !== 0) return warn(`npm install failed, so the desktop window won't open yet (the skills still work). Rerun install.ps1 later. ${r.out.split("\n").slice(-3).join(" ")}`);
  // npm can finish without running Electron's own download script (seen with npm 11.19 on 2026-10-13: exit 0, no
  // dist\ folder). Check for the runtime and run that script directly when it's missing.
  const el = path.join(BRAIN, "app", "node_modules", "electron"), have = () => fs.existsSync(path.join(el, "path.txt")) && fs.existsSync(path.join(el, "dist"));
  if (!have() && fs.existsSync(path.join(el, "install.js"))) {
    say("   downloading the Electron runtime (npm skipped it)");
    const d = run(process.execPath, [path.join(el, "install.js")], { cwd: el });
    if (d.code !== 0) say(`   ${d.out.split("\n").slice(-2).join(" ")}`);
  }
  if (!have()) return warn("The Electron runtime didn't download, so the desktop window won't open yet (the skills still work). Rerun install.ps1 later.");
  say("   done");
}

// ---------- plugin ----------
function installPlugin() {
  step("Installing the wise-hive skills plugin");
  const dst = path.join(BRAIN, "marketplace");
  fs.rmSync(path.join(dst, "wise-hive", "skills"), { recursive: true, force: true });   // drop skills removed upstream
  copyDir(path.join(SRC, "plugin"), dst, { transform: fillBrain });
  if (!claudeExe()) { warn("Claude Code isn't installed, so the plugin wasn't registered. Install Claude Code, then rerun install.ps1."); return; }
  let r = claude(["plugin", "marketplace", "add", dst]);
  if (r.code !== 0) {
    if (/already/i.test(r.out)) r = claude(["plugin", "marketplace", "update", MARKET]);
    if (r.code !== 0) { warn(`Couldn't add the plugin marketplace: ${r.out.split("\n").pop()}`); return; }
  }
  r = claude(["plugin", "install", PLUGIN]);
  if (r.code !== 0 || /already installed/i.test(r.out)) r = claude(["plugin", "update", PLUGIN]);
  if (r.code !== 0 && !/already|latest|up to date/i.test(r.out)) warn(`Plugin install said: ${r.out.split("\n").pop()}`);
  else say("   /wise-hive:council, :brainstorm, :train and the rest are ready in new Claude chats");
}

// ---------- settings.json ----------
const SETTINGS = path.join(CLAUDE_DIR, "settings.json");
const INSTALL_INFO = path.join(BRAIN, "app-settings", "install.json");
const prevInfo = (() => { try { return JSON.parse(fs.readFileSync(INSTALL_INFO, "utf8")); } catch { return {}; } })();
// What cleanupPeriodDays was before The Wise Hive raised it ("added" = it wasn't set), so uninstall can put it back.
let setCleanup = prevInfo.cleanupBefore;
const toolPath = (f) => path.join(BRAIN, "tools", f);
const hook = (file, extra) => ({ type: "command", command: "powershell.exe", args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", toolPath(file)], ...extra });
const isOurHook = (h, brain = BRAIN) => {
  const s = JSON.stringify(h).toLowerCase().replace(/\\\\/g, "\\");
  const m = s.match(/[a-z]:[^"]*?\\tools\\(recall|save-transcript)\.(ps1|js)/);
  if (!m) return false;
  return m[0].startsWith(path.join(brain, "tools").toLowerCase()) || !fs.existsSync(m[0]);   // ours, or a stale copy
};
const WATCH_RULES = () => [`PowerShell(python ${toolPath("watch_video.py")} *)`, `Bash(python ${toolPath("watch_video.py")} *)`, `Bash(python ${fwd(toolPath("watch_video.py"))} *)`];

function loadSettings() {
  const raw = read(SETTINGS);
  if (raw == null) return {};
  try { return JSON.parse(raw); } catch (e) { throw new Error(`${SETTINGS} isn't valid JSON (${e.message}). Fix it, then rerun the installer.`); }
}
function saveSettings(s) {
  if (fs.existsSync(SETTINGS)) fs.copyFileSync(SETTINGS, `${SETTINGS}.before-teamwright`);
  write(SETTINGS, JSON.stringify(s, null, 2) + "\n");
}

function configureClaude(importFrom) {
  step(`Connecting Claude Code (${SETTINGS})`);
  const s = loadSettings();
  const oldMem = s.autoMemoryDirectory && path.resolve(s.autoMemoryDirectory);
  if (oldMem && oldMem.toLowerCase() !== path.join(BRAIN, "memory").toLowerCase()) importFrom.push(oldMem);
  s.hooks = s.hooks || {};
  // Recall (tools\recall.js): Claude Code cuts any one hook's context over 10,000 characters, so start-up recall is
  // split into RECALL_PARTS hooks (each prints its part, or nothing), plus a per-message hook that adds the memories
  // matching each message. Uses the same Node that runs this installer.
  // Lite loads part 1 only (~8.6k characters: the index, skills and lesson-file list; about 16k tokens less per new chat,
  // cut approved by the user 2026-10-13). Part 2 on is a slice of the knowledge notes, and the per-message hook still
  // brings the notes that match each message. Claude can still open any brain file it needs.
  const RECALL_PARTS = NAME === "The Wise Hive Lite" ? 1 : 14;
  const nodeHook = (args, extra) => ({ type: "command", command: process.execPath, args: [toolPath("recall.js"), ...args], ...extra });
  const want = {
    SessionStart: Array.from({ length: RECALL_PARTS }, (_, i) => nodeHook(["start", String(i + 1)], { timeout: 30 })),
    UserPromptSubmit: [nodeHook(["prompt"], { timeout: 15 })],
    Stop: [hook("save-transcript.ps1", { timeout: 120, async: true })],
    SessionEnd: [hook("save-transcript.ps1", { timeout: 120 })],
  };
  for (const [ev, hs] of Object.entries(want)) {
    const groups = (s.hooks[ev] || []).map((g) => ({ ...g, hooks: (g.hooks || []).filter((x) => !isOurHook(x)) })).filter((g) => g.hooks.length);
    for (const h of hs) groups.push({ hooks: [h] });
    s.hooks[ev] = groups;
  }
  s.autoMemoryDirectory = fwd(path.join(BRAIN, "memory"));
  if (!(s.cleanupPeriodDays >= 3650)) { setCleanup = s.cleanupPeriodDays === undefined ? "added" : s.cleanupPeriodDays; s.cleanupPeriodDays = 3650; }
  s.permissions = s.permissions || {};
  const dirs = new Set(s.permissions.additionalDirectories || []); dirs.add(BRAIN); s.permissions.additionalDirectories = [...dirs];
  const allow = new Set(s.permissions.allow || []); for (const r of WATCH_RULES()) allow.add(r); s.permissions.allow = [...allow];
  saveSettings(s);
  say("   memory folder, recall + save hooks, and long chat history are on (backup: settings.json.before-teamwright)");

  const md = path.join(CLAUDE_DIR, "CLAUDE.md");
  const block = fillBrain(read(path.join(SRC, "templates", "claude-md.md"))).trim();
  let text = read(md) || "";
  const re = /<!-- teamwright:start[\s\S]*?<!-- teamwright:end -->/;
  text = re.test(text) ? text.replace(re, block) : (text.trim() ? text.trimEnd() + "\n\n" : "") + block;
  write(md, text.trimEnd() + "\n");
  say("   added The Wise Hive section to CLAUDE.md");
}

// ---------- importing what Claude already knows ----------
function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text || "");
  const get = (k) => { const r = m && new RegExp(`^${k}:\\s*(.+)$`, "m").exec(m[1]); return r ? r[1].trim().replace(/^["']|["']$/g, "") : ""; };
  return { name: get("name"), description: get("description") };
}
function importMemories(extraDirs) {
  step("Importing Claude's existing memories");
  const dst = path.join(BRAIN, "memory"), index = path.join(dst, "MEMORY.md");
  const sources = [...extraDirs];
  const projects = path.join(CLAUDE_DIR, "projects");
  if (fs.existsSync(projects)) for (const p of fs.readdirSync(projects)) { const d = path.join(projects, p, "memory"); if (fs.existsSync(d)) sources.push(d); }
  let idx = read(index) || "# Memory index\n\n";
  let copied = 0, same = 0;
  for (const src of sources) {
    if (path.resolve(src).toLowerCase() === dst.toLowerCase() || !fs.existsSync(src)) continue;
    const srcIndex = read(path.join(src, "MEMORY.md")) || "";
    const tag = path.basename(path.dirname(src)).replace(/[^\w-]/g, "").slice(-24).toLowerCase() || "imported";
    for (const f of fs.readdirSync(src)) {
      if (!f.endsWith(".md") || f === "MEMORY.md" || !fs.statSync(path.join(src, f)).isFile()) continue;
      const body = fs.readFileSync(path.join(src, f), "utf8");
      let name = f;
      if (fs.existsSync(path.join(dst, name))) {
        if (fs.readFileSync(path.join(dst, name), "utf8") === body) { same++; continue; }
        name = f.replace(/\.md$/, `-${tag}.md`);
        if (fs.existsSync(path.join(dst, name))) { same++; continue; }
      }
      fs.copyFileSync(path.join(src, f), path.join(dst, name));
      copied++;
      if (!idx.includes(`(${name})`)) {
        const line = srcIndex.split(/\r?\n/).find((l) => l.includes(`(${f})`));
        const fm = frontmatter(body);
        idx = idx.trimEnd() + "\n" + (line ? line.replace(`(${f})`, `(${name})`) : `- [${fm.name || name.replace(/\.md$/, "")}](${name}) — ${fm.description || "imported memory"}`) + "\n";
      }
    }
  }
  write(index, idx);
  say(`   ${copied} memories copied in from ${sources.length} place(s)${same ? `, ${same} already there` : ""}`);
}

const stripSys = (t) => String(t || "").replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
function readableOf(file, id) {
  let cwd = "", firstPrompt = "";
  const out = [];
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (!cwd && e.cwd) cwd = e.cwd;
    if ((e.type !== "user" && e.type !== "assistant") || e.isMeta) continue;
    const c = e.message && e.message.content, parts = [];
    if (typeof c === "string") parts.push(c);
    else for (const b of c || []) {
      if (b.type === "text" && b.text) parts.push(b.text);
      else if (b.type === "tool_use") { let i = JSON.stringify(b.input || {}); if (i.length > 400) i = i.slice(0, 400) + "..."; parts.push(`> tool: **${b.name}** ${i}`); }
      else if (b.type === "tool_result" && b.is_error) { let t = typeof b.content === "string" ? b.content : JSON.stringify(b.content); if (t.length > 400) t = t.slice(0, 400) + "..."; parts.push(`> tool error: ${t}`); }
    }
    const text = stripSys(parts.join("\n\n"));
    if (!text) continue;
    if (e.type === "user" && !firstPrompt && !/^[><]/.test(text)) firstPrompt = text;
    out.push(e.type === "user" ? "## You" : "## Claude", text, "");
  }
  return { cwd, firstPrompt, body: out.join("\n") };
}
function importTranscripts() {
  step("Importing past Claude conversations into transcripts\\");
  const projects = path.join(CLAUDE_DIR, "projects"), root = path.join(BRAIN, "transcripts");
  if (!fs.existsSync(projects)) { say("   none found"); return; }
  const log = path.join(root, "LOG.md");
  let logText = read(log) || "# Session log\n\n| Date | Project | Session | First request |\n|---|---|---|---|\n";
  let n = 0;
  for (const p of fs.readdirSync(projects)) {
    let files = [];
    try { files = fs.readdirSync(path.join(projects, p)).filter((f) => f.endsWith(".jsonl")); } catch { continue; }
    for (const f of files) {
      const src = path.join(projects, p, f), id = f.replace(/\.jsonl$/, ""), id8 = id.slice(0, 8);
      if (fs.existsSync(path.join(root, "raw", f))) continue;
      try {
        const r = readableOf(src, id);
        if (!r.body) continue;
        const st = fs.statSync(src), started = (st.birthtime.getTime() ? st.birthtime : st.mtime).toISOString().slice(0, 10);
        const project = (r.cwd ? path.basename(r.cwd) : "unknown").replace(/[^\w\-.]/g, "_");
        fs.copyFileSync(src, path.join(root, "raw", f));
        const md = `${started}_${project}_${id8}.md`;
        write(path.join(root, "readable", md), `# Session ${id}\nProject: ${r.cwd}  \nStarted: ${started}\n\n${r.body}`);
        if (!logText.includes(id8)) {
          let fp = r.firstPrompt.replace(/\s+/g, " ").replace(/\|/g, "/");
          if (fp.length > 100) fp = fp.slice(0, 100) + "...";
          logText += `| ${started} | ${project} | [${id8}](readable/${md}) | ${fp} |\n`;
        }
        n++;
      } catch (e) { warn(`skipped ${f}: ${e.message}`); }
    }
  }
  write(log, logText);
  say(`   ${n} conversations saved`);
}

// ---------- Windows bits ----------
// Only touch Windows items (task, shortcuts, start-with-Windows) that point into THIS brain, never another install's.
const mine = (text) => String(text || "").toLowerCase().includes(path.join(BRAIN, "app").toLowerCase());
function shortcutTarget(lnk) {
  const ps = `$s = (New-Object -ComObject WScript.Shell).CreateShortcut('${lnk.replace(/'/g, "''")}'); $s.TargetPath + ' ' + $s.Arguments`;
  return run("powershell.exe", ["-NoProfile", "-Command", ps]).out;
}
function watchdog(on) {
  if (!on) {
    const q = run("schtasks", ["/Query", "/TN", TASK, "/XML"]);
    if (q.code === 0 && mine(q.out)) run("schtasks", ["/Delete", "/F", "/TN", TASK]);
    return;
  }
  const q = run("schtasks", ["/Query", "/TN", TASK, "/XML"]);
  if (q.code === 0 && !mine(q.out)) { warn(`A "${TASK}" task from another The Wise Hive install exists, so this one wasn't added.`); return; }
  const r = run("schtasks", ["/Create", "/F", "/TN", TASK, "/SC", "MINUTE", "/MO", "2", "/TR", `wscript.exe "${path.join(BRAIN, "app", "watchdog.vbs")}"`]);
  if (r.code !== 0) warn(`Couldn't create the "${TASK}" task (keeps The Wise Hive running): ${r.out}`);
  else say(`   "${TASK}" task: restarts The Wise Hive within 2 minutes if it stops (quitting from the tray turns it off)`);
}
function startApp() {
  step("Starting The Wise Hive");
  const r = run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(BRAIN, "app", "start.ps1")]);
  if (r.code !== 0) warn(`The Wise Hive didn't start: ${r.out}`);
  else say(`   open it any time from the ${NAME} shortcut on the Desktop or in the Start menu`);
}
function stopApp() {
  const rx = path.join(BRAIN, "app").replace(/[\\.]/g, (c) => "\\" + c).replace(/'/g, "''");
  run("powershell.exe", ["-NoProfile", "-Command", `Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'electron.exe' -or $_.Name -eq 'node.exe') -and $_.CommandLine -match '${rx}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`]);
}

// ---------- main ----------
function install() {
  console.log(`${NAME} ${VERSION} installer`);
  makeBrain();
  installCode();
  installPlugin();
  const importFrom = [];
  configureClaude(importFrom);
  if (!flag("no-import")) { importMemories(importFrom); importTranscripts(); }
  if (!flag("no-app")) {
    npmInstall();
    step("Background helpers");
    watchdog(!flag("no-watchdog"));
    if (!flag("no-start")) startApp();
  }
  write(INSTALL_INFO, JSON.stringify({ version: VERSION, installedAt: new Date().toISOString(), claudeDir: CLAUDE_DIR, cleanupBefore: setCleanup }, null, 2) + "\n");
  console.log(`\nDone. ${NAME} ${VERSION} is installed in ${BRAIN}.`);
  console.log("Start a NEW Claude chat (desktop app or terminal) so it loads the memory hooks and the /wise-hive skills.");
  if (notes.length) { console.log("\nThings to look at:"); for (const n of notes) console.log(`- ${n}`); }
}

function uninstall() {
  console.log(`Removing The Wise Hive (your brain folder ${BRAIN} is kept)`);
  stopApp();
  watchdog(false);
  if (claudeExe()) { claude(["plugin", "uninstall", PLUGIN]); claude(["plugin", "marketplace", "remove", MARKET]); }
  const s = loadSettings();
  for (const ev of Object.keys(s.hooks || {})) {
    s.hooks[ev] = s.hooks[ev].map((g) => ({ ...g, hooks: (g.hooks || []).filter((x) => !isOurHook(x)) })).filter((g) => g.hooks.length);
    if (!s.hooks[ev].length) delete s.hooks[ev];
  }
  if (s.hooks && !Object.keys(s.hooks).length) delete s.hooks;
  if (s.autoMemoryDirectory && path.resolve(s.autoMemoryDirectory).toLowerCase() === path.join(BRAIN, "memory").toLowerCase()) delete s.autoMemoryDirectory;
  if (setCleanup === "added") delete s.cleanupPeriodDays;
  else if (typeof setCleanup === "number") s.cleanupPeriodDays = setCleanup;
  if (s.permissions) {
    if (s.permissions.additionalDirectories) s.permissions.additionalDirectories = s.permissions.additionalDirectories.filter((d) => path.resolve(d).toLowerCase() !== BRAIN.toLowerCase());
    if (s.permissions.allow) s.permissions.allow = s.permissions.allow.filter((r) => !WATCH_RULES().includes(r));
    for (const k of ["additionalDirectories", "allow"]) if (s.permissions[k] && !s.permissions[k].length) delete s.permissions[k];
    if (!Object.keys(s.permissions).length) delete s.permissions;
  }
  for (const k of ["enabledPlugins", "extraKnownMarketplaces"]) if (s[k] && !Object.keys(s[k]).length) delete s[k];
  saveSettings(s);
  const md = path.join(CLAUDE_DIR, "CLAUDE.md"), text = read(md);
  if (text) write(md, text.replace(/\n*<!-- teamwright:start[\s\S]*?<!-- teamwright:end -->\n?/, "\n").trimEnd() + "\n");
  for (const dir of [path.join(HOME, "Desktop"), path.join(process.env.APPDATA || path.join(HOME, "AppData", "Roaming"), "Microsoft", "Windows", "Start Menu", "Programs")]) {
    for (const name of ["The Wise Hive.lnk", "The Wise Hive Lite.lnk"]) {
      const lnk = path.join(dir, name);
      if (fs.existsSync(lnk) && mine(shortcutTarget(lnk))) fs.rmSync(lnk, { force: true });
    }
  }
  // main.js registers start-with-Windows under the app id.
  const RUN = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
  if (mine(run("reg", ["query", RUN, "/v", "ClaudeBrain.Teamwright"]).out)) run("reg", ["delete", RUN, "/v", "ClaudeBrain.Teamwright", "/f"]);
  console.log(`\nThe Wise Hive is removed from Claude Code. Your memories, notes and transcripts are still in ${BRAIN}; delete that folder yourself if you don't want them.`);
}

try { flag("uninstall") ? uninstall() : install(); }
catch (e) { console.error(`\nInstall stopped: ${e.message}`); process.exit(1); }
