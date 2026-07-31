"""Dump the desktop basemap planner's decisions to JSON, for parity testing.

The desktop half of the Fetch Basemap parity check: runs the REAL
glyphviz_core.basemap over a spread of bounding boxes — bbox_from_nodes
derivation (padding + Mercator clamp), plan_basemap (zoom selection under the
tile cap, tile ranges, output size), and _reproject_to_equirect's actual
row/column sampling, captured by feeding it synthetic canvases whose pixels
encode their own position (the same trick as tests/test_basemap.py, so the
function under test is the real one, not a restatement). The web side diffs
its port against this in src/gv/basemap.parity.test.ts.

Run with the desktop repo's env python (see that repo's CLAUDE.md; never
`conda run`):

    $env:GLYPHVIZ_PYTHON tools/dump_basemap_plans.py \
        src/gv/fixtures/basemap_plans.json

Regenerate whenever the desktop's planner or reprojection math changes. CI
never runs this — the JSON is committed.
"""

import json
import sys
from pathlib import Path

import numpy as np

# Import glyphviz_core from the sibling desktop repo without installing it.
DESKTOP_REPO = Path(__file__).resolve().parents[2] / "glyphviz"
sys.path.insert(0, str(DESKTOP_REPO))

from glyphviz_core.basemap import (  # noqa: E402
    TILE_SIZE, BBox, _reproject_to_equirect, bbox_from_nodes, plan_basemap,
)
from glyphviz_core.node import NODE_TYPE_GRID, Node  # noqa: E402

# (name, bbox, provider, target_px, tile_cap) — regional windows across
# hemispheres and latitudes, the whole earth, degenerate-thin, and cap/target
# variants. None means the desktop default.
PLAN_CASES = [
    ("whole_earth", (-180, 180, -90, 90), None, None, None),
    ("whole_earth_cap48", (-180, 180, -90, 90), None, 1536, 48),
    ("contiguous_us", (-125, -66, 24, 49), None, None, None),
    ("contiguous_us_512", (-125, -66, 24, 49), None, 512, 48),
    ("socal_osm", (-118, -116, 32, 34), "osm", None, None),
    ("socal_esri", (-118, -116, 32, 34), "esri_imagery", None, None),
    ("socal_topo", (-118, -116, 32, 34), "opentopomap", None, None),
    ("scandinavia", (5, 31, 55, 71), None, None, None),
    ("southern_cone", (-75, -53, -56, -17), None, None, None),
    ("high_arctic", (-30, 30, 60, 85), None, None, None),
    ("tiny", (0, 0.001, 0, 0.001), None, None, None),
    ("single_city", (-117.7, -116.6, 32.2, 33.3), None, None, None),
]

# Reprojection sampling is dumped for these (small target keeps arrays short).
REPROJECT_CASES = ["contiguous_us_512", "scandinavia"]


def _node(id, parent_id=0, tx=0.0, ty=0.0, type=5):
    return Node(id=id, type=type, parent_id=parent_id, branch_level=1,
                translate_x=tx, translate_y=ty, translate_z=0.0,
                rotate_x=0.0, rotate_y=0.0, rotate_z=0.0,
                scale_x=1.0, scale_y=1.0, scale_z=1.0,
                color_r=0, color_g=0, color_b=0, color_a=255,
                geometry=7, hide=0, topo=0)


BBOX_FROM_NODES_CASES = {
    # Two children spanning a window; a grandchild and a stranger that must
    # not contribute.
    "two_kids": [
        _node(1, type=NODE_TYPE_GRID),
        _node(2, parent_id=1, tx=-120.0, ty=30.0),
        _node(3, parent_id=1, tx=-110.0, ty=40.0),
        _node(4, parent_id=2, tx=999.0, ty=999.0),
        _node(5, parent_id=0, tx=50.0, ty=50.0),
    ],
    # A single point: the half-degree cushion rule.
    "single_point": [
        _node(1, type=NODE_TYPE_GRID),
        _node(2, parent_id=1, tx=-117.16, ty=32.72),
    ],
    # Children hugging the poles/dateline: the clamp rule.
    "near_limits": [
        _node(1, type=NODE_TYPE_GRID),
        _node(2, parent_id=1, tx=-179.9, ty=-89.0),
        _node(3, parent_id=1, tx=179.9, ty=89.0),
    ],
}


