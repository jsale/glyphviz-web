/**
 * Python's `round()` — half-to-even, not JavaScript's half-up. The desktop
 * rounds every integer channel value, palette gradient step and hyperglyph
 * draw through it, so 0.5 steps would otherwise land on different values in
 * the two apps.
 *
 * Its own module (rather than living in channels.ts, where it started)
 * because colorPalette.ts needs it while channels.ts needs the palette
 * resolver — as a channels.ts export that pair is an ESM cycle, which the
 * browser's module graph rejects with a TDZ error even though bundled tests
 * tolerate it. channels.ts re-exports it, so existing importers are
 * unaffected.
 */
export function roundHalfToEven(value: number): number {
  const floor = Math.floor(value)
  const frac = value - floor
  if (frac > 0.5) return floor + 1
  if (frac < 0.5) return floor
  return floor % 2 === 0 ? floor : floor + 1
}

/**
 * Python's `f"{v:g}"` (with `:+g` when `sign` is set) — the shortest of the
 * fixed and exponential forms, trailing zeros trimmed.
 *
 * Node LABELS are what want it, and labels are part of what a parity dump
 * compares: "10" must not come out as "10.000000", and a vertical exaggeration
 * of 2.5 must not come out as "2.500000x". It lives beside `roundHalfToEven`
 * for that module's own reason — the Epitrochoid Generator wrote it first and
 * the point-cloud importer's provenance label needs it too, and an importer
 * reaching into the epicycle module to format a number would be the ESM tangle
 * this file exists to avoid.
 */
export function formatG(value: number, sign = false, precision = 6): string {
  if (!Number.isFinite(value)) return String(value)
  const lead = sign && value >= 0 ? '+' : ''
  if (value === 0) return `${lead}0`
  const [mantissa, expText] = value.toExponential(precision - 1).split('e')
  const exponent = Number(expText)
  if (exponent < -4 || exponent >= precision) {
    const abs = Math.abs(exponent)
    const expSign = exponent < 0 ? '-' : '+'
    return `${lead}${trimTrailingZeros(mantissa)}e${expSign}${abs < 10 ? `0${abs}` : abs}`
  }
  return lead + trimTrailingZeros(value.toFixed(Math.max(0, precision - 1 - exponent)))
}

function trimTrailingZeros(text: string): string {
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text
}
