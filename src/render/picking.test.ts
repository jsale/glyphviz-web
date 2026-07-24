import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { buildScene } from './buildScene'
import { createSelectionBox, pickNodeId, Selection, SELECTION_BOX_HALF } from './picking'
import { Geometry, NodeType } from '../gv/types'
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
    extras: {},
    ...overrides,
  }
}

/** Ray from +X looking back at the origin plane, offset to targetY on Y. */
function rayAt(targetX: number, targetY: number): THREE.Raycaster {
  const rc = new THREE.Raycaster()
  rc.set(new THREE.Vector3(targetX, targetY, 50), new THREE.Vector3(0, 0, -1))
  return rc
}

function buildAndUpdate(nodes: GvNode[]) {
  const built = buildScene(nodes)
  built.root.updateMatrixWorld(true)
  return built
}

describe('pickNodeId', () => {
  it('picks the node whose solid volume the ray enters', () => {
    const { root } = buildAndUpdate([
      makeNode({ id: 1, translate: { x: 0, y: 0, z: 0 } }),
      makeNode({ id: 2, translate: { x: 5, y: 0, z: 0 } }),
    ])
    expect(pickNodeId(rayAt(0, 0), root)).toBe(1)
    expect(pickNodeId(rayAt(5, 0), root)).toBe(2)
  })

  it('returns null on empty space', () => {
    const { root } = buildAndUpdate([makeNode({ id: 1 })])
    expect(pickNodeId(rayAt(20, 0), root)).toBeNull()
  })

  it('prefers the nearest node along the ray', () => {
    const { root } = buildAndUpdate([
      makeNode({ id: 1, translate: { x: 0, y: 0, z: 0 } }),
      makeNode({ id: 2, translate: { x: 0, y: 0, z: 10 } }), // nearer to ray origin at z=50
    ])
    expect(pickNodeId(rayAt(0, 0), root)).toBe(2)
  })

  it('picks wire glyphs anywhere inside their solid silhouette', () => {
    const { root } = buildAndUpdate([makeNode({ id: 1, geometry: Geometry.SphereWire })])
    // Ray through the middle of the sphere, far from any wire line.
    expect(pickNodeId(rayAt(0.3, 0.2), root)).toBe(1)
  })

  it('never picks hidden, World, Camera, or Link nodes', () => {
    const { root } = buildAndUpdate([
      makeNode({ id: 1, hide: 1 }),
      makeNode({ id: 2, type: NodeType.World, translate: { x: 5, y: 0, z: 0 } }),
      makeNode({ id: 3, type: NodeType.Camera, translate: { x: 10, y: 0, z: 0 } }),
      makeNode({ id: 4, type: NodeType.Link, translate: { x: 15, y: 0, z: 0 } }),
    ])
    expect(pickNodeId(rayAt(0, 0), root)).toBeNull()
    expect(pickNodeId(rayAt(5, 0), root)).toBeNull()
    expect(pickNodeId(rayAt(10, 0), root)).toBeNull()
    expect(pickNodeId(rayAt(15, 0), root)).toBeNull()
  })

  it('never picks a World Grid, but its solid surface occludes glyphs behind it', () => {
    // Solid plate at z = 0 between the ray origin (z = 50) and a cube at
    // z = −5: the click must not reach the cube, nor select the grid.
    const solidGrid = makeNode({ id: 1, type: NodeType.WorldGrid, geometry: Geometry.GridSolid })
    const behind = makeNode({ id: 2, translate: { x: 0, y: 0, z: -5 } })
    const { root } = buildAndUpdate([solidGrid, behind])
    expect(pickNodeId(rayAt(0, 0), root)).toBeNull()

    // A wire grid neither occludes nor gets picked.
    const wireGrid = makeNode({ id: 1, type: NodeType.WorldGrid, geometry: Geometry.GridWire })
    const { root: wireRoot } = buildAndUpdate([wireGrid, behind])
    expect(pickNodeId(rayAt(0, 0), wireRoot)).toBe(2)
  })

  it('pick proxies exist but are invisible to the renderer', () => {
    const { root } = buildAndUpdate([makeNode({ id: 1 })])
    const proxyRoots: THREE.Object3D[] = []
    root.traverse((o) => {
      if (o.userData.isPickProxy && !o.parent?.userData.isPickProxy) proxyRoots.push(o)
    })
    expect(proxyRoots).toHaveLength(1)
    expect(proxyRoots[0].visible).toBe(false)
  })
})

describe('selection box', () => {
  it('spans ±1.05 in unit local space (desktop halo size)', () => {
    const box = createSelectionBox()
    box.geometry.computeBoundingBox()
    const bb = box.geometry.boundingBox!
    expect(bb.min.x).toBeCloseTo(-SELECTION_BOX_HALF)
    expect(bb.max.z).toBeCloseTo(SELECTION_BOX_HALF)
    // 12 edges as line segments = 24 vertices.
    expect(box.geometry.getAttribute('position').count).toBe(24)
  })

  it('attaches to the selected node glyph and tracks its rendered size', () => {
    const { root } = buildAndUpdate([
      makeNode({ id: 1 }),
      makeNode({ id: 2, translate: { x: 5, y: 0, z: 0 }, scale: { x: 0.1, y: 0.1, z: 0.1 } }),
    ])
    const sel = new Selection()
    sel.set(root, 2)
    expect(sel.id).toBe(2)
    root.updateMatrixWorld(true)
    const box = root.getObjectByName('selection-box')!
    // Parent chain includes the glyph's 0.2-floor correction: world scale
    // of the halo matches the drawn size (0.2), not the raw 0.1.
    const ws = box.getWorldScale(new THREE.Vector3())
    expect(ws.x).toBeCloseTo(0.2)

    sel.set(root, null)
    expect(sel.id).toBeNull()
    expect(root.getObjectByName('selection-box')).toBeUndefined()
  })

  it('refuses to select nodes without a glyph (hidden/non-visual)', () => {
    const { root } = buildAndUpdate([makeNode({ id: 1, hide: 1 })])
    const sel = new Selection()
    sel.set(root, 1)
    expect(sel.id).toBeNull()
  })
})
