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

import { paletteIndexCount, resolvePaletteColor } from './colorPalette'
import { blankNode } from './createNode'
import type { PythonRandom } from './pythonRandom'
import type { GvNode, Vec3 } from './types'
import { Geometry, NodeType, Topo } from './types'

// ---------------------------------------------------------------- constants

export const MIN_ARMS = 2

/**
 * Terms in the series. The desktop stops at 8; this app goes to 32, because
 * MEASUREMENT says nothing is in the way — a 32-arm chain traces in 8 ms and
 * builds in 1 ms at the 360-frame default, and 80 ms in the worst case the
 * controls allow (3600 frames, 1440 beads). The node count barely moves either:
 * an arm costs two rows where the trail costs up to 1441, so 32 arms is 426
 * nodes against 8 arms' 378.
 *
 * The real ceiling is NYQUIST, not the machine — see `peakHarmonic` below. A
 * trail samples the pen once every `step` frames, so it cannot represent a
 * harmonic above `180 / step`, and a design that reaches past that draws a
 * smear rather than the figure it actually is. 32 is where this stops, because
 * a symmetric design filling 32 arms already spans harmonics ±180 at a fold of
 * 11, which is the whole of what a 360-frame trail can show.
 */
export const MAX_ARMS = 32

/**
 * Rate ceiling, degrees per frame, and it is the Nyquist bound rather than a
 * round number: the trail cannot sample faster than once a frame, so 180 is the
 * fastest angle whose motion a trail can still describe. Past it the beads land
 * on the curve and the polyline between them does not.
 */
export const RATE_LIMIT = 180

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
  /**
   * Colour the trail with a GlyphViz palette, swept once across the cycle —
   * null keeps the single amber the desktop uses.
   *
   * Web-only, and the reason it is worth having is that the trail is the one
   * part of this scene where position means TIME: the pen visits the beads in
   * order, so a gradient along them says where in the cycle each part of the
   * figure was drawn — which is exactly the thing a complex closed curve hides.
   * A design .json written here carries the extra key and one written by the
   * desktop simply has no opinion about it, which is the same contract the
   * Glyph Composer's templates already keep.
   */
  trailPalette: number | null
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
    trailPalette: null,
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
    trail_palette: design.trailPalette,
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
    // Absent (a desktop design, which has no such field) means the plain amber,
    // which is what the desktop draws — so a file from there opens unchanged.
    trailPalette:
      raw.trail_palette === null || raw.trail_palette === undefined
        ? null
        : num(raw.trail_palette, 0),
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

/**
 * The INVERSE of the harmonic ladder: the rates that produce a wanted harmonic
 * sequence. `h_k = h_{k-1} + (−1)^(k−1)·r_k` rearranges to
 * `r_k = (−1)^(k−1)·(h_k − h_{k−1})`, with `h_0 = 0`.
 *
 * This is what makes symmetry designable rather than something to stumble on.
 * A curve's symmetry is a property of its HARMONICS (see `symmetricHarmonics`),
 * and the harmonics are what an author wants to state — but the chain is driven
 * by rates, and the alternating sign makes the translation from one to the
 * other error-prone by hand. Checked against the square wave, whose rates the
 * desktop wrote out longhand: harmonics 1, 3, 5, 7 come back as 1, −2, +2, −2.
 */
export function ratesForHarmonics(harmonics: readonly number[]): number[] {
  const rates: number[] = []
  let previous = 0
  harmonics.forEach((h, index) => {
    rates.push((index % 2 === 0 ? 1 : -1) * (h - previous))
    previous = h
  })
  return rates
}

