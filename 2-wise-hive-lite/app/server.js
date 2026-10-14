// The Wise Hive local server: serves the app and bridges it to Claude Code and the brain folder (the folder above app\).
// No dependencies. Run: node server.js  (listens on 127.0.0.1:4747 only)
const http = require("http");
const fs = require("fs");
const fsp = fs.promises;
const { writeFileAtomic } = require("./lib/fsx");
const path = require("path");
const os = require("os");
const { spawn, execFile } = require("child_process");
const crypto = require("crypto");
const { EventEmitter } = require("events");
// The Electron shell listens here for desktop notifications.
const hub = new EventEmitter();

// Log any crash with a timestamp (start.ps1 sends output to server.log) instead of dying silently.
process.on("uncaughtException", (e) => console.error(new Date().toISOString(), "uncaught:", e && e.stack || e));
process.on("unhandledRejection", (e) => console.error(new Date().toISOString(), "unhandled rejection:", e && e.stack || e));

// HIVE_PORT lets the updater smoke-test a changed server on another port before restarting the real one.
const PORT = Number(process.env.HIVE_PORT) || 4747;
// The brain is the folder this app is installed in (<brain>\app); TEAMWRIGHT_BRAIN overrides it (tests).
const BRAIN = process.env.TEAMWRIGHT_BRAIN || path.resolve(__dirname, "..");
const HOME = os.homedir();
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, ".claude");
const PROJECTS = path.join(CLAUDE_DIR, "projects");
const SKILLS = path.join(CLAUDE_DIR, "skills");
// Per-user settings that never ship with the app (written by the installer): extra project folders, git identity.
// { "projectFolders": ["C:\\Games\\MyGame"], "projectRoots": ["D:\\Games"], "gitName": "The Wise Hive", "gitEmail": "teamwright@localhost" }
const USER_CFG = (() => { try { return JSON.parse(fs.readFileSync(path.join(BRAIN, "app-settings", "teamwright.json"), "utf8")); } catch { return {}; } })();
// Edition: "full" (default) or "lite". The Wise Hive Lite release ships app\edition.json = {"edition":"lite"}.
// Lite uses far less of the user's Claude usage: every helper run is trimmed to the essentials (no MCP servers, skills,
// hooks or settings; ~6k tokens to start instead of ~45k), the Clarifier and Inventor run less often on Haiku,
// the Council runs on Sonnet, and the autopilot loops take shorter rounds with fewer helpers.
const { LITE, EDITION, NAME } = require("./edition");
const { NOT_LOGGED_IN } = require("./limits.js"); // shared with jobs.js (activity panel)
// Folders to offer as projects besides the ones chats ran in: projectFolders as-is, plus every subfolder of each projectRoots entry.
function configuredFolders() {
  const out = [...(USER_CFG.projectFolders || [])];
  for (const r of USER_CFG.projectRoots || []) { try { for (const d of fs.readdirSync(r)) out.push(path.join(r, d)); } catch {} }
  return out;
}
const PUBLIC = path.join(__dirname, "public");
const CLAUDE = fs.existsSync(path.join(HOME, ".local", "bin", "claude.exe")) ? path.join(HOME, ".local", "bin", "claude.exe") : "claude";
const ORIGINS = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
// The page's Content-Security-Policy: scripts only from this server (no inline script, so injected markup can't run code
// and drive Claude through the API), Google Fonts for the pixel font, and blob:/data: for the pictures and audio the
// Taste viewer and chats build in the page. Inline style attributes are used everywhere, so styles keep 'unsafe-inline'.
const PAGE_CSP = ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:", "media-src 'self' data: blob:", "connect-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"].join("; ");
// Routes only the app window may call (Taste verdicts): Origin must be present and ours, the fetch same-origin, and under
// Electron the per-launch key main.js adds to its own window's requests (memory only; never on disk or in env, so no
// Claude run can read it). The general /api/ guard above it is unchanged, so to-app.ps1 and the skills keep working.
let PAGE_KEY = null;
function setPageKey(k) { PAGE_KEY = typeof k === "string" && k.length >= 32 ? k : null; }
function isPage(req) {
  const h = req.headers || {};
  if (!ORIGINS.has(h.origin) || h["sec-fetch-site"] !== "same-origin") return false;
  if (!PAGE_KEY) return true;
  const got = Buffer.from(String(h["x-hive-page"] || "")), want = Buffer.from(PAGE_KEY);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
// Taste signing key (verdicts, the Claude-grading opt-in and critic queues; see taste.js). It never sits in the brain,
// where Training rounds work: main.js keeps it in the desktop app's data folder and hands it over here in memory. The
// plain-node fallback (start.ps1 without Electron) only reads that file, to show reviews, and saves nothing: its page
// check can't tell the window from another local program. HIVE_TASTE_KEY_FILE (tests and debug instances only) names a
// key file to use read-write.
let TASTE_KEY = null, tasteFallback = { at: 0, v: null };
function setTasteKey(k) { if (typeof k === "string" && /^[0-9a-f]{64}$/.test(k)) TASTE_KEY = { key: k, write: true }; }
function tasteKey() {
  if (TASTE_KEY) return TASTE_KEY;
  if (Date.now() - tasteFallback.at < 60e3) return tasteFallback.v;
  const own = process.env.HIVE_TASTE_KEY_FILE, f = own || path.join(process.env.APPDATA || path.join(HOME, "AppData", "Roaming"), "teamwright", "taste.key");
  let k = (read(f) || "").trim();
  if (own && !/^[0-9a-f]{64}$/.test(k)) { k = crypto.randomBytes(32).toString("hex"); try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, k); } catch { k = ""; } }
  tasteFallback = { at: Date.now(), v: /^[0-9a-f]{64}$/.test(k) ? { key: k, write: !!own } : null };
  return tasteFallback.v;
}

const read = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } };
const json = (res, code, body) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
// Request bodies: raw chunks decoded once at the end (decoding each chunk alone breaks a character split between two),
// capped so a runaway sender can't exhaust memory or V8's ~512 MB string limit (the API answers 413). Not 50 MB: Taste
// uploads (150 MB a send) and chat attachments (10 x 15 MB) arrive base64-encoded, ~200 MB. HIVE_BODY_MAX: tests only.
const BODY_MAX = Number(process.env.HIVE_BODY_MAX) || 256 << 20;
const body = (req) => new Promise((ok, no) => {
  const parts = []; let size = 0, over = false;
  req.on("data", (c) => {
    if (over) return;
    size += c.length;
    if (size > BODY_MAX) { over = true; parts.length = 0; no(Object.assign(new Error("request body too large"), { status: 413 })); return; }
    parts.push(c);
  });
  req.on("end", () => { if (over) return; try { ok(JSON.parse(Buffer.concat(parts, size).toString("utf8") || "{}")); } catch { ok({}); } });
});

/* ---------- transcripts ---------- */
const stripSys = (t) => String(t || "")
  .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
  .replace(/<pasted_content[^>]*>[\s\S]*?<\/pasted_content>/g, "[pasted text]")
  .replace(/<command-[a-z-]+>[\s\S]*?<\/command-[a-z-]+>/g, "")
  .trim();

