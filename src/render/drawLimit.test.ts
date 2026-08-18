import { describe, expect, it } from 'vitest'
import { buildScene } from './buildScene'
import {
  DRAW_LIMIT_DOUBLE,
  DRAW_LIMIT_HALVE,
  drawLimitPlan,
  drawLimitTotal,
  nextDrawLimit,
} from './drawLimit'
import { Geometry, NodeType, Topo } from '../gv/types'
import type { GvNode } from '../gv/types'

function makeNode(overrides: Partial<GvNode>): GvNode {
  return {
    id: 1,
    type: NodeType.Glyph,
    parentId: 0,
    branchLevel: 0,
    translate: { x: 0, y: 0, z: 0 },
    rotate: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    color: { r: 230, g: 230, b: 230, a: 255 },
    geometry: Geometry.CubeSolid,
    hide: 0,
    topo: 0,
    ratio: 0.1,
    topoScale: 1,
    subspace: 0,
    textureId: 0,
    meshId: 0,
    rotationMode: 1,
    colorIndex: 0,
    paletteId: 0,
    translateRate: { x: 0, y: 0, z: 0 },
    rotateRate: { x: 0, y: 0, z: 0 },
    scaleRate: { x: 0, y: 0, z: 0 },
    text: '',
    link: '',
    renderMode: 0,
    fogEnabled: 0,
    fogStart: 0,
    fogEnd: 0,
    showText: 0,
    tagColorMode: 0,
    tagColor: { r: 255, g: 255, b: 200 },
    tagFontSize: 11,
    refGridColor: { r: 56, g: 56, b: 71 },
    extras: {},
    ...overrides,
  }
}

/** `count` sibling root glyphs, ids 1..count, in file order. */
function roots(count: number, overrides: Partial<GvNode> = {}): GvNode[] {
  return Array.from({ length: count }, (_, i) =>
    makeNode({ id: i + 1, translate: { x: i * 3, y: 0, z: 0 }, ...overrides }),
  )
}

/**
 * Every node id that ended up with a FRAME in the built graph. Frames are the
 * `gv:<id>` objects the recursion creates; a stretched link glyph also carries
 * a nodeId (that is how a click on it resolves) but hangs off the link overlay
 * in world space, so it is not one.
 */
function frameIds(nodes: GvNode[], drawLimit: number | null): number[] {
  const built = buildScene(nodes, { drawLimit })
  const ids: number[] = []
  built.root.traverse((o) => {
    if (o.name.startsWith('gv:') && typeof o.userData.nodeId === 'number') {
      ids.push(o.userData.nodeId)
    }
  })
  return ids.sort((a, b) => a - b)
}

/** Every node id that ended up with a drawn glyph. */
function glyphIds(nodes: GvNode[], drawLimit: number | null): number[] {
  const built = buildScene(nodes, { drawLimit })
  const ids: number[] = []
  built.root.traverse((o) => {
    if (o.userData.isGlyph === true && typeof o.parent?.userData.nodeId === 'number') {
      ids.push(o.parent.userData.nodeId as number)
    }
  })
  return ids.sort((a, b) => a - b)
}

describe('drawLimitTotal', () => {
  it('counts every row but World and Camera', () => {
    const nodes = [
      makeNode({ id: 1, type: NodeType.World }),
      makeNode({ id: 2, type: NodeType.Camera }),
      makeNode({ id: 3 }),
      makeNode({ id: 4, type: NodeType.WorldGrid }),
    ]
    expect(drawLimitTotal(nodes)).toBe(2)
  })

  it('excludes hidden rows unless Show Hidden Nodes is on', () => {
    const nodes = [makeNode({ id: 1 }), makeNode({ id: 2, hide: 1 })]
    expect(drawLimitTotal(nodes)).toBe(1)
    expect(drawLimitTotal(nodes, { showHidden: true })).toBe(2)
  })

  it('keeps Link rows in the total, matching the desktop denominator', () => {
    // _adjust_draw_limit's total excludes only non-visual and hidden rows,
    // while its draw loop also skips links — deliberately mirrored.
    const nodes = [makeNode({ id: 1 }), makeNode({ id: 2, type: NodeType.Link, parentId: 1 })]
    expect(drawLimitTotal(nodes)).toBe(2)
  })
})

describe('nextDrawLimit', () => {
  it('halves from the total on the first press, then keeps halving', () => {
    expect(nextDrawLimit(null, 100, DRAW_LIMIT_HALVE)).toBe(50)
    expect(nextDrawLimit(50, 100, DRAW_LIMIT_HALVE)).toBe(25)
    expect(nextDrawLimit(25, 100, DRAW_LIMIT_HALVE)).toBe(13)
  })

  it('doubles back and collapses to null once it covers the scene', () => {
    expect(nextDrawLimit(25, 100, DRAW_LIMIT_DOUBLE)).toBe(50)
    expect(nextDrawLimit(50, 100, DRAW_LIMIT_DOUBLE)).toBe(null)
    expect(nextDrawLimit(null, 100, DRAW_LIMIT_DOUBLE)).toBe(null)
  })

  it('floors at 1 rather than emptying the viewport', () => {
    expect(nextDrawLimit(1, 100, DRAW_LIMIT_HALVE)).toBe(1)
    expect(nextDrawLimit(2, 100, DRAW_LIMIT_HALVE)).toBe(1)
  })

  it('has nothing to do on an empty scene', () => {
    expect(nextDrawLimit(null, 0, DRAW_LIMIT_HALVE)).toBe(null)
  })
})

