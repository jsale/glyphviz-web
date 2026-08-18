// Fetch Basemap unit tests — the desktop's tests/test_basemap.py ported test
// for test where the logic is pure (bbox derivation, zoom/tile planning, the
// Mercator → equirectangular reprojection, verified numerically by encoding
// each pixel's global position in its color channels). The desktop's cache /
// failure / progress tests exercise its network-and-disk half; this app's
// equivalent (Cache API + canvas) is browser-only and is verified by driving.

import { describe, expect, it } from 'vitest'
import {
  BasemapError,
  DEFAULT_PROVIDER,
  MERCATOR_LAT_LIMIT,
  PROVIDERS,
  TILE_SIZE,
  bboxFromNodes,
  clampedBBox,
  mercYNorm,
  planBasemap,
  planTileCount,
  reprojectToEquirect,
  tileUrl,
  validateBBox,
} from './basemap'
import type { BBox, BasemapPlan, PixelRect } from './basemap'
import { NodeType } from './types'
import type { GvNode } from './types'

function makeNode(overrides: Partial<GvNode>): GvNode {
  return {
    id: 1,
    type: NodeType.Glyph,
    parentId: 0,
    branchLevel: 1,
    translate: { x: 0, y: 0, z: 0 },
    rotate: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    color: { r: 0, g: 0, b: 0, a: 255 },
    geometry: 7,
    hide: 0,
    topo: 0,
    ratio: 0.1,
    topoScale: 1,
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
    tagFontSize: 11,
    refGridColor: { r: 56, g: 56, b: 71 },
    extras: {},
    ...overrides,
  }
}

function bbox(lonMin: number, lonMax: number, latMin: number, latMax: number): BBox {
  return { lonMin, lonMax, latMin, latMax }
}

// --- BBox / bboxFromNodes ----------------------------------------------------

describe('validateBBox', () => {
  it('rejects inverted and antimeridian-crossing windows', () => {
    expect(() => validateBBox(bbox(10, 10, 0, 5))).toThrow(BasemapError)
    expect(() => validateBBox(bbox(0, 10, 8, 3))).toThrow(BasemapError)
    // Dateline crossing unsupported in V1, as on the desktop.
    expect(() => validateBBox(bbox(170, 190, 0, 10))).toThrow(BasemapError)
  })
})

describe('clampedBBox', () => {
  it('clamps to Mercator limits', () => {
    const b = clampedBBox(bbox(-200, 200, -90, 90))
    expect([b.lonMin, b.lonMax]).toEqual([-180, 180])
    expect(b.latMin).toBe(-MERCATOR_LAT_LIMIT)
    expect(b.latMax).toBe(MERCATOR_LAT_LIMIT)
  })
})

describe('bboxFromNodes', () => {
  it('uses direct children only, with padding', () => {
    const grid = makeNode({ id: 1, type: NodeType.WorldGrid })
    const kids = [
      makeNode({ id: 2, parentId: 1, translate: { x: -120, y: 30, z: 0 } }),
      makeNode({ id: 3, parentId: 1, translate: { x: -110, y: 40, z: 0 } }),
    ]
    // Relative to its parent — must not count.
    const grandkid = makeNode({ id: 4, parentId: 2, translate: { x: 999, y: 999, z: 0 } })
    const stranger = makeNode({ id: 5, parentId: 0, translate: { x: 50, y: 50, z: 0 } })
    const b = bboxFromNodes([grid, ...kids, grandkid, stranger], 1)!
    expect(b.lonMin).toBeGreaterThanOrEqual(-120.5)
    expect(b.lonMin).toBeLessThan(-120)
    expect(b.lonMax).toBeGreaterThan(-110)
    expect(b.lonMax).toBeLessThanOrEqual(-109.5)
    expect(b.latMin).toBeGreaterThanOrEqual(29.5)
    expect(b.latMin).toBeLessThan(30)
    expect(b.latMax).toBeGreaterThan(40)
    expect(b.latMax).toBeLessThanOrEqual(40.5)
  })

  it('gives a single-point dataset a real window', () => {
    const grid = makeNode({ id: 1, type: NodeType.WorldGrid })
    const kid = makeNode({ id: 2, parentId: 1, translate: { x: -117.16, y: 32.72, z: 0 } })
    const b = bboxFromNodes([grid, kid], 1)!
    expect(() => validateBBox(b)).not.toThrow()
    expect(b.lonMax - b.lonMin).toBeGreaterThanOrEqual(1.0)
    expect(b.latMax - b.latMin).toBeGreaterThanOrEqual(1.0)
  })

  it('is null when the grid has no children', () => {
    expect(bboxFromNodes([makeNode({ id: 1, type: NodeType.WorldGrid })], 1)).toBeNull()
  })
})

// --- planBasemap ---------------------------------------------------------------

