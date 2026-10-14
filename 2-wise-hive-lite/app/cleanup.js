// Disk cleanup with retention: old chat uploads, old sketches, old copies of The Wise Hive (backups) and big log files.
// NEVER touches transcripts, memories, ideas, training records or work logs: removal is limited to the folders in
// ALLOWED below and re-checked per path. Settings live outside app\ (updater/git leave them alone):
// <brain>\app-settings\cleanup.json; every removal is logged to app-settings\cleanup-log.jsonl.
// Roots can be overridden for tests with HIVE_CLEANUP_BRAIN / HIVE_CLEANUP_APP.
const fs = require("fs");
const { writeFileAtomic } = require("./lib/fsx");
const path = require("path");

const DAY = 24 * 3600 * 1000, MB = 1024 * 1024;
const OPTIONS = {
  uploads: [7, 14, 30, 60, 90, 180, 365, 0],   // days; 0 = keep forever
  sketches: [7, 14, 30, 60, 90, 180, 365, 0],
  backups: [1, 2, 3, 5, 10, 20, 0],            // newest N copies; 0 = keep all
  logs: [1, 2, 5, 10, 0],                      // MB kept at the end of each log; 0 = never trim
};
const DEFAULTS = { uploads: 60, sketches: 0, backups: 5, logs: 2, auto: true };

function sizeOf(p) {
  let st; try { st = fs.lstatSync(p); } catch { return 0; }
  if (!st.isDirectory()) return st.size;
  let n = 0;
  try { for (const e of fs.readdirSync(p)) n += sizeOf(path.join(p, e)); } catch {}
  return n;
}
// The "kept" folders are shown for context only (never removed) and are the big ones (transcripts alone is ~750 MB of
// files): walking them on every preview was most of its time (profile: ~95 ms a call), so their size is reused for
// 10 minutes. The folders the cleanup acts on are always measured fresh.
const keptCache = new Map(); // folder -> { at, size }
function keptSize(p, now = Date.now()) {
  const c = keptCache.get(p);
  if (c && now - c.at >= 0 && now - c.at < 10 * 60e3) return c.size;
  const size = sizeOf(p); keptCache.set(p, { at: now, size }); return size;
}
const countOf = (p) => { try { return fs.readdirSync(p).filter((f) => !f.startsWith(".")).length; } catch { return 0; } };
const mtime = (p) => { try { return fs.statSync(p).mtimeMs; } catch { return 0; } };
const ls = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }); } catch { return []; } };
const inside = (child, parent) => { const r = path.relative(parent, child); return !!r && !r.startsWith("..") && !path.isAbsolute(r); };

