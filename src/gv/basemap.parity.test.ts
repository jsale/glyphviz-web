// Cross-implementation parity: the basemap planner and reprojection sampler
// against the REAL desktop glyphviz_core.basemap (tools/dump_basemap_plans.py
// dumps it — regenerate the vendored JSON whenever either side's planner or
// resample math changes).
//
// Plans are integers (zoom, tile ranges, output size), so they diff exactly.
// Bboxes are float arithmetic on the same IEEE doubles, so they diff at 1e-12.
// The reprojection arrays come from feeding the desktop's private
// _reproject_to_equirect canvases whose pixels encode their own position; the
// web side rebuilds the same canvases and must pick the same source row for
// every output row and the same source column for every output column.

import { describe, expect, it } from 'vitest'
import fixture from './fixtures/basemap_plans.json'
import {
  DEFAULT_PROVIDER,
  DEFAULT_TARGET_PX,
  DEFAULT_TILE_CAP,
  TILE_SIZE,
  bboxFromNodes,
  planBasemap,
  planTileCount,
  reprojectToEquirect,
} from './basemap'
import type { BBox, BasemapPlan, PixelRect } from './basemap'
import { NodeType } from './types'
import type { GvNode } from './types'

interface FixtureBBox {
  lon_min: number
  lon_max: number
  lat_min: number
  lat_max: number
}

function toBBox(b: FixtureBBox): BBox {
  return { lonMin: b.lon_min, lonMax: b.lon_max, latMin: b.lat_min, latMax: b.lat_max }
}

function webPlan(entry: (typeof fixture.plans)[number]): BasemapPlan {
  return planBasemap(
    toBBox(entry.input_bbox),
    entry.provider ?? DEFAULT_PROVIDER,
    entry.target_px ?? DEFAULT_TARGET_PX,
    entry.tile_cap ?? DEFAULT_TILE_CAP,
  )
}

describe('planBasemap parity', () => {
  for (const entry of fixture.plans) {
    it(entry.name, () => {
      const plan = webPlan(entry)
      const want = entry.plan
      expect(plan.provider.key).toBe(want.provider_key)
      expect(plan.zoom).toBe(want.zoom)
      expect(plan.txMin).toBe(want.tx_min)
      expect(plan.txMax).toBe(want.tx_max)
      expect(plan.tyMin).toBe(want.ty_min)
      expect(plan.tyMax).toBe(want.ty_max)
      expect(plan.outW).toBe(want.out_w)
      expect(plan.outH).toBe(want.out_h)
      expect(planTileCount(plan)).toBe(want.tile_count)
      expect(plan.bbox.lonMin).toBeCloseTo(want.bbox.lon_min, 12)
      expect(plan.bbox.lonMax).toBeCloseTo(want.bbox.lon_max, 12)
      expect(plan.bbox.latMin).toBeCloseTo(want.bbox.lat_min, 12)
      expect(plan.bbox.latMax).toBeCloseTo(want.bbox.lat_max, 12)
    })
  }
})

/** Canvas whose pixels encode their own row (or column) in R (high) / G (low). */
function encodingCanvas(plan: BasemapPlan, encode: 'row' | 'col'): PixelRect {
  const width = (plan.txMax - plan.txMin + 1) * TILE_SIZE
  const height = (plan.tyMax - plan.tyMin + 1) * TILE_SIZE
  const data = new Uint8ClampedArray(width * height * 4)
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const v = encode === 'row' ? row : col
      const at = (row * width + col) * 4
      data[at] = v >> 8
      data[at + 1] = v & 0xff
    }
  }
  return { width, height, data }
}

describe('reprojection sampling parity', () => {
  for (const entry of fixture.plans.filter((p) => p.reproject)) {
    it(entry.name, () => {
      const plan = webPlan(entry)
      const want = entry.reproject!

      const rowsOut = reprojectToEquirect(encodingCanvas(plan, 'row'), plan)
      expect([rowsOut.height, rowsOut.width]).toEqual(want.out_shape)
      const srcRows: number[] = []
      for (let i = 0; i < rowsOut.height; i++) {
        const at = i * rowsOut.width * 4
        srcRows.push((rowsOut.data[at] << 8) | rowsOut.data[at + 1])
      }
      expect(srcRows).toEqual(want.src_rows)

      const colsOut = reprojectToEquirect(encodingCanvas(plan, 'col'), plan)
      const srcCols: number[] = []
      for (let col = 0; col < colsOut.width; col++) {
        srcCols.push((colsOut.data[col * 4] << 8) | colsOut.data[col * 4 + 1])
      }
      expect(srcCols).toEqual(want.src_cols)
    })
  }

  it('covers the cases the dump promised', () => {
    expect(fixture.plans.filter((p) => p.reproject).length).toBeGreaterThanOrEqual(2)
  })
})

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

/** The same node sets tools/dump_basemap_plans.py builds, keyed by case name. */
const BBOX_NODE_CASES: Record<string, GvNode[]> = {
  two_kids: [
    makeNode({ id: 1, type: NodeType.WorldGrid }),
    makeNode({ id: 2, parentId: 1, translate: { x: -120, y: 30, z: 0 } }),
    makeNode({ id: 3, parentId: 1, translate: { x: -110, y: 40, z: 0 } }),
    makeNode({ id: 4, parentId: 2, translate: { x: 999, y: 999, z: 0 } }),
    makeNode({ id: 5, parentId: 0, translate: { x: 50, y: 50, z: 0 } }),
  ],
  single_point: [
    makeNode({ id: 1, type: NodeType.WorldGrid }),
    makeNode({ id: 2, parentId: 1, translate: { x: -117.16, y: 32.72, z: 0 } }),
  ],
  near_limits: [
    makeNode({ id: 1, type: NodeType.WorldGrid }),
    makeNode({ id: 2, parentId: 1, translate: { x: -179.9, y: -89, z: 0 } }),
    makeNode({ id: 3, parentId: 1, translate: { x: 179.9, y: 89, z: 0 } }),
  ],
}

describe('bboxFromNodes parity', () => {
  for (const [name, want] of Object.entries(fixture.bbox_from_nodes)) {
    it(name, () => {
      const nodes = BBOX_NODE_CASES[name]
      expect(nodes, `dump case ${name} has no web twin`).toBeDefined()
      const got = bboxFromNodes(nodes, 1)
      if (want === null) {
        expect(got).toBeNull()
        return
      }
      expect(got).not.toBeNull()
      expect(got!.lonMin).toBeCloseTo(want.lon_min, 12)
      expect(got!.lonMax).toBeCloseTo(want.lon_max, 12)
      expect(got!.latMin).toBeCloseTo(want.lat_min, 12)
      expect(got!.latMax).toBeCloseTo(want.lat_max, 12)
    })
  }
})
