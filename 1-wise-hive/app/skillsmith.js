// The Skillsmith (Library -> "Find new skills"): turns the hive's best, proven lessons into Claude skills.
// A skill changes every future Claude session, so the bar is high and checked three ways:
//   1. Scout (Opus; Sonnet in Lite): reads blender\LESSONS.md, knowledge\*.md and the newest training\records\, and
//      proposes at most 3 skills, only for procedures proven by 3+ separate lessons and not covered by an existing skill.
//   2. Reviewer: a separate, fresh run grades each proposal 1-10 (proven, reusable, concrete, faithful to the lessons,
//      new, safe). Only 8+ with no blocking problem passes.
//   3. Free checks: kebab-case name, no clash with an existing skill, valid frontmatter, a sane size, and every brain
//      path the skill mentions exists.
// A skill that passes is written to <claude dir>\skills\<name>\SKILL.md (every session), or, when only one project
// needs it, to <project>\.claude\skills\<name>\SKILL.md (Claude Code loads those only in that project), with a
// "made by the Skillsmith" note. History
// (added and rejected, with the reviewer's reasons) is in <brain>\librarian\skillsmith.json. Remove moves a skill
// to <brain>\librarian\removed-skills\ (never deleted).
// Runs from the button, and on its own (full edition only) when at least AUTO_NEW lessons were added since the last
// run, checked every few hours by counting lines (free).
//   POST /api/skillsmith          SSE: progress lines, then {t:"skillsmith", result}
//   GET  /api/skillsmith          { history, running, newLessons }
//   POST /api/skillsmith/remove   { name } -> moves that Skillsmith-made skill out of the skills folder
"use strict";
const fs = require("fs");
const { writeFileAtomic } = require("./lib/fsx");
const path = require("path");
const { LITE } = require("./edition");

const AUTO_NEW = 15, CHECK_MS = 4 * 3600e3, MIN_SCORE = 8, MAX_CHARS = 9000;
const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+){0,5}$/;

