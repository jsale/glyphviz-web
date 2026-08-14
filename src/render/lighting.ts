// The desktop's fixed-function light rig, ported exactly.
//
// GlyphViz's viewport sets its lighting once in `initializeGL` and never
// touches it again:
//
//     glEnable(GL_LIGHTING); glEnable(GL_LIGHT0)
//     glLightfv(GL_LIGHT0, GL_DIFFUSE,  [1, 1, 1, 1])
//     glLightfv(GL_LIGHT0, GL_AMBIENT,  [0.3, 0.3, 0.3, 1])
//     glLightfv(GL_LIGHT0, GL_SPECULAR, [0.5, 0.5, 0.5, 1])
//     glLightfv(GL_LIGHT0, GL_POSITION, [1, 2, 1, 0])
//     glEnable(GL_COLOR_MATERIAL)
//     glColorMaterial(GL_FRONT_AND_BACK, GL_AMBIENT_AND_DIFFUSE)
//
// Three facts fall out of that, and together they are the whole difference
// between how the two apps colour a glyph:
//
//  1. The node's colour drives BOTH the ambient and the diffuse material term,
//     and the app never calls `glMaterialfv`, so the specular MATERIAL stays
//     at its default black — GL_SPECULAR above contributes nothing. The shaded
//     value is therefore
//
//         out = C · (ambient_model + ambient_light + diffuse_light · N·L)
//             = C · (0.2 + 0.3 + 1.0 · max(N·L, 0))         clamped to 1
//
//     GL_LIGHT_MODEL_AMBIENT is never overridden, so it holds GL's own 0.2
//     default. Half the albedo is present before any light reaches a face, and
//     anything facing the light at all saturates — which is why desktop glyphs
//     read as flat, vivid colour rather than a shaded ball.
//
//  2. GL_POSITION's w is 0 (directional) and it is specified while the
//     modelview is still identity, so the direction is captured in EYE space:
//     the key light is bolted to the camera, up and to the right, and glyph
//     shading does not change as the scene is orbited.
//
//  3. Fixed-function GL knows nothing of colour spaces. A node's CSV byte
//     value lands in the framebuffer as-is; the multiply above happens on
//     sRGB-encoded numbers. Three's default pipeline instead treats material
//     colours as linear and encodes the result to sRGB on the way out, which
//     lifts every midtone. `applyDesktopColorPipeline` turns that off — see
//     its comment.
//
// Three divides by π in `BRDF_Lambert` and (since r155) takes light intensity
// in physical units, so the GL coefficients have to be scaled by π to come out
// the other side unchanged. That is the only arithmetic here; everything else
// is the numbers above.

import * as THREE from 'three'

/** GL's default GL_LIGHT_MODEL_AMBIENT, which the desktop never overrides. */
export const GL_MODEL_AMBIENT = 0.2
/** GL_LIGHT0's GL_AMBIENT. */
export const GL_LIGHT_AMBIENT = 0.3
/** GL_LIGHT0's GL_DIFFUSE. */
export const GL_LIGHT_DIFFUSE = 1.0
/** GL_LIGHT0's GL_POSITION, w = 0 — a direction, in EYE space. */
export const GL_LIGHT_EYE_DIRECTION: readonly [number, number, number] = [1, 2, 1]

/** Three intensity for the combined ambient terms (0.2 + 0.3), π-scaled. */
export const AMBIENT_INTENSITY = (GL_MODEL_AMBIENT + GL_LIGHT_AMBIENT) * Math.PI
/** Three intensity for the key light, π-scaled. */
export const KEY_INTENSITY = GL_LIGHT_DIFFUSE * Math.PI

/**
 * The desktop's shaded value for one albedo component at a given N·L, clamped
 * the way GL clamps a fragment. Reference for the parity test; the renderer
 * reproduces it through the light rig below.
 */
export function glShadedComponent(albedo: number, nDotL: number): number {
  const factor = GL_MODEL_AMBIENT + GL_LIGHT_AMBIENT + GL_LIGHT_DIFFUSE * Math.max(nDotL, 0)
  return Math.min(albedo * factor, 1)
}

/**
 * Ambient + key light matching GlyphViz's `initializeGL`.
 *
 * The key is directional and camera-relative, so `update` has to run once per
 * frame before the render. The light and its target stay OUT of the scene
 * graph (their world matrices are written here) — parenting them to the camera
 * would work too, but only by putting the camera into the scene, where every
 * traversal the app already does would have to start ignoring it.
 */
export class SceneLighting {
  readonly ambient = new THREE.AmbientLight(0xffffff, AMBIENT_INTENSITY)
  readonly key = new THREE.DirectionalLight(0xffffff, KEY_INTENSITY)

  private readonly eyeDirection = new THREE.Vector3(...GL_LIGHT_EYE_DIRECTION).normalize()
  private readonly worldDirection = new THREE.Vector3()

  constructor(scene: THREE.Scene) {
    scene.add(this.ambient)
    scene.add(this.key)
  }

  /**
   * Re-aim the key light along eye-space (1, 2, 1) for this frame's camera.
   *
   * Takes any Object3D carrying the eye's position and orientation, not a
   * Camera: in an immersive session the scene camera's own transform is the
   * head pose in XR space, so the aim comes from a world-space proxy the rig
   * keeps (xrSession.ts) rather than from the camera itself.
   */
  update(camera: THREE.Object3D): void {
    // Three reads a directional light's direction as (light − target) in world
    // space, so both ends move with the camera and only their difference — the
    // eye-space direction rotated into the world — carries any meaning.
    this.worldDirection.copy(this.eyeDirection).applyQuaternion(camera.quaternion)
    this.key.target.position.copy(camera.position)
    this.key.position.copy(camera.position).add(this.worldDirection)
    // Neither object is in the scene graph, so nothing else will update these.
    this.key.target.updateMatrixWorld()
    this.key.updateMatrixWorld()
  }
}

/**
 * Render straight into the framebuffer, the way fixed-function GL does.
 *
 * Three's default is a managed pipeline: material colours are working-space
 * (linear) values and the shader encodes the result to sRGB on output. The
 * desktop has no such stage — a colour of 128 is written as 128 — so the
 * encode has to go, or every shaded value comes out lighter here than there.
 * Turning the output transfer off leaves the raw multiply, which is exactly
 * the fixed-function result.
 *
 * The drawing buffer is still an sRGB one; only the OETF the shader would
 * apply is dropped. Texture colour spaces are set to match in
 * `textureLibrary.ts` — a decoded-to-linear map under a raw output would be
 * the same mismatch in the other direction.
 */
export function applyDesktopColorPipeline(renderer: THREE.WebGLRenderer): void {
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace
  // NoToneMapping is the default; naming it is what guarantees the clamp GL
  // does — a tone mapper would roll off the saturated highlights that make a
  // desktop glyph read as flat colour.
  renderer.toneMapping = THREE.NoToneMapping
}
