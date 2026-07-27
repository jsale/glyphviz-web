import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  AMBIENT_INTENSITY,
  applyDesktopColorPipeline,
  GL_LIGHT_EYE_DIRECTION,
  glShadedComponent,
  KEY_INTENSITY,
  SceneLighting,
} from './lighting'

/**
 * What three's Lambert shader computes for one albedo component, given the
 * light intensities the rig sets.
 *
 * From `lights_lambert_pars_fragment` + `BRDF_Lambert`:
 *   directDiffuse   = max(N·L, 0) · lightColor · albedo / π
 *   indirectDiffuse = ambientColor · albedo / π
 * where each `…Color` uniform is the light's colour times its intensity
 * (WebGLLights applies no other scale since r155). Output clamps at 1 with
 * NoToneMapping.
 */
function threeShadedComponent(albedo: number, nDotL: number): number {
  const ambient = (AMBIENT_INTENSITY / Math.PI) * albedo
  const direct = (KEY_INTENSITY / Math.PI) * Math.max(nDotL, 0) * albedo
  return Math.min(ambient + direct, 1)
}

describe('desktop light rig', () => {
  it('reproduces fixed-function GL shading through three’s π-divided BRDF', () => {
    for (const albedo of [0, 0.1, 0.25, 0.5, 0.784, 1]) {
      for (const nDotL of [-1, -0.2, 0, 0.15, 0.5, 0.8, 1]) {
        expect(threeShadedComponent(albedo, nDotL)).toBeCloseTo(
          glShadedComponent(albedo, nDotL),
          12,
        )
      }
    }
  })

  it('keeps half the albedo on a face the key light never reaches', () => {
    // GL_LIGHT_MODEL_AMBIENT (0.2) + GL_LIGHT0's GL_AMBIENT (0.3).
    expect(glShadedComponent(1, -1)).toBeCloseTo(0.5, 12)
    expect(glShadedComponent(0.6, 0)).toBeCloseTo(0.3, 12)
  })

  it('saturates anything facing the light, the way GL clamps a fragment', () => {
    // 0.5 + 0.8 > 1, so a bright glyph reads as flat colour rather than a ball.
    expect(glShadedComponent(1, 0.8)).toBe(1)
    expect(glShadedComponent(0.784, 0.8)).toBe(1)
    // Dimmer albedos still shade normally.
    expect(glShadedComponent(0.4, 0.5)).toBeCloseTo(0.4, 12)
  })
})

describe('SceneLighting.update', () => {
  const eye = new THREE.Vector3(...GL_LIGHT_EYE_DIRECTION).normalize()

  function lightDirectionInEyeSpace(camera: THREE.Camera): THREE.Vector3 {
    // What three's WebGLLights hands the shader: (light − target), rotated
    // into view space.
    const world = new THREE.Vector3()
      .setFromMatrixPosition(light.key.matrixWorld)
      .sub(new THREE.Vector3().setFromMatrixPosition(light.key.target.matrixWorld))
      .normalize()
    camera.updateMatrixWorld()
    return world.applyMatrix3(new THREE.Matrix3().setFromMatrix4(camera.matrixWorldInverse))
  }

  const scene = new THREE.Scene()
  const light = new SceneLighting(scene)

  it('adds both lights to the scene at the ported intensities', () => {
    expect(scene.children).toContain(light.ambient)
    expect(scene.children).toContain(light.key)
    expect(light.ambient.intensity).toBeCloseTo(0.5 * Math.PI, 12)
    expect(light.key.intensity).toBeCloseTo(Math.PI, 12)
  })

  it('holds the key light at eye-space (1, 2, 1) from any camera', () => {
    const camera = new THREE.PerspectiveCamera(60, 1, 0.001, 1000)
    camera.up.set(0, 0, 1)
    for (const position of [
      new THREE.Vector3(0, -10, 0),
      new THREE.Vector3(120, 30, -40),
      new THREE.Vector3(-3, 0.5, 900),
    ]) {
      camera.position.copy(position)
      camera.lookAt(0, 0, 0)
      camera.updateMatrixWorld()
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert()
      light.update(camera)

      const direction = lightDirectionInEyeSpace(camera)
      expect(direction.x).toBeCloseTo(eye.x, 6)
      expect(direction.y).toBeCloseTo(eye.y, 6)
      expect(direction.z).toBeCloseTo(eye.z, 6)
    }
  })
})

describe('applyDesktopColorPipeline', () => {
  it('drops the sRGB output transfer so raw CSV colours reach the framebuffer', () => {
    // A bare object stands in for the renderer: constructing a real
    // WebGLRenderer needs a GL context, which this suite has no business
    // requiring to check two assignments.
    const renderer = {
      outputColorSpace: THREE.SRGBColorSpace,
      toneMapping: THREE.ACESFilmicToneMapping,
    } as THREE.WebGLRenderer
    applyDesktopColorPipeline(renderer)
    expect(renderer.outputColorSpace).toBe(THREE.LinearSRGBColorSpace)
    expect(renderer.toneMapping).toBe(THREE.NoToneMapping)
  })
})
