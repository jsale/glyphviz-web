// Port of the desktop's tests/test_camera_mode.py — the behavior spec for
// Camera Mode (free flight, C key) and the saved camera views (Shift+C).
//
// Not ported, with reasons:
//  - the render-timer assertions (held-offset flight needs ticks): the web
//    animation loop always runs, so there is no timer to start or stop;
//  - test_engaging_camera_mode_clears_follow_selected and
//    test_starting_a_both_button_drag_does_not_teleport_the_camera: Follow
//    Selected and the combo-drag pivot snap live in main.ts, not the rig —
//    both are covered by the drive-the-UI pass;
//  - the camera_state()/restore round-trip pair: that API exists for the
//    desktop's File ▸ Watch and Reload, which this app does not have;
//  - test_wheel_still_zooms_outside_camera_mode: outside Camera Mode the
//    wheel belongs to OrbitControls (its own zoom factor), not the rig.

import { describe, expect, it } from 'vitest'
import {
  CameraRig,
  FLY_DEADZONE_PX,
  FLY_RATE_PER_PX_S,
  FLY_TURN_DEG_PER_PX_S,
  LOOK_DEG_PER_PX,
  pastDeadzone,
  type Vec3,
} from './cameraMode'

const DEG = Math.PI / 180

/** The desktop fixture's rig: a deliberately un-special pose. */
function makeRig(): CameraRig {
  const rig = new CameraRig()
  rig.azimuth = 37
  rig.elevation = 22
  rig.distance = 400
  rig.target = [10, -5, 3]
  rig.cameras = rig.makeDefaultCameras()
  return rig
}

function unit(v: Vec3): Vec3 {
  const n = Math.hypot(v[0], v[1], v[2])
  return [v[0] / n, v[1] / n, v[2] / n]
}

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

function expectClose(a: Vec3, b: Vec3, tol = 1e-9) {
  for (let i = 0; i < 3; i++) expect(Math.abs(a[i] - b[i])).toBeLessThan(tol)
}

/** The horizontal-plane flight direction: the camera's forward vector with
 *  the elevation term dropped. */
function heading(rig: CameraRig): Vec3 {
  const az = rig.azimuth * DEG
  return [-Math.cos(az), -Math.sin(az), 0]
}

/** Start a flight drag anchored at (100, 100) with the cursor held at the
 *  given offset from it — offY < 0 means above the origin (fly forward). */
function hold(rig: CameraRig, offX: number, offY: number) {
  rig.flyAnchor = [100, 100]
  rig.flyCursor = [100 + offX, 100 + offY]
}

// --- camera basis ----------------------------------------------------------

describe('camera basis', () => {
  it('matches the look-at eye and target', () => {
    const rig = makeRig()
    const [forward] = rig.cameraBasis()
    const eye = rig.eyePosition()
    expectClose(
      forward,
      unit([rig.target[0] - eye[0], rig.target[1] - eye[1], rig.target[2] - eye[2]]),
    )
  })

  it('is orthonormal and right-handed, with a horizontal right vector', () => {
    const rig = makeRig()
    const [forward, right, up] = rig.cameraBasis()
    for (const v of [forward, right, up]) {
      expect(Math.abs(Math.hypot(v[0], v[1], v[2]) - 1)).toBeLessThan(1e-12)
    }
    for (const [a, b] of [
      [forward, right],
      [forward, up],
      [right, up],
    ] as const) {
      expect(Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2])).toBeLessThan(1e-12)
    }
    expect(Math.abs(right[2])).toBeLessThan(1e-12) // right must stay horizontal
    const cross: Vec3 = [
      right[1] * forward[2] - right[2] * forward[1],
      right[2] * forward[0] - right[0] * forward[2],
      right[0] * forward[1] - right[1] * forward[0],
    ]
    expectClose(cross, up)
  })

  it('never rolls: up is always plain world-Z', () => {
    // Banking was removed with the move to ANTz-style rate flight.
    expect(makeRig().cameraUp()).toEqual([0, 0, 1])
  })
})

