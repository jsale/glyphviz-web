import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { INTERIOR_GEOMETRIES } from '../gv/interiorGeometry'
import { Geometry } from '../gv/types'
import { WIRE_TO_SOLID, createGlyphObject, createPickProxy, quantizedShapeRatio } from './glyphGeometry'

describe('quantizedShapeRatio', () => {
  it('quantizes to 1% steps with Python rounding, the desktop cache bound', () => {
    expect(quantizedShapeRatio(0.14)).toBeCloseTo(0.14, 12) // the default, untouched
    expect(quantizedShapeRatio(0.1234)).toBeCloseTo(0.12, 12)
    expect(quantizedShapeRatio(0.1299)).toBeCloseTo(0.13, 12)
    // Exact halves go to the even hundredth, like Python's round(x, 2).
    expect(quantizedShapeRatio(0.125)).toBeCloseTo(0.12, 12)
    expect(quantizedShapeRatio(0.135)).toBeCloseTo(0.14, 12)
  })

  it('bounds the torus geometry cache under a swept ratio', () => {
    const style = { color: new THREE.Color(1, 1, 1), opacity: 1, ratio: 0 }
    const geometries = new Set<THREE.BufferGeometry>()
    // A 1000-step sweep over the whole 0–0.5 tube range would mint 1000
    // geometries unquantized; the desktop's 1% buckets cap it at ~51.
    for (let i = 0; i < 1000; i++) {
      const torus = createGlyphObject(Geometry.TorusSolid, {
        ...style,
        ratio: (i / 1000) * 0.5,
      }) as THREE.Mesh
      geometries.add(torus.geometry)
    }
    expect(geometries.size).toBeLessThanOrEqual(51)
  })
})

describe('interior geometries', () => {
  const style = { color: new THREE.Color(1, 1, 1), opacity: 1, ratio: 0.14 }
  const glyph = (id: number) => createGlyphObject(id, style) as THREE.Mesh

  it('draws them UNLIT, so a video comes through at its own brightness', () => {
    for (const id of [
      Geometry.CubeInterior,
      Geometry.SphereInterior,
      Geometry.CylinderInterior,
      Geometry.CylinderInteriorOpen,
    ]) {
      const material = glyph(id).material as THREE.Material
      expect(material, `geometry ${id}`).toBeInstanceOf(THREE.MeshBasicMaterial)
      expect(material).not.toBeInstanceOf(THREE.MeshLambertMaterial)
    }
    // The control: every other solid is still lit.
    expect(glyph(Geometry.SphereSolid).material).toBeInstanceOf(THREE.MeshLambertMaterial)
  })

  // Single-sided, not two-sided: one fragment per pixel, and alpha on a
  // translucent node keeps behaving. `DoubleSide` is the reach that would
  // undo the mirror's whole point.
  it('keeps them single-sided', () => {
    for (const id of [
      Geometry.CubeInterior,
      Geometry.SphereInterior,
      Geometry.CylinderInterior,
      Geometry.CylinderInteriorOpen,
    ]) {
      expect((glyph(id).material as THREE.Material).side, `geometry ${id}`).toBe(THREE.FrontSide)
    }
  })

  it('does not collide with the lit material of an identical-looking node', () => {
    const lit = glyph(Geometry.SphereSolid).material
    const unlit = glyph(Geometry.SphereInterior).material
    expect(unlit).not.toBe(lit)
    // …while each variant is still shared across look-alikes, which is what
    // keeps a 209k-node scene affordable.
    expect(glyph(Geometry.SphereInterior).material).toBe(unlit)
  })

  // If the two cylinders shared a cached geometry, the End caps checkbox would
  // do nothing on screen.
  it('caches the capped and open cylinders separately', () => {
    const capped = glyph(Geometry.CylinderInterior).geometry
    const open = glyph(Geometry.CylinderInteriorOpen).geometry
    expect(capped).not.toBe(open)
    expect(capped.getAttribute('position').count).toBeGreaterThan(
      open.getAttribute('position').count,
    )
    // Cached, not rebuilt per node.
    expect(glyph(Geometry.CylinderInterior).geometry).toBe(capped)
  })

  it('leaves the exterior shapes it is built from untouched', () => {
    // mirroredGeometry mutates in place, so a builder that handed out the
    // shared exterior geometry would turn every plain sphere inside out.
    const exterior = glyph(Geometry.SphereSolid).geometry
    const interior = glyph(Geometry.SphereInterior).geometry
    expect(exterior).not.toBe(interior)
    const pos = exterior.getAttribute('position')
    let maxX = -Infinity
    for (let i = 0; i < pos.count; i++) maxX = Math.max(maxX, pos.getX(i))
    expect(maxX).toBeCloseTo(1, 6)
  })

  /**
   * The pick pass draws what the visible pass draws (the desktop invariant),
   * so from outside you pick the FAR inner wall — leaving whatever stands
   * inside the room nearer, and therefore still clickable. A double-sided
   * proxy would stop the ray on the near wall you cannot even see.
   */
  it('picks through the near wall, like the desktop', () => {
    const proxy = createPickProxy(Geometry.CubeInterior) as THREE.Mesh
    expect((proxy.material as THREE.Material).side).toBe(THREE.FrontSide)
    const ordinary = createPickProxy(Geometry.CubeSolid) as THREE.Mesh
    expect((ordinary.material as THREE.Material).side).toBe(THREE.DoubleSide)

    // Off-axis: straight down the Z axis the ray would cross each face on the
    // diagonal its two triangles share, and be counted twice.
    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(0.1, 0.2, 5),
      new THREE.Vector3(0, 0, -1),
    )
    proxy.updateMatrixWorld(true)
    const hits = raycaster.intersectObject(proxy, false)
    expect(hits.length).toBe(1)
    // The FAR wall: the floor, on the far side of the origin.
    expect(hits[0].point.z).toBeLessThan(0)
  })

  it('has no wire twin to substitute in the pick pass', () => {
    // An interior shape has no wire form on either side: a wireframe of an
    // inside-out shell is the same set of lines as its exterior twin's.
    for (const id of Object.values(WIRE_TO_SOLID)) {
      expect(INTERIOR_GEOMETRIES.has(id)).toBe(false)
    }
  })
})
