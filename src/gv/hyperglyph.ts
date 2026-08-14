// The Hyperglyph Generator's design engine — a port of the desktop's
// `hyperglyph_lab/hyperglyph_generator.py` (verified against source
// 2026-07-28), specifically the slice its GUI dialog uses: `random_recipe`,
// `assign_color_index` and `apply_idle_motion`.
//
// A "hyperglyph" is a multi-level branching hierarchy of ordinary nodes,
// randomized inside tuned ranges rather than freely: one geometry FAMILY per
// design and one hue-relationship SCHEME per design are what keep a 500-node,
// 5-level tree reading as one creature instead of visual noise.
//
// Not ported (they belong to the standalone `hyperglyph_lab/` CLI/notebook,
// not the dialog): `generate_batch`, the ratings CSV store, and
// `mutate_recipe`'s explore/exploit loop. Those write files and learn from
// Jeff's hand-entered scores, which is a different tool with a different shape.
//
// Everything random goes through PythonRandom, so a seed names the same design
// in both apps — see pythonRandom.ts for why that mattered enough to port
// CPython's Mersenne Twister, and hyperglyph.parity.test.ts for the proof.

import { generateNodes, levelSpec, Dist } from './glyphRecipe'
import type { GlyphRecipe, LevelSpec, RecipeColor } from './glyphRecipe'
import { hsvToRgb, pyMod, PythonRandom } from './pythonRandom'
import { roundHalfToEven } from './channels'
import type { GvNode } from './types'
import { Geometry, Topo } from './types'

/**
 * Topologies whose angular coordinate (translate_x 0…360) is what an angular
 * distribution feeds children. Cube/Plane/None/Video/Plot/Surface read
 * translate_x as something else entirely (a face-plane UV, a plot index) and
 * would fling a ring of children into nonsense positions.
 *
 * The Z-variants are excluded for a different reason: they place children
 * through the centre/axis rather than on the rendered surface, so a branch
 * clumps into the parent instead of reading as structure (Jeff flagged that
 * 2026-07-01). Both families are candidates to bring back with placement logic
 * of their own, not as generic angular branches.
 *
 * Pin was, until 2026-08-14, the one entry here that was not actually
 * angular-safe: it reads a child's translate_x as HEIGHT
 * (LINEAR_PLACEMENT_AXES), so the 0…360 sweep an angular level hands it became
 * a 360-unit vertical smear rather than a ring — the same mismatch `topoScale`
 * exists to reconcile. The LevelSpecs below leave `topoScaleAuto` at its
 * default (true), so glyphRecipe fits each level's Topology Scale to the
 * distribution its children ask for.
 *
 * Be precise about what that buys: Pin places children along ONE axis whatever
 * the scale, so the fit SHORTENS the line, it does not turn it into a ring.
 * What it does is keep the subtree inside the parent's own extent, which is the
 * difference between a legible creature and dust scattered across 400 units.
 * The dramatic wins are where Pin sits at a DEEP level — those hold the most
 * nodes — e.g. seed 5 at depth 4 (Torus/Spiral/Pin/Pin) goes from a few
 * unreadable specks to a dense torus.
 *
 * This DID change previously-generated art. On the desktop's 200-design sample
 * it moved 62 of them (31%), and Pin is the ONLY cause: all 67 re-fitted levels
 * were Pin levels, at every depth, pulling in by 7.5× to 117× (median 23×).
 * Jeff asked for it knowing that (desktop 2026-08-13, web 2026-08-14). Note the
 * consequence for the design lineage — an older recipe JSON has no topo_scale
 * keys, so it reloads onto the fit and regenerates as the corrected design
 * rather than the smeared one. No rng draw moved, so ids, counts, colours and
 * every coordinate are untouched: a seed still names the same design, drawn at
 * a size you can see.
 */
export const ANGULAR_SAFE_TOPOS: readonly number[] = [
  Topo.Sphere,
  Topo.Torus,
  Topo.Cylinder,
  Topo.Pin,
  Topo.Rod,
  Topo.Point,
  Topo.Spiral,
]

