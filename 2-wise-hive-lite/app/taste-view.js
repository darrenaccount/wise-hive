// Taste views: makes every Taste item something the user can SEE, not a file list. Runs in the background, one job at a
// time, after an item is added (and once over the whole library on start):
//   - each .blend in an item -> blender\taste_render.py, headless (blender -b --factory-startup): a colour turntable +
//     stills (the viewer spins it; the first .blend's capture goes to the item root, so the item becomes a 3D model), and
//     animation[-n].mp4 when the scene moves (VFX, simulations, keyframes);
//   - each .html (UI kits, mockups) -> <name>.png, a screenshot from an offscreen Electron window with scripts on and
//     every network request blocked (only when the server runs inside Electron).
// New files are added to item.json's file list (so the viewer and the file routes see them). What was tried is kept in
// view.json per item (done, or the error), so a file that fails isn't retried until it changes.
// Written 2026-10-13. Script: app\blender\taste_render.py. Blender: the BLENDER env var, D:\blender.exe, or the newest
// install under Program Files\Blender Foundation (tested with Blender 5.2.2). Without Blender, .blend files stay files.
"use strict";
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { writeFileAtomic } = require("./lib/fsx");

const SHOT = /\.html?$/i;
const STILL = /^(thumb|still-(34|front|side|top|clay)|turn-\d{2,3})\.(jpg|png)$/;
const RENDER_MS = 15 * 60e3; // one .blend: turntable (~10 s) + up to 150 animation frames
const NO_KIND_CHANGE = new Set(["lighting", "audio", "pixel"]);

