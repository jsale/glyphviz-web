// Camera smoothing (optional ANTz-style navigation inertia).
//
// The filter half is desktop `tests/test_camera_smoothing.py`, ported case for
// case — the contract, from camera_smoothing.py:
//
//   * tau = 0 is EXACTLY off. The default has to be bit-identical to the
//     behaviour that shipped before the feature existed.
//   * The filter is frame-rate independent — the same setting must feel the
//     same at 30 fps and 144. (ANTz's `0.05 * 65/(fps+5)` fudge is not, which
//     is why its smoothing was so much heavier in its early, slower years.)
//   * Azimuth eases along the shortest arc, so a drag across the 0/360 seam is
//     a small correction, not a full spin.
//   * Distance eases geometrically, because zoom is multiplicative.
//   * It is a LAG filter, not momentum: nothing overshoots or keeps going.
//
// The CameraSmoothing half covers the goal-state rules the desktop keeps in
// viewport.py (`tests/test_camera_smoothing_viewport.py` there), as far as
// they exist without a THREE camera in the room.

import { describe, expect, it } from 'vitest'
import type { OrbitRig } from './cameraMode'
import { eyeFromRig, rigFromView } from './cameraMode'
import {
  alphaFor,
  CameraSmoothing,
  easeAngle,
  easeLog,
  easePoint,
  easeScalar,
  isSettled,
  SCOPE_ALL,
  SCOPE_COMBO,
  TAU_ANTZ,
  TAU_MAX,
  TAU_DEFAULT,
  TAU_OFF,
} from './cameraSmoothing'

function rig(over: Partial<OrbitRig> = {}): OrbitRig {
  return { azimuth: 10, elevation: 5, distance: 100, target: [0, 0, 0], ...over }
}

function settle(steps: number, dt: number, tau: number, start = 0, goal = 100): number {
  let v = start
  for (let i = 0; i < steps; i++) v = easeScalar(v, goal, alphaFor(dt, tau))
  return v
}

// --- alphaFor: the off switch and frame-rate independence --------------------

describe('alphaFor', () => {
  it.each([0.001, 1 / 144, 1 / 60, 1 / 30, 0.5])(
    'tau = 0 snaps outright at dt %f — smoothing off costs nothing and drifts nowhere',
    (dt) => {
      expect(alphaFor(dt, TAU_OFF)).toBe(1)
    },
  )

  it('a negative tau also snaps', () => {
    expect(alphaFor(1 / 60, -0.5)).toBe(1)
  })

  it('a zero-length step snaps rather than silently freezing', () => {
    expect(alphaFor(0, TAU_ANTZ)).toBe(1)
  })

  it('is the exponential, not a ratio: one tau closes ~63.2% of the gap', () => {
    expect(alphaFor(TAU_ANTZ, TAU_ANTZ)).toBeCloseTo(1 - 1 / Math.E, 12)
  })

  it('is frame-rate independent — the property ANTz lacked', () => {
    // Half a second of smoothing lands in the same place at 30, 60 and 144 fps.
    const at30 = settle(15, 1 / 30, TAU_ANTZ)
    const at60 = settle(30, 1 / 60, TAU_ANTZ)
    const at144 = settle(72, 1 / 144, TAU_ANTZ)
    expect(at30).toBeCloseTo(at60, 9)
    expect(at60).toBeCloseTo(at144, 9)
  })

  it('two half steps equal one whole step (the exact-exponential property)', () => {
    const tau = 0.25
    const one = easeScalar(0, 1, alphaFor(0.02, tau))
    let half = easeScalar(0, 1, alphaFor(0.01, tau))
    half = easeScalar(half, 1, alphaFor(0.01, tau))
    expect(one).toBeCloseTo(half, 12)
  })

  it('TAU_ANTZ reproduces ANTz’s f = 0.05 per frame at 60 fps', () => {
    // Check the claim rather than trusting the comment (npengine.c's
    // npLowPassFilter call): one 1/60 s step closes ~5% of the gap.
    expect(alphaFor(1 / 60, TAU_ANTZ)).toBeCloseTo(0.05, 2)
  })
})

// --- easeScalar / easePoint: convergence, no overshoot -----------------------

