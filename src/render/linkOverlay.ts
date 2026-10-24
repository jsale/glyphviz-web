// Link (type = 7) edge rendering, ported (behavior, not code) from the
// desktop viewport's _draw_topology_overlays link pass + _draw_link_prism +
// _draw_link_glyph (verified 2026-07-24, glyph links added 2026-08-15 from
// desktop 21f400c). An edge runs from the A-end (parent_id) node's world
// position to the B-end (child_id) node's world position, in one of three
// modes chosen by `geometry` alone — so a link's look travels with the CSV and
// no new column appears:
//
// - Line (27) → the classic line, pixel width
//   max(ratio·20, 1), in the link's color/alpha, unlit. Drawn with the
//   three.js fat-line addon because WebGL core lines are capped at 1 px —
//   LineMaterial needs the viewport resolution (setResolution). The
//   desktop's round end-cap dots are not reproduced (cosmetic).
// - Textured Prism (28) → a square-cross-section tube, half-width
//   max(ratio, 0.01) world units, built on an arbitrary-up basis around the
//   edge direction (reference +Z, or +X when near-vertical). Texture flow
//   (rotate_rate_z scrolling) waits on the textures step; until then the
//   tube renders in flat link color like the desktop's untextured path.
// - ANY OTHER geometry → that glyph itself, stretched along the axis joining
//   the two ends (linkGeometry.ts owns the matrix): `ratio` is the thickness
//   on both cross-axes and the endpoint distance is the length. This is what
//   ANTz always did, and it is what makes an edge able to carry shape as well
//   as connection — a Composer level that links its objects to their parents
//   (glyphRecipe.ts) draws as a jointed limb rather than a hairline.
//   Point (22) stays line-drawn with the two line modes: a fixed-pixel sprite
//   has no extent to stretch, and that keeps the Org_Event_Network example's
//   6,400 Point edges rendering exactly as before. An id this app does not
//   render yet warns and draws nothing, the same answer buildScene gives for
//   an ordinary node carrying it (the desktop instead falls back to a sphere,
//   as it does for every unknown id anywhere).
//
// A glyph link is ONE Object3D each, where lines and prisms batch — the same
// trade the desktop makes ("performance is left to the author, deliberately: a
// scene of solid glyph links draws that many glyphs, and Line is still one
// keystroke away"). Its matrix is rewritten per frame from its endpoints, like
// every other edge here.
//
// Built for scale (the Org_Event_Network example carries 6,400 links in a
// 65k-node scene, which the first per-link-object version took minutes to
// load): endpoints resolve through the builder's id→frame map (never
// getObjectByName — that's a full scene-graph scan per call), edges batch
// into one LineSegments2 per (width, alpha) group and one merged mesh per
// prism alpha group with per-vertex colors, and update() writes endpoint
// positions into preallocated GPU buffers with no allocation. update()
// deliberately does NOT force a matrix recompute of the tree — it reads
// the matrixWorld state of the renderer's own per-frame pass, at most one
// frame stale, and only while something is actually moving.
//
// A link a CHANNEL drives is the exception to the batching (LiveLink, below).
// The desktop reads every link's hide, colour, alpha, ratio and geometry fresh
// each frame, in its draw pass and its pick pass alike — but a batch bakes
// width and alpha into a shared material and leaves a hidden link out
// altogether. So a bound link is built whatever its CSV hide says, gets a draw
// object of its own, and has those fields re-applied every frame; a change of
// geometry (or of anything else the object's SHAPE is built from) rebuilds that
// one link. That costs a draw call per bound link, which is the desktop's own
// per-link cost, and nothing at all for the links no channel touches.
//
// The drawn edges themselves are not raycast targets (they are batched, and
// a fat line's screen width has nothing to do with its geometry) — instead
// one invisible picker object per scene runs a ray-to-segment test over every
// edge, which is the web equivalent of the desktop pick pass drawing each
// link as a thick line (viewport.py _render_pick_scene). A hidden link draws
// nothing and picks nothing.

import * as THREE from 'three'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import type { GvNode } from '../gv/types'
import { Geometry, NodeType } from '../gv/types'
import { linkChildId } from '../gv/links'
import { createGlyphObject, createPickProxy } from './glyphGeometry'
import { isGlyphLink, linkGlyphMatrix, localZSpan } from './linkGeometry'
import { SELECTION_BOX_HALF } from './picking'
import { RATIO_SHAPED_GEOMETRIES, quantizedShapeRatio } from './glyphGeometry'
import {
  applyGlyphAppearance,
  privatiseGlyphMaterials,
  type PrivateMaterials,
} from './glyphAppearance'
import { setNaturalTransparency } from './renderMode'

