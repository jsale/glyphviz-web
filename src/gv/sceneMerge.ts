// Merge a second node CSV's contents into an already-loaded scene. Behaviour
// ported (not code) from desktop glyphviz_core/scene_merge.py (`merge_nodes`,
// `recompute_branch_levels`, commit 1bf847d), with its tests in
// sceneMerge.test.ts and the real module diffed in sceneMerge.parity.test.ts.
//
// Loading file B "into" file A is not a concatenation: both files number their
// nodes from their own id space, both carry their own per-file infrastructure
// rows (the World row's scene settings, the Camera rows), and both refer to ids
// in fields the parser keeps in `extras` — a link's B-end `child_id`, the tag
// file's `record_id`, a channel binding's `ch_input_id`. mergeNodes rebases the
// incoming list onto a fresh id block above everything already in the scene
// and rewrites every one of those references, so the result is one
// self-consistent scene that round-trips through the CSV writers unchanged.
//
// Coordinates are deliberately left alone: two scenes merged together overlay
// in one world space, which is what makes merging useful for datasets sharing
// a frame (two GPS tracks, two layers over one World Grid).
//
// Pure data — no THREE, no DOM. What a merge does to the scene's MEDIA and
// MESHES is the web app's own question (the desktop leaves both alone) and
// lives with the wiring in main.ts, on top of `unionMedia` in media.ts.

import { cloneNode } from './clipboard'
import { linkChildId } from './links'
import type { GvNode } from './types'
import { NodeType } from './types'

/**
 * extras keys holding a channel id, input side and output side. Cleared on
 * merged nodes because channel ids live in the incoming file's OWN ch-map id
 * space — leaving one set would silently bind a merged node to whatever
 * unrelated channel happens to share the number in the host's ch-map. (The
 * desktop's tuple also spells `'ch_input_id '` with a trailing space; this
 * app's parser trims header names, so that spelling never reaches `extras`.)
 */
export const MERGE_CHANNEL_KEYS = ['ch_input_id', 'np_ch_in_id', 'ch_output_id', 'np_ch_out_id'] as const

export interface MergeResult {
  /** Fresh nodes to append to the scene, in incoming file order. */
  nodes: GvNode[]
  /** Old incoming id → new id. Covers dropped links too: they consume an id. */
  idMap: Map<number, number>
  /** Incoming World/Camera rows dropped as duplicates of per-file globals. */
  skippedGlobal: number
  /** Links dropped because an end was not part of the merged set. */
  droppedLinks: number
  /** Nodes whose parent row was dropped, or was already dangling, re-rooted. */
  rerooted: number
  /** Nodes whose channel binding was cleared (see MERGE_CHANNEL_KEYS). */
  clearedChannels: number
}

function intOf(raw: string | undefined): number | null {
  if (raw === undefined) return null
  const v = Number(raw.trim())
  return raw.trim() !== '' && Number.isFinite(v) ? Math.trunc(v) : null
}

/** Zero any channel id in extras. True if a nonzero one was changed. */
function clearChannelBinding(node: GvNode): boolean {
  let changed = false
  for (const key of MERGE_CHANNEL_KEYS) {
    if (node.extras[key] === undefined) continue
    // Desktop: `int(float(raw)) == 0`, where an unparseable cell counts as a
    // change — it is rewritten to 0 either way.
    const already = intOf(node.extras[key]) === 0
    node.extras[key] = '0'
    changed = changed || !already
  }
  return changed
}

/**
 * Set branch_level to true depth for `nodes`.
 *
 * Only ids inside `ownIds` count as parents — a node parented onto something
 * outside the set is treated as a root here. branch_level is a STORED column,
 * not a derived one, so any operation that lifts nodes out of one hierarchy
 * into another has to restate it: a merge does, and so does Save Selection
 * (selectionExport.ts, which re-exports this).
 */
export function recomputeBranchLevels(nodes: GvNode[], ownIds: ReadonlySet<number>): void {
  const children = new Map<number, GvNode[]>()
  let frontier: GvNode[] = []
  for (const n of nodes) {
    if (ownIds.has(n.parentId)) {
      const list = children.get(n.parentId)
      if (list) list.push(n)
      else children.set(n.parentId, [n])
    } else {
      frontier.push(n)
    }
  }
  let level = 0
  while (frontier.length > 0) {
    const next: GvNode[] = []
    for (const n of frontier) {
      n.branchLevel = level
      // A loop rather than flatMap-with-spread: a merged point cloud puts
      // hundreds of thousands of rows on one level (see appendNodes in main.ts).
      for (const c of children.get(n.id) ?? []) next.push(c)
    }
    level++
    frontier = next
  }
}

