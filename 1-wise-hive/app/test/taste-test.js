// Unit test for taste.js (Training -> Taste library) with a fake ctx and a scratch brain: no tokens, no Blender.
//   node test/taste-test.js
"use strict";
const fs = require("fs"), path = require("path"), assert = require("assert"), { Writable } = require("stream");
const APP = path.resolve(__dirname, "..");
const TMP = path.join(APP, ".research", "taste-unit-" + process.pid);
const BRAIN = path.join(TMP, "brain");
const ITEMS = path.join(BRAIN, "taste", "items");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log("PASS", name); } catch (e) { failed++; console.log("FAIL", name + ":", e && e.stack || e); } }
const day = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const write = (f, data) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); };
function walk(dir) { const out = []; const w = (d) => { let l = []; try { l = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of l) { const f = path.join(d, e.name); out.push(f + ":" + (e.isDirectory() ? "d" : fs.statSync(f).size)); if (e.isDirectory()) w(f); } }; w(dir); return out.sort().join("\n"); }
// A fake item: capture.json + a still (+ optional about.md, frames, thumb).
function item(id, o = {}) {
  const d = path.join(ITEMS, id);
  write(path.join(d, "capture.json"), JSON.stringify({ v: 1, id, round: o.round ?? Number((/_r(\d+)-/.exec(id) || [])[1]), at: o.at || new Date().toISOString(), phase: o.phase || "done", tris: 1412, dims: [0.3, 0.3, 0.6], materials: ["M_Brass"], blend: o.blend, turntable: { frames: 2, done: o.frames ?? 2 }, warnings: [] }));
  write(path.join(d, "still-34.png"), PNG);
  if (o.stills !== false) for (const k of ["front", "top"]) write(path.join(d, `still-${k}.png`), PNG);
  for (let i = 0; i < (o.frames ?? 2); i++) write(path.join(d, `turn-${String(i).padStart(2, "0")}.png`), PNG);
  write(path.join(d, "thumb.png"), PNG);
  if (o.about !== false) write(path.join(d, "about.md"), o.about || `# Brass lantern ${id}\nA hanging lantern.\nGuess: approve — chunky silhouette.\n`);
  return d;
}

let ctxOverrides = {};
// The signing key server.js hands over (main.js keeps it outside the brain); made up for the test.
const KEY = "5eed".repeat(16);
const tasteKey = () => ({ key: KEY, write: true });
function mk(extra = {}) {
  const events = [];
  const ctx = { BRAIN, APP_DIR: APP, PORT: 4799, LITE: false, tasteKey, read: (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } },
    json: (res, code, body) => res.done(code, body), body: async (req) => req.body || {}, broadcast: (o) => events.push(o),
    hub: { on() {} }, live: new Map(),
    tasteCriticSince: 8.64e15, // the critic-before-queue gate is tested in taste-kinds-test.js; these are the v1 flows
    ...ctxOverrides, ...extra };
  delete require.cache[require.resolve(path.join(APP, "taste.js"))];
  const mod = require(path.join(APP, "taste.js"))(ctx);
  mod.ctx = ctx; mod.events = events;
  return mod;
}
// Calls a route like the server does; resolves { code, body, type, buf }.
function call(mod, method, p, { headers = {}, body } = {}) {
  return new Promise((ok) => {
    const url = new URL(p, "http://127.0.0.1:4799");
    const chunks = [];
    const res = new Writable({ write(c, e, cb) { chunks.push(Buffer.from(c)); cb(); } });
    let code = 0, type = "";
    res.writeHead = (c, h) => { code = c; type = (h || {})["Content-Type"] || ""; };
    res.done = (c, b) => ok({ code: c, body: b });
    res.on("finish", () => ok({ code, type, buf: Buffer.concat(chunks) }));
    Promise.resolve(mod.route(url.pathname, { method, headers, body }, res, url)).then((handled) => { if (!handled) ok({ code: 404, body: { error: "unhandled" } }); });
  });
}