const MIN_PRISM_RADIUS = 0.01
const EPS = 1e-6

/**
 * Floor on the pick width in pixels, desktop `max(node.ratio * 20.0, 5.0)`:
 * the pick pass draws links FIVE times fatter than the 1px draw floor, so a
 * hair-thin edge is still clickable without having to hit it exactly.
 */
const MIN_PICK_WIDTH_PX = 5

interface EdgeSpec {
  /** The link row this edge belongs to — what a pick on it selects. */
  nodeId: number
  aFrame: THREE.Object3D
  bFrame: THREE.Object3D
  color: THREE.Color
  /** Prisms only: tube half-width in world units. */
  radius: number
  /** Click tolerance around the edge, in device pixels. */
  pickWidthPx: number
  /**
   * Channel-hidden right now. Only a LiveLink ever sets it: a CSV-hidden link
   * that no channel touches is simply never built. The picker skips it, as the
   * desktop's pick pass skips a hidden link.
   */
  hidden: boolean
}

/** One batched LineSegments2 for every line link sharing (width, alpha). */
class LineGroup {
  readonly edges: EdgeSpec[]
  readonly material: LineMaterial
  readonly object: LineSegments2
  private positions: THREE.InstancedInterleavedBuffer

  constructor(edges: EdgeSpec[], widthPx: number, alpha: number) {
    this.edges = edges
    const geometry = new LineSegmentsGeometry()
    geometry.setPositions(new Array(edges.length * 6).fill(0))
    const colors: number[] = []
    for (const e of edges) colors.push(e.color.r, e.color.g, e.color.b, e.color.r, e.color.g, e.color.b)
    geometry.setColors(colors)
    this.material = new LineMaterial({
      vertexColors: true,
      linewidth: widthPx,
      transparent: alpha < 1,
      opacity: alpha,
      // ShaderMaterial defaults fog OFF where the built-in materials default
      // it on; edges are scene content, so they fade with the glyphs they
      // connect (render/fog.ts).
      fog: true,
    })
    this.object = new LineSegments2(geometry, this.material)
    this.object.name = 'link-lines'
    this.object.raycast = () => {} // never pickable
    // Endpoints move every frame; skip per-frame bounds maintenance.
    this.object.frustumCulled = false
    this.positions = (geometry.attributes.instanceStart as THREE.InterleavedBufferAttribute)
      .data as THREE.InstancedInterleavedBuffer
    this.positions.setUsage(THREE.DynamicDrawUsage)
  }

  update(a: THREE.Vector3, b: THREE.Vector3): void {
    const arr = this.positions.array as Float32Array
    for (let i = 0; i < this.edges.length; i++) {
      const e = this.edges[i]
      a.setFromMatrixPosition(e.aFrame.matrixWorld)
      b.setFromMatrixPosition(e.bFrame.matrixWorld)
      const o = i * 6
      arr[o] = a.x
      arr[o + 1] = a.y
      arr[o + 2] = a.z
      arr[o + 3] = b.x
      arr[o + 4] = b.y
      arr[o + 5] = b.z
    }
    this.positions.needsUpdate = true
  }

  /** Recolour edge `index` in place — both ends, since a link is one colour. */
  writeColor(index: number, color: THREE.Color): void {
    const attr = this.object.geometry.attributes.instanceColorStart as THREE.InterleavedBufferAttribute
    const arr = attr.data.array as Float32Array
    const o = index * 6
    arr[o] = arr[o + 3] = color.r
    arr[o + 1] = arr[o + 4] = color.g
    arr[o + 2] = arr[o + 5] = color.b
    attr.data.needsUpdate = true
  }

  dispose(): void {
    this.object.geometry.dispose()
    this.material.dispose()
  }
}

/** One merged mesh for every prism link sharing an alpha: 8 verts + 4 quad
 *  side faces per edge, per-vertex colors, dynamic positions. */
class PrismGroup {
  readonly edges: EdgeSpec[]
  readonly object: THREE.Mesh
  private positions: THREE.BufferAttribute

