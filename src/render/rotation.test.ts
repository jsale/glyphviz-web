import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { eulerXyzMatrix, headingTiltRollMatrix, localRotationMatrix } from './rotation'
import { RotationMode } from '../gv/types'

function apply(m: THREE.Matrix4, v: [number, number, number]): [number, number, number] {
  const out = new THREE.Vector3(...v).applyMatrix4(m)
  return [out.x, out.y, out.z]
}

function expectVec(actual: [number, number, number], expected: [number, number, number]) {
  for (let i = 0; i < 3; i++) expect(actual[i]).toBeCloseTo(expected[i], 10)
}

describe('headingTiltRollMatrix (ANTz Z-X-Z, rotation_mode 1)', () => {
  it('is the identity at zero angles', () => {
    expectVec(apply(headingTiltRollMatrix(0, 0, 0), [1, 2, 3]), [1, 2, 3])
  })

  it('rotate_y (heading) spins about Z with inverted sign: Rz(−90)·X = −Y', () => {
    expectVec(apply(headingTiltRollMatrix(0, 90, 0), [1, 0, 0]), [0, -1, 0])
  })

  it('rotate_x tilts about X with inverted sign: Rx(−90)·Y = −Z', () => {
    expectVec(apply(headingTiltRollMatrix(90, 0, 0), [0, 1, 0]), [0, 0, -1])
  })

  it('rotate_z (roll term) also spins about Z: heading and roll compound', () => {
    // rx=0 → Rz(−90)·Rz(−90) = Rz(−180)
    expectVec(apply(headingTiltRollMatrix(0, 90, 90), [1, 0, 0]), [-1, 0, 0])
  })

  it('composes heading-then-tilt in Rz(−ry)·Rx(−rx) order', () => {
    // Rx(−90)·Z = +Y, then Rz(−90)·Y = +X
    expectVec(apply(headingTiltRollMatrix(90, 90, 0), [0, 0, 1]), [1, 0, 0])
  })
})

describe('eulerXyzMatrix (GlyphViz Euler, rotation_mode 0)', () => {
  it('rotate_x follows the right-hand rule: Rx(90)·Y = +Z', () => {
    expectVec(apply(eulerXyzMatrix(90, 0, 0), [0, 1, 0]), [0, 0, 1])
  })

  it('rotate_y rotates about Y (which HTR cannot): Ry(90)·Z = +X', () => {
    expectVec(apply(eulerXyzMatrix(0, 90, 0), [0, 0, 1]), [1, 0, 0])
  })

  it('composes Rx·Ry·Rz (Z applied to the vector first)', () => {
    // Rz(90)·X = +Y, then Rx(90)·Y = +Z
    expectVec(apply(eulerXyzMatrix(90, 0, 90), [1, 0, 0]), [0, 0, 1])
  })
})

describe('localRotationMatrix dispatch', () => {
  it('selects the convention per rotation_mode', () => {
    expectVec(
      apply(localRotationMatrix(0, 90, 0, RotationMode.EulerXYZ), [0, 0, 1]),
      [1, 0, 0],
    )
    expectVec(
      apply(localRotationMatrix(0, 90, 0, RotationMode.HeadingTiltRoll), [0, 0, 1]),
      [0, 0, 1], // heading is a Z-spin — leaves Z alone
    )
  })
})
