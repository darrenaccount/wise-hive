// Working round cards wired into the real autopilot.js loop, with a stand-in for Claude: startChat returns a fake run
// whose stream events this test feeds through the same "chat-line" tap server.js uses, and askClaude answers the planner
// with a fixed plan. Checks the worker prompt (Full), a finished round (card, pictures, log.md block, Log entry with its
// card slug, list route), and a failed round (card outcome, one-line log entry). Free: no Claude, temp folders, made-up names.
//   node test/rounds-loop-test.js
// Prints PASS/FAIL lines; exit 1 on any FAIL. Verified 2026-10-13.
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { EventEmitter } = require("events");

const APP = path.resolve(__dirname, "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "hm-rloop-"));
const BRAIN = path.join(TMP, "brain"), PROJ = path.join(TMP, "Sky Race");
fs.mkdirSync(BRAIN, { recursive: true }); fs.mkdirSync(PROJ, { recursive: true });
process.env.HIVE_AUTOPILOT_DIR = path.join(TMP, "autopilot");

let failed = 0, passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("PASS " + name); }
  catch (e) { failed++; console.log("FAIL " + name + ": " + (e && e.stack || e)); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000, what = "condition") { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await sleep(25); } throw new Error("timed out waiting for " + what); }
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const b64 = (k) => Buffer.concat([PNG, Buffer.alloc(k, k)]).toString("base64");

const hub = new EventEmitter(), runs = [], pushes = [];
const PLAN = JSON.stringify({ title: "Add a sprint stamina bar", focus: "feature", agents: ["builder"], why: "players asked", prompt: "Add the bar.", next: [] });
const ctx = {
  BRAIN, HOME: TMP, PORT: 4799, APP_DIR: APP, hub,
  read: (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } },
  json: (res, code, body) => { res.code = code; res.body = body; },
  body: async (req) => req.body || {},
  broadcast: (e) => pushes.push(e), notify: () => {},
  usage: { refresh: async () => null, brief: () => null, ensure: async () => {}, over: () => null, readAt: () => Date.now(), isGaming: async () => ({ gaming: false }), route: () => false },
  askClaude: async () => ({ text: PLAN }),
  startChat: (opts) => { const run = { id: crypto.randomUUID(), opts, events: [], chatId: null, done: false }; runs.push(run); return run; },
  stopChat: (run) => { run.stopped = true; },
  stopRun: () => true,
  autopilotTimings: { cooldown: 30, poll: 20, firstBeat: 1e9, beat: 1e9 },
};
const ap = require(path.join(APP, "autopilot.js"))(ctx);
const call = (p, method = "GET", body) => { const res = {}; const u = new URL(p, "http://127.0.0.1:4799"); const h = ap.route(u.pathname, { method, body }, res, u); return Promise.resolve(h).then(() => res); };
const line = (run, ev) => hub.emit("chat-line", run, ev);
function end(run, result) {
  run.events.push({ t: "result", ...result });
  run.done = true;
  run.onDone();
}
const slug = "sky-race", roundsDir = path.join(BRAIN, "working", slug, "rounds");
const card = (n) => { try { return JSON.parse(fs.readFileSync(path.join(roundsDir, String(n), "card.json"), "utf8")); } catch { return null; } };

