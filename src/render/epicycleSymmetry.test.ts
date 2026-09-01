// The symmetry claim, checked on the CURVE rather than in the algebra.
//
// `symmetricHarmonics` argues that a figure turns onto itself every 1/fold of a
// revolution exactly when every harmonic leaves the same remainder mod the
// fold. That is a statement about the traced path, so this tests the traced
// path: rotate it by one step and it has to land on itself, sample for sample.
// The arithmetic half (the ladder inverse, the window, the measured fold) is in
// src/gv/epicycles.test.ts; this file is why any of it is worth having.
//
// It lives under render/ because it needs the real tracer, for the same reason
// epicyclePath.test.ts does — a symmetry that held only in a second copy of the
// placement maths would be worth nothing.

import { describe, expect, it } from 'vitest'
import {
  defaultDesign,
  frameCount,
  maxFoldForArms,
  peakHarmonic,
  preset,
  PRESET_NAMES,
  randomSymmetricDesign,
  RATE_LIMIT,
  symmetricArms,
  symmetryFold,
  harmonicsOf,
  describeDesign,
} from '../gv/epicycles'
import type { EpicycleDesign } from '../gv/epicycles'
import { PythonRandom } from '../gv/pythonRandom'
import { traceEpicyclePath } from './epicyclePath'

/**
 * The worst distance between the curve and itself turned by one step of `fold`.
 *
 * A 1/fold turn of a 360-frame cycle is 360/fold frames, which is not a whole
 * frame for a fold like 7 — so the design is traced SLOWED by the fold instead:
 * every rate divided by m samples the same curve m times as finely, the shift
 * becomes exactly 360 samples, and the check is available at any fold rather
 * than only at the divisors of 360.
 *
 * That the slowed trace draws the same curve is not an approximation: dividing
 * every rate by m replaces `z(t)` with `z(t/m)`, which is the same point set
 * walked at a different speed.
 */
function rotationalError(design: EpicycleDesign, fold: number): number {
  const slowed: EpicycleDesign = {
    ...design,
    arms: design.arms.map((a) => ({ ...a, rateX: a.rateX / fold, rateY: a.rateY / fold })),
    frames: 360 * fold,
  }
  const frames = 360 * fold
  const path = traceEpicyclePath(slowed, frames)
  const angle = (2 * Math.PI) / fold
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  let worst = 0
  for (let i = 0; i < frames; i++) {
    const p = path[i]
    const q = path[(i + 360) % frames]
    // Turning the WHOLE figure about z; a symmetric design's out-of-plane
    // motion has to be invariant under the same turn, so z is compared raw.
    worst = Math.max(
      worst,
      Math.hypot(p.x * cos - p.y * sin - q.x, p.x * sin + p.y * cos - q.y, p.z - q.z),
    )
  }
  return worst
}

/**
 * The worst distance between the curve and its reflection in the xz plane —
 * `(x, y, z) → (x, −y, z)`, which is what `z(−t) = conj(z(t))` says.
 *
 * `flipZ` asks for `(x, −y, −z)` instead, which is a half turn about the x axis
 * rather than a reflection. A TUBE needs that form and cannot have the other:
 * the out-of-plane motion is `sin(rate·t)`, which is ODD in t, where the two
 * in-plane coordinates are even and odd respectively. So a flat symmetric
 * design is mirror-symmetric and a spun one has a C2 axis instead — a real
 * difference, and the reason this takes a parameter rather than a tolerance.
 */
function mirrorError(design: EpicycleDesign, flipZ = false): number {
  const frames = frameCount(design)
  const path = traceEpicyclePath(design, frames)
  const zSign = flipZ ? -1 : 1
  let worst = 0
  for (let i = 0; i < frames; i++) {
    const p = path[i]
    const q = path[(frames - i) % frames]
    worst = Math.max(worst, Math.hypot(p.x - q.x, p.y + q.y, p.z - zSign * q.z))
  }
  return worst
}

/** The figure's own size, so an error can be judged as a fraction of it. */
function span(design: EpicycleDesign): number {
  const frames = frameCount(design)
  return describeDesign(design, traceEpicyclePath(design, frames), frames).halfSpan
}

