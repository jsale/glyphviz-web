"""Dump what desktop GlyphViz's GIF reader produces, and write its fixtures.

The desktop half of the animated-GIF parity harness. Desktop GlyphViz plays a
multi-frame GIF texture through Qt's `QImageReader` (glyphviz_gl/
texture_manager.py, `_AnimatedGifEntry`): each `read()` hands back the next
frame already COMPOSITED onto the logical screen, and `nextImageDelay()` says
how long to hold it. Everything the web's own decoder (src/io/gifFile.ts) has
to agree with is therefore Qt's behaviour rather than the GIF spec's prose or a
browser's — which disposal fills with what, what sits outside a first frame
smaller than the screen, which frame a delay belongs to. This records it.

The fixtures are WRITTEN here, by a deliberately literal encoder below, rather
than produced by Pillow: Pillow re-optimises frames (crops, merges, re-orders
palettes) and would not leave the disposal method, transparent index or
sub-rectangle each case is about where the case put it. Each file states one
rule. They are tiny, and both sides read the same bytes, so a difference can
only be a difference in the DECODER.

Run with the desktop repo's conda env python (never `conda run`):

    <glyphviz-env-python> tools/dump_gif_frames.py src/io/fixtures/gif

Regenerate whenever Qt or the fixtures change. CI never runs this — the JSON and
the fixture files are committed.
"""

import base64
import json
import random
import sys
from pathlib import Path

from PySide6.QtGui import QImage, QImageReader


# ------------------------------------------------------------------ encoder ---

def lzw_encode(indices, min_code_size):
    """GIF-flavoured variable-width LZW, growing to 12 bits then clearing."""
    clear = 1 << min_code_size
    eoi = clear + 1
    out_bits = []  # (code, width)

    def reset():
        return {bytes([i]): i for i in range(clear)}, eoi + 1, min_code_size + 1

    table, next_code, width = reset()
    out_bits.append((clear, width))
    w = b""
    for k in indices:
        wk = w + bytes([k])
        if wk in table:
            w = wk
            continue
        out_bits.append((table[w], width))
        if next_code < 4096:
            table[wk] = next_code
            next_code += 1
            if next_code - 1 == (1 << width) and width < 12:
                width += 1
        else:
            out_bits.append((clear, width))
            table, next_code, width = reset()
        w = bytes([k])
    if w:
        out_bits.append((table[w], width))
    out_bits.append((eoi, width))

    acc = 0
    nbits = 0
    data = bytearray()
    for code, bits in out_bits:
        acc |= code << nbits
        nbits += bits
        while nbits >= 8:
            data.append(acc & 0xFF)
            acc >>= 8
            nbits -= 8
    if nbits:
        data.append(acc & 0xFF)
    return bytes(data)


def sub_blocks(data):
    out = bytearray()
    for i in range(0, len(data), 255):
        chunk = data[i:i + 255]
        out.append(len(chunk))
        out += chunk
    out.append(0)
    return bytes(out)


def table_bits(palette):
    """Size field for a colour table of len(palette) entries (padded to 2^n)."""
    n = 1
    while (1 << n) < len(palette):
        n += 1
    return n - 1


def table_bytes(palette):
    size = 1 << (table_bits(palette) + 1)
    out = bytearray()
    for i in range(size):
        out += bytes(palette[i] if i < len(palette) else (0, 0, 0))
    return bytes(out)


def interlace_rows(h):
    return (list(range(0, h, 8)) + list(range(4, h, 8)) +
            list(range(2, h, 4)) + list(range(1, h, 2)))


