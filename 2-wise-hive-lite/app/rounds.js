// Round cards for the Working tab ("What it did"): a card per Working round with a title, a plain-English summary, what
// changed, how to undo it, the commits it made and pictures, stored in <brain>\working\<slug>\rounds\<n>\.
// A helper of autopilot.js (like usage.js), not a feature module of its own.
//   Text: the worker ends with a short report (### Summary / Changed / Undo / Images / Next); parse() reads it. No extra
//         Claude run. The server writes the work-log entry from it, so the worker no longer reads and edits log.md.
//   Pictures: images the round's own picture tools returned (Blender look, Studio screen_capture / capture_plugin_gui;
//         an allowlist, so search thumbnails and generator previews are ignored), read from the run's raw stream through
//         server.js's "chat-line" tap and saved as cap-001.png...; 0 tokens, the model already saw them. Plus picture
//         files the worker saved into the round folder (Full only: one final picture when the change is visible).
//   Images are served read-only at /round-img/<slug>/<n>/<file> (asset()), only from inside <brain>\working.
// Card text read back from disk is re-validated (the worker can write to the brain). This module is built with only the
// context fields it needs; it never sees the server's map of chat runs. Examples here use made-up names only.
// Verified 2026-10-13 (test/rounds-test.js).
"use strict";
const fs = require("fs");
const { writeFileAtomic } = require("./lib/fsx");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");

const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROUND_DIR = /^\d{1,7}$/;
const CAP_FILE = /^cap-\d{3,4}\.(png|jpg|webp|gif)$/;
const IMG_FILE = /^[A-Za-z0-9][\w.-]{0,99}\.(png|jpe?g|webp|gif)$/i;
const DEVICE = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;
const TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
const EXT_OF = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
// Picture tools whose results become captures, and tools that change something (a capture before the first one is "Before").
const PIC_TOOL = /^mcp__(Roblox_Studio__(screen_capture|capture_plugin_gui)|blender__look)$/i;
const CHANGE = /^(Edit|Write|MultiEdit|NotebookEdit|mcp__Roblox_Studio__(multi_edit|execute_luau|insert_asset|generate_\w+)|mcp__blender__(execute_blender_code|import_asset|generate_3d))$/;
const OUTCOMES = ["running", "done", "failed", "stopped", "capped", "skipped", "interrupted"];
const FOCUS = ["feature", "content", "polish", "bugfix", "tests", "modeling", "scripting", "research", "general"];
// caps/capBytes per round, capMax per picture; keepRounds/projBytes per project (older captures are deleted, cards kept);
// saved/savedMax: worker files listed per round.
const LIMITS = { caps: 8, capBytes: 24 << 20, capMax: 8 << 20, keepRounds: 100, projBytes: 400 << 20, saved: 12, savedMax: 25 << 20 };

