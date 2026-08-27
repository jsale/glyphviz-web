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
//   B / Y        play/pause Channels
//
// The two face buttons the spike spent on re-fitting are panel switches here,
// one per wrist: X shows/hides the CONTROL panel on the left, A the PROPERTIES
// panel on the right (agreed with Jeff 2026-08-16). Re-fit did not lose a home
// — the control panel's Fit row has offered Room view and Tabletop since it
// shipped, and A was a duplicate of the first of those.
//
// Note what is NOT available: the left controller's Menu button and the right
// one's Meta button never reach the page at all — the runtime keeps both for
// the system menu and recentre — so the budget really is trigger, squeeze,
// stick, stick-click and two face buttons per hand.
//
// Deliberately NOT ported: everything in the spike that exists to work around
// its own stack. Its per-eye view matrices, swapchain routing and `--toe-deg`
// convergence fudge are all fixes for bugs in pyopenxr's helpers; WebXR hands
// us projection matrices and eye poses that are correct by construction, so
// there is nothing here to correct.

import * as THREE from 'three'
import { XrControllerModel } from './xrControllerModel'
import { XrPointer, type XrPointerHit } from './xrPointer'
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

/** Desktop `ControllerNav`'s marker colours, left then right. */
const HAND_COLORS: Record<XrHand, THREE.Color> = {
  left: new THREE.Color(0.2, 0.8, 1.0),
  right: new THREE.Color(1.0, 0.6, 0.2),
}

export interface XrCallbacks {
  /**
   * Trigger pulled at the scene: the ray is already in world space, and
   * `pose` is the controller's world orientation (which a grab-to-TURN reads
   * and nothing else does).
   *
   * `additive` is the right thumbstick click, held as a modifier — this app's
   * Ctrl. It means "toggle this node's membership" rather than "replace the
   * selection", and it suppresses the grab: the gesture is about the SELECTION,
   * not about moving what is in it.
   *
   * Return true to claim the press as a DRAG — the rig then reports the ray
   * every frame through `onDragRay` until the trigger is released, and finishes
   * with `onDragEnd`. That is how grabbing an already-selected glyph works:
   * "click to select, click-drag to move", which is the desktop's own model
   * (its gizmo needs a selection first) and leaves no shipped gesture changed.
   */
  onPick(
    raycaster: THREE.Raycaster,
    hand: XrHand,
    pose: THREE.Quaternion,
    additive: boolean,
  ): boolean
  /** A claimed press, still held. */
  onDragRay(raycaster: THREE.Raycaster, hand: XrHand, pose: THREE.Quaternion): void
  /** Trigger released, or the drag cancelled (a squeeze on the same hand). */
  onDragEnd(hand: XrHand, cancelled: boolean): void
  /** A/X: what the scene should be framed to, or null for an empty scene. */
  fitTarget(): { center: THREE.Vector3; extent: number } | null
  /** B/Y. */
  onSecondary(): void
  /** Left X — put the left wrist's CONTROL panel away, and bring it back. */
  onTogglePanel(): void
  /** Right A — the same for the right wrist's PROPERTIES panel. */
  onToggleProperties(): void
  /** What a trigger-held grab would do — captioned on the right controller, so
   *  the armed mode is readable without raising the panel to check. */
  grabModeLabel(): string
  onStart(): void
  onEnd(): void
}

/**
 * A surface the controller ray can drive — the two wrist panels. A hand whose
 * ray is on one does NOT pick the scene: a panel is to the ray what the DOM HUD
 * is to the mouse, and a press meant for a button must not also select whatever
 * glyph is behind it.
 */
export interface XrPointerTarget {
  /** Turn to face the viewer, before this frame's hit test reads the pose. */
  orient(headWorld: THREE.Vector3): void
  /** Where the ray met this surface, or null for a miss. */
  hover(raycaster: THREE.Raycaster): XrPointerHit | null
  /** Trigger pressed while hovering; true if it landed on something. */
  press(): boolean
  drag(raycaster: THREE.Raycaster): void
  release(): void
  clearHover(): void
}

/** Where the properties panel parks when it is unclipped from the wrist. */
const FLOAT_MIN_PITCH_FORWARD = 1e-3

