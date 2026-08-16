// The in-VR PROPERTIES panel's layout, values and hit-testing — pure, no THREE
// and no DOM, so it runs in plain node like xrPanelModel.ts beside it.
//
// This is the inspector (ui/inspector.ts) re-expressed for a headset, and
// almost none of the DOM controls survive the trip: there is no keyboard in an
// immersive session, no colour dialog, no combo box worth pointing a laser at.
// What is left is three widget shapes —
//
//   stepper   ‹ value ›   every enum-ish field. These already HAVE desktop
//                         cycle semantics (J/O for topo/geometry, =/− and
//                         Alt+=/Alt+− for the palette pair), so a VR stepper
//                         row is literally that key with a face on it.
//   toggle    a checkbox for hide / show_text.
//   nudge     − value +, plus press-and-drag on the value to SCRUB, for
//             translate/rotate/scale. One axis chip and one step-size chip
//             serve all three rows, because nine live number fields on a
//             19 cm quad is not something a laser can hit.
//
// `text` and `link` are READ-ONLY here, and that is the platform rather than a
// choice: a headset browser cannot raise a keyboard into a running immersive
// session. The panel shows the tag text so you know which node you have; it
// cannot let you retype it.
//
// PAGES, not one long list. The quad is about the size of a large phone, and
// the fields group the way the desktop's own form does: what the node IS
// (shape), where it is (move), how it looks (look). Five rows a page is what
// fits at a row height a ray can reliably hit.

import { paletteIndexCount, PALETTE_NAMES } from '../gv/colorPalette'
import type { GvNode, Rgba } from '../gv/types'
import { GEOMETRY_NAMES, NODE_TYPE_NAMES, NodeType, TOPO_NAMES } from '../gv/types'
import { rect, type XrRect, type XrWidgetBase } from './xrWidget'

export type XrPropPage = 'shape' | 'move' | 'look'
export type XrPropAxis = 'x' | 'y' | 'z'
export type XrPropVectorField = 'translate' | 'rotate' | 'scale'

export type XrPropId =
  | 'pin'
  | 'page-shape'
  | 'page-move'
  | 'page-look'
  | 'topo-prev'
  | 'topo-next'
  | 'geometry-prev'
  | 'geometry-next'
  | 'ratio-dec'
  | 'ratio-inc'
  | 'ratio-scrub'
  | 'facet-prev'
  | 'facet-next'
  | 'texture-prev'
  | 'texture-next'
  | 'axis-x'
  | 'axis-y'
  | 'axis-z'
  | 'step-down'
  | 'step-up'
  | 'translate-dec'
  | 'translate-inc'
  | 'translate-scrub'
  | 'rotate-dec'
  | 'rotate-inc'
  | 'rotate-scrub'
  | 'scale-dec'
  | 'scale-inc'
  | 'scale-scrub'
  | 'palette-prev'
  | 'palette-next'
  | 'index-prev'
  | 'index-next'
  | 'alpha-dec'
  | 'alpha-inc'
  | 'alpha-scrub'
  | 'hide'
  | 'showtext'

export interface XrPropWidget extends XrWidgetBase {
  id: XrPropId
  /** What the painter puts in it. */
  label: string
  /** A chip that is the current choice (page tab, axis, pin). */
  active?: boolean
  /** A checkbox's state; `null` = mixed, which a multi-selection can be. */
  checked?: boolean | null
  /**
   * Drawn greyed and inert. The widget stays in the list rather than being
   * omitted so the row keeps its shape — and so a press still COUNTS as
   * landing on the panel, which is what stops it selecting the glyph behind.
   */
  disabled?: boolean
}

/** One painted row: caption on the left, value between the steppers. */
export interface XrPropRow {
  y: number
  caption: string
  value: string
  /** Full-width text instead of caption+value (the world-position readout). */
  note?: string
}

export interface XrPropLayout {
  title: string
  /** Second header line: parent / branch level, or the tag text. */
  subtitle: string
  /** Non-null when there is nothing to edit; the pages are not drawn. */
  empty: string | null
  /** Header swatch — the node's literal colour, which is what actually
   *  renders (palette_id/color_index are dormant metadata, see gv/colorPalette). */
  color: Rgba | null
  rows: XrPropRow[]
  widgets: XrPropWidget[]
}

/** External labels the model cannot derive: the media file a texture_id names. */
export interface XrPropLabels {
  textureLabel: string
}

