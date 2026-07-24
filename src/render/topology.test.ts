// Worked examples from glyphviz-skill/references/topologies.md — every
// expected value there is desktop-engine output (compute_world_positions),
// so these pin the port to the real implementation, not hand math.

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { topoBaseRotation, topoOffset } from './topology'
import { Topo } from '../gv/types'

function offset(
  parentTopo: number,
  tx: number,
  ty: number,
  tz: number,
  opts: { ratio?: number; subspace?: number } = {},
): [number, number, number] {
  const v = topoOffset({
    parentTopo,
    tx,
    ty,
    tz,
    parentRatio: opts.ratio ?? 0.1,
    subspace: opts.subspace ?? 0,
    baseScale: 1,
  })
  return [v.x, v.y, v.z]
}

function expectVec(actual: [number, number, number], expected: [number, number, number]) {
  for (let i = 0; i < 3; i++) expect(actual[i]).toBeCloseTo(expected[i], 5)
}

describe('topoOffset', () => {
  it('Cartesian family passes translate through', () => {
    for (const topo of [Topo.None, Topo.Plane, Topo.Video, Topo.Plot, Topo.Surface]) {
      expectVec(offset(topo, 1.5, -2, 0.5), [1.5, -2, 0.5])
    }
  })

  it('Sphere: KML lon/lat/alt on radius B', () => {
    expectVec(offset(Topo.Sphere, 90, 0, 0), [0, 1, 0])
    expectVec(offset(Topo.Sphere, 45, 45, 0), [0.5, 0.5, 0.707107])
    expectVec(offset(Topo.Sphere, 0, 90, 0.5), [0, 0, 1.5])
  })

  it('Torus: orbital/tube angles on the parent-ratio tube', () => {
    expectVec(offset(Topo.Torus, 90, 0, 0), [0, 1, 0])
    expectVec(offset(Topo.Torus, 0, 90, 0), [0.9, 0, 0.1])
  })

  it('Cylinder: angle/height/radial', () => {
    expectVec(offset(Topo.Cylinder, 90, 0.5, 0), [0, 1, 0.5])
  })

  it('Pin: stacks along +Z from the pin top', () => {
    expectVec(offset(Topo.Pin, 0.5, 0, 0), [0, 0, 1.5])
  })

  it('Rod: normalized length, angle in ty, radial in tz', () => {
    expectVec(offset(Topo.Rod, 90, 0, 0), [0, 0, 5])
    expectVec(offset(Topo.Rod, 0, 45, 0.2), [0.141421, 0.141421, 0])
  })

  it('Point: pure direction, tz is the full distance', () => {
    expectVec(offset(Topo.Point, 0, 0, 2), [2, 0, 0])
  })

  it('Cube: facet 1 (+X face), u/v slide within the face', () => {
    expectVec(offset(Topo.Cube, 0.2, 0.3, 0, { subspace: 0 }), [1, 0.2, 0.3])
  })

  it('Spiral: angle keeps counting past 360, one turn rises B', () => {
    expectVec(offset(Topo.Spiral, 720, 0, 0), [1, 0, 2])
  })

  it('Z-variants measure from center/axis', () => {
    expectVec(offset(Topo.Zcube, 0.2, 0.3, 0.5, { subspace: 4 }), [0.2, 0.3, 0.5])
    expectVec(offset(Topo.Zsphere, 90, 0, 1.5), [0, 1.5, 0])
    expectVec(offset(Topo.Ztorus, 0, 90, 0.2), [0.9, 0, 0.2])
    expectVec(offset(Topo.Zcylinder, 180, 1, 0.5), [-0.5, 0, 1])
    expectVec(offset(Topo.Zrod, 180, 1, 0.5), [-0.5, 0, 1])
  })
})

describe('topoBaseRotation', () => {
  function rotate(m: THREE.Matrix4, v: [number, number, number]): [number, number, number] {
    const out = new THREE.Vector3(...v).applyMatrix4(m)
    return [out.x, out.y, out.z]
  }

  it('is identity for Cartesian family and Pin', () => {
    for (const topo of [Topo.None, Topo.Plane, Topo.Pin, Topo.Video, Topo.Plot, Topo.Surface]) {
      expectVec(rotate(topoBaseRotation(topo, 90, 45, 0), [1, 2, 3]), [1, 2, 3])
    }
  })

  it('Sphere family aligns child +Z with the outward normal at (lon, lat)', () => {
    // lon 90, lat 0 → normal is +Y.
    expectVec(rotate(topoBaseRotation(Topo.Sphere, 90, 0, 0), [0, 0, 1]), [0, 1, 0])
    // North pole (lat 90) → +Z stays +Z.
    expectVec(rotate(topoBaseRotation(Topo.Torus, 0, 90, 0), [0, 0, 1]), [0, 0, 1])
  })

  it('Cylinder family carries the child around the axis by tx', () => {
    expectVec(rotate(topoBaseRotation(Topo.Cylinder, 90, 0, 0), [1, 0, 0]), [0, 1, 0])
  })

  it("Rod's angle lives in ty", () => {
    expectVec(rotate(topoBaseRotation(Topo.Rod, 0, 90, 0), [1, 0, 0]), [0, 1, 0])
  })

  it('Cube aligns +Z with the face normal; Zcube stays identity (engine behavior)', () => {
    expectVec(rotate(topoBaseRotation(Topo.Cube, 0, 0, 0), [0, 0, 1]), [1, 0, 0])
    expectVec(rotate(topoBaseRotation(Topo.Zcube, 0, 0, 0), [0, 0, 1]), [0, 0, 1])
  })
})
