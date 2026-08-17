// Where the renderer actually put each node — the one input Save Selection's
// bake cannot derive from the CSV alone (src/gv/selectionExport.ts).
//
// This is the web's answer to the desktop's `scene.world_pos(id)` /
// `scene.basis_matrices(id)[0]`, and it is deliberately built out of
// `applyFrameTransform` rather than out of a second copy of the placement math:
// the whole promise of the feature is that a detached node reopens exactly
// where THIS app drew it, so the transform it bakes has to be the one this app
// composed, not a restatement that could drift from it.
//
// Two conventions have to be reconciled, and both are already documented
// elsewhere in this repo:
//
// * A World Grid's frame carries scale (1, 1, 1) here, because the ANTz Grid
//   rule says a grid's scale re-spaces its children without stretching them —
//   so the scale reaches the screen through gridDrawScale and through the
//   per-axis multiply in framePosition instead. The desktop's world_basis for a
//   grid DOES include that scale (its children compose off `parent_basis`, the
//   rotation-only version). The two agree once the grid's own scale is
//   multiplied back in, which is exactly what src/render/parity.test.ts does
//   when it diffs bases — and what `gridScaledBasis` below does, so a baked
//   grid keeps its footprint.
// * Everything else composes identically: a frame's matrixWorld is
//   `parent_basis · child_local · diag(scale)` in its upper 3×3 and
//   `parent_pos + parent_basis · topoOffset` in its translation, which is
//   compute_world_transforms term for term.
//
// Computed from the node rows rather than read off the live scene graph, so a
// node past the `\` draw limit — which has no Object3D at all — still exports
// where it would have been drawn.

import * as THREE from 'three'
import type { Mat3, WorldPlacement } from '../gv/selectionExport'
import type { GvNode } from '../gv/types'
import { NodeType } from '../gv/types'
import { applyFrameTransform, effectiveParent } from './buildScene'

function mat3Of(m: THREE.Matrix4): Mat3 {
  const e = m.elements // column-major
  return [
    [e[0], e[4], e[8]],
    [e[1], e[5], e[9]],
    [e[2], e[6], e[10]],
  ]
}

/**
 * A grid's basis in the desktop's convention: its frame's, with its own scale
 * multiplied back in (post-multiplied, i.e. onto the columns — `M · diag(s)`).
 */
function gridScaledBasis(basis: Mat3, node: GvNode): Mat3 {
  const s = [node.scale.x, node.scale.y, node.scale.z]
  return [
    [basis[0][0] * s[0], basis[0][1] * s[1], basis[0][2] * s[2]],
    [basis[1][0] * s[0], basis[1][1] * s[1], basis[1][2] * s[2]],
    [basis[2][0] * s[0], basis[2][1] * s[1], basis[2][2] * s[2]],
  ]
}

/**
 * Every node's world position and world basis, keyed by id (first row wins on a
 * duplicate id, the engine's own rule).
 *
 * Walks parents before children from the roots, exactly as buildScene's
 * recursion does — including its cycle guard, so a self-referencing subtree is
 * truncated rather than looping.
 */
export function worldPlacements(nodes: readonly GvNode[]): Map<number, WorldPlacement> {
  const byId = new Map<number, GvNode>()
  for (const n of nodes) if (!byId.has(n.id)) byId.set(n.id, n)

  const childrenOf = new Map<number, GvNode[]>()
  const roots: GvNode[] = []
  for (const node of nodes) {
    if (effectiveParent(node, byId) === null) {
      roots.push(node)
    } else {
      const list = childrenOf.get(node.parentId)
      if (list) list.push(node)
      else childrenOf.set(node.parentId, [node])
    }
  }

  const out = new Map<number, WorldPlacement>()
  const frame = new THREE.Object3D()
  const visited = new Set<number>()

  const walk = (node: GvNode, parentGv: GvNode | null, parentWorld: THREE.Matrix4): void => {
    if (visited.has(node.id)) return
    visited.add(node.id)

    // The frame's LOCAL matrix, straight from the builder's own rule, then
    // composed onto the ancestors — a THREE.Object3D's matrixWorld without a
    // scene graph to hang it in.
    applyFrameTransform(frame, node, parentGv)
    frame.updateMatrix()
    const world = new THREE.Matrix4().multiplyMatrices(parentWorld, frame.matrix)

    if (!out.has(node.id)) {
      const basis = mat3Of(world)
      const p = new THREE.Vector3().setFromMatrixPosition(world)
      out.set(node.id, {
        pos: [p.x, p.y, p.z],
        basis: node.type === NodeType.WorldGrid ? gridScaledBasis(basis, node) : basis,
      })
    }

    for (const child of childrenOf.get(node.id) ?? []) walk(child, node, world)
  }

  const identity = new THREE.Matrix4()
  for (const node of roots) walk(node, null, identity)
  return out
}