/**
 * Harmonics whose curve has `fold`-fold ROTATIONAL symmetry, `count` of them.
 *
 * THE RULE, and it is exact rather than a heuristic. The pen traces
 * `z(t) = Σ A_k · e^(i(h_k·t + p_k))`. Rotating the figure by `2π/m` and asking
 * it to land on itself means `z(t + 2π/m) = e^(iα)·z(t)` for some fixed α,
 * which needs `h_k · 2π/m ≡ α` for EVERY k — that is, every harmonic congruent
 * to the same value mod m. Taking that value to be 1 gives a figure that maps
 * onto itself under a turn of exactly `2π/m`.
 *
 * So the harmonics are an arithmetic progression of step `m` through 1:
 * `…, 1−2m, 1−m, 1, 1+m, 1+2m, …`. Note two things that FALL OUT of this and
 * are worth stating, because they are what make the feature usable:
 *
 * - The AMPLITUDES are free. Symmetry is a fact about the harmonics alone, so
 *   any amplitudes at all keep the figure `m`-fold symmetric. That is the whole
 *   decomposition symmetric Randomize rests on: the harmonics carry the
 *   symmetry, the amplitudes carry the character.
 * - The PHASES are free too, for rotational symmetry. Setting them all equal
 *   buys the extra MIRROR — `z(−t) = conj(z(t))` when every composed phase is
 *   the same — and rotation plus mirror is the dihedral symmetry of a rose
 *   window, which is the look worth aiming at.
 *
 * The window is centred on 1 so the progression runs both ways: a one-sided run
 * (1, 1+m, 1+2m, …) is also m-fold, but every term then winds the same way and
 * the figure comes out as a spiral rather than a rosette. Returned ASCENDING,
 * which is not cosmetic — consecutive harmonics then differ by exactly m, so
 * `ratesForHarmonics` gives a rate column of one carrier followed by a clean
 * alternating ±m, well inside RATE_LIMIT at any arm count this app allows.
 */
export function symmetricHarmonics(fold: number, count: number): number[] {
  const m = Math.max(2, Math.round(fold))
  const n = Math.max(1, Math.round(count))
  const below = Math.floor((n - 1) / 2)
  return Array.from({ length: n }, (_, i) => 1 + m * (i - below))
}

/**
 * The largest fold whose `count`-arm window still fits inside `limit`.
 *
 * A generator has to answer this, because a fold the arm count cannot carry is
 * not a prettier figure — it is an aliased one. The span is set by the top of
 * the window, `1 + m·ceil((n−1)/2)`.
 */
export function maxFoldForArms(count: number, limit: number = RATE_LIMIT): number {
  const above = Math.max(1, Math.ceil((Math.max(1, count) - 1) / 2))
  return Math.max(2, Math.floor((limit - 1) / above))
}

/**
 * The FIXED angle the construction gives arm k before any phase is authored,
 * in degrees: 0 on the odd arms and 90 on the even ones.
 *
 * MEASURED, not derived — a chain of unit arms with every `phase_x` at zero
 * puts arm 1 along +x, arm 2 along +y, arm 3 along +x again, and so on. It is
 * the residue of the `rotate = (90, 90, 0)` cancellation: the same 90° that
 * flips the frame's handedness at each level (and makes the harmonic magnitudes
 * ADD) also leaves half the levels a quarter turn out.
 *
 * This is what makes a design of all-zero phases NOT mirror-symmetric, which is
 * the trap `alignedPhases` exists to avoid — and it explains a detail of the
 * original ANTz scene the desktop ported from. Its phases (0, 90, 90, 90) were
 * recovered from a file saved mid-flight and have looked arbitrary ever since;
 * they are exactly `alignedPhases(4)`, the setting that points all four arms
 * the same way at t = 0. Jeff's scene was built on the mirror all along.
 */
function constructionOffset(index: number): number {
  return index % 2 === 1 ? 90 : 0
}

/**
 * The `phase_x` values that put every arm's composed angle at 0 — or at 180
 * where `flips[k]` is set, which contributes that term with its sign reversed
 * and costs no symmetry, −1 being real.
 *
 * A phase composes down the chain by the SAME alternating ladder an angle does
 * (it is the constant term of the same angle), so the wanted composed sequence
 * inverts through `ratesForHarmonics` exactly as a harmonic sequence does.
 */
