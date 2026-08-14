// Where a newly created object lands — the N / Shift+N / New Node / New Child
// (and paste, and mesh-import) auto-placement rule. Behavior ported (not code)
// from the desktop's Qt-free `glyphviz_core/placement.py`.
//
// ANTz distributed new nodes by stepping translate_x and wrapping the row:
// `npNodeNew` gave each new child `translate_x = -15 * siblings` and bumped
// `translate_y` by 15 every 24 children — 24 × 15° = one full 360° lap — then
// folded the result back into −180…180. The point is the WRAP, not the numbers:
// on a Cartesian parent the objects array into a grid instead of a runaway
// line, and on a circular topology (Sphere, Torus, Cylinder…) the 25th child
// starts a new ring above the first instead of landing on top of it.
//
// GlyphViz keeps that behaviour and makes adjustable the two numbers ANTz
// hardcoded — the step, and the translate_z a new object takes. Two entry
// points, because the two callers know different things:
//
// - `wrappedGridOffset(index, step)` — placement by ORDINAL, used for children
//   (the parent knows how many it already has).
// - `stepFrom(x, y, step)` — placement RELATIVE to the previous object, used
//   for root-level nodes (there is no ordinal; each new root steps on from the
//   last one created, wherever the user has since dragged it).
//
// Both walk the same lattice, so a run of N presses and a run of Shift+N
// presses lay out identically. Only x wraps: y keeps climbing, so a long run of
// creations grows a taller grid rather than folding back onto row 0 (ANTz
// folded both axes and so eventually reused slots).

/**
 * One full lap. translate_x is degrees on every circular topology, so this is
 * the value at which a new object would land on the first one; on Cartesian
 * parents it is simply the row width. Not user-facing: the step is the knob,
 * the lap is the geometry.
 */
export const PLACEMENT_WRAP = 360

/**
 * Historical GlyphViz spacing for a new child (Shift+N), kept as the default so
 * existing muscle memory holds. ANTz used 15; type that into the Placement Step
 * box for ANTz's own lattice. Note the ROOT step therefore changes 10 → 5, so
 * both gestures share one lattice.
 */
export const DEFAULT_PLACEMENT_STEP = 5

/**
 * translate_z for a new object. Roots land on the world plane; children stand
 * off their parent, because a child at 0 under a topology-None parent would be
 * swallowed by it — on a Sphere/Torus/Cylinder parent the same number lifts the
 * child radially off the surface instead. Both are adjustable; only the
 * DEFAULTS differ, since the axis means different things at the two levels.
 */
export const DEFAULT_ROOT_Z = 0
export const DEFAULT_CHILD_Z = 5

/** The Create panel's placement settings, threaded to every creation path. */
export interface PlacementSettings {
  /** How far apart consecutive auto-placed objects sit. */
  step: number
  /** translate_z for a new ROOT-level object. */
  rootZ: number
  /** translate_z for a new CHILD. */
  childZ: number
}

export const DEFAULT_PLACEMENT: PlacementSettings = {
  step: DEFAULT_PLACEMENT_STEP,
  rootZ: DEFAULT_ROOT_Z,
  childZ: DEFAULT_CHILD_Z,
}

/** A lattice slot: the (translate_x, translate_y) a new object takes. */
export interface PlacementXY {
  x: number
  y: number
}

/**
 * How many objects fit in one row before x wraps: the count of multiples of
 * `step` strictly below `wrap` (so a 5-unit step gives 72 columns, 0…355, and
 * ANTz's 15 gives 24, 0…345).
 *
 * A step at or above a full lap gives 1 — every object on its own row.
 */
export function columnsPerRow(step: number, wrap = PLACEMENT_WRAP): number {
  const s = Math.abs(step)
  if (!(s > 0)) return 1
  return Math.max(1, Math.ceil(wrap / s))
}

/**
 * The (translate_x, translate_y) for the `index`-th object (0-based) placed at
 * `step` spacing, wrapping to a new row every `columnsPerRow` objects.
 *
 * A step of 0 stacks everything at the origin, which is what asking for no
 * spacing means.
 */
export function wrappedGridOffset(index: number, step: number, wrap = PLACEMENT_WRAP): PlacementXY {
  const s = Math.abs(step)
  const i = Math.max(0, Math.trunc(index))
  if (!(s > 0)) return { x: 0, y: 0 }
  const cols = columnsPerRow(s, wrap)
  return { x: (i % cols) * s, y: Math.floor(i / cols) * s }
}

/**
 * The (translate_x, translate_y) one `step` on from an object sitting at
 * (`x`, `y`) — the same lattice as `wrappedGridOffset`, reached incrementally:
 * x + step, unless that would reach a full lap, in which case x restarts at 0
 * and y takes the step instead.
 */
export function stepFrom(x: number, y: number, step: number, wrap = PLACEMENT_WRAP): PlacementXY {
  const s = Math.abs(step)
  if (!(s > 0)) return { x, y }
  const nextX = x + s
  if (nextX >= wrap) return { x: 0, y: y + s }
  return { x: nextX, y }
}
