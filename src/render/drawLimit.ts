// Draw-limit decimation — the ANTz \ / Shift+\ keys, ported from the desktop's
// Viewport._draw_limit / _adjust_draw_limit (glyphviz_gl/viewport.py).
//
// The model is the desktop's exactly: a limit of N draws the FIRST N eligible
// nodes in scene (file) order and nothing after them. It is a prefix cut, not
// a stride — halving twice shows the first quarter of the file, and a node's
// visibility never depends on the camera, so the frame rate a limit buys is
// stable as the scene is orbited.
//
// WHERE THIS DIVERGES FROM THE DESKTOP, AND WHY IT HAS TO
// -------------------------------------------------------
// The desktop implements the limit as an early `break` in its per-node draw
// loop, because that loop IS the per-frame cost. Three.js is retained-mode:
// the per-frame cost is a traversal of the scene GRAPH, and merely marking a
// glyph `visible = false` leaves its Object3D in the graph, where
// `Scene.updateMatrixWorld` still recomposes and re-multiplies its matrix
// every frame before the renderer ever looks at `visible`.
//
// That is the same trap the desktop fell into the first time (commit 6f042f7,
// "Cache per-frame scene scans so the \ draw limit actually pays off": ~900 ms
// of fixed O(N) Python passes ran regardless of the limit, so 700k nodes went
// 0.4 fps → 1.6 fps instead of → 229 fps). Measured here on this app's own
// object counts at Event_Cloud's 209k nodes — a frame Object3D per node plus a
// glyph and a pick proxy per drawn node — `updateMatrixWorld` alone costs:
//
//     209k frames + 209k glyphs      91.5 ms/frame   (~11 fps ceiling)
//     209k frames +   2k glyphs      23.2 ms/frame   (~43 fps ceiling)
//       2k frames +   2k glyphs       0.3 ms/frame
//
// The middle row is what `visible = false` would buy: a hard ceiling that no
// further halving moves. So the limit is applied when the graph is BUILT —
// nodes past the cut contribute no Object3D at all — and every downstream
// per-frame cost (matrix traversal, the renderer's project pass, draw calls,
// raycasting, halo rewrites) falls with it. The cost is a scene rebuild per
// keypress, which each press makes cheaper than the last.
//
// A frame still has to exist for any node an overlay reaches through, since
// the desktop draws link edges, plot polylines and surface meshes irrespective
// of the draw limit (`_draw_topology_overlays` never consults it). Those nodes
// and their ancestors are kept as bare frames — no glyph, no pick proxy — so
// the overlays are byte-identical under a limit while the glyphs decimate.
//
// Two consequences of rebuilding rather than breaking out of a draw loop:
//
//   * A scene whose overlays reach every node (Surface_Example is one) prunes
//     nothing and the limit buys little. That is honest rather than a defect —
//     the desktop does not decimate those overlays either, so its limit cannot
//     help such a scene much more.
//   * DIVERGENCE: the desktop keeps a node selected AND pickable past the
//     cutoff ("selecting then hiding keeps the selection live"). Here a node
//     with no frame has nothing to hold a halo or a selection membership, so
//     the part of a selection that falls past the cut drops on the press.
//     Select first at full detail, or restore with Shift+\ before editing.

import { cloudParentIds } from '../gv/pointCloud'
import type { GvNode } from '../gv/types'
import { NodeType, Topo } from '../gv/types'
import { linkChildId } from '../gv/links'

/** `\` halves the limit; `Shift+\` (or `|`) doubles it. */
export const DRAW_LIMIT_HALVE = 0.5
export const DRAW_LIMIT_DOUBLE = 2

export interface DrawLimitOptions {
  /** The "Show Hidden Nodes" display toggle — hidden rows count when it is on. */
  showHidden?: boolean
}

/** Node types that never draw a glyph of their own (their children still do). */
const NON_VISUAL = new Set<number>([NodeType.World, NodeType.Camera])

/**
 * Nodes the draw loop would count against the limit, in file order: everything
 * but World/Camera rows, Link rows (drawn as edges by the overlay, never as a
 * glyph), points inside a Point Cloud, and — unless Show Hidden Nodes is on —
 * hidden rows.
 *
 * A CLOUD COUNTS AS ONE UNIT, which is the desktop's rule and follows from the
 * batching: the whole cloud is one draw call, so decimating it would save
 * nothing worth having while destroying the thing the user is looking at. Its
 * PARENT is counted, like any other node — so halving a scene that holds a
 * cloud thins the glyphs around it and leaves the scan alone. The desktop skips
 * its points before its own counter for exactly this, and the cloud pass then
 * ignores the limit entirely, as the link and plot passes already do.
 */
function eligible(node: GvNode, showHidden: boolean, clouds: ReadonlySet<number>): boolean {
  if (NON_VISUAL.has(node.type)) return false
  if (node.type === NodeType.Link) return false
  if (clouds.size > 0 && clouds.has(node.parentId)) return false
  return node.hide === 0 || showHidden
}

