// The in-VR PROPERTIES panel's layout, values and hit-testing — pure, no THREE
// and no DOM, so it runs in plain node like xrPanelModel.ts beside it.
//
// This is the inspector (ui/inspector.ts) re-expressed for a headset, and
// almost none of the DOM controls survive the trip: no colour dialog, no combo
// box worth pointing a laser at, and no text field this build types into (see
// the note on `text`/`link` below — that one is a gap, not a platform limit).
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
// `text` and `link` are READ-ONLY here — for now, and NOT because the platform
// forbids it. That was the reason given when this shipped and it was wrong:
// `XRSession.isSystemKeyboardSupported` is a standard property (it is in
// @types/webxr, on XRSession itself) and the Quest 3 profile declares it true.
// Focusing a real DOM input during a session lets the browser raise the SYSTEM
// keyboard as a compositor overlay — which is exactly the one the wearer can
// already point at and click. The page never has to draw it.
//
// What is actually unsettled is two device questions the emulator cannot
// answer, since it reports the flag and implements nothing behind it: whether
// the Quest Browser raises the keyboard for a HIDDEN input or insists on a
// visible one, and where the in-progress string is echoed (the panel would have
// to draw it, the DOM input being invisible in-session). See the XR pending
// list in CLAUDE.md.
//
// PAGES, not one long list. The quad is about the size of a large phone, and
// the fields group the way the desktop's own form does: what the node IS
// (shape), where it is (move), how it looks (look). Five rows a page is what
// fits at a row height a ray can reliably hit.

import {
  TURN_MODE_LABELS,
  VIGNETTE_LABELS,
  type ComfortSettings,
} from '../render/xrComfort'
import { paletteIndexCount, PALETTE_NAMES } from '../gv/colorPalette'
import { CRITERION_LABELS } from '../gv/selectionOps'
import type { CriterionValue, SelectCriterion } from '../gv/selectionOps'
import type { GvNode, Rgba } from '../gv/types'
import { GEOMETRY_NAMES, NODE_TYPE_NAMES, NodeType, TOPO_NAMES } from '../gv/types'
import { rect, type XrRect, type XrWidgetBase } from './xrWidget'

export type XrPropPage = 'select' | 'shape' | 'move' | 'look' | 'draw' | 'comfort'
export type XrPropAxis = 'x' | 'y' | 'z'
export type XrPropVectorField = 'translate' | 'rotate' | 'scale'

/**
 * What a trigger-held grab does to the selection.
 *
 * The grab IS the transform gizmo in a headset — TransformControls needs a
 * screen-space pointer and there is no screen — so it carries the gizmo's own
 * three modes, sticky, exactly as W/E/R arm them at the desk. One chip rather
 * than three separate gestures, for the same reason the desktop has one gizmo
 * with a mode and not three gizmos.
 */
export type XrGrabMode = 'move' | 'turn' | 'size'

export const GRAB_MODES: ReadonlyArray<{ mode: XrGrabMode; label: string }> = [
  { mode: 'move', label: 'Move' },
  { mode: 'turn', label: 'Turn' },
  { mode: 'size', label: 'Size' },
]

export type XrPropId =
  | 'pin'
  | 'page-select'
  | 'page-shape'
  | 'page-move'
  | 'page-look'
  | 'page-draw'
  | 'page-comfort'
  | 'turn-prev'
  | 'turn-next'
  | 'snap-prev'
  | 'snap-next'
  | 'vignette-prev'
  | 'vignette-next'
  | 'criterion-prev'
  | 'criterion-next'
  | 'value-prev'
  | 'value-next'
  | 'select-apply'
  | 'select-add'
  | 'select-all'
  | 'select-none'
  | 'select-invert'
  | 'vis-hide'
  | 'vis-show'
  | 'vis-only'
  | 'focus-goto'
  | 'focus-follow'
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
  | 'grab-move'
  | 'grab-turn'
  | 'grab-size'
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
  | 'draw-toggle'
  | 'brush-prev'
  | 'brush-next'
  | 'drawz-dec'
  | 'drawz-inc'
  | 'drawz-scrub'
  | 'spacing-dec'
  | 'spacing-inc'
  | 'spacing-scrub'
  | 'spin-dec'
  | 'spin-inc'
  | 'spin-scrub'
  | 'sizejit-dec'
  | 'sizejit-inc'
  | 'sizejit-scrub'

