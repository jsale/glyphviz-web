// Plot (topo 16) polylines and Surface (topo 17) quad meshes — the two
// topologies whose children place Cartesian like Plane/None but which ALSO
// draw an overlay connecting those children.
//
// Ported (behavior, not code) from the desktop viewport's
// _draw_topology_overlays (glyphviz_gl/viewport.py, verified 2026-07-25) —
// the same function the Link edges came from, whose plot/surface passes were
// left unimplemented then. Spec: glyphviz-skill/references/topologies.md,
// "Cartesian family".
//
// - Plot: one GL_LINE_STRIP through the parent's children in FILE (row)
//   order, needing ≥ 2 of them, pixel width max(ratio·20, 1) taken from the
//   PARENT, each vertex carrying its own child's color so a color-ramped run
//   of children paints a gradient along the line.
// - Surface: a lattice built by bucketing the children on their exact
//   (translate_x, translate_y) rounded to 6 decimals; the unique x's and y's
//   sort ascending and a quad draws for every cell whose four corners all
//   exist (holes are legal). translate_z is the height. Needs ≥ 4 children
//   and ≥ 2 distinct values per axis. It is LIT with a per-face normal,
//   unlike everything else in this file, and coloured one of two ways by the
//   PARENT's texture_id (desktop `e22d51f`, 2026-09-12): none — or one that
//   does not resolve — and per-vertex child colours shade it; set, and that
//   image drapes across the lattice's bounding box at the parent's alpha, in
//   World Grid's UV convention (u with +x, v with +y). Colour is for DATA on
//   the shape, a texture for IMAGERY, and only a texture can carry a picture
//   finer than the mesh.
//
// Performance, the other half of that commit: a Surface's buffers are
// rewritten only on a frame where one of its vertices actually moved or
// recoloured (SurfaceMesh.update). The desktop gets there by retaining the
// mesh in a display list with a channel-bound exemption; a per-vertex compare
// needs no exemption, because it sees every way a node can move.
//
// Structure follows linkOverlay.ts, and for the same reasons: endpoints
// resolve through the builder's id→frame map (getObjectByName is a full
// scene scan), geometry batches, and update() rewrites preallocated buffers
// from the frames' matrixWorld so a gizmo drag or a Channels frame drags the
// overlay along without a scene rebuild.
//
// Neither overlay is pickable, matching the desktop's color-ID pick pass,
// which renders glyphs only (_render_pick_scene) — so a surface does not
// occlude the glyphs behind it for picking either.
//
// Divergences from the desktop, both from the fat-line addon:
//   - Its per-vertex ALPHA cannot be reproduced (three's LineSegmentsGeometry
//     takes RGB colors only), so a plot draws at the MEAN alpha of its
//     children. Equal-alpha children — the overwhelmingly common case, and
//     every stock example — are unaffected.
//   - The desktop stamps an antialiased GL_POINTS dot at every vertex to
//     round the caps and joins; three's fat lines are already round-capped
//     per segment, so the dots are not reproduced (cosmetic, same call as
//     the Link edges').
//
// One structural difference: the desktop re-derives which children belong to
// a polyline and which cells a lattice has on EVERY redraw, because
// immediate mode rebuilds the whole frame anyway. Here that membership is
// baked at build time and only the vertex positions track live, so a
// translate_x/y edit re-forms a surface's lattice at the next scene rebuild
// (drag release, inspector commit) rather than mid-drag — and a Channels
// track that animates a surface child's translate_x/y moves the vertex
// without re-cellling the mesh. Lattice coordinates are supposed to be
// fixed, identical, generated values (topologies.md is explicit), so this
// only shows up in authoring that the spec already warns against.

import * as THREE from 'three'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import type { GvNode } from '../gv/types'
import { NodeType, Topo } from '../gv/types'
import { roundHalfToEven } from '../gv/channels'
import { setNaturalTransparency } from './renderMode'

