import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { buildScene, DEFAULT_BACKGROUND } from './buildScene'
import { parseGvNodeCsv } from '../gv/nodeCsv'
import { Geometry, NodeType, RotationMode, Topo } from '../gv/types'
import type { GvNode } from '../gv/types'
import topologyExampleCsv from '../gv/fixtures/topology_example_gv_node.csv?raw'

function makeNode(overrides: Partial<GvNode>): GvNode {
  return {
    id: 1,
    type: NodeType.Glyph,
    parentId: 0,
    branchLevel: 0,
    translate: { x: 0, y: 0, z: 0 },
    rotate: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    color: { r: 230, g: 230, b: 230, a: 255 },
    geometry: Geometry.CubeSolid,
    hide: 0,
    topo: Topo.None,
    ratio: 0.1,
    subspace: 0,
    textureId: 0,
    meshId: 0,
    rotationMode: RotationMode.HeadingTiltRoll,
    colorIndex: 0,
    paletteId: 0,
    translateRate: { x: 0, y: 0, z: 0 },
    rotateRate: { x: 0, y: 0, z: 0 },
    scaleRate: { x: 0, y: 0, z: 0 },
    text: '',
    link: '',
    renderMode: 0,
    fogEnabled: 0,
    fogStart: 0,
    fogEnd: 0,
    extras: {},
    ...overrides,
  }
}

function frameOf(root: THREE.Object3D, id: number): THREE.Object3D {
  const frame = root.getObjectByName(`gv:${id}`)
  expect(frame, `frame for node ${id}`).toBeDefined()
  return frame!
}

function glyphOf(root: THREE.Object3D, id: number): THREE.Object3D | undefined {
  return frameOf(root, id).children.find((c) => c.userData.isGlyph)
}

function worldPosition(root: THREE.Object3D, id: number): [number, number, number] {
  root.updateMatrixWorld(true)
  const v = new THREE.Vector3()
  frameOf(root, id).getWorldPosition(v)
  return [v.x, v.y, v.z]
}

function expectVec(actual: [number, number, number], expected: [number, number, number]) {
  for (let i = 0; i < 3; i++) expect(actual[i]).toBeCloseTo(expected[i], 10)
}

describe('buildScene hierarchy and transforms', () => {
  it('places roots at plain world coordinates', () => {
    const { root } = buildScene([makeNode({ id: 1, translate: { x: 1.5, y: -2, z: 0.5 } })])
    expectVec(worldPosition(root, 1), [1.5, -2, 0.5])
  })

  it('composes child offsets through the parent rotation and scale', () => {
    // Parent: HTR heading 90 (= Rz(−90)), scale 2, at (1, 2, 3).
    // Child offset (1, 0, 0) → scaled (2, 0, 0) → rotated (0, −2, 0).
    const { root } = buildScene([
      makeNode({ id: 1, translate: { x: 1, y: 2, z: 3 }, rotate: { x: 0, y: 90, z: 0 }, scale: { x: 2, y: 2, z: 2 } }),
      makeNode({ id: 2, parentId: 1, branchLevel: 1, translate: { x: 1, y: 0, z: 0 } }),
    ])
    expectVec(worldPosition(root, 2), [1, 0, 3])
  })

  it('accumulates transforms across generations', () => {
    const { root } = buildScene([
      makeNode({ id: 1, scale: { x: 2, y: 2, z: 2 } }),
      makeNode({ id: 2, parentId: 1, branchLevel: 1, translate: { x: 1, y: 0, z: 0 }, scale: { x: 0.5, y: 0.5, z: 0.5 } }),
      makeNode({ id: 3, parentId: 2, branchLevel: 2, translate: { x: 0, y: 1, z: 0 } }),
    ])
    // Node 2 at 2·(1,0,0) = (2,0,0); node 3 offset 1 on Y through cum scale 2·0.5 = 1.
    expectVec(worldPosition(root, 3), [2, 1, 0])
  })

  it('applies Euler XYZ when rotation_mode is 0', () => {
    const { root } = buildScene([
      makeNode({ id: 1, rotate: { x: 0, y: 90, z: 0 }, rotationMode: RotationMode.EulerXYZ }),
      makeNode({ id: 2, parentId: 1, branchLevel: 1, translate: { x: 0, y: 0, z: 1 } }),
    ])
    // Euler Ry(90)·Z = +X — impossible under HTR, which has no Y rotation.
    expectVec(worldPosition(root, 2), [1, 0, 0])
  })
})

