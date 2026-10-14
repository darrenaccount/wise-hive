// "While you were away": a card on Home listing what happened while the user was gone for an hour or more.
// The page posts a heartbeat while the window is visible and focused; a gap of AWAY or more since the last one starts an
// away period, reported from its start until Dismiss (which hides it until the next away period with something in it).
// Lessons and saved ideas are counted by comparing line counts with a snapshot taken at the last heartbeat before leaving.
// State: digest\state.json. Costs of Training/Working rounds are copied from finished runs before the server forgets them.
const fs = require("fs");
const { writeFileAtomic } = require("./lib/fsx");
const path = require("path");

const AWAY = 60 * 60e3, COST_KEEP = 14 * 864e5, LIST = 5;
const ms = (v) => { const n = typeof v === "number" ? v : Date.parse(v); return Number.isFinite(n) ? n : null; };
const flat = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const money = (n) => (n >= 10 ? "$" + n.toFixed(0) : "$" + n.toFixed(2));
const plural = (n, w, ws) => `${n} ${n === 1 ? w : ws || w + "s"}`;

module.exports = (ctx) => {
  const BRAIN = ctx.BRAIN, DIR = ctx.digestDir || path.join(BRAIN, "digest"), FILE = path.join(DIR, "state.json");
  const LABEL = { training: "Training", working: "Working" };
  let S = load();

  function load() {
    let o = null;
    try { o = JSON.parse(ctx.read(FILE) || "null"); } catch {}
    o = o && typeof o === "object" ? o : {};
    const plain = (x) => (x && typeof x === "object" && !Array.isArray(x) ? x : {});
    return { lastSeen: ms(o.lastSeen), since: ms(o.since), back: ms(o.back), counts: plain(o.counts), base: o.base ? plain(o.base) : null, top: o.top ? plain(o.top) : null, costs: plain(o.costs) };
  }
  function save() {
    try {
      fs.mkdirSync(DIR, { recursive: true });
      const data = JSON.stringify(S, null, 1);
      writeFileAtomic(FILE, data);
    } catch (e) { console.error(new Date().toISOString(), "digest save:", e && e.message || e); }
  }

  /* ---------- snapshots ---------- */
  // Lesson files (every "- " bullet counts as one lesson, as in server.js stats) and the idea backlog (one line per idea).
  function lessonFiles() {
    const out = { "blender/LESSONS.md": path.join(BRAIN, "blender", "LESSONS.md") };
    try { for (const f of fs.readdirSync(path.join(BRAIN, "knowledge"))) if (f.endsWith(".md")) out["knowledge/" + f] = path.join(BRAIN, "knowledge", f); } catch {}
    return out;
  }
  const bullets = (t) => (String(t || "").match(/^- /gm) || []).length;
  function snapshot() {
    const c = {};
    for (const [k, f] of Object.entries(lessonFiles())) { const t = ctx.read(f); if (t != null) c[k] = bullets(t); }
    c["ideas/backlog.md"] = bullets(ctx.read(path.join(BRAIN, "ideas", "backlog.md")));
    return c;
  }
  // Finished Training/Working runs keep their cost only in memory for 30 minutes, so copy it here.
  function recordCosts() {
    let changed = false;
    for (const r of ctx.live.values()) {
      if (!r.done || typeof r.cost !== "number" || !["training", "working"].includes(r.kind)) continue;
      const k = r.chatId || r.id;
      if (S.costs[k] && S.costs[k].cost === r.cost) continue;
      S.costs[k] = { cost: r.cost, kind: r.kind, ended: r.ended || Date.now() };
      changed = true;
    }
    for (const [k, v] of Object.entries(S.costs)) if (!v || !(ms(v.ended) > Date.now() - COST_KEEP)) { delete S.costs[k]; changed = true; }
    return changed;
  }

  /* ---------- what happened ---------- */
  const readJson = (f) => { try { return JSON.parse(ctx.read(f) || "null"); } catch { return null; } };
  function sessionFor(id8) {
    if (!/^[\w-]{6,80}$/.test(id8 || "")) return null;
    try { const f = ctx.listTranscripts().find((x) => path.basename(x, ".jsonl").startsWith(id8)); return f ? ctx.sessionMeta(f) : null; } catch { return null; }
  }
  function collect(from, to) {
    const sections = [], errors = [];
    const inWin = (at) => { const t = ms(at); return t != null && t >= from && t <= to; };
    // Training and Working rounds, from their logs.
    for (const mode of ["training", "working"]) {
      const st = readJson(path.join(BRAIN, "autopilot", mode + ".json"));
      const log = st && Array.isArray(st.log) ? st.log.filter((e) => e && inWin(e.at)) : [];
      const done = log.filter((e) => e.type === "result"), failed = log.filter((e) => e.type === "error");
      for (const e of failed) errors.push({ text: `${LABEL[mode]}: ${flat(e.text, 160)}`, view: mode, at: e.at });
      if (!done.length) continue;
      const cost = done.reduce((n, e) => n + ((e.chatId && S.costs[e.chatId] && S.costs[e.chatId].cost) || 0), 0);
      const priced = done.filter((e) => e.chatId && S.costs[e.chatId]).length;
      const proj = mode === "working" && st.project && st.project.name ? ` on ${st.project.name}` : "";
      const est = cost ? ` · about ${money(cost)} at API prices${priced < done.length ? ` (${priced} of ${done.length} priced)` : ""}` : "";
      sections.push({ key: mode, title: `${LABEL[mode]}: ${plural(done.length, "round")} done${proj}${est}`, view: mode,
        lines: done.slice(-LIST).reverse().map((e) => ({ text: `Round ${e.n != null ? e.n : "?"}: ${flat(e.title || e.text, 120)}`, chat: e.chatId || null, view: mode, at: e.at })), more: Math.max(0, done.length - LIST) });
    }
    // Training records written.
    try {
      const dir = path.join(BRAIN, "training", "records");
      const recs = fs.readdirSync(dir).filter((f) => f.endsWith(".md") && inWin(fs.statSync(path.join(dir, f)).mtimeMs));
      if (recs.length) sections.push({ key: "records", title: `${plural(recs.length, "training record")} written`, view: "training", lines: recs.slice(-LIST).map((f) => ({ text: f.replace(/\.md$/, ""), view: "training" })), more: Math.max(0, recs.length - LIST) });
    } catch {}
    // Models Training captured for the Taste library that still wait for the user's review (taste.js).
    try { const s = ctx.taste && ctx.taste.digest(inWin); if (s) sections.push(s); } catch {}
    // Lessons and ideas: line counts on return (S.top) vs. the snapshot from just before the user left.
    if (S.base) {
      const now = S.top || snapshot(), lessons = [];
      let total = 0;
      for (const [k, n] of Object.entries(now)) {
        const added = n - (S.base[k] || 0);
        if (added <= 0 || k === "ideas/backlog.md") continue;
        total += added;
        lessons.push({ text: `${plural(added, "new lesson")} in ${k}`, view: "library" });
      }
      if (lessons.length) sections.push({ key: "lessons", title: `${plural(total, "lesson")} written`, view: "library", lines: lessons.slice(0, LIST), more: Math.max(0, lessons.length - LIST) });
      const ideasAdded = now["ideas/backlog.md"] - (S.base["ideas/backlog.md"] || 0);
      if (ideasAdded > 0) {
        const all = (ctx.read(path.join(BRAIN, "ideas", "backlog.md")) || "").split(/\r?\n/).filter((l) => /^- /.test(l)), upto = Math.min(all.length, now["ideas/backlog.md"]);
        const lines = all.slice(0, upto).slice(-ideasAdded); // the ones added while away, not after
        sections.push({ key: "ideas", title: `${plural(ideasAdded, "idea")} saved to the backlog`, view: "chats", lines: lines.slice(-LIST).reverse().map((l) => {
          const t = (/\*\*(.+?)\*\*/.exec(l) || [])[1] || flat(l.slice(2), 100), m = sessionFor((/\(from chat ([\w-]{6,80})\)\s*$/.exec(l) || [])[1]);
          return { text: flat(t, 120), chat: m ? m.id : null, view: "chats" };
        }), more: Math.max(0, ideasAdded - LIST) });
      }
    }
    // Clarifier questions raised while away and still open.
    try {
      const dir = path.join(BRAIN, "clarifier"), open = [];
      for (const f of fs.readdirSync(dir)) {
        if (!/^[\w-]{6,80}\.json$/.test(f) || /^pending-/.test(f)) continue;
        const qs = (readJson(path.join(dir, f)) || {}).questions;
        const mine = (Array.isArray(qs) ? qs : []).filter((q) => q && q.status === "open" && inWin(q.at));
        if (mine.length) { const id = f.replace(/\.json$/, ""), m = sessionFor(id); open.push({ text: `${plural(mine.length, "question")} in "${flat(m ? m.title : id, 80)}": ${flat(mine[0].question, 100)}`, chat: id, view: "chats", n: mine.length }); }
      }
      const n = open.reduce((a, o) => a + o.n, 0);
      if (n) sections.push({ key: "clarifier", title: `${plural(n, "open question")} from the Clarifier`, view: "chats", lines: open.slice(0, LIST).map(({ n: _, ...l }) => l), more: Math.max(0, open.length - LIST) });
    } catch {}
    // Approvals and questions waiting right now (live on purpose, not limited to the away period).
    const waiting = [];
    for (const r of ctx.live.values()) {
      if (r.done || !r.pending || !r.pending.size) continue;
      for (const [, p] of r.pending) waiting.push({ text: `${p.kind === "ask" ? "Question" : "Approval for " + p.tool} in "${flat(r.title, 70)}"`, chat: r.chatId || null, view: "activity" });
    }
    if (waiting.length) sections.push({ key: "waiting", title: `Claude is waiting for you (${waiting.length})`, view: "activity", lines: waiting.slice(0, LIST), more: Math.max(0, waiting.length - LIST), urgent: true });
    // Updates applied (or rolled back), and their errors.
    const up = readJson(path.join(BRAIN, "updates", "state.json"));
    const hist = up && Array.isArray(up.history) ? up.history.filter((h) => h && inWin(h.at)) : [];
    const applied = hist.filter((h) => ["adapt", "restart", "rollback"].includes(h.type));
    if (applied.length) sections.push({ key: "updates", title: `${plural(applied.length, "update step")} by the Messenger`, view: "updates", lines: applied.slice(-LIST).reverse().map((h) => ({ text: flat(h.text, 140), view: "updates" })), more: Math.max(0, applied.length - LIST) });
    for (const h of hist.filter((x) => x.type === "error")) errors.push({ text: `Updates: ${flat(h.text, 160)}`, view: "updates", at: h.at });
    // Crashes the server caught (server.log lines start with an ISO time).
    const logText = ctx.read(path.join(ctx.APP_DIR || path.join(BRAIN, "app"), "server.log")) || "";
    for (const l of logText.slice(-200000).split(/\r?\n/)) {
      const m = /^(\d{4}-\d\d-\d\dT[\d:.]+Z) (uncaught|unhandled rejection|module failed to load)(.*)$/.exec(l);
      if (m && inWin(m[1])) errors.push({ text: `The Wise Hive: ${m[2]}${flat(m[3], 140)}`, view: "settings", at: m[1] });
    }
    if (errors.length) sections.push({ key: "errors", title: plural(errors.length, "error"), view: errors[0].view, lines: errors.slice(-LIST).reverse(), more: Math.max(0, errors.length - LIST), bad: true });
    return sections;
  }

  // GET only reads: costs are copied in memory here and saved by seen() and the timer, never by a GET.
  // The card covers the away period itself (since..back), so it stops growing once the user is back.
  function view() {
    recordCosts();
    if (!S.since) return { show: false, lastSeen: S.lastSeen };
    const sections = collect(S.since, S.back || Date.now());
    return { show: sections.length > 0, since: S.since, back: S.back, sections };
  }
  function seen() {
    const now = Date.now(), counts = snapshot();
    if (S.lastSeen && now - S.lastSeen >= AWAY) Object.assign(S, { since: S.lastSeen, back: now, base: S.counts && Object.keys(S.counts).length ? S.counts : null, top: counts });
    S.lastSeen = now;
    S.counts = counts;
    recordCosts();
    save();
    return view();
  }

  return {
    async route(p, req, res) {
      if (p === "/api/digest" && req.method === "GET") { ctx.json(res, 200, view()); return true; }
      if (p === "/api/digest/seen" && req.method === "POST") { await ctx.body(req); ctx.json(res, 200, seen()); return true; }
      if (p === "/api/digest/dismiss" && req.method === "POST") { await ctx.body(req); Object.assign(S, { since: null, back: null, base: null, top: null }); save(); ctx.json(res, 200, { show: false }); return true; }
      return false;
    },
    start() { const t = setInterval(() => { if (recordCosts()) save(); }, 2 * 60e3); if (t.unref) t.unref(); },
  };
};