// Pure planning: what each category holds and what the settings would remove. No side effects.
function plan(roots, settings, now = Date.now()) {
  const { BRAIN, APP } = roots, s = { ...DEFAULTS, ...settings };
  const UP = path.join(BRAIN, "uploads"), SK = path.join(BRAIN, "sketches"), BK = path.join(APP, "backups");
  const cats = [];

  // Uploads: one folder per day (uploads\YYYY-MM-DD\), dated by its name.
  const up = { key: "uploads", label: "Chat attachments and pictures", where: "uploads\\<date>\\", unit: "days", keep: s.uploads, size: sizeOf(UP), count: 0, remove: [] };
  for (const e of ls(UP)) {
    if (!e.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(e.name)) continue;
    up.count++;
    const age = Math.floor((now - Date.parse(e.name + "T00:00:00")) / DAY);
    if (s.uploads > 0 && age > s.uploads) { const p = path.join(UP, e.name); up.remove.push({ path: p, name: e.name, bytes: sizeOf(p), why: `${age} days old` }); }
  }
  cats.push(up);

  // Sketches: the .png and Claude's reading (.md) go together, by file age.
  const sk = { key: "sketches", label: "Sketches", where: "sketches\\", unit: "days", keep: s.sketches, size: sizeOf(SK), count: 0, remove: [] };
  for (const e of ls(SK)) {
    if (!e.isFile() || !/^[\w-]{1,80}\.(png|md)$/.test(e.name)) continue;
    if (e.name.endsWith(".png")) sk.count++;
    const p = path.join(SK, e.name), age = Math.floor((now - mtime(p)) / DAY);
    if (s.sketches > 0 && age > s.sketches) sk.remove.push({ path: p, name: e.name, bytes: sizeOf(p), why: `${age} days old` });
  }
  cats.push(sk);

  // Backups: app\backups\* and app\backup-*. Keep the newest N, and always the one the updater may still restore.
  const protect = new Set();
  try {
    const S = JSON.parse(fs.readFileSync(path.join(BRAIN, "updates", "state.json"), "utf8"));
    const last = (S.history || []).slice().reverse().find((h) => h.type === "adapt" && h.backup);
    for (const d of [S.adapting && S.adapting.backup, last && last.backup]) if (d) protect.add(path.resolve(APP, d).toLowerCase());
  } catch {}
  const dirs = [
    ...ls(BK).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => path.join(BK, e.name)),
    ...ls(APP).filter((e) => e.isDirectory() && /^backup-/i.test(e.name)).map((e) => path.join(APP, e.name)),
  ].map((p) => ({ p, t: mtime(p) })).sort((a, b) => b.t - a.t);
  const bk = { key: "backups", label: "Old copies of The Wise Hive", where: "app\\backups\\, app\\backup-*", unit: "copies", keep: s.backups, size: dirs.reduce((n, d) => n + sizeOf(d.p), 0), count: dirs.length, remove: [] };
  if (s.backups > 0) dirs.slice(s.backups).forEach((d) => {
    if (protect.has(d.p.toLowerCase())) return;
    bk.remove.push({ path: d.p, name: path.relative(APP, d.p), bytes: sizeOf(d.p), why: `older than the newest ${s.backups}` });
  });
  cats.push(bk);

  // Logs: trimmed in place to their last N MB (never deleted), once 25% over so it isn't rewritten for a few bytes.
  const logs = ["server.log", "server.err.log"].map((f) => path.join(APP, f)).filter((f) => fs.existsSync(f));
  const lg = { key: "logs", label: "Log files", where: "app\\server.log, server.err.log", unit: "MB", keep: s.logs, size: logs.reduce((n, f) => n + sizeOf(f), 0), count: logs.length, remove: [], trim: true };
  for (const f of logs) { const b = sizeOf(f); if (s.logs > 0 && b > s.logs * MB * 1.25) lg.remove.push({ path: f, name: path.basename(f), bytes: b - s.logs * MB, why: `${(b / MB).toFixed(1)} MB, trim to the last ${s.logs} MB` }); }
  cats.push(lg);

  for (const c of cats) c.removeBytes = c.remove.reduce((n, r) => n + r.bytes, 0);
  // Shown for context only; nothing here is ever removed.
  const kept = [["Conversations (full copies)", path.join(BRAIN, "transcripts")], ["Memories", path.join(BRAIN, "memory")], ["Ideas", path.join(BRAIN, "ideas")], ["Training records", path.join(BRAIN, "training")], ["Work logs and round pictures", path.join(BRAIN, "working")]]
    .map(([label, p]) => ({ label, size: keptSize(p, now), count: countOf(p) }));
  return { categories: cats, kept, total: cats.reduce((n, c) => n + c.removeBytes, 0) };
}

