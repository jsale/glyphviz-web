// The Flat Ring (geometry 33/34, desktop 721b827) — a torus with a rectangular
// cross-section, ported from tests/test_ring_geometry.py.
//
// The parity harness beside this one diffs the vertex stream against the real
// desktop builder. What these add is the structure the stream is supposed to
// HAVE, stated without reference to the fixture: outward winding (so FrontSide
// culling keeps the visible surface), constant per-face normals (the crisp
// machined edge a smooth-shaded torus cannot give), and the UV handedness that
// makes each face's texture read forwards.

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  RATIO_SHAPED_GEOMETRIES,
  WIRE_TO_SOLID,
  createGlyphObject,
  createPickProxy,
  ringDims,
} from './glyphGeometry'
import { zRingGeometry, zRingWireGeometry } from './uvGeometry'
import { GEOMETRY_MAX, GEOMETRY_NAMES, Geometry } from '../gv/types'

const TORUS_DEFAULT_RATIO = 0.14
const style = { color: new THREE.Color(1, 1, 1), opacity: 1, ratio: TORUS_DEFAULT_RATIO }

describe('the ring id table', () => {
  it('names both ids and keeps them in range', () => {
    // An unnamed id would leave the Geometry dropdowns and the VR Shape page
    // showing a bare number, since both build themselves from GEOMETRY_NAMES.
    for (const id of [Geometry.Ring, Geometry.RingWire]) {
      expect(id).toBeLessThanOrEqual(GEOMETRY_MAX)
      expect(GEOMETRY_NAMES[id]).toBeTruthy()
    }
    expect([Geometry.Ring, Geometry.RingWire]).toEqual([33, 34])
  })

  it('registers the wire ring as picking through its solid twin', () => {
    // The pick pass draws solid silhouettes for wire glyphs so a click inside
    // the shape registers; missing from this table, a wire ring would be
    // unpickable except exactly on a drawn line.
    expect(WIRE_TO_SOLID[Geometry.RingWire]).toBe(Geometry.Ring)
    expect(WIRE_TO_SOLID[Geometry.Ring]).toBeUndefined()
  })

  it('marks both ids as ratio-shaped', () => {
    // Membership is what routes them to the per-ratio geometry cache instead
    // of the one-shape-per-id one every other glyph shares.
    expect(RATIO_SHAPED_GEOMETRIES.has(Geometry.Ring)).toBe(true)
    expect(RATIO_SHAPED_GEOMETRIES.has(Geometry.RingWire)).toBe(true)
    expect([...RATIO_SHAPED_GEOMETRIES].sort((a, b) => a - b)).toEqual([
      Geometry.TorusWire,
      Geometry.TorusSolid,
      Geometry.Ring,
      Geometry.RingWire,
    ])
  })
})

describe('ringDims', () => {
  it('always spans the overall unit size', () => {
    // Every glyph here fits within radius ~1 at unit scale, which is what the
    // framing hint, the selection halo and Global Scale all assume.
    for (const ratio of [0.01, 0.14, 0.4, 0.75]) {
      expect(ringDims(ratio)[0]).toBeCloseTo(1, 12)
    }
    expect(ringDims(0.14, 7)[0]).toBeCloseTo(7, 12)
  })

  it('gives a square cross-section at any ratio', () => {
    // Which is what makes Scale Z read as a straight multiplier on the band's
    // height: at scale_z == scale_x the band is as tall as it is wide.
    for (const ratio of [0.02, TORUS_DEFAULT_RATIO, 0.3]) {
      const [outer, inner, halfHeight] = ringDims(ratio)
      expect((outer - inner) / 2).toBeCloseTo(halfHeight, 12)
    }
  })

  it('closes the hole past ratio 0.5 instead of inverting', () => {
    for (const ratio of [0.5, 0.8, 1.0]) {
      const [outer, inner] = ringDims(ratio)
      expect(inner).toBe(0)
      expect(outer).toBeCloseTo(1, 12)
    }
  })
})

/** The quads a strip of stations forms, in the winding that decides facing. */
function quads(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  const uv = geometry.getAttribute('uv')
  const at = (i: number) => ({
    p: new THREE.Vector3().fromBufferAttribute(position, i),
    n: new THREE.Vector3().fromBufferAttribute(normal, i),
    u: uv.getX(i),
    v: uv.getY(i),
  })
  const index = geometry.getIndex()!
  const out: Array<ReturnType<typeof at>[]> = []
  for (let t = 0; t < index.count; t += 3) {
    out.push([at(index.getX(t)), at(index.getX(t + 1)), at(index.getX(t + 2))])
  }
  return out
}

