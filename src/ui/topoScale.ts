// The Topology Scale control's log slider (desktop main_window.py's
// _TOPO_SCALE_* module-level constants and its two mapping functions).
//
// `topo_scale`'s useful range spans several orders of magnitude — 1.0 ("a
// translate unit is a world unit") down past TOPO_SCALE_ANTZ (1/180, "360
// units spans a cube facet") and up for deliberately exploded layouts — so the
// slider is logarithmic: a fixed number of steps per decade, which makes a drag
// feel the same at 0.005 as at 5. The number box beside it takes exact values.
//
// No DOM in here, like fpsMeter's FrameSampler and panel.ts's nextPanelMode, so
// the mapping is testable in plain node.

export const TOPO_SCALE_MIN = 1e-4
export const TOPO_SCALE_MAX = 1e2
export const TOPO_SCALE_STEPS_PER_DECADE = 100

export const TOPO_SCALE_SLIDER_MAX = Math.round(
  (Math.log10(TOPO_SCALE_MAX) - Math.log10(TOPO_SCALE_MIN)) * TOPO_SCALE_STEPS_PER_DECADE,
)

/** topo_scale → log slider position, clamped to the slider's range. */
export function topoScaleToSlider(value: number): number {
  if (!(value > TOPO_SCALE_MIN)) return 0
  const pos =
    (Math.log10(value) - Math.log10(TOPO_SCALE_MIN)) * TOPO_SCALE_STEPS_PER_DECADE
  return Math.max(0, Math.min(TOPO_SCALE_SLIDER_MAX, Math.round(pos)))
}

/**
 * Log slider position → topo_scale. The exact-decade positions (…, 0.01, 0.1,
 * 1.0, 10.0) snap to clean values rather than the 10**-15.999999 the float math
 * would otherwise land on, so dragging to the 1.0 tick gives exactly 1.0 back —
 * the value that omits the CSV column entirely.
 */
export function sliderToTopoScale(pos: number): number {
  const exp = Math.log10(TOPO_SCALE_MIN) + pos / TOPO_SCALE_STEPS_PER_DECADE
  if (pos % TOPO_SCALE_STEPS_PER_DECADE === 0) return decade(Math.round(exp))
  return 10 ** exp
}

/**
 * An exact power of ten. `10 ** -4` is 0.00009999999999999999 in IEEE double
 * (Python's `10.0 ** -4` is not — it divides), and a tick that lands a hair off
 * 0.0001 would write a topo_scale column for a scene that has no reason to
 * carry one.
 */
function decade(exp: number): number {
  return exp < 0 ? 1 / 10 ** -exp : 10 ** exp
}
