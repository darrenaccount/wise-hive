// Updates tab: the Messenger watches the Claude desktop app and Claude Code for new versions. When The Wise Hive's own
// Claude Code CLI moves to a new version, a Claude run reads the changelog and adapts The Wise Hive's code to it; the
// result is syntax-checked and smoke-tested, rolled back if anything fails, and The Wise Hive restarts once it's idle.
const fs = require("fs");
const { writeFileAtomic } = require("./lib/fsx");
const path = require("path");
const os = require("os");
const net = require("net");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const { spawn, execFile, exec } = require("child_process");

const CHANGELOG = "https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md";
const REGISTRY = "https://registry.npmjs.org/@anthropic-ai/claude-code/latest";
const HISTORY_KEEP = 200, CHANGELOG_MAX = 40000, MAX_FAILS = 3;
// A backup covers every file in the app folder except dependencies, backup folders, logs and dot-folders.
const SKIP_DIR = /^(node_modules|backup.*|\..*)$/i;
const SKIP_FILE = /\.(log|tmp)$/i;
const TOOLS = ["Read", "Glob", "Grep", "Write", "Edit", "WebFetch", "WebSearch"];
const EDIT_TOOLS = ["Write", "Edit", "MultiEdit", "NotebookEdit"];
const MODEL = "claude-opus-5-5";
const VERSION_KEYS = ["desktopApp", "desktopCode", "cli", "latest"];
const VERSION_LABEL = { desktopApp: "the Claude desktop app's version", desktopCode: "the desktop app's Claude Code version", cli: "The Wise Hive's Claude Code version", latest: "the latest released version" };

const semver = (s) => { const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(s || "")); return m ? `${m[1]}.${m[2]}.${m[3]}` : null; };
function cmp(a, b) {
  const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
}
const newer = (a, b) => !!(a && b && cmp(a, b) > 0);
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
const tail = (s, n) => String(s || "").trim().split(/\r?\n/).filter((l) => l.trim()).slice(-n).join("\n");
const lc = (s) => String(s).toLowerCase();
const hashFile = (f) => { try { return crypto.createHash("sha1").update(fs.readFileSync(f)).digest("hex"); } catch { return null; } };
const fresh = () => ({ auto: true, intervalHours: 6, lastCheck: null, nextCheck: null, versions: { desktopApp: null, desktopCode: null, cli: null, latest: null },
  readErrors: {}, lastAdaptedVersion: "", adaptFails: {}, pendingRestart: false, restartRequestedAt: null, adapting: null, history: [] });

// Sections of the changelog ("## <version>") with lo < version <= hi; just `hi` when lo isn't older.
function changelogRange(text, lo, hi) {
  const out = [];
  for (const sec of String(text || "").split(/\r?\n(?=## )/)) {
    const v = semver((/^## \[?v?(\d+\.\d+\.\d+)/.exec(sec) || [])[1]);
    if (!v) continue;
    if (lo && cmp(lo, hi) < 0 ? cmp(v, lo) > 0 && cmp(v, hi) <= 0 : cmp(v, hi) === 0) out.push(sec.trim());
  }
  return out.join("\n\n");
}

function get(url, { timeout = 20000, redirects = 3 } = {}) {
  return new Promise((ok, fail) => {
    const req = https.get(url, { headers: { "User-Agent": "Teamwright-updates" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume(); clearTimeout(timer);
        return get(new URL(res.headers.location, url).href, { timeout, redirects: redirects - 1 }).then(ok, fail);
      }
      if (res.statusCode !== 200) { res.resume(); clearTimeout(timer); return fail(new Error("HTTP " + res.statusCode)); }
      let b = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (b += c));
      res.on("end", () => { clearTimeout(timer); ok(b); });
      res.on("error", (e) => { clearTimeout(timer); fail(e); });
      res.on("close", () => { clearTimeout(timer); fail(new Error("the connection closed early")); }); // no-op after "end"
    });
    const timer = setTimeout(() => req.destroy(new Error("timed out")), timeout);
    req.on("error", (e) => { clearTimeout(timer); fail(e); });
  });
}
function run(cmd, args, opts = {}) {
  return new Promise((ok) => execFile(cmd, args, { windowsHide: true, maxBuffer: 4 << 20, ...opts }, (e, out, err) => ok({ code: e ? (typeof e.code === "number" ? e.code : 1) : 0, error: e, out: String(out || ""), err: String(err || "") })));
}
// Inside Electron, process.execPath is electron.exe: use node from PATH, else run Electron as plain Node.
let nodeBin = null;
async function nodeCmd() {
  if (!process.versions.electron) return { cmd: process.execPath, env: {} };
  if (!nodeBin) {
    const r = await run("where", ["node"], { timeout: 15000 });
    const p = r.out.split(/\r?\n/).map((l) => l.trim()).find((l) => /\.exe$/i.test(l) && fs.existsSync(l));
    nodeBin = p ? { cmd: p, env: {} } : { cmd: process.execPath, env: { ELECTRON_RUN_AS_NODE: "1" } };
  }
  return nodeBin;
}
async function runNode(args, opts = {}) {
  const n = await nodeCmd();
  return run(n.cmd, args, { ...opts, env: { ...(opts.env || process.env), ...n.env } });
}
async function spawnNode(args, opts = {}) {
  const n = await nodeCmd();
  return spawn(n.cmd, args, { ...opts, env: { ...(opts.env || process.env), ...n.env } });
}
function freePort(prefer) {
  const tryPort = (p) => new Promise((ok) => { const s = net.createServer(); s.once("error", () => ok(null)); s.listen(p, "127.0.0.1", () => { const got = s.address().port; s.close(() => ok(got)); }); });
  return tryPort(prefer).then((p) => p || tryPort(0));
}
function ping(port) {
  return new Promise((ok) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/api/stats", headers: { "X-Hive": "1" }, timeout: 2000 }, (res) => {
      let b = ""; res.on("data", (c) => (b += c));
      res.on("end", () => { let j = null; try { j = JSON.parse(b); } catch {} ok(res.statusCode === 200 && !!j && typeof j === "object" && "memories" in j); });
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => ok(false));
  });
}
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));

