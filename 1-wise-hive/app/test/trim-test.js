// Unit test for trim.js (Library -> Trim notes) with a fake Claude run: no tokens, scratch brain under .research.
//   node test/trim-test.js
"use strict";
const fs = require("fs"), path = require("path"), assert = require("assert");
const APP = path.resolve(__dirname, "..");
const TMP = path.join(APP, ".research", "trim-unit-" + process.pid);
const BRAIN = path.join(TMP, "brain");
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log("PASS", name); } catch (e) { failed++; console.log("FAIL", name + ":", e && e.message || e); } }
const long = (s) => (s + " ").repeat(60);
const write = (rel, text) => { const f = path.join(BRAIN, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const read = (rel) => fs.readFileSync(path.join(BRAIN, rel), "utf8");

function mk(edit) {
  const ctx = { BRAIN, read: (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } },
    json: (res, code, body) => { res.code = code; res.body = body; }, body: async (req) => req.body || {},
    sse: (res) => (o) => res.events.push(o), simplify: (ev) => ev,
    runClaude: (o) => { assert.ok(/You are the TRIMMER/.test(o.prompt)); assert.strictEqual(o.lean, "Read,Write,Edit,Glob,Grep"); edit(); setImmediate(() => o.onEnd(0, "")); return "run-1"; } };
  delete require.cache[require.resolve(path.join(APP, "trim.js"))];
  return require(path.join(APP, "trim.js"))(ctx);
}
const call = (mod, method, p, body) => new Promise((ok) => { const res = { events: [], code: 0, body: null, end() { ok(res); } }; Promise.resolve(mod.route(p, { method, body }, res)).then(() => { if (method !== "POST" || p !== "/api/trim") ok(res); }); });

(async () => {
  fs.rmSync(TMP, { recursive: true, force: true });
  const PATH = String.raw`D:\Games\Kart\drift.luau`;
  write("memory/kart.md", `---\nname: kart\ndescription: kart game\n---\n${long("The kart drift friction was set to 0.4 in")} ${PATH} and see [[kart-notes]].`);
  write("knowledge/tips.md", long("Run `node build.js` before every release, as the build notes explain in detail here."));
  write("projects/game.md", `---\nname: game\n---\n${long("A long project note about the game and its many parts.")}`);
  write("memory/short.md", "Too short to trim.");

  await test("trims, keeps what survived, puts back files that lost a detail or their frontmatter", async () => {
    const mod = mk(() => {
      write("memory/kart.md", `---\nname: kart\ndescription: kart game\n---\nDrift friction 0.4 in ${PATH}; see [[kart-notes]].`); // fine
      write("knowledge/tips.md", "Run the build before releases."); // lost the `node build.js` command
      write("projects/game.md", "---\nname: game-renamed\n---\nShort note."); // frontmatter changed
    });
    const res = await call(mod, "POST", "/api/trim");
    const t = res.events.find((e) => e.t === "trim"), r = t && t.report;
    assert.ok(r, "a report is sent");
    const by = Object.fromEntries(r.files.map((f) => [f.file.replace(/\\/g, "/"), f]));
    assert.ok(!by["memory/short.md"], "short files are left alone");
    assert.strictEqual(by["memory/kart.md"].restored, false);
    assert.ok(by["memory/kart.md"].after < by["memory/kart.md"].before);
    assert.ok(read("memory/kart.md").includes("Drift friction 0.4"));
    assert.strictEqual(by["knowledge/tips.md"].restored, true);
    assert.ok(by["knowledge/tips.md"].missing.includes("`node build.js`"));
    assert.ok(read("knowledge/tips.md").includes("`node build.js`"), "the original is back");
    assert.strictEqual(by["projects/game.md"].restored, true);
    assert.ok(by["projects/game.md"].missing.includes("its frontmatter changed"));
    assert.ok(fs.existsSync(path.join(r.backup, "memory", "kart.md")), "backup exists");
  });
  await test("GET shows the report; undo puts one file back, then all", async () => {
    const mod = mk(() => {});
    const g = await call(mod, "GET", "/api/trim");
    assert.ok(g.body.report && g.body.report.files.length === 3);
    const u1 = await call(mod, "POST", "/api/trim/undo", { file: path.join("memory", "kart.md") });
    assert.strictEqual(u1.code, 200);
    assert.ok(read("memory/kart.md").includes("was set to 0.4"), "original text back");
    const bad = await call(mod, "POST", "/api/trim/undo", { file: "../outside.md" });
    assert.strictEqual(bad.code, 400, "files outside the last trim are refused");
    const all = await call(mod, "POST", "/api/trim/undo", {});
    assert.strictEqual(all.code, 200);
  });
  await test("undo leaves a note alone that changed after the trim", async () => {
    const mod = mk(() => write("memory/kart.md", `---\nname: kart\ndescription: kart game\n---\nDrift friction 0.4 in ${PATH}; see [[kart-notes]].`));
    await call(mod, "POST", "/api/trim");
    write("memory/kart.md", read("memory/kart.md") + "\nA lesson a Training round added later.");
    const u = await call(mod, "POST", "/api/trim/undo", {});
    assert.strictEqual(u.code, 200);
    assert.deepStrictEqual(u.body.skipped.map((f) => f.replace(/\\/g, "/")), ["memory/kart.md"]);
    assert.ok(read("memory/kart.md").includes("A lesson a Training round added later."), "the later edit survives");
    assert.ok(read("knowledge/tips.md").includes("`node build.js`"), "unchanged notes are still put back");
  });
  await test("undo refuses a report pointing outside the trim backups or at other files", async () => {
    const mod = mk(() => {});
    const REPORT = path.join(BRAIN, "librarian", "trim-report.json");
    const good = JSON.parse(fs.readFileSync(REPORT, "utf8"));
    const elsewhere = path.join(TMP, "elsewhere"); fs.mkdirSync(path.join(elsewhere, "memory"), { recursive: true });
    fs.writeFileSync(path.join(elsewhere, "memory", "kart.md"), "planted");
    fs.writeFileSync(REPORT, JSON.stringify({ ...good, backup: elsewhere }));
    assert.strictEqual((await call(mod, "POST", "/api/trim/undo", {})).code, 400, "a backup folder outside trim-backups is refused");
    assert.ok(!read("memory/kart.md").includes("planted"));
    write("app/main.js", "the app");
    fs.mkdirSync(path.join(good.backup, "app"), { recursive: true }); fs.writeFileSync(path.join(good.backup, "app", "main.js"), "planted");
    fs.writeFileSync(REPORT, JSON.stringify({ ...good, files: [{ file: path.join("app", "main.js"), before: 1, after: 1 }] }));
    await call(mod, "POST", "/api/trim/undo", {});
    assert.strictEqual(read("app/main.js"), "the app", "only note files are ever put back");
  });
  await test("the key finder sees code spans, Windows paths, URLs and links", () => {
    const { keys } = require(path.join(APP, "trim.js"));
    const k = keys("Run `npm test` in " + String.raw`D:\Brain\app` + " see [[a-note]], [doc](projects/x.md) and https://example.com/a.");
    for (const x of ["`npm test`", String.raw`D:\Brain\app`, "[[a-note]]", "projects/x.md", "https://example.com/a"]) assert.ok(k.has(x), "missing " + x);
  });
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`${failed ? "FAILED" : "PASSED"}: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
