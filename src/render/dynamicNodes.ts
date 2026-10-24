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
// descendants dynamic too. The one cascade that IS registered explicitly is the
// DIRECT children of a node whose ratio/topo/geometry a channel drives: those
// three fields are the child-placement inputs (the torus radius, the placement
// rule itself, a World Grid's globe-vs-flat form — desktop _TRANSFORM_FIELDS),
// and applyFrameTransform re-reads them from the parent fresh, so re-running it
// on each child every tick is the whole re-layout. Grandchildren ride along.
//
// Materials are the one place where the shared-everything build has to be
// undone: nodes with an appearance binding get PRIVATE clones of their
// materials, mutated in place (render/glyphAppearance.ts says why). A World
// Grid is the exception — its materials are its own already, and its parts take
// different values from one row, so it goes through worldGridGeometry's own
// per-part rule instead.
//
// Shape bindings (geometry / mesh_id / a torus or Point ratio / the node's own
// topo) cannot be a material write: the glyph OBJECT is wrong. Those swap the
// glyph in place when — and only when — the value actually changes, which the
// authoring guidance already demands be flip-book cadence (an integer stepped
// every frame reads as noise). `hide` flips visibility on the glyph the build
// kept alive for exactly this (BuildSceneOptions.channelHideBound).

import * as THREE from 'three'
import type { GvNode } from '../gv/types'
import { Geometry, NodeType, Topo } from '../gv/types'
import { gridDrawScale } from '../gv/worldGrid'
import { applyFrameTransform, applyGlyphDrawScale } from './buildScene'
import {
  RATIO_SHAPED_GEOMETRIES,
  createGlyphObject,
  createPickProxy,
  quantizedShapeRatio,
} from './glyphGeometry'
import {
  applyGlyphAppearance,
  privatiseGlyphMaterials,
  type MappedMaterial,
} from './glyphAppearance'
import { applyWorldGridAppearance, createWorldGridObject } from './worldGridGeometry'

export interface DynamicSets {
  /** Nodes whose translate/rotate/scale (or child-placement fields) can change. */
  transform: ReadonlySet<number>
  /** Nodes whose colour, opacity or texture_id can change. */
  appearance: ReadonlySet<number>
  /** Nodes whose scale can change — the 0.2 draw floor is scale-dependent, so
   *  their glyph correction (and every descendant glyph's) has to follow. */
  scaled: ReadonlySet<number>
  /** Nodes whose glyph shape can change (geometry / mesh_id / ratio / topo). */
  shape?: ReadonlySet<number>
  /** Nodes whose ratio/topo/geometry can change — their direct children are
   *  re-placed every tick, since those fields are the placement inputs. */
  placement?: ReadonlySet<number>
  /** Nodes whose `hide` flag can change — visibility toggled per frame. */
  hidden?: ReadonlySet<number>
}

export interface DynamicNodesOptions {
  /** The app's "Show Hidden Nodes" display toggle: while it is on, an animated
   *  hide=1 still draws, exactly as a CSV hide=1 does. */
  showHidden?: boolean
}

/** What one update() pass changed beyond plain transforms, for the caller. */
export interface DynamicUpdateReport {
  /** A glyph object was swapped: freshly minted materials need the active
   *  render mode re-applied, and a selection halo may hold a stale glyph. */
  glyphsRebuilt: boolean
  /** Plot/Surface overlay membership may have changed — a bound node animated
   *  into or out of topo 16/17, or a hide flip touched an overlay parent or
   *  one of its children. Membership is baked per build (topologyOverlay.ts),
   *  so the caller rebuilds the overlay; the desktop's fix re-derives its
   *  scan's membership for the dynamic set each frame for the same reason
   *  (its scan is keyed on a revision playback never bumps). */
  overlayDirty: boolean
}

const NO_CHANGES: DynamicUpdateReport = { glyphsRebuilt: false, overlayDirty: false }

interface TransformEntry {
  node: GvNode
  frame: THREE.Object3D
  parent: GvNode | null
}

interface AppearanceEntry {
  node: GvNode
  frame: THREE.Object3D
  /** Private clones of this glyph's materials (empty for a World Grid). */
  materials: THREE.Material[]
  /** The ones carrying a map (glyphAppearance.ts). */
  mapped: MappedMaterial[]
}

interface ScaleEntry {
  node: GvNode
  frame: THREE.Object3D
}

interface ShapeEntry {
  node: GvNode
  frame: THREE.Object3D
  /** Last-applied values; a difference is what triggers the glyph swap. */
  geometry: number
  topo: number
  meshId: number
  /** ratio, keyed the way the glyph consumes it (quantized for the
   *  ratio-shaped shapes, raw for a Point, constant otherwise) so a sweep only
   *  rebuilds on real steps. */
  ratioKey: number
}

interface HiddenEntry {
  node: GvNode
  frame: THREE.Object3D
  parent: GvNode | null
  lastHidden: boolean
}

function glyphOf(frame: THREE.Object3D): THREE.Object3D | undefined {
  return frame.children.find((c) => c.userData.isGlyph)
}

