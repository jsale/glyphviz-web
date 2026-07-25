// How an edit made against ONE node spreads across a multi-selection.
//
// Both rules come from the desktop:
//
//   - Panel fields (main_window.py _on_insp_pos_changed / _on_insp_rotation_-
//     changed): translate and rotate apply the DELTA from the value the field
//     was showing, so the selection shifts or turns as a group and keeps its
//     relative arrangement. Every other field applies absolutely to all.
//
//   - Gizmo drags (viewport.py _apply_axis_deltas): one drag step is added to
//     `translate_<axis>` / `rotate_<axis>` of every selected node, and
//     MULTIPLIED into `scale_<axis>` (its step is `1 + raw·0.004`), each node
//     in its own coordinates, independent of its parent.
//
// Both work on the node's own CSV fields, never on world space — a child of a
// Sphere-topology parent shifts in lon/lat/elevation just like it would if you
// typed the number, which is what makes this round-trip through the format.

import type { GvNode, Vec3 } from './types'

export type VectorField = (node: GvNode) => Vec3
export type Axis = 'x' | 'y' | 'z'

/**
 * Panel rule: shift one axis of `field` on every node by (value − anchor),
 * then move the anchor to the new value so the next keystroke measures from
 * there. A single selection collapses to a plain assignment, because its
 * anchor is its own current value.
 */
export function shiftAxis(
  nodes: GvNode[],
  field: VectorField,
  axis: Axis,
  anchor: Vec3,
  value: number,
): void {
  const delta = value - anchor[axis]
  anchor[axis] = value
  for (const node of nodes) field(node)[axis] += delta
}

/** A node's editable transform, captured when a gizmo drag begins. */
export interface DragSnapshot {
  translate: Vec3
  rotate: Vec3
  scale: Vec3
}

export function snapshotTransform(node: GvNode): DragSnapshot {
  return { translate: { ...node.translate }, rotate: { ...node.rotate }, scale: { ...node.scale } }
}

export type DragMode = 'translate' | 'rotate' | 'scale'

/** Desktop clamp on a size drag (`max(0.001, …)`). */
export const MIN_DRAG_SCALE = 0.001

/**
 * Gizmo rule: give `follower` the same change the primary node has taken
 * since the drag began.
 *
 * Followers are re-derived from their drag-start snapshot every tick rather
 * than accumulated, so a long drag can't drift away from the primary.
 */
export function applyDragDelta(
  mode: DragMode,
  primary: GvNode,
  primaryStart: DragSnapshot,
  follower: GvNode,
  followerStart: DragSnapshot,
): void {
  if (mode === 'translate') {
    for (const axis of ['x', 'y', 'z'] as const) {
      follower.translate[axis] =
        followerStart.translate[axis] + (primary.translate[axis] - primaryStart.translate[axis])
    }
    return
  }
  if (mode === 'rotate') {
    for (const axis of ['x', 'y', 'z'] as const) {
      follower.rotate[axis] =
        followerStart.rotate[axis] + (primary.rotate[axis] - primaryStart.rotate[axis])
    }
    return
  }
  // Size is a ratio, so a mixed-size selection keeps its proportions instead
  // of collapsing onto the primary's size. A primary that started at zero on
  // an axis has no recoverable ratio there — hold that axis.
  for (const axis of ['x', 'y', 'z'] as const) {
    const was = primaryStart.scale[axis]
    const ratio = Math.abs(was) < 1e-12 ? 1 : primary.scale[axis] / was
    follower.scale[axis] = Math.max(MIN_DRAG_SCALE, followerStart.scale[axis] * ratio)
  }
}
