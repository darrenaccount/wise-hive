// Chat media core: the logic shared by the server (media.js) and the page (media-client.js) for pictures and files
// Claude shows in chats. No DOM use, so test/media-test.js checks it with node. UMD: module.exports under node,
// window.HiveMediaCore in the page.
//   anchorOf(text)        the turn anchor of a human message: app-added wrappers stripped, whitespace collapsed,
//                         lowercased, 100 characters. Server (replayed prompt) and page (typed or transcript text) agree.
//   sameAnchor(a, b)      equal, or the shorter (12+ characters) is a prefix of the other.
//   add(c, msg, items)    adds items to a message of chat c, deduped across the whole chat: one item per turn and file
//                         (tid|key); a newer version or a higher kind (shown > made > seen) replaces the old one.
//   place(c, items, o)    puts index items (grouped by turn) on the reply to their user message, found by anchor.
(function (root, factory) {
  const m = factory();
  if (typeof module === "object" && module.exports) module.exports = m; else root.HiveMediaCore = m;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const RANK = { shown: 3, made: 2, seen: 1 };
  const PER_MSG = 120;

  function anchorOf(text) {
    return String(text || "")
      .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
      .replace(/^\s*Continue our earlier conversation\. Read its full record first:[^\n]*\n+/, "")   // index.html sendPrompt
      .replace(/\n+Attached files \(saved on disk\):\n[\s\S]*$/, "")                               // server.js userContent
      .replace(/\n+\(Team mode: split this work across subagents[\s\S]*$/, "")                      // server.js startChat
      .replace(/\s+/g, " ").trim().toLowerCase().slice(0, 100);
  }
  function sameAnchor(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    const [s, l] = a.length <= b.length ? [a, b] : [b, a];
    return s.length >= 12 && l.startsWith(s);
  }
  const rank = (k) => RANK[k] || 0;
  function push(msg, it) {
    const list = msg.media || (msg.media = []);
    list.push(it);
    // Cap per message: drop "looked at" captures first, then the oldest.
    while (list.length > PER_MSG) { const i = list.findIndex((x) => x.kind === "seen"); list.splice(i >= 0 ? i : 0, 1); }
    msg._d = true;
  }
  function drop(msg, it) {
    if (!msg || !msg.media) return;
    const i = msg.media.indexOf(it);
    if (i >= 0) { msg.media.splice(i, 1); msg._d = true; }
  }
  // Returns how many items were added or replaced.
  function add(c, msg, items) {
    if (!c || !msg || !Array.isArray(items)) return 0;
    const mx = c._mx || (c._mx = new Map()), mk = c._mk || (c._mk = new Set());
    let n = 0;
    for (const it of items) {
      if (!it || !it.key) continue;
      if (!it.tid) {                          // a scan of an old reply: only files not shown anywhere in this chat yet
        if (mk.has(it.key)) continue;
        push(msg, it); mk.add(it.key); n++;
        continue;
      }
      const id = it.tid + "|" + it.key, prev = mx.get(id);
      if (!prev) { push(msg, it); mx.set(id, { msg, it }); mk.add(it.key); n++; continue; }
      const up = rank(it.kind) > rank(prev.it.kind);
      if (prev.it.ver === it.ver && !up) continue;
      // A newer version or a higher kind: move it, keeping the higher kind. It moves to msg only when its kind went up
      // (looked at in one reply segment, then shown in the next); a newer version stays where the item was.
      drop(prev.msg, prev.it);
      const nit = up ? it : { ...it, kind: prev.it.kind };
      const to = up ? msg : prev.msg;
      push(to, nit); mx.set(id, { msg: to, it: nit }); n++;
    }
    return n;
  }
  // The reply a turn's media goes on: the last assistant message before the next user message, else the next one after.
  function replyAfter(msgs, ui) {
    let last = -1, i = ui + 1;
    for (; i < msgs.length && msgs[i].role !== "user"; i++) if (msgs[i].role === "assistant") last = i;
    if (last >= 0) return msgs[last];
    for (; i < msgs.length; i++) if (msgs[i].role === "assistant") return msgs[i];
    return null;
  }
  const lastReply = (msgs) => { for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === "assistant") return msgs[i]; return null; };
  // o.fallback (late sweep: every item is from the run that just ran): search from the newest user message backwards,
  // and put a group that matches nothing on the last reply. Without it (restore): search forwards, drop what doesn't match.
  function place(c, items, o) {
    o = o || {};
    const msgs = (c && c.messages) || [], groups = [], by = new Map();
    for (const it of items || []) {
      if (!it || !it.tid || !it.key) continue;
      let g = by.get(it.tid);
      if (!g) { g = { anchor: it.anchor || "", items: [] }; by.set(it.tid, g); groups.push(g); }
      g.items.push(it);
    }
    const users = [];
    msgs.forEach((m, i) => { if (m.role === "user") users.push({ i, a: anchorOf(m.text) }); });
    const order = o.fallback ? groups.slice().reverse() : groups;
    let cur = o.fallback ? users.length - 1 : 0, n = 0;
    for (const g of order) {
      let hit = -1;
      const range = o.fallback ? (f) => { for (let k = cur; k >= 0; k--) if (f(users[k].a)) return k; return -1; }
                               : (f) => { for (let k = cur; k < users.length; k++) if (f(users[k].a)) return k; return -1; };
      if (g.anchor) { hit = range((a) => a === g.anchor); if (hit < 0) hit = range((a) => sameAnchor(a, g.anchor)); }
      let target = null;
      if (hit >= 0) { target = replyAfter(msgs, users[hit].i); cur = o.fallback ? hit - 1 : hit + 1; }
      if (!target && o.fallback) target = lastReply(msgs);
      if (target) n += add(c, target, g.items);
    }
    return n;
  }
  return { anchorOf, sameAnchor, add, place, RANK };
});
