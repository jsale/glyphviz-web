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
//   - `validate=True` then drops DEGENERATE triangles — ones with no area to
//     speak of. Not a nicety: a third of the lab's oak canopy is degenerate
//     (21,360 faces in the file, 14,952 with any area), and the desktop draws
//     the smaller number.
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

/**
 * Everything a scene's `meshes/` folder COUNTS — the desktop's
 * `mesh_loader.SUPPORTED_EXTENSIONS`, which is the union of the two sets above.
 *
 * Wider than what this app can parse, deliberately, and the difference matters
 * because `mesh_id` is a file's POSITION in that folder. A `.glb` sitting among
 * the models takes an id on the desktop, so it has to take one here too — skip
 * it and every model sorting after it shifts down by one, and the scene opens
 * wearing the wrong shapes. The web still cannot READ it: it is loaded like any
 * other unreadable file, which reserves the id and reports the reason.
 */
export const SCENE_MESH_EXTENSIONS = [
  ...MESH_EXTENSIONS,
  ...DESKTOP_ONLY_MESH_EXTENSIONS,
] as const

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
  /**
   * Triangles thrown away for having no area — trimesh's `nondegenerate_faces`,
   * which `load_mesh_file` asks for with `validate=True`.
   *
   * Counted separately from droppedTriangles because they mean different things
   * to whoever is importing: a NaN facet is a broken file, a zero-area one is
   * ordinary generator output. Both are invisible; only the first is a warning.
   */
  degenerateTriangles: number
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

/** Whether a `meshes/` entry occupies a mesh_id — see SCENE_MESH_EXTENSIONS. */
export function isSceneMeshFileName(name: string): boolean {
  return (SCENE_MESH_EXTENSIONS as readonly string[]).includes(extensionOf(name))
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
    raw = plyRawMesh(parsePlyFile(new Uint8Array(bytes)))
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

/** The same tolerance as a distance: trimesh's `tol.merge`. */
const MERGE_TOLERANCE = 1e-8

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
  // Both are reassigned when the crease pass splits vertices at hard edges.
  let vertexCount = raw.positions.length / 3
  let positions = Float32Array.from(raw.positions)

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

  // Degenerate faces go before anything reads a face normal: a zero-area
  // triangle has no direction, so every crease test against it fails and its
  // corners would fall back to plain smoothing. Dropping them is also what the
  // desktop does, and the difference is not marginal on generated models.
  const live = nondegenerateFaces(raw.positions, raw.indices, repOf)
  const faceIndices = live.indices
  if (faceIndices.length === 0) {
    throw new Error(
      `No usable triangle mesh found: all ${live.dropped} triangle(s) have no area.`,
    )
  }

  // Crease-angle normals, matching the desktop's mesh_loader._crease_normals.
  //
  // A corner averages only the faces within CREASE_ANGLE_DEG of its OWN face,
  // so a cube keeps square corners while a lofted hull still shades smooth.
  // Before this, every imported model was uniformly smoothed and a cube shaded
  // like a beach ball — the desktop had the same bug and fixed it 2026-09-16.
  //
  // A file's own `vn` lines are deliberately NOT used, because the desktop
  // does not use them either: trimesh recomputes `vertex_normals` on load, so
  // an OBJ's stated normals never reach the desktop screen. Honouring them
  // here would make the two apps shade the same file differently, which is the
  // one thing this port exists to prevent.
  let normals: Float32Array
  let indicesOut = Uint32Array.from(faceIndices)
  let uvsOut = raw.uvs ? Float32Array.from(raw.uvs) : null

  const corner = creaseCornerNormals(raw.positions, faceIndices, repOf, vertexCount)
  if (corner) {
    // Per-corner normals need vertices split wherever two corners at one
    // position disagree — that split IS the hard edge. Smooth regions collapse
    // straight back to the merged count, so a sphere costs nothing here and a
    // cube grows from 8 vertices to 24.
    const split = splitByCornerNormal(positions, corner, faceIndices, uvsOut)
    positions = split.positions
    normals = split.normals
    indicesOut = split.indices
    uvsOut = split.uvs
    vertexCount = split.vertexCount
  } else {
    normals = smoothNormals(raw.positions, faceIndices, repOf, vertexCount)
  }

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
    uvs: uvsOut,
    indices: indicesOut,
    triangleCount: faceIndices.length / 3,
    vertexCount,
    droppedTriangles: dropped,
    degenerateTriangles: live.dropped,
  }
}

