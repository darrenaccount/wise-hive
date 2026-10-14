// The Wise Hive page: the shared helpers ($, api, esc, md, toast...), chats, Library, Activity, Link, Sketch, Settings
// and boot. Moved out of index.html in the 2026-10-13 refactor; a classic script, so its top-level names are shared
// with the *-client.js files loaded after it, exactly as when it was inline.
// The brain folder (the folder The Wise Hive is installed in); asked once from the server.
let BRAIN_DIR = "";
// The Wise Hive Lite (edition "lite") saves usage: the Clarifier only checks a chat's first message or long prompts, and the
// Inventor only runs when asked. Its name and a LITE badge tell the two apart.
window.HIVE_LITE = false;
fetch("/api/brain", { headers: { "X-Hive": "1" } }).then((r) => r.json()).then((j) => {
  BRAIN_DIR = j.brain || "";
  if (j.edition !== "lite") return;
  window.HIVE_LITE = true;
  document.title = "The Wise Hive Lite";
  const logo = document.getElementById("logo");
  if (logo && !document.getElementById("liteBadge")) {
    logo.title = "The Wise Hive Lite: uses less of your Claude usage";
    logo.insertAdjacentHTML("afterend", `<div id="liteBadge" title="The Wise Hive Lite: lighter helpers that use less of your Claude usage" style="font:700 9px/1 system-ui,sans-serif;letter-spacing:.08em;color:#1d1a18;background:#e9b949;border-radius:4px;padding:3px 5px;margin:4px auto 0;width:max-content">LITE</div>`);
  }
  window.dispatchEvent(new Event("hive:edition"));
}).catch(() => {});
/* ---------- pixel mascots ---------- */
const C = {o:"var(--claude)", eye:"#1d1a18", gold:"#e9b949", red:"#d64545", purple:"#7a4fc2", pink:"#f2a3a0", blue:"#3e6fb0", paper:"#f3efe6", grey:"#8b95a1", green:"#3fa06b", navy:"#2f3e66", brown:"#8a5a3b", white:"#f1f1f1", black:"#26282c", lens:"#bfe3f5", orange:"#f29a3a", teal:"#2aa79b"};
const R = (x,y,w,h,c) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`;
const BASE = R(0,6,2,2,C.o)+R(14,6,2,2,C.o)+R(2,4,12,7,C.o)+R(3,11,1,2,C.o)+R(5,11,1,2,C.o)+R(10,11,1,2,C.o)+R(12,11,1,2,C.o)+R(5,6,1,2,C.eye)+R(10,6,1,2,C.eye);
const KIT = {
  claude:{},
  queen:{back:R(1,5,14,8,C.purple), front:R(4,2,8,2,C.gold)+R(4,0,1,2,C.gold)+R(7,-1,2,3,C.gold)+R(11,0,1,2,C.gold)+R(5,2,1,1,C.red)+R(10,2,1,1,C.red)+R(7,2,2,1,"#4aa3df")+R(4,8,1,1,C.pink)+R(11,8,1,1,C.pink)+R(7,9,2,1,C.eye)},
  librarian:{front:R(4,5,3,1,C.eye)+R(4,8,3,1,C.eye)+R(4,5,1,4,C.eye)+R(6,5,1,4,C.eye)+R(9,5,3,1,C.eye)+R(9,8,3,1,C.eye)+R(9,5,1,4,C.eye)+R(11,5,1,4,C.eye)+R(7,6,2,1,C.eye)+R(14,5,3,4,C.blue)+R(16,5,1,4,C.paper)+R(6,1,4,3,C.brown)+R(7,0,2,1,C.brown)},
  researcher:{front:R(14,1,5,1,C.grey)+R(14,5,5,1,C.grey)+R(14,1,1,5,C.grey)+R(18,1,1,5,C.grey)+R(15,2,3,3,C.lens)+R(13,6,2,1,C.grey)+R(3,2,10,2,"#a77b4f")+R(2,3,12,1,"#8a6440")},
  builder:{front:R(4,1,8,3,"#f2c230")+R(2,3,12,1,"#f2c230")+R(7,1,2,3,"#d9a520")+R(16,3,1,6,C.grey)+R(15,2,3,1,C.grey)},
  critic:{front:R(4,4,1,1,C.eye)+R(5,5,1,1,C.eye)+R(11,4,1,1,C.eye)+R(10,5,1,1,C.eye)+R(7,9,2,1,C.eye)+R(16,1,1,6,C.red)+R(16,7,1,1,C.eye)},
  modeler:{front:R(3,2,9,2,C.navy)+R(9,1,1,1,C.navy)+R(15,5,3,3,C.orange)+R(15,5,3,1,"#f7c08a")+R(17,6,1,2,"#c4741f")},
  reviewer:{front:R(3,3,10,1,C.green)+R(2,3,2,1,C.green)+R(15,3,3,6,"#c9a46a")+R(15,4,3,4,C.paper)+R(15,6,1,1,C.green)+R(16,7,1,1,C.green)+R(17,5,1,1,C.green)},
  believer:{front:R(6,-1,2,1,"#e2557a")+R(9,-1,2,1,"#e2557a")+R(6,0,5,1,"#e2557a")+R(7,1,3,1,"#e2557a")+R(8,2,1,1,"#e2557a")+R(6,8,1,1,C.eye)+R(7,9,2,1,C.eye)+R(9,8,1,1,C.eye)+R(1,1,1,1,C.gold)+R(14,1,1,1,C.gold)},
  skeptic:{front:R(4,5,2,1,C.eye)+R(10,4,2,1,C.eye)+R(7,9,3,1,C.eye)+R(14,-1,3,1,C.grey)+R(16,0,1,1,C.grey)+R(15,1,1,1,C.grey)+R(15,3,1,1,C.grey)},
  investor:{front:R(5,-2,6,4,C.black)+R(3,2,10,1,C.black)+R(5,1,6,1,C.gold)+R(15,8,2,2,C.gold)+R(15,8,1,1,"#fde68a")},
  organizer:{front:R(3,2,10,2,C.green)+R(12,1,2,1,C.green)+R(14,6,5,4,"#e0b05a")+R(14,5,2,1,"#e0b05a")+R(15,7,3,1,C.paper)},
  refiner:{front:R(4,2,8,2,C.purple)+R(7,1,2,1,C.purple)+R(16,1,1,7,C.paper)+R(17,0,1,4,C.paper)+R(16,8,1,2,C.black)+R(1,-1,1,3,C.gold)+R(0,0,3,1,C.gold)},
  clarifier:{front:R(4,2,8,2,C.teal)+R(6,1,4,1,C.teal)+R(10,3,4,1,"#1d7c73")+R(13,-3,6,6,C.white)+R(13,3,1,1,C.white)+R(15,-2,3,1,C.teal)+R(17,-1,1,1,C.teal)+R(16,0,1,1,C.teal)+R(16,2,1,1,C.teal)},
  judge:{back:R(1,2,2,8,C.white)+R(13,2,2,8,C.white), front:R(3,2,10,2,C.white)+R(15,3,4,2,C.brown)+R(16,5,1,4,"#a8774f")},
  trainer:{front:R(3,3,10,1,C.red)+R(12,2,3,1,C.red)+R(13,1,2,1,C.red)+R(7,9,2,1,C.eye)+R(15,6,3,2,"#c9ced6")+R(17,5,1,1,"#c9ced6")+R(14,7,1,1,C.grey)+R(11,8,3,1,C.grey)},
  foreman:{front:R(4,1,8,3,C.orange)+R(2,3,12,1,C.orange)+R(7,1,2,3,"#d67d22")+R(15,4,3,6,"#c9a46a")+R(15,5,3,4,C.paper)+R(16,6,1,1,C.eye)+R(16,8,1,1,C.eye)},
  inventor:{front:R(7,-3,3,3,"#fde68a")+R(8,-2,1,1,"#fff7d6")+R(8,0,1,1,C.grey)+R(3,5,10,1,C.brown)+R(4,5,3,3,"#bfe3f5")+R(9,5,3,3,"#bfe3f5")+R(5,6,1,2,C.eye)+R(10,6,1,2,C.eye)+R(7,9,2,1,C.eye)},
  messenger:{front:R(3,2,10,2,C.blue)+R(11,3,4,1,C.blue)+R(15,6,4,3,C.paper)+R(15,6,4,1,"#d9d2c3")+R(16,7,2,1,C.red)},
  desk:{front:R(3,1,10,1,"#3b3f46")+R(2,2,1,4,"#3b3f46")+R(13,2,1,4,"#3b3f46")+R(1,4,2,3,"#3b3f46")+R(13,4,2,3,"#3b3f46")+R(14,7,1,2,"#3b3f46")+R(11,9,4,1,"#3b3f46")+R(10,9,1,1,C.red)+R(7,9,2,1,C.eye)},
};
function mascot(kind, label){
  const k = KIT[kind] || {};
  return `<svg class="mascot" viewBox="-1 -3 21 17" role="img" aria-label="${label||kind}">${k.back||""}${BASE}${k.front||""}</svg>`;
}
const AGENTS = [
  {k:"researcher", n:"Researcher", d:"Digs up facts, options and what the hive already knows."},
  {k:"builder", n:"Builder", d:"Writes the code, plans and game systems."},
  {k:"critic", n:"Critic", d:"Finds the problems before you do."},
  {k:"modeler", n:"Modeler", d:"Builds 3D models in Blender, starting from scripts that already worked."},
  {k:"reviewer", n:"Reviewer", d:"Checks every Blender build: shape, scale, topology, weights."},
  {k:"librarian", n:"Librarian", d:"Files every lesson and where it was learned. Lives in the Library."},
  {k:"organizer", n:"Organizer", d:"Moves memories, lessons, scripts and skills into the right files, merges duplicates and keeps the indexes straight. Lives in the Library."},
  {k:"refiner", n:"Refiner", d:"Turns short, broad prompts into detailed ones using what the hive knows, and builds a library of reusable prompt templates."},
  {k:"clarifier", n:"Clarifier", d:"Asks what's unclear, never blocks. Sits beside every chat and lists what Claude might have misunderstood, with the guess it went with."},
  {k:"inventor", n:"Inventor", d:"Watches every chat and keeps suggesting new ideas, with Claude's honest take on how it's going. Sits beside the Clarifier."},
  {k:"trainer", n:"Trainer", d:"Runs non-stop practice in the Training tab: finds where the team is weak and drills it until you say stop."},
  {k:"foreman", n:"Foreman", d:"Runs the Working tab: keeps thinking up and building the next improvement to a project until you say stop."},
  {k:"messenger", n:"Messenger", d:"Watches for Claude Code updates and adapts The Wise Hive to match. Lives in the Updates tab."},
  {k:"judge", n:"Judge", d:"Weighs the council's arguments and rules Pursue, Pivot or Pass."},
  {k:"investor", n:"Investor", d:"Sizes the opportunity and where it could go."},
  {k:"skeptic", n:"Skeptic", d:"Attacks the idea and finds what wasn't thought through."},
  {k:"believer", n:"Believer", d:"Makes the strongest case for the idea and who would buy it."},
];
const AGENT = Object.fromEntries(AGENTS.map(a=>[a.k,a]));
function agentFor(desc){
  const d = String(desc||"").toLowerCase();
  if (/research|explor|find|search|investig/.test(d)) return "researcher";
  if (/critic|critique|review|check|audit|verif/.test(d)) return /blender|model|mesh/.test(d) ? "reviewer" : "critic";
  if (/blender|model|mesh|3d|sculpt|rig/.test(d)) return "modeler";
  if (/build|implement|write|code|fix|creat/.test(d)) return "builder";
  return "claude";
}

/* ---------- helpers ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s??"").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const H = {"X-Hive":"1","Content-Type":"application/json"};
const api = (p, o={}) => fetch(p, {...o, headers:H}).then(r => r.json());
async function stream(p, payload, on){ return readStream(await fetch(p, {method:"POST", headers:H, body:JSON.stringify(payload)}), on); }
// Reads a server-sent event stream from a fetch response (callers that check the status first use this directly).
async function readStream(r, on){
  const rd = r.body.getReader(), dec = new TextDecoder(); let buf = "";
  for(;;){
    const {value, done} = await rd.read(); if (done) break;
    buf += dec.decode(value, {stream:true});
    let i; while ((i = buf.indexOf("\n\n")) >= 0){ const chunk = buf.slice(0,i); buf = buf.slice(i+2); if (chunk.startsWith("data: ")) { try { on(JSON.parse(chunk.slice(6))); } catch {} } }
  }
}
let busy = 0; const setBusy = d => { busy = Math.max(0, busy + d); document.body.classList.toggle("busy", busy > 0); try { SCENE.home && SCENE.home.update({busy: busy > 0}); } catch {} };
function md(src){
  const out=[]; let list=null; const lines=String(src||"").split("\n");
  const inl=s=>esc(s).replace(/`([^`]+)`/g,"<code>$1</code>").replace(/\*\*([^*]+)\*\*/g,"<b>$1</b>").replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');
  const close=()=>{if(list){out.push(`</${list}>`);list=null}};
  for(let i=0;i<lines.length;i++){
    const l=lines[i]; let m;
    if(l.startsWith("```")){close();const b=[];i++;while(i<lines.length&&!lines[i].startsWith("```"))b.push(lines[i++]);out.push(`<pre>${esc(b.join("\n"))}</pre>`);continue}
    if(/^\|.*\|\s*$/.test(l)){close();const rows=[];while(i<lines.length&&/^\|.*\|\s*$/.test(lines[i]))rows.push(lines[i++]);i--;out.push("<table>"+rows.filter(r=>!/^\|[\s:|-]+\|\s*$/.test(r)).map((r,ri)=>"<tr>"+r.slice(1,-1).split("|").map(c=>ri?`<td>${inl(c.trim())}</td>`:`<th>${inl(c.trim())}</th>`).join("")+"</tr>").join("")+"</table>");continue}
    if(m=l.match(/^#{1,4}\s+(.*)/)){close();out.push(`<h4>${inl(m[1])}</h4>`)}
    else if(m=l.match(/^\s*[-*]\s+(.*)/)){if(list!=="ul"){close();out.push("<ul>");list="ul"}out.push(`<li>${inl(m[1])}</li>`)}
    else if(m=l.match(/^\s*\d+[.)]\s+(.*)/)){if(list!=="ol"){close();out.push("<ol>");list="ol"}out.push(`<li>${inl(m[1])}</li>`)}
    else if(!l.trim())close();
    else{close();out.push(`<p>${inl(l)}</p>`)}
  }
  close(); return out.join("");
}
const ago = iso => { const s=(Date.now()-new Date(iso))/1000; if(s<3600)return Math.max(1,Math.round(s/60))+" min ago"; if(s<86400)return Math.round(s/3600)+" h ago"; if(s<86400*7)return Math.round(s/86400)+" days ago"; return new Date(iso).toLocaleDateString(); };
// The app's own agents and unattended runs (Training, Working, Updates) aren't the user's chats.
const HIDE = /^(You are (the (BELIEVER|SKEPTIC|INVESTOR|JUDGE|LIBRARIAN|ORGANIZER|PROMPT REFINER|PROMPT LIBRARIAN|CLARIFIER|SKETCH READER|INVENTOR|TRAINER|FOREMAN|UPDATER|TASTE CRITIC|TASTE CURATOR)|the [A-Z][A-Z ]* on an idea council|a message relay)|\[(?:Wise Hive|Teamwright|Hivemind) (training|working|update|brainstorm)\])/; // old tags too: keep-old-name

/* ---------- navigation ---------- */
function show(view){
  document.querySelectorAll(".nav").forEach(b => { if (b.dataset.view===view) b.setAttribute("aria-current","page"); else b.removeAttribute("aria-current"); });
  for (const v of ["home","chats","council","library","link","activity","projects","sketch","brainstorm","training","working","taste","updates","tutorial","plugins","settings"]) if ($("v-"+v)) $("v-"+v).hidden = v!==view;
  window.dispatchEvent(new CustomEvent("hive:view", {detail:{view}}));
  if (view==="sketch") { skInit(); requestAnimationFrame(skResize); }
  if (view==="activity") loadActivity();
  if (view==="projects") loadProjects();
  if (view==="settings") loadSettings();
  try { localStorage.setItem("hive-view", view); } catch {}
  if (view==="chats") drawOptsSummary();
  if (view==="library") loadLibrary();
  if (view==="link") loadLink();
}
document.querySelectorAll(".nav").forEach(b => b.onclick = () => show(b.dataset.view));

/* ---------- shared data ---------- */
let SESSIONS = [], FOLDERS = [];
async function loadStats(){
  const s = await api("/api/stats");
  const n = (v, w) => `${v} ${w}${v === 1 ? "" : "s"}`;
  $("queenStats").textContent = `Remembers ${n(s.memories,"memory").replace("memorys","memories")}, ${n(s.sessions,"conversation")}, ${n(s.skills,"skill")} and ${n(s.lessons,"lesson")}`;
  $("queenCap").textContent = $("queenStats").textContent;
  SCENE.home && SCENE.home.update({stats: s});
  $("libSpeech").textContent = `I keep ${n(s.memories,"memory").replace("memorys","memories")}, ${n(s.lessons,"lesson")} and ${n(s.skills,"skill")}, each linked to the conversation it came from, so no Claude has to learn it twice.`;
}
async function loadFolders(){
  FOLDERS = await api("/api/folders");
  const opts = FOLDERS.map(f => `<option value="${esc(f)}">${esc(f.split("\\").pop()||f)}</option>`).join("");
  $("homeFolder").innerHTML = opts; $("chatFolderPick").innerHTML = opts;
  const last = (()=>{ try { return localStorage.getItem("hive-folder"); } catch { return null; } })();
  if (last && FOLDERS.includes(last)) { $("homeFolder").value = last; $("chatFolderPick").value = last; }
}
async function loadSessions(){
  SESSIONS = (await api("/api/sessions")).filter(s => !HIDE.test(s.title));
  drawChatList();
}

/* ---------- home ---------- */
// Animated scenes (public/scenes/*.js). Each view falls back to its plain design if its scene didn't load.
const SCENE = {};
function mountScene(key, canvasId, sceneName, opts){
  if (SCENE[key] || !window.Pixel || !Pixel.scenes[sceneName] || !$(canvasId)) return null;
  SCENE[key] = Pixel.mount($(canvasId), sceneName, opts || {});
  return SCENE[key];
}
const tipFor = k => { const a = AGENT[k] || (k === "queen" ? {n:"Queen Claude", d:"The memory of everything: every lesson, project and conversation the hive has learned."} : null); if (a) $("tip").innerHTML = `<b>${a.n}</b>: ${esc(a.d)}`; };
function drawHome(){
  $("logo").innerHTML = mascot("queen","The Wise Hive");
  if (mountScene("home", "sceneHome", "castle", {onPick: tipFor})) { $("homeSceneWrap").hidden = false; $("ring").hidden = true; return; }
  $("queenArt").innerHTML = mascot("queen","Queen Claude");
  const ring = $("ring");
  AGENTS.forEach((a,i) => {
    const ang = -Math.PI/2 + i*2*Math.PI/AGENTS.length;
    const b = document.createElement("button");
    b.className = "agent"; b.type = "button"; b.dataset.k = a.k;
    b.style.left = (50 + 43*Math.cos(ang)) + "%"; b.style.top = (50 + 42*Math.sin(ang)) + "%";
    b.innerHTML = `<div class="bob" style="width:58px;animation-delay:${-i*0.3}s">${mascot(a.k,a.n)}</div><span>${a.n}</span>`;
    b.onclick = () => { document.querySelectorAll(".agent").forEach(x=>x.classList.toggle("on", x===b)); $("tip").innerHTML = `<b>${a.n}</b>: ${esc(a.d)}`; };
    ring.appendChild(b);
  });
}
$("homeGo").onclick = () => {
  const t = $("homeAsk").value.trim(); if (!t) { $("homeAsk").focus(); return; }
  newChat($("homeFolder").value); $("team").checked = $("homeTeam").checked; $("homeAsk").value = "";
  show("chats"); sendPrompt(t);
};
$("homeAsk").addEventListener("keydown", e => { if (e.key==="Enter" && !e.shiftKey) { e.preventDefault(); $("homeGo").click(); } });

/* ---------- chats ---------- */
let chat = {id:null, cwd:"", title:"New chat", messages:[], run:null, cwdExists:true, clarify:[]};
// Server-side runs still going, so the list can mark chats Claude is working on.
let RUNNING = new Set();
async function loadRunning(){ try { RUNNING = new Set((await api("/api/runs")).filter(r => !r.done && r.chatId).map(r => r.chatId)); } catch {} drawChatList(); }
function drawChatList(){
  const q = $("chatSearch").value.toLowerCase();
  const list = SESSIONS.filter(s => !q || (s.title+" "+s.project).toLowerCase().includes(q));
  const live = new Set([...RUNNING, ...[...liveChats].map(c => c.id).filter(Boolean)]);
  const day = d => { const t = new Date(d), n = new Date(); const diff = (new Date(n.toDateString()) - new Date(t.toDateString())) / 864e5; return diff <= 0 ? "Today" : diff === 1 ? "Yesterday" : diff < 7 ? "This week" : "Earlier"; };
  let last = "", html = "";
  for (const s of list) {
    const g = day(s.updated);
    if (g !== last) { html += `<div class="group">${g}</div>`; last = g; }
    html += `<button class="item" type="button" data-id="${esc(s.id)}" aria-current="${s.id===chat.id}"><span class="${live.has(s.id)?"live-dot":"idle-dot"}" title="${live.has(s.id)?"Claude is working on this":""}"></span><span class="t"><b>${esc(s.title)}</b><small>${esc(s.project)} · ${ago(s.updated)}</small></span></button>`;
  }
  $("chatItems").innerHTML = html || `<p class="muted" style="padding:10px">${q ? "No chats match." : "No chats yet."}</p>`;
}
$("chatSearch").oninput = drawChatList;
$("chatItems").onclick = e => { const b = e.target.closest(".item"); if (b) openSession(b.dataset.id); };
$("newChat").onclick = () => freshChat();
$("backToList").onclick = () => $("chatsWrap").classList.add("show-list");
// A new chat from "+ New chat" (or a project or the sketch board) starts with the Refiner, Clarifier and Inventor off.
// Home's "Start chat" keeps what was picked on Home (it starts off too when the app opens).
function freshChat(folder){ if (refining) return; refinerOff(); if (window.HiveChatOpts && HiveChatOpts.helpersOff) HiveChatOpts.helpersOff(); newChat(folder); }
function newChat(folder){
  if (refining) return;
  const cwd = folder || $("chatFolderPick").value; $("chatFolderPick").value = cwd;
  switchTo({id:null, cwd, title:"New chat", messages:[], run:null, cwdExists:true, clarify:[]}); $("prompt").focus();
}
// Events for feature modules (ideas-client.js etc.): hive:chatopen, hive:userprompt, hive:turn, hive:panel, hive:view.
function hiveEvent(name, detail){ try { window.dispatchEvent(new CustomEvent(name, {detail})); } catch (e) { console.error(name, e); } }
// Shows chat c (new, loaded, live, or picked from a toast); view: also open the Chats tab. Every way of switching chats goes
// through here. Never while the Refiner works (its prompt would go to the wrong chat): false then. Any switch makes a
// slower openSession/openRun still loading stale (openTok), so it can't overwrite what the user picked after it.
let openTok = 0;
function switchTo(c, view){
  if (refining) return false;
  openTok++; chat = c; $("refineBox").hidden = true; if (view) show("chats");
  drawChat(); drawChatList(); setRunButtons(); $("chatsWrap").classList.remove("show-list");
  hiveEvent("hive:chatopen", {chat}); return true;
}
async function openSession(id){
  if (refining) return;
  $("refineBox").hidden = true;
  // A chat this window is already running: show the live one (checked again after loading: a double click must not attach twice).
  const tok = ++openTok, mine = () => [...liveChats].find(c => c.id === id);
  if (mine()) return void switchTo(mine(), true);
  const [d, rs] = await Promise.all([api("/api/sessions/"+id), api("/api/runs").catch(() => [])]);
  if (tok !== openTok || d.error) return; // another chat was opened while this one loaded
  if (mine()) return void switchTo(mine(), true);
  const c = {id, cwd:d.meta.cwd, title:d.meta.title, messages:d.messages, run:null, cwdExists:d.meta.cwdExists, clarify:[]};
  if (!switchTo(c, true)) return;
  loadClarify(c);
  // A run still going server-side (started before a reload, or handed over from Claude Desktop): re-attach.
  const r = rs.find(x => x.chatId === id && !x.done);
  if (r) attachRun(c, r);
}
// Opens a chat run that is still going, by run id (the activity panel), from the server's in-memory event log
// (/api/runs/:id/stream). Reads no transcript. False when the run has already finished.
async function openRun(id){
  if (refining) return false;
  const live = () => [...liveChats].find(x => x.run === id);
  let c = live(), r = null;
  if (!c) {
    const tok = ++openTok, rs = await api("/api/runs").catch(() => []);
    if (tok !== openTok) return true; // the user opened something else meanwhile
    r = Array.isArray(rs) && rs.find(x => x.id === id && !x.done);
    if (!r) return false;
    if ((c = live())) r = null; // attached meanwhile (a double click): show that one, don't attach twice
    else c = {id: r.chatId || null, cwd: r.cwd, title: r.title, messages: [], run: null, cwdExists: true, clarify: []};
  }
  if (!switchTo(c, true)) return false;
  if (r) attachRun(c, {...r, events: 0}); // events:0 = replay every kept event, not only new ones
  return true;
}
function drawChat(){
  drawClarify();
  $("chatTitle").textContent = chat.title;
  $("chatFolder").textContent = !chat.id ? "" : /scratch-workspaces/i.test(chat.cwd) ? "No folder" : chat.cwdExists ? chat.cwd.split("\\").pop() : "Folder no longer exists";
  $("chatFolder").hidden = !chat.id;
  $("chatFolderPick").hidden = !!chat.id && chat.cwdExists;
  $("backToList").hidden = window.innerWidth > 860;
  const m = $("msgs");
  if (!chat.messages.length){
    const ideas = [["Pick up where I left off","What's the current state of my main project, and what should we do next?"],["Model something in Blender","Model a low-poly banana prop in Blender, following the blender-modeling skill."],["Check my Roblox scripts","Review my Roblox game's server scripts for bugs and risky patterns."],["What do you remember?","Summarize what you remember about my projects and how I like to work."]];
    m.innerHTML = `<div class="empty"><div class="bob" style="width:96px">${mascot("claude")}</div><h3>What are we working on?</h3><p>Every chat starts with the hive's memory loaded: your projects, skills and lessons.</p><div class="suggest">${ideas.map(([t,p]) => `<button type="button" data-suggest="${esc(p)}">${esc(t)}<small>${esc(p.slice(0,60))}${p.length>60?"…":""}</small></button>`).join("")}</div></div>`;
    m.querySelectorAll("[data-suggest]").forEach(b => b.onclick = () => { $("prompt").value = b.dataset.suggest; $("prompt").focus(); $("prompt").dispatchEvent(new Event("input")); });
    return;
  }
  m.innerHTML = chat.messages.map(msgHTML).join("");
  m.scrollTop = m.scrollHeight;
}
const prettyTool = n => n.startsWith("mcp__") ? n.split("__").slice(1).map(s => s.replace(/_/g," ")).join(": ") : n;
// Shows what a tool changes: a red/green diff for edits, the command for shells, a checklist for to-dos.
function detailHTML(d){
  if (!d) return "";
  const lines = (s, cls, mark) => String(s||"").split("\n").slice(0, 120).map(l => `<div class="${cls}">${mark}${esc(l)}</div>`).join("");
  if (d.todos) return `<ul class="todos">${d.todos.map(t => `<li class="${esc(t.status||"")}">${esc(t.text)}</li>`).join("")}</ul>`;
  if (d.cmd) return `<div class="diff"><div class="hd">Command</div>${lines(d.cmd, "", "")}</div>`;
  if (d.edits) return `<div class="diff"><div class="hd">${esc(d.file||"")}</div>${d.edits.map(e => lines(e.old,"del","- ") + lines(e.new,"add","+ ")).join('<div class="hd">…</div>')}</div>`;
  if (d.old != null || d.new != null) return `<div class="diff"><div class="hd">${esc(d.file||"")}</div>${d.old!=null?lines(d.old,"del","- "):""}${lines(d.new,"add","+ ")}</div>`;
  if (d.input) return `<div class="diff">${lines(d.input, "", "")}</div>`;
  return "";
}
function msgHTML(x, i){
  if (x.role === "user") return `<div class="msg user" data-i="${i}"><div class="bubble"><div class="md">${md(x.text)}</div>${x.files&&x.files.length?`<div class="from">Attached: ${x.files.map(esc).join(", ")}</div>`:""}${x.queued?`<div class="from">Sent while Claude was working. It reads this at its next step.</div>`:""}${x.original?`<div class="from">Refined from: “${esc(x.original)}”</div>`:""}</div></div>`;
  if (x.role === "perm") {
    const st = {allow:"Allowed", always:"Always allowed in this chat", deny:"Denied"}[x.state] || "";
    return `<div class="msg" data-i="${i}"><div class="av">${mascot("claude")}</div><div class="bubble card-perm" data-req="${esc(x.req)}"><b>Claude wants to use ${esc(prettyTool(x.tool))}</b>${x.summary?`<div class="muted" style="font-size:14px">${esc(x.summary)}</div>`:""}${detailHTML(x.detail)}`
      + (x.state === "waiting" ? `<div class="actions"><button class="btn small primary" type="button" data-pa="allow">Allow</button>${x.canAlways?`<button class="btn small" type="button" data-pa="always">Always allow in this chat</button>`:""}<button class="btn small" type="button" data-pa="deny">Deny</button><span class="muted" style="font-size:12px;align-self:center">If you're away, Claude skips this after 15 minutes.</span></div>`
        : `<span class="state ${x.state==="deny"?"deny":"allow"}">${esc(st)}</span>`) + `</div></div>`;
  }
  if (x.role === "ask") {
    const qs = x.questions || [];
    const body = qs.map((q, qi) => `<div data-q="${qi}" data-multi="${q.multiSelect?1:0}" style="margin-top:8px"><b>${esc(q.question)}</b>${q.multiSelect?` <span class="muted" style="font-size:12px">(pick any)</span>`:""}`
      + (x.state === "waiting" ? `<div class="opts">${(q.options||[]).map(o => `<button class="opt" type="button" data-opt="${esc(o.label)}" aria-pressed="false">${esc(o.label)}${o.description?`<small>${esc(o.description)}</small>`:""}</button>`).join("")}</div><input type="text" data-other placeholder="Or type your own answer">`
        : `<div class="muted" style="font-size:14px">Answer: ${esc((x.answers||{})[q.question] || "")}</div>`) + `</div>`).join("");
    return `<div class="msg" data-i="${i}"><div class="av">${mascot("claude")}</div><div class="bubble card-ask" data-req="${esc(x.req)}"><b>Claude has a question</b>${body}`
      + (x.state === "waiting" ? `<div class="actions"><button class="btn small primary" type="button" data-ask-submit>Answer</button><span class="muted" style="font-size:12px;align-self:center">If you're away, Claude goes with its best guess after 15 minutes.</span></div>` : "") + `</div></div>`;
  }
  const chipHTML = t => {
    const k = t.agent ? agentFor(t.agent) : null;
    const chip = `<span class="tool">${k?`<span class="mini">${mascot(k)}</span>`:""}<b>${esc(k ? (AGENT[k]?.n||"Agent") : prettyTool(t.name))}</b><span>${esc(t.agent||t.summary)}</span></span>`;
    return t.detail && !t.detail.todos ? `<details class="tooldet"><summary>${chip}</summary>${detailHTML(t.detail)}</details>` : chip;
  };
  const todo = (x.tools||[]).filter(t => t.detail && t.detail.todos).pop();
  const team = (x.tools||[]).filter(t => t.agent), plain = (x.tools||[]).filter(t => !t.agent && !(t.detail && t.detail.todos));
  const tools = team.map(chipHTML).join("") + (plain.length > 3
    ? `<details style="width:100%"><summary class="muted" style="cursor:pointer;font-size:13px">Used ${plain.length} tools</summary><div class="tools">${plain.map(chipHTML).join("")}</div></details>`
    : plain.map(chipHTML).join(""));
  const kinds = [...new Set((x.tools||[]).filter(t=>t.agent).map(t=>agentFor(t.agent)))];
  const av = kinds.length ? kinds[0] : "claude";
  return `<div class="msg" data-i="${i}"><div class="av ${x.streaming?"working":""}">${mascot(av)}</div><div class="bubble">${x.note?`<div class="from" style="margin:0 0 6px">${esc(x.note)}</div>`:""}${x.think?`<details class="think"><summary>Thinking</summary><div>${esc(x.think)}</div></details>`:""}<div class="md ${x.streaming?"cursor":""}">${x.text?md(x.text):(x.streaming?"":((x.tools&&x.tools.length)||(x.media&&x.media.length)?"":'<span class="muted">(no text)</span>'))}</div>${window.HiveMedia?HiveMedia.html(x,"main"):""}${todo?`<div class="card" style="padding:10px 12px;margin-top:8px"><b style="font-size:13px">To-do</b>${detailHTML(todo.detail)}</div>`:""}${tools?`<div class="tools">${tools}</div>`:""}${window.HiveMedia?HiveMedia.html(x,"strip"):""}${x.error?`<p style="color:var(--bad);margin:6px 0 0">${esc(x.error)}</p>`:""}</div></div>`;
}
// Repaints only the messages that changed (x._d) or are new, once per frame, keeping scroll near the bottom.
let paintQueued = false;
function paint(c){
  if (c && c !== chat) return;
  if (paintQueued) return; paintQueued = true;
  requestAnimationFrame(() => {
    paintQueued = false;
    const m = $("msgs");
    if (!chat.messages.length || m.querySelector(".empty")) return drawChat();
    const near = m.scrollHeight - m.scrollTop - m.clientHeight < 140;
    chat.messages.forEach((x, i) => {
      const el = m.querySelector(`:scope > [data-i="${i}"]`);
      if (!el) m.insertAdjacentHTML("beforeend", msgHTML(x, i));
      else if (x._d) {
        // Parts marked data-k (media-client.js) are carried over as live nodes while their data-sig is unchanged, so loaded images
        // don't reload or flicker and an opened "Looked at" stays open. Other <details> keep their open state by position, as before.
        const DK = "details:not([data-k])", open = [...el.querySelectorAll(DK)].map(d => d.open), kept = new Map([...el.querySelectorAll("[data-k]")].map(n => [n.dataset.k, n]));
        el.outerHTML = msgHTML(x, i); const nel = m.querySelector(`:scope > [data-i="${i}"]`);
        if (nel) { nel.querySelectorAll(DK).forEach((d, k) => { if (open[k]) d.open = true; });
          nel.querySelectorAll("[data-k]").forEach(n => { const o = kept.get(n.dataset.k); if (!o) return; if (o.dataset.sig === n.dataset.sig) n.replaceWith(o); else if (o.open) n.open = true; }); }
      }
      x._d = false;
    });
    if (near) m.scrollTop = m.scrollHeight;
  });
}
/* ---------- prompt refiner ---------- */
const REFINE_OPTS = [["review","Refine, let me check"],["auto","Refine and send"],["off","Send as typed"]];
const refineMode = () => $("refine").value;
for (const id of ["refine","homeRefine"]) {
  $(id).innerHTML = REFINE_OPTS.map(([v,n]) => `<option value="${v}">${n}</option>`).join("");
  $(id).onchange = e => { $("refine").value = $("homeRefine").value = e.target.value; };
}
// The Refiner starts off ("Send as typed") when the app opens and in every new chat: the user turns it on (the user's rule).
const refinerOff = () => { $("refine").value = $("homeRefine").value = "off"; };
refinerOff();
let refining = false;
async function refineFirst(text){
  refining = true; $("prompt").value = ""; $("send").disabled = true; setBusy(1); $("loginBanner").hidden = true;
  const box = $("refineBox"); box.hidden = false;
  const tok = box._tok = {}, cl = refineMode()==="review" && helperOn("clarifier") ? {pending:true, list:[]} : null;
  if (cl) fireClarify(chat, text).then(qs => { cl.pending = false; cl.list = qs; if (box._tok === tok && !box.hidden) drawRfClar(cl); });
  box.innerHTML = `<div class="who working"><span style="width:34px">${mascot("refiner","Refiner")}</span><b>Refiner</b><span class="muted">is adding detail to your prompt…</span></div><div id="rfClar"></div>`; drawRfClar(cl);
  const context = chat.messages.slice(-2).map(m => `${m.role}: ${String(m.text).slice(0,1200)}`).join("\n");
  let r; try { r = await api("/api/refine", {method:"POST", body:JSON.stringify({prompt:text, cwd: chat.id ? chat.cwd : $("chatFolderPick").value, context})}); } catch { r = {error:"Lost connection to The Wise Hive server.", refined:text}; }
  refining = false; $("send").disabled = false; setBusy(-1);
  if (refineMode()==="auto" && !r.error) { box.hidden = true; return sendPrompt(r.refined, {raw:true, original: r.changed ? text : ""}); }
  if (r.error && /signed in/i.test(r.error)) $("loginBanner").hidden = false;
  box.innerHTML = `<div class="who"><span style="width:34px">${mascot("refiner","Refiner")}</span><b>Refiner</b><span class="muted">${esc(r.error || (r.changed ? (r.notes || "Added detail.") : "Your prompt was already clear."))}${r.template?` · template: ${esc(r.template)}`:""}</span></div><textarea id="refined" aria-label="Refined prompt">${esc(r.refined)}</textarea><div id="rfClar"></div><div class="row"><button class="btn small" type="button" id="rfCancel">Cancel</button><span class="spacer"></span><button class="btn small" type="button" id="rfOrig">Send my original</button><button class="btn small primary" type="button" id="rfSend">Send refined</button></div>`;
  $("rfCancel").onclick = () => { box.hidden = true; $("prompt").value = text; $("prompt").focus(); flushClarify(); };
  drawRfClar(cl);
  $("rfOrig").onclick = () => { const c = rfClarAnswers(cl); box.hidden = true; sendPrompt(text + c, {raw:true}); };
  $("rfSend").onclick = () => { const t = $("refined").value.trim(), c = rfClarAnswers(cl); box.hidden = true; sendPrompt(t + c, {raw:true, original: t !== text ? text : ""}); };
  $("refined").addEventListener("keydown", e => { if (e.key==="Enter" && e.ctrlKey){ e.preventDefault(); $("rfSend").click(); } });
  $("refined").focus();
}
/* ---------- running a chat ---------- */
// Chats with a run in progress, so switching away and back keeps the live view (and the run keeps going server-side).
const liveChats = new Set();
// chatopts-client.js (when loaded) picks the model for the usage saver and the agents mode ("cheap" = cheaper helpers).
const composerOpts = (text, atts) => { const co = window.HiveChatOpts; return {mode:$("mode").value, team: co ? co.team() : $("team").checked, model: co ? co.model(text, atts) : ($("model").value || undefined), effort:$("effort").value || undefined, chrome:$("chrome").checked}; };
// Prompt helpers the user switched off in the chat's top-right corner don't run (chatopts-client.js).
const helperOn = (k) => !window.HiveChatOpts || window.HiveChatOpts.helperOn(k);
function setRunButtons(){
  const running = !!chat.run;
  $("stop").hidden = !running;
  $("send").title = running ? "Send to Claude now: it reads this at its next step" : "Send (Enter)";
  $("prompt").placeholder = running ? "Add something while Claude works…" : "Message Claude…";
  const waiting = chat.messages.some(m => (m.role === "perm" || m.role === "ask") && m.state === "waiting");
  $("chatStatus").hidden = !running;
  $("chatStatus").innerHTML = running ? `<span class="mini working">${mascot("claude")}</span>${waiting ? "Waiting for you" : chat.reconnecting ? "Reconnecting…" : "Working"}` : "";
}
// The settings pill shows what is chosen; the popover holds the controls.
function drawOptsSummary(){
  const saverOn = window.HiveChatOpts && window.HiveChatOpts.summary().includes("Saver");
  const model = $("model").value ? $("model").options[$("model").selectedIndex]?.text : saverOn ? "Usage saver" : "Opus 5.5";
  const effort = {low:"Low", medium:"Medium", high:"High", xhigh:"Extra-high"}[$("effort").value];
  $("optsBtn").textContent = [{edit:"Edit + ask", read:"Read only", full:"Full access"}[$("mode").value], model, effort ? effort + " effort" : ""].filter(Boolean).join(" · ");
  const extras = [{review:"Refine & check", auto:"Auto-refine", off:""}[$("refine").value], $("chrome").checked ? "Chrome" : "", ...(window.HiveChatOpts ? window.HiveChatOpts.summary().filter((x) => x !== "Saver") : [$("team").checked ? "Team" : ""])].filter(Boolean);
  $("extrasBtn").textContent = extras.length ? "+ " + extras.join(" · ") : "+ Extras";
}
// Two popovers: core settings (permissions, model, effort) and optional extras (refiner, Chrome, team).
const POPS = [["optsBtn","optsPop"],["extrasBtn","extrasPop"]];
const closePops = except => POPS.forEach(([b,p]) => { if (p !== except) { $(p).hidden = true; $(b).setAttribute("aria-expanded", "false"); } });
for (const [b, p] of POPS) $(b).onclick = e => { e.stopPropagation(); drawOptsSummary(); const open = $(p).hidden; closePops(p); $(p).hidden = !open; $(b).setAttribute("aria-expanded", open); };
document.addEventListener("click", e => { if (!e.target.closest(".opts-pop")) closePops(); });
document.addEventListener("keydown", e => { if (e.key !== "Escape") return; const o = POPS.find(([, p]) => !$(p).hidden); if (o) { closePops(); $(o[0]).focus(); } });
for (const id of ["mode","model","effort","chrome","team","refine"]) $(id).addEventListener("change", drawOptsSummary);

/* resizable chat list */
(() => {
  const MIN = 170, MAX = 560, DEF = 240, wrap = $("chatsWrap"), rz = $("listResizer");
  const set = (w, save) => { w = Math.round(Math.min(MAX, Math.max(MIN, w))); wrap.style.setProperty("--list-w", w + "px"); rz.setAttribute("aria-valuenow", w); if (save) try { localStorage.setItem("hive-list-w", w); } catch {} };
  try { const w = +localStorage.getItem("hive-list-w"); if (w) set(w); } catch {}
  rz.setAttribute("aria-valuemin", MIN); rz.setAttribute("aria-valuemax", MAX);
  rz.addEventListener("pointerdown", e => {
    e.preventDefault(); rz.setPointerCapture(e.pointerId); wrap.classList.add("resizing");
    const left = wrap.getBoundingClientRect().left;
    const move = ev => set(ev.clientX - left);
    const up = ev => { rz.removeEventListener("pointermove", move); rz.removeEventListener("pointerup", up); wrap.classList.remove("resizing"); set(ev.clientX - left, true); };
    rz.addEventListener("pointermove", move); rz.addEventListener("pointerup", up);
  });
  rz.addEventListener("dblclick", () => set(DEF, true));
  rz.addEventListener("keydown", e => {
    const cur = parseInt(getComputedStyle(wrap).getPropertyValue("--list-w")) || DEF;
    if (e.key === "ArrowLeft") { e.preventDefault(); set(cur - 16, true); }
    if (e.key === "ArrowRight") { e.preventDefault(); set(cur + 16, true); }
  });
})();
// o.chat: the chat to send to, default the one showing. Another chat (a follow-up that waited for its run to end, see
// sendAfter) is sent without touching the composer, the Refiner box or the folder picker, which belong to the one showing.
async function sendPrompt(text, o={}){
  const c = o.chat || chat, here = c === chat;
  text = (text ?? $("prompt").value).trim();
  if (refining && here) return;
  if (!text && !attachments.length) return;
  // Claude is already working on this chat: hand the message over now, it reads it at its next step.
  if (c.run) {
    const atts = here ? takeAttachments() : o.attachments || []; if (here) $("prompt").value = "";
    const um = {role:"user", text: text || "(see attached)", queued:true, files: atts.map(a => a.name)}; c.messages.push(um); paint(c);
    hiveEvent("hive:userprompt", {chat: c, text: um.text});
    const r = await api(`/api/runs/${c.run}/message`, {method:"POST", body:JSON.stringify({text: um.text, attachments: atts})}).catch(() => ({error:"lost"}));
    // Not taken (the run was ending): it goes out as the chat's next turn, now if that run already ended.
    if (r.error) { (c.after = c.after || []).push({text: um.text, atts}); um.queued = false; um._d = true; paint(c); if (!liveChats.has(c)) sendAfter(c); }
    return;
  }
  // Lite: only a chat's first message or a long prompt is checked (the Refiner's review box can still ask for it).
  const clarifyWorth = !window.HIVE_LITE || !(c.messages || []).some((m) => m.role === "user") || text.length >= 400;
  if (text && !o.raw && !o.noClarify && refineMode() !== "review" && clarifyWorth && helperOn("clarifier")) fireClarify(c, text);
  // Lite: no Refiner run for a short follow-up ("yes", "do 2") in a chat that's already going.
  const shortFollowUp = window.HIVE_LITE && (c.messages || []).some((m) => m.role === "user") && text.length < 60;
  if (text && !o.raw && refineMode() !== "off" && !shortFollowUp) return refineFirst(text);
  if (here) { $("refineBox").hidden = true; $("prompt").value = ""; $("loginBanner").hidden = true; }
  const atts = o.attachments || (here ? takeAttachments() : []);
  text = text || "(see attached)";
  let prompt = text, resume = c.id;
  if (c.id && !c.cwdExists){ prompt = `Continue our earlier conversation. Read its full record first: ${BRAIN_DIR}\\transcripts\\readable\\ (the file ending in _${c.id.slice(0,8)}.md).\n\n${text}`; resume = null; c.cwd = $("chatFolderPick").value; }
  if (!c.id && here) { c.cwd = $("chatFolderPick").value; try { localStorage.setItem("hive-folder", c.cwd); } catch {} }
  if (c.title === "New chat") c.title = text.replace(/\s+/g," ").slice(0,90);
  c.messages.push({role:"user", text, original:o.original, files: atts.map(a => a.name)});
  hiveEvent("hive:userprompt", {chat: c, text});
  const mine = c; mine.cur = null; mine.run = "starting"; liveChats.add(mine);
  if (here) { drawChat(); setRunButtons(); } setBusy(1);
  mine.ended = false; mine.lastN = -1;
  try { await stream("/api/chat", {prompt, cwd: mine.cwd, resume, ...composerOpts(text, atts), attachments: atts, title: mine.title}, ev => onRunEvent(mine, ev)); } catch {}
  if (!mine.ended && mine.run && mine.run !== "starting") await keepFollowing(mine);
  else if (!mine.ended) { const a = curMsg(mine); a.error = "Couldn't reach The Wise Hive's server, so this wasn't sent. It reconnects on its own; send it again in a moment."; a._d = true; }
  endRun(mine);
}
// If the live stream drops (sleep, network hiccup, app reload), keep re-attaching to the same run from the
// last event we saw, until the run really ends. Claude keeps working server-side the whole time.
async function keepFollowing(c){
  let wait = 600;
  while (!c.ended) {
    c.reconnecting = true; if (c === chat) setRunButtons();
    await new Promise(r => setTimeout(r, wait)); wait = Math.min(wait * 1.6, 5000);
    let rs; try { rs = await api("/api/runs"); } catch { showConn(true); continue; }
    showConn(false);
    const r = rs.find(x => x.id === c.run);
    if (!r) { const a = curMsg(c); a.streaming = false; a.note = "The Wise Hive restarted while Claude was working. Everything up to that point is saved in this chat; send a message to carry on."; a._d = true; c.ended = true; break; }
    try { await stream(`/api/runs/${c.run}/stream`, {from: c.lastN + 1}, ev => onRunEvent(c, ev)); wait = 600; } catch {}
  }
  c.reconnecting = false; if (c === chat) setRunButtons();
}
let connEl = null;
function showConn(on){
  if (on && !connEl) { connEl = document.createElement("div"); connEl.className = "conn"; connEl.setAttribute("role", "status"); connEl.textContent = "Reconnecting to The Wise Hive… your chats keep running"; document.body.appendChild(connEl); }
  if (!on && connEl) { connEl.remove(); connEl = null; }
}
// Attaches to a run that is already going (opened from the list, or after the window reloaded).
async function attachRun(c, info){
  c.run = info.id; liveChats.add(c); setBusy(1);
  const pend = new Set((info.pending||[]).map(p => p.req));
  c.messages.push({role:"assistant", text:"", tools:[], streaming:true, note:"Claude is still working on this. Showing new activity."});
  if (c === chat) { drawChat(); setRunButtons(); }
  c.ended = false; c.lastN = -1;
  try {
    await stream(`/api/runs/${info.id}/stream`, {from:0}, ev => {
      if (ev.n < info.events && !((ev.t === "perm" || ev.t === "ask") && pend.has(ev.req))) { if (ev.t === "session") c.id = c.id || ev.id; c.lastN = ev.n; return; }
      onRunEvent(c, ev);
    });
  } catch {}
  if (!c.ended) await keepFollowing(c);
  endRun(c);
}
function curMsg(c){
  if (!c.cur || !c.cur.streaming) { c.cur = {role:"assistant", text:"", think:"", tools:[], streaming:true}; c.messages.push(c.cur); }
  return c.cur;
}
function onRunEvent(c, ev){
  if (typeof ev.n === "number") { if (ev.n <= c.lastN) return; c.lastN = ev.n; } // skip events already shown after a reconnect
  if (ev.t === "end") c.ended = true;
  if (c.reconnecting) { c.reconnecting = false; if (c === chat) setRunButtons(); }
  if (ev.t === "run") { c.run = ev.run; if (c === chat) setRunButtons(); return; }
  if (ev.t === "session") { if (!c.id) c.id = ev.id; if (c.ckey && c.id && c.ckey !== c.id) rekeyClarify(c); return; }
  if (ev.t === "delta") { const a = curMsg(c); a.text += (a.gap && a.text ? "\n\n" : "") + ev.text; a.gap = false; a._d = true; }
  else if (ev.t === "think") { const a = curMsg(c); a.think = (a.think||"") + ev.text; a._d = true; }
  else if (ev.t === "tools") { const a = curMsg(c); a.tools.push(...ev.tools); a.gap = true; a._d = true; }
  // Pictures and files Claude showed, made or looked at (media.js). They join the reply segment being written (where the
  // tool chip is), or the last reply if they arrive between segments or just after the turn. media-core.js dedupes per chat.
  else if (ev.t === "media") { if (window.HiveMedia && Array.isArray(ev.items)) HiveMedia.add(c, c.cur || [...c.messages].reverse().find(x => x.role === "assistant") || curMsg(c), ev.items); }
  else if (ev.t === "perm" || ev.t === "ask") {
    if (c.cur) { c.cur.streaming = false; c.cur._d = true; c.cur = null; }
    c.messages.push({role: ev.t, ...ev, state:"waiting"});
    if (c !== chat || document.hidden) toast(ev.t === "ask" ? "Claude has a question" : `Claude wants to use ${prettyTool(ev.tool)}`, c.title, () => { show("chats"); if (c !== chat) switchTo(c); });
  }
  else if (ev.t === "answered") { const m = c.messages.find(x => x.req === ev.req); if (m) { m.state = ev.decision === "allow" && ev.always ? "always" : ev.decision; m.answers = ev.answers; m._d = true; } }
  else if (ev.t === "user") { const m = [...c.messages].reverse().find(x => x.role === "user" && x.queued); if (m) { m._d = true; } }
  else if (ev.t === "result") {
    const a = c.cur; if (ev.id) c.id = ev.id;
    if (ev.error && /log ?in/i.test(ev.text)) { $("loginBanner").hidden = false; const b = curMsg(c); b.error = "Not signed in."; b.streaming = false; b._d = true; }
    else if (a) { if (!a.text) a.text = ev.text; a.streaming = false; a._d = true; }
    else if (ev.text && !c.messages.some(x => x.role === "assistant" && x.text === ev.text)) c.messages.push({role:"assistant", text: ev.text, tools:[]});
    c.cur = null;
    if (!ev.error) hiveEvent("hive:turn", {chat: c, text: ev.text});
  }
  else if (ev.t === "end") {
    if (ev.code && !c.stopping) { const a = c.cur || curMsg(c); if (!a.text && !a.error) { a.error = "Claude stopped." + (ev.err ? " " + ev.err.split("\n").filter(Boolean).pop() : ""); a._d = true; } }
  }
  paint(c);
}
function endRun(c){
  if (!liveChats.has(c)) return;
  liveChats.delete(c); setBusy(-1);
  for (const x of c.messages) if (x.streaming) { x.streaming = false; x._d = true; }
  for (const x of c.messages) if ((x.role === "perm" || x.role === "ask") && x.state === "waiting") { x.state = "deny"; x._d = true; }
  c.cur = null; c.run = null; c.stopping = false; c.cwdExists = true;
  if (c === chat) { paint(c); setRunButtons(); }
  loadSessions(); loadStats();
  // Messages that arrived just as Claude finished go out as the next turn, also when another chat is showing now.
  if (c.after && c.after.length) { sendAfter(c); if (c === chat) return; }
  flushClarify();
}
// Sends the oldest follow-up the run didn't take (chat.after) as a new turn of the chat it was typed in. While the Refiner
// works on that chat it waits for the next run's end instead.
function sendAfter(c){ if (refining && c === chat) return; const x = c.after.shift(); return sendPrompt(x.text, {raw:true, noClarify:true, attachments:x.atts, chat:c}); }
$("send").onclick = () => sendPrompt();
$("stop").onclick = () => { if (chat.run && chat.run !== "starting") { chat.stopping = true; api(`/api/runs/${chat.run}/stop`, {method:"POST", body:"{}"}).catch(()=>{}); } };
// Approval buttons, question options and answers inside the chat.
$("msgs").addEventListener("click", async e => {
  const opt = e.target.closest("[data-opt]");
  if (opt) { const box = opt.closest("[data-q]"); if (box.dataset.multi !== "1") box.querySelectorAll("[data-opt]").forEach(b => b.setAttribute("aria-pressed", "false")); opt.setAttribute("aria-pressed", opt.getAttribute("aria-pressed") === "true" ? "false" : "true"); return; }
  const pa = e.target.closest("[data-pa]"), sub = e.target.closest("[data-ask-submit]");
  if (!pa && !sub) return;
  const card = e.target.closest("[data-req]"), req = card.dataset.req, c = chat, m = c.messages.find(x => x.req === req);
  if (!c.run || !m || m.state !== "waiting") return;
  let payload;
  if (pa) payload = {req, decision: pa.dataset.pa === "deny" ? "deny" : "allow", always: pa.dataset.pa === "always"};
  else {
    const answers = {};
    card.querySelectorAll("[data-q]").forEach(box => {
      const q = m.questions[+box.dataset.q], picked = [...box.querySelectorAll('[data-opt][aria-pressed="true"]')].map(b => b.dataset.opt), other = box.querySelector("[data-other]").value.trim();
      answers[q.question] = [...picked, other].filter(Boolean).join(", ") || "No preference; use your best judgment.";
    });
    payload = {req, answers};
  }
  card.querySelectorAll("button").forEach(b => b.disabled = true);
  await api(`/api/runs/${c.run}/answer`, {method:"POST", body:JSON.stringify(payload)}).catch(()=>{});
});

/* ---------- attachments ---------- */
let attachments = [];
function takeAttachments(){ const a = attachments; attachments = []; drawAttachments(); return a; }
function drawAttachments(){
  $("attachRow").hidden = !attachments.length;
  $("attachRow").innerHTML = attachments.map((a, i) => `<span class="att">${a.type.startsWith("image/")?`<img src="data:${a.type};base64,${a.data}" alt="">`:""}<span>${esc(a.name)}</span><button class="x" type="button" data-rm="${i}" aria-label="Remove ${esc(a.name)}">×</button></span>`).join("");
}
$("attachRow").onclick = e => { const b = e.target.closest("[data-rm]"); if (b) { attachments.splice(+b.dataset.rm, 1); drawAttachments(); } };
function addFiles(files){
  for (const f of files) {
    if (f.size > 15 * 1024 * 1024) { toast("File too big", `${f.name} is over 15 MB.`); continue; }
    const rd = new FileReader();
    rd.onload = () => { attachments.push({name: f.name || "pasted-image.png", type: f.type || "application/octet-stream", data: String(rd.result).split(",")[1] || ""}); drawAttachments(); };
    rd.readAsDataURL(f);
  }
}
$("attachBtn").onclick = () => $("attachInput").click();
$("attachInput").onchange = e => { addFiles(e.target.files); e.target.value = ""; };
$("prompt").addEventListener("paste", e => { const fs = [...(e.clipboardData?.files || [])]; if (fs.length) { e.preventDefault(); addFiles(fs); } });
const comp = document.querySelector(".composer");
comp.addEventListener("dragover", e => { e.preventDefault(); comp.classList.add("drop"); });
comp.addEventListener("dragleave", () => comp.classList.remove("drop"));
comp.addEventListener("drop", e => { e.preventDefault(); comp.classList.remove("drop"); addFiles(e.dataTransfer.files); });
// Remember the composer's model, effort and Chrome choices.
// Older saves used aliases ("opus"); map them to the exact model ids the menu uses now.
const MODEL_ALIAS = {opus:"claude-opus-5-5", sonnet:"claude-sonnet-5-5", haiku:"claude-haiku-5-5", fable:"claude-fable-5-1"};
for (const id of ["model","effort","mode"]) {
  try { let v = localStorage.getItem("hive-"+id); if (id === "model" && MODEL_ALIAS[v]) v = MODEL_ALIAS[v]; if (v != null) $(id).value = v; if ($(id).selectedIndex < 0) $(id).selectedIndex = 0; } catch {}
  $(id).addEventListener("change", e => { try { localStorage.setItem("hive-"+id, e.target.value); } catch {} });
}
try { $("chrome").checked = localStorage.getItem("hive-chrome") === "1"; } catch {}
$("chrome").onchange = e => { try { localStorage.setItem("hive-chrome", e.target.checked ? "1" : "0"); } catch {} };

/* ---------- toasts ---------- */
function toast(title, body, onClick){
  const t = document.createElement("div"); t.className = "toast"; t.innerHTML = `<b>${esc(title)}</b><div class="muted" style="font-size:13px">${esc(body||"")}</div>`;
  t.onclick = () => { t.remove(); onClick && onClick(); };
  document.body.appendChild(t); setTimeout(() => t.remove(), 7000);
}
$("prompt").addEventListener("keydown", e => { if (e.key==="Enter" && !e.shiftKey){ e.preventDefault(); sendPrompt(); } });
$("prompt").addEventListener("input", e => { e.target.style.height = "auto"; e.target.style.height = Math.min(220, e.target.scrollHeight) + "px"; });

/* ---------- clarifier ---------- */
// Runs beside the main task and lists what Claude might have misunderstood. Never awaited before a send.
let clarOpen = (() => { try { return localStorage.getItem("hive-clarify-open") === "1"; } catch { return false; } })();
const clarQueue = [], ansOpen = new Set();
const cKey = c => c.ckey || (c.ckey = c.id || "pending-" + Math.random().toString(36).slice(2, 12));
async function fireClarify(c, text){
  const key = cKey(c); c.clarify = c.clarify || []; c.clarifying = (c.clarifying||0) + 1; if (c === chat) drawClarify();
  const context = c.messages.slice(-2).map(m => `${m.role}: ${String(m.text).slice(0,1200)}`).join("\n");
  let r; try { r = await api("/api/clarify", {method:"POST", body:JSON.stringify({prompt:text, cwd: c.id ? c.cwd : $("chatFolderPick").value, context, key})}); } catch { r = {}; }
  const qs = r.questions || []; c.clarifying--; c.clarify.push(...qs);
  if (c === chat) drawClarify();
  return qs;
}
function rekeyClarify(c){ const from = c.ckey; c.ckey = c.id; api("/api/clarify/rekey", {method:"POST", body:JSON.stringify({from, to:c.id})}).catch(()=>{}); }
function loadClarify(c){
  c.ckey = c.id;
  api("/api/clarify/"+encodeURIComponent(c.id)).then(r => { const have = new Set((c.clarify||[]).map(q=>q.id)); c.clarify = (r.questions||[]).filter(q=>!have.has(q.id)).concat(c.clarify||[]); c.clarify.filter(q => q.status === "answered" && !q.delivered).forEach(q => queueAnswer(c, q)); if (c === chat) { drawClarify(); flushClarify(); } }).catch(()=>{});
}
function setClarStatus(c, q, status, answer, delivered){
  q.status = status; if (answer !== undefined) q.answer = answer; if (status === "answered") q.answeredAt = new Date().toISOString(); if (delivered) q.delivered = true;
  api(`/api/clarify/${encodeURIComponent(cKey(c))}/${encodeURIComponent(q.id)}`, {method:"POST", body:JSON.stringify({status, answer, delivered})}).catch(()=>{});
}
function drawClarify(){
  const qs = chat.clarify || [], open = qs.filter(q => q.status === "open").length, working = chat.clarifying > 0, av = $("clarAv");
  // The icon is always there in Chats; with no questions yet its panel says so.
  const po = clarOpen;
  if (!$("clarArt").innerHTML) $("clarArt").innerHTML = mascot("clarifier","Clarifier");
  av.hidden = false; av.classList.toggle("working", working); av.setAttribute("aria-expanded", po);
  av.title = working ? "The Clarifier is checking your prompt…" : qs.length ? `${open} open question${open===1?"":"s"} from the Clarifier` : "The Clarifier: questions about your prompts show up here";
  $("clarBadge").hidden = !open; $("clarBadge").textContent = open;
  $("clarPanel").hidden = !po; av.parentElement.classList.toggle("clar-open", po);
  if (po) drawClarPanel();
}
function drawClarPanel(){
  const p = $("clarPanel"), qs = chat.clarify || [], by = s => qs.filter(q => q.status === s);
  const keep = {}; p.querySelectorAll("textarea[data-q]").forEach(t => keep[t.dataset.q] = t.value);
  const openD = {}; p.querySelectorAll("details[data-s]").forEach(d => openD[d.dataset.s] = d.open);
  const top = p.querySelector(".clar-body")?.scrollTop || 0;
  const line = (l, v) => v ? `<div class="clar-l"><span>${l}</span>${esc(v)}</div>` : "";
  const foot = q => q.status === "answered" ? `<div class="clar-ans"><span class="muted">Your answer:</span> ${esc(q.answer)}</div>`
    : q.status === "ignored" ? `<div class="row"><span class="spacer"></span><button class="btn small" type="button" data-act="reopen">Reopen</button></div>`
    : ansOpen.has(q.id) ? `<textarea data-q="${esc(q.id)}" aria-label="Your answer" placeholder="Your answer">${esc(keep[q.id]||"")}</textarea><div class="row"><span class="spacer"></span><button class="btn small" type="button" data-act="cancel">Cancel</button><button class="btn small primary" type="button" data-act="send">Send</button></div>`
    : `<div class="row"><span class="spacer"></span><button class="btn small" type="button" data-act="ignore">Ignore</button><button class="btn small primary" type="button" data-act="answer">Answer</button></div>`;
  const card = q => `<div class="clar-q" data-id="${esc(q.id)}"><b>${esc(q.question)}</b>${line("I understood:", q.understood)}${q.source?`<div class="clar-l"><span>From:</span><q class="clar-src">${esc(q.source)}</q></div>`:""}${line("Unclear:", q.unclear)}${line("Going with:", q.assumption)}${foot(q)}</div>`;
  const group = (s, n) => { const l = by(s); return l.length ? `<details data-s="${s}" ${openD[s]?"open":""}><summary>${n} (${l.length})</summary>${l.map(card).join("")}</details>` : ""; };
  const open = by("open"), working = chat.clarifying > 0;
  p.innerHTML = `<header><span style="width:30px" class="${working?"working":""}">${mascot("clarifier","Clarifier")}</span><div style="flex:1;min-width:0"><b>Clarifier</b><div class="muted" style="font-size:12px">${working ? "Checking your latest prompt…" : `${open.length} open question${open.length===1?"":"s"}`}</div></div><button class="x" type="button" data-act="close" aria-label="Close the Clarifier">×</button></header>`
    + `<div class="clar-body"><p class="muted" style="margin:0;font-size:13px">Claude didn't wait for these. It went with its best guess; answer any to correct it.</p>${open.map(card).join("") || `<p class="muted" style="margin:0;font-size:13px">Nothing open right now.</p>`}${group("answered","Answered")}${group("ignored","Ignored")}</div>`;
  p.querySelector(".clar-body").scrollTop = top;
}
$("clarAv").onclick = () => { clarOpen = !clarOpen; try { localStorage.setItem("hive-clarify-open", clarOpen ? "1" : "0"); } catch {} drawClarify(); if (clarOpen) hiveEvent("hive:panel", {name:"clarifier"}); };
// Another side panel (e.g. the Inventor's ideas) opened: close the Clarifier's.
window.addEventListener("hive:panel", e => { if (e.detail && e.detail.name !== "clarifier" && clarOpen) { clarOpen = false; try { localStorage.setItem("hive-clarify-open", "0"); } catch {} drawClarify(); } });
$("clarPanel").onclick = e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const act = b.dataset.act; if (act === "close") return $("clarAv").click();
  const c = chat, id = b.closest(".clar-q").dataset.id, q = (c.clarify||[]).find(x => x.id === id); if (!q) return;
  if (act === "answer") { ansOpen.add(id); drawClarPanel(); return $("clarPanel").querySelector(`textarea[data-q="${id}"]`)?.focus(); }
  if (act === "cancel") { ansOpen.delete(id); return drawClarPanel(); }
  if (act === "ignore") setClarStatus(c, q, "ignored");
  if (act === "reopen") setClarStatus(c, q, "open");
  if (act === "send") {
    const ta = b.closest(".clar-q").querySelector("textarea"), ans = ta.value.trim(); if (!ans) return ta.focus();
    ansOpen.delete(id); setClarStatus(c, q, "answered", ans);
    queueAnswer(c, q);
    flushClarify();
  }
  drawClarify();
};
// Sends queued answers into the chat once it is idle (called again when each run ends).
function flushClarify(){
  if (chat.run || refining || !$("refineBox").hidden || chat.messages.some(m => m.streaming)) return;
  const i = clarQueue.findIndex(x => x.c === chat || (x.c.id && x.c.id === chat.id)); if (i < 0) return;
  const [x] = clarQueue.splice(i, 1); sendPrompt(x.msg, {raw:true, noClarify:true});
  // Marked delivered only once it is actually sent, so an answer queued before the app closed is re-sent on reopen.
  if (x.q) setClarStatus(x.c, x.q, "answered", x.q.answer, true);
}
function queueAnswer(c, q){
  if (clarQueue.some(x => x.q && x.q.id === q.id)) return;
  clarQueue.push({c, q, msg:`Answer to a clarifying question (from the Clarifier):\nQ: ${q.question}\nYou assumed: ${q.assumption}\nMy answer: ${q.answer}\n— adjust the earlier work if this changes anything.`});
}
// Review mode: the Clarifier's questions inside the refine box, each with an optional one-line answer.
function drawRfClar(cl){
  const el = $("rfClar"); if (!el) return;
  if (!cl || (!cl.pending && !cl.list.length)) { el.className = ""; el.innerHTML = ""; return; }
  const keep = {}; el.querySelectorAll("input[data-q]").forEach(i => keep[i.dataset.q] = i.value);
  el.className = "rf-clar";
  el.innerHTML = `<div class="who ${cl.pending?"working":""}"><span style="width:26px">${mascot("clarifier","Clarifier")}</span><b>Clarifier</b><span class="muted">${cl.pending ? "is checking what might be unclear…" : "Answer any of these (optional) and they go with your prompt."}</span></div>`
    + cl.list.map(q => `<label class="rf-q"><span><b>${esc(q.question)}</b> <span class="muted">Going with: ${esc(q.assumption)}</span></span><input type="text" data-q="${esc(q.id)}" placeholder="Your answer (optional)" value="${esc(keep[q.id]||"")}"></label>`).join("");
}
function rfClarAnswers(cl){
  if (!cl) return "";
  const c = chat, out = [];
  document.querySelectorAll("#rfClar input[data-q]").forEach(i => { const a = i.value.trim(), q = cl.list.find(x => x.id === i.dataset.q); if (!a || !q) return; out.push(`- Q: ${q.question}\n  A: ${a}`); setClarStatus(c, q, "answered", a, true); });
  if (out.length) drawClarify();
  return out.length ? `\n\nClarifications from the user:\n${out.join("\n")}` : "";
}

