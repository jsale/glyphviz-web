import { describe, expect, it } from 'vitest'
import {
  bulkSelectableNodes,
  criterionValues,
  invertSelection,
  isolateSelection,
  selectAllIds,
  selectByCriterion,
  setHidden,
  showAll,
} from './selectionOps'
import type { GvNode } from './types'
import { Geometry, NodeType, Topo } from './types'

function makeNode(overrides: Partial<GvNode>): GvNode {
  return {
    id: 1,
    type: NodeType.Glyph,
    parentId: 0,
    branchLevel: 0,
    translate: { x: 0, y: 0, z: 0 },
    rotate: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    color: { r: 200, g: 200, b: 200, a: 255 },
    geometry: Geometry.CubeSolid,
    hide: 0,
    topo: Topo.None,
    ratio: 0,
    subspace: 0,
    textureId: 0,
    meshId: 0,
    rotationMode: 1,
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

/** World row, grid, two spheres at level 0/1, one cube at level 1. */
function scene(): GvNode[] {
  return [
    makeNode({ id: 1, type: NodeType.World }),
    makeNode({ id: 2, type: NodeType.WorldGrid, geometry: Geometry.GridSolid }),
    makeNode({ id: 3, geometry: Geometry.SphereSolid, topo: Topo.Cube, branchLevel: 0 }),
    makeNode({ id: 4, geometry: Geometry.SphereSolid, parentId: 3, branchLevel: 1 }),
    makeNode({ id: 5, geometry: Geometry.CubeSolid, parentId: 3, branchLevel: 1 }),
  ]
}

describe('bulk selectability', () => {
  it('excludes World/Camera rows and World Grids', () => {
    const nodes = [...scene(), makeNode({ id: 6, type: NodeType.Camera })]
    expect(bulkSelectableNodes(nodes).map((n) => n.id)).toEqual([3, 4, 5])
  })

  it('includes Link rows (reachable by Tab-nav, edited in the inspector)', () => {
    const nodes = [...scene(), makeNode({ id: 6, type: NodeType.Link })]
    expect(selectAllIds(nodes).has(6)).toBe(true)
  })
})

describe('select by criterion', () => {
  it('lists only the values present on selectable nodes, ascending', () => {
    expect(criterionValues(scene(), 'branchLevel').map((v) => v.value)).toEqual([0, 1])
    // Geometry 21 (the grid's) is absent — grids are not bulk-selectable.
    expect(criterionValues(scene(), 'geometry').map((v) => v.value)).toEqual([
      Geometry.CubeSolid,
      Geometry.SphereSolid,
    ])
    expect(criterionValues(scene(), 'topo').map((v) => v.value)).toEqual([Topo.None, Topo.Cube])
  })

  it('labels values with the shared name tables', () => {
    const geo = criterionValues(scene(), 'geometry')
    expect(geo.find((v) => v.value === Geometry.SphereSolid)?.label).toBe('3: Sphere')
    expect(criterionValues(scene(), 'topo')[1].label).toBe('1: Cube')
    expect(criterionValues(scene(), 'branchLevel')[0].label).toBe('0')
  })

  it('matches by branch level, geometry, and topology', () => {
    expect([...selectByCriterion(scene(), 'branchLevel', 1)]).toEqual([4, 5])
    expect([...selectByCriterion(scene(), 'geometry', Geometry.SphereSolid)]).toEqual([3, 4])
    expect([...selectByCriterion(scene(), 'topo', Topo.Cube)]).toEqual([3])
  })
})

describe('invert selection', () => {
  it('returns every selectable node that was not selected', () => {
    expect([...invertSelection(scene(), new Set([3]))]).toEqual([4, 5])
  })

  it('never resurrects World/Camera/grid rows', () => {
    expect([...invertSelection(scene(), new Set())]).toEqual([3, 4, 5])
  })
})

describe('visibility', () => {
  it('hides and shows the given ids, reporting only real changes', () => {
    const nodes = scene()
    expect(setHidden(nodes, new Set([3, 4]), true)).toEqual([3, 4])
    expect(nodes[2].hide).toBe(1)
    // Already hidden — no change to report the second time.
    expect(setHidden(nodes, new Set([3]), true)).toEqual([])
    expect(setHidden(nodes, new Set([3, 4]), false)).toEqual([3, 4])
    expect(nodes[2].hide).toBe(0)
  })

  it('hides a directly selected World Grid (only bulk commands skip grids)', () => {
    const nodes = scene()
    expect(setHidden(nodes, new Set([2]), true)).toEqual([2])
  })

  it('isolate shows the selection and hides every other selectable node', () => {
    const nodes = scene()
    expect(isolateSelection(nodes, new Set([4]))).toEqual([3, 5])
    expect(nodes.map((n) => n.hide)).toEqual([0, 0, 1, 0, 1])
  })

  it('isolate leaves World/Camera and grid flags untouched in the saved CSV', () => {
    const nodes = scene()
    nodes[0].hide = 1 // World row arrived hidden; isolate must not rewrite it
    isolateSelection(nodes, new Set([3]))
    expect(nodes[0].hide).toBe(1)
    expect(nodes[1].hide).toBe(0)
  })

  it('show all clears every hide flag, including non-selectable rows', () => {
    const nodes = scene()
    nodes[0].hide = 1
    nodes[1].hide = 1
    nodes[3].hide = 1
    expect(showAll(nodes)).toEqual([1, 2, 4])
    expect(nodes.every((n) => n.hide === 0)).toBe(true)
  })
})
