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

  it('steps +10 along X past the furthest root glyph', () => {
    const nodes = [
      stub({ id: 1, translate: { x: 0, y: 0, z: 0 } }),
      stub({ id: 2, translate: { x: 30, y: 0, z: 0 } }),
    ]
    expect(createRootNode(nodes).translate.x).toBe(40)
  })

  it('ignores World/Camera nodes and child-level nodes when stepping', () => {
    const nodes = [
      stub({ id: 1, type: NodeType.World, translate: { x: 500, y: 0, z: 0 } }),
      stub({ id: 2, translate: { x: 10, y: 0, z: 0 } }),
      stub({ id: 3, parentId: 2, branchLevel: 1, translate: { x: 900, y: 0, z: 0 } }),
    ]
    expect(createRootNode(nodes).translate.x).toBe(20)
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

  it('spreads later children +5 along X per existing sibling', () => {
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
