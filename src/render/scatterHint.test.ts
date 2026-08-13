import { describe, expect, it } from 'vitest'
import { buildScene } from './buildScene'
import { TOPO_SCALE_HINT_RATIO, worstChildPlacementRatio } from './scatterHint'
import { blankNode, NEW_OBJECT_DEFAULTS } from '../gv/createNode'
import type { GvNode } from '../gv/types'
import { Geometry, NodeType, Topo, TOPO_SCALE_ANTZ } from '../gv/types'

function node(over: Partial<GvNode>): GvNode {
  return { ...blankNode(over.id ?? 1, NEW_OBJECT_DEFAULTS), ...over }
}

/** A parent at the given topology with children authored in DEGREES. */
function scene(topo: number, topoScale = 1): GvNode[] {
  return [
    node({
      id: 1,
      topo,
      topoScale,
      geometry: Geometry.SphereSolid,
      scale: { x: 3, y: 3, z: 3 },
    }),
    ...[0, 90, 180, 270].map((lon, i) =>
      node({
        id: 2 + i,
        parentId: 1,
        branchLevel: 1,
        translate: { x: lon, y: 30, z: 0 },
        scale: { x: 0.5, y: 0.5, z: 0.5 },
      }),
    ),
  ]
}

function measure(nodes: GvNode[], parentIds = [1]) {
  const built = buildScene(nodes)
  built.root.updateMatrixWorld(true)
  return worstChildPlacementRatio(nodes, built.frames, parentIds)
}

describe('worstChildPlacementRatio', () => {
  it('reads ~1 for children sitting on their parent’s own surface', () => {
    // Sphere topology: lon/lat are angles, so the children ring the parent at
    // its base radius — carried outward by the parent's own scale of 3, which
    // is also the radius the ratio is measured in. Hence exactly 1.
    const { ratio, parentId } = measure(scene(Topo.Sphere))
    expect(parentId).toBe(1)
    expect(ratio).toBeCloseTo(1, 6)
    expect(ratio).toBeLessThan(TOPO_SCALE_HINT_RATIO)
  })

  it('catches the case the hint exists for: degrees read as world units', () => {
    // The same children under Cube, which reads all three axes as distances.
    const { ratio, parentId } = measure(scene(Topo.Cube))
    expect(parentId).toBe(1)
    expect(ratio).toBeGreaterThan(TOPO_SCALE_HINT_RATIO)
  })

  it('is quiet again once that parent is retuned to the ANTz scale', () => {
    const { ratio } = measure(scene(Topo.Cube, TOPO_SCALE_ANTZ))
    expect(ratio).toBeLessThan(TOPO_SCALE_HINT_RATIO)
  })

  it('reports nothing for a parent with no children, or an empty ask', () => {
    expect(measure([node({ id: 1, topo: Topo.Cube })])).toEqual({ ratio: 0, parentId: -1 })
    expect(measure(scene(Topo.Cube), [])).toEqual({ ratio: 0, parentId: -1 })
  })

  it('names the worst offender when several parents are asked about', () => {
    const nodes = [
      ...scene(Topo.Sphere),
      node({ id: 10, topo: Topo.Cube, translate: { x: 500, y: 0, z: 0 }, scale: { x: 3, y: 3, z: 3 } }),
      node({ id: 11, parentId: 10, branchLevel: 1, translate: { x: 300, y: 0, z: 0 } }),
    ]
    expect(measure(nodes, [1, 10]).parentId).toBe(10)
  })

  it('skips the non-visual rows, which never draw anywhere', () => {
    const nodes = [
      node({ id: 1, topo: Topo.Cube, scale: { x: 3, y: 3, z: 3 } }),
      node({ id: 2, parentId: 1, branchLevel: 1, type: NodeType.Camera, translate: { x: 900, y: 0, z: 0 } }),
    ]
    expect(measure(nodes).ratio).toBe(0)
  })
})
