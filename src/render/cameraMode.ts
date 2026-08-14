// Camera Mode (free flight, C key) + the saved camera-view list (Shift+C):
// a port of the desktop viewport's "Camera Mode navigation" block — the
// d66304a ANTz-style *rate* flight rework, not the original per-move drag
// (the test group asked for the redo; banking went with it).
//
// The model: the camera rig stays the same azimuth/elevation/distance/target
// orbit rig the whole app uses, and flight only changes which end of the arm
// the mouse drives. Orbit mode swings the EYE around a fixed target; flight
// swings the TARGET around a fixed eye (turning and looking around), and
// translates both together (flying and sliding) — the arm length never
// changes, so the target rides along in front of the camera instead of
// pinning it. That's the whole point: no object you're stuck circling.
// Switch Camera Mode back off and the target is wherever you last left it,
// ready to orbit again.
//
// Left-drag flight is rate-based: the press point becomes the bearings
// origin, and the cursor's *held offset* from it sets a continuous speed —
// flight keeps going while the button is down even with the mouse
// stationary, and bringing the cursor back to the origin stops it. Flight is
// locked to the horizontal plane it starts on (translation follows the
// camera's heading with the pitch dropped), so altitude never changes no
// matter where the aim points.
//
// This module is pure state + math with no DOM and no THREE in it, so the
// behavior suite runs in plain node (the FrameSampler / nextPanelMode rule);
// main.ts owns the pointer events, OrbitControls handoff, and pushing the
// rig into the THREE camera each frame.

export type Vec3 = [number, number, number]

// Speeds scale off the arm length (distance) so flying feels the same
// whether you're circling a whole 500-unit scene or nosing around one glyph:
// holding ~100px above the origin covers roughly one view distance per second.
export const FLY_RATE_PER_PX_S = 0.01 // arm-length fraction per second, per px of vertical offset
export const FLY_TURN_DEG_PER_PX_S = 0.5 // degrees per second, per px of horizontal offset
export const FLY_DEADZONE_PX = 3.0 // per-axis: no motion until the cursor leaves this radius
export const FLY_SPEED_PER_PX = 0.004 // strafe (Left+Right slide): arm-length fraction per px
export const FLY_WHEEL_STEP = 0.12 // fraction of arm length per wheel notch
export const LOOK_DEG_PER_PX = 0.25 // look-around (right-drag) rate, both axes

const DEG = Math.PI / 180
const ELEVATION_CLAMP = 89 // short of the up-vector singularity, as everywhere

/** The orbit rig every camera path in the app shares: an eye swung around a
 *  pivot by two angles at a fixed arm length. The desktop viewport keeps these
 *  four as `_cam_azimuth` / `_cam_elevation` / `_cam_distance` / `_cam_target`;
 *  here they are also what camera smoothing eases (render/cameraSmoothing.ts),
 *  which is why the conversion lives out here rather than on CameraRig. */
export interface OrbitRig {
  azimuth: number
  elevation: number
  distance: number
  target: Vec3
}

/** eye = target + distance·(cos el·cos az, cos el·sin az, sin el) — the
 *  desktop's gluLookAt convention, Z-up. */
export function eyeFromRig(rig: OrbitRig): Vec3 {
  const az = rig.azimuth * DEG
  const el = rig.elevation * DEG
  const [tx, ty, tz] = rig.target
  return [
    tx + rig.distance * Math.cos(el) * Math.cos(az),
    ty + rig.distance * Math.cos(el) * Math.sin(az),
    tz + rig.distance * Math.sin(el),
  ]
}

/** The inverse: decompose a live eye/target pair back into the rig. Returns
 *  null for a degenerate (zero-length) arm, which has no angles at all — the
 *  caller keeps whatever rig it already had. Elevation is clamped to ±89°
 *  because OrbitControls can reach the pole exactly and the rig's own moves
 *  never do (a sub-1° dip, and only at the pole). */
export function rigFromView(eye: Vec3, target: Vec3): OrbitRig | null {
  const ox = eye[0] - target[0]
  const oy = eye[1] - target[1]
  const oz = eye[2] - target[2]
  const r = Math.sqrt(ox * ox + oy * oy + oz * oz)
  if (r < 1e-9) return null
  return {
    azimuth: Math.atan2(oy, ox) / DEG,
    elevation: Math.max(-ELEVATION_CLAMP, Math.min(ELEVATION_CLAMP, Math.asin(oz / r) / DEG)),
    distance: r,
    target: [target[0], target[1], target[2]],
  }
}