  constructor(edges: EdgeSpec[], alpha: number) {
    this.edges = edges
    const geometry = new THREE.BufferGeometry()
    this.positions = new THREE.BufferAttribute(new Float32Array(edges.length * 8 * 3), 3)
    this.positions.setUsage(THREE.DynamicDrawUsage)
    geometry.setAttribute('position', this.positions)
    const colors = new Float32Array(edges.length * 8 * 3)
    const index: number[] = []
    for (let n = 0; n < edges.length; n++) {
      const c = edges[n].color
      for (let v = 0; v < 8; v++) {
        colors[(n * 8 + v) * 3] = c.r
        colors[(n * 8 + v) * 3 + 1] = c.g
        colors[(n * 8 + v) * 3 + 2] = c.b
      }
      const base = n * 8
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4
        index.push(base + i, base + j, base + 4 + j, base + i, base + 4 + j, base + 4 + i)
      }
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geometry.setIndex(index)
    // DoubleSide spares us the desktop's hand-derived winding (which
    // shipped inverted once).
    this.object = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: alpha < 1,
        opacity: alpha,
        side: THREE.DoubleSide,
      }),
    )
    this.object.name = 'link-prisms'
    this.object.raycast = () => {} // never pickable
    this.object.frustumCulled = false
  }

  update(
    a: THREE.Vector3,
    b: THREE.Vector3,
    dir: THREE.Vector3,
    right: THREE.Vector3,
    up: THREE.Vector3,
    corner: THREE.Vector3,
  ): void {
    const arr = this.positions.array as Float32Array
    for (let n = 0; n < this.edges.length; n++) {
      const e = this.edges[n]
      a.setFromMatrixPosition(e.aFrame.matrixWorld)
      b.setFromMatrixPosition(e.bFrame.matrixWorld)
      dir.subVectors(b, a)
      const length = dir.length()
      const base = n * 8 * 3
      if (length < EPS) {
        // Degenerate edge: collapse every face to a point (draws nothing).
        for (let v = 0; v < 8; v++) {
          arr[base + v * 3] = a.x
          arr[base + v * 3 + 1] = a.y
          arr[base + v * 3 + 2] = a.z
        }
        continue
      }
      dir.divideScalar(length)
      // Arbitrary-up basis: cross with a reference axis not (near-)
      // parallel to the direction, then cross again (desktop's trick).
      right.crossVectors(dir, Math.abs(dir.z) < 0.99 ? UNIT_Z : UNIT_X).normalize()
      up.crossVectors(right, dir)
      for (let i = 0; i < 4; i++) {
        const [s, t] = PRISM_RING[i]
        corner
          .copy(right)
          .multiplyScalar(s * e.radius)
          .addScaledVector(up, t * e.radius)
        arr[base + i * 3] = a.x + corner.x
        arr[base + i * 3 + 1] = a.y + corner.y
        arr[base + i * 3 + 2] = a.z + corner.z
        arr[base + (4 + i) * 3] = b.x + corner.x
        arr[base + (4 + i) * 3 + 1] = b.y + corner.y
        arr[base + (4 + i) * 3 + 2] = b.z + corner.z
      }
    }
    this.positions.needsUpdate = true
  }

  get material(): THREE.MeshBasicMaterial {
    return this.object.material as THREE.MeshBasicMaterial
  }

  /** Recolour edge `n`'s eight vertices in place. */
  writeColor(n: number, color: THREE.Color): void {
    const attr = this.object.geometry.getAttribute('color') as THREE.BufferAttribute
    const arr = attr.array as Float32Array
    for (let v = 0; v < 8; v++) {
      const o = (n * 8 + v) * 3
      arr[o] = color.r
      arr[o + 1] = color.g
      arr[o + 2] = color.b
    }
    attr.needsUpdate = true
  }

  dispose(): void {
    this.object.geometry.dispose()
    this.material.dispose()
  }
}

/**
 * One link drawn as its own geometry, stretched between its two ends
 * (`linkGeometry.ts`). Unlike the batched lines and prisms this is a real
 * Object3D — it has to be, since it draws a lit, textured, indexed glyph — so
 * it is also pick-solid across its whole body and can carry a selection halo,
 * both of which the geometry-cycling workflow (O / Shift+O on a link) needs.
 */
class GlyphLink {
  readonly spec: EdgeSpec
  readonly object: THREE.Object3D
  private readonly geometry: number
  /** Cross-axis thickness, desktop `max(node.ratio, 1e-4)` — NOT the prism's
   *  0.01 floor, which exists to keep a tube from collapsing to a line.
   *  Rewritten per frame for a channel-bound link (LiveLink). */
  ratio: number

