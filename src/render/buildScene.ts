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
// 7) edges render via the LinkOverlay between endpoint world positions, and
// Plot (16) polylines / Surface (17) quad meshes via the TopologyOverlay
// between their children's.

import * as THREE from 'three'
import type { GvNode } from '../gv/types'
import { Geometry, NodeType, Topo, WORLD_DEFAULT_BG } from '../gv/types'
import { GRID_GLOBE_RADIUS, gridCenter, gridDrawScale, gridIsGlobe } from '../gv/worldGrid'
import { worldNodeOf } from '../gv/worldNode'
import { drawLimitPlan } from './drawLimit'
import {
  createGlyphObject,
  createPickProxy,
  ROD_HEIGHT_FACTOR,
  ROD_RADIUS_FACTOR,
} from './glyphGeometry'
import { buildLinkOverlay, LinkOverlay } from './linkOverlay'
import { localRotationMatrix } from './rotation'
import { topoBaseRotation, topoOffset } from './topology'
import { buildTopologyOverlay, TopologyOverlay } from './topologyOverlay'
import { createWorldGridObject } from './worldGridGeometry'

/** Desktop "Global Scale" B — the unscaled base glyph size. */
export const BASE_SCALE = 1.0
/** Draw-time per-axis floor on world scale (placement always uses raw scale). */
export const RENDER_SCALE_FLOOR = 0.2
/** Background when no World (type 0) row is present. */
export const DEFAULT_BACKGROUND = new THREE.Color(
  WORLD_DEFAULT_BG.r / 255,
  WORLD_DEFAULT_BG.g / 255,
  WORLD_DEFAULT_BG.b / 255,
)

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
  /** Plot polylines + Surface meshes; same per-frame/resize contract. */
  overlays: TopologyOverlay
  /** id → frame, first row wins. O(1) lookups — getObjectByName scans the
   *  whole graph and must stay out of per-tick interaction paths. */
  frames: ReadonlyMap<number, THREE.Object3D>
  warnings: string[]
}

export interface BuildSceneOptions {
  /**
   * Draw (and therefore make pickable) nodes whose hide flag is set — the
   * desktop's "Show Hidden Nodes" display toggle. Without it, hiding a node
   * is only undoable through the selection you kept, Show All, or the CSV.
   */
  showHidden?: boolean
  /**
   * Decoded media, texture_id → texture (src/render/textureLibrary.ts). A
   * node whose texture_id is absent here draws untextured — the id may name a
   * format no browser decodes, or a file the folder never supplied.
   */
  textures?: ReadonlyMap<number, THREE.Texture>
  /**
   * Imported models, mesh_id → geometry (src/render/meshLibrary.ts). A
   * geometry-23 node whose id is absent here draws the desktop's sphere
   * fallback — the ids are import order and live only in this session, so a
   * scene can easily name one nothing has supplied.
   */
  meshes?: ReadonlyMap<number, THREE.BufferGeometry>
  /**
   * The ANTz `\` decimation cap: draw only the first N eligible nodes in file
   * order, null for all of them. Applied HERE rather than by hiding glyphs at
   * render time, because a hidden Object3D still costs a matrix recompute
   * every frame — see src/render/drawLimit.ts for the measurements and for the
   * overlay nodes that keep a bare frame past the cut.
   */
  drawLimit?: number | null
}

