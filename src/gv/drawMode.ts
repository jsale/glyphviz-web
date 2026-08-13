// Draw Mode (D): mouse-painting objects onto a flat World Grid.
//
// Behavior ported (not code) from the desktop's glyphviz_core/draw_mode.py
// (commits dfef096 "Add Draw Mode (D)" and 253547b "Draw Mode v2", read
// 2026-08-13). This module is the part with no camera and no THREE in it: the
// drag-stroke gate and the landing of a freshly generated stamp. The
// screen→grid math lives in src/render/drawPlane.ts, where the ray does.
//
// A "stamp" is whatever one click plants: a single object built from the New
// Object Defaults, or a whole Glyph Composer hyperglyph. Either way it arrives
// as a flat node list whose ROOTS sit at translate (0, 0, 0), and placeStamp
// lands those roots on the cursor.

import type { GvNode } from './types'

/**
 * The random draws one stamp needs. `PythonRandom` satisfies it (which is what
 * the parity test feeds in, so the jitter can be diffed against CPython's own
 * `random.Random`); the app passes a plain Math.random-backed one, since the
 * desktop uses the unseeded module-level `random` and no seed is ever shown.
 */
export interface StampRandom {
  uniform(a: number, b: number): number
}

/** Math.random through the desktop's `uniform` formula: a + (b − a)·random(). */
export const mathRandomStamps: StampRandom = {
  uniform: (a, b) => a + (b - a) * Math.random(),
}

/** What one stamp actually drew, for the status line and the tests. */
export interface StampJitter {
  /** Degrees added to each root's rotate_z. */
  heading: number
  /** Factor multiplied onto all three of each root's scale axes. */
  factor: number
}

/**
 * Land a freshly generated stamp at (lon, lat, z) on its grid, with per-stamp
 * jitter. MUTATES `nodes` in place and returns what it drew.
 *
 * Only the stamp's ROOTS — the rows at `baseBranchLevel`, usually one but
 * several for a recipe whose level 0 is a cluster — are touched; every deeper
 * node rides along through the hierarchy, since child placement is relative to
 * its parent.
 *
 * Jitter is drawn ONCE per stamp rather than per node, so a hyperglyph stays
 * coherent: `headingJitterDeg` adds a uniform spin in [−j, +j] to each root's
 * rotate_z (which turns the whole subtree, child placement composing the
 * parent's rotation), and `scaleJitterPct` multiplies all three root scale axes
 * by one uniform factor in [1 − p/100, 1 + p/100], so proportions are preserved
 * and the subtree's spacing scales with it. Both default to 0 = off, which is
 * also the no-draw case: with jitter off the rng is never consulted at all
 * (the desktop's own short-circuit — it keeps a stroke's random stream from
 * depending on how many stamps ran with jitter disabled).
 */
export function placeStamp(
  nodes: readonly GvNode[],
  baseBranchLevel: number,
  lon: number,
  lat: number,
  z: number,
  headingJitterDeg = 0,
  scaleJitterPct = 0,
  rng: StampRandom = mathRandomStamps,
): StampJitter {
  const heading = headingJitterDeg ? rng.uniform(-headingJitterDeg, headingJitterDeg) : 0
  const factor = scaleJitterPct ? 1 + rng.uniform(-scaleJitterPct, scaleJitterPct) / 100 : 1
  for (const n of nodes) {
    if (n.branchLevel !== baseBranchLevel) continue
    n.translate.x += lon
    n.translate.y += lat
    n.translate.z += z
    n.rotate.z += heading
    n.scale.x *= factor
    n.scale.y *= factor
    n.scale.z *= factor
  }
  return { heading, factor }
}

/**
 * Drag-stroke gate: stamp once the cursor is at least `spacingPx` from the
 * previous stamp — and always for a stroke's first point (`last` = null).
 * Spacing 0 stamps on every pointer-move event, the maximum density, which is
 * the convention Jeff's 2D fractal-forest drawing tool set.
 */
export function shouldStamp(
  last: { x: number; y: number } | null,
  x: number,
  y: number,
  spacingPx: number,
): boolean {
  if (last === null) return true
  const dx = x - last.x
  const dy = y - last.y
  return dx * dx + dy * dy >= spacingPx * spacingPx
}
