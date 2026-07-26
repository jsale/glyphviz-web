"""Dump every built-in palette colour the desktop engine resolves, to JSON.

The desktop half of the palette parity check: runs the REAL
glyphviz_core.color_palette.resolve_palette_color over all 26 palettes across
each one's full color_index range (20 for palettes 0/1, 128 for the gradients),
plus a few out-of-range indices to pin the wraparound rule. The web side diffs
its own port against this in src/gv/colorPalette.parity.test.ts.

Run with the desktop repo's conda env python (see that repo's CLAUDE.md for
how to locate it; never `conda run`):

    <glyphviz-env-python> tools/dump_palette_colors.py \
        src/gv/fixtures/palette_colors.json

Regenerate the vendored JSON whenever the desktop palette tables or the
gradient/HSV math change. CI never runs this — the JSON is committed.
"""

import json
import sys
from pathlib import Path

# Import glyphviz_core from the sibling desktop repo without installing it.
DESKTOP_REPO = Path(__file__).resolve().parents[2] / "glyphviz"
sys.path.insert(0, str(DESKTOP_REPO))

from glyphviz_core.color_palette import (  # noqa: E402
    PALETTE_COUNT, PALETTE_NAMES, palette_index_count, resolve_palette_color,
)

# Indices outside a palette's range: the documented behaviour is modulo wrap,
# not clamp, and negatives have to wrap the Python way (never negative).
OUT_OF_RANGE = (-1, -20, -128, 128, 129, 255, 1000)


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    out_path = Path(sys.argv[1])

    palettes = []
    for pid in range(PALETTE_COUNT):
        count = palette_index_count(pid)
        palettes.append({
            "id": pid,
            "name": PALETTE_NAMES[pid],
            "index_count": count,
            "colors": [list(resolve_palette_color(pid, i)) for i in range(count)],
            "out_of_range": {
                str(i): list(resolve_palette_color(pid, i)) for i in OUT_OF_RANGE
            },
        })

    # Compact: 26 palettes of up to 128 RGB triples is a lot of brackets, and
    # nothing reads this file by eye — the test diffs it.
    out_path.write_text(
        json.dumps({"palette_count": PALETTE_COUNT, "palettes": palettes},
                   separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"wrote {out_path} ({len(palettes)} palettes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
