// Link (type = 7) glyph placement — the transform that stretches an ordinary
// glyph geometry along the axis between a link's two endpoints. A port of the
// desktop's `glyphviz_core/link_geometry.py` (verified against source
// 2026-08-15, commit 21f400c), which is dependency-free there and is here too:
// no THREE, no DOM, so it tests in plain node and the matrix can be diffed
// against the desktop's numbers directly.
//
// ANTz's rule, read from the source (`npDrawLink`, npgldraw.c:961-1067): a link
// node is drawn like any other node — the same call renders whatever
// `geometry` says — but with a bespoke matrix instead of the node's own
// transform:
//
//     glTranslatef (A)                                 // the A-end's world pos
//     glRotatef (rotZ * kRADtoDEG - 90, 0,0,1)         // rotZ = atan2(uy, ux)
//     glRotatef (rotX * kRADtoDEG + 90, 1,0,0)         // rotX = asin(uz)
//     glScalef  (ratio, ratio, distance * 0.5)         // "cyl is 2 units"
//     glTranslatef (0, 0, kNPoffsetUnit)               // = 1.0
//
// So `ratio` is the thickness on BOTH cross-axes and the endpoint distance is
// the length, which is what lets a link distort a glyph arbitrarily along its
// connection axis. The node's own translate/rotate/scale play no part — a link
// has no independent pose, it IS the edge. Neither does the Global Scale
// slider or the minimum-size clamp: both belong to a node's own draw matrix
// (render/baseScale.ts), and a link's comes entirely from its two ends.
//
// Two deliberate refinements over ANTz's version, both the desktop's:
//
//  1. The glyph's OWN local z extent is mapped onto the A→B segment, rather
//     than assuming every shape spans 2 units in z. For the symmetric shapes
//     (cube, sphere, cylinder, cone, the polyhedra, an imported mesh — all
//     built on −1..+1 in uvGeometry.ts) this reduces EXACTLY to ANTz's
//     `distance * 0.5` about the midpoint. It differs only for Pin, whose apex
//     sits at its local origin and whose dome tops out at
//     PIN_HEIGHT + PIN_RADIUS — ANTz papered over that with a conditional
//     −1-unit nudge (npgeometry.c:205), which left a pin link hanging off past
//     its B-end. Here a Pin link's tip sits on A and its dome lands on B.
//  2. `geometry` alone selects the mode (no new column), but three ids stay
//     line-drawn rather than becoming stretched glyphs — see
//     LINK_LINE_GEOMETRIES.
//
// The rotation is built column by column from the same composition ANTz uses,
// not from an arbitrary-up cross product (which is what linkOverlay's PRISM
// tube does, and why a prism's roll is not this one's): column 2 is the unit
// A→B direction and column 0 is horizontal, so a link's glyph keeps a
// consistent, gravity-referenced roll as it swings around instead of flipping
// when a reference axis is crossed.

import { Geometry } from '../gv/types'
import { PIN_HEIGHT, PIN_RADIUS } from './glyphGeometry'

/**
 * Geometry ids that keep drawing a link as a LINE rather than as a stretched
 * glyph:
 *
 *  - 27 Line — the classic thin connector, and the default.
 *  - 28 Textured Prism — the scrolling tube, with its own bespoke draw.
 *  - 22 Point — a fixed-pixel sprite has no extent to stretch along anything,
 *    so there is no sensible glyph reading of it; it also keeps every existing
 *    file that parked links on Point (the Org_Event_Network example's 6,400
 *    edges) rendering unchanged.
 */
export const LINK_LINE_GEOMETRIES: ReadonlySet<number> = new Set<number>([
  Geometry.Line,
  Geometry.TexturedPrism,
  Geometry.Point,
])

/**
 * Local-space z extent every shape is built on — unit radius about the local
 * origin (uvGeometry.ts / the Three primitives it wraps).
 */
export const DEFAULT_LOCAL_Z_SPAN: readonly [number, number] = [-1, 1]

/** The exceptions: the pin stands ON its apex at the local origin (6aa). */
const LOCAL_Z_SPAN: Record<number, readonly [number, number]> = {
  [Geometry.PinSolid]: [0, PIN_HEIGHT + PIN_RADIUS],
  [Geometry.PinWire]: [0, PIN_HEIGHT + PIN_RADIUS],
}

/**
 * True when a Link node's `geometry` names a real 3-D glyph to be stretched
 * between its two ends, rather than one of the line modes.
 */
