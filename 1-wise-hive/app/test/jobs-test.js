// Tests for the live activity panel's tracker (jobs.js). Free: no Claude runs.
//   node test/jobs-test.js            unit tests on a fake clock and a fake server context (under 2 s; api-test.js runs these)
//   node test/jobs-test.js --server   real server.js instances on a spare port and a scratch brain, with the debug routes:
//                                     fakes, pushes, stop causes, /api/runs untouched, history across a restart, 404 without debug
//   node test/jobs-test.js --soak     500 fake jobs with 3 children each: nothing leaks, history stays 20, file stays small
// Server modes start their own servers (never the app on 4747) and stop them when done.
// These spend real Claude usage and need a running debug instance (HIVE_ACTIVITY_DEBUG=1 on a spare port such as 4797;
// they refuse port 4747 and any instance without the debug routes, so never the real app):
//   --council <port>     one real council: members and judge appear, update and finish live (Sonnet/Opus, like any council)
//   --live <port>        two quick no-tool subagents on Haiku (about a cent)
//   --live-long <port>   one subagent with a 200 s shell call in a scratch folder (Haiku, ~4 min); the test allows only
//                        its three node -e commands and denies any other permission prompt
// The stream fixture (test/fixtures/subagent-stream.jsonl) is hand-made from real Claude Code 2.1.296 captures,
// sanitized (no paths, made-up ids); "_ms" on each line is when it arrived, used to drive the fake clock.
// Verified 2026-10-13.
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const APP = path.resolve(__dirname, "..");
const JOBS = path.join(APP, "jobs.js");
const FIX = path.join(__dirname, "fixtures", "subagent-stream.jsonl");
const argv = process.argv.slice(2);
const T0 = 1800000000000;
// Scratch files go on D: next to the app, in the gitignored .research folder, and are removed at the end.
const TMP = path.join(APP, ".research", "jobs-unit-" + process.pid);
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("PASS", name); }
  catch (e) { failed++; console.log("FAIL", name + ":", e && e.message || e); }
}