/** Lattice bucketing precision — the desktop's `round(value, 6)`. */
const LATTICE_DECIMALS = 6
const DEGENERATE_NORMAL = new THREE.Vector3(0, 0, 1)
const NORMAL_EPS = 1e-10

/** One Plot parent's polyline, placed inside a batched line group. */
interface PlotPlan {
  nodeId: number
  widthPx: number
  /** Child frames in file order; the polyline's vertices. */
  frames: THREE.Object3D[]
  /** Per-vertex child colors, 0–1. */
  colors: THREE.Color[]
  /** Mean of the children's alphas — the group's material opacity. */
  alpha: number
  group: PlotGroup
  /** This plot's first segment index within the group. */
  segStart: number
}

/** One batched LineSegments2 for every plot sharing (width, alpha). */
class PlotGroup {
  readonly plans: PlotPlan[] = []
  readonly material: LineMaterial
  readonly object: LineSegments2
  private geometry: LineSegmentsGeometry
  private positions!: THREE.InstancedInterleavedBuffer
  private segments = 0

  constructor(widthPx: number, alpha: number) {
    this.geometry = new LineSegmentsGeometry()
    this.material = new LineMaterial({
      vertexColors: true,
      linewidth: widthPx,
      transparent: alpha < 1,
      opacity: alpha,
      // Scene content fogs; ShaderMaterial-derived LineMaterial needs the
      // flag the built-in materials default to (render/fog.ts).
      fog: true,
    })
    this.object = new LineSegments2(this.geometry, this.material)
    this.object.name = 'plot-lines'
    this.object.raycast = () => {} // never pickable
    // Vertices chase their nodes every frame; skip bounds maintenance.
    this.object.frustumCulled = false
  }

  get segmentCount(): number {
    return this.segments
  }

  /** Reserve `count` segments and return the run's first index. */
  reserve(count: number): number {
    const start = this.segments
    this.segments += count
    return start
  }

  /** Allocate the GPU buffers once every plan has reserved its run. */
  finalize(): void {
    this.geometry.setPositions(new Array(this.segments * 6).fill(0))
    const colors = new Float32Array(this.segments * 6)
    for (const plan of this.plans) {
      for (let i = 0; i + 1 < plan.colors.length; i++) {
        const o = (plan.segStart + i) * 6
        const a = plan.colors[i]
        const b = plan.colors[i + 1]
        colors[o] = a.r
        colors[o + 1] = a.g
        colors[o + 2] = a.b
        colors[o + 3] = b.r
        colors[o + 4] = b.g
        colors[o + 5] = b.b
      }
    }
    this.geometry.setColors(colors as unknown as number[])
    this.positions = (this.geometry.attributes.instanceStart as THREE.InterleavedBufferAttribute)
      .data as THREE.InstancedInterleavedBuffer
    this.positions.setUsage(THREE.DynamicDrawUsage)
  }

  update(a: THREE.Vector3, b: THREE.Vector3): void {
    const arr = this.positions.array as Float32Array
    for (const plan of this.plans) {
      const frames = plan.frames
      a.setFromMatrixPosition(frames[0].matrixWorld)
      for (let i = 0; i + 1 < frames.length; i++) {
        b.setFromMatrixPosition(frames[i + 1].matrixWorld)
        const o = (plan.segStart + i) * 6
        arr[o] = a.x
        arr[o + 1] = a.y
        arr[o + 2] = a.z
        arr[o + 3] = b.x
        arr[o + 4] = b.y
        arr[o + 5] = b.z
        a.copy(b)
      }
    }
    this.positions.needsUpdate = true
  }

  /** Segment `index`'s six position floats, for the parity harness. */
  readSegment(index: number): Float32Array {
    return (this.positions.array as Float32Array).slice(index * 6, index * 6 + 6)
  }

  readSegmentColors(index: number): Float32Array {
    const attr = this.geometry.attributes.instanceColorStart as THREE.InterleavedBufferAttribute
    return (attr.data.array as Float32Array).slice(index * 6, index * 6 + 6)
  }

  dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
  }
}

