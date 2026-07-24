"""Dump the desktop GlyphViz engine's computed world transforms to JSON.

The desktop half of the cross-implementation parity harness (roadmap step 4):
runs the REAL engine (glyphviz_core.compute_world_transforms) over a
gv_node.csv and writes each node's world position and 3x3 world basis
(rotation + scale composition). The web side diffs its own scene graph
against this in src/render/parity.test.ts.

Run with the desktop repo's conda env python (see that repo's CLAUDE.md for
how to locate it; never `conda run`):

    <glyphviz-env-python> tools/dump_world_transforms.py \
        src/gv/fixtures/topology_example_gv_node.csv \
        src/gv/fixtures/topology_example_world_transforms.json

Regenerate the vendored JSON whenever the fixture CSV changes or the desktop
placement math changes. CI never runs this — the JSON is committed.
"""

import json
import sys
from pathlib import Path

# Import glyphviz_core from the sibling desktop repo without installing it.
DESKTOP_REPO = Path(__file__).resolve().parents[2] / "glyphviz"
sys.path.insert(0, str(DESKTOP_REPO))

from glyphviz_core.csv_reader import load_node_csv          # noqa: E402
from glyphviz_core.topology import compute_world_transforms  # noqa: E402

BASE_SCALE = 1.0  # desktop Global Scale default


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    csv_path, out_path = Path(sys.argv[1]), Path(sys.argv[2])

    nodes = load_node_csv(str(csv_path))
    t = compute_world_transforms(nodes, BASE_SCALE)

    entries = []
    for i, nd in enumerate(nodes):
        entries.append({
            "id": nd.id,
            "pos": [round(v, 12) for v in t.world_pos[i].tolist()],
            "basis": [[round(v, 12) for v in row] for row in t.world_basis[i].tolist()],
        })

    out = {
        "source_csv": csv_path.name,
        "base_scale": BASE_SCALE,
        "engine": "glyphviz_core.compute_world_transforms",
        "nodes": entries,
    }
    out_path.write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(f"Wrote {len(entries)} node transforms to {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