/** Pixels of flight-drag cursor offset beyond the dead zone (0 inside it) —
 *  measured from the edge, so motion ramps up from zero as the cursor leaves
 *  the zone instead of jumping to a dead-zone-sized speed. */
export function pastDeadzone(offset: number): number {
  if (offset > FLY_DEADZONE_PX) return offset - FLY_DEADZONE_PX
  if (offset < -FLY_DEADZONE_PX) return offset + FLY_DEADZONE_PX
  return 0
}

/** A saved orbit-camera viewpoint, switchable with Shift+C or the Scene
 *  panel's Camera row. `locked` cameras (the 3 axis views) are fixed
 *  reference views: orbit and pan are disabled while active, zoom is not. */
export interface CameraView {
  name: string
  azimuth: number
  elevation: number
  distance: number
  target: Vec3
  locked: boolean
}

// DOM PointerEvent.buttons bits — the only two Camera Mode reads.
const LEFT = 1
const RIGHT = 2

export class CameraRig {
  azimuth = 45
  elevation = 25
  distance = 500
  target: Vec3 = [0, 0, 0]

  flyMode = false
  /** Rate-flight drag state: the left-press point (bearings origin) and the
   *  latest cursor position, in canvas pixels. The held offset between them
   *  drives continuous motion once per tick in applyFlyDrag; null = no
   *  flight drag in progress. */
  flyAnchor: [number, number] | null = null
  flyCursor: [number, number] | null = null

  cameras: CameraView[]
  activeCamera = 0

  // Pointer bookkeeping for flyPointerEvent: the previous Left/Right chord
  // (transitions re-drop or clear the bearings origin) and the last cursor
  // position (per-move deltas for strafe and look-around).
  private prevButtons = 0
  private lastX = 0
  private lastY = 0

  constructor() {
    this.cameras = this.makeDefaultCameras()
  }

  // --- rig geometry (the desktop's gluLookAt conventions, Z-up) ---

  /** eye = target + distance·(cos el·cos az, cos el·sin az, sin el). */
  eyePosition(): Vec3 {
    return eyeFromRig(this)
  }

  /** The camera's (forward, right, up) unit vectors in world space:
   *  forward points eye→target, right is horizontal (world-Z is up), up
   *  completes the right-handed frame. The ±89° elevation clamp keeps
   *  `right` well away from the forward-parallel-to-up degeneracy. */
  cameraBasis(): [Vec3, Vec3, Vec3] {
    const az = this.azimuth * DEG
    const el = this.elevation * DEG
    const ce = Math.cos(el)
    const se = Math.sin(el)
    const ca = Math.cos(az)
    const sa = Math.sin(az)
    const forward: Vec3 = [-ce * ca, -ce * sa, -se]
    const right: Vec3 = [-sa, ca, 0]
    const up: Vec3 = [-ca * se, -sa * se, ce]
    return [forward, right, up]
  }

  /** The look-at up vector: flight never rolls the camera (banking was
   *  removed with the move to rate flight), so always world-Z. */
  cameraUp(): Vec3 {
    return [0, 0, 1]
  }

  /** Adopt a live eye position + target (the OrbitControls state) as the
   *  rig's own — called before any camera-view op or fly-mode entry, since
   *  outside Camera Mode the orbit controls are the source of truth. */
  syncFromView(eye: { x: number; y: number; z: number }, target: { x: number; y: number; z: number }) {
    const rig = rigFromView([eye.x, eye.y, eye.z], [target.x, target.y, target.z])
    if (!rig) return // degenerate view: keep the previous rig state
    this.azimuth = rig.azimuth
    this.elevation = rig.elevation
    this.distance = rig.distance
    this.target = rig.target
  }

  // --- saved camera views (Shift+C) ---

  /** The 4 default cameras: index 0 is the free orbit camera ("Main",
   *  seeded from the live rig), 1–3 are fixed +X/+Y/+Z reference views onto
   *  the world origin. azimuth=elevation=0 looks from the +X axis, azimuth
   *  90 from +Y, and elevation 89 (not 90 — the up-vector singularity) from
   *  nearly straight above on +Z. */
  makeDefaultCameras(axisDistance = 500): CameraView[] {
    return [
      {
        name: 'Main',
        azimuth: this.azimuth,
        elevation: this.elevation,
        distance: this.distance,
        target: [...this.target],
        locked: false,
      },
      { name: '+X View', azimuth: 0, elevation: 0, distance: axisDistance, target: [0, 0, 0], locked: true },
      { name: '+Y View', azimuth: 90, elevation: 0, distance: axisDistance, target: [0, 0, 0], locked: true },
      { name: '+Z View', azimuth: 0, elevation: 89, distance: axisDistance, target: [0, 0, 0], locked: true },
    ]
  }

