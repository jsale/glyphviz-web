import { describe, expect, it } from 'vitest'
import {
  sliderToTopoScale,
  TOPO_SCALE_MAX,
  TOPO_SCALE_MIN,
  TOPO_SCALE_SLIDER_MAX,
  TOPO_SCALE_STEPS_PER_DECADE,
  topoScaleToSlider,
} from './topoScale'
import { DEFAULT_TOPO_SCALE, TOPO_SCALE_ANTZ } from '../gv/types'

describe('the Topology Scale log slider', () => {
  it('spans the desktop’s range at its step density', () => {
    expect(TOPO_SCALE_MIN).toBe(1e-4)
    expect(TOPO_SCALE_MAX).toBe(1e2)
    expect(TOPO_SCALE_SLIDER_MAX).toBe(600) // six decades × 100
  })

  it('round-trips a value through the slider to within one step', () => {
    for (const value of [1e-4, 0.001, TOPO_SCALE_ANTZ, 0.05, 0.5, 1, 3.3, 12, 100]) {
      const back = sliderToTopoScale(topoScaleToSlider(value))
      // One step is 10^(1/100) — about 2.3%.
      expect(Math.abs(Math.log10(back / value))).toBeLessThanOrEqual(
        0.5 / TOPO_SCALE_STEPS_PER_DECADE + 1e-12,
      )
    }
  })

  it('lands exactly on 1.0 at the decade tick — the value that omits the column', () => {
    const pos = topoScaleToSlider(DEFAULT_TOPO_SCALE)
    expect(pos % TOPO_SCALE_STEPS_PER_DECADE).toBe(0)
    expect(sliderToTopoScale(pos)).toBe(1)
    for (const decade of [0.0001, 0.001, 0.01, 0.1, 1, 10, 100]) {
      expect(sliderToTopoScale(topoScaleToSlider(decade))).toBe(decade)
    }
  })

  it('is monotonic, and clamps rather than running off either end', () => {
    let previous = -1
    for (let pos = 0; pos <= TOPO_SCALE_SLIDER_MAX; pos += 7) {
      const value = sliderToTopoScale(pos)
      expect(value).toBeGreaterThan(previous)
      previous = value
    }
    expect(topoScaleToSlider(0)).toBe(0)
    expect(topoScaleToSlider(-3)).toBe(0) // a negative has no log position
    expect(topoScaleToSlider(1e9)).toBe(TOPO_SCALE_SLIDER_MAX)
  })
})
