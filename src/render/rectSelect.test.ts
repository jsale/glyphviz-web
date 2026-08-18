import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { buildScene } from './buildScene'
import { nodeIdsInRect } from './rectSelect'
import type { GvNode } from '../gv/types'
import { Geometry, NodeType, Topo } from '../gv/types'

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
    tagFontSize: 11,
    refGridColor: { r: 56, g: 56, b: 71 },
    extras: {},
    ...overrides,
  }
}

const VIEWPORT = { width: 800, height: 600 }

/**
 * Camera on +Y looking back at the origin, Z up — so world +X runs right
 * across the screen and world +Z runs up it.
 */
function camera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(60, VIEWPORT.width / VIEWPORT.height, 0.001, 1000)
  cam.up.set(0, 0, 1)
  cam.position.set(0, -20, 0)
  cam.lookAt(0, 0, 0)
  cam.updateMatrixWorld(true)
  return cam
}

function build(nodes: GvNode[]) {
  const built = buildScene(nodes)
  built.root.updateMatrixWorld(true)
  return built
}

/** Screen position of a node's frame, for building rectangles in the tests. */
function screenOf(frames: ReadonlyMap<number, THREE.Object3D>, cam: THREE.Camera, id: number) {
  const v = new THREE.Vector3().setFromMatrixPosition(frames.get(id)!.matrixWorld).project(cam)
  return { x: ((v.x + 1) / 2) * VIEWPORT.width, y: ((1 - v.y) / 2) * VIEWPORT.height }
}

