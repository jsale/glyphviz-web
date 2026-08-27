// The machinery every in-headset panel shares: a quad carrying a canvas
// texture, billboarded at the viewer, hit-tested with a controller ray, and
// repainted only when its picture actually changes.
//
// Factored out of xrPanel.ts when the Properties panel arrived rather than
// copied into it — the same call ui/floatWindow.ts and ui/glyphPreview.ts made
// when the Glyph Composer joined the Hyperglyph Generator, so the app has ONE
// panel behaviour rather than two that drift.
//
// A Mesh, note, not a Sprite: a mesh's vertices go through the model-view
// matrix, so its size lands in metres under the scaled camera rig exactly as
// its position does. (A Sprite's does not — see xrLabel.ts, which had to be
// sized in eye units for that reason.)

import * as THREE from 'three'
import { widgetAt, type XrWidgetBase } from '../ui/xrWidget'
import { PANEL_CURVE, curvedPanelGeometry, curvedPanelPoint } from './xrCurvedPanel'
import type { XrPointerHit } from './xrPointer'

export interface XrSurfaceOptions {
  /** Quad size in METRES (rig-local units are perceived metres — xrNav.ts). */
  width: number
  height: number
  /** Canvas resolution. Roughly 4x the quad's centimetres reads crisply at 0.4 m. */
  texWidth: number
  texHeight: number
  /** Offset from the anchor, metres — where a watch face sits, for a wrist panel. */
  offset?: THREE.Vector3
  /**
   * Curvature as a fraction of the panel's own width (xrCurvedPanel.ts).
   * Defaults to the shared PANEL_CURVE; 0 gives a flat quad.
   */
  curve?: number
}

/** Shared palette, so the two panels cannot drift into different-looking chrome. */
export const SURFACE_BG = 'rgba(18, 18, 26, 0.94)'
export const SURFACE_EDGE = 'rgba(120, 130, 160, 0.9)'
export const SURFACE_TEXT = '#e8ecf6'
export const SURFACE_DIM = '#9aa3b8'
export const SURFACE_ACCENT = 'rgba(255, 243, 160, 1)'
export const SURFACE_BTN = 'rgba(52, 58, 78, 0.95)'
export const SURFACE_BTN_HOVER = 'rgba(96, 108, 145, 1)'
export const SURFACE_BTN_ACTIVE = 'rgba(70, 104, 168, 1)'
export const SURFACE_BTN_OFF = 'rgba(36, 40, 54, 0.9)'

export abstract class XrSurface<W extends XrWidgetBase> {
  readonly group = new THREE.Group()

  protected readonly canvas = document.createElement('canvas')
  protected readonly texture: THREE.CanvasTexture
  protected readonly mesh: THREE.Mesh
  protected widgets: W[] = []
  protected hovered: string | null = null

  private readonly size: { width: number; height: number; curve: number }
  private dragging: W | null = null
  private signature = ''
  /** Where the pointer last was on the quad, in the layout's own coordinates
   *  (u across, v DOWN from the top) — a scrub needs its press point. */
  private lastU = 0
  private lastV = 0