(async () => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(BRAIN, { recursive: true });

  await test("empty brain: GET /api/taste lists nothing and writes nothing", async () => {
    const before = walk(BRAIN);
    const mod = mk();
    const r = await call(mod, "GET", "/api/taste");
    assert.strictEqual(r.code, 200);
    assert.deepStrictEqual(r.body.items, []);
    assert.strictEqual(r.body.counts.review, 0);
    for (const k of ["items", "total", "counts", "settings", "reasons"]) assert.ok(k in r.body, k);
    await call(mod, "GET", "/api/taste/count"); await call(mod, "GET", "/api/taste/summary");
    assert.strictEqual(walk(BRAIN), before, "the brain changed on GET");
  });

  const today = day();
  await test("a captured model shows in To review with its guess taken out of the description", async () => {
    item(`${today}_r12-1`);
    const mod = mk();
    const r = await call(mod, "GET", "/api/taste?status=review");
    assert.strictEqual(r.body.items.length, 1);
    assert.strictEqual(r.body.items[0].title, `Brass lantern ${today}_r12-1`);
    assert.strictEqual((await call(mod, "GET", "/api/taste/count")).body.count, 1);
    const full = (await call(mod, "GET", `/api/taste/item/${today}_r12-1`)).body.item;
    assert.ok(!/Guess/.test(full.about), full.about);
    assert.deepStrictEqual(full.guess, { lean: "approve", why: "chunky silhouette." });
    assert.ok(full.images["still-34.png"] > 0, "images carry an mtime");
    assert.strictEqual(full.round, 12);
  });

  await test("image route: 400 for traversal or a non-image, 404 for missing, 200 image/png", async () => {
    const mod = mk(), id = `${today}_r12-1`;
    assert.strictEqual((await call(mod, "GET", `/api/taste/img/${id}/..%2fx.jpg`)).code, 400);
    assert.strictEqual((await call(mod, "GET", `/api/taste/img/${id}/capture.json`)).code, 400);
    assert.strictEqual((await call(mod, "GET", `/api/taste/img/${id}/still-side.png`)).code, 404);
    assert.strictEqual((await call(mod, "GET", `/api/taste/img/..%2f..%2fbrain/still-34.png`)).code, 400);
    const ok = await call(mod, "GET", `/api/taste/img/${id}/still-34.png`);
    assert.strictEqual(ok.code, 200); assert.strictEqual(ok.type, "image/png"); assert.ok(ok.buf.equals(PNG));
  });

  await test("a UNC .blend path is never touched by fs", async () => {
    const id = "2026-01-02_r3-1";
    item(id, { blend: "\\\\host\\share\\x.blend" });
    const seen = [], ex = fs.existsSync, st = fs.statSync;
    fs.existsSync = (p) => { seen.push(String(p)); return ex(p); };
    fs.statSync = (p, ...a) => { seen.push(String(p)); return st(p, ...a); };
    try {
      const full = (await call(mk(), "GET", `/api/taste/item/${id}`)).body.item;
      assert.strictEqual(full.blend.exists, null);
    } finally { fs.existsSync = ex; fs.statSync = st; }
    assert.ok(!seen.some((p) => p.includes("host")), seen.filter((p) => p.includes("host")).join(","));
    fs.rmSync(path.join(ITEMS, id), { recursive: true });
  });

  await test("paging: 70 waiting, oldest first, 48 then 22", async () => {
    for (let i = 0; i < 69; i++) item(`2026-01-${String(1 + (i % 28)).padStart(2, "0")}_r${100 + i}-1`, { at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(), about: false });
    const mod = mk();
    const a = (await call(mod, "GET", "/api/taste?status=review")).body;
    assert.strictEqual(a.total, 70); assert.strictEqual(a.items.length, 48);
    assert.ok(a.items[0].at <= a.items[1].at, "oldest first");
    const b = (await call(mod, "GET", "/api/taste?status=review&offset=48")).body;
    assert.strictEqual(b.items.length, 22);
    assert.ok(!a.items.some((x) => b.items.find((y) => y.id === x.id)));
    for (const x of a.items.concat(b.items)) if (x.id !== `${today}_r12-1`) fs.rmSync(path.join(ITEMS, x.id), { recursive: true });
  });

  /* ---------- write side ---------- */
  const PAGE = { "x-hive": "1", origin: "http://127.0.0.1:4799", "sec-fetch-site": "same-origin" };
  const A = `${today}_r12-1`, B = `${today}_r13-1`;
  const vfile = (id) => path.join(ITEMS, id, "verdict.json");
  const crypto = require("crypto");
  const hmac = (list) => crypto.createHmac("sha256", KEY).update(JSON.stringify(list)).digest("hex");
  const resign = (v) => { v.sig = hmac([v.id, v.decision, v.reasons, v.note, v.at, v.history || []]); return v; };
  const queue = (id, o) => { const cr = { queuedAt: new Date().toISOString(), skipped: "", ...o }; cr.qsig = hmac(["critics", id, cr.mode, cr.requested, cr.queuedAt]); return cr; };

  await test("page-only: verdict POSTs need Origin + Sec-Fetch-Site (and the page key when the server has one)", async () => {
    const mod = mk(), body = { decision: "approve", reasons: ["silhouette"] };
    assert.strictEqual((await call(mod, "POST", `/api/taste/item/${A}/verdict`, { headers: { "x-hive": "1" }, body })).code, 403);
    assert.strictEqual((await call(mod, "POST", `/api/taste/item/${A}/verdict`, { headers: { "x-hive": "1", origin: PAGE.origin }, body })).code, 403);
    assert.strictEqual((await call(mod, "POST", "/api/taste/settings", { headers: { "x-hive": "1" }, body: { critics: "one" } })).code, 403);
    const keyed = mk({ isPage: (req) => req.headers["x-hive-page"] === "k".repeat(64) });
    assert.strictEqual((await call(keyed, "POST", `/api/taste/item/${A}/verdict`, { headers: PAGE, body })).code, 403);
    assert.ok(!fs.existsSync(vfile(A)), "nothing was saved");
    assert.strictEqual((await call(mod, "GET", `/api/taste/item/${A}/verdict`)).code, 405);
  });

  await test("a reason is required; a verdict is signed and taste.md counts the chip (no image paths)", async () => {
    const mod = mk();
    const r0 = await call(mod, "POST", `/api/taste/item/${A}/verdict`, { headers: PAGE, body: { decision: "approve", reasons: [], note: "ok" } });
    assert.strictEqual(r0.code, 400); assert.ok(/reason/.test(r0.body.error));
    const r = await call(mod, "POST", `/api/taste/item/${A}/verdict`, { headers: PAGE, body: { decision: "approve", reasons: ["silhouette", "bogus"], note: "love the chunky cage" } });
    assert.strictEqual(r.code, 200, JSON.stringify(r.body));
    const v = JSON.parse(fs.readFileSync(vfile(A), "utf8"));
    assert.ok(/^[0-9a-f]{64}$/.test(v.sig)); assert.deepStrictEqual(v.reasons, ["silhouette"]);
    assert.strictEqual(r.body.item.status, "approved");
    const md = fs.readFileSync(path.join(BRAIN, "taste", "styles", "general", "summary.md"), "utf8");
    assert.ok(md.includes("Strong silhouette (1)"), md); assert.ok(md.includes("love the chunky cage"));
    assert.ok(!/\.(jpg|png)/.test(md), "no image paths");
    assert.ok(mod.events.some((e) => e.t === "taste" && e.kind === "verdict"));
  });

  await test("a planted unsigned verdict.json is ignored and then discarded, not merged", async () => {
    item(B);
    write(vfile(B), JSON.stringify({ decision: "approve", reasons: ["style"], at: new Date().toISOString() }));
    const mod = mk();
    const s = (await call(mod, "GET", "/api/taste?status=review")).body.items.find((x) => x.id === B);
    assert.ok(s, "still in To review"); assert.strictEqual(s.unverified, true);
    const r = await call(mod, "POST", `/api/taste/item/${B}/verdict`, { headers: PAGE, body: { decision: "deny", reasons: ["plain"] } });
    assert.strictEqual(r.code, 200);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(vfile(B), "utf8")).history, []);
    assert.strictEqual(r.body.item.unverified, false);
  });

  await test("the key stays out of the brain; without a writable key the library is read-only", async () => {
    assert.ok(!fs.existsSync(path.join(BRAIN, "app-settings", "taste.key")), "no key file in the brain");
    assert.ok(!fs.readFileSync(path.join(APP, "taste.js"), "utf8").includes("taste.key"), "taste.js never names a key file");
    const ro = mk({ tasteKey: () => ({ key: KEY, write: false }) });
    const r = await call(ro, "POST", `/api/taste/item/${A}/verdict`, { headers: PAGE, body: { decision: "deny", reasons: ["plain"] } });
    assert.strictEqual(r.code, 503, JSON.stringify(r.body));
    assert.strictEqual((await call(ro, "POST", "/api/taste/settings", { headers: PAGE, body: { critics: "panel" } })).code, 503);
    const l = (await call(ro, "GET", "/api/taste?status=approved")).body;
    assert.strictEqual(l.readOnly, true); assert.ok(l.items.some((x) => x.id === A), "reviews still show");
    const none = (await call(mk({ tasteKey: () => null }), "GET", "/api/taste?status=review")).body;
    assert.ok(none.items.some((x) => x.id === A) && !none.items.some((x) => x.unverified), "no key: not counted, not flagged as planted");
  });

  await test("a signed verdict with an edited history reads as unverified", async () => {
    const v = JSON.parse(fs.readFileSync(vfile(B), "utf8"));
    const keep = JSON.stringify(v);
    v.history = [{ decision: "approve", reasons: ["style"], note: "", at: v.at }];
    write(vfile(B), JSON.stringify(v));
    const it = (await call(mk(), "GET", `/api/taste/item/${B}`)).body.item;
    assert.strictEqual(it.unverified, true); assert.strictEqual(it.status, "review");
    write(vfile(B), keep);
  });

  await test("agreement: Claude's guess matched 1 of 2 (approve guessed on both)", async () => {
    const r = (await call(mk(), "GET", "/api/taste?status=all")).body;
    assert.deepStrictEqual(r.agreement.guess, { n: 2, agree: 1 });
    assert.strictEqual(r.counts.approved, 1); assert.strictEqual(r.counts.denied, 1);
  });

  await test("clear moves the decision to history and the model back to To review", async () => {
    const r = await call(mk(), "POST", `/api/taste/item/${B}/verdict`, { headers: PAGE, body: { decision: "clear" } });
    assert.strictEqual(r.code, 200); assert.strictEqual(r.body.item.status, "review");
    assert.strictEqual(r.body.item.verdict.history.length, 1);
    const md = fs.readFileSync(path.join(BRAIN, "taste", "styles", "general", "summary.md"), "utf8");
    assert.ok(!md.includes("Too plain"), "a cleared deny no longer counts");
  });

  await test("Free space: needs confirm and a reviewed model; keeps the 3/4 still and thumb; no stale cache", async () => {
    const mod = mk();
    assert.strictEqual((await call(mod, "POST", `/api/taste/item/${A}/free`, { headers: PAGE, body: {} })).code, 400);
    assert.strictEqual((await call(mod, "POST", `/api/taste/item/${B}/free`, { headers: PAGE, body: { confirm: true } })).code, 400, "To review can't be freed");
    const r = await call(mod, "POST", `/api/taste/item/${A}/free`, { headers: PAGE, body: { confirm: true } });
    assert.strictEqual(r.code, 200);
    const left = fs.readdirSync(path.join(ITEMS, A)).sort();
    assert.ok(left.includes("still-34.png") && left.includes("thumb.png") && left.includes("verdict.json") && left.includes("about.md"), left.join());
    assert.ok(!left.some((f) => /^turn-|^still-(front|top)/.test(f)), left.join());
    const s = (await call(mod, "GET", "/api/taste?status=approved")).body.items[0];
    assert.strictEqual(s.freed, true); assert.strictEqual(s.frames, 0);
  });

  await test("auto-free slims reviewed models older than autoFreeDays only", async () => {
    const C = `${today}_r14-1`;
    item(C);
    const mod = mk();
    await call(mod, "POST", `/api/taste/item/${C}/verdict`, { headers: PAGE, body: { decision: "deny", reasons: ["busy"] } });
    assert.strictEqual(mod._.autoFree(), 0, "a fresh verdict is kept");
    const v = JSON.parse(fs.readFileSync(vfile(C), "utf8"));
    v.at = new Date(Date.now() - 40 * 864e5).toISOString();
    write(vfile(C), JSON.stringify(resign(v)));
    assert.strictEqual(mk()._.autoFree(), 1);
    assert.ok(!fs.readdirSync(path.join(ITEMS, C)).some((f) => f.startsWith("turn-")));
  });

  await test("Lite: settings can't turn Claude grading on", async () => {
    const lite = mk({ LITE: true });
    const r = await call(lite, "POST", "/api/taste/settings", { headers: PAGE, body: { critics: "panel", autoDistill: true } });
    assert.strictEqual(r.code, 200); assert.strictEqual(r.body.settings.critics, "off"); assert.strictEqual(r.body.settings.autoDistill, false);
    const full = await call(mk(), "POST", "/api/taste/settings", { headers: PAGE, body: { critics: "one", autoFreeDays: 3 } });
    assert.strictEqual(full.body.settings.critics, "one"); assert.ok(full.body.settings.criticsSince > 0); assert.strictEqual(full.body.settings.autoFreeDays, 30, "3 days is out of range");
    await call(mk(), "POST", "/api/taste/settings", { headers: PAGE, body: { critics: "off" } });
  });

  /* ---------- prompts ---------- */
  await test("planner and worker blocks: taste text with no image paths, the capture rule, the grading line", async () => {
    const mod = mk();
    const pl = mod._.prompt("planner");
    assert.ok(pl.includes("THE USER'S TASTE"), pl); assert.ok(pl.includes("Strong silhouette (1)"), pl);
    assert.ok(!/\.(jpg|png)\b/.test(pl), "no image paths");
    const w = mod._.prompt("worker", { n: 12, date: "2026-10-14" });
    for (const k of ["2026-10-14_r12-1", "taste_capture.py", "Leave grading to the user", "127.0.0.1:4799", "Guess: approve", "resume=True", "The user's taste"]) assert.ok(w.includes(k), k);
    assert.ok(w.startsWith("- ") && w.endsWith("\n"));
    assert.ok(!/\.(jpg|png)\b/.test(w), "no image paths");
    assert.ok(fs.existsSync(ITEMS));
    // autopilot.js puts the block before the lessons and the record.
    const ap = fs.readFileSync(path.join(APP, "autopilot.js"), "utf8");
    assert.ok(ap.indexOf('${tasteFor("worker", { n, date, mode, style: plan.style, styleBy: plan.styleBy, revises: plan.revises })}- At the end, save what you learned') > 0, "autopilot.js inserts the worker block before the lessons");
    assert.ok(typeof require(path.join(APP, "autopilot.js")).guard.inQuiet === "function");
  });

  await test("caps: 12 today, or 30 waiting, means no capture this round", async () => {
    const made = [];
    for (let i = 0; i < 9; i++) { const id = `${today}_r${200 + i}-1`; item(id, { about: false }); made.push(id); }
    let w = mk()._.prompt("worker", { n: 300 });
    assert.ok(w.includes("don't capture a model this round") && !w.includes("capture(r"), w);
    for (const id of made) fs.rmSync(path.join(ITEMS, id), { recursive: true });
    for (let i = 0; i < 29; i++) { const id = `2026-02-${String(1 + (i % 28)).padStart(2, "0")}_r${400 + i}-1`; item(id, { about: false }); made.push(id); }
    w = mk()._.prompt("worker", { n: 301 });
    assert.ok(w.includes("30 models waiting") && !w.includes("capture(r"), w);
    for (const id of made) fs.rmSync(path.join(ITEMS, id), { recursive: true, force: true });
    assert.ok(mk()._.prompt("worker", { n: 302 }).includes("capture(r"));
  });

  await test("Lite: the taste text is capped (planner 600, worker 1,200)", async () => {
    const lite = mk({ LITE: true });
    for (let i = 0; i < 12; i++) {
      const id = `2026-03-${String(1 + i).padStart(2, "0")}_r${500 + i}-1`; item(id);
      await call(lite, "POST", `/api/taste/item/${id}/verdict`, { headers: PAGE, body: { decision: i % 2 ? "approve" : "deny", reasons: [i % 2 ? "detail" : "plain"], note: "x".repeat(130) + i } });
    }
    const w = lite._.prompt("worker", { n: 9 }), part = w.slice(w.indexOf("- The user's taste"));
    assert.ok(part.length > 300 && part.length <= 1200 + 200, `taste part ${part.length}`);
    assert.ok(lite._.tasteText(1200).length <= 1200);
    assert.ok(lite._.prompt("planner").length <= 600 + 400);
    const full = mk()._.tasteText(2500);
    assert.ok(full.length > 1200 && full.length <= 2500, `full ${full.length}`);
    assert.ok(full.includes("In their own words"));
  });

  /* ---------- optional Claude grading (critics) and the curator ---------- */
  const until = async (fn, t = 3000) => { for (const end = Date.now() + t; Date.now() < end; await new Promise((r) => setTimeout(r, 20))) if (fn()) return true; return false; };
  const sleep = (t) => new Promise((r) => setTimeout(r, t));
  const usage = (over = null) => ({ over: () => over, ensure: async () => {}, readAt: () => Date.now(), isGaming: async () => ({ gaming: false }) });
  function claude(answer) {
    const calls = [];
    const runClaude = (o) => {
      calls.push(o);
      setTimeout(() => { o.onEvent({ type: "result", subtype: "success", is_error: false, result: typeof answer === "function" ? answer(o) : answer, total_cost_usd: 0.03 }); o.onEnd(0, ""); }, 5);
      return "run-" + calls.length;
    };
    return { runClaude, calls };
  }
  const CRIT = '<critique>{"lean":"deny","score":6,"why":"Reads fine but plain.","good":["clear shape"],"fix":["add wear"]}</critique>';
  const AP_FILE = path.join(BRAIN, "autopilot", "training.json");
  const crit = (id) => JSON.parse(fs.readFileSync(path.join(ITEMS, id, "critics.json"), "utf8"));
  ctxOverrides = { tasteRecheck: 30, tasteScanDelay: 5, tasteDistillDelay: 30 };

  await test("a settings.json the app didn't sign can't turn Claude grading on", async () => {
    const SET = path.join(BRAIN, "taste", "settings.json");
    write(SET, JSON.stringify({ critics: "panel", criticsSince: 0, autoDistill: true, autoFreeDays: 7, distilledAt: 4 }));
    const c = claude(CRIT), mod = mk({ ...c, usage: usage() });
    const st = mod._.settings();
    assert.strictEqual(st.critics, "off"); assert.strictEqual(st.autoFreeDays, 30); assert.strictEqual(st.distilledAt, 4);
    mod._.scan(); await sleep(60);
    assert.strictEqual(c.calls.length, 0, "nothing queued");
    const ok = await call(mod, "POST", "/api/taste/settings", { headers: PAGE, body: { autoFreeDays: 60 } });
    assert.strictEqual(ok.body.settings.autoFreeDays, 60);
    const saved = JSON.parse(fs.readFileSync(SET, "utf8"));
    assert.ok(/^[0-9a-f]{64}$/.test(saved.sig)); assert.strictEqual(saved.critics, "off");
    saved.critics = "panel"; write(SET, JSON.stringify(saved));
    assert.strictEqual(mk()._.settings().critics, "off", "an edited signed file falls back too");
    assert.strictEqual(mk()._.settings().autoFreeDays, 30);
    fs.rmSync(SET);
  });

  await test("eligibility: only settled models captured after grading was turned on get a critic", async () => {
    const old = `${today}_r30-1`;
    item(old);
    await sleep(5);
    const c = claude(CRIT);
    let mod = mk({ ...c, usage: usage() });
    await call(mod, "POST", "/api/taste/settings", { headers: PAGE, body: { critics: "one" } });
    const D = `${today}_r31-1`, E = `${today}_r32-1`;
    item(D, { phase: "stills" });
    item(E);
    write(AP_FILE, JSON.stringify({ active: true, current: { n: 32 }, guard: {}, daily: {} }));
    mod = mk({ ...c, usage: usage() });
    mod._.scan(); await sleep(80);
    assert.strictEqual(c.calls.length, 0, "nothing settled yet");
    assert.ok(!fs.existsSync(path.join(ITEMS, old, "critics.json")), "the backlog isn't queued");
    write(AP_FILE, JSON.stringify({ active: true, current: null, guard: {}, daily: {} }));
    mod = mk({ ...c, usage: usage() });
    mod._.scan();
    assert.ok(await until(() => c.calls.length === 1 && !mod._.Q.running), "one critic run");
    await sleep(50);
    assert.strictEqual(c.calls.length, 1, "only E (D stopped after its stills a moment ago)");
    const o = c.calls[0];
    assert.ok(/^You are the TASTE CRITIC \(taste\)/.test(o.prompt)); assert.strictEqual(o.lean, "Read"); assert.strictEqual(o.maxTurns, 10); assert.strictEqual(o.mode, "read");
    assert.ok(o.prompt.includes(path.join(ITEMS, E, "still-34.png")), "the 3/4 still is listed for Read");
    assert.ok(o.job && o.job.kind === "taste", "shows in the activity panel");
    const cr = crit(E);
    assert.deepStrictEqual(cr.pending, []); assert.strictEqual(cr.opinions.length, 1);
    assert.strictEqual(cr.opinions[0].lean, "deny"); assert.strictEqual(cr.opinions[0].score, 6); assert.strictEqual(cr.opinions[0].cost, 0.03);
    const s = (await call(mod, "GET", "/api/taste?status=review")).body.items.find((x) => x.id === E);
    assert.deepStrictEqual(s.critics, { lean: "deny", n: 1, pending: 0 });
  });

  await test("held(): a running round or usage near the cap makes critics wait (no run)", async () => {
    const F = `${today}_r33-1`;
    item(F);
    const c = claude(CRIT), live = new Map([["x", { kind: "training", done: false }]]);
    let mod = mk({ ...c, usage: usage(), live });
    assert.strictEqual(await mod._.held(), "a round is running");
    mod._.scan(); await sleep(100);
    assert.strictEqual(c.calls.length, 0);
    assert.strictEqual((await call(mod, "GET", "/api/taste")).body.critics.waiting, "a round is running");
    mod = mk({ ...c, usage: usage({ top: { percent: 88.4 } }) });
    assert.strictEqual(await mod._.held(), "usage at 88%");
    mod._.pump(); await sleep(100);
    assert.strictEqual(c.calls.length, 0);
    write(AP_FILE, JSON.stringify({ active: false, guard: { quiet: { on: true, from: 0, to: 0 } }, daily: {} }));
    assert.strictEqual(await mk({ ...c, usage: usage() })._.held(), null, "equal quiet hours mean off");
    write(AP_FILE, JSON.stringify({ active: false, guard: { cap: "r5" }, daily: { day: today, rounds: 5, cost: 0 } }));
    assert.strictEqual(await mk({ ...c, usage: usage() })._.held(), "Training's daily cap");
    write(AP_FILE, JSON.stringify({ active: false, guard: {}, daily: {} }));
    assert.strictEqual(await mk({ ...c })._.held(), "can't read usage");
  });

  await test("a restart re-queues unfinished lenses; a reviewed model's pending lenses are dropped instead", async () => {
    const F = `${today}_r33-1`, G = `${today}_r34-1`;
    write(path.join(ITEMS, F, "critics.json"), JSON.stringify(queue(F, { mode: "panel", requested: "auto", pending: ["surface", "taste"], opinions: [{ lens: "form", at: new Date().toISOString(), lean: "approve", score: 7 }] })));
    item(G);
    write(path.join(ITEMS, G, "critics.json"), JSON.stringify(queue(G, { mode: "panel", requested: "auto", pending: ["taste"], opinions: [] })));
    const H = `${today}_r35-1`; // planted by a round: requested "user" but not queued by the app
    item(H);
    write(path.join(ITEMS, H, "critics.json"), JSON.stringify({ mode: "panel", requested: "user", queuedAt: new Date().toISOString(), pending: ["form", "surface", "taste"], opinions: [] }));
    await call(mk(), "POST", `/api/taste/item/${G}/verdict`, { headers: PAGE, body: { decision: "approve", reasons: ["clean"] } });
    assert.strictEqual(crit(G).skipped, "you reviewed it first"); assert.deepStrictEqual(crit(G).pending, []);
    const c = claude(CRIT), mod = mk({ ...c, usage: usage() });
    mod.start();
    assert.ok(await until(() => c.calls.length === 2 && !mod._.Q.running), `two lens runs, got ${c.calls.length}`);
    assert.deepStrictEqual(c.calls.map((o) => /\((\w+)\)/.exec(o.prompt)[1]), ["surface", "taste"]);
    assert.ok(!c.calls.some((o) => o.prompt.includes(H)), "the planted queue never ran");
    assert.strictEqual(crit(H).pending.length, 3);
    fs.rmSync(path.join(ITEMS, H), { recursive: true });
    assert.strictEqual(crit(F).opinions.length, 3); assert.deepStrictEqual(crit(F).pending, []);
    assert.ok(fs.existsSync(mod._.CAPTURE), "the capture script was copied into the brain");
    assert.ok(/function snapshot\(\)/.test(fs.readFileSync(mod._.LUA, "utf8")), "the lighting helper was copied into the brain");
  });

  await test("Ask critics: Lite says no; Full replaces old opinions; turning grading off drops the queue", async () => {
    const F = `${today}_r33-1`;
    const lite = mk({ LITE: true });
    const r = await call(lite, "POST", `/api/taste/item/${F}/critique`, { headers: PAGE, body: {} });
    assert.strictEqual(r.code, 400); assert.ok(/Lite/.test(r.body.error));
    const c = claude(CRIT), mod = mk({ ...c, usage: usage({ top: { percent: 99 } }) });
    const q = await call(mod, "POST", `/api/taste/item/${F}/critique`, { headers: PAGE, body: {} });
    assert.deepStrictEqual(q.body, { queued: true });
    assert.deepStrictEqual(crit(F).opinions, []); assert.deepStrictEqual(crit(F).pending, ["taste"]);
    await call(mod, "POST", "/api/taste/settings", { headers: PAGE, body: { critics: "off" } });
    assert.deepStrictEqual(crit(F).pending, []); assert.strictEqual(crit(F).skipped, "grading was turned off");
    assert.strictEqual(c.calls.length, 0);
  });

  await test("hub dedupe: the same finished round broadcast 3 times scans once", async () => {
    let listener = null, scans = 0;
    const mod = mk({ hub: { on: (n, fn) => { if (n === "event") listener = fn; } }, usage: usage() });
    mod.start();
    const real = mod._.items; // count scans through the "items" broadcast: force a change each time
    const before = mod.events.length;
    const ev = { t: "autopilot", mode: "training", state: { last: { id: "abc", type: "result" } } };
    for (let i = 0; i < 3; i++) { item(`${today}_r${60 + i}-1`); listener(ev); }
    await sleep(80);
    scans = mod.events.slice(before).filter((e) => e.kind === "items").length;
    assert.strictEqual(scans, 1, `scans: ${scans}`);
    listener({ ...ev, state: { last: { id: "def", type: "result" } } }); item(`${today}_r63-1`);
    await sleep(80);
    assert.strictEqual(mod.events.slice(before).filter((e) => e.kind === "items").length, 2);
    void real;
  });

  await test("the Taste curator writes principles into taste.md (Lite: Haiku, no tools)", async () => {
    const c = claude("<principles>\n- Chunky, readable silhouettes over fine detail (3 reviews)\n- Avoid plain untextured surfaces (2 reviews)\n</principles>");
    const lite = mk({ LITE: true, ...c, usage: usage() });
    const r = await call(lite, "POST", "/api/taste/distill", { headers: PAGE, body: {} });
    assert.ok(r.body.text && r.body.text.includes("## Principles (Taste curator"), JSON.stringify(r.body));
    assert.ok(r.body.text.includes("Chunky, readable silhouettes"));
    const o = c.calls[0];
    assert.ok(/^You are the TASTE CURATOR/.test(o.prompt)); assert.strictEqual(o.model, "claude-haiku-5-5"); assert.strictEqual(o.tools, ""); assert.strictEqual(o.maxTurns, 1);
    assert.ok(/REVIEWS \(newest first\):\n- (APPROVED|DENIED) 3d model "/.test(o.prompt));
    assert.ok(o.prompt.includes('in the style "General"'), "the curator works one style at a time");
    assert.ok(lite._.settings().distilledAt > 0);
    assert.ok(lite._.prompt("planner").includes("Chunky, readable silhouettes"), "rounds get the principles");
  });

  await test("curator: distilledAt counts every decided review (over 60), so the next verdict doesn't rerun it", async () => {
    const lite = mk({ LITE: true });
    for (let i = 0; i < 62; i++) {
      const id = `2026-04-${String(1 + (i % 28)).padStart(2, "0")}_r${700 + i}-1`; item(id, { about: false, frames: 0, stills: false });
      await call(lite, "POST", `/api/taste/item/${id}/verdict`, { headers: PAGE, body: { decision: i % 2 ? "approve" : "deny", reasons: [i % 2 ? "detail" : "plain"] } });
    }
    const c = claude("<principles>\n- Chunky shapes (40 reviews)\n</principles>"), mod = mk({ ...c, usage: usage() });
    const n = mod._.counts(), decided = n.approved + n.denied;
    assert.ok(decided > 70, `decided ${decided}`);
    await mod._.distill();
    assert.strictEqual(c.calls.length, 1);
    assert.strictEqual(mod._.settings().distilledAt, decided, "the real count, not the 60 prompt lines");
    assert.strictEqual((c.calls[0].prompt.match(/^- (APPROVED|DENIED) /gm) || []).length, 60, "the prompt stays capped at 60");
    assert.ok(fs.readFileSync(path.join(BRAIN, "taste", "styles", "general", "principles.md"), "utf8").includes(`the newest 60 of ${decided} reviews`));
    const X = "2026-04-29_r799-1"; item(X, { about: false });
    await call(mod, "POST", `/api/taste/item/${X}/verdict`, { headers: PAGE, body: { decision: "approve", reasons: ["clean"] } });
    await sleep(150);
    assert.strictEqual(c.calls.length, 1, "one new review doesn't start the curator again");
  });

  await test("the away card lists models captured while away that still wait", async () => {
    const mod = mk(), now = Date.now();
    const s = mod._.digest((at) => { const t = Date.parse(at); return t >= now - 3600e3 && t <= now + 60e3; });
    assert.ok(s && s.key === "taste" && s.view === "taste", JSON.stringify(s));
    assert.ok(/models? waiting for your review/.test(s.title));
    assert.ok(s.lines.every((l) => /^Round \d+: /.test(l.text)));
    assert.strictEqual(mod._.digest(() => false), null);
  });

  await test("migration: the v1 library moves to <brain>\\taste once, after a checked backup; signed verdicts still verify", async () => {
    const B2 = path.join(TMP, "brain-old"), OLDI = path.join(B2, "training", "taste", "items"), NEWI = path.join(B2, "taste", "items");
    const id = "2026-01-05_r7-1", d = path.join(OLDI, id);
    write(path.join(d, "capture.json"), JSON.stringify({ v: 1, id, round: 7, at: "2026-01-05T10:00:00Z", phase: "done", tris: 10, dims: [1, 1, 1], materials: [], turntable: { frames: 0, done: 0 }, warnings: [] }));
    write(path.join(d, "still-34.png"), PNG);
    const v = resign({ v: 1, id, decision: "approve", reasons: ["clean"], note: "old one", at: "2026-01-06T10:00:00Z", by: "user", history: [] });
    write(path.join(d, "verdict.json"), JSON.stringify(v));
    write(path.join(B2, "training", "taste", "principles.md"), "# Principles\n- Chunky (2 reviews)\n");
    const old = new Date(Date.now() - 3600e3); for (const f of fs.readdirSync(d)) fs.utimesSync(path.join(d, f), old, old); fs.utimesSync(d, old, old);
    const mod = mk({ BRAIN: B2 });
    // Before the move, the old folder is still read (GET writes nothing).
    const before = walk(B2);
    assert.strictEqual((await call(mod, "GET", "/api/taste?status=approved")).body.items[0].id, id);
    assert.strictEqual(walk(B2), before);
    assert.strictEqual(mod._.migrate().moved, 1);
    assert.ok(fs.existsSync(path.join(NEWI, id, "verdict.json")) && !fs.existsSync(d), "moved");
    const mk1 = JSON.parse(fs.readFileSync(path.join(B2, "taste", "migrated.json"), "utf8"));
    assert.ok(fs.existsSync(path.join(mk1.backup, "items", id, "verdict.json")), "backup has the verdict");
    assert.ok(fs.existsSync(path.join(B2, "taste", "styles", "general", "principles.md")));
    assert.ok(/moved/i.test(fs.readFileSync(path.join(B2, "training", "taste", "README.md"), "utf8")));
    const it = (await call(mk({ BRAIN: B2 }), "GET", `/api/taste/item/${id}`)).body.item;
    assert.strictEqual(it.status, "approved"); assert.strictEqual(it.unverified, false);
    // A later arrival in the old folder is swept on the next migrate (no second backup); a fresh one waits.
    const id2 = "2026-01-07_r8-1"; write(path.join(OLDI, id2, "capture.json"), "{}");
    assert.strictEqual(mk({ BRAIN: B2 })._.migrate().moved, 0, "written just now: waits");
    for (const f of [path.join(OLDI, id2, "capture.json"), path.join(OLDI, id2)]) fs.utimesSync(f, old, old);
    assert.strictEqual(mk({ BRAIN: B2 })._.migrate().moved, 1);
    assert.strictEqual(fs.readdirSync(path.join(B2, "taste", "backup")).length, 1, "one backup only");
  });

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`${failed ? "FAILED" : "PASSED"}: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
