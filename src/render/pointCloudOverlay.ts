// Point Cloud topology (Topo.PointCloud, 18) — the rendering half.
//
// A cloud parent's children draw as ONE `THREE.Points` instead of a glyph
// apiece, which is the desktop's own treatment (one `glDrawArrays(GL_POINTS)`,
// ANTz npgldraw.c:391) and the reason the topology exists at all. Measured
// there: 100k coloured points replay in 0.10 ms/frame and 1M in 0.63 ms.
//
// Structurally this is `linkOverlay.ts` and `topologyOverlay.ts` again, and
// deliberately so — attach `group` under the scene root, call `update()` once
// per frame, `setResolution` on resize — with the same trade those two make:
// vertices are WORLD space, written from the parent frame's `matrixWorld`, so
// they are rewritten when something moves and cost nothing when nothing does.
//
// What is NOT like those two is the reason it exists: a Plot parent's children
// still draw their own glyphs and the polyline is laid over them, whereas a
// cloud REPLACES its children's rendering. Their frames are never built (see
// buildScene's `cloudPoints` skip), because at these counts the Object3Ds are
// the cost — 629k of them measured at 93.8 ms/frame of matrix recomposition
// before a triangle is drawn (roadmap 6m). A point is a vertex here, exactly as
// it is there.
//
// Every point is still a real node: pickable (CloudPicker below), selectable,
// labellable, savable and Channels-bindable. Only the drawing is pooled.

import * as THREE from 'three'
import {
  cloudColors,
  cloudParentIds,
  drawableChildren,
  hasTranslucentPoints,
  isCloudParent,
  pointSize,
} from '../gv/pointCloud'
import type { CloudBatch } from '../gv/pointCloud'
import type { GvNode } from '../gv/types'
import { drawScaleCorrection } from './baseScale'
import { framePosition } from './framePlacement'
import { patchPointSprite } from './pointSprite'

/**
 * The desktop's pick pass draws a cloud's points at exactly the size the
 * visible pass draws them — its stated invariant, and the one the link picking
 * bug came down to: a fatter pick point lets a cloud steal clicks from glyphs
 * its visible form does not cover. This app has no second pass to keep honest,
 * so the same rule is expressed as the tolerance below, in the same pixels.
 *
 * The floor exists because a 2 px point (the default) is a hard target for a
 * mouse. It is the desktop's own link-pick floor, for the same reason.
 */
const MIN_PICK_WIDTH_PX = 5

