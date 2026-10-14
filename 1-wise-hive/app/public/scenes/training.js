/* Training hall for the Training tab: the Trainer coaches the crew through drills that match the round's focus.
   data: {active, phase: idle|planning|training|reviewing|resting, focus: modeling|scripting|research|video|bugfix|general,
          agents: [kinds], iteration, title}. Anything missing or unknown falls back to a sensible default. */
(function () {
  "use strict";
  if (!window.Pixel) return;

  const FLOOR = 92, BODY = "var(--claude)", INK = "#0c0e11";
  const KINDS = new Set(["claude", "queen", "librarian", "researcher", "builder", "critic", "modeler", "reviewer", "believer", "skeptic", "investor",
    "organizer", "refiner", "clarifier", "judge", "desk", "trainer", "foreman", "inventor", "messenger"]);
  const PHASES = ["idle", "planning", "training", "reviewing", "resting"];
  const PHASE_WORD = { planning: "PLANNING", training: "TRAINING", reviewing: "REVIEW", resting: "BREAK" };
  // The autopilot's own status words, mapped onto the scene's phases.
  const ALIAS = { running: "training", working: "training", stopping: "reviewing" };
  const CREW = { modeling: ["modeler", "reviewer"], scripting: ["builder", "critic"], research: ["researcher", "librarian"],
    video: ["researcher", "modeler"], bugfix: ["critic", "builder"], general: ["builder", "researcher", "modeler"] };
  // Where the crew works during a round, by focus. Station n is made for CREW[focus][n]; extra helpers take the rest.
  const STATIONS = {
    modeling: [{ act: "sculpt", x: 8, y: 113 }, { act: "inspect", x: 44, y: 113, flip: true }],
    scripting: [{ act: "type", x: 276, y: 100 }, { act: "overlook", x: 297, y: 104, flip: true }],
    research: [{ act: "type", x: 276, y: 100 }, { act: "book", x: 228, y: 104 }],
    video: [{ act: "watch", x: 136, y: 104 }, { act: "watch", x: 162, y: 104 }, { act: "watch", x: 110, y: 106 }, { act: "watch", x: 188, y: 106 }],
    bugfix: [{ act: "chase", x: 36, y: 144 }, { act: "type", x: 276, y: 100 }],
    general: [{ act: "bag", x: 186, y: 116 }, { act: "jacks", x: 80, y: 120 }, { act: "pushup", x: 108, y: 124 }, { act: "pushup", x: 66, y: 134 }, { act: "jacks", x: 236, y: 124 }],
  };
  const SPARE = [{ x: 98, y: 126 }, { x: 196, y: 128 }, { x: 122, y: 112 }, { x: 236, y: 122 }];
  // Hat colours, for the push-up pose that is drawn without the sprite.
  const ACC = { builder: "#f2c230", critic: "#d64545", modeler: "#2f3e66", reviewer: "#3fa06b", researcher: "#a77b4f", librarian: "#8a5a3b",
    organizer: "#3fa06b", refiner: "#7a4fc2", clarifier: "#2aa79b", queen: "#e9b949", judge: "#f1f1f1", investor: "#26282c", messenger: "#3e6fb0",
    foreman: "#f29a3a", inventor: "#fde68a", believer: "#e2557a", skeptic: "#8b95a1", desk: "#3b3f46" };
  const CODE = ["#7fb7e6", "#e9b949", "#9fd38a", "#c9ced6", "#d68fd6"];
  const BOOKC = ["#3e6fb0", "#d64545", "#3fa06b", "#e9b949", "#7a4fc2", "#c9ced6", "#2aa79b", "#8a5a3b"];
  // The plan the Trainer draws on the whiteboard: [x0, y0, x1, y1, colour].
  const PLAN = [[24, 69, 33, 69, 0], [33, 69, 33, 75, 0], [33, 75, 24, 75, 0], [24, 75, 24, 69, 0], [34, 72, 41, 72, 1], [39, 70, 41, 72, 1], [39, 74, 41, 72, 1],
    [42, 69, 51, 69, 0], [51, 69, 51, 75, 0], [51, 75, 42, 75, 0], [42, 75, 42, 69, 0], [52, 72, 58, 72, 1], [56, 70, 58, 72, 1], [56, 74, 58, 72, 1],
    [63, 68, 67, 72, 2], [67, 72, 63, 76, 2], [63, 76, 59, 72, 2], [59, 72, 63, 68, 2], [24, 79, 50, 79, 3]];
  const PLANC = ["#3e6fb0", "#2b2f37", "#d64545", "#3fa06b"];
  const CHECK = [[6, 0], [5, 1], [0, 2], [4, 2], [1, 3], [3, 3], [2, 4]];
  const CUBE_V = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
  const CUBE_F = [[0, 1, 2, 3, "#c4741f"], [5, 4, 7, 6, "#c4741f"], [4, 5, 1, 0, "#f7c08a"], [3, 2, 6, 7, "#8a4a12"], [4, 0, 3, 7, "#f29a3a"], [1, 5, 6, 2, "#f29a3a"]];

  const hash = (i) => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  const EASE = { out: (t) => 1 - Math.pow(1 - t, 3), inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2) };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const own = (o, k) => typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k);
  const num = (v, d) => { const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN; return Number.isFinite(n) ? n : d; };
  // The pixel font only has A-Z, digits and some punctuation.
  const clean = (s) => String(s == null ? "" : s).toUpperCase().replace(/[^A-Z0-9 !?.,:+\-\/'"%#()*=<>_]/g, " ").replace(/\s+/g, " ").trim();
  const fit = (g, s, w) => { if (g.textWidth(s) <= w) return s; return s.slice(0, Math.max(0, Math.floor((w + 1) / 4) - 2)).trim() + ".."; };

  function read(d) {
    d = d && typeof d === "object" ? d : {};
    const active = !!d.active;
    let ph = String(d.phase || "").toLowerCase();
    if (own(ALIAS, ph)) ph = ALIAS[ph];
    const phase = !active ? "idle" : PHASES.includes(ph) ? ph : "training";
    const fo = String(d.focus || "").toLowerCase();
    const focusGiven = own(CREW, fo), focus = focusGiven ? fo : "general";
    let agents = (Array.isArray(d.agents) ? d.agents : [])
      .map((a) => (typeof a === "string" ? a : a && typeof a === "object" ? a.kind || a.k || "" : ""))
      .map((k) => String(k).toLowerCase().trim())
      .filter((k) => k && k !== "trainer")
      .map((k) => (KINDS.has(k) ? k : "claude"))
      .slice(0, 6);
    if (!agents.length) agents = CREW[focus].slice();
    return { active, phase, focus, focusGiven, agents, round: clamp(Math.floor(num(d.iteration, 1)), 1, 9999), title: clean(d.title) };
  }

  /* ---------- drawing helpers ---------- */
  // Sprites are drawn so the body stays at x+3..x+14 whichever way they face; the hand-held item is at x+15.. (or x-2.. flipped).
  const spr = (g, kind, x, y, flip, alpha) => g.sprite(kind, flip ? x - 3 : x, y, alpha == null ? { flip } : { flip, alpha });
  // Seen from behind: mirrored, with the face painted over.
  function backView(g, kind, x, y, flip) { spr(g, kind, x, y, !flip); g.rect(x + 3, y + 7, 12, 6, BODY); }
  const shadow = (g, x, fy, w) => g.alpha(0.28, () => g.rect(x, fy - 1, w, 2, "#000"));
  const box = (g, x, y, w, h, c) => { g.rect(x, y, w, 1, c); g.rect(x, y + h - 1, w, 1, c); g.rect(x, y, 1, h, c); g.rect(x + w - 1, y, 1, h, c); };
  function tick(g, x, y, c) { for (const [a, b] of CHECK) g.rect(x + a + 1, y + b + 1, 2, 1, INK); for (const [a, b] of CHECK) g.rect(x + a, y + b, 2, 1, c); }
  function star(g, x, y, r, c) { g.px(x, y, "#ffffff"); for (let i = 1; i <= r; i++) { g.px(x - i, y, c); g.px(x + i, y, c); g.px(x, y - i, c); g.px(x, y + i, c); } }
  function pop(g, s, x, y, u, c) { g.alpha(1 - u, () => g.text(s, x, y - Math.round(u * 8), c, { shadow: INK })); }
  function bulb(g, x, y, lit) {
    const c = lit ? "#fde68a" : "#e9b949";
    g.rect(x + 2, y, 3, 1, c); g.rect(x + 1, y + 1, 5, 4, c); g.rect(x + 2, y + 5, 3, 1, c); g.px(x + 2, y + 1, "#fffbe8");
    g.rect(x + 2, y + 6, 3, 1, "#9aa3ad"); g.rect(x + 2, y + 7, 3, 1, "#6b7480");
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
  // The orange Blender cube, turned by `a` around the vertical axis and tipped toward the viewer, resting on y = base.
  function cube(g, cx, base, s, a, tilt) {
    const ca = Math.cos(a), sa = Math.sin(a), ct = Math.cos(tilt), st = Math.sin(tilt);
    const P = CUBE_V.map(([x, y, z]) => { const X = x * ca + z * sa, Z0 = -x * sa + z * ca; return [X * s, (y * ct - Z0 * st) * s, y * st + Z0 * ct]; });
    const dy = base - Math.max(...P.map((p) => p[1]));
    for (const p of P) { p[0] += cx; p[1] += dy; }
    const faces = CUBE_F.map((f) => ({ f, z: P[f[0]][2] + P[f[1]][2] + P[f[2]][2] + P[f[3]][2] })).sort((p, q) => q.z - p.z);
    for (const { f } of faces) {
      const pts = [P[f[0]], P[f[1]], P[f[2]], P[f[3]]];
      fillPoly(g, pts, f[4]);
      for (let i = 0; i < 4; i++) g.line(pts[i][0], pts[i][1], pts[(i + 1) % 4][0], pts[(i + 1) % 4][1], "#6b3410");
    }
  }
  function bugIcon(g, x, y, t, c) {
    const leg = Math.floor(t * 12) % 2;
    g.rect(x + 1, y, 4, 3, c || "#58b368"); g.px(x + 2, y, "#a6e39a"); g.px(x + 3, y + 1, "#2b6b3a");
    g.rect(x + 5, y + 1, 1, 2, "#2b2f37"); g.px(x + 6, y, "#2b2f37");
    g.px(x + 1 + leg, y + 3, "#2b2f37"); g.px(x + 3 + leg, y + 3, "#2b2f37");
  }

  Pixel.register("training", (env) => {
    const noise = typeof env.noise === "function" ? env.noise : hash;
    const E = Object.assign({}, EASE, env.ease || {});
    const st = { pos: new Map(), squash: -1, bag: -1, spark: -1 };
    const fx = (x, y, o) => { if (!env.reduced && typeof env.burst === "function") env.burst(x, y, o); };

    const books = [];
    for (let r = 0; r < 4; r++) {
      for (let x = 227, i = 0; i < 20; i++) {
        const w = noise(r * 31 + i * 7.3) < 0.4 ? 3 : 2;
        if (x + w > 251) break;
        books.push({ r, x, w, h: Math.min(r === 3 ? 8 : 11, 7 + Math.floor(noise(r * 17 + i * 3.1) * 5)), c: BOOKC[Math.floor(noise(r * 13 + i * 5.7) * BOOKC.length)] });
        x += w + (noise(r * 3 + i * 1.7) < 0.15 ? 1 : 0);
      }
    }

    // Eases each actor toward where it should be, so the crew walks between stations when the phase changes.
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

    function assign(list, focus) {
      const slots = STATIONS[focus], out = new Array(list.length), used = new Set();
      list.forEach((k, i) => { const j = slots.findIndex((s, n) => !used.has(n) && CREW[focus][n] === k); if (j >= 0) { used.add(j); out[i] = j; } });
      list.forEach((k, i) => { if (out[i] != null) return; const j = slots.findIndex((s, n) => !used.has(n)); if (j >= 0) { used.add(j); out[i] = j; } });
      // The first station is the round's main act; never leave it empty.
      if (!used.has(0) && list.length) { let best = 0; out.forEach((j, i) => { if (j != null && j > out[best]) best = i; }); out[best] = 0; }
      let spare = 0;
      return list.map((kind, i) => (out[i] != null ? Object.assign({ kind }, slots[out[i]]) : Object.assign({ kind, act: "cheer" }, SPARE[spare++ % SPARE.length])));
    }

    function layout(D) {
      const T = { act: "coach", x: 150, y: 132, flip: false };
      let crew = [];
      const L = D.agents;
      if (D.phase === "idle") T.act = "ball";
      else if (D.phase === "planning") {
        Object.assign(T, { act: "board", x: 36, y: 100 });
        crew = L.map((kind, i) => ({ kind, act: "watchboard", x: 84 + i * 22, y: 116 + (i % 2) * 4 }));
      } else if (D.phase === "reviewing") {
        T.act = "clip";
        const xs = [112, 188, 88, 212, 236, 64];
        crew = L.map((kind, i) => ({ kind, act: "line", x: xs[i % xs.length], y: 120, flip: xs[i % xs.length] > 150 }));
      } else if (D.phase === "resting") {
        Object.assign(T, { act: "cooler", x: 17, y: 100 });
        crew = L.map((kind, i) => (i < 3 ? { kind, act: "bench", x: 234 + i * 21, y: 133 } : { kind, act: "sip", x: [206, 182, 300][i - 3] || 206, y: 126, flip: true }));
      } else {
        crew = assign(L, D.focus);
        T.flip = D.focus === "modeling";
      }
      crew.forEach((c, i) => (c.key = i + ":" + c.kind));
      return { T, crew };
    }

    // Bug-hunt loop (8s): the bug crawls out of a crack, runs, the chaser closes in with the magnifier, hops and squashes it, then walks back.
    function bugState(t) {
      const u = ((t % 8) + 8) % 8, run = clamp((u - 1) / 4, 0, 1);
      const bx = Math.round(70 + run * 136), by = 140 + Math.round(Math.sin(u * 9) * 1.5);
      let cx = 36, hop = 0;
      if (u >= 1 && u < 4.6) cx = bx - 34 + ((u - 1) / 3.6) * 14;
      else if (u >= 4.6 && u < 5) { const k = (u - 4.6) / 0.4; cx = bx - 20 + k * 13; hop = Math.round(Math.sin(Math.PI * k) * 5); }
      else if (u >= 5 && u < 5.7) cx = bx - 7;
      return { u, bx, by, cx, hop, alive: u < 5, rise: Math.min(1, u), poof: u >= 5 && u < 5.7 ? (u - 5) / 0.7 : -1 };
    }

    /* ---------- the room ---------- */
    function room(g, t) {
      g.rect(0, 0, 320, FLOOR, "#1c2029");
      for (let x = 18; x < 320; x += 40) g.rect(x, 3, 1, 63, "#212633");
      g.rect(0, 0, 320, 3, "#14171d");
      g.rect(0, 66, 320, 22, "#232834"); g.rect(0, 66, 320, 1, "#343b49");
      g.rect(0, 69, 320, 2, "#6e3a26");
      g.rect(0, 88, 320, 4, "#2b2f37");
      g.rect(0, FLOOR, 320, 58, "#6b4a32");
      for (let y = FLOOR, r = 0; y < 150; y += 6, r++) {
        g.rect(0, y, 320, 1, "#4e3424"); g.rect(0, y + 1, 320, 1, "#7a563b");
        for (let x = (r * 29) % 41; x < 320; x += 41) g.rect(x, y + 1, 1, 5, "#4e3424");
      }
      g.alpha(0.3, () => g.rect(0, FLOOR, 320, 3, "#000"));
      // mats
      g.rect(64, 106, 144, 22, "#2f4d7a"); g.rect(64, 106, 144, 1, "#4569a3"); g.rect(64, 127, 144, 2, "#22385a");
      g.rect(112, 107, 1, 20, "#294468"); g.rect(160, 107, 1, 20, "#294468");
      for (let x = 66; x < 206; x += 3) { g.px(x, 108, "#3a5d91"); g.px(x, 125, "#3a5d91"); }
      // clock
      g.circ(98, 24, 5, "#9aa3ad"); g.circ(98, 24, 4, "#f1f1f1");
      const m = t * 0.6, h = t * 0.05;
      g.line(98, 24, 98 + Math.round(Math.cos(m) * 3), 24 + Math.round(Math.sin(m) * 3), "#26282c");
      g.line(98, 24, 98 + Math.round(Math.cos(h) * 2), 24 + Math.round(Math.sin(h) * 2), "#d64545");
      // beam the punching bag hangs from
      g.rect(200, 0, 30, 3, "#3b3f46"); g.rect(213, 3, 3, 1, "#6b7480");
    }

    function cooler(g, t, glug) {
      g.rect(9, 76, 3, 2, "#3e6fb0");
      g.rect(7, 63, 7, 13, "#5f9fd6"); g.rect(6, 65, 9, 9, "#5f9fd6"); g.rect(8, 61, 5, 2, "#3e6fb0"); g.rect(8, 66, 1, 7, "#a9d3f5");
      if (glug) for (let i = 0; i < 3; i++) { const by = 74 - ((t * 10 + i * 4) % 11); g.px(10 + (i % 2), by, "#d7ecfb"); }
      g.rect(5, 78, 11, 19, "#c9ced6"); g.rect(5, 78, 11, 1, "#e6e9ee"); g.rect(15, 78, 1, 19, "#9aa3ad");
      g.rect(7, 83, 2, 2, "#3e6fb0"); g.rect(12, 83, 2, 2, "#d64545"); g.rect(7, 89, 7, 1, "#9aa3ad");
      g.alpha(0.3, () => g.rect(4, 96, 14, 2, "#000"));
    }

    function rack(g) {
      g.rect(80, 82, 2, 15, "#4a5260"); g.rect(106, 82, 2, 15, "#4a5260");
      g.rect(80, 86, 28, 1, "#6b7480"); g.rect(80, 93, 28, 1, "#6b7480");
      const bell = (x, y, c) => { g.rect(x, y - 2, 2, 4, c); g.rect(x + 5, y - 2, 2, 4, c); g.px(x, y - 2, "#9aa3ad"); g.px(x + 5, y - 2, "#9aa3ad"); g.rect(x + 2, y, 3, 1, "#c9ced6"); };
      for (let i = 0; i < 3; i++) { bell(83 + i * 8, 84, "#2b2f37"); bell(83 + i * 8, 91, i === 1 ? "#3e6fb0" : "#2b2f37"); }
      g.rect(77, 80, 34, 1, "#c9ced6"); g.rect(79, 77, 3, 7, "#d64545"); g.rect(106, 77, 3, 7, "#d64545"); g.rect(79, 77, 3, 1, "#e57373"); g.rect(106, 77, 3, 1, "#e57373");
      g.circ(113, 95, 2, "#26282c"); g.rect(112, 91, 3, 1, "#26282c"); g.px(111, 92, "#26282c"); g.px(115, 92, "#26282c");
    }

    function whiteboard(g, D, t) {
      g.rect(20, 46, 52, 38, "#8b95a1"); g.rect(21, 47, 50, 36, "#e8ebef"); g.rect(21, 47, 50, 1, "#f8f9fb");
      // the coach's playbook
      g.text("X", 24, 50, "#d64545"); g.text("X", 24, 59, "#d64545"); g.text("O", 44, 51, "#3e6fb0"); g.text("O", 62, 57, "#3e6fb0");
      for (let i = 0; i < 14; i += 2) g.px(28 + i, 53 + Math.floor(i / 5), "#2b2f37");
      for (let i = 0; i < 16; i += 2) g.px(28 + i, 61 - Math.floor(i / 6), "#2b2f37");
      for (let i = 0; i < 12; i += 2) g.px(48 + i, 54 + Math.floor(i / 3), "#2b2f37");
      g.px(43, 54, "#2b2f37"); g.px(42, 53, "#2b2f37"); g.px(42, 55, "#2b2f37");
      g.rect(28, 84, 36, 2, "#6b7480"); g.rect(32, 83, 4, 1, "#d64545"); g.rect(38, 83, 4, 1, "#3e6fb0");
      // the round's plan: drawn stroke by stroke while planning, left up afterwards, wiped when idle
      if (D.phase === "idle") return [52, 76];
      const shown = D.phase === "planning" ? (t % 10) * 2.4 : PLAN.length;
      let tip = [PLAN[0][0], PLAN[0][1]];
      for (let i = 0; i < PLAN.length && i < shown; i++) {
        const [x0, y0, x1, y1, c] = PLAN[i], k = Math.min(1, shown - i);
        const ex = x0 + (x1 - x0) * k, ey = y0 + (y1 - y0) * k;
        g.line(x0, y0, ex, ey, PLANC[c]);
        tip = [Math.round(ex), Math.round(ey)];
      }
      return tip;
    }

    function shelf(g) {
      g.rect(224, 42, 30, 55, "#5e412c"); g.rect(226, 44, 26, 51, "#2e2018");
      for (const y of [56, 70, 84]) g.rect(226, y, 26, 2, "#5e412c");
      const bottoms = [55, 69, 83, 94];
      for (const b of books) { g.rect(b.x, bottoms[b.r] - b.h + 1, b.w, b.h, b.c); g.px(b.x, bottoms[b.r] - b.h + 2, "rgba(255,255,255,0.35)"); }
      g.alpha(0.3, () => g.rect(223, 96, 32, 2, "#000"));
    }

    function codeLines(g, x, y, w, h, t, speed, mark) {
      const p = Math.floor(t * speed);
      for (let j = 0; j <= Math.ceil(h / 2); j++) {
        const yy = y + 1 + j * 2 - (p % 2);
        if (yy < y || yy >= y + h) continue;
        const li = Math.floor(p / 2) + j, ind = Math.floor(noise(li * 3.1) * 3) * 2;
        const len = 3 + Math.floor(noise(li * 7.7) * Math.max(1, w - 6 - ind));
        if (mark && li % 7 === 3) g.rect(x, yy, w, 1, mark);
        g.rect(x + 1 + ind, yy, len, 1, CODE[Math.floor(noise(li * 1.3) * CODE.length)]);
      }
    }

    function globe(g, cx, cy, r, t) {
      g.circ(cx, cy, r, "#2f6db0");
      const sh = Math.floor(t * 5);
      for (let y = -r; y <= r; y++) {
        const w = Math.round(Math.sqrt(r * r - y * y));
        for (let x = -w; x <= w; x++) if (noise((((x + sh) % 16) + 16) % 16 * 7 + (y + 9) * 131) > 0.62) g.px(cx + x, cy + y, "#3fa06b");
      }
      g.px(cx - Math.round(r / 2), cy - Math.round(r / 2), "#bfe3f5");
    }

    function magnifier(g, x, y) { g.line(x + 2, y + 2, x + 4, y + 4, "#8a5a3b"); g.circ(x, y, 3, "#c9ced6"); g.circ(x, y, 2, "#9fd3f0"); g.px(x - 1, y - 1, "#ffffff"); }

    function desk(g, D, t, bug) {
      g.rect(258, 86, 58, 3, "#8a6440"); g.rect(258, 86, 58, 1, "#a0764f"); g.rect(258, 89, 58, 2, "#6b4a32");
      g.rect(260, 91, 2, 6, "#4e3424"); g.rect(312, 91, 2, 6, "#4e3424");
      g.alpha(0.3, () => g.rect(258, 96, 58, 2, "#000"));
      g.rect(284, 84, 4, 2, "#3b3f46"); g.rect(280, 85, 12, 1, "#3b3f46");
      g.rect(272, 66, 28, 18, "#15181d"); g.rect(273, 67, 26, 1, "#2b2f37");
      g.rect(262, 84, 8, 2, "#f3efe6"); g.px(263, 84, "#9aa3ad");
      g.rect(303, 82, 3, 4, "#f1f1f1"); g.px(306, 83, "#f1f1f1"); g.px(306, 84, "#f1f1f1");
      const x = 274, y = 68, w = 24, h = 14, typing = D.phase === "training" && ["scripting", "bugfix", "research"].includes(D.focus);
      g.rect(275, 86, 18, 1, "#9aa3ad");
      if (typing) g.px(276 + Math.floor(noise(Math.floor(t * 9)) * 16), 86, "#f1f1f1");
      if (D.phase === "training" && D.focus === "research") {
        g.rect(x, y, w, h, "#e8ebef"); g.rect(x, y, w, 2, "#3b3f46"); g.px(x + 1, y, "#d64545"); g.px(x + 3, y, "#e9b949");
        g.rect(x + 2, y + 3, 15, 2, "#ffffff"); box(g, x + 2, y + 3, 15, 2, "#c9ced6"); g.rect(x + 18, y + 3, 3, 2, "#3e6fb0");
        const p = Math.floor(t * 3);
        for (let j = 0; j < 5; j++) {
          const yy = y + 6 + j * 2 - (p % 2), li = Math.floor(p / 2) + j;
          if (yy < y + 6 || yy >= y + h) continue;
          g.rect(x + 2, yy, li % 3 === 0 ? 7 + Math.floor(noise(li) * 8) : 12 + Math.floor(noise(li + 0.5) * 8), 1, li % 3 === 0 ? "#3e6fb0" : "#9aa3ad");
        }
        magnifier(g, x + 6 + Math.round((Math.sin(t * 1.3) + 1) * 6), y + 9 + Math.round(Math.sin(t * 2.1)));
        globe(g, 286, 59, 4, t);
        g.rect(285, 64, 3, 1, "#8b95a1");
      } else if (D.active && D.phase !== "resting") {
        g.rect(x, y, w, h, "#0c1410");
        const fast = typing ? 7 : 1.5;
        codeLines(g, x, y, w, h, t, fast, D.focus === "bugfix" && D.phase === "training" ? (bug.alive ? "#5a1f24" : "#1f4a2c") : null);
        if (Math.floor(t * 3) % 2) g.rect(x + 2, y + h - 2, 2, 1, "#f1f1f1");
      } else {
        g.rect(x, y, w, h, "#0a0f0c");
        if (Math.floor(t) % 2) g.px(x + 2, y + h - 3, "#3fa06b");
      }
    }

    /* ---------- the big wall screen ---------- */
    function header(g, label, D) {
      g.rect(116, 8, 88, 8, "#1a2a40");
      g.text(label, 119, 10, "#9fc1e8");
      g.text("R" + D.round, 201, 10, "#6b7480", { align: "right" });
      if (D.title) g.text(fit(g, D.title, 82), 119, 19, "#f1f1f1");
    }
    function bar(g, u) { g.rect(120, 54, 80, 2, "#22344d"); g.rect(120, 54, Math.round(80 * clamp(u, 0, 1)), 2, BODY); }

    function tutorial(g, t) {
      const L = 9, u = ((t % L) + L) % L;
      g.rect(116, 8, 88, 52, "#141c2a");
      const parts = [
        [147, 46, (d) => g.rect(136, 41 + d, 22, 10, "#3e6fb0")],
        [164, 47, (d) => g.rect(158, 44 + d, 12, 7, "#2aa79b")],
        [147, 36, (d) => fillPoly(g, [[134, 41 + d], [147, 31 + d], [160, 41 + d]], "#d64545")],
        [146, 48, (d) => g.rect(144, 45 + d, 4, 6, "#8a5a3b")],
        [140, 44, (d) => { g.rect(138, 43 + d, 3, 3, "#fde68a"); g.rect(152, 43 + d, 3, 3, "#fde68a"); }],
        [170, 31, (d) => { g.rect(167, 30 + d, 1, 14, "#c9ced6"); g.rect(168, 30 + d, 5, 3, "#e9b949"); }],
      ];
      if (u < 1.2) {
        g.circ(160, 31, 9 + (Math.floor(t * 3) % 2), "#d64545");
        fillPoly(g, [[157, 26], [157, 37], [166, 31.5]], "#f1f1f1");
        g.text("TUTORIAL", 160, 45, "#9aa3ad", { align: "center" });
      } else {
        const s = (u - 1.2) / 1.1, k = Math.floor(s), fr = s - k;
        g.text("STEP " + Math.min(parts.length, k + 1), 119, 11, "#9aa3ad");
        g.rect(124, 51, 72, 1, "#3d4a5c");
        for (let i = 0; i < parts.length && i <= k; i++) parts[i][2](i === k ? -Math.round(6 * (1 - E.out(clamp(fr * 2, 0, 1)))) : 0);
        if (k < parts.length) {
          const [ax, ay] = parts[k], wob = Math.round(Math.sin(t * 6));
          g.rect(ax + 2, ay + 2 + wob, 1, 4, "#f1f1f1"); g.rect(ax + 3, ay + 3 + wob, 1, 2, "#f1f1f1"); g.px(ax + 4, ay + 4 + wob, "#f1f1f1");
        } else star(g, 150 + Math.round(Math.sin(t * 5) * 14), 24, 2, "#e9b949");
      }
      bar(g, u / L);
      g.px(120 + Math.round((80 * u) / L), 53, "#f1f1f1");
    }

    function drill(g, D, t, bug) {
      header(g, D.focus.toUpperCase(), D);
      const top = D.title ? 26 : 20;
      if (D.focus === "modeling") {
        for (let i = 0; i < 6; i++) g.line(160, top + 4, 122 + i * 15, 52, "#22344d");
        for (const y of [44, 48, 52]) g.rect(120, y, 80, 1, "#22344d");
        cube(g, 160, 48, 6, t * 0.9, 0.5);
      } else if (D.focus === "scripting") {
        codeLines(g, 120, top, 80, 50 - top, t, 8);
        g.text("</>", 196, top + 1, "#9fd38a", { align: "right" });
      } else if (D.focus === "research") {
        for (let j = 0; j < 6; j++) g.rect(122, top + 2 + j * 4, 34 + Math.floor(noise(j * 5.1) * 16), 1, "#3d4a5c");
        magnifier(g, 132 + Math.round((Math.sin(t * 1.2) + 1) * 16), top + 8 + Math.round(Math.sin(t * 2) * 4));
        globe(g, 188, top + 12, 7, t);
      } else if (D.focus === "bugfix") {
        const bx = 156, by = top + 10, leg = Math.floor(t * 8) % 2, body = bug.alive ? "#58b368" : "#3b4a3f";
        for (let i = -1; i <= 1; i++) { g.line(bx + i * 3, by - 4, bx + i * 3 - 1 + leg, by - 7, "#8b95a1"); g.line(bx + i * 3, by + 4, bx + i * 3 - 1 + leg, by + 7, "#8b95a1"); }
        g.circ(bx, by, 5, body); g.rect(bx - 5, by, 11, 1, "#2b6b3a"); g.circ(bx + 6, by, 2, "#2b2f37");
        g.line(bx + 7, by - 2, bx + 10, by - 4, "#8b95a1"); g.line(bx + 7, by + 2, bx + 10, by + 4, "#8b95a1");
        g.px(bx - 2, by - 3, "#2b6b3a"); g.px(bx + 2, by - 2, "#2b6b3a"); g.px(bx - 2, by + 2, "#2b6b3a"); g.px(bx + 2, by + 3, "#2b6b3a"); g.px(bx - 1, by - 4, "#a6e39a");
        if (bug.alive) { if (Math.floor(t * 3) % 2) g.text("BUG", 180, by - 2, "#ff6b6b"); }
        else { tick(g, bx - 3, by - 2, "#5ad08a"); g.text("FIXED", 172, by - 2, "#5ad08a"); }
      } else {
        let prev = null;
        for (let x = 0; x < 72; x++) {
          const k = (x + Math.floor(t * 30)) % 36, dy = k === 18 ? -9 : k === 19 ? 5 : k === 17 ? -2 : k === 20 ? -1 : 0;
          const pt = [124 + x, top + 14 + dy];
          if (prev) g.line(prev[0], prev[1], pt[0], pt[1], "#3fd07a");
          prev = pt;
        }
        if (Math.floor(t * 2) % 2) g.text("♥", 122, top, "#ff6b6b");
        g.text("BPM " + (120 + Math.floor(noise(Math.floor(t)) * 30)), 198, top, "#9aa3ad", { align: "right" });
      }
      bar(g, (t % 8) / 8);
    }

    function screen(g, D, t, bug) {
      g.rect(114, 6, 92, 56, "#0b0d10"); g.rect(116, 8, 88, 52, "#101a28");
      g.rect(156, 62, 8, 2, "#2b2f37");
      if (D.phase === "idle") {
        g.text("READY", 160, 22, "#e9b949", { scale: 2, align: "center", shadow: "#3a2a08" });
        if (Math.floor(t * 2) % 2 === 0) g.rect(182, 30, 6, 2, "#e9b949");
        g.text("TRAINING HALL", 160, 42, "#6b7480", { align: "center" });
      } else if (D.phase === "resting") {
        g.text("BREAK", 160, 16, "#7fd1a8", { scale: 2, align: "center", shadow: "#0f3324" });
        g.rect(155, 34, 9, 10, "#e6f2fb"); g.rect(156, 35, 7, 3, "#7fb7e6"); g.rect(164, 36, 2, 5, "#e6f2fb");
        g.text("BACK SOON", 160, 48, "#6b7480", { align: "center" });
      } else if (D.phase === "planning") {
        header(g, "PLAN", D);
        const top = D.title ? 27 : 21, n = Math.floor((t % 8) / 1.2);
        for (let j = 0; j < 4 && j <= n; j++) {
          box(g, 120, top + j * 7, 4, 4, "#9fc1e8");
          g.rect(127, top + 1 + j * 7, 20 + Math.floor(noise(j * 9.3) * 40), 2, "#3d4a5c");
          if (j < n) tick(g, 119, top - 1 + j * 7, "#5ad08a");
        }
      } else if (D.phase === "reviewing") {
        header(g, "REVIEW", D);
        const u = (t % 6) / 1.5;
        for (let i = 0; i < 5; i++) {
          const hgt = Math.round((8 + noise(D.round * 10 + i) * 16) * E.out(clamp(u - i * 0.12, 0, 1)));
          g.rect(122 + i * 13, 53 - hgt, 9, hgt, i === 4 ? "#5ad08a" : "#3e6fb0");
        }
        g.rect(120, 53, 66, 1, "#3d4a5c");
        if (u > 1.4) tick(g, 189, 30, "#5ad08a");
      } else if (D.focus === "video") tutorial(g, t);
      else drill(g, D, t, bug);
      g.alpha(0.12, () => { for (let y = 9; y < 60; y += 2) g.rect(116, y, 88, 1, "#000"); });
    }

    /* ---------- props in the play area ---------- */
    function workbench(g, D, t) {
      g.rect(6, 112, 56, 3, "#a0764f"); g.rect(6, 112, 56, 1, "#b88a5e"); g.rect(6, 115, 56, 4, "#7a5638");
      g.rect(8, 119, 3, 10, "#5e412c"); g.rect(57, 119, 3, 10, "#5e412c"); g.rect(10, 125, 48, 1, "#5e412c");
      g.alpha(0.3, () => g.rect(6, 128, 56, 2, "#000"));
      g.rect(50, 110, 6, 2, "#9aa3ad"); g.rect(52, 109, 2, 1, "#9aa3ad");
      g.rect(12, 111, 7, 1, "#c9a46a");
      const live = D.phase === "training" && D.focus === "modeling";
      cube(g, 34, 111, 5, live ? t * 1.4 : 0.6, 0.45);
      if (!live) return;
      for (let i = 0; i < 6; i++) {
        const c = t * 1.3 + i / 6, u = c % 1, a = -Math.PI * noise(i * 9.1 + Math.floor(c) * 3.3);
        if (u < 0.8) g.px(34 + Math.cos(a) * u * 13, 102 + Math.sin(a) * u * 10 + u * u * 9, i % 2 ? "#fde68a" : "#f29a3a");
      }
      const k = Math.floor(t / 2);
      if (st.spark !== k) { st.spark = k; fx(34, 100, { n: 8, colors: ["#fde68a", "#f29a3a", "#ffffff"], speed: 30, life: 0.5, gravity: 50, up: 10 }); }
    }

    function bench(g, D) {
      g.rect(232, 130, 68, 3, "#8a6440"); g.rect(232, 130, 68, 1, "#a0764f");
      g.rect(236, 133, 2, 5, "#5e412c"); g.rect(294, 133, 2, 5, "#5e412c");
      g.alpha(0.3, () => g.rect(232, 137, 68, 2, "#000"));
      if (D.phase !== "resting") { g.rect(286, 128, 9, 2, "#f1f1f1"); g.rect(286, 130, 2, 3, "#e6e9ee"); g.rect(240, 127, 3, 3, "#7fb7e6"); g.px(241, 126, "#3e6fb0"); }
    }

    function bagSwing(t, punching) {
      if (!punching) return Math.round(Math.sin(t * 1.3) * 0.6);
      const u = (t % 0.9) / 0.9;
      if (u < 0.15) return 0;
      const v = (u - 0.15) / 0.85;
      return Math.round(3 * Math.sin(v * Math.PI * 2) * (1 - v));
    }
    function punchBag(g, s) {
      g.line(214, 4, 214 + Math.round(s / 2), 81, "#6b7480");
      g.alpha(0.3, () => g.rect(208 + Math.round(s / 2), 115, 13, 2, "#000"));
      g.rect(209 + s, 82, 11, 22, "#b03a3a"); g.rect(211 + s, 84, 1, 17, "#d65a5a"); g.rect(218 + s, 83, 1, 20, "#8a2a2a");
      g.rect(210 + s, 81, 9, 2, "#26282c"); g.rect(210 + s, 103, 9, 2, "#26282c"); g.rect(209 + s, 91, 11, 2, "#26282c");
    }

    function openBook(g, x, y, t) {
      g.rect(x - 1, y + 4, 13, 1, "#3e6fb0");
      g.rect(x, y, 5, 4, "#f3efe6"); g.rect(x + 6, y, 5, 4, "#f3efe6"); g.rect(x + 5, y, 1, 4, "#8a5a3b");
      g.rect(x + 1, y + 1, 3, 1, "#9aa3ad"); g.rect(x + 1, y + 3, 2, 1, "#9aa3ad"); g.rect(x + 7, y + 1, 3, 1, "#9aa3ad"); g.rect(x + 7, y + 3, 3, 1, "#9aa3ad");
      const u = (t % 1.6) / 1.6;
      if (u < 0.4) {
        const p = u / 0.4, w = Math.max(1, Math.round(5 * Math.abs(Math.cos(Math.PI * p))));
        g.rect(p < 0.5 ? x + 6 : x + 5 - w, y - 1, w, 4, "#ffffff");
      }
    }

    function cup(g, x, y) { g.rect(x, y, 2, 3, "#e6f2fb"); g.px(x, y, "#7fb7e6"); }

    /* ---------- people ---------- */
    function drawTrainer(g, T, p, t, D, tip) {
      const x = Math.round(p.x), fy = Math.round(p.y), y = fy - 16, f = !!T.flip;
      if (p.moving) { shadow(g, x + 3, fy, 12); spr(g, "trainer", x, y - (Math.floor(t * 8) % 2), p.dir < 0); return; }
      if (T.act === "board") {
        backView(g, "trainer", x, y, f);
        g.line(x + 16, y + 9, tip[0], tip[1], "#c9a46a"); g.px(tip[0], tip[1], "#26282c");
        return;
      }
      shadow(g, x + 3, fy, 12);
      if (T.act === "ball") {
        const h = Math.abs(Math.sin(t * 3.4)) * 7, bx = x - 1, by = Math.round(fy - 3 - h);
        g.alpha(0.25, () => g.rect(bx - 2 + Math.round(h / 4), fy - 1, 5 - Math.round(h / 3), 1, "#000"));
        spr(g, "trainer", x, y - (h > 5 ? 0 : 1), f);
        if (h > 4) g.rect(x, y + 10, 2, 2, BODY);
        if (h < 0.8) { g.rect(bx - 3, fy - 3, 7, 2, "#d64545"); g.rect(bx - 2, fy - 4, 5, 1, "#d64545"); }
        else { g.circ(bx, by, 2, "#d64545"); g.px(bx - 1, by - 1, "#f08a8a"); }
        return;
      }
      if (T.act === "clip") {
        spr(g, "trainer", x, y - (Math.floor(t * 1.5) % 2), f);
        g.rect(x - 2, y + 8, 5, 7, "#8a5a3b"); g.rect(x - 1, y + 9, 3, 5, "#f3efe6"); g.rect(x - 1, y + 8, 3, 1, "#c9ced6");
        g.px(x, y + 10, "#9aa3ad"); g.px(x, y + 12, Math.floor(t * 2) % 2 ? "#3fa06b" : "#9aa3ad");
        return;
      }
      if (T.act === "cooler") {
        spr(g, "trainer", x, y, f);
        cup(g, x - 1, y + 8 - (((t % 4) < 0.7) ? 2 : 0));
        return;
      }
      // coaching: bob, wave the free arm, blow the whistle now and then
      const b = Math.floor(t * 2) % 2, wave = Math.floor(t * 1.6) % 2;
      spr(g, "trainer", x, y - b, f);
      const yy = y - b;
      if (wave) g.rect(f ? x + 15 : x + 1, yy + 5, 2, 4, BODY); else g.rect(f ? x + 17 : x - 1, yy + 9, 2, 1, BODY);
      if (t % 5 < 0.9) { const wx = f ? x - 4 : x + 21; g.px(wx, yy + 8, "#f1f1f1"); g.px(f ? wx - 1 : wx + 1, yy + 7, "#f1f1f1"); g.px(f ? wx - 1 : wx + 1, yy + 9, "#f1f1f1"); }
    }

    function drawCrew(g, c, p, t, i, bug) {
      const k = c.kind, x = Math.round(p.x), fy = Math.round(p.y), y = fy - 16, f = !!c.flip;
      const bob = (rate) => Math.floor(t * rate + i * 0.37) % 2;
      if (c.act === "chase") {
        const fl = p.dir < 0, yy = y - bug.hop;
        shadow(g, x + 3, fy, 12);
        spr(g, k, x, yy, fl);
        const mx = fl ? x - 4 : x + 21, my = yy + 7;
        g.line(fl ? x + 1 : x + 16, yy + 10, fl ? mx + 2 : mx - 2, my + 2, "#8a5a3b");
        g.circ(mx, my, 2, "#c9ced6"); g.rect(mx - 1, my - 1, 2, 2, "#9fd3f0");
        return;
      }
      if (p.moving) { shadow(g, x + 3, fy, 12); spr(g, k, x, y - (Math.floor(t * 8 + i) % 2), p.dir < 0); return; }
      switch (c.act) {
        case "sculpt": spr(g, k, x, y - bob(5), f); break;
        case "inspect": spr(g, k, x, y - bob(1.2), f); break;
        case "type": { backView(g, k, x, y, f); const b = bob(7); g.rect(b ? x + 15 : x + 1, y + 8, 2, 1, BODY); break; }
        case "overlook": shadow(g, x + 3, fy, 12); spr(g, k, x, y, f); break;
        case "book": shadow(g, x + 3, fy, 12); spr(g, k, x, y - bob(1), f); openBook(g, x + 4, y + 9 - bob(1), t + i * 0.5); break;
        case "watch": backView(g, k, x, y + 3, f); g.rect(x + 1, fy - 1, 16, 4, "#7a4fc2"); g.rect(x + 1, fy - 1, 16, 1, "#9a6fe2"); break;
        case "bag": {
          const punch = (t % 0.9) / 0.9 < 0.15, lx = punch ? 2 : 0;
          shadow(g, x + 3, fy, 12); spr(g, k, x + lx, y, false);
          if (punch) g.rect(x + lx + 17, y + 9, 4, 2, BODY);
          break;
        }
        case "jacks": {
          const up = Math.floor(t * 3.2 + i * 0.5) % 2 === 0, yy = y - (up ? 3 : 0);
          shadow(g, x + 3, fy, 12); spr(g, k, x, yy, f);
          if (up) { g.rect(x + 1, yy + 5, 2, 4, BODY); g.rect(x + 15, yy + 5, 2, 4, BODY); g.rect(x + 2, yy + 14, 1, 2, BODY); g.rect(x + 15, yy + 14, 1, 2, BODY); }
          break;
        }
        case "pushup": {
          const down = Math.floor(t * 2 + i * 0.3) % 2 === 1, head = fy - (down ? 8 : 11), feet = fy - 4;
          shadow(g, x, fy, 18);
          const top = (c) => head + Math.round(((feet - head) * c) / 15);
          for (let c = 0; c < 16; c++) g.rect(x + c, top(c), 1, c < 5 ? 5 : 4, BODY);
          g.rect(x + 3, top(3) + 5, 1, fy - top(3) - 5, BODY); g.rect(x + 5, top(5) + 4, 1, fy - top(5) - 4, BODY);
          g.rect(x + 1, head + 1, 1, 2, "#1d1a18");
          if (ACC[k]) g.rect(x, head - 1, 4, 2, ACC[k]);
          if (!down && (Math.floor(t * 0.7 + i) % 3 === 0)) g.px(x - 1, head - 2, "#9fd3f0");
          break;
        }
        case "bench": spr(g, k, x, y, false); cup(g, x - 1, y + 8 - ((t + i * 1.3) % 4 < 0.6 ? 2 : 0)); break;
        case "sip": shadow(g, x + 3, fy, 12); spr(g, k, x, y, f); cup(g, f ? x + 16 : x - 1, y + 8 - ((t + i) % 4 < 0.6 ? 2 : 0)); break;
        case "watchboard": shadow(g, x + 3, fy, 12); backView(g, k, x, y, true); break;
        case "line": shadow(g, x + 3, fy, 12); spr(g, k, x, y - bob(1.5), f); break;
        default: {
          const up = (t + i * 0.9) % 3 < 0.5, yy = y - (up ? 1 : 0);
          shadow(g, x + 3, fy, 12); spr(g, k, x, yy, f);
          if (up) { g.rect(x + 1, yy + 5, 2, 4, BODY); g.rect(x + 15, yy + 5, 2, 4, BODY); }
        }
      }
    }

    function draw(g) {
      let D;
      try { D = read(env.data); } catch (e) { D = read({}); }
      const t = Number.isFinite(env.t) ? env.t : 0;
      const bug = bugState(t);
      const { T, crew } = layout(D);
      const training = D.phase === "training";

      room(g, t);
      const tip = whiteboard(g, D, t);
      screen(g, D, t, bug);
      cooler(g, t, D.phase === "resting" && t % 3 < 1.2);
      rack(g);
      shelf(g);
      desk(g, D, t, bug);
      if (training && D.focus === "bugfix") { g.rect(66, 143, 8, 1, "#2b1d14"); g.px(68, 142, "#2b1d14"); g.px(71, 144, "#2b1d14"); }

      const Q = [], add = (z, fn) => Q.push([z, Q.length, fn]);
      const puncher = training && crew.some((c) => c.act === "bag");
      add(116, () => punchBag(g, bagSwing(t, puncher)));
      add(128, () => workbench(g, D, t));
      add(137, () => bench(g, D));
      const tp = walk("trainer", T.x, T.y, 50);
      add(tp.y, () => drawTrainer(g, T, tp, t, D, tip));
      crew.forEach((c, i) => {
        const chase = c.act === "chase";
        const p = walk(c.key, chase ? bug.cx : c.x, c.y, chase ? 90 : 60);
        add(p.y + (chase ? 0.5 : 0), () => drawCrew(g, c, p, t, i, bug));
      });
      const chasing = training && crew.some((c) => c.act === "chase");
      if (chasing && bug.alive) add(143, () => g.alpha(bug.rise, () => bugIcon(g, bug.bx, bug.by + Math.round((1 - bug.rise) * 2), t)));
      Q.sort((a, b) => a[0] - b[0] || a[1] - b[1]).forEach((q) => q[2]());

      // effects over everything
      if (chasing) {
        if (bug.poof >= 0) {
          const k = bug.poof, r = 1 + Math.round(k * 4);
          g.alpha(1 - k, () => { g.circ(bug.bx + 1, bug.by, r, "#c9ced6"); g.circ(bug.bx + 5, bug.by + 1, Math.max(1, r - 1), "#e6e9ee"); });
          if (k < 0.6) pop(g, "SQUASH!", bug.bx - 10, bug.by - 14, k / 0.6, "#f1f1f1");
        }
        const c = Math.floor(t / 8);
        if (bug.u >= 5 && st.squash !== c) {
          st.squash = c;
          fx(bug.bx + 3, bug.by + 1, { n: 12, colors: ["#c9ced6", "#f1f1f1", "#58b368"], speed: 30, life: 0.6, gravity: 20 });
          if (!env.reduced && typeof env.shake === "function") env.shake(1, 120);
        }
      }
      if (puncher) {
        const c = Math.floor(t / 0.9), u = (t % 0.9) / 0.9;
        if (u >= 0.15 && st.bag !== c) { st.bag = c; fx(208, 92, { n: 4, colors: ["#f1f1f1", "#e9b949"], speed: 25, life: 0.3, gravity: 0 }); }
        if (c % 3 === 0 && u >= 0.15 && u < 0.6) pop(g, "POW", 210, 76, (u - 0.15) / 0.45, "#e9b949");
      }
      if (T.act === "coach" && !tp.moving && t % 5 < 0.9) {
        const tx = Math.round(tp.x), ty = Math.round(tp.y) - 16;
        pop(g, "TWEET!", T.flip ? tx - 28 : clamp(tx + 23, 0, 296), ty + 2, (t % 5) / 0.9, "#f1f1f1");
      }
      if (T.act === "board" && !tp.moving) {
        const lit = Math.floor(t * 2) % 3 !== 0;
        g.bubble(76, 57, 17, 14, { tail: false, fill: "#f1f1f1", stroke: "#2b2f37" });
        bulb(g, 81, 60, lit);
        if (lit) star(g, 96, 56, 1, "#fde68a");
        g.rect(68, 73, 4, 4, "#2b2f37"); g.rect(69, 74, 2, 2, "#f1f1f1"); g.rect(61, 79, 3, 3, "#2b2f37"); g.px(62, 80, "#f1f1f1");
      }
      crew.forEach((c, i) => {
        const p = st.pos.get(c.key);
        if (!p || p.moving) return;
        const x = Math.round(p.x), y = Math.round(p.y) - 16;
        if (c.act === "line") {
          const u = ((t + i * 0.6) % 2.4) / 2.4;
          if (u < 0.5) { const v = u * 2; g.alpha(1 - v, () => tick(g, x + 6, y - 5 - Math.round(v * 6), "#5ad08a")); pop(g, "+XP", x + 4, y - 12, v, "#e9b949"); }
        } else if (c.act === "inspect" && training) {
          const u = ((t + 1) % 3) / 3;
          if (u < 0.3) g.alpha(1 - u / 0.3, () => tick(g, x + 6, y - 4 - Math.round(u * 15), "#5ad08a"));
        } else if (c.act === "overlook" && training) {
          const u = (t % 4) / 4;
          if (u < 0.25) pop(g, u < 0.12 ? "?" : "!", x + 8, y - 4, u / 0.25, "#e9b949");
        }
      });
      if (D.phase === "resting") {
        const sleeper = crew.find((c) => c.act === "bench");
        const p = sleeper && st.pos.get(sleeper.key);
        if (p && !p.moving) for (let k = 0; k < 3; k++) {
          const u = (t * 0.35 + k / 3) % 1;
          g.alpha(1 - u, () => g.text("Z", Math.round(p.x) + 14 + Math.round(u * 6), Math.round(p.y) - 14 - Math.round(u * 14), "#c9ced6", { shadow: INK }));
        }
      }

      if (D.active) {
        // Between rounds there is no focus yet, so say what the hall is doing instead.
        const b = D.focusGiven && (D.phase === "training" || D.phase === "reviewing") ? D.focus.toUpperCase() : PHASE_WORD[D.phase] || "TRAINING";
        const a = "ROUND " + D.round, w = Math.max(g.textWidth(a), g.textWidth(b)) + 7;
        g.alpha(0.6, () => g.rect(2, 2, w, 17, "#07080a"));
        g.text(a, 5, 4, "#e9b949", { shadow: "#000" });
        g.text(b, 5, 11, "#c9ced6", { shadow: "#000" });
      }
      for (const [k, p] of st.pos) if (p.seen !== env.frame) st.pos.delete(k);
    }

    return { size: [320, 150], bg: "#1c2029", draw };
  });
})();
