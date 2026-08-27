// The in-VR PROPERTIES panel: a quad on the RIGHT wrist that the left hand
// points at, mirroring the control panel on the left. Layout and values live in
// ui/xrPropertiesModel.ts (pure); the quad and pointer plumbing in
// render/xrSurface.ts; this file paints it and turns ray hits into edits.
//
// Right wrist rather than a page on the existing left panel, and rather than a
// summoned floating slab (agreed with Jeff 2026-08-16): a wrist panel is always
// findable and never lost, and putting the two on OPPOSITE wrists means each is
// pointed at with the hand that is not wearing it — neither hand has to both
// hold a panel and drive it.
//
// The one thing a wrist costs is that your arm has to be up to read it, which
// is fine for a glance at the transport and tiring for a ten-minute editing
// session. So the panel PINS: one button unclips it from the wrist onto a slab
// parked in front of you (main.ts drives the re-parenting through XrRig's
// float anchor), and clips it back. Same layout at both ends, modestly larger
// when pinned — the win is resting your arm and having both hands free, not
// more rows.

import {
  ALPHA_STEP,
  CAP_X,
  DEFAULT_STEP,
  DRAW_JITTER_STEP,
  DRAW_SPACING_STEP,
  DRAW_Z_STEP,
  PANEL_H_M,
  PANEL_W_M,
  RATIO_STEP,
  SELECT_CRITERIA,
  STEP_LADDER,
  STEP_VAL_W,
  STEP_VAL_X,
  VAL_W,
  VAL_X,
  cx,
  cw,
  isPageWidget,
  propLayout,
  propSignature,
  scrubNotches,
  stepSize,
  type XrGrabMode,
  type XrPropAxis,
  type XrPropId,
  type XrPropLayout,
  type XrPropPage,
  type XrPropState,
  type XrPropVectorField,
  type XrPropWidget,
} from '../ui/xrPropertiesModel'
import type { SelectCriterion } from '../gv/selectionOps'
import {
  SURFACE_ACCENT,
  SURFACE_BG,
  SURFACE_BTN,
  SURFACE_BTN_ACTIVE,
  SURFACE_BTN_HOVER,
  SURFACE_BTN_OFF,
  SURFACE_DIM,
  SURFACE_EDGE,
  SURFACE_TEXT,
  XrSurface,
  ellipsis,
  roundRect,
} from './xrSurface'

/**
 * The quad's own size lives with the LAYOUT (ui/xrPropertiesModel.ts), because
 * the layout is what decides whether a control is big enough to hit and that
 * question is only answerable in centimetres. The texture keeps its aspect, so
 * a normalised rect is the same shape on the canvas as it is on the panel.
 */
const TEX_W = 1200
const TEX_H = Math.round((TEX_W * PANEL_H_M) / PANEL_W_M)

/**
 * How much bigger the pinned slab draws, and where it is parked. 1.9 puts a
 * 30 cm panel at 57 cm across at 75 cm away — a dashboard you read rather than
 * a watch face you squint at, which is the point of unclipping it.
 */
export const PINNED_SCALE = 1.9
export const PINNED_DISTANCE_M = 0.75
export const PINNED_DROP_M = 0.2

/** Draw-page scrubs, which change host settings rather than node data. */
const DRAW_SCRUBS = new Set<string>([
  'drawz-scrub',
  'spacing-scrub',
  'spin-scrub',
  'sizejit-scrub',
])

export interface XrPropertiesActions {
  /** Step an enum-ish field on every selected node, by ±1 (the desktop's own
   *  J/O and =/− cycle keys, which these rows ARE). */
  stepTopo(step: number): void
  stepGeometry(step: number): void
  stepFacet(step: number): void
  stepTexture(step: number): void
  stepPalette(step: number): void
  stepColorIndex(step: number): void
  /** Absolute-delta nudges. `commit` follows when the gesture ends. */
  nudgeRatio(delta: number): void
  nudgeAlpha(delta: number): void
  nudgeVector(field: XrPropVectorField, axis: XrPropAxis, delta: number): void
  /** End of a press or scrub: rebuild the scene and refresh the DOM panels. */
  commit(): void
  toggleHide(): void
  toggleShowText(): void
  /** Unclip onto the floating slab, or clip back to the wrist. */
  setPinned(pinned: boolean): void

