/* Training and Working tabs: the page side of autopilot.js. One builder serves both modes: each view is built once
   into its .ap-root container, then re-rendered from GET /api/autopilot/:mode whenever the server says it changed. */
(function () {
  "use strict";
  const MODES = ["training", "working"];
  const COPY = {
    training: {
      title: "Training", mascot: "trainer", lead: "Trainer", verb: "Training", end: "End training", dot: "trainDot",
      desc: "Your agents practice non-stop to get better, until you press End.",
      placeholder: "e.g. train Blender modelling, especially closing up invisible gaps",
      activePh: "Tell the Trainer what to practice next",
      startHint: "Send to start training.",
      planning: "The Trainer is reading the notes and picking the next exercise.",
      empty: "Nothing yet. Tell the Trainer what to practice, and training starts.",
      scene: "The training ground, where your agents practice between rounds.",
    },
    working: {
      title: "Working", mascot: "foreman", lead: "Foreman", verb: "Working", end: "End work", dot: "workDot",
      desc: "Your agents keep building and improving a project on their own, until you press End.",
      placeholder: "e.g. keep improving my Roblox game: new weapons, map polish, fix bugs",
      activePh: "Tell the Foreman what to build or fix next",
      startHint: "Send to start working.",
      planning: "The Foreman is reading the project and picking the next task.",
      empty: "Nothing yet. Pick a project, say what to work on, and work starts.",
      scene: "The workshop, where your agents build and improve your project.",
    },
  };
  const PERMS = [["safe", "Safe: files, Blender, web and docs; no shell commands"], ["full", "Full access: anything, never asks (riskier while you're away)"]];
  const MODELS = [["", "Default"], ["claude-opus-5-5", "Opus 5.5"], ["claude-sonnet-5-5", "Sonnet 5.5"], ["claude-haiku-5-5", "Haiku 5.5"], ["claude-fable-5-1", "Fable 5.1"]];
  // Training's "Subjects to practice" (same keys as SUBJECTS in autopilot.js). None ticked = the planner picks freely.
  const SUBJECTS = [["props", "Props and objects"], ["characters", "Characters and creatures"], ["buildings", "Buildings and environments"], ["vehicles", "Vehicles"],
    ["weapons", "Weapons and tools"], ["hardsurface", "Hard-surface / sci-fi"], ["lowpoly", "Low-poly and stylized scenes"], ["materials", "Materials and texturing"],
    ["lighting", "Lighting and rendering"], ["animation", "Animation"], ["vfx", "VFX in Blender"], ["robloxvfx", "Roblox VFX"], ["robloxbuild", "Roblox building"], ["ui", "Game UI"]];
  // Usage cap (autopilot.js CAPS). Spend is an estimate at API prices, even on a subscription.
  const CAPS = [["default", "Default: pause at 97%, resume after reset"], ["p90", "Pause at 90%"], ["p75", "Pause at 75%"], ["p50", "Pause at 50%"],
    ["r5", "Stop after 5 rounds a day"], ["r10", "Stop after 10 rounds a day"], ["r25", "Stop after 25 rounds a day"],
    ["usd5", "Est. spend cap: $5 a day"], ["usd20", "Est. spend cap: $20 a day"], ["usd50", "Est. spend cap: $50 a day"], ["none", "No cap (rest only when a limit is hit)"]];
  const CAP_PCT = { default: 97, p90: 90, p75: 75, p50: 50, r5: 97, r10: 97, r25: 97, usd5: 97, usd20: 97, usd50: 97 };
  const CAP_DAY = { r5: [5, "rounds"], r10: [10, "rounds"], r25: [25, "rounds"], usd5: [5, "usd"], usd20: [20, "usd"], usd50: [50, "usd"] };
  // The boss's bar: it scores every finished round out of 10 and sends it back (at most twice) when it's below.
  const BOSS = [["8", "8/10: strict"], ["9", "9/10: very strict"], ["7", "7/10: easier"], ["0", "Off"]];
  const HOURS = Array.from({ length: 24 }, (_, h) => [String(h), `${h % 12 || 12} ${h < 12 ? "am" : "pm"}`]);
  const NOTE = "Runs until you press End, even while you're away. Each round uses your Claude plan's usage; the usage cap pauses it before a limit and carries on after the reset.";
  const GIT_NOTE = "Code changes go on a teamwright/autowork git branch when the project uses git.";
  const OFFLINE = "Can't reach The Wise Hive";

  const style = document.createElement("style");
  style.textContent = `
.ap-root{height:100%;min-height:0;display:flex;flex-direction:column;background:radial-gradient(1100px 420px at 50% -8%,color-mix(in srgb,var(--claude) 6%,transparent),transparent 60%),var(--bg)}
.ap-scroll{flex:1;min-height:0;overflow:auto;padding:24px 32px 18px}
.ap-page{max-width:980px;margin:0 auto;display:flex;flex-direction:column;gap:16px}
.ap-head{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.ap-me{width:60px;flex:none}
.ap-title{flex:1;min-width:220px;display:flex;flex-direction:column;gap:3px}
.ap-title .row{gap:10px;flex-wrap:wrap}
.ap-title h1{font-size:26px}
.ap-title p{margin:0;color:var(--muted);font-size:14px}
.ap-status{display:inline-flex;align-items:center;gap:7px;min-width:0;max-width:100%;font-size:12.5px;font-weight:700;padding:3px 11px;border-radius:999px;border:1px solid var(--line);background:var(--raised);color:var(--muted)}
.ap-status span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ap-status::before{content:"";flex:none;width:7px;height:7px;border-radius:50%;background:var(--muted)}
.ap-status.on{color:var(--claude);background:var(--claude-soft);border-color:color-mix(in srgb,var(--claude) 40%,var(--line))}
.ap-status.on::before{background:var(--ok);animation:livepulse 1.6s ease-out infinite}
.ap-status.rest{color:var(--warn)}.ap-status.rest::before{background:var(--warn)}
.ap-status.stop{color:var(--bad)}.ap-status.stop::before{background:var(--bad)}
.btn.ap-end{flex:none;color:var(--bad);border-color:color-mix(in srgb,var(--bad) 50%,var(--line))}
.btn.ap-end:hover{border-color:var(--bad);background:color-mix(in srgb,var(--bad) 10%,var(--surface))}
.btn.ap-end.armed{background:var(--bad);border-color:var(--bad);color:var(--bg)}
.ap-offline{margin:0;color:var(--muted);font-size:13px}
.ap-scene{display:block;margin:0 auto;width:min(100%,calc(42vh * 320 / 150));height:auto;aspect-ratio:320/150;border-radius:16px;border:1px solid var(--line);background:var(--sunk);image-rendering:pixelated;box-shadow:0 12px 30px rgba(0,0,0,.35)}
.ap-cur{display:flex;flex-direction:column;gap:8px}
.ap-cur.live{border-color:color-mix(in srgb,var(--claude) 45%,var(--line));box-shadow:0 0 0 4px var(--claude-glow)}
.ap-cur-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-height:28px}
.ap-kicker{font:700 11px var(--f-body);text-transform:uppercase;letter-spacing:.09em;color:var(--claude)}
.ap-cur h3{font-size:19px;line-height:1.3;overflow-wrap:anywhere}
.ap-sub{margin:0;font-size:13.5px;color:var(--muted)}
.ap-sub.warn{color:var(--warn)}
.ap-elapsed{font:12.5px var(--f-mono);color:var(--muted)}
.ap-agents{display:flex;gap:6px;align-items:flex-end}
.ap-ag{width:28px;display:block}
.ap-focus{color:var(--gold);border-color:color-mix(in srgb,var(--gold) 35%,var(--line));background:color-mix(in srgb,var(--gold) 9%,var(--raised))}
.ap-info{display:flex;flex-direction:column;gap:4px;border-top:1px solid var(--line);padding-top:8px;margin-top:2px}
.ap-goal{margin:0;font-size:13px;color:var(--muted);overflow-wrap:anywhere}
.ap-goal b{color:var(--ink);margin-right:6px}
.ap-meta{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;font-size:12.5px;color:var(--muted)}
.ap-meta i{font-style:normal;opacity:.5}
.ap-meta .chip{font-size:11.5px;padding:1px 9px}
.ap-next{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}
.ap-idea{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:6px;min-width:0}
.ap-idea-top{display:flex;gap:8px;align-items:flex-start;justify-content:space-between}
.ap-idea b{font-size:14px;line-height:1.35;overflow-wrap:anywhere}
.ap-idea p{margin:0;font-size:12.5px;color:var(--muted);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ap-idea .btn{align-self:flex-start;margin-top:auto}
.ap-feed{display:flex;flex-direction:column;gap:12px;max-height:max(280px,52vh);overflow:auto;background:var(--sunk);border:1px solid var(--line);border-radius:14px;padding:14px 16px}
.ap-e{display:flex;gap:10px;align-items:flex-start;font-size:14px;min-width:0}
.ap-av{width:26px;flex:none;margin-top:1px}
.ap-body{flex:1;min-width:0}
.ap-line{display:flex;align-items:baseline;gap:4px 10px;flex-wrap:wrap;min-width:0}
.ap-x{min-width:0;overflow-wrap:anywhere}
.ap-t{margin-left:auto;font-size:11.5px;color:var(--muted);white-space:nowrap;font-weight:400}
.ap-e.user{flex-direction:column;align-items:flex-end;align-self:flex-end;max-width:78%;gap:3px}
.ap-e.user .ap-t{margin-left:0}
.ap-bub{background:var(--raised);border:1px solid var(--line);border-radius:16px 16px 4px 16px;padding:8px 14px;white-space:pre-wrap;overflow-wrap:anywhere}
.ap-e.plan p{margin:2px 0 0;font-size:13px;color:var(--muted);overflow-wrap:anywhere}
.ap-e.result .ap-body{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:10px 14px}
.ap-e.result .md{font-size:14px;overflow-wrap:anywhere;margin-top:4px}
.ap-e.start,.ap-e.note,.ap-e.system{color:var(--muted);font-size:13px}
.ap-e.note .ap-x,.ap-e.system .ap-x,.ap-e.error .ap-x{white-space:pre-wrap}
.ap-dot{height:20px;display:flex;align-items:center;justify-content:center;margin-top:0}
.ap-dot::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor;opacity:.7}
.ap-e.error{color:var(--bad);font-size:13px}
.ap-open{font-size:12.5px}
.ap-empty{margin:auto;color:var(--muted);font-size:13px;text-align:center;padding:18px 6px}
.ap-foot{flex:none;border-top:1px solid var(--line);background:color-mix(in srgb,var(--bg) 90%,transparent);backdrop-filter:blur(8px);padding:12px 32px 14px}
.ap-foot-in{max-width:980px;margin:0 auto;display:flex;flex-direction:column;gap:8px}
.ap-set{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center}
.ap-set label{display:flex;align-items:center;gap:7px;font-size:12.5px;font-weight:700;color:var(--muted);min-width:0;max-width:100%}
.ap-set select{padding:5px 10px;font-size:13px;border-radius:10px;background:var(--raised);min-width:0;max-width:min(430px,70vw)}
.ap-foot .compose-box textarea{min-height:46px;max-height:200px}
.ap-hint{font-size:12px;color:var(--muted);padding-left:8px}
.ap-err{font-size:13px;color:var(--bad)}
.ap-note{margin:0;font-size:12px;color:var(--muted);text-align:center}
.ap-guard{position:relative;display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;font-size:12.5px;color:var(--muted)}
.ap-meter{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;min-width:0}
.ap-mw{display:inline-flex;align-items:center;gap:6px;white-space:nowrap;font-variant-numeric:tabular-nums}
.ap-mw b{color:var(--ink);font-weight:700}
.ap-bar{width:44px;height:6px;background:var(--sunk);border:1px solid var(--line);border-radius:2px;overflow:hidden;flex:none}
.ap-bar i{display:block;height:100%;background:var(--ok)}
.ap-mw.hi .ap-bar i{background:var(--warn)}.ap-mw.over .ap-bar i{background:var(--bad)}.ap-mw.over b{color:var(--bad)}
.ap-cap{display:flex;align-items:center;gap:7px;font-weight:700}
.ap-score{display:inline-block;padding:0 7px;border-radius:8px;background:var(--raised);font-family:var(--f-mono)}
.ap-score.pass{color:var(--ok)}
.ap-score.fail{color:var(--warn)}
.ap-note-s{font-size:12px;color:var(--muted)}
.ap-fix{margin:4px 0 0;padding-left:20px;font-size:13px;color:var(--ink)}
.ap-fix li{margin:2px 0}
.ap-cap select{padding:4px 9px;font-size:12.5px;border-radius:10px;background:var(--raised);max-width:min(330px,60vw)}
.ap-pop{position:absolute;right:0;bottom:calc(100% + 8px);z-index:30;width:min(390px,92vw);display:flex;flex-direction:column;gap:9px;padding:12px 14px;background:var(--surface);border:1px solid var(--line);border-radius:12px;box-shadow:0 12px 30px rgba(0,0,0,.45);color:var(--ink)}
.ap-pop label{display:flex;align-items:center;gap:7px;flex-wrap:wrap;font-size:13px}
.ap-pop select{padding:3px 7px;font-size:12.5px;border-radius:8px;background:var(--raised)}
.ap-pop p{margin:0 0 0 22px;font-size:12px;color:var(--muted)}
.ap-subj-wrap{position:relative}
.ap-subj{position:absolute;left:0;bottom:calc(100% + 8px);z-index:30;width:min(420px,92vw);display:grid;grid-template-columns:1fr 1fr;gap:6px 12px;padding:12px 14px;background:var(--surface);border:1px solid var(--line);border-radius:14px;box-shadow:0 12px 32px rgba(0,0,0,.45)}
.ap-subj label{display:flex;align-items:center;gap:7px;font-size:13px;color:var(--ink)}
.ap-subj p{grid-column:1/-1;margin:0;font-size:12px;color:var(--muted)}
.ap-paused{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:13px;font-weight:700;color:var(--warn);padding:6px 12px;border:1px solid color-mix(in srgb,var(--warn) 40%,var(--line));border-radius:10px;background:color-mix(in srgb,var(--warn) 8%,var(--surface))}
.ap-paused span{flex:1;min-width:0}
@media (max-width:860px){
  .ap-scroll{padding:16px 16px 12px}.ap-foot{padding:10px 16px 12px}
  .ap-me{width:44px}.ap-title h1{font-size:22px}.ap-e.user{max-width:92%}
}`;
  document.head.appendChild(style);

  const M = {};
  for (const mode of MODES) M[mode] = { mode, built: false, els: {}, state: null, err: "", seq: 0, scene: null, poll: 0, clock: 0, deb: 0, ticks: 0,
    feedSig: null, stick: true, armed: false, armTimer: 0, ending: false, sending: false, projects: [], projLoading: false, touched: {}, guardBusy: false, guardSeq: 0, bossBusy: false, bossSeq: 0 };

  /* ---------- helpers ---------- */
  const arr = (v) => (Array.isArray(v) ? v : []);
  const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : null);
  const ts = (v) => { const n = typeof v === "number" ? v : typeof v === "string" ? Date.parse(v) : NaN; return Number.isFinite(n) ? n : null; };
  const when = (v) => { const n = ts(v); return n == null ? "" : ago(new Date(n).toISOString()); };
  const clock = (v) => { const n = ts(v); return n == null ? "" : new Date(n).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); };
  const full = (v) => { const n = ts(v); return n == null ? "" : new Date(n).toLocaleString(); };
  const two = (n) => String(n).padStart(2, "0");
  function dur(ms) {
    const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
    return h ? `${h}h ${two(m)}m` : `${m}m ${two(s % 60)}s`;
  }
  const visible = (mode) => { const v = $("v-" + mode); return !!v && !v.hidden; };
  const nearBottom = (el) => el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  const modelName = (id) => { const m = MODELS.find(([v]) => v === (id || "")); return m ? (m[0] ? m[1] : "Default model") : String(id); };
  const focusChip = (f) => (f ? `<span class="chip ap-focus">${esc(f)}</span>` : "");
  const opts = (list) => list.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join("");
  // Only touch the DOM when a section really changed, so buttons keep focus between polls.
  const setHTML = (el, html) => { if (el._apHTML !== html) { el.innerHTML = html; el._apHTML = html; } };
  function grow(ta) { ta.style.height = "auto"; ta.style.height = Math.min(200, ta.scrollHeight) + "px"; }

  // Server state with every field the renderers read filled in, so a partial or old state can't break the page.
  function norm(mode, s) {
    s = obj(s) || {};
    const cur = obj(s.current), stats = obj(s.stats) || {};
    return {
      mode, active: !!s.active, status: typeof s.status === "string" && s.status ? s.status : "idle", goal: String(s.goal || ""),
      permission: s.permission === "full" ? "full" : "safe", model: typeof s.model === "string" ? s.model : "",
      project: obj(s.project) && s.project.dir ? { dir: String(s.project.dir), name: String(s.project.name || s.project.dir) } : null,
      startedAt: s.startedAt || null, iteration: Number(s.iteration) || 0,
      current: cur ? { ...cur, agents: arr(cur.agents).filter((k) => typeof k === "string" && k) } : null,
      // Keep each idea's index in the server's list: "Do this next" sends it back.
      next: arr(s.next).map((x, i) => (obj(x) ? { ...x, i } : null)).filter(Boolean), restingUntil: s.restingUntil || null, lastError: s.lastError ? String(s.lastError) : "",
      directives: arr(s.directives), log: arr(s.log).filter(obj),
      stats: { completed: Number(stats.completed) || 0, failed: Number(stats.failed) || 0, totalMs: Number(stats.totalMs) || 0, cost: Number(stats.cost) || 0 },
      guard: normGuard(s.guard), pause: obj(s.pause) && s.pause.kind ? { kind: String(s.pause.kind), until: ts(s.pause.until), text: String(s.pause.text || "Paused") } : null,
      daily: { day: String((obj(s.daily) || {}).day || ""), rounds: Number((obj(s.daily) || {}).rounds) || 0, cost: Number((obj(s.daily) || {}).cost) || 0 },
      usage: normUsage(s.usage), boss: [0, 7, 8, 9].includes(Number(s.boss)) && s.boss !== null ? Number(s.boss) : 8,
    };
  }
  function normGuard(g) {
    g = obj(g) || {};
    const q = obj(g.quiet) || {}, hr = (v, d) => (Number.isInteger(v) && v >= 0 && v < 24 ? v : d);
    return { cap: CAPS.some(([v]) => v === g.cap) ? g.cap : "default", quiet: { on: q.on === true, from: hr(q.from, 9), to: hr(q.to, 17) }, gaming: g.gaming !== false };
  }
  const normUsage = (u) => (obj(u) ? { at: ts(u.at), error: u.error ? String(u.error) : "", windows: arr(u.windows).filter((w) => obj(w) && Number.isFinite(Number(w.percent))) } : null);
  function statusText(mode, s) {
    switch (s.status) {
      case "idle": return "Idle";
      case "planning": return "Planning the next round";
      case "running": return `${COPY[mode].verb}: ${(s.current && s.current.title) || "round " + s.iteration}`;
      case "reviewing": return "Reviewing";
      case "resting":
        if (s.pause) return s.pause.kind === "gaming" ? "Paused while you play" : s.pause.until ? `Paused until ${clock(s.pause.until)}` : "Paused";
        return s.restingUntil ? `Resting until ${clock(s.restingUntil)}` : "Resting";
      case "stopping": return "Stopping";
      default: return s.status[0].toUpperCase() + s.status.slice(1);
    }
  }
  const phase = (mode, st) => (st === "running" ? mode : ["planning", "reviewing", "resting"].includes(st) ? st : "idle");

  /* ---------- renderers (state -> html) ---------- */
  function infoHTML(s) {
    const bits = [];
    if (s.project) bits.push(`<span class="chip" title="${esc(s.project.dir)}">${esc(s.project.name)}</span>`);
    bits.push(`<span>${s.permission === "full" ? "Full access" : "Safe permissions"}</span>`, `<span>${esc(modelName(s.model))}</span>`);
    bits.push(`<span>${s.stats.completed} done${s.stats.failed ? `, ${s.stats.failed} failed` : ""}</span>`);
    if (s.stats.cost > 0) bits.push(`<span title="What these rounds would cost at API prices; your plan's usage is what really counts">$${s.stats.cost.toFixed(2)} est.</span>`);
    if (ts(s.startedAt) != null) bits.push(`<span title="${esc(full(s.startedAt))}">started ${esc(when(s.startedAt))}</span>`);
    return `<div class="ap-info">${s.goal ? `<p class="ap-goal"><b>Goal</b>${esc(s.goal)}</p>` : ""}<div class="ap-meta">${bits.join("<i>·</i>")}</div></div>`;
  }
  function curHTML(mode, s) {
    if (!s.active) return "";
    const c = s.current;
    if (c) {
      const since = ts(c.startedAt);
      const agents = c.agents.map((k, i) => {
        const name = AGENT[k] ? AGENT[k].n : k;
        return `<span class="ap-ag bob" style="animation-delay:${-i * 0.45}s" title="${esc(name)}">${mascot(k, esc(name))}</span>`;
      }).join("");
      return `<div class="card ap-cur live">
<div class="ap-cur-top"><span class="ap-kicker">Round ${esc(c.n != null ? c.n : s.iteration)}</span>${focusChip(c.focus)}${since != null ? `<span class="ap-elapsed" data-since="${since}" title="How long this round has been running"></span>` : ""}<span class="spacer"></span>${agents ? `<span class="ap-agents">${agents}</span>` : ""}</div>
<h3>${esc(c.title || "Untitled round")}</h3>
<div class="row"><button class="btn small" type="button" data-act="open" data-chat="${esc(c.chatId || "")}"${c.chatId ? "" : ` disabled title="The chat appears once Claude has started"`}>Open chat</button><button class="btn small" type="button" data-act="skip">Skip this round</button></div>
${infoHTML(s)}</div>`;
    }
    let kicker = `Round ${s.iteration + 1}`, title, sub, warn = false, btn = "";
    if (s.status === "resting" && s.pause) {
      title = s.pause.text;
      sub = s.pause.kind === "gaming" ? "The next round starts when you're done playing." : "It carries on by itself after that.";
      btn = `<div class="row"><button class="btn small" type="button" data-act="anyway" title="Run one round now, past the pause">Run anyway</button></div>`;
    } else if (s.status === "resting") {
      title = s.restingUntil ? `Resting until ${clock(s.restingUntil)}` : "Resting";
      sub = s.lastError || "A short break before the next round.";
      warn = !!s.lastError;
      btn = `<div class="row"><button class="btn small" type="button" data-act="skip">Skip the wait</button></div>`;
    } else if (s.status === "reviewing") {
      kicker = `Round ${s.iteration}`; title = "Reviewing the round"; sub = s.boss ? `The boss is checking the work (it must reach ${s.boss}/10).` : "Saving what it did and learned.";
    } else {
      title = "Planning the next round"; sub = COPY[mode].planning;
    }
    return `<div class="card ap-cur"><div class="ap-cur-top"><span class="ap-kicker">${esc(kicker)}</span></div><h3>${esc(title)}</h3><p class="ap-sub${warn ? " warn" : ""}">${esc(sub)}</p>${btn}${infoHTML(s)}</div>`;
  }
  // "Session 53% · resets 6:49 am   Fable week 0%", plus today's count when a daily cap is on.
  function meterHTML(s) {
    const u = s.usage, pct = CAP_PCT[s.guard.cap] || 0, bits = [];
    for (const w of u ? u.windows : []) {
      const p = Math.max(0, Math.min(100, Math.round(Number(w.percent)))), reset = ts(w.resetsAt);
      const tip = `${w.label}: ${p}% used${reset != null ? `, resets ${full(reset)}` : ""}`;
      bits.push(`<span class="ap-mw${pct && p >= pct ? " over" : p >= 80 ? " hi" : ""}" title="${esc(tip)}">${esc(w.label)} <b>${p}%</b><span class="ap-bar"><i style="width:${p}%"></i></span>${w.group === "session" && reset != null ? `<span>resets ${esc(clock(reset))}</span>` : ""}</span>`);
    }
    if (!bits.length) bits.push(`<span class="ap-mw" title="${esc((u && u.error) || "Read from your Claude plan every few minutes")}">${u && u.error ? "Usage unknown right now" : "Reading usage…"}</span>`);
    const cap = CAP_DAY[s.guard.cap];
    if (cap) {
      const d = s.daily.day === localDay() ? s.daily : { rounds: 0, cost: 0 };
      bits.push(`<span class="ap-mw" title="Counted per day; resets at midnight">Today <b>${cap[1] === "usd" ? `$${d.cost.toFixed(2)}` : d.rounds}</b> of ${cap[1] === "usd" ? `$${cap[0]} est.` : `${cap[0]} rounds`}</span>`);
    }
    return bits.join("");
  }
  function localDay() { const d = new Date(); return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`; }
  function nextHTML(s) {
    return s.next.map((x) => `<div class="ap-idea"><div class="ap-idea-top"><b>${esc(x.title || x.prompt || "Idea")}</b>${focusChip(x.focus)}</div>${x.prompt ? `<p title="${esc(x.prompt)}">${esc(x.prompt)}</p>` : ""}<button class="btn small" type="button" data-act="promote" data-i="${x.i}"${typeof x.title === "string" ? ` data-title="${esc(x.title)}"` : ""}>Do this next</button></div>`).join("");
  }
  function entryHTML(mode, e) {
    const t = e.at ? `<span class="ap-t" data-at="${esc(e.at)}" title="${esc(full(e.at))}">${esc(when(e.at))}</span>` : "";
    const open = e.chatId ? `<button class="linkish ap-open" type="button" data-act="open" data-chat="${esc(e.chatId)}">Open chat</button>` : "";
    const n = e.n != null && e.n !== "" ? " " + esc(e.n) : "";
    // Working entries name their project's round cards (rounds-client.js shows them under "What it did").
    const card = typeof e.card === "string" && /^[a-z0-9][a-z0-9-]{0,79}$/.test(e.card) && e.n != null && e.n !== "" ? `<button class="linkish ap-open" type="button" data-act="roundcard" data-n="${esc(e.n)}" data-slug="${esc(e.card)}">Round card</button>` : "";
    const text = String(e.text || "");
    switch (e.type) {
      case "user":
        return `<div class="ap-e user"><div class="ap-bub">${esc(text)}</div>${t}</div>`;
      case "plan":
        return `<div class="ap-e plan"><span class="ap-av">${mascot(COPY[mode].mascot, COPY[mode].lead)}</span><div class="ap-body"><div class="ap-line"><b class="ap-x">Round${n} plan: ${esc(e.title || text)}</b>${focusChip(e.focus)}${t}</div>${text && text !== e.title ? `<p>${esc(text)}</p>` : ""}</div></div>`;
      case "start":
        return `<div class="ap-e start"><span class="ap-av ap-dot"></span><div class="ap-body"><div class="ap-line"><span class="ap-x">Started round${n}</span>${open}${t}</div></div></div>`;
      case "result":
        return `<div class="ap-e result"><span class="ap-av">${mascot("claude", "Claude")}</span><div class="ap-body"><div class="ap-line"><b class="ap-x">Round${n} finished${e.title ? ": " + esc(e.title) : ""}</b>${focusChip(e.focus)}${open}${card}${t}</div><div class="md">${md(text)}</div></div></div>`;
      case "boss": {
        const sc = Number(e.score), pass = e.pass === true, fix = arr(e.mustFix).filter((x) => typeof x === "string" && x);
        const verdict = pass ? "Passed" : e.redo ? "Sent back for a fix" : "Below the bar, let go";
        return `<div class="ap-e boss"><span class="ap-av ap-dot"></span><div class="ap-body"><div class="ap-line"><b class="ap-x">The boss on round${n}: <span class="ap-score ${pass ? "pass" : "fail"}">${Number.isFinite(sc) ? esc(sc) : "?"}/10</span> ${esc(verdict)}</b>${e.bar ? `<span class="ap-note-s">needs ${esc(e.bar)}</span>` : ""}${card}${t}</div>${text ? `<p>${esc(text)}</p>` : ""}${fix.length && !pass ? `<ol class="ap-fix">${fix.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>` : ""}</div></div>`;
      }
      case "error":
        return `<div class="ap-e error"><span class="ap-av ap-dot"></span><div class="ap-body"><div class="ap-line"><span class="ap-x">${esc(text)}</span>${open}${card}${t}</div></div></div>`;
      default:
        return `<div class="ap-e ${e.type === "system" ? "system" : "note"}"><span class="ap-av ap-dot"></span><div class="ap-body"><div class="ap-line"><span class="ap-x">${esc(text)}</span>${open}${t}</div></div></div>`;
    }
  }

  /* ---------- view ---------- */
  function build(mode) {
    const m = M[mode], c = COPY[mode], root = $(mode + "Root");
    if (m.built) return true;
    if (!root) return false;
    root.innerHTML = `
<div class="ap-scroll"><div class="ap-page">
  <header class="ap-head">
    <div class="ap-me bob">${mascot(c.mascot, c.lead)}</div>
    <div class="ap-title"><div class="row"><h1>${c.title}</h1><span class="ap-status" role="status" hidden><span></span></span></div><p>${esc(c.desc)}</p></div>
    <button class="btn ap-end" type="button" data-act="end" hidden></button>
  </header>
  <p class="ap-offline" hidden></p>
  <div class="ap-scene-wrap" hidden><canvas class="scene ap-scene" role="img" aria-label="${esc(c.scene)}"></canvas></div>
  <div class="ap-cur-slot"></div>
  <section class="stack ap-next-sec" hidden><h2 class="sec">Up next</h2><div class="ap-next"></div></section>
  <section class="stack"><h2 class="sec">Log</h2><div class="ap-feed"></div></section>
</div></div>
<footer class="ap-foot"><div class="ap-foot-in">
  <div class="ap-set">
    <label>Permissions <select data-set="perm">${opts(PERMS)}</select></label>
    <label>Model <select data-set="model">${opts(MODELS)}</select></label>
    ${mode === "training" ? `<span class="ap-subj-wrap"><button class="btn small" type="button" data-act="subjects" aria-expanded="false" title="Which kinds of things the agents practice">Practice: <span class="ap-subj-n">all subjects</span></button><div class="ap-subj" hidden role="group" aria-label="Subjects to practice"><p>Tick what the agents should practice. Nothing ticked: the Trainer picks. Applies from the next round.</p>${SUBJECTS.map(([k, n]) => `<label><input type="checkbox" data-subj="${k}"> ${esc(n)}</label>`).join("")}</div></span>` : ""}
    ${mode === "working" ? `<label>Project <select data-set="proj"><option value="">Loading folders…</option></select></label>` : ""}
  </div>
  <div class="ap-paused" role="status" hidden><span></span><button class="btn small" type="button" data-act="anyway" title="Run one round now, past the pause">Run anyway</button></div>
  <div class="ap-guard">
    <span class="ap-meter" aria-label="Your Claude plan's usage"></span>
    <span class="spacer"></span>
    <label class="ap-cap" title="A strict reviewer scores every finished round out of 10. Below this, the next round fixes its list (at most twice per task). Each check uses a little extra usage.">Boss <select data-set="boss">${opts(BOSS)}</select></label>
    <label class="ap-cap" title="Pauses ${esc(c.verb.toLowerCase())} before your plan's usage runs out, and carries on by itself after the reset">Usage cap <select data-set="cap">${opts(CAPS)}</select></label>
    <button class="btn small" type="button" data-act="guardmenu" aria-expanded="false" title="Quiet hours and gaming">More</button>
    <div class="ap-pop" hidden>
      <label><input type="checkbox" data-set="quiet"> Quiet hours: don't run from <select data-set="qfrom">${opts(HOURS)}</select> to <select data-set="qto">${opts(HOURS)}</select></label>
      <p>A round that's already running finishes first.</p>
      <label><input type="checkbox" data-set="gaming"> Pause while I'm gaming</label>
      <p>When Roblox or any fullscreen app is open. Checked at most once a minute; a running round finishes first.</p>
    </div>
  </div>
  <div class="compose-box">
    <textarea rows="2" aria-label="${c.verb} message"></textarea>
    <div class="compose-bar"><span class="ap-hint"></span><span class="spacer"></span><button class="sendbtn" type="button" data-act="send" aria-label="Send"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button></div>
  </div>
  <div class="ap-err" role="alert" hidden></div>
  <p class="ap-note">${esc(NOTE)}${mode === "working" ? " " + esc(GIT_NOTE) : ""}</p>
</div></footer>`;
    const q = (s) => root.querySelector(s);
    m.els = { status: q(".ap-status"), statusText: q(".ap-status span"), end: q(".ap-end"), offline: q(".ap-offline"), sceneWrap: q(".ap-scene-wrap"), canvas: q(".ap-scene"),
      cur: q(".ap-cur-slot"), nextSec: q(".ap-next-sec"), next: q(".ap-next"), feed: q(".ap-feed"), set: q(".ap-set"), perm: q('[data-set="perm"]'),
      model: q('[data-set="model"]'), proj: q('[data-set="proj"]'), ta: q("textarea"), hint: q(".ap-hint"), send: q(".sendbtn"), err: q(".ap-err"),
      paused: q(".ap-paused"), pausedText: q(".ap-paused span"), meter: q(".ap-meter"), cap: q('[data-set="cap"]'), more: q('[data-act="guardmenu"]'), pop: q(".ap-pop"),
      quiet: q('[data-set="quiet"]'), qfrom: q('[data-set="qfrom"]'), qto: q('[data-set="qto"]'), gaming: q('[data-set="gaming"]'), boss: q('[data-set="boss"]') };
    // The boss's bar saves as soon as it changes, idle or running (from the next round).
    m.els.boss.addEventListener("change", () => {
      const my = ++m.bossSeq; m.bossBusy = true;
      post(mode, "settings", { boss: Number(m.els.boss.value) }).then(() => toast("Boss", Number(m.els.boss.value) ? `Every round must reach ${m.els.boss.value}/10.` : "The boss is off."), (err) => toast("Couldn't change the boss", err.message))
        .finally(() => { if (my === m.bossSeq) { m.bossBusy = false; syncGuard(mode); } });
    });
    root.addEventListener("click", (e) => onClick(mode, e));
    // Guard settings save as soon as they change, idle or running.
    for (const k of ["cap", "quiet", "qfrom", "qto", "gaming"]) m.els[k].addEventListener("change", () => saveGuard(mode));
    document.addEventListener("click", (e) => { if (!m.els.pop.hidden && !(e.target.closest && e.target.closest(".ap-guard"))) showPop(mode, false); });
    root.addEventListener("keydown", (e) => { if (e.key === "Escape" && !m.els.pop.hidden) { showPop(mode, false); m.els.more.focus(); } });
    m.els.ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(mode); } });
    m.els.ta.addEventListener("input", () => { grow(m.els.ta); showErr(mode, ""); });
    m.els.feed.addEventListener("scroll", () => { m.stick = nearBottom(m.els.feed); });
    for (const k of ["perm", "model", "proj"]) if (m.els[k]) m.els[k].addEventListener("change", () => { m.touched[k] = true; });
    // A model picked while it runs applies from the next round.
    m.els.model.addEventListener("change", () => { if (m.state && m.state.active) post(mode, "settings", { model: m.els.model.value || null }).then(() => toast("Model changed", "From the next round."), (err) => toast("Couldn't change the model", err.message)); });
    // Subjects to practice (Training): saved as soon as they change, idle or running.
    const subj = root.querySelector(".ap-subj");
    if (subj) {
      subj.addEventListener("change", () => { m.subjBusy = true; const list = [...subj.querySelectorAll("[data-subj]:checked")].map((x) => x.dataset.subj); drawSubjects(mode, list);
        post(mode, "settings", { subjects: list }).catch((err) => toast("Couldn't save the subjects", err.message)).finally(() => { m.subjBusy = false; }); });
      document.addEventListener("click", (e) => { if (!subj.hidden && !(e.target.closest && e.target.closest(".ap-subj-wrap"))) { subj.hidden = true; root.querySelector("[data-act=subjects]").setAttribute("aria-expanded", "false"); } });
    }
    m.built = true;
    render(mode);
    return true;
  }
  function render(mode) {
    const m = M[mode];
    if (!m.built) return;
    const e = m.els, c = COPY[mode], s = m.state || norm(mode, null);
    const label = statusText(mode, s);
    e.status.hidden = !m.state;
    e.statusText.textContent = label; e.status.title = label;
    e.status.className = "ap-status" + (s.status === "resting" ? " rest" : s.status === "stopping" ? " stop" : s.active || ["planning", "running", "reviewing"].includes(s.status) ? " on" : "");
    drawEnd(mode);
    e.offline.hidden = !m.err; e.offline.textContent = m.err;
    setHTML(e.cur, curHTML(mode, s));
    e.nextSec.hidden = !s.next.length;
    setHTML(e.next, nextHTML(s));
    drawFeed(mode, s);
    e.set.hidden = s.active;
    e.ta.placeholder = s.active ? c.activePh : c.placeholder;
    e.hint.textContent = s.active ? `Messages steer the next round.${s.directives.length ? ` ${s.directives.length} waiting.` : ""}` : c.startHint;
    e.send.title = s.active ? "Send (Enter)" : `Start ${mode} (Enter)`;
    const paused = s.active && s.status === "resting" && s.pause;
    e.paused.hidden = !paused;
    e.pausedText.textContent = paused ? s.pause.text : "";
    setHTML(e.meter, meterHTML(s));
    syncSettings(mode);
    syncGuard(mode);
    if (!M[mode].subjBusy && M[mode].state) drawSubjects(mode, M[mode].state.subjects || []);
    pushScene(mode);
    tick(mode);
  }
  function drawEnd(mode) {
    const m = M[mode], b = m.els.end, active = !!(m.state && m.state.active);
    b.hidden = !active && !m.ending;
    b.disabled = m.ending;
    b.classList.toggle("armed", m.armed && !m.ending);
    b.textContent = m.ending ? "Ending…" : m.armed ? "Click again to end" : COPY[mode].end;
  }
  function drawFeed(mode, s) {
    const m = M[mode], f = m.els.feed;
    const sig = s.log.map((x) => `${x.id}:${x.chatId || ""}`).join(",");
    if (sig === m.feedSig) return;
    m.feedSig = sig;
    f.innerHTML = s.log.length ? s.log.map((x) => entryHTML(mode, x)).join("") : `<p class="ap-empty">${esc(COPY[mode].empty)}</p>`;
    if (m.stick) f.scrollTop = f.scrollHeight;
  }
  // Live elapsed time every second; the "5 min ago" labels only twice a minute.
  function tick(mode) {
    const m = M[mode];
    if (!m.built) return;
    const el = m.els.cur.querySelector("[data-since]");
    if (el) el.textContent = dur(Date.now() - Number(el.dataset.since));
    if (++m.ticks % 30 === 0) m.els.feed.querySelectorAll("[data-at]").forEach((x) => { x.textContent = when(x.dataset.at); });
  }
  // The ticked subjects and the button's summary ("all subjects", one name, or "3 subjects").
  function drawSubjects(mode, list) {
    const root = M[mode].els && M[mode].els.set; if (!root) return;
    for (const x of root.querySelectorAll("[data-subj]")) x.checked = list.includes(x.dataset.subj);
    const n = root.querySelector(".ap-subj-n"); if (!n) return;
    n.textContent = !list.length ? "all subjects" : list.length === 1 ? (SUBJECTS.find(([k]) => k === list[0]) || [, list[0]])[1] : `${list.length} subjects`;
  }
  function syncSettings(mode) {
    const m = M[mode], e = m.els, s = m.state;
    if (!s || s.active) return;
    // Permissions always default to Safe; the model and project follow the last run until the user picks.
    if (!m.touched.model) e.model.value = MODELS.some(([v]) => v === s.model) ? s.model : "";
    if (e.proj && !m.touched.proj && m.projects.length) e.proj.value = pickProject(m);
  }
  // The server's guard settings into the controls, unless a change of the user's is still on its way.
  function syncGuard(mode) {
    const m = M[mode], e = m.els, s = m.state;
    if (!s) return;
    if (!m.bossBusy) e.boss.value = String(s.boss);
    if (m.guardBusy) return;
    const g = s.guard;
    e.cap.value = g.cap; e.quiet.checked = g.quiet.on; e.qfrom.value = String(g.quiet.from); e.qto.value = String(g.quiet.to); e.gaming.checked = g.gaming;
    e.qfrom.disabled = e.qto.disabled = !g.quiet.on;
  }
  async function saveGuard(mode) {
    const m = M[mode], e = m.els;
    const body = { cap: e.cap.value, quiet: { on: e.quiet.checked, from: Number(e.qfrom.value), to: Number(e.qto.value) }, gaming: e.gaming.checked };
    e.qfrom.disabled = e.qto.disabled = !body.quiet.on;
    const my = ++m.guardSeq;
    m.guardBusy = true;
    try { await post(mode, "settings", body); }
    catch (err) { toast("Couldn't save that setting", err.message); }
    if (my === m.guardSeq) { m.guardBusy = false; syncGuard(mode); }
  }
  function showPop(mode, on) {
    const e = M[mode].els;
    e.pop.hidden = !on;
    e.more.setAttribute("aria-expanded", on ? "true" : "false");
  }
  function pickProject(m) {
    const s = m.state, lc = (x) => String(x || "").toLowerCase();
    const last = s && s.project && m.projects.find((p) => lc(p.dir) === lc(s.project.dir));
    return (last || m.projects[0] || {}).dir || "";
  }
  async function loadProjects(mode) {
    const m = M[mode], sel = m.els.proj;
    if (!sel || m.projLoading) return;
    m.projLoading = true;
    let list = null;
    try { list = await api("/api/projects"); } catch {}
    m.projLoading = false;
    const ok = Array.isArray(list) ? list.filter((p) => p && typeof p.dir === "string" && p.dir) : null;
    if (!ok || !ok.length) {
      if (!m.projects.length) sel.innerHTML = `<option value="">${ok ? "No project folders found" : "Can't load project folders"}</option>`;
      return;
    }
    const keep = m.touched.proj ? sel.value : "";
    m.projects = ok.map((p) => ({ dir: p.dir, name: String(p.name || p.dir.split(/[\\/]/).pop() || p.dir) }));
    sel.innerHTML = m.projects.map((p) => `<option value="${esc(p.dir)}" title="${esc(p.dir)}">${esc(p.name)}</option>`).join("");
    sel.value = keep && m.projects.some((p) => p.dir === keep) ? keep : pickProject(m);
  }
  function mountScene(mode) {
    const m = M[mode];
    if (m.scene || !m.built) return;
    if (!window.Pixel || !Pixel.scenes || !Pixel.scenes[mode]) { m.els.sceneWrap.hidden = true; return; }
    m.els.sceneWrap.hidden = false;
    try { m.scene = Pixel.mount(m.els.canvas, mode); }
    catch (err) { console.error("scene " + mode, err); m.els.sceneWrap.hidden = true; return; }
    pushScene(mode);
  }
  function pushScene(mode) {
    const m = M[mode], s = m.state, c = s && s.current;
    if (!m.scene || !s) return;
    try {
      m.scene.update({ active: s.active, phase: phase(mode, s.status), focus: (c && c.focus) || null, agents: c ? c.agents : [],
        iteration: c && c.n != null ? c.n : s.iteration, title: (c && c.title) || "", project: s.project ? s.project.name : "" });
    } catch (err) { console.error("scene " + mode, err); }
  }
  function setDot(mode, on) { const d = $(COPY[mode].dot); if (d) d.hidden = !on; }
  function showErr(mode, text) { const e = M[mode].els.err; if (!e) return; e.hidden = !text; e.textContent = text || ""; }

  /* ---------- server ---------- */
  function apply(mode, r) {
    const m = M[mode];
    if (!obj(r) || r.error) m.err = r && r.error ? `Couldn't load ${COPY[mode].title}: ${r.error}` : OFFLINE;
    else { m.err = ""; m.state = norm(mode, r); setDot(mode, m.state.active); }
    render(mode);
  }
  async function refresh(mode) {
    const m = M[mode], my = ++m.seq;
    let r;
    try { r = await api("/api/autopilot/" + mode); }
    catch { if (my === m.seq) { m.err = OFFLINE; render(mode); } return; }
    if (my === m.seq) apply(mode, r);
  }
  async function post(mode, path, body) {
    M[mode].seq++; // answers to GETs sent before this are now stale
    let r;
    try { r = await api(`/api/autopilot/${mode}/${path}`, { method: "POST", body: JSON.stringify(body || {}) }); }
    catch { throw new Error(OFFLINE + "."); }
    if (!obj(r)) throw new Error(OFFLINE + ".");
    if (r.error) throw new Error(String(r.error));
    apply(mode, r);
  }
  async function act(mode, path, body, fail, btn) {
    if (btn) btn.disabled = true;
    try { await post(mode, path, body); }
    catch (err) { toast(fail, err.message); refresh(mode); }
    if (btn) btn.disabled = false;
  }
  async function send(mode) {
    const m = M[mode], e = m.els, text = e.ta.value.trim();
    if (!text || m.sending) { e.ta.focus(); return; }
    const active = !!(m.state && m.state.active);
    let body = { text };
    if (!active) {
      body = { goal: text, permission: e.perm.value === "full" ? "full" : "safe", model: e.model.value || null,
        ...(mode === "training" && e.set ? { subjects: [...e.set.querySelectorAll("[data-subj]:checked")].map((x) => x.dataset.subj) } : {}) };
      if (mode === "working") {
        if (!e.proj.value) { showErr(mode, "Pick a project folder first."); return; }
        body.project = e.proj.value;
      }
    }
    m.sending = true; e.send.disabled = true; showErr(mode, "");
    try {
      await post(mode, active ? "message" : "start", body);
      e.ta.value = ""; grow(e.ta);
      m.stick = true; e.feed.scrollTop = e.feed.scrollHeight;
    } catch (err) { showErr(mode, err.message); }
    m.sending = false; e.send.disabled = false;
  }
  function end(mode) {
    const m = M[mode];
    if (m.ending) return;
    clearTimeout(m.armTimer);
    if (!m.armed) {
      m.armed = true;
      m.armTimer = setTimeout(() => { m.armed = false; drawEnd(mode); }, 4000);
      drawEnd(mode);
      return;
    }
    m.armed = false; m.ending = true; drawEnd(mode);
    act(mode, "stop", {}, `Couldn't ${COPY[mode].end.toLowerCase()}`).then(() => { m.ending = false; drawEnd(mode); });
  }
  function onClick(mode, e) {
    const b = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
    if (!b || b.disabled) return;
    const a = b.dataset.act;
    if (a === "send") send(mode);
    else if (a === "end") end(mode);
    else if (a === "skip") act(mode, "skip", {}, "Couldn't skip", b);
    else if (a === "anyway") act(mode, "anyway", {}, "Couldn't run a round now", b);
    else if (a === "guardmenu") showPop(mode, M[mode].els.pop.hidden);
    else if (a === "subjects") { const p = b.parentElement.querySelector(".ap-subj"); p.hidden = !p.hidden; b.setAttribute("aria-expanded", String(!p.hidden)); }
    // The title goes along so the server can tell if a new plan put another idea at that index since this was drawn.
    else if (a === "promote") act(mode, "promote", { index: Number(b.dataset.i), ...(b.dataset.title !== undefined ? { title: b.dataset.title } : {}) }, "Couldn't move that idea up", b);
    else if (a === "roundcard" && window.HiveRounds) HiveRounds.show(Number(b.dataset.n), b.dataset.slug);
    else if (a === "open" && b.dataset.chat && typeof openSession === "function") {
      Promise.resolve().then(() => openSession(b.dataset.chat)).catch(() => toast("Couldn't open the chat", OFFLINE + "."));
    }
  }

  /* ---------- lifecycle ---------- */
  function enter(mode) {
    const m = M[mode];
    if (!build(mode)) return;
    mountScene(mode);
    refresh(mode);
    if (mode === "working") loadProjects(mode); // every visit: folders added since show up (the user's pick is kept)
    if (!m.poll) m.poll = setInterval(() => refresh(mode), 10000);
    if (!m.clock) m.clock = setInterval(() => tick(mode), 1000);
    if (m.stick) m.els.feed.scrollTop = m.els.feed.scrollHeight;
  }
  function leave(mode) {
    const m = M[mode];
    clearInterval(m.poll); clearInterval(m.clock); clearTimeout(m.deb);
    m.poll = m.clock = 0;
    if (m.armed) { m.armed = false; clearTimeout(m.armTimer); drawEnd(mode); }
  }
  window.addEventListener("hive:view", (e) => {
    const v = e.detail && e.detail.view;
    for (const mode of MODES) { if (v === mode) enter(mode); else leave(mode); }
  });
  window.addEventListener("hive:server", (e) => {
    const ev = e.detail || {};
    if (ev.t === "autopilot" && MODES.includes(ev.mode)) {
      if (ev.state && typeof ev.state.active === "boolean") setDot(ev.mode, ev.state.active);
      if (visible(ev.mode)) { const m = M[ev.mode]; clearTimeout(m.deb); m.deb = setTimeout(() => refresh(ev.mode), 300); }
    } else if (ev.t === "usage" && obj(ev.usage)) {
      // A fresh usage reading (usage.js): just the meter, no refetch.
      for (const mode of MODES) { const m = M[mode]; if (m.state) { m.state.usage = normUsage(ev.usage); if (m.built) setHTML(m.els.meter, meterHTML(m.state)); } }
    } else if (ev.t === "hello") MODES.forEach(refresh); // back online: the dots may be stale
  });
  // Both modes once at load, so the nav dots are right even before either tab is opened.
  for (const mode of MODES) { if (visible(mode)) enter(mode); else refresh(mode); }
})();
