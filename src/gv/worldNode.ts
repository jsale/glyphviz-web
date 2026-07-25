// The World row (type 0): the scene's own settings rather than a glyph's.
//
// Its color_r/g/b IS the viewport background (the desktop's Scene Settings
// group and its B hotkey), and it also carries render_mode and the fog fields.
// A scene without one renders on the hardcoded default until something asks to
// change a scene setting — at which point one is synthesized, exactly as the
// desktop's _ensure_world_node does.

import type { GvNode } from './types'
import { NodeType, WORLD_DEFAULT_BG } from './types'
import { createWorldNode } from './createNode'

/**
 * The scene's World row, or null. Lowest id wins when a file somehow has
 * several — the desktop's `min(world_nodes, key=id)` rule, so both apps agree
 * on which row the background comes from.
 */
export function worldNodeOf(nodes: readonly GvNode[]): GvNode | null {
  let found: GvNode | null = null
  for (const node of nodes) {
    if (node.type === NodeType.World && (found === null || node.id < found.id)) found = node
  }
  return found
}

/** The scene's background as 0–255 channels, falling back to the default. */
export function backgroundRgb(nodes: readonly GvNode[]): { r: number; g: number; b: number } {
  // Alpha is deliberately dropped: the clear colour is always opaque, and the
  // World row's color_a means nothing to it.
  const { r, g, b } = worldNodeOf(nodes)?.color ?? WORLD_DEFAULT_BG
  return { r, g, b }
}

/**
 * The World row to write a scene setting into, appending a fresh one when the
 * file has none. Mutates `nodes` in that case — the caller has to rebuild.
 */
export function ensureWorldNode(nodes: GvNode[]): GvNode {
  const existing = worldNodeOf(nodes)
  if (existing) return existing
  const world = createWorldNode(nodes)
  nodes.push(world)
  return world
}

/**
 * The B key / B-W button: flip the background between black and white. The
 * desktop's threshold is red ≥ 128 counts as "currently white".
 */
export function toggledBwBackground(rgb: { r: number; g: number; b: number }): number {
  return rgb.r >= 128 ? 0 : 255
}
