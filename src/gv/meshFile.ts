// Imported 3D model files (.obj / .stl / .ply) for geometry 23 (Mesh).
//
// Behavior ported (not code) from the desktop app's
// glyphviz_core/mesh_loader.py, which hands the file to trimesh and then
// normalizes it "to the same unit-scale convention every other GEO_* shape
// uses (fits within radius ~1), so it composes with a node's scale_x/y/z
// exactly like the built-in glyphs":
//
//   center = bounding_box.centroid   (the AABB centre, not the centroid of mass)
//   verts -= center
//   verts /= max(|v|)
//
// Two details of trimesh's defaults are part of that behavior and are
// reproduced here, because they are what the desktop actually draws:
//
//   - `trimesh.load(process=True)` MERGES duplicate vertices. An STL has no
//     shared vertices at all, so this is what turns 3N loose corners into a
//     connected surface.
//   - `Trimesh.vertex_normals` is then the ANGLE-WEIGHTED mean of the adjacent
//     face normals over those merged vertices — i.e. smooth shading. A desktop
//     STL glyph is smooth-shaded, not faceted, and an STL's own facet normals
//     never reach the screen.
//
// PLY joined .obj and .stl when the point-cloud importer arrived (roadmap: W2):
// its vertex table is a cloud and its face table is a mesh, so one reader in
// src/io/plyFile.ts serves both and the format stopped being a refusal.
//
// Pure data — no THREE, no DOM — so the whole parse is testable in plain node.
// src/render/meshLibrary.ts turns the result into a BufferGeometry.

import { parsePlyFile } from '../io/plyFile'

/** Extensions this app can parse. */
export const MESH_EXTENSIONS = ['.obj', '.stl', '.ply'] as const

/**
 * Extensions the DESKTOP accepts (trimesh gets glTF for free) that this app does
 * not parse yet. Named so an import can say which it is, rather than refusing an
 * .stl and a .glb with the same unhelpful message.
 */
export const DESKTOP_ONLY_MESH_EXTENSIONS = ['.glb', '.gltf'] as const

export interface MeshData {
  /** File stem, like the desktop's `MeshData.name` (`Path(path).stem`). */
  name: string
  /** (V·3) vertex positions, centred and scaled to radius ~1. */
  positions: Float32Array
  /** (V·3) smooth per-vertex normals — see the header. */
  normals: Float32Array
  /** (V·2) texture coordinates when the file carried them, else null. */
  uvs: Float32Array | null
  /** (T·3) triangle indices into the vertex arrays. */
  indices: Uint32Array
  triangleCount: number
  vertexCount: number
  /**
   * Triangles thrown away for carrying NaN/∞ coordinates — trimesh's
   * `remove_infinite_values`, which runs as part of the same `process=True`
   * the merge does. Real files need it: the VTK-generated isosurface2.stl in
   * Jeff's examples folder has 6,929 such facets out of 32,828, and one NaN
   * left in poisons the bounding box, so the whole model would vanish.
   */
  droppedTriangles: number
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot).toLowerCase()
}

