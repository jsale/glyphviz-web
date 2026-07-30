import { afterEach, describe, expect, it } from 'vitest'
import {
  BASE_SCALE_MAX,
  BASE_SCALE_MIN,
  baseScale,
  DEFAULT_BASE_SCALE,
  formatBaseScale,
  quantizeBaseScale,
  setBaseScale,
} from './baseScale'

afterEach(() => {
  setBaseScale(DEFAULT_BASE_SCALE)
})

describe('Global Scale value handling', () => {
  it('defaults to the desktop slider default', () => {
    expect(baseScale()).toBe(DEFAULT_BASE_SCALE)
    expect(DEFAULT_BASE_SCALE).toBe(1)
  })

  it('clamps to the desktop slider range', () => {
    // 1..100 in tenths (`_scale_slider.setRange(1, 100)`), so a value typed or
    // computed outside it lands on the end the desktop can also reach.
    expect(quantizeBaseScale(0)).toBe(BASE_SCALE_MIN)
    expect(quantizeBaseScale(-4)).toBe(BASE_SCALE_MIN)
    expect(quantizeBaseScale(1000)).toBe(BASE_SCALE_MAX)
    expect(quantizeBaseScale(Number.NaN)).toBe(DEFAULT_BASE_SCALE)
  })

  it('snaps to the slider lattice instead of storing a float tail', () => {
    expect(quantizeBaseScale(0.31)).toBe(0.3)
    expect(quantizeBaseScale(2.54)).toBe(2.5)
    expect(quantizeBaseScale(2.56)).toBe(2.6)
    // EXACT equality, not close-to: a stored value has to be the same double the
    // desktop's `value / 10.0` produces off an integer slider position, or the
    // two apps' geometry differs in the last bits at the same shown "0.3".
    // Multiplying by a 0.1 step is what fails this (3 × 0.1 is not 0.3).
    for (let tick = 1; tick <= 100; tick++) {
      expect(quantizeBaseScale(tick / 10)).toBe(tick / 10)
    }
  })

  it('reports what it stored, so the label can never disagree with the geometry', () => {
    expect(setBaseScale(3.14)).toBe(baseScale())
    expect(formatBaseScale()).toBe('3.1')
    // The desktop's `f"Scale: {scale:.1f}"` — one decimal, always shown.
    expect(formatBaseScale(1)).toBe('1.0')
    expect(formatBaseScale(10)).toBe('10.0')
  })
})
