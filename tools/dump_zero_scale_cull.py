"""Dump the desktop GlyphViz viewport's ZERO-SCALE CULL verdict per node.

The desktop half of the parity harness for the cull that commit f73d006 added
to `glyphviz_gl/viewport.py`: a glyph whose RENDERED scale is zero on all three
axes covers no pixels, so the draw and pick loops skip it outright. On a terrain
whose Surface vertices are authored at scale 0 (the San Diego River Watershed
Atlas) that is most of the frame — the mesh is the picture and each vertex's own
glyph is noise, but the vertices have to stay visible (hide=1 deletes the mesh)
and opaque (the mesh takes their alpha), so scale 0 is the only way to say it.

The rule lives in the Qt/OpenGL viewport rather than in glyphviz_core, so this
tool runs the REAL `viewport._draws_nothing` against the REAL
`Scene.node_draw_data` radius — the same two calls the draw loop makes, in the
same order — rather than restating either. `radius` is dumped beside the verdict
because it is the whole input: it is the max column norm of the node's full
world draw matrix, so it also carries every ANCESTOR's raw scale, which is how a
zero-scale parent culls a subtree that is itself authored at scale 1.

Importing the viewport needs PySide6 present but no GL context and no window —
the function under test is module-level and pure (see dump_topology_overlays.py,
which imports the same module to record its GL calls).

The web side diffs its own render/zeroScale.ts against this in
src/render/zeroScale.parity.test.ts.

Run with the desktop repo's conda env python (see that repo's CLAUDE.md for how
to locate it; never `conda run`):

    <glyphviz-env-python> tools/dump_zero_scale_cull.py \
        src/gv/fixtures/zero_scale_gv_node.csv \
        src/gv/fixtures/zero_scale_cull.json [base_scale] [scale_floor]

Two optional arguments, NEITHER of which a fixture CSV can carry, and both of
which feed the radius the verdict is read from:

  3. the Global Scale (`Viewport.base_scale`), default 1.0.
  4. the minimum rendered size (`Scene.scale_floor`), default 0.0 = OFF, which
     is the desktop's default since 6d82d68 and this app's since 6v. Pass 0.2
     for the clamped state: there the desktop lifts an own-scale-0 node to the
     floor and stops culling it, which is the one place the two apps disagree
     (see zero_scale_cull_floor.json and the note in the web test).

Regenerate the vendored JSON whenever the fixture CSV changes or the desktop
cull rule changes. CI never runs this — the JSON is committed.
"""

import json
import os
import sys
from pathlib import Path

# Import the desktop app from the sibling repo without installing it.
DESKTOP_REPO = Path(__file__).resolve().parents[2] / "glyphviz"
sys.path.insert(0, str(DESKTOP_REPO))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from glyphviz_core.csv_reader import load_node_csv   # noqa: E402
from glyphviz_core.scene import Scene                # noqa: E402
import glyphviz_gl.viewport as viewport              # noqa: E402

DEFAULT_BASE_SCALE = 1.0  # desktop Global Scale default
NO_SCALE_FLOOR = 0.0      # desktop Scene.scale_floor default — the clamp is off


def main() -> int:
    if len(sys.argv) not in (3, 4, 5):
        print(__doc__)
        return 2
    csv_path, out_path = Path(sys.argv[1]), Path(sys.argv[2])
    base_scale = float(sys.argv[3]) if len(sys.argv) >= 4 else DEFAULT_BASE_SCALE
    scale_floor = float(sys.argv[4]) if len(sys.argv) == 5 else NO_SCALE_FLOOR

    nodes = load_node_csv(str(csv_path))
    scene = Scene(nodes, base_scale, scale_floor)

    entries = []
    for nd in nodes:
        _M, _gl, radius = scene.node_draw_data(nd)
        entries.append({
            "id": nd.id,
            "geometry": nd.geometry,
            "texture_id": nd.texture_id,
            "radius": round(float(radius), 12),
            # The verdict the draw and pick loops both branch on.
            "draws_nothing": bool(viewport._draws_nothing(nd, radius)),
        })

    out = {
        "source_csv": csv_path.name,
        "base_scale": base_scale,
        "scale_floor": scale_floor,
        "engine": "glyphviz_gl.viewport._draws_nothing",
        "wire_ids": sorted(int(g) for g in viewport._WIRE_IDS),
        "point_id": int(viewport.GEO_POINT),
        "nodes": entries,
    }
    out_path.write_text(json.dumps(out, indent=1), encoding="utf-8")
    culled = sum(1 for e in entries if e["draws_nothing"])
    print(f"Wrote {len(entries)} verdicts ({culled} culled) to {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
