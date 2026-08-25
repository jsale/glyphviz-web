// Interior geometries — the shape seen from WITHIN, culled from without.
// A port of the desktop's geometry_data block for GEO_CUBE_INTERIOR …
// GEO_CYLINDER_INTERIOR_OPEN (2ba3c4c). Data-model predicates only; the shapes
// themselves are built in src/render/uvGeometry.ts.
//
// WHY THIS IS A GEOMETRY ID and not a per-node flag or a node type: looking at
// the inside of an outward-mapped surface is inherently a MIRROR view, so a
// node that merely stopped culling would play every video backwards (measured
// on the desktop: a texture reading "R" comes back as "Я"). The fix lives in
// the vertex and UV data — i.e. in the shape — so the shape is what names it.
// Riding in `geometry` also means the choice travels with the CSV for free: it
// saves, loads, cycles on O and animates through Channels like any other id,
// with no new column.

import { Geometry } from './types'

/** Seen from inside, culled from outside — see the header. */
export const INTERIOR_GEOMETRIES: ReadonlySet<number> = new Set<number>([
  Geometry.CubeInterior,
  Geometry.SphereInterior,
  Geometry.CylinderInterior,
  Geometry.CylinderInteriorOpen,
])

export function isInteriorGeometry(geometry: number): boolean {
  return INTERIOR_GEOMETRIES.has(geometry)
}

/**
 * The interior cylinder's end caps, as a PAIR OF IDS rather than a column.
 *
 * Open is a cylindrical panorama you look along (or a link you fly down);
 * capped is a closed room with the texture covering both ends as well. The
 * Properties panel presents the pair as an "End caps" checkbox that simply
 * swaps the id.
 */
export const CYLINDER_INTERIOR_BY_CAPS: Readonly<Record<'true' | 'false', number>> = {
  true: Geometry.CylinderInterior,
  false: Geometry.CylinderInteriorOpen,
}

/** Whether `geometry` is one of the two ids the End caps checkbox governs. */
export function isInteriorCylinder(geometry: number): boolean {
  return (
    geometry === Geometry.CylinderInterior || geometry === Geometry.CylinderInteriorOpen
  )
}

/**
 * Whether `geometry` is an interior cylinder that draws its end caps. False
 * for the open variant — and for everything that isn't one, which has no caps
 * to speak of.
 */
export function hasCaps(geometry: number): boolean {
  return geometry === Geometry.CylinderInterior
}

/**
 * `geometry` switched to the capped/open member of its pair, and A NO-OP FOR
 * ANY OTHER ID — which is the point: the checkbox runs over the whole
 * selection, and a mixed selection must not have its spheres turned into
 * cylinders.
 */
export function withCaps(geometry: number, caps: boolean): number {
  if (!isInteriorCylinder(geometry)) return geometry
  return caps ? Geometry.CylinderInterior : Geometry.CylinderInteriorOpen
}
