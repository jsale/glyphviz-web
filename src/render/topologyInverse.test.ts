import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { invertTopoOffset, pickDominantField, unwrapDeg } from './topologyInverse'
import { topoOffset } from './topology'
import { Topo, TOPO_SCALE_ANTZ } from '../gv/types'
import type { Vec3 } from '../gv/types'

const B = 1

function roundTrip(
  parentTopo: number,
  t: Vec3,
  opts: { ratio?: number; subspace?: number; topoScale?: number } = {},
): Vec3 {
  const offset = topoOffset({
    parentTopo,
    tx: t.x,
    ty: t.y,
    tz: t.z,
    parentRatio: opts.ratio ?? 0.1,
    subspace: opts.subspace ?? 0,
    baseScale: B,
    parentTopoScale: opts.topoScale,
  })
  return invertTopoOffset({
    parentTopo,
    offset,
    prev: t, // unwrap reference = the original values
    parentRatio: opts.ratio ?? 0.1,
    subspace: opts.subspace ?? 0,
    baseScale: B,
    parentTopoScale: opts.topoScale,
  })
}

function expectVec(actual: Vec3, expected: Vec3) {
  expect(actual.x).toBeCloseTo(expected.x, 6)
  expect(actual.y).toBeCloseTo(expected.y, 6)
  expect(actual.z).toBeCloseTo(expected.z, 6)
}

describe('invertTopoOffset round-trips topoOffset', () => {
  const cases: Array<[string, number, Vec3, { ratio?: number; subspace?: number }?]> = [
    ['Cartesian', Topo.None, { x: 1.5, y: -2, z: 0.5 }],
    ['Plane', Topo.Plane, { x: -3, y: 7, z: 0 }],
    ['Sphere', Topo.Sphere, { x: 72, y: 33, z: 0.4 }],
    ['Sphere negative lon', Topo.Sphere, { x: -120, y: -45, z: 0 }],
    ['Point', Topo.Point, { x: 10, y: 20, z: 2 }],
    ['Zsphere', Topo.Zsphere, { x: 200, y: 10, z: 1.5 }],
    ['Torus', Topo.Torus, { x: 144, y: 60, z: 0.2 }, { ratio: 0.25 }],
    ['Ztorus', Topo.Ztorus, { x: 300, y: -30, z: 0.3 }, { ratio: 0.1 }],
    ['Cylinder', Topo.Cylinder, { x: 216, y: 0.7, z: 0.2 }],
    ['Zcylinder', Topo.Zcylinder, { x: 90, y: -1, z: 0.5 }],
    ['Zrod', Topo.Zrod, { x: 45, y: 2, z: 1.2 }],
    ['Rod', Topo.Rod, { x: 120, y: 80, z: 0.4 }],
    ['Pin', Topo.Pin, { x: 0.6, y: -0.2, z: 0.3 }],
    ['Cube facet 1', Topo.Cube, { x: 0.2, y: 0.3, z: 0.1 }, { subspace: 0 }],
    ['Cube facet 6', Topo.Cube, { x: -0.4, y: 0.1, z: 0.05 }, { subspace: 5 }],
    ['Zcube facet 3', Topo.Zcube, { x: 0.25, y: -0.15, z: 0.6 }, { subspace: 2 }],
    ['Spiral two turns', Topo.Spiral, { x: 700, y: 0.3, z: 0.1 }],
  ]
  for (const [name, topo, t, opts] of cases) {
    it(name, () => {
      expectVec(roundTrip(topo, t, opts), t)
    })
  }

  // Every one of them again under a retuned parent (desktop `_move_divisors`):
  // the forward pass scales the distance-valued axes, so the drag inverse has
  // to divide them back out or a parent at the ANTz value would drag its
  // children at 1/180 of the cursor's speed.
  for (const topoScale of [TOPO_SCALE_ANTZ, 0.4, 6]) {
    for (const [name, topo, t, opts] of cases) {
      it(`${name} at topo_scale ${topoScale}`, () => {
        expectVec(roundTrip(topo, t, { ...opts, topoScale }), t)
      })
    }
  }
})

