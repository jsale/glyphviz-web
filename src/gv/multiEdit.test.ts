import { describe, expect, it } from 'vitest'
import { applyDragDelta, MIN_DRAG_SCALE, shiftAxis, snapshotTransform } from './multiEdit'
import type { GvNode } from './types'
import { Geometry, NodeType, Topo } from './types'

function makeNode(overrides: Partial<GvNode>): GvNode {
  return {
    id: 1,
    type: NodeType.Glyph,
    parentId: 0,
    branchLevel: 0,
    translate: { x: 0, y: 0, z: 0 },
    rotate: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    color: { r: 200, g: 200, b: 200, a: 255 },
    geometry: Geometry.CubeSolid,
    hide: 0,
    topo: Topo.None,
    ratio: 0,
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
    refGridColor: { r: 56, g: 56, b: 71 },
    extras: {},
    ...overrides,
  }
}

describe('shiftAxis (panel field across a selection)', () => {
  it('shifts every node by the field change, preserving their spread', () => {
    const nodes = [
      makeNode({ id: 1, translate: { x: 10, y: 0, z: 0 } }),
      makeNode({ id: 2, translate: { x: 25, y: 0, z: 0 } }),
    ]
    const anchor = { ...nodes[0].translate }
    shiftAxis(nodes, (n) => n.translate, 'x', anchor, 13)
    expect(nodes[0].translate.x).toBe(13)
    expect(nodes[1].translate.x).toBe(28) // still 15 ahead of the primary
    expect(anchor.x).toBe(13)
  })

  it('is a plain assignment for a single selection', () => {
    const nodes = [makeNode({ id: 1, rotate: { x: 0, y: 0, z: 45 } })]
    const anchor = { ...nodes[0].rotate }
    shiftAxis(nodes, (n) => n.rotate, 'z', anchor, -90)
    expect(nodes[0].rotate.z).toBe(-90)
  })

  it('measures each successive edit from the value last typed', () => {
    const nodes = [
      makeNode({ id: 1, translate: { x: 0, y: 0, z: 0 } }),
      makeNode({ id: 2, translate: { x: 5, y: 0, z: 0 } }),
    ]
    const anchor = { ...nodes[0].translate }
    shiftAxis(nodes, (n) => n.translate, 'x', anchor, 2)
    shiftAxis(nodes, (n) => n.translate, 'x', anchor, 3)
    expect(nodes[0].translate.x).toBe(3)
    expect(nodes[1].translate.x).toBe(8) // 5 + 3 total, not 5 + 2 + 3
  })

  it('leaves the other axes alone', () => {
    const nodes = [makeNode({ id: 1, translate: { x: 1, y: 2, z: 3 } })]
    const anchor = { ...nodes[0].translate }
    shiftAxis(nodes, (n) => n.translate, 'y', anchor, 9)
    expect(nodes[0].translate).toEqual({ x: 1, y: 9, z: 3 })
  })
})

describe('applyDragDelta (gizmo across a selection)', () => {
  it('adds the primary translate change to the follower', () => {
    const primary = makeNode({ id: 1, translate: { x: 0, y: 0, z: 0 } })
    const follower = makeNode({ id: 2, translate: { x: 100, y: -4, z: 0 } })
    const primaryStart = snapshotTransform(primary)
    const followerStart = snapshotTransform(follower)
    primary.translate.x = 7
    primary.translate.z = -2
    applyDragDelta('translate', primary, primaryStart, follower, followerStart)
    expect(follower.translate).toEqual({ x: 107, y: -4, z: -2 })
  })

  it('adds the primary rotate change in degrees, without wrapping', () => {
    const primary = makeNode({ id: 1, rotate: { x: 0, y: 0, z: 350 } })
    const follower = makeNode({ id: 2, rotate: { x: 0, y: 0, z: 20 } })
    const primaryStart = snapshotTransform(primary)
    const followerStart = snapshotTransform(follower)
    primary.rotate.z = 380 // the drag unwrapped past 360 — the follower follows
    applyDragDelta('rotate', primary, primaryStart, follower, followerStart)
    expect(follower.rotate.z).toBe(50)
  })

  it('scales by ratio so a mixed-size selection keeps its proportions', () => {
    const primary = makeNode({ id: 1, scale: { x: 2, y: 2, z: 2 } })
    const follower = makeNode({ id: 2, scale: { x: 10, y: 1, z: 4 } })
    const primaryStart = snapshotTransform(primary)
    const followerStart = snapshotTransform(follower)
    primary.scale.x = 3 // ×1.5
    applyDragDelta('scale', primary, primaryStart, follower, followerStart)
    expect(follower.scale.x).toBeCloseTo(15)
    expect(follower.scale.y).toBeCloseTo(1)
    expect(follower.scale.z).toBeCloseTo(4)
  })

  it('clamps a shrinking drag at the desktop floor', () => {
    const primary = makeNode({ id: 1, scale: { x: 1, y: 1, z: 1 } })
    const follower = makeNode({ id: 2, scale: { x: 1, y: 1, z: 1 } })
    const primaryStart = snapshotTransform(primary)
    const followerStart = snapshotTransform(follower)
    primary.scale.x = 1e-9
    applyDragDelta('scale', primary, primaryStart, follower, followerStart)
    expect(follower.scale.x).toBe(MIN_DRAG_SCALE)
  })

  it('holds an axis whose primary started at zero (no recoverable ratio)', () => {
    const primary = makeNode({ id: 1, scale: { x: 0, y: 1, z: 1 } })
    const follower = makeNode({ id: 2, scale: { x: 5, y: 1, z: 1 } })
    const primaryStart = snapshotTransform(primary)
    const followerStart = snapshotTransform(follower)
    primary.scale.x = 4
    applyDragDelta('scale', primary, primaryStart, follower, followerStart)
    expect(follower.scale.x).toBe(5)
  })

  it('re-derives from the snapshot each tick, so a long drag cannot drift', () => {
    const primary = makeNode({ id: 1, translate: { x: 0, y: 0, z: 0 } })
    const follower = makeNode({ id: 2, translate: { x: 3, y: 0, z: 0 } })
    const primaryStart = snapshotTransform(primary)
    const followerStart = snapshotTransform(follower)
    for (const x of [1, 2, 3, 2.5, 40]) {
      primary.translate.x = x
      applyDragDelta('translate', primary, primaryStart, follower, followerStart)
    }
    expect(follower.translate.x).toBe(43) // 3 + 40, not a sum of every tick
  })
})
