// Camera smoothing — the optional ANTz-style "inertia" on camera navigation.
// A port of desktop `glyphviz_core/camera_smoothing.py` plus the goal-state
// block `viewport.py` wraps around it (81f28e1).
//
// Pure state + math, with no THREE and no DOM in it, so the behaviour suite
// runs in plain node (the cameraMode.ts / FrameSampler rule); main.ts owns the
// THREE camera, and render/smoothOrbitControls.ts owns the OrbitControls
// handoff.
//
//
// What ANTz did, and what it got wrong
// ------------------------------------
//
// ANTz smoothed its camera in two independent places, and only one of them is
// the effect users remember fondly:
//
//   1. A 10-cycle boxcar average of the raw mouse deltas (`npUpdateMouse`,
//      npmouse.c). Every camera mode got it. This is the part that buffered a
//      user's hand tremor — the accessibility win Dr. Warner reported.
//
//   2. A first-order low-pass on the camera's *world position* while
//      "targeting" (`npCameraTranslate`, npengine.c), engaged by the
//      Left+Right combo drag:
//
//          cam->translate = f*ideal + (1-f)*cam->translate,  f = 0.05 * 65/(fps+5)
//
//      but the orbit *angle* and the *zoom distance* were applied instantly,
//      the same frame. So the eye crawled toward a solution the aim had
//      already left, and the object being orbited genuinely swung out of frame
//      for a second or two before easing back. That artifact — not the
//      smoothing itself — is what made the feature divisive, and ANTz never
//      offered a way to turn it off.
//
// GlyphViz keeps the glide and drops the artifact by easing the camera rig
// COHERENTLY: azimuth, elevation, distance and target all run through the same
// filter with the same time constant, so the aim and the eye never disagree
// and the framing stays put. The gesture writes a GOAL; the rendered camera is
// the ACTUAL, chasing it. With tau = 0 the actual is assigned the goal
// outright, so smoothing off is bit-identical to no smoothing at all.
//
// The filter is also frame-rate correct — `alphaFor` solves the exponential
// properly instead of ANTz's `65/(fps+5)` fudge, so the same setting feels the
// same at 30 fps and at 144. (ANTz's smoothing being much heavier in its
// early, slower years is exactly that fudge failing.)
//
// Note this is a LAG filter, not momentum: releasing the mouse stops the goal,
// and the actual coasts to rest against it. Nothing ever overshoots or keeps
// spinning.
//
//
// Two web-side differences from the desktop, both structural
// ----------------------------------------------------------
//
//   * The desktop stores the actual rig as four `_cam_*` fields it owns. Here
//     the actual IS `camera.position` + `controls.target`, because
//     OrbitControls owns them — so the actual is decomposed per call
//     (`rigFromView`) rather than kept, and only the GOAL lives in here. That
//     is the same architecture read the other way round: every reader of the
//     live camera (matrices, picking, distance-scaled speeds, the stereo rig)
//     stays untouched.
//   * `isSettled` releases the desktop's continuous-repaint timer. This app's
//     animation loop always runs, so there is no timer to release — but the
//     tolerance still earns its place twice over: it is what LANDS a glide
//     exactly on its goal instead of leaving a permanent sub-pixel residual,
//     and it is what lets `adopt` recognise that nothing is gliding and a
//     direct camera write should be taken at face value. The desktop's own
//     numbers are kept so a glide ends at the same moment in both apps.

import type { OrbitRig, Vec3 } from './cameraMode'

// --- Smoothing amount --------------------------------------------------------
//
// The setting is a time constant in seconds: the time to close ~63% of the
// remaining gap. Exposed to the user as a slider from TAU_OFF to TAU_MAX.

export const TAU_OFF = 0.0 // no smoothing: the rendered camera IS the gesture (default)
export const TAU_ANTZ = 0.33 // ANTz's own feel: its f = 0.05/frame at 60 fps is tau ≈ 0.33 s
export const TAU_MAX = 0.6 // slider ceiling — beyond this the camera feels disconnected

// --- Which gestures the filter applies to ------------------------------------
//
// ANTz's positional lag engaged only on the Left+Right combo drag, so that is
// the faithful default. SCOPE_ALL widens it to every orbit-rig gesture
// (single-button orbit, wheel zoom, pan), which is what a user relying on the
// tremor-buffering actually needs — they are not only using the combo gesture.
// Camera Mode (free flight) is excluded under both: it is already integrated
// per tick from a held cursor offset, so it has no per-event jitter to filter.

export const SCOPE_COMBO = 'combo'
export const SCOPE_ALL = 'all'
export const SCOPES = [SCOPE_COMBO, SCOPE_ALL] as const
export type SmoothingScope = (typeof SCOPES)[number]

