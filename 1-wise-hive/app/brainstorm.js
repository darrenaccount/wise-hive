// Brainstorm tab: a dedicated Brainstormer that only thinks and researches (web + the user's notes, never edits
// or builds anything) and writes a brainstorm plan. Each session's newest plan is saved in <brain>\brainstorms\.
const fs = require("fs");
const path = require("path");

const SYSTEM = `You are the BRAINSTORMER in the user's The Wise Hive app. The user comes to you to brainstorm ideas: games, features, products, art, anything.
Your job is to think, research and plan. You never make the thing: don't create, edit or delete files, don't write the actual code or assets, and don't run commands. (Your tools are limited to web search, reading web pages and reading files.)
How to brainstorm well:
- Research: search the web for what already exists (similar games/products, competitors, examples, techniques, data, tutorials), and read the user's own notes in ${process.env.TEAMWRIGHT_BRAIN || path.resolve(__dirname, "..")} (INDEX.md, memory\\, projects\\) when their projects matter. Cite what you found with links.
- Think widely, then narrow: offer several genuinely different directions, combine ideas, question assumptions, point out weak spots and risks honestly, and ask a few sharp questions when the idea is vague.
- Keep normal replies concise and easy to scan.
- When the idea has taken shape, or whenever the user asks for the plan, write the brainstorm plan inside <brainstorm-plan title="Short title">...</brainstorm-plan> in markdown with these sections: The idea; Why it could work; What I found (with links); Directions considered; Risks and open questions; Recommended plan (concrete steps); Next actions. When you revise the plan later, write the whole updated plan again in the same tags.`;

module.exports = (ctx) => {
  const DIR = path.join(ctx.BRAIN, "brainstorms");
  const SID = /^[\w-]{6,80}$/;
  const file = (id) => path.join(DIR, id + ".md");
  const PLAN = /<brainstorm-plan(?:\s+title="([^"]*)")?\s*>([\s\S]*?)<\/brainstorm-plan>/g;

  function savePlan(sessionId, text) {
    let m, last = null;
    while ((m = PLAN.exec(text || ""))) last = m;
    PLAN.lastIndex = 0;
    if (!last || !SID.test(sessionId || "")) return null;
    const title = (last[1] || "Brainstorm plan").trim().slice(0, 120);
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(file(sessionId), `# ${title}\n\nSession: ${sessionId}\nUpdated: ${new Date().toISOString()}\n\n${last[2].trim()}\n`);
    ctx.broadcast({ t: "brainstorm", saved: sessionId });
    return { id: sessionId, title };
  }
  function list() {
    if (!fs.existsSync(DIR)) return [];
    return fs.readdirSync(DIR).filter((f) => f.endsWith(".md")).map((f) => {
      const t = ctx.read(path.join(DIR, f)) || "";
      const body = t.replace(/^# .*\n+Session: .*\nUpdated: .*\n+/, "");
      return { id: f.slice(0, -3), title: (/^# (.+)$/m.exec(t) || [])[1] || "Brainstorm plan", updated: (/^Updated: (.+)$/m.exec(t) || [])[1] || "",
        preview: body.replace(/[#*_>`]/g, "").replace(/\s+/g, " ").slice(0, 220) };
    }).sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  }

  return {
    async route(p, req, res) {
      if (p === "/api/brainstorm/chat" && req.method === "POST") {
        const { text, session, model } = await ctx.body(req);
        if (!String(text || "").trim()) { ctx.json(res, 400, { error: "Type an idea first." }); return true; }
        const resume = SID.test(session || "") ? session : null;
        const run = ctx.startChat({
          // The tag keeps brainstorms out of the Chats list (they live in the Brainstorm tab).
          prompt: resume ? String(text) : `[Wise Hive brainstorm] ${text}`, resume, cwd: ctx.BRAIN, mode: "read", model: model || undefined,
          allowedTools: ["WebSearch", "WebFetch", "Read", "Glob", "Grep"], autoDeny: true, appendSystemPrompt: SYSTEM,
          kind: "brainstorm", title: "Brainstorm: " + String(text).replace(/\s+/g, " ").slice(0, 70),
        });
        run.onDone = () => {
          const r = [...run.events].reverse().find((e) => e.t === "result");
          if (r && !r.error) savePlan(run.chatId, r.text);
        };
        ctx.subscribe(res, run, 0);
        return true;
      }
      if (p === "/api/brainstorm/plans" && req.method === "GET") { ctx.json(res, 200, list()); return true; }
      const m = /^\/api\/brainstorm\/plans\/([\w-]{6,80})(\/delete)?$/.exec(p);
      if (m) {
        if (!m[2] && req.method === "GET") { const t = ctx.read(file(m[1])); ctx.json(res, t == null ? 404 : 200, t == null ? { error: "not found" } : { id: m[1], text: t }); return true; }
        if (m[2] && req.method === "POST") { try { fs.rmSync(file(m[1]), { force: true }); } catch {} ctx.broadcast({ t: "brainstorm", deleted: m[1] }); ctx.json(res, 200, { ok: true }); return true; }
      }
      return false;
    },
  };
};
