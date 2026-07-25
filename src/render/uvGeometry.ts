// Z-up primitives with deliberate UV layouts.
//
// Three's built-in Sphere/Cylinder/Cone are Y-up and carry UV conventions that
// don't survive the rotation into GlyphViz's Z-up world, so the round shapes
// are built here instead. One convention across every curved surface — glyph
// sphere, cone, cylinder, pin, and the World Grid globe:
//
//   u = (lon + 180) / 360   — 0 at lon −180 (−X), increasing eastward
//   v = (lat +  90) / 180   — 0 at the south pole (−Z), increasing northward
//
// That is standard equirectangular mapping: an ordinary lon/lat map image
// lands where a reader expects it, and the same texture wraps a sphere, a
// cylinder and a cone the same way round.
//
// It is a deliberate improvement on the desktop, not an oversight. GLU's
// quadric mapping (which the desktop gets from gluQuadricTexture) puts s=0 at
// +Y and runs it *backwards* — 0.25 at +X, 0.5 at −Y — so any map drawn on a
// gluSphere comes out mirrored and rotated a quarter turn. The desktop already
// rejected that mapping where it mattered: _draw_world_grid hand-builds its
// globe with exactly the convention above, noting gluSphere is "offset AND
// mirrored in longitude relative to KML". This module simply applies the
// desktop's own better answer to every round glyph.
//
// Caps follow gluDisk, which Three's CircleGeometry already matches: the disc
// is inscribed in the UV square, (r,0) → (1, 0.5) and (0,r) → (0.5, 1).

import * as THREE from 'three'

const TAU = Math.PI * 2

function buildGeometry(
  positions: number[],
  normals: number[],
  uvs: number[],
  indices: number[],
): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  return geo
}

/**
 * Sphere with poles on ±Z and equirectangular UVs.
 *
 * The seam at lon ±180 is a duplicated column of vertices (i = 0 and
 * i = slices share a position but carry u = 0 and u = 1), so the texture
 * closes instead of smearing the whole image back across the last band.
 */
export function zSphereGeometry(radius = 1, slices = 48, stacks = 24): THREE.BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  for (let j = 0; j <= stacks; j++) {
    const v = j / stacks
    const lat = (v - 0.5) * Math.PI
    const cosLat = Math.cos(lat)
    const sinLat = Math.sin(lat)
    for (let i = 0; i <= slices; i++) {
      const u = i / slices
      const lon = (u - 0.5) * TAU
      const nx = cosLat * Math.cos(lon)
      const ny = cosLat * Math.sin(lon)
      const nz = sinLat
      positions.push(radius * nx, radius * ny, radius * nz)
      normals.push(nx, ny, nz)
      uvs.push(u, v)
    }
  }

  const stride = slices + 1
  for (let j = 0; j < stacks; j++) {
    for (let i = 0; i < slices; i++) {
      const a = j * stride + i
      const b = a + stride
      // Pole rows collapse to a point: emit one triangle there, not two.
      if (j !== 0) indices.push(a, b, a + 1)
      if (j !== stacks - 1) indices.push(b, b + 1, a + 1)
    }
  }
  return buildGeometry(positions, normals, uvs, indices)
}

export interface TubeOptions {
  /** Cap the −Z end (gluDisk, mirrored in v so it reads right from below). */
  capBottom?: boolean
  /** Cap the +Z end. */
  capTop?: boolean
  slices?: number
}

/**
 * Cone/cylinder/frustum around the Z axis, centred on the origin.
 *
 * `radiusTop = 0` gives a cone; equal radii give a cylinder; the pin's needle
 * is a frustum. Side UVs use the module's shared convention (u eastward from
 * −X, v from 0 at −Z to 1 at +Z), matching gluCylinder's own t direction.
 */
export function zTubeGeometry(
  radiusBottom: number,
  radiusTop: number,
  height: number,
  options: TubeOptions = {},
): THREE.BufferGeometry {
  const slices = options.slices ?? 32
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  const halfH = height / 2
  // Side normal: perpendicular to the profile line (radiusBottom,−h/2) →
  // (radiusTop,+h/2), so a cone's normals tilt with its slope.
  const slopeZ = radiusBottom - radiusTop
  const slopeLen = Math.hypot(height, slopeZ) || 1

  for (let ring = 0; ring < 2; ring++) {
    const v = ring // 0 = bottom, 1 = top
    const radius = ring === 0 ? radiusBottom : radiusTop
    const z = ring === 0 ? -halfH : halfH
    for (let i = 0; i <= slices; i++) {
      const u = i / slices
      const lon = (u - 0.5) * TAU
      const cos = Math.cos(lon)
      const sin = Math.sin(lon)
      positions.push(radius * cos, radius * sin, z)
      normals.push((height * cos) / slopeLen, (height * sin) / slopeLen, slopeZ / slopeLen)
      uvs.push(u, v)
    }
  }

  const stride = slices + 1
  for (let i = 0; i < slices; i++) {
    const a = i
    const b = stride + i
    // A tip ring (radius 0) collapses, so only one triangle is meaningful.
    if (radiusBottom > 0) indices.push(a, a + 1, b)
    if (radiusTop > 0) indices.push(a + 1, b + 1, b)
  }

  const addCap = (top: boolean) => {
    const radius = top ? radiusTop : radiusBottom
    if (radius <= 0) return
    const z = top ? halfH : -halfH
    const center = positions.length / 3
    positions.push(0, 0, z)
    normals.push(0, 0, top ? 1 : -1)
    uvs.push(0.5, 0.5)
    for (let i = 0; i <= slices; i++) {
      const lon = (i / slices - 0.5) * TAU
      const cos = Math.cos(lon)
      const sin = Math.sin(lon)
      positions.push(radius * cos, radius * sin, z)
      normals.push(0, 0, top ? 1 : -1)
      // gluDisk's disc-in-a-square mapping; the bottom cap mirrors v, the way
      // the desktop's 180° flip about X leaves it.
      uvs.push((cos + 1) / 2, ((top ? sin : -sin) + 1) / 2)
    }
    for (let i = 0; i < slices; i++) {
      const a = center + 1 + i
      if (top) indices.push(center, a, a + 1)
      else indices.push(center, a + 1, a)
    }
  }
  if (options.capBottom) addCap(false)
  if (options.capTop) addCap(true)

  return buildGeometry(positions, normals, uvs, indices)
}

