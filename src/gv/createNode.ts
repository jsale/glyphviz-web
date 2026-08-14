// Node creation for N / Shift+N and the Create panel. Behavior ported
// (not code) from the desktop app's _create_root_node/_create_child_node
// (glyphviz_gl/main_window.py, verified against source 2026-07-24, and
// re-verified 2026-08-14 for the wrapped placement lattice):
// - id allocation: max(existing ids) + 1 — never 0, since parent_id=0 is
//   the universal root sentinel.
// - New roots step one Placement Step on from the LAST root created.
// - New children take the next free slot in the same lattice, by ordinal.
// Both wrap to a new translate_y row at 360 — see `./placement`.

import type { PlacementSettings, PlacementXY } from './placement'
import { DEFAULT_PLACEMENT, stepFrom, wrappedGridOffset } from './placement'
import type { GvNode, Rgba, Vec3 } from './types'
import {
  DEFAULT_TOPO_SCALE,
  Geometry,
  NodeType,
  REF_GRID_DEFAULT_RGB,
  RotationMode,
  TAG_DEFAULT_TEXT_RGB,
  TagColorMode,
  Topo,
  WORLD_DEFAULT_BG,
} from './types'
import { GRID_DEFAULT_EXTENTS, GRID_DEFAULT_SEGMENTS } from './worldGrid'

/** The subset of fields the New Object Defaults panel controls. */
export interface NewObjectDefaults {
  geometry: number
  topo: number
  scale: Vec3
  color: Rgba
  /**
   * Which imported model a `geometry` of 23 (Mesh) draws. The desktop's
   * geometry combo carries the same `(GEO_MESH, mesh_id)` pair, and
   * `_new_object_defaults` returns both.
   */
  meshId?: number
}

/** Desktop panel defaults: solid octahedron, Point topology, grey. */
export const NEW_OBJECT_DEFAULTS: NewObjectDefaults = {
  geometry: Geometry.OctahedronSolid,
  topo: Topo.Point,
  scale: { x: 1, y: 1, z: 1 },
  color: { r: 200, g: 200, b: 200, a: 255 },
}

/**
 * Node types excluded from "last root glyph" placement: the desktop's
 * NON_VISUAL_TYPES (World, Camera) plus World Grid — a grid is the surface the
 * array of objects sits ON, not a member of it, so a new object steps on from
 * the last real object rather than from the grid.
 */
const NOT_IN_ROOT_ARRAY = new Set<number>([NodeType.World, NodeType.Camera, NodeType.WorldGrid])

export function nextNodeId(nodes: readonly GvNode[]): number {
  let max = 0
  for (const n of nodes) max = Math.max(max, n.id)
  return max + 1
}

/**
 * A fresh row carrying the desktop `Node` dataclass's own field defaults, with
 * only the four the New Object Defaults panel controls taken from `d`. Shared
 * (rather than re-stated) by everything that mints nodes — creation, the World
 * row, the Hyperglyph Generator — so "what a new node starts as" has one home.
 */
export function blankNode(id: number, d: NewObjectDefaults): GvNode {
  return {
    id,
    type: NodeType.Glyph,
    parentId: 0,
    branchLevel: 0,
    translate: { x: 0, y: 0, z: 0 },
    rotate: { x: 0, y: 0, z: 0 },
    scale: { ...d.scale },
    color: { ...d.color },
    geometry: d.geometry,
    hide: 0,
    topo: d.topo,
    ratio: 0.1,
    topoScale: DEFAULT_TOPO_SCALE,
    subspace: 0,
    textureId: 0,
    meshId: d.meshId ?? 0,
    // Fresh nodes are Euler like the desktop's Node dataclass default; only
    // files *loaded* without a rotation_mode column get HTR (asymmetric rule).
    rotationMode: RotationMode.EulerXYZ,
    colorIndex: 0,
    paletteId: 0,
    translateRate: { x: 0, y: 0, z: 0 },
    rotateRate: { x: 0, y: 0, z: 0 },
    scaleRate: { x: 0, y: 0, z: 0 },
    text: '',
    link: '',
    showText: 0,
    renderMode: 0,
    fogEnabled: 0,
    fogStart: 0,
    fogEnd: 0,
    tagColorMode: TagColorMode.Uniform,
    tagColor: { ...TAG_DEFAULT_TEXT_RGB },
    refGridColor: { ...REF_GRID_DEFAULT_RGB },
    extras: {},
  }
}

/**
 * The (translate_x, translate_y) for the next root-level node: one Placement
 * Step on from the LAST root created, wrapping to a new row at 360, or the
 * origin for a scene with none. Desktop `_next_root_pos`, shared there — and
 * here — by node creation, the no-target case of paste, and mesh import.
 *
 * Keyed on the last root created (highest id) rather than the largest
 * translate_x, because after a row wraps the largest x is back in the previous
 * row and the array would fold onto itself.
 */