describe('a symmetric design really is symmetric', () => {
  // Folds that divide 360, so the shifted sample is an exact frame.
  for (const fold of [2, 3, 4, 5, 6, 8, 12]) {
    it(`${fold}-fold: the traced curve maps onto itself under a turn of 360/${fold}°`, () => {
      const design = defaultDesign({
        arms: symmetricArms({ fold, count: 12, base: 13, decay: 1 }),
      })
      expect(rotationalError(design, fold)).toBeLessThan(1e-9)
      // And it is EXACTLY that fold, not a coarser one that happens to divide
      // it — a 6-fold figure is also 3-fold, so the claim needs the measure.
      expect(symmetryFold(harmonicsOf(design.arms.map((a) => a.rateX)))).toBe(fold)
    })
  }

  it('and mirror-symmetric too, because the phases are ALIGNED', () => {
    // Rotation plus mirror is the dihedral symmetry of a rose window, which is
    // the whole look this feature is aiming at. Note the phases that buy it are
    // NOT all zero — the construction leaves 90° on every even arm, so aligning
    // them takes (0, 90, 90, 90, …). See `alignedPhases`.
    const design = defaultDesign({
      arms: symmetricArms({ fold: 6, count: 14, base: 13, decay: 1.1 }),
    })
    expect(design.arms.map((a) => a.phaseX)).toEqual([0, ...Array(13).fill(90)])
    expect(mirrorError(design)).toBeLessThan(1e-9)
  })

  it('all-zero phases do NOT give the mirror, which is the trap', () => {
    // Stated because it is the obvious thing to write and it is wrong: with
    // every phase left at zero the even arms sit a quarter turn out and the
    // figure has its rotation but no mirror at all.
    const arms = symmetricArms({ fold: 6, count: 14, base: 13, decay: 1.1 })
    for (const arm of arms) arm.phaseX = 0
    const design = defaultDesign({ arms })
    expect(rotationalError(design, 6)).toBeLessThan(1e-9)
    expect(mirrorError(design)).toBeGreaterThan(0.1 * span(design))
  })

  it('a flipped term keeps the mirror, because −1 is real', () => {
    // The symmetric randomizer leans on this: contributing a term with its sign
    // reversed changes the figure completely and costs no symmetry at all.
    const flips = [false, false, false, true, false, false, false, true, false, false]
    const design = defaultDesign({
      arms: symmetricArms({ fold: 5, count: 10, base: 13, decay: 1, flips }),
    })
    expect(mirrorError(design)).toBeLessThan(1e-9)
    expect(rotationalError(design, 5)).toBeLessThan(1e-9)
    // ...and it really is a different figure, not a no-op.
    const plain = defaultDesign({ arms: symmetricArms({ fold: 5, count: 10, base: 13, decay: 1 }) })
    expect(Math.abs(span(design) - span(plain))).toBeGreaterThan(0.01)
  })

  it('an arbitrary phase keeps the ROTATION and loses the mirror', () => {
    // Rotational symmetry is a fact about the harmonics alone; the mirror is
    // the extra the phases buy. Stated as a test so neither is assumed to
    // imply the other.
    const arms = symmetricArms({ fold: 6, count: 10, base: 13, decay: 1 })
    arms[4].phaseX = 37
    const design = defaultDesign({ arms })
    expect(rotationalError(design, 6)).toBeLessThan(1e-9)
    expect(mirrorError(design)).toBeGreaterThan(0.1 * span(design))
  })

  it('amplitudes are free: any of them keeps the symmetry', () => {
    // The decomposition symmetric Randomize rests on — the harmonics carry the
    // symmetry, the amplitudes carry the character.
    const rng = new PythonRandom(99)
    const arms = symmetricArms({ fold: 7, count: 12, base: 13, decay: 1 })
    for (const arm of arms) arm.length = rng.uniform(0.4, 14)
    const design = defaultDesign({ arms })
    expect(rotationalError(design, 7)).toBeLessThan(1e-9)
  })

  it('a tube on the fold lattice keeps the symmetry in THREE dimensions', () => {
    // The sidebands h, h±r stay in the progression and the out-of-plane motion
    // at r is itself invariant under the turn — only when r is a multiple of
    // the fold.
    const design = defaultDesign({
      arms: symmetricArms({
        fold: 6,
        count: 10,
        base: 13,
        decay: 1.1,
        tubeFraction: 0.5,
        tubeRate: 6,
      }),
    })
    const frames = frameCount(design)
    const path = traceEpicyclePath(design, frames)
    expect(Math.max(...path.map((p) => Math.abs(p.z)))).toBeGreaterThan(1)
    expect(rotationalError(design, 6)).toBeLessThan(1e-9)
    // A spun figure trades the mirror for a HALF TURN about the x axis: the
    // out-of-plane motion is odd in t where the mirror would need it even.
    expect(mirrorError(design, true)).toBeLessThan(1e-9)
    expect(mirrorError(design, false)).toBeGreaterThan(0.1 * span(design))
  })

  it('an off-lattice tube rate is SNAPPED onto the fold, not taken as asked', () => {
    // The caller asks for 5 on a 6-fold design; taking it would cost the very
    // symmetry the function exists to build, so it is rounded onto the lattice.
    const arms = symmetricArms({
      fold: 6,
      count: 10,
      base: 13,
      decay: 1.1,
      tubeFraction: 0.5,
      tubeRate: 5,
    })
    for (const arm of arms) {
      if (arm.tube > 0) expect(arm.rateY % 6).toBe(0)
    }
    expect(rotationalError(defaultDesign({ arms }), 6)).toBeLessThan(1e-9)
    // ...and a rate below one whole step still gets a real tube, not none.
    const slow = symmetricArms({
      fold: 6,
      count: 8,
      base: 13,
      tubeFraction: 0.5,
      tubeRate: 1,
    })
    expect(slow.find((a) => a.tube > 0)!.rateY).toBe(6)
  })

  it('a tube OFF the lattice breaks it — which is why the rate is snapped', () => {
    const arms = symmetricArms({
      fold: 6,
      count: 10,
      base: 13,
      decay: 1.1,
      tubeFraction: 0.5,
      tubeRate: 6,
    })
    // 5 is not a multiple of 6, so the sidebands leave the progression.
    for (const arm of arms) if (arm.tube > 0) arm.rateY = 5
    const design = defaultDesign({ arms })
    expect(rotationalError(design, 6)).toBeGreaterThan(0.05 * span(design))
  })

  it('a free random design has none of this, which is the point', () => {
    // The contrast the symmetric generator exists to make: the desktop's own
    // roller produces a figure with no rotational symmetry at all.
    const design = defaultDesign({
      arms: symmetricArms({ fold: 6, count: 8, base: 13, decay: 1 }),
    })
    design.arms[2].rateX += 1 // one rate off the ladder is enough
    expect(symmetryFold(harmonicsOf(design.arms.map((a) => a.rateX)))).toBe(1)
    expect(rotationalError(design, 6)).toBeGreaterThan(0.05 * span(design))
  })
})