// --- rate flight -----------------------------------------------------------

describe('rate flight', () => {
  it('holding above the origin flies forward along the heading, altitude locked', () => {
    const rig = makeRig()
    rig.setFlyMode(true)
    const h = heading(rig)
    const forward0 = rig.cameraBasis()[0]
    const eye0 = rig.eyePosition()
    const target0: Vec3 = [...rig.target]
    const arm = rig.distance

    hold(rig, 0, -(100 + FLY_DEADZONE_PX)) // cursor 100px (net) above
    rig.applyFlyDrag(1000)

    const eye1 = rig.eyePosition()
    const moved: Vec3 = [eye1[0] - eye0[0], eye1[1] - eye0[1], eye1[2] - eye0[2]]
    expectClose(unit(moved), h)
    expect(Math.abs(moved[2])).toBeLessThan(1e-12) // altitude is locked
    expectClose(
      [rig.target[0] - target0[0], rig.target[1] - target0[1], rig.target[2] - target0[2]],
      moved,
    )
    expect(Math.abs(dist(eye1, rig.target) - arm)).toBeLessThan(1e-9)
    expectClose(rig.cameraBasis()[0], forward0, 1e-12) // aim must not change
  })

  it('holding below the origin flies backward', () => {
    const rig = makeRig()
    rig.setFlyMode(true)
    const h = heading(rig)
    const eye0 = rig.eyePosition()

    hold(rig, 0, 100 + FLY_DEADZONE_PX) // cursor below the origin
    rig.applyFlyDrag(1000)

    const eye1 = rig.eyePosition()
    expectClose(unit([eye1[0] - eye0[0], eye1[1] - eye0[1], eye1[2] - eye0[2]]), [
      -h[0],
      -h[1],
      -h[2],
    ])
  })

  it('flight speed scales with offset, arm length, and time', () => {
    const rig = makeRig()
    rig.setFlyMode(true)
    const eye0 = rig.eyePosition()
    hold(rig, 0, -(80 + FLY_DEADZONE_PX)) // 80px of net offset
    rig.applyFlyDrag(500) // half a second
    const step = dist(rig.eyePosition(), eye0)
    expect(Math.abs(step - 80 * rig.distance * FLY_RATE_PER_PX_S * 0.5)).toBeLessThan(1e-9)
  })

  it('continues while the mouse sits still, at a constant speed', () => {
    // The defining rate-flight behavior: a held offset keeps flying with no
    // further mouse movement.
    const rig = makeRig()
    rig.setFlyMode(true)
    const eye0 = rig.eyePosition()
    hold(rig, 0, -(50 + FLY_DEADZONE_PX))

    rig.applyFlyDrag(400)
    const oneTick = dist(rig.eyePosition(), eye0)
    rig.applyFlyDrag(400) // cursor untouched
    const twoTicks = dist(rig.eyePosition(), eye0)

    expect(oneTick).toBeGreaterThan(0)
    expect(Math.abs(twoTicks - 2 * oneTick)).toBeLessThan(1e-9 * twoTicks)
  })

  it('does not move inside the dead zone', () => {
    const rig = makeRig()
    rig.setFlyMode(true)
    const eye0 = rig.eyePosition()
    const aim0 = rig.cameraBasis()[0]

    hold(rig, FLY_DEADZONE_PX * 0.5, -FLY_DEADZONE_PX * 0.5)
    rig.applyFlyDrag(1000)

    expect(dist(rig.eyePosition(), eye0)).toBeLessThan(1e-12)
    expectClose(rig.cameraBasis()[0], aim0, 1e-12)
  })

  it('stops when the cursor returns to the origin', () => {
    const rig = makeRig()
    rig.setFlyMode(true)
    hold(rig, 0, -50)
    rig.applyFlyDrag(1000)
    const eyeMid = rig.eyePosition()

    rig.flyCursor = [...rig.flyAnchor!] // back to the bearings origin
    rig.applyFlyDrag(1000)

    expect(dist(rig.eyePosition(), eyeMid)).toBeLessThan(1e-12)
  })

  it('turning pivots in place instead of orbiting', () => {
    // The bug this guards: naively changing azimuth swings the eye around
    // the target, which is exactly the anchored feel Camera Mode exists to
    // escape.
    const rig = makeRig()
    rig.setFlyMode(true)
    const eye0 = rig.eyePosition()
    hold(rig, 30 + FLY_DEADZONE_PX, 0)
    rig.applyFlyDrag(1000)
    expect(dist(rig.eyePosition(), eye0)).toBeLessThan(1e-9)
  })

  it('holding right of the origin turns right', () => {
    // A right turn rotates the aim toward the camera's own right vector.
    // Checked at zero pitch, where a heading change about world Z and a
    // rotation in the camera's frame coincide exactly.
    const rig = makeRig()
    rig.setFlyMode(true)
    rig.azimuth = 15
    rig.elevation = 0
    rig.target = [0, 0, 0]
    const [forward0, right0] = rig.cameraBasis()

    hold(rig, 40 + FLY_DEADZONE_PX, 0)
    rig.applyFlyDrag(1000)

    const theta = 40 * FLY_TURN_DEG_PER_PX_S * DEG
    const expected: Vec3 = [
      forward0[0] * Math.cos(theta) + right0[0] * Math.sin(theta),
      forward0[1] * Math.cos(theta) + right0[1] * Math.sin(theta),
      forward0[2] * Math.cos(theta) + right0[2] * Math.sin(theta),
    ]
    expectClose(rig.cameraBasis()[0], expected)
  })

  it('does not fly outside Camera Mode or without an anchor', () => {
    const rig = makeRig()
    const eye0 = rig.eyePosition()
    hold(rig, 0, -200) // fly mode is still off
    rig.applyFlyDrag(1000)
    expect(dist(rig.eyePosition(), eye0)).toBeLessThan(1e-12)

    rig.setFlyMode(true) // on, but no drag in progress
    rig.flyAnchor = rig.flyCursor = null
    rig.applyFlyDrag(1000)
    expect(dist(rig.eyePosition(), eye0)).toBeLessThan(1e-12)
  })

  it('ramps from the dead-zone edge, not from zero offset', () => {
    expect(pastDeadzone(FLY_DEADZONE_PX + 10)).toBe(10)
    expect(pastDeadzone(-(FLY_DEADZONE_PX + 10))).toBe(-10)
    expect(pastDeadzone(FLY_DEADZONE_PX * 0.9)).toBe(0)
    expect(pastDeadzone(0)).toBe(0)
  })
})

