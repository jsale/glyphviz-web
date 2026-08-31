// Epicycle chains: a Fourier series built out of nested Torus-topology parents.
//
// A port of the desktop's `glyphviz_core/epicycles.py` (verified against source
// 2026-08-31, commit 862fffc). A chain of Torus-topology nodes, each the child
// of the last, each spinning its own `translate_x`, is exactly a truncated
// Fourier series — the pen at the end traces the sum of the arms. This module
// owns that construction: the design model, the node builder, the spectrum
// analysis, the Channels tracks and the presets. Like the desktop's, it is a
// PURE data module (no THREE, no DOM), so it tests in plain node.
//
// The one thing it does NOT own is the traced path. The desktop's `trace_path`
// builds a live `Scene` and reads `world_pos`, deliberately rather than
// reimplementing the topology math; this app's equivalent lives in
// `src/render/epicyclePath.ts`, which composes `applyFrameTransform` — the
// builder's own rule — along the chain, and the path is INJECTED here. That is
// the split `basemap.ts` / `basemapFetch.ts`, `drawMode.ts` / `drawPlane.ts`
// and `selectionExport.ts` / `selectionPlacement.ts` already make, and it is
// what keeps the trail on the curve to the CSV's own write precision instead of
// approximately.
//
// THE THREE MECHANISMS
// --------------------
// 1. THE HARMONIC LADDER (`Arm.rateX`). Each level's `translate_x` is an angle
//    in its PARENT's rotating frame, so the angles compose down the chain:
//
//        h₁ = r₁
//        h_k = h_{k-1} + (-1)^(k-1) · r_k      (+ odd levels, − even ones)
//
//    The alternating sign is real: `rotate = (90, 90, 0)` on every level cancels
//    the base rotation Torus topology applies to its children, and the
//    cancellation leaves the frame's handedness flipped at each step. Without
//    that rotation the rings tip 90° out of plane at every level, the chain
//    corkscrews off the z = 0 plane, and the ladder collapses. Rates
//    (+1, −1, +1, −1) therefore climb to 1, 2, 3, 4 rather than to 1, 0, 1, 0.
// 2. PLANE TILT (`Arm.tilt`) — the first way out of the plane. Adding t degrees
//    to a node's `rotate_y` tips its ring plane by exactly t, where `rotate_x`
//    and `rotate_z` leave it alone at this base pose. So each arm can orbit in
//    its own inclined plane: a classical orrery.
// 3. THE TUBE (`Arm.tube` + `rateY`/`phaseY`) — the second way out, and the more
//    interesting one. Torus topology places a child at (orbit angle u, tube
//    angle v), so a fat tube gives the arm a SECOND circle riding the first. In
//    spectrum terms it is a sideband generator: an arm at harmonic h with tube
//    rate r contributes h, h − r and h + r in the plane and a pure r out of it.
//    That is what turns a flat rosette into a genuine space curve, and with two
//    arms it is a torus knot.
//
// UNITS, AND THE ONE CONVERSION
// -----------------------------
// `Arm.length` and `Arm.tube` are WORLD units, because that is what an author
// can reason about. The engine works in the parent's local frame, where the
// torus base radius is 1 and everything is multiplied by the parent's cumulative
// scale — so this module converts:
//
//     node scale   = length[k+1] / length[k]   (telescoping, so the product
//                                               lands on each arm's length)
//     parent ratio = tube[k] / length[k]       (see tubeRatio — the tube is the
//                                               PARENT's torus thickness, so the
//                                               drawn ring is the circle the
//                                               child rides)
//
// A node's rendered torus IS the circle its own child rides, and its radius is
// that node's cumulative scale — which is why `length[k]` is set by the scale of
// the node one level UP, not by the node it belongs to.
//
// WHAT THE CURVE IS CALLED
// ------------------------
// Not a Lissajous figure — that is a PRODUCT of two independent 1-D
// oscillations. This is a SUM of rotating vectors: the epitrochoid family. Two
// terms give the textbook epitrochoid / hypotrochoid (the Spirograph curve); n
// terms give an epicyclic curve, or a truncated Fourier series curve.

import { blankNode } from './createNode'
import type { PythonRandom } from './pythonRandom'
import type { GvNode, Vec3 } from './types'
import { Geometry, NodeType, Topo } from './types'

// ---------------------------------------------------------------- constants

export const MIN_ARMS = 2
export const MAX_ARMS = 8

/**
 * Torus glyph thickness. The minor radius is `ratio × size`, so the ring a node
 * wears is a hairline at the default — these are orbits, not doughnuts.
 */
export const DEFAULT_RING_RATIO = 0.02

/**
 * Trail beads are Point sprites; `ratio × 20` px is the one control that resizes
 * them (scale cannot — a point sprite ignores the modelview scale).
 */
const TRAIL_BEAD_RATIO = 0.1
/** The Plot parent's ratio, which sets the POLYLINE width the same way. */
const TRAIL_LINE_RATIO = 0.15

/**
 * Beads sharing one alpha channel in a self-drawing scene. Keeps the tracks file
 * to frames × (arms + beads/GROUP) columns instead of one per bead; the cost is
 * the line lagging the pen by at most this many frames. It LAGS rather than
 * leads because a group lights when its LAST bead is reached — a line running
 * ahead of the pen would be drawing a curve it has not travelled yet.
 */
export const DEFAULT_BEAD_GROUP = 3

/**
 * Upper bound for `closureFrames`' search before it gives up and says "does not
 * close". 3600 frames is two minutes at 30 fps — past that, a trail is a smear
 * rather than a figure.
 */
export const MAX_CLOSURE_FRAMES = 3600

/**
 * Hard cap on trail beads, so a designer slider cannot author a 50k-node scene
 * by accident. 1440 beads at quarter-degree steps is already smoother than the
 * 3 px polyline can show.
 */
export const MAX_TRAIL_POINTS = 1440

