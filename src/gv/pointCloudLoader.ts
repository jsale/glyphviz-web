// Importing an external point-cloud file — LIDAR and friends — into a GlyphViz
// Point Cloud scene (Topo.PointCloud, see ./pointCloud.ts).
//
// Behaviour ported from the desktop's `glyphviz_core/point_cloud_loader.py`,
// which is Qt-free and GL-free there for the same reason this is DOM-free and
// THREE-free here: the rules that decide what an import looks like are data
// rules, and they must be testable in plain node. The BYTES come from
// ../io/lasFile.ts and ../io/plyFile.ts; the browser file intake is main.ts's.
//
// WHAT AN IMPORT HAS TO GET RIGHT — none of it the file parsing:
//
// 1. COORDINATES. A georeferenced scan arrives in CRS units with enormous
//    offsets: the desktop's own aerial_survey example runs 704,194..705,152
//    easting. Dropped into a scene as-is it is a speck 800,000 units from the
//    origin. `fitToWorld` recentres it and scales it to a sane span.
//
// 2. COLOUR. Most public LIDAR has no RGB at all. Classification codes and
//    elevation are what make such a file readable, so both are first-class
//    colour modes rather than fallbacks.
//
// 3. COUNT. GlyphViz gives every point a real node — clickable, taggable,
//    animatable. That is the feature, and it is also the ceiling, and mostly a
//    DISK one: the point cloud renders a million points in well under a
//    millisecond a frame (roadmap 6kk measured 57,600 at 93.6 fps and 1.1 ms of
//    CPU), while the SAVED scene grows about 90 bytes a point. So a ten-million
//    point tile must be decimated, and the decimation has to be honest about it.

import { blankNode } from './createNode'
import type { NewObjectDefaults } from './createNode'
import { PythonRandom } from './pythonRandom'
import { hsvToRgb } from './pythonRandom'
import { formatG } from './pythonRound'
import { Geometry, NodeType, RotationMode, Topo } from './types'
import type { GvNode } from './types'
import { POINT_SIZE_SCALE } from './pointCloud'
import {
  LAS_EXTENSIONS,
  lasAllClassifications,
  lasClassification,
  lasIntensity,
  lasRgb,
  lasXyz,
  openLasFile,
} from '../io/lasFile'
import type { LasFile } from '../io/lasFile'
import { parsePlyFile } from '../io/plyFile'

/** Whitespace/comma ASCII, the third family the desktop reads. */
export const ASCII_EXTENSIONS = ['.xyz', '.pts', '.txt'] as const

/**
 * Every extension the IMPORTER offers. `.ply` is here and is deliberately NOT
 * in main.ts's drop routing: a dropped PLY has gone to the mesh importer since
 * mesh import shipped and is far more often a model than a scan, so it stays a
 * mesh on drop and reaches this only through an explicit Import Point Cloud —
 * the desktop's `drop_router.POINT_CLOUD_EXTS` reasoning exactly. `.txt` is
 * absent from that routing for a sharper reason, and `.csv` is not even in this
 * list: a dropped CSV is a SCENE, and node CSVs are identified by their COLUMNS
 * rather than their name, so claiming the extension would break scene opening.
 * `loadPointCloud` still reads a `.csv` handed to it explicitly, exactly as the
 * desktop's own `load_point_cloud` does while its SUPPORTED_EXTENSIONS omits it.
 */
export const SUPPORTED_EXTENSIONS = [...LAS_EXTENSIONS, '.ply', ...ASCII_EXTENSIONS] as const

/**
 * How many points a scene carries comfortably. Not a renderer limit — see the
 * header — but a node and disk one.
 */
export const DEFAULT_MAX_POINTS = 100_000

/**
 * Default world-space span for the LARGER horizontal axis of an imported scan.
 * 360 is GlyphViz's own 1:1 reference frame — the width of a default World Grid,
 * and a full sweep of longitude — so an imported scan lands at the same scale as
 * everything else in the app and can be dropped onto a grid without retuning.
 */
export const DEFAULT_WORLD_SPAN = 360.0

/**
 * Centre and scale are measured from this percentile box rather than the raw
 * min/max. Airborne LIDAR reliably contains a handful of gross outliers (birds,
 * cloud returns, multipath), and one point a kilometre up would otherwise shrink
 * the entire scan toward invisibility. At these percentiles the box IS the
 * bounding box for clean data, so nothing is distorted when there is nothing to
 * reject.
 */
export const FIT_PERCENTILES: readonly [number, number] = [0.1, 99.9]

/**
 * ASPRS standard classification codes (LAS 1.4, table 17) and the colours
 * GlyphViz gives them. Ground brown, vegetation greens by height, buildings red,
 * water blue — the convention every LIDAR tool draws, so a classified scan reads
 * immediately. Codes outside this table (LAS 1.4 allows 0–255 and reserves 64+
 * for user definition) are coloured by hashing the code into a spread of hues,
 * so distinct user classes stay visually distinct without pretending to know
 * their names.
 */
