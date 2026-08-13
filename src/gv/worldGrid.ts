// World Grid (type = 6) data accessors, ported (behavior, not code) from the
// desktop glyphviz_core/node.py grid accessors (verified 2026-07-24).
// Spec reference: glyphviz-skill/references/world-grid.md.
//
// The extents/segments fields live in the optional trigger_lo/hi_* and
// segments_* CSV columns, which the minimal web dialect keeps in `extras` —
// same storage the desktop uses.

import type { GvNode } from './types'
import { Geometry, NodeType } from './types'

/** Globe sphere radius: 180/π, so the equator is exactly 360 world units. */
export const GRID_GLOBE_RADIUS = 180.0 / Math.PI

/** Whole-earth window used when an extents axis is degenerate (hi ≤ lo). */
export const GRID_DEFAULT_EXTENTS = [-180, 180, -90, 90] as const

/**
 * Segments a NEWLY CREATED grid gets — 10°-cell lines across the whole-earth
 * window (desktop GRID_DEFAULT_SEGMENTS). Not the same number as gridSegments'
 * fallback for a row that names none, which stays the desktop's own 16.
 */
export const GRID_DEFAULT_SEGMENTS = [36, 18] as const

export interface GridExtents {
  lonLo: number
  lonHi: number
  latLo: number
  latHi: number
}

function extrasFloat(node: GvNode, key: string, fallback: number): number {
  const raw = node.extras[key]
  if (raw === undefined || raw === '') return fallback
  const v = Number(raw)
  return Number.isFinite(v) ? v : fallback
}

/**
 * The grid's lon/lat coordinate window. A degenerate axis (hi ≤ lo — e.g.
 * the all-zero defaults of files predating the feature) falls back to the
 * whole-earth window for that axis.
 */
export function gridExtents(node: GvNode): GridExtents {
  let lonLo = extrasFloat(node, 'trigger_lo_x', 0)
  let lonHi = extrasFloat(node, 'trigger_hi_x', 0)
  let latLo = extrasFloat(node, 'trigger_lo_y', 0)
  let latHi = extrasFloat(node, 'trigger_hi_y', 0)
  if (lonHi <= lonLo) {
    lonLo = GRID_DEFAULT_EXTENTS[0]
    lonHi = GRID_DEFAULT_EXTENTS[1]
  }
  if (latHi <= latLo) {
    latLo = GRID_DEFAULT_EXTENTS[2]
    latHi = GRID_DEFAULT_EXTENTS[3]
  }
  return { lonLo, lonHi, latLo, latHi }
}

/** (lon, lat) that sits at the grid's own position — the window midpoint. */
export function gridCenter(node: GvNode): { lon: number; lat: number } {
  const e = gridExtents(node)
  return { lon: (e.lonLo + e.lonHi) / 2, lat: (e.latLo + e.latHi) / 2 }
}

/** Half-spans (lon, lat) of the window — the plate's ±1-unit scale factors. */
export function gridHalfExtents(node: GvNode): { lon: number; lat: number } {
  const e = gridExtents(node)
  return { lon: (e.lonHi - e.lonLo) / 2, lat: (e.latHi - e.latLo) / 2 }
}

/**
 * True when this World Grid renders as a globe (geometry Sphere or Sphere
 * Wire) — children then place by KML lon/lat/elevation on the sphere
 * surface instead of on the flat extents window.
 */
export function gridIsGlobe(node: GvNode): boolean {
  return (
    node.type === NodeType.WorldGrid &&
    (node.geometry === Geometry.SphereWire || node.geometry === Geometry.SphereSolid)
  )
}

/** (x, y) rendered cell counts; 1 = plain outline / minimal graticule. */
export function gridSegments(node: GvNode): { x: number; y: number } {
  const sx = Math.trunc(extrasFloat(node, 'segments_x', 16)) || 16
  const sy = Math.trunc(extrasFloat(node, 'segments_y', 16)) || 16
  return { x: Math.max(1, sx), y: Math.max(1, sy) }
}

/**
 * Per-axis draw scale for the grid's ±1-unit geometry: the RAW node scale
 * times the shape's half-spans — with neither base_scale nor the 0.2 render
 * floor (both exemptions keep the surface exactly under the children it
 * frames; desktop scene._grid_draw_scale).
 */
export function gridDrawScale(node: GvNode): { x: number; y: number; z: number } {
  if (gridIsGlobe(node)) {
    const r = GRID_GLOBE_RADIUS
    return { x: node.scale.x * r, y: node.scale.y * r, z: node.scale.z * r }
  }
  const half = gridHalfExtents(node)
  return { x: node.scale.x * half.lon, y: node.scale.y * half.lat, z: node.scale.z }
}