// --- press / release state machine -----------------------------------------

describe('fly pointer state machine', () => {
  it('a lone Left press drops the bearings origin', () => {
    const rig = makeRig()
    rig.setFlyMode(true)
    rig.flyPointerEvent(1, 120, 80)
    expect(rig.flyAnchor).toEqual([120, 80])
    expect(rig.flyCursor).toEqual([120, 80])
  })

  it('release ends the drag', () => {
    const rig = makeRig()
    rig.setFlyMode(true)
    rig.flyPointerEvent(1, 120, 80)
    rig.flyPointerEvent(0, 150, 90)
    expect(rig.flyAnchor).toBeNull()
    expect(rig.flyCursor).toBeNull()
  })

  it('a plain move tracks the cursor without moving the origin', () => {
    const rig = makeRig()
    rig.setFlyMode(true)
    rig.flyPointerEvent(1, 120, 80)
    rig.flyPointerEvent(1, 150, 40)
    expect(rig.flyAnchor).toEqual([120, 80])
    expect(rig.flyCursor).toEqual([150, 40])
  })

  it('pressing the second button of a combo suspends rate flight', () => {
    // Left+Right together strafes; the origin is dropped so the strafe is
    // not fighting a leftover held-offset flight.
    const rig = makeRig()
    rig.setFlyMode(true)
    rig.flyPointerEvent(1, 120, 80)
    rig.flyPointerEvent(3, 120, 80)
    expect(rig.flyAnchor).toBeNull()
  })

  it('ending a combo with Left still down re-anchors at the cursor', () => {
    // The pre-combo origin is stale and would lurch the camera the moment
    // Right lifted.
    const rig = makeRig()
    rig.setFlyMode(true)
    rig.flyPointerEvent(1, 120, 80)
    rig.flyPointerEvent(3, 120, 80)
    rig.flyPointerEvent(1, 200, 150)
    expect(rig.flyAnchor).toEqual([200, 150])
  })

  it('toggling Camera Mode mid-drag adopts the cursor as the origin', () => {
    const rig = makeRig()
    rig.flyPointerEvent(1, 120, 80) // press seen outside fly mode
    rig.setFlyMode(true)
    rig.flyPointerEvent(1, 140, 90) // first move in fly mode
    expect(rig.flyAnchor).toEqual([140, 90])
    expect(rig.flyCursor).toEqual([140, 90])
  })
})