/**
 * A tube may not swallow its own orbit: at ratio 1 the torus degenerates to a
 * sphere and the arm's inner reach passes through the hub.
 */
export const MAX_TUBE_FRACTION = 0.95

/**
 * Above this tube fraction a ring is drawn as WIREFRAME instead of solid. A
 * hairline orbit ring is a line and reads fine solid; a fat tube is a SURFACE,
 * and a solid one at 0.75 is an opaque doughnut that hides the very mechanism it
 * exists to show (measured on the desktop by rendering it — it came out as a
 * featureless ball). Wire also matches the series convention where wireframe
 * means scaffolding.
 */
export const TUBE_WIRE_THRESHOLD = 0.15

/** Background of a standalone scene file — the GlyphViz brand family. */
const BACKGROUND: Rgba4 = [14, 14, 26, 255]
const RING_COLORS: Rgba4[] = [
  [99, 140, 255, 150], // indigo
  [38, 198, 181, 150], // teal
  [167, 139, 250, 150], // violet
  [255, 111, 97, 150], // coral
  [120, 200, 120, 150], // green
  [240, 160, 220, 150], // pink
  [200, 200, 120, 150], // olive
  [140, 200, 255, 150], // ice
]
const ARM_COLOR: Rgba4 = [150, 160, 190, 220]
const PEN_COLOR: Rgba4 = [255, 255, 255, 255]
const TRAIL_COLOR: Rgba4 = [255, 193, 7, 235]

type Rgba4 = [number, number, number, number]

// ------------------------------------------------------------- design model

/**
 * One term of the series — one circle, and the node that rides it. `length` and
 * `tube` are world units; everything else is degrees, with the rates in degrees
 * per frame.
 */
export interface Arm {
  /** World radius of this arm's orbit circle. */
  length: number
  /** Orbit angle, deg/frame — this is the harmonic. */
  rateX: number
  /** Starting orbit angle. */
  phaseX: number
  /** Tube angle, deg/frame — the out-of-plane spin. */
  rateY: number
  /** Starting tube angle. */
  phaseY: number
  /**
   * World radius of a second circle this arm rides, around the torus tube.
   * 0 = a flat arm. Carved OUT of `length` rather than added to it (see
   * `tubeRatio`), so the arm stays `length` long at phaseY 0 and the drawn ring
   * is the tube the child actually travels. Capped at 0.95 × length.
   */
  tube: number
  /** Degrees this arm's plane leans out of the last one. */
  tilt: number
}

export function defaultArm(overrides: Partial<Arm> = {}): Arm {
  return { length: 10, rateX: 1, phaseX: 0, rateY: 0, phaseY: 0, tube: 0, tilt: 0, ...overrides }
}

/** A whole scene: the chain, and how to dress it. */
export interface EpicycleDesign {
  name: string
  arms: Arm[]
  /** World radius of the pen sphere at the end of the chain. */
  penSize: number
  ringRatio: number
  /** Draw each arm's orbit as a torus glyph (off = wireframe). */
  showRings: boolean
  /** Draw the linkage as type-7 Link rods. */
  showArms: boolean
  /** Linkage rod thickness, world units. */
  armRatio: number
  trail: boolean
  trailPoints: number
  /** Channels + a per-bead alpha step, so the curve draws itself. */
  selfDrawing: boolean
  beadGroup: number
  /** null = the computed closure period. */
  frames: number | null
}

export function defaultDesign(overrides: Partial<EpicycleDesign> = {}): EpicycleDesign {
  return {
    name: 'Epicycles',
    arms: [defaultArm(), defaultArm({ rateX: -1 })],
    penSize: 1.2,
    ringRatio: DEFAULT_RING_RATIO,
    showRings: true,
    showArms: true,
    armRatio: 0.25,
    trail: true,
    trailPoints: 720,
    selfDrawing: false,
    beadGroup: DEFAULT_BEAD_GROUP,
    frames: null,
    ...overrides,
  }
}

/** `Arm.clamped()` — a length of zero has no frame to divide by. */
function clampedArm(arm: Arm): Arm {
  return { ...arm, length: Math.max(1e-3, arm.length), tube: Math.max(0, arm.tube) }
}

/** `EpicycleDesign.normalized()`. */
export function normalizedDesign(design: EpicycleDesign): EpicycleDesign {
  return { ...design, arms: design.arms.map(clampedArm) }
}

export function cloneDesign(design: EpicycleDesign): EpicycleDesign {
  return { ...design, arms: design.arms.map((a) => ({ ...a })) }
}

// ------------------------------------------------------- design JSON (.json)
//
// The desktop's `to_dict` / `from_dict` exactly — snake_case keys, so a design
// written by either app opens in the other. Unknown keys are ignored and missing
// ones take the default, matching `from_dict`'s `.get(...)` reads, so a file
// from an older or newer build still loads. This is the same contract the Glyph
// Composer's template I/O keeps.

export function designToJson(design: EpicycleDesign): Record<string, unknown> {
  return {
    name: design.name,
    pen_size: design.penSize,
    ring_ratio: design.ringRatio,
    show_rings: design.showRings,
    show_arms: design.showArms,
    arm_ratio: design.armRatio,
    trail: design.trail,
    trail_points: design.trailPoints,
    self_drawing: design.selfDrawing,
    bead_group: design.beadGroup,
    frames: design.frames,
    arms: design.arms.map((a) => ({
      length: a.length,
      rate_x: a.rateX,
      phase_x: a.phaseX,
      rate_y: a.rateY,
      phase_y: a.phaseY,
      tube: a.tube,
      tilt: a.tilt,
    })),
  }
}

