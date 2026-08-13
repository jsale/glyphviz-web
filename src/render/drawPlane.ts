// Draw Mode's screen→grid math: where a pointer ray meets a flat World Grid's
// drawing plane, in the (lon, lat) coordinates a child of that grid is authored
// in. Ported from the desktop's glyphviz_core/draw_mode.py `grid_hit`
// (dfef096), which inverts its flat_child placement branch exactly.
//
// The inversion is exact, not approximate, and that is the whole point: a child
// stamped at the returned (lon, lat) lands under the cursor by construction,
// whatever the grid's translate/rotate/scale or how deeply it is nested.
//
// Our forward rule (buildScene.framePosition) puts a flat grid's child at
//
//     world = gridFrame.matrixWorld · diag(grid.scale) · (lon − c_lon,
//                                                        lat − c_lat, tz)
//
// — the grid's own scale re-spaces its children rather than living on its
// frame (the ANTz Grid rule), so it has to be multiplied back in here to get
// the desktop's `grid_world_basis`. Everything else, including every ancestor's
// rotation and scale, is already in matrixWorld.

import * as THREE from 'three'
import type { GvNode } from '../gv/types'
import { gridCenter } from '../gv/worldGrid'

const EPS = 1e-9

const basis = /*@__PURE__*/ new THREE.Matrix4()
const scaleMatrix = /*@__PURE__*/ new THREE.Matrix4()
const localOrigin = /*@__PURE__*/ new THREE.Vector3()
const localDir = /*@__PURE__*/ new THREE.Vector3()

/**
 * The (lon, lat) child coordinates where `ray` crosses `grid`'s drawing plane
 * (grid-local z = `drawZ`), or null.
 *
 * `gridFrame` is the grid's Object3D from buildScene's id→frame map; its
 * matrixWorld must be current (the animation loop's render pass leaves it so —
 * a frame added since the last render needs an explicit updateMatrixWorld,
 * exactly as setSelection's halo rewrite does).
 *
 * Null in the desktop's three cases: a singular basis (a zero-scale axis, so
 * the grid has no plane to speak of), a ray parallel to the plane (edge-on),
 * and a plane behind the camera.
 */
export function gridHit(
  ray: THREE.Ray,
  grid: GvNode,
  gridFrame: THREE.Object3D,
  drawZ = 0,
): { lon: number; lat: number } | null {
  scaleMatrix.makeScale(grid.scale.x, grid.scale.y, grid.scale.z)
  basis.copy(gridFrame.matrixWorld).multiply(scaleMatrix)
  return gridHitInBasis(ray, basis, gridCenter(grid), drawZ)
}

/**
 * The inversion itself, against a grid's full world basis — the desktop's own
 * signature (`grid_hit(ray, grid_pos, grid_basis, grid_center, draw_z)`, with
 * the position folded into the 4×4 here). Separated out so the parity harness
 * can feed the desktop's exact matrices in without a scene to build them from.
 */
export function gridHitInBasis(
  ray: THREE.Ray,
  gridBasis: THREE.Matrix4,
  center: { lon: number; lat: number },
  drawZ = 0,
): { lon: number; lat: number } | null {
  if (Math.abs(gridBasis.determinant()) < EPS) return null
  const inverse = basis.copy(gridBasis).invert()

  localOrigin.copy(ray.origin).applyMatrix4(inverse)
  // Direction takes the linear part only. transformDirection normalizes, which
  // rescales t by a positive factor and so leaves the sign test below intact.
  localDir.copy(ray.direction).transformDirection(inverse)
  if (Math.abs(localDir.z) < EPS) return null

  const t = (drawZ - localOrigin.z) / localDir.z
  if (t <= 0) return null

  return {
    lon: localOrigin.x + localDir.x * t + center.lon,
    lat: localOrigin.y + localDir.y * t + center.lat,
  }
}
