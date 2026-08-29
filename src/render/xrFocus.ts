// Focus: going to a selected node in a headset. Pure maths — no THREE and no
// DOM, so it runs in plain node like xrNav.ts beside it, whose rig conventions
// (world units vs metres, `scale` as world-units-per-metre) it speaks.
//
// WHY THIS EXISTS, and why it is not teleport (Jeff, 2026-08-29). Long traverses
// are VR's standing problem, and the two stock answers do not fit GlyphViz. A
// parabolic teleport arc needs a FLOOR to land on — games have terrain, and the
// arc's whole job is finding the walkable surface under it. GlyphViz scenes
// mostly have no floor at all: a hyperglyph is a cloud in the air. And thumbstick
// flight is a fixed 3 m/s, which crosses a diorama in a second and a 43,414-node
// Cosmic Web never.
//
// What a scene DOES have is the glyphs themselves, and a ray that already picks
// them. So the destinations are the data: point, select, go. The desktop has had
// this since it had a mouse (`focus_on_node`, the double-click that re-centres
// the orbit pivot); what a headset changes is that we cannot re-aim the viewer's
// head, so the world has to be brought to where they are already looking.
//
// TRANSLATION ONLY. `fitRig` also rescales and re-yaws, which is right for
// placing a whole scene and wrong for travelling to a node inside one: the
// working scale is something the viewer chose (Room view or Tabletop, or a
// two-handed pinch), and silently rebasing it on each hop would make every
// arrival a different world. Yaw likewise — rotating the world about a standing
// viewer is the single most reliable way to make them sick. So a go-to moves
// `nav` and nothing else, which also makes it the most comfortable move there
// is: no rotation, no scale change, and a straight path.
//
// Framing the selection — the scale-changing operation — is a FIT, and lives
// with the other fits on the control panel's Fit row.

import {
  FIT_DOWN_M,
  FIT_FORWARD_M,
  solveNav,
  type HeadPose,
  type Vec3,
  type XrRigState,
} from './xrNav'

/**
 * How much of the view a focused target should span, as an angle. 40° is the
 * comfortable "hold it up and look at it" size: big enough to read a glyph's
 * shape and its label, small enough that its neighbours are still in frame,
 * which is the point of arriving at a node in a data scene rather than at a
 * node in isolation.
 */
export const FOCUS_ANGLE_RAD = (40 * Math.PI) / 180

/**
 * Arrival distance clamps, in perceived metres.
 *
 * The floor is the real one: closer than about 45 cm and the eyes have to
 * converge harder than a headset's fixed focal distance wants, which is
 * uncomfortable within seconds. Since the distance is derived from the target's
 * PERCEIVED size, the floor is what a tiny glyph at a room-scale fit gets — you
 * arrive next to it rather than inside it.
 *
 * The ceiling only bites on a target that is already enormous in perceived
 * terms (a whole subtree while standing inside the scene); past it, backing off
 * further stops adding anything you could not already see.
 */
export const FOCUS_MIN_DISTANCE_M = 0.45
export const FOCUS_MAX_DISTANCE_M = 40

/**
 * How far off level the arrival direction may be pitched.
 *
 * We cannot turn the viewer's head, so the target has to land where they are
 * ALREADY looking or they will not see it — which argues for using the head's
 * own forward vector. But an unclamped one parks the destination wherever the
 * neck happened to be at the moment of the press, and holding a 70° craned
 * gaze on the thing you just travelled to is its own kind of unpleasant. 35°
 * is a glance; past that the target lands at the edge of the same glance
 * instead, still in view and reachable by lowering your eyes rather than your
 * neck.
 */
export const FOCUS_MAX_PITCH_RAD = (35 * Math.PI) / 180

/**
 * The drop below eye level, as a fraction of the arrival distance — the scene
 * fit's own ratio (0.35 m at 15 m, about 1.3°), so a go-to sits the target the
 * same hair below the horizon that Room view sits a scene. Stated as a ratio
 * rather than as metres because the arrival distance here spans two orders of
 * magnitude, and a fixed 0.35 m drop at half a metre away would be a 35° dive.
 */
export const FOCUS_DOWN_RATIO = FIT_DOWN_M / FIT_FORWARD_M

