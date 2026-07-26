// Tag labels — a 2D overlay, not 3D text.
//
// Ported from the desktop's _project_tagged_nodes / _paint_tags
// (glyphviz_gl/viewport.py): every eligible node's world position is projected
// to screen space and the label is painted with a QPainter overlay above the
// GL scene. Reproducing that as a canvas-2D layer over the WebGL canvas keeps
// the placement, styling and cost profile identical — labels never scale with
// distance, never z-fight, and never rotate with the camera.

import * as THREE from 'three'
import { linkChildId } from '../gv/links'
import { NodeType, TAG_DEFAULT_TEXT_RGB, TAG_SHADOW_RGBA, TAG_TEXT_ALPHA, TagColorMode } from '../gv/types'
import type { GvNode, Rgb } from '../gv/types'

/**
 * Frame-rate safety valve, matching the desktop: in show-all mode at most 500
 * labels paint per frame — the first 500 eligible ones in file order. It is
 * deliberately NOT applied in selected-only mode, where the user has scoped
 * the set explicitly and completeness beats frame rate, nor to individually
 * pinned labels (show_text), which are an explicit per-node request.
 */
export const MAX_TAGS_PER_FRAME = 500

// Desktop paint constants. Qt's 9pt at 96 dpi is 12 device-independent px;
// drawStaticText anchors top-left and the desktop subtracts the font ascent to
// land on the old drawText baseline — canvas fillText is baseline-anchored, so
// the offsets apply directly.
const FONT = '12px system-ui, "Segoe UI", sans-serif'
const SHADOW_COLOR = `rgba(${TAG_SHADOW_RGBA.r}, ${TAG_SHADOW_RGBA.g}, ${TAG_SHADOW_RGBA.b}, ${
  TAG_SHADOW_RGBA.a / 255
})`
export const LABEL_OFFSET_X = 5
export const LABEL_SHADOW_DX = 1
export const LABEL_SHADOW_DY = 1

