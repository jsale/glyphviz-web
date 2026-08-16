// The in-VR CONTROL panel: a quad on the left wrist, pointed at with the other
// hand's ray and clicked with its trigger. Layout and hit-testing live in
// ui/xrPanelModel.ts (pure); the quad, canvas and pointer plumbing in
// render/xrSurface.ts (shared with the Properties panel); this file paints it
// and turns ray hits into actions.
//
// Why a wrist panel and not a floating one: it is always findable (look at
// your hand), it never occludes the scene you are inspecting, and it needs no
// summon gesture. It is billboarded to the head rather than rigidly mounted,
// so it stays readable through the whole range a wrist turns through —
// otherwise half the useful poses read it edge-on.

import {
  ROW_CHANNELS,
  ROW_FIT,
  ROW_LIMIT,
  ROW_SCENE,
  panelSignature,
  panelWidgets,
  sliderFraction,
  type XrPanelState,
  type XrWidget,
  type XrWidgetId,
} from '../ui/xrPanelModel'
import {
  SURFACE_ACCENT,
  SURFACE_BG,
  SURFACE_BTN,
  SURFACE_BTN_HOVER,
  SURFACE_DIM,
  SURFACE_EDGE,
  SURFACE_TEXT,
  XrSurface,
  ellipsis,
  roundRect,
} from './xrSurface'

/** Physical size of the quad, metres. Roughly a large phone held at the wrist. */
const PANEL_W = 0.26
const PANEL_H = 0.18
/** Texture resolution. 4× the quad's centimetres, which reads crisply at 0.4 m. */
const TEX_W = 1024
const TEX_H = 708

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

export class XrPanel extends XrSurface<XrWidget> {
  private readonly actions: XrPanelActions
  private state: XrPanelState | null = null

  constructor(actions: XrPanelActions) {
    super({ width: PANEL_W, height: PANEL_H, texWidth: TEX_W, texHeight: TEX_H })
    // Above and slightly ahead of the grip, where a watch face sits.
    this.setOffset(0, 0.09, -0.02)
    this.actions = actions
  }

  /** New readings for the panel. Repaints only when the picture changes. */
  update(state: XrPanelState): void {
    this.state = state
    const widgets = panelWidgets(state)
    // The hover is part of the picture, and `sync` may drop a stale one, so the
    // signature is computed against the hover the layout will actually be
    // painted with.
    const hovered = widgets.some((w) => w.id === this.hovered)
      ? (this.hovered as XrWidgetId)
      : null
    this.sync(widgets, panelSignature(state, hovered))
  }

  protected refresh(): void {
    if (this.state) this.update(this.state)
  }

  protected onPress(widget: XrWidget): void {
    switch (widget.id) {
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

  protected onDrag(widget: XrWidget, u: number): void {
    if (widget.id !== 'seek') return
    this.actions.seek(sliderFraction(widget.rect, u))
  }

  protected paint(): void {
    const state = this.state
    if (!state) return
    const ctx = this.context2d
    const W = TEX_W
    const H = TEX_H
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = SURFACE_BG
    roundRect(ctx, 4, 4, W - 8, H - 8, 26)
    ctx.fill()
    ctx.strokeStyle = SURFACE_EDGE
    ctx.lineWidth = 3
    ctx.stroke()

    // Header: what is loaded, and how much of it is being drawn.
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    ctx.font = 'bold 40px system-ui, sans-serif'
    ctx.fillStyle = SURFACE_TEXT
    ctx.fillText(ellipsis(ctx, state.exampleName, W * 0.62), W * 0.035, H * 0.085)
    ctx.textAlign = 'right'
    ctx.font = '32px system-ui, sans-serif'
    ctx.fillStyle = SURFACE_DIM
    const drawn =
      state.drawLimit === null
        ? `${state.nodeCount} nodes`
        : `${state.drawnCount} / ${state.nodeCount}`
    ctx.fillText(drawn, W * 0.965, H * 0.085)

    // Selection readout — the inspector's job, reduced to what a glance needs.
    // Editing it is the RIGHT wrist's panel; this line is what tells you the
    // trigger landed.
    ctx.textAlign = 'left'
    ctx.font = '34px system-ui, sans-serif'
    if (state.selection) {
      ctx.fillStyle = SURFACE_ACCENT
      const label = state.selection.text
        ? `#${state.selection.id}  ${state.selection.text}`
        : `#${state.selection.id}  ${state.selection.type}`
      ctx.fillText(ellipsis(ctx, label, W * 0.93), W * 0.035, H * 0.21)
    } else {
      ctx.fillStyle = SURFACE_DIM
      ctx.fillText('point and pull the trigger to select', W * 0.035, H * 0.21)
    }

    for (const widget of this.widgets) {
      if (widget.kind === 'slider') this.paintSlider(ctx, widget, state)
      else this.paintButton(ctx, widget)
    }

    // Row captions, right of each pair of buttons.
    ctx.textAlign = 'left'
    ctx.font = '30px system-ui, sans-serif'
    ctx.fillStyle = SURFACE_DIM
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
  }

  private paintButton(ctx: CanvasRenderingContext2D, widget: XrWidget): void {
    const x = widget.rect.x * TEX_W
    const y = widget.rect.y * TEX_H
    const w = widget.rect.w * TEX_W
    const h = widget.rect.h * TEX_H
    ctx.fillStyle = this.hovered === widget.id ? SURFACE_BTN_HOVER : SURFACE_BTN
    roundRect(ctx, x, y, w, h, 12)
    ctx.fill()
    ctx.fillStyle = SURFACE_TEXT
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
    ctx.fillStyle = this.hovered === widget.id ? SURFACE_BTN_HOVER : 'rgba(120, 150, 220, 0.95)'
    roundRect(ctx, x, y + h * 0.3, Math.max(h * 0.4, w * fraction), h * 0.4, h * 0.2)
    ctx.fill()
    ctx.fillStyle = SURFACE_TEXT
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
