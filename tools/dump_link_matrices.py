"""Dump link glyph matrices through the REAL desktop math to JSON.

A type-7 Link can be drawn as any geometry, stretched along the axis joining
its A-end and B-end (desktop 21f400c, `glyphviz_core/link_geometry.py`). The
transform is ANTz's own — `Rz(atan2(uy,ux) - 90) . Rx(asin(uz) + 90)` with
`ratio` on both cross-axes and the endpoint distance as the length — and it is
the one quantity the two apps have to agree about exactly: get the roll
convention or the z-span mapping wrong and a jointed hyperglyph composed on one
side comes apart on the other.

Nothing else in that module is app-specific either, so the dump also carries
`is_glyph_link` and `local_z_span` for every geometry id: the LINK_LINE_GEOMETRIES
membership IS the feature's back-compat surface (a scene whose links were parked
on Point must keep drawing lines), and the pin's asymmetric 0..1.1 span is the
one entry that is not the shared -1..1 default.

Cases deliberately include the awkward ones: a perfectly vertical edge, where
ANTz's atan2(0, 0) decides the roll; both vertical directions, which differ;
a zero-length edge, which has no axis and must come back as "no matrix" on both
sides rather than as a NaN one; a pin (asymmetric span, so the glyph is NOT
centred on the edge); and endpoints far from the origin, where the offset term
and the translation are the same order of magnitude.

Run with the desktop repo's conda env python (see that repo's CLAUDE.md; never
`conda run`):

    <glyphviz-env-python> tools/dump_link_matrices.py src/render/fixtures/link_matrices.json

Regenerate the vendored JSON only when the desktop link transform changes. CI
never runs this — the JSON is committed.
"""

import json
import sys
from pathlib import Path

# Import the desktop packages from the sibling repo without installing them.
DESKTOP_REPO = Path(__file__).resolve().parents[2] / "glyphviz"
sys.path.insert(0, str(DESKTOP_REPO))

from glyphviz_core.geometry_data import (                                # noqa: E402
    GEO_COUNT, GEO_CYLINDER, GEO_LINE, GEO_LINE_PRISM, GEO_PIN,
    GEO_PIN_WIRE, GEO_POINT, GEO_SPHERE,
)
from glyphviz_core.link_geometry import (                                # noqa: E402
    is_glyph_link, link_glyph_matrix, local_z_span,
)

# (label, A-end, B-end, ratio, geometry)
CASES = [
    ("along_x", (0, 0, 0), (10, 0, 0), 0.15, GEO_CYLINDER),
    ("along_y", (0, 0, 0), (0, 6, 0), 0.5, GEO_CYLINDER),
    ("vertical_up", (0, 0, 0), (0, 0, 4), 0.25, GEO_CYLINDER),
    ("vertical_down", (0, 0, 4), (0, 0, 0), 0.25, GEO_CYLINDER),
    ("diagonal", (1, 2, 3), (-4, 7, -2.5), 0.3, GEO_SPHERE),
    ("far_from_origin", (1000.5, -2000.25, 300), (1010, -1990, 305), 0.75, GEO_CYLINDER),
    ("tiny_edge", (0, 0, 0), (0.001, 0.0005, -0.0002), 0.02, GEO_CYLINDER),
    ("degenerate", (5, 5, 5), (5, 5, 5), 0.2, GEO_CYLINDER),
    # Pin: the one asymmetric local z span (0 .. PIN_HEIGHT + PIN_RADIUS), so
    # the tip lands ON the A-end instead of the shape straddling the midpoint.
    ("pin_diagonal", (0, 0, 0), (3, 4, 5), 0.4, GEO_PIN),
    ("pin_wire_along_x", (-2, 0, 0), (2, 0, 0), 0.1, GEO_PIN_WIRE),
    # Line/prism/point never reach this function in the app, but the math is
    # geometry-agnostic and pinning them proves the default span is what a
    # non-table id gets.
    ("line_id_default_span", (0, 0, 0), (1, 1, 1), 0.05, GEO_LINE),
    ("prism_id_default_span", (0, 0, 0), (0, -3, 1), 0.05, GEO_LINE_PRISM),
    ("point_id_default_span", (0, 0, 0), (2, 0, -2), 0.05, GEO_POINT),
    # Thickness extremes: the app floors ratio at 1e-4 before calling.
    ("hairline_ratio", (0, 0, 0), (0, 0, 10), 1e-4, GEO_CYLINDER),
    ("fat_ratio", (0, 0, 0), (0, 0, 10), 10.0, GEO_CYLINDER),
]


def main():
    out = (Path(sys.argv[1]) if len(sys.argv) > 1
           else Path("link_matrices.json"))
    cases = []
    for label, a, b, ratio, geo in CASES:
        M = link_glyph_matrix(a, b, ratio, geo)
        cases.append({
            "name": label,
            "a": list(a),
            "b": list(b),
            "ratio": ratio,
            "geometry": geo,
            # Row-major 4x4, the same convention dump_draw_matrices.py uses.
            "matrix": None if M is None else [[round(v, 12) for v in row]
                                              for row in M.tolist()],
        })

    geometries = [
        {
            "geometry": gid,
            "is_glyph_link": bool(is_glyph_link(gid)),
            "local_z_span": list(local_z_span(gid)),
        }
        for gid in range(GEO_COUNT)
    ]

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"cases": cases, "geometries": geometries},
                              indent=1), encoding="utf-8")
    print(f"wrote {out}: {len(cases)} matrices, {len(geometries)} geometry ids")


if __name__ == "__main__":
    main()
