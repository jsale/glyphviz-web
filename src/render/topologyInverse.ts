// Inverse topology mapping for gizmo dragging (interaction 6c): convert a
// dragged position in the parent's unscaled local frame back into the
// child's translate_x/y/z in the parent's topology coordinate system —
// the exact inverse of topoOffset.
//
// Policies (agreed 2026-07-24):
// - Angle unwrap: every recovered angle snaps to the nearest 360°-equivalent
//   of its previous value, so tx = 270 stays ~270 instead of jumping to −90
//   and Spiral keeps its winding count.
// - Singular poses hold: where a coordinate is undefined (sphere pole or
//   center, cylinder axis, torus ring), it keeps its previous value.
// - Facet never changes on a drag: Cube/Zcube invert within the child's
//   current face.

import * as THREE from 'three'
import type { Vec3 } from '../gv/types'
import { Topo } from '../gv/types'
import { topoOffset } from './topology'

const RAD2DEG = 180 / Math.PI
const EPS = 1e-9

/** Nearest 360°-equivalent of `angle` to `ref`. */
export function unwrapDeg(angle: number, ref: number): number {
  return angle + 360 * Math.round((ref - angle) / 360)
}

/** Rod topology spans 2 · ROD_HEIGHT_FACTOR · B (matches topology.ts). */
const ROD_SPAN_FACTOR = 2 * 5.0

const CUBE_FACES: ReadonlyArray<readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3]> = [
  [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)],
  [new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1)],
  [new THREE.Vector3(0, 1, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1)],
  [new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)],
  [new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)],
  [new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, -1, 0)],
]

export interface InverseInput {
  parentTopo: number
  /** Dragged position in the parent's unscaled local frame. */
  offset: THREE.Vector3
  /** The node's current translate — unwrap reference and singularity hold. */
  prev: Vec3
  parentRatio: number
  subspace: number
  baseScale: number
}

/** Exact inverse of topoOffset under the unwrap/hold policies. */
export function invertTopoOffset(p: InverseInput): Vec3 {
  const { parentTopo, offset, prev, parentRatio, subspace, baseScale: B } = p
  const { x, y, z } = offset

  const horizontal = Math.hypot(x, y)
  const azimuth = horizontal < EPS ? null : Math.atan2(y, x) * RAD2DEG

  switch (parentTopo) {
    case Topo.Sphere:
    case Topo.Point:
    case Topo.Zsphere: {
      const base = parentTopo === Topo.Sphere ? B : 0
      const r = offset.length()
      if (r < EPS) return { x: prev.x, y: prev.y, z: -base }
      const lat = Math.asin(Math.max(-1, Math.min(1, z / r))) * RAD2DEG
      const lon = azimuth === null ? prev.x : unwrapDeg(azimuth, prev.x)
      return { x: lon, y: lat, z: r - base }
    }

    case Topo.Torus:
    case Topo.Ztorus: {
      const minor = parentRatio * B
      const major = B - minor
      const u = azimuth === null ? prev.x : unwrapDeg(azimuth, prev.x)
      const d = horizontal - major
      const tubeR = Math.hypot(d, z)
      const v = tubeR < EPS ? prev.y : unwrapDeg(Math.atan2(z, d) * RAD2DEG, prev.y)
      const tz = parentTopo === Topo.Torus ? tubeR - minor : tubeR
      return { x: u, y: v, z: tz }
    }

    case Topo.Cylinder: {
      const tx = azimuth === null ? prev.x : unwrapDeg(azimuth, prev.x)
      return { x: tx, y: z, z: horizontal - B }
    }

    case Topo.Zcylinder:
    case Topo.Zrod: {
      const tx = azimuth === null ? prev.x : unwrapDeg(azimuth, prev.x)
      return { x: tx, y: z, z: horizontal }
    }

    case Topo.Rod: {
      const ty = azimuth === null ? prev.y : unwrapDeg(azimuth, prev.y)
      return { x: (z / (ROD_SPAN_FACTOR * B)) * 180, y: ty, z: horizontal }
    }

    case Topo.Pin:
      return { x: z - B, y: x, z: y }

    case Topo.Cube:
    case Topo.Zcube: {
      const [normal, u, v] = CUBE_FACES[Math.max(0, Math.min(5, subspace))]
      const dist = offset.dot(normal)
      return {
        x: offset.dot(u),
        y: offset.dot(v),
        z: parentTopo === Topo.Cube ? dist - B : dist,
      }
    }

    case Topo.Spiral: {
      const tx = azimuth === null ? prev.x : unwrapDeg(azimuth, prev.x)
      return { x: tx, y: z - (tx / 360) * B, z: horizontal - B }
    }

    default:
      // Cartesian family and unknown ids, matching topoOffset's fallback.
      return { x, y, z }
  }
}

/**
 * Which translate field a drag along `motionDir` (unit-ish vector in the
 * parent's unscaled local frame) predominantly edits, decided by comparing
 * against the placement function's numeric gradients at the drag-start
 * translate. Returns null when no single field dominates (degenerate
 * gradients or an off-axis/planar drag) — callers then leave all fields
 * free. Pinning the two non-dominant fields at their drag-start values is
 * what turns TransformControls' straight-line (chord) drag into clean
 * "one arrow, one coordinate" edits with no altitude drift.
 */
export function pickDominantField(
  parentTopo: number,
  start: Vec3,
  motionDir: THREE.Vector3,
  parentRatio: number,
  subspace: number,
  baseScale: number,
): 'x' | 'y' | 'z' | null {
  const dir = motionDir.clone()
  if (dir.lengthSq() < EPS) return null
  dir.normalize()

  const at = (t: Vec3) =>
    topoOffset({
      parentTopo,
      tx: t.x,
      ty: t.y,
      tz: t.z,
      parentRatio,
      subspace,
      baseScale,
    })
  const origin = at(start)
  const H = 1e-4
  const fields: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z']
  let best: 'x' | 'y' | 'z' | null = null
  let bestAlign = 0
  let secondAlign = 0
  for (const field of fields) {
    const bumped = { ...start, [field]: start[field] + H }
    const grad = at(bumped).sub(origin)
    if (grad.lengthSq() < EPS * EPS) continue
    const align = Math.abs(grad.normalize().dot(dir))
    if (align > bestAlign) {
      secondAlign = bestAlign
      bestAlign = align
      best = field
    } else if (align > secondAlign) {
      secondAlign = align
    }
  }
  // Demand a clear winner that actually aligns with the motion.
  if (best === null || bestAlign < 0.7 || bestAlign - secondAlign < 0.2) return null
  return best
}