export const ASPRS_CLASSES: ReadonlyMap<number, readonly [string, [number, number, number]]> =
  new Map<number, [string, [number, number, number]]>([
    [0, ['Created, never classified', [150, 150, 150]]],
    [1, ['Unclassified', [170, 170, 175]]],
    [2, ['Ground', [166, 124, 82]]],
    [3, ['Low Vegetation', [120, 170, 90]]],
    [4, ['Medium Vegetation', [70, 150, 70]]],
    [5, ['High Vegetation', [34, 110, 50]]],
    [6, ['Building', [200, 80, 70]]],
    [7, ['Low Point (noise)', [110, 60, 120]]],
    [8, ['Reserved', [140, 140, 140]]],
    [9, ['Water', [60, 130, 210]]],
    [10, ['Rail', [180, 140, 60]]],
    [11, ['Road Surface', [110, 110, 120]]],
    [12, ['Reserved', [140, 140, 140]]],
    [13, ['Wire - Guard', [230, 200, 90]]],
    [14, ['Wire - Conductor', [240, 220, 120]]],
    [15, ['Transmission Tower', [220, 160, 60]]],
    [16, ['Wire-structure Connector', [230, 190, 110]]],
    [17, ['Bridge Deck', [190, 120, 160]]],
    [18, ['High Noise', [140, 70, 140]]],
  ])

/**
 * How many class names the cloud parent's provenance label spells out before it
 * summarizes. Four fits a readable label; a real classified tile routinely
 * carries a dozen or more.
 */
const LABEL_CLASS_LIMIT = 4

export const COLOR_MODES = ['auto', 'rgb', 'classification', 'elevation', 'intensity'] as const
export type ColorMode = (typeof COLOR_MODES)[number]

export const DECIMATE_METHODS = ['random', 'stride', 'voxel'] as const
export type DecimateMethod = (typeof DECIMATE_METHODS)[number]

export class PointCloudImportError extends Error {}

/**
 * One imported cloud, still in its SOURCE coordinate system.
 *
 * Keeping source coordinates until `fitToWorld` runs is deliberate: the caller
 * needs the real extents to show the user what they are about to import
 * ("958 × 1127 × 166 units"), and a scale chosen before the user has seen that
 * number is a guess.
 */
export interface PointCloudData {
  name: string
  /** N×3, source units. */
  points: Float64Array
  /** N×3 bytes, when the file carried colour. */
  colors: Uint8Array | null
  classification: Uint8Array | null
  intensity: Uint16Array | null
  sourcePath: string
  /** How many points were in the FILE. */
  totalPoints: number
  /**
   * How many survived the classification filter, before decimation. Equal to
   * `totalPoints` when no filter was applied. Kept separate so an import can
   * report "50,000 of 3.7M matching points (10.6M in the file)" — collapsing the
   * two would make a filtered import look like it lost data.
   */
  availablePoints: number
  /** Only when it could be read cheaply. */
  crs: string
}

export function pointCount(data: PointCloudData): number {
  return data.points.length / 3
}

/** Per-axis (min, max) of the points, in source units. */
export function extentsOf(data: PointCloudData): {
  lo: [number, number, number]
  hi: [number, number, number]
} {
  const n = pointCount(data)
  const lo: [number, number, number] = [Infinity, Infinity, Infinity]
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < 3; a++) {
      const v = data.points[i * 3 + a]
      if (v < lo[a]) lo[a] = v
      if (v > hi[a]) hi[a] = v
    }
  }
  if (n === 0) return { lo: [0, 0, 0], hi: [0, 0, 0] }
  return { lo, hi }
}

export function spanOf(data: PointCloudData): [number, number, number] {
  const { lo, hi } = extentsOf(data)
  return [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]]
}

/** Classification code → how many points carry it, ascending by code. */
export function classCounts(data: PointCloudData): Map<number, number> {
  const out = new Map<number, number>()
  if (!data.classification) return out
  for (const code of data.classification) out.set(code, (out.get(code) ?? 0) + 1)
  return new Map([...out.entries()].sort((a, b) => a[0] - b[0]))
}

// ------------------------------------------------------------------ readers ---

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot).toLowerCase()
}