describe('easeScalar / easePoint', () => {
  it('never overshoots — a lag filter, not momentum', () => {
    let v = 0
    let prev = v
    for (let i = 0; i < 300; i++) {
      v = easeScalar(v, 100, alphaFor(1 / 60, TAU_ANTZ))
      expect(prev).toBeLessThanOrEqual(v)
      expect(v).toBeLessThanOrEqual(100)
      prev = v
    }
  })

  it('converges to the goal', () => {
    expect(settle(600, 1 / 60, TAU_ANTZ)).toBeCloseTo(100, 6)
  })

  it('easePoint moves all three axes', () => {
    expect(easePoint([0, 0, 0], [10, -20, 5], 0.5)).toEqual([5, -10, 2.5])
  })

  it('easePoint returns a new array — an alias would kill the glide', () => {
    // The goal and the actual must stay separate: a shared array would make
    // the goal follow the actual and there would be nothing to chase.
    const actual: [number, number, number] = [1, 2, 3]
    const goal: [number, number, number] = [4, 5, 6]
    const out = easePoint(actual, goal, 0.5)
    expect(out).not.toBe(actual)
    expect(out).not.toBe(goal)
    expect(actual).toEqual([1, 2, 3])
  })

  it('easePoint snaps at alpha 1, still as a copy', () => {
    const goal: [number, number, number] = [4, 5, 6]
    const out = easePoint([1, 2, 3], goal, 1)
    expect(out).toEqual(goal)
    expect(out).not.toBe(goal)
  })
})

// --- easeAngle: the wrap seam -----------------------------------------------

describe('easeAngle', () => {
  it('takes the shortest arc across the seam: 350 → 10 is +20°, not −340°', () => {
    expect(easeAngle(350, 10, 0.5)).toBeCloseTo(360, 9)
  })

  it('and the other way', () => {
    expect(easeAngle(10, 350, 0.5)).toBeCloseTo(0, 9)
  })

  it('resolves the exactly-opposite case to a single half step', () => {
    expect(Math.abs(easeAngle(0, 180, 0.5))).toBeCloseTo(90, 9)
  })

  it('does not re-wrap the result — the rig azimuth is free-running', () => {
    expect(easeAngle(720, 720, 0.5)).toBeCloseTo(720, 9)
  })

  it('snaps at alpha 1', () => {
    expect(easeAngle(350, 10, 1)).toBe(10)
  })

  it('converges across the seam, travelling +2° rather than −358°', () => {
    let v = 359
    for (let i = 0; i < 400; i++) v = easeAngle(v, 1, alphaFor(1 / 60, TAU_ANTZ))
    expect(((v - 1 + 180) % 360) - 180).toBeCloseTo(0, 6)
    expect(v).toBeGreaterThanOrEqual(359)
    expect(v).toBeLessThanOrEqual(361)
  })
})

// --- easeLog: zoom -----------------------------------------------------------

describe('easeLog', () => {
  it('eases geometrically: halfway from 100 to 400 is 200, not 250', () => {
    expect(easeLog(100, 400, 0.5)).toBeCloseTo(200, 9)
  })

  it('keeps the arm length strictly positive however aggressive the zoom', () => {
    let v = 500
    for (let i = 0; i < 200; i++) {
      v = easeLog(v, 1, alphaFor(1 / 60, TAU_ANTZ))
      expect(v).toBeGreaterThan(0)
    }
  })

  it('snaps at alpha 1', () => {
    expect(easeLog(100, 400, 1)).toBe(400)
  })

  it('falls back to the linear ease on a degenerate rig instead of throwing', () => {
    expect(easeLog(0, 400, 0.5)).toBeCloseTo(200, 9)
    expect(easeLog(100, 0, 0.5)).toBeCloseTo(50, 9)
  })
})

// --- isSettled: what ends a glide -------------------------------------------

