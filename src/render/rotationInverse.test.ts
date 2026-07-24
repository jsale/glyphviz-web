import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../gv/types'
import { RotationMode } from '../gv/types'
import { localRotationMatrix } from './rotation'
import { invertLocalRotation } from './rotationInverse'

const MODES = [
  ['HTR', RotationMode.HeadingTiltRoll],
  ['EulerXYZ', RotationMode.EulerXYZ],
] as const

function expectSameRotation(a: THREE.Matrix4, b: THREE.Matrix4, tol = 1e-9) {
  for (let i = 0; i < 16; i++) {
    expect(a.elements[i]).toBeCloseTo(b.elements[i], -Math.log10(tol))
  }
}

/** Deterministic pseudo-random angles (no seed dependency needed). */
function* sampleAngles(count: number): Generator<Vec3> {
  let s = 12345
  const next = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return (s / 0x7fffffff) * 720 - 360 // (−360°, 360°)
  }
  for (let i = 0; i < count; i++) {
    yield { x: next(), y: next(), z: next() }
  }
}

describe.each(MODES)('invertLocalRotation (%s)', (_name, mode) => {
  it('recovers the exact angles when prev equals the truth', () => {
    for (const truth of sampleAngles(200)) {
      const m = localRotationMatrix(truth.x, truth.y, truth.z, mode)
      const got = invertLocalRotation(m, truth, mode)
      expect(got.x).toBeCloseTo(truth.x, 7)
      expect(got.y).toBeCloseTo(truth.y, 7)
      expect(got.z).toBeCloseTo(truth.z, 7)
    }
  })

  it('round-trips the matrix when prev is only near the truth', () => {
    for (const truth of sampleAngles(200)) {
      const m = localRotationMatrix(truth.x, truth.y, truth.z, mode)
      // A previous tick a few degrees away, as during a live drag.
      const prev = { x: truth.x - 2.5, y: truth.y + 3.1, z: truth.z - 1.7 }
      const got = invertLocalRotation(m, prev, mode)
      const back = localRotationMatrix(got.x, got.y, got.z, mode)
      expectSameRotation(m, back)
      // Continuity: the recovered angles stay near the previous tick.
      expect(Math.abs(got.x - prev.x)).toBeLessThan(180)
      expect(Math.abs(got.y - prev.y)).toBeLessThan(180)
      expect(Math.abs(got.z - prev.z)).toBeLessThan(180)
    }
  })

  it('unwraps to the nearest 360°-equivalent of prev', () => {
    const truth = { x: 20, y: 30, z: 40 }
    const m = localRotationMatrix(truth.x, truth.y, truth.z, mode)
    const got = invertLocalRotation(m, { x: 380 - 3, y: 30 - 720 + 2, z: 40 }, mode)
    expect(got.x).toBeCloseTo(380, 7)
    expect(got.y).toBeCloseTo(30 - 720, 7)
    expect(got.z).toBeCloseTo(40, 7)
  })
})

describe('HTR gimbal policy (tilt ≈ 0/180)', () => {
  it('holds roll and gives the drag to heading at tilt 0', () => {
    // rx = 0 → M = Rz(−ry−rz): only heading+roll is defined.
    const m = localRotationMatrix(0, 30, 50, RotationMode.HeadingTiltRoll)
    const got = invertLocalRotation(m, { x: 0, y: 10, z: 50 }, RotationMode.HeadingTiltRoll)
    expect(got.z).toBe(50) // roll held exactly
    expect(got.x).toBeCloseTo(0, 7)
    expect(got.y).toBeCloseTo(30, 7)
  })

  it('keeps the composite rotation exact at tilt 0 even with a stale roll', () => {
    const m = localRotationMatrix(0, 30, 50, RotationMode.HeadingTiltRoll)
    // Previous roll differs → heading must absorb the difference.
    const got = invertLocalRotation(m, { x: 0, y: 10, z: 20 }, RotationMode.HeadingTiltRoll)
    expect(got.z).toBe(20)
    const back = localRotationMatrix(got.x, got.y, got.z, RotationMode.HeadingTiltRoll)
    expectSameRotation(m, back)
  })

  it('round-trips at tilt 180', () => {
    const m = localRotationMatrix(180, 20, 40, RotationMode.HeadingTiltRoll)
    const got = invertLocalRotation(m, { x: 180, y: 5, z: 40 }, RotationMode.HeadingTiltRoll)
    expect(got.z).toBe(40)
    expect(got.x).toBeCloseTo(180, 7)
    const back = localRotationMatrix(got.x, got.y, got.z, RotationMode.HeadingTiltRoll)
    expectSameRotation(m, back)
  })

  it('keeps a negative tilt negative (branch continuity)', () => {
    const truth = { x: -30, y: 25, z: -40 }
    const m = localRotationMatrix(truth.x, truth.y, truth.z, RotationMode.HeadingTiltRoll)
    const got = invertLocalRotation(m, { x: -28, y: 24, z: -41 }, RotationMode.HeadingTiltRoll)
    expect(got.x).toBeCloseTo(-30, 7)
    expect(got.y).toBeCloseTo(25, 7)
    expect(got.z).toBeCloseTo(-40, 7)
  })
})

describe('Euler gimbal policy (pitch ≈ ±90)', () => {
  it('holds roll and recovers rx at pitch +90', () => {
    const m = localRotationMatrix(25, 90, 35, RotationMode.EulerXYZ)
    const got = invertLocalRotation(m, { x: 0, y: 80, z: 35 }, RotationMode.EulerXYZ)
    expect(got.z).toBe(35)
    expect(got.y).toBeCloseTo(90, 7)
    const back = localRotationMatrix(got.x, got.y, got.z, RotationMode.EulerXYZ)
    expectSameRotation(m, back)
  })

  it('round-trips at pitch −90 with a stale roll', () => {
    const m = localRotationMatrix(25, -90, 35, RotationMode.EulerXYZ)
    const got = invertLocalRotation(m, { x: 20, y: -85, z: 10 }, RotationMode.EulerXYZ)
    expect(got.z).toBe(10)
    const back = localRotationMatrix(got.x, got.y, got.z, RotationMode.EulerXYZ)
    expectSameRotation(m, back)
  })

  it('reaches pitch angles outside ±90 via the second branch', () => {
    const truth = { x: 10, y: 120, z: 20 }
    const m = localRotationMatrix(truth.x, truth.y, truth.z, RotationMode.EulerXYZ)
    const got = invertLocalRotation(m, { x: 8, y: 118, z: 22 }, RotationMode.EulerXYZ)
    expect(got.x).toBeCloseTo(10, 7)
    expect(got.y).toBeCloseTo(120, 7)
    expect(got.z).toBeCloseTo(20, 7)
  })
})