describe('buildScene drawing rules', () => {
  it('floors the drawn world scale at 0.2 per axis without touching placement', () => {
    const { root } = buildScene([
      makeNode({ id: 1, scale: { x: 0.1, y: 0.5, z: 1 } }),
      makeNode({ id: 2, parentId: 1, branchLevel: 1, translate: { x: 1, y: 0, z: 0 } }),
    ])
    root.updateMatrixWorld(true)
    const drawn = new THREE.Vector3()
    glyphOf(root, 1)!.getWorldScale(drawn)
    expectVec([drawn.x, drawn.y, drawn.z], [0.2, 0.5, 1])
    // Placement still uses the raw 0.1 scale.
    expectVec(worldPosition(root, 2), [0.1, 0, 0])
  })

  it('skips the glyph of hidden nodes but still renders their children', () => {
    const { root, drawnCount } = buildScene([
      makeNode({ id: 1, hide: 1, translate: { x: 5, y: 0, z: 0 } }),
      makeNode({ id: 2, parentId: 1, branchLevel: 1, translate: { x: 0, y: 1, z: 0 } }),
    ])
    expect(glyphOf(root, 1)).toBeUndefined()
    expect(glyphOf(root, 2)).toBeDefined()
    expect(drawnCount).toBe(1)
    expectVec(worldPosition(root, 2), [5, 1, 0])
  })

  it('takes the background from the World row and never draws it', () => {
    const { root, background } = buildScene([
      makeNode({ id: 1, type: NodeType.World, color: { r: 255, g: 0, b: 0, a: 255 } }),
      makeNode({ id: 2 }),
    ])
    expect(background.r).toBeCloseTo(1)
    expect(background.g).toBeCloseTo(0)
    expect(glyphOf(root, 1)).toBeUndefined()
  })

  it('falls back to the default background without a World row', () => {
    const { background } = buildScene([makeNode({ id: 1 })])
    expect(background.equals(DEFAULT_BACKGROUND)).toBe(true)
  })

  it('places children of a Sphere parent at KML lon/lat positions', () => {
    const { root } = buildScene([
      makeNode({ id: 1, topo: Topo.Sphere, translate: { x: 10, y: 20, z: 30 } }),
      makeNode({ id: 2, parentId: 1, branchLevel: 1, translate: { x: 90, y: 0, z: 0 } }),
      makeNode({ id: 3, parentId: 1, branchLevel: 1, translate: { x: 0, y: 90, z: 0.5 } }),
    ])
    expectVec(worldPosition(root, 2), [10, 21, 30])
    expectVec(worldPosition(root, 3), [10, 20, 31.5])
  })

  it('scales and rotates topology offsets through the parent basis', () => {
    // Sphere parent scaled 2× with heading 90 (HTR → Rz(−90)): child at
    // lon 0 sits on the surface at local (1,0,0) → scaled (2,0,0) →
    // rotated to (0,−2,0).
    const { root } = buildScene([
      makeNode({
        id: 1,
        topo: Topo.Sphere,
        rotate: { x: 0, y: 90, z: 0 },
        scale: { x: 2, y: 2, z: 2 },
      }),
      makeNode({ id: 2, parentId: 1, branchLevel: 1 }),
    ])
    expectVec(worldPosition(root, 2), [0, -2, 0])
  })

  it('renders the whole topology-example fixture with no warnings', () => {
    const parsed = parseGvNodeCsv(topologyExampleCsv)
    expect(parsed.errors).toEqual([])
    const { drawnCount, warnings } = buildScene(parsed.nodes)
    expect(drawnCount).toBe(parsed.nodes.length)
    expect(warnings).toEqual([])
  })
})