function stemOf(name: string): string {
  const base = name.slice(name.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot === -1 ? base : base.slice(0, dot)
}

export function isPointCloudFileName(name: string): boolean {
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(extensionOf(name))
}

export interface LoadOptions {
  /** `null` loads everything, which is what a converting script wants and never what the GUI does. */
  maxPoints?: number | null
  method?: DecimateMethod
  seed?: number
  /** ASPRS codes to keep. Applied BEFORE the decimation — see `readLas`. */
  keepClasses?: readonly number[] | null
  /** Test hook: where the LAZ codec finds its wasm. Nothing in the app passes it. */
  wasmSource?: BufferSource | URL | string
}

/**
 * Read any supported point-cloud file, decimated to `maxPoints`.
 *
 * `keepClasses` restricts the import to those ASPRS classification codes and is
 * applied before the decimation, so the point budget is spent on the classes
 * asked for. Only LAS/LAZ carry classification; it is ignored for the other
 * formats.
 */
export async function loadPointCloud(
  name: string,
  bytes: Uint8Array,
  options: LoadOptions = {},
): Promise<PointCloudData> {
  const ext = extensionOf(name)
  const maxPoints = options.maxPoints === undefined ? DEFAULT_MAX_POINTS : options.maxPoints
  const method = options.method ?? 'random'
  const seed = options.seed ?? 0
  if ((LAS_EXTENSIONS as readonly string[]).includes(ext)) {
    return readLas(name, bytes, maxPoints, method, seed, options.keepClasses ?? null, options.wasmSource)
  }
  if (ext === '.ply') return readPly(name, bytes, maxPoints, method, seed)
  if ((ASCII_EXTENSIONS as readonly string[]).includes(ext) || ext === '.csv') {
    return readAscii(name, bytes, maxPoints, method, seed)
  }
  throw new PointCloudImportError(
    `Unsupported point-cloud format '${ext}'. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`,
  )
}

/**
 * LAS/LAZ.
 *
 * The classification filter is applied BEFORE the decimation, and that ordering
 * is the whole reason it lives down here rather than in `buildPointCloudNodes`.
 * Ask for 100k points and then drop ground — which is most of an aerial tile —
 * and filtering second would quietly hand back 35k. The user asked for 100k
 * points OF THE CLASSES THEY CHOSE, so the sample is drawn from the filtered set.
 */
async function readLas(
  name: string,
  bytes: Uint8Array,
  maxPoints: number | null,
  method: DecimateMethod,
  seed: number,
  keepClasses: readonly number[] | null,
  wasmSource?: BufferSource | URL | string,
): Promise<PointCloudData> {
  const file = await openLasFile(bytes, wasmSource)
  return pointsFromLasFile(file, name, maxPoints, method, seed, keepClasses)
}

/**
 * The half of `readLas` that works on an already-opened file.
 *
 * Split out because a LAZ is decompressed ONCE per import window and then
 * sampled repeatedly — the class list, then the import, then the import again
 * with different settings. The desktop re-reads the file each time; a browser is
 * holding the decompressed records anyway, so re-reading them would be a
 * multi-second cost for nothing.
 */
export function pointsFromLasFile(
  file: LasFile,
  name: string,
  maxPoints: number | null,
  method: DecimateMethod,
  seed: number,
  keepClasses: readonly number[] | null,
): PointCloudData {
  const total = file.header.pointCount
  const allClasses = lasAllClassifications(file)

  let subset: Int32Array | null = null
  if (keepClasses !== null) {
    const wanted = new Set(keepClasses.map((c) => Math.trunc(c)))
    const picked: number[] = []
    for (let i = 0; i < total; i++) if (wanted.has(allClasses[i])) picked.push(i)
    subset = Int32Array.from(picked)
  }
  const available = subset === null ? total : subset.length

  // Voxel sampling needs the coordinates to bucket, so gather them up front for
  // that method only. The other two need nothing but a count, and do not pay it.
  let coords: Float64Array | null = null
  if (method === 'voxel') {
    coords = lasXyz(file, subset ?? identityIndex(total))
  }

  const picked = decimationIndex(available, maxPoints, method, seed, coords)
  const keep = subset === null ? picked : gather(subset, picked)

  const rgb = lasRgb(file, keep)
  let colors: Uint8Array | null = null
  if (rgb) {
    let max = 0
    for (const v of rgb) if (v > max) max = v
    if (max > 0) {
      // LAS stores colour as 16-bit, but plenty of writers put 8-bit values
      // straight into those fields. Scaling a genuinely 8-bit file by >>8 turns
      // it black, and NOT scaling a 16-bit one turns it white — so decide from
      // the data, which is the standard heuristic every LAS reader uses.
      const shift = max > 255
      colors = new Uint8Array(rgb.length)
      for (let i = 0; i < rgb.length; i++) colors[i] = shift ? rgb[i] >> 8 : rgb[i]
    }
  }

  return {
    name: stemOf(name),
    points: lasXyz(file, keep),
    colors,
    classification: lasClassification(file, keep),
    intensity: lasIntensity(file, keep),
    sourcePath: name,
    totalPoints: total,
    availablePoints: available,
    crs: file.header.crs,
  }
}

function readPly(
  name: string,
  bytes: Uint8Array,
  maxPoints: number | null,
  method: DecimateMethod,
  seed: number,
): PointCloudData {
  // A mesh's vertices are a perfectly good cloud, which is why the same parser
  // serves both importers and why a face table is simply ignored here.
  const ply = parsePlyFile(bytes)
  const total = ply.vertexCount
  const keep = decimationIndex(total, maxPoints, method, seed, ply.positions)
  return {
    name: stemOf(name),
    points: gatherVec3(ply.positions, keep),
    colors: ply.colors ? gatherRgb(ply.colors, keep) : null,
    classification: null,
    intensity: null,
    sourcePath: name,
    totalPoints: total,
    availablePoints: total,
    crs: '',
  }
}

/**
 * Whitespace- or comma-separated `x y z [r g b]`.
 *
 * Deliberately forgiving: scanners and photogrammetry tools emit this format
 * with every combination of delimiter, header line and trailing column. Any line
 * that does not parse as numbers is treated as a header or a comment and skipped.
 *
 * The column COUNT is taken from the first usable row and rows that disagree are
 * dropped, which is what `np.genfromtxt` does on the desktop — its result is a
 * rectangular array, so "does this file carry colour" is a property of the file
 * rather than of a row.
 */
function readAscii(
  name: string,
  bytes: Uint8Array,
  maxPoints: number | null,
  method: DecimateMethod,
  seed: number,
): PointCloudData {
  const text = new TextDecoder().decode(bytes)
  const rows: number[][] = []
  let width = 0
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const parts = line.split(line.includes(',') ? /\s*,\s*/ : /\s+/)
    const values = parts.map(Number)
    if (values.length < 3 || !values.slice(0, 3).every((v) => Number.isFinite(v))) continue
    if (width === 0) width = values.length
    if (values.length !== width) continue
    rows.push(values)
  }
  if (rows.length === 0) {
    throw new PointCloudImportError(`No x y z columns found in '${name}'.`)
  }

  const total = rows.length
  const positions = new Float64Array(total * 3)
  for (let i = 0; i < total; i++) {
    positions[i * 3] = rows[i][0]
    positions[i * 3 + 1] = rows[i][1]
    positions[i * 3 + 2] = rows[i][2]
  }

  let colors: Uint8Array | null = null
  if (width >= 6) {
    let lo = Infinity
    let hi = -Infinity
    for (const row of rows) {
      for (let a = 3; a < 6; a++) {
        if (row[a] < lo) lo = row[a]
        if (row[a] > hi) hi = row[a]
      }
    }
    // 0..1 floats or 0..255 bytes; anything else is not a colour and is left
    // alone rather than guessed at.
    const unit = hi <= 1 + 1e-9 && lo >= 0
    if (unit || (hi <= 255 && lo >= 0)) {
      colors = new Uint8Array(total * 3)
      for (let i = 0; i < total; i++) {
        for (let a = 0; a < 3; a++) {
          // numpy's `.astype(np.uint8)` truncates toward zero; it is not a round.
          colors[i * 3 + a] = Math.trunc(unit ? rows[i][3 + a] * 255 : rows[i][3 + a])
        }
      }
    }
  }

  const keep = decimationIndex(total, maxPoints, method, seed, positions)
  return {
    name: stemOf(name),
    points: gatherVec3(positions, keep),
    colors: colors ? gatherRgb(colors, keep) : null,
    classification: null,
    intensity: null,
    sourcePath: name,
    totalPoints: total,
    availablePoints: total,
    crs: '',
  }
}

