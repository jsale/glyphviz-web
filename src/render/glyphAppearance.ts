// Per-frame colour, opacity and texture writes onto ONE glyph's materials.
//
// buildScene caches materials by (colour, opacity, side, map), which is what
// keeps 209k glyphs affordable — but a channel animating one node's colour
// would then repaint every node sharing that material, or mint a cache entry
// per frame. So an animated glyph gets PRIVATE clones first, and only those are
// written. Two callers share this: DynamicNodes (an ordinary node's glyph) and
// the link overlay (a link drawn as a stretched glyph), which is why it is its
// own module rather than living in either — linkOverlay sits under buildScene,
// and dynamicNodes imports buildScene, so neither can import the other.

import * as THREE from 'three'
import type { GvNode } from '../gv/types'
import { setNaturalTransparency } from './renderMode'

/** A solid glyph material with a `map` slot, lit or unlit. */
export type MappedMaterial = THREE.MeshLambertMaterial | THREE.MeshBasicMaterial

export interface PrivateMaterials {
  /** Every cloned material, for colour/opacity writes and disposal. */
  materials: THREE.Material[]
  /**
   * The ones that carry a map — only solid meshes are ever textured. Basic as
   * well as Lambert, since the interior shapes draw unlit (glyphGeometry.ts)
   * and a 360° video is exactly the case a channel-animated texture_id serves.
   */
  mapped: MappedMaterial[]
}

/**
 * Give `glyph` its own materials, so per-frame writes cannot reach every other
 * node that happened to look the same. Pick proxies keep the shared invisible
 * material — they are never drawn. Null when there is nothing to clone.
 */
export function privatiseGlyphMaterials(glyph: THREE.Object3D): PrivateMaterials | null {
  const materials: THREE.Material[] = []
  const mapped: MappedMaterial[] = []
  glyph.traverse((object) => {
    if (object.userData.isPickProxy) return
    const drawable = object as THREE.Object3D & { material?: THREE.Material | THREE.Material[] }
    const material = drawable.material
    if (!material || Array.isArray(material)) return
    const clone = material.clone()
    drawable.material = clone
    materials.push(clone)
    if (clone instanceof THREE.MeshLambertMaterial || clone instanceof THREE.MeshBasicMaterial) {
      mapped.push(clone)
    }
  })
  return materials.length === 0 ? null : { materials, mapped }
}

/**
 * Write `node`'s current colour, opacity and texture onto privatised materials.
 */
export function applyGlyphAppearance(
  privateMaterials: PrivateMaterials,
  node: GvNode,
  textures: ReadonlyMap<number, THREE.Texture>,
): void {
  const opacity = node.color.a / 255
  const r = node.color.r / 255
  const g = node.color.g / 255
  const b = node.color.b / 255
  for (const material of privateMaterials.materials) {
    material.opacity = opacity
    // NOT a plain assignment: three bakes transparency into the shader
    // program, so a glyph whose CSV alpha was 255 would go on drawing solid
    // at opacity 0 (Breathing_Century's whole animation is that flip).
    setNaturalTransparency(material, opacity < 1)
    const colored = material as THREE.Material & { color?: THREE.Color }
    colored.color?.setRGB(r, g, b)
  }
  const texture = node.textureId > 0 ? (textures.get(node.textureId) ?? null) : null
  for (const material of privateMaterials.mapped) {
    if ((material.map === null) !== (texture === null)) {
      // Gaining or losing a map flips the USE_MAP define — that one needs a
      // recompile. Swapping one texture for another does not, which is what
      // makes a flip-book affordable.
      material.needsUpdate = true
    }
    material.map = texture
  }
}