/* ---------- library ---------- */
let MEMS = [], LIBTAB = "mem";
// An error reply ({error}) or no answer shows in the tab instead of leaving it blank.
const OFFLINE_MSG = "Can't reach The Wise Hive server.";
const loadErr = (what, r) => `<p class="muted">Couldn't load ${what}: ${esc((r && r.error) || "unexpected reply from The Wise Hive server.")}</p>`;
async function loadLibrary(){
  $("libArt").innerHTML = mascot("librarian","The Librarian"); $("orgArt").innerHTML = mascot("organizer","The Organizer");
  const [mems, sk] = await Promise.all([api("/api/memories"), api("/api/skills")].map(p => p.catch(() => ({error: OFFLINE_MSG}))));
  if (Array.isArray(mems)) { MEMS = mems; drawMems(); } else $("memList").innerHTML = loadErr("memories", mems);
  if (sk && Array.isArray(sk.skills) && Array.isArray(sk.lessons)) drawSkills(sk); else $("lt-skills").innerHTML = loadErr("skills and lessons", sk);
  drawConvos(); drawPrompts(); loadStats();
}
const sessionById = id => SESSIONS.find(s => s.id === id);
function drawMems(){
  const q = $("memSearch").value.toLowerCase();
  const list = MEMS.filter(m => !q || (m.name+" "+m.description+" "+m.body).toLowerCase().includes(q));
  $("memList").innerHTML = list.map(m => {
    const s = m.origin && sessionById(m.origin);
    const learned = m.origin ? `Learned in <button class="linkish" type="button" data-open="${esc(m.origin)}">${esc(s ? s.title.slice(0,48) : "a conversation")}</button>${s?" · "+new Date(s.started||s.updated).toLocaleDateString():""}` : "Added by hand";
    return `<article class="card mem" data-file="${esc(m.file)}"><span class="type">${esc(m.type)}</span><h3>${esc(m.name.replace(/-/g," "))}</h3><div class="muted" style="font-size:14px">${esc(m.description)}</div><div class="learned">${learned}</div></article>`;
  }).join("") || `<p class="muted">No memories match.</p>`;
}
$("memSearch").oninput = drawMems;
$("memList").onclick = e => {
  const open = e.target.closest("[data-open]"); if (open){ e.stopPropagation(); openSession(open.dataset.open); return; }
  if (e.target.closest(".detail")) return;
  const card = e.target.closest(".mem"); if (!card) return;
  const ex = $("memList").querySelector(".detail"); const same = ex && ex.dataset.for === card.dataset.file; ex && ex.remove(); if (same) return;
  const m = MEMS.find(x => x.file === card.dataset.file);
  const d = document.createElement("div"); d.className = "card detail stack"; d.dataset.for = m.file;
  d.innerHTML = `<div class="md">${md(m.body)}</div><div class="row"><span class="spacer"></span><button class="btn small" type="button" data-edit>Edit</button></div>`;
  card.after(d);
  d.querySelector("[data-edit]").onclick = () => {
    d.innerHTML = `<textarea style="min-height:220px;font-family:var(--f-mono);font-size:13px">${esc(m.body)}</textarea><div class="row"><span class="spacer"></span><button class="btn small" type="button" data-cancel>Cancel</button><button class="btn small primary" type="button" data-save>Save</button></div>`;
    d.querySelector("[data-cancel]").onclick = () => d.remove();
    d.querySelector("[data-save]").onclick = async () => { await api("/api/memories/"+encodeURIComponent(m.file), {method:"PUT", body:JSON.stringify({text:d.querySelector("textarea").value})}); loadLibrary(); };
  };
};
function drawSkills(sk){
  $("lt-skills").innerHTML = `<h3>Skills</h3>` + sk.skills.map(s => `<details class="card"><summary style="cursor:pointer"><b style="font-family:var(--f-display);font-size:16px">${esc(s.name)}</b><div class="muted" style="font-size:14px">${esc(s.description)}</div></summary><div class="md" style="margin-top:10px">${md(s.body)}</div></details>`).join("")
    + `<h3 style="margin-top:8px">Lessons</h3>` + sk.lessons.map(l => `<details class="card" open><summary style="cursor:pointer"><b style="font-family:var(--f-display);font-size:16px">${esc(l.title)}</b></summary><div class="md">${md(l.text.replace(/^# .*\n/,""))}</div></details>`).join("");
}
function drawConvos(){
  $("lt-convos").innerHTML = `<p class="muted" style="margin:0">Every conversation is saved in full. Open one to read it or carry on.</p>` + SESSIONS.map(s => `<button class="item card" type="button" data-open="${esc(s.id)}"><b>${esc(s.title)}</b><small>${esc(s.project)} · ${new Date(s.started||s.updated).toLocaleDateString()}</small></button>`).join("");
}
$("lt-convos").onclick = e => { const b = e.target.closest("[data-open]"); if (b) openSession(b.dataset.open); };
document.querySelectorAll(".tab").forEach(t => t.onclick = () => { LIBTAB = t.dataset.lt; document.querySelectorAll(".tab").forEach(x => x.setAttribute("aria-selected", x===t)); for (const k of ["mem","skills","convos","prompts"]) $("lt-"+k).hidden = k!==LIBTAB; });
// Runs one of the brain jobs (librarian, organizer, prompt cleanup) and shows its progress in the log card.
const JOBS = ["tidy","organize","cleanPrompts"];
async function runJob(endpoint, who, waiting, art){
  JOBS.forEach(id => $(id) && ($(id).disabled = true)); setBusy(1); art.classList.add("working");
  SCENE.library && SCENE.library.update({busy:true, job: who});
  const log = $("tidyLog"); log.hidden = false; let text = ""; const tools = [];
  const draw = () => log.innerHTML = `<b style="font-family:var(--f-display)">${who} at work</b>${tools.length?`<div class="tools">${tools.slice(-12).map(t=>`<span class="tool"><b>${esc(t.name)}</b><span>${esc(t.summary)}</span></span>`).join("")}</div>`:""}<div class="md">${md(text)||`<span class="muted">${waiting}</span>`}</div>`;
  draw();
  await stream(endpoint, {}, ev => {
    if (ev.t==="delta") text += ev.text; if (ev.t==="tools") { tools.push(...ev.tools); text = ""; }
    if (ev.t==="result") { text = ev.error && /log ?in/i.test(ev.text) ? "Claude Code isn't signed in. Run `claude` in a terminal and type `/login` once." : ev.text; }
    draw();
  }).catch(()=>{});
  JOBS.forEach(id => $(id) && ($(id).disabled = false)); setBusy(-1); art.classList.remove("working"); loadLibrary();
  SCENE.library && SCENE.library.update({busy:false, job:null});
}
$("tidy").onclick = () => runJob("/api/librarian", "Librarian", "Reading new conversations…", $("libArt"));
$("organize").onclick = () => runJob("/api/organize", "Organizer", "Taking inventory of every memory, lesson, script and skill…", $("orgArt"));
async function drawPrompts(){
  const p = await api("/api/prompts").catch(() => ({error: OFFLINE_MSG}));
  if (!p || p.error || !Array.isArray(p.history)) { $("lt-prompts").innerHTML = loadErr("the Refiner's prompts", p); return; }
  const due = Math.max(0, p.every - (p.total - p.cleaned));
  $("lt-prompts").innerHTML = `<div class="card row" style="gap:12px"><span style="width:44px">${mascot("refiner","Refiner")}</span><div style="flex:1;min-width:220px"><b style="font-family:var(--f-display);font-size:16px">The Refiner</b><div class="muted" style="font-size:14px">${p.total} prompt${p.total===1?"":"s"} refined. ${p.cleaning ? "Cleaning up the template library now." : `The template library cleans itself after ${due} more.`}</div></div><button class="btn" id="cleanPrompts" type="button">Clean up prompts now</button></div>`
    + `<details class="card" open><summary style="cursor:pointer"><b style="font-family:var(--f-display);font-size:16px">Template library</b> <span class="muted" style="font-size:13px">prompts\\library.md</span></summary><div class="md">${p.library ? md(p.library.replace(/^# .*\n/,"")) : '<p class="muted">No templates yet. They appear once a few prompts have been refined.</p>'}</div></details>`
    + `<h3>Recent refinements</h3>` + (p.history.map(h => `<details class="card"><summary style="cursor:pointer"><b>${esc(String(h.original).slice(0,120))}</b><div class="muted" style="font-size:13px">${new Date(h.at).toLocaleString()}${h.template?` · template: ${esc(h.template)}`:""}${h.notes?` · ${esc(h.notes)}`:""}</div></summary><div class="md" style="margin-top:8px">${md(h.refined)}</div></details>`).join("") || '<p class="muted">Nothing refined yet.</p>');
  $("cleanPrompts").disabled = p.cleaning;
  $("cleanPrompts").onclick = () => runJob("/api/prompts/clean", "Prompt librarian", "Grouping your prompts into reusable templates…", $("lt-prompts").querySelector(".mascot").parentElement);
}

