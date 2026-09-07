// Point-cloud import — the behavioural claims, beside the value-for-value diff
// in pointCloudLoader.parity.test.ts.
//
// The desktop's own tests/test_point_cloud_loader.py is ported case for case
// here, because those cases state PROPERTIES a parity dump cannot: that a fit is
// uniform across axes, that one wild outlier does not shrink the scan, that
// voxel sampling really does spread more evenly than a random one. The rest are
// web-only — the container reader, the formats the desktop reaches through a
// library, and the two places this app is deliberately more forgiving.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  buildPointCloudNodes,
  classCounts,
  decimationIndex,
  extentsOf,
  fitToWorld,
  importPointCloudNodes,
  isPointCloudFileName,
  isReallyClassified,
  loadPointCloud,
  pointCount,
  resolveColors,
  spanOf,
} from './pointCloudLoader'
import type { PointCloudData } from './pointCloudLoader'
import { LasError, readLasHeader } from '../io/lasFile'
import { PlyError, parsePlyFile } from '../io/plyFile'
import { Geometry, Topo } from './types'
import { pointSize } from './pointCloud'

const fixture = (name: string): URL => new URL(`./fixtures/pointcloud/${name}`, import.meta.url)
const bytes = (name: string): Uint8Array => new Uint8Array(readFileSync(fixture(name)))
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)

// ------------------------------------------------------------- containers ---

describe('the LAS container', () => {
  it('reads the public header of an uncompressed file', () => {
    const header = readLasHeader(bytes('utm.las'))
    expect(header.version).toBe('1.2')
    expect(header.pointFormat).toBe(3)
    expect(header.pointCount).toBe(5000)
    expect(header.compressed).toBe(false)
    expect(header.hasRgb).toBe(true)
  })

  it('reads the same header out of the compressed twin', () => {
    // A LAZ writes its public header uncompressed, which is what makes a scan
    // of a multi-gigabyte file free. Only the format byte's high bits differ.
    const plain = readLasHeader(bytes('utm.las'))
    const packed = readLasHeader(bytes('utm.laz'))
    expect(packed.compressed).toBe(true)
    expect(packed.pointFormat).toBe(plain.pointFormat)
    expect(packed.pointCount).toBe(plain.pointCount)
    expect(packed.scale).toEqual(plain.scale)
    expect(packed.offset).toEqual(plain.offset)
  })

  it('reads a LAS 1.4 header, whose point count is 64-bit', () => {
    const header = readLasHeader(bytes('user_classes.las'))
    expect(header.version).toBe('1.4')
    expect(header.pointFormat).toBe(6)
    expect(header.pointCount).toBe(800)
  })

  it('refuses bytes that are not a LAS file', () => {
    expect(() => readLasHeader(utf8('x'.repeat(400)))).toThrow(LasError)
  })

  it('says a truncated file is truncated rather than reading past its end', async () => {
    const full = bytes('utm.las')
    const cut = full.subarray(0, full.length - 4000)
    await expect(loadPointCloud('cut.las', cut, { maxPoints: null })).rejects.toThrow(/Truncated/)
  })

  it('masks the classification sub-field in a legacy point format', async () => {
    // withheld.las sets bit 7 on a third of its points. Unmasked, those class-2
    // ground returns read as 130 — outside the ASPRS table, coloured as a user
    // class, and invisible to a "keep ground" filter.
    const data = await loadPointCloud('withheld.las', bytes('withheld.las'), { maxPoints: null })
    expect([...classCounts(data).keys()]).toEqual([2, 6])
  })

  it('reads a full classification byte in a 1.4 point format', async () => {
    const data = await loadPointCloud('user_classes.las', bytes('user_classes.las'), {
      maxPoints: null,
    })
    expect([...classCounts(data).keys()]).toEqual([2, 64, 65, 73, 77])
  })
})

