"""Dump Glyph Composer recipes through the REAL desktop generator to JSON.

The web app's Glyph Composer (Ctrl+G) is a port of the desktop's
`glyphviz_gl/glyph_composer_dialog.py`, and everything the dialog does ends in
one call: `glyphviz_core.glyph_recipe.generate_nodes`. So the thing worth
proving across the two implementations is not the widgets — it is that the same
recipe produces the same nodes, and that a template written by one app opens in
the other.

The existing `dump_hyperglyphs.py` already exercises `generate_nodes`, but only
over the recipes the Hyperglyph Generator can PRODUCE: those are Angular and
Linear placement with a narrow slice of the parameter ranges. The Composer
hands the whole LevelSpec to the user, so this dump deliberately covers what
that harness cannot reach:

  - every distribution mode a level can be given, INCLUDING the root-only
    Circular / Grid / Random (Random is dumped for its SHAPE only — it draws
    from the module-level `random`, so its coordinates are un-reproducible on
    the desktop itself and the test checks structure rather than positions)
  - a Grid whose count does not fill its last row, which is the only place
    `math.ceil` rows and the centring offset can disagree
  - gradients (rounded, and Python's round is half-to-EVEN) and solid colours
    (TRUNCATED — a different code path in `_lerp_color`)
  - a count of 1, where the gradient's `t` denominator would divide by zero
  - deep nesting, so branch_level and the depth-first id order are checked
  - the dialog's own `default_recipe()`, the two-level glyph it opens on
  - insertion parameters (start_id / parent_id / base_branch_level), the second
    call Insert into Scene makes

It also round-trips every recipe through `recipe_to_dict` so the web side can
diff its template JSON against the desktop's byte for byte — that shared file
format is the only way a glyph designed in one app reaches the other.

Run with the desktop repo's conda env python (see that repo's CLAUDE.md for how
to locate it; never `conda run`):

    <glyphviz-env-python> tools/dump_glyph_recipes.py src/gv/fixtures/glyph_recipes.json

Regenerate the vendored JSON only when the desktop recipe model changes. CI
never runs this — the JSON is committed.
"""

import json
import sys
from pathlib import Path

# Import the desktop packages from the sibling repo without installing them.
DESKTOP_REPO = Path(__file__).resolve().parents[2] / "glyphviz"
sys.path.insert(0, str(DESKTOP_REPO))

from glyphviz_core.glyph_recipe import (                                 # noqa: E402
    DIST_ANGULAR, DIST_CIRCULAR, DIST_GRID, DIST_LINEAR, DIST_RANDOM,
    GlyphRecipe, LevelSpec, default_recipe, generate_nodes, recipe_to_dict,
)

# Field-for-field, the columns generate_nodes actually writes.
FIELDS = [
    "id", "type", "parent_id", "branch_level",
    "translate_x", "translate_y", "translate_z",
    "rotate_x", "rotate_y", "rotate_z",
    "scale_x", "scale_y", "scale_z",
    "color_r", "color_g", "color_b", "color_a",
    "geometry", "hide", "topo", "ratio", "rotation_mode",
]


def case(name, recipe, *, start_id=1, parent_id=0, base_branch_level=0,
         positions=True):
    """One dumped case. `positions=False` marks a recipe whose placement is
    random on BOTH sides — structure is comparable, coordinates are not."""
    nodes = generate_nodes(recipe, start_id=start_id, parent_id=parent_id,
                           base_branch_level=base_branch_level)
    return {
        "name": name,
        "recipe": recipe_to_dict(recipe),
        "start_id": start_id,
        "parent_id": parent_id,
        "base_branch_level": base_branch_level,
        "compare_positions": positions,
        "nodes": [{f: getattr(n, f) for f in FIELDS} for n in nodes],
    }


