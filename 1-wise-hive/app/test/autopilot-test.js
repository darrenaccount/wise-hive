// autopilot.js unit test (2026-10-13), with a stand-in for Claude (startChat returns a fake run this test ends; the planner
// answers a fixed plan). Checks:
//   - Working's commit identity: a repo with no git identity gets one through the round's env, a repo with one doesn't
//     (looked up with async git, no longer blocking the server);
//   - "Do this next" sends the idea's title: the right one moves the idea up, a stale one (a new plan put another idea at
//     that index) is refused with a clear error, and a request without a title (an older page) still works;
//   - End then Start while a round is still dying: what that round cost still counts toward today's spend (the daily $
//     cap), not toward the new session's stats.
// Free: no Claude, temp folders (tiny), git with the user's global and system config switched off.
//   node test/autopilot-test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const { EventEmitter } = require("events");

const APP = path.resolve(__dirname, "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "wh-autopilot-"));
const BRAIN = path.join(TMP, "brain"), PROJ = path.join(TMP, "Kart Game");
fs.mkdirSync(BRAIN, { recursive: true }); fs.mkdirSync(PROJ, { recursive: true });
process.env.HIVE_AUTOPILOT_DIR = path.join(TMP, "autopilot");
// The round's git identity check must not see the user's own name and email.
fs.writeFileSync(path.join(TMP, "gitconfig"), "");
process.env.GIT_CONFIG_GLOBAL = path.join(TMP, "gitconfig"); process.env.GIT_CONFIG_NOSYSTEM = "1";
execFileSync("git", ["-C", PROJ, "init", "-q"], { windowsHide: true });

let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log("PASS " + name); } catch (e) { failed++; console.log("FAIL " + name + ": " + (e && e.stack || e)); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000, what = "condition") { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await sleep(20); } throw new Error("timed out waiting for " + what); }

const runs = [];
const PLAN = JSON.stringify({ title: "Add a boost pad", focus: "feature", agents: ["builder"], why: "more speed", prompt: "Add it.",
  next: [{ title: "Idea A", prompt: "do A", focus: "feature" }, { title: "Idea B", prompt: "do B", focus: "polish" }, { title: "Idea C", prompt: "do C", focus: "tests" }] });
const ctx = {
  BRAIN, HOME: TMP, PORT: 4799, APP_DIR: APP, hub: new EventEmitter(),
  read: (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } },
  json: (res, code, body) => { res.code = code; res.body = body; },
  body: async (req) => req.body || {},
  broadcast: () => {}, notify: () => {},
  usage: { refresh: async () => null, brief: () => null, ensure: async () => {}, over: () => null, readAt: () => Date.now(), isGaming: async () => ({ gaming: false }), route: () => false },
  askClaude: async () => ({ text: PLAN }),
  // A live run the server would keep in its map (stop() looks it up there).
  startChat: (opts) => { const run = { id: crypto.randomUUID(), opts, events: [], chatId: null, done: false }; runs.push(run); ctx.live.set(run.id, run); return run; },
  stopChat: (run) => { run.stopped = true; },
  stopRun: () => true,
  live: new Map(),
  autopilotTimings: { cooldown: 30, poll: 20, firstBeat: 1e9, beat: 1e9 },
};
const ap = require(path.join(APP, "autopilot.js"))(ctx);
const call = (p, method = "GET", body) => { const res = {}; const u = new URL(p, "http://127.0.0.1:4799"); const h = ap.route(u.pathname, { method, body }, res, u); return Promise.resolve(h).then(() => res); };
// A round ends: its result event, then the server's onDone.
const end = (run, result) => { run.events.push({ t: "result", ...result }); run.done = true; ctx.live.delete(run.id); run.onDone(); };

