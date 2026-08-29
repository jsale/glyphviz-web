// The blink's black shell: a small sphere carried on the camera that fades the
// whole view out and back in while a long focus hop jumps (render/xrFocus.ts
// says why a long hop is a blink rather than a dash).
//
// A sphere rather than a quad because a headset's per-eye frustums are wide,
// off-axis and not the app's own — anything meant to cover "the view" has to
// cover every direction the compositor might sample, and a shell around the eye
// does that by construction at any field of view. Parented to the CAMERA, so its
// radius is in the same perceived metres its position is: the camera hangs off
// the XR rig, whose scale is world-units-per-metre, and a child of the camera
// inherits that scaling exactly as the head pose does.

import * as THREE from 'three'

/**
 * Shell radius in perceived metres. Comfortably outside the session's 0.05 m
 * near plane, and close enough that no scene geometry can ever get between it
 * and the eye — though depth testing is off anyway, since the whole job is to
 * be in front of everything.
 */
const FADE_RADIUS_M = 0.25

/** Above the wrist panels (5) and their pointer beams, which draw over the
 *  scene themselves — a fade that left the chrome showing would not be one. */
const FADE_RENDER_ORDER = 100

export class XrFade {
  readonly mesh: THREE.Mesh

  private readonly material: THREE.MeshBasicMaterial
  private opacity = 0

  constructor() {
    this.material = new THREE.MeshBasicMaterial({
      color: 0x000000,
      side: THREE.BackSide,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      // Chrome is exempt from the scene's fog and blend modes, the rule the
      // halos and the gizmo already follow — a fog-tinted blackout is not black.
      fog: false,
    })
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(FADE_RADIUS_M, 12, 8), this.material)
    this.mesh.renderOrder = FADE_RENDER_ORDER
    // Its bounding sphere contains the eye, so culling could only ever be wrong
    // about it; and it must survive the render-mode walk untouched.
    this.mesh.frustumCulled = false
    this.mesh.userData.isChrome = true
    this.mesh.visible = false
  }

  /** 0 = clear, 1 = fully black. Hidden outright at 0, so the shell costs
   *  nothing at all on the frames — nearly all of them — that are not fading. */
  set(opacity: number): void {
    const value = Math.min(1, Math.max(0, opacity))
    if (value === this.opacity) return
    this.opacity = value
    this.material.opacity = value
    this.mesh.visible = value > 0
  }

  get value(): number {
    return this.opacity
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    this.material.dispose()
  }
}
