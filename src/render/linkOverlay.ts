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
// Endpoints are node positions, so edges must track them live (gizmo drags,
// inspector edits). The desktop redraws immediate-mode every frame; the
// overlay mirrors that with update() recomputing endpoint world positions
// per frame. Links are never pickable (raycast no-op'd), matching the
// desktop's pick pass exclusion, and a hidden link draws nothing.

import * as THREE from 'three'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import type { GvNode } from '../gv/types'
import { Geometry, NodeType } from '../gv/types'
import { linkChildId } from '../gv/links'

const MIN_PRISM_RADIUS = 0.01
const EPS = 1e-6

interface LinkEntry {
  aFrame: THREE.Object3D
  bFrame: THREE.Object3D
  apply: (a: THREE.Vector3, b: THREE.Vector3) => void
}

/**
 * All rendered link edges of one built scene. Attach `group` under the
 * scene root (buildScene does), call `update()` once per frame and
 * `setResolution` on init/resize for correct line pixel widths.
 */
export class LinkOverlay {
  readonly group = new THREE.Group()
  private entries: LinkEntry[] = []
  private lineMaterials: LineMaterial[] = []
  private root: THREE.Object3D

  constructor(root: THREE.Object3D) {
    this.root = root
    this.group.name = 'link-overlay'
  }

  get count(): number {
    return this.entries.length
  }

  /** Viewport size in device pixels — LineMaterial's screen-space widths. */
  setResolution(width: number, height: number): void {
    for (const m of this.lineMaterials) m.resolution.set(width, height)
  }

  /** Recompute every edge from its endpoints' current world positions. */
  update(): void {
    if (this.entries.length === 0) return
    this.root.updateMatrixWorld(true)
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    for (const e of this.entries) {
      a.setFromMatrixPosition(e.aFrame.matrixWorld)
      b.setFromMatrixPosition(e.bFrame.matrixWorld)
      e.apply(a, b)
    }
  }

  addLine(link: GvNode, aFrame: THREE.Object3D, bFrame: THREE.Object3D): void {
    const geometry = new LineGeometry()
    geometry.setPositions([0, 0, 0, 0, 0, 0])
    const material = new LineMaterial({
      color: colorOf(link).getHex(),
      linewidth: Math.max(link.ratio * 20, 1), // pixels, desktop convention
      transparent: link.color.a < 255,
      opacity: link.color.a / 255,
    })
    this.lineMaterials.push(material)
    const line = new Line2(geometry, material)
    line.raycast = () => {} // never pickable
    this.group.add(line)
    this.entries.push({
      aFrame,
      bFrame,
      apply: (a, b) => {
        geometry.setPositions([a.x, a.y, a.z, b.x, b.y, b.z])
        line.visible = a.distanceToSquared(b) > EPS * EPS
      },
    })
  }

  addPrism(link: GvNode, aFrame: THREE.Object3D, bFrame: THREE.Object3D): void {
    // Two 4-corner rings (A then B), 4 quad side faces. DoubleSide spares
    // us the desktop's hand-derived winding (which shipped inverted once).
    const positions = new Float32Array(8 * 3)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const index: number[] = []
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4
      index.push(i, j, 4 + j, i, 4 + j, 4 + i)
    }
    geometry.setIndex(index)
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: colorOf(link),
        transparent: link.color.a < 255,
        opacity: link.color.a / 255,
        side: THREE.DoubleSide,
      }),
    )
    mesh.raycast = () => {} // never pickable
    this.group.add(mesh)

    const radius = Math.max(link.ratio, MIN_PRISM_RADIUS)
    const dir = new THREE.Vector3()
    const right = new THREE.Vector3()
    const up = new THREE.Vector3()
    const corner = new THREE.Vector3()
    this.entries.push({
      aFrame,
      bFrame,
      apply: (a, b) => {
        dir.subVectors(b, a)
        const length = dir.length()
        mesh.visible = length > EPS
        if (!mesh.visible) return
        dir.divideScalar(length)
        // Arbitrary-up basis: cross with a reference axis not (near-)
        // parallel to the direction, then cross again (desktop's trick).
        const ref = Math.abs(dir.z) < 0.99 ? UNIT_Z : UNIT_X
        right.crossVectors(dir, ref).normalize()
        up.crossVectors(right, dir)
        // Ring order stepping consistently around the square: ++, +−, −−, −+.
        const ring: ReadonlyArray<readonly [number, number]> = [
          [1, 1],
          [1, -1],
          [-1, -1],
          [-1, 1],
        ]
        for (let i = 0; i < 4; i++) {
          const [s, t] = ring[i]
          corner
            .copy(right)
            .multiplyScalar(s * radius)
            .addScaledVector(up, t * radius)
          positions[i * 3] = a.x + corner.x
          positions[i * 3 + 1] = a.y + corner.y
          positions[i * 3 + 2] = a.z + corner.z
          positions[(4 + i) * 3] = b.x + corner.x
          positions[(4 + i) * 3 + 1] = b.y + corner.y
          positions[(4 + i) * 3 + 2] = b.z + corner.z
        }
        geometry.attributes.position.needsUpdate = true
        geometry.computeBoundingSphere()
      },
    })
  }
}

const UNIT_Z = new THREE.Vector3(0, 0, 1)
const UNIT_X = new THREE.Vector3(1, 0, 0)

function colorOf(link: GvNode): THREE.Color {
  return new THREE.Color(link.color.r / 255, link.color.g / 255, link.color.b / 255)
}

/**
 * Collect the scene's renderable link edges. Skips (with a warning where
 * the file is at fault) links that are hidden, endpoint-less (either id 0,
 * the desktop's "pending" state), or dangling.
 */
export function buildLinkOverlay(
  nodes: GvNode[],
  root: THREE.Object3D,
  warn: (message: string) => void,
): LinkOverlay {
  const overlay = new LinkOverlay(root)
  for (const node of nodes) {
    if (node.type !== NodeType.Link || node.hide !== 0) continue
    const aId = node.parentId
    const bId = linkChildId(node)
    if (!aId || !bId) {
      warn(`Link node ${node.id}: missing A-end (parent_id) or B-end (child_id); edge not drawn.`)
      continue
    }
    const aFrame = root.getObjectByName(`gv:${aId}`)
    const bFrame = root.getObjectByName(`gv:${bId}`)
    if (!aFrame || !bFrame) {
      warn(`Link node ${node.id}: endpoint node ${aFrame ? bId : aId} not found; edge not drawn.`)
      continue
    }
    if (node.geometry === Geometry.TexturedPrism) {
      overlay.addPrism(node, aFrame, bFrame)
    } else {
      overlay.addLine(node, aFrame, bFrame)
    }
  }
  root.add(overlay.group)
  overlay.update()
  return overlay
}