export interface XrPropState {
  /** The PRIMARY selected node (scene row order), or null. */
  node: GvNode | null
  /** How many are selected — every edit applies to all of them. */
  count: number
  page: XrPropPage
  axis: XrPropAxis
  /** Index into STEP_LADDER. */
  step: number
  pinned: boolean
  labels: XrPropLabels
}

/**
 * Nudge sizes, coarse to fine. One ladder for all three vectors rather than a
 * natural one each: the chip has to be readable at a glance, and a user who
 * wants 5° of heading is better served picking 1 and pressing + five times
 * than by learning that rotate's ladder is different from translate's.
 */
export const STEP_LADDER = [0.01, 0.1, 1, 10, 100] as const
export const DEFAULT_STEP = 2 // 1.0

/** Ratio and alpha have their own fixed nudges — neither is on the ladder,
 *  because neither shares the vectors' axis chip. */
export const RATIO_STEP = 0.05
export const ALPHA_STEP = 8

/**
 * How many step-sized notches a full-panel-width scrub covers. Quantising to
 * the step (rather than tracking continuously) is what keeps a dragged value
 * on a lattice of round numbers — 3.5, not 3.4972 — which is the difference
 * between a value you can read back off the panel and one you cannot.
 */
export const SCRUB_NOTCHES_PER_WIDTH = 40

/**
 * Types the shape steppers never touch — the same set `gv/attrCycle.ts`
 * excludes from J/O. World and Camera rows have no shape at all, and a World
 * Grid's geometry encodes flat-vs-globe while its topo is ignored, so cycling
 * either would corrupt it. The rows stay VISIBLE and greyed rather than
 * disappearing, so the page does not change shape under the pointer when the
 * selection moves onto a grid.
 */
const NEVER_CYCLED = new Set<number>([NodeType.World, NodeType.Camera, NodeType.WorldGrid])

// --- Layout bands -------------------------------------------------------------
// Ending at 0.96 rather than 1.0: a widget flush with the quad's rounded edge
// draws clipped, which reads as a rendering fault (the control panel's own
// lesson, found in its dumped texture rather than in any assertion).

const PAD = 0.03
export const PIN_RECT: XrRect = rect(0.795, 0.025, 0.175, 0.105)
export const TAB_Y = 0.225
const TAB_H = 0.105
const TAB_W = (1 - PAD * 4) / 3

export const ROW_TOP = 0.375
export const ROW_PITCH = 0.12
const ROW_H = 0.105

/** Columns. Captions are painter-only; the three control columns are widgets. */
export const CAP_X = 0.03
const DEC_X = 0.245
const BTN_W = 0.115
export const VAL_X = 0.375
export const VAL_W = 0.4
const INC_X = 0.79
const INC_W = 0.13

/** The axis/step chip row's own columns. */
const AXIS_X = [0.03, 0.155, 0.28]
const AXIS_W = 0.11
const STEP_DEC_X = 0.475
export const STEP_VAL_X = 0.6
export const STEP_VAL_W = 0.175

export function rowY(index: number): number {
  return ROW_TOP + index * ROW_PITCH
}

export function propLayout(state: XrPropState): XrPropLayout {
  const widgets: XrPropWidget[] = []
  const rows: XrPropRow[] = []
  const node = state.node

  // The pin travels with every page AND with the empty state: a panel pinned
  // out in front of you that loses its selection must still offer the way back
  // to the wrist, or the only exit is the A button.
  widgets.push({
    id: 'pin',
    kind: 'button',
    rect: PIN_RECT,
    label: state.pinned ? 'dock' : 'pin',
    active: state.pinned,
  })

  if (!node) {
    return {
      title: 'Properties',
      subtitle: '',
      empty: 'Point at a glyph and pull the trigger.',
      color: null,
      rows,
      widgets,
    }
  }

  const pages: Array<[XrPropId, XrPropPage, string]> = [
    ['page-shape', 'shape', 'Shape'],
    ['page-move', 'move', 'Move'],
    ['page-look', 'look', 'Look'],
  ]
  pages.forEach(([id, page, label], i) => {
    widgets.push({
      id,
      kind: 'button',
      rect: rect(PAD + i * (TAB_W + PAD), TAB_Y, TAB_W, TAB_H),
      label,
      active: state.page === page,
    })
  })

  const frozen = NEVER_CYCLED.has(node.type)
  if (state.page === 'shape') buildShape(state, node, frozen, rows, widgets)
  else if (state.page === 'move') buildMove(state, node, rows, widgets)
  else buildLook(node, rows, widgets)

  // The parser preserves a type the table has no name for, so this cannot
  // assume a hit.
  const type = NODE_TYPE_NAMES[node.type] ?? 'Glyph'
  return {
    title: state.count > 1 ? `${state.count} nodes · #${node.id}` : `#${node.id}  ${type}`,
    // The tag text is what actually identifies a node to a person; the
    // structural numbers are the fallback when it has none.
    subtitle: node.text
      ? node.text
      : `${type} · parent ${node.parentId === 0 ? 'root' : node.parentId} · level ${node.branchLevel}`,
    empty: null,
    color: node.color,
    rows,
    widgets,
  }
}

