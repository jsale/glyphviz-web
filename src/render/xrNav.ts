// WebXR rig math — the pure half of immersive mode. No THREE and no DOM, so
// it runs in plain node like cameraMode.ts and drawMode.ts.
//
// GlyphViz worlds are Z-up and measured in arbitrary "world units"; WebXR
// reference spaces are Y-up and measured in METRES. Something has to map one
// onto the other, and the choice here is to transform the CAMERA, not the
// scene:
//
//     rig = T(nav) · R_z(yaw) · R_x(+90°) · S(scale)
//
// with the XR camera (and the controllers) parented to that rig. The desktop
// spike does the opposite — `render.draw_scene` pushes
// `Translate · RotateX(-90) · Scale` onto the modelview and `rig_inverse`
// carries locomotion — which is the natural move for immediate-mode GL but
// wrong here: every world-space buffer this app keeps (halo vertices, link
// endpoints, surface quads, Draw Mode's grid inversion) is computed in scene
// coordinates, and re-basing the scene would put them in a different space
// than the maths that writes them. Moving the rig instead leaves buildScene,
// picking and every overlay untouched.
//
// Because three composes the headset pose through the rig's world matrix, the
// rig's SCALE scales interpupillary distance and head motion by exactly the
// same factor — which is what makes `scale` read as "how big the world is"
// rather than as a cheat: at scale 20 the scene is a diorama you lean over and
// one real stride covers 20 world units, with honest stereo depth throughout.
//
// `scale` is therefore WORLD UNITS PER METRE. Note that this is the reciprocal
// of the desktop's `--scale` (`scene_fit.auto_scale_for_scene` returns
// `target_metres / extent` and applies it to the world); same picture, inverse
// number.

/** A plain 3-component vector. XR-space values are metres, world-space ones
 *  are GlyphViz world units — every function below says which it takes. */
export interface Vec3 {
  x: number
  y: number
  z: number
}

/** The whole of immersive navigation state. */
export interface XrRigState {
  /** Rig translation, in WORLD units. */
  nav: Vec3
  /** Rig yaw about the world's up axis (+Z), radians. */
  yaw: number
  /** World units per real metre. */
  scale: number
}

/** Desktop `ControllerNav.MOVE_SPEED` — metres/second at full deflection. */
export const MOVE_SPEED_MPS = 3.0
/** Desktop `ControllerNav.TURN_SPEED` — radians/second at full deflection. */
export const TURN_SPEED_RAD = Math.PI / 2
/** Desktop grab hysteresis: squeeze past ON to grab, back under OFF to let go. */
export const GRAB_ON_THRESHOLD = 0.6
export const GRAB_OFF_THRESHOLD = 0.4
/** Desktop `ControllerNav.TRIGGER_THRESHOLD` — the pick fires on the rising edge. */
export const TRIGGER_THRESHOLD = 0.5
/**
 * Thumbstick dead zone, measured from its EDGE so motion ramps from zero
 * rather than jumping to 15% the moment a stick leaves it — the same shape as
 * Camera Mode's 3px dead zone. Not a desktop constant: OpenXR's runtime had
 * already deadzoned the sticks before `ControllerNav` saw them, and a raw
 * WebXR gamepad axis has not been.
 */
export const STICK_DEADZONE = 0.15

/** Desktop spike CLI defaults (`--target-size`, `--forward`, `--down`). */
export const FIT_TARGET_M = 20.0
export const FIT_FORWARD_M = 15.0
export const FIT_DOWN_M = 0.35

/** Bounds on the two-handed scale gesture, so a pinch can't reach 0 or ∞. */
export const MIN_SCALE = 1e-6
export const MAX_SCALE = 1e9

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z }
}

export function identityRig(): XrRigState {
  return { nav: vec3(), yaw: 0, scale: 1 }
}

/**
 * Map an XR-space direction/offset (metres, Y-up) into world space
 * (units, Z-up) through the rig's rotation and scale: `R_z(yaw) · R_x(90°) · S`.
 *
 * R_x(+90°) sends (x, y, z) to (x, −z, y), so XR up (0,1,0) becomes world up
 * (0,0,1) and the viewer's initial forward (0,0,−1) becomes world +Y.
 */
export function rigBasisApply(p: Vec3, yaw: number, scale: number): Vec3 {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  // R_x(90°) first: (x, -z, y). Then R_z(yaw) about world up.
  return {
    x: scale * (p.x * c + p.z * s),
    y: scale * (p.x * s - p.z * c),
    z: scale * p.y,
  }
}

