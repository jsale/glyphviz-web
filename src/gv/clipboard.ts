// Copy / Paste of a node and its whole descendant subtree. Behavior ported
// (not code) from the desktop app's _copy_selected/_paste_clipboard
// (glyphviz_gl/main_window.py, verified against source 2026-07-27), which
// documents itself as "V1: single node + full descendant closure only".
//
// The one-object restriction is the feature's defining constraint on both
// sides, and it is the same restriction _delete_selected already works under:
// a node always brings every descendant with it, because a partial subtree has
// no well-defined shape once it is re-parented somewhere else.
//
// The clipboard is IN-MEMORY, like the desktop's. It is not the system
// clipboard, so it does not cross browser tabs — but it does survive loading a
// different scene, since paste reassigns every id from the destination's own
// range.
//
// One shared quirk worth knowing: a copy keeps the original's `record_id`
// extra, so a scene whose node CSV carries that column ends up with two tag
// rows under one key, and re-labelling only the copy would make the original
// take its label on reload. It is the desktop's behaviour too (deepcopy carries
// extras there as well), and no scene in the corpus authors the column — a node
// without one is tagged by its own fresh id, which is unique by construction.

import { nextChildPos, nextNodeId, nextRootPos } from './createNode'
import { linkChildId } from './links'
import type { PlacementSettings } from './placement'
import { DEFAULT_PLACEMENT } from './placement'
import { descendantIds } from './treeOps'
import type { GvNode, Vec3 } from './types'
import { NodeType } from './types'

/** A copied subtree: deep copies, so later edits to the scene never reach it. */
export interface Clipboard {
  /** The subtree root's id as it was at copy time — the paste anchor. */
  rootId: number
  /** Root plus every descendant, in scene (file) order. */
  nodes: GvNode[]
}

export interface PasteResult {
  /** Fresh nodes to append to the scene, in clipboard order. */
  pasted: GvNode[]
  /** Links dropped because their B-end fell outside the copied subtree. */
  droppedLinks: number
}

/**
 * Deep copy of one node. The spread carries every scalar field (including any
 * added later); the explicit members below are the only ones whose value is a
 * reference, and sharing one with the scene is what would let a subsequent
 * gizmo drag silently rewrite what is on the clipboard.
 */
export function cloneNode(node: GvNode): GvNode {
  return {
    ...node,
    translate: { ...node.translate },
    rotate: { ...node.rotate },
    scale: { ...node.scale },
    color: { ...node.color },
    translateRate: { ...node.translateRate },
    rotateRate: { ...node.rotateRate },
    scaleRate: { ...node.scaleRate },
    tagColor: { ...node.tagColor },
    refGridColor: { ...node.refGridColor },
    extras: { ...node.extras },
  }
}

/**
 * Snapshot `rootId` and its full descendant closure. Returns null when the id
 * is not in the scene. Node order is the scene's, which paste relies on to
 * allocate ids the same way the desktop does.
 */
export function copySubtree(nodes: readonly GvNode[], rootId: number): Clipboard | null {
  if (!nodes.some((n) => n.id === rootId)) return null
  const closure = descendantIds(nodes, [rootId])
  return { rootId, nodes: nodes.filter((n) => closure.has(n.id)).map(cloneNode) }
}

/**
 * A fresh copy of the clipboard subtree, parented onto `target`:
 *
 * - a target -> the subtree becomes a CHILD of it, positioned exactly like a
 *   new child node (the next free slot in the wrapped placement lattice, at the
 *   child Placement Z). Re-selecting the original's parent and pasting is
 *   therefore how you get a plain sibling — a sibling is just another child of
 *   the same parent.
 * - no target -> a new root-level object (branch level 0, parent 0) one
 *   Placement Step on from the last root created, wherever the original lived.
 *
 * Ids are reassigned from `max(existing) + 1` in clipboard order — the same
 * allocation rule new nodes use — and branch levels shift by the root's delta,
 * so a subtree copied from level 3 and pasted at level 0 renumbers throughout.
 *
 * Links (type 7) are remapped: an edge whose A-end (parent_id) and B-end
 * (extras child_id) both fall inside the copied subtree points at the new
 * copies, while one reaching outside is DROPPED rather than left dangling or
 * pointed at whichever end happened to survive. Note the dropped link still
 * consumed its id, exactly as on the desktop, so the pasted ids can have gaps.
 */
export function pasteSubtree(
  nodes: readonly GvNode[],
  clipboard: Clipboard,
  target: GvNode | null,
  placement: PlacementSettings = DEFAULT_PLACEMENT,
): PasteResult {
  const root = clipboard.nodes.find((n) => n.id === clipboard.rootId)
  if (!root) return { pasted: [], droppedLinks: 0 }

  let nextId = nextNodeId(nodes)
  const idMap = new Map<number, number>()
  for (const n of clipboard.nodes) idMap.set(n.id, nextId++)

  let newParentId: number
  let newBranchLevel: number
  let newTranslate: Vec3
  if (target) {
    newParentId = target.id
    newBranchLevel = target.branchLevel + 1
    const { x, y } = nextChildPos(nodes, target, placement)
    newTranslate = { x, y, z: placement.childZ }
  } else {
    newParentId = 0
    newBranchLevel = 0
    const { x, y } = nextRootPos(nodes, placement)
    newTranslate = { x, y, z: placement.rootZ }
  }
  const levelDelta = newBranchLevel - root.branchLevel

  const pasted: GvNode[] = []
  let droppedLinks = 0
  for (const n of clipboard.nodes) {
    const copy = cloneNode(n)
    copy.id = idMap.get(n.id)!
    copy.branchLevel = n.branchLevel + levelDelta
    if (n.id === clipboard.rootId) {
      copy.parentId = newParentId
      copy.translate = { ...newTranslate }
    } else {
      // A parent outside the closure cannot happen for a well-formed subtree;
      // keeping the original id is the desktop's own fallback.
      copy.parentId = idMap.get(n.parentId) ?? n.parentId
    }
    if (copy.type === NodeType.Link) {
      const bEnd = idMap.get(linkChildId(n))
      if (bEnd === undefined) {
        droppedLinks++
        continue
      }
      copy.extras['child_id'] = String(bEnd)
    }
    pasted.push(copy)
  }
  return { pasted, droppedLinks }
}
