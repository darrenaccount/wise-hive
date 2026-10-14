// Trim notes (Library -> "Trim notes"): Claude rewrites the brain's notes in fewer words without dropping information,
// so every agent that recalls them spends fewer tokens. Notes = memory\*.md, knowledge\*.md, projects\*.md,
// blender\LESSONS.md and INDEX.md (files under MIN_WORDS are left alone).
// Safety: every candidate is copied to <brain>\librarian\trim-backups\<stamp>\ before Claude starts (the last 5 kept).
// When the run ends, a free check compares each file with its backup: a file whose frontmatter changed, that vanished,
// or that lost any path, command or code span, URL, [[link]] or markdown link target is put back automatically and
// listed. The report (<brain>\librarian\trim-report.json) shows words before/after per file; Undo restores one file
// or all of them from the backup.
//   POST /api/trim          SSE stream of the run (like the Librarian), then {t:"trim", report}
//   GET  /api/trim          { words (current total), report (last run or null), running }
//   POST /api/trim/undo     { file? } -> restores that file (relative path) or every file of the last run
"use strict";
const fs = require("fs");
const { writeFileAtomic } = require("./lib/fsx");
const path = require("path");

const MIN_WORDS = 150, KEEP_BACKUPS = 5;
const words = (t) => (String(t || "").match(/\S+/g) || []).length;
// What must survive a trim: code spans, Windows paths, URLs, [[links]], markdown link targets, and "technical atoms"
// (words with a path separator, a file extension or version dot, =, (), or a digit: file names, commands, numbers,
// dates). Code spans are paired per line and only on lines whose backticks balance (PowerShell notes use a lone ` as
// the escape character, which would otherwise pair the wrong backticks and report sentence fragments as lost).
const STOP = new Set(["e.g", "i.e", "etc", "vs", "a.m", "p.m"]);
function keys(text) {
  const t = String(text || ""), out = new Set();
  for (const line of t.split(/\r?\n/)) {
    const parts = line.split("`");
    if (parts.length > 2 && parts.length % 2 === 1) for (let i = 1; i < parts.length; i += 2) { const c = parts[i].trim(); if (c.length >= 2 && c.length <= 200) out.add("`" + parts[i] + "`"); }
  }
  for (const re of [/[A-Za-z]:\\[^\s`)"'<>|*?]+/g, /https?:\/\/[^\s)>\]"'`]+/g, /\[\[[^\]\n]{1,80}\]\]/g, /\]\(([^)\s]{1,200})\)/g]) {
    for (const m of t.matchAll(re)) out.add((m[1] || m[0]).replace(/[.,;:]+$/, ""));
  }
  for (const w of t.split(/[\s`*|]+/)) {
    const a = w.replace(/^[("'[{<]+|[)"'\]}>.,;:!?]+$/g, "");
    if (a.length < 3 || a.length > 120 || STOP.has(a.toLowerCase())) continue;
    if (/[\\/]|\w\.\w|=|\w\(|\d/.test(a)) out.add(a);
  }
  return out;
}
const hash = (t) => require("crypto").createHash("sha1").update(String(t == null ? "" : t)).digest("hex");
const front = (t) => { const m = /^---\r?\n[\s\S]*?\r?\n---/.exec(String(t || "")); return m ? m[0].replace(/\r\n/g, "\n") : ""; };

module.exports = (ctx) => {
  const BRAIN = ctx.BRAIN, LIB = path.join(BRAIN, "librarian"), BACKUPS = path.join(LIB, "trim-backups"), REPORT = path.join(LIB, "trim-report.json");
  let running = false;
  const rel = (f) => path.relative(BRAIN, f);
  function candidates() {
    const out = [];
    for (const d of ["memory", "knowledge", "projects"]) {
      try { for (const n of fs.readdirSync(path.join(BRAIN, d))) if (n.endsWith(".md")) out.push(path.join(BRAIN, d, n)); } catch {}
    }
    for (const f of [path.join(BRAIN, "blender", "LESSONS.md"), path.join(BRAIN, "INDEX.md")]) if (fs.existsSync(f)) out.push(f);
    return out.map((f) => ({ f, w: words(ctx.read(f)) })).filter((x) => x.w >= MIN_WORDS).sort((a, b) => b.w - a.w);
  }
  const total = () => candidates().reduce((s, x) => s + x.w, 0);
  const readReport = () => { try { return JSON.parse(fs.readFileSync(REPORT, "utf8")); } catch { return null; } };

  function backup(list) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-"), dir = path.join(BACKUPS, stamp);
    for (const { f } of list) { const to = path.join(dir, rel(f)); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(f, to); }
    try { // keep the newest few
      const all = fs.readdirSync(BACKUPS).sort();
      for (const old of all.slice(0, Math.max(0, all.length - KEEP_BACKUPS))) fs.rmSync(path.join(BACKUPS, old), { recursive: true, force: true });
    } catch {}
    return dir;
  }

  // After the run: words before/after, and the free safety check (restore a file that lost a key detail).
  function check(list, dir) {
    const files = [];
    for (const { f, w } of list) {
      const r = rel(f), orig = ctx.read(path.join(dir, r)), now = ctx.read(f);
      if (orig == null) continue;
      const item = { file: r, before: w, after: now == null ? 0 : words(now), restored: false, missing: [] };
      if (now == null) item.missing.push("the file was deleted");
      else {
        if (front(orig) !== front(now)) item.missing.push("its frontmatter changed");
        const keep = keys(now);
        for (const k of keys(orig)) if (!keep.has(k) && !now.includes(k)) item.missing.push(k);
      }
      if (item.missing.length) { fs.copyFileSync(path.join(dir, r), f); item.restored = true; item.after = item.before; }
      item.hash = hash(ctx.read(f)); // what the trim left, so Undo can tell when the note changed again afterwards
      files.push(item);
    }
    const before = files.reduce((s, x) => s + x.before, 0), after = files.reduce((s, x) => s + x.after, 0);
    return { at: new Date().toISOString(), backup: dir, before, after, files };
  }

  function prompt(list) {
    return `You are the TRIMMER of ${BRAIN}, the long-term memory of Claude for this user. Agents read these notes to recall what the hive knows, so every extra word costs usage on every recall. Your job: say the same things in fewer words, without losing any information.

Files (largest first, words in brackets):
${list.map((x) => `- ${rel(x.f)} (${x.w})`).join("\n")}

For each file: Read it, then rewrite it in place (Write) so it carries the same information in fewer words.
- Cut filler, hedging, repetition, restated context and narration ("I then...", "Note that..."). Turn long sentences into short ones and loose prose into tight bullets where that reads better.
- KEEP every fact, decision and its reason, number, date, name, file path, command, code, error text, mistake and its fix, and every link ([[name]] and markdown links) exactly as written.
- Keep the frontmatter block (between the --- lines) byte for byte. Keep headings that organise the content.
- memory\\MEMORY.md stays one line per memory file: "- [Title](file.md) — hook" (shorten only the hooks).
- Don't merge, move, rename or delete files (the Organizer does that), and don't add anything new.
- Skip a file that is already tight. Aim for about 30-50% fewer words; when in doubt, keep the detail.
Before moving to the next file, check your version against the original you read: every detail must still be there. A checker compares each file with a backup afterwards and puts back any file that lost a path, command, URL or link.
Finish with a short table: file | words before -> after.`;
  }

  async function start(res) {
    const send = ctx.sse(res);
    if (running) { send({ t: "result", text: "Trimming is already running." }); send({ t: "end" }); return res.end(); }
    const list = candidates();
    if (!list.length) { send({ t: "result", text: "No notes are long enough to trim." }); send({ t: "end" }); return res.end(); }
    running = true;
    let dir;
    try { dir = backup(list); } catch (e) { running = false; send({ t: "result", text: "Couldn't back the notes up, so nothing was changed: " + e.message, error: true }); send({ t: "end" }); return res.end(); }
    const run = ctx.runClaude({ prompt: prompt(list), cwd: BRAIN, mode: "edit", model: "sonnet", maxTurns: 160, lean: "Read,Write,Edit,Glob,Grep",
      onEvent: (ev) => { const s = ctx.simplify(ev); if (s) send(s); },
      onEnd: (code, err) => {
        let report = null;
        try { report = check(list, dir); writeFileAtomic(REPORT, JSON.stringify(report, null, 1)); } catch (e) { console.error(new Date().toISOString(), "trim check:", e && e.message || e); }
        running = false;
        send({ t: "trim", report });
        send({ t: "end", code, err: code ? err : "" }); res.end();
      } });
    send({ t: "run", run });
  }

  // Undo puts the backed-up notes back. The report is a file any run in the brain could write, so only a backup folder
  // under librarian\trim-backups and only the notes a trim touches (the candidates() folders) are accepted. A note that
  // changed again after the trim (say a Training round added a lesson) is left alone and listed, not overwritten.
  const NOTE = /^(?:(?:memory|knowledge|projects)[\\/][^\\/]+\.md|blender[\\/]LESSONS\.md|INDEX\.md)$/i;
  function undo(file) {
    const r = readReport();
    const back = r && r.backup ? path.resolve(r.backup) : "";
    if (!back || !back.toLowerCase().startsWith(BACKUPS.toLowerCase() + path.sep) || !fs.existsSync(back)) return { error: "There is no trim to undo." };
    const files = (r.files || []).filter((x) => !file || x.file === file);
    if (!files.length) return { error: "That file wasn't part of the last trim." };
    const skipped = [];
    for (const x of files) {
      if (!NOTE.test(String(x.file || ""))) continue;
      const src = path.join(back, x.file), dst = path.resolve(BRAIN, x.file);
      if (!dst.startsWith(BRAIN + path.sep) || !fs.existsSync(src)) continue;
      if (x.hash && hash(ctx.read(dst)) !== x.hash) { skipped.push(x.file); x.changedSince = true; continue; }
      fs.copyFileSync(src, dst); x.after = x.before; x.undone = true;
    }
    r.after = r.files.reduce((s, x) => s + x.after, 0);
    writeFileAtomic(REPORT, JSON.stringify(r, null, 1));
    return { report: r, skipped };
  }

  return {
    async route(p, req, res) {
      if (p === "/api/trim" && req.method === "GET") { const c = candidates(); ctx.json(res, 200, { words: c.reduce((s, x) => s + x.w, 0), files: c.length, report: readReport(), running }); return true; }
      if (p === "/api/trim" && req.method === "POST") { fs.mkdirSync(LIB, { recursive: true }); await start(res); return true; }
      if (p === "/api/trim/undo" && req.method === "POST") {
        const b = await ctx.body(req), out = undo(b.file ? String(b.file) : "");
        ctx.json(res, out.error ? 400 : 200, out); return true;
      }
      return false;
    },
  };
};
module.exports.keys = keys;
module.exports.words = words;
