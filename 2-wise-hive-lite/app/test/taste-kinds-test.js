// Unit test for the Taste tab's wider library (taste.js): kinds, the inbox, uploads, round cards and chats, lighting,
// styles, comments and revisions, the critic before the queue. Fake ctx, scratch brain; no tokens.
//   node test/taste-kinds-test.js
"use strict";
const fs = require("fs"), path = require("path"), assert = require("assert"), crypto = require("crypto"), { Writable } = require("stream");
const APP = path.resolve(__dirname, "..");
const TMP = path.join(APP, ".research", "taste-kinds-" + process.pid);
const BRAIN = path.join(TMP, "brain");
const ROOT = path.join(BRAIN, "taste"), ITEMS = path.join(ROOT, "items"), INBOX = path.join(ROOT, "inbox");
const FX = require("./fixtures/taste/make-fixtures.js");
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log("PASS", name); } catch (e) { failed++; console.log("FAIL", name + ":", e && e.stack || e); } }
const write = (f, data) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); };
const KEY = "c0de".repeat(16);
const hmac = (list) => crypto.createHmac("sha256", KEY).update(JSON.stringify(list)).digest("hex");
const PAGE = { "x-hive": "1", origin: "http://127.0.0.1:4799", "sec-fetch-site": "same-origin" };
const old = (d) => { const t = new Date(Date.now() - 60e3); for (const f of fs.readdirSync(d)) fs.utimesSync(path.join(d, f), t, t); fs.utimesSync(d, t, t); };
function mk(extra = {}) {
  const events = [];
  const ctx = { BRAIN, APP_DIR: APP, PORT: 4799, LITE: false, tasteKey: () => ({ key: KEY, write: true }), read: (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } },
    json: (res, code, body) => res.done(code, body), body: async (req) => req.body || {}, broadcast: (o) => events.push(o), hub: { on() {} }, live: new Map(), tasteDry: true, ...extra };
  delete require.cache[require.resolve(path.join(APP, "taste.js"))];
  const mod = require(path.join(APP, "taste.js"))(ctx);
  mod.ctx = ctx; mod.events = events;
  return mod;
}
function call(mod, method, p, { headers = { "x-hive": "1" }, body } = {}) {
  return new Promise((ok) => {
    const url = new URL(p, "http://127.0.0.1:4799"), chunks = [];
    const res = new Writable({ write(c, e, cb) { chunks.push(Buffer.from(c)); cb(); } });
    let code = 0, hdr = {};
    res.writeHead = (c, h) => { code = c; hdr = h || {}; };
    res.done = (c, b) => ok({ code: c, body: b });
    res.on("finish", () => ok({ code, headers: hdr, buf: Buffer.concat(chunks) }));
    Promise.resolve(mod.route(url.pathname, { method, headers, body }, res, url)).then((h) => { if (!h) ok({ code: 404, body: { error: "unhandled" } }); });
  });
}
const byTitle = (list, t) => list.find((x) => x.title === t);

