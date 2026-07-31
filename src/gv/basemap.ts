// Fetch Basemap — the map-fetch math, ported (behavior, not code) from the
// desktop glyphviz_core/basemap.py (commit 8573571, verified 2026-07-31).
//
// A lon/lat bounding box plans a tile download and a plate-carrée image whose
// coverage exactly matches the World Grid extents it will be paired with. All
// the interesting work — zoom selection under a tile-count cap, slippy-tile
// math, the Web Mercator → equirectangular row resample — is pure arithmetic
// over numbers and typed arrays, so it lives here and runs in plain node; the
// browser-only pieces (network, canvas, PNG encode) are in
// src/render/basemapFetch.ts.
//
// Why reprojection is mandatory: tile servers serve Web Mercator (EPSG:3857),
// but a World Grid maps its texture *linearly* in latitude across the extents
// window (plate carrée). Skipping the resample would visibly misplace glyphs
// at mid/high latitudes — tens of pixels for a region like the contiguous US.
// Longitude is linear in both projections, so only rows are resampled.

import { roundHalfToEven } from './pythonRound'
import type { GvNode } from './types'

export const TILE_SIZE = 256
/** Web Mercator's latitude of validity; also the pole of tile y = 0 / n-1. */
export const MERCATOR_LAT_LIMIT = 85.0511287798066

// Defaults for planBasemap, the desktop's own: ~1536 px across reads crisply
// on a fullscreen plate; 60 tiles (a worst-case fetch around 1.5 MB, well
// inside the OSM tile usage policy's idea of polite) is the smallest cap that
// lets a square regional bbox reach that width.
export const DEFAULT_TARGET_PX = 1536
export const DEFAULT_TILE_CAP = 60

/** Anything that should surface to the user as a message, not a stack trace. */
export class BasemapError extends Error {}

export interface Provider {
  key: string
  label: string
  /** {z}/{x}/{y} placeholders. */
  urlTemplate: string
  attribution: string
  maxZoom: number
}

// Key-free providers only, the desktop's own three; adding a key-requiring
// one (Mapbox etc.) is a new entry plus whatever auth its template needs.
export const PROVIDERS: Record<string, Provider> = {
  osm: {
    key: 'osm',
    label: 'OpenStreetMap (streets)',
    urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  },
  esri_imagery: {
    key: 'esri_imagery',
    label: 'Esri World Imagery (satellite)',
    urlTemplate:
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    maxZoom: 19,
  },
  opentopomap: {
    key: 'opentopomap',
    label: 'OpenTopoMap (terrain)',
    urlTemplate: 'https://tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors, SRTM | © OpenTopoMap (CC-BY-SA)',
    maxZoom: 17,
  },
}
export const DEFAULT_PROVIDER = 'osm'

export interface BBox {
  lonMin: number
  lonMax: number
  latMin: number
  latMax: number
}

/**
 * Grow each axis by `frac` of its span (degenerate spans get a half-degree
 * cushion so a single-point dataset still yields a map).
 */
export function paddedBBox(b: BBox, frac: number): BBox {
  const lonPad = Math.max((b.lonMax - b.lonMin) * frac, 0.5)
  const latPad = Math.max((b.latMax - b.latMin) * frac, 0.5)
  return {
    lonMin: b.lonMin - lonPad,
    lonMax: b.lonMax + lonPad,
    latMin: b.latMin - latPad,
    latMax: b.latMax + latPad,
  }
}

export function clampedBBox(b: BBox): BBox {
  return {
    lonMin: Math.max(b.lonMin, -180.0),
    lonMax: Math.min(b.lonMax, 180.0),
    latMin: Math.max(b.latMin, -MERCATOR_LAT_LIMIT),
    latMax: Math.min(b.latMax, MERCATOR_LAT_LIMIT),
  }
}

export function validateBBox(b: BBox): void {
  const vals = [b.lonMin, b.lonMax, b.latMin, b.latMax]
  if (!vals.every(Number.isFinite)) {
    throw new BasemapError('Bounding box has non-finite values.')
  }
  if (b.lonMax <= b.lonMin || b.latMax <= b.latMin) {
    throw new BasemapError('Bounding box max must exceed min on each axis.')
  }
  if (b.lonMin < -180.0 || b.lonMax > 180.0) {
    throw new BasemapError(
      'Longitude window must lie within -180..180 ' +
        "(antimeridian-crossing regions aren't supported yet).",
    )
  }
}