/** The four faces, as the runs of vertices sharing one strip. */
function faces(geometry: THREE.BufferGeometry, rings: number) {
  const position = geometry.getAttribute('position')
  const stride = 2 * (rings + 1)
  const out: number[][] = []
  for (let start = 0; start < position.count; start += stride) {
    out.push(Array.from({ length: stride }, (_, k) => start + k))
  }
  return out
}

describe('the solid ring', () => {
  const rings = 8
  const geometry = zRingGeometry(...ringDims(0.2), { rings })

  it('draws four faces', () => {
    expect(faces(geometry, rings).length).toBe(4)
  })

  it('gives each face ONE constant normal — the crisp machined edge', () => {
    // A torus shades smoothly round its tube; a flat ring must not. Two axial
    // faces with a single normal apiece, and two radial walls whose normal is
    // constant in the cross-section and simply turns with the station.
    const normal = geometry.getAttribute('normal')
    const position = geometry.getAttribute('position')
    let axial = 0
    for (const face of faces(geometry, rings)) {
      const distinct = new Set(
        face.map((i) => `${normal.getX(i)},${normal.getY(i)},${normal.getZ(i)}`),
      )
      if (distinct.size === 1) {
        axial++
        expect([...distinct][0]).toMatch(/^0,0,-?1$/)
        continue
      }
      for (const i of face) {
        expect(normal.getZ(i)).toBe(0) // a wall never tilts
        const radial = Math.hypot(position.getX(i), position.getY(i))
        if (radial < 1e-9) continue
        const dot =
          (normal.getX(i) * position.getX(i) + normal.getY(i) * position.getY(i)) / radial
        expect(Math.abs(Math.abs(dot) - 1)).toBeLessThan(1e-6)
      }
    }
    expect(axial).toBe(2)
  })

  it('winds every face outward', () => {
    // FrontSide culling is on for every solid glyph, so a face wound the other
    // way would simply vanish — which is exactly how the sphere's inward
    // winding hid itself for weeks (uvGeometry.test.ts).
    for (const [a, b, c] of quads(geometry)) {
      const emitted = new THREE.Vector3()
        .subVectors(b.p, a.p)
        .cross(new THREE.Vector3().subVectors(c.p, b.p))
      expect(emitted.dot(a.n)).toBeGreaterThan(0)
    }
  })

  it('mirrors no face — the texture contract', () => {
    // On every face, walking +u then +v must turn the same way the face
    // points. Otherwise a legend, a scale or a strip of degree numbers reads
    // BACKWARDS on that face, which for a graduated dial is the whole point of
    // the shape defeated. Same handedness check the interior geometries carry.
    for (const [a, b, c] of quads(geometry)) {
      const du = new THREE.Vector3()
      const dv = new THREE.Vector3()
      // Within a triangle of the strip, one edge changes u and the other v.
      for (const [from, to] of [
        [a, b],
        [a, c],
        [b, c],
      ] as const) {
        const step = new THREE.Vector3().subVectors(to.p, from.p)
        if (Math.abs(to.u - from.u) > 1e-9) {
          du.copy(to.u > from.u ? step : step.negate())
        } else if (Math.abs(to.v - from.v) > 1e-9) {
          dv.copy(to.v > from.v ? step : step.negate())
        }
      }
      expect(du.lengthSq()).toBeGreaterThan(0)
      expect(dv.lengthSq()).toBeGreaterThan(0)
      expect(du.cross(dv).dot(a.n)).toBeGreaterThan(0)
    }
  })

  it('gives every face a full 0–1 UV span of its own', () => {
    // Per-face 0–1 rather than v walking once around the cross-section
    // perimeter: that is what puts one undistorted copy of a marking strip on
    // the outer wall AND another on the dial face, instead of smearing one
    // image across all four and breaking it at every corner.
    const uv = geometry.getAttribute('uv')
    for (const face of faces(geometry, rings)) {
      const us = face.map((i) => uv.getX(i))
      const vs = face.map((i) => uv.getY(i))
      expect(Math.min(...us)).toBeCloseTo(0, 6)
      expect(Math.max(...us)).toBeCloseTo(1, 6)
      expect([...new Set(vs.map((v) => Math.round(v)))].sort()).toEqual([0, 1])
    }
  })

  it('skips the inner wall once the hole has closed', () => {
    // At ratio ≥ 0.5 there is no hole; a zero-radius inner wall would be a
    // degenerate strip down the axis, and its annulus faces become fans.
    const closed = zRingGeometry(...ringDims(0.6), { rings })
    expect(faces(closed, rings).length).toBe(3)
    for (const [a, b, c] of quads(closed)) {
      const area = new THREE.Vector3()
        .subVectors(b.p, a.p)
        .cross(new THREE.Vector3().subVectors(c.p, a.p))
        .length()
      expect(area).toBeGreaterThan(1e-9) // no degenerate triangles left behind
    }
  })
})