  constructor(spec: EdgeSpec, node: GvNode, object: THREE.Object3D) {
    this.spec = spec
    this.object = object
    this.geometry = node.geometry
    this.ratio = Math.max(node.ratio, 1e-4)
    object.name = 'link-glyph'
    // The matrix comes from the two endpoints, never from position/quaternion.
    object.matrixAutoUpdate = false
    // pickNodeId walks a pick proxy up to the nearest ancestor carrying a
    // nodeId, so this stands in for the frame an ordinary glyph hangs under —
    // a glyph link lives in world space here, not under the link's own frame.
    object.userData.nodeId = node.id
    object.userData.isGlyph = true
    // The selection halo's z bounds. A glyph's local z span is mapped onto the
    // edge and is not always symmetric (a Pin's runs 0…1.1), so the box cannot
    // be the usual ±1.05 cube; the padding is that same 5% of the span.
    const [zMin, zMax] = localZSpan(node.geometry)
    const pad = ((zMax - zMin) * (SELECTION_BOX_HALF - 1)) / 2
    object.userData.haloZ = [zMin - pad, zMax + pad]
  }

  /** True when the edge drew (a zero-length one has no axis to orient along). */
  update(a: THREE.Vector3, b: THREE.Vector3): boolean {
    a.setFromMatrixPosition(this.spec.aFrame.matrixWorld)
    b.setFromMatrixPosition(this.spec.bFrame.matrixWorld)
    const m = linkGlyphMatrix([a.x, a.y, a.z], [b.x, b.y, b.z], this.ratio, this.geometry)
    // pickNodeId reads this flag too, so a channel-hidden glyph link is as
    // unclickable as a CSV-hidden one.
    this.object.visible = m !== null && !this.spec.hidden
    if (m === null) return false
    this.object.matrix.fromArray(m)
    // Forced rather than flagged: the halo pass and the raycaster both read
    // matrixWorld in the same frame this runs, and a flag would only be
    // consumed by the renderer's next traversal.
    this.object.updateMatrixWorld(true)
    return true
  }
}

// Ring order stepping consistently around the square: ++, +−, −−, −+.
const PRISM_RING: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [1, -1],
  [-1, -1],
  [-1, 1],
]
const UNIT_Z = new THREE.Vector3(0, 0, 1)
const UNIT_X = new THREE.Vector3(1, 0, 0)

/**
 * Invisible ray-to-segment pick target covering every edge in the scene.
 *
 * The desktop draws each link into its pick FBO as a thick line and lets the
 * depth buffer resolve it against the glyphs; here the glyphs are picked by
 * three's raycaster, so links join that same sorted intersection list instead
 * — the nearest hit still wins, and a solid World Grid still occludes.
 *
 * The pick width is a SCREEN width (the desktop's `max(ratio·20, 5)` pixels),
 * so the world-space tolerance is re-derived at the depth of each candidate:
 * a distant edge that reads as a few pixels on screen must be clickable at
 * those few pixels, not at the world size it would have up close.
 */
class LinkPicker extends THREE.Object3D {
  /** Parallel to the intersections' faceIndex: which link row each edge is. */
  readonly linkIds: number[]

  private edges: EdgeSpec[]
  private resolution: THREE.Vector2
  private a = new THREE.Vector3()
  private b = new THREE.Vector3()
  private onRay = new THREE.Vector3()
  private onSegment = new THREE.Vector3()

  constructor(edges: EdgeSpec[], resolution: THREE.Vector2) {
    super()
    this.name = 'link-picker'
    this.edges = edges
    this.resolution = resolution
    this.linkIds = edges.map((e) => e.nodeId)
    // Read back through userData so pickNodeId stays a plain scene-graph
    // walk, with no import of this class.
    this.userData.isLinkPicker = true
    this.userData.linkIds = this.linkIds
  }

  override raycast(raycaster: THREE.Raycaster, intersects: THREE.Intersection[]): void {
    const camera = raycaster.camera as THREE.PerspectiveCamera | undefined
    // No camera (or a viewport that has never been sized) means no screen to
    // measure the pick width against, so there is nothing sensible to hit.
    if (!camera?.isPerspectiveCamera || this.resolution.y === 0) return
    const worldPerPixelAtUnitDepth =
      (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5))) / this.resolution.y

    const ray = raycaster.ray
    for (let i = 0; i < this.edges.length; i++) {
      const edge = this.edges[i]
      if (edge.hidden) continue
      this.a.setFromMatrixPosition(edge.aFrame.matrixWorld)
      this.b.setFromMatrixPosition(edge.bFrame.matrixWorld)
      ray.distanceSqToSegment(this.a, this.b, this.onRay, this.onSegment)
      const distance = ray.origin.distanceTo(this.onRay)
      const halfWidth = 0.5 * edge.pickWidthPx * worldPerPixelAtUnitDepth * distance
      if (this.onRay.distanceTo(this.onSegment) > halfWidth) continue
      intersects.push({
        distance,
        point: this.onSegment.clone(),
        object: this,
        faceIndex: i,
      })
    }
  }
}


