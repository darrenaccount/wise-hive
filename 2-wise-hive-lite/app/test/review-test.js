// review.js unit test (2026-10-13): the Review panel's rounds. Working's log (autopilot\working.json) keeps only its newest
// 2000 entries, so review.js also reads the round cards (working\<slug>\rounds\<n>\card.json) for rounds the log no
// longer has. Checks: rounds the log has come from the log exactly as before; rounds it lost come from their cards
// (Studio-only and git projects, where a card round also claims its "Teamwright-Round: N" commit instead of leaving
// it a loose commit); a card for another folder with the same name, and rounds already reviewed, stay out.
// Fake ctx, temp folders (tiny), a scratch git repo; no Claude.
//   node test/review-test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "wh-review-")); // outside any git repo, so a plain folder isn't "git"
const BRAIN = path.join(TMP, "brain"), WORK = path.join(BRAIN, "working");
const STUDIO = path.join(TMP, "Studio Game"), OTHER = path.join(TMP, "elsewhere", "Studio Game"), GIT = path.join(TMP, "Git Game");
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log("PASS", name); } catch (e) { failed++; console.log("FAIL", name + ":", e && e.stack || e); } }
const write = (f, data) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof data === "string" ? data : JSON.stringify(data, null, 1)); };
const iso = (t) => new Date(t).toISOString();
const card = (slug, n, o) => write(path.join(WORK, slug, "rounds", String(n), "card.json"), { v: 1, n, runId: null, chatId: null, title: `Round ${n} card title`, focus: "feature", why: `card why ${n}`,
  outcome: "done", outcomeText: "completed: did it", summary: `card summary ${n}`, changed: [], undo: "", next: [], captions: {}, images: [], commits: [], ...o });
const logHead = (slug, name, dir) => write(path.join(WORK, slug, "log.md"), `# Working log: ${name}\n\nProject folder: ${dir}\n\n`);

const ctx = { BRAIN, read: (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } },
  json: (res, code, body) => { res.code = code; res.body = body; }, body: async (req) => req.body || {}, broadcast: () => {} };
const mod = require("../review.js")(ctx);
const get = async (p) => { const res = {}; const handled = await mod.route(p, { method: "GET", headers: {} }, res); assert.ok(handled, "not handled: " + p); return res; };