/**
 * Geometry families. Picking ONE per design — rather than mixing all 24 usable
 * shapes freely — is what makes a deep tree coherent. Mesh (23) is excluded: it
 * needs a real imported model behind a mesh_id, which a generator has none of.
 *
 * Insertion order is load-bearing: `choice` indexes this key list, so
 * reordering it would change what every existing seed generates.
 */
export const GEO_FAMILIES: Readonly<Record<string, readonly number[]>> = {
  platonic: [
    Geometry.TetrahedronSolid,
    Geometry.TetrahedronWire,
    Geometry.OctahedronSolid,
    Geometry.OctahedronWire,
    Geometry.DodecahedronSolid,
    Geometry.DodecahedronWire,
    Geometry.IcosahedronSolid,
    Geometry.IcosahedronWire,
    Geometry.CubeSolid,
    Geometry.CubeWire,
  ],
  round: [
    Geometry.SphereSolid,
    Geometry.SphereWire,
    Geometry.TorusSolid,
    Geometry.TorusWire,
    Geometry.CylinderSolid,
    Geometry.CylinderWire,
    Geometry.ConeSolid,
    Geometry.ConeWire,
  ],
  wire_only: [
    Geometry.CubeWire,
    Geometry.SphereWire,
    Geometry.ConeWire,
    Geometry.TorusWire,
    Geometry.DodecahedronWire,
    Geometry.OctahedronWire,
    Geometry.TetrahedronWire,
    Geometry.IcosahedronWire,
    Geometry.PinWire,
    Geometry.CylinderWire,
  ],
  spiky: [
    Geometry.ConeSolid,
    Geometry.ConeWire,
    Geometry.PinSolid,
    Geometry.PinWire,
    Geometry.TetrahedronSolid,
    Geometry.TetrahedronWire,
    Geometry.Star,
  ],
  particles: [Geometry.Point, Geometry.Circle, Geometry.Cross, Geometry.Star],
  mixed: [
    Geometry.SphereSolid,
    Geometry.TorusSolid,
    Geometry.CylinderSolid,
    Geometry.OctahedronSolid,
    Geometry.IcosahedronSolid,
    Geometry.DodecahedronSolid,
    Geometry.ConeSolid,
    Geometry.PinSolid,
    Geometry.Circle,
    Geometry.Star,
  ],
}

/** Hue-relationship schemes — colour theory per design, not random RGB. */
export const PALETTE_SCHEMES: readonly string[] = [
  'monochrome',
  'analogous',
  'complementary',
  'triadic',
  'split_complementary',
  'rainbow',
]

const MIN_BRANCH = 2
const MAX_BRANCH = 12

/**
 * The seed the Seed field starts at, and what "randomness disabled" means: an
 * arbitrary fixed constant to start the same tuned ranges from, not a code path
 * of its own and not a quality signal.
 */
export const DETERMINISTIC_SEED = 42

/**
 * A level's scale is LOCAL to its parent — the renderer composes the ancestor
 * chain itself, exactly like a glPushMatrix chain. A generator that also
 * pre-multiplies a running cumulative scale double-compounds it and shrinks
 * geometrically with depth (0.5^depth vanishes fast); that was the cause of the
 * near-zero scales Jeff hit 2026-07-01, and is why each level samples its own
 * scale independently here.
 */
const SCALE_MIN = 0.5
const SCALE_MAX = 1.3
const ROOT_SCALE_MAX = 1.6

/** The creative choices behind a design, for the info readout. */
export interface DesignMeta {
  geometryFamily: string
  paletteScheme: string
  translucent: boolean
  levelCounts: number[]
}

/** Everything one Regenerate produced. */
export interface HyperglyphDesign {
  recipe: GlyphRecipe
  meta: DesignMeta
  seed: number
  /** Whether Idle Motion was applied — captured at generate time, see below. */
  idleMotion: boolean
}