  /** Scene load (the desktop's set_nodes): re-derive the axis views with a
   *  scene-appropriate distance and drop back to Main. Fly mode survives —
   *  the desktop's does too, and Main is unlocked so nothing conflicts. */
  resetCameras(axisDistance: number) {
    this.cameras = this.makeDefaultCameras(axisDistance)
    this.activeCamera = 0
  }

  activeCameraLocked(): boolean {
    return this.cameras.length > 0 && this.cameras[this.activeCamera].locked
  }

  /** Write the live rig state back into the active camera's saved slot. */
  syncActiveCamera() {
    const cam = this.cameras[this.activeCamera]
    cam.azimuth = this.azimuth
    cam.elevation = this.elevation
    cam.distance = this.distance
    cam.target = [...this.target]
  }

  /** Switch the active camera (by index, wrapping) and load its saved
   *  viewpoint live. Callers sync the rig from the real view first. */
  selectCamera(index: number) {
    const n = this.cameras.length
    if (n === 0) return
    index = ((index % n) + n) % n
    this.syncActiveCamera()
    this.activeCamera = index
    const cam = this.cameras[index]
    this.azimuth = cam.azimuth
    this.elevation = cam.elevation
    this.distance = cam.distance
    this.target = [...cam.target]
    if (cam.locked && this.flyMode) {
      // Fixed reference views don't fly — picking one leaves Camera Mode.
      this.setFlyMode(false)
    }
  }

  cycleCamera(step = 1) {
    this.selectCamera(this.activeCamera + step)
  }

  // --- Camera Mode (free flight) ---

  /** Turn free-flight Camera Mode on or off. Flight engages from wherever
   *  the view already is — no jump — but it can't run on a locked axis
   *  camera (those exist precisely to stay put), so turning it on switches
   *  to the Main camera first. Returns whether the mode actually changed
   *  (main.ts hangs the Follow-Selected clear and UI sync off that). */
  setFlyMode(on: boolean): boolean {
    if (on && this.activeCameraLocked()) this.selectCamera(0)
    if (on === this.flyMode) return false
    this.flyMode = on
    if (on) {
      // A chord held from before the mode predates flight: forget it, so the
      // first event in fly mode is a transition (a held Left then re-anchors
      // at the cursor — the desktop's toggled-mid-drag adoption).
      this.prevButtons = 0
    } else {
      this.flyAnchor = this.flyCursor = null
    }
    return true
  }

  /** One repaint tick of rate flight (called with the animation loop's dt).
   *  Holding the cursor above the bearings origin flies forward, below it
   *  back, left/right of it turns — each at a rate proportional to the held
   *  offset, so a slight offset gives a slight but *constant* motion, and
   *  returning inside the dead zone stops it. */
  applyFlyDrag(dtMs: number) {
    if (!this.flyMode || this.flyAnchor === null || this.flyCursor === null) return
    const dt = Math.max(dtMs, 0) / 1000
    if (!dt) return
    const offX = pastDeadzone(this.flyCursor[0] - this.flyAnchor[0])
    const offY = pastDeadzone(this.flyCursor[1] - this.flyAnchor[1])
    if (offY) {
      // Cursor above the origin (offY < 0) = fly forward. World-Z is up, so
      // the heading-only (horizontal-plane) forward is the full forward
      // vector with its elevation term dropped, renormalized — which is
      // just the azimuth direction. Altitude never changes.
      const az = this.azimuth * DEG
      const heading: Vec3 = [-Math.cos(az), -Math.sin(az), 0]
      const speed = Math.max(this.distance, 1) * FLY_RATE_PER_PX_S
      this.translateRig(heading, -offY * speed * dt)
    }
    if (offX) {
      // Cursor right of the origin = turn right. Azimuth runs counter-
      // clockwise from +X and the camera looks *back* along it, so a right
      // turn decreases it — the same sign a right orbit drag already uses.
      this.reaimAboutEye(-offX * FLY_TURN_DEG_PER_PX_S * dt)
    }
  }

