// Live activity panel, server side (the page side is public/jobs-client.js).
// Tracks the jobs The Wise Hive itself starts that can run long: every startChat run (chats, Training/Working rounds,
// Updates runs, brainstorms, the sketch reader, Link tasks), the Training/Working planner, the council (members and
// judge as child rows), the Librarian, Organizer and Prompt librarian, and the subagents a run starts with the Agent
// tool (child rows). Short helpers (Clarifier, Refiner, Inventor, Link relay) are left out on purpose.
// It only reads the stream-json lines those claude processes already print: no tokens, no extra Claude runs, and it
// never reads Claude Code transcripts. It never touches `live` or /api/runs, so restart-when-idle sees what it saw before.
// server.js calls in through trk() (which never throws); this module pushes {t:"jobs"} events on /api/events.
//   GET /api/jobs -> { live, history, loops, stall, outPushMs, debug }  (debug: leak counts, only with HIVE_ACTIVITY_DEBUG=1)
// "While you were away" (the last 20 finished top-level jobs) and the running list are kept in
// <brain>\app-settings\activity-history.json (HIVE_ACTIVITY_FILE overrides), so they survive a restart; jobs a restart
// cut off come back as "Cut off by a Wise Hive restart", ending at their last saved output. Test instances (HIVE_PORT
// set without TEAMWRIGHT_BRAIN or HIVE_ACTIVITY_FILE) read the file but never write it.
// Verified 2026-10-13 against Claude Code 2.1.296 stream-json (test/jobs-test.js).
"use strict";
const fs = require("fs");
const { writeFileAtomic } = require("./lib/fsx");
const path = require("path");
const crypto = require("crypto");
// A result the CLI called fine can still be a failure ("Not logged in", a plain usage-limit answer): the same rule
// autopilot.js and server.js simplify() use, so the panel agrees with them.
const { softFail } = require("./limits.js");

// SAVE_OUT_MS: while output flows, the running list (with each job's last output time) is saved at most this often.
// LONG_CHAT_MS: an ordinary chat reply shorter than this isn't worth a "while you were away" slot (see keep()).
const KEEP = 20, KIDS_KEEP = 12, OUT_PUSH_MS = 5000, SAVE_OUT_MS = 60000, LONG_CHAT_MS = 120e3;
// Seconds without output before a row turns amber / red: the user's 3 and 10 minutes, for every row. The design gave
// subagents (and runs waiting on one) 10 and 20, because the CLI prints a subagent's tool steps but not its thinking or
// writing; that overrode the user's own numbers, so it was dropped. A quiet subagent row shows its current step, and
// its parent says "waiting on N agents", so an amber row can be read at a glance.
const STALL = { warn: 180, bad: 600 };
const FINAL = /^(completed|failed|error|killed|stopped|cancel)/i;
// Why a job was stopped (stopChat/stopRun's reason). user, skip and cap get the grey "stopped" look: the user did it, or
// their own usage cap did. timeout (a watchdog) and app (any caller that gave no reason) are red failures.
const CAUSES = new Set(["user", "skip", "cap", "timeout"]), GREY = new Set(["user", "skip", "cap"]);
const CAUSE_TEXT = { user: "Stopped by you", skip: "Skipped by you", cap: "Stopped at the usage cap", app: "Stopped by The Wise Hive" };
const dur = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h ${String(Math.floor(s % 3600 / 60)).padStart(2, "0")}m`; };

// One readable line out of a result: markdown markers stripped, the first line with 3+ words (else the first line), <= 140 chars.
function oneLine(t) {
  const lines = String(t == null ? "" : t).split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:#{1,6}\s+|[-*+>]\s+|\d+[.)]\s+)+/, "").replace(/[*`|]/g, "").replace(/\s+/g, " ").trim()).filter(Boolean);
  const pick = lines.find((l) => l.split(" ").length >= 3) || lines[0] || "";
  return pick.length > 140 ? pick.slice(0, 139) + "…" : pick;
}
const cut = (s, n) => { s = String(s == null ? "" : s).replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const textOf = (c) => (typeof c === "string" ? c : Array.isArray(c) ? c.filter((x) => x && x.type === "text").map((x) => String(x.text || "")).join("\n") : "");
// A subagent's report from its tool_result: the clean copy in tool_use_result when there is exactly one result in the
// event, otherwise the tool_result text without the CLI's hand-back frame and its agentId/<usage> tail.
function reportText(ev, b, nResults) {
  const tur = ev.tool_use_result;
  if (nResults === 1 && tur && Array.isArray(tur.content)) { const t = textOf(tur.content); if (t.trim()) return t; }
  let lines = textOf(b.content).split(/\r?\n/);
  const i = lines.findIndex((l) => /The report follows:/.test(l));
  if (i >= 0) lines = lines.slice(i + 1);
  const end = lines.findIndex((l) => /^(agentId:|<usage>)/.test(l));
  if (end >= 0) lines = lines.slice(0, end);
  return lines.map((l) => l.replace(/^ {2}/, "")).join("\n");
}

const plain = (x) => !!x && typeof x === "object" && !Array.isArray(x);
const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);

