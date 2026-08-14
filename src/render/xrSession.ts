// Immersive (WebXR) mode: the browser half. The maths lives in xrNav.ts, which
// has no THREE and no DOM in it; this file is the plumbing — session
// lifecycle, the camera rig, controllers, and the per-frame read of the
// gamepads that drives locomotion and picking.
//
// The controls are the desktop spike's (`glyphviz_xr/controller_nav.py`), which
// is the one part of that prototype worth porting behaviour-for-behaviour
// since Jeff has actually flown scenes with it:
//
//   left stick   fly, relative to where the head is really looking
//   right stick  turn (X) and rise/sink (Y)
//   squeeze      grab the world and drag it; BOTH hands scale and turn it
//   trigger      pick the node under the ray
//   A / X        re-fit the scene in front of you
//   B / Y        play/pause Channels
//
// Deliberately NOT ported: everything in the spike that exists to work around
// its own stack. Its per-eye view matrices, swapchain routing and `--toe-deg`
// convergence fudge are all fixes for bugs in pyopenxr's helpers; WebXR hands
// us projection matrices and eye poses that are correct by construction, so
// there is nothing here to correct.

import * as THREE from 'three'
import {
  GRAB_OFF_THRESHOLD,
  GRAB_ON_THRESHOLD,
  TRIGGER_THRESHOLD,
  fitRig,
  flyStep,
  headYawOf,
  identityRig,
  oneHandDrag,
  twoHandDrag,
  vec3,
  type OneHandAnchor,
  type TwoHandAnchor,
  type Vec3,
  type XrRigState,
} from './xrNav'

export type XrHand = 'left' | 'right'

/**
 * Near/far in METRES of the reference space (three passes them to
 * `XRSession.updateRenderState`). The app's ordinary 0.001 near plane is there
 * so the orbit camera can fly inside a glyph; at headset scale it means
 * nothing — nobody focuses closer than a few centimetres — and a near plane
 * that small throws away depth precision the compositor wants back.
 */
const XR_NEAR_M = 0.05
const XR_FAR_M = 3000

/** Ray length in metres — long enough to reach across a 20 m scene placement. */
const RAY_LENGTH_M = 30

/** Desktop `ControllerNav`'s marker colours, left then right. */
const HAND_COLORS: Record<XrHand, THREE.Color> = {
  left: new THREE.Color(0.2, 0.8, 1.0),
  right: new THREE.Color(1.0, 0.6, 0.2),
}

export interface XrCallbacks {
  /** Trigger pulled: the ray is already in world space. */
  onPick(raycaster: THREE.Raycaster, hand: XrHand): void
  /** A/X: what the scene should be framed to, or null for an empty scene. */
  fitTarget(): { center: THREE.Vector3; extent: number } | null
  /** B/Y. */
  onSecondary(): void
  onStart(): void
  onEnd(): void
}

/** Per-hand gamepad reading for one frame. */
interface HandInput {
  stickX: number
  stickY: number
  trigger: number
  squeeze: number
  primary: boolean
  secondary: boolean
  /** Target-ray space object (the ray you point with). */
  ray: THREE.Object3D
  /** Grip space position in XR space — what a grab-drag anchors on. */
  grip: Vec3
}

function readHands(
  session: XRSession,
  renderer: THREE.WebGLRenderer,
): Partial<Record<XrHand, HandInput>> {
  const hands: Partial<Record<XrHand, HandInput>> = {}
  const sources = session.inputSources
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i]
    const hand = source.handedness
    if (hand !== 'left' && hand !== 'right') continue
    const pad = source.gamepad
    // xr-standard puts the thumbstick on axes 2/3 and leaves 0/1 for a
    // touchpad; a controller with only one pair reports it there instead.
    const axes = pad?.axes ?? []
    const [ax, ay] = axes.length >= 4 ? [axes[2], axes[3]] : [axes[0] ?? 0, axes[1] ?? 0]
    const buttons = pad?.buttons ?? []
    const ray = renderer.xr.getController(i)
    const grip = renderer.xr.getControllerGrip(i)
    hands[hand] = {
      stickX: ax ?? 0,
      // WebXR's gamepad Y is positive DOWNWARD; xrNav speaks the OpenXR sign.
      stickY: -(ay ?? 0),
      trigger: buttons[0]?.value ?? 0,
      squeeze: buttons[1]?.value ?? 0,
      primary: buttons[4]?.pressed ?? false,
      secondary: buttons[5]?.pressed ?? false,
      ray,
      // A hand-tracked source has no grip space; the ray origin stands in.
      grip: vec3(grip.position.x, grip.position.y, grip.position.z),
    }
  }
  return hands
}

