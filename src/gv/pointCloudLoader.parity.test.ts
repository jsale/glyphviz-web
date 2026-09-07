// Point-cloud import parity: this app's importer against the desktop's own.
//
// The fixtures and the expected values are produced by
// tools/dump_point_cloud_import.py, which runs the REAL
// `glyphviz_core.point_cloud_loader` — `fit_to_world`, `resolve_colors`,
// `class_color`, `_decimation_index` and `import_to_nodes` — over LAS/LAZ/PLY/
// ASCII files it writes itself. Both sides read the same bytes, so a difference
// here can only be a difference in the RULES.
//
// The one thing deliberately NOT diffed is the `random` decimation: numpy's
// PCG64 there against CPython's Mersenne Twister here, a divergence documented
// on `decimationIndex` and, crucially, one the desktop's own import dialog
// cannot expose (it passes seed 0 and offers no control). `stride` and `voxel`
// are diffed index for index, and every rule downstream of the sample is diffed
// for all three.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  buildFromData,
  classColor,
  className,
  COLOR_MODES,
  DECIMATE_METHODS,
  DEFAULT_MAX_POINTS,
  DEFAULT_WORLD_SPAN,
  decimationIndex,
  FIT_PERCENTILES,
  fitToWorld,
  loadPointCloud,
  pointCount,
  resolveColors,
  SUPPORTED_EXTENSIONS,
} from './pointCloudLoader'
import type { ColorMode, DecimateMethod, PointCloudData } from './pointCloudLoader'

const fixture = (name: string): URL => new URL(`./fixtures/pointcloud/${name}`, import.meta.url)

interface NodeRow {
  id: number
  type: number
  parent_id: number
  branch_level: number
  translate: [number, number, number]
  scale: [number, number, number]
  color: [number, number, number, number]
  geometry: number
  topo: number
  ratio: number
  hide: number
  rotation_mode: number
  text: string
}

interface Dump {
  constants: {
    default_max_points: number
    default_world_span: number
    fit_percentiles: [number, number]
    color_modes: string[]
    decimate_methods: string[]
    voxel_search_factor: number
    supported_extensions: string[]
  }
  class_table: { colors: Record<string, [number, number, number]>; names: Record<string, string> }
  fit: Array<{
    file: string
    span: number
    exaggeration: number
    scale: number
    center: [number, number, number]
    fitted_head: number[][]
    fitted_min: [number, number, number] | null
    fitted_max: [number, number, number] | null
  }>
  colors: Array<{
    file: string
    requested: string
    used: string
    head: number[][]
    sum: [number, number, number]
  }>
  decimation: Array<{
    file: string
    method: string
    total: number
    target: number
    kept: number
    index: number[]
  }>
  imports: Array<{
    file: string
    options: Record<string, unknown>
    report: Record<string, unknown>
    parent: NodeRow
    points: NodeRow[]
    point_count: number
  }>
}

const dump: Dump = JSON.parse(readFileSync(fixture('point_cloud_import.json'), 'utf8'))

function bytesOf(file: string): Uint8Array {
  return new Uint8Array(readFileSync(fixture(file)))
}

/** Every fixture, loaded whole once — reading them per case is the slow way. */
const wholeCache = new Map<string, Promise<PointCloudData>>()
function whole(file: string): Promise<PointCloudData> {
  let hit = wholeCache.get(file)
  if (!hit) {
    hit = loadPointCloud(file, bytesOf(file), { maxPoints: null })
    wholeCache.set(file, hit)
  }
  return hit
}

describe('point-cloud import parity: constants', () => {
  it('matches the desktop loader value for value', () => {
    expect(DEFAULT_MAX_POINTS).toBe(dump.constants.default_max_points)
    expect(DEFAULT_WORLD_SPAN).toBe(dump.constants.default_world_span)
    expect([...FIT_PERCENTILES]).toEqual(dump.constants.fit_percentiles)
    expect([...COLOR_MODES]).toEqual(dump.constants.color_modes)
    expect([...DECIMATE_METHODS]).toEqual(dump.constants.decimate_methods)
    // .csv is absent from BOTH lists while both readers accept one handed over
    // explicitly — see SUPPORTED_EXTENSIONS' own note.
    expect([...SUPPORTED_EXTENSIONS]).toEqual(dump.constants.supported_extensions)
  })
})

describe('point-cloud import parity: the ASPRS class table', () => {
  it('gives every code the desktop colour, hashed hues included', () => {
    for (const [code, rgb] of Object.entries(dump.class_table.colors)) {
      expect(classColor(Number(code)), `class ${code}`).toEqual(rgb)
    }
  })

  it('names every code the desktop way', () => {
    for (const [code, name] of Object.entries(dump.class_table.names)) {
      expect(className(Number(code)), `class ${code}`).toBe(name)
    }
  })
})