export interface XrPropWidget extends XrWidgetBase {
  id: XrPropId
  /** What the painter puts in it. */
  label: string
  /** A chip that is the current choice (page tab, axis, pin). */
  active?: boolean
  /** A checkbox's state; `null` = mixed, which a multi-selection can be. */
  checked?: boolean | null
  // `disabled` is on XrWidgetBase — the reticle reads it too.
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

/**
 * What the Select page needs from the scene. The VALUES for the current
 * criterion only — `criterionValues` is O(nodes), and computing all three every
 * frame at Event_Cloud's 209k rows would be three full scans a frame for a page
 * that is usually not even open. The panel owns which criterion is showing and
 * the host reads it back, so the list is one frame behind a criterion change —
 * the same staleness rule the rest of this app runs on.
 */
export interface XrPropSelectData {
  criterion: SelectCriterion
  values: readonly CriterionValue[]
  /** How many nodes the scene offers to bulk selection at all. */
  selectable: number
}

/**
 * What the Draw page needs from the host. Everything but `spacing` is the same
 * value the DOM Draw panel edits, so the two surfaces cannot drift — the rule
 * every other VR control follows.
 */
export interface XrDrawData {
  /** Draw Mode is on (it is ONE mode, shared with the desktop's D key). */
  drawing: boolean
  /** The grid a stamp would land on, or null for a scene with none. */
  gridId: number | null
  /** Globe grids cannot be drawn on, on either side. */
  gridIsGlobe: boolean
  /** Brush names, "Single Object" first, then any loaded templates. */
  brushes: readonly string[]
  brushIndex: number
  drawZ: number
  /**
   * Stamp spacing in the GRID's own child coordinates — the one draw setting
   * that is not shared with the desktop panel, because the two measure
   * different things. See DRAW_SPACING_STEP.
   */
  spacing: number
  headingJitter: number
  scaleJitter: number
  /** What the strokes so far have drawn. The status line is DOM and a headset
   *  never sees it, so the page has to carry its own report. */
  stamps: number
  nodes: number
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
  grabMode: XrGrabMode
  labels: XrPropLabels
  select: XrPropSelectData
  draw: XrDrawData
  /** Index into `select.values`, owned by the panel. */
  valueIndex: number
  /** The Select By rows ADD to the selection rather than replacing it. */
  addToSelection: boolean
  /**
   * Follow Selected — the SAME flag the desktop's F key and the DOM checkbox
   * drive, not a second setting that means nearly the same thing (the trap
   * roadmap 6ff names). In a headset it warps to the selection whenever the
   * selection changes, and carries the viewer along with a node animating under
   * Channels; at the desk it re-centres the orbit pivot. One idea, two surfaces.
   */
  followSelected: boolean
  /** Comfort options (render/xrComfort.ts) — the same object the Scene panel's
   *  row edits, so the two surfaces cannot disagree. */
  comfort: ComfortSettings
}

/** The three criteria, in the desktop Select By combo's own order. */
export const SELECT_CRITERIA: readonly SelectCriterion[] = ['branchLevel', 'geometry', 'topo']

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

/** The Draw page's nudges, each in its own row's units. */
export const DRAW_Z_STEP = 1
export const DRAW_JITTER_STEP = 5

/**
 * Stamp spacing steps in the GRID's own child coordinates, and its default.
 *
 * The desktop measures a stroke's spacing in PIXELS of cursor travel, which is
 * the natural unit for a mouse and the wrong one here. On screen, "pixels" ties
 * the brush to the zoom you are drawing at, and the person drawing can see that
 * zoom. In a headset you walk about while you draw and cannot judge your own
 * distance to the plane, so an angular spacing would scatter stamps when you
 * happened to be standing back and crowd them when you leaned in — the same
 * stroke coming out differently for a reason invisible to the person making it.
 *
 * Grid units make the brush a property of the DRAWING rather than of where you
 * were standing, so a stroke is repeatable. 5.0 is the New Object placement
 * step (gv/placement.ts), which is the app's existing idea of "one object away
 * from the last one".
 */
export const DRAW_SPACING_STEP = 1
export const DRAW_SPACING_DEFAULT = 5

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

// --- Panel size ---------------------------------------------------------------

/**
 * The quad's size in METRES, which lives here rather than in the renderer
 * because the layout is what decides whether a control is big enough to hit.
 * Every widget rect is a fraction of these, so this is the only place that
 * turns a normalised number into an angular size at reading distance — and it
 * is what the layout tests measure against.
 *
 * Wider than the 0.26 × 0.22 this panel shipped at (P3): the mode buttons moved
 * into a left column that costs a fifth of the width, and Jeff asked for a
 * larger surface because there are more features to come.
 */
export const PANEL_W_M = 0.3
export const PANEL_H_M = 0.215

// --- Layout bands -------------------------------------------------------------
// Ending short of 1.0: a widget flush with the quad's rounded edge draws
// clipped, which reads as a rendering fault (the control panel's own lesson,
// found in its dumped texture rather than in any assertion).

const PAD = 0.022
export const PIN_RECT: XrRect = rect(0.8, 0.028, 0.175, 0.115)

/**
 * THE MODE COLUMN, down the LEFT edge (Jeff, 2026-08-27 — he is left-handed and
 * will reach for it with that hand).
 *
 * It replaces a row of four tabs across the top, which had run out of room by
 * construction: `TAB_W` was `(1 − PAD·5) / 4`, so a fifth mode could only come
 * out of the width of the other four. A column is bounded by HEIGHT instead,
 * and the panel has room for six at the same lattice the content rows use —
 * which is what makes Draw Mode (and whatever follows it) a list entry rather
 * than a redesign.
 */
export const COL_X = 0.022
export const COL_W = 0.175

/**
 * The content region, right of the column. Every control below is laid out in
 * CONTENT-relative coordinates and mapped through `cx`/`cw`, so the column can
 * be widened, narrowed or moved without re-tuning a single control column —
 * which is the difference between a panel that scales once and one that keeps
 * scaling.
 */
export const CONTENT_X = 0.225
export const CONTENT_W = 0.75

/** Content-relative u → panel u, and the same for a width. */
export function cx(u: number): number {
  return CONTENT_X + u * CONTENT_W
}

export function cw(w: number): number {
  return w * CONTENT_W
}

/** A rect stated in content-relative x/width, on the panel's own y lattice. */
function crect(x: number, y: number, w: number, h: number): XrRect {
  return rect(cx(x), y, cw(w), h)
}

/**
 * Six rows where there were five, the top band having been freed by the tabs
 * leaving it. The column shares the lattice, so a mode button lines up with the
 * row beside it rather than floating between two.
 */
export const ROW_TOP = 0.205
export const ROW_PITCH = 0.128
const ROW_H = 0.115
export const MAX_ROWS = 6

/** Columns, CONTENT-relative. Captions are painter-only; the three control
 *  columns are widgets. */
export const CAP_X = 0.03
const DEC_X = 0.245
const BTN_W = 0.13
export const VAL_X = 0.375
export const VAL_W = 0.4
const INC_X = 0.785
const INC_W = 0.15

/** The axis/step chip row's own columns. */
const AXIS_X = [0.03, 0.16, 0.29]
const AXIS_W = 0.115
const STEP_DEC_X = 0.475
export const STEP_VAL_X = 0.6
export const STEP_VAL_W = 0.175
/** The grab-mode chips start clear of their own caption. */
const GRAB_X = 0.21

export function rowY(index: number): number {
  return ROW_TOP + index * ROW_PITCH
}

/**
 * The mode column's entries, in order. Adding one is a line here — which was
 * the point of moving them off the top edge.
 */
export const PAGES: ReadonlyArray<[XrPropId, XrPropPage, string]> = [
  ['page-select', 'select', 'Select'],
  ['page-shape', 'shape', 'Shape'],
  ['page-move', 'move', 'Move'],
  ['page-look', 'look', 'Look'],
  // A MODE rather than a property page — which is why it is the one entry whose
  // own button turns something on rather than only changing what the panel
  // shows.
  ['page-draw', 'draw', 'Draw'],
  // Last, and the sixth of six slots the column has room for. It belongs IN the
  // headset and not only on the monitor: the person who needs it is the one
  // wearing the thing, and asking them to take it off to stop feeling ill is
  // the wrong answer to feeling ill.
  ['page-comfort', 'comfort', 'Comfort'],
]

/** Is this widget one of the mode buttons? The painter marks the open one, and
 *  an id test beats testing its rect against a band the column no longer has. */
export function isPageWidget(id: string): boolean {
  return id.startsWith('page-')
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

  PAGES.forEach(([id, page, label], i) => {
    widgets.push({
      id,
      kind: 'button',
      rect: rect(COL_X, rowY(i), COL_W, ROW_H),
      label,
      active: state.page === page,
    })
  })

  // The Select page is the one that works with NOTHING selected — that is what
  // it is for. The other three have nothing to show without a node, so only
  // they fall back to the empty state.
  if (state.page === 'select') {
    buildSelect(state, rows, widgets)
    return {
      title: state.count === 0 ? 'Select' : `Select · ${state.count} selected`,
      subtitle: `${state.select.selectable} nodes available`,
      empty: null,
      color: node ? node.color : null,
      rows,
      widgets,
    }
  }

  // Comfort is about the VIEWER, not about any node, so it renders whatever is
  // or is not selected — like Select and Draw, and for a sharper reason than
  // either: someone reaching for it may be reaching for it because they feel
  // unwell, and a page that answers "select something first" would be useless
  // at exactly that moment.
  if (state.page === 'comfort') {
    buildComfort(state.comfort, rows, widgets)
    return {
      title: 'Comfort',
      subtitle: comfortSubtitle(state.comfort),
      empty: null,
      color: null,
      rows,
      widgets,
    }
  }

  // Draw is a MODE, not an inspector — it needs no selection either, and what
  // it wants a selection FOR (choosing which grid to draw on) it reports rather
  // than requires.
  if (state.page === 'draw') {
    buildDraw(state.draw, rows, widgets)
    return {
      title: state.draw.drawing ? 'Draw — ON' : 'Draw',
      subtitle: drawSubtitle(state.draw),
      empty: null,
      color: null,
      rows,
      widgets,
    }
  }

  if (!node) {
    return {
      title: 'Properties',
      subtitle: '',
      empty: 'Point at a glyph, or use the Select tab.',
      color: null,
      rows,
      widgets,
    }
  }

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
      rect: crect(AXIS_X[i], y, AXIS_W, ROW_H),
      label: axis.toUpperCase(),
      active: state.axis === axis,
    })
  })
  widgets.push(
    {
      id: 'step-down',
      kind: 'button',
      rect: crect(STEP_DEC_X, y, BTN_W, ROW_H),
      label: '−',
      disabled: state.step === 0,
    },
    {
      id: 'step-up',
      kind: 'button',
      rect: crect(INC_X, y, INC_W, ROW_H),
      label: '+',
      disabled: state.step === STEP_LADDER.length - 1,
    },
  )

  const axis = state.axis
  vectorRow(rows, widgets, 1, 'translate', num(node.translate[axis]))
  vectorRow(rows, widgets, 2, 'rotate', num(node.rotate[axis]))
  vectorRow(rows, widgets, 3, 'scale', num(node.scale[axis]))

  // What a trigger-held grab out in the scene does. It lives here because these
  // are the three fields it writes — the chip is the gizmo's mode switch, and
  // the rows above are the same three values reached by hand.
  const y4 = rowY(4)
  rows.push({ y: y4, caption: 'grab', value: '' })
  const w = (1 - GRAB_X - PAD - PAD * 2) / 3
  GRAB_MODES.forEach(({ mode, label }, i) => {
    widgets.push({
      id: `grab-${mode}` as XrPropId,
      kind: 'button',
      rect: crect(GRAB_X + i * (w + PAD), y4, w, ROW_H),
      label,
      active: state.grabMode === mode,
    })
  })
}