/* ---------- link with Claude Desktop ---------- */
let LINKMSGS = [], linkUnread = 0;
async function loadLink(){
  $("linkArt").innerHTML = mascot("desk", "Claude Desktop");
  const r = await api("/api/link").catch(() => ({messages:[], config:{}}));
  LINKMSGS = r.messages || []; if (document.activeElement !== $("linkTarget")) $("linkTarget").value = (r.config||{}).target || "";
  linkUnread = 0; drawLinkBadge(); drawLink();
}
function drawLinkBadge(){ $("linkBadge").hidden = !linkUnread; $("linkBadge").textContent = linkUnread; }
function drawLink(){
  const st = m => m.from !== "app" ? "" : m.status === "sending" ? "Sending…" : m.status === "failed" ? `Not delivered: ${m.error||""}` : "Delivered";
  $("linkMsgs").innerHTML = LINKMSGS.map(m => {
    const mine = m.from === "app";
    const task = m.kind === "task" ? `<span class="chip" style="margin-left:6px">Task</span>` : "";
    const open = m.chat ? `<div style="margin-top:6px"><button class="linkish" type="button" data-open="${esc(m.chat)}">Open the chat it started</button></div>` : (m.run && !mine ? `<div class="muted" style="font-size:12px;margin-top:6px">Started a chat here.</div>` : "");
    return `<div class="card link-msg ${mine?"mine":""}"><div class="row" style="gap:8px">${mine?"":`<span style="width:30px">${mascot("desk")}</span>`}<b>${mine ? "You" : "Claude Desktop"}</b>${task}<span class="spacer"></span><span class="muted" style="font-size:12px">${ago(m.at)}</span></div><div class="md">${md(m.text)}</div>${mine?`<div class="from">${esc(st(m))}</div>`:""}${open}</div>`;
  }).join("") || `<div class="empty" style="margin:20px auto"><div style="width:90px">${mascot("desk")}</div><p>No messages yet. Say hi to Claude in the desktop app, or send it a task.</p></div>`;
}
$("linkMsgs").onclick = e => { const b = e.target.closest("[data-open]"); if (b) openSession(b.dataset.open); };
$("linkSave").onclick = async () => {
  const r = await api("/api/link/config", {method:"POST", body:JSON.stringify({target:$("linkTarget").value})}).catch(() => ({error: OFFLINE_MSG}));
  if (!r || r.error || typeof r.target !== "string") return toast("Not saved", (r && r.error) || "The Wise Hive didn't confirm the change.");
  $("linkTarget").value = r.target; toast("Saved", `Messages go to “${r.target}”.`);
};
$("linkSend").onclick = async () => {
  const typed = $("linkText").value, text = typed.trim(); if (!text) return $("linkText").focus();
  $("linkText").value = "";
  const r = await api("/api/link/send", {method:"POST", body:JSON.stringify({text, kind: $("linkTask").checked ? "task" : "message"})}).catch(() => ({error: OFFLINE_MSG}));
  if (r && !r.error) return;
  // Not sent: give the typed text back (ahead of anything typed since) so it isn't lost.
  const now = $("linkText").value; $("linkText").value = now ? typed + "\n" + now : typed;
  toast("Not sent", (r && r.error) || "The Wise Hive didn't take the message.");
};
$("linkText").addEventListener("keydown", e => { if (e.key === "Enter" && e.ctrlKey) $("linkSend").click(); });