/** Element-wise equality of two 4x4s, for the "has the parent moved?" test. */
function matrixEquals(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  for (let i = 0; i < 16; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/** One cloud parent's drawn points. */
class CloudGroup {
  readonly object: THREE.Points
  readonly parentId: number
  /** Node id per point, parallel to the position buffer. */
  readonly ids: Int32Array
  /** Points whose position must be rewritten from the parent's matrixWorld. */
  private readonly local: Float32Array
  private readonly positions: THREE.BufferAttribute
  readonly pointSizePx: number
  /** The frame the whole cloud hangs from — its matrixWorld places every point. */
  private readonly parentFrame: THREE.Object3D
  private readonly matrix = new THREE.Matrix4()

  /**
   * Each point's RAW authored scale, 3 per point — the selection halo's size,
   * and the only thing a point's `scale_*` columns are read for.
   *
   * Raw rather than rendered, so the box follows the Global Scale slider and
   * the minimum-size toggle without a rebuild: `drawScaleCorrection` is applied
   * at refresh time, where those two are live.
   */
  private readonly scales: Float32Array
  /** The cloud parent's row, for re-placing an animated point. */
  private readonly parent: GvNode
  /** The point rows, in batch order — read only for the live ones below. */
  private readonly nodes: readonly GvNode[]
  /**
   * Batch indices of the points a channel or a rate can move. Empty for every
   * ordinary cloud, which is what keeps `update` a pure matrix multiply.
   */
  private live: number[]
  /** The build-time live set, which `setLive` unions its argument into. */
  private readonly baseLive: readonly number[]
  /** The parent matrixWorld the buffer was last written from — the move test. */
  private readonly lastMatrix = new Float64Array(16)
  private written = false

  constructor(
    parent: GvNode,
    parentFrame: THREE.Object3D,
    children: readonly GvNode[],
    ids: Int32Array,
    local: Float32Array,
    live: number[],
  ) {
    this.parentId = parent.id
    this.parent = parent
    this.parentFrame = parentFrame
    this.nodes = children
    this.live = live
    this.baseLive = live
    this.ids = ids
    this.local = local
    this.pointSizePx = pointSize(parent)
    this.scales = new Float32Array(children.length * 3)
    for (let i = 0; i < children.length; i++) {
      const s = children[i].scale
      this.scales[i * 3] = s.x
      this.scales[i * 3 + 1] = s.y
      this.scales[i * 3 + 2] = s.z
    }

    const colors = cloudColors(children)
    const geometry = new THREE.BufferGeometry()
    this.positions = new THREE.BufferAttribute(new Float32Array(local.length), 3)
    this.positions.setUsage(THREE.DynamicDrawUsage)
    geometry.setAttribute('position', this.positions)
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4))

    const translucent = hasTranslucentPoints(colors)
    const material = new THREE.PointsMaterial({
      size: this.pointSizePx,
      // The desktop's points are a fixed pixel size whatever their distance —
      // `glPointSize` is not attenuated — and this app's single-Point glyph
      // already matches that (glyphGeometry.ts). A cloud does the same, which
      // is also what keeps a distant scan visible instead of dissolving.
      sizeAttenuation: false,
      vertexColors: true,
      transparent: translucent,
      // Points carry flat colour, exactly as links and plot lines do: the
      // desktop disables lighting for this pass. PointsMaterial is unlit
      // already, so there is nothing to turn off — worth saying, because it is
      // the reason a cloud needs no normals.
      //
      // Fog is left ON: a cloud is scene content, and a scan receding into the
      // distance is precisely what fog is for (the render-mode/fog line —
      // chrome is exempt, content is not).
      fog: true,
      depthWrite: !translucent,
    })
    patchPointSprite(material)

    this.object = new THREE.Points(geometry, material)
    this.object.name = `gv-cloud:${parent.id}`
    // Culled, unlike linkOverlay and the selection halos — those also hold
    // world-space vertices and switch culling OFF, because keeping a bounding
    // volume in step would cost a pass they otherwise never make. A cloud makes
    // that pass anyway whenever it moves, so its bounds come free, and they buy
    // something worth having: a scan you have flown away from is skipped
    // outright instead of projecting a few hundred thousand vertices.
    this.object.frustumCulled = true
    this.object.userData.cloudParentId = parent.id
    // Picking goes through CloudPicker, which needs the camera for its
    // pixel-width tolerance; the Points object's own threshold-based raycast
    // would report hits in world units and at a different size than it draws.
    this.object.raycast = () => {}
  }

  get count(): number {
    return this.ids.length
  }

  /**
   * Re-derive the points a channel or a rate can move, from their rows.
   *
   * A cloud's local offsets and colours are baked at build time, so an ANIMATED
   * point would otherwise sit still: the parent's own animation comes free (the
   * parent frame moves and `update` re-multiplies), but a point's own
   * translate/colour does not. This is the desktop's `dynamic` cloud, which
   * likewise skips its cached batch and re-gathers each frame.
   *
   * Only the LIVE points are re-derived, not the whole cloud — a channel binds a
   * handful, and re-deriving 100k rows a frame to move three of them is the
   * trade this whole overlay exists to avoid.
   *
   * Returns whether anything actually CHANGED, which is what lets the caller's
   * standing-still guard survive a selection: `setLive` puts the whole selection
   * in here, so a scene with a point selected and nothing happening would
   * otherwise rewrite its entire buffer every frame.
   */
  refreshLive(): boolean {
    let changed = false
    const colors = this.object.geometry.getAttribute('color')
    const a = colors.array as Float32Array
    for (const i of this.live) {
      const node = this.nodes[i]
      const p = framePosition(node, this.parent)
      if (this.local[i * 3] !== p.x || this.local[i * 3 + 1] !== p.y || this.local[i * 3 + 2] !== p.z) {
        this.local[i * 3] = p.x
        this.local[i * 3 + 1] = p.y
        this.local[i * 3 + 2] = p.z
        changed = true
      }
      const c = node.color
      if (a[i * 4] !== c.r / 255 || a[i * 4 + 3] !== c.a / 255 ||
          a[i * 4 + 1] !== c.g / 255 || a[i * 4 + 2] !== c.b / 255) {
        a[i * 4] = c.r / 255
        a[i * 4 + 1] = c.g / 255
        a[i * 4 + 2] = c.b / 255
        a[i * 4 + 3] = c.a / 255
        colors.needsUpdate = true
      }
      // Not part of `changed`: the scale reaches nothing but the selection halo,
      // which is refreshed on its own schedule.
      const s = node.scale
      this.scales[i * 3] = s.x
      this.scales[i * 3 + 1] = s.y
      this.scales[i * 3 + 2] = s.z
    }
    return changed
  }

  /**
   * Rewrite every point from the parent frame's current matrixWorld — but only
   * when something actually moved.
   *
   * The guard is the point of this method, not a micro-optimisation. Every
   * overlay in this app is called once a frame from the animation loop, and the
   * others sweep tens or a few thousand edges; a cloud sweeps up to a few
   * hundred thousand vertices, so an unconditional rewrite would put a
   * multi-millisecond floor under a scene that is standing still — the exact
   * cost the topology exists to remove. A cloud only moves when its PARENT
   * moves (a gizmo drag, a Channels-animated ancestor) or when one of its own
   * points is animated, and both are detectable in constant time.
   */
  update(): void {
    const m = this.matrix.copy(this.parentFrame.matrixWorld).elements
    const moved = this.live.length > 0 && this.refreshLive()
    if (!moved && this.written && matrixEquals(m, this.lastMatrix)) return
    for (let i = 0; i < 16; i++) this.lastMatrix[i] = m[i]
    this.written = true

    const src = this.local
    const dst = this.positions.array as Float32Array
    // Bounds are gathered in the same pass rather than by a later
    // computeBoundingBox: the vertices are world space and rewritten as the
    // parent moves, so a cached box would go stale exactly when the camera
    // framing that reads it is asked for.
    let minX = Infinity
    let minY = Infinity
    let minZ = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let maxZ = -Infinity
    for (let i = 0; i < src.length; i += 3) {
      const x = src[i]
      const y = src[i + 1]
      const z = src[i + 2]
      const wx = m[0] * x + m[4] * y + m[8] * z + m[12]
      const wy = m[1] * x + m[5] * y + m[9] * z + m[13]
      const wz = m[2] * x + m[6] * y + m[10] * z + m[14]
      dst[i] = wx
      dst[i + 1] = wy
      dst[i + 2] = wz
      if (wx < minX) minX = wx
      if (wy < minY) minY = wy
      if (wz < minZ) minZ = wz
      if (wx > maxX) maxX = wx
      if (wy > maxY) maxY = wy
      if (wz > maxZ) maxZ = wz
    }
    this.positions.needsUpdate = true
    const geometry = this.object.geometry
    const box = geometry.boundingBox ?? (geometry.boundingBox = new THREE.Box3())
    box.min.set(minX, minY, minZ)
    box.max.set(maxX, maxY, maxZ)
    // Kept in step so `Box3.setFromObject` — which reads whichever it finds —
    // never falls back to recomputing 200k vertices while the camera is framing.
    geometry.boundingSphere ??= new THREE.Sphere()
    box.getBoundingSphere(geometry.boundingSphere)
  }

  /**
   * Add `ids` to the points re-derived from their rows each frame, on top of the
   * ones a channel or a rate already claimed at build time.
   *
   * What needs it is a GIZMO DRAG on a selected point. The gizmo writes a frame
   * and the drag handler reads it back into the row (`invertFrameTranslate`), so
   * a dragged point's row changes every frame with no rebuild in between — which
   * is exactly the case `refreshLive` exists for. Without this a drag would move
   * the handles and leave the point behind until the release.
   */
  setLive(ids: ReadonlySet<number>): void {
    if (ids.size === 0) {
      this.live = this.baseLive as number[]
      return
    }
    const extra: number[] = []
    for (let i = 0; i < this.ids.length; i++) {
      if (ids.has(this.ids[i]) && !this.baseLive.includes(i)) extra.push(i)
    }
    this.live = extra.length === 0 ? (this.baseLive as number[]) : [...this.baseLive, ...extra]
  }

  /** World position of the point at batch index `i`, into `out`. */
  positionAt(i: number, out: THREE.Vector3): THREE.Vector3 {
    const p = this.positions.array as Float32Array
    return out.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2])
  }

  /**
   * The draw matrix a selection halo is built around, for the point at batch
   * index `i` — the cloud parent's world basis scaled by the point's own
   * rendered scale, translated to where the point actually is.
   *
   * That is `node_draw_data`'s matrix, the desktop's own halo source, with ONE
   * term dropped: the point's own `rotate_*`. A cloud point draws no shape for a
   * rotation to act on (the format reference says its geometry, scale and
   * rotation are all ignored — only the halo reads the scale at all, to have
   * some size), so carrying a quaternion per point to spin an invisible box
   * would be storage spent on nothing anybody can see.
   */
  haloMatrixAt(i: number, out: THREE.Matrix4): THREE.Matrix4 {
    const e = out.copy(this.parentFrame.matrixWorld).elements
    const p = this.positions.array as Float32Array
    for (let axis = 0; axis < 3; axis++) {
      const raw = this.scales[i * 3 + axis]
      const k = raw * drawScaleCorrection(raw)
      e[axis * 4] *= k
      e[axis * 4 + 1] *= k
      e[axis * 4 + 2] *= k
    }
    e[12] = p[i * 3]
    e[13] = p[i * 3 + 1]
    e[14] = p[i * 3 + 2]
    return out
  }

  batch(): CloudBatch {
    return {
      ids: this.ids,
      positions: this.positions.array as Float32Array,
      colors: this.object.geometry.getAttribute('color').array as Float32Array,
      count: this.ids.length,
    }
  }

  dispose(): void {
    this.object.geometry.dispose()
    ;(this.object.material as THREE.Material).dispose()
  }
}