describe('the wire ring', () => {
  it('traces four edge circles and its rungs', () => {
    const geometry = zRingWireGeometry(...ringDims(0.2), { rings: 16, rungs: 6 })
    const position = geometry.getAttribute('position')
    expect(position.count).toBe(2 * (4 * 16 + 4 * 6))
    // The circles are flat, not helices: every vertex of the first loop shares
    // one z and one radius.
    const zs = new Set<number>()
    const radii = new Set<number>()
    for (let i = 0; i < 2 * 16; i++) {
      zs.add(Number(position.getZ(i).toFixed(6)))
      radii.add(Number(Math.hypot(position.getX(i), position.getY(i)).toFixed(6)))
    }
    expect(zs.size).toBe(1)
    expect(radii.size).toBe(1)
  })

  it('drops the inner circles once the hole has closed', () => {
    const geometry = zRingWireGeometry(...ringDims(0.6), { rings: 16, rungs: 6 })
    expect(geometry.getAttribute('position').count).toBe(2 * (2 * 16 + 4 * 6))
  })
})

describe('the ring glyph', () => {
  it('renders solid and wire from the node’s own ratio', () => {
    const solid = createGlyphObject(Geometry.Ring, style) as THREE.Mesh
    expect(solid).toBeInstanceOf(THREE.Mesh)
    expect((solid.material as THREE.Material).side).toBe(THREE.FrontSide)
    const wire = createGlyphObject(Geometry.RingWire, style) as THREE.LineSegments
    expect(wire).toBeInstanceOf(THREE.LineSegments)

    // A different ratio is a different SHAPE, not merely a different size.
    const wide = createGlyphObject(Geometry.Ring, { ...style, ratio: 0.4 }) as THREE.Mesh
    expect(wide.geometry).not.toBe(solid.geometry)
    // …while the same ratio is shared, which is what keeps a 991-node scene of
    // rings affordable.
    expect((createGlyphObject(Geometry.Ring, style) as THREE.Mesh).geometry).toBe(solid.geometry)
  })

  it('is lit, unlike the interior shapes', () => {
    const solid = createGlyphObject(Geometry.Ring, style) as THREE.Mesh
    expect(solid.material).toBeInstanceOf(THREE.MeshLambertMaterial)
  })

  it('bounds the geometry cache under a swept ratio', () => {
    const seen = new Set<THREE.BufferGeometry>()
    for (let i = 0; i < 1000; i++) {
      const ring = createGlyphObject(Geometry.Ring, { ...style, ratio: (i / 1000) * 0.5 })
      seen.add((ring as THREE.Mesh).geometry)
    }
    expect(seen.size).toBeLessThanOrEqual(51)
  })

  it('picks against the band it actually draws', () => {
    // The ring is the one shape whose `ratio` decides how much of its own
    // footprint is solid at all, so a fixed-ratio proxy would let clicks
    // through the middle of a wide dial and catch clicks aimed through a thin
    // hoop's hole.
    const rail = createPickProxy(Geometry.Ring, undefined, 0.02) as THREE.Mesh
    const dial = createPickProxy(Geometry.Ring, undefined, 0.4) as THREE.Mesh
    expect(rail.geometry).not.toBe(dial.geometry)
    // It IS the visible glyph's geometry, so accuracy costs nothing.
    const glyph = createGlyphObject(Geometry.Ring, { ...style, ratio: 0.02 }) as THREE.Mesh
    expect(rail.geometry).toBe(glyph.geometry)
    // A wire ring picks as the solid band at the same ratio.
    const wireProxy = createPickProxy(Geometry.RingWire, undefined, 0.02) as THREE.Mesh
    expect(wireProxy.geometry).toBe(rail.geometry)

    // A ray down the axis misses the rail's hole and hits the dial's body.
    const down = () =>
      new THREE.Raycaster(new THREE.Vector3(0.5, 0, 5), new THREE.Vector3(0, 0, -1))
    rail.updateMatrixWorld(true)
    dial.updateMatrixWorld(true)
    expect(down().intersectObject(rail, false).length).toBe(0)
    expect(down().intersectObject(dial, false).length).toBeGreaterThan(0)
  })
})
