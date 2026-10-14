/* Tutorial tab: a short tour of The Wise Hive. One card per tab (icon cloned from the nav rail so it stays in sync), a
   "Start here" list and a few tips. First run: a gold dot on the Tutorial button and a one-line tip on Home until the
   tour is opened or the tip dismissed (localStorage "hive-tutorial-seen"). All text is static; nothing calls the API. */
(function () {
  "use strict";
  const KEY = "hive-tutorial-seen";
  const seen = () => { try { return !!localStorage.getItem(KEY); } catch { return true; } };
  const setSeen = (on) => { try { if (on) localStorage.setItem(KEY, "1"); else localStorage.removeItem(KEY); } catch {} };

  const style = document.createElement("style");
  style.textContent = `
#tutDot{background:var(--gold)}
.tu-me{width:64px;flex:none}
.tu-steps{margin:0;padding:0;list-style:none;counter-reset:tu;display:flex;flex-direction:column;gap:8px}
.tu-steps li{counter-increment:tu;display:flex;gap:10px;align-items:baseline}
.tu-steps li::before{content:counter(tu);flex:none;width:22px;height:22px;border-radius:6px;background:var(--claude-soft);color:var(--claude);font:700 13px/22px var(--f-display);text-align:center}
.tu-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;align-items:start}
.tu-card{display:flex;flex-direction:column;gap:8px;padding:14px}
.tu-card.open{border-color:color-mix(in srgb,var(--claude) 45%,var(--line))}
.tu-top{display:flex;align-items:center;gap:10px}
.tu-ic{width:34px;height:34px;flex:none;border-radius:9px;background:var(--sunk);color:var(--claude);display:grid;place-items:center}
.tu-ic svg{width:20px;height:20px}
.tu-top b{font-family:var(--f-display);font-size:16px;display:block}
.tu-top small{color:var(--muted);font-size:13px;line-height:1.35;display:block;min-height:2.7em}
.tu-how{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:4px;font-size:14px}
.tu-how b{color:var(--ink)}
.tu-acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:auto}
.tu-tips{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:5px;font-size:14px}
.tu-nudge{width:min(680px,100%);display:flex;align-items:center;gap:10px;padding:10px 14px;border-color:color-mix(in srgb,var(--gold) 40%,var(--line))}
.tu-nudge .tu-av{width:30px;flex:none}
.tu-nudge span{flex:1;min-width:0;font-size:14px}`;
  document.head.appendChild(style);

  // name, nav view, one-line purpose, how-to steps (HTML: static strings only, <b> marks real button labels).
  const TABS = [
    ["Home", "home", "Start a task in one line.", [
      "Type in “Describe a task…” and pick the project folder.",
      "Optional: turn on “Team of agents” or change how the Refiner treats your prompt.",
      "Click <b>Start chat</b> (or press Enter).",
      "Click any Claude in the castle to see what it does.",
      "Away for an hour or more? A “While you were away” card sums it up. <b>Dismiss</b> hides it."]],
    ["Chats", "chats", "Talk to Claude and find every past chat.", [
      "<b>New chat</b> starts fresh. <b>Search chats</b> finds old ones (3+ letters also searches inside them).",
      "The paperclip attaches files (pasting or dropping works too). The settings pill sets Permissions, Model and Effort.",
      "The “+” pill (it reads “+ Refine &amp; check” at first) has the Refiner, “Browse with Chrome” and “Team of agents”.",
      "When Claude asks: <b>Allow</b>, <b>Always allow in this chat</b> or <b>Deny</b>. For questions, pick or type, then <b>Answer</b>. If you're away, Claude goes with its best guess after 15 minutes.",
      "The teal Clarifier and the lightbulb Inventor sit beside the chat with questions and ideas."]],
    ["Council", "council", "Get a quick verdict on an idea.", [
      "Pitch your idea and click <b>Convene the council</b>.",
      "Pick who sits: <b>+ Add seat</b>, click a seat to swap it, <b>×</b> to remove it (1 to 7 seats; Lite 5). Each seat is one more Claude run, so the classic three (Believer, Skeptic, Investor) is the default. Your seats are remembered.",
      "The seats argue it out. The Judge rules PURSUE, PIVOT or PASS with a score out of 10.",
      "After a verdict, <b>Swap</b> on a seat's card or <b>+ Hear one more seat</b> lets a different voice speak on the same idea, and the Judge rules again (2 runs).",
      "Disagree? Type in “Push back or ask the Judge” and click <b>Ask</b>."]],
    ["Library", "library", "Everything the hive remembers.", [
      "<b>Tidy the library</b> files lessons from new chats. <b>Organize the folders</b> sorts the files.",
      "Memories: search, click a card, then <b>Edit</b> and <b>Save</b>.",
      "The other sections: Skills &amp; lessons, Conversations, Prompts and Health."]],
    ["Link", "link", "Talk to a chat in the Claude desktop app.", [
      "First fill in “Desktop chat name” and click <b>Save</b>.",
      "Type a message, tick “Send as a task to do” if it's a job, and click <b>Send</b> (Ctrl+Enter).",
      "“Open the chat it started” jumps to it. The badge shows new replies."]],
    ["Activity", "activity", "What's running, and what needs you.", [
      "“Needs you” lists approvals and questions waiting. The badge on the tab counts them.",
      "Below: Working now, Background agents and Finished recently.",
      "<b>Open chat</b> jumps in. <b>Stop</b> ends a run.",
      "The panel on the right of every tab shows the same jobs live, with their agents, and turns amber or red when one goes quiet."]],
    ["Projects", "projects", "Your folders and their chats.", [
      "One card per folder, with its recent chats.",
      "<b>New chat here</b> starts a chat in that folder.",
      "<b>Project notes</b> shows what the hive has written down about that project, if anything."]],
    ["Sketch", "sketch", "Draw it, and Claude reads it.", [
      "Pick a tool: Pen, Line, Arrow, Rectangle, Ellipse, Text, Eraser (keys P L A R E T X). Ctrl+Z undoes.",
      "Add a name and a note, then click <b>Show Claude</b>.",
      "<b>Use in a new chat</b> sends the sketch to a chat. Old ones are under “Past sketches”."]],
    ["Brainstorm", "brainstorm", "Think an idea through before building it.", [
      "Type a rough idea in “What do you want to brainstorm?” and press Enter.",
      "The Brainstormer searches the web and your notes, offers directions and says where the idea is weak. It never builds or changes anything.",
      "When the idea takes shape (or when you ask), it writes a plan. Plans are kept under “Saved brainstorm plans”.",
      "<b>Open</b> reads a plan, <b>Continue</b> picks the talk back up, <b>Delete</b> removes it (click twice). <b>New brainstorm</b> starts fresh."]],
    ["Training", "training", "Claude practices skills non-stop.", [
      "Pick Permissions and Model, type a goal and send it.",
      "Send more messages any time to steer it.",
      "Each round: <b>Open chat</b> to watch, or <b>Skip this round</b>.",
      "<b>Usage cap</b> pauses it at 97% by default. <b>More</b> has quiet hours and “Pause while I'm gaming”.",
      "<b>Style</b> (next to Model) picks the Taste style for the next rounds, or lets Claude pick one that fits. What Training makes waits in the <b>Taste</b> tab.",
      "<b>End training</b> stops it (click twice)."]],
    ["Working", "working", "Claude improves a real project non-stop.", [
      "Pick the Project, Permissions and Model, type a goal and send it.",
      "“Up next” shows the plan. <b>Do this next</b> moves a task to the front.",
      "“What it did” has a card per round: summary, pictures (click to enlarge), what changed, how to undo it, and <b>Open chat</b>. <b>Round card</b> in the Log jumps to it.",
      "Review each round: “Show the changes”, then <b>Keep on &lt;branch&gt;</b> or <b>Discard</b>. Folders without git get <b>Mark reviewed</b>.",
      "The badge on the tab counts rounds waiting for review.",
      "<b>Style</b> is the Taste style for this project. <b>Send to Taste</b> on a round card puts its pictures in your Taste queue.",
      "<b>End work</b> stops it (click twice)."]],
    ["Taste", "taste", "You judge what Claude makes; it learns your taste.", [
      "Models, images, pixel art, sounds, video, text and lighting from Training, Working and chats wait under “To review”. Click one: each kind has its own viewer (drag to spin a model, zoom an image, play a sound with its waveform, slide before/after on lighting).",
      "<b>Approve</b> or <b>Deny</b> with a reason, or <b>Comment</b> (“make the barrel thicker”): the next round revises a copy and puts the new version back in your queue, next to the old one.",
      "<b>Styles</b> are separate tastes (a game's look, a pixel style…). Make, rename or archive them here; move a piece to another style while you review it.",
      "<b>Claude's critic before my queue</b>: rounds have a separate critic look at their work and fix what it finds before you see it (off in Lite). Work still with its critic is under “Unfinished”.",
      "<b>Add work</b> (or drop files on the tab) adds your own examples. Claude never approves its own work; the gold badge counts what waits."]],
    ["Updates", "updates", "Keeps The Wise Hive in step with the Claude desktop app.", [
      "<b>Check for updates now</b> looks right away. By default it also checks every 6 hours on its own.",
      "After an update, <b>Restart The Wise Hive now</b> to use it.",
      "History: <b>Restore this version</b> goes back. An update that fails the app's tests is undone."]],
    ["Plugins", "plugins", "Add skills, agents and tools to every chat.", [
      "Installed: the switch turns a plugin on or off. <b>Update</b> gets its newest version, <b>Uninstall</b> removes it (click twice).",
      "Type in “Search available plugins”, then <b>Install</b>. Plugins can run code on this PC, so only install ones from sources you trust.",
      "Marketplaces: type a GitHub owner/repo, a git URL or a folder and click <b>Add</b>. <b>Update all</b> refreshes them, <b>Remove</b> drops one (click twice).",
      "Changes apply to chats you start afterwards. <b>Refresh</b> reads the list again."]],
    ["Settings", "settings", "Is everything running?", [
      "The cards show the server, Claude Code and your connected tools. <b>Check again</b> re-tests.",
      "“Answer from my phone” is off until you set it up here.",
      "Disk cleanup: <b>Preview</b>, then <b>Clean now</b> and <b>Yes, clean up</b>. It never touches chats or memories.",
      "The server log at the bottom shows errors."]],
  ];

  const START = [
    "On <b>Home</b>, type what you want and click <b>Start chat</b>. Or open <b>Chats</b> to see every conversation.",
    "Pick the project folder Claude should work in.",
    "When Claude asks for permission or asks a question, answer in the chat: <b>Allow</b>, <b>Deny</b>, or pick an answer.",
    "Check <b>Activity</b> to see what's running and what needs you.",
    "For non-stop work, start <b>Training</b> or <b>Working</b> and leave it. Come back to review what Working changed.",
  ];

  const TIPS = [
    "Closing the window hides The Wise Hive to the tray. Right-click the tray icon for Open The Wise Hive, Start with Windows or Quit The Wise Hive.",
    "When the window isn't in front, clicking a Windows notification opens the chat or tab it's about.",
    "Enter sends, Shift+Enter adds a new line, Esc closes pop-ups.",
    "First time? Open a terminal, run <code>claude</code> and type <code>/login</code> once.",
    "The Refiner starts on “Refine, let me check”, so you see the improved prompt before it's sent.",
    "Training and Working pause at 97% of your usage limit by default. Money caps are estimates.",
    "The panel on the right lists every job The Wise Hive is running, with its agents underneath. Amber means no output for 3 minutes, red for 10. Agents work quietly, so an amber agent may just be busy: its row shows the step it's on. “While you were away” keeps the last 20 finished jobs. Collapse it with ».",
  ];

  /* ---------- first-run tip ---------- */
  const home = document.querySelector("#v-home .home");
  let nudge = null;
  function setNudge(on) {
    const dot = document.getElementById("tutDot");
    if (dot) dot.hidden = !on;
    if (on && !nudge && home) {
      nudge = document.createElement("section");
      nudge.className = "card tu-nudge";
      nudge.setAttribute("aria-label", "Tutorial tip");
      nudge.innerHTML = `<span class="tu-av bob">${mascot("queen", "Queen Claude")}</span><span><b>New here?</b> Take the 2-minute tour.</span>`
        + `<button class="btn small primary" type="button" data-tu="tour">Open the tutorial</button><button class="btn small" type="button" data-tu="dismiss">Dismiss</button>`;
      const h1 = home.querySelector("h1");
      home.insertBefore(nudge, h1 ? h1.nextSibling : home.firstChild);
      nudge.addEventListener("click", (e) => {
        const b = e.target.closest("[data-tu]");
        if (!b) return;
        if (b.dataset.tu === "tour") show("tutorial");
        else { setSeen(true); setNudge(false); }
      });
    }
    if (nudge) nudge.hidden = !on;
  }

  /* ---------- the tab ---------- */
  let root = null, built = false, openKey = "";
  function icon(view) {
    const svg = document.querySelector(`.nav[data-view="${view}"] svg`);
    return svg ? svg.cloneNode(true) : null;
  }
  function build() {
    if (built) return true;
    root = document.getElementById("tutorialRoot");
    if (!root) return false;
    root.innerHTML = `
<header><div class="tu-me bob">${mascot("queen", "Queen Claude")}</div><div><h1>Tutorial</h1><p class="muted" style="margin:2px 0 0">A quick tour of The Wise Hive. Click any tab below to learn it, or open it.</p></div></header>
<section class="card stack"><h2 class="sec" style="margin:0">Start here</h2><ol class="tu-steps">${START.map((s) => `<li><span>${s}</span></li>`).join("")}</ol></section>
<h2 class="sec">The tabs</h2>
<div class="tu-grid">${TABS.map(([name, view, what, how]) => `
  <section class="card tu-card" data-view="${view}">
    <div class="tu-top"><span class="tu-ic" data-ic="${view}"></span><div><b>${name}</b><small>${what}</small></div></div>
    <ol class="tu-how" hidden>${how.map((h) => `<li>${h}</li>`).join("")}</ol>
    <div class="tu-acts"><button class="btn small" type="button" data-act="how" aria-expanded="false">How to use</button><button class="btn small primary" type="button" data-act="open">Open ${name}</button></div>
  </section>`).join("")}
</div>
<section class="card stack"><h2 class="sec" style="margin:0">Good to know</h2><ul class="tu-tips">${TIPS.map((t) => `<li>${t}</li>`).join("")}</ul>
  <div><button class="linkish" type="button" data-act="again" style="font-size:13px">Show the tour tip on Home again</button></div></section>`;
    for (const s of root.querySelectorAll("[data-ic]")) { const i = icon(s.dataset.ic); if (i) { i.setAttribute("aria-hidden", "true"); s.appendChild(i); } }
    root.addEventListener("click", onClick);
    built = true;
    return true;
  }
  function expand(view) {
    openKey = openKey === view ? "" : view;
    for (const c of root.querySelectorAll(".tu-card")) {
      const on = c.dataset.view === openKey;
      c.classList.toggle("open", on);
      c.querySelector(".tu-how").hidden = !on;
      const b = c.querySelector('[data-act="how"]');
      b.setAttribute("aria-expanded", String(on));
      b.textContent = on ? "Hide steps" : "How to use";
    }
  }
  function onClick(e) {
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    const card = b.closest(".tu-card");
    if (b.dataset.act === "how" && card) expand(card.dataset.view);
    else if (b.dataset.act === "open" && card) show(card.dataset.view);
    else if (b.dataset.act === "again") { setSeen(false); setNudge(true); toast("Tip is back", "You'll see it on Home."); }
  }

  window.addEventListener("hive:view", (e) => {
    if (!e.detail || e.detail.view !== "tutorial") return;
    if (!build()) return;
    if (!seen()) { setSeen(true); setNudge(false); }
  });
  if (!seen()) setNudge(true);
  // If the page opened straight onto this tab (restored view), build it now.
  const v = document.getElementById("v-tutorial");
  if (v && !v.hidden) { build(); setSeen(true); setNudge(false); }
})();