def bbox_dict(b):
    return {"lon_min": b.lon_min, "lon_max": b.lon_max,
            "lat_min": b.lat_min, "lat_max": b.lat_max}


def reproject_sampling(plan):
    """Feed the real _reproject_to_equirect canvases whose pixels encode their
    own canvas row (R,G) or column (R,G), and read back which source row each
    output row came from and which source column each output column came from."""
    h = (plan.ty_max - plan.ty_min + 1) * TILE_SIZE
    w = (plan.tx_max - plan.tx_min + 1) * TILE_SIZE

    rows_canvas = np.zeros((h, w, 3), dtype=np.uint8)
    rows_canvas[:, :, 0] = (np.arange(h, dtype=np.int64)[:, None] >> 8).astype(np.uint8)
    rows_canvas[:, :, 1] = (np.arange(h, dtype=np.int64)[:, None] & 0xFF).astype(np.uint8)
    out = _reproject_to_equirect(rows_canvas, plan)
    src_rows = (out[:, 0, 0].astype(np.int64) << 8) | out[:, 0, 1].astype(np.int64)

    cols_canvas = np.zeros((h, w, 3), dtype=np.uint8)
    cols_canvas[:, :, 0] = (np.arange(w, dtype=np.int64)[None, :] >> 8).astype(np.uint8)
    cols_canvas[:, :, 1] = (np.arange(w, dtype=np.int64)[None, :] & 0xFF).astype(np.uint8)
    out = _reproject_to_equirect(cols_canvas, plan)
    src_cols = (out[0, :, 0].astype(np.int64) << 8) | out[0, :, 1].astype(np.int64)

    return {
        "out_shape": [int(out.shape[0]), int(src_cols.shape[0])],
        "src_rows": [int(v) for v in src_rows],
        "src_cols": [int(v) for v in src_cols],
    }


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    out_path = Path(sys.argv[1])

    plans = []
    for name, (lo_x, hi_x, lo_y, hi_y), provider, target, cap in PLAN_CASES:
        kwargs = {}
        if provider is not None:
            kwargs["provider_key"] = provider
        if target is not None:
            kwargs["target_px"] = target
        if cap is not None:
            kwargs["tile_cap"] = cap
        plan = plan_basemap(BBox(lo_x, hi_x, lo_y, hi_y), **kwargs)
        entry = {
            "name": name,
            "input_bbox": {"lon_min": lo_x, "lon_max": hi_x,
                           "lat_min": lo_y, "lat_max": hi_y},
            "provider": provider,
            "target_px": target,
            "tile_cap": cap,
            "plan": {
                "provider_key": plan.provider.key,
                "bbox": bbox_dict(plan.bbox),
                "zoom": plan.zoom,
                "tx_min": plan.tx_min, "tx_max": plan.tx_max,
                "ty_min": plan.ty_min, "ty_max": plan.ty_max,
                "out_w": plan.out_w, "out_h": plan.out_h,
                "tile_count": plan.tile_count,
            },
        }
        if name in REPROJECT_CASES:
            entry["reproject"] = reproject_sampling(plan)
        plans.append(entry)

    bboxes = {}
    for name, nodes in BBOX_FROM_NODES_CASES.items():
        b = bbox_from_nodes(nodes, grid_id=1)
        bboxes[name] = None if b is None else bbox_dict(b)

    out_path.write_text(json.dumps(
        {"plans": plans, "bbox_from_nodes": bboxes}, indent=1), encoding="utf-8")
    print(f"Wrote {len(plans)} plans, {len(bboxes)} bbox cases -> {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