// A tracker on a fake clock with a fake ctx. events: every {t:"jobs"} push.
function mk(opts = {}) {
  let clock = opts.t0 || T0;
  const events = [];
  const ctx = { BRAIN: path.join(TMP, "brain"), track: {},
    broadcast: opts.broadcast || ((e) => events.push(e)),
    json: (res, code, body) => { res.code = code; res.body = body; },
    body: async (req) => req.body || {},
    jobsOpts: { now: () => clock, file: opts.file || path.join(TMP, "none.json"), persist: !!opts.persist } };
  delete require.cache[require.resolve(JOBS)];
  const mod = require(JOBS)(ctx);
  const get = () => { const res = {}; mod.route("/api/jobs", { method: "GET" }, res); return res.body; };
  const job = (id) => get().live.find((j) => j.id === id);
  return { T: ctx.track, mod, ctx, events, get, job, at: (ms) => (clock = (opts.t0 || T0) + ms), tick: (ms) => (clock += ms), now: () => clock };
}
const fixture = () => fs.readFileSync(FIX, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
// Feeds fixture lines (up to and including _ms <= until) to run "R".
function feed(k, lines, until = Infinity) {
  while (lines.length && lines[0]._ms <= until) { const ev = lines.shift(); k.at(ev._ms); k.T.line("R", ev); }
}
const startRun = (k, extra = {}) => k.T.begin({ id: "R", kind: "chat", name: "[Wise Hive test] subagents", started: k.now(), ...extra });

async function unit() {
  await test("short names: tags, prefixes and filler dropped, the gist kept, full name kept", () => {
    const { shortName } = require(JOBS);
    assert.strictEqual(shortName("[Wise Hive training] Round 12: Chest v2: hinge inside the silhouette, smooth arcs"), "Chest v2");
    assert.strictEqual(shortName("Council: [Wise Hive test] A Roblox obby where players trade checkpoints with each other"), "Roblox obby where players trade…");
    assert.strictEqual(shortName("can you please make the kart drift better and add particles"), "Make the kart drift better…");
    assert.strictEqual(shortName("You are the LIBRARIAN of the brain"), "Librarian");
    assert.strictEqual(shortName("Fix the bug at 10:30"), "Fix the bug at 10:30", "a time isn't a Title: break");
    const k = mk();
    k.T.begin({ id: "N", kind: "chat", name: "can you please make the kart drift better and add particles", started: k.now() });
    assert.strictEqual(k.job("N").name, "Make the kart drift better…");
    assert.strictEqual(k.job("N").full, "can you please make the kart drift better and add particles");
  });
  await test("tokens: messages counted once, subagents added, the result's modelUsage is the exact total", () => {
    const k = mk();
    k.T.begin({ id: "R", kind: "chat", name: "token test", started: k.now() });
    const msg = (id, u) => ({ type: "assistant", message: { id, usage: u, content: [] } });
    k.T.line("R", msg("m1", { input_tokens: 2, cache_creation_input_tokens: 1000, cache_read_input_tokens: 0, output_tokens: 5 }));
    k.T.line("R", msg("m1", { input_tokens: 2, cache_creation_input_tokens: 1000, cache_read_input_tokens: 0, output_tokens: 5 }));
    assert.strictEqual(k.job("R").tok, 1007, "the same message on two lines counts once");
    k.T.line("R", { type: "system", subtype: "task_started", task_type: "local_agent", task_id: "t1", tool_use_id: "toolu_a", description: "Helper" });
    k.T.line("R", { type: "system", subtype: "task_notification", task_id: "t1", tool_use_id: "toolu_a", status: "completed", summary: "ok", usage: { input_tokens: 1, cache_creation_input_tokens: 500, output_tokens: 9 } });
    assert.strictEqual(k.job("R:toolu_a").tok, 510);
    assert.strictEqual(k.job("R").tok, 1517, "a finished subagent's tokens count for its run");
    k.T.line("R", msg("m2", { input_tokens: 2, cache_creation_input_tokens: 10, cache_read_input_tokens: 1000, output_tokens: 3 }));
    assert.strictEqual(k.job("R").tok, 2532);
    k.T.line("R", { type: "result", result: "Done here", modelUsage: { "claude-haiku-5-5": { inputTokens: 5, outputTokens: 17, cacheReadInputTokens: 1000, cacheCreationInputTokens: 1510 } } });
    assert.strictEqual(k.job("R").tok, 2532, "the exact total from modelUsage");
    k.T.end("R", { code: 0 });
    const h = k.get().history.find((x) => x.id === "R");
    if (h) { assert.strictEqual(h.tok, 2532); assert.deepStrictEqual(h.tk, { i: 5, w: 1510, r: 1000, o: 17 }); }
  });
  await test("fixture: subagent rows appear, update and finish with clean results", () => {
    const k = mk(), L = fixture();
    startRun(k);
    feed(k, L, 6600);
    const kids = () => k.get().live.filter((j) => j.parent === "R");
    assert.deepStrictEqual(kids().map((j) => j.name), ["Counter", "Namer", "Reader"]);
    assert.strictEqual(k.job("R").chatId, "00000000-0000-4000-8000-0000000000aa");
    assert.strictEqual(k.job("R").tool, "Agent");
    assert.strictEqual(k.job("R:toolu_reader").sub, "Explore");
    assert.strictEqual(k.job("R:toolu_counter").sub, "", "general-purpose isn't shown");
    feed(k, L, 7000);
    assert.strictEqual(k.job("R:toolu_reader").step, "Finding notes");
    assert.strictEqual(k.job("R:toolu_reader").tool, "Glob");
    feed(k, L, 7100);
    assert.strictEqual(k.job("R:toolu_reader").lastOut, T0 + 7100, "a tagged tool line is the subagent's output");
    feed(k, L, 7842);
    assert.strictEqual(k.job("R:toolu_namer").status, "done");
    assert.strictEqual(k.job("R:toolu_namer").result, "Red");
    feed(k, L, 7885);
    assert.strictEqual(k.job("R:toolu_counter").status, "done");
    assert.strictEqual(k.job("R:toolu_counter").result, "1", "the summary wins over the later tool_result");
    feed(k, L, 8000);
    assert.strictEqual(k.job("R:toolu_reader").step, "Reading notes.md");
    feed(k, L, 11600);
    assert.strictEqual(k.job("R:toolu_reader").lastOut, T0 + 11600);
    assert.strictEqual(kids().length, 3, "a subagent's local_bash task makes no row");
    feed(k, L, 99000);
    assert.strictEqual(k.job("R:toolu_reader").lastOut, T0 + 11600, "Agent heartbeats aren't output (child)");
    assert.strictEqual(k.job("R").lastOut, T0 + 11600, "Agent heartbeats aren't output (run)");
    assert.strictEqual(k.job("R:toolu_reader").status, "running");
    feed(k, L, 211010);
    assert.strictEqual(k.job("R:toolu_reader").status, "done");
    assert.strictEqual(k.job("R:toolu_reader").result, "FINISHED: the notes say the wait worked");
    feed(k, L, 242000);
    assert.strictEqual(kids().length, 3, "a top-level local_bash task makes no row");
    assert.strictEqual(k.job("R").lastOut, T0 + 214600, "a top-level heartbeat isn't output");
    assert.strictEqual(k.job("R").tool, "Bash");
    feed(k, L, 248200);
    assert.strictEqual(k.job("R:toolu_bg").bg, true);
    assert.strictEqual(k.job("R:toolu_bg").status, "running", "a background agent survives its immediate tool_result");
    feed(k, L, 252000);
    assert.strictEqual(k.job("R:toolu_bg").step, "Reading the build log");
    feed(k, L, 260000);
    assert.strictEqual(k.job("R:toolu_bg").status, "done");
    assert.strictEqual(k.job("R:toolu_bg").result, "The build log looks clean");
    feed(k, L);
    k.tick(500);
    k.T.end("R", { code: 0, err: "" });
    const g = k.get();
    assert.strictEqual(g.live.length, 0);
    assert.strictEqual(g.history[0].id, "R");
    assert.strictEqual(g.history[0].status, "done");
    assert.strictEqual(g.history[0].result, "DONE");
    assert.deepStrictEqual(g.history[0].agents.map((a) => a.name + ":" + a.status), ["Counter:done", "Namer:done", "Reader:done", "Watcher:done"]);
    assert.deepStrictEqual(k.mod._counts(), { active: 0, tools: 0, tasks: 0, inner: 0, timers: 0 });
  });

  await test("fixture: results fall back to tool_use_result, then to the unwrapped text", () => {
    for (const strip of [["task_notification"], ["task_notification", "tool_use_result"]]) {
      const k = mk(), L = fixture().filter((e) => !(strip.includes("task_notification") && e.subtype === "task_notification"));
      if (strip.includes("tool_use_result")) for (const e of L) delete e.tool_use_result;
      startRun(k);
      feed(k, L, 7885);
      for (const [id, want] of [["R:toolu_namer", "Red"], ["R:toolu_counter", "1"]]) {
        const j = k.job(id);
        assert.strictEqual(j.status, "done", `${id} ended (${strip.join("+")} removed)`);
        assert.strictEqual(j.result, want, `${id} result (${strip.join("+")} removed)`);
        assert.ok(!/Subagent hand-back|agentId|<usage>/.test(j.result));
      }
    }
  });

  await test("out pushes: first at once, then at most one per 5 s; a tool or step change pushes at once", () => {
    const k = mk();
    k.T.begin({ id: "A", kind: "chat", name: "a" });
    const outs = () => k.events.filter((e) => e.op === "out" && e.id === "A").length;
    k.T.out("A");
    assert.strictEqual(outs(), 1, "first out after begin");
    for (let i = 0; i < 49; i++) { k.tick(100); k.T.out("A"); }
    assert.strictEqual(outs(), 1, "nothing more within 5 s");
    k.tick(100); k.T.out("A");
    assert.strictEqual(outs(), 2, "one more at 5 s");
    k.tick(100); k.T.out("A", "Bash");
    assert.strictEqual(outs(), 3, "tool change pushes at once");
    k.tick(100); k.T.out("A", "Bash");
    assert.strictEqual(outs(), 3, "same tool doesn't");
    assert.strictEqual(k.job("A").lastOut, k.now(), "lastOut is always exact on the server");
  });

  await test("a run's end sweeps a child still running and leaves no keys", () => {
    const k = mk(), L = fixture();
    startRun(k);
    feed(k, L, 6600);
    k.tick(1000);
    k.T.end("R", { code: 1, err: "boom happened here" });
    const h = k.get().history[0];
    assert.strictEqual(h.status, "failed");
    assert.ok(h.agents.every((a) => a.status === "failed" && a.result === "ended with its run"), JSON.stringify(h.agents));
    assert.deepStrictEqual(k.mod._counts(), { active: 0, tools: 0, tasks: 0, inner: 0, timers: 0 });
    assert.strictEqual(k.get().live.length, 0);
  });

  // Not captured: a nested agent's lines are modelled on Stream fact 3 (a task a subagent owns gets no task_updated or
  // task_notification; its tool_result, tagged with the outer agent's id, is its only end).
  await test("a nested agent ends on its tagged tool_result; one with no end signal ends with its outer agent", () => {
    const k = mk();
    startRun(k);
    const agentUse = (id, desc, ptu) => k.T.line("R", { type: "assistant", message: { content: [{ type: "tool_use", id, name: "Agent", input: { description: desc } }] }, parent_tool_use_id: ptu });
    const started = (task, id, desc, depth, parentTask) => k.T.line("R", { type: "system", subtype: "task_started", task_id: task, tool_use_id: id, description: desc, task_type: "local_agent", spawn_depth: depth, ...(parentTask ? { owned_by_subagent: true, parent_task_id: parentTask } : {}) });
    const result = (id, text, ptu) => k.T.line("R", { type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: text }] }, parent_tool_use_id: ptu });
    agentUse("tA", "Outer", null); started("kA", "tA", "Outer", 1);
    agentUse("tN", "Nested", "tA"); started("kN", "tN", "Nested", 2, "kA");
    agentUse("tM", "Nested two", "tA"); started("kM", "tM", "Nested two", 2, "kA");
    assert.deepStrictEqual([k.job("R:tN").via, k.job("R:tN").depth, k.job("R:tN").parent], ["R:tA", 2, "R"]);
    k.tick(1000);
    result("tN", "nested report", "tA");
    assert.deepStrictEqual([k.job("R:tN").status, k.job("R:tN").result], ["done", "nested report"]);
    assert.strictEqual(k.job("R:tA").status, "running", "the outer agent is still working");
    assert.strictEqual(k.job("R:tM").status, "running");
    k.tick(1000);
    k.T.line("R", { type: "system", subtype: "task_notification", task_id: "kA", tool_use_id: "tA", status: "completed", summary: "outer report" });
    assert.deepStrictEqual([k.job("R:tA").status, k.job("R:tA").result], ["done", "outer report"]);
    assert.deepStrictEqual([k.job("R:tM").status, k.job("R:tM").result], ["done", "ended with its agent"], "nothing nested is left running");
    assert.strictEqual(k.get().live.filter((j) => j.status === "running").length, 1, "only the run itself");
    k.T.end("R", { code: 0 });
    assert.deepStrictEqual(k.mod._counts(), { active: 0, tools: 0, tasks: 0, inner: 0, timers: 0 });
  });

  await test("unknown ids, late lines and a subagent's init do nothing", () => {
    const k = mk();
    k.T.line("nope", { type: "system", subtype: "init", session_id: "x" });
    k.T.out("nope"); k.T.end("nope", { code: 0 }); k.T.waiting("nope", 2);
    assert.strictEqual(k.events.length, 0, "no pushes for unknown ids");
    k.T.begin({ id: "B", kind: "chat", name: "b" });
    k.T.line("B", { type: "system", subtype: "init", session_id: "S-main" });
    k.T.line("B", { type: "system", subtype: "init", session_id: "S-sub", parent_tool_use_id: "toolu_x" });
    assert.strictEqual(k.job("B").chatId, "S-main");
    k.T.end("B", { code: 0 });
    const n = k.events.length;
    k.T.line("B", { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Agent", input: {} }] } });
    k.T.end("B", { code: 0 });
    assert.strictEqual(k.events.length, n, "lines and a second end after the run ended do nothing");
  });

  await test("a throwing broadcast doesn't break begin, line or end", () => {
    const k = mk({ broadcast: () => { throw new Error("socket gone"); } });
    k.T.begin({ id: "C", kind: "training", name: "c" });
    k.T.line("C", { type: "result", result: "ok", is_error: false });
    k.T.end("C", { code: 0 });
    assert.strictEqual(k.get().history[0].status, "done");
  });

  await test("a result the CLI called fine but that says not logged in or hit a limit is failed, like autopilot counts it", () => {
    for (const text of ["Not logged in · Please run /login", "You've hit your limit · resets 3am (Europe/London)", "API Error: 529 overloaded_error"]) {
      const k = mk();
      k.T.begin({ id: "F", kind: "training", name: "Training #4: x" });
      k.T.line("F", { type: "result", result: text, is_error: false });
      k.T.end("F", { code: 0 });
      const h = k.get().history[0];
      assert.deepStrictEqual([h.status, h.stopped, h.result], ["failed", false, text], text);
    }
    const k = mk(); // a long real summary that mentions a limit is still done
    k.T.begin({ id: "G", kind: "training", name: "Training #5: y" });
    k.T.line("G", { type: "result", result: "Built the limiter. " + "It now handles the case where a player has hit your limit message. ".repeat(8), is_error: false });
    k.T.end("G", { code: 0 });
    assert.strictEqual(k.get().history[0].status, "done");
    const c = mk(); // the council agrees with its judge row
    const cj = c.T.begin({ kind: "council", name: "Council: x" });
    c.T.begin({ id: "jd", parent: cj, kind: "judge", name: "Judge" });
    c.T.line("jd", { type: "result", result: "You've hit your limit · resets 3am", is_error: false });
    c.T.end("jd", { code: 0 });
    assert.strictEqual(c.job("jd").status, "failed");
    c.T.end(cj, { ok: true, code: 0, text: "You've hit your limit · resets 3am", err: "You've hit your limit · resets 3am" });
    assert.deepStrictEqual([c.get().history[0].status, c.get().history[0].result], ["failed", "You've hit your limit · resets 3am"]);
  });

  await test("stop causes: user, skip and cap are grey with their own text; timeout and no reason are red", () => {
    for (const [why, cause, text, grey] of [["user", "user", "Stopped by you", true], ["skip", "skip", "Skipped by you", true], ["cap", "cap", "Stopped at the usage cap", true],
      [undefined, "app", "Stopped by The Wise Hive", false], ["something new", "app", "Stopped by The Wise Hive", false]]) {
      const k = mk();
      k.T.begin({ id: "S", kind: "training", name: "Training #1: kit" });
      k.T.line("S", { type: "result", result: "Built the kit.", is_error: false }); // a stopped run can still print a normal result
      k.T.stopping("S", why); k.tick(5000);
      k.T.end("S", { code: 0 });
      const h = k.get().history[0];
      assert.deepStrictEqual([h.status, h.stopped, h.cause, h.result], ["failed", grey, cause, text], `why=${why}`);
    }
    const k = mk();
    k.T.begin({ id: "L", kind: "training", name: "Training #2: long" });
    k.tick(3 * 3600e3);
    k.T.stopping("L", "timeout");
    k.T.stopping("L", "user"); // the first reason wins
    k.T.end("L", { code: 1, err: "killed" });
    const h = k.get().history[0];
    assert.deepStrictEqual([h.status, h.stopped, h.cause, h.result], ["failed", false, "timeout", "Ran 3h 00m, stopped by The Wise Hive (time limit)"]);
    const k2 = mk();
    k2.T.begin({ id: "P", kind: "plan", name: "Trainer: planning the next round", icon: "trainer" });
    k2.T.stopping("P", "user");
    k2.T.end("P", { code: 1 });
    assert.strictEqual(k2.get().live.length, 0, "a stopped planner leaves nothing running");
  });

  await test("council: members stay listed as done while the judge runs; the council ends with the verdict and 4 agents", () => {
    const k = mk();
    const cj = k.T.begin({ kind: "council", name: "Council: an hourly obby", icon: "judge", started: k.now() });
    assert.ok(/^c-[0-9a-f]{8}$/.test(cj), cj);
    const members = ["believer", "skeptic", "investor"];
    for (const m of members) k.T.begin({ id: "m-" + m, parent: cj, kind: "council-member", name: m[0].toUpperCase() + m.slice(1), icon: m, started: k.now() });
    assert.ok(members.every((m) => k.job("m-" + m).parent === cj && k.job("m-" + m).status === "running"));
    k.tick(15000);
    for (const m of members) k.T.line("m-" + m, { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "x" } } });
    assert.strictEqual(k.job(cj).lastOut, k.now(), "member output counts for the council");
    k.tick(9000);
    for (const m of members) { k.T.line("m-" + m, { type: "result", result: "## Case\n- strong", is_error: false }); k.T.end("m-" + m, { code: 0 }); }
    assert.ok(members.every((m) => k.job("m-" + m) && k.job("m-" + m).status === "done"), "members stay in live as done");
    assert.strictEqual(k.job(cj).status, "running");
    k.tick(10000);
    k.T.begin({ id: "jdg", parent: cj, kind: "judge", name: "Judge", icon: "judge", started: k.now() });
    const verdict = "VERDICT: PURSUE | SCORE: 7/10\n## Why\nGood.";
    k.tick(9000);
    k.T.line("jdg", { type: "result", result: verdict, is_error: false });
    k.T.end("jdg", { code: 0 });
    assert.strictEqual(k.job("jdg").result, "Pursue · 7/10");
    k.T.end(cj, { ok: true, code: 0, text: verdict });
    const h = k.get().history[0];
    assert.deepStrictEqual([h.kind, h.status, h.result], ["council", "done", "Pursue · 7/10"]);
    assert.deepStrictEqual(h.agents.map((a) => a.name + ":" + a.status), ["Believer:done", "Skeptic:done", "Investor:done", "Judge:done"]);
    assert.strictEqual(k.get().live.length, 0);
    assert.deepStrictEqual(k.mod._counts(), { active: 0, tools: 0, tasks: 0, inner: 0, timers: 0 });
    const k2 = mk();
    const c2 = k2.T.begin({ kind: "council", name: "Council: nothing" });
    k2.T.end(c2, { ok: false, code: 1, text: "", err: "The judge gave no verdict" });
    assert.deepStrictEqual([k2.get().history[0].status, k2.get().history[0].result], ["failed", "The judge gave no verdict"]);
  });

  await test("keep rules: short chats and planners stay out of history unless they matter; history holds 20", () => {
    const k = mk();
    const run = (id, b, ms, how = {}) => { k.T.begin({ id, started: k.now(), ...b }); if (how.res) k.T.line(id, { type: "result", result: how.res, is_error: false }); if (how.kid) k.T.line(id, { type: "assistant", message: { content: [{ type: "tool_use", id: "tk", name: "Agent", input: { description: "Helper" } }] } }); if (how.why) k.T.stopping(id, how.why); k.tick(ms); k.T.end(id, { code: how.code ?? 0, err: "" }); };
    const ids = () => k.get().history.map((h) => h.id);
    run("short", { kind: "chat", name: "hi" }, 30e3, { res: "Hello." });
    run("long", { kind: "chat", name: "long" }, 125e3, { res: "Done." });
    run("broke", { kind: "chat", name: "broke" }, 5e3, { code: 1 });
    run("quit", { kind: "chat", name: "quit" }, 5e3, { why: "user" });
    run("team", { kind: "chat", name: "team" }, 5e3, { res: "ok", kid: true });
    run("desk", { kind: "chat", name: "desk", from: "desktop" }, 5e3, { res: "ok" });
    run("bs", { kind: "brainstorm", name: "Brainstorm: x" }, 5e3, { res: "ok" });
    run("plan-ok", { kind: "plan", name: "Trainer: planning" }, 5e3, { res: "{}" });
    run("plan-user", { kind: "plan", name: "Trainer: planning" }, 5e3, { why: "user" });
    run("plan-slow", { kind: "plan", name: "Trainer: planning" }, 900e3, { why: "timeout" });
    run("upd", { kind: "updates", name: "Update The Wise Hive" }, 5e3, { res: "No changes needed" });
    assert.deepStrictEqual(ids(), ["upd", "plan-slow", "desk", "team", "broke", "long"]);
    for (let i = 0; i < 25; i++) run("t" + i, { kind: "training", name: "Training #" + i }, 1000, { res: "ok" });
    assert.strictEqual(k.get().history.length, 20);
    assert.strictEqual(ids()[0], "t24");
  });

  await test("history file: saved on begin and end, last output at most once a minute, restored after a restart", () => {
    const file = path.join(TMP, "hist-" + Date.now() + ".json");
    const k = mk({ file, persist: true });
    const read = () => JSON.parse(fs.readFileSync(file, "utf8"));
    k.T.begin({ id: "W", kind: "working", name: "Working #3: daily", icon: "foreman", started: k.now() });
    assert.deepStrictEqual(read().running.map((r) => [r.id, r.lastOut]), [["W", T0]]);
    for (let s = 1; s < 60; s++) { k.at(s * 1000); k.T.line("W", { type: "stream_event", event: {} }); }
    assert.strictEqual(read().running[0].lastOut, T0, "no save within the minute");
    k.at(60000); k.T.line("W", { type: "stream_event", event: {} });
    assert.strictEqual(read().running[0].lastOut, T0 + 60000, "saved once the minute is up");
    k.at(61000); k.T.line("W", { type: "system", subtype: "init", session_id: "S-W" });
    assert.strictEqual(read().running[0].chatId, "S-W", "saved when the chat id is learned");
    k.T.begin({ id: "D", kind: "training", name: "Training #9: done", started: k.now() });
    k.T.line("D", { type: "result", result: "Built the fence kit.", is_error: false });
    k.at(90000); k.T.end("D", { code: 0 });
    k.T.begin({ id: "P", kind: "plan", name: "Trainer: planning", started: k.now() });
    k.at(95000); k.T.line("W", { type: "stream_event", event: {} });
    const f = read();
    assert.deepStrictEqual(f.history.map((h) => h.id), ["D"]);
    assert.deepStrictEqual(f.running.map((r) => r.id).sort(), ["P", "W"]);
    // "Restart": a new tracker on the same file.
    const k2 = mk({ file, persist: true, t0: T0 + 3600e3 });
    const h = k2.get().history;
    assert.deepStrictEqual(h.map((x) => x.id), ["D", "W"], "newest end first; the planner left running is dropped");
    // W's last saved output: 61000 (saved when D began); its later output at 95000 fell inside the minute.
    assert.deepStrictEqual([h[1].status, h[1].approx, h[1].ended, h[1].result, h[1].chatId], ["failed", true, T0 + 61000, "Cut off by a Wise Hive restart", "S-W"]);
    assert.deepStrictEqual([h[0].status, h[0].result, h[0].approx], ["done", "Built the fence kit.", false]);
    assert.deepStrictEqual(read().running, [], "the running list was turned into history and saved");
    assert.strictEqual(k2.get().live.length, 0);
  });

  await test("history file: off on test instances, and a broken file starts empty", () => {
    const file = path.join(TMP, "off-" + Date.now() + ".json");
    const k = mk({ file, persist: false });
    k.T.begin({ id: "X", kind: "training", name: "x" }); k.T.end("X", { code: 0 });
    assert.ok(!fs.existsSync(file), "persist off never writes");
    fs.writeFileSync(file, "{ not json");
    const k2 = mk({ file, persist: false });
    assert.deepStrictEqual(k2.get().history, []);
    fs.writeFileSync(file, JSON.stringify({ v: 1, history: [{ id: "ok", started: T0, ended: T0 + 5, name: "fine", status: "done", agents: [{ name: "A" }, "junk"] }, "junk", { id: "nostart" }, null], running: "junk" }));
    const k3 = mk({ file, persist: false });
    assert.deepStrictEqual(k3.get().history.map((h) => [h.id, h.status, h.agents.length]), [["ok", "done", 1]]);
  });

  await test("trk() in server.js swallows tracker errors and logs at most once a minute", () => {
    const src = fs.readFileSync(path.join(APP, "server.js"), "utf8");
    const m = /const trkErr = \{\};[^\n]*\n(function trk\([\s\S]*?\n\})\n/.exec(src);
    assert.ok(m, "trk() found in server.js");
    const logs = [];
    const make = new Function("track", "console", `const trkErr = {};\n${m[1]}\nreturn trk;`);
    const trk = make({ line: () => { throw new Error("bug"); } }, { error: (...a) => logs.push(a.join(" ")) });
    for (let i = 0; i < 1000; i++) assert.strictEqual(trk("line", "R", {}), null);
    assert.strictEqual(logs.length, 1, `logged ${logs.length} lines`);
    assert.strictEqual(trk("missing", 1), null, "an absent function is a no-op");
  });
}

