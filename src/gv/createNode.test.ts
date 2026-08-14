import { describe, expect, it } from 'vitest'
import { createChildNode, createRootNode, NEW_OBJECT_DEFAULTS, nextNodeId } from './createNode'
import { parseGvNodeCsv } from './nodeCsv'
import type { GvNode } from './types'
import { Geometry, NodeType, RotationMode, Topo } from './types'
import { writeGvNodeCsv } from './writeNodeCsv'

function stub(over: Partial<GvNode>): GvNode {
  return { ...createRootNode([]), translate: { x: 0, y: 0, z: 0 }, ...over }
}

describe('nextNodeId', () => {
  it('starts at 1 in an empty scene', () => {
    expect(nextNodeId([])).toBe(1)
  })

  it('allocates max + 1, never reusing gaps', () => {
    expect(nextNodeId([stub({ id: 3 }), stub({ id: 40 }), stub({ id: 7 })])).toBe(41)
  })
})

describe('createRootNode', () => {
  it('lands at the origin in an empty scene with panel defaults applied', () => {
    const n = createRootNode([])
    expect(n.id).toBe(1)
    expect(n.type).toBe(NodeType.Glyph)
    expect(n.parentId).toBe(0)
    expect(n.branchLevel).toBe(0)
    expect(n.translate).toEqual({ x: 0, y: 0, z: 0 })
    expect(n.geometry).toBe(Geometry.OctahedronSolid)
    expect(n.topo).toBe(Topo.Point)
    expect(n.scale).toEqual({ x: 1, y: 1, z: 1 })
    expect(n.color).toEqual({ r: 200, g: 200, b: 200, a: 255 })
    expect(n.ratio).toBe(0.1)
    // Fresh nodes are Euler (desktop dataclass default), unlike the HTR
    // load-default for files missing the column.
    expect(n.rotationMode).toBe(RotationMode.EulerXYZ)
  })

  it('steps one placement step on from the last root created', () => {
    const nodes = [
      stub({ id: 1, translate: { x: 0, y: 0, z: 0 } }),
      stub({ id: 2, translate: { x: 30, y: 0, z: 0 } }),
    ]
    expect(createRootNode(nodes).translate).toEqual({ x: 35, y: 0, z: 0 })
  })

  it('keys on the last root CREATED, not the furthest along X', () => {
    // After a row wraps, the largest translate_x is back in the previous row —
    // stepping from it would fold the array onto itself.
    const nodes = [
      stub({ id: 1, translate: { x: 355, y: 0, z: 0 } }),
      stub({ id: 2, translate: { x: 0, y: 5, z: 0 } }),
    ]
    expect(createRootNode(nodes).translate).toEqual({ x: 5, y: 5, z: 0 })
  })

  it('wraps to a new row at a full lap', () => {
    const nodes = [stub({ id: 1, translate: { x: 355, y: 0, z: 0 } })]
    expect(createRootNode(nodes).translate).toEqual({ x: 0, y: 5, z: 0 })
  })

  it('ignores World/Camera/World Grid rows and child-level nodes when stepping', () => {
    // A grid is the surface the array sits on, not a member of it.
    const nodes = [
      stub({ id: 1, type: NodeType.World, translate: { x: 500, y: 0, z: 0 } }),
      stub({ id: 2, translate: { x: 10, y: 0, z: 0 } }),
      stub({ id: 3, parentId: 2, branchLevel: 1, translate: { x: 900, y: 0, z: 0 } }),
      stub({ id: 4, type: NodeType.WorldGrid, translate: { x: 700, y: 0, z: 0 } }),
    ]
    expect(createRootNode(nodes).translate).toEqual({ x: 15, y: 0, z: 0 })
  })

  it('takes the caller-supplied placement step and root Z', () => {
    const nodes = [stub({ id: 1, translate: { x: 240, y: 0, z: 0 } })]
    const placement = { step: 120, rootZ: -3, childZ: 5 }
    expect(createRootNode(nodes, NEW_OBJECT_DEFAULTS, placement).translate).toEqual({
      x: 0,
      y: 120,
      z: -3,
    })
  })

  it('does not share mutable state with the defaults object', () => {
    const n = createRootNode([])
    n.scale.x = 99
    n.color.r = 0
    expect(NEW_OBJECT_DEFAULTS.scale.x).toBe(1)
    expect(NEW_OBJECT_DEFAULTS.color.r).toBe(200)
  })
})

