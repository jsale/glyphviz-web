// The in-VR control panel: a quad on the left wrist, pointed at with the other
// hand's ray and clicked with its trigger. Layout and hit-testing live in
// ui/xrPanelModel.ts (pure); this file paints it and turns ray hits into
// actions.
//
// Why a wrist panel and not a floating one: it is always findable (look at
// your hand), it never occludes the scene you are inspecting, and it needs no
// summon gesture. It is billboarded to the head rather than rigidly mounted,
// so it stays readable through the whole range a wrist turns through —
// otherwise half the useful poses read it edge-on.
//
// A Mesh, note, not a Sprite: a mesh's vertices go through the model-view
// matrix, so its size lands in metres under the scaled camera rig exactly as
// its position does. (A Sprite's does not — see xrLabel.ts, which had to be
// sized in eye units for that reason.)

import * as THREE from 'three'
import {
  ROW_CHANNELS,
  ROW_FIT,
  ROW_LIMIT,
  ROW_SCENE,
  panelSignature,
  panelWidgets,
  sliderFraction,
  widgetAt,
  type XrPanelState,
  type XrWidget,
  type XrWidgetId,
} from '../ui/xrPanelModel'

/** Physical size of the quad, metres. Roughly a large phone held at the wrist. */
const PANEL_W = 0.26
const PANEL_H = 0.18
/** Texture resolution. 4× the quad's centimetres, which reads crisply at 0.4 m. */
const TEX_W = 1024
const TEX_H = 708

const BG = 'rgba(18, 18, 26, 0.94)'
const EDGE = 'rgba(120, 130, 160, 0.9)'
const TEXT = '#e8ecf6'
const DIM = '#9aa3b8'
const ACCENT = 'rgba(255, 243, 160, 1)'
const BTN = 'rgba(52, 58, 78, 0.95)'
const BTN_HOVER = 'rgba(96, 108, 145, 1)'

export interface XrPanelActions {
  togglePlay(): void
  stop(): void
  seek(fraction: number): void
  stepDrawLimit(factor: number): void
  stepExample(delta: number): void
  fit(targetMetres: number): void
}

/** Desktop `\` / `Shift+\` factors, so the panel and the keys agree. */
const LIMIT_HALVE = 0.5
const LIMIT_DOUBLE = 2

/** The two framings the Fit row offers: the spike's default, and a diorama. */
const ROOM_METRES = 20
const TABLE_METRES = 1.5

export class XrPanel {
  readonly group = new THREE.Group()
  private readonly canvas = document.createElement('canvas')
  private readonly texture: THREE.CanvasTexture
  private readonly mesh: THREE.Mesh
  private readonly actions: XrPanelActions
  private state: XrPanelState | null = null
  private widgets: XrWidget[] = []
  private hovered: XrWidgetId | null = null
  private dragging: XrWidget | null = null
  private signature = ''