/* ---------- the worker's report ---------- */
const KEY = "(summary|what i did|what changed|changed|changes|how to undo(?: it)?|undo|images|pictures|screenshots|critique|critic|ideas for next|next)";
// "### Summary", "## Next steps", "### **Undo**", "### Summary: text"
const H_HEAD = new RegExp(`^\\s{0,3}#{1,6}\\s+(?:\\*\\*|__)?${KEY}\\b[^:]*?(?:\\*\\*|__)?\\s*(?::\\s*(.*))?$`, "i");
// "**Summary:** text", "**Summary**: text", "**Undo**"
const H_BOLD = new RegExp(`^\\s{0,3}(?:\\*\\*|__)${KEY}\\b\\s*:?\\s*(?:\\*\\*|__)\\s*:?\\s*(.*)$`, "i");
// "Summary: text", "Undo:" (a plain label needs the colon)
const H_PLAIN = new RegExp(`^\\s{0,3}${KEY}\\s*:\\s*(.*)$`, "i");
const ITEM = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/;
const CAP = /^\s*(?:[-*•]|\d+[.)])?\s*[`*"']*([^`*"']+?\.(?:png|jpe?g|webp|gif))[`*"']*\s*[:—–-]\s*(.+)$/i;
const partOf = (k) => {
  k = k.toLowerCase();
  if (k === "summary" || k === "what i did") return "summary";
  if (/^(changed|what changed|changes)$/.test(k)) return "changed";
  if (/undo/.test(k)) return "undo";
  if (/^(images|pictures|screenshots)$/.test(k)) return "images";
  if (/^critiq|^critic$/.test(k)) return "critique";
  return "next";
};
const strip = (s) => String(s || "").replace(/^\s*(#+|[-*>]|\d+\.)\s+/gm, "").replace(/[*`|]+/g, "");
const flat = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
function items(lines, max, len) {
  const out = [];
  for (const l of lines) {
    if (!l.trim()) continue;
    const m = ITEM.exec(l);
    if (m) out.push(m[1].trim());
    else if (out.length) out[out.length - 1] += " " + l.trim();
    else out.push(l.trim());
  }
  return out.map((x) => flat(x, len)).filter(Boolean).slice(0, max);
}
// -> { summary, changed[], undo, captions{}, next[], structured }. Without any part header, the whole text is the summary.
function parse(text) {
  const src = String(text || "");
  const buf = { pre: [], summary: [], changed: [], undo: [], images: [], critique: [], next: [] };
  let part = "pre", found = false;
  for (const line of src.split(/\r?\n/)) {
    const m = H_HEAD.exec(line) || H_BOLD.exec(line) || H_PLAIN.exec(line);
    if (m) {
      part = partOf(m[1]); found = true;
      const rest = String(m[2] || "").replace(/^[\s*_:]+|[\s*_]+$/g, "");
      if (rest) buf[part].push(rest);
      continue;
    }
    buf[part].push(line);
  }
  if (!found) return { summary: strip(src).trim().slice(0, 1200), changed: [], undo: "", captions: {}, critique: [], next: [], structured: false };
  const captions = {};
  for (const l of buf.images) {
    const m = CAP.exec(l);
    if (!m) continue;
    const name = m[1].trim().split(/[\\/]/).pop();
    if (IMG_FILE.test(name) && !DEVICE.test(name) && Object.keys(captions).length < 12) captions[name] = flat(m[2].replace(/[*`]+/g, ""), 200);
  }
  const summary = buf.summary.join("\n").trim() || buf.pre.join("\n").trim();
  return { summary: summary.slice(0, 1200), changed: items(buf.changed, 20, 300), undo: buf.undo.join("\n").trim().slice(0, 1500), captions, critique: items(buf.critique, 8, 300), next: items(buf.next, 5, 300), structured: true };
}
// The worker's rule lines that replace "append to the log" and "finish with a summary". Lite: no picture rule, no Images.
function rulesText({ dir, wlog, lite, critic }) {
  const pics = `- Pictures: pictures you take with the Roblox Studio or Blender tools while you work are saved for the user automatically, so no extra pictures are needed. One exception: if this round changed something the user could see and you haven't looked at it since your last change, save one final picture. In Studio, use screen_capture. In Blender, use a quick viewport render, never a full render, and never over the user's own render: with execute_blender_code, if bpy.data.images.get("Render Result") exists, first remember its render_slots.active_index, then make the slot named "The Wise Hive" active (reuse it, or create it with render_slots.new(name="The Wise Hive")); then inside bpy.context.temp_override(window=…, area=…, region=…) for a 3D View, call bpy.ops.render.opengl(), then bpy.data.images["Render Result"].save_render(filepath=r"${path.join(dir, "after.png")}") (after.jpg if the scene's output format is JPEG; skip it for any other format), then set active_index back to the slot you remembered. If any step fails, skip the picture. Don't change any scene or render setting, don't save the .blend, and don't look at the picture afterwards.\n`;
  return `${lite ? "" : pics}- The Wise Hive adds your report to the work log (${wlog}); don't edit that file.
- Finish with this report as your final message, in plain English for someone who doesn't code, at most ${lite ? 15 : 25} lines. Leave out a part that has nothing in it.
### Summary
2-4 sentences: what you did and what it means for the project.
### Changed
- one line per change: which file or Studio place, and what changed
### Undo
Exactly how to undo it: the commit(s) you made on teamwright/autowork (name them; if a commit failed, say so and list the changed files), or the Studio steps.
${lite ? "" : `### Images\n- <file name of a picture you saved in ${dir}>: one-line caption\n`}${critic ? "### Critique\n- the critic's last score, each must-fix issue and whether you fixed it\n" : ""}### Next
- 1-3 ideas for the next round`;
}
// log.md formats. Changed items are indented so review.js keeps them inside the round's block; both name "round N".
function logBlock(n, plan, rep, when) {
  const lines = [`## Round ${n} · ${when} · ${plan.focus || "general"} · ${flat(plan.title, 160)}`, `Summary: ${flat(strip(rep.summary), 1200) || "(no summary)"}`];
  if (rep.changed && rep.changed.length) lines.push("Changed:", ...rep.changed.map((c) => "  - " + flat(c, 300)));
  if (rep.undo) lines.push(`Undo: ${flat(rep.undo, 1500)}`);
  if (rep.next && rep.next.length) lines.push(`Next: ${rep.next.map((x) => flat(x, 300)).join("; ")}`);
  return lines.join("\n") + "\n";
}
const logLine = (n, plan, outcomeText, when) => `- ${when} · round ${n} · ${(plan && plan.focus) || "general"} · ${flat(plan && plan.title, 160)}: didn't finish (${flat(outcomeText, 300)}). Card: rounds\\${n}\\`;

/* ---------- card files ---------- */
const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
const iso = (v) => { const t = typeof v === "number" ? v : typeof v === "string" ? Date.parse(v) : NaN; return Number.isFinite(t) && Math.abs(t) < 8.64e15 ? new Date(t).toISOString() : null; };
const strs = (v, max, len) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).slice(0, max).map((x) => x.slice(0, len)) : []);
const plain = (v) => !!v && typeof v === "object" && !Array.isArray(v);
// Every field re-checked and cut to length; n comes from the folder name.
function sanitize(raw, n) {
  const r = plain(raw) ? raw : {}, p = plain(r.project) ? r.project : {};
  const captions = {};
  if (plain(r.captions)) for (const [k, v] of Object.entries(r.captions)) { if (Object.keys(captions).length >= 12) break; if (IMG_FILE.test(k) && !DEVICE.test(k) && typeof v === "string") captions[k] = v.slice(0, 200); }
  return {
    v: 1, n, runId: UUID.test(r.runId || "") ? r.runId : null, chatId: UUID.test(r.chatId || "") ? r.chatId : null,
    project: { name: str(p.name, 200), dir: str(p.dir, 400) },
    title: str(r.title, 200), focus: FOCUS.includes(r.focus) ? r.focus : "general", why: str(r.why, 400),
    startedAt: iso(r.startedAt), endedAt: iso(r.endedAt), ms: num(r.ms),
    outcome: OUTCOMES.includes(r.outcome) ? r.outcome : "interrupted", outcomeText: str(r.outcomeText, 300),
    summary: str(r.summary, 1200), changed: strs(r.changed, 20, 300), undo: str(r.undo, 1500), critique: strs(r.critique, 8, 300), next: strs(r.next, 5, 300), captions, structured: r.structured === true,
    images: (Array.isArray(r.images) ? r.images : []).filter((i) => plain(i) && CAP_FILE.test(i.file || "") && PIC_TOOL.test(i.tool || "")).slice(0, LIMITS.caps)
      .map((i) => ({ file: i.file, tool: i.tool, at: iso(i.at), phase: ["before", "after"].includes(i.phase) ? i.phase : "", bytes: num(i.bytes) || 0, sha1: /^[0-9a-f]{40}$/.test(i.sha1 || "") ? i.sha1 : "" })),
    imagesTrimmed: r.imagesTrimmed === true,
    commits: (Array.isArray(r.commits) ? r.commits : []).filter((c) => plain(c) && /^[0-9a-f]{7,40}$/.test(c.short || "")).slice(0, 20).map((c) => ({ short: c.short, subject: str(c.subject, 200) })),
    cost: num(r.cost), turns: num(r.turns),
  };
}
function writeCard(dir, card) {
  const f = path.join(dir, "card.json"), data = JSON.stringify(card, null, 1);
  writeFileAtomic(f, data);
}
function readCard(dir, n) {
  let raw; try { raw = JSON.parse(fs.readFileSync(path.join(dir, "card.json"), "utf8")); } catch { return null; }
  return sanitize(raw, n);
}

module.exports = (ctx) => {
  const WORK = path.join(ctx.BRAIN, "working");
  const LIM = { ...LIMITS, ...(ctx.roundLimits || {}) }; // tests shrink the budgets
  const HOSTS = new Set([`127.0.0.1:${ctx.PORT}`, `localhost:${ctx.PORT}`]);
  const logErr = (e) => console.error(new Date().toISOString(), "rounds:", e && e.message || e);
  const broadcast = (o) => { try { ctx.broadcast(o); } catch {} };
  const dirFor = (slug, n) => path.join(WORK, slug, "rounds", String(n));

  // Rounds this process is running, by "slug/n" (and by chat run id for the stream tap). Private to this module; it is
  // not, and never touches, the server's map of chat runs.
  const rlive = new Map(), byRun = new Map();
  const queue = (L, fn) => (L.chain = L.chain.then(fn).catch(logErr));
  // The card as written to disk: only pictures whose file is written.
  const diskCard = (L) => ({ ...L.card, images: L.card.images.filter((i) => i.ok).map(({ ok, ...i }) => i) });
  function saveSoon(L) {
    if (L.cardTimer || L.done) return;
    L.cardTimer = setTimeout(() => { L.cardTimer = null; if (!L.done) queue(L, () => writeCard(L.dir, diskCard(L))); }, 2000);
    if (L.cardTimer.unref) L.cardTimer.unref();
  }
  function pushSoon(L) {
    if (L.pushTimer || L.done) return;
    L.pushTimer = setTimeout(() => { L.pushTimer = null; broadcast({ t: "rounds", slug: L.slug, n: L.n }); }, 1000);
    if (L.pushTimer.unref) L.pushTimer.unref();
  }

  /* ---------- a round's life ---------- */
  function begin({ slug, project, n, plan, runId, startedAt }) {
    try {
      if (!SLUG.test(slug || "") || !(Number.isInteger(n) && n > 0)) return;
      let dir = dirFor(slug, n);
      fs.mkdirSync(dir, { recursive: true });
      const old = readCard(dir, n);
      // The number repeats after a state reset: move the old round aside (it stays on disk, unlisted).
      if (old && old.runId !== runId) { fs.renameSync(dir, `${dir}~${Date.now()}`); fs.mkdirSync(dir, { recursive: true }); }
      const card = { v: 1, n, runId: UUID.test(runId || "") ? runId : null, chatId: null, project: { name: str(project && project.name, 200), dir: str(project && project.dir, 400) },
        title: flat(plan && plan.title, 200), focus: FOCUS.includes(plan && plan.focus) ? plan.focus : "general", why: flat(plan && plan.why, 400),
        startedAt: new Date(startedAt || Date.now()).toISOString(), endedAt: null, ms: null, outcome: "running", outcomeText: "",
        summary: "", changed: [], undo: "", next: [], captions: {}, structured: false, images: [], imagesTrimmed: false, commits: [], cost: null, turns: null };
      writeCard(dir, card);
      const L = { slug, n, runId, dir, card, seq: 0, lastSha: "", changed: false, capBytes: 0, chain: Promise.resolve(), cardTimer: null, pushTimer: null, done: false, tools: new Map(), turns: null };
      rlive.set(slug + "/" + n, L);
      if (runId) byRun.set(runId, L);
      broadcast({ t: "rounds", slug, n });
      setImmediate(() => trim(slug).catch(logErr));
    } catch (e) { logErr(e); }
  }
  const liveOf = (slug, n) => rlive.get(slug + "/" + n);
  function changeSeen(L, name) { if (L && !L.done && CHANGE.test(String(name || ""))) L.changed = true; }
  // img: { tool, data (base64), mediaType }. Steps up to the queued write are synchronous, so order is kept.
  function captureL(L, img) {
    if (!L || L.done || !img || !PIC_TOOL.test(String(img.tool || ""))) return;
    const ext = EXT_OF[img.mediaType], data = img.data;
    if (!ext || typeof data !== "string" || !data.length || data.length > LIM.capMax * 1.37 + 16) return;
    const sha = crypto.createHash("sha1").update(data).digest("hex");
    if (sha === L.lastSha) return; // the same picture again
    const buf = Buffer.from(data, "base64");
    if (!buf.length || buf.length > LIM.capMax) return;
    L.lastSha = sha;
    const file = `cap-${String(++L.seq).padStart(3, "0")}.${ext}`;
    const entry = { file, tool: img.tool, at: new Date().toISOString(), phase: L.changed ? "" : "before", bytes: buf.length, sha1: sha };
    L.card.images.push(entry);
    L.capBytes += buf.length;
    queue(L, async () => { await fsp.writeFile(path.join(L.dir, file), buf); entry.ok = true; saveSoon(L); pushSoon(L); });
    // The ring: keep the first two "before" pictures and the newest ones, within the count and byte limits.
    const imgs = L.card.images;
    while (imgs.length > LIM.caps || (L.capBytes > LIM.capBytes && imgs.length > 1)) {
      const keep = new Set(imgs.filter((i) => i.phase === "before").slice(0, 2));
      let k = imgs.findIndex((i) => !keep.has(i));
      if (k < 0) k = 0;
      const [gone] = imgs.splice(k, 1);
      L.capBytes -= gone.bytes;
      if (CAP_FILE.test(gone.file)) queue(L, () => fsp.unlink(path.join(L.dir, gone.file)).catch(() => {}));
    }
  }
  // The stream tap (server.js emits every raw event of every chat run): tool uses, including subagents', in order, and
  // the images in tool results. Replayed user messages carry images at the top level, not in tool_result, so the user's
  // own attachments are never captured.
  function onLine(run, ev) {
    const L = run && byRun.get(run.id);
    if (!L || L.done || !ev) return;
    const blocks = ev.message && Array.isArray(ev.message.content) ? ev.message.content : [];
    if (ev.type === "assistant") {
      for (const b of blocks) {
        if (!b || b.type !== "tool_use" || !b.id) continue;
        L.tools.set(b.id, String(b.name || ""));
        if (L.tools.size > 3000) L.tools.delete(L.tools.keys().next().value);
        changeSeen(L, b.name);
      }
    } else if (ev.type === "user") {
      for (const b of blocks) {
        if (!b || b.type !== "tool_result" || !Array.isArray(b.content)) continue;
        const tool = L.tools.get(b.tool_use_id) || "";
        if (!PIC_TOOL.test(tool)) continue;
        for (const c of b.content) {
          if (!c || c.type !== "image") continue;
          // The Claude API form {source:{type:"base64", media_type, data}}; the raw MCP form {data, mimeType} too.
          const data = c.source && c.source.type === "base64" ? c.source.data : c.data;
          captureL(L, { tool, data, mediaType: (c.source && c.source.media_type) || c.mimeType || "" });
        }
      }
    } else if (ev.type === "result" && Number.isFinite(ev.num_turns)) L.turns = ev.num_turns;
  }
  if (ctx.hub && ctx.hub.on) ctx.hub.on("chat-line", (run, ev) => { try { onLine(run, ev); } catch (e) { logErr(e); } });

  function setChat(slug, n, chatId) {
    const L = liveOf(slug, n);
    if (!L || !UUID.test(chatId || "") || L.card.chatId === chatId) return;
    L.card.chatId = chatId;
    saveSoon(L);
  }
  // Called when a round ends (and by start() for a round a restart cut off). Never throws; resolves with the card or null.
  async function finish(slug, n, o = {}) {
    try {
      if (!SLUG.test(slug || "")) return null;
      const L = liveOf(slug, n), dir = dirFor(slug, n);
      let card, turns = null;
      if (L) {
        L.done = true;
        clearTimeout(L.cardTimer); clearTimeout(L.pushTimer); L.cardTimer = L.pushTimer = null;
        await L.chain;
        card = diskCard(L); turns = L.turns;
      } else {
        card = readCard(dir, n);
        if (!card) return null;
      }
      const rep = o.report;
      if (rep) Object.assign(card, { summary: str(rep.summary, 1200), changed: strs(rep.changed, 20, 300), undo: str(rep.undo, 1500), critique: strs(rep.critique, 8, 300), next: strs(rep.next, 5, 300), captions: sanitize({ captions: rep.captions }, n).captions, structured: rep.structured === true });
      const started = Date.parse(card.startedAt);
      Object.assign(card, { endedAt: new Date().toISOString(), ms: num(o.ms) ?? (Number.isFinite(started) ? Date.now() - started : null),
        outcome: OUTCOMES.includes(o.outcome) && o.outcome !== "running" ? o.outcome : "stopped", outcomeText: str(o.outcomeText, 300),
        cost: num(o.cost) ?? card.cost, turns: num(o.turns) ?? num(turns) ?? card.turns });
      if (UUID.test(o.chatId || "")) card.chatId = o.chatId;
      // "After": the worker's own after.* picture if there is one (picked when read), else the last capture not taken before a change.
      let names = []; try { names = fs.readdirSync(dir); } catch {}
      if (!names.some((f) => /^after\./i.test(f) && IMG_FILE.test(f))) {
        const last = [...card.images].reverse().find((i) => i.phase !== "before");
        if (last) last.phase = "after";
      }
      fs.mkdirSync(dir, { recursive: true });
      writeCard(dir, card);
      rlive.delete(slug + "/" + n);
      if (L && L.runId) byRun.delete(L.runId);
      broadcast({ t: "rounds", slug, n });
      // Commits this round made on teamwright/autowork, for "how to undo it".
      const pdir = o.projectDir || card.project.dir;
      const commits = await roundCommits(pdir, n, Date.parse(card.startedAt));
      if (commits.length) {
        card.commits = commits;
        if (!card.undo) card.undo = `Discard round ${n} in Review, or revert ${commits.map((c) => c.short).join(", ")} on teamwright/autowork.`;
        writeCard(dir, card);
        broadcast({ t: "rounds", slug, n });
      }
      return card;
    } catch (e) { logErr(e); return null; }
  }
  // Commits with the trailer "Teamwright-Round: n", made no earlier than a minute before the round started (the number
  // repeats after a state reset). No shell; a folder that isn't a repo just gives none.
  function roundCommits(dir, n, startMs) {
    return new Promise((ok) => {
      let isDir = false; try { isDir = !!dir && fs.statSync(dir).isDirectory(); } catch {}
      if (!isDir) return ok([]);
      execFile("git", ["-C", dir, "log", "refs/heads/teamwright/autowork", "--max-count=50", "--format=%h%x1f%ct%x1f%s%x1f%b%x1e", "--grep=Teamwright-Round: " + n],
        { timeout: 10000, windowsHide: true, maxBuffer: 4 << 20 }, (err, out) => {
          if (err) return ok([]);
          const re = new RegExp(`^Teamwright-Round:\\s*${n}\\s*$`, "m"), from = Number.isFinite(startMs) ? startMs - 60e3 : 0;
          ok(String(out || "").split("\x1e").map((r) => r.replace(/^\s+/, "").split("\x1f")).filter((p) => p.length >= 4 && /^[0-9a-f]{7,40}$/.test(p[0]) && re.test(p[3]) && Number(p[1]) * 1000 >= from)
            .slice(0, 20).map((p) => ({ short: p[0], subject: flat(p[2], 200) })));
        });
    });
  }
  // Keeps captured pictures within budget: none past the newest keepRounds rounds, and at most projBytes in all (oldest
  // rounds lose theirs first). Only the server's own cap-NNN files are deleted; cards and worker files are kept.
  async function trim(slug) {
    const base = path.join(WORK, slug, "rounds");
    let ns; try { ns = (await fsp.readdir(base)).filter((x) => ROUND_DIR.test(x)).map(Number).sort((a, b) => b - a); } catch { return; }
    const caps = async (n) => { const out = []; let fl = []; try { fl = await fsp.readdir(dirFor(slug, n)); } catch {} for (const f of fl) if (CAP_FILE.test(f)) { try { out.push({ f, size: (await fsp.stat(path.join(dirFor(slug, n), f))).size }); } catch {} } return out; };
    const drop = async (n, files) => {
      if (!files.length || rlive.has(slug + "/" + n)) return;
      const dir = dirFor(slug, n), gone = new Set();
      for (const { f } of files) { try { await fsp.unlink(path.join(dir, f)); gone.add(f); } catch {} }
      const card = readCard(dir, n);
      if (card && gone.size) { card.images = card.images.filter((i) => !gone.has(i.file)); card.imagesTrimmed = true; writeCard(dir, card); }
    };
    for (const n of ns.slice(LIM.keepRounds)) await drop(n, await caps(n));
    const kept = ns.slice(0, LIM.keepRounds), sizes = new Map();
    let total = 0;
    for (const n of kept) { const c = await caps(n); sizes.set(n, c); total += c.reduce((s, x) => s + x.size, 0); }
    for (const n of kept.slice().reverse()) {
      if (total <= LIM.projBytes) break;
      if (rlive.has(slug + "/" + n)) continue;
      const c = sizes.get(n);
      await drop(n, c);
      total -= c.reduce((s, x) => s + x.size, 0);
    }
  }

  /* ---------- answers for the page ---------- */
  function publicCard(slug, n, card, running) {
    const dir = dirFor(slug, n), out = { ...card, running: !!running, folder: dir };
    delete out.runId;
    if (!running && out.outcome === "running") out.outcome = "interrupted"; // its server process is gone
    let names = []; try { names = fs.readdirSync(dir); } catch {}
    const have = new Set(names), capOf = (f) => { const k = Object.keys(card.captions).find((x) => x.toLowerCase() === f.toLowerCase()); return k ? card.captions[k] : ""; };
    const pics = card.images.filter((i) => have.has(i.file)).map((i) => ({ file: i.file, tool: i.tool, at: i.at, phase: i.phase, bytes: i.bytes, caption: capOf(i.file),
      url: `/round-img/${slug}/${n}/${i.file}?v=${(i.sha1 || "0").slice(0, 8)}` }));
    let saved = 0;
    for (const f of names.sort()) {
      if (saved >= LIM.saved || !IMG_FILE.test(f) || CAP_FILE.test(f) || DEVICE.test(f) || f.includes("..")) continue;
      let st; try { st = fs.statSync(path.join(dir, f)); } catch { continue; }
      if (!st.isFile() || st.size > LIM.savedMax) continue;
      saved++;
      pics.push({ file: f, tool: "saved", at: new Date(st.mtimeMs).toISOString(), phase: /^after\./i.test(f) ? "after" : "", bytes: st.size, caption: capOf(f), url: `/round-img/${slug}/${n}/${encodeURIComponent(f)}?v=${Math.round(st.mtimeMs)}` });
    }
    let hero = pics.findIndex((i) => i.tool === "saved" && i.phase === "after");
    if (hero < 0) hero = pics.map((i) => i.phase).lastIndexOf("after");
    if (hero < 0) hero = pics.length - 1;
    out.images = pics; out.hero = hero;
    return out;
  }
  function roundNums(slug) { try { return fs.readdirSync(path.join(WORK, slug, "rounds")).filter((x) => ROUND_DIR.test(x)).map(Number).sort((a, b) => b - a); } catch { return []; } }
  function cardOf(slug, n) {
    const L = liveOf(slug, n);
    if (L) return publicCard(slug, n, sanitize(diskCard(L), n), true);
    const c = readCard(dirFor(slug, n), n);
    return c ? publicCard(slug, n, c, false) : null;
  }
  function projects() {
    let dirs = []; try { dirs = fs.readdirSync(WORK); } catch {}
    const out = [];
    for (const slug of dirs) {
      if (!SLUG.test(slug)) continue;
      const ns = roundNums(slug);
      if (!ns.length) continue;
      const head = (ctx.read(path.join(WORK, slug, "log.md")) || "").slice(0, 2000);
      let name = ((/^# Working log: (.+)$/m.exec(head) || [])[1] || "").trim();
      if (!name) { const c = readCard(dirFor(slug, ns[0]), ns[0]); name = (c && c.project.name) || slug; }
      out.push({ slug, name: name.slice(0, 200), count: ns.length, newest: ns[0] });
    }
    return out.sort((a, b) => b.newest - a.newest);
  }
  function list(slug, { before, limit } = {}) {
    const ps = projects();
    if (!slug) {
      let curSlug = null; try { curSlug = ctx.currentSlug ? ctx.currentSlug() : null; } catch {}
      slug = (ps.find((p) => p.slug === curSlug) || ps[0] || {}).slug || null;
    }
    const p = slug && ps.find((x) => x.slug === slug);
    if (!p) return { slug: null, project: null, projects: ps, rounds: [], more: false };
    const k = Math.min(30, Math.max(1, Number(limit) || 3)), b = Number(before) > 0 ? Number(before) : Infinity;
    const ns = roundNums(slug).filter((n) => n < b);
    return { slug, project: { slug, name: p.name }, projects: ps, rounds: ns.slice(0, k).map((n) => cardOf(slug, n)).filter(Boolean), more: ns.length > k };
  }
  function route(p, req, res, url) {
    if (!p.startsWith("/api/autopilot/working/rounds")) return false;
    if (req.method !== "GET") { ctx.json(res, 405, { error: "use GET" }); return true; }
    if (p === "/api/autopilot/working/rounds") {
      const q = url ? url.searchParams : new URLSearchParams();
      const slug = q.get("project");
      if (slug && !SLUG.test(slug)) { ctx.json(res, 400, { error: "bad project" }); return true; }
      ctx.json(res, 200, list(slug || null, { before: q.get("before"), limit: q.get("limit") }));
      return true;
    }
    const m = /^\/api\/autopilot\/working\/rounds\/([^/]+)\/(\d{1,7})$/.exec(p);
    if (!m || !SLUG.test(m[1])) { ctx.json(res, 400, { error: "bad round" }); return true; }
    const card = cardOf(m[1], Number(m[2]));
    ctx.json(res, card ? 200 : 404, card ? { round: card } : { error: "not found" });
    return true;
  }
  // Pictures for <img> tags (no X-Hive header possible), read-only and only from inside <brain>\working.
  function asset(p, req, res) {
    const m = /^\/round-img\/([a-z0-9][a-z0-9-]{0,79})\/(\d{1,7})\/([^/]+)$/.exec(p); // p is still %-encoded, so "%2e%2e" and "%2f" can't pass IMG_FILE
    if (!m) return false;
    const fail = (code) => { if (!res.headersSent) { res.writeHead(code, { "Content-Type": "text/plain", "X-Content-Type-Options": "nosniff" }); res.end(code === 403 ? "forbidden" : code === 405 ? "method not allowed" : "not found"); } return true; };
    try {
      if (req.method !== "GET" && req.method !== "HEAD") return fail(405);
      if (!HOSTS.has(String(req.headers.host || "").toLowerCase())) return fail(403); // DNS rebinding: another name pointing at 127.0.0.1
      const site = req.headers["sec-fetch-site"];
      if (site && site !== "same-origin" && site !== "none") return fail(403); // other web pages can't embed these
      const name = m[3];
      if (!IMG_FILE.test(name) || name.includes("..") || DEVICE.test(name)) return fail(404);
      const root = fs.realpathSync.native(WORK).toLowerCase() + path.sep;
      const real = fs.realpathSync.native(path.join(WORK, m[1], "rounds", m[2], name)), st = fs.statSync(real);
      if (!real.toLowerCase().startsWith(root) || !st.isFile() || st.size > LIM.savedMax) return fail(404); // junctions and links can't lead out
      res.writeHead(200, { "Content-Type": TYPES[name.split(".").pop().toLowerCase()], "Content-Length": st.size, "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin", "Content-Security-Policy": "default-src 'none'" });
      if (req.method === "HEAD") { res.end(); return true; }
      fs.createReadStream(real).on("error", () => res.destroy()).pipe(res);
      return true;
    } catch { return fail(404); } // no working folder, no file, or any other fs error
  }

  return { dirFor, begin, setChat, finish, list, route, asset, parse, rulesText, logBlock, logLine,
    toolUse: (slug, n, name) => changeSeen(liveOf(slug, n), name), capture: (slug, n, img) => { try { captureL(liveOf(slug, n), img); } catch (e) { logErr(e); } },
    _test: { rlive, byRun, onLine, trim, sanitize, LIM } };
};
Object.assign(module.exports, { parse, rulesText, logBlock, logLine, sanitize, SLUG, PIC_TOOL, CHANGE, LIMITS });
