import { describe, expect, it } from 'vitest'
import {
  cycleColorIndex,
  cyclePalette,
  Palette,
  PALETTE_COUNT,
  paletteIndexCount,
  resolvePaletteColor,
  setColorIndex,
  setPalette,
} from './colorPalette'
import { createRootNode } from './createNode'
import type { GvNode } from './types'

function node(overrides: Partial<GvNode> = {}): GvNode {
  return Object.assign(createRootNode([]), overrides)
}

// The exhaustive table lives in colorPalette.parity.test.ts (engine dump).
// These are the samples the spec doc calls out, kept here so a broken port
// fails with a readable name rather than a 3000-entry diff.
describe('resolvePaletteColor', () => {
  it('matches the engine-verified samples', () => {
    expect(resolvePaletteColor(0, 0)).toEqual({ r: 50, g: 101, b: 101 })
    expect(resolvePaletteColor(0, 4)).toEqual({ r: 255, g: 255, b: 0 })
    expect(resolvePaletteColor(2, 0)).toEqual({ r: 255, g: 0, b: 0 })
    expect(resolvePaletteColor(2, 64)).toEqual({ r: 0, g: 249, b: 255 })
    expect(resolvePaletteColor(4, 127)).toEqual({ r: 0, g: 255, b: 0 })
    expect(resolvePaletteColor(9, 0)).toEqual({ r: 255, g: 255, b: 0 })
    expect(resolvePaletteColor(24, 64)).toEqual({ r: 129, g: 129, b: 129 })
  })

  it('inverts the odd id of every pair', () => {
    for (let even = 0; even < PALETTE_COUNT; even += 2) {
      const base = resolvePaletteColor(even, 37)
      expect(resolvePaletteColor(even + 1, 37)).toEqual({
        r: 255 - base.r,
        g: 255 - base.g,
        b: 255 - base.b,
      })
    }
  })

  it('wraps an out-of-range index instead of clamping it', () => {
    expect(resolvePaletteColor(0, 20)).toEqual(resolvePaletteColor(0, 0))
    expect(resolvePaletteColor(0, -1)).toEqual(resolvePaletteColor(0, 19))
    expect(resolvePaletteColor(4, 128)).toEqual(resolvePaletteColor(4, 0))
    expect(resolvePaletteColor(4, -1)).toEqual(resolvePaletteColor(4, 127))
  })

  it('wraps the rainbow sweep back to red at the top of its range', () => {
    expect(resolvePaletteColor(Palette.Rainbow, 127)).toEqual(
      resolvePaletteColor(Palette.Rainbow, 0),
    )
  })
})

describe('paletteIndexCount', () => {
  it('is 20 for the distinct palettes and 128 for every gradient', () => {
    expect(paletteIndexCount(Palette.Distinct20)).toBe(20)
    expect(paletteIndexCount(Palette.Distinct20Inv)).toBe(20)
    for (let id = 2; id < PALETTE_COUNT; id++) expect(paletteIndexCount(id)).toBe(128)
  })
})