describe('randomSymmetricDesign', () => {
  it('is reproducible from its seed', () => {
    for (const seed of [1, 7, 4242]) {
      const a = randomSymmetricDesign(new PythonRandom(seed), { fold: 6, count: 12 })
      const b = randomSymmetricDesign(new PythonRandom(seed), { fold: 6, count: 12 })
      expect(a.arms).toEqual(b.arms)
      expect(a.penSize).toBe(b.penSize)
    }
  })

  it('every roll comes out exactly the fold it was asked for', () => {
    for (let seed = 0; seed < 8; seed++) {
      for (const fold of [3, 5, 6, 12]) {
        const design = randomSymmetricDesign(new PythonRandom(seed), { fold, count: 12 })
        expect(
          symmetryFold(harmonicsOf(design.arms.map((a) => a.rateX))),
          `seed ${seed}, fold ${fold}`,
        ).toBe(fold)
        expect(rotationalError(design, fold)).toBeLessThan(1e-9)
      }
    }
  })

  it('keeps the mirror as well, whatever it rolled', () => {
    // Flat rolls only: a roll that grew a tube has the half-turn instead, which
    // the 3-D case above pins.
    for (let seed = 0; seed < 12; seed++) {
      const design = randomSymmetricDesign(new PythonRandom(seed), {
        fold: 6,
        count: 10,
        allow3d: false,
      })
      expect(mirrorError(design), `seed ${seed}`).toBeLessThan(1e-9)
    }
  })

  it('a 3-D roll keeps the half turn', () => {
    for (let seed = 0; seed < 20; seed++) {
      const design = randomSymmetricDesign(new PythonRandom(seed), { fold: 6, count: 10 })
      const spun = design.arms.some((a) => a.tube > 0)
      expect(mirrorError(design, spun), `seed ${seed}`).toBeLessThan(1e-9)
    }
  })

  it('rolls genuinely different figures at one fold', () => {
    // If the harmonics are fixed, the variety has to come from somewhere — this
    // is the check that it does.
    const shapes = new Set<string>()
    for (let seed = 0; seed < 12; seed++) {
      const design = randomSymmetricDesign(new PythonRandom(seed), { fold: 6, count: 10 })
      shapes.add(design.arms.map((a) => `${a.length}/${a.phaseX}`).join(','))
    }
    expect(shapes.size).toBe(12)
  })

  it('never rolls a rate or a design past what the trail can sample', () => {
    for (let seed = 0; seed < 16; seed++) {
      for (const count of [2, 8, 20, 32]) {
        const design = randomSymmetricDesign(new PythonRandom(seed), { fold: 16, count })
        for (const arm of design.arms) {
          expect(Math.abs(arm.rateX), `seed ${seed}, ${count} arms`).toBeLessThanOrEqual(RATE_LIMIT)
        }
        expect(peakHarmonic(design)).toBeLessThanOrEqual(RATE_LIMIT)
      }
    }
  })

  it('clamps a fold the arm count cannot carry, rather than aliasing', () => {
    // 16-fold over 32 arms would span harmonics past ±180; the generator drops
    // to what fits instead of producing a smear.
    const design = randomSymmetricDesign(new PythonRandom(3), { fold: 16, count: 32 })
    const fold = symmetryFold(harmonicsOf(design.arms.map((a) => a.rateX)))
    expect(fold).toBe(maxFoldForArms(32))
    expect(fold).toBeLessThan(16)
  })
})

