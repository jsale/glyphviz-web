import { describe, expect, it } from 'vitest'
import {
  BLINK_ABOVE_M,
  BLINK_MS,
  DASH_MAX_MS,
  DASH_MIN_MS,
  FOCUS_ANGLE_RAD,
  FOCUS_DOWN_RATIO,
  FOCUS_MAX_DISTANCE_M,
  FOCUS_MAX_PITCH_RAD,
  FOCUS_MIN_DISTANCE_M,
  beginFocus,
  focusAim,
  focusDirection,
  focusDistance,
  focusFrame,
  focusInterruptible,
  focusTravelM,
  goToNav,
  shiftFocus,
  smoothstep,
} from './xrFocus'
import { rigApply, vec3, type HeadPose, type Vec3, type XrRigState } from './xrNav'

/** A head at a typical standing eye height, looking along XR −Z. */
function head(overrides: Partial<HeadPose> = {}): HeadPose {
  return {
    position: vec3(0, 1.6, 0),
    forward: vec3(0, 0, -1),
    right: vec3(1, 0, 0),
    ...overrides,
  }
}

function rig(overrides: Partial<XrRigState> = {}): XrRigState {
  return { nav: vec3(), yaw: 0, scale: 1, ...overrides }
}

/** Where a world point currently appears in XR space — the inverse of the rig,
 *  which is what every assertion about "how far away did we arrive" needs. */
function xrOf(state: XrRigState, world: Vec3): Vec3 {
  // rigApply is nav + R_z(yaw)·R_x(90°)·S·p, so invert it by hand rather than
  // trusting a second copy of the forward transform.
  const dx = world.x - state.nav.x
  const dy = world.y - state.nav.y
  const dz = world.z - state.nav.z
  const c = Math.cos(state.yaw)
  const s = Math.sin(state.yaw)
  // Undo R_z, then R_x(90°): (x, -z, y) came from (x, y, z).
  const bx = (dx * c + dy * s) / state.scale
  const by = (-dx * s + dy * c) / state.scale
  const bz = dz / state.scale
  return { x: bx, y: bz, z: -by }
}

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

describe('focusDistance', () => {
  it('stands back far enough for the target to span the focus angle', () => {
    // A 2 m object seen at 40° wants half its size over tan(20°).
    const d = focusDistance(2, 1)
    expect(d).toBeCloseTo(1 / Math.tan(FOCUS_ANGLE_RAD / 2), 12)
  })

  it('measures the target in PERCEIVED metres, so the same node earns a different distance at each scale', () => {
    // 100 world units across at 50 units/metre is a 2 m object.
    expect(focusDistance(100, 50)).toBeCloseTo(focusDistance(2, 1), 12)
    // Shrink the world tenfold and it is a 20 cm object — ten times nearer,
    // give or take the floor.
    expect(focusDistance(100, 500)).toBeLessThan(focusDistance(100, 50))
  })

  it('never arrives closer than the eyes can comfortably converge', () => {
    expect(focusDistance(1e-6, 1)).toBe(FOCUS_MIN_DISTANCE_M)
    expect(focusDistance(0, 1)).toBe(FOCUS_MIN_DISTANCE_M)
  })

  it('stops backing off past the far clamp', () => {
    expect(focusDistance(1e9, 1)).toBe(FOCUS_MAX_DISTANCE_M)
  })
})

describe('focusDirection', () => {
  it('is the head’s own forward while the gaze is anywhere near level', () => {
    const dir = focusDirection(head({ forward: vec3(0.6, 0, -0.8) }))
    expect(dir.x).toBeCloseTo(0.6, 12)
    expect(dir.y).toBeCloseTo(0, 12)
    expect(dir.z).toBeCloseTo(-0.8, 12)
  })

  it('clamps a steep gaze rather than parking the target overhead', () => {
    const up = Math.PI / 2 - 0.2
    const dir = focusDirection(head({ forward: vec3(0, Math.sin(up), -Math.cos(up)) }))
    expect(Math.asin(dir.y)).toBeCloseTo(FOCUS_MAX_PITCH_RAD, 12)
    // The heading it was clamped along is kept.
    expect(dir.x).toBeCloseTo(0, 12)
    expect(dir.z).toBeLessThan(0)
  })

  it('clamps downward too, symmetrically', () => {
    const dir = focusDirection(head({ forward: vec3(0, -0.99, -0.141) }))
    expect(Math.asin(dir.y)).toBeCloseTo(-FOCUS_MAX_PITCH_RAD, 12)
  })

  it('is a unit vector whatever the gaze', () => {
    for (const f of [vec3(0, 0, -1), vec3(0, 0.9, -0.43), vec3(-0.5, -0.8, 0.33)]) {
      const dir = focusDirection(head({ forward: f }))
      expect(Math.hypot(dir.x, dir.y, dir.z)).toBeCloseTo(1, 12)
    }
  })

  it('falls back to the body’s facing when the neck is craned straight up', () => {
    // No horizontal component to clamp along; `right` says which way the body
    // is turned (the float anchor's own fallback).
    const dir = focusDirection(head({ forward: vec3(0, 1, 0), right: vec3(1, 0, 0) }))
    expect(dir.z).toBeCloseTo(-Math.cos(FOCUS_MAX_PITCH_RAD), 12)
    expect(dir.y).toBeCloseTo(Math.sin(FOCUS_MAX_PITCH_RAD), 12)
  })
})

