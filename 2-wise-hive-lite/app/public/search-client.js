/* Search inside chats: the page side of search.js. The chat list's own search (#chatSearch) only matches titles; this adds a
   "Found inside chats" section under those matches once the query has 3+ characters, with highlighted snippets.
   Its rows are ordinary .item[data-id] buttons, so the list's existing click handler opens them. */
(function () {
  "use strict";
  const MIN = 3, WAIT = 300, LIMIT = 20;
  const input = $("chatSearch"), items = $("chatItems");
  if (!input || !items) return;
  const style = document.createElement("style");
  style.textContent = `
.sr-sec{border-top:1px solid var(--line);margin-top:6px}
.sr-sec .item{align-items:flex-start}
.sr-snip{display:block;margin-top:2px;font-size:11px;line-height:1.4;color:var(--muted);white-space:normal;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.sr-snip em{font-style:normal;font-weight:700;color:var(--ink);opacity:.75}
.sr-snip mark{background:color-mix(in srgb,var(--gold) 30%,transparent);color:var(--ink);border-radius:3px;padding:0 1px}
.sr-note{padding:4px 7px 8px;font-size:11.5px;color:var(--muted)}`;
  document.head.appendChild(style);

  let timer = 0, seq = 0, q = "", html = "", last = null;
  const sec = document.createElement("div");
  sec.className = "sr-sec"; sec.setAttribute("aria-label", "Found inside chats");

  function mark(s) {
    const t = String(s.text || ""), hits = Array.isArray(s.hits) ? s.hits : [];
    let out = "", at = 0;
    for (const [a, b] of hits) {
      if (!(a >= at && b > a && b <= t.length)) continue;
      out += esc(t.slice(at, a)) + `<mark>${esc(t.slice(a, b))}</mark>`;
      at = b;
    }
    return out + esc(t.slice(at));
  }
  // Chats already listed as title matches above aren't repeated.
  function render(res) {
    const shown = new Set([...items.querySelectorAll(".item[data-id]")].filter((b) => !sec.contains(b)).map((b) => b.dataset.id));
    const list = (Array.isArray(res.results) ? res.results : []).filter((r) => r && r.id && !shown.has(r.id));
    const rows = list.map((r) => `<button class="item" type="button" data-id="${esc(r.id)}" title="${esc(r.title)}"><span class="idle-dot"></span><span class="t"><b>${esc(r.title)}</b><small>${esc(r.project)} · ${esc(ago(r.updated))}${r.matches > 1 ? ` · ${r.matches} messages` : ""}</small>${(Array.isArray(r.snippets) ? r.snippets : []).slice(0, 3).map((s) => `<span class="sr-snip"><em>${s.role === "you" ? "You" : "Claude"}:</em> ${mark(s)}</span>`).join("")}</span></button>`).join("");
    const more = res.total > (res.results || []).length ? `<div class="sr-note">Showing the newest ${(res.results || []).length} of ${res.total}. Add a word to narrow it down.</div>` : "";
    return `<div class="group">Found inside chats</div>${rows || `<div class="sr-note">${(res.results || []).length ? "Only the chats above mention it." : "No chat mentions that."}</div>`}${more}`;
  }
  function attach() {
    if (!html) { if (sec.isConnected) sec.remove(); return; }
    if (sec.innerHTML !== html) sec.innerHTML = html;
    if (sec.parentNode !== items || items.lastChild !== sec) items.appendChild(sec);
  }
  async function run() {
    const my = ++seq, text = input.value.trim();
    q = text;
    if (text.length < MIN) { html = ""; last = null; attach(); return; }
    last = null; html = `<div class="group">Found inside chats</div><div class="sr-note">Searching…</div>`; attach();
    let res = null;
    try { res = await api(`/api/search?q=${encodeURIComponent(text)}&limit=${LIMIT}`); } catch {}
    if (my !== seq) return;
    last = res && !res.error ? res : null;
    html = last ? render(last) : `<div class="group">Found inside chats</div><div class="sr-note">Can't search inside chats right now.</div>`;
    attach();
  }
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, WAIT); });
  // The list redraws itself (new runs, reloads) and wipes the section; put it back, with "already shown" recomputed.
  let fixing = false;
  new MutationObserver(() => {
    if (fixing || !html || sec.parentNode === items) return;
    fixing = true;
    try { if (input.value.trim() === q) { if (last) html = render(last); attach(); } } finally { fixing = false; }
  }).observe(items, { childList: true });

  window.HiveSearch = { run, mark };
})();
