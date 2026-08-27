import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  PANEL_CURVE,
  curvedPanelGeometry,
  curvedPanelNormal,
  curvedPanelPoint,
} from './xrCurvedPanel'

const W = 0.3
const H = 0.215

/** Every uv the tests probe, corners included. */
const SAMPLES: Array<[number, number]> = [
  [0, 0],
  [0.5, 0],
  [1, 0],
  [0, 1],
  [0.5, 0.5],
  [1, 1],
  [0.23, 0.77],
]

describe('curvedPanelGeometry', () => {
  const geometry = curvedPanelGeometry(W, H, PANEL_CURVE)
  const flat = new THREE.PlaneGeometry(W, H)

  it('carries PlaneGeometry’s UV convention, which is what makes it a drop-in', () => {
    // Every widget rect and every hit test is in normalised coordinates, so the
    // ONE thing the curve must not change is what a uv means.
    const uv = geometry.getAttribute('uv')
    const position = geometry.getAttribute('position')
    let topAtV1 = 0
    for (let i = 0; i < uv.count; i++) {
      expect(uv.getX(i)).toBeGreaterThanOrEqual(0)
      expect(uv.getX(i)).toBeLessThanOrEqual(1)
      // v = 1 is the TOP edge, as PlaneGeometry emits it. Precision 6, not 12:
      // a BufferAttribute is Float32.
      if (uv.getY(i) === 1) {
        expect(position.getY(i)).toBeCloseTo(H / 2, 6)
        topAtV1++
      } else {
        expect(position.getY(i)).toBeCloseTo(-H / 2, 6)
      }
    }
    expect(topAtV1).toBeGreaterThan(0)
    // The flat control agrees about the corner it calls v = 1.
    const flatUv = flat.getAttribute('uv')
    const flatPos = flat.getAttribute('position')
    for (let i = 0; i < flatUv.count; i++) {
      if (flatUv.getY(i) === 1) expect(flatPos.getY(i)).toBeCloseTo(H / 2, 6)
    }
  })

  it('measures the panel’s width along its SURFACE, not across its footprint', () => {
    // The width a layout means is arc length: a widget 0.175 wide occupies
    // 0.175 × W of readable surface. The bounding box is the CHORD, which is
    // necessarily a little narrower — 2R·sin(θ/2) against the arc's R·θ — and
    // that difference is the curve, not an error. Worth pinning, because
    // "the panel came out 1% narrow" is exactly the kind of thing someone
    // later corrects by scaling the geometry and quietly breaking the layout.
    let arc = 0
    const position = geometry.getAttribute('position')
    const p = new THREE.Vector3()
    const previous = new THREE.Vector3()
    for (let i = 0; i <= 28; i++) {
      p.set(position.getX(i), position.getY(i), position.getZ(i))
      if (i > 0) arc += p.distanceTo(previous)
      previous.copy(p)
    }
    expect(arc).toBeCloseTo(W, 4)

    geometry.computeBoundingBox()
    const box = geometry.boundingBox!
    expect(box.max.y - box.min.y).toBeCloseTo(H, 6)
    const chord = 2 * (W / PANEL_CURVE) * Math.sin(PANEL_CURVE / 2)
    expect(box.max.x - box.min.x).toBeCloseTo(chord, 6)
    expect(chord).toBeLessThan(W)
  })

  it('wraps its edges TOWARD the viewer, not away', () => {
    // Concave to the reader: a convex panel would push its corners further from
    // the eye, which is the opposite of the point.
    const middle = curvedPanelPoint(0.5, 0.5, W, H, PANEL_CURVE)
    const edge = curvedPanelPoint(1, 0.5, W, H, PANEL_CURVE)
    expect(middle.z).toBeCloseTo(0, 12)
    expect(edge.z).toBeGreaterThan(0)
  })

  it('keeps every point the same distance from the centre of curvature', () => {
    const radius = W / PANEL_CURVE
    const centre = new THREE.Vector3(0, 0, radius)
    for (const [u, v] of SAMPLES) {
      const p = curvedPanelPoint(u, v, W, H, PANEL_CURVE)
      expect(Math.hypot(p.x - centre.x, p.z - centre.z)).toBeCloseTo(radius, 12)
    }
  })

  it('points its normals at the centre of curvature', () => {
    const radius = W / PANEL_CURVE
    for (const [u] of SAMPLES) {
      const p = curvedPanelPoint(u, 0.5, W, H, PANEL_CURVE)
      const n = curvedPanelNormal(u, PANEL_CURVE)
      expect(n.length()).toBeCloseTo(1, 12)
      const toCentre = new THREE.Vector3(-p.x, 0, radius - p.z).normalize()
      expect(n.dot(toCentre)).toBeCloseTo(1, 12)
    }
  })

  it('agrees with the geometry it builds, vertex for vertex', () => {
    // The point helper is what a caller uses to place something ON the panel,
    // so it has to be the same surface the ray hits — not an approximation.
    const position = geometry.getAttribute('position')
    const uv = geometry.getAttribute('uv')
    for (let i = 0; i < position.count; i++) {
      const p = curvedPanelPoint(uv.getX(i), 1 - uv.getY(i), W, H, PANEL_CURVE)
      expect(position.getX(i)).toBeCloseTo(p.x, 6)
      expect(position.getY(i)).toBeCloseTo(p.y, 6)
      expect(position.getZ(i)).toBeCloseTo(p.z, 6)
    }
  })

  it('winds its faces so the concave side is the FRONT', () => {
    // Panels are single-sided; wound the other way the dashboard would be
    // invisible from the only place anybody reads it.
    const index = geometry.getIndex()!
    const position = geometry.getAttribute('position')
    const v = (i: number) =>
      new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i))
    for (let f = 0; f < index.count; f += 3) {
      const a = v(index.getX(f))
      const b = v(index.getX(f + 1))
      const c = v(index.getX(f + 2))
      const face = new THREE.Vector3().subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b))
      // Toward the viewer, who stands on the +Z side of the middle.
      expect(face.normalize().z).toBeGreaterThan(0)
    }
  })

  it('falls back to a plain flat quad at zero curvature', () => {
    const plane = curvedPanelGeometry(W, H, 0)
    expect(plane).toBeInstanceOf(THREE.PlaneGeometry)
    expect(curvedPanelPoint(1, 0.5, W, H, 0).z).toBe(0)
    expect(curvedPanelNormal(0.9, 0).toArray()).toEqual([0, 0, 1])
  })

  it('is scale-invariant in shape, so pinning does not flatten it', () => {
    // The curve is a ratio of the width, so a panel scaled up wraps through the
    // same ANGLE — it reads as the same object made bigger.
    const small = curvedPanelPoint(1, 0.5, W, H, PANEL_CURVE)
    const large = curvedPanelPoint(1, 0.5, W * 3, H * 3, PANEL_CURVE)
    expect(large.x / small.x).toBeCloseTo(3, 9)
    expect(large.z / small.z).toBeCloseTo(3, 9)
  })
})
