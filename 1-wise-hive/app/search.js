// Search inside chats: GET /api/search?q=...&limit= looks through the words of every chat the Chats list shows
// (what the user and Claude wrote; not tool output) and returns the matching chats with up to 3 highlighted snippets.
// Transcripts are append-only, so each one is read once and then only its new lines are read when it grows.
// Lines over LINE_MAX are tool results with images or big file dumps and are skipped without being buffered.
const fs = require("fs");
const path = require("path");

// Same rule as projectsOverview in server.js: the app's own agent sessions aren't the user's chats.
const HIDE = /^(You are (the [A-Z ]+\b|a message relay)|\[(?:Wise Hive|Teamwright|Hivemind) (training|working|update)\])/; // old tags too: keep-old-name
// CHUNK: how much is read (and parsed) between two yields to the event loop. 1 MB, not 4: the server runs inside the
// Electron main process, and a 4 MB chunk of lines held it (and the window) for up to ~0.5 s during the first index build.
const CHUNK = 1 << 20, LINE_MAX = 400000, MSG_MAX = 60000, FRESH_MS = 3000;
const BEFORE = 60, AFTER = 140;
const stripSys = (t) => String(t || "")
  .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
  .replace(/<\/?pasted_content[^>]*>/g, "")
  .replace(/<command-[a-z-]+>[\s\S]*?<\/command-[a-z-]+>/g, "")
  .trim();

