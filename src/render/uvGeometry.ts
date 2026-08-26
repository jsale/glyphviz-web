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
      // Counter-clockwise seen from OUTSIDE, so the front face is the one the
      // camera sees and FrontSide culling keeps it: longitude (i) advances
      // before latitude (j). Wound the other way round, a sphere renders as
      // the INSIDE of its far hemisphere — uniformly dark, since the normals
      // still point outward, and transparent to anything passing behind it.
      // Pole rows collapse to a point: emit one triangle there, not two.
      if (j !== 0) indices.push(a, a + 1, b)
      if (j !== stacks - 1) indices.push(b, a + 1, b + 1)
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

export interface PinOptions {
  slices?: number
  /** Rings from the rim up to the pole on the dome. */
  domeStacks?: number
}

/**
 * ANTz's pushpin: a tall cone standing on its apex at the local ORIGIN, shaft
 * rising along +Z, capped by a dome of the cone's own base radius.
 *
 * Built here rather than from two primitives because that is what closes it.
 * The shape this replaces was a `zSphereGeometry` head floating above an
 * uncapped `zTubeGeometry` frustum — two see-through holes, inherited from the
 * desktop's `_draw_pin`, which unlike `_draw_cone`/`_draw_cylinder` beside it
 * never paid for the gluDisks a `gluCylinder` needs (desktop 979b9db). Here the
 * cone tapers to a genuine apex, so the bottom needs no cap at all, and the
 * dome's rim IS the cone's base circle — same radius, same z — so the junction
 * is watertight with no disc between them.
 *
 * Only the UPPER hemisphere is built: with the ball's equator flush on the rim,
 * the lower half would be sealed inside the cone where nothing can ever see it.
 * The rim therefore appears TWICE, at one position with two normals — the
 * cone's and the dome's — because the surface genuinely creases there
 * (5.7° at the 10:1 default) and one averaged normal would smear the join.
 *
 * UVs keep the module's convention around the axis (u eastward from −X, so the
 * same image wraps a pin the way it wraps a sphere), and run v = 0 at the tip
 * to 1 at the pole — ONE continuous run across cone and dome, which is the
 * other thing two separately-mapped primitives could not give.
 */
export function zPinGeometry(
  height = 1,
  radius = 0.1,
  options: PinOptions = {},
): THREE.BufferGeometry {
  const slices = options.slices ?? 32
  const domeStacks = options.domeStacks ?? 8

  // A ring of the meridian: (radius, z) and the surface normal there as
  // (radial, z) — spun about the axis to give each vertex its own.
  interface Ring {
    r: number
    z: number
    nr: number
    nz: number
  }

  // Outward normal of a cone whose apex is at the origin: the surface widens
  // as it rises, so it faces out AND DOWN. Constant over the whole lateral
  // surface, apex included.
  const slope = Math.hypot(height, radius) || 1
  const coneNr = height / slope
  const coneNz = -radius / slope

  const rings: Ring[] = [
    { r: 0, z: 0, nr: coneNr, nz: coneNz }, // the apex, on the node's origin
    { r: radius, z: height, nr: coneNr, nz: coneNz }, // the rim, cone side
    { r: radius, z: height, nr: 1, nz: 0 }, // the rim again, dome side
  ]
  for (let j = 1; j <= domeStacks; j++) {
    if (j === domeStacks) {
      // The pole, written out rather than left to cos(π/2)'s 6e-17: an
      // almost-zero radius is not zero, and the band below it would then emit
      // a second, degenerate triangle per slice instead of collapsing.
      rings.push({ r: 0, z: height + radius, nr: 0, nz: 1 })
      break
    }
    const phi = (Math.PI / 2) * (j / domeStacks)
    const cp = Math.cos(phi)
    const sp = Math.sin(phi)
    rings.push({ r: radius * cp, z: height + radius * sp, nr: cp, nz: sp })
  }

  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const top = height + radius

  for (const ring of rings) {
    for (let i = 0; i <= slices; i++) {
      const u = i / slices
      const lon = (u - 0.5) * TAU
      const cos = Math.cos(lon)
      const sin = Math.sin(lon)
      positions.push(ring.r * cos, ring.r * sin, ring.z)
      normals.push(ring.nr * cos, ring.nr * sin, ring.nz)
      uvs.push(u, ring.z / top)
    }
  }

  const stride = slices + 1
  for (let k = 0; k < rings.length - 1; k++) {
    const lower = rings[k]
    const upper = rings[k + 1]
    // The crease pair occupies one band of zero height; it carries normals,
    // never faces.
    if (lower.r === upper.r && lower.z === upper.z) continue
    for (let i = 0; i < slices; i++) {
      const a = k * stride + i
      const b = a + stride
      // Same winding as zSphereGeometry — longitude advances before latitude,
      // giving outward-CCW faces — and the same collapse rule at a
      // zero-radius ring, where one of the two triangles is degenerate.
      if (lower.r > 0) indices.push(a, a + 1, b)
      if (upper.r > 0) indices.push(b, a + 1, b + 1)
    }
  }

  return buildGeometry(positions, normals, uvs, indices)
}

