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
  - LINK TO PARENT (desktop a9a845d): a level whose `link_geo` is set emits a
    companion type-7 edge from each of its nodes back to its parent, right
    after that node. The interleaving IS the contract — the Composer's insert
    only offsets start_id and never remaps — so a drift in emission order
    silently repoints every child_id. Covered with inherited colours, an
    independent link gradient, a root-level link (ignored on both sides), and
    three linked levels inserted mid-scene.
  - the Topology Scale AUTO-FIT (desktop 88091e1): a level whose children are
    distributed angularly gets TOPO_SCALE_ANTZ stamped on it when its own
    topology reads translate_x as a distance, and 1.0 when it reads it as an
    angle. That decision is table-driven off topology.LINEAR_PLACEMENT_AXES, so
    the cases below walk EVERY topology id as a parent of an angular level —
    a disagreement about one entry of that table is a design that flies apart
    in one app and not the other.

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
from glyphviz_core.topology import TOPO_NAMES, TOPO_NONE                 # noqa: E402

# Field-for-field, the columns generate_nodes actually writes.
FIELDS = [
    "id", "type", "parent_id", "branch_level",
    "translate_x", "translate_y", "translate_z",
    "rotate_x", "rotate_y", "rotate_z",
    "scale_x", "scale_y", "scale_z",
    "color_r", "color_g", "color_b", "color_a",
    "geometry", "hide", "topo", "ratio", "rotation_mode", "topo_scale",
]


