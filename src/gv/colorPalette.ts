// Built-in colour palettes — a port (behaviour, not code) of the desktop's
// glyphviz_core/color_palette.py, verified against the real engine's output by
// src/gv/colorPalette.parity.test.ts.
//
// ANTz's model, which is not what you would guess: a node's rendered colour is
// ALWAYS the literal color_r/g/b. `palette_id` + `color_index` are dormant
// metadata that resolve INTO that literal colour only when the user asks — the
// =/− and Alt+=/Alt+− cycle keys, or the Properties panel's Palette / Color
// Index rows. Loading a file never resolves them; rendering never reads them;
// picking a colour with the colour picker leaves them alone (they simply go
// stale until the next cycle overwrites color_r/g/b again).
//
// `color_a` is never touched by palette resolution — ANTz palettes carry no
// alpha.

import { roundHalfToEven } from './pythonRound'
import type { GvNode, Rgb } from './types'

export const Palette = {
  Distinct20: 0,
  Distinct20Inv: 1,
  Rainbow: 2,
  RainbowInv: 3,
  BlueGreen: 4,
  BlueGreenInv: 5,
  GreenRed: 6,
  GreenRedInv: 7,
  BlueRed: 8,
  BlueRedInv: 9,
  PurpleYellow: 10,
  PurpleYellowInv: 11,
  BlackRed: 12,
  BlackRedInv: 13,
  BlackGreen: 14,
  BlackGreenInv: 15,
  BlackBlue: 16,
  BlackBlueInv: 17,
  WhiteRed: 18,
  WhiteRedInv: 19,
  WhiteGreen: 20,
  WhiteGreenInv: 21,
  WhiteBlue: 22,
  WhiteBlueInv: 23,
  Greyscale: 24,
  GreyscaleInv: 25,
} as const

export const PALETTE_COUNT = 26
export const PALETTE_DEFAULT = Palette.Distinct20

/** Odd id = the even id below it with every channel inverted (255 − c). */
export const PALETTE_NAMES: Record<number, string> = {
  [Palette.Distinct20]: '20 Distinct Colors',
  [Palette.Distinct20Inv]: '20 Distinct Colors (Inverted)',
  [Palette.Rainbow]: 'Rainbow Heatmap',
  [Palette.RainbowInv]: 'Rainbow Heatmap (Inverted)',
  [Palette.BlueGreen]: 'Blue → Green',
  [Palette.BlueGreenInv]: 'Blue → Green (Inverted)',
  [Palette.GreenRed]: 'Green → Red',
  [Palette.GreenRedInv]: 'Green → Red (Inverted)',
  [Palette.BlueRed]: 'Blue → Red',
  [Palette.BlueRedInv]: 'Blue → Red (Inverted)',
  [Palette.PurpleYellow]: 'Purple → Yellow',
  [Palette.PurpleYellowInv]: 'Purple → Yellow (Inverted)',
  [Palette.BlackRed]: 'Black → Red',
  [Palette.BlackRedInv]: 'Black → Red (Inverted)',
  [Palette.BlackGreen]: 'Black → Green',
  [Palette.BlackGreenInv]: 'Black → Green (Inverted)',
  [Palette.BlackBlue]: 'Black → Blue',
  [Palette.BlackBlueInv]: 'Black → Blue (Inverted)',
  [Palette.WhiteRed]: 'White → Red',
  [Palette.WhiteRedInv]: 'White → Red (Inverted)',
  [Palette.WhiteGreen]: 'White → Green',
  [Palette.WhiteGreenInv]: 'White → Green (Inverted)',
  [Palette.WhiteBlue]: 'White → Blue',
  [Palette.WhiteBlueInv]: 'White → Blue (Inverted)',
  [Palette.Greyscale]: 'Greyscale',
  [Palette.GreyscaleInv]: 'Greyscale (Inverted)',
}

/**
 * Palette 0's literal table, in id order — ANTz's own documented defaults, so
 * index 0 is "Caribbean current", the documented default node colour, NOT an
 * "unset" sentinel. Every index resolves to a real colour.
 */
