import { describe, expect, it } from 'vitest'
import { createRootNode } from './createNode'
import { descendantIds, deleteSubtree, deleteSubtrees, navFirstChild, navParent, navSibling, siblingsOf } from './treeOps'
import type { GvNode } from './types'
import { NodeType } from './types'

function stub(over: Partial<GvNode>): GvNode {
  return { ...createRootNode([]), translate: { x: 0, y: 0, z: 0 }, ...over }
}

// A small scene: world, two roots, root 2 has children 3+4, child 3 has 5.
function scene(): GvNode[] {
  return [
    stub({ id: 10, type: NodeType.World }),
    stub({ id: 1 }),
    stub({ id: 2 }),
    stub({ id: 3, parentId: 2, branchLevel: 1 }),
    stub({ id: 4, parentId: 2, branchLevel: 1 }),
    stub({ id: 5, parentId: 3, branchLevel: 2 }),
  ]
}

describe('descendantIds / deleteSubtree', () => {
  it('collects the transitive closure', () => {
    expect([...descendantIds(scene(), [2])].sort()).toEqual([2, 3, 4, 5])
  })

  it('deletes the whole subtree and nothing else', () => {
    const left = deleteSubtree(scene(), 3)
    expect(left.map((n) => n.id)).toEqual([10, 1, 2, 4])
  })

  it('deleting a leaf removes only that node', () => {
    expect(deleteSubtree(scene(), 5).map((n) => n.id)).toEqual([10, 1, 2, 3, 4])
  })

  it('survives a parent cycle without hanging', () => {
    const nodes = [
      stub({ id: 1, parentId: 2, branchLevel: 1 }),
      stub({ id: 2, parentId: 1, branchLevel: 1 }),
    ]
    expect([...descendantIds(nodes, [1])].sort()).toEqual([1, 2])
  })

  it('deletes several subtrees at once, overlapping ones included', () => {
    expect(deleteSubtrees(scene(), [3, 1, 5]).map((n) => n.id)).toEqual([10, 2, 4])
  })

  it('deletes a 400k-node selection in linear time', () => {
    const nodes = [stub({ id: 1 })]
    for (let i = 2; i <= 400_000; i++) nodes.push(stub({ id: i, parentId: 1, branchLevel: 1 }))
    const started = performance.now()
    const left = deleteSubtrees(nodes, nodes.slice(1).map((n) => n.id))
    expect(left.map((n) => n.id)).toEqual([1])
    // One subtree at a time was ~1.6e11 steps here; the sweep is well under a second.
    expect(performance.now() - started).toBeLessThan(5000)
  })
})

describe('navParent / navFirstChild', () => {
  it('walks up to the parent and stops at roots', () => {
    const nodes = scene()
    expect(navParent(nodes, nodes[5])!.id).toBe(3) // 5 → 3
    expect(navParent(nodes, nodes[3])!.id).toBe(2) // 3 → 2
    expect(navParent(nodes, nodes[2])).toBeNull() // root
  })

  it('refuses a non-visual parent', () => {
    const nodes = [stub({ id: 1, type: NodeType.World }), stub({ id: 2, parentId: 1, branchLevel: 1 })]
    expect(navParent(nodes, nodes[1])).toBeNull()
  })

  it('finds the first visual child in row order', () => {
    const nodes = scene()
    expect(navFirstChild(nodes, nodes[2])!.id).toBe(3)
    expect(navFirstChild(nodes, nodes[4])).toBeNull() // node 4 is a leaf
  })
})

describe('sibling cycling', () => {
  it('cycles all roots at branch level 0, skipping World/Camera', () => {
    const nodes = scene()
    expect(siblingsOf(nodes, nodes[1]).map((n) => n.id)).toEqual([1, 2])
    expect(navSibling(nodes, nodes[1], 1)!.id).toBe(2)
    expect(navSibling(nodes, nodes[2], 1)!.id).toBe(1) // wraps
    expect(navSibling(nodes, nodes[1], -1)!.id).toBe(2) // wraps backward
  })

  it('cycles only same-parent siblings at deeper levels', () => {
    const nodes = scene()
    expect(siblingsOf(nodes, nodes[3]).map((n) => n.id)).toEqual([3, 4])
    expect(navSibling(nodes, nodes[3], 1)!.id).toBe(4)
    expect(navSibling(nodes, nodes[4], 1)!.id).toBe(3) // wraps within parent
  })

  it('starts at the first visual node when nothing is selected', () => {
    expect(navSibling(scene(), null, 1)!.id).toBe(1) // skips the World node
    expect(navSibling(scene(), null, -1)).toBeNull()
  })

  it('is a no-op for a sole sibling', () => {
    const nodes = [stub({ id: 1 })]
    expect(navSibling(nodes, nodes[0], 1)!.id).toBe(1)
  })
})