/**
 * Ray-to-point picking over every cloud, in the pixels the points are drawn at.
 *
 * This app has no colour-ID pick buffer, so the desktop's per-point pick pass
 * becomes a pass over the position arrays — and the tolerance has to be
 * re-derived from pixels to world units at each candidate's own depth, exactly
 * as LinkPicker does, or a distant cloud would be unclickable and a near one
 * would swallow the scene.
 *
 * It pushes into the raycaster's own sorted intersection list, so nearest still
 * wins, a solid World Grid still occludes, and a glyph standing in front of a
 * cloud still takes the click. O(points) per click and never per frame; at
 * 209k that is a few milliseconds, once, on a mouse press.
 */
class CloudPicker extends THREE.Object3D {
  private groups: CloudGroup[]
  private resolution: THREE.Vector2
  // Scratch, so a pass over 200k points allocates nothing.
  private point = new THREE.Vector3()
  private offset = new THREE.Vector3()
  private onRay = new THREE.Vector3()

  constructor(groups: CloudGroup[], resolution: THREE.Vector2) {
    super()
    this.name = 'cloud-picker'
    this.groups = groups
    this.resolution = resolution
    // Read back through userData so pickNodeId stays a plain scene-graph walk
    // with no import of this class — LinkPicker's own arrangement.
    this.userData.isCloudPicker = true
  }