  // --- Select page. Every rule lives in gv/selectionOps.ts; these are the
  // desktop's own Select By and Visibility commands, reached from a wrist.
  /** Apply the current criterion + value, replacing or adding per the checkbox. */
  selectMatching(criterion: SelectCriterion, value: number, add: boolean): void
  selectAll(): void
  selectNone(): void
  invertSelection(): void
  hideSelected(): void
  showAll(): void
  isolateSelected(): void

  // --- Draw page. Every rule is gv/drawMode.ts's, unchanged; these are the
  // same settings the DOM Draw panel edits, so the two surfaces cannot drift.
  /** Turn Draw Mode on or off — it is ONE mode, shared with the D key. */
  toggleDraw(): void
  /** Cycle the brush: Single Object, then any loaded Composer template. */
  stepBrush(step: number): void
  /** Nudge one of the four draw settings, in that setting's own units. */
  nudgeDraw(field: XrDrawField, delta: number): void
}

/** The Draw page's four adjustable settings. */
export type XrDrawField = 'drawZ' | 'spacing' | 'headingJitter' | 'scaleJitter'

/** What main.ts supplies each frame; the panel owns everything else. */
export type XrPropertiesInput = Omit<
  XrPropState,
  'page' | 'axis' | 'step' | 'pinned' | 'valueIndex' | 'addToSelection' | 'grabMode'
>

export class XrProperties extends XrSurface<XrPropWidget> {
  private readonly actions: XrPropertiesActions
  private layout: XrPropLayout | null = null
  private input: XrPropertiesInput | null = null

  /** Panel-local UI state — which page, which axis, which step. Lives here
   *  rather than in main.ts because nothing outside the panel reads it. */
  private page: XrPropPage = 'shape'
  private axis: XrPropAxis = 'x'
  private step = DEFAULT_STEP
  private pinned = false
  /** Select page: which criterion, which of its values, and whether the Select
   *  By rows add to the selection or replace it. */
  private criterionIndex = 0
  private valueIndex = 0
  private addToSelection = false
  /** What a trigger-held grab out in the scene does. Sticky, like the desktop
   *  gizmo's armed mode (roadmap 6h) — a mode you are in until you change it. */
  private grab: XrGrabMode = 'move'

  /** Scrub bookkeeping: where the press landed and how many notches of value
   *  have been applied so far, so each frame applies only the DIFFERENCE. */
  private scrubU = 0
  private scrubApplied = 0

  constructor(actions: XrPropertiesActions) {
    super({ width: PANEL_W_M, height: PANEL_H_M, texWidth: TEX_W, texHeight: TEX_H })
    this.setOffset(0, 0.09, -0.02)
    this.actions = actions
  }

  get isPinned(): boolean {
    return this.pinned
  }

  /**
   * The criterion the Select page is showing. The host reads this BEFORE
   * calling `update`, so it only has to scan the scene for the one criterion
   * that is on screen rather than all three every frame.
   */
  get criterion(): SelectCriterion {
    return SELECT_CRITERIA[this.criterionIndex]
  }

  /** What a trigger-held grab out in the scene should do. Read by main.ts at
   *  the moment a grab starts, so a mode change never disturbs one in flight. */
  get grabMode(): XrGrabMode {
    return this.grab
  }

  /** Panel-owned state — read by the drive harness, which has no other way to
   *  see any of it. */
  get uiState(): {
    page: XrPropPage
    axis: XrPropAxis
    step: number
    pinned: boolean
    criterion: SelectCriterion
    valueIndex: number
    addToSelection: boolean
    grabMode: XrGrabMode
  } {
    return {
      page: this.page,
      axis: this.axis,
      step: stepSize(this.step),
      pinned: this.pinned,
      criterion: this.criterion,
      valueIndex: this.valueIndex,
      addToSelection: this.addToSelection,
      grabMode: this.grab,
    }
  }

  /** Clipping back to the wrist has to be reachable from outside too — leaving
   *  a session with the slab still parked would strand it. */
  unpin(): void {
    if (!this.pinned) return
    this.pinned = false
    this.actions.setPinned(false)
    this.refresh()
  }