// --- look around -----------------------------------------------------------

describe('look around', () => {
  it('keeps the eye planted and the arm length fixed', () => {
    const rig = makeRig()
    rig.setFlyMode(true)
    const eye0 = rig.eyePosition()
    const arm = rig.distance
    const aim0 = rig.cameraBasis()[0]

    rig.lookAround(60, 25)

    expect(dist(rig.eyePosition(), eye0)).toBeLessThan(1e-9)
    expect(Math.abs(dist(rig.eyePosition(), rig.target) - arm)).toBeLessThan(1e-9)
    const aim1 = rig.cameraBasis()[0]
    expect(dist(aim1, aim0)).toBeGreaterThan(1e-3) // the aim did change
  })

  it('turns the same way flight does', () => {
    const rig = makeRig()
    rig.setFlyMode(true)
    rig.azimuth = 15
    rig.elevation = 0
    rig.target = [0, 0, 0]
    const [forward0, right0] = rig.cameraBasis()

    rig.lookAround(40, 0)

    const theta = 40 * LOOK_DEG_PER_PX * DEG
    const expected: Vec3 = [
      forward0[0] * Math.cos(theta) + right0[0] * Math.sin(theta),
      forward0[1] * Math.cos(theta) + right0[1] * Math.sin(theta),
      forward0[2] * Math.cos(theta) + right0[2] * Math.sin(theta),
    ]
    expectClose(rig.cameraBasis()[0], expected)
  })

  it.each([
    [10_000, 89],
    [-10_000, -89],
  ])('pitch clamps short of the up-vector singularity (dy=%d → %d°)', (dy, expected) => {
    const rig = makeRig()
    rig.setFlyMode(true)
    rig.lookAround(0, dy)
    expect(rig.elevation).toBe(expected)
  })
})

// --- strafe / pedestal -----------------------------------------------------

describe('strafe', () => {
  it('slides the camera without changing the aim', () => {
    const rig = makeRig()
    rig.setFlyMode(true)
    rig.azimuth = 0
    rig.elevation = 0
    rig.target = [0, 0, 0]
    const [forward0, right0] = rig.cameraBasis()
    const eye0 = rig.eyePosition()

    rig.strafe(50, 0)

    const eye1 = rig.eyePosition()
    expectClose(unit([eye1[0] - eye0[0], eye1[1] - eye0[1], eye1[2] - eye0[2]]), right0)
    expectClose(rig.cameraBasis()[0], forward0, 1e-12)

    const z1 = rig.eyePosition()[2]
    rig.strafe(0, 50) // drag down
    expect(rig.eyePosition()[2]).toBeLessThan(z1)
  })
})

// --- wheel -----------------------------------------------------------------

