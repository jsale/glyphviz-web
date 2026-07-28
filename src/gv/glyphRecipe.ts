// The GlyphRecipe / LevelSpec model and its node generator — a port of the
// desktop's `glyphviz_core/glyph_recipe.py` (verified against source
// 2026-07-28), which is pure logic there too: no UI, no GL.
//
// A recipe is one LevelSpec per branch level. Level 0 is the trunk (a single
// centred root); every level below it says how many children each node of the
// level above gets, where they sit, and what they look like. `generateNodes`
// walks that depth-first into a flat list of ordinary CSV rows — the output is
// nothing special, just nodes, which is why a generated hyperglyph saves,
// edits, animates and round-trips exactly like a hand-authored one.
//
// This is the layer the Hyperglyph Generator (hyperglyph.ts) randomizes. It is
// also what the desktop's Glyph Composer edits by hand; that dialog has no web
// counterpart yet, so only the pieces the generator needs are ported —
// DIST_CIRCULAR / DIST_GRID / DIST_RANDOM are included anyway because they are
// three lines each and a recipe JSON from the desktop can name them.

import { roundHalfToEven } from './channels'
import { blankNode } from './createNode'
import type { GvNode, Rgba } from './types'
import { Geometry, Topo } from './types'

/** How a level's items are laid out. Values are the desktop's own strings. */
export const Dist = {
  /** Evenly spaced along one Cartesian axis. */
  Linear: 'linear',
  /** A ring in the PARENT topology's angular coordinate (translate_x 0…360). */
  Angular: 'angular',
  /** Evenly spaced around a circle in world XY (root level only). */
  Circular: 'circular',
  /** A rectangular grid in world XY (root level only). */
  Grid: 'grid',
  /** Uniform random inside a bounding square (root level only). */
  Random: 'random',
} as const

export type DistMode = (typeof Dist)[keyof typeof Dist]

/** RGBA 0–255, the tuple form the recipe carries colours in. */
export type RecipeColor = readonly [number, number, number, number]

/** One branch level. Defaults are `LevelSpec`'s dataclass defaults. */
export interface LevelSpec {
  /** Children per parent (level 0 is always 1). */
  count: number
  geometry: number
  /** This level's own topology — i.e. how ITS children will be placed. */
  topo: number
  ratio: number
  distMode: DistMode

  /** Linear: spacing between items, and which axis they run along. */
  distStep: number
  distAxis: number

  /** Angular: translate_y (tilt/latitude) and translate_z (altitude/radius). */
  distTilt: number
  distTz: number

  /** Circular (root only). */
  distRadius: number

  /** Grid (root only). */
  distGridCols: number
  distGridSx: number
  distGridSy: number

  /** Random (root only): half-width of the bounding square. */
  distBounds: number

  scaleX: number
  scaleY: number
  scaleZ: number
  rotateX: number
  rotateY: number
  rotateZ: number

  colorStart: RecipeColor
  /** null = one solid colour for the level; else a gradient across its items. */
  colorEnd: RecipeColor | null
}

export interface GlyphRecipe {
  name: string
  levels: LevelSpec[]
}

/** `LevelSpec()` with no arguments — every field's dataclass default. */
export function levelSpec(overrides: Partial<LevelSpec> = {}): LevelSpec {
  return {
    count: 5,
    geometry: Geometry.SphereSolid,
    topo: Topo.Sphere,
    ratio: 0.3,
    distMode: Dist.Angular,
    distStep: 2,
    distAxis: 0,
    distTilt: 0,
    distTz: 0,
    distRadius: 3,
    distGridCols: 3,
    distGridSx: 2,
    distGridSy: 2,
    distBounds: 5,
    scaleX: 1,
    scaleY: 1,
    scaleZ: 1,
    rotateX: 0,
    rotateY: 0,
    rotateZ: 0,
    colorStart: [180, 100, 200, 255],
    colorEnd: null,
    ...overrides,
  }
}

export interface GenerateOptions {
  /** First id handed out; ids then run consecutively in emission order. */
  startId?: number
  /** Parent for the trunk. 0 = a new root-level object. */
  parentId?: number
  /** Branch level of the trunk; deeper levels count up from it. */
  baseBranchLevel?: number
}

/**
 * The recipe's full hierarchy as a flat node list, in emission order: each node
 * is followed immediately by its entire subtree (depth-first), which is the
 * order ids are allocated in and therefore the order a CSV writes.
 *
 * Placement is deterministic given the LevelSpecs — the generator never picks
 * DIST_RANDOM — so re-running this later with a different `startId`/`parentId`
 * reproduces the identical structure somewhere else in the scene. That is what
 * lets the generator preview one hierarchy and insert a second, equal one.
 */
