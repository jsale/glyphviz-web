// Column definitions and sorting for the Node Table panel — the data half of
// the desktop's node_table.py (NodeTableModel), with no DOM in it.
//
// The 21 columns, their order, their labels and their formatting are the
// desktop's `_COLUMNS` / `_FLOAT_ATTRS` / `_SIGFIG_ATTRS` verbatim: raw numeric ids for
// type/geometry/topology (the names live in the inspector, which has room for
// them), three decimals for the float attributes, and a packed #RRGGBB for the
// colour. Widths are the web's own business — Qt sizes its sections from the
// content, which a fixed-layout virtual table cannot do per row.

import type { GvNode } from '../gv/types'

export type SortDirection = 'asc' | 'desc'

export interface NodeColumn {
  /** Stable identifier, used as the sort key and as a DOM data attribute. */
  id: string
  label: string
  title: string
  width: number
  /** Numeric sort key — every column of this table has one. */
  sortKey(node: GvNode): number
  text(node: GvNode): string
  /** The colour column also draws a swatch. */
  swatch?: true
}

const int = (v: number): string => String(v)
/** Desktop `f"{val:.3f}"` for the float attributes. */
const f3 = (v: number): string => (Number.isFinite(v) ? v.toFixed(3) : String(v))
/** Desktop `f"{val:g}"` — significant figures, for a column spanning decades. */
const g = (v: number): string =>
  Number.isFinite(v) ? Number(v.toPrecision(6)).toString() : String(v)

function hex2(v: number): string {
  return Math.max(0, Math.min(255, Math.round(v))).toString(16).toUpperCase().padStart(2, '0')
}

/**
 * Packed R<<16|G<<8|B, the value the desktop sorts the colour column by (its
 * `Qt.UserRole`) — so ordering groups by red first, then green, then blue,
 * rather than by anything perceptual. Alpha is deliberately not in the key,
 * matching the desktop.
 */
export function packedColor(node: GvNode): number {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
  return (c(node.color.r) << 16) | (c(node.color.g) << 8) | c(node.color.b)
}

const AXES = ['x', 'y', 'z'] as const

function vectorColumns(
  labels: readonly [string, string, string],
  title: string,
  field: (n: GvNode) => { x: number; y: number; z: number },
  width: number,
): NodeColumn[] {
  return AXES.map((axis, i) => ({
    id: labels[i],
    label: labels[i],
    title,
    width,
    sortKey: (n: GvNode) => field(n)[axis],
    text: (n: GvNode) => f3(field(n)[axis]),
  }))
}

export const NODE_TABLE_COLUMNS: readonly NodeColumn[] = [
  { id: 'ID', label: 'ID', title: 'Node id (CSV `id`)', width: 56, sortKey: (n) => n.id, text: (n) => int(n.id) },
  {
    id: 'Type',
    label: 'Type',
    title: 'Node type: 0 World, 1 Camera, 5 Glyph, 6 World Grid, 7 Link',
    width: 46,
    sortKey: (n) => n.type,
    text: (n) => int(n.type),
  },
  {
    id: 'Parent',
    label: 'Parent',
    title: 'Parent node id (0 = root)',
    width: 56,
    sortKey: (n) => n.parentId,
    text: (n) => int(n.parentId),
  },
  {
    id: 'Level',
    label: 'Level',
    title: 'Branch level (root = 0)',
    width: 46,
    sortKey: (n) => n.branchLevel,
    text: (n) => int(n.branchLevel),
  },
  {
    id: 'Geo',
    label: 'Geo',
    title: "Geometry id — this node's own shape",
    width: 42,
    sortKey: (n) => n.geometry,
    text: (n) => int(n.geometry),
  },
  {
    id: 'Topo',
    label: 'Topo',
    title: 'Topology id — how this node places its CHILDREN',
    width: 46,
    sortKey: (n) => n.topo,
    text: (n) => int(n.topo),
  },
  {
    id: 'Hide',
    label: 'Hide',
    title: 'Per-node hide flag (1 = not drawn). A hidden parent never hides its children.',
    width: 42,
    sortKey: (n) => n.hide,
    text: (n) => int(n.hide),
  },
  {
    id: 'Texture',
    label: 'Texture',
    title: 'texture_id — 0 is untextured, else a 1-based index into the scene media folder',
    width: 60,
    sortKey: (n) => n.textureId,
    text: (n) => int(n.textureId),
  },
  ...vectorColumns(['X', 'Y', 'Z'], "Translate, in the PARENT's topology coordinates", (n) => n.translate, 70),
  ...vectorColumns(['Rx', 'Ry', 'Rz'], 'Rotation in degrees, read per RotMode', (n) => n.rotate, 70),
  {
    id: 'RotMode',
    label: 'RotMode',
    title: 'rotation_mode: 0 Euler XYZ, 1 ANTz Heading/Tilt/Roll (Z-X-Z)',
    width: 62,
    sortKey: (n) => n.rotationMode,
    text: (n) => int(n.rotationMode),
  },
  ...vectorColumns(['Sx', 'Sy', 'Sz'], 'Scale', (n) => n.scale, 62),
  {
    id: 'Ratio',
    label: 'Ratio',
    title: 'Geometry/topology aspect parameter (torus tube radius, point size, link width)',
    width: 62,
    sortKey: (n) => n.ratio,
    text: (n) => f3(n.ratio),
  },
  {
    id: 'TopoScl',
    label: 'TopoScl',
    title:
      'topo_scale — how far one unit of a CHILD’s translate reaches on the axes this ' +
      'node’s topology reads as a distance (1 = one world unit; 1/180 = ANTz)',
    width: 62,
    sortKey: (n) => n.topoScale,
    // A multiplier spanning decades: the 3 dp every other float column takes
    // would render the ANTz value (1/180) as a flat "0.006".
    text: (n) => g(n.topoScale),
  },
  {
    id: 'Color',
    label: 'Color',
    title: 'RGB, sorted as packed R<<16|G<<8|B (alpha is not part of the key)',
    width: 82,
    sortKey: packedColor,
    text: (n) => `#${hex2(n.color.r)}${hex2(n.color.g)}${hex2(n.color.b)}`,
    swatch: true,
  },
]

export const NODE_TABLE_WIDTH = NODE_TABLE_COLUMNS.reduce((sum, c) => sum + c.width, 0)

export function findColumn(id: string): NodeColumn | undefined {
  return NODE_TABLE_COLUMNS.find((c) => c.id === id)
}

/**
 * The display order for a sorted column.
 *
 * Key-based, exactly like the desktop's `NodeTableModel.sort` and for the same
 * reason: extracting one key per node is O(n) reads, while comparing whole
 * nodes inside the comparator re-reads them O(n log n) times. The input array
 * is never mutated — `currentNodes` is the scene's file order and the CSV
 * writer depends on it.
 *
 * Ties keep file order in both directions: `Array.prototype.sort` is stable,
 * and so is Python's `sorted(..., reverse=True)`, which does not reverse
 * equal elements.
 */
export function sortNodesForTable(
  nodes: readonly GvNode[],
  column: NodeColumn,
  direction: SortDirection,
): GvNode[] {
  const n = nodes.length
  const keys = new Float64Array(n)
  for (let i = 0; i < n; i++) keys[i] = column.sortKey(nodes[i])
  const order = new Array<number>(n)
  for (let i = 0; i < n; i++) order[i] = i
  const sign = direction === 'desc' ? -1 : 1
  order.sort((a, b) => sign * (keys[a] - keys[b]))
  const out = new Array<GvNode>(n)
  for (let i = 0; i < n; i++) out[i] = nodes[order[i]]
  return out
}
