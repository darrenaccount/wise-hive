/* Plugins tab: the Claude Code plugins every The Wise Hive chat loads. Turn them on or off, update, uninstall, install more
   from your marketplaces, and manage marketplaces. Uses plugins.js (the `claude plugin` CLI). */
(function () {
  "use strict";
  const root = document.getElementById("pluginsRoot");
  if (!root) return;
  const css = document.createElement("style");
  css.textContent = `
  .pl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px}
  .pl-card{display:flex;flex-direction:column;gap:8px;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:14px}
  .pl-card.off{opacity:.65}
  .pl-top{display:flex;align-items:center;gap:10px}
  .pl-top b{font-family:var(--f-display);font-size:17px}
  .pl-meta{font-size:12px;color:var(--muted)}
  .pl-skills{display:flex;flex-wrap:wrap;gap:5px}
  .pl-skills span{font-size:11.5px;padding:2px 8px;border-radius:999px;background:var(--raised);border:1px solid var(--line)}
  .switch{position:relative;width:40px;height:22px;border-radius:999px;border:1px solid var(--line);background:var(--raised);cursor:pointer;padding:0;flex:none}
  .switch::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--muted);transition:transform .15s,background .15s}
  .switch[aria-checked="true"]{background:var(--claude-soft);border-color:var(--claude)}
  .switch[aria-checked="true"]::after{transform:translateX(18px);background:var(--claude)}
  .pl-warn{font-size:12.5px;color:var(--muted);border-left:3px solid var(--warn);padding:4px 10px}
  `;
  document.head.appendChild(css);

  let D = { installed: [], available: [], marketplaces: [] }, busy = null, armed = null, loaded = false, mine = false;
  root.innerHTML = `
    <header><span class="bob" style="width:60px">${mascot("builder", "Plugins")}</span><div><h1>Plugins</h1><p class="muted" style="margin:2px 0 0">Claude Code plugins add skills, agents, commands and tools to every The Wise Hive chat. Changes apply to chats you start afterwards.</p></div><span class="spacer"></span><button class="btn small" id="plRefresh" type="button">Refresh</button></header>
    <div class="banner" id="plStatus" hidden></div>
    <section class="stack"><h2 class="sec">Installed</h2><div class="pl-grid" id="plInstalled"></div></section>
    <section class="stack"><h2 class="sec">Available from your marketplaces</h2><p class="pl-warn">Plugins can run code on this PC (hooks and tool servers). Only install ones from sources you trust.</p><input type="text" id="plSearch" placeholder="Search available plugins"><div class="pl-grid" id="plAvailable"></div></section>
    <section class="card stack"><h2 class="sec" style="margin:0">Marketplaces</h2><div id="plMarkets" class="stack"></div>
      <div class="row"><input type="text" id="plMarketSrc" style="flex:1;min-width:220px" placeholder="Add a marketplace: GitHub owner/repo, a git URL or a folder path"><button class="btn small primary" id="plMarketAdd" type="button">Add</button><button class="btn small" id="plMarketUpd" type="button">Update all</button></div></section>`;
  const $p = (id) => document.getElementById(id);

  function status(text, bad) { const s = $p("plStatus"); s.hidden = !text; s.textContent = text || ""; s.style.borderColor = bad ? "var(--bad)" : ""; }
  function draw() {
    const dis = busy ? "disabled" : "";
    $p("plInstalled").innerHTML = D.installed.map((p) => `<div class="pl-card ${p.enabled ? "" : "off"}" data-id="${esc(p.id)}">
      <div class="pl-top"><b>${esc(p.name)}</b><span class="chip">v${esc(p.version || "?")}</span><span class="spacer"></span>
        <button class="switch" type="button" role="switch" aria-checked="${p.enabled}" aria-label="${p.enabled ? "Turn off" : "Turn on"} ${esc(p.name)}" data-act="${p.enabled ? "disable" : "enable"}" ${dis}></button></div>
      <div class="pl-meta">From ${esc(p.marketplace || "local")} · ${p.enabled ? "On" : "Off"}${p.lastUpdated ? " · updated " + ago(p.lastUpdated) : ""}${p.hooks ? " · has hooks" : ""}${p.mcp ? " · has tools" : ""}${p.agents ? ` · ${p.agents} agent${p.agents === 1 ? "" : "s"}` : ""}${p.commands ? ` · ${p.commands} command${p.commands === 1 ? "" : "s"}` : ""}</div>
      ${p.skills.length ? `<details><summary class="muted" style="cursor:pointer;font-size:13px">${p.skills.length} skill${p.skills.length === 1 ? "" : "s"}</summary><div class="pl-skills" style="margin-top:6px">${p.skills.map((s) => `<span title="${esc(s.description)}">${esc(s.name)}</span>`).join("")}</div></details>` : ""}
      <div class="row" style="gap:6px"><button class="btn small" type="button" data-act="update" ${dis}>Update</button><span class="spacer"></span><button class="btn small" type="button" data-act="uninstall" ${dis}>${armed === p.id ? "Click again to uninstall" : "Uninstall"}</button></div></div>`).join("")
      || `<div class="none">${loaded ? "No plugins installed yet." : "Loading…"}</div>`;
    const q = ($p("plSearch").value || "").toLowerCase();
    const all = D.available.filter((p) => !q || (p.name + " " + p.description + " " + p.marketplace).toLowerCase().includes(q));
    const av = all.slice(0, 60); // thousands can be listed; search narrows them
    $p("plAvailable").innerHTML = (all.length > av.length ? `<div class="none" style="grid-column:1/-1">Showing ${av.length} of ${all.length.toLocaleString()}. Search to find more.</div>` : "") + av.map((p) => `<div class="pl-card" data-id="${esc(p.id)}"><div class="pl-top"><b>${esc(p.name)}</b><span class="chip">v${esc(p.version || "?")}</span></div>
      <div class="pl-meta">From ${esc(p.marketplace)}</div><div style="font-size:13.5px">${esc(p.description)}</div>
      <div class="row"><span class="spacer"></span><button class="btn small primary" type="button" data-act="install" ${dis}>Install</button></div></div>`).join("")
      || `<div class="none">${loaded ? (q ? "No plugins match." : "Nothing else available. Add a marketplace below to see more.") : "Loading…"}</div>`;
    $p("plMarkets").innerHTML = D.marketplaces.map((m) => `<div class="row" data-market="${esc(m.name)}"><b>${esc(m.name)}</b><span class="muted" style="font-size:12px">${esc(m.source)}</span><span class="spacer"></span><button class="btn small" type="button" data-mact="remove" ${dis}>${armed === "m:" + m.name ? "Click again to remove" : "Remove"}</button></div>`).join("") || `<div class="none">No marketplaces.</div>`;
    for (const b of [$p("plMarketAdd"), $p("plMarketUpd"), $p("plRefresh")]) b.disabled = !!busy;
  }
  async function load(refresh) {
    try {
      const r = await api("/api/plugins" + (refresh ? "?refresh=1" : ""));
      // A reply without the lists (an error from the server) keeps what's on screen and says why.
      if (r && Array.isArray(r.installed)) { D = r; busy = r.busy || null; loaded = true; status(r.error ? "Couldn't read the plugin list: " + r.error : busy ? `Working: ${busy}…` : "", !!r.error); }
      else status("Couldn't read the plugin list: " + ((r && r.error) || "no answer"), true);
    }
    catch { status("Can't reach The Wise Hive.", true); }
    draw();
  }
  async function act(path, payload, label) {
    busy = label; mine = true; status(`Working: ${label}… this can take a minute.`); draw();
    let r; try { r = await api(path, { method: "POST", body: JSON.stringify(payload) }); } catch { r = { error: "Lost connection to The Wise Hive." }; }
    busy = null; mine = false;
    if (r.error) status(r.error, true); else { status(""); toast("Done", `${label}. New chats will use it.`); }
    await load(true);
  }
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act],[data-mact]"); if (!b || busy) return;
    if (b.dataset.mact) {
      const name = b.closest("[data-market]").dataset.market;
      if (armed !== "m:" + name) { armed = "m:" + name; draw(); setTimeout(() => { if (armed === "m:" + name) { armed = null; draw(); } }, 4000); return; }
      armed = null; return act("/api/plugins/marketplace", { action: "remove", name }, `Removing marketplace ${name}`);
    }
    const id = b.closest("[data-id]").dataset.id, a = b.dataset.act;
    if (a === "uninstall" && armed !== id) { armed = id; draw(); setTimeout(() => { if (armed === id) { armed = null; draw(); } }, 4000); return; }
    armed = null;
    const verb = { install: "Installing", uninstall: "Uninstalling", enable: "Turning on", disable: "Turning off", update: "Updating" }[a];
    act("/api/plugins/action", { action: a, id }, `${verb} ${id.split("@")[0]}`);
  });
  $p("plSearch").addEventListener("input", draw);
  $p("plRefresh").onclick = () => { status("Refreshing…"); load(true); };
  $p("plMarketAdd").onclick = () => { const s = $p("plMarketSrc").value.trim(); if (!s) return $p("plMarketSrc").focus(); $p("plMarketSrc").value = ""; act("/api/plugins/marketplace", { action: "add", source: s }, `Adding marketplace ${s}`); };
  $p("plMarketUpd").onclick = () => act("/api/plugins/marketplace", { action: "update" }, "Updating marketplaces");
  window.addEventListener("hive:view", (e) => { if (e.detail && e.detail.view === "plugins") load(false); });
  // The server says when an install or update starts and ends (one from another window, or one still running after a
  // reload), so the buttons lock and unlock with it. This window's own action is handled by act().
  window.addEventListener("hive:server", (e) => {
    const ev = e.detail, v = $p("v-plugins");
    if (!ev || ev.t !== "plugins" || mine || !v || v.hidden) return;
    if (ev.busy) { busy = ev.busy; status(`Working: ${busy}…`); draw(); } else load(true);
  });
  draw();
})();