  override raycast(raycaster: THREE.Raycaster, intersects: THREE.Intersection[]): void {
    const camera = raycaster.camera as THREE.PerspectiveCamera | undefined
    // No camera, or a viewport never sized, means no screen to measure a pixel
    // tolerance against — so there is nothing sensible to hit.
    if (!camera?.isPerspectiveCamera || this.resolution.y === 0) return
    const worldPerPixelAtUnitDepth =
      (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5))) / this.resolution.y
    const ray = raycaster.ray

    for (const group of this.groups) {
      if (!group.object.visible) continue
      const widthPx = Math.max(MIN_PICK_WIDTH_PX, group.pointSizePx)
      const halfPerUnitDepth = 0.5 * widthPx * worldPerPixelAtUnitDepth
      const positions = group.object.geometry.getAttribute('position').array as Float32Array
      for (let i = 0; i < group.ids.length; i++) {
        this.point.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])
        // Distance ALONG the ray, not to the point: it is what orders this hit
        // against a glyph's, and a point a tolerance off to one side is at the
        // depth of its projection, not of itself. Negative means behind the
        // camera, where a point has no screen position at all.
        const along = this.offset.subVectors(this.point, ray.origin).dot(ray.direction)
        if (along <= 0) continue
        this.onRay.copy(ray.direction).multiplyScalar(along).add(ray.origin)
        if (this.onRay.distanceTo(this.point) > halfPerUnitDepth * along) continue
        intersects.push({
          distance: along,
          point: this.point.clone(),
          object: this,
          // The node id, carried in the one numeric slot an Intersection has to
          // spare. LinkPicker uses faceIndex with a parallel array; a cloud has
          // no faces, and the id is what the caller wants either way.
          index: group.ids[i],
        })
      }
    }
  }
}