/**
 * Bounding box of a grid's DIRECT children's lon/lat (translate x/y), padded —
 * the numbers the Fetch Basemap dialog prefills. Descendants deeper than the
 * direct children place relative to them, so they don't contribute. Null when
 * the grid has no children.
 */
export function bboxFromNodes(
  nodes: readonly GvNode[],
  gridId: number,
  padFrac = 0.05,
): BBox | null {
  const kids = nodes.filter((n) => n.parentId === gridId)
  if (kids.length === 0) return null
  const lons = kids.map((n) => n.translate.x)
  const lats = kids.map((n) => n.translate.y)
  const raw: BBox = {
    lonMin: Math.min(...lons),
    lonMax: Math.max(...lons),
    latMin: Math.min(...lats),
    latMax: Math.max(...lats),
  }
  return clampedBBox(paddedBBox(raw, padFrac))
}

// --- slippy-tile math --------------------------------------------------------

/** Latitude → normalized Web Mercator y in 0..1 (0 = north edge). */
export function mercYNorm(latDeg: number): number {
  const lat = (latDeg * Math.PI) / 180
  return (1.0 - Math.asinh(Math.tan(lat)) / Math.PI) / 2.0
}

/** Longitude → normalized x in 0..1 (0 = -180). */
export function lonXNorm(lonDeg: number): number {
  return (lonDeg + 180.0) / 360.0
}

/**
 * Everything a fetch will do, computable without touching the network — the
 * dialog previews these numbers live as the bbox is edited.
 */
export interface BasemapPlan {
  provider: Provider
  /** Exact coverage; pair the grid extents with THIS, never the typed values. */
  bbox: BBox
  zoom: number
  txMin: number
  txMax: number
  tyMin: number
  tyMax: number
  outW: number
  outH: number
}

export function planTileCount(plan: BasemapPlan): number {
  return (plan.txMax - plan.txMin + 1) * (plan.tyMax - plan.tyMin + 1)
}

/**
 * Pick the zoom level and tile range for `bbox`: the smallest zoom whose
 * output is at least ~targetPx wide, backed off until the tile count fits
 * under `tileCap` (zoom 0 is a single tile, so a plan always exists).
 */
export function planBasemap(
  bboxIn: BBox,
  providerKey: string = DEFAULT_PROVIDER,
  targetPx: number = DEFAULT_TARGET_PX,
  tileCap: number = DEFAULT_TILE_CAP,
): BasemapPlan {
  const provider = PROVIDERS[providerKey]
  if (provider === undefined) {
    throw new BasemapError(`Unknown basemap provider: '${providerKey}'`)
  }
  const bbox = clampedBBox(bboxIn)
  validateBBox(bbox)

  const tilesAt = (z: number): [number, number, number, number] => {
    const n = 1 << z
    // trunc, not floor: Python's int() truncates toward zero, and at the
    // Mercator limit the norm computes to −2e−16 — floor would answer −1
    // where the desktop answers 0 (caught by the whole_earth parity case).
    // The `+ 0` turns trunc's −0 into +0.
    const pyInt = (v: number) => Math.trunc(v) + 0
    const txMin = Math.min(pyInt(lonXNorm(bbox.lonMin) * n), n - 1)
    const txMax = Math.min(pyInt(lonXNorm(bbox.lonMax) * n), n - 1)
    const tyMin = Math.min(pyInt(mercYNorm(bbox.latMax) * n), n - 1) // north edge
    const tyMax = Math.min(pyInt(mercYNorm(bbox.latMin) * n), n - 1)
    return [txMin, txMax, tyMin, tyMax]
  }

  const widthPx = (z: number): number =>
    ((bbox.lonMax - bbox.lonMin) / 360.0) * (1 << z) * TILE_SIZE

  let zoom = provider.maxZoom
  for (let z = 0; z <= provider.maxZoom; z++) {
    if (widthPx(z) >= targetPx) {
      zoom = z
      break
    }
  }
  while (zoom > 0) {
    const [txMin, txMax, tyMin, tyMax] = tilesAt(zoom)
    if ((txMax - txMin + 1) * (tyMax - tyMin + 1) <= tileCap) break
    zoom -= 1
  }
  const [txMin, txMax, tyMin, tyMax] = tilesAt(zoom)

  const outW = Math.max(roundHalfToEven(widthPx(zoom)), 1)
  // Square pixels in degree space: the grid drapes the texture linearly in
  // lon and lat, so matching the window's degree aspect keeps it undistorted.
  const outH = Math.max(
    roundHalfToEven((outW * (bbox.latMax - bbox.latMin)) / (bbox.lonMax - bbox.lonMin)),
    1,
  )
  return { provider, bbox, zoom, txMin, txMax, tyMin, tyMax, outW, outH }
}

