"""Dump Draw Mode's geometry and jitter through the REAL desktop functions.

The web app's Draw Mode (D) is a port of desktop `glyphviz_core/draw_mode.py`,
and two things in it are worth pinning across the implementations:

  - `grid_hit`, the screen→grid inversion. Its round trip is already proved
    end to end on the web side (src/render/drawPlane.test.ts stamps a child at
    the returned lon/lat and re-projects it onto the clicked pixel), but that
    proves the web is self-consistent, not that the two apps AGREE. This dumps
    the desktop's own answers for rays and grid frames chosen to cover the
    cases the round trip cannot distinguish: an extents window whose centre is
    not (0, 0), a rotated and non-uniformly scaled basis, a nested grid, a
    non-zero drawing plane, and all three of its None cases.

  - `place_stamp`'s JITTER, which is the only randomness in the feature. The
    desktop draws it from `random.uniform`, so a seeded `random.Random`
    reproduces exactly what the web's `PythonRandom` must — heading first,
    then the scale factor, and NEITHER drawn when its control is 0 (the
    short-circuit is observable: it decides whether a later stamp's draws line
    up).

`should_stamp` is dumped too — it is small, but the boundary is `>=` and a
port that made it `>` would only show up as a slightly sparser stroke.

Run with the desktop repo's conda env python (see that repo's CLAUDE.md for
how to locate it; never `conda run`):

    <glyphviz-env-python> tools/dump_draw_stamps.py src/gv/fixtures/draw_stamps.json

Regenerate the vendored JSON only when the desktop's draw_mode module changes.
CI never runs this — the JSON is committed.
"""

import json
import random
import sys
from pathlib import Path

import numpy as np

# Import the desktop packages from the sibling repo without installing them.
DESKTOP_REPO = Path(__file__).resolve().parents[2] / "glyphviz"
sys.path.insert(0, str(DESKTOP_REPO))

from glyphviz_core.draw_mode import grid_hit, place_stamp, should_stamp   # noqa: E402
from glyphviz_core.glyph_recipe import default_recipe, generate_nodes     # noqa: E402
from glyphviz_core.node import Node                                       # noqa: E402

STAMP_FIELDS = [
    "id", "parent_id", "branch_level",
    "translate_x", "translate_y", "translate_z",
    "rotate_x", "rotate_y", "rotate_z",
    "scale_x", "scale_y", "scale_z",
]


def rot_z(deg):
    r = np.radians(deg)
    return np.array([[np.cos(r), -np.sin(r), 0.0],
                     [np.sin(r), np.cos(r), 0.0],
                     [0.0, 0.0, 1.0]])


def rot_x(deg):
    r = np.radians(deg)
    return np.array([[1.0, 0.0, 0.0],
                     [0.0, np.cos(r), -np.sin(r)],
                     [0.0, np.sin(r), np.cos(r)]])


def unit(v):
    v = np.asarray(v, dtype=np.float64)
    return v / np.linalg.norm(v)


def hit_case(name, origin, direction, grid_pos, basis, center, draw_z):
    """One grid_hit case. `basis` is the grid's FULL world basis (rotation ×
    cumulative scale), the same matrix the web composes as the grid frame's
    matrixWorld × diag(grid scale)."""
    direction = unit(direction)
    result = grid_hit(np.asarray(origin, dtype=np.float64), direction,
                      np.asarray(grid_pos, dtype=np.float64), basis,
                      center, draw_z)
    return {
        "name": name,
        "ray_origin": list(map(float, origin)),
        "ray_direction": [float(v) for v in direction],
        "grid_pos": list(map(float, grid_pos)),
        # Row-major 3×3, the way numpy prints it; the web builds a Matrix4.
        "grid_basis": [[float(v) for v in row] for row in np.asarray(basis)],
        "grid_center": [float(center[0]), float(center[1])],
        "draw_z": float(draw_z),
        "hit": None if result is None else [float(result[0]), float(result[1])],
    }


