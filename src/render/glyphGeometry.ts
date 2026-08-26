// Glyph shape factory, ported (behavior, not code) from the desktop app's
// glyphviz_gl/geometry.py + glyphviz_core/geometry_data.py (verified
// 2026-07-24). All shapes are built at unit scale — "fits within radius ~1",
// Z-up, matching the desktop display lists — and the node's scale is applied
// by the caller. Solid shapes are lit; wires and Points are unlit, mirroring
// the desktop's glDisable(GL_LIGHTING) for those paths.

import * as THREE from 'three'
import { isInteriorGeometry } from '../gv/interiorGeometry'
import { Geometry } from '../gv/types'
import {
  applyPerFaceUV,
  fitPlanarUV,
  mirroredGeometry,
  zCubeInteriorGeometry,
  zPinGeometry,
  zRingGeometry,
  zRingWireGeometry,
  zSphereGeometry,
  zTubeGeometry,
} from './uvGeometry'

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
/**
 * Pushpin glyph — a cone ten times as tall as its base is wide, apex at the
 * local ORIGIN and shaft rising along +Z, closed at the top by a dome of the
 * cone's own base radius (so the dome adds a further 10% and the total height
 * is 110% of the shaft). Both numbers are ANTz's, from DrawPinDL
 * (npgeometry.c:493) rescaled by 1/5 to this module's "fits within radius ~1"
 * convention, by way of desktop `geometry_data.PIN_HEIGHT/PIN_RADIUS`.
 *
 * Apex-at-the-origin is load-bearing, not styling: Topo.Pin places children at
 * `B + translate_x` along +Z (topology.ts), so they ride the shaft only if the
 * shaft is the +Z half of the glyph. PIN_HEIGHT = 1.0 = the default base scale
 * then puts a child with translate_x = 0 exactly at the dome's centre and one
 * at −B on the tip, which is where ANTz's own pin children sit. The shape this
 * replaces hung below the origin, so children floated clear of the whole glyph.
 */
export const PIN_HEIGHT = 1.0
export const PIN_RADIUS = 0.1 * PIN_HEIGHT

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
  // Tip on the origin, dome centred at z = PIN_HEIGHT, top at 1.1.
  [Geometry.PinSolid]: () => zPinGeometry(PIN_HEIGHT, PIN_RADIUS),
  [Geometry.GridSolid]: () => new THREE.PlaneGeometry(2 * GRID_HALF_EXTENT, 2 * GRID_HALF_EXTENT),
  [Geometry.Circle]: () => new THREE.CircleGeometry(1, 24),
  // ShapeGeometry emits raw vertex coordinates as UVs, which tile a ±1 glyph
  // four times; refit them to the outline's bounding box.
  [Geometry.Cross]: () => fitPlanarUV(new THREE.ShapeGeometry(crossShape())),
  [Geometry.Star]: () => fitPlanarUV(new THREE.ShapeGeometry(starShape())),
  // Interior variants — the same shapes seen from within (see
  // gv/interiorGeometry.ts and uvGeometry's mirroredGeometry). The sphere and
  // both cylinders reuse the exterior builders and are mirrored; the cube
  // cannot be (one reflection leaves two of its six faces backwards), so it is
  // built face by face. Each occupies the same corners as its exterior twin, so
  // scale, links and halos all behave identically.
  [Geometry.CubeInterior]: () => zCubeInteriorGeometry(CUBE_HALF),
  [Geometry.SphereInterior]: () => mirroredGeometry(zSphereGeometry(1, 32, 16)),
  [Geometry.CylinderInterior]: () =>
    mirroredGeometry(
      zTubeGeometry(CYLINDER_RADIUS, CYLINDER_RADIUS, CYLINDER_HEIGHT, {
        slices: 32,
        capBottom: true,
        capTop: true,
      }),
    ),
  // The open tube: the caps question was already parameterised, so "no caps" is
  // simply both flags off. It is meaningful only on an interior shape — from
  // outside, an open tube just shows you its far inner wall through the hole.
  [Geometry.CylinderInteriorOpen]: () =>
    mirroredGeometry(
      zTubeGeometry(CYLINDER_RADIUS, CYLINDER_RADIUS, CYLINDER_HEIGHT, { slices: 32 }),
    ),
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
  // The desktop traces its wire pin as meridians and latitude rings rather
  // than as every triangle edge; here it takes the same WireframeGeometry
  // treatment as every other wire glyph, off the one solid it is built from —
  // which is the point the desktop makes by deriving both from one meridian:
  // the wire pin cannot drift into being a different shape.
  [Geometry.PinWire]: () => zPinGeometry(PIN_HEIGHT, PIN_RADIUS, { slices: 16, domeStacks: 4 }),
}

const solidCache = new Map<string, THREE.BufferGeometry>()
const wireCache = new Map<string, THREE.BufferGeometry>()