export interface RingOptions {
  /** Stations around the circumference (the desktop's `rings`). */
  rings?: number
  /** Cross-section rectangles the WIRE ring draws (the desktop's `rungs`). */
  rungs?: number
}

/**
 * The four faces of a flat ring, in the desktop `_draw_ring`'s own emission
 * order. Each is a quad strip around the circumference carrying its OWN full
 * 0–1 UV span — see zRingGeometry.
 *
 * `nearFirst` names which of the two cross-section corners the strip emits
 * first at each station; the winding of every quad follows from that, and each
 * face is arranged so its emitted winding agrees with its declared normal.
 */
interface RingFace {
  /** Constant normal, or 'outward'/'inward' for the two radial walls. */
  normal: 'outward' | 'inward' | readonly [number, number, number]
  /** Does u increase with the station index, or decrease? */
  uForward: boolean
  /** (radius, z-sign, v) for the first and second vertex of each station. */
  first: readonly [number, number, number]
  second: readonly [number, number, number]
}

/**
 * A torus with a RECTANGULAR cross-section — a flat machined band, the ring an
 * armillary sphere, an astrolabe or a graduated dial is built from (desktop
 * 721b827, `_draw_ring`).
 *
 * Four faces, each with its own constant normal and its own corner vertices, so
 * the edges stay CRISP instead of shading smoothly round the way a torus tube
 * does. That is the whole difference between soft tubing and a machined band,
 * and it is why this is a geometry rather than a squashed torus.
 *
 * TEXTURE RULE, the reason the shape exists: **every face carries a full 0–1 UV
 * span of its own**, u running once around the ring and v across the band —
 * rather than v walking once around the cross-section perimeter, which is what
 * a torus's mapping does. So one undistorted copy of a marking strip lands on
 * the outer wall AND another on the dial face, and the aspect decides which one
 * the viewer reads (wide + thin = a dial read face-on; narrow + tall = a band
 * read from outside). A perimeter-walking v would smear one image across all
 * four faces and break it at every corner.
 *
 * Each face's u runs in the direction that reads FORWARDS from that face's
 * natural viewing side — decreasing angle on the inner wall, seen from within
 * the hole, and on the underside. Equivalently (∂p/∂u × ∂p/∂v) points along the
 * face normal on all four, so no face is mirrored: the same handedness contract
 * the interior geometries carry, and for the same reason.
 *
 * Dimensions are passed in (`ringDims` in glyphGeometry.ts, which is the
 * desktop's own `ring_dims`) rather than derived here, so this module stays the
 * one that knows about UVs and windings and that one stays the one that knows
 * about GlyphViz proportions — the split zPinGeometry already makes.
 *
 * At `innerRadius` 0 the hole has closed: the inner wall is skipped entirely
 * (it would be a degenerate strip down the axis) and the annulus faces become
 * fans, as they do on the desktop.
 */
