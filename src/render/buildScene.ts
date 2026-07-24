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
// topology.ts), verified against the desktop engine by the parity test.
// Not yet implemented: World Grid placement, Link edges, and the Plot/
// Surface overlay drawing (their children still place correctly).

import * as THREE from 'three'
import type { GvNode } from '../gv/types'
import { NodeType } from '../gv/types'
import { createGlyphObject } from './glyphGeometry'
import { localRotationMatrix } from './rotation'
import { topoBaseRotation, topoOffset } from './topology'

/** Desktop "Global Scale" B — the unscaled base glyph size. */
export const BASE_SCALE = 1.0
/** Draw-time per-axis floor on world scale (placement always uses raw scale). */
export const RENDER_SCALE_FLOOR = 0.2
/** Background when no World (type 0) row is present. */
export const DEFAULT_BACKGROUND = new THREE.Color(20 / 255, 20 / 255, 31 / 255)

/** Node types that are never drawn (their children still are). */
const NON_VISUAL_TYPES = new Set<number>([NodeType.World, NodeType.Camera])

export interface SceneBuildResult {
  root: THREE.Group
  background: THREE.Color
  /** Nodes that produced a drawable glyph. */
  drawnCount: number
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
  const rotation = new THREE.Matrix4()

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

    if (node.type === NodeType.WorldGrid) {
      warnings.add(
        `Node ${node.id}: World Grid placement is not implemented yet; treated as a plain glyph.`,
      )
    }
    if (parentGv?.type === NodeType.WorldGrid) {
      warnings.add(
        `Node ${node.id}: children of World Grid nodes place by grid extents, which is not implemented yet.`,
      )
    }

    const frame = new THREE.Object3D()
    frame.name = `gv:${node.id}`
    frame.userData.nodeId = node.id
    // Roots take plain world coordinates (parentTopo −1 → Cartesian fallback,
    // identity base rotation), matching the engine's is_root handling.
    const parentTopo = parentGv ? parentGv.topo : -1
    frame.position.copy(
      topoOffset({
        parentTopo,
        tx: node.translate.x,
        ty: node.translate.y,
        tz: node.translate.z,
        parentRatio: parentGv?.ratio ?? 0,
        subspace: node.subspace,
        baseScale: BASE_SCALE,
      }),
    )
    rotation
      .copy(topoBaseRotation(parentTopo, node.translate.x, node.translate.y, node.subspace))
      .multiply(localRotationMatrix(node.rotate.x, node.rotate.y, node.rotate.z, node.rotationMode))
    frame.quaternion.setFromRotationMatrix(rotation)
    frame.scale.set(node.scale.x, node.scale.y, node.scale.z)
    parent.add(frame)

    const cumScale = parentCumScale.clone().multiply(frame.scale)

    const drawable =
      !NON_VISUAL_TYPES.has(node.type) && node.type !== NodeType.Link && node.hide === 0
    if (node.type === NodeType.Link) {
      warnings.add(`Node ${node.id}: Link nodes are not rendered yet.`)
    }

    if (drawable) {
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

  return { root, background, drawnCount, warnings: [...warnings] }
}

/** Ratio to apply on the glyph so its drawn world scale respects the floor. */
function drawScaleCorrection(cumAxisScale: number): number {
  const world = cumAxisScale * BASE_SCALE
  if (Math.abs(world) < 1e-12) return 1 // degenerate frame; nothing recoverable
  const floored = Math.max(world, RENDER_SCALE_FLOOR)
  return floored / world
}