/**
 * The Select page: the desktop's Select By and Visibility groups
 * (`gv/selectionOps.ts` holds every rule, unchanged — this is a face on them).
 *
 * Two steppers choose the criterion and the value, one wide button applies it,
 * and a checkbox decides whether that REPLACES the selection or adds to it —
 * the desktop's own "Add to Selection". The bulk commands and the visibility
 * commands take a row of three each, which is what fits at a hittable width.
 */
function buildSelect(state: XrPropState, rows: XrPropRow[], widgets: XrPropWidget[]): void {
  const { criterion, values } = state.select
  const current = values[state.valueIndex]
  const empty = values.length === 0

  stepperRow(
    rows,
    widgets,
    0,
    'by',
    CRITERION_LABELS[criterion],
    'criterion-prev',
    'criterion-next',
    false,
  )
  stepperRow(
    rows,
    widgets,
    1,
    'value',
    // The bare label: `criterionValues` already formats geometry and topology
    // as "3: Cube", which is exactly what a stepper wants to show.
    empty ? '—' : current.label,
    'value-prev',
    'value-next',
    empty,
  )

  // Apply, with the Add checkbox beside it. A wide target, because this is the
  // button the two rows above exist to feed.
  //
  // The checkbox is CAPTIONED in the row's value slot, which lands in the gap
  // between the two. A bare tick box says nothing about what it does, and there
  // are no tooltips in a headset — the same fault the Move page's step chip had,
  // and the same way it was found: by looking at the rendered texture rather
  // than at an assertion.
  const y2 = rowY(2)
  rows.push({ y: y2, caption: '', value: 'add' })
  widgets.push(
    {
      id: 'select-apply',
      kind: 'button',
      rect: crect(CAP_X, y2, 0.46, ROW_H),
      label: state.addToSelection ? 'Add matching' : 'Select matching',
      disabled: empty,
    },
    {
      id: 'select-add',
      kind: 'button',
      rect: crect(INC_X, y2, INC_W, ROW_H),
      label: '',
      checked: state.addToSelection,
    },
  )

  tripleRow(rows, widgets, 3, [
    ['select-all', 'All'],
    ['select-none', 'None'],
    ['select-invert', 'Invert'],
  ])
  tripleRow(
    rows,
    widgets,
    4,
    [
      ['vis-hide', 'Hide'],
      ['vis-show', 'Show all'],
      ['vis-only', 'Only'],
    ],
    state.count === 0,
  )

  // TRAVEL, in the sixth row P7 deliberately left empty — and on the Select
  // page rather than a page of its own, because going to the selection is the
  // other half of choosing it. Everything above answers "which nodes"; this
  // answers "take me to them", which in a headset is the question that follows.
  //
  // Laid out as the Apply row is: a wide command with its modifier captioned in
  // the gap beside it. Follow is a checkbox rather than a second button because
  // it is a MODE — it keeps acting long after the press, on every later
  // selection change and on every frame a followed node moves.
  const y5 = rowY(5)
  rows.push({ y: y5, caption: '', value: 'follow' })
  widgets.push(
    {
      id: 'focus-goto',
      kind: 'button',
      rect: crect(CAP_X, y5, 0.46, ROW_H),
      label: 'Go to',
      disabled: state.count === 0,
    },
    {
      id: 'focus-follow',
      kind: 'button',
      rect: crect(INC_X, y5, INC_W, ROW_H),
      label: '',
      checked: state.followSelected,
    },
  )
}

