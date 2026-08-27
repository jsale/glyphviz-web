import { describe, expect, it } from 'vitest'
import { GRAB_ON_THRESHOLD, STICK_DEADZONE, TRIGGER_THRESHOLD } from './xrNav'
import {
  BUTTON_TRAVEL_M,
  SQUEEZE_TRAVEL_M,
  STICK_DEPRESS_M,
  STICK_MAX_TILT_RAD,
  TRIGGER_MAX_RAD,
  controllerPose,
  restPose,
  type XrControllerInput,
} from './xrControllerPose'

function input(over: Partial<XrControllerInput> = {}): XrControllerInput {
  return {
    stickX: 0,
    stickY: 0,
    trigger: 0,
    squeeze: 0,
    stickClick: false,
    primary: false,
    secondary: false,
    ...over,
  }
}

describe('controllerPose', () => {
  it('rests at zero', () => {
    const pose = restPose()
    // toBeCloseTo, not toBe: −1 × 0 is −0, which Object.is separates from 0 and
    // which means nothing at all to a rotation.
    expect(pose.stickPitch).toBeCloseTo(0, 12)
    expect(pose.stickRoll).toBeCloseTo(0, 12)
    expect(pose.stickDepress).toBe(0)
    expect(pose.triggerAngle).toBe(0)
    expect(pose.squeezeOffset).toBe(0)
    expect(pose.stickLive).toBe(false)
    expect(pose.triggerPulled).toBe(false)
    expect(pose.squeezeHeld).toBe(false)
  })

  it('tips the stick away from the viewer when it is pushed forward', () => {
    // Pushing away is +stickY in the OpenXR sign xrSession converts to; the
    // stick's own axis is +Y, so it has to rotate about X toward −Z, which is a
    // NEGATIVE angle. Getting this backwards is invisible in a unit test unless
    // the sign is stated, so it is stated.
    expect(controllerPose(input({ stickY: 1 })).stickPitch).toBeCloseTo(-STICK_MAX_TILT_RAD, 12)
    expect(controllerPose(input({ stickY: -1 })).stickPitch).toBeCloseTo(STICK_MAX_TILT_RAD, 12)
    expect(controllerPose(input({ stickX: 1 })).stickRoll).toBeCloseTo(-STICK_MAX_TILT_RAD, 12)
    expect(controllerPose(input({ stickX: -1 })).stickRoll).toBeCloseTo(STICK_MAX_TILT_RAD, 12)
  })

  it('is linear in deflection', () => {
    expect(controllerPose(input({ stickY: 0.5 })).stickPitch).toBeCloseTo(
      -0.5 * STICK_MAX_TILT_RAD,
      12,
    )
  })

  it('gates a diagonal to the unit circle', () => {
    // A raw diagonal reads √2; the model must not tip further on a diagonal
    // than it does at full throw on one axis.
    const pose = controllerPose(input({ stickX: 1, stickY: 1 }))
    const tilt = Math.hypot(pose.stickPitch, pose.stickRoll)
    expect(tilt).toBeCloseTo(STICK_MAX_TILT_RAD, 12)
    // …and the direction survives the gate.
    expect(pose.stickPitch).toBeCloseTo(pose.stickRoll, 12)
  })

  it('leaves an in-gate diagonal alone', () => {
    const pose = controllerPose(input({ stickX: 0.6, stickY: 0.6 }))
    expect(pose.stickRoll).toBeCloseTo(-0.6 * STICK_MAX_TILT_RAD, 12)
  })

  it('shows raw deflection inside the dead zone, and says it is not live', () => {
    // The whole point of the indicator: inside the dead zone the stick still
    // MOVES on screen, which is what tells the user the app is reading them.
    const inside = controllerPose(input({ stickY: STICK_DEADZONE * 0.5 }))
    expect(inside.stickPitch).not.toBe(0)
    expect(inside.stickLive).toBe(false)
    expect(controllerPose(input({ stickY: STICK_DEADZONE + 0.01 })).stickLive).toBe(true)
  })

  it('measures the dead zone on the vector, not per axis', () => {
    const each = STICK_DEADZONE * 0.8
    expect(controllerPose(input({ stickX: each })).stickLive).toBe(false)
    // Two in-dead-zone axes together are past it, exactly as flyStep sees them.
    expect(controllerPose(input({ stickX: each, stickY: each })).stickLive).toBe(true)
  })

  it('sweeps the trigger and marks the pick threshold', () => {
    expect(controllerPose(input({ trigger: 1 })).triggerAngle).toBeCloseTo(TRIGGER_MAX_RAD, 12)
    expect(controllerPose(input({ trigger: TRIGGER_THRESHOLD - 0.01 })).triggerPulled).toBe(false)
    expect(controllerPose(input({ trigger: TRIGGER_THRESHOLD })).triggerPulled).toBe(true)
  })

  it('presses the grip and marks the grab threshold', () => {
    expect(controllerPose(input({ squeeze: 1 })).squeezeOffset).toBeCloseTo(SQUEEZE_TRAVEL_M, 12)
    expect(controllerPose(input({ squeeze: GRAB_ON_THRESHOLD })).squeezeHeld).toBe(false)
    expect(controllerPose(input({ squeeze: GRAB_ON_THRESHOLD + 0.01 })).squeezeHeld).toBe(true)
  })

  it('depresses the buttons', () => {
    expect(controllerPose(input({ stickClick: true })).stickDepress).toBe(STICK_DEPRESS_M)
    expect(controllerPose(input({ primary: true })).primaryDepress).toBe(BUTTON_TRAVEL_M)
    expect(controllerPose(input({ secondary: true })).secondaryDepress).toBe(BUTTON_TRAVEL_M)
  })

  it('clamps values a misbehaving gamepad could send', () => {
    const pose = controllerPose(input({ trigger: 4, squeeze: -2 }))
    expect(pose.triggerAngle).toBeCloseTo(TRIGGER_MAX_RAD, 12)
    expect(pose.squeezeOffset).toBe(0)
  })
})
