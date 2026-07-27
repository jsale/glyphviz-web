import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  clampSeparationPct,
  configureEyeCamera,
  eyeForX,
  remapProjectionToCanvas,
  stereoEyes,
  stereoSeparation,
  StereoRig,
  STEREO_SEP_DEFAULT_PCT,
} from './stereo'
import type { StereoEye } from './stereo'

const CANVAS_W = 1200
const CANVAS_H = 800
const DISTANCE = 40

/** A camera orbiting the origin at DISTANCE, Z-up like every GlyphViz scene. */
function mainCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(60, CANVAS_W / CANVAS_H, 0.001, 10000)
  camera.up.set(0, 0, 1)
  camera.position.set(DISTANCE * 0.6, -DISTANCE * 0.7, DISTANCE * 0.39)
  camera.position.setLength(DISTANCE)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)
  return camera
}

/**
 * Where a world point lands in canvas pixels, given the eye it is drawn from
 * and the half that eye fills — the projection the renderer's viewport applies.
 */
function screenX(camera: THREE.PerspectiveCamera, eye: StereoEye, point: THREE.Vector3): number {
  const ndc = point.clone().project(camera)
  return eye.x + ((ndc.x + 1) / 2) * eye.width
}

describe('stereoEyes', () => {
  it('splits the canvas with the odd pixel on the right, like the desktop', () => {
    const [left, right] = stereoEyes(1201, 2)!
    expect(left).toMatchObject({ x: 0, width: 600 })
    expect(right).toMatchObject({ x: 600, width: 601 })
  })

  it('puts the RIGHT eye on the screen-left half (cross-eye, not parallel)', () => {
    const [left, right] = stereoEyes(CANVAS_W, 2)!
    // Displacing the camera to its own right is the right eye's viewpoint.
    expect(left.lateralOffset).toBeCloseTo(+1, 12)
    expect(right.lateralOffset).toBeCloseTo(-1, 12)
  })

  it('draws mono below two pixels of width', () => {
    expect(stereoEyes(1, 2)).toBeNull()
    expect(stereoEyes(0, 2)).toBeNull()
  })

  it('scales separation with the orbit distance', () => {
    expect(stereoSeparation(40, STEREO_SEP_DEFAULT_PCT)).toBeCloseTo(1.2, 12)
    expect(stereoSeparation(4000, STEREO_SEP_DEFAULT_PCT)).toBeCloseTo(120, 12)
  })

  it('clamps the separation to the slider range', () => {
    expect(clampSeparationPct(0.1)).toBe(0.5)
    expect(clampSeparationPct(99)).toBe(15)
    expect(clampSeparationPct(3)).toBe(3)
  })

  it('maps a canvas x to the half it falls in', () => {
    const eyes = stereoEyes(CANVAS_W, 2)!
    expect(eyeForX(eyes, 0)).toBe(eyes[0])
    expect(eyeForX(eyes, 599)).toBe(eyes[0])
    expect(eyeForX(eyes, 600)).toBe(eyes[1])
    expect(eyeForX(eyes, 1199)).toBe(eyes[1])
  })
})