/**
 * Give every flat face of a solid the whole texture, 0–1.
 *
 * Triangles are grouped by the plane they lie in, so a dodecahedron's
 * pentagons — which arrive from Three as three loose triangles each — take one
 * image per pentagon rather than three. Each face is then projected onto its
 * own plane and its bounding box stretched across the UV square, with the face
 * "up" axis derived from world +Z so neighbouring faces read the same way up.
 *
 * This is the mapping the desktop already uses for the cube (_CUBE_UVS),
 * extended to the other flat-faced solids. It replaces the spherical _vert_uv
 * projection the desktop applies to them, which wraps one image around the
 * whole solid — on a tetrahedron that means a narrow stretched band, since
 * four vertices sample barely a third of the image's height. Jeff's call,
 * 2026-07-25.
 */
export function applyPerFaceUV(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const source = geometry.index ? geometry.toNonIndexed() : geometry
  const position = source.getAttribute('position')
  const triangleCount = position.count / 3

  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const normal = new THREE.Vector3()

  // Group triangle indices by the plane they sit in: quantised normal plus
  // signed distance, so coplanar-but-parallel faces stay separate.
  const faces = new Map<string, number[]>()
  const normals: THREE.Vector3[] = []
  for (let t = 0; t < triangleCount; t++) {
    a.fromBufferAttribute(position, t * 3)
    b.fromBufferAttribute(position, t * 3 + 1)
    c.fromBufferAttribute(position, t * 3 + 2)
    normal.copy(c).sub(b).cross(a.clone().sub(b)).normalize()
    const distance = normal.dot(a)
    const key = `${normal.x.toFixed(4)},${normal.y.toFixed(4)},${normal.z.toFixed(4)},${distance.toFixed(4)}`
    const group = faces.get(key)
    if (group) group.push(t)
    else {
      faces.set(key, [t])
      normals.push(normal.clone())
    }
  }

  const uvs = new Float32Array(position.count * 2)
  const uAxis = new THREE.Vector3()
  const vAxis = new THREE.Vector3()
  const point = new THREE.Vector3()
  const worldUp = new THREE.Vector3(0, 0, 1)

  let faceIndex = 0
  for (const group of faces.values()) {
    const faceNormal = normals[faceIndex++]
    // Face-local axes: u across, v "up" relative to world +Z. A face that
    // faces straight up or down has no such up, so fall back to +X.
    uAxis.crossVectors(worldUp, faceNormal)
    if (uAxis.lengthSq() < 1e-12) uAxis.set(1, 0, 0)
    uAxis.normalize()
    vAxis.crossVectors(faceNormal, uAxis).normalize()

    let minU = Infinity
    let maxU = -Infinity
    let minV = Infinity
    let maxV = -Infinity
    const projected: Array<[number, number]> = []
    for (const t of group) {
      for (let k = 0; k < 3; k++) {
        point.fromBufferAttribute(position, t * 3 + k)
        const u = point.dot(uAxis)
        const v = point.dot(vAxis)
        projected.push([u, v])
        minU = Math.min(minU, u)
        maxU = Math.max(maxU, u)
        minV = Math.min(minV, v)
        maxV = Math.max(maxV, v)
      }
    }
    const spanU = maxU - minU || 1
    const spanV = maxV - minV || 1

    let p = 0
    for (const t of group) {
      for (let k = 0; k < 3; k++) {
        const [u, v] = projected[p++]
        const slot = (t * 3 + k) * 2
        uvs[slot] = (u - minU) / spanU
        uvs[slot + 1] = (v - minV) / spanV
      }
    }
  }

  source.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  return source
}

/**
 * Rewrite a flat XY shape's UVs so its bounding box fills 0–1.
 *
 * Three's ShapeGeometry emits raw vertex coordinates as UVs ("world uvs"),
 * which for a glyph built in ±1 units means the texture tiles four times and
 * wraps. The desktop is no better — Circle, Star and Cross emit no texture
 * coordinates at all, so a textured one there samples a single stale texel.
 * Filling the bounding box is the useful answer for both.
 */
export function fitPlanarUV(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const position = geometry.getAttribute('position')
  geometry.computeBoundingBox()
  const box = geometry.boundingBox!
  const spanX = box.max.x - box.min.x || 1
  const spanY = box.max.y - box.min.y || 1

  const uvs = new Float32Array(position.count * 2)
  for (let i = 0; i < position.count; i++) {
    uvs[i * 2] = (position.getX(i) - box.min.x) / spanX
    uvs[i * 2 + 1] = (position.getY(i) - box.min.y) / spanY
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  return geometry
}