// Tokens Claude processed for a job, as parts: i new input, w cache writes, r cache reads, o output. Reads both the
// per-message usage (snake_case) and the result's modelUsage (camelCase). The panel shows the total; the tooltip the parts.
const partsOf = (u) => (plain(u) ? { i: num(u.input_tokens) + num(u.inputTokens), w: num(u.cache_creation_input_tokens) + num(u.cacheCreationInputTokens),
  r: num(u.cache_read_input_tokens) + num(u.cacheReadInputTokens), o: num(u.output_tokens) + num(u.outputTokens) } : { i: 0, w: 0, r: 0, o: 0 });
const addParts = (a, b, k = 1) => { a.i += k * b.i; a.w += k * b.w; a.r += k * b.r; a.o += k * b.o; return a; };
const sumParts = (p) => (plain(p) ? num(p.i) + num(p.w) + num(p.r) + num(p.o) : 0);
const cleanParts = (p) => (plain(p) ? { i: num(p.i), w: num(p.w), r: num(p.r), o: num(p.o) } : null);

// A short title for the panel; the full one stays in `full` for the tooltip. Free (no Claude run): drops the app's
// tags and prefixes ("[Wise Hive training] Round 12:", "Council:", "You are the LIBRARIAN of ..."), filler at the start
// ("can you", "please", "I want you to"), keeps the part before a short "Title:" or the first clause, and caps it at
// about 34 characters on a word boundary.
function shortName(raw) {
  const orig = String(raw == null ? "" : raw).replace(/\s+/g, " ").trim();
  let t = orig;
  const tags = () => { t = t.replace(/^(?:\[[^\]]{0,60}\]\s*)+/, ""); };
  tags();
  const role = /^You are (?:the |a |an )?([A-Za-z][A-Za-z ]{1,30}?)(?: of| on| in| for|[.,:])/.exec(t);
  if (role) t = role[1].toLowerCase();
  t = t.replace(/^(?:Council|Chat|Task|Brainstorm|Training|Working|Trainer|Foreman|Messenger|Update)\s*#?\d*\s*[:·\-]\s*/i, "");
  t = t.replace(/^Round\s+\d+\s*[:·\-]\s*/i, "");
  tags();
  for (let k = 0; k < 4; k++) t = t.replace(/^(?:hey|hi|ok(?:ay)?|so|yo|bro|claude|please|pls|can you|could you|would you|will you|i want you to|i need you to|i want to|i want|i need|help me(?: to)?|go ahead and|let'?s|now|just|also|and)\b[\s,]*/i, "");
  t = t.replace(/^(?:a|an|the)\s+/i, "");
  const colon = t.search(/:\s/); // "Title: rest" (not the colon in a URL or a time)
  if (colon >= 3 && colon <= 30) t = t.slice(0, colon);
  else t = t.split(/(?<=\w)[.;!?](?:\s|$)|\s[—–-]\s|\s\(/)[0];
  t = t.replace(/[\s,.;:!?\-]+$/, "");
  if (t.length > 34) {
    t = t.slice(0, 34); const sp = t.lastIndexOf(" "); if (sp > 15) t = t.slice(0, sp);
    // Don't end on a dangling little word ("...and", "...money i").
    for (let k = 0; k < 3; k++) t = t.replace(/\s+(?:and|or|but|i|a|an|the|to|of|for|with|in|on|at|my|your|me|from|by|is|are)$/i, "");
    t = t.replace(/[\s,.;:\-]+$/, "") + "…";
  }
  if (!t) t = orig.length > 34 ? orig.slice(0, 33) + "…" : orig;
  return t ? t[0].toUpperCase() + t.slice(1) : "";
}
// A history item from the file, coerced to the shape the page expects (a hand-edited or broken entry can't break the panel).
function cleanItem(x) {
  const started = num(x.started);
  if (!started) return null;
  // Items saved before short names existed have no `full`: their name is the full one, shortened now.
  const full = cut(x.full, 200) || cut(x.name, 200);
  return { id: cut(x.id, 120) || "x-" + started, kind: cut(x.kind, 30) || "chat", name: cut(x.full ? x.name : shortName(x.name), 90) || "Job", full, tok: num(x.tok), tk: cleanParts(x.tk), icon: x.icon ? cut(x.icon, 30) : null, from: x.from === "desktop" ? "desktop" : "app",
    status: x.status === "done" ? "done" : "failed", stopped: !!x.stopped, cause: CAUSES.has(x.cause) || x.cause === "app" ? x.cause : null,
    started, ended: num(x.ended) || started, approx: !!x.approx, result: cut(x.result, 140), chatId: x.chatId ? cut(x.chatId, 80) : null,
    agents: (Array.isArray(x.agents) ? x.agents : []).filter(plain).slice(-KIDS_KEEP).map((a) => ({ name: cut(a.name, 90) || "Agent", sub: cut(a.sub, 40), tok: num(a.tok),
      status: a.status === "done" ? "done" : "failed", stopped: !!a.stopped, started: num(a.started), ended: num(a.ended) || null, result: cut(a.result, 140) })),
    more: Math.floor(num(x.more)) };
}
// Which finished top-level jobs go into "while you were away". Each chat reply is its own run, so short ordinary chats
// would push the Training rounds out of the 20; planner runs only matter when they failed on their own (a hang or timeout).
function keep(j) {
  if (j.kind === "plan") return j.status === "failed" && !j.stopped;
  if (j.kind === "chat" || j.kind === "brainstorm" || j.kind === "sketch") return j.ended - j.started >= LONG_CHAT_MS || (j.status === "failed" && !j.stopped) || j.kids.length > 0 || j.from === "desktop";
  return true;
}

module.exports = (ctx) => {
  const o = ctx.jobsOpts || {}; // tests: { now, file, persist }
  const now = o.now || Date.now;
  const FILE = o.file || process.env.HIVE_ACTIVITY_FILE || path.join(ctx.BRAIN, "app-settings", "activity-history.json");
  const PERSIST = o.persist !== undefined ? !!o.persist : !!process.env.HIVE_ACTIVITY_FILE || !!process.env.TEAMWRIGHT_BRAIN || !process.env.HIVE_PORT;
  // Test-only routes (POST /api/jobs/debug/fake|out|end) make fake jobs for the stall and leak checks. They exist only
  // when HIVE_ACTIVITY_DEBUG=1; start.ps1 and the desktop app never set it.
  const DEBUG = process.env.HIVE_ACTIVITY_DEBUG === "1";
  const timers = new Set(); // debug endAfterSec timers only; each is cleared when its job ends
  let lastSave = 0;
  if (!ctx.track) ctx.track = {};
  // active: running top-level jobs and all their children (finished children stay until their top-level job ends).
  // tools/tasks/inner: "<run id>|<tool_use_id or task_id>" -> child id; every key is listed in its run's `keys` and
  // deleted when that run ends, so nothing outlives a job.
  const active = new Map(), tools = new Map(), tasks = new Map(), inner = new Map();
  const history = []; // finished top-level jobs, newest first
  const push = (x) => { try { ctx.broadcast({ t: "jobs", ...x }); } catch {} };
  // A job's tokens: fixed when it ended; else the result's total (it includes subagents); else its own messages plus its
  // children's (subagents, council members).
  const tokParts = (j) => {
    if (j.tokFixed) return j.tokFixed;
    if (j.final) return j.final;
    const p = addParts({ i: 0, w: 0, r: 0, o: 0 }, j.tk);
    for (const k of j.kids) { const c = active.get(k); if (c) addParts(p, tokParts(c)); }
    return p;
  };
  const pub = (j) => ({ id: j.id, parent: j.parent, kind: j.kind, name: j.name, full: j.full, tok: sumParts(tokParts(j)), tk: tokParts(j), icon: j.icon, from: j.from, sub: j.sub, depth: j.depth, via: j.via, bg: j.bg,
    status: j.status, stopped: j.stopped, cause: j.cause, started: j.started, ended: j.ended, lastOut: j.lastOut, tool: j.tool, step: j.step,
    waiting: j.waiting, chatId: j.chatId, result: j.result });
  const running = (id) => { const j = id == null ? null : active.get(String(id)); return j && j.status === "running" ? j : null; };
  const family = (j) => { const out = []; const walk = (x) => { for (const k of x.kids) { const c = active.get(k); if (c) { out.push(c); walk(c); } } }; walk(j); return out; };
  const dropKeys = (j) => {
    for (const k of j.keys.tools) tools.delete(k); for (const k of j.keys.tasks) tasks.delete(k); for (const k of j.keys.inner) inner.delete(k);
    j.keys = { tools: [], tasks: [], inner: [] };
    if (j.timer) { clearTimeout(j.timer); timers.delete(j.timer); j.timer = null; }
  };
  const counts = () => ({ active: active.size, tools: tools.size, tasks: tasks.size, inner: inner.size, timers: timers.size });

  // History plus the running top-level jobs (with their last output time, for restart recovery). Write then rename, so
  // a crash mid-write can't leave half a file; fall back to a plain write if Windows holds the file open.
  function save() {
    if (!PERSIST) return;
    lastSave = now();
    const run = [...active.values()].filter((j) => !j.parent && j.status === "running")
      .map((j) => ({ id: j.id, kind: j.kind, name: j.name, icon: j.icon, from: j.from, started: j.started, lastOut: j.lastOut, chatId: j.chatId }));
    const data = JSON.stringify({ v: 1, saved: new Date(lastSave).toISOString(), history, running: run });
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      writeFileAtomic(FILE, data);
    } catch (e) { console.error(new Date().toISOString(), "jobs: couldn't save the activity history:", e && e.message || e); }
  }
  // Jobs still running when the app stopped become "Cut off by a Wise Hive restart", ending at their last saved output
  // (approx: the exact end isn't known). Planner leftovers are dropped.
  function load() {
    let d = null;
    try { d = JSON.parse(fs.readFileSync(FILE, "utf8")); }
    catch (e) { if (e.code !== "ENOENT") console.error(new Date().toISOString(), "jobs: the activity history file is unreadable, starting empty:", e && e.message || e); }
    if (!plain(d)) d = {};
    const left = Array.isArray(d.running) ? d.running.filter(plain) : [];
    const cutOff = left.filter((e) => e.kind !== "plan")
      .map((e) => cleanItem({ ...e, status: "failed", stopped: false, cause: null, ended: num(e.lastOut) || num(e.started), approx: true, result: "Cut off by a Wise Hive restart", agents: [], more: 0 }));
    const items = (Array.isArray(d.history) ? d.history : []).filter(plain).map(cleanItem);
    history.push(...[...cutOff, ...items].filter(Boolean).sort((a, b) => b.ended - a.ended).slice(0, KEEP));
    if (left.length) save(); // the running list is history now
  }

  // begin({id, parent, kind, name, icon, from, started, ...}) -> id. A parent that isn't running is dropped (top-level row).
  function begin(b = {}) {
    const id = b.id ? String(b.id) : "c-" + crypto.randomUUID().slice(0, 8);
    if (active.has(id)) return id;
    const parent = running(b.parent) ? String(b.parent) : null;
    const t = Number.isFinite(b.started) ? b.started : now();
    const full = cut(b.name, 200);
    const j = { id, parent, kind: String(b.kind || "chat"), name: cut(shortName(full), 90) || "Job", full, tk: { i: 0, w: 0, r: 0, o: 0 }, msgId: null, msgParts: null, final: null, tokFixed: null, icon: b.icon ? String(b.icon) : null, from: b.from === "desktop" ? "desktop" : "app",
      sub: b.sub ? String(b.sub) : "", depth: Number(b.depth) > 0 ? Math.floor(b.depth) : parent ? 1 : 0, via: b.via ? String(b.via) : null, bg: !!b.bg,
      status: "running", stopped: false, cause: null, started: t, ended: null, lastOut: Number.isFinite(b.lastOut) ? b.lastOut : t,
      tool: "", step: "", waiting: 0, chatId: b.chatId ? String(b.chatId) : null, result: "",
      res: null, pushedOut: 0, kids: [], keys: { tools: [], tasks: [], inner: [] }, timer: null };
    active.set(id, j);
    if (parent) active.get(parent).kids.push(id);
    push({ op: "up", job: pub(j) });
    if (!parent) save();
    return id;
  }

  // Something was printed for this job. Pushes at most one "out" per job per OUT_PUSH_MS (leading edge, no timers),
  // except at once when the current tool or step changed (force). Output of a child counts for its parent too.
  function out(id, tool, force) {
    const j = running(id);
    if (!j) return;
    const t = now();
    j.lastOut = t;
    if (tool !== undefined && tool !== j.tool) { j.tool = tool; force = true; }
    if (force || t - j.pushedOut >= OUT_PUSH_MS) { j.pushedOut = t; const tp = tokParts(j); push({ op: "out", id: j.id, at: t, tool: j.tool, step: j.step, tok: sumParts(tp), tk: tp }); }
    if (j.via) out(j.via);
    if (j.parent) out(j.parent);
    else if (PERSIST && t - lastSave >= SAVE_OUT_MS) save(); // keeps the saved last-output time at most a minute old
  }

  const childOf = (runId, toolUseId) => (toolUseId ? active.get(tools.get(runId + "|" + toolUseId)) || active.get(inner.get(runId + "|" + toolUseId)) || null : null);
  const taskChild = (runId, ev) => active.get(tasks.get(runId + "|" + ev.task_id)) || active.get(tools.get(runId + "|" + ev.tool_use_id)) || null;

  // A subagent row under run, keyed by its Agent tool_use id. Called from the tool_use block and again from task_started
  // (which fills in what the first call didn't know).
  function beginChild(run, c) {
    if (!c.toolUseId) return null;
    const tk = run.id + "|" + c.toolUseId, name = cut(c.name, 90), sub = c.sub && c.sub !== "general-purpose" ? cut(c.sub, 40) : "";
    let j = active.get(tools.get(tk));
    if (!j) {
      j = active.get(begin({ id: run.id + ":" + c.toolUseId, parent: run.id, kind: "subagent", name: name || "Agent", sub, bg: c.bg, depth: c.depth, via: c.via && c.via.id }));
      if (!j) return null;
      tools.set(tk, j.id); run.keys.tools.push(tk);
    } else {
      let ch = false;
      if (name && j.name === "Agent") { j.name = name; ch = true; }
      if (sub && !j.sub) { j.sub = sub; ch = true; }
      if (c.bg !== undefined && !!c.bg !== j.bg) { j.bg = !!c.bg; ch = true; }
      if (Number(c.depth) > 0 && Math.floor(c.depth) !== j.depth) { j.depth = Math.floor(c.depth); ch = true; }
      if (c.via && !j.via && c.via.id !== j.id) { j.via = c.via.id; ch = true; }
      if (ch) push({ op: "up", job: pub(j) });
    }
    if (c.taskId && !j.taskId) { j.taskId = String(c.taskId); const k = run.id + "|" + j.taskId; tasks.set(k, j.id); run.keys.tasks.push(k); }
    return j;
  }

  // Idempotent: the first signal ends the child; later ones only fill in a missing result (so a later tool_result can't
  // replace the task_notification summary). Nested agents it started that are still running end with it, the way a
  // run's end sweeps its children, so none is left looking busy until the whole run ends.
  function endChild(c, status, text) {
    if (!c) return;
    if (c.status !== "running") {
      const r = text ? oneLine(text) : "";
      if (r && !c.result) { c.result = r; push({ op: "up", job: pub(c) }); }
      return;
    }
    const s = String(status || "");
    c.status = /^(completed|done|success)/i.test(s) ? "done" : "failed";
    if (/^(killed|stopped|cancel)/i.test(s)) c.stopped = true;
    c.ended = now(); c.tool = "";
    c.result = (text && oneLine(text)) || (c.stopped ? "Stopped" : "");
    push({ op: "end", job: pub(c) });
    for (const x of [...active.values()]) if (x.via === c.id && x.status === "running") endChild(x, c.status === "done" ? "completed" : c.stopped ? "stopped" : "failed", "ended with its agent");
  }

  // The only place that interprets stream-json for the panel. runId is a tracked startChat/runClaude run.
  function line(runId, ev) {
    const run = running(runId);
    if (!run || !ev || typeof ev !== "object") return;
    if (ev.type === "tool_progress" && ev.heartbeat) return; // proves a tool is still open, not that work is moving
    const ptu = typeof ev.parent_tool_use_id === "string" && ev.parent_tool_use_id ? ev.parent_tool_use_id : null;
    const owner = ptu ? childOf(run.id, ptu) : null, own = owner && owner.status === "running" ? owner : null;
    const blocks = ev.message && Array.isArray(ev.message.content) ? ev.message.content : [];
    let target = own || run, tool, force = false;
    if (ev.type === "system") {
      const st = ev.subtype;
      if (st === "init") {
        // A subagent's init (it carries parent_tool_use_id) must never replace the run's chat id.
        if (!ptu && ev.session_id && String(ev.session_id) !== run.chatId) { run.chatId = String(ev.session_id); push({ op: "up", job: pub(run) }); if (!run.parent) save(); }
      } else if (st === "task_started") {
        // Only agents become rows. Long shell calls are tasks too (local_bash), and inside a subagent they never get an end event.
        const via = ev.parent_task_id ? active.get(tasks.get(run.id + "|" + ev.parent_task_id)) : null;
        if (ev.task_type === "local_agent" || (!ev.task_type && ev.tool_use_id && tools.has(run.id + "|" + ev.tool_use_id))) {
          beginChild(run, { toolUseId: ev.tool_use_id, taskId: ev.task_id, name: ev.description, sub: ev.subagent_type, bg: ev.is_backgrounded, depth: ev.spawn_depth, via: via && via.id !== run.id + ":" + ev.tool_use_id ? via : null });
        } else if (via && via.status === "running") target = via;
      } else if (st === "task_progress") {
        const c = taskChild(run.id, ev);
        if (c && c.status === "running") {
          const step = cut(ev.description, 80);
          if (step && step !== c.step) { c.step = step; force = true; }
          tool = ev.last_tool_name ? String(ev.last_tool_name) : c.tool;
          target = c;
        }
      } else if (st === "task_updated") {
        const p = ev.patch || {};
        if (typeof p.status === "string" && FINAL.test(p.status)) endChild(taskChild(run.id, ev), p.status);
      } else if (st === "task_notification") {
        const c = taskChild(run.id, ev);
        if (c && plain(ev.usage) && !sumParts(c.tk)) c.tk = partsOf(ev.usage);
        endChild(c, ev.status, ev.summary);
      }
    } else if (ev.type === "assistant") {
      if (!ptu && ev.message && plain(ev.message.usage)) {
        const mid = ev.message.id || null, p = partsOf(ev.message.usage);
        if (mid && mid === run.msgId && run.msgParts) addParts(run.tk, run.msgParts, -1);
        run.msgId = mid; run.msgParts = p; addParts(run.tk, p);
      }
      for (const b of blocks) {
        if (!b || b.type !== "tool_use") continue;
        const inp = b.input || {}, agent = (b.name === "Agent" || b.name === "Task") && b.id;
        if (owner) { // a subagent's own step
          if (b.id) { const k = run.id + "|" + b.id; inner.set(k, owner.id); run.keys.inner.push(k); }
          if (own) tool = String(b.name || "");
          if (agent) beginChild(run, { toolUseId: b.id, name: inp.description || inp.subagent_type, sub: inp.subagent_type, bg: !!inp.run_in_background, depth: (owner.depth || 1) + 1, via: owner });
        } else if (!ptu) {
          tool = String(b.name || "");
          if (agent) beginChild(run, { toolUseId: b.id, name: inp.description || inp.subagent_type, sub: inp.subagent_type, bg: !!inp.run_in_background });
        }
      }
    } else if (ev.type === "user") {
      const results = blocks.filter((b) => b && b.type === "tool_result");
      // A tool_result ends the foreground agent it answers: untagged for the run's own agents, tagged with the outer
      // agent's id for a nested one (tasks a subagent owns get no task_updated or task_notification, Stream fact 3).
      if (results.length && (own || !ptu)) {
        tool = "";
        for (const b of results) {
          const c = active.get(tools.get(run.id + "|" + b.tool_use_id));
          // A background agent's tool_result comes back at once; it ends on its notification (or with its run).
          if (c && results.length === 1 && plain(ev.tool_use_result) && plain(ev.tool_use_result.usage) && !sumParts(c.tk)) c.tk = partsOf(ev.tool_use_result.usage);
          if (c && !c.bg) endChild(c, b.is_error ? "failed" : "completed", reportText(ev, b, results.length));
        }
      }
    } else if (ev.type === "result" && !ptu) {
      const text = typeof ev.result === "string" ? ev.result : "";
      run.res = { text, err: !!ev.is_error || softFail(text) };
      const mu = plain(ev.modelUsage) ? Object.values(ev.modelUsage).filter(plain) : [];
      const fin = mu.length ? mu.reduce((a, m) => addParts(a, partsOf(m)), { i: 0, w: 0, r: 0, o: 0 }) : partsOf(ev.usage);
      if (sumParts(fin)) run.final = fin;
    }
    out(target.id, tool, force);
  }

  function waiting(id, n) {
    const j = running(id);
    if (!j) return;
    n = Math.max(0, Math.floor(Number(n) || 0));
    if (n !== j.waiting) { j.waiting = n; push({ op: "up", job: pub(j) }); }
  }

  // Records why a run is being stopped; its end follows (and decides status and result from this).
  function stopping(id, why) {
    const j = running(id);
    if (!j || j.cause) return;
    j.cause = CAUSES.has(why) ? why : "app";
    j.stopped = GREY.has(j.cause);
  }

  function resultOf(j, e) {
    if (j.cause === "timeout") return `Ran ${dur(j.ended - j.started)}, stopped by The Wise Hive (time limit)`;
    if (j.cause) return CAUSE_TEXT[j.cause];
    const text = e.text != null ? e.text : j.res && j.res.text;
    // The council and its judge: the VERDICT line says it best ("Pursue · 7/10").
    const v = (j.kind === "council" || j.kind === "judge") && /VERDICT:\s*(PURSUE|PIVOT|PASS)\b[^\n]*?SCORE:\s*(\d+)/i.exec(String(text || ""));
    if (v) return `${v[1][0].toUpperCase()}${v[1].slice(1).toLowerCase()} · ${v[2]}/10`;
    if (j.status === "done") return oneLine(text) || "Finished";
    return oneLine(j.res && j.res.err ? j.res.text : e.err) || oneLine(e.text) || `Exited with code ${e.code == null ? "?" : e.code}`;
  }

  // end(id, {code, err, text, ok}): idempotent. A job whose parent is still tracked (council members, the judge) ends like
  // a child and stays listed until the parent ends. A top-level job takes its whole family with it: children still
  // running are swept (nothing is left looking busy), every lookup key is deleted, and it goes into history.
  function end(id, e = {}) {
    const j = running(id);
    if (!j) return;
    const t = now();
    j.ended = t; j.tool = ""; j.waiting = 0;
    j.status = j.cause ? "failed" : e.ok !== undefined ? (e.ok && !softFail(e.text) ? "done" : "failed") : e.code === 0 && j.res && !j.res.err ? "done" : "failed";
    j.result = cut(resultOf(j, e), 140);
    j.tokFixed = tokParts(j);
    const fam = family(j), swept = [];
    for (const c of fam) if (!c.tokFixed) c.tokFixed = tokParts(c);
    for (const c of fam) if (c.status === "running") {
      Object.assign(c, { status: j.status === "done" ? "done" : "failed", stopped: j.stopped, cause: j.cause, ended: t, tool: "", waiting: 0 });
      if (!c.result) c.result = "ended with its run";
      swept.push(c);
    }
    dropKeys(j);
    if (j.parent && active.has(j.parent)) {
      for (const c of swept) push({ op: "up", job: pub(c) });
      push({ op: "end", job: pub(j) });
      return;
    }
    for (const x of [j, ...fam]) { active.delete(x.id); dropKeys(x); }
    let item;
    if (keep(j)) {
      const kids = fam.sort((a, b) => a.started - b.started);
      item = { id: j.id, kind: j.kind, name: j.name, full: j.full, tok: sumParts(j.tokFixed), tk: j.tokFixed, icon: j.icon, from: j.from, status: j.status, stopped: j.stopped, cause: j.cause, started: j.started, ended: j.ended,
        approx: false, result: j.result, chatId: j.chatId, more: Math.max(0, kids.length - KIDS_KEEP),
        agents: kids.slice(-KIDS_KEEP).map((c) => ({ name: c.name, sub: c.sub, tok: sumParts(c.tokFixed || tokParts(c)), status: c.status, stopped: c.stopped, started: c.started, ended: c.ended, result: c.result })) };
      history.unshift(item);
      if (history.length > KEEP) history.length = KEEP;
    }
    save(); // the running list changed either way
    push({ op: "end", job: pub(j), item });
  }

  // Running top-level jobs in start order, each followed by its children.
  function liveList() {
    const out = [];
    for (const j of [...active.values()].filter((x) => !x.parent).sort((a, b) => a.started - b.started)) { out.push(pub(j)); for (const c of family(j)) out.push(pub(c)); }
    return out;
  }

  // Training/Working between rounds (resting, paused for usage, quiet hours, gaming) have no running job, so the panel
  // shows a muted line for them. Read from the loop state files the same way digest.js does; a missing or broken file is "off".
  const AP_DIR = process.env.HIVE_AUTOPILOT_DIR || path.join(ctx.BRAIN, "autopilot");
  function loops() {
    const out = {};
    for (const m of ["training", "working"]) {
      let s = null;
      try { s = JSON.parse(fs.readFileSync(path.join(AP_DIR, m + ".json"), "utf8")); } catch {}
      out[m] = plain(s) ? { active: s.active === true, status: cut(s.status, 20), restingUntil: num(s.restingUntil) || null, pauseText: plain(s.pause) ? cut(s.pause.text, 120) : "" }
        : { active: false, status: "", restingUntil: null, pauseText: "" };
    }
    return out;
  }

  // POST /api/jobs/debug/fake {name?, quietSec=0, children=0, delegating=false, endAfterSec=0, fail=false}: a fake top-level
  // job whose start and last output are quietSec ago, with `children` child rows (the first as quiet, the rest fresh;
  // delegating makes them foreground subagents, so the parent says "waiting on N agents"). It spawns nothing and costs nothing.
  async function debugRoute(what, req, res) {
    const b = await ctx.body(req);
    if (what === "fake") {
      const t = now() - Math.max(0, Number(b.quietSec) || 0) * 1000;
      const id = begin({ kind: "test", name: cut(b.name, 90) || "Test job", started: t, lastOut: t });
      const j = active.get(id), kids = [];
      for (let i = 0; i < Math.min(20, Math.max(0, Math.floor(Number(b.children) || 0))); i++) {
        const ct = i === 0 ? t : now();
        kids.push(begin({ id: `${id}:k${i + 1}`, parent: id, kind: b.delegating ? "subagent" : "test", name: `Test agent ${i + 1}`, started: ct, lastOut: ct }));
      }
      if (b.delegating) { j.tool = "Agent"; push({ op: "up", job: pub(j) }); }
      const after = Number(b.endAfterSec) || 0;
      if (after > 0) {
        const tm = setTimeout(() => { timers.delete(tm); j.timer = null; end(id, { ok: !b.fail, code: b.fail ? 1 : 0, text: "test job ended" }); }, after * 1000);
        if (tm.unref) tm.unref();
        timers.add(tm); j.timer = tm;
      }
      ctx.json(res, 200, { id, kids });
    } else if (what === "out") {
      const ok = !!running(b.id);
      out(String(b.id || ""), undefined, true); // always pushes, so a stall test isn't swallowed by the 5 s limit
      ctx.json(res, 200, { ok });
    } else if (what === "end") {
      const ok = !!running(b.id);
      if (b.why) stopping(String(b.id || ""), String(b.why));
      end(String(b.id || ""), { ok: !b.fail, code: b.fail ? 1 : 0, text: "test job ended" });
      ctx.json(res, 200, { ok });
    } else return false;
    return true;
  }

  load();
  Object.assign(ctx.track, { begin, line, out, waiting, stopping, end });
  return {
    async route(p, req, res) {
      if (p === "/api/jobs" && req.method === "GET") {
        ctx.json(res, 200, { live: liveList(), history, loops: loops(), stall: STALL, outPushMs: OUT_PUSH_MS, debug: DEBUG ? { ...counts(), heap: process.memoryUsage().heapUsed } : false });
        return true;
      }
      if (DEBUG && req.method === "POST" && p.startsWith("/api/jobs/debug/")) return debugRoute(p.slice("/api/jobs/debug/".length), req, res);
      return false;
    },
    _counts: counts,
  };
};
module.exports.oneLine = oneLine;
module.exports.shortName = shortName;
module.exports.partsOf = partsOf;
module.exports.reportText = reportText;
module.exports.STALL = STALL;
module.exports.dur = dur;