/**
 * The Comfort page: the two measures against VR sickness, and a line saying
 * what they are currently set to.
 *
 * Three steppers rather than any richer control, because these are exactly the
 * enum-ish fields a stepper is for — and the snap-angle row GREYS under smooth
 * turning rather than disappearing, so the page does not change shape under the
 * pointer when the mode above it is toggled (the same rule the Shape page's
 * frozen rows follow).
 */
function buildComfort(
  comfort: ComfortSettings,
  rows: XrPropRow[],
  widgets: XrPropWidget[],
): void {
  stepperRow(
    rows,
    widgets,
    0,
    'turn',
    TURN_MODE_LABELS[comfort.turn],
    'turn-prev',
    'turn-next',
    false,
  )
  stepperRow(
    rows,
    widgets,
    1,
    'step',
    `${comfort.snapDegrees}°`,
    'snap-prev',
    'snap-next',
    comfort.turn !== 'snap',
  )
  stepperRow(
    rows,
    widgets,
    2,
    'tunnel',
    VIGNETTE_LABELS[comfort.vignette],
    'vignette-prev',
    'vignette-next',
    false,
  )
  // A headset has no tooltips, so what each setting is FOR has to be on the
  // panel. Two short lines rather than one long one: at this row height a
  // sentence that wraps three times is not read.
  rows.push({
    y: rowY(3),
    caption: '',
    value: '',
    note:
      comfort.turn === 'snap'
        ? 'Turning jumps in steps — nothing sweeps past you.'
        : 'Turning sweeps smoothly. Snap if that unsettles you.',
  })
  rows.push({
    y: rowY(4),
    caption: '',
    value: '',
    note:
      comfort.vignette === 'off'
        ? 'The view stays full while you move.'
        : 'The view narrows while you move, and opens when you stop.',
  })
}

