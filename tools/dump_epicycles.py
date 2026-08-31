"""Dump the REAL desktop Epitrochoid Generator engine to JSON.

The web app's Epitrochoid Generator (src/gv/epicycles.ts + src/render/
epicyclePath.ts) is a port of `glyphviz_core/epicycles.py`. Almost none of what
it claims is checkable from inside JavaScript: the harmonic ladder is a fact
about the desktop's own topology engine, the closure period is computed in
CPython `Fraction`s, the traced path comes out of a live `Scene`, and a seeded
Randomize has to name the same design in both apps. So this runs the desktop
module itself and dumps what it produces.

`src/gv/epicycles.parity.test.ts` diffs the result: integers and strings
exactly, floats at 1e-9 (the traced bead positions at 1e-6, which is the node
CSV's own write precision amplified by the parent scales the offsets pass
through).

Five blocks, each pinning a different half of the port:

  * `harmonics`     — the ladder, including the (+1,-1,+1,-1) case that climbs
                      to 1,2,3,4 rather than collapsing to 1,0,1,0.
  * `closure`       — rationals: 1/2 and 1/3 must give 720 and 1080, not a
                      float near-miss, and a rate too small to survive
                      limit_denominator(360) must not poison the running gcd.
  * `scenes`        — `build_nodes` for every preset, field for field. The
                      beads carry the TRACED PATH, so this one dump pins the
                      builder, the telescoped scales, the tube ratio, the tilt,
                      the labels and the placement composition at once.
  * `channels`      — `build_channels` for a self-drawing design: the per-arm
                      tracks and the grouped alpha steps that must LAG the pen.
  * `random`        — `random_design` through `random.Random(seed)`, which is
                      what makes a seed mean the same design in both apps. The
                      ORDER of the draws is the specification; a hoisted draw
                      repoints every existing seed.

Run with the desktop repo's conda env python (see that repo's CLAUDE.md for how
to locate it; never `conda run`):

    <glyphviz-env-python> tools/dump_epicycles.py src/gv/fixtures/epicycles.json

Regenerate the vendored JSON only when the desktop engine changes. CI never
runs this — the JSON is committed.
"""

import json
import random
import sys
from pathlib import Path

DESKTOP_REPO = Path(__file__).resolve().parents[2] / "glyphviz"
sys.path.insert(0, str(DESKTOP_REPO))

from glyphviz_core import epicycles as ep                                # noqa: E402

# Every field the builder writes. `text` is in here on purpose: the labels are
# built with %g formatting and carry the measured harmonics, so they are a free
# check on both.
FIELDS = [
    "id", "type", "parent_id", "branch_level",
    "translate_x", "translate_y", "translate_z",
    "rotate_x", "rotate_y", "rotate_z",
    "scale_x", "scale_y", "scale_z",
    "color_r", "color_g", "color_b", "color_a",
    "geometry", "hide", "topo", "ratio", "rotation_mode",
    "translate_rate_x", "translate_rate_y",
    "text",
]

# (rates, ...) for the ladder — the desktop test's own seven vectors.
HARMONIC_CASES = [
    [1, -1, 1, -1],
    [1, 1, 1, 1],
    [1, -2, 3, -4],
    [1, -2, 2, -2],
    [2, -1, 0, -1],
    [1, -3, 3, -3],
    [1, 0, 0, 0],
    [2.5, -0.5, 1.25],
]

# (rate_x, rate_y) pairs per arm — closure is over BOTH angles.
CLOSURE_CASES = [
    [(1.0, 0.0), (-1.0, 0.0)],
    [(2.0, 0.0), (3.0, 0.0)],
    [(0.5, 0.0), (1.0, 0.0)],
    [(1.0 / 3.0, 0.0), (1.0, 0.0)],
    [(0.0, 0.0), (0.0, 0.0)],
    [(1.0, 0.0), (-1.0, 3.0)],
    [(7.0, 0.0), (11.0, 0.0)],          # coprime: closes in 360
    [(0.001, 0.0), (1.0, 0.0)],         # too small to survive the denominator
    [(1.0 / 7.0, 0.0), (1.0, 0.0)],     # 2520 frames, inside the 3600 cap
    [(1.0 / 11.0, 0.0), (1.0, 0.0)],    # 3960: past it, so "does not close"
]

# (preset label, self_drawing, trail_points override or None, start_id,
#  parent_id, base_branch_level, include_world)
SCENE_CASES = [(label, False, None, 1, 0, 0, True) for label in ep.PRESETS]
SCENE_CASES += [
    # Self-drawing: rates zeroed, beads at alpha 0, ch_input_id on every row.
    ("Jeff's ANTz original", True, None, 1, 0, 0, True),
    # A bead count that is NOT a divisor of the frame count, which is the case
    # the shared trail_sampling exists for.
    ("Cardioid (2 terms)", True, 137, 1, 0, 0, True),
    # Insert into Scene: ids from max+1, no World row, and the chain and trail
    # both landing as roots.
    ("Inclined orrery (tilt)", False, None, 500, 0, 0, False),
    # A trail turned off entirely.
    ("Spirograph (hypotrochoid)", False, None, 1, 0, 0, False),
]