describe('the shipped symmetric presets', () => {
  // The desktop's eight come first and are pinned by the parity harness; these
  // are the web-only ones, and what has to be true of them is that they are
  // what they say they are.
  const cases: Array<[string, number]> = [
    ['Rosette ×5 (8 arms)', 5],
    ['Snowflake ×6 (12 arms)', 6],
    ['Star ×12 (16 arms)', 12],
    ['Mandala ×7 (24 arms)', 7],
    ['Rose window ×12 (28 arms)', 12],
    ['Great weave ×11 (32 arms)', 11],
    ['Spun rosette ×6 (16 arms, 3-D)', 6],
  ]

  for (const [name, fold] of cases) {
    it(`${name} is ${fold}-fold, closed, and inside Nyquist`, () => {
      const design = preset(name)
      expect(symmetryFold(harmonicsOf(design.arms.map((a) => a.rateX)))).toBe(fold)
      const frames = frameCount(design)
      const path = traceEpicyclePath(design, frames)
      const report = describeDesign(design, path, frames)
      // A figure, not a smear: it closes, and the trail can draw what it is.
      expect(report.closes).toBeTruthy()
      expect(report.aliased, `peak ${report.peakHarmonic} vs ${report.nyquist}`).toBe(false)
      // And it is worth looking at: a real spread, not a dot or a circle.
      expect(report.halfSpan).toBeGreaterThan(1)
      expect(report.spectrum.length).toBeGreaterThan(3)
    })
  }

  it('every preset in the list resolves and none is accidentally aliased', () => {
    for (const name of PRESET_NAMES) {
      const design = preset(name)
      const frames = frameCount(design)
      const report = describeDesign(design, traceEpicyclePath(design, frames), frames)
      expect(report.aliased, name).toBe(false)
    }
  })
})