/** Which of the three draw modes a link geometry selects. */
type LinkKind = 'line' | 'prism' | 'glyph'

function linkKind(geometry: number): LinkKind {
  if (isGlyphLink(geometry)) return 'glyph'
  return geometry === Geometry.TexturedPrism ? 'prism' : 'line'
}

/**
 * Everything a link's draw OBJECT is built from; a change to it means a new
 * object rather than a write onto the old one. The mode, and for a glyph link
 * its geometry, its model, and — for the shapes whose tessellation `ratio`
 * decides (torus, flat ring) — the quantized ratio, the same key DynamicNodes
 * swaps an ordinary glyph on. Thickness alone is never in it: that is a scale
 * on the matrix, a line width or a tube radius, all writable in place.
 */
function linkShapeKey(node: GvNode): string {
  const kind = linkKind(node.geometry)
  if (kind !== 'glyph') return kind
  const mesh = node.geometry === Geometry.Mesh ? node.meshId : 0
  const ratio = RATIO_SHAPED_GEOMETRIES.has(node.geometry) ? quantizedShapeRatio(node.ratio) : 0
  return `glyph:${node.geometry}:${mesh}:${ratio}`
}

/** What a stretched glyph link draws with, when the scene has any. */
export interface LinkAssets {
  textures?: ReadonlyMap<number, THREE.Texture>
  meshes?: ReadonlyMap<number, THREE.BufferGeometry>
}

/**
 * The stretched glyph for a glyph-geometry link, with its pick proxy, or null
 * for a geometry id this app does not render.
 */
function createLinkGlyph(node: GvNode, spec: EdgeSpec, assets: LinkAssets): GlyphLink | null {
  const mesh = node.geometry === Geometry.Mesh ? assets.meshes?.get(node.meshId) : undefined
  const object = createGlyphObject(node.geometry, {
    color: spec.color,
    opacity: node.color.a / 255,
    // A torus link reads `ratio` as its tube proportion, the same field the
    // matrix uses as thickness — the desktop passes it to both too.
    ratio: node.ratio,
    map: node.textureId > 0 ? assets.textures?.get(node.textureId) : undefined,
    mesh,
  })
  if (!object) return null
  // Pick-solid across the whole body, where a line link is only clickable
  // near its centre line (desktop `_draw_link_pick_targets`). Wire ids swap
  // to their solid equivalent inside createPickProxy, as everywhere else.
  const proxy = createPickProxy(node.geometry, mesh, node.ratio)
  if (proxy) object.add(proxy)
  return new GlyphLink(spec, node, object)
}

/**
 * One channel-bound link: its own draw object, re-read from its row each frame.
 *
 * The row is the live one the Channels engine writes into, so nothing has to
 * be handed over per frame — `refresh` just looks. Values are compared against
 * the last ones written, so a bound link standing still costs a few compares
 * and uploads nothing.
 */
class LiveLink {
  readonly node: GvNode
  readonly spec: EdgeSpec
  line: LineGroup | null = null
  prism: PrismGroup | null = null
  glyph: GlyphLink | null = null
  /** Private material clones of a glyph link (the cache's are shared). */
  private owned: PrivateMaterials | null = null
  private shapeKey = ''
  // Last values written; NaN forces the first refresh to write everything.
  private r = NaN
  private g = NaN
  private b = NaN
  private a = NaN
  private ratio = NaN
  private textureId = NaN

  constructor(node: GvNode, spec: EdgeSpec) {
    this.node = node
    this.spec = spec
  }

  get object(): THREE.Object3D | null {
    return this.line?.object ?? this.prism?.object ?? this.glyph?.object ?? null
  }

  /** True once the row asks for a different kind of object than the one built. */
  get shapeChanged(): boolean {
    return linkShapeKey(this.node) !== this.shapeKey
  }

