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
// This is the layer the Hyperglyph Generator (hyperglyph.ts) randomizes, and
// the layer the Glyph Composer (ui/glyphComposerWindow.ts) edits by hand. Both
// dialogs end in the same `generateNodes` call, which is why a design from
// either one is an ordinary set of rows.

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

/**
 * Which distribution modes a level may use, and in what order they are offered.
 * The desktop's `ROOT_DIST_MODES` / `NONROOT_DIST_MODES`: the trunk lays itself
 * out in WORLD coordinates (there is no parent to be angular around), while
 * every level below it is placed in its parent's topology coordinates, where
 * only Angular and Linear mean anything.
 */
export const ROOT_DIST_MODES: readonly DistMode[] = [
  Dist.Linear,
  Dist.Circular,
  Dist.Grid,
  Dist.Random,
]
export const NONROOT_DIST_MODES: readonly DistMode[] = [Dist.Angular, Dist.Linear]

/** `DIST_LABELS` — the wording the desktop's Placement combo shows. */
export const DIST_LABELS: Record<DistMode, string> = {
  [Dist.Linear]: 'Linear (along axis)',
  [Dist.Angular]: 'Angular (ring around parent)',
  [Dist.Circular]: 'Circular (world ring)',
  [Dist.Grid]: 'Grid (world XY)',
  [Dist.Random]: 'Random',
}

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

/**
 * `default_recipe()` — the two-level glyph the Composer opens on: one Sphere
 * trunk whose topology is Sphere, ringed by six half-scale spheres running a
 * gradient. Small enough to read at a glance and complete enough to insert.
 */
export function defaultRecipe(): GlyphRecipe {
  return {
    name: 'My Glyph',
    levels: [
      levelSpec({
        count: 1,
        geometry: Geometry.SphereSolid,
        topo: Topo.Sphere,
        distMode: Dist.Linear,
        distStep: 2,
        colorStart: [140, 180, 220, 255],
      }),
      levelSpec({
        count: 6,
        geometry: Geometry.SphereSolid,
        topo: Topo.None,
        distMode: Dist.Angular,
        scaleX: 0.5,
        scaleY: 0.5,
        scaleZ: 0.5,
        colorStart: [220, 140, 80, 255],
        colorEnd: [80, 200, 180, 255],
      }),
    ],
  }
}

/**
 * The spec the Composer's "+ Add Level" button appends (desktop `_add_level`).
 * Not `levelSpec()`'s dataclass defaults: a level added by hand wants a small
 * scale so it reads as decoration on the level above, and a topology of None so
 * it does not silently reshape a level that does not exist yet.
 */
export function addedLevelSpec(levelIndex: number): LevelSpec {
  return levelSpec({
    count: 6,
    geometry: Geometry.SphereSolid,
    topo: Topo.None,
    distMode: levelIndex === 0 ? Dist.Linear : Dist.Angular,
    scaleX: 0.4,
    scaleY: 0.4,
    scaleZ: 0.4,
    colorStart: [100, 200, 160, 255],
    colorEnd: [200, 100, 160, 255],
  })
}

/**
 * How many nodes `generateNodes` would emit, without emitting them — the sum of
 * the running product of the levels' counts.
 *
 * A recipe grows MULTIPLICATIVELY with depth, so one more level on a modest
 * design is the difference between thousands of nodes and millions. Counting
 * first is a few multiplications; finding out by generating is a hung tab.
 * `limit` stops the arithmetic early, so an absurd recipe costs no more than a
 * plausible one — the answer is then only known to be at least `limit`.
 */
