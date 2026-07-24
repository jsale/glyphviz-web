// Link (type = 7) data accessors. A link is a graph edge from node
// `parent_id` (A-end) to node `child_id` (B-end). The child_id field lives
// in the optional tracked columns, which the minimal web dialect keeps in
// `extras` — the same storage the desktop engine reads it from
// (viewport.py: int(float(link.extras.get('child_id', 0)))).

import type { GvNode } from './types'

/** The B-end node id of a link edge, or 0 when absent/unparseable. */
export function linkChildId(node: GvNode): number {
  const raw = node.extras['child_id']
  if (raw === undefined || raw === '') return 0
  const v = Number(raw)
  return Number.isFinite(v) ? Math.trunc(v) : 0
}
