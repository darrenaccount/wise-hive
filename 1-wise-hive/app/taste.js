// Taste library (the Taste tab): everything Claude makes for the USER to judge (3D models, images/UI, pixel art, audio,
// video, text, lighting setups, other files), grouped by style. The user approves, denies (with a reason) or comments;
// a comment sends the piece back and the next round revises a copy, linked to the old one. Claude never approves its own
// work: verdicts, style moves and Taste settings are saved only from the app window (pageOnly) and are HMAC-signed, so a
// file the app didn't write is ignored. The signing key lives outside the brain (main.js keeps it in the desktop app's
// data folder; ctx.tasteKey). Reviews become one free summary per style (styles\<style>\summary.md, indexed by taste.md),
// which rounds read for the style they work in. Rounds have their own critic agent before anything reaches the queue
// (loopCritic; on in the full edition, off in Lite); round work without its critique.json waits in "unfinished".
// Files: <brain>\taste\ (v1 used <brain>\training\taste\, still read; see migrate): items\<id>\ = item.json (kind, title,
//   style, source, files, revisionOf) or capture.json + stills/turntable (blender\taste_capture.py), about.md, critique.json
//   (the round's critic), lighting.json, verdict.json + place.json (the user, signed), critics.json (optional extra
//   grading); inbox\ (rounds and chats hand work in), styles.json, picks.json, settings.json, version.json.
// GET routes never write anything (api-test runs against the real brain).
// Design: app\.research\designs\taste.md and taste-styles.md (local notes; what was built is in the brain's projects notes).
"use strict";
const fs = require("fs");
const { writeFileAtomic } = require("./lib/fsx");
const makeViews = require("./taste-view");
const path = require("path");
const crypto = require("crypto");

const ID = /^\d{4}-\d{2}-\d{2}_[a-z0-9][a-z0-9-]{0,40}$/;
const IMG = /^(thumb|still-(34|front|side|top|clay)|turn-\d{2,3})\.(jpg|png)$/;
const TYPE = { ".jpg": "image/jpeg", ".png": "image/png" };
const STILLS = ["34", "front", "side", "top", "clay"];
// Kinds of work: each has a viewer on the page; storage is the same for all (item.json + files). "model" items made by
// the Blender capture script have capture.json + stills + turntable instead of a file list.
const KINDS = { model: "3D model", image: "Image / design", pixel: "Pixel art", audio: "Audio", video: "Video", text: "Text / copy", lighting: "Lighting", other: "Other" };
// Item files: plain names only; the type comes from the extension. Meta files never count as item files.
const FILE = /^[A-Za-z0-9][\w.-]{0,99}\.([A-Za-z0-9]{1,8})$/;
const META = /^(item|capture|verdict|critics|critique|place|lighting|view)\.json$|^about\.md$|^error\.txt$/i;
const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4", flac: "audio/flac", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  md: "text/plain; charset=utf-8", txt: "text/plain; charset=utf-8", json: "application/json", lua: "text/plain; charset=utf-8", luau: "text/plain; charset=utf-8", csv: "text/plain; charset=utf-8",
  // Code a round writes (Blender Python, UI kits, shaders) is kept and shown as plain text, never run.
  py: "text/plain; charset=utf-8", js: "text/plain; charset=utf-8", ts: "text/plain; charset=utf-8", html: "text/plain; charset=utf-8", css: "text/plain; charset=utf-8", glsl: "text/plain; charset=utf-8" };
// Kept as files (Open / Show in folder), never shown inline.
const KEEP = new Set(["blend", "glb", "gltf", "fbx", "obj", "stl", "pdf", "zip", "rbxm", "rbxl", "rbxmx", "psd", "ase", "aseprite", "kra", "xcf", "tif", "tiff", "mid", "midi"]);
const EXT_KIND = { png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", bmp: "image", svg: "image", mp3: "audio", wav: "audio", ogg: "audio", m4a: "audio", flac: "audio",
  mp4: "video", webm: "video", mov: "video", md: "text", txt: "text", blend: "model", glb: "model", gltf: "model", fbx: "model", obj: "model", stl: "model", ase: "pixel", aseprite: "pixel" };
const SOURCES = ["training", "working", "chat", "upload"];
const LIMIT = { files: 40, file: 100 << 20, item: 300 << 20 };
// Reason chips per kind: stable keys (counted in each style's summary), labels for the page.
const R3D = {
  approve: [["silhouette", "Strong silhouette"], ["proportions", "Good proportions"], ["detail", "Right amount of detail"], ["materials", "Nice materials and colors"],
    ["clean", "Clean, no glitches"], ["style", "My style"], ["game", "Looks game-ready"]],
  deny: [["proportions", "Off proportions"], ["plain", "Too plain"], ["busy", "Too busy"], ["materials", "Bad materials or colors"], ["broken", "Broken or glitchy"],
    ["style", "Not my style"], ["unclear", "Can't tell what it is"]],
};
const RVIS = {
  approve: [["composition", "Strong composition"], ["readable", "Easy to read"], ["colors", "Nice colors"], ["detail", "Right amount of detail"], ["clean", "Clean, no glitches"], ["style", "My style"], ["game", "Fits the game"]],
  deny: [["cluttered", "Cluttered"], ["plain", "Too plain"], ["colors", "Bad colors"], ["unreadable", "Hard to read"], ["broken", "Broken or glitchy"], ["style", "Not my style"], ["off", "Off proportions or layout"]],
};
const REASONS = {
  model: R3D, image: RVIS, pixel: RVIS, video: RVIS,
  audio: { approve: [["sound", "Sounds great"], ["mix", "Clean mix"], ["mood", "Right mood"], ["fit", "Fits the game"], ["style", "My style"]],
    deny: [["harsh", "Harsh or noisy"], ["plain", "Too plain"], ["busy", "Too busy"], ["mood", "Wrong mood"], ["broken", "Glitches or clicks"], ["style", "Not my style"]] },
  lighting: { approve: [["mood", "Great mood"], ["readable", "Easy to see and read"], ["contrast", "Good contrast"], ["colors", "Nice colors"], ["cheap", "Cheap enough to run"], ["style", "My style"]],
    deny: [["dark", "Too dark"], ["washed", "Washed out"], ["foggy", "Too foggy"], ["flat", "Flat or harsh"], ["colors", "Bad colors"], ["costly", "Too costly (shadows, fog)"], ["style", "Not my style"]] },
  text: { approve: [["clear", "Clear"], ["voice", "Right voice"], ["short", "Short and punchy"], ["style", "My style"]],
    deny: [["long", "Too long"], ["bland", "Bland"], ["voice", "Wrong voice"], ["unclear", "Unclear"], ["style", "Not my style"]] },
  other: { approve: [["good", "Good work"], ["clean", "Clean, no glitches"], ["style", "My style"]], deny: [["plain", "Too plain"], ["broken", "Broken or glitchy"], ["style", "Not my style"]] },
};
const reasonsOf = (kind) => REASONS[kind] || REASONS.other;
const PAGE = 48, PAGE_MAX = 200, WAITING_MAX = 30, SETTLE_MS = 30 * 60e3;
// Optional Claude grading: lean read-only runs between rounds, advice only. "one" = the taste lens; "panel" = three.
const LENSES = { one: ["taste"], panel: ["form", "surface", "taste"] };
const LENS_TASK = { form: "Judge silhouette, proportions and readability at game distance.", surface: "Judge materials, colour, values, bevels and detail density.",
  taste: "Predict this user's own verdict from their taste and the examples." };
const LENS_IMG = { form: ["front", "side", "top", "clay"], surface: ["34", "front"], taste: ["34"] };
const CRITIC_MS = 5 * 60e3, DISTILL_EVERY = 10, DISTILL_QUIET = 10 * 60e3, RECHECK = 5 * 60e3;
// The autopilot's own caps, quiet hours and day (exported for this module), so critics wait when Training would.
const AP = () => { try { return require("./autopilot.js").guard || null; } catch { return null; } };
const pad = (n) => String(n).padStart(2, "0");
const day = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const flat = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const ms = (v) => { const n = typeof v === "number" ? v : Date.parse(v); return Number.isFinite(n) ? n : null; };
const plain = (x) => !!x && typeof x === "object" && !Array.isArray(x);
const arr = (v) => (Array.isArray(v) ? v : []);
const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
// Only plain local drive paths are ever touched by fs: opening \\host\share would make Windows try SMB.
const localPath = (p) => typeof p === "string" && /^[A-Za-z]:\\[^\\]/.test(p);

