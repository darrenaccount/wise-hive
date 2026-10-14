/* Activity scene: the hive at work. One desk per running chat or unattended run, with a Claude typing at it;
   background agents carry papers between the desks and the filing cabinet. A red flag goes up when something
   needs the user; when nothing runs, a Claude naps on a beanbag.
   update({working: [{title, kind}], jobs: [{label}], needs: number}) */
(function () {
  "use strict";
  if (!window.Pixel) return;

  const W = 320, H = 100;
  const EYE = "#1d1a18";
  const MAX = 6;
  // Lookup tables without a prototype, so labels like "constructor" from bad data find nothing.
  const dict = (o) => Object.assign(Object.create(null), o);
  // Run kinds and job labels as the server sends them (startChat's kind; server.js JOB_LABEL). A sketch run's title already
  // starts "Sketch reader: ", so it gets a sprite but no RUN_KIND prefix. Jobs use the icons the activity panel gives them.
  const RUN_SPRITE = dict({ training: "trainer", working: "foreman", updates: "messenger", sketch: "researcher", brainstorm: "brainstormer" });
  const RUN_KIND = dict({ training: "TRAINING", working: "WORKING", updates: "UPDATES" });
  const JOB_SPRITE = dict({ Librarian: "librarian", Organizer: "organizer", Refiner: "refiner", "Prompt librarian": "refiner", Clarifier: "clarifier",
    Judge: "judge", "Council member": "believer", "Link relay": "desk", Inventor: "inventor", Trainer: "trainer", Foreman: "foreman",
    Trimmer: "librarian", Skillsmith: "librarian", "Skill reviewer": "judge", "Taste critic": "critic", "Taste curator": "reviewer" });
  const CODE = ["#5cc28a", "#e9b949", "#7aa2d6", "#e5896a", "#c9ced6"];
  const DT = 74;              // desk top
  const WY = 81;              // walkers' sprite y: feet on the floor at y 97
  const CAB = 15, SHELF = 304; // filing cabinet and shelf: walkers fetch and file papers there
  const LAMPS = [70, 250];
  const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []);
  // The pixel font has A-Z, digits and a little punctuation; anything else is dropped.
  const clean = (s, n) => {
    s = String(s || "").toUpperCase().replace(/[^A-Z0-9 !?.,:\-+/'"%#()*=<>_]/g, "").replace(/\s+/g, " ").trim();
    return s.length > n ? s.slice(0, n - 2).trimEnd() + ".." : s;
  };

  // Minimal drawing helpers for the cached background canvas (same calls as the engine's g).
  function painter(ctx) {
    const p = {
      rect(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); },
      px(x, y, c) { p.rect(x, y, 1, 1, c); },
      circ(cx, cy, r, c) { for (let y = -r; y <= r; y++) { const w = Math.round(Math.sqrt(r * r - y * y)); p.rect(cx - w, cy + y, w * 2 + 1, 1, c); } },
      line(x0, y0, x1, y1, c) {
        x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
        const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
        let err = dx + dy;
        ctx.fillStyle = c;
        for (let i = 0; i < 1000; i++) { ctx.fillRect(x0, y0, 1, 1); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } }
      },
      alpha(a, fn) { ctx.save(); ctx.globalAlpha = a; fn(); ctx.restore(); },
    };
    return p;
  }

  // The room without anyone in it: honeycomb wall, floor, cabinet, shelf, lamps, clock face.
  function paintRoom(p, noise) {
    p.rect(0, 0, W, 66, "#231a12");
    // Flat-top hexes 11 px wide, columns 8 px apart, odd columns half a cell lower.
    for (let c = -1; c * 8 < W; c++) for (let r = -1; r * 8 < 66; r++) {
      const x = c * 8, y = r * 8 + (c & 1 ? 4 : 0), h = noise(c * 31 + r * 7 + 5);
      if (h > 0.84) { p.rect(x + 3, y + 2, 6, 5, h > 0.94 ? "#5a4220" : "#3a2b17"); if (h > 0.94) p.px(x + 4, y + 3, "#8a6a2f"); }
      const V = [[x + 3, y], [x + 8, y], [x + 11, y + 4], [x + 8, y + 8], [x + 3, y + 8], [x, y + 4]];
      V.forEach((v, i) => { const w = V[(i + 1) % 6]; p.line(v[0], v[1], w[0], w[1], "#33271b"); });
    }
    p.rect(0, 0, W, 2, "#17110b"); p.rect(0, 2, W, 1, "#1d150e");
    p.rect(0, 62, W, 4, "#3a2a1c"); p.rect(0, 62, W, 1, "#4d3826"); p.rect(0, 66, W, 1, "#1a120c");
    // floor boards in perspective
    p.rect(0, 67, W, H - 67, "#3a2a1e");
    const rows = [67, 69, 72, 76, 81, 87, 94, H];
    for (let r = 0; r < rows.length - 1; r++) {
      p.rect(0, rows[r], W, 1, "#2a1e15"); p.rect(0, rows[r] + 1, W, 1, "#443224");
      for (let x = (r * 23) % 46; x < W; x += 46) p.rect(x, rows[r] + 1, 1, rows[r + 1] - rows[r] - 1, "#2a1e15");
    }
    // filing cabinet with a plant on top
    p.rect(5, 42, 20, 38, "#4b5560"); p.rect(5, 42, 20, 1, "#6a7480"); p.rect(24, 42, 1, 38, "#323a43");
    for (let i = 0; i < 3; i++) { p.rect(7, 45 + i * 11, 16, 9, "#57616d"); p.rect(7, 53 + i * 11, 16, 1, "#323a43"); p.rect(13, 48 + i * 11, 4, 1, "#c9ced6"); p.rect(10, 46 + i * 11, 10, 1, "#d9d2c3"); }
    p.rect(6, 80, 18, 1, "#1a120c");
    p.rect(10, 36, 8, 6, "#a8613a"); p.rect(10, 36, 8, 1, "#c27a4f");
    for (const [x, y] of [[11, 31], [13, 29], [15, 30], [17, 32], [12, 33], [16, 34], [14, 32]]) p.rect(x, y, 2, 3, "#3fa06b");
    p.px(14, 29, "#5cc28a"); p.px(16, 30, "#5cc28a");
    // shelf of honey jars and binders
    p.rect(294, 30, 22, 50, "#4a3020"); p.rect(294, 30, 22, 1, "#6a4630"); p.rect(296, 32, 18, 46, "#2a1c13");
    for (const y of [44, 58, 72]) p.rect(296, y, 18, 2, "#6a4630");
    const books = ["#3e6fb0", "#d64545", "#3fa06b", "#7a4fc2", "#e9b949", "#2aa79b"];
    for (let i = 0; i < 6; i++) p.rect(297 + i * 3, 50 - (i % 2), 2, 8 + (i % 2), books[i]);
    for (let i = 0; i < 3; i++) { const x = 297 + i * 6; p.rect(x, 37, 5, 7, "#e9b949"); p.rect(x, 36, 5, 1, "#8a5a3b"); p.rect(x + 1, 39, 1, 3, "#fde68a"); }
    for (let i = 0; i < 2; i++) p.rect(298 + i * 8, 62, 6, 10, i ? "#c9a46a" : "#8b95a1");
    p.rect(295, 80, 21, 1, "#1a120c");
    // pendant lamps
    for (const x of LAMPS) {
      p.alpha(0.05, () => p.circ(x, 16, 20, "#ffcf7a")); p.alpha(0.06, () => p.circ(x, 14, 10, "#ffdf9a"));
      p.rect(x, 0, 1, 7, "#14100c"); p.rect(x - 3, 6, 7, 1, "#4a5059"); p.rect(x - 4, 7, 9, 3, "#3a3f47"); p.px(x, 10, "#ffe6a8"); p.px(x - 1, 10, "#ffcf7a"); p.px(x + 1, 10, "#ffcf7a");
    }
    // clock face (hands are drawn live)
    p.circ(284, 18, 7, "#5b3a26"); p.circ(284, 18, 6, "#f3efe6");
    for (const [dx, dy] of [[0, -5], [5, 0], [0, 5], [-5, 0]]) p.px(284 + dx, 18 + dy, "#8b95a1");
  }

  Pixel.register("activity", (env) => {
    const BODY = (Pixel.resolveColor && Pixel.resolveColor("var(--claude)")) || "#e5896a";
    let bgc = null, walkers = [];

    function background() {
      if (!bgc) {
        bgc = document.createElement("canvas"); bgc.width = W; bgc.height = H;
        paintRoom(painter(bgc.getContext("2d")), env.noise);
      }
      return bgc;
    }

    function clock(g) {
      const d = new Date(), m = d.getMinutes() + d.getSeconds() / 60, h = (d.getHours() % 12) + m / 60;
      const am = (m / 60) * Math.PI * 2, ah = (h / 12) * Math.PI * 2;
      g.line(284, 18, 284 + Math.sin(ah) * 3, 18 - Math.cos(ah) * 3, "#2b2f37");
      g.line(284, 18, 284 + Math.sin(am) * 5, 18 - Math.cos(am) * 5, "#5b6370");
      g.px(284, 18, "#d64545");
    }

    function desk(g, cx, i, kind, t) {
      const sx = cx - 20, sy = DT - 14, tick = env.reduced ? 0 : Math.floor(t * 9 + i * 3);
      g.rect(cx - 18, 62, 15, 12, "#2f343c"); g.rect(cx - 18, 62, 15, 1, "#454b55");
      g.sprite(RUN_SPRITE[kind] || "claude", sx, sy + (tick % 6 === 0 ? 1 : 0));
      g.alpha(0.1, () => g.rect(cx - 6, 60, 7, 14, "#7fe0b0"));
      // desk
      g.rect(cx - 20, DT, 40, 2, "#7a5236"); g.rect(cx - 20, DT, 40, 1, "#8f6342");
      g.rect(cx - 19, DT + 2, 38, 11, "#5b3a26"); g.rect(cx - 19, DT + 2, 38, 1, "#3e2619");
      g.rect(cx + 3, DT + 4, 13, 6, "#4e3322"); g.rect(cx + 3, DT + 4, 13, 1, "#3e2619"); g.rect(cx + 8, DT + 6, 3, 1, "#c9a46a");
      g.rect(cx - 19, DT + 13, 2, 5, "#3e2619"); g.rect(cx + 17, DT + 13, 2, 5, "#3e2619"); g.rect(cx - 18, DT + 18, 36, 1, "#21170f");
      // keyboard and typing hands
      g.rect(cx - 17, DT - 1, 11, 1, "#3b3f46");
      if (!env.reduced) g.px(cx - 16 + ((tick * 7) % 9), DT - 1, "#c9ced6");
      const up = tick % 2;
      g.rect(cx - 16, DT - 1 - up, 2, 1, "#c9694c"); g.rect(cx - 9, DT - 2 + up, 2, 1, "#c9694c");
      if (env.noise(i * 7.3 + 1) > 0.5) {
        g.rect(cx - 3, DT - 3, 3, 3, "#e9ebef"); g.px(cx, DT - 2, "#e9ebef");
        if (!env.reduced) { const s = (t * 0.8 + i) % 1; g.alpha(1 - s, () => g.px(cx - 2 + Math.round(Math.sin(s * 6)), DT - 4 - Math.round(s * 4), "#9097a3")); }
      }
      // monitor with code scrolling up
      const mx = cx + 1, my = 56;
      g.rect(mx, my, 18, 14, "#2b2f37"); g.rect(mx, my, 18, 1, "#3b4049");
      g.rect(mx + 1, my + 1, 16, 11, "#0e1714");
      const off = env.reduced ? 0 : t * 5 + i * 7, first = Math.floor(off / 2), sub = Math.floor(off) % 2;
      for (let j = 0; j < 7; j++) {
        const y = my + 2 + j * 2 - sub;
        if (y < my + 1 || y > my + 11) continue;
        const seed = (first + j) * 13 + i * 101;
        const ind = Math.floor(env.noise(seed) * 3) * 2, l1 = 2 + Math.floor(env.noise(seed + 1) * 6), l2 = Math.floor(env.noise(seed + 2) * 6);
        let x = mx + 2 + ind;
        for (const [len, k] of [[l1, 3], [l2, 4]]) {
          const w = Math.min(len, mx + 16 - x);
          if (w > 0) g.rect(x, y, w, 1, CODE[Math.floor(env.noise(seed + k) * CODE.length)]);
          x += len + 1;
        }
      }
      g.rect(mx + 7, my + 14, 4, 3, "#2b2f37"); g.rect(mx + 5, my + 17, 8, 1, "#3b4049");
    }

    function more(g, n) {
      const s = "+" + n, w = g.textWidth(s) + 8, x = SHELF - Math.floor(w / 2);
      g.rect(SHELF - 1, 84, 2, 10, "#3e2619");
      g.rect(x, 74, w, 11, "#3e2619"); g.rect(x + 1, 75, w - 2, 9, "#e9b949");
      g.text(s, x + 4, 77, "#2a1a10");
    }

    function alarm(g, x, t) {
      const k = env.reduced ? 1 : 0.5 + 0.5 * Math.sin(t * 7);
      g.alpha(0.1 + 0.22 * k, () => g.circ(x + 6, 44, 10, "#ef7a72"));
      g.rect(x, 40, 1, DT - 40, "#c9ced6"); g.px(x, 39, "#e9b949");
      const wave = env.reduced ? 0 : Math.floor(t * 6) % 2;
      for (let r = 0; r < 8; r++) g.rect(x + 1, 40 + r, 10 - ((r + wave) % 2), 1, k > 0.5 ? "#ef4f45" : "#d64545");
      g.text("!", x + 4, 41, "#ffffff");
      if (env.reduced || t % 1 < 0.65) {
        const tw = g.textWidth("NEEDS YOU"), tx = Math.max(4, Math.min(W - tw - 4, Math.round(x + 6 - tw / 2)));
        g.rect(tx - 3, 28, tw + 6, 9, "#ef7a72"); g.rect(tx - 2, 29, tw + 4, 7, "#2a0f10");
        g.text("NEEDS YOU", tx, 30, "#ff9b93");
      }
    }

    function nap(g, t) {
      g.alpha(0.35, () => g.rect(0, 0, W, H, "#05070a"));
      g.alpha(0.07, () => g.circ(158, 84, 22, "#ffcf7a"));
      // sign on a nail
      g.px(160, 13, "#c9ced6"); g.line(160, 13, 143, 20, "#8a6a52"); g.line(160, 13, 177, 20, "#8a6a52");
      g.rect(138, 20, 45, 11, "#4e3322"); g.rect(139, 21, 43, 9, "#7a5236"); g.rect(139, 21, 43, 1, "#8f6342");
      g.text("ALL QUIET", 160, 23, "#f3efe6", { align: "center" });
      // beanbag, sleeper, then the front of the bag so the Claude sinks in
      const bag = (front) => {
        for (let dy = -8; dy <= 7; dy++) {
          if (front ? dy < 1 : dy >= 1) continue;
          const w = Math.round(Math.sqrt(1 - (dy / 9) ** 2) * 18);
          g.rect(158 - w, 89 + dy, w * 2 + 1, 1, dy > 4 ? "#52357f" : dy < -5 ? "#8e66d4" : "#7a4fc2");
        }
      };
      bag(false);
      const x = 150, y = 76 + (!env.reduced && Math.sin(t * 1.6) > 0 ? 1 : 0);
      g.sprite("claude", x, y);
      g.rect(x + 6, y + 9, 1, 2, BODY); g.rect(x + 11, y + 9, 1, 2, BODY);
      g.rect(x + 5, y + 10, 2, 1, EYE); g.rect(x + 11, y + 10, 2, 1, EYE);
      bag(true);
      g.px(150, 92, "#9a7ae0"); g.px(165, 93, "#9a7ae0");
      for (let k = 0; k < 3; k++) {
        const p = env.reduced ? [0.15, 0.45, 0.75][k] : ((t + k * 0.9) % 2.7) / 2.7;
        const a = env.reduced ? 1 : p < 0.15 ? p / 0.15 : 1 - Math.max(0, p - 0.6) / 0.4;
        g.alpha(a, () => g.text("Z", 168 + p * 10 + Math.sin(p * 9) * 2, 80 - p * 30, "#c9d4e6", { scale: p > 0.55 ? 2 : 1 }));
      }
    }

    // One walker per background job, in job order. A job keeps its walker (matched by label) while it runs;
    // walkers of finished jobs disappear and new ones walk in from the left.
    function sync(jobs) {
      const pool = walkers;
      walkers = jobs.map((j, i) => {
        const label = String(j.label || ""), k = pool.findIndex((w) => w.label === label);
        const w = k >= 0 ? pool.splice(k, 1)[0]
          : { label, x: env.reduced ? 40 + ((i * 47) % 240) : -12 - i * 16, tx: null, wait: 0, carry: true, flip: false, speed: 13 + Math.random() * 6 };
        w.kind = JOB_SPRITE[label] || "claude";
        return w;
      });
    }
    function pick(targets, w) {
      const far = targets.filter((x) => Math.abs(x - w.x) > 8), from = far.length ? far : targets;
      return from[Math.floor(Math.random() * from.length)];
    }
    function step(w, targets, dt) {
      if (env.reduced) return;
      if (w.tx == null) w.tx = pick(targets, w);
      if (w.wait > 0) { w.wait -= dt; return; }
      const d = w.tx - w.x;
      if (Math.abs(d) < 0.5) { w.x = w.tx; w.wait = 0.8 + Math.random() * 1.6; w.carry = !w.carry; w.tx = pick(targets, w); return; }
      w.flip = d < 0;
      w.x += Math.sign(d) * Math.min(Math.abs(d), w.speed * dt);
    }
    function walker(g, w, i, t) {
      const moving = !env.reduced && w.wait <= 0 && w.tx != null && Math.abs(w.tx - w.x) >= 0.5;
      const bob = moving && Math.floor(t * 8 + i) % 2 ? 1 : 0;
      const sx = Math.round(w.x - (w.flip ? 12 : 9)), y = WY - bob;
      g.alpha(0.25, () => g.rect(w.x - 7, 97, 14, 1, "#000000"));
      g.sprite(w.kind, sx, y, { flip: w.flip });
      if (w.carry) {
        const px = Math.round(w.x - 4);
        g.rect(px + 1, y + 10, 7, 4, "#d9d2c3"); g.rect(px, y + 11, 7, 4, "#f3efe6");
        g.rect(px + 1, y + 12, 4, 1, "#b8b2a5"); g.rect(px + 1, y + 13, 5, 1, "#b8b2a5");
      }
    }

    function label(g, text, cx, y) {
      const w = g.textWidth(text) + 6, x = Math.max(1, Math.min(W - w - 1, Math.round(cx - w / 2)));
      g.rect(x, y, w, 9, "#e5896a"); g.rect(x + 1, y + 1, w - 2, 7, "#14100d");
      g.text(text, x + 3, y + 2, "#e9ebef");
    }

    function draw(g, env) {
      const d = env.data || {}, t = env.t;
      const runs = list(d.working), jobs = list(d.jobs), needs = Math.max(0, Number(d.needs) || 0);
      const n = Math.min(MAX, runs.length), extra = runs.length - n;
      const sw = n ? Math.min(58, Math.floor(268 / n)) : 0, left = 26 + (268 - sw * n) / 2;
      const xs = [];
      for (let i = 0; i < n; i++) xs.push(Math.round(left + sw * (i + 0.5)));

      g.ctx.drawImage(background(), 0, 0);
      clock(g);
      sync(jobs);
      if (!runs.length && !jobs.length) nap(g, t);
      xs.forEach((cx, i) => { desk(g, cx, i, runs[i].kind, t); env.hit("run:" + i, cx - 20, 55, 40, 37); });
      if (extra > 0) more(g, extra);
      const targets = xs.length ? xs.map((x) => x + 1).concat([CAB, SHELF]) : [CAB, 110, 210, SHELF];
      walkers.forEach((w) => step(w, targets, env.dt || 0));
      walkers.forEach((w, i) => { walker(g, w, i, t); env.hit("job:" + i, w.x - 8, WY + 3, 17, 14); });
      if (needs > 0) alarm(g, xs.length ? xs[0] + 19 : 160, t);

      const [kind, idx] = String(env.hover || "").split(":"), i = Number(idx);
      if (kind === "run" && runs[i] && xs[i] != null) {
        const r = runs[i], pre = RUN_KIND[r.kind] ? RUN_KIND[r.kind] + ": " : "";
        label(g, pre + (clean(r.title, 44) || "CHAT"), xs[i], 45);
      } else if (kind === "job" && walkers[i]) label(g, clean(walkers[i].label, 30) || "AGENT", walkers[i].x, WY - 8);
    }

    return { size: [W, H], bg: "#17110b", draw };
  });
})();
