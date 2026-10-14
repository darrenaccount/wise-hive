/* Chat options that save usage (2026-10-13). Three controls, all optional:
   1. Clarifier and Inventor on/off: a "Helpers" button next to their icons in the chat's top-right corner opens a
      dropdown with a checkbox for each (clicking a helper's own icon still shows its results). Off means
      that helper doesn't run on your next prompts (the Clarifier won't check them, the Inventor won't run after
      replies); you can still open either panel and ask by hand. Remembered on this PC until you switch it back.
   2. Usage saver (Extras): with the model left on "Default", each prompt goes to the cheapest model that fits it:
      Haiku for quick questions and small asks, Sonnet for normal work, Opus only for hard multi-step building,
      debugging, design, Blender or Studio work. A model you pick yourself always wins. Free: a few text rules, no
      Claude run. A small toast says which model it picked.
   3. Agents (Extras): one agent (default), a team (the old "Team of agents"), or a team of cheaper helpers that hands
      parts of the work to subagents on Haiku/Sonnet and keeps planning and checking itself (server.js teamNote).
   The page code asks window.HiveChatOpts: helperOn(name), model(text, attachments), team(). */
(function () {
  "use strict";
  if (typeof $ !== "function" || typeof mascot !== "function") return;
  const KEY = { helpers: "hive-helpers", saver: "hive-saver", agents: "hive-agents" };
  const load = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  // The Clarifier and Inventor start off when the app opens and in every new chat (freshChat() in app.js calls helpersOff);
  // the user switches them on for the chat they are in.
  const helpers = { clarifier: false, inventor: false };
  let saver = load(KEY.saver, false) === true;
  let agents = ["one", "team", "cheap"].includes(load(KEY.agents, "")) ? load(KEY.agents, "") : ($("team") && $("team").checked ? "team" : "one");

  const style = document.createElement("style");
  style.textContent = `
.hp-bar{position:absolute;top:10px;right:132px;z-index:7}
.convo.clar-open .hp-bar,.convo.ideas-open .hp-bar{right:450px}
@media (max-width:1100px){.convo.clar-open .hp-bar,.convo.ideas-open .hp-bar{display:none}}
.hp-btn{all:unset;box-sizing:border-box;cursor:pointer;display:flex;align-items:center;gap:6px;height:34px;padding:0 10px;border:1px solid var(--line);border-radius:12px;background:var(--surface);font:600 12px var(--f-display);color:var(--ink)}
.hp-btn:hover{border-color:var(--muted)}
.hp-btn:focus-visible{outline:2px solid var(--claude);outline-offset:2px}
.hp-btn .hp-n{font:11px var(--f-mono);color:var(--muted)}
.hp-pop{position:absolute;top:40px;right:0;width:280px;background:var(--surface);border:1px solid var(--line);border-radius:12px;box-shadow:0 12px 30px rgba(0,0,0,.45);padding:8px;display:flex;flex-direction:column;gap:4px}
.hp-pop .hp-title{font:600 12px var(--f-display);color:var(--muted);padding:2px 6px 4px}
.hp-row{display:grid;grid-template-columns:auto 26px 1fr;gap:4px 8px;align-items:center;padding:6px;border-radius:8px;cursor:pointer}
.hp-row:hover{background:var(--sunk)}
.hp-row input{margin:0;accent-color:var(--claude)}
.hp-row .hp-ic{width:26px;display:block}
.hp-row b{font:600 13px var(--f-display)}
.hp-row small{grid-column:3;color:var(--muted);font-size:12px;line-height:1.35}
.hp-row:has(input:not(:checked)) .hp-ic{opacity:.4;filter:grayscale(1)}
.hp-pop .hp-foot{font-size:11.5px;color:var(--muted);padding:4px 6px 2px}`;
  document.head.appendChild(style);

  /* ---------- 1. helpers dropdown ---------- */
  // One "Helpers" button left of the Inventor and Clarifier icons (their icons still open their results). Its
  // dropdown turns each helper on or off for your next prompts; the choice is remembered on this PC.
  const convo = document.querySelector("#v-chats .convo") || ($("clarAv") && $("clarAv").parentElement);
  const NAMES = { clarifier: ["Clarifier", "Checks each prompt for misunderstandings before Claude starts."], inventor: ["Inventor", "Gives Claude's take and next ideas after each reply."] };
  const bar = document.createElement("div");
  bar.className = "hp-bar";
  bar.innerHTML = `<button class="hp-btn" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="hpPop" title="Turn the prompt helpers on or off">Helpers <span class="hp-n"></span> ▾</button>
<div class="hp-pop" id="hpPop" hidden role="group" aria-label="Prompt helpers"><div class="hp-title">Prompt helpers</div>${["clarifier", "inventor"].map((k) => `<label class="hp-row"><input type="checkbox" data-k="${k}"><span class="hp-ic">${mascot(k, NAMES[k][0])}</span><b>${NAMES[k][0]}</b><small>${NAMES[k][1]}</small></label>`).join("")}<div class="hp-foot">Off saves usage: that helper doesn't run on your next prompts. Click a helper's icon to see what it found.</div></div>`;
  const hpBtn = bar.querySelector(".hp-btn"), hpPop = bar.querySelector(".hp-pop"), hpN = bar.querySelector(".hp-n");
  function drawSwitches() {
    for (const box of hpPop.querySelectorAll("input[data-k]")) box.checked = helpers[box.dataset.k] !== false;
    const on = ["clarifier", "inventor"].filter((k) => helpers[k] !== false).length;
    hpN.textContent = on === 2 ? "all on" : on === 0 ? "all off" : "1 on";
  }
  const openPop = (open) => { hpPop.hidden = !open; hpBtn.setAttribute("aria-expanded", String(open)); };
  hpBtn.addEventListener("click", (e) => { e.stopPropagation(); openPop(hpPop.hidden); });
  hpPop.addEventListener("click", (e) => e.stopPropagation());
  hpPop.addEventListener("change", (e) => { const k = e.target.dataset && e.target.dataset.k; if (!k) return; helpers[k] = e.target.checked; drawSwitches(); });
  document.addEventListener("click", () => { if (!hpPop.hidden) openPop(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !hpPop.hidden) { openPop(false); hpBtn.focus(); } });
  if (convo) { convo.appendChild(bar); drawSwitches(); }

  /* ---------- 2. usage saver: pick the cheapest model that fits ---------- */
  const HAIKU = "claude-haiku-5-5", SONNET = "claude-sonnet-5-5", OPUS = "claude-opus-5-5";
  const NAME = { [HAIKU]: "Haiku 5.5", [SONNET]: "Sonnet 5.5", [OPUS]: "Opus 5.5" };
  // Hard: multi-step building, debugging, design, 3D/Studio work, or a long brief.
  const HARD = /\b(build|implement|refactor|architect\w*|redesign|rewrite|migrat\w*|optimi[sz]\w*|blender|3d|rig|rigging|animat\w*|roblox studio|multi[- ]?file|end[- ]to[- ]end|algorithm|from scratch|full (app|game|system|feature)|whole (app|game|project))\b|\b(design|plan|create|make|add|code)\b.{0,40}\b(system|engine|pipeline|api|database|framework|architecture|multiplayer|economy|save system|inventory)\b|\bfix\b.{0,40}\b(crash|exception|leak|race|corrupt\w*)\b/i;
  // Changes something (code, files, the game): never Haiku.
  const DOES = /^(please\s+)?(add|make|change|update|fix|create|remove|delete|move|implement|write|code|refactor|set up|setup|install|replace|improve|tweak|adjust|edit|build|turn|wire|hook|connect)\b|\b(script|code|function|bug|error|crash|slow|broken|not working|fails?|lag\w*)\b/i;
  // Easy: a question or a small conversational ask.
  const EASY = /^(what|who|when|where|which|why|how (do|does|can|much|many|long|is|are)|is|are|does|do|did|can|could|should|define|explain|summari[sz]e|list|translate|spell|rename|convert|format|reword|rephrase|tell me|show me|remind|thanks|thank you|ok|okay|yes|no|sure|nice|cool|great)\b/i;
  function pick(text, atts) {
    const t = String(text || "").trim(), files = (atts || []).length, code = /```|\b(function|const|let|class|def|local|end)\b.*[({=]/.test(t);
    if (t.length > 1200 || HARD.test(t)) return { model: OPUS, why: "a bigger build, debug or design task" };
    if (!files && !code && t.length <= 220 && !DOES.test(t) && (EASY.test(t) || t.split(/\s+/).length <= 6)) return { model: HAIKU, why: "a quick question or small ask" };
    return { model: SONNET, why: "everyday work" };
  }
  // The model for one send: a model chosen in Settings always wins; with the saver on and "Default" chosen, the pick.
  function model(text, atts) {
    const chosen = $("model") ? $("model").value : "";
    if (chosen || !saver) return chosen || undefined;
    const p = pick(text, atts);
    if (typeof toast === "function") toast(`Usage saver: ${NAME[p.model]}`, `Picked for ${p.why}. Choose a model in settings to override.`);
    return p.model;
  }

  /* ---------- 3. agents: one, a team, or a team of cheaper helpers ---------- */
  const team = () => (agents === "cheap" ? "cheap" : agents === "team");

  /* ---------- Extras popover controls ---------- */
  const pop = $("extrasPop"), teamBox = $("team");
  if (pop && teamBox) {
    const label = teamBox.closest("label"), help = label && label.nextElementSibling;
    if (label) label.hidden = true; if (help && help.classList.contains("opt-help")) help.hidden = true;
    const wrap = document.createElement("div");
    wrap.className = "stack";
    wrap.innerHTML = `<label for="agentsPick">Agents</label>
<select id="agentsPick"><option value="one">One agent</option><option value="team">Team of agents</option><option value="cheap">Team of cheaper helpers</option></select>
<p class="opt-help" id="agentsHelp"></p>
<label class="toggle"><input type="checkbox" id="saverBox"> Usage saver</label>
<p class="opt-help">With the model on Default, each prompt goes to the cheapest model that fits it: Haiku for quick questions, Sonnet for normal work, Opus only for hard building, debugging and design.</p>`;
    pop.appendChild(wrap);
    const sel = wrap.querySelector("#agentsPick"), saverBox = wrap.querySelector("#saverBox"), agentsHelp = wrap.querySelector("#agentsHelp");
    const homeBox = $("homeTeam"); // Home's "Team of agents" box: shows and sets the same choice
    const HELP = { one: "One Claude does the whole task (cheapest for small and medium tasks).", team: "Splits big tasks between a Researcher, a Builder and a Critic on the same model.", cheap: "Hands parts of big tasks to subagents on cheaper models (Haiku for searching and reading, Sonnet for building) and keeps the planning and checking itself." };
    const sync = () => {
      sel.value = agents; saverBox.checked = saver; agentsHelp.textContent = HELP[agents];
      teamBox.checked = agents !== "one"; // old code reads the checkbox (summary pill, home screen)
      if (homeBox) homeBox.checked = agents !== "one"; // so Start chat's copy into #team keeps this choice
      if (typeof drawOptsSummary === "function") drawOptsSummary();
    };
    sel.addEventListener("change", () => { agents = sel.value; save(KEY.agents, agents); sync(); });
    saverBox.addEventListener("change", () => { saver = saverBox.checked; save(KEY.saver, saver); sync(); });
    // Ticking Home's box keeps a saved cheaper team; unticking it means one agent.
    if (homeBox) homeBox.addEventListener("change", () => { agents = homeBox.checked ? (agents === "one" ? "team" : agents) : "one"; save(KEY.agents, agents); sync(); });
    // The hidden #team box follows the choice; a real change to it is followed back.
    teamBox.addEventListener("change", () => { if (teamBox.checked && agents === "one") agents = "team"; if (!teamBox.checked) agents = "one"; save(KEY.agents, agents); sync(); });
    sync();
  }

  window.HiveChatOpts = {
    helperOn: (k) => helpers[k] === true,
    helpersOff: () => { helpers.clarifier = helpers.inventor = false; drawSwitches(); },
    model, team, pick,
    summary: () => [saver && !($("model") && $("model").value) ? "Saver" : "", agents === "cheap" ? "Cheap team" : agents === "team" ? "Team" : ""].filter(Boolean),
  };
  if (typeof drawOptsSummary === "function") drawOptsSummary();
})();
