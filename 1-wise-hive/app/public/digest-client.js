/* "While you were away": the page side of digest.js. Posts a heartbeat while the window is visible and focused (that's how
   the server knows when the user was last here) and shows a card on Home when they were gone an hour or more and
   something happened. Every line links to the view (or chat) it's about. */
(function () {
  "use strict";
  const BEAT = 60e3;
  const home = document.querySelector("#v-home .home");
  if (!home) return;
  const style = document.createElement("style");
  style.textContent = `
.dg-card{width:min(680px,100%);display:flex;flex-direction:column;gap:10px;padding:14px 16px;border-color:color-mix(in srgb,var(--gold) 40%,var(--line));box-shadow:0 0 0 4px color-mix(in srgb,var(--gold) 8%,transparent)}
.dg-head{display:flex;align-items:center;gap:10px}
.dg-head .dg-av{width:34px;flex:none}
.dg-head b{font-family:var(--f-display);font-size:17px;display:block}
.dg-head small{color:var(--muted);font-size:12.5px}
.dg-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.dg-sec > .linkish{font-size:14px}
.dg-sec.bad > .linkish{color:var(--bad)}
.dg-sec.urgent > .linkish{color:var(--warn)}
.dg-sec ul{list-style:none;margin:3px 0 0;padding:0 0 0 12px;border-left:2px solid var(--line);display:flex;flex-direction:column;gap:2px}
.dg-sec li .linkish,.dg-sec li span{font-weight:400;font-size:13px;color:var(--muted);overflow-wrap:anywhere}
.dg-sec li .linkish:hover{color:var(--ink)}
.dg-more{font-size:12px;color:var(--muted)}`;
  document.head.appendChild(style);

  const card = document.createElement("section");
  card.className = "card dg-card"; card.hidden = true; card.setAttribute("aria-label", "While you were away");
  const h1 = home.querySelector("h1");
  home.insertBefore(card, h1 ? h1.nextSibling : home.firstChild);
  let sig = "";

  const span = (ms) => { const m = Math.round(ms / 60e3); return m < 90 ? `${m} min` : m < 48 * 60 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} days`; };
  function line(l) {
    const t = esc(l.text || "");
    if (l.chat) return `<li><button class="linkish" type="button" data-chat="${esc(l.chat)}">${t}</button></li>`;
    if (l.view) return `<li><button class="linkish" type="button" data-view="${esc(l.view)}">${t}</button></li>`;
    return `<li><span>${t}</span></li>`;
  }
  function render(d) {
    const show = !!(d && d.show && Array.isArray(d.sections) && d.sections.length);
    const html = !show ? "" : `<div class="dg-head"><span class="dg-av bob">${mascot("messenger", "Messenger")}</span><div style="flex:1;min-width:0"><b>While you were away</b><small>${d.since ? `Since ${esc(new Date(d.since).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }))}${d.back ? ` (${span(d.back - d.since)} away)` : ""}` : ""}</small></div><button class="btn small" type="button" data-act="dismiss">Dismiss</button></div>`
      + `<ul class="dg-list">${d.sections.map((s) => `<li class="dg-sec${s.bad ? " bad" : ""}${s.urgent ? " urgent" : ""}"><button class="linkish" type="button" data-view="${esc(s.view || "home")}">${esc(s.title)}</button>${Array.isArray(s.lines) && s.lines.length ? `<ul>${s.lines.map(line).join("")}${s.more ? `<li class="dg-more">and ${s.more} more</li>` : ""}</ul>` : ""}</li>`).join("")}</ul>`;
    if (html === sig) return;
    sig = html;
    card.innerHTML = html;
    card.hidden = !show;
  }
  card.addEventListener("click", async (e) => {
    const b = e.target && e.target.closest ? e.target.closest("button") : null;
    if (!b) return;
    if (b.dataset.act === "dismiss") {
      b.disabled = true;
      try { render(await api("/api/digest/dismiss", { method: "POST", body: "{}" })); } catch { b.disabled = false; toast("Couldn't dismiss", "Can't reach The Wise Hive right now."); }
      return;
    }
    if (b.dataset.chat && typeof openSession === "function") openSession(b.dataset.chat);
    else if (b.dataset.view && b.dataset.view !== "home" && typeof show === "function") show(b.dataset.view);
  });

  /* ---------- heartbeat ---------- */
  const here = () => document.visibilityState === "visible" && document.hasFocus();
  let lastBeat = 0;
  async function beat(force) {
    if (!here() || (!force && Date.now() - lastBeat < BEAT - 2000)) return;
    lastBeat = Date.now();
    try { render(await api("/api/digest/seen", { method: "POST", body: "{}" })); } catch {}
  }
  async function refresh() { try { render(await api("/api/digest")); } catch {} }
  window.addEventListener("focus", () => beat(true));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") beat(true); });
  window.addEventListener("hive:view", (e) => { if (e.detail && e.detail.view === "home") refresh(); });
  window.addEventListener("hive:server", (e) => { if (e.detail && e.detail.t === "hello") beat(true); });
  setInterval(() => beat(false), BEAT);
  if (here()) beat(true); else refresh();

  window.HiveDigest = { render, beat, refresh };
})();
