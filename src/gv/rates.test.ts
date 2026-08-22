import { describe, expect, it } from 'vitest'
import {
  applyRateAnimation,
  hasActiveRates,
  rateCandidates,
  restoreRates,
  snapshotAndZeroRates,
  RATE_CYCLE_MS,
} from './rates'
import { parseGvNodeCsv } from './nodeCsv'
import type { GvNode } from './types'

const HEADER =
  'id,type,parent_id,branch_level,translate_x,translate_y,translate_z,rotate_x,rotate_y,' +
  'rotate_z,scale_x,scale_y,scale_z,color_r,color_g,color_b,color_a,geometry,hide,topo,' +
  'translate_rate_x,rotate_rate_z,scale_rate_x,freeze'

function scene(...rows: Array<Partial<Record<string, number>>>): GvNode[] {
  const text = [
    HEADER,
    ...rows.map((overrides, i) => {
      const base: Record<string, number> = {
        id: i + 1,
        type: 5,
        parent_id: 0,
        branch_level: 0,
        translate_x: 0,
        translate_y: 0,
        translate_z: 0,
        rotate_x: 0,
        rotate_y: 0,
        rotate_z: 0,
        scale_x: 1,
        scale_y: 1,
        scale_z: 1,
        color_r: 0,
        color_g: 0,
        color_b: 0,
        color_a: 255,
        geometry: 1,
        hide: 0,
        topo: 0,
        translate_rate_x: 0,
        rotate_rate_z: 0,
        scale_rate_x: 0,
        freeze: 0,
        ...overrides,
      }
      return HEADER.split(',').map((name) => String(base[name])).join(',')
    }),
  ].join('\n')
  const parsed = parseGvNodeCsv(text)
  expect(parsed.errors).toEqual([])
  return parsed.nodes
}

describe('hasActiveRates', () => {
  it('is false for a node with no rates', () => {
    expect(hasActiveRates(scene({})[0])).toBe(false)
  })

  it('is true for any nonzero rate', () => {
    expect(hasActiveRates(scene({ rotate_rate_z: 0.5 })[0])).toBe(true)
    expect(hasActiveRates(scene({ translate_rate_x: -1 })[0])).toBe(true)
    expect(hasActiveRates(scene({ scale_rate_x: 0.01 })[0])).toBe(true)
  })

  it('reads the freeze column as a number, not a truthy string', () => {
    // The trap this guards: extras values are strings, and '0' is truthy in JS,
    // so a naive check would freeze every node in a file that has the column.
    expect(hasActiveRates(scene({ rotate_rate_z: 1, freeze: 0 })[0])).toBe(true)
    expect(hasActiveRates(scene({ rotate_rate_z: 1, freeze: 1 })[0])).toBe(false)
  })
})

describe('rateCandidates', () => {
  it('picks nodes with a nonzero rate plus anything a channel drives', () => {
    const nodes = scene({}, { rotate_rate_z: 2 }, {})
    expect(rateCandidates(nodes).map((n) => n.id)).toEqual([2])
    // Node 3's rate is 0 now but a channel binding can raise it mid-playback.
    expect(rateCandidates(nodes, new Set([3])).map((n) => n.id)).toEqual([2, 3])
  })
})

describe('applyRateAnimation', () => {
  it('integrates one cycle worth of each rate per 1/60 s', () => {
    const nodes = scene({ translate_rate_x: 2, rotate_rate_z: 30, scale_rate_x: 0.5 })
    const moved = applyRateAnimation(nodes, RATE_CYCLE_MS)
    expect([...moved]).toEqual([1])
    expect(nodes[0].translate.x).toBeCloseTo(2, 12)
    expect(nodes[0].rotate.z).toBeCloseTo(30, 12)
    expect(nodes[0].scale.x).toBeCloseTo(1.5, 12)
  })

  it('scales with elapsed time, so the motion is frame-rate independent', () => {
    const fast = scene({ rotate_rate_z: 1 })
    const slow = scene({ rotate_rate_z: 1 })
    for (let i = 0; i < 4; i++) applyRateAnimation(fast, RATE_CYCLE_MS / 4)
    applyRateAnimation(slow, RATE_CYCLE_MS)
    expect(fast[0].rotate.z).toBeCloseTo(slow[0].rotate.z, 12)
  })

  it('skips frozen nodes and reports nothing moved', () => {
    const nodes = scene({ rotate_rate_z: 10, freeze: 1 })
    expect(applyRateAnimation(nodes, RATE_CYCLE_MS).size).toBe(0)
    expect(nodes[0].rotate.z).toBe(0)
  })

  it('does nothing for a non-positive dt', () => {
    const nodes = scene({ rotate_rate_z: 10 })
    expect(applyRateAnimation(nodes, 0).size).toBe(0)
    expect(nodes[0].rotate.z).toBe(0)
  })

  it('only reports the axis groups that actually have a rate', () => {
    const nodes = scene({ rotate_rate_z: 1 }, {})
    const moved = applyRateAnimation(nodes, RATE_CYCLE_MS)
    expect([...moved]).toEqual([1])
    expect(nodes[1].translate.x).toBe(0)
  })
})