export function alignedPhases(count: number, flips: readonly boolean[] = []): number[] {
  const wanted = Array.from(
    { length: Math.max(0, Math.round(count)) },
    (_, k) => (flips[k] ? 180 : 0) - constructionOffset(k),
  )
  return ratesForHarmonics(wanted).map((p) => ((p % 360) + 360) % 360)
}

export interface SymmetricArmOptions {
  fold: number
  count: number
  /** World radius of the LONGEST arm; the rest are scaled against it. */
  base?: number
  /**
   * How fast the amplitude falls away from its peak, in progression steps.
   * ~1 gives an open flower, ~1.5 a crisp one, past ~2 the far terms stop
   * contributing at all.
   */
  decay?: number
  /**
   * WHERE the amplitude peaks, counted in progression steps out from the
   * fundamental — and the one knob that decides whether the figure is a star or
   * a piece of lace.
   *
   * At 0 the biggest term is the fundamental (harmonic 1): the pen goes round
   * ONCE per cycle and everything else decorates that single loop, so the
   * figure is an m-pointed star however many terms are piled on. Measured, and
   * the reason the first attempt at these presets came out as circles with
   * spikes.
   *
   * At w > 0 the biggest term is harmonic `1 + w·fold`, so the pen winds that
   * many times before the cycle closes and the passes interleave — which is
   * where the density comes from. The fundamental is kept in the mix as a
   * second peak, and it is that pairing that reads as a rose window: a bold
   * outer ring of petals from the fundamental, a fine woven annulus from the
   * high one.
   */
  weave?: number
  /** Per-arm amplitude multipliers, if the caller has its own (Randomize does). */
  weights?: readonly number[]
  /** Tube radius as a FRACTION of each arm's length, 0 = flat. */
  tubeFraction?: number
  /**
   * Tube rate. Rounded to a multiple of `fold` — a tube at harmonic h with rate
   * r contributes h, h−r and h+r in the plane and pure out-of-plane motion at
   * r, so the sidebands stay in the progression (and the z motion stays
   * invariant under the turn) only when r is itself a multiple of the fold.
   * A tube off that lattice is the one way to have a symmetric plan and an
   * unsymmetric solid.
   */
  tubeRate?: number
  /** Terms to contribute with their sign reversed — see `alignedPhases`. */
  flips?: readonly boolean[]
}

/**
 * A whole arm set laid out as a `fold`-fold rosette, with the phases ALIGNED so
 * the figure carries the mirror as well as the rotation.
 */