def write_gif(path, width, height, palette, frames, *, background=0, loop=True):
    """frames: dicts with pixels (row-major indices), and optional left/top/
    width/height, delay (centiseconds), disposal, transparent, local
    (palette), interlace."""
    out = bytearray(b"GIF89a")
    out += width.to_bytes(2, "little") + height.to_bytes(2, "little")
    if palette:
        out.append(0x80 | (7 << 4) | table_bits(palette))
    else:
        out.append(0x00)
    out.append(background)
    out.append(0)
    if palette:
        out += table_bytes(palette)
    if loop:
        out += b"\x21\xFF\x0BNETSCAPE2.0\x03\x01\x00\x00\x00"
    for f in frames:
        fw = f.get("width", width)
        fh = f.get("height", height)
        transparent = f.get("transparent")
        if f.get("gce", True):
            packed = (f.get("disposal", 1) << 2) | (1 if transparent is not None else 0)
            out += b"\x21\xF9\x04" + bytes([packed])
            out += f.get("delay", 10).to_bytes(2, "little")
            out.append(transparent if transparent is not None else 0)
            out.append(0)
        out.append(0x2C)
        out += f.get("left", 0).to_bytes(2, "little") + f.get("top", 0).to_bytes(2, "little")
        out += fw.to_bytes(2, "little") + fh.to_bytes(2, "little")
        local = f.get("local")
        flags = 0
        if local:
            flags |= 0x80 | table_bits(local)
        if f.get("interlace"):
            flags |= 0x40
        out.append(flags)
        if local:
            out += table_bytes(local)
        pixels = f["pixels"]
        if f.get("interlace"):
            rows = [pixels[r * fw:(r + 1) * fw] for r in range(fh)]
            pixels = [p for r in interlace_rows(fh) for p in rows[r]]
        colours = len(local) if local else len(palette)
        min_code = max(2, (colours - 1).bit_length())
        out.append(min_code)
        out += sub_blocks(lzw_encode(pixels, min_code))
    out.append(0x3B)
    path.write_bytes(bytes(out))


def fill(w, h, index):
    return [index] * (w * h)


# ----------------------------------------------------------------- fixtures ---

PALETTE4 = [(255, 0, 0), (0, 255, 0), (0, 0, 255), (255, 255, 0)]


def make_fixtures(folder: Path):
    """Each case states one rule. Returns {name: what it is about}."""
    cases = {}

    def case(name, about, *args, **kwargs):
        write_gif(folder / f"{name}.gif", *args, **kwargs)
        cases[name] = about

    case("basic", "three full frames, per-frame delays 100/200/300 ms",
         8, 8, PALETTE4,
         [{"pixels": fill(8, 8, i), "delay": d} for i, d in ((0, 10), (1, 20), (2, 30))])

    case("zero_delay", "delays of 0 and 1 cs - the desktop clamps both up to 20 ms",
         4, 4, PALETTE4,
         [{"pixels": fill(4, 4, 0), "delay": 0}, {"pixels": fill(4, 4, 1), "delay": 1}])

    case("short_delays", "2, 3 and 7 cs - where Qt's own small-delay floor stops",
         4, 4, PALETTE4,
         [{"pixels": fill(4, 4, i), "delay": d} for i, d in ((0, 2), (1, 3), (2, 7))])

    case("no_gce", "a frame with no Graphic Control Extension at all",
         4, 4, PALETTE4,
         [{"pixels": fill(4, 4, 0), "delay": 30},
          {"pixels": fill(4, 4, 1), "gce": False},
          {"pixels": fill(4, 4, 2), "delay": 50}])

    case("no_gce_after_transparent",
         "a GCE-less frame after a transparent one: does the transparent index carry over",
         4, 4, PALETTE4,
         [{"pixels": fill(4, 4, 0)},
          {"pixels": [3 if (x + y) % 2 else 1 for y in range(4) for x in range(4)],
           "transparent": 3},
          {"pixels": [3 if x < 2 else 2 for y in range(4) for x in range(4)], "gce": False}])

    case("restore_background_opaque",
         "disposal 2 with NO transparent index: what the vacated rect becomes",
         16, 16, PALETTE4,
         [{"pixels": fill(16, 16, 0)},
          {"pixels": fill(4, 4, 1), "left": 5, "top": 6, "width": 4, "height": 4,
           "disposal": 2},
          {"pixels": fill(2, 2, 3), "left": 0, "top": 0, "width": 2, "height": 2}],
         background=2)

    case("restore_background_transparent",
         "disposal 2 on a frame that HAS a transparent index",
         16, 16, PALETTE4,
         [{"pixels": fill(16, 16, 0)},
          {"pixels": fill(4, 4, 1), "left": 5, "top": 6, "width": 4, "height": 4,
           "disposal": 2, "transparent": 3},
          {"pixels": fill(2, 2, 3), "left": 0, "top": 0, "width": 2, "height": 2}],
         background=2)

    case("restore_background_alpha",
         "disposal 2 on a canvas that carries alpha (its first frame is transparent)",
         16, 16, PALETTE4,
         [{"pixels": [3 if x < 2 else 0 for y in range(16) for x in range(16)], "transparent": 3},
          {"pixels": fill(4, 4, 1), "left": 5, "top": 6, "width": 4, "height": 4,
           "disposal": 2, "transparent": 3},
          {"pixels": fill(2, 2, 2), "left": 12, "top": 0, "width": 2, "height": 2}],
         background=2)

    case("restore_previous", "disposal 3 puts back what was under the frame",
         16, 16, PALETTE4,
         [{"pixels": fill(16, 16, 0)},
          {"pixels": fill(6, 6, 1), "left": 2, "top": 2, "width": 6, "height": 6},
          {"pixels": fill(4, 4, 2), "left": 4, "top": 4, "width": 4, "height": 4,
           "disposal": 3},
          {"pixels": fill(2, 2, 3), "left": 12, "top": 12, "width": 2, "height": 2}])

    holes = [3 if (x + y) % 2 else 1 for y in range(8) for x in range(8)]
    case("transparent_overlay",
         "transparent pixels in a disposal-1 frame leave the frame below showing",
         8, 8, PALETTE4,
         [{"pixels": fill(8, 8, 0)}, {"pixels": holes, "transparent": 3}])

    case("first_frame_subrect",
         "a first frame smaller than the screen: what fills the rest",
         12, 10, PALETTE4,
         [{"pixels": fill(4, 4, 1), "left": 3, "top": 2, "width": 4, "height": 4},
          {"pixels": fill(2, 2, 2), "left": 0, "top": 0, "width": 2, "height": 2}],
         background=3)

    case("first_frame_subrect_transparent",
         "the same, when the first frame carries a transparent index",
         12, 10, PALETTE4,
         [{"pixels": fill(4, 4, 1), "left": 3, "top": 2, "width": 4, "height": 4,
           "transparent": 0},
          {"pixels": fill(2, 2, 2), "left": 0, "top": 0, "width": 2, "height": 2}],
         background=3)

    local = [(10, 20, 30), (40, 50, 60), (70, 80, 90), (100, 110, 120),
             (130, 140, 150), (160, 170, 180), (190, 200, 210), (220, 230, 240)]
    case("local_palette", "a frame carrying its own colour table",
         8, 8, PALETTE4,
         [{"pixels": fill(8, 8, 0)},
          {"pixels": [(x + y) % 8 for y in range(8) for x in range(8)], "local": local}])

    stripes = [y % 4 for y in range(13) for _ in range(16)]
    case("interlaced", "interlaced frames, an odd height to exercise every pass",
         16, 13, PALETTE4,
         [{"pixels": stripes, "interlace": True},
          {"pixels": [(y + 1) % 4 for y in range(13) for _ in range(16)], "interlace": True}])

    rng = random.Random(20261024)
    palette256 = [(rng.randrange(256), rng.randrange(256), rng.randrange(256)) for _ in range(256)]
    case("big_lzw", "256 colours of noise: the code width grows to 12 bits and clears",
         64, 48, palette256,
         [{"pixels": [rng.randrange(256) for _ in range(64 * 48)], "delay": 4}
          for _ in range(3)])

    case("single_frame", "one frame - the ordinary, non-animated image path",
         4, 4, PALETTE4, [{"pixels": fill(4, 4, 2)}], loop=False)

    return cases


