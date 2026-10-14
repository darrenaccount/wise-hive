/* Review: the page side of review.js. A "Review" section inside the Working view (added next to the current-round card,
   without touching autopilot-client.js) listing the rounds Working did that aren't on the user's branch yet, with
   Keep / Discard / Keep all, and a count badge on the Working tab. */
(function () {
  "use strict";
  const style = document.createElement("style");
  style.textContent = `
#reviewBadge{left:6px;right:auto;background:var(--gold);color:var(--bg)}
.rv-sec{gap:10px}
.rv-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.rv-head h2.sec{margin:0}
.rv-count{color:var(--gold);border-color:color-mix(in srgb,var(--gold) 40%,var(--line));background:color-mix(in srgb,var(--gold) 9%,var(--raised))}
.rv-head label{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;color:var(--muted)}
.rv-head select{padding:4px 9px;font-size:12.5px;border-radius:10px;background:var(--raised);max-width:220px}
.rv-note{margin:0;font-size:12.5px;color:var(--muted)}
.rv-note.warn{color:var(--warn)}
.rv-msg{margin:0;font-size:13px}
.rv-msg.bad{color:var(--bad)}.rv-msg.ok{color:var(--ok)}
.rv-list{display:flex;flex-direction:column;gap:10px}
.rv-round{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:6px;min-width:0}
.rv-round.running{opacity:.7}
.rv-top{display:flex;align-items:center;gap:6px 8px;flex-wrap:wrap}
.rv-top .ap-t{margin-left:0}
.rv-kick{font:700 11px var(--f-body);text-transform:uppercase;letter-spacing:.09em;color:var(--claude)}
.rv-title{font-size:15px;line-height:1.35;overflow-wrap:anywhere}
.rv-sum{font-size:13px;color:var(--muted);overflow-wrap:anywhere;max-height:9.5em;overflow:auto}
.rv-sum p{margin:2px 0}
.rv-files{display:flex;flex-wrap:wrap;gap:4px 10px;font:12px var(--f-mono);color:var(--muted)}
.rv-files span{white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}
.rv-files i{font-style:normal;color:var(--ok)}.rv-files u{text-decoration:none;color:var(--bad)}
.rv-round details>summary{cursor:pointer;color:var(--muted);font-weight:700;font-size:12.5px}
.rv-diff{margin:6px 0 0;max-height:480px;overflow:auto;background:var(--sunk);border:1px solid var(--line);border-radius:10px;padding:8px 0;font:12px/1.45 var(--f-mono);white-space:pre;tab-size:2}
.rv-diff span{display:block;padding:0 10px;min-width:max-content}
.rv-diff .a{background:color-mix(in srgb,var(--ok) 14%,transparent);color:color-mix(in srgb,var(--ok) 70%,var(--ink))}
.rv-diff .d{background:color-mix(in srgb,var(--bad) 14%,transparent);color:color-mix(in srgb,var(--bad) 70%,var(--ink))}
.rv-diff .h{color:var(--claude);font-weight:700;margin-top:6px}
.rv-diff .c{color:var(--gold);font-weight:700;margin-top:8px}
.rv-diff .k{color:var(--muted)}
.rv-notes{margin:6px 0 0;font-size:12.5px;color:var(--muted);white-space:pre-wrap;overflow-wrap:anywhere;max-height:260px;overflow:auto}
.rv-err{margin:0;font-size:13px;color:var(--bad)}
.rv-acts{display:flex;gap:6px;margin-left:auto}
.btn.rv-armed{background:var(--bad);border-color:var(--bad);color:var(--bg)}
.rv-empty{margin:0;color:var(--muted);font-size:13px;background:var(--sunk);border:1px solid var(--line);border-radius:12px;padding:12px 14px}`;
  document.head.appendChild(style);

  const R = { data: null, sel: null, sec: null, sig: "", diffs: new Map(), open: new Set(), armed: null, armTimer: 0, busy: null, msg: null, errs: {}, deb: 0, loading: false };
  const arr = (v) => (Array.isArray(v) ? v : []);
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const when = (t) => { try { return t ? ago(new Date(t).toISOString()) : ""; } catch { return ""; } };

  /* ---------- badge ---------- */
  const nav = document.querySelector('.nav[data-view="working"]');
  const badge = document.createElement("span");
  badge.className = "nav-badge"; badge.id = "reviewBadge"; badge.hidden = true;
  if (nav) nav.appendChild(badge);
  function setBadge(n) {
    badge.hidden = !n; badge.textContent = n > 99 ? "99+" : String(n);
    badge.title = n ? `${plural(n, "round")} from Working waiting for your review` : "";
  }

  /* ---------- markup ---------- */
  const OUT = { done: "", failed: "failed", stopped: "stopped", commit: "not from a round" };
  function filesHTML(files) {
    const list = arr(files);
    if (!list.length) return "";
    const shown = list.slice(0, 14).map((f) => `<span title="${esc(f.path)}">${esc(f.path)} ${f.binary ? "(binary)" : `<i>+${f.add}</i> <u>-${f.del}</u>`}</span>`).join("");
    return `<div class="rv-files">${shown}${list.length > 14 ? `<span>and ${list.length - 14} more</span>` : ""}</div>`;
  }
  function roundHTML(p, r) {
    const busy = R.busy === r.id || R.busy === "all", armed = (k) => R.armed === `${k}:${r.id}`;
    const btn = (act, label, cls, dis) => `<button class="btn small${cls ? " " + cls : ""}" type="button" data-act="${act}" data-id="${esc(r.id)}"${dis || R.busy ? " disabled" : ""}>${label}</button>`;
    let acts = "";
    if (r.running) acts = `<span class="chip">Still running</span>`;
    else if (p.git && r.commits.length) acts = btn("discard", armed("discard") ? "Click again to undo it" : "Discard", armed("discard") ? "rv-armed" : "") + btn("keep", busy ? "Working…" : `Keep on ${esc(p.base || "?")}`, "primary", !p.base);
    else acts = btn("mark", busy ? "Working…" : "Mark reviewed", "");
    const kick = r.n != null ? `Round ${esc(r.n)}` : `Commit ${esc((r.commits[0] || {}).short || "")}`;
    const out = OUT[r.outcome] ? `<span class="chip">${esc(OUT[r.outcome])}</span>` : "";
    const open = r.chatId ? `<button class="linkish ap-open" type="button" data-act="open" data-chat="${esc(r.chatId)}">Open chat</button>` : "";
    const commits = r.commits.length ? `${plural(r.commits.length, "commit")}: ${r.commits.map((c) => esc(c.short + " " + c.subject)).join(" · ")}` : "";
    const nocommit = p.git && !r.commits.length && !p.noBranch ? `<p class="rv-note">No commits on teamwright/autowork for this round. If it changed something outside git (like Roblox Studio), check the project's ledger.</p>` : "";
    const diff = r.commits.length ? `<details data-k="diff:${esc(r.id)}"${R.open.has("diff:" + r.id) ? " open" : ""}><summary>Show the changes${r.files.length ? ` (${plural(r.files.length, "file")})` : ""}</summary><div class="rv-diffbox">${R.diffs.get(r.id + sigOf(r)) || `<p class="rv-note">Loading…</p>`}</div></details>` : "";
    const notes = r.notes ? `<details data-k="notes:${esc(r.id)}"${R.open.has("notes:" + r.id) ? " open" : ""}><summary>Work log notes</summary><div class="rv-notes">${esc(r.notes)}</div></details>` : "";
    const err = R.errs[r.id] ? `<p class="rv-err" role="alert">${esc(R.errs[r.id])}</p>` : "";
    return `<article class="rv-round${r.running ? " running" : ""}" data-round="${esc(r.id)}">
<div class="rv-top"><span class="rv-kick">${kick}</span>${r.focus ? `<span class="chip ap-focus">${esc(r.focus)}</span>` : ""}${out}<span class="ap-t" title="${esc(r.at ? new Date(r.at).toLocaleString() : "")}">${esc(when(r.at))}</span>${open}<span class="rv-acts">${acts}</span></div>
<b class="rv-title">${esc(r.title)}</b>
${r.summary ? `<div class="md rv-sum">${md(r.summary)}</div>` : ""}${commits ? `<div class="rv-note">${commits}</div>` : ""}${filesHTML(r.files)}${nocommit}${err}${diff}${notes}</article>`;
  }
  const sigOf = (r) => ":" + r.commits.map((c) => c.short).join(",");
  function sectionHTML() {
    const d = R.data;
    if (!d) return `<div class="rv-head"><h2 class="sec">Review</h2></div><p class="rv-note">${R.loading ? "Loading…" : "Can't load the review list."}</p>`;
    const list = arr(d.projects);
    if (!list.length) return `<div class="rv-head"><h2 class="sec">Review</h2></div><p class="rv-empty">Nothing to review yet. When Working finishes rounds, they show up here for you to keep or undo.</p>`;
    const p = list.find((x) => x.slug === R.sel) || list[0];
    R.sel = p.slug;
    const rounds = arr(p.rounds).map((r) => ({ ...r, commits: arr(r.commits), files: arr(r.files) }));
    const waiting = rounds.filter((r) => !r.running).length;
    const projSel = list.length > 1 ? `<label>Project <select data-set="proj">${list.map((x) => `<option value="${esc(x.slug)}"${x.slug === p.slug ? " selected" : ""}>${esc(x.name)}${x.count ? ` (${x.count})` : ""}</option>`).join("")}</select></label>` : `<span class="chip" title="${esc(p.dir || "")}">${esc(p.name)}</span>`;
    const baseSel = p.git && !p.noBranch && arr(p.branches).length ? `<label title="The branch you work on. Keep copies a round's commits onto it.">Keep on <select data-set="base">${arr(p.branches).map((b) => `<option value="${esc(b)}"${b === p.base ? " selected" : ""}>${esc(b)}</option>`).join("")}</select></label>` : "";
    const all = waiting > 1 ? `<button class="btn small${R.armed === "all" ? " rv-armed" : ""}" type="button" data-act="${p.git && !p.noBranch ? "keepall" : "markall"}"${R.busy ? " disabled" : ""}>${R.armed === "all" ? (p.git && !p.noBranch ? `Click again to keep all ${waiting}` : `Click again to mark all ${waiting}`) : p.git && !p.noBranch ? "Keep all" : "Mark all reviewed"}</button>` : "";
    let note = "";
    if (p.exists === false) note = `<p class="rv-note warn">The project folder ${esc(p.dir)} isn't there any more.</p>`;
    else if (!p.git) note = `<p class="rv-note warn">This project isn't a git repo, so its changes (for example live edits in Roblox Studio) can't be undone from here. Check the project's ledger in Studio; each round's notes below say what it changed and how to undo it.</p>`;
    else if (p.noBranch) note = `<p class="rv-note">No teamwright/autowork branch yet, so there are no commits to keep. Rounds below may have changed things outside git.</p>`;
    else note = `<p class="rv-note">Keep copies a round's commits onto <b>${esc(p.base)}</b> (it refuses if ${esc(p.base)} has uncommitted changes or the commits conflict, and then changes nothing). Discard adds a commit on teamwright/autowork that undoes the round; nothing is ever deleted from history.</p>`;
    if (p.busy) note += `<p class="rv-note warn">A Working round is running on this project; Keep and Discard wait until it finishes.</p>`;
    if (p.error) note += `<p class="rv-err">${esc(p.error)}</p>`;
    const msg = R.msg ? `<p class="rv-msg ${R.msg.bad ? "bad" : "ok"}" role="status">${esc(R.msg.text)}</p>` : "";
    const body = rounds.length ? rounds.map((r) => roundHTML(p, r)).join("") : `<p class="rv-empty">All caught up: nothing from Working is waiting for review on ${esc(p.name)}.</p>`;
    return `<div class="rv-head"><h2 class="sec">Review</h2>${waiting ? `<span class="chip rv-count">${waiting} waiting</span>` : ""}${projSel}${baseSel}<span class="spacer"></span>${all}</div>${note}${msg}<div class="rv-list">${body}</div>`;
  }

  /* ---------- mount and draw ---------- */
  function mount() {
    if (R.sec && R.sec.isConnected) return true;
    const page = document.querySelector("#workingRoot .ap-page");
    if (!page) return false;
    R.sec = document.createElement("section");
    R.sec.className = "stack rv-sec";
    R.sec.setAttribute("aria-label", "Review what Working did");
    page.insertBefore(R.sec, page.querySelector(".ap-next-sec") || page.querySelector(".ap-feed") && page.querySelector(".ap-feed").parentElement || null);
    R.sec.addEventListener("click", onClick);
    R.sec.addEventListener("change", onChange);
    R.sec.addEventListener("toggle", onToggle, true);
    R.sig = "";
    return true;
  }
  function draw() {
    if (!mount()) return;
    const html = sectionHTML();
    if (html === R.sig) return; // unchanged: keep focus and scroll inside open diffs
    R.sig = html;
    R.sec.innerHTML = html;
  }
  const visible = () => { const v = $("v-working"); return !!v && !v.hidden; };

  /* ---------- server ---------- */
  async function load() {
    R.loading = true;
    let d = null;
    try { d = await api("/api/review"); } catch {}
    R.loading = false;
    if (d && !d.error) { R.data = d; setBadge(Number(d.count) || 0); }
    if (visible()) draw();
  }
  async function loadDiff(p, r) {
    const key = r.id + sigOf(r);
    if (R.diffs.has(key)) return;
    R.diffs.set(key, `<p class="rv-note">Loading…</p>`);
    let d = null;
    try { d = await api(`/api/review/${encodeURIComponent(p.slug)}/diff/${encodeURIComponent(r.id)}`); } catch {}
    const bad = !d || d.error;
    R.diffs.set(key, bad ? `<p class="rv-err">${esc((d && d.error) || "Can't load the changes.")}</p>` : diffHTML(d.diff || "", d.cut));
    draw();
    if (bad) setTimeout(() => R.diffs.delete(key), 5000); // let a later open try again
  }
  function diffHTML(text, cut) {
    if (!text.trim()) return `<p class="rv-note">No text changes.</p>`;
    const lines = text.split("\n").map((l) => {
      const cls = /^commit [0-9a-f]+ /.test(l) ? "c" : /^diff --git /.test(l) ? "h" : /^(\+\+\+|---|index |new file|deleted file|similarity|rename |Binary files)/.test(l) ? "k" : /^@@/.test(l) ? "k" : l[0] === "+" ? "a" : l[0] === "-" ? "d" : "";
      const t = cls === "h" ? l.replace(/^diff --git a\/(.+?) b\/.+$/, "$1") : l;
      return `<span${cls ? ` class="${cls}"` : ""}>${esc(t) || " "}</span>`;
    }).join("");
    return `<pre class="rv-diff">${lines}</pre>${cut ? `<p class="rv-note">Parts of this diff were too big to show.</p>` : ""}`;
  }
  async function post(slug, act, body) {
    let r;
    try { r = await api(`/api/review/${encodeURIComponent(slug)}/${act}`, { method: "POST", body: JSON.stringify(body || {}) }); }
    catch { r = { error: "Can't reach The Wise Hive right now." }; }
    return r || { error: "No answer from The Wise Hive." };
  }
  const cur = () => R.data && arr(R.data.projects).find((x) => x.slug === R.sel);
  function arm(key) {
    clearTimeout(R.armTimer);
    if (R.armed === key) { R.armed = null; return true; }
    R.armed = key;
    R.armTimer = setTimeout(() => { R.armed = null; draw(); }, 4000);
    draw();
    return false;
  }
  async function run(act, id) {
    const p = cur();
    if (!p || R.busy) return;
    R.busy = id || "all"; R.msg = null; delete R.errs[id]; draw();
    const r = await post(p.slug, act, act === "keepall" ? {} : { round: id });
    R.busy = null;
    if (r.error) { if (id) R.errs[id] = r.error; else R.msg = { bad: true, text: r.error }; }
    else { R.msg = { text: r.message || "Done." }; toast("Review", r.message || "Done."); }
    await load();
  }
  function onClick(e) {
    const b = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
    if (!b || b.disabled) return;
    const a = b.dataset.act, id = b.dataset.id;
    // "open" (Open chat) is handled by autopilot-client.js for the whole Working view; handling it here too opened it twice.
    if (a === "keep") return run("keep", id);
    if (a === "mark") return run("mark", id);
    if (a === "discard") { if (arm("discard:" + id)) run("discard", id); return; }
    if (a === "keepall" || a === "markall") {
      if (!arm("all")) return;
      if (a === "keepall") return run("keepall");
      // Not git: mark each round in turn.
      const p = cur();
      (async () => { for (const r of arr(p && p.rounds).filter((x) => !x.running)) { R.busy = "all"; draw(); const x = await post(p.slug, "mark", { round: r.id }); if (x.error) { R.msg = { bad: true, text: x.error }; break; } } R.busy = null; await load(); })();
    }
  }
  async function onChange(e) {
    const s = e.target;
    if (!s || !s.dataset) return;
    if (s.dataset.set === "proj") { R.sel = s.value; R.msg = null; R.errs = {}; draw(); }
    if (s.dataset.set === "base") {
      const p = cur(); if (!p) return;
      const r = await post(p.slug, "base", { branch: s.value });
      if (r.error) R.msg = { bad: true, text: r.error };
      await load();
    }
  }
  function onToggle(e) {
    const d = e.target;
    if (!d || d.tagName !== "DETAILS" || !d.dataset.k) return;
    // A redraw re-creates open <details>, which fire toggle too: only a real change may force the next rebuild.
    const same = d.open === R.open.has(d.dataset.k);
    if (d.open) R.open.add(d.dataset.k); else R.open.delete(d.dataset.k);
    if (d.open && d.dataset.k.startsWith("diff:")) {   // loadDiff returns at once for a diff it already has
      const p = cur(), r = p && arr(p.rounds).find((x) => "diff:" + x.id === d.dataset.k);
      if (r) loadDiff(p, { ...r, commits: arr(r.commits) });
    }
    if (!same) R.sig = ""; // the open state is part of the markup now
  }

  /* ---------- lifecycle ---------- */
  let poll = 0;
  window.addEventListener("hive:view", (e) => {
    const on = e.detail && e.detail.view === "working";
    clearInterval(poll); poll = 0;
    if (!on) { R.armed = null; return; }
    // autopilot-client builds the Working view on this same event; draw once it exists.
    setTimeout(() => { draw(); load(); }, 0);
    poll = setInterval(load, 30000);
  });
  window.addEventListener("hive:server", (e) => {
    const ev = e.detail || {};
    if (ev.t === "review" || ev.t === "hello" || (ev.t === "autopilot" && ev.mode === "working" && ev.state && ev.state.last && ["result", "error", "note"].includes(ev.state.last.type))) {
      clearTimeout(R.deb); R.deb = setTimeout(load, 1500);
    }
  });
  setInterval(() => { if (!visible()) load(); }, 5 * 60e3); // keeps the tab badge right while elsewhere
  load();

  window.HiveReview = { load, draw, diffHTML, state: R };
})();
