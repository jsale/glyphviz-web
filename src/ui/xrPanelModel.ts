// The in-VR control panel's layout and hit-testing — pure geometry, no THREE
// and no DOM, so it runs in plain node like xrNav.ts and nextPanelMode.
//
// The panel is a quad on the left wrist that the other hand points at. Its
// widgets are laid out in NORMALISED coordinates (0..1 across, 0..1 down from
// the top), which is what lets the same table drive both the canvas painter
// and the ray hit-test: a ray hit gives a UV, and the widget under that UV is
// the one the trigger acts on. Nothing here knows how many pixels the texture
// has or how many metres the quad is.
//
// There is no desktop counterpart to port — the spike has no in-headset UI at
// all. What it replaces is the DOM HUD, which a session cannot see, so the
// rule for what earns a place is "things you cannot do from inside the
// headset otherwise": the Channels transport, the draw limit (the frame-rate
// lever), the scene switch, and the two framings. Everything that edits node
// data stays out of v1 — that is the authoring phase, and a wrist panel is a
// poor place to discover it.

export type XrWidgetId =
  | 'play'
  | 'stop'
  | 'seek'
  | 'limit-down'
  | 'limit-up'
  | 'scene-prev'
  | 'scene-next'
  | 'fit-room'
  | 'fit-table'

/** Normalised rect: x/y from the panel's top-left, both 0..1. */
export interface XrRect {
  x: number
  y: number
  w: number
  h: number
}

export interface XrWidget {
  id: XrWidgetId
  kind: 'button' | 'slider'
  rect: XrRect
  /** What the painter draws in it (a slider draws its own readout instead). */
  label: string
  /**
   * Transport symbols are DRAWN, not typed: ▶/❙❙/■ depend on font coverage
   * this app cannot check from inside a headset, and a button that renders as
   * a blank box or a tofu glyph is unusable with no tooltip to fall back on.
   */
  icon?: 'play' | 'pause' | 'stop'
}

export interface XrPanelState {
  sceneName: string
  nodeCount: number
  drawnCount: number
  /** null = every eligible node is drawn (no `\` limit in force). */
  drawLimit: number | null
  selection: { id: number; text: string; type: string } | null
  /** null for a scene with no Channels — the transport row goes away. */
  channels: { frame: number; frames: number; playing: boolean } | null
  exampleName: string
}

/**
 * Row bands, top to bottom. Kept as constants so the painter can caption them,
 * and ending at 0.97 rather than 1.0 — a button flush with the panel's rounded
 * edge is drawn clipped, which reads as a rendering fault.
 */
export const ROW_CHANNELS = 0.33
export const ROW_LIMIT = 0.5
export const ROW_SCENE = 0.67
export const ROW_FIT = 0.84
const ROW_H = 0.13
const BTN_W = 0.13
const PAD = 0.03

/**
 * The widgets this state offers. A scene with no Channels has no transport
 * (the painter says so in the empty band) — an inert Play button in a headset
 * is worse than none, since there is no tooltip to explain it.
 */
export function panelWidgets(state: XrPanelState): XrWidget[] {
  const widgets: XrWidget[] = []
  if (state.channels) {
    widgets.push(
      { id: 'stop', kind: 'button', label: 'stop', icon: 'stop', rect: row(ROW_CHANNELS, PAD, BTN_W) },
      {
        id: 'play',
        kind: 'button',
        label: state.channels.playing ? 'pause' : 'play',
        icon: state.channels.playing ? 'pause' : 'play',
        rect: row(ROW_CHANNELS, PAD * 2 + BTN_W, BTN_W),
      },
      {
        id: 'seek',
        kind: 'slider',
        label: 'frame',
        rect: row(ROW_CHANNELS, PAD * 3 + BTN_W * 2, 1 - PAD * 4 - BTN_W * 2),
      },
    )
  }
  widgets.push(
    { id: 'limit-down', kind: 'button', label: '−', rect: row(ROW_LIMIT, PAD, BTN_W) },
    { id: 'limit-up', kind: 'button', label: '+', rect: row(ROW_LIMIT, PAD * 2 + BTN_W, BTN_W) },
    // ‹ › rather than ◀ ▶: the app already steps values that way (the
    // Properties panel's texture row), and a solid triangle here would read as
    // a second Play button one row below the real one.
    { id: 'scene-prev', kind: 'button', label: '‹', rect: row(ROW_SCENE, PAD, BTN_W) },
    { id: 'scene-next', kind: 'button', label: '›', rect: row(ROW_SCENE, PAD * 2 + BTN_W, BTN_W) },
    {
      id: 'fit-room',
      kind: 'button',
      label: 'Room view',
      rect: row(ROW_FIT, PAD, 0.5 - PAD * 1.5),
    },
    {
      id: 'fit-table',
      kind: 'button',
      label: 'Tabletop',
      rect: row(ROW_FIT, 0.5 + PAD * 0.5, 0.5 - PAD * 1.5),
    },
  )
  return widgets
}

function row(y: number, x: number, w: number): XrRect {
  return { x, y, w, h: ROW_H }
}

/** The widget under a normalised point, or null. Later widgets never overlap
 *  earlier ones, so the first hit is the answer. */
export function widgetAt(widgets: readonly XrWidget[], u: number, v: number): XrWidget | null {
  for (const widget of widgets) {
    const { x, y, w, h } = widget.rect
    if (u >= x && u <= x + w && v >= y && v <= y + h) return widget
  }
  return null
}

/** Where along a slider a point falls, clamped — a drag that runs off the end
 *  of the track should pin to the end, not stop responding. */
export function sliderFraction(rect: XrRect, u: number): number {
  if (rect.w <= 0) return 0
  return Math.min(1, Math.max(0, (u - rect.x) / rect.w))
}

/**
 * What the panel's picture depends on. The texture is redrawn only when this
 * changes, which is what keeps a still panel free — the same single-entry
 * cache rule the billboard label follows.
 */
export function panelSignature(state: XrPanelState, hovered: XrWidgetId | null): string {
  const sel = state.selection
  return [
    state.sceneName,
    state.nodeCount,
    state.drawnCount,
    state.drawLimit ?? '-',
    sel ? `${sel.id}|${sel.type}|${sel.text}` : '-',
    state.channels ? `${state.channels.frame}/${state.channels.frames}` : '-',
    state.channels?.playing ?? '-',
    state.exampleName,
    hovered ?? '-',
  ].join('')
}