export function stemOf(name: string): string {
  const base = name.slice(name.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot === -1 ? base : base.slice(0, dot)
}

export function isMeshFileName(name: string): boolean {
  return (MESH_EXTENSIONS as readonly string[]).includes(extensionOf(name))
}

export function isDesktopOnlyMeshFileName(name: string): boolean {
  return (DESKTOP_ONLY_MESH_EXTENSIONS as readonly string[]).includes(extensionOf(name))
}

// --- Raw triangle soup -------------------------------------------------------
// Both parsers produce this shape; the merge/normal/normalize tail is shared.

interface RawMesh {
  /** Flat (V·3) vertex positions in the file's own units. */
  positions: number[]
  /** (V·2) texture coordinates, or null when the file has none. */
  uvs: number[] | null
  /** File-supplied per-vertex normals (OBJ `vn`), or null. */
  normals: number[] | null
  /** (T·3) indices into the above. */
  indices: number[]
}

/**
 * Parse a model file into the desktop's unit-scale convention.
 *
 * `name` decides the format by extension (with an STL binary/ASCII sniff);
 * throws with a readable reason when the bytes are not a usable triangle mesh,
 * matching the desktop's `ValueError(f"No usable triangle mesh found in …")`.
 */
export function parseMeshFile(name: string, bytes: ArrayBuffer): MeshData {
  const ext = extensionOf(name)
  let raw: RawMesh
  if (ext === '.obj') {
    raw = parseObj(decodeText(bytes))
  } else if (ext === '.stl') {
    raw = looksLikeBinaryStl(bytes) ? parseBinaryStl(bytes) : parseAsciiStl(decodeText(bytes))
  } else if (ext === '.ply') {
    // PLY came in with the point-cloud importer, which needs the same parser for
    // the vertex table (src/io/plyFile.ts); reading the FACE table too is what
    // turned a refusal into a format. A PLY with no faces is a point cloud, and
    // falls through to the "no usable triangle mesh" message below — which is
    // the honest answer for something asked to be a mesh glyph.
    const ply = parsePlyFile(new Uint8Array(bytes))
    raw = {
      positions: Array.from(ply.positions),
      uvs: null,
      normals: null,
      indices: ply.indices ? Array.from(ply.indices) : [],
    }
  } else if (isDesktopOnlyMeshFileName(name)) {
    throw new Error(
      `${ext} is not supported in the web app yet — desktop GlyphViz reads it through trimesh. ` +
        'Export as .obj, .stl or .ply.',
    )
  } else {
    throw new Error(`Unsupported mesh format "${ext || name}". Use .obj, .stl or .ply.`)
  }

  if (raw.indices.length === 0) {
    throw new Error(`No usable triangle mesh found in ${name}.`)
  }
  return finishMesh(stemOf(name), raw)
}

function decodeText(bytes: ArrayBuffer): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

// --- STL ---------------------------------------------------------------------

/**
 * A binary STL is exactly 80 header + 4 count + 50 bytes per triangle. That
 * exact-length test is the reliable discriminator: an ASCII file can also start
 * with "solid" (binary files written by some exporters do too), but only a
 * binary one has a length its own triangle count predicts.
 */
export function looksLikeBinaryStl(bytes: ArrayBuffer): boolean {
  if (bytes.byteLength < 84) return false
  const count = new DataView(bytes).getUint32(80, true)
  return 84 + count * 50 === bytes.byteLength
}

function parseBinaryStl(bytes: ArrayBuffer): RawMesh {
  const view = new DataView(bytes)
  const count = view.getUint32(80, true)
  const positions: number[] = []
  const indices: number[] = []
  let offset = 84
  for (let t = 0; t < count; t++) {
    // The facet normal at `offset` is deliberately skipped: trimesh recomputes
    // vertex normals from the merged winding, so the file's own never draws.
    offset += 12
    const base = positions.length / 3
    for (let v = 0; v < 3; v++) {
      positions.push(
        view.getFloat32(offset, true),
        view.getFloat32(offset + 4, true),
        view.getFloat32(offset + 8, true),
      )
      offset += 12
    }
    indices.push(base, base + 1, base + 2)
    offset += 2 // attribute byte count
  }
  return { positions, uvs: null, normals: null, indices }
}

function parseAsciiStl(text: string): RawMesh {
  const positions: number[] = []
  const indices: number[] = []
  let pending = 0
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('vertex')) continue
    const parts = trimmed.split(/\s+/)
    const x = Number(parts[1])
    const y = Number(parts[2])
    const z = Number(parts[3])
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue
    positions.push(x, y, z)
    // Facets are triangles by definition; take every third vertex as a face.
    if (++pending === 3) {
      const base = positions.length / 3 - 3
      indices.push(base, base + 1, base + 2)
      pending = 0
    }
  }
  return { positions, uvs: null, normals: null, indices }
}

// --- OBJ ---------------------------------------------------------------------