/**
 * Two faces meeting at a sharper angle than this are a CREASE: the edge
 * between them stays hard instead of being shaded as one smooth surface.
 *
 * 40 degrees is `mesh_loader.DEFAULT_CREASE_ANGLE` on the desktop, and the
 * value has to match or the two apps shade the same file differently.
 */
export const CREASE_ANGLE_DEG = 40

/** Normals closer than this are treated as the same normal when splitting. */
const NORMAL_DIGITS = 1e4

/**
 * Per-CORNER normals that keep sharp edges sharp — the desktop's
 * `mesh_loader._crease_normals`, corner for corner.
 *
 * Each corner averages only those faces incident to its (merged) vertex whose
 * normal is within `CREASE_ANGLE_DEG` of the corner's OWN face normal, weighted
 * by twice-area. Area weighting rather than the angle weighting `smoothNormals`
 * uses is deliberate: it is what the desktop does, and it keeps a large panel
 * from being dragged around by the slivers along its edge.
 *
 * Returns (T·3·3) — three normals per triangle, in corner order — or null when
 * the mesh is degenerate enough that smooth per-vertex normals are the safer
 * answer, which is also the desktop's fallback.
 */
export function creaseCornerNormals(
  positions: readonly number[],
  indices: readonly number[],
  repOf: Int32Array,
  vertexCount: number,
): Float32Array | null {
  const faceCount = indices.length / 3
  if (faceCount === 0) return null

  // Face normals and twice-areas.
  const fn = new Float64Array(faceCount * 3)
  const fw = new Float64Array(faceCount)
  let live = 0
  for (let f = 0; f < faceCount; f++) {
    const a = indices[f * 3] * 3
    const b = indices[f * 3 + 1] * 3
    const c = indices[f * 3 + 2] * 3
    const e1x = positions[b] - positions[a]
    const e1y = positions[b + 1] - positions[a + 1]
    const e1z = positions[b + 2] - positions[a + 2]
    const e2x = positions[c] - positions[a]
    const e2y = positions[c + 1] - positions[a + 1]
    const e2z = positions[c + 2] - positions[a + 2]
    const nx = e1y * e2z - e1z * e2y
    const ny = e1z * e2x - e1x * e2z
    const nz = e1x * e2y - e1y * e2x
    const len = Math.hypot(nx, ny, nz)
    fw[f] = len
    if (len > 1e-20) {
      fn[f * 3] = nx / len
      fn[f * 3 + 1] = ny / len
      fn[f * 3 + 2] = nz / len
      live++
    }
  }
  if (live === 0) return null

  // Faces incident to each merged vertex, as a CSR-style table — the same
  // structure the desktop builds with numpy, so the cost stays linear instead
  // of rescanning every face per corner.
  const counts = new Int32Array(vertexCount)
  for (let f = 0; f < faceCount; f++) {
    for (let c = 0; c < 3; c++) counts[repOf[indices[f * 3 + c]]]++
  }
  const starts = new Int32Array(vertexCount + 1)
  for (let v = 0; v < vertexCount; v++) starts[v + 1] = starts[v] + counts[v]
  const cursor = Int32Array.from(starts.subarray(0, vertexCount))
  const incident = new Int32Array(indices.length)
  for (let f = 0; f < faceCount; f++) {
    for (let c = 0; c < 3; c++) incident[cursor[repOf[indices[f * 3 + c]]]++] = f
  }

  const cosT = Math.cos((CREASE_ANGLE_DEG * Math.PI) / 180)
  const out = new Float32Array(faceCount * 9)
  for (let f = 0; f < faceCount; f++) {
    const ox = fn[f * 3]
    const oy = fn[f * 3 + 1]
    const oz = fn[f * 3 + 2]
    // A DEGENERATE face has no direction of its own, so it has nothing to
    // compare its neighbours against: every one of them fails the crease test
    // and the corner would come out (0, 0, 0) — a silently black vertex.
    // Fall back to the plain average of every live face at that vertex, i.e.
    // smooth shading, which is the right answer for a sliver anyway.
    //
    // finishMesh drops such faces before calling this (nondegenerateFaces,
    // which is what the desktop's validate=True does), so the guard is for a
    // caller that has not — this function takes any index list.
    const degenerate = fw[f] <= 1e-20
    for (let c = 0; c < 3; c++) {
      const v = repOf[indices[f * 3 + c]]
      let ax = 0
      let ay = 0
      let az = 0
      for (let k = starts[v]; k < starts[v + 1]; k++) {
        const g = incident[k]
        if (fw[g] <= 1e-20) continue
        const gx = fn[g * 3]
        const gy = fn[g * 3 + 1]
        const gz = fn[g * 3 + 2]
        if (!degenerate && gx * ox + gy * oy + gz * oz < cosT) continue
        ax += gx * fw[g]
        ay += gy * fw[g]
        az += gz * fw[g]
      }
      let len = Math.hypot(ax, ay, az)
      if (len <= 1e-12) {
        // The neighbourhood cancelled out (coincident faces wound opposite,
        // or a zero-area face): keep the corner's own face normal.
        ax = ox
        ay = oy
        az = oz
        len = Math.hypot(ax, ay, az) || 1
      }
      const o = f * 9 + c * 3
      out[o] = ax / len
      out[o + 1] = ay / len
      out[o + 2] = az / len
    }
  }
  return out
}

