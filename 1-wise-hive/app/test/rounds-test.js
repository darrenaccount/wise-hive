// Tests for Working round cards (rounds.js): the report parser, the worker rules (Full and Lite), the log.md formats, the
// picture capture from the stream tap (allowlist, dedupe, ring, byte budget, Before/After), finish() (end-of-round race,
// restart path, commits from git), trimming, list() and the /round-img/ guards. Free: no Claude, a temp brain, made-up names.
//   node test/rounds-test.js
// Prints PASS/FAIL lines; exit 1 on any FAIL. Verified 2026-10-13.
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { Writable } = require("stream");
const { execFileSync } = require("child_process");
const { EventEmitter } = require("events");

const APP = path.resolve(__dirname, "..");
const makeRounds = require(path.join(APP, "rounds.js"));
const { parse, rulesText, logBlock, logLine } = makeRounds;

let failed = 0, passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("PASS " + name); }
  catch (e) { failed++; console.log("FAIL " + name + ": " + (e && e.stack || e)); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "hm-rounds-"));
const BRAIN = path.join(TMP, "brain"), PROJ = path.join(TMP, "SkyRace");
fs.mkdirSync(BRAIN, { recursive: true }); fs.mkdirSync(PROJ, { recursive: true });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const b64 = (extra, size) => Buffer.concat([PNG, Buffer.alloc(size || extra || 0, extra || 1)]).toString("base64");
const uuid = () => require("crypto").randomUUID();

function make(o = {}) {
  const hub = new EventEmitter(), pushes = [];
  const r = makeRounds({ BRAIN, PORT: 4799, read: (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } },
    json: (res, code, body) => { res.code = code; res.body = body; }, broadcast: (e) => pushes.push(e), hub, currentSlug: () => o.current || "demo-game", roundLimits: o.limits });
  return { r, hub, pushes };
}
const plan = { title: "Add a sprint stamina bar", focus: "feature", why: "players asked" };
const run = (id) => ({ id });
// Stream events as claude prints them.
const toolUse = (id, name, sub) => ({ type: "assistant", parent_tool_use_id: sub ? "toolu_parent" : null, message: { content: [{ type: "tool_use", id, name, input: {} }] } });
const toolImg = (id, data, sub) => ({ type: "user", parent_tool_use_id: sub ? "toolu_parent" : null, message: { content: [{ type: "tool_result", tool_use_id: id, content: [{ type: "image", source: { type: "base64", media_type: "image/png", data } }] }] } });
const files = (dir) => { try { return fs.readdirSync(dir).filter((f) => /^cap-/.test(f)).sort(); } catch { return []; } };

class Res extends Writable {
  constructor() { super(); this.code = 0; this.headers = {}; this.headersSent = false; this.bytes = 0; }
  writeHead(code, h) { this.code = code; this.headers = h || {}; this.headersSent = true; }
  _write(c, e, cb) { this.bytes += c.length; cb(); }
}
function get(r, p, { method = "GET", host = "127.0.0.1:4799", site } = {}) {
  return new Promise((ok) => {
    const res = new Res(), headers = {};
    if (host) headers.host = host;
    if (site) headers["sec-fetch-site"] = site;
    res.on("finish", () => ok(res));
    const handled = r.asset(p, { method, headers }, res);
    if (!handled) ok(null);
  });
}

