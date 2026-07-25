import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { applyPerFaceUV, fitPlanarUV, zSphereGeometry, zTubeGeometry } from './uvGeometry'
import { createGlyphObject } from './glyphGeometry'
import { Geometry } from '../gv/types'

/** UV of the vertex nearest a world position, for checking the mapping. */
function uvNearest(geo: THREE.BufferGeometry, x: number, y: number, z: number): [number, number] {
  const pos = geo.getAttribute('position')
  const uv = geo.getAttribute('uv')
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < pos.count; i++) {
    const d = (pos.getX(i) - x) ** 2 + (pos.getY(i) - y) ** 2 + (pos.getZ(i) - z) ** 2
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  }
  return [uv.getX(best), uv.getY(best)]
}

function uvRange(geo: THREE.BufferGeometry) {
  const uv = geo.getAttribute('uv')
  let minU = Infinity
  let maxU = -Infinity
  let minV = Infinity
  let maxV = -Infinity
  for (let i = 0; i < uv.count; i++) {
    minU = Math.min(minU, uv.getX(i))
    maxU = Math.max(maxU, uv.getX(i))
    minV = Math.min(minV, uv.getY(i))
    maxV = Math.max(maxV, uv.getY(i))
  }
  return { minU, maxU, minV, maxV }
}

describe('zSphereGeometry', () => {
  const sphere = zSphereGeometry(1, 32, 16)

  it('puts its poles on ±Z, not ±Y like Three', () => {
    const pos = sphere.getAttribute('position')
    let minZ = Infinity
    let maxZ = -Infinity
    for (let i = 0; i < pos.count; i++) {
      minZ = Math.min(minZ, pos.getZ(i))
      maxZ = Math.max(maxZ, pos.getZ(i))
    }
    expect(minZ).toBeCloseTo(-1, 6)
    expect(maxZ).toBeCloseTo(1, 6)
    // A pole vertex is exactly on the axis.
    const [, vSouth] = uvNearest(sphere, 0, 0, -1)
    expect(vSouth).toBeCloseTo(0, 6)
  })

  it('maps equirectangularly: u eastward from −X, v northward', () => {
    // lon −180 (−X) → u 0; lon 0 (+X) → u 0.5; lon +90 (+Y) → u 0.75.
    expect(uvNearest(sphere, -1, 0, 0)[0]).toBeCloseTo(0, 6)
    expect(uvNearest(sphere, 1, 0, 0)[0]).toBeCloseTo(0.5, 6)
    expect(uvNearest(sphere, 0, 1, 0)[0]).toBeCloseTo(0.75, 6)
    // Equator is v 0.5; the north pole is v 1.
    expect(uvNearest(sphere, 1, 0, 0)[1]).toBeCloseTo(0.5, 6)
    expect(uvNearest(sphere, 0, 0, 1)[1]).toBeCloseTo(1, 6)
  })

  it('is NOT the mirrored gluSphere mapping the desktop inherits', () => {
    // GLU would put s=0 at +Y and run backwards (0.25 at +X). Ours is 0.75/0.5.
    expect(uvNearest(sphere, 0, 1, 0)[0]).not.toBeCloseTo(0, 3)
    expect(uvNearest(sphere, 1, 0, 0)[0]).not.toBeCloseTo(0.25, 3)
  })

  it('duplicates the seam column so the texture closes instead of smearing', () => {
    const pos = sphere.getAttribute('position')
    const uv = sphere.getAttribute('uv')
    // Two vertices share the −X equator position, carrying u 0 and u 1.
    const seam: number[] = []
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getX(i) + 1) < 1e-9 && Math.abs(pos.getZ(i)) < 1e-9) seam.push(uv.getX(i))
    }
    expect(seam.sort()).toEqual([0, 1])
  })

  it('covers the full UV square', () => {
    expect(uvRange(sphere)).toEqual({ minU: 0, maxU: 1, minV: 0, maxV: 1 })
  })

  it('has outward unit normals', () => {
    const pos = sphere.getAttribute('position')
    const normal = sphere.getAttribute('normal')
    for (const i of [0, 17, 123, pos.count - 1]) {
      const n = new THREE.Vector3().fromBufferAttribute(normal, i)
      const p = new THREE.Vector3().fromBufferAttribute(pos, i)
      expect(n.length()).toBeCloseTo(1, 6)
      expect(n.dot(p.normalize())).toBeCloseTo(1, 6)
    }
  })

  it('scales to the requested radius (pin head is r 0.12)', () => {
    const head = zSphereGeometry(0.12, 16, 8)
    head.computeBoundingSphere()
    expect(head.boundingSphere!.radius).toBeCloseTo(0.12, 6)
  })
})

