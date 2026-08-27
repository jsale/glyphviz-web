// The controller you see in the headset: a hand-built model whose thumbstick
// tilts, trigger sweeps, grip presses and buttons sink as you use them.
//
// What it replaces is a 4 × 4 × 9 cm wireframe box (P1's placeholder), which
// said nothing about what the hardware was doing — Jeff's own report,
// 2026-08-27, alongside the Unity controllers that do.
//
// BUILT rather than loaded, agreed with him the same day. three ships
// `XRControllerModelFactory`, which fetches the official per-device glTF from a
// CDN and animates it off the gamepad — the Unity behaviour exactly — and it
// was the obvious alternative. Three reasons went the other way:
//
//   - This app renders with `outputColorSpace = LinearSRGBColorSpace` and
//     `NoToneMapping` to match the desktop's fixed-function GL (lighting.ts).
//     A PBR asset authored for a managed pipeline, with metalness and no
//     environment map, comes out dull and dark under that rig.
//   - The assets are third-party bytes from jsDelivr at run time, or a few
//     hundred KB vendored into the deploy.
//   - A stock controller can only show the HARDWARE. This one also shows
//     GlyphViz: the armed grab mode rides on the right controller, and the
//     add-select modifier lights when the right stick is clicked. That is state
//     with nowhere else to live in a headset.
//
// Geometry is built from three's primitives the way the backdrop is, in METRES
// — the model hangs off the grip space, which is under the rig, whose local
// units are perceived metres (xrNav.ts). Every part is chrome: no picking, no
// fog, no blend mode.
//
// GRIP SPACE, which decides which way everything faces: +Y points up out of the
// top of the controller (where the stick and buttons are), −Z is the direction
// the barrel points, and the handle hangs down and slightly back. The target
// RAY is a separate space, tilted forward of this one, which is why the beam is
// parented there and not here.

import * as THREE from 'three'
import {
  controllerPose,
  restPose,
  type XrControllerInput,
  type XrControllerPose,
} from './xrControllerPose'
import type { XrHand } from './xrSession'

/**
 * Body greys. Deliberately LIGHTER than the black plastic a real Touch
 * controller is made of: the app shades a fragment at
 * `albedo · (0.5 + max(N·L, 0))` (lighting.ts) and writes it straight to the
 * framebuffer, so a 0.16 albedo lands between 0.16 and 0.24 — which against
 * GlyphViz's near-black default background is a controller you cannot see.
 * Found by looking at a rendered frame; every scene-graph assertion passed with
 * the dark values.
 */
const BODY_COLOR = new THREE.Color(0.3, 0.31, 0.36)
const FACE_COLOR = new THREE.Color(0.4, 0.42, 0.48)
const PART_COLOR = new THREE.Color(0.52, 0.54, 0.6)
const STICK_COLOR = new THREE.Color(0.17, 0.17, 0.2)
/** Lit accents. Bright ones are unlit so they read as indicator lamps rather
 *  than as painted plastic that happens to face the light. */
const IDLE_LAMP = new THREE.Color(0.28, 0.3, 0.36)

const HANDLE_LENGTH = 0.092
const HANDLE_TILT = -0.26
/** Flattened across the palm rather than round: an oval grip is what makes the
 *  shape read as something held in a hand instead of a torch. */
const HANDLE_SQUASH = 0.84
const FACE_RADIUS = 0.031

export interface XrControllerBadges {
  /** Drawn on the right controller: the armed grab mode (Move / Turn / Size). */
  mode: string
  /** The add-select modifier is being held (right thumbstick click). */
  additive: boolean
}

/**
 * One hand's controller. Built at construction in a neutral (right-handed)
 * form; `setHand` colours it and mirrors the parts that are handed, since
 * WebXR only tells us which hand this is when the device connects.
 */
export class XrControllerModel {
  readonly group = new THREE.Group()

  private readonly stickPivot = new THREE.Group()
  private readonly stickCap: THREE.Mesh
  private readonly stickLamp: THREE.Mesh
  private readonly triggerPivot = new THREE.Group()
  private readonly triggerLamp: THREE.Mesh
  private readonly squeezePad: THREE.Mesh
  private readonly squeezeLamp: THREE.Mesh
  private readonly primaryButton: THREE.Mesh
  private readonly secondaryButton: THREE.Mesh
  private readonly accent: THREE.Mesh
  private readonly badge: XrControllerBadge
  private readonly disposables: Array<THREE.BufferGeometry | THREE.Material> = []

  private hand: XrHand | null = null
  private squeezeHome = 0

