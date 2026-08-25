import { describe, expect, it } from 'vitest'
import { cycleGeometry, cycleTargets, cycleTopology } from './attrCycle'
import { createRootNode } from './createNode'
import type { GvNode } from './types'
import { Geometry, NodeType, TOPO_MAX } from './types'

function node(overrides: Partial<GvNode> = {}): GvNode {
  return Object.assign(createRootNode([]), overrides)
}

describe('cycleTargets', () => {
  it('drops World, Camera and World Grid rows', () => {
    const nodes = [
      node({ id: 1, type: NodeType.World }),
      node({ id: 2, type: NodeType.Camera }),
      node({ id: 3, type: NodeType.WorldGrid }),
      node({ id: 4, type: NodeType.Glyph }),
      node({ id: 5, type: NodeType.Link }),
    ]
    expect(cycleTargets(nodes).map((n) => n.id)).toEqual([4, 5])
  })
})

describe('cycleTopology', () => {
  it('steps each node from its OWN value, so a mixed selection stays mixed', () => {
    const a = node({ topo: 3 })
    const b = node({ topo: 7 })
    cycleTopology([a, b], 1)
    expect([a.topo, b.topo]).toEqual([4, 8])
  })

  it('wraps in both directions', () => {
    const last = node({ topo: TOPO_MAX })
    const first = node({ topo: 0 })
    cycleTopology([last, first], 1)
    expect([last.topo, first.topo]).toEqual([0, 1])
    cycleTopology([last, first], -1)
    expect([last.topo, first.topo]).toEqual([TOPO_MAX, 0])
  })

  it('wraps a Shift step off the bottom to the last id, not to −1', () => {
    const n = node({ topo: 0 })
    cycleTopology([n], -1)
    expect(n.topo).toBe(TOPO_MAX)
  })
})

describe('cycleGeometry', () => {
  it('steps forward and back', () => {
    const n = node({ geometry: Geometry.SphereSolid })
    cycleGeometry([n], 1)
    expect(n.geometry).toBe(Geometry.ConeWire)
    cycleGeometry([n], -1)
    expect(n.geometry).toBe(Geometry.SphereSolid)
  })

  it('skips Mesh, which is meaningless without an imported mesh_id', () => {
    const forward = node({ geometry: Geometry.Point })
    cycleGeometry([forward], 1)
    expect(forward.geometry).toBe(Geometry.Circle)
    const back = node({ geometry: Geometry.Circle })
    cycleGeometry([back], -1)
    expect(back.geometry).toBe(Geometry.Point)
  })

  it('steps a regular glyph over the link-only ids', () => {
    // 26 Star → 27 Line and 28 Prism are link-only → 29 Cube (Interior).
    const n = node({ geometry: Geometry.Star })
    cycleGeometry([n], 1)
    expect(n.geometry).toBe(Geometry.CubeInterior)
    cycleGeometry([n], -1)
    expect(n.geometry).toBe(Geometry.Star)
  })

  // The interior shapes are ordinary geometry ids, so they are in the cycle on
  // both sides — the last of them is what wraps back to 0.
  it('wraps off the end of the interior shapes', () => {
    const n = node({ geometry: Geometry.CylinderInteriorOpen })
    cycleGeometry([n], 1)
    expect(n.geometry).toBe(Geometry.CubeWire)
    cycleGeometry([n], -1)
    expect(n.geometry).toBe(Geometry.CylinderInteriorOpen)
  })

  // A Link used to toggle between the two line modes, which was its whole
  // vocabulary before a link could carry a glyph. It now cycles the full
  // range: every geometry draws as that shape stretched between its two ends.
  it('steps a Link node through the whole geometry range, in either direction', () => {
    const link = node({ type: NodeType.Link, geometry: Geometry.Line })
    cycleGeometry([link], 1)
    expect(link.geometry).toBe(Geometry.TexturedPrism)
    cycleGeometry([link], 1)
    expect(link.geometry).toBe(Geometry.CubeInterior) // 28 → 29
    cycleGeometry([link], -1)
    expect(link.geometry).toBe(Geometry.TexturedPrism)
  })

  it('steps a Link over Mesh and Point, the two ids meaningless on an edge', () => {
    // 21 Grid → 22 Point is a duplicate of the Line mode, 23 Mesh needs a
    // mesh_id → 24 Circle.
    const link = node({ type: NodeType.Link, geometry: Geometry.GridSolid })
    cycleGeometry([link], 1)
    expect(link.geometry).toBe(Geometry.Circle)
    cycleGeometry([link], -1)
    expect(link.geometry).toBe(Geometry.GridSolid)
  })

  it('keeps a Link on a glyph geometry rather than snapping to a line mode', () => {
    const link = node({ type: NodeType.Link, geometry: Geometry.SphereSolid })
    cycleGeometry([link], 1)
    expect(link.geometry).toBe(Geometry.ConeWire) // 3 → 4, no special case
  })
})