describe('point-cloud import parity: fitToWorld', () => {
  for (const [i, want] of dump.fit.entries()) {
    it(`case ${i}: ${want.file} span ${want.span} × ${want.exaggeration}`, async () => {
      const points =
        want.file === '(empty)' ? new Float64Array(0) : (await whole(want.file)).points
      const got = fitToWorld(points, want.span, want.exaggeration)
      expect(got.scale).toBeCloseTo(want.scale, 12)
      for (let a = 0; a < 3; a++) expect(got.center[a]).toBeCloseTo(want.center[a], 9)
      for (const [row, expected] of want.fitted_head.entries()) {
        for (let a = 0; a < 3; a++) {
          expect(got.points[row * 3 + a], `row ${row} axis ${a}`).toBeCloseTo(expected[a], 9)
        }
      }
      if (want.fitted_min && want.fitted_max) {
        const n = got.points.length / 3
        const lo = [Infinity, Infinity, Infinity]
        const hi = [-Infinity, -Infinity, -Infinity]
        for (let p = 0; p < n; p++) {
          for (let a = 0; a < 3; a++) {
            const v = got.points[p * 3 + a]
            if (v < lo[a]) lo[a] = v
            if (v > hi[a]) hi[a] = v
          }
        }
        for (let a = 0; a < 3; a++) {
          expect(lo[a]).toBeCloseTo(want.fitted_min[a], 9)
          expect(hi[a]).toBeCloseTo(want.fitted_max[a], 9)
        }
      } else {
        expect(got.points.length).toBe(0)
      }
    })
  }
})

describe('point-cloud import parity: resolveColors', () => {
  for (const [i, want] of dump.colors.entries()) {
    it(`case ${i}: ${want.file} asked for ${want.requested}`, async () => {
      const data = await whole(want.file)
      const fit = fitToWorld(data.points)
      const fittedZ = new Float64Array(pointCount(data))
      for (let p = 0; p < fittedZ.length; p++) fittedZ[p] = fit.points[p * 3 + 2]
      const got = resolveColors(data, want.requested as ColorMode, fittedZ)
      // The MODE is the load-bearing half: 'auto' choosing classification on a
      // file that only has the column would give one flat grey cloud.
      expect(got.mode).toBe(want.used)
      for (const [row, expected] of want.head.entries()) {
        for (let a = 0; a < 3; a++) {
          expect(got.colors[row * 3 + a], `row ${row} channel ${a}`).toBe(expected[a])
        }
      }
      // Colours are integers, so the per-channel sum over every point is an
      // exact check on rows the head does not reach.
      const sum = [0, 0, 0]
      for (let p = 0; p < got.colors.length / 3; p++) {
        for (let a = 0; a < 3; a++) sum[a] += got.colors[p * 3 + a]
      }
      expect(sum).toEqual(want.sum)
    })
  }
})

describe('point-cloud import parity: decimation', () => {
  for (const [i, want] of dump.decimation.entries()) {
    it(`case ${i}: ${want.method} ${want.total} → ${want.target} (${want.file})`, async () => {
      const data = await whole(want.file)
      expect(pointCount(data)).toBe(want.total)
      const got = decimationIndex(
        want.total,
        want.target,
        want.method as DecimateMethod,
        0,
        data.points,
      )
      expect(got.length).toBe(want.kept)
      expect([...got]).toEqual(want.index)
    })
  }
})