describe('planBasemap', () => {
  it('backs the whole earth off to the tile cap', () => {
    const plan = planBasemap(bbox(-180, 180, -90, 90), DEFAULT_PROVIDER, 1536, 48)
    // Resolution alone wants zoom 3 (8x8 = 64 tiles); the cap forces zoom 2.
    expect(plan.zoom).toBe(2)
    expect(planTileCount(plan)).toBeLessThanOrEqual(48)
    expect(plan.outW).toBe(4 * TILE_SIZE)
  })

  it('balances a small region against the default cap', () => {
    const plan = planBasemap(bbox(-118, -116, 32, 34))
    // Resolution alone wants zoom 11 (~160 tiles); the default cap backs off
    // to zoom 10 — 56 tiles, 1456 px wide. The cap always wins.
    expect(plan.zoom).toBe(10)
    expect(planTileCount(plan)).toBeLessThanOrEqual(60)
    expect(plan.outW).toBeGreaterThanOrEqual(1024)
    // Square pixels in degree space: 2° x 2° window → square output.
    expect(Math.abs(plan.outH - plan.outW)).toBeLessThanOrEqual(1)
  })

  it('matches the output aspect to the degree aspect', () => {
    const plan = planBasemap(bbox(-125, -66, 24, 49))
    expect(plan.outH / plan.outW).toBeCloseTo(25 / 59, 2)
  })

  it('rejects an unknown provider', () => {
    expect(() => planBasemap(bbox(0, 10, 0, 10), 'nope')).toThrow(BasemapError)
  })

  it('respects max zoom for a tiny bbox', () => {
    const plan = planBasemap(bbox(0, 0.001, 0, 0.001))
    expect(plan.zoom).toBeLessThanOrEqual(PROVIDERS[DEFAULT_PROVIDER].maxZoom)
  })
})

describe('tileUrl', () => {
  it('fills each provider template', () => {
    expect(tileUrl(PROVIDERS.osm, 3, 1, 2)).toBe('https://tile.openstreetmap.org/3/1/2.png')
    // Esri's path is {z}/{y}/{x} — y before x.
    expect(tileUrl(PROVIDERS.esri_imagery, 3, 1, 2)).toBe(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/3/2/1',
    )
  })
})

// --- reprojectToEquirect --------------------------------------------------------
//
// The desktop test's trick, without its PNG round trip: synthesize the stitched
// canvas directly, each pixel encoding its GLOBAL canvas position in its color
// channels, and read the reprojected output to see where each row/column came
// from.

/** Stitched-canvas stand-in: R/G encode the canvas row, B/A the canvas column. */
function encodingCanvas(plan: BasemapPlan): PixelRect {
  const width = (plan.txMax - plan.txMin + 1) * TILE_SIZE
  const height = (plan.tyMax - plan.tyMin + 1) * TILE_SIZE
  const data = new Uint8ClampedArray(width * height * 4)
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const at = (row * width + col) * 4
      data[at] = row >> 8
      data[at + 1] = row & 0xff
      data[at + 2] = col >> 8
      data[at + 3] = col & 0xff
    }
  }
  return { width, height, data }
}

function mercYPx(latDeg: number, zoom: number): number {
  return mercYNorm(latDeg) * (1 << zoom) * TILE_SIZE
}

describe('reprojectToEquirect', () => {
  // Contiguous US: strong Mercator stretch. Output row i (linear in latitude)
  // must have been sampled from the Mercator source row for that latitude,
  // within 1 px; a plain crop would be off by ~40 rows mid-image here.
  const box = bbox(-125, -66, 24, 49)
  const plan = planBasemap(box, DEFAULT_PROVIDER, 512, 48)
  const out = reprojectToEquirect(encodingCanvas(plan), plan)

  it('samples rows Mercator-correctly, not as a linear crop', () => {
    expect(out.height).toBe(plan.outH)
    const y0 = plan.tyMin * TILE_SIZE
    const expected: number[] = []
    for (let i = 0; i < plan.outH; i++) {
      const lat = plan.bbox.latMax + (plan.bbox.latMin - plan.bbox.latMax) * (i / (plan.outH - 1))
      expected.push(mercYPx(lat, plan.zoom) - y0)
    }
    let worst = 0
    for (let i = 0; i < plan.outH; i++) {
      const at = i * out.width * 4
      const got = (out.data[at] << 8) | out.data[at + 1]
      worst = Math.max(worst, Math.abs(got - expected[i]))
    }
    expect(worst).toBeLessThanOrEqual(1.0)
    // And it must NOT be a plain linear crop: nonlinearity visible mid-image.
    let nonlinearity = 0
    for (let i = 0; i < plan.outH; i++) {
      const linear = expected[0] + ((expected[plan.outH - 1] - expected[0]) * i) / (plan.outH - 1)
      nonlinearity = Math.max(nonlinearity, Math.abs(expected[i] - linear))
    }
    expect(nonlinearity).toBeGreaterThan(10)
  })

  it('crops columns as a linear longitude window', () => {
    const nPx = (1 << plan.zoom) * TILE_SIZE
    const left = Math.round((plan.bbox.lonMin + 180.0) / 360.0 * nPx) - plan.txMin * TILE_SIZE
    expect(out.width).toBe(plan.outW)
    for (let col = 0; col < out.width; col++) {
      const at = col * 4
      const got = (out.data[at + 2] << 8) | out.data[at + 3]
      expect(got).toBe(left + col)
    }
  })
})
