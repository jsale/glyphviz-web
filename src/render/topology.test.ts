// Worked examples from glyphviz-skill/references/topologies.md — every
// expected value there is desktop-engine output (compute_world_positions),
// so these pin the port to the real implementation, not hand math.

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { linearPlacementAxes, parentTopoScale, topoBaseRotation, topoOffset } from './topology'
import { blankNode, NEW_OBJECT_DEFAULTS } from '../gv/createNode'
import type { GvNode } from '../gv/types'
import { NodeType, Topo } from '../gv/types'

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

// Topology Scale (desktop 55928c0). The world-transform parity harness diffs
// these against the real engine across every topology; these state the rules
// the table encodes, in one place, in words.
describe('topoOffset under a parent topo_scale', () => {
  const scaled = (
    parentTopo: number,
    t: [number, number, number],
    k: number,
    opts: { ratio?: number; subspace?: number } = {},
  ): [number, number, number] => {
    const v = topoOffset({
      parentTopo,
      tx: t[0],
      ty: t[1],
      tz: t[2],
      parentRatio: opts.ratio ?? 0.1,
      subspace: opts.subspace ?? 0,
      baseScale: 1,
      parentTopoScale: k,
    })
    return [v.x, v.y, v.z]
  }

  it('is the identity at the default, so nothing that exists changes', () => {
    for (let topo = 0; topo <= 17; topo++) {
      expectVec(scaled(topo, [30, 45, 5], 1), offset(topo, 30, 45, 5))
    }
  })

  it('scales all three axes of the Cartesian family', () => {
    for (const topo of [Topo.None, Topo.Plane, Topo.Video, Topo.Plot, Topo.Surface]) {
      expectVec(scaled(topo, [10, -20, 4], 0.5), [5, -10, 2])
    }
    // An unknown id falls back to Cartesian placement, and to its scaling.
    expectVec(scaled(99, [10, -20, 4], 0.5), [5, -10, 2])
  })

  it('never touches an angular axis: a sphere’s children stay on the sphere', () => {
    // lon/lat are degrees; only altitude is a distance. At altitude 0 the
    // child sits on the unit sphere whatever the scale says.
    for (const k of [1 / 180, 0.5, 12]) {
      const v = scaled(Topo.Sphere, [37, 26, 0], k)
      expect(Math.hypot(...v)).toBeCloseTo(1, 9)
      expectVec(v, offset(Topo.Sphere, 37, 26, 0))
    }
    // The altitude alone responds.
    expectVec(scaled(Topo.Sphere, [0, 90, 4], 0.25), [0, 0, 2])
  })

  it('scales a Torus tube offset but not its two angles', () => {
    const plain = offset(Topo.Torus, 90, 45, 0)
    expectVec(scaled(Topo.Torus, [90, 45, 0], 0.01), plain)
    // tz 8 at k = 1/8 is the same ring as tz 1 at the default.
    expectVec(scaled(Topo.Torus, [90, 45, 8], 0.125), offset(Topo.Torus, 90, 45, 1))
  })

  it('scales a Cube facet’s two in-face axes and its height off the face', () => {
    // ANTz's own convention: translate 180 reaches the facet edge, i.e. the
    // parent's own extent (+X face, so u = +Y, v = +Z, normal offset = B + tz).
    expectVec(scaled(Topo.Cube, [180, -180, 0], 1 / 180), [1, 1, -1])
  })

  it('leaves Rod’s length parameter alone — it is already size-relative', () => {
    // tx maps [0,180] onto the rod's full rendered length; ty is the angle
    // around the axis. Only the radial tz scales.
    expectVec(scaled(Topo.Rod, [180, 0, 2], 0.5), [1, 0, 10])
    expectVec(scaled(Topo.Rod, [180, 0, 0], 47), offset(Topo.Rod, 180, 0, 0))
  })

  it('scales Cylinder height and radius, not the angle around the axis', () => {
    expectVec(scaled(Topo.Cylinder, [90, 8, 4], 0.25), offset(Topo.Cylinder, 90, 2, 1))
  })

  it('leaves Spiral’s helix angle (and the rise it drives) alone', () => {
    // ty (the extra rise) and tz (radial) scale; the winding does not.
    expectVec(scaled(Topo.Spiral, [720, 4, 0], 0.5), offset(Topo.Spiral, 720, 2, 0))
  })

  it('is linear in the value, so a negative mirrors rather than clamps', () => {
    expectVec(scaled(Topo.None, [3, -4, 5], -2), [-6, 8, -10])
  })
})

describe('linearPlacementAxes / parentTopoScale exemptions', () => {
  const node = (over: Partial<GvNode>): GvNode => ({
    ...blankNode(1, NEW_OBJECT_DEFAULTS),
    ...over,
  })

  it('exempts a World Grid parent entirely — extents size its children already', () => {
    const grid = node({ type: NodeType.WorldGrid, topo: Topo.Plane, topoScale: 0.001 })
    expect(linearPlacementAxes(grid)).toEqual([false, false, false])
    expect(parentTopoScale(grid)).toBe(1)
  })

  it('exempts a root: its translate IS its world position', () => {
    expect(linearPlacementAxes(null)).toEqual([false, false, false])
    expect(parentTopoScale(null)).toBe(1)
  })

  it('reports an ordinary parent’s own value and its topology’s axes', () => {
    const parent = node({ topo: Topo.Cylinder, topoScale: 0.02 })
    expect(linearPlacementAxes(parent)).toEqual([false, true, true])
    expect(parentTopoScale(parent)).toBe(0.02)
  })

  it('treats an unknown topo id as Cartesian, like the placement fallback', () => {
    expect(linearPlacementAxes(node({ topo: 99 }))).toEqual([true, true, true])
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
