// Node creation for N / Shift+N and the Create panel. Behavior ported
// (not code) from the desktop app's _create_root_node/_create_child_node
// (glyphviz_gl/main_window.py, verified against source 2026-07-24):
// - id allocation: max(existing ids) + 1 — never 0, since parent_id=0 is
//   the universal root sentinel.
// - New roots step +10 along X past the last root-level glyph so repeated
//   presses don't overlap.
// - New children spread at translate (siblingCount·5, 0, 5) under the
//   parent's topology, for the same reason.

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

/** Node types excluded from "last root glyph" placement (desktop node.py). */
const NON_VISUAL = new Set<number>([NodeType.World, NodeType.Camera])

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
 * translate_x for the next root-level node: +10 past the last root glyph, or 0
 * for a scene with none. Desktop `_next_root_x`, shared there — and here — by
 * node creation and the no-target case of paste.
 */
export function nextRootX(nodes: readonly GvNode[]): number {
  let maxX = Number.NEGATIVE_INFINITY
  for (const n of nodes) {
    if (!NON_VISUAL.has(n.type) && n.branchLevel === 0) maxX = Math.max(maxX, n.translate.x)
  }
  return Number.isFinite(maxX) ? maxX + 10 : 0
}

/** New root-level node, stepping +10 along X from the last root glyph. */
export function createRootNode(
  nodes: readonly GvNode[],
  defaults: NewObjectDefaults = NEW_OBJECT_DEFAULTS,
): GvNode {
  const node = blankNode(nextNodeId(nodes), defaults)
  node.translate.x = nextRootX(nodes)
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
 * New child under `parent`, distributed along translate_x so repeated
 * presses don't overlap (desktop counts ALL existing children, visual or
 * not, so the two apps stay in step).
 */
export function createChildNode(
  nodes: readonly GvNode[],
  parent: GvNode,
  defaults: NewObjectDefaults = NEW_OBJECT_DEFAULTS,
): GvNode {
  const node = blankNode(nextNodeId(nodes), defaults)
  node.parentId = parent.id
  node.branchLevel = parent.branchLevel + 1
  let siblings = 0
  for (const n of nodes) {
    if (n.parentId === parent.id) siblings++
  }
  node.translate = { x: siblings * 5, y: 0, z: 5 }
  return node
}