  constructor(actions: XrPanelActions) {
    this.actions = actions
    this.canvas.width = TEX_W
    this.canvas.height = TEX_H
    this.texture = new THREE.CanvasTexture(this.canvas)
    // Raw pixels, like every other texture here: the renderer writes straight
    // to the framebuffer (lighting.ts's colour-pipeline note).
    this.texture.colorSpace = THREE.NoColorSpace
    this.texture.anisotropy = 4
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(PANEL_W, PANEL_H),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, fog: false }),
    )
    this.mesh.renderOrder = 5
    this.mesh.userData.isSelectionBox = true // chrome: never takes a blend mode
    // Above and slightly ahead of the grip, where a watch face sits.
    this.mesh.position.set(0, 0.09, -0.02)
    this.group.add(this.mesh)
  }

  get visible(): boolean {
    return this.group.visible
  }

  /** Which widget the pointer is on, if any — nothing else can observe this. */
  get hoveredId(): XrWidgetId | null {
    return this.hovered
  }

  set visible(value: boolean) {
    this.group.visible = value
    if (!value) this.clearHover()
  }

  /** New readings for the panel. Repaints only when the picture changes. */
  update(state: XrPanelState): void {
    this.state = state
    this.widgets = panelWidgets(state)
    if (this.hovered && !this.widgets.some((w) => w.id === this.hovered)) this.hovered = null
    const signature = panelSignature(state, this.hovered)
    if (signature === this.signature) return
    this.signature = signature
    this.paint(state)
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
   * Ray hit test. Returns the hit distance in world units (the caller shortens
   * the pointer ray to it) or null, and records which widget is under the
   * pointer so the next paint can highlight it.
   */
  hover(raycaster: THREE.Raycaster): number | null {
    if (!this.group.visible || !this.state) return null
    const hit = raycaster.intersectObject(this.mesh, false)[0]
    if (!hit?.uv) {
      this.setHovered(null)
      return null
    }
    // Three's UV origin is bottom-left; the layout counts down from the top.
    const widget = widgetAt(this.widgets, hit.uv.x, 1 - hit.uv.y)
    this.setHovered(widget?.id ?? null)
    return hit.distance
  }

  /** Trigger pressed while hovering. True if it landed on a widget. */
  press(): boolean {
    const widget = this.widgets.find((w) => w.id === this.hovered)
    if (!widget) return false
    if (widget.kind === 'slider') {
      this.dragging = widget
      return true
    }
    this.fire(widget.id)
    return true
  }

  /** Trigger held: a slider tracks the ray until it is let go. */
  drag(raycaster: THREE.Raycaster): void {
    if (!this.dragging) return
    const hit = raycaster.intersectObject(this.mesh, false)[0]
    if (!hit?.uv) return
    this.actions.seek(sliderFraction(this.dragging.rect, hit.uv.x))
  }

  release(): void {
    this.dragging = null
  }

  clearHover(): void {
    this.setHovered(null)
  }

  dispose(): void {
    this.texture.dispose()
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
  }

  private setHovered(id: XrWidgetId | null): void {
    if (id === this.hovered) return
    this.hovered = id
    if (this.state) this.update(this.state)
  }

  private fire(id: XrWidgetId): void {
    switch (id) {
      case 'play':
        this.actions.togglePlay()
        break
      case 'stop':
        this.actions.stop()
        break
      case 'limit-down':
        this.actions.stepDrawLimit(LIMIT_HALVE)
        break
      case 'limit-up':
        this.actions.stepDrawLimit(LIMIT_DOUBLE)
        break
      case 'scene-prev':
        this.actions.stepExample(-1)
        break
      case 'scene-next':
        this.actions.stepExample(1)
        break
      case 'fit-room':
        this.actions.fit(ROOM_METRES)
        break
      case 'fit-table':
        this.actions.fit(TABLE_METRES)
        break
      case 'seek':
        break
    }
  }

  private paint(state: XrPanelState): void {
    const ctx = this.canvas.getContext('2d')!
    const W = TEX_W
    const H = TEX_H
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = BG
    roundRect(ctx, 4, 4, W - 8, H - 8, 26)
    ctx.fill()
    ctx.strokeStyle = EDGE
    ctx.lineWidth = 3
    ctx.stroke()

    // Header: what is loaded, and how much of it is being drawn.
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    ctx.font = 'bold 40px system-ui, sans-serif'
    ctx.fillStyle = TEXT
    ctx.fillText(ellipsis(ctx, state.exampleName, W * 0.62), W * 0.035, H * 0.085)
    ctx.textAlign = 'right'
    ctx.font = '32px system-ui, sans-serif'
    ctx.fillStyle = DIM
    const drawn =
      state.drawLimit === null
        ? `${state.nodeCount} nodes`
        : `${state.drawnCount} / ${state.nodeCount}`
    ctx.fillText(drawn, W * 0.965, H * 0.085)

    // Selection readout — the inspector's job, reduced to what a glance needs.
    ctx.textAlign = 'left'
    ctx.font = '34px system-ui, sans-serif'
    if (state.selection) {
      ctx.fillStyle = ACCENT
      const label = state.selection.text
        ? `#${state.selection.id}  ${state.selection.text}`
        : `#${state.selection.id}  ${state.selection.type}`
      ctx.fillText(ellipsis(ctx, label, W * 0.93), W * 0.035, H * 0.21)
    } else {
      ctx.fillStyle = DIM
      ctx.fillText('point and pull the trigger to select', W * 0.035, H * 0.21)
    }

    for (const widget of this.widgets) {
      if (widget.kind === 'slider') this.paintSlider(ctx, widget, state)
      else this.paintButton(ctx, widget)
    }

    // Row captions, right of each pair of buttons.
    ctx.textAlign = 'left'
    ctx.font = '30px system-ui, sans-serif'
    ctx.fillStyle = DIM
    if (!state.channels) {
      ctx.fillText('no Channels in this scene', W * 0.035, (ROW_CHANNELS + 0.065) * H)
    }
    ctx.fillText(
      state.drawLimit === null ? 'draw limit: off' : `draw limit: ${state.drawLimit}`,
      W * 0.35,
      (ROW_LIMIT + 0.065) * H,
    )
    // Not the scene's name again — the header already carries it. What the row
    // needs to say is what its two arrows do.
    ctx.fillText('switch built-in scene', W * 0.35, (ROW_SCENE + 0.065) * H)
    void ROW_FIT
    this.texture.needsUpdate = true
  }

  private paintButton(ctx: CanvasRenderingContext2D, widget: XrWidget): void {
    const x = widget.rect.x * TEX_W
    const y = widget.rect.y * TEX_H
    const w = widget.rect.w * TEX_W
    const h = widget.rect.h * TEX_H
    ctx.fillStyle = this.hovered === widget.id ? BTN_HOVER : BTN
    roundRect(ctx, x, y, w, h, 12)
    ctx.fill()
    ctx.fillStyle = TEXT
    if (widget.icon) {
      drawTransportIcon(ctx, widget.icon, x + w / 2, y + h / 2, h * 0.34)
      return
    }
    ctx.textAlign = 'center'
    ctx.font = `${Math.round(h * 0.5)}px system-ui, sans-serif`
    ctx.fillText(widget.label, x + w / 2, y + h / 2)
  }

  private paintSlider(
    ctx: CanvasRenderingContext2D,
    widget: XrWidget,
    state: XrPanelState,
  ): void {
    const x = widget.rect.x * TEX_W
    const y = widget.rect.y * TEX_H
    const w = widget.rect.w * TEX_W
    const h = widget.rect.h * TEX_H
    const channels = state.channels
    const last = Math.max(1, (channels?.frames ?? 1) - 1)
    const fraction = channels ? Math.min(1, channels.frame / last) : 0
    ctx.fillStyle = 'rgba(40, 44, 60, 0.95)'
    roundRect(ctx, x, y + h * 0.3, w, h * 0.4, h * 0.2)
    ctx.fill()
    ctx.fillStyle = this.hovered === widget.id ? BTN_HOVER : 'rgba(120, 150, 220, 0.95)'
    roundRect(ctx, x, y + h * 0.3, Math.max(h * 0.4, w * fraction), h * 0.4, h * 0.2)
    ctx.fill()
    ctx.fillStyle = TEXT
    ctx.textAlign = 'right'
    ctx.font = `${Math.round(h * 0.42)}px system-ui, sans-serif`
    ctx.fillText(`${channels?.frame ?? 0} / ${last}`, x + w, y - h * 0.05)
  }
}

/** Play / pause / stop as paths, so no font has to own those code points. */
function drawTransportIcon(
  ctx: CanvasRenderingContext2D,
  icon: 'play' | 'pause' | 'stop',
  cx: number,
  cy: number,
  r: number,
): void {
  ctx.beginPath()
  if (icon === 'play') {
    ctx.moveTo(cx - r * 0.7, cy - r)
    ctx.lineTo(cx + r, cy)
    ctx.lineTo(cx - r * 0.7, cy + r)
    ctx.closePath()
  } else if (icon === 'stop') {
    ctx.rect(cx - r * 0.85, cy - r * 0.85, r * 1.7, r * 1.7)
  } else {
    ctx.rect(cx - r * 0.75, cy - r, r * 0.6, r * 2)
    ctx.rect(cx + r * 0.15, cy - r, r * 0.6, r * 2)
  }
  ctx.fill()
}

function roundRect(
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

/** Trim to fit, with an ellipsis — a scene name is as long as its filename. */
function ellipsis(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let cut = text
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1)
  return `${cut}…`
}