(async () => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(BRAIN, { recursive: true });

  await test("inbox: fixtures become items of four kinds; folders are removed; GET writes nothing", async () => {
    FX.make(INBOX);
    for (const d of fs.readdirSync(INBOX)) old(path.join(INBOX, d));
    const mod = mk();
    mod._.migrate(); // what start() does first: writes version.json (work from before it never waits for the critic)
    assert.ok(fs.existsSync(path.join(ROOT, "version.json")));
    const made = mod._.ingest();
    assert.strictEqual(made.length, 4, made.join());
    assert.deepStrictEqual(fs.readdirSync(INBOX), []);
    const l = (await call(mod, "GET", "/api/taste?status=all")).body;
    const kinds = l.items.map((x) => x.kind).sort();
    assert.deepStrictEqual(kinds, ["audio", "image", "lighting", "pixel"]);
    assert.ok(l.kinds && l.kinds.lighting === "Lighting");
    assert.ok(l.reasons.audio.approve.length && l.reasons.lighting.deny.some((r) => r[0] === "foggy"));
    const px = byTitle(l.items, "Slime enemy sprite");
    assert.ok(px.thumb && px.thumb.file === "slime.png", JSON.stringify(px.thumb));
    const walk = (d) => { const o = []; const w = (x) => { for (const e of fs.readdirSync(x, { withFileTypes: true })) { const f = path.join(x, e.name); o.push(f + (e.isDirectory() ? "" : ":" + fs.statSync(f).mtimeMs)); if (e.isDirectory()) w(f); } }; w(d); return o.sort().join("\n"); };
    const before = walk(BRAIN);
    for (const x of l.items) { await call(mod, "GET", `/api/taste/item/${x.id}`); if (x.thumb) await call(mod, "GET", `/api/taste/file/${x.id}/${x.thumb.file}`); }
    await call(mod, "GET", "/api/taste/summary"); await call(mod, "GET", "/api/taste/count");
    assert.strictEqual(walk(BRAIN), before, "a GET changed the brain");
  });

  await test("files: served with their type and nosniff/sandbox; names outside the list are 404/400", async () => {
    const mod = mk(), l = (await call(mod, "GET", "/api/taste?status=all")).body;
    const au = byTitle(l.items, "Coin pickup chime");
    const r = await call(mod, "GET", `/api/taste/file/${au.id}/coin-chime.wav`);
    assert.strictEqual(r.code, 200); assert.strictEqual(r.headers["Content-Type"], "audio/wav"); assert.strictEqual(r.headers["X-Content-Type-Options"], "nosniff");
    assert.ok(/sandbox/.test(r.headers["Content-Security-Policy"]));
    assert.strictEqual(r.buf.toString("latin1", 0, 4), "RIFF");
    assert.strictEqual((await call(mod, "GET", `/api/taste/file/${au.id}/item.json`)).code, 400);
    assert.strictEqual((await call(mod, "GET", `/api/taste/file/${au.id}/other.wav`)).code, 404);
    assert.strictEqual((await call(mod, "GET", `/api/taste/file/${au.id}/..%2f..%2fx.wav`)).code, 400);
  });

  await test("lighting: views, times of day, a settings diff and an undo script built from the old values", async () => {
    const mod = mk(), l = (await call(mod, "GET", "/api/taste?status=all")).body, id = byTitle(l.items, "Warm harbour evening").id;
    const it = (await call(mod, "GET", `/api/taste/item/${id}`)).body.item;
    const L = it.lighting;
    assert.strictEqual(L.views.length, 3); assert.ok(L.views[0].before && L.views[0].after); assert.strictEqual(L.views[0].times[0].time, "Dusk 19:00");
    const keys = L.diff.map((d) => d.key);
    for (const k of ["Brightness", "Technology", "FogEnd", "Bloom", "ColorCorrection", "Atmosphere Density"]) assert.ok(keys.includes(k), k + " in " + keys.join());
    assert.ok(!keys.includes("Sky SunAngularSize"), "unchanged values aren't listed");
    assert.deepStrictEqual(L.diff.find((d) => d.key === "Brightness"), { key: "Brightness", before: "2", after: "3" });
    assert.strictEqual(L.diff.find((d) => d.key === "Bloom").after, "added");
    assert.ok(L.undoLua.includes('set(L, "Brightness", 2)') && L.undoLua.includes("Enum.Technology.ShadowMap") && L.undoLua.includes("Color3.new(0.27, 0.27, 0.27)"));
    assert.ok(/FindFirstChild\("Bloom"\) if c and c:IsA\("BloomEffect"\) then c:Destroy\(\)/.test(L.undoLua), "the added Bloom is removed");
    assert.ok(it.critique && it.critique.passes === 3 && it.critique.fixed.length === 1);
    assert.strictEqual(it.source.type, "working");
  });

  await test("inbox safety: a path outside the allowed folders, a .key file or ../ is refused with error.txt", async () => {
    // A real picture outside every allowed folder (Windows' own wallpaper), so only the folder rule can refuse it.
    const outside = [path.join(process.env.SystemRoot || "C:\\Windows", "Web", "Screen", "img100.jpg"), path.join(process.env.SystemRoot || "C:\\Windows", "Web", "Wallpaper", "Windows", "img0.jpg")].find((f) => fs.existsSync(f)) || "C:\\nowhere\\x.png";
    assert.strictEqual(mk()._.srcOk(outside), null, "outside the allowed folders");
    const keyFile = path.join(BRAIN, "app-settings", "x.png"); write(keyFile, FX.png(2, 2, () => [1, 2, 3]));
    for (const [name, files] of [["a", [outside]], ["b", [keyFile]], ["c", ["../x.png"]], ["d", [path.join(BRAIN, "secret.key")]]]) {
      write(path.join(INBOX, name, "item.json"), JSON.stringify({ kind: "image", title: name, files }));
      old(path.join(INBOX, name));
    }
    write(path.join(BRAIN, "secret.key"), "k");
    const mod = mk();
    assert.deepStrictEqual(mod._.ingest(), []);
    for (const n of ["a", "b", "c", "d"]) assert.ok(fs.existsSync(path.join(INBOX, n, "error.txt")), n);
    assert.deepStrictEqual(mod._.ingest(), [], "not retried until item.json changes");
    fs.rmSync(INBOX, { recursive: true, force: true });
  });
  await test("upload (page only): kind guessed (small PNG = pixel art), files saved, source upload", async () => {
    const mod = mk(), b64 = FX.png(12, 12, () => [200, 40, 40]).toString("base64");
    const body = { files: [{ name: "tiny gem.png", data: b64 }], title: "Gem icon" };
    assert.strictEqual((await call(mod, "POST", "/api/taste/upload", { body })).code, 403);
    const r = await call(mod, "POST", "/api/taste/upload", { headers: PAGE, body });
    assert.strictEqual(r.code, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.item.kind, "pixel"); assert.strictEqual(r.body.item.source.type, "upload"); assert.strictEqual(r.body.item.source.by, "user");
    assert.deepStrictEqual(r.body.item.fileList.map((f) => f.file), ["tiny_gem.png"]);
    const bad = await call(mod, "POST", "/api/taste/upload", { headers: PAGE, body: { files: [{ name: "run.exe", data: "AAAA" }] } });
    assert.strictEqual(bad.code, 400); assert.ok(/doesn't keep/.test(bad.body.error));
  });

  await test("import: a Working round card's picture and a chat's file", async () => {
    const rd = path.join(BRAIN, "working", "harbor-town", "rounds", "4");
    write(path.join(rd, "card.json"), JSON.stringify({ v: 1, n: 4, title: "Shop panel polish", summary: "Rounded the panel.", project: { name: "Harbor Town" } }));
    write(path.join(rd, "cap-001.png"), FX.png(40, 30, () => [10, 200, 10]));
    const pic = path.join(BRAIN, "uploads", "x", "render.png"); write(pic, FX.png(300, 300, () => [9, 9, 9]));
    const mod = mk({ mediaFile: (t) => (t === "tok" ? { file: pic, name: "render.png" } : null) });
    const r = await call(mod, "POST", "/api/taste/import", { headers: PAGE, body: { from: "round", slug: "harbor-town", n: 4, files: ["cap-001.png"] } });
    assert.strictEqual(r.code, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.item.title, "Shop panel polish"); assert.strictEqual(r.body.item.source.type, "working"); assert.strictEqual(r.body.item.source.n, 4);
    assert.strictEqual((await call(mod, "POST", "/api/taste/import", { headers: PAGE, body: { from: "round", slug: "harbor-town", n: 4, files: ["../card.json"] } })).code, 400);
    const m = await call(mod, "POST", "/api/taste/import", { headers: PAGE, body: { from: "media", id: "tok", chatId: "abc-123" } });
    assert.strictEqual(m.code, 200, JSON.stringify(m.body)); assert.strictEqual(m.body.item.kind, "image"); assert.strictEqual(m.body.item.chatId, "abc-123");
    assert.strictEqual((await call(mod, "POST", "/api/taste/import", { headers: PAGE, body: { from: "media", id: "nope" } })).code, 400);
  });

  await test("open: only the item's own files; dry run here", async () => {
    const mod = mk(), l = (await call(mod, "GET", "/api/taste?status=all")).body, au = byTitle(l.items, "Coin pickup chime");
    assert.strictEqual((await call(mod, "POST", `/api/taste/item/${au.id}/open`, { headers: PAGE, body: { file: "coin-chime.wav", action: "reveal" } })).body.dry, true);
    assert.strictEqual((await call(mod, "POST", `/api/taste/item/${au.id}/open`, { headers: PAGE, body: { file: "..\\..\\x.wav", action: "open" } })).code, 404);
  });

  await test("styles: create (page only), no duplicate names, rename/describe, General can't be archived", async () => {
    const mod = mk();
    assert.strictEqual((await call(mod, "POST", "/api/taste/styles", { body: { action: "create", name: "Cosy cartoon" } })).code, 403);
    const r = await call(mod, "POST", "/api/taste/styles", { headers: PAGE, body: { action: "create", name: "Cosy cartoon", description: "Warm, chunky, readable" } });
    assert.strictEqual(r.code, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.style.id, "cosy-cartoon");
    assert.strictEqual((await call(mod, "POST", "/api/taste/styles", { headers: PAGE, body: { action: "create", name: "cosy CARTOON" } })).code, 400);
    assert.strictEqual((await call(mod, "POST", "/api/taste/styles", { headers: PAGE, body: { action: "archive", id: "general" } })).code, 400);
    await call(mod, "POST", "/api/taste/styles", { headers: PAGE, body: { action: "create", name: "Gritty realism" } });
    const u = await call(mod, "POST", "/api/taste/styles", { headers: PAGE, body: { action: "update", id: "gritty-realism", name: "Gritty PBR", description: "Worn metal" } });
    assert.strictEqual(u.body.style.name, "Gritty PBR"); assert.strictEqual(u.body.style.id, "gritty-realism", "the id stays");
    const g = (await call(mod, "GET", "/api/taste/styles")).body;
    assert.deepStrictEqual(g.styles.map((s) => s.id), ["general", "cosy-cartoon", "gritty-realism"]);
    assert.ok(g.styles[0].counts.total >= 4, "fixtures are in General");
    assert.ok(fs.existsSync(path.join(ROOT, "styles", "cosy-cartoon", "summary.md")), "each style gets a summary file");
    assert.ok(/Cosy cartoon \(cosy-cartoon\)/.test(fs.readFileSync(path.join(ROOT, "taste.md"), "utf8")), "taste.md indexes the styles");
  });

  await test("moving an item to another style: signed place.json; a planted one is ignored; filters and summaries follow", async () => {
    const mod = mk(), l = (await call(mod, "GET", "/api/taste?status=all")).body, sl = byTitle(l.items, "Slime enemy sprite");
    assert.strictEqual(sl.style, "general");
    assert.strictEqual((await call(mod, "POST", `/api/taste/item/${sl.id}/style`, { headers: PAGE, body: { style: "nope" } })).code, 404);
    const r = await call(mod, "POST", `/api/taste/item/${sl.id}/style`, { headers: PAGE, body: { style: "cosy-cartoon" } });
    assert.strictEqual(r.code, 200); assert.strictEqual(r.body.item.style, "cosy-cartoon");
    const f = (await call(mod, "GET", "/api/taste?status=all&style=cosy-cartoon")).body;
    assert.deepStrictEqual(f.items.map((x) => x.title), ["Slime enemy sprite"]); assert.strictEqual(f.counts.total, 1); assert.ok(f.countsAll.total > 1);
    assert.strictEqual((await call(mod, "GET", "/api/taste?status=all&kind=audio")).body.items.length, 1);
    // A place.json the app didn't sign doesn't move anything.
    const au = byTitle(l.items, "Coin pickup chime");
    write(path.join(ITEMS, au.id, "place.json"), JSON.stringify({ id: au.id, style: "gritty-realism", at: new Date().toISOString(), sig: "0".repeat(64) }));
    assert.strictEqual((await call(mk(), "GET", `/api/taste/item/${au.id}`)).body.item.style, "general");
    // A verdict in a style lands in that style's summary only.
    await call(mod, "POST", `/api/taste/item/${sl.id}/verdict`, { headers: PAGE, body: { decision: "approve", reasons: ["colors"], note: "love the cute outline" } });
    const cosy = fs.readFileSync(path.join(ROOT, "styles", "cosy-cartoon", "summary.md"), "utf8"), gen = fs.readFileSync(path.join(ROOT, "styles", "general", "summary.md"), "utf8");
    assert.ok(cosy.includes("Nice colors (1)") && cosy.includes("love the cute outline") && cosy.includes("[pixel art]"), cosy);
    assert.ok(!gen.includes("cute outline"));
    const s = (await call(mod, "GET", "/api/taste/summary?style=cosy-cartoon")).body;
    assert.strictEqual(s.style, "cosy-cartoon"); assert.ok(s.text.includes("cute outline"));
  });

  await test("picks: Training and per-project choices; the user's pick wins over the planner's; archived styles don't count", async () => {
    const mod = mk();
    assert.strictEqual(mod._.styleFor("training", null, "gritty-realism").id, "gritty-realism");
    assert.strictEqual(mod._.styleFor("training", null, "bogus").by, "default");
    await call(mod, "POST", "/api/taste/pick", { headers: PAGE, body: { mode: "training", style: "cosy-cartoon" } });
    const t = mod._.styleFor("training", null, "gritty-realism");
    assert.strictEqual(t.id, "cosy-cartoon"); assert.strictEqual(t.by, "you");
    const dir = "D:\\Games\\HarborTown";
    await call(mod, "POST", "/api/taste/pick", { headers: PAGE, body: { mode: "working", project: dir, style: "gritty-realism" } });
    assert.strictEqual(mod._.styleFor("working", "d:\\games\\harbortown").id, "gritty-realism");
    assert.strictEqual(mod._.styleFor("working", "D:\\Games\\Other").by, "default");
    await call(mod, "POST", "/api/taste/styles", { headers: PAGE, body: { action: "archive", id: "gritty-realism" } });
    assert.strictEqual(mod._.styleFor("working", dir).by, "default", "an archived pick falls back");
    await call(mod, "POST", "/api/taste/styles", { headers: PAGE, body: { action: "restore", id: "gritty-realism" } });
    const p = (await call(mod, "GET", "/api/taste/styles")).body.picks;
    assert.strictEqual(p.training, "cosy-cartoon"); assert.strictEqual(p.projects[dir.toLowerCase()], "gritty-realism");
    await call(mod, "POST", "/api/taste/pick", { headers: PAGE, body: { mode: "training", style: "" } });
  });

  const inbox = (name, item, files = { "a.png": FX.png(8, 8, () => [1, 2, 3]) }) => {
    const d = path.join(INBOX, name);
    for (const [f, b] of Object.entries(files)) write(path.join(d, f), b);
    write(path.join(d, "item.json"), JSON.stringify({ files: Object.keys(files), ...item }));
    old(d);
  };
  await test("the critic gate: round work without critique.json waits in Unfinished; with it, it reaches the queue", async () => {
    inbox("r1", { kind: "image", title: "Raw round output", source: { type: "working", project: "Harbor Town" } });
    inbox("r2", { kind: "image", title: "Critiqued output", source: { type: "training", round: 9 }, critique: { score: 6, mustFix: [], niceToHave: ["more contrast"], passes: 2 } });
    const mod = mk(); mod._.ingest();
    const l = (await call(mod, "GET", "/api/taste?status=all")).body;
    assert.strictEqual(byTitle(l.items, "Raw round output").status, "unfinished");
    assert.strictEqual(byTitle(l.items, "Critiqued output").status, "review");
    assert.ok(l.countsAll.unfinished >= 1);
    // Round work from before this version first ran (v1's models) never waits for the critic.
    const od = path.join(ITEMS, "2026-01-01_old-round");
    write(path.join(od, "a.png"), FX.png(4, 4, () => [5, 5, 5]));
    write(path.join(od, "item.json"), JSON.stringify({ kind: "image", title: "Old round output", at: "2026-01-01T00:00:00.000Z", source: { type: "training", round: 1 }, files: ["a.png"] }));
    assert.strictEqual((await call(mk(), "GET", "/api/taste/item/2026-01-01_old-round")).body.item.status, "review");
    assert.ok(!(await call(mod, "GET", "/api/taste?status=review")).body.items.some((x) => x.title === "Raw round output"), "not in the queue");
    const raw = byTitle(l.items, "Raw round output");
    assert.strictEqual((await call(mod, "POST", `/api/taste/item/${raw.id}/release`, { body: {} })).code, 403);
    const r = await call(mod, "POST", `/api/taste/item/${raw.id}/release`, { headers: PAGE, body: {} });
    assert.strictEqual(r.body.item.status, "review"); assert.ok(/before Claude's critic/.test(r.body.item.critique.skipped));
  });

  await test("the critic switch: signed, Lite off by default (queue marks 'not reviewed by Claude'); v1-signed settings still verify", async () => {
    inbox("r3", { kind: "image", title: "Lite round output", source: { type: "training", round: 10 } });
    const lite = mk({ LITE: true }); lite._.ingest();
    const x = byTitle((await call(lite, "GET", "/api/taste?status=all")).body.items, "Lite round output");
    assert.strictEqual(x.status, "review"); assert.strictEqual(x.notCritiqued, true);
    assert.strictEqual(lite._.settings().loopCritic, false);
    const mod = mk();
    assert.strictEqual(mod._.settings().loopCritic, true);
    assert.strictEqual(byTitle((await call(mod, "GET", "/api/taste?status=all")).body.items, "Lite round output").status, "unfinished", "full: held for the critic");
    const r = await call(mod, "POST", "/api/taste/settings", { headers: PAGE, body: { loopCritic: false } });
    assert.strictEqual(r.body.settings.loopCritic, false);
    assert.strictEqual(byTitle((await call(mk(), "GET", "/api/taste?status=all")).body.items, "Lite round output").status, "review");
    // A settings.json signed by v1 (4 keys) keeps its values; the new switch takes its default.
    const SET = path.join(ROOT, "settings.json"), v1 = { critics: "one", criticsSince: 5, autoDistill: true, autoFreeDays: 90, distilledAt: 0 };
    v1.sig = hmac(["settings", "one", 5, true, 90]);
    write(SET, JSON.stringify(v1));
    const s = mk()._.settings();
    assert.strictEqual(s.critics, "one"); assert.strictEqual(s.autoFreeDays, 90); assert.strictEqual(s.loopCritic, true);
    const forged = { ...v1, loopCritic: false }; write(SET, JSON.stringify(forged));
    assert.strictEqual(mk()._.settings().loopCritic, true, "a switch added to a v1-signed file is ignored");
    write(SET, JSON.stringify({ ...v1, critics: "panel" }));
    assert.strictEqual(mk()._.settings().critics, "off", "an edited file falls back to the defaults");
    fs.rmSync(SET);
  });

  await test("Comment: needs words; the item goes back to Claude; a revision links to it and both are kept", async () => {
    const mod = mk(), l = (await call(mod, "GET", "/api/taste?status=review")).body, sh = byTitle(l.items, "Shop panel mockup");
    assert.strictEqual((await call(mod, "POST", `/api/taste/item/${sh.id}/verdict`, { headers: PAGE, body: { decision: "comment", note: "" } })).code, 400);
    const r = await call(mod, "POST", `/api/taste/item/${sh.id}/verdict`, { headers: PAGE, body: { decision: "comment", note: "Make the Buy button bigger and less green", reasons: ["colors"] } });
    assert.strictEqual(r.code, 200); assert.strictEqual(r.body.item.status, "comment"); assert.deepStrictEqual(r.body.item.reasons, []);
    assert.ok(fs.readFileSync(path.join(ROOT, "styles", "general", "summary.md"), "utf8").includes("Make the Buy button bigger"), "comments feed the style's summary");
    assert.strictEqual((await call(mod, "GET", "/api/taste?status=comment")).body.items[0].id, sh.id);
    inbox("rev", { kind: "image", title: "Shop panel mockup v2", revisionOf: sh.id, changes: ["Buy button 40% bigger", "Muted green"], source: { type: "training", round: 11 }, critique: { score: 7, mustFix: [], passes: 2 } },
      { "shop-panel-v2.png": FX.png(30, 20, () => [9, 90, 9]) });
    mod._.ingest();
    const old1 = (await call(mod, "GET", `/api/taste/item/${sh.id}`)).body.item;
    assert.strictEqual(old1.status, "revised"); assert.ok(old1.next && old1.next.title === "Shop panel mockup v2");
    const nw = (await call(mod, "GET", `/api/taste/item/${old1.next.id}`)).body.item;
    assert.strictEqual(nw.status, "review"); assert.strictEqual(nw.previous.id, sh.id); assert.strictEqual(nw.previous.comment, "Make the Buy button bigger and less green");
    assert.deepStrictEqual(nw.changes, ["Buy button 40% bigger", "Muted green"]);
    assert.strictEqual((await call(mod, "GET", "/api/taste?status=comment")).body.items.length, 0, "the comment is answered");
  });

  await test("prompts: the planner sees styles and open comments; the worker gets its style, the critic loop, the inbox and the revision rule", async () => {
    const mod = mk();
    // An open comment (Training): the slime sprite gets sent back.
    const sl = byTitle((await call(mod, "GET", "/api/taste?status=all")).body.items, "Slime enemy sprite");
    await call(mod, "POST", `/api/taste/item/${sl.id}/verdict`, { headers: PAGE, body: { decision: "comment", note: "Give it a bigger shine and a darker outline" } });
    const pl = mod._.prompt("planner", { mode: "training" });
    assert.ok(pl.includes("STYLES (id: name: description):") && pl.includes("- cosy-cartoon: Cosy cartoon: Warm, chunky, readable"), pl);
    assert.ok(pl.includes('add "style": "<its id>"'), "no pick: the planner chooses");
    assert.ok(pl.includes("OPEN COMMENTS") && pl.includes(`- ${sl.id}: "Slime enemy sprite" (pixel art, style cosy-cartoon): "Give it a bigger shine`), pl);
    await call(mod, "POST", "/api/taste/pick", { headers: PAGE, body: { mode: "training", style: "cosy-cartoon" } });
    const pl2 = mk()._.prompt("planner", { mode: "training" });
    assert.ok(pl2.includes('The user picked the style "Cosy cartoon"') && pl2.includes('THE TASTE FOR "Cosy cartoon":') && pl2.includes("bigger shine"), pl2);
    await call(mod, "POST", "/api/taste/pick", { headers: PAGE, body: { mode: "training", style: "" } });
    const w = mk()._.prompt("worker", { n: 5, date: "2026-10-20", mode: "training", style: "cosy-cartoon", styleBy: "planner", revises: sl.id });
    for (const k of ['Style for this round: "Cosy cartoon" (cosy-cartoon; chosen by the planner)', "separate critic", "never to approve it", "critique.json", path.join(ROOT, "inbox"),
      '"source":{"type":"training","round":5}', `"revisionOf":"${sl.id}"`, "Work on a COPY", "Give it a bigger shine", "capture(r", "The user's taste in the style \"Cosy cartoon\""]) assert.ok(w.includes(k), k);
    assert.ok(w.indexOf("The user's taste in the style") > w.indexOf("capture(r"), "the taste comes last");
    const ww = mk()._.prompt("worker", { n: 3, mode: "working", style: "general", project: { name: "Harbor Town", dir: "D:\\Games\\Harbor Town" }, cardDir: "D:\\x\\rounds\\3", goal: "warmer lighting" });
    for (const k of ['"source":{"type":"working","project":"Harbor Town"}', "Lighting (Roblox Studio or Blender)", "taste_lighting.luau", "D:\\x\\rounds\\3", "### Critique", "never publish"]) assert.ok(ww.includes(k), k);
    assert.ok(!ww.includes("capture(r"), "Working doesn't get the Blender capture steps");
    const lite = mk({ LITE: true })._.prompt("worker", { n: 6, mode: "training", style: "general" });
    assert.ok(lite.includes("Claude's critic is switched off") && !lite.includes("separate critic"), lite.slice(0, 600));
  });

  await test("autopilot: the round uses the user's pick over the planner's style, says so in the Log, and the worker prompt carries it", async () => {
    const AP = path.join(TMP, "ap"); process.env.HIVE_AUTOPILOT_DIR = AP;
    const runs = [], pushes = [];
    const ctx = { BRAIN, HOME: TMP, PORT: 4799, APP_DIR: APP, LITE: false, hub: new (require("events").EventEmitter)(), tasteKey: () => ({ key: KEY, write: true }), live: new Map(), tasteDry: true,
      read: (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } }, json: (res, code, body) => { res.code = code; res.body = body; }, body: async (req) => req.body || {},
      broadcast: (e) => pushes.push(e), notify: () => {},
      usage: { refresh: async () => null, brief: () => null, ensure: async () => {}, over: () => null, readAt: () => Date.now(), isGaming: async () => ({ gaming: false }), route: () => false },
      askClaude: async () => ({ text: JSON.stringify({ title: "Chunky crate", focus: "modeling", agents: ["modeler"], why: "practice", prompt: "Model a crate.", style: "gritty-realism", next: [] }) }),
      startChat: (opts) => { const run = { id: crypto.randomUUID(), opts, events: [], chatId: null, done: false }; runs.push(run); return run; }, stopChat: (r) => { r.stopped = true; }, stopRun: () => true,
      autopilotTimings: { cooldown: 30, poll: 20, firstBeat: 1e9, beat: 1e9 } };
    for (const m of ["taste.js", "autopilot.js"]) delete require.cache[require.resolve(path.join(APP, m))];
    require(path.join(APP, "taste.js"))(ctx);
    const ap = require(path.join(APP, "autopilot.js"))(ctx);
    const res = {}; await ap.route("/api/autopilot/training/start", { method: "POST", body: { goal: "Props", permission: "safe" } }, res, new URL("http://x/api/autopilot/training/start"));
    for (let t = Date.now(); !runs.length && Date.now() - t < 5000;) await new Promise((r) => setTimeout(r, 20));
    const p = runs[0].opts.prompt;
    assert.ok(p.includes('Style for this round: "Gritty PBR" (gritty-realism; chosen by the planner)'), p.slice(-3000));
    const log = JSON.parse(fs.readFileSync(path.join(AP, "training.json"), "utf8")).log;
    assert.ok(log.some((e) => e.type === "plan" && /Style: Gritty PBR \(the planner's pick\)/.test(e.text)), JSON.stringify(log.map((e) => e.text)));
    await ap.route("/api/autopilot/training/stop", { method: "POST", body: {} }, {}, new URL("http://x/api/autopilot/training/stop"));
  });

  await test("inbox: 25 failed folders sorting first don't stop the next good one; a junction out of the folder is refused", async () => {
    for (let i = 0; i < 25; i++) { write(path.join(INBOX, `a${String(i).padStart(2, "0")}`, "item.json"), JSON.stringify({ kind: "image", title: "bad", files: ["../x.png"] })); old(path.join(INBOX, `a${String(i).padStart(2, "0")}`)); }
    const mod = mk();
    assert.deepStrictEqual(mod._.ingest(), [], "the bad ones fail");
    write(path.join(INBOX, "zz-good", "a.png"), FX.png(8, 8, () => [1, 2, 3]));
    write(path.join(INBOX, "zz-good", "item.json"), JSON.stringify({ kind: "image", title: "good", files: ["a.png"] }));
    old(path.join(INBOX, "zz-good"));
    assert.strictEqual(mod._.ingest().length, 1, "the good folder still gets in");
    // A junction inside an inbox folder pointing at a folder outside it (no admin needed for /J).
    const target = path.join(BRAIN, "outside-target"); write(path.join(target, "leak.png"), FX.png(4, 4, () => [9, 9, 9]));
    const d = path.join(INBOX, "zz-junction"); fs.mkdirSync(d, { recursive: true });
    require("child_process").execFileSync("cmd.exe", ["/c", "mklink", "/J", path.join(d, "j"), target], { windowsHide: true, stdio: "ignore" });
    write(path.join(d, "item.json"), JSON.stringify({ kind: "image", title: "junction", files: ["j\\leak.png"] }));
    old(d);
    assert.deepStrictEqual(mod._.ingest(), [], "a file reached through a junction isn't taken");
    assert.ok(/isn't in the folder/.test(fs.readFileSync(path.join(d, "error.txt"), "utf8")));
    fs.rmSync(path.join(d, "j"), { force: true, recursive: false });
    fs.rmSync(INBOX, { recursive: true, force: true });
  });

  await test("curator: each style has its own run and its own wait (another style's verdict neither joins nor cancels it)", async () => {
    const sleep = (t) => new Promise((r) => setTimeout(r, t));
    const usage = { over: () => null, ensure: async () => {}, readAt: () => Date.now(), isGaming: async () => ({ gaming: false }) };
    // A slow stand-in for Claude, so runs overlap.
    const slow = (calls) => (o) => { calls.push(o); setTimeout(() => { o.onEvent({ type: "result", subtype: "success", is_error: false, result: "<principles>\n- Chunky shapes (10 reviews)\n</principles>" }); o.onEnd(0, ""); }, 80); return "run-" + calls.length; };
    const mod = mk();
    assert.strictEqual((await call(mod, "POST", "/api/taste/styles", { headers: PAGE, body: { action: "create", name: "Curator test" } })).code, 200);
    await call(mod, "POST", "/api/taste/settings", { headers: PAGE, body: { autoDistill: false } }); // no runs while the reviews are made
    const png = FX.png(12, 12, () => [10, 200, 10]).toString("base64");
    for (const style of ["general", "curator-test"]) for (let i = 0; i < 10; i++) {
      const u = await call(mod, "POST", "/api/taste/upload", { headers: PAGE, body: { files: [{ name: `c${i}.png`, data: png }], title: `curator ${style} ${i}`, style } });
      assert.strictEqual(u.code, 200, JSON.stringify(u.body));
      assert.strictEqual((await call(mod, "POST", `/api/taste/item/${u.body.item.id}/verdict`, { headers: PAGE, body: { decision: i % 2 ? "approve" : "deny", reasons: [], note: "curator test " + i } })).code, 200);
    }
    await call(mod, "POST", "/api/taste/settings", { headers: PAGE, body: { autoDistill: true } });
    // Both styles due: a verdict in one style right after one in the other still runs both.
    const calls = [], a = mk({ runClaude: slow(calls), usage, tasteDistillDelay: 30 });
    a._.maybeDistill("general"); a._.maybeDistill("curator-test");
    for (let t = 0; t < 100 && calls.length < 2; t++) await sleep(20);
    await sleep(250);
    assert.strictEqual(calls.length, 2, "one run per style");
    assert.ok(calls.some((o) => o.prompt.includes('in the style "General"')) && calls.some((o) => o.prompt.includes('in the style "Curator test"')));
    // At the same moment: each style gets its own run; the same style twice shares one.
    const c2 = [], b = mk({ runClaude: slow(c2), usage });
    const [g, ct, g2] = await Promise.all([b._.distill("general"), b._.distill("curator-test"), b._.distill("general")]);
    assert.strictEqual(c2.length, 2);
    assert.strictEqual(g.style, "general"); assert.strictEqual(ct.style, "curator-test"); assert.strictEqual(g2, g);
  });

  await test("every Training round reaches the library: collectRound files what a round wrote, once, and it waits in the queue", async () => {
    const mod = mk(), SB = path.join(BRAIN, "training", "sandbox");
    const now = Date.now();
    write(path.join(SB, "vfx_r99", "fireball.luau"), "local M = {}\nreturn M\n");
    write(path.join(SB, "vfx_r99", "preview.png"), FX.png(8, 8, () => [200, 80, 20]));
    write(path.join(SB, "vfx_r99", "build.py"), "import bpy\n");
    write(path.join(SB, "videos", "tutorial.mp4"), "not round work");          // learning material stays out
    write(path.join(SB, "old_r10", "old.png"), FX.png(4, 4, () => [1, 1, 1]));
    fs.utimesSync(path.join(SB, "old_r10", "old.png"), new Date(now - 864e5), new Date(now - 864e5)); // before the round
    const id = mod.ctx.taste.collectRound({ n: 99, title: "Roblox fireball VFX", about: "Built a fireball.", from: now - 60000, to: now + 1000 });
    assert.ok(id, "an item is made");
    const it = (await call(mod, "GET", `/api/taste/item/${id}`)).body.item;
    const names = it.fileList.map((f) => f.file || f.name || f).join(" ");
    assert.ok(/fireball\.luau/.test(names) && /preview\.png/.test(names) && /build\.py/.test(names), names);
    assert.ok(!/tutorial\.mp4|old\.png/.test(names), "videos and older files stay out: " + names);
    assert.strictEqual(it.source.round, 99); assert.strictEqual(it.source.auto, true);
    assert.notStrictEqual(it.status, "unfinished", "auto round work goes to the queue");
    assert.strictEqual(mod.ctx.taste.collectRound({ n: 99, title: "again", from: now - 60000, to: now + 1000 }), null, "never twice for one round");
    // A round that sent its own work through the inbox isn't collected again.
    write(path.join(INBOX, "r100", "item.json"), JSON.stringify({ kind: "image", title: "own", source: { type: "training", round: 100 }, files: [] }));
    assert.strictEqual(mod.ctx.taste.collectRound({ n: 100, title: "x", from: now - 60000, to: now + 1000 }), null);
  });

  await test("collectRound keeps the .blend when a round wrote 45 pictures (models first, at most 20 pictures)", async () => {
    const mod = mk(), SB = path.join(BRAIN, "blender", "practice", "r97");
    const now = Date.now();
    for (let i = 0; i < 45; i++) write(path.join(SB, `frame_${String(i).padStart(2, "0")}.png`), FX.png(4, 4, () => [i, 1, 1]));
    write(path.join(SB, "blaster_r97.blend"), "BLENDER-v500 not a real file");
    write(path.join(SB, "blaster_r97.py"), "import bpy\n");
    const id = mod.ctx.taste.collectRound({ n: 97, title: "Blaster", from: now - 60000, to: now + 1000 });
    const it = (await call(mod, "GET", `/api/taste/item/${id}`)).body.item;
    const names = it.fileList.map((f) => f.file);
    assert.ok(names.includes("blaster_r97.blend") && names.includes("blaster_r97.py"), names.join(" "));
    assert.strictEqual(names.filter((n) => n.endsWith(".png")).length, 20);
  });

  // Needs Blender (skipped without it): a .blend in an item becomes a spin (capture + stills + turntable) and, because
  // it moves, an animation video, both listed on the item; the item becomes a 3D model.
  const views = mk({ tasteViews: true })._.views;
  const exe = views && views._.findBlender();
  if (!exe) console.log("SKIP taste views (no Blender found)");
  else await test("taste views: an animated .blend becomes a spin and an animation video", async () => {
    const mod = mk({ tasteViews: true });
    const blend = path.join(TMP, "anim_r98.blend");
    require("child_process").execFileSync(exe, ["-b", "--factory-startup", "--python", path.join(APP, "test", "taste-view-blend.py"), "--", blend], { windowsHide: true, stdio: "ignore", timeout: 120e3 });
    const id = mod._.createItem({ kind: "other", title: "Turning cube", files: [{ name: "anim_r98.blend", src: blend }], source: { type: "training", round: 98 } });
    const t0 = Date.now();
    await new Promise((r) => setTimeout(r, 50));
    while (mod._.views.busy() && Date.now() - t0 < 300e3) await new Promise((r) => setTimeout(r, 250));
    const it = (await call(mod, "GET", `/api/taste/item/${id}`)).body.item;
    const dir = path.join(ITEMS, id), view = JSON.parse(fs.readFileSync(path.join(dir, "view.json"), "utf8"));
    assert.strictEqual(it.kind, "model", JSON.stringify(view));
    assert.ok(it.stills.length >= 4 && it.frames === 24, `stills ${it.stills.length}, frames ${it.frames}`);
    assert.ok(it.fileList.some((f) => f.file === "animation.mp4" && /^Animation/.test(f.label)), JSON.stringify(it.fileList));
    assert.ok(fs.statSync(path.join(dir, "animation.mp4")).size > 1000);
    assert.ok(!fs.existsSync(path.join(dir, "_view")), "the temp folder is gone");
    assert.strictEqual(mod._.views._.todo(id).length, 0, "nothing left to do: not rendered again");
    assert.deepStrictEqual(view.files["anim_r98.blend"].made, ["spin", "animation.mp4"]);
  });

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`${failed ? "FAILED" : "PASSED"}: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
