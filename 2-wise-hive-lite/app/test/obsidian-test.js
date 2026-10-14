// obsidian.js unit test (2026-10-13): path guard, the plugin copy, and the routes that refuse bad input. Never starts Claude.
//   node test/obsidian-test.js
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const BRAIN = fs.mkdtempSync(path.join(os.tmpdir(), "wh-obs-"));
const APP = path.join(BRAIN, "app");
fs.mkdirSync(path.join(APP, "obsidian-plugin"), { recursive: true });
fs.writeFileSync(path.join(APP, "obsidian-plugin", "main.js"), "// plugin v1");
fs.writeFileSync(path.join(APP, "obsidian-plugin", "manifest.json"), "{}");
fs.mkdirSync(path.join(BRAIN, ".obsidian"));
fs.mkdirSync(path.join(BRAIN, "memory"));
fs.writeFileSync(path.join(BRAIN, "memory", "a.md"), "# A");
fs.writeFileSync(path.join(BRAIN, "memory", "empty.md"), "   ");

const started = [];
const ctx = { BRAIN, APP_DIR: APP, PORT: 1, notify() {}, startChat: (o) => { started.push(o); return { id: "r1", events: [], done: false }; },
  json: (res, code, o) => { res.code = code; res.out = o; }, body: async (req) => req.payload };
const mod = require("../obsidian.js")(ctx);
const call = async (method, p, payload, qs) => { const res = {}; await mod.route(p, { method, payload }, res, new URL("http://x" + p + (qs || ""))); return res; };

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log("PASS", name); } catch (e) { fail++; console.log("FAIL", name + ":", e.message); } }

(async () => {
  const { vaultNote, safeName, syncPlugin } = mod._test;
  await t("vaultNote accepts brain notes", () => {
    assert.strictEqual(vaultNote("memory/a.md"), path.join(BRAIN, "memory", "a.md"));
    assert.strictEqual(vaultNote("/memory/a.md"), path.join(BRAIN, "memory", "a.md"));
  });
  await t("vaultNote refuses outside, dot folders, non-md", () => {
    for (const bad of ["../x.md", "..\\x.md", "C:\\Windows\\win.md", ".obsidian/app.md", "app/.git/x.md", "memory/a.txt", "", 5, "a".repeat(500) + ".md"])
      assert.strictEqual(vaultNote(bad), null, String(bad).slice(0, 30));
  });
  await t("safeName strips file-name characters", () => {
    assert.strictEqual(safeName('what is: a/b "c"?'), "what is a b c");
    assert.strictEqual(safeName(""), "Answer");
  });
  await t("syncPlugin copies the plugin into the vault and updates it", () => {
    syncPlugin();
    const dst = path.join(BRAIN, ".obsidian", "plugins", "wise-hive", "main.js");
    assert.strictEqual(fs.readFileSync(dst, "utf8"), "// plugin v1");
    fs.writeFileSync(path.join(APP, "obsidian-plugin", "main.js"), "// plugin v2"); syncPlugin();
    assert.strictEqual(fs.readFileSync(dst, "utf8"), "// plugin v2");
  });
  await t("status reports the vault and records the plugin", async () => {
    const r = await call("GET", "/api/obsidian/status", null, "?client=plugin&v=1.0.0");
    assert.strictEqual(r.code, 200); assert.strictEqual(r.out.vault, BRAIN); assert.ok(r.out.pluginSeen > 0); assert.strictEqual(r.out.pluginVersion, "1.0.0");
  });
  await t("ask refuses an empty question and a note outside the vault", async () => {
    assert.strictEqual((await call("POST", "/api/obsidian/ask", { file: "memory/a.md", question: " " })).code, 400);
    assert.strictEqual((await call("POST", "/api/obsidian/ask", { file: "../secret.md", question: "hi" })).code, 400);
    assert.strictEqual(started.length, 0);
  });
  await t("ask starts a read-only chat in the brain; a task may edit", async () => {
    const r = await call("POST", "/api/obsidian/ask", { file: "memory/a.md", question: "what is this?" });
    assert.strictEqual(r.code, 200); assert.ok(r.out.job);
    assert.strictEqual(started[0].mode, "read"); assert.strictEqual(started[0].cwd, BRAIN); assert.ok(started[0].prompt.includes('"memory/a.md"'));
    const t2 = await call("POST", "/api/obsidian/ask", { kind: "task", file: "memory/a.md", question: "tidy it" });
    assert.strictEqual(t2.code, 200); assert.strictEqual(started[1].mode, "edit");
    const j = await call("GET", `/api/obsidian/job/${r.out.job}`);
    assert.strictEqual(j.out.status, "running");
  });
  await t("at most 3 Obsidian jobs at once", async () => {
    const r = await call("POST", "/api/obsidian/ask", { file: "memory/a.md", question: "third" });
    assert.strictEqual(r.code, 200);
    const r4 = await call("POST", "/api/obsidian/ask", { file: "memory/a.md", question: "fourth" });
    assert.strictEqual(r4.code, 429);
  });
  await t("unknown job is a 404, open refuses non-notes", async () => {
    assert.strictEqual((await call("GET", "/api/obsidian/job/zzzz")).code, 404);
    assert.strictEqual((await call("POST", "/api/obsidian/open", { path: "app/obsidian-plugin/main.js" })).code, 400);
    assert.strictEqual((await call("POST", "/api/obsidian/open", { path: "memory/missing.md" })).code, 400);
  });
  await t("other routes are left alone", async () => { assert.strictEqual(await mod.route("/api/other", { method: "GET" }, {}, null), false); });
  fs.rmSync(BRAIN, { recursive: true, force: true });
  console.log(fail ? `FAILED: ${pass} passed, ${fail} failed` : `PASSED: ${pass} passed, 0 failed`);
  process.exit(fail ? 1 : 0);
})();
