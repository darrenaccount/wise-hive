/* Brainstorm tab: chat with the Brainstormer (thinks and researches, never builds). Its brainstorm plans are saved by
   brainstorm.js in <brain>\brainstorms\ and listed under the chat, where they can be opened, continued or deleted. */
(function () {
  "use strict";
  // The Brainstormer: a thought cloud over its head and a pencil.
  if (typeof KIT === "object" && !KIT.brainstormer) {
    KIT.brainstormer = { front: R(12, -3, 6, 3, C.white) + R(13, -4, 4, 1, C.white) + R(11, -2, 1, 1, C.white) + R(18, -2, 1, 1, C.white) + R(11, 1, 1, 1, C.white) + R(10, 2, 1, 1, C.white)
      + R(13, -2, 1, 1, C.gold) + R(15, -2, 1, 1, C.gold) + R(4, 2, 7, 2, C.purple) + R(16, 6, 1, 4, C.gold) + R(16, 10, 1, 1, C.eye) + R(16, 5, 1, 1, C.pink) };
  }
  const root = document.getElementById("brainstormRoot");
  if (!root) return;

  const css = document.createElement("style");
  css.textContent = `
  .bs-root{display:flex;flex-direction:column;max-width:980px;margin:0 auto;padding:0 24px 24px}
  .bs-head{display:flex;align-items:center;gap:14px;padding:22px 0 12px}
  .bs-head h1{font-size:26px}
  .bs-scroll{height:58vh;min-height:320px;overflow:auto;display:flex;flex-direction:column;gap:18px;padding:12px 14px 18px;background:var(--sunk);border:1px solid var(--line);border-radius:16px}
  .bs-msg{display:flex;gap:12px}
  .bs-msg.me{justify-content:flex-end}
  .bs-msg.me .bs-bub{background:var(--raised);border:1px solid var(--line);border-radius:18px 18px 4px 18px;padding:10px 16px;max-width:78%}
  .bs-msg .av{width:34px;flex:none}
  .bs-bub{min-width:0;overflow-wrap:anywhere;flex:1}
  .bs-steps{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 8px}
  .bs-plan{border:1px solid var(--claude);border-radius:14px;padding:14px 16px;background:var(--surface);box-shadow:0 0 0 4px var(--claude-glow);margin:8px 0}
  .bs-plan .ph{display:flex;align-items:center;gap:8px;margin-bottom:6px}
  .bs-compose{padding:10px 0 18px}
  .bs-saved{border-top:1px solid var(--line);padding:14px 0 6px;display:flex;flex-direction:column;gap:8px}
  .bs-saved h2{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
  .bs-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px}
  .bs-card{display:flex;flex-direction:column;gap:6px;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:12px}
  .bs-card b{font-family:var(--f-display);font-size:15px}
  .bs-card p{margin:0;font-size:13px;color:var(--muted);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
  .bs-open{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:16px;max-height:55vh;overflow:auto}
  `;
  document.head.appendChild(css);

  root.innerHTML = `
    <header class="bs-head"><span class="bob" style="width:56px">${mascot("brainstormer", "Brainstormer")}</span>
      <div style="flex:1;min-width:0"><h1>Brainstorm</h1><p class="muted" style="margin:2px 0 0">Talk through any idea. The Brainstormer researches the web and your notes, thinks it through with you and writes a plan. It never builds anything.</p></div>
      <button class="btn small" id="bsNew" type="button">New brainstorm</button></header>
    <div class="bs-scroll" id="bsScroll"></div>
    <div class="bs-compose">
      <div class="compose-box"><textarea id="bsText" placeholder="What do you want to brainstorm? e.g. a new game mode for my Roblox game" aria-label="Your idea"></textarea>
        <div class="compose-bar"><span class="muted" id="bsHint" style="font-size:12px;padding-left:6px">Ask for "the plan" any time.</span><span class="spacer"></span>
          <button class="stopbtn" id="bsStop" type="button" hidden title="Stop" aria-label="Stop"><svg viewBox="0 0 24 24" width="14" height="14"><rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor"/></svg></button>
          <button class="sendbtn" id="bsSend" type="button" title="Send (Enter)" aria-label="Send"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button></div></div>
      <section class="bs-saved"><h2>Saved brainstorm plans</h2><div class="bs-cards" id="bsPlans"></div><div id="bsOpen"></div></section>
    </div>`;
  const $b = (id) => document.getElementById(id);

  // One brainstorm at a time: its session id (to continue it) and its messages.
  const S = { session: null, msgs: [], run: null, busy: false, armed: null };
  const PLAN = /<brainstorm-plan(?:\s+title="([^"]*)")?\s*>([\s\S]*?)(<\/brainstorm-plan>|$)/;
  const stepText = (t) => t.name === "WebSearch" ? `Searched: ${t.summary}` : t.name === "WebFetch" ? `Read: ${String(t.summary).replace(/^https?:\/\//, "").slice(0, 60)}` : `${prettyTool(t.name)}: ${t.summary}`;

  function msgHTML(m) {
    if (m.role === "user") return `<div class="bs-msg me"><div class="bs-bub md">${md(m.text)}</div></div>`;
    let body = m.text || "", plan = "";
    const pm = PLAN.exec(body);
    if (pm) {
      body = body.replace(PLAN, "").trim();
      plan = `<div class="bs-plan"><div class="ph"><b style="font-family:var(--f-display);font-size:16px">${esc(pm[1] || "Brainstorm plan")}</b><span class="spacer"></span>${pm[3] ? `<span class="chip">Saved below</span>` : `<span class="chip">Writing…</span>`}</div><div class="md">${md(pm[2])}</div></div>`;
    }
    const steps = (m.steps || []).length ? `<div class="bs-steps">${m.steps.slice(-12).map((t) => `<span class="tool"><span>${esc(stepText(t))}</span></span>`).join("")}</div>` : "";
    return `<div class="bs-msg"><div class="av ${m.streaming ? "working" : ""}">${mascot("brainstormer")}</div><div class="bs-bub">${steps}<div class="md ${m.streaming && !m.text ? "" : ""}">${body ? md(body) : (m.streaming ? '<span class="muted">Thinking and researching…</span>' : "")}</div>${plan}${m.error ? `<p style="color:var(--bad)">${esc(m.error)}</p>` : ""}</div></div>`;
  }
  function draw() {
    const el = $b("bsScroll"), near = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    el.innerHTML = S.msgs.length ? S.msgs.map(msgHTML).join("") : `<div class="empty" style="margin:auto"><div class="bob" style="width:84px">${mascot("brainstormer")}</div><h3>What are we dreaming up?</h3><p>Type a rough idea. The Brainstormer will research it, offer directions, push back where it's weak and turn it into a plan you can keep.</p></div>`;
    if (near) el.scrollTop = el.scrollHeight;
    $b("bsStop").hidden = !S.busy; $b("bsSend").disabled = S.busy;
  }

  async function send() {
    const text = $b("bsText").value.trim();
    if (!text || S.busy) return;
    $b("bsText").value = "";
    S.msgs.push({ role: "user", text });
    const a = { role: "assistant", text: "", steps: [], streaming: true };
    S.msgs.push(a); S.busy = true; draw(); setBusy(1);
    let gap = false;
    try {
      await stream("/api/brainstorm/chat", { text, session: S.session }, (ev) => {
        if (ev.t === "run") S.run = ev.run;
        if (ev.t === "session" && !S.session) S.session = ev.id;
        if (ev.t === "delta") { a.text += (gap && a.text ? "\n\n" : "") + ev.text; gap = false; }
        if (ev.t === "tools") { a.steps.push(...ev.tools); gap = true; }
        if (ev.t === "result") { if (ev.id) S.session = ev.id; if (!a.text) a.text = ev.text; if (ev.error) a.error = /log ?in/i.test(ev.text) ? "Claude Code isn't signed in." : "The Brainstormer hit an error."; }
        if (ev.t === "end" && ev.code && !a.text) a.error = "Stopped.";
        draw();
      });
    } catch { a.error = "Lost connection to The Wise Hive. Try again in a moment."; }
    a.streaming = false; S.busy = false; S.run = null; setBusy(-1); draw();
    setTimeout(loadPlans, 600);
  }

  async function loadPlans() {
    let list = [];
    try { const x = await api("/api/brainstorm/plans"); list = Array.isArray(x) ? x : []; } catch {}
    $b("bsPlans").innerHTML = list.map((p) => `<div class="bs-card" data-id="${esc(p.id)}"><b>${esc(p.title)}</b><span class="muted" style="font-size:12px">${p.updated ? ago(p.updated) : ""}</span><p>${esc(p.preview)}</p>
      <div class="row" style="gap:6px"><button class="btn small" type="button" data-act="open">Open</button><button class="btn small" type="button" data-act="continue">Continue</button><span class="spacer"></span><button class="btn small" type="button" data-act="delete">${S.armed === p.id ? "Click again to delete" : "Delete"}</button></div></div>`).join("")
      || `<div class="none">Plans the Brainstormer writes are saved here. You can reopen, continue or delete them.</div>`;
  }
  $b("bsPlans").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const id = b.closest("[data-id]").dataset.id, act = b.dataset.act;
    if (act === "open") {
      const r = await api("/api/brainstorm/plans/" + id).catch(() => null); if (!r || !r.text) return;
      $b("bsOpen").innerHTML = `<div class="bs-open"><div class="row"><span class="spacer"></span><button class="btn small" type="button" id="bsClose">Close</button></div><div class="md">${md(r.text.replace(/^Session: .*\nUpdated: .*\n/m, ""))}</div></div>`;
      $b("bsClose").onclick = () => ($b("bsOpen").innerHTML = "");
    }
    if (act === "continue") {
      if (S.busy) return toast("The Brainstormer is busy", "Wait for this answer to finish first.");
      const d = await api("/api/sessions/" + id).catch(() => null);
      S.session = id;
      S.msgs = d && d.messages ? d.messages.map((m) => ({ role: m.role, text: m.role === "user" ? String(m.text).replace(/^\[(?:Wise Hive|Teamwright) brainstorm\]\s*/, "") /* old tag too: keep-old-name */ : m.text, steps: (m.tools || []).map((t) => ({ name: t.name, summary: t.summary })) })) : [];
      draw(); $b("bsText").focus(); $b("bsScroll").scrollTop = $b("bsScroll").scrollHeight;
    }
    if (act === "delete") {
      if (S.armed !== id) { S.armed = id; loadPlans(); setTimeout(() => { if (S.armed === id) { S.armed = null; loadPlans(); } }, 4000); return; }
      S.armed = null; await api(`/api/brainstorm/plans/${id}/delete`, { method: "POST", body: "{}" }).catch(() => {});
      $b("bsOpen").innerHTML = ""; loadPlans(); toast("Plan deleted", "It's gone from the brain.");
    }
  });
  $b("bsSend").onclick = send;
  $b("bsText").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
  $b("bsStop").onclick = () => { if (S.run) api(`/api/runs/${S.run}/stop`, { method: "POST", body: "{}" }).catch(() => {}); };
  $b("bsNew").onclick = () => { if (S.busy) return; S.session = null; S.msgs = []; draw(); $b("bsText").focus(); };
  window.addEventListener("hive:view", (e) => { if (e.detail && e.detail.view === "brainstorm") { loadPlans(); draw(); } });
  window.addEventListener("hive:server", (e) => { if (e.detail && e.detail.t === "brainstorm") loadPlans(); });
  draw(); loadPlans();
})();