/**
 * The denominator the desktop's `_adjust_draw_limit` uses, and the number its
 * status line reports as the total.
 *
 * Note it is NOT the count of `eligible` rows: the desktop's total excludes
 * World/Camera rows and hidden rows but keeps Link rows, while its draw loop
 * skips links as well. Matched deliberately, so a readout here compares
 * directly with one read on the desktop for the same scene; the discrepancy
 * only means a scene with links halves to slightly more than half its glyphs.
 *
 * The same is true, and much more visibly, of a Point Cloud: its points are in
 * this total and are never decimated, so on a scene that is mostly one scan the
 * first several presses of `\` change nothing on screen while the readout falls.
 * That is the desktop's arithmetic exactly (`_adjust_draw_limit` counts every
 * non-hidden row), and it is kept rather than corrected so the two apps report
 * the same numbers for the same file — a cloud scene simply needs more presses
 * before the limit bites on the glyphs around it.
 */
export function drawLimitTotal(nodes: readonly GvNode[], options: DrawLimitOptions = {}): number {
  const showHidden = options.showHidden === true
  let total = 0
  for (const node of nodes) {
    if (NON_VISUAL.has(node.type)) continue
    if (node.hide !== 0 && !showHidden) continue
    total++
  }
  return total
}

/**
 * Step the limit by `factor`, desktop `_adjust_draw_limit`: null means "show
 * everything", and a limit that reaches or passes the total collapses back to
 * null rather than sitting at a number that happens to equal it. Never goes
 * below 1 — a limit of 0 would be an empty viewport with no way to read what
 * happened.
 */
export function nextDrawLimit(
  current: number | null,
  total: number,
  factor: number,
): number | null {
  if (total === 0) return null
  const from = current === null ? total : current
  const next = Math.max(1, Math.min(total, Math.round(from * factor)))
  return next >= total ? null : next
}

export interface DrawLimitPlan {
  /** Nodes that draw a glyph — the first `limit` eligible rows in file order. */
  draw: Set<number>
  /**
   * Nodes that get an Object3D at all: `draw`, plus the nodes the link / plot /
   * surface overlays resolve positions through (which the desktop draws
   * irrespective of the limit), plus every ancestor of both. Upward-closed, so
   * a node outside it has no descendant inside it and its whole subtree can be
   * skipped in one test.
   */
  keep: Set<number>
}

/**
 * Resolve a limit into the two id sets the scene builder needs, or null when
 * there is no limit (build everything — the load-time state).
 */
export function drawLimitPlan(
  nodes: readonly GvNode[],
  limit: number | null,
  options: DrawLimitOptions = {},
): DrawLimitPlan | null {
  if (limit === null) return null
  const showHidden = options.showHidden === true

  const byId = new Map<number, GvNode>()
  for (const node of nodes) {
    if (!byId.has(node.id)) byId.set(node.id, node)
  }

  // Points never consume the limit; their parent does (see `eligible`).
  const clouds = cloudParentIds(nodes)

  const draw = new Set<number>()
  for (const node of nodes) {
    if (draw.size >= limit) break
    if (eligible(node, showHidden, clouds)) draw.add(node.id)
  }

  // Overlay participants. Every link row keeps its own frame (its label anchors
  // there, and a link whose edge never drew falls back to a pick sphere at it)
  // along with both endpoints; every Plot/Surface parent keeps its children,
  // since the polyline and the lattice are strung between their frames.
  // Filled entirely by the upward closure below, which is seeded with the
  // drawn nodes — they need their ancestor frames as much as the overlay
  // participants do, since that chain is what places them.
  const keep = new Set<number>()
  const needed: number[] = [...draw]
  const need = (id: number) => {
    if (id !== 0 && byId.has(id)) needed.push(id)
  }
  const childrenOfOverlayParent = new Set<number>()
  for (const node of nodes) {
    if (node.type === NodeType.Link) {
      need(node.id)
      need(node.parentId)
      need(linkChildId(node))
    } else if (node.topo === Topo.Plot || node.topo === Topo.Surface) {
      need(node.id)
      childrenOfOverlayParent.add(node.id)
    }
  }
  if (childrenOfOverlayParent.size > 0) {
    for (const node of nodes) {
      if (childrenOfOverlayParent.has(node.parentId)) need(node.id)
    }
  }

  // Close upward through the parent chain, stopping at the first ancestor
  // already kept. Roots are recognised exactly as the scene builder does: a
  // parent of 0, a self-parent, or an id no row supplies.
  for (const id of needed) {
    let node = byId.get(id)
    while (node && !keep.has(node.id)) {
      keep.add(node.id)
      const parentId = node.parentId
      if (parentId === 0 || parentId === node.id) break
      node = byId.get(parentId)
    }
  }

  return { draw, keep }
}