  constructor(options: XrSurfaceOptions) {
    this.canvas.width = options.texWidth
    this.canvas.height = options.texHeight
    this.texture = new THREE.CanvasTexture(this.canvas)
    // Raw pixels, like every other texture here: the renderer writes straight
    // to the framebuffer (lighting.ts's colour-pipeline note).
    this.texture.colorSpace = THREE.NoColorSpace
    this.texture.anisotropy = 4
    this.size = {
      width: options.width,
      height: options.height,
      curve: options.curve ?? PANEL_CURVE,
    }
    this.mesh = new THREE.Mesh(
      curvedPanelGeometry(this.size.width, this.size.height, this.size.curve),
      new THREE.MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        fog: false,
        // A control surface must never be sliced by the scene it controls.
        // Flying INSIDE a scene — which is the whole point of immersive mode,
        // and exactly when you reach for the Properties panel — puts glyphs
        // closer than your own wrist, and a depth-tested panel then draws in
        // pieces. renderOrder puts these last instead.
        depthTest: false,
        depthWrite: false,
      }),
    )
    this.mesh.renderOrder = 5
    this.mesh.userData.isSelectionBox = true // chrome: never takes a blend mode
    if (options.offset) this.mesh.position.copy(options.offset)
    this.group.add(this.mesh)
  }

  get visible(): boolean {
    return this.group.visible
  }

  set visible(value: boolean) {
    this.group.visible = value
    if (!value) this.clearHover()
  }

  /** Which widget the pointer is on — nothing else can observe this. */
  get hoveredId(): string | null {
    return this.hovered
  }

  /**
   * The world point at a normalised (u, v) on the panel's face, v counted DOWN
   * from the top the way every layout counts it. Curvature-aware, so a caller
   * placing something on the surface lands where a ray would hit rather than on
   * the flat quad the panel used to be.
   */
  surfacePoint(u: number, v: number, target = new THREE.Vector3()): THREE.Vector3 {
    curvedPanelPoint(u, v, this.size.width, this.size.height, this.size.curve, target)
    return this.mesh.localToWorld(target)
  }

  /** Where the panel sits relative to its anchor, and how big it draws. */
  setOffset(x: number, y: number, z: number): void {
    this.mesh.position.set(x, y, z)
  }

  setScale(scale: number): void {
    this.mesh.scale.setScalar(scale)
  }

  /**
   * Keep the face turned toward the viewer, whatever the wrist is doing.
   *
   * The world matrix is refreshed here rather than left to the next render,
   * because the ray hit test that follows in the same frame reads it — a panel
   * pointed at where it was last frame is a panel whose buttons are slightly
   * in the wrong place while the hand moves.
   */
  orient(headWorld: THREE.Vector3): void {
    if (!this.group.visible) return
    this.mesh.lookAt(headWorld)
    this.mesh.updateMatrixWorld(true)
  }

  /**
   * Ray hit test. Returns where the ray met the surface — the caller shortens
   * the beam to that distance and lays its reticle on that point — or null, and
   * records which widget is under the pointer so the next paint can highlight
   * it.
   *
   * The NORMAL is the intersection's own, which three interpolates from the
   * vertex normals and flips toward the ray — so on a curved shell the reticle
   * lies flat on the surface at the point it is actually touching, not on the
   * plane the panel would have been. (A flat panel's normals are all (0, 0, 1),
   * so this is unchanged for one.)
   */
  hover(raycaster: THREE.Raycaster): XrPointerHit | null {
    if (!this.group.visible) return null
    const hit = raycaster.intersectObject(this.mesh, false)[0]
    if (!hit?.uv) {
      this.setHovered(null)
      return null
    }
    // Three's UV origin is bottom-left; every layout counts down from the top.
    this.lastU = hit.uv.x
    this.lastV = 1 - hit.uv.y
    const widget = widgetAt(this.widgets, this.lastU, this.lastV)
    this.setHovered(widget?.id ?? null)
    const normal = (hit.normal ?? new THREE.Vector3(0, 0, 1))
      .clone()
      .transformDirection(this.mesh.matrixWorld)
      .normalize()
    return {
      distance: hit.distance,
      point: hit.point.clone(),
      normal,
      // A disabled widget is a distinct answer, not a miss: the row is drawn
      // greyed and still swallows the press (so it cannot select the glyph
      // behind), and the reticle should say so rather than reading as live.
      target: !widget ? 'surface' : widget.disabled ? 'disabled' : 'widget',
    }
  }

  /** Trigger pressed while hovering. True if it landed on a widget — which is
   *  what stops the same press also selecting the glyph behind the panel. */
  press(): boolean {
    const widget = this.widgets.find((w) => w.id === this.hovered)
    if (!widget) return false
    if (widget.kind === 'button') {
      this.onPress(widget)
      return true
    }
    this.dragging = widget
    this.onDragStart(widget, this.lastU, this.lastV)
    return true
  }

  /** Trigger held: a slider or scrub tracks the ray until it is let go. */
  drag(raycaster: THREE.Raycaster): void {
    if (!this.dragging) return
    const hit = raycaster.intersectObject(this.mesh, false)[0]
    if (!hit?.uv) return
    this.onDrag(this.dragging, hit.uv.x, 1 - hit.uv.y)
  }

  release(): void {
    const widget = this.dragging
    this.dragging = null
    if (widget) this.onDragEnd(widget)
  }

  clearHover(): void {
    this.setHovered(null)
  }

  dispose(): void {
    this.texture.dispose()
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
  }

  /**
   * Adopt this frame's widgets and repaint if the picture changed. Subclasses
   * call this from their own `update(state)`; the signature is theirs to
   * compute, because only they know what they draw.
   */
  protected sync(widgets: W[], signature: string): void {
    this.widgets = widgets
    if (this.hovered && !widgets.some((w) => w.id === this.hovered)) this.hovered = null
    if (signature === this.signature) return
    this.signature = signature
    this.paint()
    this.texture.needsUpdate = true
  }

  protected get context2d(): CanvasRenderingContext2D {
    return this.canvas.getContext('2d')!
  }

  /** Paint the whole texture. Called only when the signature changed. */
  protected abstract paint(): void

  /** Re-run the subclass's own `update` with the state it last saw — the hover
   *  highlight is part of the picture, so a hover change has to repaint. */
  protected abstract refresh(): void

  protected abstract onPress(widget: W): void

  /* eslint-disable @typescript-eslint/no-unused-vars */
  protected onDragStart(_widget: W, _u: number, _v: number): void {}
  protected onDrag(_widget: W, _u: number, _v: number): void {}
  protected onDragEnd(_widget: W): void {}
  /* eslint-enable @typescript-eslint/no-unused-vars */

  private setHovered(id: string | null): void {
    if (id === this.hovered) return
    this.hovered = id
    this.refresh()
  }
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** Trim to fit, with an ellipsis — a scene name is as long as its filename,
 *  and a tag label as long as its author felt like. */
export function ellipsis(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let cut = text
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1)
  return `${cut}…`
}
