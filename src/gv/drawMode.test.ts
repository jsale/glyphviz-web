import { describe, expect, it } from 'vitest'
import { blankNode, NEW_OBJECT_DEFAULTS } from './createNode'
import { placeStamp, shouldStamp, type StampRandom } from './drawMode'
import { generateNodes } from './glyphRecipe'
import { defaultRecipe } from './glyphRecipe'
import type { GvNode } from './types'

/** An rng whose draws are known, so a jitter assertion can be exact. */
function fixedRandom(values: number[]): StampRandom {
  let i = 0
  return { uniform: (a, b) => a + (b - a) * (values[i++ % values.length] ?? 0) }
}

function stampNodes(baseLevel: number): GvNode[] {
  const root = blankNode(1, NEW_OBJECT_DEFAULTS)
  root.branchLevel = baseLevel
  const child = blankNode(2, NEW_OBJECT_DEFAULTS)
  child.parentId = 1
  child.branchLevel = baseLevel + 1
  child.translate = { x: 3, y: 0, z: 0 }
  return [root, child]
}

describe('shouldStamp', () => {
  it('always stamps the first point of a stroke', () => {
    expect(shouldStamp(null, 0, 0, 30)).toBe(true)
    expect(shouldStamp(null, 0, 0, 0)).toBe(true)
  })

  it('gates on distance from the previous stamp, inclusive', () => {
    const last = { x: 100, y: 100 }
    expect(shouldStamp(last, 120, 100, 30)).toBe(false)
    expect(shouldStamp(last, 130, 100, 30)).toBe(true) // exactly spacing counts
    expect(shouldStamp(last, 100, 131, 30)).toBe(true)
    // 3-4-5: 30 px of travel diagonally is still 30 px.
    expect(shouldStamp(last, 118, 124, 30)).toBe(true)
    expect(shouldStamp(last, 117, 123, 30)).toBe(false)
  })

  it('spacing 0 stamps on every move, including no movement at all', () => {
    expect(shouldStamp({ x: 5, y: 5 }, 5, 5, 0)).toBe(true)
  })
})

describe('placeStamp', () => {
  it('offsets only the stamp roots — deeper nodes ride along', () => {
    const nodes = stampNodes(1)
    placeStamp(nodes, 1, -117.16, 32.71, 4)
    expect(nodes[0].translate).toEqual({ x: -117.16, y: 32.71, z: 4 })
    expect(nodes[1].translate).toEqual({ x: 3, y: 0, z: 0 })
  })

  it('adds to the root translate rather than replacing it', () => {
    const nodes = stampNodes(0)
    nodes[0].translate = { x: 1, y: 2, z: 3 }
    placeStamp(nodes, 0, 10, 20, 30)
    expect(nodes[0].translate).toEqual({ x: 11, y: 22, z: 33 })
  })

  it('offsets every root of a multi-root stamp', () => {
    const nodes = stampNodes(2)
    const second = blankNode(3, NEW_OBJECT_DEFAULTS)
    second.branchLevel = 2
    second.translate = { x: 5, y: 0, z: 0 }
    nodes.push(second)
    placeStamp(nodes, 2, 100, 50, 0)
    expect(nodes[0].translate.x).toBe(100)
    expect(nodes[2].translate.x).toBe(105) // its own layout offset is kept
  })

  it('leaves the rng untouched when both jitters are off', () => {
    let draws = 0
    const rng: StampRandom = {
      uniform: (a, b) => {
        draws++
        return (a + b) / 2
      },
    }
    const jitter = placeStamp(stampNodes(0), 0, 0, 0, 0, 0, 0, rng)
    expect(draws).toBe(0)
    expect(jitter).toEqual({ heading: 0, factor: 1 })
  })

  it('draws heading in ±deg and scale in ±percent', () => {
    // uniform() draws in order: heading first, then the scale factor.
    const nodes = stampNodes(0)
    const jitter = placeStamp(nodes, 0, 0, 0, 0, 45, 20, fixedRandom([1, 0]))
    expect(jitter.heading).toBeCloseTo(45, 12) // top of [−45, +45]
    expect(jitter.factor).toBeCloseTo(0.8, 12) // bottom of [0.8, 1.2]
    expect(nodes[0].rotate.z).toBeCloseTo(45, 12)
    expect(nodes[0].scale).toEqual({ x: 0.8, y: 0.8, z: 0.8 })
  })

  it('stays within its bounds over many draws', () => {
    for (let i = 0; i < 500; i++) {
      const { heading, factor } = placeStamp(stampNodes(0), 0, 0, 0, 0, 30, 25)
      expect(heading).toBeGreaterThanOrEqual(-30)
      expect(heading).toBeLessThanOrEqual(30)
      expect(factor).toBeGreaterThanOrEqual(0.75)
      expect(factor).toBeLessThanOrEqual(1.25)
    }
  })

  it('draws ONE value per stamp, so a multi-root stamp stays coherent', () => {
    const nodes = stampNodes(0)
    const sibling = blankNode(3, NEW_OBJECT_DEFAULTS)
    sibling.branchLevel = 0
    nodes.push(sibling)
    placeStamp(nodes, 0, 0, 0, 0, 60, 40)
    expect(nodes[2].rotate.z).toBe(nodes[0].rotate.z)
    expect(nodes[2].scale.x).toBe(nodes[0].scale.x)
  })

  it('scales all three root axes by the same factor, preserving proportions', () => {
    const nodes = stampNodes(0)
    nodes[0].scale = { x: 3, y: 1, z: 1 }
    const { factor } = placeStamp(nodes, 0, 0, 0, 0, 0, 50)
    expect(nodes[0].scale.x / nodes[0].scale.y).toBeCloseTo(3, 12)
    expect(nodes[0].scale.x).toBeCloseTo(3 * factor, 12)
  })

  it('leaves a hyperglyph subtree orbiting its root at unchanged radius', () => {
    // The root's rotate_z turns the whole subtree through the hierarchy, so a
    // child's own translate — its radius on the parent's topology — must not
    // be touched by the jitter draw.
    const recipe = defaultRecipe()
    const nodes = generateNodes(recipe, { startId: 10, parentId: 4, baseBranchLevel: 1 })
    const before = nodes.filter((n) => n.branchLevel > 1).map((n) => ({ ...n.translate }))
    placeStamp(nodes, 1, -70, 40, 2, 180, 50)
    const after = nodes.filter((n) => n.branchLevel > 1).map((n) => n.translate)
    expect(after).toEqual(before)
    // …and every root did move to the stamp point.
    for (const root of nodes.filter((n) => n.branchLevel === 1)) {
      expect(root.translate.z).toBeCloseTo(2, 12)
    }
  })
})
