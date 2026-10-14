// Tests for chat media (media.js, public/media-core.js): path finding, safe paths, the Open allowlist, image sizes,
// the stream tap (shown / made / looked at), the per-chat index and snapshots, tokens, page-side dedupe and placement,
// and the real server's /media/ and /api/media/* routes (a scratch brain on a spare port). Free; all names are made up.
//   node test/media-test.js           offline + server checks (about 5 s)
//   node test/media-test.js --live    also two tiny Haiku chats that prove the hint and Made for real (about $0.003)
// Prints PASS/FAIL lines; exit 1 on any FAIL. Verified 2026-10-12.
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const net = require("net");
const { spawn } = require("child_process");
const { EventEmitter } = require("events");

const APP = path.resolve(__dirname, "..");
const media = require(path.join(APP, "media.js"));
const core = require(path.join(APP, "public", "media-core.js"));
const { findPaths, normalize, dims, openable, slug } = media;
const LIVE = process.argv.includes("--live");

let failed = 0, passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("PASS " + name); }
  catch (e) { failed++; console.log("FAIL " + name + ": " + (e && e.message || e)); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "hm-media-"));
const BRAIN = path.join(TMP, "brain"), PROJ = path.join(TMP, "BananaQuest");
for (const d of [BRAIN, PROJ, path.join(PROJ, "renders"), path.join(BRAIN, "app-settings")]) fs.mkdirSync(d, { recursive: true });
// A valid 1x1 PNG; extra bytes after IEND make other versions with different content and size.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const png = (extra) => Buffer.concat([PNG, Buffer.alloc(extra || 0, 7)]);
const first = (text, cwd) => findPaths(text, cwd).map((x) => x.ps[0]);

function makeCtx(o = {}) {
  const hub = new EventEmitter(), events = [];
  const ctx = { BRAIN, HOME: os.homedir(), PORT: 4799, LITE: !!o.lite, hub, chatHints: [], configuredFolders: () => [],
    emit: (run, obj) => events.push({ run, ...obj }), json: () => {}, body: async () => ({}) };
  const m = media(ctx);
  return { ctx, m, hub, events };
}