function num(value: unknown, fallback: number): number {
  const v = Number(value)
  return Number.isFinite(v) ? v : fallback
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

export function designFromJson(data: unknown): EpicycleDesign {
  if (typeof data !== 'object' || data === null) throw new Error('not an epitrochoid design')
  const raw = data as Record<string, unknown>
  const base = defaultDesign()
  const armSource = Array.isArray(raw.arms) ? raw.arms : []
  const arms: Arm[] = armSource.map((entry) => {
    const a = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>
    const d = defaultArm()
    return {
      length: num(a.length, d.length),
      rateX: num(a.rate_x, d.rateX),
      phaseX: num(a.phase_x, d.phaseX),
      rateY: num(a.rate_y, d.rateY),
      phaseY: num(a.phase_y, d.phaseY),
      tube: num(a.tube, d.tube),
      tilt: num(a.tilt, d.tilt),
    }
  })
  return {
    name: typeof raw.name === 'string' ? raw.name : base.name,
    // `from_dict` falls back to a single default arm rather than to an empty
    // chain, which has no pen and nothing to trace.
    arms: arms.length > 0 ? arms : [defaultArm()],
    penSize: num(raw.pen_size, base.penSize),
    ringRatio: num(raw.ring_ratio, base.ringRatio),
    showRings: bool(raw.show_rings, base.showRings),
    showArms: bool(raw.show_arms, base.showArms),
    armRatio: num(raw.arm_ratio, base.armRatio),
    trail: bool(raw.trail, base.trail),
    trailPoints: num(raw.trail_points, base.trailPoints),
    selfDrawing: bool(raw.self_drawing, base.selfDrawing),
    beadGroup: num(raw.bead_group, base.beadGroup),
    frames: raw.frames === null || raw.frames === undefined ? null : num(raw.frames, 0) || null,
  }
}

// ------------------------------------------- the ladder, and when it closes

/**
 * World harmonic of each arm — `h_k = h_{k-1} + (−1)^(k−1) · r_k`.
 *
 * The sign alternates because each level's `rotate = (90, 90, 0)` cancels Torus
 * topology's base rotation and leaves the frame handedness flipped. Verified
 * against the desktop engine across seven rate vectors.
 */
export function harmonicsOf(rates: readonly number[]): number[] {
  const out: number[] = []
  let h = 0
  rates.forEach((r, index) => {
    h += (index % 2 === 0 ? 1 : -1) * r
    out.push(h)
  })
  return out
}

// --- exact rationals, so 1/2 and 1/3 give the right closure period ---------
//
// `closure_frames` runs in Python `Fraction`s. Floats cannot stand in: the whole
// point is that a rate of 1/3 answers 1080 rather than a near-miss, and the gcd
// is taken over numerators that a double cannot hold exactly. BigInt can, so
// these three helpers are CPython's `Fraction(float)` and
// `Fraction.limit_denominator` transcribed.

interface Frac {
  n: bigint
  d: bigint
}

function bgcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a
  let y = b < 0n ? -b : b
  while (y) {
    const t = x % y
    x = y
    y = t
  }
  return x
}

/** A normalized fraction, as `Fraction(n, d)` builds one. */
function frac(n: bigint, d: bigint): Frac {
  if (d === 0n) throw new RangeError('zero denominator')
  const sign = d < 0n ? -1n : 1n
  const g = bgcd(n, d) || 1n
  return { n: (sign * n) / g, d: (sign * d) / g }
}

/**
 * `Fraction(value)` for a finite float — EXACT, as CPython's is. Doubling until
 * the value is an integer is exact at every step (a double times two changes
 * only the exponent), and the integer it lands on is the 53-bit mantissa, which
 * `BigInt()` converts without loss.
 */
function exactFraction(value: number): Frac {
  if (!Number.isFinite(value)) throw new RangeError('not finite')
  let x = value
  let d = 1n
  let guard = 0
  while (!Number.isInteger(x) && guard < 1100) {
    x *= 2
    d *= 2n
    guard++
  }
  return frac(BigInt(x), d)
}

/** `Fraction.limit_denominator` — CPython's continued-fraction search. */
function limitDenominator(value: number, maxDenominator: bigint): Frac {
  const self = exactFraction(value)
  if (self.d <= maxDenominator) return self
  let p0 = 0n
  let q0 = 1n
  let p1 = 1n
  let q1 = 0n
  let n = self.n
  let d = self.d
  for (;;) {
    const a = n / d // both positive here, so truncation IS floor
    const q2 = q0 + a * q1
    if (q2 > maxDenominator) break
    ;[p0, q0, p1, q1] = [p1, q1, p0 + a * p1, q2]
    ;[n, d] = [d, n - a * d]
  }
  const k = (maxDenominator - q0) / q1
  // Which of the two candidates is closer — CPython's own comparison.
  if (2n * d * (q0 + k * q1) <= self.d) return frac(p1, q1)
  return frac(p0 + k * p1, q0 + k * q1)
}

const CLOSURE_FRACTION_LIMIT = 360n

/**
 * Frames after which every angle is back where it started, or null.
 *
 * An angle advancing r deg/frame returns after N frames iff `r·N` is a multiple
 * of 360. Over all the rates at once that is `N = 360 / gcd(rates)`, computed
 * exactly in rationals so 0.5 or 1/3 give the right answer rather than a float
 * near-miss. Returns null when the answer would exceed `cap` — or when nothing
 * moves at all.
 */
export function closureFrames(
  design: EpicycleDesign,
  cap: number = MAX_CLOSURE_FRAMES,
): number | null {
  const rates: number[] = []
  for (const arm of design.arms) {
    for (const r of [arm.rateX, arm.rateY]) if (Math.abs(r) > 1e-12) rates.push(r)
  }
  if (rates.length === 0) return null

  let g = limitDenominator(Math.abs(rates[0]), CLOSURE_FRACTION_LIMIT)
  for (const r of rates.slice(1)) {
    const other = limitDenominator(Math.abs(r), CLOSURE_FRACTION_LIMIT)
    // gcd(a/b, c/d) = gcd(a, c) / lcm(b, d), for two fractions in lowest terms.
    // gcd(0, x) = x, so a rate that rounds away to zero under the denominator
    // limit contributes nothing rather than poisoning the running gcd — which is
    // why the zero test below is on the FINAL value, not on each step.
    const lcm = (g.d / bgcd(g.d, other.d)) * other.d
    g = frac(bgcd(g.n, other.n), lcm)
  }
  if (g.n === 0n) return null

  // 360 / g, then ceil if it is not a whole number of frames.
  const value = frac(360n * g.d, g.n)
  let n = value.n / value.d
  if (value.d !== 1n) n = n + 1n // positive, so truncation + 1 is ceil
  const result = Number(n)
  return result > 0 && result <= cap ? result : null
}

