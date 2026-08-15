// Node picking and the selection highlight, matching the desktop viewport:
// picking hits solid silhouettes (invisible solid proxies — see
// createPickProxy), and the highlight is a yellow wireframe box at ±1.05 in
// the node's unit local space (viewport.py _draw_selected_outlines: color
// 1.0/0.95/0.1, line width 1.5, unlit), sized by the glyph's own draw matrix —
// including the 0.2 scale floor — so it tracks rendered size. Every halo in a
// selection is drawn by a single batched object; see `Selection`.
//
// (line width 1.5 is not reproducible: WebGL's core lines are 1 px whatever a
// LineBasicMaterial asks for. The fat-line addon the links use could do it,
// but at 3 instanced quads per halo edge, which is the opposite of what a
// Select All needs.)

import * as THREE from 'three'

/** Desktop selection-outline halo: unit-space half-extent 1.05. */
export const SELECTION_BOX_HALF = 1.05
/** Desktop selection color glColor4f(1.0, 0.95, 0.1, 1.0). */
export const SELECTION_COLOR = new THREE.Color(1.0, 0.95, 0.1)

/**
 * Nearest picked node id along the ray, or null. Two kinds of hit count,
 * mirroring the two things the desktop's pick pass draws:
 *
 *  - pick-proxy hits, the invisible solid silhouette of a glyph (see
 *    createPickProxy). World/Camera rows and hidden nodes have no proxy, so
 *    they are unpickable by construction;
 *  - Link (type 7) edges, whose picker reports a ray-to-segment hit and
 *    resolves it to the link row through its own id table.
 *
 * World Grids are never pickable (select them with the G key), but a SOLID
 * grid surface still occludes — a click can't reach a glyph hidden behind the
 * plate/globe; wire grids don't occlude.
 */
export function pickNodeId(raycaster: THREE.Raycaster, root: THREE.Object3D): number | null {
  for (const hit of raycaster.intersectObject(root, true)) {
    if (hit.object.userData.isGridOccluder) return null
    if (hit.object.userData.isLinkPicker) {
      const ids = hit.object.userData.linkIds as number[] | undefined
      const id = ids?.[hit.faceIndex ?? -1]
      if (id !== undefined) return id
      continue
    }
    if (!hit.object.userData.isPickProxy) continue
    let o: THREE.Object3D | null = hit.object
    let hiddenGlyph = false
    while (o && o.userData.nodeId === undefined) {
      // A channel-animated `hide` blanks the glyph by visibility rather than
      // by rebuilding (dynamicNodes.ts), and the raycaster ignores `visible`
      // — so an animated-hidden node must be skipped here, exactly as a
      // CSV-hidden one is unpickable by never getting a proxy. It does not
      // occlude: the desktop's pick pass simply doesn't draw it.
      if (o.userData.isGlyph && !o.visible) hiddenGlyph = true
      o = o.parent
    }
    if (hiddenGlyph) continue
    if (o) return o.userData.nodeId as number
  }
  return null
}

/** id → frame, as returned by buildScene. */
export type FrameLookup = ReadonlyMap<number, THREE.Object3D>

/**
 * Ceiling on how many halos are drawn at once — a memory guard, not a draw
 * budget: every halo lives in ONE batched object (see `Selection`), so the
 * cost of the next one is 8 vertices and 24 indices, 192 bytes of GPU buffer.
 * At this cap that is ~48 MB, and it clears Event_Cloud's 209k nodes, so a
 * Select All draws complete on every example in the corpus.
 *
 * (It used to be 1,000, when each halo was its own draw call. That silently
 * left most of a Ctrl+A selection un-outlined while the selection itself was
 * complete — the nodes still took edits, which is exactly how it was noticed.)
 *
 * Past the cap the selection still stays complete and only the highlight
 * stops drawing; `haloOverflow` reports how many.
 */
export const MAX_HALOS = 250_000

/** Vertices per halo: the 8 box corners, indexed into 12 edges. */
const CORNERS = 8
/** Indices per halo: 12 edges × 2 ends. */
const INDICES = 24

/**
 * The 12 box edges as corner-index pairs. A corner index packs its three signs
 * as bits — x = bit 2, y = bit 1, z = bit 0, set meaning + — so an edge is any
 * pair differing in exactly one bit.
 */
const BOX_EDGES = [
  0, 1, 2, 3, 4, 5, 6, 7, // along z
  0, 2, 1, 3, 4, 6, 5, 7, // along y
  0, 4, 1, 5, 2, 6, 3, 7, // along x
]