  /** Build the draw object the row currently asks for; null if it draws none. */
  mount(assets: LinkAssets, resolution: THREE.Vector2): THREE.Object3D | null {
    const node = this.node
    this.shapeKey = linkShapeKey(node)
    this.r = this.g = this.b = this.a = this.ratio = this.textureId = NaN
    const alpha = node.color.a / 255
    const kind = linkKind(node.geometry)
    if (kind === 'glyph') {
      this.glyph = createLinkGlyph(node, this.spec, assets)
      if (this.glyph) this.owned = privatiseGlyphMaterials(this.glyph.object)
    } else if (kind === 'prism') {
      this.prism = new PrismGroup([this.spec], alpha)
    } else {
      this.line = new LineGroup([this.spec], Math.max(node.ratio * 20, 1), alpha)
      this.line.material.resolution.copy(resolution)
    }
    return this.object
  }

  /** Detach and free the current object; the shared cache's pieces are left. */
  unmount(): void {
    this.object?.removeFromParent()
    this.line?.dispose()
    this.prism?.dispose()
    for (const material of this.owned?.materials ?? []) material.dispose()
    this.line = null
    this.prism = null
    this.glyph = null
    this.owned = null
  }

  /** Re-apply hide, colour, alpha, thickness and texture from the row. */
  refresh(showHidden: boolean, textures: ReadonlyMap<number, THREE.Texture>): void {
    const node = this.node
    const spec = this.spec
    const hidden = !showHidden && node.hide !== 0
    spec.hidden = hidden
    // A glyph link sets its own visibility in update(), where a degenerate
    // edge also has to hide it.
    if (this.line) this.line.object.visible = !hidden
    if (this.prism) this.prism.object.visible = !hidden

    const { r, g, b, a } = node.color
    const colorChanged = r !== this.r || g !== this.g || b !== this.b
    const alphaChanged = a !== this.a
    if (colorChanged) spec.color.setRGB(r / 255, g / 255, b / 255)
    if (this.glyph && this.owned) {
      if (colorChanged || alphaChanged || node.textureId !== this.textureId) {
        applyGlyphAppearance(this.owned, node, textures)
      }
    } else {
      const group = this.line ?? this.prism
      if (group && colorChanged) group.writeColor(0, spec.color)
      if (group && alphaChanged) {
        const material = group.material
        material.opacity = a / 255
        setNaturalTransparency(material, a < 255)
      }
    }
    this.r = r
    this.g = g
    this.b = b
    this.a = a
    this.textureId = node.textureId

    if (node.ratio !== this.ratio) {
      this.ratio = node.ratio
      // The same three rules buildLinkOverlay applies, one per mode.
      spec.radius = Math.max(node.ratio, MIN_PRISM_RADIUS)
      spec.pickWidthPx = Math.max(node.ratio * 20, MIN_PICK_WIDTH_PX)
      if (this.line) this.line.material.linewidth = Math.max(node.ratio * 20, 1)
      if (this.glyph) this.glyph.ratio = Math.max(node.ratio, 1e-4)
    }
  }

  update(
    a: THREE.Vector3,
    b: THREE.Vector3,
    dir: THREE.Vector3,
    right: THREE.Vector3,
    up: THREE.Vector3,
    corner: THREE.Vector3,
  ): void {
    this.line?.update(a, b)
    this.prism?.update(a, b, dir, right, up, corner)
    this.glyph?.update(a, b)
  }
}

/**
 * All rendered link edges of one built scene, batched. Attach `group`
 * under the scene root (buildScene does), call `update()` once per frame
 * and `setResolution` on init/resize for correct line pixel widths.
 */
export class LinkOverlay {
  readonly group = new THREE.Group()
  private lineGroups: LineGroup[] = []
  private prismGroups: PrismGroup[] = []
  private glyphLinks: GlyphLink[] = []
  private liveLinks: LiveLink[] = []
  private edgeCount = 0
  private showHidden: boolean
  private assets: LinkAssets
  private warn: (message: string) => void
  /**
   * Link id → the stretched glyph drawn for it, for the selection halo. An
   * ordinary node's halo is found through its frame's glyph child; a glyph
   * link's lives in this overlay instead, because its transform comes from two
   * other nodes rather than from its own frame. Kept current in place when a
   * channel-bound link is rebuilt — the selection holds this very map.
   */
  readonly glyphObjects = new Map<number, THREE.Object3D>()
  /** Shared with the picker, which needs the viewport size for pixel widths. */
  private resolution = new THREE.Vector2()
  /** Link rows that produced a drawn (and therefore pickable) edge. */
  readonly nodeIds = new Set<number>()
  // Scratch vectors so update() never allocates.
  private va = new THREE.Vector3()
  private vb = new THREE.Vector3()
  private vDir = new THREE.Vector3()
  private vRight = new THREE.Vector3()
  private vUp = new THREE.Vector3()
  private vCorner = new THREE.Vector3()