export interface GenerateHyperglyphOptions {
  branchLevels: number
  maxNodes: number
  seed: number
  idleMotion: boolean
  name?: string
}

/** 1 (root) + the running products — the full tree size for these counts. */
export function totalNodes(counts: readonly number[]): number {
  let total = 1
  let running = 1
  for (const c of counts) {
    running *= c
    total += running
  }
  return total
}

/**
 * `depth` branching factors that keep the whole tree at or under `maxNodes`,
 * randomized around a size appropriate to the budget rather than uniformly
 * maxed out — asymmetric counts read as grown, a regular tree as generated.
 *
 * Divergence (a desktop BUG, reported to Jeff 2026-07-28): the desktop's window
 * around `guess` is `randint(max(2, guess - 2), min(12, guess + 2))`, and for a
 * shallow tree with a big budget `guess` runs away — branch levels 2 with the
 * default 500 nodes gives `randint(498, 12)`, an empty range, which raises
 * ValueError out of the dialog. Clamping the low end to the high one is the
 * smallest fix that keeps a legal call; it only ever fires where the desktop
 * cannot generate at all, so no seed's design changes.
 */
export function pickLevelCounts(depth: number, maxNodes: number, rng: PythonRandom): number[] {
  if (depth <= 0) return []
  const guess = Math.max(MIN_BRANCH, roundHalfToEven(maxNodes ** (1 / depth)))
  const high = Math.min(MAX_BRANCH, guess + 2)
  const low = Math.min(Math.max(MIN_BRANCH, guess - 2), high)
  const counts = Array.from({ length: depth }, () => Math.max(1, rng.randint(low, high)))
  // Trim until it fits, always at the DEEPEST level that still has more than
  // one child: that is the level whose count multiplies the total the most, so
  // it is the cheapest place to buy budget back.
  while (totalNodes(counts) > maxNodes && counts.some((c) => c > 1)) {
    let idx = 0
    for (let i = 0; i < depth; i++) {
      if (counts[i] > 1) idx = i
    }
    counts[idx] -= 1
  }
  return counts
}

function hsvToRgb255(h: number, s: number, v: number): [number, number, number] {
  const [r, g, b] = hsvToRgb(pyMod(h, 1), Math.max(0, Math.min(1, s)), Math.max(0, Math.min(1, v)))
  return [roundHalfToEven(r * 255), roundHalfToEven(g * 255), roundHalfToEven(b * 255)]
}

/** One base hue (0…1) per level, related according to `scheme`. */
export function makePalette(scheme: string, levels: number, rng: PythonRandom): number[] {
  const base = rng.random() // drawn unconditionally, before any scheme branch
  if (levels <= 1) return [base]
  const range = Array.from({ length: levels }, (_, i) => i)
  switch (scheme) {
    case 'monochrome':
      return range.map(() => base)
    case 'analogous': {
      const spread = 0.1
      return range.map((i) => pyMod(base + (i / (levels - 1) - 0.5) * 2 * spread, 1))
    }
    case 'complementary':
      return range.map((i) => pyMod(i % 2 === 0 ? base : base + 0.5, 1))
    case 'triadic': {
      const offsets = [0, 1 / 3, 2 / 3]
      return range.map((i) => pyMod(base + offsets[i % 3], 1))
    }
    case 'split_complementary': {
      const offsets = [0, 0.5 - 0.08, 0.5 + 0.08]
      return range.map((i) => pyMod(base + offsets[i % 3], 1))
    }
    case 'rainbow':
      return range.map((i) => pyMod(i / levels, 1))
    default:
      return range.map(() => base)
  }
}

/**
 * A fresh random recipe.
 *
 * The ORDER of the rng calls below is the specification, not an implementation
 * detail: it is what makes a seed reproduce a design, so a "tidier" reordering
 * (or hoisting a value out of a conditional that currently guards its draw —
 * the `translucent` alphas and the non-leaf topology are the ones to watch)
 * silently repoints every existing seed at a different hyperglyph.
 */
