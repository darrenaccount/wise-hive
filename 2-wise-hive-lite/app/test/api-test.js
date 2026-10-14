// The Wise Hive API test: starts server.js on a spare port (HIVE_PORT, so module start() and schedules are skipped), then
// checks that the API answers in the shapes the page expects, that it refuses outside callers, and that every
// static file loads. Read-only and free: it never starts a Claude run unless --live is given (one tiny Haiku chat).
// The updater runs it after the smoke test and rolls an adapt back if any line says FAIL.
//
//   node test/api-test.js [--port 4798] [--live]
//
// Other features can add their routes to test/extra-routes.json without touching this file:
//   { "routes": [ { "path": "/api/usage", "type": "object", "keys": ["days"], "optional": true } ] }
// type: "object" | "array" (default "object"); keys: fields that must exist; optional: a 404 counts as SKIP.
// Only list GET routes that never start Claude.
// "unit": ["jobs-test.js"] lists free unit tests in test\ that this script runs too (each must exit 0 within 30 s).
// Verified 2026-10-12 against The Wise Hive on Node 24.
"use strict";
const http = require("http");
const net = require("net");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const APP = path.resolve(__dirname, "..");
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : (argv.find((a) => a.startsWith(n + "=")) || "").split("=")[1]; };
const LIVE = flag("--live");
const WANT = Number(opt("--port") || argv.find((a) => /^\d+$/.test(a))) || 4798;
// Stays well under the updater's own limit, so the server child is always cleaned up by this script.
const DEADLINE = LIVE ? 150000 : 60000;
const t0 = Date.now();
let child = null, out = "", exited = null;
const results = [];

function freePort(prefer) {
  const tryPort = (p) => new Promise((ok) => { const s = net.createServer(); s.once("error", () => ok(null)); s.listen(p, "127.0.0.1", () => { const got = s.address().port; s.close(() => ok(got)); }); });
  return tryPort(prefer).then((p) => p || tryPort(0));
}
// One request; resolves { status, type, text, json } or { error }.
function req(port, p, { method = "GET", headers = { "x-hive": "1" }, body, timeout = 30000 } = {}) {
  return new Promise((ok) => {
    const r = http.request({ host: "127.0.0.1", port, path: p, method, headers: { ...headers, ...(body ? { "Content-Type": "application/json" } : {}) }, timeout }, (res) => {
      let b = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (b += c));
      res.on("end", () => { let j; try { j = JSON.parse(b); } catch {} ok({ status: res.statusCode, type: String(res.headers["content-type"] || ""), headers: res.headers, text: b, json: j }); });
    });
    r.on("timeout", () => r.destroy(new Error(`no answer within ${timeout / 1000} s`)));
    r.on("error", (e) => ok({ error: e.message }));
    if (body) r.write(body);
    r.end();
  });
}
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const keys = (o, ks) => { const miss = ks.filter((k) => !(k in o)); return miss.length ? `missing ${miss.join(", ")}` : true; };
function report(status, name, why) {
  results.push(status);
  console.log(`${status} ${name}${why ? ": " + why : ""}`);
}
// fn(response) returns true for a pass, a string saying what's wrong, or "SKIP: why".
async function check(port, name, p, opts, fn) {
  const r = await req(port, p, opts);
  if (r.error) return report("FAIL", name, r.error);
  let v;
  try { v = fn(r); } catch (e) { v = `threw ${e.message}`; }
  if (v === true) report("PASS", name);
  else if (typeof v === "string" && v.startsWith("SKIP")) report("SKIP", name, v.slice(5).trim());
  else {
    const why = v || "wrong shape", err = r.json && r.json.error ? String(r.json.error).slice(0, 120) : "";
    report("FAIL", name, /^HTTP \d+/.test(why) ? `${why}${err ? ` (${err})` : ""}` : `${why} (HTTP ${r.status}${err ? `, ${err}` : ""})`);
  }
  return r;
}
// A JSON route: HTTP 200 plus the shape test.
const ok200 = (shape) => (r) => (r.status !== 200 ? `HTTP ${r.status}` : r.json === undefined ? "not JSON" : shape(r.json));
const obj = (...ks) => ok200((j) => (isObj(j) ? keys(j, ks) : "not an object"));
const arr = (item) => ok200((j) => (!Array.isArray(j) ? "not an array" : item && j.length ? item(j[0]) : true));
const status = (code) => (r) => (r.status === code ? true : `expected HTTP ${code}`);