/** World-space point for an XR-space point, under the full rig transform. */
export function rigApply(state: XrRigState, p: Vec3): Vec3 {
  const b = rigBasisApply(p, state.yaw, state.scale)
  return { x: state.nav.x + b.x, y: state.nav.y + b.y, z: state.nav.z + b.z }
}

/**
 * The `nav` that pins `worldPoint` under `xrPoint` at the given yaw and scale.
 *
 * Every gesture here is "hold this world point still under this hand/head and
 * change something else", so they all end in this one solve — which is what
 * makes turning pivot about the head, and a two-handed pinch scale about the
 * point between the hands, instead of about the tracking origin.
 */
export function solveNav(worldPoint: Vec3, xrPoint: Vec3, yaw: number, scale: number): Vec3 {
  const b = rigBasisApply(xrPoint, yaw, scale)
  return { x: worldPoint.x - b.x, y: worldPoint.y - b.y, z: worldPoint.z - b.z }
}

/** Dead zone applied from its edge: 0 inside, ramping to ±1 at full deflection. */
export function deadzone(value: number, dz = STICK_DEADZONE): number {
  const m = Math.abs(value)
  if (m <= dz) return 0
  return Math.sign(value) * ((m - dz) / (1 - dz))
}

/** Heading of an XR-space forward vector about XR up, radians (0 = facing −Z). */
export function headYawOf(forward: Vec3): number {
  return Math.atan2(-forward.x, -forward.z)
}

/** Drop the XR up component and renormalise — locomotion is plane-locked, so
 *  looking down while flying forward never sinks you (desktop's own rule). */
function flattenXr(v: Vec3): Vec3 {
  const len = Math.max(Math.hypot(v.x, v.z), 1e-6)
  return { x: v.x / len, y: 0, z: v.z / len }
}

export interface StickInput {
  /** Left stick: +X strafes right, +Y flies forward (OpenXR sign, not the raw
   *  WebXR gamepad axis, whose Y is positive DOWNWARD). */
  leftX: number
  leftY: number
  /** Right stick: +X turns right, +Y rises. */
  rightX: number
  rightY: number
}

export interface HeadPose {
  /** Head position in XR space, metres. */
  position: Vec3
  /** Head forward (−Z) in XR space. */
  forward: Vec3
  /** Head right (+X) in XR space. */
  right: Vec3
}

/**
 * Turn the world about the viewer's HEAD by `deltaYaw` radians — the world
 * point under the head stays put.
 *
 * Shared by the smooth turn below and by snap turning (render/xrComfort.ts), so
 * the two cannot end up pivoting about different points; a snap that swung the
 * viewer sideways where a smooth turn did not would be a worse gesture, not
 * merely a different one.
 *
 * Divergence from the desktop spike, which is why this is a solve rather than
 * an addition: it accumulates `nav_yaw` and rotates the world about the
 * TRACKING ORIGIN, which swings a viewer standing away from it sideways through
 * the scene as they turn.
 */
export function turnAboutHead(state: XrRigState, headPos: Vec3, deltaYaw: number): XrRigState {
  if (deltaYaw === 0) return state
  const pinned = rigApply(state, headPos)
  const yaw = state.yaw + deltaYaw
  return { nav: solveNav(pinned, headPos, yaw, state.scale), yaw, scale: state.scale }
}

/**
 * One tick of thumbstick flight, ported from `ControllerNav.update`'s
 * locomotion block: left stick moves relative to where the head is really
 * looking (flattened to the horizontal plane), right stick turns and rises,
 * both at the desktop's speeds.
 */
export function flyStep(
  state: XrRigState,
  sticks: StickInput,
  head: HeadPose,
  dtSec: number,
): XrRigState {
  const lx = deadzone(sticks.leftX)
  const ly = deadzone(sticks.leftY)
  const rx = deadzone(sticks.rightX)
  const ry = deadzone(sticks.rightY)
  if (lx === 0 && ly === 0 && rx === 0 && ry === 0) return state

  // Right-stick X turns; the world under the head stays put.
  const turned = turnAboutHead(state, head.position, -rx * TURN_SPEED_RAD * dtSec)
  let yaw = turned.yaw
  let nav = turned.nav
  if (lx !== 0 || ly !== 0 || ry !== 0) {
    const forward = flattenXr(head.forward)
    const right = flattenXr(head.right)
    const step = MOVE_SPEED_MPS * dtSec
    const velocity = {
      x: (right.x * lx + forward.x * ly) * step,
      y: ry * step, // XR up
      z: (right.z * lx + forward.z * ly) * step,
    }
    const delta = rigBasisApply(velocity, yaw, state.scale)
    nav = { x: nav.x + delta.x, y: nav.y + delta.y, z: nav.z + delta.z }
  }
  return { nav, yaw, scale: state.scale }
}