describe('the PLY container', () => {
  it('reads a binary point cloud with vertex colour', () => {
    const ply = parsePlyFile(bytes('scan.ply'))
    expect(ply.vertexCount).toBe(450)
    expect(ply.colors).not.toBeNull()
    expect(ply.indices).toBeNull()
  })

  it('reads an ASCII mesh, triangulating its faces as fans', () => {
    const text =
      'ply\nformat ascii 1.0\nelement vertex 4\nproperty float x\nproperty float y\n' +
      'property float z\nelement face 1\nproperty list uchar int vertex_indices\n' +
      'end_header\n0 0 0\n1 0 0\n1 1 0\n0 1 0\n4 0 1 2 3\n'
    const ply = parsePlyFile(utf8(text))
    expect(ply.vertexCount).toBe(4)
    // A quad becomes two triangles, sharing the fan's first vertex.
    expect([...ply.indices!]).toEqual([0, 1, 2, 0, 2, 3])
  })

  it('scales float colour properties to bytes and leaves integer ones alone', () => {
    const floatPly =
      'ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nproperty float y\n' +
      'property float z\nproperty float red\nproperty float green\nproperty float blue\n' +
      'end_header\n0 0 0 1 0.5 0\n'
    expect([...parsePlyFile(utf8(floatPly)).colors!]).toEqual([255, 128, 0])
    const bytePly =
      'ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nproperty float y\n' +
      'property float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\n' +
      'end_header\n0 0 0 200 100 0\n'
    expect([...parsePlyFile(utf8(bytePly)).colors!]).toEqual([200, 100, 0])
  })

  it('refuses bytes with no PLY header', () => {
    expect(() => parsePlyFile(utf8('not a ply at all'))).toThrow(PlyError)
  })
})

describe('the ASCII reader', () => {
  it('reads whitespace x y z', async () => {
    const data = await loadPointCloud('s.xyz', utf8('# a comment\n1 2 3\n4 5 6\n7 8 9\n'), {
      maxPoints: null,
    })
    expect(pointCount(data)).toBe(3)
    expect([...data.points.slice(3, 6)]).toEqual([4, 5, 6])
  })

  it('reads comma-separated rows', async () => {
    const data = await loadPointCloud('s.xyz', utf8('1,2,3\n4,5,6\n'), { maxPoints: null })
    expect(pointCount(data)).toBe(2)
  })

  it('reads 0-255 colour columns', async () => {
    const data = await loadPointCloud('s.pts', utf8('1 2 3 255 0 0\n4 5 6 0 255 0\n'), {
      maxPoints: null,
    })
    expect([...data.colors!.slice(0, 3)]).toEqual([255, 0, 0])
  })

  it('reads 0-1 float colour columns', async () => {
    const data = await loadPointCloud('s.pts', utf8('1 2 3 1 0.5 0\n4 5 6 0 1 0.25\n'), {
      maxPoints: null,
    })
    // numpy's .astype(uint8) truncates: 0.5 * 255 = 127.5 → 127, not 128.
    expect([...data.colors!.slice(0, 3)]).toEqual([255, 127, 0])
  })

  it('skips a plain text header line — which the desktop cannot', async () => {
    // Divergence, in this app's favour and reported to Jeff. The desktop's
    // `_read_ascii` docstring promises "any leading line that does not parse as
    // numbers is treated as a header and skipped", and for a COMMA-delimited
    // file it is. For a whitespace one the header becomes a row of NaNs, the
    // comma retry then reads the whole file as one very wide row, and the load
    // fails outright with "No x y z columns found".
    const data = await loadPointCloud('s.xyz', utf8('x y z\n1 2 3\n4 5 6\n7 8 9\n'), {
      maxPoints: null,
    })
    expect(pointCount(data)).toBe(3)
  })

  it('says so when there are no coordinates at all', async () => {
    await expect(loadPointCloud('s.xyz', utf8('nope\nnothing\n'), {})).rejects.toThrow(
      /No x y z columns/,
    )
  })
})

describe('what the importer will and will not claim', () => {
  it('recognizes the point-cloud extensions', () => {
    for (const name of ['a.las', 'a.LAZ', 'a.ply', 'a.xyz', 'a.pts', 'a.txt']) {
      expect(isPointCloudFileName(name), name).toBe(true)
    }
  })

  it('never claims a .csv, which in this app is a SCENE', () => {
    // Node CSVs are identified by their columns rather than their name, so an
    // importer that claimed the extension would break scene opening outright.
    expect(isPointCloudFileName('Topology_Example_gv_node.csv')).toBe(false)
  })

  it('refuses a format it does not read, by name', async () => {
    await expect(loadPointCloud('scan.e57', utf8('x'), {})).rejects.toThrow(/Unsupported/)
  })
})

