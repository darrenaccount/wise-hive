/* Disk cleanup: the page side of cleanup.js. A "Disk cleanup" card in Settings with each category's size, how long to
   keep it, a preview of what would go, and Clean now (with an inline confirm). Conversations and memories are listed
   as "never removed" for reassurance; the server has no way to remove them. */
(function () {
  "use strict";
  const page = document.querySelector("#v-settings .page");
  if (!page) return;
  const style = document.createElement("style");
  style.textContent = `
.cu-rows{display:flex;flex-direction:column;gap:2px}
.cu-row{display:grid;grid-template-columns:minmax(0,1.6fr) 90px 170px minmax(0,1fr);gap:12px;align-items:center;padding:8px 10px;border-radius:6px;background:var(--sunk);border:1px solid var(--line)}
.cu-row b{font-size:14px}
.cu-row small{display:block;color:var(--muted);font:11px var(--f-mono);overflow-wrap:anywhere}
.cu-size{font:700 13px var(--f-mono);text-align:right}
.cu-row select{padding:5px 8px;background:var(--surface);border:1px solid var(--line);border-radius:6px;width:100%}
.cu-free{font:12px var(--f-mono);color:var(--muted)}
.cu-free.has{color:var(--warn)}
.cu-kept{font-size:12.5px;color:var(--muted);margin:0}
.cu-kept span{font-family:var(--f-mono);color:var(--ok)}
.cu-list{margin:0;padding:8px 10px;list-style:none;border:1px dashed var(--line);border-radius:6px;max-height:220px;overflow:auto;font:12px var(--f-mono)}
.cu-list li{display:flex;gap:10px}.cu-list li .n{flex:1;min-width:0;overflow-wrap:anywhere}.cu-list li .w{color:var(--muted)}
.cu-confirm{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 10px;border-radius:6px;border:1px solid color-mix(in srgb,var(--warn) 45%,var(--line));background:color-mix(in srgb,var(--warn) 7%,var(--surface));font-size:13px}
.cu-msg{margin:0;font-size:13px}.cu-msg.bad{color:var(--bad)}.cu-msg.ok{color:var(--ok)}
@media (max-width:820px){.cu-row{grid-template-columns:minmax(0,1fr) 80px}.cu-row select,.cu-free{grid-column:span 2}}`;
  document.head.appendChild(style);

  const card = document.createElement("section");
  card.className = "card stack"; card.id = "cleanupCard";
  const logSec = $("logTail") && $("logTail").closest("section");
  logSec ? page.insertBefore(card, logSec) : page.appendChild(card);

  let data = null, showList = false, confirming = false, busy = false, msg = null;
  const fmt = (b) => (b >= 1073741824 ? (b / 1073741824).toFixed(1) + " GB" : b >= 1048576 ? (b / 1048576).toFixed(1) + " MB" : b >= 1024 ? Math.round(b / 1024) + " KB" : (b || 0) + " B");
  const optLabel = (key, v) => {
    if (key === "backups") return v ? `Keep newest ${v}` : "Keep all";
    if (key === "logs") return v ? `Trim to last ${v} MB` : "Never trim";
    return v ? `Keep ${v} days` : "Keep forever";
  };

  function draw() {
    if (!data) { card.innerHTML = `<h2 class="sec" style="margin:0">Disk cleanup</h2><p class="muted" style="margin:0">${msg ? esc(msg.text) : "Measuring…"}</p>`; return; }
    const s = data.settings, cats = data.categories || [], items = cats.flatMap((c) => c.remove.map((r) => ({ ...r, cat: c.label, trim: c.trim })));
    const last = s.lastRun ? `Last cleanup ${typeof ago === "function" ? ago(s.lastRun) : new Date(s.lastRun).toLocaleString()}${s.lastResult ? `: freed ${fmt(s.lastResult.freed)}${s.lastResult.auto ? " (daily)" : ""}` : ""}` : "Not run yet";
    card.innerHTML = `<div class="row"><h2 class="sec" style="margin:0">Disk cleanup</h2><span class="spacer"></span>
        <label class="muted" style="font-size:13px;display:flex;gap:6px;align-items:center"><input type="checkbox" data-cu-auto ${s.auto ? "checked" : ""}> Clean up once a day</label></div>
      <p class="muted" style="margin:0;font-size:13px">Old files that pile up. Pick how long to keep each kind. ${esc(last)}.</p>
      <div class="cu-rows">${cats.map((c) => `<div class="cu-row"><div><b>${esc(c.label)}</b><small>${esc(c.where)} · ${c.count} ${c.key === "logs" ? "file" + (c.count === 1 ? "" : "s") : c.key === "backups" ? "cop" + (c.count === 1 ? "y" : "ies") : "item" + (c.count === 1 ? "" : "s")}</small></div>
        <span class="cu-size">${fmt(c.size)}</span>
        <select data-cu-key="${esc(c.key)}" aria-label="${esc(c.label)}: how long to keep">${(data.options[c.key] || []).map((v) => `<option value="${v}" ${v === c.keep ? "selected" : ""}>${optLabel(c.key, v)}</option>`).join("")}</select>
        <span class="cu-free ${c.remove.length ? "has" : ""}">${c.remove.length ? `${c.trim ? "would trim" : "would free"} ${fmt(c.removeBytes)}` : "nothing to remove"}</span></div>`).join("")}</div>
      <p class="cu-kept">Never removed: ${(data.kept || []).map((k) => `${esc(k.label)} <span>${fmt(k.size)}</span>`).join(" · ")}</p>
      ${showList ? (items.length ? `<ul class="cu-list">${items.map((i) => `<li><span class="n">${esc(i.name)}</span><span class="w">${esc(i.why)}</span><span>${fmt(i.bytes)}</span></li>`).join("")}</ul>` : `<p class="muted" style="margin:0;font-size:13px">Nothing is old enough to remove with these settings.</p>`) : ""}
      ${confirming ? `<div class="cu-confirm"><span>Remove ${items.length} item${items.length === 1 ? "" : "s"} and free about <b>${fmt(data.total)}</b>? This can't be undone.</span><span class="spacer"></span><button class="btn small" type="button" data-cu-cancel>Cancel</button><button class="btn small primary" type="button" data-cu-yes>Yes, clean up</button></div>` : ""}
      ${msg ? `<p class="cu-msg ${msg.kind || ""}">${esc(msg.text)}</p>` : ""}
      <div class="row"><span class="spacer"></span><button class="btn small" type="button" data-cu-preview>${showList ? "Hide preview" : "Preview"}</button>
        <button class="btn small primary" type="button" data-cu-clean ${busy || !items.length || confirming ? "disabled" : ""}>${busy ? "Cleaning…" : "Clean now"}</button></div>`;
  }
  async function load() {
    try { const d = await api("/api/cleanup/preview"); if (d && d.categories) data = d; else msg = { text: (d && d.error) || "No answer.", kind: "bad" }; }
    catch { msg = { text: "Can't reach The Wise Hive.", kind: "bad" }; }
    draw();
  }
  async function post(p, b) { return api(p, { method: "POST", body: JSON.stringify(b || {}) }); }

  card.addEventListener("change", async (e) => {
    const sel = e.target.closest("[data-cu-key]"), auto = e.target.closest("[data-cu-auto]");
    if (!sel && !auto) return;
    const d = await post("/api/cleanup/settings", sel ? { [sel.dataset.cuKey]: Number(sel.value) } : { auto: auto.checked }).catch(() => null);
    if (d && d.categories) { data = d; msg = null; confirming = false; } else msg = { text: (d && d.error) || "Couldn't save that setting.", kind: "bad" };
    draw();
  });
  card.addEventListener("click", async (e) => {
    if (e.target.closest("[data-cu-preview]")) { showList = !showList; msg = null; return load(); }
    if (e.target.closest("[data-cu-clean]")) { confirming = true; showList = true; msg = null; return load(); }
    if (e.target.closest("[data-cu-cancel]")) { confirming = false; return draw(); }
    if (e.target.closest("[data-cu-yes]")) {
      confirming = false; busy = true; draw();
      const d = await post("/api/cleanup/run", { preview: data && data.previewId }).catch(() => null); // only what this list showed
      busy = false;
      if (d && d.categories) {
        data = d; const r = d.result || {};
        msg = r.error ? { text: r.error, kind: "bad" } : { text: `Freed ${fmt(r.freed)} (${(r.done || []).length} removed)${(r.failed || []).length ? `. Skipped ${r.failed.length}: ${r.failed.map((f) => `${f.name} (${f.error})`).join(", ")}` : "."}`, kind: (r.failed || []).length ? "bad" : "ok" };
      } else msg = { text: (d && d.error) || "The cleanup didn't answer.", kind: "bad" };
      draw();
    }
  });
  window.addEventListener("hive:view", (e) => { if (e.detail && e.detail.view === "settings") load(); });
  window.addEventListener("hive:server", (e) => { if (e.detail && e.detail.t === "cleanup" && !$("v-settings").hidden && !busy) load(); });
  draw();
})();