/** Canvas fill style for a tag face colour, at the fixed face alpha. */
function faceStyle(rgb: Rgb): string {
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${TAG_TEXT_ALPHA / 255})`
}

export interface LabelOverlayState {
  showTags: boolean
  selectedOnly: boolean
  showHidden: boolean
  /** Membership test, not a set: this runs every frame and must not allocate. */
  isSelected(nodeId: number): boolean
  /**
   * Nodes whose `show_text` pins their label on screen. Precomputed per scene
   * build (`pinnedTagNodes`) rather than rescanned here: with labels off, a
   * scene that pins three of its 209k nodes must cost three checks a frame,
   * not 209k. The desktop rescans, guarded only by a cached "any pinned at
   * all" flag.
   */
  pinned: readonly GvNode[]
  /** World-row tag styling — TagColorMode.Uniform paints every label `tagColor`. */
  tagColorMode: number
  tagColor: Rgb
}

/** The scene's pinned-label nodes, in file order. Recompute on scene rebuild. */
export function pinnedTagNodes(nodes: readonly GvNode[]): GvNode[] {
  // Deliberately not ANDed with `text`: whether a pinned node has text yet
  // changes on every keystroke in the inspector, and the placement pass
  // already skips empty labels.
  return nodes.filter((n) => n.showText !== 0)
}

export interface LabelPlacement {
  text: string
  /** Viewport pixel position of the node centre (before the paint offsets). */
  x: number
  y: number
  /** Face colour under TagColorMode.Node; absent under the uniform mode. */
  rgb?: Rgb
}

const clip = new THREE.Vector4()
const world = new THREE.Vector3()
const other = new THREE.Vector3()
const viewProjection = new THREE.Matrix4()

/** Types that never draw a label at their own frame: the World/Camera rows. */
function nonVisual(type: number): boolean {
  return type === NodeType.World || type === NodeType.Camera
}

/**
 * Where a node's label anchors, in world space.
 *
 * A Link (type 7) anchors to the MIDDLE of the edge it draws — the desktop's
 * _link_label_anchor — because its own frame sits wherever its translate puts
 * it (usually right on top of the A-end glyph), which says nothing about the
 * edge the label is naming. When an endpoint is missing or unresolvable the
 * link draws no line but is still selectable, so the label falls back to the
 * link's own position, exactly where a click would hit it.
 */
function labelAnchor(
  node: GvNode,
  frames: ReadonlyMap<number, THREE.Object3D>,
  out: THREE.Vector3,
): void {
  if (node.type === NodeType.Link) {
    const a = frames.get(node.parentId)
    const b = frames.get(linkChildId(node))
    if (a && b) {
      out.setFromMatrixPosition(a.matrixWorld)
      other.setFromMatrixPosition(b.matrixWorld)
      out.add(other).multiplyScalar(0.5)
      return
    }
  }
  const frame = frames.get(node.id)
  if (frame) frame.getWorldPosition(out)
  else out.set(node.translate.x, node.translate.y, node.translate.z)
}

/**
 * Project every eligible label to viewport pixels, in file order.
 *
 * The paint-free half of the overlay: same filtering, projection and cap the
 * desktop's _project_tagged_nodes applies, so it can be tested without a DOM.
 *
 * Two passes, matching the desktop's own structure:
 *
 *   1. the scene-wide pass (nothing at all when labels are off), ordinary
 *      nodes first and Link rows after them, subject to the frame cap;
 *   2. the pinned pass, which ignores both scene-wide tag settings and the
 *      cap. Its members are skipped by pass 1, so nothing labels twice.
 *
 * Because the cap counts labels that actually land on screen, both sides walk
 * the nodes in file order, and the desktop applies the cap to unpinned labels
 * only (`selected[~is_pinned][:cap]`), stopping pass 1 early at the cap yields
 * exactly the desktop's set — it just skips projecting the remainder.
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
  if (width === 0 || height === 0) return placed

  const perNodeColor = state.tagColorMode === TagColorMode.Node
  viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)

  /** Project one candidate; true when it landed on screen and was kept. */
  const consider = (node: GvNode): boolean => {
    if (node.text === '') return false
    if (nonVisual(node.type)) return false
    if (node.hide !== 0 && !state.showHidden) return false

    labelAnchor(node, frames, world)
    clip.set(world.x, world.y, world.z, 1).applyMatrix4(viewProjection)
    const w = clip.w
    if (w <= 0) return false // behind the camera
    const ndcX = clip.x / w
    const ndcY = clip.y / w
    const ndcZ = clip.z / w
    if (ndcX < -1 || ndcX > 1 || ndcY < -1 || ndcY > 1 || ndcZ < -1 || ndcZ > 1) return false

    placed.push({
      text: node.text,
      x: Math.floor(((ndcX + 1) / 2) * width),
      y: Math.floor((1 - (ndcY + 1) / 2) * height),
      ...(perNodeColor ? { rgb: { r: node.color.r, g: node.color.g, b: node.color.b } } : {}),
    })
    return true
  }

  if (state.showTags) {
    const cap = state.selectedOnly ? Infinity : MAX_TAGS_PER_FRAME
    let kept = 0
    /** One sweep in file order; false once the frame cap is used up. */
    const sweep = (wantLink: boolean): boolean => {
      for (const node of nodes) {
        if (node.showText !== 0) continue // the pinned pass owns these, uncapped
        if ((node.type === NodeType.Link) !== wantLink) continue
        if (state.selectedOnly && !state.isSelected(node.id)) continue
        if (consider(node) && ++kept >= cap) return false
      }
      return true
    }
    // Links sweep after the ordinary nodes, so in the rare scene that both
    // exceeds the cap AND labels its links, node labels win the budget —
    // the desktop's pass 1 / pass 1b split.
    if (sweep(false)) sweep(true)
  }

  for (const node of state.pinned) consider(node)
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

    if (state.tagColorMode === TagColorMode.Node) {
      // Group by colour so the face pass costs one fillStyle change per
      // distinct colour rather than one per label — a scene coloured by
      // category has a handful of them however many labels are on screen.
      const byColor = new Map<number, LabelPlacement[]>()
      for (const p of placed) {
        const rgb = p.rgb ?? TAG_DEFAULT_TEXT_RGB
        const key = (rgb.r << 16) | (rgb.g << 8) | rgb.b
        const bucket = byColor.get(key)
        if (bucket) bucket.push(p)
        else byColor.set(key, [p])
      }
      for (const bucket of byColor.values()) {
        this.ctx.fillStyle = faceStyle(bucket[0].rgb ?? TAG_DEFAULT_TEXT_RGB)
        for (const p of bucket) this.ctx.fillText(p.text, p.x + LABEL_OFFSET_X, p.y)
      }
    } else {
      this.ctx.fillStyle = faceStyle(state.tagColor)
      for (const p of placed) {
        this.ctx.fillText(p.text, p.x + LABEL_OFFSET_X, p.y)
      }
    }
    this.drawnCount = placed.length
  }
}