async function offline() {
  /* ---------- paths ---------- */
  await test("T1 a backticked image path", () => assert.deepStrictEqual(first("`D:\\Brain\\blender\\practice\\_review\\r2\\v0_icon.png`"), ["D:\\Brain\\blender\\practice\\_review\\r2\\v0_icon.png"]));
  await test("T2 two paths, spaces kept, trailing period dropped", () => assert.deepStrictEqual(first("Saved to D:/Games/x y/render 1.png and D:\\a\\b.jpg."), ["D:\\Games\\x y\\render 1.png", "D:\\a\\b.jpg"]));
  await test("T3 the probe's sentence shape", () => assert.deepStrictEqual(first("The image is a line drawing, saved at D:\\Brain\\sketches\\2026-10-12-21-41-42_2ff6ba.png."), ["D:\\Brain\\sketches\\2026-10-12-21-41-42_2ff6ba.png"]));
  await test("T4 file:/// URL in markdown, %20 decoded", () => assert.deepStrictEqual(first("![shot](file:///C:/Users/me/Pictures/a%20b.png)"), ["C:\\Users\\me\\Pictures\\a b.png"]));
  await test("T5 Git Bash /d/ path", () => assert.deepStrictEqual(first("/d/Brain/x.png"), ["d:\\Brain\\x.png"]));
  await test("T6 UNC, //x, \\\\?\\ are refused with zero filesystem calls", async () => {
    for (const s of ["\\\\evil.example\\share\\x.png", "//evil/x.png", "\\\\?\\C:\\x.png", "//render.png", "file:////evil/x.png"]) assert.deepStrictEqual(normalize(s), [], s);
    assert.deepStrictEqual(first("see \\\\evil.example\\share\\x.png and //evil/x.png and //render.png"), []);
    const { m, hub, events } = makeCtx(), P = fs.promises, orig = { realpath: P.realpath, stat: P.stat };
    let calls = 0;
    P.realpath = (...a) => { calls++; return orig.realpath(...a); }; P.stat = (...a) => { calls++; return orig.stat(...a); };
    try {
      const run = { id: "r", kind: "chat", cwd: PROJ, chatId: null };
      hub.emit("chat-line", run, { type: "assistant", message: { content: [{ type: "text", text: "Look: \\\\evil.example\\share\\x.png\n//evil/x.png\n\\\\?\\C:\\x.png" }] } });
      await m._test.stateOf(run).chain;
    } finally { P.realpath = orig.realpath; P.stat = orig.stat; }
    assert.strictEqual(calls, 0); assert.strictEqual(events.length, 0);
  });
  await test("T7 device names and alternate data streams are refused", () => {
    assert.deepStrictEqual(normalize("C:\\x\\con.png"), []);
    assert.deepStrictEqual(normalize("C:\\x\\a.png:secret"), []);
    assert.deepStrictEqual(first("C:\\x\\con.png and C:\\x\\a.png:secret"), []);
  });
  await test("T8 a relative image path resolves in the chat folder", () => assert.deepStrictEqual(first("see renders/out.png", "D:\\G"), ["D:\\G\\renders\\out.png"]));
  await test("T9 a folder or file alone on its line is own-line", () => {
    const r = findPaths("Here:\n`D:\\Exports\\`\nD:\\notes\\todo.md\n");
    assert.deepStrictEqual(r.map((x) => [x.ps[0], x.own]), [["D:\\Exports\\", true], ["D:\\notes\\todo.md", true]]);
  });
  await test("paths come back in the order they appear in the text", () => {
    assert.deepStrictEqual(first("Made D:\\G\\a.glb\n\nD:\\G\\notes.md\nthen see b.png and D:\\G\\c.png", "D:\\G"), ["D:\\G\\a.glb", "D:\\G\\notes.md", "D:\\G\\b.png", "D:\\G\\c.png"]);
  });
  await test("T10 a code path inside a sentence makes no chip", () => assert.deepStrictEqual(first("see D:\\app\\server.js for details"), []));
  await test("T11 .png.bak is not an image", () => {
    assert.deepStrictEqual(first("got D:\\a\\b.png.bak here"), []);
    assert.deepStrictEqual(findPaths("D:\\a\\b.png.bak").map((x) => [x.ps[0], x.own]), [["D:\\a\\b.png.bak", true]]);
  });
  await test("T12 adversarial text stays fast and bounded", () => {
    const cases = ["C:".repeat(500000), "C:\\" + "a ".repeat(30000), "C:\\a".repeat(20000), "/a".repeat(40000), " x" + "a/".repeat(30000) + ".png", Array.from({ length: 100 }, (_, i) => `D:\\p\\f${i}.png`).join(" ")];
    for (const c of cases) { const t0 = Date.now(), r = findPaths(c, "D:\\G"); assert.ok(Date.now() - t0 < 200, `took ${Date.now() - t0} ms`); assert.ok(r.length <= 40, `${r.length} candidates`); }
  });
  await test("T13 bullets, numbered items and fenced lines are not own-line", () => assert.deepStrictEqual(findPaths("- `D:\\Brain\\app\\server.js`\n1. D:\\Brain\\app\\media.js\n```\nD:\\Brain\\app\\x.js\n```"), []));
  await test("T14 URLs yield no candidates", () => assert.deepStrictEqual(findPaths("https://cdn.example.com/a/b/c.png, see https://host/d/foo.png ok", "D:\\G"), []));
  await test("T15 /tmp/ tries C:\\tmp then the temp folder; inspect picks the one that exists", async () => {
    const r = findPaths("/tmp/render.png");
    assert.deepStrictEqual(r[0].ps, ["C:\\tmp\\render.png", path.win32.join(os.tmpdir(), "render.png")]);
    const name = `hm-media-${process.pid}.png`, f = path.join(os.tmpdir(), name);
    fs.writeFileSync(f, png());
    try { const { m } = makeCtx(); const got = await m._test.inspect(normalize("/tmp/" + name), m._test.rootsFor(null)); assert.ok(got && got.real.toLowerCase() === fs.realpathSync.native(f).toLowerCase() && got.image && got.inRoots); }
    finally { fs.rmSync(f, { force: true }); }
  });

  /* ---------- roots ---------- */
  await test("roots: the brain is allowed; .ssh, app-settings and .claude are refused", async () => {
    const { m } = makeCtx(), roots = m._test.rootsFor(PROJ);
    fs.writeFileSync(path.join(BRAIN, "ok.png"), png());
    fs.writeFileSync(path.join(BRAIN, "app-settings", "x.png"), png());
    const ok = await m._test.inspect([path.join(BRAIN, "ok.png")], roots);
    assert.ok(ok && ok.inRoots && ok.image);
    assert.strictEqual(await m._test.inspect([path.join(BRAIN, "app-settings", "x.png")], roots), null);
    const ssh = path.join(os.homedir(), ".ssh");
    if (fs.existsSync(ssh)) { const any = fs.readdirSync(ssh)[0]; if (any) assert.strictEqual(await m._test.inspect([path.join(ssh, any)], roots), null); }
    const cl = path.join(os.homedir(), ".claude");
    if (fs.existsSync(cl)) assert.strictEqual(await m._test.inspect([cl], roots), null);
  });
  await test("goodCwd refuses drive roots, the profile and its parents, AppData, Windows and Program Files", () => {
    const { m } = makeCtx(), g = m._test.goodCwd, H = os.homedir();
    for (const c of ["C:\\", H, path.dirname(H), path.join(H, "AppData"), process.env.APPDATA, process.env.WINDIR, process.env.ProgramFiles, "\\\\host\\share", "relative\\dir", ""])
      if (c === undefined) continue; else assert.strictEqual(g(c), null, String(c));
    const pf = fs.readdirSync(process.env.ProgramFiles).map((d) => path.join(process.env.ProgramFiles, d)).find((d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
    if (pf) assert.strictEqual(g(pf), null, pf);
    assert.ok(g(PROJ), "a project folder is fine");
    const deep = path.join(process.env.APPDATA, "Claude");
    if (fs.existsSync(deep)) assert.ok(g(deep), "a folder deep under AppData is fine");
  });

  /* ---------- open allowlist ---------- */
  await test("openable: only safe types, binary ones only with the right first bytes", async () => {
    const d = path.join(TMP, "open"); fs.mkdirSync(d, { recursive: true });
    const w = (n, data) => { const f = path.join(d, n); fs.writeFileSync(f, data); return f; };
    for (const n of ["a.rdp", "a.library-ms", "a.theme", "a.chm", "a.svg", "a.csv", "a.html", "a.ps1", "a.exe", "a.lnk", "a.url", "a.gltf"]) assert.strictEqual(await openable(w(n, "full address:s:example.invalid")), false, n);
    assert.strictEqual(await openable(w("a.png", png())), true);
    assert.strictEqual(await openable(w("a.txt", "hi")), true);
    assert.strictEqual(await openable(w("a.mp4", Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom")]))), true);
    assert.strictEqual(await openable(w("a.docx", Buffer.from("504b030414000600", "hex"))), true);
    assert.strictEqual(await openable(w("b.docx", "<html><body>hi</body></html>")), false);
    assert.strictEqual(await openable(w("a.pdf", "hello")), false);
    assert.strictEqual(await openable(w("b.pdf", "%PDF-1.7\n")), true);
    const clsid = path.join(d, "x.{645FF040-5081-101B-9F08-00AA002F954E}"); fs.mkdirSync(clsid, { recursive: true });
    assert.strictEqual(await openable(clsid), false);
    assert.strictEqual(await openable(d), true);
    assert.strictEqual(await openable(path.join(d, "missing.png")), false);
  });

  /* ---------- image sizes ---------- */
  await test("dims: PNG, GIF, BMP, WebP (VP8, VP8L, VP8X), JPEG with APP1, SVG", () => {
    assert.deepStrictEqual(dims(PNG, "png"), { w: 1, h: 1 });
    const gif = Buffer.alloc(32); gif.write("GIF89a"); gif.writeUInt16LE(320, 6); gif.writeUInt16LE(200, 8);
    assert.deepStrictEqual(dims(gif, "gif"), { w: 320, h: 200 });
    const bmp = Buffer.alloc(32); bmp.write("BM"); bmp.writeInt32LE(64, 18); bmp.writeInt32LE(-48, 22);
    assert.deepStrictEqual(dims(bmp, "bmp"), { w: 64, h: 48 });
    const riff = (kind) => { const b = Buffer.alloc(40); b.write("RIFF"); b.write("WEBP", 8); b.write(kind, 12); return b; };
    const v8 = riff("VP8 "); v8.writeUInt16LE(640, 26); v8.writeUInt16LE(480, 28);
    assert.deepStrictEqual(dims(v8, "webp"), { w: 640, h: 480 });
    const vl = riff("VP8L"); vl.writeUInt32LE((99) | (49 << 14), 21);
    assert.deepStrictEqual(dims(vl, "webp"), { w: 100, h: 50 });
    const vx = riff("VP8X"); vx.writeUIntLE(1919, 24, 3); vx.writeUIntLE(1079, 27, 3);
    assert.deepStrictEqual(dims(vx, "webp"), { w: 1920, h: 1080 });
    const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, 0, 8]), Buffer.from("Exif\0\0")]);
    const sof = Buffer.from([0xff, 0xc0, 0, 17, 8, 0x01, 0xe0, 0x02, 0x80, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
    const jpg = Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sof, Buffer.alloc(16)]);
    assert.deepStrictEqual(dims(jpg, "jpg"), { w: 640, h: 480 });
    assert.deepStrictEqual(dims(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 24"><rect/></svg>'), "svg"), { w: 16, h: 24 });
    assert.deepStrictEqual(dims(Buffer.from('<svg width="32px" height="32" xmlns="http://www.w3.org/2000/svg"></svg>'), "svg"), { w: 32, h: 32 });
    assert.strictEqual(dims(Buffer.from("not an image at all, nope"), "png"), null);
  });
  await test("slug: a long non-ASCII name becomes plain ASCII, at most 60 characters, keeping .png", () => {
    const s = slug("バナナのレンダリング画像".repeat(4) + ".png");
    assert.ok(/^[\w.-]{1,60}$/.test(s) && s.endsWith(".png"), s);
    const l = slug("a".repeat(100) + ".png"); assert.ok(l.length <= 60 && l.endsWith(".png"), l);
    assert.strictEqual(slug("render 1.png"), "render_1.png");
  });
  await test("hint: Lite gets the short one and the smaller budget", () => {
    const full = makeCtx(), lite = makeCtx({ lite: true });
    assert.deepStrictEqual(full.ctx.chatHints, [media.HINT]);
    assert.deepStrictEqual(lite.ctx.chatHints, [media.HINT_LITE]);
    assert.strictEqual(lite.m._test.BUDGET, 60 << 20); assert.strictEqual(full.m._test.BUDGET, 200 << 20);
    assert.strictEqual(lite.m._test.SEEN_MAX, 20); assert.strictEqual(full.m._test.SEEN_MAX, 40);
    assert.ok(media.HINT_LITE.length < 130 && media.HINT.length < 450);
  });

  /* ---------- media-core (page side) ---------- */
  await test("anchorOf strips the app's wrappers, short and long prompts alike", () => {
    for (const base of ["make it red", "Render the robot from the front and show me, then ".repeat(6)]) {
      const a = core.anchorOf(base);
      assert.strictEqual(core.anchorOf(base + "\n\n(Team mode: split this work across subagents with the Agent tool. Use one...)"), a);
      assert.strictEqual(core.anchorOf(base + "\n\nAttached files (saved on disk):\n- D:\\Brain\\uploads\\x.png"), a);
      assert.strictEqual(core.anchorOf("Continue our earlier conversation. Read its full record first: D:\\Brain\\transcripts\\readable\\ (the file ending in _1234abcd.md).\n\n" + base), a);
      assert.strictEqual(core.anchorOf("<system-reminder>be nice</system-reminder>" + base), a);
      assert.ok(a.length <= 100);
    }
  });
  await test("sameAnchor: equal, or a prefix of 12+ characters", () => {
    assert.ok(core.sameAnchor("make the sky red", "make the sky red please"));
    assert.ok(!core.sameAnchor("make it red", "make it red please"));
    assert.ok(!core.sameAnchor("yes", "yesterday's render"));
    assert.ok(core.sameAnchor("yes", "yes"));
  });
  const item = (o) => ({ id: "x", key: "d:\\g\\a.png", ver: "1:1", kind: "shown", type: "image", ...o });
  await test("add: a split turn keeps one item, moved to the segment that showed it; repeats and new versions don't duplicate", () => {
    const c = { messages: [{ role: "user", text: "go" }, { role: "assistant", text: "a" }, { role: "perm" }, { role: "assistant", text: "b" }] };
    const [, s1, , s2] = c.messages;
    core.add(c, s1, [item({ tid: "T", kind: "seen" })]);
    core.add(c, s2, [item({ tid: "T", kind: "shown" })]);
    assert.strictEqual((s1.media || []).length, 0); assert.strictEqual(s2.media.length, 1); assert.strictEqual(s2.media[0].kind, "shown");
    assert.strictEqual(core.add(c, s1, [item({ tid: "T", kind: "shown" }), item({ tid: "T", kind: "seen" })]), 0, "a sweep adds nothing");
    core.add(c, s1, [item({ tid: "T", kind: "made", ver: "2:2" })]);
    assert.strictEqual(s2.media.length, 1); assert.strictEqual(s2.media[0].ver, "2:2"); assert.strictEqual(s2.media[0].kind, "shown", "keeps the higher kind");
    assert.strictEqual(core.add(c, s1, [item({ tid: undefined })]), 0, "a scan skips a key already shown");
  });
  await test("place: restore drops unmatched groups, the forward cursor separates repeated prompts, exact beats prefix", () => {
    const mk = () => ({ messages: [{ role: "user", text: "yes" }, { role: "assistant", text: "1" }, { role: "user", text: "yes" }, { role: "assistant", text: "2" },
      { role: "user", text: "render the robot again" }, { role: "assistant", text: "3" }, { role: "user", text: "render the robot" }, { role: "assistant", text: "4" }] });
    let c = mk();
    core.place(c, [item({ tid: "A", anchor: "yes", key: "k1" }), item({ tid: "B", anchor: "yes", key: "k2" }), item({ tid: "Z", anchor: "never typed this", key: "k3" })], { fallback: false });
    assert.deepStrictEqual(c.messages.map((m) => (m.media || []).map((x) => x.key).join()), ["", "k1", "", "k2", "", "", "", ""]);
    c = mk();
    core.place(c, [item({ tid: "C", anchor: "render the robot", key: "k4" })], { fallback: false });
    assert.ok(c.messages[7].media && !c.messages[5].media, "exact match wins over a prefix");
    c = mk();
    core.place(c, [item({ tid: "D", anchor: "yes", key: "k5" })], { fallback: true });
    assert.ok(c.messages[3].media && !c.messages[1].media, "a sweep matches the newest yes");
    c = mk();
    core.place(c, [item({ tid: "E", anchor: "nothing like it", key: "k6" })], { fallback: true });
    assert.ok(c.messages[7].media, "a sweep's unmatched group goes on the last reply");
  });

  /* ---------- the tap ---------- */
  const R = (o) => ({ id: "run-" + Math.random().toString(36).slice(2), kind: "chat", cwd: PROJ, chatId: null, ...o });
  const feed = async (m, hub, run, evs) => { for (const ev of evs) hub.emit("chat-line", run, ev); await m._test.stateOf(run).chain; await m._test.stateOf(run).chain; };
  const replay = (uuid, text) => ({ type: "user", isReplay: true, uuid, message: { role: "user", content: [{ type: "text", text }] }, parent_tool_use_id: null });
  const say = (text) => ({ type: "assistant", message: { content: [{ type: "text", text }] }, parent_tool_use_id: null });
  const use = (id, name, input) => ({ type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] }, parent_tool_use_id: null });
  const result = (id, content) => ({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content }] }, parent_tool_use_id: null });
  const all = (events) => events.flatMap((e) => e.items || []);

  await test("tap: a shown image gets a tid, anchor and served url; meta or non-replay user events don't move the anchor", async () => {
    const { m, hub, events } = makeCtx(), run = R(), f = path.join(PROJ, "renders", "robot.png");
    fs.writeFileSync(f, png(3));
    await feed(m, hub, run, [replay("u-1", "Render the robot and show me"), { type: "user", isMeta: true, isReplay: true, uuid: "u-meta", message: { content: [{ type: "text", text: "skill body" }] } },
      { type: "user", uuid: "u-x", message: { content: [{ type: "text", text: "not a replay" }] } }, say(`Here it is: ${f}`)]);
    const it = all(events);
    assert.strictEqual(it.length, 1); assert.strictEqual(it[0].tid, "u-1"); assert.strictEqual(it[0].kind, "shown"); assert.ok(/^\/media\/[\w-]{22}\/robot\.png$/.test(it[0].url), it[0].url);
    assert.strictEqual(it[0].w, 1);
  });
  await test("tap: Glob listing a fresh PNG gives no Made item; Bash naming it does", async () => {
    const { m, hub, events } = makeCtx(), run = R(), f = path.join(PROJ, "renders", "glob.png");
    await feed(m, hub, run, [replay("u-2", "x"), use("g1", "Glob", { pattern: "**/*.png" })]);
    fs.writeFileSync(f, png(5));
    await feed(m, hub, run, [result("g1", f), use("b1", "Bash", { command: `python make.py --out "${f}"` }), result("b1", [{ type: "text", text: "ok" }])]);
    const it = all(events);
    assert.strictEqual(it.length, 1); assert.strictEqual(it[0].kind, "made"); assert.strictEqual(it[0].tool, "Bash");
  });
  await test("tap: search_assets images are ignored, Blender look images are kept as Looked at", async () => {
    const { m, hub, events } = makeCtx(), run = R();
    const img = { type: "image", source: { type: "base64", media_type: "image/png", data: png(11).toString("base64") } };
    await feed(m, hub, run, [replay("u-3", "look"), use("s1", "mcp__blender__search_assets", {}), result("s1", [img]), use("l1", "mcp__blender__look", {}), result("l1", [img])]);
    const it = all(events);
    assert.strictEqual(it.length, 1); assert.strictEqual(it[0].kind, "seen"); assert.ok(it[0].key.startsWith("sha:")); assert.strictEqual(it[0].tool, "blender: look");
    assert.ok(fs.existsSync(path.join(BRAIN, "uploads", new Date().toISOString().slice(0, 10), "from-claude", it[0].key.slice(4) + ".png")));
  });
  await test("tap: the sketch reader and unattended runs produce nothing", async () => {
    const { m, hub, events } = makeCtx(), f = path.join(PROJ, "renders", "robot.png");
    for (const run of [R({ kind: "sketch" }), R({ kind: "training" }), R({ autoDeny: true })]) await feed(m, hub, run, [replay("u-4", "x"), say(f)]);
    assert.strictEqual(events.length, 0);
  });
  await test("tap: re-rendering one file in a turn sends the newer version; the index keeps one entry with the second snapshot", async () => {
    const { m, hub, events } = makeCtx(), run = R({ chatId: "test-chat-rerender" }), f = path.join(PROJ, "renders", "render.png");
    await feed(m, hub, run, [replay("u-5", "render it twice")]);
    fs.writeFileSync(f, png(20));
    await feed(m, hub, run, [use("b1", "Bash", { command: `blender -b scene.blend -o ${f}` }), result("b1", "Saved " + f)]);
    await sleep(30);
    fs.writeFileSync(f, png(40));
    await feed(m, hub, run, [use("b2", "Bash", { command: `blender -b scene.blend -o ${f}` }), result("b2", "Saved " + f), { type: "result", session_id: "test-chat-rerender" }]);
    const it = all(events);
    assert.strictEqual(it.length, 2); assert.strictEqual(it[0].tid + it[0].key, it[1].tid + it[1].key); assert.notStrictEqual(it[0].ver, it[1].ver);
    const idx = JSON.parse(fs.readFileSync(path.join(BRAIN, "chat-media", "test-chat-rerender.json"), "utf8"));
    assert.strictEqual(idx.items.length, 1, "one entry");
    assert.strictEqual(idx.items[0].ver, it[1].ver);
    assert.ok(idx.items[0].sha && fs.existsSync(idx.items[0].file), "snapshot written");
    assert.strictEqual(fs.statSync(idx.items[0].file).size, png(40).length, "the second version");
    assert.strictEqual(idx.items[0].anchor, "render it twice"); assert.strictEqual(idx.items[0].tid, "u-5");
  });
  await test("tap: an old snapshot keeps the old picture after the file is overwritten in a later turn", async () => {
    const { m, hub } = makeCtx(), run = R({ chatId: "test-chat-history" }), f = path.join(PROJ, "renders", "hist.png");
    fs.writeFileSync(f, png(60));
    await feed(m, hub, run, [replay("u-6", "first"), say("Done: " + f), { type: "result" }]);
    fs.writeFileSync(f, png(70));
    await feed(m, hub, run, [replay("u-7", "second"), say("Again: " + f), { type: "result" }]);
    const items = await m._test.indexItems("test-chat-history");
    assert.strictEqual(items.length, 2);
    const one = items.find((x) => x.tid === "u-6"), two = items.find((x) => x.tid === "u-7");
    assert.ok(one && two && one.id !== two.id && !one.current && !two.current);
    const ent = (t) => m._test.tokens.get(t);
    assert.strictEqual(fs.statSync(ent(one.id).file).size, png(60).length);
    assert.strictEqual(fs.statSync(ent(two.id).file).size, png(70).length);
    const again = await m._test.indexItems("test-chat-history");
    assert.deepStrictEqual(again.map((x) => x.id).sort(), items.map((x) => x.id).sort(), "the same tokens on every call");
  });
  await test("index: a snapshot path that leaves uploads by .. or a junction is ignored, and the deny list holds", async () => {
    const { m } = makeCtx(), U = path.join(BRAIN, "uploads"), safe = path.join(U, "ok-snap.png");
    fs.mkdirSync(U, { recursive: true });
    fs.writeFileSync(safe, png(3)); fs.writeFileSync(path.join(BRAIN, "app-settings", "secret.png"), png(4)); fs.writeFileSync(path.join(PROJ, "renders", "out.png"), png(5));
    for (const [j, to] of [["jx", path.join(BRAIN, "app-settings")], ["jy", path.join(PROJ, "renders")]]) { try { fs.rmSync(path.join(U, j), { recursive: true, force: true }); } catch {} fs.symlinkSync(to, path.join(U, j), "junction"); }
    const bad = [path.join(U, "..", "app-settings", "secret.png"), U + "\\..\\..\\BananaQuest\\renders\\out.png", path.join(U, "jx", "secret.png"), path.join(U, "jy", "out.png")];
    const items = [safe, ...bad].map((file, i) => ({ key: "k" + i, tid: "u-" + i, at: new Date().toISOString(), kind: "made", type: "image", file, sha: "x", src: path.join(PROJ, "gone-" + i + ".png"), name: "a.png" }));
    fs.mkdirSync(path.join(BRAIN, "chat-media"), { recursive: true });
    fs.writeFileSync(path.join(BRAIN, "chat-media", "test-chat-escape.json"), JSON.stringify({ cwd: PROJ, items }));
    const got = await m._test.indexItems("test-chat-escape");
    assert.deepStrictEqual(got.map((x) => x.tid), ["u-0"], "only the real snapshot");
    assert.strictEqual(fs.realpathSync.native(m._test.tokens.get(got[0].id).file), fs.realpathSync.native(safe));
  });
  await test("tap: a file chip alone on its line, a deliverable anywhere, a code path nowhere", async () => {
    const { m, hub, events } = makeCtx(), run = R();
    const notes = path.join(PROJ, "notes.md"), glb = path.join(PROJ, "banana.glb"), code = path.join(PROJ, "game.js");
    fs.writeFileSync(notes, "# hi"); fs.writeFileSync(glb, "glTF...."); fs.writeFileSync(code, "x");
    await feed(m, hub, run, [replay("u-8", "x"), say(`Exported ${glb} and changed ${code}.\n\n${notes}\n- ${code}\n${PROJ}`)]);
    const it = all(events).map((x) => [x.name, x.type, x.open]);
    assert.deepStrictEqual(it.sort(), [["BananaQuest", "folder", true], ["banana.glb", "file", true], ["notes.md", "file", true]].sort());
  });

  /* ---------- tokens ---------- */
  await test("tokens: least recently used dropped after 5,000, with its byFile entry", () => {
    const { m } = makeCtx(), t = m._test;
    const a = t.mint({ file: "a" }, "fk-a");
    assert.strictEqual(t.mint({ file: "a" }, "fk-a"), a, "the same file gets the same token");
    for (let i = 0; i < 5000; i++) t.mint({ file: "f" + i }, "fk-" + i);
    assert.ok(!t.tokens.has(a)); assert.ok(!t.byFile.has("fk-a")); assert.strictEqual(t.tokens.size, 5000);
  });
}

