import { describe, expect, it } from 'vitest'
import { formatFrameStats, FrameSampler, WINDOW_MS } from './fpsMeter'

// The FpsMeter class itself needs a DOM (this suite runs in plain node), so
// what is tested here is the sampler it wraps and the text it paints.

const info = (calls = 0, triangles = 0) => ({ calls, triangles })

/**
 * Feed `frames` evenly spaced frames, each costing `cpuMs` of loop time.
 * Returns the stats of the last window to close, and the next timestamp.
 */
function run(sampler: FrameSampler, frames: number, spacingMs: number, cpuMs: number, t0: number) {
  let t = t0
  let last = null
  for (let i = 0; i < frames; i++) {
    last = sampler.frame(t, t + cpuMs, info(42, 1234)) ?? last
    t += spacingMs
  }
  return { last, t }
}

describe('formatFrameStats', () => {
  it('reads like the desktop status-bar label, with the extra diagnostics', () => {
    expect(
      formatFrameStats({ fps: 58.63, avgMs: 12.44, peakMs: 31.0, calls: 1432, triangles: 486120 }),
    ).toEqual(['58.6 fps · 12.4 ms cpu (31.0 peak)', '1,432 draw calls · 486,120 tris'])
  })

  it('groups thousands the same way whatever the runtime locale', () => {
    const [, second] = formatFrameStats({
      fps: 1,
      avgMs: 1,
      peakMs: 1,
      calls: 7,
      triangles: 12_345_678,
    })
    expect(second).toBe('7 draw calls · 12,345,678 tris')
  })
})

describe('FrameSampler', () => {
  it('publishes nothing until a full window has elapsed (desktop parity)', () => {
    expect(WINDOW_MS).toBe(1000)
    const { last } = run(new FrameSampler(), 30, 16, 4, 1000)
    expect(last).toBeNull()
  })

  it('measures frames per second over the window and CPU time per frame', () => {
    // 64 frames at 16 ms spans just over a second, closing the window on the
    // frame that crosses it — so a 16 ms cadence reads a shade over 1000/16.
    const { last } = run(new FrameSampler(), 64, 16, 4, 1000)
    expect(last!.fps).toBeGreaterThan(62)
    expect(last!.fps).toBeLessThan(64)
    expect(last!.avgMs).toBeCloseTo(4)
    expect(last!.calls).toBe(42)
    expect(last!.triangles).toBe(1234)
  })

  it('reports the worst frame in the window, not just the mean', () => {
    const sampler = new FrameSampler()
    let t = run(sampler, 30, 16, 2, 1000).t
    expect(sampler.frame(t, t + 90, info())).toBeNull() // one hitch
    t += 90
    const hitched = run(sampler, 40, 16, 2, t)
    expect(hitched.last!.peakMs).toBeCloseTo(90)
    expect(hitched.last!.avgMs).toBeLessThan(10) // the mean hides it

    // Windows do not carry their peak forward.
    expect(run(sampler, 70, 16, 2, hitched.t).last!.peakMs).toBeCloseTo(2)
  })

  it('starts its first window at the first frame, not at construction', () => {
    // The loop hands over absolute performance.now() timestamps, so a sampler
    // built long before the first frame must not report a one-frame window.
    const sampler = new FrameSampler()
    expect(sampler.frame(500_000, 500_004, info())).toBeNull()
    expect(run(sampler, 70, 16, 4, 500_016).last!.fps).toBeGreaterThan(50)
  })
})
