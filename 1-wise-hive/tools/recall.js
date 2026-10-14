#!/usr/bin/env node
// Memory recall for every Claude Code session (hooks in ~/.claude/settings.json). Two jobs:
//
//   node recall.js start <n>   SessionStart, part n (1-based). Claude Code cuts any one hook's context over 10,000
//                              characters to a ~2 KB preview, but each hook gets its own 10,000 (tested 2026-10-13:
//                              two 9,000-char parts both arrived whole), so recall is split into parts of <= PART:
//                                part 1: INDEX.md, skills, memory index (only if Claude Code doesn't load it itself),
//                                        one-line pointers to the lessons and knowledge files, newest real sessions;
//                                then:   every knowledge\*.md file (always);
//                                then:   blender\LESSONS.md in full, only for Blender/game work: the session starts in
//                                        a project folder from app-settings, a folder named like blender/roblox/game,
//                                        or one holding .blend/.rbxl/Rojo files, or TEAMWRIGHT_RECALL=blender is set
//                                        (Training rounds).
//                              settings.json registers MAX_PARTS parts; a part with nothing to send prints nothing.
//
//   node recall.js prompt      UserPromptSubmit, every message: a quick local search (no Claude run) over memories,
//                              Blender lessons, knowledge notes and project-note sections; the few entries that best
//                              match the message are added to it (<= PROMPT_MAX chars). Entries already added in this
//                              chat (or sent whole at its start) aren't repeated. Nothing is added when nothing matches.
//
// Lives in <brain>\tools; reads the hook payload (JSON) from stdin; prints the hook's JSON on stdout; never fails a
// session (any error prints nothing and exits 0). Written 2026-10-13 (replaces recall.ps1's single, truncated part).
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");

const BRAIN = path.resolve(__dirname, "..");
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
const PART = 9300, MAX_PARTS = 14, PROMPT_MAX = 3000, PROMPT_ITEMS = 5, SEEN_DIR = path.join(os.tmpdir(), "teamwright-recall");

const read = (f) => { try { return fs.readFileSync(f, "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n"); } catch { return ""; } };
const list = (d, re) => { try { return fs.readdirSync(d).filter((n) => re.test(n)).sort().map((n) => path.join(d, n)); } catch { return []; } };
const payload = (() => { try { const t = fs.readFileSync(0, "utf8"); return t.trim() ? JSON.parse(t) : {}; } catch { return {}; } })();
const out = (event, text) => { if (text && text.trim()) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } })); };
const cap = (t, n) => { if (t.length <= n) return t; const cut = t.lastIndexOf("\n", n - 20); return t.slice(0, cut > n / 2 ? cut : n - 20) + "\n…"; };
// Splits text into chunks of <= size at line breaks (a single long line is cut).
function chunks(text, size) {
  const res = []; let cur = "";
  for (const line of text.split("\n")) {
    const l = line.length > size ? line.slice(0, size - 1) + "…" : line;
    if (cur.length + l.length + 1 > size && cur) { res.push(cur); cur = ""; }
    cur += (cur ? "\n" : "") + l;
  }
  if (cur.trim()) res.push(cur);
  return res;
}