// --------------------------------------------------------------- decimation ---

function identityIndex(n: number): Int32Array {
  const out = new Int32Array(n)
  for (let i = 0; i < n; i++) out[i] = i
  return out
}

function gather(source: Int32Array, picked: Int32Array): Int32Array {
  const out = new Int32Array(picked.length)
  for (let i = 0; i < picked.length; i++) out[i] = source[picked[i]]
  return out
}

function gatherVec3(source: Float64Array, keep: Int32Array): Float64Array {
  const out = new Float64Array(keep.length * 3)
  for (let i = 0; i < keep.length; i++) {
    out[i * 3] = source[keep[i] * 3]
    out[i * 3 + 1] = source[keep[i] * 3 + 1]
    out[i * 3 + 2] = source[keep[i] * 3 + 2]
  }
  return out
}

function gatherRgb(source: Uint8Array, keep: Int32Array): Uint8Array {
  const out = new Uint8Array(keep.length * 3)
  for (let i = 0; i < keep.length; i++) {
    out[i * 3] = source[keep[i] * 3]
    out[i * 3 + 1] = source[keep[i] * 3 + 1]
    out[i * 3 + 2] = source[keep[i] * 3 + 2]
  }
  return out
}

/**
 * Row indices to keep. Always sorted ascending, so the kept points stay in file
 * order and a re-import with the same settings reproduces the scene.
 *
 * DIVERGENCE, and the only one in this module: the RANDOM method draws from
 * CPython's Mersenne Twister (../gv/pythonRandom.ts, already here for the
 * Hyperglyph Generator) where the desktop draws from numpy's PCG64. Same file
 * and same settings give the same cloud in this app and a statistically
 * identical but different one in the other. That is a smaller promise than the
 * hyperglyph seed's, and deliberately so: a seed NAMES a hyperglyph, is shown in
 * the dialog and gets written down, whereas the desktop's import dialog exposes
 * no seed at all — it passes the default 0 — so "the same seed picks the same
 * points in both apps" is a promise nobody has made or could act on. Stride and
 * voxel are exactly the desktop's, and everything downstream of the sample —
 * the fit, the colouring, the node fields — is exact for all three.
 */
export function decimationIndex(
  total: number,
  maxPoints: number | null,
  method: DecimateMethod,
  seed: number,
  coords: Float64Array | null,
): Int32Array {
  if (maxPoints === null || total <= maxPoints) return identityIndex(total)

  if (method === 'stride') {
    // Cheapest, and the one to be careful with: a file written in acquisition
    // order has its rows grouped by flight line, so a stride can beat against
    // the scan pattern and sample stripes rather than the scene. Offered because
    // it is exactly reproducible and needs no RNG; not the default for that.
    const step = Math.ceil(total / maxPoints)
    const out: number[] = []
    for (let i = 0; i < total && out.length < maxPoints; i += step) out.push(i)
    return Int32Array.from(out)
  }

  if (method === 'voxel' && coords !== null) return voxelIndex(coords, maxPoints)
  // 'voxel' with no coordinates is defensive only: every reader hands them in.
  return randomIndex(total, maxPoints, seed)
}

/**
 * `maxPoints` distinct indices out of `total`, sorted ascending.
 *
 * Floyd's algorithm rather than a shuffle: it draws exactly `maxPoints` times
 * and holds only the chosen set, so sampling 100k out of ten million costs 100k
 * draws and a 100k-entry set rather than a forty-megabyte permutation.
 */
function randomIndex(total: number, maxPoints: number, seed: number): Int32Array {
  const rng = new PythonRandom(seed)
  const chosen = new Set<number>()
  for (let j = total - maxPoints; j < total; j++) {
    const candidate = rng.randbelow(j + 1)
    chosen.add(chosen.has(candidate) ? j : candidate)
  }
  return Int32Array.from([...chosen].sort((a, b) => a - b))
}

/**
 * One int64-style cell id per point, or null when `size` would need more cells
 * than an exact integer key can hold.
 *
 * Flattening (i, j, k) into a single number is what keeps this affordable: a
 * one-dimensional key is a plain sort or a plain hash, where bucketing on the
 * triple is several times slower.
 *
 * The guard is 2^53 — JavaScript's exact-integer ceiling — where the desktop's
 * is 2^62, its keys being int64. The difference is invisible: at cell counts
 * that large every point is alone in its own voxel, so the desktop's branch
 * would compute a key, count far more cells than the budget, and go coarser by
 * exactly the same step this null makes it take.
 */