// --- The transition -----------------------------------------------------------
//
// A cut would be the most comfortable move of all — no vection whatsoever — and
// it is what the Fit row's Room/Tabletop buttons do, because a fit is a RESET
// and an instant re-placement reads as intentional. Travel is different: seeing
// yourself cross the gap is what tells you how the thing you went to sits
// relative to the thing you left, and in a data scene that relationship IS the
// information. So a go-to is animated.
//
// Two styles, chosen by how far the hop actually is in PERCEIVED metres:
//
//   dash    a short flight, eased in and out. Preserves the spatial relation.
//   blink   fade out, jump, fade in. Past a dozen metres a dash is not travel
//           any more, it is a blur at highway speed, and there is nothing to
//           learn from a blur. The blink costs the relationship and buys back
//           a viewer who is not queasy.
//
// Eased rather than the exponential lag `cameraSmoothing.ts` uses for the desk
// camera: a first-order filter starts at its maximum velocity, which is the
// worst possible opening for a long move, and it has no defined arrival. A
// smoothstep starts and ends at zero velocity and lands exactly.

export type FocusStyle = 'dash' | 'blink'

export interface FocusTransition {
  /** Rig translation at the start and end, WORLD units. */
  from: Vec3
  to: Vec3
  style: FocusStyle
  /** 0 for a hop too short to be worth animating. */
  durationMs: number
}

export interface FocusFrame {
  /** The rig translation for this instant. */
  nav: Vec3
  /** How black the view is, 0..1 — a blink's fade; always 0 for a dash. */
  fade: number
  done: boolean
}

/** Perceived metres per second a dash travels at, before the duration clamps. */
export const DASH_SPEED_MPS = 12
export const DASH_MIN_MS = 160
export const DASH_MAX_MS = 800

/** Perceived metres past which a dash becomes a blink. */
export const BLINK_ABOVE_M = 12
export const BLINK_MS = 300
/** Fully black by this fraction of the blink, and starting to clear by this one.
 *  The jump itself happens at the half-way point, inside the black. */
export const BLINK_OUT = 0.35
export const BLINK_IN = 0.6

/** Hops shorter than this (perceived metres) are not worth animating. */
export const FOCUS_EPSILON_M = 1e-3

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/** 3t² − 2t³: zero velocity at both ends, which is what keeps a long dash from
 *  starting with a lurch. */
export function smoothstep(u: number): number {
  const t = clamp(u, 0, 1)
  return t * t * (3 - 2 * t)
}

/**
 * How far to stand from a target of this size.
 *
 * `extentWorld` is the target's largest world-space span and `scale` is world
 * units per metre, so the size the viewer actually sees is `extent / scale`
 * metres — which is why the same node earns a different distance at Tabletop
 * than at Room view, and why a go-to never needs to touch the scale to be
 * useful at either.
 */
export function focusDistance(extentWorld: number, scale: number): number {
  const perceived = Math.max(extentWorld, 0) / Math.max(scale, 1e-9)
  const d = perceived / 2 / Math.tan(FOCUS_ANGLE_RAD / 2)
  return clamp(d, FOCUS_MIN_DISTANCE_M, FOCUS_MAX_DISTANCE_M)
}

/**
 * The head's forward direction with its pitch clamped, normalised — the
 * direction a focused target arrives along.
 *
 * Looking straight up or down leaves no horizontal component to lean on, so
 * that case falls back to the head's own right vector turned a quarter turn,
 * which is the direction the body is facing however the neck is craned. The
 * same fallback `XrRig.placeFloatAnchor` uses, for the same reason.
 */
export function focusDirection(head: HeadPose): Vec3 {
  const f = head.forward
  let hx = f.x
  let hz = f.z
  let horiz = Math.hypot(hx, hz)
  if (horiz < 1e-4) {
    const r = head.right
    hx = r.z
    hz = -r.x
    horiz = Math.hypot(hx, hz)
    if (horiz < 1e-4) {
      hx = 0
      hz = -1
      horiz = 1
    }
  }
  const pitch = clamp(Math.atan2(f.y, Math.hypot(f.x, f.z)), -FOCUS_MAX_PITCH_RAD, FOCUS_MAX_PITCH_RAD)
  const c = Math.cos(pitch)
  return { x: (hx / horiz) * c, y: Math.sin(pitch), z: (hz / horiz) * c }
}

