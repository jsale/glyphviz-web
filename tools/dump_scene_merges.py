"""Dump the desktop GlyphViz File > Merge Node CSV... result to JSON.

The desktop half of the parity harness for src/gv/sceneMerge.ts: loads each
case's files with the REAL glyphviz_core.csv_reader.load_node_csv (so a
companion gv_tag.csv is applied exactly as the desktop applies it) and runs the
REAL glyphviz_core.scene_merge.merge_nodes, writing per case the counters, the
old -> new id map and every merged row's id-bearing and positional fields.

A case's host is built the way the app builds it: the first file is loaded,
and every further host file is MERGED into it in turn — so a chain of merges
is diffed as well as a single one. An empty host list is the web app's boot
state (a scene with no rows).

One rule is a deliberate web divergence (agreed with Jeff 2026-09-13): a LINK
whose A-end (parent_id) named a row that did not survive is DROPPED on the web,
where the desktop re-roots it to parent 0 and keeps it. Rather than bend the
dump, each case lists those links under "a_end_lost" (old id, and whether the
B-end survived), and the web test adjusts the desktop's rows and counters by
exactly that list. Everything else must match field for field.

Run with the desktop repo's conda env python (never `conda run`):

    <glyphviz-env-python> tools/dump_scene_merges.py src/gv/fixtures/merge/scene_merges.json

Regenerate whenever a fixture CSV or the desktop's merge rules change. CI never
runs this — the JSON is committed.
"""

import json
import sys
from pathlib import Path

DESKTOP_REPO = Path(__file__).resolve().parents[2] / "glyphviz"
sys.path.insert(0, str(DESKTOP_REPO))

from glyphviz_core.csv_reader import load_node_csv          # noqa: E402
from glyphviz_core.node import NODE_TYPE_LINK                # noqa: E402
from glyphviz_core.scene_merge import merge_nodes            # noqa: E402

FIXTURES = Path(__file__).resolve().parents[1] / "src" / "gv" / "fixtures"

FILES = {
    "topology": FIXTURES / "topology_example_gv_node.csv",     # tag-file scene
    "world_grid": FIXTURES / "world_grid_example_gv_node.csv",
    "selection": FIXTURES / "selection_export_gv_node.csv",    # links in and out, grids
    "topo_scale": FIXTURES / "topo_scale_gv_node.csv",
    "point_cloud": FIXTURES / "point_cloud_gv_node.csv",
    "plot_surface": FIXTURES / "plot_surface_example_gv_node.csv",
    "guest": FIXTURES / "merge" / "merge_guest_gv_node.csv",    # one row per rule
}

# (name, host files in load/merge order, incoming file)
CASES = [
    ("guest_into_topology", ["topology"], "guest"),
    ("guest_into_empty", [], "guest"),
    ("guest_twice", ["topology", "guest"], "guest"),
    ("topology_into_world_grid", ["world_grid"], "topology"),
    ("world_grid_into_topology", ["topology"], "world_grid"),
    ("topology_into_itself", ["topology"], "topology"),
    ("selection_into_topo_scale", ["topo_scale"], "selection"),
    ("point_cloud_into_plot_surface", ["plot_surface"], "point_cloud"),
    ("guest_into_selection", ["selection"], "guest"),
]


def _int_or_none(raw):
    if raw is None:
        return None
    try:
        return int(float(raw))
    except (TypeError, ValueError):
        return None


def _row(n):
    return {
        "id": n.id,
        "type": n.type,
        "parent_id": n.parent_id,
        "branch_level": n.branch_level,
        "translate": [n.translate_x, n.translate_y, n.translate_z],
        "texture_id": n.texture_id,
        "text": n.text,
        "link": n.link,
        "child_id": _int_or_none(n.extras.get("child_id")),
        "record_id": _int_or_none(n.extras.get("record_id")),
        "ch_input_id": _int_or_none(n.extras.get("ch_input_id")),
        "ch_output_id": _int_or_none(n.extras.get("ch_output_id")),
    }


def _a_end_lost(incoming, id_map):
    """Links the web drops for a lost A-end (see the module docstring)."""
    lost = []
    for n in incoming:
        if n.type != NODE_TYPE_LINK or n.id not in id_map:
            continue
        if n.parent_id != 0 and n.parent_id not in id_map:
            b = _int_or_none(n.extras.get("child_id")) or 0
            lost.append({"old_id": n.id, "b_end_inside": b in id_map})
    return lost


def main(out_path):
    cases = []
    for name, host_files, incoming_file in CASES:
        host = []
        for key in host_files:
            loaded = load_node_csv(str(FILES[key]))
            if not host:
                host = loaded
                continue
            # A chained host is built under the WEB rule, so both sides start
            # the final merge from the same scene; only that final merge is
            # dumped raw and adjusted in the test.
            step = merge_nodes(host, loaded)
            lost = {step.id_map[x["old_id"]] for x in _a_end_lost(loaded, step.id_map)}
            host = host + [n for n in step.nodes if n.id not in lost]
        incoming = load_node_csv(str(FILES[incoming_file]))
        result = merge_nodes(host, incoming)
        cases.append({
            "name": name,
            "host": host_files,
            "incoming": incoming_file,
            "host_count": len(host),
            "skipped_global": result.skipped_global,
            "dropped_links": result.dropped_links,
            "rerooted": result.rerooted,
            "cleared_channels": result.cleared_channels,
            "id_map": [[old, new] for old, new in result.id_map.items()],
            "a_end_lost": _a_end_lost(incoming, result.id_map),
            "nodes": [_row(n) for n in result.nodes],
        })
    files = {k: str(v.relative_to(FIXTURES)).replace("\\", "/") for k, v in FILES.items()}
    Path(out_path).write_text(json.dumps({"files": files, "cases": cases}, indent=1), encoding="utf-8")
    print(f"wrote {len(cases)} cases to {out_path}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else str(FIXTURES / "merge" / "scene_merges.json"))
