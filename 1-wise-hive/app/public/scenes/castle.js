/* Home tab: Queen Claude's throne room. The team sits around the round table and chats, the
   Messenger carries scrolls up to the throne, and the queen's aura brightens while the hive is busy.
   update({busy, stats}). Hit ids are mascot kinds ("queen" for the queen). */
(function () {
  "use strict";
  if (!window.Pixel) return;

  // Static art is painted once into an offscreen canvas, with the same basic helpers as g.
  function layer(w, h, paint) {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const x = c.getContext("2d");
    const p = {
      rect(a, b, ww, hh, col) { x.fillStyle = col; x.fillRect(Math.round(a), Math.round(b), Math.round(ww), Math.round(hh)); },
      px(a, b, col) { x.fillStyle = col; x.fillRect(Math.round(a), Math.round(b), 1, 1); },
      line(x0, y0, x1, y1, col) {
        x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
        const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
        let err = dx + dy; x.fillStyle = col;
        for (let i = 0; i < 2000; i++) { x.fillRect(x0, y0, 1, 1); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } }
      },
      circ(cx, cy, r, col) { x.fillStyle = col; for (let y = -r; y <= r; y++) { const w = Math.round(Math.sqrt(r * r - y * y)); x.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2 + 1, 1); } },
      alpha(al, fn) { x.save(); x.globalAlpha = al; fn(); x.restore(); },
      // Paint in room coordinates (the room art is laid out for a 320-wide hall, centred in the buffer).
      room(fn) { x.save(); x.translate(OX, 0); fn(); x.restore(); },
    };
    paint(p);
    return c;
  }
  const hex = (c, i) => parseInt(c.slice(1 + i * 2, 3 + i * 2), 16);
  const mix = (a, b, t) => "#" + [0, 1, 2].map((i) => Math.round(hex(a, i) + (hex(b, i) - hex(a, i)) * t).toString(16).padStart(2, "0")).join("");
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  // Half-width of an arch-topped shape (radius r, top edge at `top`) on row y.
  const archW = (r, top, y) => (y < top ? 0 : y >= top + r ? r : Math.round(Math.sqrt(Math.max(0, r * r - (top + r - y - 0.5) ** 2))));

  // Buffer size. The room art (walls, windows, throne) is drawn for a 320-wide hall shifted right by OX;
  // everything else (table, team, candles, STEP) uses buffer coordinates with the centre at CX.
  const W = 352, H = 176, FLOOR = 92, RW = 320, OX = (W - RW) / 2, CX = W / 2;
  // The round table: centre, half-width and half-depth of the top.
  const TCX = CX, TCY = 136, TRX = 74, TRY = 14;
  // Seats around the table: x is the body's centre column, y the feet line. Every member has a name
  // tag under its feet, so neighbouring tags/sprites were checked for overlap (longest names on the ends).
  const TEAM = [
    // behind the table (tags sit on the far edge of the table top)
    { k: "critic", n: "Critic", x: 108, y: 125, say: ["BUG!", "NO.", "HMM"] },
    { k: "builder", n: "Builder", x: 142, y: 122, say: ["BUILD", "ON IT"] },
    { k: "modeler", n: "Modeler", x: 176, y: 120, say: ["3D!", "MESH"] },
    { k: "refiner", n: "Refiner", x: 209, y: 122, say: ["MORE!", "CLEARER"] },
    { k: "messenger", n: "Messenger", x: 245, y: 125, say: ["NEWS!", "UPDATE"] },
    // the two ends of the table
    { k: "librarian", n: "Librarian", x: 76, y: 135, say: ["NOTED", "FILED"] },
    { k: "organizer", n: "Organizer", x: 277, y: 135, say: ["SORTED", "TIDY"] },
    { k: "researcher", n: "Researcher", x: 52, y: 159, say: ["HMM", "FOUND IT", "LOOK"] },
    { k: "clarifier", n: "Clarifier", x: 300, y: 159, say: ["?", "WHY?"] },
    // in front of the table, leaving the pedestal in view
    { k: "reviewer", n: "Reviewer", x: 104, y: 166, say: ["OK!", "CHECK"] },
    { k: "inventor", n: "Inventor", x: 143, y: 167, say: ["IDEA!", "WOW"] },
    { k: "trainer", n: "Trainer", x: 209, y: 167, say: ["AGAIN!", "GO!"] },
    { k: "foreman", n: "Foreman", x: 248, y: 166, say: ["NEXT!", "SHIP IT"] },
  ];
  const CHATTER = ["...", "♪", "WOW", "OK!", "♥", "HA HA", "?", "IDEA!"];
  const MSG = TEAM.findIndex((m) => m.k === "messenger");
  const STEP = { x: 198 + OX, y: 106 }; // where the Messenger stands at the foot of the dais
  // Room coordinates (drawn inside p.room / a translated g):
  const WIN = [{ x: 20, y: 12, w: 28, h: 62 }, { x: 272, y: 12, w: 28, h: 62 }];
  const TORCH = [{ x: 76, y: 40 }, { x: 244, y: 40 }];
  // Buffer coordinates:
  const CANDLE = [{ x: TCX - 50, y: TCY + 5 }, { x: TCX + 49, y: TCY + 5 }];
  const GOLD = "#e9b949", GD = "#b8892a", GL = "#f7d77a", VEL = "#7d1f35", VD = "#5e1628";

  Pixel.register("castle", (env) => {
    let seq = 0;
    const rnd = () => env.noise(++seq * 7.31 + 0.17);
    const pick = (a) => a[Math.floor(rnd() * a.length)];

    const inWin = (wn, x, y) => {
      const r = wn.w / 2 - 2, cx = wn.x + wn.w / 2;
      if (y >= wn.y + wn.h || Math.abs(x + 0.5 - cx) > archW(r, wn.y + 2, y)) return false;
      return x !== cx && y !== wn.y + 36;
    };
    // Moonlight shafts from each window down to the floor (room coordinates).
    const beamAt = (wi, y) => { const k = y - 77, a = 22 + k * 0.28, b = 46 + k * 0.5; return wi ? [RW - b, RW - a] : [a, b]; };

    const STARS = [];
    WIN.forEach((wn, wi) => {
      for (let i = 0, n = 0; i < 80 && n < 13; i++) {
        const x = wn.x + 3 + Math.floor(env.noise(wi * 211 + i) * (wn.w - 6)), y = wn.y + 3 + Math.floor(env.noise(wi * 211 + i + 97) * (wn.h - 18));
        if (!inWin(wn, x, y) || (wi === 0 && Math.abs(x - 40) < 7 && Math.abs(y - 26) < 7)) continue;
        STARS.push({ x, y, s: env.noise(wi * 53 + i * 3.1), big: n % 6 === 2 }); n++;
      }
    });

    const bg = layer(W, H, (p) => {
      // stone wall: mortar, then bricks with a little tone variation
      p.rect(0, 0, W, FLOOR, "#1b1e27");
      for (let row = 0, y = 0; y < FLOOR; row++, y += 7) {
        for (let x = row % 2 ? -8 : 0; x < W; x += 16) {
          const n = env.noise(row * 41.3 + x * 0.37 + 3);
          p.rect(x, y, 15, 6, ["#2a2e3b", "#2c303e", "#272b37", "#2f3341"][Math.floor(n * 4)]);
          p.rect(x, y, 15, 1, "#343949");
          p.rect(x + 14, y + 1, 1, 5, "#232631");
          if (n > 0.9) p.px(x + 3 + Math.floor(n * 50) % 9, y + 3, "#20232c");
        }
      }
      for (let y = 0; y < 30; y++) p.alpha(0.55 * (1 - y / 30), () => p.rect(0, y, W, 1, "#05060a"));
      // floor base and tile rows span the whole buffer
      p.rect(0, FLOOR - 3, W, 3, "#1e2029"); p.rect(0, FLOOR - 3, W, 1, "#30343f");
      p.rect(0, FLOOR, W, H - FLOOR, "#262833");
      for (const y of [95, 99, 104, 110, 117, 125, 134, 144, 155, 167]) { p.rect(0, y, W, 1, "#1c1e27"); p.rect(0, y + 1, W, 1, "#2b2e3a"); }
      p.room(() => {
      // recessed arch behind the throne
      for (let y = 18; y < FLOOR - 3; y++) {
        const hw = archW(32, 18, y);
        if (!hw) continue;
        p.alpha(0.45, () => p.rect(160 - hw, y, hw * 2, 1, "#07080c"));
        p.rect(160 - hw - 2, y, 2, 1, "#3a3f50"); p.rect(160 + hw, y, 2, 1, "#30343f");
      }
      for (let i = 0; i <= 32; i++) {
        const a = Math.PI * (i / 32), x = 160 - Math.cos(a) * 33, y = 50 - Math.sin(a) * 33;
        p.rect(x - 1, y - 1, 2, 2, i % 4 === 0 ? "#30343f" : "#3d4254");
      }
      // windows: stone frame, night sky, hills, moon, leading
      WIN.forEach((wn, wi) => {
        const cx = wn.x + wn.w / 2, R = wn.w / 2, ri = R - 2;
        for (let y = wn.y; y < wn.y + wn.h; y++) { const hw = archW(R, wn.y, y); if (hw) p.rect(cx - hw, y, hw * 2, 1, "#3a3f50"); }
        for (let y = wn.y + 2; y < wn.y + wn.h; y++) {
          const hw = archW(ri, wn.y + 2, y);
          if (hw) p.rect(cx - hw, y, hw * 2, 1, mix("#090e24", "#1d2b58", (y - wn.y) / wn.h));
        }
        for (let x = wn.x + 2; x < wn.x + wn.w - 2; x++) {
          const hy = Math.round(wn.y + wn.h - 5 - 2 * Math.sin(x * 0.33 + wi * 2) - (wi ? 1 : 2));
          p.rect(x, hy, 1, wn.y + wn.h - hy, "#0c1330");
        }
        if (wi === 0) {
          p.alpha(0.18, () => p.circ(40, 26, 7, "#cfd8ff"));
          p.circ(40, 26, 4, "#efe8cc");
          p.px(38, 25, "#d4cbab"); p.px(41, 28, "#d4cbab"); p.px(42, 24, "#d4cbab"); p.px(39, 23, "#fbf6e2");
        } else {
          // a far-off tower
          p.rect(286, 58, 5, 16, "#0a0f26"); p.rect(285, 56, 7, 2, "#0a0f26"); p.px(285, 55, "#0a0f26"); p.px(288, 55, "#0a0f26"); p.px(291, 55, "#0a0f26");
          p.px(288, 61, "#e9b949");
        }
        p.rect(cx, wn.y + 3, 1, wn.h - 3, "#14161d");
        p.rect(wn.x + 2, wn.y + 36, wn.w - 4, 1, "#14161d");
        p.rect(wn.x - 3, wn.y + wn.h, wn.w + 6, 3, "#454a5c"); p.rect(wn.x - 3, wn.y + wn.h, wn.w + 6, 1, "#575d70");
        p.rect(wn.x - 3, wn.y + wn.h + 3, wn.w + 6, 1, "#171920");
      });
      // banners with a gold crown
      for (const bx of [100, 202]) {
        p.rect(bx - 3, 5, 24, 2, "#c9a23a"); p.rect(bx - 5, 4, 2, 4, GOLD); p.rect(bx + 21, 4, 2, 4, GOLD);
        for (let y = 7; y < 62; y++) {
          const k = y > 52 ? y - 52 : 0;
          const seg = k ? [[bx, 9 - k], [bx + 9 + k, 9 - k]] : [[bx, 18]];
          for (const [sx, sw] of seg) { if (sw > 0) p.rect(sx, y, sw, 1, "#5b3a9a"); }
          p.rect(bx, y, 2, 1, "#47307e"); if (!k || 9 - k > 2) p.px(bx + 17, y, "#3e2870");
        }
        for (const fx of [bx + 6, bx + 12]) p.alpha(0.5, () => p.rect(fx, 8, 1, 44, "#6c49b0"));
        p.rect(bx + 2, 9, 1, 43, "#c9a23a"); p.rect(bx + 15, 9, 1, 43, "#c9a23a"); p.rect(bx + 2, 10, 14, 1, "#c9a23a"); p.rect(bx + 2, 51, 14, 1, "#c9a23a");
        const CROWN = ["#...#...#", "#..###..#", "##.###.##", "#########", "#########"];
        CROWN.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === "#") p.px(bx + 5 + c, 22 + r, r === 0 ? GL : GOLD); }));
        p.rect(bx + 5, 27, 9, 1, GD);
        p.px(bx + 9, 25, "#d64545"); p.px(bx + 6, 25, "#4aa3df"); p.px(bx + 12, 25, "#4aa3df");
        for (let i = 0; i < 3; i++) { p.rect(bx + 9 - i, 34 + i, 1 + i * 2, 1, GOLD); p.rect(bx + 9 - i, 40 - i, 1 + i * 2, 1, GOLD); }
      }
      // torch brackets (flames are animated)
      for (const tc of TORCH) {
        p.rect(tc.x - 2, tc.y + 8, 5, 7, "#2b2c33"); p.px(tc.x, tc.y + 13, "#4a4b55");
        p.rect(tc.x - 1, tc.y + 2, 3, 10, "#6b4423"); p.rect(tc.x - 1, tc.y + 2, 1, 10, "#7d5530");
        p.rect(tc.x - 3, tc.y, 7, 3, "#4a4a55"); p.rect(tc.x - 3, tc.y, 7, 1, "#666673");
      }
      // floor: stone tiles in perspective
      for (let i = -14; i <= 14; i++) { const xb = 160 + i * 30, xt = 160 + (xb - 160) * (FLOOR - 20) / (H - 20); p.line(xt, FLOOR, xb, H - 1, "#1c1e27"); }
      WIN.forEach((wn, wi) => {
        for (let y = wn.y + wn.h + 3; y < H; y++) {
          const [a, b] = beamAt(wi, y);
          p.alpha(y > 128 ? 0.085 : 0.05, () => p.rect(a, y, b - a, 1, "#aebcff"));
        }
      });
      // dais with two steps and the plaque
      p.rect(108, 80, 104, 5, "#4b5062"); p.rect(108, 80, 104, 1, "#5d6377");
      p.rect(108, 85, 104, 12, "#363a49"); p.rect(108, 91, 104, 1, "#2a2d38");
      for (let x = 121; x < 212; x += 26) p.rect(x, 85, 1, 6, "#2a2d38");
      for (let x = 108; x < 212; x += 26) p.rect(x, 92, 1, 5, "#2a2d38");
      p.rect(100, 97, 120, 2, "#454a5b"); p.rect(100, 97, 120, 1, "#585e72");
      p.rect(100, 99, 120, 4, "#2f3340");
      p.alpha(0.45, () => p.rect(100, 103, 120, 2, "#000000"));
      // red carpet from the front of the room up to the dais
      for (let y = 97; y < H; y++) {
        const hw = Math.round(15 + (y - 97) * 0.27), face = y >= 99 && y < 103;
        p.rect(160 - hw, y, hw * 2, 1, face ? "#6a1824" : "#801f2c");
        p.px(160 - hw, y, "#5a1520"); p.px(160 + hw - 1, y, "#5a1520");
        p.px(160 - hw + 2, y, "#c9a23a"); p.px(160 + hw - 3, y, "#c9a23a");
      }
      for (let i = 0; i < 3; i++) { p.rect(160 - i, 106 + i, 1 + i * 2, 1, "#c9a23a"); p.rect(160 - i, 112 - i, 1 + i * 2, 1, "#c9a23a"); }
      p.rect(132, 86, 56, 10, "#c9a23a"); p.rect(133, 87, 54, 8, "#3a2516");
      p.px(133, 87, "#e9b949"); p.px(186, 87, "#e9b949"); p.px(133, 94, "#e9b949"); p.px(186, 94, "#e9b949");
      // throne: gold arch, velvet back, posts, arms and seat
      for (let y = 34; y < 82; y++) {
        const hw = archW(17, 34, y), iw = archW(14, 37, y);
        if (hw) { p.rect(160 - hw, y, hw * 2, 1, GOLD); p.px(160 - hw, y, GL); p.px(160 + hw - 1, y, GD); }
        if (iw) p.rect(160 - iw, y, iw * 2, 1, y < 41 ? VD : VEL);
      }
      for (const [x, y] of [[154, 46], [166, 46], [160, 52], [154, 58], [166, 58], [160, 64]]) p.px(x, y, "#a3354f");
      p.circ(160, 31, 2, GOLD); p.px(159, 30, GL); p.rect(159, 35, 2, 1, "#d64545");
      for (const x of [138, 178]) { p.rect(x, 48, 4, 36, GOLD); p.rect(x, 48, 1, 36, GL); p.rect(x + 3, 48, 1, 36, GD); p.circ(x + 2, 46, 2, GOLD); p.px(x + 1, 45, GL); }
      for (const x of [136, 172]) { p.rect(x, 68, 12, 3, GOLD); p.rect(x, 68, 12, 1, GL); p.rect(x, 71, 12, 1, GD); }
      p.rect(143, 76, 34, 5, VEL); p.rect(143, 76, 34, 1, "#9a2a45");
      p.rect(138, 81, 44, 3, GOLD); p.rect(138, 81, 44, 1, GL); p.rect(138, 83, 44, 1, GD);
      });
      // edge vignette
      for (let i = 0; i < 28; i++) p.alpha(0.42 * (1 - i / 28), () => { p.rect(i, 0, 1, H, "#000000"); p.rect(W - 1 - i, 0, 1, H, "#000000"); });
      for (let i = 0; i < 10; i++) p.alpha(0.3 * (1 - i / 10), () => p.rect(0, H - 1 - i, W, 1, "#000000"));
    });

    // The round table: pedestal, rim, top, map, candles and odds and ends.
    const table = layer(W, H, (p) => {
      const cx = TCX, cy = TCY, rx = TRX, ry = TRY;
      p.alpha(0.35, () => { for (let dy = -3; dy <= 3; dy++) { const hw = Math.round(rx * 0.8 * Math.sqrt(1 - (dy / 3.5) ** 2)); p.rect(cx - hw, cy + 31 + dy, hw * 2, 1, "#000000"); } });
      p.rect(cx - 7, cy + 15, 14, 15, "#4a2d18"); p.rect(cx - 7, cy + 15, 2, 15, "#5e3a1f");
      p.rect(cx - 17, cy + 29, 34, 3, "#3c2414"); p.rect(cx - 17, cy + 29, 34, 1, "#55351c");
      for (let dy = -ry; dy <= ry; dy++) { const hw = Math.round(rx * Math.sqrt(1 - (dy / (ry + 0.5)) ** 2)); p.rect(cx - hw, cy + dy + 4, hw * 2, 1, dy > ry - 2 ? "#3e2412" : "#5a3519"); }
      for (let dy = -ry; dy <= ry; dy++) {
        const hw = Math.round(rx * Math.sqrt(1 - (dy / (ry + 0.5)) ** 2));
        p.rect(cx - hw, cy + dy, hw * 2, 1, dy < -ry + 2 ? "#a46e3e" : "#8c5a30");
      }
      for (let i = 0; i < 11; i++) {
        const dy = -10 + i * 2, hw = rx * Math.sqrt(1 - (dy / (ry + 0.5)) ** 2), len = Math.round(hw * (0.5 + env.noise(i + 400) * 0.6));
        p.rect(cx - hw + 3 + env.noise(i + 420) * (hw * 2 - len - 6), cy + dy, len, 1, "#7d4f29");
      }
      // the map, unrolled in the middle of the table (sits below the name tags on the far edge)
      const mx = cx - 23, my = cy - 3, mw = 46, mh = 11, M = (x, y) => [mx + Math.round(x * 1.2), my + Math.round(y * 1.2)];
      const ln = (a, b, c, d, col) => p.line(...M(a, b), ...M(c, d), col);
      p.rect(mx, my, mw, mh, "#e8dcb4"); p.rect(mx, my + mh - 1, mw, 1, "#cdbb8a");
      p.rect(mx - 3, my - 1, 3, mh + 2, "#d6c493"); p.rect(mx - 3, my - 1, 1, mh + 2, "#b5a172");
      p.rect(mx + mw, my - 1, 3, mh + 2, "#d6c493"); p.rect(mx + mw + 2, my - 1, 1, mh + 2, "#b5a172");
      ln(3, 2, 9, 1, "#9a8455"); ln(9, 1, 14, 4, "#9a8455"); ln(14, 4, 10, 7, "#9a8455");
      ln(19, 1, 24, 7, "#6f95bd");
      for (let x = 6; x < 30; x += 2) p.px(...M(x, 6 - (x - 6) / 8), "#b0413e");
      const [X, Y] = M(30, 2);
      for (const [x, y] of [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]]) p.px(X + x, Y + y, "#c0392b");
      const [K, L] = M(26, 1);
      p.px(K, L, "#7a6a45"); p.px(K - 1, L + 1, "#7a6a45"); p.px(K + 1, L + 1, "#7a6a45");
      for (const c of CANDLE) {
        p.rect(c.x - 2, c.y, 6, 1, "#c9a23a"); p.rect(c.x - 1, c.y + 1, 4, 1, "#8a6a22");
        p.rect(c.x, c.y - 5, 2, 5, "#efe6cf"); p.px(c.x + 1, c.y - 5, "#cfc4a8"); p.px(c.x, c.y - 6, "#3a2a1a");
      }
      // a gold cup on the right, ink and quill on the left
      const gx = cx + 56, gy = cy - 1;
      p.rect(gx, gy, 3, 2, GOLD); p.px(gx + 1, gy + 2, GD); p.rect(gx, gy + 3, 3, 1, GD); p.px(gx, gy, GL);
      const ix = cx - 62, iy = cy + 2;
      p.rect(ix, iy, 3, 3, "#1d1a18"); p.px(ix, iy, "#3a3f50"); p.line(ix + 2, iy, ix + 5, iy - 5, "#efe6cf");
    });

    let talks = [], nextTalk = 1.2, nodAt = -9, nextNod = 3.5, wasBusy = false;
    const trip = { phase: "seat", t0: 0, next: 6 + rnd() * 4, dur: 2.4, gave: false };

    function say(i, t, word) {
      if (env.reduced) return;
      const m = TEAM[i], st = env.data && env.data.stats;
      if (!word) {
        word = rnd() < 0.6 && m ? pick(m.say) : pick(CHATTER);
        if (m && m.k === "librarian" && st && st.lessons && rnd() < 0.4) word = st.lessons + " LESSONS";
      }
      talks = talks.filter((tk) => tk.i !== i);
      talks.push({ i, word, t0: t, dur: 1.5 });
    }

    function stepTrip(t, busy) {
      if (trip.phase === "seat" && t >= trip.next) {
        if (talks.some((tk) => tk.i === MSG && t - tk.t0 < tk.dur)) { trip.next = t + 1; return; }
        Object.assign(trip, { phase: "go", t0: t, dur: busy ? 1.6 : 2.4, gave: false });
      } else if (trip.phase === "go" && t - trip.t0 >= trip.dur) {
        Object.assign(trip, { phase: "bow", t0: t });
        say(MSG, t, pick(["NEWS!", "FOR YOU", "UPDATE"]));
      } else if (trip.phase === "bow") {
        const bt = t - trip.t0;
        if (!trip.gave && bt >= 1.0) { trip.gave = true; nodAt = t; env.burst(170 + OX, 72, { n: 8, colors: ["#fff1c4", GOLD], speed: 18, life: 0.5, gravity: 10 }); }
        if (bt >= 1.7) Object.assign(trip, { phase: "back", t0: t });
      } else if (trip.phase === "back" && t - trip.t0 >= trip.dur) {
        Object.assign(trip, { phase: "seat", next: t + (busy ? 5 : 10) + rnd() * 8 });
      }
    }

    // Where a team member is this frame: centre x, feet y, facing, bob offset.
    function pose(i, t, busy, still) {
      const m = TEAM[i];
      let x = m.x, y = m.y, flip = m.x > CX, dy = 0, walking = false;
      if (i === MSG && (trip.phase === "go" || trip.phase === "back")) {
        const p = clamp((t - trip.t0) / trip.dur, 0, 1), go = trip.phase === "go", a = go ? m : STEP, b = go ? STEP : m;
        x = a.x + (b.x - a.x) * p; y = a.y + (b.y - a.y) * p; flip = go; walking = true;
        dy = Math.floor(t * 8) % 2 ? -1 : 0;
      } else if (i === MSG && trip.phase === "bow") {
        x = STEP.x; y = STEP.y; flip = true;
        const bt = t - trip.t0; dy = bt > 0.15 && bt < 0.6 ? 1 : 0;
      } else if (!still) {
        dy = Math.sin(t * (busy ? 3.4 : 2.2) + i * 1.3) > 0.35 ? -1 : 0;
      }
      const tk = talks.find((k) => k.i === i);
      if (!still && tk && t - tk.t0 < 0.22) dy = -2;
      return { i, x: Math.round(x), y: Math.round(y), flip, dy, walking };
    }

    // Soft additive light: concentric discs cached as a sprite, drawn with "lighter".
    const glows = new Map();
    function glow(g, x, y, r, col, a, rings = 1) {
      const key = r + col + rings;
      if (!glows.has(key)) glows.set(key, layer(r * 2 + 1, r * 2 + 1, (p) => { for (let k = 0; k < rings; k++) p.alpha(1 / rings, () => p.circ(r, r, Math.round(r * (1 - k / rings)), col)); }));
      const s = glows.get(key);
      g.alpha(a, () => { g.ctx.globalCompositeOperation = "lighter"; g.ctx.drawImage(s, Math.round(x) - r, Math.round(y) - r); });
    }
    function flame(g, x, y, k) {
      const h = 6 + Math.floor(env.noise(k) * 3), n = env.noise(k + 0.5), sw = n < 0.33 ? -1 : n > 0.66 ? 1 : 0;
      g.rect(x - 2, y - 3, 5, 3, "#e0532a");
      g.rect(x - 1, y - h + 2, 3, h - 5, "#e0532a");
      g.px(x + sw, y - h + 1, "#e0532a");
      g.rect(x - 1, y - 3, 3, 2, "#f7a531");
      g.rect(x, y - h + 3, 1, h - 5, "#f7a531");
      g.rect(x, y - 3, 1, 2, "#fff1a8");
    }
    function scroll(g, x, y) {
      g.rect(x, y, 5, 2, "#efe6cf"); g.px(x, y, "#c9b88f"); g.px(x + 4, y + 1, "#c9b88f"); g.px(x + 2, y, "#d64545"); g.px(x + 2, y + 1, "#d64545");
    }
    function bubble(g, cx, top, word, age) {
      if (age < 0.1) { g.bubble(Math.round(cx - 3), top - 9, 6, 5, { tx: cx - 1 }); return; }
      const tw = g.textWidth(word), w = tw + 6, h = 9;
      const x = clamp(Math.round(cx - w / 2), 1, W - w - 1), y = Math.max(1, top - h - 3);
      g.bubble(x, y, w, h, { tx: clamp(cx - 1, x + 2, x + w - 4) });
      g.text(word, x + 3, y + 2, "#2b2f37");
    }
    function label(g, name, cx, top) {
      const tw = g.textWidth(name), x = clamp(Math.round(cx - tw / 2) - 2, 1, W - tw - 5), y = clamp(top - 10, 1, H - 10);
      g.alpha(0.85, () => g.rect(x, y, tw + 4, 9, "#0b0d16"));
      g.rect(x, y + 8, tw + 4, 1, GD);
      g.text(name, x + 2, y + 2, "#f6e7b8");
    }
    // Small permanent name tag under a member's feet; returns its box for the hit area.
    function tag(g, name, cx, feet, lit) {
      const w = g.textWidth(name) + 2, x = clamp(Math.round(cx - w / 2), 1, W - w - 1), y = Math.min(feet + 1, H - 8);
      g.alpha(lit ? 0.92 : 0.62, () => g.rect(x, y, w, 7, "#0b0d16"));
      if (lit) { g.rect(x, y + 7, w, 1, GOLD); g.rect(x, y - 1, w, 1, GD); }
      g.text(name, x + 1, y + 1, lit ? "#fff1c4" : "#d9cda6");
      return [x, y, w, 7];
    }

    function draw(g, env) {
      const t = env.t, data = env.data || {}, busy = !!data.busy, still = env.reduced;
      if (!still) {
        stepTrip(t, busy);
        if (t >= nextNod) { nodAt = t; nextNod = t + 5 + rnd() * 5; }
        talks = talks.filter((tk) => t - tk.t0 <= tk.dur);
        if (t >= nextTalk) {
          if (talks.length < (busy ? 3 : 1)) {
            let i = Math.floor(rnd() * TEAM.length);
            if (i === MSG && trip.phase !== "seat") i = (i + 1 + Math.floor(rnd() * (TEAM.length - 1))) % TEAM.length;
            if (!talks.some((tk) => tk.i === i)) say(i, t);
          }
          nextTalk = t + (busy ? 0.5 + rnd() * 0.7 : 2 + rnd());
        }
      }
      // the queen is drawn at 2x; without this the buffer smooths her sprite
      g.ctx.imageSmoothingEnabled = false;
      g.ctx.drawImage(bg, 0, 0);

      // Room-space drawing (windows, torches, throne): shift by OX. Hits and bursts stay in buffer space.
      g.ctx.save(); g.ctx.translate(OX, 0);
      // twinkling stars and the odd shooting star
      for (const s of STARS) {
        const tw = still ? s.s * 2 - 1 : Math.sin(t * (1.2 + s.s * 2.5) + s.s * 20);
        g.px(s.x, s.y, tw > 0.7 ? "#ffffff" : tw > -0.3 ? "#b9c3e8" : "#56608a");
        if (s.big && tw > 0.5) { g.px(s.x - 1, s.y, "#7f8bc4"); g.px(s.x + 1, s.y, "#7f8bc4"); g.px(s.x, s.y - 1, "#7f8bc4"); g.px(s.x, s.y + 1, "#7f8bc4"); }
      }
      if (!still) {
        const k = Math.floor(t / 11), lt = t - k * 11;
        if (lt < 0.6) {
          const wn = WIN[k % 2], sx = wn.x + 5 + env.noise(k + 900) * 12, sy = wn.y + 8 + env.noise(k + 950) * 14, p = lt / 0.6;
          for (let j = 0; j < 4; j++) {
            const x = Math.round(sx + p * 10 - j), y = Math.round(sy + p * 5 - j * 0.5);
            if (inWin(wn, x, y)) g.alpha(1 - j * 0.25, () => g.px(x, y, "#ffffff"));
          }
        }
      }

      // torches: warm glow on the wall, flickering flame, a rising spark
      TORCH.forEach((tc, ti) => {
        const k = still ? ti * 7 : Math.floor(t * 10) + ti * 37, f = env.noise(k + 0.25);
        glow(g, tc.x, tc.y - 3, 28 + Math.round(f * 2), "#f29a3a", 0.3, 8);
        glow(g, tc.x, tc.y - 4, 8, "#ffd88a", 0.16, 3);
        flame(g, tc.x, tc.y, k);
        if (!still) { const sp = (t * 0.9 + ti * 0.5) % 1; g.alpha(1 - sp, () => g.px(tc.x + Math.round(Math.sin(t * 3 + ti) * 2), tc.y - 9 - sp * 12, "#ffcf6a")); }
      });

      // the queen: aura (brighter while busy), occasional nod, sparkles while busy
      const pulse = still ? 0.5 : 0.5 + 0.5 * Math.sin(t * (busy ? 3.2 : 1.6));
      const aura = busy ? 0.09 + pulse * 0.05 : 0.035 + pulse * 0.025;
      const ar = 32 + pulse * 3 + (busy ? 5 : 0);
      glow(g, 160, 63, Math.round(ar), GOLD, aura * 4.5, 10);
      glow(g, 160, 61, 12, "#fff1c4", aura * 1.5, 4);
      const nod = !still && t - nodAt < 0.45 ? 1 : 0;
      g.sprite("queen", 142, 50 + nod, { scale: 2 });
      env.hit("queen", 144 + OX, 52, 38, 32);
      if (busy && !still) {
        for (let i = 0; i < 8; i++) {
          const k = (t * 0.5 + i / 8) % 1, x = 160 + Math.sin(i * 2.4 + t * 1.3) * (14 + (i % 3) * 5), y = 84 - k * 50;
          g.alpha(Math.sin(k * Math.PI), () => g.px(x, y, i % 2 ? "#fff1c4" : GOLD));
        }
      }
      g.text("QUEEN CLAUDE", 160, 89, GOLD, { align: "center", shadow: "#1a1008" });

      // dust motes drifting in the moonlight
      for (let wi = 0; wi < 2; wi++) {
        for (let i = 0; i < 9; i++) {
          const id = wi * 31 + i, v = (env.noise(id) + (still ? 0 : t * (0.015 + env.noise(id + 3) * 0.02))) % 1, y = 80 + v * 88;
          const [a, b] = beamAt(wi, y), x = a + (b - a) * env.noise(id + 7) + (still ? 0 : Math.sin(t * 0.8 + i * 1.7) * 1.5);
          g.alpha((0.3 + 0.3 * Math.sin(t * 2 + i)) * Math.min(1, (1 - v) * 4), () => g.px(x, y, "#e6ecff"));
        }
      }
      g.ctx.restore();

      // the team and the table, back to front
      const items = TEAM.map((_, i) => pose(i, t, busy, still));
      items.push({ table: true, y: TCY });
      items.sort((a, b) => a.y - b.y);
      for (const it of items) {
        if (it.table) {
          g.ctx.drawImage(table, 0, 0);
          CANDLE.forEach((c, ci) => {
            const n = still ? 0.6 : env.noise(Math.floor(t * 9) + ci * 17);
            glow(g, c.x + 1, c.y - 8, 7, "#f7b057", 0.28, 4);
            g.rect(c.x, c.y - 8, 1, 2, "#f7a531"); g.px(c.x, c.y - 7, "#ffe9a8");
            if (n > 0.4) g.px(c.x + (n > 0.85 ? 1 : 0), c.y - 9, "#ffd27a");
          });
          continue;
        }
        const m = TEAM[it.i];
        g.sprite(m.k, it.x - (it.flip ? 12 : 9), it.y - 16 + it.dy, { flip: it.flip });
        env.hit(m.k, it.x - 8, it.y - 15 + it.dy, 17, 15);
        if (it.i === MSG && trip.phase === "go") scroll(g, it.x - 11, it.y - 8 + it.dy);
      }
      // the scroll handed up to the throne
      if (!still && trip.phase === "bow") {
        const bt = t - trip.t0;
        if (bt >= 0.3 && bt < 1.0) {
          const p = (bt - 0.3) / 0.7, x0 = STEP.x - 11, y0 = STEP.y - 8;
          scroll(g, x0 + (168 + OX - x0) * p, y0 + (71 - y0) * p - Math.sin(p * Math.PI) * 12);
        } else if (bt < 0.3) scroll(g, STEP.x - 11, STEP.y - 8 + (bt > 0.15 ? 1 : 0));
      }

      // name tags under everyone (the Messenger's only while seated); tags are clickable too
      for (const it of items) {
        if (it.table || (it.i === MSG && trip.phase !== "seat")) continue;
        const m = TEAM[it.i], [x, y, w, h] = tag(g, m.n, it.x, it.y, env.hover === m.k);
        env.hit(m.k, x, y, w, h);
      }

      // speech bubbles, then the queen's hover name (team members light up their own tag instead)
      for (const tk of talks) {
        const age = t - tk.t0;
        if (age > tk.dur) continue;
        if (tk.i < 0) { if (env.hover !== "queen") bubble(g, CX, 50 + nod, tk.word, age); continue; }
        const it = items.find((o) => o.i === tk.i);
        if (it) bubble(g, it.x, it.y - 15 + it.dy, tk.word, age);
      }
      if (env.hover === "queen") label(g, "Queen Claude", CX, 30);
      else if (env.hover === TEAM[MSG].k && trip.phase !== "seat") { const it = items.find((o) => o.i === MSG); label(g, TEAM[MSG].n, it.x, it.y - 15 + it.dy); }
    }

    return {
      size: [W, H],
      bg: "#0b0d16",
      draw,
      update(data) {
        const busy = !!(data && data.busy);
        if (busy && !wasBusy) { nodAt = env.t; nextTalk = env.t; }
        wasBusy = busy;
      },
      onPick(id) {
        const t = env.t;
        if (id === "queen") {
          const st = env.data && env.data.stats;
          nodAt = t;
          say(-1, t, st && st.memories ? st.memories + " MEMORIES" : "♥");
          return;
        }
        const i = TEAM.findIndex((m) => m.k === id);
        if (i >= 0) say(i, t, pick(TEAM[i].say));
      },
    };
  });
})();