/** Resolve an OBJ index: 1-based, or negative counting back from the end. */
function objIndex(token: string, count: number): number {
  const i = Number(token)
  if (!Number.isFinite(i) || i === 0) return -1
  return i > 0 ? i - 1 : count + i
}

/**
 * Parse an OBJ's `v`/`vt`/`vn`/`f` records.
 *
 * Faces with more than three corners are fanned into triangles (the convention
 * every OBJ reader uses, and what trimesh's own loader does). A vertex is split
 * per distinct `v/vt/vn` triple, so a seam in the UVs stays a seam; the smooth
 * normal pass below then re-merges by POSITION, which is why splitting here
 * costs nothing in shading.
 */
export function parseObj(text: string): RawMesh {
  const v: number[] = []
  const vt: number[] = []
  const vn: number[] = []

  const positions: number[] = []
  const uvs: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  const indexByKey = new Map<string, number>()
  let anyUv = false
  let allNormals = true

  const vertexFor = (token: string): number => {
    const hit = indexByKey.get(token)
    if (hit !== undefined) return hit
    const parts = token.split('/')
    const pi = objIndex(parts[0], v.length / 3)
    if (pi < 0 || pi * 3 + 2 >= v.length) return -1
    positions.push(v[pi * 3], v[pi * 3 + 1], v[pi * 3 + 2])

    const ti = parts.length > 1 && parts[1] !== '' ? objIndex(parts[1], vt.length / 2) : -1
    if (ti >= 0 && ti * 2 + 1 < vt.length) {
      uvs.push(vt[ti * 2], vt[ti * 2 + 1])
      anyUv = true
    } else {
      uvs.push(0, 0)
    }

    const ni = parts.length > 2 && parts[2] !== '' ? objIndex(parts[2], vn.length / 3) : -1
    if (ni >= 0 && ni * 3 + 2 < vn.length) {
      normals.push(vn[ni * 3], vn[ni * 3 + 1], vn[ni * 3 + 2])
    } else {
      normals.push(0, 0, 0)
      allNormals = false
    }

    const index = positions.length / 3 - 1
    indexByKey.set(token, index)
    return index
  }

  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const parts = trimmed.split(/\s+/)
    switch (parts[0]) {
      case 'v':
        v.push(Number(parts[1]) || 0, Number(parts[2]) || 0, Number(parts[3]) || 0)
        break
      case 'vt':
        vt.push(Number(parts[1]) || 0, Number(parts[2]) || 0)
        break
      case 'vn':
        vn.push(Number(parts[1]) || 0, Number(parts[2]) || 0, Number(parts[3]) || 0)
        break
      case 'f': {
        const corners: number[] = []
        for (let i = 1; i < parts.length; i++) {
          const index = vertexFor(parts[i])
          if (index >= 0) corners.push(index)
        }
        for (let i = 2; i < corners.length; i++) {
          indices.push(corners[0], corners[i - 1], corners[i])
        }
        break
      }
      default:
        // mtllib / usemtl / o / g / s: materials and grouping have no place in
        // a glyph, whose colour is the node's own color_r/g/b.
        break
    }
  }

  return {
    positions,
    uvs: anyUv ? uvs : null,
    normals: allNormals && positions.length > 0 ? normals : null,
    indices,
  }
}

// --- Merge, smooth normals, normalize ----------------------------------------

/**
 * Quantization used to decide "the same vertex", matching trimesh's default
 * merge tolerance (`tol.merge` = 1e-8, applied as decimal digits).
 */
const MERGE_DIGITS = 1e8

/**
 * Drop triangles with a non-finite coordinate, then compact away every vertex
 * no surviving triangle references.
 *
 * Both halves are trimesh's: `remove_infinite_values` takes out the faces, and
 * bounds/extents are measured over REFERENCED vertices only — so an orphaned
 * NaN can neither shift the centre nor blow up the radius.
 */
