/* Round cards: the page side of rounds.js. A "What it did" section in the Working view, right under the current-round
   card (added without touching autopilot-client.js's markup), with one card per Working round, newest first: title, when,
   a plain-English summary, what changed, how to undo it (with its commits and "Review it"), pictures (click to enlarge,
   in the chat media lightbox) and Open chat. Its own clicks use rc- actions only; "Open chat" is data-act="open", which
   autopilot-client.js handles for the whole Working view, so a chat opens once.
   window.HiveRounds = { load, show(n, slug) }: the Log's "Round card" link calls show(). */
(function () {
  "use strict";
  const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
  const style = document.createElement("style");
  style.textContent = `
.rc-sec{gap:10px}
.rc-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.rc-head h2.sec{margin:0}
.rc-head label{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;color:var(--muted)}
.rc-head select{padding:4px 9px;font-size:12.5px;border-radius:10px;background:var(--raised);max-width:220px}
.rc-list{display:flex;flex-direction:column;gap:12px}
.rc-card{display:grid;grid-template-columns:minmax(0,300px) minmax(0,1fr);gap:14px;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:12px 14px;min-width:0;transition:box-shadow .3s}
.rc-card.noimg{grid-template-columns:minmax(0,1fr)}
.rc-card.running{border-color:color-mix(in srgb,var(--claude) 45%,var(--line))}
.rc-card.flash{box-shadow:0 0 0 4px var(--claude-glow)}
.rc-shots{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;align-content:start}
.rc-shot{position:relative;padding:0;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--sunk);aspect-ratio:16/10;cursor:zoom-in;min-width:0}
.rc-shot:hover,.rc-shot:focus-visible{border-color:var(--claude);box-shadow:0 0 0 3px var(--claude-glow);outline:none}
.rc-shot.hero{grid-column:1/-1}
.rc-shot img{width:100%;height:100%;object-fit:cover;display:block}
.rc-tag{position:absolute;left:6px;top:6px;font:700 10px var(--f-body);text-transform:uppercase;letter-spacing:.08em;padding:1px 6px;border-radius:4px;background:rgba(12,14,17,.82);color:var(--muted)}
.rc-tag.after{color:var(--ok)}
.rc-more{position:absolute;inset:0;display:grid;place-items:center;background:rgba(12,14,17,.6);font:700 14px var(--f-display);color:var(--ink)}
.rc-body{display:flex;flex-direction:column;gap:6px;min-width:0}
.rc-top{display:flex;align-items:center;gap:6px 8px;flex-wrap:wrap;font-size:12.5px;color:var(--muted)}
.rc-top .chip{font-size:11.5px;padding:1px 9px}
.rc-run{color:var(--claude);border-color:color-mix(in srgb,var(--claude) 40%,var(--line))}
.rc-title{font:600 16px/1.3 var(--f-display);margin:0;overflow-wrap:anywhere}
.rc-sum{font-size:13.5px;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.rc-sum.open{display:block}
.rc-sum p{margin:2px 0}
.rc-note{margin:0;font-size:13px;color:var(--muted)}
.rc-ch{margin:0;padding-left:18px;font-size:13px;color:var(--muted)}
.rc-ch li{overflow-wrap:anywhere}
.rc-k{font:700 11px var(--f-body);text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-top:2px}
.rc-card details>summary{cursor:pointer;color:var(--muted);font-weight:700;font-size:12.5px}
.rc-undo{font-size:13px;overflow-wrap:anywhere;margin-top:4px}
.rc-undo p{margin:2px 0}
.rc-commits{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;align-items:center}
.rc-commit{font:12px var(--f-mono);color:var(--muted);background:var(--sunk);border:1px solid var(--line);border-radius:6px;padding:1px 7px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rc-commit b{color:var(--gold);font-weight:400;margin-right:6px}
.rc-empty{display:flex;align-items:center;gap:10px;margin:0;font-size:13px;color:var(--muted)}
.rc-empty .rc-m{width:40px;flex:none}
.rc-foot{display:flex;justify-content:center}
@media (max-width:860px){.rc-card{grid-template-columns:minmax(0,1fr)}.rc-shots{max-width:420px}}
`;
  document.head.appendChild(style);

  const RC = { data: null, pick: null, before: null, limit: 3, sig: "", sec: null, deb: 0, poll: 0, open: new Set(), seq: 0, err: false, flash: 0, measured: false };
  const arr = (v) => (Array.isArray(v) ? v : []);
  const visible = () => { const v = $("v-working"); return !!v && !v.hidden; };
  const TOOL = { mcp__blender__look: "Blender", mcp__roblox_studio__screen_capture: "Roblox Studio", mcp__roblox_studio__capture_plugin_gui: "Roblox Studio plugin", saved: "saved by the worker" };
  const toolName = (t) => TOOL[String(t || "").toLowerCase()] || "a tool";
  const OUT = { failed: "didn't finish", stopped: "stopped", capped: "paused at the usage cap", skipped: "skipped", interrupted: "interrupted" };
  const clockOf = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""; };
  function dur(ms) {
    if (!(ms > 0)) return "";
    const m = Math.round(ms / 60000);
    return m < 1 ? "under a minute" : m < 60 ? m + " min" : Math.floor(m / 60) + " h " + String(m % 60).padStart(2, "0") + " min";
  }
  const picId = (slug, n, i) => `rc-${slug}-${n}-${i}`;
  function pictures(r) {
    return arr(r.images).map((im, i) => ({ url: im.url, id: picId(r.slug, r.n, i),
      name: [`Round ${r.n}`, toolName(im.tool), im.phase, clockOf(im.at), im.caption].filter(Boolean).join(" · ") }));
  }

  /* ---------- markup ---------- */
  function shotHTML(r, im, i, cls, more) {
    const tag = im.phase === "before" ? `<span class="rc-tag">Before</span>` : im.phase === "after" ? `<span class="rc-tag after">After</span>` : "";
    const alt = `Round ${r.n} picture from ${toolName(im.tool)}${im.phase ? ` (${im.phase})` : ""}${im.caption ? ": " + im.caption : ""}`;
    return `<button class="rc-shot${cls}" type="button" data-act="rc-zoom" data-n="${esc(r.n)}" data-i="${i}" data-mi="${esc(picId(r.slug, r.n, i))}" title="${esc(im.caption || "Click to enlarge")}">`
      + `<img src="${esc(im.url)}" alt="${esc(alt)}" loading="lazy" decoding="async">${tag}${more ? `<span class="rc-more">+${more}</span>` : ""}</button>`;
  }
  function shotsHTML(r) {
    const ims = arr(r.images);
    if (!ims.length) return "";
    const hero = ims[r.hero] ? r.hero : ims.length - 1;
    const rest = ims.map((im, i) => i).filter((i) => i !== hero);
    const thumbs = rest.slice(0, 3).map((i, k) => shotHTML(r, ims[i], i, "", k === 2 && rest.length > 3 ? rest.length - 2 : 0)).join("");
    return `<div class="rc-shots">${shotHTML(r, ims[hero], hero, " hero", 0)}${thumbs}</div>`;
  }
  function reviewable(r) {
    const d = window.HiveReview && HiveReview.state && HiveReview.state.data;
    const p = d && arr(d.projects).find((x) => x.slug === r.slug);
    return !!(p && arr(p.rounds).some((x) => x.id === "r" + r.n));
  }
  function cardHTML(r) {
    const ims = arr(r.images), key = r.slug + "/" + r.n;
    const outcome = r.running ? `<span class="chip rc-run">in progress</span>` : OUT[r.outcome] ? `<span class="chip">${esc(OUT[r.outcome])}</span>` : "";
    const when = r.startedAt ? `<span class="ap-t" data-rc-at="${esc(r.startedAt)}" title="${esc(new Date(r.startedAt).toLocaleString())}"></span>` : "";
    const open = r.chatId ? `<button class="linkish ap-open" type="button" data-act="open" data-chat="${esc(r.chatId)}">Open chat</button>` : "";
    let sum;
    if (r.running) sum = `<p class="rc-note">${ims.length ? "Pictures so far. " : ""}The summary appears when the round ends.</p>`;
    else if (r.summary) {
      const long = r.summary.length > 260 || r.summary.split("\n").length > 4, on = RC.open.has("sum:" + key);
      sum = `<div class="md rc-sum${on ? " open" : ""}">${md(r.summary)}</div>${long ? `<button class="linkish" type="button" data-act="rc-sum" data-k="${esc(key)}">${on ? "less" : "more"}</button>` : ""}`;
    } else sum = `<p class="rc-note">${esc(r.outcomeText || "No summary.")} Open the chat to see what it did.</p>`;
    const ch = arr(r.changed), allCh = RC.open.has("ch:" + key);
    const changed = ch.length ? `<div class="rc-k">What changed</div><ul class="rc-ch">${(allCh ? ch : ch.slice(0, 5)).map((c) => `<li>${esc(String(c).replace(/[`*]+/g, ""))}</li>`).join("")}</ul>`
      + (ch.length > 5 ? `<button class="linkish" type="button" data-act="rc-changed" data-k="${esc(key)}">${allCh ? "fewer" : `+${ch.length - 5} more`}</button>` : "") : "";
    const commits = arr(r.commits).map((c) => `<span class="rc-commit" title="${esc(c.subject)}"><b>${esc(c.short)}</b>${esc(c.subject)}</span>`).join("");
    const rv = reviewable(r) ? `<button class="btn small" type="button" data-act="rc-review" data-n="${esc(r.n)}">Review it</button>` : "";
    const undo = r.undo || commits || rv ? `<details data-k="undo:${esc(key)}"${RC.open.has("undo:" + key) ? " open" : ""}><summary>How to undo it</summary>`
      + `${r.undo ? `<div class="md rc-undo">${md(r.undo)}</div>` : ""}${commits || rv ? `<div class="rc-commits">${commits}${rv}</div>` : ""}</details>` : "";
    const trimmed = r.imagesTrimmed && !ims.length ? `<p class="rc-note">Older pictures were cleared to save space.</p>` : "";
    // The round's own critic (when the Taste switch is on): its last score and must-fix issues, from the report.
    const crit = arr(r.critique).length ? `<div class="rc-k">Claude's critic</div><ul class="rc-ch">${r.critique.map((c) => `<li>${esc(String(c).replace(/[\`*]+/g, ""))}</li>`).join("")}</ul>` : "";
    // Taste: send this round's pictures to the user's queue; a chip opens what is already there.
    const inTaste = window.HiveTaste && HiveTaste.forRound ? HiveTaste.forRound(r.slug, r.n) : [];
    const taste = (inTaste.length ? `<button class="linkish" type="button" data-act="rc-intaste" data-n="${esc(r.n)}" title="Open it in the Taste tab">In Taste${inTaste.length > 1 ? ` (${inTaste.length})` : ""}</button>` : "")
      + (!r.running && ims.length && window.HiveTaste ? `<button class="btn small" type="button" data-act="rc-taste" data-n="${esc(r.n)}" title="Put this round's pictures in your Taste queue to approve, deny or comment on">Send to Taste</button>` : "");
    return `<article class="rc-card${ims.length ? "" : " noimg"}${r.running ? " running" : ""}" data-n="${esc(r.n)}" title="${esc(r.project && r.project.dir || "")}">${shotsHTML(r)}`
      + `<div class="rc-body"><div class="rc-top"><span class="ap-kicker">Round ${esc(r.n)}</span>${r.focus ? `<span class="chip ap-focus">${esc(r.focus)}</span>` : ""}${outcome}${when}`
      + `${r.ms ? `<span>${esc(dur(r.ms))}</span>` : ""}<span class="spacer"></span>${taste}${open}</div>`
      + `<h3 class="rc-title">${esc(r.title || "Round " + r.n)}</h3>${sum}${changed}${crit}${undo}${trimmed}</div></article>`;
  }
  function sectionHTML() {
    const d = RC.data;
    if (!d) return `<div class="rc-head"><h2 class="sec">What it did</h2></div><p class="rc-note">${RC.err ? "Couldn't load the round cards." : "Loading round cards…"}</p>`;
    const ps = arr(d.projects), p = ps.find((x) => x.slug === d.slug);
    const sel = ps.length > 1 ? `<label>Project <select data-set="rc-proj">${ps.map((x) => `<option value="${esc(x.slug)}"${x.slug === d.slug ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>` : "";
    const count = p ? `<span class="chip">${p.count} round${p.count === 1 ? "" : "s"}</span>` : "";
    const newest = RC.before ? `<button class="btn small" type="button" data-act="rc-newest">Newest rounds</button>` : "";
    const rounds = arr(d.rounds).map((r) => ({ ...r, slug: d.slug }));
    const body = rounds.length ? `<div class="rc-list">${rounds.map(cardHTML).join("")}</div>`
      : `<p class="rc-empty"><span class="rc-m">${mascot("foreman", "Foreman")}</span>Round cards show up here after each round: what changed, pictures, and how to undo it.</p>`;
    const older = d.more ? `<div class="rc-foot"><button class="btn small" type="button" data-act="rc-older">Show older rounds</button></div>` : "";
    return `<div class="rc-head"><h2 class="sec">What it did</h2>${count}<span class="spacer"></span>${sel}${newest}</div>${body}${older}`;
  }

  /* ---------- mount and draw ---------- */
  function mount() {
    if (RC.sec && RC.sec.isConnected) return true;
    const slot = document.querySelector("#workingRoot .ap-cur-slot");
    if (!slot) return false;
    RC.sec = document.createElement("section");
    RC.sec.className = "stack rc-sec";
    RC.sec.setAttribute("aria-label", "Round cards: what Working did");
    slot.after(RC.sec); // review-client inserts before "Up next", so the order is the same whichever mounts first
    RC.sec.addEventListener("click", onClick);
    RC.sec.addEventListener("change", (e) => {
      const s = e.target;
      if (s && s.dataset && s.dataset.set === "rc-proj" && SLUG.test(s.value)) { RC.pick = s.value; RC.before = null; RC.limit = 3; load(); }
    });
    RC.sec.addEventListener("toggle", (e) => {
      const d = e.target;
      if (!d || d.tagName !== "DETAILS" || !d.dataset.k) return;
      // Re-drawn <details open> fire "toggle" too: only a real change of the open state may force the next rebuild,
      // or an open "How to undo it" would make every load rebuild the cards (and lose the scroll position).
      if (d.open === RC.open.has(d.dataset.k)) return;
      if (d.open) RC.open.add(d.dataset.k); else RC.open.delete(d.dataset.k);
      RC.sig = ""; // the open state is part of the markup now
    }, true);
    RC.sig = "";
    return true;
  }
  function draw() {
    if (!mount()) return;
    const html = sectionHTML();
    // Unchanged: keep focus, open details, an open project picker and loaded pictures. The "5 min ago" times aren't in
    // the markup, so they don't count as a change; stamp() updates them in place.
    if (html !== RC.sig) {
      RC.sig = html;
      RC.sec.innerHTML = html;
      RC.measured = false;
    }
    // Cards drawn while Working was hidden have no layout yet: they're measured once the view shows.
    if (!RC.measured && visible()) { clamp(); RC.measured = true; }
    stamp();
  }
  // "more" only where the 4-line clamp really cuts the summary off.
  function clamp() {
    for (const s of RC.sec.querySelectorAll(".rc-sum:not(.open)")) {
      const b = s.nextElementSibling;
      if (b && b.dataset.act === "rc-sum" && s.clientHeight && s.scrollHeight <= s.clientHeight + 2) b.hidden = true;
    }
  }
  function stamp() {
    if (!RC.sec) return;
    for (const x of RC.sec.querySelectorAll("[data-rc-at]")) { const t = ago(x.dataset.rcAt); if (x.textContent !== t) x.textContent = t; }
  }
  async function load() {
    const q = "/api/autopilot/working/rounds?limit=" + RC.limit + (RC.pick ? "&project=" + encodeURIComponent(RC.pick) : "") + (RC.before ? "&before=" + RC.before : "");
    const my = ++RC.seq;
    let d = null;
    try { d = await api(q); } catch {}
    if (my !== RC.seq) return; // a newer load answered first
    if (d && !d.error && Array.isArray(d.rounds)) { RC.data = d; RC.err = false; } else RC.err = true;
    draw();
  }
  const roundOf = (n) => RC.data && arr(RC.data.rounds).find((r) => String(r.n) === String(n));

  function onClick(e) {
    const b = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
    if (!b || b.disabled || !RC.sec.contains(b)) return;
    const a = b.dataset.act;
    if (a === "rc-zoom") {
      const r = roundOf(b.dataset.n);
      if (!r) return;
      const list = pictures({ ...r, slug: RC.data.slug });
      if (window.HiveMedia && HiveMedia.open) HiveMedia.open(list, Number(b.dataset.i) || 0);
      else if (list[Number(b.dataset.i) || 0]) window.open(list[Number(b.dataset.i) || 0].url, "_blank");
    } else if (a === "rc-taste" || a === "rc-intaste") {
      const r = roundOf(b.dataset.n);
      if (!r || !window.HiveTaste) return;
      if (a === "rc-taste") HiveTaste.fromRound({ ...r, slug: RC.data.slug });
      else { const ids = HiveTaste.forRound(RC.data.slug, r.n); if (ids.length && typeof window.show === "function") { window.show("taste"); setTimeout(() => HiveTaste.open(ids[ids.length - 1]), 400); } }
    } else if (a === "rc-sum" || a === "rc-changed") {
      const k = (a === "rc-sum" ? "sum:" : "ch:") + b.dataset.k;
      if (RC.open.has(k)) RC.open.delete(k); else RC.open.add(k);
      draw();
    } else if (a === "rc-older") {
      const rs = arr(RC.data && RC.data.rounds);
      if (RC.limit < 30) RC.limit = Math.min(30, RC.limit + 6);
      else if (rs.length) { RC.before = rs[rs.length - 1].n; RC.limit = 6; }
      load();
    } else if (a === "rc-newest") { RC.before = null; RC.limit = 3; load(); }
    else if (a === "rc-review") {
      const R = window.HiveReview, slug = RC.data && RC.data.slug;
      if (!R || !slug) return;
      R.state.sel = slug; R.draw();
      const el = document.querySelector(`#workingRoot .rv-round[data-round="r${Number(b.dataset.n)}"]`);
      if (el) { el.scrollIntoView({ block: "center", behavior: "smooth" }); flash(el); }
    }
    // "open" (Open chat) is left to autopilot-client.js, which handles it for the whole Working view.
  }
  function flash(el) {
    el.classList.add("flash");
    if (!el.classList.contains("rc-card")) { el.style.boxShadow = "0 0 0 4px var(--claude-glow)"; setTimeout(() => { el.style.boxShadow = ""; }, 1600); return; }
    clearTimeout(RC.flash); RC.flash = setTimeout(() => el.classList.remove("flash"), 1600);
  }
  // From the Log's "Round card" link: switch project if needed, page to the round, scroll to it and flash it.
  async function show(n, slug) {
    n = Number(n);
    if (!Number.isInteger(n) || n < 1) return;
    if (!RC.sec || !RC.sec.isConnected) draw();
    const want = typeof slug === "string" && SLUG.test(slug) ? slug : null;
    const here = () => RC.data && (!want || RC.data.slug === want) && RC.sec && RC.sec.querySelector(`.rc-card[data-n="${n}"]`);
    if (!here()) {
      if (want) RC.pick = want;
      RC.before = n + 1; RC.limit = 3;
      await load();
    }
    const el = here();
    if (el) { el.scrollIntoView({ block: "center", behavior: "smooth" }); flash(el); }
    else toast("Round card", "That round has no card.");
  }

  /* ---------- lifecycle ---------- */
  window.addEventListener("hive:taste-index", () => { if (RC.sec && RC.sec.isConnected) draw(); });
  window.addEventListener("hive:view", (e) => {
    const on = e.detail && e.detail.view === "working";
    clearInterval(RC.poll); RC.poll = 0;
    if (!on) return;
    // autopilot-client builds the Working view on this same event; draw once it exists.
    setTimeout(() => { draw(); load(); }, 0);
    RC.poll = setInterval(() => { if (visible()) load(); }, 30000);
  });
  window.addEventListener("hive:server", (e) => {
    const ev = e.detail || {};
    const mine = (ev.t === "rounds" && (!RC.data || !RC.data.slug || ev.slug === RC.data.slug))
      || (ev.t === "autopilot" && ev.mode === "working" && ev.state && ev.state.last && ["start", "result", "error", "note"].includes(ev.state.last.type))
      || ev.t === "hello";
    if (!mine) return;
    if (!visible()) return; // loaded on the next visit to Working
    clearTimeout(RC.deb); RC.deb = setTimeout(load, 300);
  });
  if (visible()) setTimeout(() => { draw(); load(); }, 0);

  window.HiveRounds = { load, show, state: RC };
})();
