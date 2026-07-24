// Glyph shape factory, ported (behavior, not code) from the desktop app's
// glyphviz_gl/geometry.py + glyphviz_core/geometry_data.py (verified
// 2026-07-24). All shapes are built at unit scale — "fits within radius ~1",
// Z-up, matching the desktop display lists — and the node's scale is applied
// by the caller. Solid shapes are lit; wires and Points are unlit, mirroring
// the desktop's glDisable(GL_LIGHTING) for those paths.

import * as THREE from 'three'
import { Geometry } from '../gv/types'

// Desktop proportion constants (glyphviz_core/geometry_data.py).
export const GRID_HALF_EXTENT = 1 / Math.SQRT2 // square corners reach radius 1
const CUBE_HALF = 1 / Math.sqrt(3) // cube verts on the unit sphere
const CYLINDER_RADIUS = 1.0
const CYLINDER_HEIGHT = 2.0

export interface GlyphStyle {
  color: THREE.Color
  /** 0–1 (color_a / 255). */
  opacity: number
  /** Node `ratio` — torus tube proportion, Point pixel size. */
  ratio: number
}

/** Rotates a Y-up Three.js primitive into the GlyphViz Z-up convention. */
function zUp(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  geo.rotateX(Math.PI / 2)
  return geo
}

function starShape(points = 5, innerRatio = 0.382): THREE.Shape {
  const shape = new THREE.Shape()
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? 1.0 : innerRatio
    const a = Math.PI / 2 + (i * Math.PI) / points
    const x = r * Math.cos(a)
    const y = r * Math.sin(a)
    if (i === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  }
  shape.closePath()
  return shape
}

function crossShape(halfWidth = 0.3): THREE.Shape {
  const s = 1.0
  const w = halfWidth
  const pts: Array<[number, number]> = [
    [s, -w], [s, w], [w, w], [w, s], [-w, s], [-w, w],
    [-s, w], [-s, -w], [-w, -w], [-w, -s], [w, -s], [w, -w],
  ]
  const shape = new THREE.Shape()
  shape.moveTo(...pts[0])
  for (let i = 1; i < pts.length; i++) shape.lineTo(...pts[i])
  shape.closePath()
  return shape
}