function voxelKeys(
  coords: Float64Array,
  lo: [number, number, number],
  span: [number, number, number],
  size: number,
): Float64Array | null {
  const step = Math.max(size, 1e-12)
  const cells = span.map((s) => Math.max(1, Math.ceil(s / step) + 1)) as [number, number, number]
  if (cells[0] * cells[1] * cells[2] > 2 ** 53) return null
  const n = coords.length / 3
  const keys = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const kx = Math.min(Math.max(Math.floor((coords[i * 3] - lo[0]) / step), 0), cells[0] - 1)
    const ky = Math.min(Math.max(Math.floor((coords[i * 3 + 1] - lo[1]) / step), 0), cells[1] - 1)
    const kz = Math.min(Math.max(Math.floor((coords[i * 3 + 2] - lo[2]) / step), 0), cells[2] - 1)
    keys[i] = (kx * cells[1] + ky) * cells[2] + kz
  }
  return keys
}

/**
 * Voxel-size search happens on at most this multiple of the target count.
 *
 * A uniform random pre-sample scales every local density by the SAME factor, so
 * the voxel step still equalizes density afterwards — but the search runs over a
 * fraction of the points, which is the difference between about a second and
 * most of a minute on a ten-million-point tile.
 */
const VOXEL_SEARCH_FACTOR = 12

/**
 * One point per occupied voxel, the voxel size solved for so the result lands
 * near `maxPoints`.
 *
 * Gives even VOLUMETRIC density: random and stride sampling both preserve the
 * scanner's own density bias, so a dense patch under the flight path stays dense
 * and a sparse edge stays sparse. "Volumetric" is the part worth knowing: the
 * grid is 3-D, so a tall column of trees or a building contributes many cells
 * and a patch of bare ground contributes one. Relative to a random sample this
 * moves points OFF flat ground and ONTO structure, which is usually what you
 * want to look at but is not the same as even ground coverage.
 *
 * The search is a geometric bisection on the cube size, keeping the best result
 * that does not overshoot. Occupancy is not uniform — that is the entire point
 * of the method — so the size cannot be solved for directly and the first guess
 * (cells spread over the bounding volume) is usually several factors out.
 */
function voxelIndex(coords: Float64Array, maxPoints: number): Int32Array {
  const n = coords.length / 3
  if (n <= maxPoints) return identityIndex(n)

  // Pre-sample for the search. Indices are carried through so the result still
  // points into the caller's array. Note that this branch inherits the random
  // divergence documented on `decimationIndex`: a file more than
  // VOXEL_SEARCH_FACTOR × the target does not voxel-sample bit-identically to
  // the desktop, while a smaller one does.
  const budget = maxPoints * VOXEL_SEARCH_FACTOR
  let base: Int32Array | null = null
  let work = coords
  if (n > budget) {
    base = randomIndex(n, budget, 0)
    work = gatherVec3(coords, base)
  }

  const count = work.length / 3
  const lo: [number, number, number] = [Infinity, Infinity, Infinity]
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < count; i++) {
    for (let a = 0; a < 3; a++) {
      const v = work[i * 3 + a]
      if (v < lo[a]) lo[a] = v
      if (v > hi[a]) hi[a] = v
    }
  }
  const span = [
    Math.max(hi[0] - lo[0], 1e-9),
    Math.max(hi[1] - lo[1], 1e-9),
    Math.max(hi[2] - lo[2], 1e-9),
  ] as [number, number, number]

  let size = (span[0] * span[1] * span[2] / Math.max(1, maxPoints)) ** (1 / 3)
  if (!Number.isFinite(size) || size <= 0) size = Math.max(...span) / 64

  let small = size / 1024
  let large = size * 1024
  let best: Int32Array | null = null
  for (let step = 0; step < 24; step++) {
    const keys = voxelKeys(work, lo, span, size)
    if (keys === null) {
      small = size // too fine to key — go coarser
      size = Math.sqrt(size * large)
      continue
    }
    const first = new Map<number, number>()
    for (let i = 0; i < keys.length; i++) if (!first.has(keys[i])) first.set(keys[i], i)
    const occupied = first.size
    if (occupied <= maxPoints) {
      if (best === null || occupied > best.length) {
        best = Int32Array.from([...first.values()].sort((a, b) => a - b))
      }
      if (occupied >= maxPoints * 0.95) break
      large = size // too few — finer voxels
      size = Math.sqrt(small * size)
    } else {
      small = size // too many — coarser voxels
      size = Math.sqrt(size * large)
    }
  }

  if (best === null) {
    // The bisection never found a size that fit. Rather than return a cloud
    // larger than asked for, thin the finest attempt evenly.
    best = new Int32Array(maxPoints)
    for (let i = 0; i < maxPoints; i++) {
      best[i] = Math.trunc((i * (count - 1)) / (maxPoints - 1))
    }
  }
  return base === null ? best : gather(base, best)
}

// ------------------------------------------------------------ world fitting ---

/**
 * `numpy.percentile`'s default linear interpolation, over one axis of an N×3
 * array. `values` is mutated as scratch — it is a copy in every caller.
 */
function percentileOfAxis(values: Float64Array, q: number): number {
  const n = values.length
  if (n === 0) return 0
  values.sort()
  const at = (q / 100) * (n - 1)
  const lo = Math.floor(at)
  const hi = Math.ceil(at)
  if (lo === hi) return values[lo]
  return values[lo] + (values[hi] - values[lo]) * (at - lo)
}

function axisColumn(points: Float64Array, axis: number): Float64Array {
  const n = points.length / 3
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) out[i] = points[i * 3 + axis]
  return out
}

