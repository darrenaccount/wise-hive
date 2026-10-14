// Chat media (feature module): pictures and files Claude sends in a chat are shown in the chat.
// Three kinds, read from the chat's raw stream events (server.js "chat-line" tap; user chats only, not unattended runs
// or the sketch reader):
//   shown  a reply names an existing image (full path, or relative to the chat's folder) -> shown inline; a deliverable
//          (pdf, glb, blend, mp4, zip, ...) or any file/folder path alone on its own line -> a file button ("chip").
//   made   images and deliverables a writing tool (Write/Edit, shell, Blender code, subagents) created during the turn.
//   seen   pictures picture tools returned to Claude (Read of an image, Blender look, Studio screenshots, Chrome
//          screenshots), saved to disk and listed under a collapsed "Looked at".
// Safety: images are served at /media/<random 128-bit token>/<ascii name> only from allowed roots (the brain, the
// chat's folder, project folders, Desktop/Downloads/Pictures/Videos, temp), never from ~\.claude, ~\.ssh, ~\.gnupg or
// <brain>\app-settings, with nosniff/CORP/CSP sandbox headers and Host and Sec-Fetch-Site checks. UNC paths, device
// names and alternate data streams are refused before any filesystem call. "Open" (default app) is an allowlist checked
// against the file's first bytes; everything else only gets "Show in folder".
// History: made images and freshly written shown images are copied by content hash to <brain>\uploads\<UTC date>\
// from-claude\, and each chat keeps an index at <brain>\chat-media\<chat id>.json, so a reopened chat shows each
// turn's own version. Examples in this file use made-up names (D:\Games\BananaQuest\...).
// Verified 2026-10-12 (test/media-test.js).
"use strict";
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { anchorOf } = require("./public/media-core.js");

/* ---------- constants ---------- */
const IMG = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml" };
const EXT_OF = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/bmp": "bmp" };
const DELIV = "pdf|glb|gltf|fbx|obj|stl|blend|rbxl|rbxm|rbxmx|mp4|webm|mov|mp3|wav|ogg|zip|docx|xlsx|pptx|csv";
const DELIV_SET = new Set(DELIV.split("|"));
const EXTS = `png|jpe?g|gif|webp|bmp|svg|${DELIV}`;
// Left edge: start of text, or after whitespace, a quote, a bracket, = * > |. So "https://host/d/x.png" never yields "s://..." or "/d/x.png".
const LB = String.raw`(?<![^\s"'\`(\[{<=*>|])`;
// Path heads: C:\ or C:/, Git Bash /c/, Blender's and Git Bash's /tmp/, each optionally after file:///.
const HEAD = String.raw`(?:file:\/\/\/)?(?:[A-Za-z]:[\\/]|\/[A-Za-z]\/|\/tmp\/)`;
// A path ends at: end of text, whitespace, a closing quote/bracket/markup, or . or : followed by space/end (sentence end).
const END = String.raw`(?=$|[\s"'\`)\]}>,;!?*|]|[.:](?:\s|$))`;
// No ":" after the head (so a lazy match can't run into the next "C:") and no newline (one line per match).
const ABS = new RegExp(String.raw`${LB}${HEAD}[^\r\n<>"|?*:\`]*?\.(?:${EXTS})${END}`, "gi");
const REL = new RegExp(String.raw`(?:^|[\s"'\`(])((?:\.{1,2}[\\/])?(?:[\w.-]+[\\/])*[\w-][\w.-]*\.(?:png|jpe?g|gif|webp|bmp|svg))${END}`, "gi");
// Own line: the whole line is one path, optionally in ` " ' or **; no list marker. Lines inside ``` fences are skipped.
const OWN = new RegExp(String.raw`^\s*(?:\*\*|\`|"|')?(${HEAD}[^\r\n<>"|?*:\`]*?)(?:\*\*|\`|"|')?[.,;:]?\s*$`);
// Made comes only from writing tools; for Write/Edit only their file_path counts. Looked at only from picture tools.
const WRITE = /^(Write|Edit|MultiEdit|NotebookEdit|Bash|PowerShell|Agent|Task|mcp__blender__(execute_blender_code|import_asset|generate_3d)|mcp__claude-in-chrome__gif_creator)$/;
const EDITS = /^(Write|Edit|MultiEdit|NotebookEdit)$/;
const SEEN = /^(Read|mcp__blender__look|mcp__Roblox_Studio__(screen_capture|capture_plugin_gui)|mcp__claude-in-chrome__computer)$/;
// Open allowlist: true = no check needed; otherwise one of the byte signatures [offset, hex] must match.
const PK = [[0, "504b0304"]], RBX = [[0, "3c726f626c6f7821"]], FTYP = [[4, "66747970"]];
const OPEN = { png: true, jpg: true, jpeg: true, gif: true, webp: true, bmp: true, txt: true, md: true, log: true, json: true, stl: true,
  pdf: [[0, "255044462d"]], zip: PK, docx: PK, xlsx: PK, pptx: PK, glb: [[0, "676c5446"]], fbx: [[0, "4b617964617261204642582042696e617279"]],
  blend: [[0, "424c454e444552"], [0, "28b52ffd"], [0, "1f8b"]], rbxl: RBX, rbxm: RBX, mp4: FTYP, mov: FTYP, webm: [[0, "1a45dfa3"]],
  mp3: [[0, "494433"], [0, "fffb"], [0, "fff3"], [0, "fff2"]], wav: [[0, "52494646"]], ogg: [[0, "4f676753"]] };
