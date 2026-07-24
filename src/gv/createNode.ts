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
import { Geometry, NodeType, RotationMode, Topo } from './types'

/** The subset of fields the New Object Defaults panel controls. */
export interface NewObjectDefaults {
  geometry: number
  topo: number
  scale: Vec3
  color: Rgba
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

function blankNode(id: number, d: NewObjectDefaults): GvNode {
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
    subspace: 0,
    textureId: 0,
    meshId: 0,
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
    renderMode: 0,
    fogEnabled: 0,
    fogStart: 0,
    fogEnd: 0,
    extras: {},
  }
}

/** New root-level node, stepping +10 along X from the last root glyph. */
export function createRootNode(
  nodes: readonly GvNode[],
  defaults: NewObjectDefaults = NEW_OBJECT_DEFAULTS,
): GvNode {
  const node = blankNode(nextNodeId(nodes), defaults)
  let maxX = Number.NEGATIVE_INFINITY
  for (const n of nodes) {
    if (!NON_VISUAL.has(n.type) && n.branchLevel === 0) maxX = Math.max(maxX, n.translate.x)
  }
  node.translate.x = Number.isFinite(maxX) ? maxX + 10 : 0
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
