// OrbitControls, taught to write the camera-smoothing GOAL instead of the
// rendered camera.
//
// On the desktop every navigation gesture is viewport code, so making it glide
// was a matter of pointing each handler at `_cam_goal_*` (81f28e1). Here orbit,
// pan and wheel zoom belong to three's OrbitControls, which reads the live
// camera at the top of every `update()` and writes it back at the bottom —
// there is no goal for a gesture to accumulate into.
//
// So the goal is handed to OrbitControls for the duration of its own update
// and taken back afterwards:
//
//   1. `adopt` — when nothing is gliding, the goal takes the camera's current
//      state, which is what keeps every direct camera write (fitCameraTo, a
//      camera preset, the follow pivot) working exactly as before.
//   2. The camera is set to the goal, so the drag's delta accumulates onto
//      where the user has aimed rather than onto the lagging eye. Without this
//      the goal would only ever lead the actual by one frame's delta and the
//      camera would simply lose gain — no glide, no coast to rest.
//   3. `super.update()` applies the gesture, and the goal it hands back is
//      compared with the one it was given: that is the difference between a
//      real drag and the once-a-frame update the animation loop makes, which
//      must not be mistaken for a gesture (an unsmoothed gesture HALTS a
//      glide, and a per-frame no-op doing that would defeat the feature
//      entirely). OrbitControls' own `update()` return value cannot answer
//      this — it reports whether the CAMERA moved since the last call, which
//      is also true every frame of a manual combo drag, whose goal this method
//      is handing over rather than producing.
//   4. The new goal is read back, and the rendered camera restored to the
//      lagging actual — unless this gesture is one smoothing does not cover,
//      in which case the goal IS the camera and the glide ends here (the
//      desktop's `_settle_camera` → `_finish_camera_glide`).
//
// With tau = 0 the whole class steps aside on the first line, so the default
// path through OrbitControls is untouched, floating-point noise included.
//
// One consequence worth stating: the goal is a rig, and a rig has no
// representation for the up-vector singularity, so while smoothing is ON an
// orbit stops one degree short of the pole. That is the same ±89° limit the
// desktop's camera has always had, and the one this app's own Left+Right combo
// drag already imposes; only a plain OrbitControls drag could previously go
// all the way over.

import type * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { eyeFromRig, rigFromView, type OrbitRig } from './cameraMode'
import { CameraSmoothing, copyRig } from './cameraSmoothing'

export class SmoothOrbitControls extends OrbitControls {
  // Not initialised until after super() returns, and the base constructor
  // calls update() before that — hence the guard at the top of update().
  smoothing!: CameraSmoothing
  /** Camera Mode is never smoothed (cameraSmoothing.ts says why), and while it
   *  is on these controls are disabled anyway — but `update()` still runs from
   *  the animation loop, so the mode has to be visible in here. */
  private isFlying!: () => boolean

  constructor(
    camera: THREE.Camera,
    domElement: HTMLElement,
    smoothing: CameraSmoothing,
    isFlying: () => boolean = () => false,
  ) {
    super(camera, domElement)
    this.smoothing = smoothing
    this.isFlying = isFlying
  }

  /** The rendered camera, decomposed into the orbit rig — null while the eye
   *  sits exactly on the pivot, which has no angles to ease. */
  cameraRig(): OrbitRig | null {
    const p = this.object.position
    return rigFromView([p.x, p.y, p.z], [this.target.x, this.target.y, this.target.z])
  }

  /** Put a rig onto the rendered camera. `lookAt` because the rig carries no
   *  orientation of its own: the camera always faces its pivot, up is world-Z
   *  app-wide, and nothing here ever rolls. */
  applyRig(rig: OrbitRig) {
    const [ex, ey, ez] = eyeFromRig(rig)
    this.object.position.set(ex, ey, ez)
    this.target.set(rig.target[0], rig.target[1], rig.target[2])
    this.object.lookAt(this.target)
  }

  override update(deltaTime?: number | null): boolean {
    const smoothing = this.smoothing
    // Off, flying, still inside the base constructor, or a degenerate rig:
    // the original controls, unmodified.
    if (!smoothing || smoothing.tau <= 0 || this.isFlying()) return super.update(deltaTime)
    const actual = this.cameraRig()
    if (!actual) return super.update(deltaTime)

    smoothing.adopt(actual)
    const handed = copyRig(smoothing.goal)
    this.applyRig(handed)
    const changed = super.update(deltaTime)
    const reached = this.cameraRig()
    if (reached) smoothing.goal = copyRig(reached)
    const gestured = reached !== null && !this.sameView(handed, reached)

    // A gesture smoothing does not cover lands instantly, and takes any glide
    // already in progress with it — leaving the camera where super.update()
    // just put it does both at once. Jeff's note on the desktop commit: the
    // resulting "a left-click halts a glide" behaviour is emergent and wanted.
    if (gestured && !smoothing.covers(false, this.isFlying())) return changed
    this.applyRig(actual)
    return changed
  }

  /** Whether two rigs describe the same view — eye and pivot both — to within
   *  the float noise of one decompose/recompose round trip. The threshold is
   *  relative to the arm length, and the smallest real gesture (one pixel of
   *  orbit at 0.4°) moves the eye some seven orders of magnitude further. */
  private sameView(a: OrbitRig, b: OrbitRig): boolean {
    const tol = Math.max(a.distance, b.distance, 1) * 1e-9
    const ends = [eyeFromRig(a), a.target, eyeFromRig(b), b.target]
    for (let i = 0; i < 3; i++) {
      if (Math.abs(ends[0][i] - ends[2][i]) > tol) return false
      if (Math.abs(ends[1][i] - ends[3][i]) > tol) return false
    }
    return true
  }
}
