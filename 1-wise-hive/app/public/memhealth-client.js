/* Memory health: the page side of memhealth.js. Adds a "Health" tab to the Library's tabs (next to Memories) that runs
   the check and lists problems by group. Clicking a memory opens it in the Library's memory editor. */
(function () {
  "use strict";
  const tabs = document.querySelector("#v-library .tabs");
  if (!tabs || !$("lt-mem")) return;
  const style = document.createElement("style");
  style.textContent = `
.mh-badge{display:inline-block;min-width:18px;margin-left:6px;padding:0 5px;border-radius:4px;font:700 11px/18px var(--f-mono);text-align:center;background:var(--bad);color:var(--bg)}
.mh-badge.warn{background:var(--warn)}
.mh-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.mh-chip{font:700 12px/1 var(--f-mono);padding:6px 9px;border-radius:4px;border:1px solid var(--line);background:var(--sunk)}
.mh-chip.error{color:var(--bad);border-color:color-mix(in srgb,var(--bad) 45%,var(--line))}
.mh-chip.warn{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 40%,var(--line))}
.mh-chip.info{color:var(--muted)}
.mh-chip.ok{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 40%,var(--line))}
.mh-group{display:flex;flex-direction:column;gap:6px;border-left:4px solid var(--line)}
.mh-group.error{border-left-color:var(--bad)}.mh-group.warn{border-left-color:var(--warn)}.mh-group.info{border-left-color:var(--muted)}
.mh-group h3{font-size:16px;display:flex;gap:8px;align-items:center}
.mh-group h3 .mh-chip{font-size:11px;padding:3px 6px}
.mh-group p{margin:0;font-size:13px}
.mh-items{list-style:none;margin:4px 0 0;padding:0;display:flex;flex-direction:column;gap:4px;font-size:13px}
.mh-items li{display:flex;gap:8px;align-items:baseline;overflow-wrap:anywhere}
.mh-items li::before{content:"";flex:none;width:6px;height:6px;background:var(--line);transform:translateY(-1px)}
.mh-file{flex:none;font-family:var(--f-mono);font-size:12px}
.mh-items .t{color:var(--muted);min-width:0}`;
  document.head.appendChild(style);

  const tab = document.createElement("button");
  tab.className = "tab"; tab.type = "button"; tab.setAttribute("role", "tab"); tab.dataset.lt = "health"; tab.setAttribute("aria-selected", "false");
  tab.innerHTML = `Health<span class="mh-badge" hidden></span>`;
  tabs.appendChild(tab);
  const badge = tab.querySelector(".mh-badge");
  const pane = document.createElement("div");
  pane.id = "lt-health"; pane.className = "stack"; pane.hidden = true;
  const last = document.querySelectorAll("#v-library [id^='lt-']");
  last[last.length - 1].after(pane);

  let data = null, busy = false;
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const LEVEL = { error: "problem", warn: "warning", info: "note" };

  function drawBadge(c) {
    if (!c) return;
    const n = c.error || c.warn || 0;
    badge.hidden = !n; badge.textContent = n; badge.classList.toggle("warn", !c.error);
    badge.title = c.error ? plural(c.error, "problem") : plural(c.warn || 0, "warning");
  }
  function draw() {
    if (!data) { pane.innerHTML = `<p class="muted">${busy ? "Checking the memories…" : ""}</p>`; return; }
    if (data.error) { pane.innerHTML = `<p class="muted">Couldn't check: ${esc(data.error)}</p>`; return; }
    const c = data.counts || {};
    const chips = ["error", "warn", "info"].filter((k) => c[k]).map((k) => `<span class="mh-chip ${k}">${plural(c[k], LEVEL[k])}</span>`).join("") || `<span class="mh-chip ok">All clear</span>`;
    const when = data.at ? `Checked ${typeof ago === "function" ? ago(data.at) : new Date(data.at).toLocaleString()}` : "";
    pane.innerHTML = `<div class="mh-top">${chips}<span class="spacer"></span><span class="muted" style="font-size:12px">${esc(when)}</span><button class="btn small" type="button" data-mh-run ${busy ? "disabled" : ""}>${busy ? "Checking…" : "Check again"}</button></div>
      <p class="muted" style="margin:0;font-size:13px">Looks for broken memory files, gaps in <code>MEMORY.md</code> and notes that point at files that are gone. Also runs once a day. Same check from a terminal: <code>node &lt;brain&gt;\\tools\\check-memory.js</code></p>`
      + (data.groups || []).map((g) => `<section class="card mh-group ${esc(g.level)}"><h3>${esc(g.title)}<span class="mh-chip ${esc(g.level)}">${g.items.length}</span></h3><p class="muted">${esc(g.hint)}</p>
        <ul class="mh-items">${g.items.map((i) => `<li>${i.file ? (/\.md$/i.test(i.file) && i.file !== "MEMORY.md" ? `<button class="linkish mh-file" type="button" data-mh-open="${esc(i.file)}">${esc(i.file)}</button>` : `<span class="mh-file">${esc(i.file)}</span>`) : ""}<span class="t">${esc(i.text)}</span></li>`).join("")}</ul></section>`).join("");
  }
  async function load(fresh) {
    busy = true; draw();
    try { data = await api(fresh === false ? "/api/memhealth/last" : "/api/memhealth"); if (!data || !data.counts) data = fresh === false ? null : { error: (data && data.error) || "no answer" }; }
    catch { data = { error: "Can't reach The Wise Hive." }; }
    busy = false; draw(); data && drawBadge(data.counts);
  }
  function select() {
    tabs.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", t === tab));
    document.querySelectorAll("#v-library [id^='lt-']").forEach((d) => (d.hidden = d !== pane));
    load();
  }
  tab.onclick = select;
  // The Library's own tabs don't know this pane: hide it when one of them is picked.
  tabs.addEventListener("click", (e) => { const t = e.target.closest(".tab"); if (t && t !== tab) pane.hidden = true; });
  // Open a memory in the Library's editor: switch to Memories, filter to it, expand its card.
  pane.addEventListener("click", (e) => {
    if (e.target.closest("[data-mh-run]")) { if (!busy) load(); return; }
    const o = e.target.closest("[data-mh-open]"); if (!o) return;
    const file = o.dataset.mhOpen, memTab = tabs.querySelector('[data-lt="mem"]');
    memTab && memTab.click();
    const m = (typeof MEMS !== "undefined" ? MEMS : []).find((x) => x.file === file);
    const q = $("memSearch"); q.value = m ? m.name : file.replace(/\.md$/i, ""); q.dispatchEvent(new Event("input"));
    const card = [...document.querySelectorAll("#memList .mem")].find((c) => c.dataset.file === file);
    if (card) { card.click(); card.scrollIntoView({ block: "start", behavior: "smooth" }); }
  });
  window.addEventListener("hive:view", (e) => { if (e.detail && e.detail.view === "library") { if (!pane.hidden) load(); else api("/api/memhealth/last").then((d) => d && drawBadge(d.counts)).catch(() => {}); } });
  window.addEventListener("hive:server", (e) => { const ev = e.detail; if (ev && ev.t === "memhealth") { drawBadge(ev.counts); if (!pane.hidden && !busy && (!data || data.at !== ev.at)) load(false); } });
})();
