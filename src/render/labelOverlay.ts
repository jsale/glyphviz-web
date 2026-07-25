// Tag labels — a 2D overlay, not 3D text.
//
// Ported from the desktop's _project_tagged_nodes / _paint_tags
// (glyphviz_gl/viewport.py): every eligible node's world position is projected
// to screen space and the label is painted with a QPainter overlay above the
// GL scene. Reproducing that as a canvas-2D layer over the WebGL canvas keeps
// the placement, styling and cost profile identical — labels never scale with
// distance, never z-fight, and never rotate with the camera.

import * as THREE from 'three'
import { NodeType } from '../gv/types'
import type { GvNode } from '../gv/types'

/**
 * Frame-rate safety valve, matching the desktop: in show-all mode at most 500
 * labels paint per frame — the first 500 eligible ones in file order. It is
 * deliberately NOT applied in selected-only mode, where the user has scoped
 * the set explicitly and completeness beats frame rate.
 */
export const MAX_TAGS_PER_FRAME = 500

// Desktop paint constants. Qt's 9pt at 96 dpi is 12 device-independent px;
// drawStaticText anchors top-left and the desktop subtracts the font ascent to
// land on the old drawText baseline — canvas fillText is baseline-anchored, so
// the offsets apply directly.
const FONT = '12px system-ui, "Segoe UI", sans-serif'
const SHADOW_COLOR = 'rgba(0, 0, 0, 0.784)' // QColor(0, 0, 0, 200)
const FACE_COLOR = 'rgba(255, 255, 200, 0.902)' // QColor(255, 255, 200, 230)
export const LABEL_OFFSET_X = 5
export const LABEL_SHADOW_DX = 1
export const LABEL_SHADOW_DY = 1

export interface LabelOverlayState {
  showTags: boolean
  selectedOnly: boolean
  showHidden: boolean
  /** Membership test, not a set: this runs every frame and must not allocate. */
  isSelected(nodeId: number): boolean
}

/** Types that never draw a label: World/Camera rows and Link nodes. */
function eligibleType(type: number): boolean {
  return type !== NodeType.World && type !== NodeType.Camera && type !== NodeType.Link
}

export interface LabelPlacement {
  text: string
  /** Viewport pixel position of the node centre (before the paint offsets). */
  x: number
  y: number
}

const clip = new THREE.Vector4()
const world = new THREE.Vector3()
const viewProjection = new THREE.Matrix4()

/**
 * Project every eligible label to viewport pixels, in file order.
 *
 * The paint-free half of the overlay: same filtering, projection and cap the
 * desktop's _project_tagged_nodes applies, so it can be tested without a DOM.
 * Because the cap counts labels that actually land on screen and both sides
 * walk the nodes in file order, stopping early at the cap yields exactly the
 * desktop's set — it just skips projecting the remainder.
 */
export function placeLabels(
  nodes: readonly GvNode[],
  frames: ReadonlyMap<number, THREE.Object3D>,
  camera: THREE.Camera,
  state: LabelOverlayState,
  width: number,
  height: number,
): LabelPlacement[] {
  const placed: LabelPlacement[] = []
  if (!state.showTags || width === 0 || height === 0) return placed

  const cap = state.selectedOnly ? Infinity : MAX_TAGS_PER_FRAME
  viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)

  for (const node of nodes) {
    if (node.text === '') continue
    if (!eligibleType(node.type)) continue
    if (node.hide && !state.showHidden) continue
    if (state.selectedOnly && !state.isSelected(node.id)) continue

    const frame = frames.get(node.id)
    if (frame) frame.getWorldPosition(world)
    else world.set(node.translate.x, node.translate.y, node.translate.z)

    clip.set(world.x, world.y, world.z, 1).applyMatrix4(viewProjection)
    const w = clip.w
    if (w <= 0) continue // behind the camera
    const ndcX = clip.x / w
    const ndcY = clip.y / w
    const ndcZ = clip.z / w
    if (ndcX < -1 || ndcX > 1 || ndcY < -1 || ndcY > 1 || ndcZ < -1 || ndcZ > 1) continue

    placed.push({
      text: node.text,
      x: Math.floor(((ndcX + 1) / 2) * width),
      y: Math.floor((1 - (ndcY + 1) / 2) * height),
    })
    if (placed.length >= cap) break
  }
  return placed
}

export class LabelOverlay {
  readonly canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private width = 0
  private height = 0
  /** Labels painted on the last render. */
  drawnCount = 0

  constructor() {
    this.canvas = document.createElement('canvas')
    this.canvas.id = 'label-overlay'
    // Purely decorative: never steal a click from the viewport beneath.
    this.canvas.style.pointerEvents = 'none'
    this.ctx = this.canvas.getContext('2d')!
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.width = width
    this.height = height
    this.canvas.width = Math.round(width * pixelRatio)
    this.canvas.height = Math.round(height * pixelRatio)
    this.canvas.style.width = `${width}px`
    this.canvas.style.height = `${height}px`
    this.ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
  }

  /**
   * Repaint the labels for one frame. Call after renderer.render(), so world
   * matrices are the ones just drawn (gizmo drags move frames between scene
   * rebuilds).
   */
  render(
    nodes: readonly GvNode[],
    frames: ReadonlyMap<number, THREE.Object3D>,
    camera: THREE.Camera,
    state: LabelOverlayState,
  ): void {
    this.ctx.clearRect(0, 0, this.width, this.height)
    this.drawnCount = 0

    const placed = placeLabels(nodes, frames, camera, state, this.width, this.height)
    if (placed.length === 0) return

    // Two single-colour passes, shadow then face — the desktop's own trick for
    // avoiding a pen switch per label.
    this.ctx.font = FONT
    this.ctx.textBaseline = 'alphabetic'
    this.ctx.fillStyle = SHADOW_COLOR
    for (const p of placed) {
      this.ctx.fillText(p.text, p.x + LABEL_OFFSET_X + LABEL_SHADOW_DX, p.y + LABEL_SHADOW_DY)
    }
    this.ctx.fillStyle = FACE_COLOR
    for (const p of placed) {
      this.ctx.fillText(p.text, p.x + LABEL_OFFSET_X, p.y)
    }
    this.drawnCount = placed.length
  }
}