export function symmetricArms(options: SymmetricArmOptions): Arm[] {
  const { fold, count } = options
  const base = options.base ?? 12
  const decay = options.decay ?? 1
  const weave = Math.max(0, Math.round(options.weave ?? 0))
  const tubeFraction = options.tubeFraction ?? 0
  const harmonics = symmetricHarmonics(fold, count)
  const rates = ratesForHarmonics(harmonics)
  const m = Math.max(2, Math.round(fold))
  const below = Math.floor((Math.max(1, Math.round(count)) - 1) / 2)

  // Amplitude is a function of the PROGRESSION index, not of the harmonic
  // itself. Against |h| the fundamental takes almost the whole amplitude —
  // 1/|h| makes term two a twelfth of term one at fold 12 — so the figure is a
  // circle with spikes whatever else is added. Against |j| each successive
  // ring of petals is a comparable fraction of the last, which is what lets
  // thirty-two terms all show.
  const shape = (j: number) =>
    1 / Math.pow(1 + Math.abs(j), decay) +
    (weave > 0 ? 1 / Math.pow(1 + Math.abs(j - weave), decay) : 0)
  const raw = harmonics.map((_h, k) => shape(k - below))
  const peak = Math.max(...raw, 1e-9)
  // A tube whose rate is not a multiple of the fold breaks the very symmetry
  // this function exists to build, so it is snapped onto the lattice.
  const tubeRate = options.tubeRate
    ? Math.max(m, Math.round(options.tubeRate / m) * m)
    : 0
  const phases = alignedPhases(harmonics.length, options.flips)
  return harmonics.map((_h, k) => {
    const weight = options.weights?.[k] ?? 1
    // Normalised on the peak, so `base` means "the longest arm" and a design's
    // overall size does not swing with the decay or the weave.
    const length = pyRound((base * weight * raw[k]) / peak, 4)
    return defaultArm({
      length: Math.max(0.01, length),
      rateX: rates[k],
      phaseX: phases[k],
      tube: tubeFraction > 0 ? pyRound(length * tubeFraction, 4) : 0,
      rateY: tubeFraction > 0 ? tubeRate : 0,
    })
  })
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
  const palette = design.trailPalette
  // The last bead is one sampling step short of closing the loop, so the sweep
  // runs over `points.length` rather than `length − 1`: dividing by the last
  // INDEX would put the palette's end on a bead that is not the cycle's end,
  // and on a gradient that wraps (Rainbow returns to red) it is what makes the
  // colour close exactly as the curve does.
  const span = Math.max(1, points.length)
  const indexCount = palette === null ? 0 : paletteIndexCount(palette)
  points.forEach((p, i) => {
    const channel = design.selfDrawing
      ? 1 + design.arms.length + Math.floor(i / Math.max(1, design.beadGroup))
      : 0
    let color = { r, g, b, a: design.selfDrawing ? 0 : a }
    let colorIndex = 0
    if (palette !== null) {
      colorIndex = Math.min(indexCount - 1, Math.floor((i / span) * indexCount))
      const resolved = resolvePaletteColor(palette, colorIndex)
      color = { ...resolved, a: design.selfDrawing ? 0 : a }
    }
    const bead = epicycleNode(startId + 1 + i, {
      parentId: startId,
      branchLevel: baseBranch + 1,
      topo: Topo.None,
      geometry: Geometry.Point,
      ratio: TRAIL_BEAD_RATIO,
      translate: vec3(p.x, p.y, p.z),
      scale: vec3(0.2, 0.2, 0.2),
      color,
      // The literal colour is what renders (that IS the palette model — see
      // colorPalette.ts), but writing the pair as well means the trail arrives
      // as ordinary palette-authored nodes: the Properties panel's palette rows
      // and the = / − keys understand it, and it survives to the CSV.
      paletteId: palette ?? 0,
      colorIndex: palette === null ? 0 : colorIndex,
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
  /** Fastest harmonic the design contains, tube sidebands included. */
  peakHarmonic: number
  /** Fastest harmonic this trail's bead spacing can represent. */
  nyquist: number
  /** True when the trail is too coarse to draw the curve it is sampling. */
  aliased: boolean
  /**
   * The rotational symmetry the harmonics actually carry — 1 for none. Measured
   * off the design rather than remembered from how it was built, so a hand-typed
   * design reports its symmetry too.
   */
  fold: number
}

/**
 * The rotational symmetry a set of harmonics carries: the largest m for which
 * every harmonic is congruent to the same value mod m, with that value coprime
 * to m (otherwise the figure repeats at a coarser turn than m suggests).
 *
 * `gcd` of the differences gives the modulus directly — every harmonic is
 * congruent mod m exactly when m divides every gap between them.
 */
export function symmetryFold(harmonics: readonly number[]): number {
  const whole = harmonics.map((h) => Math.round(h))
  if (whole.some((h, i) => Math.abs(h - harmonics[i]) > 1e-9)) return 1
  let g = 0
  for (const h of whole) g = gcd(g, Math.abs(h - whole[0]))
  if (g === 0) g = Math.abs(whole[0]) // one distinct harmonic: a plain circle
  if (g <= 1) return 1
  // The turn is 2π·c/m for c = h mod m, so the figure only closes onto itself
  // after m/gcd(c, m) of them.
  const c = ((whole[0] % g) + g) % g
  return c === 0 ? g : g / gcd(c, g)
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y) {
    const t = x % y
    x = y
    y = t
  }
  return x
}

/**
 * The weave a design carries, measured: how far out its LONGEST arm sits, in
 * progression steps from the fundamental.
 *
 * Reported rather than remembered, for the same reason `symmetryFold` is — the
 * control has to describe the design in hand, not the last thing typed into it.
 * A woven profile peaks twice, at the fundamental and at the weave, and those
 * two are equal by construction; the LARGER index is the answer, since a peak at
 * the fundamental alone is what weave 0 means.
 */
export function weaveOf(design: EpicycleDesign): number {
  const count = design.arms.length
  if (count === 0) return 0
  const below = Math.floor((count - 1) / 2)
  const longest = Math.max(...design.arms.map((a) => a.length))
  let weave = 0
  design.arms.forEach((arm, k) => {
    if (arm.length >= longest * 0.999) weave = Math.max(weave, k - below)
  })
  return weave
}

/**
 * The fastest angle anywhere in the design. An arm's own harmonic, plus — where
 * it wears a tube — the two sidebands it generates and the out-of-plane motion
 * at the tube rate itself.
 */
export function peakHarmonic(design: EpicycleDesign): number {
  const harmonics = harmonicsOf(design.arms.map((a) => a.rateX))
  let peak = 0
  design.arms.forEach((arm, k) => {
    peak = Math.max(peak, Math.abs(harmonics[k]))
    if (arm.tube > 0) {
      peak = Math.max(
        peak,
        Math.abs(arm.rateY),
        Math.abs(harmonics[k] - arm.rateY),
        Math.abs(harmonics[k] + arm.rateY),
      )
    }
  })
  return peak
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
  const harmonics = harmonicsOf(design.arms.map((a) => a.rateX))
  const peak = peakHarmonic(design)
  // A bead every `step` frames samples an angle once per `step` degrees of
  // frame time, so RATE_LIMIT/step is the fastest harmonic it can describe.
  const [step] = trailSampling(design, frames)
  const nyquist = RATE_LIMIT / step
  return {
    arms: design.arms.length,
    frames,
    closes: closureFrames(design),
    harmonics,
    spectrum: spectrum(path),
    halfSpan: maxAbs,
    zExtent,
    planar: zExtent < 1e-6,
    peakHarmonic: peak,
    nyquist,
    aliased: design.trail && peak > nyquist,
    fold: symmetryFold(harmonics),
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

/**
 * The presets. The first eight are the desktop's, in its combo's own order and
 * with its own values — they are what the parity harness diffs, so nothing here
 * may reorder or retune them. The rest are web-only, and exist because raising
 * the arm count to 32 is no use without something already built at that size to
 * look at: each is a symmetric design that a hand cannot reasonably type.
 */
export const PRESET_NAMES = [
  "Jeff's ANTz original",
  'Cardioid (2 terms)',
  'Spirograph (hypotrochoid)',
  'Square wave (odd harmonics)',
  'Torus knot (tube)',
  'Inclined orrery (tilt)',
  'Rose in space',
  'Deep chain (6 arms)',
  'Rosette ×5 (8 arms)',
  'Snowflake ×6 (12 arms)',
  'Star ×12 (16 arms)',
  'Mandala ×7 (24 arms)',
  'Rose window ×12 (28 arms)',
  'Great weave ×11 (32 arms)',
  'Spun rosette ×6 (16 arms, 3-D)',
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

  // --- web-only, and every one of them built by symmetricArms -------------
  // Tuned by RENDERING them, not by reasoning: the first set used an amplitude
  // law in |h| and came out as circles with spikes, which is what led to the
  // `weave` parameter above. Trail palettes are chosen so the sweep reads as
  // one pass round the cycle rather than as decoration; Rainbow closes back on
  // its own first colour, so a closed curve comes out with no seam.
  //
  // They run simple to complex on purpose — the point of the last three is
  // that a hand cannot type them.
  'Rosette ×5 (8 arms)': defaultDesign({
    name: 'Rosette_5',
    arms: symmetricArms({ fold: 5, count: 8, base: 13, decay: 1 }),
    penSize: 0.7,
    trailPalette: 2, // Rainbow Heatmap
  }),
  'Snowflake ×6 (12 arms)': defaultDesign({
    name: 'Snowflake_6',
    arms: symmetricArms({ fold: 6, count: 12, base: 13, decay: 1.1 }),
    penSize: 0.6,
    trailPalette: 22, // White → Blue
    trailPoints: 1080,
  }),
  'Star ×12 (16 arms)': defaultDesign({
    name: 'Star_12',
    arms: symmetricArms({ fold: 12, count: 16, base: 14, decay: 1.2 }),
    penSize: 0.5,
    trailPalette: 10, // Purple → Yellow
    trailPoints: 1440,
  }),
  // The three that need the weave. Their peak term is harmonic 1 + w·fold, so
  // the pen winds that many times and the passes interleave.
  'Mandala ×7 (24 arms)': defaultDesign({
    name: 'Mandala_7',
    arms: symmetricArms({ fold: 7, count: 24, base: 14, decay: 1.5, weave: 6 }),
    penSize: 0.35,
    showArms: false,
    trailPalette: 8, // Blue → Red
    trailPoints: 1440,
  }),
  // 28 arms and not 32: at fold 12 the window's own top term reaches harmonic
  // 193 by 32 arms, past what a 360-frame trail can draw. The test says so.
  'Rose window ×12 (28 arms)': defaultDesign({
    name: 'Rose_Window_12',
    arms: symmetricArms({ fold: 12, count: 28, base: 14, decay: 1.5, weave: 3 }),
    penSize: 0.3,
    showArms: false,
    trailPalette: 2, // Rainbow Heatmap
    trailPoints: 1440,
  }),
  // The one that spends the whole budget: 32 arms at the largest fold they can
  // carry (maxFoldForArms(32) === 11).
  'Great weave ×11 (32 arms)': defaultDesign({
    name: 'Great_Weave_11',
    arms: symmetricArms({ fold: 11, count: 32, base: 14, decay: 1.2, weave: 4 }),
    penSize: 0.3,
    showArms: false,
    trailPalette: 6, // Green → Red, which reads as a sweep where Blue → Green does not
    trailPoints: 1440,
  }),
  // The 3-D one: a tube rate of 6 is a multiple of the fold, so the solid keeps
  // the plan's symmetry instead of merely looking like it might.
  'Spun rosette ×6 (16 arms, 3-D)': defaultDesign({
    name: 'Spun_Rosette_6',
    arms: symmetricArms({
      fold: 6,
      count: 16,
      base: 14,
      decay: 1.2,
      tubeFraction: 0.45,
      tubeRate: 6,
    }),
    penSize: 0.5,
    trailPalette: 16, // Black → Blue
    trailPoints: 1440,
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

export interface SymmetricRandomOptions {
  /** Rotational order to build. Clamped to what the arm count can carry. */
  fold: number
  count: number
  /** Let the design leave the plane, on the fold's own tube lattice. */
  allow3d?: boolean
  name?: string
}

/**
 * A RANDOM design that is still exactly `fold`-fold symmetric.
 *
 * The desktop's `randomDesign` (kept beside this, untouched and still
 * seed-for-seed identical to that app's) rolls every rate independently, which
 * is why its output reads as a wormy tangle: with the harmonics unconstrained
 * there is no symmetry to find, and a curve with no symmetry is a scribble
 * however carefully its amplitudes decay.
 *
 * What makes this one work is the decomposition `symmetricHarmonics` documents:
 * THE HARMONICS CARRY THE SYMMETRY AND THE AMPLITUDES CARRY THE CHARACTER. So
 * the harmonics are not rolled at all — they are the arithmetic progression the
 * fold demands — and everything else is free to be random:
 *
 * - AMPLITUDES. A decaying power law times a per-arm multiplier. Symmetry does
 *   not depend on them at all, so this is where the variety lives: the
 *   amplitude profile is what shapes the petals.
 * - PHASE, restricted to 0 or 180. A term at 180 contributes with its sign
 *   flipped, which changes the figure completely — and because −1 is REAL, the
 *   mirror survives (`z(−t) = conj(z(t))` still holds), so the result keeps the
 *   full dihedral symmetry of a rose window rather than only the rotation.
 *   Note the phases go through `ratesForHarmonics` too: a phase composes down
 *   the chain by the same alternating ladder an angle does, being the constant
 *   term of the same angle.
 * - THE TUBE, when 3-D is allowed, at a rate on the fold's own lattice so the
 *   sidebands stay in the progression and the solid keeps the plan's symmetry.
 *
 * Not seeded against anything on the desktop — there is nothing there to match,
 * this generator being web-only. The same seed and settings still name the same
 * design here, which is what the Seed field promises.
 */
export function randomSymmetricDesign(
  rng: PythonRandom,
  options: SymmetricRandomOptions,
): EpicycleDesign {
  const count = Math.max(MIN_ARMS, Math.min(MAX_ARMS, Math.round(options.count)))
  // A fold the arm count cannot carry is not a finer figure, it is an aliased
  // one — so it is clamped here rather than left to spoil the result.
  const fold = Math.max(2, Math.min(Math.round(options.fold), maxFoldForArms(count)))

  const base = rng.uniform(11, 15)
  const decay = rng.uniform(0.9, 1.7)
  // The weave is the biggest character lever there is — a roll at 0 is a star
  // and a roll at 5 is a piece of lace — so a third of rolls stay plain and the
  // rest interleave. Bounded by the window's own half-width, since a peak
  // outside the progression is just a lopsided star.
  const maxWeave = Math.max(0, Math.ceil((count - 1) / 2) - 1)
  const weave = rng.random() < 0.34 ? 0 : rng.randint(1, Math.max(1, Math.min(7, maxWeave)))

  const flips: boolean[] = []
  const weights: number[] = []
  for (let k = 0; k < count; k++) {
    // A modest multiplier on the profile: enough to break the perfect fall-off
    // into something with its own character, not enough to make it noise.
    weights.push(rng.uniform(0.65, 1.4))
    flips.push(rng.random() < 0.35)
  }

  const arms = symmetricArms({ fold, count, base, decay, weave, weights, flips })

  // One tube for the whole design rather than one per arm: several independent
  // sidebands stack into haze, where a single one reads as the figure lifting
  // off the plane and turning.
  const wantsTube = (options.allow3d ?? true) && rng.random() < 0.5
  const tubeArm = wantsTube ? rng.randint(0, count - 1) : -1
  const tubeRate = wantsTube ? fold * rng.choice([1, 1, 2]) : 0
  const tubeFraction = wantsTube ? rng.uniform(0.3, 0.7) : 0
  if (wantsTube) {
    // A tube puts sidebands at h ± rate, so its rate spends the headroom the
    // harmonics have LEFT — a full window at the largest fold the arm count can
    // carry already reaches the ceiling, and adding a tube on top of it would
    // take the design past what the trail can draw. The rate steps down the
    // lattice to whatever fits, and the tube is dropped when nothing does.
    const spread = Math.max(...harmonicsOf(arms.map((a) => a.rateX)).map(Math.abs))
    const headroom = Math.max(0, RATE_LIMIT - spread)
    const fitted = Math.floor(Math.min(tubeRate, headroom) / fold) * fold
    if (fitted >= fold) {
      arms[tubeArm].tube = pyRound(arms[tubeArm].length * tubeFraction, 4)
      arms[tubeArm].rateY = fitted
    }
  }

  const smallest = Math.min(...arms.map((a) => a.length))
  return defaultDesign({
    name: options.name ?? `Rosette_${fold}`,
    arms,
    penSize: pyRound(Math.max(0.25, smallest * 0.7), 3),
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
