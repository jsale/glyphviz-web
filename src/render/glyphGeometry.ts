// Glyph shape factory, ported (behavior, not code) from the desktop app's
// glyphviz_gl/geometry.py + glyphviz_core/geometry_data.py (verified
// 2026-07-24). All shapes are built at unit scale — "fits within radius ~1",
// Z-up, matching the desktop display lists — and the node's scale is applied
// by the caller. Solid shapes are lit; wires and Points are unlit, mirroring
// the desktop's glDisable(GL_LIGHTING) for those paths.

import * as THREE from 'three'
import { Geometry } from '../gv/types'
import { applyPerFaceUV, fitPlanarUV, zSphereGeometry, zTubeGeometry } from './uvGeometry'

// Desktop proportion constants (glyphviz_core/geometry_data.py).
export const GRID_HALF_EXTENT = 1 / Math.SQRT2 // square corners reach radius 1
const CUBE_HALF = 1 / Math.sqrt(3) // cube verts on the unit sphere
const CYLINDER_RADIUS = 1.0
const CYLINDER_HEIGHT = 2.0
/**
 * Rod topology draws the glyph narrow and long. These are draw-matrix factors,
 * not a geometry: the desktop multiplies a Rod-topo node's floored scale by
 * them in `node_world_matrix` whatever geometry the node names, so a Rod sphere
 * stretches exactly like a Rod cylinder.
 */
export const ROD_RADIUS_FACTOR = 0.25
export const ROD_HEIGHT_FACTOR = 5.0