describe('isSettled', () => {
  it('an identical rig is settled', () => {
    expect(isSettled(rig(), rig())).toBe(true)
  })

  it.each([
    ['azimuth', rig({ azimuth: 20 })],
    ['elevation', rig({ elevation: 15 })],
    ['distance', rig({ distance: 150 })],
    ['target', rig({ target: [50, 0, 0] })],
  ])('%s off goal is unsettled', (_name, goal) => {
    expect(isSettled(rig(), goal)).toBe(false)
  })

  it('359.999 vs 0 is a hair apart, not 360° apart', () => {
    expect(isSettled(rig({ azimuth: 359.999 }), rig({ azimuth: 0 }))).toBe(true)
  })

  it('the position tolerance scales with the arm length', () => {
    // 0.4 units is invisible on a 500-unit rig and glaring on a 2-unit one.
    expect(isSettled(rig({ distance: 500, target: [0.4, 0, 0] }), rig({ distance: 500 }))).toBe(true)
    expect(isSettled(rig({ distance: 2, target: [0.4, 0, 0] }), rig({ distance: 2 }))).toBe(false)
  })

  it('a 90° orbit is visually complete within three tau', () => {
    // What the user perceives: 95% of the glide is done by ~1 s at the ANTz
    // setting. The rest is the exponential's invisible tail.
    let az = 0
    const frames = Math.trunc(3 * TAU_ANTZ * 60)
    for (let i = 0; i < frames; i++) az = easeAngle(az, 90, alphaFor(1 / 60, TAU_ANTZ))
    expect(az).toBeCloseTo(90 * (1 - Math.exp(-3)), 0)
    expect(az).toBeGreaterThan(90 * 0.94)
  })

  it('a real glide ends inside three seconds', () => {
    // The desktop releases its repaint timer here; this app lands the glide on
    // its goal and stops writing the camera. Either way the tail has to END.
    let az = 0
    let frame = 0
    for (; frame < 240; frame++) {
      az = easeAngle(az, 90, alphaFor(1 / 60, TAU_ANTZ))
      if (isSettled(rig({ azimuth: az }), rig({ azimuth: 90 }))) break
    }
    expect(frame).toBeLessThan(240)
    expect(frame / 60).toBeLessThan(3)
  })
})

// --- CameraSmoothing: the goal-state rules ----------------------------------

