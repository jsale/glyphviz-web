// Point Cloud topology (Topo.PointCloud, 18) — the data half.
//
// A cloud PARENT is an ordinary node whose `topo` is 18. Its children place at
// plain Cartesian translate_x/y/z, exactly as None/Plane/Video/Plot/Surface's
// do (render/topology.ts's default case, the desktop's `_pointcloud_offset`),
// and the renderer draws the whole set as ONE batched point array instead of a
// glyph apiece (render/pointCloudOverlay.ts).
//
// That substitution is the entire feature. It is the only topology that
// REPLACES its children's rendering rather than decorating it: a Plot parent
// adds a polyline over its children's glyphs and a Surface parent adds a quad
// mesh over them, but a cloud parent's children draw no glyphs at all.
//
// Why it has to exist HERE and not merely as a faster draw call: this app
// builds three Object3Ds per drawn node (frame, glyph, pick proxy), and
// `Scene.updateMatrixWorld` recomposes every one of them per frame BEFORE the
// renderer ever reads `visible` — 629k objects measured at 93.8 ms/frame of
// pure CPU matrix work (see roadmap 6m, the draw-limit work, where the same
// wall was hit and answered the same way). A 100k-point cloud built the
// ordinary way is ~15 ms/frame of nothing but matrix recomposition, before a
// single triangle is drawn. So a cloud point contributes NO Object3D, and its
// world position is computed straight from data instead.
//
// Every point is still a real node: an id, a colour, a label, a Channels
// binding, a CSV row that saves and merges like anything else. Only the
// drawing is pooled — which is also why this module holds no THREE and no DOM,
// the way the desktop's `point_cloud.py` holds no Qt and no OpenGL.

import { NodeType, Topo } from './types'
import type { GvNode } from './types'

/**
 * Ratio → rendered point size in pixels. The same conversion Link lines and
 * Plot polylines already use for their widths (`ratio × 20`), so the one ratio
 * row in the Properties panel means a comparable thickness whichever of the
 * three a node is. A cloud parent's default ratio of 0.1 therefore renders
 * 2 px points.
 *
 * ANTz drove point size from `node->lineWidth`; GlyphViz has no such field, and
 * `ratio` is the one that already carries "how thick is this thing" for every
 * other batched primitive — the desktop's reason for reusing it rather than
 * adding a column, and it means a cloud CSV needs no new column either.
 */
export const POINT_SIZE_SCALE = 20.0
export const MIN_POINT_SIZE = 1.0
/**
 * The desktop clamps here because fixed-function GL silently ignores a
 * glPointSize past its implementation maximum. WebGL has the same limit
 * (ALIASED_POINT_SIZE_RANGE, commonly 255 or 1024) and the same silence, so the
 * clamp is kept at the desktop's own number: identical behaviour across
 * drivers, and a runaway ratio — a Channels track bound to it, say — cannot
 * turn a cloud into a screen-filling blur the user then cannot click out of.
 */
export const MAX_POINT_SIZE = 64.0

/** Types that never render as scene content (World, Camera). */
const NON_VISUAL = new Set<number>([NodeType.World, NodeType.Camera])

/**
 * True for a node whose children render as a batched point cloud.
 *
 * A Link (type 7) has no children of its own and its `topo` is meaningless — it
 * renders as an edge between two ends — so it is never a cloud parent however
 * its topo column reads. The same exclusion the desktop's scan applies to Plot
 * and Surface, and that buildScene's overlay passes already apply here.
 */
export function isCloudParent(node: GvNode): boolean {
  return node.topo === Topo.PointCloud && node.type !== NodeType.Link
}

/**
 * Ids of every cloud parent in `nodes`. Usually empty or tiny, which is why
 * every "is this node a point?" test in the draw, pick, label and region-select
 * paths is `cloudParentIds.has(node.parentId)` rather than a membership test
 * against the (potentially 100k-element) set of points themselves.
 */
export function cloudParentIds(nodes: readonly GvNode[]): Set<number> {
  const ids = new Set<number>()
  for (const node of nodes) {
    if (isCloudParent(node)) ids.add(node.id)
  }
  return ids
}

/** Rendered point size in pixels for one cloud, from the parent's ratio. */
export function pointSize(parent: GvNode): number {
  return Math.min(MAX_POINT_SIZE, Math.max(MIN_POINT_SIZE, parent.ratio * POINT_SIZE_SCALE))
}

/**
 * The children of a cloud parent that render as points.
 *
 * Non-visual rows (World/Camera) and Links are excluded for the same reasons
 * the ordinary draw loop excludes them; `hide` is honoured unless Show Hidden
 * Nodes is on. ORDER IS PRESERVED, because the batch index → node id mapping
 * that makes a point pickable depends on it.
 */
export function drawableChildren(
  children: readonly GvNode[],
  showHidden: boolean,
): GvNode[] {
  return children.filter(
    (c) => !NON_VISUAL.has(c.type) && c.type !== NodeType.Link && (showHidden || c.hide === 0),
  )
}

/**
 * One cloud parent's children, flattened into draw-ready arrays.
 *
 * `ids` is what makes the batch pickable and selectable: index i in `positions`
 * and index i in `ids` are the same node, so a ray hit on vertex i resolves
 * straight to a node id — this app's equivalent of the desktop rendering the
 * same points into a colour-ID pick buffer.
 */
export interface CloudBatch {
  /** Node id per point. */
  ids: Int32Array
  /** World-space xyz, 3 floats per point. */
  positions: Float32Array
  /** Per-point RGBA, 4 floats per point — THREE's vertex-colour attribute. */
  colors: Float32Array
  /** Number of points — `positions.length / 3`. */
  count: number
}

/**
 * Per-point RGBA for a cloud's children.
 *
 * Colours come off each node's own color_r/g/b/a, so a cloud is coloured the
 * way every other GlyphViz scene is: per node, from the CSV, and
 * Channels-bindable. Written RAW (byte/255, no sRGB decode) because this app
 * renders with `outputColorSpace = LinearSRGBColorSpace` to match
 * fixed-function GL — the same identity treatment `THREE.Color(r, g, b)` gets
 * everywhere else here (roadmap 6k).
 *
 * Four components rather than three so `color_a` rides in the same attribute:
 * THREE reads an itemSize-4 colour attribute as RGBA (`USE_COLOR_ALPHA`), and
 * the alternative — a second attribute plus a custom shader to consume it —
 * would be a private vertex format for one primitive.
 */
export function cloudColors(children: readonly GvNode[]): Float32Array {
  const colors = new Float32Array(children.length * 4)
  for (let i = 0; i < children.length; i++) {
    const c = children[i].color
    colors[i * 4] = c.r / 255
    colors[i * 4 + 1] = c.g / 255
    colors[i * 4 + 2] = c.b / 255
    colors[i * 4 + 3] = c.a / 255
  }
  return colors
}

/**
 * True when any point in the cloud is translucent — what the overlay uses to
 * decide whether the material blends at all.
 *
 * Checked rather than assumed, because the two states are genuinely different
 * draws: a translucent cloud has to blend (which is how the desktop honours
 * `color_a`, its GL_BLEND being on globally), while an opaque one is far better
 * off writing depth. The overwhelmingly common case — an imported scan, every
 * alpha at 255 — is the second.
 */
export function hasTranslucentPoints(colors: Float32Array): boolean {
  for (let i = 3; i < colors.length; i += 4) {
    if (colors[i] < 1) return true
  }
  return false
}