/**
 * Blend fraction for one step of `dt` seconds at time constant `tau`.
 *
 * `1 - exp(-dt/tau)` is the exact solution of the exponential decay, which is
 * what makes the result frame-rate independent: two 8 ms steps close exactly
 * as much of the gap as one 16 ms step. A per-frame constant (ANTz's `f`) does
 * not have that property, and drifts with frame rate.
 *
 * Returns 1 (snap outright) for tau ≤ 0, so smoothing-off costs nothing and
 * introduces no floating-point drift.
 */
export function alphaFor(dt: number, tau: number): number {
  if (tau <= 0 || dt <= 0) return 1
  return 1 - Math.exp(-dt / tau)
}

/** One filter step on a plain scalar. */
export function easeScalar(actual: number, goal: number, alpha: number): number {
  if (alpha >= 1) return goal
  return actual + (goal - actual) * alpha
}

/**
 * One filter step on an angle in degrees, along the SHORTEST arc.
 *
 * Azimuth wraps, so a naive lerp from 350 to 10 would take the camera the long
 * way round — a full 340° spin for a 20° drag. The residual is folded into
 * (−180, 180] first. The result is not re-wrapped: the caller's azimuth is
 * free-running.
 */
export function easeAngle(actual: number, goal: number, alpha: number): number {
  if (alpha >= 1) return goal
  const delta = (((goal - actual + 180) % 360) + 360) % 360 - 180
  return actual + delta * alpha
}

/**
 * One filter step on a distance, eased GEOMETRICALLY.
 *
 * Zoom is multiplicative — the gesture scales the arm length by a factor per
 * pixel — so a linear ease reads as a rush at the far end and a crawl at the
 * near end. Filtering in log space makes the glide perceptually even, and
 * keeps the value strictly positive so the arm can never cross zero.
 *
 * Non-positive inputs fall back to the linear ease rather than throwing: the
 * rig clamps distance to ≥ 1, but a caller with a degenerate rig should get a
 * sane camera rather than an exception mid-frame.
 */
export function easeLog(actual: number, goal: number, alpha: number): number {
  if (alpha >= 1) return goal
  if (actual <= 0 || goal <= 0) return easeScalar(actual, goal, alpha)
  return Math.exp(easeScalar(Math.log(actual), Math.log(goal), alpha))
}

/** One filter step on an XYZ point (the orbit pivot). Returns a new triple. */
export function easePoint(actual: Vec3, goal: Vec3, alpha: number): Vec3 {
  if (alpha >= 1) return [goal[0], goal[1], goal[2]]
  return [
    actual[0] + (goal[0] - actual[0]) * alpha,
    actual[1] + (goal[1] - actual[1]) * alpha,
    actual[2] + (goal[2] - actual[2]) * alpha,
  ]
}

/** Sub-pixel settle tolerances — see `isSettled`. */
export const SETTLE_ANGLE_TOL = 0.05 // degrees
export const SETTLE_DIST_FRAC = 1e-3 // of the arm length

/**
 * True when every rig quantity is close enough to its goal to call the glide
 * over.
 *
 * An exponential never *reaches* its goal, so without a tolerance a glide
 * would never end — and because the tail is long, a tolerance that is merely
 * small still leaves the camera creeping for seconds. Both defaults are
 * therefore set at roughly one screen pixel, which is where further easing
 * stops being visible at all:
 *
 *   * A ~1000px viewport at a ~60° field of view is ~0.06°/px, so 0.05° of
 *     residual rotation is under a pixel of movement.
 *   * The distance and target tolerances are relative to the arm length (0.1%
 *     of it), because an 0.05-unit residual is invisible on a 500-unit rig and
 *     glaring on a 2-unit one.
 *
 * (On the desktop this is also what releases the continuous-repaint timer,
 * which is why the numbers are tuned rather than merely small; the tolerance
 * is not to be tightened away.)
 */
export function isSettled(
  actual: OrbitRig,
  goal: OrbitRig,
  angleTol = SETTLE_ANGLE_TOL,
  distFrac = SETTLE_DIST_FRAC,
): boolean {
  if (Math.abs((((goal.azimuth - actual.azimuth + 180) % 360) + 360) % 360 - 180) > angleTol) {
    return false
  }
  if (Math.abs(goal.elevation - actual.elevation) > angleTol) return false
  const scale = Math.max(Math.abs(actual.distance), Math.abs(goal.distance), 1)
  if (Math.abs(goal.distance - actual.distance) > scale * distFrac) return false
  const tol = scale * distFrac
  for (let i = 0; i < 3; i++) {
    if (Math.abs(goal.target[i] - actual.target[i]) > tol) return false
  }
  return true
}

/** Exact equality, which is what "there is nothing left to write" means: a
 *  settled glide has already been landed on its goal, and an idle camera must
 *  not be rewritten from its own decomposition every frame. */
export function rigEquals(a: OrbitRig, b: OrbitRig): boolean {
  return (
    a.azimuth === b.azimuth &&
    a.elevation === b.elevation &&
    a.distance === b.distance &&
    a.target[0] === b.target[0] &&
    a.target[1] === b.target[1] &&
    a.target[2] === b.target[2]
  )
}