/**
 * The UV a Surface corner takes when its parent drapes a texture: the
 * desktop's `_emit_surface_mesh`, and GEO_GRID's convention — u grows with
 * +x, v grows with +y — across the lattice's own bounding box. That shared
 * convention is what lets one georeferenced image land identically on a flat
 * World Grid and on relief.
 *
 * `x0`/`y0`/spans come from the ROUNDED lattice axes while the corner's own
 * coordinate is read raw, exactly as there; a zero span is guarded to 1.
 */
export function surfaceUv(
  translateX: number,
  translateY: number,
  xAxis: readonly number[],
  yAxis: readonly number[],
): [number, number] {
  const xSpan = xAxis[xAxis.length - 1] - xAxis[0] || 1
  const ySpan = yAxis[yAxis.length - 1] - yAxis[0] || 1
  return [(translateX - xAxis[0]) / xSpan, (translateY - yAxis[0]) / ySpan]
}

/** One Surface parent's quad mesh: 4 unshared vertices per quad, so each
 *  quad keeps its own flat face normal exactly as glNormal3f did.
 *
 *  Two colourings, chosen per frame by the PARENT's texture_id (desktop
 *  `e22d51f`): with no texture — or one that does not resolve — each corner
 *  carries its child's colour, as it always has; with one, the image drapes
 *  across the lattice by `surfaceUv` under a single white colour at the
 *  parent's alpha, and stays LIT (GL_MODULATE there, MeshLambertMaterial's
 *  map × lighting here), because relief only reads as relief when it is
 *  shaded. Both attribute sets are always present, so switching is a material
 *  flag rather than a rebuild — which is what lets a channel-animated
 *  texture_id, or a texture that finishes decoding, take effect in place. */
class SurfaceMesh {
  readonly object: THREE.Mesh
  /** 4 frames per quad, in the desktop's n00, n10, n11, n01 corner order. */
  readonly frames: THREE.Object3D[]
  readonly quadCount: number
  readonly nodeId: number
  private readonly parent: GvNode
  private readonly textures: ReadonlyMap<number, THREE.Texture> | undefined
  private geometry: THREE.BufferGeometry
  private material: THREE.MeshLambertMaterial
  private positions: THREE.BufferAttribute
  private normals: THREE.BufferAttribute
  private colors: THREE.BufferAttribute
  /** The lattice's distinct vertices — a corner shared by four quads is read
   *  once — and, per quad corner, which of them it is. */
  private uniqueFrames: THREE.Object3D[]
  private uniqueNodes: GvNode[]
  private cornerToUnique: Uint32Array
  /** World position each unique vertex was last written at (NaN = never). */
  private lastPos: Float64Array
  /** Packed RGBA each unique vertex's colour was last written at. */
  private lastColor: Float64Array
  private textured = false
  /** Any child colour below full alpha — the untextured mode's transparency. */
  private translucentCorners = false