/* ---------- activity ---------- */
const projName = cwd => !cwd ? "" : /scratch-workspaces/i.test(cwd) ? "No folder" : cwd.split("\\").pop();
const dur = ms => { const s = Math.max(0, Math.round(ms/1000)); return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s/60)}m ${s%60}s` : `${Math.floor(s/3600)}h ${Math.floor(s%3600/60)}m`; };
let ACT = {runs:[], jobs:[]};
async function refreshActivityBadge(){
  try { ACT = await api("/api/activity"); } catch { return; }
  const needs = ACT.runs.reduce((n, r) => n + (r.done ? 0 : r.pending.length), 0);
  $("actBadge").hidden = !needs; $("actBadge").textContent = needs;
  if (!$("v-activity").hidden) drawActivity();
}
async function loadActivity(){ $("actArt").innerHTML = mascot("researcher","Activity"); await refreshActivityBadge(); drawActivity(); }
// Each list is rebuilt only when what it shows changes (rebuilding every second lost clicks, focus and a pressed Stop); the
// times in it ("running for", "… ago") are spans that actTick fills in, and the 1-second timer only re-runs actTick.
const actSet = (id, html) => { const el = $(id); if (el._html !== html) el.innerHTML = el._html = html; };
function actTick(){
  document.querySelectorAll("#v-activity [data-started]").forEach(s => { s.textContent = dur(Date.now() - s.dataset.started); });
  document.querySelectorAll("#v-activity [data-ago]").forEach(s => { s.textContent = ago(new Date(+s.dataset.ago).toISOString()); });
}
// Runs the user pressed Stop on: the button stays disabled until the run ends (or the stop request fails).
const actStopping = new Set();
function drawActivity(){
  SCENE.activity && SCENE.activity.update({ working: ACT.runs.filter(r => !r.done).map(r => ({title: r.title, kind: r.kind || "chat"})), jobs: ACT.jobs.map(j => ({label: j.label})),
    needs: ACT.runs.reduce((n, r) => n + (r.done ? 0 : r.pending.length), 0) });
  const open = id => id ? `<button class="btn small" type="button" data-open="${esc(id)}">Open chat</button>` : "";
  const from = r => r.from === "desktop" ? " · handed over from Claude Desktop" : "";
  const since = t => `<span data-started="${esc(t)}"></span>`;
  const needs = ACT.runs.filter(r => !r.done).flatMap(r => r.pending.map(p => ({r, p})));
  actSet("actNeeds", needs.map(({r, p}) => `<div class="act need"><span class="mini working">${mascot("claude")}</span><div class="t"><b>${p.kind === "ask" ? "Claude has a question" : `Claude wants to use ${esc(prettyTool(p.tool))}`}</b><small>${esc(p.summary || "")} · ${esc(r.title)}</small></div>${open(r.chatId)}</div>`).join("") || `<div class="none">Nothing is waiting on you.</div>`);
  const working = ACT.runs.filter(r => !r.done);
  for (const id of actStopping) if (!working.some(r => r.id === id)) actStopping.delete(id);
  actSet("actWorking", working.map(r => `<div class="act"><span class="mini working">${mascot("claude")}</span><div class="t"><b>${esc(r.title)}</b><small>${esc(projName(r.cwd))} · running for ${since(r.started)}${from(r)}</small></div>${open(r.chatId)}<button class="btn small" type="button" data-stop="${esc(r.id)}"${actStopping.has(r.id) ? " disabled" : ""}>Stop</button></div>`).join("") || `<div class="none">No chats are running.</div>`);
  actSet("actJobs", ACT.jobs.map(j => `<div class="act"><span class="mini working">${mascot(({Librarian:"librarian", Organizer:"organizer", Refiner:"refiner", Clarifier:"clarifier", Judge:"judge", "Council member":"believer", "Link relay":"desk", "Prompt librarian":"refiner", Trainer:"trainer", Foreman:"foreman", Inventor:"inventor"})[j.label] || "claude")}</span><div class="t"><b>${esc(j.label)}</b><small>running for ${since(j.started)}</small></div></div>`).join("") || `<div class="none">No background agents running.</div>`);
  const done = ACT.runs.filter(r => r.done).sort((a, b) => (b.ended||0) - (a.ended||0)).slice(0, 15);
  actSet("actDone", done.map(r => `<div class="act"><span class="mini">${mascot("claude")}</span><div class="t"><b>${esc(r.title)}</b><small>${r.code ? "Stopped" : "Finished"} <span data-ago="${esc(r.ended || r.started)}"></span> · took ${dur((r.ended||r.started) - r.started)}${typeof r.cost === "number" ? ` · est. $${r.cost.toFixed(r.cost < 0.1 ? 3 : 2)} at API prices` : ""}${from(r)}</small></div>${open(r.chatId)}</div>`).join("") || `<div class="none">Nothing finished in the last 30 minutes.</div>`);
  actTick();
}
$("v-activity").addEventListener("click", e => {
  const o = e.target.closest("[data-open]"); if (o) return openSession(o.dataset.open);
  const s = e.target.closest("[data-stop]");
  if (!s) return;
  const id = s.dataset.stop, failed = () => { actStopping.delete(id); $("actWorking")._html = null; }; // redrawn with Stop enabled again
  s.disabled = true; actStopping.add(id);
  api(`/api/runs/${id}/stop`, {method:"POST", body:"{}"}).then(r => { if (r && r.error) failed(); }, failed).then(refreshActivityBadge);
});
setInterval(() => { if (!$("v-activity").hidden) actTick(); }, 1000);

/* ---------- projects ---------- */
let PROJS = [];
async function loadProjects(){
  $("projArt").innerHTML = mascot("organizer","Projects");
  try { PROJS = await api("/api/projects"); } catch { PROJS = []; }
  $("projList").innerHTML = PROJS.map((p, i) => `<article class="card proj"><div class="row" style="gap:10px"><h3>${esc(p.name)}</h3>${p.claudeMd ? `<span class="chip" title="This folder has its own CLAUDE.md">CLAUDE.md</span>` : ""}<span class="spacer"></span><span class="muted" style="font-size:12px">${p.chats} chat${p.chats===1?"":"s"}${p.last ? " · " + ago(p.last) : ""}</span></div>
    <div class="path">${esc(p.dir)}</div>
    ${p.recent.length ? `<div class="recent">${p.recent.map(c => `<button type="button" data-open="${esc(c.id)}" title="${esc(c.title)}">${esc(c.title)}</button>`).join("")}</div>` : `<div class="none">No chats in this folder yet.</div>`}
    <div class="row"><button class="btn small primary" type="button" data-new="${i}">New chat here</button>${p.doc ? `<button class="btn small" type="button" data-notes="${i}">Project notes</button>` : ""}</div>
    <div class="notes md" id="notes-${i}" hidden></div></article>`).join("") || `<div class="none">No project folders found.</div>`;
}
$("projList").addEventListener("click", e => {
  const o = e.target.closest("[data-open]"); if (o) return openSession(o.dataset.open);
  const n = e.target.closest("[data-new]"); if (n) { const p = PROJS[+n.dataset.new]; show("chats"); if (![...$("chatFolderPick").options].some(o => o.value === p.dir)) $("chatFolderPick").insertAdjacentHTML("beforeend", `<option value="${esc(p.dir)}">${esc(p.name)}</option>`); freshChat(p.dir); return; }
  const d = e.target.closest("[data-notes]"); if (d) { const el = $("notes-" + d.dataset.notes); if (el.hidden) el.innerHTML = md(PROJS[+d.dataset.notes].doc.text); el.hidden = !el.hidden; d.textContent = el.hidden ? "Project notes" : "Hide notes"; }
});

/* ---------- sketch board ---------- */
const SK = { shapes: [], past: [], future: [], tool: "pen", color: "#e9ebef", size: 4, draft: null, erasing: false, ready: false, lastImage: null, lastFile: "", lastSummary: "", lastTitle: "" };
const ic = d => `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const SK_TOOLS = [
  ["pen","Pen","p", ic('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>')],
  ["line","Line","l", ic('<path d="M5 19L19 5"/>')],
  ["arrow","Arrow","a", ic('<path d="M5 19L19 5M10 5h9v9"/>')],
  ["rect","Rectangle","r", ic('<rect x="4" y="6" width="16" height="12" rx="1.5"/>')],
  ["ellipse","Ellipse","e", ic('<ellipse cx="12" cy="12" rx="9" ry="6.5"/>')],
  ["text","Text","t", ic('<path d="M5 6V4h14v2M12 4v16M9 20h6"/>')],
  ["eraser","Eraser","x", ic('<path d="M7 21h10M5 15l9-9 5 5-7 7H9z"/>')],
];
const SK_COLORS = [["#e9ebef","White"],["#e5896a","Orange"],["#e9b949","Yellow"],["#5cc28a","Green"],["#5aa9e6","Blue"],["#c38ae0","Purple"],["#ef7a72","Red"]];
const SK_SIZES = [2, 4, 9];
const skCanvas = () => $("skCanvas"), skCtx = () => $("skCanvas").getContext("2d");
function skInit(){
  if (SK.ready) return; SK.ready = true;
  $("skArt").innerHTML = mascot("claude", "Claude");
  $("skTools").innerHTML = SK_TOOLS.map(([k, n, key, svg]) => `<button class="tbtn" type="button" data-tool="${k}" title="${n} (${key.toUpperCase()})" aria-label="${n}" aria-pressed="${k===SK.tool}">${svg}</button>`).join("");
  $("skColors").innerHTML = SK_COLORS.map(([c, n]) => `<button class="swatch" type="button" data-color="${c}" title="${n}" aria-label="${n}" aria-pressed="${c===SK.color}" style="background:${c}"></button>`).join("");
  $("skSizes").innerHTML = SK_SIZES.map(s => `<button class="sizebtn" type="button" data-size="${s}" title="${["Thin","Medium","Thick"][SK_SIZES.indexOf(s)]}" aria-label="${["Thin","Medium","Thick"][SK_SIZES.indexOf(s)]} line" aria-pressed="${s===SK.size}"><i style="width:${s+3}px;height:${s+3}px"></i></button>`).join("");
  try { SK.shapes = JSON.parse(localStorage.getItem("hive-sketch") || "[]"); } catch { SK.shapes = []; }
  const c = skCanvas();
  c.addEventListener("pointerdown", skDown); c.addEventListener("pointermove", skMove); c.addEventListener("pointerup", skUp); c.addEventListener("pointercancel", skUp);
  new ResizeObserver(skResize).observe($("skBoard"));
  skResize(); loadSketches();
}
function skPick(attr, val){ document.querySelectorAll(`[data-${attr}]`).forEach(b => b.setAttribute("aria-pressed", String(b.dataset[attr] === String(val)))); }
$("v-sketch").addEventListener("click", e => {
  const t = e.target.closest("[data-tool]"); if (t) { SK.tool = t.dataset.tool; skPick("tool", SK.tool); skCanvas().style.cursor = SK.tool === "text" ? "text" : SK.tool === "eraser" ? "cell" : "crosshair"; return; }
  const c = e.target.closest("[data-color]"); if (c) { SK.color = c.dataset.color; skPick("color", SK.color); return; }
  const s = e.target.closest("[data-size]"); if (s) { SK.size = +s.dataset.size; skPick("size", SK.size); return; }
  const g = e.target.closest("[data-sketch]"); if (g) return showPastSketch(g.dataset.sketch);
});
function skResize(){
  const b = $("skBoard"), c = skCanvas(), dpr = window.devicePixelRatio || 1;
  if (!b.clientWidth) return;
  c.width = Math.round(b.clientWidth * dpr); c.height = Math.round(b.clientHeight * dpr);
  skCtx().setTransform(dpr, 0, 0, dpr, 0, 0); skDraw();
}
function skShape(ctx, s){
  ctx.strokeStyle = ctx.fillStyle = s.color; ctx.lineWidth = s.size; ctx.lineCap = ctx.lineJoin = "round";
  if (s.type === "pen") { ctx.beginPath(); s.pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); if (s.pts.length === 1) ctx.lineTo(s.pts[0][0] + .1, s.pts[0][1] + .1); ctx.stroke(); }
  else if (s.type === "line" || s.type === "arrow") {
    ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke();
    if (s.type === "arrow") { const a = Math.atan2(s.y2 - s.y1, s.x2 - s.x1), L = 10 + s.size * 2.2; ctx.beginPath(); ctx.moveTo(s.x2 - L * Math.cos(a - .45), s.y2 - L * Math.sin(a - .45)); ctx.lineTo(s.x2, s.y2); ctx.lineTo(s.x2 - L * Math.cos(a + .45), s.y2 - L * Math.sin(a + .45)); ctx.stroke(); }
  }
  else if (s.type === "rect") ctx.strokeRect(Math.min(s.x1, s.x2), Math.min(s.y1, s.y2), Math.abs(s.x2 - s.x1), Math.abs(s.y2 - s.y1));
  else if (s.type === "ellipse") { ctx.beginPath(); ctx.ellipse((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2, Math.abs(s.x2 - s.x1) / 2, Math.abs(s.y2 - s.y1) / 2, 0, 0, Math.PI * 2); ctx.stroke(); }
  else if (s.type === "text") { ctx.font = `600 ${skFont(s)}px Nunito, "Segoe UI", sans-serif`; ctx.textBaseline = "top"; ctx.fillText(s.text, s.x, s.y); }
}
const skFont = s => 13 + s.size * 2.5;
function skDraw(){
  const c = skCanvas(), ctx = skCtx();
  ctx.clearRect(0, 0, c.width, c.height);
  for (const s of SK.shapes) skShape(ctx, s);
  if (SK.draft) skShape(ctx, SK.draft);
}
function skCommit(mutate){
  SK.past.push(JSON.stringify(SK.shapes)); if (SK.past.length > 100) SK.past.shift(); SK.future = [];
  mutate(); skSave(); skDraw();
}
function skSave(){ try { localStorage.setItem("hive-sketch", JSON.stringify(SK.shapes)); } catch {} SK.lastImage = null; }
function skPos(e){ const r = skCanvas().getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
// Bounding box of a shape, for erasing and for cropping the image Claude sees.
function skBox(s){
  if (s.type === "pen") { const xs = s.pts.map(p => p[0]), ys = s.pts.map(p => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; }
  if (s.type === "text") { const ctx = skCtx(); ctx.font = `600 ${skFont(s)}px Nunito, "Segoe UI", sans-serif`; return [s.x, s.y, s.x + ctx.measureText(s.text).width, s.y + skFont(s) * 1.2]; }
  return [Math.min(s.x1, s.x2), Math.min(s.y1, s.y2), Math.max(s.x1, s.x2), Math.max(s.y1, s.y2)];
}
function skHit(s, [x, y]){
  const pad = 8 + s.size;
  if (s.type === "pen") return s.pts.some(([px, py]) => Math.hypot(px - x, py - y) < pad);
  if (s.type === "line" || s.type === "arrow") { const dx = s.x2 - s.x1, dy = s.y2 - s.y1, t = Math.max(0, Math.min(1, ((x - s.x1) * dx + (y - s.y1) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(s.x1 + t * dx - x, s.y1 + t * dy - y) < pad; }
  const [a, b, c, d] = skBox(s); return x > a - pad && x < c + pad && y > b - pad && y < d + pad;
}
function skErase(p){ const i = SK.shapes.map((s, k) => [s, k]).reverse().find(([s]) => skHit(s, p)); if (i) { if (!SK.erasing) { SK.past.push(JSON.stringify(SK.shapes)); SK.future = []; SK.erasing = true; } SK.shapes.splice(i[1], 1); skSave(); skDraw(); } }
function skDown(e){
  const p = skPos(e);
  if (SK.tool === "text") { e.preventDefault(); return skTextAt(p); }
  skCanvas().setPointerCapture(e.pointerId);
  if (SK.tool === "eraser") { SK.erasing = false; SK.erasingDrag = true; return skErase(p); }
  SK.draft = SK.tool === "pen" ? {type:"pen", color:SK.color, size:SK.size, pts:[p]} : {type:SK.tool, color:SK.color, size:SK.size, x1:p[0], y1:p[1], x2:p[0], y2:p[1]};
  skDraw();
}
function skMove(e){
  if (SK.erasingDrag) return skErase(skPos(e));
  if (!SK.draft) return;
  const p = skPos(e);
  if (SK.draft.type === "pen") SK.draft.pts.push(p);
  else { SK.draft.x2 = p[0]; SK.draft.y2 = p[1];
    if (e.shiftKey && (SK.draft.type === "rect" || SK.draft.type === "ellipse")) { const d = Math.max(Math.abs(p[0] - SK.draft.x1), Math.abs(p[1] - SK.draft.y1)); SK.draft.x2 = SK.draft.x1 + Math.sign(p[0] - SK.draft.x1 || 1) * d; SK.draft.y2 = SK.draft.y1 + Math.sign(p[1] - SK.draft.y1 || 1) * d; } }
  skDraw();
}
function skUp(){
  if (SK.erasingDrag) { SK.erasingDrag = false; SK.erasing = false; return; }
  const d = SK.draft; SK.draft = null; if (!d) return;
  const big = d.type === "pen" || Math.hypot(d.x2 - d.x1, d.y2 - d.y1) > 4;
  if (big) skCommit(() => SK.shapes.push(d)); else skDraw();
}
function skTextAt([x, y]){
  const inp = $("skTextInput"); inp.value = ""; inp.hidden = false;
  inp.style.left = x + "px"; inp.style.top = (y - 6) + "px"; inp.style.color = SK.color; inp.style.fontSize = skFont({size:SK.size}) + "px";
  inp.dataset.x = x; inp.dataset.y = y; setTimeout(() => inp.focus(), 0);
}
function skTextDone(keep){
  const inp = $("skTextInput"); if (inp.hidden) return;
  const t = inp.value.trim(); inp.hidden = true;
  if (keep && t) skCommit(() => SK.shapes.push({type:"text", text:t, x:+inp.dataset.x, y:+inp.dataset.y, color:SK.color, size:SK.size}));
}
$("skTextInput").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); skTextDone(true); } if (e.key === "Escape") skTextDone(false); });
$("skTextInput").addEventListener("blur", () => skTextDone(true));
function skUndo(){ if (!SK.past.length) return; SK.future.push(JSON.stringify(SK.shapes)); SK.shapes = JSON.parse(SK.past.pop()); skSave(); skDraw(); }
function skRedo(){ if (!SK.future.length) return; SK.past.push(JSON.stringify(SK.shapes)); SK.shapes = JSON.parse(SK.future.pop()); skSave(); skDraw(); }
$("skUndo").onclick = skUndo; $("skRedo").onclick = skRedo;
$("skClear").onclick = () => { if (SK.shapes.length) skCommit(() => SK.shapes = []); };
document.addEventListener("keydown", e => {
  if ($("v-sketch").hidden || e.target.closest("input,textarea,select")) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); return e.shiftKey ? skRedo() : skUndo(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); return skRedo(); }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const t = SK_TOOLS.find(x => x[2] === e.key.toLowerCase()); if (t) document.querySelector(`[data-tool="${t[0]}"]`).click();
});
// The image Claude sees: just the drawing, cropped with a margin, on the board's dark background, at most 1600 px.
function skExport(){
  if (!SK.shapes.length) return null;
  const boxes = SK.shapes.map(skBox), m = 40;
  let [x0, y0, x1, y1] = [Math.min(...boxes.map(b => b[0])) - m, Math.min(...boxes.map(b => b[1])) - m, Math.max(...boxes.map(b => b[2])) + m, Math.max(...boxes.map(b => b[3])) + m];
  const w = Math.max(200, x1 - x0), h = Math.max(150, y1 - y0), k = Math.min(2, 1600 / Math.max(w, h));
  const c = document.createElement("canvas"); c.width = Math.round(w * k); c.height = Math.round(h * k);
  const ctx = c.getContext("2d"); ctx.fillStyle = "#15181c"; ctx.fillRect(0, 0, c.width, c.height);
  ctx.setTransform(k, 0, 0, k, -x0 * k, -y0 * k);
  for (const s of SK.shapes) skShape(ctx, s);
  return c.toDataURL("image/png").split(",")[1];
}
$("skShow").onclick = async () => {
  const image = skExport();
  if (!image) return toast("The board is empty", "Draw something first, then show Claude.");
  const out = $("skOut"); out.hidden = false; $("skUseRow").hidden = true;
  out.innerHTML = `<div class="row" style="gap:8px"><span class="mini working" style="width:26px">${mascot("claude")}</span><span class="muted">Claude is looking at your sketch…</span></div>`;
  $("skShow").disabled = true; $("skArt").classList.add("working"); setBusy(1);
  let r; try { r = await api("/api/sketch", {method:"POST", body:JSON.stringify({image, note:$("skNote").value.trim(), title:$("skTitle").value.trim()})}); } catch { r = {error:"Lost connection to The Wise Hive. Try again in a moment."}; }
  $("skShow").disabled = false; $("skArt").classList.remove("working"); setBusy(-1);
  if (r.error) { out.innerHTML = `<p style="color:var(--bad);margin:0">${esc(r.error)}</p>`; return; }
  SK.lastImage = image; SK.lastFile = r.file; SK.lastSummary = r.summary; SK.lastTitle = r.title;
  out.innerHTML = `<b style="font-family:var(--f-display)">${esc(r.title)}</b><div class="md">${md(r.summary)}</div>`; $("skUseRow").hidden = false;
  loadSketches();
};
$("skUse").onclick = async () => {
  let data = SK.lastImage;
  if (!data && SK.lastFile) { const buf = await (await fetch("/sketch/" + encodeURIComponent(SK.lastFile))).arrayBuffer(); let s = ""; new Uint8Array(buf).forEach(b => s += String.fromCharCode(b)); data = btoa(s); }
  if (!data) return;
  show("chats"); freshChat();
  attachments.push({name: SK.lastFile || "sketch.png", type: "image/png", data}); drawAttachments();
  $("prompt").value = `Here's a sketch of my idea${SK.lastTitle ? ` ("${SK.lastTitle}")` : ""}. When you looked at it, you read it like this:\n\n${SK.lastSummary}\n\n`;
  $("prompt").focus(); $("prompt").dispatchEvent(new Event("input"));
};
let SKETCHLIST = [];
async function loadSketches(){
  try { SKETCHLIST = await api("/api/sketches"); } catch { SKETCHLIST = []; }
  $("skGallery").innerHTML = SKETCHLIST.map(s => `<button type="button" data-sketch="${esc(s.file)}" title="${esc(s.title)}"><img src="/sketch/${encodeURIComponent(s.file)}" alt="" loading="lazy"><span>${esc(s.title)}</span></button>`).join("") || `<div class="none" style="grid-column:1/-1">Sketches you show Claude are saved here.</div>`;
}
function showPastSketch(file){
  const s = SKETCHLIST.find(x => x.file === file); if (!s) return;
  SK.lastImage = null; SK.lastFile = s.file; SK.lastSummary = s.summary; SK.lastTitle = s.title;
  $("skOut").hidden = false; $("skUseRow").hidden = !s.summary;
  $("skOut").innerHTML = `<img src="/sketch/${encodeURIComponent(s.file)}" alt="" style="width:100%;border-radius:8px;margin-bottom:8px"><b style="font-family:var(--f-display)">${esc(s.title)}</b><div class="md">${s.summary ? md(s.summary) : '<span class="muted">No summary saved.</span>'}</div>`;
}

