import { describe, expect, it } from 'vitest'
import {
  CYLINDER_INTERIOR_BY_CAPS,
  INTERIOR_GEOMETRIES,
  hasCaps,
  isInteriorCylinder,
  isInteriorGeometry,
  withCaps,
} from './interiorGeometry'
import { GEOMETRY_MAX, GEOMETRY_NAMES, Geometry } from './types'

// The ids ARE the contract: CSVs move between the desktop app and this one, so
// a number that disagreed would silently redraw someone's scene as a different
// shape (desktop geometry_data.py, 2ba3c4c).
describe('the four interior ids', () => {
  it('are the desktop’s numbers exactly', () => {
    expect(Geometry.CubeInterior).toBe(29)
    expect(Geometry.SphereInterior).toBe(30)
    expect(Geometry.CylinderInterior).toBe(31)
    expect(Geometry.CylinderInteriorOpen).toBe(32)
  })

  it('sit past every pre-existing id, so nothing was renumbered', () => {
    expect(Geometry.TexturedPrism).toBe(28)
    for (const id of INTERIOR_GEOMETRIES) expect(id).toBeGreaterThan(Geometry.TexturedPrism)
  })

  it('are named and inside the valid range', () => {
    for (const id of INTERIOR_GEOMETRIES) {
      expect(GEOMETRY_NAMES[id]).toBeTruthy()
      expect(id).toBeLessThanOrEqual(GEOMETRY_MAX)
    }
    // GEOMETRY_MAX is the highest id (the desktop's GEO_COUNT is the count).
    expect(GEOMETRY_MAX).toBe(Geometry.CylinderInteriorOpen)
  })

  it('recognises exactly those four as interior', () => {
    expect(INTERIOR_GEOMETRIES.size).toBe(4)
    expect(isInteriorGeometry(Geometry.SphereInterior)).toBe(true)
    expect(isInteriorGeometry(Geometry.SphereSolid)).toBe(false)
    expect(isInteriorGeometry(Geometry.CylinderSolid)).toBe(false)
  })
})

describe('end caps', () => {
  it('pairs the two cylinder ids', () => {
    expect(CYLINDER_INTERIOR_BY_CAPS.true).toBe(Geometry.CylinderInterior)
    expect(CYLINDER_INTERIOR_BY_CAPS.false).toBe(Geometry.CylinderInteriorOpen)
    expect(hasCaps(Geometry.CylinderInterior)).toBe(true)
    expect(hasCaps(Geometry.CylinderInteriorOpen)).toBe(false)
    expect(isInteriorCylinder(Geometry.CylinderInterior)).toBe(true)
    expect(isInteriorCylinder(Geometry.CylinderInteriorOpen)).toBe(true)
    expect(isInteriorCylinder(Geometry.SphereInterior)).toBe(false)
  })

  it('switches between them in both directions', () => {
    expect(withCaps(Geometry.CylinderInteriorOpen, true)).toBe(Geometry.CylinderInterior)
    expect(withCaps(Geometry.CylinderInterior, false)).toBe(Geometry.CylinderInteriorOpen)
    // Idempotent: setting the state it is already in is not a change.
    expect(withCaps(Geometry.CylinderInterior, true)).toBe(Geometry.CylinderInterior)
    expect(withCaps(Geometry.CylinderInteriorOpen, false)).toBe(Geometry.CylinderInteriorOpen)
  })

  // The load-bearing one: the checkbox runs over the whole selection, so a
  // mixed selection must not have its spheres turned into cylinders.
  it('is a no-op for every other id, in both directions', () => {
    for (let id = 0; id <= GEOMETRY_MAX; id++) {
      if (isInteriorCylinder(id)) continue
      expect(withCaps(id, true)).toBe(id)
      expect(withCaps(id, false)).toBe(id)
      expect(hasCaps(id)).toBe(false)
    }
  })
})