module.exports = (ctx) => {
  const cache = new Map(); // file -> { size, mtime, offset, msgs: [{role, text, low, at}] }
  let refreshing = null, lastRefresh = 0;

  function take(c, line) {
    if (!line.includes('"type":"user"') && !line.includes('"type":"assistant"')) return;
    let e; try { e = JSON.parse(line.toString("utf8")); } catch { return; }
    if ((e.type !== "user" && e.type !== "assistant") || e.isMeta || e.isSidechain) return;
    const ct = e.message && e.message.content;
    const t = typeof ct === "string" ? ct : Array.isArray(ct) ? ct.filter((b) => b && b.type === "text" && b.text).map((b) => b.text).join("\n") : "";
    const text = (e.type === "user" ? stripSys(t) : t.trim()).slice(0, MSG_MAX);
    if (!text) return;
    c.msgs.push({ role: e.type, text, low: text.toLowerCase(), at: e.timestamp || "" });
  }
  // Reads from c.offset to the end in chunks; c.offset only moves past whole lines, so a line still being written is read next time.
  async function scan(file, size, c) {
    const fh = await fs.promises.open(file, "r");
    try {
      const buf = Buffer.alloc(Math.min(CHUNK, Math.max(1, size - c.offset)));
      let pos = c.offset, carry = [], carryLen = 0, skipping = false;
      while (pos < size) {
        const { bytesRead } = await fh.read(buf, 0, Math.min(buf.length, size - pos), pos);
        if (!bytesRead) break;
        let s = 0;
        for (;;) {
          const i = buf.indexOf(10, s);
          if (i < 0 || i >= bytesRead) {
            if (!skipping) {
              if (carryLen + bytesRead - s > LINE_MAX) { skipping = true; carry = []; carryLen = 0; }
              else { carry.push(Buffer.from(buf.subarray(s, bytesRead))); carryLen += bytesRead - s; }
            }
            break;
          }
          if (!skipping && carryLen + i - s <= LINE_MAX) take(c, carry.length ? Buffer.concat([...carry, buf.subarray(s, i)]) : buf.subarray(s, i));
          carry = []; carryLen = 0; skipping = false; s = i + 1;
          c.offset = pos + s;
        }
        pos += bytesRead;
        await new Promise((ok) => setImmediate(ok)); // let chats and streams breathe during the first big read
      }
    } finally { await fh.close(); }
  }
  async function refresh() {
    if (Date.now() - lastRefresh < FRESH_MS) return;
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const files = ctx.listTranscripts(), seen = new Set(files);
      for (const f of [...cache.keys()]) if (!seen.has(f)) cache.delete(f);
      for (const f of files) {
        let st; try { st = await fs.promises.stat(f); } catch { continue; }
        let c = cache.get(f);
        if (c && c.size === st.size && c.mtime === st.mtimeMs) continue;
        if (!c || st.size < c.offset) { c = { size: 0, mtime: 0, offset: 0, msgs: [] }; cache.set(f, c); } // new, or rewritten shorter
        try { await scan(f, st.size, c); c.size = st.size; c.mtime = st.mtimeMs; } catch {}
      }
      lastRefresh = Date.now();
    })().finally(() => { refreshing = null; });
    return refreshing;
  }

  // A window around the first hit, cut at word boundaries, with every word's hits marked as [start, end] in the snippet.
  function snippet(m, words) {
    const low = m.low.length === m.text.length ? m.low : null, src = low ? m.text : m.low, hay = low || m.low;
    let first = Infinity;
    for (const w of words) { const i = hay.indexOf(w); if (i >= 0 && i < first) first = i; }
    if (first === Infinity) return null;
    let a = Math.max(0, first - BEFORE), b = Math.min(src.length, first + AFTER);
    if (a > 0) { const sp = src.indexOf(" ", a); if (sp >= 0 && sp < first) a = sp + 1; }
    if (b < src.length) { const sp = src.lastIndexOf(" ", b); if (sp > first + 20) b = sp; }
    const pre = a > 0 ? "…" : "", text = pre + src.slice(a, b).replace(/\s+/g, " ") + (b < src.length ? "…" : "");
    const lowText = text.toLowerCase(), hits = [];
    for (const w of words) for (let i = lowText.indexOf(w); i >= 0; i = lowText.indexOf(w, i + w.length)) hits.push([i, i + w.length]);
    hits.sort((x, y) => x[0] - y[0]);
    const merged = [];
    for (const h of hits) { const last = merged[merged.length - 1]; if (last && h[0] <= last[1]) last[1] = Math.max(last[1], h[1]); else merged.push(h); }
    return { role: m.role === "user" ? "you" : "claude", text, hits: merged };
  }

  async function search(q, limit) {
    const words = [...new Set(String(q || "").toLowerCase().split(/\s+/).filter(Boolean))].slice(0, 8);
    if (!words.length) return { results: [], total: 0 };
    await refresh();
    const out = [], metas = new Map();
    for (const m of await ctx.sessionMetas()) metas.set(m.id, m);
    for (const [file, c] of cache) {
      const meta = metas.get(path.basename(file, ".jsonl"));
      if (!meta || HIDE.test(meta.title)) continue;
      // All words must appear somewhere in the chat (not necessarily in one message).
      if (!words.every((w) => c.msgs.some((m) => m.low.includes(w)))) continue;
      // Messages with the most different words first; ties go to the newest.
      const scored = [];
      c.msgs.forEach((m, i) => { const n = words.filter((w) => m.low.includes(w)).length; if (n) scored.push({ m, n, i }); });
      scored.sort((x, y) => y.n - x.n || y.i - x.i);
      const snippets = scored.slice(0, 3).map((s) => snippet(s.m, words)).filter(Boolean);
      const hits = scored.reduce((n, s) => n + s.n, 0);
      out.push({ id: meta.id, title: meta.title, project: meta.project, updated: meta.updated, started: meta.started, matches: scored.length, hits, snippets });
    }
    out.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
    return { results: out.slice(0, limit), total: out.length, words };
  }

  return {
    async route(p, req, res, url) {
      if (p !== "/api/search") return false;
      if (req.method !== "GET") { ctx.json(res, 405, { error: "use GET" }); return true; }
      const q = String(url.searchParams.get("q") || "").slice(0, 200).trim();
      const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit"), 10) || 20));
      if (q.length < 2) { ctx.json(res, 200, { results: [], total: 0 }); return true; }
      ctx.json(res, 200, await search(q, limit));
      return true;
    },
    // Warm the index in the background after start, so the first search is quick (skipped on test servers).
    start() { const t = setTimeout(() => refresh().catch(() => {}), 20000); if (t.unref) t.unref(); },
  };
};