export function isGlyphLink(geometry: number): boolean {
  return !LINK_LINE_GEOMETRIES.has(geometry)
}

/** The (min, max) local-z extent `linkGlyphMatrix` maps onto the edge. */
export function localZSpan(geometry: number): readonly [number, number] {
  return LOCAL_Z_SPAN[geometry] ?? DEFAULT_LOCAL_Z_SPAN
}

export interface LinkAxisBasis {
  /** Rotation columns; `col2` is the unit A→B direction. */
  col0: [number, number, number]
  col1: [number, number, number]
  col2: [number, number, number]
  /** Distance between the two ends. */
  length: number
}

export type Point3 = readonly [number, number, number]

/**
 * Orthonormal rotation columns for the edge A→B plus its length, or null when
 * the two ends coincide (nothing to orient).
 *
 * Reproduces ANTz's Rz(atan2(uy,ux) − 90°) · Rx(asin(uz) + 90°) composition,
 * where u is the B→A unit vector — hence the sign flips below. Straight from
 * that product:
 *
 *     col0 = ( sz, -cz,   0 )
 *     col1 = (-cz*sx, -sz*sx,  cx )
 *     col2 = (-cz*cx, -sz*cx, -sx )  ==  -u  ==  the A→B direction
 *
 * A perfectly vertical edge lands on atan2(0, 0) === 0, which is well-defined
 * in C, Python and JS alike and gives col0 = (0, −1, 0) — so there is no
 * special case, just the shared roll convention degrading gracefully.
 */
export function linkAxisBasis(a: Point3, b: Point3): LinkAxisBasis | null {
  // u points B→A, matching ANTz's `vec = parent->world - child->world`.
  let ux = a[0] - b[0]
  let uy = a[1] - b[1]
  let uz = a[2] - b[2]
  const length = Math.sqrt(ux * ux + uy * uy + uz * uz)
  if (length < 1e-9) return null
  ux /= length
  uy /= length
  uz /= length

  const rotZ = Math.atan2(uy, ux)
  const rotX = Math.asin(Math.max(-1, Math.min(1, uz)))
  const cz = Math.cos(rotZ)
  const sz = Math.sin(rotZ)
  const cx = Math.cos(rotX)
  const sx = Math.sin(rotX)

  return {
    col0: [sz, -cz, 0],
    col1: [-cz * sx, -sz * sx, cx],
    col2: [-cz * cx, -sz * cx, -sx],
    length,
  }
}

/**
 * World matrix placing a unit glyph so it spans the edge A→B: `ratio` wide on
 * both cross-axes, `geometry`'s local z span stretched to the endpoint
 * distance. Returned COLUMN-major (the desktop's `link_gl_matrix` layout,
 * which is also `THREE.Matrix4.fromArray`'s), or null for a degenerate
 * zero-length edge — there is no axis to orient along and no sane fallback, so
 * the caller skips the draw.
 */
export function linkGlyphMatrix(
  a: Point3,
  b: Point3,
  ratio: number,
  geometry = 0,
): number[] | null {
  const basis = linkAxisBasis(a, b)
  if (basis === null) return null
  const { col0, col1, col2, length } = basis

  let [zMin, zMax] = localZSpan(geometry)
  let span = zMax - zMin
  if (span <= 1e-9) {
    // A flat glyph with no z extent to stretch: fall back to ANTz's fixed
    // 2-unit assumption so it lands centred on the edge rather than dividing
    // by zero. (Nothing in the table lands here today — Circle/Cross/Star and
    // the Grid plate take the −1..1 default like everything else.)
    zMin = DEFAULT_LOCAL_Z_SPAN[0]
    zMax = DEFAULT_LOCAL_Z_SPAN[1]
    span = 2
  }
  const zScale = length / span
  // Offset along the edge that puts local z === zMin on the A-end. For the
  // symmetric default span this is +length/2, i.e. ANTz's midpoint.
  const offset = -zMin * zScale

  return [
    col0[0] * ratio, col0[1] * ratio, col0[2] * ratio, 0,
    col1[0] * ratio, col1[1] * ratio, col1[2] * ratio, 0,
    col2[0] * zScale, col2[1] * zScale, col2[2] * zScale, 0,
    a[0] + col2[0] * offset, a[1] + col2[1] * offset, a[2] + col2[2] * offset, 1,
  ]
}