/**
 * Multi-selection holder: draws a yellow halo around each selected node's
 * glyph, all of them in ONE batched LineSegments (`object`, which the app adds
 * to the scene once and keeps forever — it is chrome, not scene content, so it
 * lives outside the built root and survives every rebuild).
 *
 * Halos used to be a LineSegments per node, parented to the glyph: tracking
 * came free (the glyph's own draw matrix, 0.2 scale floor included, positioned
 * the box) but each cost a draw call, which is what forced a 1,000-node cap.
 * Batching flips that trade — the boxes are written in WORLD space, so they
 * have to be refreshed whenever a node moves (`refreshHalos`, called from the
 * animation loop exactly as linkOverlay and topologyOverlay already are). The
 * box is still the glyph's own ±1.05 cube: its corners are the glyph's
 * matrixWorld applied to those signs, which is what parenting used to compute.
 *
 * The *primary* node — the one the gizmo attaches to and the inspector reads
 * its field values from — is the first selected node in scene row order,
 * matching the desktop, where the inspector reads `_selected_nodes[0]` from
 * the node table's row-ordered selection.
 *
 * Nodes without a glyph (Links, hidden nodes) are still selectable when their
 * frame exists — keyboard navigation reaches them and the inspector shows
 * them, just with no halo. Same as the desktop, whose nav/table selects them
 * while the outline pass skips them.
 */
export class Selection {
  /** The glyphs a halo is drawn around, in halo-slot order. */
  private glyphs: THREE.Object3D[] = []
  /**
   * Each halo's local-space z bounds, parallel to `glyphs`. ±1.05 for an
   * ordinary glyph; a stretched LINK glyph instead carries the geometry's own
   * z span mapped onto the edge (`userData.haloZ`), which is not always
   * symmetric — a Pin's runs 0…1.1, and a box drawn at ±1.05 around it would
   * sit half a link off its own limb. Desktop `_draw_selection_box`'s
   * z_lo/z_hi arguments, which exist for exactly this.
   */
  private zSpans: [number, number][] = []
  /**
   * Link id → the stretched glyph drawn for it (`LinkOverlay.glyphObjects`).
   * A link's halo cannot be found the usual way — its glyph hangs off the link
   * overlay in world space, not off its own frame — so the app hands this over
   * once per scene build. Line and prism links never appear in it and stay
   * halo-less, matching the desktop's outline pass.
   */
  private linkGlyphs: ReadonlyMap<number, THREE.Object3D> = new Map()
  private order: number[] = []
  private members = new Set<number>()
  private overflow = 0
  private boxesVisible = true
  private readonly maxHalos: number
  private capacity = 0
  private positions = new THREE.BufferAttribute(new Float32Array(0), 3)

  /** The whole selection's halos, as one object. Add it to the scene once. */
  readonly object: THREE.LineSegments

  constructor(options: { maxHalos?: number } = {}) {
    this.maxHalos = options.maxHalos ?? MAX_HALOS
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', this.positions)
    this.object = new THREE.LineSegments(
      geometry,
      // fog: false — halos are chrome, and a halo out at fog_end would vanish
      // into the murk with the glyph it exists to outline (render/fog.ts).
      new THREE.LineBasicMaterial({ color: SELECTION_COLOR, fog: false }),
    )
    this.object.name = 'selection-boxes'
    this.object.userData.isSelectionBox = true
    this.object.raycast = () => {} // chrome is never a pick target
    // Vertices are world-space and rewritten as nodes move; culling them
    // against a bounding sphere that would have to be recomputed just as often
    // buys nothing (the same call linkOverlay makes).
    this.object.frustumCulled = false
    this.object.visible = false
  }

  /** Selected ids in scene row order; `[0]` is the primary. */
  get ids(): readonly number[] {
    return this.order
  }

  /** The primary node id (gizmo target, inspector anchor), or null. */
  get id(): number | null {
    return this.order.length > 0 ? this.order[0] : null
  }

  get size(): number {
    return this.order.length
  }

  /** Selected nodes beyond MAX_HALOS, which are drawn without a halo. */
  get haloOverflow(): number {
    return this.overflow
  }

  /**
   * Desktop `Viewport.show_selection_box`: the yellow boxes are a render-only
   * decoration, so hiding them leaves the selection itself — primary node,
   * gizmo target, every command — completely untouched. That is the point:
   * a clean screengrab of a chosen state, without having to deselect and
   * reselect afterwards.
   */
  get boxVisible(): boolean {
    return this.boxesVisible
  }

  set boxVisible(value: boolean) {
    this.boxesVisible = value
    this.syncVisibility()
  }

  /** How many halos are actually being drawn. */
  get haloCount(): number {
    return this.glyphs.length
  }

  has(nodeId: number): boolean {
    return this.members.has(nodeId)
  }

  asSet(): Set<number> {
    return new Set(this.order)
  }

  /**
   * Select exactly these ids, in the order given (so the caller decides the
   * primary by passing scene row order). Ids with no frame in the scene are
   * dropped. `null` or an empty list clears.
   */
  /**
   * Register the scene's stretched link glyphs. Call once per scene build,
   * before any `set` — a rebuild replaces every object, so a stale map would
   * outline a link that no longer exists at a position it no longer has.
   */
  setLinkGlyphs(glyphs: ReadonlyMap<number, THREE.Object3D>): void {
    this.linkGlyphs = glyphs
  }