function listTranscripts() {
  const out = [];
  if (!fs.existsSync(PROJECTS)) return out;
  for (const dir of fs.readdirSync(PROJECTS)) {
    const full = path.join(PROJECTS, dir);
    let files = [];
    try { files = fs.readdirSync(full).filter((f) => f.endsWith(".jsonl")); } catch { continue; }
    for (const f of files) out.push(path.join(full, f));
  }
  return out;
}
const metaCache = new Map();
function sessionMeta(file) {
  const st = fs.statSync(file);
  const c = metaCache.get(file);
  if (c && c.mtime === st.mtimeMs) return c.meta;
  const fd = fs.openSync(file, "r");
  const buf = Buffer.alloc(Math.min(st.size, 400000));
  fs.readSync(fd, buf, 0, buf.length, 0); fs.closeSync(fd);
  return metaFromHead(file, st, buf);
}
// The same without blocking, for lists: on Windows each stat costs ~1 ms, so checking all ~240 transcripts
// synchronously held the server (and the window, which shares its process) for 100-600 ms on every chat list, projects
// and search call. Stats and reads run on the thread pool; only new or changed transcripts have their head read.
async function sessionMetaAsync(file) {
  const st = await fsp.stat(file);
  const c = metaCache.get(file);
  if (c && c.mtime === st.mtimeMs) return c.meta;
  const buf = Buffer.alloc(Math.min(st.size, 400000));
  const fh = await fsp.open(file, "r");
  try { await fh.read(buf, 0, buf.length, 0); } finally { await fh.close(); }
  return metaFromHead(file, st, buf);
}
async function listTranscriptsAsync() {
  let dirs; try { dirs = await fsp.readdir(PROJECTS); } catch { return []; }
  const per = await Promise.all(dirs.map(async (dir) => {
    try { return (await fsp.readdir(path.join(PROJECTS, dir))).filter((f) => f.endsWith(".jsonl")).map((f) => path.join(PROJECTS, dir, f)); } catch { return []; }
  }));
  return per.flat(); // same order as listTranscripts()
}
// Every transcript's meta (unreadable ones left out), in listTranscripts() order.
async function sessionMetas() {
  const metas = await Promise.all((await listTranscriptsAsync()).map((f) => sessionMetaAsync(f).catch(() => null)));
  return metas.filter(Boolean);
}
function metaFromHead(file, st, buf) {
  const id = path.basename(file, ".jsonl");
  let cwd = "", title = "", started = "";
  for (const line of buf.toString("utf8").split("\n")) {
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (!cwd && e.cwd) cwd = e.cwd;
    if (!started && e.timestamp) started = e.timestamp;
    if (!title && e.type === "user" && !e.isMeta && !e.isSidechain) {
      const ct = e.message && e.message.content;
      const t = typeof ct === "string" ? ct : Array.isArray(ct) ? ct.filter((b) => b.type === "text").map((b) => b.text).join(" ") : "";
      const s = stripSys(t);
      if (s && !s.startsWith("<")) title = s.replace(/\s+/g, " ").slice(0, 90);
    }
    if (cwd && title && started) break;
  }
  const meta = { id, cwd, title: title || "(untitled)", started, updated: new Date(st.mtimeMs).toISOString(), project: cwd ? (/scratch-workspaces/i.test(cwd) ? "No folder" : path.basename(cwd)) : "unknown", cwdExists: cwd ? fs.existsSync(cwd) : false };
  metaCache.set(file, { mtime: st.mtimeMs, meta });
  return meta;
}
function findTranscript(id) {
  for (const f of listTranscripts()) if (path.basename(f, ".jsonl") === id) return f;
  const raw = path.join(BRAIN, "transcripts", "raw", id + ".jsonl");
  return fs.existsSync(raw) ? raw : null;
}
function toolSummary(name, inp = {}) {
  const s = inp.description || inp.file_path || inp.path || inp.command || inp.pattern || inp.url || inp.query || inp.skill || inp.prompt || "";
  return String(s).replace(/\s+/g, " ").slice(0, 120);
}
// The last 400 messages of a chat: a user line with text is one message; the assistant lines between two of them are
// one message. Reads the file backwards in chunks and stops once 401 messages have begun (the 401st may be cut and is
// dropped), so a transcript of hundreds of MB costs only its tail: reading it whole blocked the app for seconds, and past
// ~512 MB V8 couldn't hold it as one string, so the chat showed empty.
const MSG_KEEP = 400, TAIL_CHUNK = 1 << 20;
// Async (the chunks are read off the event loop, so the server and the window keep answering while a big transcript is
// read) and cached by size + mtime: opening the same chat again costs nothing (measured 1.1 s for a 395 MB transcript
// that was all read, because it has only 196 messages). A chat that is still running changes size, so it's read again.
const msgCache = new Map(); // file -> { size, mtimeMs, msgs }, newest 4
async function sessionMessages(file) {
  let st; try { st = await fsp.stat(file); } catch { return []; }
  const c = msgCache.get(file);
  if (c && c.size === st.size && c.mtimeMs === st.mtimeMs) return c.msgs;
  const msgs = await readSessionMessages(file);
  msgCache.delete(file); msgCache.set(file, { size: st.size, mtimeMs: st.mtimeMs, msgs });
  if (msgCache.size > 4) msgCache.delete(msgCache.keys().next().value);
  return msgs;
}
async function readSessionMessages(file) {
  const items = []; // newest first: { user: text } or { texts, tools } (one assistant line)
  let begun = 0, fh;
  const take = (bytes) => { // one line; true once enough messages have begun
    let e; try { e = JSON.parse(bytes.toString("utf8")); } catch { return false; }
    if ((e.type !== "user" && e.type !== "assistant") || e.isMeta || e.isSidechain) return false;
    const ct = e.message && e.message.content;
    if (e.type === "user") {
      const t = typeof ct === "string" ? ct : Array.isArray(ct) ? ct.filter((b) => b.type === "text").map((b) => b.text).join("\n") : "";
      const s = stripSys(t);
      if (!s) return false; // tool results: part of the assistant's turn
      items.push({ user: s }); begun++;
    } else {
      const it = { texts: [], tools: [] };
      for (const b of Array.isArray(ct) ? ct : []) {
        if (b.type === "text" && b.text) it.texts.push(b.text);
        if (b.type === "tool_use") it.tools.push({ name: b.name, summary: toolSummary(b.name, b.input) });
      }
      if (!items.length || items[items.length - 1].user !== undefined) begun++; // the last line of an assistant message
      items.push(it);
    }
    return begun > MSG_KEEP;
  };
  try {
    fh = await fsp.open(file, "r");
    // rest: the start of the line being read (older chunks come later and go in front); a line is whole at its "\n".
    let pos = (await fh.stat()).size, rest = [], done = false;
    while (pos > 0 && !done) {
      const n = Math.min(TAIL_CHUNK, pos), chunk = Buffer.allocUnsafe(n);
      pos -= n;
      for (let got = 0; got < n;) { const { bytesRead: r } = await fh.read(chunk, got, n - got, pos + got); if (!r) throw Object.assign(new Error("short read"), { code: "EIO" }); got += r; }
      let end = n;
      for (let i = end ? chunk.lastIndexOf(10, end - 1) : -1; i >= 0 && !done; i = end ? chunk.lastIndexOf(10, end - 1) : -1) {
        done = take(rest.length ? Buffer.concat([chunk.subarray(i + 1, end), ...rest]) : chunk.subarray(i + 1, end)); rest = []; end = i;
      }
      if (end) rest.unshift(chunk.subarray(0, end));
    }
    if (!done && rest.length) take(Buffer.concat(rest)); // the file's first line
  } catch (e) { if (e && e.code) return []; throw e; } // an unreadable file shows no messages, as before
  finally { if (fh) try { await fh.close(); } catch {} }
  const msgs = [];
  for (const it of items.reverse()) {
    if (it.user !== undefined) { msgs.push({ role: "user", text: it.user }); continue; }
    let last = msgs[msgs.length - 1];
    if (!last || last.role !== "assistant") { last = { role: "assistant", text: "", tools: [] }; msgs.push(last); }
    for (const t of it.texts) last.text += (last.text ? "\n\n" : "") + t;
    for (const t of it.tools) last.tools.push(t);
  }
  return msgs.slice(-MSG_KEEP);
}

/* ---------- memory, skills, stats ---------- */
function parseFront(src) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(src || "");
  if (!m) return { meta: {}, body: src || "" };
  const meta = {};
  for (const l of m[1].split(/\r?\n/)) {
    const kv = /^\s*([A-Za-z_]+):\s*(.*)$/.exec(l);
    if (kv && kv[2] !== "") meta[kv[1]] = kv[2].replace(/^["']|["']$/g, "").replace(/\\"/g, '"');
  }
  return { meta, body: m[2].trim() };
}
function memories() {
  const dir = path.join(BRAIN, "memory");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "MEMORY.md").map((f) => {
    const { meta, body } = parseFront(read(path.join(dir, f)));
    return { file: f, name: meta.name || f.replace(/\.md$/, ""), description: meta.description || "", type: meta.type || "note", origin: meta.originSessionId || "", modified: meta.modified || fs.statSync(path.join(dir, f)).mtime.toISOString(), body };
  }).sort((a, b) => String(b.modified).localeCompare(String(a.modified)));
}
function skills() {
  if (!fs.existsSync(SKILLS)) return [];
  return fs.readdirSync(SKILLS).map((d) => {
    const src = read(path.join(SKILLS, d, "SKILL.md"));
    if (!src) return null;
    const { meta, body } = parseFront(src);
    return { name: meta.name || d, description: meta.description || "", body };
  }).filter(Boolean);
}
function lessons() {
  const out = [];
  const add = (title, file) => { const t = read(file); if (t) out.push({ title, file, text: t }); };
  add("Blender lessons", path.join(BRAIN, "blender", "LESSONS.md"));
  const k = path.join(BRAIN, "knowledge");
  if (fs.existsSync(k)) for (const f of fs.readdirSync(k).filter((f) => f.endsWith(".md"))) add(f.replace(/\.md$/, ""), path.join(k, f));
  return out;
}
function stats() {
  const ls = lessons().reduce((n, l) => n + (l.text.match(/^- /gm) || []).length, 0);
  return { memories: memories().length, skills: skills().length, sessions: listTranscripts().length, lessons: ls };
}

/* ---------- running Claude ---------- */
const runs = new Map();
function cleanEnv() { const e = { ...process.env }; for (const k of Object.keys(e)) if (/^CLAUDE_?CODE|^CLAUDECODE/.test(k)) delete e[k]; return e; }
const MODES = { read: "default", edit: "acceptEdits", full: "bypassPermissions" };
// The user's rule: every Claude run the app starts (chats, Training, Working, background jobs) runs its commands through
// the PowerShell tool, never Bash. Tested with Claude Code 2.1.296: with Bash disallowed, a run still uses PowerShell,
// including Training's allowed `PowerShell(python ...\tools\watch_video.py *)`.
const NO_BASH = ["Bash"];

// Background agents (council, librarian, refiner, clarifier...) for the Activity tab.
const jobs = new Map();
const JOB_LABEL = [[/^You are the [A-Z][A-Z ]* on an idea council/, "Council member"], [/^You are the JUDGE/, "Judge"], [/^You are the LIBRARIAN/, "Librarian"], [/^You are the ORGANIZER/, "Organizer"],
  [/^You are the PROMPT REFINER/, "Refiner"], [/^You are the PROMPT LIBRARIAN/, "Prompt librarian"], [/^You are the CLARIFIER/, "Clarifier"], [/^You are a message relay/, "Link relay"],
  [/^You are the TRAINER/, "Trainer"], [/^You are the FOREMAN/, "Foreman"], [/^You are the INVENTOR/, "Inventor"], [/^You are the TRIMMER/, "Trimmer"], [/^You are the SKILLSMITH/, "Skillsmith"], [/^You are the SKILL REVIEWER/, "Skill reviewer"]];
JOB_LABEL.push([/^You are the TASTE CRITIC/, "Taste critic"], [/^You are the TASTE CURATOR/, "Taste curator"]); // taste.js (it passes its own `job` for the panel)
// Live activity panel (jobs.js): the spawn paths report job start, output and end here. Not the `jobs` Map above (Activity tab).
// Helpers whose prompt label is listed are tracked automatically by runClaude; the council passes `job` itself.
const TRACK_LABEL = { Trainer: { kind: "plan", name: "Trainer: planning the next round", icon: "trainer" }, Foreman: { kind: "plan", name: "Foreman: planning the next round", icon: "foreman" },
  Librarian: { kind: "librarian", name: "Librarian: tidying the library", icon: "librarian" }, Organizer: { kind: "organizer", name: "Organizer: organizing the folders", icon: "organizer" },
  "Prompt librarian": { kind: "prompt-librarian", name: "Prompt librarian: cleaning the prompt library", icon: "refiner" },
  Trimmer: { kind: "trimmer", name: "Trimmer: trimming the notes", icon: "librarian" },
  Skillsmith: { kind: "skillsmith", name: "Skillsmith: looking for skills in the lessons", icon: "librarian" },
  "Skill reviewer": { kind: "skillsmith", name: "Skill reviewer: grading a proposed skill", icon: "judge" } };