const DISTINCT_20: ReadonlyArray<readonly [number, number, number]> = [
  [50, 101, 101], // 0  Caribbean current (default)
  [0, 255, 0], // 1  Green
  [255, 0, 0], // 2  Red
  [0, 0, 255], // 3  Blue
  [255, 255, 0], // 4  Yellow
  [152, 0, 255], // 5  Electric violet
  [255, 168, 0], // 6  Orange
  [0, 255, 255], // 7  Cyan
  [255, 0, 255], // 8  Fuchsia
  [0, 153, 0], // 9  Forest green
  [185, 153, 102], // 10 Lion (gold)
  [255, 180, 255], // 11 Mauve
  [0, 152, 255], // 12 Dodgers blue
  [185, 255, 0], // 13 Lime
  [152, 0, 0], // 14 Penn red
  [127, 127, 127], // 15 Gray
  [127, 127, 255], // 16 Tropical indigo
  [197, 82, 0], // 17 Tawny
  [0, 0, 0], // 18 Black
  [255, 255, 255], // 19 White
]

/** Names for the 20 distinct colours — tooltips only, never written to CSV. */
export const DISTINCT_20_NAMES: readonly string[] = [
  'Caribbean current',
  'Green',
  'Red',
  'Blue',
  'Yellow',
  'Electric violet',
  'Orange',
  'Cyan',
  'Fuchsia',
  'Forest green',
  'Lion',
  'Mauve',
  'Dodgers blue',
  'Lime',
  'Penn red',
  'Gray',
  'Tropical indigo',
  'Tawny',
  'Black',
  'White',
]

/**
 * Even (non-inverted) gradient id → endpoints, linearly interpolated across
 * color_index 0–127. Rainbow (2) is an HSV sweep instead, handled below.
 */
const GRADIENT_ENDPOINTS: Record<number, [readonly [number, number, number], readonly [number, number, number]]> = {
  [Palette.BlueGreen]: [[0, 0, 255], [0, 255, 0]],
  [Palette.GreenRed]: [[0, 255, 0], [255, 0, 0]],
  [Palette.BlueRed]: [[0, 0, 255], [255, 0, 0]],
  [Palette.PurpleYellow]: [[152, 0, 255], [255, 255, 0]],
  [Palette.BlackRed]: [[0, 0, 0], [255, 0, 0]],
  [Palette.BlackGreen]: [[0, 0, 0], [0, 255, 0]],
  [Palette.BlackBlue]: [[0, 0, 0], [0, 0, 255]],
  [Palette.WhiteRed]: [[255, 255, 255], [255, 0, 0]],
  [Palette.WhiteGreen]: [[255, 255, 255], [0, 255, 0]],
  [Palette.WhiteBlue]: [[255, 255, 255], [0, 0, 255]],
  [Palette.Greyscale]: [[0, 0, 0], [255, 255, 255]],
}

const GRADIENT_INDEX_COUNT = 128

/** Positive modulo — Python's `%` never returns a negative for a positive
 *  divisor, JavaScript's does, and a −1 step has to wrap to the top. */
function wrap(value: number, count: number): number {
  return ((value % count) + count) % count
}

/**
 * How many valid color_index values a palette has: 20 for the distinct-colour
 * palettes (0/1), 128 for every gradient (2–25). Sizes the Color Index field
 * and the =/− keys' wraparound. An index outside the range WRAPS (modulo), it
 * does not clamp.
 */
export function paletteIndexCount(paletteId: number): number {
  return paletteId === Palette.Distinct20 || paletteId === Palette.Distinct20Inv
    ? DISTINCT_20.length
    : GRADIENT_INDEX_COUNT
}

/** Python's colorsys.hsv_to_rgb at full saturation/value — the rainbow sweep.
 *  Note it wraps back to red at index 127 (hue 1.0 ≡ hue 0.0). */