/**
 * What a cloud point has instead of a frame.
 *
 * Everything in this app that asks "where is node N?" asks an Object3D, and a
 * cloud point has none — so the passes that need one (region select, labels,
 * selection halos, Follow Selected, XR focus) take this instead. Narrow on
 * purpose: it is the whole of what a frameless node can answer, and keeping it
 * to two methods is what stops the frameless case leaking further than it has
 * to. `PointCloudOverlay` satisfies it structurally, so no caller imports the
 * class.
 */
export interface PointPositions {
  /** True when this node id is a point inside some drawn cloud. */
  hasPoint(nodeId: number): boolean
  /** Its world position, or null when it is not a drawn point. */
  pointPosition(nodeId: number, out?: THREE.Vector3): THREE.Vector3 | null
  /** The rendered size in pixels of the cloud it belongs to. */
  pointSizeOf(nodeId: number): number
  /**
   * Fill `out` with the point's draw matrix — what a selection halo is built
   * around. False when the id is not a drawn point.
   */
  pointHaloMatrix(nodeId: number, out: THREE.Matrix4): boolean
}

/**
 * Every point cloud of one built scene. Attach `group` under the scene root
 * (buildScene does), call `update()` once per frame and `setResolution` on
 * init/resize so the pick tolerance is in real pixels.
 */
export class PointCloudOverlay {
  readonly group = new THREE.Group()
  private groups: CloudGroup[] = []
  private byParent = new Map<number, CloudGroup>()
  /** Batch index of every point, by node id — the selection/label lookup. */
  private index = new Map<number, { group: CloudGroup; i: number }>()
  private resolution = new THREE.Vector2()

  constructor(groups: CloudGroup[]) {
    this.group.name = 'point-cloud-overlay'
    this.groups = groups
    for (const g of groups) {
      this.group.add(g.object)
      this.byParent.set(g.parentId, g)
      for (let i = 0; i < g.ids.length; i++) this.index.set(g.ids[i], { group: g, i })
    }
    if (groups.length > 0) this.group.add(new CloudPicker(groups, this.resolution))
  }

  /** How many clouds are drawn. */
  get cloudCount(): number {
    return this.groups.length
  }

  /** How many points across all of them. */
  get pointCount(): number {
    let n = 0
    for (const g of this.groups) n += g.count
    return n
  }

  /** Ids of the cloud PARENTS drawn here. */
  get parentIds(): ReadonlySet<number> {
    return new Set(this.byParent.keys())
  }

  /** True when this node id is a point inside some drawn cloud. */
  hasPoint(nodeId: number): boolean {
    return this.index.has(nodeId)
  }

  /**
   * World position of one point, or null if the id is not a drawn point.
   * Reads the buffer the last `update()` wrote, so it is as current as the
   * links and halos are — one frame stale mid-drag, for the same reason.
   */
  pointPosition(nodeId: number, out = new THREE.Vector3()): THREE.Vector3 | null {
    const at = this.index.get(nodeId)
    return at ? at.group.positionAt(at.i, out) : null
  }

  /** Rendered point size in pixels for the cloud a point belongs to. */
  pointSizeOf(nodeId: number): number {
    return this.index.get(nodeId)?.group.pointSizePx ?? 0
  }

  /** The point's draw matrix, for its selection halo. */
  pointHaloMatrix(nodeId: number, out: THREE.Matrix4): boolean {
    const at = this.index.get(nodeId)
    if (!at) return false
    at.group.haloMatrixAt(at.i, out)
    return true
  }

  /** Every drawn cloud's batch, for tests and for anything sweeping points. */
  batches(): CloudBatch[] {
    return this.groups.map((g) => g.batch())
  }

  /** Viewport size in device pixels — the pick tolerance is a pixel width. */
  setResolution(width: number, height: number): void {
    this.resolution.set(width, height)
  }

  /**
   * Points that must be re-derived from their rows every frame in addition to
   * the animated ones — the selection, so a gizmo drag on a point is visible
   * while it is happening rather than only at the release. Cheap to call on
   * every selection change: it walks each cloud's id list once.
   */
  setLive(ids: ReadonlySet<number>): void {
    for (const g of this.groups) g.setLive(ids)
  }