/* ---------- the real server ---------- */
function freePort() { return new Promise((ok) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => ok(p)); }); }); }
function req(port, p, { method = "GET", headers = {}, body } = {}) {
  return new Promise((ok) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const r = http.request({ host: "127.0.0.1", port, path: p, method, timeout: 15000, headers: { "x-hive": "1", ...(data ? { "Content-Type": "application/json" } : {}), ...headers } }, (res) => {
      const bufs = []; res.on("data", (c) => bufs.push(c));
      res.on("end", () => { const text = Buffer.concat(bufs).toString("utf8"); let j; try { j = JSON.parse(text); } catch {} ok({ status: res.statusCode, headers: res.headers, json: j, text }); });
    });
    r.on("timeout", () => r.destroy(new Error("timeout")));
    r.on("error", (e) => ok({ status: 0, error: e.message, headers: {} }));
    if (data) r.write(data);
    r.end();
  });
}
async function startServer() {
  const port = await freePort();
  const env = { ...process.env, HIVE_PORT: String(port), TEAMWRIGHT_BRAIN: BRAIN, HIVE_MEDIA_DRYRUN: "1" };
  const child = spawn(process.execPath, [path.join(APP, "server.js")], { cwd: APP, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let out = "", exited = false;
  child.stdout.on("data", (d) => (out += d)); child.stderr.on("data", (d) => (out += d));
  child.on("exit", () => (exited = true));
  for (const end = Date.now() + 20000; Date.now() < end && !exited; await sleep(200)) {
    if (out.includes(`127.0.0.1:${port}`) && (await req(port, "/api/media/roots")).status === 200) return { port, child, log: () => out, stop: () => new Promise((r) => { if (exited) return r(); child.once("exit", r); child.kill(); }) };
  }
  child.kill();
  throw new Error("server didn't start: " + out.trim().split(/\r?\n/).slice(-5).join(" | "));
}
async function serverTests() {
  const pic = path.join(BRAIN, "pic.png"), svg = path.join(BRAIN, "icon.svg"), rdp = path.join(BRAIN, "test.rdp");
  fs.writeFileSync(pic, png()); fs.writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><script>alert(1)</script></svg>'); fs.writeFileSync(rdp, "full address:s:example.invalid");
  let S;
  try { S = await startServer(); } catch (e) { failed++; console.log("FAIL server starts: " + e.message); return; }
  const P = S.port, H = { host: `127.0.0.1:${P}` };
  try {
    await test("server: loads media.js", () => assert.ok(/loaded media\.js/.test(S.log()) && !/module failed to load: media/.test(S.log())));
    const scan = await req(P, "/api/media/scan", { method: "POST", body: { cwd: BRAIN, texts: [{ i: 0, text: `See ${pic} and ${svg}\n\n${rdp}` }, { i: 1, text: "nothing" }, { i: "x", text: pic }] } });
    const items = (scan.json && scan.json.items && scan.json.items[0]) || [];
    const P1 = items.find((x) => x.name === "pic.png"), S1 = items.find((x) => x.name === "icon.svg"), D1 = items.find((x) => x.name === "test.rdp");
    await test("server: scan finds the PNG, the SVG and the .rdp chip", () => {
      assert.strictEqual(scan.status, 200); assert.ok(P1 && P1.url && P1.current && S1 && S1.url && D1 && D1.type === "file" && !D1.url, JSON.stringify(scan.json));
      assert.deepStrictEqual(Object.keys(scan.json.items), ["0"]);
    });
    if (!P1 || !S1 || !D1) return;
    await test("server: the image is served with nosniff, CORP and a CSP sandbox", async () => {
      const r = await req(P, P1.url, { headers: {} });
      assert.strictEqual(r.status, 200); assert.strictEqual(r.headers["content-type"], "image/png");
      assert.strictEqual(r.headers["x-content-type-options"], "nosniff"); assert.strictEqual(r.headers["cross-origin-resource-policy"], "same-origin");
      assert.ok(/sandbox/.test(r.headers["content-security-policy"])); assert.ok(/filename="pic.png"/.test(r.headers["content-disposition"]));
    });
    await test("server: cross-site, a foreign Host and POST are refused; unknown tokens and traversal aren't served", async () => {
      assert.strictEqual((await req(P, P1.url, { headers: { "sec-fetch-site": "cross-site" } })).status, 403);
      assert.strictEqual((await req(P, P1.url, { headers: { "sec-fetch-site": "same-site" } })).status, 403);
      assert.strictEqual((await req(P, P1.url, { headers: { "sec-fetch-site": "same-origin" } })).status, 200);
      assert.strictEqual((await req(P, P1.url, { headers: { host: `evil.example:${P}` } })).status, 403);
      assert.strictEqual((await req(P, P1.url, { method: "POST", body: {} })).status, 405);
      assert.strictEqual((await req(P, "/media/AAAAAAAAAAAAAAAAAAAAAA/x.png")).status, 404);
      const t = await req(P, "/media/../server.js"); assert.ok(!/require\("http"\)/.test(t.text));
      const t2 = await req(P, "/media/%2e%2e/%2e%2e/server.js"); assert.ok(!/require\("http"\)/.test(t2.text));
    });
    await test("server: /api/media/* refuses a foreign Host and a missing X-Hive", async () => {
      assert.strictEqual((await req(P, "/api/media/roots", { headers: { host: `evil.example:${P}` } })).status, 403);
      assert.strictEqual((await req(P, "/api/media/scan", { method: "POST", body: { texts: [] }, headers: { "x-hive": "" } })).status, 403);
    });
    await test("server: the SVG is served as image/svg+xml with the CSP sandbox", async () => {
      const r = await req(P, S1.url);
      assert.strictEqual(r.status, 200); assert.strictEqual(r.headers["content-type"], "image/svg+xml"); assert.ok(/default-src 'none'.*sandbox/.test(r.headers["content-security-policy"]));
    });
    await test("server: Open refuses .rdp and SVG, opens a PNG (dry run), reveals anything; unknown id 404", async () => {
      const o = (id, action) => req(P, "/api/media/open", { method: "POST", body: { id, action } });
      const a = await o(D1.id, "open"); assert.strictEqual(a.status, 400); assert.ok(/only be shown in its folder/.test(a.json.error));
      assert.strictEqual((await o(S1.id, "open")).status, 400);
      assert.deepStrictEqual((await o(P1.id, "open")).json, { ok: true, dry: true });
      assert.deepStrictEqual((await o(D1.id, "reveal")).json, { ok: true, dry: true });
      assert.strictEqual((await o("AAAAAAAAAAAAAAAAAAAAAA", "open")).status, 404);
    });
    await test("server: chat index routes", async () => {
      assert.strictEqual((await req(P, "/api/media/chat/x")).status, 400);
      assert.deepStrictEqual((await req(P, "/api/media/chat/apitest-probe-key")).json, { items: [] });
      const r = await req(P, "/api/media/roots");
      assert.ok(Array.isArray(r.json.roots) && r.json.hint === "full" && r.json.limits.perRun === 80);
    });
    await test("server: a scan with a bad cwd ignores relative paths", async () => {
      const r = await req(P, "/api/media/scan", { method: "POST", body: { cwd: "C:\\", texts: [{ i: 3, text: "pic.png" }] } });
      assert.deepStrictEqual(r.json.items, {});
      const g = await req(P, "/api/media/scan", { method: "POST", body: { cwd: BRAIN, texts: [{ i: 3, text: "see pic.png" }] } });
      assert.ok(g.json.items["3"] && g.json.items["3"][0].name === "pic.png");
    });
    if (LIVE) await liveTests(P);
  } finally { await S.stop(); }
}

/* ---------- live (Haiku) ---------- */
function chat(port, body) {
  return new Promise((done) => {
    const evs = [], data = JSON.stringify(body);
    const r = http.request({ host: "127.0.0.1", port, path: "/api/chat", method: "POST", headers: { "x-hive": "1", "Content-Type": "application/json" } }, (res) => {
      let buf = ""; res.setEncoding("utf8");
      res.on("data", (c) => { buf += c; let i; while ((i = buf.indexOf("\n\n")) >= 0) { const ch = buf.slice(0, i); buf = buf.slice(i + 2); if (ch.startsWith("data: ")) { try { evs.push(JSON.parse(ch.slice(6))); } catch {} } } });
      res.on("end", () => done(evs));
    });
    r.on("error", () => done(evs));
    setTimeout(() => { try { r.destroy(); } catch {} done(evs); }, 150000).unref();
    r.end(data);
  });
}
async function liveTests(P) {
  const evs = await chat(P, { prompt: "[Wise Hive test] Use the Read tool on pic.png, then show it to me.", model: "claude-haiku-5-5", mode: "read", cwd: BRAIN, title: "[Wise Hive test] media check" });
  const its = evs.filter((e) => e.t === "media").flatMap((e) => e.items), res = evs.find((e) => e.t === "result"), sid = (evs.find((e) => e.t === "session") || {}).id;
  await test("live: the hint works (Looked at, then Shown, same turn and file)", async () => {
    const seen = its.find((x) => x.kind === "seen" && x.name === "pic.png"), shown = its.find((x) => x.kind === "shown" && x.name === "pic.png");
    assert.ok(shown, `hint not followed: no shown item; reply was ${res && String(res.text).slice(0, 200)}`);
    if (seen) assert.strictEqual(seen.tid + seen.key, shown.tid + shown.key);
    const r = await req(P, shown.url); assert.strictEqual(r.status, 200); assert.strictEqual(r.headers["content-type"], "image/png");
    await sleep(500);
    const idx = await req(P, "/api/media/chat/" + sid);
    const e = (idx.json.items || []).filter((x) => x.key === shown.key);
    assert.strictEqual(e.length, 1); assert.strictEqual(e[0].tid, shown.tid); assert.strictEqual(e[0].kind, "shown");
    assert.strictEqual(e[0].anchor, "[teamwright test] use the read tool on pic.png, then show it to me.");
    assert.ok(!e[0].current, "served from the snapshot");
  });
  const evs2 = await chat(P, { prompt: "[Wise Hive test] Using a shell command (not the Write tool), copy pic.png to made.png in the current folder. Then reply with only: done", model: "claude-haiku-5-5", mode: "full", cwd: BRAIN, title: "[Wise Hive test] media made" });
  const made = evs2.filter((e) => e.t === "media").flatMap((e) => e.items).find((x) => x.name === "made.png" && x.kind === "made");
  await test("live: Made comes from a shell copy (birth time, not mtime)", () => assert.ok(made, "no made item; events: " + JSON.stringify(evs2.filter((e) => e.t === "media" || e.t === "tools").slice(0, 6)).slice(0, 400)));
}

(async () => {
  try { await offline(); await serverTests(); }
  catch (e) { failed++; console.log("FAIL test script: " + (e && e.stack || e)); }
  finally { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} }
  console.log(failed ? `FAILED: ${passed} passed, ${failed} failed` : `PASSED: ${passed} passed`);
  process.exit(failed ? 1 : 0);
})();