// --- Pages --------------------------------------------------------------------

function buildShape(
  state: XrPropState,
  node: GvNode,
  frozen: boolean,
  rows: XrPropRow[],
  widgets: XrPropWidget[],
): void {
  stepperRow(rows, widgets, 0, 'topo', name(TOPO_NAMES, node.topo), 'topo-prev', 'topo-next', frozen)
  stepperRow(
    rows,
    widgets,
    1,
    'geometry',
    name(GEOMETRY_NAMES, node.geometry),
    'geometry-prev',
    'geometry-next',
    frozen,
  )
  nudgeRow(rows, widgets, 2, 'ratio', num(node.ratio), 'ratio-dec', 'ratio-inc', 'ratio-scrub')
  // facet is 0-based in the data and 1-based everywhere a person reads it,
  // exactly as the DOM inspector's row is.
  stepperRow(
    rows,
    widgets,
    3,
    'facet',
    String(node.subspace + 1),
    'facet-prev',
    'facet-next',
    frozen,
  )
  stepperRow(
    rows,
    widgets,
    4,
    'texture',
    state.labels.textureLabel,
    'texture-prev',
    'texture-next',
    false,
  )
}

function buildMove(
  state: XrPropState,
  node: GvNode,
  rows: XrPropRow[],
  widgets: XrPropWidget[],
): void {
  // Row 0: which axis the three rows below edit, and how big a press is.
  rows.push({ y: rowY(0), caption: '', value: '' })
  const y = rowY(0)
  const axes: XrPropAxis[] = ['x', 'y', 'z']
  axes.forEach((axis, i) => {
    widgets.push({
      id: `axis-${axis}` as XrPropId,
      kind: 'button',
      rect: rect(AXIS_X[i], y, AXIS_W, ROW_H),
      label: axis.toUpperCase(),
      active: state.axis === axis,
    })
  })
  widgets.push(
    {
      id: 'step-down',
      kind: 'button',
      rect: rect(STEP_DEC_X, y, BTN_W, ROW_H),
      label: '−',
      disabled: state.step === 0,
    },
    {
      id: 'step-up',
      kind: 'button',
      rect: rect(INC_X, y, INC_W, ROW_H),
      label: '+',
      disabled: state.step === STEP_LADDER.length - 1,
    },
  )

  const axis = state.axis
  vectorRow(rows, widgets, 1, 'translate', num(node.translate[axis]))
  vectorRow(rows, widgets, 2, 'rotate', num(node.rotate[axis]))
  vectorRow(rows, widgets, 3, 'scale', num(node.scale[axis]))
  rows.push({
    y: rowY(4),
    caption: '',
    value: '',
    note: 'hold the value and slide to scrub',
  })
}

function buildLook(node: GvNode, rows: XrPropRow[], widgets: XrPropWidget[]): void {
  stepperRow(
    rows,
    widgets,
    0,
    'palette',
    PALETTE_NAMES[node.paletteId] ?? `Palette ${node.paletteId}`,
    'palette-prev',
    'palette-next',
    false,
  )
  stepperRow(
    rows,
    widgets,
    1,
    'index',
    `${node.colorIndex} / ${paletteIndexCount(node.paletteId) - 1}`,
    'index-prev',
    'index-next',
    false,
  )
  nudgeRow(rows, widgets, 2, 'alpha', String(Math.round(node.color.a)), 'alpha-dec', 'alpha-inc', 'alpha-scrub')
  toggleRow(rows, widgets, 3, 'hide', 'hide', node.hide !== 0)
  toggleRow(rows, widgets, 4, 'show text', 'showtext', node.showText !== 0)
}

