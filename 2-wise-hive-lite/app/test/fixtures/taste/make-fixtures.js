// Example Taste items, made from code (no downloads): a lighting setup (3 fixed views before/after, one at dusk, the
// settings before and after), a pixel-art sprite, an audio chime and a UI mockup. Each lands as an inbox folder
// (<taste>\inbox\<name>\item.json + files), the same way a round or a chat hands work over. Names are made up.
//   node test/fixtures/taste/make-fixtures.js <taste inbox folder>
// Used by test/taste-kinds-test.js and for checking the Taste tab on a debug instance.
"use strict";
const fs = require("fs"), path = require("path"), zlib = require("zlib");

function png(w, h, px) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) { const c = px(x, y); const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; }
  }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, "latin1"), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * Math.max(0, Math.min(1, t))));

// A tiny harbour scene: sky, sea, a pier and three houses; `look` sets the light.
function scene(look, view) {
  const W = 320, H = 180, horizon = 92 + view * 6;
  const houses = [[40 + view * 30, 60, 46], [120 - view * 10, 48, 60], [220 + view * 12, 70, 40]];
  return png(W, H, (x, y) => {
    let c;
    if (y < horizon) c = mix(look.skyTop, look.skyLow, y / horizon);
    else c = mix(look.sea, look.seaDeep, (y - horizon) / (H - horizon));
    for (const [hx, hw, hh] of houses) {
      if (x >= hx && x < hx + hw && y >= horizon - hh && y < horizon + 4) {
        const lit = x < hx + hw * look.sunSide ? 1 : 0;
        c = mix(look.wallShade, look.wall, lit * 0.9 + 0.1);
        if ((x - hx) % 14 > 8 && (y - (horizon - hh)) % 16 > 9 && y < horizon - 6) c = look.window;
      }
      const roof = horizon - hh - (hw / 2 - Math.abs(x - hx - hw / 2)) * 0.5;
      if (x >= hx && x < hx + hw && y >= roof && y < horizon - hh) c = look.roof;
    }
    if (y > horizon + 10 && y < horizon + 16 && x > 150 && x < 320) c = look.pier;
    const fog = Math.max(0, Math.min(1, (look.fog || 0) * (1 - Math.abs(y - horizon) / 90)));
    return mix(c, look.fogColor || [200, 200, 200], fog);
  });
}
const FLAT = { skyTop: [150, 165, 180], skyLow: [175, 180, 185], sea: [95, 110, 125], seaDeep: [70, 80, 95], wall: [170, 170, 165], wallShade: [130, 130, 128], window: [90, 95, 100],
  roof: [110, 90, 85], pier: [105, 95, 85], sunSide: 0.5, fog: 0.55, fogColor: [190, 195, 200] };
const WARM = { skyTop: [60, 70, 140], skyLow: [250, 160, 90], sea: [60, 90, 140], seaDeep: [30, 45, 85], wall: [250, 205, 150], wallShade: [120, 90, 110], window: [255, 220, 120],
  roof: [180, 70, 60], pier: [140, 95, 70], sunSide: 0.65, fog: 0.15, fogColor: [250, 180, 140] };
const DUSK = { ...WARM, skyTop: [30, 30, 80], skyLow: [200, 90, 90], wall: [200, 140, 140], window: [255, 200, 90], fog: 0.1 };
const DUSK_BEFORE = { ...FLAT, skyTop: [70, 80, 100], skyLow: [110, 110, 120], wall: [120, 120, 120], fog: 0.6 };

function wav(seconds = 1.4, rate = 22050) {
  const n = Math.floor(seconds * rate), data = Buffer.alloc(n * 2);
  const notes = [[0, 988], [0.09, 1319], [0.18, 1568]];
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    let v = 0;
    for (const [at, f] of notes) if (t >= at) { const u = t - at; v += Math.sin(2 * Math.PI * f * u) * Math.exp(-u * 5) * 0.3 + Math.sin(2 * Math.PI * f * 2 * u) * Math.exp(-u * 9) * 0.08; }
    data.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v * 32767))), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "latin1"); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8, "latin1"); h.write("fmt ", 12, "latin1"); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36, "latin1"); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
// A 16x16 slime sprite (pixel art): outline, body, highlight, eyes.
function sprite() {
  const P = { ".": [24, 26, 32], o: [20, 60, 40], g: [70, 190, 90], l: [150, 235, 140], e: [15, 20, 25], w: [245, 250, 245] };
  const rows = ["................", "................", "................", "......oooo......", "....oogggloo....", "...ogggggglgo...", "..oggggggggggo..", "..oggwegggwego..",
    ".ogggeegggeeggo.", ".ogggggggggggggo", ".oggggggggggggo.", ".ogggggoooggggo.", "..oggggggggggo..", "...oooggggooo...", "......oooo......", "................"];
  return png(16, 16, (x, y) => P[rows[y][x]] || P["."]);
}
function mockup() {
  return png(360, 220, (x, y) => {
    if (y < 34) return [36, 40, 52];
    if (x > 20 && x < 340 && y > 54 && y < 200) {
      if (y > 70 && y < 96 && x > 36 && x < 324) return [235, 185, 70];
      if (y > 110 && y < 126 && x > 36 && x < 250) return [200, 205, 215];
      if (y > 136 && y < 150 && x > 36 && x < 200) return [160, 165, 178];
      if (y > 166 && y < 188 && x > 220 && x < 324) return [80, 170, 110];
      return [52, 58, 74];
    }
    return [28, 31, 40];
  });
}

