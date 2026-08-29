// "Your children just flew off into the distance" — the measurement behind the
// Topology Scale hint (desktop `Scene.worst_child_placement_ratio`).
//
// Switching a parent from an angular topology to a linear one reads translate
// values authored as degrees as world units instead, which can move a child
// hundreds of times its parent's own radius away — far enough to be off screen
// with no clue where it went, and the single most confusing thing a new user
// can do to a scene. The field that fixes it (topo_scale) is not one they would
// think to look for, so the caller names it.

import * as THREE from 'three'
import type { GvNode } from '../gv/types'
import { NodeType } from '../gv/types'
import { baseScale } from './baseScale'

/**
 * A topology change that leaves some child this many times its parent's own
 * rendered radius away earns the hint. 20x is comfortably past any legitimate
 * layout — a child ON its parent's surface sits at ~1x, and even a deliberately
 * spread-out subtree stays in single digits — while the case this is for lands
 * in the hundreds.
 */
export const TOPO_SCALE_HINT_RATIO = 20

/** Node types that never draw, so never count as a scattered child. */
const NON_VISUAL_TYPES = new Set<number>([NodeType.World, NodeType.Camera])

export interface ScatterMeasurement {
  /** Worst child distance in multiples of its parent's own radius, 0 if none. */
  ratio: number
  /** The parent that owns that child, or -1. */
  parentId: number
}

/**
 * How far the given parents' children have been thrown, measured in multiples
 * of the parent's own rendered radius.
 *
 * A ratio near 1 means children sit on or near their parent's surface; a large
 * one means they are off in the distance. One pass over the node list, so the
 * cost is independent of how many parents are asked about.
 *
 * Frames must have current world matrices (rebuildScene ends with an
 * updateMatrixWorld, which is where this is called from).
 */
export function worstChildPlacementRatio(
  nodes: readonly GvNode[],
  frames: ReadonlyMap<number, THREE.Object3D>,
  parentIds: Iterable<number>,
): ScatterMeasurement {
  const ids = new Set(parentIds)
  if (ids.size === 0) return { ratio: 0, parentId: -1 }

  const radii = new Map<number, number>()
  const childPos = new THREE.Vector3()
  const parentPos = new THREE.Vector3()
  let worst = 0
  let worstId = -1

  for (const node of nodes) {
    if (!ids.has(node.parentId) || NON_VISUAL_TYPES.has(node.type)) continue
    const childFrame = frames.get(node.id)
    const parentFrame = frames.get(node.parentId)
    if (!childFrame || !parentFrame) continue // past the draw limit
    let radius = radii.get(node.parentId)
    if (radius === undefined) {
      radius = renderedRadius(parentFrame)
      radii.set(node.parentId, radius)
    }
    if (radius <= 0) continue
    const ratio =
      childPos.setFromMatrixPosition(childFrame.matrixWorld).distanceTo(
        parentPos.setFromMatrixPosition(parentFrame.matrixWorld),
      ) / radius
    if (ratio > worst) {
      worst = ratio
      worstId = node.parentId
    }
  }
  return { ratio: worst, parentId: worstId }
}

/**
 * World-space bounding-sphere radius of a frame's glyph for unit geometry: the
 * largest column norm of its world matrix's 3x3 part, which is the desktop's
 * `node_draw_data(...)[2]` exactly.
 *
 * Read off the GLYPH, not the frame, because the glyph is where the draw scale
 * lives (the floor, the Global Scale, a rod's proportions) — the same split the
 * desktop's draw matrix collapses into one matrix. A frame with no glyph (a
 * hidden node, a link, one past the draw limit) falls back to its own basis,
 * and a degenerate zero-scale parent to the Global Scale, so the ratio stays
 * meaningful instead of dividing by ~nothing.
 *
 * Exported because immersive focus (render/xrFocus.ts) needs exactly the same
 * measurement to decide how far from a node to arrive — "how big does this
 * glyph actually draw" has one answer, and a second copy of it would be a
 * second answer waiting to disagree.
 */
export function renderedRadius(frame: THREE.Object3D): number {
  const glyph = frame.children.find((c) => c.userData.isGlyph) ?? frame
  const m = glyph.matrixWorld.elements
  const column = (i: number) => Math.hypot(m[i * 4], m[i * 4 + 1], m[i * 4 + 2])
  const radius = Math.max(column(0), column(1), column(2))
  return radius > 1e-9 ? radius : baseScale()
}