// Jobs that don't count as busy for restarts: quick read-only helpers, the council (counted by council.js), and the
// Trainer/Foreman planners (a killed plan is simply made again; counting them could keep a restart from ever finding a gap).
const QUICK_JOBS = new Set(["Council member", "Judge", "Refiner", "Clarifier", "Link relay", "Inventor", "Trainer", "Foreman", "Taste critic", "Skill reviewer"]);
const track = {}; // filled in by jobs.js
const trkErr = {}; // fn -> { at, n }: a bug in jobs.js logs once a minute per function, not once per stdout line
function trk(fn, ...a) {
  try { return typeof track[fn] === "function" ? track[fn](...a) : null; }
  catch (e) {
    const s = trkErr[fn] || (trkErr[fn] = { at: 0, n: 0 }); s.n++;
    if (Date.now() - s.at >= 60000) { console.error(new Date().toISOString(), "jobs:", fn, e && e.message || e, s.n > 1 ? `(${s.n} errors)` : ""); s.at = Date.now(); s.n = 0; }
    return null;
  }
}
// Starts `claude -p` and calls onEvent for each stream-json event. Returns the run id.
// lean (helpers: Clarifier, Refiner, Inventor, council seats, Lite jobs): start Claude Code with only the given tools
// (default Read,Grep,Glob) and none of the user's MCP servers, skills, hooks or settings (~6-8k tokens to start instead
// of ~32k). The recall hook doesn't run then, so hiveContext() goes in as --append-system-prompt: INDEX.md's Projects
// and About-the-user sections plus the whole memory index. It's the same text for every helper until the notes change,
// so the 1-hour prompt cache reuses it across helper runs (cheaper than putting it in each prompt).
let hiveCtx = { key: "", text: "" };
function hiveContext() {
  const files = [path.join(BRAIN, "INDEX.md"), path.join(BRAIN, "memory", "MEMORY.md")];
  const key = files.map((f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } }).join("|");
  if (key === hiveCtx.key) return hiveCtx.text;
  const index = read(files[0]) || "", mem = (read(files[1]) || "").trim();
  const section = (name) => { const m = new RegExp(`^## ${name}[^\\n]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m").exec(index); return m ? m[1].trim() : ""; };
  const cap = (t, n) => (t.length > n ? t.slice(0, t.lastIndexOf("\n", n) > 0 ? t.lastIndexOf("\n", n) : n) + "\n…" : t);
  const parts = [`You are helping inside the user's ${NAME} app. What the hive knows (brain folder ${BRAIN}; open a file with Read if it matters):`];
  const projects = section("Projects"), user = section("About the user");
  if (projects) parts.push("## Projects\n" + cap(projects, 4000));
  if (user) parts.push("## About the user\n" + cap(user, 1500));
  if (mem) parts.push(`## Memory index (files in ${path.join(BRAIN, "memory")})\n` + cap(mem, 8000));
  hiveCtx = { key, text: parts.join("\n\n") };
  return hiveCtx.text;
}
// tools: the built-in tools to allow ("" = none); left out, lean runs get Read,Grep,Glob (or the lean string) and other
// runs every tool. (lean:"" is falsy and turns lean off, so tools:"" is how a lean run asks for no tools.)
// mcp:false starts none of the user's MCP servers (for full-edition helpers that never use them, like council seats).
// tools always comes with --strict-mcp-config: limiting the built-in tools while MCP servers load drops ToolSearch, so
// every MCP tool schema gets inlined (measured 35-42k tokens a run).
// onEnd is called exactly once (a failed spawn fires 'error' and then 'close').
function runClaude({ prompt, cwd, resume, mode = "edit", maxTurns, model, addDirs = [], lean, tools, mcp, job, onEvent, onEnd }) {
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--permission-mode", MODES[mode] || "acceptEdits"];
  const toolList = tools !== undefined ? String(tools) : lean ? (typeof lean === "string" ? lean : "Read,Grep,Glob") : null;
  if (lean) { args.push("--strict-mcp-config", "--disable-slash-commands", "--setting-sources", ""); const hc = hiveContext(); if (hc) args.push("--append-system-prompt", hc); }
  else if (mcp === false || toolList !== null) args.push("--strict-mcp-config");
  if (toolList !== null) args.push("--tools", toolList);
  if (resume) args.push("--resume", resume);
  if (maxTurns) args.push("--max-turns", String(maxTurns));
  if (model) args.push("--model", model);
  for (const d of addDirs) if (fs.existsSync(d)) args.push("--add-dir", d);
  args.push("--disallowedTools", ...NO_BASH); // commands go through PowerShell (NO_BASH)
  const dir = cwd && fs.existsSync(cwd) ? cwd : BRAIN;
  const child = spawn(CLAUDE, args, { cwd: dir, env: cleanEnv(), windowsHide: true });
  const id = crypto.randomUUID();
  runs.set(id, child);
  const label = (JOB_LABEL.find(([re]) => re.test(prompt || "")) || [null, "Background agent"])[1];
  // edits: a job that changes files counts as busy, so restarts and Quit wait for it (activeRuns). Short read-only helpers
  // and the council (council.js has its own busy()) don't.
  jobs.set(id, { id, label, started: Date.now(), edits: !QUICK_JOBS.has(label) });
  const tj = job || TRACK_LABEL[label];
  if (tj) trk("begin", { ...tj, id, started: Date.now() });
  broadcast({ t: "runs" });
  const done = (code, err) => { runs.delete(id); jobs.delete(id); broadcast({ t: "runs" }); if (tj) trk("end", id, { code, err }); };
  let buf = "", errText = "";
  child.stdout.on("data", (d) => {
    buf += d.toString("utf8");
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let ev; try { ev = JSON.parse(line); } catch { continue; }
      if (tj) trk("line", id, ev);
      try { onEvent(ev); } catch {}
    }
  });
  child.stderr.on("data", (d) => (errText += d.toString("utf8")));
  let ended = false;
  const end = (code, why) => { if (ended) return; ended = true; done(code, why); onEnd && onEnd(code, why); };
  child.on("close", (code) => end(code, errText.slice(-2000)));
  child.on("error", (e) => end(-1, String(e)));
  child.stdin.on("error", () => {}); // a child that exits (or never starts) before reading: EPIPE here, not an uncaught error
  child.stdin.end(prompt);
  return id;
}
// why (for the activity panel): "user", "skip", "cap" or "timeout"; anything else shows as "Stopped by The Wise Hive".
function stopRun(id, why) {
  const c = runs.get(id);
  if (!c) return false;
  trk("stopping", id, why);
  execFile("taskkill", ["/PID", String(c.pid), "/T", "/F"], () => {});
  return true;
}
// Turns raw stream-json events into the small set the page renders.
function simplify(ev) {
  if (ev.type === "system" && ev.subtype === "init") return { t: "session", id: ev.session_id };
  if (ev.type === "stream_event" && ev.event && ev.event.type === "content_block_delta" && ev.event.delta && ev.event.delta.type === "text_delta") return { t: "delta", text: ev.event.delta.text };
  if (ev.type === "assistant" && ev.message) {
    const tools = (ev.message.content || []).filter((b) => b.type === "tool_use").map((b) => ({ name: b.name, summary: toolSummary(b.name, b.input), agent: b.name === "Agent" || b.name === "Task" ? (b.input && (b.input.description || b.input.subagent_type)) || "" : "" }));
    if (tools.length) return { t: "tools", tools };
    return null;
  }
  if (ev.type === "result") return { t: "result", text: ev.result || "", id: ev.session_id, error: ev.is_error || NOT_LOGGED_IN.test(ev.result || ""), cost: ev.total_cost_usd };
  return null;
}
// Runs Claude to completion and resolves with its final text. opts.onRun(id) receives the run id (stopRun(id) kills it).
function askClaude(opts) {
  return new Promise((done) => {
    let acc = "", out = null, error = false;
    const id = runClaude({ ...opts,
      onEvent: (ev) => { const s = simplify(ev); if (!s) return; if (s.t === "delta") acc += s.text; if (s.t === "result") { out = s.text || acc; error = s.error; } },
      onEnd: (code, err) => done({ text: out ?? acc, error: error || (out == null && !acc), err }) });
    if (typeof opts.onRun === "function") { try { opts.onRun(id); } catch {} }
  });
}
// Streams a long-running brain job (librarian, organizer, prompt cleanup) to the page.
function streamJob(res, opts, after) {
  const send = sse(res);
  const run = runClaude({ cwd: BRAIN, mode: "edit", ...opts, onEvent: (ev) => { const s = simplify(ev); if (s) send(s); },
    onEnd: (code, err) => { after && after(code); send({ t: "end", code, err: code ? err : "" }); res.end(); } });
  send({ t: "run", run });
}
function sse(res) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  return (obj) => res.write("data: " + JSON.stringify(obj) + "\n\n");
}