  constructor(lines: Map<string, { edges: EdgeSpec[]; widthPx: number; alpha: number }>,
              prisms: Map<string, { edges: EdgeSpec[]; alpha: number }>,
              glyphs: GlyphLink[] = [],
              live: LiveLink[] = [],
              options: {
                showHidden?: boolean
                assets?: LinkAssets
                warn?: (message: string) => void
              } = {}) {
    this.group.name = 'link-overlay'
    this.showHidden = options.showHidden === true
    this.warn = options.warn ?? (() => {})
    this.assets = options.assets ?? {}
    const all: EdgeSpec[] = []
    for (const { edges, widthPx, alpha } of lines.values()) {
      const g = new LineGroup(edges, widthPx, alpha)
      this.lineGroups.push(g)
      this.group.add(g.object)
      this.edgeCount += edges.length
      for (const edge of edges) all.push(edge)
    }
    for (const { edges, alpha } of prisms.values()) {
      const g = new PrismGroup(edges, alpha)
      this.prismGroups.push(g)
      this.group.add(g.object)
      this.edgeCount += edges.length
      for (const edge of edges) all.push(edge)
    }
    for (const glyph of glyphs) {
      this.glyphLinks.push(glyph)
      this.group.add(glyph.object)
      this.glyphObjects.set(glyph.spec.nodeId, glyph.object)
      this.edgeCount++
      all.push(glyph.spec)
    }
    for (const link of live) {
      this.liveLinks.push(link)
      this.mount(link)
      this.edgeCount++
      all.push(link.spec)
    }
    // Prisms are pick targets on the same terms as lines: the desktop's pick
    // pass draws every link as a line whatever its geometry, so a tube is
    // clicked along its axis rather than on its silhouette. A glyph link keeps
    // that centre-line target AND gets its own solid proxy, exactly as the
    // desktop's pick pass draws both.
    for (const edge of all) this.nodeIds.add(edge.nodeId)
    if (all.length > 0) this.group.add(new LinkPicker(all, this.resolution))
  }

  get count(): number {
    return this.edgeCount
  }

  /** Channel-bound links, each drawn on its own — for tests and the drive. */
  get liveCount(): number {
    return this.liveLinks.length
  }

  /** Viewport size in device pixels — LineMaterial's screen-space widths. */
  setResolution(width: number, height: number): void {
    for (const g of this.lineGroups) g.material.resolution.set(width, height)
    for (const link of this.liveLinks) link.line?.material.resolution.set(width, height)
    // Same units for the picker: its tolerance is a pixel width too.
    this.resolution.set(width, height)
  }

  /**
   * Rewrite every edge from its endpoints' current matrixWorld, after
   * re-reading each channel-bound link's row. Callers own the matrix state:
   * the render loop relies on the renderer's own pass (≤ 1 frame stale while
   * dragging); tests/builders updateMatrixWorld first.
   *
   * Returns true when a bound link's draw object was REBUILT this frame (its
   * geometry changed). Its fresh materials know nothing of a non-Normal render
   * mode, and a selection halo may still hold the old object — both of which
   * the caller owns.
   */
  update(): boolean {
    let rebuilt = false
    for (const link of this.liveLinks) {
      if (link.shapeChanged) {
        link.unmount()
        this.glyphObjects.delete(link.spec.nodeId)
        this.mount(link)
        rebuilt = true
      }
      link.refresh(this.showHidden, this.assets.textures ?? NO_TEXTURES)
    }
    for (const g of this.lineGroups) g.update(this.va, this.vb)
    for (const g of this.prismGroups) {
      g.update(this.va, this.vb, this.vDir, this.vRight, this.vUp, this.vCorner)
    }
    for (const g of this.glyphLinks) g.update(this.va, this.vb)
    for (const link of this.liveLinks) {
      link.update(this.va, this.vb, this.vDir, this.vRight, this.vUp, this.vCorner)
    }
    return rebuilt
  }

  /**
   * Free what this overlay owns: its batches, and the private materials of its
   * channel-bound glyph links. Glyph geometries and the materials of unbound
   * glyph links belong to glyphGeometry's caches and are left alone.
   */
  dispose(): void {
    this.group.removeFromParent()
    for (const g of this.lineGroups) g.dispose()
    for (const g of this.prismGroups) g.dispose()
    for (const link of this.liveLinks) link.unmount()
    this.lineGroups = []
    this.prismGroups = []
    this.glyphLinks = []
    this.liveLinks = []
    this.glyphObjects.clear()
  }