describe('zTubeGeometry', () => {
  it('spans ±height/2 on Z with v 0 at the bottom and 1 at the top', () => {
    const cyl = zTubeGeometry(1, 1, 2, { slices: 16 })
    expect(uvNearest(cyl, 1, 0, -1)[1]).toBeCloseTo(0, 6)
    expect(uvNearest(cyl, 1, 0, 1)[1]).toBeCloseTo(1, 6)
  })

  it('shares the sphere’s longitude convention, so textures wrap alike', () => {
    const cyl = zTubeGeometry(1, 1, 2, { slices: 16 })
    expect(uvNearest(cyl, -1, 0, 0)[0]).toBeCloseTo(0, 6) // −X
    expect(uvNearest(cyl, 1, 0, 0)[0]).toBeCloseTo(0.5, 6) // +X
    expect(uvNearest(cyl, 0, 1, 0)[0]).toBeCloseTo(0.75, 6) // +Y
  })

  it('tilts cone normals with the slope instead of pointing straight out', () => {
    const cone = zTubeGeometry(1, 0, 2, { slices: 16, capBottom: true })
    const normal = cone.getAttribute('normal')
    const pos = cone.getAttribute('position')
    // Find a side vertex on +X at the base; its normal leans +Z for a cone.
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getX(i) - 1) < 1e-9 && Math.abs(pos.getZ(i) + 1) < 1e-9) {
        const n = new THREE.Vector3().fromBufferAttribute(normal, i)
        if (n.z === 0) continue // the cap ring shares this position
        expect(n.length()).toBeCloseTo(1, 6)
        expect(n.z).toBeGreaterThan(0)
        expect(n.x).toBeGreaterThan(0)
        return
      }
    }
    throw new Error('no side vertex found')
  })

  it('maps caps as a disc inscribed in the UV square, like gluDisk', () => {
    const cyl = zTubeGeometry(1, 1, 2, { slices: 16, capTop: true })
    const pos = cyl.getAttribute('position')
    const uv = cyl.getAttribute('uv')
    const normal = cyl.getAttribute('normal')
    // Cap centre.
    for (let i = 0; i < pos.count; i++) {
      if (normal.getZ(i) === 1 && pos.getX(i) === 0 && pos.getY(i) === 0) {
        expect([uv.getX(i), uv.getY(i)]).toEqual([0.5, 0.5])
        break
      }
    }
    // (r,0) → (1, 0.5) on the top cap.
    for (let i = 0; i < pos.count; i++) {
      if (normal.getZ(i) === 1 && Math.abs(pos.getX(i) - 1) < 1e-9 && Math.abs(pos.getY(i)) < 1e-9) {
        expect(uv.getX(i)).toBeCloseTo(1, 6)
        expect(uv.getY(i)).toBeCloseTo(0.5, 6)
        return
      }
    }
    throw new Error('no cap rim vertex found')
  })

  it('omits a cap at a zero-radius end (a cone has no top)', () => {
    const cone = zTubeGeometry(1, 0, 2, { slices: 16, capBottom: true, capTop: true })
    const normal = cone.getAttribute('normal')
    let upFacingFlat = 0
    for (let i = 0; i < normal.count; i++) {
      if (normal.getZ(i) === 1 && normal.getX(i) === 0 && normal.getY(i) === 0) upFacingFlat++
    }
    expect(upFacingFlat).toBe(0)
  })
})