function rainbowHeatmap(t: number): [number, number, number] {
  const sector = Math.trunc(t * 6.0)
  const f = t * 6.0 - sector
  const q = 1.0 - f
  const rise = f
  const channels: Array<[number, number, number]> = [
    [1, rise, 0],
    [q, 1, 0],
    [0, 1, rise],
    [0, q, 1],
    [rise, 0, 1],
    [1, 0, q],
  ]
  const [r, g, b] = channels[wrap(sector, 6)]
  return [roundHalfToEven(r * 255), roundHalfToEven(g * 255), roundHalfToEven(b * 255)]
}

/**
 * (palette_id, color_index) → the literal (r, g, b) it resolves to, per ANTz's
 * documented palette table. The index wraps to the palette's own range.
 *
 * Rounding is Python's — half-to-EVEN — because that is what the desktop's
 * `round()` does, and a half-up port would disagree on the gradient steps that
 * land exactly on .5.
 */
export function resolvePaletteColor(paletteId: number, colorIndex: number): Rgb {
  let rgb: [number, number, number]
  if (paletteId === Palette.Distinct20 || paletteId === Palette.Distinct20Inv) {
    rgb = [...DISTINCT_20[wrap(colorIndex, DISTINCT_20.length)]] as [number, number, number]
  } else {
    const baseId = paletteId - wrap(paletteId, 2)
    const t = wrap(colorIndex, GRADIENT_INDEX_COUNT) / (GRADIENT_INDEX_COUNT - 1)
    if (baseId === Palette.Rainbow) {
      rgb = rainbowHeatmap(t)
    } else {
      const endpoints = GRADIENT_ENDPOINTS[baseId]
      // An id with no endpoints can only come from a file that invented one;
      // the desktop would raise here, so fall back to the default palette
      // rather than losing the node's colour to a crash.
      if (!endpoints) return resolvePaletteColor(PALETTE_DEFAULT, colorIndex)
      const [c0, c1] = endpoints
      rgb = [0, 1, 2].map((i) => roundHalfToEven(c0[i] + (c1[i] - c0[i]) * t)) as [
        number,
        number,
        number,
      ]
    }
  }
  if (wrap(paletteId, 2) === 1) rgb = [255 - rgb[0], 255 - rgb[1], 255 - rgb[2]]
  return { r: rgb[0], g: rgb[1], b: rgb[2] }
}

/** Overwrite a node's literal colour from its own palette + index. Alpha is
 *  deliberately untouched. */
function resolveOnto(node: GvNode): void {
  const { r, g, b } = resolvePaletteColor(node.paletteId, node.colorIndex)
  node.color.r = r
  node.color.g = g
  node.color.b = b
}

/**
 * = / − : step each node's `color_index` within ITS OWN palette's range, then
 * resolve. Per node, like the J/O cycles — a selection holding two palettes
 * keeps holding two.
 */
export function cycleColorIndex(targets: readonly GvNode[], step: number): void {
  for (const node of targets) {
    node.colorIndex = wrap(node.colorIndex + step, paletteIndexCount(node.paletteId))
    resolveOnto(node)
  }
}

/**
 * Alt+= / Alt+− : step each node's `palette_id`, re-wrap its index into the new
 * palette's range (20 ↔ 128), and resolve.
 */
export function cyclePalette(targets: readonly GvNode[], step: number): void {
  for (const node of targets) {
    node.paletteId = wrap(node.paletteId + step, PALETTE_COUNT)
    node.colorIndex = wrap(node.colorIndex, paletteIndexCount(node.paletteId))
    resolveOnto(node)
  }
}

/** The Palette dropdown: one id onto every selected node, then resolve. */
export function setPalette(targets: readonly GvNode[], paletteId: number): void {
  for (const node of targets) {
    node.paletteId = paletteId
    node.colorIndex = wrap(node.colorIndex, paletteIndexCount(paletteId))
    resolveOnto(node)
  }
}

/** The Color Index field: one index onto every selected node (wrapped into
 *  each one's own palette range), then resolve. */
export function setColorIndex(targets: readonly GvNode[], colorIndex: number): void {
  for (const node of targets) {
    node.colorIndex = wrap(colorIndex, paletteIndexCount(node.paletteId))
    resolveOnto(node)
  }
}
