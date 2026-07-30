// Global Scale — the desktop's `Viewport.base_scale`, ported as a viewer-level
// value rather than scene data.
//
// It is NOT a per-node scale and it never reaches the CSV: it is the size of a
// unit glyph, and the desktop's Display panel puts it on one slider
// (`main_window.py`'s "Global Scale" group → `_update_scale` → the setter that
// hands it to `Scene`). Two distinct things read it, which is why it cannot be
// modelled as a plain multiplier on rendered size:
//
//   1. DRAW SCALE — `node_world_matrix`'s
//      `S_child = diag(own scale · base_scale, floored at 0.2)`. The floor is
//      applied AFTER the multiply, so raising the global scale also lifts small
//      nodes off the floor (see buildScene.drawScaleCorrection).
//   2. TOPOLOGY PLACEMENT — `compute_world_transforms(nodes, base_scale)` uses
//      it as each topology's unscaled base radius: the distance at which a
//      Sphere parent's children sit on its rendered surface, a Torus's major
//      radius, a Rod's length, a Spiral's pitch. So children ride outward with
//      the parent they are placed on instead of sinking into it.
//
// Exemptions on both sides: a World Grid's own footprint uses raw scale times
// its extents half-spans (`scene._grid_draw_scale` — neither base_scale nor the
// floor), and a globe grid's children place at GRID_GLOBE_RADIUS, which is a
// geographic constant rather than a glyph size.
//
// Module-level mutable state, deliberately: the desktop has exactly one such
// value for the whole viewport, and threading it through every topoOffset /
// draw-scale / gizmo-inverse call site would put a parameter on eight
// signatures — two of them parity-tested — to say the same thing. Tests that
// change it must restore it (setBaseScale(DEFAULT_BASE_SCALE)).

/** Desktop Global Scale default: the slider's 10, i.e. an unscaled glyph. */
export const DEFAULT_BASE_SCALE = 1.0
/** Desktop slider range: 1..100 in tenths (`_scale_slider.setRange(1, 100)`). */
export const BASE_SCALE_MIN = 0.1
export const BASE_SCALE_MAX = 10.0
/** Slider positions per unit: the desktop's value IS an integer over ten. */
export const BASE_SCALE_TICKS_PER_UNIT = 10

let current = DEFAULT_BASE_SCALE

/** The live Global Scale. Read at build time and per animated frame. */
export function baseScale(): number {
  return current
}

/**
 * Set the Global Scale, clamped and quantized to the desktop slider's own
 * lattice so a value shown here is a value that app can reach. Returns what was
 * actually stored.
 */
export function setBaseScale(value: number): number {
  current = quantizeBaseScale(value)
  return current
}

/**
 * Clamp to the slider range and snap to a tenth. Separate from setBaseScale so
 * the UI can label a value without committing it, and so the rounding is
 * testable without touching module state.
 */
export function quantizeBaseScale(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_BASE_SCALE
  const clamped = Math.min(BASE_SCALE_MAX, Math.max(BASE_SCALE_MIN, value))
  // ticks/10, in that order — the desktop's own `value / 10.0` off an integer
  // slider position, so a stored value is bit for bit the one that app holds.
  // Multiplying by 0.1 instead would store 0.30000000000000004 for its 0.3.
  return Math.round(clamped * BASE_SCALE_TICKS_PER_UNIT) / BASE_SCALE_TICKS_PER_UNIT
}

/** Desktop `_update_scale`'s label text: `f"Scale: {scale:.1f}"`. */
export function formatBaseScale(value: number = current): string {
  return value.toFixed(1)
}