/* ---------- settings & health ---------- */
async function loadSettings(refresh){
  $("setArt").innerHTML = mascot("builder","Settings");
  if (!refresh && $("healthCards").innerHTML) { /* keep showing the last result while checking */ } else $("healthCards").innerHTML = `<div class="none">Checking…</div>`;
  let s; try { s = await api("/api/system" + (refresh ? "?refresh=1" : "")); } catch { $("healthCards").innerHTML = `<div class="none">Can't reach The Wise Hive server.</div>`; return; }
  const card = (cls, title, st, small) => `<div class="card hc ${cls}"><b style="font-family:var(--f-display)">${title}</b><span class="st">${st}</span><small>${small}</small></div>`;
  const bad = s.claude.mcp.filter(m => !m.ok);
  $("healthCards").innerHTML = [
    card("", "The Wise Hive server", "Running", `Up for ${dur(Date.now() - s.server.started)} · ${s.server.electron ? "desktop app (Electron " + s.server.electron + ")" : "standalone"} · ${s.server.runs} chat${s.server.runs===1?"":"s"} and ${s.server.jobs} agent${s.server.jobs===1?"":"s"} working`),
    card(s.watchdog.installed ? "" : "bad", "Always on", s.watchdog.installed ? "Watchdog active" : "Watchdog missing", s.watchdog.installed ? `Checks every 2 minutes and restarts The Wise Hive if needed. Next check ${esc(s.watchdog.next)}.` : "The Wise Hive won't come back on its own if it closes."),
    card(s.autostart ? "" : "warn", "Start with Windows", s.autostart ? "On" : "Off", s.autostart ? "The Wise Hive starts in the tray when you sign in." : "Turn it on from the tray icon's menu."),
    card(/\d/.test(s.claude.version) ? "" : "bad", "Claude Code", /\d/.test(s.claude.version) ? esc(s.claude.version) : "Not found", "The engine every chat runs on."),
    card(bad.length ? "warn" : "", "Connected tools", bad.length ? `${bad.length} not connected` : `All ${s.claude.mcp.length} connected`, bad.length ? esc(bad.map(m => m.name).join(", ")) + (bad.some(m => /Roblox/i.test(m.name)) ? " (Roblox Studio connects when Studio is open)" : "") : "Blender, Roblox and the rest are reachable."),
  ].join("");
  $("setDot").hidden = s.watchdog.installed && /\d/.test(s.claude.version);
  $("mcpList").innerHTML = s.claude.mcp.map(m => `<div class="${m.ok ? "" : "off"}" title="${esc(m.detail || "Connected")}"><i></i><span>${esc(m.name.replace(/^claude\.ai /, ""))}</span></div>`).join("") || `<div class="none">No tools found.</div>`;
  $("mcpAt").textContent = s.claude.mcpCheckedAt ? "Checked " + ago(new Date(s.claude.mcpCheckedAt).toISOString()) : "";
  $("logTail").textContent = s.log || "(empty)"; $("logTail").scrollTop = $("logTail").scrollHeight;
}
$("setRefresh").onclick = () => { $("setRefresh").disabled = true; loadSettings(true).finally(() => $("setRefresh").disabled = false); };