// Keeps the last `keep` bytes of a log, starting at a line break. The running server appends to server.log through
// an O_APPEND stream, so later writes land at the current end. Lines it appends while this runs are copied along
// (re-checked until the size holds still), so only a write in the instant before the truncate could be lost.
// A locked file is reported, not fatal.
function trimLog(file, keep) {
  let fd;
  try {
    fd = fs.openSync(file, "r+");
    const size = fs.fstatSync(fd).size;
    if (size <= keep) return { ok: true, freed: 0 };
    const buf = Buffer.alloc(keep);
    fs.readSync(fd, buf, 0, keep, size - keep);
    const nl = buf.indexOf(10), tail = nl >= 0 && nl < keep - 1 ? buf.subarray(nl + 1) : buf;
    const head = Buffer.from(`${new Date().toISOString()} cleanup: trimmed this log to its last ${(tail.length / MB).toFixed(1)} MB\n`);
    fs.writeSync(fd, head, 0, head.length, 0);
    fs.writeSync(fd, tail, 0, tail.length, head.length);
    let end = head.length + tail.length, seen = size;
    for (let i = 0; i < 20; i++) {
      const now = fs.fstatSync(fd).size;
      if (now <= seen) break;
      const more = Buffer.alloc(now - seen);
      fs.readSync(fd, more, 0, more.length, seen);
      fs.writeSync(fd, more, 0, more.length, end);
      end += more.length; seen = now;
    }
    fs.ftruncateSync(fd, end);
    return { ok: true, freed: seen - end };
  } catch (e) { return { ok: false, error: e.code === "EBUSY" || e.code === "EPERM" ? "the file is locked; try again later" : e.message }; }
  finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }
}

// Carries out a plan. Every path is re-checked against the allowed folders before anything is removed.
function apply(roots, p, only) {
  const { BRAIN, APP } = roots;
  const NEVER = /[\\/](transcripts|memory|ideas|training|working|projects|knowledge|librarian|council|clarifier|prompts|autopilot)([\\/]|$)/i;
  const allowed = { uploads: [path.join(BRAIN, "uploads")], sketches: [path.join(BRAIN, "sketches")], backups: [path.join(APP, "backups"), APP], logs: [APP] };
  const done = [], failed = [];
  for (const c of p.categories) {
    if (only && !only.includes(c.key)) continue;
    for (const r of c.remove) {
      const t = path.resolve(r.path), rel = path.relative(BRAIN, t);
      const ok = allowed[c.key].some((root) => inside(t, root)) && !NEVER.test(path.sep + (inside(t, BRAIN) ? rel : t))
        && (c.key !== "backups" || inside(t, path.join(APP, "backups")) || /^backup-/i.test(path.basename(t)) && path.dirname(t) === path.resolve(APP))
        && (c.key !== "logs" || /^server(\.err)?\.log$/.test(path.basename(t)));
      if (!ok) { failed.push({ cat: c.key, name: r.name, error: "outside the cleanup folders, skipped" }); continue; }
      if (c.key === "logs") {
        const x = trimLog(t, c.keep * MB);
        (x.ok ? done : failed).push({ cat: c.key, name: r.name, bytes: x.freed || 0, error: x.error });
        continue;
      }
      try { fs.rmSync(t, { recursive: true, force: true, maxRetries: 2 }); done.push({ cat: c.key, name: r.name, bytes: r.bytes }); }
      catch (e) { failed.push({ cat: c.key, name: r.name, error: e.code === "EBUSY" || e.code === "EPERM" ? "in use, skipped" : e.message }); }
    }
  }
  return { at: new Date().toISOString(), freed: done.reduce((n, d) => n + (d.bytes || 0), 0), done, failed };
}