// --- Pause / resume (desktop View ▸ Pause Rate Animation [P]) -----------------

const byId = (nodes: GvNode[]) => new Map(nodes.map((n) => [n.id, n]))

describe('snapshotAndZeroRates', () => {
  it('zeroes every rate field and hands back what it took', () => {
    const nodes = scene({ translate_rate_x: 2, rotate_rate_z: 30, scale_rate_x: 0.5 })
    const snapshot = snapshotAndZeroRates(nodes)
    expect(snapshot.get(1)).toEqual({
      translateRate: { x: 2, y: 0, z: 0 },
      rotateRate: { x: 0, y: 0, z: 30 },
      scaleRate: { x: 0.5, y: 0, z: 0 },
    })
    expect(nodes[0].translateRate).toEqual({ x: 0, y: 0, z: 0 })
    expect(nodes[0].rotateRate).toEqual({ x: 0, y: 0, z: 0 })
    expect(nodes[0].scaleRate).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('is what makes a paused scene genuinely static', () => {
    const nodes = scene({ rotate_rate_z: 10 })
    snapshotAndZeroRates(nodes)
    expect(applyRateAnimation(rateCandidates(nodes), RATE_CYCLE_MS).size).toBe(0)
    expect(nodes[0].rotate.z).toBe(0)
  })

  it('skips nodes that carry no rate at all', () => {
    const nodes = scene({ rotate_rate_z: 1 }, {}, { translate_rate_x: -3 })
    expect([...snapshotAndZeroRates(nodes).keys()]).toEqual([1, 3])
  })

  it('takes a FROZEN node too — the desktop tests the nine fields, not freeze', () => {
    const nodes = scene({ rotate_rate_z: 7, freeze: 1 })
    expect(snapshotAndZeroRates(nodes).has(1)).toBe(true)
    expect(nodes[0].rotateRate.z).toBe(0)
  })

  it('snapshots by value, so a later edit cannot rewrite what resume restores', () => {
    const nodes = scene({ rotate_rate_z: 4 })
    const snapshot = snapshotAndZeroRates(nodes)
    nodes[0].rotateRate.z = 99
    restoreRates(snapshot, byId(nodes))
    expect(nodes[0].rotateRate.z).toBe(4)
  })
})

describe('restoreRates', () => {
  it('puts every rate back exactly and counts the nodes it reached', () => {
    const nodes = scene({ translate_rate_x: 2, rotate_rate_z: -30 }, { scale_rate_x: 0.25 })
    const rates = (n: GvNode) => ({ t: { ...n.translateRate }, r: { ...n.rotateRate }, s: { ...n.scaleRate } })
    const before = nodes.map(rates)
    const snapshot = snapshotAndZeroRates(nodes)
    expect(restoreRates(snapshot, byId(nodes))).toBe(2)
    expect(nodes.map(rates)).toEqual(before)
    expect(rateCandidates(nodes).map((n) => n.id)).toEqual([1, 2])
  })

  it('skips a node deleted while paused rather than failing', () => {
    const nodes = scene({ rotate_rate_z: 1 }, { rotate_rate_z: 2 })
    const snapshot = snapshotAndZeroRates(nodes)
    const survivors = nodes.filter((n) => n.id !== 1)
    expect(restoreRates(snapshot, byId(survivors))).toBe(1)
    expect(survivors[0].rotateRate.z).toBe(2)
  })
})