  constructor(
    parent: GvNode,
    corners: GvNode[],
    frames: THREE.Object3D[],
    uvs: Float32Array,
    textures: ReadonlyMap<number, THREE.Texture> | undefined,
  ) {
    this.nodeId = parent.id
    this.parent = parent
    this.textures = textures
    this.frames = frames
    this.quadCount = frames.length / 4
    const vertexCount = frames.length

    const uniqueIndex = new Map<THREE.Object3D, number>()
    this.uniqueFrames = []
    this.uniqueNodes = []
    this.cornerToUnique = new Uint32Array(vertexCount)
    for (let v = 0; v < vertexCount; v++) {
      let u = uniqueIndex.get(frames[v])
      if (u === undefined) {
        u = this.uniqueFrames.length
        uniqueIndex.set(frames[v], u)
        this.uniqueFrames.push(frames[v])
        this.uniqueNodes.push(corners[v])
      }
      this.cornerToUnique[v] = u
    }
    this.lastPos = new Float64Array(this.uniqueFrames.length * 3).fill(NaN)
    this.lastColor = new Float64Array(this.uniqueFrames.length).fill(NaN)

    this.geometry = new THREE.BufferGeometry()
    this.positions = new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3)
    this.positions.setUsage(THREE.DynamicDrawUsage)
    this.normals = new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3)
    this.normals.setUsage(THREE.DynamicDrawUsage)
    // itemSize 4 — three's USE_COLOR_ALPHA path, so the desktop's per-vertex
    // glColor4f alpha survives (unlike the fat lines above).
    this.colors = new THREE.BufferAttribute(new Float32Array(vertexCount * 4), 4)
    const index = new Uint32Array(this.quadCount * 6)
    for (let q = 0; q < this.quadCount; q++) {
      const b = q * 4
      // GL_QUADS' own decomposition: (n00, n10, n11) + (n00, n11, n01).
      index.set([b, b + 1, b + 2, b, b + 2, b + 3], q * 6)
    }
    this.geometry.setAttribute('position', this.positions)
    this.geometry.setAttribute('normal', this.normals)
    this.geometry.setAttribute('color', this.colors)
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    this.geometry.setIndex(new THREE.BufferAttribute(index, 1))
    // FrontSide, not DoubleSide: paintGL runs with GL_CULL_FACE on, so the
    // desktop's surface is one-sided too — seen from below it vanishes.
    this.material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.FrontSide,
    })
    this.object = new THREE.Mesh(this.geometry, this.material)
    this.object.name = 'surface-mesh'
    this.object.raycast = () => {} // never pickable
    this.object.frustumCulled = false
    this.refreshColors()
    this.syncAppearance()
  }

  /** Whether the mesh is currently draping its parent's texture. */
  get isTextured(): boolean {
    return this.textured
  }

  /**
   * Pick the colouring from the parent as it stands now. Cheap enough to run
   * every frame — a map lookup and a few compares — and only a real change of
   * mode touches the material's defines.
   */
  private syncAppearance(): void {
    const id = this.parent.textureId
    const map = id > 0 ? (this.textures?.get(id) ?? null) : null
    const textured = map !== null
    const m = this.material
    if (textured !== this.textured || m.map !== map) {
      // USE_MAP / USE_COLOR are compiled into the program; a swap between two
      // non-null maps is a uniform and needs no recompile.
      if (textured !== this.textured || (m.map === null) !== (map === null)) m.needsUpdate = true
      m.map = map
      m.vertexColors = !textured
      this.textured = textured
    }
    if (textured) {
      // One white colour for the whole mesh at the PARENT's alpha — tinting
      // the image by each corner's colour is exactly what a texture replaces.
      const opacity = this.parent.color.a / 255
      m.opacity = opacity
      setNaturalTransparency(m, opacity < 1)
    } else {
      m.opacity = 1
      setNaturalTransparency(m, this.translucentCorners)
    }
  }

  /** Rewrite the per-corner colours if any child's colour changed since the
   *  last write (a Channels colour track, or the first call). */
  private refreshColors(): void {
    const nodes = this.uniqueNodes
    const last = this.lastColor
    let dirty = false
    for (let u = 0; u < nodes.length; u++) {
      const c = nodes[u].color
      const packed = ((c.r * 256 + c.g) * 256 + c.b) * 256 + c.a
      if (packed !== last[u]) {
        last[u] = packed
        dirty = true
      }
    }
    if (!dirty) return
    const col = this.colors.array as Float32Array
    const map = this.cornerToUnique
    let translucent = false
    for (let v = 0; v < map.length; v++) {
      const c = nodes[map[v]].color
      col[v * 4] = c.r / 255
      col[v * 4 + 1] = c.g / 255
      col[v * 4 + 2] = c.b / 255
      col[v * 4 + 3] = c.a / 255
      if (c.a < 255) translucent = true
    }
    this.translucentCorners = translucent
    this.colors.needsUpdate = true
  }

  /**
   * Bring the GPU buffers up to date — and do NOTHING when nothing moved.
   *
   * The web counterpart of the desktop retaining a Surface in a display list
   * (`e22d51f`): that was a 22× win on an 11,400-vertex terrain there because
   * immediate mode re-emitted the whole quad stream every frame. Here the
   * cost was the same shape — a full rewrite and re-upload of the position
   * and normal buffers per frame — for a mesh that is almost always static.
   * Comparing each distinct vertex's world translation against what was last
   * written is exact (a vertex's position IS that translation), costs three
   * compares a vertex, and needs no knowledge of what can move a node:
   * a gizmo drag, a Channels track, a rate field or an ancestor all show up
   * the same way. The desktop needs a channel-bound exemption from its cache
   * precisely because a display list cannot see a moved node; this can.
   */
  update(
    p00: THREE.Vector3,
    p10: THREE.Vector3,
    p11: THREE.Vector3,
    p01: THREE.Vector3,
    ea: THREE.Vector3,
    eb: THREE.Vector3,
    normal: THREE.Vector3,
  ): void {
    this.refreshColors()
    this.syncAppearance()

    const last = this.lastPos
    let moved = false
    for (let u = 0; u < this.uniqueFrames.length; u++) {
      const e = this.uniqueFrames[u].matrixWorld.elements
      const o = u * 3
      if (e[12] !== last[o] || e[13] !== last[o + 1] || e[14] !== last[o + 2]) {
        last[o] = e[12]
        last[o + 1] = e[13]
        last[o + 2] = e[14]
        moved = true
      }
    }
    if (!moved) return

    const map = this.cornerToUnique
    const pos = this.positions.array as Float32Array
    const nrm = this.normals.array as Float32Array
    for (let q = 0; q < this.quadCount; q++) {
      const b = q * 4
      let s = map[b] * 3
      p00.set(last[s], last[s + 1], last[s + 2])
      s = map[b + 1] * 3
      p10.set(last[s], last[s + 1], last[s + 2])
      s = map[b + 2] * 3
      p11.set(last[s], last[s + 1], last[s + 2])
      s = map[b + 3] * 3
      p01.set(last[s], last[s + 1], last[s + 2])
      let o = b * 3
      pos[o] = p00.x
      pos[o + 1] = p00.y
      pos[o + 2] = p00.z
      pos[o + 3] = p10.x
      pos[o + 4] = p10.y
      pos[o + 5] = p10.z
      pos[o + 6] = p11.x
      pos[o + 7] = p11.y
      pos[o + 8] = p11.z
      pos[o + 9] = p01.x
      pos[o + 10] = p01.y
      pos[o + 11] = p01.z
      // Per-face normal, CCW winding → outward (the desktop's cross product).
      ea.subVectors(p10, p00)
      eb.subVectors(p01, p00)
      normal.crossVectors(ea, eb)
      if (normal.length() > NORMAL_EPS) normal.normalize()
      else normal.copy(DEGENERATE_NORMAL)
      for (let v = 0; v < 4; v++) {
        o = (b + v) * 3
        nrm[o] = normal.x
        nrm[o + 1] = normal.y
        nrm[o + 2] = normal.z
      }
    }
    this.positions.needsUpdate = true
    this.normals.needsUpdate = true
  }

  /**
   * Live buffer read-back for the parity harness. `color` is what GL would
   * have latched at the vertex: the child's own colour untextured, the
   * mesh-wide white at the parent's alpha when textured. `uv` only when
   * textured, since the desktop emits texcoords only then.
   */
  readVertex(vertexIndex: number): {
    pos: Float32Array
    normal: Float32Array
    color: Float32Array
    uv?: Float32Array
  } {
    const color = this.textured
      ? new Float32Array([1, 1, 1, this.material.opacity])
      : (this.colors.array as Float32Array).slice(vertexIndex * 4, vertexIndex * 4 + 4)
    const uv = this.geometry.attributes.uv as THREE.BufferAttribute
    return {
      pos: (this.positions.array as Float32Array).slice(vertexIndex * 3, vertexIndex * 3 + 3),
      normal: (this.normals.array as Float32Array).slice(vertexIndex * 3, vertexIndex * 3 + 3),
      color,
      uv: this.textured
        ? (uv.array as Float32Array).slice(vertexIndex * 2, vertexIndex * 2 + 2)
        : undefined,
    }
  }

  dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
  }
}

