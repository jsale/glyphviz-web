import { describe, expect, it } from 'vitest'
import {
  FIT_DOWN_M,
  FIT_FORWARD_M,
  FIT_TARGET_M,
  MOVE_SPEED_MPS,
  TURN_SPEED_RAD,
  deadzone,
  fitRig,
  flyStep,
  headYawOf,
  identityRig,
  oneHandDrag,
  rigApply,
  rigBasisApply,
  solveNav,
  twoHandDrag,
  vec3,
  type HeadPose,
  type Vec3,
  type XrRigState,
} from './xrNav'

const CLOSE = 1e-12

function expectVec(actual: Vec3, expected: Vec3, tol = CLOSE) {
  expect(actual.x).toBeCloseTo(expected.x, -Math.log10(tol))
  expect(actual.y).toBeCloseTo(expected.y, -Math.log10(tol))
  expect(actual.z).toBeCloseTo(expected.z, -Math.log10(tol))
}

/** Head at the XR origin, facing −Z (the direction a viewer starts out facing). */
function headFacingZ(position = vec3(0, 1.6, 0)): HeadPose {
  return { position, forward: vec3(0, 0, -1), right: vec3(1, 0, 0) }
}

describe('rig basis', () => {
  it('sends XR up to world up and XR forward to world +Y', () => {
    expectVec(rigBasisApply(vec3(0, 1, 0), 0, 1), vec3(0, 0, 1))
    expectVec(rigBasisApply(vec3(0, 0, -1), 0, 1), vec3(0, 1, 0))
    expectVec(rigBasisApply(vec3(1, 0, 0), 0, 1), vec3(1, 0, 0))
  })

  it('scales metres into world units', () => {
    expectVec(rigBasisApply(vec3(0, 2, 0), 0, 20), vec3(0, 0, 40))
  })

  it('yaws about world up, leaving the up component alone', () => {
    const turned = rigBasisApply(vec3(0, 1, -1), Math.PI / 2, 1)
    expectVec(turned, vec3(-1, 0, 1))
  })

  it('round-trips through solveNav', () => {
    const state: XrRigState = { nav: vec3(3, -4, 5), yaw: 0.7, scale: 12 }
    const xrPoint = vec3(0.4, 1.5, -0.9)
    const world = rigApply(state, xrPoint)
    expectVec(solveNav(world, xrPoint, state.yaw, state.scale), state.nav)
  })
})

describe('deadzone', () => {
  it('is zero inside and ramps from the edge', () => {
    expect(deadzone(0.1)).toBe(0)
    expect(deadzone(-0.15)).toBe(0)
    expect(deadzone(0.15 + 1e-9)).toBeCloseTo(0, 6)
    expect(deadzone(1)).toBeCloseTo(1, 12)
    expect(deadzone(-1)).toBeCloseTo(-1, 12)
    expect(deadzone(0.575)).toBeCloseTo(0.5, 12)
  })
})

describe('flyStep', () => {
  const still = { leftX: 0, leftY: 0, rightX: 0, rightY: 0 }

  it('does nothing with the sticks centred', () => {
    const state: XrRigState = { nav: vec3(1, 2, 3), yaw: 0.3, scale: 7 }
    expect(flyStep(state, still, headFacingZ(), 0.016)).toBe(state)
  })

  it('flies forward along the head-look direction at the desktop speed', () => {
    const state: XrRigState = { ...identityRig(), scale: 10 }
    const next = flyStep(state, { ...still, leftY: 1 }, headFacingZ(), 1)
    // 3 m/s for one second, at 10 world units per metre, along world +Y.
    expectVec(next.nav, vec3(0, MOVE_SPEED_MPS * 10, 0), 1e-9)
    expect(next.yaw).toBe(0)
    expect(next.scale).toBe(10)
  })

  it('is plane-locked: looking down does not sink the viewer', () => {
    const head: HeadPose = {
      position: vec3(0, 1.6, 0),
      forward: vec3(0, -0.8, -0.6),
      right: vec3(1, 0, 0),
    }
    const next = flyStep(identityRig(), { ...still, leftY: 1 }, head, 1)
    expect(next.nav.z).toBeCloseTo(0, 12)
    expect(next.nav.y).toBeCloseTo(MOVE_SPEED_MPS, 9)
  })

  it('rises on the right stick, along world up', () => {
    const next = flyStep(identityRig(), { ...still, rightY: 1 }, headFacingZ(), 0.5)
    expectVec(next.nav, vec3(0, 0, MOVE_SPEED_MPS * 0.5), 1e-9)
  })

  it('turns right at the desktop rate', () => {
    const next = flyStep(identityRig(), { ...still, rightX: 1 }, headFacingZ(), 1)
    expect(next.yaw).toBeCloseTo(-TURN_SPEED_RAD, 12)
  })

  it('pivots the turn about the head, not the tracking origin', () => {
    // A viewer standing well away from the XR origin: the world under their
    // head must not move as they turn.
    const state: XrRigState = { nav: vec3(10, -20, 3), yaw: 0.4, scale: 15 }
    const head = headFacingZ(vec3(2.5, 1.7, -1.25))
    const before = rigApply(state, head.position)
    const next = flyStep(state, { ...still, rightX: 0.8 }, head, 0.1)
    expect(next.yaw).not.toBeCloseTo(state.yaw, 6)
    expectVec(rigApply(next, head.position), before, 1e-9)
  })
})

