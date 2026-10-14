/* Tiny self-contained QR code encoder (byte mode, versions 1-40, ECC L/M/Q/H, automatic mask choice) so the
   Settings page can show the phone link as a scannable code without any npm package or web service.
   Written from the QR spec (ISO/IEC 18004); checked by decoding with jsQR across all versions and levels.
   Browser: window.HiveQR.svg(text) -> "<svg…>". Node: require("./qr.js").matrix(text) for tests. */
(function (root) {
  "use strict";
  // Per version (index 1-40), from the spec's error correction tables. Index 0 unused.
  const ECC_PER_BLOCK = {
    L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  };
  const BLOCKS = {
    L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
  };
  const FORMAT_ECL = { L: 1, M: 0, Q: 3, H: 2 };

  // Modules left for data after finder, timing, alignment, format and version areas.
  function rawModules(v) {
    let r = (16 * v + 128) * v + 64;
    if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; }
    return r;
  }
  const dataCodewords = (v, ecl) => Math.floor(rawModules(v) / 8) - ECC_PER_BLOCK[ecl][v] * BLOCKS[ecl][v];
  function alignPositions(v) {
    if (v === 1) return [];
    const n = Math.floor(v / 7) + 2, size = v * 4 + 17;
    const step = v === 32 ? 26 : Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2;
    const out = [6];
    for (let pos = size - 7; out.length < n; pos -= step) out.splice(1, 0, pos);
    return out;
  }

  // GF(256) arithmetic over x^8+x^4+x^3+x^2+1 and the Reed-Solomon remainder.
  function gmul(x, y) { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; } return z & 0xff; }
  function rsDivisor(d) {
    const r = new Array(d).fill(0); r[d - 1] = 1; let root = 1;
    for (let i = 0; i < d; i++) { for (let j = 0; j < d; j++) { r[j] = gmul(r[j], root); if (j + 1 < d) r[j] ^= r[j + 1]; } root = gmul(root, 2); }
    return r;
  }
  function rsRemainder(data, div) {
    const r = new Array(div.length).fill(0);
    for (const b of data) { const f = b ^ r.shift(); r.push(0); for (let i = 0; i < div.length; i++) r[i] ^= gmul(div[i], f); }
    return r;
  }

  const utf8 = (s) => (typeof TextEncoder !== "undefined" ? Array.from(new TextEncoder().encode(s)) : Array.from(Buffer.from(s, "utf8")));

  function matrix(text, ecl = "M") {
    if (!ECC_PER_BLOCK[ecl]) throw new Error("ECC level must be L, M, Q or H");
    const bytes = utf8(String(text));
    let v = 1;
    for (; v <= 40; v++) if (4 + (v <= 9 ? 8 : 16) + bytes.length * 8 <= dataCodewords(v, ecl) * 8) break;
    if (v > 40) throw new Error("Text too long for a QR code");
    // Bit stream: byte mode, count, data, terminator, byte padding, then alternating pad bytes.
    const bits = [];
    const put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(4, 4); put(bytes.length, v <= 9 ? 8 : 16); for (const b of bytes) put(b, 8);
    const cap = dataCodewords(v, ecl) * 8;
    put(0, Math.min(4, cap - bits.length));
    put(0, (8 - (bits.length % 8)) % 8);
    for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; data.push(b); }

    // Split into blocks, add error correction, interleave.
    const nb = BLOCKS[ecl][v], eccLen = ECC_PER_BLOCK[ecl][v], raw = Math.floor(rawModules(v) / 8);
    const nShort = nb - (raw % nb), shortLen = Math.floor(raw / nb), div = rsDivisor(eccLen);
    const blocks = [];
    for (let i = 0, k = 0; i < nb; i++) {
      const dat = data.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1)); k += dat.length;
      const ecc = rsRemainder(dat, div);
      if (i < nShort) dat.push(0); // placeholder so all blocks line up; skipped below
      blocks.push(dat.concat(ecc));
    }
    const words = [];
    for (let i = 0; i < blocks[0].length; i++) for (let j = 0; j < nb; j++) if (i !== shortLen - eccLen || j >= nShort) words.push(blocks[j][i]);

    // Function patterns.
    const size = v * 4 + 17;
    const mod = Array.from({ length: size }, () => new Array(size).fill(false));
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y, dark) => { mod[y][x] = dark; fn[y][x] = true; };
    for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    const al = alignPositions(v), last = al.length - 1;
    for (let i = 0; i < al.length; i++) for (let j = 0; j < al.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    const drawFormat = (mask) => {
      const d = (FORMAT_ECL[ecl] << 3) | mask;
      let r = d; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
      const b = ((d << 10) | r) ^ 0x5412, bit = (i) => ((b >>> i) & 1) === 1;
      for (let i = 0; i <= 5; i++) set(8, i, bit(i));
      set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
      for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
      set(8, size - 8, true); // the always-dark module
    };
    drawFormat(0); // reserves the format area before data placement
    if (v >= 7) {
      let r = v; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
      const b = (v << 12) | r;
      for (let i = 0; i < 18; i++) { const dark = ((b >>> i) & 1) === 1, a = size - 11 + (i % 3), c = Math.floor(i / 3); set(a, c, dark); set(c, a, dark); }
    }

    // Data in the zigzag order: two-column strips from the right, skipping the vertical timing column.
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
        const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
        if (!fn[y][x] && i < words.length * 8) { mod[y][x] = ((words[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++; }
      }
    }

    const MASKS = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
      (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0];
    const applyMask = (m) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[m](x, y)) mod[y][x] = !mod[y][x]; };
    // Penalty score (spec rules N1-N4) to pick the most readable mask; any mask decodes, this just helps cameras.
    const penalty = () => {
      let s = 0, dark = 0;
      const line = (get) => {
        let run = 1;
        for (let k = 1; k <= size; k++) {
          if (k < size && get(k) === get(k - 1)) { run++; continue; }
          if (run >= 5) s += run - 2;
          run = 1;
        }
        for (let k = 0; k + 6 < size; k++) {
          const p = [1, 0, 1, 1, 1, 0, 1].every((b, n) => get(k + n) === !!b);
          if (!p) continue;
          const lightBefore = [1, 2, 3, 4].every((n) => k - n < 0 || !get(k - n)), lightAfter = [7, 8, 9, 10].every((n) => k + n >= size || !get(k + n));
          if (lightBefore || lightAfter) s += 40;
        }
      };
      for (let y = 0; y < size; y++) line((x) => mod[y][x]);
      for (let x = 0; x < size; x++) line((y) => mod[y][x]);
      for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) { const c = mod[y][x]; if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) s += 3; }
      for (const row of mod) for (const c of row) if (c) dark++;
      const total = size * size;
      return s + (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    };
    let best = 0, bestScore = Infinity;
    for (let m = 0; m < 8; m++) { applyMask(m); drawFormat(m); const sc = penalty(); if (sc < bestScore) { bestScore = sc; best = m; } applyMask(m); }
    applyMask(best); drawFormat(best);
    return { version: v, size, mask: best, modules: mod };
  }

  // One SVG path for all dark modules, with the 4-module quiet zone scanners need.
  function svg(text, { ecl = "M", border = 4, dark = "#000", light = "#fff", px } = {}) {
    const q = matrix(text, ecl), n = q.size + border * 2, parts = [];
    for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (q.modules[y][x]) parts.push(`M${x + border},${y + border}h1v1h-1z`);
    const wh = px ? ` width="${px}" height="${px}"` : "";
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}"${wh} shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${n}" height="${n}" fill="${light}"/><path d="${parts.join("")}" fill="${dark}"/></svg>`;
  }

  const QR = { matrix, svg };
  if (typeof module === "object" && module.exports) module.exports = QR;
  else root.HiveQR = QR;
})(typeof self !== "undefined" ? self : this);
