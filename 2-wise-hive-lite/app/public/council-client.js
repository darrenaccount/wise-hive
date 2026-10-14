/* Council view: the seat bar (who sits at the NEXT council: add, remove, swap; remembered on the server in
   <brain>\app-settings\council.json), the debate on screen (after a verdict: Swap a seat or Hear one more seat, 2 runs
   each, through POST /api/council/more), the Judge, and the courtroom. The roster comes from
   GET /api/council/seats (app/council-seats.json); until it answers (or if it can't) the classic three are used.
   Every seat is one more Claude run, so the classic three stay the default and other seats sit only when chosen.
   Uses the page's globals: $, esc, md, mascot, KIT, R, C, H, api, readStream, setBusy, toast, SCENE, mountScene,
   AGENT, BRAIN_DIR. Moved out of index.html and given seats on 2026-10-13. */
(function () {
  "use strict";
  // 1. Mascots for the new seats. The art keeps clear of the eye cells (SVG x 4-6 and 9-11, y 5-8), which the courtroom
  //    repaints to move the eyes: hats at y <= 4, held items at x >= 14, mouths and beards at y >= 9.
  if (typeof KIT === "object" && typeof R === "function") {
    const A = {
      player: R(4, 2, 8, 2, "#58c4dd") + R(1, 3, 3, 1, "#58c4dd") + R(14, 7, 5, 3, "#3b3f46") + R(15, 8, 1, 1, "#e2557a") + R(17, 8, 1, 1, "#5cc28a") + R(7, 9, 2, 1, C.eye),
      economist: R(3, 3, 10, 1, "#3fa06b") + R(2, 4, 12, 1, "#2f7d55") + R(15, 6, 3, 1, "#fde68a") + R(15, 7, 3, 1, C.gold) + R(15, 8, 3, 1, "#fde68a") + R(15, 9, 3, 1, C.gold),
      bootstrapper: R(2, 4, 12, 1, C.orange) + R(13, 3, 2, 1, C.orange) + R(14, 2, 1, 1, C.orange) + R(15, 1, 3, 1, C.brown) + R(15, 2, 3, 1, "#fde68a") + R(16, 3, 1, 1, "#fde68a") + R(15, 4, 3, 1, C.gold) + R(15, 5, 3, 1, C.brown),
      engineer: R(2, 4, 12, 1, C.black) + R(4, 3, 3, 2, C.lens) + R(9, 3, 3, 2, C.lens) + R(16, 3, 1, 6, C.grey) + R(15, 1, 1, 2, C.grey) + R(17, 1, 1, 2, C.grey),
      competitor: R(2, 4, 12, 1, "#d64545") + R(1, 3, 2, 2, "#d64545") + R(15, 2, 4, 3, C.gold) + R(14, 2, 1, 2, C.gold) + R(19, 2, 1, 2, C.gold) + R(16, 5, 2, 1, C.gold) + R(15, 6, 4, 1, C.brown) + R(7, 9, 3, 1, C.eye),
      future: R(3, 3, 10, 1, C.white) + R(2, 4, 2, 2, C.white) + R(12, 4, 2, 2, C.white) + R(4, 9, 8, 2, C.white) + R(16, 4, 1, 1, C.gold) + R(15, 5, 3, 3, C.gold) + R(16, 6, 1, 1, C.paper),
      moderator: R(4, 2, 8, 2, C.navy) + R(3, 3, 10, 1, C.navy) + R(7, 2, 2, 1, C.gold) + R(15, 4, 3, 4, "#2aa79b") + R(16, 8, 1, 1, "#2aa79b") + R(16, 5, 1, 2, C.white),
      marketer: R(7, 0, 1, 3, C.gold) + R(6, 1, 3, 1, C.gold) + R(14, 6, 1, 2, "#3b3f46") + R(15, 5, 1, 4, "#ff8fc7") + R(16, 4, 1, 6, "#ff8fc7") + R(17, 3, 1, 8, "#ff8fc7") + R(19, 4, 1, 1, C.white) + R(19, 6, 1, 1, C.white) + R(19, 8, 1, 1, C.white),
      artist: R(4, 2, 7, 2, C.purple) + R(3, 3, 1, 1, C.purple) + R(8, 1, 1, 1, C.purple) + R(14, 7, 5, 3, "#e0c9a6") + R(15, 8, 1, 1, C.red) + R(17, 7, 1, 1, C.blue) + R(17, 9, 1, 1, C.green) + R(18, 3, 1, 4, C.brown) + R(18, 2, 1, 1, C.red),
      remixer: R(3, 2, 10, 1, C.black) + R(2, 3, 1, 2, C.black) + R(13, 3, 1, 2, C.black) + R(1, 5, 2, 3, "#a3e635") + R(13, 5, 2, 3, "#a3e635") + R(15, 1, 3, 1, "#a3e635") + R(17, 0, 1, 1, "#a3e635") + R(17, 2, 1, 1, "#a3e635") + R(15, 2, 1, 2, "#a3e635"),
    };
    for (const k in A) if (!KIT[k]) KIT[k] = { front: A[k] };
  }

  // 2. Styles (cs- prefix).
  const css = document.createElement("style");
  css.textContent = `
  .cs-wrap{display:flex;flex-direction:column;gap:6px}
  .cs-bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
  .cs-label{font:700 10px var(--f-body);text-transform:uppercase;letter-spacing:.09em;color:var(--muted);margin-right:2px}
  .cs-chip{display:inline-flex;align-items:center;border:1px solid color-mix(in srgb,var(--accent,#9097a3) 45%,var(--line));background:var(--raised);border-radius:999px;max-width:100%}
  .cs-chip button{background:none;border:none;color:var(--ink);cursor:pointer;font:600 13px var(--f-body);display:inline-flex;align-items:center;gap:6px;border-radius:999px}
  .cs-chip .cs-pick{padding:2px 6px 2px 5px;min-width:0}
  .cs-chip .cs-x{padding:2px 9px 2px 3px;color:var(--muted);font-size:15px;line-height:1}
  .cs-chip .cs-pick:hover:not(:disabled){color:var(--claude)}
  .cs-chip .cs-x:hover:not(:disabled){color:var(--bad)}
  .cs-chip button:disabled{cursor:default;opacity:.55}
  .cs-m{width:22px;flex:none;display:inline-block}
  .cs-add{border:1px dashed #3a3f48;background:none;border-radius:999px;padding:4px 12px;font:600 13px var(--f-body);color:var(--muted);cursor:pointer}
  .cs-add:hover:not(:disabled){color:var(--claude);border-color:var(--claude)}
  .cs-add:disabled{opacity:.45;cursor:default}
  .cs-reset{font-size:12px;margin-left:4px}
  .cs-meta{font-size:12px;color:var(--muted)}
  .cs-pop{position:fixed;z-index:70;max-height:min(420px,calc(100vh - 32px));overflow:auto;background:var(--raised);border:1px solid var(--line);border-radius:16px;padding:8px;box-shadow:0 16px 40px rgba(0,0,0,.5)}
  .cs-ptitle{font:700 14px var(--f-display);padding:4px 8px 2px}
  .cs-group{font:700 9.5px var(--f-body);text-transform:uppercase;letter-spacing:.09em;color:var(--muted);padding:10px 8px 3px}
  .cs-row{display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:none;border:1px solid transparent;border-radius:10px;padding:5px 8px;color:var(--ink);cursor:pointer;font:inherit}
  .cs-row:hover,.cs-row:focus-visible{background:var(--surface);border-color:var(--line);outline:none}
  .cs-rm{width:30px;flex:none}
  .cs-row b{display:block;font-size:13.5px}
  .cs-row small{display:block;color:var(--muted);font-size:12px;line-height:1.35}
  .cs-foot{font-size:12px;color:var(--muted);padding:8px 8px 2px;border-top:1px solid var(--line);margin-top:6px}
  .cs-act{font-size:12.5px}
  .cs-act:disabled{opacity:.5;cursor:default}
  .seat .who{flex-wrap:wrap;row-gap:4px}
  .cs-id{display:flex;align-items:center;gap:10px;min-width:0;flex:0 1 auto}
  .cs-art{width:52px;flex:none}
  .cs-name{min-width:0}
  .cs-name b,.cs-name small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .cs-name b{display:block}
  .seat .who .cs-act{color:var(--muted);font-weight:600;margin-left:auto}
  .seat .who .cs-act:hover{color:var(--claude)}
  .cs-after{min-height:0}
  .cs-cost{font-size:12px}
  .cs-err{color:var(--bad)}
  `;
  document.head.appendChild(css);

  // 3. State. CLASSIC is the built-in roster until the server answers (or if it can't be reached).
  const CLASSIC = [
    { id: "believer", name: "Believer", role: "The case for", blurb: "Makes the strongest case for the idea and who would buy it.", group: "classic", plate: "BELIEVER", accent: "#e2557a", icon: "heart", cheer: ["PURSUE"], lookY: true },
    { id: "skeptic", name: "Skeptic", role: "The attack", blurb: "Attacks the idea and finds what wasn't thought through.", group: "classic", plate: "SKEPTIC", accent: "#7aa2d6", icon: "?!", cheer: ["PASS"], lookY: false },
    { id: "investor", name: "Investor", role: "The upside", blurb: "Sizes the opportunity and where it could go.", group: "classic", plate: "INVESTOR", accent: "#e9b949", icon: "bars", cheer: ["PURSUE"], lookY: true },
  ];
  const JUDGE = { id: "judge", name: "Judge", role: "The verdict" };
  const COLS = [1, 1, 2, 3, 2, 3, 3, 4];   // card columns for 0-7 seats (one column under 860 px, from the page CSS)
  // 4 columns only when a card still fits the mascot (52 px) beside the longest name ("Bootstrapper", ~102 px at 17 px):
  // 4 cards of ~202 px + 3 gaps of 14 px. Narrower (e.g. the activity panel docked in a small window) it's 3 columns.
  const FOUR = 860;
  function setCols() {
    const g = $("seats"); if (!g) return;
    const c = COLS[g.querySelectorAll(".seat").length] || 3;
    g.style.setProperty("--cols", c === 4 && g.clientWidth < FOUR ? 3 : c);
  }
  if (typeof ResizeObserver === "function") new ResizeObserver(setCols).observe($("seats"));
  const ID = /^[a-z]{2,20}$/;
  const index = (list) => Object.assign(Object.create(null), Object.fromEntries(list.map((s) => [s.id, s])));
  let ROSTER = CLASSIC, BY = index(CLASSIC), GROUPS = { classic: "Classic" }, DEFAULT = CLASSIC.map((s) => s.id);
  let LIM = { min: 1, max: 3, lite: false }, online = false, dirty = false, rosterError = "";
  // seats: the seat bar (the next council). sitting: the seats of the debate on screen (null before the first one).
  // lastFile: the debate on screen's file name while the server still holds it (Swap and Hear need it).
  // gen: bumped each time the server accepts a council run, so a push-back that started before it can't overwrite the
  // new Judge's session or verdict when it ends. asking: the gen of the push-back to the Judge now streaming (null: none).
  let seats = DEFAULT.slice(), sitting = null, running = false, judgeId = null, lastFile = "", saveT = 0, asking = null, gen = 0;

  const seatsOf = (ids) => ids.map((id) => BY[id]).filter(Boolean);
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  function sceneSeats(list) {
    SCENE.council && SCENE.council.update({ seats: list });
    const c = $("sceneCouncil");
    if (c) c.setAttribute("aria-label", `The courtroom: ${list.map((s) => "the " + s.name).join(", ")} at their stands, the Judge at the bench above.`);
  }
  // Ids are [a-z] (checked on the server) and only used as DOM ids and data values; names, roles and blurbs go through esc().
  // In a narrow card the mascot keeps its 52 px, a long name ends in "…" (full text in the title), and the Swap link drops
  // to its own line, on the right, when it doesn't fit beside the name.
  const who = (s, swap) => `<div class="who"><div class="cs-id"><div id="art-${s.id}" class="cs-art">${mascot(s.id, esc(s.name))}</div><div class="cs-name" title="${esc(s.name)}: ${esc(s.role)}"><b>${esc(s.name)}</b><small>${esc(s.role)}</small></div></div><span class="spacer"></span><span id="badge-${s.id}"></span>`
    + (swap ? `<button class="linkish cs-act" type="button" data-swapnow="${s.id}" hidden title="Swap the ${esc(s.name)} in this debate for another seat (2 runs)">Swap</button>` : "") + `</div>`;
  const seatHTML = (s, swap = true) => who(s, swap) + `<div class="md muted" id="say-${s.id}">Waiting for an idea.</div>`;
  function drawCards(list, preview) {
    $("councilArt").innerHTML = mascot("judge");
    $("seats").innerHTML = list.map((s) => `<div class="card seat">${seatHTML(s)}</div>`).join("");
    setCols();
    if (preview) for (const s of list) { const el = $("say-" + s.id); if (el && s.blurb) el.textContent = s.blurb; }
    $("judgeSeat").innerHTML = seatHTML(JUDGE, false) + `<div id="judgeThread" class="stack"></div><div class="row" id="judgeAsk" hidden><input type="text" id="judgeQ" placeholder="Push back or ask the Judge" style="flex:1"><button class="btn primary" id="judgeSend" type="button">Ask</button></div>`
      + `<div class="row cs-after"><button class="linkish cs-act" id="councilHear" type="button" hidden>+ Hear one more seat</button><span class="spacer"></span><span class="cs-cost muted" id="councilCost"></span></div>`;
    $("judgeSend").onclick = askJudge; $("judgeQ").addEventListener("keydown", (e) => { if (e.key === "Enter") askJudge(); });
    $("councilHear").onclick = (e) => { if (pop && popFrom === e.currentTarget) closePicker(); else openPicker("hear", e.currentTarget); };
    renderNow();
  }
  // The debate's own actions: after a verdict, while nothing runs, while the server still holds that debate.
  function renderNow() {
    const on = !!lastFile && !running && !askingNow() && !!sitting;
    document.querySelectorAll("#seats [data-swapnow]").forEach((b) => (b.hidden = !on));
    const h = $("councilHear"); if (!h) return;
    h.hidden = !on; h.disabled = on && sitting.length >= LIM.max;
    h.title = h.disabled ? `The council is full (${LIM.max} seats). Swap a seat instead.` : "One more seat speaks on this idea, then the Judge rules again (2 runs).";
  }
  $("seats").addEventListener("click", (e) => {
    const b = e.target.closest("[data-swapnow]"); if (!b || running || askingNow()) return;
    if (pop && popFrom === b) closePicker(); else openPicker("swapNow", b, b.dataset.swapnow);
  });
  function setCost(text, err) { const c = $("councilCost"); if (c) { c.textContent = text; c.classList.toggle("cs-err", !!err); } }
  // Before the first debate the cards and stands show who will sit (with what each seat does).
  function preview() { const l = seatsOf(seats); drawCards(l, true); sceneSeats(l); }
  // Saved on the server a moment after the last change (a burst of edits saves once); a failed save is ignored.
  function save() {
    clearTimeout(saveT);
    if (online) saveT = setTimeout(() => api("/api/council/seats", { method: "POST", body: JSON.stringify({ seats }) }).catch(() => {}), 400);
  }
  // Every seat bar change goes through here. After a debate it never touches the cards or the courtroom.
  function setSeats(next) { seats = next; dirty = true; renderBar(); if (!sitting) preview(); save(); }

  function renderBar() {
    const el = $("councilSeatBar"); if (!el) return;
    const list = seatsOf(seats), n = list.length, full = n >= LIM.max, dis = running ? " disabled" : "";
    const chips = list.map((s) => `<span class="cs-chip" style="--accent:${esc(s.accent || "#9097a3")}"><button type="button" class="cs-pick" data-swap="${s.id}" title="Swap the ${esc(s.name)} for another seat"${dis}><span class="cs-m" aria-hidden="true">${mascot(s.id, "")}</span>${esc(s.name)}</button>`
      + (n > LIM.min ? `<button type="button" class="cs-x" data-remove="${s.id}" aria-label="Remove the ${esc(s.name)}" title="Remove the ${esc(s.name)}"${dis}>×</button>` : "") + `</span>`).join("");
    const add = `<button type="button" class="cs-add" id="csAdd" title="${full ? `${LIM.max} seats is the most the council holds` : "Add a seat: one more Claude run"}"${full || running ? " disabled" : ""}>+ Add seat</button>`;
    const reset = seats.join() === DEFAULT.join() ? "" : `<button type="button" class="linkish cs-reset" id="csReset"${dis}>Reset to the classic three</button>`;
    let meta = rosterError ? "Only the classic three are available: the seat list (app\\council-seats.json) has an error. See server.log."
      : `${plural(n, "seat")} + the Judge · ${plural(n + 1, "Claude run")}${LIM.lite ? ` · Lite: up to ${LIM.max} seats` : ""}`;
    if (!rosterError && sitting && seats.join() !== sitting.map((s) => s.id).join()) meta += " · Changes apply to the next council";
    el.innerHTML = `<div class="cs-bar"><span class="cs-label">Seats</span>${chips}${add}${reset}</div><div class="cs-meta">${esc(meta)}</div>`;
  }
  $("councilSeatBar").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b || b.disabled || running) return;
    if (pop && popFrom === b) { closePicker(); return; }   // the same trigger again closes its picker
    if (b.dataset.swap) openPicker("swap", b, b.dataset.swap);
    else if (b.dataset.remove) { const i = seats.indexOf(b.dataset.remove); setSeats(seats.filter((x) => x !== b.dataset.remove)); focusBar(`[data-swap="${seats[Math.min(i, seats.length - 1)]}"]`); }
    else if (b.id === "csAdd") openPicker("add", b);
    else if (b.id === "csReset") { setSeats(DEFAULT.slice()); focusBar("#csAdd"); }
  });
  // The bar is redrawn on every change, so focus moves to the matching new control (or + Add seat).
  function focusBar(sel) { const el = $("councilSeatBar"), t = el && (el.querySelector(sel) || el.querySelector("#csAdd:not(:disabled)") || el.querySelector(".cs-pick")); if (t) t.focus(); }

  // 4. The seat picker: one popover for all four uses. On the bar: add, swap. On the debate on screen (2 runs each, at
  //    once): hear (one more seat), swapNow. Each row is a single button.
  let pop = null, popFrom = null;
  const rowHTML = (s) => `<button type="button" class="cs-row" data-id="${s.id}"><span class="cs-rm" aria-hidden="true">${mascot(s.id, "")}</span><span><b>${esc(s.name)}</b><small>${esc(s.blurb || s.role)}</small></span></button>`;
  function openPicker(mode, anchor, target) {
    closePicker(false);
    const bar = mode === "add" || mode === "swap";
    const taken = new Set(bar ? seats : (sitting || []).map((x) => x.id)), tName = target && BY[target] ? BY[target].name : "";
    const title = { add: "Add a seat", swap: `Swap the ${tName} for…`, hear: "Hear one more seat on this idea · 2 runs", swapNow: `Swap the ${tName} in this debate for… · 2 runs` }[mode];
    const groups = Object.keys(GROUPS).map((g) => {
      const rows = ROSTER.filter((s) => s.group === g && !taken.has(s.id));
      return rows.length ? `<div class="cs-group">${esc(GROUPS[g])}</div>` + rows.map(rowHTML).join("") : "";
    }).join("");
    pop = document.createElement("div");
    pop.className = "cs-pop"; pop.setAttribute("role", "dialog"); pop.setAttribute("aria-label", title);
    pop.innerHTML = `<div class="cs-ptitle">${esc(title)}</div>${groups || `<p class="muted" style="padding:6px 8px;margin:0">Every seat is already at the council.</p>`}`
      + `<div class="cs-foot">${bar ? "Each seat is one more Claude run." : "The seat speaks on the idea on screen, then the Judge rules again. Your seat bar doesn't change."}</div>`;
    document.body.appendChild(pop);
    popFrom = anchor;
    place(anchor);
    pop.addEventListener("click", (e) => {
      const b = e.target.closest(".cs-row"); if (!b) return;
      const id = b.dataset.id;
      closePicker(false);
      if (mode === "add") { setSeats(seats.concat(id)); focusBar(`[data-swap="${id}"]`); }
      else if (mode === "swap") { setSeats(seats.map((x) => (x === target ? id : x))); focusBar(`[data-swap="${id}"]`); }
      else if (mode === "hear") now(id);
      else now(id, target);
    });
    pop.addEventListener("keydown", (e) => {
      const rows = [...pop.querySelectorAll(".cs-row")], i = rows.indexOf(document.activeElement);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); const n = rows[(i + (e.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length]; n && n.focus(); }
    });
    const first = pop.querySelector(".cs-row"); if (first) first.focus();
  }
  // Under its trigger (above when there's no room below), kept 16 px inside the window.
  function place(anchor) {
    const r = anchor.getBoundingClientRect(), m = 16, w = Math.min(380, innerWidth - 2 * m);
    pop.style.width = w + "px";
    const h = pop.offsetHeight;
    let top = r.bottom + 6;
    if (top + h > innerHeight - m && r.top - 6 - h >= m) top = r.top - 6 - h;
    pop.style.top = Math.max(m, Math.min(top, innerHeight - h - m)) + "px";
    pop.style.left = Math.max(m, Math.min(r.left, innerWidth - w - m)) + "px";
  }
  function closePicker(refocus = true) {
    if (!pop) return;
    pop.remove(); pop = null;
    const from = popFrom; popFrom = null;
    if (refocus && from && from.isConnected) from.focus();
  }
  document.addEventListener("keydown", (e) => { if (pop && e.key === "Escape") { e.preventDefault(); closePicker(); } });
  document.addEventListener("mousedown", (e) => { if (pop && !pop.contains(e.target) && !(popFrom && popFrom.contains(e.target))) closePicker(false); }, true);
  window.addEventListener("resize", () => closePicker(false));
  document.addEventListener("scroll", (e) => { if (pop && !(e.target instanceof Node && pop.contains(e.target))) closePicker(false); }, true);
  window.addEventListener("hive:view", () => closePicker(false));

  // 5. Running a council. The request is checked before anything on screen changes, so a refusal (400/404/500 JSON, or
  //    no server) leaves the debate on screen, its verdict and "Push back" as they were.
  async function post(url, payload) {
    try {
      const r = await fetch(url, { method: "POST", headers: H, body: JSON.stringify(payload) });
      if (r.ok && /^text\/event-stream/.test(r.headers.get("content-type") || "")) return { r };
      const j = await r.json().catch(() => null);
      if (r.status === 404) return { status: 404, error: "The council isn't available: that part of The Wise Hive didn't load. See server.log." };
      return { status: r.status, error: j && j.error ? String(j.error) : `The Wise Hive answered HTTP ${r.status}.` };
    } catch { return { status: 0, error: "The Wise Hive isn't answering." }; }
  }
  const SIGN_IN = "Claude Code isn't signed in. Run `claude` in a terminal and type `/login` once.";
  async function run(url, payload, opts) {
    running = true; closePicker(false); renderBar(); renderNow(); setBusy(1); $("convene").disabled = true;
    // "Push back" waits for this run's Judge to finish (its session id arrives at the Judge's start); settle() shows it again.
    const ja = $("judgeAsk"); if (ja) ja.hidden = true;
    const got = await post(url, payload);
    const settle = () => { running = false; setBusy(-1); $("convene").disabled = false; const a = $("judgeAsk"); if (a) a.hidden = !judgeId; renderBar(); renderNow(); };
    if (got.error) { opts.refused(got); settle(); return; }
    gen++; opts.accepted();                                   // only now does the screen change
    const acc = {}, finished = new Set(), sc = SCENE.council;
    let gavel = null, gavelDone = false, judgeFinal = null, runs = 0, cost = 0;
    const thinking = (s) => { const el = $("say-" + s.id); if (el) { el.textContent = "Thinking…"; el.classList.add("muted"); } const a = $("art-" + s.id); if (a) a.classList.add("working"); };
    const primeJudge = () => { $("say-judge").textContent = opts.judgeWait; $("say-judge").classList.add("muted"); $("badge-judge").innerHTML = ""; setCost(""); };
    // The Judge's answer waits for the gavel: BAM, then the verdict.
    const showJudge = () => { const el = $("say-judge"); el.classList.remove("muted"); el.innerHTML = md(judgeFinal ?? acc.judge ?? ""); if (judgeFinal != null) { verdict(judgeFinal); $("art-judge").classList.remove("working"); } };
    const startGavel = () => { if (gavel) return; $("say-judge").innerHTML = '<span class="muted">The Judge raises the gavel…</span>'; $("art-judge").classList.add("working");
      sc && sc.update({ phase: "judging", speaking: "judge" });
      gavel = Promise.resolve(sc && sc.api && sc.api.gavel ? sc.api.gavel() : null).catch(() => {}).then(() => { gavelDone = true; showJudge(); }); };
    (opts.startList ? opts.startList() : []).forEach(thinking);
    primeJudge();
    sc && sc.update({ phase: "arguing", speaking: null, verdict: null });
    await readStream(got.r, (ev) => {
      if (ev.t === "seats") {                                 // the server's list wins (normalized and clamped there)
        const fresh = (Array.isArray(ev.seats) ? ev.seats : []).filter((s) => s && ID.test(s.id)).map((s) => BY[s.id] || { name: s.id, role: "", ...s });
        if (ev.swap) {                                        // Swap: the new seat takes the old one's card and stand
          const i = sitting.findIndex((x) => x.id === ev.swap), el = $("say-" + ev.swap), card = el && el.closest(".seat");
          if (i >= 0 && fresh[0]) { sitting = sitting.map((x, j) => (j === i ? fresh[0] : x)); if (card) card.innerHTML = seatHTML(fresh[0]); thinking(fresh[0]); }
        } else if (ev.add) {                                  // Hear one more seat: a card at the end
          const more = fresh.filter((x) => !sitting.some((y) => y.id === x.id));
          sitting = sitting.concat(more);
          $("seats").insertAdjacentHTML("beforeend", more.map((x) => `<div class="card seat">${seatHTML(x)}</div>`).join(""));
          setCols();
          more.forEach(thinking);
        } else if (fresh.length && fresh.map((x) => x.id).join() !== sitting.map((x) => x.id).join()) { sitting = fresh; drawCards(sitting); sitting.forEach(thinking); primeJudge(); }
        sceneSeats(sitting); renderBar(); renderNow(); return;
      }
      if (ev.t === "delta") {
        acc[ev.agent] = (acc[ev.agent] || "") + ev.text;
        if (ev.agent === "judge") { startGavel(); if (gavelDone) showJudge(); return; }
        const el = $("say-" + ev.agent); if (!el) return;
        el.classList.remove("muted"); el.innerHTML = md(acc[ev.agent]); sc && sc.update({ speaking: ev.agent });
      }
      if (ev.t === "done") {
        runs++;
        if (ev.agent === "judge") { judgeFinal = ev.error && /log ?in/i.test(ev.text) ? SIGN_IN : ev.text; startGavel(); if (gavelDone) showJudge(); return; }
        const el = $("say-" + ev.agent); if (!el) return;
        const a = $("art-" + ev.agent); if (a) a.classList.remove("working");
        el.classList.remove("muted");
        el.innerHTML = ev.error && /log ?in/i.test(ev.text) ? `<p style="color:var(--bad)">Claude Code isn't signed in. Run <code>claude</code> in a terminal and type <code>/login</code> once.</p>` : md(ev.text);
        finished.add(ev.agent); if (finished.size === opts.waitFor()) sc && sc.update({ phase: "deliberating", speaking: null });
      }
      if (ev.t === "judgeSession") judgeId = ev.id;
      if (ev.t === "saved") lastFile = ev.file ? String(ev.file).split(/[\\/]/).pop() : "";
      if (ev.t === "end" && typeof ev.cost === "number") cost = ev.cost;
    }).catch(() => {});
    // If the stream ended early (The Wise Hive stopped), nothing is left saying "Thinking…".
    for (const s of sitting || []) {
      const el = $("say-" + s.id);
      if (el && el.textContent === "Thinking…") { el.textContent = "No answer: the connection to The Wise Hive closed."; const a = $("art-" + s.id); if (a) a.classList.remove("working"); }
    }
    if (!gavel && judgeFinal == null) { $("say-judge").textContent = "The Judge didn't rule: the connection to The Wise Hive closed."; $("say-judge").classList.remove("muted"); }
    if (gavel) await gavel;
    // Cut off mid-verdict: the Judge stops working and says so under what it had written.
    if (gavel && judgeFinal == null) { $("art-judge").classList.remove("working"); $("say-judge").insertAdjacentHTML("beforeend", '<p class="muted">Cut off: the connection to The Wise Hive closed.</p>'); }
    settle();
    if (cost > 0) setCost(`${plural(runs, "run")} · about $${cost.toFixed(2)} at API prices`);
  }
  $("convene").onclick = () => {
    const idea = $("idea").value.trim(); if (!idea) { $("idea").focus(); return; }
    if (running) return;
    const list = seatsOf(seats);
    // Without the roster (server unreachable) and no edits, the server's saved default sits.
    run("/api/council", online || dirty ? { idea, seats } : { idea }, {
      accepted: () => { sitting = list; judgeId = null; lastFile = ""; drawCards(sitting); sceneSeats(sitting); },
      startList: () => sitting,
      refused: (g) => { toast("The council couldn't start", g.error); setCost(g.error, true); },
      judgeWait: "Listening to the others…", waitFor: () => sitting.length });
  };

  // One seat on the debate on screen, then the Judge again (2 runs); swap = the seat it replaces. The bar doesn't change.
  function now(id, swap) {
    if (!lastFile || running || askingNow() || !sitting) return;
    run("/api/council/more", swap ? { file: lastFile, seats: [id], swap } : { file: lastFile, seats: [id] }, {
      accepted: () => { $("judgeThread").innerHTML = ""; judgeId = null; },
      // Refused: the verdict on screen stays. A 410 means the server no longer holds this debate, so its actions go away.
      refused: (g) => { toast("Couldn't hear that seat", g.error); if (g.status === 410) lastFile = ""; },
      judgeWait: "Listening to the new seat…", waitFor: () => 1 });
  }

  function verdict(t) {
    const m = String(t).match(/VERDICT:\s*(PURSUE|PIVOT|PASS)[^\d]*(\d+(?:\.\d)?)\s*\/\s*10/i);
    $("badge-judge").innerHTML = m ? `<span class="verdict v-${m[1].toUpperCase()}">${m[1].toUpperCase()} · ${m[2]}/10</span>` : "";
    SCENE.council && SCENE.council.update({ phase: "verdict", speaking: null, verdict: m ? m[1].toUpperCase() : null });
  }
  async function askJudge() {
    const q = $("judgeQ").value.trim(); if (!q || !judgeId || running || askingNow()) return; $("judgeQ").value = "";
    const th = $("judgeThread"); th.insertAdjacentHTML("beforeend", `<div class="bubble" style="align-self:flex-end;background:var(--claude-soft);border:none">${esc(q)}</div>`);
    const box = document.createElement("div"); box.className = "bubble md"; box.innerHTML = '<span class="muted">The Judge is reconsidering…</span>'; th.appendChild(box);
    // One push-back at a time, and Swap and Hear wait for it. If a new council starts meanwhile (Convene), the answer
    // lands in the old thread (now off screen) and doesn't touch the new Judge's session, verdict or mascot.
    const mine = gen, art = $("art-judge"), live = () => mine === gen;
    asking = mine; askLock(true); renderNow(); art.classList.add("working"); setBusy(1); let t = "", got = false, end = null;
    await stream("/api/chat", { prompt: q, resume: judgeId, cwd: BRAIN_DIR || undefined, mode: "read" }, (ev) => {
      if (ev.t === "delta") { t += ev.text; box.innerHTML = md(t); }
      if (ev.t === "result") {
        got = true; if (!live()) return;
        // An error (session gone, not signed in) re-rules nothing: the verdict badge and the Judge's session stay.
        if (ev.error) { box.innerHTML = md(/log ?in/i.test(ev.text) ? SIGN_IN : (t ? t + "\n\n" : "") + (ev.text || "The Judge couldn't answer.")); return; }
        if (ev.id) judgeId = ev.id; if (!t) box.innerHTML = md(ev.text); verdict(t || ev.text);
      }
      if (ev.t === "end") end = ev;
    }).catch(() => {});
    // No result: the run ended without one (its last error line says why), or the connection closed.
    if (!got) {
      const why = end && String(end.err || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop();
      box.innerHTML = md((t ? t + "\n\n" : "") + (end ? `The Judge didn't answer${why ? ": " + why.slice(-300) : "."}` : "No answer: the connection to The Wise Hive closed."));
    }
    art.classList.remove("working"); setBusy(-1);
    if (asking === mine) asking = null;
    if (live()) { askLock(false); renderNow(); }
  }
  // A push-back from before the latest council run doesn't count: that run moved on without it.
  function askingNow() { return asking !== null && asking === gen; }
  function askLock(on) { for (const id of ["judgeQ", "judgeSend"]) { const el = $(id); if (el) el.disabled = on; } }

  // 6. Boot: the courtroom, the classic three at once, then the roster and the saved seats from the server.
  if (mountScene("council", "sceneCouncil", "council", { onPick: (k) => { const s = BY[k], a = s && s.blurb ? { n: s.name, d: s.blurb } : AGENT[k]; if (a) toast(a.n, a.d); } })) $("councilSceneWrap").hidden = false;
  renderBar(); preview();
  api("/api/council/seats").then((j) => {
    if (!j || !Array.isArray(j.roster)) return;
    const roster = j.roster.filter((s) => s && ID.test(s.id) && s.id !== "judge");
    if (!roster.length) return;
    ROSTER = roster; BY = index(ROSTER);
    GROUPS = j.groups && typeof j.groups === "object" ? j.groups : GROUPS;
    LIM = { min: Number(j.min) || 1, max: Number(j.max) || 3, lite: !!j.lite }; rosterError = j.error ? String(j.error) : ""; online = true;
    const known = (l) => (Array.isArray(l) ? l : []).filter((id, i, a) => BY[id] && a.indexOf(id) === i).slice(0, LIM.max);
    DEFAULT = known(j.default).length ? known(j.default) : DEFAULT;
    // Edits made before this answer win (and are saved now); otherwise the saved default loads.
    if (dirty) { seats = known(seats); if (!seats.length) seats = known(j.seats); save(); } else seats = known(j.seats);
    if (!seats.length) seats = DEFAULT.slice();
    renderBar(); if (!sitting) preview();
  }).catch(() => {});
})();