  set(frames: FrameLookup, ids: number | null | Iterable<number>): void {
    this.glyphs.length = 0
    this.zSpans.length = 0
    this.order.length = 0
    this.members.clear()
    this.overflow = 0

    for (const nodeId of ids === null ? [] : typeof ids === 'number' ? [ids] : ids) {
      const frame = frames.get(nodeId)
      if (!frame || this.members.has(nodeId)) continue // not in the scene at all
      this.members.add(nodeId)
      this.order.push(nodeId)
      const glyph = frame.children.find((c) => c.userData.isGlyph) ?? this.linkGlyphs.get(nodeId)
      if (!glyph) continue
      if (this.glyphs.length >= this.maxHalos) {
        this.overflow++
        continue
      }
      this.glyphs.push(glyph)
      const z = glyph.userData.haloZ as [number, number] | undefined
      this.zSpans.push(z ?? [-SELECTION_BOX_HALF, SELECTION_BOX_HALF])
    }

    this.reserve(this.glyphs.length)
    this.object.geometry.setDrawRange(0, this.glyphs.length * INDICES)
    this.syncVisibility()
    this.refreshHalos()
  }

  /**
   * Rewrite every halo's world-space corners from the glyph matrices. Cheap
   * and allocation-free (8 corners of a parallelepiped are three axis vectors
   * added to a centre), but O(selection), so the app calls it only when
   * something can have moved — a gizmo drag, a Channels/rate tick, a rebuild —
   * exactly like the link and topology overlays. Reads the matrixWorld state
   * left by the last render pass and never forces a recompute of its own.
   */
  refreshHalos(): void {
    if (this.glyphs.length === 0) return // nothing drawn, nothing to upload
    const b = SELECTION_BOX_HALF
    const p = this.positions.array as Float32Array
    for (let i = 0; i < this.glyphs.length; i++) {
      const e = this.glyphs[i].matrixWorld.elements
      // Half-extent along each of the glyph's own (scaled, rotated) axes.
      const ax = e[0] * b
      const ay = e[1] * b
      const az = e[2] * b
      const bx = e[4] * b
      const by = e[5] * b
      const bz = e[6] * b
      // Z takes its two bounds separately rather than a half-extent: they are
      // symmetric for every ordinary glyph and are not for a link's.
      const [zLo, zHi] = this.zSpans[i]
      let o = i * CORNERS * 3
      for (let corner = 0; corner < CORNERS; corner++) {
        const sx = corner & 4 ? 1 : -1
        const sy = corner & 2 ? 1 : -1
        const z = corner & 1 ? zHi : zLo
        p[o++] = e[12] + sx * ax + sy * bx + z * e[8]
        p[o++] = e[13] + sx * ay + sy * by + z * e[9]
        p[o++] = e[14] + sx * az + sy * bz + z * e[10]
      }
    }
    // Upload only the slots in use — the buffer keeps its high-water size, and
    // a 250k-capacity full upload every animated frame would not be free.
    this.positions.clearUpdateRanges()
    this.positions.addUpdateRange(0, this.glyphs.length * CORNERS * 3)
    this.positions.needsUpdate = true
  }

  /** Grow the vertex/index buffers to hold `count` halos (never shrink). */
  private reserve(count: number): void {
    if (count <= this.capacity) return
    // Geometric growth: a rubber-band sweep or a run of Ctrl+click grows the
    // selection one step at a time, and each step would otherwise reallocate.
    this.capacity = Math.max(64, this.capacity * 2, count)
    this.positions = new THREE.BufferAttribute(new Float32Array(this.capacity * CORNERS * 3), 3)
    this.positions.setUsage(THREE.DynamicDrawUsage)
    // The index pattern is fixed per slot, so it is written once per growth
    // and never touched again as the selection changes.
    const index = new Uint32Array(this.capacity * INDICES)
    for (let i = 0; i < this.capacity; i++) {
      for (let k = 0; k < INDICES; k++) index[i * INDICES + k] = i * CORNERS + BOX_EDGES[k]
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', this.positions)
    geometry.setIndex(new THREE.BufferAttribute(index, 1))
    // A whole new geometry rather than new attributes on the old one, because
    // disposing the GEOMETRY is what frees the outgrown GL buffers — under the
    // WebGL renderer BufferAttribute.dispose() only fires an event nobody
    // listens to. Growth is O(log n) over a session, so the churn is nothing.
    this.object.geometry.dispose()
    this.object.geometry = geometry
  }

  private syncVisibility(): void {
    this.object.visible = this.boxesVisible && this.glyphs.length > 0
  }
}