export function randomRecipe(
  branchLevels: number,
  maxNodes: number,
  rng: PythonRandom,
  name = 'Hyperglyph',
): { recipe: GlyphRecipe; meta: DesignMeta } {
  const depth = Math.max(0, branchLevels - 1) // level 0 is the trunk
  const counts = pickLevelCounts(depth, maxNodes, rng)

  const familyName = rng.choice(Object.keys(GEO_FAMILIES))
  const geoPool = GEO_FAMILIES[familyName]
  const paletteScheme = rng.choice(PALETTE_SCHEMES)
  const hues = makePalette(paletteScheme, branchLevels, rng)
  const translucent = rng.random() < 0.3

  const levels: LevelSpec[] = []

  // --- Trunk (level 0): always one centred root. ---
  const trunkHue = hues[0]
  const trunkSat = rng.uniform(0.55, 0.9)
  const trunkVal = rng.uniform(0.75, 1.0)
  const [r0, g0, b0] = hsvToRgb255(trunkHue, trunkSat, trunkVal)
  const a0 = translucent ? rng.randint(160, 220) : 255
  const trunkTopo = rng.choice(ANGULAR_SAFE_TOPOS)
  const rootScale = rng.uniform(SCALE_MIN, ROOT_SCALE_MAX)
  levels.push(
    levelSpec({
      count: 1,
      geometry: rng.choice(geoPool),
      topo: trunkTopo,
      ratio: rng.uniform(0.1, 0.3),
      distMode: Dist.Linear,
      distStep: 0,
      scaleX: rootScale,
      scaleY: rootScale,
      scaleZ: rootScale,
      rotateX: rng.uniform(0, 360),
      rotateY: rng.uniform(0, 360),
      rotateZ: rng.uniform(0, 360),
      colorStart: [r0, g0, b0, a0],
      colorEnd: null,
    }),
  )

  let parentTopo = trunkTopo
  for (const [index, count] of counts.entries()) {
    const i = index + 1
    const isLeaf = i === counts.length
    // A leaf's own topology places nothing, but it is still set (to the
    // parent's) so the recipe stays coherent if it is opened for editing.
    const thisTopo = isLeaf ? parentTopo : rng.choice(ANGULAR_SAFE_TOPOS)

    const baseScale = rng.uniform(SCALE_MIN, SCALE_MAX)
    const stretch = rng.random() < 0.3
    let sx = baseScale
    let sy = baseScale
    let sz = baseScale
    if (stretch) {
      const axis = rng.choice([0, 1, 2])
      const factors = [1, 1, 1]
      factors[axis] = rng.uniform(1.4, 2.2)
      ;[sx, sy, sz] = factors.map((f) => Math.max(SCALE_MIN, baseScale * f))
    }

    const distMode = rng.random() < 0.75 ? Dist.Angular : Dist.Linear
    const spread = rng.uniform(1.4, 3.2)

    const hue = hues[i % hues.length]
    const sat = rng.uniform(0.55, 0.95)
    const val = rng.uniform(0.7, 1.0)
    const [rs, gs, bs] = hsvToRgb255(hue, sat, val)
    const aStart = translucent ? rng.randint(140, 210) : 255
    const gradient = rng.random() < 0.6
    let colorEnd: RecipeColor | null = null
    if (gradient) {
      const hueEnd = pyMod(hue + rng.uniform(-0.12, 0.12), 1)
      const endSat = sat * rng.uniform(0.7, 1.0)
      const endVal = val * rng.uniform(0.6, 1.0)
      const [re, ge, be] = hsvToRgb255(hueEnd, endSat, endVal)
      const aEnd = translucent ? rng.randint(120, 200) : 255
      colorEnd = [re, ge, be, aEnd]
    }

    levels.push(
      levelSpec({
        count,
        geometry: rng.choice(geoPool),
        topo: thisTopo,
        ratio: rng.uniform(0.08, 0.35),
        distMode,
        distStep: rng.uniform(1.5, 3.0),
        distAxis: rng.choice([0, 1, 2]),
        distTilt: rng.uniform(-30, 30),
        distTz: spread,
        scaleX: sx,
        scaleY: sy,
        scaleZ: sz,
        rotateX: rng.uniform(-45, 45),
        rotateY: rng.uniform(-45, 45),
        rotateZ: rng.uniform(-45, 45),
        colorStart: [rs, gs, bs, aStart],
        colorEnd,
      }),
    )
    parentTopo = thisTopo
  }

  return {
    recipe: { name, levels },
    meta: { geometryFamily: familyName, paletteScheme, translucent, levelCounts: counts },
  }
}