/**
 * Split vertices wherever two corners sharing a position carry different
 * normals — which is exactly where a hard edge is.
 *
 * The desktop needs no equivalent: it emits normals per corner straight into a
 * display list, so its geometry is effectively un-indexed. WebGL wants one
 * normal per vertex, so the split is how the same shading is expressed here.
 * A smooth region collapses back to one vertex per position, so this costs
 * nothing on organic models and triples only the genuinely faceted ones.
 */
export function splitByCornerNormal(
  positions: Float32Array,
  corner: Float32Array,
  indices: readonly number[],
  uvs: Float32Array | null,
): {
  // Explicit <ArrayBuffer> rather than bare Float32Array: TypeScript's typed
  // arrays are generic over their buffer, and a bare annotation widens to
  // ArrayBufferLike, which then will not assign back to the ArrayBuffer-backed
  // locals in buildMesh.
  positions: Float32Array<ArrayBuffer>
  normals: Float32Array<ArrayBuffer>
  uvs: Float32Array<ArrayBuffer> | null
  indices: Uint32Array<ArrayBuffer>
  vertexCount: number
} {
  const outPos: number[] = []
  const outNrm: number[] = []
  const outUv: number[] | null = uvs ? [] : null
  const outIdx = new Uint32Array(indices.length)
  const seen = new Map<string, number>()

  for (let i = 0; i < indices.length; i++) {
    const v = indices[i]
    const o = i * 3
    const nx = corner[o]
    const ny = corner[o + 1]
    const nz = corner[o + 2]
    const key = `${v}|${Math.round(nx * NORMAL_DIGITS)},${Math.round(
      ny * NORMAL_DIGITS,
    )},${Math.round(nz * NORMAL_DIGITS)}`
    let at = seen.get(key)
    if (at === undefined) {
      at = outPos.length / 3
      seen.set(key, at)
      outPos.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2])
      outNrm.push(nx, ny, nz)
      if (outUv && uvs) outUv.push(uvs[v * 2], uvs[v * 2 + 1])
    }
    outIdx[i] = at
  }

  return {
    positions: new Float32Array(outPos),
    normals: new Float32Array(outNrm),
    uvs: outUv ? new Float32Array(outUv) : null,
    indices: outIdx,
    vertexCount: outPos.length / 3,
  }
}