describe('createChildNode', () => {
  it('attaches under the parent one level down at (0, 0, 5) for the first child', () => {
    const parent = stub({ id: 4, branchLevel: 0 })
    const child = createChildNode([parent], parent)
    expect(child.parentId).toBe(4)
    expect(child.branchLevel).toBe(1)
    expect(child.translate).toEqual({ x: 0, y: 0, z: 5 })
  })

  it('spreads later children one step along X per existing sibling', () => {
    const parent = stub({ id: 1 })
    const nodes = [
      parent,
      stub({ id: 2, parentId: 1, branchLevel: 1 }),
      stub({ id: 3, parentId: 1, branchLevel: 1 }),
    ]
    const child = createChildNode(nodes, parent)
    expect(child.id).toBe(4)
    expect(child.translate).toEqual({ x: 10, y: 0, z: 5 })
  })

  it('wraps a full lap of siblings onto a new row instead of overlapping', () => {
    // The whole point on a circular parent: the 73rd child at step 5 would land
    // on top of the first, so it starts a new ring above it.
    const parent = stub({ id: 1 })
    const nodes = [parent]
    for (let i = 0; i < 72; i++) nodes.push(stub({ id: i + 2, parentId: 1, branchLevel: 1 }))
    expect(createChildNode(nodes, parent).translate).toEqual({ x: 0, y: 5, z: 5 })
  })

  it('does not let a link consume a placement slot', () => {
    // A link renders between its two ends and ignores translate, so counting it
    // would leave a hole in the array.
    const parent = stub({ id: 1 })
    const nodes = [
      parent,
      stub({ id: 2, type: NodeType.Link, parentId: 1, branchLevel: 1 }),
      stub({ id: 3, parentId: 1, branchLevel: 1 }),
    ]
    expect(createChildNode(nodes, parent).translate).toEqual({ x: 5, y: 0, z: 5 })
  })

  it('takes the caller-supplied placement step and child Z', () => {
    const parent = stub({ id: 1 })
    const nodes = [parent, stub({ id: 2, parentId: 1, branchLevel: 1 })]
    const child = createChildNode(nodes, parent, NEW_OBJECT_DEFAULTS, {
      step: 120,
      rootZ: 0,
      childZ: -2.5,
    })
    expect(child.translate).toEqual({ x: 120, y: 0, z: -2.5 })
  })

  it('applies the caller-supplied defaults', () => {
    const parent = stub({ id: 1 })
    const child = createChildNode([parent], parent, {
      geometry: Geometry.SphereSolid,
      topo: Topo.Sphere,
      scale: { x: 2, y: 2, z: 2 },
      color: { r: 10, g: 20, b: 30, a: 128 },
    })
    expect(child.geometry).toBe(Geometry.SphereSolid)
    expect(child.topo).toBe(Topo.Sphere)
    expect(child.scale).toEqual({ x: 2, y: 2, z: 2 })
    expect(child.color).toEqual({ r: 10, g: 20, b: 30, a: 128 })
  })
})

describe('created nodes round-trip through the CSV writer', () => {
  it('writes and re-parses a created scene without loss', () => {
    const root = createRootNode([])
    const child = createChildNode([root], root)
    const parsed = parseGvNodeCsv(writeGvNodeCsv([root, child]))
    expect(parsed.errors).toEqual([])
    expect(parsed.nodes).toHaveLength(2)
    expect(parsed.nodes[0]).toEqual(root)
    expect(parsed.nodes[1]).toEqual(child)
  })
})
