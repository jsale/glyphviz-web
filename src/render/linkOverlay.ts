// Link (type = 7) edge rendering, ported (behavior, not code) from the
// desktop viewport's _draw_topology_overlays link pass + _draw_link_prism
// (verified 2026-07-24). An edge runs from the A-end (parent_id) node's
// world position to the B-end (child_id) node's world position:
//
// - Any geometry except Textured Prism (28) → the classic line, pixel width
//   max(ratio·20, 1), in the link's color/alpha, unlit. Drawn with the
//   three.js fat-line addon because WebGL core lines are capped at 1 px —
//   LineMaterial needs the viewport resolution (setResolution). The
//   desktop's round end-cap dots are not reproduced (cosmetic).
// - Textured Prism (28) → a square-cross-section tube, half-width
//   max(ratio, 0.01) world units, built on an arbitrary-up basis around the
//   edge direction (reference +Z, or +X when near-vertical). Texture flow
//   (rotate_rate_z scrolling) waits on the textures step; until then the
//   tube renders in flat link color like the desktop's untextured path.
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

/**
 * All rendered link edges of one built scene, batched. Attach `group`
 * under the scene root (buildScene does), call `update()` once per frame
 * and `setResolution` on init/resize for correct line pixel widths.
 */
export class LinkOverlay {
  readonly group = new THREE.Group()
  private lineGroups: LineGroup[] = []
  private prismGroups: PrismGroup[] = []
  private edgeCount = 0
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
              prisms: Map<string, { edges: EdgeSpec[]; alpha: number }>) {
    this.group.name = 'link-overlay'
    const all: EdgeSpec[] = []
    for (const { edges, widthPx, alpha } of lines.values()) {
      const g = new LineGroup(edges, widthPx, alpha)
      this.lineGroups.push(g)
      this.group.add(g.object)
      this.edgeCount += edges.length
      all.push(...edges)
    }
    for (const { edges, alpha } of prisms.values()) {
      const g = new PrismGroup(edges, alpha)
      this.prismGroups.push(g)
      this.group.add(g.object)
      this.edgeCount += edges.length
      all.push(...edges)
    }
    // Prisms are pick targets on the same terms as lines: the desktop's pick
    // pass draws every link as a line whatever its geometry, so a tube is
    // clicked along its axis rather than on its silhouette.
    for (const edge of all) this.nodeIds.add(edge.nodeId)
    if (all.length > 0) this.group.add(new LinkPicker(all, this.resolution))
  }

  get count(): number {
    return this.edgeCount
  }

  /** Viewport size in device pixels — LineMaterial's screen-space widths. */
  setResolution(width: number, height: number): void {
    for (const g of this.lineGroups) g.material.resolution.set(width, height)
    // Same units for the picker: its tolerance is a pixel width too.
    this.resolution.set(width, height)
  }

  /**
   * Rewrite every edge from its endpoints' current matrixWorld. Callers own
   * the matrix state: the render loop relies on the renderer's own pass
   * (≤ 1 frame stale while dragging); tests/builders updateMatrixWorld
   * first.
   */
  update(): void {
    for (const g of this.lineGroups) g.update(this.va, this.vb)
    for (const g of this.prismGroups) {
      g.update(this.va, this.vb, this.vDir, this.vRight, this.vUp, this.vCorner)
    }
  }
}

/**
 * Collect the scene's renderable link edges into batched groups. `frames`
 * is the builder's id→frame map — endpoint resolution must never walk the
 * scene graph (getObjectByName is a full scan; at Org_Event_Network scale
 * that's minutes of load time). Skips, with a warning where the file is at
 * fault, links that are hidden, endpoint-less (either id 0, the desktop's
 * "pending" state), or dangling.
 */
export function buildLinkOverlay(
  nodes: GvNode[],
  frames: ReadonlyMap<number, THREE.Object3D>,
  root: THREE.Object3D,
  warn: (message: string) => void,
): LinkOverlay {
  const lines = new Map<string, { edges: EdgeSpec[]; widthPx: number; alpha: number }>()
  const prisms = new Map<string, { edges: EdgeSpec[]; alpha: number }>()

  for (const node of nodes) {
    if (node.type !== NodeType.Link || node.hide !== 0) continue
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
    }
    const alpha = node.color.a / 255
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

  const overlay = new LinkOverlay(lines, prisms)
  root.add(overlay.group)
  if (overlay.count > 0) {
    root.updateMatrixWorld(true) // once, so the first frame is exact
    overlay.update()
  }
  return overlay
}
