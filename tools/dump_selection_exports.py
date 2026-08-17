"""Dump the desktop GlyphViz Save Selection As… export to JSON.

The desktop half of the parity harness for src/gv/selectionExport.ts: runs the
REAL glyphviz_core.selection_export over a set of scenes/selections/options and
writes, per case, the plan's counts and every exported row's transform fields —
which is where the whole feature lives, since a detached node's translate,
rotate, scale and rotation_mode are all rewritten by the bake.

Two lower layers are dumped alongside it, because a whole-export diff cannot
say WHICH half disagreed:

  * decompose_basis over a battery of bases (clean, reflected, collapsed axis,
    sheared) — the linear algebra the bake rests on, and the one part the web
    had to reach by a different route (Higham's polar iteration; JavaScript
    ships no SVD).
  * euler_xyz_from_matrix over a set of rotations including gimbal lock.

The web side computes its OWN world placements (src/render/selectionPlacement.ts)
rather than reading the desktop's, so a passing diff covers placement, bake and
membership end to end.

Run with the desktop repo's conda env python (see that repo's CLAUDE.md for how
to locate it; never `conda run`):

    <glyphviz-env-python> tools/dump_selection_exports.py \
        src/gv/fixtures/selection_exports.json

Regenerate the vendored JSON whenever a fixture CSV or the desktop's export
math changes. CI never runs this — the JSON is committed.
"""

import json
import sys
from pathlib import Path

import numpy as np

# Import glyphviz_core from the sibling desktop repo without installing it.
DESKTOP_REPO = Path(__file__).resolve().parents[2] / "glyphviz"
sys.path.insert(0, str(DESKTOP_REPO))

from glyphviz_core.csv_reader import load_node_csv                    # noqa: E402
from glyphviz_core.node import ROTATION_MODE_EULER_XYZ                # noqa: E402
from glyphviz_core.scene import Scene                                 # noqa: E402
from glyphviz_core.selection_export import (                          # noqa: E402
    DETACH_ANCESTORS, DETACH_BAKE, DETACH_RAW, ExportOptions,
    build_selection, decompose_basis, euler_xyz_from_matrix,
)
from glyphviz_core.topology import local_rotation_matrix              # noqa: E402

BASE_SCALE = 1.0  # desktop Global Scale default; the bake is exact at it

FIXTURES = Path(__file__).resolve().parents[1] / "src" / "gv" / "fixtures"

# (name, fixture csv, selected ids, ExportOptions kwargs)
CASES = [
    # --- the synthetic scene, one case per rule -----------------------------
    ("subtree_bake", "selection_export", [3], {}),
    ("subtree_bake_deeper", "selection_export", [4], {}),
    ("leaf_bake", "selection_export", [5], {}),
    ("rod_bake", "selection_export", [8], {}),
    ("root_selection", "selection_export", [2], {}),
    ("scattered_leaves", "selection_export", [5, 6], {}),
    ("no_descendants", "selection_export", [4], {"include_descendants": False}),
    ("link_both_ends_unselected", "selection_export", [4, 6],
     {"include_descendants": False}),
    ("ancestors", "selection_export", [5], {"detach": DETACH_ANCESTORS}),
    ("ancestors_from_root", "selection_export", [2], {"detach": DETACH_ANCESTORS}),
    ("raw", "selection_export", [3], {"detach": DETACH_RAW}),
    ("no_world_row", "selection_export", [5], {"include_world_row": False}),
    ("world_row_selected", "selection_export", [1, 5], {}),
    ("sheared_ancestor", "selection_export", [22], {}),
    ("flat_grid_child", "selection_export", [31], {}),
    ("flat_grid_itself", "selection_export", [30], {}),
    ("globe_grid_child", "selection_export", [41], {}),
    ("globe_grid_itself", "selection_export", [40], {}),
    ("grid_ancestors", "selection_export", [31], {"detach": DETACH_ANCESTORS}),
    ("topo_scale_parent_child", "selection_export", [51], {}),
    ("collapsed_axis", "selection_export", [51], {}),
    ("everything", "selection_export", [2, 20, 21, 40, 50], {}),
    # --- and the real scenes behind it --------------------------------------
    ("topology_example_deep", "topology_example", [37, 60, 88], {}),
    ("topology_example_all", "topology_example", None, {}),
    ("topology_example_raw", "topology_example", [37, 60, 88], {"detach": DETACH_RAW}),
    ("topology_example_ancestors", "topology_example", [60],
     {"detach": DETACH_ANCESTORS}),
    ("world_grid_example_children", "world_grid_example", None, {}),
    ("topo_scale_example", "topo_scale", None, {}),
]