async function main() {
  /* ---------- the report parser ---------- */
  await test("parse: ### headings, Next steps, captions, list continuation", () => {
    const rep = parse(["Done.", "### Summary", "Players now have a stamina bar.", "Next, I wired the bar to sprinting.", "Changes to the HUD were made.",
      "### Changed", "- StarterGui.HUD: new StaminaBar frame", "  continued line", "- src/client/Sprint.lua: drain and refill",
      "### Undo", "Revert a1b2c3d on teamwright/autowork.", "### Images", "- after.png: the bar from the player's view", "- `side.png`: from the side",
      "- **top.jpg** — from above", "- C:\\Games\\demo\\rounds\\3\\far.png: far away", "### Next steps", "1. Sound when stamina runs out", "2. Upgrade in the shop"].join("\n"));
    assert.strictEqual(rep.structured, true);
    assert.ok(/Next, I wired/.test(rep.summary) && /Changes to the HUD were made/.test(rep.summary), rep.summary);
    assert.deepStrictEqual(rep.changed, ["StarterGui.HUD: new StaminaBar frame continued line", "src/client/Sprint.lua: drain and refill"]);
    assert.strictEqual(rep.undo, "Revert a1b2c3d on teamwright/autowork.");
    assert.deepStrictEqual(Object.keys(rep.captions), ["after.png", "side.png", "top.jpg", "far.png"]);
    assert.strictEqual(rep.captions["after.png"], "the bar from the player's view");
    assert.deepStrictEqual(rep.next, ["Sound when stamina runs out", "Upgrade in the shop"]);
  });
  await test("parse: bold and plain labels; '- **Undo:** x' is not a header", () => {
    let rep = parse("**Summary:** Added a bar.\n**Changed**: \n- one\n- **Undo:** inside the list\nUndo: revert a1b2c3d");
    assert.strictEqual(rep.summary, "Added a bar.");
    assert.deepStrictEqual(rep.changed, ["one", "**Undo:** inside the list"]);
    assert.strictEqual(rep.undo, "revert a1b2c3d");
    rep = parse("### **Undo**\nDelete the frame.\n### Summary: Short text");
    assert.strictEqual(rep.undo, "Delete the frame."); assert.strictEqual(rep.summary, "Short text");
  });
  await test("parse: no headers falls back to the cleaned text", () => {
    const rep = parse("## \n- I added **a bar** and `code`.\nNext steps are unclear");
    assert.strictEqual(rep.structured, false);
    assert.ok(!/[*`]/.test(rep.summary) && /I added a bar and code\./.test(rep.summary), rep.summary);
    assert.strictEqual(parse("x".repeat(5000)).summary.length, 1200);
  });
  await test("parse: limits on lists and captions", () => {
    const rep = parse("### Changed\n" + Array.from({ length: 30 }, (_, i) => `- item ${i} ${"y".repeat(400)}`).join("\n") + "\n### Images\n" + Array.from({ length: 20 }, (_, i) => `- p${i}.png: c`).join("\n"));
    assert.strictEqual(rep.changed.length, 20); assert.ok(rep.changed.every((c) => c.length <= 300));
    assert.strictEqual(Object.keys(rep.captions).length, 12);
  });

  /* ---------- rules and log formats ---------- */
  await test("rulesText: Full has the picture rule, Lite none; both have the report and no Append", () => {
    const full = rulesText({ dir: "C:\\brain\\working\\demo-game\\rounds\\3", wlog: "C:\\brain\\working\\demo-game\\log.md", lite: false });
    const lite = rulesText({ dir: "C:\\brain\\working\\demo-game\\rounds\\3", wlog: "C:\\brain\\working\\demo-game\\log.md", lite: true });
    for (const s of ["no extra pictures are needed", "bpy.ops.render.opengl", "save_render", "render_slots.new(name=\"The Wise Hive\")", "set active_index back", "### Images", "at most 25 lines"]) assert.ok(full.includes(s), s);
    assert.ok(!full.includes("write_still"));
    assert.ok(!/Pictures/.test(lite) && !lite.includes("### Images") && lite.includes("at most 15 lines"));
    for (const t of [full, lite]) { assert.ok(t.includes("### Summary") && t.includes("### Undo")); assert.ok(!/Append/.test(t)); }
  });
  await test("logBlock/logLine: indented items stay in the block review.js splits; both match 'round N'", () => {
    const block = logBlock(14, plan, { summary: "Players now have a **stamina** bar.\nIt drains.", changed: ["HUD: new frame", "Sprint.lua: logic"], undo: "Revert a1b2c3d.", next: ["Sound", "Shop"] }, "2026-10-12 14:05");
    assert.ok(block.startsWith("## Round 14 · 2026-10-12 14:05 · feature · Add a sprint stamina bar\nSummary: Players now have a stamina bar. It drains.\nChanged:\n  - HUD: new frame"), block);
    const blocks = [];
    let cur = null;
    for (const line of ("# Working log: SkyRace\n\n" + block).split(/\r?\n/)) { if (/^(#{1,6} |- |\* )/.test(line)) { if (cur) blocks.push(cur); cur = [line]; } else if (cur) cur.push(line); }
    if (cur) blocks.push(cur);
    assert.strictEqual(blocks.length, 2);
    assert.ok(blocks[1].join("\n").includes("Sprint.lua") && blocks[1].join("\n").includes("Next: Sound; Shop"));
    assert.ok(/\bround\s*#?14\b/i.test(block));
    const line = logLine(14, plan, "interrupted by a restart", "2026-10-12 14:05");
    assert.ok(/\bround\s*#?14\b/i.test(line) && line.startsWith("- ") && line.includes("(interrupted by a restart)"), line);
  });

  /* ---------- capture ---------- */
  await test("capture: allowlist only, duplicates skipped, subagent edit flips the phase", async () => {
    const { r, hub } = make(), id = uuid();
    r.begin({ slug: "demo-game", project: { name: "SkyRace", dir: PROJ }, n: 1, plan, runId: id, startedAt: Date.now() });
    const R = run(id);
    for (const [tid, name] of [["a", "Read"], ["b", "mcp__blender__search_assets"], ["c", "mcp__Roblox_Studio__generate_texture"], ["d", "mcp__blender__look"], ["e", "mcp__Roblox_Studio__screen_capture"]]) {
      hub.emit("chat-line", R, toolUse(tid, name));
    }
    // generate_texture is a change tool: everything after it is no longer "before". Reset the flag for the check below.
    r._test.rlive.get("demo-game/1").changed = false;
    for (const tid of ["a", "b", "c"]) hub.emit("chat-line", R, toolImg(tid, b64(1)));
    hub.emit("chat-line", R, toolImg("d", b64(2)));
    hub.emit("chat-line", R, toolImg("d", b64(2))); // same picture again
    hub.emit("chat-line", R, toolUse("f", "mcp__Roblox_Studio__multi_edit", true));
    hub.emit("chat-line", R, toolImg("e", b64(3), true));
    const L = r._test.rlive.get("demo-game/1");
    assert.deepStrictEqual(L.card.images.map((i) => [i.tool, i.phase]), [["mcp__blender__look", "before"], ["mcp__Roblox_Studio__screen_capture", ""]]);
    await L.chain;
    assert.deepStrictEqual(files(r.dirFor("demo-game", 1)), ["cap-001.png", "cap-002.png"]);
    await r.finish("demo-game", 1, { outcome: "done" });
  });
  await test("capture: 12 pictures leave the first 2 'before' plus the newest 6", async () => {
    const { r, hub } = make(), id = uuid(), R = run(id);
    r.begin({ slug: "demo-game", project: { name: "SkyRace", dir: PROJ }, n: 2, plan, runId: id });
    hub.emit("chat-line", R, toolUse("l", "mcp__blender__look"));
    hub.emit("chat-line", R, toolImg("l", b64(1))); hub.emit("chat-line", R, toolImg("l", b64(2)));
    hub.emit("chat-line", R, toolUse("x", "Edit"));
    for (let i = 3; i <= 12; i++) hub.emit("chat-line", R, toolImg("l", b64(i)));
    const L = r._test.rlive.get("demo-game/2");
    await L.chain;
    const want = ["cap-001.png", "cap-002.png", "cap-007.png", "cap-008.png", "cap-009.png", "cap-010.png", "cap-011.png", "cap-012.png"];
    assert.deepStrictEqual(L.card.images.map((i) => i.file), want);
    assert.deepStrictEqual(files(r.dirFor("demo-game", 2)), want);
    await r.finish("demo-game", 2, { outcome: "done" });
  });
  await test("capture: over the byte budget drops the oldest non-'before' pictures", async () => {
    const { r, hub } = make({ limits: { capBytes: 3000 } }), id = uuid(), R = run(id);
    r.begin({ slug: "demo-game", project: { name: "SkyRace", dir: PROJ }, n: 3, plan, runId: id });
    hub.emit("chat-line", R, toolUse("l", "mcp__blender__look"));
    hub.emit("chat-line", R, toolImg("l", b64(1, 900)));
    hub.emit("chat-line", R, toolUse("x", "Write"));
    for (let i = 2; i <= 5; i++) hub.emit("chat-line", R, toolImg("l", b64(i, 900)));
    const L = r._test.rlive.get("demo-game/3");
    await L.chain;
    assert.ok(L.capBytes <= 3000, String(L.capBytes));
    assert.deepStrictEqual(L.card.images.map((i) => i.file), ["cap-001.png", "cap-004.png", "cap-005.png"]);
    await r.finish("demo-game", 3, { outcome: "done" });
  });

  /* ---------- list overlay and finish ---------- */
  await test("list: a written capture shows before the debounced card write; finish labels the last one 'after'", async () => {
    const { r, hub, pushes } = make(), id = uuid(), R = run(id);
    r.begin({ slug: "demo-game", project: { name: "SkyRace", dir: PROJ }, n: 4, plan, runId: id });
    hub.emit("chat-line", R, toolUse("x", "Edit"));
    hub.emit("chat-line", R, toolUse("l", "mcp__blender__look"));
    hub.emit("chat-line", R, toolImg("l", b64(4)));
    let one = r.list("demo-game", { limit: 1 }).rounds[0];
    assert.strictEqual(one.images.length, 0, "not written yet");
    await r._test.rlive.get("demo-game/4").chain;
    one = r.list("demo-game", { limit: 1 }).rounds[0];
    assert.strictEqual(one.running, true); assert.strictEqual(one.outcome, "running");
    assert.strictEqual(one.images.length, 1); assert.ok(/^\/round-img\/demo-game\/4\/cap-001\.png\?v=[0-9a-f]{8}$/.test(one.images[0].url), one.images[0].url);
    assert.ok(!("runId" in one));
    // A capture right before finish still makes it into the final card.
    hub.emit("chat-line", R, toolImg("l", b64(5)));
    hub.emit("chat-line", R, { type: "result", num_turns: 7 });
    const rep = parse("### Summary\nAdded a bar.\n### Changed\n- HUD");
    const card = await r.finish("demo-game", 4, { outcome: "done", outcomeText: "completed: Added a bar.", report: rep, cost: 0.5 });
    assert.deepStrictEqual(card.images.map((i) => [i.file, i.phase]), [["cap-001.png", ""], ["cap-002.png", "after"]]);
    assert.strictEqual(card.turns, 7); assert.strictEqual(card.summary, "Added a bar."); assert.strictEqual(card.outcome, "done");
    assert.ok(!r._test.rlive.has("demo-game/4"));
    assert.ok(pushes.some((p) => p.t === "rounds" && p.slug === "demo-game" && p.n === 4));
    const f = path.join(r.dirFor("demo-game", 4), "card.json"), m1 = fs.statSync(f).mtimeMs;
    hub.emit("chat-line", R, toolImg("l", b64(6))); // after the end: ignored
    await sleep(2300);
    assert.strictEqual(fs.statSync(f).mtimeMs, m1, "no card write after finish");
    assert.deepStrictEqual(files(r.dirFor("demo-game", 4)), ["cap-001.png", "cap-002.png"]);
    const pub = r.list("demo-game", { limit: 1 }).rounds[0];
    assert.strictEqual(pub.hero, 1); assert.strictEqual(pub.running, false);
  });
  await test("finish without a live round: a 'running' card on disk becomes interrupted; a saved after.png is the hero", async () => {
    const a = make(), id = uuid();
    a.r.begin({ slug: "demo-game", project: { name: "SkyRace", dir: PROJ }, n: 5, plan, runId: id });
    const dir = a.r.dirFor("demo-game", 5);
    fs.writeFileSync(path.join(dir, "after.png"), PNG);
    const b = make(); // a fresh instance: as after a restart
    assert.strictEqual(b.r.list("demo-game", { before: 6, limit: 1 }).rounds[0].outcome, "interrupted", "stale running shows as interrupted");
    const card = await b.r.finish("demo-game", 5, { outcome: "interrupted", outcomeText: "interrupted by a restart" });
    assert.strictEqual(card.outcome, "interrupted");
    const pub = b.r.list("demo-game", { before: 6, limit: 1 }).rounds[0];
    assert.strictEqual(pub.images[pub.hero].file, "after.png"); assert.strictEqual(pub.images[pub.hero].phase, "after");
    assert.strictEqual(await b.r.finish("demo-game", 999, {}), null, "no card: nothing");
    a.r._test.rlive.clear();
  });
  await test("finish: commits come from git, only this round's and not older than its start", async () => {
    let git = true; try { execFileSync("git", ["--version"], { windowsHide: true }); } catch { git = false; }
    if (!git) { console.log("SKIP git not found"); return; }
    const repo = path.join(TMP, "repo");
    fs.mkdirSync(repo);
    const g = (args, env) => execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-C", repo, ...args], { windowsHide: true, env: { ...process.env, ...env } }).toString();
    g(["init", "-q"]); fs.writeFileSync(path.join(repo, "a.txt"), "1"); g(["add", "."]); g(["commit", "-q", "-m", "base"]);
    g(["checkout", "-q", "-b", "teamwright/autowork"]);
    const old = "2020-01-01T00:00:00Z";
    fs.writeFileSync(path.join(repo, "a.txt"), "2"); g(["commit", "-q", "-am", "Old round\n\nTeamwright-Round: 6"], { GIT_COMMITTER_DATE: old, GIT_AUTHOR_DATE: old });
    fs.writeFileSync(path.join(repo, "a.txt"), "3"); g(["commit", "-q", "-am", "Other round\n\nTeamwright-Round: 61"]);
    const { r } = make(), id = uuid();
    r.begin({ slug: "demo-game", project: { name: "SkyRace", dir: repo }, n: 6, plan, runId: id, startedAt: Date.now() - 5000 });
    fs.writeFileSync(path.join(repo, "a.txt"), "4"); g(["commit", "-q", "-am", "Add stamina bar\n\nTeamwright-Round: 6"]);
    const card = await r.finish("demo-game", 6, { outcome: "done", projectDir: repo });
    assert.strictEqual(card.commits.length, 1, JSON.stringify(card.commits));
    assert.strictEqual(card.commits[0].subject, "Add stamina bar");
    assert.ok(card.undo.includes(card.commits[0].short) && card.undo.includes("round 6"), card.undo);
  });

  /* ---------- begin: collisions, trimming, bad slugs ---------- */
  await test("begin: a repeated number moves the old folder aside; a bad slug does nothing", async () => {
    const { r } = make();
    r.begin({ slug: "demo-game", project: { name: "SkyRace", dir: PROJ }, n: 4, plan, runId: uuid() });
    const moved = fs.readdirSync(path.join(BRAIN, "working", "demo-game", "rounds")).filter((d) => /^4~\d+$/.test(d));
    assert.strictEqual(moved.length, 1);
    assert.deepStrictEqual(files(path.join(BRAIN, "working", "demo-game", "rounds", moved[0])), ["cap-001.png", "cap-002.png"]);
    await r.finish("demo-game", 4, { outcome: "stopped" });
    r.begin({ slug: "x".repeat(90), project: { name: "SkyRace", dir: PROJ }, n: 1, plan, runId: uuid() });
    r.begin({ slug: "../evil", project: { name: "SkyRace", dir: PROJ }, n: 1, plan, runId: uuid() });
    assert.ok(!fs.existsSync(path.join(BRAIN, "working", "x".repeat(90))) && !fs.existsSync(path.join(BRAIN, "evil")));
  });
  await test("trim: past keepRounds and over the byte budget only cap- files go; cards and saved files stay", async () => {
    const slug = "trim-game", { r } = make({ limits: { keepRounds: 3, projBytes: 2500 } });
    for (let n = 1; n <= 5; n++) {
      const dir = r.dirFor(slug, n);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "card.json"), JSON.stringify({ outcome: "done", images: [{ file: "cap-001.png", tool: "mcp__blender__look", phase: "after" }] }));
      fs.writeFileSync(path.join(dir, "cap-001.png"), Buffer.alloc(1000));
      fs.writeFileSync(path.join(dir, "after.png"), PNG);
    }
    await r._test.trim(slug);
    const have = (n) => fs.existsSync(path.join(r.dirFor(slug, n), "cap-001.png"));
    assert.deepStrictEqual([1, 2, 3, 4, 5].map(have), [false, false, false, true, true]);
    for (let n = 1; n <= 5; n++) assert.ok(fs.existsSync(path.join(r.dirFor(slug, n), "after.png")) && fs.existsSync(path.join(r.dirFor(slug, n), "card.json")));
    const c3 = JSON.parse(fs.readFileSync(path.join(r.dirFor(slug, 3), "card.json"), "utf8"));
    assert.strictEqual(c3.imagesTrimmed, true); assert.strictEqual(c3.images.length, 0);
  });

  /* ---------- list and sanitizing ---------- */
  await test("list: newest first, before/limit/more, project names, current project first", () => {
    const { r } = make();
    let l = r.list(null, { limit: 2 });
    assert.strictEqual(l.slug, "demo-game");
    assert.deepStrictEqual(l.rounds.map((x) => x.n), [6, 5]); assert.strictEqual(l.more, true);
    l = r.list("demo-game", { before: 3, limit: 5 });
    assert.deepStrictEqual(l.rounds.map((x) => x.n), [2, 1]); assert.strictEqual(l.more, false);
    assert.strictEqual(l.project.name, "SkyRace");
    assert.deepStrictEqual(l.projects.map((p) => p.slug).sort(), ["demo-game", "trim-game"]);
    const none = r.list("no-such", {});
    assert.strictEqual(none.slug, null); assert.deepStrictEqual(none.rounds, []);
    assert.strictEqual(make({ current: "trim-game" }).r.list(null, {}).slug, "trim-game");
  });
  await test("sanitize: a junk card.json is cleaned up", () => {
    const { r } = make(), dir = r.dirFor("junk-game", 9);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "card.json"), JSON.stringify({ n: 77, chatId: "../../x", runId: 5, outcome: "pwned", focus: "<script>", title: "t".repeat(9000), summary: { a: 1 },
      images: [{ file: "../x.png", tool: "mcp__blender__look" }, { file: "cap-001.png", tool: "Read" }, { file: "cap-002.png", tool: "mcp__blender__look", phase: "evil", bytes: -5 }],
      commits: [{ short: "zzz" }, { short: "a1b2c3d4", subject: "ok" }], captions: { "../a.png": "x", "con.png": "y", "after.png": "fine" }, cost: "NaN", turns: Infinity }));
    fs.writeFileSync(path.join(dir, "cap-002.png"), PNG);
    const c = r.list("junk-game", {}).rounds[0];
    assert.strictEqual(c.n, 9); assert.strictEqual(c.chatId, null); assert.strictEqual(c.outcome, "interrupted"); assert.strictEqual(c.focus, "general");
    assert.strictEqual(c.title.length, 200); assert.strictEqual(c.summary, "");
    assert.deepStrictEqual(c.images.map((i) => [i.file, i.phase, i.bytes]), [["cap-002.png", "", 0]]);
    assert.deepStrictEqual(c.commits, [{ short: "a1b2c3d4", subject: "ok" }]);
    assert.deepStrictEqual(Object.keys(c.captions), ["after.png"]);
    assert.strictEqual(c.cost, null); assert.strictEqual(c.turns, null);
  });

  /* ---------- routes ---------- */
  await test("route: list, one round, bad slug 400, unknown 404, POST 405", () => {
    const { r } = make(), call = (p, method = "GET") => { const res = {}; const u = new URL(p, "http://127.0.0.1:4799"); const h = r.route(u.pathname, { method }, res, u); return h ? res : null; };
    let res = call("/api/autopilot/working/rounds?project=demo-game&limit=1");
    assert.strictEqual(res.code, 200); assert.deepStrictEqual(Object.keys(res.body).sort(), ["more", "project", "projects", "rounds", "slug"]);
    assert.strictEqual(call("/api/autopilot/working/rounds?project=Bad_Slug").code, 400);
    assert.strictEqual(call("/api/autopilot/working/rounds/demo-game/5").body.round.n, 5);
    assert.strictEqual(call("/api/autopilot/working/rounds/demo-game/555").code, 404);
    assert.strictEqual(call("/api/autopilot/working/rounds", "POST").code, 405);
    assert.strictEqual(call("/api/autopilot/working"), null, "other autopilot routes are left alone");
  });
  await test("asset: serves round pictures with safe headers and refuses everything else", async () => {
    const { r } = make();
    let res = await get(r, "/round-img/demo-game/5/after.png");
    assert.strictEqual(res.code, 200); assert.strictEqual(res.headers["Content-Type"], "image/png"); assert.strictEqual(res.headers["X-Content-Type-Options"], "nosniff");
    assert.strictEqual(res.headers["Cross-Origin-Resource-Policy"], "same-origin"); assert.strictEqual(res.bytes, PNG.length);
    res = await get(r, "/round-img/demo-game/5/after.png", { method: "HEAD" });
    assert.strictEqual(res.code, 200); assert.strictEqual(res.bytes, 0);
    res = await get(r, "/round-img/demo-game/5/after.png", { host: "localhost:4799", site: "same-origin" }); assert.strictEqual(res.code, 200);
    for (const o of [{ host: "evil.example:4799" }, { host: "" }, { site: "cross-site" }, { site: "same-site" }]) assert.strictEqual((await get(r, "/round-img/demo-game/5/after.png", o)).code, 403, JSON.stringify(o));
    assert.strictEqual((await get(r, "/round-img/demo-game/5/after.png", { method: "POST" })).code, 405);
    fs.writeFileSync(path.join(r.dirFor("demo-game", 5), "x.svg"), "<svg/>");
    for (const p of ["/round-img/demo-game/5/..%2fcard.json", "/round-img/demo-game/5/card.json", "/round-img/demo-game/5/x.svg", "/round-img/demo-game/5/con.png", "/round-img/demo-game/5/nope.png"]) {
      assert.strictEqual((await get(r, p)).code, 404, p);
    }
    assert.strictEqual(await get(r, "/round-img/Bad_Slug/5/after.png"), null, "a bad slug isn't this route");
    assert.strictEqual(await get(r, "/round-img/demo-game/5/a/b.png"), null);
    // A junction from a round folder to a folder outside working\ is refused.
    const outside = path.join(TMP, "outside");
    fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, "a.png"), PNG);
    fs.mkdirSync(path.join(BRAIN, "working", "demo-game", "rounds"), { recursive: true });
    fs.symlinkSync(outside, path.join(BRAIN, "working", "demo-game", "rounds", "70"), "junction");
    assert.strictEqual((await get(r, "/round-img/demo-game/70/a.png")).code, 404);
    // No working folder at all: 404, no throw.
    const empty = makeRounds({ BRAIN: path.join(TMP, "empty-brain"), PORT: 4799, read: () => null, json: () => {}, broadcast: () => {} });
    assert.strictEqual((await get(empty, "/round-img/demo-game/5/after.png")).code, 404);
  });

  /* ---------- hygiene ---------- */
  await test("slugOf is the same in autopilot.js and review.js, and long names fit SLUG", () => {
    const line = (f) => fs.readFileSync(path.join(APP, f), "utf8").split(/\r?\n/).find((l) => l.startsWith("const slugOf = "));
    const a = line("autopilot.js"), b = line("review.js");
    assert.ok(a && a === b, "the two definitions differ");
    const slugOf = new Function(a.replace(/^const slugOf = /, "return ").replace(/;$/, ""))();
    const s = slugOf("Sky Race ".repeat(15) + "!");
    assert.ok(s.length <= 80 && makeRounds.SLUG.test(s), s);
    assert.strictEqual(slugOf("--"), "project");
  });
  await test("rounds.js never touches the server's map of chat runs", () => {
    const src = fs.readFileSync(path.join(APP, "rounds.js"), "utf8");
    assert.ok(!/ctx\.live|\blive\./.test(src));
  });
}

main().catch((e) => { failed++; console.log("FAIL test script: " + (e && e.stack || e)); }).then(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  console.log(`${failed ? "FAILED" : "PASSED"}: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
});