async function main() {
  await test("a repo without a git identity: the Working round gets one in its env", async () => {
    const res = await call("/api/autopilot/working/start", "POST", { goal: "Make karting fun", project: PROJ, permission: "safe" });
    assert.strictEqual(res.code, 200, JSON.stringify(res.body));
    const r1 = await until(() => runs[0], 8000, "round 1");
    assert.deepStrictEqual(r1.opts.env, { GIT_AUTHOR_NAME: "The Wise Hive", GIT_AUTHOR_EMAIL: "teamwright@localhost", GIT_COMMITTER_NAME: "The Wise Hive", GIT_COMMITTER_EMAIL: "teamwright@localhost" });
    end(r1, { text: "### Summary\nAdded the pad.", error: false, cost: 0.25 });
    await until(() => runs[1], 8000, "round 2");
  });

  await test("Do this next: the idea's title must still be at that index; no title (an older page) still works", async () => {
    let st = (await call("/api/autopilot/working")).body;
    assert.deepStrictEqual(st.next.map((x) => x.title), ["Idea A", "Idea B", "Idea C"]);
    const stale = await call("/api/autopilot/working/promote", "POST", { index: 0, title: "Idea B" });
    assert.strictEqual(stale.code, 400);
    assert.ok(/ideas changed/.test(stale.body.error), stale.body.error);
    st = (await call("/api/autopilot/working")).body;
    assert.strictEqual(st.next.length, 3, "nothing moved");
    const ok = await call("/api/autopilot/working/promote", "POST", { index: 1, title: "Idea B" });
    assert.strictEqual(ok.code, 200, JSON.stringify(ok.body));
    assert.deepStrictEqual(ok.body.next.map((x) => x.title), ["Idea A", "Idea C"]);
    assert.ok(ok.body.directives.some((d) => d.text === "Do this next: Idea B: do B"));
    const old = await call("/api/autopilot/working/promote", "POST", { index: 0 });
    assert.strictEqual(old.code, 200);
    assert.deepStrictEqual(old.body.next.map((x) => x.title), ["Idea C"]);
    assert.strictEqual((await call("/api/autopilot/working/promote", "POST", { index: 5, title: "Idea C" })).code, 400);
  });

  await test("End then Start while a round is dying: its cost counts toward today, not the new session", async () => {
    const r2 = runs[1];
    let st = (await call("/api/autopilot/working")).body;
    assert.strictEqual(st.daily.cost, 0.25);
    await call("/api/autopilot/working/stop", "POST", {});
    assert.ok(r2.stopped, "End asked the round to stop");
    // The repo gets its own identity now: the next round must not get one from the app.
    execFileSync("git", ["-C", PROJ, "config", "user.name", "Kart Dev"], { windowsHide: true });
    execFileSync("git", ["-C", PROJ, "config", "user.email", "kart@example.invalid"], { windowsHide: true });
    const res = await call("/api/autopilot/working/start", "POST", { goal: "Keep going", project: PROJ, permission: "safe" });
    assert.strictEqual(res.code, 200, JSON.stringify(res.body));
    end(r2, { text: "", error: true, cost: 0.5 });
    st = (await call("/api/autopilot/working")).body;
    assert.strictEqual(st.daily.cost, 0.75, "today's spend includes the old session's round");
    assert.strictEqual(st.stats.cost, 0, "the new session's stats don't");
    assert.ok(st.log.some((e) => e.type === "note" && e.text === "Round 2 stopped."));
    const r3 = await until(() => runs[2], 8000, "round 3");
    assert.strictEqual(r3.opts.env, undefined, "the repo has its own identity");
  });
  await call("/api/autopilot/working/stop", "POST", {});
  await test("Training subjects and model: settings keep known subjects only, the Trainer's prompt must stick to them", async () => {
    const r = await call("/api/autopilot/training/settings", "POST", { subjects: ["robloxvfx", "props", "bogus", "props"], model: "claude-fable-5-1" });
    assert.strictEqual(r.code, 200, JSON.stringify(r.body));
    const st = (await call("/api/autopilot/training")).body;
    assert.deepStrictEqual(st.subjects, ["robloxvfx", "props"]);
    assert.strictEqual(st.model, "claude-fable-5-1");
    assert.ok(st.guard && st.guard.cap, "the usage guard is untouched");
    const prompts = [], ask0 = ctx.askClaude;
    ctx.askClaude = async (o) => { prompts.push(o.prompt || ""); return ask0(o); };
    try {
      assert.strictEqual((await call("/api/autopilot/training/start", "POST", { goal: "practice", subjects: ["vfx"] })).code, 200);
      for (let i = 0; i < 100 && !prompts.some((p) => /TRAINER/.test(p)); i++) await new Promise((ok) => setTimeout(ok, 20));
      const pl = prompts.find((p) => /TRAINER/.test(p)) || "";
      assert.ok(/SUBJECTS THE USER PICKED/.test(pl) && /VFX in Blender/.test(pl) && !/Roblox VFX/.test(pl.split("SUBJECTS THE USER PICKED")[1] || ""), pl.slice(-1500));
    } finally { ctx.askClaude = ask0; await call("/api/autopilot/training/stop", "POST", {}); }
    await call("/api/autopilot/training/settings", "POST", { subjects: [] });
  });

  await test("The boss: below the bar the next round is a redo with its must-fix list; a pass goes back to the planner; off means no check", async () => {
    const ask0 = ctx.askClaude, scores = [5, 9], bossPrompts = [];
    ctx.askClaude = async (o) => {
      if (/You are THE BOSS/.test(o.prompt || "")) { bossPrompts.push(o.prompt); return { text: JSON.stringify({ score: scores.shift(), why: "The pad does nothing.", mustFix: ["Boost pad gives no speed (kart.lua:12)", "No test"] }) }; }
      return ask0(o);
    };
    try {
      assert.strictEqual((await call("/api/autopilot/working/settings", "POST", { boss: 8 })).body.boss, 8);
      // An earlier test's stopped round is still "running" in the fake: end it so the Working loop is free.
      for (const r of runs) if (!r.done && r.opts.kind === "working") end(r, { text: "", error: true, cost: 0 });
      await sleep(200);
      const before = runs.length;
      assert.strictEqual((await call("/api/autopilot/working/start", "POST", { goal: "Boss test", project: PROJ, permission: "safe" })).code, 200);
      const r1 = await until(() => runs[before], 8000, "boss round 1");
      end(r1, { text: "### Summary\nAdded the pad.", error: false, cost: 0 });
      const r2 = await until(() => runs[before + 1], 8000, "the redo round");
      assert.ok(/THE BOSS SENT ROUND \d+ BACK: 5\/10/.test(r2.opts.prompt) && /Boost pad gives no speed/.test(r2.opts.prompt), r2.opts.prompt.slice(0, 600));
      assert.ok(/Boss redo 1: Add a boost pad/.test(r2.opts.title), r2.opts.title);
      assert.ok(/THE ROUND'S COMMITS/.test(bossPrompts[0]) && /Added the pad/.test(bossPrompts[0]), "the boss saw the evidence and the report");
      let st = (await call("/api/autopilot/working")).body;
      const b1 = st.log.filter((e) => e.type === "boss");
      assert.ok(b1.length === 1 && b1[0].score === 5 && b1[0].pass === false && b1[0].redo === true && b1[0].mustFix.length === 2, JSON.stringify(b1));
      end(r2, { text: "### Summary\nFixed both.", error: false, cost: 0 });
      const r3 = await until(() => runs[before + 2], 8000, "the next planned round");
      assert.ok(!/Boss redo/.test(r3.opts.title), "a pass goes back to the planner: " + r3.opts.title);
      assert.ok(/redo 1 of round/.test(bossPrompts[1]), "the second check knows it judged a redo");
      st = (await call("/api/autopilot/working")).body;
      assert.ok(st.log.some((e) => e.type === "boss" && e.score === 9 && e.pass === true));
      // Off: no boss call after the round.
      await call("/api/autopilot/working/settings", "POST", { boss: 0 });
      const asked = bossPrompts.length;
      end(r3, { text: "### Summary\nDone.", error: false, cost: 0 });
      await until(() => runs[before + 3], 8000, "a round after the boss was turned off");
      assert.strictEqual(bossPrompts.length, asked, "no boss check while it's off");
    } finally { ctx.askClaude = ask0; await call("/api/autopilot/working/stop", "POST", {}); await call("/api/autopilot/working/settings", "POST", { boss: 8 }); }
  });

}

main().catch((e) => { failed++; console.log("FAIL test script: " + (e && e.stack || e)); }).then(async () => {
  for (const r of runs) if (!r.done) { r.done = true; try { r.onDone && r.onDone(); } catch {} }
  await sleep(150);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  console.log(`${failed ? "FAILED" : "PASSED"}: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
});
