// A gently curved panel: a cylindrical shell that wraps its edges toward the
// viewer, so a wide dashboard is the same distance from your eye at its corners
// as at its middle.
//
// The whole reason this is a cheap change rather than a rewrite is the UV
// convention. Panel hit-testing reads `hit.uv` (xrSurface.ts) and every widget
// lives in normalised 0..1 coordinates (ui/xrWidget.ts), so ANY geometry whose
// UVs match PlaneGeometry's drives the existing layouts, painters and hit tests
// unchanged. This emits exactly PlaneGeometry's parameterisation — u 0..1 left
// to right, v 1 at the TOP — and nothing above it had to learn about curvature.
//
// Curvature is given as a RATIO of the panel's own width, not as a radius in
// metres, so the shape is scale-invariant: the pinned slab (1.9×) wraps through
// the same angle as the wrist-docked one, and looks like the same object made
// bigger rather than a different, flatter one.

import * as THREE from 'three'

/**
 * width / radius, which is also the sweep in radians.
 *
 * 0.7 puts the radius at 1.43 × the panel's width, and the number is chosen so
 * the shell approximates a cylinder centred on the EYE in both states this
 * panel has: pinned it is 0.57 m across and parked 0.75 m away (radius 0.81),
 * and wrist-docked it is 0.30 m across at roughly 0.35 m (radius 0.43). Under
 * that, corners sit further away than the middle and the wrap buys nothing;
 * far over it, the edges turn away far enough to read as foreshortened.
 */
export const PANEL_CURVE = 0.7

/** How many columns the shell is built from. 28 keeps the silhouette smooth at
 *  reading distance; the rows are flat, so one quad tall is enough. */
const SEGMENTS = 28

/**
 * Local position on the shell at a normalised (u, v), v counted DOWN from the
 * top the way every panel layout counts. Shared with the geometry builder so a
 * point looked up here is on the surface a ray would hit, exactly.
 */
export function curvedPanelPoint(
  u: number,
  v: number,
  width: number,
  height: number,
  curve: number,
  target = new THREE.Vector3(),
): THREE.Vector3 {
  const y = (0.5 - v) * height
  if (curve <= 0) return target.set((u - 0.5) * width, y, 0)
  const radius = width / curve
  const theta = (u - 0.5) * curve
  // The centre of curvature sits at +Z, in FRONT of the panel's middle, so the
  // edges come toward the viewer and the face is concave to them.
  return target.set(radius * Math.sin(theta), y, radius * (1 - Math.cos(theta)))
}

/** Outward (viewer-facing) normal at u, matching the point above. */
export function curvedPanelNormal(u: number, curve: number, target = new THREE.Vector3()) {
  if (curve <= 0) return target.set(0, 0, 1)
  const theta = (u - 0.5) * curve
  return target.set(-Math.sin(theta), 0, Math.cos(theta))
}

/**
 * The shell. `curve` of 0 gives a flat quad, which is what makes this a safe
 * drop-in for PlaneGeometry — including for a panel that deliberately stays
 * flat.
 */
export function curvedPanelGeometry(
  width: number,
  height: number,
  curve = PANEL_CURVE,
): THREE.BufferGeometry {
  if (curve <= 0) return new THREE.PlaneGeometry(width, height)

  const columns = SEGMENTS
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const point = new THREE.Vector3()
  const normal = new THREE.Vector3()
  for (let row = 0; row < 2; row++) {
    // v counts DOWN, so row 0 is the top — which is uv.y = 1, PlaneGeometry's
    // own convention and the one xrSurface flips back on the way in.
    const v = row
    for (let column = 0; column <= columns; column++) {
      const u = column / columns
      curvedPanelPoint(u, v, width, height, curve, point)
      curvedPanelNormal(u, curve, normal)
      positions.push(point.x, point.y, point.z)
      normals.push(normal.x, normal.y, normal.z)
      uvs.push(u, 1 - v)
    }
  }

  const indices: number[] = []
  for (let column = 0; column < columns; column++) {
    const a = column
    const b = column + columns + 1
    const c = column + columns + 2
    const d = column + 1
    indices.push(a, b, d, b, c, d)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setIndex(indices)
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  return geometry
}
