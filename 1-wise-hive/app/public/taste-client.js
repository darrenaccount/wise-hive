/* Taste tab: the page side of taste.js. Everything Claude made for the user to judge (3D models, images and UI, pixel
   art, audio, video, text, lighting setups, other files) waits here, grouped by style, for the USER to approve, deny or
   comment on. Claude never approves its own work: verdicts are posted from this window only (the server checks the
   request really comes from it). A full-window focus view shows each kind with its own viewer (drag-to-spin for models,
   zoom for images, crisp zoom and a palette for pixel art, a waveform for audio, a before/after slider for lighting).
   Training gets a short summary and a style picker; Working gets a style picker per project and "Send to Taste" on its
   round cards; chats get "Send to Taste" on pictures and files. A gold badge on the Taste tab counts what waits. */
(function () {
  "use strict";
  // An art critic: dark beret, gold monocle over the right eye, a small palette.
  if (typeof KIT === "object" && KIT && !KIT.curator) {
    const r = (x, y, w, h, c) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`;
    KIT.curator = { front: r(3, 2, 10, 2, "#3b2b4f") + r(9, 1, 4, 1, "#3b2b4f") + r(12, 0, 1, 1, "#3b2b4f") + r(9, 5, 3, 1, "#e9b949") + r(9, 8, 3, 1, "#e9b949") + r(9, 5, 1, 4, "#e9b949") + r(11, 5, 1, 4, "#e9b949") + r(11, 9, 1, 2, "#e9b949")
      + r(15, 6, 4, 3, "#c9a46a") + r(15, 6, 1, 1, "#d64545") + r(17, 6, 1, 1, "#3e6fb0") + r(16, 8, 1, 1, "#3fa06b") + r(18, 8, 1, 1, "#f3efe6") };
  }
  const style = document.createElement("style");
  style.textContent = `
#tasteBadge{background:var(--gold);color:var(--bg)}
.ts-sec{gap:10px}
.ts-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ts-head h2.sec{margin:0}
.ts-me{width:28px;flex:none}
.ts-count{color:var(--gold);border-color:color-mix(in srgb,var(--gold) 40%,var(--line));background:color-mix(in srgb,var(--gold) 9%,var(--raised))}
.ts-head label,.ts-bar label{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;color:var(--muted)}
.ts-head select,.ts-box select,.ts-bar select,.ts-side select{padding:4px 9px;font-size:12.5px;border-radius:10px;background:var(--raised);max-width:220px}
.ts-note{margin:0;font-size:12.5px;color:var(--muted)}
.ts-note.warn{color:var(--warn)}
.ts-hero{display:flex;align-items:center;gap:16px}
.ts-hero .ts-me{width:64px}
.ts-hero h1{font-size:26px}
.ts-hero p{margin:2px 0 0}
.ts-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.ts-styles{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.ts-st{border:1px solid var(--line);background:var(--surface);color:var(--muted);border-radius:999px;padding:4px 12px;font-size:13px;font-weight:700;cursor:pointer}
.ts-st i{font-style:normal;margin-left:5px;opacity:.8}
.ts-st[aria-pressed="true"]{border-color:var(--claude);color:var(--ink);background:var(--claude-soft)}
.ts-st.arch{opacity:.6;font-style:italic}
.ts-edit{display:grid;grid-template-columns:minmax(0,220px) minmax(0,1fr) auto;gap:8px;align-items:center;background:var(--sunk);border:1px solid var(--line);border-radius:12px;padding:10px 12px}
.ts-edit input{padding:6px 10px;font-size:13px;border-radius:10px}
.ts-edit .ts-acts{gap:6px}
@media (max-width:860px){.ts-edit{grid-template-columns:minmax(0,1fr)}}
.ts-tabs .tab{padding:8px 12px;font-size:13.5px}
.ts-tabs .tab i{font-style:normal;color:var(--muted);font-weight:600;margin-left:4px}
.ts-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px}
.ts-card{display:flex;flex-direction:column;gap:4px;text-align:left;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:8px;cursor:pointer;color:var(--ink);font:inherit;min-width:0}
.ts-card:hover,.ts-card:focus-visible{border-color:var(--claude)}
.ts-thumb{position:relative;display:flex;align-items:center;justify-content:center;aspect-ratio:1;background:var(--sunk);border:1px solid var(--line);border-radius:8px;overflow:hidden;color:var(--muted)}
.ts-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.ts-thumb img.px{image-rendering:pixelated;object-fit:contain}
.ts-thumb svg{width:44%;height:44%;opacity:.7}
.ts-kind{position:absolute;left:6px;top:6px;font:700 10px var(--f-body);text-transform:uppercase;letter-spacing:.06em;background:color-mix(in srgb,var(--bg) 80%,transparent);color:var(--ink);border-radius:6px;padding:2px 6px}
.ts-title{font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ts-meta{font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ts-chips{display:flex;gap:4px;flex-wrap:wrap}
.ts-chips .chip{font-size:11px;padding:1px 8px}
.chip.ts-review{color:var(--gold);border-color:color-mix(in srgb,var(--gold) 40%,var(--line))}
.chip.ts-approved{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 40%,var(--line))}
.chip.ts-denied{color:var(--bad);border-color:color-mix(in srgb,var(--bad) 40%,var(--line))}
.chip.ts-comment,.chip.ts-revised{color:var(--claude);border-color:color-mix(in srgb,var(--claude) 40%,var(--line))}
.chip.ts-warn,.chip.ts-unfinished{color:var(--warn)}
.ts-empty{margin:0;color:var(--muted);font-size:13px;background:var(--sunk);border:1px solid var(--line);border-radius:12px;padding:12px 14px}
.ts-more{align-self:flex-start}
.ts-box{background:var(--sunk);border:1px solid var(--line);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:8px}
.ts-box .md{font-size:13px;max-height:340px;overflow:auto}
.ts-box .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:12.5px;color:var(--muted)}
.ts-msg{margin:0;font-size:13px}.ts-msg.bad{color:var(--bad)}.ts-msg.ok{color:var(--ok)}
#v-taste.ts-drop::after{content:"Drop to add to your Taste library";position:fixed;inset:12px 12px 12px 96px;border:2px dashed var(--claude);border-radius:16px;background:color-mix(in srgb,var(--bg) 82%,transparent);display:flex;align-items:center;justify-content:center;font:600 20px var(--f-display);color:var(--claude);pointer-events:none;z-index:40}
/* add dialog */
.ts-add{position:fixed;inset:0;z-index:46;background:color-mix(in srgb,var(--bg) 70%,transparent);display:flex;align-items:center;justify-content:center;padding:16px}
.ts-add[hidden]{display:none}
.ts-add form{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:18px;width:min(560px,100%);max-height:90vh;overflow:auto;display:flex;flex-direction:column;gap:10px}
.ts-add h3{margin:0;font-size:18px}
.ts-add label{display:flex;flex-direction:column;gap:4px;font-size:12.5px;font-weight:700;color:var(--muted)}
.ts-add .row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.ts-add input[type=text],.ts-add textarea,.ts-add select{padding:7px 10px;font-size:13.5px;width:100%}
.ts-add textarea{min-height:64px;resize:vertical}
.ts-files{display:flex;flex-wrap:wrap;gap:6px}
.ts-file{display:flex;align-items:center;gap:6px;background:var(--sunk);border:1px solid var(--line);border-radius:10px;padding:4px 8px;font-size:12.5px;color:var(--ink)}
.ts-file img{width:40px;height:40px;object-fit:cover;border-radius:6px}
.ts-file input{width:auto}
/* focus view */
.ts-ov{position:fixed;inset:0;z-index:45;background:var(--bg);display:flex;flex-direction:column;color:var(--ink)}
.ts-ov[hidden]{display:none}
.ts-ov-top{display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid var(--line)}
.ts-ov-top .ts-pos{font-weight:700;font-size:13.5px;color:var(--muted)}
.ts-ov-top .btn{min-width:34px}
.ts-ov-body{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,420px);gap:18px;padding:16px 18px}
.ts-view{display:flex;flex-direction:column;gap:8px;align-items:center;min-height:0;min-width:0}
.ts-cw{position:relative;width:min(100%,70vh);aspect-ratio:1;box-shadow:0 0 0 2px var(--line),0 0 0 4px var(--sunk);background:var(--sunk);touch-action:none;cursor:grab}
.ts-cw.drag{cursor:grabbing}
.ts-cw canvas{width:100%;height:100%;display:block}
.ts-prog{position:absolute;left:0;right:0;bottom:0;height:2px;background:transparent}
.ts-prog i{display:block;height:100%;width:0;background:var(--claude);transition:width .2s}
.ts-alt{width:100%;flex:1;min-height:0;display:flex;flex-direction:column;gap:8px;align-items:center;justify-content:center}
.ts-zoom{position:relative;width:100%;flex:1;min-height:280px;overflow:hidden;background:var(--sunk);box-shadow:0 0 0 2px var(--line),0 0 0 4px var(--sunk);cursor:grab;touch-action:none}
.ts-zoom.drag{cursor:grabbing}
.ts-zoom img{position:absolute;left:0;top:0;transform-origin:0 0;max-width:none;user-select:none;-webkit-user-drag:none}
.ts-zoom.px img{image-rendering:pixelated}
.ts-pal{display:flex;flex-wrap:wrap;gap:3px;justify-content:center;max-width:100%}
.ts-pal span{width:18px;height:18px;border:1px solid var(--line);border-radius:3px}
.ts-audio{width:min(100%,900px);display:flex;flex-direction:column;gap:10px}
.ts-wave{position:relative;width:100%;height:180px;background:var(--sunk);box-shadow:0 0 0 2px var(--line),0 0 0 4px var(--sunk);cursor:pointer}
.ts-wave canvas{width:100%;height:100%;display:block}
.ts-wave i{position:absolute;top:0;bottom:0;width:2px;background:var(--gold);left:0;pointer-events:none}
.ts-audio audio,.ts-alt video{width:100%}
.ts-alt video{max-height:70vh;background:#000}
.ts-text{width:min(100%,820px);max-height:70vh;overflow:auto;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:16px 20px;font-size:14.5px}
.ts-flist{display:flex;flex-direction:column;gap:6px;width:min(100%,640px)}
.ts-flist .ts-file{justify-content:space-between}
.ts-ba{position:relative;width:100%;flex:1;min-height:260px;background:var(--sunk);box-shadow:0 0 0 2px var(--line),0 0 0 4px var(--sunk);overflow:hidden;touch-action:none;cursor:ew-resize}
.ts-ba img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;user-select:none;-webkit-user-drag:none}
.ts-ba .ts-ba-h{position:absolute;top:0;bottom:0;width:2px;background:var(--gold);box-shadow:0 0 0 1px rgba(0,0,0,.4);pointer-events:none}
.ts-ba .ts-ba-t{position:absolute;top:8px;font:700 11px var(--f-body);text-transform:uppercase;letter-spacing:.08em;background:color-mix(in srgb,var(--bg) 75%,transparent);border-radius:6px;padding:2px 7px}
.ts-ba input{position:absolute;left:0;right:0;bottom:6px;width:100%;opacity:.0001;cursor:ew-resize}
.ts-ba:focus-within .ts-ba-h{background:var(--claude)}
.ts-cmp{display:grid;grid-template-columns:1fr 1fr;gap:10px;width:100%;flex:1;min-height:0}
.ts-cmp figure{margin:0;display:flex;flex-direction:column;gap:4px;min-height:0}
.ts-cmp img{width:100%;flex:1;min-height:0;object-fit:contain;background:var(--sunk);box-shadow:0 0 0 2px var(--line)}
.ts-cmp figcaption{font-size:12px;color:var(--muted);text-align:center}
.ts-hint{margin:0;font-size:12px;color:var(--muted);text-align:center}
.ts-shots{display:flex;gap:6px;flex-wrap:wrap;justify-content:center}
.ts-shots .btn[aria-pressed="true"]{border-color:var(--claude);color:var(--claude)}
.ts-shots .ts-sep{width:1px;background:var(--line);margin:0 4px}
.ts-side{overflow:auto;min-height:0;display:flex;flex-direction:column;gap:10px;padding-right:4px}
.ts-kick{font:700 11px var(--f-body);text-transform:uppercase;letter-spacing:.09em;color:var(--claude)}
.ts-side h3{margin:0;font-size:18px;line-height:1.3;overflow-wrap:anywhere}
.ts-about{font-size:13.5px;color:var(--ink);overflow-wrap:anywhere}
.ts-about p{margin:3px 0}
.ts-facts{font:12px var(--f-mono);color:var(--muted)}
.ts-side details>summary{cursor:pointer;color:var(--muted);font-weight:700;font-size:12.5px}
.ts-panel{border:1px solid var(--line);border-radius:10px;padding:8px 10px;display:flex;flex-direction:column;gap:5px;font-size:13px}
.ts-panel h4{margin:0;font-size:11.5px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
.ts-panel ul{margin:0;padding-left:18px}
.ts-panel.warn{border-color:color-mix(in srgb,var(--warn) 45%,var(--line))}
.ts-panel.claude{border-color:color-mix(in srgb,var(--claude) 40%,var(--line))}
.ts-score{font:600 15px var(--f-display);color:var(--ink)}
.ts-diff{font:12px var(--f-mono);display:grid;grid-template-columns:auto auto;gap:2px 10px}
.ts-diff b{font-weight:400;color:var(--muted)}
.ts-side pre{background:var(--sunk);border:1px solid var(--line);border-radius:8px;padding:8px;font:11.5px var(--f-mono);max-height:220px;overflow:auto;white-space:pre}
.ts-prev{display:flex;gap:10px;align-items:flex-start}
.ts-prev img{width:72px;height:72px;object-fit:cover;border-radius:8px;border:1px solid var(--line);flex:none}
.ts-op{font-size:13px;border-top:1px solid var(--line);padding:6px 0}
.ts-op b{color:var(--ink)}
.ts-call{display:flex;flex-direction:column;gap:8px;border-top:1px solid var(--line);padding-top:10px}
.ts-call h4{margin:0;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
.ts-dec{display:flex;gap:8px}
.ts-dec .btn{flex:1;padding-left:8px;padding-right:8px}
.ts-dec .btn[aria-pressed="true"][data-d="approve"]{background:var(--ok);border-color:var(--ok);color:var(--bg)}
.ts-dec .btn[aria-pressed="true"][data-d="deny"]{background:var(--bad);border-color:var(--bad);color:var(--bg)}
.ts-dec .btn[aria-pressed="true"][data-d="comment"]{background:var(--claude);border-color:var(--claude);color:var(--bg)}
.ts-rs{display:flex;flex-wrap:wrap;gap:6px}
.ts-rs[hidden]{display:none}
.ts-rs .btn{font-size:12.5px;padding:3px 10px;font-weight:600}
.ts-rs .btn[aria-pressed="true"]{border-color:var(--claude);background:var(--claude-soft);color:var(--ink)}
.ts-call textarea{min-height:64px;resize:vertical}
.ts-acts{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.btn.ts-armed{background:var(--bad);border-color:var(--bad);color:var(--bg)}
.ts-ov-body.done{grid-template-columns:minmax(0,1fr)}.ts-ov-body.done .ts-view{display:none}
.ts-done{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;flex:1;color:var(--muted)}
@media (max-width:980px){.ts-ov-body{grid-template-columns:minmax(0,1fr);grid-auto-rows:max-content;align-content:start;overflow:auto}.ts-view{min-height:auto}.ts-side{overflow:visible}.ts-cw{width:min(100%,56vh)}.ts-zoom,.ts-ba{min-height:52vh}}
@media (max-width:860px){.ts-ov-top{padding:8px 12px}.ts-ov-body{padding:12px}}`;
  document.head.appendChild(style);

  const T = { data: null, status: "review", style: "all", kind: "all", list: [], total: 0, showAll: false, root: null, sig: "", tasteOpen: false, summary: null, msg: null, loading: false, deb: 0, seq: 0,
    lastAp: null, distilling: false, bitmaps: 0, inflight: 0, edit: null, styles: null, picks: { training: "", projects: {} }, index: new Map(), sec: null, secSig: "" };
  const arr = (v) => (Array.isArray(v) ? v : []);
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const when = (t) => { try { return t ? ago(new Date(t).toISOString()) : ""; } catch { return ""; } };
  const STATUS = { review: "To review", comment: "Sent back", unfinished: "Claude still on it", approved: "Approved", denied: "Denied", dismissed: "Not a real piece", revised: "Revised" };
  const TABS = [["review", "To review"], ["comment", "Sent back"], ["unfinished", "Unfinished"], ["approved", "Approved"], ["denied", "Denied"], ["all", "All"]];
  const KINDS = { model: "3D model", image: "Image / design", pixel: "Pixel art", audio: "Audio", video: "Video", text: "Text / copy", lighting: "Lighting", other: "Other" };
  const SHORT = { model: "3D", image: "Image", pixel: "Pixel", audio: "Audio", video: "Video", text: "Text", lighting: "Light", other: "File" };
  const visible = () => { const v = $("v-taste"); return !!v && !v.hidden; };
  const lite = () => !!(T.data && T.data.lite) || !!window.HIVE_LITE;
  const kindName = (k) => KINDS[k] || "Work";
  const styleName = (id) => { const s = arr(T.styles).find((x) => x.id === id); return s ? s.name : id === "general" ? "General" : id; };
  const liveStyles = () => arr(T.styles).filter((s) => !s.archived);
  // Pixel-art glyphs for cards without a picture.
  const GLYPH = {
    audio: '<svg viewBox="0 0 16 16" shape-rendering="crispEdges"><path fill="currentColor" d="M2 6h2v4H2zM5 3h2v10H5zM8 5h2v6H8zM11 2h2v12h-2zM14 6h1v4h-1z"/></svg>',
    video: '<svg viewBox="0 0 16 16" shape-rendering="crispEdges"><path fill="currentColor" d="M1 3h10v10H1zM12 5l3-2v10l-3-2z"/></svg>',
    text: '<svg viewBox="0 0 16 16" shape-rendering="crispEdges"><path fill="currentColor" d="M2 2h12v2H2zM2 6h10v2H2zM2 10h12v2H2zM2 14h7v1H2z"/></svg>',
    other: '<svg viewBox="0 0 16 16" shape-rendering="crispEdges"><path fill="currentColor" d="M3 1h7l3 3v11H3zm2 2v10h6V5H9V3z"/></svg>',
  };

  /* ---------- server ---------- */
  async function post(p, body) {
    try {
      const r = await fetch(p, { method: "POST", headers: H, body: JSON.stringify(body || {}) });
      let j = null; try { j = await r.json(); } catch {}
      if (r.status === 403) return { error: "Taste changes can only be saved from The Wise Hive window." };
      if (r.status === 413) return { error: "That's too big to send in one go." };
      return j || { error: `The Wise Hive answered ${r.status}.` };
    } catch { return { error: "Can't reach The Wise Hive right now." }; }
  }
  // Files: fetched with the X-Hive header (they live behind the API guard), at most 6 at a time.
  const IMQ = { active: 0, queue: [] };
  function pumpImages() {
    while (IMQ.active < 6 && IMQ.queue.length) {
      const j = IMQ.queue.shift();
      if (j.signal && j.signal.aborted) { j.no(new DOMException("aborted", "AbortError")); continue; }
      IMQ.active++; T.inflight++;
      fetch(j.url, { headers: { "X-Hive": "1" }, signal: j.signal }).then((r) => (r.ok ? r.blob() : Promise.reject(new Error("HTTP " + r.status)))).then(j.ok, j.no)
        .finally(() => { IMQ.active--; T.inflight--; pumpImages(); });
    }
  }
  const blob = (url, signal) => new Promise((ok, no) => { IMQ.queue.push({ url, signal, ok, no }); pumpImages(); });
  const imgUrl = (id, file, v) => `/api/taste/file/${encodeURIComponent(id)}/${encodeURIComponent(file)}?v=${encodeURIComponent(v || 0)}`;
  // Card thumbnails as object URLs, the newest 120 kept.
  const thumbs = new Map();
  function thumbKey(x) { return x && x.thumb ? `${x.id}/${x.thumb.file}/${x.thumb.v}` : null; }
  function keepThumb(k, url) { thumbs.set(k, url); while (thumbs.size > 120) { const [old, u] = thumbs.entries().next().value; thumbs.delete(old); URL.revokeObjectURL(u); } }
  async function loadThumb(x) {
    const k = thumbKey(x);
    if (!k || thumbs.has(k)) return k && thumbs.get(k);
    try { const b = await blob(imgUrl(x.id, x.thumb.file, x.thumb.v)); if (!thumbs.has(k)) keepThumb(k, URL.createObjectURL(b)); return thumbs.get(k); } catch { return null; }
  }

  /* ---------- badge ---------- */
  const nav = document.querySelector('.nav[data-view="taste"]');
  const badge = document.createElement("span");
  badge.className = "nav-badge"; badge.id = "tasteBadge"; badge.hidden = true;
  if (nav) nav.appendChild(badge);
  function setBadge(n) {
    badge.hidden = !n; badge.textContent = n > 99 ? "99+" : String(n);
    badge.title = n ? `${plural(n, "piece")} of work waiting for your call` : "";
  }

  /* ---------- the Taste view ---------- */
  function gradingHTML() {
    const s = (T.data && T.data.settings) || {};
    const tip = "Optional, between rounds: extra Claude critics grade each new piece as advice. About 11k tokens per critic per piece.";
    if (lite()) return `<label title="${esc(tip)}">Extra grading <select data-ts="critics" disabled><option>Off (The Wise Hive Lite)</option></select></label>`;
    return `<label title="${esc(tip)}">Extra grading <select data-ts="critics">${[["off", "Off"], ["one", "1 critic"], ["panel", "Panel of 3"]].map(([k, l]) => `<option value="${k}"${s.critics === k ? " selected" : ""}>${l}</option>`).join("")}</select></label>`;
  }
  function criticSwitchHTML() {
    const s = (T.data && T.data.settings) || {};
    const tip = "On: Training and Working rounds have a separate critic agent look at their work, and fix what it finds, before anything reaches your queue. Off: work comes straight to you, marked \"not reviewed by Claude\". Uses more of your Claude usage when on.";
    return `<label class="toggle" title="${esc(tip)}"><input type="checkbox" data-ts="loop"${s.loopCritic ? " checked" : ""}${T.data && T.data.readOnly ? " disabled" : ""}> Claude's critic before my queue</label>`;
  }
  function cardHTML(x) {
    const url = thumbs.get(thumbKey(x)), px = x.kind === "pixel";
    const pic = url ? `<img src="${url}" alt=""${px ? ' class="px"' : ""}>` : x.thumb ? `<img alt="" data-thumb="${esc(x.id)}"${px ? ' class="px"' : ""} hidden>` : GLYPH[x.kind] || GLYPH.other;
    const chips = `<span class="chip ts-${esc(x.status)}">${STATUS[x.status] || esc(x.status)}</span>${x.revisionOf ? `<span class="chip" title="A new version after your comment">new version</span>` : ""}${x.running ? `<span class="chip">round running</span>` : ""}`
      + `${x.notCritiqued && x.status === "review" ? `<span class="chip ts-warn" title="Claude's critic didn't look at it">no critic</span>` : ""}${x.critique && x.critique.score != null ? `<span class="chip" title="Claude's critic (advice only)">critic ${esc(x.critique.score)}/10</span>` : ""}`
      + `${x.unverified ? `<span class="chip ts-warn" title="A verdict file the app didn't write was ignored">⚠ ignored file</span>` : ""}${T.style === "all" && x.style !== "general" ? `<span class="chip">${esc(styleName(x.style))}</span>` : ""}`;
    const src = x.round != null && x.source && x.source.type === "training" ? `Round ${esc(x.round)} · ` : x.source && x.source.type === "working" ? "Working · " : x.source && x.source.type === "chat" ? "Chat · " : x.source && x.source.type === "upload" ? "Added by you · " : "";
    return `<button class="ts-card" type="button" data-ts="open" data-id="${esc(x.id)}" title="${esc(x.title)}"><span class="ts-thumb"><span class="ts-kind">${esc(SHORT[x.kind] || "")}</span>${pic}</span><b class="ts-title">${esc(x.title)}</b><span class="ts-meta">${src}${esc(when(x.at))}</span><span class="ts-chips">${chips}</span></button>`;
  }
  function tasteBoxHTML() {
    const d = T.data, s = T.summary, c = d.counts || {}, ag = d.agreement || {}, st = d.settings || {};
    const sid = T.style === "all" ? "general" : T.style;
    const stats = [`${c.approved || 0} approved`, `${c.denied || 0} denied`];
    if (c.comment) stats.push(`${c.comment} sent back`);
    if (ag.guess && ag.guess.n) stats.push(`Claude's guess matched you ${ag.guess.agree} of ${ag.guess.n}`);
    if (ag.critics && ag.critics.n) stats.push(`critics ${ag.critics.agree} of ${ag.critics.n}`);
    const mb = s && typeof s.bytes === "number" ? `Taste files use ${(s.bytes / 1048576).toFixed(s.bytes < 10485760 ? 1 : 0)} MB · ` : "";
    const days = [[7, "7 days"], [30, "30 days"], [90, "90 days"], [0, "never"]];
    const freeSel = `reviewed models are slimmed after <select data-ts="free" aria-label="Slim reviewed models after">${days.map(([v, l]) => `<option value="${v}"${Number(st.autoFreeDays) === v ? " selected" : ""}>${l}</option>`).join("")}</select>`;
    const text = s && s.style === sid ? s.text : "";
    const body = !s || s.style !== sid ? `<p class="ts-note">Loading…</p>` : /No reviews yet/.test(text) || !text.trim() ? `<p class="ts-note">No reviews in ${esc(styleName(sid))} yet. Approve or deny a piece with a reason and Claude starts learning your taste for this style.</p>`
      : `<div class="md">${md(text.replace(/^# .*\n+/, "").replace(/^Built by (?:The Wise Hive|Teamwright).*\n/m, "") /* old summaries too: keep-old-name */)}</div>`;
    const auto = lite() ? "" : `<label><input type="checkbox" data-ts="auto"${st.autoDistill ? " checked" : ""}> Update automatically after 10 new reviews</label>`;
    return `<div class="ts-box" id="tsTasteBox"><div class="row"><b style="color:var(--ink)">Your taste: ${esc(styleName(sid))}</b>${T.style === "all" ? `<span>(pick a style above to see its own)</span>` : ""}</div>${body}<p class="ts-note">${esc(stats.join(" · "))}</p><p class="ts-note">${mb}${freeSel}</p>
<div class="row"><button class="btn small" type="button" data-ts="distill"${T.distilling ? " disabled" : ""} title="A Claude call sums your reviews in this style up as a few principles that rounds aim for">${T.distilling ? "Updating…" : `Update with Claude${lite() ? " (small Haiku call)" : ""}`}</button>${auto}</div></div>`;
  }
  function stylesHTML() {
    const ss = arr(T.styles), showArch = T.showArch;
    const btn = (id, label, n, arch) => `<button class="ts-st${arch ? " arch" : ""}" type="button" data-ts="style" data-k="${esc(id)}" aria-pressed="${T.style === id}">${esc(label)}${n != null ? `<i>${n}</i>` : ""}</button>`;
    const all = (T.data && T.data.countsAll) || {};
    let h = btn("all", "All styles", all.total || 0);
    for (const s of ss) if (!s.archived || showArch || T.style === s.id) h += btn(s.id, s.name, s.counts ? s.counts.total : null, s.archived);
    h += `<button class="btn small" type="button" data-ts="newstyle">+ New style</button>`;
    if (T.style !== "all") h += `<button class="linkish" type="button" data-ts="editstyle">Edit style</button>`;
    if (ss.some((s) => s.archived)) h += `<button class="linkish" type="button" data-ts="showarch">${showArch ? "Hide archived" : "Show archived"}</button>`;
    return `<div class="ts-styles" role="group" aria-label="Styles">${h}</div>`;
  }
  function editHTML() {
    if (!T.edit) return "";
    const s = T.edit === "new" ? { id: "", name: "", description: "" } : arr(T.styles).find((x) => x.id === T.edit);
    if (!s) return "";
    const arch = s.id && s.id !== "general" ? `<button class="btn small" type="button" data-ts="archstyle">${s.archived ? "Restore" : "Archive"}</button>` : "";
    return `<form class="ts-edit" data-ts-form="style"><input type="text" name="name" maxlength="60" placeholder="Style name, e.g. Cosy cartoon" value="${esc(s.name)}" aria-label="Style name"><input type="text" name="description" maxlength="400" placeholder="What it looks or sounds like (Claude reads this to pick a style)" value="${esc(s.description)}" aria-label="Description">`
      + `<div class="ts-acts"><button class="btn small primary" type="submit">${T.edit === "new" ? "Create" : "Save"}</button>${arch}<button class="linkish" type="button" data-ts="canceledit">Cancel</button></div></form>`;
  }
  function viewHTML() {
    const d = T.data, n = d && d.countsAll ? d.countsAll.review : 0;
    const head = `<header class="ts-hero"><div class="ts-me bob">${mascot("curator", "Taste curator")}</div><div><h1>Taste</h1><p class="muted">Everything Claude makes for you to judge waits here: models, images, pixel art, sounds, lighting and more. You make the call; Claude learns your taste for each style.</p></div><span class="spacer"></span>${n ? `<span class="chip ts-count">${n} to review</span>` : ""}<button class="btn small primary" type="button" data-ts="add" title="Add images, sounds, models or other files (or drop them on this tab)">Add work</button></header>`;
    if (!d) return head + `<p class="ts-note">${T.loading ? "Loading…" : "Can't load the Taste library."}</p>`;
    const cr = d.critics || {};
    const wait = cr.waiting && (cr.queued || cr.busy) ? `<p class="ts-note">Extra critics wait: ${esc(cr.waiting)}</p>` : cr.busy ? `<p class="ts-note">An extra critic is looking at a piece (advice only).</p>` : "";
    const kinds = `<label>Kind <select data-ts="kind"><option value="all">All kinds</option>${Object.entries(KINDS).map(([k, l]) => `<option value="${k}"${T.kind === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
    const bar = `<div class="ts-bar">${stylesHTML()}<span class="spacer"></span>${kinds}</div><div class="ts-bar">${criticSwitchHTML()}${gradingHTML()}<span class="spacer"></span><button class="btn small" type="button" data-ts="taste" aria-expanded="${T.tasteOpen}" aria-controls="tsTasteBox">Your taste</button></div>`;
    const c = d.counts || {};
    const tabs = `<div class="tabs ts-tabs" role="tablist" aria-label="Filter">${TABS.map(([k, l]) => `<button class="tab" role="tab" type="button" data-ts="tab" data-k="${k}" aria-selected="${T.status === k}">${l}<i>${k === "all" ? c.total || 0 : c[k] || 0}</i></button>`).join("")}</div>`;
    const msg = T.msg ? `<p class="ts-msg ${T.msg.bad ? "bad" : "ok"}" role="status">${esc(T.msg.text)}</p>` : "";
    const ro = d.readOnly ? `<p class="ts-note warn">Reviews and Taste changes are saved only in The Wise Hive desktop app.</p>` : "";
    let grid;
    if (!c.total) grid = `<p class="ts-empty">${T.style === "all" && T.kind === "all" ? "When Training or Working finishes something for you to judge, or you add work here, it lands in this tab. Claude never approves its own work." : "Nothing in this style or kind yet."}</p>`;
    else if (!T.list.length) grid = `<p class="ts-empty">${T.status === "review" ? "All caught up." : T.status === "unfinished" ? "Nothing waiting for Claude's critic." : T.status === "comment" ? "No open comments: Claude has answered them all." : "Nothing here yet."}</p>`;
    else {
      const shown = T.showAll ? T.list : T.list.slice(0, 12);
      grid = `<div class="ts-grid">${shown.map(cardHTML).join("")}</div>`;
      if (!T.showAll && T.total > 12) grid += `<button class="btn small ts-more" type="button" data-ts="all">Show all ${T.total}</button>`;
      else if (T.showAll && T.list.length < T.total) grid += `<button class="btn small ts-more" type="button" data-ts="more">Show more (${T.total - T.list.length} left)</button>`;
    }
    const help = T.status === "unfinished" ? `<p class="ts-note">Work from rounds waits here until Claude's own critic has looked at it and Claude has fixed what it found. Open one to put it in your queue anyway.</p>`
      : T.status === "comment" ? `<p class="ts-note">You sent these back with a comment. The next Training round (or the project's next Working round) revises a copy and puts the new version in your queue.</p>` : "";
    return head + bar + editHTML() + wait + ro + msg + tabs + help + (T.tasteOpen ? tasteBoxHTML() : "") + grid;
  }
  function mount() {
    if (T.root && T.root.isConnected) return true;
    T.root = $("tasteRoot");
    if (!T.root) return false;
    T.root.addEventListener("click", onClick);
    T.root.addEventListener("change", onChange);
    T.root.addEventListener("submit", onSubmit);
    const v = $("v-taste");
    let depth = 0;
    const files = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes("Files");
    v.addEventListener("dragenter", (e) => { if (!files(e)) return; e.preventDefault(); depth++; v.classList.add("ts-drop"); });
    v.addEventListener("dragover", (e) => { if (files(e)) e.preventDefault(); });
    v.addEventListener("dragleave", () => { depth = Math.max(0, depth - 1); if (!depth) v.classList.remove("ts-drop"); });
    v.addEventListener("drop", (e) => { if (!files(e)) return; e.preventDefault(); depth = 0; v.classList.remove("ts-drop"); addDialog({ from: "upload", files: [...e.dataTransfer.files] }); });
    T.sig = "";
    return true;
  }
  function draw() {
    if (!mount()) return;
    const html = viewHTML();
    if (html !== T.sig) {
      // A re-render replaces every control: keep keyboard focus on the matching new one (same data-ts/id/k).
      const a = document.activeElement, was = a && a !== T.root && T.root.contains(a) && a.dataset ? [a.dataset.ts, a.dataset.id, a.dataset.k].join("|") : null;
      const keepEdit = T.edit && T.root.querySelector('[data-ts-form="style"]');
      const vals = keepEdit ? [...keepEdit.querySelectorAll("input")].map((i) => i.value) : null;
      T.sig = html; T.root.innerHTML = html;
      if (vals) { const f = T.root.querySelector('[data-ts-form="style"]'); if (f) [...f.querySelectorAll("input")].forEach((i, k) => { i.value = vals[k]; }); }
      if (was != null) focusIn((x) => [x.dataset.ts, x.dataset.id, x.dataset.k].join("|") === was);
    }
    fillThumbs(T.root);
  }
  function focusIn(match) {
    const el = T.root && [...T.root.querySelectorAll("[data-ts]")].find(match);
    if (el) el.focus({ preventScroll: true });
    return !!el;
  }
  function fillThumbs(root) {
    if (!root) return;
    for (const img of root.querySelectorAll("img[data-thumb]")) {
      const x = T.list.find((i) => i.id === img.dataset.thumb);
      if (!x) continue;
      loadThumb(x).then((u) => { if (u && img.isConnected) { img.src = u; img.hidden = false; img.removeAttribute("data-thumb"); T.sig = ""; } });
    }
  }
  const q4 = () => `status=${T.status}&style=${encodeURIComponent(T.style)}&kind=${encodeURIComponent(T.kind)}`;
  async function load(keep) {
    const seq = ++T.seq;
    T.loading = true;
    let d = null;
    const want = keep ? Math.min(200, Math.max(48, T.list.length)) : 48;
    try { d = await api(`/api/taste?${q4()}&limit=${want}`); } catch {}
    if (seq !== T.seq) return d; // a newer load (another tab or filter, or the poll) owns the view now
    T.loading = false;
    if (d && !d.error) {
      T.data = d; T.list = arr(d.items); T.total = d.total || 0; T.styles = arr(d.styles); T.picks = d.picks || T.picks;
      if (T.style !== "all" && !T.styles.some((s) => s.id === T.style)) { T.style = "all"; return load(); }
      setBadge(Number(d.countsAll && d.countsAll.review) || 0);
      if (T.tasteOpen) loadSummary();
      pickers();
    }
    if (visible()) draw();
    drawTraining();
    return d;
  }
  async function loadMore() {
    const was = q4(); // a page is added only to the same tab and filters it was asked for
    let d = null;
    try { d = await api(`/api/taste?${was}&offset=${T.list.length}&limit=48`); } catch {}
    if (d && !d.error && was === q4()) { const have = new Set(T.list.map((x) => x.id)); T.list = T.list.concat(arr(d.items).filter((x) => !have.has(x.id))); T.total = d.total || T.total; }
    draw();
    return d;
  }
  async function loadSummary() {
    const sid = T.style === "all" ? "general" : T.style;
    try { const s = await api(`/api/taste/summary?style=${encodeURIComponent(sid)}`); if (s && !s.error) T.summary = s; } catch {}
    if (visible()) draw();
  }
  async function loadCount() {
    try { const r = await api("/api/taste/count"); if (r && typeof r.count === "number") setBadge(r.count); } catch {}
  }
  // Styles and picks for the Training/Working pickers, and the round index for round cards (light: one page of all).
  async function loadStyles() {
    try { const r = await api("/api/taste/styles"); if (r && !r.error) { T.styles = arr(r.styles); T.picks = r.picks || T.picks; pickers(); } } catch {}
  }
  async function loadIndex() {
    let d = null;
    try { d = await api("/api/taste?status=all&limit=200"); } catch {}
    if (!d || d.error) return;
    T.index = new Map();
    for (const x of arr(d.items)) { const s = x.source || {}; if (s.slug && s.n != null) { const k = s.slug + "/" + s.n; T.index.set(k, (T.index.get(k) || []).concat([x.id])); } }
    if (!T.data) T.styles = arr(d.styles);
    T.counts = d.countsAll;
    window.dispatchEvent(new CustomEvent("hive:taste-index"));
    drawTraining();
  }
  async function onClick(e) {
    const b = e.target && e.target.closest ? e.target.closest("[data-ts]") : null;
    if (!b || b.disabled) return;
    const a = b.dataset.ts;
    if (a === "tab") { T.status = b.dataset.k; T.showAll = false; T.list = []; T.msg = null; draw(); load(); }
    else if (a === "style") { T.style = b.dataset.k; T.edit = null; T.showAll = false; T.list = []; T.summary = null; draw(); load(); }
    else if (a === "open") open(b.dataset.id, b);
    else if (a === "all") { T.showAll = true; draw(); }
    else if (a === "more") loadMore();
    else if (a === "add") addDialog({ from: "upload", files: [] });
    else if (a === "taste") { T.tasteOpen = !T.tasteOpen; draw(); if (T.tasteOpen) loadSummary(); }
    else if (a === "newstyle") { T.edit = "new"; draw(); const i = T.root.querySelector('[data-ts-form="style"] input'); if (i) i.focus(); }
    else if (a === "editstyle") { T.edit = T.edit === T.style ? null : T.style; draw(); }
    else if (a === "canceledit") { T.edit = null; draw(); }
    else if (a === "showarch") { T.showArch = !T.showArch; draw(); }
    else if (a === "archstyle") {
      const s = arr(T.styles).find((x) => x.id === T.edit);
      if (!s) return;
      const r = await post("/api/taste/styles", { action: s.archived ? "restore" : "archive", id: s.id });
      T.msg = r.error ? { bad: true, text: r.error } : { text: s.archived ? `${s.name} is back.` : `${s.name} is archived: rounds won't pick it, and its work stays.` };
      T.edit = null; await load(true);
    }
    else if (a === "distill") {
      T.distilling = true; T.msg = null; draw();
      const r = await post("/api/taste/distill", { style: T.style === "all" ? "general" : T.style });
      T.distilling = false;
      T.msg = r.error ? { bad: true, text: r.error } : { text: "Your taste in this style was summed up as principles; rounds aim for them." };
      await load(true); loadSummary();
    }
  }
  async function onSubmit(e) {
    const f = e.target;
    if (!f || f.dataset.tsForm !== "style") return;
    e.preventDefault();
    const name = f.elements.name.value.trim(), description = f.elements.description.value.trim();
    const r = await post("/api/taste/styles", T.edit === "new" ? { action: "create", name, description } : { action: "update", id: T.edit, name, description });
    if (r.error) { T.msg = { bad: true, text: r.error }; draw(); return; }
    T.msg = { text: T.edit === "new" ? `Made the style "${r.style.name}".` : "Saved." };
    if (T.edit === "new" && r.style) T.style = r.style.id;
    T.edit = null; T.summary = null;
    await load();
  }
  async function onChange(e) {
    const s = e.target;
    if (!s || !s.dataset) return;
    if (s.dataset.ts === "kind") { T.kind = s.value; T.showAll = false; T.list = []; load(); return; }
    let body = null;
    if (s.dataset.ts === "critics") body = { critics: s.value };
    else if (s.dataset.ts === "free") body = { autoFreeDays: Number(s.value) };
    else if (s.dataset.ts === "auto") body = { autoDistill: !!s.checked };
    else if (s.dataset.ts === "loop") body = { loopCritic: !!s.checked };
    if (!body) return;
    const r = await post("/api/taste/settings", body);
    T.msg = r.error ? { bad: true, text: r.error } : body.loopCritic !== undefined ? { text: body.loopCritic ? "Rounds have Claude's critic look at their work before it reaches you." : "Work from rounds comes straight to you, marked \"not reviewed by Claude\"." } : null;
    await load(true);
  }

  /* ---------- Training: a short summary; Training and Working: a style picker ---------- */
  function drawTraining() {
    const page = document.querySelector("#trainingRoot .ap-page");
    if (!page) return;
    if (!T.sec || !T.sec.isConnected) {
      T.sec = document.createElement("section");
      T.sec.className = "stack ts-sec";
      T.sec.setAttribute("aria-label", "Taste: what Training made for you to judge");
      page.insertBefore(T.sec, page.querySelector(".ap-next-sec") || (page.querySelector(".ap-feed") && page.querySelector(".ap-feed").parentElement) || null);
      T.sec.addEventListener("click", (e) => { const b = e.target.closest && e.target.closest("[data-ts]"); if (b && b.dataset.ts === "go" && typeof show === "function") show("taste"); });
      T.secSig = "";
    }
    const c = (T.data && T.data.countsAll) || T.counts || {};
    const bits = [c.review ? `<span class="chip ts-count">${c.review} to review</span>` : "", c.comment ? `<span class="chip">${c.comment} sent back to Claude</span>` : "", c.unfinished ? `<span class="chip">${c.unfinished} with Claude's critic</span>` : ""].join("");
    const h = `<div class="ts-head"><span class="ts-me bob">${mascot("curator", "Taste curator")}</span><h2 class="sec">Taste</h2>${bits}<span class="spacer"></span><button class="btn small" type="button" data-ts="go">Open the Taste tab</button></div>`
      + `<p class="ts-note">What Training makes waits in the Taste tab for your call (approve, deny or comment). Pick the style for the next rounds below the log, next to Model.</p>`;
    if (h !== T.secSig) { T.secSig = h; T.sec.innerHTML = h; }
  }
  function pickerHTML(mode) {
    const p = T.picks || {}, proj = mode === "working" ? projOf() : "";
    const cur = mode === "working" ? (p.projects || {})[proj.toLowerCase()] || "" : p.training || "";
    const opts = `<option value="">Claude picks</option>` + liveStyles().map((s) => `<option value="${esc(s.id)}"${s.id === cur ? " selected" : ""}>${esc(s.name)}</option>`).join("");
    return { opts, cur };
  }
  const projOf = () => { const s = document.querySelector('#workingRoot .ap-set [data-set="proj"]'); return (s && s.value) || ""; };
  function pickers() {
    for (const mode of ["training", "working"]) {
      const set = document.querySelector(`#${mode}Root .ap-set`);
      if (!set || !T.styles) continue;
      let sel = set.querySelector("[data-taste-style]");
      if (!sel) {
        const l = document.createElement("label");
        l.title = mode === "working" ? "The Taste style for this project's rounds (stored per project). Claude picks one when you don't." : "The Taste style for the next Training rounds. Claude picks one that fits the goal when you don't.";
        l.innerHTML = `Style <select data-taste-style="${mode}"></select>`;
        set.appendChild(l);
        sel = l.querySelector("select");
        sel.addEventListener("change", async () => {
          const r = await post("/api/taste/pick", { mode, style: sel.value, project: mode === "working" ? projOf() : undefined });
          if (r.error) { toast("Couldn't save the style", r.error); loadStyles(); return; }
          T.picks = r.picks || T.picks;
          toast("Taste", sel.value ? `${mode === "working" ? "This project" : "Training"} uses "${styleName(sel.value)}".` : "Claude picks the style that fits.");
        });
        if (mode === "working") { const ps = document.querySelector('#workingRoot .ap-set [data-set="proj"]'); if (ps) ps.addEventListener("change", () => pickers()); }
      }
      const { opts, cur } = pickerHTML(mode);
      if (sel.dataset.sig !== opts) { sel.innerHTML = opts; sel.dataset.sig = opts; }
      sel.value = cur;
      sel.disabled = mode === "working" && !projOf();
    }
  }

  /* ---------- adding work: upload / drop, a Working round's pictures, a chat's file ---------- */
  const MAX_FILE = 100 << 20, MAX_SEND = 150 << 20;
  let ADD = null;
  function addDialog(o) {
    if (!ADD) {
      ADD = document.createElement("div");
      ADD.className = "ts-add"; ADD.hidden = true;
      ADD.setAttribute("role", "dialog"); ADD.setAttribute("aria-modal", "true"); ADD.setAttribute("aria-label", "Add to Taste");
      document.body.appendChild(ADD);
      ADD.addEventListener("click", (e) => { if (e.target === ADD) closeAdd(); const b = e.target.closest && e.target.closest("[data-add]"); if (!b) return; if (b.dataset.add === "cancel") closeAdd(); else if (b.dataset.add === "pick") ADD.querySelector('input[type=file]').click(); });
      ADD.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); closeAdd(); } });
      ADD.addEventListener("change", (e) => { if (e.target.type === "file") { ADD.o.files = ADD.o.files.concat([...e.target.files]); renderAdd(); } });
      ADD.addEventListener("submit", (e) => { e.preventDefault(); sendAdd(); });
    }
    ADD.o = { files: [], ...o };
    ADD.innerHTML = ""; // a new dialog starts empty (renderAdd keeps what is typed only across its own re-renders)
    if (!T.styles) loadStyles().then(renderAdd);
    ADD.hidden = false;
    renderAdd();
    const f = ADD.querySelector("input[name=title]"); if (f) f.focus();
  }
  function closeAdd() { if (!ADD) return; ADD.hidden = true; for (const u of ADD.urls || []) URL.revokeObjectURL(u); ADD.urls = []; }
  function renderAdd() {
    if (!ADD || ADD.hidden) return;
    const o = ADD.o, keep = {};
    for (const el of ADD.querySelectorAll("[name]")) keep[el.name] = el.type === "checkbox" ? null : el.value;
    for (const u of ADD.urls || []) URL.revokeObjectURL(u);
    ADD.urls = [];
    let files = "";
    if (o.from === "upload") files = `<div class="ts-files">${o.files.map((f) => { const u = /^image\//.test(f.type) ? URL.createObjectURL(f) : null; if (u) ADD.urls.push(u); return `<span class="ts-file">${u ? `<img src="${u}" alt="">` : ""}${esc(f.name)} <span class="ts-note">${(f.size / 1048576).toFixed(f.size < 1048576 ? 2 : 1)} MB</span></span>`; }).join("")}<button class="btn small" type="button" data-add="pick">${o.files.length ? "Add more files" : "Choose files"}</button><input type="file" multiple hidden></div>`;
    else if (o.from === "round") files = `<div class="ts-files">${arr(o.pictures).map((p, i) => `<label class="ts-file"><input type="checkbox" name="pic" value="${esc(p.file)}"${p.pick ? " checked" : ""}><img src="${esc(p.url)}" alt="">${esc(p.label || p.file)}</label>`).join("")}</div>`;
    else files = `<div class="ts-files"><span class="ts-file">${o.url ? `<img src="${esc(o.url)}" alt="">` : ""}${esc(o.name || "file")}</span></div>`;
    const kinds = `<option value="">Guess from the files</option>` + Object.entries(KINDS).map(([k, l]) => `<option value="${k}"${(keep.kind ?? o.kind ?? "") === k ? " selected" : ""}>${esc(l)}</option>`).join("");
    const ss = liveStyles(), sty = keep.style ?? o.style ?? (T.style !== "all" ? T.style : "general");
    ADD.innerHTML = `<form><h3>${o.from === "round" ? `Send round ${esc(o.n)} to Taste` : o.from === "media" ? "Send to Taste" : "Add work to Taste"}</h3>
<p class="ts-note">${o.from === "upload" ? "Images, pixel art, sounds, video, text, models or other files (up to 100 MB each). For lighting, add the before/after pictures with a lighting.json." : "It goes straight to your queue to approve, deny or comment on."}</p>
${files}
<label>Title <input type="text" name="title" maxlength="120" value="${esc(keep.title ?? o.title ?? "")}" placeholder="Short name"></label>
<div class="row2"><label>Kind <select name="kind">${kinds}</select></label><label>Style <select name="style">${ss.map((s) => `<option value="${esc(s.id)}"${s.id === sty ? " selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label></div>
<label>Notes (optional) <textarea name="about" maxlength="6000" placeholder="What it is, where it's from">${esc(keep.about ?? o.about ?? "")}</textarea></label>
<p class="ts-msg" role="status"></p>
<div class="ts-acts"><button class="btn primary" type="submit">Add to Taste</button><button class="btn" type="button" data-add="cancel">Cancel</button></div></form>`;
  }
  const b64 = (file) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, "")); r.onerror = () => no(r.error); r.readAsDataURL(file); });
  async function sendAdd() {
    const o = ADD.o, f = ADD.querySelector("form"), say = (t, bad) => { const m = ADD.querySelector(".ts-msg"); m.textContent = t; m.className = "ts-msg" + (bad ? " bad" : " ok"); };
    const base = { title: f.elements.title.value.trim(), kind: f.elements.kind.value || undefined, style: f.elements.style.value, about: f.elements.about.value.trim() };
    const btn = f.querySelector("[type=submit]"); btn.disabled = true;
    let r;
    try {
      if (o.from === "upload") {
        if (!o.files.length) { say("Choose a file first.", true); btn.disabled = false; return; }
        const big = o.files.find((x) => x.size > MAX_FILE);
        if (big) { say(`${big.name} is over 100 MB.`, true); btn.disabled = false; return; }
        if (o.files.reduce((n, x) => n + x.size, 0) > MAX_SEND) { say("That's over 150 MB in one go; add fewer files at a time.", true); btn.disabled = false; return; }
        say("Sending…");
        r = await post("/api/taste/upload", { ...base, files: await Promise.all(o.files.map(async (x) => ({ name: x.name, data: await b64(x) }))) });
      } else if (o.from === "round") {
        const files = [...f.querySelectorAll("input[name=pic]:checked")].map((x) => x.value);
        if (!files.length) { say("Pick at least one picture.", true); btn.disabled = false; return; }
        r = await post("/api/taste/import", { ...base, from: "round", slug: o.slug, n: o.n, files });
      } else r = await post("/api/taste/import", { ...base, from: "media", id: o.id, chatId: o.chatId });
    } catch { r = { error: "Couldn't read the files." }; }
    btn.disabled = false;
    if (r.error) { say(r.error, true); return; }
    closeAdd();
    toast("Taste", `Added "${r.item.title}" to your queue.`, () => { if (typeof show === "function") show("taste"); setTimeout(() => open(r.item.id), 300); });
    T.status = "review";
    load(); loadIndex();
  }
  // From rounds-client.js: a Working round card's pictures (the "after" ones picked).
  function fromRound(r) {
    const pics = arr(r.images).map((im) => ({ file: String(im.file || ""), url: im.url, label: [im.phase, im.caption].filter(Boolean).join(" · ") || im.file, pick: im.phase === "after" })).filter((p) => p.file);
    if (pics.length && !pics.some((p) => p.pick)) pics[pics.length - 1].pick = true;
    addDialog({ from: "round", slug: r.slug, n: r.n, pictures: pics, title: r.title || `Working round ${r.n}`, about: r.summary || "", kind: "image",
      style: (T.picks && T.picks.projects && r.project && r.project.dir && T.picks.projects[String(r.project.dir).toLowerCase()]) || undefined });
  }
  // From media-client.js: a picture or file a chat showed.
  function sendMedia(it) {
    const c = typeof chat !== "undefined" ? chat : null;
    addDialog({ from: "media", id: it.id, name: it.name, url: it.type === "image" ? it.url : null, chatId: c && c.id, title: String(it.name || "").replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ") });
  }
  const forRound = (slug, n) => T.index.get(slug + "/" + n) || [];

  /* ---------- the focus view ---------- */
  const O = { el: null, id: null, item: null, ids: [], pos: 0, ctrl: null, frames: [], frameFiles: [], stills: {}, mode: "spin", idx: 0, spin: false, timer: 0, touched: false,
    form: { decision: null, reasons: new Set(), note: "", editing: false }, armed: null, armTimer: 0, reviewed: 0, inert: [], from: null, busy: false, asked: false,
    urls: [], file: null, zoom: null, view: 0, time: -1, ba: 50, audio: null, raf: 0, compare: false };
  const reduce = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function ensureOverlay() {
    if (O.el) return O.el;
    const el = document.createElement("div");
    el.className = "ts-ov"; el.hidden = true; el.tabIndex = -1;
    el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Review work");
    el.innerHTML = `<div class="ts-ov-top"><button class="btn small" type="button" data-ov="prev" aria-label="Previous">‹</button><span class="ts-pos" aria-live="polite"></span><button class="btn small" type="button" data-ov="next" aria-label="Next">›</button><span class="spacer"></span><button class="btn small" type="button" data-ov="close" aria-label="Close (Esc)">×</button></div>
<div class="ts-ov-body"><div class="ts-view"><div class="ts-cw"><canvas aria-label="The model: drag to turn it"></canvas><div class="ts-prog"><i></i></div></div><div class="ts-alt" hidden></div><p class="ts-hint"></p><div class="ts-shots"></div></div><div class="ts-side"></div></div>`;
    document.body.appendChild(el);
    el.addEventListener("click", onOvClick);
    el.addEventListener("keydown", onKey);
    el.addEventListener("input", (e) => {
      const t = e.target;
      if (t && t.dataset && t.dataset.ov === "note") { O.form.note = t.value; syncForm(); }
      if (t && t.classList && t.classList.contains("ts-ba-r")) { O.ba = Number(t.value); baPaint(); }
    });
    el.addEventListener("change", async (e) => {
      const t = e.target;
      if (!t || !t.dataset || t.dataset.ov !== "movestyle" || !O.item) return;
      const ctrl = O.ctrl;
      const r = await post(`/api/taste/item/${encodeURIComponent(O.item.id)}/style`, { style: t.value });
      const stale = O.el.hidden || O.ctrl !== ctrl; // closed, or another item is on screen now
      if (r.error) { if (stale) toast("Couldn't move it", r.error); else { say(r.error, true); t.value = O.item.style; } return; }
      if (!stale) O.item = { ...O.item, style: r.item.style };
      toast("Taste", `Moved to "${styleName(r.item.style)}".`);
    });
    const cw = el.querySelector(".ts-cw");
    let drag = null;
    cw.addEventListener("pointerdown", (e) => { if (O.mode !== "spin" || !O.frameFiles.length) return; touch(); drag = { x: e.clientX, idx: O.idx }; cw.setPointerCapture(e.pointerId); cw.classList.add("drag"); });
    cw.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const n = O.frameFiles.length, w = cw.clientWidth || 1;
      // Dragging right turns the model's front to the right (frames run the other way round).
      O.idx = (((drag.idx - Math.round((e.clientX - drag.x) / (w / n))) % n) + n) % n;
      paint();
    });
    const up = () => { drag = null; cw.classList.remove("drag"); };
    cw.addEventListener("pointerup", up); cw.addEventListener("pointercancel", up);
    cw.addEventListener("wheel", (e) => { if (O.mode !== "spin" || !O.frameFiles.length) return; e.preventDefault(); touch(); step(e.deltaY > 0 ? 1 : -1); }, { passive: false });
    new ResizeObserver(() => { paint(); if (O.zoom && O.zoom.fit) zoomFit(); waveDraw(); }).observe(el.querySelector(".ts-view"));
    O.el = el;
    return el;
  }
  const q = (s) => O.el.querySelector(s);
  // Views: an item can have several ways to look at it (a spin, an animation, pictures, code); the bar above the viewer
  // switches between them. O.pane is the one on screen.
  const VID = /^(mp4|webm|mov)$/, PIC = /^(png|jpe?g|gif|webp|bmp|svg)$/, AUD = /^(mp3|wav|ogg|m4a|flac)$/, CODE = /^(md|txt|json|csv|lua|luau|py|js|ts|html|css|glsl)$/;
  const hasSpin = () => !!O.item && arr(O.item.stills).length > 0;
  const isModel = () => hasSpin() && O.pane === "spin";
  function panes(it) {
    const f = arr(it.fileList), has = (re) => f.some((x) => re.test(x.ext)), p = [];
    if (has(VID)) p.push(["video", f.some((x) => VID.test(x.ext) && /^animation/i.test(x.file)) ? "Animation" : "Video"]);
    if (arr(it.stills).length) p.push(["spin", "Spin"]);
    if (it.kind === "lighting" && it.lighting && it.lighting.views.length) p.push(["lighting", "Lighting"]);
    if (has(AUD)) p.push(["audio", "Listen"]);
    if (has(PIC)) p.push(["pics", "Pictures"]);
    if (has(CODE) || (it.kind === "text" && it.about)) p.push(["code", it.kind === "text" ? "Text" : "Code & notes"]);
    if (f.some((x) => !VID.test(x.ext) && !PIC.test(x.ext) && !AUD.test(x.ext) && !CODE.test(x.ext))) p.push(["files", "Files"]);
    return p;
  }
  // Moving work first: an animation (VFX), then the spin, then pictures; text and code only when nothing can be seen.
  function firstPane(it, p) {
    const has = (k) => p.some((x) => x[0] === k);
    for (const k of [it.kind === "lighting" && "lighting", it.kind === "audio" && "audio", "video", "spin", "pics", "audio", "code", "files"]) if (k && has(k)) return k;
    return "files";
  }
  function setInert(on) {
    // Already inert (open() on an open overlay): recomputing would find nothing left to inert and lose the list.
    if (on) { if (O.inert.length) return; O.inert = [...document.body.children].filter((c) => c !== O.el && !c.inert && c.tagName !== "SCRIPT" && c.tagName !== "STYLE" && !c.classList.contains("toast")); for (const c of O.inert) c.inert = true; }
    else { for (const c of O.inert) c.inert = false; O.inert = []; }
  }
  // The "Free space" confirm: armed for 5 s. Disarmed whenever the item or the form changes, so its timer can't
  // re-render a form the user is typing in.
  function disarm() { clearTimeout(O.armTimer); O.armTimer = 0; O.armed = null; }
  // Each opened item owns its fetches, bitmaps, object URLs and audio; all are dropped on every switch and on close.
  // O.ctrl (new per showItem, aborted and nulled here) is the token that says a load still belongs to the item on
  // screen. Not O.item: it is replaced by updated copies of the same item (style, critics, clear).
  function dropViewer() {
    disarm();
    if (O.ctrl) O.ctrl.abort();
    O.ctrl = null;
    clearInterval(O.timer); O.timer = 0;
    cancelAnimationFrame(O.raf); O.raf = 0;
    for (const b of O.frames) if (b) { b.close(); T.bitmaps--; }
    for (const k of Object.keys(O.stills)) if (O.stills[k]) { O.stills[k].close(); T.bitmaps--; }
    const alt = O.el && q(".ts-alt");
    if (alt) { for (const m of alt.querySelectorAll("audio,video")) { try { m.pause(); m.removeAttribute("src"); m.load(); } catch {} } alt.innerHTML = ""; }
    for (const u of O.urls) URL.revokeObjectURL(u);
    O.frames = []; O.frameFiles = []; O.stills = {}; O.item = null; O.urls = []; O.zoom = null; O.audio = null; O.file = null; O.compare = false;
  }
  async function bitmap(file) {
    const it = O.item, ctrl = O.ctrl;
    if (!it || !ctrl) return null;
    try {
      const b = await blob(imgUrl(it.id, file, it.images[file]), ctrl.signal);
      const bmp = await createImageBitmap(b);
      if (ctrl.signal.aborted || O.ctrl !== ctrl) { bmp.close(); return null; }
      T.bitmaps++;
      return bmp;
    } catch { return null; }
  }
  // An item file as an object URL (revoked when the item is left). It may be another item's file (e.g. the earlier
  // version), fetched for the item on screen.
  async function fileURL(it, file, v) {
    const ctrl = O.ctrl;
    try {
      const b = await blob(imgUrl(it.id, file, v), ctrl && ctrl.signal);
      if (!ctrl || ctrl.signal.aborted || O.ctrl !== ctrl) return null;
      const u = URL.createObjectURL(b); O.urls.push(u); return u;
    } catch { return null; }
  }
  const stillFile = (k) => arr(O.item && O.item.stills).find((f) => f.startsWith("still-" + k + "."));
  async function getStill(k) {
    if (O.stills[k]) return O.stills[k];
    const f = stillFile(k);
    if (!f) return null;
    const b = await bitmap(f);
    if (b) { if (O.stills[k]) { b.close(); T.bitmaps--; } else O.stills[k] = b; }
    return O.stills[k] || null;
  }
  function paint() {
    if (!O.el || O.el.hidden || !isModel() || O.compare) return;
    const cv = q("canvas"), cw = q(".ts-cw"), dpr = window.devicePixelRatio || 1, w = Math.max(1, Math.round(cw.clientWidth * dpr));
    if (cv.width !== w) { cv.width = w; cv.height = w; }
    const g = cv.getContext("2d");
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
    let bmp = null;
    if (O.mode === "spin" && O.frameFiles.length) {
      const n = O.frameFiles.length;
      for (let d = 0; d < n && !bmp; d++) bmp = O.frames[(O.idx + d) % n] || O.frames[(O.idx - d + n) % n];
      bmp = bmp || O.stills["34"];
    } else bmp = O.stills[O.mode === "spin" ? "34" : O.mode];
    g.fillStyle = getComputedStyle(cw).backgroundColor || "#14171b";
    g.fillRect(0, 0, w, w);
    if (bmp) g.drawImage(bmp, 0, 0, w, w);
    hint();
  }
  function hint() {
    const it = O.item;
    if (!it || !isModel()) return;
    const n = O.frameFiles.length, got = O.frames.filter(Boolean).length;
    q(".ts-prog i").style.width = n ? `${Math.round((got / n) * 100)}%` : "0";
    q(".ts-hint").textContent = O.compare ? "" : O.mode !== "spin" ? `${({ 34: "3/4", front: "Front", side: "Side", top: "Top", clay: "Clay" })[O.mode] || ""} view`
      : n ? `drag to turn · one ring at 20° · Top view in the stills · ${O.idx + 1}/${n}` : it.freed ? "Spin frames were deleted to save space" : "No spin frames for this model";
  }
  function step(d) { const n = O.frameFiles.length; if (!n) return; O.idx = (((O.idx + d) % n) + n) % n; paint(); }
  function touch() { O.touched = true; setSpin(false); }
  function setSpin(on) {
    O.spin = !!on && isModel() && O.mode === "spin" && O.frameFiles.length > 1 && !O.compare;
    clearInterval(O.timer); O.timer = 0;
    if (O.spin) O.timer = setInterval(() => step(-1), 100);
    const b = q('[data-ov="spin"]'); if (b) { b.setAttribute("aria-pressed", String(O.spin)); b.textContent = O.spin ? "⏸" : "⏵"; }
  }
  const cmpBtn = () => (O.item && O.item.previous ? `<span class="ts-sep"></span><button class="btn small" type="button" data-ov="compare" aria-pressed="${O.compare}" title="Your earlier version and this one, side by side">Side by side</button>` : "");
  function shotsHTML() {
    const it = O.item;
    if (!it) return "";
    if (O.compare) return cmpBtn();
    const ps = panes(it);
    const bar = ps.length > 1 ? ps.map(([k, l]) => `<button class="btn small" type="button" data-ov="pane" data-k="${k}" aria-pressed="${O.pane === k}">${l}</button>`).join("") + `<span class="ts-sep"></span>` : "";
    return bar + paneTools(it);
  }
  // A file picker for the view on screen, when it has more than one file.
  function filePicks(list) {
    return list.length > 1 ? list.map((f) => `<button class="btn small" type="button" data-ov="file" data-k="${esc(f.file)}" aria-pressed="${O.file === f.file}" title="${esc(f.file)}">${esc(f.label || f.file)}</button>`).join("") : "";
  }
  function paneTools(it) {
    if (O.pane === "video") return filePicks(arr(it.fileList).filter((f) => VID.test(f.ext))) + cmpBtn();
    if (O.pane === "code") return filePicks(arr(it.fileList).filter((f) => CODE.test(f.ext))) + cmpBtn();
    if (O.pane === "audio") return filePicks(arr(it.fileList).filter((f) => AUD.test(f.ext))) + cmpBtn();
    if (O.pane === "files") return cmpBtn();
    if (isModel()) {
      const keys = [["34", "3/4"], ["front", "Front"], ["side", "Side"], ["top", "Top"], ["clay", "Clay"]].filter(([k]) => stillFile(k));
      const spin = O.frameFiles.length ? `<button class="btn small" type="button" data-ov="shot" data-k="spin" aria-pressed="${O.mode === "spin"}">Spin</button>` : "";
      return spin + keys.map(([k, l]) => `<button class="btn small" type="button" data-ov="shot" data-k="${k}" aria-pressed="${O.mode === k || (O.mode === "spin" && !O.frameFiles.length && k === "34")}">${l}</button>`).join("")
        + (O.frameFiles.length > 1 ? `<button class="btn small" type="button" data-ov="spin" aria-pressed="${O.spin}" title="Turn on its own (Space)">${O.spin ? "⏸" : "⏵"}</button>` : "") + cmpBtn();
    }
    if (O.pane === "lighting" && it.lighting) {
      const L = it.lighting, v = L.views[O.view] || {};
      const views = L.views.map((x, i) => `<button class="btn small" type="button" data-ov="view" data-k="${i}" aria-pressed="${i === O.view}">${esc(x.name)}</button>`).join("");
      const times = arr(v.times).length ? `<span class="ts-sep"></span><button class="btn small" type="button" data-ov="time" data-k="-1" aria-pressed="${O.time < 0}">Day</button>` + v.times.map((t, i) => `<button class="btn small" type="button" data-ov="time" data-k="${i}" aria-pressed="${i === O.time}">${esc(t.time)}</button>`).join("") : "";
      return views + times + cmpBtn();
    }
    const imgs = arr(it.fileList).filter((f) => /^(png|jpe?g|gif|webp|bmp|svg)$/.test(f.ext));
    let h = "";
    if (O.pane === "pics" && imgs.length) {
      if (imgs.length > 1) h += filePicks(imgs) + `<span class="ts-sep"></span>`;
      h += `<button class="btn small" type="button" data-ov="zfit" title="Fit (0)">Fit</button><button class="btn small" type="button" data-ov="z1" title="Actual pixels (1)">1:1</button><button class="btn small" type="button" data-ov="zin" aria-label="Zoom in">+</button><button class="btn small" type="button" data-ov="zout" aria-label="Zoom out">−</button>`;
    }
    return h + cmpBtn();
  }
  /* viewers for the other kinds */
  function alt(html) { const a = q(".ts-alt"); a.hidden = false; q(".ts-cw").hidden = true; a.innerHTML = html; return a; }
  // Every mount* returns after an await when the item changed (O.ctrl) or its viewer was replaced within the same item
  // (another file, view or Side by side: the element it made is no longer connected).
  async function mountViewer() {
    const it = O.item, ctrl = O.ctrl;
    q(".ts-hint").textContent = "";
    if (O.compare) return mountCompare();
    if (isModel()) { q(".ts-alt").hidden = true; q(".ts-cw").hidden = false; return loadSpin(); }
    const files = arr(it.fileList);
    // The file on screen within the view (O.file), or the view's first.
    const pickIn = (list) => { const f = list.find((x) => x.file === O.file) || list[0]; if (f) O.file = f.file; return f; };
    const imgs = files.filter((f) => PIC.test(f.ext));
    if (O.pane === "lighting" && it.lighting && it.lighting.views.length) return mountLighting();
    if (O.pane === "audio") { const f = pickIn(files.filter((x) => AUD.test(x.ext))); if (f) return mountAudio(f); }
    if (O.pane === "video") {
      // Animations loop on their own (muted), like the spin; a video someone made plays when asked.
      const f = pickIn(files.filter((x) => VID.test(x.ext)));
      if (f) {
        const loop = /^animation/i.test(f.file) && !reduce();
        const a = alt(`<p class="ts-note">Loading…</p>`), ph = a.firstElementChild; const u = await fileURL(it, f.file, f.v); if (O.ctrl !== ctrl || !ph.isConnected) return;
        a.innerHTML = u ? `<video controls preload="metadata"${loop ? " autoplay loop muted playsinline" : ""} src="${u}"></video>` : `<p class="ts-msg bad">Can't load the video.</p>`;
        q(".ts-hint").textContent = f.label || f.file; return;
      }
    }
    if (O.pane === "code") {
      const f = pickIn(files.filter((x) => CODE.test(x.ext)));
      const a = alt(`<div class="ts-text md">${f ? "Loading…" : md(it.about || "")}</div>`), tx = a.querySelector(".ts-text");
      if (f) { q(".ts-hint").textContent = f.file; try { const b = await blob(imgUrl(it.id, f.file, f.v), ctrl.signal); const t = await b.text(); if (O.ctrl !== ctrl || !tx.isConnected) return; tx.innerHTML = f.ext === "md" || f.ext === "txt" ? md(t) : `<pre>${esc(t)}</pre>`; } catch {} }
      return;
    }
    if (O.pane === "pics" && imgs.length) return mountZoom(pickIn(imgs));
    // Other: the files, each with Open / Show in folder.
    alt(`<div class="ts-flist">${files.map((f) => `<span class="ts-file"><span>${esc(f.file)} <span class="ts-note">${(f.bytes / 1048576).toFixed(f.bytes < 1048576 ? 2 : 1)} MB</span></span><span class="ts-acts"><button class="btn small" type="button" data-ov="fopen" data-k="${esc(f.file)}">Open</button><button class="btn small" type="button" data-ov="freveal" data-k="${esc(f.file)}">Show in folder</button></span></span>`).join("") || `<p class="ts-note">No files.</p>`}</div>`);
  }
  // Images and pixel art: zoom (wheel, buttons, 0/1/+/-) and pan (drag). Pixel art scales by whole numbers, crisp.
  async function mountZoom(f) {
    const it = O.item, ctrl = O.ctrl, px = it.kind === "pixel";
    const a = alt(`<div class="ts-zoom${px ? " px" : ""}" tabindex="0" aria-label="${esc(f.file)}: drag to move, wheel to zoom"><img alt=""></div>${px ? `<div class="ts-pal" aria-label="Palette"></div>` : ""}`);
    const box = a.querySelector(".ts-zoom"), img = box.querySelector("img");
    const u = await fileURL(it, f.file, f.v);
    if (O.ctrl !== ctrl || !u || !img.isConnected) return;
    img.onload = () => { if (!img.isConnected) return; O.zoom = { w: img.naturalWidth, h: img.naturalHeight, s: 1, x: 0, y: 0, fit: true, px }; zoomFit(); if (px) palette(img); };
    img.src = u;
    let drag = null;
    box.addEventListener("pointerdown", (e) => { if (!O.zoom) return; drag = { x: e.clientX, y: e.clientY, ox: O.zoom.x, oy: O.zoom.y }; box.setPointerCapture(e.pointerId); box.classList.add("drag"); });
    box.addEventListener("pointermove", (e) => { if (!drag) return; O.zoom.x = drag.ox + e.clientX - drag.x; O.zoom.y = drag.oy + e.clientY - drag.y; O.zoom.fit = false; zoomApply(); });
    const up = () => { drag = null; box.classList.remove("drag"); };
    box.addEventListener("pointerup", up); box.addEventListener("pointercancel", up);
    box.addEventListener("wheel", (e) => { e.preventDefault(); const r = box.getBoundingClientRect(); zoomBy(e.deltaY < 0 ? 1.25 : 0.8, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  }
  function zoomApply() {
    const z = O.zoom, img = O.el && q(".ts-zoom img");
    if (!z || !img) return;
    img.style.width = z.w + "px"; img.style.height = z.h + "px";
    img.style.transform = `translate(${Math.round(z.x)}px,${Math.round(z.y)}px) scale(${z.s})`;
    q(".ts-hint").textContent = `${z.w} × ${z.h} px · ${Math.round(z.s * 100)}% · drag to move, wheel to zoom`;
  }
  function zoomFit() {
    const z = O.zoom, box = O.el && q(".ts-zoom");
    if (!z || !box) return;
    let s = Math.min(box.clientWidth / z.w, box.clientHeight / z.h);
    if (z.px && s >= 1) s = Math.floor(s); else if (!z.px) s = Math.min(s, 1);
    z.s = Math.max(s, 0.02); z.x = (box.clientWidth - z.w * z.s) / 2; z.y = (box.clientHeight - z.h * z.s) / 2; z.fit = true;
    zoomApply();
  }
  function zoomBy(k, cx, cy) {
    const z = O.zoom, box = O.el && q(".ts-zoom");
    if (!z || !box) return;
    if (cx == null) { cx = box.clientWidth / 2; cy = box.clientHeight / 2; }
    let s = z.s * k;
    // Pixel art steps by whole numbers from 100% up; below 100% (a big sheet fitted) zooming out stays fractional.
    if (z.px) s = k > 1 ? Math.max(Math.floor(z.s) + 1, s) : z.s < 1 ? s : Math.max(1, Math.floor(z.s) - 1);
    s = Math.min(64, Math.max(0.05, s));
    z.x = cx - ((cx - z.x) * s) / z.s; z.y = cy - ((cy - z.y) * s) / z.s; z.s = s; z.fit = false;
    zoomApply();
  }
  function zoomOne() { const z = O.zoom, box = O.el && q(".ts-zoom"); if (!z || !box) return; z.s = 1; z.x = (box.clientWidth - z.w) / 2; z.y = (box.clientHeight - z.h) / 2; z.fit = false; zoomApply(); }
  // The palette: the most used colours of the sprite (up to 32), most used first. Every pixel counts; a sheet over
  // 2048 × 2048 px (or a strip over 16384 px long) is sampled (nearest pixel, so no blended colours appear) and its
  // numbers say "about".
  function palette(img) {
    const el = O.el && q(".ts-pal");
    if (!el) return;
    try {
      const W = img.naturalWidth, H = img.naturalHeight, f = Math.min(1, Math.sqrt(4194304 / (W * H)), 16384 / Math.max(W, H)); // 16384: a canvas side every browser draws
      const w = W && Math.max(1, Math.round(W * f)), h = H && Math.max(1, Math.round(H * f)), per = (W * H) / (w * h), ab = f < 1 ? "about " : "", c = document.createElement("canvas");
      c.width = w; c.height = h;
      const g = c.getContext("2d", { willReadFrequently: true }); g.imageSmoothingEnabled = false; g.drawImage(img, 0, 0, w, h);
      const d = g.getImageData(0, 0, w, h).data, m = new Map();
      for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 8) continue; const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2]; m.set(k, (m.get(k) || 0) + 1); }
      const top = [...m].sort((a, b) => b[1] - a[1]).slice(0, 32), hex = (k) => "#" + k.toString(16).padStart(6, "0");
      el.innerHTML = top.map(([k, n]) => `<span style="background:${hex(k)}" title="${hex(k)} · ${ab}${Math.round(n * per)} px"></span>`).join("") + `<span class="ts-note" style="width:auto;border:none">${ab}${m.size} colour${m.size === 1 ? "" : "s"}</span>`;
    } catch { el.innerHTML = ""; }
  }
  // Audio: the built-in player and a waveform drawn from the file with the Web Audio API (click to jump).
  async function mountAudio(f) {
    const it = O.item, ctrl = O.ctrl;
    const a = alt(`<div class="ts-audio"><div class="ts-wave" title="Click to jump"><canvas></canvas><i></i></div><audio controls preload="metadata"></audio><p class="ts-note">${esc(f.file)}</p></div>`);
    const au = a.querySelector("audio"), wave = a.querySelector(".ts-wave"), gone = () => O.ctrl !== ctrl || !au.isConnected;
    try {
      const b = await blob(imgUrl(it.id, f.file, f.v), ctrl.signal);
      if (gone()) return;
      const u = URL.createObjectURL(b); O.urls.push(u); au.src = u;
      const AC = window.AudioContext || window.webkitAudioContext, ac = new AC();
      try {
        const buf = await ac.decodeAudioData(await b.arrayBuffer());
        if (gone()) return;
        const ch = buf.getChannelData(0), N = 1200, peaks = new Float32Array(N * 2), per = Math.max(1, Math.floor(ch.length / N));
        for (let i = 0; i < N; i++) { let lo = 1, hi = -1; for (let j = i * per, e = Math.min(ch.length, j + per); j < e; j++) { const v = ch[j]; if (v < lo) lo = v; if (v > hi) hi = v; } peaks[i * 2] = lo; peaks[i * 2 + 1] = hi; }
        O.audio = { peaks, N, dur: buf.duration, el: au };
        q(".ts-hint").textContent = `${buf.duration.toFixed(1)} s · ${buf.sampleRate} Hz · ${buf.numberOfChannels === 1 ? "mono" : buf.numberOfChannels + " channels"}`;
      } finally { try { ac.close(); } catch {} }
    } catch { if (!gone()) q(".ts-hint").textContent = "Can't draw the waveform for this file."; }
    if (gone()) return;
    O.audio = O.audio || { el: au };
    waveDraw();
    wave.addEventListener("click", (e) => { const r = wave.getBoundingClientRect(); if (au.duration) au.currentTime = ((e.clientX - r.left) / r.width) * au.duration; });
    const tickHead = () => { if (!O.audio || O.audio.el !== au) return; const d = au.duration || (O.audio && O.audio.dur) || 0; wave.querySelector("i").style.left = d ? `${(au.currentTime / d) * 100}%` : "0"; if (!au.paused) O.raf = requestAnimationFrame(tickHead); };
    au.addEventListener("play", () => { cancelAnimationFrame(O.raf); O.raf = requestAnimationFrame(tickHead); });
    au.addEventListener("seeked", tickHead); au.addEventListener("pause", tickHead);
  }
  function waveDraw() {
    const A = O.audio, cv = O.el && q(".ts-wave canvas");
    if (!A || !A.peaks || !cv) return;
    const dpr = window.devicePixelRatio || 1, w = Math.max(1, Math.round(cv.clientWidth * dpr)), h = Math.max(1, Math.round(cv.clientHeight * dpr));
    cv.width = w; cv.height = h;
    const g = cv.getContext("2d"), mid = h / 2, col = getComputedStyle(document.documentElement).getPropertyValue("--claude").trim() || "#e5896a";
    g.clearRect(0, 0, w, h); g.fillStyle = col;
    const bar = Math.max(1, Math.floor(2 * dpr));
    for (let x = 0; x < w; x += bar + 1) {
      const i = Math.min(A.N - 1, Math.floor((x / w) * A.N)), lo = A.peaks[i * 2], hi = A.peaks[i * 2 + 1];
      g.fillRect(x, mid - hi * mid * 0.95, bar, Math.max(1, (hi - lo) * mid * 0.95));
    }
  }
  // Lighting: a before/after slider per fixed camera view (and per time of day).
  async function mountLighting() {
    const it = O.item, ctrl = O.ctrl, L = it.lighting, v = L.views[O.view] || L.views[0], t = O.time >= 0 && v.times[O.time] ? v.times[O.time] : null;
    const pair = t ? t : v;
    const a = alt(`<div class="ts-ba" aria-label="Before and after: drag or use the arrow keys"><img class="ts-b-after" alt="After"><img class="ts-b-before" alt="Before"><span class="ts-ba-t" style="left:8px">Before</span><span class="ts-ba-t" style="right:8px">After</span><span class="ts-ba-h"></span><input class="ts-ba-r" type="range" min="0" max="100" value="${O.ba}" aria-label="Before and after split"></div>`);
    const box = a.querySelector(".ts-ba");
    const [ub, ua] = await Promise.all([pair.before ? fileURL(it, pair.before, 0) : null, pair.after ? fileURL(it, pair.after, 0) : null]);
    if (O.ctrl !== ctrl || !box.isConnected) return;
    if (ua) a.querySelector(".ts-b-after").src = ua; else a.querySelector(".ts-b-after").remove();
    if (ub) a.querySelector(".ts-b-before").src = ub; else a.querySelector(".ts-b-before").remove();
    baPaint();
    let drag = false;
    const set = (e) => { const r = box.getBoundingClientRect(); O.ba = Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)); const inp = box.querySelector("input"); inp.value = Math.round(O.ba); baPaint(); };
    box.addEventListener("pointerdown", (e) => { if (e.target.tagName === "INPUT") return; drag = true; box.setPointerCapture(e.pointerId); set(e); });
    box.addEventListener("pointermove", (e) => { if (drag) set(e); });
    box.addEventListener("pointerup", () => { drag = false; });
    q(".ts-hint").textContent = `${v.name}${t ? " · " + t.time : ""} · drag across the picture: before on the left, after on the right`;
  }
  function baPaint() {
    const b = O.el && q(".ts-b-before"), h = O.el && q(".ts-ba-h");
    if (b) b.style.clipPath = `inset(0 ${100 - O.ba}% 0 0)`;
    if (h) h.style.left = `calc(${O.ba}% - 1px)`;
  }
  // Side by side: the version the user commented on, and this one.
  async function mountCompare() {
    const it = O.item, ctrl = O.ctrl, p = it.previous;
    const pic = (x) => (x && x.thumb ? x.thumb.file : null);
    const curFile = isModel() ? stillFile("34") || pic(it) : pic(it);
    const a = alt(`<div class="ts-cmp"><figure><img alt="Earlier version"><figcaption>Earlier: ${esc(p.title)}</figcaption></figure><figure><img alt="This version"><figcaption>This version</figcaption></figure></div>`), cmp = a.firstElementChild;
    const [u1, u2] = await Promise.all([pic(p) ? fileURL({ id: p.id }, pic(p), p.thumb.v) : null, curFile ? fileURL(it, curFile, (it.images && it.images[curFile]) || (it.thumb && it.thumb.v)) : null]);
    if (O.ctrl !== ctrl || !cmp.isConnected) return;
    const ims = cmp.querySelectorAll("img");
    if (u1) ims[0].src = u1; if (u2) ims[1].src = u2;
    q(".ts-hint").textContent = p.comment ? `You asked: "${p.comment}"` : "";
  }

  function sideHTML() {
    const it = O.item, info = it.roundInfo || {}, c = it.capture || {}, ro = T.data && T.data.readOnly;
    const facts = it.kind === "model" ? [c.tris != null ? `${Number(c.tris).toLocaleString()} tris` : "", arr(c.materials).length ? plural(arr(c.materials).length, "material") : "", arr(c.dims).length ? arr(c.dims).map((v) => Number(v).toFixed(2)).join(" × ") + " m" : ""].filter(Boolean).join(" · ") : "";
    const warn = arr(it.warnings).length ? `<p class="ts-note warn">${arr(it.warnings).map(esc).join("<br>")}</p>` : "";
    const chatId = it.chatId || info.chatId;
    const open = chatId ? `<button class="linkish" type="button" data-ov="chat">Open chat</button>` : "";
    const blend = it.blend ? `<button class="btn small" type="button" data-ov="copy" title="${esc(it.blend.path)}">Copy .blend path</button>${it.blend.exists === false ? ` <span class="ts-note warn">The .blend isn't there any more.</span>` : ""}` : "";
    const src = it.source || {};
    const from = src.type === "training" && it.round != null ? `Round ${esc(it.round)}` : src.type === "working" ? `Working${src.project ? ` · ${esc(src.project)}` : ""}${src.n != null ? ` round ${esc(src.n)}` : ""}` : src.type === "chat" ? "From a chat" : src.type === "upload" ? "Added by you" : "";
    const styles = liveStyles().concat(arr(T.styles).filter((s) => s.archived && s.id === it.style));
    const stSel = `<label class="ts-note" style="display:flex;gap:6px;align-items:center">Style <select data-ov="movestyle"${ro ? " disabled" : ""} aria-label="Move to another style">${styles.map((s) => `<option value="${esc(s.id)}"${s.id === it.style ? " selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label>`;
    let notes = "";
    if (it.status === "unfinished") notes += `<div class="ts-panel warn"><h4>Claude's critic hasn't looked at this yet</h4><p class="ts-note">Work from rounds waits for its critic, so it reaches you only once Claude has fixed what the critic found.${it.running ? " The round is still running." : ""}</p><div class="ts-acts"><button class="btn small" type="button" data-ov="release"${ro ? " disabled" : ""}>Put it in my queue now</button></div></div>`;
    if (it.previous) notes += `<div class="ts-panel claude"><h4>New version</h4><div class="ts-prev">${it.previous.thumb ? `<img alt="" data-prev="${esc(it.previous.id)}">` : ""}<div>${it.previous.comment ? `You asked: "${esc(it.previous.comment)}"` : `A revision of "${esc(it.previous.title)}".`}${arr(it.changes).length ? `<ul>${it.changes.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}<button class="linkish" type="button" data-ov="goto" data-k="${esc(it.previous.id)}">Open the earlier version</button></div></div></div>`;
    if (it.next) notes += `<div class="ts-panel claude"><h4>Claude made a new version</h4><p class="ts-note">After your comment. Both are kept.</p><button class="linkish" type="button" data-ov="goto" data-k="${esc(it.next.id)}">Open "${esc(it.next.title)}"</button></div>`;
    return `<div><span class="ts-kick">${esc(kindName(it.kind))}${from ? ` · ${from}` : ""}${it.running ? " · still running" : ""} · ${esc(when(it.at))}</span> ${open}</div>
<h3>${esc(it.title)}</h3>
${stSel}
${notes}
<div class="md ts-about">${md(it.about || "Claude didn't write a description.")}</div>
${facts ? `<div class="ts-facts">${esc(facts)}</div>` : ""}${warn}${blend ? `<div>${blend}</div>` : ""}
${lightingHTML()}
${critiqueHTML()}
${opinionsHTML()}
<div class="ts-call">${callHTML()}</div>`;
  }
  function lightingHTML() {
    const L = O.item.lighting;
    if (!L) return "";
    const diff = arr(L.diff).length ? `<div class="ts-diff">${L.diff.map((d) => `<b>${esc(d.key)}</b><span>${d.before == null ? "" : esc(d.before) + " → "}${esc(d.after == null ? "removed" : d.after)}</span>`).join("")}</div>` : `<p class="ts-note">No settings saved for before and after.</p>`;
    const undo = L.undoLua ? `<details><summary>Undo in Studio</summary><p class="ts-note">Puts the lighting back to how it was before. Paste it into the Command Bar of the ${L.test ? "test " : ""}place${L.place ? ` (${esc(L.place)})` : ""}; it changes Lighting only.</p><pre>${esc(L.undoLua)}</pre><button class="btn small" type="button" data-ov="copyundo">Copy the undo script</button></details>` : "";
    return `<div class="ts-panel"><h4>Lighting${L.place ? ` · ${esc(L.place)}` : ""}${L.test ? " · test place" : ""}</h4>${diff}${L.undo ? `<p class="ts-note">${esc(L.undo)}</p>` : ""}${undo}</div>`;
  }
  function critiqueHTML() {
    const it = O.item, c = it.critique;
    if (!c) return it.notCritiqued ? `<p class="ts-note">Not reviewed by Claude: its critic was off when this was made.</p>` : "";
    if (c.skipped && c.score == null) return `<p class="ts-note">${esc(c.skipped)}</p>`;
    const list = (h, xs) => (arr(xs).length ? `<div><b>${h}</b><ul>${xs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : "");
    const meta = [c.passes ? `${plural(c.passes, "pass")}`.replace("passs", "passes") : "", c.pictures ? `${c.pictures} pictures` : ""].filter(Boolean).join(" · ");
    return `<div class="ts-panel"><h4>Claude's critic (advice only)</h4>${c.score != null ? `<span class="ts-score">${esc(c.score)}/10</span>` : ""}${meta ? ` <span class="ts-note">${esc(meta)}</span>` : ""}${c.summary ? `<div>${esc(c.summary)}</div>` : ""}${list("Still open", c.mustFix)}${list("Fixed before you saw it", c.fixed)}${list("Nice to have", c.niceToHave)}</div>`;
  }
  function opinionsHTML() {
    const it = O.item, cr = it.critics, d = T.data || {}, wait = d.critics && d.critics.waiting;
    const rows = [];
    if (it.guess) rows.push(`<div class="ts-op"><b>Claude guessed: ${esc(it.guess.lean)}</b>${it.guess.why ? ` — ${esc(it.guess.why)}` : ""}</div>`);
    for (const o of arr(cr && cr.opinions)) {
      if (o.error) { rows.push(`<div class="ts-op"><b>${esc(o.lens)} critic</b>: couldn't grade (${esc(o.error)})</div>`); continue; }
      const more = arr(o.good).length || arr(o.fix).length ? `<details><summary>Good and fixes</summary>${arr(o.good).length ? `<div>Good: ${arr(o.good).map(esc).join("; ")}</div>` : ""}${arr(o.fix).length ? `<div>Fix: ${arr(o.fix).map(esc).join("; ")}</div>` : ""}</details>` : "";
      rows.push(`<div class="ts-op"><b>${esc(o.lens)} critic · ${esc(o.score)}/10 · ${esc(o.lean)}</b> — ${esc(o.why)}${more}</div>`);
    }
    for (const l of arr(cr && cr.pending)) rows.push(`<div class="ts-op">${esc(l)} critic: waiting${wait ? ` (${esc(wait)})` : ""}</div>`);
    if (cr && cr.skipped && !arr(cr.pending).length && !arr(cr.opinions).length) rows.push(`<div class="ts-op ts-note">Critics skipped: ${esc(cr.skipped)}</div>`);
    const pics = hasSpin() || arr(it.fileList).some((f) => /^(png|jpe?g|gif|webp|bmp)$/.test(f.ext));
    const ask = lite() || !pics ? "" : `<button class="btn small" type="button" data-ov="ask"${O.asked || arr(cr && cr.pending).length ? " disabled" : ""}>${O.asked || arr(cr && cr.pending).length ? "Critics are looking…" : "Ask extra critics"}</button>`;
    const n = (it.guess ? 1 : 0) + arr(cr && cr.opinions).length;
    if (!n && !ask) return "";
    return `<details class="ts-ops"><summary>Claude's guess and extra critics (advice only)${n ? ` · ${n}` : ""}</summary>${rows.join("") || `<p class="ts-note">No opinions yet.</p>`}${ask ? `<div style="margin-top:6px">${ask}</div>` : ""}</details>`;
  }
  function reasonsOf(dec) { const r = T.data && T.data.reasons; const k = O.item && O.item.kind; return arr(r && (r[k] || r.other) && (r[k] || r.other)[dec]); }
  function callHTML() {
    const it = O.item, v = it.verdict, f = O.form;
    if (v && v.decision && !f.editing) {
      const lab = (k) => (reasonsOf(v.decision).find((r) => r[0] === k) || [k, k])[1];
      const what = { approve: "approved this", deny: "denied this", dismiss: "marked this as not a real piece", comment: "sent this back to Claude" }[v.decision];
      const day = v.at ? new Date(v.at).toLocaleDateString([], { month: "short", day: "numeric" }) : "";
      const why = [arr(v.reasons).map(lab).join(" · "), v.note ? `"${v.note}"` : ""].filter(Boolean).join(" · ");
      const nextStep = v.decision === "comment" ? `<p class="ts-note">${it.next ? "Claude answered with a new version." : "The next round revises a copy and puts the new version in your queue."}</p>` : "";
      const freeLabel = O.armed === "free" ? "Click again: delete the spin frames and extra stills, keep the 3/4 still, your verdict and Claude's notes" : "Free space";
      const canFree = it.kind === "model" && ["approved", "denied", "dismissed", "revised"].includes(it.status) && (it.frames || arr(it.stills).length > 1);
      return `<h4>Your call</h4><p class="ts-note">You ${what}${day ? ` on ${esc(day)}` : ""}${why ? ` — ${esc(why)}` : ""}</p>${nextStep}
<div class="ts-acts"><button class="btn small" type="button" data-ov="change">Change verdict</button><button class="btn small" type="button" data-ov="clear">Move back to To review</button>${canFree ? `<button class="btn small${O.armed === "free" ? " ts-armed" : ""}" type="button" data-ov="free">${esc(freeLabel)}</button>` : ""}</div>
<p class="ts-msg" role="status"></p>`;
    }
    const chips = (dec) => `<div class="ts-rs" data-for="${dec}"${f.decision === dec ? "" : " hidden"}>${reasonsOf(dec).map(([k, l], i) => `<button class="btn small" type="button" data-ov="reason" data-k="${esc(k)}" aria-pressed="${f.decision === dec && f.reasons.has(k)}">(${i + 1}) ${esc(l)}</button>`).join("")}</div>`;
    return `<h4>Your call</h4>
<div class="ts-dec"><button class="btn" type="button" data-ov="dec" data-d="approve" aria-pressed="${f.decision === "approve"}">Approve <span class="ts-note">A</span></button><button class="btn" type="button" data-ov="dec" data-d="deny" aria-pressed="${f.decision === "deny"}">Deny <span class="ts-note">D</span></button><button class="btn" type="button" data-ov="dec" data-d="comment" aria-pressed="${f.decision === "comment"}" title="Send it back to Claude with what to change">Comment <span class="ts-note">C</span></button></div>
${chips("approve")}${chips("deny")}
<textarea data-ov="note" maxlength="1000" placeholder="${f.decision === "comment" ? "What should Claude change? e.g. make the barrel thicker, less shiny" : "Why? (optional if you picked a reason)"}" aria-label="${f.decision === "comment" ? "What to change" : "Why"}"></textarea>
<div class="ts-acts"><button class="btn primary" type="button" data-ov="save">Save and next ⏎</button><button class="linkish" type="button" data-ov="skip">Skip</button><span class="ts-note">·</span><button class="linkish" type="button" data-ov="dismiss" title="Takes it out of the queue without teaching Claude anything">Not a real piece</button>${f.editing ? `<button class="linkish" type="button" data-ov="cancel">Cancel</button>` : ""}</div>
<p class="ts-msg" role="status"></p>`;
  }
  function canSave() { const f = O.form; return !!f.decision && (f.decision === "comment" ? f.note.trim().length >= 3 : f.reasons.size > 0 || f.note.trim().length >= 3); }
  function syncForm() {
    const b = q('[data-ov="save"]');
    if (!b) return;
    b.disabled = O.busy || !canSave();
    b.title = !O.form.decision ? "Pick Approve, Deny or Comment first" : !canSave() ? (O.form.decision === "comment" ? "Write what Claude should change" : "Pick a reason or write a few words: Claude learns your taste from the why") : "Save and go to the next one (Enter)";
    for (const d of O.el.querySelectorAll('[data-ov="dec"]')) d.setAttribute("aria-pressed", String(d.dataset.d === O.form.decision));
    for (const g of O.el.querySelectorAll(".ts-rs")) {
      g.hidden = g.dataset.for !== O.form.decision;
      for (const c of g.querySelectorAll("[data-k]")) c.setAttribute("aria-pressed", String(g.dataset.for === O.form.decision && O.form.reasons.has(c.dataset.k)));
    }
    const ta = q('[data-ov="note"]');
    if (ta) ta.placeholder = O.form.decision === "comment" ? "What should Claude change? e.g. make the barrel thicker, less shiny" : "Why? (optional if you picked a reason)";
  }
  function say(text, bad) { const m = q(".ts-call .ts-msg"); if (m) { m.textContent = text || ""; m.className = "ts-msg" + (text ? (bad ? " bad" : " ok") : ""); } }
  function renderSide(keepNote) {
    const note = keepNote ? O.form.note : "", had = O.el.contains(document.activeElement) && document.activeElement !== O.el;
    const ops = q(".ts-ops"), opsOpen = !!(keepNote && ops && ops.open);
    q(".ts-side").innerHTML = sideHTML();
    if (opsOpen && q(".ts-ops")) q(".ts-ops").open = true;
    const ta = q('[data-ov="note"]');
    if (ta) ta.value = note;
    q(".ts-shots").innerHTML = shotsHTML();
    const pv = q("img[data-prev]");
    if (pv && O.item.previous && O.item.previous.thumb) { const ctrl = O.ctrl; fileURL({ id: O.item.previous.id }, O.item.previous.thumb.file, O.item.previous.thumb.v).then((u) => { if (u && O.ctrl === ctrl && pv.isConnected) pv.src = u; }); }
    syncForm();
    if (had && !O.el.contains(document.activeElement)) O.el.focus({ preventScroll: true });
  }
  function setPos() {
    const label = { review: "to review", approved: "approved", denied: "denied", comment: "sent back", unfinished: "unfinished", all: "in the library" }[T.status] || "";
    const total = Math.max(T.total, O.ids.length);
    q(".ts-pos").textContent = O.id ? (O.ids.includes(O.id) ? `${O.pos + 1} of ${total} ${label}` : "") : "";
    q('[data-ov="prev"]').disabled = O.pos <= 0 || !O.id;
    q('[data-ov="next"]').disabled = !O.id;
  }
  async function showItem(id) {
    dropViewer();
    O.id = id; O.mode = "spin"; O.idx = 0; O.asked = false; O.view = 0; O.time = -1; O.ba = 50;
    q(".ts-ov-body").classList.remove("done");
    O.form = { decision: null, reasons: new Set(), note: "", editing: false };
    q(".ts-side").innerHTML = `<p class="ts-note">Loading…</p>`; q(".ts-shots").innerHTML = ""; q(".ts-alt").hidden = true; q(".ts-cw").hidden = false;
    setPos(); paint();
    const ctrl = new AbortController();
    O.ctrl = ctrl;
    let r = null;
    try { r = await fetch(`/api/taste/item/${encodeURIComponent(id)}`, { headers: { "X-Hive": "1" }, signal: ctrl.signal }).then((x) => x.json()); } catch {}
    if (ctrl.signal.aborted || O.ctrl !== ctrl) return; // every await below checks the same: another showItem or close took over
    if (!r || !r.item) { q(".ts-side").innerHTML = `<p class="ts-msg bad">Can't load this one.</p>`; return; }
    O.item = r.item;
    O.frameFiles = Object.keys(r.item.images || {}).filter((f) => /^turn-\d+\./.test(f)).sort((a, b) => parseInt(a.slice(5), 10) - parseInt(b.slice(5), 10));
    O.frames = O.frameFiles.map(() => null);
    O.pane = firstPane(r.item, panes(r.item)); O.file = null;
    renderSide(false);
    setPos();
    if (!O.el.contains(document.activeElement)) O.el.focus({ preventScroll: true }); // keys keep working after a save re-renders the form
    await mountViewer();
    if (O.ctrl !== ctrl) return;
    // Only prefetch: the next card's thumbnail.
    const nx = T.list.find((x) => x.id === O.ids[O.pos + 1]); if (nx) loadThumb(nx);
  }
  // The spin, loaded the first time it is on screen (once per opened item): the 3/4 still first, then the frames in
  // order (drawn as they arrive), then the other stills.
  async function loadSpin() {
    const ctrl = O.ctrl;
    if (!ctrl) return;
    if (O.spinFor === ctrl) { paint(); if (!O.touched && !reduce()) setSpin(true); return; }
    O.spinFor = ctrl;
    await getStill("34");
    if (O.ctrl !== ctrl) return;
    paint();
    if (!O.touched && !reduce() && isModel()) setSpin(true);
    await Promise.all(O.frameFiles.map(async (f, i) => { const b = await bitmap(f); if (b && O.ctrl === ctrl) { O.frames[i] = b; if (isModel() && O.mode === "spin") paint(); else if (isModel()) hint(); } else if (b) { b.close(); T.bitmaps--; } }));
    if (O.ctrl !== ctrl) return;
    for (const k of ["front", "side", "top", "clay"]) { if (O.ctrl !== ctrl) return; await getStill(k); }
  }
  function open(id, from) {
    ensureOverlay();
    O.ids = T.list.map((x) => x.id);
    O.pos = O.ids.indexOf(id); // -1 when it isn't in the list: no position shown, Prev off, Next opens the first
    O.from = from || null; O.fromId = id; O.reviewed = 0; O.touched = false;
    O.el.hidden = false;
    setInert(true);
    O.el.focus();
    showItem(id);
  }
  function close() {
    if (!O.el || O.el.hidden) return;
    dropViewer();
    O.el.hidden = true; O.id = null;
    setInert(false);
    const fromId = O.fromId, back = O.from && O.from.isConnected ? O.from : T.root && [...T.root.querySelectorAll("[data-id]")].find((x) => x.dataset.id === fromId);
    if (back) back.focus();
    // The reload re-renders the view (counts and chips changed), which drops that card: focus the new card for the
    // same item, or the first card when it moved to another tab, unless the user already moved focus elsewhere.
    load(true).then(() => {
      const a = document.activeElement;
      if (!O.el.hidden || (a && a !== document.body && a !== T.root)) return; // reopened, or focus is somewhere live
      focusIn((x) => x.dataset.ts === "open" && x.dataset.id === fromId) || focusIn((x) => x.dataset.ts === "open");
    });
  }
  async function go(d) {
    let pos = O.pos + d;
    if (pos < 0) return;
    if (pos >= O.ids.length && T.list.length < T.total) {
      const ctrl = O.ctrl;
      await loadMore();
      if (O.el.hidden || O.ctrl !== ctrl) return; // closed, or another item opened meanwhile
      O.ids = O.ids.concat(T.list.map((x) => x.id).filter((x) => !O.ids.includes(x)));
    }
    if (pos >= O.ids.length) return finished();
    O.pos = pos;
    showItem(O.ids[pos]);
  }
  // The end of the list. Opened mid-queue (or after Skip), items before it may still wait: say so and offer the first
  // of them instead of "All caught up".
  async function finished() {
    dropViewer();
    O.id = null; setPos();
    const done = O.reviewed ? `you reviewed ${plural(O.reviewed, "piece")}` : "";
    let left = 0;
    if (T.status === "review") { await load(true); if (O.el.hidden || O.id) return; left = T.list.length; }
    q(".ts-alt").hidden = true;
    q(".ts-side").innerHTML = left
      ? `<div class="ts-done"><p>End of the list${done ? `: ${done}` : ""}. ${plural(left, "piece")} before it still wait${left === 1 ? "s" : ""}.</p><div class="ts-acts"><button class="btn" type="button" data-ov="restart">Review ${left === 1 ? "it" : "them"}</button><button class="btn" type="button" data-ov="close">Close</button></div></div>`
      : `<div class="ts-done"><p>All caught up${done ? `: ${done}` : ""}.</p><button class="btn" type="button" data-ov="close">Close</button></div>`;
    q(".ts-ov-body").classList.add("done");
    const b = q(".ts-done button"); if (b) b.focus();
  }
  // after(r, stale): stale when the overlay closed or another item came on screen while the request ran. The verdict
  // was still saved, so after() still says so, but must not move on, re-render or touch the new item's form.
  async function send(body, after) {
    if (O.busy || !O.item) return;
    const ctrl = O.ctrl;
    O.busy = true; syncForm(); say("");
    const r = await post(`/api/taste/item/${encodeURIComponent(O.item.id)}/verdict`, body);
    O.busy = false;
    const stale = O.el.hidden || O.ctrl !== ctrl;
    if (stale) syncForm(); // the item on screen now drew its Save button while this was busy
    if (r.error) { if (stale) toast("Couldn't save it", r.error); else { syncForm(); say(r.error, true); } return; }
    after(r, stale);
  }
  function save() {
    if (!canSave()) { syncForm(); say(!O.form.decision ? "Pick Approve, Deny or Comment first." : O.form.decision === "comment" ? "Write what Claude should change." : "Pick a reason or write a few words: Claude learns your taste from the why.", true); return; }
    const dec = O.form.decision;
    send({ decision: dec, reasons: dec === "comment" ? [] : [...O.form.reasons], note: O.form.note }, (r, stale) => {
      O.reviewed++;
      toast("Taste", dec === "comment" ? "Sent back: the next round revises it and puts the new version in your queue." : "Saved. Claude will aim for this.");
      if (stale) return;
      if (O.form.editing && T.status !== "review") { load(true); showItem(O.item.id); return; }
      go(1);
    });
  }
  async function onOvClick(e) {
    const b = e.target && e.target.closest ? e.target.closest("[data-ov]") : null;
    if (!b || b.disabled) return;
    const a = b.dataset.ov;
    if (a === "close") close();
    else if (a === "next" || a === "skip") go(1);
    else if (a === "restart") { O.ids = T.list.map((x) => x.id); O.pos = 0; if (O.ids.length) showItem(O.ids[0]); else close(); }
    else if (a === "prev") go(-1);
    else if (a === "shot") { touch(); O.mode = b.dataset.k; if (O.mode !== "spin") await getStill(O.mode); q(".ts-shots").innerHTML = shotsHTML(); paint(); }
    else if (a === "spin") { O.touched = true; setSpin(!O.spin); }
    else if (a === "view" || a === "time") {
      if (a === "view") { O.view = Number(b.dataset.k) || 0; O.time = -1; } else O.time = Number(b.dataset.k);
      clearViewer(); q(".ts-shots").innerHTML = shotsHTML(); mountLighting();
    }
    else if (a === "file") { O.file = b.dataset.k; clearViewer(); q(".ts-shots").innerHTML = shotsHTML(); mountViewer(); }
    else if (a === "pane") { setSpin(false); O.pane = b.dataset.k; O.file = null; O.compare = false; clearViewer(); q(".ts-shots").innerHTML = shotsHTML(); mountViewer(); }
    else if (a === "zfit") zoomFit();
    else if (a === "z1") zoomOne();
    else if (a === "zin") zoomBy(1.25);
    else if (a === "zout") zoomBy(0.8);
    else if (a === "compare") {
      O.compare = !O.compare; touch(); clearViewer();
      if (!O.compare && isModel()) { q(".ts-alt").hidden = true; q(".ts-cw").hidden = false; paint(); } else mountViewer();
      q(".ts-shots").innerHTML = shotsHTML();
    }
    else if (a === "goto") { const id = b.dataset.k; O.pos = O.ids.indexOf(id); showItem(id); } // -1 when not in the list, as in open()
    else if (a === "fopen" || a === "freveal") {
      const r = await post(`/api/taste/item/${encodeURIComponent(O.item.id)}/open`, { file: b.dataset.k, action: a === "fopen" ? "open" : "reveal" });
      if (r.error) toast(a === "fopen" ? "Couldn't open it" : "Couldn't show it", r.error);
    }
    else if (a === "release") {
      const ctrl = O.ctrl, id = O.item.id;
      const r = await post(`/api/taste/item/${encodeURIComponent(id)}/release`, {});
      if (r.error) { toast("Couldn't move it", r.error); return; }
      toast("Taste", "It's in your queue now, without Claude's critic.");
      if (!O.el.hidden && O.ctrl === ctrl) showItem(id);
    }
    else if (a === "dec") pick(b.dataset.d);
    else if (a === "reason") { const k = b.dataset.k; if (O.form.reasons.has(k)) O.form.reasons.delete(k); else O.form.reasons.add(k); syncForm(); }
    else if (a === "save") save();
    else if (a === "dismiss") send({ decision: "dismiss" }, (r, stale) => { toast("Taste", "Taken out of the queue."); if (!stale) go(1); });
    else if (a === "change") {
      disarm();
      const v = O.item.verdict;
      O.form = { decision: v.decision === "dismiss" ? null : v.decision, reasons: new Set(arr(v.reasons)), note: v.note || "", editing: true };
      renderSide(true);
    }
    else if (a === "cancel") { disarm(); O.form = { decision: null, reasons: new Set(), note: "", editing: false }; renderSide(false); }
    else if (a === "clear") send({ decision: "clear" }, (r, stale) => { if (!stale) { disarm(); O.item = r.item; O.form.editing = false; renderSide(false); } toast("Taste", "Moved back to To review."); });
    else if (a === "free") {
      clearTimeout(O.armTimer);
      if (O.armed !== "free") {
        O.armed = "free"; renderSide(true);
        const ctrl = O.ctrl;
        O.armTimer = setTimeout(() => { O.armTimer = 0; if (O.armed !== "free" || O.ctrl !== ctrl) return; O.armed = null; renderSide(true); }, 5000);
        return;
      }
      disarm();
      const ctrl = O.ctrl, id = O.item.id;
      const r = await post(`/api/taste/item/${encodeURIComponent(id)}/free`, { confirm: true });
      const stale = O.el.hidden || O.ctrl !== ctrl;
      if (r.error) { if (stale) toast("Couldn't free space", r.error); else say(r.error, true); return; }
      toast("Taste", "Spin frames and extra stills deleted.");
      if (!stale) showItem(id);
    }
    else if (a === "ask") {
      O.asked = true; renderSide(true);
      const ctrl = O.ctrl;
      const r = await post(`/api/taste/item/${encodeURIComponent(O.item.id)}/critique`, {});
      if (r.error) { if (O.el.hidden || O.ctrl !== ctrl) toast("Couldn't ask the critics", r.error); else { O.asked = false; renderSide(true); say(r.error, true); } }
    }
    else if (a === "chat") {
      const chatId = O.item && (O.item.chatId || (O.item.roundInfo && O.item.roundInfo.chatId));
      close(); // first: openSession shows Chats, and it may return early
      if (chatId && typeof openSession === "function") Promise.resolve().then(() => openSession(chatId)).catch(() => toast("Couldn't open the chat", "Try again in a moment."));
    }
    else if (a === "copy") { const p = O.item.blend.path; try { await navigator.clipboard.writeText(p); toast("Copied", p); } catch { toast("Couldn't copy", p); } }
    else if (a === "copyundo") { try { await navigator.clipboard.writeText(O.item.lighting.undoLua); toast("Copied", "Paste it into Studio's Command Bar in the test place."); } catch { toast("Couldn't copy", "Select the script and copy it."); } }
  }
  // Leaves the current viewer's media (not the item): used when switching view, file or compare.
  function clearViewer() {
    cancelAnimationFrame(O.raf); O.raf = 0;
    const a = q(".ts-alt");
    for (const m of a.querySelectorAll("audio,video")) { try { m.pause(); } catch {} }
    a.innerHTML = ""; O.zoom = null; O.audio = null;
  }
  function pick(d) {
    if (O.form.decision !== d) O.form.reasons = new Set();
    O.form.decision = d;
    syncForm();
    if (d === "comment") { const ta = q('[data-ov="note"]'); if (ta) ta.focus(); }
  }
  function onKey(e) {
    const t = e.target, typing = t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.tagName === "SELECT");
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (typing) { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key, onButton = t && /^(BUTTON|SUMMARY|A)$/.test(t.tagName); // Enter/Space keep their own meaning there
    const editing = q('[data-ov="save"]');
    if ((k === "a" || k === "A") && editing) pick("approve");
    else if ((k === "d" || k === "D") && editing) pick("deny");
    else if ((k === "c" || k === "C") && editing) pick("comment");
    else if (/^[1-7]$/.test(k) && editing && O.form.decision && O.form.decision !== "comment") { const r = reasonsOf(O.form.decision)[Number(k) - 1]; if (r) { if (O.form.reasons.has(r[0])) O.form.reasons.delete(r[0]); else O.form.reasons.add(r[0]); syncForm(); } }
    else if (k === "ArrowRight" && isModel()) { touch(); step(-1); }
    else if (k === "ArrowLeft" && isModel()) { touch(); step(1); }
    else if (k === " " && !onButton && isModel()) { O.touched = true; setSpin(!O.spin); }
    else if (O.zoom && (k === "0" || k === "+" || k === "=" || k === "-")) { if (k === "0") zoomFit(); else zoomBy(k === "-" ? 0.8 : 1.25); }
    else if (k === "j" || k === "J" || k === "PageDown") go(1);
    else if (k === "k" || k === "K" || k === "PageUp") go(-1);
    else if (k === "s" || k === "S") go(1);
    else if (k === "Enter" && !onButton && editing) save();
    else return;
    e.preventDefault();
  }

  /* ---------- lifecycle ---------- */
  let poll = 0;
  window.addEventListener("hive:view", (e) => {
    close(); // the focus view never outlives a change of view (a toast, Open chat, a notification)
    const v = e.detail && e.detail.view;
    clearInterval(poll); poll = 0;
    if (v === "taste") {
      setTimeout(() => { draw(); load(true); }, 0);
      poll = setInterval(() => { if (!O.el || O.el.hidden) load(true); }, 30000);
    } else if (v === "training" || v === "working") {
      // autopilot-client builds those views on this same event: the summary and the pickers go in after it.
      setTimeout(() => { drawTraining(); loadStyles(); loadIndex(); }, 0);
    }
  });
  window.addEventListener("hive:server", (e) => {
    const ev = e.detail || {};
    let hit = ev.t === "taste" || ev.t === "hello";
    const last = ev.t === "autopilot" && ev.state && ev.state.last;
    if (last && ["result", "error"].includes(last.type) && last.id !== T.lastAp) { T.lastAp = last.id; hit = true; }
    if (!hit) return;
    if (ev.t === "taste" && ev.kind === "critics" && O.el && !O.el.hidden && O.item && (!ev.id || ev.id === O.item.id)) {
      // Opinions arrived for the piece on screen: refresh only its side panel's opinions, keeping what the user typed.
      api(`/api/taste/item/${encodeURIComponent(O.item.id)}`).then((r) => {
        if (!r || !r.item || !O.item || r.item.id !== O.item.id) return;
        const open = !!q(".ts-ops") && q(".ts-ops").open;
        O.item = { ...O.item, critics: r.item.critics }; O.asked = false;
        const box = q(".ts-ops"); if (box) { box.outerHTML = opinionsHTML(); if (open && q(".ts-ops")) q(".ts-ops").open = true; }
      }).catch(() => {});
    }
    clearTimeout(T.deb); T.deb = setTimeout(() => {
      if (visible()) load(true); else loadCount();
      const v = document.querySelector('.nav[aria-current="page"]'), cur = v && v.dataset.view;
      if (cur === "training" || cur === "working") { loadIndex(); if (ev.kind === "styles") loadStyles(); }
    }, 1500);
  });
  window.addEventListener("hive:edition", () => { if (visible()) draw(); });
  setInterval(() => { if (!visible()) loadCount(); }, 5 * 60e3); // keeps the tab badge right while elsewhere
  loadCount();

  window.HiveTaste = { load, open, close, state: T, view: O, fromRound, sendMedia, forRound, addDialog };
})();
