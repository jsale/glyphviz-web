// Pushing animated node values onto the live scene graph — without rebuilding.
//
// Channels (and rate integration) mutate GvNode rows up to 60 times a second.
// buildScene is far too expensive to run at that rate: it allocates a frame,
// geometry lookup and material per node, and Event_Cloud is 209k of them. So a
// scene with animation registers its *dynamic* nodes here once per rebuild, and
// each tick only those nodes' Object3Ds are touched.
//
// This mirrors the desktop's own answer — set_channel_dynamic_nodes pulls bound
// nodes out of the baked display list so they draw immediate per frame — but
// needs less of it: children hang off their parent's Object3D here, so moving a
// bound node moves its whole subtree for free, where the desktop has to mark
// descendants dynamic too.
//
// Materials are the one place where the shared-everything build has to be
// undone. buildScene caches materials by (colour, opacity, side, map), which is
// what keeps 209k glyphs affordable — but a colour track would then either
// repaint every node sharing that material or mint a new cache entry per frame
// (an unbounded leak over a long animation). Nodes with an appearance binding
// therefore get a PRIVATE clone of each of their materials, mutated in place.

import * as THREE from 'three'
import type { GvNode } from '../gv/types'
import { NodeType } from '../gv/types'
import { gridDrawScale } from '../gv/worldGrid'
import { applyFrameTransform, drawScaleCorrection } from './buildScene'
import { setNaturalTransparency } from './renderMode'

export interface DynamicSets {
  /** Nodes whose translate/rotate/scale can change. */
  transform: ReadonlySet<number>
  /** Nodes whose colour, opacity or texture_id can change. */
  appearance: ReadonlySet<number>
  /** Nodes whose scale can change — the 0.2 draw floor is scale-dependent, so
   *  their glyph correction (and every descendant glyph's) has to follow. */
  scaled: ReadonlySet<number>
}

interface TransformEntry {
  node: GvNode
  frame: THREE.Object3D
  parent: GvNode | null
}

interface AppearanceEntry {
  node: GvNode
  /** Private clones of this glyph's materials. */
  materials: THREE.Material[]
  /** Materials that carry a map — only solid meshes are ever textured. */
  mapped: THREE.MeshLambertMaterial[]
}

interface ScaleEntry {
  node: GvNode
  frame: THREE.Object3D
  glyph: THREE.Object3D
}

/**
 * The animated slice of one built scene. Rebuild the scene, rebuild this — the
 * Object3Ds it holds belong to that build.
 */
export class DynamicNodes {
  private transforms: TransformEntry[] = []
  private appearances: AppearanceEntry[] = []
  private scales: ScaleEntry[] = []
  private textures: ReadonlyMap<number, THREE.Texture>

  constructor(
    nodes: readonly GvNode[],
    frames: ReadonlyMap<number, THREE.Object3D>,
    sets: DynamicSets,
    textures: ReadonlyMap<number, THREE.Texture>,
  ) {
    this.textures = textures
    const byId = new Map<number, GvNode>()
    for (const node of nodes) if (!byId.has(node.id)) byId.set(node.id, node)

    const childrenOf = new Map<number, GvNode[]>()
    for (const node of nodes) {
      if (node.parentId === 0 || node.parentId === node.id || !byId.has(node.parentId)) continue
      const list = childrenOf.get(node.parentId)
      if (list) list.push(node)
      else childrenOf.set(node.parentId, [node])
    }

    for (const node of nodes) {
      const frame = frames.get(node.id)
      if (!frame) continue // hidden, deleted, or truncated by a parent cycle

      if (sets.transform.has(node.id)) {
        this.transforms.push({ node, frame, parent: byId.get(node.parentId) ?? null })
      }
      // World Grids are left out: their surface draws untinted and their
      // lattice at half the node's alpha, so one uniform colour/opacity write
      // would misdraw both. No example animates a grid's colour; when one
      // does, it wants the builder's per-part rule, not this loop.
      if (sets.appearance.has(node.id) && node.type !== NodeType.WorldGrid) {
        const entry = privatiseMaterials(node, frame)
        if (entry) this.appearances.push(entry)
      }
      if (sets.scaled.has(node.id)) {
        // The floor applies to CUMULATIVE world scale, so an animated scale
        // changes the correction on this node's glyph and on every descendant's.
        for (const descendant of subtree(node, childrenOf, byId)) {
          const dFrame = frames.get(descendant.id)
          const glyph = dFrame?.getObjectByName('glyph')
          if (dFrame && glyph) this.scales.push({ node: descendant, frame: dFrame, glyph })
        }
      }
    }
  }