  /** Right-drag in Camera Mode: pivot the view about the eye instead of
   *  swinging the eye about the target. Same drag directions as the orbit
   *  camera — drag right and the view turns right, drag down and it tips
   *  down — so muscle memory carries over between the two modes. */
  lookAround(dx: number, dy: number) {
    this.reaimAboutEye(-dx * LOOK_DEG_PER_PX, dy * LOOK_DEG_PER_PX)
  }

  /** Left+Right together in Camera Mode: slide the camera sideways and
   *  vertically in its own frame (truck/pedestal), without turning — the
   *  gesture for nudging a composed shot into place. */
  strafe(dx: number, dy: number) {
    const [, right, up] = this.cameraBasis()
    const speed = Math.max(this.distance, 1) * FLY_SPEED_PER_PX
    if (dx) this.translateRig(right, dx * speed)
    if (dy) this.translateRig(up, -dy * speed) // drag down = move down
  }

  /** Wheel in Camera Mode flies rather than zooms: shortening the arm would
   *  creep the eye toward a target that's supposed to ride along in front
   *  of it, and would quietly slow every later drag (flight speed scales
   *  off arm length). direction: +1 = wheel up = fly forward. */
  wheelFly(direction: 1 | -1) {
    const [forward] = this.cameraBasis()
    const step = this.distance * FLY_WHEEL_STEP
    this.translateRig(forward, direction > 0 ? step : -step)
  }

  /** Move eye and target together along `vec` (the eye is derived from the
   *  target, so translating the target translates both). */
  translateRig(vec: Vec3, amount: number) {
    this.target = [
      this.target[0] + vec[0] * amount,
      this.target[1] + vec[1] * amount,
      this.target[2] + vec[2] * amount,
    ]
  }

  /** Swing the *aim* by these angle deltas while the eye stays planted.
   *  The rig stores a target and derives the eye from it, so naively
   *  changing azimuth/elevation orbits the eye around the target — the
   *  exact anchored feeling Camera Mode exists to escape. Re-deriving the
   *  target from the preserved eye inverts that: the camera pivots where it
   *  stands, and whatever it was pointed at slides out of frame. */
  reaimAboutEye(dAzimuth: number, dElevation = 0) {
    const eye = this.eyePosition()
    this.azimuth += dAzimuth
    if (dElevation) {
      this.elevation = Math.max(-ELEVATION_CLAMP, Math.min(ELEVATION_CLAMP, this.elevation + dElevation))
    }
    const az = this.azimuth * DEG
    const el = this.elevation * DEG
    const d = this.distance
    this.target = [
      eye[0] - d * Math.cos(el) * Math.cos(az),
      eye[1] - d * Math.cos(el) * Math.sin(az),
      eye[2] - d * Math.sin(el),
    ]
  }

  // --- pointer state machine ---

  /** Feed every canvas pointer event here while Camera Mode is on (buttons
   *  is the DOM bitmask; only Left and Right matter). The desktop's
   *  press/release rule collapses to one transition rule: whenever the
   *  Left/Right chord changes, exactly-Left (re)drops the bearings origin
   *  at the cursor and anything else suspends rate flight. That covers a
   *  fresh press, the second button of a combo (the strafe must not fight a
   *  leftover held-offset flight), and ending a combo with Left still down
   *  (the pre-combo origin is stale — it would lurch the camera the moment
   *  Right lifted). On a plain move: Left tracks the cursor for the
   *  integrator, Both strafes, Right looks around. */
  flyPointerEvent(buttons: number, x: number, y: number) {
    const chord = buttons & (LEFT | RIGHT)
    const dx = x - this.lastX
    const dy = y - this.lastY
    const changed = chord !== this.prevButtons
    this.prevButtons = chord
    this.lastX = x
    this.lastY = y
    if (!this.flyMode) return
    if (changed) {
      if (chord === LEFT) this.flyAnchor = this.flyCursor = [x, y]
      else this.flyAnchor = this.flyCursor = null
      return
    }
    if (chord === LEFT) {
      // Camera Mode was toggled mid-drag (no press seen in fly mode):
      // adopt the cursor's current spot as the origin.
      if (this.flyAnchor === null) this.flyAnchor = [x, y]
      this.flyCursor = [x, y]
    } else if (chord === (LEFT | RIGHT)) {
      this.strafe(dx, dy)
    } else if (chord === RIGHT) {
      this.lookAround(dx, dy)
    }
  }
}
