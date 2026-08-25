import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  applyPerFaceUV,
  fitPlanarUV,
  mirroredGeometry,
  zCubeInteriorGeometry,
  zPinGeometry,
  zSphereGeometry,
  zTubeGeometry,
} from './uvGeometry'
import { PIN_HEIGHT, PIN_RADIUS, createGlyphObject } from './glyphGeometry'
import { topoOffset } from './topology'
import { Geometry, Topo } from '../gv/types'

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

/**
 * Fraction of triangles wound counter-clockwise seen from outside — i.e. whose
 * geometric normal agrees with the vertex normals the builder emitted.
 *
 * This is what backface culling reads. A shape wound the other way round still
 * lights correctly (the normals it carries are right), so it looks plausible
 * in isolation and only gives itself away as a dark silhouette that things
 * pass straight through — which is exactly how an inverted sphere shipped
 * unnoticed until Jeff spotted a plot line drawing over one (2026-07-26).
 */
function outwardWoundFraction(geo: THREE.BufferGeometry): number {
  const pos = geo.getAttribute('position')
  const normal = geo.getAttribute('normal')
  const index = geo.getIndex()
  const at = (i: number) => new THREE.Vector3().fromBufferAttribute(pos, i)
  let outward = 0
  let counted = 0
  const count = index ? index.count : pos.count
  for (let t = 0; t < count; t += 3) {
    const [i0, i1, i2] = index
      ? [index.getX(t), index.getX(t + 1), index.getX(t + 2)]
      : [t, t + 1, t + 2]
    const v0 = at(i0)
    const face = at(i1).sub(v0).cross(at(i2).sub(v0))
    if (face.lengthSq() < 1e-18) continue // degenerate (pole fans)
    const outwardRef = new THREE.Vector3()
      .fromBufferAttribute(normal, i0)
      .add(new THREE.Vector3().fromBufferAttribute(normal, i1))
      .add(new THREE.Vector3().fromBufferAttribute(normal, i2))
    counted++
    if (face.dot(outwardRef) > 0) outward++
  }
  return counted === 0 ? 0 : outward / counted
}

