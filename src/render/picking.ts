// Node picking and the selection highlight, matching the desktop viewport:
// picking hits solid silhouettes (invisible solid proxies — see
// createPickProxy), and the highlight is a yellow wireframe box at ±1.05 in
// the node's unit local space (viewport.py _draw_selected_outlines: color
// 1.0/0.95/0.1, line width 1.5, unlit), attached to the glyph so the node's
// draw matrix — including the 0.2 scale floor — makes it track rendered size.

import * as THREE from 'three'

/** Desktop selection-outline halo: unit-space half-extent 1.05. */
export const SELECTION_BOX_HALF = 1.05
/** Desktop selection color glColor4f(1.0, 0.95, 0.1, 1.0). */
export const SELECTION_COLOR = new THREE.Color(1.0, 0.95, 0.1)

/**
 * Nearest picked node id along the ray, or null. Only pick-proxy hits count
 * (mirrors the desktop's solid-silhouette pick pass); World/Camera/Link and
 * hidden nodes have no proxy, so they are unpickable by construction. World
 * Grids are never pickable either (select them with the G key), but a SOLID
 * grid surface still occludes — a click can't reach a glyph hidden behind
 * the plate/globe; wire grids don't occlude.
 */
export function pickNodeId(raycaster: THREE.Raycaster, root: THREE.Object3D): number | null {
  for (const hit of raycaster.intersectObject(root, true)) {
    if (hit.object.userData.isGridOccluder) return null
    if (!hit.object.userData.isPickProxy) continue
    let o: THREE.Object3D | null = hit.object
    while (o && o.userData.nodeId === undefined) o = o.parent
    if (o) return o.userData.nodeId as number
  }
  return null
}

/** The yellow ±1.05 bounding-box halo. Add as a child of the node's glyph. */
export function createSelectionBox(): THREE.LineSegments {
  const b = SELECTION_BOX_HALF
  const positions: number[] = []
  for (const sx of [-b, b]) {
    for (const sy of [-b, b]) positions.push(sx, sy, -b, sx, sy, b)
  }
  for (const sx of [-b, b]) {
    for (const sz of [-b, b]) positions.push(sx, -b, sz, sx, b, sz)
  }
  for (const sy of [-b, b]) {
    for (const sz of [-b, b]) positions.push(-b, sy, sz, b, sy, sz)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  const box = new THREE.LineSegments(
    geo,
    new THREE.LineBasicMaterial({ color: SELECTION_COLOR, linewidth: 1.5 }),
  )
  box.name = 'selection-box'
  box.userData.isSelectionBox = true
  return box
}

/** id → frame, as returned by buildScene. */
export type FrameLookup = ReadonlyMap<number, THREE.Object3D>

/**
 * Halos are one LineSegments each, parented to the node's glyph so the draw
 * matrix (including the 0.2 scale floor) makes them track rendered size — but
 * that means one extra draw call per selected node. Select All on the 65k-node
 * Org_Event_Network would grind, so past this many the selection stays
 * complete and only the halos stop being drawn (see `haloOverflow`).
 */
export const MAX_HALOS = 1000

/**
 * Multi-selection holder: parks a yellow halo on each selected node's glyph.
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
  private pool: THREE.LineSegments[] = []
  private attached: THREE.LineSegments[] = []
  private order: number[] = []
  private members = new Set<number>()
  private overflow = 0

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
  set(frames: FrameLookup, ids: number | null | Iterable<number>): void {
    for (const box of this.attached) box.removeFromParent()
    this.attached.length = 0
    this.order.length = 0
    this.members.clear()
    this.overflow = 0
    if (ids === null) return

    for (const nodeId of typeof ids === 'number' ? [ids] : ids) {
      const frame = frames.get(nodeId)
      if (!frame || this.members.has(nodeId)) continue // not in the scene at all
      this.members.add(nodeId)
      this.order.push(nodeId)
      const glyph = frame.children.find((c) => c.userData.isGlyph)
      if (!glyph) continue
      if (this.attached.length >= MAX_HALOS) {
        this.overflow++
        continue
      }
      const box = this.pool[this.attached.length] ?? createSelectionBox()
      this.pool[this.attached.length] = box
      this.attached.push(box)
      glyph.add(box)
    }
  }
}