module.exports = (ctx) => {
  const BRAIN = ctx.BRAIN, LIB = path.join(BRAIN, "librarian"), STATE = path.join(LIB, "skillsmith.json");
  // HIVE_SKILLS_DIR (tests only): write new skills somewhere other than the real skills folder.
  const SKILLS = process.env.HIVE_SKILLS_DIR || path.join(process.env.CLAUDE_CONFIG_DIR || path.join(ctx.HOME, ".claude"), "skills");
  const PLUGIN_SKILLS = path.join(BRAIN, "marketplace", "teamwright", "skills");
  const MODEL = LITE ? "sonnet" : "opus";
  let running = false;

  const load = () => { try { return JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { return { lastLessonCount: 0, lastRun: null, history: [] }; } };
  const save = (s) => writeFileAtomic(STATE, JSON.stringify(s, null, 1));

  // Lessons are bullet lines in LESSONS.md and knowledge\*.md, plus one per training record.
  function lessonCount() {
    let n = 0;
    const bullets = (f) => { const t = ctx.read(f); return t ? (t.match(/^\s*- /gm) || []).length : 0; };
    n += bullets(path.join(BRAIN, "blender", "LESSONS.md"));
    try { for (const f of fs.readdirSync(path.join(BRAIN, "knowledge"))) if (f.endsWith(".md")) n += bullets(path.join(BRAIN, "knowledge", f)); } catch {}
    try { n += fs.readdirSync(path.join(BRAIN, "training", "records")).filter((f) => f.endsWith(".md")).length; } catch {}
    return n;
  }
  function existingSkills() {
    const out = [];
    for (const dir of [SKILLS, PLUGIN_SKILLS]) {
      let names = [];
      try { names = fs.readdirSync(dir); } catch {}
      for (const d of names) {
        const t = ctx.read(path.join(dir, d, "SKILL.md"));
        if (!t) continue;
        const m = /^description:\s*(.+)$/m.exec(t);
        out.push({ name: d, description: m ? m[1].trim().slice(0, 300) : "" });
      }
    }
    return out;
  }
  // Project folders on this PC (the same list the app offers): a project skill may only go into one of these.
  function projectFolders() {
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(path.join(BRAIN, "app-settings", "teamwright.json"), "utf8")); } catch {}
    const out = [...(cfg.projectFolders || [])];
    for (const r of cfg.projectRoots || []) { try { for (const d of fs.readdirSync(r)) out.push(path.join(r, d)); } catch {} }
    return [...new Set(out.map((d) => path.resolve(d)))].filter((d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
  }
  const skillDir = (p) => (p.project ? path.join(path.resolve(p.project), ".claude", "skills", p.name) : path.join(SKILLS, p.name));
  const between = (t, tag) => { const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(String(t || "")); return m ? m[1].trim() : ""; };
  const parseJSON = (t) => { try { return JSON.parse(t); } catch { const i = t.indexOf("["), j = t.lastIndexOf("]"); try { return i >= 0 ? JSON.parse(t.slice(i, j + 1)) : null; } catch { return null; } } };

  function scoutPrompt(skills, projects) {
    const recs = (() => { try { return fs.readdirSync(path.join(BRAIN, "training", "records")).filter((f) => f.endsWith(".md")).sort().slice(-12).map((f) => path.join(BRAIN, "training", "records", f)); } catch { return []; } })();
    return `You are the SKILLSMITH of The Wise Hive app. The hive has learned many lessons. Your job: find the few that together form a proven, reusable procedure worth turning into a Claude skill (a SKILL.md that future Claude sessions load and follow). A skill changes every future session, so propose only REALLY good ones; proposing nothing is a fine answer.

Read: ${path.join(BRAIN, "blender", "LESSONS.md")}, every file in ${path.join(BRAIN, "knowledge")}, and these newest training records:
${recs.map((f) => "- " + f).join("\n") || "- (none)"}
Existing skills (don't duplicate or overlap them; extending one is not your job):
${skills.map((s) => `- ${s.name}: ${s.description}`).join("\n") || "- (none)"}

The bar for a skill (all must hold):
- Proven: backed by at least 3 separate lessons or records that agree, with dates or round numbers you can cite.
- Reusable: a task the user will do again (a technique, a checklist, a pipeline), not a one-off fix or a project fact.
- Concrete: numbered steps with exact settings, commands, thresholds, tool calls and the saved scripts to run (only paths that exist; check with Glob). The common mistakes and their fixes from the lessons.
- Faithful: nothing the lessons don't support. No new advice.
- Short: under 6000 characters.

Where it goes ("project"): null when it helps in any project (a general technique: Blender, Windows, reviewing). If it only matters inside ONE project (that project's own code, places, pipeline or names), set "project" to that project's folder, exactly as listed here:
${projects.map((d) => "- " + d).join("\n") || "- (no project folders configured: use null)"}

Answer with ONLY this, at most 3 items:
<skills>[{"name": "kebab-case-name", "project": null, "description": "one sentence saying when Claude should use it (starts with 'Use when' or 'Use before')", "evidence": ["<file>: <the lesson line, with its date or round>", "... at least 3"], "skill_md": "the full SKILL.md: frontmatter with name and description, then the skill"}]</skills>
If nothing meets the bar: <skills>[]</skills>`;
  }
  function reviewPrompt(p, skills) {
    return `You are the SKILL REVIEWER of The Wise Hive app. Another Claude proposed turning the hive's lessons into the skill below. A skill changes every future Claude session, so be strict: most proposals should fail.

Proposed skill "${p.name}": ${p.description}
Evidence it cites:
${(p.evidence || []).map((e) => "- " + e).join("\n")}

SKILL.md:
"""
${p.skill_md}
"""

Check it against the sources yourself (Read ${path.join(BRAIN, "blender", "LESSONS.md")}, ${path.join(BRAIN, "knowledge")} and ${path.join(BRAIN, "training", "records")}; Glob any path it names). Existing skills it must not duplicate:
${skills.map((s) => `- ${s.name}: ${s.description}`).join("\n") || "- (none)"}

Score 1-10 on: proven (3+ agreeing lessons, cited correctly), reusable, concrete and followable, faithful (nothing unsupported or wrong), new (no overlap with an existing skill), safe (no destructive or risky steps without a check). A blocker is anything that makes it wrong or harmful to load into every session.
Answer with ONLY: <review>{"score": N, "blockers": ["..."], "reasons": "2-4 sentences"}</review>`;
  }
  // Free checks before anything is written.
  function freeCheck(p, skills, projects = projectFolders()) {
    const bad = [];
    if (!p || typeof p !== "object") return ["not a skill object"];
    if (p.project) {
      const pr = path.resolve(String(p.project));
      if (!projects.some((d) => d.toLowerCase() === pr.toLowerCase())) bad.push("its project folder isn't one of this PC's project folders: " + p.project);
      else if (fs.existsSync(path.join(pr, ".claude", "skills", String(p.name || "")))) bad.push("that project already has a skill with this name");
    }
    if (!NAME_RE.test(String(p.name || ""))) bad.push("the name isn't kebab-case");
    if (!p.project && skills.some((s) => s.name === p.name)) bad.push("a skill with this name already exists");
    const md = String(p.skill_md || "");
    if (md.length > MAX_CHARS) bad.push(`it is too long (${md.length} characters)`);
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
    if (!fm || !/^name:\s*\S/m.test(fm[1]) || !/^description:\s*\S/m.test(fm[1])) bad.push("its frontmatter needs a name and a description");
    if ((p.evidence || []).length < 3) bad.push("fewer than 3 lessons back it");
    const esc = BRAIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const m of md.matchAll(new RegExp(esc + "\\\\[^\\s`)\"'<>|*?]+", "g"))) {
      const pth = m[0].replace(/[.,;:]+$/, "");
      if (!/[<>{}*]/.test(pth) && !fs.existsSync(pth)) bad.push("it names a file that doesn't exist: " + pth);
    }
    return bad;
  }
  function install(p, review, when) {
    const dir = skillDir(p);
    fs.mkdirSync(dir, { recursive: true });
    let md = String(p.skill_md).replace(/\r\n/g, "\n");
    md = md.replace(/^(---\n[\s\S]*?\n---\n)/, `$1\n<!-- Made by The Wise Hive's Skillsmith on ${when.slice(0, 10)} from these lessons: ${(p.evidence || []).join(" | ").replace(/-->/g, "")}. Reviewer score ${review.score}/10. Remove it in The Wise Hive: Library -> Skillsmith. -->\n`);
    fs.writeFileSync(path.join(dir, "SKILL.md"), md);
  }

  async function run(send = () => {}) {
    if (running) return { error: "The Skillsmith is already running." };
    running = true;
    const st = load(), when = new Date().toISOString(), out = { at: when, added: [], rejected: [] };
    try {
      const skills = existingSkills();
      send({ t: "delta", text: "Reading the lessons and looking for proven procedures…\n" });
      const projects = projectFolders();
      const r = await ctx.askClaude({ prompt: scoutPrompt(skills, projects), cwd: BRAIN, mode: "read", model: MODEL, maxTurns: 30, lean: "Read,Glob,Grep" });
      const props = parseJSON(between(r.text, "skills")) || [];
      if (!Array.isArray(props) || !props.length) send({ t: "delta", text: "No lesson set meets the bar for a skill yet.\n" });
      for (const p of props.slice(0, 3)) {
        const name = String(p && p.name || "?");
        const bad = freeCheck(p, skills, projects);
        if (bad.length) { out.rejected.push({ name, description: p && p.description, why: bad.join("; "), stage: "checks" }); send({ t: "delta", text: `✗ ${name}: ${bad.join("; ")}\n` }); continue; }
        send({ t: "delta", text: `Reviewing "${name}"…\n` });
        const rv = await ctx.askClaude({ prompt: reviewPrompt(p, skills), cwd: BRAIN, mode: "read", model: MODEL, maxTurns: 20, lean: "Read,Glob,Grep" });
        let review = null; try { review = JSON.parse(between(rv.text, "review")); } catch {}
        const score = review ? Number(review.score) || 0 : 0, blockers = review && Array.isArray(review.blockers) ? review.blockers.filter(Boolean) : [];
        if (!review || score < MIN_SCORE || blockers.length) {
          out.rejected.push({ name, description: p.description, score, why: review ? [review.reasons, ...blockers].filter(Boolean).join(" ") : "The reviewer didn't answer.", stage: "review" });
          send({ t: "delta", text: `✗ ${name}: ${score}/10${blockers.length ? ", blocked: " + blockers.join("; ") : ""}\n` });
          continue;
        }
        install(p, review, when);
        if (!p.project) skills.push({ name: p.name, description: p.description });
        out.added.push({ name: p.name, description: p.description, score, evidence: p.evidence, reasons: review.reasons, project: p.project ? path.resolve(p.project) : null, dir: skillDir(p) });
        send({ t: "delta", text: `✓ Added skill "${name}" (${score}/10)${p.project ? " to the project " + path.basename(path.resolve(p.project)) : ""}\n` });
      }
    } catch (e) {
      out.error = String(e && e.message || e);
    } finally {
      running = false;
      st.lastRun = when; st.lastLessonCount = lessonCount();
      st.history = [out, ...(st.history || [])].slice(0, 30);
      try { save(st); } catch {}
      if (out.added.length && ctx.notify) ctx.notify({ title: "New skill" + (out.added.length > 1 ? "s" : "") + " from your lessons", body: out.added.map((a) => a.name).join(", "), view: "library" });
    }
    return out;
  }

  function remove(name) {
    const st = load();
    const rec = (st.history || []).flatMap((h) => h.added || []).find((a) => a.name === name && !a.removed);
    if (!rec || !NAME_RE.test(name)) return { error: "Only skills the Skillsmith made can be removed here." };
    const src = rec.dir || path.join(SKILLS, name);
    if (path.basename(src) !== name) return { error: "That skill's folder looks wrong, so it was left alone." };
    if (!fs.existsSync(src)) return { error: "That skill is already gone." };
    const dst = path.join(LIB, "removed-skills", `${name}-${Date.now()}`);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.renameSync(src, dst);
    for (const h of st.history || []) for (const a of h.added || []) if (a.name === name) a.removed = new Date().toISOString();
    save(st);
    return { ok: true, movedTo: dst };
  }

  return {
    start() {
      if (LITE) return;
      const t = setInterval(() => {
        const st = load();
        if (!running && lessonCount() - (st.lastLessonCount || 0) >= AUTO_NEW) run().catch(() => {});
      }, CHECK_MS);
      if (t.unref) t.unref();
      // First run on this PC: count what exists now, so the auto check waits for genuinely new lessons.
      const st = load();
      if (!st.lastRun && !st.lastLessonCount) { st.lastLessonCount = lessonCount(); try { save(st); } catch {} }
    },
    async route(p, req, res) {
      if (p === "/api/skillsmith" && req.method === "GET") {
        const st = load();
        ctx.json(res, 200, { history: st.history || [], running, newLessons: Math.max(0, lessonCount() - (st.lastLessonCount || 0)), lastRun: st.lastRun || null, auto: !LITE, autoAfter: AUTO_NEW });
        return true;
      }
      if (p === "/api/skillsmith" && req.method === "POST") {
        const send = ctx.sse(res);
        const result = await run(send);
        if (result.error && !result.at) send({ t: "result", text: result.error });
        else send({ t: "result", text: result.added.length ? `Added ${result.added.length} skill${result.added.length > 1 ? "s" : ""}: ${result.added.map((a) => a.name).join(", ")}.` : "No new skills this time: nothing met the bar." });
        send({ t: "skillsmith", result });
        send({ t: "end" }); res.end();
        return true;
      }
      if (p === "/api/skillsmith/remove" && req.method === "POST") {
        const b = await ctx.body(req), r = remove(String(b.name || ""));
        ctx.json(res, r.error ? 400 : 200, r); return true;
      }
      return false;
    },
    _freeCheck: freeCheck,
  };
};
