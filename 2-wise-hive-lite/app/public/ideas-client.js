/* Inventor: the page side of ideas.js. An avatar beside the Clarifier's in the chat header, and a side panel with
   Claude's take on the chat and new ideas to try. Ideas belong to a chat id: a per-chat cache keeps each chat's own,
   and answers that arrive after the user switched chats are stored but not drawn. */
(function () {
  "use strict";
  const KEY = /^[\w-]{6,80}$/;
  const DEBOUNCE = 2000, CTX_MSGS = 8, MSG_MAX = 1500;
  const EFFORT = { quick: "Quick", medium: "Medium", big: "Big" };
  const DONE = ["used", "dismissed"];

  const style = document.createElement("style");
  style.textContent = `
.convo.ideas-on header{padding-right:138px}
.ideas-av{position:absolute;top:6px;right:76px;z-index:6;width:48px;height:42px;border:1px solid var(--line);background:var(--surface);border-radius:14px;padding:4px 6px;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.08)}
.ideas-av:hover{border-color:var(--muted)}
.ideas-av .bob{width:38px;display:block}
.ideas-badge{position:absolute;top:-7px;right:-7px;min-width:20px;height:20px;padding:0 5px;border-radius:999px;background:var(--gold);color:var(--bg);font:700 12px/20px var(--f-body);text-align:center;border:2px solid var(--surface)}
.ideas-panel{position:absolute;top:0;right:0;bottom:0;width:320px;z-index:5;border-radius:0;border-width:0 0 0 1px;padding:0;display:flex;flex-direction:column;animation:ideasIn .18s ease-out}
@keyframes ideasIn{from{transform:translateX(24px);opacity:0}}
.convo.ideas-open{padding-right:320px}
.convo.ideas-open .clar-av{right:338px}
.convo.ideas-open .ideas-av,.convo.clar-open .ideas-av{right:392px}
.ideas-panel > header{padding:14px 14px 10px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:8px}
.ideas-panel > header b{font-family:var(--f-display);font-size:17px}
.ideas-body{overflow:auto;flex:1;padding:12px;display:flex;flex-direction:column;gap:10px}
.ideas-take{border:1px solid color-mix(in srgb,var(--gold) 35%,var(--line));background:color-mix(in srgb,var(--gold) 7%,var(--surface));border-radius:12px;padding:10px 12px;font-size:13px}
.ideas-take .row{gap:6px}
.ideas-take p{margin:4px 0 0;overflow-wrap:anywhere}
.ideas-card{border:1px solid var(--line);border-radius:12px;padding:10px 12px;background:var(--surface);display:flex;flex-direction:column;gap:4px;font-size:13px}
.ideas-card p{margin:0;overflow-wrap:anywhere}
.ideas-top{display:flex;gap:8px;align-items:flex-start}
.ideas-top b{flex:1;min-width:0;font-size:14px;line-height:1.35;overflow-wrap:anywhere}
.ideas-eff{flex:none;font-size:11px;padding:1px 8px}
.ideas-eff.quick{color:var(--ok)}.ideas-eff.medium{color:var(--warn)}.ideas-eff.big{color:var(--bad)}
.ideas-card .row{gap:6px;margin-top:4px}
.ideas-body details > summary{cursor:pointer;color:var(--muted);font-weight:700;font-size:13px}
.ideas-body details[open] > summary{margin-bottom:8px}
.ideas-body details .ideas-card{margin-bottom:8px}
.ideas-note{margin:0;font-size:13px}
.ideas-err{margin:0;font-size:13px;color:var(--bad)}
.ideas-foot{padding:10px 12px 12px;border-top:1px solid var(--line);display:flex}
.ideas-foot .btn{flex:1}
@media (max-width:1180px){
  .convo.ideas-open{padding-right:0}
  .convo.ideas-open .ideas-av,.convo.ideas-open .clar-av,.convo.clar-open .ideas-av{display:none}
  .ideas-panel{width:min(320px,calc(100% - 24px));box-shadow:-8px 0 24px rgba(0,0,0,.15)}
}`;
  document.head.appendChild(style);

  const cache = new Map(); // chat id -> {takes, ideas, working (this page asked), remote (server says busy), error}
  const timers = new Map(); // chat id -> debounce timer
  const openD = {}; // which collapsed sections are open
  let open = (() => { try { return localStorage.getItem("hive-ideas-open") === "1"; } catch { return false; } })();
  let shown, shownId; // the chat last drawn, to notice when the page switches chats

  const state = (key) => { let s = cache.get(key); if (!s) cache.set(key, (s = { takes: [], ideas: [], working: false, remote: false, error: "" })); return s; };
  const cur = () => (typeof chat !== "undefined" && chat) || null;
  const keyOf = (c) => (c && typeof c.id === "string" && KEY.test(c.id) ? c.id : null);
  const statusOf = (i) => (["used", "saved", "dismissed"].includes(i.status) ? i.status : "new");
  const when = (at) => { try { return at && !isNaN(new Date(at)) ? ago(at) : ""; } catch { return ""; } };
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

  /* ---------- markup ---------- */
  const clar = $("clarAv");
  const convo = clar && clar.parentElement;
  if (!convo) return;
  const av = document.createElement("button");
  av.className = "ideas-av"; av.id = "ideasAv"; av.type = "button"; av.hidden = true;
  av.setAttribute("aria-expanded", "false"); av.setAttribute("aria-controls", "ideasPanel");
  av.innerHTML = `<span class="bob">${mascot("inventor", "Inventor")}</span><span class="ideas-badge" hidden></span>`;
  const badge = av.querySelector(".ideas-badge");
  const panel = document.createElement("aside");
  panel.className = "card ideas-panel"; panel.id = "ideasPanel"; panel.hidden = true;
  panel.setAttribute("aria-label", "Inventor");
  convo.appendChild(av); convo.appendChild(panel);

  // Pure: builds the panel from one chat's state. Tolerates missing or partial data.
  function panelHTML(s, working) {
    s = s || {};
    const ideas = (Array.isArray(s.ideas) ? s.ideas : []).filter((i) => i && typeof i === "object");
    const takes = (Array.isArray(s.takes) ? s.takes : []).filter((t) => t && t.text);
    const fresh = ideas.filter((i) => statusOf(i) === "new").reverse();
    const saved = ideas.filter((i) => statusOf(i) === "saved").reverse();
    const done = ideas.filter((i) => DONE.includes(statusOf(i))).reverse();
    const btn = (act, label, primary) => `<button class="btn small${primary ? " primary" : ""}" type="button" data-act="${act}">${label}</button>`;
    const buttons = (i) => {
      if (!i.id) return "";
      const st = statusOf(i);
      const b = st === "new" ? [btn("dismiss", "Dismiss"), btn("save", "Save")]
        : st === "saved" ? [btn("dismiss", "Dismiss")]
        : st === "used" ? [btn("save", "Save")]
        : [btn("restore", "Restore"), btn("save", "Save")];
      return `<div class="row"><span class="spacer"></span>${b.join("")}${btn("use", "Use", true)}</div>`;
    };
    const card = (i) => {
      const eff = EFFORT[i.effort] ? i.effort : "medium";
      return `<div class="ideas-card" data-id="${esc(i.id || "")}"><div class="ideas-top"><b>${esc(i.title || "Untitled idea")}</b><span class="chip ideas-eff ${eff}" title="Effort">${EFFORT[eff]}</span></div>`
        + `${i.idea ? `<p>${esc(i.idea)}</p>` : ""}${i.why ? `<p class="muted">${esc(i.why)}</p>` : ""}${buttons(i)}</div>`;
    };
    const group = (k, name, list) => list.length ? `<details data-s="${k}" ${openD[k] ? "open" : ""}><summary>${name} (${list.length})</summary>${list.map(card).join("")}</details>` : "";
    const take = takes[takes.length - 1];
    const takeHTML = take ? `<div class="ideas-take"><div class="row"><b>Claude's take</b><span class="spacer"></span><span class="muted">${esc(when(take.at))}</span></div><p>${esc(take.text)}</p></div>` : "";
    const empty = !ideas.length ? (window.HIVE_LITE
      ? `<p class="muted ideas-note">The Wise Hive Lite saves your usage, so the Inventor only runs when you ask. Press <b>Get ideas</b> for Claude's take and what to try next.</p>`
      : `<p class="muted ideas-note">No ideas yet. They appear after Claude answers.</p>`)
      : !fresh.length ? `<p class="muted ideas-note">No new ideas right now.</p>` : "";
    return `<header><span style="width:30px" class="${working ? "working" : ""}">${mascot("inventor", "Inventor")}</span><div style="flex:1;min-width:0"><b>Inventor</b><div class="muted" style="font-size:12px">${working ? "Thinking about this chat…" : plural(fresh.length, "new idea")}</div></div><button class="x" type="button" data-act="close" aria-label="Close the Inventor">×</button></header>`
      + `<div class="ideas-body">${takeHTML}${s.error ? `<p class="ideas-err">${esc(s.error)}</p>` : ""}${fresh.map(card).join("")}${empty}${group("saved", "Saved", saved)}${group("done", "Used and dismissed", done)}</div>`
      + `<footer class="ideas-foot"><button class="btn small primary" type="button" data-act="more" ${working ? "disabled" : ""}>${ideas.length ? "Get more ideas" : "Get ideas"}</button></footer>`;
  }

  function draw() {
    const c = cur(), key = keyOf(c);
    shown = c; shownId = c && c.id;
    const s = key ? state(key) : null;
    const fresh = s ? s.ideas.filter((i) => i && typeof i === "object" && statusOf(i) === "new").length : 0;
    const working = !!s && (s.working || s.remote);
    // The icon is always there in Chats (the user asked); a chat that hasn't started yet just has nothing to show.
    const on = !!key, po = open;
    av.hidden = false; av.classList.toggle("working", working); av.setAttribute("aria-expanded", String(po));
    const label = working ? "The Inventor is thinking about this chat…" : fresh ? `${plural(fresh, "new idea")} from the Inventor` : "Ideas from the Inventor";
    av.title = label; av.setAttribute("aria-label", label);
    badge.hidden = !fresh; badge.textContent = fresh;
    convo.classList.toggle("ideas-on", on); convo.classList.toggle("ideas-open", po);
    panel.hidden = !po;
    if (!po) return;
    panel.querySelectorAll("details[data-s]").forEach((d) => (openD[d.dataset.s] = d.open));
    if (!s) {
      panel.innerHTML = `<header><span style="width:30px">${mascot("inventor", "Inventor")}</span><div style="flex:1;min-width:0"><b>Inventor</b><div class="muted" style="font-size:12px">Waiting for this chat to start</div></div><button class="x" type="button" data-act="close" aria-label="Close the Inventor">×</button></header>`
        + `<div class="ideas-body"><p class="muted ideas-note">Send a message first. After Claude answers, the Inventor gives its take on the chat and ideas for what to do next.</p></div>`;
      return;
    }
    const body = panel.querySelector(".ideas-body"), top = body ? body.scrollTop : 0;
    panel.innerHTML = panelHTML(s, working);
    panel.querySelector(".ideas-body").scrollTop = top;
  }
  // The page can switch chats without an event (e.g. a toast click), and a new chat learns its id mid-run.
  function sync() {
    const c = cur();
    if (c === shown && (c && c.id) === shownId) return;
    const key = keyOf(c);
    if (key && !cache.has(key)) load(key);
    draw();
  }

  /* ---------- data ---------- */
  function load(key) {
    if (!key) return;
    const s = state(key);
    // Opening a chat fires both hive:view and hive:chatopen; one request is enough.
    return s.loading || (s.loading = (async () => {
      let r; try { r = await api("/api/ideas/" + encodeURIComponent(key)); } catch { r = null; }
      s.loading = null;
      if (!r || r.error) return;
      s.takes = Array.isArray(r.takes) ? r.takes : [];
      s.ideas = Array.isArray(r.ideas) ? r.ideas : [];
      s.remote = !!r.working;
      if (key === keyOf(cur())) draw();
    })());
  }
  // The last few user and Claude messages (no permission or question cards), each cut to MSG_MAX.
  function contextOf(c) {
    return (Array.isArray(c.messages) ? c.messages : []).filter((m) => m && (m.role === "user" || m.role === "assistant")).slice(-CTX_MSGS).map((m) => {
      let t = String(m.text || "").trim();
      const tools = (Array.isArray(m.tools) ? m.tools : []).filter(Boolean).slice(0, 8).map((x) => String(x.name || "tool") + (x.agent || x.summary ? ": " + String(x.agent || x.summary).slice(0, 80) : ""));
      if (tools.length) t += `${t ? "\n" : ""}[tools used: ${tools.join("; ")}]`;
      if (t.length > MSG_MAX) t = t.slice(0, MSG_MAX) + "…";
      return t ? `${m.role === "user" ? "User" : "Claude"}: ${t}` : "";
    }).filter(Boolean).join("\n\n");
  }
  async function generate(c) {
    const key = keyOf(c);
    if (!key) return;
    const s = state(key);
    if (s.working) return;
    s.working = true; s.error = "";
    if (key === keyOf(cur())) draw();
    let r;
    try { r = await api("/api/ideas", { method: "POST", body: JSON.stringify({ key, cwd: c.cwd || "", title: c.title || "", context: contextOf(c) }) }); }
    catch { r = { error: "Can't reach The Wise Hive right now." }; }
    s.working = false;
    if (!r || r.busy) s.remote = true; // already running (another window); its "ideas" event brings the result
    else if (r.error) s.error = r.error;
    else {
      // The server's "ideas" event may already have reloaded these, so add only what's missing.
      if (r.take && !s.takes.some((t) => t.text === r.take && t.at === r.at)) s.takes.push({ at: r.at || new Date().toISOString(), text: r.take });
      const have = new Set(s.ideas.map((i) => i.id));
      for (const i of Array.isArray(r.ideas) ? r.ideas : []) if (i && !have.has(i.id)) s.ideas.push(i);
    }
    if (key === keyOf(cur())) draw();
  }
  // The card moves at once. "Saved to the idea backlog" waits for the server; if it refuses or can't be reached, the
  // card goes back (unless clicked again since) and the chat's ideas reload, since the server may have kept part of it.
  function setStatus(key, i, status) {
    const prev = i.status;
    i.status = status;
    api(`/api/ideas/${encodeURIComponent(key)}/${encodeURIComponent(i.id)}`, { method: "POST", body: JSON.stringify({ status }) })
      .catch(() => ({ error: "Can't reach The Wise Hive right now." }))
      .then((r) => {
        if (r && !r.error) { if (status === "saved") toast("Saved to the idea backlog", i.title); return; }
        if (i.status === status) i.status = prev;
        const s = cache.get(key); if (s) s.loading = null;
        load(key);
        if (key === keyOf(cur())) draw();
        toast("Couldn't update the idea", (r && r.error) || "The Wise Hive didn't answer.");
      });
  }

  /* ---------- panel ---------- */
  function toggle(on) {
    open = on;
    try { localStorage.setItem("hive-ideas-open", on ? "1" : "0"); } catch {}
    draw();
    if (on) hiveEvent("hive:panel", { name: "ideas" });
  }
  av.onclick = () => toggle(!open);
  panel.addEventListener("keydown", (e) => { if (e.key === "Escape") { toggle(false); av.focus(); } });
  panel.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const act = b.dataset.act, c = cur(), key = keyOf(c);
    if (act === "close") { toggle(false); return av.focus(); }
    if (!key) return;
    if (act === "more") { clearTimeout(timers.get(key)); timers.delete(key); generate(c); return; }
    const el = b.closest("[data-id]"), s = cache.get(key), i = el && s && s.ideas.find((x) => x && x.id === el.dataset.id);
    if (!i) return;
    if (act === "use") {
      // Keep anything the user already typed; the idea goes after it.
      const p = $("prompt"), had = p.value.trim();
      p.value = had ? `${had}\n\n${i.idea}` : i.idea;
      p.focus(); p.dispatchEvent(new Event("input"));
      setStatus(key, i, "used");
    }
    if (act === "save") setStatus(key, i, "saved");
    if (act === "dismiss") setStatus(key, i, "dismissed");
    if (act === "restore") setStatus(key, i, "new");
    draw();
  });

  /* ---------- triggers ---------- */
  window.addEventListener("hive:edition", () => draw());   // the edition arrives after the first draw
  window.addEventListener("hive:turn", (e) => {
    const c = e.detail && e.detail.chat, key = keyOf(c);
    // The Wise Hive Lite: no automatic Inventor run after each reply; the user presses Get ideas.
    // Also none while the user switched the Inventor off (chatopts-client.js); Get ideas still works.
    if (key && !window.HIVE_LITE && (!window.HiveChatOpts || window.HiveChatOpts.helperOn("inventor"))) {
      clearTimeout(timers.get(key));
      timers.set(key, setTimeout(() => { timers.delete(key); generate(c); }, DEBOUNCE));
    }
    sync();
  });
  window.addEventListener("hive:chatopen", (e) => {
    const key = keyOf(e.detail && e.detail.chat);
    if (key) load(key);
    draw();
  });
  window.addEventListener("hive:panel", (e) => {
    if (e.detail && e.detail.name !== "ideas" && open) { open = false; try { localStorage.setItem("hive-ideas-open", "0"); } catch {} draw(); }
  });
  window.addEventListener("hive:view", sync);
  window.addEventListener("hive:userprompt", sync);
  window.addEventListener("hive:server", (e) => {
    const ev = e.detail || {};
    // Reconnected after a server restart: any generation that was running is gone.
    if (ev.t === "hello") { for (const s of cache.values()) s.remote = false; const key = keyOf(cur()); if (key) load(key); return; }
    if (ev.t !== "ideas" || !KEY.test(ev.key || "")) return;
    if (!cache.has(ev.key) && ev.key !== keyOf(cur())) return;
    state(ev.key).remote = !!ev.working;
    if (!ev.working) load(ev.key);
    else if (ev.key === keyOf(cur())) draw();
  });
  setInterval(sync, 1000);

  window.HiveIdeas = { panelHTML, draw, generate, load, cache };
  sync();
})();
