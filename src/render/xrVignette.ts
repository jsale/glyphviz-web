// The comfort vignette: a tunnel that narrows the field of view while the
// viewer is moving. The rules and the numbers live in xrComfort.ts (pure); this
// is the shell that draws it.
//
// PER-EYE EXACT, which is the one thing worth getting right here. The darkening
// is a function of the angle from the eye's own forward axis, computed in VIEW
// space in the fragment shader — and view space in an immersive frame is per
// eye, since three renders each of the session's views with its own matrices.
// So each eye gets an aperture centred on its own optical axis, at any
// interpupillary distance and under the off-axis frustums a headset actually
// uses.
//
// The alternative — baking a radial gradient into geometry or a texture on a
// shell around the head — puts ONE aperture between the two eyes, which each eye
// then sees offset by half the IPD. At a shell close enough to be cheap that is
// several degrees of mismatch on a soft edge the two eyes are trying to fuse,
// which is its own kind of unpleasant. A dozen lines of GLSL avoids the whole
// question, and the sphere's radius stops mattering at all.

import * as THREE from 'three'
import type { VignetteAperture } from './xrComfort'

/**
 * Shell radius, in perceived metres. A child of the camera lands in view space
 * at exactly its local coordinates, so this only has to clear the session's
 * 0.05 m near plane and stay well inside the far one — the shading does not
 * depend on it.
 */
const SHELL_RADIUS_M = 1

/** Under the blink's blackout (100), over the wrist panels (5) and their
 *  pointer beams: a narrowed field of view narrows what you can see of the
 *  chrome too, which is what a field of view IS. */
const VIGNETTE_RENDER_ORDER = 90

const VERTEX_SHADER = /* glsl */ `
varying vec3 vViewPosition;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewPosition = mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`

const FRAGMENT_SHADER = /* glsl */ `
uniform float uInner;
uniform float uOuter;
uniform float uAlpha;
varying vec3 vViewPosition;
void main() {
  // The eye looks down -Z in its OWN view space, so this angle is measured from
  // each eye's gaze independently.
  float angle = acos(clamp(-normalize(vViewPosition).z, -1.0, 1.0));
  float alpha = smoothstep(uInner, uOuter, angle) * uAlpha;
  // The clear centre costs nothing rather than blending black at zero alpha
  // across most of the frame, every frame a viewer is moving.
  if (alpha <= 0.002) discard;
  gl_FragColor = vec4(0.0, 0.0, 0.0, alpha);
}
`

export class XrVignette {
  readonly mesh: THREE.Mesh

  private readonly material: THREE.ShaderMaterial

  constructor() {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uInner: { value: Math.PI },
        uOuter: { value: Math.PI },
        uAlpha: { value: 0 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      side: THREE.BackSide,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })
    // Enough segments that the SILHOUETTE is round; the gradient itself is
    // per-fragment, so the tessellation never shows in it.
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(SHELL_RADIUS_M, 24, 16), this.material)
    this.mesh.renderOrder = VIGNETTE_RENDER_ORDER
    // Its bounding sphere contains the eye, so culling could only be wrong
    // about it; and it must survive the render-mode walk untouched.
    this.mesh.frustumCulled = false
    this.mesh.userData.isChrome = true
    this.mesh.visible = false
  }

  /** Null closes it away entirely — a viewer standing still pays nothing. */
  set(aperture: VignetteAperture | null): void {
    if (!aperture) {
      this.mesh.visible = false
      return
    }
    this.mesh.visible = true
    this.material.uniforms.uInner.value = aperture.inner
    this.material.uniforms.uOuter.value = aperture.outer
    this.material.uniforms.uAlpha.value = aperture.alpha
  }

  /** The current aperture, for the drive harness — nothing else can see it. */
  get aperture(): VignetteAperture | null {
    if (!this.mesh.visible) return null
    return {
      inner: this.material.uniforms.uInner.value as number,
      outer: this.material.uniforms.uOuter.value as number,
      alpha: this.material.uniforms.uAlpha.value as number,
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    this.material.dispose()
  }
}