  /**
   * New readings. Called every frame; the signature comparison in `sync` is
   * what keeps that free — which matters more here than on the control panel,
   * since a scrub rewrites one number 90 times a second and must not repaint
   * four rows of unchanged text with it.
   */
  update(input: XrPropertiesInput): void {
    this.input = input
    // A scene load, or a topo/geometry edit, can shorten the value list under
    // a parked index; clamping here rather than at the press keeps the stepper
    // from pointing at a value that no longer exists.
    const count = input.select.values.length
    this.valueIndex = count === 0 ? 0 : Math.min(this.valueIndex, count - 1)
    const state: XrPropState = {
      ...input,
      page: this.page,
      axis: this.axis,
      step: this.step,
      pinned: this.pinned,
      grabMode: this.grab,
      valueIndex: this.valueIndex,
      addToSelection: this.addToSelection,
    }
    const layout = propLayout(state)
    this.layout = layout
    const hovered = layout.widgets.some((w) => w.id === this.hovered) ? this.hovered : null
    this.sync(layout.widgets, propSignature(layout, hovered))
  }

  protected refresh(): void {
    if (this.input) this.update(this.input)
  }

  protected onPress(widget: XrPropWidget): void {
    if (widget.disabled) return
    const id = widget.id
    if (id === 'pin') {
      this.pinned = !this.pinned
      this.actions.setPinned(this.pinned)
      this.refresh()
      return
    }
    if (id.startsWith('page-')) {
      this.page = id.slice(5) as XrPropPage
      this.refresh()
      return
    }
    // Select-page navigation is panel-local like the tabs and chips: it changes
    // what the two steppers SHOW, and nothing happens to the scene until Select
    // matching is pressed.
    if (id === 'criterion-prev' || id === 'criterion-next') {
      const step = id === 'criterion-next' ? 1 : -1
      const n = SELECT_CRITERIA.length
      this.criterionIndex = (((this.criterionIndex + step) % n) + n) % n
      // The new criterion has its own values, and the host has not scanned for
      // them yet; starting at 0 is the only index certain to exist.
      this.valueIndex = 0
      this.refresh()
      return
    }
    if (id === 'value-prev' || id === 'value-next') {
      const n = this.input?.select.values.length ?? 0
      if (n === 0) return
      const step = id === 'value-next' ? 1 : -1
      this.valueIndex = (((this.valueIndex + step) % n) + n) % n
      this.refresh()
      return
    }
    if (id === 'select-add') {
      this.addToSelection = !this.addToSelection
      this.refresh()
      return
    }
    if (this.applySelectPress(id)) return
    if (this.applyDrawPress(id)) return
    if (id === 'axis-x' || id === 'axis-y' || id === 'axis-z') {
      this.axis = id.slice(5) as XrPropAxis
      this.refresh()
      return
    }
    if (id.startsWith('grab-')) {
      this.grab = id.slice(5) as XrGrabMode
      this.refresh()
      return
    }
    if (id === 'step-down' || id === 'step-up') {
      const next = this.step + (id === 'step-up' ? 1 : -1)
      this.step = Math.min(STEP_LADDER.length - 1, Math.max(0, next))
      this.refresh()
      return
    }
    this.applyPress(id)
    // Every field edit ends in the same rebuild the DOM inspector's commit
    // does, so the two cannot leave the scene in different states.
    this.actions.commit()
  }

  /**
   * The Select page's scene commands. These do NOT go through `commit` — each
   * one is a whole operation that reports and rebuilds for itself (the
   * selection ones do not touch node data at all, and the visibility ones
   * change `hide`, which needs its own rebuild and its own status count).
   * Returns true when the press was one of them.
   */
  private applySelectPress(id: XrPropId): boolean {
    const a = this.actions
    switch (id) {
      case 'select-apply': {
        const value = this.input?.select.values[this.valueIndex]
        if (value) a.selectMatching(this.criterion, value.value, this.addToSelection)
        return true
      }
      case 'select-all':
        a.selectAll()
        return true
      case 'select-none':
        a.selectNone()
        return true
      case 'select-invert':
        a.invertSelection()
        return true
      case 'vis-hide':
        a.hideSelected()
        return true
      case 'vis-show':
        a.showAll()
        return true
      case 'vis-only':
        a.isolateSelected()
        return true
      default:
        return false
    }
  }