# --------------------------------------------------------------------- dump ---

def dump(path: Path):
    """Read every frame the way _AnimatedGifEntry does: read(), then
    nextImageDelay(), until the reader runs dry."""
    reader = QImageReader(str(path))
    count = reader.imageCount()
    frames = []
    while True:
        img = reader.read()
        if img.isNull():
            break
        delay = reader.nextImageDelay()
        rgba = img.convertToFormat(QImage.Format.Format_RGBA8888)
        w, h = rgba.width(), rgba.height()
        raw = bytes(rgba.constBits())[: w * h * 4]
        frames.append({"delay": delay, "width": w, "height": h,
                       "rgba": base64.b64encode(raw).decode("ascii")})
        if len(frames) > 64:  # a reader that never runs dry would loop forever
            break
    return {"image_count": count, "frames": frames}


def main():
    folder = Path(sys.argv[1] if len(sys.argv) > 1 else "src/io/fixtures/gif")
    folder.mkdir(parents=True, exist_ok=True)
    cases = make_fixtures(folder)
    out = {name: {"about": about, **dump(folder / f"{name}.gif")}
           for name, about in cases.items()}
    (folder / "gif_frames.json").write_text(json.dumps(out, indent=1) + "\n")
    for name, case in out.items():
        delays = [f["delay"] for f in case["frames"]]
        print(f"{name}: {case['image_count']} image(s), delays {delays}")


if __name__ == "__main__":
    main()