function comfortSubtitle(comfort: ComfortSettings): string {
  const turn = comfort.turn === 'snap' ? `Snap ${comfort.snapDegrees}°` : 'Smooth turn'
  return `${turn} · tunnel ${VIGNETTE_LABELS[comfort.vignette].toLowerCase()}`
}

/** Three equal buttons across a row — the bulk and visibility commands. */
function tripleRow(
  rows: XrPropRow[],
  widgets: XrPropWidget[],
  index: number,
  entries: Array<[XrPropId, string]>,
  disabled = false,
): void {
  const y = rowY(index)
  rows.push({ y, caption: '', value: '' })
  const w = (1 - PAD * 4) / 3
  entries.forEach(([id, label], i) => {
    widgets.push({
      id,
      kind: 'button',
      rect: crect(PAD + i * (w + PAD), y, w, ROW_H),
      label,
      // Show all is the way OUT of a hide, so it stays live with no selection;
      // Hide and Only need something to act on.
      disabled: disabled && id !== 'vis-show',
    })
  })
}

/**
 * The Draw page: paint objects onto a flat World Grid with the controller.
 *
 * Every rule is the mouse Draw Mode's, unchanged (gv/drawMode.ts,
 * render/drawPlane.ts) — this is a face on it, the way the Select page is a
 * face on selectionOps. The one setting that differs is the spacing's UNIT; see
 * DRAW_SPACING_STEP for why a headset cannot use the desktop's pixels.
 *
 * Six rows, which is the whole panel: this is the page the sixth row slot was
 * left for.
 */
