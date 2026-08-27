// The pointing laser and its reticle — what you aim a wrist panel with.
//
// The bug this exists to fix (Jeff, 2026-08-27): you could not see where the
// ray was pointing, only that a button had lit. That was not a subtlety, it was
// two decisions meeting badly. Panels draw with `depthTest: false` and
// `renderOrder = 5` (xrSurface.ts — a depth-tested panel gets sliced into
// pieces when you fly inside a scene, which is exactly when you reach for it),
// while the old ray was a plain Line at renderOrder 0. And the ray is SHORTENED
// to its hit distance, so it terminated precisely at the surface that then
// painted over it. The last centimetre — the only part that says where you are
// pointing — was the guaranteed-invisible one.
//
// So two things here:
//
//   THE BEAM  is a tapered tube that fades in from the hand, and while it is
//             on a panel it takes the panel's own depth treatment one order
//             LATER, so it lands ON the panel instead of behind it. Aimed into
//             the scene it goes back to ordinary depth testing, so it does not
//             streak across the glyphs it is pointed at.
//
//   THE RETICLE is a ring lying on the surface at the hit point, which is the
//             piece that makes aiming BETWEEN widgets legible — previously the
//             only feedback was a button highlighting, so the gap between two
//             buttons was indistinguishable from missing the panel entirely.
//             It reports four states: on the surface, on a live widget, on a
//             disabled one, and pressed.

import * as THREE from 'three'

/** What a pointer target reports when a ray lands on it. */
export interface XrPointerHit {
  /** Distance along the ray, in WORLD units (the rig's scale still applies). */
  distance: number
  /** Hit point, world space. */
  point: THREE.Vector3
  /** Unit surface normal at the hit, world space. */
  normal: THREE.Vector3
  /** What is under the pointer — the reticle says which. */
  target: 'surface' | 'widget' | 'disabled'
}

/** Ray length in metres when it hits nothing — enough to cross a 20 m scene. */
export const RAY_LENGTH_M = 30

/** Beam radius at the hand and at the tip. Kept slim: the base is the end
 *  nearest your eye, so a millimetre there covers far more of the view than a
 *  millimetre at the far end does. */
const BEAM_BASE_R = 0.003
const BEAM_TIP_R = 0.0012
/** Alpha at the hand and at the tip: a beam that is solid at the origin hides
 *  the controller it comes out of. */
const BEAM_ALPHA_NEAR = 0.1
const BEAM_ALPHA_FAR = 0.75

const RETICLE_INNER = 0.0058
const RETICLE_OUTER = 0.008
const RETICLE_DOT = 0.0024
/** Lifted off the surface so the ring never argues with the panel's own pixels
 *  — belt and braces, since both draw with depth testing off. */
const RETICLE_LIFT_M = 0.0015

const DISABLED_COLOR = new THREE.Color(0.45, 0.46, 0.52)
const PRESSED_COLOR = new THREE.Color(1, 0.95, 0.62)

/**
 * One hand's pointer. The beam hangs off the controller's TARGET RAY space (so
 * it is aimed by construction); the reticle hangs off the RIG, because it is
 * placed at a world hit point and the rig is the frame whose local units are
 * perceived metres.
 */
export class XrPointer {
  private readonly beam: THREE.Mesh
  private readonly beamMaterial: THREE.MeshBasicMaterial
  private readonly reticle = new THREE.Group()
  private readonly ring: THREE.Mesh
  private readonly ringMaterial: THREE.MeshBasicMaterial
  private readonly dot: THREE.Mesh
  private readonly dotMaterial: THREE.MeshBasicMaterial
  private readonly rig: THREE.Object3D
  private readonly color = new THREE.Color(1, 1, 1)

  private readonly tmpPoint = new THREE.Vector3()
  private readonly tmpNormal = new THREE.Vector3()
  private readonly tmpQuat = new THREE.Quaternion()