describe('drawLimitPlan', () => {
  it('is null when there is no limit, so the load path costs nothing', () => {
    expect(drawLimitPlan(roots(4), null)).toBe(null)
  })

  it('takes a prefix of file order, not a stride', () => {
    const plan = drawLimitPlan(roots(8), 4)!
    expect([...plan.draw].sort((a, b) => a - b)).toEqual([1, 2, 3, 4])
  })

  it('skips rows the draw loop skips when counting the prefix', () => {
    const nodes = [
      makeNode({ id: 1, type: NodeType.World }),
      makeNode({ id: 2 }),
      makeNode({ id: 3, hide: 1 }),
      makeNode({ id: 4 }),
      makeNode({ id: 5 }),
    ]
    // World and the hidden row are not counted, so a limit of 2 reaches id 4.
    expect([...drawLimitPlan(nodes, 2)!.draw].sort((a, b) => a - b)).toEqual([2, 4])
    // With Show Hidden Nodes on, the hidden row takes one of the two slots.
    expect(
      [...drawLimitPlan(nodes, 2, { showHidden: true })!.draw].sort((a, b) => a - b),
    ).toEqual([2, 3])
  })

  it('keeps the ancestors of every drawn node', () => {
    // A child listed BEFORE its parent still needs the parent's frame to place.
    const nodes = [
      makeNode({ id: 10, parentId: 20 }),
      makeNode({ id: 11 }),
      makeNode({ id: 20 }),
    ]
    const plan = drawLimitPlan(nodes, 1)!
    expect([...plan.draw]).toEqual([10])
    expect([...plan.keep].sort((a, b) => a - b)).toEqual([10, 20])
  })
})

describe('drawLimitPlan overlay participants', () => {
  it('keeps both endpoints of a link past the cut', () => {
    const nodes = [
      makeNode({ id: 1 }),
      makeNode({ id: 2 }),
      makeNode({ id: 3 }),
      makeNode({ id: 4 }),
      // Edge from 1 to 4 — the desktop draws links irrespective of the limit.
      makeNode({ id: 5, type: NodeType.Link, parentId: 1, extras: { child_id: '4' } }),
    ]
    const plan = drawLimitPlan(nodes, 1)!
    expect([...plan.draw]).toEqual([1])
    expect([...plan.keep].sort((a, b) => a - b)).toEqual([1, 4, 5])
  })

  it('keeps a Plot parent and all of its children', () => {
    const nodes = [
      makeNode({ id: 1, topo: Topo.Plot }),
      makeNode({ id: 2, parentId: 1 }),
      makeNode({ id: 3, parentId: 1 }),
      makeNode({ id: 4, parentId: 1 }),
    ]
    const plan = drawLimitPlan(nodes, 1)!
    expect([...plan.draw]).toEqual([1])
    expect([...plan.keep].sort((a, b) => a - b)).toEqual([1, 2, 3, 4])
  })

  it('keeps a Surface parent and all of its children', () => {
    const nodes = [
      makeNode({ id: 7, topo: Topo.Surface }),
      makeNode({ id: 8, parentId: 7 }),
      makeNode({ id: 9, parentId: 7 }),
    ]
    const plan = drawLimitPlan(nodes, 1)!
    expect([...plan.keep].sort((a, b) => a - b)).toEqual([7, 8, 9])
  })
})

describe('buildScene under a draw limit', () => {
  it('builds no Object3D at all for the decimated tail', () => {
    const nodes = roots(8)
    expect(frameIds(nodes, null)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    // The whole point: the tail is absent from the graph, not merely invisible,
    // so it costs nothing in updateMatrixWorld or the renderer's project pass.
    expect(frameIds(nodes, 4)).toEqual([1, 2, 3, 4])
    expect(glyphIds(nodes, 4)).toEqual([1, 2, 3, 4])
  })

  it('reports the decimated glyph count as drawnCount', () => {
    expect(buildScene(roots(8), { drawLimit: 3 }).drawnCount).toBe(3)
  })

  it('keeps a link endpoint as a bare frame — placed, but not drawn', () => {
    const nodes = [
      makeNode({ id: 1 }),
      makeNode({ id: 2 }),
      makeNode({ id: 3, translate: { x: 9, y: 0, z: 0 } }),
      makeNode({ id: 4, type: NodeType.Link, parentId: 1, extras: { child_id: '3' } }),
    ]
    // Node 3 is past the cut, so no glyph — but its frame survives and the
    // edge still draws between it and node 1.
    expect(frameIds(nodes, 1)).toEqual([1, 3, 4])
    expect(glyphIds(nodes, 1)).toEqual([1])
    expect(buildScene(nodes, { drawLimit: 1 }).links.count).toBe(1)
  })

  it('draws a Plot polyline whose vertices are all past the cut', () => {
    const nodes = [
      makeNode({ id: 1, topo: Topo.Plot }),
      makeNode({ id: 2, parentId: 1, translate: { x: 0, y: 0, z: 0 } }),
      makeNode({ id: 3, parentId: 1, translate: { x: 1, y: 0, z: 0 } }),
      makeNode({ id: 4, parentId: 1, translate: { x: 2, y: 0, z: 0 } }),
    ]
    const built = buildScene(nodes, { drawLimit: 1 })
    expect(built.drawnCount).toBe(1)
    expect(built.overlays.plotCount).toBe(1)
  })

  it('leaves a limit at or above the total identical to no limit', () => {
    const nodes = roots(5)
    expect(frameIds(nodes, 5)).toEqual(frameIds(nodes, null))
    expect(glyphIds(nodes, 5)).toEqual(glyphIds(nodes, null))
  })
})
