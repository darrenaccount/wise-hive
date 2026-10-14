// Inventor: reads each chat as it goes and suggests new ideas the user could act on, plus Claude's honest take on
// how the work is going. One file per chat in <brain>\ideas\<chat id>.json; saved ideas also go to backlog.md.
const fs = require("fs");
const { writeFileAtomic } = require("./lib/fsx");
const path = require("path");
const crypto = require("crypto");

const KEY = /^[\w-]{6,80}$/, ID = /^[\w-]{1,40}$/;
const STATUSES = ["new", "used", "saved", "dismissed"];
const EFFORTS = ["quick", "medium", "big"];
// Lite: the Inventor runs on Haiku, only when asked, with at most 2 ideas.
const { LITE } = require("./edition");
const MODEL = LITE ? "haiku" : "claude-sonnet-5-5";
const MAX_IDEAS = LITE ? 2 : 3;
const TAKES_KEEP = 20, IDEAS_KEEP = 200, CONTEXT_MAX = 8000;

const pad = (n) => String(n).padStart(2, "0");
const day = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const flat = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

module.exports = (ctx) => {
  const { BRAIN } = ctx;
  const DIR = path.join(BRAIN, "ideas");
  const BACKLOG = path.join(DIR, "backlog.md");
  const busy = new Set(); // chat keys with a generation running

  const file = (key) => path.join(DIR, key + ".json");
  function load(key) {
    let d = null;
    try { d = JSON.parse(ctx.read(file(key)) || "null"); } catch {}
    return { takes: Array.isArray(d && d.takes) ? d.takes : [], ideas: Array.isArray(d && d.ideas) ? d.ideas : [] };
  }
  function save(key, d) {
    fs.mkdirSync(DIR, { recursive: true });
    const f = file(key), data = JSON.stringify(d, null, 2);
    writeFileAtomic(f, data);
  }

  const prompt = ({ title, cwd, context, given }) => `You are the INVENTOR of The Wise Hive app. You sit beside the user's chat with another Claude agent and read along. Your job: give Claude's honest take on how the work is going, and suggest NEW ideas the user could act on next. You do not do the work yourself. Answer directly; do not use tools.

What to write:
- "take": 1 to 3 sentences on how the work is going and your honest opinion: what is strong, what is risky or missing. Be specific to this chat, not generic praise.
- "ideas": 0 to ${MAX_IDEAS} NEW, concrete, actionable suggestions the user could do next: features, improvements, experiments, shortcuts, things to test. Each one:
  "title": at most 60 characters
  "idea": 1 or 2 sentences written as an instruction Claude could act on directly (e.g. "Add a ... to ... so that ...")
  "why": one sentence on what it gains
  "effort": "quick", "medium" or "big"
- Use what you know about the user and their projects from your recall context, so the ideas fit how they work.
- Don't repeat or rephrase ideas already given (listed below), and don't suggest what the chat is already doing.
- Return 0 ideas rather than filler. Fewer, sharper ideas beat more.

Answer strictly in this format and nothing else:
<ideas>{"take":"...","ideas":[{"title":"...","idea":"...","why":"...","effort":"quick"}]}</ideas>

CHAT TITLE: ${title || "(untitled)"}
PROJECT FOLDER: ${cwd || BRAIN}

IDEAS ALREADY GIVEN FOR THIS CHAT:
${given.length ? given.map((t) => "- " + t).join("\n") : "(none yet)"}

RECENT CONVERSATION:
${context || "(no messages yet)"}`;

  // Pulls {take, ideas} out of the answer: tag first, then the outermost JSON object, tolerating fences and trailing commas.
  function parse(text) {
    const m = /<ideas>([\s\S]*?)<\/ideas>/i.exec(text || "");
    const raw = (m ? m[1] : String(text || "")).replace(/```(?:json)?/gi, "");
    const tries = [];
    const a = raw.indexOf("{"), b = raw.lastIndexOf("}");
    if (a >= 0 && b > a) tries.push(raw.slice(a, b + 1));
    const la = raw.indexOf("["), lb = raw.lastIndexOf("]");
    if (la >= 0 && lb > la && (a < 0 || la < a)) tries.push(raw.slice(la, lb + 1));
    for (const t of tries) {
      for (const s of [t, t.replace(/,\s*([}\]])/g, "$1")]) {
        try {
          const v = JSON.parse(s);
          if (Array.isArray(v)) return { take: "", ideas: v };
          if (v && typeof v === "object") return { take: typeof v.take === "string" ? v.take : "", ideas: Array.isArray(v.ideas) ? v.ideas : [] };
        } catch {}
      }
    }
    return null;
  }

  async function generate({ key, cwd, title, context }) {
    const data = load(key);
    const given = data.ideas.slice(-40).map((i) => flat(i.title, 80)).filter(Boolean);
    const r = await ctx.askClaude({ prompt: prompt({ title: flat(title, 200), cwd: flat(cwd, 300), context: String(context || "").slice(-CONTEXT_MAX).trim(), given }),
      cwd: BRAIN, mode: "read", maxTurns: LITE ? 2 : 3, model: MODEL, lean: true });
    const out = parse(r.text);
    if (!out) return { error: /log ?in/i.test(r.text || "") ? "Claude Code isn't signed in." : "The Inventor didn't answer." };
    const at = new Date().toISOString();
    const take = String(out.take || "").trim().slice(0, 1200);
    // Re-read: statuses may have changed while Claude was thinking.
    const fresh = load(key);
    const seen = new Set(fresh.ideas.map((i) => norm(i.title)));
    const ideas = [];
    for (const i of out.ideas) {
      if (!i || typeof i !== "object" || ideas.length >= MAX_IDEAS) continue;
      const t = flat(i.title, 60), idea = flat(i.idea, 800);
      if (!t || !idea || seen.has(norm(t))) continue;
      seen.add(norm(t));
      const effort = String(i.effort || "").toLowerCase().trim();
      ideas.push({ id: crypto.randomUUID().slice(0, 8), at, title: t, idea, why: flat(i.why, 400), effort: EFFORTS.includes(effort) ? effort : "medium", status: "new" });
    }
    if (take) fresh.takes = fresh.takes.concat({ at, text: take }).slice(-TAKES_KEEP);
    fresh.ideas = fresh.ideas.concat(ideas).slice(-IDEAS_KEEP);
    if (take || ideas.length) save(key, fresh);
    return { take, at, ideas };
  }

  function addToBacklog(key, idea) {
    fs.mkdirSync(DIR, { recursive: true });
    if (!fs.existsSync(BACKLOG)) fs.writeFileSync(BACKLOG, "# Idea backlog\n\n");
    fs.appendFileSync(BACKLOG, `- ${day()} **${flat(idea.title, 80)}**: ${flat(idea.idea, 1000)} (from chat ${key.slice(0, 8)})\n`);
  }

  async function route(p, req, res) {
    if (p === "/api/ideas" && req.method === "POST") {
      const { key, cwd, title, context } = await ctx.body(req);
      if (!KEY.test(key || "")) { ctx.json(res, 400, { error: "bad key" }); return true; }
      if (busy.has(key)) { ctx.json(res, 200, { busy: true }); return true; }
      busy.add(key);
      ctx.broadcast({ t: "ideas", key, working: true });
      let out;
      try { out = await generate({ key, cwd, title, context }); }
      catch (e) { out = { error: String(e && e.message || e) }; }
      finally { busy.delete(key); }
      ctx.broadcast({ t: "ideas", key, working: false, added: (out.ideas || []).length });
      ctx.json(res, 200, out);
      return true;
    }
    if (p === "/api/ideas-backlog" && req.method === "GET") {
      ctx.json(res, 200, { text: ctx.read(BACKLOG) || "" });
      return true;
    }
    const m = /^\/api\/ideas\/([^/]+)(?:\/([^/]+))?$/.exec(p);
    if (!m) return false;
    if (!KEY.test(m[1]) || (m[2] && !ID.test(m[2]))) { ctx.json(res, 400, { error: "bad key" }); return true; }
    if (!m[2] && req.method === "GET") { ctx.json(res, 200, { ...load(m[1]), working: busy.has(m[1]) }); return true; }
    if (m[2] && req.method === "POST") {
      const { status } = await ctx.body(req);
      if (!STATUSES.includes(status)) { ctx.json(res, 400, { error: "bad status" }); return true; }
      const d = load(m[1]), idea = d.ideas.find((i) => i.id === m[2]);
      if (!idea) { ctx.json(res, 404, { error: "not found" }); return true; }
      const was = idea.status;
      idea.status = status;
      idea.changed = new Date().toISOString();
      save(m[1], d);
      if (status === "saved" && was !== "saved") addToBacklog(m[1], idea);
      ctx.json(res, 200, { idea });
      return true;
    }
    return false;
  }

  return { route };
};
