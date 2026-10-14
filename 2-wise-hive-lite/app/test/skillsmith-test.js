// Unit test for skillsmith.js with fake Claude runs (no tokens), a scratch brain and a scratch skills folder.
//   node test/skillsmith-test.js
"use strict";
const fs = require("fs"), path = require("path"), assert = require("assert");
const APP = path.resolve(__dirname, "..");
const TMP = path.join(APP, ".research", "skillsmith-unit-" + process.pid);
const BRAIN = path.join(TMP, "brain"), CLAUDE = path.join(TMP, "claude");
process.env.CLAUDE_CONFIG_DIR = CLAUDE;
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log("PASS", name); } catch (e) { failed++; console.log("FAIL", name + ":", e && e.message || e); } }
const write = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };

(async () => {
  fs.rmSync(TMP, { recursive: true, force: true });
  write(path.join(BRAIN, "blender", "LESSONS.md"), "# Lessons\n- Bevel then harden normals (round 3)\n- Bevel weight 0.4 (round 5)\n- Harden fails on curves (round 11)\n");
  write(path.join(BRAIN, "blender", "scripts", "bevel.py"), "# bevel helper\n");
  write(path.join(CLAUDE, "skills", "blender-modeling", "SKILL.md"), "---\nname: blender-modeling\ndescription: Use before Blender work.\n---\nSteps.");
  const md = (name, extra = "") => `---\nname: ${name}\ndescription: Use when bevelling hard-surface props.\n---\n# ${name}\n1. Run ${path.join(BRAIN, "blender", "scripts", "bevel.py")}${extra}\n`;
  const proposals = [
    { name: "bevel-hard-surface", description: "Use when bevelling hard-surface props.", evidence: ["LESSONS.md: round 3", "LESSONS.md: round 5", "LESSONS.md: round 11"], skill_md: md("bevel-hard-surface") },
    { name: "Bad Name", description: "x", evidence: ["one"], skill_md: md("bad") },
    { name: "weak-idea", description: "Use when ...", evidence: ["a", "b", "c"], skill_md: md("weak-idea") },
  ];
  const calls = [];
  const ctx = { BRAIN, HOME: TMP, read: (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } },
    json: (res, code, body) => { res.code = code; res.body = body; }, body: async (req) => req.body || {}, sse: (res) => (o) => res.events.push(o), notify: () => {},
    askClaude: async (o) => {
      calls.push(o);
      assert.strictEqual(o.lean, "Read,Glob,Grep"); assert.strictEqual(o.mode, "read");
      if (/You are the SKILLSMITH/.test(o.prompt)) { assert.ok(o.prompt.includes("blender-modeling"), "existing skills are listed"); return { text: `<skills>${JSON.stringify(proposals)}</skills>` }; }
      if (/You are the SKILL REVIEWER/.test(o.prompt)) return { text: /"weak-idea"/.test(o.prompt) ? `<review>{"score": 6, "blockers": [], "reasons": "Too vague."}</review>` : `<review>{"score": 9, "blockers": [], "reasons": "Proven by three rounds."}</review>` };
      throw new Error("unexpected prompt");
    } };
  const mod = require(path.join(APP, "skillsmith.js"))(ctx);
  const call = (method, p, body) => new Promise((ok) => { const res = { events: [], end() { ok(res); } }; Promise.resolve(mod.route(p, { method, body }, res)).then((handled) => { if (!(method === "POST" && p === "/api/skillsmith")) ok(res); }); });

  await test("only the proposal that passes the free checks and scores 8+ is added", async () => {
    const res = await call("POST", "/api/skillsmith");
    const r = res.events.find((e) => e.t === "skillsmith").result;
    assert.deepStrictEqual(r.added.map((a) => a.name), ["bevel-hard-surface"]);
    assert.deepStrictEqual(r.rejected.map((x) => [x.name, x.stage]), [["Bad Name", "checks"], ["weak-idea", "review"]]);
    assert.strictEqual(calls.filter((c) => /SKILL REVIEWER/.test(c.prompt)).length, 2, "the bad-name one never reaches the reviewer");
    const skill = fs.readFileSync(path.join(CLAUDE, "skills", "bevel-hard-surface", "SKILL.md"), "utf8");
    assert.ok(/^---\nname: bevel-hard-surface/.test(skill) && /Made by The Wise Hive's Skillsmith/.test(skill));
    assert.ok(!fs.existsSync(path.join(CLAUDE, "skills", "weak-idea")));
  });
  await test("free checks: a missing file, an existing name, too little evidence", () => {
    const bad = mod._freeCheck({ name: "blender-modeling", description: "d", evidence: ["a"], skill_md: md("x", " and " + path.join(BRAIN, "nope.py")) }, [{ name: "blender-modeling" }]);
    assert.ok(bad.some((b) => /already exists/.test(b)) && bad.some((b) => /fewer than 3/.test(b)) && bad.some((b) => /doesn't exist/.test(b)), bad.join(" | "));
  });
  await test("GET shows history; remove moves only Skillsmith skills, never deletes", async () => {
    const g = await call("GET", "/api/skillsmith");
    assert.strictEqual(g.body.history[0].added[0].name, "bevel-hard-surface");
    const other = await call("POST", "/api/skillsmith/remove", { name: "blender-modeling" });
    assert.strictEqual(other.code, 400, "a skill the Skillsmith didn't make is refused");
    const rm = await call("POST", "/api/skillsmith/remove", { name: "bevel-hard-surface" });
    assert.strictEqual(rm.code, 200);
    assert.ok(!fs.existsSync(path.join(CLAUDE, "skills", "bevel-hard-surface")) && fs.existsSync(path.join(rm.body.movedTo, "SKILL.md")));
  });
  await test("a project-only skill goes into that project's .claude\\skills; an unlisted folder is refused", async () => {
    const PROJ = path.join(TMP, "games", "Kart");
    fs.mkdirSync(PROJ, { recursive: true });
    write(path.join(BRAIN, "app-settings", "teamwright.json"), JSON.stringify({ projectRoots: [path.join(TMP, "games")] }));
    proposals.length = 0;
    proposals.push({ name: "kart-drift-tuning", project: PROJ, description: "Use when tuning drift in the kart game.", evidence: ["a", "b", "c"], skill_md: md("kart-drift-tuning") },
      { name: "elsewhere", project: path.join(TMP, "not-a-project"), description: "Use when x.", evidence: ["a", "b", "c"], skill_md: md("elsewhere") });
    const res = await call("POST", "/api/skillsmith");
    const r = res.events.find((e) => e.t === "skillsmith").result;
    assert.deepStrictEqual(r.added.map((a) => a.name), ["kart-drift-tuning"]);
    assert.ok(fs.existsSync(path.join(PROJ, ".claude", "skills", "kart-drift-tuning", "SKILL.md")), "written into the project");
    assert.ok(!fs.existsSync(path.join(CLAUDE, "skills", "kart-drift-tuning")), "not into the global skills");
    assert.ok(/isn't one of this PC's project folders/.test(r.rejected[0].why));
    const rm = await call("POST", "/api/skillsmith/remove", { name: "kart-drift-tuning" });
    assert.strictEqual(rm.code, 200);
    assert.ok(!fs.existsSync(path.join(PROJ, ".claude", "skills", "kart-drift-tuning")));
  });
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`${failed ? "FAILED" : "PASSED"}: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