export function zRingGeometry(
  outerRadius: number,
  innerRadius: number,
  halfHeight: number,
  options: RingOptions = {},
): THREE.BufferGeometry {
  const rings = options.rings ?? 48
  const hasHole = innerRadius > 1e-6

  const faces: RingFace[] = [
    // Outer wall — normals point away from the axis, v runs bottom to top.
    { normal: 'outward', uForward: true, first: [outerRadius, 1, 1], second: [outerRadius, -1, 0] },
  ]
  if (hasHole) {
    // Inner wall — normals point AT the axis, so it is what you see across the
    // hole from outside and what surrounds you standing inside a large ring.
    faces.push({
      normal: 'inward',
      uForward: false,
      first: [innerRadius, -1, 0],
      second: [innerRadius, 1, 1],
    })
  }
  // Top and bottom annulus faces — v = 0 at the outer rim on both.
  faces.push(
    { normal: [0, 0, 1], uForward: true, first: [innerRadius, 1, 1], second: [outerRadius, 1, 0] },
    { normal: [0, 0, -1], uForward: false, first: [outerRadius, -1, 0], second: [innerRadius, -1, 1] },
  )

  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  for (const face of faces) {
    const base = positions.length / 3
    for (let i = 0; i <= rings; i++) {
      const th = (TAU * i) / rings
      const ct = Math.cos(th)
      const st = Math.sin(th)
      const u = face.uForward ? i / rings : 1 - i / rings
      for (const [radius, zSign, v] of [face.first, face.second]) {
        positions.push(radius * ct, radius * st, zSign * halfHeight)
        if (face.normal === 'outward') normals.push(ct, st, 0)
        else if (face.normal === 'inward') normals.push(-ct, -st, 0)
        else normals.push(face.normal[0], face.normal[1], face.normal[2])
        uvs.push(u, v)
      }
    }
    // GL_QUAD_STRIP's own quad from two stations: (v0, v1, v3, v2), which is
    // the order that decides front/back facing.
    const degenerateFirst = face.first[0] <= 1e-6
    const degenerateSecond = face.second[0] <= 1e-6
    for (let i = 0; i < rings; i++) {
      const a = base + 2 * i
      const b = a + 2
      // A zero-radius corner collapses the whole strip to a fan: one of the two
      // triangles is then degenerate, exactly as at a sphere's pole.
      if (!degenerateSecond) indices.push(a, a + 1, b + 1)
      if (!degenerateFirst) indices.push(a, b + 1, b)
    }
  }

  return buildGeometry(positions, normals, uvs, indices)
}

/**
 * The wire flat ring: four edge circles and a rectangle at every `rungs`th
 * station, as line segment pairs.
 *
 * DIVERGENCE from this module's usual rule, deliberate. Every other wire glyph
 * here is a `WireframeGeometry` of its own solid, so the two cannot drift apart
 * (see zPinGeometry). The desktop's wire ring is instead a sparse, deliberate
 * TRACING — four circles and twelve rungs — and that reading is the point of
 * it: a WireframeGeometry of a 48-station band is 400-odd edges of cross-hatch
 * that closes into a solid mat at any distance, which is the opposite of an
 * instrument hoop. Drift is not the hazard it is for the pin either, since both
 * shapes are swept from the same `ringDims` rectangle.
 */