def build_hit_cases():
    cases = []
    eye = np.eye(3)

    # Straight down onto a whole-earth grid at the origin: the answer IS the
    # lon/lat under the cursor, 1:1.
    cases.append(hit_case("identity_top_down", [40.0, -25.0, 300.0], [0, 0, -1],
                          [0, 0, 0], eye, (0.0, 0.0), 0.0))
    # Oblique ray, so the plane intersection actually does work.
    cases.append(hit_case("identity_oblique", [0.0, -200.0, 160.0],
                          [0.31, 0.80, -0.51], [0, 0, 0], eye, (0.0, 0.0), 0.0))
    # A drawing plane above the grid: the same ray lands somewhere else.
    cases.append(hit_case("identity_draw_z", [0.0, -200.0, 160.0],
                          [0.31, 0.80, -0.51], [0, 0, 0], eye, (0.0, 0.0), 25.0))
    # A grid that has been moved, turned and stretched.
    cases.append(hit_case("rotated_scaled", [30.0, -180.0, 140.0],
                          [0.1, 0.85, -0.52], [40.0, -15.0, 12.0],
                          rot_z(35.0) @ rot_x(20.0) @ np.diag([0.4, 0.9, 2.0]),
                          (0.0, 0.0), 3.0))
    # A windowed grid: the centre offset is added BACK, so the answer is
    # absolute lon/lat — the case a whole-earth window cannot distinguish.
    cases.append(hit_case("windowed_center", [-117.1, 32.4, 40.0], [0.05, 0.1, -1],
                          [0, 0, 0], np.diag([30.0, 30.0, 1.0]),
                          (-117.1, 32.75), 0.0))
    # Nested under a rotated, scaled parent: the basis is the composite.
    cases.append(hit_case("nested_parent", [-10.0, -120.0, 90.0],
                          [0.2, 0.75, -0.63], [-20.0, 10.0, 5.0],
                          1.5 * (rot_z(-40.0) @ rot_x(15.0)), (0.0, 0.0), -4.0))

    # The three None cases.
    cases.append(hit_case("parallel_to_plane", [0.0, -200.0, 0.0], [0, 1, 0],
                          [0, 0, 0], eye, (0.0, 0.0), 0.0))
    cases.append(hit_case("behind_camera", [0.0, -200.0, 160.0], [0, -0.6, 0.8],
                          [0, 0, 0], eye, (0.0, 0.0), 0.0))
    cases.append(hit_case("singular_basis", [0.0, -200.0, 160.0], [0, 0.8, -0.6],
                          [0, 0, 0], np.diag([1.0, 1.0, 0.0]), (0.0, 0.0), 0.0))
    return cases


def plain_stamp_nodes(base_level):
    """The Single Object brush: one node at the stamp frame's origin."""
    return [Node(id=7, type=5, parent_id=3, branch_level=base_level,
                 translate_x=0.0, translate_y=0.0, translate_z=0.0,
                 rotate_x=0.0, rotate_y=0.0, rotate_z=0.0,
                 scale_x=1.0, scale_y=2.0, scale_z=3.0,
                 color_r=200, color_g=200, color_b=200, color_a=255,
                 geometry=7, hide=0, topo=0)]


def cluster_stamp_nodes(base_level):
    """A multi-root stamp: two roots at the base level, each with a child.
    Only the roots may be offset, and both must take the SAME jitter draw."""
    out = []
    for i in range(2):
        out.append(Node(id=10 + i * 2, type=5, parent_id=3,
                        branch_level=base_level,
                        translate_x=i * 5.0, translate_y=0.0, translate_z=0.0,
                        rotate_x=0.0, rotate_y=0.0, rotate_z=0.0,
                        scale_x=1.0, scale_y=1.0, scale_z=1.0,
                        color_r=200, color_g=200, color_b=200, color_a=255,
                        geometry=7, hide=0, topo=0))
        out.append(Node(id=11 + i * 2, type=5, parent_id=10 + i * 2,
                        branch_level=base_level + 1,
                        translate_x=3.0, translate_y=1.0, translate_z=0.5,
                        rotate_x=0.0, rotate_y=0.0, rotate_z=0.0,
                        scale_x=0.5, scale_y=0.5, scale_z=0.5,
                        color_r=200, color_g=200, color_b=200, color_a=255,
                        geometry=7, hide=0, topo=0))
    return out