export interface GlyphStyle {
  color: THREE.Color
  /** 0–1 (color_a / 255). */
  opacity: number
  /** Node `ratio` — torus tube proportion, Point pixel size. */
  ratio: number
  /**
   * Decoded `texture_id`, or undefined for an untextured node. The colour
   * still applies: fixed-function GL's default env mode is MODULATE, which is
   * exactly what Three does with `map` × `color`. Wire glyphs and Points are
   * never textured (the desktop's `geo_id not in _WIRE_IDS` guard).
   */
  map?: THREE.Texture
  /**
   * Geometry for an imported Mesh (23) node — the node's `mesh_id` resolved
   * through the MeshLibrary. Absent when the id names nothing loaded, which
   * draws the desktop's sphere fallback (GeoRenderer.draw).
   */
  mesh?: THREE.BufferGeometry
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

// Every solid carries usable texture coordinates — see uvGeometry.ts for the
// shared equirect convention on curved surfaces and the per-face unwrap on
// flat-faced ones. Three's own UVs are kept where they are already right:
// BoxGeometry maps each face 0–1 (the desktop's _CUBE_UVS), TorusGeometry
// parameterises major/minor exactly like _draw_torus, and PlaneGeometry /
// CircleGeometry match _draw_grid_solid and gluDisk.
const SOLID_BUILDERS: Record<number, GeoBuilder> = {
  [Geometry.CubeSolid]: () => new THREE.BoxGeometry(2 * CUBE_HALF, 2 * CUBE_HALF, 2 * CUBE_HALF),
  [Geometry.SphereSolid]: () => zSphereGeometry(1, 32, 16),
  // Base at z=−1 (radius 1), apex at z=+1, capped.
  [Geometry.ConeSolid]: () => zTubeGeometry(1, 0, 2, { slices: 32, capBottom: true }),
  // Flat-faced solids take the cube's per-face 0–1 treatment (see
  // applyPerFaceUV) rather than Three's spherical projection.
  [Geometry.DodecahedronSolid]: () => applyPerFaceUV(new THREE.DodecahedronGeometry(1)),
  [Geometry.OctahedronSolid]: () => applyPerFaceUV(new THREE.OctahedronGeometry(1)),
  [Geometry.TetrahedronSolid]: () => applyPerFaceUV(new THREE.TetrahedronGeometry(1)),
  [Geometry.IcosahedronSolid]: () => applyPerFaceUV(new THREE.IcosahedronGeometry(1)),
  // Spans z ∈ [−1, 1], capped.
  [Geometry.CylinderSolid]: () =>
    zTubeGeometry(CYLINDER_RADIUS, CYLINDER_RADIUS, CYLINDER_HEIGHT, {
      slices: 32,
      capBottom: true,
      capTop: true,
    }),
  [Geometry.GridSolid]: () => new THREE.PlaneGeometry(2 * GRID_HALF_EXTENT, 2 * GRID_HALF_EXTENT),
  [Geometry.Circle]: () => new THREE.CircleGeometry(1, 24),
  // ShapeGeometry emits raw vertex coordinates as UVs, which tile a ±1 glyph
  // four times; refit them to the outline's bounding box.
  [Geometry.Cross]: () => fitPlanarUV(new THREE.ShapeGeometry(crossShape())),
  [Geometry.Star]: () => fitPlanarUV(new THREE.ShapeGeometry(starShape())),
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
  [Geometry.ConeWire]: () => zTubeGeometry(1, 0, 2, { slices: 16 }),
  [Geometry.DodecahedronWire]: SOLID_BUILDERS[Geometry.DodecahedronSolid],
  [Geometry.OctahedronWire]: SOLID_BUILDERS[Geometry.OctahedronSolid],
  [Geometry.TetrahedronWire]: SOLID_BUILDERS[Geometry.TetrahedronSolid],
  [Geometry.IcosahedronWire]: SOLID_BUILDERS[Geometry.IcosahedronSolid],
  [Geometry.CylinderWire]: () =>
    zTubeGeometry(CYLINDER_RADIUS, CYLINDER_RADIUS, CYLINDER_HEIGHT, { slices: 16 }),
}

// Pin (16/17): ball head above a tapering needle, both along local Z —
// head sphere r 0.12 centered at z 0.22; needle from r 0.12 at z 0.1 down
// to r 0.03 at z −1.0 (glyphviz_gl _draw_pin).
function pinSolidGeometries(): [THREE.BufferGeometry, THREE.BufferGeometry] {
  if (!solidCache.has('pin:head')) {
    const head = zSphereGeometry(0.12, 16, 8)
    head.translate(0, 0, 0.22)
    // Wide end (r 0.12) at the top, tapering to r 0.03 at z −1.0.
    const needle = zTubeGeometry(0.03, 0.12, 1.1, { slices: 16 })
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

// Materials are shared across every node that looks the same. A material per
// node is affordable at a hundred glyphs and pathological at a hundred
// thousand (Raw_Auction_Field is 100k, Event_Cloud 209k) — and textures make
// it worse, since each material would otherwise re-bind the same map.
const materialCache = new Map<string, THREE.Material>()

function styleKey(style: GlyphStyle, kind: string, extra: string | number = ''): string {
  return `${kind}|${style.color.getHexString()}|${style.opacity.toFixed(4)}|${
    style.map?.uuid ?? ''
  }|${extra}`
}

/**
 * An imported mesh with no texture coordinates takes no map.
 *
 * The desktop never textures a mesh at all — `mesh_loader` keeps only
 * vertices/faces/normals and `register_mesh` emits no glTexCoord, so a
 * textured mesh node draws one flat texel there. Honouring the UVs a file
 * DOES carry is strictly better and is what the texture row already promises;
 * a file with none would otherwise smear a single texel over the whole model,
 * which reads as the colour being wrong.
 */
function meshStyle(style: GlyphStyle): GlyphStyle {
  return style.mesh?.hasAttribute('uv') ? style : { ...style, map: undefined }
}

function cachedMaterial<T extends THREE.Material>(key: string, build: () => T): T {
  const hit = materialCache.get(key)
  if (hit) return hit as T
  const made = build()
  materialCache.set(key, made)
  return made
}

/**
 * Drop every cached material. Call when a scene is replaced: the textures the
 * old materials reference are disposed with it, and a material holding a
 * disposed map renders black.
 */
export function clearMaterialCache(): void {
  for (const material of materialCache.values()) material.dispose()
  materialCache.clear()
}

function solidMaterial(style: GlyphStyle, doubleSided: boolean): THREE.Material {
  return cachedMaterial(styleKey(style, 'solid', doubleSided ? 'ds' : 'fs'), () =>
    new THREE.MeshLambertMaterial({
      color: style.color,
      map: style.map,
      transparent: style.opacity < 1,
      opacity: style.opacity,
      side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    }),
  )
}

function wireMaterial(style: GlyphStyle): THREE.Material {
  return cachedMaterial(styleKey(style, 'wire'), () =>
    new THREE.LineBasicMaterial({
      color: style.color,
      transparent: style.opacity < 1,
      opacity: style.opacity,
    }),
  )
}

/**
 * Build a renderable object for a node's `geometry` id at unit scale, or
 * null when the id has no renderer yet (Line 27, Prism 28, unknown ids) — the
 * caller reports those.
 *
 * Mesh (23) draws `style.mesh`, or falls back to a sphere when the node's
 * mesh_id names nothing loaded, exactly as the desktop's GeoRenderer.draw
 * does ("no mesh loaded yet — fall back like other unknown ids").
 */
export function createGlyphObject(geometryId: number, style: GlyphStyle): THREE.Object3D | null {
  if (geometryId === Geometry.Mesh) {
    if (!style.mesh) return createGlyphObject(Geometry.SphereSolid, { ...style, mesh: undefined })
    // Double-sided because an imported file cannot be trusted to share the
    // procedural shapes' outward-CCW winding — the desktop's own reason for
    // its glDisable(GL_CULL_FACE) around the mesh display list.
    return new THREE.Mesh(style.mesh, solidMaterial(meshStyle(style), true))
  }

  if (geometryId === Geometry.Point) {
    // Desktop draws a GL_POINTS sprite whose pixel size is ratio × 20
    // (min 1), immune to node scale — sizeAttenuation: false matches that.
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3))
    const size = Math.max(1, style.ratio * 20)
    return new THREE.Points(
      geo,
      cachedMaterial(styleKey(style, 'point', size), () =>
        new THREE.PointsMaterial({
          color: style.color,
          transparent: style.opacity < 1,
          opacity: style.opacity,
          size,
          sizeAttenuation: false,
        }),
      ),
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

export const WIRE_TO_SOLID: Record<number, number> = {
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
export function createPickProxy(
  geometryId: number,
  mesh?: THREE.BufferGeometry,
): THREE.Object3D | null {
  const solidId = WIRE_TO_SOLID[geometryId] ?? geometryId

  let proxy: THREE.Object3D | null = null
  if (solidId === Geometry.Mesh) {
    // The desktop's pick pass draws the mesh itself (`mesh_id=node.mesh_id`),
    // so an imported model is clicked where it is actually seen — and falls
    // back to the same sphere the visible glyph does.
    proxy = mesh
      ? new THREE.Mesh(mesh, PICK_MATERIAL)
      : new THREE.Mesh(cached(solidCache, String(Geometry.SphereSolid), SOLID_BUILDERS[Geometry.SphereSolid]), PICK_MATERIAL)
  } else if (solidId === Geometry.Point) {
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
