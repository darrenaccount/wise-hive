/* Library -> "Trim notes" (server side: trim.js). One button under Tidy/Organize: Claude rewrites the brain's notes in
   fewer words without losing information, so recalling them costs less. A card below shows the last trim: words
   before -> after per file, files the safety check put back (and what they had lost), and Undo (all or one file). */
(function () {
  "use strict";
  if (typeof $ !== "function" || typeof runJob !== "function" || typeof mascot !== "function" || !$("organize")) return;
  const style = document.createElement("style");
  style.textContent = `
.trim-card{margin-top:10px}
.trim-card table{width:100%;border-collapse:collapse;font-size:13px}
.trim-card td{padding:3px 6px;border-top:1px solid var(--line);vertical-align:top}
.trim-card td.n{font:12px var(--f-mono);white-space:nowrap;text-align:right;color:var(--muted)}
.trim-card .warn{color:var(--warn)}
.trim-card .ok{color:var(--ok)}`;
  document.head.appendChild(style);

  const orgRow = $("organize").closest(".row");
  const row = document.createElement("div");
  row.className = "row"; row.style.marginTop = "6px";
  row.innerHTML = `<span id="trimArt" style="width:30px">${mascot("organizer", "The Organizer")}</span><button class="btn" id="trimNotes" type="button">Trim notes</button><span class="muted" style="font-size:13px" id="trimHint">Rewrites your memories and notes in fewer words, keeping every detail, so recalling them uses less. Backed up first; undo any time.</span>`;
  orgRow.after(row);
  const card = document.createElement("div");
  card.className = "card stack trim-card"; card.id = "trimCard"; card.hidden = true;
  const log = $("tidyLog");
  log.after(card);
  if (typeof JOBS !== "undefined" && Array.isArray(JOBS)) JOBS.push("trimNotes"); // other library jobs disable it while they run

  const n = (x) => Number(x || 0).toLocaleString();
  const pct = (a, b) => (a ? Math.round((1 - b / a) * 100) : 0);
  function draw(d) {
    if (d && typeof d.words === "number") $("trimHint").textContent = `Rewrites your memories and notes in fewer words (now ${n(d.words)} words), keeping every detail, so recalling them uses less. Backed up first; undo any time.`;
    const r = d && d.report;
    if (!r || !Array.isArray(r.files)) { card.hidden = true; return; }
    const back = r.files.filter((f) => f.restored), undone = r.files.filter((f) => f.undone);
    card.hidden = false;
    card.innerHTML = `<div class="row"><b style="font-family:var(--f-display)">Last trim</b><span class="muted" style="font-size:12px">${esc(new Date(r.at).toLocaleString())}</span><span class="spacer"></span><button class="btn small" type="button" data-undo="">Undo all</button></div>
<p style="margin:2px 0 6px">${n(r.before)} → <b>${n(r.after)}</b> words (${pct(r.before, r.after)}% fewer).${back.length ? ` <span class="warn">${back.length} file${back.length === 1 ? " was" : "s were"} put back because a detail went missing.</span>` : ` <span class="ok">Every path, command, link and header survived.</span>`}${undone.length ? ` ${undone.length} undone.` : ""}</p>
<table>${r.files.map((f) => `<tr><td>${esc(f.file)}${f.restored ? `<div class="warn" style="font-size:12px">put back: lost ${esc(f.missing.slice(0, 4).join(", "))}${f.missing.length > 4 ? " …" : ""}</div>` : ""}${f.undone ? `<div class="muted" style="font-size:12px">undone</div>` : ""}</td><td class="n">${n(f.before)} → ${n(f.after)}</td><td class="n">${f.restored || f.undone ? "" : `<button class="btn small" type="button" data-undo="${esc(f.file)}" title="Put the original back">Undo</button>`}</td></tr>`).join("")}</table>`;
  }
  const load = () => api("/api/trim").then(draw).catch(() => {});
  card.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-undo]");
    if (!b) return;
    b.disabled = true;
    const r = await api("/api/trim/undo", { method: "POST", body: JSON.stringify(b.dataset.undo ? { file: b.dataset.undo } : {}) }).catch(() => ({ error: "lost" }));
    if (r.error) { if (typeof toast === "function") toast("Couldn't undo", r.error); b.disabled = false; return; }
    const kept = Array.isArray(r.skipped) ? r.skipped : [];
    if (typeof toast === "function") toast(kept.length ? `Put back all but ${kept.length}` : b.dataset.undo ? "Put back: " + b.dataset.undo : "Every trimmed note is back to its original",
      kept.length ? `Left as they are because they changed after the trim: ${kept.join(", ")}` : "");
    draw({ report: r.report }); load();
  });
  // Trim notes asks first: an inline confirmation says what will be rewritten, then Trim now / Cancel.
  const ask = document.createElement("div");
  ask.className = "row trim-ask"; ask.hidden = true; ask.style.marginTop = "6px";
  row.after(ask);
  const closeAsk = () => { ask.hidden = true; $("trimNotes").hidden = false; $("trimNotes").focus(); };
  // runJob disables every JOBS button while a library job runs (cleanPrompts is also off while the server cleans the
  // prompt library by itself, which doesn't touch the notes).
  const jobRunning = () => typeof JOBS !== "undefined" && Array.isArray(JOBS) && JOBS.some((id) => id !== "cleanPrompts" && $(id) && $(id).disabled);
  $("trimNotes").onclick = async () => {
    const d = await api("/api/trim").catch(() => null);
    if (d && d.running) { if (typeof toast === "function") toast("Trimming is already running", ""); return; }
    const files = d && d.files, w = d && d.words;
    ask.innerHTML = `<span style="width:30px"></span><span style="font-size:13px;flex:1;min-width:0">Rewrite ${files ? `<b>${n(files)} notes</b> (${n(w)} words)` : "your notes"} in fewer words? Uses some Claude usage now, saves it on every recall. Everything is backed up first, and you can undo.</span><button class="btn primary small" type="button" id="trimYes">Trim now</button><button class="btn small" type="button" id="trimNo">Cancel</button>`;
    $("trimNotes").hidden = true; ask.hidden = false; $("trimYes").focus();
    $("trimNo").onclick = closeAsk;
    $("trimYes").onclick = async () => {
      if (jobRunning()) { if (typeof toast === "function") toast("Another library job is running", "Wait for it to finish, then click Trim now again."); return; }
      ask.hidden = true; $("trimNotes").hidden = false;
      await runJob("/api/trim", "Trimmer", "Trimming the notes…", $("trimArt"));
      load();
    };
  };
  ask.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAsk(); });
  load();
})();