/**
 * Where in XR space (metres) a focused target should end up: `distanceM` along
 * the clamped gaze, a hair below eye level.
 */
export function focusAim(head: HeadPose, distanceM: number): Vec3 {
  const dir = focusDirection(head)
  return {
    x: head.position.x + dir.x * distanceM,
    y: head.position.y + dir.y * distanceM - distanceM * FOCUS_DOWN_RATIO,
    z: head.position.z + dir.z * distanceM,
  }
}

/**
 * The rig translation that puts `target` in front of the viewer at a distance
 * suited to its size — the whole go-to, in one solve, with yaw and scale left
 * exactly as the viewer set them.
 */
export function goToNav(
  target: Vec3,
  extentWorld: number,
  head: HeadPose,
  state: XrRigState,
): Vec3 {
  const aim = focusAim(head, focusDistance(extentWorld, state.scale))
  return solveNav(target, aim, state.yaw, state.scale)
}

/** Perceived metres between two rig translations. */
export function focusTravelM(from: Vec3, to: Vec3, scale: number): number {
  return Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z) / Math.max(scale, 1e-9)
}

/** Plan the move: which style, and how long it takes. */
export function beginFocus(from: Vec3, to: Vec3, scale: number): FocusTransition {
  const travel = focusTravelM(from, to, scale)
  if (travel < FOCUS_EPSILON_M) return { from, to, style: 'dash', durationMs: 0 }
  if (travel > BLINK_ABOVE_M) return { from, to, style: 'blink', durationMs: BLINK_MS }
  return {
    from,
    to,
    style: 'dash',
    durationMs: clamp((travel / DASH_SPEED_MPS) * 1000, DASH_MIN_MS, DASH_MAX_MS),
  }
}

function blinkFade(u: number): number {
  if (u <= 0) return 0
  if (u < BLINK_OUT) return u / BLINK_OUT
  if (u < BLINK_IN) return 1
  return Math.max(0, 1 - (u - BLINK_IN) / (1 - BLINK_IN))
}

/**
 * Where the rig is `elapsedMs` into the move. Pure — the caller owns the clock,
 * which is what lets a test walk a transition frame by frame without a rig.
 */
export function focusFrame(t: FocusTransition, elapsedMs: number): FocusFrame {
  const u = t.durationMs <= 0 ? 1 : clamp(elapsedMs / t.durationMs, 0, 1)
  const done = u >= 1
  if (t.style === 'blink') {
    // The jump lands inside the black, so nothing of the travel is ever seen —
    // which is the entire point of choosing a blink over a dash.
    return { nav: u < 0.5 ? t.from : t.to, fade: done ? 0 : blinkFade(u), done }
  }
  const s = smoothstep(u)
  return {
    nav: {
      x: t.from.x + (t.to.x - t.from.x) * s,
      y: t.from.y + (t.to.y - t.from.y) * s,
      z: t.from.z + (t.to.z - t.from.z) * s,
    },
    fade: 0,
    done,
  }
}

/**
 * Carry a transition along with a target that is moving under it — a Channels
 * animation running while Follow warps to the node it is animating.
 *
 * Without this the destination is wherever the node WAS when the press landed,
 * so a dash to a fast node arrives beside it rather than at it. Both ends move
 * together, so the path in progress is translated rather than bent.
 */
export function shiftFocus(t: FocusTransition, delta: Vec3): FocusTransition {
  return {
    ...t,
    from: { x: t.from.x + delta.x, y: t.from.y + delta.y, z: t.from.z + delta.z },
    to: { x: t.to.x + delta.x, y: t.to.y + delta.y, z: t.to.z + delta.z },
  }
}

/**
 * May a manual gesture interrupt this move?
 *
 * A dash yes — "an unsmoothed gesture halts a glide" is the rule the desk
 * camera's smoothing already runs on (roadmap 6y), and a stick push during a
 * dash is a person saying they would rather steer. A blink no: it is over in
 * 300 ms and its middle is a black screen, so there is nothing there anyone
 * could mean to interrupt, and stopping half way would strand the viewer in the
 * dark.
 */
export function focusInterruptible(t: FocusTransition): boolean {
  return t.style === 'dash'
}