// ---------------------------------------------------------------- fitting ---

describe('fitToWorld', () => {
  it('recentres a projected scan and spans the larger horizontal axis', async () => {
    const data = await loadPointCloud('utm.las', bytes('utm.las'), { maxPoints: null })
    const fit = fitToWorld(data.points, 360)
    expect(Math.abs(fit.center[0] - 636_500)).toBeLessThan(500)
    const { lo, hi } = extentsOf({ ...data, points: fit.points })
    const wide = Math.max(hi[0] - lo[0], hi[1] - lo[1])
    expect(wide).toBeGreaterThan(340)
    expect(wide).toBeLessThan(380)
  })

  it('is uniform across axes, so terrain is never stretched', async () => {
    const data = await loadPointCloud('utm.las', bytes('utm.las'), { maxPoints: null })
    const src = spanOf(data)
    const got = spanOf({ ...data, points: fitToWorld(data.points).points })
    for (let a = 1; a < 3; a++) {
      expect(got[a] / got[0]).toBeCloseTo(src[a] / src[0], 6)
    }
  })

  it('touches only z when exaggerating', async () => {
    const data = await loadPointCloud('utm.las', bytes('utm.las'), { maxPoints: 200, method: 'stride' })
    const flat = fitToWorld(data.points, 360, 1)
    const tall = fitToWorld(data.points, 360, 3)
    for (let i = 0; i < pointCount(data); i++) {
      expect(tall.points[i * 3]).toBe(flat.points[i * 3])
      expect(tall.points[i * 3 + 1]).toBe(flat.points[i * 3 + 1])
      expect(tall.points[i * 3 + 2]).toBeCloseTo(flat.points[i * 3 + 2] * 3, 12)
    }
  })

  it('is not collapsed by one wild outlier', async () => {
    // Airborne LIDAR reliably contains gross outliers — birds, cloud returns,
    // multipath. Fitting off raw min/max would let one of them shrink the whole
    // cloud toward invisibility; the 0.1/99.9 percentile box is what stops it.
    const data = await loadPointCloud('outlier.las', bytes('outlier.las'), { maxPoints: null })
    const fit = fitToWorld(data.points, 360)
    let wideX = -Infinity
    let wideY = -Infinity
    let loX = Infinity
    let loY = Infinity
    for (let i = 1; i < pointCount(data); i++) {
      wideX = Math.max(wideX, fit.points[i * 3])
      loX = Math.min(loX, fit.points[i * 3])
      wideY = Math.max(wideY, fit.points[i * 3 + 1])
      loY = Math.min(loY, fit.points[i * 3 + 1])
    }
    expect(Math.max(wideX - loX, wideY - loY)).toBeGreaterThan(300)
  })

  it('does not explode on an empty cloud', () => {
    const fit = fitToWorld(new Float64Array(0))
    expect(fit.points.length).toBe(0)
    expect(fit.scale).toBe(1)
  })
})

// ------------------------------------------------------------- decimation ---