/**
 * The frame count a scene should actually use: the author's override, the
 * closure period, or a sane fallback for a curve that never closes.
 */
export function frameCount(design: EpicycleDesign): number {
  if (design.frames) return Math.trunc(design.frames)
  return closureFrames(design) ?? 720
}

/**
 * (frame step between beads, bead count) — the ONE place the trail's sampling is
 * decided, so the node builder and the alpha channels cannot disagree about
 * which frame a given bead belongs to. On the desktop they did, briefly:
 * recomputing the step from the bead count instead of sharing it lit each group
 * at the wrong moment whenever `frames` was not a multiple of it.
 */
export function trailSampling(design: EpicycleDesign, frames: number): [number, number] {
  const points = Math.min(Math.trunc(design.trailPoints), MAX_TRAIL_POINTS, Math.max(1, frames))
  const step = Math.max(1, Math.floor(frames / Math.max(1, points)))
  return [step, Math.max(0, Math.ceil(frames / step))]
}

// ------------------------------------------------------------ node building

/**
 * The `ratio` the node one level ABOVE arm k must wear.
 *
 * A torus glyph's tube radius is `ratio × size`, and `topoOffset` reads that
 * SAME ratio to place children — so setting the parent's ratio to the tube
 * fraction makes the drawn ring literally BE the circle its child rides, instead
 * of a hairline next to an invisible one. That equality is the whole reason the
 * tube is expressed this way rather than through the child's `translate_z`
 * (which also works, but draws nothing and pushes the arm LONGER than its
 * authored length).
 *
 * With ratio = T the child sits at local radius `(1 − T) + T·cos v`: exactly 1
 * at `v = 0`, so `Arm.length` stays the true arm length, and the child sweeps a
 * circle of world radius `T × length` around it.
 */
function tubeRatio(design: EpicycleDesign, k: number): number {
  if (k >= design.arms.length) return design.ringRatio
  const arm = design.arms[k]
  if (arm.tube <= 0 || arm.length <= 0) return design.ringRatio
  return Math.min(MAX_TUBE_FRACTION, Math.max(design.ringRatio, arm.tube / arm.length))
}

/** The desktop's `_node(**kw)` base row, with `child_id`/`ch_input_id` present. */
function epicycleNode(id: number, overrides: Partial<GvNode> = {}): GvNode {
  const node = blankNode(id, {
    geometry: Geometry.SphereSolid,
    topo: Topo.None,
    scale: { x: 1, y: 1, z: 1 },
    color: { r: 255, g: 255, b: 255, a: 255 },
  })
  // Both columns are in the desktop writer's own NODE_COLS, on every row.
  node.extras.child_id = '0'
  node.extras.ch_input_id = '0'
  return Object.assign(node, overrides)
}

function rgba(c: Rgba4) {
  return { r: c[0], g: c[1], b: c[2], a: c[3] }
}

function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z }
}

export interface ChainOptions {
  startId: number
  parentId: number
  baseBranch: number
  /**
   * True when Channels will drive the chain, which is what zeroes the
   * `translate_rate` fields — two things writing the same angle would fight.
   */
  animated: boolean
}

/**
 * The hub plus one node per arm, with the linkage rods.
 *
 * Two indexing facts worth stating once, because both are easy to get
 * backwards:
 *
 * - `arms[k].length` is the length of the arm leading TO node k, and it is
 *   produced by the SCALE of the node one level up — a node's torus is the
 *   circle its child rides.
 * - `arms[k].tilt` tips that same arm, so it is written as `rotate_y` on the
 *   PARENT, whose ring plane is the one being tipped.
 */