export function tileUrl(provider: Provider, z: number, x: number, y: number): string {
  return provider.urlTemplate
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y))
}

// --- reproject (Mercator → plate carrée) --------------------------------------

/** An RGBA pixel rectangle — ImageData's shape, without needing a DOM type. */
export interface PixelRect {
  width: number
  height: number
  /** RGBA, row-major, 4 bytes per pixel (plain-buffer-backed, as ImageData wants). */
  data: Uint8ClampedArray<ArrayBuffer>
}

/**
 * np.linspace: `num` evenly spaced samples from start to stop inclusive
 * (the endpoint is set exactly, as numpy guarantees).
 */
function linspace(start: number, stop: number, num: number): Float64Array {
  const out = new Float64Array(num)
  if (num === 1) {
    out[0] = start
    return out
  }
  const step = (stop - start) / (num - 1)
  for (let i = 0; i < num; i++) out[i] = start + step * i
  out[num - 1] = stop
  return out
}

/**
 * For each output row i (linearly spaced latitude, north → south, matching
 * image row order), the exact Mercator source position in CANVAS-local
 * pixels — before rounding. Split out so the parity test can pin the floats
 * at tight tolerance and apply the rounding rule separately.
 */
export function reprojectionRowPositions(plan: BasemapPlan): Float64Array {
  const nPx = (1 << plan.zoom) * TILE_SIZE
  const y0 = plan.tyMin * TILE_SIZE
  const lats = linspace(plan.bbox.latMax, plan.bbox.latMin, plan.outH)
  const out = new Float64Array(plan.outH)
  for (let i = 0; i < plan.outH; i++) out[i] = mercYNorm(lats[i]) * nPx - y0
  return out
}

/**
 * Source canvas row per output row (np.rint = half-to-even, like Python's
 * round), clipped to the canvas.
 */
export function reprojectionRows(plan: BasemapPlan, canvasHeight: number): Int32Array {
  const positions = reprojectionRowPositions(plan)
  const rows = new Int32Array(plan.outH)
  for (let i = 0; i < plan.outH; i++) {
    rows[i] = Math.min(Math.max(roundHalfToEven(positions[i]), 0), canvasHeight - 1)
  }
  return rows
}

/** The stitched canvas's column window for the bbox: [left, right). */
export function reprojectionColumns(
  plan: BasemapPlan,
  canvasWidth: number,
): { left: number; right: number } {
  const nPx = (1 << plan.zoom) * TILE_SIZE
  const x0 = plan.txMin * TILE_SIZE
  let left = roundHalfToEven(lonXNorm(plan.bbox.lonMin) * nPx) - x0
  left = Math.min(Math.max(left, 0), canvasWidth - 1)
  const right = Math.min(left + plan.outW, canvasWidth)
  return { left, right }
}

/**
 * Crop the stitched Mercator canvas to the bbox and resample its rows so
 * latitude becomes linear (columns are already linear in longitude) —
 * desktop `_reproject_to_equirect`, on RGBA instead of RGB.
 */
export function reprojectToEquirect(canvas: PixelRect, plan: BasemapPlan): PixelRect {
  const { left, right } = reprojectionColumns(plan, canvas.width)
  const rows = reprojectionRows(plan, canvas.height)
  const outW = right - left
  const out = new Uint8ClampedArray(outW * plan.outH * 4)
  for (let i = 0; i < plan.outH; i++) {
    const src = (rows[i] * canvas.width + left) * 4
    out.set(canvas.data.subarray(src, src + outW * 4), i * outW * 4)
  }
  return { width: outW, height: plan.outH, data: out }
}
