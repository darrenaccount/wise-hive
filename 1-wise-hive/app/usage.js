// Usage meter and "away" guards for Training and Working (autopilot.js loads this; it can also sit in the module list).
// How much of the Claude plan's limits is used, read for free from three places; per window, the newest reading wins:
//   1. GET api.anthropic.com/api/oauth/usage with the CLI's own login token (the numbers the CLI's /usage shows), at most
//      every few minutes.
//   2. When the token is missing, expired or refused: `claude -p /usage`. It costs nothing (no model call) and the CLI
//      refreshes its own login on the way. We never refresh the token here: refresh tokens rotate, so doing it would
//      log the CLI out. The token is never logged or sent anywhere but that one Anthropic endpoint.
//   3. Passively: every live chat reports a rate_limit_event after each API turn (server.js hands it to hub "ratelimit").
// Plus isGaming() for "Pause while I'm gaming": Roblox running, or a true-fullscreen app in front (not a browser or video player).
const fs = require("fs"), os = require("os"), path = require("path"), https = require("https");
const { spawn, execFile } = require("child_process");

const MARGIN = 90e3; // resume a little after a reset, so the first new round doesn't land on the old window
const GAMES = ["RobloxPlayerBeta"];
// Foreground windows that cover the screen but aren't a game: the desktop, the shell, The Wise Hive itself, overlays, and
// browsers / video players (a fullscreen video is watching, not gaming). ApplicationFrameHost hosts Store apps such as
// Movies & TV. Roblox counts through GAMES, not through this check.
const NOT_GAME = new RegExp("^(" + ["explorer", "electron", "teamwright", "ShellExperienceHost", "StartMenuExperienceHost", "SearchHost", "SearchApp", "LockApp",
  "TextInputHost", "Medal", "ApplicationFrameHost", "chrome", "chromium", "msedge", "msedgewebview2", "firefox", "librewolf", "waterfox", "opera", "opera_gx",
  "brave", "vivaldi", "arc", "iexplore", "vlc", "mpc-hc", "mpc-hc64", "mpc-be", "mpc-be64", "mpv", "PotPlayer", "PotPlayerMini", "PotPlayerMini64",
  "wmplayer", "Video.UI", "Microsoft.Media.Player", "Netflix", "Plex", "Kodi", "Spotify", "POWERPNT"].map((n) => n.replace(/[.\-]/g, "\\$&")).join("|") + ")$", "i");
const WS_CAPTION = 0x00c00000;
const DESKTOP_CLASS = /^(Progman|WorkerW|Shell_TrayWnd|Shell_SecondaryTrayWnd)$/;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const cap1 = (s) => String(s || "").charAt(0).toUpperCase() + String(s || "").slice(1);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const msOf = (v) => { if (v == null || v === "") return null; if (typeof v === "number") return v < 1e12 ? v * 1000 : v; const t = Date.parse(v); return Number.isFinite(t) ? t : null; };
// Windows are keyed "session:" / "weekly:" / "weekly:fable" (a model-scoped week).
const keyOf = (group, scope) => `${group}:${String(scope || "").toLowerCase()}`;
const win = (group, scope, percent, resetsAt, at, src) => ({ key: keyOf(group, scope), group, scope: scope || null, percent, resetsAt, at, src,
  label: group === "session" ? "Session" : scope ? `${scope} week` : "Week" });
// The API's named windows and the stream's unifiedWindows use the same names.
function named(name) {
  if (name === "five_hour") return ["session", null];
  if (name === "seven_day") return ["weekly", null];
  const m = /^seven_day_(opus|sonnet|haiku|fable)$/.exec(name); // the other seven_day_* names are internal buckets, not plan limits
  return m ? ["weekly", cap1(m[1])] : null;
}