describe('nodeIdsInRect', () => {
  const cam = camera()

  it('selects the nodes whose projected center falls inside the rectangle', () => {
    const nodes = [
      makeNode({ id: 1, translate: { x: -5, y: 0, z: 0 } }),
      makeNode({ id: 2, translate: { x: 0, y: 0, z: 0 } }),
      makeNode({ id: 3, translate: { x: 5, y: 0, z: 0 } }),
    ]
    const { frames } = build(nodes)
    const left = screenOf(frames, cam, 1)
    const mid = screenOf(frames, cam, 2)
    const rect = { x1: left.x - 5, y1: mid.y - 20, x2: mid.x + 5, y2: mid.y + 20 }
    expect([...nodeIdsInRect(nodes, frames, cam, rect, VIEWPORT)]).toEqual([1, 2])
  })

  it('accepts a rectangle dragged in any corner order', () => {
    const nodes = [makeNode({ id: 1 })]
    const { frames } = build(nodes)
    const c = screenOf(frames, cam, 1)
    const flipped = { x1: c.x + 30, y1: c.y + 30, x2: c.x - 30, y2: c.y - 30 }
    expect([...nodeIdsInRect(nodes, frames, cam, flipped, VIEWPORT)]).toEqual([1])
  })

  it('skips World, Camera, World Grid and hidden rows', () => {
    const nodes = [
      makeNode({ id: 1, type: NodeType.World }),
      makeNode({ id: 2, type: NodeType.Camera }),
      makeNode({ id: 3, type: NodeType.WorldGrid, geometry: Geometry.GridSolid }),
      makeNode({ id: 5, hide: 1 }),
      makeNode({ id: 6 }),
    ]
    const { frames } = build(nodes)
    const all = { x1: 0, y1: 0, x2: VIEWPORT.width, y2: VIEWPORT.height }
    expect([...nodeIdsInRect(nodes, frames, cam, all, VIEWPORT)]).toEqual([6])
  })

  it('sweeps a link in by the midpoint of its edge, not by its own frame', () => {
    const nodes = [
      makeNode({ id: 1, translate: { x: -5, y: 0, z: 0 } }),
      makeNode({ id: 2, translate: { x: 5, y: 0, z: 0 } }),
      // The link row sits on its A-end, as authored links usually do.
      makeNode({
        id: 3,
        type: NodeType.Link,
        parentId: 1,
        extras: { child_id: '2' },
        translate: { x: -5, y: 0, z: 0 },
      }),
    ]
    const { frames } = build(nodes)
    const a = screenOf(frames, cam, 1)
    const b = screenOf(frames, cam, 2)
    const middle = { x1: (a.x + b.x) / 2 - 5, y1: a.y - 20, x2: (a.x + b.x) / 2 + 5, y2: a.y + 20 }
    // Neither endpoint is in the box, but the edge's midpoint is.
    expect([...nodeIdsInRect(nodes, frames, cam, middle, VIEWPORT)]).toEqual([3])
    // Over the A-end, where the link's own frame is, only the glyph matches.
    const overA = { x1: a.x - 5, y1: a.y - 20, x2: a.x + 5, y2: a.y + 20 }
    expect([...nodeIdsInRect(nodes, frames, cam, overA, VIEWPORT)]).toEqual([1])
  })

  it('includes hidden rows when showHidden is on', () => {
    const nodes = [makeNode({ id: 1, hide: 1 })]
    const { frames } = build(nodes)
    const all = { x1: 0, y1: 0, x2: VIEWPORT.width, y2: VIEWPORT.height }
    expect([...nodeIdsInRect(nodes, frames, cam, all, VIEWPORT, { showHidden: true })]).toEqual([1])
  })

  it('never selects nodes behind the camera (they project mirrored)', () => {
    // Camera sits at y = −20 looking toward +Y; this node is further back.
    const nodes = [makeNode({ id: 1, translate: { x: 0, y: -40, z: 0 } })]
    const { frames } = build(nodes)
    const all = { x1: 0, y1: 0, x2: VIEWPORT.width, y2: VIEWPORT.height }
    expect([...nodeIdsInRect(nodes, frames, cam, all, VIEWPORT)]).toEqual([])
  })

  it('places children by their world position, not the parent row order', () => {
    // A Cube-topology parent scatters its children onto cube faces; the two
    // children land on opposite sides of the screen, so a rectangle over one
    // must not catch the other.
    const nodes = [
      makeNode({ id: 1, topo: Topo.Cube }),
      makeNode({ id: 2, parentId: 1, branchLevel: 1, translate: { x: 3, y: 0, z: 0 } }),
      makeNode({ id: 3, parentId: 1, branchLevel: 1, translate: { x: -3, y: 0, z: 0 } }),
    ]
    const { frames } = build(nodes)
    const two = screenOf(frames, cam, 2)
    const three = screenOf(frames, cam, 3)
    expect(two.x).not.toBeCloseTo(three.x)
    const rect = { x1: two.x - 4, y1: two.y - 4, x2: two.x + 4, y2: two.y + 4 }
    expect([...nodeIdsInRect(nodes, frames, cam, rect, VIEWPORT)]).toEqual([2])
  })

  it('sweeps a Rod-topo node in where it DRAWS, not at its bottom cap', () => {
    // A rod's glyph is offset half its drawn length up its own axis (the ANTz
    // cap convention), so its row position sits 5 world units below the shape
    // on screen. The desktop's pixel pass catches the rod itself; a box drawn
    // around the visible rod must too.
    const nodes = [makeNode({ id: 1, topo: Topo.Rod })]
    const { frames } = build(nodes)
    const capScreen = screenOf(frames, cam, 1)
    const glyph = frames.get(1)!.children.find((c) => c.userData.isGlyph)!
    const v = new THREE.Vector3().setFromMatrixPosition(glyph.matrixWorld).project(cam)
    const drawn = {
      x: ((v.x + 1) / 2) * VIEWPORT.width,
      y: ((1 - v.y) / 2) * VIEWPORT.height,
    }
    // Z is up the screen, so the drawn centre is well ABOVE the row position.
    expect(drawn.y).toBeLessThan(capScreen.y - 50)

    const around = (p: { x: number; y: number }) => ({
      x1: p.x - 8,
      y1: p.y - 8,
      x2: p.x + 8,
      y2: p.y + 8,
    })
    expect([...nodeIdsInRect(nodes, frames, cam, around(drawn), VIEWPORT)]).toEqual([1])
    expect([...nodeIdsInRect(nodes, frames, cam, around(capScreen), VIEWPORT)]).toEqual([])
  })
})