function pruneMesh(raw: RawMesh): { raw: RawMesh; dropped: number } {
  const finite = (i: number) =>
    Number.isFinite(raw.positions[i * 3]) &&
    Number.isFinite(raw.positions[i * 3 + 1]) &&
    Number.isFinite(raw.positions[i * 3 + 2])

  const kept: number[] = []
  let dropped = 0
  for (let f = 0; f < raw.indices.length; f += 3) {
    if (finite(raw.indices[f]) && finite(raw.indices[f + 1]) && finite(raw.indices[f + 2])) {
      kept.push(raw.indices[f], raw.indices[f + 1], raw.indices[f + 2])
    } else {
      dropped++
    }
  }
  if (dropped === 0 && kept.length === raw.indices.length) {
    // Nothing was cut, but vertices no face uses may still be in the file.
    const referenced = new Set(kept)
    if (referenced.size === raw.positions.length / 3) return { raw, dropped: 0 }
  }

  const remap = new Map<number, number>()
  const positions: number[] = []
  const uvs: number[] | null = raw.uvs ? [] : null
  const normals: number[] | null = raw.normals ? [] : null
  const indices = kept.map((old) => {
    const hit = remap.get(old)
    if (hit !== undefined) return hit
    const index = positions.length / 3
    positions.push(raw.positions[old * 3], raw.positions[old * 3 + 1], raw.positions[old * 3 + 2])
    if (uvs && raw.uvs) uvs.push(raw.uvs[old * 2], raw.uvs[old * 2 + 1])
    if (normals && raw.normals) {
      normals.push(raw.normals[old * 3], raw.normals[old * 3 + 1], raw.normals[old * 3 + 2])
    }
    remap.set(old, index)
    return index
  })
  return { raw: { positions, uvs, normals, indices }, dropped }
}

function finishMesh(name: string, input: RawMesh): MeshData {
  const { raw, dropped } = pruneMesh(input)
  if (raw.indices.length === 0) {
    throw new Error(
      dropped > 0
        ? `Every triangle in this file has NaN or infinite coordinates (${dropped} of them).`
        : 'No usable triangle mesh found.',
    )
  }
  const vertexCount = raw.positions.length / 3
  const positions = Float32Array.from(raw.positions)

  // Merge by position: trimesh's process=True does this on load, and it is
  // what makes an STL (3 loose corners per facet) a connected, smooth surface.
  const repOf = new Int32Array(vertexCount)
  const repByKey = new Map<string, number>()
  for (let i = 0; i < vertexCount; i++) {
    const key = `${Math.round(raw.positions[i * 3] * MERGE_DIGITS)},${Math.round(
      raw.positions[i * 3 + 1] * MERGE_DIGITS,
    )},${Math.round(raw.positions[i * 3 + 2] * MERGE_DIGITS)}`
    const hit = repByKey.get(key)
    if (hit === undefined) {
      repByKey.set(key, i)
      repOf[i] = i
    } else {
      repOf[i] = hit
    }
  }

  // A file's own normals are used only if they are all usable; one NaN `vn`
  // would otherwise shade part of the model black.
  const fileNormals = raw.normals?.every((v) => Number.isFinite(v)) ? raw.normals : null
  const normals = fileNormals
    ? Float32Array.from(fileNormals)
    : smoothNormals(raw.positions, raw.indices, repOf, vertexCount)

  // Desktop normalization: centre on the AABB centre, then divide by the
  // farthest vertex so the glyph fits within radius ~1 like every built-in
  // shape. Uniform, so the normals above are untouched by it.
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (let i = 0; i < vertexCount; i++) {
    const x = positions[i * 3]
    const y = positions[i * 3 + 1]
    const z = positions[i * 3 + 2]
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (z < minZ) minZ = z
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
    if (z > maxZ) maxZ = z
  }
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const cz = (minZ + maxZ) / 2
  let radius = 0
  for (let i = 0; i < vertexCount; i++) {
    const x = positions[i * 3] - cx
    const y = positions[i * 3 + 1] - cy
    const z = positions[i * 3 + 2] - cz
    radius = Math.max(radius, Math.hypot(x, y, z))
  }
  const k = radius > 1e-12 ? 1 / radius : 1
  for (let i = 0; i < vertexCount; i++) {
    positions[i * 3] = (positions[i * 3] - cx) * k
    positions[i * 3 + 1] = (positions[i * 3 + 1] - cy) * k
    positions[i * 3 + 2] = (positions[i * 3 + 2] - cz) * k
  }

  return {
    name,
    positions,
    normals,
    uvs: raw.uvs ? Float32Array.from(raw.uvs) : null,
    indices: Uint32Array.from(raw.indices),
    triangleCount: raw.indices.length / 3,
    vertexCount,
    droppedTriangles: dropped,
  }
}