export function chainNodes(design: EpicycleDesign, options: ChainOptions): GvNode[] {
  const { startId, parentId, baseBranch, animated } = options
  const arms = design.arms
  const n = arms.length

  /** Solid for a hairline orbit ring, wire once it is a real tube. */
  const ringGeoFor = (k: number): number => {
    if (!design.showRings) return Geometry.TorusWire
    return tubeRatio(design, k) > TUBE_WIRE_THRESHOLD ? Geometry.TorusWire : Geometry.TorusSolid
  }

  const nodes: GvNode[] = []

  const hub = epicycleNode(startId, {
    parentId,
    branchLevel: baseBranch,
    topo: Topo.Torus,
    geometry: ringGeoFor(0),
    ratio: tubeRatio(design, 0),
    scale: vec3(arms[0].length, arms[0].length, arms[0].length),
    // The hub is a plain root: no base rotation to cancel, so arm 1's tilt is
    // its whole rotate_y.
    rotate: vec3(0, arms[0].tilt, 0),
    color: rgba(RING_COLORS[0]),
  })
  hub.text =
    `hub - never moves. Its torus IS the circle arm 1 rides; the radius is its ` +
    `own scale, ${formatG(arms[0].length)} = arm 1's length`
  nodes.push(hub)

  arms.forEach((arm, k) => {
    const last = k === n - 1
    // Telescoping: this node's scale carries the frame from arm k's length to
    // arm k+1's, so the cumulative product lands on each arm's length.
    const scale = last ? design.penSize / arm.length : arms[k + 1].length / arm.length
    const color = rgba(last ? PEN_COLOR : RING_COLORS[(k + 1) % RING_COLORS.length])
    nodes.push(
      epicycleNode(startId + 1 + k, {
        parentId: startId + k,
        branchLevel: baseBranch + 1 + k,
        topo: Topo.Torus,
        geometry: last ? Geometry.SphereSolid : ringGeoFor(k + 1),
        // The NEXT arm's tube, because a node's `ratio` is what the topology
        // reads for its CHILDREN's tube radius — the same reason the next arm's
        // tilt rides on this node's rotate_y.
        ratio: tubeRatio(design, k + 1),
        translate: vec3(arm.phaseX, arm.phaseY, 0),
        // 90/90 is the cancellation; the NEXT arm's tilt rides on rotate_y,
        // because this node's ring plane is the one that arm orbits in.
        rotate: vec3(90, 90 + (last ? 0 : arms[k + 1].tilt), 0),
        scale: vec3(scale, scale, scale),
        translateRate: vec3(animated ? 0 : arm.rateX, animated ? 0 : arm.rateY, 0),
        color,
      }),
    )
  })

  const harmonics = harmonicsOf(arms.map((a) => a.rateX))
  arms.forEach((arm, k) => {
    const last = k === n - 1
    const bits = [
      `arm ${k + 1}: harmonic ${formatG(harmonics[k])}`,
      `length ${formatG(arm.length)}`,
      `rate_x ${formatG(arm.rateX, true)}`,
    ]
    if (arm.phaseX) bits.push(`phase ${formatG(arm.phaseX)} deg`)
    if (arm.tube) {
      bits.push(
        `tube radius ${formatG(arm.tube)} at rate_y ${formatG(arm.rateY, true)} ` +
          `(sidebands at ${formatG(harmonics[k] - arm.rateY)} and ` +
          `${formatG(harmonics[k] + arm.rateY)})`,
      )
    }
    if (arm.tilt) bits.push(`plane tilted ${formatG(arm.tilt)} deg`)
    nodes[1 + k].text = (last ? 'pen - ' : '') + bits.join(', ')
  })

  if (design.showArms) {
    for (let k = 0; k < n; k++) {
      const aId = startId + k
      const bId = startId + 1 + k
      const link = epicycleNode(startId + 1 + n + k, {
        parentId: aId,
        branchLevel: baseBranch + 1 + k,
        type: NodeType.Link,
        geometry: Geometry.CylinderSolid,
        ratio: design.armRatio,
        color: rgba(ARM_COLOR),
      })
      link.extras.child_id = String(bId)
      link.text =
        `arm ${k + 1} rod - a type=7 Link wearing Cylinder geometry, ` +
        `stretched between the two ring centres`
      nodes.push(link)
    }
  }
  return nodes
}

/**
 * A transparent Plot parent plus one Point bead per sampled position.
 *
 * Three things this depends on, all pinned by tests on both sides:
 *
 * - The Plot parent must be `color_a = 0`, NOT `hide = 1` — a hidden plot parent
 *   suppresses the polyline entirely.
 * - The polyline takes its COLOUR from each child and its WIDTH from the
 *   parent's `ratio × 20` px.
 * - Plot draws through its children in CSV ROW ORDER, which is why the beads are
 *   emitted frame by frame.
 */
function trailNodes(
  design: EpicycleDesign,
  points: readonly Vec3[],
  startId: number,
  parentId: number,
  baseBranch: number,
): GvNode[] {
  const [r, g, b, a] = TRAIL_COLOR
  const plot = epicycleNode(startId, {
    parentId,
    branchLevel: baseBranch,
    topo: Topo.Plot,
    geometry: Geometry.Point,
    ratio: TRAIL_LINE_RATIO,
    color: { r, g, b, a: 0 },
  })
  plot.text =
    'trail - a Plot-topology parent; its polyline runs through the beads below in CSV row order'
  const nodes = [plot]
  points.forEach((p, i) => {
    const channel = design.selfDrawing
      ? 1 + design.arms.length + Math.floor(i / Math.max(1, design.beadGroup))
      : 0
    const bead = epicycleNode(startId + 1 + i, {
      parentId: startId,
      branchLevel: baseBranch + 1,
      topo: Topo.None,
      geometry: Geometry.Point,
      ratio: TRAIL_BEAD_RATIO,
      translate: vec3(p.x, p.y, p.z),
      scale: vec3(0.2, 0.2, 0.2),
      color: { r, g, b, a: design.selfDrawing ? 0 : a },
    })
    bead.extras.ch_input_id = String(channel)
    nodes.push(bead)
  })
  return nodes
}

export interface BuildEpicycleOptions {
  startId?: number
  parentId?: number
  baseBranchLevel?: number
  /**
   * Add the type=0 row that carries the background colour — right for a
   * standalone scene file, wrong for Insert into Scene (the loaded scene already
   * has one).
   */
  includeWorld?: boolean
  /**
   * The pen's world position at every frame, from
   * `src/render/epicyclePath.ts`. Required when `design.trail` is on: unlike the
   * desktop's, this module cannot fall back to tracing one itself, because the
   * tracer is the half that knows about the renderer.
   */
  path?: readonly Vec3[]
}

/** The whole scene as node rows, ids allocated contiguously from `startId`. */
export function buildEpicycleNodes(
  input: EpicycleDesign,
  options: BuildEpicycleOptions = {},
): GvNode[] {
  const design = normalizedDesign(input)
  const startId = options.startId ?? 1
  const parentId = options.parentId ?? 0
  const baseBranch = options.baseBranchLevel ?? 0
  const nodes: GvNode[] = []
  let nextId = startId

  if (options.includeWorld) {
    const world = epicycleNode(nextId, {
      type: NodeType.World,
      geometry: Geometry.Point,
      hide: 1,
      color: rgba(BACKGROUND),
    })
    world.text = 'world - the background colour lives on this type=0 row'
    nodes.push(world)
    nextId++
  }

  const chain = chainNodes(design, {
    startId: nextId,
    parentId,
    baseBranch,
    animated: design.selfDrawing,
  })
  nodes.push(...chain)
  nextId += chain.length

  if (design.selfDrawing) {
    let k = 0
    for (const node of chain) {
      if (node.type !== NodeType.Glyph) continue
      if (k) node.extras.ch_input_id = String(k) // the hub never moves
      k++
    }
  }

  if (design.trail) {
    const frames = frameCount(design)
    const [step] = trailSampling(design, frames)
    const path = options.path ?? []
    const sampled: Vec3[] = []
    for (let f = 0; f < frames; f += step) sampled.push(path[f] ?? vec3(0, 0, 0))
    nodes.push(...trailNodes(design, sampled, nextId, parentId, baseBranch))
  }
  return nodes
}

