// Tests for the Council's seats (council.js, council-seats.json). Free: no Claude runs (a fake runClaude stands in).
//   node test/council-test.js      (under 2 s; api-test.js runs it through "unit" in test/extra-routes.json)
// Scratch brains go in the gitignored app\.research folder and are removed at the end.
// Verified 2026-10-13.
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const APP = path.resolve(__dirname, "..");
// The page: index.html plus its script public/app.js (moved out of index.html in the 2026-10-13 refactor).
const page = () => ["index.html", "app.js"].map((f) => fs.readFileSync(path.join(APP, "public", f), "utf8")).join("\n");
const COUNCIL = path.join(APP, "council.js");
const ROSTER = path.join(APP, "council-seats.json");
const TMP = path.join(APP, ".research", "council-unit-" + process.pid);
const CLASSIC = ["believer", "skeptic", "investor"];
let passed = 0, failed = 0, nb = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("PASS", name); }
  catch (e) { failed++; console.log("FAIL", name + ":", e && e.message || e); }
}
const realRoster = () => JSON.parse(fs.readFileSync(ROSTER, "utf8"));
const newBrain = () => { const d = path.join(TMP, "brain" + ++nb); fs.mkdirSync(d, { recursive: true }); return d; };

// A fake response: records the status, JSON body or stream events; emitClose() acts like the page going away.
function fakeRes() {
  const res = { code: 0, body: null, events: [], ended: false, destroyed: false, headers: null, closers: [], afterClose: 0 };
  res.writeHead = (code, h) => { res.code = code; res.headers = h; };
  res.write = (s) => { if (res.destroyed) res.afterClose++; for (const m of String(s).matchAll(/^data: (.+)$/gm)) res.events.push(JSON.parse(m[1])); return true; };
  res.end = () => { if (res.ended) return; res.ended = true; res.closers.forEach((f) => f()); };
  res.on = (ev, f) => { if (ev === "close") res.closers.push(f); return res; };
  res.emitClose = () => { res.destroyed = true; res.closers.forEach((f) => f()); };
  return res;
}
// The council module on a fake ctx. mode for the fake runClaude: "ok" | "spawnError" | "hang".
function mk(opts = {}) {
  const runs = [], stops = [], jobs = [];
  const o = { mode: "ok", ...opts };
  const ctx = {
    BRAIN: o.brain || newBrain(), APP_DIR: o.appDir || APP, LITE: !!o.lite,
    json: (res, code, b) => { res.code = code; res.body = b; },
    body: async (req) => req.body || {},
    sse: (res) => { res.writeHead(200, { "Content-Type": "text/event-stream" }); return (obj) => res.write("data: " + JSON.stringify(obj) + "\n\n"); },
    simplify: (ev) => (ev.type === "result" ? { t: "result", text: ev.result, error: !!ev.is_error, cost: 0.01 } : ev.type === "system" ? { t: "session", id: ev.session_id } : null),
    trk: (fn, ...a) => { jobs.push([fn, ...a]); return fn === "begin" ? "job-" + jobs.length : null; },
    runClaude: (opt) => {
      const id = "run-" + (runs.length + 1), r = { id, opts: opt, ended: false };
      runs.push(r);
      const finish = (code, err) => { if (r.ended && o.mode !== "spawnError") return; r.ended = true; opt.onEnd && opt.onEnd(code, err); };
      r.finish = finish;
      if (o.mode === "ok") setImmediate(() => {
        opt.onEvent({ type: "system", subtype: "init", session_id: "s-" + id });
        opt.onEvent({ type: "result", result: (o.answer || "ANSWER ") + String(opt.prompt).slice(0, 20) });
        finish(0, "");
      });
      else if (o.mode === "spawnError") setImmediate(() => { finish(-1, "spawn ENOENT"); finish(-2, ""); });
      return id;
    },
    stopRun: (id, why) => { stops.push([id, why]); const r = runs.find((x) => x.id === id); if (r && !r.ended) setImmediate(() => r.finish(1, "killed")); return true; },
  };
  delete require.cache[require.resolve(COUNCIL)];
  const mod = require(COUNCIL)(ctx);
  const call = async (method, p, b) => { const res = fakeRes(); await mod.route(p, { method, body: b }, res); return res; };
  return { mod, ctx, runs, stops, jobs, call, T: mod._test };
}

