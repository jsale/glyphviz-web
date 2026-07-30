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