describe('decimation', () => {
  for (const method of ['random', 'stride', 'voxel'] as const) {
    it(`${method} hits the target`, async () => {
      const data = await loadPointCloud('utm.las', bytes('utm.las'), { maxPoints: 500, method })
      expect(pointCount(data)).toBeLessThanOrEqual(500)
      expect(pointCount(data)).toBeGreaterThanOrEqual(350) // voxel lands near, not on
      expect(data.totalPoints).toBe(5000)
    })
  }

  it('is reproducible for a given seed, and different for another', async () => {
    const load = (seed: number) =>
      loadPointCloud('utm.las', bytes('utm.las'), { maxPoints: 500, seed })
    const a = await load(7)
    const b = await load(7)
    const c = await load(8)
    expect([...a.points]).toEqual([...b.points])
    expect([...a.points]).not.toEqual([...c.points])
  })

  it('keeps every parallel array aligned', async () => {
    // Positions, colours, classification and intensity are gathered separately;
    // a mismatch would put one point's colour on another's position, which no
    // assertion downstream would catch.
    const full = await loadPointCloud('utm.las', bytes('utm.las'), { maxPoints: null })
    const part = await loadPointCloud('utm.las', bytes('utm.las'), {
      maxPoints: 400,
      method: 'stride',
    })
    const step = Math.ceil(5000 / 400)
    for (let i = 0; i < pointCount(part); i++) {
      const src = i * step
      expect(part.points[i * 3]).toBe(full.points[src * 3])
      expect(part.colors![i * 3]).toBe(full.colors![src * 3])
      expect(part.classification![i]).toBe(full.classification![src])
      expect(part.intensity![i]).toBe(full.intensity![src])
    }
  })

  it('drops nothing when the file is already small enough', async () => {
    const data = await loadPointCloud('utm.las', bytes('utm.las'), { maxPoints: 999_999 })
    expect(pointCount(data)).toBe(5000)
  })

  it('spreads more evenly than a random sample — the reason voxel is offered', async () => {
    // uneven.las is a dense patch beside a sparse one, the flight-line overlap
    // case. A scan like that should not import as mostly that patch.
    const denseFraction = async (method: 'voxel' | 'random'): Promise<number> => {
      const data = await loadPointCloud('uneven.las', bytes('uneven.las'), {
        maxPoints: 1000,
        method,
      })
      let inside = 0
      for (let i = 0; i < pointCount(data); i++) if (data.points[i * 3] < 10) inside++
      return inside / pointCount(data)
    }
    expect(await denseFraction('voxel')).toBeLessThan(await denseFraction('random'))
  })

  it('returns file order, so a decimated cloud is still the file it came from', () => {
    const index = decimationIndex(1000, 50, 'random', 3, null)
    for (let i = 1; i < index.length; i++) expect(index[i]).toBeGreaterThan(index[i - 1])
  })
})

// -------------------------------------------------------------- colouring ---

describe('colouring', () => {
  const load = (name: string): Promise<PointCloudData> =>
    loadPointCloud(name, bytes(name), { maxPoints: null })

  it('auto prefers the file RGB', async () => {
    expect(resolveColors(await load('utm.las'), 'auto').mode).toBe('rgb')
  })

  it('auto falls back to classification when there is no RGB', async () => {
    const data = await load('withheld.las')
    const { colors, mode } = resolveColors(data, 'auto')
    expect(mode).toBe('classification')
    const ground = data.classification!.indexOf(2)
    const building = data.classification!.indexOf(6)
    expect(colors.slice(ground * 3, ground * 3 + 3)).not.toEqual(
      colors.slice(building * 3, building * 3 + 3),
    )
  })

  it('auto falls back to elevation for a file that only HAS the column', async () => {
    // Nearly every LAS file carries a classification column; most public ones
    // leave it all 0 or all 1. Colouring by class there gives one flat grey
    // cloud, which looks like a bug.
    const data = await load('unclassified.las')
    expect(isReallyClassified(data)).toBe(false)
    expect(resolveColors(data, 'auto').mode).toBe('elevation')
  })

  it('falls back rather than failing when a mode the file cannot serve is asked for', async () => {
    const data = await load('unclassified.las')
    const { colors, mode } = resolveColors(data, 'rgb')
    expect(mode).not.toBe('rgb')
    expect(colors.length).toBe(pointCount(data) * 3)
  })

  it('detects 8-bit values sitting in the 16-bit colour fields', async () => {
    // Scaling a genuinely 8-bit file by >>8 turns the cloud black — the failure
    // the heuristic exists to prevent.
    const data = await load('eight_bit.las')
    let max = 0
    for (const v of data.colors!) max = Math.max(max, v)
    expect(max).toBeGreaterThan(150)
  })
})

// ---------------------------------------------------------- node building ---