module.exports = (ctx) => {
  const roots = { BRAIN: process.env.HIVE_CLEANUP_BRAIN || ctx.BRAIN, APP: process.env.HIVE_CLEANUP_APP || ctx.APP_DIR };
  const DIR = path.join(roots.BRAIN, "app-settings"), FILE = path.join(DIR, "cleanup.json"), LOG = path.join(DIR, "cleanup-log.jsonl");
  const load = () => { try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE, "utf8")) }; } catch { return { ...DEFAULTS }; } };
  const save = (s) => writeFileAtomic(FILE, JSON.stringify(s, null, 1));
  let running = false;
  // "Yes, clean up" removes what the user was shown: each preview remembers its items (cat|path), and a run tied to
  // one only removes items that were in it AND still qualify now (the plan is recalculated and the two intersected).
  const previews = new Map();
  function remember(p) {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    previews.set(id, new Set(p.categories.flatMap((c) => c.remove.map((r) => c.key + "|" + path.resolve(r.path).toLowerCase()))));
    while (previews.size > 20) previews.delete(previews.keys().next().value);
    return id;
  }
  function run(auto, only, previewId) {
    if (running) return { error: "A cleanup is already running." };
    const shown = previewId == null ? null : previews.get(String(previewId));
    if (previewId != null && !shown) return { error: "That list is out of date (The Wise Hive restarted or it was replaced). Look at the new list and press Clean up again." };
    running = true;
    try {
      const s = load(), p = plan(roots, s);
      if (shown) for (const c of p.categories) { c.remove = c.remove.filter((r) => shown.has(c.key + "|" + path.resolve(r.path).toLowerCase())); c.removeBytes = c.remove.reduce((n, r) => n + r.bytes, 0); }
      const r = apply(roots, p, only);
      s.lastRun = r.at; s.lastResult = { freed: r.freed, removed: r.done.length, failed: r.failed.length, auto: !!auto }; save(s);
      if (r.done.length || r.failed.length) try { fs.appendFileSync(LOG, JSON.stringify({ ...r, auto: !!auto }) + "\n"); } catch {}
      ctx.broadcast && ctx.broadcast({ t: "cleanup", freed: r.freed, at: r.at });
      if (r.done.length) console.log(new Date().toISOString(), `cleanup: removed ${r.done.length} item(s), freed ${(r.freed / MB).toFixed(1)} MB${auto ? " (daily)" : ""}`);
      return r;
    } finally { running = false; }
  }
  const view = () => { const s = load(), p = plan(roots, s); return { settings: s, options: OPTIONS, ...p, previewId: remember(p) }; };
  return {
    async route(p, req, res) {
      if (!p.startsWith("/api/cleanup")) return false;
      try {
        if (p === "/api/cleanup/preview" && req.method === "GET") return ctx.json(res, 200, view()), true;
        if (p === "/api/cleanup/settings" && req.method === "POST") {
          const o = await ctx.body(req), s = load();
          for (const k of Object.keys(OPTIONS)) if (k in o) { const v = Number(o[k]); if (!OPTIONS[k].includes(v)) return ctx.json(res, 400, { error: `bad value for ${k}` }), true; s[k] = v; }
          if ("auto" in o) s.auto = !!o.auto;
          save(s);
          return ctx.json(res, 200, view()), true;
        }
        if (p === "/api/cleanup/run" && req.method === "POST") {
          const o = await ctx.body(req);
          const only = Array.isArray(o.only) ? o.only.filter((k) => k in OPTIONS) : null;
          // The page always sends the preview it showed; a manual run without one is refused rather than guessed at.
          if (o.preview == null) return ctx.json(res, 400, { error: "Look at the list first (Clean up shows it), then confirm." }), true;
          const r = run(false, only && only.length ? only : null, o.preview);
          return ctx.json(res, r.error ? 409 : 200, { result: r, ...view() }), true;
        }
        return false;
      } catch (e) { return ctx.json(res, 500, { error: String(e && e.message || e) }), true; }
    },
    start() {
      // Daily, 3 minutes after start at the earliest, only if switched on.
      const tick = () => { try { if (load().auto) run(true); } catch (e) { console.error("cleanup:", e); } };
      const last = Date.parse(load().lastRun || "") || 0, wait = Math.max(3 * 60000, DAY - (Date.now() - last));
      const loop = (ms) => setTimeout(() => { tick(); loop(DAY); }, ms).unref();
      loop(wait);
    },
  };
};
Object.assign(module.exports, { plan, apply, trimLog, OPTIONS, DEFAULTS });