/* ---------- session start ---------- */
function corePart() {
  const idx = path.join(BRAIN, "INDEX.md");
  const head = `# Recall from ${BRAIN} (loaded automatically at session start)\nBefore starting work, use what is below. Apply the matching skill and lessons instead of re-learning. Search ${BRAIN}\\transcripts\\readable\\ for details of past work. More memory arrives with your messages when it matches them.\n\n`;
  let index = read(idx).trim();
  const skills = [];
  for (const d of (() => { try { return fs.readdirSync(path.join(CLAUDE_DIR, "skills")); } catch { return []; } })()) {
    const t = read(path.join(CLAUDE_DIR, "skills", d, "SKILL.md"));
    const m = /^description:\s*(.+)$/m.exec(t);
    if (t) skills.push(`- **${d}**: ${m ? cap(m[1].trim(), 160).replace(/\n…$/, "…") : ""}`);
  }
  let memory = "";
  let auto = "";
  try { auto = JSON.parse(read(path.join(CLAUDE_DIR, "settings.json"))).autoMemoryDirectory || ""; } catch {}
  const memDir = path.join(BRAIN, "memory");
  if (!auto || path.resolve(auto).toLowerCase() !== memDir.toLowerCase()) { const m = read(path.join(memDir, "MEMORY.md")).trim(); if (m) memory = `## Memories (files in ${memDir})\n${m}`; }
  const ptr = [];
  const les = path.join(BRAIN, "blender", "LESSONS.md"), lt = read(les);
  if (lt) ptr.push(`- ${les} : ${(lt.match(/^\s*- /gm) || []).length} Blender lessons. ${blenderSession() ? "Sent in full below." : "Grep it for your topic before any Blender work (matching ones also arrive with your messages)."}`);
  for (const f of list(path.join(BRAIN, "knowledge"), /\.md$/i)) { const h = (/^#+\s*(.+)$/m.exec(read(f)) || [])[1] || ""; ptr.push(`- ${f} : ${h}`); }
  const real = (row) => {
    const cells = row.split("|").map((c) => c.trim()).filter(Boolean), req = (cells[cells.length - 1] || "").replace(/^﻿/, "");
    return req.length >= 12 && !/^[A-Za-z]:[\\/]/.test(req) && !/^\[[0-9a-f]{8}\]\(readable\//.test(req) && !/^(You are (the|a message relay)|\[(Hivemind|Teamwright|Wise Hive)|reply (ok|with)|run (exactly|these)|\(see attached\))/i.test(req);
  };
  let rows = read(path.join(BRAIN, "transcripts", "LOG.md")).split("\n").filter((r) => /^\| 20/.test(r) && real(r)).sort().reverse().slice(0, 8).map((r) => (r.length > 200 ? r.slice(0, 197) + "..." : r));
  const build = () => [head, index, skills.length ? "## Skills learned (use the Skill tool when one fits)\n" + skills.join("\n") : "", memory,
    ptr.length ? "## Lessons and knowledge files\n" + ptr.join("\n") : "", rows.length ? "## Most recent sessions\n" + rows.join("\n") : ""].filter(Boolean).join("\n\n");
  let text = build();
  while (text.length > PART && rows.length) { rows = rows.slice(0, -1); text = build(); }
  if (text.length > PART) { index = cap(index, Math.max(500, PART - (text.length - index.length) - 100)) + `\n(INDEX.md continues: read ${idx})`; text = build(); }
  return cap(text, PART);
}
function blenderSession() {
  if (/blender/i.test(process.env.TEAMWRIGHT_RECALL || "")) return true;
  const cwd = path.resolve(payload.cwd || process.cwd());
  // Any folder on the path named like blender/roblox (e.g. "MyRobloxStuff"), or a "game(s)" folder; personal project
  // folders come from the app's projectFolders/projectRoots below.
  if (/[\\/][^\\/]*(blender|roblox)[^\\/]*([\\/]|$)/i.test(cwd) || /[\\/]games?([\\/]|$)/i.test(cwd)) return true;
  let cfg = {};
  try { cfg = JSON.parse(read(path.join(BRAIN, "app-settings", "teamwright.json")) || read(path.join(BRAIN, "app-settings", "hivemind.json")) || "{}"); } catch {}
  const under = (root) => { const r = path.resolve(root).toLowerCase(); return cwd.toLowerCase() === r || cwd.toLowerCase().startsWith(r + path.sep); };
  if ((cfg.projectFolders || []).some(under) || (cfg.projectRoots || []).some(under)) return true;
  try { return fs.readdirSync(cwd).some((n) => /\.(blend|rbxlx?|rbxmx?)$/i.test(n) || n === "default.project.json"); } catch { return false; }
}
function startParts() {
  const parts = [corePart()];
  const know = list(path.join(BRAIN, "knowledge"), /\.md$/i).map((f) => `## Knowledge: ${path.basename(f, ".md")} (${f})\n${read(f).trim()}`).join("\n\n");
  const kc = know ? chunks(know, PART - 80) : [];
  kc.forEach((c, i) => parts.push(`# Knowledge notes (part ${i + 1} of ${kc.length})\n${c}`));
  if (blenderSession()) {
    const lc = chunks(read(path.join(BRAIN, "blender", "LESSONS.md")).trim(), PART - 80);
    lc.forEach((c, i) => parts.push(`# Blender lessons (part ${i + 1} of ${lc.length}, ${path.join(BRAIN, "blender", "LESSONS.md")})\n${c}`));
  }
  return parts;
}

/* ---------- per message ---------- */
const STOP = new Set("the a an and or but if then of to in on at for with from by is are was were be been it its this that these those you your yours i me my we our they them their he she his her can could would should will shall do does did done have has had not no yes please make made just also so as into about over under more most less very really some any all one two how what when where which who why let lets get got want need like use using used new now here there than too out up down off only own same such each other via per".split(" "));
const words = (t) => (String(t).toLowerCase().match(/[a-z0-9][a-z0-9_.+-]{2,}/g) || []).map((w) => w.replace(/[.+-]+$/, "")).filter((w) => w.length > 2 && !STOP.has(w));
function entries() {
  const es = [];
  // Memory files: one entry each (name + description + body).
  for (const f of list(path.join(BRAIN, "memory"), /\.md$/i)) {
    if (/MEMORY\.md$/i.test(f)) continue;
    const t = read(f), body = t.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
    const name = (/^name:\s*(.+)$/m.exec(t) || [])[1] || path.basename(f, ".md"), desc = (/^description:\s*(.+)$/m.exec(t) || [])[1] || "";
    es.push({ id: "mem:" + path.basename(f), src: `memory\\${path.basename(f)}`, title: name, text: `${desc}\n${body}` });
  }
  // Bullet notes: each top-level bullet of LESSONS.md and knowledge files, with its heading.
  const bullets = (f, label) => {
    let head = "", cur = null, n = 0;
    const flush = () => { if (cur) es.push(cur); cur = null; };
    for (const line of read(f).split("\n")) {
      if (/^#{1,4}\s/.test(line)) { flush(); head = line.replace(/^#+\s*/, ""); continue; }
      if (/^- /.test(line)) { flush(); cur = { id: `${label}:${++n}`, src: path.relative(BRAIN, f), title: head, text: line.slice(2) }; continue; }
      if (cur && /^\s+\S/.test(line)) cur.text += "\n" + line.trim();
    }
    flush();
  };
  bullets(path.join(BRAIN, "blender", "LESSONS.md"), "lesson");
  for (const f of list(path.join(BRAIN, "knowledge"), /\.md$/i)) bullets(f, "know:" + path.basename(f));
  // Project notes: each "## " section.
  for (const f of list(path.join(BRAIN, "projects"), /\.md$/i)) {
    let head = null, buf = [], n = 0;
    const flush = () => { if (head && buf.join("").trim()) es.push({ id: `proj:${path.basename(f)}:${++n}`, src: path.relative(BRAIN, f), title: head, text: buf.join("\n").trim() }); };
    for (const line of read(f).split("\n")) { if (/^##\s/.test(line)) { flush(); head = line.replace(/^#+\s*/, ""); buf = []; } else if (head) buf.push(line); }
    flush();
  }
  return es;
}
function promptRecall() {
  const prompt = String(payload.prompt || "");
  const q = [...new Set(words(prompt))];
  if (q.length < 2 || prompt.trim().length < 12) return "";
  const es = entries();
  // BM25-style score over each entry's title + text.
  const docs = es.map((e) => { const w = words(e.title + " " + e.text); const tf = new Map(); for (const x of w) tf.set(x, (tf.get(x) || 0) + 1); return { e, tf, len: w.length }; });
  const N = docs.length, avg = docs.reduce((s, d) => s + d.len, 0) / Math.max(1, N), df = new Map();
  for (const d of docs) for (const t of q) if (d.tf.has(t)) df.set(t, (df.get(t) || 0) + 1);
  const idf = (t) => Math.log(1 + (N - (df.get(t) || 0) + 0.5) / ((df.get(t) || 0) + 0.5));
  const scored = docs.map((d) => {
    let s = 0, hits = 0;
    for (const t of q) { const f = d.tf.get(t); if (!f) continue; hits++; s += idf(t) * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * d.len / avg)); }
    return { e: d.e, s, hits };
  }).filter((x) => x.hits >= 2 && x.s >= 4).sort((a, b) => b.s - a.s);
  if (!scored.length) return "";
  // Entries already given in this chat aren't repeated (the whole LESSONS.md counts as given in a Blender session).
  const sid = String(payload.session_id || "").replace(/[^\w-]/g, "") || "nosession";
  const seenFile = path.join(SEEN_DIR, sid + ".json");
  let seen = [];
  try { seen = JSON.parse(read(seenFile)) || []; } catch {}
  const startedWithLessons = seen.includes("start:lessons");
  const pick = [];
  let size = 0;
  for (const x of scored) {
    if (pick.length >= PROMPT_ITEMS) break;
    if (seen.includes(x.e.id) || (startedWithLessons && x.e.id.startsWith("lesson:"))) continue;
    const block = `- (${x.e.src}${x.e.title ? " · " + x.e.title : ""}) ${cap(x.e.text.trim(), 900).replace(/\n/g, "\n  ")}`;
    if (size + block.length > PROMPT_MAX - 200) continue;
    pick.push({ id: x.e.id, block }); size += block.length;
  }
  if (!pick.length) return "";
  try {
    fs.mkdirSync(SEEN_DIR, { recursive: true });
    fs.writeFileSync(seenFile, JSON.stringify([...seen, ...pick.map((p) => p.id)]));
    // Old chat files are cleaned up after two days.
    for (const f of fs.readdirSync(SEEN_DIR)) { const p = path.join(SEEN_DIR, f); try { if (Date.now() - fs.statSync(p).mtimeMs > 2 * 86400e3) fs.rmSync(p, { force: true }); } catch {} }
  } catch {}
  return `# Memory that matches this message (from ${BRAIN}; open the file for more)\n${pick.map((p) => p.block).join("\n")}`;
}

try {
  const [mode, n] = process.argv.slice(2);
  if (mode === "start") {
    const parts = startParts(), i = Math.max(1, Number(n) || 1);
    let text = parts[i - 1] || "";
    if (i === MAX_PARTS && parts.length > MAX_PARTS) text = cap(text, PART - 200) + `\n(${parts.length - MAX_PARTS} more recall parts didn't fit; read the files listed above.)`;
    if (i === 1 && blenderSession()) {
      try { const sid = String(payload.session_id || "").replace(/[^\w-]/g, ""); if (sid) { fs.mkdirSync(SEEN_DIR, { recursive: true }); fs.writeFileSync(path.join(SEEN_DIR, sid + ".json"), JSON.stringify(["start:lessons"])); } } catch {}
    }
    out("SessionStart", text);
  } else if (mode === "prompt") {
    out("UserPromptSubmit", promptRecall());
  }
} catch { /* never break a session */ }
process.exit(0);