// o: { ITEMS, APP_DIR, itemDir(id), allIds(), onChange(id), log(msg) }
module.exports = function views(o) {
  const SCRIPT = path.join(o.APP_DIR, "blender", "taste_render.py");
  const readJson = (f) => { try { const v = JSON.parse(fs.readFileSync(f, "utf8")); return v && typeof v === "object" && !Array.isArray(v) ? v : null; } catch { return null; } };
  const writeJson = (f, v) => writeFileAtomic(f, JSON.stringify(v, null, 1));
  const sig = (f) => { try { const s = fs.statSync(f); return `${s.size}:${Math.floor(s.mtimeMs)}`; } catch { return null; } };

  let blender; // undefined = not looked yet, null = none
  function findBlender() {
    if (blender !== undefined) return blender;
    const pf = process.env.ProgramFiles || "C:\\Program Files";
    const cands = [process.env.BLENDER, "D:\\blender.exe"];
    try { for (const d of fs.readdirSync(path.join(pf, "Blender Foundation")).sort().reverse()) cands.push(path.join(pf, "Blender Foundation", d, "blender.exe")); } catch {}
    blender = cands.find((c) => c && fs.existsSync(c)) || null;
    return blender;
  }

  // What still needs doing in one item: [{ file, how: "blend"|"html" }].
  function todo(id) {
    const dir = o.itemDir(id);
    const meta = dir && readJson(path.join(dir, "item.json"));
    if (!meta || !Array.isArray(meta.files)) return [];
    const done = (readJson(path.join(dir, "view.json")) || {}).files || {};
    const out = [];
    for (const f of meta.files) {
      const name = typeof f === "string" ? f : f && f.file;
      if (!name) continue;
      const how = /\.blend$/i.test(name) ? "blend" : SHOT.test(name) ? "html" : null;
      if (!how || (how === "html" && !process.versions.electron) || (how === "blend" && !findBlender())) continue;
      const s = sig(path.join(dir, name));
      if (s && (!done[name] || done[name].sig !== s)) out.push({ file: name, how });
    }
    // The first .blend rendered becomes the item's spin: the one that best matches its title and round goes first
    // ("Chest v2" spun the walkie-talkie the same round had also saved).
    const round = meta.source && Number.isInteger(meta.source.round) ? meta.source.round : null;
    const words = String(meta.title || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
    const score = (n) => { const l = n.toLowerCase(); return (round != null && new RegExp(`(^|[^0-9])r${round}([^0-9]|$)`).test(l) ? 2 : 0) + words.filter((w) => l.includes(w)).length - (/copy|diag|audit|work|fixed/.test(l) ? 1 : 0); };
    out.sort((a, b) => (a.how === b.how ? (a.how === "blend" ? score(b.file) - score(a.file) : 0) : a.how === "blend" ? -1 : 1));
    return out;
  }

  const Q = [], queued = new Set();
  let running = null, stopped = false, cur = null;
  function add(id) {
    if (stopped || queued.has(id) || !todo(id).length) return;
    queued.add(id); Q.push(id); pump();
  }
  async function pump() {
    if (running || stopped) return;
    const id = Q.shift();
    if (!id) return;
    running = id;
    try {
      for (const t of todo(id)) {
        if (stopped) break;
        const r = await (t.how === "blend" ? renderBlend(id, t.file) : shotHtml(id, t.file)).catch((e) => ({ error: String(e && e.message || e) }));
        record(id, t.file, r);
      }
    } catch (e) { o.log(`taste views ${id}: ${e && e.message || e}`); }
    finally { queued.delete(id); running = null; o.onChange(id); setImmediate(pump); }
  }

  function record(id, file, r) {
    const dir = o.itemDir(id); if (!dir) return;
    const vf = path.join(dir, "view.json"), v = readJson(vf) || {};
    v.files = v.files || {};
    v.files[file] = { sig: sig(path.join(dir, file)), at: new Date().toISOString(), made: r.made || [], ...(r.error ? { error: String(r.error).slice(0, 400) } : {}), ...(r.warnings && r.warnings.length ? { warnings: r.warnings.slice(0, 6) } : {}) };
    writeJson(vf, v);
    if (r.error) o.log(`taste views: ${id}\\${file}: ${r.error}`);
  }
  // Adds files to item.json (label shown as the view's name) and makes a captured item a 3D model.
  function register(dir, add, model) {
    const mf = path.join(dir, "item.json"), m = readJson(mf);
    if (!m) return;
    m.files = Array.isArray(m.files) ? m.files : [];
    const have = new Set(m.files.map((f) => String(typeof f === "string" ? f : f && f.file).toLowerCase()));
    // First in the list: an item already at the 40-file cap would otherwise hide them.
    m.files.unshift(...add.filter((f) => !have.has(f.file.toLowerCase())));
    if (model && !NO_KIND_CHANGE.has(m.kind)) m.kind = "model";
    writeJson(mf, m);
  }

  function run(exe, args, ms) {
    return new Promise((ok) => {
      let out = "", done = false;
      const p = spawn(exe, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      const t = setTimeout(() => { try { p.kill(); } catch {} }, ms);
      const fin = (code, err) => { if (done) return; done = true; clearTimeout(t); ok({ code, out, err }); };
      p.stdout.on("data", (d) => { out += d; if (out.length > 2e6) out = out.slice(-1e6); });
      p.stderr.on("data", () => {});
      p.on("error", (e) => fin(-1, e.message));
      p.on("close", (c) => fin(c));
      cur = p;
    });
  }
  async function renderBlend(id, file) {
    const dir = o.itemDir(id), exe = findBlender();
    if (!dir || !exe) return { error: "no Blender" };
    const meta = readJson(path.join(dir, "item.json")) || {};
    const round = meta.source && Number.isInteger(meta.source.round) ? meta.source.round : null;
    const tmp = path.join(dir, "_view");
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    try {
      const args = ["-b", "--factory-startup", "--python", SCRIPT, "--", "--blend", path.join(dir, file), "--out", tmp];
      if (round != null) args.push("--round", String(round));
      const r = await run(exe, args, RENDER_MS);
      cur = null;
      const line = String(r.out).split(/\r?\n/).reverse().find((l) => l.startsWith("TASTE_RENDER "));
      const rep = line ? (() => { try { return JSON.parse(line.slice(13)); } catch { return null; } })() : null;
      if (!rep) return { error: r.code === -1 ? r.err : `Blender ended (${r.code}) without a report` };
      const made = [], add = [];
      const base = file.replace(/\.blend$/i, "");
      let model = false;
      const cap = readJson(path.join(tmp, "capture.json"));
      if (cap && cap.phase === "done") {
        if (!fs.existsSync(path.join(dir, "capture.json"))) {
          // The item's own spin: the stills and turntable go to the item root.
          for (const f of fs.readdirSync(tmp)) if (STILL.test(f)) fs.renameSync(path.join(tmp, f), path.join(dir, f));
          cap.id = id;
          writeJson(path.join(dir, "capture.json"), cap);
          made.push("spin"); model = true;
        } else if (fs.existsSync(path.join(tmp, "still-34.jpg"))) {
          // A second .blend in the same item: one picture of it.
          const n = `${base}-view.jpg`;
          fs.renameSync(path.join(tmp, "still-34.jpg"), path.join(dir, n));
          add.push({ file: n, label: `Picture: ${base}` }); made.push(n);
        }
      }
      if (fs.existsSync(path.join(tmp, "animation.mp4"))) {
        const exists = (n) => fs.existsSync(path.join(dir, n));
        let n = "animation.mp4";
        for (let i = 2; exists(n); i++) n = `animation-${i}.mp4`;
        fs.renameSync(path.join(tmp, "animation.mp4"), path.join(dir, n));
        add.push({ file: n, label: `Animation: ${base}` }); made.push(n);
      }
      register(dir, add, model);
      return { made, warnings: rep.warnings, ...(rep.error && !made.length ? { error: rep.error } : {}) };
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  // A screenshot of a page Claude wrote: offscreen, scripts on (UI kits animate and build themselves), no network, no
  // Node, its own throwaway session. 1280x800, after 1.5 s.
  async function shotHtml(id, file) {
    const dir = o.itemDir(id);
    if (!dir) return { error: "gone" };
    const { BrowserWindow, session } = require("electron");
    const part = session.fromPartition("taste-shot");
    const root = "file:///" + dir.replace(/\\/g, "/").replace(/^\/+/, "");
    part.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !(d.url.startsWith("file:") && decodeURIComponent(d.url).toLowerCase().startsWith(decodeURI(root).toLowerCase())) && !d.url.startsWith("data:") }));
    const w = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: { session: part, sandbox: true, nodeIntegration: false, contextIsolation: true, offscreen: true, javascript: true } });
    try {
      w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      w.webContents.on("will-navigate", (e) => e.preventDefault());
      await Promise.race([w.loadFile(path.join(dir, file)), new Promise((_, no) => setTimeout(() => no(new Error("the page took over 20 s to load")), 20e3))]);
      await new Promise((r) => setTimeout(r, 1500));
      const img = await w.webContents.capturePage();
      if (img.isEmpty()) return { error: "empty screenshot" };
      const base = file.replace(SHOT, ""), n = base + ".png";
      fs.writeFileSync(path.join(dir, n), img.toPNG());
      const add = [{ file: n, label: `Picture: ${file}` }], made = [n];
      // A page that moves (a flickering lamp, a looping animation) also gets 4 s of video: 60 frames at 15 fps, kept
      // only when some frame differs from the first, encoded with ffmpeg when it is installed.
      const tmp = path.join(dir, "_view");
      try {
        fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp);
        const first = img.toBitmap(); let moved = false;
        for (let i = 0; i < 60; i++) {
          const t = Date.now(), f = await w.webContents.capturePage();
          if (!moved && !f.toBitmap().equals(first)) moved = true;
          fs.writeFileSync(path.join(tmp, `f${String(i).padStart(3, "0")}.jpg`), f.toJPEG(88));
          await new Promise((r) => setTimeout(r, Math.max(0, 66 - (Date.now() - t))));
        }
        const v = `animation-${base}.mp4`;
        if (moved) {
          const r = await run("ffmpeg", ["-loglevel", "error", "-y", "-framerate", "15", "-i", path.join(tmp, "f%03d.jpg"), "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", path.join(dir, v)], 120e3);
          cur = null;
          if (r.code === 0 && fs.existsSync(path.join(dir, v))) { add.unshift({ file: v, label: `Animation: ${file}` }); made.push(v); }
        }
      } catch (e) { o.log(`taste views: ${id}\\${file} recording: ${e && e.message || e}`); }
      finally { fs.rmSync(tmp, { recursive: true, force: true }); }
      register(dir, add, false);
      return { made };
    } finally { try { w.destroy(); } catch {} }
  }

  return {
    add,
    // Every item once (start-up backfill): only items with work left are queued.
    all() { for (const id of o.allIds()) add(id); },
    busy: () => !!running || Q.length > 0,
    state: () => ({ running, queued: Q.length, blender: findBlender() }),
    stop() { stopped = true; Q.length = 0; try { cur && cur.kill(); } catch {} },
    _: { todo, findBlender },
  };
};