function make(inbox) {
  const put = (name, files, item) => {
    const d = path.join(inbox, name);
    fs.mkdirSync(d, { recursive: true });
    for (const [f, buf] of Object.entries(files)) fs.writeFileSync(path.join(d, f), buf);
    fs.writeFileSync(path.join(d, "item.json"), JSON.stringify(item, null, 1)); // last: the inbox picks a folder up once item.json is there
    return d;
  };
  const views = ["Spawn", "Pier", "Square"];
  const files = {};
  views.forEach((v, i) => { files[`${v.toLowerCase()}-before.png`] = scene(FLAT, i); files[`${v.toLowerCase()}-after.png`] = scene(WARM, i); });
  files["spawn-dusk-before.png"] = scene(DUSK_BEFORE, 0); files["spawn-dusk-after.png"] = scene(DUSK, 0);
  const before = { lighting: { Technology: "Enum.Technology.ShadowMap", Brightness: 2, ClockTime: 14, Ambient: [0.27, 0.27, 0.27], OutdoorAmbient: [0.5, 0.5, 0.5], ExposureCompensation: 0, FogEnd: 400, FogColor: [0.75, 0.76, 0.78] },
    children: [{ class: "Atmosphere", name: "Atmosphere", props: { Density: 0.45, Haze: 2.2, Color: [0.78, 0.8, 0.82] } }, { class: "Sky", name: "Sky", props: { SunAngularSize: 21 } }] };
  const after = { lighting: { Technology: "Enum.Technology.Future", Brightness: 3, ClockTime: 17.6, Ambient: [0.3, 0.24, 0.3], OutdoorAmbient: [0.55, 0.45, 0.5], ExposureCompensation: 0.2, FogEnd: 900, FogColor: [0.98, 0.7, 0.55] },
    children: [{ class: "Atmosphere", name: "Atmosphere", props: { Density: 0.28, Haze: 1.1, Color: [0.98, 0.75, 0.6] } }, { class: "Sky", name: "Sky", props: { SunAngularSize: 21 } },
      { class: "BloomEffect", name: "Bloom", props: { Intensity: 0.6, Size: 24, Threshold: 1.6 } }, { class: "ColorCorrectionEffect", name: "ColorCorrection", props: { Saturation: 0.12, Contrast: 0.08 } }] };
  const cam = (i) => [10 + i * 20, 12, -30, 1, 0, 0, 0, 1, 0, 0, 0, 1];
  const out = [];
  out.push(put("harbor-dusk-lighting", files, { kind: "lighting", title: "Warm harbour evening", style: "general", source: { type: "working", project: "Harbor Town (test place)" },
    about: "Warmer late-afternoon light for the harbour test place: Future lighting, lower fog, a soft bloom and a little extra saturation.\nAimed for a cosy cartoon evening that stays readable.",
    files: Object.keys(files),
    lighting: { platform: "roblox", place: "Harbor Town (test place)", test: true, before, after,
      views: views.map((v, i) => ({ name: v, camera: cam(i), before: `${v.toLowerCase()}-before.png`, after: `${v.toLowerCase()}-after.png`, times: i === 0 ? [{ time: "Dusk 19:00", before: "spawn-dusk-before.png", after: "spawn-dusk-after.png" }] : [] })),
      undo: "Run the Undo script in the test place's Command Bar, or set the values under 'before' back by hand." },
    critique: { score: 7.5, summary: "Readable and warm; the far houses lose contrast against the sky.", mustFix: [], niceToHave: ["Lift OutdoorAmbient a touch on the pier side"], fixed: ["Fog was hiding the pier (FogEnd 400 -> 900)"], passes: 3, pictures: 14 } }));
  out.push(put("slime-sprite", { "slime.png": sprite() }, { kind: "pixel", title: "Slime enemy sprite", style: "general", source: { type: "chat" }, about: "A 16x16 slime for a small platformer: 6 colours, 1 px outline.", files: ["slime.png"] }));
  out.push(put("coin-chime", { "coin-chime.wav": wav() }, { kind: "audio", title: "Coin pickup chime", style: "general", source: { type: "chat" }, about: "Three rising notes with a quick decay; 1.4 s.", files: ["coin-chime.wav"] }));
  out.push(put("shop-panel", { "shop-panel.png": mockup() }, { kind: "image", title: "Shop panel mockup", style: "general", source: { type: "chat" }, about: "A dark shop panel with a gold header and a green Buy button.", files: ["shop-panel.png"] }));
  return out;
}
module.exports = { make, png, wav };
if (require.main === module) { const dir = process.argv[2]; if (!dir) { console.error("usage: node make-fixtures.js <taste inbox folder>"); process.exit(2); } console.log(make(dir).join("\n")); }