/**
 * Rebase `incoming` so it can be appended to `existing` as one scene.
 *
 * Returns fresh deep copies — `incoming` is never mutated, so the same parsed
 * list can be merged into several scenes (or into the same one twice).
 *
 * Rules, all the desktop's except the one marked:
 *  - New ids are one contiguous block starting at max(existing ids) + 1,
 *    assigned in file order; parent_id, a link's child_id and record_id (the
 *    tag file's join key) are rewritten to match.
 *  - Incoming World (0) and Camera (1) rows are per-file globals and are
 *    dropped — except the FIRST incoming World row when the host has none, so
 *    merging into a scene without one still brings background, fog and tag
 *    styling.
 *  - A link whose B-end is not in the merged set is dropped rather than left
 *    pointing at an arbitrary host node (the Copy/Paste rule).
 *  - DIVERGENCE (agreed with Jeff 2026-09-13): so is a link whose A-end —
 *    its parent_id — named a row that did not survive. The desktop checks the
 *    B-end only and re-roots such a link to parent 0, which leaves an edge with
 *    nothing at one end. A link whose SOURCE parent_id was already 0 is kept,
 *    as there: the file said that, the merge did not do it.
 *  - Any other node whose parent did not survive (or was already dangling in
 *    the source) becomes a root.
 *  - Channel bindings are cleared.
 *  - branch_level is recomputed as true depth.
 *
 * A dropped link still consumes the id it was assigned, exactly as on the
 * desktop, so merged ids can have gaps.
 */
export function mergeNodes(existing: readonly GvNode[], incoming: readonly GvNode[]): MergeResult {
  const result: MergeResult = {
    nodes: [],
    idMap: new Map(),
    skippedGlobal: 0,
    droppedLinks: 0,
    rerooted: 0,
    clearedChannels: 0,
  }
  if (incoming.length === 0) return result

  let maxId = 0
  let hostHasWorld = false
  for (const n of existing) {
    if (n.id > maxId) maxId = n.id
    if (n.type === NodeType.World) hostHasWorld = true
  }
  const nextId = maxId + 1

  // --- pick which incoming rows survive ---
  const kept: GvNode[] = []
  let worldSlotOpen = !hostHasWorld
  for (const n of incoming) {
    if (n.type === NodeType.World || n.type === NodeType.Camera) {
      if (n.type === NodeType.World && worldSlotOpen) {
        worldSlotOpen = false
        kept.push(n)
        continue
      }
      result.skippedGlobal++
      continue
    }
    kept.push(n)
  }

  // --- allocate the new id block ---
  const idMap = result.idMap
  for (let i = 0; i < kept.length; i++) idMap.set(kept[i].id, nextId + i)

  // --- rebase ---
  const merged = result.nodes
  for (const n of kept) {
    const node = cloneNode(n)
    node.id = idMap.get(n.id)!
    const isLink = n.type === NodeType.Link
    let parentLost = false
    if (n.parentId === 0) {
      node.parentId = 0
    } else if (idMap.has(n.parentId)) {
      node.parentId = idMap.get(n.parentId)!
    } else {
      node.parentId = 0
      parentLost = true
    }
    if (isLink) {
      const bEnd = idMap.get(linkChildId(n))
      if (bEnd === undefined || parentLost) {
        result.droppedLinks++
        continue
      }
      node.extras['child_id'] = String(bEnd)
    }
    if (parentLost) result.rerooted++
    // record_id is the node↔tag join key on save; the incoming value belongs to
    // its own id space and would collide with a host node's. Re-point it at the
    // new id — what the tag writer uses for a node that has no such column.
    if (node.extras['record_id'] !== undefined) node.extras['record_id'] = String(node.id)
    if (clearChannelBinding(node)) result.clearedChannels++
    merged.push(node)
  }

  recomputeBranchLevels(merged, new Set(merged.map((n) => n.id)))
  return result
}