describe('building nodes', () => {
  it('makes a cloud parent and one node per point', async () => {
    const { nodes, report } = await importPointCloudNodes('utm.las', bytes('utm.las'), {
      maxPoints: 300,
    })
    const [parent, ...points] = nodes
    expect(parent.topo).toBe(Topo.PointCloud)
    expect(points.length).toBe(300)
    expect(report.points).toBe(300)
    expect(points.every((p) => p.parentId === parent.id)).toBe(true)
    expect(points.every((p) => p.branchLevel === 1)).toBe(true)
    expect(points.every((p) => p.geometry === Geometry.Point)).toBe(true)
  })

  it('hands out unique contiguous ids from startId', async () => {
    const { nodes } = await importPointCloudNodes('utm.las', bytes('utm.las'), {
      maxPoints: 300,
      method: 'stride',
      startId: 50,
    })
    expect(nodes.map((n) => n.id)).toEqual(
      Array.from({ length: nodes.length }, (_, i) => 50 + i),
    )
  })

  it('stores the point size on the parent ratio, where the renderer reads it', async () => {
    const { nodes } = await importPointCloudNodes('utm.las', bytes('utm.las'), {
      maxPoints: 50,
      method: 'stride',
      pointSize: 6,
    })
    expect(pointSize(nodes[0])).toBeCloseTo(6, 12)
  })

  it('labels the parent and nothing else', async () => {
    // GlyphViz's usual rule is that every node carries a label; a cloud is where
    // that inverts — 100k labels is megabytes nobody reads — so the provenance
    // lives on the parent instead.
    const { nodes } = await importPointCloudNodes('utm.las', bytes('utm.las'), {
      maxPoints: 50,
      method: 'stride',
    })
    expect(nodes[0].text).not.toBe('')
    expect(nodes.slice(1).every((n) => n.text === '')).toBe(true)
  })

  it('records every choice that changed what was imported', async () => {
    // A saved scene has no other memory of the import settings.
    const { nodes } = await importPointCloudNodes('utm.las', bytes('utm.las'), {
      maxPoints: 300,
      colorMode: 'classification',
      exaggeration: 2.5,
      keepClasses: [5, 6],
    })
    const label = nodes[0].text
    expect(label).toContain('300')
    expect(label).toContain('classification')
    expect(label).toContain('2.5x')
    expect(label).toContain('5,000')
  })

  it('lands the points in world units, not in source coordinates', async () => {
    const { nodes } = await importPointCloudNodes('utm.las', bytes('utm.las'), {
      maxPoints: 500,
      method: 'stride',
      span: 360,
    })
    for (const node of nodes.slice(1)) {
      expect(Math.abs(node.translate.x)).toBeLessThan(200)
      expect(Math.abs(node.translate.y)).toBeLessThan(200)
    }
  })

  it('spends the point budget on the classes asked for', async () => {
    // The bug this pins: filtering AFTER sampling spends the budget on points
    // that are then discarded. utm.las is 65% ground; asking for 1000
    // non-ground points must give 1000, not ~350.
    const { report } = await importPointCloudNodes('utm.las', bytes('utm.las'), {
      maxPoints: 1000,
      keepClasses: [5, 6, 9],
    })
    expect(report.points).toBe(1000)
    expect([...report.classes.keys()].every((c) => [5, 6, 9].includes(c))).toBe(true)
    expect(report.totalPoints).toBe(5000)
    expect(report.availablePoints).toBeGreaterThan(report.points)
    expect(report.availablePoints).toBeLessThan(report.totalPoints)
  })

  it('leaves available equal to total when nothing was filtered', async () => {
    const { report } = await importPointCloudNodes('utm.las', bytes('utm.las'), {
      maxPoints: 1000,
      method: 'stride',
    })
    expect(report.availablePoints).toBe(5000)
    expect(report.totalPoints).toBe(5000)
  })

  it('builds an empty parent rather than failing on an empty selection', () => {
    const empty: PointCloudData = {
      name: 'nothing',
      points: new Float64Array(0),
      colors: null,
      classification: new Uint8Array(0),
      intensity: null,
      sourcePath: 'nothing.las',
      totalPoints: 0,
      availablePoints: 0,
      crs: '',
    }
    const { nodes, report } = buildPointCloudNodes(empty)
    expect(nodes.length).toBe(1)
    expect(report.points).toBe(0)
  })
})