describe('triangle winding', () => {
  // Every solid renders FrontSide (the desktop's paintGL runs with
  // GL_CULL_FACE on), so a back-to-front shape is invisible from outside.
  it('winds every round primitive outward', () => {
    expect(outwardWoundFraction(zSphereGeometry(1, 32, 16))).toBe(1)
    expect(outwardWoundFraction(zTubeGeometry(1, 0, 2, { capBottom: true }))).toBe(1)
    expect(
      outwardWoundFraction(zTubeGeometry(1, 1, 2, { capBottom: true, capTop: true })),
    ).toBe(1)
    expect(outwardWoundFraction(zPinGeometry(PIN_HEIGHT, PIN_RADIUS))).toBe(1)
  })

  it('agrees with Three’s own primitives, so the check itself is sound', () => {
    expect(outwardWoundFraction(new THREE.SphereGeometry(1, 16, 8))).toBe(1)
    expect(outwardWoundFraction(new THREE.BoxGeometry(1, 1, 1))).toBe(1)
  })
})

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

  it('scales to the requested radius', () => {
    const small = zSphereGeometry(0.12, 16, 8)
    small.computeBoundingSphere()
    expect(small.boundingSphere!.radius).toBeCloseTo(0.12, 6)
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

describe('zPinGeometry', () => {
  // ANTz's DrawPinDL shape (desktop 979b9db). What this replaces was a sphere
  // floating above an uncapped frustum, open at both ends and hanging BELOW
  // the node origin, so every assertion here is one of the two defects.
  const pin = zPinGeometry(PIN_HEIGHT, PIN_RADIUS)
  const TOP = PIN_HEIGHT + PIN_RADIUS
  /** Buffer attributes are Float32, so hand-computed doubles agree to ~1e-7. */
  const F32 = 1e-6
  const each = (fn: (p: THREE.Vector3, n: THREE.Vector3, i: number) => void) => {
    const pos = pin.getAttribute('position')
    const normal = pin.getAttribute('normal')
    for (let i = 0; i < pos.count; i++) {
      fn(
        new THREE.Vector3().fromBufferAttribute(pos, i),
        new THREE.Vector3().fromBufferAttribute(normal, i),
        i,
      )
    }
  }
  /** Is this point within the closed solid (cone below the rim, dome above)? */
  const inside = (p: THREE.Vector3, slack: number) => {
    const rad = Math.hypot(p.x, p.y)
    if (p.z < -slack) return false
    if (p.z <= PIN_HEIGHT) return rad <= (PIN_RADIUS * p.z) / PIN_HEIGHT + slack
    return Math.hypot(rad, p.z - PIN_HEIGHT) <= PIN_RADIUS + slack
  }

  it('stands on its apex at the node origin, shaft along +Z', () => {
    // The load-bearing half of the rebuild: Topo.Pin places children at
    // B + translate_x on +Z, so the shaft has to BE the +Z half of the glyph.
    let minZ = Infinity
    let maxZ = -Infinity
    each((p) => {
      minZ = Math.min(minZ, p.z)
      maxZ = Math.max(maxZ, p.z)
    })
    expect(minZ).toBeCloseTo(0, 6)
    expect(maxZ).toBeCloseTo(TOP, 6)
  })

  it('agrees with where Topo.Pin puts its children', () => {
    // The cross-module check: the glyph and the placement math are two halves
    // of one convention, and drifted apart for as long as the pin hung below
    // its origin. tx = 0 is the dome's centre; tx = −B is the tip.
    const place = (tx: number) =>
      topoOffset({ parentTopo: Topo.Pin, tx, ty: 0, tz: 0, parentRatio: 0.1, subspace: 0, baseScale: 1 })
    expect(place(0).z).toBeCloseTo(PIN_HEIGHT, 9)
    expect(place(-1).z).toBeCloseTo(0, 9)
  })

  it('comes to a true point: nothing at the bottom but the apex itself', () => {
    // gluCylinder draws a lateral surface and never end caps, so the old
    // needle stopped at radius 0.03 and was left open — a hole you could see
    // straight up into the glyph through.
    each((p) => {
      if (p.z < F32) expect(Math.hypot(p.x, p.y)).toBeCloseTo(0, 6)
    })
  })

  it('closes the cone with the dome’s own rim, so the join is watertight', () => {
    // The old ball's south pole was level with the rim, leaving the rim itself
    // an open annulus around a point. Here they are the same circle.
    let rimCount = 0
    each((p) => {
      if (Math.abs(p.z - PIN_HEIGHT) < F32) {
        expect(Math.hypot(p.x, p.y)).toBeCloseTo(PIN_RADIUS, 6)
        rimCount++
      }
    })
    // Twice round: the crease carries the cone's normal and the dome's.
    expect(rimCount).toBe(2 * (32 + 1))
  })

  it('creases at the rim instead of averaging one normal across the join', () => {
    const normals = new Set<string>()
    each((p, n) => {
      if (Math.abs(p.z - PIN_HEIGHT) < F32 && Math.abs(p.y) < F32 && p.x > 0) {
        normals.add(`${n.x.toFixed(6)},${n.z.toFixed(6)}`)
      }
    })
    const slope = Math.hypot(PIN_HEIGHT, PIN_RADIUS)
    expect([...normals].sort()).toEqual(
      [
        `${(PIN_HEIGHT / slope).toFixed(6)},${(-PIN_RADIUS / slope).toFixed(6)}`, // cone: out and DOWN
        `${(1).toFixed(6)},${(0).toFixed(6)}`, // dome: straight out
      ].sort(),
    )
  })

  it('draws only the upper hemisphere — every vertex is on the real surface', () => {
    // A full ball would put vertices inside the cone's z range at radii the
    // cone never reaches there, and they could never be seen from outside.
    each((p) => {
      const rad = Math.hypot(p.x, p.y)
      const onCone = p.z <= PIN_HEIGHT + F32 && Math.abs(rad - (PIN_RADIUS * p.z) / PIN_HEIGHT) < F32
      const onDome =
        p.z >= PIN_HEIGHT - F32 && Math.abs(Math.hypot(rad, p.z - PIN_HEIGHT) - PIN_RADIUS) < F32
      expect(onCone || onDome, `vertex ${p.toArray()} is off the pin surface`).toBe(true)
    })
  })

  it('faces every normal out of the solid', () => {
    const eps = 1e-4
    each((p, n) => {
      expect(n.length()).toBeCloseTo(1, 6)
      if (p.z < F32) return // the apex: every direction is an edge
      expect(inside(p.clone().addScaledVector(n, eps), -eps * 0.1)).toBe(false)
      expect(inside(p.clone().addScaledVector(n, -eps), eps * 0.1)).toBe(true)
    })
  })

  it('runs one continuous v from the tip to the pole, u round the axis', () => {
    // Two separately-mapped primitives could not do this: an image drawn on
    // the pin runs unbroken across the cone/dome junction.
    const uv = pin.getAttribute('uv')
    each((p, _n, i) => {
      expect(uv.getY(i)).toBeCloseTo(p.z / TOP, 6)
    })
    expect(uvRange(pin)).toEqual({ minU: 0, maxU: 1, minV: 0, maxV: 1 })
    // …and the same longitude convention as the sphere and cylinder.
    expect(uvNearest(pin, -PIN_RADIUS, 0, PIN_HEIGHT)[0]).toBeCloseTo(0, 6) // −X
    expect(uvNearest(pin, PIN_RADIUS, 0, PIN_HEIGHT)[0]).toBeCloseTo(0.5, 6) // +X
    expect(uvNearest(pin, 0, PIN_RADIUS, PIN_HEIGHT)[0]).toBeCloseTo(0.75, 6) // +Y
  })

  it('emits no faces for the zero-height crease band', () => {
    // 32 slices: the cone contributes one triangle per slice (its lower ring
    // is a point) and each of the 8 dome bands two, less the pole band's one.
    const index = pin.getIndex()!
    expect(index.count / 3).toBe(32 * (1 + 2 * 8 - 1))
  })
})

// --- Interior geometries -----------------------------------------------------

/**
 * Walk a geometry's triangles, handing each one its three positions and UVs.
 * Skips degenerate faces (the pole fans of a sphere).
 */
function eachTriangle(
  geo: THREE.BufferGeometry,
  visit: (p: THREE.Vector3[], uv: THREE.Vector2[]) => void,
): number {
  const pos = geo.getAttribute('position')
  const uvAttr = geo.getAttribute('uv') as THREE.BufferAttribute
  const index = geo.getIndex()
  const count = index ? index.count : pos.count
  let visited = 0
  for (let t = 0; t < count; t += 3) {
    const ids = index
      ? [index.getX(t), index.getX(t + 1), index.getX(t + 2)]
      : [t, t + 1, t + 2]
    const p = ids.map((i) => new THREE.Vector3().fromBufferAttribute(pos, i))
    const e1 = p[1].clone().sub(p[0])
    const e2 = p[2].clone().sub(p[0])
    if (e1.clone().cross(e2).lengthSq() < 1e-18) continue
    const uv = ids.map((i) => new THREE.Vector2().fromBufferAttribute(uvAttr, i))
    visited++
    visit(p, uv)
  }
  return visited
}

/** Reference "outward" at a triangle: away from the origin, every glyph being
 *  built centred on it. Deliberately geometric rather than the emitted vertex
 *  normals, which the mirror leaves pointing outward on a sphere and the cube
 *  builder writes pointing inward — the two would disagree. */
function centroid(p: THREE.Vector3[]): THREE.Vector3 {
  return p[0].clone().add(p[1]).add(p[2]).divideScalar(3)
}

/** Fraction of faces whose GEOMETRIC normal points at the origin — i.e. whose
 *  winding survives FrontSide culling only when seen from inside. */
function inwardWoundFraction(geo: THREE.BufferGeometry): number {
  let inward = 0
  const counted = eachTriangle(geo, (p) => {
    const face = p[1].clone().sub(p[0]).cross(p[2].clone().sub(p[0]))
    if (face.dot(centroid(p)) < 0) inward++
  })
  return counted === 0 ? 0 : inward / counted
}

/**
 * Fraction of faces whose TEXTURE reads forwards from inside — "not mirrored"
 * stated without pixels.
 *
 * The u and v directions on the surface are recovered from the UVs
 * (T = ∂p/∂u, B = ∂p/∂v); T × B then points along the side the image reads
 * correctly from. Pointing at the origin means a viewer inside sees u to their
 * right and v upward, which is the whole feature — merely dropping back-face
 * culling would leave this pointing the other way and play every video
 * backwards.
 */
function inwardReadingFraction(geo: THREE.BufferGeometry): number {
  let inward = 0
  const counted = eachTriangle(geo, (p, uv) => {
    const e1 = p[1].clone().sub(p[0])
    const e2 = p[2].clone().sub(p[0])
    const d1 = uv[1].clone().sub(uv[0])
    const d2 = uv[2].clone().sub(uv[0])
    const det = d1.x * d2.y - d2.x * d1.y
    if (Math.abs(det) < 1e-12) return // a face whose UVs collapse says nothing
    const tangent = e1.clone().multiplyScalar(d2.y).addScaledVector(e2, -d1.y).divideScalar(det)
    const bitangent = e2.clone().multiplyScalar(d1.x).addScaledVector(e1, -d2.x).divideScalar(det)
    if (tangent.cross(bitangent).dot(centroid(p)) < 0) inward++
  })
  return counted === 0 ? 0 : inward / counted
}

describe('interior geometries', () => {
  const interiors: [string, THREE.BufferGeometry][] = [
    ['cube', zCubeInteriorGeometry(1 / Math.sqrt(3))],
    ['sphere', mirroredGeometry(zSphereGeometry(1, 32, 16))],
    ['cylinder', mirroredGeometry(zTubeGeometry(1, 1, 2, { slices: 32, capBottom: true, capTop: true }))],
    ['open cylinder', mirroredGeometry(zTubeGeometry(1, 1, 2, { slices: 32 }))],
  ]

  for (const [name, geo] of interiors) {
    it(`${name}: every face's normal points at the origin`, () => {
      expect(inwardWoundFraction(geo)).toBe(1)
    })

    it(`${name}: every face's texture reads forwards from inside`, () => {
      expect(inwardReadingFraction(geo)).toBe(1)
    })
  }

  // The control on both checks: the exterior twins come out the other way
  // round. Without this the assertions above could be satisfied by a test that
  // simply had its sign backwards — and the UV one is the contrast that
  // back-face culling alone cannot produce.
  it('the exterior twins score the opposite on both checks', () => {
    const exteriors = [
      new THREE.BoxGeometry(2 / Math.sqrt(3), 2 / Math.sqrt(3), 2 / Math.sqrt(3)),
      zSphereGeometry(1, 32, 16),
      zTubeGeometry(1, 1, 2, { slices: 32, capBottom: true, capTop: true }),
    ]
    for (const geo of exteriors) {
      expect(inwardWoundFraction(geo)).toBe(0)
      expect(inwardReadingFraction(geo)).toBe(0)
    }
  })

  it('mirrors through x = 0 and leaves the shape’s extent alone', () => {
    const geo = mirroredGeometry(zSphereGeometry(1, 8, 4))
    geo.computeBoundingBox()
    const box = geo.boundingBox!
    expect(box.min.x).toBeCloseTo(-1, 6)
    expect(box.max.x).toBeCloseTo(1, 6)
    // Normals survive the reflection still pointing OUTWARD — which is why
    // interiors draw unlit rather than being lit off flipped normals.
    const pos = geo.getAttribute('position')
    const normal = geo.getAttribute('normal')
    for (let i = 0; i < pos.count; i++) {
      const p = new THREE.Vector3().fromBufferAttribute(pos, i)
      if (p.lengthSq() < 1e-12) continue
      const n = new THREE.Vector3().fromBufferAttribute(normal, i)
      expect(n.dot(p)).toBeGreaterThan(0)
    }
  })

  describe('the cube, which cannot be built by mirroring', () => {
    const cube = zCubeInteriorGeometry(1 / Math.sqrt(3))

    it('is six quads', () => {
      expect(cube.getIndex()!.count).toBe(6 * 6) // six faces, two triangles each
      expect(cube.getAttribute('position').count).toBe(6 * 4)
    })

    it('faces the six axis directions, inward', () => {
      const normal = cube.getAttribute('normal')
      const seen = new Set<string>()
      for (let i = 0; i < normal.count; i++) {
        const n = [normal.getX(i), normal.getY(i), normal.getZ(i)]
        expect(Math.abs(n[0]) + Math.abs(n[1]) + Math.abs(n[2])).toBeCloseTo(1, 6)
        seen.add(n.join(','))
      }
      expect(seen.size).toBe(6)
    })

    it('maps the whole texture onto every face', () => {
      const uv = cube.getAttribute('uv')
      for (let face = 0; face < 6; face++) {
        const corners = new Set<string>()
        for (let k = 0; k < 4; k++) {
          const i = face * 4 + k
          corners.add(`${uv.getX(i)},${uv.getY(i)}`)
        }
        expect(corners).toEqual(new Set(['0,0', '1,0', '1,1', '0,1']))
      }
    })

    /**
     * The walls stand upright and the floor and ceiling take OPPOSITE y — the
     * one asymmetry in the face table, and not a typo. A face has an intrinsic
     * up only if it is a wall; for the two horizontal faces "upright" is
     * whatever the camera says, and the two cameras that look at them disagree
     * — an orbit camera looking down has screen-up pointing away from its
     * azimuth and one looking up has it pointing along. Same y on both would
     * leave one of the two 180° round from the other; which of the two takes
     * +Y was measured on the desktop against a real render and is ported
     * verbatim.
     */
    it('stands the walls upright and opposes the floor and the ceiling', () => {
      const uv = cube.getAttribute('uv')
      const pos = cube.getAttribute('position')
      const vDirection = (face: number) => {
        // p00 → p01 is the +v edge (the UV table's own corner order).
        expect([uv.getX(face * 4), uv.getY(face * 4)]).toEqual([0, 0])
        expect([uv.getX(face * 4 + 3), uv.getY(face * 4 + 3)]).toEqual([0, 1])
        const a = new THREE.Vector3().fromBufferAttribute(pos, face * 4)
        const b = new THREE.Vector3().fromBufferAttribute(pos, face * 4 + 3)
        return b.sub(a).normalize()
      }
      // Faces 0–3 are the walls: v runs up the world.
      for (const face of [0, 1, 2, 3]) {
        expect(vDirection(face).toArray().map(Math.round)).toEqual([0, 0, 1])
      }
      // Ceiling then floor, opposed.
      expect(vDirection(4).toArray().map(Math.round)).toEqual([0, 1, 0])
      expect(vDirection(5).toArray().map(Math.round)).toEqual([0, -1, 0])
    })

    it('occupies the same corners as the exterior cube', () => {
      const half = 1 / Math.sqrt(3)
      cube.computeBoundingBox()
      const box = cube.boundingBox!
      for (const axis of ['x', 'y', 'z'] as const) {
        expect(box.min[axis]).toBeCloseTo(-half, 6)
        expect(box.max[axis]).toBeCloseTo(half, 6)
      }
    })
  })

  it('the open cylinder emits no cap geometry, and the capped one two', () => {
    const slices = 32
    const side = 2 * (slices + 1)
    const open = zTubeGeometry(1, 1, 2, { slices })
    const capped = zTubeGeometry(1, 1, 2, { slices, capBottom: true, capTop: true })
    expect(open.getAttribute('position').count).toBe(side)
    // Each cap is a centre vertex plus a closed ring.
    expect(capped.getAttribute('position').count).toBe(side + 2 * (slices + 2))
    expect(capped.getIndex()!.count - open.getIndex()!.count).toBe(2 * slices * 3)
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
    // The interior shapes exist to carry an image, so their UVs matter more
    // here than anywhere else.
    Geometry.CubeInterior,
    Geometry.SphereInterior,
    Geometry.CylinderInterior,
    Geometry.CylinderInteriorOpen,
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
