# Builds The Wise Hive app icon: Queen Claude, the pixel mascot from public/index.html (KIT.queen over BASE).
# Writes teamwright-icon.ico (16, 20, 24, 32, 40, 48, 64, 256; every frame drawn on its own with nearest-neighbour
# integer scaling, small frames as 32-bit BMP, 256 as PNG) and public/icon.svg (the favicon,
# also start.ps1's health check). A 1-pixel dark outline keeps the queen visible on light taskbars.
# Written and verified 2026-10-12 (Pillow 12.2). Rerun: python make-icon.py   (from <brain>\app)
# A new .ico filename sidesteps Windows' icon cache; if you change the art, bump the name in main.js too.
import io, os, struct, sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
O, E, G, RED, B, K, P = "#e5896a", "#1d1a18", "#e9b949", "#d64545", "#4aa3df", "#f2a3a0", "#7a4fc2"
LINE = "#1d1a18"
# Same rects as index.html (x, y, w, h, colour), painted in order: cape, body, crown/face.
RECTS = [(1, 5, 14, 8, P),
         (0, 6, 2, 2, O), (14, 6, 2, 2, O), (2, 4, 12, 7, O), (3, 11, 1, 2, O), (5, 11, 1, 2, O), (10, 11, 1, 2, O), (12, 11, 1, 2, O),
         (5, 6, 1, 2, E), (10, 6, 1, 2, E),
         (4, 2, 8, 2, G), (4, 0, 1, 2, G), (7, -1, 2, 3, G), (11, 0, 1, 2, G),
         (5, 2, 1, 1, RED), (10, 2, 1, 1, RED), (7, 2, 2, 1, B), (4, 8, 1, 1, K), (11, 8, 1, 1, K), (7, 9, 2, 1, E)]
X0, Y0, W, H = 0, -1, 16, 14  # art bounds

def rgba(h): return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5)) + (255,)

def art():
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    for x, y, w, h, c in RECTS:
        im.paste(rgba(c), (x - X0, y - Y0, x - X0 + w, y - Y0 + h))
    return im

# Per size: integer art scale and outline width in output pixels (0 = none). The outline is clipped at the canvas
# edge, so frames where the art fills the width only lose it on the tips of the arms.
# 24 is the Win10 taskbar size at 100%: 1x looked tiny there, so it uses "1.5", a hand-picked nearest-neighbour
# stretch that doubles chosen art columns/rows (eyes, cheeks, crown gems) and keeps the face symmetric.
PLAN = {16: (1, 0), 20: (1, 1), 24: (1.5, 1), 32: (2, 1), 40: (2, 1), 48: (3, 1), 64: (4, 1), 256: (16, 4)}
DUP_COLS = {3, 4, 5, 7, 8, 10, 11, 12}   # 16 -> 24 wide; widening 7-8 keeps the tall centre crown point, gem and mouth
DUP_ROWS = {2, 3, 5, 7, 9, 11, 12}        # 14 -> 21 tall

def scaled(s):
    if s != 1.5: return art().resize((W * s, H * s), Image.NEAREST)
    a = art(); src = a.load()
    cols = [x for x in range(W) for _ in range(2 if x in DUP_COLS else 1)]
    rows = [y for y in range(H) for _ in range(2 if y in DUP_ROWS else 1)]
    im = Image.new("RGBA", (len(cols), len(rows))); dst = im.load()
    for j, y in enumerate(rows):
        for i, x in enumerate(cols): dst[i, j] = src[x, y]
    return im

def frame(n):
    s, ow = PLAN[n]
    a = scaled(s)
    im = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    ox, oy = (n - a.size[0]) // 2, (n - a.size[1]) // 2
    im.paste(a, (ox, oy))
    if ow:
        src, px, line = im.load(), [], rgba(LINE)
        for y in range(n):
            for x in range(n):
                if src[x, y][3]: continue
                if any(0 <= x + dx < n and 0 <= y + dy < n and src[x + dx, y + dy][3]
                       for dx in range(-ow, ow + 1) for dy in range(-ow, ow + 1) if max(abs(dx), abs(dy)) <= ow):
                    px.append((x, y))
        for p in px: src[p] = line
    return im

def bmp_entry(im):
    n = im.size[0]
    hdr = struct.pack("<IiiHHIIiiII", 40, n, n * 2, 1, 32, 0, 0, 0, 0, 0, 0)
    px, xor, mask = im.load(), bytearray(), bytearray()
    row_bytes = ((n + 31) // 32) * 4
    for y in range(n - 1, -1, -1):  # bottom-up
        bits = bytearray(row_bytes)
        for x in range(n):
            r, g, b, a = px[x, y]
            xor += bytes((b, g, r, a))
            if a == 0: bits[x // 8] |= 0x80 >> (x % 8)
        mask += bits
    return hdr + bytes(xor) + bytes(mask)

def png_bytes(im):
    buf = io.BytesIO(); im.save(buf, "PNG", optimize=True); return buf.getvalue()

def write_ico(path, frames):
    datas = [png_bytes(f) if f.size[0] >= 256 else bmp_entry(f) for f in frames]
    out, off = bytearray(struct.pack("<HHH", 0, 1, len(frames))), 6 + 16 * len(frames)
    for f, d in zip(frames, datas):
        n = f.size[0] % 256
        out += struct.pack("<BBBBHHII", n, n, 0, 0, 1, 32, len(d), off); off += len(d)
    for d in datas: out += d
    with open(path, "wb") as fh: fh.write(out)

def svg():
    body = "".join(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{c}"/>' for x, y, w, h, c in RECTS)
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -2 16 16" shape-rendering="crispEdges">{body}</svg>\n'

if __name__ == "__main__":
    frames = [frame(n) for n in sorted(PLAN)]
    write_ico(os.path.join(HERE, "teamwright-icon.ico"), frames)
    with open(os.path.join(HERE, "public", "icon.svg"), "w", newline="\n") as fh: fh.write(svg())
    # Read the ICO back: every frame must equal the image drawn for its size (no resampling anywhere).
    ico = Image.open(os.path.join(HERE, "teamwright-icon.ico"))
    for f in frames:
        n = f.size[0]
        got = ico.ico.getimage((n, n)).convert("RGBA")
        if got.size != (n, n) or got.tobytes() != f.tobytes(): sys.exit(f"frame {n}: read-back mismatch")
    print("ok:", ", ".join(f"{n}x{n}" for n in sorted(PLAN)))