export interface WorldFit {
  /** N×3, recentred and scaled. */
  points: Float64Array
  scale: number
  center: [number, number, number]
}

/**
 * Recentre and uniformly scale a scan into GlyphViz world units.
 *
 * Returns the scale and centre alongside the points so the caller can report
 * and, if it wants, invert the transform — a scan whose real-world scale matters
 * should be able to say what one world unit is worth.
 *
 * The scale is UNIFORM across all three axes and derived from the larger
 * HORIZONTAL extent only. Deriving it from the 3-D extent instead would make a
 * tall narrow scan and a flat wide one of the same footprint import at different
 * sizes; deriving per-axis would silently stretch the terrain, which is the one
 * thing a LIDAR viewer must never do by default.
 *
 * `exaggeration` then multiplies Z alone. Vertical exaggeration is standard in
 * terrain work — 2–3× is how a 200 m relief over 4 km reads as relief at all —
 * but it IS a distortion, so it is an explicit argument with a truthful default.
 */
export function fitToWorld(
  points: Float64Array,
  span: number = DEFAULT_WORLD_SPAN,
  exaggeration = 1.0,
): WorldFit {
  if (points.length === 0) {
    return { points: new Float64Array(0), scale: 1.0, center: [0, 0, 0] }
  }
  const lo: number[] = []
  const hi: number[] = []
  for (let a = 0; a < 3; a++) {
    lo.push(percentileOfAxis(axisColumn(points, a), FIT_PERCENTILES[0]))
    hi.push(percentileOfAxis(axisColumn(points, a), FIT_PERCENTILES[1]))
  }
  const center: [number, number, number] = [
    (lo[0] + hi[0]) / 2,
    (lo[1] + hi[1]) / 2,
    (lo[2] + hi[2]) / 2,
  ]
  const horizontal = Math.max(hi[0] - lo[0], hi[1] - lo[1])
  const scale = horizontal > 1e-12 ? span / horizontal : 1.0

  const out = new Float64Array(points.length)
  const n = points.length / 3
  for (let i = 0; i < n; i++) {
    out[i * 3] = (points[i * 3] - center[0]) * scale
    out[i * 3 + 1] = (points[i * 3 + 1] - center[1]) * scale
    out[i * 3 + 2] = (points[i * 3 + 2] - center[2]) * scale
    if (exaggeration !== 1.0) out[i * 3 + 2] *= exaggeration
  }
  return { points: out, scale, center }
}

// --------------------------------------------------------------- colouring ---

type Rgb3 = readonly [number, number, number]

/**
 * Normalize `values` over their 2nd..98th percentile and map through a two- or
 * three-stop ramp.
 *
 * Percentiles rather than min/max because both elevation and intensity have long
 * thin tails in real LIDAR — a handful of noise returns at the top of the range
 * would compress every real value into the bottom of the ramp and the cloud
 * would come out one flat colour.
 */
function ramp(values: ArrayLike<number>, loRgb: Rgb3, hiRgb: Rgb3, midRgb?: Rgb3): Uint8Array {
  const n = values.length
  const scratch = new Float64Array(n)
  for (let i = 0; i < n; i++) scratch[i] = values[i]
  const lo = percentileOfAxis(scratch.slice(), 2.0)
  const hi = percentileOfAxis(scratch.slice(), 98.0)
  const out = new Uint8Array(n * 3)
  for (let i = 0; i < n; i++) {
    const t = hi > lo ? Math.min(Math.max((values[i] - lo) / (hi - lo), 0), 1) : 0
    for (let a = 0; a < 3; a++) {
      let v: number
      if (midRgb === undefined) {
        v = loRgb[a] + (hiRgb[a] - loRgb[a]) * t
      } else {
        const p = Math.min(Math.max(t * 2, 0), 1)
        const q = Math.min(Math.max(t * 2 - 1, 0), 1)
        v = loRgb[a] + (midRgb[a] - loRgb[a]) * p + (hiRgb[a] - midRgb[a]) * q
      }
      // numpy's `.astype(np.uint8)` after a clip truncates toward zero.
      out[i * 3 + a] = Math.trunc(Math.min(Math.max(v, 0), 255))
    }
  }
  return out
}

/**
 * Colour for one ASPRS classification code.
 *
 * Codes past the standard table (LAS 1.4 permits 0–255, reserving 64+ for user
 * definition) get a hue spread off the code itself: distinct classes stay
 * distinct without inventing names for them.
 */
export function classColor(code: number): [number, number, number] {
  const known = ASPRS_CLASSES.get(Math.trunc(code))
  if (known) return [...known[1]] as [number, number, number]
  const h = (Math.trunc(code) * 47) % 360
  const [r, g, b] = hsvToRgb(h / 360, 0.55, 0.85)
  return [Math.trunc(r * 255), Math.trunc(g * 255), Math.trunc(b * 255)]
}

export function className(code: number): string {
  return ASPRS_CLASSES.get(Math.trunc(code))?.[0] ?? `User class ${Math.trunc(code)}`
}

/**
 * True when classification carries information worth colouring by.
 *
 * A file where every point is 0 ("created, never classified") or 1
 * ("unclassified") is not classified — it just has the column, which nearly
 * every LAS file does. Colouring such a file by class would produce one uniform
 * grey cloud and look like a bug.
 */
export function isReallyClassified(data: PointCloudData): boolean {
  for (const code of classCounts(data).keys()) {
    if (code !== 0 && code !== 1) return true
  }
  return false
}

