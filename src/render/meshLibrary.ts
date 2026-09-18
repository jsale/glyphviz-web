// Imported meshes, keyed by the `mesh_id` a geometry-23 node names.
//
// The desktop's registry is `Viewport._mesh_paths` / `_mesh_names` plus
// `GeoRenderer._mesh_lists`: ids are handed out 1, 2, 3, … in IMPORT ORDER,
// re-importing a file reuses its id (and re-reads it, so edits on disk show
// up), and nothing about the mapping is persisted — the CSV stores only the id.
// So a scene saved with mesh_id 2 needs its files imported in the same order to
// look the same again, which is why the library OUTLIVES a scene load here, as
// it does there.
//
// On top of that: a scene folder may ship its own mesh files in `meshes/`,
// taking ids 1..N by sorted file name, exactly like `media/` → texture_id. That
// convention began here, because a desktop mesh_id used to name a file only
// through this session's import order; the desktop adopted the same rule on
// 2026-09-16 (`Viewport.load_mesh_folder`), so it is now shared. See
// src/gv/bundle.ts for the sort, which is case-SENSITIVE to match Python's.
//
// One divergence in what a scene folder does to the library: here it REPLACES
// it, where the desktop overwrites ids 1..N and leaves anything above N alone.
// The desktop's version can leave the previous scene's model still registered
// at, say, mesh_id 4, so a node of the NEW scene naming 4 silently wears a
// shape from the old one; clearing shows the sphere fallback instead, which is
// at least visibly "no such mesh". A scene that ships no models still leaves
// the library alone on both sides, so the desktop's real requirement — import a
// model, then open a CSV that references it — is unaffected.

import * as THREE from 'three'
import type { MeshData } from '../gv/meshFile'

export interface MeshAsset {
  /** The `mesh_id` a node references. 1-based, never 0 ("no mesh"). */
  id: number
  /** Display name — the file stem, like the desktop's `MeshData.name`. */
  name: string
  /** What re-imports dedupe on: the desktop's resolved path, a name here. */
  source: string
  geometry: THREE.BufferGeometry
  triangles: number
  /** Facets dropped for NaN/∞ coordinates (see MeshData.droppedTriangles). */
  dropped: number
  /** Facets dropped for having no area (see MeshData.degenerateTriangles). */
  degenerate: number
  /** Whether the file carried texture coordinates — see meshGeometry(). */
  hasUv: boolean
}

/**
 * Turn parsed mesh data into a renderable geometry.
 *
 * Normals come from the file (or the smooth pass in meshFile.ts) rather than
 * `computeVertexNormals`, which would flat-shade the un-indexed STL case and
 * disagree with the desktop.
 */
export function meshGeometry(data: MeshData): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3))
  if (data.uvs) geometry.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2))
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1))
  // Picking raycasts against this geometry, and the bounding volumes are what
  // let it reject a mesh cheaply.
  geometry.computeBoundingSphere()
  geometry.computeBoundingBox()
  return geometry
}

export class MeshLibrary {
  private assets = new Map<number, MeshAsset>()
  private idBySource = new Map<string, number>()
  private nextId = 1

  get size(): number {
    return this.assets.size
  }

  /** Assets in id order, for menus and the scene note. */
  entries(): MeshAsset[] {
    return [...this.assets.values()].sort((a, b) => a.id - b.id)
  }

  get(id: number): MeshAsset | undefined {
    return this.assets.get(id)
  }

  /** id → geometry, the map buildScene resolves a node's mesh_id through. */
  geometries(): Map<number, THREE.BufferGeometry> {
    return new Map([...this.assets].map(([id, asset]) => [id, asset.geometry]))
  }

  /**
   * Register a parsed file, at a given id or the next free one.
   *
   * Re-importing the same source reuses its id and replaces the geometry,
   * matching the desktop's `_mesh_paths` dedupe — so a file edited on disk and
   * re-imported updates every node already pointing at it.
   */
  add(source: string, data: MeshData, id?: number): MeshAsset {
    const assigned = id ?? this.idBySource.get(source) ?? this.nextId
    this.assets.get(assigned)?.geometry.dispose()
    const asset: MeshAsset = {
      id: assigned,
      name: data.name,
      source,
      geometry: meshGeometry(data),
      triangles: data.triangleCount,
      dropped: data.droppedTriangles,
      degenerate: data.degenerateTriangles,
      hasUv: data.uvs !== null,
    }
    this.assets.set(assigned, asset)
    this.idBySource.set(source, assigned)
    this.nextId = Math.max(this.nextId, assigned + 1)
    return asset
  }

  /** Drop every mesh (a scene that ships its own replaces the lot). */
  clear(): void {
    for (const asset of this.assets.values()) asset.geometry.dispose()
    this.assets.clear()
    this.idBySource.clear()
    this.nextId = 1
  }
}

/** One entry of a geometry menu's imported-mesh section. */
export interface MeshChoice {
  meshId: number
  /** Desktop `_mesh_combo_label`: `Mesh 1: teapot`. */
  label: string
}

/**
 * Menu entries for the loaded meshes, plus a placeholder for a mesh_id the
 * current node names but nothing has supplied — the desktop's
 * "Mesh 3 (not loaded)", which exists so a CSV saved with meshes and reopened
 * before re-importing does not misreport its geometry as something else.
 */
export function meshChoices(library: MeshLibrary, current = 0): MeshChoice[] {
  const choices = library.entries().map((a) => ({ meshId: a.id, label: `Mesh ${a.id}: ${a.name}` }))
  if (current > 0 && !library.get(current)) {
    choices.push({ meshId: current, label: `Mesh ${current} (not loaded)` })
    choices.sort((a, b) => a.meshId - b.meshId)
  }
  return choices
}
