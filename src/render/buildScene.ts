// Builds a Three.js scene graph from parsed gv_node.csv rows.
//
// Transform model ported (behavior, not code) from the desktop engine's
// compute_world_transforms (glyphviz_core/topology.py, verified 2026-07-24):
// each node's world basis is the ancestor chain's rotation·scale composition,
// and a child's offset is the parent's basis applied to the child's
// topology-space translate. For the Cartesian topology family that is exactly
// a standard TRS hierarchy, so plain Object3D nesting reproduces it.
//
// All 18 topologies place via topoOffset/topoBaseRotation (src/render/
// topology.ts), and World Grid (type 6) children place by geography —
// both verified against the desktop engine by the parity test. Link (type
// 7) edges render via the LinkOverlay between endpoint world positions.
// Not yet implemented: the Plot/Surface overlay drawing (their children
// still place correctly).

import * as THREE from 'three'
import type { GvNode } from '../gv/types'
import { NodeType, Topo } from '../gv/types'
import { GRID_GLOBE_RADIUS, gridCenter, gridDrawScale, gridIsGlobe } from '../gv/worldGrid'
import { createGlyphObject, createPickProxy } from './glyphGeometry'
import { buildLinkOverlay, LinkOverlay } from './linkOverlay'
import { localRotationMatrix } from './rotation'
import { topoBaseRotation, topoOffset } from './topology'
import { createWorldGridObject } from './worldGridGeometry'

/** Desktop "Global Scale" B — the unscaled base glyph size. */
export const BASE_SCALE = 1.0
/** Draw-time per-axis floor on world scale (placement always uses raw scale). */
export const RENDER_SCALE_FLOOR = 0.2
/** Background when no World (type 0) row is present. */
export const DEFAULT_BACKGROUND = new THREE.Color(20 / 255, 20 / 255, 31 / 255)

/** Node types that are never drawn (their children still are). */
const NON_VISUAL_TYPES = new Set<number>([NodeType.World, NodeType.Camera])

/**
 * Set a frame's local TRS from its node row: topology offset for position,
 * outward base rotation · own rotation, raw scale. Shared by the scene
 * builder and the drag gizmo (which re-applies it live after mutating
 * translate).
 */
export function applyFrameTransform(
  frame: THREE.Object3D,
  node: GvNode,
  parentGv: GvNode | null,
): void {
  frame.position.copy(framePosition(node, parentGv))
  const rotation = frameBaseRotation(node, parentGv).multiply(
    localRotationMatrix(node.rotate.x, node.rotate.y, node.rotate.z, node.rotationMode),
  )
  frame.quaternion.setFromRotationMatrix(rotation)
  // A World Grid's own scale must not stretch its children (the ANTz Grid
  // rule), so its frame carries scale (1, 1, 1); the scale reaches its
  // rendered plate via gridDrawScale on the glyph and its children's
  // positions via the per-axis re-spacing in framePosition.
  if (node.type === NodeType.WorldGrid) {
    frame.scale.set(1, 1, 1)
  } else {
    frame.scale.set(node.scale.x, node.scale.y, node.scale.z)
  }
}

/**
 * The node's local-frame position. Children of a World Grid place by
 * geography, regardless of the grid row's own topo field: flat → Cartesian
 * recentered on the extents window's midpoint; globe → KML lon/lat/elevation
 * on the 180/π sphere. The grid's per-axis scale re-spaces these offsets
 * here (its frame carries no scale — see applyFrameTransform).
 */
function framePosition(node: GvNode, parentGv: GvNode | null): THREE.Vector3 {
  if (parentGv && parentGv.type === NodeType.WorldGrid) {
    let offset: THREE.Vector3
    if (gridIsGlobe(parentGv)) {
      offset = topoOffset({
        parentTopo: Topo.Sphere,
        tx: node.translate.x,
        ty: node.translate.y,
        tz: node.translate.z,
        parentRatio: 0,
        subspace: node.subspace,
        baseScale: GRID_GLOBE_RADIUS,
      })
    } else {
      const c = gridCenter(parentGv)
      offset = new THREE.Vector3(
        node.translate.x - c.lon,
        node.translate.y - c.lat,
        node.translate.z,
      )
    }
    return offset.multiply(
      new THREE.Vector3(parentGv.scale.x, parentGv.scale.y, parentGv.scale.z),
    )
  }
  return topoOffset({
    parentTopo: parentGv ? parentGv.topo : -1,
    tx: node.translate.x,
    ty: node.translate.y,
    tz: node.translate.z,
    parentRatio: parentGv?.ratio ?? 0,
    subspace: node.subspace,
    baseScale: BASE_SCALE,
  })
}

/**
 * The outward-orientation scaffold premultiplied onto the node's own
 * rotation: the parent topo's base rotation, with the World Grid override —
 * flat-grid children take none (their placement is plain Cartesian), globe
 * children the TOPO_SPHERE outward scaffold. Shared with the rotate gizmo,
 * which strips it before decomposing a dragged quaternion.
 */
export function frameBaseRotation(node: GvNode, parentGv: GvNode | null): THREE.Matrix4 {
  if (parentGv && parentGv.type === NodeType.WorldGrid) {
    return gridIsGlobe(parentGv)
      ? topoBaseRotation(Topo.Sphere, node.translate.x, node.translate.y, node.subspace)
      : new THREE.Matrix4()
  }
  return topoBaseRotation(
    parentGv ? parentGv.topo : -1,
    node.translate.x,
    node.translate.y,
    node.subspace,
  )
}