/** Per-hand gamepad reading for one frame. */
interface HandInput {
  stickX: number
  stickY: number
  trigger: number
  squeeze: number
  primary: boolean
  secondary: boolean
  /** Thumbstick CLICK. The right hand's is the selection modifier — see
   *  `additive` in fireButtons. */
  stickClick: boolean
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
      // xr-standard index 3. Unclaimed until now, and the only free input left
      // that a thumb can hold down while the index finger works the trigger.
      stickClick: buttons[3]?.pressed ?? false,
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
  /** Where the CONTROL panel hangs. Re-parented onto the LEFT grip as soon as
   *  handedness resolves — which is only once a controller connects, so it
   *  starts on the rig and moves itself. */
  readonly panelAnchor = new THREE.Group()
  /** The same for the PROPERTIES panel, on the RIGHT grip — so each panel is
   *  pointed at with the hand that is not wearing it. */
  readonly panelAnchorRight = new THREE.Group()
  /**
   * Where the properties panel parks when it is unclipped from the wrist.
   *
   * A child of the RIG, not of the head and not of the world: parked in rig
   * space it stays where you left it as you look around (a head-locked panel
   * is nauseating) while still travelling with you as you fly, and it is not
   * rescaled by a two-handed pinch the way a world-anchored one would be.
   */
  readonly floatAnchor = new THREE.Group()
  state: XrRigState = identityRig()

  private readonly renderer: THREE.WebGLRenderer
  private readonly camera: THREE.PerspectiveCamera
  private readonly callbacks: XrCallbacks
  private readonly raycaster = new THREE.Raycaster()
  /** Beam + reticle and the drawn controller, one each per input slot. Which
   *  HAND a slot is only resolves when the device connects, so both are built
   *  neutral and told afterwards. */
  private readonly pointersByIndex: XrPointer[] = []
  private readonly modelsByIndex: XrControllerModel[] = []
  private readonly pointerByHand = new Map<XrHand, XrPointer>()
  private readonly modelByHand = new Map<XrHand, XrControllerModel>()
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
  private pendingFitMetres: number | undefined
  private pointers: XrPointerTarget[] = []
  /** The hand hovering a pointer target this frame, the target it is on, and
   *  the hand holding a press — a drag belongs to the hand that started it. */
  private pointerHand: XrHand | null = null
  private pointerTarget: XrPointerTarget | null = null
  private pressHand: XrHand | null = null
  private pressTarget: XrPointerTarget | null = null
  /** The hand holding a claimed scene drag (a grabbed glyph). */
  private grabHand: XrHand | null = null
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
    this.group.add(this.panelAnchor, this.panelAnchorRight, this.floatAnchor)