export function zRingWireGeometry(
  outerRadius: number,
  innerRadius: number,
  halfHeight: number,
  options: RingOptions = {},
): THREE.BufferGeometry {
  const rings = options.rings ?? 48
  const rungs = options.rungs ?? 12
  const positions: number[] = []

  const push = (r: number, th: number, z: number) => {
    positions.push(r * Math.cos(th), r * Math.sin(th), z)
  }

  for (const [radius, z] of [
    [outerRadius, halfHeight],
    [outerRadius, -halfHeight],
    [innerRadius, halfHeight],
    [innerRadius, -halfHeight],
  ]) {
    if (radius <= 1e-6) continue
    for (let i = 0; i < rings; i++) {
      push(radius, (TAU * i) / rings, z)
      push(radius, (TAU * ((i + 1) % rings)) / rings, z)
    }
  }

  for (let j = 0; j < rungs; j++) {
    const th = (TAU * j) / rungs
    const corners: Array<[number, number]> = [
      [innerRadius, -halfHeight],
      [outerRadius, -halfHeight],
      [outerRadius, halfHeight],
      [innerRadius, halfHeight],
    ]
    for (let k = 0; k < corners.length; k++) {
      const [r0, z0] = corners[k]
      const [r1, z1] = corners[(k + 1) % corners.length]
      push(r0, th, z0)
      push(r1, th, z1)
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  return geo
}

// --- Interior variants -------------------------------------------------------
// The shape seen from WITHIN, culled from without (gv/interiorGeometry.ts).

/**
 * Reflect a geometry through the plane x = 0, IN PLACE.
 *
 * That one reflection does both of the things an interior surface needs, to
 * whatever an existing builder emitted — so an interior variant is the same
 * shape, tessellation and UV layout as its exterior twin rather than a second
 * implementation that has to be kept in step with it:
 *
 *   * every face's winding flips, so `side: FrontSide` now keeps the INSIDE
 *     surface and discards the outside;
 *   * the image is mirrored in the surface's angular direction, cancelling the
 *     mirroring inherent in viewing any surface from behind — so text in a
 *     texture or video reads FORWARDS from inside.
 *
 * MIRROR THE GEOMETRY, NOT THE OBJECT'S SCALE. three.js compensates for a
 * negative-determinant matrixWorld (WebGLState.setMaterial flips
 * gl.frontFace), so `mesh.scale.x = -1` gives a mirrored but still EXTERIOR
 * shape — the opposite of what is wanted. Baked into the BufferGeometry the
 * determinant stays positive, no compensation kicks in, and the faces genuinely
 * become back-facing from outside. This is also three's own canonical
 * 360-video idiom (webgl_video_panorama_equirectangular).
 *
 * Normals survive the reflection still pointing OUTWARD — the inverse
 * transpose of diag(−1,1,1) is itself, so a sphere's outward normal maps to the
 * outward normal at the mirrored point. That is not a defect to fix by flipping
 * them: interiors draw unlit (glyphGeometry.ts), for the reason recorded there.
 *
 * Exact only for shapes with no face perpendicular to x — which covers the
 * sphere and the cylinder, both surfaces of revolution about z. A cube's ±x
 * faces would come back mirrored, so it gets zCubeInteriorGeometry instead.
 */
export function mirroredGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  geometry.scale(-1, 1, 1)
  return geometry
}

/**
 * Each interior cube face as [outward axis, which way is UP on it].
 *
 * The four walls stand upright (+Z up). Floor and ceiling have no intrinsic up,
 * so they take OPPOSITE y — AND THAT IS NOT A TYPO. An orbit camera looking
 * down has screen-up pointing away from its azimuth and one looking up has it
 * pointing along; giving both faces the same y would leave one of the two 180°
 * round from the other (measured on the desktop, then fixed). As set here, a
 * viewer at the centre facing +Y reads the wall ahead, the floor and the
 * ceiling all the same way up.
 */
const CUBE_INTERIOR_FACES: ReadonlyArray<
  readonly [readonly [number, number, number], readonly [number, number, number]]
> = [
  [[1, 0, 0], [0, 0, 1]],
  [[-1, 0, 0], [0, 0, 1]],
  [[0, 1, 0], [0, 0, 1]],
  [[0, -1, 0], [0, 0, 1]],
  [[0, 0, 1], [0, 1, 0]], // ceiling, looked up at
  [[0, 0, -1], [0, -1, 0]], // floor, looked down at
]

/** The cube's four quad corners in UV space, the desktop's _CUBE_UVS order. */
const CUBE_INTERIOR_UVS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
]

/**
 * The cube's six faces turned inward, each mapping the whole texture upright
 * and unmirrored as seen from the centre.
 *
 * Built face by face rather than by mirroring the box, because ONE REFLECTION
 * CANNOT UN-MIRROR ALL SIX FACES: the two perpendicular to the mirror axis swap
 * places without their own UVs turning over, and would read backwards. (This
 * cost real time on the desktop; it is worth not rediscovering.)
 *
 * Each face gets a screen-space basis for a viewer at the origin looking at it
 * — `right = axis × up` — which lays u to the viewer's right and v upward and,
 * being right-handed, winds the quad CCW from inside for free. Normals are
 * −axis: the viewer is on the other side of the surface.
 */
export function zCubeInteriorGeometry(halfExtent: number): THREE.BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  for (const [axis, up] of CUBE_INTERIOR_FACES) {
    const right: [number, number, number] = [
      axis[1] * up[2] - axis[2] * up[1],
      axis[2] * up[0] - axis[0] * up[2],
      axis[0] * up[1] - axis[1] * up[0],
    ]
    const base = positions.length / 3
    for (const [u, v] of CUBE_INTERIOR_UVS) {
      // u,v in {0,1} → corner offsets in {−1,+1} along right/up.
      const su = 2 * u - 1
      const sv = 2 * v - 1
      for (let k = 0; k < 3; k++) {
        positions.push((axis[k] + su * right[k] + sv * up[k]) * halfExtent)
      }
      normals.push(-axis[0], -axis[1], -axis[2])
      uvs.push(u, v)
    }
    // The quad, as GL_QUADS would fan it.
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

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