async function main() {
  let r1;
  await test("a Working round starts with the report rules and a running card", async () => {
    const res = await call("/api/autopilot/working/start", "POST", { goal: "Make the race more fun", project: PROJ, permission: "safe" });
    assert.strictEqual(res.code, 200, JSON.stringify(res.body));
    r1 = await until(() => runs[0], 8000, "round 1");
    const p = r1.opts.prompt;
    assert.ok(p.includes("### Summary") && p.includes("The Wise Hive adds your report to the work log") && p.includes("no extra pictures are needed"));
    assert.ok(!/Append a dated entry/.test(p) && !/3-6 line summary/.test(p));
    assert.ok(p.includes(path.join(roundsDir, "1", "after.png")), "the picture path is the round folder");
    assert.strictEqual(card(1).outcome, "running");
  });
  await test("a finished round: card with summary and pictures, log.md block, Log entry with its card", async () => {
    r1.chatId = crypto.randomUUID();
    line(r1, { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "mcp__blender__look", input: {} }] } });
    line(r1, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: b64(1) } }] }] } });
    line(r1, { type: "assistant", message: { content: [{ type: "tool_use", id: "t2", name: "mcp__blender__execute_blender_code", input: {} }, { type: "tool_use", id: "t3", name: "mcp__blender__look", input: {} }] } });
    line(r1, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t3", content: [{ type: "image", data: b64(2), mimeType: "image/png" }] }] } });
    line(r1, { type: "result", num_turns: 12 });
    const report = "### Summary\nPlayers now have a stamina bar.\n### Changed\n- StarterGui.HUD: new StaminaBar frame\n### Undo\nDelete StarterGui.HUD.StaminaBar.\n### Next\n- Sound when it runs out";
    end(r1, { text: report, error: false, cost: 0.25 });
    const c = await until(() => { const x = card(1); return x && x.outcome === "done" && x; }, 8000, "card 1 done");
    assert.strictEqual(c.summary, "Players now have a stamina bar.");
    assert.deepStrictEqual(c.changed, ["StarterGui.HUD: new StaminaBar frame"]);
    assert.strictEqual(c.chatId, r1.chatId); assert.strictEqual(c.turns, 12); assert.strictEqual(c.cost, 0.25);
    assert.deepStrictEqual(c.images.map((i) => [i.file, i.phase]), [["cap-001.png", "before"], ["cap-002.png", "after"]]);
    const log = fs.readFileSync(path.join(BRAIN, "working", slug, "log.md"), "utf8");
    assert.ok(log.startsWith("# Working log: Sky Race\n"), log);
    assert.ok(/\n## Round 1 · .* · feature · Add a sprint stamina bar\nSummary: Players now have a stamina bar\.\nChanged:\n  - StarterGui\.HUD/.test(log), log);
    const st = (await call("/api/autopilot/working")).body;
    const result = st.log.find((e) => e.type === "result");
    assert.strictEqual(result.text, "Players now have a stamina bar."); assert.strictEqual(result.card, slug);
    assert.strictEqual(st.log.find((e) => e.type === "start").card, slug);
    const list = (await call("/api/autopilot/working/rounds")).body;
    assert.strictEqual(list.slug, slug); assert.strictEqual(list.rounds[0].n, 1); assert.strictEqual(list.rounds[0].images.length, 2);
    assert.ok(pushes.some((p) => p.t === "rounds" && p.n === 1));
  });
  await test("a failed round: card says failed, log.md gets a one-liner", async () => {
    const r2 = await until(() => runs[1], 8000, "round 2");
    end(r2, { text: "Something broke", error: true });
    const c = await until(() => { const x = card(2); return x && x.outcome === "failed" && x; }, 8000, "card 2 failed");
    assert.ok(/^failed: /.test(c.outcomeText), c.outcomeText);
    const log = fs.readFileSync(path.join(BRAIN, "working", slug, "log.md"), "utf8");
    assert.ok(/\n- .* · round 2 · feature · Add a sprint stamina bar: didn't finish \(failed: Something broke\)\. Card: rounds\\2\\\n/.test(log), log);
    const st = (await call("/api/autopilot/working")).body;
    assert.strictEqual(st.log.filter((e) => e.type === "error").pop().card, slug);
  });
  await call("/api/autopilot/working/stop", "POST", {});
}

main().catch((e) => { failed++; console.log("FAIL test script: " + (e && e.stack || e)); }).then(async () => {
  await sleep(100);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  console.log(`${failed ? "FAILED" : "PASSED"}: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
});