/** The ratio value this node's glyph shape is actually built from. */
function shapeRatioKey(node: GvNode): number {
  if (RATIO_SHAPED_GEOMETRIES.has(node.geometry)) return quantizedShapeRatio(node.ratio)
  if (node.geometry === Geometry.Point) return node.ratio
  return 0 // every other shape ignores ratio
}

function isOverlayTopo(topo: number): boolean {
  return topo === Topo.Plot || topo === Topo.Surface
}

/**
 * The animated slice of one built scene. Rebuild the scene, rebuild this — the
 * Object3Ds it holds belong to that build.
 */
export class DynamicNodes {
  private transforms: TransformEntry[] = []
  private appearances: AppearanceEntry[] = []
  private scales: ScaleEntry[] = []
  private shapes: ShapeEntry[] = []
  private hiddens: HiddenEntry[] = []
  private textures: ReadonlyMap<number, THREE.Texture>
  private meshes: ReadonlyMap<number, THREE.BufferGeometry>
  private showHidden: boolean
  /** node id → its appearance entry, so a glyph swap can re-privatise. */
  private appearanceByNode = new Map<number, AppearanceEntry>()

  constructor(
    nodes: readonly GvNode[],
    frames: ReadonlyMap<number, THREE.Object3D>,
    sets: DynamicSets,
    textures: ReadonlyMap<number, THREE.Texture>,
    meshes: ReadonlyMap<number, THREE.BufferGeometry> = new Map(),
    options: DynamicNodesOptions = {},
  ) {
    this.textures = textures
    this.meshes = meshes
    this.showHidden = options.showHidden === true
    const byId = new Map<number, GvNode>()
    for (const node of nodes) if (!byId.has(node.id)) byId.set(node.id, node)

    const placement = sets.placement ?? new Set<number>()
    const transformIds = new Set<number>()

    for (const node of nodes) {
      const frame = frames.get(node.id)
      if (!frame) continue // hidden, deleted, or truncated by a parent cycle
      const parent = byId.get(node.parentId) ?? null

      if (
        sets.transform.has(node.id) ||
        // A parent's ratio/topo/geometry is this node's placement input.
        (parent && placement.has(parent.id) && node.parentId !== node.id)
      ) {
        if (!transformIds.has(node.id)) {
          transformIds.add(node.id)
          this.transforms.push({ node, frame, parent })
        }
      }
      // A World Grid registers with no clones: its surface draws untinted and
      // its lattice at half alpha, so the update pass hands it to the grid's
      // own per-part rule rather than a uniform write.
      if (sets.appearance.has(node.id)) {
        const entry: AppearanceEntry | null =
          node.type === NodeType.WorldGrid
            ? glyphOf(frame)
              ? { node, frame, materials: [], mapped: [] }
              : null
            : privatiseMaterials(node, frame)
        if (entry) {
          this.appearances.push(entry)
          this.appearanceByNode.set(node.id, entry)
        }
      }
      if (sets.scaled.has(node.id)) {
        // The floor is on the node's OWN scale (buildScene.drawScaleCorrection),
        // so an animated scale changes the correction on this node's glyph and
        // on nobody else's — descendants shrink with it through the frame chain
        // and need no rewrite. Their placement is already carried by the frame.
        if (glyphOf(frame)) this.scales.push({ node, frame })
      }
      // A LINK's shape is the link overlay's business (linkOverlay.ts LiveLink):
      // it draws between its two ends, never at its own frame, so swapping a
      // glyph in here would put a stray shape at the A-end.
      if (sets.shape?.has(node.id) && node.type !== NodeType.Link) {
        this.shapes.push({
          node,
          frame,
          geometry: node.geometry,
          topo: node.topo,
          meshId: node.meshId,
          ratioKey: shapeRatioKey(node),
        })
      }
      if (sets.hidden?.has(node.id)) {
        const hidden = !this.showHidden && node.hide !== 0
        // buildScene built the glyph whatever the CSV said (channelHideBound);
        // apply the row's value now, so a CSV-hidden node never flashes.
        const glyph = glyphOf(frame)
        if (glyph) glyph.visible = !hidden
        this.hiddens.push({ node, frame, parent, lastHidden: hidden })
      }
    }
  }

  /** True when nothing in this build can animate — the caller can skip ticking. */
  get isEmpty(): boolean {
    return (
      this.transforms.length === 0 &&
      this.appearances.length === 0 &&
      this.scales.length === 0 &&
      this.shapes.length === 0 &&
      this.hiddens.length === 0
    )
  }