/* ---------- live chats ---------- */
// Chats run Claude Code over its two-way stream-json channel, like the desktop app: permission prompts and
// AskUserQuestion come back here for the user to answer, more messages can be sent mid-run, and runs keep
// going (and can be re-attached) when the window is closed.
const live = new Map(); // run id -> run
// Extra system-prompt lines every user chat gets; feature modules push strings here (media.js: "paths you mention are shown").
const chatHints = [];
const UPLOADS = path.join(BRAIN, "uploads");
const WAIT_MS = 15 * 60 * 1000; // how long a permission prompt or question waits before Claude carries on
const AWAY = "No answer: the user may be away. Use your best judgment, say what you assumed, and carry on.";
const IMG = /^image\/(png|jpeg|gif|webp)$/;
function saveUpload(a) {
  const dir = path.join(UPLOADS, new Date().toISOString().slice(0, 10));
  fs.mkdirSync(dir, { recursive: true });
  const name = String(a.name || "file").replace(/[^\w.\- ]+/g, "_").slice(-80) || "file";
  let f = path.join(dir, name), n = 1;
  while (fs.existsSync(f)) f = path.join(dir, name.replace(/(\.[^.]*)?$/, `-${n++}$1`));
  fs.writeFileSync(f, Buffer.from(String(a.data || ""), "base64"));
  return f;
}
// Builds a stream-json user message: text, plus images inline and other files as saved paths.
function userContent(text, attachments = []) {
  const blocks = [], paths = [];
  for (const a of attachments.slice(0, 10)) {
    const file = saveUpload(a);
    if (IMG.test(a.type || "")) blocks.push({ type: "image", source: { type: "base64", media_type: a.type, data: a.data } });
    paths.push(file);
  }
  const t = paths.length ? `${text}\n\nAttached files (saved on disk):\n${paths.map((p) => "- " + p).join("\n")}` : text;
  return [{ type: "text", text: t }, ...blocks];
}
function toolDetail(name, inp = {}) {
  const cut = (s, n = 3000) => (s == null ? undefined : String(s).slice(0, n));
  if (name === "Edit") return { file: inp.file_path, old: cut(inp.old_string), new: cut(inp.new_string) };
  if (name === "MultiEdit") return { file: inp.file_path, edits: (inp.edits || []).slice(0, 8).map((e) => ({ old: cut(e.old_string, 1500), new: cut(e.new_string, 1500) })) };
  if (name === "Write") return { file: inp.file_path, new: cut(inp.content) };
  if (name === "Bash" || name === "PowerShell") return { cmd: cut(inp.command, 1500) };
  if (name === "TodoWrite") {
    let todos = inp.todos;
    if (typeof todos === "string") { try { todos = JSON.parse(todos); } catch { todos = []; } }
    return { todos: (Array.isArray(todos) ? todos : []).slice(0, 30).map((t) => ({ text: (t && (t.content || t.activeForm)) || String(t || ""), status: t && t.status })) };
  }
  return undefined;
}
function emit(run, obj) {
  // n counts every event of the run, so it keeps growing after old events are dropped below (the page skips n it has seen).
  obj.n = run.nextN || 0;
  run.nextN = obj.n + 1;
  run.events.push(obj);
  if (run.events.length > 8000) run.events.splice(0, 1000);
  for (const res of run.subs) { try { res.write("data: " + JSON.stringify(obj) + "\n\n"); } catch {} }
}
const globalSubs = new Set();
function broadcast(obj) {
  for (const res of globalSubs) { try { res.write("data: " + JSON.stringify(obj) + "\n\n"); } catch {} }
  hub.emit("event", obj); // the Electron shell watches these (e.g. keeps the PC awake while Training/Working run)
}
function notify(n) { hub.emit("notify", n); broadcast({ t: "notify", ...n }); }
// Writes after stdin.end() (the turn's result arrived) would raise ERR_STREAM_WRITE_AFTER_END: skip them.
function control(run, response) { try { if (!run.child.stdin.writableEnded) run.child.stdin.write(JSON.stringify({ type: "control_response", response }) + "\n"); } catch {} }
function answerRequest(run, req, { decision, answers, message, always }) {
  const p = run.pending.get(req);
  if (!p) return false;
  clearTimeout(p.timer); run.pending.delete(req);
  trk("waiting", run.id, run.pending.size);
  let r;
  if (p.kind === "ask") r = { behavior: "allow", updatedInput: { ...p.input, answers: answers || {} } };
  else if (decision === "allow") r = { behavior: "allow", updatedInput: p.input, ...(always && p.suggestions ? { updatedPermissions: p.suggestions } : {}) };
  else r = { behavior: "deny", message: message || "The user denied this in The Wise Hive app. Don't retry it; find another way or ask." };
  control(run, { subtype: "success", request_id: req, response: r });
  emit(run, { t: "answered", req, decision: p.kind === "ask" ? "answered" : decision, answers, always: !!always });
  broadcast({ t: "runs" });
  return true;
}
// Extra options for unattended runs (Training, Working, Updates):
//   allowedTools: tools that run without asking (e.g. ["WebSearch","WebFetch","mcp__blender"]),
//   autoDeny: deny anything else at once and answer AskUserQuestion with "user is away" (nobody is there to wait for),
//   maxTurns, addDirs, appendSystemPrompt, kind (a label for the Activity tab, e.g. "training").
// The note a "team" send adds to the prompt. team === "cheap" (the chat's "Team of cheaper helpers"): delegate parts to
// subagents on the cheapest model that can do them (the Agent tool's model parameter), keep planning and the final
// check, and don't delegate small tasks (a subagent restarts with its own context, so that costs more than it saves).
function teamNote(team) {
  if (team === "cheap") return "(Cheaper helpers mode, to save the user's usage: where the work splits well, hand parts of it to subagents with the Agent tool and set each subagent's model to the cheapest one that can do that part well: \"haiku\" for searching, reading, listing and summarizing; \"sonnet\" for writing or changing code and most building; \"opus\" only for a part that is genuinely hard. Keep the planning, the decisions and the final check yourself. Don't start subagents for small tasks you can finish in a few steps, because each one costs more than it saves there. Give each a short description naming its role.)";
  return "(Team mode: split this work across subagents with the Agent tool. Use one to research, one to build, and one to critique the result before you answer. Give each a short description naming its role.)";
}
function startChat({ prompt, cwd, resume, mode = "edit", team, model, effort, chrome, attachments, title, from, allowedTools, autoDeny, maxTurns, addDirs, appendSystemPrompt, kind, env, disallowedTools, agents, lean }) {
  // --replay-user-messages echoes each message when Claude actually reads it, so we know when nothing is left to read.
  const args = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--replay-user-messages", "--permission-prompt-tool", "stdio", "--permission-mode", MODES[mode] || "acceptEdits"];
  // lean: the same small start as runClaude's helpers (only the given tools, default Read,Grep,Glob; no MCP servers,
  // skills, hooks or settings; the hive context as system prompt instead of the recall hook). Lite's Obsidian answers.
  if (lean) args.push("--strict-mcp-config", "--disable-slash-commands", "--setting-sources", "", "--tools", typeof lean === "string" ? lean : "Read,Grep,Glob");
  if (resume) args.push("--resume", resume);
  if (model) args.push("--model", model);
  if (effort) args.push("--effort", effort);
  if (chrome) args.push("--chrome");
  if (maxTurns) args.push("--max-turns", String(maxTurns));
  for (const d of addDirs || []) if (d && fs.existsSync(d)) args.push("--add-dir", d);
  if (allowedTools && allowedTools.length) args.push("--allowedTools", ...allowedTools);
  // disallowedTools: tools this run may not use at all, whatever the mode (unattended rounds: no wake-ups or cron jobs).
  // Every run the app starts uses PowerShell for commands, never Bash (the user's rule): see NO_BASH.
  args.push("--disallowedTools", ...new Set([...NO_BASH, ...(disallowedTools || [])]));
  // agents: custom subagent types for this run ({name: {description, prompt, tools}}), e.g. Lite rounds' cheap reviewer.
  if (agents && typeof agents === "object" && Object.keys(agents).length) args.push("--agents", JSON.stringify(agents));
  // User chats (not unattended runs or the sketch reader) also get the feature modules' hints.
  const sys = [appendSystemPrompt, lean ? hiveContext() : "", ...((kind || "chat") === "chat" && !autoDeny ? chatHints : [])].filter(Boolean).join("\n\n");
  if (sys) args.push("--append-system-prompt", sys);
  const dir = cwd && fs.existsSync(cwd) ? cwd : BRAIN;
  // env: a git commit identity for this run only (Working passes one), or TEAMWRIGHT_RECALL (Training: full Blender
  // lessons from tools\recall.js). Only those keys: /api/chat hands its body straight in.
  const gitWho = Object.fromEntries(Object.entries(env && typeof env === "object" ? env : {}).filter(([k, v]) => (/^GIT_(AUTHOR|COMMITTER)_(NAME|EMAIL)$/.test(k) || k === "TEAMWRIGHT_RECALL") && typeof v === "string" && v));
  const child = spawn(CLAUDE, args, { cwd: dir, env: { ...cleanEnv(), ...gitWho }, windowsHide: true });
  const run = { id: crypto.randomUUID(), child, chatId: resume || null, cwd: dir, mode, title: String(title || prompt || "").replace(/\s+/g, " ").slice(0, 90), from: from || "app",
    autoDeny: !!autoDeny, kind: kind || "chat",
    events: [], subs: new Set(), pending: new Map(), unread: new Set(), done: false, started: Date.now() };
  live.set(run.id, run);
  runs.set(run.id, child); // so the old stopRun fallback can kill it too
  trk("begin", { id: run.id, kind: run.kind, name: run.title, started: run.started, from: run.from });
  emit(run, { t: "run", run: run.id });
  let buf = "", errText = "";
  child.stdin.on("error", () => {}); // EPIPE when Claude exits mid-write: not an uncaught error
  const send = (o) => { try { if (!child.stdin.writableEnded) child.stdin.write(JSON.stringify(o) + "\n"); } catch {} };
  run.push = (text, atts) => {
    const uuid = crypto.randomUUID();
    run.unread.add(uuid);
    send({ type: "user", uuid, message: { role: "user", content: userContent(text, atts) }, parent_tool_use_id: null });
  };
  child.stdout.on("data", (d) => {
    buf += d.toString("utf8");
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let ev; try { ev = JSON.parse(line); } catch { continue; }
      trk("line", run.id, ev); // subagents, chat id, tools, result, last output (jobs.js)
      // Feature modules may read every raw event of a chat (media.js: pictures and files to show). Listeners must be quick.
      try { hub.emit("chat-line", run, ev); } catch (e) { console.error(new Date().toISOString(), "chat-line listener:", e && e.stack || e); }
      try { handleEvent(ev); } catch (e) { console.error(new Date().toISOString(), "chat event error:", e && e.stack || e); }
    }
  });
  function handleEvent(ev) {
    if (ev.type === "control_request") return onControl(run, ev);
    if (ev.type === "control_response") return;
    if (ev.type === "user") { if (ev.uuid) run.unread.delete(ev.uuid); return; }
    // Sent after each API turn: how full the plan's usage windows are. usage.js keeps the meter fresh from these for free.
    if (ev.type === "rate_limit_event") { run.rateLimit = ev.rate_limit_info || null; if (run.rateLimit) hub.emit("ratelimit", run.rateLimit, run.id); return; }
    if (ev.type === "system" && ev.subtype === "init") { run.chatId = ev.session_id; return emit(run, { t: "session", id: ev.session_id }); }
    if (ev.type === "stream_event" && ev.event && ev.event.type === "content_block_delta" && ev.event.delta) {
      const dl = ev.event.delta;
      if (dl.type === "text_delta") emit(run, { t: "delta", text: dl.text });
      else if (dl.type === "thinking_delta" && dl.thinking) emit(run, { t: "think", text: dl.thinking });
      return;
    }
    if (ev.type === "assistant" && ev.message && !ev.parent_tool_use_id) {
      const tools = (ev.message.content || []).filter((b) => b.type === "tool_use").map((b) => ({ id: b.id, name: b.name, summary: toolSummary(b.name, b.input), detail: toolDetail(b.name, b.input),
        agent: b.name === "Agent" || b.name === "Task" ? (b.input && (b.input.description || b.input.subagent_type)) || "" : "" }));
      if (tools.length) emit(run, { t: "tools", tools });
      return;
    }
    if (ev.type === "result") {
      if (ev.session_id) run.chatId = ev.session_id;
      if (typeof ev.total_cost_usd === "number") run.cost = ev.total_cost_usd;
      emit(run, { t: "result", text: ev.result || "", id: ev.session_id, error: ev.is_error || NOT_LOGGED_IN.test(ev.result || ""), cost: ev.total_cost_usd });
      if (run.unread.size === 0) { try { child.stdin.end(); } catch {} }
    }
  }
  child.stderr.on("data", (d) => (errText += d.toString("utf8")));
  const finish = (code, err) => {
    if (run.done) return;
    run.done = true; run.ended = Date.now(); run.code = code; runs.delete(run.id);
    for (const [req, p] of run.pending) clearTimeout(p.timer);
    run.pending.clear();
    emit(run, { t: "end", code, err: code ? err : "" });
    for (const res of run.subs) { try { res.end(); } catch {} }
    run.subs.clear();
    broadcast({ t: "runs" });
    trk("end", run.id, { code, err }); // after run.done and the runs broadcast, so /api/runs is final first
    if (run.onDone) { try { run.onDone(); } catch (e) { console.error("onDone:", e); } }
    else notify({ title: code ? "Claude stopped" : "Claude finished", body: run.title, chat: run.chatId });
    setTimeout(() => live.delete(run.id), 30 * 60 * 1000);
  };
  child.on("close", (code) => finish(code, errText.slice(-2000)));
  child.on("error", (e) => finish(-1, String(e)));
  send({ type: "control_request", request_id: "init-" + run.id, request: { subtype: "initialize" } });
  run.push(team ? `${prompt}\n\n${teamNote(team)}` : prompt, attachments);
  broadcast({ t: "runs" });
  return run;
}
function onControl(run, ev) {
  const r = ev.request || {}, req = ev.request_id;
  if (r.subtype !== "can_use_tool") { control(run, { subtype: "success", request_id: req, response: {} }); return; }
  const ask = r.tool_name === "AskUserQuestion";
  if (!ask && run.mode === "read") {
    control(run, { subtype: "success", request_id: req, response: { behavior: "deny", message: "This chat is read-only; the user didn't allow changes." } });
    return;
  }
  // Unattended runs: nobody is there to approve, so don't wait 15 minutes.
  if (run.autoDeny) {
    if (ask) control(run, { subtype: "success", request_id: req, response: { behavior: "allow", updatedInput: { ...(r.input || {}), answers: Object.fromEntries(((r.input || {}).questions || []).map((q) => [q.question, AWAY])) } } });
    else control(run, { subtype: "success", request_id: req, response: { behavior: "deny", message: `${r.display_name || r.tool_name} isn't allowed in this unattended run (only the tools this mode allows run without the user). Do the task another way, or note what you'd need and move on.` } });
    emit(run, { t: "autodenied", tool: r.display_name || r.tool_name, ask });
    return;
  }
  const p = { kind: ask ? "ask" : "perm", tool: r.tool_name, input: r.input || {}, suggestions: r.permission_suggestions };
  p.timer = setTimeout(() => {
    if (ask) answerRequest(run, req, { answers: Object.fromEntries((p.input.questions || []).map((q) => [q.question, AWAY])) });
    else answerRequest(run, req, { decision: "deny", message: AWAY + " (This step needed permission and wasn't approved, so skip it and say what you skipped.)" });
  }, WAIT_MS);
  run.pending.set(req, p);
  trk("waiting", run.id, run.pending.size);
  emit(run, ask ? { t: "ask", req, questions: p.input.questions || [] }
    : { t: "perm", req, tool: r.display_name || r.tool_name, summary: toolSummary(r.tool_name, p.input) || r.description || "", detail: toolDetail(r.tool_name, p.input) || { input: JSON.stringify(p.input).slice(0, 1500) }, canAlways: !!(p.suggestions && p.suggestions.length) });
  broadcast({ t: "runs" });
  notify({ title: ask ? "Claude has a question" : `Claude wants to use ${r.display_name || r.tool_name}`, body: run.title, chat: run.chatId });
}
function stopChat(run, why) {
  if (run.done) return;
  trk("stopping", run.id, why);
  try { if (!run.child.stdin.writableEnded) run.child.stdin.write(JSON.stringify({ type: "control_request", request_id: "int-" + Date.now(), request: { subtype: "interrupt" } }) + "\n"); } catch {}
  setTimeout(() => { if (!run.done) execFile("taskkill", ["/PID", String(run.child.pid), "/T", "/F"], () => {}); }, 4000);
}
function subscribe(res, run, from = 0) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  for (const e of run.events) if (e.n >= from) res.write("data: " + JSON.stringify(e) + "\n\n");
  if (run.done) return res.end();
  run.subs.add(res);
  res.on("close", () => run.subs.delete(res));
}
const runInfo = (r) => ({ id: r.id, chatId: r.chatId, title: r.title, cwd: r.cwd, done: r.done, from: r.from, kind: r.kind, started: r.started, ended: r.ended, code: r.code, cost: r.cost, mode: r.mode, events: r.nextN || 0,
  pending: [...r.pending.entries()].map(([req, p]) => ({ req, kind: p.kind, tool: p.tool, summary: p.kind === "ask" ? ((p.input.questions || [])[0] || {}).question || "" : toolSummary(p.tool, p.input) })) });