(async () => {
  fs.mkdirSync(STUDIO, { recursive: true }); fs.mkdirSync(OTHER, { recursive: true });
  const T = Date.now() - 5 * 3600e3;
  // The log: rounds 5 and 6 of Studio Game, with what only the log says (the plan line carries the style).
  const log = [
    { type: "system", at: iso(T), text: `Started. Goal: polish\nProject: Studio Game (${STUDIO})` },
    { type: "plan", n: 5, title: "Shop polish", focus: "polish", at: iso(T + 1000), text: "log why 5 · Style: Cosy (your pick)" },
    { type: "start", n: 5, title: "Shop polish", focus: "polish", at: iso(T + 2000), text: "Started round 5: Shop polish", chatId: "11111111-1111-4111-8111-111111111111" },
    { type: "result", n: 5, at: iso(T + 60000), text: "log summary 5" },
    { type: "plan", n: 6, title: "Lobby lights", focus: "content", at: iso(T + 70000), text: "log why 6" },
    { type: "start", n: 6, title: "Lobby lights", focus: "content", at: iso(T + 71000), text: "Started round 6" },
    { type: "error", n: 6, at: iso(T + 90000), text: "Round 6 failed: it ended without a result. Resting 2 minutes." },
  ];
  write(path.join(BRAIN, "autopilot", "working.json"), { mode: "working", active: false, project: { dir: STUDIO, name: "Studio Game" }, log });
  logHead("studio-game", "Studio Game", STUDIO);

  await test("rounds the log has come from the log, exactly as before (their cards don't change them)", async () => {
    card("studio-game", 5, { project: { name: "Studio Game", dir: STUDIO }, startedAt: iso(T + 2000), endedAt: iso(T + 60000), why: "card why that must not show" });
    const r = await get("/api/review/studio-game");
    assert.strictEqual(r.code, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.git, false);
    assert.deepStrictEqual(r.body.rounds.map((x) => x.id), ["r5", "r6"]);
    const r5 = r.body.rounds[0], r6 = r.body.rounds[1];
    assert.deepStrictEqual({ title: r5.title, focus: r5.focus, why: r5.why, summary: r5.summary, outcome: r5.outcome, at: r5.at, chatId: r5.chatId },
      { title: "Shop polish", focus: "polish", why: "log why 5 · Style: Cosy (your pick)", summary: "log summary 5", outcome: "done", at: T + 60000, chatId: "11111111-1111-4111-8111-111111111111" });
    assert.deepStrictEqual({ outcome: r6.outcome, summary: r6.summary }, { outcome: "failed", summary: "Round 6 failed: it ended without a result. Resting 2 minutes." });
  });

  await test("rounds the log lost come from their cards; another folder's card and reviewed rounds stay out", async () => {
    card("studio-game", 2, { project: { name: "Studio Game", dir: STUDIO }, startedAt: iso(T - 7200e3), endedAt: iso(T - 7100e3), chatId: "22222222-2222-4222-8222-222222222222" });
    card("studio-game", 3, { project: { name: "Studio Game", dir: STUDIO }, startedAt: iso(T - 3600e3), endedAt: iso(T - 3500e3), outcome: "failed", outcomeText: "failed: it ran too long", summary: "" });
    card("studio-game", 4, { project: { name: "Studio Game", dir: OTHER }, startedAt: iso(T - 1800e3), endedAt: iso(T - 1700e3) }); // same slug, other folder
    card("studio-game", 1, { project: { name: "Studio Game", dir: STUDIO }, startedAt: iso(T - 9000e3), endedAt: iso(T - 8900e3) });
    write(path.join(WORK, "studio-game", "review.json"), { rounds: { r1: { status: "seen", at: iso(T) } } });
    fs.mkdirSync(path.join(WORK, "studio-game", "rounds", "7~123"), { recursive: true }); // a card moved aside: not a round
    const r = await get("/api/review/studio-game");
    assert.deepStrictEqual(r.body.rounds.map((x) => x.id), ["r2", "r3", "r5", "r6"]);
    const [r2, r3] = r.body.rounds;
    assert.deepStrictEqual({ title: r2.title, focus: r2.focus, why: r2.why, summary: r2.summary, outcome: r2.outcome, at: r2.at, chatId: r2.chatId, running: r2.running },
      { title: "Round 2 card title", focus: "feature", why: "card why 2", summary: "card summary 2", outcome: "done", at: T - 7100e3, chatId: "22222222-2222-4222-8222-222222222222", running: false });
    assert.deepStrictEqual({ outcome: r3.outcome, summary: r3.summary }, { outcome: "failed", summary: "failed: it ran too long" });
    assert.strictEqual(r.body.count, 4);
  });

  await test("a git project: a round only its card knows claims its Teamwright-Round commit (not a loose commit)", async () => {
    fs.mkdirSync(GIT, { recursive: true });
    const g = (...a) => execFileSync("git", ["-C", GIT, "-c", "user.name=Test", "-c", "user.email=test@localhost", "-c", "commit.gpgsign=false", ...a], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).toString();
    g("init", "-q", "-b", "main");
    write(path.join(GIT, "a.txt"), "a\n"); g("add", "a.txt"); g("commit", "-q", "-m", "base");
    g("checkout", "-q", "-b", "teamwright/autowork");
    write(path.join(GIT, "b.txt"), "b\n"); g("add", "b.txt"); g("commit", "-q", "-m", "Add the shop sign\n\nTeamwright-Round: 8");
    const at = Number(g("log", "-1", "--format=%ct").trim()) * 1000;
    logHead("git-game", "Git Game", GIT);
    card("git-game", 8, { project: { name: "Git Game", dir: GIT }, title: "Shop sign", startedAt: iso(at - 20000), endedAt: iso(at + 20000) });
    const r = await get("/api/review/git-game");
    assert.strictEqual(r.code, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.git, true, JSON.stringify(r.body));
    assert.deepStrictEqual(r.body.rounds.map((x) => x.id), ["r8"], JSON.stringify(r.body.rounds));
    assert.strictEqual(r.body.rounds[0].title, "Shop sign");
    assert.deepStrictEqual(r.body.rounds[0].commits.map((c) => c.subject), ["Add the shop sign"]);
    assert.deepStrictEqual(r.body.rounds[0].files.map((f) => f.path), ["b.txt"]);
  });

  await test("the overview counts card rounds too", async () => {
    const res = {}; await mod.route("/api/review", { method: "GET", headers: {} }, res);
    const byslug = Object.fromEntries(res.body.projects.map((p) => [p.slug, p.count]));
    assert.deepStrictEqual(byslug, { "studio-game": 4, "git-game": 1 });
  });
})().catch((e) => { failed++; console.log("FAIL test script:", e && e.stack || e); }).finally(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  console.log(`${failed ? "FAILED" : "PASSED"}: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
});