/**
 * N×3 byte colours for a cloud, plus the mode actually used.
 *
 * 'auto' is the important one, because it decides what a file that carries no
 * colour should look like: RGB when the file has it, else classification when
 * the file is genuinely classified, else an elevation ramp. Most public LIDAR
 * lands on one of the latter two.
 *
 * `fittedZ` lets the elevation ramp run over the post-fit heights; without it
 * the source z is used, which gives the same ramp (the fit is affine).
 */
export function resolveColors(
  data: PointCloudData,
  mode: ColorMode = 'auto',
  fittedZ?: ArrayLike<number>,
): { colors: Uint8Array; mode: ColorMode } {
  let chosen: ColorMode = mode
  if (mode === 'auto') {
    if (data.colors !== null) chosen = 'rgb'
    else if (data.classification !== null && isReallyClassified(data)) chosen = 'classification'
    else chosen = 'elevation'
  }

  if (chosen === 'rgb') {
    if (data.colors === null) return resolveColors(data, 'auto', fittedZ)
    return { colors: data.colors, mode: 'rgb' }
  }

  if (chosen === 'classification') {
    if (data.classification === null) return resolveColors(data, 'elevation', fittedZ)
    const n = pointCount(data)
    const out = new Uint8Array(n * 3)
    const cache = new Map<number, [number, number, number]>()
    for (let i = 0; i < n; i++) {
      const code = data.classification[i]
      let rgb = cache.get(code)
      if (!rgb) {
        rgb = classColor(code)
        cache.set(code, rgb)
      }
      out[i * 3] = rgb[0]
      out[i * 3 + 1] = rgb[1]
      out[i * 3 + 2] = rgb[2]
    }
    return { colors: out, mode: 'classification' }
  }

  if (chosen === 'intensity') {
    if (data.intensity === null) return resolveColors(data, 'elevation', fittedZ)
    return { colors: ramp(data.intensity, [20, 20, 30], [255, 255, 240]), mode: 'intensity' }
  }

  const z = fittedZ ?? axisColumn(data.points, 2)
  // blue → green → warm white: the terrain ramp, low to high
  return {
    colors: ramp(z, [40, 70, 160], [245, 240, 220], [90, 170, 110]),
    mode: 'elevation',
  }
}

// ------------------------------------------------------------ node building ---

/** Desktop `Node(...)` defaults for the cloud parent: a warm amber sphere. */
const CLOUD_PARENT_DEFAULTS: NewObjectDefaults = {
  geometry: Geometry.SphereSolid,
  topo: Topo.PointCloud,
  scale: { x: 1, y: 1, z: 1 },
  color: { r: 255, g: 220, b: 120, a: 255 },
}

/** …and for one point: a small Point glyph at plain Cartesian placement. */
const CLOUD_POINT_DEFAULTS: NewObjectDefaults = {
  geometry: Geometry.Point,
  topo: Topo.None,
  scale: { x: 0.1, y: 0.1, z: 0.1 },
  color: { r: 255, g: 255, b: 255, a: 255 },
}

export interface BuildNodesOptions {
  colorMode?: ColorMode
  span?: number
  exaggeration?: number
  /** In PIXELS. Stored on the PARENT as `ratio = size / POINT_SIZE_SCALE`. */
  pointSize?: number
  keepClasses?: readonly number[] | null
  startId?: number
  parentTranslate?: readonly [number, number, number]
  labelPoints?: boolean
}

export interface ImportReport {
  name: string
  source: string
  points: number
  totalPoints: number
  availablePoints: number
  colorMode: ColorMode
  worldScale: number
  sourceCenter: [number, number, number]
  sourceSpan: [number, number, number]
  worldSpan: [number, number, number]
  exaggeration: number
  keptClasses: number[] | null
  crs: string
  /** code → (name, count) for the classes that survived. */
  classes: Map<number, [string, number]>
  /** Which method actually thinned the cloud, or 'none'. */
  decimation: DecimateMethod | 'none'
}

/** Python's `f"{n:,}"` — grouped in threes, locale-independently. */
function grouped(n: number): string {
  return n.toLocaleString('en-US')
}

/**
 * Turn an imported cloud into a Topo.PointCloud parent plus one node per point,
 * and report what was done.
 *
 * Ids run `startId` (the parent) then `startId + 1`.. for the points, so the
 * result drops straight into an empty scene or appends to a loaded one.
 *
 * Points get no text. GlyphViz's usual rule is that every node should carry a
 * label explaining its encoding, and a point cloud is the one place that rule
 * inverts: 100k labels is megabytes of text nobody will ever read, and the
 * renderer declines to draw them anyway (roadmap 6kk — a cloud point labels only
 * when pinned or selected). The PARENT carries the label instead, and it says
 * what the cloud is and how it was made.
 */