module.exports = (ctx) => {
  const { BRAIN, APP_DIR, HOME } = ctx;
  const T0 = ctx.updatesTest || {};
  // Tests shrink these through ctx.updatesTest.timings; production uses the defaults.
  const T = { firstCheck: 2 * 60e3, restartPoll: 2 * 60e3, maxAdapt: 2 * 3600e3, smoke: 20000, apiTest: 120000, chatIdPoll: 1000, ...(T0.timings || {}) };
  const DIR = path.join(BRAIN, "updates");
  const FILE = path.join(DIR, "state.json");
  const BACKUPS = path.join(APP_DIR, "backups");
  const env = () => (ctx.cleanEnv ? ctx.cleanEnv() : { ...process.env });

  let S = load();
  let busy = false, step = "", phase = "", adaptChat = null, retrySoon = false;
  let checkTimer = null, restartTimer = null, restartFirst = null, restartTries = 0;

  /* ---------- state ---------- */
  function load() {
    let saved = null;
    try { saved = JSON.parse(ctx.read(FILE) || "null"); } catch {}
    const st = { ...fresh(), ...(saved && typeof saved === "object" ? saved : {}) };
    st.versions = { ...fresh().versions, ...(st.versions || {}) };
    if (!Array.isArray(st.history)) st.history = [];
    for (const k of ["readErrors", "adaptFails"]) if (!st[k] || typeof st[k] !== "object" || Array.isArray(st[k])) st[k] = {};
    st.intervalHours = Math.min(48, Math.max(1, Math.round(Number(st.intervalHours) || 6)));
    for (const k of ["lastCheck", "nextCheck", "restartRequestedAt"]) if (st[k] != null && !Number.isFinite(Date.parse(st[k]))) st[k] = null;
    return st;
  }
  const pub = () => { const { history, ...rest } = S; return { ...rest, last: history[history.length - 1] || null, busy, step, phase, adaptChat }; };
  function save() {
    if (S.history.length > HISTORY_KEEP) S.history.splice(0, S.history.length - HISTORY_KEEP);
    try {
      fs.mkdirSync(DIR, { recursive: true });
      const data = JSON.stringify(S, null, 1);
      writeFileAtomic(FILE, data);
    } catch (e) { console.error(new Date().toISOString(), "updates save:", e && e.message || e); }
    try { ctx.broadcast({ t: "updates", state: pub() }); } catch {}
  }
  function add(type, text, extra) {
    const last = S.history[S.history.length - 1];
    const at = new Date().toISOString();
    // Routine checks with the same outcome just bump the last entry instead of filling the history.
    if (type === "check" && last && last.type === "check" && last.text === text) { last.at = at; last.count = (last.count || 1) + 1; save(); return last; }
    const e = { id: crypto.randomUUID().slice(0, 8), at, type, text: String(text || "").slice(0, 8000), ...extra };
    S.history.push(e);
    save();
    return e;
  }
  const setStep = (text, ph) => { step = text; if (ph) phase = ph; save(); };

  /* ---------- version readers (read-only) ---------- */
  async function readDesktopApp() {
    const ps = "$p = Get-AppxPackage -Name Claude; if (-not $p) { $p = Get-AppxPackage -Name '*Claude*' | Where-Object { $_.Name -notmatch 'Code' } }; ($p | Select-Object -First 1).Version";
    const r = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { timeout: 30000 });
    const v = (/\d+(?:\.\d+){1,3}/.exec(r.out) || [])[0];
    if (!v) throw new Error(r.code ? tail(r.err || r.out, 2) || "PowerShell failed" : "the Claude desktop app isn't installed");
    return v;
  }
  // The desktop app is an MSIX package, so its AppData may live in its package folder instead of the real one.
  async function readDesktopCode() {
    const roots = [path.join(process.env.APPDATA || path.join(HOME, "AppData", "Roaming"), "Claude", "claude-code")];
    const pk = path.join(process.env.LOCALAPPDATA || path.join(HOME, "AppData", "Local"), "Packages");
    try { for (const d of fs.readdirSync(pk)) if (/^Claude_/i.test(d)) roots.push(path.join(pk, d, "LocalCache", "Roaming", "Claude", "claude-code")); } catch {}
    let best = null;
    for (const r of roots) {
      let names = [];
      try { names = fs.readdirSync(r, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { continue; }
      for (const n of names) if (/^\d+\.\d+\.\d+$/.test(n) && (!best || cmp(n, best) > 0)) best = n;
    }
    if (!best) throw new Error("no Claude Code versions in the desktop app's folder");
    return best;
  }
  async function readCli() {
    const r = await run(ctx.CLAUDE, ["--version"], { timeout: 30000, env: env() });
    const v = semver(r.out);
    if (!v) throw new Error(tail(r.err || r.out, 2) || (r.error && r.error.message) || "claude --version printed nothing");
    return v;
  }
  async function readLatest() {
    // npm.cmd needs a shell on Windows (Node refuses to run .cmd files directly).
    const r = await new Promise((ok) => exec("npm view @anthropic-ai/claude-code version", { timeout: 60000, windowsHide: true, env: env() }, (e, out) => ok({ e, out: String(out || "") })));
    const v = semver(r.out);
    if (v) return v;
    const j = JSON.parse(await get(REGISTRY));
    if (!semver(j.version)) throw new Error("npm and the registry gave no version");
    return semver(j.version);
  }
  const H = {
    desktopApp: readDesktopApp, desktopCode: readDesktopCode, cli: readCli, latest: readLatest,
    claudeUpdate: () => run(ctx.CLAUDE, ["update"], { timeout: 5 * 60e3, env: env() }),
    changelog: () => get(CHANGELOG, { timeout: 20000 }),
    git: (args, opts = {}) => run("git", args, { cwd: APP_DIR, timeout: 60000, env: { ...env(), GIT_TERMINAL_PROMPT: "0" }, ...opts }),
    restart: () => {
      const c = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(APP_DIR, "start.ps1"), "-Restart"], { detached: true, stdio: "ignore", windowsHide: true });
      c.on("error", (e) => console.error(new Date().toISOString(), "updates restart:", e && e.message || e));
      c.unref();
    },
    ...(T0.hooks || {}),
  };
  async function readVersions() {
    const v = {}, errs = {};
    await Promise.all(VERSION_KEYS.map(async (k) => {
      try { v[k] = await H[k](); } catch (e) { v[k] = null; errs[k] = String(e && e.message || e).slice(0, 300); }
    }));
    return { versions: v, errors: errs };
  }

  /* ---------- check ---------- */
  // One check or adapt at a time; anything thrown becomes an "error" entry instead of escaping.
  async function exclusive(ph, fn) {
    if (busy) return false;
    busy = true; phase = ph; step = "";
    try { await fn(); }
    catch (e) { console.error(new Date().toISOString(), "updates:", e && e.stack || e); add("error", `Something went wrong: ${String(e && e.message || e).slice(0, 400)}`); }
    finally { busy = false; step = ""; phase = ""; adaptChat = null; save(); }
    return true;
  }
  async function check() {
    retrySoon = false;
    setStep("Reading versions", "check");
    const { versions, errors } = await readVersions();
    Object.assign(S, { versions, readErrors: errors, lastCheck: new Date().toISOString() });
    save();
    if (!versions.cli) return add("error", `Couldn't read The Wise Hive's Claude Code version: ${errors.cli || "unknown error"}`);
    // The desktop app's bundled Claude Code shows what the app moved to; the npm release covers it when unknown.
    const target = versions.desktopCode || versions.latest;
    let behind = "";
    if (newer(target, versions.cli)) {
      const before = versions.cli;
      setStep(`Updating Claude Code from ${before} to ${target}`, "cli-update");
      const r = await H.claudeUpdate();
      let now = null;
      try { now = await H.cli(); } catch (e) { S.readErrors.cli = String(e && e.message || e).slice(0, 300); }
      if (now) S.versions.cli = now;
      const out = tail(r.out + "\n" + r.err, 6);
      if (now && newer(now, before)) add("cli-update", `Updated The Wise Hive's Claude Code from ${before} to ${now}.`, { from: before, to: now });
      // A clean exit with no new version just means the CLI's release channel doesn't have it yet: a note, not an error.
      else if (!r.code && now) behind = ` The desktop app has Claude Code ${target}, but \`claude update\` found nothing newer yet.`;
      else add("error", `\`claude update\` didn't reach ${target}; The Wise Hive's Claude Code is still ${now || "unknown"}.${out ? "\n\n```\n" + out + "\n```" : ""}`, { from: before, to: target });
      setStep("Reading versions", "check");
    }
    const cli = S.versions.cli;
    if (!cli) return;
    const unread = Object.keys(S.readErrors).filter((k) => k !== "cli").map((k) => VERSION_LABEL[k]);
    const note = behind + (unread.length ? ` Couldn't read ${unread.join(", ")}.` : "");
    if (!S.lastAdaptedVersion) {
      S.lastAdaptedVersion = cli;
      return add("check", `Baseline set: The Wise Hive works with Claude Code ${cli}. Later versions will be adapted to from here.${note}`);
    }
    if (newer(cli, S.lastAdaptedVersion)) {
      // Don't spend a long Opus run every few hours on a version that keeps failing; Re-adapt still works.
      if ((S.adaptFails[cli] || 0) >= MAX_FAILS) return add("check", `Claude Code ${cli} is new, but adapting The Wise Hive to it failed ${MAX_FAILS} times, so the Messenger stopped trying on its own. Use Re-adapt to try again.${note}`);
      // A chat working in The Wise Hive's own folder may edit the same files, so wait for it instead of mixing edits.
      if (appChats()) { retrySoon = true; return add("check", `Claude Code ${cli} is new, but a chat is working in The Wise Hive's folder. Adapting waits until it finishes.${note}`); }
      // Lite never starts the long adapt run on its own: the user presses Re-adapt when they want it.
      if (ctx.LITE) return add("check", `Claude Code ${cli} is new (The Wise Hive Lite was adapted to ${S.lastAdaptedVersion}). To save usage, Lite doesn't adapt on its own: press Re-adapt when you want it.${note}`);
      add("check", `Claude Code ${cli} is new (The Wise Hive was adapted to ${S.lastAdaptedVersion}). Adapting The Wise Hive.${note}`);
      return adapt(S.lastAdaptedVersion, cli);
    }
    const ahead = !behind && newer(S.versions.latest, cli) ? ` Claude Code ${S.versions.latest} is out; The Wise Hive moves to it when the desktop app does.` : "";
    add("check", `Up to date: The Wise Hive runs Claude Code ${cli}.${ahead}${note}`);
  }
  const inside = (p) => { const rel = path.relative(APP_DIR, path.resolve(String(p))); return !rel.startsWith("..") && !path.isAbsolute(rel); };
  const appChats = () => [...(ctx.live ? ctx.live.values() : [])].filter((r) => !r.done && r.kind !== "updates" && r.cwd && inside(r.cwd)).length;

  /* ---------- snapshots and backups ---------- */
  // The files a backup covers, relative to APP_DIR.
  function scope() {
    const out = [];
    const walk = (rel) => {
      let ents = [];
      try { ents = fs.readdirSync(path.join(APP_DIR, rel), { withFileTypes: true }); } catch { return; }
      for (const d of ents) {
        const r = rel ? path.join(rel, d.name) : d.name;
        if (d.isDirectory()) { if (!SKIP_DIR.test(d.name)) walk(r); }
        else if (d.isFile() && !SKIP_FILE.test(d.name)) out.push(r);
      }
    };
    walk("");
    return out;
  }
  // An edited file's path relative to APP_DIR when a backup covers it, else null.
  function appRel(file) {
    const rel = path.relative(APP_DIR, path.resolve(APP_DIR, String(file)));
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
    const parts = rel.split(path.sep);
    return parts.slice(0, -1).some((p) => SKIP_DIR.test(p)) || SKIP_FILE.test(parts[parts.length - 1]) ? null : rel;
  }
  function snapshot() {
    const m = new Map();
    for (const rel of scope()) { const h = hashFile(path.join(APP_DIR, rel)); if (h) m.set(rel, h); }
    return m;
  }
  function diff(a, b) {
    const changed = [];
    for (const [k, h] of b) if (a.get(k) !== h) changed.push(k);
    for (const k of a.keys()) if (!b.has(k)) changed.push(k);
    return changed.sort();
  }
  function backup(from, to) {
    const base = path.join(BACKUPS, `update-${from}-to-${to}-${stamp()}`);
    let dir = base;
    for (let n = 2; fs.existsSync(dir); n++) dir = `${base}-${n}`; // never mix two backups (a no-change run deletes its own)
    try {
      for (const rel of scope()) {
        const dst = path.join(dir, rel);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(path.join(APP_DIR, rel), dst);
      }
    } catch (e) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} throw e; }
    // Claude's Grep and Glob use ripgrep, which honours .ignore: this keeps old copies out of an adapt's searches.
    try { const ig = path.join(BACKUPS, ".ignore"); if (!fs.existsSync(ig)) fs.writeFileSync(ig, "*\n"); } catch {}
    return dir;
  }
  // The files a run edited, from its tool calls: in the backup's scope (files) or not (outside).
  function edits(run, into) {
    for (const e of run.events || []) {
      if (e.t !== "tools") continue;
      for (const t of e.tools || []) {
        const f = EDIT_TOOLS.includes(t.name) && ((t.detail && t.detail.file) || t.summary);
        if (!f) continue;
        const rel = appRel(f);
        if (rel) { if (!into.files.some((x) => lc(x) === lc(rel))) into.files.push(rel); }
        else if (!into.outside.includes(String(f))) into.outside.push(String(f));
      }
    }
  }
  // Undoes an adapt's edits: puts back the backed-up version of each file Claude edited (or removes one it added), but
  // only while the file still holds what Claude left (left[rel], when known); one changed since is kept and reported.
  // Whatever gets overwritten or removed is first copied to <backup>\rejected\, so nobody's edits are lost.
  function undo(dir, files, left) {
    const u = { undone: [], kept: [], failed: [] };
    for (const rel of files) {
      const cur = path.join(APP_DIR, rel), old = path.join(dir, rel);
      try {
        const had = fs.existsSync(old), now = hashFile(cur);
        if (now === (had ? hashFile(old) : null)) continue; // already as it was
        if (left && Object.prototype.hasOwnProperty.call(left, rel) && left[rel] !== now) { u.kept.push(rel); continue; }
        if (now !== null) { const keep = path.join(dir, "rejected", rel); fs.mkdirSync(path.dirname(keep), { recursive: true }); fs.copyFileSync(cur, keep); }
        if (had) { fs.mkdirSync(path.dirname(cur), { recursive: true }); fs.copyFileSync(old, cur); } else fs.unlinkSync(cur);
        u.undone.push(rel);
      } catch (e) { u.failed.push(`\`${rel.replace(/\\/g, "/")}\` (${String(e && e.message || e).slice(0, 160)})`); }
    }
    return u;
  }
  function undoNote(u, dirRel) {
    let s = "";
    if (u.undone.length) s += `\n\nUndone: ${list(u.undone)}. The undone versions are kept in \`${path.join(dirRel, "rejected")}\`.`;
    if (u.kept.length) s += `\n\nLeft as they are, because they changed again after Claude's edit: ${list(u.kept)}. The versions from before the update are in \`${dirRel}\`.`;
    if (u.failed.length) s += `\n\nCouldn't undo ${u.failed.join(", ")}. The backup is in \`${dirRel}\`.`;
    return s;
  }
  const outsideNote = (files) => files && files.length ? `\n\nClaude also edited files the backup doesn't cover, which weren't checked or undone: ${list(files)}.` : "";

  /* ---------- git history ---------- */
  // The app folder is a git repo: every adapt and restore becomes a commit, so any earlier version can be brought
  // back. Folder backups stay as a second copy. Without git (or without the repo) everything works as before.
  // Commit identity for the app folder's history; set gitName/gitEmail in app-settings\teamwright.json to change it.
  const UCFG = (() => { try { return JSON.parse(fs.readFileSync(path.join(ctx.BRAIN, "app-settings", "teamwright.json"), "utf8")); } catch { return {}; } })();
  const GIT_WHO = ["-c", `user.name=${UCFG.gitName || "The Wise Hive"}`, "-c", `user.email=${UCFG.gitEmail || "teamwright@localhost"}`];
  // Literal pathspecs: a file name is never a glob; quotepath off keeps non-ASCII names readable.
  const git = (args, opts = {}) => H.git(["--literal-pathspecs", "-c", "core.quotepath=false", ...args], opts);
  const gitErr = (r) => tail(r.err || r.out || (r.error && r.error.message) || "git failed", 3);
  // "" when APP_DIR is the top of a git repo, else why not (git missing, no repo, or the repo is a parent folder).
  async function repoProblem() {
    const r = await git(["rev-parse", "--show-toplevel"]);
    if (r.error && r.error.code === "ENOENT") return "git isn't installed";
    if (r.code) return "the app folder isn't a git repo";
    return lc(path.resolve(r.out.trim())) === lc(path.resolve(APP_DIR)) ? "" : "the app folder isn't the top of its own git repo";
  }
  // Uncommitted changes, untracked files included (ignored ones aren't).
  async function dirtyFiles() {
    const r = await git(["status", "--porcelain", "--untracked-files=all"]);
    if (r.code) throw new Error(gitErr(r));
    return r.out.split(/\r?\n/).filter((l) => l.trim()).map((l) => l.slice(3).replace(/^"|"$/g, ""));
  }
  // Long messages go through a file: no command-line length limit, and the message keeps its newlines exactly.
  // files: commit just these (added first); "staged": commit the index as it is (a restore already staged it all).
  async function commit(message, files) {
    const msgFile = path.join(fs.existsSync(path.join(APP_DIR, ".git", "HEAD")) ? path.join(APP_DIR, ".git") : os.tmpdir(), `TEAMWRIGHT_MSG_${process.pid}`);
    try {
      fs.writeFileSync(msgFile, message);
      const paths = Array.isArray(files) ? files.map((f) => String(f).replace(/\\/g, "/")) : null;
      if (files !== "staged") {
        const add = await git(paths ? ["add", "-A", "--", ...paths] : ["add", "-A"]);
        if (add.code) return { error: gitErr(add) };
      }
      // --only with paths commits just those files, even if something else got staged meanwhile; "whitespace" keeps
      // markdown "#" headings in Claude's summary (the default cleanup would strip them as comments).
      const c = await git([...GIT_WHO, "commit", "-q", "--cleanup=whitespace", "-F", msgFile, ...(paths ? ["--only", "--", ...paths] : [])]);
      if (c.code) return { error: gitErr(c) };
      const h = await git(["rev-parse", "--short", "HEAD"]);
      return { hash: h.out.trim() };
    } finally { try { fs.unlinkSync(msgFile); } catch {} }
  }
  // Before an adapt: the folder must have nothing uncommitted, so Claude's edits land in a commit of their own. Pending
  // changes are someone's work in progress (another chat, the user): never commit them for them; skip this adapt instead.
  async function commitBefore(from, to) {
    const why = await repoProblem();
    if (why) return { note: `No git history for this update: ${why}.` };
    let dirty;
    try { dirty = await dirtyFiles(); } catch (e) { return { note: `Couldn't read git status (${e.message}).` }; }
    return dirty.length ? { blocked: dirty } : {};
  }
  async function commitAdapt(from, to, summary, files) {
    if (await repoProblem()) return {};
    const body = String(summary || "Claude adapted The Wise Hive.").trim().slice(0, 12000);
    const r = await commit(`Update The Wise Hive for Claude Code ${from}→${to}\n\n${body}\n\nChanged: ${files.map((f) => f.replace(/\\/g, "/")).join(", ")}\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n`, files);
    return r.error ? { note: `Couldn't commit Claude's changes to git (${r.error}); the backup folder still has the old version.` } : { hash: r.hash };
  }

  /* ---------- verify ---------- */
  async function verify(changed = []) {
    const files = scope().filter((f) => /\.js$/i.test(f));
    for (const rel of files) {
      setStep(`Checking ${rel.replace(/\\/g, "/")}`);
      const r = await runNode(["--check", path.join(APP_DIR, rel)], { timeout: 60000, env: env() });
      if (r.code) return `${rel} has a syntax error:\n\n\`\`\`\n${tail(r.err || r.out, 8)}\n\`\`\``;
    }
    setStep("Checking index.html");
    const html = ctx.read(path.join(APP_DIR, "public", "index.html"));
    if (html == null) return "public/index.html is missing.";
    // The page's own script is public/app.js (checked with the other .js files above); index.html must still load it.
    // Any inline script that comes back is checked too.
    if (!/<script\s[^>]*src\s*=\s*["']?\/app\.js/i.test(html)) return "public/index.html doesn't load /app.js, the page's script.";
    const scripts = [...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)].filter((m) => !/\bsrc\s*=/i.test(m[1] || "") && !/type\s*=\s*["']?(module|application\/json|importmap)/i.test(m[1] || ""));
    for (let i = 0; i < scripts.length; i++) {
      const tmp = path.join(os.tmpdir(), `teamwright-index-${process.pid}-${Date.now()}-${i}.js`);
      fs.writeFileSync(tmp, scripts[i][2]);
      const r = await runNode(["--check", tmp], { timeout: 60000, env: env() });
      try { fs.unlinkSync(tmp); } catch {}
      if (r.code) return `The inline script in public/index.html has a syntax error:\n\n\`\`\`\n${tail((r.err || r.out).split(tmp).join("index.html <script>"), 8)}\n\`\`\``;
    }
    setStep("Smoke-testing the server");
    const bad = await smoke(changed);
    if (bad) return bad;
    setStep("Testing the server's API");
    return apiTest();
  }
  // test/api-test.js starts the changed server on its own port and checks the API answers in the right shapes
  // (it never starts a Claude run). Any FAIL counts like a smoke-test failure.
  async function apiTest() {
    const script = path.join(APP_DIR, "test", "api-test.js");
    if (!fs.existsSync(script)) { console.log(new Date().toISOString(), "updates: no test/api-test.js, so the API test was skipped"); return ""; }
    const port = await freePort(4798);
    if (!port) return "No free port for the API test.";
    const r = await runNode([script, "--port", String(port)], { cwd: APP_DIR, timeout: T.apiTest, env: env() });
    if (!r.code) return "";
    const out = `${r.out}\n${r.err}`, fails = out.split(/\r?\n/).filter((l) => /^FAIL\b/.test(l));
    const why = r.error && r.error.killed ? ` (it was stopped after ${Math.round(T.apiTest / 1000)} s)` : "";
    return `The API test failed${why}:\n\n\`\`\`\n${(fails.length ? fails.slice(0, 12).join("\n") : tail(out, 12)) || "(no output)"}\n\`\`\``;
  }
  // Starts the changed server on a spare port and waits for /api/stats to answer. Returns "" when it does.
  async function smoke(changed = []) {
    const port = await freePort(4799);
    if (!port) return "No free port for the smoke test.";
    let out = "", exited = null;
    const child = await spawnNode([path.join(APP_DIR, "server.js")], { cwd: APP_DIR, env: { ...env(), HIVE_PORT: String(port) }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("exit", (code) => (exited = code == null ? "killed" : code));
    child.on("error", (e) => { exited = -1; out += String(e); });
    try {
      // The listen line proves the answer comes from this server, not something else on the port.
      for (const end = Date.now() + T.smoke; Date.now() < end && exited == null; await wait(400)) {
        if (out.includes(`127.0.0.1:${port}`) && (await ping(port))) {
          // server.js skips a module that throws while loading; count it when this update touched it (or server.js).
          const broken = [...out.matchAll(/module failed to load: (\S+)/g)].map((m) => m[1]).filter((f) => changed.includes(f) || changed.includes("server.js"));
          return broken.length ? `The server started, but ${broken.join(", ")} failed to load.\n\n\`\`\`\n${tail(out, 12)}\n\`\`\`` : "";
        }
      }
      return `The server didn't answer within ${Math.round(T.smoke / 1000)} s${exited != null ? ` (it exited with ${exited})` : ""}.\n\n\`\`\`\n${tail(out, 12) || "(no output)"}\n\`\`\``;
    } finally {
      if (exited == null) { try { child.kill(); } catch {} }
    }
  }

  /* ---------- adapt ---------- */
  function adaptPrompt(from, to, log, force) {
    return `[Wise Hive update] Claude Code was updated from ${from} to ${to}. Adapt The Wise Hive to the new version.

You maintain The Wise Hive app in this folder (${APP_DIR}). The Wise Hive is a local Electron app (main.js) with a Node server (server.js) and a single-page UI (public/index.html with its script public/app.js, styles public/app.css, plus public/*-client.js). It drives Claude Code through server.js: startChat (live chats over the two-way stream-json channel) and runClaude/askClaude (one-shot jobs). It depends on:
- the CLI flags it passes: -p, --input-format and --output-format stream-json, --verbose, --include-partial-messages, --replay-user-messages, --permission-prompt-tool stdio, --permission-mode, --resume, --model, --effort, --chrome, --max-turns, --add-dir, --allowedTools, --append-system-prompt;
- the stream-json events it parses (system init, stream_event text and thinking deltas, assistant tool_use blocks, replayed user messages, result) and the control_request/control_response protocol (initialize, can_use_tool with allow/deny and updatedInput/updatedPermissions, interrupt, AskUserQuestion answers);
- permission modes (default, acceptEdits, bypassPermissions) and allowed-tool rules;
- the models listed in the page's model menu (public/index.html and public/app.js) (and the model lists in autopilot.js and its client);
- MCP servers (\`claude mcp list\` in systemStatus) and hooks.

${force ? "The user asked for this pass again for the same version; an earlier pass may already have handled some of it, so don't redo changes that are already in place.\n\n" : ""}Claude Code changelog from ${from} to ${to}:
<changelog>
${log}
</changelog>

What to do:
1. Find the changes that affect The Wise Hive (renamed or removed flags, changed event or protocol shapes, permission changes, new or retired models) and new capabilities worth exposing in it (for example a new model in the model menu).
2. Read the code you would touch first. Make minimal, careful edits in the existing style: plain JavaScript, no dependencies, 2-space indent, short comments only where they explain why. No refactors, renames or reformatting. Keep every feature working.
3. If nothing is relevant to The Wise Hive, change nothing and say so.
4. You can't run commands. After you finish, The Wise Hive runs \`node --check\` on every .js file and the inline script of index.html and smoke-tests the server, then runs test\\api-test.js against it (a check of every API route); if anything fails, all your changes are rolled back. Don't edit test\\ to make a check pass. Only edit The Wise Hive's own files in this folder. Leave backups\\ and the other backup folders (old copies of The Wise Hive), node_modules\\ and the logs alone: don't search or edit them.
5. End with a list of every change: file, what changed, and why. If you changed nothing, say "No changes needed" and why.`;
  }
  // tick(run) runs every poll and once more when the run ends.
  function startRun(opts, tick) {
    return new Promise((done) => {
      const r = ctx.startChat(opts);
      let ended = false;
      const poll = setInterval(() => {
        if (r.chatId && adaptChat !== r.chatId) { adaptChat = r.chatId; if (S.adapting) S.adapting.chatId = r.chatId; save(); }
        try { tick(r); } catch (e) { console.error(new Date().toISOString(), "updates track:", e && e.message || e); }
      }, T.chatIdPoll);
      // A hung tool shouldn't hold the updater forever.
      const guard = setTimeout(() => { if (!r.done) { r.timedOut = true; try { ctx.stopChat(r, "timeout"); } catch {} } }, T.maxAdapt);
      r.onDone = () => {
        if (ended) return;
        ended = true; clearInterval(poll); clearTimeout(guard);
        try { tick(r); } catch (e) { console.error(new Date().toISOString(), "updates track:", e && e.message || e); }
        done(r);
      };
      if (r.done) r.onDone();
    });
  }
  async function adapt(from, to, force) {
    setStep("Checking git for uncommitted changes", "adapt");
    const pre = await commitBefore(from, to);
    if (pre.note) console.log(new Date().toISOString(), "updates git:", pre.note);
    if (pre.blocked) {
      const names = pre.blocked.slice(0, 8).map((f) => "`" + f + "`").join(", ") + (pre.blocked.length > 8 ? ` and ${pre.blocked.length - 8} more` : "");
      return add("check", `Claude Code ${to} is new, but The Wise Hive has uncommitted changes (${names}), so adapting was skipped for now. Commit or undo them in ${APP_DIR}, then press Check again (or wait for the next check).`, { from, to, dirty: pre.blocked.slice(0, 50) });
    }
    setStep("Reading the changelog");
    let log = "", logNote = "";
    try {
      log = changelogRange(await H.changelog(), from, to);
      if (!log) logNote = `The changelog has no entries between ${from} and ${to} yet.`;
    } catch (e) { logNote = `The changelog couldn't be fetched (${String(e && e.message || e).slice(0, 120)}).`; }
    if (log.length > CHANGELOG_MAX) log = log.slice(0, CHANGELOG_MAX) + `\n\n(cut here; the full changelog is at ${CHANGELOG})`;
    if (!log) log = `${logNote} Use WebFetch on ${CHANGELOG} or WebSearch to find what changed, and if you can't, check that The Wise Hive's use of Claude Code still matches what you know of version ${to}.`;

    setStep("Backing up The Wise Hive");
    const before = snapshot();
    const dir = backup(from, to);
    const ids = { from, to, chatId: null, backup: path.relative(APP_DIR, dir), ...(pre.hash ? { before: pre.hash } : {}) };
    const gitNote = (s) => (s ? `\n\n${s}` : "");
    // Saved, so a restart in the middle of this can undo the half-made edits (see start()). files lists what Claude
    // edited and left the hash each file had after its edit, so only Claude's edits are ever undone.
    const a = S.adapting = { from, to, backup: dir, startedAt: new Date().toISOString(), chatId: null, files: [], outside: [], left: {} };
    setStep(`Claude is adapting The Wise Hive to ${to}`);
    const track = (r) => {
      const n = a.files.length + a.outside.length;
      edits(r, a);
      let dirty = a.files.length + a.outside.length !== n;
      for (const rel of a.files) { const h = hashFile(path.join(APP_DIR, rel)); if (a.left[rel] !== h) { a.left[rel] = h; dirty = true; } }
      if (dirty && S.adapting === a) save();
    };
    // The app's changes since the backup, split into Claude's edits and anyone else's (left alone).
    const split = () => {
      const all = diff(before, snapshot()), mine = new Set(a.files.map(lc));
      return { claude: all.filter((f) => mine.has(lc(f))), others: all.filter((f) => !mine.has(lc(f))) };
    };
    const dropBackup = () => { S.adapting = null; try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }; // Claude changed nothing in it
    try {
      const r = await startRun({ prompt: adaptPrompt(from, to, log, force), cwd: APP_DIR, mode: "edit", allowedTools: TOOLS, autoDeny: true, maxTurns: 80, model: MODEL, kind: "updates", disallowedTools: ["ScheduleWakeup", "CronCreate", "CronDelete", "CronList"], title: `Update The Wise Hive for Claude Code ${to}` }, track);
      ids.chatId = r.chatId || adaptChat || null;
      const res = [...(r.events || [])].reverse().find((e) => e.t === "result");
      const summary = String((res && res.text) || "").trim();
      const { claude, others } = split();
      if (!res || res.error || r.timedOut) {
        const why = r.timedOut ? "it ran too long and was stopped" : res ? `it ended with an error: ${summary.slice(0, 300) || "no details"}` : "it stopped without an answer";
        if (claude.length) return rollback(a, `Claude didn't finish (${why}), so its partial changes were undone.`, ids, others);
        dropBackup(); failed(to);
        return add("error", `Claude couldn't adapt The Wise Hive to ${to}: ${why}. Nothing was changed; the next check tries again.${outsideNote(a.outside)}`, { from, to, chatId: ids.chatId });
      }
      if (!claude.length) {
        dropBackup();
        S.lastAdaptedVersion = to; delete S.adaptFails[to];
        return add("no-change", `${logNote ? logNote + " " : ""}Nothing to change for Claude Code ${to}.\n\n${summary}${outsideNote(a.outside)}`, { from, to, chatId: ids.chatId });
      }
      setStep("Checking the changes");
      const fail = await verify(claude);
      if (fail) return rollback(a, `The changes failed a check, so they were undone. ${fail}`, ids, others);
      setStep("Saving Claude's changes to git");
      const c = await commitAdapt(from, to, summary, claude);
      if (c.note) console.log(new Date().toISOString(), "updates git:", c.note);
      S.adapting = null;
      S.lastAdaptedVersion = to; delete S.adaptFails[to];
      S.pendingRestart = true;
      const saved = c.hash ? ` Saved in the app's history as \`${c.hash}\`${pre.hash ? ` (the changes waiting before it are \`${pre.hash}\`)` : ""}.` : "";
      add("adapt", `${summary || "Claude adapted The Wise Hive."}\n\nChanged: ${list(claude)}. Backup: \`${ids.backup}\`.${saved}${outsideNote(a.outside)}${gitNote(pre.note || c.note)}`, { ...ids, files: claude, ...(c.hash ? { commit: c.hash } : {}) });
      ctx.notify({ title: `The Wise Hive adapted to Claude Code ${to}`, body: "It restarts on the new code once no chats are running.", view: "updates" });
      watchRestart();
    } catch (e) {
      const why = String(e && e.message || e).slice(0, 300);
      const { claude, others } = split();
      if (claude.length) return rollback(a, `Something went wrong while adapting (${why}), so the changes were undone.`, ids, others);
      dropBackup(); failed(to);
      add("error", `Something went wrong while adapting to ${to}: ${why}. Nothing was changed.`, { from, to, chatId: ids.chatId });
    }
  }
  const list = (files) => files.map((f) => "`" + String(f).replace(/\\/g, "/") + "`").join(", ");
  const failed = (to) => { S.adaptFails[to] = (S.adaptFails[to] || 0) + 1; };
  // Undoes only Claude's edits; others = files something else changed meanwhile, which stay as they are.
  function rollback(a, reason, ids, others) {
    setStep("Restoring the backup");
    const u = undo(a.backup, a.files, a.left);
    S.adapting = null;
    failed(ids.to);
    const also = others.length ? `\n\nChanged during the update by something other than Claude, and left as they are: ${list(others)}.` : "";
    add("rollback", `${reason}${undoNote(u, ids.backup)}${also}${outsideNote(a.outside)}`, ids);
    const trouble = u.kept.length || u.failed.length;
    ctx.notify({ title: `The Wise Hive update to Claude Code ${ids.to} was undone`, body: trouble ? "Some files weren't restored. Open the Updates tab." : "Claude's changes were undone. The Updates tab says why.", view: "updates" });
  }
  async function reAdapt() {
    setStep("Reading versions", "adapt");
    let cli = null;
    try { cli = await H.cli(); } catch (e) { return add("error", `Couldn't read The Wise Hive's Claude Code version: ${String(e && e.message || e).slice(0, 300)}`); }
    S.versions.cli = cli;
    const prev = [...S.history].reverse().find((h) => h.type === "adapt" && h.to === cli && h.from);
    const from = prev ? prev.from : S.lastAdaptedVersion && newer(cli, S.lastAdaptedVersion) ? S.lastAdaptedVersion : cli;
    add("check", `Adapting The Wise Hive to Claude Code ${cli} again, as asked.`);
    return adapt(from, cli, true);
  }

  /* ---------- restart ---------- */
  function restartNow() {
    S.restartRequestedAt = new Date().toISOString();
    save();
    H.restart();
  }
  // start.ps1 -Restart refuses while chats run, so only restart when idle; if this process is still alive on the next
  // poll the restart didn't happen, and it tries again.
  function watchRestart() {
    if (restartTimer || !S.pendingRestart) return;
    restartTries = 0;
    const tryIt = () => {
      if (!S.pendingRestart) return stopRestart();
      if (busy || ctx.activeRuns() > 0) return;
      if (++restartTries > 5) { stopRestart(); return add("error", "Couldn't restart The Wise Hive automatically. Use Restart The Wise Hive now, or quit and reopen it."); }
      restartNow();
    };
    // First try shortly after the update finishes (once the notification is out), then every poll.
    restartFirst = setTimeout(tryIt, Math.min(15000, T.restartPoll));
    restartTimer = setInterval(tryIt, T.restartPoll);
    for (const t of [restartFirst, restartTimer]) if (t.unref) t.unref();
  }
  function stopRestart() { clearInterval(restartTimer); clearTimeout(restartFirst); restartTimer = restartFirst = null; }

  /* ---------- schedule ---------- */
  function schedule(ms) {
    clearTimeout(checkTimer); checkTimer = null;
    if (!S.auto) { S.nextCheck = null; return; }
    if (!Number.isFinite(ms)) ms = 60e3;
    S.nextCheck = new Date(Date.now() + ms).toISOString();
    checkTimer = setTimeout(async () => {
      checkTimer = null;
      // If a re-adapt is running, or an adapt waits for a chat, look again in 10 minutes instead of a whole interval.
      const ran = await exclusive("check", check);
      schedule(next(ran));
      save();
    }, ms);
    if (checkTimer.unref) checkTimer.unref();
  }
  const next = (ran) => { const ms = ran && !retrySoon ? S.intervalHours * 3600e3 : 10 * 60e3; retrySoon = false; return ms; };
  const sinceLast = () => { const due = S.lastCheck ? Date.parse(S.lastCheck) + S.intervalHours * 3600e3 - Date.now() : 0; return Math.max(60e3, due); };

  /* ---------- after a restart ---------- */
  function start() {
    S = load();
    if (S.pendingRestart || S.restartRequestedAt) {
      add("restart", S.pendingRestart ? `The Wise Hive restarted and runs the code adapted to Claude Code ${S.lastAdaptedVersion}.` : "The Wise Hive restarted.");
      Object.assign(S, { pendingRestart: false, restartRequestedAt: null });
    }
    // An adapt that a restart cut short may have left half-made edits: undo the files Claude edited (see undo()).
    if (S.adapting && S.adapting.backup) {
      const a = S.adapting;
      S.adapting = null;
      failed(a.to); // so an adapt that keeps getting cut short stops after MAX_FAILS like any other failure
      const dirRel = path.relative(APP_DIR, a.backup);
      let text = `The update to Claude Code ${a.to} was interrupted by a restart. The next check tries again.`, tell = false;
      // The Wise Hive's launcher may already have put back files that kept it from starting.
      if (Array.isArray(a.launcherRestored) && a.launcherRestored.length) text += ` The Wise Hive's launcher put back ${list(a.launcherRestored)} from the backup.`;
      if (!fs.existsSync(a.backup)) { text += " Its backup is gone, so nothing was undone."; tell = true; }
      else if (!Array.isArray(a.files)) { text += ` It didn't record which files Claude edited, so nothing was undone. The backup is in \`${dirRel}\`.`; tell = true; }
      else {
        const u = undo(a.backup, a.files, a.left || {});
        if (u.undone.length + u.kept.length + u.failed.length) text += undoNote(u, dirRel);
        else if (!(a.launcherRestored || []).length) text += " It hadn't changed anything yet.";
        if (u.undone.length) { S.pendingRestart = true; text += "\n\nThe Wise Hive restarts once it's idle to load the restored code."; }
        tell = !!(u.undone.length || u.kept.length || u.failed.length);
      }
      add("rollback", text + outsideNote(a.outside), { from: a.from, to: a.to, chatId: a.chatId || null, backup: dirRel });
      if (tell) ctx.notify({ title: `The Wise Hive update to Claude Code ${a.to} was interrupted`, body: "The Updates tab says what was undone and where the backup is.", view: "updates" });
      watchRestart();
    }
    schedule(T.firstCheck);
    save();
  }

  /* ---------- history view and restore ---------- */
  const HASH = /^[0-9a-f]{7,40}$/;
  const LOG_N = 30, DIFF_CAP = 200000;
  async function historyList() {
    const why = await repoProblem();
    if (why) return { repo: false, why, commits: [], dirty: [] };
    const r = await git(["log", `-n${LOG_N}`, "--no-color", "--format=%x1e%H%x1f%h%x1f%aI%x1f%an%x1f%s", "--shortstat"]);
    if (r.code) return /does not have any commits|bad default revision/i.test(r.err) ? { repo: true, commits: [], dirty: [] } : { repo: false, why: gitErr(r), commits: [], dirty: [] };
    const commits = r.out.split("\x1e").filter((s) => s.trim()).map((rec) => {
      const [head, ...rest] = rec.split(/\r?\n/);
      const [hash, short, date, author, subject] = head.split("\x1f");
      const st = /(\d+) files? changed/.exec(rest.join(" "));
      return { hash, short, date, author, subject: subject || "", files: st ? Number(st[1]) : 0 };
    });
    let dirty = [];
    try { dirty = await dirtyFiles(); } catch {}
    return { repo: true, commits, dirty, head: commits[0] ? commits[0].hash : null };
  }
  // The full hash of a commit, or null. HASH is checked first, so the argument can't be read as an option.
  async function resolve(h) {
    if (!HASH.test(h)) return null;
    const r = await git(["rev-parse", "--verify", "--quiet", `${h}^{commit}`]);
    const full = r.out.trim();
    return !r.code && /^[0-9a-f]{40,64}$/.test(full) ? full : null;
  }
  // A commit's diff, cut at DIFF_CAP characters (the first commit holds the whole app, which is too much for a page).
  function gitCapped(args, cap) {
    return new Promise((ok) => {
      let out = "", err = "", cut = false;
      const c = spawn("git", ["--literal-pathspecs", "-c", "core.quotepath=false", ...args], { cwd: APP_DIR, windowsHide: true, env: { ...env(), GIT_TERMINAL_PROMPT: "0" } });
      const timer = setTimeout(() => { try { c.kill(); } catch {} }, 30000);
      c.stdout.setEncoding("utf8");
      c.stdout.on("data", (d) => { if (cut) return; out += d; if (out.length > cap) { out = out.slice(0, cap); cut = true; try { c.kill(); } catch {} } });
      c.stderr.on("data", (d) => (err += d));
      c.on("error", (e) => { clearTimeout(timer); ok({ code: -1, out, err: String(e), cut }); });
      c.on("close", (code) => { clearTimeout(timer); ok({ code: cut ? 0 : code, out, err, cut }); });
    });
  }
  // Brings the app's tracked files back to an older commit as a NEW commit (history is never rewritten). Refuses
  // while anything is uncommitted: those changes would get mixed into the restore or lost.
  async function restore(h) {
    const why = await repoProblem();
    if (why) return [409, { error: `Can't restore: ${why}.` }];
    if (busy) return [409, { error: "An update is running. Restore once it finishes." }];
    if (appChats()) return [409, { error: "A chat is working in The Wise Hive's folder. Restore once it finishes, so its edits don't get mixed in." }];
    const full = await resolve(h);
    if (!full) return [404, { error: "That version isn't in The Wise Hive's history." }];
    const dirty = await dirtyFiles();
    if (dirty.length) {
      const names = dirty.slice(0, 8).map((f) => "`" + f + "`").join(", ") + (dirty.length > 8 ? ` and ${dirty.length - 8} more` : "");
      return [409, { error: `The Wise Hive's folder has changes that aren't saved in its history yet: ${names}. Restoring now would mix them in or lose them. Ask Claude to commit them (or undo them) in ${APP_DIR}, then try again.`, dirty }];
    }
    const cur = await git(["log", "-1", "--format=%H%x1f%h", "HEAD"]), [headFull, headShort] = cur.out.trim().split("\x1f");
    const same = await git(["diff", "--quiet", full, "HEAD", "--"]);
    if (full === headFull || same.code === 0) return [200, { ok: true, nothing: true, message: "The Wise Hive's files already match that version, so nothing changed." }];
    const info = (await git(["log", "-1", "--format=%h%x1f%aI%x1f%s", full])).out.trim().split("\x1f");
    const [short, date, subject] = info;
    busy = true; phase = "restore"; step = `Restoring version ${short}`; save();
    try {
      // --source with "." also removes tracked files that didn't exist in that version; untracked and ignored
      // files (node_modules, backups, logs) are never touched.
      const r = await git(["restore", `--source=${full}`, "--staged", "--worktree", "--", "."]);
      const putBack = () => git(["restore", "--source=HEAD", "--staged", "--worktree", "--", "."]);
      if (r.code) { await putBack(); return [500, { error: `git couldn't restore that version (${gitErr(r)}). Nothing was changed.` }]; }
      const ch = await git(["diff", "--cached", "--name-only", "--no-renames"]);
      const files = ch.out.split(/\r?\n/).filter((l) => l.trim());
      const c = await commit(`Restore to ${short}\n\nRestored The Wise Hive's files to ${short} (${String(date).slice(0, 10)}: ${subject}).\nThe version before this restore is ${headShort}.\n`, "staged");
      if (c.error) { await putBack(); return [500, { error: `git couldn't save the restore (${c.error}). Nothing was changed.` }]; }
      add("restore", `The Wise Hive's files were restored to \`${short}\` (${subject}) and saved as \`${c.hash}\`. The version before was \`${headShort}\`, so this can be undone the same way. Restart The Wise Hive to run the restored code.`, { commit: c.hash, to: short, files: files.length });
      return [200, { ok: true, commit: c.hash, restored: short, files: files.length, restartNeeded: true }];
    } finally { busy = false; phase = ""; step = ""; save(); }
  }

  /* ---------- routes ---------- */
  const view = () => ({ state: S, busy, step, phase, adaptChat });
  async function route(p, req, res) {
    if (p === "/api/history" || p.startsWith("/api/history/")) {
      if (p === "/api/history") {
        if (req.method !== "GET") ctx.json(res, 405, { error: "use GET" });
        else ctx.json(res, 200, await historyList());
        return true;
      }
      const hm = /^\/api\/history\/([^/]+)\/(diff|restore)$/.exec(p);
      if (!hm) { ctx.json(res, 404, { error: "unknown" }); return true; }
      if (!HASH.test(hm[1])) { ctx.json(res, 400, { error: "bad commit hash" }); return true; }
      if (hm[2] === "diff") {
        if (req.method !== "GET") { ctx.json(res, 405, { error: "use GET" }); return true; }
        const why = await repoProblem();
        if (why) { ctx.json(res, 409, { error: why }); return true; }
        const full = await resolve(hm[1]);
        if (!full) { ctx.json(res, 404, { error: "That version isn't in The Wise Hive's history." }); return true; }
        const r = await gitCapped(["show", "--no-color", "--no-ext-diff", "-M", "--format=", "--stat=100", "--patch", full], DIFF_CAP);
        if (r.code) ctx.json(res, 500, { error: tail(r.err, 3) || "git show failed" });
        else ctx.json(res, 200, { hash: full, diff: r.out, truncated: r.cut });
        return true;
      }
      if (req.method !== "POST") { ctx.json(res, 405, { error: "use POST" }); return true; }
      const o = await ctx.body(req);
      if (!o || o.confirm !== true) { ctx.json(res, 400, { error: "send {confirm:true} to restore" }); return true; }
      const [code, out] = await restore(hm[1]);
      ctx.json(res, code, out);
      return true;
    }
    if (p === "/api/updates") {
      if (req.method !== "GET") ctx.json(res, 405, { error: "use GET" });
      else ctx.json(res, 200, view());
      return true;
    }
    const m = /^\/api\/updates\/(check|settings|adapt|restart)$/.exec(p);
    if (!m) return false;
    if (req.method !== "POST") { ctx.json(res, 405, { error: "use POST" }); return true; }
    const o = await ctx.body(req);
    const act = m[1];
    if (act === "check") {
      if (busy) { ctx.json(res, 409, { error: "A check or update is already running.", ...view() }); return true; }
      exclusive("check", check).then(() => { const ms = next(true); if (S.auto) schedule(ms); save(); });
      ctx.json(res, 200, { ok: true, ...view() });
      return true;
    }
    if (act === "settings") {
      // Validate first, so a rejected request changes nothing.
      const h = o.intervalHours === undefined ? S.intervalHours : Math.round(Number(o.intervalHours));
      if (!(h >= 1 && h <= 48)) { ctx.json(res, 400, { error: "intervalHours must be 1 to 48" }); return true; }
      if (typeof o.auto === "boolean") S.auto = o.auto;
      S.intervalHours = h;
      schedule(sinceLast());
      save();
      ctx.json(res, 200, view());
      return true;
    }
    if (act === "adapt") {
      if (o.force !== true) { ctx.json(res, 400, { error: "send {force:true} to adapt again" }); return true; }
      if (busy) { ctx.json(res, 409, { error: "A check or update is already running.", ...view() }); return true; }
      exclusive("adapt", reAdapt);
      ctx.json(res, 200, { ok: true, ...view() });
      return true;
    }
    // restart
    const n = ctx.activeRuns();
    if (n > 0) { ctx.json(res, 409, { error: `Claude is working on ${n} chat${n === 1 ? "" : "s"} or council${n === 1 ? "" : "s"}. Restart once ${n === 1 ? "it finishes" : "they finish"}.` }); return true; }
    if (busy) { ctx.json(res, 409, { error: "An update is in progress. Restart once it finishes." }); return true; }
    restartNow();
    ctx.json(res, 200, { ok: true });
    return true;
  }

  const api = { route, start };
  // The test harness drives these directly; production never sets ctx.updatesTest.
  if (ctx.updatesTest) Object.assign(api, { check: () => exclusive("check", check), reAdapt: () => exclusive("adapt", reAdapt), readVersions, verify, apiTest, changelogRange, scope, appRel, undo, commitBefore, commitAdapt, historyList, restore, repoProblem, io: H, stop: () => { clearTimeout(checkTimer); stopRestart(); }, isBusy: () => busy });
  return api;
};