describe('focusAim', () => {
  it('puts the target a hair below eye level, at the scene fit’s own angle', () => {
    const aim = focusAim(head(), 10)
    expect(aim.z).toBeCloseTo(-10, 12)
    expect(aim.y).toBeCloseTo(1.6 - 10 * FOCUS_DOWN_RATIO, 12)
    // About 1.3° down — a glance, not a dive.
    expect(Math.atan(FOCUS_DOWN_RATIO) * (180 / Math.PI)).toBeLessThan(2)
  })
})

describe('goToNav', () => {
  it('lands the target in front of the viewer at the distance its size earns', () => {
    const state = rig({ nav: vec3(400, -250, 90), yaw: 0.7, scale: 12 })
    const target = vec3(1000, 2000, -300)
    const h = head({ forward: vec3(0.3, 0.1, -0.95) })
    const nav = goToNav(target, 60, h, state)
    const after = { ...state, nav }
    // Measured in XR space (metres), which is what the viewer actually feels:
    // the target ends up exactly where `focusAim` says it should, through the
    // full rig transform at a non-trivial yaw and scale.
    const d = focusDistance(60, state.scale)
    const seen = xrOf(after, target)
    const aim = focusAim(h, d)
    expect(seen.x).toBeCloseTo(aim.x, 9)
    expect(seen.y).toBeCloseTo(aim.y, 9)
    expect(seen.z).toBeCloseTo(aim.z, 9)
    // Which is the intended distance bar the downward bias, applied after the
    // step along the gaze exactly as `fitRig` applies its own `down`. At 1.3°
    // that is under a half percent, and stating it as a tolerance rather than
    // squaring it away keeps the two constructions identical.
    expect(dist(seen, h.position)).toBeGreaterThan(d * 0.99)
    expect(dist(seen, h.position)).toBeLessThanOrEqual(d * 1.01)
    // And it is along the gaze, not merely at the right radius.
    const dir = focusDirection(h)
    const to = { x: seen.x - h.position.x, y: seen.y - h.position.y, z: seen.z - h.position.z }
    const len = Math.hypot(to.x, to.y, to.z)
    expect((to.x * dir.x + to.y * dir.y + to.z * dir.z) / len).toBeGreaterThan(0.999)
  })

  it('leaves yaw and scale exactly as the viewer set them', () => {
    // The whole reason a go-to is not a fit: the working scale and the world's
    // orientation are the viewer's, and a hop inside the scene must not rebase
    // either.
    const state = rig({ nav: vec3(3, 4, 5), yaw: -1.2, scale: 37.5 })
    const nav = goToNav(vec3(900, 900, 900), 5, head(), state)
    const after = { ...state, nav }
    expect(after.yaw).toBe(state.yaw)
    expect(after.scale).toBe(state.scale)
    // A pure translation of the viewer: every world point keeps its size and
    // its bearing, only the offset moves.
    expect(nav).not.toEqual(state.nav)
  })

  it('round-trips through the rig transform', () => {
    const state = rig({ nav: vec3(-11, 22, 3), yaw: 2.4, scale: 0.25 })
    const target = vec3(7, -8, 9)
    const after = { ...state, nav: goToNav(target, 1, head(), state) }
    const seen = xrOf(after, target)
    // rigApply of the XR point must be the world target again — which is what
    // makes the hand-written inverse above trustworthy.
    const back = rigApply(after, seen)
    expect(back.x).toBeCloseTo(target.x, 9)
    expect(back.y).toBeCloseTo(target.y, 9)
    expect(back.z).toBeCloseTo(target.z, 9)
  })
})

describe('beginFocus — choosing a style', () => {
  it('dashes a short hop', () => {
    const t = beginFocus(vec3(), vec3(0, 0, 5), 1)
    expect(t.style).toBe('dash')
  })

  it('blinks past the comfort threshold, where a dash would be a blur', () => {
    const t = beginFocus(vec3(), vec3(0, 0, BLINK_ABOVE_M + 1), 1)
    expect(t.style).toBe('blink')
    expect(t.durationMs).toBe(BLINK_MS)
  })

  it('measures the hop in PERCEIVED metres, not world units', () => {
    // 600 world units at 100 units/metre is a 6 m walk — a dash.
    expect(beginFocus(vec3(), vec3(600, 0, 0), 100).style).toBe('dash')
    // The same 600 units at 1:1 is 600 metres.
    expect(beginFocus(vec3(), vec3(600, 0, 0), 1).style).toBe('blink')
  })

  it('scales a dash’s duration with the distance, within clamps', () => {
    expect(beginFocus(vec3(), vec3(0, 0, 0.5), 1).durationMs).toBe(DASH_MIN_MS)
    const mid = beginFocus(vec3(), vec3(0, 0, 6), 1).durationMs
    expect(mid).toBeGreaterThan(DASH_MIN_MS)
    expect(mid).toBeLessThanOrEqual(DASH_MAX_MS)
  })

  it('does not animate a hop that goes nowhere', () => {
    expect(beginFocus(vec3(1, 2, 3), vec3(1, 2, 3), 1).durationMs).toBe(0)
  })
})