export function buildPointCloudNodes(
  data: PointCloudData,
  options: BuildNodesOptions = {},
): { nodes: GvNode[]; report: ImportReport } {
  const colorMode = options.colorMode ?? 'auto'
  const span = options.span ?? DEFAULT_WORLD_SPAN
  const exaggeration = options.exaggeration ?? 1.0
  const pointSize = options.pointSize ?? 2.0
  const keepClasses = options.keepClasses ?? null
  const startId = options.startId ?? 1
  const parentTranslate = options.parentTranslate ?? [0, 0, 0]

  let working = data
  if (keepClasses !== null && data.classification !== null) {
    const wanted = new Set(keepClasses.map((c) => Math.trunc(c)))
    const mask: number[] = []
    for (let i = 0; i < pointCount(data); i++) {
      if (wanted.has(data.classification[i])) mask.push(i)
    }
    working = subsetOf(data, Int32Array.from(mask))
  }

  const n = pointCount(working)
  const fit = fitToWorld(working.points, span, exaggeration)
  const fittedZ = axisColumn(fit.points, 2)
  const { colors, mode: usedMode } = resolveColors(working, colorMode, fittedZ)

  const sourceSpan = n > 0 ? spanOf(working) : ([0, 0, 0] as [number, number, number])
  const counts = classCounts(working)

  // The parent's label is the cloud's provenance, and it is the ONLY place that
  // record survives: the points carry no text, and a saved scene has no other
  // memory of how it was made. So it names every choice that changed what got
  // imported — the count, the colouring, the class filter and the exaggeration
  // — not just the count.
  const bits = [`${grouped(n)} points`, `coloured by ${usedMode}`]
  if (working.totalPoints > n) bits.push(`sampled from ${grouped(working.totalPoints)} in the file`)
  if (keepClasses !== null && keepClasses.length > 0) {
    // Name the classes that actually SURVIVED, biggest first, capped — a tick
    // list can easily hold fifteen entries and spelling them all out buries the
    // rest of the label. The classes with points in them are the ones that
    // describe the cloud; a ticked class the filter found nothing for does not.
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1])
    const names = ranked.slice(0, LABEL_CLASS_LIMIT).map(([code]) => className(code))
    const more = ranked.length - names.length
    bits.push('classes: ' + names.join(', ') + (more > 0 ? ` +${more} more` : ''))
  }
  if (exaggeration !== 1.0) bits.push(`${formatG(exaggeration)}x vertical exaggeration`)

  const parent = blankNode(startId, CLOUD_PARENT_DEFAULTS)
  parent.type = NodeType.Glyph
  parent.translate = { x: parentTranslate[0], y: parentTranslate[1], z: parentTranslate[2] }
  parent.ratio = pointSize / POINT_SIZE_SCALE
  parent.rotationMode = RotationMode.EulerXYZ
  parent.text = `${working.name} — ${bits.join('; ')}`

  const nodes: GvNode[] = [parent]
  for (let i = 0; i < n; i++) {
    const point = blankNode(startId + 1 + i, CLOUD_POINT_DEFAULTS)
    point.parentId = startId
    point.branchLevel = 1
    point.translate = {
      x: fit.points[i * 3],
      y: fit.points[i * 3 + 1],
      z: fit.points[i * 3 + 2],
    }
    point.color = { r: colors[i * 3], g: colors[i * 3 + 1], b: colors[i * 3 + 2], a: 255 }
    if (options.labelPoints) point.text = `${working.name} point ${i}`
    nodes.push(point)
  }

  let worldSpan: [number, number, number] = [0, 0, 0]
  if (n > 0) {
    const lo = [Infinity, Infinity, Infinity]
    const hi = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < n; i++) {
      for (let a = 0; a < 3; a++) {
        const v = fit.points[i * 3 + a]
        if (v < lo[a]) lo[a] = v
        if (v > hi[a]) hi[a] = v
      }
    }
    worldSpan = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]]
  }

  const report: ImportReport = {
    name: working.name,
    source: working.sourcePath,
    points: n,
    totalPoints: working.totalPoints,
    availablePoints: working.availablePoints || working.totalPoints,
    colorMode: usedMode,
    worldScale: fit.scale,
    sourceCenter: fit.center,
    sourceSpan,
    worldSpan,
    exaggeration,
    keptClasses:
      keepClasses === null || keepClasses.length === 0
        ? null
        : [...keepClasses].map((c) => Math.trunc(c)).sort((a, b) => a - b),
    crs: working.crs,
    classes: new Map([...counts.entries()].map(([code, count]) => [code, [className(code), count]])),
    decimation: 'none',
  }
  return { nodes, report }
}

/**
 * A PointCloudData holding only the given rows. `totalPoints` is deliberately
 * preserved: it means "how many were in the file", which is what the import
 * report needs to be honest about what was dropped.
 */
function subsetOf(data: PointCloudData, keep: Int32Array): PointCloudData {
  const takeScalar = <T extends Uint8Array | Uint16Array>(source: T | null): T | null => {
    if (source === null) return null
    const out = new (source.constructor as new (n: number) => T)(keep.length)
    for (let i = 0; i < keep.length; i++) out[i] = source[keep[i]]
    return out
  }
  return {
    ...data,
    points: gatherVec3(data.points, keep),
    colors: data.colors ? gatherRgb(data.colors, keep) : null,
    classification: takeScalar(data.classification),
    intensity: takeScalar(data.intensity),
  }
}

/**
 * Read a point-cloud file and return scene-ready nodes. The one call the import
 * window and any script both go through.
 *
 * `keepClasses` goes to the READER, not just to `buildPointCloudNodes`, so the
 * class filter narrows the population the decimation samples from rather than
 * thinning an already-decimated sample.
 */
export async function importPointCloudNodes(
  name: string,
  bytes: Uint8Array,
  options: LoadOptions & BuildNodesOptions = {},
): Promise<{ nodes: GvNode[]; report: ImportReport }> {
  const data = await loadPointCloud(name, bytes, options)
  return buildFromData(data, options)
}

/** `buildPointCloudNodes` plus the decimation note the report carries. */
export function buildFromData(
  data: PointCloudData,
  options: LoadOptions & BuildNodesOptions = {},
): { nodes: GvNode[]; report: ImportReport } {
  const built = buildPointCloudNodes(data, options)
  built.report.decimation =
    built.report.availablePoints > built.report.points ? (options.method ?? 'random') : 'none'
  return built
}