// Wall-clock time in an IANA zone -> epoch ms (the CLI prints resets in the account's zone).
// The zone's offset is read at the guess and then again at the corrected time, until it settles: one pass is an hour
// off when a DST change falls between the two (e.g. "Nov 1, 3am" read on Oct 30 in America/Los_Angeles).
function zoned(y, mo, d, h, mi, tz) {
  const guess = Date.UTC(y, mo, d, h, mi);
  try {
    const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    const off = (t) => { const g = Object.fromEntries(f.formatToParts(new Date(t)).map((p) => [p.type, p.value])); return Date.UTC(+g.year, +g.month - 1, +g.day, +g.hour % 24, +g.minute) - t; };
    let t = guess - off(guess);
    for (let i = 0; i < 3; i++) { const n = guess - off(t); if (n === t) break; t = n; } // a time skipped by spring-forward never settles; any answer is close
    return t;
  } catch { return new Date(y, mo, d, h, mi).getTime(); }
}
// "Oct 12, 6:49am" or "3am" (no year, maybe no date): the next time it happens.
function parseWhen(s, tz, now = Date.now()) {
  const m = /^(?:([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? )?(\d{1,2})(?::(\d{2}))? ?([ap])\.?m\.?$/i.exec(String(s || "").trim());
  if (!m) return null;
  const h = (Number(m[3]) % 12) + (m[5].toLowerCase() === "p" ? 12 : 0), mi = Number(m[4] || 0);
  // An unknown zone name ("PDT") throws here: use local time then rather than losing every window of the reading.
  const dayParts = (z) => Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: z, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(new Date(now)).map((p) => [p.type, p.value]));
  let parts;
  try { parts = dayParts(tz || undefined); } catch { tz = undefined; parts = dayParts(undefined); }
  let y = Number(parts.year);
  if (m[1]) {
    const mo = MONTHS.indexOf(m[1].toLowerCase());
    if (mo < 0) return null;
    let t = zoned(y, mo, Number(m[2]), h, mi, tz);
    if (t < now - 864e5) t = zoned(++y, mo, Number(m[2]), h, mi, tz);
    return t;
  }
  let t = zoned(y, Number(parts.month) - 1, Number(parts.day), h, mi, tz);
  if (t < now - 60e3) t += 864e5;
  return t;
}

// Readings from each source -> window list.
function fromApi(j, at) {
  const out = [], seen = new Set();
  const add = (w) => { if (!seen.has(w.key) && w.percent != null) { seen.add(w.key); out.push(w); } };
  for (const l of Array.isArray(j && j.limits) ? j.limits : []) {
    if (!l || typeof l !== "object") continue;
    const group = l.group === "session" || /session|five_hour/.test(String(l.kind)) ? "session" : "weekly";
    const sm = l.scope && l.scope.model;
    add(win(group, sm ? sm.display_name || sm.id || null : null, num(l.percent), msOf(l.resets_at), at, "api"));
  }
  for (const [name, w] of Object.entries(j || {})) {
    const n = w && typeof w === "object" && "utilization" in w ? named(name) : null;
    if (n) add(win(n[0], n[1], num(w.utilization), msOf(w.resets_at), at, "api"));
  }
  return out;
}
// "Current session: 54% used · resets Oct 12, 6:49am (America/Los_Angeles)"; "Current week (Fable): 0% used · resets ...".
// A session that hasn't started has no "resets" part.
function fromCli(text, at) {
  const out = [];
  const re = /Current (session|week)(?: \(([^)]+)\))?: (\d+(?:\.\d+)?)% used(?:\s*\S\s*resets (.+?) \(([^)]+)\))?/g;
  for (const m of String(text || "").matchAll(re)) out.push(win(m[1] === "session" ? "session" : "weekly", m[2] || null, Number(m[3]), m[4] ? parseWhen(m[4], m[5], at) : null, at, "cli"));
  return out;
}
// rate_limit_info: utilization is 0-1 here (0-100 in the API); resetsAt is unix seconds.
function fromStream(info, at) {
  const out = [];
  if (!info || typeof info !== "object") return out;
  for (const [name, w] of Object.entries(info.unifiedWindows || {})) {
    const n = named(name), u = num(w && w.utilization);
    if (n && u != null) out.push(win(n[0], n[1], Math.round(u * 1000) / 10, msOf(w.resetsAt), at, "stream"));
  }
  // Refused outright: that window is full, whatever the last utilization said.
  const n = info.status === "rejected" && named(info.rateLimitType);
  if (n) {
    const k = keyOf(n[0], n[1]), w = out.find((x) => x.key === k);
    if (w) { w.percent = Math.max(w.percent, 100); w.resetsAt = msOf(info.resetsAt) || w.resetsAt; }
    else out.push(win(n[0], n[1], 100, msOf(info.resetsAt), at, "stream"));
  }
  return out;
}