/** A vertex of a recorded overlay primitive (parity harness / tests). */
export interface OverlayVertex {
  pos: [number, number, number]
  /** RGBA, 0–1. */
  color: [number, number, number, number]
  /** Quads only — the face normal the desktop's glNormal3f emitted. */
  normal?: [number, number, number]
  /** Textured surface quads only — the glTexCoord2f the desktop emitted. */
  uv?: [number, number]
}

/** One drawn overlay shape, in the desktop's own emission order. */
export interface OverlayPrimitive {
  kind: 'polyline' | 'quad'
  /** The Plot/Surface parent node this came from. */
  nodeId: number
  /** Polylines only — the desktop's pixel line width. */
  widthPx?: number
  vertices: OverlayVertex[]
}

/**
 * All Plot polylines and Surface meshes of one built scene. Attach `group`
 * under the scene root (buildScene does), call `update()` once per frame,
 * and `setResolution` on init/resize so the fat lines get their pixel width.
 */
export class TopologyOverlay {
  readonly group = new THREE.Group()
  private plotGroups: PlotGroup[] = []
  private plots: PlotPlan[] = []
  private surfaces: SurfaceMesh[] = []
  // Scratch so update() never allocates.
  private v0 = new THREE.Vector3()
  private v1 = new THREE.Vector3()
  private v2 = new THREE.Vector3()
  private v3 = new THREE.Vector3()
  private ea = new THREE.Vector3()
  private eb = new THREE.Vector3()
  private normal = new THREE.Vector3()