describe('cycleColorIndex', () => {
  it('steps each node from its OWN index and resolves the literal colour', () => {
    const a = node({ paletteId: 0, colorIndex: 1 })
    const b = node({ paletteId: 0, colorIndex: 3 })
    cycleColorIndex([a, b], 1)
    expect([a.colorIndex, b.colorIndex]).toEqual([2, 4])
    expect(a.color).toMatchObject({ r: 255, g: 0, b: 0 }) // palette 0 index 2 = Red
    expect(b.color).toMatchObject({ r: 255, g: 255, b: 0 }) // index 4 = Yellow
  })

  // The J/O rule, stated for colour: a selection holding different indices
  // keeps holding different indices. +1 (mod n) is injective, so distinct
  // values can never collide — including across the wrap.
  it('keeps a mixed selection mixed, gaps and all', () => {
    const nodes = [0, 1, 5, 18, 19].map((colorIndex) => node({ paletteId: 0, colorIndex }))
    cycleColorIndex(nodes, 1)
    expect(nodes.map((n) => n.colorIndex)).toEqual([1, 2, 6, 19, 0])
    expect(new Set(nodes.map((n) => n.colorIndex)).size).toBe(nodes.length)
    // Colours track the indices — the whole ramp shifts by one, it does not
    // collapse onto the primary's value.
    expect(new Set(nodes.map((n) => `${n.color.r},${n.color.g},${n.color.b}`)).size).toBe(
      nodes.length,
    )
    cycleColorIndex(nodes, -1)
    expect(nodes.map((n) => n.colorIndex)).toEqual([0, 1, 5, 18, 19]) // exactly back
  })

  it('steps nodes on DIFFERENT palettes each within their own range', () => {
    const distinct = node({ paletteId: Palette.Distinct20, colorIndex: 19 })
    const rainbow = node({ paletteId: Palette.Rainbow, colorIndex: 19 })
    cycleColorIndex([distinct, rainbow], 1)
    expect(distinct.colorIndex).toBe(0) // 20-entry palette wraps
    expect(rainbow.colorIndex).toBe(20) // 128-entry palette keeps going
  })

  it('wraps within each node’s own palette range', () => {
    const distinct = node({ paletteId: Palette.Distinct20, colorIndex: 19 })
    const gradient = node({ paletteId: Palette.Greyscale, colorIndex: 127 })
    cycleColorIndex([distinct, gradient], 1)
    expect([distinct.colorIndex, gradient.colorIndex]).toEqual([0, 0])
    cycleColorIndex([distinct, gradient], -1)
    expect([distinct.colorIndex, gradient.colorIndex]).toEqual([19, 127])
  })

  it('never touches alpha — ANTz palettes carry no alpha', () => {
    const n = node({ paletteId: 0, colorIndex: 0, color: { r: 1, g: 2, b: 3, a: 77 } })
    cycleColorIndex([n], 1)
    expect(n.color.a).toBe(77)
  })
})

describe('cyclePalette', () => {
  it('steps the palette, re-wraps the index into its range and resolves', () => {
    // 128-index gradient at 100 → the 20-colour palette, which has no 100.
    const n = node({ paletteId: Palette.GreyscaleInv, colorIndex: 100 })
    cyclePalette([n], 1)
    expect(n.paletteId).toBe(Palette.Distinct20) // 25 + 1 wraps to 0
    expect(n.colorIndex).toBe(0)
    expect(n.color).toMatchObject({ r: 50, g: 101, b: 101 })
  })

  it('wraps backwards off the bottom', () => {
    const n = node({ paletteId: 0, colorIndex: 5 })
    cyclePalette([n], -1)
    expect(n.paletteId).toBe(PALETTE_COUNT - 1)
    expect(n.colorIndex).toBe(5)
  })
})

describe('setPalette / setColorIndex', () => {
  it('apply absolutely to every node, unlike the per-node cycles', () => {
    const a = node({ paletteId: 0, colorIndex: 2 })
    const b = node({ paletteId: 7, colorIndex: 90 })
    setPalette([a, b], Palette.BlueRed)
    expect([a.paletteId, b.paletteId]).toEqual([Palette.BlueRed, Palette.BlueRed])
    setColorIndex([a, b], 64)
    expect([a.colorIndex, b.colorIndex]).toEqual([64, 64])
    expect(a.color).toMatchObject(resolvePaletteColor(Palette.BlueRed, 64))
    expect(b.color).toMatchObject(resolvePaletteColor(Palette.BlueRed, 64))
  })

  it('re-wraps an index the target palette is too small for', () => {
    const n = node({ paletteId: Palette.Rainbow, colorIndex: 100 })
    setPalette([n], Palette.Distinct20)
    expect(n.colorIndex).toBe(0) // 100 % 20
  })
})
