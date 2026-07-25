import { describe, expect, it } from 'vitest'
import { createRootNode } from './createNode'
import type { GvNode } from './types'
import { NodeType, WORLD_DEFAULT_BG } from './types'
import { backgroundRgb, ensureWorldNode, toggledBwBackground, worldNodeOf } from './worldNode'

function node(overrides: Partial<GvNode> = {}): GvNode {
  return Object.assign(createRootNode([]), overrides)
}

describe('worldNodeOf', () => {
  it('finds the World row', () => {
    const world = node({ id: 7, type: NodeType.World })
    expect(worldNodeOf([node({ id: 1 }), world])).toBe(world)
  })

  it('takes the LOWEST id when a file has several, like the desktop', () => {
    const low = node({ id: 2, type: NodeType.World })
    const high = node({ id: 9, type: NodeType.World })
    expect(worldNodeOf([high, low])).toBe(low)
  })

  it('is null for a scene without one', () => {
    expect(worldNodeOf([node({ id: 1 })])).toBeNull()
  })
})

describe('backgroundRgb', () => {
  it('reads the World row colour', () => {
    const world = node({ id: 1, type: NodeType.World })
    world.color = { r: 10, g: 20, b: 30, a: 255 }
    expect(backgroundRgb([world])).toEqual({ r: 10, g: 20, b: 30 })
  })

  it('falls back to the default without a World row', () => {
    expect(backgroundRgb([node({ id: 1 })])).toEqual({
      r: WORLD_DEFAULT_BG.r,
      g: WORLD_DEFAULT_BG.g,
      b: WORLD_DEFAULT_BG.b,
    })
  })
})

describe('ensureWorldNode', () => {
  it('returns the existing row without appending', () => {
    const world = node({ id: 3, type: NodeType.World })
    const nodes = [node({ id: 1 }), world]
    expect(ensureWorldNode(nodes)).toBe(world)
    expect(nodes).toHaveLength(2)
  })

  it('synthesizes one at max id + 1 — never 0, which is the root sentinel', () => {
    const nodes = [node({ id: 4 }), node({ id: 9 })]
    const world = ensureWorldNode(nodes)
    expect(world.id).toBe(10)
    expect(world.type).toBe(NodeType.World)
    expect(world.color).toEqual({ ...WORLD_DEFAULT_BG })
    expect(nodes).toHaveLength(3)
    expect(worldNodeOf(nodes)).toBe(world)
  })
})

describe('toggledBwBackground', () => {
  it('flips a dark background to white and a light one to black', () => {
    expect(toggledBwBackground({ r: 20, g: 20, b: 31 })).toBe(255)
    expect(toggledBwBackground({ r: 255, g: 255, b: 255 })).toBe(0)
  })

  it('uses the desktop threshold of red ≥ 128', () => {
    expect(toggledBwBackground({ r: 127, g: 0, b: 0 })).toBe(255)
    expect(toggledBwBackground({ r: 128, g: 0, b: 0 })).toBe(0)
  })
})
