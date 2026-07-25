// ANTz-style attribute cycling — the desktop's O (geometry) and J (topology)
// keys, ported from main_window.py's _cycle_selected_geometry /
// _cycle_selected_topology / _cycle_targets (verified against source
// 2026-07-25).
//
// The step is applied PER NODE — each selected node advances from its OWN
// current value — so a mixed-geometry/topology selection stays mixed instead
// of snapping to one shared value. Shift reverses the direction.

import type { GvNode } from './types'
import { GEOMETRY_MAX, Geometry, NodeType, TOPO_MAX } from './types'

const GEOMETRY_COUNT = GEOMETRY_MAX + 1
const TOPO_COUNT = TOPO_MAX + 1

/**
 * Link-only render modes: a bare line or textured prism is meaningless on a
 * regular glyph (they draw as an EDGE between two endpoints, never at the
 * node's own frame), so the geometry cycle steps over them — and a Link node
 * cycles between just those two.
 */
const LINK_ONLY_GEOMETRIES = new Set<number>([Geometry.Line, Geometry.TexturedPrism])

/**
 * Types the cycling keys never touch. World/Camera rows have no shape at all;
 * a World Grid's geometry encodes flat-vs-globe and its topo is ignored, so
 * cycling either would corrupt it.
 */
const NEVER_CYCLED = new Set<number>([NodeType.World, NodeType.Camera, NodeType.WorldGrid])

/** The subset of a selection that O/J operate on. */
export function cycleTargets(nodes: readonly GvNode[]): GvNode[] {
  return nodes.filter((n) => !NEVER_CYCLED.has(n.type))
}

/** Positive modulo — JS `%` keeps the sign of the dividend, so Shift+O at id 0
 *  would otherwise land on −1 instead of wrapping to the last id. */
function wrap(value: number, count: number): number {
  return ((value % count) + count) % count
}

/**
 * Step each target's `geometry` by ±1, skipping Mesh (needs a mesh_id to mean
 * anything) and the link-only ids. Link nodes toggle between Line and Textured
 * Prism instead — direction-agnostic, since there are only the two states.
 */
export function cycleGeometry(targets: readonly GvNode[], step: number): void {
  if (step === 0) return // a zero step would spin forever in the skip loop
  for (const node of targets) {
    if (node.type === NodeType.Link) {
      node.geometry =
        node.geometry === Geometry.TexturedPrism ? Geometry.Line : Geometry.TexturedPrism
      continue
    }
    let geo = wrap(node.geometry + step, GEOMETRY_COUNT)
    while (geo === Geometry.Mesh || LINK_ONLY_GEOMETRIES.has(geo)) {
      geo = wrap(geo + step, GEOMETRY_COUNT)
    }
    node.geometry = geo
  }
}

/** Step each target's `topo` by ±1 — every id is valid, so nothing is skipped. */
export function cycleTopology(targets: readonly GvNode[], step: number): void {
  if (step === 0) return
  for (const node of targets) {
    node.topo = wrap(node.topo + step, TOPO_COUNT)
  }
}
