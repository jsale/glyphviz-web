"""Dump the desktop GlyphViz engine's per-node DRAW matrices to JSON.

Companion to dump_world_transforms.py. That one captures placement — world
position and the raw world basis — which is what src/render/parity.test.ts
diffs. This one captures what actually reaches the screen: the 4x4 returned by
`Scene.node_draw_data`, i.e. `node_world_matrix`'s

    M3 = parent_basis @ child_local @ S_child
    S_child = diag(own scale * base_scale, floored at 0.2)

The distinction is the whole point of this tool. base_scale and the 0.2 floor
live ONLY in the draw matrix, so a placement-only harness cannot see them — and
did not: the web app floored the ACCUMULATED world scale instead of each node's
own, which left deeply nested glyphs too big (reported 2026-07-27, visible as a
pasted hyperglyph overwhelming the child it was pasted onto).

Run with the desktop repo's conda env python (see that repo's CLAUDE.md for how
to locate it; never `conda run`):

    <glyphviz-env-python> tools/dump_draw_matrices.py \
        src/gv/fixtures/draw_scale_example_gv_node.csv \
        src/gv/fixtures/draw_scale_example_draw_matrices.json

Regenerate the vendored JSON whenever the fixture CSV changes or the desktop
draw math changes. CI never runs this — the JSON is committed.
"""

import json
import sys
from pathlib import Path

# Import glyphviz_core from the sibling desktop repo without installing it.
DESKTOP_REPO = Path(__file__).resolve().parents[2] / "glyphviz"
sys.path.insert(0, str(DESKTOP_REPO))

from glyphviz_core.csv_reader import load_node_csv   # noqa: E402
from glyphviz_core.scene import Scene                # noqa: E402

BASE_SCALE = 1.0  # desktop Global Scale default (glyphviz_gl/viewport.py)


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    csv_path, out_path = Path(sys.argv[1]), Path(sys.argv[2])

    nodes = load_node_csv(str(csv_path))
    scene = Scene(nodes, BASE_SCALE)

    entries = []
    for nd in nodes:
        M, _gl, radius = scene.node_draw_data(nd)
        entries.append({
            "id": nd.id,
            # Row-major 4x4, exactly as node_world_matrix returns it.
            "matrix": [[round(v, 12) for v in row] for row in M.tolist()],
            "radius": round(float(radius), 12),
        })

    out = {
        "source_csv": csv_path.name,
        "base_scale": BASE_SCALE,
        "engine": "glyphviz_core.scene.Scene.node_draw_data",
        "nodes": entries,
    }
    out_path.write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(f"Wrote {len(entries)} draw matrices to {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