  /**
   * Rewrite every cloud from its parent frame's current matrixWorld. Callers
   * own the matrix state: the render loop relies on the renderer's own pass
   * (≤ 1 frame stale while dragging), tests and builders updateMatrixWorld
   * first — the link and topology overlays' contract, unchanged.
   */
  update(): void {
    for (const g of this.groups) g.update()
  }

  dispose(): void {
    for (const g of this.groups) g.dispose()
    this.groups = []
    this.byParent.clear()
    this.index.clear()
  }
}

export interface BuildPointCloudOptions {
  showHidden?: boolean
  /**
   * Nodes past the `\` draw limit, which have no frame. A cloud PARENT that was
   * cut takes its whole cloud with it; the points themselves are never counted
   * against the limit (see drawLimit.ts).
   */
  keep?: ReadonlySet<number>
  /**
   * Nodes a channel binding or a rate field can move or recolour each frame
   * (the union of `ChannelAnimation.boundNodeIds` and the rate candidates).
   * Points in this set are re-derived from their rows every frame instead of
   * riding the offsets baked here — the desktop's `dynamic` cloud.
   */
  liveNodeIds?: ReadonlySet<number>
}

/**
 * Collect every Point Cloud parent's children into batched point objects.
 *
 * `frames` is the builder's id→frame map: a cloud hangs from exactly one frame,
 * its parent's, so this needs no scene-graph walk at all — and must not do one,
 * for the reason linkOverlay records (getObjectByName is a full scan).
 */
export function buildPointCloudOverlay(
  nodes: readonly GvNode[],
  frames: ReadonlyMap<number, THREE.Object3D>,
  options: BuildPointCloudOptions = {},
): PointCloudOverlay {
  const parentIds = cloudParentIds(nodes)
  if (parentIds.size === 0) return new PointCloudOverlay([])

  const showHidden = options.showHidden === true
  const childrenOf = new Map<number, GvNode[]>()
  for (const node of nodes) {
    if (!parentIds.has(node.parentId)) continue
    let kids = childrenOf.get(node.parentId)
    if (!kids) {
      kids = []
      childrenOf.set(node.parentId, kids)
    }
    kids.push(node)
  }

  const groups: CloudGroup[] = []
  const seen = new Set<number>()
  for (const parent of nodes) {
    if (!isCloudParent(parent)) continue
    // A duplicate id resolves to its FIRST row everywhere else in this app; a
    // cloud must agree, or its points would hang off a frame the rest of the
    // scene does not use.
    if (seen.has(parent.id)) continue
    seen.add(parent.id)
    // A hidden cloud parent draws nothing, exactly as the desktop's pass skips
    // it — the whole cloud is the parent's rendering.
    if (!showHidden && parent.hide !== 0) continue
    if (options.keep && !options.keep.has(parent.id)) continue
    const parentFrame = frames.get(parent.id)
    if (!parentFrame) continue

    const kids = drawableChildren(childrenOf.get(parent.id) ?? [], showHidden)
    if (kids.length === 0) continue

    const ids = new Int32Array(kids.length)
    const local = new Float32Array(kids.length * 3)
    const live: number[] = []
    for (let i = 0; i < kids.length; i++) {
      ids[i] = kids[i].id
      // The builder's own placement rule, not a restatement of it: a cloud's
      // points must land where buildScene would have put their frames, grid
      // parents and topo_scale included.
      const p = framePosition(kids[i], parent)
      local[i * 3] = p.x
      local[i * 3 + 1] = p.y
      local[i * 3 + 2] = p.z
      if (options.liveNodeIds?.has(kids[i].id)) live.push(i)
    }
    // A frame built moments ago has never been through a render pass, so its
    // matrixWorld is still the identity — and the first `update()` below reads
    // exactly that. Resolving the ancestor chain here is what makes the cloud
    // correct from the instant it is built rather than from the first rendered
    // frame, which is the same call drawMode's stamping and Selection.set make
    // for the same reason. A handful of clouds, each with a short chain.
    parentFrame.updateWorldMatrix(true, false)
    groups.push(new CloudGroup(parent, parentFrame, kids, ids, local, live))
  }

  const overlay = new PointCloudOverlay(groups)
  overlay.update()
  return overlay
}