module.exports = (ctx) => {
  const LITE = !!ctx.LITE, BRAIN = ctx.BRAIN;
  // <brain>\taste\ since the library left the Training tab. The v1 folder (<brain>\training\taste\) is still read: its
  // items show until migrate() moves them (once, after a full backup; later arrivals are swept on every scan).
  const ROOT = process.env.HIVE_TASTE_DIR || path.join(BRAIN, "taste"), ITEMS = path.join(ROOT, "items");
  const OLD = process.env.HIVE_TASTE_OLD_DIR || path.join(BRAIN, "training", "taste"), OLD_ITEMS = path.join(OLD, "items");
  const AP_DIR = process.env.HIVE_AUTOPILOT_DIR || path.join(BRAIN, "autopilot");
  const SETTINGS = path.join(ROOT, "settings.json"), TASTE = path.join(ROOT, "taste.md"), PRINCIPLES = path.join(ROOT, "principles.md"); // v1 (all styles); now styles<id>principles.md
  const DAILY = LITE ? 6 : 12;

  /* ---------- small file helpers ---------- */
  function readText(f, cap) {
    try { const st = fs.statSync(f); if (!st.isFile()) return null; if (st.size <= cap) return fs.readFileSync(f, "utf8"); const b = Buffer.alloc(cap), fd = fs.openSync(f, "r"); try { fs.readSync(fd, b, 0, cap, 0); } finally { fs.closeSync(fd); } return b.toString("utf8"); } catch { return null; }
  }
  function readJson(f, cap = 256e3) { try { const o = JSON.parse(readText(f, cap) || "null"); return plain(o) ? o : null; } catch { return null; } }
  function writeJson(f, o) {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const data = JSON.stringify(o, null, 1);
    writeFileAtomic(f, data);
  }
  // The item's folder, or null. A junction pointing outside the library doesn't count. realpathSync.native is one call
  // (the JS realpathSync lstats every path component, which made a verdict take ~0.4 s with 140 models); both sides use
  // it, so 8.3 short names compare the same.
  function inBase(base, id) {
    const dir = path.join(base, id);
    try {
      const b = fs.realpathSync.native(base) + path.sep, real = fs.realpathSync.native(dir);
      if (!path.resolve(dir).startsWith(path.resolve(base) + path.sep) || !real.startsWith(b)) return null;
      return fs.statSync(real).isDirectory() ? dir : null;
    } catch { return null; }
  }
  // The new library first, then the v1 folder (compatibility read).
  function itemDir(id) {
    if (!ID.test(String(id || ""))) return null;
    return inBase(ITEMS, id) || inBase(OLD_ITEMS, id);
  }
  const listIds = (dir) => { try { return fs.readdirSync(dir).filter((f) => ID.test(f)); } catch { return []; } };
  const allIds = () => [...new Set(listIds(ITEMS).concat(listIds(OLD_ITEMS)))];

  /* ---------- the move from <brain>\training\taste\ ---------- */
  function walkFiles(dir) {
    const out = [];
    const w = (d, rel) => { let l = []; try { l = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of l) { const f = path.join(d, e.name); if (e.isDirectory()) w(f, rel + e.name + "/"); else { try { out.push(rel + e.name + ":" + fs.lstatSync(f).size); } catch {} } } };
    w(dir, "");
    return out.sort().join("\n");
  }
  const newest = (dir) => { let t = mtime(dir); try { for (const f of fs.readdirSync(dir)) t = Math.max(t, mtime(path.join(dir, f))); } catch {} return t; };
  // Once: a full copy of the old folder into <root>\backup\ (checked file by file), its settings.json and principles.md
  // carried over, a pointer left behind. Then every old item folder is moved (rename; copy + check + delete when a rename
  // can't). An item another folder already has is left where it is; one written to in the last 2 minutes waits.
  // Never throws; nothing is deleted before its copy is checked.
  function migrate() {
    markVersion(); vAt = 0;
    try {
      const ids = listIds(OLD_ITEMS), extras = ["settings.json", "principles.md"].filter((f) => fs.existsSync(path.join(OLD, f)));
      const marker = path.join(ROOT, "migrated.json");
      let mk = readJson(marker);
      if (!ids.length && (mk || !extras.length)) return { moved: 0 };
      if (!mk) {
        const bk = path.join(ROOT, "backup", "training-taste-" + new Date().toISOString().replace(/[:.]/g, "-"));
        fs.mkdirSync(path.dirname(bk), { recursive: true });
        fs.cpSync(OLD, bk, { recursive: true });
        if (walkFiles(OLD) !== walkFiles(bk)) { console.error(new Date().toISOString(), "taste: the backup of", OLD, "didn't match; nothing moved"); return { moved: 0, error: "backup" }; }
        if (fs.existsSync(path.join(OLD, "settings.json")) && !fs.existsSync(SETTINGS)) fs.copyFileSync(path.join(OLD, "settings.json"), SETTINGS);
        const gp = path.join(ROOT, "styles", "general", "principles.md");
        if (fs.existsSync(path.join(OLD, "principles.md")) && !fs.existsSync(gp)) { fs.mkdirSync(path.dirname(gp), { recursive: true }); fs.copyFileSync(path.join(OLD, "principles.md"), gp); }
        mk = { v: 1, at: new Date().toISOString(), from: OLD, backup: bk, items: ids.length };
        writeJson(marker, mk);
        const note = `# The Taste library moved\nIt now lives in ${ROOT}\\ (the user's taste: ${path.join(ROOT, "taste.md")}, one summary per style under ${path.join(ROOT, "styles")}\\<style>\\summary.md).\nA backup of this folder from before the move is in ${bk}\\. Model folders that still appear in items\\ here are moved there automatically.\n`;
        try { fs.writeFileSync(path.join(OLD, "README.md"), note); fs.writeFileSync(path.join(OLD, "taste.md"), note); } catch {}
        console.log(new Date().toISOString(), `taste: moved the library to ${ROOT} (backup in ${bk})`);
      }
      let moved = 0;
      for (const id of ids) {
        const src = path.join(OLD_ITEMS, id), dst = path.join(ITEMS, id);
        if (fs.existsSync(dst)) { warnOnce("dup:" + id, `taste: ${id} is in both libraries; the old copy stays in ${OLD_ITEMS}`); continue; }
        if (Date.now() - newest(src) < 2 * 60e3) continue; // still being written (a round that started before the move)
        fs.mkdirSync(ITEMS, { recursive: true });
        try { fs.renameSync(src, dst); moved++; }
        catch {
          try {
            fs.cpSync(src, dst, { recursive: true });
            if (walkFiles(src) === walkFiles(dst)) { fs.rmSync(src, { recursive: true, force: true }); moved++; }
            else fs.rmSync(dst, { recursive: true, force: true });
          } catch (e) { console.error(new Date().toISOString(), "taste: couldn't move", id, e && e.message || e); }
        }
      }
      if (moved) { cache.clear(); bytesCache.at = 0; }
      return { moved };
    } catch (e) { console.error(new Date().toISOString(), "taste migrate:", e && e.message || e); return { moved: 0, error: String(e && e.message || e) }; }
  }

  /* ---------- settings ---------- */
  // loopCritic: rounds have a separate critic agent review their work before it reaches the user's queue (on in the full
  // edition, off in Lite); items from rounds captured since it was switched on wait in "Unfinished" until their
  // critique.json is there. Items from before this version first ran (version.json "since", written once by start()
  // or the first migrate()) are never held back; without that file nothing is held back.
  const VERSION = path.join(ROOT, "version.json");
  const firstRun = () => { const v = readJson(VERSION, 4e3); const t = v && Number(v.since); return Number.isFinite(t) && t > 0 ? t : Infinity; };
  function markVersion() { try { if (!fs.existsSync(VERSION)) writeJson(VERSION, { v: 2, since: Date.now(), note: "When this Taste library version first ran; work made before it never waits for Claude's critic." }); } catch {} }
  const DEF = { critics: "off", criticsSince: 0, autoDistill: !LITE, distilledAt: 0, autoFreeDays: 30, loopCritic: !LITE, loopCriticSince: 0 };
  // The user's choices are signed; a settings.json the app didn't sign falls back to the defaults (grading off).
  // distilledAt is the curator's own bookkeeping and isn't signed.
  const SIGNED_V1 = ["critics", "criticsSince", "autoDistill", "autoFreeDays"], SIGNED = SIGNED_V1.concat(["loopCritic", "loopCriticSince"]);
  const setSig = (k, o, keys = SIGNED) => hmac(k, ["settings", ...keys.map((x) => o[x] ?? null)]);
  // Cached by the file's mtime and size and the key (every item's status asks).
  let setCache = { sig: "", v: null };
  function settings() {
    let st0 = null; try { st0 = fs.statSync(SETTINGS); } catch {}
    const csig = `${st0 ? st0.mtimeMs + ":" + st0.size : "none"}:${key() || ""}:${LITE}`;
    if (setCache.sig === csig && setCache.v) return { ...setCache.v, distilled: { ...setCache.v.distilled } };
    const v = readSettings();
    setCache = { sig: csig, v };
    return { ...v, distilled: { ...v.distilled } };
  }
  function readSettings() {
    const raw0 = readJson(SETTINGS) || {}, k = key();
    const ok2 = !!k && same(raw0.sig, setSig(k, raw0)), ok1 = !ok2 && !!k && same(raw0.sig, setSig(k, raw0, SIGNED_V1));
    const ok = ok2 || ok1, raw = ok1 ? { ...raw0, loopCritic: undefined, loopCriticSince: undefined } : raw0;
    if (!ok && k && Object.keys(raw).some((x) => SIGNED.includes(x))) warnOnce("settings", "taste: settings.json isn't signed by this app; using the defaults (Claude grading off)");
    const o = { ...DEF, ...(ok ? Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined)) : {}), distilledAt: raw.distilledAt ?? 0 };
    o.loopCritic = typeof o.loopCritic === "boolean" ? o.loopCritic : DEF.loopCritic;
    o.loopCriticSince = Number.isFinite(Number(o.loopCriticSince)) && Number(o.loopCriticSince) > 0 ? Number(o.loopCriticSince) : 0;
    if (LITE || !["off", "one", "panel"].includes(o.critics)) o.critics = "off";
    o.criticsSince = Number(o.criticsSince) || 0;
    o.autoDistill = !LITE && o.autoDistill !== false; // Lite: the curator runs only from its button
    o.distilledAt = Math.max(0, Math.floor(Number(o.distilledAt) || 0));
    const d = Math.floor(Number(o.autoFreeDays));
    o.autoFreeDays = d === 0 ? 0 : d >= 7 && d <= 365 ? d : 30;
    const dd = {};
    if (plain(raw.distilled)) for (const [k2, v] of Object.entries(raw.distilled).slice(0, 200)) if (SID.test(k2) && Number.isFinite(Number(v))) dd[k2] = Math.max(0, Math.floor(Number(v)));
    if (dd.general === undefined) dd.general = o.distilledAt;
    return { critics: o.critics, criticsSince: o.criticsSince, autoDistill: o.autoDistill, distilledAt: dd.general, distilled: dd, autoFreeDays: o.autoFreeDays, loopCritic: o.loopCritic, loopCriticSince: o.loopCriticSince };
  }
  function writeSettings(o) {
    const out = { critics: o.critics, criticsSince: o.criticsSince, autoDistill: o.autoDistill, distilledAt: o.distilledAt, autoFreeDays: o.autoFreeDays, loopCritic: o.loopCritic !== false, loopCriticSince: o.loopCriticSince || 0 }, k = key();
    if (plain(o.distilled)) out.distilled = o.distilled;
    if (k) out.sig = setSig(k, out);
    writeJson(SETTINGS, out);
    setCache.sig = "";
  }

  /* ---------- verdicts (signed) ---------- */
  // ctx.tasteKey() -> { key, write } or null. write is false under the plain-node fallback (no desktop window), where
  // the page check can't tell the window from another local program: there the library is read-only.
  function keyInfo() { try { const k = typeof ctx.tasteKey === "function" ? ctx.tasteKey() : null; return k && /^[0-9a-f]{64}$/.test(String(k.key)) ? k : null; } catch { return null; } }
  const key = () => { const k = keyInfo(); return k ? k.key : null; };
  const canWrite = () => { const k = keyInfo(); return !!(k && k.write); };
  const hmac = (k, list) => crypto.createHmac("sha256", k).update(JSON.stringify(list)).digest("hex");
  const same = (sig, want) => { if (typeof sig !== "string" || !/^[0-9a-f]{64}$/.test(sig)) return false; const a = Buffer.from(want, "hex"), b = Buffer.from(sig, "hex"); return a.length === b.length && crypto.timingSafeEqual(a, b); };
  const warned = new Set();
  const warnOnce = (k, msg) => { if (!warned.has(k)) { warned.add(k); console.log(new Date().toISOString(), msg); } };
  const sigOf = (k, v) => hmac(k, [v.id, v.decision, v.reasons, v.note, v.at, v.history || []]);
  function verify(v, id) {
    const k = key();
    return !!k && plain(v) && v.id === id && same(v.sig, sigOf(k, v));
  }
  // { v, ok, exists }: ok only for a verdict this app signed.
  function loadVerdict(dir, id) {
    const v = readJson(path.join(dir, "verdict.json"), 64e3), exists = fs.existsSync(path.join(dir, "verdict.json"));
    return { v, exists: exists && !!key(), ok: !!v && verify(v, id) };
  }

  /* ---------- Training's state (round titles, chats, the running round) ---------- */
  let apCache = { at: 0, m: -1, st: null };
  function apState() {
    if (Date.now() - apCache.at < 1000) return apCache.st; // one list asks once per item; skip the stat within a second
    const f = path.join(AP_DIR, "training.json"), m = mtime(f);
    if (apCache.m === m && Date.now() - apCache.at < 5000) return apCache.st;
    let st = null; try { st = JSON.parse(ctx.read(f) || "null"); } catch {}
    apCache = { at: Date.now(), m, st: plain(st) ? st : null };
    return apCache.st;
  }
  const runningRound = () => { const st = apState(); return st && st.active && plain(st.current) && Number.isInteger(st.current.n) ? st.current.n : null; };
  function roundInfo(n) {
    const st = apState(), log = st && Array.isArray(st.log) ? st.log : [];
    const out = { title: "", chatId: null, result: "", running: runningRound() === n };
    for (const e of log) {
      if (!plain(e) || e.n !== n) continue;
      if (e.title) out.title = flat(e.title, 140);
      if (e.chatId) out.chatId = String(e.chatId);
      if (e.type === "result") out.result = String(e.text || "").slice(0, 2000);
    }
    return out;
  }

  /* ---------- items ---------- */
  // about.md: "# Title", description lines, and a last "Guess: approve|deny — why" line (Claude's own guess, shown with
  // the critics, collapsed, so it doesn't sway the user).
  function parseAbout(text) {
    const lines = String(text || "").replace(/\r/g, "").split("\n");
    let title = "", guess = null;
    const keep = [];
    for (const l of lines) {
      const t = /^#\s+(.+)$/.exec(l), g = /^\s*\**guess\**\s*:\s*\**\s*(approve|deny)\b\**\s*[—–:-]*\s*(.*)$/i.exec(l);
      if (t && !title) { title = flat(t[1], 120); continue; }
      if (g) { guess = { lean: g[1].toLowerCase(), why: flat(g[2], 400) }; continue; }
      keep.push(l);
    }
    return { title, guess, about: keep.join("\n").trim() };
  }
  const roundOf = (id, cap, meta) => (Number.isInteger(cap && cap.round) ? cap.round : meta && meta.source && Number.isInteger(meta.source.round) ? meta.source.round : Number((/_r(\d+)-/.exec(id) || [])[1]) || null);
  const cache = new Map(); // id -> { sig, item }
  const STAMPED = ["capture.json", "item.json", "about.md", "verdict.json", "critics.json", "critique.json", "place.json", "lighting.json"];
  function stamp(dir) { return [dir, ...STAMPED].map((f, i) => mtime(i ? path.join(dir, f) : dir)).join(":"); }
  // item.json, re-checked field by field (rounds and chats write it too).
  function readMeta(dir) {
    const m = readJson(path.join(dir, "item.json"), 64e3);
    if (!m) return null;
    const src = plain(m.source) ? m.source : {};
    const files = arr(m.files).map((f) => (typeof f === "string" ? { file: f } : plain(f) ? f : null)).filter((f) => f && FILE.test(String(f.file || "")) && !META.test(f.file))
      .slice(0, LIMIT.files).map((f) => ({ file: f.file, label: flat(f.label, 80) }));
    return { kind: KINDS[m.kind] ? m.kind : null, title: flat(m.title, 120), style: typeof m.style === "string" && /^[a-z0-9][a-z0-9-]{0,40}$/.test(m.style) ? m.style : null,
      source: { type: SOURCES.includes(src.type) ? src.type : null, round: Number.isInteger(src.round) ? src.round : null, project: flat(src.project, 200), slug: /^[a-z0-9][a-z0-9-]{0,79}$/.test(src.slug || "") ? src.slug : null,
        n: Number.isInteger(src.n) ? src.n : null, chatId: /^[\w-]{1,64}$/.test(src.chatId || "") ? src.chatId : null, by: src.by === "user" ? "user" : "claude", auto: src.auto === true },
      revisionOf: ID.test(String(m.revisionOf || "")) ? m.revisionOf : null, changes: arr(m.changes).map((c) => flat(c, 200)).filter(Boolean).slice(0, 8), at: typeof m.at === "string" && ms(m.at) ? m.at : null, files };
  }
  const extOf = (f) => String(f).split(".").pop().toLowerCase();
  const isImg = (f) => /^(png|jpe?g|gif|webp|bmp|svg)$/.test(extOf(f));
  function loadItem(id, full, raw) {
    const dir = itemDir(id);
    if (!dir) return null;
    const sig = stamp(dir), hit = cache.get(id);
    let base = hit && hit.sig === sig ? hit.item : null;
    if (!base) {
      base = build(id, dir);
      if (!base) { cache.delete(id); return null; }
      cache.set(id, { sig, item: base });
    }
    const running = base.round != null && base.fromTraining && runningRound() === base.round;
    const settled = !running && (base.capture.phase === "done" || !base.capture.phase || Date.now() - base.capAt > SETTLE_MS);
    const generic = KINDS[base.kind].toLowerCase();
    const summary = { id, kind: base.kind, style: knownStyle(base.style), round: base.round, title: base.title || (base.round != null ? `Round ${base.round} ${generic}` : id), at: base.at, status: base.status, decision: base.decision,
      reasons: base.reasons, decidedAt: base.decidedAt, running, settled, unverified: base.unverified, guess: base.guess ? { lean: base.guess.lean } : null, source: base.source,
      critics: base.criticSum, thumb: base.thumb, stills: base.stills, frames: base.frames, files: base.files.length, revisionOf: base.revisionOf,
      critique: base.critique ? { score: base.critique.score, mustFix: base.critique.mustFix.length, skipped: !!base.critique.skipped } : null,
      freed: base.frames === 0 && Number(plain(base.capture.turntable) && base.capture.turntable.done) > 0, warnings: base.warnings, changes: base.changes, note: base.verdict ? base.verdict.note : "" };
    if (raw) return summary;
    finish(summary, settings(), revisions());
    if (!full) return summary;
    const prevOf = (pid) => { const p = pid && loadItem(pid, false); return p ? { id: p.id, title: p.title, kind: p.kind, thumb: p.thumb, status: p.status, stills: p.stills, comment: (() => { const d = itemDir(pid), v = d && loadVerdict(d, pid); return v && v.ok && v.v.decision === "comment" ? String(v.v.note || "") : ""; })() } : null; };
    const info = base.round != null && base.fromTraining ? roundInfo(base.round) : { title: "", chatId: null, result: "", running: false };
    if (!summary.title || summary.title === `Round ${base.round} ${generic}`) summary.title = base.title || info.title || summary.title;
    const blend = base.capture.blend;
    return { ...summary, about: base.about || (running ? "Claude is still writing its description." : info.result ? `(No description; from the round's summary)\n\n${info.result}` : ""), guess: base.guess,
      capture: { tris: base.capture.tris, dims: base.capture.dims, materials: base.capture.materials, engine: base.capture.engine, exposure: base.capture.exposure, seconds: base.capture.seconds, blender: base.capture.blender, warnings: base.warnings },
      images: base.images, fileList: base.files, lighting: base.lighting, critique: base.critique, verdict: base.verdict, critics: base.critics, round: base.round, roundInfo: info,
      chatId: base.source.chatId || info.chatId || null, previous: prevOf(base.revisionOf), next: summary.revisedBy ? prevOf(summary.revisedBy) : null,
      blend: typeof blend === "string" ? { path: blend, exists: localPath(blend) ? fs.existsSync(blend) : null } : null };
  }
  function build(id, dir) {
    const meta = readMeta(dir), cap = readJson(path.join(dir, "capture.json"), 64e3);
    const kind = meta && meta.kind ? meta.kind : cap ? "model" : null;
    if (!kind) return null;
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return null; }
    const images = {}, have = {};
    for (const f of names) {
      if (!IMG.test(f) && !FILE.test(f)) continue;
      try { const st = fs.lstatSync(path.join(dir, f)); if (st.isFile()) { have[f] = st; if (IMG.test(f)) images[f] = Math.floor(st.mtimeMs); } } catch {}
    }
    const file = (base) => (images[base + ".jpg"] ? base + ".jpg" : images[base + ".png"] ? base + ".png" : null);
    const stills = cap ? STILLS.filter((k) => file("still-" + k)) : [];
    if (cap && !stills.length && !(meta && meta.files.length)) return null;
    const files = (meta ? meta.files : []).filter((f) => have[f.file]).map((f) => ({ file: f.file, label: f.label, ext: extOf(f.file), bytes: have[f.file].size, v: Math.floor(have[f.file].mtimeMs),
      inline: !!MIME[extOf(f.file)] && !KEEP.has(extOf(f.file)) }));
    const ab = parseAbout(readText(path.join(dir, "about.md"), 8192));
    if (!stills.length && !files.length && !ab.about) return null;
    const vd = loadVerdict(dir, id), v = vd.ok ? vd.v : null;
    const decision = v && ["approve", "deny", "dismiss", "comment"].includes(v.decision) ? v.decision : null;
    const cr = readJson(path.join(dir, "critics.json"), 128e3);
    const ops = cr ? arr(cr.opinions).filter((o) => plain(o) && !o.error && (o.lean === "approve" || o.lean === "deny")) : [];
    const ap = ops.filter((o) => o.lean === "approve").length;
    const firstImg = files.find((f) => isImg(f.file));
    const thumbFile = file("thumb") || file("still-34") || (stills.length ? file("still-" + stills[0]) : null) || (firstImg && firstImg.file);
    const src = meta ? meta.source : { type: null, round: null, project: "", slug: null, n: null, chatId: null, by: "claude" };
    if (!src.type && cap) src.type = "training";
    const capAt = mtime(path.join(dir, cap ? "capture.json" : "item.json"));
    return {
      kind, round: roundOf(id, cap, meta), fromTraining: src.type === "training", title: ab.title || (meta && meta.title) || "", about: ab.about, guess: ab.guess,
      at: (meta && meta.at) || (cap && typeof cap.at === "string" ? cap.at : new Date(capAt || Date.now()).toISOString()),
      capAt, capture: cap || {}, warnings: arr(cap && cap.warnings).map((w) => flat(w, 200)).slice(0, 6), source: src, revisionOf: meta ? meta.revisionOf : null, changes: meta ? meta.changes : [],
      moved: !!placeOf(dir, id), style: placeOf(dir, id) || (meta && meta.style) || (cap && typeof cap.style === "string" && /^[a-z0-9][a-z0-9-]{0,40}$/.test(cap.style) ? cap.style : null),
      status: decision === "approve" ? "approved" : decision === "deny" ? "denied" : decision === "dismiss" ? "dismissed" : decision === "comment" ? "comment" : "review",
      decision, reasons: v && decision !== "comment" ? arr(v.reasons) : [], decidedAt: v && decision ? v.at : null, unverified: vd.exists && !vd.ok,
      verdict: v ? { decision, reasons: arr(v.reasons), note: String(v.note || ""), at: v.at, history: arr(v.history) } : null,
      critics: cr ? { mode: cr.mode, requested: cr.requested, pending: arr(cr.pending), skipped: String(cr.skipped || ""), opinions: arr(cr.opinions).filter(plain) } : null,
      criticSum: cr ? { lean: !ops.length ? null : ap * 2 > ops.length ? "approve" : ap * 2 < ops.length ? "deny" : "split", n: ops.length, pending: arr(cr.pending).length } : null,
      critique: readCritique(dir), lighting: kind === "lighting" ? readLighting(dir, have) : null,
      images, stills: stills.map((k) => file("still-" + k)), frames: Object.keys(images).filter((f) => f.startsWith("turn-")).length, files,
      thumb: thumbFile ? { file: thumbFile, v: images[thumbFile] || (have[thumbFile] ? Math.floor(have[thumbFile].mtimeMs) : 0) } : null,
    };
  }
  // critique.json: the round's own critic (a separate reviewer agent) on the FINAL version, advice only. Or
  // { skipped: "why" } when it went to the queue without one.
  function readCritique(dir) {
    const c = readJson(path.join(dir, "critique.json"), 64e3);
    if (!c) return null;
    const list = (v, n) => arr(v).map((x) => flat(typeof x === "string" ? x : plain(x) ? x.text || x.issue || "" : "", 300)).filter(Boolean).slice(0, n);
    const score = Number(c.score);
    return { score: Number.isFinite(score) ? Math.min(10, Math.max(0, Math.round(score * 10) / 10)) : null, summary: flat(c.summary || c.why, 600), mustFix: list(c.mustFix || c.must_fix, 8),
      niceToHave: list(c.niceToHave || c.nice_to_have, 8), fixed: list(c.fixed, 8), passes: Number.isInteger(c.passes) && c.passes > 0 ? Math.min(c.passes, 99) : null,
      pictures: Number.isInteger(c.pictures) && c.pictures >= 0 ? Math.min(c.pictures, 9999) : null, at: typeof c.at === "string" && ms(c.at) ? c.at : null, skipped: c.skipped ? flat(c.skipped, 200) : "" };
  }
  // lighting.json: fixed camera views shot before and after (optionally at times of day), the settings before and after,
  // and how to undo. Values: numbers, booleans, strings, colours as [r, g, b] (0-1), enums as "Enum.X.Y".
  const LKEY = /^[A-Za-z][\w ]{0,40}$/;
  function cleanSettings(s) {
    if (!plain(s)) return null;
    const val = (v) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "boolean" ? v : typeof v === "string" ? v.slice(0, 200)
      : Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number" && Number.isFinite(x)) ? v.map((x) => Math.round(x * 1000) / 1000) : undefined);
    const props = (o) => { const out = {}; if (plain(o)) for (const [k, v] of Object.entries(o).slice(0, 60)) { if (LKEY.test(k) && val(v) !== undefined) out[k] = val(v); } return out; };
    const children = arr(s.children).filter((c) => plain(c) && LKEY.test(String(c.class || "")) && LKEY.test(String(c.name || ""))).slice(0, 20).map((c) => ({ class: c.class, name: c.name, props: props(c.props) }));
    return { lighting: props(s.lighting), children };
  }
  function readLighting(dir, have) {
    const l = readJson(path.join(dir, "lighting.json"), 256e3);
    if (!l) return null;
    const pic = (f) => (typeof f === "string" && have[f] && isImg(f) ? f : null);
    const views = arr(l.views).filter(plain).slice(0, 8).map((v, i) => ({ name: flat(v.name, 60) || `View ${i + 1}`, before: pic(v.before), after: pic(v.after),
      camera: arr(v.camera).length === 12 && arr(v.camera).every((x) => typeof x === "number" && Number.isFinite(x)) ? v.camera : null,
      times: arr(v.times).filter(plain).slice(0, 6).map((t) => ({ time: flat(t.time, 20), before: pic(t.before), after: pic(t.after) })).filter((t) => t.time && (t.before || t.after)) }));
    const before = cleanSettings(l.before), after = cleanSettings(l.after);
    return { platform: ["roblox", "blender", "other"].includes(l.platform) ? l.platform : "other", place: flat(l.place, 120), test: l.test !== false,
      views, before, after, diff: settingsDiff(before, after), undo: String(l.undo || "").slice(0, 2000), undoLua: l.platform === "roblox" && before ? undoLua(before, after) : "" };
  }
  const show = (v) => (Array.isArray(v) ? `(${v.map((x) => +x.toFixed(2)).join(", ")})` : typeof v === "string" ? v.replace(/^Enum\.\w+\./, "") : String(v));
  // "Brightness 2 -> 3", "Bloom added", "Atmosphere Density 0.3 -> 0.45".
  function settingsDiff(a, b) {
    if (!a || !b) return [];
    const out = [], same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
    const props = (pa, pb, pre) => { for (const k of [...new Set(Object.keys(pa).concat(Object.keys(pb)))]) if (!same(pa[k], pb[k])) out.push({ key: pre + k, before: pa[k] === undefined ? null : show(pa[k]), after: pb[k] === undefined ? null : show(pb[k]) }); };
    props(a.lighting, b.lighting, "");
    const key = (c) => c.class + "/" + c.name, ca = new Map(a.children.map((c) => [key(c), c])), cb = new Map(b.children.map((c) => [key(c), c]));
    for (const [k, c] of cb) { if (!ca.has(k)) out.push({ key: c.name, before: null, after: "added" }); else props(ca.get(k).props, c.props, c.name + " "); }
    for (const [k, c] of ca) if (!cb.has(k)) out.push({ key: c.name, before: "there", after: "removed" });
    return out.slice(0, 80);
  }
  // A Luau script for Studio's command bar that puts the "before" lighting back (Lighting's properties, its effect
  // children re-created or reset, children the change added removed). Generated from the saved values only.
  function undoLua(a, b) {
    const lit = (v) => (typeof v === "number" ? String(v) : typeof v === "boolean" ? String(v) : Array.isArray(v) ? `Color3.new(${v.join(", ")})`
      : /^Enum\.\w+\.\w+$/.test(v) ? v : JSON.stringify(String(v)));
    const L = ["-- The Wise Hive Taste: put the lighting back to how it was before this change. Run it in the Command Bar of the TEST place.",
      'local L = game:GetService("Lighting")', "local function set(o, k, v) pcall(function() o[k] = v end) end"];
    for (const [k, v] of Object.entries(a.lighting)) L.push(`set(L, ${JSON.stringify(k)}, ${lit(v)})`);
    for (const c of a.children) {
      L.push(`do local c = L:FindFirstChild(${JSON.stringify(c.name)}) if not c then c = Instance.new(${JSON.stringify(c.class)}) c.Name = ${JSON.stringify(c.name)} c.Parent = L end`);
      for (const [k, v] of Object.entries(c.props)) L.push(`  set(c, ${JSON.stringify(k)}, ${lit(v)})`);
      L.push("end");
    }
    const had = new Set(a.children.map((c) => c.name));
    for (const c of (b ? b.children : [])) if (!had.has(c.name)) L.push(`do local c = L:FindFirstChild(${JSON.stringify(c.name)}) if c and c:IsA(${JSON.stringify(c.class)}) then c:Destroy() end end`);
    L.push('print("The Wise Hive: lighting put back")');
    return L.join("\n") + "\n";
  }
  // old id -> the newest revision of it; refreshed by every items() call.
  let rev = { at: 0, by: new Map() };
  function items() {
    const ids = allIds();
    for (const k of cache.keys()) if (!ids.includes(k)) cache.delete(k);
    const list = ids.map((id) => loadItem(id, false, true)).filter(Boolean);
    const by = new Map();
    for (const x of list.slice().sort(byAt)) if (x.revisionOf) by.set(x.revisionOf, x.id);
    rev = { at: Date.now(), by };
    const st = settings();
    for (const x of list) finish(x, st);
    return list;
  }
  const revisions = () => { if (Date.now() - rev.at > 1500) items(); return rev.by; };
  // A comment answered by a newer version is "revised". Work a round made waits in "unfinished" until its critic's
  // critique.json is there (critic on), or goes to the queue marked "not reviewed by Claude" (critic off).
  let vSince = Infinity, vAt = 0;
  function finish(x, st = settings(), by = rev.by) {
    if (Date.now() - vAt > 2000) { vSince = firstRun(); vAt = Date.now(); }
    x.revisedBy = by.get(x.id) || null;
    if (x.status === "comment" && x.revisedBy) x.status = "revised";
    const fromRound = (x.source.type === "training" || x.source.type === "working") && x.source.by !== "user";
    const since = Number.isFinite(ctx.tasteCriticSince) ? ctx.tasteCriticSince : Math.max(st.loopCriticSince || 0, vSince);
    const gated = fromRound && !x.critique && (ms(x.at) || 0) >= since && !x.source.auto;
    // Auto-collected round work (collectRound) has no critic run to wait for: it goes to the queue, marked not reviewed.
    x.notCritiqued = (gated && !st.loopCritic) || (fromRound && !x.critique && x.source.auto === true);
    if (x.status === "review" && gated && st.loopCritic) x.status = "unfinished";
    return x;
  }
  function counts(list = items()) {
    const c = { review: 0, comment: 0, approved: 0, denied: 0, dismissed: 0, unfinished: 0, revised: 0, total: list.length, today: 0 }, d = day();
    for (const it of list) { c[it.status] = (c[it.status] || 0) + 1; if (it.id.startsWith(d)) c.today++; }
    return c;
  }
  const byAt = (a, b) => String(a.at).localeCompare(String(b.at)) || a.id.localeCompare(b.id);
  const STATUSES = ["review", "comment", "approved", "denied", "dismissed", "unfinished", "revised", "all"];
  // f: { style, kind } filters ("" or "all" = every style / kind); "scope" is the filtered set the tab counts come from.
  function page(status, offset, limit, f = {}) {
    const all = items();
    const st = f.style && f.style !== "all" ? f.style : null, kd = f.kind && KINDS[f.kind] ? f.kind : null;
    const scope = all.filter((x) => (!st || x.style === st) && (!kd || x.kind === kd));
    const want = STATUSES.includes(status) ? status : "review";
    let list = want === "all" ? scope.filter((x) => x.status !== "dismissed").concat(scope.filter((x) => x.status === "dismissed")) : scope.filter((x) => x.status === want);
    list = want === "review" ? list.sort(byAt) : list.sort((a, b) => byAt(b, a));
    const off = Math.max(0, Math.floor(Number(offset) || 0)), lim = Math.min(PAGE_MAX, Math.max(1, Math.floor(Number(limit) || PAGE)));
    return { all, scope, list: list.slice(off, off + lim), total: list.length, offset: off, limit: lim, status: want, style: st || "all", kind: kd || "all" };
  }
  // How often Claude's own guess (and the critics) matched the user, over decided items. Only opinions given before
  // the verdict count.
  function agreement(list = items()) {
    const out = { guess: { n: 0, agree: 0 }, critics: { n: 0, agree: 0 } };
    for (const s of list) {
      if (s.status !== "approved" && s.status !== "denied") continue;
      const it = loadItem(s.id, true), user = it.decision;
      if (it.guess) { out.guess.n++; if (it.guess.lean === user) out.guess.agree++; }
      const before = it.critics ? it.critics.opinions.filter((o) => !o.error && (o.lean === "approve" || o.lean === "deny") && ms(o.at) != null && ms(o.at) <= ms(it.decidedAt)) : [];
      if (before.length) {
        const ap = before.filter((o) => o.lean === "approve").length, lean = ap * 2 > before.length ? "approve" : ap * 2 < before.length ? "deny" : null;
        out.critics.n++; if (lean === user) out.critics.agree++;
      }
    }
    return out;
  }

  // Disk used by the library (shown under "Your taste"); a walk of every item, so cached for 10 minutes.
  let bytesCache = { at: 0, n: 0 };
  function diskBytes() {
    if (Date.now() - bytesCache.at < 10 * 60e3) return bytesCache.n;
    let n = 0;
    try { for (const id of allIds()) { const d = itemDir(id); if (!d) continue; try { for (const f of fs.readdirSync(d)) { try { n += fs.lstatSync(path.join(d, f)).size; } catch {} } } catch {} } } catch {}
    bytesCache = { at: Date.now(), n };
    return n;
  }

  /* ---------- styles: named taste profiles; every item belongs to one ("general" by default) ---------- */
  const STYLES = path.join(ROOT, "styles.json"), STYLE_DIR = path.join(ROOT, "styles"), PICKS = path.join(ROOT, "picks.json");
  const SID = /^[a-z0-9][a-z0-9-]{0,40}$/;
  const GENERAL = { id: "general", name: "General", description: "Anything that has no style of its own yet.", archived: false, at: null };
  let stylesCache = { m: -1, list: null };
  // styles.json { styles: [{ id, name, description, archived, at }] }, written only by the app (from the page). General
  // is always there and can be renamed or described, never archived.
  function styles() {
    const m = mtime(STYLES);
    if (stylesCache.m === m && stylesCache.list) return stylesCache.list;
    const raw = readJson(STYLES, 128e3) || {}, seen = new Set(["general"]);
    let general = { ...GENERAL };
    const list = [];
    for (const s of arr(raw.styles).filter(plain).slice(0, 100)) {
      const id = String(s.id || ""), name = flat(s.name, 60);
      if (!SID.test(id) || !name) continue;
      const st = { id, name, description: flat(s.description, 400), archived: id !== "general" && s.archived === true, at: typeof s.at === "string" ? s.at : null };
      if (id === "general") { general = { ...st, archived: false }; continue; }
      if (seen.has(id)) continue;
      seen.add(id); list.push(st);
    }
    stylesCache = { m, list: [general, ...list] };
    return stylesCache.list;
  }
  const styleById = (id) => styles().find((s) => s.id === id) || null;
  const knownStyle = (id) => (id && styleById(id) ? id : "general");
  function saveStyles(list) { writeJson(STYLES, { v: 1, styles: list }); stylesCache.m = -1; }
  function editStyle(b) {
    const list = styles().slice(), act = String(b.action || ""), name = flat(b.name, 60), desc = flat(b.description, 400);
    const clash = (n, not) => list.some((s) => s.id !== not && s.name.toLowerCase() === n.toLowerCase());
    if (act === "create") {
      if (!name) return fail(400, "Give the style a name.");
      if (clash(name)) return fail(400, "There's already a style with that name.");
      if (list.length >= 100) return fail(400, "That's a lot of styles; archive some first.");
      let id = slugOf(name).slice(0, 36); if (!SID.test(id)) id = "style";
      for (let i = 2; list.some((s) => s.id === id); i++) id = `${slugOf(name).slice(0, 32)}-${i}`;
      list.push({ id, name, description: desc, archived: false, at: new Date().toISOString() });
      saveStyles(list); rebuildTaste(); broadcast({ kind: "styles" });
      return { code: 200, body: { style: styleById(id), styles: stylesView() } };
    }
    const s = list.find((x) => x.id === String(b.id || ""));
    if (!s) return fail(404, "That style isn't there.");
    if (act === "update") {
      if (b.name !== undefined) { if (!name) return fail(400, "A style needs a name."); if (clash(name, s.id)) return fail(400, "There's already a style with that name."); s.name = name; }
      if (b.description !== undefined) s.description = desc;
    } else if (act === "archive" || act === "restore") {
      if (s.id === "general") return fail(400, "General can't be archived.");
      s.archived = act === "archive";
    } else return fail(400, "Unknown action.");
    saveStyles(list.map((x) => (x.id === s.id ? { ...s } : x))); rebuildTaste(); broadcast({ kind: "styles" });
    return { code: 200, body: { style: styleById(s.id), styles: stylesView() } };
  }
  // The user's picks: { training: "<style id>" | "", projects: { "<project folder, lower case>": "<style id>" } }.
  // "" (or none) = let the round planner choose.
  function picks() {
    const raw = readJson(PICKS, 64e3) || {}, out = { training: "", projects: {} };
    if (SID.test(String(raw.training || ""))) out.training = raw.training;
    if (plain(raw.projects)) for (const [k, v] of Object.entries(raw.projects).slice(0, 200)) if (typeof k === "string" && k.length < 400 && SID.test(String(v || ""))) out.projects[k] = v;
    return out;
  }
  function savePick(b) {
    const p = picks(), st = String(b.style || "");
    if (st && !styleById(st)) return fail(404, "That style isn't there.");
    if (b.mode === "training") p.training = st;
    else if (b.mode === "working") {
      const dir = String(b.project || "").trim();
      if (!localPath(dir)) return fail(400, "Pick a project first.");
      if (st) p.projects[dir.toLowerCase()] = st; else delete p.projects[dir.toLowerCase()];
    } else return fail(400, "Unknown mode.");
    writeJson(PICKS, p);
    broadcast({ kind: "styles" });
    return { code: 200, body: { picks: picks() } };
  }
  // The style a round uses: the user's pick wins, then the planner's choice, then General.
  function styleFor(mode, projectDir, planned) {
    const p = picks(), mine = mode === "working" ? p.projects[String(projectDir || "").toLowerCase()] : p.training;
    const ok = (id) => { const s = id && styleById(id); return s && !s.archived ? s : null; };
    if (ok(mine)) return { ...ok(mine), by: "you" };
    if (ok(planned)) return { ...ok(planned), by: "planner" };
    return { ...styleById("general"), by: "default" };
  }
  // A move to another style is the user's (from the page): place.json, signed like a verdict.
  const placeSig = (k, p) => hmac(k, ["place", p.id, p.style, p.at]);
  function placeOf(dir, id) {
    const p = readJson(path.join(dir, "place.json"), 8e3), k = key();
    return p && k && p.id === id && SID.test(String(p.style || "")) && same(p.sig, placeSig(k, p)) ? p.style : null;
  }
  function release(id) {
    const dir = itemDir(id), it = dir && loadItem(id, false);
    if (!it) return fail(404, "That item isn't in the library.");
    if (fs.existsSync(path.join(dir, "critique.json"))) return { code: 200, body: { item: loadItem(id, true) } };
    writeJson(path.join(dir, "critique.json"), { skipped: "You put it in your queue before Claude's critic looked at it.", at: new Date().toISOString() });
    cache.delete(id); broadcast({ kind: "items", id });
    return { code: 200, body: { item: loadItem(id, true) } };
  }
  function moveStyle(id, b) {
    const st = String(b.style || ""), dir = itemDir(id);
    if (!dir || !loadItem(id, false)) return fail(404, "That item isn't in the library.");
    if (!styleById(st)) return fail(404, "That style isn't there.");
    const k = key();
    if (!k) return fail(503, "Taste changes are saved only in The Wise Hive desktop app.");
    const p = { id, style: st, at: new Date().toISOString() };
    p.sig = placeSig(k, p);
    writeJson(path.join(dir, "place.json"), p);
    cache.delete(id); rebuildTaste(); broadcast({ kind: "items", id });
    return { code: 200, body: { item: loadItem(id, true) } };
  }
  function stylesView(list = items()) {
    return styles().map((s) => {
      const mine = list.filter((x) => x.style === s.id), c = counts(mine);
      return { ...s, counts: { review: c.review, approved: c.approved, denied: c.denied, comment: c.comment, unfinished: c.unfinished, total: c.total }, summary: path.join(STYLE_DIR, s.id, "summary.md") };
    });
  }

  /* ---------- the taste summaries (deterministic, free): one per style, plus an index ---------- */
  const label = (dec, k, kind) => { const r = (reasonsOf(kind || "model")[dec] || []).find((x) => x[0] === k); return r ? r[1] : k; };
  const stampNow = () => { const d = new Date(); return `${day(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const principlesFile = (sid) => path.join(STYLE_DIR, sid, "principles.md");
  // Sections in priority order (principles, reason counts, the user's own words newest first, what they asked to
  // change), so a cut at the prompt caps drops the oldest quotes first. Never holds image paths.
  function buildTaste(list = items(), sid = "general") {
    const s = styleById(sid) || { ...GENERAL, id: sid, name: sid };
    const mine = list.filter((x) => x.style === sid);
    const decided = mine.filter((x) => x.status === "approved" || x.status === "denied")
      .sort((a, b) => String(b.decidedAt).localeCompare(String(a.decidedAt)));
    const comments = mine.filter((x) => x.decision === "comment").sort((a, b) => String(b.decidedAt).localeCompare(String(a.decidedAt)));
    const ap = decided.filter((x) => x.decision === "approve"), dn = decided.filter((x) => x.decision === "deny");
    const pr = readText(principlesFile(sid), 16e3) || "";
    const prHead = flat((/^#\s+(.+)$/m.exec(pr) || [])[1] || "Principles (Taste curator)", 120);
    const bullets = pr.split(/\r?\n/).filter((l) => /^\s*[-*]\s+/.test(l)).slice(0, 8).map((l) => "- " + flat(l.replace(/^\s*[-*]\s+/, ""), 160));
    const L = [`# The user's taste: ${s.name}`, `Built by The Wise Hive from the user's own reviews in the Taste tab, for the style "${s.name}"${s.description ? ` (${flat(s.description, 200)})` : ""}. Rebuilt after every review; don't edit.`];
    if (!decided.length && !bullets.length && !comments.length) return { text: L[0] + "\n\nNo reviews yet.\n", reviews: 0, comments: 0 };
    L.push(`Updated ${stampNow()} · ${ap.length} approved · ${dn.length} denied${comments.length ? ` · ${comments.length} sent back with a comment` : ""}.`);
    if (bullets.length) L.push("", "## " + prHead, ...bullets);
    const tally = (xs, dec) => { const m = new Map(); for (const x of xs) for (const k of x.reasons) { const l = label(dec, k, x.kind); m.set(l, (m.get(l) || 0) + 1); } return [...m].sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l} (${n})`).join(", "); };
    const ta = tally(ap, "approve"), td = tally(dn, "deny");
    if (ta) L.push("", "## They approve for", ta);
    if (td) L.push("", "## They deny for", td);
    const kindOf = (x) => (x.kind && x.kind !== "model" ? ` [${KINDS[x.kind].toLowerCase()}]` : "");
    const words = decided.filter((x) => String(x.note || "").trim()).slice(0, 8)
      .map((x) => `- ${x.decision === "approve" ? "Approved" : "Denied"} "${flat(x.title, 60)}"${kindOf(x)}${x.round != null ? ` (round ${x.round})` : ""}: ${flat(x.note, 140)}`);
    if (words.length) L.push("", "## In their own words (newest first)", ...words);
    const asks = comments.slice(0, 6).map((x) => `- "${flat(x.title, 60)}"${kindOf(x)}: ${flat(x.note, 160)}`);
    if (asks.length) L.push("", "## They asked for changes (newest first)", ...asks);
    return { text: L.join("\n") + "\n", reviews: decided.length, comments: comments.length };
  }
  // Every style's summary.md, and taste.md: an index of the styles and where their summaries are.
  // only: the styles whose summary changed (default: all); the index is always rewritten (cheap).
  function rebuildTaste(only) {
    try {
      const list = items();
      if (!list.length && !fs.existsSync(ITEMS) && !fs.existsSync(OLD_ITEMS) && !fs.existsSync(STYLES)) return null;
      const ids = [...new Set(styles().map((s) => s.id).concat(list.map((x) => x.style)))];
      const idx = ["# The user's taste (The Wise Hive Taste library)", `Built by The Wise Hive from the user's own reviews, one summary per style. Rebuilt after every review; don't edit. Updated ${stampNow()}.`, "", "## Styles"];
      let general = null;
      for (const sid of ids) {
        const f = path.join(STYLE_DIR, sid, "summary.md");
        let b;
        if (!only || only.includes(sid) || !fs.existsSync(f)) {
          b = buildTaste(list, sid);
          fs.mkdirSync(path.dirname(f), { recursive: true });
          if (ctx.read(f) !== b.text) fs.writeFileSync(f, b.text);
        } else b = { reviews: list.filter((x) => x.style === sid && (x.status === "approved" || x.status === "denied")).length };
        if (sid === "general") general = b;
        const s = styleById(sid) || { name: sid, description: "", archived: false };
        idx.push(`- ${s.name} (${sid})${s.archived ? " [archived]" : ""}${s.description ? `: ${flat(s.description, 200)}` : ""}. ${b.reviews} review${b.reviews === 1 ? "" : "s"}. Summary: ${f}`);
      }
      fs.mkdirSync(ROOT, { recursive: true });
      fs.writeFileSync(TASTE, idx.join("\n") + "\n");
      return general;
    } catch (e) { console.error(new Date().toISOString(), "taste.md:", e && e.message || e); return null; }
  }
  // A style's taste for a prompt: its summary without the title lines, cut at a line boundary; "" while it is empty.
  function tasteText(max, b = buildTaste()) {
    if (!b.reviews && !b.comments && !/^## Principles/m.test(b.text)) return "";
    const lines = b.text.split("\n").slice(3);
    while (lines.length && !lines[0].trim()) lines.shift();
    let out = "";
    for (const l of lines) { if (out.length + l.length + 1 > max) break; out += l + "\n"; }
    return out.trim();
  }

  /* ---------- write side: only from the app window ---------- */
  // ctx.isPage (server.js): Origin present and ours, Sec-Fetch-Site same-origin, and under Electron the per-launch key.
  function pageOnly(req) {
    if (typeof ctx.isPage === "function") return !!ctx.isPage(req);
    const h = req.headers || {}, mine = [`http://127.0.0.1:${ctx.PORT}`, `http://localhost:${ctx.PORT}`];
    return mine.includes(h.origin) && h["sec-fetch-site"] === "same-origin";
  }
  const broadcast = (o) => { try { ctx.broadcast({ t: "taste", ...o }); } catch {} };
  // Turntables, animation videos and page screenshots, made in the background (taste-view.js). Only in the desktop app
  // (it renders with Blender and Electron), or when a test asks for it.
  const views = ctx.tasteViews === false || (!process.versions.electron && ctx.tasteViews !== true) ? null : makeViews({ ITEMS, APP_DIR: ctx.APP_DIR || __dirname, itemDir, allIds,
    onChange: (id) => { cache.delete(id); bytesCache.at = 0; broadcast({ kind: "items", id }); },
    log: (m) => console.error(new Date().toISOString(), m) });
  const fail = (code, error) => ({ code, body: { error } });
  function verdict(id, b) {
    const d = String(b.decision || "");
    if (!["approve", "deny", "dismiss", "comment", "clear"].includes(d)) return fail(400, "Pick Approve, Deny or Comment.");
    const cur = loadItem(id, false);
    const known = cur && reasonsOf(cur.kind)[d] ? reasonsOf(cur.kind)[d].map((r) => r[0]) : [];
    const reasons = [...new Set(arr(b.reasons).map(String))].filter((k) => known.includes(k)).slice(0, 6);
    const note = String(b.note ?? "").trim().slice(0, 1000);
    if ((d === "approve" || d === "deny") && !reasons.length && note.length < 3) return fail(400, "Pick a reason or write a few words: Claude learns your taste from the why.");
    if (d === "comment" && note.length < 3) return fail(400, "Write what to change: Claude revises it and puts the new version back in your queue.");
    const dir = itemDir(id);
    if (!dir || !cur) return fail(404, "That item isn't in the library.");
    const old = loadVerdict(dir, id);
    // Only a verdict this app signed carries its history forward; anything else is dropped, not merged.
    if (old.exists && !old.ok) console.log(new Date().toISOString(), "taste: ignored an unsigned verdict.json for", id);
    let history = old.ok ? arr(old.v.history).slice() : [];
    if (old.ok && old.v.decision) history.push({ decision: old.v.decision, reasons: arr(old.v.reasons), note: String(old.v.note || ""), at: old.v.at });
    history = history.slice(-20);
    const v = { v: 1, id, decision: d === "clear" ? null : d, reasons: d === "clear" || d === "dismiss" || d === "comment" ? [] : reasons, note: d === "clear" ? "" : note, at: new Date().toISOString(), by: "user", history };
    const k = key();
    if (!k) return fail(503, "Reviews are saved only in The Wise Hive desktop app.");
    v.sig = sigOf(k, v);
    writeJson(path.join(dir, "verdict.json"), v);
    cache.delete(id);
    if (d !== "clear") dropCritics(id, "you reviewed it first");
    rebuildTaste([cur.style]);
    broadcast({ kind: "verdict", id });
    maybeDistill(cur.style);
    return { code: 200, body: { item: loadItem(id, true) } };
  }
  function saveSettings(o) {
    const cur = settings(), next = { ...cur };
    if (["off", "one", "panel"].includes(o.critics)) next.critics = LITE ? "off" : o.critics;
    if (typeof o.autoDistill === "boolean") next.autoDistill = !LITE && o.autoDistill;
    if (o.autoFreeDays !== undefined) { const d = Math.floor(Number(o.autoFreeDays)); if (d === 0 || (d >= 7 && d <= 365)) next.autoFreeDays = d; }
    if (cur.critics === "off" && next.critics !== "off") next.criticsSince = Date.now();
    if (typeof o.loopCritic === "boolean") { next.loopCritic = o.loopCritic; if (o.loopCritic && !cur.loopCritic) next.loopCriticSince = Date.now(); }
    writeSettings(next);
    if (next.critics === "off" && cur.critics !== "off") dropAllCritics("grading was turned off");
    broadcast({ kind: "settings" });
    if (next.critics !== "off") setTimeout(scan, 500);
    return settings();
  }
  // Free space: delete the spin frames and the extra stills; keep the 3/4 still, the thumb, the verdict and the notes.
  function freeItem(id) {
    const dir = itemDir(id);
    if (!dir) return 0;
    let n = 0;
    for (const f of fs.readdirSync(dir)) {
      if (!IMG.test(f) || !(/^turn-/.test(f) || (/^still-/.test(f) && !/^still-34./.test(f)))) continue;
      const p = path.join(dir, f);
      try { const st = fs.lstatSync(p); if (st.isFile()) { fs.rmSync(p); n += st.size; } } catch {}
    }
    cache.delete(id); bytesCache.at = 0;
    return n;
  }
  function free(id, b) {
    if (!b || b.confirm !== true) return fail(400, "Confirm first: this deletes the spin frames and extra stills.");
    const it = loadItem(id, false);
    if (!it) return fail(404, "That model isn't in the library.");
    if (!["approved", "denied", "dismissed", "revised"].includes(it.status)) return fail(400, "Review it first; only reviewed models can be slimmed.");
    freeItem(id);
    broadcast({ kind: "items" });
    return { code: 200, body: { item: loadItem(id, true) } };
  }
  // Reviewed models older than autoFreeDays are slimmed the same way (cleanup.js never touches training).
  function autoFree() {
    const days = settings().autoFreeDays;
    if (!days) return 0;
    let n = 0, bytes = 0;
    for (const it of items()) {
      if (!["approved", "denied", "dismissed", "revised"].includes(it.status) || !(ms(it.decidedAt) < Date.now() - days * 864e5)) continue;
      if (!it.frames && it.stills.length <= 1) continue;
      bytes += freeItem(it.id); n++;
    }
    if (n) console.log(new Date().toISOString(), `taste: slimmed ${n} reviewed model${n === 1 ? "" : "s"} older than ${days} days (${(bytes / 1048576).toFixed(1)} MB freed)`);
    return n;
  }

  /* ---------- optional Claude grading (critics) and the Taste curator ---------- */
  const MODEL = process.env.HIVE_TASTE_MODEL || "claude-sonnet-5-5"; // tests may use a cheaper model
  const criticsFile = (dir) => path.join(dir, "critics.json");
  const qSig = (k, id, cr) => hmac(k, ["critics", id, cr.mode, cr.requested, cr.queuedAt]);
  const queueOk = (id, cr) => { const k = key(); return !!k && plain(cr) && same(cr.qsig, qSig(k, id, cr)); };
  // critics.json is the persistent queue: "pending" names the lenses still to run, so a restart picks them up again.
  function dropCritics(id, why) {
    Q.list = Q.list.filter((x) => x !== id);
    const dir = itemDir(id), cr = dir && readJson(criticsFile(dir), 128e3);
    if (!cr || !arr(cr.pending).length) return;
    cr.pending = []; cr.skipped = why;
    writeJson(criticsFile(dir), cr); cache.delete(id);
  }
  function dropAllCritics(why) {
    for (const it of items()) if (it.critics && it.critics.pending) dropCritics(it.id, why);
    Q.list = [];
    broadcast({ kind: "critics" });
  }
  function enqueue(id, requested) {
    const dir = itemDir(id);
    if (!dir) return false;
    const st = settings(), mode = st.critics !== "off" ? st.critics : "one";
    const old = readJson(criticsFile(dir), 128e3), k = key();
    if (!k) return false;
    // A manual Ask replaces older opinions. qsig: only queues this app wrote are run or resumed after a restart.
    const cr = { mode, requested, queuedAt: new Date().toISOString(), pending: LENSES[mode].slice(), skipped: "", opinions: requested === "user" ? [] : arr(old && old.opinions) };
    cr.qsig = qSig(k, id, cr);
    writeJson(criticsFile(dir), cr);
    cache.delete(id);
    if (!Q.list.includes(id)) Q.list.push(id);
    broadcast({ kind: "critics", id });
    pump();
    return true;
  }
  // Why critics must wait right now, or null: a round running, Training's quiet hours or daily cap, usage too close to
  // Training's cap (or unreadable), or the user playing.
  async function held() {
    for (const r of ctx.live ? ctx.live.values() : []) if (r && !r.done && (r.kind === "training" || r.kind === "working")) return "a round is running";
    const G = AP(), st = apState();
    let capPct = 97, gaming = true;
    if (G) {
      const g = G.guardOf(st && st.guard);
      gaming = g.gaming !== false;
      if (g.quiet.on && G.inQuiet(g.quiet)) return "quiet hours";
      const cap = G.CAPS[g.cap] || G.CAPS.default, d = st && plain(st.daily) && st.daily.day === G.day(new Date(Date.now())) ? st.daily : { rounds: 0, cost: 0 };
      if ((cap.rounds && d.rounds >= cap.rounds) || (cap.usd && d.cost >= cap.usd)) return "Training's daily cap";
      if (cap.pct) capPct = cap.pct;
    }
    const u = ctx.usage;
    if (!u || typeof u.over !== "function") return "can't read usage";
    try { await u.ensure(); } catch {}
    if (!(Date.now() - (u.readAt() || 0) <= 15 * 60e3)) return "can't read usage";
    const o = u.over(Math.min(85, capPct - 10), [MODEL]);
    if (o) return `usage at ${Math.floor(o.top.percent)}%`;
    if (gaming && typeof u.isGaming === "function") { try { const gm = await u.isGaming(); if (gm && gm.gaming) return "you're playing"; } catch {} }
    return null;
  }
  // One lean run; resolves { text, error, cost }. Killed after `limit` ms.
  function ask(opts, limit = CRITIC_MS) {
    return new Promise((done) => {
      let text = null, acc = "", cost = 0, error = false, id = null, timer = null;
      try {
        id = ctx.runClaude({ ...opts, onEvent: (ev) => {
          if (ev.type === "stream_event" && ev.event && ev.event.delta && ev.event.delta.type === "text_delta") acc += ev.event.delta.text;
          if (ev.type === "result") { text = String(ev.result || ""); error = !!ev.is_error || (ev.subtype && ev.subtype !== "success") || /not logged in/i.test(text); if (typeof ev.total_cost_usd === "number") cost = ev.total_cost_usd; }
        }, onEnd: (code, err) => { clearTimeout(timer); done({ text: text ?? acc, error: error || text == null, cost, err: String(err || "").slice(-300) }); } });
      } catch (e) { done({ text: "", error: true, cost: 0, err: String(e) }); return; }
      timer = setTimeout(() => { try { if (id && ctx.stopRun) ctx.stopRun(id, "timeout"); } catch {} }, limit);
      if (timer.unref) timer.unref();
    });
  }
  function parseCritique(text) {
    const t = String(text || ""), m = /<critique>([\s\S]*?)<\/critique>/.exec(t), raw = m ? m[1] : t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1);
    let o; try { o = JSON.parse(raw); } catch { return null; }
    if (!plain(o) || (o.lean !== "approve" && o.lean !== "deny")) return null;
    const list = (v) => arr(v).map((x) => flat(x, 200)).filter(Boolean).slice(0, 3);
    return { lean: o.lean, score: Math.min(10, Math.max(1, Math.round(Number(o.score) || 5))), why: flat(o.why, 400), good: list(o.good), fix: list(o.fix) };
  }
  function criticPrompt(it, dir, lens) {
    const file = (k) => it.stills.find((f) => f.startsWith("still-" + k + "."));
    const imgs = LENS_IMG[lens].map(file).filter(Boolean).map((f) => path.join(dir, f));
    if (!imgs.length) imgs.push(path.join(dir, it.stills[0]));
    const taste = tasteText(1500);
    let examples = "";
    if (lens === "taste") {
      const judged = items().filter((x) => (x.status === "approved" || x.status === "denied") && x.id !== it.id && x.thumb).sort((a, b) => String(b.decidedAt).localeCompare(String(a.decidedAt)));
      const pick = judged.filter((x) => x.status === "approved").slice(0, 2).concat(judged.filter((x) => x.status === "denied").slice(0, 1));
      for (const x of pick) imgs.push(path.join(itemDir(x.id) || path.join(ITEMS, x.id), x.thumb.file));
      if (pick.length) examples = "\nModels they judged (thumbnails, in the list above): " + pick.map((x) => `"${flat(x.title, 60)}" (${path.join(itemDir(x.id) || path.join(ITEMS, x.id), x.thumb.file)}): ${x.status}${x.reasons.length ? " for " + x.reasons.map((k) => label(x.decision, k, x.kind)).join(", ") : ""}`).join("; ");
    }
    const c = it.capture || {};
    return `You are the TASTE CRITIC (${lens}) of The Wise Hive app. Claude built the 3D model below in a training round. The USER decides whether it is approved; you only give advice, shown to the user next to the model. ${LENS_TASK[lens]}
First, in ONE reply, Read all of these images with parallel Read calls: ${imgs.join(", ")}. Then answer; don't read anything else.
${taste ? `The user's taste so far (from their own reviews):\n${taste}${examples}\n` : examples ? examples.trim() + "\n" : ""}Claude's description: ${flat(it.about, 1500) || "(none)"}
Measured facts: ${c.tris ?? "?"} tris, ${arr(c.materials).join(", ") || "no materials"}, ${arr(c.dims).map((d) => Number(d).toFixed(2)).join(" x ") || "?"} m.
Answer only with: <critique>{"lean":"approve" or "deny","score":1-10,"why":"one or two sentences","good":["up to 3"],"fix":["up to 3 concrete changes"]}</critique>`;
  }
  async function runLens(id, lens) {
    const dir = itemDir(id), it = dir && loadItem(id, true);
    if (!it) return { lens, at: new Date().toISOString(), error: "The model is gone." };
    const r = await ask({ prompt: criticPrompt(it, dir, lens), cwd: BRAIN, mode: "read", model: MODEL, maxTurns: 10, lean: "Read",
      job: { kind: "taste", name: `Taste critic (${lens}): ${flat(it.title, 60)}`, icon: "critic" } });
    const op = r.error ? null : parseCritique(r.text);
    return op ? { lens, at: new Date().toISOString(), ...op, cost: r.cost } : { lens, at: new Date().toISOString(), error: flat(r.text || r.err || "no answer", 200) || "no answer", cost: r.cost };
  }
  // One item at a time, its lenses in sequence; before each lens, wait while held() says so.
  const Q = { list: [], busy: null, waiting: null, running: false, wake: null };
  const nap = (t) => new Promise((ok) => { const tm = setTimeout(fin, t); function fin() { clearTimeout(tm); Q.wake = null; ok(); } Q.wake = fin; if (tm.unref) tm.unref(); });
  async function pump() {
    if (Q.running) { if (Q.wake) Q.wake(); return; }
    Q.running = true;
    try {
      while (Q.list.length) {
        const id = Q.list[0], dir = itemDir(id), cr = dir && readJson(criticsFile(dir), 128e3);
        if (!cr || !arr(cr.pending).length || !queueOk(id, cr)) { Q.list.shift(); continue; }
        const it = loadItem(id, false);
        if (!it || (it.status !== "review" && cr.requested !== "user")) { dropCritics(id, "you reviewed it first"); continue; }
        const why = await held();
        if (why) {
          if (Q.waiting !== why) { Q.waiting = why; broadcast({ kind: "critics" }); }
          await nap(ctx.tasteRecheck ?? RECHECK);
          continue;
        }
        if (Q.waiting) { Q.waiting = null; broadcast({ kind: "critics" }); }
        const lens = cr.pending[0];
        Q.busy = { id, lens };
        broadcast({ kind: "critics", id });
        const op = LENS_TASK[lens] ? await runLens(id, lens) : { lens, at: new Date().toISOString(), error: "unknown lens" };
        Q.busy = null;
        const now = readJson(criticsFile(dir), 128e3) || cr;
        now.opinions = arr(now.opinions).filter((o) => !(plain(o) && o.lens === lens && o.at === op.at)).concat([op]);
        now.pending = arr(now.pending).filter((x) => x !== lens);
        writeJson(criticsFile(dir), now); cache.delete(id);
        broadcast({ kind: "critics", id });
      }
    } catch (e) { console.error(new Date().toISOString(), "taste critics:", e && e.stack || e); }
    finally { Q.running = false; Q.busy = null; }
  }
  // New models: a debounced scan after each Training round ends (and every 2 minutes) refreshes the badge count.
  let lastCount = -1;
  function scan() {
    try {
      if (migrate().moved) broadcast({ kind: "items" });
      ingest();
      const list = items(), n = counts(list).review;
      if (n !== lastCount) { lastCount = n; broadcast({ kind: "items", count: n }); }
      queueEligible(list);
    } catch (e) { console.error(new Date().toISOString(), "taste scan:", e && e.message || e); }
  }
  // Claude grading on: queue each new, settled model captured after grading was turned on (never the old backlog).
  function queueEligible(list = items()) {
    const st = settings();
    if (LITE || st.critics === "off") return;
    for (const it of list) if (it.status === "review" && it.settled && !it.critics && (ms(it.at) || 0) >= st.criticsSince) enqueue(it.id, "auto");
    if (Q.wake) Q.wake();
  }

  /* ---------- the Taste curator: distills the reviews into a few principles ---------- */
  // Per style: one curator run at a time and one pending timer each, so a verdict in one style can't swallow another's run.
  const distilling = new Map(), distillTimers = new Map();
  // { lines: the newest 60 reviews for the prompt, total: every decided review (what distilledAt counts) }.
  function reviewLines(sid = "general") {
    const decided = items().filter((x) => x.style === sid && (x.status === "approved" || x.status === "denied"));
    const lines = decided.map((x) => loadItem(x.id, true)).filter(Boolean)
      .sort((a, b) => String(b.decidedAt).localeCompare(String(a.decidedAt))).slice(0, 60)
      .map((x) => `- ${x.decision === "approve" ? "APPROVED" : "DENIED"} ${KINDS[x.kind].toLowerCase()} "${flat(x.title, 70)}"${x.round != null ? ` (round ${x.round})` : ""}. Reasons: ${x.reasons.map((k) => label(x.decision, k, x.kind)).join(", ") || "none"}.${x.verdict.note ? ` Note: "${flat(x.verdict.note, 300)}".` : ""} Claude: "${flat(x.about, 160)}"`);
    return { lines, total: decided.length };
  }
  function distill(sid = "general") {
    if (!styleById(sid)) sid = "general";
    if (distilling.has(sid)) return distilling.get(sid);
    const run = (async () => {
      const { lines, total } = reviewLines(sid);
      if (!lines.length) return { error: "Review a few items in this style first." };
      const s = styleById(sid);
      const prompt = `You are the TASTE CURATOR of The Wise Hive app. The user reviewed work Claude made (3D models, images, pixel art, audio, lighting and more) in the style "${s.name}"${s.description ? ` (${flat(s.description, 300)})` : ""}. Each line below is one piece: the user's verdict, the kind of work, their reasons, their note, and Claude's one-line description. Write the user's taste in this style as 3 to 8 short principles a maker can act on (shape, proportion, detail level, materials, colour, mood, sound, readability). Use only what the reviews show; where reviews disagree, say so; strongest evidence first; end each principle with "(n reviews)". Do not use tools.
Answer only with:
<principles>
- …
</principles>

REVIEWS (newest first):
${lines.join("\n")}`;
      const r = await ask({ prompt, cwd: BRAIN, mode: "read", model: LITE ? "claude-haiku-5-5" : MODEL, maxTurns: 1, lean: true, tools: "",
        job: { kind: "taste", name: "Taste curator: summing up your reviews", icon: "reviewer" } }, CRITIC_MS);
      const m = /<principles>([\s\S]*?)<\/principles>/.exec(r.text || "");
      const bullets = (m ? m[1] : "").split(/\r?\n/).filter((l) => /^\s*[-*]\s+\S/.test(l)).slice(0, 8).map((l) => "- " + flat(l.replace(/^\s*[-*]\s+/, ""), 160));
      if (r.error || !bullets.length) return { error: /not logged in/i.test(r.text || "") ? "Claude Code isn't signed in." : "The curator didn't return principles." };
      fs.mkdirSync(ROOT, { recursive: true });
      const from = lines.length < total ? `the newest ${lines.length} of ${total} reviews` : `${total} review${total === 1 ? "" : "s"}`;
      fs.mkdirSync(path.dirname(principlesFile(sid)), { recursive: true });
      fs.writeFileSync(principlesFile(sid), `# Principles (Taste curator, ${day()}, from ${from})\n${bullets.join("\n")}\n`);
      // distilled[style] counts every decided review in the style (maybeDistill compares it), not the capped prompt lines.
      const cur = settings();
      writeSettings({ ...cur, distilled: { ...cur.distilled, [sid]: total }, distilledAt: sid === "general" ? total : cur.distilledAt });
      rebuildTaste();
      broadcast({ kind: "summary", style: sid });
      return { text: buildTaste(items(), sid).text, style: sid };
    })().finally(() => { if (distilling.get(sid) === run) distilling.delete(sid); });
    distilling.set(sid, run);
    return run;
  }
  // Full only: after 10 new reviews and 10 minutes without another verdict (a busy review session gives one run).
  function maybeDistill(sid = "general") {
    if (LITE) return;
    clearTimeout(distillTimers.get(sid));
    const arm = (fn, wait) => { const t = setTimeout(fn, wait); if (t.unref) t.unref(); distillTimers.set(sid, t); };
    arm(async function check() {
      distillTimers.delete(sid);
      try {
        const c = counts(items().filter((x) => x.style === sid)), st = settings(), n = c.approved + c.denied;
        if (!st.autoDistill || n - (st.distilled[sid] || 0) < DISTILL_EVERY) return;
        if (await held()) { if (!distillTimers.has(sid)) arm(check, DISTILL_QUIET); return; } // a newer verdict's timer checks then
        await distill(sid);
      } catch (e) { console.error(new Date().toISOString(), "taste curator:", e && e.message || e); }
    }, ctx.tasteDistillDelay ?? DISTILL_QUIET);
  }
  // The button: runs at once, unless a round is running and usage is already within 10 points of Training's cap.
  async function distillNow(sid) {
    const running = [...(ctx.live ? ctx.live.values() : [])].some((r) => r && !r.done && (r.kind === "training" || r.kind === "working"));
    if (running && ctx.usage && typeof ctx.usage.over === "function") {
      const G = AP(), st = apState(), g = G && G.guardOf(st && st.guard), cap = G && (G.CAPS[g.cap] || G.CAPS.default);
      if (ctx.usage.over(((cap && cap.pct) || 97) - 10, [LITE ? "claude-haiku-5-5" : MODEL])) return { code: 200, body: { error: "Usage is close to the cap; try again later." } };
    }
    return { code: 200, body: await distill(SID.test(String(sid || "")) ? sid : "general") };
  }

  /* ---------- adding work: the inbox, uploads, round cards and chats ---------- */
  const INBOX = path.join(ROOT, "inbox");
  const slugOf = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36).replace(/-+$/, "") || "item";
  function newId(title) {
    const base = `${day()}_${slugOf(title)}`, have = new Set(allIds());
    for (let i = 1; i < 1000; i++) { const id = i === 1 ? base : `${base}-${i}`; if (!have.has(id) && !fs.existsSync(path.join(ITEMS, id))) return id; }
    return `${base}-${crypto.randomBytes(3).toString("hex")}`;
  }
  const safeName = (name) => {
    let b = path.win32.basename(String(name || "")).replace(/[^\w.-]+/g, "_").replace(/^[^A-Za-z0-9]+/, "").slice(-100);
    if (!FILE.test(b)) b = "file_" + crypto.randomBytes(3).toString("hex") + (/\.[A-Za-z0-9]{1,8}$/.exec(b) || [".bin"])[0];
    return META.test(b) ? "x-" + b : b;
  };
  const allowedExt = (f) => !!MIME[extOf(f)] || KEEP.has(extOf(f));
  // A pixel-art guess for small PNG/GIF images (their header holds the size): both sides 256 px or less.
  function smallImage(buf) {
    try {
      if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return buf.readUInt32BE(16) <= 256 && buf.readUInt32BE(20) <= 256;
      if (buf.length > 10 && buf.toString("latin1", 0, 3) === "GIF") return buf.readUInt16LE(6) <= 256 && buf.readUInt16LE(8) <= 256;
    } catch {}
    return false;
  }
  function guessKind(files, lighting) {
    if (lighting) return "lighting";
    const kinds = files.map((f) => EXT_KIND[extOf(f.name)] || "other");
    for (const k of ["model", "video", "audio", "pixel"]) if (kinds.includes(k)) return k;
    if (kinds.includes("image")) return files.filter((f) => EXT_KIND[extOf(f.name)] === "image").every((f) => f.small) ? "pixel" : "image";
    return kinds.includes("text") ? "text" : "other";
  }
  // Paths a round or chat may hand over (copied in, never moved): the brain (not app-settings), project folders, the
  // user's Desktop/Downloads/Pictures/Music/Videos/Documents and temp. Never anything under .claude, .ssh, .gnupg or the
  // desktop app's data folder (where the signing key lives). Only known work extensions.
  const HOME = ctx.HOME || require("os").homedir();
  function srcRoots() {
    const r = [BRAIN, require("os").tmpdir(), ...["Desktop", "Downloads", "Pictures", "Music", "Videos", "Documents"].map((d) => path.join(HOME, d))];
    try { for (const d of (typeof ctx.configuredFolders === "function" ? ctx.configuredFolders() : [])) r.push(d); } catch {}
    try { const w = JSON.parse(ctx.read(path.join(AP_DIR, "working.json")) || "null"); if (w && w.project && typeof w.project.dir === "string") r.push(w.project.dir); } catch {}
    return r.filter(localPath).map((d) => { try { return fs.realpathSync.native(d).toLowerCase() + path.sep; } catch { return null; } }).filter(Boolean);
  }
  const DENY = /\\(app-settings|\.claude|\.ssh|\.gnupg|appdata\\roaming\\teamwright)(\\|$)/i;
  function srcOk(p) {
    if (!localPath(p) || /[\0<>|?*"]/.test(p) || p.indexOf(":", 2) >= 0 || !allowedExt(p)) return null;
    let real; try { real = fs.realpathSync.native(p); } catch { return null; }
    if (!localPath(real) || DENY.test(real)) return null;
    const lc = real.toLowerCase();
    if (!srcRoots().some((r) => lc.startsWith(r))) return null;
    try { const st = fs.statSync(real); return st.isFile() && st.size <= LIMIT.file ? real : null; } catch { return null; }
  }
  // Makes an item folder from { kind?, title, about, style, source, revisionOf, files: [{ name, src | buf, label }],
  // lighting, critique, guess }. Throws an Error with a message for the page.
  function createItem(o) {
    const files = arr(o.files).slice(0, LIMIT.files + 1);
    if (files.length > LIMIT.files) throw new Error(`At most ${LIMIT.files} files per item.`);
    let total = 0;
    for (const f of files) {
      if (!allowedExt(f.name)) throw new Error(`The Wise Hive doesn't keep .${extOf(f.name)} files in the Taste library.`);
      const n = f.buf ? f.buf.length : fs.statSync(f.src).size;
      if (n > LIMIT.file) throw new Error(`${path.win32.basename(f.name)} is over ${LIMIT.file >> 20} MB.`);
      total += n;
      if (f.buf && isImg(f.name)) f.small = smallImage(f.buf);
      else if (f.src && /\.(png|gif)$/i.test(f.name)) { try { const b = Buffer.alloc(32), fd = fs.openSync(f.src, "r"); try { fs.readSync(fd, b, 0, 32, 0); } finally { fs.closeSync(fd); } f.small = smallImage(b); } catch {} }
    }
    if (total > LIMIT.item) throw new Error(`That's over ${LIMIT.item >> 20} MB in all.`);
    const kind = KINDS[o.kind] ? o.kind : guessKind(files, o.lighting);
    if (!files.length && !(kind === "text" && String(o.about || "").trim())) throw new Error("Add at least one file.");
    const title = flat(o.title, 120) || flat(files.length ? path.win32.basename(files[0].name).replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ") : "Text", 120);
    const id = newId(title), dir = path.join(ITEMS, id);
    fs.mkdirSync(ITEMS, { recursive: true });
    fs.mkdirSync(dir);
    try {
      const names = new Map(), used = new Set(), list = [];
      for (const f of files) {
        let n = safeName(f.name);
        for (let i = 2; used.has(n.toLowerCase()); i++) n = n.replace(/(-\d+)?(\.[^.]+)$/, `-${i}$2`);
        used.add(n.toLowerCase());
        if (f.buf) fs.writeFileSync(path.join(dir, n), f.buf); else fs.copyFileSync(f.src, path.join(dir, n));
        names.set(String(f.name), n); names.set(path.win32.basename(String(f.name)), n);
        list.push({ file: n, label: flat(f.label, 80) });
      }
      const st = typeof o.style === "string" && /^[a-z0-9][a-z0-9-]{0,40}$/.test(o.style) ? o.style : null;
      const src = plain(o.source) ? o.source : {};
      const meta = { v: 2, kind, title, style: st, at: new Date().toISOString(), revisionOf: ID.test(String(o.revisionOf || "")) ? o.revisionOf : null, changes: arr(o.changes).map((c) => flat(c, 200)).filter(Boolean).slice(0, 8),
        source: { type: SOURCES.includes(src.type) ? src.type : "upload", round: Number.isInteger(src.round) ? src.round : null, project: flat(src.project, 200) || null,
          slug: src.slug || null, n: Number.isInteger(src.n) ? src.n : null, chatId: src.chatId || null, by: src.by === "user" ? "user" : "claude", ...(src.auto === true ? { auto: true } : {}) }, files: list };
      writeJson(path.join(dir, "item.json"), meta);
      if (String(o.about || "").trim() || o.guess) {
        const g = plain(o.guess) && ["approve", "deny"].includes(o.guess.lean) ? `\nGuess: ${o.guess.lean} — ${flat(o.guess.why, 300)}` : "";
        fs.writeFileSync(path.join(dir, "about.md"), `# ${title}\n${String(o.about || "").replace(/^#\s.*\n?/, "").trim().slice(0, 6000)}${g}\n`);
      }
      if (plain(o.critique)) writeJson(path.join(dir, "critique.json"), o.critique);
      if (kind === "lighting" && plain(o.lighting)) {
        const re = (x) => (typeof x === "string" ? names.get(x) || names.get(path.win32.basename(x)) || null : null);
        const l = o.lighting;
        writeJson(path.join(dir, "lighting.json"), { ...l, views: arr(l.views).filter(plain).slice(0, 8).map((v) => ({ ...v, before: re(v.before), after: re(v.after),
          times: arr(v.times).filter(plain).slice(0, 6).map((t) => ({ ...t, before: re(t.before), after: re(t.after) })) })) });
      }
    } catch (e) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} throw e; }
    cache.delete(id); bytesCache.at = 0;
    if (views) setImmediate(() => views.add(id));
    return id;
  }
  // The inbox: <root>\inbox\<any folder>\item.json (written LAST), with files in the folder or full paths to existing
  // files. Picked up on every scan; a folder that fails gets error.txt and is tried again only after item.json changes.
  function ingest() {
    let names = [];
    try { names = fs.readdirSync(INBOX, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith("_")).map((d) => d.name); } catch { return []; }
    const made = [];
    // Only folders that are ready (item.json written, not failed since, nothing written in the last 3 s), so failed or
    // half-written folders sorting first can't use up the 20 per scan and stall the inbox.
    const ready = names.filter((name) => {
      const dir = path.join(INBOX, name), mf = path.join(dir, "item.json");
      return fs.existsSync(mf) && mtime(path.join(dir, "error.txt")) < mtime(mf) && Date.now() - newest(dir) >= 3000;
    });
    for (const name of ready.slice(0, 20)) {
      const dir = path.join(INBOX, name), mf = path.join(dir, "item.json");
      try {
        const raw = readJson(mf, 256e3);
        if (!raw) throw new Error("item.json isn't a JSON object.");
        let real; try { real = fs.realpathSync.native(dir); } catch { throw new Error("The folder can't be read."); }
        // A file named relative to the folder must really be inside it: a junction or link in the folder could point at
        // anything (say C:\Users\<user>\.claude), so the resolved path has to stay under the folder and pass DENY.
        const inside = (f) => {
          let r; try { r = fs.realpathSync.native(f); } catch { return null; }
          return r.toLowerCase().startsWith(real.toLowerCase() + path.sep) && !DENY.test(r) && fs.statSync(r).isFile() ? r : null;
        };
        const pick = (x) => {
          const p = typeof x === "string" ? x : plain(x) ? String(x.path || x.file || "") : "";
          if (!p) return null;
          if (localPath(p)) { const ok = srcOk(p); if (!ok) throw new Error(`Can't use ${p}: it isn't a work file in an allowed folder.`); return { name: p, src: ok, label: plain(x) ? x.label : "" }; }
          const f = path.join(real, p), ok = /(^|[\\/])\.\.([\\/]|$)/.test(p) || /^[\\/]/.test(p) ? null : inside(f);
          if (!ok) throw new Error(`${p} isn't in the folder.`);
          if (!allowedExt(f)) throw new Error(`The Wise Hive doesn't keep .${extOf(f)} files.`);
          return { name: p, src: ok, label: plain(x) ? x.label : "" };
        };
        let files = arr(raw.files).map(pick).filter(Boolean);
        if (!raw.files) files = fs.readdirSync(real).filter((f) => !META.test(f) && allowedExt(f)).map((f) => ({ name: f, src: inside(path.join(real, f)) })).filter((x) => x.src);
        const lighting = plain(raw.lighting) ? raw.lighting : readJson(path.join(real, "lighting.json"), 256e3);
        const critique = plain(raw.critique) ? raw.critique : readJson(path.join(real, "critique.json"), 64e3);
        const about = typeof raw.about === "string" ? raw.about : readText(path.join(real, "about.md"), 8192) || "";
        const id = createItem({ kind: raw.kind, title: raw.title, about, style: raw.style, source: raw.source, revisionOf: raw.revisionOf, changes: raw.changes, files, lighting, critique, guess: raw.guess });
        made.push(id);
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (e) { try { fs.writeFileSync(path.join(dir, "error.txt"), `${new Date().toISOString()} ${e && e.message || e}\n`); } catch {} }
    }
    if (made.length) { rebuildTaste(); broadcast({ kind: "items" }); }
    return made;
  }
  // Page-only adds: an upload (base64 files), pictures from a Working round card, or a file a chat showed.
  function upload(b) {
    const files = arr(b.files).slice(0, LIMIT.files + 1).map((f) => {
      if (!plain(f) || typeof f.data !== "string") throw new Error("Bad file.");
      const buf = Buffer.from(f.data.replace(/^data:[^,]*,/, ""), "base64");
      if (!buf.length) throw new Error("An empty file.");
      return { name: String(f.name || "file"), buf };
    });
    let lighting = null;
    const lj = files.findIndex((f) => /^lighting\.json$/i.test(path.win32.basename(f.name)));
    if (lj >= 0) { try { lighting = JSON.parse(files[lj].buf.toString("utf8")); } catch { throw new Error("lighting.json isn't valid JSON."); } files.splice(lj, 1); }
    return createItem({ kind: b.kind, title: b.title, about: b.about, style: b.style, files, lighting, source: { type: "upload", by: "user" } });
  }
  function importFrom(b) {
    if (b.from === "round") {
      const slug = String(b.slug || ""), n = Number(b.n);
      if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug) || !Number.isInteger(n) || n < 0) throw new Error("Bad round.");
      const rdir = path.join(BRAIN, "working", slug, "rounds", String(n));
      const card = readJson(path.join(rdir, "card.json"), 256e3) || {};
      const files = arr(b.files).slice(0, 12).map((f) => {
        if (!/^[A-Za-z0-9][\w.-]{0,99}\.(png|jpe?g|webp|gif)$/i.test(String(f))) throw new Error("Bad picture name.");
        const p = srcOk(path.join(rdir, f));
        if (!p) throw new Error(`${f} isn't in that round any more.`);
        return { name: f, src: p };
      });
      if (!files.length) throw new Error("Pick a picture.");
      return createItem({ kind: b.kind || "image", title: b.title || flat(card.title, 100) || `Working round ${n}`, about: b.about || flat(card.summary, 1200), style: b.style,
        files, source: { type: "working", slug, n, project: plain(card.project) ? card.project.name : "", chatId: card.chatId || null, by: "user" } });
    }
    if (b.from === "media") {
      const m = typeof ctx.mediaFile === "function" ? ctx.mediaFile(String(b.id || "")) : null;
      const p = m && srcOk(m.file);
      if (!p) throw new Error("That file isn't available any more, or isn't a kind of work the Taste library keeps.");
      return createItem({ kind: b.kind, title: b.title || path.win32.basename(m.name || p).replace(/\.[^.]+$/, ""), about: b.about, style: b.style,
        files: [{ name: m.name || path.win32.basename(p), src: p }], source: { type: "chat", chatId: /^[\w-]{1,64}$/.test(String(b.chatId || "")) ? b.chatId : null, by: "user" } });
    }
    throw new Error("Unknown source.");
  }
  // Open (allowlisted file types, checked by their first bytes as in chat media) or Show in folder.
  async function openFile(id, b) {
    const dir = itemDir(id), m = dir && readMeta(dir), name = String(b.file || "");
    if (!m || !m.files.some((f) => f.file === name)) return fail(404, "That file isn't in the item.");
    const f = path.join(dir, name);
    if (!fs.existsSync(f)) return fail(404, "That file is gone.");
    if (process.env.HIVE_MEDIA_DRYRUN === "1" || ctx.tasteDry) return { code: 200, body: { ok: true, dry: true, action: b.action } };
    const shell = process.versions.electron ? require("electron").shell : null;
    const { execFile } = require("child_process");
    if (b.action === "reveal") { if (shell) shell.showItemInFolder(f); else execFile("explorer.exe", ["/select," + f], { windowsHide: false }, () => {}); return { code: 200, body: { ok: true } }; }
    let ok = false;
    try { const mod = require("./media.js"); ok = await mod.openable(f, fs.statSync(f)); } catch {}
    if (!ok) return fail(400, "For safety, this kind of file can only be shown in its folder.");
    if (shell) { const err = await shell.openPath(f); return err ? fail(500, err) : { code: 200, body: { ok: true } }; }
    execFile("explorer.exe", [f], { windowsHide: false }, () => {});
    return { code: 200, body: { ok: true } };
  }
  const made = (fn) => { try { const id = fn(); rebuildTaste(); broadcast({ kind: "items" }); return { code: 200, body: { item: loadItem(id, true) } }; } catch (e) { return fail(400, String(e && e.message || e)); } };

  /* ---------- routes ---------- */
  function sendImage(res, id, file) {
    if (!ID.test(id) || !(IMG.test(file) || (FILE.test(file) && !META.test(file) && MIME[extOf(file)]))) return ctx.json(res, 400, { error: "bad name" });
    const dir = itemDir(id);
    if (!dir) return ctx.json(res, 404, { error: "not found" });
    if (!IMG.test(file)) { const m = readMeta(dir); if (!m || !m.files.some((x) => x.file === file)) return ctx.json(res, 404, { error: "not found" }); }
    const f = path.join(dir, file);
    let st; try { st = fs.lstatSync(f); } catch {}
    if (!st || !st.isFile()) return ctx.json(res, 404, { error: "not found" });
    res.writeHead(200, { "Content-Type": TYPE[path.extname(file)] || MIME[extOf(file)], "Content-Length": st.size, "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox", "Cross-Origin-Resource-Policy": "same-origin" });
    fs.createReadStream(f).on("error", () => { try { res.end(); } catch {} }).pipe(res);
  }
  function list(url) {
    const q = url ? url.searchParams : new URLSearchParams();
    const pg = page(q.get("status"), q.get("offset"), q.get("limit"), { style: q.get("style"), kind: q.get("kind") });
    const st = settings();
    return { items: pg.list, total: pg.total, offset: pg.offset, limit: pg.limit, status: pg.status, style: pg.style, kind: pg.kind, counts: counts(pg.scope), countsAll: counts(pg.all),
      settings: st, lite: LITE, readOnly: !canWrite(), styles: stylesView(pg.all), picks: picks(),
      reasons: REASONS, kinds: KINDS, agreement: agreement(pg.scope), critics: { busy: Q.busy, queued: Q.list.length, waiting: Q.waiting }, taste: { updatedAt: mtime(TASTE) || null, reviews: pg.all.filter((x) => x.status === "approved" || x.status === "denied").length } };
  }

  /* ---------- prompt blocks for Training and Working (autopilot.js) ---------- */
  const CAPTURE_SRC = path.join(ctx.APP_DIR || __dirname, "blender", "taste_capture.py");
  const CAPTURE = path.join(BRAIN, "blender", "scripts", "taste_capture.py");
  const LUA_SRC = path.join(ctx.APP_DIR || __dirname, "roblox", "taste_lighting.luau");
  const LUA = path.join(BRAIN, "roblox", "scripts", "taste_lighting.luau");
  const indent = (t) => t.split("\n").map((l) => "    " + l).join("\n");
  const q = (s) => JSON.stringify(String(s));
  // Comments the user left that no newer version answers yet, oldest first. Training revises everything not made by
  // a Working round; a Working round revises its own project's.
  function openComments(mode, project, list = items()) {
    const name = String(project && project.name || "").toLowerCase();
    return list.filter((x) => x.status === "comment" && (mode === "working" ? x.source.type === "working" && String(x.source.project || "").toLowerCase() === name && !!name : x.source.type !== "working"))
      .sort((a, b) => String(a.decidedAt).localeCompare(String(b.decidedAt)));
  }
  const by = (s) => (s.by === "you" ? "picked by the user" : s.by === "planner" ? "chosen by the planner" : "the default");
  // kind "planner": o = { mode, project }; kind "worker": o = { n, date, mode, style, styleBy, revises, project, cardDir }.
  // Only called while a round is starting (never on a GET). Never throws: a broken taste module must not break a round.
  function prompt(kind, o = {}) {
    try {
      const mode = o.mode === "working" ? "working" : "training";
      const list = items(), c = counts(list), st = settings();
      if (kind === "planner") {
        const ss = styles().filter((s) => !s.archived), p = picks();
        const mine = mode === "working" ? p.projects[String(o.project && o.project.dir || "").toLowerCase()] : p.training;
        const pick = mine && ss.find((s) => s.id === mine);
        const one = pick || (ss.length === 1 ? ss[0] : null);
        const t = one ? tasteText(LITE ? 600 : 1500, buildTaste(list, one.id)) : "";
        const com = openComments(mode, o.project, list).slice(0, LITE ? 3 : 6);
        if (!t && !c.review && !com.length && ss.length === 1 && mode === "training" && !pick) return "";
        const L = [`THE USER'S TASTE (Taste library, from their own reviews; aim for what they approve, avoid what they deny${c.review ? `; ${c.review} item${c.review === 1 ? "" : "s"} still wait for their review` : ""}).`];
        if (ss.length > 1 || pick) {
          L.push("STYLES (id: name: description):", ...ss.map((s) => `- ${s.id}: ${s.name}${s.description ? `: ${flat(s.description, LITE ? 120 : 200)}` : ""}`));
          L.push(pick ? `The user picked the style "${pick.name}" for ${mode === "working" ? "this project" : "these rounds"}: plan for it.`
            : `The user hasn't picked a style: choose the one that fits the goal${mode === "working" ? " and project" : ""} (or "general"), add "style": "<its id>" to your JSON, and name it in "why".`);
        }
        if (t) L.push(`THE TASTE FOR "${one.name}":`, t);
        if (com.length) {
          L.push(`OPEN COMMENTS (the user sent these back with what to change; plan a revision of the first one BEFORE anything new, and add "revises": "<its id>" to your JSON):`);
          for (const x of com) L.push(`- ${x.id}: "${flat(x.title, 80)}" (${KINDS[x.kind].toLowerCase()}, style ${x.style}): "${flat(x.note, 300)}"`);
        }
        if (mode === "training") L.push("Plan at most one review pass in a round; the user grades the result.");
        return L.join("\n");
      }
      if (kind !== "worker") return "";
      fs.mkdirSync(ITEMS, { recursive: true });
      const n = Number.isInteger(o.n) ? o.n : 0, date = /^\d{4}-\d{2}-\d{2}$/.test(o.date || "") ? o.date : day();
      const sty = styleById(o.style) || styleById("general"), sid = sty.id, styleBy = ["you", "planner"].includes(o.styleBy) ? o.styleBy : "default";
      const dir = path.join(ITEMS, `${date}_r${n}-1`);
      const src = mode === "working" ? `{"type":"working","project":${q(o.project && o.project.name || "")}}` : `{"type":"training","round":${n}}`;
      const rv = o.revises && ID.test(o.revises) ? loadItem(o.revises, true) : null;
      let out = `- Taste library (${ROOT}\\): the user judges your work themselves in The Wise Hive window; you never approve or deny it, and you never call The Wise Hive app's HTTP API (127.0.0.1:${ctx.PORT || 4747}). Never create or edit verdict.json, place.json or critics.json, or settings.json, styles.json, picks.json, taste.md, summary.md or principles.md; they belong to the user and the app.\n`;
      out += `- Style for this round: "${sty.name}" (${sid}; ${by({ by: styleBy })})${sty.description ? `: ${flat(sty.description, 300)}` : ""}. Its taste is at the end of these rules (file: ${path.join(STYLE_DIR, sid, "summary.md")}).\n`;
      if (st.loopCritic) out += `- Critique before the user sees anything (the user only makes the final call): judge your own work from MANY pictures at every step (several angles, close-ups, wireframe or clay, in the engine where you can) and change it as many passes as it needs. When you think it's finished, hand the pictures to a separate critic: an Agent subagent with fresh eyes that only reads; give it the picture paths, the goal and this style's taste, and tell it to attack the work against them, never to approve it, and to answer with a score from 1 to 10, must-fix issues and nice-to-haves. Fix every must-fix issue, take new pictures and ask the critic again; repeat until it lists none (or say why one can't be fixed). Only the FINAL version goes to the user's queue, with the last critique beside it.\n`;
      else out += `- Claude's critic is switched off: check your own work from several pictures; what you hand in is marked "not reviewed by Claude". Leave grading to the user: one helper check during the build to find concrete fixes is fine, but don't run subagents only to score or grade the finished work.\n`;
      const critiqueStep = st.loopCritic ? `Last, write critique.json there: {"score":7,"summary":"one or two sentences","mustFix":["issues still open"],"niceToHave":["..."],"fixed":["what the critic's passes made you fix"],"passes":2,"pictures":12}. It shows in the user's queue only once critique.json is there.` : "";
      if (rv) out += `- This round revises "${flat(rv.title, 100)}" (${rv.id}) after the user's comment: "${flat(rv.verdict && rv.verdict.note, 600)}". Work on a COPY: never change or save over the old version${rv.blend ? ` or its .blend (${rv.blend.path}); save the copy as a new file under ${path.join(BRAIN, "blender", "practice")}\\` : ""}. Make the change they asked for, run the same critique, and hand in the new version as below with "revisionOf":"${rv.id}" and "changes":["what you changed"] in its item.json. The old version stays in the library.\n`;
      const inbox = `put the FINAL version's files in a new folder ${INBOX}\\<short-name>\\ and write item.json there LAST: {"kind":"image|pixel|audio|video|text|lighting|other","title":"short name","style":"${sid}","source":${src},"files":["file names in that folder, or full paths to the files"],"about":"3-8 plain lines: what it is, what you aimed for, how it follows the style; end with a line 'Guess: approve - <why>' or 'Guess: deny - <why>'"${st.loopCritic ? `,"critique":{the critic's last answer, as for critique.json}` : ""}${rv ? `,"revisionOf":"${rv.id}","changes":["..."]` : ""}}. The Wise Hive adds it to the library within 2 minutes (a problem is written to error.txt in the folder).`;
      if (mode === "training") {
        if (c.today >= DAILY) out += `  Today's limit of ${DAILY} models for the Taste library is reached, so don't capture a model this round.\n`;
        else if (c.review >= WAITING_MAX) out += `  The Taste library already has ${c.review} models waiting for the user, so don't capture a model this round.\n`;
        else out += `- If this round finishes a 3D model meant to be looked at (not test meshes, benches or diagnostics), capture its FINAL version as soon as its .blend is saved under ${path.join(BRAIN, "blender", "practice")}\\, before you write lessons or the record:
  1. With execute_blender_code run: exec(open(r"${CAPTURE}").read()); capture(r"${dir}", objects=["<every object of the model>"], round=${n})
     Capture while the model is still in Blender (before removing a side scene). If it is already gone, add source=r"<its .blend>". If you saved it with bpy.data.libraries.write, add blend=r"<that path>". It renders stills and a 24-frame turntable in a temporary scene, then removes it: your scene and files stay as they were and nothing is opened or saved. If it fails part-way or times out, run the same line again with resume=True.
  2. With Write, create about.md in that folder: a first line "# <short name>", then 3-8 plain lines: what it is, what you aimed for, the main techniques, anything you're unsure about. End with one line "Guess: approve — <why>" or "Guess: deny — <why>": your honest guess of the user's call. It is only a guess; the user decides.
  3. Write item.json there: {"kind":"model","style":"${sid}","source":${src}${rv ? `,"revisionOf":"${rv.id}","changes":["..."]` : ""}}. ${critiqueStep}
  Capture one model per round (more only if the user's instructions for this round ask for it: -2, -3 …).
- Other finished work for the user to judge (images, pixel art, audio, lighting in Blender, …): ${inbox}
- Every round must leave something the user can SEE, not only text: the user can't judge a script. Save the .blend of whatever you built in Blender (VFX, simulations and animations too) under ${path.join(BRAIN, "blender", "practice")}\\ with its animation keyed and the scene's frame range set to the part worth watching (at most 150 frames). The app then renders a spinning colour turntable and, when the scene moves, an animation video for the Taste library by itself. A VFX or animation round that never saved a working .blend has not finished: fix the build until it runs and saves. For Roblox work, when Studio tools are open to this run, put screen captures of it running in a separate test place (never the user's game) next to the scripts; when they aren't, say so in about.md.\n`;
      } else {
        out += `- If this round made something the user judges by eye or ear (a UI or graphic, art, pixel art, a sound, lighting, a model), ${inbox} Code-only rounds skip this. In your report's ### Critique, give the critic's last score and its must-fix issues.\n`;
        if (!LITE || /light/i.test(String(o.goal || ""))) out += `- Lighting (Roblox Studio or Blender): Studio changes are live, so first save the old values, and work only in a test or scratch place unless the goal names the place; never publish. Pick 3-6 fixed camera views and shoot every version from exactly the same ones (Studio: ${LUA} has snapshot(), camera() and restore(); run it with execute_luau). Take the BEFORE pictures and snapshot first, then the AFTER pictures of the same views (optionally at a few times of day). Studio pictures you take are saved as cap-NNN.png in ${o.cardDir || "this round's card folder"}\\; list them with Glob and name them by full path. Hand it in as kind "lighting" with lighting.json in the folder: {"platform":"roblox","place":"<name>","test":true,"views":[{"name":"Spawn","camera":[12 numbers],"before":"<file>","after":"<file>","times":[{"time":"dusk","before":"<file>","after":"<file>"}]}],"before":<snapshot()>,"after":<snapshot()>,"undo":"how to undo"}. The Wise Hive shows the settings diff and an Undo script made from "before".\n`;
      }
      const t = tasteText(LITE ? 1200 : 2500, buildTaste(list, sid));
      if (t) out += `- The user's taste in the style "${sty.name}", from their reviews (aim for it; say how your work follows it):\n${indent(t)}\n`;
      return out;
    } catch (e) {
      console.error(new Date().toISOString(), "taste prompt:", e && e.message || e);
      return "";
    }
  }
  // For autopilot.js: the style a round uses (the user's pick, else the planner's, else General) and the critic switch.
  function styleForRound(mode, dir, planned) { try { const s = styleFor(mode, dir, planned); return { id: s.id, name: s.name, by: s.by }; } catch { return null; } }
  const criticOn = () => { try { return settings().loopCritic; } catch { return false; } };

  // The away card on Home: work that reached the queue while the user was away and still waits for their call.
  function digest(inWin) {
    const list = items().filter((x) => x.status === "review" && inWin(x.at)).sort(byAt);
    if (!list.length) return null;
    const what = list.every((x) => x.kind === "model") ? ["model", "models"] : ["piece of work", "pieces of work"];
    return { key: "taste", title: `${list.length} ${list.length === 1 ? what[0] : what[1]} waiting for your review`, view: "taste",
      lines: list.slice(-5).reverse().map((x) => ({ text: `${x.round != null && x.source.type === "training" ? `Round ${x.round}: ` : x.kind !== "model" ? KINDS[x.kind] + ": " : ""}${flat(x.title, 100)}`, view: "taste" })), more: Math.max(0, list.length - 5) };
  }
  // Chats: "send this to my taste library" goes through the inbox (the app adds it within 2 minutes).
  if (Array.isArray(ctx.chatHints)) ctx.chatHints.push(LITE
    ? `The Wise Hive Taste: if the user says "send this to my taste library", write ${INBOX}\\<name>\\item.json last: {"kind":"model|image|pixel|audio|video|text|lighting|other","title":"..","files":["full paths"],"source":{"type":"chat"}}.`
    : `The Wise Hive Taste library: if the user asks to "send this to my taste library" (or similar), make a folder ${INBOX}\\<short-name>\\ and write item.json in it LAST: {"kind":"model|image|pixel|audio|video|text|lighting|other","title":"short name","style":"<a style id from ${TASTE}, or general>","source":{"type":"chat"},"files":["names of files you copied into that folder, or full paths"],"about":"a few plain lines"}. The app adds it to the Taste tab within 2 minutes for the user's verdict; never write verdicts.`);

  /* ---------- every Training round reaches the library ---------- */
  // Rounds are asked to hand their work to the inbox, but many didn't (VFX and Luau scripts, recipes, UI kits, rounds
  // whose Blender was down): 16 rounds in a row sent nothing. So when a Training round ends, autopilot.js calls
  // collectRound(): if no item (or pending inbox folder) is from that round yet, the files the round wrote in the round
  // output folders during its run become one item, marked auto and "not reviewed by Claude" unless a critique.json was
  // among them. Notes (lessons, records) aren't work and stay out; videos the round downloaded to learn from too.
  const ROUND_DIRS = [["training", "sandbox"], ["blender", "practice"], ["blender", "scripts"], ["roblox", "scripts"]].map((p) => path.join(BRAIN, ...p));
  const ROUND_SKIP = /[\\/](videos|__pycache__|node_modules|\.git)([\\/]|$)|\.(tmp|blend\d+|pyc)$/i;
  function roundHasItem(n) {
    for (const id of allIds()) { const m = readMeta(itemDir(id) || path.join(ITEMS, id)); if (m && m.source.type === "training" && m.source.round === n) return true; }
    try {
      for (const d of fs.readdirSync(INBOX)) {
        const j = readJson(path.join(INBOX, d, "item.json"), 256e3);
        if (j && plain(j.source) && j.source.type === "training" && Number(j.source.round) === n && !fs.existsSync(path.join(INBOX, d, "error.txt"))) return true;
      }
    } catch {}
    return false;
  }
  function roundFiles(from, to) {
    const out = [];
    const walk = (d, depth) => {
      let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        const p = path.join(d, e.name);
        if (ROUND_SKIP.test(p) || e.isSymbolicLink()) continue;
        if (e.isDirectory()) { if (depth < 6) walk(p, depth + 1); continue; }
        if (!e.isFile() || !allowedExt(p) || (META.test(e.name) && !/^critique\.json$/i.test(e.name))) continue;
        let st; try { st = fs.statSync(p); } catch { continue; }
        if (st.mtimeMs >= from - 5000 && st.mtimeMs <= to + 5000 && st.size > 0 && st.size <= LIMIT.file) out.push({ p, st });
      }
    };
    for (const d of ROUND_DIRS) walk(d, 0);
    // Models first (the app renders them into a spin and an animation), then videos, then up to 20 pictures, then
    // scripts and text; newest first within each. (Pictures first used to fill all 40 places and drop the .blend.)
    const rank = (f) => { const k = EXT_KIND[extOf(f.p)]; return k === "model" || KEEP.has(extOf(f.p)) ? 0 : k === "video" ? 1 : k === "image" ? 2 : 3; };
    out.sort((a, b) => rank(a) - rank(b) || b.st.mtimeMs - a.st.mtimeMs);
    let total = 0, imgs = 0; const pick = [];
    for (const f of out) {
      if (pick.length >= LIMIT.files || total + f.st.size > LIMIT.item || (rank(f) === 2 && imgs >= 20)) continue;
      if (rank(f) === 2) imgs++;
      total += f.st.size; pick.push(f.p);
    }
    return pick;
  }
  // { n, title, about, from, to } -> the new item id, or null (already has one, or nothing was written).
  function collectRound(o) {
    const n = Number(o && o.n);
    if (!Number.isInteger(n) || n < 1) return null;
    try { ingest(); } catch {}
    if (roundHasItem(n)) return null;
    const picked = roundFiles(Number(o.from) || 0, Number(o.to) || Date.now());
    if (!picked.length) return null;
    const crit = picked.find((p) => /(^|[\\/])critique\.json$/i.test(p));
    const critique = crit ? readJson(crit, 64e3) : null;
    const used = new Map(); // two files with one name (r40\mist.luau and r41\mist.luau) keep both
    const files = picked.filter((p) => p !== crit).map((p) => {
      let name = path.basename(p); const k = name.toLowerCase();
      if (used.has(k)) { const c = used.get(k) + 1; used.set(k, c); name = name.replace(/(\.[^.]+)?$/, `-${c}$1`); } else used.set(k, 1);
      return { name, src: p };
    });
    if (!files.length) return null;
    const about = `${String(o.about || "").trim().slice(0, 6000)}\n\n*Sent to the Taste library automatically by The Wise Hive when Training round ${n} ended: these are the files the round wrote.*`.trim();
    const id = createItem({ title: flat(o.title, 110) || `Training round ${n}`, about, files, critique: plain(critique) ? critique : undefined,
      source: { type: "training", round: n, auto: true } });
    rebuildTaste(); broadcast({ kind: "items", id });
    return id;
  }
  ctx.taste = { prompt, waiting: () => counts().review, digest, styleFor: styleForRound, critic: criticOn, collectRound };

  async function post(req, res, fn) {
    if (!pageOnly(req)) return ctx.json(res, 403, { error: "Reviews can only be saved from The Wise Hive window." });
    if (!canWrite()) return ctx.json(res, 503, { error: "Reviews and Taste settings are saved only in The Wise Hive desktop app." });
    const b = await ctx.body(req), r = await fn(plain(b) ? b : {});
    ctx.json(res, r.code, r.body);
  }

  return {
    async route(p, req, res, url) {
      if (!p.startsWith("/api/taste")) return false;
      const a = /^\/api\/taste(?:\/(count|summary|settings|distill|upload|import|ingest|styles|pick))?$/.exec(p);
      const it = /^\/api\/taste\/item\/([\w-]{3,80})(?:\/(verdict|free|critique|open|style|release))?$/.exec(p);
      const im = /^\/api\/taste\/(?:img|file)\/([^/]{1,120})\/([^/]{1,120})$/.exec(p); // checked strictly in sendImage (400)
      if (!a && !it && !im) return false;
      const act = it ? it[2] : a && ["settings", "distill", "upload", "import", "ingest", "pick"].includes(a[1]) ? a[1] : a && a[1] === "styles" && req.method !== "GET" ? "styles" : null;
      if (act) {
        if (req.method !== "POST") { ctx.json(res, 405, { error: "use POST" }); return true; }
        // The inbox is Claude's way in (no page needed): it only picks up folders already in <root>\inbox\.
        if (act === "ingest") { migrate(); const made = ingest(); ctx.json(res, 200, { made }); return true; }
        if (act === "upload") await post(req, res, (b) => made(() => upload(b)));
        else if (act === "import") await post(req, res, (b) => made(() => importFrom(b)));
        else if (act === "open") await post(req, res, (b) => openFile(it[1], b));
        else if (act === "style") await post(req, res, (b) => moveStyle(it[1], b));
        else if (act === "release") await post(req, res, () => release(it[1]));
        else if (act === "styles") await post(req, res, (b) => editStyle(b));
        else if (act === "pick") await post(req, res, (b) => savePick(b));
        else if (act === "verdict") await post(req, res, (b) => verdict(it[1], b));
        else if (act === "free") await post(req, res, (b) => free(it[1], b));
        else if (act === "critique") await post(req, res, () => (LITE ? fail(400, "Claude grading is off in The Wise Hive Lite.") : enqueue(it[1], "user") ? { code: 200, body: { queued: true } } : fail(404, "That model isn't in the library.")));
        else if (act === "distill") await post(req, res, (b) => distillNow(b.style));
        else await post(req, res, (b) => ({ code: 200, body: { settings: saveSettings(b) } }));
        return true;
      }
      if (req.method !== "GET") { ctx.json(res, 405, { error: "use GET" }); return true; }
      if (im) { sendImage(res, im[1], im[2]); return true; }
      if (it) { const x = loadItem(it[1], true); ctx.json(res, x ? 200 : 404, x ? { item: x } : { error: "not found" }); return true; }
      if (a[1] === "count") { ctx.json(res, 200, { count: counts().review }); return true; }
      if (a[1] === "styles") { ctx.json(res, 200, { styles: stylesView(), picks: picks() }); return true; }
      if (a[1] === "summary") {
        // One style's summary (default General); the file is what rounds and chats read.
        const q = url ? url.searchParams : new URLSearchParams(), sid = knownStyle(SID.test(String(q.get("style") || "")) ? q.get("style") : "general");
        const f = path.join(STYLE_DIR, sid, "summary.md"), list = items();
        const text = readText(f, 64e3) || buildTaste(list, sid).text;
        ctx.json(res, 200, { style: sid, text, file: f, updatedAt: mtime(f) || null, principlesAt: mtime(principlesFile(sid)) || null,
          reviews: list.filter((x) => x.style === sid && (x.status === "approved" || x.status === "denied")).length, bytes: diskBytes() });
        return true;
      }
      ctx.json(res, 200, list(url));
      return true;
    },
    start() {
      migrate();
      // The capture script and the lighting helper ship with the app; rounds run the brain's copies (blender\scripts\,
      // roblox\scripts\: the brain's convention).
      for (const [from, to] of [[CAPTURE_SRC, CAPTURE], [LUA_SRC, LUA]]) {
        try {
          const src = fs.readFileSync(from, "utf8");
          if (ctx.read(to) !== src) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.writeFileSync(to, src); }
        } catch (e) { console.error(new Date().toISOString(), "taste: can't copy", path.basename(from) + ":", e && e.message || e); }
      }
      rebuildTaste();
      autoFree();
      // A Training round ended (a new log entry; save() and the 5-minute heartbeat repeat the same `last`, so dedupe on its id).
      let lastId = null, deb = null;
      try {
        ctx.hub.on("event", (ev) => {
          const last = ev && ev.t === "autopilot" && ev.mode === "training" && ev.state && ev.state.last;
          if (!last || last.id === lastId || !["result", "error", "note"].includes(last.type)) return;
          lastId = last.id;
          clearTimeout(deb); deb = setTimeout(scan, ctx.tasteScanDelay ?? 3000);
        });
      } catch {}
      // Unfinished critic work from before a restart (critics.json still names pending lenses).
      const st = settings();
      for (const x of items()) {
        if (!x.critics || !x.critics.pending) continue;
        const dir = itemDir(x.id), cr = readJson(criticsFile(dir), 128e3) || {};
        if (!queueOk(x.id, cr)) { warnOnce("q:" + x.id, `taste: critics.json for ${x.id} wasn't queued by this app; not resumed`); continue; }
        if (x.status !== "review" && cr.requested !== "user") dropCritics(x.id, "you reviewed it first");
        else if (cr.requested === "user" || (!LITE && st.critics !== "off")) { if (!Q.list.includes(x.id)) Q.list.push(x.id); }
      }
      if (Q.list.length) pump();
      scan();
      // Items from before views existed (or whose .blend changed): one pass, a minute after start.
      if (views) { const t = setTimeout(() => views.all(), ctx.tasteViewsDelay ?? 60e3); if (t.unref) t.unref(); }
      for (const t of [setInterval(autoFree, 12 * 3600e3), setInterval(scan, 120e3)]) if (t.unref) t.unref();
    },
    busy: () => (views && views.busy() ? 1 : 0),
    // For tests.
    _: { views, LUA, finish, revisions, styles, styleFor, picks, editStyle, moveStyle, STYLE_DIR, migrate, ingest, createItem, srcOk, undoLua, settingsDiff, guessKind, OLD, INBOX, items, loadItem, counts, page, agreement, parseAbout, itemDir, settings, buildTaste, tasteText, rebuildTaste, autoFree, prompt, scan, digest, held, enqueue, pump, parseCritique, distill, maybeDistill, Q, REASONS, ITEMS, ROOT, CAPTURE },
  };
};
