/* Library -> Skillsmith (server side: skillsmith.js). "Find new skills" (asks first, like Trim notes) turns proven
   lessons into Claude skills after a strict review. The card lists skills it added (score, why, the lessons behind
   them, Remove) and ideas it turned down with the reviewer's reasons. */
(function () {
  "use strict";
  if (typeof $ !== "function" || typeof runJob !== "function" || typeof mascot !== "function" || !$("organize")) return;
  const style = document.createElement("style");
  style.textContent = `
.sm-card{margin-top:10px}
.sm-skill{border-top:1px solid var(--line);padding:6px 0;font-size:13px}
.sm-skill b{font-family:var(--f-mono);font-size:12.5px}
.sm-skill .sm-score{font:11px var(--f-mono);color:var(--ok);margin-left:6px}
.sm-skill.gone{opacity:.55}
.sm-skill details{margin-top:2px;color:var(--muted);font-size:12px}
.sm-skill ul{margin:4px 0 0 18px;padding:0}
.sm-no{color:var(--muted);font-size:12px}
.sm-box{margin-left:auto;display:flex;align-items:center;gap:8px;flex:none}`;
  document.head.appendChild(style);

  // The button sits at the right end of the "Tidy the library" row; its confirmation opens under that row.
  const row = $("tidy").closest(".row");
  const box = document.createElement("span");
  box.className = "sm-box";
  box.innerHTML = `<span id="smArt" style="width:30px">${mascot("librarian", "The Skillsmith")}</span><button class="btn" id="smFind" type="button">Find new skills</button><span id="smHint" hidden></span>`;
  row.appendChild(box);
  const ask = document.createElement("div");
  ask.className = "row"; ask.hidden = true; ask.style.marginTop = "6px";
  row.after(ask);
  const card = document.createElement("div");
  card.className = "card stack sm-card"; card.hidden = true;
  (($("trimCard")) || $("tidyLog")).after(card);
  if (typeof JOBS !== "undefined" && Array.isArray(JOBS)) JOBS.push("smFind");

  const when = (iso) => { try { return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" }); } catch { return ""; } };
  function draw(d) {
    if (!d) return;
    $("smFind").title = `Turns your best, proven lessons into Claude skills; only skills an independent reviewer scores 8/10+ are added. ${d.newLessons} new lesson${d.newLessons === 1 ? "" : "s"} since the last look${d.auto ? ` (it looks on its own after ${d.autoAfter})` : ""}.`;
    const added = [], rejected = [];
    for (const h of d.history || []) { for (const a of h.added || []) added.push({ ...a, at: h.at }); for (const r of h.rejected || []) rejected.push({ ...r, at: h.at }); }
    if (!added.length && !rejected.length && !(d.history || []).length) { card.hidden = true; return; }
    card.hidden = false;
    card.innerHTML = `<b style="font-family:var(--f-display)">Skillsmith</b>${d.lastRun ? `<span class="muted" style="font-size:12px"> · last looked ${esc(when(d.lastRun))}</span>` : ""}
${added.length ? added.map((a) => `<div class="sm-skill${a.removed ? " gone" : ""}"><div class="row"><span><b>${esc(a.name)}</b><span class="sm-score">${esc(a.score)}/10</span> <span class="muted">${esc(when(a.at))}${a.project ? " · only in " + esc(a.project.split(/[\\/]/).pop()) : " · all projects"}</span></span><span class="spacer"></span>${a.removed ? `<span class="muted">removed</span>` : `<button class="btn small" type="button" data-rm="${esc(a.name)}" title="Moves it to librarian\\removed-skills (not deleted)">Remove</button>`}</div><div>${esc(a.description || "")}</div><details><summary>Why it was added</summary>${esc(a.reasons || "")}<ul>${(a.evidence || []).map((e) => `<li>${esc(e)}</li>`).join("")}</ul></details></div>`).join("") : `<p class="sm-no">No skills added yet: nothing has met the bar.</p>`}
${rejected.length ? `<details class="sm-no"><summary>Turned down (${rejected.length})</summary>${rejected.slice(0, 20).map((r) => `<div class="sm-skill"><b>${esc(r.name)}</b>${r.score ? `<span class="sm-score" style="color:var(--warn)">${esc(r.score)}/10</span>` : ""} <span class="muted">${esc(when(r.at))}</span><div>${esc(r.why || "")}</div></div>`).join("")}</details>` : ""}`;
  }
  const load = () => api("/api/skillsmith").then(draw).catch(() => {});
  card.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-rm]");
    if (!b) return;
    b.disabled = true;
    const r = await api("/api/skillsmith/remove", { method: "POST", body: JSON.stringify({ name: b.dataset.rm }) }).catch(() => ({ error: "lost" }));
    if (typeof toast === "function") toast(r.error ? "Couldn't remove it" : "Skill removed", r.error || "Moved to librarian\\removed-skills; new chats won't load it.");
    load(); if (typeof loadLibrary === "function") loadLibrary();
  });
  const closeAsk = () => { ask.hidden = true; $("smFind").hidden = false; $("smFind").focus(); };
  // runJob disables every JOBS button while a library job runs (cleanPrompts is also off while the server cleans the
  // prompt library by itself, which doesn't touch the notes).
  const jobRunning = () => typeof JOBS !== "undefined" && Array.isArray(JOBS) && JOBS.some((id) => id !== "cleanPrompts" && $(id) && $(id).disabled);
  $("smFind").onclick = async () => {
    const d = await api("/api/skillsmith").catch(() => null);
    if (d && d.running) { if (typeof toast === "function") toast("The Skillsmith is already looking", ""); return; }
    ask.innerHTML = `<span style="width:30px"></span><span style="font-size:13px;flex:1;min-width:0">Look through your lessons for skills? It uses ${window.HIVE_LITE ? "Sonnet" : "Opus"} for a few minutes and adds only skills that pass a strict review; you can remove any of them.</span><button class="btn primary small" type="button" id="smYes">Find skills</button><button class="btn small" type="button" id="smNo">Cancel</button>`;
    $("smFind").hidden = true; ask.hidden = false; $("smYes").focus();
    $("smNo").onclick = closeAsk;
    $("smYes").onclick = async () => {
      if (jobRunning()) { if (typeof toast === "function") toast("Another library job is running", "Wait for it to finish, then click Find skills again."); return; }
      ask.hidden = true; $("smFind").hidden = false;
      await runJob("/api/skillsmith", "Skillsmith", "Reading the lessons…", $("smArt"));
      load();
    };
  };
  ask.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAsk(); });
  load();
})();
