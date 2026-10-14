/* Game-dev workshop for the Working tab: the Foreman directs the crew while a little game world grows on the diorama table.
   data: {active, phase: idle|planning|working|reviewing|resting, project, iteration, title, agents: [kinds]}.
   The world is deterministic: the same project and iteration always show the same pieces, new ones pop in as iteration grows, and every PER rounds a new level starts. */
(function () {
  "use strict";
  if (!window.Pixel) return;

  const FLOOR = 86, BODY = "var(--claude)", INK = "#0c0e11";
  const KINDS = new Set(["claude", "queen", "librarian", "researcher", "builder", "critic", "modeler", "reviewer", "believer", "skeptic", "investor",
    "organizer", "refiner", "clarifier", "judge", "desk", "trainer", "foreman", "inventor", "messenger"]);
  const PHASES = ["idle", "planning", "working", "reviewing", "resting"];
  // The autopilot's own status words, mapped onto the scene's phases.
  const ALIAS = { running: "working", training: "working", stopping: "reviewing" };
  const DEFAULT_CREW = ["builder", "modeler", "researcher"];
  // Diorama grid on the table top.
  const COLS = 12, ROWS = 4, CW = 10, CH = 5, GX = 101, GY = 95;
  const STATIONS = [
    { act: "hammer", pref: "builder", x: 150, y: 96 },
    { act: "paint", pref: "modeler", x: 263, y: 118, flip: true },
    { act: "computer", pref: "researcher", x: 40, y: 131, flip: true },
  ];
  const SPARE = [{ x: 104, y: 145 }, { x: 178, y: 145 }, { x: 136, y: 146 }, { x: 206, y: 145 }];
  const REST = [{ x: 100, y: 144 }, { x: 124, y: 141 }, { x: 176, y: 141 }, { x: 200, y: 144 }, { x: 112, y: 148 }, { x: 188, y: 148 }];
  const TILE = { grass: ["#3d8a4f", "#46975a", "#2f6e3f"], water: ["#2f6db0", "#3a7cc2", "#245692"], sand: ["#d6b06a", "#dfbd7c", "#b8934f"],
    path: ["#8c8c84", "#97978e", "#6e6e66"], bridge: ["#2f6db0", "#2f6db0", "#245692"] };
  const OBJS = ["pine", "oak", "house", "pine", "rock", "oak", "tower", "pine", "house", "oak", "pine", "rock", "house", "oak", "pine", "tower"];
  const ROOFS = ["#c0504d", "#3e6fb0", "#7a4fc2", "#d68a3a"];
  // Props the Modeler paints on the turntable, bottom row first: [width, colour].
  const PROPS = [
    [[6, "#8a5a3b"], [7, "#4a5260"], [7, "#8a5a3b"], [7, "#a0704a"], [7, "#8a5a3b"], [7, "#8a5a3b"], [7, "#4a5260"], [6, "#8a5a3b"]],
    [[2, "#6b4a32"], [2, "#6b4a32"], [9, "#2f7d4a"], [9, "#3fa06b"], [7, "#2f7d4a"], [7, "#3fa06b"], [5, "#2f7d4a"], [3, "#3fa06b"], [1, "#2f7d4a"]],
    [[3, "#f3efe6"], [3, "#f3efe6"], [3, "#e8dcc6"], [9, "#d64545"], [9, "#e05555"], [7, "#d64545"], [5, "#d64545"]],
    [[8, "#b08c55"], [8, "#c9a46a"], [8, "#c9a46a"], [8, "#b08c55"], [8, "#c9a46a"], [8, "#c9a46a"], [8, "#b08c55"]],
  ];
  // The level sketch the Foreman draws while planning: [x0, y0, x1, y1, colour].
  const SKETCH = [[244, 76, 300, 76, 0], [250, 76, 258, 68, 0], [258, 68, 266, 76, 0], [272, 76, 272, 68, 1], [272, 68, 282, 68, 1], [282, 68, 282, 76, 1],
    [270, 68, 277, 63, 2], [277, 63, 284, 68, 2], [290, 76, 290, 71, 3], [286, 71, 290, 64, 0], [290, 64, 294, 71, 0], [294, 71, 286, 71, 0],
    [256, 59, 268, 59, 3], [266, 57, 268, 59, 3], [266, 61, 268, 59, 3], [247, 52, 251, 56, 4], [251, 52, 247, 56, 4]];
  const SKETCHC = ["#3fa06b", "#3e6fb0", "#d64545", "#2b2f37", "#e98a2a"];
  const CHECK = [[6, 0], [5, 1], [0, 2], [4, 2], [1, 3], [3, 3], [2, 4]];

  const hash = (i) => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  const EASE = { out: (t) => 1 - Math.pow(1 - t, 3), inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2) };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const own = (o, k) => typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k);
  const num = (v, d) => { const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN; return Number.isFinite(n) ? n : d; };
  // The pixel font only has A-Z, digits and some punctuation.
  const clean = (s) => String(s == null ? "" : s).toUpperCase().replace(/[^A-Z0-9 !?.,:+\-\/'"%#()*=<>_]/g, " ").replace(/\s+/g, " ").trim();
  const fit = (g, s, w) => { if (g.textWidth(s) <= w) return s; return s.slice(0, Math.max(0, Math.floor((w + 1) / 4) - 2)).trim() + ".."; };
  const baseName = (p) => { const parts = String(p == null ? "" : p).split(/[\\/]+/).filter(Boolean); return parts.length ? parts[parts.length - 1] : ""; };
  const seedOf = (s) => { let h = 7; for (const ch of String(s)) h = (h * 31 + ch.codePointAt(0)) % 9973; return h; };
  const pieces = (n) => (n <= 0 ? 0 : 4 + 3 * n);
  // The round count never resets, so the world is built in levels: pieces(PER) covers the biggest world,
  // each level ends with its flag planted, and the next round starts a fresh world.
  const PER = 21;
  const levelOf = (n) => (n <= 0 ? 0 : Math.floor((n - 1) / PER));
  const localOf = (n) => (n <= 0 ? 0 : ((n - 1) % PER) + 1);

  function read(d) {
    d = d && typeof d === "object" ? d : {};
    const active = !!d.active;
    let ph = String(d.phase || "").toLowerCase();
    if (own(ALIAS, ph)) ph = ALIAS[ph];
    const phase = !active ? "idle" : PHASES.includes(ph) ? ph : "working";
    let agents = (Array.isArray(d.agents) ? d.agents : [])
      .map((a) => (typeof a === "string" ? a : a && typeof a === "object" ? a.kind || a.k || "" : ""))
      .map((k) => String(k).toLowerCase().trim())
      .filter((k) => k && k !== "foreman")
      .map((k) => (KINDS.has(k) ? k : "claude"))
      .slice(0, 6);
    if (!agents.length) agents = DEFAULT_CREW.slice();
    const iter = clamp(Math.floor(num(d.iteration, 0)), 0, 99999);
    const project = typeof d.project === "string" || typeof d.project === "number" ? String(d.project) : d.project && typeof d.project === "object" ? String(d.project.name || d.project.title || d.project.path || "") : "";
    return { active, phase, agents, iter, level: levelOf(iter), local: localOf(iter), project, name: clean(baseName(project)), title: clean(d.title) };
  }

  /* ---------- drawing helpers ---------- */
  // Sprites are drawn so the body stays at x+3..x+14 whichever way they face; the hand-held item is at x+15.. (or x-2.. flipped).
  const spr = (g, kind, x, y, flip) => g.sprite(kind, flip ? x - 3 : x, y, { flip });
  function backView(g, kind, x, y, flip) { spr(g, kind, x, y, !flip); g.rect(x + 3, y + 7, 12, 6, BODY); }
  const shadow = (g, x, fy, w) => g.alpha(0.28, () => g.rect(x, fy - 1, w, 2, "#000"));
  const box = (g, x, y, w, h, c) => { g.rect(x, y, w, 1, c); g.rect(x, y + h - 1, w, 1, c); g.rect(x, y, 1, h, c); g.rect(x + w - 1, y, 1, h, c); };
  function tick(g, x, y, c) { for (const [a, b] of CHECK) g.rect(x + a + 1, y + b + 1, 2, 1, INK); for (const [a, b] of CHECK) g.rect(x + a, y + b, 2, 1, c); }
  function star(g, x, y, r, c) { g.px(x, y, "#ffffff"); for (let i = 1; i <= r; i++) { g.px(x - i, y, c); g.px(x + i, y, c); g.px(x, y - i, c); g.px(x, y + i, c); } }
  function pop(g, s, x, y, u, c) { g.alpha(1 - u, () => g.text(s, x, y - Math.round(u * 8), c, { shadow: INK })); }
  function bulb(g, x, y) {
    g.rect(x + 2, y, 3, 1, "#fde68a"); g.rect(x + 1, y + 1, 5, 4, "#fde68a"); g.rect(x + 2, y + 5, 3, 1, "#fde68a"); g.px(x + 2, y + 1, "#fffbe8");
    g.rect(x + 2, y + 6, 3, 1, "#9aa3ad"); g.rect(x + 2, y + 7, 3, 1, "#6b7480");
  }
  function mug(g, x, y, t, k) {
    g.rect(x, y, 3, 3, "#f1f1f1"); g.px(x, y, "#6b4a32"); g.px(x + 1, y, "#6b4a32"); g.px(x + 3, y + 1, "#f1f1f1");
    for (let j = 0; j < 2; j++) {
      const u = (t * 0.8 + j / 2 + k * 0.3) % 1;
      g.alpha(0.8 * (1 - u), () => g.px(x + 1 + Math.round(Math.sin(u * 6 + j * 2 + k)), y - 1 - Math.round(u * 7), "#c9ced6"));
    }
  }
  function fillPoly(g, pts, c) {
    let y0 = Infinity, y1 = -Infinity;
    for (const p of pts) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    if (!Number.isFinite(y0) || !Number.isFinite(y1)) return;
    for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
      const yc = y + 0.5, xs = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) xs.push(a[0] + ((yc - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) { const xa = Math.round(xs[k]), xb = Math.round(xs[k + 1]); if (xb > xa) g.rect(xa, y, xb - xa, 1, c); }
    }
  }

  Pixel.register("working", (env) => {
    const noise = typeof env.noise === "function" ? env.noise : hash;
    const E = Object.assign({}, EASE, env.ease || {});
    const st = { pos: new Map(), base: null, seed: null, world: null, iter: 0, pops: new Map(), tap: -1 };
    const fx = (x, y, o) => { if (!env.reduced && typeof env.burst === "function") env.burst(x, y, o); };

    // The whole build order for a project: every tile, the props on the grass, and the flag last.
    function buildWorld(seed) {
      const N = (i) => noise(seed * 0.731 + i * 1.37);
      const cells = [];
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) cells.push({ c, r, x: GX + c * CW, y: GY + r * CH });
      const lc = 1 + Math.floor(N(1) * 10), lr = 0.5 + Math.floor(N(2) * 3), path = 1 + Math.floor(N(3) * 2);
      for (const k of cells) {
        const d = Math.hypot((k.c - lc) * 0.7, k.r - lr);
        k.type = d < 1.2 ? (k.r === path ? "bridge" : "water") : k.r === path ? "path" : d < 1.9 ? "sand" : "grass";
        k.v = N(100 + k.c * 7 + k.r * 3) < 0.5 ? 0 : 1;
        k.o = Math.hypot(k.c - 5.5, (k.r - 1.5) * 2) + N(200 + k.c * 5 + k.r) * 3;
      }
      const spots = cells.filter((k) => k.type === "grass").sort((a, b) => N(300 + a.c * 4 + a.r) - N(300 + b.c * 4 + b.r));
      const flag = spots.shift();
      const objs = spots.slice(0, OBJS.length).map((cell, i) => ({ obj: OBJS[i], cell, hue: Math.floor(N(400 + i) * ROOFS.length) }));
      const seq = [], placed = new Set();
      cells.slice().sort((a, b) => a.o - b.o).forEach((cell, i) => {
        cell.at = seq.length; seq.push({ cell }); placed.add(cell);
        if (i % 3 === 2) { const o = objs.find((q) => !q.used && placed.has(q.cell)); if (o) { o.used = true; seq.push(o); } }
      });
      for (const o of objs) if (!o.used) { o.used = true; seq.push(o); }
      if (flag) seq.push({ obj: "flag", cell: flag });
      return { seq, path, cells };
    }

    function walk(key, tx, ty, speed) {
      let p = st.pos.get(key);
      if (!p || env.reduced) { p = { x: tx, y: ty, moving: false, dir: 1 }; st.pos.set(key, p); }
      else {
        const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy), step = (speed || 60) * (env.dt || 0);
        if (d <= Math.max(0.5, step) || d > 260) { p.x = tx; p.y = ty; p.moving = false; }
        else { p.x += (dx / d) * step; p.y += (dy / d) * step; p.moving = true; if (Math.abs(dx) > 0.5) p.dir = dx < 0 ? -1 : 1; }
      }
      p.seen = env.frame;
      return p;
    }

    // Each helper takes the station made for its kind, then the free ones in order; the rest watch from the front.
    function assign(list) {
      const out = new Array(list.length), used = new Set();
      list.forEach((k, i) => { const j = STATIONS.findIndex((s, n) => !used.has(n) && s.pref === k); if (j >= 0) { used.add(j); out[i] = j; } });
      list.forEach((k, i) => { if (out[i] != null) return; const j = STATIONS.findIndex((s, n) => !used.has(n)); if (j >= 0) { used.add(j); out[i] = j; } });
      let spare = 0;
      return list.map((kind, i) => (out[i] != null ? Object.assign({ kind, station: out[i] }, STATIONS[out[i]]) : Object.assign({ kind, act: "watch" }, SPARE[spare++ % SPARE.length])));
    }

    function layout(D, hx) {
      let F = { act: "point", x: 66, y: 116, flip: true }, crew = [], critic = null;
      if (D.phase === "idle") F = { act: "sit", x: 66, y: 118 };
      else if (D.phase === "resting") {
        F = { act: "mug", x: 150, y: 140 };
        crew = D.agents.map((kind, i) => Object.assign({ kind, act: "mug", flip: REST[i % REST.length].x > 150 }, REST[i % REST.length]));
      } else {
        let list = D.agents;
        if (D.phase === "reviewing") { critic = { kind: "critic", key: "reviewer" }; list = list.filter((k) => k !== "critic"); F = { act: "clip", x: 44, y: 104 }; }
        if (D.phase === "planning") F = { act: "board", x: 262, y: 90 };
        let spare = 0;
        crew = assign(list).map((c) => {
          if (c.act === "hammer") {
            if (D.phase === "reviewing") return Object.assign(c, { act: "watch" }, SPARE[spare++ % SPARE.length]);
            c.x = hx;
            if (D.phase === "planning") c.act = "stand";
          } else if (c.act === "paint" && D.phase !== "working") c.act = "stand";
          return c;
        });
      }
      crew.forEach((c, i) => (c.key = i + ":" + c.kind));
      return { F, crew, critic };
    }

    /* ---------- the room ---------- */
    function room(g, t) {
      g.rect(0, 0, 320, FLOOR, "#25211f");
      for (let x = 6; x < 320; x += 14) g.rect(x, 3, 1, 67, "#2c2724");
      g.rect(0, 0, 320, 3, "#181513");
      g.rect(0, 70, 320, 12, "#2e2925"); g.rect(0, 70, 320, 1, "#3d3631");
      g.rect(0, 82, 320, 4, "#1b1816");
      g.rect(0, FLOOR, 320, 64, "#3a3d44");
      for (let y = FLOOR + 8, r = 0; y < 150; y += 10, r++) {
        g.rect(0, y, 320, 1, "#32353b");
        for (let x = (r % 2) * 16 + 8; x < 320; x += 32) g.rect(x, y - 9 < FLOOR ? FLOOR : y - 9, 1, y - 9 < FLOOR ? y - FLOOR : 9, "#32353b");
      }
      g.alpha(0.5, () => { g.circ(88, 141, 1, "#d64545"); g.px(91, 143, "#d64545"); g.circ(232, 98, 1, "#3e6fb0"); g.px(30, 96, "#e9b949"); g.px(229, 100, "#3e6fb0"); });
      g.alpha(0.3, () => g.rect(0, FLOOR, 320, 3, "#000"));

      // blueprints
      const paper = (x, y, w, h, c) => {
        g.rect(x, y, w, h, c);
        for (let i = x + 3; i < x + w; i += 4) g.rect(i, y, 1, h, "#3a6aa8");
        for (let j = y + 3; j < y + h; j += 4) g.rect(x, j, w, 1, "#3a6aa8");
        g.circ(x + 2, y + 2, 1, "#d64545"); g.circ(x + w - 3, y + 2, 1, "#d64545");
      };
      paper(6, 22, 36, 28, "#2c5a96");
      const L = "#d6e6f7";
      box(g, 14, 34, 16, 12, L); g.line(12, 34, 22, 27, L); g.line(22, 27, 32, 34, L); g.rect(20, 40, 3, 6, L);
      g.rect(12, 48, 20, 1, L); g.px(12, 47, L); g.px(31, 47, L);
      paper(46, 26, 34, 28, "#2a5590");
      g.circ(57, 39, 6, L); g.circ(57, 39, 5, "#2a5590"); g.circ(57, 39, 1, L);
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; g.px(57 + Math.round(Math.cos(a) * 7), 39 + Math.round(Math.sin(a) * 7), L); }
      box(g, 66, 32, 11, 11, L); g.rect(71, 32, 1, 11, L); g.rect(66, 37, 11, 1, L);
      g.rect(68, 46, 1, 4, L); g.rect(66, 44, 5, 2, L);

      // pegboard with tools
      g.rect(96, 22, 54, 34, "#9c7b55");
      for (let y = 24; y < 56; y += 4) for (let x = 98; x < 150; x += 4) g.px(x, y, "#7c5e3e");
      g.rect(104, 30, 2, 18, "#8a5a3b"); g.rect(100, 27, 10, 4, "#8b95a1"); g.rect(100, 27, 10, 1, "#c9ced6");
      g.rect(113, 32, 16, 7, "#c9ced6"); for (let x = 113; x < 129; x += 2) g.px(x, 39, "#8b95a1"); g.rect(111, 31, 4, 9, "#c0504d");
      g.line(134, 30, 140, 50, "#8b95a1"); g.line(135, 30, 141, 50, "#8b95a1"); g.rect(132, 27, 5, 4, "#8b95a1"); g.px(134, 27, "#9c7b55");
      g.rect(144, 28, 3, 9, "#e9b949"); g.rect(145, 37, 1, 11, "#c9ced6");

      // shelf with paint cans, a trophy and a plant
      g.rect(164, 60, 62, 2, "#6b4a32"); g.rect(168, 62, 2, 3, "#4e3424"); g.rect(220, 62, 2, 3, "#4e3424");
      ["#d64545", "#3e6fb0", "#3fa06b"].forEach((c, i) => { g.rect(168 + i * 8, 53, 6, 7, c); g.rect(168 + i * 8, 53, 6, 1, "#c9ced6"); g.rect(169 + i * 8, 56, 4, 2, "#f3efe6"); });
      g.rect(198, 50, 7, 4, "#e9b949"); g.rect(200, 54, 3, 2, "#c9a03a"); g.rect(198, 56, 7, 4, "#8a5a3b"); g.px(197, 51, "#e9b949"); g.px(205, 51, "#e9b949");
      g.rect(211, 55, 7, 5, "#b0603a"); g.rect(212, 51, 1, 4, "#3fa06b"); g.rect(214, 49, 1, 6, "#46975a"); g.rect(216, 52, 1, 3, "#3fa06b");

      // clock
      g.circ(196, 30, 5, "#9aa3ad"); g.circ(196, 30, 4, "#f1f1f1");
      g.line(196, 30, 196 + Math.round(Math.cos(t * 0.6) * 3), 30 + Math.round(Math.sin(t * 0.6) * 3), "#26282c");
      g.line(196, 30, 196 + Math.round(Math.cos(t * 0.05) * 2), 30 + Math.round(Math.sin(t * 0.05) * 2), "#d64545");

      // game poster
      g.rect(252, 10, 40, 28, "#2d2a40"); box(g, 252, 10, 40, 28, "#4a4566");
      g.rect(262, 16, 20, 8, "#8b95a1"); g.rect(264, 18, 2, 4, "#26282c"); g.rect(263, 19, 4, 2, "#26282c"); g.px(277, 18, "#d64545"); g.px(279, 20, "#3fa06b");
      g.text("PLAY", 272, 28, "#e9b949", { align: "center" });

      // lamp over the table
      g.line(161, 0, 161, 12, "#3b3f46");
      fillPoly(g, [[156, 12], [166, 12], [170, 17], [152, 17]], "#3e6fb0");
      g.rect(158, 17, 6, 1, "#fde68a");
      g.alpha(0.07, () => fillPoly(g, [[153, 18], [169, 18], [228, 92], [94, 92]], "#fde68a"));
    }

    function whiteboard(g, D, t) {
      g.rect(240, 44, 64, 37, "#8b95a1"); g.rect(241, 45, 62, 35, "#e8ebef"); g.rect(241, 45, 62, 1, "#f8f9fb");
      g.rect(250, 81, 44, 2, "#6b7480"); g.rect(256, 80, 4, 1, "#d64545"); g.rect(262, 80, 4, 1, "#3e6fb0");
      if (D.phase === "idle") {
        g.text("READY", 272, 55, "#2b2f37", { scale: 2, align: "center" });
        g.rect(254, 67, 36, 1, "#3fa06b");
        return [272, 70];
      }
      if (D.phase === "resting") {
        g.text("BREAK", 272, 52, "#d64545", { scale: 2, align: "center" });
        g.rect(266, 66, 7, 6, "#8a5a3b"); g.rect(273, 67, 2, 3, "#8a5a3b"); g.px(268, 64, "#9aa3ad"); g.px(270, 63, "#9aa3ad");
        return [272, 70];
      }
      if (D.phase === "planning") {
        g.text("PLAN", 243, 47, "#6b7480");
        const shown = (t % 9) * 2.4;
        let tip = [SKETCH[0][0], SKETCH[0][1]];
        for (let i = 0; i < SKETCH.length && i < shown; i++) {
          const [x0, y0, x1, y1, c] = SKETCH[i], k = Math.min(1, shown - i), ex = x0 + (x1 - x0) * k, ey = y0 + (y1 - y0) * k;
          g.line(x0, y0, ex, ey, SKETCHC[c]);
          tip = [Math.round(ex), Math.round(ey)];
        }
        return tip;
      }
      // a little task board: to do, doing, done
      g.text("TODO", 243, 47, "#6b7480"); g.text("DOING", 263, 47, "#6b7480"); g.text("DONE", 286, 47, "#6b7480");
      g.rect(261, 46, 1, 33, "#c9ced6"); g.rect(283, 46, 1, 33, "#c9ced6");
      ["#f2d36b", "#f2a3a0", "#9fc1e8"].forEach((c, i) => g.rect(245 + (i % 2) * 7, 55 + i * 6, 6, 4, c));
      const w = D.phase === "working" ? Math.round(Math.sin(t * 3)) : 0;
      g.rect(268 + w, 56, 6, 4, "#a6e39a"); g.rect(269 + w, 57, 3, 1, "#3fa06b");
      const done = Math.min(8, Math.ceil((D.local * 8) / PER));
      for (let i = 0; i < done; i++) { const x = 286 + (i % 2) * 8, y = 55 + Math.floor(i / 2) * 6; g.rect(x, y, 6, 4, "#f2d36b"); g.px(x + 2, y + 2, "#3fa06b"); g.px(x + 3, y + 1, "#3fa06b"); }
      return [272, 70];
    }

    function screen(g, x, y, w, h, kind, D, t) {
      if (!D.active) { g.rect(x, y, w, h, "#0a0d10"); if (Math.floor(t) % 2) g.px(x + 2, y + h - 3, "#3fa06b"); return; }
      if (kind === "web") {
        g.rect(x, y, w, h, "#e8ebef"); g.rect(x, y, w, 2, "#3b3f46"); g.px(x + 1, y, "#d64545"); g.px(x + 3, y, "#e9b949");
        g.rect(x + 2, y + 3, 14, 2, "#ffffff"); box(g, x + 2, y + 3, 14, 2, "#c9ced6"); g.rect(x + 17, y + 3, 3, 2, "#3e6fb0");
        const p = Math.floor(t * (D.phase === "working" ? 3 : 1));
        for (let j = 0; j < 5; j++) {
          const yy = y + 6 + j * 2 - (p % 2), li = Math.floor(p / 2) + j;
          if (yy < y + 6 || yy >= y + h) continue;
          g.rect(x + 2, yy, li % 3 === 0 ? 7 + Math.floor(noise(li) * 8) : 11 + Math.floor(noise(li + 0.5) * 8), 1, li % 3 === 0 ? "#3e6fb0" : "#9aa3ad");
        }
        return;
      }
      // the game being built, running
      g.rect(x, y, w, h, "#1b2a44"); g.rect(x, y + h - 3, w, 3, "#3d8a4f"); g.rect(x, y + h - 3, w, 1, "#5bb36e");
      g.px(x + 4, y + 3, "#f1f1f1"); g.px(x + 15, y + 2, "#f1f1f1");
      const bx = x + 11;
      g.rect(bx, y + h - 6, 3, 3, "#c0504d");
      if (Math.floor(t * 2) % 2) g.px(x + w - 4, y + 5, "#e9b949");
      const px = x + 1 + (Math.floor(t * 8) % (w - 3)), near = px - (bx - 5);
      const jump = near >= 0 && near <= 9 ? Math.round(Math.sin((near / 9) * Math.PI) * 5) : 0;
      g.rect(px, y + h - 6 - jump, 2, 3, BODY); g.px(px + 1, y + h - 6 - jump, "#1d1a18");
    }

    function deskL(g, D, t) {
      g.rect(4, 128, 80, 3, "#7a5638"); g.rect(4, 128, 80, 1, "#94704a"); g.rect(4, 131, 80, 4, "#5e412c");
      g.rect(6, 135, 3, 12, "#4e3424"); g.rect(79, 135, 3, 12, "#4e3424");
      g.alpha(0.3, () => g.rect(4, 147, 80, 2, "#000"));
      g.rect(21, 126, 4, 2, "#3b3f46"); g.rect(10, 108, 26, 18, "#15181d"); g.rect(11, 109, 24, 1, "#2b2f37");
      screen(g, 12, 110, 22, 14, "web", D, t);
      g.rect(40, 128, 16, 1, "#9aa3ad");
      if (D.phase === "working" || D.phase === "planning") g.px(41 + Math.floor(noise(Math.floor(t * 8)) * 14), 128, "#f1f1f1");
      g.rect(62, 125, 8, 3, "#f3efe6"); g.rect(63, 124, 6, 1, "#e8dcc6");
    }

    function deskR(g, D, t) {
      g.rect(238, 128, 78, 3, "#7a5638"); g.rect(238, 128, 78, 1, "#94704a"); g.rect(238, 131, 78, 4, "#5e412c");
      g.rect(240, 135, 3, 12, "#4e3424"); g.rect(311, 135, 3, 12, "#4e3424");
      g.alpha(0.3, () => g.rect(238, 147, 78, 2, "#000"));
      g.rect(297, 126, 4, 2, "#3b3f46"); g.rect(286, 108, 26, 18, "#15181d"); g.rect(287, 109, 24, 1, "#2b2f37");
      screen(g, 288, 110, 22, 14, "game", D, t);
      g.rect(266, 128, 14, 1, "#9aa3ad");
      if (D.phase !== "resting") mug(g, 252, 125, t, 3);
    }

    function pedestal(g, D, t) {
      g.rect(250, 117, 12, 2, "#5b6470"); g.rect(252, 106, 8, 11, "#7d8794"); g.rect(252, 106, 1, 11, "#9aa3ad");
      g.rect(248, 104, 16, 2, "#c9ced6"); g.px(248 + (Math.floor(t * 6) % 16), 105, "#e9b949");
      g.alpha(0.3, () => g.rect(249, 119, 14, 2, "#000"));
      const live = D.phase === "working", u = live ? t % 7 : 7, rows = PROPS[live ? Math.floor(t / 7) % PROPS.length : 0];
      const painted = Math.floor(clamp(u / 5, 0, 1) * rows.length);
      rows.forEach(([w, c], i) => g.rect(256 - Math.floor(w / 2), 103 - i, w, 1, i < painted ? c : i % 2 ? "#9aa3ad" : "#8b95a1"));
      if (live && painted < rows.length) {
        const w = rows[painted][0], tip = [256 + Math.ceil(w / 2) + 1, 103 - painted];
        st.brush = { tip, c: rows[painted][1] };
        if (Math.floor(t * 8) % 2) g.px(tip[0] - 1 + Math.round(noise(Math.floor(t * 8)) * 2), tip[1] - 1, rows[painted][1]);
      } else {
        st.brush = { tip: [262, 99], c: "#c9ced6" };
        if (live) star(g, 256, 103 - rows.length - 2, 1 + (Math.floor(t * 4) % 2), "#e9b949");
      }
    }

    function tile(g, cell, dy, t) {
      const pal = TILE[cell.type] || TILE.grass, x = cell.x, y = cell.y + dy;
      g.rect(x, y, CW, CH, pal[cell.v]); g.rect(x, y + CH - 1, CW, 1, pal[2]);
      if (cell.type === "water" || cell.type === "bridge") g.px(x + 1 + ((Math.floor(t * 2) + cell.c * 3) % 8), y + 1 + ((cell.c + cell.r) % 2), "#7fb7e6");
      if (cell.type === "bridge") { g.rect(x, y + 1, CW, 3, "#8a5a3b"); for (let i = 1; i < CW; i += 3) g.px(x + i, y + 1, "#6b4a32"); }
      else if (cell.type === "grass") g.px(x + 2 + ((cell.c * 5) % 6), y + 1 + (cell.r % 2), "#5bb36e");
      else if (cell.type === "path") { g.px(x + 2, y + 2, "#b5b5ac"); g.px(x + 6, y + 1, "#b5b5ac"); }
      else if (cell.type === "sand") g.px(x + 3 + (cell.c % 4), y + 2, "#e8c886");
    }

    function object(g, p, dy, t) {
      const ax = p.cell.x + 5, ay = p.cell.y + 4 + dy;
      switch (p.obj) {
        case "pine":
          g.rect(ax, ay - 2, 1, 2, "#6b4a32"); g.rect(ax - 2, ay - 4, 5, 2, "#2f7d4a"); g.rect(ax - 1, ay - 6, 3, 2, "#2f7d4a"); g.px(ax, ay - 7, "#2f7d4a"); g.px(ax - 1, ay - 5, "#3fa06b");
          break;
        case "oak": g.rect(ax, ay - 2, 1, 2, "#6b4a32"); g.circ(ax, ay - 5, 2, "#3fa06b"); g.px(ax - 1, ay - 6, "#6fcf87"); break;
        case "house": {
          const roof = ROOFS[p.hue || 0];
          g.rect(ax - 3, ay - 4, 7, 4, "#e8d8b8"); g.rect(ax - 4, ay - 5, 9, 1, roof); g.rect(ax - 3, ay - 6, 7, 1, roof); g.rect(ax - 2, ay - 7, 5, 1, roof);
          g.rect(ax, ay - 2, 1, 2, "#6b4a32"); g.px(ax - 2, ay - 3, "#fde68a"); g.px(ax + 2, ay - 3, "#fde68a");
          break;
        }
        case "tower":
          g.rect(ax - 2, ay - 9, 5, 9, "#9aa3ad"); g.rect(ax - 2, ay - 9, 1, 9, "#c9ced6");
          g.px(ax - 2, ay - 10, "#9aa3ad"); g.px(ax, ay - 10, "#9aa3ad"); g.px(ax + 2, ay - 10, "#9aa3ad"); g.px(ax, ay - 6, "#26282c");
          break;
        case "rock": g.rect(ax - 2, ay - 2, 4, 2, "#8b95a1"); g.px(ax - 1, ay - 2, "#c9ced6"); g.rect(ax + 1, ay - 1, 2, 1, "#6b7480"); break;
        case "flag": {
          g.rect(ax, ay - 12, 1, 12, "#c9ced6"); g.px(ax, ay - 13, "#e9b949");
          for (let r = 0; r < 3; r++) g.rect(ax + 1, ay - 12 + r, 5 + Math.round(Math.sin(t * 6 + r)), 1, BODY);
          break;
        }
      }
    }

    function diorama(g, D, t, shown) {
      g.rect(96, 92, 131, 24, "#5e4330"); g.rect(96, 92, 131, 1, "#7a583e");
      g.rect(96, 116, 131, 6, "#4a3424"); g.rect(96, 116, 131, 1, "#3a281b");
      g.rect(100, 122, 4, 16, "#4a3424"); g.rect(219, 122, 4, 16, "#4a3424");
      g.alpha(0.3, () => g.rect(96, 137, 131, 2, "#000"));
      // the build board: an empty grid waiting for tiles
      g.rect(99, 93, 125, 22, "#8a6c4e"); g.rect(99, 115, 125, 1, "#3a281b");
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) g.rect(GX + c * CW, GY + r * CH, CW - 1, CH - 1, "#a08060");
      const W = st.world, objs = [];
      for (let i = 0; i < shown; i++) {
        const p = W.seq[i], pp = st.pops.get(i), age = pp ? t - pp.at : 9;
        if (age < 0) continue;
        const dy = age < 0.45 ? -Math.round((1 - E.out(age / 0.45)) * 8) : 0;
        if (p.obj) objs.push([p, dy]); else tile(g, p.cell, dy, t);
      }
      objs.sort((a, b) => a[0].cell.r - b[0].cell.r || a[0].cell.c - b[0].cell.c).forEach(([p, dy]) => object(g, p, dy, t));
      // once the world is big enough, a tiny player wanders along the road
      if (shown >= 24) {
        const span = COLS * CW - 3, k = (t * 9) % (span * 2), x = GX + Math.round(k < span ? k : span * 2 - k), c = Math.floor((x - GX) / CW);
        const cell = W.cells[W.path * COLS + clamp(c, 0, COLS - 1)];
        if (cell && cell.at < shown) { const y = GY + W.path * CH + 1; g.rect(x, y - 2, 2, 3, BODY); g.px(k < span ? x + 1 : x, y - 2, "#1d1a18"); }
      }
      if (D.active && D.title) {
        const s = fit(g, D.title, 118), w = g.textWidth(s) + 6;
        g.rect(161 - Math.ceil(w / 2), 116, w, 6, "#3b2a1c"); g.text(s, 161, 117, "#e8d8b8", { align: "center" });
      }
      if (D.phase === "idle") {
        g.rect(106, 111, 20, 2, "#e9b949"); for (let i = 108; i < 126; i += 3) g.px(i, 111, "#8a6a20");
        g.line(140, 113, 149, 109, "#8a5a3b"); g.rect(148, 107, 3, 4, "#8b95a1");
        g.line(170, 113, 179, 110, "#c9a46a"); g.rect(179, 109, 2, 2, "#d64545");
        g.rect(196, 110, 7, 3, "#c9a46a"); g.rect(197, 111, 5, 1, "#3e6fb0");
      }
    }

    /* ---------- people ---------- */
    function hammer(g, x, y, t) {
      const u = (t % 0.7) / 0.7;
      const a = u < 0.6 ? 0.75 - 1.95 * E.inOut(u / 0.6) : u < 0.75 ? -1.2 + 1.95 * ((u - 0.6) / 0.15) : 0.75;
      const hx = x + 16, hy = y + 9, ex = Math.round(hx + Math.cos(a) * 7), ey = Math.round(hy + Math.sin(a) * 7);
      if (a < 0) g.rect(x + 15, y + 7, 2, 2, BODY);
      g.line(hx, hy, ex, ey, "#8a5a3b");
      g.rect(ex - 1, ey - 1, 3, 3, "#8b95a1"); g.px(ex - 1, ey - 1, "#c9ced6");
      return { ex, ey, u };
    }

    function drawForeman(g, F, p, t, D, tip, next) {
      const x = Math.round(p.x), fy = Math.round(p.y), y = fy - 16, f = !!F.flip;
      if (p.moving) { shadow(g, x + 3, fy, 12); spr(g, "foreman", x, y - (Math.floor(t * 8) % 2), p.dir < 0); return; }
      if (F.act === "board") {
        backView(g, "foreman", x, y, false);
        g.line(x + 16, y + 9, tip[0], tip[1], "#2b2f37"); g.px(tip[0], tip[1], "#3e6fb0");
        return;
      }
      if (F.act === "sit") {
        const b = Math.floor(t * 0.8) % 2;
        spr(g, "foreman", x, y - 2 - b, false);
        g.rect(x + 3, fy - 4, 12, 2, "#8a5a3b"); g.rect(x + 3, fy - 4, 12, 1, "#a0704a"); g.rect(x + 4, fy - 2, 1, 3, "#6b4a32"); g.rect(x + 13, fy - 2, 1, 3, "#6b4a32");
        g.alpha(0.28, () => g.rect(x + 3, fy, 12, 2, "#000"));
        return;
      }
      shadow(g, x + 3, fy, 12);
      if (F.act === "mug") { spr(g, "foreman", x, y, f); mug(g, x - 2, y + 8, t, 0); return; }
      if (F.act === "clip") {
        spr(g, "foreman", x, y - (Math.floor(t * 1.2) % 2), false);
        if (Math.floor(t * 1.5) % 2) { g.px(x + 17, y + 10, "#3fa06b"); g.px(x + 16, y + 9, "#3fa06b"); }
        return;
      }
      // directing: point at the table and now and then call out what goes in next
      const b = Math.floor(t * 1.5) % 2;
      spr(g, "foreman", x, y - b, f);
      const yy = y - b;
      if (Math.floor(t * 2) % 2) { g.rect(f ? x + 17 : x - 1, yy + 8, 3, 1, BODY); g.px(f ? x + 20 : x - 2, yy + 7, BODY); }
      if (next && t % 4 < 1.6) {
        const bx = f ? x + 12 : x - 8;
        g.bubble(bx, yy - 17, 13, 15, { tx: f ? x + 13 : x + 2 });
        icon(g, next, bx + 6, yy - 4);
      }
    }

    function icon(g, p, ax, ay) {
      if (!p.obj) { g.rect(ax - 3, ay - 3, 7, 3, (TILE[p.cell.type] || TILE.grass)[0]); g.rect(ax - 3, ay - 1, 7, 1, (TILE[p.cell.type] || TILE.grass)[2]); return; }
      object(g, { obj: p.obj, cell: { x: ax - 5, y: ay - 4 }, hue: p.hue }, 0, 0);
    }

    function drawCrew(g, c, p, t, i, D) {
      const k = c.kind, x = Math.round(p.x), fy = Math.round(p.y), y = fy - 16, f = !!c.flip;
      const bob = (rate) => Math.floor(t * rate + i * 0.37) % 2;
      if (p.moving) { shadow(g, x + 3, fy, 12); spr(g, k, x, y - (Math.floor(t * 8 + i) % 2), p.dir < 0); return; }
      switch (c.act) {
        case "hammer": spr(g, k, x, y, false); break;
        case "paint": {
          shadow(g, x + 3, fy, 12); spr(g, k, x, y - bob(2), f);
          const b = st.brush;
          if (b) { const hx = f ? x + 1 : x + 16, hy = y + 10 - bob(2); g.line(hx, hy, b.tip[0], b.tip[1], "#8a5a3b"); g.px(b.tip[0], b.tip[1], b.c); }
          break;
        }
        case "computer": spr(g, k, x, y - bob(D.phase === "working" ? 6 : 1), f); break;
        case "stand": if (c.station !== 0) shadow(g, x + 3, fy, 12); spr(g, k, x, y - bob(1.2), f); break;
        case "mug": shadow(g, x + 3, fy, 12); spr(g, k, x, y, f); mug(g, f ? x + 16 : x - 2, y + 8, t, i + 1); break;
        default: {
          const up = (t + i * 0.9) % 3.5 < 0.5, yy = y - (up ? 1 : 0);
          shadow(g, x + 3, fy, 12); spr(g, k, x, yy, f);
          if (up) { g.rect(x + 1, yy + 5, 2, 4, BODY); g.rect(x + 15, yy + 5, 2, 4, BODY); }
        }
      }
    }

    function drawCritic(g, p, t) {
      const x = Math.round(p.x), fy = Math.round(p.y), y = fy - 16 - (Math.floor(t * 6) % 2), fl = p.dir < 0;
      shadow(g, x + 3, fy, 12);
      spr(g, "critic", x, y, fl);
      const mx = fl ? x - 4 : x + 21, my = y + 6;
      g.line(fl ? x + 1 : x + 16, y + 10, fl ? mx + 2 : mx - 2, my + 2, "#8a5a3b");
      g.circ(mx, my, 2, "#c9ced6"); g.rect(mx - 1, my - 1, 2, 2, "#9fd3f0");
    }

    function draw(g) {
      let D;
      try { D = read(env.data); } catch (e) { D = read({}); }
      const t = Number.isFinite(env.t) ? env.t : 0;

      // Rebuild the world for a new project or level; pop in the pieces a higher iteration adds.
      // The first real data isn't "new" pieces, so it doesn't pop.
      const base = seedOf(D.name || "teamwright"), seed = base * 31 + D.level, known = !!(env.data && typeof env.data === "object" && "iteration" in env.data);
      const count = (n) => Math.min(pieces(n), st.world.seq.length);
      const popIn = (a, b) => { if (b <= a || env.reduced) return; const gap = Math.min(0.15, 2 / (b - a)); for (let i = a; i < b; i++) st.pops.set(i, { at: t + (i - a) * gap, burst: false }); };
      if (st.base !== base || !st.world || (known && !st.known)) { st.base = base; st.seed = seed; st.world = buildWorld(seed); st.iter = D.iter; st.pops.clear(); st.known = known; }
      else if (D.iter !== st.iter) {
        if (st.seed !== seed) {
          // A new level clears the board; going up, its first pieces pop in.
          st.seed = seed; st.world = buildWorld(seed); st.pops.clear();
          if (D.iter > st.iter) popIn(0, count(D.local));
        } else {
          const a = count(localOf(st.iter)), b = count(D.local);
          popIn(a, b);
          if (b < a) for (const i of [...st.pops.keys()]) if (i >= b) st.pops.delete(i);
        }
        st.iter = D.iter;
      }
      const W = st.world, shown = count(D.local);
      let last = -1;
      for (let i = shown - 1; i >= 0; i--) { const pp = st.pops.get(i); if (!pp || t >= pp.at) { last = i; break; } }
      const target = last >= 0 ? W.seq[last].cell : W.cells[COLS + 5];
      const hx = clamp(target.x + 5 - 21, 88, 206);
      const { F, crew, critic } = layout(D, hx);

      room(g, t);
      const tip = whiteboard(g, D, t);

      const Q = [], add = (z, fn) => Q.push([z, Q.length, fn]);
      add(117, () => diorama(g, D, t, shown));
      add(117.5, () => pedestal(g, D, t));
      add(148, () => { deskL(g, D, t); deskR(g, D, t); });
      const fp = walk("foreman", F.x, F.y, 50);
      add(fp.y, () => drawForeman(g, F, fp, t, D, tip, D.phase === "working" ? W.seq[Math.min(shown, W.seq.length - 1)] : null));
      crew.forEach((c, i) => { const p = walk(c.key, c.x, c.y, c.act === "hammer" ? 40 : 60); add(p.y, () => drawCrew(g, c, p, t, i, D)); });
      let cp = null;
      if (critic) {
        const a = t * 0.55;
        cp = walk(critic.key, 151 + Math.cos(a) * 72, 117 + Math.sin(a) * 27, 70);
        add(cp.y, () => drawCritic(g, cp, t));
      }
      Q.sort((a, b) => a[0] - b[0] || a[1] - b[1]).forEach((q) => q[2]());

      // effects over everything
      const builder = crew.find((c) => c.act === "hammer");
      const bp = builder && st.pos.get(builder.key);
      if (bp && !bp.moving && D.phase === "working") {
        const h = hammer(g, Math.round(bp.x), Math.round(bp.y) - 16, t), c = Math.floor(t / 0.7);
        if (h.u >= 0.75 && st.tap !== c) { st.tap = c; fx(h.ex, h.ey + 1, { n: 5, colors: ["#e9b949", "#f1f1f1", "#c9a46a"], speed: 28, life: 0.35, gravity: 80, up: 15 }); }
        if (h.u >= 0.75) pop(g, "TAP", h.ex - 6 + Math.round(noise(c) * 4), h.ey - 9, (h.u - 0.75) / 0.25, "#f1f1f1");
      }
      for (const [i, pp] of st.pops) {
        const age = t - pp.at, p = W.seq[i];
        if (age > 1.2 || !p) { st.pops.delete(i); continue; }
        if (age < 0) continue;
        const ax = p.cell.x + 5, ay = p.cell.y + 2;
        if (!pp.burst) { pp.burst = true; fx(ax, ay, { n: 6, colors: ["#fde68a", "#ffffff", "#e9b949"], speed: 24, life: 0.5, gravity: 10 }); }
        const r = age < 0.3 ? 1 : age < 0.7 ? 2 : 1;
        g.alpha(1 - age / 1.2, () => { star(g, ax - 4, ay - 6, r, "#fde68a"); star(g, ax + 4, ay - 3, 1, "#fde68a"); });
      }
      if (D.phase === "planning") {
        const heads = [{ x: fp.x, y: fp.y }].concat(crew.map((c) => st.pos.get(c.key)).filter(Boolean));
        heads.forEach((h, j) => {
          const u = ((t + j * 1.1) % 3.3) / 3.3;
          if (u >= 0.35) return;
          const v = u / 0.35;
          g.alpha(1 - v * v, () => bulb(g, Math.round(h.x) + 6, Math.round(h.y) - 27 - Math.round(v * 6)));
          if (v < 0.3) star(g, Math.round(h.x) + 14, Math.round(h.y) - 27, 1, "#fde68a");
        });
      }
      if (D.phase === "reviewing") {
        const c = Math.floor(t / 0.8), u = (t % 0.8) / 0.8;
        const p = shown > 0 ? W.seq[Math.floor(noise(c * 3.7) * shown)] : null;
        const ax = p ? p.cell.x + 2 : 150, ay = p ? p.cell.y - 8 : 96;
        g.alpha(1 - u, () => tick(g, ax, ay - Math.round(u * 6), "#5ad08a"));
      }

      if (D.active) {
        const a = "BUILD " + Math.max(1, D.iter) + (D.level > 0 ? "  LV " + (D.level + 1) : ""), b = fit(g, D.name || "PROJECT", 140), w = Math.max(g.textWidth(a), g.textWidth(b)) + 7;
        g.alpha(0.6, () => g.rect(2, 2, w, 17, "#07080a"));
        g.text(a, 5, 4, "#e9b949", { shadow: "#000" });
        g.text(b, 5, 11, "#c9ced6", { shadow: "#000" });
      }
      for (const [k, p] of st.pos) if (p.seen !== env.frame) st.pos.delete(k);
    }

    return { size: [320, 150], bg: "#25211f", draw };
  });
})();