  constructor(plotGroups: PlotGroup[], plots: PlotPlan[], surfaces: SurfaceMesh[]) {
    this.group.name = 'topology-overlay'
    this.plotGroups = plotGroups
    this.plots = plots
    this.surfaces = surfaces
    for (const g of plotGroups) this.group.add(g.object)
    for (const s of surfaces) this.group.add(s.object)
  }

  /** Number of Plot parents that produced a polyline. */
  get plotCount(): number {
    return this.plots.length
  }

  /** Number of Surface parents that produced a mesh. */
  get surfaceCount(): number {
    return this.surfaces.length
  }

  /** Total quads across every surface mesh. */
  get quadCount(): number {
    return this.surfaces.reduce((sum, s) => sum + s.quadCount, 0)
  }

  get isEmpty(): boolean {
    return this.plots.length === 0 && this.surfaces.length === 0
  }

  /** Viewport size in device pixels — LineMaterial's screen-space widths. */
  setResolution(width: number, height: number): void {
    for (const g of this.plotGroups) g.material.resolution.set(width, height)
  }

  /**
   * Rewrite every vertex from its node's current matrixWorld. Callers own the
   * matrix state, exactly as for the Link edges: the render loop relies on the
   * renderer's own pass (≤ 1 frame stale while dragging); tests and the
   * builder call updateMatrixWorld first.
   */
  update(): void {
    for (const g of this.plotGroups) g.update(this.v0, this.v1)
    for (const s of this.surfaces) {
      s.update(this.v0, this.v1, this.v2, this.v3, this.ea, this.eb, this.normal)
    }
  }