/** A rig copy — the goal and the actual must never alias, or the goal would
 *  follow the actual and there would be no glide at all. */
export function copyRig(rig: OrbitRig): OrbitRig {
  return {
    azimuth: rig.azimuth,
    elevation: rig.elevation,
    distance: rig.distance,
    target: [rig.target[0], rig.target[1], rig.target[2]],
  }
}

/**
 * The goal the rendered camera chases, plus the settings that decide whether
 * it chases at all. A port of the `_cam_goal_*` block of desktop `viewport.py`:
 * the method names are its own, minus the leading underscore.
 *
 * The contract for callers (main.ts):
 *
 *   * A navigation gesture calls `adopt(actual)`, mutates `goal`, then calls
 *     `covers(combo)` — false means it must write the goal onto the camera NOW
 *     (the desktop's `_settle_camera` → `_finish_camera_glide`), which is what
 *     makes tau = 0 behave exactly as the code did before this existed, and is
 *     also what lets an unsmoothed gesture halt a glide already in progress.
 *   * Every PROGRAMMATIC camera move (presets, framing, focus, follow,
 *     restore, flight) writes the camera as it always did and then calls
 *     `snap(actual)`. Jumps stay jumps; only drags glide.
 */
export class CameraSmoothing {
  tau = TAU_OFF
  scope: SmoothingScope = SCOPE_COMBO
  goal: OrbitRig = { azimuth: 0, elevation: 0, distance: 1, target: [0, 0, 0] }

  /** Whether the glide applies to the gesture now being applied.
   *
   *  Camera Mode is excluded outright: rate flight already integrates a held
   *  cursor offset once per tick, so it has no per-event jitter to filter, and
   *  its gestures re-derive the rig from the CURRENT eye — a lagging eye would
   *  feed back into the next frame's derivation and curve the flight path. */
  covers(combo: boolean, flyMode = false): boolean {
    if (this.tau <= 0 || flyMode) return false
    return combo || this.scope === SCOPE_ALL
  }

  /** True when the rendered camera has caught up with its goal (or there is no
   *  smoothing at all). */
  settled(actual: OrbitRig): boolean {
    if (this.tau <= 0) return true
    return isSettled(actual, this.goal)
  }

  /** Point the goal at wherever the rendered camera now is (desktop
   *  `_snap_camera_goal`). Called after any direct write to the camera, so the
   *  filter has nothing left to chase — without it, a camera preset or a focus
   *  jump would be dragged straight back toward the pre-jump goal. */
  snap(actual: OrbitRig) {
    this.goal = copyRig(actual)
  }

  /** Let a direct write to the camera take effect, if nothing is gliding
   *  (desktop `_adopt_direct_camera_writes`).
   *
   *  Plenty of code outside the navigation path just moves the camera and
   *  expects it to be there. Settled (which INCLUDES smoothing being switched
   *  off) means the goal has nothing left to chase, so in that state the
   *  actual is the truth and the goal should adopt it. Mid-glide the goal is
   *  where the user aimed and must not be clobbered by the lagging actual. */
  adopt(actual: OrbitRig) {
    if (this.settled(actual)) this.snap(actual)
  }

  /**
   * Advance the rendered camera one filter step toward its goal — called once
   * per animation frame, after every source that could have moved the goal and
   * before the view matrices are built. Returns the rig to render, or null
   * when there is nothing to do.
   *
   * All four rig quantities move together under one time constant; that
   * coherence is the whole design. ANTz smoothed only the eye's POSITION while
   * the orbit angle and zoom jumped the same frame, so the object being
   * orbited swung out of frame and crawled back. Easing aim and eye as one
   * keeps the framing put while still gliding.
   *
   * dt is clamped because the loop's delta can be a whole second after the tab
   * has been backgrounded — one such step would blow alpha to 1 and snap the
   * glide away on the first frame of a drag.
   */
  step(actual: OrbitRig, dtMs: number): OrbitRig | null {
    if (this.tau <= 0) return null
    if (this.settled(actual)) {
      // Land exactly on the goal rather than leaving a sub-tolerance residual
      // that keeps the rig a hair off the viewpoint the user aimed at — and
      // then stop, so an idle camera is never rewritten from its own
      // decomposition frame after frame.
      return rigEquals(actual, this.goal) ? null : copyRig(this.goal)
    }
    const dt = Math.min(Math.max(dtMs, 0), 100) / 1000
    const alpha = alphaFor(dt, this.tau)
    const next: OrbitRig = {
      azimuth: easeAngle(actual.azimuth, this.goal.azimuth, alpha),
      elevation: easeScalar(actual.elevation, this.goal.elevation, alpha),
      distance: easeLog(actual.distance, this.goal.distance, alpha),
      target: easePoint(actual.target, this.goal.target, alpha),
    }
    return isSettled(next, this.goal) ? copyRig(this.goal) : next
  }
}