  constructor() {
    this.group.name = 'xr-controller'

    // --- Handle. Tapered toward the bottom, hanging down and tilted back into
    // the fist, and flattened across the palm.
    const handle = this.mesh(
      new THREE.CylinderGeometry(0.0185, 0.0125, HANDLE_LENGTH, 18, 1),
      BODY_COLOR,
    )
    handle.position.set(0, -HANDLE_LENGTH / 2 + 0.004, 0)
    handle.scale.x = HANDLE_SQUASH
    const handleWrap = new THREE.Group()
    handleWrap.rotation.x = HANDLE_TILT
    handleWrap.position.z = 0.004
    handleWrap.add(handle)
    this.group.add(handleWrap)

    // --- Faceplate: the disc the thumb works, wider than the grip and angled
    // back toward the user, which is what tells the two apart at a glance.
    const face = new THREE.Group()
    face.position.set(0, 0.014, 0.002)
    face.rotation.x = 0.3
    this.group.add(face)

    const plate = this.mesh(
      new THREE.CylinderGeometry(FACE_RADIUS, FACE_RADIUS * 0.9, 0.011, 26, 1),
      FACE_COLOR,
    )
    face.add(plate)

    // Hand-coloured rim. This is the part you identify a controller by across
    // the room, so it is unlit — a lit ring goes dark whenever the hand turns
    // away from the key light, which is most of the time.
    this.accent = this.unlitMesh(
      new THREE.TorusGeometry(FACE_RADIUS * 0.98, 0.0022, 8, 32),
      new THREE.Color(1, 1, 1),
    )
    this.accent.rotation.x = Math.PI / 2
    face.add(this.accent)

    // --- Thumbstick, forward on the plate where a thumb naturally sits.
    this.stickPivot.position.set(0, 0.006, -0.009)
    face.add(this.stickPivot)
    const socket = this.mesh(new THREE.CylinderGeometry(0.0085, 0.009, 0.004, 16, 1), PART_COLOR)
    socket.position.y = 0.001
    face.add(socket)
    const shaft = this.mesh(new THREE.CylinderGeometry(0.0042, 0.005, 0.009, 12, 1), STICK_COLOR)
    shaft.position.y = 0.0045
    this.stickPivot.add(shaft)
    this.stickCap = this.mesh(new THREE.CylinderGeometry(0.0088, 0.007, 0.004, 16, 1), STICK_COLOR)
    this.stickCap.position.y = 0.011
    this.stickPivot.add(this.stickCap)
    // The lamp in the cap's face is what says "past the dead zone" — see
    // xrControllerPose.ts on why the tilt alone deliberately does not.
    this.stickLamp = this.unlitMesh(new THREE.CircleGeometry(0.0055, 20), IDLE_LAMP)
    this.stickLamp.rotation.x = -Math.PI / 2
    this.stickLamp.position.y = 0.0131
    this.stickPivot.add(this.stickLamp)

    // --- Trigger, on the front of the handle under the index finger.
    this.triggerPivot.position.set(0, -0.012, -0.014)
    this.group.add(this.triggerPivot)
    const triggerBody = this.mesh(new THREE.BoxGeometry(0.016, 0.022, 0.007), PART_COLOR)
    triggerBody.position.set(0, -0.011, -0.002)
    this.triggerPivot.add(triggerBody)
    this.triggerLamp = this.unlitMesh(new THREE.PlaneGeometry(0.012, 0.016), IDLE_LAMP)
    this.triggerLamp.position.set(0, -0.011, -0.0061)
    this.triggerPivot.add(this.triggerLamp)

    // --- Grip button, on the inner face where the middle finger closes. Home
    // position is set by setHand, which is when we learn which side is inner.
    this.squeezePad = this.mesh(new THREE.BoxGeometry(0.006, 0.03, 0.016), PART_COLOR)
    this.group.add(this.squeezePad)
    this.squeezeLamp = this.unlitMesh(new THREE.PlaneGeometry(0.004, 0.024), IDLE_LAMP)
    this.group.add(this.squeezeLamp)

    // --- Face buttons, behind the stick.
    this.primaryButton = this.mesh(
      new THREE.CylinderGeometry(0.0052, 0.0052, 0.0028, 14, 1),
      PART_COLOR,
    )
    this.primaryButton.position.set(-0.011, 0.008, 0.012)
    face.add(this.primaryButton)
    this.secondaryButton = this.mesh(
      new THREE.CylinderGeometry(0.0052, 0.0052, 0.0028, 14, 1),
      PART_COLOR,
    )
    this.secondaryButton.position.set(0.011, 0.008, 0.012)
    face.add(this.secondaryButton)

    this.badge = new XrControllerBadge()
    this.badge.group.position.set(0, 0.062, 0.012)
    this.group.add(this.badge.group)

    this.apply(restPose())
  }

  /** Colour and mirror for the hand this turned out to be. */
  setHand(hand: XrHand, color: THREE.Color): void {
    this.hand = hand
    ;(this.accent.material as THREE.MeshBasicMaterial).color.copy(color)
    // The grip button faces the palm, which is +X on the LEFT controller and
    // −X on the right. Everything else on a Touch-style controller is
    // symmetric enough to leave alone.
    const inner = hand === 'left' ? 1 : -1
    this.squeezeHome = inner * 0.019
    this.squeezePad.position.set(this.squeezeHome, -0.026, 0.004)
    this.squeezeLamp.position.set(this.squeezeHome + inner * 0.0031, -0.026, 0.004)
    this.squeezeLamp.rotation.y = inner * (Math.PI / 2)
    this.badge.setVisible(hand === 'right')
  }

