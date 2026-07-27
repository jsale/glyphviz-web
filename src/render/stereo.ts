// Cross-eye free-view stereo — the desktop's `Viewport.stereo_mode`, ported.
//
// The scene is drawn TWICE into the same canvas, side by side, each half from a
// laterally offset camera. Crossing your eyes fuses the pair into one 3D image,
// which needs no glasses and no headset — the reason GlyphViz has it at all.
//
// Because the eyes converge by CROSSING, the image meant for the RIGHT eye goes
// on the screen's LEFT half and vice versa (the opposite of parallel /
// "wall-eyed" viewing). That single fact is what `stereoEyes` encodes.
//
// Two pieces of the desktop's `_setup_stereo_eye_matrices` matter and are
// reproduced exactly:
//
//  1. Both eyes SHARE one orientation. The eye is displaced along the camera's
//     own right axis and nothing is re-aimed. The desktop arrived at this after
//     a version that gave each eye its own gluLookAt: two slightly different
//     forward vectors destabilise differently as the camera orbits toward the
//     pole (gluLookAt's basis comes from cross(forward, up), which collapses
//     there), and the halves visibly twist against each other. Sharing the
//     orientation removes the failure mode outright — whatever the single-eye
//     camera does at the pole, both eyes now do identically.
//
//  2. Convergence comes from an OFF-AXIS (asymmetric) frustum, not from toe-in.
//     Each eye's frustum centre is shifted by `-offset · near / distance`, which
//     puts zero parallax exactly at the orbit target: the thing you are looking
//     at sits in the screen plane, nearer nodes float out toward you, farther
//     ones sit behind the screen. Toe-in would fuse the target too, but at the
//     cost of vertical parallax toward the frame edges, which is what makes a
//     free-viewed pair tiring.
//
// Separation is a PERCENTAGE of the orbit distance (desktop
// `stereo_separation_pct`, default 3%, slider 0.5–15%), so the depth effect
// stays put as the camera zooms rather than flattening out at range and
// exploding up close.

import * as THREE from 'three'

/** Desktop `stereo_separation_pct` default and its slider's range. */
export const STEREO_SEP_DEFAULT_PCT = 3.0
export const STEREO_SEP_MIN_PCT = 0.5
export const STEREO_SEP_MAX_PCT = 15.0

/** One half of the split viewport, and the camera offset that fills it. */
export interface StereoEye {
  /** Left edge of this half, in CSS pixels from the canvas's left edge. */
  x: number
  /** Width of this half, in CSS pixels. */
  width: number
  /**
   * Lateral camera displacement in world units along the camera's right axis
   * (desktop `lateral_offset`). POSITIVE on the screen-left half: displacing
   * the camera to its right is the RIGHT eye's view, which is where a
   * cross-eyed viewer's right eye is looking.
   */
  lateralOffset: number
}

/** World-unit eye separation at this orbit distance (desktop paintGL's `sep`). */
export function stereoSeparation(distance: number, separationPct: number): number {
  return distance * (separationPct / 100)
}

/**
 * The two screen halves, screen-left first.
 *
 * Integer split with the odd pixel going to the RIGHT half, matching the
 * desktop's `half_w = w // 2; right_w = w - half_w`. Returns null for a
 * viewport too narrow to split, where the caller should draw mono — the
 * desktop's `stereo_mode and w >= 2` guard.
 */
export function stereoEyes(width: number, separation: number): [StereoEye, StereoEye] | null {
  const w = Math.floor(width)
  if (w < 2) return null
  const halfW = Math.floor(w / 2)
  return [
    { x: 0, width: halfW, lateralOffset: +separation / 2 },
    { x: halfW, width: w - halfW, lateralOffset: -separation / 2 },
  ]
}

/** Which half a canvas-relative x lands in — the half a click has to pick in. */
export function eyeForX(eyes: readonly [StereoEye, StereoEye], x: number): StereoEye {
  return x < eyes[1].x ? eyes[0] : eyes[1]
}

/** Clamp a separation percentage to the slider's range. */
export function clampSeparationPct(pct: number): number {
  return Math.min(STEREO_SEP_MAX_PCT, Math.max(STEREO_SEP_MIN_PCT, pct))
}

const rightAxis = new THREE.Vector3()

/**
 * Point `out` at one eye of `main`'s view: same orientation, displaced along
 * the camera's right axis, with the off-axis frustum that converges on the
 * orbit target `distance` units ahead.
 *
 * `height` and `eye.width` give the half's aspect ratio. `out` is reused across
 * frames — nothing here allocates.
 */
