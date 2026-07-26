import { describe, expect, it } from 'vitest'
import { Geometry, NodeType } from './types'
import type { GvNode } from './types'
import {
  GRID_GLOBE_RADIUS,
  gridCenter,
  gridDrawScale,
  gridExtents,
  gridHalfExtents,
  gridIsGlobe,
  gridSegments,
} from './worldGrid'

function makeGrid(overrides: Partial<GvNode>): GvNode {
  return {
    id: 1,
    type: NodeType.WorldGrid,
    parentId: 0,
    branchLevel: 0,
    translate: { x: 0, y: 0, z: 0 },
    rotate: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    color: { r: 230, g: 230, b: 230, a: 255 },
    geometry: Geometry.GridWire,
    hide: 0,
    topo: 0,
    ratio: 0.1,
    subspace: 0,
    textureId: 0,
    meshId: 0,
    rotationMode: 1,
    colorIndex: 0,
    paletteId: 0,
    translateRate: { x: 0, y: 0, z: 0 },
    rotateRate: { x: 0, y: 0, z: 0 },
    scaleRate: { x: 0, y: 0, z: 0 },
    text: '',
    link: '',
    renderMode: 0,
    fogEnabled: 0,
    fogStart: 0,
    fogEnd: 0,
    showText: 0,
    tagColorMode: 0,
    tagColor: { r: 255, g: 255, b: 200 },
    extras: {},
    ...overrides,
  }
}

describe('gridExtents', () => {
  it('falls back to the whole-earth window for degenerate axes', () => {
    // All-zero extras — the legacy default of files predating the feature.
    expect(gridExtents(makeGrid({}))).toEqual({ lonLo: -180, lonHi: 180, latLo: -90, latHi: 90 })
  })

  it('falls back per axis independently (hi ≤ lo counts as degenerate)', () => {
    const node = makeGrid({
      extras: { trigger_lo_x: '-125', trigger_hi_x: '-66', trigger_lo_y: '30', trigger_hi_y: '30' },
    })
    expect(gridExtents(node)).toEqual({ lonLo: -125, lonHi: -66, latLo: -90, latHi: 90 })
  })

  it('preserves fractional extents', () => {
    const node = makeGrid({
      extras: { trigger_lo_x: '-117.5', trigger_hi_x: '-116.5', trigger_lo_y: '32.5', trigger_hi_y: '33.5' },
    })
    expect(gridExtents(node)).toEqual({ lonLo: -117.5, lonHi: -116.5, latLo: 32.5, latHi: 33.5 })
  })
})

describe('gridCenter / gridHalfExtents', () => {
  it('centers the contiguous-US window at (−95.5, 36.5)', () => {
    const node = makeGrid({
      extras: { trigger_lo_x: '-125', trigger_hi_x: '-66', trigger_lo_y: '24', trigger_hi_y: '49' },
    })
    expect(gridCenter(node)).toEqual({ lon: -95.5, lat: 36.5 })
    expect(gridHalfExtents(node)).toEqual({ lon: 29.5, lat: 12.5 })
  })

  it('centers the default window at (0, 0)', () => {
    expect(gridCenter(makeGrid({}))).toEqual({ lon: 0, lat: 0 })
  })
})

describe('gridIsGlobe', () => {
  it('is true only for Sphere/Sphere-Wire geometry on a type-6 node', () => {
    expect(gridIsGlobe(makeGrid({ geometry: Geometry.SphereSolid }))).toBe(true)
    expect(gridIsGlobe(makeGrid({ geometry: Geometry.SphereWire }))).toBe(true)
    expect(gridIsGlobe(makeGrid({ geometry: Geometry.GridSolid }))).toBe(false)
    expect(gridIsGlobe(makeGrid({ geometry: Geometry.SphereSolid, type: NodeType.Glyph }))).toBe(
      false,
    )
  })
})

describe('gridSegments', () => {
  it('defaults to 16×16 and floors at 1', () => {
    expect(gridSegments(makeGrid({}))).toEqual({ x: 16, y: 16 })
    expect(gridSegments(makeGrid({ extras: { segments_x: '0', segments_y: '-3' } }))).toEqual({
      x: 16,
      y: 1,
    })
    expect(gridSegments(makeGrid({ extras: { segments_x: '36', segments_y: '18' } }))).toEqual({
      x: 36,
      y: 18,
    })
  })
})

describe('gridDrawScale', () => {
  it('spans the extents window times the RAW scale — no floor, no base scale', () => {
    // Default window: half-spans 180×90; tiny scale must NOT hit the 0.2 floor.
    expect(gridDrawScale(makeGrid({ scale: { x: 0.05, y: 0.05, z: 0.05 } }))).toEqual({
      x: 9,
      y: 4.5,
      z: 0.05,
    })
  })

  it('uses the 180/π radius on all axes for a globe', () => {
    const s = gridDrawScale(makeGrid({ geometry: Geometry.SphereSolid, scale: { x: 2, y: 2, z: 2 } }))
    expect(s.x).toBeCloseTo(2 * GRID_GLOBE_RADIUS, 10)
    expect(s.y).toBeCloseTo(2 * GRID_GLOBE_RADIUS, 10)
    expect(s.z).toBeCloseTo(2 * GRID_GLOBE_RADIUS, 10)
  })
})
