"""Dump the desktop Flat Ring glyph's vertex stream through the REAL builder.

The desktop half of the cross-implementation parity harness for the Flat Ring
(geometry 33/34, desktop 721b827) — a torus whose cross-section is a rectangle,
which the Armillary World example is built out of.

Like the Plot/Surface overlay dump beside it, the shape lives in the Qt/OpenGL
layer rather than in glyphviz_core, so this runs the REAL
`glyphviz_gl.geometry._draw_ring` headlessly: the module does
`from OpenGL.GL import *`, so replacing those names in its globals with
recorders captures the exact primitive/vertex stream the desktop would have
drawn, with no GL context and no restatement of the logic under test.

What is diffed, and why each half matters:

  * `ring_dims` for a spread of ratios — the load-bearing equivalence with
    `torus_radii`. Break it and swapping a Torus for a Flat Ring silently
    relocates every child of a Torus-topology parent.
  * The SOLID stream: four quad strips, and for every vertex its position,
    normal and texture coordinate in emission order. That is the whole of what
    the two apps have to agree about — the per-face constant normals (the crisp
    machined edge), the outward winding, and above all the per-face 0..1 UV
    span with each face's u running forwards from its own viewing side, which
    is what puts an undistorted marking strip on the outer wall AND on the dial
    face.
  * The WIRE stream: the four edge circles and the cross-section rungs.

The web side (src/render/uvGeometry.ts) emits its vertices in exactly this
order, so src/render/ringGeometry.parity.test.ts diffs the flat arrays
element for element.

Run with the desktop repo's conda env python (see that repo's CLAUDE.md for how
to locate it; never `conda run`):

    <glyphviz-env-python> tools/dump_ring_geometry.py \
        src/render/fixtures/ring_geometry.json

Regenerate the vendored JSON only when the desktop ring builder changes. CI
never runs this — the JSON is committed.
"""

import json
import sys
from pathlib import Path

# Import the desktop app from the sibling repo without installing it.
DESKTOP_REPO = Path(__file__).resolve().parents[2] / "glyphviz"
sys.path.insert(0, str(DESKTOP_REPO))

from glyphviz_core.geometry_data import (                                # noqa: E402
    GEO_RING, GEO_RING_WIRE, RATIO_SHAPED_GEOMETRIES, TORUS_DEFAULT_RATIO,
    ring_dims, torus_radii,
)
import glyphviz_gl.geometry as geometry                                  # noqa: E402

# The ratios the fixture covers: a hair-thin rail, the app default, a wide
# graduated dial, and two past 0.5 where the hole has closed and the shape
# becomes a solid wheel rather than inverting.
SOLID_RATIOS = [0.02, 0.05, TORUS_DEFAULT_RATIO, 0.25, 0.49, 0.5, 0.8]
WIRE_RATIOS = [0.05, TORUS_DEFAULT_RATIO, 0.6]

# Small station counts keep the fixture readable; the shape is periodic, so a
# builder that agrees at 8 stations agrees at the 48 both apps default to. The
# default counts are dumped too (see `defaults` below) so the web side cannot
# quietly draw a different tessellation.
RINGS = 8
RUNGS = 4


class Recorder:
    """Stands in for the GL entry points, latching state exactly as GL does."""

    def __init__(self):
        self.strips = []
        self.loops = []
        self._vertices = None
        self._uv = None
        self._normal = None
        self._lighting_calls = []

    def install(self):
        for name in dir(geometry):
            if not name.startswith("gl") or name.startswith("GL"):
                continue
            attr = getattr(geometry, name)
            if not callable(attr):
                continue
            setattr(geometry, name, self._stub(name))

    def _stub(self, name):
        def fn(*args):
            handler = getattr(self, "_on_" + name, None)
            if handler is not None:
                handler(*args)
            if name == "glIsEnabled":
                return False
            return None
        return fn

    # --- recorded GL entry points ---
    def _on_glBegin(self, _mode):
        self._vertices = []

    def _on_glEnd(self):
        if self._vertices is None:
            return
        self._flush(self._vertices)
        self._vertices = None

    def _on_glVertex3f(self, x, y, z):
        if self._vertices is None:
            return
        self._vertices.append({
            "pos": [float(x), float(y), float(z)],
            "uv": None if self._uv is None else [float(c) for c in self._uv],
            "normal": None if self._normal is None else [float(c) for c in self._normal],
        })

    def _on_glTexCoord2f(self, u, v):
        self._uv = (u, v)

    def _on_glNormal3f(self, x, y, z):
        self._normal = (x, y, z)

    def _on_glDisable(self, cap):
        self._lighting_calls.append(("disable", int(cap)))

    def _on_glEnable(self, cap):
        self._lighting_calls.append(("enable", int(cap)))

    def _flush(self, vertices):
        raise NotImplementedError


class SolidRecorder(Recorder):
    def _flush(self, vertices):
        self.strips.append(vertices)


class WireRecorder(Recorder):
    def _flush(self, vertices):
        self.loops.append([v["pos"] for v in vertices])


def dump_solid(ratio):
    saved = {name: getattr(geometry, name) for name in dir(geometry)
             if name.startswith("gl") and not name.startswith("GL")
             and callable(getattr(geometry, name))}
    rec = SolidRecorder()
    rec.install()
    try:
        geometry._draw_ring(True, ratio, rings=RINGS, textured=True)
    finally:
        for name, value in saved.items():
            setattr(geometry, name, value)
    return rec.strips


def dump_wire(ratio):
    saved = {name: getattr(geometry, name) for name in dir(geometry)
             if name.startswith("gl") and not name.startswith("GL")
             and callable(getattr(geometry, name))}
    rec = WireRecorder()
    rec.install()
    try:
        geometry._draw_ring(False, ratio, rings=RINGS, rungs=RUNGS)
    finally:
        for name, value in saved.items():
            setattr(geometry, name, value)
    return rec.loops


def main(argv):
    if len(argv) != 2:
        print(__doc__)
        return 2
    out_path = Path(argv[1])

    import inspect
    signature = inspect.signature(geometry._draw_ring)

    payload = {
        "rings": RINGS,
        "rungs": RUNGS,
        # The builder's OWN defaults, so a divergence in tessellation shows up
        # as a failing assertion rather than as an invisible difference.
        "defaults": {
            "rings": signature.parameters["rings"].default,
            "rungs": signature.parameters["rungs"].default,
            "ratio": signature.parameters["ratio"].default,
        },
        "ratioShapedGeometries": sorted(int(g) for g in RATIO_SHAPED_GEOMETRIES),
        "ringIds": {"solid": int(GEO_RING), "wire": int(GEO_RING_WIRE)},
        "dims": [
            {
                "ratio": ratio,
                "ring_dims": [float(v) for v in ring_dims(ratio)],
                "torus_radii": [float(v) for v in torus_radii(ratio)],
            }
            for ratio in SOLID_RATIOS + [0.14, 1.0]
        ],
        "solid": [
            {"ratio": ratio, "strips": dump_solid(ratio)} for ratio in SOLID_RATIOS
        ],
        "wire": [
            {"ratio": ratio, "loops": dump_wire(ratio)} for ratio in WIRE_RATIOS
        ],
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=1), encoding="utf-8")
    strip_count = sum(len(entry["strips"]) for entry in payload["solid"])
    loop_count = sum(len(entry["loops"]) for entry in payload["wire"])
    print(f"wrote {out_path} — {strip_count} solid strips, {loop_count} wire loops")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
