import { describe, expect, it } from 'vitest'
import { cloneNode, copySubtree, pasteSubtree } from './clipboard'
import { createRootNode } from './createNode'
import { linkChildId } from './links'
import type { GvNode } from './types'
import { NodeType } from './types'

function stub(over: Partial<GvNode>): GvNode {
  return { ...createRootNode([]), translate: { x: 0, y: 0, z: 0 }, ...over }
}

// world, two roots; root 2 has children 3+4, child 3 has 5.
function scene(): GvNode[] {
  return [
    stub({ id: 10, type: NodeType.World }),
    stub({ id: 1 }),
    stub({ id: 2, translate: { x: 20, y: 0, z: 0 } }),
    stub({ id: 3, parentId: 2, branchLevel: 1 }),
    stub({ id: 4, parentId: 2, branchLevel: 1 }),
    stub({ id: 5, parentId: 3, branchLevel: 2 }),
  ]
}

function byId(nodes: readonly GvNode[], id: number): GvNode {
  const found = nodes.find((n) => n.id === id)
  if (!found) throw new Error(`no node ${id}`)
  return found
}

describe('cloneNode', () => {
  it('shares no mutable field with the original', () => {
    const original = stub({ id: 1, text: 'a', extras: { child_id: '7' } })
    const copy = cloneNode(original)
    copy.translate.x = 99
    copy.color.r = 1
    copy.scaleRate.z = 2
    copy.extras['child_id'] = '8'
    expect(original.translate.x).toBe(0)
    expect(original.color.r).toBe(200)
    expect(original.scaleRate.z).toBe(0)
    expect(original.extras['child_id']).toBe('7')
  })

  it('carries every scalar field across', () => {
    const original = stub({ id: 3, text: 'label', showText: 1, textureId: 4, ratio: 0.7 })
    expect(cloneNode(original)).toEqual(original)
  })
})

describe('copySubtree', () => {
  it('takes the root and its whole closure in scene order', () => {
    const clip = copySubtree(scene(), 2)!
    expect(clip.rootId).toBe(2)
    expect(clip.nodes.map((n) => n.id)).toEqual([2, 3, 4, 5])
  })

  it('copies a leaf as a subtree of one', () => {
    expect(copySubtree(scene(), 5)!.nodes.map((n) => n.id)).toEqual([5])
  })

  it('is a snapshot — later scene edits never reach it', () => {
    const nodes = scene()
    const clip = copySubtree(nodes, 2)!
    byId(nodes, 3).translate.y = 42
    expect(byId(clip.nodes, 3).translate.y).toBe(0)
  })

  it('returns null for an id that is not in the scene', () => {
    expect(copySubtree(scene(), 999)).toBeNull()
  })
})

describe('pasteSubtree onto a target', () => {
  it('becomes a child of the target, renumbered from max + 1', () => {
    const nodes = scene()
    const clip = copySubtree(nodes, 2)!
    const { pasted } = pasteSubtree(nodes, clip, byId(nodes, 1))
    expect(pasted.map((n) => n.id)).toEqual([11, 12, 13, 14])
    // Internal parent links point at the new copies, not the originals.
    expect(pasted.map((n) => n.parentId)).toEqual([1, 11, 11, 12])
    expect(pasted.map((n) => n.branchLevel)).toEqual([1, 2, 2, 3])
  })

  it('positions the root like a new child, counting existing siblings', () => {
    const nodes = scene()
    const clip = copySubtree(nodes, 5)!
    // Node 2 already has two children, so the paste lands at the third slot.
    const { pasted } = pasteSubtree(nodes, clip, byId(nodes, 2))
    expect(pasted[0].translate).toEqual({ x: 10, y: 0, z: 5 })
  })

  it('shifts branch levels by the root delta when pasting deeper or shallower', () => {
    const nodes = scene()
    const clip = copySubtree(nodes, 3)! // level 1, with a level-2 child
    const { pasted } = pasteSubtree(nodes, clip, byId(nodes, 5)) // level 2 target
    expect(pasted.map((n) => n.branchLevel)).toEqual([3, 4])
  })

  it('leaves the source scene untouched', () => {
    const nodes = scene()
    const before = JSON.stringify(nodes)
    pasteSubtree(nodes, copySubtree(nodes, 2)!, byId(nodes, 1))
    expect(JSON.stringify(nodes)).toBe(before)
  })

  it('can be pasted repeatedly from one copy', () => {
    let nodes = scene()
    const clip = copySubtree(nodes, 3)!
    for (let i = 0; i < 3; i++) {
      nodes = [...nodes, ...pasteSubtree(nodes, clip, byId(nodes, 1)).pasted]
    }
    // Three independent two-node subtrees, ids 11..16, all children of 1.
    expect(nodes.filter((n) => n.parentId === 1).map((n) => n.id)).toEqual([11, 13, 15])
    expect(nodes.filter((n) => n.id > 10 && n.branchLevel === 2).map((n) => n.id)).toEqual([
      12, 14, 16,
    ])
    // …spread along X like repeated New Child presses.
    expect(nodes.filter((n) => n.parentId === 1).map((n) => n.translate.x)).toEqual([0, 5, 10])
  })
})

