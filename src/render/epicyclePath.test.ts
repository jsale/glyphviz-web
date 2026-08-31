// The traced path is what the trail is built from, so the one thing this file
// has to establish is that the fast linear walk in `epicyclePath.ts` is not a
// SECOND opinion about placement — it has to agree with the app's general
// answer, `worldPlacements`, which is itself built on `applyFrameTransform`.
//
// The desktop's `trace_path` reads a live `Scene` for exactly this reason. Its
// numeric results are pinned against ours by `epicycles.parity.test.ts`; what
// is pinned here is the internal consistency that lets the shortcut exist.

import { describe, expect, it } from 'vitest'
import {
  chainNodes,
  closureFrames,
  defaultArm,
  defaultDesign,
  preset,
} from '../gv/epicycles'
import { NodeType } from '../gv/types'
import { DEFAULT_BASE_SCALE, setBaseScale } from './baseScale'
import { traceEpicyclePath } from './epicyclePath'
import { worldPlacements } from './selectionPlacement'

/** The same trace, through the general per-scene placement pass. */
function traceViaWorldPlacements(design: ReturnType<typeof preset>, frames: number) {
  const all = chainNodes(design, { startId: 1, parentId: 0, baseBranch: 0, animated: true })
  const chain = all.filter((n) => n.type === NodeType.Glyph)
  const pen = chain[chain.length - 1].id
  const out: Array<readonly [number, number, number]> = []
  for (let f = 0; f < frames; f++) {
    design.arms.forEach((arm, k) => {
      chain[k + 1].translate.x = arm.phaseX + arm.rateX * f
      chain[k + 1].translate.y = arm.phaseY + arm.rateY * f
    })
    out.push(worldPlacements(all).get(pen)!.pos)
  }
  return out
}

