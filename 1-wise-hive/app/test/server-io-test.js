// server.js request bodies and chat history (2026-10-13): starts server.js on a spare port with a scratch brain and a
// scratch Claude config folder, then checks that
//   - a JSON body whose multi-byte character arrives split across two packets is decoded intact,
//   - a body over the cap (HIVE_BODY_MAX, 1 MB here) is answered 413 and the server keeps answering,
//   - GET /api/sessions/<id> (which now reads only the tail of a transcript) returns exactly what the old whole-file
//     reader returned (kept below as `reference`), on transcripts built to cross its 1 MB read chunks: a 1.5 MB line,
//     a 2.5 MB assistant turn that is the oldest of the 400 kept messages, multi-byte text, CRLF, noise lines, 400/401
//     messages, no final newline, an empty file.
// Free: no Claude runs. Files go under app\.research (C: is nearly full) and are removed at the end.
//   node test/server-io-test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const net = require("net");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const APP = path.resolve(__dirname, "..");
const TMP = path.join(APP, ".research", "server-io-unit-" + process.pid);
const BRAIN = path.join(TMP, "brain"), CFG = path.join(TMP, "claude"), PROJ = path.join(CFG, "projects", "D--scratch");
let passed = 0, failed = 0, child = null;
async function test(name, fn) { try { await fn(); passed++; console.log("PASS", name); } catch (e) { failed++; console.log("FAIL", name + ":", e && e.stack || e); } }

/* ---------- the old reader (server.js before 2026-10-13), the reference ---------- */
const stripSys = (t) => String(t || "")
  .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
  .replace(/<pasted_content[^>]*>[\s\S]*?<\/pasted_content>/g, "[pasted text]")
  .replace(/<command-[a-z-]+>[\s\S]*?<\/command-[a-z-]+>/g, "")
  .trim();
function toolSummary(name, inp = {}) {
  const s = inp.description || inp.file_path || inp.path || inp.command || inp.pattern || inp.url || inp.query || inp.skill || inp.prompt || "";
  return String(s).replace(/\s+/g, " ").slice(0, 120);
}
function reference(file) {
  const msgs = [];
  let src = null; try { src = fs.readFileSync(file, "utf8"); } catch {}
  for (const line of (src || "").split("\n")) {
    let e; try { e = JSON.parse(line); } catch { continue; }
    if ((e.type !== "user" && e.type !== "assistant") || e.isMeta || e.isSidechain) continue;
    const ct = e.message && e.message.content;
    if (e.type === "user") {
      const t = typeof ct === "string" ? ct : Array.isArray(ct) ? ct.filter((b) => b.type === "text").map((b) => b.text).join("\n") : "";
      const s = stripSys(t);
      if (s) msgs.push({ role: "user", text: s });
      continue;
    }
    let last = msgs[msgs.length - 1];
    if (!last || last.role !== "assistant") { last = { role: "assistant", text: "", tools: [] }; msgs.push(last); }
    for (const b of Array.isArray(ct) ? ct : []) {
      if (b.type === "text" && b.text) last.text += (last.text ? "\n\n" : "") + b.text;
      if (b.type === "tool_use") last.tools.push({ name: b.name, summary: toolSummary(b.name, b.input) });
    }
  }
  return msgs.slice(-400);
}