// ------------------------------------------------------------------ analysis

/**
 * (harmonic, amplitude) of the traced curve's in-plane motion.
 *
 * The DFT of `x + iy` — a COMPLEX transform, so it separates +h from −h, which
 * is exactly the difference between a term rotating one way and the other.
 * Out-of-plane motion does not appear here; `describeDesign` reports the z
 * extent separately.
 *
 * Harmonics come back in the SAME UNITS as `Arm.rateX` — turns per 360 frames —
 * not as raw DFT bins. A path sampled over N frames advances `rate × N` degrees,
 * so bin k means `k × 360 / N`.
 */
export function spectrum(
  path: readonly Vec3[],
  top = 12,
  floor = 1e-4,
): Array<[number, number]> {
  const n = path.length
  if (n < 4) return []
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    re[i] = path[i].x
    im[i] = path[i].y
  }
  const out = fft(re, im)
  const amp = new Float64Array(n)
  let scale = 0
  for (let k = 0; k < n; k++) {
    amp[k] = Math.hypot(out.re[k], out.im[k]) / n
    if (amp[k] > scale) scale = amp[k]
  }
  if (scale === 0) scale = 1

  const order = Array.from({ length: n }, (_, k) => k).sort((a, b) => amp[b] - amp[a])
  const perBin = 360 / n
  const result: Array<[number, number]> = []
  for (const k of order) {
    if (amp[k] < floor * scale || result.length >= top) break
    const binIndex = k <= Math.floor(n / 2) ? k : k - n
    result.push([binIndex * perBin, amp[k]])
  }
  return result
}

export interface EpicycleReport {
  arms: number
  frames: number
  closes: number | null
  harmonics: number[]
  spectrum: Array<[number, number]>
  halfSpan: number
  zExtent: number
  planar: boolean
}

/**
 * A report on what the design actually does — for the designer's readout.
 * Everything MEASURED off the traced path, nothing predicted.
 */
export function describeDesign(
  input: EpicycleDesign,
  path: readonly Vec3[],
  frames: number,
): EpicycleReport {
  const design = normalizedDesign(input)
  let maxAbs = 0
  let zLo = Infinity
  let zHi = -Infinity
  for (const p of path) {
    maxAbs = Math.max(maxAbs, Math.abs(p.x), Math.abs(p.y))
    zLo = Math.min(zLo, p.z)
    zHi = Math.max(zHi, p.z)
  }
  const zExtent = path.length > 0 ? zHi - zLo : 0
  return {
    arms: design.arms.length,
    frames,
    closes: closureFrames(design),
    harmonics: harmonicsOf(design.arms.map((a) => a.rateX)),
    spectrum: spectrum(path),
    halfSpan: maxAbs,
    zExtent,
    planar: zExtent < 1e-6,
  }
}

// ----------------------------------------------------------------- Channels

export interface ChMapEntry {
  channelId: number
  trackId: number
  attribute: string
}

export interface EpicycleChannels {
  map: ChMapEntry[]
  /** track id → one value per frame. */
  tracks: Map<number, number[]>
}

/**
 * (ch-map rows, track columns) for a self-drawing scene.
 *
 * One channel per arm driving `translate_x` / `translate_y`, then one alpha
 * channel per bead GROUP. Grouping is what keeps the tracks file to a few
 * hundred KB instead of several MB; several nodes may share a channel, so a
 * group is just N beads pointing at the same `ch_input_id`.
 */
export function buildChannels(input: EpicycleDesign, frames: number): EpicycleChannels {
  const design = normalizedDesign(input)
  const map: ChMapEntry[] = []
  const tracks = new Map<number, number[]>()
  let trackId = 1

  design.arms.forEach((arm, index) => {
    const k = index + 1
    tracks.set(
      trackId,
      Array.from({ length: frames }, (_, f) => arm.phaseX + arm.rateX * f),
    )
    map.push({ channelId: k, trackId, attribute: 'translate_x' })
    trackId++
    if (arm.rateY || arm.phaseY) {
      tracks.set(
        trackId,
        Array.from({ length: frames }, (_, f) => arm.phaseY + arm.rateY * f),
      )
      map.push({ channelId: k, trackId, attribute: 'translate_y' })
      trackId++
    }
  })

  const group = Math.max(1, Math.trunc(design.beadGroup))
  const [step, beads] = trailSampling(design, frames)
  const groups = Math.ceil(beads / group)
  for (let g = 0; g < groups; g++) {
    const channelId = 1 + design.arms.length + g
    // The group lights when its LAST bead is reached, so the line trails the pen
    // instead of running ahead of it.
    const lastBead = Math.min(beads - 1, (g + 1) * group - 1)
    const on = Math.min(frames - 1, lastBead * step)
    const column = new Array<number>(frames)
    for (let f = 0; f < frames; f++) column[f] = f < on ? 0 : TRAIL_COLOR[3]
    tracks.set(trackId, column)
    map.push({ channelId, trackId, attribute: 'color_a' })
    trackId++
  }
  return { map, tracks }
}

const CRLF = '\r\n'

/** The `gv_ch-map.csv` text: which channel drives which attribute. */
export function writeChMapCsv(channels: EpicycleChannels): string {
  const lines = ['channel_id,track_id,attribute']
  for (const row of channels.map) lines.push(`${row.channelId},${row.trackId},${row.attribute}`)
  return lines.join(CRLF) + CRLF
}