export class XrRig {
  /** The rig itself: the camera and controllers hang off this, and its
   *  transform is the whole XR-space → world-space mapping. */
  readonly group = new THREE.Group()
  /** Head pose in WORLD space, for anything that aims off the camera
   *  (the key light, the backdrop's distance sizing). */
  readonly headProxy = new THREE.Object3D()
  state: XrRigState = identityRig()

  private readonly renderer: THREE.WebGLRenderer
  private readonly camera: THREE.PerspectiveCamera
  private readonly callbacks: XrCallbacks
  private readonly raycaster = new THREE.Raycaster()
  private readonly rayLines: THREE.Line[] = []
  /** This frame's viewer pose in XR space, and the same in world space. */
  private readonly headLocal = new THREE.Matrix4()
  private readonly headWorld = new THREE.Matrix4()

  private grabbing = new Set<XrHand>()
  private grabKey = ''
  private oneAnchor: OneHandAnchor | null = null
  private twoAnchor: TwoHandAnchor | null = null
  private prevTrigger: Record<XrHand, number> = { left: 0, right: 0 }
  private prevPrimary: Record<XrHand, boolean> = { left: false, right: false }
  private prevSecondary: Record<XrHand, boolean> = { left: false, right: false }
  private pendingFit = false
  /** False until three has written a real viewer pose into the camera — it
   *  does that inside render(), so the first presenting frame has none yet. */
  private posed = false
  private saved: {
    parent: THREE.Object3D | null
    position: THREE.Vector3
    quaternion: THREE.Quaternion
    near: number
    far: number
  } | null = null

  constructor(
    renderer: THREE.WebGLRenderer,
    camera: THREE.PerspectiveCamera,
    scene: THREE.Scene,
    callbacks: XrCallbacks,
  ) {
    this.renderer = renderer
    this.camera = camera
    this.callbacks = callbacks
    this.group.name = 'xr-rig'
    scene.add(this.group)

    renderer.xr.enabled = true
    for (let i = 0; i < 2; i++) {
      const ray = renderer.xr.getController(i)
      const grip = renderer.xr.getControllerGrip(i)
      const line = this.makeRay()
      ray.add(line)
      this.rayLines.push(line)
      ray.addEventListener('connected', (event) => {
        const handedness = (event as unknown as { data: XRInputSource }).data.handedness
        const color = HAND_COLORS[handedness === 'left' ? 'left' : 'right']
        ;(line.material as THREE.LineBasicMaterial).color.copy(color)
        const marker = grip.children[0] as THREE.Mesh | undefined
        const material = marker?.material as THREE.MeshBasicMaterial | undefined
        material?.color.copy(color)
      })
      grip.add(this.makeMarker())
      this.group.add(ray, grip)
    }
  }

  /** Does this browser/device offer immersive VR at all? */
  static async isSupported(): Promise<boolean> {
    const xr = navigator.xr
    if (!xr?.isSessionSupported) return false
    try {
      return await xr.isSessionSupported('immersive-vr')
    } catch {
      return false
    }
  }

  get presenting(): boolean {
    return this.renderer.xr.isPresenting
  }

  /** Distance from the head to the world origin — the backdrop sizes its
   *  procedural grid off the orbit distance, and this is its stand-in. */
  get viewDistance(): number {
    return this.headProxy.position.length()
  }