export function buildScene(nodes: GvNode[], options: BuildSceneOptions = {}): SceneBuildResult {
  const warnings = new Set<string>()
  const root = new THREE.Group()
  root.name = 'gv-root'

  let background = DEFAULT_BACKGROUND.clone()
  const worldNode = worldNodeOf(nodes)
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

  // null when nothing is decimated, which is every scene until the \ key is
  // pressed — the load-time path pays nothing for this.
  const limit = drawLimitPlan(nodes, options.drawLimit ?? null, {
    showHidden: options.showHidden,
  })

  let drawnCount = 0
  // id → frame, first row wins (mirrors byId) — link endpoint resolution
  // must be O(1), never a getObjectByName scene scan.
  const frames = new Map<number, THREE.Object3D>()

  // texture_id 0 is "untextured"; ids the media folder never supplied fall
  // back to untextured too, and main.ts reports them once for the scene.
  const textureFor = (node: GvNode): THREE.Texture | undefined =>
    node.textureId > 0 ? options.textures?.get(node.textureId) : undefined

  // A Mesh node whose id names nothing loaded still draws (as a sphere, like
  // the desktop) — but it is worth saying so, because the mapping lives only in
  // this session and "import the file" is the fix.
  const meshFor = (node: GvNode): THREE.BufferGeometry | undefined => {
    if (node.geometry !== Geometry.Mesh) return undefined
    const geometry = options.meshes?.get(node.meshId)
    if (!geometry) {
      // Keyed on the id, not the node: a scene can point thousands of glyphs
      // at one missing model, and that is one problem with one fix.
      warnings.add(
        `mesh_id ${node.meshId} is not loaded — those nodes draw as a sphere. ` +
          'Import the model file to see it.',
      )
    }
    return geometry
  }

  const attach = (
    node: GvNode,
    parent: THREE.Object3D,
    parentGv: GvNode | null,
    visited: Set<number>,
  ): void => {
    if (visited.has(node.id)) {
      warnings.add(`Node ${node.id}: parent cycle detected; subtree truncated.`)
      return
    }
    visited.add(node.id)

    // Past the draw limit with nothing below that needs placing: the whole
    // subtree contributes no Object3D. `keep` is upward-closed, so one test
    // covers it (drawLimit.ts).
    if (limit && !limit.keep.has(node.id)) return

    const frame = new THREE.Object3D()
    frame.name = `gv:${node.id}`
    frame.userData.nodeId = node.id
    if (!frames.has(node.id)) frames.set(node.id, frame)
    // Roots take plain world coordinates (parentTopo −1 → Cartesian fallback,
    // identity base rotation), matching the engine's is_root handling.
    applyFrameTransform(frame, node, parentGv)
    parent.add(frame)

    // Links draw as overlay edges (below), never as a glyph at their frame.
    const drawable =
      !NON_VISUAL_TYPES.has(node.type) &&
      node.type !== NodeType.Link &&
      (node.hide === 0 || options.showHidden === true) &&
      // Kept-but-not-drawn nodes exist only to place an overlay endpoint or a
      // descendant; they carry a frame and no glyph.
      (!limit || limit.draw.has(node.id))

    if (drawable && node.type === NodeType.WorldGrid) {
      // Bespoke draw path: ±1-unit plate/globe scaled by the RAW node scale
      // times the shape's half-spans — no base_scale, no 0.2 floor, so the
      // surface sits exactly under the children it frames. Never pickable
      // (no proxy); a solid surface still occludes picking.
      const glyph = createWorldGridObject(node, textureFor(node))
      const s = gridDrawScale(node)
      glyph.scale.set(s.x, s.y, s.z)
      glyph.name = 'glyph'
      glyph.userData.isGlyph = true
      frame.add(glyph)
      drawnCount++
    } else if (drawable) {
      const mesh = meshFor(node)
      const glyph = createGlyphObject(node.geometry, {
        color: new THREE.Color(node.color.r / 255, node.color.g / 255, node.color.b / 255),
        opacity: node.color.a / 255,
        ratio: node.ratio,
        map: textureFor(node),
        mesh,
      })
      if (glyph) {
        applyGlyphDrawScale(glyph, node)
        glyph.name = 'glyph'
        glyph.userData.isGlyph = true
        const proxy = createPickProxy(node.geometry, mesh)
        if (proxy) glyph.add(proxy)
        frame.add(glyph)
        drawnCount++
      } else {
        warnings.add(`Geometry id ${node.geometry} is not rendered yet (node ${node.id}).`)
      }
    }

    for (const child of childrenOf.get(node.id) ?? []) {
      attach(child, frame, node, visited)
    }
  }

  const visited = new Set<number>()
  for (const node of roots) {
    attach(node, root, null, visited)
  }

  const links = buildLinkOverlay(nodes, frames, root, (m) => warnings.add(m))

  // A link whose edge never drew — either endpoint missing (the desktop's
  // "pending" state) or dangling — would otherwise have nothing on screen to
  // click, so it falls back to the desktop's own answer: a pick sphere at the
  // link row's own position, which is exactly where its label anchors too.
  //
  // Divergence: the desktop draws that sphere for EVERY link, on top of the
  // edge. A link usually sits at its A-end node, so drawing it always would
  // let links quietly swallow clicks meant for the glyph underneath them —
  // and the desktop's own comment gives the endpoint-less case as its reason
  // for existing.
  for (const node of nodes) {
    if (node.type !== NodeType.Link) continue
    if (node.hide !== 0 && options.showHidden !== true) continue
    if (links.nodeIds.has(node.id)) continue
    const proxy = createPickProxy(Geometry.SphereSolid)
    if (proxy) frames.get(node.id)?.add(proxy)
  }

  const overlays = buildTopologyOverlay(nodes, frames, root, {
    showHidden: options.showHidden,
  })

  return { root, background, drawnCount, links, overlays, frames, warnings: [...warnings] }
}