  /**
   * One frame of input. `headWorld` turns the badge to face the viewer — a
   * caption rigidly mounted to a wrist spends half of a hand's poses edge-on,
   * which is the same reason the panels billboard (xrSurface.ts).
   */
  update(
    input: XrControllerInput | null,
    badges: XrControllerBadges,
    headWorld: THREE.Vector3,
  ): void {
    this.group.visible = input !== null
    if (!input) return
    this.apply(controllerPose(input))
    if (this.hand !== 'right') return
    this.badge.set(badges.mode, badges.additive)
    this.badge.group.lookAt(headWorld)
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose()
    this.badge.dispose()
  }

  private apply(pose: XrControllerPose): void {
    this.stickPivot.rotation.set(pose.stickPitch, 0, pose.stickRoll)
    this.stickPivot.position.y = 0.006 - pose.stickDepress
    this.lamp(this.stickLamp, pose.stickLive, 0.35, 0.95, 0.45)
    this.triggerPivot.rotation.x = -pose.triggerAngle
    this.lamp(this.triggerLamp, pose.triggerPulled, 0.95, 0.8, 0.35)
    const inner = this.squeezeHome === 0 ? 0 : Math.sign(this.squeezeHome)
    this.squeezePad.position.x = this.squeezeHome - inner * pose.squeezeOffset
    this.squeezeLamp.position.x =
      this.squeezeHome + inner * 0.0031 - inner * pose.squeezeOffset
    this.lamp(this.squeezeLamp, pose.squeezeHeld, 0.45, 0.85, 1)
    this.primaryButton.position.y = 0.008 - pose.primaryDepress
    this.secondaryButton.position.y = 0.008 - pose.secondaryDepress
  }

  private lamp(mesh: THREE.Mesh, on: boolean, r: number, g: number, b: number): void {
    const material = mesh.material as THREE.MeshBasicMaterial
    if (on) material.color.setRGB(r, g, b)
    else material.color.copy(IDLE_LAMP)
  }

  private mesh(geometry: THREE.BufferGeometry, color: THREE.Color): THREE.Mesh {
    // Lit, so the body reads as a solid object under the same key light the
    // scene has; the lamps below are unlit for the opposite reason.
    const material = new THREE.MeshLambertMaterial({ color: color.clone(), fog: false })
    return this.chrome(geometry, material)
  }

  private unlitMesh(geometry: THREE.BufferGeometry, color: THREE.Color): THREE.Mesh {
    const material = new THREE.MeshBasicMaterial({ color: color.clone(), fog: false })
    return this.chrome(geometry, material)
  }

  private chrome(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.raycast = () => {}
    mesh.userData.isSelectionBox = true
    this.disposables.push(geometry, material)
    return mesh
  }
}

/**
 * The little caption over the right controller — the armed grab mode, and an
 * ADD flag while the selection modifier is held.
 *
 * Not an XrSurface: it has no widgets, takes no ray and never changes size, so
 * it is a canvas on a quad and nothing more. It repaints only when the words
 * change, the same single-entry rule the billboard label follows.
 */
class XrControllerBadge {
  readonly group = new THREE.Group()

  private readonly canvas = document.createElement('canvas')
  private readonly texture: THREE.CanvasTexture
  private readonly mesh: THREE.Mesh
  private drawn = ''

  constructor() {
    this.canvas.width = 256
    this.canvas.height = 96
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.NoColorSpace
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.04, 0.015),
      new THREE.MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        fog: false,
        // Chrome over the hand: a caption sliced by the scene it labels is
        // worse than no caption (xrSurface.ts makes the same call).
        depthTest: false,
        depthWrite: false,
      }),
    )
    this.mesh.renderOrder = 4
    this.mesh.raycast = () => {}
    this.mesh.userData.isSelectionBox = true
    this.group.add(this.mesh)
    this.paint('Move', false)
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible
  }

  set(mode: string, additive: boolean): void {
    const key = `${mode}|${additive}`
    if (key === this.drawn) return
    this.drawn = key
    this.paint(mode, additive)
  }

  dispose(): void {
    this.texture.dispose()
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
  }

  private paint(mode: string, additive: boolean): void {
    const ctx = this.canvas.getContext('2d')!
    const w = this.canvas.width
    const h = this.canvas.height
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = additive ? 'rgba(64, 96, 152, 0.95)' : 'rgba(18, 18, 26, 0.9)'
    ctx.fillRect(0, 0, w, h)
    ctx.strokeStyle = additive ? 'rgba(180, 210, 255, 0.95)' : 'rgba(120, 130, 160, 0.8)'
    ctx.lineWidth = 4
    ctx.strokeRect(2, 2, w - 4, h - 4)
    ctx.fillStyle = '#e8ecf6'
    ctx.font = '600 48px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(additive ? `${mode} +add` : mode, w / 2, h / 2 + 2)
    this.texture.needsUpdate = true
  }
}