describe('inverse policies', () => {
  it('unwrapDeg picks the nearest 360°-equivalent', () => {
    expect(unwrapDeg(-90, 270)).toBe(270)
    expect(unwrapDeg(10, 700)).toBe(730)
    expect(unwrapDeg(179, -179)).toBe(-181)
  })

  it('preserves authored angles beyond ±180 (tx = 270 stays 270)', () => {
    expectVec(roundTrip(Topo.Sphere, { x: 270, y: 20, z: 0 }), { x: 270, y: 20, z: 0 })
  })

  it('preserves Spiral winding when the drag crosses the seam', () => {
    // Position computed at 725°; previous value 700° → recover 725, not 5.
    const offset = topoOffset({
      parentTopo: Topo.Spiral, tx: 725, ty: 0, tz: 0, parentRatio: 0.1, subspace: 0, baseScale: B,
    })
    const t = invertTopoOffset({
      parentTopo: Topo.Spiral, offset, prev: { x: 700, y: 0, z: 0 },
      parentRatio: 0.1, subspace: 0, baseScale: B,
    })
    expect(t.x).toBeCloseTo(725, 6)
    expect(t.y).toBeCloseTo(0, 6)
  })

  it('holds longitude at a sphere pole', () => {
    const t = invertTopoOffset({
      parentTopo: Topo.Sphere, offset: new THREE.Vector3(0, 0, 1.5),
      prev: { x: 123, y: 45, z: 0 }, parentRatio: 0.1, subspace: 0, baseScale: B,
    })
    expect(t.x).toBe(123) // held
    expect(t.y).toBeCloseTo(90, 6)
    expect(t.z).toBeCloseTo(0.5, 6)
  })

  it('holds everything meaningful at the sphere center', () => {
    const t = invertTopoOffset({
      parentTopo: Topo.Sphere, offset: new THREE.Vector3(0, 0, 0),
      prev: { x: 30, y: 40, z: 0 }, parentRatio: 0.1, subspace: 0, baseScale: B,
    })
    expect(t.x).toBe(30)
    expect(t.y).toBe(40)
    expect(t.z).toBeCloseTo(-1, 6)
  })

  it('inverts within the current cube face only', () => {
    // A point lifted off facet 1 (+X): components resolve in that face's
    // frame regardless of where the point is.
    const t = invertTopoOffset({
      parentTopo: Topo.Cube, offset: new THREE.Vector3(1.3, 0.2, -0.4),
      prev: { x: 0, y: 0, z: 0 }, parentRatio: 0.1, subspace: 0, baseScale: B,
    })
    expectVec(t, { x: 0.2, y: -0.4, z: 0.3 })
  })
})

describe('pickDominantField', () => {
  function dirOfFieldMotion(topo: number, t: Vec3, field: 'x' | 'y' | 'z', ratio = 0.1): THREE.Vector3 {
    const at = (tt: Vec3) =>
      topoOffset({ parentTopo: topo, tx: tt.x, ty: tt.y, tz: tt.z, parentRatio: ratio, subspace: 0, baseScale: B })
    const bumped = { ...t, [field]: t[field] + 0.01 }
    return at(bumped).sub(at(t)).normalize()
  }

  it('identifies altitude vs angle drags on a sphere', () => {
    const t = { x: 40, y: 25, z: 0 }
    expect(pickDominantField(Topo.Sphere, t, dirOfFieldMotion(Topo.Sphere, t, 'z'), 0.1, 0, B)).toBe('z')
    expect(pickDominantField(Topo.Sphere, t, dirOfFieldMotion(Topo.Sphere, t, 'x'), 0.1, 0, B)).toBe('x')
    expect(pickDominantField(Topo.Sphere, t, dirOfFieldMotion(Topo.Sphere, t, 'y'), 0.1, 0, B)).toBe('y')
  })

  it('identifies angle, height, and radial drags on a cylinder', () => {
    const t = { x: 72, y: 0.5, z: 0 }
    expect(pickDominantField(Topo.Cylinder, t, dirOfFieldMotion(Topo.Cylinder, t, 'x'), 0.1, 0, B)).toBe('x')
    expect(pickDominantField(Topo.Cylinder, t, dirOfFieldMotion(Topo.Cylinder, t, 'y'), 0.1, 0, B)).toBe('y')
    expect(pickDominantField(Topo.Cylinder, t, dirOfFieldMotion(Topo.Cylinder, t, 'z'), 0.1, 0, B)).toBe('z')
  })

  it('returns null for a diagonal drag with no clear winner', () => {
    // 45° between the Cartesian x and y axes.
    const dir = new THREE.Vector3(1, 1, 0).normalize()
    expect(pickDominantField(Topo.None, { x: 0, y: 0, z: 0 }, dir, 0.1, 0, B)).toBeNull()
  })

  it('returns null for zero motion', () => {
    expect(pickDominantField(Topo.Sphere, { x: 0, y: 0, z: 0 }, new THREE.Vector3(), 0.1, 0, B)).toBeNull()
  })
})
