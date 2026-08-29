// Comfort options for immersive mode: snap turn, and the tunnelling vignette.
// Pure — no THREE and no DOM, so it runs in plain node like xrNav.ts and
// xrFocus.ts beside it.
//
// WHY (Jeff, 2026-08-29, item 2 of the VR priority list). Immersive mode has
// been driven by one person who does not get sick in it, which is exactly why
// this has not bitten yet. Smooth stick turning is the single largest cause of
// VR nausea for most people, and the day the headset goes to Steve — or to one
// of the patients in Dr. Warner's cohort, who are already part of why camera
// smoothing exists (roadmap 6y) — it stops being theoretical.
//
// Both measures work on the same principle, and it is worth stating because it
// explains their shape: sickness comes from the eyes reporting motion the inner
// ear does not. So either remove the visual motion (SNAP TURN replaces a
// continuous sweep with an instantaneous step — there is no optical flow to
// conflict with) or remove the part of the retina that reports it most
// insistently (the VIGNETTE narrows the field of view while you move; peripheral
// vision is what drives the vection response, and the centre is what you are
// actually looking at).
//
// Neither is on the CSV's business. They are viewer settings like Show Grid and
// the Global Scale, and they survive a scene load.

import { MOVE_SPEED_MPS, TURN_SPEED_RAD } from './xrNav'

export type TurnMode = 'smooth' | 'snap'
export type VignetteLevel = 'off' | 'light' | 'medium' | 'strong'

export interface ComfortSettings {
  turn: TurnMode
  /** Degrees per snap. Ignored while `turn` is 'smooth'. */
  snapDegrees: number
  vignette: VignetteLevel
}

export const TURN_MODES: readonly TurnMode[] = ['smooth', 'snap']
export const TURN_MODE_LABELS: Record<TurnMode, string> = {
  smooth: 'Smooth',
  snap: 'Snap',
}

/**
 * Snap sizes. 30° is the usual comfortable default — small enough that each
 * step is easy to re-orient after, large enough that a half-turn is six flicks
 * rather than twelve. 60° is there for anyone who would rather trade some
 * comfort for getting round quickly.
 */
export const SNAP_ANGLES: readonly number[] = [15, 30, 45, 60]
export const DEFAULT_SNAP_DEGREES = 30

export const VIGNETTE_LEVELS: readonly VignetteLevel[] = ['off', 'light', 'medium', 'strong']
export const VIGNETTE_LABELS: Record<VignetteLevel, string> = {
  off: 'Off',
  light: 'Light',
  medium: 'Medium',
  strong: 'Strong',
}

/**
 * Defaults: the behaviour that already exists, plus a light tunnel.
 *
 * Turn stays SMOOTH because Jeff has flown every scene in this app that way and
 * confirmed it feels good, and snap is a large change in feel to impose on
 * someone it suits; it is one press away on either surface. The vignette
 * defaults to LIGHT because it is the half that protects a newcomer without
 * being noticeable to a veteran — it appears only while you are actually
 * moving, and only outside 45° of the gaze, which is past where anybody is
 * looking. A comfort option nobody finds protects nobody.
 */
export function defaultComfort(): ComfortSettings {
  return { turn: 'smooth', snapDegrees: DEFAULT_SNAP_DEGREES, vignette: 'light' }
}

// --- Snap turn ----------------------------------------------------------------

/**
 * Stick deflection that fires a snap, and the one it has to fall back under
 * before the next can fire.
 *
 * Well past the flight dead zone (0.15) at both ends: a snap is a deliberate
 * flick, and the gap between the two is what stops a thumb resting near the
 * threshold from turning the world into a strobe.
 */
export const SNAP_FIRE = 0.7
export const SNAP_REARM = 0.35

export interface SnapTurnResult {
  /** Whether the stick is now clear to fire again. */
  armed: boolean
  /**
   * −1, 0 or +1, in the same sense as `flyStep`'s `rightX`: +1 means the stick
   * was pushed RIGHT, which turns the viewer right (and so decreases rig yaw).
   */
  turns: number
}

/**
 * One frame of snap turning. Deliberately fires at most once per flick — no
 * auto-repeat while held, which is what most headset software settles on: a
 * repeat is a slower strobe rather than a different thing, and a viewer who
 * wants to get round faster is better served by a bigger angle.
 */
export function snapTurnStep(armed: boolean, stickX: number): SnapTurnResult {
  if (!armed) return { armed: Math.abs(stickX) < SNAP_REARM, turns: 0 }
  if (stickX >= SNAP_FIRE) return { armed: false, turns: 1 }
  if (stickX <= -SNAP_FIRE) return { armed: false, turns: -1 }
  return { armed: true, turns: 0 }
}

// --- Vignette -----------------------------------------------------------------

/**
 * The clear aperture at full strength, as a HALF-ANGLE from the gaze.
 *
 * Calibrated against a Quest 3's per-eye field of view — roughly 55° horizontal
 * and 48° vertical half-angle — because an aperture wider than the headset can
 * show is not a light vignette, it is no vignette at all. Light therefore bites
 * only at the far periphery, which is precisely the part of the retina that
 * drives vection, and Strong closes to about half the visible field.
 *
 * Tunable, and among the first things to try on hardware: a number that reads
 * as gentle on one face reads as a letterbox on another.
 */