/** The `gv_ch-tracks.csv` text: one column per track, one row per frame. */
export function writeChTracksCsv(channels: EpicycleChannels, frames: number): string {
  const ids = [...channels.tracks.keys()].sort((a, b) => a - b)
  const lines = [['cyclecount', ...ids.map((i) => `ch${i}`)].join(',')]
  for (let f = 0; f < frames; f++) {
    const cells = ids.map((id) => (channels.tracks.get(id)?.[f] ?? 0).toFixed(6))
    lines.push([String(f), ...cells].join(','))
  }
  return lines.join(CRLF) + CRLF
}

// ------------------------------------------------------------------ presets

/**
 * Odd harmonics 1, 3, 5, 7 at amplitudes 1, 1/3, 1/5, 1/7.
 *
 * Rates follow from the ladder: to step the harmonic by 2 each level with the
 * sign alternating, the rates are 1, −2, +2, −2, …
 */
function squareWaveArms(terms = 4, base = 12): Arm[] {
  const arms: Arm[] = []
  for (let k = 0; k < terms; k++) {
    const h = 2 * k + 1
    const rate = k === 0 ? 1 : k % 2 === 0 ? 2 : -2
    // Rounded to the designer table's own displayed precision, so opening this
    // preset and reading it straight back is exact rather than 12/7 → 1.7143.
    arms.push(defaultArm({ length: pyRound(base / h, 4), rateX: rate }))
  }
  return arms
}

/** The eight presets, in the desktop combo's own order. */
export const PRESET_NAMES = [
  "Jeff's ANTz original",
  'Cardioid (2 terms)',
  'Spirograph (hypotrochoid)',
  'Square wave (odd harmonics)',
  'Torus knot (tube)',
  'Inclined orrery (tilt)',
  'Rose in space',
  'Deep chain (6 arms)',
] as const

const PRESETS: Record<string, EpicycleDesign> = {
  "Jeff's ANTz original": defaultDesign({
    name: 'Fourier_V1',
    arms: [
      defaultArm({ length: 10, rateX: 1, phaseX: 0 }),
      defaultArm({ length: 10, rateX: -1, phaseX: 90 }),
      defaultArm({ length: 10, rateX: 1, phaseX: 90 }),
      defaultArm({ length: 10, rateX: -1, phaseX: 90 }),
    ],
    penSize: 1.5,
  }),
  'Cardioid (2 terms)': defaultDesign({
    name: 'Cardioid',
    arms: [defaultArm({ length: 10, rateX: 1 }), defaultArm({ length: 10, rateX: -1 })],
  }),
  'Spirograph (hypotrochoid)': defaultDesign({
    name: 'Spirograph',
    arms: [defaultArm({ length: 14, rateX: 1 }), defaultArm({ length: 6, rateX: 6 })],
  }),
  'Square wave (odd harmonics)': defaultDesign({
    name: 'Square_Wave',
    arms: squareWaveArms(),
  }),
  'Torus knot (tube)': defaultDesign({
    name: 'Torus_Knot',
    arms: [
      defaultArm({ length: 14, rateX: 2 }),
      defaultArm({ length: 6, rateX: 0, tube: 4.5, rateY: 3 }),
    ],
    penSize: 1,
  }),
  'Inclined orrery (tilt)': defaultDesign({
    name: 'Inclined_Orrery',
    arms: [
      defaultArm({ length: 14, rateX: 1 }),
      defaultArm({ length: 7, rateX: -3, tilt: 35 }),
      defaultArm({ length: 3.5, rateX: 5, tilt: -55 }),
    ],
  }),
  'Rose in space': defaultDesign({
    name: 'Rose_In_Space',
    arms: [
      defaultArm({ length: 12, rateX: 1 }),
      defaultArm({ length: 6, rateX: -4, tilt: 40 }),
      defaultArm({ length: 3, rateX: 4, tube: 2.5, rateY: 7 }),
    ],
  }),
  'Deep chain (6 arms)': defaultDesign({
    name: 'Deep_Chain',
    arms: [
      defaultArm({ length: 12, rateX: 1 }),
      defaultArm({ length: 7, rateX: -1 }),
      defaultArm({ length: 4.5, rateX: 1, tilt: 25 }),
      defaultArm({ length: 3, rateX: -1 }),
      defaultArm({ length: 2, rateX: 1, tube: 1.2, rateY: 5 }),
      defaultArm({ length: 1.4, rateX: -1 }),
    ],
    penSize: 0.8,
  }),
}

/**
 * A fresh copy of a named preset — never the shared instance, so the designer
 * can mutate it freely.
 */
export function preset(name: string): EpicycleDesign {
  const src = PRESETS[name] ?? PRESETS[PRESET_NAMES[0]]
  return cloneDesign(src)
}

/**
 * A random design that is still likely to be worth looking at.
 *
 * The tuning that matters: rates are small integers (so the curve closes in 360
 * frames and reads as a rosette rather than a smear), and arm lengths decay,
 * because a series whose later terms are as long as its first one is noise
 * rather than a figure.
 *
 * The ORDER of the draws is the specification, not an implementation detail:
 * the same seed and arm count must name the same design in desktop GlyphViz, and
 * hoisting a draw out of the conditional that guards it repoints every existing
 * seed. Note the zero-jitter-style short-circuit at k = 0, which consumes
 * nothing at all, and that `phaseX` is drawn AFTER the 3-D block because Python
 * evaluates a constructor's keyword arguments in written order.
 */