  /**
   * The Draw page's presses. Like the Select page's, these skip `commit` — the
   * mode toggle and the brush step change no node data at all, and the four
   * settings are host state that the next stamp reads, not fields on a node.
   */
  private applyDrawPress(id: XrPropId): boolean {
    const a = this.actions
    switch (id) {
      case 'draw-toggle':
        a.toggleDraw()
        return true
      case 'brush-prev':
        a.stepBrush(-1)
        return true
      case 'brush-next':
        a.stepBrush(1)
        return true
      case 'drawz-dec':
        a.nudgeDraw('drawZ', -DRAW_Z_STEP)
        return true
      case 'drawz-inc':
        a.nudgeDraw('drawZ', DRAW_Z_STEP)
        return true
      case 'spacing-dec':
        a.nudgeDraw('spacing', -DRAW_SPACING_STEP)
        return true
      case 'spacing-inc':
        a.nudgeDraw('spacing', DRAW_SPACING_STEP)
        return true
      case 'spin-dec':
        a.nudgeDraw('headingJitter', -DRAW_JITTER_STEP)
        return true
      case 'spin-inc':
        a.nudgeDraw('headingJitter', DRAW_JITTER_STEP)
        return true
      case 'sizejit-dec':
        a.nudgeDraw('scaleJitter', -DRAW_JITTER_STEP)
        return true
      case 'sizejit-inc':
        a.nudgeDraw('scaleJitter', DRAW_JITTER_STEP)
        return true
      default:
        return false
    }
  }

  private applyPress(id: XrPropId): void {
    const a = this.actions
    switch (id) {
      case 'topo-prev':
        return a.stepTopo(-1)
      case 'topo-next':
        return a.stepTopo(1)
      case 'geometry-prev':
        return a.stepGeometry(-1)
      case 'geometry-next':
        return a.stepGeometry(1)
      case 'facet-prev':
        return a.stepFacet(-1)
      case 'facet-next':
        return a.stepFacet(1)
      case 'texture-prev':
        return a.stepTexture(-1)
      case 'texture-next':
        return a.stepTexture(1)
      case 'palette-prev':
        return a.stepPalette(-1)
      case 'palette-next':
        return a.stepPalette(1)
      case 'index-prev':
        return a.stepColorIndex(-1)
      case 'index-next':
        return a.stepColorIndex(1)
      case 'ratio-dec':
        return a.nudgeRatio(-RATIO_STEP)
      case 'ratio-inc':
        return a.nudgeRatio(RATIO_STEP)
      case 'alpha-dec':
        return a.nudgeAlpha(-ALPHA_STEP)
      case 'alpha-inc':
        return a.nudgeAlpha(ALPHA_STEP)
      case 'hide':
        return a.toggleHide()
      case 'showtext':
        return a.toggleShowText()
      case 'translate-dec':
      case 'translate-inc':
      case 'rotate-dec':
      case 'rotate-inc':
      case 'scale-dec':
      case 'scale-inc': {
        const [field, dir] = id.split('-') as [XrPropVectorField, 'dec' | 'inc']
        return a.nudgeVector(field, this.axis, (dir === 'inc' ? 1 : -1) * stepSize(this.step))
      }
      default:
        return
    }
  }

  protected onDragStart(_widget: XrPropWidget, u: number): void {
    this.scrubU = u
    this.scrubApplied = 0
  }

  protected onDrag(widget: XrPropWidget, u: number): void {
    // Quantised to the step, so the value walks a lattice of round numbers
    // rather than landing wherever the hand stopped.
    const notches = scrubNotches(this.scrubU, u)
    const delta = notches - this.scrubApplied
    if (delta === 0) return
    this.scrubApplied = notches
    switch (widget.id) {
      case 'ratio-scrub':
        return this.actions.nudgeRatio(delta * RATIO_STEP)
      case 'alpha-scrub':
        return this.actions.nudgeAlpha(delta * ALPHA_STEP)
      case 'translate-scrub':
      case 'rotate-scrub':
      case 'scale-scrub': {
        const field = widget.id.split('-')[0] as XrPropVectorField
        return this.actions.nudgeVector(field, this.axis, delta * stepSize(this.step))
      }
      case 'drawz-scrub':
        return this.actions.nudgeDraw('drawZ', delta * DRAW_Z_STEP)
      case 'spacing-scrub':
        return this.actions.nudgeDraw('spacing', delta * DRAW_SPACING_STEP)
      case 'spin-scrub':
        return this.actions.nudgeDraw('headingJitter', delta * DRAW_JITTER_STEP)
      case 'sizejit-scrub':
        return this.actions.nudgeDraw('scaleJitter', delta * DRAW_JITTER_STEP)
    }
  }