describe('wheel', () => {
  it('flies instead of zooming in Camera Mode', () => {
    const rig = makeRig()
    rig.setFlyMode(true)
    const [forward] = rig.cameraBasis()
    const arm = rig.distance
    const eye0 = rig.eyePosition()

    rig.wheelFly(1)

    expect(Math.abs(rig.distance - arm)).toBeLessThan(1e-12) // arm length is the speed scale
    const eye1 = rig.eyePosition()
    expectClose(unit([eye1[0] - eye0[0], eye1[1] - eye0[1], eye1[2] - eye0[2]]), forward)
  })
})

// --- mode interlocks -------------------------------------------------------

describe('mode interlocks', () => {
  it('fixed reference views do not fly', () => {
    const rig = makeRig()
    rig.selectCamera(1) // +X View, locked
    expect(rig.activeCameraLocked()).toBe(true)

    rig.setFlyMode(true)
    expect(rig.flyMode).toBe(true)
    // Switches to Main rather than flying a locked view.
    expect(rig.activeCamera).toBe(0)

    rig.selectCamera(1)
    expect(rig.flyMode).toBe(false) // picking a reference view leaves Camera Mode
  })

  it('leaving Camera Mode ends any flight drag', () => {
    const rig = makeRig()
    rig.setFlyMode(true)
    hold(rig, 0, -50)
    rig.setFlyMode(false)
    expect(rig.flyAnchor).toBeNull()
    expect(rig.flyCursor).toBeNull()
  })

  it('setFlyMode reports whether the mode actually changed', () => {
    const rig = makeRig()
    expect(rig.setFlyMode(false)).toBe(false)
    expect(rig.setFlyMode(true)).toBe(true)
    expect(rig.setFlyMode(true)).toBe(false)
    expect(rig.setFlyMode(false)).toBe(true)
  })
})

// --- saved camera views ----------------------------------------------------

describe('camera views', () => {
  it('selecting a camera saves the live rig into the outgoing slot', () => {
    const rig = makeRig()
    rig.distance = 777 // "the user zoomed"
    rig.selectCamera(1)
    expect(rig.cameras[0].distance).toBe(777)
    expect(rig.azimuth).toBe(0) // +X View loaded live
    expect(rig.distance).toBe(500)
    expect(rig.target).toEqual([0, 0, 0])

    rig.selectCamera(0) // back to Main: the zoomed view returns
    expect(rig.distance).toBe(777)
  })

  it('cycling wraps in both directions', () => {
    const rig = makeRig()
    rig.cycleCamera(1)
    expect(rig.activeCamera).toBe(1)
    rig.cycleCamera(-2)
    expect(rig.activeCamera).toBe(3)
    rig.cycleCamera(1)
    expect(rig.activeCamera).toBe(0)
  })

  it('+Z View looks from 89°, short of the up-vector singularity', () => {
    const rig = makeRig()
    rig.selectCamera(3)
    expect(rig.elevation).toBe(89)
  })

  it('a scene load re-derives the axis views and drops back to Main', () => {
    const rig = makeRig()
    rig.selectCamera(2)
    rig.setFlyMode(true) // switched to Main by the locked-view rule
    rig.resetCameras(120)
    expect(rig.activeCamera).toBe(0)
    expect(rig.cameras[1].distance).toBe(120)
    expect(rig.flyMode).toBe(true) // fly mode survives a scene load
  })

  it('syncFromView round-trips eyePosition', () => {
    const rig = makeRig()
    const eye = rig.eyePosition()
    const other = new CameraRig()
    other.syncFromView(
      { x: eye[0], y: eye[1], z: eye[2] },
      { x: rig.target[0], y: rig.target[1], z: rig.target[2] },
    )
    expect(Math.abs(other.azimuth - rig.azimuth)).toBeLessThan(1e-9)
    expect(Math.abs(other.elevation - rig.elevation)).toBeLessThan(1e-9)
    expect(Math.abs(other.distance - rig.distance)).toBeLessThan(1e-9)
    expectClose(other.eyePosition(), eye, 1e-9)
  })
})