export function randomDesign(
  rng: PythonRandom,
  nArms?: number | null,
  allow3d = true,
  name?: string,
): EpicycleDesign {
  const n = nArms || rng.randint(3, 5)
  let length = rng.uniform(10, 15)
  const arms: Arm[] = []
  for (let k = 0; k < n; k++) {
    const rate = rng.choice([1, -1, 2, -2, 3, -3, 4, -4, 5, -5])
    let tube = 0
    let rateY = 0
    let tilt = 0
    if (allow3d && k && rng.random() < 0.45) {
      if (rng.random() < 0.5) {
        tilt = rng.choice([-60, -45, -35, -25, 25, 35, 45, 60])
      } else {
        tube = length * rng.uniform(0.25, 0.7)
        rateY = rng.choice([2, 3, 4, 5, -3, -5])
      }
    }
    arms.push({
      length: pyRound(length, 3),
      rateX: rate,
      phaseX: rng.choice([0, 0, 0, 90, 180, 270]),
      rateY,
      phaseY: 0,
      tube: pyRound(tube, 3),
      tilt,
    })
    length *= rng.uniform(0.45, 0.75)
  }
  return defaultDesign({
    name: name ?? 'Epicycles',
    arms,
    penSize: pyRound(Math.max(0.5, length * 0.8), 3),
  })
}

/**
 * The next arm the "+1" on the arm count appends — the desktop's
 * `_on_arm_count`. Continuing the pattern rather than appending a default: a new
 * arm half the length of the last, spinning the other way, is the next TERM of a
 * series, where a length-10 arm on the end of a decaying chain would swamp
 * everything before it.
 */
export function continuedArm(last: Arm): Arm {
  return defaultArm({
    length: Math.max(0.05, last.length * 0.6),
    rateX: last.rateX ? -last.rateX : 1,
  })
}

// ------------------------------------------------------------------- helpers

/** `_slug` — a filename stem from a design name. */
export function slug(name: string): string {
  const kept = [...name.trim()]
    .map((c) => (/[\p{L}\p{N}]/u.test(c) || c === '-' || c === '_' ? c : '_'))
    .join('')
    .replace(/^_+|_+$/g, '')
  return (kept || 'epicycles').toLowerCase()
}

/**
 * Python's `round(value, ndigits)`. V8's `toFixed` is correctly rounded from the
 * double's exact value, as CPython's is, so the two agree everywhere except at
 * an exact decimal tie (where Python goes to even and this goes away from zero)
 * — which a value drawn from `uniform()` does not reach.
 */
export function pyRound(value: number, digits: number): number {
  return Number(value.toFixed(digits))
}

/**
 * Python's `f"{v:g}"` (with `:+g` when `sign` is set), for the node labels — the
 * tag text is part of what a parity dump compares, so "10" must not come out as
 * "10.000000".
 */
export function formatG(value: number, sign = false, precision = 6): string {
  if (!Number.isFinite(value)) return String(value)
  const lead = sign && value >= 0 ? '+' : ''
  if (value === 0) return `${lead}0`
  const [mantissa, expText] = value.toExponential(precision - 1).split('e')
  const exponent = Number(expText)
  if (exponent < -4 || exponent >= precision) {
    const abs = Math.abs(exponent)
    const expSign = exponent < 0 ? '-' : '+'
    return `${lead}${trimTrailingZeros(mantissa)}e${expSign}${abs < 10 ? `0${abs}` : abs}`
  }
  return lead + trimTrailingZeros(value.toFixed(Math.max(0, precision - 1 - exponent)))
}

function trimTrailingZeros(text: string): string {
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text
}

// ----------------------------------------------------------------------- FFT
//
// numpy's `fft` on the desktop; here, a general Cooley–Tukey with a naive base
// case for a prime length. No dependency, for the same reason the CSV
// tokenizer, the zip reader and the mesh parser have none — and every frame
// count this tool produces (360, 720, 1080, 3600…) is highly composite, so the
// recursion bottoms out fast. It is an exact DFT either way, so it agrees with
// numpy's to floating-point rounding.

function smallestFactor(n: number): number {
  for (let p = 2; p * p <= n; p++) if (n % p === 0) return p
  return n
}

function naiveDft(re: Float64Array, im: Float64Array): { re: Float64Array; im: Float64Array } {
  const n = re.length
  const outRe = new Float64Array(n)
  const outIm = new Float64Array(n)
  for (let k = 0; k < n; k++) {
    let sr = 0
    let si = 0
    for (let j = 0; j < n; j++) {
      const angle = (-2 * Math.PI * ((j * k) % n)) / n
      const c = Math.cos(angle)
      const s = Math.sin(angle)
      sr += re[j] * c - im[j] * s
      si += re[j] * s + im[j] * c
    }
    outRe[k] = sr
    outIm[k] = si
  }
  return { re: outRe, im: outIm }
}

function fft(re: Float64Array, im: Float64Array): { re: Float64Array; im: Float64Array } {
  const n = re.length
  if (n <= 1) return { re: Float64Array.from(re), im: Float64Array.from(im) }
  const p = smallestFactor(n)
  if (p === n) return naiveDft(re, im)
  const m = n / p

  // Split into p sub-sequences of stride p, transform each, then recombine:
  // X[k] = Σ_q W_n^{qk} · Y_q[k mod m].
  const subRe: Float64Array[] = []
  const subIm: Float64Array[] = []
  for (let q = 0; q < p; q++) {
    const sr = new Float64Array(m)
    const si = new Float64Array(m)
    for (let t = 0; t < m; t++) {
      sr[t] = re[q + p * t]
      si[t] = im[q + p * t]
    }
    const sub = fft(sr, si)
    subRe.push(sub.re)
    subIm.push(sub.im)
  }

  const outRe = new Float64Array(n)
  const outIm = new Float64Array(n)
  for (let k = 0; k < n; k++) {
    const km = k % m
    let sr = 0
    let si = 0
    for (let q = 0; q < p; q++) {
      const angle = (-2 * Math.PI * ((q * k) % n)) / n
      const c = Math.cos(angle)
      const s = Math.sin(angle)
      const yr = subRe[q][km]
      const yi = subIm[q][km]
      sr += yr * c - yi * s
      si += yr * s + yi * c
    }
    outRe[k] = sr
    outIm[k] = si
  }
  return { re: outRe, im: outIm }
}