  protected onDragEnd(widget: XrPropWidget): void {
    // A Draw-page scrub changed a host setting, not a node — there is nothing
    // to rebuild, and `commit` would rebuild the whole scene for a number the
    // next stamp reads.
    if (widget.id.endsWith('-scrub') && DRAW_SCRUBS.has(widget.id)) return
    // The scrub itself moves the glyph in place every frame (main.ts takes the
    // gizmo's own applyFrameTransform path); the rebuild that re-cells
    // overlays, repaints the table and refreshes the DOM inspector happens
    // ONCE, here. A rebuildScene per frame at 90 Hz is not affordable, and
    // this is the same trade a mouse gizmo drag already makes.
    this.actions.commit()
  }

  // --- Painting ---------------------------------------------------------------

  protected paint(): void {
    const layout = this.layout
    if (!layout) return
    const ctx = this.context2d
    const W = TEX_W
    const H = TEX_H
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = SURFACE_BG
    roundRect(ctx, 4, 4, W - 8, H - 8, 26)
    ctx.fill()
    ctx.strokeStyle = this.pinned ? SURFACE_ACCENT : SURFACE_EDGE
    ctx.lineWidth = 3
    ctx.stroke()

    ctx.textBaseline = 'middle'

    // Header: the colour swatch (which is the literal colour that actually
    // renders), then the identity line.
    let titleX = W * 0.035
    if (layout.color) {
      const size = H * 0.05
      ctx.fillStyle = `rgb(${clamp255(layout.color.r)}, ${clamp255(layout.color.g)}, ${clamp255(layout.color.b)})`
      roundRect(ctx, titleX, H * 0.065 - size / 2, size, size, 6)
      ctx.fill()
      ctx.strokeStyle = SURFACE_EDGE
      ctx.lineWidth = 2
      ctx.stroke()
      titleX += size * 1.5
    }
    ctx.textAlign = 'left'
    ctx.font = 'bold 36px system-ui, sans-serif'
    ctx.fillStyle = SURFACE_TEXT
    ctx.fillText(ellipsis(ctx, layout.title, W * 0.73 - titleX), titleX, H * 0.065)

    // Clear of the mode column's first button, which now starts where the tab
    // row used to end. At 0.165 the subtitle sat on that button's top edge and
    // read as a caption FOR it — visible in the panel texture, invisible to
    // every assertion about the layout.
    ctx.font = '28px system-ui, sans-serif'
    ctx.fillStyle = SURFACE_DIM
    ctx.fillText(ellipsis(ctx, layout.subtitle, W * 0.93), W * 0.035, H * 0.14)

    if (layout.empty) {
      // Centred on the CONTENT, not on the panel: the mode column owns the left
      // fifth, and a message straddling it reads as a caption for the buttons.
      ctx.font = '30px system-ui, sans-serif'
      ctx.fillStyle = SURFACE_DIM
      ctx.textAlign = 'center'
      ctx.fillText(
        ellipsis(ctx, layout.empty, cw(0.94) * W),
        cx(0.5) * W,
        H * 0.5,
      )
      this.paintWidgets(ctx)
      return
    }

    // Row captions and values. Drawn before the widgets so a button's rounded
    // corner is never overprinted by a caption that ran long.
    for (const row of layout.rows) {
      const cy = (row.y + 0.0525) * H
      if (row.note) {
        ctx.font = '26px system-ui, sans-serif'
        ctx.fillStyle = SURFACE_DIM
        ctx.textAlign = 'center'
        ctx.fillText(ellipsis(ctx, row.note, cw(0.94) * W), cx(0.5) * W, cy)
        continue
      }
      if (row.caption) {
        ctx.font = '28px system-ui, sans-serif'
        ctx.fillStyle = SURFACE_DIM
        ctx.textAlign = 'left'
        ctx.fillText(ellipsis(ctx, row.caption, cw(0.2) * W), cx(CAP_X) * W, cy)
      }
      if (row.value) {
        ctx.font = 'bold 32px system-ui, sans-serif'
        ctx.fillStyle = SURFACE_TEXT
        ctx.textAlign = 'center'
        ctx.fillText(
          ellipsis(ctx, row.value, cw(VAL_W) * W * 0.94),
          cx(VAL_X + VAL_W / 2) * W,
          cy,
        )
      }
    }

    // The step chip's own readout sits between its two buttons, on the axis
    // row — CAPTIONED, because a bare "10" between a − and a + says nothing
    // about what it steps, and a headset has no tooltip to explain it. (The
    // picture is what caught this; every assertion about the row passed.)
    if (this.page === 'move') {
      const chipX = cx(STEP_VAL_X + STEP_VAL_W / 2) * W
      const top = layout.rows[0].y * H
      ctx.textAlign = 'center'
      ctx.font = '22px system-ui, sans-serif'
      ctx.fillStyle = SURFACE_DIM
      ctx.fillText('step', chipX, top + 0.03 * H)
      ctx.font = 'bold 30px system-ui, sans-serif'
      ctx.fillStyle = SURFACE_TEXT
      ctx.fillText(String(stepSize(this.step)), chipX, top + 0.078 * H)
    }

    this.paintWidgets(ctx)
  }