/* ---------- live updates from the server ---------- */
let sessionsTimer = null;
function onGlobal(ev){
  hiveEvent("hive:server", ev); // feature modules (autopilot, ideas, updates) listen for their own event types
  if (ev.t === "link") {
    const i = LINKMSGS.findIndex(m => m.id === ev.msg.id);
    if (i >= 0) LINKMSGS[i] = ev.msg; else { LINKMSGS.push(ev.msg); if (ev.msg.from !== "app") { if ($("v-link").hidden) { linkUnread++; drawLinkBadge(); toast(ev.msg.kind === "task" ? "Task from Claude Desktop" : "Message from Claude Desktop", String(ev.msg.text || "").slice(0, 140), () => show("link")); } } }
    if (!$("v-link").hidden) drawLink();
  }
  if (ev.t === "runs") { loadRunning(); refreshActivityBadge(); clearTimeout(sessionsTimer); sessionsTimer = setTimeout(loadSessions, 1500); }
  if (ev.t === "hello") { showConn(false); if (wasDown) { wasDown = false; loadSessions(); loadRunning(); loadStats(); } }
}
let wasDown = false;
(async function listen(){
  for (;;) {
    try { await stream("/api/events", {}, onGlobal); } catch {}
    // The server's event stream closed: we're disconnected until it answers again.
    wasDown = true; showConn(true);
    await new Promise(r => setTimeout(r, 1500));
  }
})();

/* ---------- boot ---------- */
drawHome(); drawChat(); drawOptsSummary(); setRunButtons();
if (mountScene("library", "sceneLibrary", "library")) $("librarySceneWrap").hidden = false;
if (mountScene("activity", "sceneActivity", "activity")) $("activitySceneWrap").hidden = false;
refreshActivityBadge();
Promise.all([loadStats(), loadFolders(), loadSessions(), loadRunning()]).catch(() => { $("queenStats").textContent = "Can't reach The Wise Hive server. Start it with The Wise Hive shortcut."; });
// Restore the last tab once the feature modules below have loaded and are listening for "hive:view".
window.addEventListener("load", () => { try { const v = localStorage.getItem("hive-view"); if (v && v !== "home" && $("v-" + v)) show(v); } catch {} });
