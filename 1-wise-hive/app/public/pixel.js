/* The Wise Hive pixel-art engine. Scenes draw into a small low-res buffer that is scaled up crisply.
   Scenes live in public/scenes/*.js and register with Pixel.register(name, factory).

   factory(env) returns { size:[W,H], bg:"#hex", draw(g, env), update?(data), onPick?(id), api?:{...} }
     g   : drawing helpers in buffer pixels (see makeG below)
     env : { W, H, t (seconds), dt, frame, data (last update), hover (hit id under the mouse),
             hit(id,x,y,w,h), shake(px,ms), burst(x,y,opts), noise(i), reduced, ease }
   Pixel.mount(canvas, name, {onPick}) returns { update(data), api, destroy() }.
   Mascot sprites come from the app's KIT via the global mascot(kind) function: 21x17 cells. */
(function () {
  "use strict";
  const SCENES = {};
  const spriteCache = new Map();
  const reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const FRAME_MS = 1000 / 30, FRAME_MS_BLUR = 1000 / 15; // frame caps: focused window, visible but unfocused

  // 3x5 pixel font. Each glyph: 5 rows of 3 chars, "#" = on.
  const G = {
    A:"###|#.#|###|#.#|#.#", B:"##.|#.#|##.|#.#|##.", C:"###|#..|#..|#..|###", D:"##.|#.#|#.#|#.#|##.", E:"###|#..|##.|#..|###",
    F:"###|#..|##.|#..|#..", G:"###|#..|#.#|#.#|###", H:"#.#|#.#|###|#.#|#.#", I:"###|.#.|.#.|.#.|###", J:"..#|..#|..#|#.#|###",
    K:"#.#|#.#|##.|#.#|#.#", L:"#..|#..|#..|#..|###", M:"#.#|###|###|#.#|#.#", N:"##.|#.#|#.#|#.#|#.#", O:"###|#.#|#.#|#.#|###",
    P:"###|#.#|###|#..|#..", Q:"###|#.#|#.#|###|..#", R:"###|#.#|##.|#.#|#.#", S:"###|#..|###|..#|###", T:"###|.#.|.#.|.#.|.#.",
    U:"#.#|#.#|#.#|#.#|###", V:"#.#|#.#|#.#|#.#|.#.", W:"#.#|#.#|###|###|#.#", X:"#.#|#.#|.#.|#.#|#.#", Y:"#.#|#.#|.#.|.#.|.#.",
    Z:"###|..#|.#.|#..|###", "0":"###|#.#|#.#|#.#|###", "1":".#.|##.|.#.|.#.|###", "2":"###|..#|###|#..|###", "3":"###|..#|###|..#|###",
    "4":"#.#|#.#|###|..#|..#", "5":"###|#..|###|..#|###", "6":"###|#..|###|#.#|###", "7":"###|..#|..#|.#.|.#.", "8":"###|#.#|###|#.#|###",
    "9":"###|#.#|###|..#|###", " ":"...|...|...|...|...", "!":".#.|.#.|.#.|...|.#.", "?":"###|..#|.##|...|.#.", ".":"...|...|...|...|.#.",
    ",":"...|...|...|.#.|#..", ":":"...|.#.|...|.#.|...", "-":"...|...|###|...|...", "+":"...|.#.|###|.#.|...", "/":"..#|..#|.#.|#..|#..",
    "'":".#.|.#.|...|...|...", '"':"#.#|#.#|...|...|...", "%":"#.#|..#|.#.|#..|#.#", "#":"#.#|###|#.#|###|#.#", "(":".#.|#..|#..|#..|.#.",
    ")":".#.|..#|..#|..#|.#.", "*":"...|#.#|.#.|#.#|...", "=":"...|###|...|###|...", "<":"..#|.#.|#..|.#.|..#", ">":"#..|.#.|..#|.#.|#..",
    "_":"...|...|...|...|###", "♥":"...|#.#|###|.#.|...", "♪":".##|.#.|.#.|##.|##.",
  };
  const GLYPH = {};
  for (const k in G) GLYPH[k] = G[k].split("|").map((r) => [...r].map((c) => c === "#"));

  const css = (name, fb) => (getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb);
  function resolveColor(c) {
    const m = /^var\((--[\w-]+)\)$/.exec(c || "");
    return m ? css(m[1], "#e5896a") : c;
  }
  // A mascot from the app's KIT as a 21x17 canvas (the SVG viewBox is -1 -3 21 17).
  function sprite(kind) {
    if (spriteCache.has(kind)) return spriteCache.get(kind);
    const c = document.createElement("canvas"); c.width = 21; c.height = 17;
    const x = c.getContext("2d");
    const svg = typeof window.mascot === "function" ? window.mascot(kind) : "";
    const re = /<rect x="(-?\d+(?:\.\d+)?)" y="(-?\d+(?:\.\d+)?)" width="(\d+(?:\.\d+)?)" height="(\d+(?:\.\d+)?)" fill="([^"]+)"\/>/g;
    let m;
    while ((m = re.exec(svg))) { x.fillStyle = resolveColor(m[5]); x.fillRect(+m[1] + 1, +m[2] + 3, +m[3], +m[4]); }
    spriteCache.set(kind, c);
    return c;
  }

  const ease = {
    inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    out: (t) => 1 - Math.pow(1 - t, 3),
    in: (t) => t * t * t,
    bounce: (t) => { const n = 7.5625, d = 2.75; if (t < 1 / d) return n * t * t; if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75; if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375; return n * (t -= 2.625 / d) * t + 0.984375; },
  };
  const hash = (i) => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

  function makeG(ctx) {
    const g = {
      ctx,
      clear(c) { ctx.fillStyle = c; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height); },
      rect(x, y, w, h, c) { ctx.fillStyle = resolveColor(c); ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); },
      px(x, y, c) { ctx.fillStyle = resolveColor(c); ctx.fillRect(Math.round(x), Math.round(y), 1, 1); },
      line(x0, y0, x1, y1, c) {
        x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
        const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
        let err = dx + dy; ctx.fillStyle = resolveColor(c);
        for (let i = 0; i < 2000; i++) { ctx.fillRect(x0, y0, 1, 1); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } }
      },
      circ(cx, cy, r, c) { ctx.fillStyle = resolveColor(c); for (let y = -r; y <= r; y++) { const w = Math.round(Math.sqrt(r * r - y * y)); ctx.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2 + 1, 1); } },
      // Mascot sprite with its 21x17 box's top-left at (x, y); feet are at y+16.
      sprite(kind, x, y, o = {}) {
        const s = sprite(kind), sc = o.scale || 1;
        ctx.save(); if (o.alpha != null) ctx.globalAlpha = o.alpha;
        if (o.flip) { ctx.translate(Math.round(x) + 21 * sc, Math.round(y)); ctx.scale(-1, 1); ctx.drawImage(s, 0, 0, 21 * sc, 17 * sc); }
        else ctx.drawImage(s, Math.round(x), Math.round(y), 21 * sc, 17 * sc);
        ctx.restore();
      },
      textWidth(str, scale = 1) { return String(str).length * 4 * scale - scale; },
      text(str, x, y, c, o = {}) {
        str = String(str).toUpperCase(); const s = o.scale || 1;
        let sx = Math.round(x);
        if (o.align === "center") sx -= Math.floor(g.textWidth(str, s) / 2); else if (o.align === "right") sx -= g.textWidth(str, s);
        const draw = (ox, oy, col) => {
          ctx.fillStyle = resolveColor(col);
          [...str].forEach((ch, i) => { const gl = GLYPH[ch] || GLYPH["?"]; gl.forEach((row, r) => row.forEach((on, k) => { if (on) ctx.fillRect(sx + ox + (i * 4 + k) * s, Math.round(y) + oy + r * s, s, s); })); });
        };
        if (o.shadow) draw(s, s, o.shadow);
        draw(0, 0, c);
      },
      // Speech bubble: box at (x,y,w,h) with a tail pointing down at tx (absolute x).
      bubble(x, y, w, h, o = {}) {
        const fill = o.fill || "#f1f1f1", stroke = o.stroke || "#2b2f37";
        g.rect(x + 1, y, w - 2, h, stroke); g.rect(x, y + 1, w, h - 2, stroke);
        g.rect(x + 1, y + 1, w - 2, h - 2, fill);
        const tx = Math.round(o.tx != null ? o.tx : x + 4);
        if (o.tail !== false) { g.rect(tx, y + h - 1, 3, 1, fill); g.rect(tx, y + h, 2, 1, fill); g.px(tx + 2, y + h, stroke); g.rect(tx, y + h + 1, 1, 1, stroke); g.px(tx + 1, y + h + 1, fill); g.px(tx + 1, y + h + 2, stroke); g.px(tx - 1, y + h, stroke); }
      },
      alpha(a, fn) { ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, a)); fn(); ctx.restore(); },
    };
    return g;
  }

  function mount(canvas, name, opts = {}) {
    const factory = SCENES[name];
    if (!factory || !canvas) return { update() {}, api: {}, destroy() {} };
    const buf = document.createElement("canvas"), bctx = buf.getContext("2d");
    const out = canvas.getContext("2d");
    const env = { W: 320, H: 180, t: 0, dt: 0, frame: 0, data: {}, hover: null, reduced, ease, noise: hash };
    let hits = [], parts = [], shakeAmp = 0, shakeUntil = 0, raf = 0, guard = 0, last = 0, t0 = performance.now(), alive = true, dirty = true;
    // Next frame from requestAnimationFrame, with a timer fallback for windows where rAF is throttled.
    const schedule = () => {
      const tick = () => { cancelAnimationFrame(raf); clearTimeout(guard); raf = guard = 0; frame(performance.now()); };
      raf = requestAnimationFrame(tick); guard = setTimeout(tick, 66);
    };
    env.hit = (id, x, y, w, h) => hits.push({ id, x, y, w, h });
    env.shake = (px, ms) => { shakeAmp = px; shakeUntil = performance.now() + ms; };
    // Particles: env.burst(x, y, {n, colors, speed, life, gravity, size, up})
    env.burst = (x, y, o = {}) => {
      const n = o.n || 12;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, sp = (o.speed || 40) * (0.4 + Math.random() * 0.8);
        parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (o.up || 0), life: (o.life || 0.8) * (0.6 + Math.random() * 0.6), age: 0, g: o.gravity == null ? 60 : o.gravity,
          c: (o.colors || ["#e9b949"])[i % (o.colors || ["#e9b949"]).length], s: o.size || 1 });
      }
    };
    const scene = factory(env);
    [env.W, env.H] = scene.size || [320, 180];
    buf.width = env.W; buf.height = env.H;
    bctx.imageSmoothingEnabled = false; // keeps sprites drawn at scale > 1 crisp
    const g = makeG(bctx);
    let layout = { s: 1, ox: 0, oy: 0 };

    function fit() {
      const dpr = window.devicePixelRatio || 1, cw = canvas.clientWidth, ch = canvas.clientHeight;
      if (!cw || !ch) return false;
      const pw = Math.round(cw * dpr), ph = Math.round(ch * dpr);
      if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
      // Whole-number zoom keeps every pixel the same size; fall back to an exact fit when that would waste over 12% of the space.
      let s = Math.min(pw / env.W, ph / env.H);
      if (s >= 1 && Math.floor(s) / s > 0.88) s = Math.floor(s);
      layout = { s, ox: Math.round((pw - env.W * s) / 2), oy: Math.round((ph - env.H * s) / 2), dpr };
      return true;
    }
    function frame(now) {
      if (!alive) return;
      // data-shell="hidden": the desktop window is hidden or was never shown (main.js), even if the page thinks it's visible.
      const visible = canvas.isConnected && canvas.offsetParent !== null && document.visibilityState === "visible" && document.documentElement.dataset.shell !== "hidden";
      if (!visible) { guard = setTimeout(() => frame(performance.now()), 400); return; }
      if (!fit()) { guard = setTimeout(() => frame(performance.now()), 300); return; }
      // At most 30 frames a second (15 while the window isn't focused): the scenes move in steps of ~8 a second, so
      // drawing at the screen's 60-144 Hz only multiplied the work (~1,300 rectangles a frame in the castle and council).
      // `last` only moves on frames that draw, so dt stays right.
      if (last && !reduced && now - last < (document.hasFocus() ? FRAME_MS : FRAME_MS_BLUR) - 4) { schedule(); return; }
      env.dt = last ? Math.min(0.1, (now - last) / 1000) : 0; last = now;
      env.t = reduced ? 2 : (now - t0) / 1000; env.frame++;
      hits = [];
      bctx.save();
      g.clear(scene.bg || "#101216");
      try { scene.draw(g, env); } catch (e) { console.error("scene " + name, e); }
      // particles
      parts = parts.filter((p) => (p.age += env.dt) < p.life);
      for (const p of parts) { p.vy += p.g * env.dt; p.x += p.vx * env.dt; p.y += p.vy * env.dt; g.alpha(1 - p.age / p.life, () => g.rect(p.x, p.y, p.s, p.s, p.c)); }
      bctx.restore();
      // blit with optional shake
      let sx = 0, sy = 0;
      if (performance.now() < shakeUntil && !reduced) { sx = Math.round((Math.random() * 2 - 1) * shakeAmp) * layout.s; sy = Math.round((Math.random() * 2 - 1) * shakeAmp) * layout.s; }
      out.imageSmoothingEnabled = false;
      out.fillStyle = scene.bg || "#101216"; out.fillRect(0, 0, canvas.width, canvas.height);
      out.drawImage(buf, layout.ox + sx, layout.oy + sy, env.W * layout.s, env.H * layout.s);
      // A pointer only where a click does something (library and activity register hits for their hover labels only).
      const cur = env.hover != null && (scene.onPick || opts.onPick) ? "pointer" : "";
      if (canvas.style.cursor !== cur) canvas.style.cursor = cur;
      if (reduced && !dirty) { guard = setTimeout(() => frame(performance.now()), 1000); return; }
      dirty = false;
      schedule();
    }
    const toBuf = (e) => { const r = canvas.getBoundingClientRect(), d = layout.dpr || 1; return [((e.clientX - r.left) * d - layout.ox) / layout.s, ((e.clientY - r.top) * d - layout.oy) / layout.s]; };
    const hitAt = ([x, y]) => { for (let i = hits.length - 1; i >= 0; i--) { const h = hits[i]; if (x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + h.h) return h.id; } return null; };
    // Reduced motion draws only on change (every 1 s otherwise): a new hover or new data wakes it at once.
    const wake = () => { if (reduced && alive) { clearTimeout(guard); cancelAnimationFrame(raf); schedule(); } };
    const onMove = (e) => { const h = hitAt(toBuf(e)); if (h !== env.hover) { env.hover = h; dirty = true; wake(); } };
    const onLeave = () => { env.hover = null; };
    const onClick = (e) => { const id = hitAt(toBuf(e)); if (id == null) return; scene.onPick && scene.onPick(id); opts.onPick && opts.onPick(id); };
    canvas.addEventListener("mousemove", onMove); canvas.addEventListener("mouseleave", onLeave); canvas.addEventListener("click", onClick);
    schedule();
    return {
      env,
      api: scene.api || {},
      update(data) { env.data = Object.assign({}, env.data, data); dirty = true; scene.update && scene.update(env.data); wake(); },
      destroy() { alive = false; cancelAnimationFrame(raf); clearTimeout(guard); canvas.removeEventListener("mousemove", onMove); canvas.removeEventListener("mouseleave", onLeave); canvas.removeEventListener("click", onClick); },
    };
  }

  window.Pixel = { register(name, factory) { SCENES[name] = factory; }, mount, sprite, ease, hash, resolveColor, scenes: SCENES };
})();
