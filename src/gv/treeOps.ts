// Scene-tree operations: cascade delete and keyboard tree navigation.
// Behavior ported (not code) from the desktop app (glyphviz_gl/
// main_window.py _descendants_of/_delete_selected/_nav_*/_get_siblings,
// verified against source 2026-07-24):
// - Deleting a node always takes its whole subtree — children are never
//   reparented, since there's no well-defined place to put them.
// - Navigation only ever lands on visual nodes (World/Camera are skipped),
//   in CSV row order. Sibling cycling wraps; at branch level 0 it cycles
//   ALL root nodes, deeper it stays within the same parent.

import type { GvNode } from './types'
import { NodeType } from './types'

const NON_VISUAL = new Set<number>([NodeType.World, NodeType.Camera])

function isVisual(n: GvNode): boolean {
  return !NON_VISUAL.has(n.type)
}

/** rootIds plus every descendant id, transitively. Cycle-safe. */
export function descendantIds(nodes: readonly GvNode[], rootIds: Iterable<number>): Set<number> {
  const result = new Set(rootIds)
  let frontier = result
  while (frontier.size > 0) {
    const next = new Set<number>()
    for (const n of nodes) {
      if (frontier.has(n.parentId) && !result.has(n.id)) next.add(n.id)
    }
    for (const id of next) result.add(id)
    frontier = next
  }
  return result
}

/** New node list with `id` and its whole subtree removed. */
export function deleteSubtree(nodes: readonly GvNode[], id: number): GvNode[] {
  const doomed = descendantIds(nodes, [id])
  return nodes.filter((n) => !doomed.has(n.id))
}

/** Up arrow: the parent, unless it's missing or non-visual. */
export function navParent(nodes: readonly GvNode[], current: GvNode): GvNode | null {
  if (current.parentId === 0) return null
  const parent = nodes.find((n) => n.id === current.parentId)
  return parent && isVisual(parent) ? parent : null
}

/** Down arrow: the first visual child in row order. */
export function navFirstChild(nodes: readonly GvNode[], current: GvNode): GvNode | null {
  return nodes.find((n) => n.parentId === current.id && isVisual(n)) ?? null
}

/**
 * The ordered list Tab cycles through from `current`'s position:
 * all visual roots at branch level 0, same-parent visual nodes deeper.
 */
export function siblingsOf(nodes: readonly GvNode[], current: GvNode): GvNode[] {
  if (current.branchLevel === 0) {
    return nodes.filter((n) => isVisual(n) && n.branchLevel === 0)
  }
  return nodes.filter((n) => isVisual(n) && n.parentId === current.parentId)
}

/**
 * Tab / Shift+Tab: next (`step` +1) or previous (−1) sibling, wrapping.
 * With nothing selected, Tab starts at the first visual node in the scene.
 */
export function navSibling(
  nodes: readonly GvNode[],
  current: GvNode | null,
  step: 1 | -1,
): GvNode | null {
  if (!current) {
    return step === 1 ? (nodes.find(isVisual) ?? null) : null
  }
  const siblings = siblingsOf(nodes, current)
  const idx = siblings.findIndex((n) => n.id === current.id)
  if (idx < 0 || siblings.length === 0) return null
  return siblings[(idx + step + siblings.length) % siblings.length]
}