describe('pasteSubtree with no target', () => {
  it('becomes a root-level object one placement step on from the last root', () => {
    const nodes = scene()
    const { pasted } = pasteSubtree(nodes, copySubtree(nodes, 3)!, null)
    expect(pasted[0].parentId).toBe(0)
    expect(pasted[0].branchLevel).toBe(0)
    expect(pasted[0].translate).toEqual({ x: 25, y: 0, z: 0 }) // last root created is at 20
    expect(pasted[1].branchLevel).toBe(1) // the child came down a level too
  })

  it('takes the ROOT placement Z, and the child branch takes the CHILD one', () => {
    // The whole reason they are two numbers: a paste must not pick up the
    // height of the level it is not landing at.
    const nodes = scene()
    const clip = copySubtree(nodes, 3)!
    const placement = { step: 5, rootZ: 9, childZ: 4 }
    expect(pasteSubtree(nodes, clip, null, placement).pasted[0].translate.z).toBe(9)
    expect(pasteSubtree(nodes, clip, byId(nodes, 1), placement).pasted[0].translate.z).toBe(4)
  })

  it('pastes into a different scene, renumbering from that scene', () => {
    const clip = copySubtree(scene(), 2)!
    const other = [stub({ id: 100 }), stub({ id: 101 })]
    const { pasted } = pasteSubtree(other, clip, null)
    expect(pasted.map((n) => n.id)).toEqual([102, 103, 104, 105])
    expect(pasted[0].parentId).toBe(0)
  })

  it('pastes into an empty scene', () => {
    const { pasted } = pasteSubtree([], copySubtree(scene(), 3)!, null)
    expect(pasted.map((n) => n.id)).toEqual([1, 2])
    expect(pasted[0].translate).toEqual({ x: 0, y: 0, z: 0 })
  })
})

describe('pasteSubtree link remapping', () => {
  // Root 2 with children 3 and 4, plus a link 6 from 3 to 4 (both inside the
  // copied subtree) and a link 7 from 3 to root 1 (which is outside it).
  function linked(): GvNode[] {
    return [
      stub({ id: 1 }),
      stub({ id: 2 }),
      stub({ id: 3, parentId: 2, branchLevel: 1 }),
      stub({ id: 4, parentId: 2, branchLevel: 1 }),
      stub({ id: 6, type: NodeType.Link, parentId: 3, branchLevel: 2, extras: { child_id: '4' } }),
      stub({ id: 7, type: NodeType.Link, parentId: 3, branchLevel: 2, extras: { child_id: '1' } }),
    ]
  }

  it('repoints an internal link at the new copies', () => {
    const nodes = linked()
    const { pasted, droppedLinks } = pasteSubtree(nodes, copySubtree(nodes, 2)!, byId(nodes, 1))
    // 8=root(2) 9=(3) 10=(4) 11=link(6); the outside-reaching link 7 is dropped
    // but still consumed id 12, exactly as on the desktop.
    expect(pasted.map((n) => n.id)).toEqual([8, 9, 10, 11])
    expect(droppedLinks).toBe(1)
    const link = byId(pasted, 11)
    expect(link.parentId).toBe(9) // A-end -> the new copy of 3
    expect(linkChildId(link)).toBe(10) // B-end -> the new copy of 4
  })

  it('does not disturb the original link', () => {
    const nodes = linked()
    pasteSubtree(nodes, copySubtree(nodes, 2)!, byId(nodes, 1))
    expect(byId(nodes, 6).extras['child_id']).toBe('4')
  })

  it('drops a link with no child_id at all', () => {
    const nodes = [
      stub({ id: 1 }),
      stub({ id: 2, type: NodeType.Link, parentId: 1, branchLevel: 1 }),
    ]
    const { pasted, droppedLinks } = pasteSubtree(nodes, copySubtree(nodes, 1)!, null)
    expect(pasted.map((n) => n.id)).toEqual([3])
    expect(droppedLinks).toBe(1)
  })
})