async function unit() {
  const { loadRoster, FALLBACK } = require(COUNCIL);

  await test("1. the real roster loads: 13 seats, the classic three by default, no error", () => {
    const r = loadRoster(ROSTER), k = mk();
    assert.strictEqual(r.seats.length, 13);
    assert.deepStrictEqual(r.default, CLASSIC);
    assert.strictEqual(k.T.rosterError, "");
  });

  await test("1. default ids are KIT mascots in the page; no other seat id is a KIT key", () => {
    const html = page();
    const kitSrc = html.slice(html.indexOf("const KIT = {"), html.indexOf("};", html.indexOf("const KIT = {")));
    const kit = new Set([...kitSrc.matchAll(/^\s{2}(\w+):\{/gm)].map((m) => m[1]));
    assert.ok(kit.has("believer") && kit.has("builder"), "KIT wasn't parsed");
    const r = realRoster();
    for (const id of r.default) assert.ok(kit.has(id), id + " should reuse its KIT mascot");
    for (const s of r.seats) if (!r.default.includes(s.id)) assert.ok(!kit.has(s.id), s.id + " is already a KIT key (it would show another agent's mascot)");
  });

  await test("1. FALLBACK holds the real file's classic three, verbatim", () => {
    const r = realRoster();
    assert.deepStrictEqual(FALLBACK.seats, r.seats.filter((s) => CLASSIC.includes(s.id)));
  });

  await test("1b. every validation rule rejects a bad value", () => {
    const muts = {
      "icon @@": (r) => (r.seats[3].icon = "@@"), "cheer MAYBE": (r) => (r.seats[3].cheer = ["MAYBE"]), "group nope": (r) => (r.seats[3].group = "nope"),
      "empty blurb": (r) => (r.seats[3].blurb = ""), "liteMax 8": (r) => (r.liteMax = 8), "liteMax > max": (r) => { r.liteMax = 7; r.max = 6; },
      "no words": (r) => delete r.words, "words below max": (r) => (r.words = [[3, 250], [5, 200]]), "tools all": (r) => (r.seats[3].tools = "all"),
      "17-char name": (r) => (r.seats[3].name = "x".repeat(17)), "repeated id": (r) => (r.seats[4].id = r.seats[3].id), "alias to unknown": (r) => (r.aliases.zz = "nobody"),
      "bad plate": (r) => (r.seats[3].plate = "toolongplate"), "bad accent": (r) => (r.seats[3].accent = "red"), "bad callsign": (r) => (r.seats[3].callsign = "the player"),
      "id judge": (r) => (r.seats[3].id = "judge"), "lookY string": (r) => (r.seats[3].lookY = "no"), "default too long": (r) => (r.default = ["player", "economist", "bootstrapper", "engineer", "competitor", "future"]),
      "long brief": (r) => (r.seats[3].brief = "x".repeat(1201)), "no role": (r) => delete r.seats[3].role,
    };
    const dir = path.join(TMP, "mut"); fs.mkdirSync(dir, { recursive: true });
    for (const [name, mut] of Object.entries(muts)) {
      const r = realRoster(); mut(r);
      const f = path.join(dir, "council-seats.json"); fs.writeFileSync(f, JSON.stringify(r));
      assert.throws(() => loadRoster(f), undefined, name + " wasn't rejected");
    }
  });

  await test("1b. a broken roster falls back to the classic three: GET says so, max 3", async () => {
    const dir = path.join(TMP, "broken"); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "council-seats.json"), fs.readFileSync(ROSTER, "utf8").replace('"min": 1,', '"min": 1'));
    const origErr = console.error; console.error = () => {};
    let k; try { k = mk({ appDir: dir }); } finally { console.error = origErr; }
    const res = await k.call("GET", "/api/council/seats");
    assert.strictEqual(res.code, 200);
    assert.strictEqual(res.body.roster.length, 3);
    assert.strictEqual(res.body.max, 3);
    assert.ok(/council-seats\.json/.test(res.body.error || ""), "no error in the answer");
    assert.deepStrictEqual(res.body.seats, CLASSIC);
  });

  await test("2. normalize: aliases, case, repeats and unknown ids; clamped to 7 (Lite 5)", () => {
    const k = mk();
    assert.deepStrictEqual(k.T.normalize(["Playtester", "future-you", "player", "nope"]).map((s) => s.id), ["player", "future"]);
    assert.deepStrictEqual(k.T.normalize("econ, builder").map((s) => s.id), ["economist", "engineer"]);
    assert.deepStrictEqual(k.T.normalize(["constructor", "__proto__", "toString"]).map((s) => s.id), []);
    const nine = ["believer", "skeptic", "investor", "player", "economist", "bootstrapper", "engineer", "competitor", "future"];
    assert.strictEqual(k.T.normalize(nine).length, 7);
    assert.strictEqual(mk({ lite: true }).T.normalize(nine).length, 5);
  });

  await test("8. seat settings: POST saves app-settings/council.json, GET returns it; corrupt = classic; [] = 400", async () => {
    const k = mk();
    let res = await k.call("POST", "/api/council/seats", { seats: ["skeptic", "playtester"] });
    assert.deepStrictEqual([res.code, res.body.seats], [200, ["skeptic", "player"]]);
    const f = path.join(k.ctx.BRAIN, "app-settings", "council.json");
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(f, "utf8")).seats, ["skeptic", "player"]);
    res = await k.call("GET", "/api/council/seats");
    assert.deepStrictEqual(res.body.seats, ["skeptic", "player"]);
    assert.ok(Array.isArray(res.body.roster) && res.body.roster.length === 13 && res.body.min === 1 && res.body.max === 7 && res.body.lite === false);
    assert.ok(!("brief" in res.body.roster[0]) && !("callsign" in res.body.roster[0]), "briefs stay on the server");
    fs.writeFileSync(f, "{ not json");
    assert.deepStrictEqual((await k.call("GET", "/api/council/seats")).body.seats, CLASSIC);
    fs.writeFileSync(f, JSON.stringify({ seats: ["nobody"] }));
    assert.deepStrictEqual((await k.call("GET", "/api/council/seats")).body.seats, CLASSIC);
    assert.strictEqual((await k.call("POST", "/api/council/seats", { seats: [] })).code, 400);
    assert.strictEqual((await k.call("POST", "/api/council/seats", { seats: ["nobody"] })).code, 400);
  });

  await test("8. Lite: a saved 7-seat set is clamped to 5", async () => {
    const brain = newBrain();
    fs.mkdirSync(path.join(brain, "app-settings"), { recursive: true });
    fs.writeFileSync(path.join(brain, "app-settings", "council.json"), JSON.stringify({ seats: ["player", "economist", "bootstrapper", "engineer", "competitor", "future", "remixer"] }));
    const res = await mk({ brain, lite: true }).call("GET", "/api/council/seats");
    assert.deepStrictEqual([res.body.seats.length, res.body.max, res.body.lite], [5, 5, true]);
  });

  // The old server.js council (before 2026-10-13), pasted verbatim: the classic three must not change by a byte.
  const OLD_COUNCIL = {
    believer: "You are the BELIEVER on an idea council. Make the strongest honest case that this idea works: who exactly buys it, the painful problem it solves, why now, how to reach the first 100 customers. Use what you know about the user from your recall context. Short headings and bullets, under 250 words. Do not use tools.",
    skeptic: "You are the SKEPTIC on an idea council. Attack the idea: competitors and substitutes, why people won't pay, build cost and risk, platform or legal risk, hidden assumptions. Rank the top 3 fatal risks first. Short headings and bullets, under 250 words. Do not use tools.",
    investor: "You are the INVESTOR on an idea council. Size the opportunity: rough market size with reasoning, business model and pricing, moat, what it becomes in 3-5 years, and the milestone that would make you invest. Short headings and bullets, under 250 words. Do not use tools.",
  };
  const oldJudgePrompt = (idea, a) => `You are the JUDGE of an idea council. Weigh the three views fairly and decide whether the user should pursue this idea.
First line exactly: VERDICT: PURSUE|PIVOT|PASS | SCORE: N/10
Then "## Why", "## What would change my mind", "## Next 3 steps". Under 300 words. Do not use tools. If the user pushes back later, re-judge honestly and restate the VERDICT line first.

IDEA: ${idea}

## Believer
${a.believer}

## Skeptic
${a.skeptic}

## Investor
${a.investor}`;

  await test("3. the classic seat prompts are byte-identical to the old ones", () => {
    const k = mk(), by = Object.fromEntries(k.T.roster.seats.map((s) => [s.id, s]));
    for (const id of CLASSIC) assert.strictEqual(k.T.seatPrompt(by[id], 3), OLD_COUNCIL[id], id);
    assert.ok(/under 200 words/.test(k.T.seatPrompt(by.player, 5)) && /under 150 words/.test(k.T.seatPrompt(by.player, 7)));
    assert.ok(/You may use Read, Grep and Glob/.test(k.T.seatPrompt(by.engineer, 2)) && !/Do not use tools/.test(k.T.seatPrompt(by.engineer, 2)));
  });

  await test("4. the classic judge prompt is byte-identical; other sets name their angles", () => {
    const k = mk(), by = Object.fromEntries(k.T.roster.seats.map((s) => [s.id, s]));
    const a = { believer: "B says", skeptic: "S says", investor: "I says", player: "P says", competitor: "C says" };
    assert.strictEqual(k.T.judgePrompt("an idea", CLASSIC.map((id) => by[id]), a), oldJudgePrompt("an idea", a));
    const two = k.T.judgePrompt("an idea", [by.player, by.competitor], a);
    assert.ok(two.includes("Weigh the two views") && two.includes("Each seat argues from one angle") && two.includes("## Playtester\nP says\n\n## Competitor\nC says"));
    assert.ok(k.T.judgePrompt("x", [by.player], a).includes("Weigh the view fairly"));
  });

  await test("5. every seat's session stays out of Chats and is labelled Council member", () => {
    const html = page(), srv = fs.readFileSync(path.join(APP, "server.js"), "utf8");
    const search = fs.readFileSync(path.join(APP, "search.js"), "utf8");
    const res = {
      "page HIDE": new RegExp(/const HIDE = \/(.+)\/;/.exec(html)[1]),
      "server.js projects filter": new RegExp(/filter\(\(m\) => m && !\/(.+?)\/\.test\(m\.title\)\)/.exec(srv)[1]),
      "search.js HIDE": new RegExp(/const HIDE = \/(.+)\/;/.exec(search)[1]),
      "server.js JOB_LABEL": new RegExp(/const JOB_LABEL = \[\[\/(.+?)\/, "Council member"\]/.exec(srv)[1]),
    };
    const k = mk();
    for (const s of k.T.roster.seats) {
      const title = k.T.seatPrompt(s, 7).replace(/\s+/g, " ").slice(0, 90);
      for (const [n, re] of Object.entries(res)) assert.ok(re.test(title), `${s.id} isn't matched by ${n}`);
    }
    assert.ok(!res["server.js JOB_LABEL"].test("You are the JUDGE of an idea council."), "the Judge keeps its own label");
  });

  await test("6. a 2-seat council: events in order, run options, activity rows, saved file, never overwritten, busy", async () => {
    const k = mk();
    const p = k.call("POST", "/api/council", { idea: "A tiny tycoon", seats: ["player", "engineer"] });
    await Promise.resolve();
    assert.strictEqual(k.mod.busy(), 1, "busy while running");
    const res = await p; await ended(res);
    assert.strictEqual(k.mod.busy(), 0, "not busy after");
    const order = res.events.filter((e) => e.t !== "delta" && e.t !== "judgeSession").map((e) => e.t === "done" ? "done:" + e.agent : e.t);
    assert.deepStrictEqual(order.slice(0, 1), ["seats"]);
    assert.deepStrictEqual(order.slice(1, 3).sort(), ["done:engineer", "done:player"]);
    assert.deepStrictEqual(order.slice(3), ["done:judge", "saved", "end"]);
    assert.deepStrictEqual(res.events[0].seats.map((s) => s.id), ["player", "engineer"]);
    assert.ok(Math.abs(res.events.find((e) => e.t === "end").cost - 0.03) < 1e-9, "end carries the summed cost");
    const [pl, en, ju] = k.runs.map((r) => r.opts);
    assert.deepStrictEqual([pl.tools, pl.mcp, pl.maxTurns, pl.mode, !!pl.lean], ["", false, 3, "read", false]);
    assert.deepStrictEqual([en.tools, en.mcp, en.maxTurns, en.mode], ["Read,Grep,Glob", false, 5, "read"]);
    assert.ok(/^You are the JUDGE/.test(ju.prompt));
    assert.deepStrictEqual([ju.tools, ju.mcp, ju.maxTurns], ["", false, 3]);
    assert.deepStrictEqual(k.jobs[0].slice(0, 1).concat(k.jobs[0][1].kind), ["begin", "council"]);
    assert.ok(k.runs.every((r) => r.opts.job && r.opts.job.parent === "job-1"), "members and judge are the council's children");
    assert.deepStrictEqual([pl.job.kind, pl.job.icon, ju.job.kind], ["council-member", "player", "judge"]);
    const endJob = k.jobs.find((j) => j[0] === "end");
    assert.deepStrictEqual([endJob[1], endJob[2].ok], ["job-1", true]);
    const file = res.events.find((e) => e.t === "saved").file, text = fs.readFileSync(file, "utf8");
    assert.ok(/_a-tiny-tycoon\.md$/.test(file), file);
    assert.ok(text.startsWith("# Council: A tiny tycoon\n\n## Playtester\n") && text.indexOf("## Engineer") > text.indexOf("## Playtester") && text.indexOf("## Judge") > text.indexOf("## Engineer"));
    assert.ok(!text.includes("## Earlier"));
    const res2 = await k.call("POST", "/api/council", { idea: "A tiny tycoon", seats: ["player", "engineer"] }); await ended(res2);
    assert.ok(/_a-tiny-tycoon-2\.md$/.test(res2.events.find((e) => e.t === "saved").file), "the second debate got -2");
    assert.strictEqual(fs.readFileSync(file, "utf8"), text, "the first debate is untouched");
  });

  await test("6. the classic three save exactly the old file format", async () => {
    const k = mk();
    const res = await k.call("POST", "/api/council", { idea: "Old format", seats: CLASSIC }); await ended(res);
    const text = fs.readFileSync(res.events.find((e) => e.t === "saved").file, "utf8");
    const a = (id) => "ANSWER " + OLD_COUNCIL[id].slice(0, 20);
    assert.strictEqual(text, `# Council: Old format\n\n## Believer\n${a("believer")}\n\n## Skeptic\n${a("skeptic")}\n\n## Investor\n${a("investor")}\n\n## Judge\nANSWER You are the JUDGE of\n`);
  });

  await test("7. Lite: lean Sonnet runs, no tools except the Engineer, judge 1 turn", async () => {
    const k = mk({ lite: true });
    const res = await k.call("POST", "/api/council", { idea: "Lite idea", seats: ["skeptic", "engineer"] }); await ended(res);
    const [sk, en, ju] = k.runs.map((r) => r.opts);
    assert.ok(k.runs.every((r) => r.opts.lean === true && r.opts.model === "sonnet" && r.opts.mcp === undefined));
    assert.deepStrictEqual([sk.tools, sk.maxTurns, en.tools, en.maxTurns, ju.tools, ju.maxTurns], ["", 2, "Read,Grep,Glob", 4, "", 1]);
  });

  await test("9. an empty idea is 400 (no runs); a missing seat list uses the saved default", async () => {
    const k = mk();
    const r1 = await k.call("POST", "/api/council", { idea: "   " });
    assert.deepStrictEqual([r1.code, k.runs.length], [400, 0]);
    await k.call("POST", "/api/council/seats", { seats: ["competitor"] });
    const r2 = await k.call("POST", "/api/council", { idea: "No seats sent" }); await ended(r2);
    assert.deepStrictEqual(r2.events[0].seats.map((s) => s.id), ["competitor"]);
    const r3 = await k.call("POST", "/api/council", { idea: "Unknown seats", seats: ["nobody"] }); await ended(r3);
    assert.deepStrictEqual(r3.events[0].seats.map((s) => s.id), ["competitor"], "nothing known: the saved default");
  });

  await test("11. a spawn error (onEnd twice): one done each, one saved, one end, one file, not busy", async () => {
    const k = mk({ mode: "spawnError" });
    const res = await k.call("POST", "/api/council", { idea: "Spawn fails", seats: ["player", "artist"] }); await ended(res);
    await new Promise((r) => setTimeout(r, 20));
    const dones = res.events.filter((e) => e.t === "done");
    assert.deepStrictEqual(dones.map((e) => e.agent).sort(), ["artist", "judge", "player"]);
    assert.ok(dones.every((e) => e.error === true));
    assert.deepStrictEqual([res.events.filter((e) => e.t === "saved").length, res.events.filter((e) => e.t === "end").length], [1, 1]);
    assert.deepStrictEqual(fs.readdirSync(path.join(k.ctx.BRAIN, "council")).length, 1);
    assert.strictEqual(k.mod.busy(), 0);
  });

  await test("12. the page closes mid-council: seats stopped, no Judge, answers so far saved, nothing written after", async () => {
    const k = mk({ mode: "hang" });
    const res = await k.call("POST", "/api/council", { idea: "Closed early", seats: ["player", "marketer", "remixer"] });
    assert.strictEqual(k.runs.length, 3);
    const before = res.events.length;
    res.emitClose();
    await ended(res);
    assert.deepStrictEqual(k.stops.map((s) => s[0]).sort(), ["run-1", "run-2", "run-3"]);
    assert.ok(k.stops.every((s) => s[1] === "user"));
    assert.strictEqual(k.runs.length, 3, "no Judge run started");
    assert.strictEqual(res.afterClose, 0, "nothing was written to the closed response");
    assert.strictEqual(res.events.length, before);
    assert.ok(k.jobs.some((j) => j[0] === "stopping" && j[2] === "user"), "the council row shows it was stopped");
    const f = fs.readdirSync(path.join(k.ctx.BRAIN, "council"));
    const text = fs.readFileSync(path.join(k.ctx.BRAIN, "council", f[0]), "utf8");
    assert.ok(text.includes("## Playtester") && text.includes("## Marketer") && text.includes("## Remixer"));
    assert.ok(text.includes("## Judge\n(Stopped: the page closed before the Judge ruled.)"));
    assert.strictEqual(k.mod.busy(), 0);
    const more = await k.call("POST", "/api/council/more", { file: f[0], seats: ["artist"] });
    assert.strictEqual(more.code, 410, "a stopped debate isn't kept for Swap and Hear");
  });

  await test("10. Hear one more seat, twice, then Swap: 2 runs each, the file keeps every note, seat and ruling", async () => {
    const k = mk();
    const r0 = await k.call("POST", "/api/council", { idea: "Hourly obby", seats: ["player", "engineer"] }); await ended(r0);
    const name = path.basename(r0.events.find((e) => e.t === "saved").file), file = path.join(k.ctx.BRAIN, "council", name);
    let n = k.runs.length;
    const h1 = await k.call("POST", "/api/council/more", { file: name, seats: ["competitor"] }); await ended(h1);
    assert.strictEqual(k.runs.length - n, 2, "Hear = 2 runs");
    assert.deepStrictEqual(h1.events[0], { t: "seats", seats: h1.events[0].seats, add: true });
    assert.deepStrictEqual(h1.events[0].seats.map((s) => s.id), ["competitor"]);
    const j1 = k.runs[k.runs.length - 1].opts.prompt;
    assert.ok(j1.includes("Earlier, before Competitor joined, the council ruled: ANSWER You are the JUDGE of") && j1.includes("Weigh the three views"));
    assert.ok(/^You are the COMPETITOR/.test(k.runs[n].opts.prompt) && /under 250 words/.test(k.runs[n].opts.prompt), "the new seat's word budget follows the new size");
    let t = fs.readFileSync(file, "utf8");
    assert.ok(t.includes("_Re-judged after Competitor joined. Before: ANSWER You are the JUDGE of_"));
    assert.ok(t.indexOf("## Competitor") > t.indexOf("## Engineer") && t.indexOf("## Judge\n") > t.indexOf("## Competitor"));
    assert.ok(t.indexOf("## Earlier in this debate\n### Judge, ruling 1\n") > t.indexOf("## Judge\n"));
    const h2 = await k.call("POST", "/api/council/more", { file: name, seats: ["artist"] }); await ended(h2);
    t = fs.readFileSync(file, "utf8");
    assert.ok(t.includes("_Re-judged after Competitor joined.") && t.includes("_Re-judged after Artist joined.") && t.includes("### Judge, ruling 1") && t.includes("### Judge, ruling 2"));
    n = k.runs.length;
    const sw = await k.call("POST", "/api/council/more", { file: name, seats: ["marketer"], swap: "player" }); await ended(sw);
    assert.strictEqual(k.runs.length - n, 2, "Swap = 2 runs");
    assert.strictEqual(sw.events[0].swap, "player");
    const js = k.runs[k.runs.length - 1].opts.prompt;
    assert.ok(!js.includes("## Playtester") && js.includes("## Marketer") && js.includes("before Marketer replaced Playtester"));
    t = fs.readFileSync(file, "utf8");
    assert.ok(t.startsWith("# Council: Hourly obby\n\n_Re-judged after Competitor joined."));
    const order = [...t.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    assert.deepStrictEqual(order, ["Marketer", "Engineer", "Competitor", "Artist", "Judge", "Earlier in this debate"]);
    assert.ok(t.includes("### Playtester (replaced)\nANSWER You are the PLAYTEST\n") && t.includes("### Judge, ruling 3"));
    assert.ok(t.includes("_Re-judged after Marketer replaced Playtester."));
  });

  await test("10. at the maximum Hear is refused and Swap still works; bad requests are refused before any run", async () => {
    const k = mk();
    const seven = ["believer", "skeptic", "investor", "player", "economist", "bootstrapper", "engineer"];
    const r0 = await k.call("POST", "/api/council", { idea: "Full house", seats: seven }); await ended(r0);
    const name = path.basename(r0.events.find((e) => e.t === "saved").file), n = k.runs.length;
    const hear = await k.call("POST", "/api/council/more", { file: name, seats: ["future"] });
    assert.deepStrictEqual([hear.code, /full/.test(hear.body.error)], [400, true]);
    assert.strictEqual((await k.call("POST", "/api/council/more", { file: name, seats: ["future"], swap: "nobody" })).code, 400);
    assert.strictEqual((await k.call("POST", "/api/council/more", { file: name, seats: ["skeptic"], swap: "believer" })).code, 400, "a seat already sitting");
    assert.strictEqual((await k.call("POST", "/api/council/more", { file: "../../x.md", seats: ["future"] })).code, 410);
    assert.strictEqual((await k.call("POST", "/api/council/more", { file: "2026-01-01_nothing.md", seats: ["future"] })).code, 410);
    assert.strictEqual(k.runs.length, n, "no run for a refusal");
    const sw = await k.call("POST", "/api/council/more", { file: name, seats: ["future"], swap: "skeptic" }); await ended(sw);
    assert.strictEqual(sw.code, 200);
    assert.strictEqual(k.runs.length - n, 2);
  });

  await test("10. two calls at once: 200 then 409; after 10 newer debates the first one is gone (410)", async () => {
    const k = mk();
    const r0 = await k.call("POST", "/api/council", { idea: "First", seats: ["player"] }); await ended(r0);
    const name = path.basename(r0.events.find((e) => e.t === "saved").file);
    const [a, b] = await Promise.all([k.call("POST", "/api/council/more", { file: name, seats: ["artist"] }), k.call("POST", "/api/council/more", { file: name, seats: ["remixer"] })]);
    assert.deepStrictEqual([a.code, b.code], [200, 409]);
    await ended(a);
    for (let i = 0; i < 10; i++) { const r = await k.call("POST", "/api/council", { idea: "Newer " + i, seats: ["player"] }); await ended(r); }
    assert.strictEqual((await k.call("POST", "/api/council/more", { file: name, seats: ["future"] })).code, 410);
    assert.strictEqual(k.T.debates.size, 10);
  });
}
// Resolves once the council's response has ended (or fails after 2 s).
async function ended(res) {
  for (const t = Date.now(); !res.ended; await new Promise((r) => setImmediate(r))) if (Date.now() - t > 2000) throw new Error("the council never ended");
}

(async () => {
  try { await unit(); }
  catch (e) { failed++; console.log("FAIL test script:", e && e.stack || e); }
  finally { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} }
  console.log(`${failed ? "FAILED" : "PASSED"}: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
