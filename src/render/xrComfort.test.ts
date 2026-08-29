import { describe, expect, it } from 'vitest'
import {
  SNAP_ANGLES,
  SNAP_FIRE,
  SNAP_REARM,
  VIGNETTE_APERTURE_RAD,
  VIGNETTE_ATTACK_MS,
  VIGNETTE_BAND_RAD,
  VIGNETTE_EPSILON,
  VIGNETTE_LEVELS,
  VIGNETTE_REF_SPEED_MPS,
  VIGNETTE_REF_TURN_DPS,
  VIGNETTE_RELEASE_MS,
  advanceVignette,
  cycleSnapDegrees,
  cycleTurnMode,
  cycleVignette,
  defaultComfort,
  snapTurnStep,
  vignetteAperture,
  vignetteTarget,
  type ComfortSettings,
} from './xrComfort'
import { MOVE_SPEED_MPS, STICK_DEADZONE, TURN_SPEED_RAD } from './xrNav'

function comfort(overrides: Partial<ComfortSettings> = {}): ComfortSettings {
  return { ...defaultComfort(), ...overrides }
}

describe('defaults', () => {
  it('leaves turning as it already was, and arms a light tunnel', () => {
    // Smooth turn is the behaviour confirmed on hardware; snap is a large
    // change in feel to impose on someone it suits. The tunnel is the half that
    // protects a newcomer without a veteran noticing, so it starts on.
    const d = defaultComfort()
    expect(d.turn).toBe('smooth')
    expect(d.vignette).toBe('light')
    expect(SNAP_ANGLES).toContain(d.snapDegrees)
  })
})

describe('snapTurnStep', () => {
  it('fires once on a flick and not again until the stick comes back', () => {
    let armed = true
    const push = (x: number) => {
      const r = snapTurnStep(armed, x)
      armed = r.armed
      return r.turns
    }
    expect(push(1)).toBe(1)
    // Held at full deflection: no auto-repeat, by design.
    expect(push(1)).toBe(0)
    expect(push(1)).toBe(0)
    // Half way back is not far enough — that gap is what stops a thumb resting
    // near the threshold turning the world into a strobe.
    expect(push(0.5)).toBe(0)
    expect(push(1)).toBe(0)
    // All the way back re-arms, and the next flick fires.
    expect(push(0)).toBe(0)
    expect(push(1)).toBe(1)
  })

  it('turns both ways, in flyStep’s own sense', () => {
    expect(snapTurnStep(true, 1).turns).toBe(1)
    expect(snapTurnStep(true, -1).turns).toBe(-1)
  })

  it('ignores a stick short of the firing threshold', () => {
    expect(snapTurnStep(true, SNAP_FIRE - 0.01).turns).toBe(0)
    expect(snapTurnStep(true, SNAP_FIRE).turns).toBe(1)
  })

  it('re-arms symmetrically, whichever way the last flick went', () => {
    expect(snapTurnStep(false, SNAP_REARM + 0.01).armed).toBe(false)
    expect(snapTurnStep(false, -(SNAP_REARM + 0.01)).armed).toBe(false)
    expect(snapTurnStep(false, SNAP_REARM - 0.01).armed).toBe(true)
  })

  it('demands a deliberate flick, well past the flight dead zone', () => {
    // A stick nudged just enough to fly must never also snap the world round.
    expect(SNAP_REARM).toBeGreaterThan(STICK_DEADZONE)
    expect(SNAP_FIRE).toBeGreaterThan(SNAP_REARM)
    expect(snapTurnStep(true, STICK_DEADZONE + 0.05).turns).toBe(0)
  })
})

describe('vignetteTarget', () => {
  it('is nothing at all while the viewer is still', () => {
    expect(vignetteTarget(comfort(), 0, 0)).toBe(0)
  })

  it('is full at the app’s own top flight speed', () => {
    expect(vignetteTarget(comfort(), MOVE_SPEED_MPS, 0)).toBe(1)
    expect(VIGNETTE_REF_SPEED_MPS).toBe(MOVE_SPEED_MPS)
  })

  it('is full at the app’s own top turn rate', () => {
    const dps = (TURN_SPEED_RAD * 180) / Math.PI
    expect(vignetteTarget(comfort(), 0, dps)).toBe(1)
    expect(VIGNETTE_REF_TURN_DPS).toBeCloseTo(dps, 12)
  })

  it('scales with speed in between', () => {
    expect(vignetteTarget(comfort(), MOVE_SPEED_MPS / 2, 0)).toBeCloseTo(0.5, 12)
  })

  it('takes the WORSE of translation and rotation, never their sum', () => {
    // They are one discomfort reported twice. Summing would put a gentle
    // curving flight past full strength for no extra reason.
    const both = vignetteTarget(comfort(), MOVE_SPEED_MPS / 2, VIGNETTE_REF_TURN_DPS / 4)
    expect(both).toBeCloseTo(0.5, 12)
  })

  it('is unsigned — flying backwards is as much motion as flying forwards', () => {
    expect(vignetteTarget(comfort(), -MOVE_SPEED_MPS, 0)).toBe(1)
    expect(vignetteTarget(comfort(), 0, -VIGNETTE_REF_TURN_DPS)).toBe(1)
  })

  it('clamps rather than running past full', () => {
    expect(vignetteTarget(comfort(), MOVE_SPEED_MPS * 40, 0)).toBe(1)
  })

  it('stays at zero when the setting is off, however fast the viewer moves', () => {
    expect(vignetteTarget(comfort({ vignette: 'off' }), MOVE_SPEED_MPS * 10, 999)).toBe(0)
  })
})