def node_row(n):
    """One node as the web side reads it. A LINK carries its B-end in the
    optional tracked columns (`extras['child_id']`), which is where both apps
    read it from — without it the edge has no second endpoint at all."""
    row = {f: getattr(n, f) for f in FIELDS}
    if n.extras.get('child_id') is not None:
        row["child_id"] = int(n.extras["child_id"])
    return row


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
        "nodes": [node_row(n) for n in nodes],
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

    # ---- Topology Scale ------------------------------------------------
    #
    # Every topology id as the parent of an ANGULAR level: the ones whose
    # translate_x is a distance must come back at TOPO_SCALE_ANTZ, the ones
    # whose translate_x is an angle at 1.0. Walking TOPO_NAMES rather than a
    # hand-written list is what makes this a check on LINEAR_PLACEMENT_AXES
    # itself rather than on a copy of it.
    for topo in sorted(TOPO_NAMES):
        cases.append(case(
            f"auto_topo_scale_parent_{topo}",
            GlyphRecipe(name=f"Auto {topo}", levels=[
                LevelSpec(count=1, geometry=1, topo=topo, ratio=0.3,
                          dist_mode=DIST_LINEAR,
                          color_start=(200, 200, 200, 255)),
                LevelSpec(count=6, geometry=1, topo=TOPO_NONE,
                          dist_mode=DIST_ANGULAR, dist_tz=1.0,
                          scale_x=0.3, scale_y=0.3, scale_z=0.3,
                          color_start=(120, 180, 240, 255)),
            ]),
        ))

    # A LINEAR child level asks for no fit whatever the parent's topology —
    # its numbers were never authored in degrees.
    cases.append(case("auto_topo_scale_linear_children", GlyphRecipe(
        name="Linear children", levels=[
            LevelSpec(count=1, geometry=1, topo=1, dist_mode=DIST_LINEAR,
                      color_start=(200, 200, 200, 255)),
            LevelSpec(count=4, geometry=1, topo=TOPO_NONE,
                      dist_mode=DIST_LINEAR, dist_step=1.5,
                      color_start=(120, 180, 240, 255)),
        ])))

    # Auto OFF: the stored number is used verbatim, including a value the
    # 6-decimal spin box would round (1/180 exactly) and one outside the
    # suggestion's two answers.
    cases.append(case("manual_topo_scale", GlyphRecipe(
        name="Manual", levels=[
            LevelSpec(count=1, geometry=1, topo=1, dist_mode=DIST_LINEAR,
                      topo_scale=1.0 / 180.0, topo_scale_auto=False,
                      color_start=(200, 200, 200, 255)),
            LevelSpec(count=5, geometry=1, topo=4, dist_mode=DIST_ANGULAR,
                      topo_scale=0.125, topo_scale_auto=False,
                      color_start=(120, 180, 240, 255)),
        ])))

    # A manual 1.0 under a Cube parent — the user overruling the fit, which
    # must NOT be quietly re-applied.
    cases.append(case("manual_overrides_fit", GlyphRecipe(
        name="Overruled", levels=[
            LevelSpec(count=1, geometry=1, topo=1, dist_mode=DIST_LINEAR,
                      topo_scale=1.0, topo_scale_auto=False,
                      color_start=(200, 200, 200, 255)),
            LevelSpec(count=3, geometry=1, topo=TOPO_NONE,
                      dist_mode=DIST_ANGULAR,
                      color_start=(120, 180, 240, 255)),
        ])))

    # Four levels, alternating angular/linear children under alternating
    # topologies: each level's fit is decided by the level BELOW it, and the
    # deepest is a leaf with no children to place at all.
    cases.append(case("auto_topo_scale_deep", GlyphRecipe(
        name="Deep fit", levels=[
            LevelSpec(count=1, geometry=1, topo=1, dist_mode=DIST_LINEAR,
                      color_start=(240, 240, 240, 255)),
            LevelSpec(count=3, geometry=1, topo=2, dist_mode=DIST_ANGULAR,
                      scale_x=0.5, scale_y=0.5, scale_z=0.5,
                      color_start=(200, 40, 40, 255)),
            LevelSpec(count=2, geometry=1, topo=5, dist_mode=DIST_LINEAR,
                      dist_step=0.8, dist_axis=2,
                      scale_x=0.3, scale_y=0.3, scale_z=0.3,
                      color_start=(40, 200, 40, 255)),
            LevelSpec(count=4, geometry=1, topo=TOPO_NONE,
                      dist_mode=DIST_ANGULAR, dist_tz=0.5,
                      scale_x=0.15, scale_y=0.15, scale_z=0.15,
                      color_start=(40, 40, 200, 255)),
        ])))

    # ---- Link to parent (desktop a9a845d) ------------------------------
    #
    # A non-root level with link_geo set emits a companion type-7 edge from
    # each of its nodes back to its parent, right AFTER that node — so the ids
    # interleave, and any drift in that order repoints every child_id.
    cases.append(case("links_simple", GlyphRecipe(name="Limbs", levels=[
        LevelSpec(count=1, geometry=3, topo=2, dist_mode=DIST_LINEAR,
                  color_start=(200, 200, 200, 255)),
        LevelSpec(count=4, geometry=3, topo=TOPO_NONE, dist_mode=DIST_ANGULAR,
                  dist_tz=3.0, scale_x=0.4, scale_y=0.4, scale_z=0.4,
                  color_start=(240, 120, 60, 255),
                  link_geo=19, link_ratio=0.2),
    ])))

    # Link colours: inherited from the child (link_color_start None) on one
    # level, and their own gradient on the next — two different code paths in
    # _lerp_color, and the gradient is the one that rounds half-to-even.
    cases.append(case("links_colored", GlyphRecipe(name="Coloured limbs", levels=[
        LevelSpec(count=1, geometry=1, topo=2, dist_mode=DIST_LINEAR,
                  color_start=(255, 255, 255, 255)),
        LevelSpec(count=3, geometry=3, topo=2, dist_mode=DIST_ANGULAR,
                  dist_tz=2.0, scale_x=0.5, scale_y=0.5, scale_z=0.5,
                  color_start=(0, 1, 2, 3), color_end=(5, 6, 7, 8),
                  link_geo=1, link_ratio=0.35),
        LevelSpec(count=2, geometry=3, topo=TOPO_NONE, dist_mode=DIST_ANGULAR,
                  dist_tz=1.0, scale_x=0.25, scale_y=0.25, scale_z=0.25,
                  color_start=(10, 20, 30, 255),
                  link_geo=11, link_ratio=0.1,
                  link_color_start=(0, 0, 0, 0),
                  link_color_end=(3, 5, 7, 9)),
    ])))

    # Links on the ROOT level are ignored — a root's parent is whatever the
    # glyph is inserted under, not part of the glyph.
    cases.append(case("links_ignored_on_root", GlyphRecipe(name="Root link", levels=[
        LevelSpec(count=2, geometry=1, topo=2, dist_mode=DIST_LINEAR,
                  dist_step=4.0, color_start=(200, 200, 200, 255),
                  link_geo=19, link_ratio=0.5),
        LevelSpec(count=2, geometry=3, topo=TOPO_NONE, dist_mode=DIST_ANGULAR,
                  dist_tz=1.5, color_start=(100, 100, 250, 255)),
    ])))

    # Three levels deep, links on every non-root level, inserted mid-scene:
    # the id allocator has to interleave nodes and edges through the whole
    # depth-first walk with a non-1 start_id.
    cases.append(case("links_deep_inserted", GlyphRecipe(name="Tree", levels=[
        LevelSpec(count=1, geometry=3, topo=2, ratio=0.2,
                  dist_mode=DIST_LINEAR, color_start=(120, 90, 60, 255)),
        LevelSpec(count=3, geometry=3, topo=2, dist_mode=DIST_ANGULAR,
                  dist_tilt=35.0, dist_tz=4.0,
                  scale_x=0.6, scale_y=0.6, scale_z=0.6,
                  color_start=(140, 110, 70, 255),
                  link_geo=19, link_ratio=0.25,
                  link_color_start=(90, 60, 40, 255)),
        LevelSpec(count=2, geometry=3, topo=TOPO_NONE, dist_mode=DIST_ANGULAR,
                  dist_tilt=40.0, dist_tz=2.5,
                  scale_x=0.35, scale_y=0.35, scale_z=0.35,
                  color_start=(200, 60, 90, 255),
                  link_geo=19, link_ratio=0.12),
    ]), start_id=500, parent_id=17, base_branch_level=2))

    # A level whose links are on and whose colour is a gradient AND whose own
    # link colour is a solid: the link takes the solid, the node the gradient.
    cases.append(case("links_solid_over_gradient", GlyphRecipe(
        name="Mixed", levels=[
            LevelSpec(count=1, geometry=1, topo=1, dist_mode=DIST_LINEAR,
                      color_start=(255, 255, 255, 255)),
            LevelSpec(count=5, geometry=1, topo=TOPO_NONE,
                      dist_mode=DIST_LINEAR, dist_step=2.0,
                      color_start=(0, 0, 0, 255), color_end=(255, 255, 255, 255),
                      link_geo=16, link_ratio=0.4,
                      link_color_start=(7, 9, 11, 13)),
        ])))

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