// A model-scoped window ("Fable" week) only matters when a round uses that model.
const scopeHit = (scope, models) => { const s = String(scope || "").toLowerCase().split(/\s+/)[0]; return !!s && models.some((m) => String(m || "").toLowerCase().includes(s)); };
// Which windows are at or over `threshold` percent right now. A window whose reset time has passed counts as empty until
// a new reading comes in. until = the latest of their resets + MARGIN (null if one of them has no known reset).
function over(windows, threshold, models, now = Date.now()) {
  const hits = windows.filter((w) => w.percent != null && w.percent >= threshold && !(w.resetsAt && w.resetsAt <= now) && (!w.scope || scopeHit(w.scope, models)));
  if (!hits.length) return null;
  const known = hits.every((w) => w.resetsAt);
  const top = hits.reduce((a, b) => ((b.resetsAt || Infinity) > (a.resetsAt || Infinity) ? b : a));
  return { hits, top, until: known ? Math.max(...hits.map((w) => w.resetsAt)) + MARGIN : null };
}

// Foreground window check: one hidden PowerShell call. Prints PROC<TAB>name when a listed game has a window (a leftover
// windowless RobloxPlayerBeta was seen running for hours after a game closed; it mustn't pause the loops forever), else
// FG<TAB>process<TAB>class<TAB>window rect<TAB>monitor rect<TAB>window style, or NONE.
function gameScript(procs) {
  const list = procs.filter((p) => /^[\w.\- ]{1,60}$/.test(p)).map((p) => `'${p}'`).join(",") || "'-none-'";
  return `$ErrorActionPreference='SilentlyContinue'
$p = Get-Process -Name @(${list}) -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($p) { "PROC\`t" + $p.ProcessName; exit }
Add-Type -TypeDefinition @'
using System; using System.Text; using System.Runtime.InteropServices;
public static class HiveFg {
  [StructLayout(LayoutKind.Sequential)] public struct R { public int L, T, Rt, B; }
  [StructLayout(LayoutKind.Sequential)] public struct MI { public int cb; public R M; public R W; public uint F; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern IntPtr GetShellWindow();
  [DllImport("user32.dll")] public static extern IntPtr GetDesktopWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr h, uint f);
  [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr m, ref MI i);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
}
'@
$h = [HiveFg]::GetForegroundWindow()
if ($h -eq [IntPtr]::Zero -or $h -eq [HiveFg]::GetShellWindow() -or $h -eq [HiveFg]::GetDesktopWindow()) { 'NONE'; exit }
$r = New-Object HiveFg+R; [void][HiveFg]::GetWindowRect($h, [ref]$r)
$mi = New-Object HiveFg+MI; $mi.cb = [Runtime.InteropServices.Marshal]::SizeOf($mi); [void][HiveFg]::GetMonitorInfo([HiveFg]::MonitorFromWindow($h, 2), [ref]$mi)
$fpid = [uint32]0; [void][HiveFg]::GetWindowThreadProcessId($h, [ref]$fpid)
$sb = New-Object Text.StringBuilder 256; [void][HiveFg]::GetClassName($h, $sb, 256)
"FG\`t" + (Get-Process -Id $fpid).ProcessName + "\`t" + $sb + "\`t" + "$($r.L),$($r.T),$($r.Rt),$($r.B)" + "\`t" + "$($mi.M.L),$($mi.M.T),$($mi.M.Rt),$($mi.M.B)" + "\`t" + [HiveFg]::GetWindowLong($h, -16)`;
}
// -> { gaming, why }
function readGame(out) {
  const line = String(out || "").split(/\r?\n/).map((l) => l.trim()).find((l) => /^(PROC|FG|NONE)\b/.test(l)) || "";
  const f = line.split("\t");
  if (f[0] === "PROC") return { gaming: true, why: /roblox/i.test(f[1]) ? "Roblox" : f[1] };
  if (f[0] !== "FG" || f.length < 5) return { gaming: false, why: "" };
  const [, proc, cls, wr, mr] = f, w = wr.split(",").map(Number), m = mr.split(",").map(Number);
  if (NOT_GAME.test(proc) || DESKTOP_CLASS.test(cls) || w.length !== 4 || m.length !== 4 || m.some((x) => !Number.isFinite(x)) || m[2] <= m[0]) return { gaming: false, why: "" };
  // True fullscreen only: exactly the monitor's rect and no title bar. A maximized window (even with an auto-hide
  // taskbar) hangs a few pixels past the monitor's edges and keeps its caption.
  const exact = w.every((x, i) => x === m[i]), style = f[5] != null && f[5] !== "" ? Number(f[5]) : NaN;
  const caption = Number.isFinite(style) && (style & WS_CAPTION) === WS_CAPTION;
  return exact && !caption ? { gaming: true, why: proc } : { gaming: false, why: "" };
}