describe('applyPerFaceUV', () => {
  it('gives each triangular face the whole image', () => {
    const tetra = applyPerFaceUV(new THREE.TetrahedronGeometry(1))
    const uv = tetra.getAttribute('uv')
    expect(uv.count).toBe(12) // 4 faces × 3 vertices, non-indexed
    for (let face = 0; face < 4; face++) {
      let minU = Infinity
      let maxU = -Infinity
      let minV = Infinity
      let maxV = -Infinity
      for (let k = 0; k < 3; k++) {
        const i = face * 3 + k
        minU = Math.min(minU, uv.getX(i))
        maxU = Math.max(maxU, uv.getX(i))
        minV = Math.min(minV, uv.getY(i))
        maxV = Math.max(maxV, uv.getY(i))
      }
      expect(maxU - minU).toBeCloseTo(1, 6)
      expect(maxV - minV).toBeCloseTo(1, 6)
    }
  })

  it('treats a dodecahedron pentagon as ONE face, not three triangles', () => {
    // Three triangulates each pentagon; grouping by plane keeps them together,
    // so the image appears once per pentagon rather than three times.
    const dodeca = applyPerFaceUV(new THREE.DodecahedronGeometry(1))
    const uv = dodeca.getAttribute('uv')
    // A per-triangle unwrap would put a 0 and a 1 in EVERY triangle; a
    // per-pentagon one leaves most triangles spanning only part of the square.
    let trianglesSpanningFullU = 0
    for (let t = 0; t < uv.count / 3; t++) {
      let minU = Infinity
      let maxU = -Infinity
      for (let k = 0; k < 3; k++) {
        minU = Math.min(minU, uv.getX(t * 3 + k))
        maxU = Math.max(maxU, uv.getX(t * 3 + k))
      }
      if (maxU - minU > 0.99) trianglesSpanningFullU++
    }
    expect(trianglesSpanningFullU).toBeLessThan(uv.count / 3)
  })

  it('orients faces consistently against world +Z', () => {
    // The +Z-facing and −Z-facing faces of an octahedron fall back to the +X
    // axis; the others take their "up" from world +Z. Either way every face
    // fills the square exactly once.
    const octa = applyPerFaceUV(new THREE.OctahedronGeometry(1))
    const { minU, maxU, minV, maxV } = uvRange(octa)
    expect([minU, maxU, minV, maxV]).toEqual([0, 1, 0, 1])
  })
})

describe('fitPlanarUV', () => {
  it('stretches a ±1 outline’s bounding box across the UV square', () => {
    const geo = new THREE.PlaneGeometry(2, 2)
    geo.getAttribute('uv').setXY(0, -1, -1) // pretend Three gave world uvs
    expect(uvRange(fitPlanarUV(geo))).toEqual({ minU: 0, maxU: 1, minV: 0, maxV: 1 })
  })

  it('keeps the mapping axis-aligned: +x → u, +y → v', () => {
    const geo = fitPlanarUV(new THREE.PlaneGeometry(2, 2))
    expect(uvNearest(geo, -1, -1, 0)).toEqual([0, 0])
    expect(uvNearest(geo, 1, 1, 0)).toEqual([1, 1])
  })
})

describe('every textured glyph carries usable UVs', () => {
  // Wire glyphs and Points are never textured (the desktop's _WIRE_IDS guard),
  // so this is the set of solids a texture_id can actually land on.
  const SOLIDS = [
    Geometry.CubeSolid,
    Geometry.SphereSolid,
    Geometry.ConeSolid,
    Geometry.DodecahedronSolid,
    Geometry.OctahedronSolid,
    Geometry.TetrahedronSolid,
    Geometry.IcosahedronSolid,
    Geometry.CylinderSolid,
    Geometry.GridSolid,
    Geometry.Circle,
    Geometry.Cross,
    Geometry.Star,
    Geometry.TorusSolid,
    Geometry.PinSolid,
  ]

  const style = { color: new THREE.Color(1, 1, 1), opacity: 1, ratio: 0.1 }

  for (const id of SOLIDS) {
    it(`geometry ${id} has UVs inside 0–1`, () => {
      const object = createGlyphObject(id, style)
      expect(object).not.toBeNull()

      const meshes: THREE.Mesh[] = []
      object!.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) meshes.push(child as THREE.Mesh)
      })
      expect(meshes.length).toBeGreaterThan(0)

      for (const mesh of meshes) {
        const uv = mesh.geometry.getAttribute('uv')
        expect(uv, `geometry ${id} has no uv attribute`).toBeDefined()
        const { minU, maxU, minV, maxV } = uvRange(mesh.geometry)
        // Outside 0–1 the REPEAT wrap tiles the image — never what's wanted
        // for a glyph (Three's ShapeGeometry emits raw ±1 coordinates).
        expect(minU).toBeGreaterThanOrEqual(-1e-6)
        expect(maxU).toBeLessThanOrEqual(1 + 1e-6)
        expect(minV).toBeGreaterThanOrEqual(-1e-6)
        expect(maxV).toBeLessThanOrEqual(1 + 1e-6)
        // …and it must actually span the image, not collapse to a point.
        expect(maxU - minU).toBeGreaterThan(0.5)
        expect(maxV - minV).toBeGreaterThan(0.5)
      }
    })
  }
})