  /** Push the current node values onto their Object3Ds. */
  update(): DynamicUpdateReport {
    for (const { node, frame, parent } of this.transforms) {
      applyFrameTransform(frame, node, parent)
    }

    let glyphsRebuilt = false
    let overlayDirty = false
    // Shape swaps run BEFORE the appearance pass, so per-frame colour writes
    // land on the freshly privatised clones, never on a removed glyph's.
    for (const entry of this.shapes) {
      const node = entry.node
      if (
        node.geometry === entry.geometry &&
        node.topo === entry.topo &&
        node.meshId === entry.meshId &&
        shapeRatioKey(node) === entry.ratioKey
      ) {
        continue
      }
      if (isOverlayTopo(entry.topo) !== isOverlayTopo(node.topo)) overlayDirty = true
      this.rebuildGlyph(entry)
      glyphsRebuilt = true
    }

    for (const entry of this.appearances) {
      const node = entry.node
      if (node.type === NodeType.WorldGrid) {
        // Resolved per tick: a shape swap (globe ↔ flat) replaces the object.
        const glyph = glyphOf(entry.frame)
        const texture = node.textureId > 0 ? (this.textures.get(node.textureId) ?? null) : null
        if (glyph) applyWorldGridAppearance(glyph, node, texture)
        continue
      }
      applyGlyphAppearance(entry, node, this.textures)
    }

    for (const entry of this.hiddens) {
      const hidden = !this.showHidden && entry.node.hide !== 0
      if (hidden === entry.lastHidden) continue
      entry.lastHidden = hidden
      const glyph = glyphOf(entry.frame)
      if (glyph) glyph.visible = !hidden
      // A flip on an overlay parent — or on a child of one — changes what the
      // baked Plot/Surface pass draws.
      if (isOverlayTopo(entry.node.topo) || (entry.parent && isOverlayTopo(entry.parent.topo))) {
        overlayDirty = true
      }
    }

    for (const { node, frame } of this.scales) {
      // Resolved per tick, not cached: a shape swap may have replaced the glyph.
      const glyph = glyphOf(frame)
      if (!glyph) continue
      if (node.type === NodeType.WorldGrid) {
        const s = gridDrawScale(node)
        glyph.scale.set(s.x, s.y, s.z)
        continue
      }
      // Carries the Rod cap offset too, which moves with the scale it is
      // derived from — an animated rod grows from its bottom cap, not its
      // centre, exactly as the desktop's re-baked draw matrix does.
      applyGlyphDrawScale(glyph, node)
    }

    if (!glyphsRebuilt && !overlayDirty) return NO_CHANGES
    return { glyphsRebuilt, overlayDirty }
  }

  /**
   * Swap one node's glyph for a fresh one built from its current row — the
   * shape half of the fast path. Shared cache materials are never disposed
   * (the cache owns them); a node with private appearance clones gets those
   * disposed and re-minted on the new glyph.
   */
  private rebuildGlyph(entry: ShapeEntry): void {
    const { node, frame } = entry
    const old = glyphOf(frame)
    if (old) frame.remove(old)
    const appearance = this.appearanceByNode.get(node.id)
    if (appearance) {
      for (const material of appearance.materials) material.dispose()
      appearance.materials = []
      appearance.mapped = []
    }

    const texture = node.textureId > 0 ? this.textures.get(node.textureId) : undefined
    let glyph: THREE.Object3D | null = null
    if (node.type === NodeType.WorldGrid) {
      // A grid's geometry is its globe-vs-flat form; scale means extents.
      glyph = createWorldGridObject(node, texture)
      const s = gridDrawScale(node)
      glyph.scale.set(s.x, s.y, s.z)
    } else {
      const mesh = node.geometry === Geometry.Mesh ? this.meshes.get(node.meshId) : undefined
      glyph = createGlyphObject(node.geometry, {
        color: new THREE.Color(node.color.r / 255, node.color.g / 255, node.color.b / 255),
        opacity: node.color.a / 255,
        ratio: node.ratio,
        map: texture,
        mesh,
      })
      if (glyph) {
        applyGlyphDrawScale(glyph, node)
        const proxy = createPickProxy(node.geometry, mesh, node.ratio)
        if (proxy) glyph.add(proxy)
      }
    }
    if (glyph) {
      glyph.name = 'glyph'
      glyph.userData.isGlyph = true
      // A channel-hidden node stays hidden through a shape step.
      const hiddenEntry = this.hiddens.find((h) => h.node.id === node.id)
      if (hiddenEntry) glyph.visible = !hiddenEntry.lastHidden
      frame.add(glyph)
      if (appearance && node.type !== NodeType.WorldGrid) {
        const rebuilt = privatiseMaterials(node, frame)
        if (rebuilt) {
          appearance.materials = rebuilt.materials
          appearance.mapped = rebuilt.mapped
        }
      }
    }
    entry.geometry = node.geometry
    entry.topo = node.topo
    entry.meshId = node.meshId
    entry.ratioKey = shapeRatioKey(node)
  }

  /** Release the private material clones. Call before dropping the scene. */
  dispose(): void {
    for (const { materials } of this.appearances) {
      for (const material of materials) material.dispose()
    }
    this.transforms = []
    this.appearances = []
    this.scales = []
    this.shapes = []
    this.hiddens = []
    this.appearanceByNode.clear()
  }
}

/** Give one node's glyph its own materials (glyphAppearance.ts). */
function privatiseMaterials(node: GvNode, frame: THREE.Object3D): AppearanceEntry | null {
  const glyph = glyphOf(frame)
  if (!glyph) return null
  const owned = privatiseGlyphMaterials(glyph)
  return owned ? { node, frame, ...owned } : null
}