export function projectedNodeCount(recipe: GlyphRecipe, limit = Number.MAX_SAFE_INTEGER): number {
  let total = 0
  let perParent = 1
  for (const spec of recipe.levels) {
    perParent *= Math.max(spec.count, 1)
    total += perParent
    if (total >= limit) return limit
  }
  return total
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

// ---------------------------------------------------------------- templates
//
// A saved template is the desktop's `recipe_to_dict` JSON exactly — snake_case
// keys, `asdict(spec)` field for field, colours as arrays and a null
// `color_end` for a solid level. That is not cosmetic: a .json written by
// either app has to open in the other, which is the only way a glyph designed
// on one machine reaches the other. Unknown keys are ignored and missing ones
// take the dataclass default, matching `recipe_from_dict`'s `.get(...)` reads,
// so a template written by an older or newer build still loads.

/** The on-disk shape. Every field is optional on the way IN (see above). */
interface RecipeJsonLevel {
  count?: number
  geometry?: number
  topo?: number
  ratio?: number
  dist_mode?: string
  dist_step?: number
  dist_axis?: number
  dist_tilt?: number
  dist_tz?: number
  dist_radius?: number
  dist_grid_cols?: number
  dist_grid_sx?: number
  dist_grid_sy?: number
  dist_bounds?: number
  scale_x?: number
  scale_y?: number
  scale_z?: number
  rotate_x?: number
  rotate_y?: number
  rotate_z?: number
  color_start?: number[]
  color_end?: number[] | null
}

export function recipeToJson(recipe: GlyphRecipe): unknown {
  return {
    name: recipe.name,
    levels: recipe.levels.map(
      (spec): RecipeJsonLevel => ({
        count: spec.count,
        geometry: spec.geometry,
        topo: spec.topo,
        ratio: spec.ratio,
        dist_mode: spec.distMode,
        dist_step: spec.distStep,
        dist_axis: spec.distAxis,
        dist_tilt: spec.distTilt,
        dist_tz: spec.distTz,
        dist_radius: spec.distRadius,
        dist_grid_cols: spec.distGridCols,
        dist_grid_sx: spec.distGridSx,
        dist_grid_sy: spec.distGridSy,
        dist_bounds: spec.distBounds,
        scale_x: spec.scaleX,
        scale_y: spec.scaleY,
        scale_z: spec.scaleZ,
        rotate_x: spec.rotateX,
        rotate_y: spec.rotateY,
        rotate_z: spec.rotateZ,
        color_start: [...spec.colorStart],
        color_end: spec.colorEnd ? [...spec.colorEnd] : null,
      }),
    ),
  }
}

/** A colour array padded/truncated to RGBA, so a 3-element one still loads. */
function toRecipeColor(raw: unknown, fallback: RecipeColor): RecipeColor {
  if (!Array.isArray(raw)) return fallback
  const value = (i: number): number => (typeof raw[i] === 'number' ? (raw[i] as number) : fallback[i])
  return [value(0), value(1), value(2), Array.isArray(raw) && raw.length > 3 ? value(3) : 255]
}

/**
 * `recipe_from_dict`. Throws on anything that is not a recipe at all — the
 * Composer reports that rather than replacing the design in progress with an
 * empty one, which is what silently accepting `{}` would do.
 */
export function recipeFromJson(raw: unknown): GlyphRecipe {
  if (typeof raw !== 'object' || raw === null) throw new Error('not a glyph template')
  const source = raw as { name?: unknown; levels?: unknown }
  if (!Array.isArray(source.levels) || source.levels.length === 0) {
    throw new Error('no branch levels in this file')
  }

  const levels = source.levels.map((entry): LevelSpec => {
    const sd = (typeof entry === 'object' && entry !== null ? entry : {}) as RecipeJsonLevel
    const distMode = (
      Object.values(Dist) as string[]
    ).includes(sd.dist_mode ?? '')
      ? (sd.dist_mode as DistMode)
      : Dist.Angular
    return levelSpec({
      count: sd.count ?? 5,
      geometry: sd.geometry ?? Geometry.SphereSolid,
      topo: sd.topo ?? Topo.Sphere,
      ratio: sd.ratio ?? 0.3,
      distMode,
      distStep: sd.dist_step ?? 2,
      distAxis: sd.dist_axis ?? 0,
      distTilt: sd.dist_tilt ?? 0,
      distTz: sd.dist_tz ?? 0,
      distRadius: sd.dist_radius ?? 3,
      distGridCols: sd.dist_grid_cols ?? 3,
      distGridSx: sd.dist_grid_sx ?? 2,
      distGridSy: sd.dist_grid_sy ?? 2,
      distBounds: sd.dist_bounds ?? 5,
      scaleX: sd.scale_x ?? 1,
      scaleY: sd.scale_y ?? 1,
      scaleZ: sd.scale_z ?? 1,
      rotateX: sd.rotate_x ?? 0,
      rotateY: sd.rotate_y ?? 0,
      rotateZ: sd.rotate_z ?? 0,
      colorStart: toRecipeColor(sd.color_start, [180, 100, 200, 255]),
      colorEnd:
        sd.color_end === null || sd.color_end === undefined
          ? null
          : toRecipeColor(sd.color_end, [80, 200, 180, 255]),
    })
  })

  return { name: typeof source.name === 'string' ? source.name : 'My Glyph', levels }
}
