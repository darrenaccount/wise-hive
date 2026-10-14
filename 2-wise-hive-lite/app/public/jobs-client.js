/* Live activity panel: the page side of jobs.js. A slim column on the right of every view lists what The Wise Hive is
   running (chats, Training/Working rounds and their planners, Updates, the council, Librarian, Organizer, Prompt
   librarian) with the subagents each one started indented under it, then "While you were away": the last 20 finished
   jobs. Each row: status dot, name, time running, time since its last output. Amber after 3 min without output, red
   after 10, for every row (subagents too: a quiet one shows the step it is on).
   Rows change only when the server pushes {t:"jobs"}. One 5 s ticker rewrites just the time texts and stall colours
   of the rows on screen, and runs only while something is running and the page is visible. Every listener is
   installed once; nothing is added per job. It reads no transcripts.
   Docked at 280 px from 1280 px wide (unless collapsed); otherwise a 36 px strip that opens a drawer over the content. */
(function () {
  "use strict";
  if (typeof api !== "function" || typeof mascot !== "function") return;

  const style = document.createElement("style");
  style.textContent = `
body{--jp-w:0px}
.jp{display:none}
@media (min-width:861px){
  body.jp-on{--jp-w:36px}
  body.jp-on .jp{display:flex}
}
/* Docked from 1280 px unless the user collapsed it (jp-shut). Pure CSS, so resizing needs no listener. */
@media (min-width:1280px){
  body.jp-on:not(.jp-shut){--jp-w:var(--jp-dock,280px)}
}
/* Chats with the Clarifier or Inventor open needs the room below 1500 px: fall back to the strip. */
@media (min-width:1280px) and (max-width:1499px){
  body.jp-on:not(.jp-shut):has(#v-chats:not([hidden]) .convo:is(.clar-open,.ideas-open)){--jp-w:36px}
}
@media (max-width:860px){.jp-drawer{display:none!important}}
.jp-scene{display:block;height:34px;flex:none;margin:6px 10px 0;image-rendering:pixelated;image-rendering:crisp-edges}
.jp-grip{position:absolute;left:0;top:0;bottom:0;width:6px;cursor:col-resize;z-index:2;touch-action:none}
.jp-grip:hover,.jp-grip:focus-visible,.jp-grip.drag{background:var(--line);outline:none}
body.jp-resizing{cursor:col-resize;user-select:none}
.jp{position:relative;grid-column:3;grid-row:1;height:100vh;width:var(--jp-w);background:var(--sunk);border-left:1px solid var(--line);flex-direction:column;min-height:0;overflow:hidden;container-type:inline-size;font-size:13px;line-height:1.4}
@container (max-width:100px){.jp .jp-full{display:none}}
@container (min-width:101px){.jp .jp-strip{display:none}}
.jp-strip{all:unset;box-sizing:border-box;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:8px;padding:18px 0;width:100%;height:100%;color:var(--muted);font:12px var(--f-mono)}
.jp-strip:hover{background:var(--surface);color:var(--ink)}
.jp-strip:focus-visible{outline:2px solid var(--claude);outline-offset:-2px}
.jp-full{display:flex;flex-direction:column;min-height:0;height:100%;width:100%}
.jp-head{display:flex;align-items:center;gap:8px;padding:14px 10px 10px 12px;border-bottom:1px solid var(--line);flex:none}
.jp-head .jp-ic{width:16px}
.jp-count{flex:1;min-width:0;font:600 13px var(--f-display);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.jp-count .w{color:var(--warn)} .jp-count .b{color:var(--bad)} .jp-count .c{color:var(--claude)}
.jp-x{border:none;background:none;color:var(--muted);cursor:pointer;font:14px/1 var(--f-mono);padding:4px 6px;border-radius:4px}
.jp-x:hover{background:var(--surface);color:var(--ink)}
.jp-body{flex:1;min-height:0;overflow:auto;padding:2px 6px 16px}
.jp-body h2.sec{margin:12px 6px 4px}
.jp-ic{flex:none;width:16px;display:block}
.jp-ic .mascot{width:16px;height:auto}
.jp-row,.jp-hrow,.jp-loop{all:unset;box-sizing:border-box;display:grid;grid-template-columns:6px 16px minmax(0,1fr) auto auto;align-items:start;gap:0 8px;width:100%;padding:5px 6px;border-radius:4px;cursor:pointer;color:var(--ink)}
.jp-row:hover,.jp-hrow:hover,.jp-loop:hover{background:var(--surface)}
.jp-row:focus-visible,.jp-hrow:focus-visible,.jp-loop:focus-visible{outline:2px solid var(--claude);outline-offset:-2px}
.jp-row.l1{padding-left:20px} .jp-row.l2{padding-left:34px}
.jp-row.warn{box-shadow:inset 2px 0 0 var(--warn)} .jp-row.bad{box-shadow:inset 2px 0 0 var(--bad)}
.jp-row > .jp-dot,.jp-hrow > .jp-dot,.jp-loop > .jp-dot{margin-top:6px}
.jp-row > .jp-ic,.jp-hrow > .jp-ic,.jp-loop > .jp-ic{margin-top:2px}
.jp-main{min-width:0;display:flex;flex-direction:column}
.jp-name{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.jp-meta,.jp-res{color:var(--muted);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.jp-row.warn .jp-meta{color:var(--warn)} .jp-row.bad .jp-meta{color:var(--bad)}
.jp-time,.jp-when{font:11.5px/1.6 var(--f-mono);color:var(--muted);white-space:nowrap}
.jp-tok{font:11px/1.7 var(--f-mono);color:var(--muted);opacity:.8;white-space:nowrap;min-width:3ch;text-align:right}
.jp-tok:empty{min-width:0}
.jp-hrow{grid-template-columns:6px 16px minmax(0,1fr)}
.jp-loop{grid-template-columns:6px 16px minmax(0,1fr);color:var(--muted);font-size:12px}
.jp-hist + .jp-hist{border-top:1px solid var(--line)}
.jp-hist details{margin:0 6px 4px 36px;font-size:12px;color:var(--muted)}
.jp-hist summary{cursor:pointer;width:max-content}
.jp-hist ul{list-style:none;margin:4px 0 2px;padding:0;display:flex;flex-direction:column;gap:2px}
.jp-hist li{display:flex;gap:6px;align-items:baseline;min-width:0}
.jp-hist li span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.jp-hist li .jp-dot{transform:translateY(-1px)}
.jp-none{color:var(--muted);font-size:12px;padding:4px 6px}
.jp-dot{width:6px;height:6px;flex:none;display:inline-block;background:var(--muted)}
.jp-dot.run{background:var(--ok);animation:jp-blink 1.6s steps(2) infinite}
.jp-dot.done{background:transparent;box-shadow:inset 0 0 0 1px var(--ok)}
.jp-dot.stopped{background:transparent;box-shadow:inset 0 0 0 1px var(--muted)}
.jp-dot.failed,.jp-dot.bad{background:var(--bad)}
.jp-dot.wait{background:var(--claude)}
.jp-dot.warn{background:var(--warn)}
.jp-dot.idle{background:transparent;box-shadow:inset 0 0 0 1px var(--line)}
@keyframes jp-blink{50%{opacity:.35}}
.jp-drawer{position:fixed;top:0;right:var(--jp-w);bottom:0;width:300px;max-width:calc(100vw - 120px);z-index:40;background:var(--sunk);border-left:1px solid var(--line);box-shadow:-12px 0 30px rgba(0,0,0,.45);display:flex;flex-direction:column;font-size:13px;line-height:1.4}
body .toast{right:calc(var(--jp-w) + 20px)}`;
  document.head.appendChild(style);

  /* ---------- DOM: the column (strip + docked panel) and a separate drawer ---------- */
  const aside = document.createElement("aside");
  aside.className = "jp"; aside.id = "jobsPanel"; aside.setAttribute("aria-label", "Live activity");
  aside.innerHTML = `<button class="jp-strip" type="button" aria-controls="jobsDrawer" aria-expanded="false"><span class="jp-dot idle"></span><span class="jp-sn"></span><span aria-hidden="true">‹</span></button>
<div class="jp-full"><div class="jp-grip" role="separator" aria-orientation="vertical" aria-label="Resize the activity panel" title="Drag to resize · double-click to reset" tabindex="0"></div><div class="jp-head"><span class="jp-ic">${mascot("queen", "The Wise Hive")}</span><span class="jp-count" aria-live="polite">All quiet</span><button class="jp-x jp-collapse" type="button" title="Collapse the activity panel" aria-label="Collapse the activity panel" aria-expanded="true">»</button></div></div>`;
  const panelBody = document.createElement("div");
  panelBody.className = "jp-body";
  panelBody.innerHTML = `<h2 class="sec">Running</h2><div class="jp-loops"></div><div class="jp-live"></div><div class="jp-none jp-idle">Nothing running</div><h2 class="sec">While you were away</h2><div class="jp-hists"></div>`;
  const full = aside.querySelector(".jp-full");
  const sceneEl = document.createElement("canvas");
  sceneEl.className = "jp-scene"; sceneEl.setAttribute("aria-hidden", "true");
  full.appendChild(sceneEl);
  full.appendChild(panelBody);
  const drawer = document.createElement("aside");
  drawer.className = "jp-drawer"; drawer.id = "jobsDrawer"; drawer.hidden = true; drawer.setAttribute("aria-label", "Live activity");
  drawer.innerHTML = `<div class="jp-head"><span class="jp-ic">${mascot("queen", "The Wise Hive")}</span><span class="jp-count">All quiet</span><button class="jp-x jp-close" type="button" title="Close (Esc)" aria-label="Close the activity panel">×</button></div>`;
  document.body.insertBefore(aside, document.body.querySelector("script"));
  document.body.appendChild(drawer);
  const strip = aside.querySelector(".jp-strip"), stripDot = strip.querySelector(".jp-dot"), stripN = strip.querySelector(".jp-sn");
  const liveEl = panelBody.querySelector(".jp-live"), idleEl = panelBody.querySelector(".jp-idle"), histEl = panelBody.querySelector(".jp-hists"), loopsEl = panelBody.querySelector(".jp-loops");
  const counts = [aside.querySelector(".jp-count"), drawer.querySelector(".jp-count")];

  /* ---------- state ---------- */
  const LIVE = new Map(); // id -> job (running top-level jobs and their children)
  const ROW = new Map();  // id -> {el, dot, meta, time} for the rows on screen
  let HIST = [], LOOPS = {}, STALL = { warn: 180, bad: 600 }, timer = null, on = false, loading = null, queue = [], resync = null, headKey = "";
  const PREF = "hive-jobs-open"; // "0" = the user collapsed the docked panel
  const pref = () => { try { return localStorage.getItem(PREF); } catch { return null; } };
  const setPref = (v) => { try { localStorage.setItem(PREF, v); } catch {} };

  /* ---------- resizing the docked panel ---------- */
  // Drag the left edge (or use the arrow keys on it) between 220 and 560 px, never leaving the main view under ~700 px.
  // Remembered per page in localStorage; double-click resets to 280 px. Listeners exist only during a drag.
  const WIDTH = "hive-jobs-width", MIN_W = 220, MAX_W = 560, DEF_W = 280;
  const clampW = (w) => Math.round(Math.max(MIN_W, Math.min(MAX_W, window.innerWidth - 84 - 700, w)));
  const setWidth = (w, save) => {
    const v = clampW(w);
    document.body.style.setProperty("--jp-dock", v + "px");
    grip.setAttribute("aria-valuenow", String(v));
    if (save) { try { localStorage.setItem(WIDTH, String(v)); } catch {} }
  };
  const grip = aside.querySelector(".jp-grip");
  grip.setAttribute("aria-valuemin", String(MIN_W)); grip.setAttribute("aria-valuemax", String(MAX_W));
  { let saved = DEF_W; try { saved = Number(localStorage.getItem(WIDTH)) || DEF_W; } catch {} setWidth(saved, false); }
  grip.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    grip.classList.add("drag"); document.body.classList.add("jp-resizing");
    const move = (ev) => setWidth(window.innerWidth - ev.clientX, false);
    const up = (ev) => {
      grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", up); grip.removeEventListener("pointercancel", up);
      grip.classList.remove("drag"); document.body.classList.remove("jp-resizing");
      setWidth(window.innerWidth - ev.clientX, true);
    };
    grip.addEventListener("pointermove", move); grip.addEventListener("pointerup", up); grip.addEventListener("pointercancel", up);
  });
  grip.addEventListener("dblclick", () => setWidth(DEF_W, true));
  grip.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const now = parseInt(getComputedStyle(document.body).getPropertyValue("--jp-dock"), 10) || DEF_W;
    setWidth(now + (e.key === "ArrowLeft" ? 16 : -16), true);
  });

  /* ---------- formatting ---------- */
  const two = (n) => String(n).padStart(2, "0");
  // Tokens Claude processed for a job (new input + cache writes + cache reads + output): "850", "4.2k", "166k", "1.2M".
  const tokText = (n) => { n = Number(n) || 0; return !n ? "" : n < 1000 ? String(n) : n < 10000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : n < 1e6 ? Math.round(n / 1000) + "k" : (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M"; };
  const tokTitle = (n, p) => { n = Number(n) || 0; if (!n) return "No token count yet"; const f = (x) => (Number(x) || 0).toLocaleString(); return `${f(n)} tokens${p ? `: ${f(p.i)} new input · ${f(p.w)} written to cache · ${f(p.r)} read from cache · ${f(p.o)} output` : ""}`; };
  const elapsed = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return s < 60 ? s + "s" : s < 3600 ? Math.floor(s / 60) + "m" : `${Math.floor(s / 3600)}h ${two(Math.floor(s % 3600 / 60))}m`; };
  const ageText = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return s < 60 ? s + "s" : s < 600 ? `${Math.floor(s / 60)}m ${two(s % 60)}s` : elapsed(ms); };
  const clock = (ms) => { const d = new Date(ms), h = d.getHours(); return { t: `${h % 12 || 12}:${two(d.getMinutes())}`, ap: h < 12 ? "am" : "pm", day: d.toDateString() }; };
  const wday = (ms) => new Date(ms).toLocaleDateString([], { weekday: "short" }) + " ";
  // "2:14 → 2:31 pm · 17m", with the weekday when not today; "→ ~3:02 am" when the end is only approximate.
  function span(h) {
    const a = clock(h.started), b = clock(h.ended), today = new Date().toDateString();
    const da = a.day !== today ? wday(h.started) : "", db = b.day !== a.day ? wday(h.ended) : "";
    return `${da}${a.t}${a.ap !== b.ap || db ? " " + a.ap : ""} → ${h.approx ? "~" : ""}${db}${b.t} ${b.ap} · ${elapsed(h.ended - h.started)}`;
  }
  const KIND = { chat: "Chat", training: "Trainer", working: "Foreman", updates: "Messenger", brainstorm: "Brainstorm", council: "Council", "council-member": "Council member",
    judge: "Judge", librarian: "Librarian", organizer: "Organizer", "prompt-librarian": "Prompt librarian", trimmer: "Trimmer", skillsmith: "Skillsmith", taste: "Taste library", subagent: "Agent", test: "Test", sketch: "Sketch reader" };
  const label = (j) => (j.kind === "chat" && j.from === "desktop" ? "From Claude Desktop" : j.kind === "plan" ? (j.icon === "foreman" ? "Foreman" : "Trainer") + " · planning" : KIND[j.kind] || "Job");
  const ICON = { training: "trainer", working: "foreman", updates: "messenger", council: "judge", judge: "judge", brainstorm: "brainstormer", librarian: "librarian", organizer: "organizer", "prompt-librarian": "refiner" };
  const iconOf = (j) => (j.kind === "subagent" ? agentFor(`${j.name} ${j.sub || ""}`) : j.icon || (j.kind === "chat" && j.from === "desktop" ? "desk" : ICON[j.kind] || "claude"));
  const tool = (n) => (typeof prettyTool === "function" ? prettyTool(n) : n);

  /* ---------- rows ---------- */
  const kidsOf = (id) => [...LIVE.values()].filter((j) => j.parent === id).sort((a, b) => a.started - b.started);
  const topOf = (j) => { for (let x = j, n = 0; x && n < 6; n++) { if (!x.parent) return x; x = LIVE.get(x.parent); } return null; };
  const fgAgents = (j) => { let n = 0; for (const c of LIVE.values()) if (c.parent === j.id && c.kind === "subagent" && !c.bg && c.status === "running") n++; return n; };
  // "", "warn" or "bad". Nothing while waiting on the user.
  function stallOf(j, now) {
    if (j.status !== "running" || j.waiting > 0) return "";
    const s = (now - j.lastOut) / 1000;
    return s >= STALL.bad ? "bad" : s >= STALL.warn ? "warn" : "";
  }
  // State never rides on the blink alone: running = filled, done = hollow green, stopped = hollow grey, failed = red.
  const dotOf = (j, st) => (j.status === "done" ? "done" : j.status === "failed" ? (j.stopped ? "stopped" : "failed") : j.waiting > 0 ? "wait" : st || "run");
  function metaOf(j, now, st) {
    if (j.status !== "running") return j.result || (j.status === "done" ? "done" : j.stopped ? "stopped" : "failed");
    const p = [], age = now - j.lastOut, n = fgAgents(j);
    if (!j.parent) p.push(label(j)); else if (j.sub) p.push(j.sub);
    if (j.kind === "subagent" && j.step) p.push(j.step);
    p.push(j.waiting > 0 ? "waiting for you" : age < 10000 ? "output just now" : st ? `quiet ${ageText(age)}` : `output ${ageText(age)} ago`);
    if (n && (!j.tool || j.tool === "Agent" || j.tool === "Task")) p.push(`waiting on ${n} agent${n === 1 ? "" : "s"}`);
    else if (j.tool && !(j.kind === "subagent" && j.step)) p.push("in " + tool(j.tool));
    return p.join(" · ");
  }
  const timeOf = (j, now) => elapsed((j.status === "running" ? now : j.ended || now) - j.started);
  function rowHTML(j, lvl, now) {
    const st = stallOf(j, now);
    return `<button type="button" class="jp-row l${lvl}${st ? " " + st : ""}" data-id="${esc(j.id)}" title="${esc(j.full || j.name)}"><span class="jp-dot ${dotOf(j, st)}"></span><span class="jp-ic">${mascot(iconOf(j), "")}</span><span class="jp-main"><span class="jp-name">${esc(j.name)}</span><span class="jp-meta">${esc(metaOf(j, now, st))}</span></span><span class="jp-time">${esc(timeOf(j, now))}</span><span class="jp-tok" title="${esc(tokTitle(j.tok, j.tk))}">${esc(tokText(j.tok))}</span></button>`;
  }
  // Replaces one job's group (its row and its children's rows) and the ROW refs for it. Nothing else is touched.
  function renderGroup(id) {
    const top = LIVE.get(id);
    if (!top) return;
    let g = [...liveEl.children].find((x) => x.dataset.g === id);
    if (g) { for (const r of g.querySelectorAll(".jp-row")) ROW.delete(r.dataset.id); }
    else {
      g = document.createElement("div"); g.className = "jp-group"; g.dataset.g = id;
      const after = [...liveEl.children].find((x) => { const o = LIVE.get(x.dataset.g); return o && o.started > top.started; });
      liveEl.insertBefore(g, after || null);
    }
    const now = Date.now();
    let h = rowHTML(top, 0, now);
    const walk = (p, lvl) => { for (const c of kidsOf(p.id)) { h += rowHTML(c, Math.min(2, Math.max(lvl, c.kind === "subagent" ? c.depth || 1 : lvl)), now); walk(c, lvl + 1); } };
    walk(top, 1);
    g.innerHTML = h;
    for (const r of g.querySelectorAll(".jp-row")) ROW.set(r.dataset.id, { el: r, dot: r.querySelector(".jp-dot"), meta: r.querySelector(".jp-meta"), time: r.querySelector(".jp-time"), tok: r.querySelector(".jp-tok") });
  }
  function dropGroup(id) {
    const g = [...liveEl.children].find((x) => x.dataset.g === id);
    if (g) { for (const r of g.querySelectorAll(".jp-row")) ROW.delete(r.dataset.id); g.remove(); }
    const gone = new Set([id]);
    for (let grew = true; grew;) { grew = false; for (const j of LIVE.values()) if (!gone.has(j.id) && gone.has(j.parent)) { gone.add(j.id); grew = true; } }
    for (const x of gone) { LIVE.delete(x); ROW.delete(x); }
  }
  const setText = (el, t) => { if (el && el.textContent !== t) el.textContent = t; };
  // Only text and classes of one existing row: no DOM is built.
  function updateRow(id, now) {
    const r = ROW.get(id), j = LIVE.get(id);
    if (!r || !j) return;
    const st = stallOf(j, now);
    r.el.classList.toggle("warn", st === "warn"); r.el.classList.toggle("bad", st === "bad");
    const d = "jp-dot " + dotOf(j, st);
    if (r.dot.className !== d) r.dot.className = d;
    setText(r.meta, metaOf(j, now, st)); setText(r.time, timeOf(j, now));
    if (r.tok) { setText(r.tok, tokText(j.tok)); const tt = tokTitle(j.tok, j.tk); if (r.tok.title !== tt) r.tok.title = tt; }
  }
  // "N running · M stuck": both count top-level jobs, so one quiet agent and the run waiting on it are 1 stuck, not 2.
  function header(now) {
    let run = 0, wait = 0;
    const stuckTops = new Set(), badTops = new Set();
    for (const j of LIVE.values()) {
      if (j.status !== "running") continue;
      if (!j.parent) run++;
      wait += j.waiting || 0;
      const s = stallOf(j, now), t = s && topOf(j);
      if (t) { stuckTops.add(t.id); if (s === "bad") badTops.add(t.id); }
    }
    const stuck = stuckTops.size, bad = badTops.size;
    const key = `${run}|${stuck}|${bad}|${wait}`;
    if (key === headKey) return;
    headKey = key;
    const parts = run ? [`${run} running`, stuck ? `<span class="${bad ? "b" : "w"}">${stuck} stuck</span>` : "", wait ? `<span class="c">${wait} needs you</span>` : ""].filter(Boolean) : ["All quiet"];
    for (const c of counts) c.innerHTML = parts.join(" · ");
    const text = counts[0].textContent;
    stripDot.className = "jp-dot " + (bad ? "bad" : stuck ? "warn" : wait ? "wait" : run ? "run" : "idle");
    stripN.textContent = run ? String(run) : "";
    strip.title = `${text}: open the activity panel`;
    strip.setAttribute("aria-label", strip.title);
  }
  function histHTML(h, i) {
    const dot = h.status === "done" ? "done" : h.stopped ? "stopped" : "failed", n = (h.agents || []).length + (h.more || 0);
    const agents = n ? `<details><summary>${n} agent${n === 1 ? "" : "s"}</summary><ul>${h.agents.map((a) => `<li title="${esc(a.result || "")}"><span class="jp-dot ${a.status === "done" ? "done" : a.stopped ? "stopped" : "failed"}"></span><span><b>${esc(a.name)}</b>${a.tok ? " · " + tokText(a.tok) + " tok" : ""}${a.result ? " · " + esc(a.result) : ""}</span></li>`).join("")}${h.more ? `<li>+${h.more} more</li>` : ""}</ul></details>` : "";
    return `<div class="jp-hist"><button type="button" class="jp-hrow" data-h="${i}" title="${esc(h.full || h.name)}${h.result ? "\n" + esc(h.result) : ""}"><span class="jp-dot ${dot}"></span><span class="jp-ic">${mascot(iconOf(h), "")}</span><span class="jp-main"><span class="jp-name">${esc(h.name)}</span><span class="jp-when"${h.approx ? ` title="Last output before the restart; the exact end isn't known"` : ""}>${esc(span(h))}${h.tok ? ` · ${tokText(h.tok)} tok` : ""}</span><span class="jp-res">${esc(h.result || "")}</span></span></button>${agents}</div>`;
  }
  const renderHist = () => { histEl.innerHTML = HIST.length ? HIST.map(histHTML).join("") : `<div class="jp-none">Finished jobs show up here.</div>`; };
  // Training or Working that is on but between rounds (resting, paused) has no job row; one muted line says so,
  // so "Nothing running" can't hide an active loop.
  function renderLoops() {
    const h = [];
    for (const [mode, name, icon] of [["training", "Training", "trainer"], ["working", "Working", "foreman"]]) {
      const l = LOOPS[mode];
      if (!l || !l.active || ["planning", "running", "reviewing"].includes(l.status)) continue;
      const r = l.restingUntil ? clock(l.restingUntil) : null;
      const why = l.pauseText || (l.status === "resting" && r ? `resting until ${r.t} ${r.ap}` : l.status || "on");
      h.push(`<button type="button" class="jp-loop" data-view="${mode}" title="${esc(name)} · ${esc(why)}"><span class="jp-dot idle"></span><span class="jp-ic">${mascot(icon, "")}</span><span class="jp-res">${esc(name)} · ${esc(why)}</span></button>`);
    }
    loopsEl.innerHTML = h.join("");
  }
  const idleNote = () => { idleEl.hidden = liveEl.children.length > 0 || loopsEl.children.length > 0; };
  function renderAll() {
    ROW.clear(); liveEl.innerHTML = ""; headKey = "";
    for (const j of [...LIVE.values()].filter((x) => !x.parent).sort((a, b) => a.started - b.started)) renderGroup(j.id);
    renderHist(); renderLoops(); idleNote(); header(Date.now()); ensureTick();
  }

  /* ---------- the ticker: time texts and stall colours only ---------- */
  function tick() {
    const now = Date.now();
    for (const id of ROW.keys()) updateRow(id, now);
    header(now);
    ensureTick();
  }
  function ensureTick() {
    let any = false;
    if (on && document.visibilityState === "visible") for (const j of LIVE.values()) if (j.status === "running") { any = true; break; }
    if (any && !timer) timer = setInterval(tick, 5000);
    if (!any && timer) { clearInterval(timer); timer = null; }
    ensureAnim(any);
  }

  /* ---------- the little pixel strip under the header ---------- */
  // Queen Claude on the left and one small worker per running job (its own mascot). Workers bob while they work, a
  // quiet one stops and shows an amber "?" (red "!" past 10 min). Idle: the Queen dozes. It animates at 4 fps only
  // while something runs and the page is visible (one interval, cleared when idle); otherwise one still frame.
  // Buffer pixels are drawn 2x. Uses Pixel.sprite from pixel.js; without it the strip stays blank.
  const MOTION = !(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const sctx = sceneEl.getContext("2d");
  let anim = null, animF = 0;
  const cssVar = (n, fb) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || fb;
  const MARK = { "?": ["###", "..#", ".##", "...", ".#."], "!": [".#.", ".#.", ".#.", "...", ".#."], z: ["###", ".#.", "###"] };
  const mark = (ch, x, y, c) => { sctx.fillStyle = c; MARK[ch].forEach((row, r) => [...row].forEach((on, k) => { if (on === "#") sctx.fillRect(x + k, y + r, 1, 1); })); };
  function drawScene() {
    const P = window.Pixel, cw = full.clientWidth - 20; // the panel's width less the strip's side margins
    // Nothing to draw into a hidden panel (cw <= 0) or a hidden desktop window (main.js sets data-shell).
    if (!P || cw <= 0 || document.documentElement.dataset.shell === "hidden") return;
    const W = Math.max(40, Math.floor(cw / 2)), H = 17;
    if (sceneEl.width !== W || sceneEl.height !== H) { sceneEl.width = W; sceneEl.height = H; sceneEl.style.width = W * 2 + "px"; }
    sctx.imageSmoothingEnabled = false;
    sctx.clearRect(0, 0, W, H);
    sctx.fillStyle = cssVar("--line", "#2b2f37"); sctx.fillRect(0, H - 1, W, 1);
    const now = Date.now();
    const tops = [...LIVE.values()].filter((j) => !j.parent && j.status === "running").sort((a, b) => a.started - b.started);
    const busy = tops.length > 0;
    sctx.drawImage(P.sprite("queen"), 0, 0);
    if (!busy) { const c = cssVar("--muted", "#8a8f98"); mark("z", 20, 5, c); mark("z", 24, 1, c); return; }
    const fit = Math.max(0, Math.floor((W - 26) / 22));
    tops.slice(0, fit).forEach((j, i) => {
      const st = stallOf(j, now), x = 26 + i * 22;
      const hop = !st && MOTION && (animF + i) % 2 === 0 ? -1 : 0;
      sctx.drawImage(P.sprite(iconOf(j)), x, hop);
      if (st) mark(st === "bad" ? "!" : "?", x + 17, 0, st === "bad" ? cssVar("--bad", "#e06c6c") : cssVar("--warn", "#e0a84a"));
      else if (MOTION && (animF + i) % 4 === 1) { sctx.fillStyle = cssVar("--gold", "#e9b949"); sctx.fillRect(x + 18, 2, 1, 1); sctx.fillRect(x + 19, 1, 1, 1); }
    });
    if (tops.length > fit && fit > 0) { sctx.fillStyle = cssVar("--muted", "#8a8f98"); for (let k = 0; k < 3; k++) sctx.fillRect(W - 6 + k * 2, H - 4, 1, 1); }
  }
  function ensureAnim(running) {
    const want = running && MOTION;
    if (want && !anim) anim = setInterval(() => { animF++; drawScene(); }, 250);
    if (!want && anim) { clearInterval(anim); anim = null; }
    drawScene();
  }
  if (window.ResizeObserver) new ResizeObserver(() => drawScene()).observe(full);
  window.addEventListener("hive:shell", () => drawScene()); // the desktop window was shown again: draw what changed meanwhile

  /* ---------- data ---------- */
  function setOn(v) {
    on = v;
    document.body.classList.toggle("jp-on", v);
    if (!v) closeDrawer();
    dock();
  }
  function dock() { document.body.classList.toggle("jp-shut", pref() === "0"); }
  // The full state, at boot and after every reconnect. api() parses JSON whatever the status (an unknown route says
  // {error:"unknown"}), so the panel only appears when the answer really has a live list; otherwise its column is 0 px.
  function load() {
    if (loading) return loading;
    loading = (async () => {
      let j = null;
      try { j = await api("/api/jobs"); } catch {}
      if (!j || !Array.isArray(j.live)) { LIVE.clear(); ROW.clear(); setOn(false); ensureTick(); return false; }
      LIVE.clear();
      for (const x of j.live) if (x && x.id) LIVE.set(x.id, x);
      HIST = Array.isArray(j.history) ? j.history.slice(0, 20) : [];
      if (j.stall && typeof j.stall === "object") STALL = j.stall;
      if (j.loops && typeof j.loops === "object") LOOPS = j.loops;
      setOn(true); renderAll();
      return true;
    })();
    // Pushes that arrived while the answer was on its way are applied after it, in order.
    return loading.finally(() => { loading = null; const q = queue; queue = []; for (const ev of q) onJobs(ev); });
  }
  const resyncSoon = () => { if (!resync) resync = setTimeout(() => { resync = null; load(); }, 800); };
  function onJobs(ev) {
    if (loading) { queue.push(ev); return; }
    if (!on) return;
    const j = ev.job, now = Date.now();
    if (ev.op === "up" && j) {
      LIVE.set(j.id, j);
      const top = topOf(j);
      if (!top) { LIVE.delete(j.id); return resyncSoon(); } // a child whose run this page never heard of
      renderGroup(top.id);
    } else if (ev.op === "out") {
      const x = LIVE.get(ev.id);
      if (!x) return;
      x.lastOut = ev.at; if (ev.tool !== undefined) x.tool = ev.tool; if (ev.step !== undefined) x.step = ev.step;
      if (ev.tok !== undefined) { x.tok = ev.tok; x.tk = ev.tk; }
      updateRow(ev.id, now);
    } else if (ev.op === "end" && j) {
      if (j.parent && LIVE.has(j.parent)) { LIVE.set(j.id, j); const top = topOf(j); if (top) renderGroup(top.id); }
      else {
        dropGroup(j.id);
        if (ev.item && !HIST.some((h) => h.id === ev.item.id && h.ended === ev.item.ended)) { HIST.unshift(ev.item); if (HIST.length > 20) HIST.length = 20; renderHist(); }
      }
    }
    idleNote(); header(now); ensureTick();
  }

  /* ---------- clicks ---------- */
  const VIEW = { training: "training", working: "working", updates: "updates", brainstorm: "brainstorm", council: "council", "council-member": "council", judge: "council",
    librarian: "library", organizer: "library", "prompt-librarian": "library", trimmer: "library", skillsmith: "library", taste: "taste", sketch: "sketch" };
  const viewOf = (j) => VIEW[j.kind] || (j.kind === "plan" ? (j.icon === "foreman" ? "working" : "training") : null);
  const go = (v) => { closeDrawer(); show(v); };
  async function openJob(j) {
    const top = j && (topOf(j) || j);
    if (!top) return;
    if (top.kind === "chat") {
      closeDrawer();
      let ok = false;
      if (typeof openRun === "function") { try { ok = await openRun(top.id); } catch {} }
      if (!ok && top.chatId && typeof openSession === "function") openSession(top.chatId);
      return;
    }
    const v = viewOf(top);
    if (v) go(v);
  }
  // A finished job with a chat id opens in the existing chat viewer; the rest open their tab.
  function openItem(h) {
    if (!h) return;
    if (h.chatId && h.kind !== "brainstorm" && h.kind !== "test" && h.kind !== "sketch" && typeof openSession === "function") { closeDrawer(); openSession(h.chatId); return; }
    const v = viewOf(h);
    if (v) go(v);
  }
  panelBody.addEventListener("click", (e) => {
    const r = e.target.closest(".jp-row"), h = e.target.closest(".jp-hrow"), l = e.target.closest(".jp-loop");
    if (r) openJob(LIVE.get(r.dataset.id));
    else if (h) openItem(HIST[Number(h.dataset.h)]);
    else if (l && l.dataset.view) go(l.dataset.view);
  });

  /* ---------- docking, strip and drawer ---------- */
  function openDrawer() { drawer.appendChild(panelBody); drawer.hidden = false; strip.setAttribute("aria-expanded", "true"); }
  function closeDrawer() { if (drawer.hidden) return; drawer.hidden = true; full.appendChild(panelBody); strip.setAttribute("aria-expanded", "false"); }
  strip.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!drawer.hidden) return closeDrawer();
    if (pref() === "0") { setPref("1"); dock(); if (aside.clientWidth > 100) return; } // collapsed and wide enough: dock it again
    openDrawer();
  });
  aside.querySelector(".jp-collapse").addEventListener("click", () => { setPref("0"); dock(); strip.focus(); });
  drawer.querySelector(".jp-close").addEventListener("click", () => { closeDrawer(); strip.focus(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !drawer.hidden) { closeDrawer(); strip.focus(); } });
  document.addEventListener("click", (e) => { if (!drawer.hidden && !drawer.contains(e.target) && !strip.contains(e.target)) closeDrawer(); });
  // The drawer is only for the strip: close it when the column grows (window widened, or the Clarifier closed).
  if (window.ResizeObserver) new ResizeObserver(() => { if (!drawer.hidden && aside.clientWidth > 100) closeDrawer(); }).observe(aside);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") tick(); else ensureTick(); });
  window.addEventListener("hive:server", (e) => {
    const ev = e.detail || {};
    if (ev.t === "jobs") onJobs(ev);
    else if (ev.t === "hello") load(); // (re)connected: take the full state again
    else if (ev.t === "autopilot" && ev.mode && ev.state) {
      const s = ev.state;
      LOOPS[ev.mode] = { active: s.active === true, status: s.status || "", restingUntil: s.restingUntil || null, pauseText: (s.pause && s.pause.text) || "" };
      if (on && !loading) { renderLoops(); idleNote(); }
    }
  });

  window.HiveJobs = { counts: () => ({ live: LIVE.size, rows: ROW.size, ticking: !!timer, animating: !!anim }), reload: load };
  dock();
  load();
})();