describe('grab-drag', () => {
  it('keeps the grabbed world point under the hand', () => {
    const state: XrRigState = { nav: vec3(4, 5, 6), yaw: 1.1, scale: 25 }
    const anchorHand = vec3(0.2, 1.2, -0.4)
    const grabbed = rigApply(state, anchorHand)
    const moved = oneHandDrag({ state, hand: anchorHand }, vec3(0.5, 1.4, -0.7))
    expectVec(rigApply(moved, vec3(0.5, 1.4, -0.7)), grabbed, 1e-9)
    expect(moved.yaw).toBe(state.yaw)
    expect(moved.scale).toBe(state.scale)
  })

  it('translates by the hand delta, in world units', () => {
    const state: XrRigState = { ...identityRig(), scale: 10 }
    const moved = oneHandDrag({ state, hand: vec3(0, 0, 0) }, vec3(0, 0.5, 0))
    // Pulling the hand up 0.5 m drags the world up with it, so the rig drops.
    expectVec(moved.nav, vec3(0, 0, -5), 1e-9)
  })
})

describe('two-handed pinch', () => {
  const anchorLeft = vec3(-0.2, 1.2, -0.5)
  const anchorRight = vec3(0.2, 1.2, -0.5)
  const state: XrRigState = { nav: vec3(1, 2, 3), yaw: 0.25, scale: 20 }
  const anchor = { state, left: anchorLeft, right: anchorRight }

  it('halves the world units per metre when the hands double their spread', () => {
    const next = twoHandDrag(anchor, vec3(-0.4, 1.2, -0.5), vec3(0.4, 1.2, -0.5))
    expect(next.scale).toBeCloseTo(10, 9)
    expect(next.yaw).toBeCloseTo(state.yaw, 12)
  })

  it('pins the world point between the hands through a scale', () => {
    const mid0 = vec3(0, 1.2, -0.5)
    const pinned = rigApply(state, mid0)
    const next = twoHandDrag(anchor, vec3(-0.4, 1.2, -0.5), vec3(0.4, 1.2, -0.5))
    expectVec(rigApply(next, mid0), pinned, 1e-9)
  })

  it('turns the world with the hands, about the same pinned midpoint', () => {
    // Rotate both hands a quarter turn about XR up, spread unchanged.
    const left = vec3(0, 1.2, -0.7)
    const right = vec3(0, 1.2, -0.3)
    const next = twoHandDrag(anchor, left, right)
    expect(next.scale).toBeCloseTo(state.scale, 9)
    expect(next.yaw - state.yaw).toBeCloseTo(Math.PI / 2, 9)
    const mid = vec3(0, 1.2, -0.5)
    expectVec(rigApply(next, mid), rigApply(state, mid), 1e-9)
  })

  it('holds still when a hand pose collapses onto the other', () => {
    const next = twoHandDrag(anchor, vec3(0, 1, 0), vec3(0, 1, 0))
    expect(next).toBe(state)
  })
})

describe('fitRig', () => {
  const center = vec3(100, -50, 20)
  const extent = 400

  it('sizes the scene to the target span', () => {
    const rig = fitRig({ center, extent, headPos: vec3(0, 1.6, 0), headYaw: 0 })
    expect(rig.scale).toBeCloseTo(extent / FIT_TARGET_M, 12)
  })

  it('places the centre forward of and below the head', () => {
    const headPos = vec3(0, 1.6, 0)
    const rig = fitRig({ center, extent, headPos, headYaw: 0 })
    // The scene centre must land at the XR point the placement asks for.
    const expected = vec3(0, 1.6 - FIT_DOWN_M, -FIT_FORWARD_M)
    expectVec(rigApply(rig, expected), center, 1e-6)
  })

  it('follows the head heading, so the scene is always in front', () => {
    const headPos = vec3(3, 1.7, -2)
    const headYaw = 1.9
    const rig = fitRig({ center, extent, headPos, headYaw })
    const sin = Math.sin(headYaw)
    const cos = Math.cos(headYaw)
    const target = vec3(
      headPos.x - FIT_FORWARD_M * sin,
      headPos.y - FIT_DOWN_M,
      headPos.z - FIT_FORWARD_M * cos,
    )
    expectVec(rigApply(rig, target), center, 1e-6)
  })

  it('puts the scene the same way round whichever way the viewer faces', () => {
    // World +Y maps onto the viewer's own forward at any heading.
    for (const headYaw of [0, 1.2, -2.4, Math.PI]) {
      const rig = fitRig({ center, extent, headPos: vec3(0, 1.6, 0), headYaw })
      const forwardXr = vec3(-Math.sin(headYaw), 0, -Math.cos(headYaw))
      const worldDir = rigBasisApply(forwardXr, rig.yaw, 1)
      expectVec(worldDir, vec3(0, 1, 0), 1e-9)
      expect(headYawOf(forwardXr)).toBeCloseTo(headYaw, 9)
    }
  })

  it('survives an empty scene', () => {
    const rig = fitRig({ center: vec3(), extent: 0, headPos: vec3(0, 1.6, 0), headYaw: 0 })
    expect(rig.scale).toBe(1)
  })
})