/**
 * Faces with any area, in trimesh's terms — `triangles.nondegenerate`, which
 * `load_mesh_file` reaches through `validate=True`.
 *
 * The test is NOT area: it is the two heights of the triangle's own oriented
 * bounding box, `2·area / |edge|` for each of the two edges from corner 0, both
 * of which must exceed the merge tolerance. So a long thin sliver with a real
 * width survives while three collinear points do not, which is the distinction
 * "area > 0" cannot make at floating-point scale.
 *
 * Positions are read through `repOf`, i.e. at their MERGED representative,
 * because that is the mesh trimesh runs this on — two corners a nanometre apart
 * are one corner by then, and the triangle they sit on has genuinely collapsed.
 *
 * Run in the file's OWN units, before normalization, again matching the
 * desktop: the tolerance is absolute, so scaling first would change the answer.
 */
export function nondegenerateFaces(
  positions: readonly number[],
  indices: readonly number[],
  repOf: Int32Array,
): { indices: number[]; dropped: number } {
  const out: number[] = []
  let dropped = 0
  const at = (i: number, a: number) => positions[repOf[indices[i]] * 3 + a]
  for (let f = 0; f < indices.length; f += 3) {
    const ax = at(f + 1, 0) - at(f, 0)
    const ay = at(f + 1, 1) - at(f, 1)
    const az = at(f + 1, 2) - at(f, 2)
    const bx = at(f + 2, 0) - at(f, 0)
    const by = at(f + 2, 1) - at(f, 1)
    const bz = at(f + 2, 2) - at(f, 2)
    const cross = Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx)
    const lenA = Math.hypot(ax, ay, az)
    const lenB = Math.hypot(bx, by, bz)
    const heightA = lenA > MERGE_TOLERANCE ? cross / lenA : 0
    const heightB = lenB > MERGE_TOLERANCE ? cross / lenB : 0
    if (heightA > MERGE_TOLERANCE && heightB > MERGE_TOLERANCE) {
      out.push(indices[f], indices[f + 1], indices[f + 2])
    } else {
      dropped++
    }
  }
  return { indices: out, dropped }
}

/**
 * A parsed PLY as a RawMesh, texture coordinates included.
 *
 * PLY never settled on where UVs live, so a file carries them either on its
 * vertices or, more often, per FACE CORNER — and trimesh reads both, which is
 * what the desktop draws. The per-corner form has to be unpicked here: two
 * corners at one position may name different coordinates, which is what a UV
 * seam IS, and a seam is only expressible as two vertices. So each distinct
 * (vertex, u, v) triple becomes its own vertex, exactly as parseObj already
 * does for a distinct `v/vt` pair, and for the same reason.
 *
 * Splitting here costs the shading nothing: finishMesh's crease pass groups
 * corners by POSITION, so a seam does not become a crease.
 */
function plyRawMesh(ply: ReturnType<typeof parsePlyFile>): RawMesh {
  const indices = ply.indices ? Array.from(ply.indices) : []
  if (!ply.cornerUvs || indices.length === 0) {
    return {
      positions: Array.from(ply.positions),
      uvs: ply.uvs ? Array.from(ply.uvs) : null,
      normals: null,
      indices,
    }
  }

  const positions: number[] = []
  const uvs: number[] = []
  const out: number[] = []
  const seen = new Map<string, number>()
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i]
    const u = ply.cornerUvs[i * 2]
    const w = ply.cornerUvs[i * 2 + 1]
    const key = `${v}|${u}|${w}`
    let at = seen.get(key)
    if (at === undefined) {
      at = positions.length / 3
      seen.set(key, at)
      positions.push(ply.positions[v * 3], ply.positions[v * 3 + 1], ply.positions[v * 3 + 2])
      uvs.push(u, w)
    }
    out.push(at)
  }
  return { positions, uvs, normals: null, indices: out }
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
