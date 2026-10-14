/* Updates tab: the page side of updates.js. Shows the Claude versions the Messenger watches, what it did about them,
   and its settings. The view is built once into #updatesRoot, then refreshed from GET /api/updates whenever the
   server says something changed (and every 15 s while the tab is open). */
(function () {
  "use strict";
  const TYPES = {
    check: ["Check", ""], "cli-update": ["Claude Code updated", "ok"], adapt: ["Adapted", "ok"], "no-change": ["No change needed", ""],
    rollback: ["Rolled back", "bad"], error: ["Error", "bad"], restart: ["Restarted", "ok"], restore: ["Restored", "ok"],
  };
  const DIFF_LINES = 4000; // a commit's diff on the page; the server already cuts it at 200 KB
  const INTERVALS = [1, 3, 6, 12, 24];
  const SHOW = 40, LONG = 600;
  const OFFLINE = "Can't reach The Wise Hive.";
  let data = null, els = null, poll = 0, deb = 0, armTimer = 0, armed = false, showAll = false, failed = false;
  const opened = new Set(); // history entries whose long text is expanded
  // Version history (git): the list, each opened diff, and the inline "Are you sure?" for a restore.
  let vh = null, histSig = "", histFailed = false, confirmHash = null, restoring = null, restoreMsg = null;
  const diffs = new Map(), shownDiffs = new Set();

  const style = document.createElement("style");
  style.textContent = `
.upd-head{display:flex;align-items:center;gap:16px}
.upd-me{width:64px;flex:none}
.upd-head h1{font-size:26px}
.upd-head p{margin:2px 0 0}
.upd-status{display:flex;flex-direction:column;gap:10px}
.upd-line{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.upd-line b{font:600 19px var(--f-display)}
.upd-sub{margin:0;font-size:13.5px;color:var(--muted);overflow-wrap:anywhere}
.upd-dot{flex:none;width:10px;height:10px;border-radius:50%;background:var(--muted)}
.upd-dot.ok{background:var(--ok)}.upd-dot.warn{background:var(--warn)}.upd-dot.bad{background:var(--bad)}
.upd-dot.on{background:var(--claude);animation:livepulse 1.6s ease-out infinite}
.upd-status.on{border-color:color-mix(in srgb,var(--claude) 45%,var(--line));box-shadow:0 0 0 4px var(--claude-glow)}
.upd-status.bad{border-color:color-mix(in srgb,var(--bad) 45%,var(--line))}
.upd-vers{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.upd-ver{display:flex;flex-direction:column;gap:4px;padding:14px 16px;min-width:0}
.upd-ver small{color:var(--muted);font-size:12px}
.upd-ver .upd-name{display:flex;align-items:center;gap:8px;font-weight:700;font-size:13px;color:var(--muted)}
.upd-ver .upd-name .upd-dot{width:8px;height:8px}
.upd-num{font:600 22px var(--f-display);overflow-wrap:anywhere}
.upd-num.unknown{color:var(--muted);font-size:18px}
.upd-set{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.upd-set .toggle{color:var(--ink);font-size:14px}
.upd-set select{padding:6px 10px}
.btn.armed{background:var(--warn);border-color:var(--warn);color:var(--bg)}
.upd-tl{list-style:none;margin:0;padding:0 0 0 18px;display:flex;flex-direction:column;gap:12px;border-left:2px solid var(--line);margin-left:6px}
.upd-ev{position:relative;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:10px 14px;display:flex;flex-direction:column;gap:4px;min-width:0}
.upd-ev::before{content:"";position:absolute;left:-26px;top:16px;width:10px;height:10px;border-radius:50%;background:var(--muted);border:2px solid var(--bg)}
.upd-ev.ok::before{background:var(--ok)}.upd-ev.bad::before{background:var(--bad)}
.upd-ev-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12.5px;color:var(--muted)}
.upd-ev-top time{margin-left:auto}
.upd-ev .chip.ok{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 35%,var(--line))}
.upd-ev .chip.bad{color:var(--bad);border-color:color-mix(in srgb,var(--bad) 35%,var(--line))}
.upd-ev .md{font-size:14px;overflow-wrap:anywhere}
.upd-ev .md.clamp{max-height:8.5em;overflow:hidden;-webkit-mask-image:linear-gradient(#000 60%,transparent)}
.upd-ev .row{gap:10px}
.upd-hist{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.upd-c{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:10px 14px;display:flex;flex-direction:column;gap:6px;min-width:0}
.upd-c.cur{border-color:color-mix(in srgb,var(--ok) 40%,var(--line))}
.upd-c-top{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;min-width:0}
.upd-c-top code{font:12.5px var(--f-mono);color:var(--claude)}
.upd-c-top b{font-weight:600;font-size:14px;overflow-wrap:anywhere;flex:1;min-width:0}
.upd-c-top time,.upd-c-meta{font-size:12.5px;color:var(--muted)}
.upd-c .chip.ok{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 35%,var(--line))}
.upd-c .row{gap:10px;align-items:center}
.upd-ask{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 10px;border:1px solid var(--warn);border-radius:8px;font-size:13.5px}
.upd-msg{font-size:13.5px;padding:8px 10px;border-radius:8px;border:1px solid var(--line)}
.upd-msg.ok{border-color:color-mix(in srgb,var(--ok) 45%,var(--line))}.upd-msg.bad{border-color:color-mix(in srgb,var(--bad) 45%,var(--line))}
.upd-c .diff{max-height:480px}
.upd-c .diff .hk{color:var(--muted)}
@media (max-width:1060px){.upd-vers{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:860px){.upd-me{width:52px}.upd-head h1{font-size:22px}.upd-tl{padding-left:14px}.upd-ev::before{left:-22px}}
`;
  document.head.appendChild(style);

  const root = () => $("updatesRoot");
  const visible = () => !$("v-updates").hidden;
  const newer = (a, b) => {
    if (!a || !b) return false;
    const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0; }
    return false;
  };
  const when = (iso) => { try { return new Date(iso).toLocaleString(); } catch { return ""; } };
  const until = (iso) => {
    const s = (new Date(iso) - Date.now()) / 1000;
    if (!(s > 0)) return "soon";
    if (s < 3600) return `in ${Math.max(1, Math.round(s / 60))} min`;
    return `in ${Math.round(s / 3600)} h`;
  };
  const lastOf = (st) => (st.history && st.history.length ? st.history[st.history.length - 1] : st.last || null);
  const failedEntry = (e) => !!e && (e.type === "error" || e.type === "rollback");

  function setDot(st) {
    const d = $("updDot");
    if (d && st) d.hidden = !(st.pendingRestart || failedEntry(lastOf(st)));
  }

  /* ---------- build ---------- */
  function build() {
    if (els) return true;
    const r = root();
    if (!r) return false;
    r.innerHTML = `
<header class="upd-head"><div class="upd-me bob" data-el="me">${mascot("messenger", "The Messenger")}</div>
  <div><h1>Updates</h1><p class="muted">The Messenger keeps The Wise Hive in step with the Claude desktop app.</p></div></header>
<section class="card upd-status" data-el="status">
  <div class="upd-line"><span class="upd-dot" data-el="sdot"></span><b data-el="stext">Loading</b></div>
  <p class="upd-sub" data-el="ssub"></p>
  <div class="row">
    <button class="btn primary" type="button" data-act="check" data-el="check">Check for updates now</button>
    <button class="btn" type="button" data-act="readapt" data-el="readapt">Re-adapt The Wise Hive to this version</button>
    <button class="btn" type="button" data-act="restart" data-el="restart" hidden>Restart The Wise Hive now</button>
    <button class="btn small" type="button" data-act="open" data-el="live" hidden>Open the update chat</button>
  </div>
</section>
<div class="upd-vers" data-el="vers"></div>
<section class="card upd-set">
  <label class="toggle"><input type="checkbox" data-el="auto"> Check automatically</label>
  <select data-el="every" aria-label="How often to check"></select>
  <span class="muted" style="font-size:13px" data-el="next"></span>
</section>
<h2 class="sec">History</h2>
<p class="upd-sub" data-el="vsub">Every saved version of The Wise Hive's code. Restoring one saves it as a new version, so nothing is lost.</p>
<div data-el="vmsg" hidden></div>
<ol class="upd-hist" data-el="vlist"></ol>
<h2 class="sec">Update log</h2>
<ol class="upd-tl" data-el="hist"></ol>
<div data-el="more"></div>`;
    els = {};
    for (const n of r.querySelectorAll("[data-el]")) els[n.dataset.el] = n;
    r.addEventListener("click", onClick);
    els.auto.addEventListener("change", () => settings({ auto: els.auto.checked }));
    els.every.addEventListener("change", () => settings({ intervalHours: Number(els.every.value) }));
    return true;
  }

  /* ---------- render ---------- */
  function status(d) {
    const st = d.state, v = st.versions || {}, last = lastOf(st);
    if (d.busy) {
      const text = d.phase === "cli-update" ? "Updating Claude Code" : d.phase === "adapt" ? "Adapting The Wise Hive…" : d.phase === "restore" ? "Restoring an older version…" : "Checking for updates…";
      return { cls: "on", text, sub: d.step || "" };
    }
    if (st.pendingRestart) return { cls: "warn", text: "Restart pending", sub: `The Wise Hive was adapted to Claude Code ${st.lastAdaptedVersion}. It restarts on the new code as soon as no chats are running.` };
    if (failedEntry(last)) return { cls: "bad", text: "Last check failed", sub: String(last.text || "").split("\n")[0] };
    if (!st.lastCheck) return { cls: "", text: "Not checked yet", sub: st.auto && st.nextCheck ? `First check ${until(st.nextCheck)}.` : "" };
    if (v.cli && st.lastAdaptedVersion && newer(v.cli, st.lastAdaptedVersion)) return { cls: "warn", text: "Not adapted yet", sub: `The Wise Hive runs Claude Code ${v.cli} but was last adapted to ${st.lastAdaptedVersion}.` };
    return { cls: "ok", text: "Up to date", sub: `Checked ${ago(st.lastCheck)}.` };
  }
  function versionCards(st) {
    const v = st.versions || {}, err = st.readErrors || {};
    const card = (key, name, sub, dot) => {
      const val = v[key];
      const tip = err[key] ? `Couldn't read it: ${err[key]}` : "";
      return `<div class="card upd-ver"${tip ? ` title="${esc(tip)}"` : ""}><span class="upd-name"><span class="upd-dot ${val ? dot : err[key] ? "bad" : ""}"></span>${esc(name)}</span>
        <span class="upd-num${val ? "" : " unknown"}">${esc(val || "unknown")}</span><small>${esc(val ? sub : tip ? "Couldn't read it" : "Not checked yet")}</small></div>`;
    };
    const behind = newer(v.desktopCode, v.cli), adaptedBehind = v.cli && st.lastAdaptedVersion && newer(v.cli, st.lastAdaptedVersion);
    return [
      card("desktopApp", "Claude desktop app", "The installed app", "ok"),
      card("desktopCode", "Desktop app's Claude Code", behind ? "Newer than The Wise Hive's" : "Bundled with the app", behind ? "warn" : "ok"),
      card("cli", "The Wise Hive's Claude Code", st.lastAdaptedVersion ? (adaptedBehind ? `Adapted to ${st.lastAdaptedVersion}; not this one yet` : `The Wise Hive is adapted to ${st.lastAdaptedVersion}`) : "Runs every chat in The Wise Hive", adaptedBehind ? "warn" : "ok"),
      card("latest", "Latest release", newer(v.latest, v.cli) ? "Newer than The Wise Hive's" : "Released on npm", newer(v.latest, v.cli) ? "warn" : "ok"),
    ].join("");
  }
  function entry(e) {
    const [label, cls] = TYPES[e.type] || [e.type, ""];
    const text = String(e.text || "");
    const long = text.length > LONG && !opened.has(e.id);
    const vers = e.from && e.to && e.from !== e.to ? `${esc(e.from)} → ${esc(e.to)}` : e.to ? esc(e.to) : "";
    return `<li class="upd-ev ${cls}"><div class="upd-ev-top"><span class="chip ${cls}">${esc(label)}</span>${vers ? `<span>${vers}</span>` : ""}${e.count > 1 ? `<span>· ${e.count} checks</span>` : ""}
      <time datetime="${esc(e.at)}" title="${esc(when(e.at))}">${esc(ago(e.at))}</time></div>
      <div class="md${long ? " clamp" : ""}">${md(text)}</div>
      ${long || e.chatId ? `<div class="row">${long ? `<button class="linkish" type="button" data-act="expand" data-id="${esc(e.id)}">Show more</button>` : ""}${e.chatId ? `<button class="btn small" type="button" data-act="open" data-chat="${esc(e.chatId)}">Open the update chat</button>` : ""}</div>` : ""}</li>`;
  }
  function render() {
    if (!els) return;
    if (!data) { if (failed) { els.stext.textContent = OFFLINE; els.sdot.className = "upd-dot bad"; els.check.disabled = els.readapt.disabled = true; } return; }
    const d = data, st = d.state;
    const s = failed ? { cls: "bad", text: OFFLINE, sub: "Start The Wise Hive again, or wait for it to come back." } : status(d);
    els.status.className = `card upd-status ${s.cls}`;
    els.sdot.className = `upd-dot ${s.cls}`;
    els.stext.textContent = s.text;
    els.ssub.textContent = s.sub;
    els.ssub.hidden = !s.sub;
    els.me.classList.toggle("bob", !d.busy);
    els.me.classList.toggle("working", !!d.busy);
    els.check.disabled = !!d.busy || failed;
    els.readapt.disabled = !!d.busy || failed || !(st.versions || {}).cli;
    if (!armed) els.readapt.textContent = "Re-adapt The Wise Hive to this version";
    els.readapt.title = "Runs Claude again on the changelog for this version and checks its changes.";
    els.restart.hidden = !st.pendingRestart;
    els.restart.disabled = !!d.busy || failed;
    els.live.hidden = !(d.busy && d.adaptChat);
    if (d.adaptChat) els.live.dataset.chat = d.adaptChat;
    els.vers.innerHTML = versionCards(st);
    // Leave the settings alone while the user is changing them.
    if (document.activeElement !== els.auto) els.auto.checked = !!st.auto;
    if (document.activeElement !== els.every) {
      const hs = INTERVALS.includes(st.intervalHours) ? INTERVALS : [...INTERVALS, st.intervalHours].sort((a, b) => a - b);
      els.every.innerHTML = hs.map((h) => `<option value="${h}"${h === st.intervalHours ? " selected" : ""}>Every ${h} h</option>`).join("");
    }
    els.every.disabled = !st.auto;
    els.next.textContent = !st.auto ? "Automatic checks are off." : d.busy ? "" : st.nextCheck ? `Next check ${until(st.nextCheck)}.` : "";
    const hist = (st.history || []).slice().reverse();
    const shown = showAll ? hist : hist.slice(0, SHOW);
    els.hist.innerHTML = shown.map(entry).join("") || `<li class="none" style="list-style:none">Nothing yet. The first check sets the version The Wise Hive is adapted to.</li>`;
    els.more.innerHTML = hist.length > shown.length ? `<button class="btn small" type="button" data-act="all">Show all ${hist.length}</button>` : "";
    // Only the buttons: re-drawing the version list would close open diffs' scroll position on every refresh.
    for (const b of els.vlist.querySelectorAll('[data-act="hrestore"]')) b.disabled = noRestore() || confirmHash === b.dataset.h;
    setDot(st);
  }

  /* ---------- version history (git) ---------- */
  const noRestore = () => !!(data && data.busy) || !!restoring || failed;
  const HK = /^(index |new file|deleted file|similarity|dissimilarity|rename |copy |old mode|new mode|--- |\+\+\+ |@@|Binary files)/;
  function diffHtml(text, truncated) {
    const lines = String(text || "").replace(/\n$/, "").split("\n");
    const rows = lines.slice(0, DIFF_LINES).map((l) => {
      const cls = l.startsWith("diff --git ") ? "hd" : HK.test(l) ? "hk" : l[0] === "+" ? "add" : l[0] === "-" ? "del" : "";
      return `<div${cls ? ` class="${cls}"` : ""}>${esc(l) || " "}</div>`;
    }).join("");
    const cut = truncated || lines.length > DIFF_LINES;
    return `<div class="diff">${rows || '<div class="hk">No file changes.</div>'}${cut ? '<div class="hd">Cut here: this change is too long to show in full.</div>' : ""}</div>`;
  }
  function commitHtml(c, i) {
    const cur = i === 0, open = shownDiffs.has(c.hash), d = diffs.get(c.hash), H = esc(c.hash);
    const ask = confirmHash === c.hash;
    return `<li class="upd-c${cur ? " cur" : ""}"><div class="upd-c-top"><code>${esc(c.short)}</code><b>${esc(c.subject || "(no message)")}</b>${cur ? '<span class="chip ok">Current</span>' : ""}
      <time datetime="${esc(c.date)}" title="${esc(when(c.date))}">${esc(ago(c.date))}</time></div>
      <div class="upd-c-meta">${Number(c.files) || 0} file${c.files === 1 ? "" : "s"} changed${c.author ? ` · ${esc(c.author)}` : ""}</div>
      <div class="row"><button class="linkish" type="button" data-act="hdiff" data-h="${H}">${open ? "Hide changes" : "Show changes"}</button>
        ${cur ? "" : `<button class="btn small" type="button" data-act="hrestore" data-h="${H}"${noRestore() || ask ? " disabled" : ""}>Restore this version</button>`}</div>
      ${ask ? `<div class="upd-ask"><span>Are you sure? The Wise Hive's code goes back to how it was in <code>${esc(c.short)}</code>. This is saved as a new version, so you can undo it the same way.</span>
        <button class="btn small primary" type="button" data-act="hyes" data-h="${H}"${restoring ? " disabled" : ""}>${restoring === c.hash ? "Restoring…" : "Yes, restore"}</button>
        <button class="btn small" type="button" data-act="hno"${restoring ? " disabled" : ""}>No</button></div>` : ""}
      ${open ? (d && d.text != null ? diffHtml(d.text, d.truncated) : `<p class="upd-sub">${esc(d && d.error ? d.error : "Loading the changes…")}</p>`) : ""}</li>`;
  }
  function renderHist() {
    if (!els) return;
    const none = (t) => `<li class="none" style="list-style:none">${t}</li>`;
    if (!vh) els.vlist.innerHTML = none(histFailed ? "Couldn't load the history." : "Loading…");
    else if (!vh.repo) els.vlist.innerHTML = none(`No version history: ${esc(vh.why || "git isn't set up")}. Updates still keep backup folders.`);
    else els.vlist.innerHTML = vh.commits.map(commitHtml).join("") || none("No saved versions yet.");
    const n = vh && vh.dirty ? vh.dirty.length : 0;
    els.vsub.textContent = "Every saved version of The Wise Hive's code. Restoring one saves it as a new version, so nothing is lost." +
      (n ? ` ${n} file${n === 1 ? " has" : "s have"} changed since the last saved version.` : "");
    els.vmsg.hidden = !restoreMsg;
    els.vmsg.className = restoreMsg ? `upd-msg ${restoreMsg.ok ? "ok" : "bad"}` : "";
    els.vmsg.innerHTML = restoreMsg ? `<div class="md">${md(restoreMsg.text)}</div>${restoreMsg.restart ? '<div class="row" style="margin-top:6px"><button class="btn small" type="button" data-act="restart">Restart The Wise Hive now</button></div>' : ""}` : "";
  }
  // Re-draws only when the list itself changed, so open diffs keep their place.
  async function loadHist(force) {
    let r = null;
    try { r = await api("/api/history"); } catch {}
    if (!r || !Array.isArray(r.commits)) { histFailed = true; if (!vh || force) renderHist(); return; }
    histFailed = false;
    const sig = JSON.stringify([r.repo, r.why, r.commits.map((c) => c.hash), r.dirty]);
    vh = r;
    if (force || sig !== histSig) { histSig = sig; renderHist(); }
  }
  async function toggleDiff(h) {
    if (shownDiffs.has(h)) { shownDiffs.delete(h); return renderHist(); }
    shownDiffs.add(h);
    renderHist();
    const d = diffs.get(h);
    if (d && d.text != null) return;
    let r = null;
    try { r = await api(`/api/history/${encodeURIComponent(h)}/diff`); } catch {}
    diffs.set(h, r && typeof r.diff === "string" ? { text: r.diff, truncated: !!r.truncated } : { error: (r && r.error) || OFFLINE });
    renderHist();
  }
  async function restoreTo(h) {
    restoring = h;
    renderHist();
    let r = null;
    try { r = await api(`/api/history/${encodeURIComponent(h)}/restore`, { method: "POST", body: JSON.stringify({ confirm: true }) }); } catch {}
    restoring = null; confirmHash = null;
    if (!r) restoreMsg = { ok: false, text: OFFLINE };
    else if (r.error) restoreMsg = { ok: false, text: `Couldn't restore: ${r.error}` };
    else if (r.nothing) restoreMsg = { ok: true, text: r.message || "Nothing to restore." };
    else restoreMsg = { ok: true, restart: true, text: `Restored version \`${r.restored}\` (${r.files} file${r.files === 1 ? "" : "s"}), saved as \`${r.commit}\`. **Restart The Wise Hive** to run the restored code; until then the old code keeps running.` };
    await loadHist(true);
    refresh();
  }

  /* ---------- server ---------- */
  async function refresh() {
    let r = null;
    try { r = await api("/api/updates"); } catch {}
    if (!r || !r.state) { failed = true; render(); return; }
    failed = false;
    data = r;
    setDot(r.state);
    render();
  }
  async function post(path, body, what) {
    let r = null;
    try { r = await api("/api/updates/" + path, { method: "POST", body: JSON.stringify(body || {}) }); } catch {}
    if (!r) { toast(what, OFFLINE); return null; }
    if (r.error) { toast(what, r.error); }
    if (r.state) { data = { ...data, ...r }; render(); }
    return r;
  }
  function settings(o) { post("settings", o, "Couldn't save the setting").then(refresh); }
  function onClick(e) {
    const b = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
    if (!b || b.disabled) return;
    const a = b.dataset.act;
    if (a === "check") { b.disabled = true; post("check", {}, "Couldn't start a check").then(refresh); }
    else if (a === "readapt") {
      // Starts a long Opus run that edits The Wise Hive's code, so it takes a second click.
      if (!armed) {
        armed = true; b.classList.add("armed"); b.textContent = "Click again to re-adapt";
        clearTimeout(armTimer);
        armTimer = setTimeout(() => { armed = false; b.classList.remove("armed"); render(); }, 4000);
        return;
      }
      armed = false; clearTimeout(armTimer); b.classList.remove("armed"); b.disabled = true;
      post("adapt", { force: true }, "Couldn't start the re-adapt").then(refresh);
    }
    // Refused (e.g. chats still running): the button works again; the restore message's copy is never redrawn.
    else if (a === "restart") { b.disabled = true; post("restart", {}, "Couldn't restart The Wise Hive").then((r) => { if (r && r.ok) toast("Restarting The Wise Hive", "The window closes and opens again in a few seconds."); else b.disabled = false; refresh(); }); }
    else if (a === "open") {
      const id = b.dataset.chat;
      if (id && typeof openSession === "function") Promise.resolve().then(() => openSession(id)).catch(() => toast("Couldn't open the chat", OFFLINE));
    }
    else if (a === "expand") { opened.add(b.dataset.id); render(); }
    else if (a === "all") { showAll = true; render(); }
    else if (a === "hdiff") toggleDiff(b.dataset.h);
    // Restoring rewrites the app's code, so it asks inline first (no browser dialogs: they'd block automation).
    else if (a === "hrestore") { confirmHash = b.dataset.h; restoreMsg = null; renderHist(); }
    else if (a === "hno") { confirmHash = null; renderHist(); }
    else if (a === "hyes" && !restoring) restoreTo(b.dataset.h);
  }

  /* ---------- lifecycle ---------- */
  function enter() {
    if (!build()) return;
    render();
    refresh();
    loadHist(true);
    if (!poll) poll = setInterval(() => { refresh(); loadHist(); }, 15000);
  }
  function leave() {
    clearInterval(poll); poll = 0;
    if (armed) { armed = false; clearTimeout(armTimer); render(); }
    if (confirmHash && !restoring) { confirmHash = null; renderHist(); }
  }
  window.addEventListener("hive:view", (e) => { if (e.detail && e.detail.view === "updates") enter(); else leave(); });
  window.addEventListener("hive:server", (e) => {
    const ev = e.detail || {};
    if (ev.t === "updates") {
      if (ev.state) setDot(ev.state);
      if (visible()) { clearTimeout(deb); deb = setTimeout(() => { refresh(); loadHist(); }, 300); }
    } else if (ev.t === "hello") refresh(); // back online: the dot may be stale
  });
  // Once at load, so the nav dot is right before the tab is opened.
  if (visible()) enter(); else refresh();
})();
