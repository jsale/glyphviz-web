// Shift+drag region select.
//
// The desktop does this with a color-ID pass over the pick FBO
// (viewport.py _pick_nodes_in_rect), so a node counts as inside when any of
// its *visible* pixels fall in the rectangle. Here we project each node's
// world position and test the point against the rectangle instead — agreed
// with Jeff 2026-07-25 as the deliberate simplification. Two consequences,
// both intentional:
//
//   - a glyph large enough to straddle the box is missed unless its center
//     is inside, and
//   - nothing occludes: a node hidden behind a solid World Grid globe still
//     selects.
//
// In exchange this is a pure math pass with no second render path, so it
// stays cheap on the 65k-node scenes (Org_Event_Network) that drove the link
// overlay rework.

import * as THREE from 'three'
import { isBulkSelectable } from '../gv/selectionOps'
import type { GvNode } from '../gv/types'
import { NodeType } from '../gv/types'

/** Rectangle in CSS pixels relative to the canvas, any corner order. */
export interface ScreenRect {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface ViewportSize {
  width: number
  height: number
}

export interface RectSelectOptions {
  /** Include nodes whose hide flag is set (the Display group's toggle). */
  showHidden?: boolean
}

/**
 * Ids of the nodes whose world position projects inside `rect`.
 *
 * Excluded, matching the desktop's pick pass: World/Camera rows, World Grids
 * (never click or region targets — a grid usually fills the view under its
 * children), hidden nodes unless `showHidden`, and Link rows, whose own frame
 * is inert — the edge is drawn between its endpoints, not at the frame, so a
 * projected link position would mean nothing on screen.
 *
 * Frame world matrices must be current; call `root.updateMatrixWorld(true)`
 * first if anything moved since the last render.
 */
export function nodeIdsInRect(
  nodes: GvNode[],
  frames: ReadonlyMap<number, THREE.Object3D>,
  camera: THREE.PerspectiveCamera,
  rect: ScreenRect,
  viewport: ViewportSize,
  options: RectSelectOptions = {},
): Set<number> {
  const ids = new Set<number>()
  if (viewport.width <= 0 || viewport.height <= 0) return ids

  const left = Math.min(rect.x1, rect.x2)
  const right = Math.max(rect.x1, rect.x2)
  const top = Math.min(rect.y1, rect.y2)
  const bottom = Math.max(rect.y1, rect.y2)

  camera.updateMatrixWorld()
  const viewMatrix = camera.matrixWorldInverse
  const world = new THREE.Vector3()
  const view = new THREE.Vector3()

  for (const node of nodes) {
    if (!isBulkSelectable(node) || node.type === NodeType.Link) continue
    if (node.hide !== 0 && !options.showHidden) continue
    const frame = frames.get(node.id)
    if (!frame) continue

    world.setFromMatrixPosition(frame.matrixWorld)
    view.copy(world).applyMatrix4(viewMatrix)
    // Three looks down −Z in view space; anything at or behind the near
    // plane has no meaningful screen position (and projects mirrored).
    if (-view.z < camera.near) continue

    world.project(camera)
    const sx = ((world.x + 1) / 2) * viewport.width
    const sy = ((1 - world.y) / 2) * viewport.height
    if (sx >= left && sx <= right && sy >= top && sy <= bottom) ids.add(node.id)
  }
  return ids
}
