// Plugins tab: lists Claude Code plugins (installed and available from the user's marketplaces) and installs,
// removes, enables, disables and updates them through the `claude plugin` CLI. Changes apply to new chats.
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

module.exports = (ctx) => {
  const ID = /^[\w.-]{1,100}(@[\w.-]{1,100})?$/;
  const ACTIONS = ["install", "uninstall", "enable", "disable", "update"];
  let cache = null, cacheAt = 0, busy = null;

  const cli = (args, timeout = 180000) => new Promise((ok) =>
    execFile(ctx.CLAUDE, args, { timeout, windowsHide: true, env: ctx.cleanEnv(), maxBuffer: 8 * 1024 * 1024 },
      (e, out, err) => ok({ ok: !e, out: String(out || ""), err: String(err || "") || (e ? String(e.message) : "") })));

  // Skills, hooks and MCP servers a plugin ships, read from its install folder.
  function contents(dir) {
    const out = { skills: [], hooks: false, mcp: false, agents: 0, commands: 0 };
    if (!dir || !fs.existsSync(dir)) return out;
    const skillsDir = path.join(dir, "skills");
    try {
      for (const d of fs.readdirSync(skillsDir)) {
        const src = ctx.read(path.join(skillsDir, d, "SKILL.md"));
        if (!src) continue;
        const name = (/^name:\s*(.+)$/m.exec(src) || [])[1] || d;
        const desc = (/^description:\s*(.+)$/m.exec(src) || [])[1] || "";
        out.skills.push({ name: name.trim().replace(/^["']|["']$/g, ""), description: desc.trim().replace(/^["']|["']$/g, "").slice(0, 300) });
      }
    } catch {}
    out.hooks = fs.existsSync(path.join(dir, "hooks", "hooks.json"));
    out.mcp = fs.existsSync(path.join(dir, ".mcp.json"));
    const count = (sub) => { try { return fs.readdirSync(path.join(dir, sub)).filter((f) => f.endsWith(".md")).length; } catch { return 0; } };
    out.agents = count("agents"); out.commands = count("commands");
    return out;
  }

  async function load(force) {
    if (!force && cache && Date.now() - cacheAt < 60000) return cache;
    const [list, mk] = await Promise.all([cli(["plugin", "list", "--json", "--available"], 120000), cli(["plugin", "marketplace", "list", "--json"], 60000)]);
    let data = {}, markets = [];
    try { data = JSON.parse(list.out); } catch { return { error: (list.err || list.out || "Couldn't read the plugin list.").slice(0, 500), installed: [], available: [], marketplaces: [] }; }
    try { markets = JSON.parse(mk.out); } catch {}
    const installed = (data.installed || []).map((p) => {
      const [name, market] = String(p.id).split("@");
      return { id: p.id, name, marketplace: market || "", version: p.version, scope: p.scope, enabled: !!p.enabled, installedAt: p.installedAt, lastUpdated: p.lastUpdated, ...contents(p.installPath) };
    });
    const have = new Set(installed.map((p) => p.id));
    const available = (data.available || []).filter((p) => !have.has(p.pluginId)).map((p) => ({ id: p.pluginId, name: p.name, marketplace: p.marketplaceName, version: p.version, description: p.description || "" }));
    cache = { installed, available, marketplaces: (Array.isArray(markets) ? markets : []).map((m) => ({ name: m.name, source: m.repo || m.url || m.path || m.source || "" })) };
    cacheAt = Date.now();
    return cache;
  }

  async function run(label, args) {
    if (busy) return { error: `Busy with: ${busy}. Try again in a moment.` };
    busy = label;
    ctx.broadcast({ t: "plugins", busy: label });
    try {
      const r = await cli(args);
      cache = null;
      const text = (r.out + "\n" + r.err).trim().slice(-1500);
      return r.ok ? { ok: true, output: text } : { error: text || "The command failed." };
    } finally { busy = null; ctx.broadcast({ t: "plugins", busy: null }); }
  }

  return {
    async route(p, req, res, url) {
      if (p === "/api/plugins" && req.method === "GET") { ctx.json(res, 200, { ...(await load(url.searchParams.get("refresh") === "1")), busy }); return true; }
      if (p === "/api/plugins/action" && req.method === "POST") {
        const { action, id } = await ctx.body(req);
        if (!ACTIONS.includes(action) || !ID.test(String(id || ""))) { ctx.json(res, 400, { error: "Unknown action or plugin." }); return true; }
        ctx.json(res, 200, await run(`${action} ${id}`, ["plugin", action, id]));
        return true;
      }
      if (p === "/api/plugins/marketplace" && req.method === "POST") {
        const { action, source, name } = await ctx.body(req);
        if (action === "add" && /^[\w./:@#~-]{3,300}$/.test(String(source || ""))) { ctx.json(res, 200, await run(`add marketplace ${source}`, ["plugin", "marketplace", "add", source])); return true; }
        if (action === "update") { ctx.json(res, 200, await run("update marketplaces", ["plugin", "marketplace", "update"].concat(name && ID.test(name) ? [name] : []))); return true; }
        if (action === "remove" && ID.test(String(name || ""))) { ctx.json(res, 200, await run(`remove marketplace ${name}`, ["plugin", "marketplace", "remove", name])); return true; }
        ctx.json(res, 400, { error: "Unknown marketplace action." });
        return true;
      }
      return false;
    },
  };
};
