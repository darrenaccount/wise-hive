/* Council scene: a wood-paneled courtroom. The Judge sits at the raised bench under the scales of justice;
   the council's seats (the Believer, Skeptic and Investor by default) argue from their stands below.
   update({phase: "idle"|"arguing"|"deliberating"|"judging"|"verdict", speaking: id|null, verdict: "PURSUE"|"PIVOT"|"PASS"|null,
           seats: [{id, name, plate, role, accent, icon, cheer, lookY}]})
     seats: 1-7 stands spread across the floor (the classic three when missing or empty; at 3 the layout is the old one).
     plate: the nameplate (<= 8 chars); icon: the speech-bubble icon ("heart", "bars" or 1-3 font characters);
     cheer: the verdicts that make the seat bounce; lookY:false = its eyes only move sideways (accessories near the eyes).
   api.gavel(): the Judge slams the gavel (BAM!). Returns a promise that resolves once it is over (~1.3 s). */
(function () {
  "use strict";
  if (!window.Pixel) return;

  const W = 320, H = 140;
  const EYE = "#1d1a18";
  const PHASES = new Set(["idle", "arguing", "deliberating", "judging", "verdict"]);
  // The default seats (never changed; each mounted courtroom keeps its own list, see setSeats).
  const CLASSIC = [
    { id: "believer", name: "BELIEVER", plate: "BELIEVER", role: "THE CASE FOR", accent: "#e2557a", icon: "heart", cheer: ["PURSUE"], lookY: true },
    { id: "skeptic", name: "SKEPTIC", plate: "SKEPTIC", role: "THE ATTACK", accent: "#7aa2d6", icon: "?!", cheer: ["PASS"], lookY: false },
    { id: "investor", name: "INVESTOR", plate: "INVESTOR", role: "THE UPSIDE", accent: "#e9b949", icon: "bars", cheer: ["PURSUE"], lookY: true },
  ];
  const MAX_SEATS = 7, EDGE = 24;      // most stands, and the floor margin the outer stands' centres keep
  // Lookup tables without a prototype, so ids like "constructor" from bad data find nothing.
  const dict = (o) => Object.assign(Object.create(null), o);
  const VERDICT = dict({ PURSUE: ["#5cc28a", "#a6e8c2"], PIVOT: ["#e0a84a", "#f3d08f"], PASS: ["#ef7a72", "#f8b3ad"] });
  const C = {
    wall: "#22170f", pilaster: "#33241a", pilasterHi: "#46321f", panel: "#2b1d14", panelIn: "#25190f", panelHi: "#3a2a1d", panelLo: "#160e09",
    mold: "#4a3322", moldHi: "#6a4630", wood: "#5b3a26", woodHi: "#7a5236", woodLo: "#3e2619", woodDark: "#24160d",
    gold: "#e9b949", goldDim: "#a5832f", floor: "#2a1e15", floorLine: "#1c140e", floorHi: "#33251a",
    carpet: "#5a1f26", carpetIn: "#6e2a31", carpetEdge: "#8a6a2f", cloth: "#1c1411",
  };

  // Layout. Mascot sprites are 21x17 with the body centred on column 8.5.
  const JX = 151, JY = 31;            // Judge sprite; the bench lip (y 45) hides its legs
  const BX = 114, BW = 92, BT = 47;   // bench front: left, width, top
  const PT = 110, SY = PT - 14;       // top of the stands, members' sprite y (legs hidden)
  const BLOCK = { x: 171, y: 40, w: 9, h: 5 };
  // Gavel poses: hand position and angle (0 = head up, PI/2 = head pointing right).
  const POSE = {
    rest: { x: JX + 16, y: JY + 9, a: 0.15 },
    up: { x: JX + 16, y: JY + 1, a: -0.85 },
    hit: { x: JX + 18, y: JY + 6, a: Math.PI / 2 + 0.1 },
  };
  const SLAM = 600, END = 1300;       // ms into the gavel: impact, and the end of the BAM
  const BAM = { x: 200, y: 20 };
  const OUTLINE = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
  const now = () => performance.now();
  const bits = (g, rows, x, y, c) => rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) if (r[i] === "#") g.px(x + i, y + j, c); });
  const HEART = [".##.##.", "#######", "#######", ".#####.", "..###..", "...#..."];

  Pixel.register("council", (env) => {
    const BODY = (Pixel.resolveColor && Pixel.resolveColor("var(--claude)")) || "#e5896a";
    let gv = null;                                   // the running (or just finished) gavel
    let verdictKey = null, verdictNew = false, verdictAt = 0;
    // The seats at their stands: n stands spread evenly and centred (n=3 gives cx 56/160/264 and width 41, the old layout).
    let SEATS = [], SEAT = dict({}), seatsKey = "";
    function setSeats(list) {
      const out = [], seen = new Set();
      for (const s of Array.isArray(list) ? list : []) {
        if (!s || typeof s.id !== "string" || !/^[a-z]{2,20}$/.test(s.id) || s.id === "judge" || seen.has(s.id)) continue;
        seen.add(s.id);
        out.push({ id: s.id, name: String(s.name || s.id).toUpperCase().slice(0, 16), plate: String(s.plate || s.name || s.id).toUpperCase().slice(0, 8),
          role: String(s.role || "").toUpperCase().slice(0, 24), accent: /^#[0-9a-f]{6}$/i.test(s.accent || "") ? s.accent : "#c9ced6",
          icon: String(s.icon || "").slice(0, 5), cheer: Array.isArray(s.cheer) ? s.cheer.filter((w) => VERDICT[w]) : [], lookY: s.lookY !== false });
        if (out.length === MAX_SEATS) break;
      }
      const use = out.length ? out : CLASSIC, n = use.length;
      const gap = n > 1 ? Math.min(104, Math.floor((W - 2 * EDGE) / (n - 1))) : 0;
      SEATS = use.map((s, i) => ({ ...s, cx: Math.round(160 + (i - (n - 1) / 2) * gap), w: Math.min(41, (gap || 47) - 6) }));
      SEAT = dict(Object.fromEntries(SEATS.map((s) => [s.id, s])));
    }
    setSeats(null);

    /* ---------- room ---------- */
    function panel(g, x, y, w, h) {
      g.rect(x, y, w, h, C.panel);
      g.rect(x, y, w, 1, C.panelHi); g.rect(x, y, 1, h, C.panelHi);
      g.rect(x, y + h - 1, w, 1, C.panelLo); g.rect(x + w - 1, y, 1, h, C.panelLo);
      g.rect(x + 3, y + 3, w - 6, h - 6, C.panelIn);
      g.rect(x + 3, y + 3, w - 6, 1, C.panelLo); g.rect(x + 3, y + 3, 1, h - 6, C.panelLo);
      g.rect(x + 3, y + h - 4, w - 6, 1, C.panelHi); g.rect(x + w - 4, y + 3, 1, h - 6, C.panelHi);
    }
    function arch(g, cx, moon) {
      const top = 8, bottom = 52;
      g.circ(cx, top + 12, 12, C.mold); g.rect(cx - 12, top + 12, 25, bottom - top - 12, C.mold);
      g.circ(cx, top + 12, 10, "#1f3352"); g.rect(cx - 10, top + 12, 21, bottom - top - 14, "#16233a");
      g.line(cx - 7, top + 30, cx + 3, top + 16, "#24395a"); g.line(cx - 7, top + 34, cx + 6, top + 18, "#1d2e49");
      if (moon) { g.circ(cx - 4, top + 8, 2, "#e8e2c8"); g.px(cx - 3, top + 7, "#1f3352"); g.px(cx - 2, top + 8, "#1f3352"); }
      for (const [sx, sy] of [[5, 6], [-6, 16], [7, 22], [-2, 26]]) g.px(cx + sx, top + sy, "#c9d4e6");
      g.rect(cx, top + 2, 1, bottom - top - 4, C.mold);
      g.rect(cx - 10, top + 22, 21, 1, C.mold); g.rect(cx - 10, top + 33, 21, 1, C.mold);
      g.rect(cx - 14, bottom, 29, 2, C.moldHi); g.rect(cx - 14, bottom + 2, 29, 1, C.panelLo);
    }
    function pew(g, x, y, w) {
      g.rect(x, y, w, 2, C.woodHi);
      g.rect(x, y + 2, w, 6, "#4a3020"); g.rect(x, y + 4, w, 1, "#3a2518");
      g.rect(x - 1, y + 8, w + 2, 2, C.woodHi); g.rect(x, y + 10, w, 3, C.woodDark);
      for (const ex of [x - 2, x + w - 1]) { g.rect(ex, y - 1, 3, 15, C.wood); g.rect(ex, y - 1, 3, 1, "#8a5f40"); }
    }
    function emblem(g) {
      const cx = 160, cy = 18;
      g.circ(cx, cy, 12, C.goldDim); g.circ(cx, cy, 11, "#4a1a20"); g.circ(cx, cy, 9, "#521d24");
      g.rect(cx, cy - 10, 1, 17, C.gold); g.rect(cx - 1, cy - 9, 3, 1, C.gold);
      g.rect(cx - 3, cy + 7, 7, 1, C.gold); g.rect(cx - 5, cy + 8, 11, 1, C.goldDim);
      g.rect(cx - 9, cy - 7, 19, 1, C.gold);
      for (const px of [cx - 8, cx + 8]) {
        g.line(px, cy - 6, px - 2, cy, C.goldDim); g.line(px, cy - 6, px + 2, cy, C.goldDim);
        g.rect(px - 3, cy, 7, 1, C.gold); g.rect(px - 2, cy + 1, 5, 1, C.gold);
      }
    }
    function sconce(g, x, y) {
      g.rect(x - 2, y + 7, 5, 3, C.goldDim); g.rect(x, y + 5, 1, 2, C.goldDim);
      g.rect(x - 3, y + 4, 7, 1, C.gold); g.rect(x - 2, y + 5, 5, 1, C.goldDim);
      g.rect(x - 1, y, 3, 4, "#efe6cf"); g.px(x + 1, y, "#d8ccb0");
    }
    function room(g, t) {
      g.rect(0, 0, W, 84, C.wall);
      for (let k = 0; k < 7; k++) {
        const cx = 40 + k * 40;
        if (k === 0 || k === 6) arch(g, cx, k === 0); else panel(g, cx - 17, 7, 34, 47);
        panel(g, cx - 17, 61, 34, 18);
      }
      for (let x = 20; x <= 300; x += 40) { g.rect(x - 1, 4, 3, 54, C.pilaster); g.px(x - 1, 4, C.pilasterHi); g.rect(x - 1, 4, 1, 54, C.pilasterHi); }
      g.rect(0, 0, W, 3, C.mold); g.rect(0, 3, W, 1, C.moldHi); g.rect(0, 4, W, 1, C.panelLo);
      g.rect(0, 56, W, 2, C.moldHi); g.rect(0, 58, W, 1, C.panelLo);
      g.rect(0, 80, W, 4, C.mold); g.rect(0, 80, W, 1, C.moldHi);
      emblem(g);
      if (!env.reduced) { const k = (t % 6) / 0.5; if (k < 1) { g.px(151 + k * 18, 11, "#fff6d6"); g.px(152 + k * 18, 11, C.gold); } }
      // floor: boards in perspective, a carpet runner up to the bench
      g.rect(0, 84, W, H - 84, C.floor);
      const rows = [84, 87, 91, 96, 102, 109, 117, 126, 136, H];
      for (let r = 0; r < rows.length - 1; r++) {
        const y0 = rows[r], y1 = rows[r + 1];
        g.rect(0, y0, W, 1, C.floorLine); g.rect(0, y0 + 1, W, 1, C.floorHi);
        for (let x = (r * 29) % 52; x < W; x += 52) g.rect(x, y0 + 1, 1, y1 - y0 - 1, C.floorLine);
      }
      for (let y = 84; y < H; y++) {
        const hw = Math.round(15 + (y - 84) * 0.42);
        g.rect(160 - hw, y, hw * 2 + 1, 1, C.carpet);
        g.px(160 - hw, y, C.carpetEdge); g.px(160 + hw, y, C.carpetEdge);
        g.px(160 - hw + 3, y, C.carpetIn); g.px(160 + hw - 3, y, C.carpetIn);
      }
      pew(g, 10, 64, 86); pew(g, 10, 72, 86); pew(g, 224, 64, 86); pew(g, 224, 72, 86);
      for (const x of [100, 220]) {
        sconce(g, x, 28);
        const f = env.reduced ? 0.5 : env.noise(Math.floor(t * 9) + x);
        g.alpha(0.05 + f * 0.04, () => g.circ(x, 25, 12, "#ffb35a"));
        g.alpha(0.08 + f * 0.05, () => g.circ(x, 25, 6, "#ffd27a"));
        g.rect(x, 25 - (f > 0.7 ? 1 : 0), 1, 3, f > 0.4 ? "#ffd27a" : "#ff9a3c"); g.px(x, 27, "#fff1c4");
      }
    }

    /* ---------- the bench and the Judge ---------- */
    function bench(g) {
      g.rect(BX - 8, 84, BW + 16, 7, "#3a2418"); g.rect(BX - 8, 84, BW + 16, 1, C.woodHi); g.rect(BX - 8, 90, BW + 16, 1, "#1d120c");
      g.rect(BX, BT, BW, 84 - BT, C.wood);
      g.rect(BX, BT, 4, 84 - BT, "#4a2f1f"); g.rect(BX + BW - 4, BT, 4, 84 - BT, "#4a2f1f");
      g.rect(BX, BT + 2, BW, 1, C.goldDim);
      for (let i = 0; i < 3; i++) {
        const x = BX + 7 + i * 27, y = BT + 7, w = 24, h = 84 - BT - 12;
        g.rect(x, y, w, h, C.woodLo); g.rect(x, y, w, 1, C.woodDark); g.rect(x, y, 1, h, C.woodDark);
        g.rect(x, y + h - 1, w, 1, C.woodHi); g.rect(x + w - 1, y, 1, h, C.woodHi);
        g.rect(x + 3, y + 3, w - 6, h - 6, "#4c311f");
      }
      const sx = BX + BW / 2;
      g.circ(sx, BT + 21, 5, C.goldDim); g.circ(sx, BT + 21, 4, "#4a1a20");
      for (let r = -2; r <= 2; r++) g.rect(sx - (2 - Math.abs(r)), BT + 21 + r, (2 - Math.abs(r)) * 2 + 1, 1, C.gold);
      g.px(sx, BT + 21, "#fff1b8");
      g.rect(BX - 3, BT - 2, BW + 6, 2, C.woodHi); g.rect(BX - 3, BT - 2, BW + 6, 1, "#8f6342"); g.rect(BX - 3, BT, BW + 6, 1, C.woodDark);
      // sound block
      g.rect(BLOCK.x, BLOCK.y, BLOCK.w, BLOCK.h, "#3b2416"); g.rect(BLOCK.x, BLOCK.y, BLOCK.w, 1, "#6a4430");
      g.rect(BLOCK.x, BLOCK.y + BLOCK.h - 1, BLOCK.w, 1, "#1f130b"); g.rect(BLOCK.x + BLOCK.w - 1, BLOCK.y + 1, 1, BLOCK.h - 1, "#1f130b");
    }
    // Moves a mascot's eyes (1x2 px at columns 6 and 11, rows 9-10) so it can look somewhere.
    function look(g, x, y, dx, dy) {
      if (!dx && !dy) return;
      g.rect(x + 6, y + 9, 1, 2, BODY); g.rect(x + 11, y + 9, 1, 2, BODY);
      g.rect(x + 6 + dx, y + 9 + dy, 1, 2, EYE); g.rect(x + 11 + dx, y + 9 + dy, 1, 2, EYE);
    }
    const mix = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, a: a.a + (b.a - a.a) * k });
    function pose(el) {
      const e = env.ease;
      if (!gv) return POSE.rest;
      if (gv.still) return POSE.hit;
      if (el < 480) return mix(POSE.rest, POSE.up, e.out(el / 480));
      if (el < SLAM) return mix(POSE.up, POSE.hit, e.in((el - 480) / (SLAM - 480)));
      if (el < 780) { const r = Math.sin(((el - SLAM) / 180) * Math.PI); return { x: POSE.hit.x, y: POSE.hit.y - r * 2, a: POSE.hit.a - r * 0.35 }; }
      return mix(POSE.hit, POSE.rest, e.inOut(Math.min(1, (el - 780) / 480)));
    }
    function gavel(g, p) {
      const dx = Math.sin(p.a), dy = -Math.cos(p.a), nx = -dy, ny = dx;
      for (const [ox, oy] of [[0, 0], [1, 0], [0, 1]]) g.line(JX + 15 + ox, JY + 9 + oy, p.x + ox, p.y + oy, BODY);
      g.line(p.x - dx * 2, p.y - dy * 2, p.x + dx * 4, p.y + dy * 4, "#c9965f");
      for (let k = 4.5; k <= 7; k += 0.5) for (let s = -3; s <= 3; s += 0.5) {
        g.px(p.x + dx * k + nx * s, p.y + dy * k + ny * s, Math.abs(s) < 0.5 ? C.gold : Math.abs(s) > 2.4 ? "#6b4329" : k > 6.2 ? "#d39a62" : "#a86e42");
      }
      g.rect(p.x - 1, p.y - 1, 2, 2, BODY);
    }
    function judge(g, ph, speaking, el) {
      const t = env.t, ctx = g.ctx, busy = gv && el < END;
      const scroll = ph === "idle" && !env.reduced && !busy && t % 11 > 7;
      let dx = 0, dy = 0;
      if (scroll) dy = 1;
      else if (ph === "deliberating") { dx = 1; dy = -1; }
      else if (ph === "arguing" && SEAT[speaking]) { dx = Math.sign(SEAT[speaking].cx - 160); dy = 1; }
      // The sprite's own gavel (columns 16+) is clipped off; the animated one replaces it.
      ctx.save(); ctx.beginPath(); ctx.rect(JX, JY - 4, 16, 21); ctx.clip();
      g.sprite("judge", JX, JY);
      ctx.restore();
      look(g, JX, JY, dx, dy);
      bench(g);
      gavel(g, busy ? pose(el) : POSE.rest);
      if (scroll) {
        const sx = JX + 3, sy = JY + 12;
        g.rect(sx, sy, 11, 4, "#f3efe6"); g.rect(sx + 2, sy + 1, 6, 1, "#9a8f7a"); g.rect(sx + 2, sy + 2, 4, 1, "#9a8f7a");
        g.rect(sx - 1, sy - 1, 2, 6, "#c9b48a"); g.rect(sx + 10, sy - 1, 2, 6, "#c9b48a");
      }
      if (ph === "deliberating") {
        const rub = env.reduced ? 0 : Math.round(Math.sin(t * 6));
        g.rect(JX + 7 + rub, JY + 11, 3, 2, "#f2a68a"); g.rect(JX + 7 + rub, JY + 12, 3, 1, "#c9694c");
        const fy = env.reduced ? 0 : Math.round(Math.sin(t * 2));
        g.rect(JX + 16, JY + 2 + fy, 2, 2, "#f1f1f1"); g.rect(JX + 18, JY - 2 + fy, 3, 3, "#f1f1f1");
        g.bubble(JX + 19, JY - 15 + fy, 13, 11, { tail: false });
        g.text("?", JX + 24, JY - 12 + fy, "#2b2f37");
      } else if (speaking === "judge" && (ph === "arguing" || ph === "judging") && !busy) {
        talk(g, JX - 12, JY - 6, "dots");
      }
      env.hit("judge", JX - 2, JY + 3, 25, 14);
    }

    /* ---------- stands and members ---------- */
    function stand(g, s) {
      const w = s.w, x = s.cx - Math.floor(w / 2);   // w=41 gives the old cx - 20
      g.rect(x - 2, PT, w + 4, 3, C.woodHi); g.rect(x - 2, PT, w + 4, 1, "#8f6342"); g.rect(x - 2, PT + 3, w + 4, 1, C.woodDark);
      g.rect(x, PT + 4, w, 22, "#4e3322");
      g.rect(x, PT + 4, w, 2, s.accent); g.rect(x, PT + 6, w, 1, C.woodDark);
      g.rect(x, PT + 7, 2, 19, "#3a2518"); g.rect(x + w - 2, PT + 7, 2, 19, "#3a2518");
      const pw = g.textWidth(s.plate) + 6, px = s.cx - Math.floor(pw / 2);
      g.rect(px, PT + 10, pw, 9, C.goldDim); g.rect(px + 1, PT + 11, pw - 2, 7, "#15100c");
      g.text(s.plate, px + 3, PT + 12, s.accent);
      g.rect(x - 3, PT + 26, w + 6, 4, "#3a2418"); g.rect(x - 3, PT + 26, w + 6, 1, C.woodHi);
    }
    function member(g, s, i, ph, speaking, word) {
      const t = env.t, talking = ph === "arguing" && speaking === s.id;
      let bob = !env.reduced && Math.sin(t * 1.6 + i * 2.1) > 0.6 ? 1 : 0, dx = 0, dy = 0;
      if (talking) bob = env.reduced ? 1 : Math.round(Math.abs(Math.sin(t * 7)) * 2);
      else if (ph === "arguing" && SEAT[speaking]) dx = Math.sign(SEAT[speaking].cx - s.cx);
      else if (ph === "arguing" && speaking === "judge") { dx = Math.sign(160 - s.cx); dy = -1; }
      if (ph === "deliberating" || ph === "judging" || ph === "verdict") { dx = Math.sign(160 - s.cx); dy = -1; }
      if (!s.lookY) dy = 0;   // e.g. the Skeptic: its eyebrows sit right on top of the eyes
      if (word && s.cheer.includes(word) && !env.reduced && t - verdictAt < 2.4) bob = Math.round(Math.abs(Math.sin(t * 9)) * 3);
      const x = s.cx - 9, y = SY - bob;
      g.sprite(s.id, x, y);
      look(g, x, y, dx, dy);
      stand(g, s);
      env.hit(s.id, s.cx - 13, SY - 2, 26, H - SY + 2);
      return talking;
    }
    // Speech bubble above a speaker: dots that fill in, then the speaker's icon ("dots" or "" = only the dots,
    // "heart", "bars", or up to 3 font characters).
    function talk(g, cx, y, icon) {
      const x = cx - 10, t = env.t, cyc = env.reduced ? 0 : t % 2.4;
      g.bubble(x, y, 20, 10, { tx: cx - 2 });
      if (cyc < 1.4 || !icon || icon === "dots") {
        const n = env.reduced ? 3 : Math.floor(cyc / 0.3) % 4;
        for (let k = 0; k < 3; k++) g.rect(x + 5 + k * 4, y + 4, 2, 2, k < n ? "#2b2f37" : "#c9ced6");
      } else if (icon === "heart") bits(g, HEART, cx - 3, y + 2, "#e2557a");
      else if (icon !== "bars") g.text(icon.slice(0, 3), cx, y + 3, "#2f3e66", { align: "center" });
      else {
        g.rect(cx - 5, y + 6, 2, 2, "#3fa06b"); g.rect(cx - 2, y + 4, 2, 4, "#3fa06b"); g.rect(cx + 1, y + 2, 2, 6, "#3fa06b");
        g.px(cx + 4, y + 2, "#e9b949"); g.px(cx + 4, y + 3, "#e9b949");
      }
    }

    /* ---------- verdict banner and BAM ---------- */
    function banner(g, word) {
      const [col, light] = VERDICT[word], t = env.t;
      const k = env.reduced ? 1 : env.ease.out(Math.min(1, (t - verdictAt) / 0.45));
      const tw = g.textWidth(word, 3), bw = Math.max(64, tw + 22) + (tw % 2 ? 1 : 0), bx = 160 - Math.floor(bw / 2), by = 6, bh = 24;
      const h = Math.max(1, Math.round(bh * k)), pulse = env.reduced ? 0.5 : 0.5 + 0.5 * Math.sin(t * 2.4);
      for (let i = 3; i >= 1; i--) g.alpha((0.05 + pulse * 0.05) * k, () => g.rect(bx - i * 3, by - i * 2, bw + i * 6, h + 4 + i * 4, col));
      g.line(bx + 2, by - 2, 160, 1, C.goldDim); g.line(bx + bw - 3, by - 2, 160, 1, C.goldDim);
      g.rect(bx - 3, by - 2, bw + 6, 2, C.goldDim); g.rect(bx - 4, by - 3, 2, 4, C.gold); g.rect(bx + bw + 2, by - 3, 2, 4, C.gold);
      g.rect(bx, by, bw, h, C.cloth);
      g.rect(bx + 2, by, 1, h, col); g.rect(bx + bw - 3, by, 1, h, col);
      if (h >= bh) {
        g.rect(bx + 2, by + 1, bw - 4, 1, col); g.rect(bx + 2, by + bh - 2, bw - 4, 1, col);
        const half = Math.floor(bw / 2);
        for (let r = 0; r < 4; r++) {
          const cut = (r + 1) * 3;
          g.rect(bx, by + bh + r, half - cut, 1, C.cloth); g.rect(bx + half + cut, by + bh + r, bw - half - cut, 1, C.cloth);
          g.px(bx + half - cut - 1, by + bh + r, col); g.px(bx + half + cut, by + bh + r, col);
        }
      }
      if (h > 8) {
        const ctx = g.ctx;
        ctx.save(); ctx.beginPath(); ctx.rect(bx, by, bw, h); ctx.clip();
        g.text(word, 161, by + 6, "#0a0706", { scale: 3, align: "center" });
        g.text(word, 160, by + 5, col, { scale: 3, align: "center" });
        ctx.beginPath(); ctx.rect(bx, by + 5, bw, 3); ctx.clip();
        g.text(word, 160, by + 5, light, { scale: 3, align: "center" });
        ctx.restore();
      }
    }
    function bam(g, el) {
      const still = gv.still, k = el - SLAM;
      if (!still && k < 0) return;
      const s = still ? 4 : k < 40 ? 3 : k < 130 ? 5 : 4;
      const a = still || el < 1000 ? 1 : Math.max(0, 1 - (el - 1000) / (END - 1000));
      const rise = still || el < 1000 ? 0 : Math.round((el - 1000) / 70);
      const rk = still ? 0.35 : Math.min(1, k / 320);
      if (rk < 1) g.alpha(still ? 0.7 : 1 - rk, () => {
        for (let i = 0; i < 14; i++) {
          const ang = (i / 14) * Math.PI * 2 + 0.2, c = Math.cos(ang), sn = Math.sin(ang), r0 = 1 + rk * 0.55, r1 = r0 + 0.3;
          g.line(BAM.x + c * 38 * r0, BAM.y + sn * 16 * r0, BAM.x + c * 38 * r1, BAM.y + sn * 16 * r1, i % 2 ? "#fff4c2" : C.gold);
        }
      });
      if (!still && k < 110) g.alpha(1 - k / 110, () => {
        const fx = BLOCK.x + 4, fy = BLOCK.y - 1, r = 2 + Math.round(k / 25);
        g.line(fx - r - 2, fy, fx + r + 2, fy, "#ffffff"); g.line(fx, fy - r - 1, fx, fy + 1, "#ffffff");
        g.line(fx - r, fy - r, fx - 1, fy - 1, "#fff4c2"); g.line(fx + r, fy - r, fx + 1, fy - 1, "#fff4c2");
      });
      const word = "BAM!", tw = g.textWidth(word, s), x = Math.round(BAM.x - tw / 2), y = Math.round(BAM.y - (5 * s) / 2) - rise;
      g.alpha(a, () => {
        g.text(word, x + 2, y + 3, "#0d0805", { scale: s });
        for (const [ox, oy] of OUTLINE) g.text(word, x + ox, y + oy, "#3a2208", { scale: s });
        g.text(word, x, y, C.gold, { scale: s });
        const ctx = g.ctx;
        ctx.save(); ctx.beginPath(); ctx.rect(x, y, tw, s); ctx.clip();
        g.text(word, x, y, "#fff1b8", { scale: s });
        ctx.restore();
      });
    }
    function impact() {
      env.shake(3, 300);
      env.burst(BLOCK.x + 4, BLOCK.y, { n: 18, colors: [C.gold, "#fff4c2", "#ffffff"], speed: 60, up: 35, gravity: 110, life: 0.7 });
      for (const x of [BX + 3, BX + BW - 3, BLOCK.x + 4]) env.burst(x, BT - 2, { n: 6, colors: ["#8a6a52", "#b39a80", "#6e5543"], speed: 14, up: 10, gravity: 12, life: 1 });
    }
    function confetti() {
      const colors = ["#5cc28a", "#e9b949", "#e2557a", "#7aa2d6", "#f1f1f1"];
      env.burst(160, 16, { n: 30, colors, speed: 80, up: 45, gravity: 80, life: 1.8 });
      env.burst(118, 10, { n: 8, colors, speed: 50, up: 30, gravity: 70, life: 1.6, size: 2 });
      env.burst(202, 10, { n: 8, colors, speed: 50, up: 30, gravity: 70, life: 1.6, size: 2 });
    }

    function label(g, parts, cx, y, border) {
      const text = parts.map((p) => p[0]).join("  "), w = g.textWidth(text) + 6;
      const x = Math.max(1, Math.min(W - w - 1, Math.round(cx - w / 2)));
      g.rect(x, y, w, 9, border); g.rect(x + 1, y + 1, w - 2, 7, "#14100d");
      let px = x + 3;
      for (const [str, c] of parts) { g.text(str, px, y + 2, c); px += g.textWidth(str + "  ") + 1; }
    }

    function draw(g, env) {
      const d = env.data || {}, t = env.t;
      const ph = PHASES.has(d.phase) ? d.phase : "idle";
      const speaking = SEAT[d.speaking] || d.speaking === "judge" ? d.speaking : null;
      const word = ph === "verdict" && VERDICT[d.verdict] ? d.verdict : null;
      const el = gv ? now() - gv.start : Infinity;
      if (verdictNew) { verdictNew = false; verdictAt = t; if (word === "PURSUE" && !env.reduced) confetti(); }
      if (gv && !gv.still && !gv.hit && el >= SLAM) { gv.hit = true; if (el < END) impact(); }

      room(g, t);
      if (word) banner(g, word);
      judge(g, ph, speaking, el);
      let talker = null;
      SEATS.forEach((s, i) => { if (member(g, s, i, ph, speaking, word)) talker = s; });
      if (talker && env.hover !== talker.id) talk(g, talker.cx, SY - 14, talker.icon);
      if (gv && el < END) bam(g, el);
      const hs = SEAT[env.hover];
      if (hs) label(g, [[hs.name, hs.accent], [hs.role, "#c9ced6"]], hs.cx, SY - 13, hs.accent);
      else if (env.hover === "judge") label(g, [["JUDGE", C.gold], ["THE VERDICT", "#c9ced6"]], 160, JY - 6, C.goldDim);
    }

    return {
      size: [W, H],
      bg: "#140d09",
      draw,
      update(d) {
        if (d && d.seats !== undefined) { const k = JSON.stringify(d.seats); if (k !== seatsKey) { seatsKey = k; setSeats(d.seats); } }
        if (gv && gv.done) gv = null;   // a finished gavel's last frame never outlives the next state change
        const key = d && d.phase === "verdict" ? String(d.verdict || "") : null;
        if (key !== verdictKey) { verdictKey = key; verdictNew = key != null; }
      },
      api: {
        // Raise, slam, BAM. Calling again while it runs returns the same promise.
        gavel() {
          if (gv && !gv.done) return gv.promise;
          const run = { start: now(), hit: false, done: false, still: !!env.reduced };
          run.promise = new Promise((resolve) => setTimeout(() => { run.done = true; resolve(); }, run.still ? 200 : END));
          gv = run;
          return run.promise;
        },
      },
    };
  });
})();