/** Graph-paper lattice matching the desktop Grid Wire glyph. */
function gridLatticeGeometry(segments = 8): THREE.BufferGeometry {
  const s = GRID_HALF_EXTENT
  const positions: number[] = []
  for (let i = 0; i <= segments; i++) {
    const t = -s + (2 * s * i) / segments
    positions.push(t, -s, 0, t, s, 0)
    positions.push(-s, t, 0, s, t, 0)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  return geo
}

// Base (solid) geometry builders. Wire variants derive from these via
// WireframeGeometry, except Grid Wire (a lattice, built above) and the
// open-ended cone/cylinder wires (desktop wire quadrics have no caps).
type GeoBuilder = () => THREE.BufferGeometry

const SOLID_BUILDERS: Record<number, GeoBuilder> = {
  [Geometry.CubeSolid]: () => new THREE.BoxGeometry(2 * CUBE_HALF, 2 * CUBE_HALF, 2 * CUBE_HALF),
  [Geometry.SphereSolid]: () => new THREE.SphereGeometry(1, 16, 12),
  // Base at z=−1 (radius 1), apex at z=+1, capped.
  [Geometry.ConeSolid]: () => zUp(new THREE.ConeGeometry(1, 2, 16, 1, false)),
  [Geometry.DodecahedronSolid]: () => new THREE.DodecahedronGeometry(1),
  [Geometry.OctahedronSolid]: () => new THREE.OctahedronGeometry(1),
  [Geometry.TetrahedronSolid]: () => new THREE.TetrahedronGeometry(1),
  [Geometry.IcosahedronSolid]: () => new THREE.IcosahedronGeometry(1),
  // Spans z ∈ [−1, 1], capped.
  [Geometry.CylinderSolid]: () =>
    zUp(new THREE.CylinderGeometry(CYLINDER_RADIUS, CYLINDER_RADIUS, CYLINDER_HEIGHT, 16, 1, false)),
  [Geometry.GridSolid]: () => new THREE.PlaneGeometry(2 * GRID_HALF_EXTENT, 2 * GRID_HALF_EXTENT),
  [Geometry.Circle]: () => new THREE.CircleGeometry(1, 24),
  [Geometry.Cross]: () => new THREE.ShapeGeometry(crossShape()),
  [Geometry.Star]: () => new THREE.ShapeGeometry(starShape()),
}

// Flat markers and the plate render double-sided on the desktop.
const DOUBLE_SIDED = new Set<number>([
  Geometry.GridSolid,
  Geometry.Circle,
  Geometry.Cross,
  Geometry.Star,
])

// Wire id → builder of the geometry to wireframe.
const WIRE_BUILDERS: Record<number, GeoBuilder> = {
  [Geometry.CubeWire]: SOLID_BUILDERS[Geometry.CubeSolid],
  [Geometry.SphereWire]: SOLID_BUILDERS[Geometry.SphereSolid],
  [Geometry.ConeWire]: () => zUp(new THREE.ConeGeometry(1, 2, 16, 1, true)),
  [Geometry.DodecahedronWire]: SOLID_BUILDERS[Geometry.DodecahedronSolid],
  [Geometry.OctahedronWire]: SOLID_BUILDERS[Geometry.OctahedronSolid],
  [Geometry.TetrahedronWire]: SOLID_BUILDERS[Geometry.TetrahedronSolid],
  [Geometry.IcosahedronWire]: SOLID_BUILDERS[Geometry.IcosahedronSolid],
  [Geometry.CylinderWire]: () =>
    zUp(new THREE.CylinderGeometry(CYLINDER_RADIUS, CYLINDER_RADIUS, CYLINDER_HEIGHT, 16, 1, true)),
}

// Pin (16/17): ball head above a tapering needle, both along local Z —
// head sphere r 0.12 centered at z 0.22; needle from r 0.12 at z 0.1 down
// to r 0.03 at z −1.0 (glyphviz_gl _draw_pin).
function pinSolidGeometries(): [THREE.BufferGeometry, THREE.BufferGeometry] {
  if (!solidCache.has('pin:head')) {
    const head = new THREE.SphereGeometry(0.12, 12, 8)
    head.translate(0, 0, 0.22)
    const needle = zUp(new THREE.CylinderGeometry(0.12, 0.03, 1.1, 8, 1, true))
    needle.translate(0, 0, -0.45)
    solidCache.set('pin:head', head)
    solidCache.set('pin:needle', needle)
  }
  return [solidCache.get('pin:head')!, solidCache.get('pin:needle')!]
}

const solidCache = new Map<string, THREE.BufferGeometry>()
const wireCache = new Map<string, THREE.BufferGeometry>()

function cached(
  cache: Map<string, THREE.BufferGeometry>,
  key: string,
  build: () => THREE.BufferGeometry,
): THREE.BufferGeometry {
  let geo = cache.get(key)
  if (!geo) {
    geo = build()
    cache.set(key, geo)
  }
  return geo
}

// A torus glyph's *shape* is governed by the node's own ratio:
// minor = ratio, major = 1 − minor (glyphviz_core torus_radii).
function torusGeometry(ratio: number): THREE.BufferGeometry {
  const minor = ratio
  const major = 1 - minor
  return new THREE.TorusGeometry(major, minor, 16, 24)
}

function solidMaterial(style: GlyphStyle, doubleSided: boolean): THREE.Material {
  return new THREE.MeshLambertMaterial({
    color: style.color,
    transparent: style.opacity < 1,
    opacity: style.opacity,
    side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
  })
}

function wireMaterial(style: GlyphStyle): THREE.Material {
  return new THREE.LineBasicMaterial({
    color: style.color,
    transparent: style.opacity < 1,
    opacity: style.opacity,
  })
}

/**
 * Build a renderable object for a node's `geometry` id at unit scale, or
 * null when the id has no renderer yet (Mesh 23, Line 27, Prism 28, unknown
 * ids) — the caller reports those.
 */
export function createGlyphObject(geometryId: number, style: GlyphStyle): THREE.Object3D | null {
  if (geometryId === Geometry.Point) {
    // Desktop draws a GL_POINTS sprite whose pixel size is ratio × 20
    // (min 1), immune to node scale — sizeAttenuation: false matches that.
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3))
    return new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: style.color,
        transparent: style.opacity < 1,
        opacity: style.opacity,
        size: Math.max(1, style.ratio * 20),
        sizeAttenuation: false,
      }),
    )
  }

  if (geometryId === Geometry.PinSolid || geometryId === Geometry.PinWire) {
    const wire = geometryId === Geometry.PinWire
    const group = new THREE.Group()
    for (const part of pinSolidGeometries()) {
      if (wire) {
        const geo = cached(wireCache, `pinwire:${part.uuid}`, () => new THREE.WireframeGeometry(part))
        group.add(new THREE.LineSegments(geo, wireMaterial(style)))
      } else {
        group.add(new THREE.Mesh(part, solidMaterial(style, false)))
      }
    }
    return group
  }

  if (geometryId === Geometry.GridWire) {
    const geo = cached(wireCache, 'gridLattice', gridLatticeGeometry)
    return new THREE.LineSegments(geo, wireMaterial(style))
  }

  if (geometryId === Geometry.TorusSolid) {
    const geo = cached(solidCache, `torus:${style.ratio.toFixed(6)}`, () => torusGeometry(style.ratio))
    return new THREE.Mesh(geo, solidMaterial(style, false))
  }
  if (geometryId === Geometry.TorusWire) {
    const geo = cached(wireCache, `torus:${style.ratio.toFixed(6)}`, () =>
      new THREE.WireframeGeometry(torusGeometry(style.ratio)),
    )
    return new THREE.LineSegments(geo, wireMaterial(style))
  }

  const wireBuilder = WIRE_BUILDERS[geometryId]
  if (wireBuilder) {
    const geo = cached(wireCache, String(geometryId), () => new THREE.WireframeGeometry(wireBuilder()))
    return new THREE.LineSegments(geo, wireMaterial(style))
  }

  const solidBuilder = SOLID_BUILDERS[geometryId]
  if (solidBuilder) {
    const geo = cached(solidCache, String(geometryId), solidBuilder)
    return new THREE.Mesh(geo, solidMaterial(style, DOUBLE_SIDED.has(geometryId)))
  }

  return null
}