/* ---------- transcript lines ---------- */
let seed = 7;
const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
const WORDS = ["hive", "héllo", "漢字", "🐝", "ünïcödé", "–", "brass", "lantern", "Ω", "naïve", "日本語", "x"];
const text = (n) => { const out = []; let len = 0; while (len < n) { const w = WORDS[rnd(WORDS.length)]; out.push(w); len += w.length + 1; } return out.join(" "); };
const L = {
  user: (t) => JSON.stringify({ type: "user", message: { role: "user", content: t } }),
  userBlocks: (t) => JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: t }, { type: "image", source: { type: "base64", data: "AAAA" } }] } }),
  result: () => JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t" + rnd(999), content: text(200) }] } }),
  reminder: () => JSON.stringify({ type: "user", message: { role: "user", content: "<system-reminder>" + text(80) + "</system-reminder>" } }),
  meta: () => JSON.stringify({ type: "user", isMeta: true, message: { role: "user", content: "meta " + text(40) } }),
  side: () => JSON.stringify({ type: "assistant", isSidechain: true, message: { content: [{ type: "text", text: "side " + text(40) }] } }),
  asst: (t, tool) => JSON.stringify({ type: "assistant", message: { content: [...(t ? [{ type: "text", text: t }] : []), ...(tool ? [{ type: "tool_use", name: "Read", input: { file_path: "D:\\x\\" + tool, description: "read  " + tool } }] : [])] } }),
  think: () => JSON.stringify({ type: "assistant", message: { content: [{ type: "thinking", thinking: text(100) }] } }),
  noise: () => [JSON.stringify({ type: "system", subtype: "progress", text: text(60) }), "not json at all", "", JSON.stringify({ type: "summary", summary: text(30) })][rnd(4)],
};
// One "turn": a user message, then an assistant turn of 1-6 lines with tool results and noise between them.
function turn(lines, size) {
  lines.push(rnd(3) ? L.user(text(20 + rnd(size))) : L.userBlocks(text(20 + rnd(size))));
  const k = 1 + rnd(6);
  for (let i = 0; i < k; i++) {
    lines.push(rnd(5) ? L.asst(rnd(4) ? text(10 + rnd(size)) : "", rnd(2) ? "f" + i : null) : L.think());
    if (i < k - 1) lines.push([L.result, L.result, L.noise, L.reminder, L.meta, L.side][rnd(6)]());
  }
}
const write = (name, lines, { crlf = false, finalNewline = true } = {}) => {
  const f = path.join(PROJ, name + ".jsonl");
  fs.writeFileSync(f, lines.map((l, i) => (crlf && i % 3 === 0 ? l + "\r" : l)).join("\n") + (finalNewline ? "\n" : ""));
  return name;
};

/* ---------- server ---------- */
const freePort = () => new Promise((ok) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => ok(p)); }); });
function req(port, p, { method = "GET", parts = null, timeout = 20000 } = {}) {
  return new Promise((ok, no) => {
    const r = http.request({ host: "127.0.0.1", port, path: p, method, headers: { "x-hive": "1", "Content-Type": "application/json" }, timeout }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => { const t = Buffer.concat(chunks).toString("utf8"); let j; try { j = JSON.parse(t); } catch {} ok({ status: res.statusCode, json: j, text: t }); });
      res.on("error", () => {});
    });
    r.on("timeout", () => r.destroy(new Error("no answer")));
    r.on("error", (e) => no(e));
    if (!parts) return r.end();
    // Each part is written on its own, 150 ms apart, so the server gets them as separate chunks.
    (async () => { for (const b of parts) { r.write(b); await new Promise((t) => setTimeout(t, 150)); } r.end(); })();
  });
}