describe('World Grid placement and drawing', () => {
  const flatGrid = (overrides: Partial<GvNode> = {}) =>
    makeNode({ id: 1, type: NodeType.WorldGrid, geometry: Geometry.GridWire, ...overrides })

  it('is a 1:1 frame with the default window at the origin', () => {
    const { root } = buildScene([
      flatGrid(),
      makeNode({ id: 2, parentId: 1, branchLevel: 1, translate: { x: 180, y: 90, z: 0 } }),
    ])
    expectVec(worldPosition(root, 2), [180, 90, 0])
  })

  it('recenters a region window on its midpoint', () => {
    const extras = {
      trigger_lo_x: '-125',
      trigger_hi_x: '-66',
      trigger_lo_y: '24',
      trigger_hi_y: '49',
    }
    const { root } = buildScene([
      flatGrid({ extras }),
      makeNode({ id: 2, parentId: 1, branchLevel: 1, translate: { x: -95.5, y: 36.5, z: 0 } }),
      makeNode({ id: 3, parentId: 1, branchLevel: 1, translate: { x: -66, y: 49, z: 0 } }),
    ])
    expectVec(worldPosition(root, 2), [0, 0, 0])
    expectVec(worldPosition(root, 3), [29.5, 12.5, 0])
  })

  it('ignores the grid row’s own topo field for child placement', () => {
    const { root } = buildScene([
      flatGrid({ topo: Topo.Sphere }),
      makeNode({ id: 2, parentId: 1, branchLevel: 1, translate: { x: 10, y: 20, z: 5 } }),
    ])
    expectVec(worldPosition(root, 2), [10, 20, 5])
  })

  it('re-spaces child positions with grid scale but never their size or subtree spacing', () => {
    const { root } = buildScene([
      flatGrid({ scale: { x: 2, y: 2, z: 1 } }),
      makeNode({ id: 2, parentId: 1, branchLevel: 1, translate: { x: 10, y: 20, z: 5 } }),
      makeNode({ id: 3, parentId: 2, branchLevel: 2, translate: { x: 0, y: 0, z: 7 } }),
    ])
    expectVec(worldPosition(root, 2), [20, 40, 5])
    // The engine-checked ANTz rule: 7 above its parent, not 14.
    expectVec(worldPosition(root, 3), [20, 40, 12])
    root.updateMatrixWorld(true)
    const drawn = glyphOf(root, 2)!.getWorldScale(new THREE.Vector3())
    expectVec([drawn.x, drawn.y, drawn.z], [1, 1, 1])
  })

  it('places globe children by KML lon/lat on the 180/π sphere, absolute (no recentering)', () => {
    const R = 180 / Math.PI
    const extras = {
      // A region window must NOT recenter globe children.
      trigger_lo_x: '-125',
      trigger_hi_x: '-66',
      trigger_lo_y: '24',
      trigger_hi_y: '49',
    }
    const { root } = buildScene([
      flatGrid({ geometry: Geometry.SphereSolid, extras }),
      makeNode({ id: 2, parentId: 1, branchLevel: 1, translate: { x: 0, y: 0, z: 0 } }),
      makeNode({ id: 3, parentId: 1, branchLevel: 1, translate: { x: 90, y: 0, z: 0 } }),
      makeNode({ id: 4, parentId: 1, branchLevel: 1, translate: { x: 0, y: 90, z: 10 } }),
    ])
    expectVec(worldPosition(root, 2), [R, 0, 0])
    expectVec(worldPosition(root, 3), [0, R, 0])
    expectVec(worldPosition(root, 4), [0, 0, R + 10])
  })

  it('draws the plate at raw scale × window half-spans with no 0.2 floor', () => {
    const { root, drawnCount } = buildScene([flatGrid({ scale: { x: 0.05, y: 0.05, z: 0.05 } })])
    expect(drawnCount).toBe(1)
    root.updateMatrixWorld(true)
    const drawn = glyphOf(root, 1)!.getWorldScale(new THREE.Vector3())
    expectVec([drawn.x, drawn.y, drawn.z], [9, 4.5, 0.05])
  })

  it('marks solid surfaces as pick occluders; wire grids have none; neither has a proxy', () => {
    const collect = (nodes: GvNode[], key: string) => {
      const { root } = buildScene(nodes)
      const found: THREE.Object3D[] = []
      root.traverse((o) => {
        if (o.userData[key]) found.push(o)
      })
      return found
    }
    expect(collect([flatGrid({ geometry: Geometry.GridSolid })], 'isGridOccluder')).toHaveLength(1)
    expect(collect([flatGrid()], 'isGridOccluder')).toHaveLength(0)
    expect(collect([flatGrid({ geometry: Geometry.GridSolid })], 'isPickProxy')).toHaveLength(0)
  })
})
