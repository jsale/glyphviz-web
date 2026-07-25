// Bulk selection criteria and the per-node hide flag operations, ported from
// the desktop's "Select By" and "Visibility" groups (main_window.py
// _selectable_nodes / _on_select_by / _on_invert_selection / _hide_selected /
// _show_selected / _isolate_selected / _show_all).
//
// Everything here is pure over the parsed node array: the visibility helpers
// mutate `hide` in place and return the ids they changed, so the caller can
// rebuild and report a count the way the desktop status bar does.

import type { GvNode } from './types'
import { GEOMETRY_NAMES, NodeType, TOPO_NAMES } from './types'

/** Node types that are never drawn (their children still are). */
export const NON_VISUAL_TYPES = new Set<number>([NodeType.World, NodeType.Camera])

/**
 * Nodes the bulk commands (Select All / Invert / Select All Matching) operate
 * on: visual glyphs only. Desktop rationale, ported verbatim — sweeping the
 * World row into Select All meant a bulk color edit silently repainted the
 * background (its color IS the background), and Select-All + Move would drag
 * a World Grid along with everything sitting on it, double-moving every child.
 * Clicking such a row directly (or pressing G for grids) still selects it.
 */
export function isBulkSelectable(node: GvNode): boolean {
  return !NON_VISUAL_TYPES.has(node.type) && node.type !== NodeType.WorldGrid
}

export function bulkSelectableNodes(nodes: GvNode[]): GvNode[] {
  return nodes.filter(isBulkSelectable)
}

export type SelectCriterion = 'branchLevel' | 'geometry' | 'topo'

export const CRITERION_LABELS: Record<SelectCriterion, string> = {
  branchLevel: 'Branch Level',
  geometry: 'Geometry',
  topo: 'Topology',
}

function criterionField(node: GvNode, criterion: SelectCriterion): number {
  switch (criterion) {
    case 'branchLevel':
      return node.branchLevel
    case 'geometry':
      return node.geometry
    case 'topo':
      return node.topo
  }
}

export interface CriterionValue {
  value: number
  label: string
}

/** The distinct values of `criterion` present in the scene, ascending. */
export function criterionValues(nodes: GvNode[], criterion: SelectCriterion): CriterionValue[] {
  const seen = new Set<number>()
  for (const node of bulkSelectableNodes(nodes)) seen.add(criterionField(node, criterion))
  return [...seen]
    .sort((a, b) => a - b)
    .map((value) => ({ value, label: criterionLabel(criterion, value) }))
}

function criterionLabel(criterion: SelectCriterion, value: number): string {
  switch (criterion) {
    case 'branchLevel':
      return String(value)
    case 'geometry':
      return `${value}: ${GEOMETRY_NAMES[value] ?? `Geo ${value}`}`
    case 'topo':
      return `${value}: ${TOPO_NAMES[value] ?? `Topo ${value}`}`
  }
}

export function selectByCriterion(
  nodes: GvNode[],
  criterion: SelectCriterion,
  value: number,
): Set<number> {
  const ids = new Set<number>()
  for (const node of bulkSelectableNodes(nodes)) {
    if (criterionField(node, criterion) === value) ids.add(node.id)
  }
  return ids
}

/**
 * Desktop `_on_select_by_tag`: every node whose tag text CONTAINS the keyword,
 * case-insensitively.
 *
 * Matching is against `text` alone — the `link` column is deliberately not
 * searched, because that is what the desktop searches and because a URL's host
 * name would otherwise pull in nodes whose visible label says nothing of the
 * kind. `text` is the same field either authoring style lands in: inline
 * `text` columns, or the companion gv_tag.csv applyTags() writes into.
 *
 * An empty (or whitespace-only) keyword matches nothing rather than
 * everything — the desktop returns early on it, and "select all" already has
 * its own command.
 */
export function selectByTagText(nodes: GvNode[], keyword: string): Set<number> {
  const ids = new Set<number>()
  const needle = keyword.trim().toLowerCase()
  if (needle === '') return ids
  for (const node of bulkSelectableNodes(nodes)) {
    if (node.text.toLowerCase().includes(needle)) ids.add(node.id)
  }
  return ids
}

export function selectAllIds(nodes: GvNode[]): Set<number> {
  return new Set(bulkSelectableNodes(nodes).map((n) => n.id))
}

/** Ctrl+I: every bulk-selectable node that is not currently selected. */
export function invertSelection(nodes: GvNode[], selected: ReadonlySet<number>): Set<number> {
  const ids = new Set<number>()
  for (const node of bulkSelectableNodes(nodes)) {
    if (!selected.has(node.id)) ids.add(node.id)
  }
  return ids
}

// --- Visibility (the per-node hide flag; saved to CSV) -------------------------
// Hiding is strictly per-node: a hidden parent never hides its children — each
// node's own flag alone decides. Desktop keeps the selection across a hide, so
// hidden-but-selected nodes stay manipulable and Show Selected undoes it.

/** Set `hide` on the given ids; returns the ids whose flag actually changed. */
export function setHidden(nodes: GvNode[], ids: ReadonlySet<number>, hide: boolean): number[] {
  const want = hide ? 1 : 0
  const changed: number[] = []
  for (const node of nodes) {
    if (!ids.has(node.id) || node.hide === want) continue
    node.hide = want
    changed.push(node.id)
  }
  return changed
}

/**
 * Show only the selected nodes: clear their hide flags, set everyone else's.
 * World/Camera rows are never drawn, so their flags are left untouched rather
 * than silently rewritten into the saved CSV; World Grids stay visible too —
 * they're the reference frame under the isolated glyphs, not part of the data
 * being inspected.
 */
export function isolateSelection(nodes: GvNode[], ids: ReadonlySet<number>): number[] {
  const changed: number[] = []
  for (const node of nodes) {
    if (!isBulkSelectable(node)) continue
    const want = ids.has(node.id) ? 0 : 1
    if (node.hide === want) continue
    node.hide = want
    changed.push(node.id)
  }
  return changed
}

/** Clear the hide flag on every node in the scene. */
export function showAll(nodes: GvNode[]): number[] {
  const changed: number[] = []
  for (const node of nodes) {
    if (node.hide === 0) continue
    node.hide = 0
    changed.push(node.id)
  }
  return changed
}