/**
 * The solid flat ring at a node's ratio, shared by the visible glyph and the
 * pick proxy — which is why it is a function rather than two call sites: at the
 * same quantized ratio they are the SAME geometry, so an accurate hit volume
 * costs nothing.
 */
function ringSolidGeometry(ratio: number): THREE.BufferGeometry {
  const quantized = quantizedShapeRatio(ratio)
  return cached(solidCache, `ring:${quantized}`, () => zRingGeometry(...ringDims(quantized)))
}

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

/**
 * (outer radius, inner radius, half-height) of a Flat Ring glyph — the
 * desktop's `ring_dims` (glyphviz_core/geometry_data.py).
 *
 * Deliberately the TORUS's own extents, restated as a box rather than a tube:
 * `torus_radii` puts the tube between radius `size − 2·ratio·size` and `size`,
 * spanning z ±`ratio·size`, and that is exactly the rectangle swept here. So
 * `ratio` reading as the band's radial width is not a second meaning for the
 * field — it is the meaning it already had. Torus ↔ Flat Ring is therefore a
 * pure change of LOOK: same silhouette, same bounding extents, and a
 * Torus-topology parent places its children identically whichever of the two
 * it wears.
 *
 * The half-height is the glyph's LOCAL one; the node's `scale_z` multiplies it
 * at draw time, which is how the band's height is set independently of its
 * radial width (scale_z == scale_x gives the square cross-section). The cost of
 * that packaging is that a THIN band needs a large scale_z to stand tall — a
 * 0.5-unit hoop at ratio 0.02 is scale_z 25 — and the gain is that height
 * already has a column, a panel row, a gizmo and a Channels binding.
 *
 * A `ratio` at or past 0.5 closes the hole: the inner radius clamps at 0 and the
 * ring becomes a solid wheel rather than inverting.
 */
export function ringDims(ratio: number, size = 1): [number, number, number] {
  const minor = ratio * size
  const major = size - minor
  return [size, Math.max(0, major - minor), minor]
}

/**
 * The geometries whose SHAPE — not merely their size — is set by the node's own
 * `ratio`, so they cannot share one cached geometry the way every other glyph
 * does. The desktop's `RATIO_SHAPED_GEOMETRIES`: everything that dispatches or
 * keys on them reads this set rather than naming the ids, so a future
 * ratio-shaped glyph joins by editing one line.
 */
export const RATIO_SHAPED_GEOMETRIES: ReadonlySet<number> = new Set<number>([
  Geometry.TorusSolid,
  Geometry.TorusWire,
  Geometry.Ring,
  Geometry.RingWire,
])

/**
 * Ratios are quantized to 1% steps before they reach the geometry cache — the
 * desktop's own fix (`ensure_ratio_list`, desktop 77d6361): nothing ever evicts
 * a cached geometry, so a Channels animation sweeping `ratio` continuously
 * would otherwise mint one per distinct float and leak without bound.
 * Quantized, the cache tops out near 100 entries per solid/wire pair, and the
 * geometry is BUILT from the quantized value, so every node landing in a bucket
 * renders identically to the geometry it shares. 1% of a glyph's radius is well
 * under a pixel of tube thickness at normal zoom; the 0.14 default is
 * unaffected. Rounding is Python's (half-to-even), like the desktop's
 * `round(ratio, 2)`.
 *
 * Note the flat ring's HEIGHT is deliberately not part of the key: it rides on
 * the node's `scale_z`, outside the built geometry, which is what keeps this
 * cache one-dimensional.
 */
