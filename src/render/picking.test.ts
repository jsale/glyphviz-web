import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { buildScene } from './buildScene'
import { pickNodeId, Selection, SELECTION_BOX_HALF } from './picking'
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

  it('never picks hidden, World or Camera nodes', () => {
    const { root } = buildAndUpdate([
      makeNode({ id: 1, hide: 1 }),
      makeNode({ id: 2, type: NodeType.World, translate: { x: 5, y: 0, z: 0 } }),
      makeNode({ id: 3, type: NodeType.Camera, translate: { x: 10, y: 0, z: 0 } }),
    ])
    expect(pickNodeId(rayAt(0, 0), root)).toBeNull()
    expect(pickNodeId(rayAt(5, 0), root)).toBeNull()
    expect(pickNodeId(rayAt(10, 0), root)).toBeNull()
  })

  it('picks an edgeless Link at its own frame, but not a hidden one', () => {
    // Link picking proper (clicking the drawn edge) lives in
    // linkOverlay.test.ts; this is the fallback target buildScene parks on a
    // link that has no B-end to draw towards. The ray is deliberately off the
    // proxy sphere's polar axis, where its tessellation degenerates to a
    // point and a dead-centre ray grazes between triangles.
    const link = (id: number, x: number, hide = 0) =>
      makeNode({ id, type: NodeType.Link, translate: { x, y: 0, z: 0 }, hide })
    const { root } = buildAndUpdate([link(1, 0), link(2, 15, 1)])
    expect(pickNodeId(rayAt(0.3, 0.2), root)).toBe(1)
    expect(pickNodeId(rayAt(15.3, 0.2), root)).toBeNull()
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

/** World-space bounding box of each drawn halo, in halo-slot order. */
function haloBoxes(sel: Selection): THREE.Box3[] {
  const position = sel.object.geometry.getAttribute('position')
  const corner = new THREE.Vector3()
  return Array.from({ length: sel.haloCount }, (_, i) => {
    const box = new THREE.Box3()
    for (let c = 0; c < 8; c++) box.expandByPoint(corner.fromBufferAttribute(position, i * 8 + c))
    return box
  })
}

describe('selection box', () => {
  it('draws a ±1.05 box in the glyph’s own space, at its rendered size', () => {
    const { frames } = buildAndUpdate([
      makeNode({ id: 1 }),
      makeNode({ id: 2, translate: { x: 5, y: 0, z: 0 }, scale: { x: 0.1, y: 0.1, z: 0.1 } }),
    ])
    const sel = new Selection()
    sel.set(frames, 2)
    expect(sel.id).toBe(2)
    expect(sel.haloCount).toBe(1)

    // The halo measures the glyph's RENDERED size, exactly as parenting used to
    // make it — here the authored 0.1, since the minimum glyph size is off by
    // default (see baseScale.setEnforceScaleFloor).
    const [box] = haloBoxes(sel)
    expect(box.min.x).toBeCloseTo(5 - SELECTION_BOX_HALF * 0.1)
    expect(box.max.x).toBeCloseTo(5 + SELECTION_BOX_HALF * 0.1)
    expect(box.min.z).toBeCloseTo(-SELECTION_BOX_HALF * 0.1)
    expect(box.max.z).toBeCloseTo(SELECTION_BOX_HALF * 0.1)

    // 12 edges × 2 ends per halo, indexed into the 8 corners.
    expect(sel.object.geometry.drawRange.count).toBe(24)

    sel.set(frames, null)
    expect(sel.id).toBeNull()
    expect(sel.haloCount).toBe(0)
    expect(sel.object.visible).toBe(false)
    expect(sel.object.geometry.drawRange.count).toBe(0)
  })

  it('turns with the node it outlines', () => {
    // rotate_y is HTR heading, a rotation about Z: the axis-aligned bounds of
    // the turned box spread by √2 in X/Y and keep their Z, which an unrotated
    // box would not do.
    const { frames } = buildAndUpdate([makeNode({ id: 1, rotate: { x: 0, y: 45, z: 0 } })])
    const sel = new Selection()
    sel.set(frames, 1)
    const [box] = haloBoxes(sel)
    expect(box.max.x).toBeCloseTo(SELECTION_BOX_HALF * Math.SQRT2)
    expect(box.max.z).toBeCloseTo(SELECTION_BOX_HALF)
  })

  it('follows a glyph that moves, once refreshed', () => {
    const { root, frames } = buildAndUpdate([makeNode({ id: 1 })])
    const sel = new Selection()
    sel.set(frames, 1)
    expect(haloBoxes(sel)[0].max.x).toBeCloseTo(SELECTION_BOX_HALF)

    // What a Channels frame or a gizmo drag does between rebuilds.
    frames.get(1)!.position.x = 20
    root.updateMatrixWorld(true)
    sel.refreshHalos()
    expect(haloBoxes(sel)[0].max.x).toBeCloseTo(20 + SELECTION_BOX_HALF)
  })

  it('selects glyph-less nodes (hidden, links) without a halo — nav/inspector reach them', () => {
    const { frames } = buildAndUpdate([makeNode({ id: 1, hide: 1 })])
    const sel = new Selection()
    sel.set(frames, 1)
    expect(sel.id).toBe(1)
    expect(sel.haloCount).toBe(0)
    expect(sel.object.visible).toBe(false)
  })

  it('outlines a glyph LINK along the edge it draws', () => {
    // A link carrying a real geometry is indistinguishable from an ordinary
    // node on screen, and cycling geometry with O is exactly the workflow that
    // needs to show which one is selected (desktop `_draw_selected_link_outlines`).
    // Its glyph hangs off the link overlay, not off its own frame, so the
    // selection is handed the map.
    const built = buildAndUpdate([
      makeNode({ id: 1, translate: { x: -6, y: 0, z: 0 } }),
      makeNode({ id: 2, translate: { x: 6, y: 0, z: 0 } }),
      makeNode({
        id: 3,
        type: NodeType.Link,
        parentId: 1,
        geometry: Geometry.CylinderSolid,
        ratio: 0.5,
        extras: { child_id: '2' },
      }),
    ])
    const sel = new Selection()
    sel.setLinkGlyphs(built.links.glyphObjects)
    sel.set(built.frames, 3)
    expect(sel.haloCount).toBe(1)
    const [box] = haloBoxes(sel)
    // Spans the whole 12-unit edge (plus the 5% pad) and is `ratio` thick.
    expect(box.min.x).toBeCloseTo(-6 * SELECTION_BOX_HALF)
    expect(box.max.x).toBeCloseTo(6 * SELECTION_BOX_HALF)
    expect(box.max.y).toBeCloseTo(0.5 * SELECTION_BOX_HALF)
  })

  it('gives a Pin link the asymmetric box its own z span asks for', () => {
    // The pin's local z runs 0…1.1, so a ±1.05 cube would sit half a link off
    // the shape it is meant to outline.
    const built = buildAndUpdate([
      makeNode({ id: 1 }),
      makeNode({ id: 2, translate: { x: 0, y: 0, z: 11 } }),
      makeNode({
        id: 3,
        type: NodeType.Link,
        parentId: 1,
        geometry: Geometry.PinSolid,
        ratio: 0.5,
        extras: { child_id: '2' },
      }),
    ])
    const sel = new Selection()
    sel.setLinkGlyphs(built.links.glyphObjects)
    sel.set(built.frames, 3)
    const [box] = haloBoxes(sel)
    // 5% of the 1.1 span, in world units: the edge is 11 long, so 0.275 either
    // end — NOT a box centred on the midpoint.
    expect(box.min.z).toBeCloseTo(-0.275)
    expect(box.max.z).toBeCloseTo(11.275)
  })

  it('draws no halo for a line link, matching the desktop outline pass', () => {
    const built = buildAndUpdate([
      makeNode({ id: 1 }),
      makeNode({ id: 2, translate: { x: 6, y: 0, z: 0 } }),
      makeNode({
        id: 3,
        type: NodeType.Link,
        parentId: 1,
        geometry: Geometry.Line,
        extras: { child_id: '2' },
      }),
    ])
    const sel = new Selection()
    sel.setLinkGlyphs(built.links.glyphObjects)
    sel.set(built.frames, 3)
    expect(sel.id).toBe(3) // selected, and the inspector/table show it
    expect(sel.haloCount).toBe(0)
  })

  it('refuses to select ids with no frame in the scene', () => {
    const { frames } = buildAndUpdate([makeNode({ id: 1 })])
    const sel = new Selection()
    sel.set(frames, 99)
    expect(sel.id).toBeNull()
  })
})

describe('multi-selection', () => {
  const threeNodes = () => [
    makeNode({ id: 1 }),
    makeNode({ id: 2, translate: { x: 5, y: 0, z: 0 } }),
    makeNode({ id: 3, translate: { x: 10, y: 0, z: 0 } }),
  ]

  it('halos every selected node and keeps the first as primary', () => {
    const { frames } = buildAndUpdate(threeNodes())
    const sel = new Selection()
    sel.set(frames, [2, 3])
    expect(sel.id).toBe(2)
    expect(sel.size).toBe(2)
    expect([...sel.ids]).toEqual([2, 3])
    expect(sel.has(3)).toBe(true)
    expect(sel.has(1)).toBe(false)
    expect(sel.haloCount).toBe(2)
    // One draw call for the whole selection, whatever its size — the reason
    // the cap is a memory guard rather than a budget of a few hundred.
    expect(haloBoxes(sel).map((b) => b.max.x)).toEqual(
      [5, 10].map((x) => expect.closeTo(x + SELECTION_BOX_HALF)),
    )
  })

  it('drops the halos of nodes no longer selected', () => {
    const { frames } = buildAndUpdate(threeNodes())
    const sel = new Selection()
    sel.set(frames, [1, 2, 3])
    expect(sel.haloCount).toBe(3)
    sel.set(frames, [3])
    expect(sel.haloCount).toBe(1)
    expect(sel.id).toBe(3)
    // Only the live slot is drawn, even though the buffer keeps its size.
    expect(sel.object.geometry.drawRange.count).toBe(24)
    expect(haloBoxes(sel)[0].max.x).toBeCloseTo(10 + SELECTION_BOX_HALF)
    sel.set(frames, [])
    expect(sel.haloCount).toBe(0)
    expect(sel.id).toBeNull()
  })

  it('ignores duplicates and ids absent from the scene', () => {
    const { frames } = buildAndUpdate(threeNodes())
    const sel = new Selection()
    sel.set(frames, [2, 2, 99, 1])
    expect([...sel.ids]).toEqual([2, 1])
  })

  it('hides and shows the boxes without touching the selection', () => {
    const { frames } = buildAndUpdate(threeNodes())
    const sel = new Selection()
    sel.set(frames, [1, 2, 3])
    expect(sel.object.visible).toBe(true)

    sel.boxVisible = false
    expect(sel.boxVisible).toBe(false)
    expect(sel.object.visible).toBe(false)
    // The whole point: everything the selection means is untouched.
    expect([...sel.ids]).toEqual([1, 2, 3])
    expect(sel.id).toBe(1)
    expect(sel.haloCount).toBe(3)

    // A selection made while the boxes are off stays off — the flag belongs
    // to the viewer, not to any one selection.
    sel.set(frames, [2])
    expect(sel.object.visible).toBe(false)

    sel.boxVisible = true
    expect(sel.object.visible).toBe(true)
  })

  it('caps halos past the limit while keeping the selection complete', () => {
    // The real MAX_HALOS is a memory guard in the hundreds of thousands; the
    // capping rule is what this checks, so the instance gets its own small one.
    const nodes = Array.from({ length: 8 }, (_, i) =>
      makeNode({ id: i + 1, translate: { x: i * 3, y: 0, z: 0 } }),
    )
    const { frames } = buildAndUpdate(nodes)
    const sel = new Selection({ maxHalos: 5 })
    sel.set(frames, nodes.map((n) => n.id))
    expect(sel.size).toBe(8)
    expect(sel.haloCount).toBe(5)
    expect(sel.haloOverflow).toBe(3)
  })

  it('outlines every node of a Select All far past the old 1,000 draw-call cap', () => {
    // The reported symptom: Ctrl+A on a few thousand nodes highlighted well
    // under half of them, while the selection itself was complete (the rest
    // still took edits). One batched object is what makes the count a
    // non-issue — 2,500 halos, one draw call, no overflow.
    const nodes = Array.from({ length: 2500 }, (_, i) =>
      makeNode({ id: i + 1, translate: { x: i * 3, y: 0, z: 0 } }),
    )
    const { frames } = buildAndUpdate(nodes)
    const sel = new Selection()
    sel.set(frames, nodes.map((n) => n.id))
    expect(sel.size).toBe(2500)
    expect(sel.haloCount).toBe(2500)
    expect(sel.haloOverflow).toBe(0)
    expect(sel.object.geometry.drawRange.count).toBe(2500 * 24)
    // Spot-check the far end: the last node's box is around the last node.
    expect(haloBoxes(sel)[2499].max.x).toBeCloseTo(2499 * 3 + SELECTION_BOX_HALF)
  })

  it('clears a selection that stops fitting when the scene rebuilds', () => {
    // What rebuildScene does: null the selection against the NEW frames, then
    // re-apply the surviving ids. Nothing may be left pointing at old glyphs.
    const first = buildAndUpdate(threeNodes())
    const sel = new Selection()
    sel.set(first.frames, [1, 2, 3])
    const second = buildAndUpdate([makeNode({ id: 1 })])
    sel.set(second.frames, null)
    expect(sel.haloCount).toBe(0)
    sel.set(second.frames, [1, 2, 3])
    expect([...sel.ids]).toEqual([1])
    expect(sel.haloCount).toBe(1)
  })

  it('grows its buffers across many selection sizes without losing a halo', () => {
    // 200 nodes crosses the initial 64-slot reservation twice; every halo has
    // to survive the reallocation, positions and indices alike.
    const nodes = Array.from({ length: 200 }, (_, i) =>
      makeNode({ id: i + 1, translate: { x: i * 3, y: 0, z: 0 } }),
    )
    const { frames } = buildAndUpdate(nodes)
    const sel = new Selection()
    for (const n of [1, 70, 200]) {
      sel.set(frames, nodes.slice(0, n).map((node) => node.id))
      expect(sel.haloCount).toBe(n)
      const boxes = haloBoxes(sel)
      expect(boxes).toHaveLength(n)
      expect(boxes[n - 1].max.x).toBeCloseTo((n - 1) * 3 + SELECTION_BOX_HALF)
      const index = sel.object.geometry.getIndex()!
      expect(index.getX((n - 1) * 24)).toBe((n - 1) * 8)
    }
  })
})