export const VIGNETTE_APERTURE_RAD: Record<VignetteLevel, number> = {
  off: Math.PI,
  light: (45 * Math.PI) / 180,
  medium: (35 * Math.PI) / 180,
  strong: (25 * Math.PI) / 180,
}

/** Soft edge, so the tunnel has no visible rim to look at. */
export const VIGNETTE_BAND_RAD = (10 * Math.PI) / 180

/**
 * Motion at which the tunnel is fully closed. Both are the app's own top
 * locomotion speeds (xrNav.ts), so ordinary flight and an ordinary turn each
 * reach full strength — those being the two gestures this exists for.
 */
export const VIGNETTE_REF_SPEED_MPS = MOVE_SPEED_MPS
export const VIGNETTE_REF_TURN_DPS = (TURN_SPEED_RAD * 180) / Math.PI

/**
 * Time constants. The tunnel has to be there BEFORE the optical flow builds, so
 * it closes quickly; it opens slowly, because a vignette that snaps away the
 * instant a stick crosses its dead zone flickers on every small correction and
 * is more distracting than the motion it was masking.
 */
export const VIGNETTE_ATTACK_MS = 90
export const VIGNETTE_RELEASE_MS = 260

/** Below this the vignette draws nothing at all. */
export const VIGNETTE_EPSILON = 0.01

export interface VignetteAperture {
  /** Half-angle from the gaze where the darkening begins, radians. */
  inner: number
  /** …and where it reaches full opacity. */
  outer: number
  /** How opaque that full opacity is, 0..1 — this is what follows the speed. */
  alpha: number
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

/**
 * How closed the tunnel wants to be, from the rig's ACTUAL motion this frame.
 *
 * Measuring the rig rather than the gestures is the whole design: every source
 * of self-motion is covered by one measurement — thumbstick flight, a grab-drag,
 * a two-handed pinch, a focus dash, Follow riding a moving node — including any
 * added later, and a viewer standing still is free by construction. What must
 * NOT reach it is a discontinuous jump (a snap turn, a blink, a fit), which has
 * no optical flow at all and would otherwise flash the tunnel shut for a frame;
 * the rig excludes those at the call site.
 *
 * Rotation and translation share one reference each and the worse of the two
 * wins, rather than being summed: they are the same discomfort reported twice,
 * not two discomforts.
 */
export function vignetteTarget(
  settings: ComfortSettings,
  linearMps: number,
  turnDps: number,
): number {
  if (settings.vignette === 'off') return 0
  return clamp01(
    Math.max(
      Math.abs(linearMps) / VIGNETTE_REF_SPEED_MPS,
      Math.abs(turnDps) / VIGNETTE_REF_TURN_DPS,
    ),
  )
}

/** Ease the intensity toward its target, asymmetrically. Frame-rate independent
 *  (`1 − exp(−dt/τ)`), like the desk camera's smoothing. */
export function advanceVignette(current: number, target: number, dtMs: number): number {
  const tau = target > current ? VIGNETTE_ATTACK_MS : VIGNETTE_RELEASE_MS
  if (dtMs <= 0 || tau <= 0) return target
  const k = 1 - Math.exp(-dtMs / tau)
  const next = current + (target - current) * k
  // Land exactly rather than approaching zero forever, so a still viewer's
  // vignette really does switch off (the settle rule cameraSmoothing follows).
  return Math.abs(target - next) < 1e-4 ? target : next
}

/**
 * The tunnel for this intensity, or null when nothing should draw.
 *
 * The APERTURE is fixed by the level and the OPACITY is what tracks the speed —
 * which is the other way round from the obvious design, and the drive is what
 * settled it. Widening the aperture with slowness cannot work: to be genuinely
 * invisible at rest it has to open past what a headset can display (~55°
 * horizontal half-angle, ~63° into the corners), so most of the intensity range
 * would be spent off-screen and the tunnel would appear to pop in around
 * three-quarter speed rather than fade in. Measured, before the change: nothing
 * at all was visible below an intensity of 0.71.
 *
 * Ramping opacity instead uses the whole range, and it holds the level's own
 * meaning steady — "Light" is the same shaped tunnel whether you are drifting or
 * at full pelt, only fainter. A shape that changes as you accelerate is the more
 * distracting of the two anyway, which is the opposite of the point.
 */
export function vignetteAperture(
  settings: ComfortSettings,
  intensity: number,
): VignetteAperture | null {
  if (settings.vignette === 'off' || intensity <= VIGNETTE_EPSILON) return null
  const inner = VIGNETTE_APERTURE_RAD[settings.vignette]
  return { inner, outer: inner + VIGNETTE_BAND_RAD, alpha: clamp01(intensity) }
}

// --- Cycling, for the steppers ------------------------------------------------
// Both surfaces (the DOM row and the in-headset page) drive these, so the two
// cannot offer different sets or wrap differently.

function cycle<T>(values: readonly T[], current: T, step: number): T {
  const i = values.indexOf(current)
  const n = values.length
  return values[(((i < 0 ? 0 : i) + step) % n + n) % n]
}

export function cycleTurnMode(current: TurnMode, step: number): TurnMode {
  return cycle(TURN_MODES, current, step)
}

export function cycleSnapDegrees(current: number, step: number): number {
  return cycle(SNAP_ANGLES, current, step)
}

export function cycleVignette(current: VignetteLevel, step: number): VignetteLevel {
  return cycle(VIGNETTE_LEVELS, current, step)
}
