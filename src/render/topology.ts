// Topology placement math: how a child's translate_x/y/z is interpreted in
// its parent's coordinate system, per the PARENT's topo id.
//
// Ported (behavior, not code) from the desktop engine's
// glyphviz_core/topology.py — the scalar _*_offset functions,
// _topology_base_rotation, and their batched equivalents (verified
// 2026-07-24). Spec reference: glyphviz-skill/references/topologies.md.
//
// The transform model (compute_world_transforms):
//   child_local  = topoBaseRotation · ownRotation
//   world_basis  = parent_basis · child_local · diag(scale)
//   world_pos    = parent_pos + parent_world_basis · topoOffset(child)
// which a Three.js Object3D reproduces when the frame's position is the
// topo offset and its quaternion is child_local.

import * as THREE from 'three'
import type { GvNode } from '../gv/types'
import { DEFAULT_TOPO_SCALE, NodeType, Topo } from '../gv/types'
/** Rod topology spans 2 · ROD_HEIGHT_FACTOR · B (glyphviz_core geometry_data). */
import { ROD_HEIGHT_FACTOR } from './glyphGeometry'

const DEG = Math.PI / 180

// ---------------------------------------------------------------------------
// Which of a child's translate_x/y/z each topology reads as a DISTANCE, and
// which it reads as an angle (or as a parameter already proportional to the
// parent's base radius, which is a distance that already tracks the parent's
// size and so needs no further scaling).
//
// The parent's `topoScale` multiplies exactly the true axes below, and nothing
// else. That is the whole implementation of the feature: every case in
// topoOffset stays untouched, because scaling an axis before the math is
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
// ---------------------------------------------------------------------------

/** [x, y, z] — true where the axis is a distance the parent's topoScale scales. */
export type LinearAxes = readonly [boolean, boolean, boolean]

const ALL_AXES_LINEAR: LinearAxes = [true, true, true]
const NO_AXES_LINEAR: LinearAxes = [false, false, false]

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

/**
 * The parent's topoScale as it applies to a child, or 1.0 where the parent is
 * exempt — what callers hand topoOffset as `parentTopoScale`.
 */
export function parentTopoScale(parent: GvNode | null): number {
  if (parent === null || parent.type === NodeType.WorldGrid) return DEFAULT_TOPO_SCALE
  return parent.topoScale
}

/** KML-style longitude/latitude/altitude → Cartesian, radius + altitude. */
function kmlOffset(lonDeg: number, latDeg: number, alt: number, radius: number): THREE.Vector3 {
  const lon = lonDeg * DEG
  const lat = latDeg * DEG
  const r = radius + alt
  const cosLat = Math.cos(lat)
  return new THREE.Vector3(r * cosLat * Math.cos(lon), r * cosLat * Math.sin(lon), r * Math.sin(lat))
}

// Cube faces: (normal, u, v) per subspace 0–5 (facet 1–6 on disk), u/v =
// right/up within the face viewed from outside, Z-up.
const CUBE_FACES: ReadonlyArray<readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3]> = [
  [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)],
  [new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1)],
  [new THREE.Vector3(0, 1, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1)],
  [new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)],
  [new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)],
  [new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, -1, 0)],
]

// Per-face base rotations aligning the child's +Z with the face normal:
// +X: Ry(90) · −X: Ry(−90) · +Y: Rx(−90) · −Y: Rx(90) · +Z: identity · −Z: Rx(180)
const CUBE_FACE_BASE_ROTS: readonly THREE.Matrix4[] = [
  new THREE.Matrix4().makeRotationY(90 * DEG),
  new THREE.Matrix4().makeRotationY(-90 * DEG),
  new THREE.Matrix4().makeRotationX(-90 * DEG),
  new THREE.Matrix4().makeRotationX(90 * DEG),
  new THREE.Matrix4(),
  new THREE.Matrix4().makeRotationX(180 * DEG),
]

function clampFace(subspace: number): number {
  return Math.max(0, Math.min(5, subspace))
}

export interface TopoPlacementInput {
  /** Parent's topo id (any Cartesian-family or unknown id → plain offset). */
  parentTopo: number
  /** Child's translate_x/y/z. */
  tx: number
  ty: number
  tz: number
  /** Parent's ratio (drives Torus/Ztorus tube). */
  parentRatio: number
  /** Child's subspace (0-indexed cube face). */
  subspace: number
  /** Global base scale B (desktop default 1.0). */
  baseScale: number
  /**
   * The PARENT's `topo_scale`, multiplying only the axes its topology reads as
   * distances (LINEAR_PLACEMENT_AXES). Omitted = 1.0, the pre-topoScale
   * behaviour — a translate unit is a world unit. Callers that place a child
   * under a World Grid or at the root leave it out, since both are exempt.
   */
  parentTopoScale?: number
}