  /**
   * The drawn geometry read back off the live GPU buffers, in the desktop's
   * emission order (every polyline in scene order, then every quad, its
   * surfaces in scene order and its cells row-major). The cross-
   * implementation parity test diffs this against the real desktop
   * viewport's recorded GL vertex stream.
   */
  primitives(): OverlayPrimitive[] {
    const out: OverlayPrimitive[] = []
    for (const plan of this.plots) {
      const vertices: OverlayVertex[] = []
      for (let i = 0; i + 1 < plan.frames.length; i++) {
        const p = plan.group.readSegment(plan.segStart + i)
        const c = plan.group.readSegmentColors(plan.segStart + i)
        if (i === 0) {
          vertices.push({
            pos: [p[0], p[1], p[2]],
            color: [c[0], c[1], c[2], plan.alpha],
          })
        }
        vertices.push({
          pos: [p[3], p[4], p[5]],
          color: [c[3], c[4], c[5], plan.alpha],
        })
      }
      out.push({ kind: 'polyline', nodeId: plan.nodeId, widthPx: plan.widthPx, vertices })
    }
    for (const surface of this.surfaces) {
      for (let q = 0; q < surface.quadCount; q++) {
        const vertices: OverlayVertex[] = []
        for (let v = 0; v < 4; v++) {
          const { pos, normal, color, uv } = surface.readVertex(q * 4 + v)
          vertices.push({
            pos: [pos[0], pos[1], pos[2]],
            color: [color[0], color[1], color[2], color[3]],
            normal: [normal[0], normal[1], normal[2]],
            ...(uv ? { uv: [uv[0], uv[1]] as [number, number] } : {}),
          })
        }
        out.push({ kind: 'quad', nodeId: surface.nodeId, vertices })
      }
    }
    return out
  }

  dispose(): void {
    // Detach as well as free: the animated-topo path rebuilds the overlay
    // while the scene root LIVES ON (main.ts rebuildAnimatedOverlays), and a
    // disposed-but-attached LineSegments2 would go on drawing stale membership.
    for (const g of this.plotGroups) {
      g.object.removeFromParent()
      g.dispose()
    }
    for (const s of this.surfaces) {
      s.object.removeFromParent()
      s.dispose()
    }
  }
}

export interface TopologyOverlayOptions {
  /** Desktop "Show Hidden Nodes": draw overlays for hidden parents/children. */
  showHidden?: boolean
  /** Decoded media, texture_id → texture: what a Surface parent's own
   *  texture_id drapes across its mesh. Read live, so a texture merged into
   *  this map later is picked up without rebuilding the overlay. */
  textures?: ReadonlyMap<number, THREE.Texture>
}

/**
 * Collect the scene's Plot polylines and Surface meshes. `frames` is the
 * builder's id→frame map; `nodes` must be in FILE order, which is what makes
 * a Plot's polyline follow its intended path.
 */