async function startServer() {
  const port = await freePort(WANT);
  if (!port) throw new Error("no free port");
  child = spawn(process.execPath, [path.join(APP, "server.js")], { cwd: APP, env: { ...process.env, HIVE_PORT: String(port) }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  child.on("exit", (c) => (exited = c == null ? "killed" : c));
  child.on("error", (e) => { exited = -1; out += String(e); });
  // The listen line proves the answers come from this server, not something else on the port.
  for (const end = Date.now() + 20000; Date.now() < end && exited == null; await new Promise((r) => setTimeout(r, 300))) {
    if (out.includes(`127.0.0.1:${port}`)) { const r = await req(port, "/api/stats", { timeout: 3000 }); if (r.status === 200) return port; }
  }
  throw new Error(`the server didn't answer within 20 s${exited != null ? ` (it exited with ${exited})` : ""}\n${out.trim().split(/\r?\n/).slice(-8).join("\n")}`);
}
function stop() { if (child && exited == null) { try { child.kill(); } catch {} } }

async function main() {
  let port;
  try { port = await startServer(); }
  catch (e) { report("FAIL", "server starts", e.message); return; }
  report("PASS", `server starts on port ${port}`);
  const failed = [...out.matchAll(/module failed to load: (\S+)/g)].map((m) => m[1]);
  report(failed.length ? "FAIL" : "PASS", "every feature module loads", failed.length ? failed.join(", ") : "");
  const C = (name, p, fn, opts) => check(port, name, p, opts, fn);
  const J = { "x-hive": "1" };

  // Security: only the app itself may call the API.
  await Promise.all([
    C("no x-hive header is refused", "/api/stats", status(403), { headers: {} }),
    C("a foreign Origin is refused", "/api/stats", status(403), { headers: { ...J, Origin: "http://evil.example" } }),
    C("the app's own Origin is allowed", "/api/stats", status(200), { headers: { ...J, Origin: `http://127.0.0.1:${port}` } }),
    C("POST /api/chat without x-hive is refused", "/api/chat", status(403), { method: "POST", headers: {}, body: "{}" }),
    // DNS rebinding: another name pointing at 127.0.0.1 sends no Origin on same-origin GETs, so the Host header decides.
    C("another host name is refused (API)", "/api/stats", status(403), { headers: { ...J, Host: `evil.example:${port}` } }),
    C("another host name is refused (page)", "/", status(403), { headers: { Host: `evil.example:${port}` } }),
    C("localhost is allowed", "/api/stats", status(200), { headers: { ...J, Host: `localhost:${port}` } }),
    C("Obsidian's origin can't reach other routes", "/api/stats", status(403), { headers: { ...J, Origin: "app://obsidian.md" } }),
    C("Obsidian's origin reaches /api/obsidian/", "/api/obsidian/status", status(200), { headers: { ...J, Origin: "app://obsidian.md" } }),
    C("activity reports what restarts must wait for", "/api/activity", obj("runs", "jobs", "busy"), { headers: J }),
    C("unknown API route is 404", "/api/definitely-not-a-route", status(404)),
    C("path traversal stays in public/ (..%2f)", "/..%2f..%2fserver.js", (r) => (r.status !== 200 && !/require\("http"\)/.test(r.text) ? true : "server.js was served")),
    C("path traversal stays in public/ (%2e%2e)", "/%2e%2e/server.js", (r) => (!/require\("http"\)/.test(r.text) ? true : "server.js was served")),
  ]);

  // Core routes (server.js).
  const [, , sessions] = await Promise.all([
    C("GET /api/stats", "/api/stats", ok200((j) => (["memories", "skills", "sessions", "lessons"].every((k) => typeof j[k] === "number") ? true : "counts aren't numbers"))),
    C("GET /api/memories", "/api/memories", arr((m) => keys(m, ["file", "name", "body"]))),
    C("GET /api/sessions", "/api/sessions", arr((s) => keys(s, ["id", "title", "updated"]))),
    C("GET /api/skills", "/api/skills", ok200((j) => (Array.isArray(j.skills) && Array.isArray(j.lessons) ? true : "skills/lessons aren't arrays"))),
    C("GET /api/runs", "/api/runs", arr()),
    C("GET /api/activity", "/api/activity", ok200((j) => (Array.isArray(j.runs) && Array.isArray(j.jobs) ? true : "runs/jobs aren't arrays"))),
    C("GET /api/projects", "/api/projects", arr((p) => keys(p, ["dir", "name", "chats"]))),
    C("GET /api/folders", "/api/folders", arr((f) => (typeof f === "string" ? true : "not a list of paths"))),
    C("GET /api/system", "/api/system", ok200((j) => (isObj(j.server) && typeof j.server.pid === "number" && isObj(j.claude) && isObj(j.watchdog) ? true : "missing server/claude/watchdog"))),
    C("GET /api/sketches", "/api/sketches", arr((s) => keys(s, ["file", "title", "at"]))),
    C("GET /api/link", "/api/link", ok200((j) => (Array.isArray(j.messages) && isObj(j.config) ? true : "messages/config wrong"))),
    C("GET /api/prompts", "/api/prompts", ok200((j) => (typeof j.library === "string" && Array.isArray(j.history) ? true : "library/history wrong"))),
    C("GET /api/clarify/<key>", "/api/clarify/apitest-probe-key", ok200((j) => (Array.isArray(j.questions) ? true : "questions isn't an array"))),
    C("GET /api/clarify/<bad key> is 400", "/api/clarify/x", status(400)),
    C("GET /api/sessions/<missing> is 404", "/api/sessions/apitest-no-such-session", status(404)),
  ]);
  const first = sessions && Array.isArray(sessions.json) && sessions.json[0];
  if (first) await C("GET /api/sessions/<first id>", `/api/sessions/${encodeURIComponent(first.id)}`, ok200((j) => (isObj(j.meta) && j.meta.id === first.id && Array.isArray(j.messages) ? true : "meta/messages wrong")));
  else report("SKIP", "GET /api/sessions/<first id>", "no sessions");

  // Feature modules.
  const [, , , , , , hist] = await Promise.all([
    C("GET /api/ideas/<key>", "/api/ideas/apitest-probe-key", ok200((j) => (Array.isArray(j.ideas) && Array.isArray(j.takes) && typeof j.working === "boolean" ? true : "ideas/takes/working wrong"))),
    C("GET /api/ideas-backlog", "/api/ideas-backlog", ok200((j) => (typeof j.text === "string" ? true : "text isn't a string"))),
    C("GET /api/autopilot", "/api/autopilot", ok200((j) => (isObj(j.training) && isObj(j.working) ? true : "training/working missing"))),
    C("GET /api/autopilot/training", "/api/autopilot/training", ok200((j) => (Array.isArray(j.log) ? true : "log isn't an array"))),
    C("GET /api/autopilot/working", "/api/autopilot/working", ok200((j) => (Array.isArray(j.log) ? true : "log isn't an array"))),
    C("GET /api/updates", "/api/updates", ok200((j) => (isObj(j.state) && isObj(j.state.versions) && Array.isArray(j.state.history) && typeof j.busy === "boolean" ? true : "state/versions/history/busy wrong"))),
    C("GET /api/history", "/api/history", ok200((j) => (typeof j.repo === "boolean" && Array.isArray(j.commits) ? true : "repo/commits wrong"))),
    C("POST /api/updates/adapt without force is 400", "/api/updates/adapt", status(400), { method: "POST", body: "{}" }),
  ]);
  const h = hist && hist.json;
  if (h && h.repo && h.commits.length) {
    const c = h.commits[0];
    await Promise.all([
      C("GET /api/history/<hash>/diff", `/api/history/${c.short}/diff`, ok200((j) => (typeof j.diff === "string" && typeof j.truncated === "boolean" ? true : "diff/truncated wrong"))),
      C("history commits have hash, date, subject, files", "/api/history", ok200((j) => keys(j.commits[0] || {}, ["hash", "short", "date", "subject", "files"]))),
      C("GET /api/history/<bad hash>/diff is 400", "/api/history/not-a-hash/diff", status(400)),
      C("GET /api/history/<hash>/restore is 405", `/api/history/${c.short}/restore`, status(405)),
      C("POST restore without confirm is 400", `/api/history/${c.short}/restore`, status(400), { method: "POST", body: "{}" }),
    ]);
  } else report("SKIP", "history diff and restore guards", h && !h.repo ? `no repo (${h.why})` : "no commits");

  // Routes other features register in test/extra-routes.json.
  let extra = [], units = [];
  const xf = path.join(__dirname, "extra-routes.json");
  if (fs.existsSync(xf)) {
    try { const x = JSON.parse(fs.readFileSync(xf, "utf8")); extra = x.routes || []; units = Array.isArray(x.unit) ? x.unit : []; }
    catch (e) { report("FAIL", "test/extra-routes.json parses", e.message); }
  }
  await Promise.all(extra.filter((x) => x && /^\/api\//.test(x.path || "")).map((x) => C(`GET ${x.path}${x.optional ? " (optional)" : ""}`, x.path, (r) => {
    if (x.optional && r.status === 404) return "SKIP not there yet";
    if (r.status !== 200) return `HTTP ${r.status}`;
    if (r.json === undefined) return "not JSON";
    if ((x.type || "object") === "array") return Array.isArray(r.json) ? true : "not an array";
    return isObj(r.json) ? keys(r.json, x.keys || []) : "not an object";
  })));
  for (const u of units) await unit(u);

  // Static files: the page, every script it includes, and every script in public/.
  const page = await C("GET / (index.html)", "/", (r) => (r.status === 200 && /text\/html/.test(r.type) && /<script/i.test(r.text) ? true : "not the app page"), { headers: {} });
  const srcs = new Set([...String(page.text || "").matchAll(/<script[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]).filter((s) => s.startsWith("/")));
  const walk = (dir, rel) => { for (const d of fs.readdirSync(dir, { withFileTypes: true })) { if (d.isDirectory()) walk(path.join(dir, d.name), rel + d.name + "/"); else if (/\.js$/i.test(d.name)) srcs.add(rel + d.name); } };
  try { walk(path.join(APP, "public"), "/"); } catch {}
  await Promise.all([...srcs].sort().map((s) => C(`GET ${s}`, s, (r) => (r.status === 200 && r.text.length > 0 ? true : `HTTP ${r.status}`), { headers: {} })));
  // The page's security policy: scripts only from this server (no inline script), styles and fonts as the page needs.
  const csp = String((page.headers || {})["content-security-policy"] || "");
  report(/script-src 'self'(;|$)/.test(csp) && !/<script>/i.test(page.text || "") ? "PASS" : "FAIL", "the page has a script-src 'self' policy and no inline script", csp ? "" : "no Content-Security-Policy header");
  await Promise.all([
    C("GET /app.css", "/app.css", (r) => (r.status === 200 && /text\/css/.test(r.type) ? true : `HTTP ${r.status} ${r.type}`), { headers: {} }),
    C("a folder path is a 404, not a hung request", "/scenes", status(404), { headers: {}, timeout: 5000 }),
  ]);

  // One real chat on Haiku, only when asked: costs a little and needs Claude Code signed in.
  if (LIVE) await live(port);
}

// A free unit test listed under "unit" in extra-routes.json: PASS when it exits 0 within 30 s.
function unit(name) {
  return new Promise((done) => {
    const f = path.join(__dirname, String(name));
    if (!/^[\w.-]+\.js$/.test(String(name)) || !fs.existsSync(f)) { report("FAIL", `unit test ${name}`, "not a test file in test\\"); return done(); }
    let txt = "", fin = false;
    const c = spawn(process.execPath, [f], { cwd: APP, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const end = (code) => { if (fin) return; fin = true; clearTimeout(t); const tail = txt.trim().split(/\r?\n/).filter((l) => /FAIL|Error|error/.test(l)).slice(-3).join(" | ");
      report(code === 0 ? "PASS" : "FAIL", `unit test ${name}`, code === 0 ? "" : `exit ${code}${tail ? ": " + tail.slice(0, 300) : ""}`); done(); };
    const t = setTimeout(() => { try { c.kill(); } catch {} end("timeout"); }, 30000);
    c.stdout.on("data", (d) => (txt += d)); c.stderr.on("data", (d) => (txt += d));
    c.on("exit", (code) => end(code)); c.on("error", (e) => { txt += String(e); end(-1); });
  });
}

// POST /api/chat streams events; a pass is a result that says HIVE-OK.
function live(port) {
  return new Promise((done) => {
    const body = JSON.stringify({ prompt: "[Wise Hive test] Reply with exactly: HIVE-OK", model: "claude-haiku-5-5", mode: "read", maxTurns: 1, title: "[Wise Hive test] live check" });
    let buf = "", res = null, finished = false;
    const end = (status, why) => { if (finished) return; finished = true; report(status, "live Haiku chat (--live)", why); try { r.destroy(); } catch {} done(); };
    const r = http.request({ host: "127.0.0.1", port, path: "/api/chat", method: "POST", headers: { "x-hive": "1", "Content-Type": "application/json" } }, (resp) => {
      if (resp.statusCode !== 200) return end("FAIL", `HTTP ${resp.statusCode}`);
      resp.setEncoding("utf8");
      resp.on("data", (c) => {
        buf += c;
        for (const m of buf.matchAll(/^data: (.+)$/gm)) { let e; try { e = JSON.parse(m[1]); } catch { continue; } if (e.t === "result") res = e; if (e.t === "end") return end(res && !res.error && /HIVE-OK/.test(res.text) ? "PASS" : "FAIL", res ? (res.error ? `error: ${String(res.text).slice(0, 160)}` : res.text.includes("HIVE-OK") ? "" : `answered: ${String(res.text).slice(0, 160)}`) : `ended without a result${e.err ? ": " + String(e.err).slice(0, 160) : ""}`); }
      });
      resp.on("end", () => end(res && !res.error && /HIVE-OK/.test(res.text) ? "PASS" : "FAIL", res ? "" : "the stream ended without a result"));
    });
    r.on("error", (e) => end("FAIL", e.message));
    setTimeout(() => end("FAIL", "no answer within 120 s"), 120000).unref();
    r.end(body);
  });
}

const guard = setTimeout(() => { report("FAIL", "whole test", `didn't finish within ${DEADLINE / 1000} s`); finish(); }, DEADLINE);
function finish() {
  clearTimeout(guard);
  stop();
  const n = (s) => results.filter((x) => x === s).length;
  console.log(`${n("FAIL") ? "FAILED" : "PASSED"}: ${n("PASS")} passed, ${n("FAIL")} failed, ${n("SKIP")} skipped in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  process.exit(n("FAIL") || !n("PASS") ? 1 : 0);
}
process.on("SIGINT", () => { report("FAIL", "whole test", "interrupted"); finish(); });
main().catch((e) => report("FAIL", "test script", e && e.stack || String(e))).then(finish);