export function quantizedShapeRatio(ratio: number): number {
  const floor = Math.floor(ratio * 100)
  const frac = ratio * 100 - floor
  const steps = frac > 0.5 ? floor + 1 : frac < 0.5 ? floor : floor % 2 === 0 ? floor : floor + 1
  return steps / 100
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

/**
 * Solid glyph material.
 *
 * `unlit` builds a MeshBasicMaterial instead of the lit MeshLambertMaterial —
 * the interior shapes, which exist to carry an image and must carry it at full
 * brightness. It is the same call worldGridGeometry.ts already makes for a map,
 * and the desktop's `_unlit` wrapper for exactly these ids.
 *
 * Lighting an interior would be worse than dim, not merely different. The
 * mirror leaves normals pointing OUTWARD (uvGeometry's mirroredGeometry), so a
 * lit interior sphere renders at the ambient terms alone — the desktop measured
 * a white one at 0.505 grey — and flipping the normals to fix that would light
 * it with a key light bolted to the camera (lighting.ts), giving a video a
 * bright patch that slides across it as the viewer turns. In VR that would be
 * very unpleasant.
 *
 * Interiors stay SINGLE-SIDED: one fragment per pixel, and alpha on a
 * translucent node keeps behaving. `doubleSided` must never be passed for them.
 */
function solidMaterial(
  style: GlyphStyle,
  doubleSided: boolean,
  unlit = false,
): THREE.Material {
  const params = {
    color: style.color,
    map: style.map,
    transparent: style.opacity < 1,
    opacity: style.opacity,
    side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
  }
  return cachedMaterial(
    // The lit and unlit variants must not collide in the cache: they can share
    // every other key component and are different material classes.
    styleKey(style, 'solid', `${doubleSided ? 'ds' : 'fs'}${unlit ? '|unlit' : ''}`),
    () => (unlit ? new THREE.MeshBasicMaterial(params) : new THREE.MeshLambertMaterial(params)),
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

  if (geometryId === Geometry.GridWire) {
    const geo = cached(wireCache, 'gridLattice', gridLatticeGeometry)
    return new THREE.LineSegments(geo, wireMaterial(style))
  }

  if (geometryId === Geometry.TorusSolid) {
    const ratio = quantizedShapeRatio(style.ratio)
    const geo = cached(solidCache, `torus:${ratio}`, () => torusGeometry(ratio))
    return new THREE.Mesh(geo, solidMaterial(style, false))
  }
  if (geometryId === Geometry.TorusWire) {
    const ratio = quantizedShapeRatio(style.ratio)
    const geo = cached(wireCache, `torus:${ratio}`, () =>
      new THREE.WireframeGeometry(torusGeometry(ratio)),
    )
    return new THREE.LineSegments(geo, wireMaterial(style))
  }

  if (geometryId === Geometry.Ring) {
    const geo = ringSolidGeometry(style.ratio)
    return new THREE.Mesh(geo, solidMaterial(style, false))
  }
  if (geometryId === Geometry.RingWire) {
    const ratio = quantizedShapeRatio(style.ratio)
    const geo = cached(wireCache, `ring:${ratio}`, () => zRingWireGeometry(...ringDims(ratio)))
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
    return new THREE.Mesh(
      geo,
      solidMaterial(style, DOUBLE_SIDED.has(geometryId), isInteriorGeometry(geometryId)),
    )
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
  [Geometry.RingWire]: Geometry.Ring,
}

// Double-sided so flat markers (and rays exiting solids) always hit.
const PICK_MATERIAL = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })

/**
 * Pick material for the interior shapes, which are the one case where the
 * two-sided default would be wrong rather than merely generous.
 *
 * The desktop invariant is "the pick pass draws what the visible pass draws",
 * and its colour-ID pass inherits the interior's culling — so from outside you
 * pick the FAR inner wall, exactly the wall you can see. Left double-sided
 * here, the ray would instead stop on the near wall you cannot see, and a video
 * room would swallow every click meant for the scene standing inside it.
 * FrontSide restores the desktop's ordering: whatever is inside the room is
 * nearer than its far wall, so it wins the click.
 */
const INTERIOR_PICK_MATERIAL = new THREE.MeshBasicMaterial({ side: THREE.FrontSide })

/** Unit-space hit radius for Point glyphs (their sprite size is pixel-based). */
const POINT_PICK_RADIUS = 0.15

/**
 * Invisible solid hit volume for a node's geometry, or null when the shape
 * has no renderer yet. Attach as a child of the glyph so it inherits the
 * draw-scale correction.
 *
 * `ratio` is consulted only by the flat ring, where the field decides how much
 * of the glyph's own footprint is solid at all — a rail at ratio 0.02 is a band
 * 4% of its radius wide, a graduated dial at 0.4 is most of a disc — so a
 * fixed-ratio proxy would either swallow clicks aimed through a thin hoop's
 * hole or let them through the middle of a wide one. At the same quantized
 * ratio it is the very geometry the glyph draws, so this is free.
 */
export function createPickProxy(
  geometryId: number,
  mesh?: THREE.BufferGeometry,
  ratio = 0.1,
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
  } else if (solidId === Geometry.TorusSolid) {
    // Pick tube uses the default ratio-agnostic torus; per-node accuracy
    // isn't worth a per-ratio proxy geometry.
    const geo = cached(solidCache, 'torusPick', () => torusGeometry(0.1))
    proxy = new THREE.Mesh(geo, PICK_MATERIAL)
  } else if (solidId === Geometry.Ring) {
    proxy = new THREE.Mesh(ringSolidGeometry(ratio), PICK_MATERIAL)
  } else {
    const builder = SOLID_BUILDERS[solidId]
    if (!builder) return null
    proxy = new THREE.Mesh(
      cached(solidCache, String(solidId), builder),
      isInteriorGeometry(solidId) ? INTERIOR_PICK_MATERIAL : PICK_MATERIAL,
    )
  }

  proxy.visible = false
  proxy.userData.isPickProxy = true
  proxy.traverse((o) => {
    o.userData.isPickProxy = true
  })
  return proxy
}