/**
 * Angle-weighted vertex normals over the merged vertices — trimesh's
 * `weighted_vertex_normals`, which is what `Trimesh.vertex_normals` returns.
 *
 * Weighting by the triangle's interior angle at the corner (rather than a plain
 * mean of adjacent face normals) is what keeps a fan of thin triangles from
 * dragging a vertex normal toward the direction it happens to be tessellated
 * in. Degenerate triangles contribute nothing.
 */
function smoothNormals(
  positions: readonly number[],
  indices: readonly number[],
  repOf: Int32Array,
  vertexCount: number,
): Float32Array {
  const acc = new Float64Array(vertexCount * 3)
  const ax = [0, 0, 0]
  const ay = [0, 0, 0]
  const az = [0, 0, 0]

  for (let f = 0; f < indices.length; f += 3) {
    for (let c = 0; c < 3; c++) {
      const i = indices[f + c]
      ax[c] = positions[i * 3]
      ay[c] = positions[i * 3 + 1]
      az[c] = positions[i * 3 + 2]
    }
    // Face normal from the winding (right-handed, like trimesh's own).
    const e1x = ax[1] - ax[0]
    const e1y = ay[1] - ay[0]
    const e1z = az[1] - az[0]
    const e2x = ax[2] - ax[0]
    const e2y = ay[2] - ay[0]
    const e2z = az[2] - az[0]
    let nx = e1y * e2z - e1z * e2y
    let ny = e1z * e2x - e1x * e2z
    let nz = e1x * e2y - e1y * e2x
    const len = Math.hypot(nx, ny, nz)
    if (len < 1e-20) continue // degenerate: no orientation to contribute
    nx /= len
    ny /= len
    nz /= len

    for (let c = 0; c < 3; c++) {
      const p = (c + 1) % 3
      const q = (c + 2) % 3
      let ux = ax[p] - ax[c]
      let uy = ay[p] - ay[c]
      let uz = az[p] - az[c]
      let vx = ax[q] - ax[c]
      let vy = ay[q] - ay[c]
      let vz = az[q] - az[c]
      const ul = Math.hypot(ux, uy, uz)
      const vl = Math.hypot(vx, vy, vz)
      if (ul < 1e-20 || vl < 1e-20) continue
      ux /= ul
      uy /= ul
      uz /= ul
      vx /= vl
      vy /= vl
      vz /= vl
      const angle = Math.acos(Math.min(1, Math.max(-1, ux * vx + uy * vy + uz * vz)))
      const rep = repOf[indices[f + c]] * 3
      acc[rep] += nx * angle
      acc[rep + 1] += ny * angle
      acc[rep + 2] += nz * angle
    }
  }

  const out = new Float32Array(vertexCount * 3)
  for (let i = 0; i < vertexCount; i++) {
    const rep = repOf[i] * 3
    const x = acc[rep]
    const y = acc[rep + 1]
    const z = acc[rep + 2]
    const len = Math.hypot(x, y, z)
    if (len > 1e-20) {
      out[i * 3] = x / len
      out[i * 3 + 1] = y / len
      out[i * 3 + 2] = z / len
    } else {
      // A vertex only ever touched by degenerate faces. Any unit vector beats
      // a zero normal, which shades as pure black.
      out[i * 3 + 2] = 1
    }
  }
  return out
}
