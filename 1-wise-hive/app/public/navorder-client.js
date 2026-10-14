/* Reorderable left rail (2026-10-13). Hold a tab (~0.3 s) or press and drag it to move it up or down the rail; the
   order is saved in localStorage ("hive-nav-order") and restored next time. Home is fixed at the top: it can't be
   moved and nothing can go above it. Esc while dragging puts everything back; Alt+Up/Down moves the focused tab.
   The gap that pushes the last three tabs to the bottom stays in front of whichever three are last.
   A click that ended a drag that moved a tab doesn't open the tab. */
(function () {
  "use strict";
  const rail = document.querySelector("nav.rail");
  if (!rail) return;
  const KEY = "hive-nav-order", HOLD_MS = 300, MOVE_PX = 6;
  const style = document.createElement("style");
  style.textContent = `
.rail .nav.nav-dragging{opacity:.55;outline:1px dashed var(--muted);outline-offset:-2px}
body.nav-reordering, body.nav-reordering *{cursor:grabbing!important;user-select:none}
.rail .nav.nav-holding{background:var(--sunk)}`;
  document.head.appendChild(style);

  const tabs = () => [...rail.querySelectorAll(":scope > .nav[data-view]")];
  const home = () => rail.querySelector(':scope > .nav[data-view="home"]');
  const movable = (b) => b && b.dataset.view !== "home";
  // The bottom gap sits on the first of the last three tabs.
  function fixGap() {
    const all = tabs();
    all.forEach((b) => b.classList.remove("nav-bottom"));
    if (all.length > 4) all[all.length - 3].classList.add("nav-bottom");
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(tabs().map((b) => b.dataset.view))); } catch {} }
  function restore() {
    let order = null;
    try { order = JSON.parse(localStorage.getItem(KEY) || "null"); } catch {}
    if (!Array.isArray(order)) return fixGap();
    const orig = tabs().map((b) => b.dataset.view);
    const byView = new Map(tabs().map((b) => [b.dataset.view, b]));
    const end = tabs().pop().nextSibling;
    for (const v of order) { const b = byView.get(v); if (movable(b)) { rail.insertBefore(b, end); byView.delete(v); } }
    // Tabs added since the order was saved go in front of the tab that follows them in the page (e.g. Taste in front of
    // Updates), or at the end when that one is new too.
    for (const [v, b] of byView) {
      if (!movable(b)) continue;
      const nextV = orig.slice(orig.indexOf(v) + 1).find((x) => !byView.has(x) && order.includes(x));
      const before = nextV ? rail.querySelector(`:scope > .nav[data-view="${nextV}"]`) : null;
      rail.insertBefore(b, before || end);
    }
    fixGap();
  }
  restore();

  let press = null, drag = null, swallowClick = false;
  function startDrag() {
    const b = press.btn, all = tabs();
    // end: what follows the last tab now (no drag moves it), so Esc can put every tab back in front of it.
    drag = { btn: b, before: all, end: all[all.length - 1].nextSibling };
    b.classList.remove("nav-holding");
    b.classList.add("nav-dragging");
    document.body.classList.add("nav-reordering");
  }
  function moveTo(y) {
    const b = drag.btn, others = tabs().filter((x) => x !== b && movable(x));
    let target = null;
    for (const o of others) { const r = o.getBoundingClientRect(); if (y < r.top + r.height / 2) { target = o; break; } }
    const after = target || (others.length ? others[others.length - 1].nextSibling : home().nextSibling);
    if (after !== b && after !== b.nextSibling) rail.insertBefore(b, after);
    fixGap();
  }
  function endDrag(cancel) {
    const d = drag;
    drag = null;
    document.body.classList.remove("nav-reordering");
    if (!d) return;
    d.btn.classList.remove("nav-dragging");
    if (cancel) { for (const b of d.before) rail.insertBefore(b, d.end); fixGap(); return; }
    save();
    // Only a drag that moved something eats its click; a slow click that changed nothing still opens the tab.
    if (tabs().some((b, i) => b !== d.before[i])) { swallowClick = true; setTimeout(() => (swallowClick = false), 0); }
  }
  function clearPress() {
    if (!press) return;
    clearTimeout(press.timer);
    press.btn.classList.remove("nav-holding");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    press = null;
  }
  function onMove(e) {
    if (!press) return;
    if (!drag && Math.abs(e.clientY - press.y) > MOVE_PX) startDrag();
    if (drag) { e.preventDefault(); moveTo(e.clientY); }
  }
  function onUp() { const was = !!drag; clearPress(); if (was) endDrag(false); }
  function onCancel() { clearPress(); endDrag(true); }
  rail.addEventListener("pointerdown", (e) => {
    const btn = e.target.closest(".nav[data-view]");
    if (e.button !== 0 || !movable(btn)) return;
    press = { btn, y: e.clientY, timer: setTimeout(() => { if (press && !drag) { startDrag(); } }, HOLD_MS) };
    btn.classList.add("nav-holding");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  });
  // Swallow the click that ends a drag, before the app's own click handler opens the tab.
  rail.addEventListener("click", (e) => { if (swallowClick) { e.stopImmediatePropagation(); e.preventDefault(); swallowClick = false; } }, true);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && drag) { clearPress(); endDrag(true); return; }
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    const b = document.activeElement && document.activeElement.closest && document.activeElement.closest(".rail .nav[data-view]");
    if (!movable(b)) return;
    e.preventDefault();
    const list = tabs(), i = list.indexOf(b);
    if (e.key === "ArrowUp" && i > 1) rail.insertBefore(b, list[i - 1]);
    if (e.key === "ArrowDown" && i < list.length - 1) rail.insertBefore(b, list[i + 1].nextSibling);
    fixGap(); save(); b.focus();
  });
  window.HiveNavOrder = { reset() { try { localStorage.removeItem(KEY); } catch {} location.reload(); } };
})();
