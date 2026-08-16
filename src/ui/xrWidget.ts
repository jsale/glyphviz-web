// Widget primitives shared by the in-headset panels — pure geometry, no THREE
// and no DOM, so every panel MODEL runs in plain node the way xrNav.ts and
// nextPanelMode do.
//
// Widgets are laid out in NORMALISED coordinates (0..1 across, 0..1 down from
// the top). That is what lets one table drive both the canvas painter and the
// ray hit test: a ray hit gives a UV, and the widget under that UV is the one
// the trigger acts on. Nothing here knows how many pixels a texture has or how
// many metres a quad is.

/** Normalised rect: x/y from the panel's top-left, both 0..1. */
export interface XrRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * What every panel widget has in common.
 *
 *   button  fires once on the rising edge of the trigger
 *   slider  jumps to where the ray is and tracks it while the trigger is held
 *   scrub   tracks the ray's DISPLACEMENT from where the trigger came down,
 *           which is what a value with no natural end stops needs (a slider
 *           has a track; a translate axis does not)
 */
export interface XrWidgetBase {
  id: string
  kind: 'button' | 'slider' | 'scrub'
  rect: XrRect
}

/** The widget under a normalised point, or null. Widgets never overlap, so the
 *  first hit is the answer. */
export function widgetAt<W extends XrWidgetBase>(
  widgets: readonly W[],
  u: number,
  v: number,
): W | null {
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

/** A rect on a row band, for the common "one row, several controls" case. */
export function rect(x: number, y: number, w: number, h: number): XrRect {
  return { x, y, w, h }
}