function buildDraw(draw: XrDrawData, rows: XrPropRow[], widgets: XrPropWidget[]): void {
  const y0 = rowY(0)
  rows.push({ y: y0, caption: '', value: '' })
  widgets.push({
    id: 'draw-toggle',
    kind: 'button',
    // Named by what pressing it DOES, the pin's own rule.
    label: draw.drawing ? 'Stop drawing' : 'Start drawing',
    rect: crect(CAP_X, y0, 0.91, ROW_H),
    active: draw.drawing,
    // A globe grid has no drawing plane on either side, so the button says so
    // rather than arming a mode that would refuse every stamp.
    disabled: draw.gridIsGlobe,
  })

  stepperRow(
    rows,
    widgets,
    1,
    'brush',
    draw.brushes[draw.brushIndex] ?? 'Single Object',
    'brush-prev',
    'brush-next',
    // One brush is the Single Object; a stepper that cannot move is inert.
    draw.brushes.length < 2,
  )
  nudgeRow(rows, widgets, 2, 'draw Z', num(draw.drawZ), 'drawz-dec', 'drawz-inc', 'drawz-scrub')
  nudgeRow(
    rows,
    widgets,
    3,
    'spacing',
    num(draw.spacing),
    'spacing-dec',
    'spacing-inc',
    'spacing-scrub',
  )
  nudgeRow(rows, widgets, 4, 'spin ±°', num(draw.headingJitter), 'spin-dec', 'spin-inc', 'spin-scrub')
  nudgeRow(
    rows,
    widgets,
    5,
    'size ±%',
    num(draw.scaleJitter),
    'sizejit-dec',
    'sizejit-inc',
    'sizejit-scrub',
  )
}

/** What the Draw page says about itself: the target, then the running total. */
function drawSubtitle(draw: XrDrawData): string {
  const target =
    draw.gridId === null
      ? 'No World Grid yet — starting will make one'
      : draw.gridIsGlobe
        ? `Grid ${draw.gridId} is a globe — flat grids only`
        : `Grid ${draw.gridId}`
  if (draw.stamps === 0) return target
  const drawn =
    draw.nodes === draw.stamps
      ? `${draw.stamps} object${draw.stamps === 1 ? '' : 's'}`
      : `${draw.stamps} stamps · ${draw.nodes} nodes`
  return `${target} · drew ${drawn}`
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
    { id: prev, kind: 'button', rect: crect(DEC_X, y, BTN_W, ROW_H), label: '‹', disabled },
    { id: next, kind: 'button', rect: crect(INC_X, y, INC_W, ROW_H), label: '›', disabled },
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
    { id: dec, kind: 'button', rect: crect(DEC_X, y, BTN_W, ROW_H), label: '−' },
    { id: scrub, kind: 'scrub', rect: crect(VAL_X, y, VAL_W, ROW_H), label: value },
    { id: inc, kind: 'button', rect: crect(INC_X, y, INC_W, ROW_H), label: '+' },
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
    rect: crect(INC_X, y, INC_W, ROW_H),
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
