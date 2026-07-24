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
 * hidden nodes have no proxy, so they are unpickable by construction.
 */
export function pickNodeId(raycaster: THREE.Raycaster, root: THREE.Object3D): number | null {
  for (const hit of raycaster.intersectObject(root, true)) {
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

/**
 * Single-selection holder: moves one shared halo onto the selected node's
 * glyph. (Desktop supports multi-select; single is the Tier-1 scope.)
 */
export class Selection {
  private box = createSelectionBox()
  private selectedId: number | null = null

  get id(): number | null {
    return this.selectedId
  }

  /** Select the node (attaching the halo to its glyph), or clear with null. */
  set(root: THREE.Object3D, nodeId: number | null): void {
    this.box.removeFromParent()
    this.selectedId = null
    if (nodeId === null) return
    const frame = root.getObjectByName(`gv:${nodeId}`)
    const glyph = frame?.children.find((c) => c.userData.isGlyph)
    if (!glyph) return // non-visual or hidden node: nothing to halo
    glyph.add(this.box)
    this.selectedId = nodeId
  }
}