describe('CameraSmoothing', () => {
  it('boots with a light glide over every camera gesture', () => {
    const s = new CameraSmoothing()
    expect(s.tau).toBe(TAU_DEFAULT)
    expect(s.scope).toBe(SCOPE_ALL)
    // Light: enough to take the edge off a mouse, short of ANTz's own weight.
    expect(TAU_DEFAULT).toBeGreaterThan(TAU_OFF)
    expect(TAU_DEFAULT).toBeLessThan(TAU_ANTZ)
    expect(TAU_ANTZ).toBeLessThan(TAU_MAX)
  })

  it('covers nothing while off, whatever the scope', () => {
    const s = new CameraSmoothing()
    s.tau = TAU_OFF
    s.scope = SCOPE_ALL
    expect(s.covers(true)).toBe(false)
    expect(s.covers(false)).toBe(false)
  })

  it('at ANTz’s own narrow scope covers the Left+Right combo only', () => {
    const s = new CameraSmoothing()
    s.tau = TAU_ANTZ
    s.scope = SCOPE_COMBO
    expect(s.covers(true)).toBe(true)
    expect(s.covers(false)).toBe(false)
    s.scope = SCOPE_ALL
    expect(s.covers(false)).toBe(true)
  })

  it('never covers Camera Mode, under either scope', () => {
    const s = new CameraSmoothing()
    s.tau = TAU_ANTZ
    s.scope = SCOPE_ALL
    expect(s.covers(true, true)).toBe(false)
    expect(s.covers(false, true)).toBe(false)
  })

  it('step does nothing at all while off', () => {
    const s = new CameraSmoothing()
    s.tau = TAU_OFF
    s.snap(rig())
    expect(s.step(rig({ azimuth: 90 }), 16)).toBeNull()
  })

  it('eases every rig quantity together — the whole design', () => {
    const s = new CameraSmoothing()
    s.tau = TAU_ANTZ
    s.snap(rig({ azimuth: 90, elevation: 40, distance: 400, target: [10, 20, 30] }))
    const next = s.step(rig(), 100)! // the dt clamp's ceiling, so alpha is exact
    const alpha = alphaFor(0.1, TAU_ANTZ)
    expect(next.azimuth).toBeCloseTo(10 + 80 * alpha, 9)
    expect(next.elevation).toBeCloseTo(5 + 35 * alpha, 9)
    expect(next.distance).toBeCloseTo(Math.exp(Math.log(100) + (Math.log(400) - Math.log(100)) * alpha), 9)
    expect(next.target[0]).toBeCloseTo(10 * alpha, 9)
  })

  it('keeps the framing put through a glide — the ANTz artefact this fixes', () => {
    // ANTz eased the eye's POSITION while applying the orbit angle and zoom
    // instantly, so the orbited object swung out of frame. Easing the rig
    // coherently means the eye stays exactly on its orbit sphere about the
    // pivot for the whole glide.
    const s = new CameraSmoothing()
    s.tau = TAU_ANTZ
    s.snap(rig({ azimuth: 50, distance: 100, target: [0, 0, 0] }))
    let actual = rig({ azimuth: 10 })
    for (let i = 0; i < 240; i++) {
      const next = s.step(actual, 1000 / 60)
      if (!next) break
      actual = next
      const eye = eyeFromRig(actual)
      const r = Math.hypot(eye[0] - actual.target[0], eye[1] - actual.target[1], eye[2] - actual.target[2])
      expect(r).toBeCloseTo(actual.distance, 9)
    }
    expect(actual.azimuth).toBeCloseTo(50, 9)
  })

  it('clamps a huge dt so a backgrounded tab does not snap the glide away', () => {
    const s = new CameraSmoothing()
    s.tau = TAU_ANTZ
    s.snap(rig({ azimuth: 110 }))
    const next = s.step(rig(), 60_000)!
    // 100 ms at tau 0.33 closes 26% of the gap, not all of it.
    expect(next.azimuth).toBeCloseTo(10 + 100 * alphaFor(0.1, TAU_ANTZ), 9)
  })

  it('lands exactly on the goal once inside tolerance, then stops writing', () => {
    const s = new CameraSmoothing()
    s.tau = TAU_ANTZ
    s.snap(rig({ azimuth: 10.001 }))
    const landed = s.step(rig(), 16)!
    expect(landed.azimuth).toBe(10.001)
    expect(s.step(landed, 16)).toBeNull()
  })

  it('adopts the camera when settled, and refuses to mid-glide', () => {
    // Settled, the actual is the truth (a stray sub-tolerance nudge is taken
    // at face value); mid-glide the goal is where the user aimed and the
    // lagging actual must not clobber it.
    const s = new CameraSmoothing()
    s.tau = TAU_ANTZ
    s.snap(rig())
    s.adopt(rig({ distance: 100.01 }))
    expect(s.goal.distance).toBe(100.01)
    s.goal.azimuth = 90 // a gesture aims elsewhere
    s.adopt(rig({ distance: 100.01 })) // a lagging actual must not win it back
    expect(s.goal.azimuth).toBe(90)
  })

  it('adopts unconditionally while off, so the goal is never stale', () => {
    // This is what keeps every direct camera write working once smoothing is
    // switched off. With it ON — the boot state — a programmatic move is a JUMP
    // and must call snap() itself, or the filter would drag it back (main.ts
    // does, at every such site: framing, presets, focus, flight, the XR exit).
    // Follow Selected is the one exception — it moves eye and pivot by the same
    // delta and so owns the PIVOT alone; see the Follow Selected block below.
    const s = new CameraSmoothing()
    s.tau = TAU_OFF
    s.goal.azimuth = 90
    s.adopt(rig())
    expect(s.goal.azimuth).toBe(10)
  })

  it('snap copies rather than aliases the target', () => {
    const s = new CameraSmoothing()
    const actual = rig()
    s.snap(actual)
    actual.target[0] = 99
    expect(s.goal.target[0]).toBe(0)
  })
})

// --- Follow Selected, which must not veto navigation -------------------------
//
// Desktop `tests/test_camera_smoothing_viewport.py`. Follow lives in main.ts,
// wired to a THREE camera and OrbitControls, so what is driven here is the two
// operations `applyFollowTarget` performs on the rig, once per animation frame:
//
//   1. eye and pivot translate by the SAME delta, so the rig's target lands on
//      the node while azimuth, elevation and distance are untouched;
//   2. the goal's target is pinned to the same point — and NOTHING else.
//
// Step 2 used to be `snapCameraGoal()`, which re-pointed the whole goal at the
// lagging actual every frame and so erased an in-progress drag's aim before the
// filter could chase it: the camera did not move at all while Follow was on
// (desktop bug, fixed b156103). Following pins the pivot; it does not veto
// navigation.