/**
 * Put a node's whole draw-matrix shape onto its glyph: the floored own scale,
 * plus — for a Rod-topology node — the rod proportions and the cap offset.
 *
 * The frame already carries the raw own scale (and every ancestor's), so the
 * glyph's local transform is exactly what `node_world_matrix` adds on top of
 * that composition:
 *
 *   S_child = diag(own scale · base_scale, floored at 0.2) · rod factors
 *   pos    += M3[:, 2]          (rod only, ANTz kNPoffsetRod)
 *
 * Rod is the node's OWN topo — normally the field that governs where its
 * CHILDREN go, but the desktop reads it here too, drawing the glyph narrow
 * (0.25×) and long (5×) whatever geometry the row names. The cap offset then
 * slides the cylinder up its own rendered Z axis by half its drawn length, so
 * its BOTTOM sits at the node's world origin instead of its centre. In frame
 * coordinates that is (0, 0, glyph.scale.z): the frame's third basis column is
 * the rendered Z axis before the glyph's own scale, so the offset picks up
 * every ancestor's rotation and scale exactly as the desktop's M3[:, 2] does.
 *
 * A World Grid is excluded on both sides — its geometry is a plate or a globe
 * and its scale means extents, so rod factors would be meaningless there.
 * Grids take gridDrawScale instead and never reach this function.
 */
export function applyGlyphDrawScale(glyph: THREE.Object3D, node: GvNode): void {
  const x = drawScaleCorrection(node.scale.x)
  const y = drawScaleCorrection(node.scale.y)
  const z = drawScaleCorrection(node.scale.z)
  if (node.topo === Topo.Rod && node.type !== NodeType.WorldGrid) {
    glyph.scale.set(x * ROD_RADIUS_FACTOR, y * ROD_RADIUS_FACTOR, z * ROD_HEIGHT_FACTOR)
    glyph.position.set(0, 0, glyph.scale.z)
  } else {
    glyph.scale.set(x, y, z)
    // Reset, not skipped: the animation path reuses one glyph across frames,
    // and a node that stops being a rod must stop being offset.
    glyph.position.set(0, 0, 0)
  }
}

/**
 * Ratio to apply on the glyph so its drawn scale respects the floor.
 *
 * The floor is on the node's OWN scale × base_scale, applied exactly once —
 * `node_world_matrix`'s `S_child = diag(this node's own scale * base_scale,
 * floored at 0.2)`. It is NOT a floor on the accumulated world scale: an
 * ancestor chain keeps shrinking a descendant without limit, which is what
 * makes a hyperglyph pasted onto a small child render small. Flooring the
 * cumulative product instead (what this did until 2026-07-27) halts the shrink
 * at 0.2 and inflates every deeply nested glyph — visible as pasted children
 * overwhelming the parent they were pasted onto.
 *
 * Because the frame already carries the raw own scale, the glyph's job is only
 * to turn that into the floored one. Nothing about an ancestor enters here,
 * which is why the animation path re-derives it for a node whose OWN scale
 * changed and no longer walks descendants (src/render/dynamicNodes.ts).
 */
export function drawScaleCorrection(ownAxisScale: number): number {
  // A zero-scale axis leaves nothing to multiply back up: the desktop draws
  // such a node at the 0.2 floor, this draws it flat. Degenerate either way.
  if (Math.abs(ownAxisScale) < 1e-12) return 1
  return Math.max(ownAxisScale * BASE_SCALE, RENDER_SCALE_FLOOR) / ownAxisScale
}