export function buildTopologyOverlay(
  nodes: GvNode[],
  frames: ReadonlyMap<number, THREE.Object3D>,
  root: THREE.Object3D,
  options: TopologyOverlayOptions = {},
): TopologyOverlay {
  const showHidden = options.showHidden === true
  const visible = (node: GvNode): boolean => showHidden || node.hide === 0

  // Parent → children in file order. Built here rather than reused from
  // buildScene because the desktop's own map differs in two ways that matter:
  // Link (type 7) rows are never children (they draw as edges instead), and a
  // row whose parent_id dangles stays under that missing id rather than being
  // promoted to a root.
  const childrenOf = new Map<number, GvNode[]>()
  for (const node of nodes) {
    if (node.type === NodeType.Link) continue
    if (!node.parentId || node.parentId === node.id) continue
    let kids = childrenOf.get(node.parentId)
    if (!kids) {
      kids = []
      childrenOf.set(node.parentId, kids)
    }
    kids.push(node)
  }

  const framesOf = (kids: GvNode[]): THREE.Object3D[] | null => {
    const out: THREE.Object3D[] = []
    for (const kid of kids) {
      const frame = frames.get(kid.id)
      if (!frame) return null // unreachable subtree (parent cycle); draw nothing
      out.push(frame)
    }
    return out
  }

  // --- Plot polylines ---
  const groupsByKey = new Map<string, PlotGroup>()
  const plotGroups: PlotGroup[] = []
  const plots: PlotPlan[] = []
  for (const node of nodes) {
    if (node.topo !== Topo.Plot || !visible(node)) continue
    const kids = (childrenOf.get(node.id) ?? []).filter(visible)
    if (kids.length < 2) continue
    const kidFrames = framesOf(kids)
    if (!kidFrames) continue
    const widthPx = Math.max(node.ratio * 20, 1) // pixels, desktop convention
    let alphaSum = 0
    const colors = kids.map((kid) => {
      alphaSum += kid.color.a / 255
      return new THREE.Color(kid.color.r / 255, kid.color.g / 255, kid.color.b / 255)
    })
    const alpha = alphaSum / kids.length
    const key = `${widthPx.toFixed(4)}:${alpha.toFixed(6)}`
    let group = groupsByKey.get(key)
    if (!group) {
      group = new PlotGroup(widthPx, alpha)
      groupsByKey.set(key, group)
      plotGroups.push(group)
    }
    const plan: PlotPlan = {
      nodeId: node.id,
      widthPx,
      frames: kidFrames,
      colors,
      alpha,
      group,
      segStart: group.reserve(kids.length - 1),
    }
    group.plans.push(plan)
    plots.push(plan)
  }
  for (const group of plotGroups) group.finalize()

  // --- Surface quad meshes ---
  const surfaces: SurfaceMesh[] = []
  for (const node of nodes) {
    if (node.topo !== Topo.Surface || !visible(node)) continue
    const kids = (childrenOf.get(node.id) ?? []).filter(visible)
    if (kids.length < 4) continue

    // Bucket on the EXACT (translate_x, translate_y), rounded to 6 decimals —
    // a corner that differs in the 7th decimal is a hole in the mesh, which
    // is why the spec tells authors to emit identical values, not accumulated
    // floats. A later row at the same cell replaces an earlier one.
    const cells = new Map<string, GvNode>()
    const xs = new Set<number>()
    const ys = new Set<number>()
    for (const kid of kids) {
      const x = roundLattice(kid.translate.x)
      const y = roundLattice(kid.translate.y)
      cells.set(cellKey(x, y), kid)
      xs.add(x)
      ys.add(y)
    }
    const xAxis = [...xs].sort((a, b) => a - b)
    const yAxis = [...ys].sort((a, b) => a - b)
    if (xAxis.length < 2 || yAxis.length < 2) continue

    const corners: GvNode[] = []
    for (let ri = 0; ri < yAxis.length - 1; ri++) {
      for (let ci = 0; ci < xAxis.length - 1; ci++) {
        const n00 = cells.get(cellKey(xAxis[ci], yAxis[ri]))
        const n10 = cells.get(cellKey(xAxis[ci + 1], yAxis[ri]))
        const n11 = cells.get(cellKey(xAxis[ci + 1], yAxis[ri + 1]))
        const n01 = cells.get(cellKey(xAxis[ci], yAxis[ri + 1]))
        if (!n00 || !n10 || !n11 || !n01) continue
        corners.push(n00, n10, n11, n01)
      }
    }
    if (corners.length === 0) continue
    const cornerFrames = framesOf(corners)
    if (!cornerFrames) continue
    // Baked with the lattice, like its membership: texcoords are a function of
    // the corners' translate_x/y, which re-form the lattice at a rebuild anyway.
    const uvs = new Float32Array(corners.length * 2)
    corners.forEach((corner, v) => {
      const [u, w] = surfaceUv(corner.translate.x, corner.translate.y, xAxis, yAxis)
      uvs[v * 2] = u
      uvs[v * 2 + 1] = w
    })
    surfaces.push(new SurfaceMesh(node, corners, cornerFrames, uvs, options.textures))
  }

  const overlay = new TopologyOverlay(plotGroups, plots, surfaces)
  root.add(overlay.group)
  if (!overlay.isEmpty) {
    root.updateMatrixWorld(true) // once, so the first frame is exact
    overlay.update()
  }
  return overlay
}

/** The desktop's `round(value, 6)` — Python rounds half to EVEN. */
function roundLattice(value: number): number {
  const scale = 10 ** LATTICE_DECIMALS
  return roundHalfToEven(value * scale) / scale
}

/** Map key for a lattice cell. `-0` prints as `0`, matching Python's dict,
 *  where -0.0 and 0.0 hash and compare equal. */
function cellKey(x: number, y: number): string {
  return `${x},${y}`
}