describe('Follow Selected under smoothing', () => {
  /** `applyFollowTarget`, expressed on the rig. */
  function followPivot(s: CameraSmoothing, actual: OrbitRig, point: [number, number, number]) {
    s.goal.target = [...point]
    return { ...actual, target: [...point] as [number, number, number] }
  }

  // The held drags, as main.ts writes them: OrbitControls' own orbit and wheel
  // zoom land in the goal through SmoothOrbitControls.update(), the Left+Right
  // combo through manualDragMove. All three are "adopt the actual, then move a
  // goal field", which is the only shape that matters here.
  const gestures: Record<string, (goal: OrbitRig) => void> = {
    orbit: (g) => {
      g.azimuth -= 1.2
      g.elevation = Math.min(89, g.elevation + 0.6)
    },
    'orbit + zoom (the combo drag)': (g) => {
      g.azimuth -= 1.2
      g.distance *= 1.01
    },
    'wheel zoom': (g) => {
      g.distance *= 0.98
    },
  }

  function drive(gesture: (goal: OrbitRig) => void, follow: boolean): OrbitRig {
    const s = new CameraSmoothing()
    s.tau = TAU_ANTZ
    s.scope = SCOPE_ALL // so a plain orbit or wheel is covered, not just the combo
    let actual = rig()
    s.snap(actual)
    for (let frame = 0; frame < 30; frame++) {
      // The animation loop's order: follow first (the node has already moved
      // this frame), then the gesture, then one filter step.
      if (follow) actual = followPivot(s, actual, [frame * 0.5, -frame * 0.25, 3])
      s.adopt(actual)
      gesture(s.goal)
      actual = s.step(actual, 1000 / 60) ?? actual
    }
    return actual
  }

  it.each(Object.keys(gestures))(
    'a held %s drives the camera identically with Follow on and off',
    (name) => {
      const on = drive(gestures[name], true)
      const off = drive(gestures[name], false)
      // Exactly equal, not merely close: each rig quantity eases independently,
      // so pinning the pivot changes the target and nothing else.
      expect(on.azimuth).toBe(off.azimuth)
      expect(on.elevation).toBe(off.elevation)
      expect(on.distance).toBe(off.distance)
      // And the pivot IS pinned to the node, every frame, unsmoothed.
      expect(on.target).toEqual([14.5, -7.25, 3])
    },
  )

  it('moves the camera at all while following — the bug, measured', () => {
    // The regression itself: 0.000° of motion over 30 frames of orbit drag with
    // Follow on, against −34.97° with it off, is what the desktop measured.
    const on = drive(gestures.orbit, true)
    expect(Math.abs(on.azimuth - rig().azimuth)).toBeGreaterThan(10)
  })

  it('leaves the aim and zoom goals alone, mid-glide', () => {
    const s = new CameraSmoothing()
    s.tau = TAU_ANTZ
    s.snap(rig())
    s.goal.azimuth = 90 // a drag aims elsewhere
    s.goal.distance = 250
    s.goal.elevation = 40
    followPivot(s, rig(), [1, 2, 3])
    expect(s.goal.azimuth).toBe(90)
    expect(s.goal.distance).toBe(250)
    expect(s.goal.elevation).toBe(40)
    expect(s.goal.target).toEqual([1, 2, 3])
  })

  it('gives the goal its own target array — goal and actual must never alias', () => {
    const s = new CameraSmoothing()
    const point: [number, number, number] = [1, 2, 3]
    const actual = followPivot(s, rig(), point)
    point[0] = 99
    actual.target[1] = 99
    expect(s.goal.target).toEqual([1, 2, 3])
  })
})

// --- the rig conversion the glide runs in -----------------------------------

describe('OrbitRig conversion', () => {
  it('round-trips an eye/target pair', () => {
    const source = rig({ azimuth: -117.5, elevation: 33.25, distance: 42.5, target: [3, -4, 5] })
    const back = rigFromView(eyeFromRig(source), source.target)!
    expect(back.azimuth).toBeCloseTo(source.azimuth, 9)
    expect(back.elevation).toBeCloseTo(source.elevation, 9)
    expect(back.distance).toBeCloseTo(source.distance, 9)
    expect(back.target).toEqual(source.target)
  })

  it('returns null for a degenerate arm — there are no angles to ease', () => {
    expect(rigFromView([1, 2, 3], [1, 2, 3])).toBeNull()
  })

  it('clamps elevation to ±89°, where the rig has always stopped', () => {
    // OrbitControls can reach the pole exactly; the rig cannot represent it,
    // so a glide stops one degree short (smoothOrbitControls.ts says so too).
    expect(rigFromView([0, 0, 10], [0, 0, 0])!.elevation).toBe(89)
    expect(rigFromView([0, 0, -10], [0, 0, 0])!.elevation).toBe(-89)
  })
})