export interface SceneBuildResult {
  root: THREE.Group
  background: THREE.Color
  /** Nodes that produced a drawable glyph (Link edges counted separately). */
  drawnCount: number
  /** Rendered type-7 edges; call update() per frame, setResolution on resize. */
  links: LinkOverlay
  /** id → frame, first row wins. O(1) lookups — getObjectByName scans the
   *  whole graph and must stay out of per-tick interaction paths. */
  frames: ReadonlyMap<number, THREE.Object3D>
  warnings: string[]
}

export function buildScene(nodes: GvNode[]): SceneBuildResult {
  const warnings = new Set<string>()
  const root = new THREE.Group()
  root.name = 'gv-root'

  let background = DEFAULT_BACKGROUND.clone()
  const worldNode = nodes.find((n) => n.type === NodeType.World)
  if (worldNode) {
    background = new THREE.Color(
      worldNode.color.r / 255,
      worldNode.color.g / 255,
      worldNode.color.b / 255,
    )
  }

  const byId = new Map<number, GvNode>()
  for (const node of nodes) {
    if (!byId.has(node.id)) byId.set(node.id, node)
  }

  // Children in file order; nodes with a missing parent attach at the root
  // (the parser already warns about the dangling reference).
  const childrenOf = new Map<number, GvNode[]>()
  const roots: GvNode[] = []
  for (const node of nodes) {
    if (node.parentId === 0 || node.parentId === node.id || !byId.has(node.parentId)) {
      roots.push(node)
    } else {
      let siblings = childrenOf.get(node.parentId)
      if (!siblings) {
        siblings = []
        childrenOf.set(node.parentId, siblings)
      }
      siblings.push(node)
    }
  }

  let drawnCount = 0
  // id → frame, first row wins (mirrors byId) — link endpoint resolution
  // must be O(1), never a getObjectByName scene scan.
  const frames = new Map<number, THREE.Object3D>()

  const attach = (
    node: GvNode,
    parent: THREE.Object3D,
    parentGv: GvNode | null,
    parentCumScale: THREE.Vector3,
    visited: Set<number>,
  ): void => {
    if (visited.has(node.id)) {
      warnings.add(`Node ${node.id}: parent cycle detected; subtree truncated.`)
      return
    }
    visited.add(node.id)

    const frame = new THREE.Object3D()
    frame.name = `gv:${node.id}`
    frame.userData.nodeId = node.id
    if (!frames.has(node.id)) frames.set(node.id, frame)
    // Roots take plain world coordinates (parentTopo −1 → Cartesian fallback,
    // identity base rotation), matching the engine's is_root handling.
    applyFrameTransform(frame, node, parentGv)
    parent.add(frame)

    const cumScale = parentCumScale.clone().multiply(frame.scale)

    // Links draw as overlay edges (below), never as a glyph at their frame.
    const drawable =
      !NON_VISUAL_TYPES.has(node.type) && node.type !== NodeType.Link && node.hide === 0

    if (drawable && node.type === NodeType.WorldGrid) {
      // Bespoke draw path: ±1-unit plate/globe scaled by the RAW node scale
      // times the shape's half-spans — no base_scale, no 0.2 floor, so the
      // surface sits exactly under the children it frames. Never pickable
      // (no proxy); a solid surface still occludes picking.
      const glyph = createWorldGridObject(node)
      const s = gridDrawScale(node)
      glyph.scale.set(s.x, s.y, s.z)
      glyph.name = 'glyph'
      glyph.userData.isGlyph = true
      frame.add(glyph)
      drawnCount++
    } else if (drawable) {
      const glyph = createGlyphObject(node.geometry, {
        color: new THREE.Color(node.color.r / 255, node.color.g / 255, node.color.b / 255),
        opacity: node.color.a / 255,
        ratio: node.ratio,
      })
      if (glyph) {
        // Desktop floors the *drawn* world scale at 0.2 per axis while child
        // placement keeps the raw scale — so the correction lives on the
        // glyph, never on the frame.
        glyph.scale.set(
          drawScaleCorrection(cumScale.x),
          drawScaleCorrection(cumScale.y),
          drawScaleCorrection(cumScale.z),
        )
        glyph.name = 'glyph'
        glyph.userData.isGlyph = true
        const proxy = createPickProxy(node.geometry)
        if (proxy) glyph.add(proxy)
        frame.add(glyph)
        drawnCount++
      } else {
        warnings.add(`Geometry id ${node.geometry} is not rendered yet (node ${node.id}).`)
      }
    }

    for (const child of childrenOf.get(node.id) ?? []) {
      attach(child, frame, node, cumScale, visited)
    }
  }

  const visited = new Set<number>()
  const unit = new THREE.Vector3(1, 1, 1)
  for (const node of roots) {
    attach(node, root, null, unit, visited)
  }

  const links = buildLinkOverlay(nodes, frames, root, (m) => warnings.add(m))

  return { root, background, drawnCount, links, frames, warnings: [...warnings] }
}

/** Ratio to apply on the glyph so its drawn world scale respects the floor. */
function drawScaleCorrection(cumAxisScale: number): number {
  const world = cumAxisScale * BASE_SCALE
  if (Math.abs(world) < 1e-12) return 1 // degenerate frame; nothing recoverable
  const floored = Math.max(world, RENDER_SCALE_FLOOR)
  return floored / world
}