// --- Picking proxies ---------------------------------------------------------
// The desktop pick pass draws SOLID silhouettes for every shape (wire glyphs
// substitute their solid twin — geometry_data.WIRE_TO_SOLID) so any click
// inside the bounding shape registers. Mirror that with an invisible solid
// mesh per glyph: the renderer skips visible=false objects but the raycaster
// does not, giving the same "solid silhouette" hit volume.

const WIRE_TO_SOLID: Record<number, number> = {
  [Geometry.CubeWire]: Geometry.CubeSolid,
  [Geometry.SphereWire]: Geometry.SphereSolid,
  [Geometry.ConeWire]: Geometry.ConeSolid,
  [Geometry.TorusWire]: Geometry.TorusSolid,
  [Geometry.DodecahedronWire]: Geometry.DodecahedronSolid,
  [Geometry.OctahedronWire]: Geometry.OctahedronSolid,
  [Geometry.TetrahedronWire]: Geometry.TetrahedronSolid,
  [Geometry.IcosahedronWire]: Geometry.IcosahedronSolid,
  [Geometry.PinWire]: Geometry.PinSolid,
  [Geometry.CylinderWire]: Geometry.CylinderSolid,
  [Geometry.GridWire]: Geometry.GridSolid,
}

// Double-sided so flat markers (and rays exiting solids) always hit.
const PICK_MATERIAL = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })

/** Unit-space hit radius for Point glyphs (their sprite size is pixel-based). */
const POINT_PICK_RADIUS = 0.15

/**
 * Invisible solid hit volume for a node's geometry, or null when the shape
 * has no renderer yet. Attach as a child of the glyph so it inherits the
 * draw-scale correction.
 */
export function createPickProxy(geometryId: number): THREE.Object3D | null {
  const solidId = WIRE_TO_SOLID[geometryId] ?? geometryId

  let proxy: THREE.Object3D | null = null
  if (solidId === Geometry.Point) {
    const geo = cached(solidCache, 'pointPick', () => new THREE.SphereGeometry(POINT_PICK_RADIUS, 8, 6))
    proxy = new THREE.Mesh(geo, PICK_MATERIAL)
  } else if (solidId === Geometry.PinSolid) {
    const group = new THREE.Group()
    for (const part of pinSolidGeometries()) {
      group.add(new THREE.Mesh(part, PICK_MATERIAL))
    }
    proxy = group
  } else if (solidId === Geometry.TorusSolid) {
    // Pick tube uses the default ratio-agnostic torus; per-node accuracy
    // isn't worth a per-ratio proxy geometry.
    const geo = cached(solidCache, 'torusPick', () => torusGeometry(0.1))
    proxy = new THREE.Mesh(geo, PICK_MATERIAL)
  } else {
    const builder = SOLID_BUILDERS[solidId]
    if (!builder) return null
    proxy = new THREE.Mesh(cached(solidCache, String(solidId), builder), PICK_MATERIAL)
  }

  proxy.visible = false
  proxy.userData.isPickProxy = true
  proxy.traverse((o) => {
    o.userData.isPickProxy = true
  })
  return proxy
}