  private paintWidgets(ctx: CanvasRenderingContext2D): void {
    for (const widget of this.widgets) {
      // A scrub target is the value area, which is already painted as text —
      // giving it a button face would read as a control the two steppers
      // beside it are not. It gets a faint underline instead, which is the
      // only hint that it can be dragged.
      if (widget.kind === 'scrub') {
        this.paintScrubHint(ctx, widget)
        continue
      }
      this.paintButton(ctx, widget)
    }
  }

  private paintScrubHint(ctx: CanvasRenderingContext2D, widget: XrPropWidget): void {
    const x = widget.rect.x * TEX_W
    const y = widget.rect.y * TEX_H
    const w = widget.rect.w * TEX_W
    const h = widget.rect.h * TEX_H
    ctx.fillStyle =
      this.hovered === widget.id ? 'rgba(120, 150, 220, 0.85)' : 'rgba(120, 130, 160, 0.35)'
    roundRect(ctx, x + w * 0.12, y + h * 0.86, w * 0.76, h * 0.07, h * 0.035)
    ctx.fill()
  }

  private paintButton(ctx: CanvasRenderingContext2D, widget: XrPropWidget): void {
    const x = widget.rect.x * TEX_W
    const y = widget.rect.y * TEX_H
    const w = widget.rect.w * TEX_W
    const h = widget.rect.h * TEX_H
    const hovered = this.hovered === widget.id && !widget.disabled
    ctx.fillStyle = widget.disabled
      ? SURFACE_BTN_OFF
      : hovered
        ? SURFACE_BTN_HOVER
        : widget.active
          ? SURFACE_BTN_ACTIVE
          : SURFACE_BTN
    roundRect(ctx, x, y, w, h, 12)
    ctx.fill()
    // The open mode's own marker, so it reads at a glance even when another
    // button is hovered and therefore lighter than it. A bar down the INSIDE
    // edge rather than the underline the tab row used: in a column an underline
    // reads as a divider between two entries rather than as a state.
    if (widget.active && isPageWidget(widget.id)) {
      ctx.fillStyle = SURFACE_ACCENT
      ctx.fillRect(x + w * 0.92, y + h * 0.16, w * 0.06, h * 0.68)
    }

    if (widget.checked !== undefined) {
      this.paintCheck(ctx, x, y, w, h, widget.checked)
      return
    }
    if (!widget.label) return
    ctx.fillStyle = widget.disabled ? SURFACE_DIM : SURFACE_TEXT
    ctx.textAlign = 'center'
    ctx.font = `${widget.active ? 'bold ' : ''}${Math.round(h * 0.46)}px system-ui, sans-serif`
    ctx.fillText(ellipsis(ctx, widget.label, w * 0.88), x + w / 2, y + h / 2)
  }

  /** A drawn tick, not a ✓ character — the control panel's transport-icon
   *  lesson: font coverage in a headset browser is not something to assume. */
  private paintCheck(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    checked: boolean | null,
  ): void {
    const cx = x + w / 2
    const cy = y + h / 2
    const r = h * 0.26
    if (checked === null) {
      ctx.fillStyle = SURFACE_ACCENT
      ctx.fillRect(cx - r, cy - r * 0.18, r * 2, r * 0.36)
      return
    }
    if (!checked) {
      ctx.strokeStyle = SURFACE_DIM
      ctx.lineWidth = 3
      ctx.strokeRect(cx - r, cy - r, r * 2, r * 2)
      return
    }
    ctx.strokeStyle = SURFACE_ACCENT
    ctx.lineWidth = Math.max(4, h * 0.09)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(cx - r, cy)
    ctx.lineTo(cx - r * 0.25, cy + r * 0.7)
    ctx.lineTo(cx + r, cy - r * 0.7)
    ctx.stroke()
  }
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)))
}