/** What a grab remembers: the rig as it was, and where the hand(s) were then. */
export interface OneHandAnchor {
  state: XrRigState
  /** Grip position in XR space at the moment of the squeeze. */
  hand: Vec3
}

export interface TwoHandAnchor {
  state: XrRigState
  left: Vec3
  right: Vec3
}

/**
 * Single-hand grab-drag (desktop's squeeze translate): the world point that
 * was under the hand when it closed stays under it. Translation only — yaw and
 * scale are the two-handed gesture's business.
 */
export function oneHandDrag(anchor: OneHandAnchor, hand: Vec3): XrRigState {
  const pinned = rigApply(anchor.state, anchor.hand)
  return {
    nav: solveNav(pinned, hand, anchor.state.yaw, anchor.state.scale),
    yaw: anchor.state.yaw,
    scale: anchor.state.scale,
  }
}

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

/**
 * Two-handed grab: scale and yaw the world about the point between the hands,
 * which stays pinned to the world point it grabbed.
 *
 * A web addition — the desktop spike has single-hand translate only — because
 * it is the gesture every headset user reaches for first, and because it is
 * how you get from the 20 m default placement to a tabletop model and back
 * without a menu. Pulling the hands apart makes the world BIGGER, i.e. fewer
 * world units per metre.
 */
export function twoHandDrag(anchor: TwoHandAnchor, left: Vec3, right: Vec3): XrRigState {
  const d0 = Math.hypot(
    anchor.right.x - anchor.left.x,
    anchor.right.y - anchor.left.y,
    anchor.right.z - anchor.left.z,
  )
  const d = Math.hypot(right.x - left.x, right.y - left.y, right.z - left.z)
  if (d0 < 1e-4 || d < 1e-4) return anchor.state
  const scale = clampScale(anchor.state.scale * (d0 / d))

  // Hands rotating by θ about XR up rotate the world with them. A rotation of
  // θ about +Y takes the horizontal bearing atan2(z, x) to bearing − θ, and
  // R_x(90°) carries a rotation about XR up onto one about world up, so the
  // rig's yaw picks up exactly the bearing change.
  const a0 = Math.atan2(anchor.right.z - anchor.left.z, anchor.right.x - anchor.left.x)
  const a = Math.atan2(right.z - left.z, right.x - left.x)
  const yaw = anchor.state.yaw + (a - a0)

  const mid0 = {
    x: (anchor.left.x + anchor.right.x) / 2,
    y: (anchor.left.y + anchor.right.y) / 2,
    z: (anchor.left.z + anchor.right.z) / 2,
  }
  const mid = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2, z: (left.z + right.z) / 2 }
  return { nav: solveNav(rigApply(anchor.state, mid0), mid, yaw, scale), yaw, scale }
}

export interface FitOptions {
  /** Centre of the scene's bounding box, world units. */
  center: Vec3
  /** Largest bounding-box dimension, world units. */
  extent: number
  /** Head position in XR space, metres. */
  headPos: Vec3
  /** Head heading in XR space, radians (see headYawOf). */
  headYaw: number
  /** Desktop `--target-size`: how many metres the scene should span. */
  targetMetres?: number
  /** Desktop `--forward`: metres in front of the viewer. */
  forward?: number
  /** Desktop `--down`: metres below eye level. */
  down?: number
}

/**
 * Place the scene in front of wherever the viewer is actually standing and
 * looking, sized to `targetMetres` — the port of `scene_fit.auto_scale_for_scene`
 * plus the spike's `--forward`/`--down` placement, with the reciprocal scale
 * convention noted at the top of this file.
 *
 * The yaw makes the scene's +Y axis point away from the viewer whichever way
 * they happen to be facing, so a fit taken while turned around still puts the
 * scene the same way round in front of them.
 */
export function fitRig(options: FitOptions): XrRigState {
  const targetMetres = options.targetMetres ?? FIT_TARGET_M
  const forward = options.forward ?? FIT_FORWARD_M
  const down = options.down ?? FIT_DOWN_M
  const scale = clampScale(options.extent > 0 ? options.extent / targetMetres : 1)
  const yaw = -options.headYaw
  const sin = Math.sin(options.headYaw)
  const cos = Math.cos(options.headYaw)
  // The head's own forward, `forward` metres out and `down` metres below eye level.
  const target = {
    x: options.headPos.x - forward * sin,
    y: options.headPos.y - down,
    z: options.headPos.z - forward * cos,
  }
  return { nav: solveNav(options.center, target, yaw, scale), yaw, scale }
}