module.exports = (ctx) => {
  if (ctx.usage) return ctx.usage; // one instance, whether autopilot.js or the module list loads it first
  // Tests shrink these through ctx.usageTimings; production uses the defaults.
  const T = { poll: 4 * 60e3, floor: 60e3, backoff: 10 * 60e3, api: 5e3, cli: 60e3, game: 60e3, push: 5e3, ...(ctx.usageTimings || {}) };
  const CRED = path.join(ctx.HOME || os.homedir(), ".claude", ".credentials.json");
  const W = new Map(); // key -> window
  const meta = { at: 0, src: null, error: null }; // the last full read (API or CLI)
  let inflight = null, lastTry = 0, apiBackoff = 0, pushTimer = null;

  function take(list) {
    let changed = false;
    for (const w of list) { const old = W.get(w.key); if (!old || old.at <= w.at) { W.set(w.key, w); changed = true; } }
    if (changed) push();
  }
  // Tell open pages the meter moved (throttled: a busy chat reports after every turn).
  function push() {
    if (pushTimer) return;
    pushTimer = setTimeout(() => { pushTimer = null; try { ctx.broadcast({ t: "usage", usage: brief() }); } catch {} }, T.push);
    if (pushTimer.unref) pushTimer.unref();
  }
  const list = () => [...W.values()].sort((a, b) => (a.group === b.group ? String(a.scope || "").localeCompare(String(b.scope || "")) : a.group === "session" ? -1 : 1));
  // What the page shows. A window past its reset shows 0% until the next reading.
  function brief() {
    const now = Date.now();
    return { at: meta.at || null, src: meta.src, error: meta.error,
      windows: list().map((w) => ({ key: w.key, label: w.label, group: w.group, scope: w.scope, percent: w.resetsAt && w.resetsAt <= now ? 0 : w.percent, resetsAt: w.resetsAt && w.resetsAt > now ? w.resetsAt : null, at: w.at, src: w.src })) };
  }

  function token() {
    try {
      const o = JSON.parse(fs.readFileSync(CRED, "utf8")).claudeAiOauth || {};
      if (typeof o.accessToken !== "string" || !o.accessToken) return null;
      if (Number(o.expiresAt) && Number(o.expiresAt) < Date.now() + 60e3) return null; // expired: let the CLI refresh it
      return o.accessToken;
    } catch { return null; }
  }
  function getApi(tok) {
    return new Promise((done) => {
      let fin = false;
      const end = (v) => { if (!fin) { fin = true; clearTimeout(timer); done(v); } };
      const req = https.request("https://api.anthropic.com/api/oauth/usage", { method: "GET", timeout: T.api,
        headers: { Authorization: "Bearer " + tok, "anthropic-beta": "oauth-2025-04-20", "Content-Type": "application/json" } }, (res) => {
        let b = "";
        res.setEncoding("utf8");
        res.on("data", (d) => { if (b.length < 2e5) b += d; });
        res.on("end", () => { let j = null; try { j = JSON.parse(b); } catch {} end({ status: res.statusCode, json: j }); });
        res.on("error", () => end({ status: 0 }));
      });
      const timer = setTimeout(() => { req.destroy(); end({ status: 0 }); }, T.api + 500);
      req.on("timeout", () => req.destroy());
      req.on("error", () => end({ status: 0 }));
      req.end();
    });
  }
  // No hooks (the user's SessionStart/transcript hooks shouldn't fire for this) and no saved session.
  function getCli() {
    return new Promise((done) => {
      let out = "", fin = false;
      let child;
      try {
        child = spawn(ctx.CLAUDE || "claude", ["-p", "/usage", "--output-format", "stream-json", "--verbose", "--no-session-persistence", "--settings", '{"disableAllHooks":true}'],
          { cwd: os.tmpdir(), env: ctx.cleanEnv ? ctx.cleanEnv() : process.env, windowsHide: true });
      } catch { return done(""); }
      const end = () => { if (fin) return; fin = true; clearTimeout(timer); let text = ""; for (const l of out.split(/\r?\n/)) { try { const e = JSON.parse(l); if (e.type === "result" && e.result) text = e.result; } catch {} } done(text); };
      const timer = setTimeout(() => { try { execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], () => {}); } catch {} end(); }, T.cli);
      child.stdout.on("data", (d) => { if (out.length < 1e6) out += d.toString("utf8"); });
      child.stderr.on("data", () => {});
      child.on("close", end); child.on("error", end);
      try { child.stdin.end(); } catch {}
    });
  }
  async function read() {
    lastTry = Date.now();
    const tok = Date.now() >= apiBackoff ? token() : null;
    if (tok) {
      const r = await getApi(tok);
      const ws = r.status === 200 ? fromApi(r.json, Date.now()) : [];
      if (ws.length) { take(ws); Object.assign(meta, { at: Date.now(), src: "api", error: null }); return; }
      // Slow down like the CLI does; nothing else would help in the meantime.
      if (r.status === 429) { apiBackoff = Date.now() + T.backoff; meta.error = "The usage service asked to slow down; using the last reading."; return; }
      if (r.status === 403) apiBackoff = Date.now() + T.backoff;
    }
    // Missing, expired or refused token (or the service is down): the CLI's free /usage, which also refreshes its login.
    const ws = fromCli(await getCli(), Date.now());
    if (ws.length) { take(ws); Object.assign(meta, { at: Date.now(), src: "cli", error: null }); return; }
    meta.error = "Couldn't read your usage right now.";
  }
  // force: skip the "fresh enough" check, but never more often than T.floor.
  function refresh(force) {
    if (inflight) return inflight;
    const now = Date.now();
    if ((!force && now - meta.at < T.poll) || now - lastTry < T.floor) return Promise.resolve(brief());
    inflight = read().catch(() => { meta.error = "Couldn't read your usage right now."; }).then(() => { inflight = null; push(); return brief(); });
    return inflight;
  }
  // A window whose reset has passed holds stale numbers: read again before deciding on it.
  const stale = () => !meta.at || [...W.values()].some((w) => w.resetsAt && w.resetsAt <= Date.now() && w.at < w.resetsAt);

  // Gaming: cached, and the check runs only when asked (before a round, or once a minute during a gaming pause).
  let game = { at: 0, gaming: false, why: "" }, gameInflight = null;
  function isGaming(opts = {}) {
    const procs = Array.isArray(opts.procs) ? opts.procs : GAMES;
    if (!opts.procs && Date.now() - game.at < T.game) return Promise.resolve(game);
    if (!opts.procs && gameInflight) return gameInflight;
    const p = new Promise((done) => {
      execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", gameScript(procs)], { windowsHide: true, timeout: 20e3 },
        (err, stdout) => done({ at: Date.now(), ...(err && !stdout ? { gaming: false, why: "" } : readGame(stdout)) }));
    });
    if (opts.procs) return p; // tests: uncached
    gameInflight = p.then((g) => { game = g; gameInflight = null; return g; });
    return gameInflight;
  }

  try { if (ctx.hub) ctx.hub.on("ratelimit", (info) => take(fromStream(info, Date.now()))); } catch {}

  const api = {
    MARGIN, brief, refresh,
    // Fresh enough to decide on: re-reads when older than T.poll or a window has reset since.
    ensure: () => refresh(stale()),
    // { hits, top, until } when a window that counts for these models is at or over threshold, else null.
    over: (threshold, models) => over([...W.values()], threshold, models || []),
    // When the newest reading of any kind arrived (API, CLI or a chat's rate_limit_event); 0 = never.
    readAt: () => Math.max(meta.at || 0, ...[...W.values()].map((w) => w.at || 0)),
    isGaming,
    route(p, req, res) {
      if (p !== "/api/usage") return false;
      if (req.method !== "GET") { ctx.json(res, 405, { error: "use GET" }); return true; }
      refresh(false).then((b) => ctx.json(res, 200, b), () => ctx.json(res, 200, brief()));
      return true;
    },
    // For tests.
    _: { fromApi, fromCli, fromStream, parseWhen, over, readGame, scopeHit, take, W, meta },
  };
  ctx.usage = api;
  return api;
};
module.exports.helpers = { fromApi, fromCli, fromStream, parseWhen, over, readGame, scopeHit, MARGIN };