(async () => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(BRAIN, { recursive: true }); fs.mkdirSync(PROJ, { recursive: true });

  // Transcripts.
  const files = [];
  { const l = []; for (let i = 0; i < 12; i++) turn(l, 300); files.push(write("small", l)); }
  { const l = []; for (let i = 0; i < 700; i++) turn(l, 3000); files.push(write("big", l, { crlf: true })); }
  { // a 1.5 MB line inside the kept 400, another before them, and no final newline
    const l = []; for (let i = 0; i < 150; i++) turn(l, 500);
    l.push(L.user("before the long line"), L.asst(text(1.5e6), "huge-old"));
    for (let i = 0; i < 300; i++) turn(l, 500);
    l.push(L.user("the long line"), L.asst(text(1.5e6), "huge"), L.result(), L.asst("after it", "f"));
    for (let i = 0; i < 40; i++) turn(l, 500);
    files.push(write("longline", l, { finalNewline: false }));
  }
  { // a 2.5 MB assistant turn that is exactly the 400th newest message: the reader must take all of it, and no more
    const l = []; for (let i = 0; i < 100; i++) turn(l, 400);
    l.push(L.user("the message before the long turn"));
    for (let i = 0; i < 300; i++) { l.push(L.asst(text(8000), "run" + i)); l.push(i % 2 ? L.result() : L.noise()); }
    for (let k = 0; k < 399; k++) l.push(k % 2 ? L.asst(text(300), "a" + k) : L.user(text(300)));
    files.push(write("longturn", l));
  }
  { const l = []; for (let k = 0; k < 400; k++) l.push(k % 2 ? L.asst(text(3000)) : L.user(text(3000))); files.push(write("exact400", l)); }
  { const l = []; for (let k = 0; k < 401; k++) l.push(k % 2 ? L.asst(text(3000)) : L.user(text(3000))); files.push(write("exact401", l)); }
  { const l = []; for (let k = 0; k < 2000; k++) l.push(L.noise()); files.push(write("noise", l)); }
  files.push(write("empty", []));
  fs.writeFileSync(path.join(PROJ, "empty.jsonl"), "");

  const port = await freePort();
  let out = "";
  child = spawn(process.execPath, [path.join(APP, "server.js")], { cwd: APP, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, HIVE_PORT: String(port), TEAMWRIGHT_BRAIN: BRAIN, CLAUDE_CONFIG_DIR: CFG, HIVE_BODY_MAX: String(1 << 20) } });
  child.stdout.on("data", (d) => (out += d)); child.stderr.on("data", (d) => (out += d));
  for (const end = Date.now() + 20000; Date.now() < end && !out.includes(`127.0.0.1:${port}`); await new Promise((r) => setTimeout(r, 100)));
  assert.ok(out.includes(`127.0.0.1:${port}`), "the server didn't start:\n" + out.slice(-2000));

  await test("a multi-byte character split across two packets arrives intact", async () => {
    const want = "héllo – 漢字 🐝 ünïcödé";
    const raw = Buffer.from(JSON.stringify({ target: want }), "utf8");
    const at = raw.indexOf(Buffer.from("🐝", "utf8")) + 2; // inside the bee's 4 bytes
    const r = await req(port, "/api/link/config", { method: "POST", parts: [raw.subarray(0, at), raw.subarray(at)] });
    assert.strictEqual(r.status, 200, r.text);
    assert.strictEqual(r.json.target, want);
  });

  await test("a body over the cap is answered 413, and the server keeps answering", async () => {
    const big = Buffer.from(JSON.stringify({ target: "x".repeat(1.5 * (1 << 20)) }));
    const r = await req(port, "/api/link/config", { method: "POST", parts: [big] }).catch((e) => ({ error: e.message }));
    assert.strictEqual(r.status, 413, JSON.stringify(r).slice(0, 300));
    assert.ok(r.json && /too large/.test(r.json.error), r.text);
    const s = await req(port, "/api/stats");
    assert.strictEqual(s.status, 200);
    const small = await req(port, "/api/link/config", { method: "POST", parts: [Buffer.from(JSON.stringify({ target: "under the cap" }))] });
    assert.strictEqual(small.json.target, "under the cap");
  });

  for (const id of files) {
    await test(`/api/sessions/${id}: the tail reader returns what the whole-file reader did`, async () => {
      const r = await req(port, "/api/sessions/" + id);
      assert.strictEqual(r.status, 200, r.text.slice(0, 300));
      const want = reference(path.join(PROJ, id + ".jsonl"));
      assert.strictEqual(r.json.messages.length, want.length, "message count");
      assert.deepStrictEqual(r.json.messages, want);
      assert.strictEqual(r.json.meta.id, id);
      if (id === "longturn") assert.ok(want[0].role === "assistant" && want[0].tools.length === 300, "the long turn is whole and first");
      const has = (s) => want.some((m) => (m.tools || []).some((t) => t.summary === s));
      if (id === "longline") assert.ok(has("read huge") && !has("read huge-old"), "the 1.5 MB line is kept, the older one isn't");
    });
  }
})().catch((e) => { failed++; console.log("FAIL test script:", e && e.stack || e); }).finally(() => {
  try { if (child) child.kill(); } catch {}
  setTimeout(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} console.log(`${failed ? "FAILED" : "PASSED"}: ${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0); }, 300);
});