# (seed, n_arms or None, allow_3d)
RANDOM_CASES = [
    (1, None, True), (7, None, True), (12345, None, True),
    (1, 2, True), (1, 8, True), (42, 4, True), (42, 4, False),
    (2147483646, 5, True), (0, 3, False),
]


def _row(node):
    out = {f: getattr(node, f) for f in FIELDS}
    out["child_id"] = int(node.extras.get("child_id", 0) or 0)
    out["ch_input_id"] = int(node.extras.get("ch_input_id", 0) or 0)
    return out


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    out_path = Path(sys.argv[1])

    harmonics = [
        {"rates": rates, "harmonics": ep.harmonics_of(rates)}
        for rates in HARMONIC_CASES
    ]

    closure = []
    for pairs in CLOSURE_CASES:
        design = ep.EpicycleDesign(
            arms=[ep.Arm(length=10.0, rate_x=rx, rate_y=ry) for rx, ry in pairs])
        closure.append({
            "rates": [[rx, ry] for rx, ry in pairs],
            "closes": ep.closure_frames(design),
            "frames": ep.frame_count(design),
        })

    scenes = []
    for label, self_drawing, points, start_id, parent_id, base_branch, world in SCENE_CASES:
        design = ep.preset(label)
        design.self_drawing = self_drawing
        if points is not None:
            design.trail_points = points
        if not world and label == "Spirograph (hypotrochoid)":
            design.trail = False
        frames = ep.frame_count(design)
        step, beads = ep.trail_sampling(design, frames)
        path = ep.trace_path(design, frames)
        nodes = ep.build_nodes(design, start_id=start_id, parent_id=parent_id,
                               base_branch_level=base_branch,
                               include_world=world, path=path)
        scenes.append({
            "preset": label,
            "design": design.to_dict(),
            "self_drawing": self_drawing,
            "start_id": start_id,
            "parent_id": parent_id,
            "base_branch_level": base_branch,
            "include_world": world,
            "frames": frames,
            "trail_step": step,
            "trail_beads": beads,
            "describe": _describe(design, path, frames),
            "nodes": [_row(n) for n in nodes],
        })

    channel_cases = []
    for label, points in [("Jeff's ANTz original", 720), ("Rose in space", 137)]:
        design = ep.preset(label)
        design.self_drawing = True
        design.trail_points = points
        frames = ep.frame_count(design)
        chmap, tracks = ep.build_channels(design, frames)
        channel_cases.append({
            "preset": label,
            "trail_points": points,
            "frames": frames,
            "map": [[ch, tid, attr] for ch, tid, attr in chmap],
            # Whole columns would be megabytes; these frames cover the first
            # groups switching on, a mid-run sample and the final frame.
            "sample_frames": _sample_frames(frames),
            "tracks": {
                str(tid): [col[f] for f in _sample_frames(frames)]
                for tid, col in sorted(tracks.items())
            },
        })

    randoms = []
    for seed, n_arms, allow_3d in RANDOM_CASES:
        design = ep.random_design(random.Random(seed), n_arms=n_arms,
                                  allow_3d=allow_3d, name=f"Epitrochoid_{seed}")
        randoms.append({
            "seed": seed, "n_arms": n_arms, "allow_3d": allow_3d,
            "design": design.to_dict(),
        })

    payload = {
        "harmonics": harmonics,
        "closure": closure,
        "scenes": scenes,
        "channels": channel_cases,
        "random": randoms,
        "slugs": {name: ep._slug(name) for name in
                  ["Fourier_V1", "  My Design  ", "a/b:c", "!!!", "Épicycle 3"]},
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=1)
    total = sum(len(s["nodes"]) for s in scenes)
    print(f"Wrote {len(scenes)} scene(s), {total} node(s) -> {out_path}")
    return 0


def _sample_frames(frames: int) -> list[int]:
    picks = sorted({0, 1, 2, 3, 5, 9, 17, 33, frames // 3, frames // 2,
                    frames - 2, frames - 1})
    return [f for f in picks if 0 <= f < frames]


def _describe(design, path, frames) -> dict:
    info = ep.describe(design, path=path, frames=frames)
    return {
        "arms": info["arms"],
        "frames": info["frames"],
        "closes": info["closes"],
        "harmonics": list(info["harmonics"]),
        "spectrum": [[h, a] for h, a in info["spectrum"]],
        "half_span": info["half_span"],
        "z_extent": info["z_extent"],
        "planar": bool(info["planar"]),
    }


if __name__ == "__main__":
    raise SystemExit(main())
