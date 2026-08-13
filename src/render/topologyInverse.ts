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
import { DEFAULT_TOPO_SCALE, Topo } from '../gv/types'
import { LINEAR_PLACEMENT_AXES, topoOffset } from './topology'
import type { LinearAxes } from './topology'

/** Fallback classification for ids with no entry (Cartesian placement). */
const ALL_AXES_LINEAR: LinearAxes = [true, true, true]

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
  /**
   * The PARENT's `topo_scale` (topology.ts). topoOffset multiplies the
   * distance-valued axes by it before placing, so the inverse divides them back
   * out — without that, a parent retuned to TOPO_SCALE_ANTZ would drag its
   * children at 1/180 of the cursor's speed. Desktop `_move_divisors`.
   */
  parentTopoScale?: number
}

/**
 * Exact inverse of topoOffset under the unwrap/hold policies.
 *
 * topoOffset pre-multiplies the parent's distance-valued axes by its
 * topo_scale, so the inversion runs entirely in that SCALED space — `prev` is
 * lifted into it (it is only ever an unwrap reference or a singularity hold,
 * both of which have to be comparable with what the math recovers) and the
 * recovered translate is divided back out. Angular axes are untouched by
 * either step, so a scene at the default 1.0 takes the same path it always did.
 */
export function invertTopoOffset(p: InverseInput): Vec3 {
  const k = p.parentTopoScale ?? DEFAULT_TOPO_SCALE
  if (k === DEFAULT_TOPO_SCALE) return invertScaledOffset(p)
  const linear = LINEAR_PLACEMENT_AXES[p.parentTopo] ?? ALL_AXES_LINEAR
  const t = invertScaledOffset({
    ...p,
    prev: {
      x: linear[0] ? p.prev.x * k : p.prev.x,
      y: linear[1] ? p.prev.y * k : p.prev.y,
      z: linear[2] ? p.prev.z * k : p.prev.z,
    },
  })
  return {
    x: linear[0] ? t.x / k : t.x,
    y: linear[1] ? t.y / k : t.y,
    z: linear[2] ? t.z / k : t.z,
  }
}

/** The inversion proper, in the parent's own (already scaled) coordinates. */
function invertScaledOffset(p: InverseInput): Vec3 {
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
 *
 * `parentTopoScale` is passed through so the gradients are those of the
 * placement function actually in force. A positive value only rescales each
 * gradient's magnitude, and the alignment test normalizes them, so it changes
 * no answer — it is here to keep this the same function topoOffset is.
 */
export function pickDominantField(
  parentTopo: number,
  start: Vec3,
  motionDir: THREE.Vector3,
  parentRatio: number,
  subspace: number,
  baseScale: number,
  parentTopoScale = DEFAULT_TOPO_SCALE,
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
      parentTopoScale,
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
