// Obsidian link (built 2026-10-13). The brain folder is an Obsidian vault, so every note The Wise Hive writes shows up in
// Obsidian on its own. This module is the other direction plus the glue:
//   - the "The Wise Hive" Obsidian plugin (source in app\obsidian-plugin\, copied into <brain>\.obsidian\plugins\wise-hive
//     on every start) calls these routes to ask about a note, hand it over as a task, or put it to the council;
//   - answers come back as notes in "Wise Hive\Answers\" (linked to the note they came from), council debates are
//     already notes in council\;
//   - the app's own pages can open any brain note in Obsidian (POST /api/obsidian/open).
// Same guard as every /api route (X-Hive header, no foreign Origin), so only local callers get in.
const fs = require("fs");
const path = require("path");
const http = require("http");
const { execFile } = require("child_process");

module.exports = (ctx) => {
  const { BRAIN, json, body } = ctx;
  const PLUGIN_SRC = path.join(ctx.APP_DIR, "obsidian-plugin");
  const VAULT_CFG = path.join(BRAIN, ".obsidian");
  const PLUGIN_DST = path.join(VAULT_CFG, "plugins", "wise-hive");
  const ANSWERS = path.join(BRAIN, "Wise Hive", "Answers");
  const MAX_JOBS = 3;
  const jobs = new Map();   // id -> { id, kind, file, status: "running"|"done"|"failed", note, chat, error, started }
  let plugin = { seen: 0, version: "" };

  const rel = (abs) => path.relative(BRAIN, abs).split(path.sep).join("/");
  // A vault note the caller may name: inside the brain, a .md file, not in a dot folder (.obsidian, .git).
  function vaultNote(p) {
    if (typeof p !== "string" || !p.trim() || p.length > 400) return null;
    const abs = path.resolve(BRAIN, p.replace(/^[\\/]+/, ""));
    const r = path.relative(BRAIN, abs);
    if (!r || r.startsWith("..") || path.isAbsolute(r) || r.split(path.sep).some((s) => s.startsWith("."))) return null;
    return /\.md$/i.test(abs) ? abs : null;
  }
  const running = () => [...jobs.values()].filter((j) => j.status === "running").length;
  const stamp = () => { const d = new Date(), z = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}${z(d.getMinutes())}`; };
  const safeName = (s) => String(s || "").replace(/[\\/:*?"<>|#^[\]\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "Answer";
  function newJob(kind, file) {
    const id = Math.random().toString(36).slice(2, 10);
    const j = { id, kind, file: file || "", status: "running", note: "", chat: "", error: "", started: Date.now() };
    jobs.set(id, j);
    if (jobs.size > 50) jobs.delete(jobs.keys().next().value);
    return j;
  }

  /* ---------- ask / task: a normal chat (it shows in Chats), its final answer saved as a note ---------- */
  function startAsk(j, { file, question, selection, mode, kind }) {
    const where = file ? `the note "${file}"` : "no particular note";
    const sel = selection ? `\n\nThe part they selected:\n"""\n${String(selection).slice(0, 6000)}\n"""` : "";
    const prompt = kind === "task"
      ? `[From Obsidian] The user handed you a task from Obsidian, from ${where} (the Obsidian vault is ${BRAIN}, the brain).${sel}\n\nTask: ${question || "Do what the note asks."}\n\nRead the note first. When you're done, end with a short summary of what you did; it is saved as a note in Obsidian next to the task.`
      : `[From Obsidian] The user is reading ${where} in Obsidian (the vault is ${BRAIN}, the brain).${sel}\n\nTheir question: ${question}\n\nRead the note (and notes it links to, if they help) before answering. Your answer is saved as a note in Obsidian, so write clean markdown and link brain notes as [[wikilinks]] by file name where it helps. Don't edit any files.`;
    // Lite: a question (not a task) runs as a small read-only helper on Sonnet (approved by the user 2026-10-13).
    const lean = ctx.LITE && kind !== "task" ? { lean: true, model: "claude-sonnet-5-5" } : {};
    const run = ctx.startChat({ prompt, cwd: BRAIN, mode: kind === "task" ? (mode === "full" ? "full" : "edit") : "read", title: `Obsidian: ${question || file}`, from: "obsidian", ...lean });
    j.run = run.id;
    const tick = setInterval(() => {
      if (run.chatId) j.chat = run.chatId;
      if (!run.done) return;
      clearInterval(tick);
      const res = [...run.events].reverse().find((e) => e.t === "result");
      if (!res || res.error || !String(res.text || "").trim()) { j.status = "failed"; j.error = (res && res.text) || "Claude didn't answer."; return; }
      try {
        fs.mkdirSync(ANSWERS, { recursive: true });
        let f = path.join(ANSWERS, `${stamp()} ${safeName(question || (file && path.basename(file, ".md")))}.md`);
        for (let n = 2; fs.existsSync(f); n++) f = f.replace(/( \(\d+\))?\.md$/, ` (${n}).md`);
        const src = file ? `[[${file.replace(/\.md$/i, "")}]]` : "";
        const front = ["---", `type: ${kind === "task" ? "wise-hive-task" : "wise-hive-answer"}`, `asked: ${new Date(j.started).toISOString()}`,
          src ? `source: "${src}"` : "", j.chat ? `chat: ${j.chat}` : "", "---", ""].filter((l) => l !== "").join("\n");
        const head = `${front}\n# ${kind === "task" ? "Task" : "Q"}: ${String(question || "").replace(/\n+/g, " ").slice(0, 200)}\n\n${src ? `From ${src} · ` : ""}answered by The Wise Hive (continue this chat in the app's Chats).\n\n`;
        fs.writeFileSync(f, head + String(res.text).trim() + "\n");
        j.note = rel(f); j.status = "done";
        ctx.notify({ title: "Answer ready in Obsidian", body: String(question || file).slice(0, 120), view: "chats" });
      } catch (e) { j.status = "failed"; j.error = String(e.message || e); }
    }, 1000);
  }

  /* ---------- council: the app's own /api/council, read to the end; its debate file is the note ---------- */
  function startCouncil(j, idea) {
    const req = http.request({ host: "127.0.0.1", port: ctx.PORT, path: "/api/council", method: "POST", headers: { "Content-Type": "application/json", "X-Hive": "1" } }, (res) => {
      let buf = "";
      res.setEncoding("utf8");
      res.on("data", (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 2);
          if (!line.startsWith("data: ")) continue;
          let ev; try { ev = JSON.parse(line.slice(6)); } catch { continue; }
          if (ev.t === "saved" && ev.file) { j.note = rel(path.resolve(BRAIN, ev.file)); }
          if (ev.error) j.error = String(ev.error);
        }
      });
      res.on("end", () => { j.status = j.note ? "done" : "failed"; if (!j.note && !j.error) j.error = res.statusCode === 200 ? "The council didn't save a debate." : `HTTP ${res.statusCode}`; });
    });
    req.on("error", (e) => { j.status = "failed"; j.error = String(e.message || e); });
    req.end(JSON.stringify({ idea }));
  }

  /* ---------- open a brain note in Obsidian ---------- */
  function openInObsidian(abs) {
    const uri = "obsidian://open?path=" + encodeURIComponent(abs);
    const shell = process.versions.electron ? require("electron").shell : null;
    if (shell) return shell.openExternal(uri).then(() => ({ ok: true }), (e) => ({ error: String(e.message || e) }));
    return new Promise((r) => execFile("cmd.exe", ["/c", "start", "", uri], { windowsHide: true }, (e) => r(e ? { error: String(e.message || e) } : { ok: true })));
  }

  /* ---------- keep the vault's plugin copy in step with app\obsidian-plugin ---------- */
  function syncPlugin() {
    if (!fs.existsSync(PLUGIN_SRC) || !fs.existsSync(VAULT_CFG)) return;
    fs.mkdirSync(PLUGIN_DST, { recursive: true });
    for (const f of fs.readdirSync(PLUGIN_SRC)) {
      const a = path.join(PLUGIN_SRC, f), b = path.join(PLUGIN_DST, f);
      if (!fs.statSync(a).isFile()) continue;
      const want = fs.readFileSync(a);
      if (!fs.existsSync(b) || !want.equals(fs.readFileSync(b))) fs.writeFileSync(b, want);
    }
  }

  async function route(p, req, res, url) {
    if (!p.startsWith("/api/obsidian/")) return false;
    if (p === "/api/obsidian/status" && req.method === "GET") {
      if (url && url.searchParams.get("client") === "plugin") plugin = { seen: Date.now(), version: String(url.searchParams.get("v") || "").slice(0, 20) };
      json(res, 200, { ok: true, app: "The Wise Hive", vault: BRAIN, vaultReady: fs.existsSync(VAULT_CFG), pluginSeen: plugin.seen, pluginVersion: plugin.version, running: running() });
      return true;
    }
    const jm = /^\/api\/obsidian\/job\/([a-z0-9]{1,12})$/.exec(p);
    if (jm && req.method === "GET") {
      const j = jobs.get(jm[1]);
      if (!j) { json(res, 404, { error: "unknown job (The Wise Hive may have restarted)" }); return true; }
      json(res, 200, { id: j.id, kind: j.kind, status: j.status, note: j.note, chat: j.chat, error: j.error });
      return true;
    }
    if (req.method !== "POST") { json(res, 404, { error: "not found" }); return true; }
    const o = await body(req);
    if (p === "/api/obsidian/open") {
      const abs = vaultNote(o.path);
      if (!abs || !fs.existsSync(abs)) { json(res, 400, { error: "That isn't a note in the brain vault." }); return true; }
      json(res, 200, await openInObsidian(abs));
      return true;
    }
    if (p === "/api/obsidian/ask" || p === "/api/obsidian/council") {
      if (running() >= MAX_JOBS) { json(res, 429, { error: `The Wise Hive is already working on ${MAX_JOBS} things from Obsidian. Try again when one finishes.` }); return true; }
      const file = o.file ? (vaultNote(o.file) ? rel(vaultNote(o.file)) : null) : "";
      if (file === null) { json(res, 400, { error: "That note isn't in the brain vault." }); return true; }
      const question = String(o.question || "").trim().slice(0, 4000), selection = String(o.selection || "").slice(0, 6000);
      if (p === "/api/obsidian/council") {
        const idea = (question || selection || (file && fs.readFileSync(path.join(BRAIN, file), "utf8"))).trim().slice(0, 4000);
        if (!idea) { json(res, 400, { error: "Nothing to put to the council: the note is empty." }); return true; }
        const j = newJob("council", file); startCouncil(j, idea);
        json(res, 200, { job: j.id }); return true;
      }
      const kind = o.kind === "task" ? "task" : "ask";
      if (kind === "ask" && !question) { json(res, 400, { error: "Type a question first." }); return true; }
      const j = newJob(kind, file);
      startAsk(j, { file, question, selection, mode: o.mode, kind });
      json(res, 200, { job: j.id, run: j.run }); return true;
    }
    json(res, 404, { error: "not found" });
    return true;
  }

  return {
    route,
    start() { try { syncPlugin(); } catch (e) { console.error("obsidian plugin sync:", e.message); } },
    busy: running,
    _test: { vaultNote, safeName, syncPlugin },
  };
};
