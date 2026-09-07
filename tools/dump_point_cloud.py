"""Dump the desktop GlyphViz Point Cloud batches to JSON.

The desktop half of the point-cloud parity harness: runs the REAL
`glyphviz_core.point_cloud` module — `cloud_parent_ids`, `drawable_children`,
`point_size` and `build_batch`, fed from a real `Scene`'s baked transforms,
exactly as `Viewport._draw_point_clouds` feeds them — over a gv_node.csv, and
writes what each cloud would draw. The web side diffs its own
`PointCloudOverlay` against this in src/render/pointCloudOverlay.parity.test.ts.

`build_batch` is the check worth having: its positions come out of
`Scene.world_pos_rows`, i.e. the desktop's own `compute_world_transforms`, so
diffing them proves the web's batched points land where the desktop's do —
through grid parents, topo_scale, and an arbitrary chain of rotated and scaled
ancestors. The batch's `ids` order is diffed too, because that ordering is what
makes a point pickable: index i in the vertex array and index i in `ids` must be
the same node on both sides.

Both show-hidden states are dumped: `drawable_children` filters on `hide`, and
the two answers are different scenes.

Run with the desktop repo's conda env python (see that repo's CLAUDE.md for how
to locate it; never `conda run`):

    <glyphviz-env-python> tools/dump_point_cloud.py \
        src/gv/fixtures/point_cloud_gv_node.csv \
        src/gv/fixtures/point_cloud_batches.json

Regenerate the vendored JSON whenever the fixture CSV changes or the desktop
point-cloud/placement math changes. CI never runs this — the JSON is committed.
"""

import json
import sys
from pathlib import Path

# Import glyphviz_core from the sibling desktop repo without installing it.
DESKTOP_REPO = Path(__file__).resolve().parents[2] / "glyphviz"
sys.path.insert(0, str(DESKTOP_REPO))

from glyphviz_core import point_cloud as pc                 # noqa: E402
from glyphviz_core.csv_reader import load_node_csv          # noqa: E402
from glyphviz_core.node import NODE_TYPE_LINK               # noqa: E402
from glyphviz_core.scene import Scene                       # noqa: E402

BASE_SCALE = 1.0  # desktop Global Scale default


def children_map(nodes):
    """parent_id -> children in FILE order, links excluded — the viewport's own
    `_SceneScan.children_map`, which is what feeds `drawable_children`."""
    out = {}
    for n in nodes:
        if n.type == NODE_TYPE_LINK:
            continue
        out.setdefault(n.parent_id, []).append(n)
    return out


def dump_clouds(nodes, scene, show_hidden):
    kids_of = children_map(nodes)
    clouds = []
    for parent in nodes:
        if not pc.is_cloud_parent(parent):
            continue
        entry = {
            "parent_id": parent.id,
            "point_size": pc.point_size(parent),
            # The viewport skips a hidden cloud parent outright: the whole cloud
            # IS that parent's rendering, so there is nothing left to draw.
            "parent_hidden": bool(parent.hide) and not show_hidden,
        }
        kids = pc.drawable_children(kids_of.get(parent.id, []), show_hidden)
        mask, positions = scene.world_pos_rows([k.id for k in kids])
        if not mask.all():
            kids = [k for k, ok in zip(kids, mask) if ok]
        batch = pc.build_batch(kids, positions)
        if batch is None:
            entry["ids"] = []
            entry["positions"] = []
            entry["colors"] = []
        else:
            entry["ids"] = [int(i) for i in batch.ids]
            entry["positions"] = [[float(v) for v in p] for p in batch.positions]
            entry["colors"] = [[int(v) for v in c] for c in batch.colors]
        clouds.append(entry)
    return clouds


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    csv_path, out_path = Path(sys.argv[1]), Path(sys.argv[2])

    nodes = load_node_csv(str(csv_path))
    scene = Scene(nodes, base_scale=BASE_SCALE)

    payload = {
        "source": csv_path.name,
        "base_scale": BASE_SCALE,
        "cloud_parent_ids": sorted(int(i) for i in pc.cloud_parent_ids(nodes)),
        # The ratio -> pixels conversion and its clamps, sampled across and past
        # the range the Properties panel offers. A pure function, but the one a
        # cloud's whole appearance hangs off.
        "point_size_by_ratio": [
            [r, pc.point_size(_ratio_node(nodes, r))]
            for r in (0.0, 0.01, 0.05, 0.1, 0.15, 0.5, 1.0, 3.2, 3.5, 10.0, -1.0)
        ],
        "clouds": dump_clouds(nodes, scene, show_hidden=False),
        "clouds_show_hidden": dump_clouds(nodes, scene, show_hidden=True),
    }

    out_path.write_text(json.dumps(payload, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {out_path} — {len(payload['clouds'])} cloud(s)")
    return 0


def _ratio_node(nodes, ratio):
    """A throwaway copy of the first node with `ratio` swapped in — point_size
    reads a Node, and building one by hand would restate its constructor."""
    import copy

    n = copy.copy(nodes[0])
    n.ratio = ratio
    return n


if __name__ == "__main__":
    raise SystemExit(main())