export function nextRootPos(
  nodes: readonly GvNode[],
  placement: PlacementSettings = DEFAULT_PLACEMENT,
): PlacementXY {
  let last: GvNode | undefined
  for (const n of nodes) {
    if (NOT_IN_ROOT_ARRAY.has(n.type) || n.branchLevel !== 0) continue
    if (!last || n.id > last.id) last = n
  }
  if (!last) return { x: 0, y: 0 }
  return stepFrom(last.translate.x, last.translate.y, placement.step)
}

/**
 * The (translate_x, translate_y) for the next child of `parent`: the next free
 * slot in the wrapped step lattice. Desktop `_next_child_pos`, shared there —
 * and here — by New Child and the one-target case of paste.
 *
 * Links (type 7) parented to the node don't count: they render between their
 * two ends and ignore translate, so counting them would leave a hole.
 */
export function nextChildPos(
  nodes: readonly GvNode[],
  parent: GvNode,
  placement: PlacementSettings = DEFAULT_PLACEMENT,
): PlacementXY {
  let placed = 0
  for (const n of nodes) {
    if (n.parentId === parent.id && n.type !== NodeType.Link) placed++
  }
  return wrappedGridOffset(placed, placement.step)
}

/** New root-level node, one Placement Step on from the last root created. */
export function createRootNode(
  nodes: readonly GvNode[],
  defaults: NewObjectDefaults = NEW_OBJECT_DEFAULTS,
  placement: PlacementSettings = DEFAULT_PLACEMENT,
): GvNode {
  const node = blankNode(nextNodeId(nodes), defaults)
  const { x, y } = nextRootPos(nodes, placement)
  node.translate = { x, y, z: placement.rootZ }
  return node
}

/**
 * The scene-settings row (type 0) synthesized for a file that has none —
 * desktop `_ensure_world_node`. It is never drawn; its color is the viewport
 * background. The id rule matters here for the same reason as above: a World
 * node at id 0 would silently become the parent of every root-level row.
 */
export function createWorldNode(nodes: readonly GvNode[]): GvNode {
  const node = blankNode(nextNodeId(nodes), {
    geometry: 0,
    topo: 0,
    scale: { x: 1, y: 1, z: 1 },
    color: { ...WORLD_DEFAULT_BG },
  })
  node.type = NodeType.World
  return node
}

/**
 * A new World Grid (type 6) at the world origin carrying the whole-earth
 * window at 1:1 scale, so a child at translate (180, 90) lands at world
 * (180, 90) — desktop `_create_world_grid`, including its Grid Wire geometry,
 * Plane topology, slate colour and 36×18 (10°-cell) segments.
 *
 * Several grids per scene are allowed, and nothing attaches to one implicitly:
 * children arrive by having their parent_id set (New Child, paste, or a Draw
 * Mode stamp). Draw Mode is what needed this first — the mode is meaningless
 * without a target, so entering it in a gridless scene creates one.
 */
export function createWorldGrid(nodes: readonly GvNode[]): GvNode {
  const node = blankNode(nextNodeId(nodes), {
    geometry: Geometry.GridWire,
    topo: Topo.Plane,
    scale: { x: 1, y: 1, z: 1 },
    color: { r: 64, g: 80, b: 96, a: 255 },
  })
  node.type = NodeType.WorldGrid
  node.extras.trigger_lo_x = String(GRID_DEFAULT_EXTENTS[0])
  node.extras.trigger_hi_x = String(GRID_DEFAULT_EXTENTS[1])
  node.extras.trigger_lo_y = String(GRID_DEFAULT_EXTENTS[2])
  node.extras.trigger_hi_y = String(GRID_DEFAULT_EXTENTS[3])
  node.extras.segments_x = String(GRID_DEFAULT_SEGMENTS[0])
  node.extras.segments_y = String(GRID_DEFAULT_SEGMENTS[1])
  return node
}

/**
 * New child under `parent`, taking the next free slot in the wrapped step
 * lattice so repeated presses neither overlap nor run off in a line — on a
 * circular parent (Sphere, Torus, Cylinder…) the child that completes a lap
 * starts a new ring above the first instead of landing on top of it.
 */
export function createChildNode(
  nodes: readonly GvNode[],
  parent: GvNode,
  defaults: NewObjectDefaults = NEW_OBJECT_DEFAULTS,
  placement: PlacementSettings = DEFAULT_PLACEMENT,
): GvNode {
  const node = blankNode(nextNodeId(nodes), defaults)
  node.parentId = parent.id
  node.branchLevel = parent.branchLevel + 1
  const { x, y } = nextChildPos(nodes, parent, placement)
  node.translate = { x, y, z: placement.childZ }
  return node
}
