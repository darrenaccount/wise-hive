/* Chat media: the page side of media.js. Pictures Claude shows appear inline under its reply (click to enlarge), files
   and folders as small buttons (Open when safe, Show in folder, Copy path), files it made this turn as a "Made" strip,
   and pictures its tools looked at under a collapsed "Looked at". Reopened chats get theirs back from the server's
   per-chat index (and older chats from a scan of their replies). Dedupe and placement live in media-core.js.
   window.HiveMedia = { add, html, open, restore }: index.html calls html() from msgHTML and add() on "media" events;
   open(list, i) shows any list of {url, name, ...} pictures in the lightbox. */
(function () {
  "use strict";
  const C = window.HiveMediaCore;
  if (!C) return;
  const PER_MSG = 8, LB_ID = "hmLightbox";
  const e = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const size = (n) => (!(n >= 0) ? "" : n < 1024 ? n + " B" : n < 1048576 ? Math.round(n / 1024) + " KB" : (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + " MB");
  const CURRENT = "Shown from the current file (the copy from that day is gone, or was never made)";
  const NO_OPEN = "Opening this kind of file is turned off for safety";
  // 12x12 pixel icons.
  const ICON = {
    open: '<svg viewBox="0 0 12 12" width="12" height="12" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M1 2h5v1H2v7h7V6h1v5H1zM7 1h4v4h-1V3L6 7 5 6l4-4H7z"/></svg>',
    folder: '<svg viewBox="0 0 12 12" width="12" height="12" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M1 2h4l1 1h5v7H1zM2 4v5h8V4z"/></svg>',
    copy: '<svg viewBox="0 0 12 12" width="12" height="12" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M3 1h7v7H9V2H3zM1 3h6v8H1zm1 1v6h4V4z"/></svg>',
    taste: '<svg viewBox="0 0 12 12" width="12" height="12" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M3 1h6v1h1v1h1v4H8v1h1v2H8v1H3v-1H2V9H1V3h1V2h1zm0 2v2h2V3zm4 0v2h2V3zM3 7v2h2V7z"/></svg>',
    obsidian: '<svg viewBox="0 0 12 12" width="12" height="12" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M5 0h2v1h1v2h1v2h1v3H9v2H8v1H7v1H5v-1H4v-1H3V8H2V5h1V3h1V1h1zm0 3v2H4v3h1v1h2V8h1V5H7V3z"/></svg>',
  };
  // Notes in the brain (it is an Obsidian vault) get an "Open in Obsidian" button. The vault path comes from obsidian.js.
  let VAULT = "";
  try { api("/api/obsidian/status").then((s) => { VAULT = String((s && s.vaultReady && s.vault) || "").toLowerCase(); }).catch(() => {}); } catch {}
  const inVault = (m) => !!VAULT && m.type === "file" && /\.md$/i.test(m.path || "") && String(m.path).toLowerCase().replace(/\//g, "\\").startsWith(VAULT + "\\");

  const style = document.createElement("style");
  style.textContent = `
.hm-main{margin-top:10px;display:flex;flex-direction:column;gap:8px;max-width:100%}
.hm-one{margin:0;max-width:100%}
.hm-img,.hm-th,.hm-tile{display:block;padding:0;border:2px solid var(--line);border-radius:6px;cursor:zoom-in;max-width:100%;overflow:hidden;position:relative;
  background:repeating-conic-gradient(#1c2027 0 25%,#15181d 0 50%) 0 0/16px 16px}
.hm-img:hover,.hm-img:focus-visible,.hm-th:hover,.hm-th:focus-visible,.hm-tile:hover,.hm-tile:focus-visible{border-color:var(--claude);box-shadow:0 0 0 3px var(--claude-glow);outline:none}
.hm-img img{display:block;max-width:100%;height:auto;max-height:420px;object-fit:contain}
.hm-img[style] img{width:100%}
.hm-img img.px,.hm-th img.px,.hm-tile img.px,.hm-lb img.px{image-rendering:pixelated}
.hm-cap{font:11px var(--f-mono);color:var(--muted);margin-top:4px;overflow-wrap:anywhere}
.hm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:6px;max-width:100%}
.hm-tile{aspect-ratio:1;width:100%}
.hm-tile img,.hm-th img{width:100%;height:100%;object-fit:contain;display:block}
.hm-more{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(16,18,22,.72);color:var(--ink);font:700 18px var(--f-mono)}
.hm-chips{display:flex;flex-wrap:wrap;gap:6px;max-width:100%}
.hm-file{display:inline-flex;align-items:center;gap:6px;max-width:100%;min-width:0;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:3px 4px 3px 6px;font-size:12px;color:var(--ink)}
.hm-ext{font:700 10px var(--f-mono);color:var(--claude);background:var(--claude-soft);border-radius:3px;padding:1px 4px;flex:none}
.hm-nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.hm-sz{color:var(--muted);font:11px var(--f-mono);flex:none}
.hm-b{width:24px;height:24px;flex:none;display:inline-flex;align-items:center;justify-content:center;border:1px solid transparent;border-radius:5px;background:none;color:var(--muted);cursor:pointer;padding:0}
.hm-b:hover,.hm-b:focus-visible{color:var(--ink);border-color:var(--line);background:var(--raised);outline:none}
.hm-strip{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:8px;max-width:100%}
.hm-lbl{font-size:12px;color:var(--muted);margin-right:2px}
.hm-th{width:56px;height:56px;flex:none}
.hm-seen{margin-top:8px;max-width:100%}
.hm-seen > summary{cursor:pointer;font-size:13px;color:var(--muted)}
.hm-seen .hm-strip{margin-top:6px}
.hm-gone{display:flex;align-items:center;justify-content:center;min-height:56px;min-width:56px;color:var(--muted);font:11px var(--f-mono);padding:8px;text-align:center;cursor:default}
.hm-lb{position:fixed;inset:0;z-index:70;background:rgba(8,9,11,.9);display:flex;flex-direction:column;align-items:center;justify-content:center;animation:hmFade .12s ease-out}
.hm-lb[hidden]{display:none}
body.hm-lb-on .toast{z-index:80}
@keyframes hmFade{from{opacity:0}}
.hm-lb figure{margin:0;display:flex;align-items:center;justify-content:center;max-width:92vw;max-height:calc(100vh - 120px)}
.hm-lb img{max-width:92vw;max-height:calc(100vh - 120px);object-fit:contain;background:repeating-conic-gradient(#1c2027 0 25%,#15181d 0 50%) 0 0/16px 16px;border:2px solid var(--line);border-radius:6px}
.hm-bar{position:absolute;left:0;right:0;bottom:0;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:8px;padding:12px 16px;font:12px var(--f-mono);color:var(--muted)}
.hm-bar .hm-info{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:min(520px,90vw)}
.hm-nav{position:absolute;top:50%;transform:translateY(-50%);width:44px;height:64px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink);font:24px var(--f-mono);cursor:pointer}
.hm-nav.prev{left:12px}.hm-nav.next{right:12px}
.hm-nav[hidden]{display:none}
@media (max-width:860px){.hm-grid{grid-template-columns:repeat(auto-fill,minmax(110px,1fr))}.hm-nav{width:36px;height:52px}}
@media (prefers-reduced-motion:reduce){.hm-lb{animation:none}}
`;
  document.head.appendChild(style);

  /* ---------- rendering (called from msgHTML) ---------- */
  const sigOf = (list) => list.map((m) => `${m.id}:${m.ver}:${m.kind}`).join(",");
  const isImg = (m) => m.type === "image" && m.url;
  // Display width for one inline image: fits 760 x 420; small pixel art is scaled up by a whole number and kept crisp.
  function fit(m) {
    const w = m.w, h = m.h;
    if (!(w > 0 && h > 0)) return { style: "", px: false };
    let dw = Math.min(w, 760, (420 * w) / h), px = false;
    if (w <= 128 && h <= 128) { const k = Math.max(1, Math.floor(128 / Math.max(w, h))); if (k >= 2) { dw = w * k; px = true; } }
    return { style: `width:${Math.round(dw)}px`, px };
  }
  const tip = (m) => e(m.path || m.name) + (m.current ? " · " + CURRENT : "");
  function img(m, lazy, cls) {
    const pix = m.w > 0 && m.w <= 64 && m.h <= 64 ? " px" : "";
    return `<img src="${e(m.url)}" alt="${e(m.name)}"${lazy ? ' loading="lazy"' : ""}${cls || pix ? ` class="${e((cls || "") + pix).trim()}"` : ""}${m.w > 0 && m.h > 0 ? ` width="${m.w}" height="${m.h}"` : ""}>`;
  }
  function chip(m) {
    const ext = m.type === "folder" ? "DIR" : String(m.ext || "file").slice(0, 5).toUpperCase();
    return `<span class="hm-file" title="${tip(m)}"><span class="hm-ext">${e(ext)}</span><span class="hm-nm">${e(m.name)}</span>${m.type !== "folder" && m.size >= 0 ? `<span class="hm-sz">${size(m.size)}</span>` : ""}`
      + (m.open ? `<button class="hm-b" type="button" data-mopen="${e(m.id)}" title="Open" aria-label="Open ${e(m.name)}">${ICON.open}</button>` : "")
      + `<button class="hm-b" type="button" data-mreveal="${e(m.id)}" title="Show in folder${m.open ? "" : " (" + NO_OPEN + ")"}" aria-label="Show ${e(m.name)} in its folder">${ICON.folder}</button>`
      + `<button class="hm-b" type="button" data-mcopy="${e(m.id)}" title="Copy path" aria-label="Copy the path of ${e(m.name)}">${ICON.copy}</button>`
      + (inVault(m) ? `<button class="hm-b" type="button" data-mobs="${e(m.id)}" title="Open in Obsidian" aria-label="Open ${e(m.name)} in Obsidian">${ICON.obsidian}</button>` : "")
      + (m.type === "file" && window.HiveTaste ? `<button class="hm-b" type="button" data-mtaste="${e(m.id)}" title="Send to Taste" aria-label="Send ${e(m.name)} to your Taste library">${ICON.taste}</button>` : "") + `</span>`;
  }
  function html(x, part) {
    const list = (x && x.media) || [];
    if (!list.length) return "";
    const lazy = !x.streaming;
    if (part === "main") {
      const shown = list.filter((m) => m.kind === "shown");
      const imgs = shown.filter(isImg), files = shown.filter((m) => !isImg(m)).slice(0, PER_MSG);
      if (!imgs.length && !files.length) return "";
      let h = "";
      if (imgs.length === 1) {
        const m = imgs[0], f = fit(m);
        h += `<figure class="hm-one"><button class="hm-img" type="button" data-mi="${e(m.id)}" title="${tip(m)}"${f.style ? ` style="${f.style}"` : ""}>${img(m, lazy, f.px ? "px" : "")}</button>`
          + `<figcaption class="hm-cap">${e([m.name, m.w > 0 ? `${m.w}×${m.h}` : "", size(m.size), m.current ? "current file" : ""].filter(Boolean).join(" · "))}</figcaption></figure>`;
      } else if (imgs.length) {
        const more = imgs.length - PER_MSG;
        h += `<div class="hm-grid">${imgs.slice(0, PER_MSG).map((m, k) => `<button class="hm-tile" type="button" data-mi="${e(m.id)}" title="${tip(m)}">${img(m, lazy)}${k === PER_MSG - 1 && more > 0 ? `<span class="hm-more">+${more}</span>` : ""}</button>`).join("")}</div>`;
      }
      if (files.length) h += `<div class="hm-chips">${files.map(chip).join("")}</div>`;
      return `<div class="hm-main" data-k="main" data-sig="${e(sigOf(shown))}">${h}</div>`;
    }
    if (part === "strip") {
      const made = list.filter((m) => m.kind === "made"), seen = list.filter((m) => m.kind === "seen");
      let h = "";
      const thumbs = (l) => l.map((m) => isImg(m) ? `<button class="hm-th" type="button" data-mi="${e(m.id)}" title="${e(m.name)}${m.tool ? " · " + e(m.tool) : ""}">${img(m, lazy)}</button>` : chip(m)).join("");
      if (made.length) h += `<div class="hm-strip" data-k="strip" data-sig="${e(sigOf(made))}"><span class="hm-lbl">Made</span>${thumbs(made.slice(0, PER_MSG * 2))}</div>`;
      if (seen.length) h += `<details class="hm-seen" data-k="seen" data-sig="${e(sigOf(seen))}"><summary>Looked at ${seen.length} picture${seen.length === 1 ? "" : "s"}</summary><div class="hm-strip">${thumbs(seen)}</div></details>`;
      return h;
    }
    return "";
  }

  /* ---------- clicks ---------- */
  const msgsEl = document.getElementById("msgs");
  const chatNow = () => (typeof chat !== "undefined" ? chat : null);
  function itemAt(el, id) {
    const c = chatNow(), row = el.closest(".msg[data-i]");
    const msg = c && row ? c.messages[+row.dataset.i] : null;
    return { msg, it: msg && (msg.media || []).find((m) => m.id === id) };
  }
  const say = (t, b) => { if (typeof toast === "function") toast(t, b); };
  async function act(it, action) {
    let r;
    try { r = await api("/api/media/open", { method: "POST", body: JSON.stringify({ id: it.id, action }) }); } catch { r = { error: "Lost connection to The Wise Hive server." }; }
    if (r && r.error) say(action === "open" ? "Couldn't open it" : "Couldn't show it", r.error);
  }
  async function copyPath(it) {
    try { await navigator.clipboard.writeText(it.path || it.name); say("Path copied", it.path || it.name); } catch { say("Couldn't copy", it.path || it.name); }
  }
  if (msgsEl) {
    msgsEl.addEventListener("click", (ev) => {
      const t = ev.target.closest("[data-mi],[data-mopen],[data-mreveal],[data-mcopy],[data-mtaste],[data-mobs]");
      if (!t || !msgsEl.contains(t)) return;
      const id = t.dataset.mi || t.dataset.mopen || t.dataset.mreveal || t.dataset.mcopy || t.dataset.mtaste || t.dataset.mobs, { msg, it } = itemAt(t, id);
      if (!it) return;
      ev.preventDefault();
      if (t.dataset.mi) {
        const order = { shown: 0, made: 1, seen: 2 }, list = (msg.media || []).filter(isImg).sort((a, b) => order[a.kind] - order[b.kind]);
        open(list, Math.max(0, list.indexOf(it)));
      } else if (t.dataset.mtaste) { if (window.HiveTaste) HiveTaste.sendMedia(it); }
      else if (t.dataset.mobs) {
        api("/api/obsidian/open", { method: "POST", body: JSON.stringify({ path: it.path }) })
          .then((r) => { if (r && r.error) say("Couldn't open it in Obsidian", r.error); }, () => say("Couldn't open it in Obsidian", "Lost connection to The Wise Hive server."));
      }
      else if (t.dataset.mopen) act(it, "open");
      else if (t.dataset.mreveal) act(it, "reveal");
      else copyPath(it);
    });
    // A picture without a known size grows the page when it loads: if the view was at the bottom before that (the same 140 px
    // as paint() in index.html, minus the height the picture just added), keep it there. Sized pictures cause no jump and are left
    // alone. A missing picture is retried once, then marked unavailable.
    msgsEl.addEventListener("load", (ev) => {
      const im = ev.target;
      if (!(im instanceof HTMLImageElement) || !im.closest("[data-k]") || im.hasAttribute("height")) return;
      if (msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight - im.offsetHeight < 140) msgsEl.scrollTop = msgsEl.scrollHeight;
    }, true);
    msgsEl.addEventListener("error", (ev) => {
      const im = ev.target;
      if (!(im instanceof HTMLImageElement) || !im.closest("[data-k]")) return;
      if (!im.dataset.retried) { im.dataset.retried = "1"; const src = im.getAttribute("src"); setTimeout(() => { if (im.isConnected) im.src = src.split("?")[0] + "?r=" + Date.now(); }, 1500); return; }
      const box = im.closest(".hm-img,.hm-th,.hm-tile");
      if (box) { box.classList.add("hm-gone"); box.style.cursor = "default"; box.textContent = "picture unavailable"; box.removeAttribute("data-mi"); box.style.aspectRatio = ""; }
    }, true);
  }

  /* ---------- lightbox ---------- */
  let LB = null, cur = { list: [], i: 0, from: null };
  function build() {
    LB = document.createElement("div");
    LB.id = LB_ID; LB.className = "hm-lb"; LB.hidden = true;
    LB.setAttribute("role", "dialog"); LB.setAttribute("aria-modal", "true"); LB.setAttribute("aria-label", "Picture");
    LB.innerHTML = `<button class="hm-nav prev" type="button" aria-label="Previous picture">‹</button><figure><img alt=""></figure><button class="hm-nav next" type="button" aria-label="Next picture">›</button>`
      + `<div class="hm-bar"><span class="hm-info"></span><span class="hm-n"></span><button class="btn small" type="button" data-a="open">Open</button><button class="btn small" type="button" data-a="reveal">Show in folder</button><button class="btn small" type="button" data-a="copy">Copy path</button><button class="btn small" type="button" data-a="taste" title="Put it in your Taste library to approve, deny or comment on">Send to Taste</button><button class="btn small" type="button" data-a="close">Close</button></div>`;
    document.body.appendChild(LB);
    LB.addEventListener("click", (ev) => {
      const b = ev.target.closest("button");
      if (!b) { if (ev.target === LB || ev.target.tagName === "FIGURE") close(); return; }
      if (b.classList.contains("prev")) return step(-1);
      if (b.classList.contains("next")) return step(1);
      const it = cur.list[cur.i], a = b.dataset.a;
      if (a === "close") close();
      else if (it && (a === "open" || a === "reveal")) act(it, a);
      else if (it && a === "copy") copyPath(it);
      else if (it && a === "taste") { close(); if (typeof it.taste === "function") it.taste(); else if (window.HiveTaste) HiveTaste.sendMedia(it); }
    });
    // Clicks on the picture or the bar keep focus where it was; keys are read on the document so they work wherever focus is.
    LB.addEventListener("mousedown", (ev) => { if (!ev.target.closest("button")) ev.preventDefault(); });
    document.addEventListener("keydown", (ev) => {
      if (!LB || LB.hidden) return;
      if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); close(); }
      else if (ev.key === "ArrowLeft") { ev.preventDefault(); step(-1); }
      else if (ev.key === "ArrowRight") { ev.preventDefault(); step(1); }
      else if (ev.key === "Tab") {
        const f = [...LB.querySelectorAll("button")].filter((b) => !b.hidden && b.offsetParent !== null);
        if (!f.length) return;
        const k = f.indexOf(document.activeElement);
        if (k < 0) { ev.preventDefault(); (ev.shiftKey ? f[f.length - 1] : f[0]).focus(); }
        else if (ev.shiftKey && k === 0) { ev.preventDefault(); f[f.length - 1].focus(); }
        else if (!ev.shiftKey && k === f.length - 1) { ev.preventDefault(); f[0].focus(); }
      }
    }, true);
  }
  function draw() {
    const it = cur.list[cur.i];
    if (!it) return close();
    const im = LB.querySelector("img");
    // Small pictures (pixel art, icons) are scaled up by a whole number and kept crisp.
    const k = it.w > 0 && it.h > 0 ? Math.floor(Math.min((innerWidth * 0.92) / it.w, (innerHeight - 120) / it.h, 16)) : 1;
    im.style.width = k >= 2 ? it.w * k + "px" : "";
    im.classList.toggle("px", k >= 2 && it.ext !== "svg");
    im.src = it.url; im.alt = it.name || "";
    LB.querySelector(".hm-info").textContent = [it.name, it.w > 0 ? `${it.w}×${it.h}` : "", size(it.size), it.current ? "current file" : ""].filter(Boolean).join(" · ");
    LB.querySelector(".hm-info").title = it.path || "";
    LB.querySelector(".hm-n").textContent = cur.list.length > 1 ? `${cur.i + 1} / ${cur.list.length}` : "";
    LB.querySelector('[data-a="open"]').hidden = !it.open;
    LB.querySelector('[data-a="reveal"]').hidden = LB.querySelector('[data-a="copy"]').hidden = !it.path;
    // Send to Taste: chat media (a server token) or a list item that brings its own sender.
    LB.querySelector('[data-a="taste"]').hidden = !window.HiveTaste || !(typeof it.taste === "function" || /^[A-Za-z0-9_-]{22}$/.test(String(it.id || "")));
    LB.querySelector(".prev").hidden = LB.querySelector(".next").hidden = cur.list.length < 2;
    // If the focused button was just hidden (Open on a picture that can't be opened), focus falls to Close instead of the page.
    const fe = document.activeElement;
    if (!LB.contains(fe) || fe.hidden) LB.querySelector('[data-a="close"]').focus();
  }
  function step(d) { if (cur.list.length < 2) return; cur.i = (cur.i + d + cur.list.length) % cur.list.length; draw(); }
  function open(list, i) {
    list = (list || []).filter((m) => m && m.url);
    if (!list.length) return;
    if (!LB) build();
    cur = { list, i: Math.min(Math.max(0, i | 0), list.length - 1), from: list[Math.min(Math.max(0, i | 0), list.length - 1)].id };
    LB.hidden = false; document.body.classList.add("hm-lb-on"); draw();
    LB.querySelector('[data-a="close"]').focus();
  }
  function close() {
    if (!LB || LB.hidden) return;
    LB.hidden = true;
    document.body.classList.remove("hm-lb-on");
    LB.querySelector("img").removeAttribute("src");
    // The clicked button may have been replaced by a repaint: look it up again.
    const id = cur.from, back = id && document.querySelector('[data-mi="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
    if (back) back.focus();
  }

  /* ---------- reopening a chat, and the late sweep ---------- */
  const repaint = (c) => { if (typeof paint === "function" && c === chatNow()) paint(c); };
  async function restore(c) {
    if (!c || !c.id) return;
    const msgs = c.messages || [], texts = [];
    for (let i = Math.max(0, msgs.length - 150); i < msgs.length; i++) { const m = msgs[i]; if (m && m.role === "assistant" && m.text) texts.push({ i, text: String(m.text).slice(-20000) }); }
    const [idx, scan] = await Promise.all([
      api("/api/media/chat/" + encodeURIComponent(c.id)).catch((er) => { console.error("media index:", er); return null; }),
      texts.length ? api("/api/media/scan", { method: "POST", body: JSON.stringify({ cwd: c.cwd, texts }) }).catch((er) => { console.error("media scan:", er); return null; }) : null,
    ]);
    if (idx && Array.isArray(idx.items)) C.place(c, idx.items, { fallback: false });
    if (scan && scan.items && typeof scan.items === "object") for (const [i, items] of Object.entries(scan.items)) { const m = c.messages[+i]; if (m && m.role === "assistant" && Array.isArray(items)) C.add(c, m, items); }
    repaint(c);
  }
  window.addEventListener("hive:chatopen", (ev) => {
    const c = ev.detail && ev.detail.chat;
    if (!c) return;
    if (!c.id) { c._mediaRestored = true; return; }   // born in this window: its media comes live
    if (c._mediaRestored) return;
    c._mediaRestored = true;
    restore(c);
  });
  window.addEventListener("hive:userprompt", (ev) => {
    const c = ev.detail && ev.detail.chat;
    if (!c) return;
    if (!c.id) c._mediaRestored = true;                // the first chat on the page never fires hive:chatopen
    if (!c.run) c._sweepFrom = Date.now();             // a new run (not a message queued into a running one)
  });
  // A few seconds after a turn, fetch this run's index entries: catches items whose checks finished after the stream closed.
  window.addEventListener("hive:turn", (ev) => {
    const c = ev.detail && ev.detail.chat;
    if (!c || !c._sweepFrom) return;
    const since = c._sweepFrom - 10000;
    c._sweepFrom = Date.now();
    setTimeout(async () => {
      if (!c.id) return;
      try {
        const r = await api("/api/media/chat/" + encodeURIComponent(c.id) + "?since=" + since);
        if (r && Array.isArray(r.items) && C.place(c, r.items, { fallback: true })) repaint(c);
      } catch (er) { console.error("media sweep:", er); }
    }, 3000);
  });

  window.HiveMedia = { add: C.add, html, open, restore };
})();