const LIM = { inlineMax: 30 << 20, snapMax: 15 << 20, seenMax: 10 << 20, perRun: 80, cand: 40, scan: 50000, index: 300, tokens: 5000, fresh: 24 * 3600e3, texts: 200 };
const HINT = "The Wise Hive app chat: when your reply includes the full path of an existing image (png, jpg, gif, webp, bmp, svg), the user sees it inline. A file or folder path alone on its own line (no bullet) becomes a button for it. Use this to show renders, screenshots and files you made or found. Only mention files that exist; don't make extra images just to show them unless asked.";
const HINT_LITE = "The Wise Hive chat: full image paths in your reply show inline; a path alone on a line (no bullet) becomes a file button.";
const RANK = { shown: 3, made: 2, seen: 1 };
const DEVICE = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;

/* ---------- pure helpers (exported for tests) ---------- */
const slash = (p) => (p.endsWith("\\") ? p : p + "\\");
const extOf = (p) => path.win32.extname(String(p || "")).slice(1).toLowerCase();
const okPath = (p) => p.length <= 400 && !/^[\\/]{2}/.test(p) && p.indexOf(":", 2) < 0 && !p.split("\\").some((seg) => DEVICE.test(seg));
// Raw path text -> absolute Windows path candidates (empty = refused). Runs before any filesystem call.
function normalize(raw, cwd) {
  let s = String(raw || "").trim();
  if (/^file:\/\/\//i.test(s)) { s = s.slice(8); try { s = decodeURIComponent(s); } catch { return []; } }
  if (/^[\\/]{2}/.test(s)) return [];                       // UNC, \\?\, \\.\ and Blender's //relative
  let c;
  const tmp = /^\/tmp\/(.+)$/i.exec(s);
  if (tmp) { const rest = tmp[1].replace(/\//g, "\\"); c = ["C:\\tmp\\" + rest, path.win32.join(os.tmpdir(), rest)]; }
  else {
    const gb = /^\/([A-Za-z])\/(.*)$/.exec(s);
    if (gb) s = gb[1].toLowerCase() + ":\\" + gb[2];
    s = s.replace(/\//g, "\\").replace(/\\{2,}/g, "\\");
    if (/^[A-Za-z]:\\/.test(s)) c = [s];
    else if (cwd && /^[A-Za-z]:\\/.test(cwd) && !/^[A-Za-z]:/.test(s) && !s.startsWith("\\")) c = [path.win32.resolve(cwd, s)];
    else return [];
  }
  return c.map((p) => path.win32.normalize(p.replace(/\\{2,}/g, "\\"))).filter(okPath);
}
// Paths in a reply or tool text -> [{ ps: candidates, own: alone on its own line }], deduped, at most LIM.cand.
// o.own === false skips the own-line pass (tool output: images and deliverables only).
function findPaths(text, cwd, o) {
  const t = String(text || "").slice(0, LIM.scan), out = [], at = new Map(), spans = [];
  const add = (raw, own, pos) => {
    const ps = normalize(raw, cwd);
    if (!ps.length) return;
    const k = ps[0].toLowerCase();
    if (at.has(k)) { if (own) at.get(k).own = true; return; }
    if (out.length >= LIM.cand) return;
    const x = { ps, own, pos };
    at.set(k, x); out.push(x);
  };
  if (!o || o.own !== false) {
    let fence = false, pos = 0;
    for (const line of t.split("\n")) {
      const at0 = pos; pos += line.length + 1;
      if (/^\s*```/.test(line)) { fence = !fence; continue; }
      if (fence || line.length > 600) continue;
      const m = OWN.exec(line);
      if (m) add(m[1], true, at0);
    }
  }
  for (const m of t.matchAll(ABS)) { spans.push([m.index, m.index + m[0].length]); add(m[0], false, m.index); }
  if (cwd) for (const m of t.matchAll(REL)) {
    const st = m.index + m[0].length - m[1].length, en = st + m[1].length;
    if (spans.some(([a, b]) => st < b && en > a)) continue;
    add(m[1], false, st);
  }
  // In the order they appear in the text.
  return out.sort((a, b) => a.pos - b.pos).map(({ ps, own }) => ({ ps, own }));
}
// Width and height from the first bytes of an image (PNG, GIF, BMP, WebP, JPEG, SVG); null when unknown.
function dims(buf, ext) {
  try {
    if (!buf || buf.length < 24) return null;
    if (buf.readUInt32BE(0) === 0x89504e47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    if (buf.toString("latin1", 0, 3) === "GIF") return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
    if (buf.toString("latin1", 0, 2) === "BM") return { w: Math.abs(buf.readInt32LE(18)), h: Math.abs(buf.readInt32LE(22)) };
    if (buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") {
      const kind = buf.toString("latin1", 12, 16);
      if (kind === "VP8 " && buf.length >= 30) return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
      if (kind === "VP8L" && buf.length >= 25) { const b = buf.readUInt32LE(21); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; }
      if (kind === "VP8X" && buf.length >= 30) return { w: buf.readUIntLE(24, 3) + 1, h: buf.readUIntLE(27, 3) + 1 };
      return null;
    }
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      for (let i = 2; i + 9 < buf.length;) {
        if (buf[i] !== 0xff) { i++; continue; }
        const mk = buf[i + 1];
        if (mk === 0xff) { i++; continue; }
        if (mk === 0xd8 || mk === 0x01 || (mk >= 0xd0 && mk <= 0xd7)) { i += 2; continue; }
        const len = buf.readUInt16BE(i + 2);
        if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
        i += 2 + len;
      }
      return null;
    }
    if (ext === "svg") {
      const s = buf.toString("utf8", 0, Math.min(buf.length, 4096)), tag = (/<svg\b[^>]*>/i.exec(s) || [""])[0];
      const num = (n) => { const m = new RegExp(`\\s${n}\\s*=\\s*["']\\s*([\\d.]+)\\s*(px)?\\s*["']`, "i").exec(tag); return m ? Number(m[1]) : 0; };
      let w = num("width"), h = num("height");
      const vb = /\sviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(tag);
      if ((!w || !h) && vb) { w = Number(vb[1]); h = Number(vb[2]); }
      return w > 0 && h > 0 ? { w: Math.round(w), h: Math.round(h) } : null;
    }
  } catch {}
  return null;
}
// ASCII URL name that keeps the extension (the real name goes in Content-Disposition).
function slug(name) {
  const n = String(name || ""), ext = (/\.[a-z0-9]{1,5}$/i.exec(n) || [""])[0];
  let base = n.slice(0, n.length - ext.length).replace(/[^\w.-]+/g, "_").replace(/^[._-]+/, "").replace(/_+$/, "");
  if (!base.replace(/[._-]/g, "")) base = "file";
  return base.slice(0, 60 - ext.length) + ext;
}
const ascii = (s) => String(s || "file").replace(/[^\x20-\x7e]|["\\;]/g, "_");
// Default-app opening allowlist, checked against the file's first bytes.
async function openable(real, st) {
  try {
    st = st || await fsp.stat(real);
    if (st.isDirectory()) return !/\.\{[0-9a-f-]{36}\}$/i.test(real);   // not a shell namespace junction
    if (!st.isFile()) return false;
    const rule = OPEN[extOf(real)];
    if (rule === true) return true;
    if (!Array.isArray(rule)) return false;
    const fh = await fsp.open(real, "r");
    try {
      const b = Buffer.alloc(32), { bytesRead } = await fh.read(b, 0, 32, 0), hex = b.subarray(0, bytesRead).toString("hex");
      return rule.some(([off, sig]) => hex.startsWith(sig, off * 2));
    } finally { await fh.close().catch(() => {}); }
  } catch { return false; }
}
// Collects string values of a tool input (depth <= 6, at most 200 strings, each cut to max).
function strings(obj, max, out = [], depth = 0) {
  if (out.length >= 200 || depth > 6 || obj == null) return out;
  if (typeof obj === "string") { out.push(obj.slice(0, max)); return out; }
  if (typeof obj === "object") for (const v of Array.isArray(obj) ? obj : Object.values(obj)) strings(v, max, out, depth + 1);
  return out;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const verOf = (st) => `${Math.round(st.mtimeMs)}:${st.size}`;
const pretty = (n) => (String(n).startsWith("mcp__") ? String(n).split("__").slice(1).join(": ").replace(/_/g, " ") : String(n || ""));

/* ---------- the module ---------- */
function media(ctx) {
  const { BRAIN, HOME } = ctx;
  const UPLOADS = ctx.UPLOADS || path.join(BRAIN, "uploads");
  const CLAUDE_DIR = ctx.CLAUDE_DIR || path.join(HOME, ".claude");
  const INDEX_DIR = path.join(BRAIN, "chat-media");
  const BUDGET = (ctx.LITE ? 60 : 200) << 20, SEEN_MAX = ctx.LITE ? 20 : 40;
  const HOSTS = new Set([`127.0.0.1:${ctx.PORT}`, `localhost:${ctx.PORT}`]);
  const DRY = process.env.HIVE_MEDIA_DRYRUN === "1";
  const configured = () => { try { return typeof ctx.configuredFolders === "function" ? ctx.configuredFolders() : []; } catch { return []; } };
  const realLower = (p) => { try { return slash(fs.realpathSync.native(p).toLowerCase()); } catch { return null; } };
  const env = (k) => process.env[k] || "";

  /* roots */
  let protect = null;
  function protects() {
    if (protect) return protect;
    const L = (p) => (p ? realLower(p) || slash(path.win32.normalize(p).toLowerCase()) : null);
    protect = {
      // A chat folder may not be one of these or contain one (it would make the whole profile a root).
      ancestors: [HOME, path.join(HOME, "AppData"), env("APPDATA"), env("LOCALAPPDATA")].map(L).filter(Boolean),
      // ...nor be inside one of these.
      under: [env("WINDIR") || env("SystemRoot"), env("ProgramFiles"), env("ProgramFiles(x86)"), env("ProgramData"), CLAUDE_DIR].map(L).filter(Boolean),
      deny: [CLAUDE_DIR, path.join(HOME, ".ssh"), path.join(HOME, ".gnupg"), path.join(BRAIN, "app-settings")].map(L).filter(Boolean),
    };
    return protect;
  }
  function goodCwd(c) {
    try {
      if (!c || typeof c !== "string" || /^[\\/]{2}/.test(c) || !/^[A-Za-z]:[\\/]/.test(c)) return null;
      const real = fs.realpathSync.native(c);
      if (/^[\\/]{2}/.test(real) || !fs.statSync(real).isDirectory()) return null;
      const L = slash(real.toLowerCase()), P = protects();
      if (/^[a-z]:\\$/.test(L)) return null;
      if (P.ancestors.some((a) => a.startsWith(L))) return null;
      if (P.under.some((u) => L.startsWith(u))) return null;
      return real;
    } catch { return null; }
  }
  const rootCache = new Map();
  function rootsFor(cwd) {
    const k = String(cwd || "").toLowerCase(), hit = rootCache.get(k);
    if (hit && Date.now() - hit.at < 60000) return hit.roots;
    const dirs = [BRAIN, goodCwd(cwd), ...configured().map(goodCwd)];
    for (const d of ["Desktop", "Downloads", "Pictures", "Videos", path.join("OneDrive", "Desktop"), path.join("OneDrive", "Pictures")]) dirs.push(path.join(HOME, d));
    dirs.push(os.tmpdir(), "C:\\tmp");
    const roots = [...new Set(dirs.filter(Boolean).map(realLower).filter(Boolean))];
    if (rootCache.size > 50) rootCache.clear();
    rootCache.set(k, { at: Date.now(), roots });
    return roots;
  }
  const denied = (L) => protects().deny.some((d) => slash(L) === d || L.startsWith(d));
  // First candidate that exists -> what it is and whether it may be shown. null when missing, UNC or denied.
  async function inspect(ps, roots) {
    for (const p of ps) {
      let real, st;
      try { real = await fsp.realpath(p); st = await fsp.stat(real); } catch { continue; }
      if (/^[\\/]{2}/.test(real)) return null;
      const L = real.toLowerCase();
      if (denied(L)) return null;
      const ext = extOf(real);
      return { real, st, ext, dir: st.isDirectory(), image: !!IMG[ext] && st.isFile(), inRoots: roots.some((r) => L.startsWith(r)) };
    }
    return null;
  }

  /* tokens: random capabilities for /media/ and /api/media/open, least recently used dropped */
  const tokens = new Map(), byFile = new Map();
  function touch(t) { const e = tokens.get(t); if (e) { tokens.delete(t); tokens.set(t, e); } return e; }
  function mint(entry, fk) {
    if (fk) { const t = byFile.get(fk); if (t && tokens.has(t)) { touch(t); return t; } }
    const t = crypto.randomBytes(16).toString("base64url");
    tokens.set(t, { ...entry, fk });
    if (fk) byFile.set(fk, t);
    while (tokens.size > LIM.tokens) {
      const [old, e] = tokens.entries().next().value;
      tokens.delete(old);
      if (e.fk && byFile.get(e.fk) === old) byFile.delete(e.fk);
    }
    return t;
  }
  function rekey(t, file, st) {
    const e = tokens.get(t);
    if (!e) return;
    if (e.fk && byFile.get(e.fk) === t) byFile.delete(e.fk);
    e.file = file;
    e.fk = `${file.toLowerCase()}|${verOf(st)}|${e.serve ? 1 : 0}`;
    byFile.set(e.fk, t);
  }
  // A page item for a file (f = inspect result, or a snapshot). serveFile: what /media/ streams (snapshot or src).
  async function itemFor(f, kind, type, o = {}) {
    const file = o.file || f.real, st = o.fst || f.st, serve = type === "image";
    const name = o.name || path.win32.basename(f.real || file) || "file";
    const fk = `${file.toLowerCase()}|${verOf(st)}|${serve ? 1 : 0}`;
    const id = mint({ file, src: f.real || null, mime: IMG[f.ext] || null, size: st.size, name, serve, type }, fk);
    let wh = null;
    if (serve) { try { const fh = await fsp.open(file, "r"); try { const b = Buffer.alloc(Math.min(st.size, 256 << 10)); await fh.read(b, 0, b.length, 0); wh = dims(b, f.ext); } finally { await fh.close().catch(() => {}); } } catch {} }
    const it = { id, key: o.key || (f.real || file).toLowerCase(), ver: o.ver || verOf(f.st), kind, type, name, path: f.real || "", ext: f.ext, mime: IMG[f.ext] || "", size: st.size,
      open: type === "folder" ? await openable(f.real, f.st) : f.real ? await openable(f.real, f.st) : false };
    if (serve) it.url = `/media/${id}/${slug(name)}`;
    if (wh) { it.w = wh.w; it.h = wh.h; }
    if (o.tool) it.tool = o.tool;
    if (o.current) it.current = true;
    return it;
  }

  /* snapshots: content-addressed copies in <brain>\uploads\<UTC date>\from-claude\ */
  async function store(s, buf, ext) {
    if (buf.length > LIM.snapMax || s.bytes + buf.length > BUDGET) return null;
    s.bytes += buf.length;
    const sha = crypto.createHash("sha1").update(buf).digest("hex").slice(0, 16);
    const day = path.join(UPLOADS, new Date().toISOString().slice(0, 10));
    let dir = path.join(day, "from-claude");
    try { if (fs.existsSync(dir) && !fs.statSync(dir).isDirectory()) dir = path.join(day, "from-claude-1"); } catch {}
    await fsp.mkdir(dir, { recursive: true });
    const file = path.join(dir, sha + "." + (ext === "jpeg" ? "jpg" : ext));
    if (!fs.existsSync(file)) { const tmp = file + "." + process.pid + ".tmp"; await fsp.writeFile(tmp, buf); await fsp.rename(tmp, file).catch(async (e) => { await fsp.unlink(tmp).catch(() => {}); if (!fs.existsSync(file)) throw e; }); }
    return { file, sha, st: await fsp.stat(file) };
  }
  // Copies a path source if it still is the version that was detected (size and mtime unchanged while reading it).
  async function snapshotFile(s, real, ver, ext) {
    const a = await fsp.stat(real);
    if (verOf(a) !== ver || a.size > LIM.snapMax || s.bytes + a.size > BUDGET) return null;
    const buf = await fsp.readFile(real), b = await fsp.stat(real);
    if (verOf(b) !== ver || buf.length !== b.size) return null;   // still being written: keep serving the file itself
    return store(s, buf, ext);
  }

  /* per-run state and the per-chat index */
  const states = new WeakMap();
  function stateOf(run) {
    let s = states.get(run);
    if (!s) { s = { tools: new Map(), sent: new Map(), count: 0, seen: 0, bytes: 0, tid: "t0", anchor: "", turns: 0, chain: Promise.resolve() }; states.set(run, s); }
    return s;
  }
  const queue = (s, fn) => (s.chain = s.chain.then(fn).catch((e) => console.error(new Date().toISOString(), "media:", e && e.stack || e)));
  const pend = new Map(); // run -> { entries: Map<tid|key, entry>, timer }
  const indexFile = (id) => path.join(INDEX_DIR, id + ".json");
  const CHAT_ID = /^[\w-]{6,80}$/;
  function loadIndex(id) { try { const j = JSON.parse(fs.readFileSync(indexFile(id), "utf8")); return Array.isArray(j.items) ? j : { items: [] }; } catch { return { items: [] }; } }
  function upsert(run, entry) {
    let p = pend.get(run);
    if (!p) { p = { entries: new Map(), timer: null }; pend.set(run, p); }
    p.entries.set(entry.tid + "|" + entry.key, entry);
    clearTimeout(p.timer);
    p.timer = setTimeout(() => flush(run), 300);
    if (p.timer.unref) p.timer.unref();
  }
  function flush(run) {
    const p = pend.get(run);
    if (!p) return;
    clearTimeout(p.timer); p.timer = null;
    if (!run.chatId || !CHAT_ID.test(run.chatId)) { if (run.done) pend.delete(run); return; }   // waits for the chat id
    pend.delete(run);
    try {
      const idx = loadIndex(run.chatId), map = new Map(idx.items.map((e) => [e.tid + "|" + e.key, e]));
      for (const [k, e] of p.entries) { const old = map.get(k); map.delete(k); map.set(k, old && (RANK[old.kind] || 0) > (RANK[e.kind] || 0) ? { ...e, kind: old.kind } : e); }
      const items = [...map.values()].slice(-LIM.index);
      fs.mkdirSync(INDEX_DIR, { recursive: true });
      const f = indexFile(run.chatId), tmp = f + "." + process.pid + ".tmp", data = JSON.stringify({ chat: run.chatId, cwd: run.cwd, items }, null, 1);
      fs.writeFileSync(tmp, data);
      try { fs.renameSync(tmp, f); } catch { fs.writeFileSync(f, data); try { fs.unlinkSync(tmp); } catch {} }
    } catch (e) { console.error(new Date().toISOString(), "media index:", e && e.message || e); }
  }
  // Emits new items (one per turn and file; a newer version or a higher kind replaces the old one) and records them.
  function send(run, s, list) {
    const out = [];
    for (const { it, rec } of list) {
      const id = s.tid + "|" + it.key, prev = s.sent.get(id), r = RANK[it.kind];
      if (prev && prev.ver === it.ver && prev.rank >= r) continue;
      if (!prev && s.count >= LIM.perRun) continue;
      if (!prev) s.count++;
      const kind = prev && prev.rank > r ? prev.kind : it.kind;
      s.sent.set(id, { ver: it.ver, rank: RANK[kind], kind });
      it.kind = kind; it.tid = s.tid;
      out.push(it);
      upsert(run, { at: new Date().toISOString(), tid: s.tid, anchor: s.anchor, ...rec, kind, key: it.key, ver: it.ver, type: it.type, name: it.name, mime: it.mime, size: it.size, w: it.w, h: it.h, tool: it.tool });
    }
    if (out.length) ctx.emit(run, { t: "media", items: out });
    return out;
  }
  // After a snapshot: the token now serves the copy, and the index entry points at it.
  function snapped(run, s, it, snap) {
    rekey(it.id, snap.file, snap.st);
    const p = pend.get(run), k = s.tid + "|" + it.key;
    const e = (p && p.entries.get(k)) || null;
    if (e && e.ver === it.ver) upsert(run, { ...e, file: snap.file, sha: snap.sha });
    else upsert(run, { at: new Date().toISOString(), tid: s.tid, anchor: s.anchor, kind: it.kind, key: it.key, ver: it.ver, type: it.type, name: it.name, mime: it.mime, size: it.size, w: it.w, h: it.h, tool: it.tool, src: it.path, file: snap.file, sha: snap.sha });
  }
  const fresh = (st) => Date.now() - Math.max(st.mtimeMs, st.birthtimeMs || 0) < LIM.fresh;

  async function fromText(run, s, text) {
    const roots = rootsFor(run.cwd), list = [];
    for (const c of findPaths(text, run.cwd)) {
      const f = await inspect(c.ps, roots);
      if (!f) continue;
      let type;
      if (f.image && f.inRoots && f.st.size <= LIM.inlineMax) type = "image";
      else if (f.dir) { if (!c.own) continue; type = "folder"; }
      else if (!f.st.isFile()) continue;
      else if (f.image || DELIV_SET.has(f.ext) || c.own) type = "file";
      else continue;
      list.push({ f, it: await itemFor(f, "shown", type), rec: { src: f.real, file: f.real } });
    }
    const sent = send(run, s, list);
    for (const { f, it } of list) if (sent.includes(it) && it.type === "image" && fresh(f.st)) {
      const snap = await snapshotFile(s, f.real, it.ver, f.ext).catch(() => null);
      if (snap) snapped(run, s, it, snap);
    }
  }
  async function fromMade(run, s, strs, tool) {
    const roots = rootsFor(run.cwd), list = [], keys = new Set();
    for (const str of strs) for (const c of findPaths(str, run.cwd, { own: false })) {
      if (list.length >= LIM.cand) break;
      const f = await inspect(c.ps, roots);
      if (!f || !f.st.isFile() || keys.has(f.real.toLowerCase())) continue;
      // Written by this tool call. Copy-Item keeps the old mtime, but the copy's birth time is new.
      if (Math.max(f.st.mtimeMs, f.st.birthtimeMs || 0) < tool.t - 2000) continue;
      const type = f.image && f.inRoots && f.st.size <= LIM.inlineMax ? "image" : f.image || DELIV_SET.has(f.ext) ? "file" : null;
      if (!type) continue;
      keys.add(f.real.toLowerCase());
      list.push({ f, it: await itemFor(f, "made", type, { tool: pretty(tool.name) }), rec: { src: f.real, file: f.real } });
    }
    const sent = send(run, s, list);
    for (const { f, it } of list) if (sent.includes(it) && it.type === "image") {
      const snap = await snapshotFile(s, f.real, it.ver, f.ext).catch(() => null);
      if (snap) snapped(run, s, it, snap);
    }
  }
  async function fromImages(run, s, imgs, tool) {
    if (s.seen >= SEEN_MAX) return;
    const roots = rootsFor(run.cwd), list = [], tn = pretty(tool.name);
    if (tool.name === "Read" && tool.fp && IMG[extOf(tool.fp)]) {
      // A Read of an image file: point at the file, so a later "shown" mention of it upgrades this item.
      const f = await inspect(normalize(tool.fp, run.cwd), roots);
      if (f && f.image) {
        s.seen++;
        const type = f.inRoots && f.st.size <= LIM.inlineMax ? "image" : "file";
        list.push({ f, it: await itemFor(f, "seen", type, { tool: tn }), rec: { src: f.real, file: f.real } });
      }
    } else for (const im of imgs) {
      if (s.seen >= SEEN_MAX) break;
      const src = (im && im.source) || {}, ext = EXT_OF[src.media_type];
      if (src.type !== "base64" || !ext || typeof src.data !== "string" || src.data.length > LIM.seenMax * 1.4) continue;
      const buf = Buffer.from(src.data, "base64");
      if (!buf.length || buf.length > LIM.seenMax) continue;
      const snap = await store(s, buf, ext).catch(() => null);
      if (!snap) continue;                                  // over the run's budget
      s.seen++;
      const short = String(tool.name || "tool").split("__").pop().replace(/[^\w-]+/g, "_").slice(0, 30) || "tool";
      const f = { real: null, st: snap.st, ext };
      const it = await itemFor(f, "seen", "image", { file: snap.file, name: `${short}-${snap.sha.slice(0, 6)}.${ext}`, key: "sha:" + snap.sha, ver: snap.sha, tool: tn });
      list.push({ f, it, rec: { file: snap.file, sha: snap.sha } });
    }
    const sent = send(run, s, list);
    for (const { f, it } of list) if (sent.includes(it) && f.real && it.type === "image" && fresh(f.st)) {
      const snap = await snapshotFile(s, f.real, it.ver, f.ext).catch(() => null);
      if (snap) snapped(run, s, it, snap);
    }
  }

  /* the tap: every raw stream event of every chat run */
  function onLine(run, ev) {
    if (!run || run.kind !== "chat" || run.autoDeny || !ev) return;   // user chats only (the sketch reader is "sketch")
    if (ev.type === "result") { const s = stateOf(run); queue(s, () => flush(run)); return; }   // turn over: write the index
    if ((ev.type !== "assistant" && ev.type !== "user") || ev.parent_tool_use_id) return;       // deltas, subagent internals
    const s = stateOf(run), content = ev.message && ev.message.content, blocks = Array.isArray(content) ? content : [];
    if (ev.type === "assistant") {
      for (const b of blocks) {
        if (b && b.type === "text" && b.text) { const text = String(b.text); queue(s, () => fromText(run, s, text)); }
        else if (b && b.type === "tool_use" && b.id) {
          const name = String(b.name || ""), inp = b.input || {}, fp = inp.file_path || inp.notebook_path;
          s.tools.set(b.id, { name, t: Date.now(), fp: typeof fp === "string" ? fp : "", strs: WRITE.test(name) ? (EDITS.test(name) ? [fp].filter((x) => typeof x === "string") : strings(inp, LIM.scan)) : [] });
        }
      }
      while (s.tools.size > 500) s.tools.delete(s.tools.keys().next().value);
      return;
    }
    const results = blocks.filter((b) => b && b.type === "tool_result");
    if (!results.length) {
      // Only the human message as Claude reads it starts a turn: the replay (isReplay) of what the app sent. Its image
      // blocks are the user's own attachments, never captured.
      if (ev.isReplay !== true || ev.isMeta) return;
      const text = typeof content === "string" ? content : blocks.filter((b) => b && b.type === "text").map((b) => b.text).join("\n");
      if (!String(text || "").trim()) return;
      queue(s, () => { s.anchor = anchorOf(text); s.tid = /^[\w-]{1,64}$/.test(ev.uuid || "") ? ev.uuid : "t" + (++s.turns); });
      return;
    }
    for (const b of results) {
      const tool = s.tools.get(b.tool_use_id) || { name: "", t: Date.now() - 60000, strs: [] };
      const parts = Array.isArray(b.content) ? b.content : [{ type: "text", text: String(b.content || "") }];
      const imgs = parts.filter((c) => c && c.type === "image");
      if (imgs.length && SEEN.test(tool.name)) queue(s, () => fromImages(run, s, imgs, tool));
      if (WRITE.test(tool.name)) {
        const texts = parts.filter((c) => c && c.type === "text").map((c) => String(c.text || "").slice(0, LIM.scan));
        queue(s, () => fromMade(run, s, tool.strs.concat(texts), tool));
      }
    }
  }
  if (ctx.hub) {
    ctx.hub.on("chat-line", (run, ev) => { try { onLine(run, ev); } catch (e) { console.error(new Date().toISOString(), "media:", e && e.message || e); } });
    // finish() broadcasts "runs": write what is still waiting (a chat id that arrived late, the last debounce).
    ctx.hub.on("event", (ev) => { if (ev && ev.t === "runs") for (const run of [...pend.keys()]) flush(run); });
  }
  if (Array.isArray(ctx.chatHints)) ctx.chatHints.push(ctx.LITE ? HINT_LITE : HINT);
  // For taste.js ("Send to Taste" on a chat's picture or file): the file behind a token this page was shown, or null.
  // taste.js checks the path again before it copies anything.
  ctx.mediaFile = (t) => {
    const e = typeof t === "string" ? tokens.get(t) : null;
    if (!e) return null;
    const file = e.src && fs.existsSync(e.src) ? e.src : e.file;
    return file && !/^[\\/]{2}/.test(file) && !denied(String(file).toLowerCase()) ? { file, name: e.name } : null;
  };

  /* answers for the page */
  // Index entries -> page items, re-checked: the snapshot if it exists, else the source if it still exists and is allowed.
  async function indexItems(id, since) {
    const idx = loadIndex(id), roots = rootsFor(idx.cwd), out = [];
    for (const e of idx.items) {
      if (!e || !e.key || !e.tid || (since && !(Date.parse(e.at) >= since))) continue;
      const base = { tid: String(e.tid), anchor: String(e.anchor || ""), at: e.at, tool: e.tool };
      try {
        let it = null;
        if (e.file && e.sha && e.file !== e.src) {
          // Snapshots live in uploads only. The index is a plain file in the brain, so its path is resolved first
          // (".." and junctions out of uploads count as outside) and the deny list applies as everywhere else.
          const raw = String(e.file);
          if (!/^[a-z]:\\/i.test(raw) || !raw.toLowerCase().startsWith(slash(UPLOADS.toLowerCase()))) continue;
          let real = null;
          try { real = await fsp.realpath(raw); } catch {}
          const up = real ? realLower(UPLOADS) : null, RL = real ? realLower(real) : null;
          if (real && (!up || !RL || /^[\\/]{2}/.test(real) || !RL.startsWith(up) || denied(RL))) continue;
          const st = real ? await fsp.stat(real).catch(() => null) : null;
          if (st && st.isFile()) {
            const src = e.src ? await inspect([e.src], roots) : null;
            const f = { real: src ? src.real : null, st, ext: extOf(real) };
            it = await itemFor(f, e.kind, "image", { file: real, name: e.name, key: e.key, ver: e.ver, tool: e.tool });
            if (!src) it.path = e.src || "";
          }
        }
        if (!it && e.src) {
          const f = await inspect(normalize(e.src), roots);
          if (f) {
            const type = e.type === "image" ? (f.image && f.inRoots && f.st.size <= LIM.inlineMax ? "image" : f.st.isFile() ? "file" : null) : e.type === "folder" ? (f.dir ? "folder" : null) : f.st.isFile() ? "file" : null;
            if (type) it = await itemFor(f, e.kind, type, { key: e.key, ver: e.ver, tool: e.tool, current: type === "image" });
          }
        }
        if (it) out.push({ ...it, ...base, kind: e.kind });
      } catch {}
    }
    return out;
  }
  async function scanTexts(cwd, texts) {
    const good = goodCwd(cwd), roots = rootsFor(good), out = {};
    for (const t of texts.slice(0, LIM.texts)) {
      if (!t || !Number.isInteger(t.i) || typeof t.text !== "string") continue;
      const items = [];
      for (const c of findPaths(t.text.slice(-LIM.scan), good)) {
        const f = await inspect(c.ps, roots);
        if (!f) continue;
        let type;
        if (f.image && f.inRoots && f.st.size <= LIM.inlineMax) type = "image";
        else if (f.dir) { if (!c.own) continue; type = "folder"; }
        else if (!f.st.isFile()) continue;
        else if (f.image || DELIV_SET.has(f.ext) || c.own) type = "file";
        else continue;
        items.push(await itemFor(f, "shown", type, { current: type === "image" }));
      }
      if (items.length) out[t.i] = items;
    }
    return out;
  }
  function reveal(target) {
    if (DRY) return Promise.resolve({ ok: true, dry: true });
    const shell = process.versions.electron ? require("electron").shell : null;
    if (shell) { shell.showItemInFolder(target); return Promise.resolve({ ok: true }); }
    execFile("explorer.exe", ["/select," + target], { windowsHide: false }, () => {});
    return Promise.resolve({ ok: true });
  }
  async function openFile(target) {
    if (DRY) return { ok: true, dry: true };
    const shell = process.versions.electron ? require("electron").shell : null;
    if (shell) { const err = await shell.openPath(target); return err ? { error: err } : { ok: true }; }
    execFile("explorer.exe", [target], { windowsHide: false }, () => {});
    return { ok: true };
  }
  const hostOk = (req) => HOSTS.has(String(req.headers.host || "").toLowerCase());

  async function route(p, req, res, url) {
    if (!p.startsWith("/api/media/")) return false;
    if (!hostOk(req)) { ctx.json(res, 403, { error: "forbidden" }); return true; }   // DNS rebinding: another name for 127.0.0.1
    if (p === "/api/media/roots" && req.method === "GET") { ctx.json(res, 200, { roots: rootsFor(null), limits: { ...LIM, budget: BUDGET, seen: SEEN_MAX }, hint: ctx.LITE ? "lite" : "full" }); return true; }
    const cm = /^\/api\/media\/chat\/([^/]+)$/.exec(p);
    if (cm && req.method === "GET") {
      if (!CHAT_ID.test(cm[1])) { ctx.json(res, 400, { error: "bad chat id" }); return true; }
      const since = Number(url && url.searchParams.get("since")) || 0;
      ctx.json(res, 200, { items: await indexItems(cm[1], since) });
      return true;
    }
    if (p === "/api/media/scan" && req.method === "POST") {
      const o = await ctx.body(req);
      const texts = Array.isArray(o.texts) ? o.texts : [];
      ctx.json(res, 200, { items: await scanTexts(typeof o.cwd === "string" ? o.cwd : "", texts) });
      return true;
    }
    if (p === "/api/media/open" && req.method === "POST") {
      const { id, action } = await ctx.body(req);
      const e = typeof id === "string" ? touch(id) : null;
      if (!e) { ctx.json(res, 404, { error: "That file isn't available any more." }); return true; }
      const target = e.src && fs.existsSync(e.src) ? e.src : e.file;
      let real = null, st = null;
      try { real = await fsp.realpath(target); st = await fsp.stat(real); } catch {}
      if (!real || /^[\\/]{2}/.test(real) || denied(real.toLowerCase())) { ctx.json(res, 404, { error: "That file isn't available any more." }); return true; }
      if (action === "reveal") { ctx.json(res, 200, await reveal(real)); return true; }
      if (action !== "open") { ctx.json(res, 400, { error: "unknown action" }); return true; }
      if (!(await openable(real, st))) { ctx.json(res, 400, { error: "For safety, this kind of file can only be shown in its folder." }); return true; }
      const r = await openFile(real);
      ctx.json(res, r.error ? 500 : 200, r);
      return true;
    }
    return false;
  }
  function asset(p, req, res) {
    const m = /^\/media\/([A-Za-z0-9_-]{22})\/[\w.-]{1,60}$/.exec(p); // p = url.pathname, still %-encoded; slug() names are plain ASCII
    if (!m) return false;
    const fail = (code) => { if (!res.headersSent) { res.writeHead(code, { "Content-Type": "text/plain", "X-Content-Type-Options": "nosniff" }); res.end(code === 403 ? "forbidden" : code === 405 ? "method not allowed" : "not found"); } return true; };
    try {
      if (req.method !== "GET" && req.method !== "HEAD") return fail(405);
      if (!hostOk(req)) return fail(403);
      const site = req.headers["sec-fetch-site"];
      if (site && site !== "same-origin" && site !== "none") return fail(403);   // other web pages can't embed these
      const e = tokens.get(m[1]);
      if (!e || !e.serve || !e.mime) return fail(404);
      touch(m[1]);
      fs.stat(e.file, (err, st) => {
        try {
          if (err || !st.isFile() || st.size > LIM.inlineMax) return fail(404);
          res.writeHead(200, { "Content-Type": e.mime, "Content-Length": st.size, "Cache-Control": "private, max-age=86400",
            "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin",
            "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
            "Content-Disposition": `inline; filename="${ascii(e.name)}"; filename*=UTF-8''${encodeURIComponent(e.name)}` });
          if (req.method === "HEAD") return res.end();
          fs.createReadStream(e.file).on("error", () => res.destroy()).pipe(res);
        } catch { fail(404); }
      });
      return true;
    } catch { return fail(404); }
  }
  return { route, asset, _test: { onLine, stateOf, goodCwd, rootsFor, inspect, mint, tokens, byFile, flush, indexItems, scanTexts, BUDGET, SEEN_MAX } };
}

module.exports = media;
Object.assign(module.exports, { findPaths, normalize, dims, openable, slug, strings, WRITE, SEEN, EDITS, HINT, HINT_LITE, LIM, IMG });