describe('configureEyeCamera', () => {
  const main = mainCamera()
  const eyes = stereoEyes(CANVAS_W, stereoSeparation(DISTANCE, STEREO_SEP_DEFAULT_PCT))!
  const cams = eyes.map((eye) => {
    const cam = new THREE.PerspectiveCamera()
    configureEyeCamera(main, eye, CANVAS_H, DISTANCE, cam)
    return cam
  }) as [THREE.PerspectiveCamera, THREE.PerspectiveCamera]

  it('shares one orientation and separates along the camera right axis', () => {
    for (const cam of cams) expect(cam.quaternion.angleTo(main.quaternion)).toBeCloseTo(0, 12)
    const offset = cams[0].position.clone().sub(cams[1].position)
    expect(offset.length()).toBeCloseTo(stereoSeparation(DISTANCE, STEREO_SEP_DEFAULT_PCT), 10)
    const right = new THREE.Vector3().setFromMatrixColumn(main.matrixWorld, 0).normalize()
    expect(offset.normalize().dot(right)).toBeCloseTo(1, 10)
    // Each eye sits half a separation off the shared camera position.
    for (const cam of cams) {
      expect(cam.position.distanceTo(main.position)).toBeCloseTo(
        stereoSeparation(DISTANCE, STEREO_SEP_DEFAULT_PCT) / 2,
        10,
      )
    }
  })

  it('converges at the orbit target: zero parallax there', () => {
    const target = new THREE.Vector3(0, 0, 0)
    expect(screenX(cams[0], eyes[0], target) - eyes[0].x).toBeCloseTo(
      screenX(cams[1], eyes[1], target) - eyes[1].x,
      9,
    )
  })

  it('crosses the parallax for near points and uncrosses it for far ones', () => {
    const toCamera = main.position.clone().normalize()
    const near = toCamera.clone().multiplyScalar(DISTANCE * 0.5) // half way to the camera
    const far = toCamera.clone().multiplyScalar(-DISTANCE * 0.5) // behind the target
    // Cross-eye: a NEARER point's screen-left copy sits left of its
    // screen-right copy (negative/crossed parallax), so the fused image floats
    // out of the screen toward the viewer. A farther point does the opposite.
    expect(screenX(cams[0], eyes[0], near) - eyes[0].x).toBeLessThan(
      screenX(cams[1], eyes[1], near) - eyes[1].x,
    )
    expect(screenX(cams[0], eyes[0], far) - eyes[0].x).toBeGreaterThan(
      screenX(cams[1], eyes[1], far) - eyes[1].x,
    )
  })

  it('keeps vertical placement identical between the eyes (no vertical parallax)', () => {
    // What toe-in would break: an off-centre point must land at the same height
    // in both halves, or the pair is tiring to free-view.
    for (const p of [
      new THREE.Vector3(6, 3, 9),
      new THREE.Vector3(-8, 5, -4),
      new THREE.Vector3(2, -7, 1),
    ]) {
      const a = p.clone().project(cams[0]).y
      const b = p.clone().project(cams[1]).y
      expect(a).toBeCloseTo(b, 9)
    }
  })

  it('matches the mono camera exactly at zero separation', () => {
    const cam = new THREE.PerspectiveCamera()
    const full: StereoEye = { x: 0, width: CANVAS_W, lateralOffset: 0 }
    configureEyeCamera(main, full, CANVAS_H, DISTANCE, cam)
    const p = new THREE.Vector3(7, -3, 2)
    const mono = p.clone().project(main)
    const eye = p.clone().project(cam)
    expect(eye.x).toBeCloseTo(mono.x, 9)
    expect(eye.y).toBeCloseTo(mono.y, 9)
  })
})

describe('remapProjectionToCanvas', () => {
  it('projects to the same canvas pixel the viewport draws the point at', () => {
    const main = mainCamera()
    const eyes = stereoEyes(CANVAS_W, stereoSeparation(DISTANCE, STEREO_SEP_DEFAULT_PCT))!
    const rig = new StereoRig()
    rig.enabled = true

    for (const [index, eye] of eyes.entries()) {
      const drawn = rig.camera(main, eye, CANVAS_H, DISTANCE, index as 0 | 1)
      const pick = new THREE.PerspectiveCamera()
      configureEyeCamera(main, eye, CANVAS_H, DISTANCE, pick)
      remapProjectionToCanvas(pick, eye, CANVAS_W)

      for (const p of [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(9, 4, -6),
        new THREE.Vector3(-11, -2, 3),
      ]) {
        const viaViewport = screenX(drawn, eye, p)
        const ndc = p.clone().project(pick)
        expect(((ndc.x + 1) / 2) * CANVAS_W).toBeCloseTo(viaViewport, 8)
        // Vertically the remap changes nothing.
        expect(ndc.y).toBeCloseTo(p.clone().project(drawn).y, 9)
      }
    }
  })
})

describe('StereoRig', () => {
  it('yields no halves while disabled', () => {
    const rig = new StereoRig()
    expect(rig.eyes(CANVAS_W, DISTANCE)).toBeNull()
    rig.enabled = true
    expect(rig.eyes(CANVAS_W, DISTANCE)).not.toBeNull()
  })

  it('reuses its cameras across frames', () => {
    const rig = new StereoRig()
    rig.enabled = true
    const main = mainCamera()
    const eyes = rig.eyes(CANVAS_W, DISTANCE)!
    const first = rig.camera(main, eyes[0], CANVAS_H, DISTANCE, 0)
    const second = rig.camera(main, eyes[0], CANVAS_H, DISTANCE, 0)
    expect(second).toBe(first)
    expect(rig.camera(main, eyes[1], CANVAS_H, DISTANCE, 1)).not.toBe(first)
  })
})