  async enter(): Promise<void> {
    if (this.presenting) return
    const xr = navigator.xr
    if (!xr) throw new Error('This browser has no WebXR support.')
    const session = await xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
    })
    try {
      this.renderer.xr.setReferenceSpaceType('local-floor')
      await this.renderer.xr.setSession(session)
    } catch {
      // A runtime without a floor-relative space still gives us 'local',
      // whose origin is wherever the headset was when the session began.
      this.renderer.xr.setReferenceSpaceType('local')
      await this.renderer.xr.setSession(session)
    }
  }

  exit(): void {
    void this.renderer.xr.getSession()?.end()
  }

  /** Re-frame the scene in front of the viewer (A/X, and every scene load). */
  requestFit(): void {
    this.pendingFit = true
  }

  /**
   * Adopt the app camera's current pose as the one to restore on exit.
   *
   * A scene loaded mid-session still runs `fitCameraTo`, whose framing is
   * immediately overwritten by the next viewer pose — so without this, leaving
   * the headset would drop the camera back on the PREVIOUS scene's framing.
   * Called right after that fit, while the values are still there to read.
   */
  rememberDesktopCamera(): void {
    if (!this.saved) return
    this.saved.position.copy(this.camera.position)
    this.saved.quaternion.copy(this.camera.quaternion)
  }

  /** Called from the sessionstart handler: park the desktop camera state and
   *  put the camera on the rig. */
  handleSessionStart(): void {
    this.saved = {
      parent: this.camera.parent,
      position: this.camera.position.clone(),
      quaternion: this.camera.quaternion.clone(),
      near: this.camera.near,
      far: this.camera.far,
    }
    this.camera.near = XR_NEAR_M
    this.camera.far = XR_FAR_M
    this.camera.updateProjectionMatrix()
    this.group.add(this.camera)
    this.posed = false
    this.grabbing.clear()
    this.grabKey = ''
    // A provisional fit for the one frame before a real head pose arrives, so
    // the scene is roughly in place rather than wherever the last one left it.
    this.applyFit(vec3(0, 1.6, 0), 0)
    this.pendingFit = true
    this.callbacks.onStart()
  }

  handleSessionEnd(): void {
    const saved = this.saved
    this.saved = null
    this.grabbing.clear()
    if (saved) {
      this.group.remove(this.camera)
      saved.parent?.add(this.camera)
      this.camera.position.copy(saved.position)
      this.camera.quaternion.copy(saved.quaternion)
      this.camera.near = saved.near
      this.camera.far = saved.far
      this.camera.updateProjectionMatrix()
    }
    this.callbacks.onEnd()
  }

  /**
   * One immersive frame's input, run before the render. Reads the head pose
   * three wrote last frame, folds the controllers into the rig state, and
   * fires the edge-triggered commands.
   */
  update(dtMs: number): void {
    if (!this.presenting) return
    const session = this.renderer.xr.getSession()
    if (!session) return
    if (!this.posed) {
      // Nothing to read yet — the viewer pose lands in the camera during the
      // render that follows this call.
      this.posed = true
      return
    }

    // The head pose comes off three's OWN xr camera, not the app camera.
    // Both carry the viewer pose in XR space while a session runs, but the app
    // camera is also written by ordinary desktop code — `fitCameraTo` reframes
    // it on every scene load — and a fit computed from one of those writes
    // puts the scene tens of metres away at a desktop framing's angle. This one
    // is set from the pose and nothing else touches it.
    const xrCamera = this.renderer.xr.getCamera()
    this.headLocal.copy(xrCamera.matrix)
    const q = xrCamera.quaternion
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(q)
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q)
    const head = {
      position: vec3(xrCamera.position.x, xrCamera.position.y, xrCamera.position.z),
      forward: vec3(forward.x, forward.y, forward.z),
      right: vec3(right.x, right.y, right.z),
    }

    const hands = readHands(session, this.renderer)
    if (this.pendingFit) {
      this.pendingFit = false
      this.applyFit(head.position, headYawOf(head.forward))
    }

    this.updateGrabSet(hands)
    const left = hands.left
    const rightHand = hands.right
    if (this.twoAnchor && left && rightHand) {
      this.state = twoHandDrag(this.twoAnchor, left.grip, rightHand.grip)
    } else if (this.oneAnchor) {
      const held = this.grabbing.values().next().value as XrHand | undefined
      const hand = held ? hands[held] : undefined
      if (hand) this.state = oneHandDrag(this.oneAnchor, hand.grip)
    } else {
      // Thumbstick flight is suppressed while a hand is grabbing rather than
      // fighting it for the same nav offset — the desktop's rule.
      this.state = flyStep(
        this.state,
        {
          leftX: left?.stickX ?? 0,
          leftY: left?.stickY ?? 0,
          rightX: rightHand?.stickX ?? 0,
          rightY: rightHand?.stickY ?? 0,
        },
        head,
        Math.min(dtMs, 250) / 1000,
      )
    }

    this.applyState()
    this.fireButtons(hands)
  }

  /** Push the rig state onto the group, then refresh the world matrices the
   *  ray picks and the light aim read this same frame. */
  private applyState(): void {
    this.group.position.set(this.state.nav.x, this.state.nav.y, this.state.nav.z)
    this.group.quaternion
      .setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.state.yaw)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2))
    this.group.scale.setScalar(this.state.scale)
    this.group.updateMatrixWorld(true)
    // The head in WORLD space: this frame's rig against this frame's pose, so
    // the light aim and the backdrop distance are never a frame behind. A
    // decompose, not a rotation read — the rig's scale is in the matrix too.
    this.headWorld.multiplyMatrices(this.group.matrixWorld, this.headLocal)
    this.headWorld.decompose(
      this.headProxy.position,
      this.headProxy.quaternion,
      this.headProxy.scale,
    )
  }

  private applyFit(headPos: Vec3, headYaw: number): void {
    const target = this.callbacks.fitTarget()
    if (!target) return
    this.state = fitRig({
      center: vec3(target.center.x, target.center.y, target.center.z),
      extent: target.extent,
      headPos,
      headYaw,
    })
    this.applyState()
  }

  /**
   * Which hands are grabbing, with the desktop's hysteresis. Whenever that SET
   * changes the anchors are re-taken from the live rig — the same
   * "re-anchor whenever the chord changes" rule Camera Mode's
   * `flyPointerEvent` follows, and what keeps letting go of one hand mid-pinch
   * from lurching the world.
   */
  private updateGrabSet(hands: Partial<Record<XrHand, HandInput>>): void {
    for (const hand of ['left', 'right'] as const) {
      const input = hands[hand]
      const squeeze = input?.squeeze ?? 0
      if (this.grabbing.has(hand)) {
        if (!input || squeeze < GRAB_OFF_THRESHOLD) this.grabbing.delete(hand)
      } else if (input && squeeze > GRAB_ON_THRESHOLD) {
        this.grabbing.add(hand)
      }
    }
    const key = [...this.grabbing].sort().join('+')
    if (key === this.grabKey) return
    this.grabKey = key
    this.oneAnchor = null
    this.twoAnchor = null
    if (this.grabbing.size === 2 && hands.left && hands.right) {
      this.twoAnchor = { state: this.state, left: hands.left.grip, right: hands.right.grip }
    } else if (this.grabbing.size === 1) {
      const hand = this.grabbing.values().next().value as XrHand
      const input = hands[hand]
      if (input) this.oneAnchor = { state: this.state, hand: input.grip }
    }
  }

  private fireButtons(hands: Partial<Record<XrHand, HandInput>>): void {
    for (const hand of ['left', 'right'] as const) {
      const input = hands[hand]
      if (!input) continue
      const trigger = input.trigger
      if (this.prevTrigger[hand] < TRIGGER_THRESHOLD && trigger >= TRIGGER_THRESHOLD) {
        this.pick(input, hand)
      }
      this.prevTrigger[hand] = trigger
      if (input.primary && !this.prevPrimary[hand]) this.requestFit()
      this.prevPrimary[hand] = input.primary
      if (input.secondary && !this.prevSecondary[hand]) this.callbacks.onSecondary()
      this.prevSecondary[hand] = input.secondary
    }
  }

  private pick(input: HandInput, hand: XrHand): void {
    const m = input.ray.matrixWorld
    const origin = new THREE.Vector3().setFromMatrixPosition(m)
    const direction = new THREE.Vector3(0, 0, -1).transformDirection(m)
    this.raycaster.set(origin, direction)
    // LinkPicker derives its click tolerance from a camera's field of view, so
    // hand it the scene camera: in immersive mode that fov no longer describes
    // a real viewport, but it keeps a link's pick width the same ANGULAR size
    // it has on the desktop, which is what the tolerance is for.
    this.raycaster.camera = this.camera
    this.callbacks.onPick(this.raycaster, hand)
  }

  private makeRay(): THREE.Line {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -RAY_LENGTH_M),
    ])
    const line = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, fog: false }),
    )
    line.raycast = () => {}
    line.userData.isSelectionBox = true // chrome: never takes a blend mode
    return line
  }

  private makeMarker(): THREE.Mesh {
    const marker = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.04, 0.09),
      new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, fog: false }),
    )
    marker.raycast = () => {}
    marker.userData.isSelectionBox = true
    return marker
  }
}
