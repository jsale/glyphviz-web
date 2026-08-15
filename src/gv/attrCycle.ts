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
 * node's own frame), so the geometry cycle steps over them.
 */
const LINK_ONLY_GEOMETRIES = new Set<number>([Geometry.Line, Geometry.TexturedPrism])

/**
 * Ids a LINK node's cycle steps over instead (desktop `_LINK_SKIP_GEOS`). Mesh
 * for the same reason every other node type skips it — a bare Mesh id means
 * nothing without a mesh_id — and Point because a link renders it as a plain
 * line, a duplicate of the Line mode two stops away rather than a distinct
 * look. Everything else is meaningful on a link: Line and Prism are its two
 * line modes and every other id draws as that glyph stretched between the
 * link's two ends (render/linkGeometry.ts).
 */
const LINK_SKIP_GEOMETRIES = new Set<number>([Geometry.Mesh, Geometry.Point])

/** What an ordinary node steps over: the two line modes plus Mesh. */
const ORDINARY_SKIP_GEOMETRIES = new Set<number>([...LINK_ONLY_GEOMETRIES, Geometry.Mesh])

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
 * anything) and the link-only ids.
 *
 * A LINK node cycles the same full range, since every geometry is meaningful
 * on a link — it skips Mesh and Point instead. It used to toggle between Line
 * and Prism, which was the whole vocabulary a link had before a link could
 * carry a glyph (desktop 21f400c); cycling a link through the shapes is now
 * the workflow, which is also why a selected glyph link draws a halo.
 */
export function cycleGeometry(targets: readonly GvNode[], step: number): void {
  if (step === 0) return // a zero step would spin forever in the skip loop
  for (const node of targets) {
    const skip = node.type === NodeType.Link ? LINK_SKIP_GEOMETRIES : ORDINARY_SKIP_GEOMETRIES
    let geo = wrap(node.geometry + step, GEOMETRY_COUNT)
    while (skip.has(geo)) geo = wrap(geo + step, GEOMETRY_COUNT)
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