# Bases fed to decompose_basis directly: the four kinds it distinguishes.
def _basis_battery():
    R = np.array(local_rotation_matrix(20.0, -35.0, 80.0, ROTATION_MODE_EULER_XYZ))
    R2 = np.array(local_rotation_matrix(10.0, 20.0, 30.0, ROTATION_MODE_EULER_XYZ))
    R3 = np.array(local_rotation_matrix(45.0, 0.0, 0.0, ROTATION_MODE_EULER_XYZ))
    return [
        ("identity", np.eye(3)),
        ("rotation_only", R),
        ("rotation_scaled", R @ np.diag([2.0, 0.5, 3.25])),
        ("uniform_scale", R2 @ np.diag([1.5, 1.5, 1.5])),
        ("reflection_y", R2 @ np.diag([1.0, -2.0, 1.0])),
        ("reflection_all", R2 @ np.diag([-1.0, -1.0, -1.0])),
        ("collapsed_y", R3 @ np.diag([1.0, 0.0, 2.0])),
        ("collapsed_xy", R3 @ np.diag([0.0, 0.0, 2.0])),
        ("collapsed_all", np.zeros((3, 3))),
        ("sheared", np.array([[1.0, 0.4, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]])),
        ("sheared_scaled", np.array([[3.0, 0.9, 0.0], [0.0, 1.0, 0.0], [0.2, 0.0, 0.5]])),
        ("tiny_shear", np.array([[1.0, 1e-9, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]])),
    ]


EULER_ANGLES = [
    (0.0, 0.0, 0.0),
    (30.0, 45.0, 60.0),
    (-120.0, 15.0, 175.0),
    (10.0, -80.0, -95.0),
    (0.0, 90.0, 0.0),       # gimbal lock
    (33.0, -90.0, 21.0),    # gimbal lock, rotation split between rx and rz
    (180.0, 0.0, 180.0),
    (-45.0, 89.9999, 12.0),
]


def _round(v, places=12):
    return round(float(v), places)


def _node_entry(nd):
    return {
        "id": nd.id,
        "type": nd.type,
        "parent_id": nd.parent_id,
        "branch_level": nd.branch_level,
        "translate": [_round(nd.translate_x), _round(nd.translate_y), _round(nd.translate_z)],
        "rotate": [_round(nd.rotate_x), _round(nd.rotate_y), _round(nd.rotate_z)],
        "scale": [_round(nd.scale_x), _round(nd.scale_y), _round(nd.scale_z)],
        "rotation_mode": nd.rotation_mode,
        "topo": nd.topo,
        "ratio": _round(nd.ratio),
        "topo_scale": _round(nd.topo_scale),
        "subspace": nd.subspace,
    }


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    out_path = Path(sys.argv[1])

    scenes = {}
    for _name, fixture, _ids, _opts in CASES:
        if fixture not in scenes:
            csv_path = FIXTURES / f"{fixture}_gv_node.csv"
            scenes[fixture] = load_node_csv(str(csv_path))

    cases = []
    for name, fixture, ids, opt_kwargs in CASES:
        nodes = load_node_csv(str(FIXTURES / f"{fixture}_gv_node.csv"))
        scene = Scene(nodes, base_scale=BASE_SCALE)
        # None means "every bulk-selectable row", the Ctrl+A case.
        selected = [n.id for n in nodes] if ids is None else ids
        options = ExportOptions(**opt_kwargs)
        export = build_selection(scene, set(selected), options)
        cases.append({
            "name": name,
            "fixture": fixture,
            "selected": sorted(selected),
            "options": {
                "include_descendants": options.include_descendants,
                "detach": options.detach,
                "include_world_row": options.include_world_row,
            },
            "plan": {
                "ids": export.plan.ids,
                "detached_ids": export.plan.detached_ids,
                "descendants_added": export.plan.descendants_added,
                "ancestors_added": export.plan.ancestors_added,
                "links_added": export.plan.links_added,
                "dropped_links": export.plan.dropped_links,
                "world_id": export.plan.world_id,
                "count": export.plan.count,
            },
            "approximated_ids": export.approximated_ids,
            "animated_detached": export.animated_detached,
            "nodes": [_node_entry(n) for n in export.nodes],
        })

    # These two blocks are dumped at FULL double precision, unrounded. They are
    # the inputs the web side feeds back into the same arithmetic, and rounding
    # a basis to 12 places invents ~1e-12 of shear in it — enough to make an
    # exact decomposition disagree with itself, and (near gimbal lock, where
    # cos(ry) is recovered through a square root) enough to move an angle by
    # 3e-7. The node rows above are rounded because they are OUTPUTS, compared
    # with a tolerance.
    decompositions = []
    for label, A in _basis_battery():
        R, s, shear = decompose_basis(A)
        decompositions.append({
            "name": label,
            "basis": np.asarray(A).tolist(),
            "rotation": R.tolist(),
            "scale": s.tolist(),
            "shear": float(shear),
            "euler": list(euler_xyz_from_matrix(R)),
        })

    eulers = []
    for angles in EULER_ANGLES:
        R = np.array(local_rotation_matrix(*angles, ROTATION_MODE_EULER_XYZ))
        eulers.append({
            "angles": list(angles),
            "matrix": R.tolist(),
            "recovered": list(euler_xyz_from_matrix(R)),
        })

    out = {
        "engine": "glyphviz_core.selection_export.build_selection",
        "base_scale": BASE_SCALE,
        "cases": cases,
        "decompositions": decompositions,
        "eulers": eulers,
    }
    out_path.write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(f"Wrote {len(cases)} export cases, {len(decompositions)} decompositions, "
          f"{len(eulers)} rotations to {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