  private mount(link: LiveLink): void {
    const object = link.mount(this.assets, this.resolution)
    if (!object) {
      // Only a glyph link can fail to build: an id this app has no shape for.
      const { id, geometry } = link.node
      this.warn(`Geometry id ${geometry} is not rendered yet (link node ${id}).`)
      return
    }
    this.group.add(object)
    if (link.glyph) this.glyphObjects.set(link.spec.nodeId, object)
  }
}

const NO_TEXTURES: ReadonlyMap<number, THREE.Texture> = new Map()

export interface LinkOverlayOptions extends LinkAssets {
  /** Desktop "Show Hidden Nodes": draw hidden links too. */
  showHidden?: boolean
  /**
   * Links an animation can change (BuildSceneOptions.liveNodeIds): built
   * whatever their CSV hide says, each on its own draw object, re-read per frame.
   */
  live?: ReadonlySet<number>
}

/**
 * Collect the scene's renderable link edges into batched groups. `frames`
 * is the builder's id→frame map — endpoint resolution must never walk the
 * scene graph (getObjectByName is a full scan; at Org_Event_Network scale
 * that's minutes of load time). Skips, with a warning where the file is at
 * fault, links that are hidden (unless shown or channel-bound), endpoint-less
 * (either id 0, the desktop's "pending" state), or dangling.
 */
export function buildLinkOverlay(
  nodes: GvNode[],
  frames: ReadonlyMap<number, THREE.Object3D>,
  root: THREE.Object3D,
  warn: (message: string) => void,
  options: LinkOverlayOptions = {},
): LinkOverlay {
  const lines = new Map<string, { edges: EdgeSpec[]; widthPx: number; alpha: number }>()
  const prisms = new Map<string, { edges: EdgeSpec[]; alpha: number }>()
  const glyphs: GlyphLink[] = []
  const live: LiveLink[] = []
  const showHidden = options.showHidden === true

  for (const node of nodes) {
    if (node.type !== NodeType.Link) continue
    const bound = options.live?.has(node.id) === true
    if (node.hide !== 0 && !showHidden && !bound) continue
    const aId = node.parentId
    const bId = linkChildId(node)
    if (!aId || !bId) {
      warn(`Link node ${node.id}: missing A-end (parent_id) or B-end (child_id); edge not drawn.`)
      continue
    }
    const aFrame = frames.get(aId)
    const bFrame = frames.get(bId)
    if (!aFrame || !bFrame) {
      warn(`Link node ${node.id}: endpoint node ${aFrame ? bId : aId} not found; edge not drawn.`)
      continue
    }
    const spec: EdgeSpec = {
      nodeId: node.id,
      aFrame,
      bFrame,
      color: new THREE.Color(node.color.r / 255, node.color.g / 255, node.color.b / 255),
      radius: Math.max(node.ratio, MIN_PRISM_RADIUS),
      pickWidthPx: Math.max(node.ratio * 20, MIN_PICK_WIDTH_PX),
      hidden: false,
    }
    if (bound) {
      live.push(new LiveLink(node, spec))
      continue
    }
    const alpha = node.color.a / 255
    if (isGlyphLink(node.geometry)) {
      const glyph = createLinkGlyph(node, spec, options)
      if (!glyph) {
        warn(`Geometry id ${node.geometry} is not rendered yet (link node ${node.id}).`)
        continue
      }
      glyphs.push(glyph)
      continue
    }
    if (node.geometry === Geometry.TexturedPrism) {
      const key = alpha.toFixed(6)
      let g = prisms.get(key)
      if (!g) {
        g = { edges: [], alpha }
        prisms.set(key, g)
      }
      g.edges.push(spec)
    } else {
      const widthPx = Math.max(node.ratio * 20, 1) // pixels, desktop convention
      const key = `${widthPx.toFixed(4)}:${alpha.toFixed(6)}`
      let g = lines.get(key)
      if (!g) {
        g = { edges: [], widthPx, alpha }
        lines.set(key, g)
      }
      g.edges.push(spec)
    }
  }

  const overlay = new LinkOverlay(lines, prisms, glyphs, live, {
    showHidden,
    warn,
    assets: { textures: options.textures, meshes: options.meshes },
  })
  root.add(overlay.group)
  if (overlay.count > 0) {
    root.updateMatrixWorld(true) // once, so the first frame is exact
    // Also applies every bound link's row, so a CSV-hidden one never flashes.
    overlay.update()
  }
  return overlay
}