describe('traceEpicyclePath', () => {
  for (const key of ["Jeff's ANTz original", 'Rose in space', 'Torus knot (tube)']) {
    it(`agrees with worldPlacements for "${key}"`, () => {
      const design = preset(key)
      const frames = 90
      const fast = traceEpicyclePath(design, frames)
      const general = traceViaWorldPlacements(preset(key), frames)
      expect(fast).toHaveLength(frames)
      fast.forEach((p, f) => {
        expect(p.x).toBeCloseTo(general[f][0], 12)
        expect(p.y).toBeCloseTo(general[f][1], 12)
        expect(p.z).toBeCloseTo(general[f][2], 12)
      })
    })
  }

  it('leaves the design it was handed untouched', () => {
    // It mutates the chain rows it builds, not the arms it was given — an
    // Insert into Scene straight after a trace must write the authored phases.
    const design = preset("Jeff's ANTz original")
    traceEpicyclePath(design, 60)
    expect(design.arms.map((a) => a.phaseX)).toEqual([0, 90, 90, 90])
  })

  it('closes: at the reported period the pen is back where it started', () => {
    // The claim the readout makes is geometric, not arithmetic.
    for (const key of ['Cardioid (2 terms)', 'Spirograph (hypotrochoid)', 'Rose in space']) {
      const design = preset(key)
      const n = closureFrames(design)!
      expect(n).toBeGreaterThan(0)
      const path = traceEpicyclePath(design, n + 1)
      expect(Math.hypot(path[n].x - path[0].x, path[n].y - path[0].y, path[n].z - path[0].z))
        .toBeLessThan(1e-9)
    }
  })

  it('arm lengths are world units at every depth', () => {
    // `length` is produced by the SCALE of the node one level up, telescoped by
    // the builder — so consecutive nodes really are `length` apart in world
    // space whatever the depth.
    const lengths = [12, 7, 4.5, 1.5]
    const design = defaultDesign({
      arms: lengths.map((v) => defaultArm({ length: v, rateX: 1 })),
    })
    const all = chainNodes(design, { startId: 1, parentId: 0, baseBranch: 0, animated: true })
    const chain = all.filter((n) => n.type === NodeType.Glyph)
    const placements = worldPlacements(all)
    for (let k = 0; k < lengths.length; k++) {
      const a = placements.get(chain[k].id)!.pos
      const b = placements.get(chain[k + 1].id)!.pos
      expect(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])).toBeCloseTo(lengths[k], 9)
    }
  })

  it('tube is carved OUT of the arm, not added to it', () => {
    // At phase_y 0 the child sits on the tube's outer equator, exactly `length`
    // from its parent; half a tube turn later it is at length − 2·tube. That is
    // what makes the parent's DRAWN ring the circle its child rides, and it is
    // why the tube is the parent's `ratio` rather than the child's translate_z
    // (which also works, but draws nothing and lengthens the arm).
    const design = defaultDesign({
      arms: [
        defaultArm({ length: 12, rateX: 1 }),
        defaultArm({ length: 6, rateX: 1, tube: 3, rateY: 4 }),
      ],
    })
    const all = chainNodes(design, { startId: 1, parentId: 0, baseBranch: 0, animated: true })
    const chain = all.filter((n) => n.type === NodeType.Glyph)
    expect(chain[1].ratio).toBeCloseTo(3 / 6, 12)

    const at = (): number => {
      const p = worldPlacements(all)
      const a = p.get(chain[1].id)!.pos
      const b = p.get(chain[2].id)!.pos
      return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    }
    expect(at()).toBeCloseTo(6, 9)
    chain[2].translate.y = 180
    expect(at()).toBeCloseTo(0, 9)
  })

  it('the (90, 90) rotation is load-bearing: without it the chain leaves the plane', () => {
    // It looks like an arbitrary pose and is not — it is what makes the
    // construction a Fourier series at all.
    const design = defaultDesign({
      arms: [1, -1, 1, -1].map((r) => defaultArm({ length: 10, rateX: r })),
    })
    const good = traceEpicyclePath(design, 360)
    expect(Math.max(...good.map((p) => Math.abs(p.z)))).toBeLessThan(1e-9)

    const all = chainNodes(design, { startId: 1, parentId: 0, baseBranch: 0, animated: true })
    const chain = all.filter((n) => n.type === NodeType.Glyph)
    for (const node of chain.slice(1)) node.rotate.x = node.rotate.y = 0
    let worstZ = 0
    for (let f = 0; f < 360; f++) {
      design.arms.forEach((arm, k) => {
        chain[k + 1].translate.x = arm.rateX * f
      })
      worstZ = Math.max(worstZ, Math.abs(worldPlacements(all).get(chain[chain.length - 1].id)!.pos[2]))
    }
    expect(worstZ).toBeGreaterThan(10)
  })

  it('tilt leans the orbit plane by exactly that many degrees', () => {
    // `Arm.tilt` is written as the PARENT's rotate_y, and rotate_y is the field
    // that tips a ring plane — rotate_x and rotate_z do not, at this base pose.
    for (const tilt of [0, 15, 30, 60, 90]) {
      const design = defaultDesign({
        arms: [
          defaultArm({ length: 10, rateX: 1 }),
          defaultArm({ length: 5, rateX: 1, tilt }),
        ],
      })
      const all = chainNodes(design, { startId: 1, parentId: 0, baseBranch: 0, animated: true })
      const chain = all.filter((n) => n.type === NodeType.Glyph)
      const basis = worldPlacements(all).get(chain[1].id)!.basis
      // The frame's third basis column, normalised: the ring plane's normal.
      const z = [basis[0][2], basis[1][2], basis[2][2]]
      const len = Math.hypot(z[0], z[1], z[2])
      const got = (Math.acos(Math.min(1, Math.abs(z[2] / len))) * 180) / Math.PI
      expect(got).toBeCloseTo(tilt, 6)
    }
  })

  it('scales with the live Global Scale, because the whole chain does', () => {
    // A Torus base radius IS the Global Scale, so every offset in the chain is
    // proportional to it — which is why the trace is taken at whatever the app
    // is drawing at rather than at a fixed 1.0.
    const design = preset('Cardioid (2 terms)')
    const one = traceEpicyclePath(design, 12)
    try {
      setBaseScale(2)
      const two = traceEpicyclePath(design, 12)
      two.forEach((p, i) => {
        expect(p.x).toBeCloseTo(one[i].x * 2, 9)
        expect(p.y).toBeCloseTo(one[i].y * 2, 9)
        expect(p.z).toBeCloseTo(one[i].z * 2, 9)
      })
    } finally {
      setBaseScale(DEFAULT_BASE_SCALE)
    }
  })
})