  /** True when nothing in this build can animate — the caller can skip ticking. */
  get isEmpty(): boolean {
    return (
      this.transforms.length === 0 && this.appearances.length === 0 && this.scales.length === 0
    )
  }

  /** Push the current node values onto their Object3Ds. */
  update(): void {
    for (const { node, frame, parent } of this.transforms) {
      applyFrameTransform(frame, node, parent)
    }

    for (const { node, materials, mapped } of this.appearances) {
      const opacity = node.color.a / 255
      const r = node.color.r / 255
      const g = node.color.g / 255
      const b = node.color.b / 255
      for (const material of materials) {
        material.opacity = opacity
        // NOT a plain assignment: three bakes transparency into the shader
        // program, so a glyph whose CSV alpha was 255 would go on drawing solid
        // at opacity 0 (Breathing_Century's whole animation is that flip).
        setNaturalTransparency(material, opacity < 1)
        const colored = material as THREE.Material & { color?: THREE.Color }
        colored.color?.setRGB(r, g, b)
      }
      const texture = node.textureId > 0 ? (this.textures.get(node.textureId) ?? null) : null
      for (const material of mapped) {
        if ((material.map === null) !== (texture === null)) {
          // Gaining or losing a map flips the USE_MAP define — that one needs a
          // recompile. Swapping one texture for another does not, which is what
          // makes a flip-book affordable.
          material.needsUpdate = true
        }
        material.map = texture
      }
    }

    for (const { node, frame, glyph } of this.scales) {
      if (node.type === NodeType.WorldGrid) {
        const s = gridDrawScale(node)
        glyph.scale.set(s.x, s.y, s.z)
        continue
      }
      const cumulative = cumulativeScale(frame)
      glyph.scale.set(
        drawScaleCorrection(cumulative.x),
        drawScaleCorrection(cumulative.y),
        drawScaleCorrection(cumulative.z),
      )
    }
  }

  /** Release the private material clones. Call before dropping the scene. */
  dispose(): void {
    for (const { materials } of this.appearances) {
      for (const material of materials) material.dispose()
    }
    this.transforms = []
    this.appearances = []
    this.scales = []
  }
}

/** A node and every descendant, in a stable order. */
function subtree(
  root: GvNode,
  childrenOf: ReadonlyMap<number, GvNode[]>,
  byId: ReadonlyMap<number, GvNode>,
): GvNode[] {
  const out: GvNode[] = []
  const seen = new Set<number>()
  const stack = [root]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (seen.has(node.id) || byId.get(node.id) !== node) continue
    seen.add(node.id)
    out.push(node)
    const children = childrenOf.get(node.id)
    if (children) for (let i = children.length - 1; i >= 0; i--) stack.push(children[i])
  }
  return out
}

/** Product of a frame's own scale and every ancestor's, up to the scene root. */
function cumulativeScale(frame: THREE.Object3D): THREE.Vector3 {
  const scale = new THREE.Vector3(1, 1, 1)
  for (let o: THREE.Object3D | null = frame; o !== null; o = o.parent) {
    scale.multiply(o.scale)
  }
  return scale
}

/**
 * Give one node's glyph its own materials, so per-frame colour/texture writes
 * cannot reach every other node that happened to look the same.
 *
 * Pick proxies keep the shared invisible material — they are never drawn.
 */
function privatiseMaterials(node: GvNode, frame: THREE.Object3D): AppearanceEntry | null {
  const glyph = frame.getObjectByName('glyph')
  if (!glyph) return null

  const materials: THREE.Material[] = []
  const mapped: THREE.MeshLambertMaterial[] = []
  glyph.traverse((object) => {
    if (object.userData.isPickProxy) return
    const drawable = object as THREE.Object3D & { material?: THREE.Material | THREE.Material[] }
    const material = drawable.material
    if (!material || Array.isArray(material)) return
    const clone = material.clone()
    drawable.material = clone
    materials.push(clone)
    if (clone instanceof THREE.MeshLambertMaterial) mapped.push(clone)
  })
  if (materials.length === 0) return null

  return { node, materials, mapped }
}