/**
 * Child's Cartesian offset in the parent's unscaled local frame. Cartesian
 * (tx, ty, tz) is both TOPO_NONE's behavior and the fallback for unknown
 * ids — Plane/Video/Plot/Surface share it.
 */
export function topoOffset(p: TopoPlacementInput): THREE.Vector3 {
  const { parentTopo, parentRatio, subspace, baseScale: B } = p
  // The whole of topo_scale: pre-multiply the distance-valued axes, then run
  // the untouched per-topology math. Skipped entirely at the default, so an
  // ordinary scene pays a single compare per node.
  let { tx, ty, tz } = p
  const k = p.parentTopoScale ?? DEFAULT_TOPO_SCALE
  if (k !== DEFAULT_TOPO_SCALE) {
    const linear = LINEAR_PLACEMENT_AXES[parentTopo] ?? ALL_AXES_LINEAR
    if (linear[0]) tx *= k
    if (linear[1]) ty *= k
    if (linear[2]) tz *= k
  }
  switch (parentTopo) {
    case Topo.Sphere:
      return kmlOffset(tx, ty, tz, B)
    case Topo.Point:
    case Topo.Zsphere:
      return kmlOffset(tx, ty, tz, 0)
    case Topo.Torus:
    case Topo.Ztorus: {
      const u = tx * DEG
      const v = ty * DEG
      const minor = parentRatio * B
      const major = B - minor
      const tubeR = parentTopo === Topo.Torus ? minor + tz : tz
      const radial = major + tubeR * Math.cos(v)
      return new THREE.Vector3(radial * Math.cos(u), radial * Math.sin(u), tubeR * Math.sin(v))
    }
    case Topo.Rod: {
      const angle = ty * DEG
      return new THREE.Vector3(
        tz * Math.cos(angle),
        tz * Math.sin(angle),
        (tx / 180) * 2 * B * ROD_HEIGHT_FACTOR,
      )
    }
    case Topo.Cylinder: {
      const angle = tx * DEG
      const radial = B + tz
      return new THREE.Vector3(radial * Math.cos(angle), radial * Math.sin(angle), ty)
    }
    case Topo.Zcylinder:
    case Topo.Zrod: {
      const angle = tx * DEG
      return new THREE.Vector3(tz * Math.cos(angle), tz * Math.sin(angle), ty)
    }
    case Topo.Pin:
      return new THREE.Vector3(ty, tz, B + tx)
    case Topo.Cube:
    case Topo.Zcube: {
      const [normal, u, v] = CUBE_FACES[clampFace(subspace)]
      const dist = parentTopo === Topo.Cube ? B + tz : tz
      return new THREE.Vector3()
        .addScaledVector(normal, dist)
        .addScaledVector(u, tx)
        .addScaledVector(v, ty)
    }
    case Topo.Spiral: {
      const theta = tx * DEG
      const radial = B + tz
      return new THREE.Vector3(
        radial * Math.cos(theta),
        radial * Math.sin(theta),
        (tx / 360) * B + ty,
      )
    }
    default:
      return new THREE.Vector3(tx, ty, tz)
  }
}

/**
 * Outward-orientation scaffold premultiplied onto the child's own rotation
 * so a child posed to face outward keeps facing outward as its placement
 * coordinates change. Identity for Cartesian-family/Pin/unknown parents.
 */
export function topoBaseRotation(
  parentTopo: number,
  tx: number,
  ty: number,
  subspace: number,
): THREE.Matrix4 {
  switch (parentTopo) {
    case Topo.Rod:
      return new THREE.Matrix4().makeRotationZ(ty * DEG)
    case Topo.Zrod:
    case Topo.Cylinder:
    case Topo.Zcylinder:
    case Topo.Spiral:
      return new THREE.Matrix4().makeRotationZ(tx * DEG)
    case Topo.Sphere:
    case Topo.Point:
    case Topo.Torus:
    case Topo.Ztorus:
      return new THREE.Matrix4()
        .makeRotationZ(tx * DEG)
        .multiply(new THREE.Matrix4().makeRotationY((90 - ty) * DEG))
    // Only Cube — the engine gives Zcube children identity orientation
    // (topologies.md's table lists Zcube too, but the code does not).
    case Topo.Cube:
      return CUBE_FACE_BASE_ROTS[clampFace(subspace)].clone()
    default:
      return new THREE.Matrix4()
  }
}