def stamp_case(name, nodes, base_branch_level, lon, lat, z,
               heading_jitter, scale_jitter, seed):
    nodes_in = [{f: getattr(n, f) for f in STAMP_FIELDS} for n in nodes]
    rng = random.Random(seed)
    heading, factor = place_stamp(nodes, base_branch_level, lon, lat, z,
                                  heading_jitter, scale_jitter, rng)
    return {
        "name": name,
        "base_branch_level": base_branch_level,
        "lon": lon, "lat": lat, "z": z,
        "heading_jitter": heading_jitter,
        "scale_jitter": scale_jitter,
        "seed": seed,
        "nodes_in": nodes_in,
        "heading": heading,
        "factor": factor,
        # The rng's NEXT draw, which is what proves the short-circuit: with a
        # jitter of 0 the generator must not have been advanced at all.
        "next_draw": rng.random(),
        "nodes_out": [{f: getattr(n, f) for f in STAMP_FIELDS} for n in nodes],
    }


def build_stamp_cases():
    cases = []
    # v1's behaviour: no jitter at all, so the rng is untouched.
    cases.append(stamp_case("plain_no_jitter", plain_stamp_nodes(1), 1,
                            -117.16, 32.71, 4.0, 0.0, 0.0, 12345))
    # Heading only, then scale only — each alone advances the stream once.
    cases.append(stamp_case("plain_heading_only", plain_stamp_nodes(1), 1,
                            10.0, -20.0, 0.0, 45.0, 0.0, 12345))
    cases.append(stamp_case("plain_scale_only", plain_stamp_nodes(1), 1,
                            10.0, -20.0, 0.0, 0.0, 25.0, 12345))
    # Both, in the order the desktop draws them.
    cases.append(stamp_case("plain_both", plain_stamp_nodes(1), 1,
                            -70.5, 40.25, 2.5, 30.0, 15.0, 2026))
    # A stamp landing on a grid that is itself a child (base level 2).
    cases.append(stamp_case("deep_base_level", plain_stamp_nodes(2), 2,
                            5.0, 5.0, 1.0, 180.0, 90.0, 99))
    # Multi-root: one draw shared, children untouched.
    cases.append(stamp_case("cluster", cluster_stamp_nodes(1), 1,
                            -117.0, 32.5, 0.0, 60.0, 40.0, 7))
    # A real Glyph Composer hyperglyph, the v2 brush.
    hyper = generate_nodes(default_recipe(), start_id=100, parent_id=3,
                           base_branch_level=1)
    cases.append(stamp_case("composer_default_recipe", hyper, 1,
                            -20.0, 12.0, 6.0, 25.0, 20.0, 4242))
    return cases


def build_spacing_cases():
    """should_stamp's gate, boundary included."""
    out = []
    for last, x, y, spacing in [
        (None, 0.0, 0.0, 30.0),
        (None, 0.0, 0.0, 0.0),
        ((100.0, 100.0), 120.0, 100.0, 30.0),
        ((100.0, 100.0), 130.0, 100.0, 30.0),     # exactly spacing
        ((100.0, 100.0), 118.0, 124.0, 30.0),     # 3-4-5 diagonal
        ((100.0, 100.0), 117.0, 123.0, 30.0),
        ((5.0, 5.0), 5.0, 5.0, 0.0),              # spacing 0 stamps always
    ]:
        out.append({
            "last": None if last is None else list(last),
            "x": x, "y": y, "spacing": spacing,
            "stamp": should_stamp(last, x, y, spacing),
        })
    return out


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    payload = {
        "grid_hits": build_hit_cases(),
        "stamps": build_stamp_cases(),
        "spacing": build_spacing_cases(),
    }
    out = Path(sys.argv[1])
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=1), encoding="utf-8")
    print(f"wrote {out} — {len(payload['grid_hits'])} grid hits, "
          f"{len(payload['stamps'])} stamps, {len(payload['spacing'])} spacing cases")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