    renderer.xr.enabled = true
    for (let i = 0; i < 2; i++) {
      const ray = renderer.xr.getController(i)
      const grip = renderer.xr.getControllerGrip(i)
      const pointer = new XrPointer(ray, this.group)
      const model = new XrControllerModel()
      grip.add(model.group)
      this.pointersByIndex.push(pointer)
      this.modelsByIndex.push(model)
      ray.addEventListener('connected', (event) => {
        const handedness = (event as unknown as { data: XRInputSource }).data.handedness
        const hand: XrHand = handedness === 'left' ? 'left' : 'right'
        const color = HAND_COLORS[hand]
        pointer.setColor(color)
        model.setHand(hand, color)
        this.pointerByHand.set(hand, pointer)
        this.modelByHand.set(hand, model)
        // The panels ride a wrist each, which is only identifiable now.
        if (hand === 'left') grip.add(this.panelAnchor)
        else grip.add(this.panelAnchorRight)
      })
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

  /**
   * Re-frame the scene in front of the viewer (A, the panel's Fit row, and
   * every scene load). `targetMetres` is how wide the scene should read —
   * omitted, it takes the spike's 20 m default.
   */
  requestFit(targetMetres?: number): void {
    this.pendingFit = true
    this.pendingFitMetres = targetMetres
  }

  /**
   * Route the controller ray to these surfaces (the wrist panels) before the
   * scene. Order does not decide anything — the NEAREST hit wins, so two
   * panels that happen to overlap along a ray behave the way two objects do.
   */
  setPointerTargets(targets: readonly XrPointerTarget[]): void {
    this.pointers = [...targets]
    this.pointerHand = null
    this.pointerTarget = null
    this.pressHand = null
    this.pressTarget = null
  }

  /**
   * Park the floating anchor in front of the viewer, in RIG space (metres).
   *
   * The forward direction has its PITCH dropped: a panel summoned while you are
   * looking at your feet belongs in front of you, not on the floor. Looking
   * straight up or down leaves no horizontal component to normalise, so that
   * case falls back to the head's own right vector turned a quarter turn —
   * which is the direction the body is facing however the neck is craned.
   */
  placeFloatAnchor(distanceM: number, dropM: number): void {
    const head = new THREE.Vector3().setFromMatrixPosition(this.headLocal)
    const forward = new THREE.Vector3(0, 0, -1).transformDirection(this.headLocal)
    forward.y = 0
    if (forward.lengthSq() < FLOAT_MIN_PITCH_FORWARD) {
      const right = new THREE.Vector3(1, 0, 0).transformDirection(this.headLocal)
      forward.set(right.z, 0, -right.x)
      if (forward.lengthSq() < FLOAT_MIN_PITCH_FORWARD) forward.set(0, 0, -1)
    }
    forward.normalize()
    this.floatAnchor.position
      .copy(head)
      .addScaledVector(forward, distanceM)
      .add(new THREE.Vector3(0, -dropM, 0))
    this.floatAnchor.updateMatrixWorld(true)
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
    this.pressHand = null
    this.pressTarget = null
    this.grabHand = null
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
    this.endGrab(true)
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
    // Pointer routing runs on the rig just applied, so a hover reads this
    // frame's geometry, and BEFORE the buttons, which need to know whether the
    // ray is on the panel before deciding what a trigger means.
    this.updatePointer(hands)
    this.fireButtons(hands)
    // After the buttons, so a press the panel just consumed is already showing
    // on the controller that made it in the same frame.
    this.updateModels(hands)
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
      targetMetres: this.pendingFitMetres,
      // A tabletop model belongs within reach, not 15 m away: the placement
      // distance follows the size it is being placed at, so the same fit reads
      // as "the scene, arranged in front of me" at either scale.
      forward: this.pendingFitMetres === undefined ? undefined : this.pendingFitMetres * 0.75,
      down: this.pendingFitMetres === undefined ? undefined : this.pendingFitMetres * 0.15,
    })
    this.pendingFitMetres = undefined
    this.applyState()
  }

  /**
   * Which hand (if either) is pointing at the wrist panel, and how long its
   * ray should draw. The ray stops at the panel it is touching — a laser that
   * carries on through the button being pressed reads as missing it.
   */
  private updatePointer(hands: Partial<Record<XrHand, HandInput>>): void {
    // The beams are refreshed even with no panels to point at — a hand that has
    // gone away has to stop drawing one, and one with nothing under it has to
    // go back to full length.
    for (const hand of ['left', 'right'] as const) {
      const pointer = this.pointerByHand.get(hand)
      pointer?.setActive(hands[hand] !== undefined)
      if (this.pointers.length === 0) pointer?.update(null, false, this.state.scale)
    }
    if (this.pointers.length === 0) return
    for (const target of this.pointers) target.orient(this.headProxy.position)
    // A drag belongs to the hand that started it; the other hand cannot steal
    // the hover out from under it mid-slide.
    const order: XrHand[] = this.pressHand ? [this.pressHand] : ['right', 'left']
    let hovered: XrHand | null = null
    let hoveredTarget: XrPointerTarget | null = null
    const touched = new Set<XrPointerTarget>()
    for (const hand of order) {
      const input = hands[hand]
      if (!input) continue
      let best: XrPointerTarget | null = null
      let bestHit: XrPointerHit | null = null
      if (hovered === null) {
        // Every target is asked, because `hover` is also what records which
        // widget is lit — asking only until the first hit would leave a stale
        // highlight on the panel the ray has just left.
        for (const target of this.pointers) {
          const hit = target.hover(this.rayFor(input))
          touched.add(target)
          if (hit !== null && (bestHit === null || hit.distance < bestHit.distance)) {
            bestHit = hit
            best = target
          }
        }
      }
      // This frame's trigger, not last frame's `prevTrigger` — fireButtons has
      // not run yet, and a press that lights the reticle a frame late is
      // exactly the lag this whole module exists to remove.
      this.pointerByHand
        .get(hand)
        ?.update(bestHit, input.trigger >= TRIGGER_THRESHOLD, this.state.scale)
      if (best !== null) {
        // Only the nearest one keeps its highlight: a ray that passes through
        // a near panel to reach a far one is pointing at the near one.
        for (const target of this.pointers) if (target !== best) target.clearHover()
        hovered = hand
        hoveredTarget = best
      }
    }
    // While a press is held, `order` visits only the pressing hand — so the
    // other one never reached the loop above and would keep last frame's beam.
    for (const hand of ['left', 'right'] as const) {
      if (order.includes(hand) || !hands[hand]) continue
      this.pointerByHand.get(hand)?.update(null, false, this.state.scale)
    }
    if (hovered === null && this.pressHand === null) {
      for (const target of touched) target.clearHover()
    }
    this.pointerHand = hovered
    this.pointerTarget = hoveredTarget
  }

  /** Drive the drawn controllers off this frame's raw input. */
  private updateModels(hands: Partial<Record<XrHand, HandInput>>): void {
    const badges = {
      mode: this.callbacks.grabModeLabel(),
      additive: hands.right?.stickClick ?? false,
    }
    for (const hand of ['left', 'right'] as const) {
      const input = hands[hand]
      this.modelByHand.get(hand)?.update(
        input
          ? {
              // The RAW stick, not the flight-filtered one: the indicator's job
              // is to show what the thumb is doing, dead zone included.
              stickX: input.stickX,
              stickY: input.stickY,
              trigger: input.trigger,
              squeeze: input.squeeze,
              stickClick: input.stickClick,
              primary: input.primary,
              secondary: input.secondary,
            }
          : null,
        badges,
        this.headProxy.position,
      )
    }
  }

  /**
   * World-space ray for a hand's target-ray space, shared by the panel hit
   * test and scene picking.
   *
   * LinkPicker derives its click tolerance from a camera's field of view, so
   * the raycaster carries the scene camera: in immersive mode that fov no
   * longer describes a real viewport, but it keeps a link's pick width the
   * same ANGULAR size it has on the desktop, which is what it is for.
   */
  private rayFor(input: HandInput): THREE.Raycaster {
    const m = input.ray.matrixWorld
    const origin = new THREE.Vector3().setFromMatrixPosition(m)
    const direction = new THREE.Vector3(0, 0, -1).transformDirection(m)
    this.raycaster.set(origin, direction)
    this.raycaster.camera = this.camera
    return this.raycaster
  }

  /**
   * The hand's world ORIENTATION, which a grab-to-turn rotates a node by. The
   * ray direction alone would lose the twist, which is the whole gesture.
   *
   * `getWorldQuaternion` rather than `setFromRotationMatrix(matrixWorld)`: the
   * latter needs an UNSCALED rotation matrix, and the rig's world matrix
   * carries the world-units-per-metre scale, which at a typical 150 makes the
   * extracted quaternion meaningless — two frames of a real wrist twist then
   * compared as no rotation at all. `getWorldQuaternion` decomposes, which
   * divides the scale back out. Found by driving it; nothing in the scene graph
   * looks wrong until you ask for an angle.
   */
  private poseFor(input: HandInput): THREE.Quaternion {
    return input.ray.getWorldQuaternion(new THREE.Quaternion())
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
    // One modifier for both hands, taken off the RIGHT stick: the gesture is
    // "hold this, then pick", and a cross-hand chord (right thumb, left index)
    // is the comfortable way to do it while still working same-handed.
    const additive = hands.right?.stickClick ?? false
    for (const hand of ['left', 'right'] as const) {
      const input = hands[hand]
      if (!input) continue
      const trigger = input.trigger
      const down = trigger >= TRIGGER_THRESHOLD
      const wasDown = this.prevTrigger[hand] >= TRIGGER_THRESHOLD
      this.prevTrigger[hand] = trigger
      if (down && !wasDown) {
        // A panel takes the press when the ray is on it, and the scene never
        // sees it — a button click must not also select the glyph behind it.
        const target = this.pointerHand === hand ? this.pointerTarget : null
        if (target?.press()) {
          this.pressHand = hand
          this.pressTarget = target
        } else if (
          this.callbacks.onPick(this.rayFor(input), hand, this.poseFor(input), additive)
        ) {
          this.grabHand = hand
        }
      } else if (down && this.pressHand === hand) {
        this.pressTarget?.drag(this.rayFor(input))
      } else if (down && this.grabHand === hand) {
        // A squeeze on the SAME hand cancels the grab rather than fighting it:
        // that hand is now dragging the world, and a glyph following both would
        // move twice.
        if (this.grabbing.has(hand)) this.endGrab(true)
        else this.callbacks.onDragRay(this.rayFor(input), hand, this.poseFor(input))
      } else if (!down && this.pressHand === hand) {
        this.pressTarget?.release()
        this.pressHand = null
        this.pressTarget = null
      } else if (!down && this.grabHand === hand) {
        this.endGrab(false)
      }
      // A/X: each hand's primary shows and hides the panel on THAT wrist, so
      // the switch is under the thumb of the hand wearing it.
      if (input.primary && !this.prevPrimary[hand]) {
        if (hand === 'left') this.callbacks.onTogglePanel()
        else this.callbacks.onToggleProperties()
      }
      this.prevPrimary[hand] = input.primary
      if (input.secondary && !this.prevSecondary[hand]) this.callbacks.onSecondary()
      this.prevSecondary[hand] = input.secondary
    }
  }

  private endGrab(cancelled: boolean): void {
    const hand = this.grabHand
    if (hand === null) return
    this.grabHand = null
    this.callbacks.onDragEnd(hand, cancelled)
  }

  /** Release the pointers' and controllers' GPU resources. Never called in the
   *  app (the rig outlives every session), but a test that builds several rigs
   *  would otherwise leak a geometry per hand. */
  dispose(): void {
    for (const pointer of this.pointersByIndex) pointer.dispose()
    for (const model of this.modelsByIndex) model.dispose()
  }
}
