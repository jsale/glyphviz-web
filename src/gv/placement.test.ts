// ANTz-style wrapped placement for newly created objects — a port of the
// desktop's tests/test_placement.py, case for case.
//
// What matters here is the wrap, and that the two entry points agree: children
// are placed by ordinal (`wrappedGridOffset`) and roots by stepping on from the
// previous one (`stepFrom`), so a run of Shift+N and a run of N have to walk
// the same lattice or the two gestures would drift apart.

import { describe, expect, it } from 'vitest'
import {
  columnsPerRow,
  DEFAULT_PLACEMENT_STEP,
  PLACEMENT_WRAP,
  stepFrom,
  wrappedGridOffset,
} from './placement'

describe('columnsPerRow', () => {
  it.each([
    [15, 24], // ANTz's own: 24 × 15° = one lap
    [5, 72], // GlyphViz default
    [10, 36],
    [360, 1], // a step of exactly one lap: one per row
    [400, 1], // over a lap: still one per row, never zero
    [7, 52], // 51 × 7 = 357 still fits; 52 × 7 = 364 does not
  ])('step %d gives %d columns', (step, expected) => {
    expect(columnsPerRow(step)).toBe(expected)
  })

  it('keeps every column below a full lap', () => {
    // The invariant the column count exists to guarantee: no object in a row
    // reaches 360, which on a circular topology IS the first object's slot.
    for (const step of [1, 3, 5, 7, 15, 45, 137]) {
      const cols = columnsPerRow(step)
      expect((cols - 1) * step).toBeLessThan(PLACEMENT_WRAP)
      expect(cols * step).toBeGreaterThanOrEqual(PLACEMENT_WRAP)
    }
  })

  it('never divides by zero', () => {
    expect(columnsPerRow(0)).toBe(1)
  })
})

describe('wrappedGridOffset (children, by ordinal)', () => {
  it('puts the first child at the parent origin', () => {
    expect(wrappedGridOffset(0, DEFAULT_PLACEMENT_STEP)).toEqual({ x: 0, y: 0 })
  })

  it('steps along x within a row', () => {
    const step = DEFAULT_PLACEMENT_STEP
    expect(wrappedGridOffset(1, step)).toEqual({ x: 5, y: 0 })
    expect(wrappedGridOffset(3, step)).toEqual({ x: 15, y: 0 })
    expect(wrappedGridOffset(71, step)).toEqual({ x: 355, y: 0 })
  })

  it('wraps to a new row at a full lap', () => {
    // The whole point: the 73rd child at step 5 would land on top of the first,
    // so it starts a new row instead.
    const step = DEFAULT_PLACEMENT_STEP
    expect(wrappedGridOffset(72, step)).toEqual({ x: 0, y: 5 })
    expect(wrappedGridOffset(73, step)).toEqual({ x: 5, y: 5 })
    expect(wrappedGridOffset(144, step)).toEqual({ x: 0, y: 10 })
  })

  it("reproduces ANTz's own rows at its own step", () => {
    // ANTz stepped 15° and bumped y every 24 children (npnode.c:363-370).
    expect(wrappedGridOffset(23, 15)).toEqual({ x: 345, y: 0 })
    expect(wrappedGridOffset(24, 15)).toEqual({ x: 0, y: 15 })
    expect(wrappedGridOffset(47, 15)).toEqual({ x: 345, y: 15 })
    expect(wrappedGridOffset(48, 15)).toEqual({ x: 0, y: 30 })
  })

  it('never gives two objects the same slot', () => {
    // The property "they don't overlap" actually reduces to this.
    for (const step of [1, 5, 7, 15]) {
      const seen = new Set<string>()
      for (let i = 0; i < 500; i++) {
        const { x, y } = wrappedGridOffset(i, step)
        seen.add(`${x},${y}`)
      }
      expect(seen.size).toBe(500)
    }
  })

  it('keeps y climbing rather than wrapping it too', () => {
    // Deliberate divergence from ANTz, which folded y back into −180…180
    // (npnode.c:378-384) and so eventually reused slots. A long run of presses
    // grows a taller grid instead.
    expect(wrappedGridOffset(72 * 60, DEFAULT_PLACEMENT_STEP)).toEqual({ x: 0, y: 300 })
  })

  it('stacks at the origin at step 0', () => {
    expect(wrappedGridOffset(9, 0)).toEqual({ x: 0, y: 0 })
  })

  it('reads a negative step as a distance', () => {
    expect(wrappedGridOffset(3, -5)).toEqual(wrappedGridOffset(3, 5))
  })
})

describe('stepFrom (roots, relative to the previous object)', () => {
  it('steps on from the previous one', () => {
    expect(stepFrom(0, 0, 5)).toEqual({ x: 5, y: 0 })
    expect(stepFrom(40, 0, 5)).toEqual({ x: 45, y: 0 })
  })

  it('wraps to a new row too', () => {
    expect(stepFrom(355, 0, 5)).toEqual({ x: 0, y: 5 })
    expect(stepFrom(345, 15, 15)).toEqual({ x: 0, y: 30 })
  })

  it('keeps the offset of a dragged object', () => {
    // Roots key off wherever the previous object actually IS, so dragging one
    // somewhere carries the next creation along with it.
    expect(stepFrom(100, 60, 5)).toEqual({ x: 105, y: 60 })
  })

  it('leaves a root where the last one is at step 0', () => {
    expect(stepFrom(20, 5, 0)).toEqual({ x: 20, y: 5 })
  })
})

describe('the two entry points describe ONE lattice', () => {
  it('reproduces the ordinal lattice by stepping repeatedly', () => {
    for (const step of [1, 5, 7, 15, 45]) {
      let pos = { x: 0, y: 0 }
      for (let i = 1; i < 200; i++) {
        pos = stepFrom(pos.x, pos.y, step)
        const expected = wrappedGridOffset(i, step)
        expect(pos.x).toBeCloseTo(expected.x, 9)
        expect(pos.y).toBeCloseTo(expected.y, 9)
      }
    }
  })
})
