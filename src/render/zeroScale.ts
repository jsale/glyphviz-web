// The zero-scale cull — ported (behaviour, not code) from the desktop's
// `glyphviz_gl.viewport._draws_nothing` (commit f73d006, budgeted on the San
// Diego River Watershed Atlas at 69,676 nodes).
//
// A glyph whose RENDERED scale is zero on all three axes collapses every vertex
// of its shape onto one point, so its triangles cover no samples and its draw
// call cannot put a pixel on screen. The desktop skips those in its draw and
// pick loops; this app skips building them at all (see buildScene).
//
// WHY THE RULE EXISTS, which is also why it must stay this narrow: it is for the
// VERTICES OF A SURFACE (topo 17) or a Plot (16). There the mesh or the polyline
// is the picture and each child's own glyph is noise — but the children have to
// stay VISIBLE, because hide=1 deletes them from the mesh, and OPAQUE, because
// the mesh takes their alpha. Scale 0 is the only thing an author can say that
// means "be a vertex, don't be a shape", and until now it cost exactly as much
// as a shape. That authoring rule is documented on both sides (the desktop's
// Topologies reference and the GlyphViz skill), so the same CSV has to behave
// the same way here.
//
// WHY IT IS A BIGGER WIN HERE THAN THERE. The desktop saves a push/multiply/
// call/pop per glyph. This app saves the GLYPH AND ITS PICK PROXY — two of the
// three Object3Ds a drawn node costs — and with them a draw call, a material
// binding, a raycast candidate and a per-frame `updateMatrixWorld` recompose
// apiece. Object count is the thing buildScene's own Point Cloud comment names
// as what makes six-figure scenes unaffordable (roadmap 6m measured it).
//
// The node's FRAME stays, and that is load-bearing rather than a concession:
// the Surface and Plot overlays read their vertices out of `frames` (never out
// of glyphs), links resolve their endpoints there, tag labels anchor there, and
// children hang off it. So the mesh a culled vertex belongs to is untouched,
// which is the whole point.

import { Geometry, NodeType, Topo } from '../gv/types'
import type { GvNode } from '../gv/types'
import { gridDrawScale } from '../gv/worldGrid'
import { drawScaleCorrection } from './baseScale'
import { ROD_HEIGHT_FACTOR, ROD_RADIUS_FACTOR, WIRE_GEOMETRIES } from './glyphGeometry'

/**
 * The node's OWN contribution to its draw matrix, per axis — `S_child` in the
 * desktop's `node_world_matrix`, with the Rod factors and the World Grid
 * exemption that `applyGlyphDrawScale` and `createWorldGridObject` apply.
 *
 * Deliberately the same arithmetic those two functions perform, read off the
 * node rather than off the built Object3D, so the decision can be taken before
 * a glyph exists to measure. It carries the Global Scale and the opt-in minimum
 * size with it, because `drawScaleCorrection` does — the cull must be decided on
 * what is RENDERED, exactly as the desktop decides it on `node_draw_data`'s
 * radius.
 */
export function renderedGlyphScale(node: GvNode): [number, number, number] {
  if (node.type === NodeType.WorldGrid) {
    // A grid's plate is its raw scale times the shape's half-spans — neither
    // the Global Scale nor the floor reaches it, on either side.
    const s = gridDrawScale(node)
    return [s.x, s.y, s.z]
  }
  const x = node.scale.x * drawScaleCorrection(node.scale.x)
  const y = node.scale.y * drawScaleCorrection(node.scale.y)
  const z = node.scale.z * drawScaleCorrection(node.scale.z)
  if (node.topo === Topo.Rod) {
    return [x * ROD_RADIUS_FACTOR, y * ROD_RADIUS_FACTOR, z * ROD_HEIGHT_FACTOR]
  }
  return [x, y, z]
}

/**
 * True when a frame's local scale annihilates everything under it, so every
 * descendant's draw matrix is zero however it is authored — the desktop's
 * `parent_basis` carrying an ancestor's RAW scale (no floor, ever), which is why
 * a scale-0 parent culls a subtree of scale-1 children on both sides.
 *
 * Takes the frame's scale rather than the node's so it cannot drift from
 * `applyFrameTransform`, which is what decides it: a World Grid's frame is
 * (1, 1, 1) whatever its own scale says (the ANTz Grid rule), so a zero-scale
 * grid does NOT collapse its children — measured against the desktop, which
 * keeps them for the same reason.
 */
export function scaleIsZero(scale: { x: number; y: number; z: number }): boolean {
  return scale.x === 0 && scale.y === 0 && scale.z === 0
}

/**
 * The desktop's `_draws_nothing`, verdict for verdict.
 *
 * `collapsedAncestor` stands in for the rest of the draw matrix: the desktop
 * reads one radius off the fully composed matrix, this walks the tree and
 * carries the one fact that matters down it. The two agree except in a case no
 * fixture can be authored into by accident — an ancestor chain that is
 * individually non-degenerate but composes to rank 0 (a killed axis rotated
 * exactly onto another killed axis) — where this keeps a glyph the desktop
 * would drop, which is the safe direction.
 *
 * The three exemptions are the desktop's, and they are what keep the picture
 * identical with the cull on and off:
 *
 *   * POINT (22) is a fixed-pixel sprite whose size comes from the material,
 *     not the matrix (`sizeAttenuation: false`, and `gl_PointSize` on the
 *     desktop) — so a zero-scale Point still draws its dot in both apps.
 *   * WIRE geometries are GL_LINES / LineSegments, and a zero-length line can
 *     still rasterise a pixel; the diamond-exit rule is not universal.
 *   * TEXTURED nodes. The desktop's stated reason does not exist here — its
 *     VideoManager pauses a video no draw call asked for, where this app's
 *     videos are HTMLVideoElements that play regardless (textureLibrary.ts) —
 *     but the rule is kept identical anyway, because the ids ARE the contract
 *     between the two apps and a zero-scale textured node is a rounding error
 *     in cost. It reads the raw `texture_id`, like the desktop, so an id the
 *     media folder never supplied exempts a node just the same.
 */
export function drawsNothing(node: GvNode, collapsedAncestor = false): boolean {
  if (!collapsedAncestor) {
    const [x, y, z] = renderedGlyphScale(node)
    if (x !== 0 || y !== 0 || z !== 0) return false
  }
  return (
    node.geometry !== Geometry.Point &&
    !WIRE_GEOMETRIES.has(node.geometry) &&
    !node.textureId
  )
}