// --- Row builders -------------------------------------------------------------

function stepperRow(
  rows: XrPropRow[],
  widgets: XrPropWidget[],
  index: number,
  caption: string,
  value: string,
  prev: XrPropId,
  next: XrPropId,
  disabled: boolean,
): void {
  const y = rowY(index)
  rows.push({ y, caption, value })
  widgets.push(
    { id: prev, kind: 'button', rect: rect(DEC_X, y, BTN_W, ROW_H), label: '‹', disabled },
    { id: next, kind: 'button', rect: rect(INC_X, y, INC_W, ROW_H), label: '›', disabled },
  )
}

/** A stepper whose value area is also a scrub target. */
function nudgeRow(
  rows: XrPropRow[],
  widgets: XrPropWidget[],
  index: number,
  caption: string,
  value: string,
  dec: XrPropId,
  inc: XrPropId,
  scrub: XrPropId,
): void {
  const y = rowY(index)
  rows.push({ y, caption, value })
  widgets.push(
    { id: dec, kind: 'button', rect: rect(DEC_X, y, BTN_W, ROW_H), label: '−' },
    { id: scrub, kind: 'scrub', rect: rect(VAL_X, y, VAL_W, ROW_H), label: value },
    { id: inc, kind: 'button', rect: rect(INC_X, y, INC_W, ROW_H), label: '+' },
  )
}

function vectorRow(
  rows: XrPropRow[],
  widgets: XrPropWidget[],
  index: number,
  field: XrPropVectorField,
  value: string,
): void {
  nudgeRow(
    rows,
    widgets,
    index,
    field,
    value,
    `${field}-dec` as XrPropId,
    `${field}-inc` as XrPropId,
    `${field}-scrub` as XrPropId,
  )
}

function toggleRow(
  rows: XrPropRow[],
  widgets: XrPropWidget[],
  index: number,
  caption: string,
  id: XrPropId,
  checked: boolean,
): void {
  const y = rowY(index)
  rows.push({ y, caption, value: '' })
  widgets.push({
    id,
    kind: 'button',
    rect: rect(INC_X, y, INC_W, ROW_H),
    label: '',
    checked,
  })
}

// --- Values -------------------------------------------------------------------

/**
 * The NAME only, without the `(id)` the DOM inspector appends. The value column
 * is 40% of a 26 cm quad, and "Cylinder Grid (15)" does not fit in it — the id
 * is what a CSV needs and the name is what a person in a headset does.
 */
function name(table: Record<number, string>, id: number): string {
  return table[id] ?? `Unknown ${id}`
}

/** Short, readable, and never in exponent form — a value you cannot read back
 *  off the panel is one you cannot undo by eye. */
export function num(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (value === 0) return '0'
  const abs = Math.abs(value)
  const decimals = abs >= 100 ? 1 : abs >= 1 ? 2 : 3
  return Number(value.toFixed(decimals)).toString()
}

/** Step ladder value for an index, clamped. */
export function stepSize(index: number): number {
  return STEP_LADDER[Math.min(STEP_LADDER.length - 1, Math.max(0, index))]
}

/**
 * How many notches a scrub has travelled. Quantised, so the value lands on
 * multiples of the step rather than wherever the hand happened to stop.
 */
export function scrubNotches(pressU: number, u: number): number {
  return Math.round((u - pressU) * SCRUB_NOTCHES_PER_WIDTH)
}

/**
 * What the panel's picture depends on. The texture is redrawn only when this
 * changes — the control panel's single-entry cache rule, which matters more
 * here: a scrub rewrites one number 90 times a second and must not repaint
 * five rows of unchanged text with it.
 */
export function propSignature(layout: XrPropLayout, hovered: string | null): string {
  const c = layout.color
  const parts: string[] = [
    layout.title,
    layout.subtitle,
    layout.empty ?? '-',
    hovered ?? '-',
    c ? `${c.r},${c.g},${c.b},${c.a}` : '-',
  ]
  for (const row of layout.rows) parts.push(row.caption, row.value, row.note ?? '')
  for (const widget of layout.widgets) {
    parts.push(widget.id, widget.label, String(widget.active), String(widget.checked), String(widget.disabled))
  }
  return parts.join('')
}