describe('focusFrame — a dash', () => {
  const t = beginFocus(vec3(), vec3(0, 0, 10), 1)

  it('starts at the origin and lands exactly on the destination', () => {
    expect(focusFrame(t, 0).nav).toEqual(vec3())
    const end = focusFrame(t, t.durationMs)
    expect(end.nav.z).toBeCloseTo(10, 12)
    expect(end.done).toBe(true)
  })

  it('eases in and out — no lurch at either end', () => {
    // A first-order lag would open at maximum speed; a smoothstep opens at
    // zero, which is what makes a long dash bearable.
    const early = focusFrame(t, t.durationMs * 0.05).nav.z
    const middle = focusFrame(t, t.durationMs * 0.55).nav.z - focusFrame(t, t.durationMs * 0.45).nav.z
    const late = 10 - focusFrame(t, t.durationMs * 0.95).nav.z
    expect(early).toBeLessThan(0.1)
    expect(late).toBeLessThan(0.1)
    expect(middle).toBeGreaterThan(0.1)
  })

  it('advances monotonically', () => {
    let previous = -1
    for (let u = 0; u <= 1.0001; u += 0.05) {
      const z = focusFrame(t, t.durationMs * u).nav.z
      expect(z).toBeGreaterThanOrEqual(previous)
      previous = z
    }
  })

  it('never fades — a dash is meant to be watched', () => {
    for (let u = 0; u <= 1; u += 0.1) expect(focusFrame(t, t.durationMs * u).fade).toBe(0)
  })

  it('clamps past its end rather than overshooting', () => {
    const past = focusFrame(t, t.durationMs * 3)
    expect(past.nav.z).toBeCloseTo(10, 12)
    expect(past.done).toBe(true)
  })
})

describe('focusFrame — a blink', () => {
  const t = beginFocus(vec3(), vec3(0, 0, 500), 1)

  it('jumps at the half-way point, inside the black', () => {
    expect(focusFrame(t, t.durationMs * 0.49).nav.z).toBe(0)
    expect(focusFrame(t, t.durationMs * 0.51).nav.z).toBe(500)
    // Fully black on both sides of the jump, so none of the travel is seen.
    expect(focusFrame(t, t.durationMs * 0.49).fade).toBe(1)
    expect(focusFrame(t, t.durationMs * 0.51).fade).toBe(1)
  })

  it('fades out and back in, clear at both ends', () => {
    expect(focusFrame(t, 0).fade).toBe(0)
    expect(focusFrame(t, t.durationMs * 0.15).fade).toBeGreaterThan(0)
    expect(focusFrame(t, t.durationMs * 0.15).fade).toBeLessThan(1)
    expect(focusFrame(t, t.durationMs).fade).toBe(0)
    expect(focusFrame(t, t.durationMs).done).toBe(true)
  })

  it('never leaves the view partly black once it is done', () => {
    expect(focusFrame(t, t.durationMs * 5).fade).toBe(0)
  })
})

describe('shiftFocus', () => {
  it('carries both ends, so a move in flight tracks a node animating under it', () => {
    const t = beginFocus(vec3(1, 2, 3), vec3(4, 5, 6), 1)
    const moved = shiftFocus(t, vec3(10, 0, -1))
    expect(moved.from).toEqual(vec3(11, 2, 2))
    expect(moved.to).toEqual(vec3(14, 5, 5))
    // The path is translated, not bent: same style and same clock.
    expect(moved.style).toBe(t.style)
    expect(moved.durationMs).toBe(t.durationMs)
  })
})

describe('focusInterruptible', () => {
  it('lets a gesture steer out of a dash', () => {
    expect(focusInterruptible(beginFocus(vec3(), vec3(0, 0, 3), 1))).toBe(true)
  })

  it('does not strand a viewer in the middle of a blink', () => {
    expect(focusInterruptible(beginFocus(vec3(), vec3(0, 0, 900), 1))).toBe(false)
  })
})

describe('helpers', () => {
  it('smoothstep is clamped, symmetric and flat at both ends', () => {
    expect(smoothstep(-1)).toBe(0)
    expect(smoothstep(2)).toBe(1)
    expect(smoothstep(0.5)).toBeCloseTo(0.5, 12)
    expect(smoothstep(0.25) + smoothstep(0.75)).toBeCloseTo(1, 12)
  })

  it('focusTravelM converts world units to what the viewer walks', () => {
    expect(focusTravelM(vec3(), vec3(300, 400, 0), 100)).toBeCloseTo(5, 12)
  })
})
