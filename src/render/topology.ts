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
import { Topo } from '../gv/types'

/** Rod topology spans 2 · ROD_HEIGHT_FACTOR · B (glyphviz_core geometry_data). */
const ROD_HEIGHT_FACTOR = 5.0

const DEG = Math.PI / 180

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
}

/**
 * Child's Cartesian offset in the parent's unscaled local frame. Cartesian
 * (tx, ty, tz) is both TOPO_NONE's behavior and the fallback for unknown
 * ids — Plane/Video/Plot/Surface share it.
 */
export function topoOffset(p: TopoPlacementInput): THREE.Vector3 {
  const { parentTopo, tx, ty, tz, parentRatio, subspace, baseScale: B } = p
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
