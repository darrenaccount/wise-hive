/* Library tab: the Librarian walks the stacks, pulls books and reshelves them, rolling the ladder
   over for the high shelves. update({busy, job}): busy speeds everything up and floats books from the
   cart onto the shelves; job "Organizer" brings the Organizer in to help sort the bottom shelves. */
(function () {
  "use strict";
  if (!window.Pixel) return;

  // An offscreen canvas with the same basic helpers as g; repaint() clears and redraws it.
  function surface(w, h, paint) {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const x = c.getContext("2d");
    const p = {
      rect(a, b, ww, hh, col) { x.fillStyle = col; x.fillRect(Math.round(a), Math.round(b), Math.round(ww), Math.round(hh)); },
      px(a, b, col) { x.fillStyle = col; x.fillRect(Math.round(a), Math.round(b), 1, 1); },
      circ(cx, cy, r, col) { x.fillStyle = col; for (let y = -r; y <= r; y++) { const w = Math.round(Math.sqrt(r * r - y * y)); x.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2 + 1, 1); } },
      alpha(al, fn) { x.save(); x.globalAlpha = al; fn(); x.restore(); },
    };
    const repaint = () => { x.clearRect(0, 0, w, h); paint(p); };
    repaint();
    return { canvas: c, repaint };
  }

  const BOOK = [ // spine, shade
    ["#8e3b3b", "#6a2a2a"], ["#3e5f8a", "#2c4566"], ["#4f7a4a", "#385a35"], ["#b08a3e", "#86682c"],
    ["#6b4a8a", "#4f3668"], ["#2f6f6a", "#21514d"], ["#a65a2a", "#7c421e"], ["#d8cfb8", "#aaa08a"],
    ["#5a3a2a", "#40291d"], ["#2a3a5a", "#1c2840"], ["#9a4a6a", "#73354f"], ["#c4b04a", "#958535"],
  ];
  const W = 320, H = 110, FEET = 107, UX = 4, UW = 52, UNITS = 6;
  const ROWS = [11, 28, 45, 62, 79], RH = 15, LOW = 4; // shelf rows: top y, inner height; LOW is reachable from the floor
  const bottom = (r) => ROWS[r] + RH;
  const CART = [10, 50], DESK = [230, 286], LAMPS = [110, 214];
  const DECOR = { "1,0": "globe", "3,2": "plant", "5,1": "hourglass", "0,1": "jar", "4,3": "stack", "2,0": "stack" };
  const HAND = { librarian: [6, -9, -8], organizer: [7, -10, -12] }; // held item: x facing right, x facing left, y from feet
  const WALK = 22, CLIMB = 20;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  Pixel.register("library", (env) => {
    let seq = 0;
    const rnd = () => env.noise(++seq * 3.71 + 0.21);
    const rint = (n) => Math.floor(rnd() * n);

    // Every book position on every shelf. A slot keeps its place and width; the book in it moves.
    const slots = [], decor = [];
    for (let u = 0; u < UNITS; u++) {
      for (let r = 0; r < ROWS.length; r++) {
        const x0 = UX + u * UW + 3, x1 = UX + (u + 1) * UW - 3, d = DECOR[u + "," + r], dx = x0 + 8 + ((u * 7) % 22);
        let x = x0, placed = !d;
        while (x < x1) {
          if (!placed && x >= dx) { decor.push({ type: d, x, r }); placed = true; x += 10; continue; }
          const w = 2 + rint(3);
          if (x + w > x1) break;
          const blocked = r === LOW && ((x + w > CART[0] && x < CART[1]) || (x + w > DESK[0] && x < DESK[1]));
          slots.push({ x, w, r, cx: x + w / 2, h: 7 + rint(7), c: rint(BOOK.length), band: rnd() < 0.3 ? 1 + (rnd() < 0.3 ? 1 : 0) : 0, filled: true, res: false, blocked });
          x += w + (rnd() < 0.05 ? 1 : 0);
        }
      }
    }
    {
      const open = slots.filter((s) => !s.blocked);
      for (let i = 0, made = 0; made < 11 && i < 400; i++) {
        const s = open[rint(open.length)];
        if (!s.filled || (made < 3 && s.r !== LOW)) continue;
        s.filled = false; made++;
      }
    }
    const take = (s) => ({ h: s.h, c: s.c, band: s.band });
    const place = (s, b) => { Object.assign(s, b); s.filled = true; booksDirty = true; };

    const paintBook = (p, x, y, w, h, b) => {
      const [c, d] = BOOK[b.c];
      p.rect(x, y, w, h, c); p.rect(x + w - 1, y, 1, h, d);
      if (b.band) { p.rect(x, y + 2, w, 1, "#d9b44a"); if (b.band > 1) p.rect(x, y + h - 3, w, 1, "#d9b44a"); }
    };

    const shell = surface(W, H, (p) => {
      p.rect(0, 0, W, H, "#1a110c");
      p.rect(0, 0, W, 5, "#120c08"); p.rect(0, 4, W, 1, "#2a1c13");
      for (let u = 0; u < UNITS; u++) {
        const x0 = UX + u * UW;
        p.rect(x0, 10, UW, 86, "#1d130d");
        for (let x = x0 + 9; x < x0 + UW - 3; x += 9) p.rect(x, 10, 1, 86, "#181009");
        for (let r = 0; r < ROWS.length; r++) {
          const b = bottom(r);
          p.rect(x0 + 3, ROWS[r], UW - 6, 2, "#130b07");
          p.rect(x0, b, UW, 2, "#6b4426"); p.rect(x0, b, UW, 1, "#80542f");
        }
        p.rect(x0, 10, 3, 86, "#5a3920"); p.rect(x0, 10, 1, 86, "#6e4828");
        p.rect(x0 + UW - 3, 10, 3, 86, "#5a3920"); p.rect(x0 + UW - 1, 10, 1, 86, "#46301b");
        p.rect(x0 - 1, 5, UW + 2, 6, "#4a2f1b"); p.rect(x0 - 1, 5, UW + 2, 1, "#5e3c22"); p.rect(x0 - 1, 10, UW + 2, 1, "#2a1a0f");
        p.rect(x0, 96, UW, 3, "#3a2416"); p.rect(x0, 96, UW, 1, "#4a2f1b");
      }
      p.rect(UX, 8, UNITS * UW, 1, "#b8923a");
      for (let x = UX + 12; x < UX + UNITS * UW; x += 26) p.rect(x, 7, 1, 3, "#8a6a2a");
      // floor planks and a runner rug
      p.rect(0, 99, W, H - 99, "#3d2819"); p.rect(0, 99, W, 1, "#4a3220");
      for (const [y, off] of [[102, 0], [105, 11], [108, 5]]) { p.rect(0, y, W, 1, "#2f1f14"); for (let x = off; x < W; x += 23) p.rect(x, y - 2, 1, 2, "#2f1f14"); }
      p.rect(96, 101, 128, 7, "#6a1f26"); p.rect(98, 102, 124, 1, "#b8923a"); p.rect(98, 106, 124, 1, "#b8923a");
      p.rect(98, 103, 124, 3, "#7e2730");
      for (let x = 97; x < 224; x += 2) { p.px(x, 100, "#8a6a4a"); p.px(x, 108, "#8a6a4a"); }
      // a few things that aren't books
      for (const o of decor) {
        const b = bottom(o.r), x = o.x;
        if (o.type === "globe") { p.rect(x + 1, b - 1, 7, 1, "#b8923a"); p.rect(x + 4, b - 3, 1, 2, "#8a6a2a"); p.circ(x + 4, b - 7, 3, "#3e6fb0"); p.px(x + 3, b - 8, "#3fa06b"); p.rect(x + 4, b - 7, 2, 2, "#3fa06b"); p.px(x + 3, b - 9, "#8fb8e8"); }
        if (o.type === "plant") { p.rect(x + 2, b - 4, 5, 4, "#a65a2a"); p.rect(x + 2, b - 4, 5, 1, "#c4743a"); for (const [dx, dy] of [[1, -6], [2, -7], [4, -9], [4, -8], [5, -7], [6, -6], [7, -7], [3, -6], [5, -6]]) p.px(x + dx, b + dy, dy < -7 ? "#5cc28a" : "#3fa06b"); }
        if (o.type === "hourglass") { p.rect(x + 1, b - 11, 7, 1, "#8a5a32"); p.rect(x + 1, b - 1, 7, 1, "#8a5a32"); p.rect(x + 2, b - 10, 1, 9, "#6b4426"); p.rect(x + 6, b - 10, 1, 9, "#6b4426"); p.rect(x + 3, b - 10, 3, 3, "#cfe3f0"); p.px(x + 4, b - 7, "#cfe3f0"); p.rect(x + 3, b - 5, 3, 3, "#cfe3f0"); p.rect(x + 3, b - 4, 3, 2, "#e0c070"); }
        if (o.type === "jar") { p.rect(x + 2, b - 8, 5, 8, "#4d7a78"); p.rect(x + 2, b - 9, 5, 1, "#8a6a2a"); p.px(x + 3, b - 7, "#9fd0cc"); p.rect(x + 3, b - 4, 3, 3, "#e9b949"); }
        if (o.type === "stack") { p.rect(x, b - 2, 9, 2, "#8e3b3b"); p.rect(x + 1, b - 4, 8, 2, "#3e5f8a"); p.rect(x, b - 6, 8, 2, "#b08a3e"); p.rect(x, b - 2, 9, 1, "#a54848"); }
      }
    });

    const books = surface(W, H, (p) => {
      for (const s of slots) if (s.filled) paintBook(p, s.x, bottom(s.r) - s.h, s.w, s.h, s);
    });
    let booksDirty = false;

    // Cart, desk, lanterns and the edge vignette sit in front of the shelves and the ladder.
    const props = surface(W, H, (p) => {
      // book cart
      p.rect(13, 80, 2, 21, "#5a371d"); p.rect(45, 80, 2, 21, "#5a371d"); p.rect(45, 80, 6, 1, "#5a371d"); p.rect(50, 77, 1, 4, "#5a371d");
      p.rect(12, 88, 36, 2, "#6e4526"); p.rect(12, 88, 36, 1, "#8a5a32");
      p.rect(12, 96, 36, 2, "#6e4526"); p.rect(12, 96, 36, 1, "#8a5a32");
      for (let x = 16, i = 0; x < 43; i++) { const w = 2 + (i % 3 === 1 ? 1 : 0), h = 5 + ((i * 5) % 4); paintBook(p, x, 88 - h, w, h, { c: (i * 5 + 2) % BOOK.length, band: i % 4 === 0 ? 1 : 0 }); x += w; }
      p.rect(15, 94, 11, 2, "#3e5f8a"); p.rect(16, 92, 10, 2, "#8e3b3b"); p.rect(29, 94, 13, 2, "#4f7a4a"); p.rect(30, 92, 11, 2, "#b08a3e");
      for (const wx of [17, 43]) { p.circ(wx, 101, 2, "#221c18"); p.px(wx, 101, "#8a8a8a"); }
      // reading desk with a candle, an open book and an inkwell
      p.rect(232, 86, 52, 3, "#6e4526"); p.rect(232, 86, 52, 1, "#8a5a32");
      p.rect(234, 89, 48, 4, "#5a371d"); p.rect(256, 90, 4, 1, "#c9a23a");
      p.rect(235, 93, 3, 8, "#4a2d18"); p.rect(278, 93, 3, 8, "#4a2d18");
      p.rect(251, 85, 21, 1, "#7a2f2f");
      p.rect(252, 82, 9, 3, "#efe6cf"); p.rect(262, 82, 9, 3, "#efe6cf"); p.rect(261, 82, 1, 3, "#b9ae92");
      for (const y of [83, 84]) { p.rect(253, y, 6, 1, "#c9bfa4"); p.rect(263, y, 6, 1, "#c9bfa4"); }
      p.rect(238, 85, 7, 1, "#c9a23a"); p.rect(240, 79, 3, 6, "#efe6cf"); p.px(242, 79, "#cfc4a8"); p.px(241, 78, "#3a2a1a");
      p.rect(274, 83, 3, 3, "#1d1a18"); p.px(274, 83, "#3a3f50");
      for (let i = 0; i < 6; i++) p.px(276 + i * 0.6, 83 - i, "#e9e2cc");
      // hanging lanterns (their light is animated)
      for (const lx of LAMPS) {
        for (let y = 0; y < 13; y += 2) p.px(lx, y, "#8a7a5a");
        p.rect(lx - 3, 13, 7, 2, "#b8923a"); p.rect(lx - 2, 15, 5, 6, "#ffd27a"); p.rect(lx - 3, 15, 1, 6, "#8a6a2a"); p.rect(lx + 3, 15, 1, 6, "#8a6a2a");
        p.rect(lx - 2, 21, 5, 1, "#b8923a"); p.px(lx, 22, "#8a6a2a"); p.rect(lx, 17, 1, 2, "#fff3c4");
      }
      for (let i = 0; i < 26; i++) p.alpha(0.4 * (1 - i / 26), () => { p.rect(i, 0, 1, H, "#000000"); p.rect(W - 1 - i, 0, 1, H, "#000000"); });
      for (let i = 0; i < 8; i++) p.alpha(0.35 * (1 - i / 8), () => p.rect(0, i, W, 1, "#000000"));
    });

    const ladder = { x: 128 };
    const newAgent = (k, x, plan) => ({ k, x, y: FEET, dir: 1, steps: [], plan, hand: null, fly: null, say: null, moving: false, climbing: false });
    const lib = newAgent("librarian", 168, planLib);
    let org = null, flyers = [], nextFly = 0;

    // Picks a slot from `list`, favouring ones near x (at least minD away).
    function near(list, x, minD) {
      let best = null, score = Infinity;
      for (let i = 0; i < 14 && list.length; i++) {
        const s = list[rint(list.length)], d = Math.abs(s.cx - x);
        if (d < minD) continue;
        const sc = d + rnd() * 90;
        if (sc < score) { score = sc; best = s; }
      }
      return best;
    }
    function planLib(a) {
      const free = (s) => !s.blocked && !s.res, low = rnd() < 0.55;
      const src = near(slots.filter((s) => s.filled && free(s) && (!low || s.r === LOW)), a.x, 0) || near(slots.filter((s) => s.filled && free(s)), a.x, 0);
      const dst = src && near(slots.filter((s) => !s.filled && free(s)), src.cx, 14);
      if (!dst) return [{ k: "wait", d: 1 }];
      src.res = dst.res = true;
      const say = rnd() < 0.3 ? ["HMM", "♪", "THERE", "AH"][rint(4)] : null;
      return [{ k: "reach", slot: src, act: "pull", d: 0.7 }, { k: "reach", slot: dst, act: "put", d: 0.6 }, { k: "wait", d: 0.8 + rnd() * 1.4, say }];
    }
    function planOrg(a) {
      const pool = slots.filter((s) => s.r === LOW && s.filled && !s.blocked && !s.res);
      const A = near(pool, a.x, 0), B = A && near(pool.filter((s) => s !== A), A.cx, 10);
      if (!B) return [{ k: "wait", d: 0.8 }];
      A.res = B.res = true; a.task = { A, B };
      return [{ k: "reach", slot: A, act: "pull", d: 0.5, keep: true }, { k: "reach", slot: B, act: "swap", d: 0.6 }, { k: "reach", slot: A, act: "put", d: 0.5 }, { k: "wait", d: 0.3 + rnd() * 0.6 }];
    }
    const ladderSpot = (s) => clamp(s.cx + 9 > UX + UNITS * UW - 6 ? s.cx - 9 : s.cx + 9, UX + 6, UX + UNITS * UW - 6);
    // Turns "reach this slot" into concrete moves, using the ladder for the high shelves.
    function expand(a, s) {
      const slot = s.slot, act = { k: s.act, slot, d: s.d, keep: s.keep };
      if (slot.r === LOW || a.k !== "librarian") return [{ k: "walk", x: clamp(slot.cx + (a.x < slot.cx ? -7 : 7), 8, W - 8) }, act];
      const lx = ladderSpot(slot), out = [];
      if (Math.abs(lx - ladder.x) > 1) { const side = lx > ladder.x ? -1 : 1; out.push({ k: "walk", x: ladder.x + side * 9 }, { k: "push", x: lx }); }
      out.push({ k: "walk", x: lx }, { k: "climb", y: bottom(slot.r) + 2 }, act, { k: "climb", y: FEET });
      return out;
    }
    const slotPt = (s) => ({ x: s.cx - 1, y: bottom(s.r) - Math.min(s.h, 9) });
    function handPt(a, dy = 0) {
      const [xr, xl, yo] = HAND[a.k], flip = facing(a);
      return { x: a.x + (flip ? xl : xr), y: a.y + yo + dy };
    }
    const facing = (a) => (a.climbing ? Math.floor(env.t * 6) % 2 === 0 : a.dir < 0);

    function begin(a, s) {
      if (s.k === "pull") { a.fly = { b: take(s.slot), slot: s.slot, out: true, p: 0 }; s.slot.filled = false; booksDirty = true; }
      if (s.k === "put") { a.fly = { b: a.hand, slot: s.slot, out: false, p: 0 }; a.hand = null; }
    }
    function end(a, s) {
      const sl = s.slot;
      if (s.k === "pull") { a.hand = a.fly.b; a.fly = null; if (!s.keep) sl.res = false; }
      if (s.k === "put") {
        place(sl, a.fly.b); a.fly = null; sl.res = false;
        if (a.task && a.task.A === sl) a.task = null;
        if (rnd() < 0.45) env.burst(sl.cx, bottom(sl.r) - 3, { n: 6, colors: ["#8a7b66", "#6d604f", "#a89a86"], speed: 10, life: 0.7, gravity: -6 });
      }
      if (s.k === "swap") {
        const b = take(sl); place(sl, a.hand); a.hand = b; sl.res = false;
        env.burst(sl.cx, bottom(sl.r) - 4, { n: 4, colors: ["#5cc28a", "#e9b949"], speed: 12, life: 0.4, gravity: 0 });
      }
    }
    // Advances one step; returns true when the step used up this frame's time.
    function act(a, s, dt) {
      switch (s.k) {
        case "walk": {
          const dx = s.x - a.x;
          if (Math.abs(dx) < 0.5) { a.x = s.x; s.done = true; return false; }
          a.dir = Math.sign(dx); a.x += a.dir * Math.min(Math.abs(dx), WALK * dt); a.moving = true; return true;
        }
        case "push": {
          const dx = s.x - ladder.x;
          if (Math.abs(dx) < 0.5) { ladder.x = s.x; s.done = true; return false; }
          a.dir = Math.sign(dx); ladder.x += a.dir * Math.min(Math.abs(dx), WALK * 0.7 * dt); a.x = ladder.x - a.dir * 9; a.moving = true; return true;
        }
        case "climb": {
          const dy = s.y - a.y;
          if (Math.abs(dy) < 0.5) { a.y = s.y; s.done = true; return false; }
          a.y += Math.sign(dy) * Math.min(Math.abs(dy), CLIMB * dt); a.climbing = true; return true;
        }
        case "pull": case "put": case "swap": {
          if (s.t == null) { s.t = 0; begin(a, s); }
          if (Math.abs(s.slot.cx - a.x) > 1) a.dir = s.slot.cx < a.x ? -1 : 1;
          s.t += dt;
          if (a.fly) a.fly.p = Math.min(1, s.t / s.d);
          if (s.t >= s.d) { end(a, s); s.done = true; }
          return true;
        }
        case "wait": {
          if (s.t == null) { s.t = 0; a.say = s.say ? { w: s.say, t0: env.t } : null; }
          s.t += dt;
          if (s.t >= s.d) { s.done = true; a.say = null; }
          return true;
        }
        case "gone": a.gone = true; s.done = true; return true;
      }
      s.done = true; return false;
    }
    function run(a, dt) {
      a.moving = a.climbing = false;
      for (let guard = 0; guard < 10; guard++) {
        if (!a.steps.length) { if (a.leaving) return; a.steps = a.plan(a); }
        const s = a.steps[0];
        if (s.k === "reach") { a.steps.splice(0, 1, ...expand(a, s)); continue; }
        const used = act(a, s, dt);
        if (s.done) a.steps.shift();
        if (used) return;
      }
    }
    // The job ended: put back whatever the Organizer was holding and walk off.
    function dismiss(a) {
      a.leaving = true; a.say = null;
      if (a.fly) { place(a.fly.slot, a.fly.b); a.fly = null; }
      if (a.hand && a.task) { place(a.task.A, a.hand); a.hand = null; }
      if (a.task) { a.task.A.res = a.task.B.res = false; a.task = null; }
      a.steps = [{ k: "walk", x: W + 14 }, { k: "gone" }];
    }
    function spawnFlyer(t) {
      const pool = slots.filter((s) => s.filled && !s.res && !s.blocked);
      if (!pool.length) return;
      const s = pool[rint(pool.length)];
      s.res = true;
      let c = rint(BOOK.length); if (c === s.c) c = (c + 1) % BOOK.length;
      flyers.push({ s, b: { h: s.h, c, band: rint(3) === 0 ? 1 : 0 }, x0: 18 + rint(24), y0: 82, t0: t, dur: 0.8 + rnd() * 0.5 });
    }
    function flyerAt(f, p) {
      const to = slotPt(f.s);
      return { x: f.x0 + (to.x - f.x0) * p, y: f.y0 + (to.y - f.y0) * p - Math.sin(p * Math.PI) * 22 };
    }
    function tick(t, dt, busy, helper) {
      const k = busy ? 2.2 : 1;
      run(lib, dt * k);
      if (helper && !org) { org = newAgent("organizer", W + 14, planOrg); org.dir = -1; org.steps = [{ k: "walk", x: 270 }]; }
      if (org) {
        if (!helper && !org.leaving) dismiss(org);
        run(org, dt * k);
        if (org.gone) org = null;
      }
      if (busy && t >= nextFly) { spawnFlyer(t); nextFly = t + 0.35 + rnd() * 0.3; }
      flyers = flyers.filter((f) => {
        if (t - f.t0 < f.dur) return true;
        place(f.s, f.b); f.s.res = false;
        env.burst(f.s.cx, bottom(f.s.r) - f.s.h, { n: 6, colors: ["#fff3c4", "#e9b949"], speed: 16, life: 0.5, gravity: 0 });
        return false;
      });
    }

    // Soft additive light: concentric discs cached as a sprite, drawn with "lighter".
    const glows = new Map();
    function glow(g, x, y, r, col, a, rings = 1) {
      const key = r + col + rings;
      if (!glows.has(key)) glows.set(key, surface(r * 2 + 1, r * 2 + 1, (p) => { for (let k = 0; k < rings; k++) p.alpha(1 / rings, () => p.circ(r, r, Math.round(r * (1 - k / rings)), col)); }).canvas);
      const s = glows.get(key);
      g.alpha(a, () => { g.ctx.globalCompositeOperation = "lighter"; g.ctx.drawImage(s, Math.round(x) - r, Math.round(y) - r); });
    }
    function heldBook(g, x, y, b) {
      const [c, d] = BOOK[b.c];
      g.rect(x, y, 3, 5, c); g.rect(x + 2, y, 1, 5, d);
      if (b.band) g.rect(x, y + 1, 3, 1, "#d9b44a");
    }
    function drawLadder(g) {
      const x = Math.round(ladder.x);
      g.alpha(0.3, () => g.rect(x + 6, 9, 2, 87, "#000000"));
      for (const rx of [x - 5, x + 4]) { g.rect(rx, 8, 2, 95, "#8a5a32"); g.rect(rx, 8, 1, 95, "#a06c3e"); }
      for (let y = 14; y < 100; y += 6) g.rect(x - 3, y, 7, 1, "#7a4e2a");
      g.rect(x - 6, 6, 3, 2, "#c9a23a"); g.rect(x + 4, 6, 3, 2, "#c9a23a");
      g.rect(x - 6, 103, 3, 2, "#221c18"); g.rect(x + 4, 103, 3, 2, "#221c18");
    }
    function drawAgent(g, a, t, still) {
      const flip = facing(a), dy = !still && a.moving ? -(Math.floor(t * 8) % 2) : 0;
      const top = a.y - 16 + dy;
      g.sprite(a.k, a.x - (flip ? 12 : 9), top, { flip });
      env.hit(a.k, a.x - 8, top + 1, 17, 15);
      const h = handPt(a, dy);
      if (a.hand) heldBook(g, h.x, h.y, a.hand);
      if (a.fly) {
        const sp = slotPt(a.fly.slot), p = a.fly.out ? a.fly.p : 1 - a.fly.p;
        heldBook(g, sp.x + (h.x - sp.x) * p, sp.y + (h.y - sp.y) * p - Math.sin(p * Math.PI) * 4, a.fly.b);
      }
      if (a.say && env.hover !== a.k) {
        const tw = g.textWidth(a.say.w), w = tw + 6, bx = clamp(Math.round(a.x - w / 2), 1, W - w - 1), by = Math.max(1, top - 11);
        g.bubble(bx, by, w, 9, { tx: clamp(Math.round(a.x) - 1, bx + 2, bx + w - 4) });
        g.text(a.say.w, bx + 3, by + 2, "#2b2f37");
      }
    }
    function label(g, name, cx, top) {
      const tw = g.textWidth(name), x = clamp(Math.round(cx - tw / 2) - 2, 1, W - tw - 5), y = clamp(top - 10, 1, H - 10);
      g.alpha(0.85, () => g.rect(x, y, tw + 4, 9, "#0b0d16"));
      g.rect(x, y + 8, tw + 4, 1, "#b8892a");
      g.text(name, x + 2, y + 2, "#f6e7b8");
    }

    function draw(g, env) {
      const t = env.t, d = env.data || {}, busy = !!d.busy, helper = busy && d.job === "Organizer", still = env.reduced;
      if (still) {
        if (!lib.hand) { lib.hand = { h: 10, c: 1, band: 1 }; lib.x = 168; }
        if (helper && !org) { org = newAgent("organizer", 196, planOrg); org.dir = -1; }
        if (!helper && org) org = null;
      } else tick(t, Math.min(env.dt || 0, 0.1), busy, helper);
      if (booksDirty) { books.repaint(); booksDirty = false; }

      const ctx = g.ctx;
      ctx.drawImage(shell.canvas, 0, 0);
      ctx.drawImage(books.canvas, 0, 0);
      drawLadder(g);
      ctx.drawImage(props.canvas, 0, 0);

      // lamplight, a little brighter while the job runs
      LAMPS.forEach((lx, i) => {
        const f = still ? 0 : env.noise(Math.floor(t * 8) + i * 50) * 2;
        glow(g, lx, 18, 38 + Math.round(f), "#f2a33a", busy ? 0.42 : 0.32, 10);
        glow(g, lx, 18, 9, "#ffe3a0", 0.2, 3);
        g.alpha(0.06, () => { g.ctx.globalCompositeOperation = "lighter"; g.rect(lx - 34, 101, 68, 6, "#f7b860"); g.rect(lx - 22, 100, 44, 8, "#f7b860"); });
      });
      const cn = still ? 0.6 : env.noise(Math.floor(t * 9) + 7);
      glow(g, 241, 75, 14, "#f2a33a", 0.25, 6); glow(g, 241, 76, 5, "#ffd88a", 0.2, 2);
      g.rect(241, 76, 1, 2, "#f7a531"); g.px(241, 77, "#ffe9a8");
      if (cn > 0.35) g.px(241 + (cn > 0.85 ? 1 : 0), 75, "#ffd27a");

      // books floating from the cart while busy
      for (const f of flyers) {
        const p = clamp((t - f.t0) / f.dur, 0, 1), at = flyerAt(f, p);
        for (let k = 1; k <= 3; k++) {
          const q = p - k * 0.06; if (q <= 0) break;
          const tr = flyerAt(f, q);
          g.alpha(0.7 - k * 0.18, () => g.px(tr.x + 1, tr.y + 2, k % 2 ? "#e9b949" : "#fff3c4"));
        }
        heldBook(g, at.x, at.y, f.b);
        if (Math.floor(t * 10 + f.t0 * 3) % 3 === 0) { g.px(at.x - 1, at.y - 1, "#fff3c4"); g.px(at.x + 3, at.y - 1, "#fff3c4"); }
      }

      const agents = org ? [org, lib] : [lib];
      for (const a of agents) drawAgent(g, a, t, still);
      if (env.hover === "librarian") label(g, "LIBRARIAN", lib.x, lib.y - 16);
      if (env.hover === "organizer" && org) label(g, "ORGANIZER", org.x, org.y - 16);
    }

    return { size: [W, H], bg: "#120c08", draw };
  });
})();
