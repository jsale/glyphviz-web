import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { Geometry } from '../gv/types'
import { createGlyphObject, quantizedTorusRatio } from './glyphGeometry'

describe('quantizedTorusRatio', () => {
  it('quantizes to 1% steps with Python rounding, the desktop cache bound', () => {
    expect(quantizedTorusRatio(0.14)).toBeCloseTo(0.14, 12) // the default, untouched
    expect(quantizedTorusRatio(0.1234)).toBeCloseTo(0.12, 12)
    expect(quantizedTorusRatio(0.1299)).toBeCloseTo(0.13, 12)
    // Exact halves go to the even hundredth, like Python's round(x, 2).
    expect(quantizedTorusRatio(0.125)).toBeCloseTo(0.12, 12)
    expect(quantizedTorusRatio(0.135)).toBeCloseTo(0.14, 12)
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
