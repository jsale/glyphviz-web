// Fetch Basemap — the browser half: download the plan's tiles, stitch them on
// a canvas, reproject Mercator → plate carrée (the pure math in
// src/gv/basemap.ts), stamp the provider's required attribution into the
// corner, and encode a PNG. Ported from desktop glyphviz_core/basemap.py's
// build_basemap + _stamp_attribution.
//
// Provider etiquette is designed in, not bolted on, as on the desktop: a hard
// cap on tiles per request (planBasemap), sequential fetches (the OSM tile
// policy allows two threads; the desktop uses one), and a per-tile cache so
// bbox tweaks and refetches never re-hit the server. The desktop identifies
// itself with a User-Agent header; a browser forbids setting that header, so
// the browser's own UA + Referer identify this app instead — the cache is the
// Cache API (per-origin, survives reloads) rather than a disk folder.

import {
  BasemapError,
  TILE_SIZE,
  planTileCount,
  reprojectToEquirect,
  tileUrl,
} from '../gv/basemap'
import type { BasemapPlan, PixelRect } from '../gv/basemap'

/** Resolves a tile URL to its bytes; tests and the cache inject around it. */
export type TileFetcher = (url: string) => Promise<Blob>

const CACHE_NAME = 'glyphviz-tile-cache'
const FETCH_TIMEOUT_MS = 20_000

/**
 * Tile bytes, served from the Cache API when possible — the web's
 * `%LOCALAPPDATA%/GlyphViz/tile_cache`. `caches` needs a secure context
 * (localhost or https, which covers dev and iluvdata.org); anywhere else the
 * fetch still works, just uncached.
 */
async function cachedFetch(url: string): Promise<Blob> {
  let cache: Cache | null = null
  try {
    cache = typeof caches !== 'undefined' ? await caches.open(CACHE_NAME) : null
  } catch {
    cache = null
  }
  if (cache) {
    const hit = await cache.match(url)
    if (hit) return hit.blob()
  }
  const resp = await fetch(url, { mode: 'cors', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!resp.ok) throw new BasemapError(`Tile fetch failed (${url}): HTTP ${resp.status}`)
  if (cache) {
    try {
      await cache.put(url, resp.clone())
    } catch {
      // Quota or opaque-response refusal: caching is best-effort.
    }
  }
  return resp.blob()
}

export interface BuildBasemapOptions {
  /** url → bytes; default is a CORS fetch behind the Cache API. */
  fetchTile?: TileFetcher
  /** Called after each tile lands: (done, total). */
  progress?: (done: number, total: number) => void
  /** Polled between tiles; return true to abort (dialog close / Cancel). */
  cancelled?: () => boolean
}

/**
 * Fetch the plan's tiles, stitch, reproject, stamp attribution, and encode a
 * PNG. Throws BasemapError for anything the user should read as a message.
 */
export async function buildBasemapPng(
  plan: BasemapPlan,
  options: BuildBasemapOptions = {},
): Promise<Blob> {
  const fetchTile = options.fetchTile ?? cachedFetch
  const nX = plan.txMax - plan.txMin + 1
  const nY = plan.tyMax - plan.tyMin + 1
  const total = planTileCount(plan)

  const canvas = document.createElement('canvas')
  canvas.width = nX * TILE_SIZE
  canvas.height = nY * TILE_SIZE
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new BasemapError('Could not create a 2D canvas for the map.')

  let done = 0
  for (let ty = plan.tyMin; ty <= plan.tyMax; ty++) {
    for (let tx = plan.txMin; tx <= plan.txMax; tx++) {
      if (options.cancelled?.()) throw new BasemapError('Cancelled.')
      const url = tileUrl(plan.provider, plan.zoom, tx, ty)
      let blob: Blob
      try {
        blob = await fetchTile(url)
      } catch (err) {
        if (err instanceof BasemapError) throw err
        throw new BasemapError(`Tile fetch failed (${url}): ${String(err)}`)
      }
      let bitmap: ImageBitmap
      try {
        bitmap = await createImageBitmap(blob)
      } catch (err) {
        throw new BasemapError(
          `Tile ${plan.zoom}/${tx}/${ty} is not a readable image: ${String(err)}`,
        )
      }
      // drawImage with a destination size normalizes odd tile sizes (the
      // desktop resizes to 256 for the same reason).
      ctx.drawImage(
        bitmap,
        (tx - plan.txMin) * TILE_SIZE,
        (ty - plan.tyMin) * TILE_SIZE,
        TILE_SIZE,
        TILE_SIZE,
      )
      bitmap.close()
      done += 1
      options.progress?.(done, total)
    }
  }

  const stitched: PixelRect = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const out = reprojectToEquirect(stitched, plan)

  const outCanvas = document.createElement('canvas')
  outCanvas.width = out.width
  outCanvas.height = out.height
  const outCtx = outCanvas.getContext('2d')
  if (!outCtx) throw new BasemapError('Could not create a 2D canvas for the map.')
  outCtx.putImageData(new ImageData(out.data, out.width, out.height), 0, 0)
  stampAttribution(outCtx, out.width, out.height, plan.provider.attribution)

  const png = await new Promise<Blob | null>((resolve) =>
    outCanvas.toBlob((b) => resolve(b), 'image/png'),
  )
  if (!png) throw new BasemapError('PNG encoding failed.')
  return png
}

/**
 * Bake the provider's required attribution into the bottom-right corner (a
 * translucent strip keeps it legible on any map style). Same layout numbers
 * as the desktop's _stamp_attribution; the face is the browser's sans-serif
 * where PIL uses its bundled default — cosmetic, not behavioral.
 */
export function stampAttribution(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  text: string,
): void {
  const size = Math.max(11, Math.floor(height / 90))
  ctx.font = `${size}px sans-serif`
  ctx.textBaseline = 'top'
  const pad = 4
  const w = Math.ceil(ctx.measureText(text).width) + 2 * pad
  const h = size + 2 * pad
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)' // desktop alpha 140
  ctx.fillRect(width - w, height - h, w, h)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)' // desktop alpha 230
  ctx.fillText(text, width - w + pad, height - h + pad)
}