/**
 * Wire each node's `color_index` to its depth, so a fresh hyperglyph is already
 * set up for the =/− palette keys: index = branch_level + 1, because index 0 is
 * not a colour any palette resolves. The trunk takes 1, its children 2, and so
 * on — and since the index is relative to whatever `palette_id` the node
 * carries, stepping the palette recolours the design by level.
 */
export function assignColorIndex(nodes: readonly GvNode[]): void {
  for (const node of nodes) node.colorIndex = node.branchLevel + 1
}

/**
 * A slow rotate_rate spin on every non-root node, alternating direction by
 * depth — an orrery, where each ring of children counter-rotates against its
 * parent ring — so a freshly generated hyperglyph reads as alive before any
 * Channels data drives it.
 *
 * translate_rate and scale_rate are deliberately left alone: rates integrate a
 * constant delta forever with no wraparound, so those two would drift and grow
 * without bound rather than looping. Only rotation is safe unattended.
 */
export function applyIdleMotion(nodes: readonly GvNode[], rng: PythonRandom): void {
  for (const node of nodes) {
    if (node.branchLevel === 0) continue
    const direction = node.branchLevel % 2 === 0 ? 1 : -1
    const speed = rng.uniform(0.04, 0.3) * direction
    const axis = rng.choice(['x', 'y', 'z'] as const)
    node.rotateRate[axis] = speed
  }
}

/**
 * One Regenerate: recipe + the design's own meta, ready to be turned into nodes
 * anywhere in a scene. `idleMotion` is carried on the result rather than read
 * again at insert time — that is what makes Insert into Scene deliver exactly
 * the design that was previewed, even if the checkbox has been flipped since
 * without regenerating (the desktop captures it into `_idle_motion_applied` for
 * the same reason).
 */
export function generateHyperglyph(options: GenerateHyperglyphOptions): HyperglyphDesign {
  const { recipe, meta } = randomRecipe(
    options.branchLevels,
    options.maxNodes,
    new PythonRandom(options.seed),
    options.name ?? 'Hyperglyph',
  )
  return { recipe, meta, seed: options.seed, idleMotion: options.idleMotion }
}

/**
 * The design's nodes, placed at `startId` under `parentId`. Called once for the
 * preview and again for each insertion: placement is deterministic given the
 * recipe (nothing here draws from the design's rng), so every call reproduces
 * the identical structure and only the ids and the anchor differ.
 *
 * Idle motion re-derives from the design's own seed with a FRESH generator,
 * exactly as the desktop does. One consequence worth knowing (it is the
 * desktop's too, and the parity fixture covers it): the spin depends on
 * ABSOLUTE branch level — `applyIdleMotion` skips level 0 and alternates
 * direction by depth — so a design inserted UNDER a selected node gets a
 * spinning trunk and a different rate on every node than the same seed
 * inserted at the root. The shape, colours and geometry are identical either
 * way; only the animation re-levels.
 */
export function buildHyperglyphNodes(
  design: HyperglyphDesign,
  options: { startId?: number; parentId?: number; baseBranchLevel?: number } = {},
): GvNode[] {
  const nodes = generateNodes(design.recipe, options)
  assignColorIndex(nodes)
  if (design.idleMotion) applyIdleMotion(nodes, new PythonRandom(design.seed))
  return nodes
}