describe('point-cloud import parity: importPointCloudNodes', () => {
  for (const [i, want] of dump.imports.entries()) {
    it(`case ${i}: ${want.file} ${JSON.stringify(want.options)}`, async () => {
      const o = want.options as {
        max_points?: number | null
        method?: DecimateMethod
        color_mode?: ColorMode
        span?: number
        exaggeration?: number
        point_size?: number
        keep_classes?: number[]
        start_id?: number
        parent_translate?: [number, number, number]
        label_points?: boolean
      }
      const data = await loadPointCloud(want.file, bytesOf(want.file), {
        maxPoints: o.max_points === undefined ? undefined : o.max_points,
        method: o.method,
        keepClasses: o.keep_classes ?? null,
      })
      const { nodes, report } = buildFromData(data, {
        method: o.method,
        colorMode: o.color_mode,
        span: o.span,
        exaggeration: o.exaggeration,
        pointSize: o.point_size,
        keepClasses: o.keep_classes ?? null,
        startId: o.start_id,
        parentTranslate: o.parent_translate,
        labelPoints: o.label_points,
      })

      const r = want.report as {
        name: string
        points: number
        total_points: number
        available_points: number
        color_mode: string
        world_scale: number
        source_center: [number, number, number]
        source_span: [number, number, number]
        world_span: [number, number, number]
        exaggeration: number
        kept_classes: number[] | null
        classes: Record<string, [string, number]>
        decimation: string
      }
      expect(report.name).toBe(r.name)
      expect(report.points).toBe(r.points)
      expect(report.totalPoints).toBe(r.total_points)
      expect(report.availablePoints).toBe(r.available_points)
      expect(report.colorMode).toBe(r.color_mode)
      expect(report.decimation).toBe(r.decimation)
      expect(report.keptClasses).toEqual(r.kept_classes)
      expect(report.exaggeration).toBe(r.exaggeration)
      expect(report.worldScale).toBeCloseTo(r.world_scale, 12)
      for (let a = 0; a < 3; a++) {
        expect(report.sourceCenter[a]).toBeCloseTo(r.source_center[a], 9)
        expect(report.sourceSpan[a]).toBeCloseTo(r.source_span[a], 9)
        expect(report.worldSpan[a]).toBeCloseTo(r.world_span[a], 9)
      }
      expect(
        Object.fromEntries([...report.classes].map(([code, v]) => [String(code), v])),
      ).toEqual(r.classes)

      // The parent's label is the cloud's ONLY memory of how it was made, so it
      // is diffed as a string rather than merely checked for a number in it.
      expectRow(nodes[0], want.parent)
      expect(nodes.length - 1).toBe(want.point_count)
      for (const expected of want.points) {
        const node = nodes.find((n) => n.id === expected.id)
        expect(node, `node ${expected.id}`).toBeDefined()
        expectRow(node!, expected)
      }
    })
  }
})

function expectRow(node: import('./types').GvNode, want: NodeRow): void {
  expect(node.id).toBe(want.id)
  expect(node.type).toBe(want.type)
  expect(node.parentId).toBe(want.parent_id)
  expect(node.branchLevel).toBe(want.branch_level)
  expect(node.translate.x).toBeCloseTo(want.translate[0], 9)
  expect(node.translate.y).toBeCloseTo(want.translate[1], 9)
  expect(node.translate.z).toBeCloseTo(want.translate[2], 9)
  expect([node.scale.x, node.scale.y, node.scale.z]).toEqual(want.scale)
  expect([node.color.r, node.color.g, node.color.b, node.color.a]).toEqual(want.color)
  expect(node.geometry).toBe(want.geometry)
  expect(node.topo).toBe(want.topo)
  expect(node.ratio).toBeCloseTo(want.ratio, 12)
  expect(node.hide).toBe(want.hide)
  expect(node.rotationMode).toBe(want.rotation_mode)
  expect(node.text).toBe(want.text)
}

describe('point-cloud import parity: the LAZ container', () => {
  it('decodes to exactly the cloud the uncompressed file gives', async () => {
    // utm.las and utm.laz are the same points written twice. This is what pins
    // the wasm decoder — the whole LAZ path — without vendoring a real tile.
    const plain = await loadPointCloud('utm.las', bytesOf('utm.las'), { maxPoints: null })
    const packed = await loadPointCloud('utm.laz', bytesOf('utm.laz'), { maxPoints: null })
    expect(pointCount(packed)).toBe(pointCount(plain))
    expect([...packed.points]).toEqual([...plain.points])
    expect([...packed.colors!]).toEqual([...plain.colors!])
    expect([...packed.classification!]).toEqual([...plain.classification!])
    expect([...packed.intensity!]).toEqual([...plain.intensity!])
  })

  it('builds the same nodes from either container', async () => {
    const a = await loadPointCloud('utm.las', bytesOf('utm.las'), {
      maxPoints: 200,
      method: 'stride',
    })
    const b = await loadPointCloud('utm.laz', bytesOf('utm.laz'), {
      maxPoints: 200,
      method: 'stride',
    })
    const built = buildFromData(b, { method: 'stride' })
    // The .laz's stem differs, so the parent label does; everything else must
    // land on the desktop's own utm.las rows.
    expect(built.nodes.length).toBe(buildFromData(a, { method: 'stride' }).nodes.length)
    const want = dump.imports.find(
      (c) => c.file === 'utm.las' && c.options.max_points === 200 && !c.options.color_mode,
    )!
    for (const expected of want.points) {
      const node = built.nodes.find((n) => n.id === expected.id)!
      expect(node.translate.x).toBeCloseTo(expected.translate[0], 9)
      expect([node.color.r, node.color.g, node.color.b]).toEqual(expected.color.slice(0, 3))
    }
  })
})