  constructor(ray: THREE.Object3D, rig: THREE.Object3D) {
    this.rig = rig

    this.beamMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      fog: false,
    })
    this.beam = new THREE.Mesh(beamGeometry(), this.beamMaterial)
    this.beam.raycast = () => {}
    this.beam.userData.isSelectionBox = true // chrome: never takes a blend mode
    ray.add(this.beam)

    this.ringMaterial = reticleMaterial()
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(RETICLE_INNER, RETICLE_OUTER, 28),
      this.ringMaterial,
    )
    this.dotMaterial = reticleMaterial()
    this.dot = new THREE.Mesh(new THREE.CircleGeometry(RETICLE_DOT, 18), this.dotMaterial)
    for (const mesh of [this.ring, this.dot]) {
      mesh.raycast = () => {}
      mesh.userData.isSelectionBox = true
      // Above the panels (5) so the aim point is never the thing that gets
      // covered — which is the whole complaint this module answers.
      mesh.renderOrder = 7
      this.reticle.add(mesh)
    }
    this.reticle.visible = false
    rig.add(this.reticle)
  }

  /** The hand's own colour, so left and right pointers are told apart. */
  setColor(color: THREE.Color): void {
    this.color.copy(color)
    this.beamMaterial.color.copy(color)
  }

  /** Hide everything — a hand that has gone away, or a session that has ended. */
  setActive(active: boolean): void {
    this.beam.visible = active
    if (!active) this.reticle.visible = false
  }

  /**
   * One frame. `hit` is what the ray landed on (null = nothing but scene),
   * `pressed` whether the trigger is down on this hand, and `rigScale` the
   * world-units-per-metre this frame — the hit distance is in world units and
   * the beam is drawn in metres.
   */
  update(hit: XrPointerHit | null, pressed: boolean, rigScale: number): void {
    if (!this.beam.visible) return
    if (!hit) {
      this.beam.scale.z = RAY_LENGTH_M
      // Back to ordinary depth testing: a beam aimed into the scene has no
      // business drawing over the glyphs it is aimed at.
      this.beamMaterial.depthTest = true
      this.beam.renderOrder = 0
      this.beamMaterial.opacity = 1
      this.reticle.visible = false
      return
    }

    this.beam.scale.z = Math.max(0.02, hit.distance / rigScale)
    // On a panel the beam adopts the panel's own treatment, one order later, so
    // the tip lands ON the surface rather than behind it.
    this.beamMaterial.depthTest = false
    this.beam.renderOrder = 6
    this.beamMaterial.opacity = 1

    // World hit → rig space, where one unit is one perceived metre and the
    // reticle's dimensions above mean what they say.
    this.tmpPoint.copy(hit.point)
    this.rig.worldToLocal(this.tmpPoint)
    this.rig.getWorldQuaternion(this.tmpQuat).invert()
    this.tmpNormal.copy(hit.normal).applyQuaternion(this.tmpQuat).normalize()
    this.reticle.position.copy(this.tmpPoint).addScaledVector(this.tmpNormal, RETICLE_LIFT_M)
    this.reticle.quaternion.setFromUnitVectors(FORWARD, this.tmpNormal)
    this.reticle.visible = true

    const live = hit.target === 'widget'
    const disabled = hit.target === 'disabled'
    const scale = pressed && live ? 0.78 : live ? 1.2 : 1
    this.reticle.scale.setScalar(scale)
    if (pressed && live) this.ringMaterial.color.copy(PRESSED_COLOR)
    else if (disabled) this.ringMaterial.color.copy(DISABLED_COLOR)
    else this.ringMaterial.color.copy(this.color)
    this.ringMaterial.opacity = live ? 1 : 0.65
    // The dot appears only over something pressable, so "there is a control
    // here" and "you are on the panel but between controls" are different
    // pictures rather than the same one.
    this.dot.visible = live
    this.dotMaterial.color.copy(pressed ? PRESSED_COLOR : this.color)
  }

  dispose(): void {
    this.beam.geometry.dispose()
    this.beamMaterial.dispose()
    this.ring.geometry.dispose()
    this.ringMaterial.dispose()
    this.dot.geometry.dispose()
    this.dotMaterial.dispose()
  }
}

const FORWARD = new THREE.Vector3(0, 0, 1)

function reticleMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    // Same argument as the panel it lies on, and it has to win against it:
    // an aim point occluded by the thing you are aiming at is no aim point.
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  })
}

/**
 * A unit-length tapered tube down −Z, carrying its fade in a 4-component vertex
 * colour so the taper survives `scale.z` (which stretches the length and leaves
 * the radii alone).
 */
function beamGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(BEAM_TIP_R, BEAM_BASE_R, 1, 10, 1, true)
  // +Y → −Z, then slide so the tube spans z = 0 (hand) to z = −1 (tip).
  geometry.rotateX(-Math.PI / 2)
  geometry.translate(0, 0, -0.5)
  const position = geometry.getAttribute('position')
  const colors = new Float32Array(position.count * 4)
  for (let i = 0; i < position.count; i++) {
    const t = Math.min(1, Math.max(0, -position.getZ(i)))
    colors[i * 4] = 1
    colors[i * 4 + 1] = 1
    colors[i * 4 + 2] = 1
    colors[i * 4 + 3] = BEAM_ALPHA_NEAR + (BEAM_ALPHA_FAR - BEAM_ALPHA_NEAR) * t
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4))
  return geometry
}