export function generateNodes(recipe: GlyphRecipe, options: GenerateOptions = {}): GvNode[] {
  const nodes: GvNode[] = []
  if (recipe.levels.length === 0) return nodes
  genLevel(
    recipe,
    0,
    options.parentId ?? 0,
    -1,
    options.startId ?? 1,
    options.baseBranchLevel ?? 0,
    nodes,
  )
  return nodes
}

function genLevel(
  recipe: GlyphRecipe,
  levelIndex: number,
  parentId: number,
  parentTopo: number,
  startId: number,
  branchLevel: number,
  nodes: GvNode[],
): void {
  if (levelIndex >= recipe.levels.length) return
  const spec = recipe.levels[levelIndex]
  const positions = distribute(spec, levelIndex === 0)

  for (const [i, position] of positions.entries()) {
    const nodeId = startId + nodes.length
    const t = spec.count > 1 ? i / Math.max(spec.count - 1, 1) : 0
    const color = lerpColor(spec.colorStart, spec.colorEnd, t)

    const node = blankNode(nodeId, {
      geometry: spec.geometry,
      topo: spec.topo,
      scale: { x: spec.scaleX, y: spec.scaleY, z: spec.scaleZ },
      color,
    })
    node.parentId = parentId
    node.branchLevel = branchLevel
    node.translate = { x: position[0], y: position[1], z: position[2] }
    node.rotate = { x: spec.rotateX, y: spec.rotateY, z: spec.rotateZ }
    node.ratio = spec.ratio
    nodes.push(node)

    genLevel(recipe, levelIndex + 1, nodeId, spec.topo, startId, branchLevel + 1, nodes)
  }
  // `parentTopo` is carried for signature parity with the desktop's _gen_level;
  // placement reads the level's OWN dist fields, and the parent topology is
  // what interprets them at draw time rather than here.
  void parentTopo
}

type Point = [number, number, number]

/** The level's item positions, in its own parent's topology coordinates. */
function distribute(spec: LevelSpec, isRoot: boolean): Point[] {
  const n = Math.max(spec.count, 1)
  void isRoot // the desktop takes it too and likewise never branches on it

  if (spec.distMode === Dist.Angular) {
    // translate_x is the angular dimension (0…360) for Sphere/Torus/Cylinder
    // and the rest of the round topologies — the generator only ever picks
    // parents that read it that way (hyperglyph.ts ANGULAR_SAFE_TOPOS).
    return Array.from({ length: n }, (_, i): Point => [(i * 360) / n, spec.distTilt, spec.distTz])
  }

  if (spec.distMode === Dist.Linear) {
    const total = spec.distStep * (n - 1)
    const start = -total / 2
    return Array.from({ length: n }, (_, i): Point => {
      const v = start + i * spec.distStep
      if (spec.distAxis === 0) return [v, 0, 0]
      if (spec.distAxis === 1) return [0, v, 0]
      return [0, 0, v]
    })
  }

  if (spec.distMode === Dist.Circular) {
    const r = spec.distRadius
    return Array.from({ length: n }, (_, i): Point => [
      Math.cos((i * 2 * Math.PI) / n) * r,
      Math.sin((i * 2 * Math.PI) / n) * r,
      0,
    ])
  }

  if (spec.distMode === Dist.Grid) {
    const cols = Math.max(spec.distGridCols, 1)
    const rows = Math.ceil(n / cols)
    const cx = ((cols - 1) * spec.distGridSx) / 2
    const cy = ((rows - 1) * spec.distGridSy) / 2
    return Array.from({ length: n }, (_, i): Point => {
      const row = Math.floor(i / cols)
      const col = i % cols
      return [col * spec.distGridSx - cx, row * spec.distGridSy - cy, 0]
    })
  }

  if (spec.distMode === Dist.Random) {
    // Deliberately NOT the seeded generator: the desktop reaches for the
    // module-level `random` here, so this mode is un-reproducible there and a
    // seeded port would be a silent behaviour change. Nothing the Hyperglyph
    // Generator produces uses it (random_recipe never picks it) — it exists so
    // a hand-written or desktop-authored recipe still loads.
    const b = spec.distBounds
    return Array.from({ length: n }, (): Point => [
      -b + Math.random() * 2 * b,
      -b + Math.random() * 2 * b,
      0,
    ])
  }

  return Array.from({ length: n }, (): Point => [0, 0, 0])
}

/**
 * The item's colour at `t` along the level's gradient. No end colour means the
 * level is one flat colour — and the desktop TRUNCATES there (`int(v)`) while
 * it ROUNDS the interpolated case, so both are reproduced: recipe colours are
 * already integers, but a hand-edited recipe JSON need not be.
 */
function lerpColor(start: RecipeColor, end: RecipeColor | null, t: number): Rgba {
  const [r, g, b, a] = end
    ? start.map((s, i) => roundHalfToEven(s + t * (end[i] - s)))
    : start.map((v) => Math.trunc(v))
  return { r, g, b, a }
}
