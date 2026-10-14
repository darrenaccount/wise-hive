// Memory health check: finds broken or messy memories in <brain>\memory without asking Claude.
// The pure check(BRAIN) is shared with the CLI tools\check-memory.js. The module adds GET /api/memhealth and a daily
// check (start()) that notifies only when NEW errors appear; the last result is kept in librarian\health.json.
const fs = require("fs");
const { writeFileAtomic } = require("./lib/fsx");
const path = require("path");

const TYPES = ["user", "feedback", "project", "reference"];
const LINE_MAX = 200, STUB_MAX = 280;
// Top-level folders a memory may name relative to <brain> (e.g. projects\wise-hive.md).
const BRAIN_DIRS = /^(app|projects|knowledge|memory|blender|roblox|tools|transcripts|librarian|ideas|council|clarifier|prompts|training|working|autopilot|updates|sketches|uploads|chat-media|link|organizer)$/i;

const readSafe = (f) => { try { return fs.readFileSync(f, "utf8"); } catch { return null; } };
const exists = (p) => { try { return fs.existsSync(p); } catch { return false; } };

// Frontmatter with one level of nesting (metadata:) and folded/literal block values. Returns null if there is none.
function front(src) {
  const m = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/.exec(src || "");
  if (!m) return null;
  const meta = {}, bad = [];
  let parent = null, blockKey = null, blockObj = null;
  for (const l of m[1].split(/\r?\n/)) {
    if (!l.trim() || /^\s*#/.test(l)) continue;
    const ind = /^\s*/.exec(l)[0].length;
    if (blockKey && ind > 0 && (!parent || ind > 2)) { blockObj[blockKey] = (blockObj[blockKey] ? blockObj[blockKey] + " " : "") + l.trim(); continue; }
    blockKey = null;
    const kv = /^\s*([A-Za-z_][\w-]*):\s*(.*)$/.exec(l);
    if (!kv) { bad.push(l.trim()); continue; }
    const v = kv[2].trim().replace(/^(["'])(.*)\1$/, "$2");
    if (ind === 0) {
      parent = null;
      if (v === "") { meta[kv[1]] = meta[kv[1]] || {}; parent = kv[1]; }
      else if (/^[>|][+-]?$/.test(v)) { meta[kv[1]] = ""; blockKey = kv[1]; blockObj = meta; }
      else meta[kv[1]] = v;
    } else if (parent && typeof meta[parent] === "object") {
      if (/^[>|][+-]?$/.test(v)) { meta[parent][kv[1]] = ""; blockKey = kv[1]; blockObj = meta[parent]; }
      else meta[parent][kv[1]] = v;
    } else bad.push(l.trim());
  }
  return { meta, body: m[2], bad };
}

// Paths a memory mentions: Windows absolute paths, and brain-relative ones like projects\x.md.
function mentionedPaths(text, BRAIN) {
  const out = new Set();
  const t = String(text || "").replace(/```[\s\S]*?```/g, " "); // code blocks are examples, not claims
  // Windows paths may contain spaces ("joshs video"): take the rest of the line, then the longest prefix (cut at a
  // space) that exists; if none does, report the part before the first space.
  for (const m of t.matchAll(/(?<![\w/:.%])([A-Za-z]:(?:\\|\/(?!\/))[^\r\n`"'<>|*?()\[\]{},;]*)/g)) {
    const parts = m[1].split(" "), tidy = (s) => s.replace(/[.,;:!]+$/, "");
    let p = tidy(parts[0]);
    for (let n = Math.min(parts.length, 5); n > 1; n--) { const c = tidy(parts.slice(0, n).join(" ")); if (exists(c)) { p = c; break; } }
    if (/\.\.\.|…|%|\$|<|\{/.test(p) || p.length < 4) continue;
    out.add(p);
  }
  // Brain-relative paths only in backslash form (forward-slash ones in notes usually belong to another project).
  for (const m of t.matchAll(/(?<![\w\\/:.])([A-Za-z][\w-]*\\[^\s`"'<>|*?()\[\]{}]+)/g)) {
    const p = m[1].replace(/[.,;:!]+$/, "");
    const top = p.split(/[\\/]/)[0];
    if (!BRAIN_DIRS.test(top) || /\.\.\.|…|<|\{|\*/.test(p)) continue;
    if (!/\.[a-z0-9]{1,5}$/i.test(p) && !/[\\/]$/.test(p)) continue; // only clear file paths or folder\ mentions
    out.add(path.join(BRAIN, p));
  }
  return [...out];
}

// The whole check. Pure apart from reading files: returns { at, counts, groups:[{id, level, title, hint, items:[{file, text}]}] }.
function check(BRAIN = process.env.TEAMWRIGHT_BRAIN || path.resolve(__dirname, "..")) {
  const MEM = path.join(BRAIN, "memory");
  const G = {};
  const group = (id, level, title, hint) => (G[id] = G[id] || { id, level, title, hint, items: [] });
  const add = (id, level, title, hint, file, text) => group(id, level, title, hint).items.push({ file: file || "", text });
  const DEF = {
    front: ["error", "Missing or broken frontmatter", "Each memory needs a --- block with name, description and metadata.type."],
    unlisted: ["error", "Memories not listed in MEMORY.md", "MEMORY.md is the index Claude reads first; add a line for each."],
    missing: ["error", "MEMORY.md points to files that don't exist", "Remove the line or restore the file."],
    dupe: ["error", "Two memories with the same name", "Merge them or rename one."],
    stub: ["warn", "Redirect or stub memories", "Tiny files that only point elsewhere; fold them into the target and delete."],
    stale: ["warn", "Mentions paths that no longer exist (may be stale)", "The file or folder named in the memory wasn't found on disk."],
    long: ["warn", "MEMORY.md lines that are too long", `Keep index lines under ${LINE_MAX} characters; details belong in the memory file.`],
    format: ["warn", "MEMORY.md lines that aren't index entries", "Index lines look like: - [Title](file.md) — hook"],
    index: ["warn", "INDEX.md mentions files that don't exist", "Update the top-level map."],
    links: ["info", "Links to notes not written yet", "[[name]] links with no memory of that name. Allowed as to-write markers."],
  };
  const put = (id, file, text) => add(id, ...DEF[id], file, text);

  if (!exists(MEM)) { put("front", "", `No memory folder at ${MEM}`); return finish(G); }
  const files = fs.readdirSync(MEM).filter((f) => /\.md$/i.test(f) && f !== "MEMORY.md");
  const byName = new Map(), parsed = [];
  for (const f of files) {
    const src = readSafe(path.join(MEM, f)) || "";
    const fm = front(src);
    if (!fm) { put("front", f, "No frontmatter block at the top."); parsed.push({ f, body: src, name: f.replace(/\.md$/i, "") }); continue; }
    const md = fm.meta, meta = typeof md.metadata === "object" ? md.metadata : {};
    const type = meta.type || (typeof md.type === "string" ? md.type : "");
    const probs = [];
    if (!md.name || typeof md.name !== "string") probs.push("no name");
    else if (!/^[a-z0-9][a-z0-9-]*$/.test(md.name)) probs.push(`name "${md.name}" isn't a lowercase-dash slug`);
    else if (md.name !== f.replace(/\.md$/i, "")) probs.push(`name "${md.name}" doesn't match the file name`);
    if (!md.description || typeof md.description !== "string") probs.push("no description");
    if (!type) probs.push("no metadata.type");
    else if (!TYPES.includes(type)) probs.push(`type "${type}" isn't one of ${TYPES.join("/")}`);
    if (meta.modified && isNaN(Date.parse(meta.modified))) probs.push(`modified "${meta.modified}" isn't a date`);
    if (fm.bad.length) probs.push(`unreadable line: ${fm.bad[0].slice(0, 60)}`);
    if (!fm.body.trim()) probs.push("empty body");
    if (probs.length) put("front", f, probs.join("; "));
    const name = typeof md.name === "string" && md.name ? md.name : f.replace(/\.md$/i, "");
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(f);
    parsed.push({ f, body: fm.body, name });
  }
  for (const [name, fs_] of byName) if (fs_.length > 1) put("dupe", fs_[0], `"${name}" is used by ${fs_.join(", ")}`);
  const names = new Set([...byName.keys(), ...files.map((f) => f.replace(/\.md$/i, ""))]);

  for (const { f, body } of parsed) {
    const plain = body.trim();
    if (plain.length <= STUB_MAX && /(moved to|merged into|now lives in|superseded by|replaced by|see \[\[|redirect)/i.test(plain)) put("stub", f, `Only ${plain.length} characters: "${plain.replace(/\s+/g, " ").slice(0, 100)}"`);
    const seen = new Set();
    for (const m of body.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) {
      const t = m[1].trim();
      if (seen.has(t)) continue; seen.add(t);
      if (!names.has(t) && !names.has(t.replace(/\.md$/i, ""))) put("links", f, `[[${t}]]`);
    }
    const gone = mentionedPaths(body, BRAIN).filter((p) => !exists(p));
    if (gone.length) put("stale", f, gone.slice(0, 6).join(", ") + (gone.length > 6 ? ` and ${gone.length - 6} more` : ""));
  }

  const idx = readSafe(path.join(MEM, "MEMORY.md"));
  if (idx == null) put("missing", "MEMORY.md", "MEMORY.md itself is missing.");
  else {
    const listed = new Map();
    idx.split(/\r?\n/).forEach((l, i) => {
      if (!l.trim() || /^\s*#/.test(l)) return;
      const n = i + 1;
      if (l.length > LINE_MAX) put("long", "MEMORY.md", `Line ${n} is ${l.length} characters: ${l.slice(0, 70)}…`);
      const links = [...l.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => { try { return decodeURIComponent(m[1]); } catch { return m[1]; } }); // a literal % in a name isn't an escape
      if (!links.length) { put("format", "MEMORY.md", `Line ${n}: ${l.trim().slice(0, 90)}`); return; }
      for (const t of links) {
        if (/^[a-z]+:\/\//i.test(t)) continue;
        const rel = t.replace(/^\.?[\\/]/, "");
        const full = path.resolve(MEM, rel);
        if (!full.toLowerCase().startsWith(path.resolve(BRAIN).toLowerCase())) { put("format", "MEMORY.md", `Line ${n} links outside the brain: ${t}`); continue; }
        if (!exists(full)) put("missing", "MEMORY.md", `Line ${n}: ${t}`);
        const key = path.basename(rel).toLowerCase();
        if (listed.has(key)) put("format", "MEMORY.md", `Line ${n} lists ${t} again (also line ${listed.get(key)})`);
        else listed.set(key, n);
      }
    });
    for (const f of files) if (!listed.has(f.toLowerCase())) put("unlisted", f, "Not in MEMORY.md");
  }

  const top = readSafe(path.join(BRAIN, "INDEX.md"));
  if (top != null) {
    const gone = mentionedPaths(top, BRAIN).filter((p) => !exists(p));
    for (const p of gone) put("index", "", p);
  }
  return finish(G);
}
function finish(G) {
  const order = ["error", "warn", "info"];
  const groups = Object.values(G).filter((g) => g.items.length).sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level));
  const counts = { error: 0, warn: 0, info: 0 };
  for (const g of groups) counts[g.level] += g.items.length;
  return { at: new Date().toISOString(), counts, groups };
}
// Stable keys for error items, to spot errors that weren't there last time.
const errorKeys = (r) => (r.groups || []).filter((g) => g.level === "error").flatMap((g) => g.items.map((i) => `${g.id}|${i.file}|${i.text}`));

// Plain-text report for the CLI.
function report(r) {
  const L = { error: "ERROR", warn: "WARN ", info: "INFO " };
  const out = [`Memory health ${r.at}: ${r.counts.error} errors, ${r.counts.warn} warnings, ${r.counts.info} notes`];
  for (const g of r.groups) {
    out.push("", `${L[g.level]} ${g.title} (${g.items.length})`, `      ${g.hint}`);
    for (const i of g.items) out.push(`  - ${i.file ? i.file + ": " : ""}${i.text}`);
  }
  if (!r.groups.length) out.push("", "All clear.");
  return out.join("\n");
}

module.exports = (ctx) => {
  const BRAIN = process.env.HIVE_MEMHEALTH_BRAIN || ctx.BRAIN;
  const STORE = path.join(BRAIN, "librarian", "health.json");
  const DAY = 24 * 3600 * 1000;
  const last = () => { try { return JSON.parse(fs.readFileSync(STORE, "utf8")); } catch { return null; } };
  function save(r, seen) {
    try { writeFileAtomic(STORE, JSON.stringify({ ...r, seenErrors: seen }, null, 1)); } catch (e) { console.error("memhealth save:", e.message); }
  }
  // Runs the check; on the scheduled run, notifies only about errors that weren't in the stored result.
  function run(scheduled) {
    const prev = last(), r = check(BRAIN), keys = errorKeys(r);
    const old = new Set((prev && prev.seenErrors) || []), fresh = keys.filter((k) => !old.has(k));
    save(r, keys);
    ctx.broadcast && ctx.broadcast({ t: "memhealth", counts: r.counts, at: r.at });
    if (scheduled && fresh.length && ctx.notify) ctx.notify({ title: `Memory check: ${fresh.length} new problem${fresh.length === 1 ? "" : "s"}`, body: fresh.slice(0, 2).map((k) => k.split("|").slice(1).join(": ")).join("\n").slice(0, 200), view: "library" });
    return { ...r, newErrors: fresh.length };
  }
  return {
    check: () => check(BRAIN),
    route(p, req, res, url) {
      if (p === "/api/memhealth" && req.method === "GET") {
        try { return ctx.json(res, 200, run(url.searchParams.get("scheduled") === "1")), true; }
        catch (e) { return ctx.json(res, 500, { error: String(e && e.message || e) }), true; }
      }
      if (p === "/api/memhealth/last" && req.method === "GET") return ctx.json(res, 200, last() || {}), true;
      return false;
    },
    start() {
      // First check a minute after start if the last one is over a day old, then once a day.
      const prev = last(), age = prev && prev.at ? Date.now() - Date.parse(prev.at) : Infinity;
      const tick = () => { try { run(true); } catch (e) { console.error("memhealth:", e); } };
      const loop = (ms) => setTimeout(() => { tick(); loop(DAY); }, ms).unref();
      loop(age > DAY ? 60000 : Math.max(60000, DAY - age));
    },
  };
};
module.exports.check = check;
module.exports.report = report;
module.exports.front = front;
