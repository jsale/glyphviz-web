// Which of a child's translate_x/y/z each topology reads as a DISTANCE, and
// which it reads as an angle (or as a parameter already proportional to the
// parent's base radius, which is a distance that already tracks the parent's
// size and so needs no further scaling).
//
// The parent's `topoScale` multiplies exactly the true axes below, and nothing
// else. That is the whole implementation of the feature: every case in
// `topoOffset` stays untouched, because scaling an axis before the math is
// algebraically identical to scaling the distance term the math derives from
// it — `radial = B + tz` becomes `B + k·tz`, `dist·n + tx·u` becomes
// `dist·n + k·tx·u`, and so on. Keeping it to a pre-multiply is also what
// guarantees the property the field exists for: an angular axis is never
// touched, so no value of topoScale can disturb a circular layout.
//
// Per-topology reasoning for the false entries (desktop
// topology.LINEAR_PLACEMENT_AXES, verbatim):
//   Sphere/Point/Zsphere — tx/ty are longitude/latitude degrees.
//   Torus/Ztorus         — tx/ty are orbital and tube angles.
//   Cylinder/Zcylinder   — tx is the angle around the axis.
//   Rod                  — ty is the angle around the axis; tx maps [0,180]
//                          onto the rod's full rendered LENGTH, so it is
//                          already expressed as a fraction of the parent's
//                          size (ANTz's own normalization — the very
//                          convention TOPO_SCALE_ANTZ generalizes).
//   Zrod                 — same math as Zcylinder, so tx is the angle.
//   Spiral               — tx is the helix angle AND drives the helical rise
//                          as a fraction of B; both size-relative.
// Anything absent (None, Plane, Video, Plot, Surface, and any unknown id,
// which falls back to Cartesian placement) reads all three as distances.
//
// This table sits in the DATA layer rather than beside `topoOffset`, which is
// where it began, because two unrelated things read it: the renderer, which
// scales the axes it marks; and the Glyph Composer's recipe model
// (glyphRecipe.ts), which fits a level's Topology Scale to whether its
// children's 0…360 sweep is about to be read as a distance. The desktop makes
// the same split — the table lives in the Qt-free, GL-free
// `glyphviz_core/topology.py`, imported by both `glyphviz_core/glyph_recipe.py`
// and the viewport. Keeping the recipe model free of THREE is what lets it stay
// what its header claims: pure logic, no UI, no GL. `render/topology.ts`
// re-exports these names, so every existing import site is unaffected.

import { NodeType } from './types'
import type { GvNode } from './types'
import { Topo } from './types'

/** [x, y, z] — true where the axis is a distance the parent's topoScale scales. */
export type LinearAxes = readonly [boolean, boolean, boolean]

export const ALL_AXES_LINEAR: LinearAxes = [true, true, true]
export const NO_AXES_LINEAR: LinearAxes = [false, false, false]

export const LINEAR_PLACEMENT_AXES: Readonly<Record<number, LinearAxes>> = {
  [Topo.Cube]: [true, true, true], //       face u, face v, height off the face
  [Topo.Sphere]: [false, false, true], //   lon, lat, altitude
  [Topo.Torus]: [false, false, true], //    orbital angle, tube angle, tube offset
  [Topo.Cylinder]: [false, true, true], //  angle, height, radial
  [Topo.Pin]: [true, true, true], //        height, and two lateral offsets
  [Topo.Rod]: [false, false, true], //      length fraction, angle, radial
  [Topo.Point]: [false, false, true], //    lon, lat, distance from centre
  [Topo.Plane]: [true, true, true],
  [Topo.Zcube]: [true, true, true],
  [Topo.Zsphere]: [false, false, true],
  [Topo.Ztorus]: [false, false, true],
  [Topo.Zcylinder]: [false, true, true],
  [Topo.Zrod]: [false, true, true], //      same math as Zcylinder
  [Topo.Spiral]: [false, true, true], //    helix angle, rise offset, radial
  [Topo.Video]: [true, true, true],
  [Topo.Plot]: [true, true, true],
  [Topo.Surface]: [true, true, true],
  [Topo.PointCloud]: [true, true, true],
}

/**
 * Which of a child's translate axes this parent reads as a distance — i.e.
 * which ones its topoScale multiplies.
 *
 * A World Grid parent returns all-false: grid children are exempt from
 * topoScale entirely, because the grid's rendered footprint is sized from the
 * same extents window their coordinates are read in, and scaling one without
 * the other would slide the frame out from under its children. A root (no
 * parent) is exempt too — its translate IS its world position, never a
 * topology offset.
 */
export function linearPlacementAxes(parent: GvNode | null): LinearAxes {
  if (parent === null || parent.type === NodeType.WorldGrid) return NO_AXES_LINEAR
  return LINEAR_PLACEMENT_AXES[parent.topo] ?? ALL_AXES_LINEAR
}
