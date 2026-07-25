"""Dump the desktop GlyphViz viewport's Plot/Surface overlay vertex stream.

The desktop half of the cross-implementation parity harness for roadmap step
7's Plot (topo 16) / Surface (topo 17) overlays. Unlike the placement dumps,
this logic lives in the Qt/OpenGL viewport rather than glyphviz_core, so the
tool runs the REAL `Viewport._draw_topology_overlays` headlessly: the module
does `from OpenGL.GL import *`, so replacing those names in its globals with
recorders captures the exact primitive/vertex stream the desktop would have
drawn, with no GL context and no reimplementation of the logic being tested.

The web side diffs its own TopologyOverlay.primitives() against this in
src/render/topologyOverlay.parity.test.ts.

Run with the desktop repo's conda env python (see that repo's CLAUDE.md for
how to locate it; never `conda run`):

    <glyphviz-env-python> tools/dump_topology_overlays.py \
        src/gv/fixtures/topology_example_gv_node.csv \
        src/gv/fixtures/topology_example_overlays.json [--show-hidden]

`--show-hidden` dumps the viewport's "Show Hidden Nodes" state instead, in
which hidden Plot/Surface parents and hidden children join the overlays.

Regenerate the vendored JSON whenever the fixture CSV or the desktop overlay
code changes. CI never runs this — the JSON is committed.
"""

import json
import sys
from pathlib import Path
from types import SimpleNamespace

# Import the desktop app from the sibling repo without installing it.
DESKTOP_REPO = Path(__file__).resolve().parents[2] / "glyphviz"
sys.path.insert(0, str(DESKTOP_REPO))

from glyphviz_core.csv_reader import load_node_csv   # noqa: E402
from glyphviz_core.scene import Scene                # noqa: E402
import glyphviz_gl.viewport as viewport              # noqa: E402

BASE_SCALE = 1.0  # desktop Global Scale default, matching the web app


class GLRecorder:
    """Stands in for the fixed-function GL calls _draw_topology_overlays makes.

    Records one entry per glBegin/glEnd block, snapshotting the color/normal
    state at each vertex exactly as OpenGL would have.
    """

    def __init__(self):
        self.primitives = []
        self._mode = None
        self._vertices = None
        self._color = (1.0, 1.0, 1.0, 1.0)
        self._normal = (0.0, 0.0, 1.0)
        self._line_width = 1.0
        self._point_size = 1.0
        self.prisms = []

    # --- recorded GL entry points ---
    def glBegin(self, mode):
        self._mode = MODE_NAMES.get(int(mode), str(mode))
        self._vertices = []

    def glEnd(self):
        self.primitives.append({
            "mode": self._mode,
            "lineWidth": self._line_width,
            "pointSize": self._point_size,
            "vertices": self._vertices,
        })
        self._mode = None
        self._vertices = None

    def glVertex3f(self, x, y, z):
        self._vertices.append({
            "pos": [float(x), float(y), float(z)],
            "color": [float(c) for c in self._color],
            "normal": [float(n) for n in self._normal],
        })

    def glColor4f(self, r, g, b, a):
        self._color = (r, g, b, a)

    def glNormal3f(self, x, y, z):
        self._normal = (x, y, z)

    def glLineWidth(self, w):
        self._line_width = float(w)

    def glPointSize(self, s):
        self._point_size = float(s)

    def noop(self, *_args, **_kwargs):
        pass

    def draw_link_prism(self, link, a_pos, b_pos):
        """Textured-prism links take their own draw path (already ported and
        parity-checked with the Link edges); record the call, draw nothing."""
        self.prisms.append({
            "linkId": int(link.id),
            "a": [float(v) for v in a_pos],
            "b": [float(v) for v in b_pos],
        })


MODE_NAMES = {}


def _init_mode_names():
    for name in ("GL_LINES", "GL_LINE_STRIP", "GL_POINTS", "GL_QUADS", "GL_TRIANGLES"):
        MODE_NAMES[int(getattr(viewport, name))] = name


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    show_hidden = "--show-hidden" in sys.argv[1:]
    if len(args) != 2:
        print(__doc__)
        return 2
    csv_path, out_path = Path(args[0]), Path(args[1])

    _init_mode_names()
    nodes = load_node_csv(str(csv_path))
    scene = Scene(nodes, base_scale=BASE_SCALE)

    rec = GLRecorder()
    patched = {
        "glBegin": rec.glBegin,
        "glEnd": rec.glEnd,
        "glVertex3f": rec.glVertex3f,
        "glColor4f": rec.glColor4f,
        "glNormal3f": rec.glNormal3f,
        "glLineWidth": rec.glLineWidth,
        "glPointSize": rec.glPointSize,
        "glEnable": rec.noop,
        "glDisable": rec.noop,
    }
    saved = {name: getattr(viewport, name) for name in patched}
    for name, fn in patched.items():
        setattr(viewport, name, fn)
    try:
        # Duck-typed stand-in for the Viewport instance: _draw_topology_overlays
        # touches only these three attributes.
        fake = SimpleNamespace(
            _scene=scene,
            show_hidden=show_hidden,
            _draw_link_prism=rec.draw_link_prism,
        )
        viewport.Viewport._draw_topology_overlays(fake)
    finally:
        for name, fn in saved.items():
            setattr(viewport, name, fn)

    out = {
        "source": csv_path.name,
        "baseScale": BASE_SCALE,
        "showHidden": show_hidden,
        "primitives": rec.primitives,
        "prisms": rec.prisms,
    }
    out_path.write_text(json.dumps(out, indent=1), encoding="utf-8")
    counts = {}
    for prim in rec.primitives:
        counts[prim["mode"]] = counts.get(prim["mode"], 0) + 1
    print(f"{csv_path.name}: {counts} -> {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