export function configureEyeCamera(
  main: THREE.PerspectiveCamera,
  eye: StereoEye,
  height: number,
  distance: number,
  out: THREE.PerspectiveCamera,
): void {
  // Orientation is copied verbatim, never re-derived (see the header note).
  rightAxis.setFromMatrixColumn(main.matrixWorld, 0).normalize()
  out.up.copy(main.up)
  out.quaternion.copy(main.quaternion)
  out.position.copy(main.position).addScaledVector(rightAxis, eye.lateralOffset)
  out.fov = main.fov
  out.zoom = main.zoom
  out.near = main.near
  out.far = main.far
  out.aspect = eye.width / Math.max(height, 1)
  out.updateMatrixWorld(true)

  const near = main.near
  const halfH = (near * Math.tan((Math.PI / 180) * 0.5 * main.fov)) / main.zoom
  const halfW = halfH * out.aspect
  // The frustum shift is proportional to `near`, so it is the same ANGULAR
  // shift whatever near plane the app uses — this one sits at 0.001 where the
  // desktop's sits at 0.1, and the two produce the identical image.
  const shift = (-eye.lateralOffset * near) / Math.max(distance, 1e-6)
  out.projectionMatrix.makePerspective(
    shift - halfW,
    shift + halfW,
    halfH,
    -halfH,
    near,
    main.far,
    main.coordinateSystem,
  )
  out.projectionMatrixInverse.copy(out.projectionMatrix).invert()
}

/**
 * Re-express an eye camera's projection in FULL-CANVAS clip coordinates.
 *
 * Everything that turns a pointer position into a ray — TransformControls above
 * all — measures the pointer against the whole canvas and knows nothing about
 * the split. Mapping a half's clip x into the full canvas is a plain affine
 * squeeze (`x → s·x + t·w`), so folding it into the projection matrix gives a
 * camera that answers "what is under this pointer" for the half the pointer is
 * in, while the rendering still uses the unmapped eye camera into its viewport.
 * The two describe the same pixels by construction.
 */
export function remapProjectionToCanvas(
  camera: THREE.PerspectiveCamera,
  eye: StereoEye,
  canvasWidth: number,
): void {
  const w = Math.max(canvasWidth, 1)
  const scale = eye.width / w
  const offset = (2 * eye.x + eye.width) / w - 1
  const e = camera.projectionMatrix.elements
  // Column-major: row 0 is elements 0, 4, 8, 12; row 3 is 3, 7, 11, 15.
  e[0] = scale * e[0] + offset * e[3]
  e[4] = scale * e[4] + offset * e[7]
  e[8] = scale * e[8] + offset * e[11]
  e[12] = scale * e[12] + offset * e[15]
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
}

/**
 * The pair of cameras a stereo frame draws from, plus the pick camera.
 *
 * Held across frames so a 60 Hz loop allocates nothing; `enabled` and
 * `separationPct` are the two pieces of user state, mirroring the desktop's
 * `stereo_mode` / `stereo_separation_pct` on the viewport.
 */
export class StereoRig {
  enabled = false
  separationPct = STEREO_SEP_DEFAULT_PCT
  private readonly cameras: [THREE.PerspectiveCamera, THREE.PerspectiveCamera] = [
    new THREE.PerspectiveCamera(),
    new THREE.PerspectiveCamera(),
  ]
  /**
   * Hit-testing cameras, separate instances so a click never disturbs the two
   * the frame is drawing from — and separate from EACH OTHER because the gizmo
   * holds on to the one it was given (TransformControls keeps the reference and
   * reads it while dragging), which a raycast for a click must not rewrite.
   */
  private readonly picker = new THREE.PerspectiveCamera()
  private readonly gizmoPicker = new THREE.PerspectiveCamera()

  /** The halves for this canvas width, or null when stereo is off/too narrow. */
  eyes(width: number, distance: number): [StereoEye, StereoEye] | null {
    if (!this.enabled) return null
    return stereoEyes(width, stereoSeparation(distance, this.separationPct))
  }

  /** The camera for eye `index` (0 = screen-left), ready to render with. */
  camera(
    main: THREE.PerspectiveCamera,
    eye: StereoEye,
    height: number,
    distance: number,
    index: 0 | 1,
  ): THREE.PerspectiveCamera {
    const out = this.cameras[index]
    configureEyeCamera(main, eye, height, distance, out)
    return out
  }

  /**
   * A camera for hit-testing inside one half: the eye's view, but projecting to
   * full-canvas coordinates so ordinary canvas-relative pointer maths applies.
   */
  pickCamera(
    main: THREE.PerspectiveCamera,
    eye: StereoEye,
    width: number,
    height: number,
    distance: number,
  ): THREE.PerspectiveCamera {
    configureEyeCamera(main, eye, height, distance, this.picker)
    remapProjectionToCanvas(this.picker, eye, width)
    return this.picker
  }

  /**
   * The same thing for the transform gizmo, which keeps the camera it is handed
   * and reads it throughout a drag: updating this one in place (rather than
   * assigning a new camera per pointer move) leaves an in-progress drag alone.
   */
  gizmoCamera(
    main: THREE.PerspectiveCamera,
    eye: StereoEye,
    width: number,
    height: number,
    distance: number,
  ): THREE.PerspectiveCamera {
    configureEyeCamera(main, eye, height, distance, this.gizmoPicker)
    remapProjectionToCanvas(this.gizmoPicker, eye, width)
    return this.gizmoPicker
  }
}
