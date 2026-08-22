// ANTz rate animation: translate_rate_*, rotate_rate_* and scale_rate_* are
// velocities the viewport integrates, not values.
//
// Ported (behavior, not code) from the desktop viewport's
// _apply_rate_animation / _has_active_rates, verified 2026-07-25. The
// convention is a delta applied every CYCLE, nominally 60 cycles per second
// (Node-Field-Descriptions.md) — so the integration is frame-rate independent:
// dt decides how many cycles elapsed, never how big a step is.
//
// This is the other half of Channels' velocity group: a channel binds the
// *rate*, and the motion itself accumulates here, outside the channel engine.
// It also runs for scenes with no Channels at all — a CSV can simply author
// rotate_rate_z on a node and expect it to spin (RSS_News_Example does).

import type { GvNode, Vec3 } from './types'

/** Nominal cycle length: rates are per-cycle deltas at 60 cycles/second. */
export const RATE_CYCLE_MS = 1000 / 60

/** ANTz `freeze` suspends a node's own rates. Preserved as an extras column. */
function isFrozen(node: GvNode): boolean {
  const raw = node.extras['freeze']
  if (raw === undefined) return false
  // A string '0' is truthy in JS where Python's 0 is not — the value has to be
  // read as a number or every freeze column would freeze the whole scene.
  const value = Number(raw.trim())
  return Number.isFinite(value) ? value !== 0 : false
}

/** True when this node has any nonzero rate and is not frozen. */
export function hasActiveRates(node: GvNode): boolean {
  if (isFrozen(node)) return false
  const { translateRate: t, rotateRate: r, scaleRate: s } = node
  return (
    t.x !== 0 || t.y !== 0 || t.z !== 0 ||
    r.x !== 0 || r.y !== 0 || r.z !== 0 ||
    s.x !== 0 || s.y !== 0 || s.z !== 0
  )
}

/**
 * The nodes worth ticking each frame.
 *
 * The desktop rescans all nodes every tick; at Event_Cloud's 209k rows that is
 * 12M property reads a second for a scene where nothing moves. A node can only
 * acquire a nonzero rate through the CSV (known at load) or through a channel
 * binding on a rate field (known at bind time), so the candidate set is exact
 * and only has to be recomputed when either changes — which is what
 * rebuildScene already marks.
 */
export function rateCandidates(
  nodes: readonly GvNode[],
  rateBoundNodeIds: ReadonlySet<number> = new Set(),
): GvNode[] {
  return nodes.filter((node) => rateBoundNodeIds.has(node.id) || hasActiveRates(node))
}

/**
 * Advance translate/rotate/scale by their rates over `dtMs`, returning the ids
 * that actually moved (empty = nothing to redraw).
 *
 * Frozen nodes and zero rates are skipped per axis-group, exactly as on the
 * desktop, so a candidate whose channel has driven its rate back to 0 costs
 * three comparisons and contributes nothing.
 */
export function applyRateAnimation(candidates: readonly GvNode[], dtMs: number): Set<number> {
  const moved = new Set<number>()
  const cycles = dtMs / RATE_CYCLE_MS
  if (!(cycles > 0)) return moved

  for (const node of candidates) {
    if (isFrozen(node)) continue
    const { translateRate: tr, rotateRate: rr, scaleRate: sr } = node
    if (tr.x !== 0 || tr.y !== 0 || tr.z !== 0) {
      node.translate.x += tr.x * cycles
      node.translate.y += tr.y * cycles
      node.translate.z += tr.z * cycles
      moved.add(node.id)
    }
    if (rr.x !== 0 || rr.y !== 0 || rr.z !== 0) {
      node.rotate.x += rr.x * cycles
      node.rotate.y += rr.y * cycles
      node.rotate.z += rr.z * cycles
      moved.add(node.id)
    }
    if (sr.x !== 0 || sr.y !== 0 || sr.z !== 0) {
      node.scale.x += sr.x * cycles
      node.scale.y += sr.y * cycles
      node.scale.z += sr.z * cycles
      moved.add(node.id)
    }
  }
  return moved
}

// --- Pausing rate animation (desktop View ▸ Pause Rate Animation [P]) ---------
//
// The desktop's `_toggle_rates_paused` does NOT just stop integrating: it ZEROES
// the nine rate fields, keeping the originals in a snapshot, and puts them back
// on resume. That is the whole point of the feature — a Save made while paused
// writes a genuinely static file (the rate columns are omitted entirely, since
// writeNodeCsv only emits a group some node is nonzero in), not a file that
// merely looked still on screen. Freezing a Hyperglyph mid-evolution and saving
// the pose is the case it was built for.
//
// The snapshot is keyed by node id, as there, because a paused node can be
// deleted before the resume.

/** One node's nine rate values, held while paused. */
export interface RateSnapshot {
  translateRate: Vec3
  rotateRate: Vec3
  scaleRate: Vec3
}

/**
 * Zero every nonzero rate in `nodes`, returning what was taken away.
 *
 * Matches the desktop's `if any(rates)` test, which reads the nine fields and
 * ignores `freeze` — a frozen node's rates are stored data like any other, and
 * a static save should not keep them either. Resume puts them back untouched.
 */
export function snapshotAndZeroRates(nodes: readonly GvNode[]): Map<number, RateSnapshot> {
  const snapshot = new Map<number, RateSnapshot>()
  for (const node of nodes) {
    const { translateRate: t, rotateRate: r, scaleRate: s } = node
    const any =
      t.x !== 0 || t.y !== 0 || t.z !== 0 ||
      r.x !== 0 || r.y !== 0 || r.z !== 0 ||
      s.x !== 0 || s.y !== 0 || s.z !== 0
    if (!any) continue
    snapshot.set(node.id, { translateRate: { ...t }, rotateRate: { ...r }, scaleRate: { ...s } })
    t.x = t.y = t.z = 0
    r.x = r.y = r.z = 0
    s.x = s.y = s.z = 0
  }
  return snapshot
}

/**
 * Put a snapshot back, returning how many nodes actually took their rates.
 *
 * A node the snapshot names that no longer exists is skipped, not an error:
 * deleting a paused node is a legitimate edit, and its rates go with it.
 */
export function restoreRates(
  snapshot: ReadonlyMap<number, RateSnapshot>,
  byId: ReadonlyMap<number, GvNode>,
): number {
  let restored = 0
  for (const [id, rates] of snapshot) {
    const node = byId.get(id)
    if (!node) continue
    node.translateRate.x = rates.translateRate.x
    node.translateRate.y = rates.translateRate.y
    node.translateRate.z = rates.translateRate.z
    node.rotateRate.x = rates.rotateRate.x
    node.rotateRate.y = rates.rotateRate.y
    node.rotateRate.z = rates.rotateRate.z
    node.scaleRate.x = rates.scaleRate.x
    node.scaleRate.y = rates.scaleRate.y
    node.scaleRate.z = rates.scaleRate.z
    restored += 1
  }
  return restored
}