describe('advanceVignette', () => {
  it('closes faster than it opens', () => {
    // It has to be there BEFORE the optical flow builds; opening in a hurry
    // makes it flicker on every small stick correction.
    expect(VIGNETTE_ATTACK_MS).toBeLessThan(VIGNETTE_RELEASE_MS)
    const closing = advanceVignette(0, 1, 50)
    const opening = 1 - advanceVignette(1, 0, 50)
    expect(closing).toBeGreaterThan(opening)
  })

  it('approaches monotonically and lands exactly', () => {
    let v = 0
    for (let i = 0; i < 200; i++) {
      const next = advanceVignette(v, 1, 16)
      expect(next).toBeGreaterThanOrEqual(v)
      v = next
    }
    expect(v).toBe(1)
  })

  it('really does switch off rather than approaching zero forever', () => {
    let v = 1
    for (let i = 0; i < 400; i++) v = advanceVignette(v, 0, 16)
    expect(v).toBe(0)
  })

  it('is frame-rate independent', () => {
    // One 100 ms step and ten 10 ms ones reach the same place, so a scene that
    // drops frames does not also change how the tunnel feels.
    let fine = 0
    for (let i = 0; i < 10; i++) fine = advanceVignette(fine, 1, 10)
    expect(advanceVignette(0, 1, 100)).toBeCloseTo(fine, 12)
  })

  it('takes the target outright on a zero-length frame', () => {
    expect(advanceVignette(0.5, 1, 0)).toBe(1)
  })
})

describe('vignetteAperture', () => {
  it('draws nothing at rest, or when switched off', () => {
    expect(vignetteAperture(comfort(), 0)).toBeNull()
    expect(vignetteAperture(comfort(), VIGNETTE_EPSILON)).toBeNull()
    expect(vignetteAperture(comfort({ vignette: 'off' }), 1)).toBeNull()
  })

  it('closes to the level’s own aperture at full strength', () => {
    for (const level of VIGNETTE_LEVELS) {
      if (level === 'off') continue
      const a = vignetteAperture(comfort({ vignette: level }), 1)!
      expect(a.inner).toBeCloseTo(VIGNETTE_APERTURE_RAD[level], 12)
      expect(a.outer).toBeCloseTo(VIGNETTE_APERTURE_RAD[level] + VIGNETTE_BAND_RAD, 12)
    }
  })

  it('fades IN rather than opening out, so the whole range does something', () => {
    // Widening the aperture with slowness cannot work: to be invisible at rest
    // it would have to open past what a headset displays (~55° half-angle), so
    // the tunnel would pop in around three-quarter speed instead of fading in.
    // Measured before the change: nothing visible below an intensity of 0.71.
    const faint = vignetteAperture(comfort(), 0.1)!
    const full = vignetteAperture(comfort(), 1)!
    expect(faint.inner).toBe(full.inner)
    expect(faint.alpha).toBeCloseTo(0.1, 12)
    expect(full.alpha).toBe(1)
    // And the shape is inside the field of view at EVERY intensity, so a slow
    // drift is a faint tunnel rather than nothing at all.
    expect(faint.inner).toBeLessThan((55 * Math.PI) / 180)
  })

  it('narrows as the levels step up, and every one of them bites', () => {
    const at = (level: 'light' | 'medium' | 'strong') =>
      vignetteAperture(comfort({ vignette: level }), 1)!.inner
    expect(at('light')).toBeGreaterThan(at('medium'))
    expect(at('medium')).toBeGreaterThan(at('strong'))
    // An aperture wider than the headset can show is not a light vignette, it
    // is no vignette — this is the check that keeps the numbers honest.
    expect(at('light')).toBeLessThan((55 * Math.PI) / 180)
  })

  it('always keeps the soft edge outside the clear centre', () => {
    for (const intensity of [0.02, 0.2, 0.5, 0.8, 1]) {
      const a = vignetteAperture(comfort({ vignette: 'strong' }), intensity)!
      expect(a.outer).toBeGreaterThan(a.inner)
    }
  })

  it('darkens monotonically with intensity, and holds its shape', () => {
    let previous = -1
    const shapes = new Set<number>()
    for (let t = 0.05; t <= 1.0001; t += 0.05) {
      const a = vignetteAperture(comfort({ vignette: 'medium' }), t)!
      expect(a.alpha).toBeGreaterThan(previous)
      previous = a.alpha
      shapes.add(a.inner)
    }
    // One aperture throughout: "Medium" means the same tunnel whether you are
    // drifting or at full pelt, only fainter.
    expect(shapes.size).toBe(1)
  })

  it('clamps the opacity rather than running past opaque', () => {
    expect(vignetteAperture(comfort(), 4)!.alpha).toBe(1)
  })
})

describe('cycling', () => {
  it('wraps, like every other cycle in this app', () => {
    expect(cycleTurnMode('smooth', 1)).toBe('snap')
    expect(cycleTurnMode('snap', 1)).toBe('smooth')
    expect(cycleTurnMode('smooth', -1)).toBe('snap')
    expect(cycleVignette('off', -1)).toBe('strong')
    expect(cycleVignette('strong', 1)).toBe('off')
    expect(cycleSnapDegrees(SNAP_ANGLES[SNAP_ANGLES.length - 1], 1)).toBe(SNAP_ANGLES[0])
    expect(cycleSnapDegrees(SNAP_ANGLES[0], -1)).toBe(SNAP_ANGLES[SNAP_ANGLES.length - 1])
  })

  it('recovers from a value that is not on the list', () => {
    // A hand-set angle (or an older stored one) must not strand the stepper.
    expect(SNAP_ANGLES).toContain(cycleSnapDegrees(37, 1))
  })
})
