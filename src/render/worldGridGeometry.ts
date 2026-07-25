// World Grid (type = 6) rendering, ported (behavior, not code) from the
// desktop viewport's _draw_world_grid/_grid_plate/_globe_surface/
// _globe_graticule (verified 2026-07-24). Everything is built in ±1 local
// units — the caller scales the returned object by gridDrawScale(node)
// (raw scale × half-spans / globe radius; no base_scale, no 0.2 floor).
//
// Flat form: lattice lines at segments_x/y counts, plus — for a solid
// geometry choice — a double-sided plate. Globe form (sphere geometry): a
// lon/lat graticule and, when solid, a unit sphere. Both draw unlit (Basic
// material) so a map texture reads at full brightness with no day/night
// shading, and a textured surface is left untinted.
//
// Over a solid surface the lattice dims to half opacity and lifts slightly
// off it (z 0.001 / radius 1.002, in local units so the offset scales with
// the grid). Solid surfaces occlude picking (userData.isGridOccluder — see
// pickNodeId); wire forms don't. Grids themselves are never pickable, so no
// pick proxy is created here.

import * as THREE from 'three'
import type { GvNode } from '../gv/types'
import { gridIsGlobe, gridSegments } from '../gv/worldGrid'
import { WIRE_TO_SOLID } from './glyphGeometry'
import { zSphereGeometry } from './uvGeometry'

// Globe tessellation, matching the desktop's density choice.
const GLOBE_SLICES = 48
const GLOBE_STACKS = 24

const DEG = Math.PI / 180

function lineMaterial(color: THREE.Color, opacity: number): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
  })
}

/** Flat-plate lattice: (segX+1) + (segY+1) lines spanning ±1 at height z. */
function plateLatticeGeometry(segX: number, segY: number, z: number): THREE.BufferGeometry {
  const positions: number[] = []
  for (let i = 0; i <= segX; i++) {
    const x = -1 + (2 * i) / segX
    positions.push(x, -1, z, x, 1, z)
  }
  for (let j = 0; j <= segY; j++) {
    const y = -1 + (2 * j) / segY
    positions.push(-1, y, z, 1, y, z)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  return geo
}

/**
 * Globe graticule: segX meridians (full pole-to-pole arcs) and the segY
 * bands' segY−1 interior parallels (poles excluded), as line segments on a
 * sphere of `radius`.
 */
function graticuleGeometry(segX: number, segY: number, radius: number): THREE.BufferGeometry {
  const positions: number[] = []
  const arc = GLOBE_SLICES // vertices per full circle
  const push = (lonDeg: number, latDeg: number) => {
    const lon = lonDeg * DEG
    const lat = latDeg * DEG
    const c = Math.cos(lat)
    positions.push(
      radius * c * Math.cos(lon),
      radius * c * Math.sin(lon),
      radius * Math.sin(lat),
    )
  }
  for (let i = 0; i < segX; i++) {
    const lon = -180 + (360 * i) / segX
    for (let j = 0; j < arc; j++) {
      push(lon, -90 + (180 * j) / arc)
      push(lon, -90 + (180 * (j + 1)) / arc)
    }
  }
  for (let j = 1; j < segY; j++) {
    const lat = -90 + (180 * j) / segY
    for (let i = 0; i < arc; i++) {
      push(-180 + (360 * i) / arc, lat)
      push(-180 + (360 * ((i + 1) % arc)) / arc, lat)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  return geo
}

/**
 * Unit sphere with Z-up poles and KML-aligned equirect UVs — u = (lon+180)/360
 * eastward, v = (lat+90)/180 northward, so lon 0 faces +X at u = 0.5 and a
 * lon/lat map lines up with the KML-placed children on the globe. This is the
 * desktop's own hand-built `_globe_surface` mapping (it bypasses gluSphere,
 * whose longitude is offset and mirrored); zSphereGeometry applies the same
 * convention to every round glyph.
 */
function globeSurfaceGeometry(): THREE.BufferGeometry {
  return zSphereGeometry(1, GLOBE_SLICES, GLOBE_STACKS)
}

/**
 * Renderable World Grid object in ±1 local units. The caller applies
 * gridDrawScale(node) and marks it as the node's glyph.
 */
export function createWorldGridObject(node: GvNode, map?: THREE.Texture): THREE.Object3D {
  const group = new THREE.Group()
  const color = new THREE.Color(node.color.r / 255, node.color.g / 255, node.color.b / 255)
  const alpha = node.color.a / 255
  const wireOnly = node.geometry in WIRE_TO_SOLID
  const globe = gridIsGlobe(node)
  const seg = gridSegments(node)

  if (!wireOnly) {
    const surfaceGeo = globe
      ? globeSurfaceGeometry()
      : new THREE.PlaneGeometry(2, 2)
    const surface = new THREE.Mesh(
      surfaceGeo,
      new THREE.MeshBasicMaterial({
        // A textured grid is NOT tinted by the node colour — the desktop
        // forces glColor4f(1,1,1,a) so the map reads as authored (only alpha
        // still applies). Untextured, the node colour is the surface colour.
        color: map ? 0xffffff : color,
        map,
        transparent: alpha < 1,
        opacity: alpha,
        side: THREE.DoubleSide,
      }),
    )
    surface.name = 'grid-surface'
    // Solid surfaces occlude picking without being pickable themselves.
    surface.userData.isGridOccluder = true
    group.add(surface)
  }

  const lineAlpha = wireOnly ? alpha : alpha * 0.5
  const lines = globe
    ? graticuleGeometry(seg.x, seg.y, wireOnly ? 1.0 : 1.002)
    : plateLatticeGeometry(seg.x, seg.y, wireOnly ? 0 : 0.001)
  group.add(new THREE.LineSegments(lines, lineMaterial(color, lineAlpha)))

  return group
}