def build_cases():
    cases = []

    # The dialog's own opening state.
    cases.append(case("default_recipe", default_recipe()))

    # The same, inserted under a node deep in a scene.
    cases.append(case("default_recipe_inserted", default_recipe(),
                      start_id=413, parent_id=42, base_branch_level=3))

    # Root Linear along each axis, with an even and an odd count (the centring
    # offset -total/2 lands on an item for odd counts and between two for even).
    for axis, label in enumerate("xyz"):
        cases.append(case(
            f"root_linear_{label}",
            GlyphRecipe(name=f"Linear {label.upper()}", levels=[
                LevelSpec(count=4 + axis, geometry=1, topo=0,
                          dist_mode=DIST_LINEAR, dist_step=2.5, dist_axis=axis,
                          scale_x=0.6, scale_y=0.7, scale_z=0.8,
                          rotate_x=15.0, rotate_y=-40.0, rotate_z=95.0,
                          color_start=(10, 20, 30, 200),
                          color_end=(200, 190, 180, 40)),
            ]),
        ))

    # Root Circular.
    cases.append(case("root_circular", GlyphRecipe(name="Circular", levels=[
        LevelSpec(count=7, geometry=3, topo=2, ratio=0.42,
                  dist_mode=DIST_CIRCULAR, dist_radius=4.75,
                  color_start=(255, 0, 0, 255), color_end=(0, 0, 255, 255)),
    ])))

    # Root Grid, count NOT a multiple of cols — the ragged last row.
    cases.append(case("root_grid_ragged", GlyphRecipe(name="Grid", levels=[
        LevelSpec(count=11, geometry=9, topo=0, dist_mode=DIST_GRID,
                  dist_grid_cols=4, dist_grid_sx=1.5, dist_grid_sy=2.25,
                  color_start=(140, 60, 220, 255)),
    ])))

    # Root Grid, one column (rows == count) and a single-column centring of 0.
    cases.append(case("root_grid_single_column", GlyphRecipe(name="Column", levels=[
        LevelSpec(count=5, geometry=1, topo=0, dist_mode=DIST_GRID,
                  dist_grid_cols=1, dist_grid_sx=3.0, dist_grid_sy=1.0,
                  color_start=(1, 2, 3, 4), color_end=(254, 253, 252, 251)),
    ])))

    # Root Random — shape only (see `positions`).
    cases.append(case("root_random", GlyphRecipe(name="Random", levels=[
        LevelSpec(count=6, geometry=22, topo=0, dist_mode=DIST_RANDOM,
                  dist_bounds=7.5, color_start=(80, 80, 80, 255)),
    ]), positions=False))

    # Angular children with a tilt and an altitude offset, under a Sphere
    # trunk — the Composer's bread and butter.
    cases.append(case("angular_tilted", GlyphRecipe(name="Ring", levels=[
        LevelSpec(count=1, geometry=3, topo=2, dist_mode=DIST_LINEAR,
                  color_start=(200, 200, 255, 255)),
        LevelSpec(count=9, geometry=5, topo=4, ratio=0.15,
                  dist_mode=DIST_ANGULAR, dist_tilt=-33.5, dist_tz=1.75,
                  scale_x=0.35, scale_y=0.35, scale_z=0.9,
                  color_start=(255, 200, 0, 255), color_end=(0, 120, 255, 90)),
    ])))

    # A count of 1 on a gradient level: t has no range, so every item takes the
    # START colour and the denominator must not blow up.
    cases.append(case("gradient_single_item", GlyphRecipe(name="One", levels=[
        LevelSpec(count=1, geometry=3, topo=2, dist_mode=DIST_LINEAR,
                  color_start=(11, 22, 33, 44), color_end=(255, 255, 255, 255)),
    ])))

    # A gradient whose midpoints land on .5, where Python rounds to EVEN.
    cases.append(case("gradient_half_to_even", GlyphRecipe(name="Halves", levels=[
        LevelSpec(count=5, geometry=1, topo=0, dist_mode=DIST_LINEAR,
                  dist_step=1.0,
                  color_start=(0, 1, 2, 3), color_end=(5, 6, 7, 8)),
        LevelSpec(count=3, geometry=1, topo=0, dist_mode=DIST_ANGULAR,
                  color_start=(0, 0, 0, 0), color_end=(3, 5, 7, 9)),
    ])))

    # Four levels deep: branch_level, depth-first id order, and a mix of solid
    # and gradient levels in one recipe.
    cases.append(case("four_levels_deep", GlyphRecipe(name="Deep", levels=[
        LevelSpec(count=2, geometry=1, topo=2, dist_mode=DIST_LINEAR,
                  dist_step=6.0, dist_axis=0, scale_x=2.0, scale_y=2.0,
                  scale_z=2.0, color_start=(240, 240, 240, 255)),
        LevelSpec(count=3, geometry=3, topo=3, ratio=0.25,
                  dist_mode=DIST_ANGULAR, dist_tilt=20.0,
                  scale_x=0.5, scale_y=0.5, scale_z=0.5,
                  color_start=(200, 40, 40, 255), color_end=(40, 200, 40, 255)),
        LevelSpec(count=4, geometry=13, topo=4,
                  dist_mode=DIST_LINEAR, dist_step=0.75, dist_axis=2,
                  scale_x=0.25, scale_y=0.25, scale_z=0.25,
                  color_start=(60, 60, 200, 128)),
        LevelSpec(count=2, geometry=22, topo=0,
                  dist_mode=DIST_ANGULAR, dist_tz=-0.4,
                  scale_x=0.1, scale_y=0.1, scale_z=0.1,
                  color_start=(255, 255, 0, 255), color_end=(255, 0, 255, 0)),
    ]), start_id=1000, parent_id=7, base_branch_level=1))

    return cases


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("glyph_recipes.json")
    cases = build_cases()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"cases": cases}, indent=1), encoding="utf-8")
    total = sum(len(c["nodes"]) for c in cases)
    print(f"wrote {out}: {len(cases)} cases, {total} nodes")


if __name__ == "__main__":
    main()
