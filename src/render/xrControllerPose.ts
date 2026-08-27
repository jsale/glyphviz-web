// What one controller's input values do to the moving parts of its model —
// pure, no THREE and no DOM, so it runs in plain node like xrNav.ts beside it.
//
// This is the "you can see the stick move" half of the controller. Every value
// here is a transform for exactly one part, in that part's OWN local frame, so
// the render half (xrControllerModel.ts) never has to reason about what a
// number means — it writes rotations and offsets and nothing else.
//
// The visuals show the RAW input, deliberately, not the navigation-filtered
// one: what a thumbstick indicator is for is telling you what your thumb is
// actually doing, including inside the dead zone where nothing moves. That is
// precisely the state a user needs shown, since it is the one where the app
// looks broken. `stickLive` then says whether that deflection is past
// xrNav's dead zone and has started to fly the rig — so the model teaches the
// dead zone rather than hiding it.

import { GRAB_ON_THRESHOLD, STICK_DEADZONE, TRIGGER_THRESHOLD } from './xrNav'

/** One frame of a hand's gamepad, as xrSession reads it. */
export interface XrControllerInput {
  /** Thumbstick, −1..1 each. Y is the OpenXR sign (positive = pushed away). */
  stickX: number
  stickY: number
  /** Analog, 0..1. */
  trigger: number
  squeeze: number
  /** Thumbstick pressed in. */
  stickClick: boolean
  /** A / X. */
  primary: boolean
  /** B / Y. */
  secondary: boolean
}

/** Where every moving part goes. Angles in radians, offsets in METRES. */
export interface XrControllerPose {
  /** Stick tilt about its own X (from stickY) and Z (from stickX). */
  stickPitch: number
  stickRoll: number
  /** How far the stick has sunk into its socket (a stick CLICK). */
  stickDepress: number
  /** Deflected past xrNav's dead zone — i.e. actually flying the rig. */
  stickLive: boolean
  /** Trigger rotation about its pivot. */
  triggerAngle: number
  /** Past the pick threshold, which is the edge a trigger fires on. */
  triggerPulled: boolean
  /** Grip button travel, inward. */
  squeezeOffset: number
  /** Past the grab hysteresis's ON threshold — the world is being held. */
  squeezeHeld: boolean
  /** Face-button travel, inward. */
  primaryDepress: number
  secondaryDepress: number
}

/**
 * Tilt at full deflection. 17° is well past the ~4° a real Touch stick manages,
 * and deliberately so: this is a readout seen from 40 cm away over the top of a
 * moving hand, not a scale model. It has to be legible at a glance.
 */
export const STICK_MAX_TILT_RAD = 0.3
/** Travel of a stick CLICK, and of a face button. */
export const STICK_DEPRESS_M = 0.0018
export const BUTTON_TRAVEL_M = 0.0013
/** Trigger sweep from released to fully pulled. */
export const TRIGGER_MAX_RAD = 0.42
/** Grip button travel, inward across the palm. */
export const SQUEEZE_TRAVEL_M = 0.0035

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

/**
 * A stick's deflection, gated to the unit circle the way a real stick's gate
 * is. Without this a diagonal push reads √2 and the model tips further than it
 * can at full throw on either axis alone.
 */
function gated(x: number, y: number): { x: number; y: number; r: number } {
  const r = Math.hypot(x, y)
  if (r <= 1 || r === 0) return { x, y, r }
  return { x: x / r, y: y / r, r: 1 }
}

export function controllerPose(input: XrControllerInput): XrControllerPose {
  const stick = gated(input.stickX, input.stickY)
  const trigger = clamp01(input.trigger)
  const squeeze = clamp01(input.squeeze)
  return {
    // Both signs are negative because the stick's axis is its own +Y: a
    // rotation about +X carries +Y toward +Z, and pushing the stick AWAY has to
    // carry it toward −Z. Same argument about Z for the sideways axis.
    stickPitch: -stick.y * STICK_MAX_TILT_RAD,
    stickRoll: -stick.x * STICK_MAX_TILT_RAD,
    stickDepress: input.stickClick ? STICK_DEPRESS_M : 0,
    stickLive: stick.r > STICK_DEADZONE,
    triggerAngle: trigger * TRIGGER_MAX_RAD,
    triggerPulled: trigger >= TRIGGER_THRESHOLD,
    squeezeOffset: squeeze * SQUEEZE_TRAVEL_M,
    squeezeHeld: squeeze > GRAB_ON_THRESHOLD,
    primaryDepress: input.primary ? BUTTON_TRAVEL_M : 0,
    secondaryDepress: input.secondary ? BUTTON_TRAVEL_M : 0,
  }
}

/** The rest pose — what an unheld controller (or a disconnected one) shows. */
export function restPose(): XrControllerPose {
  return controllerPose({
    stickX: 0,
    stickY: 0,
    trigger: 0,
    squeeze: 0,
    stickClick: false,
    primary: false,
    secondary: false,
  })
}