/* ---------- server-level tests (real server.js, debug routes, scratch brain) ---------- */
const http = require("http");
const net = require("net");
const { spawn } = require("child_process");
const servers = new Set();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function freePort() {
  return new Promise((ok) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => ok(p)); }); });
}
function req(port, p, { method = "GET", body } = {}) {
  return new Promise((ok) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const r = http.request({ host: "127.0.0.1", port, path: p, method, timeout: 15000, headers: { "x-hive": "1", ...(data ? { "Content-Type": "application/json" } : {}) } }, (res) => {
      let b = ""; res.setEncoding("utf8"); res.on("data", (c) => (b += c));
      res.on("end", () => { let j; try { j = JSON.parse(b); } catch {} ok({ status: res.statusCode, json: j, text: b }); });
    });
    r.on("timeout", () => r.destroy(new Error("timeout")));
    r.on("error", (e) => ok({ status: 0, error: e.message }));
    if (data) r.write(data);
    r.end();
  });
}
// Starts server.js on a spare port with its own brain folder. debug: HIVE_ACTIVITY_DEBUG=1.
async function startServer(brain, debug) {
  const port = await freePort();
  const env = { ...process.env, HIVE_PORT: String(port), TEAMWRIGHT_BRAIN: brain };
  delete env.HIVE_ACTIVITY_FILE; delete env.HIVE_AUTOPILOT_DIR; delete env.HIVE_ACTIVITY_DEBUG;
  if (debug) env.HIVE_ACTIVITY_DEBUG = "1";
  const child = spawn(process.execPath, [path.join(APP, "server.js")], { cwd: APP, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let out = "", exited = false;
  child.stdout.on("data", (d) => (out += d)); child.stderr.on("data", (d) => (out += d));
  child.on("exit", () => { exited = true; servers.delete(child); });
  servers.add(child);
  for (const end = Date.now() + 20000; Date.now() < end && !exited; await sleep(200)) {
    if (out.includes(`127.0.0.1:${port}`) && (await req(port, "/api/jobs")).status === 200) {
      console.log(`  server on port ${port}${debug ? " (debug routes on)" : ""}`);
      return { port, child, log: () => out, stop: () => new Promise((r) => { if (exited) return r(); child.once("exit", r); child.kill(); }) };
    }
  }
  child.kill();
  throw new Error("server didn't start: " + out.trim().split(/\r?\n/).slice(-5).join(" | "));
}
// A POST that answers with server-sent events; every parsed event goes to `list` (and onEvent). ended: the stream closed.
function sse(port, p, body, onEvent) {
  const list = [], data = body === undefined ? "" : JSON.stringify(body), st = { list, ended: false, close: () => { try { r.destroy(); } catch {} } };
  const r = http.request({ host: "127.0.0.1", port, path: p, method: "POST", headers: { "x-hive": "1", ...(data ? { "Content-Type": "application/json" } : {}) } }, (res) => {
    let buf = ""; res.setEncoding("utf8");
    res.on("data", (c) => {
      buf += c; let i;
      while ((i = buf.indexOf("\n\n")) >= 0) { const ch = buf.slice(0, i); buf = buf.slice(i + 2); if (ch.startsWith("data: ")) { let e; try { e = JSON.parse(ch.slice(6)); } catch { continue; } list.push(e); if (onEvent) onEvent(e); } }
    });
    res.on("end", () => (st.ended = true));
  });
  r.on("error", () => (st.ended = true));
  r.end(data || undefined);
  return st;
}
const events = (port) => sse(port, "/api/events"); // the global pushes the page gets
const fake = async (port, body) => (await req(port, "/api/jobs/debug/fake", { method: "POST", body })).json;
const dbg = async (port, what, body) => (await req(port, "/api/jobs/debug/" + what, { method: "POST", body })).json;
const jobsOf = async (port) => (await req(port, "/api/jobs")).json;
async function until(fn, ms = 3000) { for (const end = Date.now() + ms; Date.now() < end; await sleep(50)) { if (await fn()) return true; } return false; }

async function serverTests() {
  const brain = path.join(TMP, "brain-server");
  fs.mkdirSync(brain, { recursive: true });
  let A = await startServer(brain, true);
  const ev = events(A.port);
  await sleep(300);
  let stall;
  await test("server: a fake job 200 s quiet is listed with its old last output", async () => {
    stall = await fake(A.port, { name: "Stall test", quietSec: 200, children: 2 });
    assert.ok(stall && stall.id && stall.kids.length === 2, JSON.stringify(stall));
    const g = await jobsOf(A.port), j = g.live.find((x) => x.id === stall.id);
    assert.ok(j && j.status === "running" && j.lastOut <= Date.now() - 199000, JSON.stringify(j));
    assert.strictEqual(g.live.filter((x) => x.parent === stall.id).length, 2);
    assert.deepStrictEqual(g.stall, { warn: 180, bad: 600 }, "the user's 3 and 10 minutes, for every row");
    assert.ok(g.debug && g.debug.active === 3, JSON.stringify(g.debug));
  });
  await test("server: debug/out pushes every time (not swallowed by the 5 s limit)", async () => {
    const before = ev.list.filter((e) => e.t === "jobs" && e.op === "out" && e.id === stall.id).length;
    await dbg(A.port, "out", { id: stall.id });
    await dbg(A.port, "out", { id: stall.id });
    assert.ok(await until(() => ev.list.filter((e) => e.t === "jobs" && e.op === "out" && e.id === stall.id).length === before + 2), "two out events");
  });
  await test("server: /api/runs stays empty, so restart-when-idle sees nothing busy", async () => {
    const r = await req(A.port, "/api/runs");
    assert.deepStrictEqual(r.json, []);
  });
  await test("server: debug/end with a reason: timeout is red, user is grey", async () => {
    const t1 = await fake(A.port, { name: "Timed out", quietSec: 30 });
    await dbg(A.port, "end", { id: t1.id, why: "timeout" });
    let h = (await jobsOf(A.port)).history[0];
    assert.deepStrictEqual([h.id, h.status, h.stopped], [t1.id, "failed", false]);
    assert.ok(/stopped by The Wise Hive \(time limit\)/.test(h.result), h.result);
    const t2 = await fake(A.port, { name: "Stopped" });
    await dbg(A.port, "end", { id: t2.id, why: "user" });
    h = (await jobsOf(A.port)).history[0];
    assert.deepStrictEqual([h.id, h.status, h.stopped, h.result], [t2.id, "failed", true, "Stopped by you"]);
  });
  await test("server: ending a job empties live and every lookup map; a pushed end carries the history item", async () => {
    await dbg(A.port, "end", { id: stall.kids[1] });
    let g = await jobsOf(A.port);
    assert.strictEqual(g.live.find((x) => x.id === stall.kids[1]).status, "done", "an ended child stays listed under its running parent");
    await dbg(A.port, "end", { id: stall.id });
    g = await jobsOf(A.port);
    assert.strictEqual(g.history[0].id, stall.id);
    assert.strictEqual(g.history[0].agents.length, 2);
    assert.strictEqual(g.live.length, 0);
    assert.deepStrictEqual({ ...g.debug, heap: 0 }, { active: 0, tools: 0, tasks: 0, inner: 0, timers: 0, heap: 0 });
    assert.ok(await until(() => ev.list.some((e) => e.t === "jobs" && e.op === "end" && e.job.id === stall.id && e.item && e.item.id === stall.id)));
  });
  await test("server: endAfterSec ends a fake by itself and clears its timer", async () => {
    const t3 = await fake(A.port, { name: "Auto end", endAfterSec: 0.3, children: 1 });
    assert.strictEqual((await jobsOf(A.port)).debug.timers, 1);
    assert.ok(await until(async () => (await jobsOf(A.port)).history[0].id === t3.id));
    assert.deepStrictEqual({ ...(await jobsOf(A.port)).debug, heap: 0 }, { active: 0, tools: 0, tasks: 0, inner: 0, timers: 0, heap: 0 });
  });
  let left, leftOut;
  await test("server: history and a cut-off job survive a restart", async () => {
    left = await fake(A.port, { name: "Left running" }); // its last output is newer than every ended job's end, so it sorts first
    leftOut = (await jobsOf(A.port)).live.find((x) => x.id === left.id).lastOut;
    const before = (await jobsOf(A.port)).history.map((h) => h.id);
    ev.close();
    await A.stop(); // a hard kill, like a crash or start.ps1 -Restart
    A = await startServer(brain, true);
    const g = await jobsOf(A.port);
    assert.strictEqual(g.live.length, 0);
    const h0 = g.history[0];
    assert.deepStrictEqual([h0.id, h0.status, h0.approx, h0.ended, h0.result], [left.id, "failed", true, leftOut, "Cut off by a Wise Hive restart"]);
    assert.deepStrictEqual(g.history.slice(1).map((h) => h.id), before);
    const file = JSON.parse(fs.readFileSync(path.join(brain, "app-settings", "activity-history.json"), "utf8"));
    assert.deepStrictEqual(file.running, []);
  });
  await A.stop();
  await test("server: without HIVE_ACTIVITY_DEBUG the debug routes are 404 and debug is false", async () => {
    const C = await startServer(brain, false);
    try {
      assert.strictEqual((await req(C.port, "/api/jobs/debug/fake", { method: "POST", body: { name: "x" } })).status, 404);
      const g = await jobsOf(C.port);
      assert.strictEqual(g.debug, false);
      assert.strictEqual(g.history[0].id, left.id, "a plain instance on the same brain reads the history too");
    } finally { await C.stop(); }
  });
}

async function soak() {
  const brain = path.join(TMP, "brain-soak");
  fs.mkdirSync(brain, { recursive: true });
  const A = await startServer(brain, true);
  try {
    await test("soak: 500 fake jobs with 3 children each leave nothing behind", async () => {
      const heap0 = (await jobsOf(A.port)).debug.heap;
      for (let i = 0; i < 500; i++) {
        const f = await fake(A.port, { name: "Soak " + i, children: 3, quietSec: i % 7 });
        await dbg(A.port, "out", { id: f.kids[0] });
        if (i % 3 === 0) await dbg(A.port, "end", { id: f.kids[1] });
        await dbg(A.port, "end", { id: f.id, fail: i % 5 === 0 });
      }
      const g = await jobsOf(A.port);
      assert.deepStrictEqual({ ...g.debug, heap: 0 }, { active: 0, tools: 0, tasks: 0, inner: 0, timers: 0, heap: 0 });
      assert.strictEqual(g.history.length, 20);
      assert.strictEqual(g.live.length, 0);
      const size = fs.statSync(path.join(brain, "app-settings", "activity-history.json")).size;
      assert.ok(size < 64 * 1024, `file is ${size} bytes`);
      const grew = (g.debug.heap - heap0) / 1048576;
      console.log(`  history file ${size} bytes, heap ${grew >= 0 ? "+" : ""}${grew.toFixed(1)} MB`);
      assert.ok(grew < 20, `heap grew ${grew.toFixed(1)} MB`);
    });
  } finally { await A.stop(); }
}

/* ---------- real runs against a running instance (cost tokens; only when asked) ---------- */
const secs = (t0) => ((Date.now() - t0) / 1000).toFixed(1).padStart(5) + "s";
const framed = (s) => /hand-back|agentId:|<usage>/.test(String(s || ""));

// --council <port>: one real council; samples GET /api/jobs every 2 s. Writes no file of its own.
async function councilTest(port) {
  const idea = "[Wise Hive test] A Roblox obby where the course is rebuilt every hour by player votes";
  // The classic three, named: without `seats` the server sits the set saved in the app's seat bar, which may be more.
  const t0 = Date.now(), s = sse(port, "/api/council", { idea, seats: ["believer", "skeptic", "investor"] });
  let cid = null, early = false, doneWhileRunning = false, judgeRan = false, left = false;
  while (Date.now() - t0 < 300000) {
    const g = await jobsOf(port);
    const c = g && g.live.find((j) => (cid ? j.id === cid : j.kind === "council" && j.name.includes("[Wise Hive test]")));
    if (c) {
      cid = c.id;
      const kids = g.live.filter((j) => j.parent === cid);
      console.log(`  ${secs(t0)} council ${c.status} | ${kids.map((k) => `${k.name}:${k.status}`).join(" ")}`);
      if (Date.now() - t0 < 10000 && kids.filter((k) => k.kind === "council-member" && k.status === "running").length === 3) early = true;
      if (c.status === "running" && kids.some((k) => k.kind === "council-member" && k.status === "done")) doneWhileRunning = true;
      if (kids.some((k) => k.kind === "judge" && k.status === "running")) judgeRan = true;
    } else if (cid) { left = true; console.log(`  ${secs(t0)} council left the running list`); break; }
    await sleep(2000);
  }
  s.close();
  const h = cid && (await jobsOf(port)).history.find((x) => x.id === cid);
  await test("council: members appear running before their first output", () => assert.ok(early));
  await test("council: finished members stay listed as done while the council runs", () => assert.ok(doneWhileRunning));
  await test("council: the judge shows up running", () => assert.ok(judgeRan));
  await test("council: it leaves the running list done, with the verdict and 4 agents", () => {
    assert.ok(left, "still running after 5 min");
    assert.ok(h, "no history item");
    assert.strictEqual(h.status, "done");
    assert.ok(/^(Pursue|Pivot|Pass) · \d+\/10$/.test(h.result), h.result);
    assert.deepStrictEqual(h.agents.map((a) => a.name).sort(), ["Believer", "Investor", "Judge", "Skeptic"]);
    assert.ok(h.agents.every((a) => a.status === "done"), JSON.stringify(h.agents.map((a) => a.status)));
  });
}

// Starts a chat through /api/chat and follows it to the end. Returns { runId, chat } (chat.list = the run's events).
async function startChatRun(port, body, onRun) {
  let runId = null;
  const chat = sse(port, "/api/chat", body, (e) => { if (e.t === "run" && !runId) { runId = e.run; if (onRun) onRun(runId); } });
  for (const end = Date.now() + 30000; !runId && Date.now() < end && !chat.ended; await sleep(100)) {}
  return { runId, chat };
}

// --live <port>: two quick no-tool subagents on Haiku (about a cent). Watches the pushes the panel gets.
async function liveTest(port) {
  const ev = events(port);
  await sleep(300);
  const t0 = Date.now();
  const { runId, chat } = await startChatRun(port, { prompt: "[Wise Hive test] Use the Agent tool to start TWO subagents in one message, in parallel. Subagent 1 (description \"Counter\"): reply with the numbers 1 to 5. Subagent 2 (description \"Namer\"): name three colours. Then reply with just DONE.",
    model: "claude-haiku-5-5", mode: "read", title: "[Wise Hive test] subagents" });
  assert.ok(runId, "the chat didn't start");
  for (const end = Date.now() + 180000; Date.now() < end && !chat.ended; await sleep(500)) {}
  await sleep(500);
  ev.close();
  const jobsEv = ev.list.filter((e) => e.t === "jobs" && e.job);
  for (const e of jobsEv) if (e.job.parent === runId) console.log(`  ${e.op} ${e.job.name}: ${e.job.status}${e.job.result ? " · " + e.job.result : ""}`);
  const kid = (name) => jobsEv.filter((e) => e.job.parent === runId && e.job.name === name);
  for (const [name, want] of [["Counter", /^1\b/], ["Namer", /\S/]]) {
    await test(`live: ${name} appears running, then ends done with a clean result`, () => {
      const es = kid(name);
      assert.ok(es.some((e) => e.job.status === "running"), "never seen running");
      const last = es[es.length - 1].job;
      assert.strictEqual(last.status, "done");
      assert.ok(want.test(last.result) && !framed(last.result), last.result);
    });
  }
  const g = await jobsOf(port), h = g.history.find((x) => x.id === runId);
  await test("live: the run ends done, leaves the running list and keeps its 2 agents in history", () => {
    assert.ok(!g.live.some((j) => j.id === runId || j.parent === runId), "still listed");
    assert.ok(h, "no history item");
    assert.strictEqual(h.status, "done");
    assert.strictEqual(h.agents.length, 2);
  });
  console.log(`  took ${secs(t0)}`);
}

// --live-long <port>: one subagent "Slowpoke" that runs a quick shell step, a 200 s wait and another quick step (about
// 4 minutes of Haiku, about a cent). The chat runs in edit mode in a scratch folder, so the shell steps ask for
// permission. The test allows only the three shell commands it asked for, read from the run's own "perm" event (the
// pending list's summary is the model's description, not the command); anything else is denied and fails the test.
const LONG_CMDS = /^node -e "(console\.log\('(start|end)'\)|setTimeout\(\(\)\s*=>\s*console\.log\('waited'\),\s*200000\))"$/;
async function liveLongTest(port) {
  const t0 = Date.now();
  const cwd = path.join(TMP, "live-long"); // an empty scratch folder, removed at the end: any edit lands here
  fs.mkdirSync(cwd, { recursive: true });
  const prompt = "[Wise Hive test] Use the Agent tool to start ONE subagent in the foreground (not in the background) with the description \"Slowpoke\". Tell it to run exactly these three shell commands, one at a time, each as its own tool call, and then reply with exactly FINISHED:\n"
    + "1) node -e \"console.log('start')\"\n2) node -e \"setTimeout(()=>console.log('waited'),200000)\"  (give this call a timeout of 300000 ms and the description \"Waiting 200 seconds\")\n3) node -e \"console.log('end')\"\n"
    + "When the subagent has finished, reply with just DONE.";
  const { runId, chat } = await startChatRun(port, { prompt, cwd, model: "claude-haiku-5-5", mode: "edit", title: "[Wise Hive test] slow subagent" });
  assert.ok(runId, "the chat didn't start");
  let sawWaiting = 0, approved = 0, resumed = 0, maxKids = 0, waitingOnAgent = false, amber = false, red = false, longest = 0, same = null;
  const steps = [], denied = [];
  let lastPoll = 0;
  while (!chat.ended && Date.now() - t0 < 480000) {
    const runs = (await req(port, "/api/runs")).json || [];
    const r = runs.find((x) => x.id === runId);
    const g = await jobsOf(port), now = Date.now();
    const run = g.live.find((j) => j.id === runId), kids = g.live.filter((j) => j.parent === runId);
    if (r && r.pending && r.pending.length) {
      if (run && run.waiting > 0) sawWaiting++;
      for (const p of r.pending) {
        let perm = null;
        for (const end = Date.now() + 3000; !perm && Date.now() < end; await sleep(100)) perm = chat.list.find((e) => e.t === "perm" && e.req === p.req);
        const cmd = String((perm && perm.detail && perm.detail.cmd) || "").trim();
        const ok = p.kind === "perm" && (p.tool === "Bash" || p.tool === "PowerShell") && LONG_CMDS.test(cmd);
        const a = await req(port, `/api/runs/${runId}/answer`, { method: "POST", body: { req: p.req, decision: ok ? "allow" : "deny" } });
        if (!ok) { denied.push(`${p.tool}: ${cmd || p.summary}`); console.log(`  ${secs(t0)} DENIED ${p.tool}: ${cmd || p.summary}`); }
        else if (a.json && a.json.ok) { approved++; console.log(`  ${secs(t0)} approved ${p.tool}: ${cmd}`); }
      }
      await sleep(1500);
      const after = (await jobsOf(port)).live.find((j) => j.id === runId);
      if (after && after.waiting === 0) resumed++;
      continue;
    }
    if (run) {
      maxKids = Math.max(maxKids, kids.length);
      const c = kids[0];
      if (c) {
        if (c.step && c.step !== steps[steps.length - 1]) steps.push(c.step);
        if (c.status === "running" && (run.tool === "Agent" || run.tool === "Task" || !run.tool)) waitingOnAgent = true;
        for (const j of [run, c]) if (j.status === "running" && j.waiting === 0) { const q = (now - j.lastOut) / 1000; if (q >= g.stall.bad) red = true; else if (q >= g.stall.warn) amber = true; }
        if (c.status === "running") {
          if (!same || same.at !== c.lastOut) same = { at: c.lastOut, since: now };
          longest = Math.max(longest, now - same.since);
        }
        if (now - lastPoll > 20000) { lastPoll = now; console.log(`  ${secs(t0)} run:${run.status}${run.tool ? " in " + run.tool : ""} | ${c.name}:${c.status} step "${c.step}" quiet ${Math.round((now - c.lastOut) / 1000)}s`); }
      }
    }
    await sleep(5000);
  }
  if (!chat.ended) { await req(port, `/api/runs/${runId}/stop`, { method: "POST", body: {} }); for (const end = Date.now() + 10000; !chat.ended && Date.now() < end; await sleep(200)) {} }
  await sleep(1000);
  const g = await jobsOf(port), h = g.history.find((x) => x.id === runId);
  await test("live-long: only the three expected shell commands asked for permission (anything else was denied)", () => assert.deepStrictEqual(denied, []));
  await test("live-long: a permission prompt shows as waiting, and the run carries on after the answer", () => { assert.ok(approved >= 1, "no prompt came"); assert.ok(sawWaiting >= 1, "waiting never showed"); assert.ok(resumed >= 1, "waiting never cleared"); });
  await test("live-long: the subagent's long shell call makes no extra row", () => assert.strictEqual(maxKids, 1));
  await test("live-long: the subagent's step follows task_progress", () => { console.log(`  steps: ${JSON.stringify(steps)}`); assert.ok(steps.length >= 2, "fewer than 2 steps"); });
  await test("live-long: the parent says it waits on its agent; the quiet agent goes amber after 3 min, never red", () => {
    assert.ok(waitingOnAgent);
    assert.ok(!red, "a row went red");
    if (longest >= 185000) assert.ok(amber, "quiet for 3 min+ but never amber");
    console.log(`  amber seen: ${amber}`);
  });
  await test("live-long: the 30 s Agent heartbeats don't count as output (the child stayed quiet for 120 s+)", () => assert.ok(longest >= 120000, `longest quiet stretch ${Math.round(longest / 1000)} s`));
  await test("live-long: the subagent's result is its report, not the hand-back frame", () => {
    assert.ok(h, "no history item");
    const a = h.agents.find((x) => x.name === "Slowpoke") || h.agents[0];
    assert.ok(a && /FINISHED/.test(a.result) && !framed(a.result), a && a.result);
  });
  console.log(`  took ${secs(t0)}`);
}

process.on("exit", () => { for (const c of servers) { try { c.kill(); } catch {} } });
(async () => {
  const mode = argv[0] || "--unit", port = Number(argv[1]);
  const LIVE = { "--council": councilTest, "--live": liveTest, "--live-long": liveLongTest };
  if (!["--unit", "--server", "--soak"].includes(mode) && !(LIVE[mode] && port > 0)) {
    console.log("usage: node test/jobs-test.js [--server | --soak | --council <port> | --live <port> | --live-long <port>]");
    process.exit(2);
  }
  // Real runs only go to a debug instance (HIVE_ACTIVITY_DEBUG=1, which the app never sets), never the app on 4747.
  if (LIVE[mode]) {
    const g = port === 4747 ? null : await jobsOf(port).catch(() => null);
    if (!g || !g.debug) { console.log(`refused: port ${port} isn't a debug instance (start one with HIVE_ACTIVITY_DEBUG=1 on a spare port such as 4797; never the app on 4747)`); process.exit(2); }
  }
  fs.mkdirSync(TMP, { recursive: true });
  try {
    if (mode === "--unit") await unit();
    if (mode === "--server") await serverTests().catch((e) => { failed++; console.log("FAIL server tests:", e && e.message || e); });
    if (mode === "--soak") await soak().catch((e) => { failed++; console.log("FAIL soak:", e && e.message || e); });
    if (LIVE[mode]) await LIVE[mode](port).catch((e) => { failed++; console.log(`FAIL ${mode}:`, e && e.message || e); });
  } finally {
    for (const c of servers) { try { c.kill(); } catch {} }
    await sleep(servers.size ? 500 : 0);
    try { fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.log("  couldn't remove", TMP + ":", e.message); }
  }
  console.log(`${failed ? "FAILED" : "PASSED"}: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