/* ---------- sketch reader (Sketch tab) ---------- */
// The user draws an idea; Claude looks at the image and says what it sees and what it thinks is meant.
const SKETCHES = path.join(BRAIN, "sketches");
const SKETCH_FILE = /^[\w-]{1,80}\.png$/;
const sketchPrompt = (note) => `You are the SKETCH READER of The Wise Hive app. The user drew the attached image on a whiteboard to show Claude an idea they find easier to draw than to describe. Do not use tools.

Answer in markdown with exactly these sections:
## What I see
Literally what is drawn: shapes, lines, arrows, labels and text, colors, and how things are laid out relative to each other.
## What I think it shows
Your best reading of the idea: what it is (for example a game map, a UI layout, a 3D model concept, a flow or system diagram), what the parts represent, and how they connect. Use what you know about the user's projects from your recall context when it fits (they build Roblox games, model in Blender, and use The Wise Hive app).
## Questions
0 to 3 short questions about anything genuinely unclear. Write "None" if it's clear.

Keep it under 250 words.${note ? `\n\nThe user's note about the sketch: ${note}` : ""}`;
function sketchList() {
  if (!fs.existsSync(SKETCHES)) return [];
  return fs.readdirSync(SKETCHES).filter((f) => SKETCH_FILE.test(f)).map((f) => {
    const md = read(path.join(SKETCHES, f.replace(/\.png$/, ".md"))) || "";
    const title = (/^# (.+)$/m.exec(md) || [])[1] || f.replace(/\.png$/, "");
    return { file: f, title, at: fs.statSync(path.join(SKETCHES, f)).mtime.toISOString(), summary: md.replace(/^# .+\n+/, "").replace(/^Note: .*\n+/m, "") };
  }).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 60);
}
function readSketch({ image, note, title, model }) {
  return new Promise((done) => {
    const name = `${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}_${crypto.randomUUID().slice(0, 6)}`;
    fs.mkdirSync(SKETCHES, { recursive: true });
    fs.writeFileSync(path.join(SKETCHES, name + ".png"), Buffer.from(image, "base64"));
    const run = startChat({ prompt: sketchPrompt(String(note || "").slice(0, 1000)), cwd: BRAIN, mode: "read", model: model || "claude-sonnet-5-5", kind: "sketch",
      attachments: [{ name: name + ".png", type: "image/png", data: image }], title: "Sketch reader: " + (title || "untitled sketch") });
    run.onDone = () => {
      const res = [...run.events].reverse().find((e) => e.t === "result");
      const text = res && !res.error ? res.text : "";
      const t = String(title || "").trim() || "Sketch " + new Date().toLocaleString();
      if (text) fs.writeFileSync(path.join(SKETCHES, name + ".md"), `# ${t}\n\n${note ? `Note: ${note}\n\n` : ""}${text}\n`);
      done({ file: name + ".png", title: t, summary: text, error: text ? "" : (res && /log ?in/i.test(res.text) ? "Claude Code isn't signed in." : "Claude couldn't read the sketch. Try again.") });
    };
  });
}

/* ---------- projects and system status (Projects and Settings tabs) ---------- */
async function projectsOverview() {
  // The app's own background agents (council, refiner, relay...) aren't the user's chats.
  const metas = (await sessionMetas()).filter((m) => m && !/^(You are (the [A-Z ]+\b|a message relay)|\[(?:Wise Hive|Teamwright|Hivemind) (training|working|update|brainstorm)\])/.test(m.title)); // old tags too: keep-old-name
  const folders = new Map();
  const add = (dir) => { if (dir && fs.existsSync(dir) && !/scratch-workspaces/i.test(dir) && !folders.has(dir.toLowerCase())) folders.set(dir.toLowerCase(), dir); };
  for (const m of metas) add(m.cwd);
  for (const d of configuredFolders()) add(d);
  add(BRAIN);
  const docs = fs.existsSync(path.join(BRAIN, "projects")) ? fs.readdirSync(path.join(BRAIN, "projects")).filter((f) => f.endsWith(".md")).map((f) => ({ file: f, text: read(path.join(BRAIN, "projects", f)) || "" })) : [];
  return [...folders.values()].map((dir) => {
    const chats = metas.filter((m) => m.cwd && m.cwd.toLowerCase() === dir.toLowerCase()).sort((a, b) => b.updated.localeCompare(a.updated));
    const name = path.basename(dir);
    const doc = docs.find((d) => d.text.toLowerCase().includes(dir.toLowerCase()) || d.file.replace(/\.md$/, "").toLowerCase() === name.toLowerCase());
    return { dir, name, chats: chats.length, last: chats[0] ? chats[0].updated : null, recent: chats.slice(0, 4).map((c) => ({ id: c.id, title: c.title, updated: c.updated })),
      doc: doc ? { file: doc.file, text: doc.text.slice(0, 20000) } : null, claudeMd: fs.existsSync(path.join(dir, "CLAUDE.md")) };
  }).sort((a, b) => String(b.last || "").localeCompare(String(a.last || "")));
}
const started = Date.now();
let mcpCache = { at: 0, text: "" }, versionCache = "", mcpPending = null;
function sh(cmd, args, timeout = 60000) {
  return new Promise((ok) => execFile(cmd, args, { timeout, windowsHide: true, env: cleanEnv() }, (e, out, err) => ok(String(out || "") + String(err || ""))));
}
async function systemStatus(refreshMcp) {
  if (refreshMcp) versionCache = ""; // Refresh also re-reads the version (the CLI may have updated since the first look)
  if (!versionCache) versionCache = (await sh(CLAUDE, ["--version"], 20000)).trim();
  // `claude mcp list` starts every MCP server (up to 90 s): one at a time; callers meanwhile wait for the same one.
  if (refreshMcp || !mcpCache.text) {
    if (!mcpPending) { const at = Date.now(); mcpPending = sh(CLAUDE, ["mcp", "list"], 90000).then((text) => { mcpCache = { at, text }; }).finally(() => { mcpPending = null; }); }
    await mcpPending;
  }
  const mcp = mcpCache.text.split(/\r?\n/).filter((l) => /:\s/.test(l) && /(Connected|Failed|Needs|✔|✘|√)/i.test(l)).map((l) => {
    const name = l.split(":")[0].trim();
    return { name, ok: /Connected|✔|√/.test(l), detail: /Failed|✘/.test(l) ? l.slice(l.search(/✘|Failed/)).trim() : "" };
  });
  const task = await sh("schtasks", ["/Query", "/TN", "Teamwright watchdog", "/FO", "LIST"], 15000);
  const run = await sh("reg", ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", "ClaudeBrain.Teamwright"], 15000);
  const logFile = path.join(__dirname, "server.log");
  let log = "";
  try { const t = read(logFile) || ""; log = t.split(/\r?\n/).filter((l) => l.trim() && !/^\s+at /.test(l)).slice(-60).join("\n"); } catch {}
  return {
    server: { started, pid: process.pid, node: process.versions.node, electron: process.versions.electron || null, runs: [...live.values()].filter((r) => !r.done).length, jobs: jobs.size },
    claude: { version: versionCache, mcp, mcpCheckedAt: mcpCache.at },
    watchdog: { installed: /Teamwright watchdog/.test(task), status: (/Status:\s*(.+)/.exec(task) || [])[1] || "", next: (/Next Run Time:\s*(.+)/.exec(task) || [])[1] || "" },
    autostart: /ClaudeBrain\.Teamwright\s+REG_SZ/.test(run), // the login item keeps the app id's old name: keep-old-name
    userQuitFlag: fs.existsSync(path.join(__dirname, ".user-quit")),
    log,
  };
}

/* ---------- link with the desktop app ---------- */
// Messages between The Wise Hive and a Claude Desktop session. App -> desktop goes through SendMessage (a quick headless
// Claude relays it); desktop -> app arrives at /api/link/inbox (tools\to-app.ps1).
const LINK = path.join(BRAIN, "link");
const LINK_LOG = path.join(LINK, "messages.jsonl");
const LINK_CFG = path.join(LINK, "config.json");
const linkCfg = () => { try { return { target: "Multi-agent idea evaluation system", ...JSON.parse(read(LINK_CFG)) }; } catch { return { target: "Multi-agent idea evaluation system" }; } };
function linkAll() { return (read(LINK_LOG) || "").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
function linkAdd(m) {
  fs.mkdirSync(LINK, { recursive: true });
  const msg = { id: crypto.randomUUID().slice(0, 8), at: new Date().toISOString(), ...m };
  fs.appendFileSync(LINK_LOG, JSON.stringify(msg) + "\n");
  broadcast({ t: "link", msg });
  return msg;
}
function linkUpdate(id, patch) {
  const all = linkAll(), m = all.find((x) => x.id === id);
  if (!m) return;
  Object.assign(m, patch);
  fs.writeFileSync(LINK_LOG, all.map((x) => JSON.stringify(x)).join("\n") + "\n");
  broadcast({ t: "link", msg: m });
}
async function relayToDesktop(msg) {
  const target = linkCfg().target;
  const body = `[From The Wise Hive app${msg.kind === "task" ? ": a task for you" : ""}] ${msg.text}\n\n(Reply to The Wise Hive app with: powershell -NoProfile -File ${path.join(BRAIN, "tools", "to-app.ps1")} -ReplyTo ${msg.id} -Text "<your reply>")`;
  const r = await askClaude({ prompt: `You are a message relay. Use the SendMessage tool exactly once to send the message below, word for word, to the session named "${target}". Do nothing else. Then reply with only SENT, or FAILED: <reason> if it could not be sent.\n\nMESSAGE:\n${body}`, cwd: BRAIN, mode: linkCfg().mode || "full", maxTurns: 3, model: "haiku" });
  // Claude Code holds peer messages for approval when the sender's permission mode differs from the receiver's,
  // so the relay runs in the same mode as the user's desktop sessions (full access by default; link\config.json "mode").
  const ok = /\bSENT\b/.test(r.text || "") && !/FAILED/.test(r.text || "");
  linkUpdate(msg.id, { status: ok ? "sent" : "failed", error: ok ? undefined : String(r.text || r.err || "relay failed").slice(0, 300) });
}

/* ---------- council: see council.js ---------- */

/* ---------- librarian ---------- */
const TIDY = `You are the LIBRARIAN of ${BRAIN}, the long-term memory of Claude for this user. Your job: make sure every Claude agent remembers what was learned and HOW it was learned.

1. Read transcripts\\LOG.md and librarian\\tidied.txt (create it if missing). Pick the sessions in the log whose 8-char id is not in tidied.txt (at most 6, newest first). Skip sessions whose first request starts with "You are the" (those are the app's own agents: council, organizer, prompt refiner, clarifier); just add their ids to tidied.txt.
2. For each, read its file in transcripts\\readable\\. Extract only DURABLE knowledge: project facts and current state, decisions and why, user preferences, techniques that worked, mistakes and their fixes. Skip chit-chat and one-off details.
3. File each item:
   - Facts/preferences/project notes: a memory file in memory\\ using the existing frontmatter format (name, description, metadata: type, originSessionId: <full session id>, modified: <now ISO>). Update an existing file instead of duplicating. Add a line to memory\\MEMORY.md for new files.
   - Blender techniques/mistakes: blender\\LESSONS.md under the right heading, ending with "(learned in session <id8>)".
   - Other techniques: knowledge\\<topic>.md, same "(learned in session <id8>)" suffix.
   - Reusable code that appears in the session and worked: save it under blender\\scripts\\ or roblox\\scripts\\ with a header comment.
4. Fix anything stale or contradicted by newer sessions. Update INDEX.md if you added a project or folder.
5. Append the processed ids (8 chars) to librarian\\tidied.txt.
6. Finish with a short report: what you filed, where, and anything you were unsure about.`;

/* ---------- organizer ---------- */
// The Librarian files NEW knowledge from conversations; the Organizer restructures what is already stored.
const ORGANIZE = `You are the ORGANIZER of ${BRAIN}, the long-term memory of Claude for this user. The Librarian adds new knowledge; your job is to keep what is already stored in the right place, without duplicates, so any Claude finds it fast.

The layout (keep it):
- memory\\ : one fact per file with frontmatter (name, description, metadata: type, originSessionId, modified). memory\\MEMORY.md is the index, one line per file: "- [Title](file.md) — hook". Memory files MUST stay directly in memory\\ (Claude Code only loads them from there), so organize them by name, not by subfolder.
- projects\\<project>.md : current state of each project (what exists, where, what's pending). Memories about a project link to it.
- knowledge\\<topic>.md : general lessons by topic (techniques, mistakes and fixes).
- blender\\ : LESSONS.md, scripts\\, builds\\.   roblox\\ : scripts\\ and notes.
- Skills: ${SKILLS}\\<name>\\SKILL.md (step-by-step workflows Claude follows).
- Do NOT edit: transcripts\\, app\\, council\\, librarian\\, prompts\\, chat-media\\, uploads\\ (other agents and the app own them).

Steps:
1. Inventory every file in memory\\, projects\\, knowledge\\, blender\\, roblox\\ and every SKILL.md. Note what each holds.
2. Misfiled content: a memory that is really a general lesson -> move it into knowledge\\<topic>.md (or blender\\LESSONS.md) and delete the memory file; a lesson in the wrong topic file -> move it; project state scattered across memories -> summarize it in projects\\<project>.md and link the memories with [[name]]; code pasted into notes -> a file under blender\\scripts\\ or roblox\\scripts\\ with a header comment; generic lessons inside a skill -> the lessons file, leaving the skill's steps pointing at it.
3. Duplicates and overlaps: merge into one file, keep the newest correct fact, keep the original originSessionId, set modified to now.
4. Naming: memory names start with their project slug (e.g. mygame-, website-, homework-) or user-/feedback- for general ones; file name = name + ".md". When you rename, update every [[link]], every MEMORY.md and INDEX.md line, and any path in skills that pointed at it.
5. Indexes: rewrite memory\\MEMORY.md so it lists every memory file exactly once, grouped under "## <Project>" headings (plus "## General"). Make INDEX.md match the real folders, projects and skills.
6. Skills: check each SKILL.md's paths still exist and fix them after moves. Never delete a skill or change what it does.

Rules: never lose information; merge or move instead of deleting. Don't invent facts. Before changing anything, append a dated section to organizer\\log.md (create it) and record every change as "moved|merged|renamed|edited: <old path> -> <new path> (why)", so it can be undone.
Finish with a short report: what you moved or merged and why, and anything you left alone because you were unsure.`;

/* ---------- prompt refiner ---------- */
const PROMPTS = path.join(BRAIN, "prompts");
const HISTORY = path.join(PROMPTS, "history.jsonl");
const LIBRARY = path.join(PROMPTS, "library.md");
const CLEANED = path.join(PROMPTS, "cleaned.txt");
const CLEAN_EVERY = LITE ? 40 : 12;
function promptHistory() { return (read(HISTORY) || "").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
const refinePrompt = (text, cwd, context) => `You are the PROMPT REFINER of The Wise Hive app. The user types short, broad prompts; you rewrite each one into a clear, detailed prompt for another Claude agent BEFORE it runs. You do not do the task yourself.

How to refine:
- Keep the user's intent exactly. Do not add features, scope or opinions they did not ask for.
- Make it specific using what the hive knows: the project folder, which game/app it is, relevant memories, conventions (e.g. log every change to the project's ledger), file paths, past decisions. Your recall context lists them; open at most 2 memory or project files if you need detail. Do not run anything else.
- Structure it: Goal (one line), Context (project, files, relevant facts), Requirements (concrete bullets), Constraints (what not to break or change), Done when (how to verify the result). Skip any section that would be empty.
- Where something is genuinely ambiguous, pick the most likely reading and state it as "Assume: ..." rather than asking.
- Reuse: if a template in the prompt library below fits, build the refined prompt from it and name it.
- If the message is already detailed, return it nearly unchanged. If it is a short reply inside an ongoing conversation ("yes", "do 2", "looks good"), return it unchanged.
- Write for Claude, plainly, no filler. Usually under 250 words.

Answer in exactly this format and nothing else:
<refined>
the refined prompt
</refined>
<template>name of the library template you used, or none</template>
<notes>one short line: what you added or assumed</notes>

PROJECT FOLDER: ${cwd || BRAIN}
${context ? `\nRECENT CONVERSATION (for context only):\n${context}\n` : ""}
PROMPT LIBRARY (prompts\\library.md):
${(read(LIBRARY) || "(empty)").slice(0, 12000)}

RECENT REFINEMENTS:
${promptHistory().slice(-8).map((h) => `- "${String(h.original).slice(0, 120)}" -> template: ${h.template || "none"}`).join("\n") || "(none yet)"}

USER PROMPT:
${text}`;
const CLEAN_PROMPTS = `You are the PROMPT LIBRARIAN of The Wise Hive app. prompts\\history.jsonl holds every prompt the user typed ("original") and how the Prompt Refiner rewrote it ("refined"). prompts\\library.md holds reusable templates the Refiner builds from. Keep that library clean and useful.

1. Read prompts\\library.md (create it with a "# Prompt library" title if missing) and prompts\\history.jsonl. Focus on entries newer than the line number in prompts\\cleaned.txt (0 if missing), but use all of it to spot patterns.
2. Find recurring kinds of requests (e.g. "add a feature to a Roblox game", "build a Blender model", "fix a bug", "make a trailer"). For each, keep ONE template:
   ## <short name>
   When: <what kind of prompt it fits>
   Uses: <count of history entries it matched>
   \`\`\`
   Goal: {goal}
   Context: ... (project facts that always apply, with paths)
   Requirements: ...
   Constraints: ...
   Done when: ...
   \`\`\`
   Use {placeholders} for the parts that change. Bake in conventions the user always wants (from the refined prompts and memory\\MEMORY.md).
3. Merge overlapping templates, sharpen vague ones, fix stale paths or facts, delete templates that never got used after 20+ newer prompts. Keep at most 25, most used first.
4. Never edit history.jsonl. Only write prompts\\library.md.
Finish with a short report of templates added, merged, changed or removed.`;
let cleaningPrompts = false;
// A failed run leaves cleaned.txt as it was, so every later refine() would start another 30-turn run: the background
// trigger waits CLEAN_RETRY after a failure (the Clean button still runs at once).
const CLEAN_RETRY = 6 * 3600e3;
let cleanFailedAt = 0;
function cleanPrompts(res) {
  if (cleaningPrompts) { if (res) { const send = sse(res); send({ t: "result", text: "The prompt library is already being cleaned. Try again in a minute." }); send({ t: "end" }); res.end(); } return; }
  cleaningPrompts = true;
  const count = promptHistory().length;
  const after = (code) => { cleaningPrompts = false; if (!code) { cleanFailedAt = 0; fs.writeFileSync(CLEANED, String(count)); } else cleanFailedAt = Date.now(); };
  const lean = LITE ? "Read,Grep,Glob,Edit,Write" : undefined;
  if (res) return streamJob(res, { prompt: CLEAN_PROMPTS, maxTurns: LITE ? 15 : 30, lean }, after);
  askClaude({ prompt: CLEAN_PROMPTS, cwd: BRAIN, mode: "edit", maxTurns: LITE ? 15 : 30, lean }).then((r) => after(r.error ? 1 : 0));
}
async function refine(text, cwd, context) {
  const r = await askClaude({ prompt: refinePrompt(text, cwd, context), cwd: BRAIN, mode: "read", maxTurns: LITE ? 3 : 4, model: "sonnet", lean: true });
  const tag = (t) => { const m = new RegExp(`<${t}>([\\s\\S]*?)</${t}>`).exec(r.text || ""); return m ? m[1].trim() : ""; };
  const refined = tag("refined");
  if (r.error || !refined) return { error: r.error && /log ?in/i.test(r.text || "") ? "Claude Code isn't signed in." : "The refiner didn't return a prompt.", refined: text };
  const template = /^none$/i.test(tag("template")) ? "" : tag("template");
  const notes = tag("notes");
  fs.mkdirSync(PROMPTS, { recursive: true });
  fs.appendFileSync(HISTORY, JSON.stringify({ at: new Date().toISOString(), cwd, original: text, refined, template, notes }) + "\n");
  // Keep the library learning: tidy it in the background every CLEAN_EVERY new prompts.
  if (promptHistory().length - (parseInt(read(CLEANED), 10) || 0) >= CLEAN_EVERY && Date.now() - cleanFailedAt >= CLEAN_RETRY) cleanPrompts();
  return { refined, template, notes, changed: refined.trim() !== text.trim() };
}

/* ---------- clarifier ---------- */
// Runs beside every chat prompt: lists what might be misunderstood, never blocks the main task.
const CLARIFY_DIR = path.join(BRAIN, "clarifier");
const CKEY = /^[\w-]{6,80}$/;
const aliases = {}; // pending-<random> key -> session id, once the chat learns its id
const ckey = (k) => { for (let i = 0; i < 5 && aliases[k]; i++) k = aliases[k]; return k; };
const clarifyFile = (k) => path.join(CLARIFY_DIR, ckey(k) + ".json");
function clarifyLoad(k) { try { return JSON.parse(read(clarifyFile(k))).questions || []; } catch { return []; } }
function clarifySave(k, questions) { fs.mkdirSync(CLARIFY_DIR, { recursive: true }); fs.writeFileSync(clarifyFile(k), JSON.stringify({ questions }, null, 2)); }
const clarifyPrompt = (text, cwd, context) => `You are the CLARIFIER of The Wise Hive app. Another Claude agent is about to do the user's prompt below, right now, without waiting for you. Your only job: spot where that agent could misunderstand it, so the user can correct it later. You do NOT do the task.

How to check:
- Look for misunderstandings, ambiguities and hidden assumptions: unclear references ("it", "the robot", "better"), missing scope, several plausible readings, unstated success criteria.
- Return 0 to 4 questions, most important first. If the prompt is genuinely clear, return an empty list. Never invent questions to fill space. Short replies inside an ongoing conversation ("yes", "do 2") are clear.
- Before asking, check what the hive already knows: you may read ${path.join(BRAIN, "memory", "MEMORY.md")} (and at most one memory file it links). Don't ask what memory or the conversation already answers. Do not edit anything or run commands.
- For each question give:
  "understood": what you took the prompt to mean, one line
  "source": the exact quoted words of the prompt or context that led you there
  "unclear": what is ambiguous, one line
  "assumption": the best guess the main task will proceed on, one line
  "question": one short question the user can answer in a few words

Answer strictly in this format and nothing else:
<questions>[{"understood":"...","source":"...","unclear":"...","assumption":"...","question":"..."}]</questions>

PROJECT FOLDER: ${cwd || BRAIN}
${context ? `\nRECENT CONVERSATION (for context only):\n${context}\n` : ""}
USER PROMPT:
${text}`;
async function clarify(text, cwd, context, key) {
  const r = await askClaude({ prompt: clarifyPrompt(text, cwd, context) + (LITE ? "\n\nLite mode: return at most 2 questions, only where a wrong guess would clearly change the result." : ""),
    cwd: BRAIN, mode: "read", maxTurns: LITE ? 2 : 3, model: LITE ? "haiku" : "sonnet", lean: true });
  if (r.error && !/<questions>/.test(r.text || "")) return { error: /log ?in/i.test(r.text || "") ? "Claude Code isn't signed in." : "The clarifier didn't answer." };
  const m = /<questions>([\s\S]*?)<\/questions>/.exec(r.text || ""), raw = m ? m[1] : r.text || "";
  let list = [];
  try { list = JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1)); } catch {}
  const s = (v) => String(v ?? "").trim().slice(0, 600);
  const at = new Date().toISOString();
  const questions = (Array.isArray(list) ? list : []).filter((q) => q && typeof q === "object" && s(q.question)).slice(0, LITE ? 2 : 4).map((q) => ({
    id: crypto.randomUUID().slice(0, 8), status: "open", at, prompt: String(text).slice(0, 300),
    understood: s(q.understood), source: s(q.source), unclear: s(q.unclear), assumption: s(q.assumption), question: s(q.question) }));
  if (questions.length) clarifySave(key, clarifyLoad(key).concat(questions));
  return { questions };
}

/* ---------- http ---------- */
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
const server = http.createServer(async (req, res) => {
  // DNS rebinding: a web page under another name that points at 127.0.0.1 gets nothing (its same-origin GETs carry no
  // Origin header, so the Origin check below can't catch them). The window, tools and the Obsidian plugin all use 127.0.0.1.
  if (!HOSTS.has(String(req.headers.host || "").toLowerCase())) { res.writeHead(403); return res.end("forbidden"); }
  let url;
  try { url = new URL(req.url, `http://127.0.0.1:${PORT}`); } catch { res.writeHead(400); return res.end("bad request"); }
  const p = url.pathname;
  if (p.startsWith("/api/")) {
    // Only this app may call the API: blocks other web pages from driving Claude through localhost.
    // The Obsidian plugin (app\obsidian-plugin) may call only the /api/obsidian/ routes; a web page can't send Obsidian's origin.
    const origin = req.headers.origin;
    const obsidian = origin === "app://obsidian.md" && p.startsWith("/api/obsidian/");
    if ((origin && !ORIGINS.has(origin) && !obsidian) || req.headers["x-hive"] !== "1") return json(res, 403, { error: "forbidden" });
    try {
      if (p === "/api/stats") return json(res, 200, stats());
      if (p === "/api/memories" && req.method === "GET") return json(res, 200, memories());
      if (p.startsWith("/api/memories/") && req.method === "PUT") {
        const f = path.basename(decodeURIComponent(p.slice(14)));
        const file = path.join(BRAIN, "memory", f);
        const src = read(file); if (src == null) return json(res, 404, { error: "not found" });
        const { text } = await body(req);
        const m = /^(---[\s\S]*?\n---\r?\n?)/.exec(src);
        fs.writeFileSync(file, (m ? m[1] : "") + "\n" + String(text || "").trim() + "\n");
        return json(res, 200, { ok: true });
      }
      if (p === "/api/skills") return json(res, 200, { skills: skills(), lessons: lessons() });
      if (p === "/api/sessions") {
        const list = (await sessionMetas()).sort((a, b) => b.updated.localeCompare(a.updated));
        return json(res, 200, list);
      }
      if (p.startsWith("/api/sessions/")) {
        const f = findTranscript(path.basename(p.slice(14)));
        if (!f) return json(res, 404, { error: "not found" });
        return json(res, 200, { meta: sessionMeta(f), messages: await sessionMessages(f) });
      }
      if (p === "/api/brain") { json(res, 200, { brain: BRAIN, edition: EDITION }); return; }
      if (p === "/api/folders") {
        const set = new Map();
        for (const m of await sessionMetas()) if (m.cwd && m.cwdExists && !/scratch-workspaces/i.test(m.cwd)) set.set(m.cwd.toLowerCase(), m.cwd);
        // Also offer the project folders from app-settings\teamwright.json.
        const extra = configuredFolders();
        for (const d of extra) if (fs.existsSync(d) && fs.statSync(d).isDirectory()) set.set(d.toLowerCase(), d);
        set.set(BRAIN.toLowerCase(), BRAIN);
        return json(res, 200, [...set.values()]);
      }
      if (p === "/api/chat" && req.method === "POST") {
        const o = await body(req);
        if (!String(o.prompt || "").trim() && !(o.attachments || []).length) return json(res, 400, { error: "empty prompt" });
        return subscribe(res, startChat(o), 0);
      }
      if (p === "/api/runs" && req.method === "GET") return json(res, 200, [...live.values()].map(runInfo));
      if (p === "/api/activity" && req.method === "GET") return json(res, 200, { runs: [...live.values()].map(runInfo).sort((a, b) => b.started - a.started), jobs: [...jobs.values()], busy: activeRuns() });
      if (p === "/api/projects" && req.method === "GET") return json(res, 200, await projectsOverview());
      if (p === "/api/sketches" && req.method === "GET") return json(res, 200, sketchList());
      if (p === "/api/sketch" && req.method === "POST") {
        const o = await body(req);
        if (!/^[A-Za-z0-9+/=]{100,}$/.test(String(o.image || ""))) return json(res, 400, { error: "no image" });
        return json(res, 200, await readSketch(o));
      }
      if (p === "/api/system" && req.method === "GET") return json(res, 200, await systemStatus(url.searchParams.get("refresh") === "1"));
      const rm = /^\/api\/runs\/([\w-]+)\/(stream|message|answer|stop)$/.exec(p);
      if (rm && req.method === "POST") {
        const run = live.get(rm[1]);
        if (!run) return json(res, 404, { error: "That run has finished." });
        const o = await body(req);
        if (rm[2] === "stream") return subscribe(res, run, Number(o.from) || 0);
        if (rm[2] === "stop") { stopChat(run, "user"); return json(res, 200, { ok: true }); }
        if (rm[2] === "answer") return json(res, 200, { ok: answerRequest(run, o.req, o) });
        if (run.done || run.child.stdin.writableEnded) return json(res, 409, { error: "Claude already finished this turn." });
        run.push(String(o.text || ""), o.attachments || []);
        emit(run, { t: "user", text: String(o.text || "") });
        return json(res, 200, { ok: true });
      }
      if (p === "/api/events" && req.method === "POST") {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
        res.write("data: " + JSON.stringify({ t: "hello" }) + "\n\n");
        globalSubs.add(res); res.on("close", () => globalSubs.delete(res));
        return;
      }
      if (p === "/api/link" && req.method === "GET") return json(res, 200, { messages: linkAll().slice(-200), config: linkCfg() });
      if (p === "/api/link/config" && req.method === "POST") {
        const { target } = await body(req);
        fs.mkdirSync(LINK, { recursive: true });
        writeFileAtomic(LINK_CFG, JSON.stringify({ ...linkCfg(), target: String(target || "").trim().slice(0, 120) || linkCfg().target }, null, 2));
        return json(res, 200, linkCfg());
      }
      if (p === "/api/link/send" && req.method === "POST") {
        const { text, kind } = await body(req);
        if (!String(text || "").trim()) return json(res, 400, { error: "empty message" });
        const msg = linkAdd({ from: "app", kind: kind === "task" ? "task" : "message", text: String(text).slice(0, 8000), status: "sending" });
        relayToDesktop(msg).catch((e) => linkUpdate(msg.id, { status: "failed", error: String(e) }));
        return json(res, 200, { msg });
      }
      // Desktop Claude -> app (tools\to-app.ps1). A task starts a chat here right away, even with the window closed.
      if (p === "/api/link/inbox" && req.method === "POST") {
        const { text, task, folder, mode, replyTo } = await body(req);
        if (!String(text || "").trim()) return json(res, 400, { error: "empty message" });
        const msg = linkAdd({ from: "desktop", kind: task ? "task" : "message", text: String(text).slice(0, 20000), replyTo: replyTo || undefined });
        if (task) {
          const run = startChat({ prompt: String(text), cwd: folder || BRAIN, mode: ["read", "edit", "full"].includes(mode) ? mode : "edit", title: String(text), from: "desktop" });
          const tick = setInterval(() => { if (run.chatId || run.done) { clearInterval(tick); linkUpdate(msg.id, { run: run.id, chat: run.chatId }); } }, 500);
          notify({ title: "Task from Claude Desktop", body: String(text).slice(0, 120), view: "link" });
          return json(res, 200, { msg, run: run.id });
        }
        notify({ title: "Message from Claude Desktop", body: String(text).slice(0, 120), view: "link" });
        return json(res, 200, { msg });
      }
      if (p === "/api/librarian" && req.method === "POST") {
        fs.mkdirSync(path.join(BRAIN, "librarian"), { recursive: true });
        return streamJob(res, { prompt: TIDY, maxTurns: 80, ...(LITE ? { lean: "Read,Write,Edit,Glob,Grep" } : {}) });
      }
      if (p === "/api/organize" && req.method === "POST") {
        fs.mkdirSync(path.join(BRAIN, "organizer"), { recursive: true });
        return streamJob(res, { prompt: ORGANIZE, maxTurns: 120, addDirs: [SKILLS], ...(LITE ? { lean: "Read,Write,Edit,Glob,Grep" } : {}) });
      }
      if (p === "/api/refine" && req.method === "POST") {
        const { prompt, cwd, context } = await body(req);
        if (!String(prompt || "").trim()) return json(res, 400, { error: "empty prompt" });
        return json(res, 200, await refine(String(prompt), cwd, String(context || "").slice(0, 3000)));
      }
      if (p === "/api/clarify" && req.method === "POST") {
        const { prompt, cwd, context, key } = await body(req);
        if (!String(prompt || "").trim() || !CKEY.test(key || "")) return json(res, 400, { error: "empty prompt or bad key" });
        return json(res, 200, await clarify(String(prompt), cwd, String(context || "").slice(0, 3000), key));
      }
      if (p === "/api/clarify/rekey" && req.method === "POST") {
        const { from, to } = await body(req);
        if (!CKEY.test(from || "") || !CKEY.test(to || "") || from === to || ckey(to) === from) return json(res, 400, { error: "bad key" });
        if (aliases[from]) return json(res, 200, { ok: true, moved: 0 });
        const moved = clarifyLoad(from);
        if (moved.length) { const have = clarifyLoad(to); clarifySave(to, have.concat(moved.filter((q) => !have.some((h) => h.id === q.id)))); }
        try { fs.unlinkSync(clarifyFile(from)); } catch {}
        aliases[from] = to;
        return json(res, 200, { ok: true, moved: moved.length });
      }
      const cm = /^\/api\/clarify\/([^/]+)(?:\/([^/]+))?$/.exec(p);
      if (cm) {
        if (!CKEY.test(cm[1]) || (cm[2] && !/^[\w-]{1,40}$/.test(cm[2]))) return json(res, 400, { error: "bad key" });
        if (!cm[2] && req.method === "GET") return json(res, 200, { questions: clarifyLoad(cm[1]) });
        if (cm[2] && req.method === "POST") {
          const { status, answer, delivered } = await body(req);
          if (!["open", "answered", "ignored"].includes(status)) return json(res, 400, { error: "bad status" });
          const qs = clarifyLoad(cm[1]), q = qs.find((x) => x.id === cm[2]);
          if (!q) return json(res, 404, { error: "not found" });
          q.status = status;
          if (answer !== undefined) q.answer = String(answer).slice(0, 4000);
          if (status === "answered") q.answeredAt = new Date().toISOString();
          if (delivered !== undefined) q.delivered = !!delivered;
          clarifySave(cm[1], qs);
          return json(res, 200, { question: q });
        }
      }
      if (p === "/api/prompts" && req.method === "GET") {
        const h = promptHistory();
        return json(res, 200, { library: read(LIBRARY) || "", history: h.slice(-30).reverse(), total: h.length, cleaned: parseInt(read(CLEANED), 10) || 0, every: CLEAN_EVERY, cleaning: cleaningPrompts });
      }
      if (p === "/api/prompts/clean" && req.method === "POST") { fs.mkdirSync(PROMPTS, { recursive: true }); return cleanPrompts(res); }
      // Feature modules (autopilot.js = Training + Working, ideas.js, updates.js) handle their own routes (route) and read-only files outside /api (asset).
      for (const m of modules) { if (m && m.route && (await m.route(p, req, res, url))) return; }
      return json(res, 404, { error: "unknown" });
    } catch (e) {
      // An oversized body (body() above): 413, and close the connection rather than read the rest of it.
      if (e && e.status === 413) { if (!res.headersSent) res.writeHead(413, { "Content-Type": "application/json", Connection: "close" }); return res.end(JSON.stringify({ error: "That request is too large." })); }
      return json(res, 500, { error: String(e) });
    }
  }
  // Saved sketch images (read-only, strict file names) for the gallery thumbnails.
  const sk = /^\/sketch\/([\w-]{1,80}\.png)$/.exec(p);
  if (sk) {
    const f = path.join(SKETCHES, sk[1]);
    let st = null; try { st = fs.statSync(f); } catch {}
    if (!st || !st.isFile()) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "max-age=86400" });
    return fs.createReadStream(f).on("error", () => res.destroy()).pipe(res);
  }
  // Feature modules may serve read-only files outside /api for <img> tags (no X-Hive header possible): asset(p, req, res) → true if handled.
  for (const m of modules) {
    if (!m || !m.asset) continue;
    try { if (m.asset(p, req, res)) return; }
    catch (e) { console.error("asset:", e && e.message || e); if (!res.headersSent) { res.writeHead(500); return res.end("error"); } return; }
  }
  const file = path.join(PUBLIC, p === "/" ? "index.html" : path.normalize(p).replace(/^([\\/])+/, ""));
  let st = null; try { st = fs.statSync(file); } catch {}
  if (!file.startsWith(PUBLIC + path.sep) || !st || !st.isFile()) { res.writeHead(404); return res.end("not found"); }   // folders too
  const head = { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" };
  if (path.basename(file) === "index.html") head["Content-Security-Policy"] = PAGE_CSP;
  res.writeHead(200, head);
  fs.createReadStream(file).on("error", () => res.destroy()).pipe(res);
});
server.on("error", (e) => { console.error(new Date().toISOString(), "server error:", e.message); hub.emit("server-error", e); });
// Streams can stay open for hours: no request timeout, and a heartbeat every 15 s so nothing between the page
// and the server treats a quiet stream as dead.
server.requestTimeout = 0;
server.headersTimeout = 60000;
setInterval(() => {
  for (const res of globalSubs) { try { res.write(": ping\n\n"); } catch {} }
  for (const run of live.values()) for (const res of run.subs) { try { res.write(": ping\n\n"); } catch {} }
}, 15000).unref();
const modules = [];
// Chats still running, plus busy work feature modules report (a council in progress): restarts, updates and Quit wait for both.
// Everything a restart or Quit must wait for: chats and rounds, background jobs that edit files, and modules' own busy().
const activeRuns = () => [...live.values()].filter((r) => !r.done).length + [...jobs.values()].filter((j) => j.edits).length
  + modules.reduce((n, m) => n + (m && typeof m.busy === "function" ? Number(m.busy()) || 0 : 0), 0);

/* ---------- feature modules ---------- */
// Each module is `module.exports = (ctx) => ({ route(p, req, res, url) -> true if handled, asset?(p, req, res) -> true if handled, start?(), busy?() -> runs in progress })`.
// A module that fails to load is logged and skipped, so one broken feature can't take the app down.
const ctx = { BRAIN, HOME, PORT, CLAUDE, APP_DIR: __dirname, LITE, read, json, body, sse, simplify, trk, broadcast, notify, hub, startChat, stopChat, stopRun, answerRequest, askClaude, runClaude, subscribe,
  live, activeRuns, isPage, tasteKey, cleanEnv, toolSummary, sessionMeta, listTranscripts, sessionMetas, track, emit, chatHints, configuredFolders, UPLOADS, CLAUDE_DIR };
// jobs.js first, so the activity tracker is attached before any other module's start() can begin a run.
for (const f of ["jobs.js", "council.js", "autopilot.js", "ideas.js", "updates.js", "review.js", "search.js", "digest.js", "memhealth.js", "cleanup.js", "phone.js", "plugins.js", "brainstorm.js", "media.js", "trim.js", "skillsmith.js", "taste.js", "obsidian.js"]) {
  const file = path.join(__dirname, f);
  if (!fs.existsSync(file)) continue;
  try { modules.push(require(file)(ctx)); console.log(new Date().toISOString(), "loaded", f); }
  catch (e) { console.error(new Date().toISOString(), "module failed to load:", f, e && e.stack || e); }
}
server.listen(PORT, "127.0.0.1", () => {
  console.log(`The Wise Hive on http://127.0.0.1:${PORT}`); hub.emit("ready");
  // Smoke-test instances (HIVE_PORT set by the updater) don't resume autopilot loops or schedules.
  if (!process.env.HIVE_PORT) for (const m of modules) { try { m.start && m.start(); } catch (e) { console.error("module start:", e); } }
});
module.exports = { hub, PORT, activeRuns, setPageKey, setTasteKey };
