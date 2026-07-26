// Unit coverage for the Plot/Surface overlays. The vertex stream itself is
// diffed against the real desktop viewport in topologyOverlay.parity.test.ts;
// this file covers what a vertex dump cannot see — the batching, the GPU
// buffers, material state, live updates, and the "draw nothing" rules.

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import type { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { applyFrameTransform, buildScene } from './buildScene'
import { Geometry, NodeType, RotationMode, Topo } from '../gv/types'
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
    topo: Topo.None,
    ratio: 0.1,
    subspace: 0,
    textureId: 0,
    meshId: 0,
    rotationMode: RotationMode.HeadingTiltRoll,
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

/** A Plot parent plus `points` children laid along +X at the given heights. */
function plotScene(heights: number[], parent: Partial<GvNode> = {}): GvNode[] {
  return [
    makeNode({ id: 1, topo: Topo.Plot, ratio: 0.15, geometry: Geometry.Point, ...parent }),
    ...heights.map((z, i) =>
      makeNode({ id: 10 + i, parentId: 1, branchLevel: 1, translate: { x: i, y: 0, z } }),
    ),
  ]
}

/** A Surface parent plus a full `nx` × `ny` lattice of children. */
function surfaceScene(nx: number, ny: number, height: (x: number, y: number) => number): GvNode[] {
  const nodes = [makeNode({ id: 1, topo: Topo.Surface, geometry: Geometry.Point })]
  let id = 10
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      nodes.push(
        makeNode({
          id: id++,
          parentId: 1,
          branchLevel: 1,
          translate: { x, y, z: height(x, y) },
        }),
      )
    }
  }
  return nodes
}

function overlayGroup(root: THREE.Object3D): THREE.Object3D {
  return root.getObjectByName('topology-overlay')!
}

const lineBatches = (root: THREE.Object3D): LineSegments2[] =>
  overlayGroup(root).children.filter((o): o is LineSegments2 => o.name === 'plot-lines')

const surfaceMeshes = (root: THREE.Object3D): THREE.Mesh[] =>
  overlayGroup(root).children.filter((o): o is THREE.Mesh => o.name === 'surface-mesh')

describe('plot polylines', () => {
  it('strings the children together in file order at their world positions', () => {
    const { root, overlays } = buildScene(plotScene([0, 1.5, 0.5]))
    expect(overlays.plotCount).toBe(1)
    expect(lineBatches(root)).toHaveLength(1)
    const [prim] = overlays.primitives()
    expect(prim.kind).toBe('polyline')
    expect(prim.vertices.map((v) => v.pos)).toEqual([
      [0, 0, 0],
      [1, 0, 1.5],
      [2, 0, 0.5],
    ])
  })

  it('takes its pixel width from the PARENT’s ratio, floored at 1', () => {
    const wide = buildScene(plotScene([0, 1], { ratio: 0.15 }))
    expect(wide.overlays.primitives()[0].widthPx).toBe(3)
    expect((lineBatches(wide.root)[0].material as LineMaterial).linewidth).toBe(3)

    const thin = buildScene(plotScene([0, 1], { ratio: 0.01 }))
    expect(thin.overlays.primitives()[0].widthPx).toBe(1)
  })

  it('gives each vertex its own child’s color, so a ramp paints a gradient', () => {
    const nodes = plotScene([0, 0, 0])
    nodes[1].color = { r: 255, g: 0, b: 0, a: 255 }
    nodes[2].color = { r: 0, g: 255, b: 0, a: 255 }
    nodes[3].color = { r: 0, g: 0, b: 255, a: 255 }
    const { overlays } = buildScene(nodes)
    const colors = overlays.primitives()[0].vertices.map((v) => v.color)
    expect(colors[0]).toEqual([1, 0, 0, 1])
    expect(colors[1]).toEqual([0, 1, 0, 1])
    expect(colors[2]).toEqual([0, 0, 1, 1])
  })

  it('batches plots that share a width and alpha into one draw object', () => {
    const nodes = [
      ...plotScene([0, 1]),
      // Same ratio → same batch.
      makeNode({ id: 2, topo: Topo.Plot, ratio: 0.15, translate: { x: 10, y: 0, z: 0 } }),
      makeNode({ id: 20, parentId: 2, branchLevel: 1, translate: { x: 0, y: 0, z: 0 } }),
      makeNode({ id: 21, parentId: 2, branchLevel: 1, translate: { x: 1, y: 0, z: 0 } }),
      // Different ratio → its own batch.
      makeNode({ id: 3, topo: Topo.Plot, ratio: 0.5, translate: { x: 20, y: 0, z: 0 } }),
      makeNode({ id: 30, parentId: 3, branchLevel: 1, translate: { x: 0, y: 0, z: 0 } }),
      makeNode({ id: 31, parentId: 3, branchLevel: 1, translate: { x: 1, y: 0, z: 0 } }),
    ]
    const { root, overlays } = buildScene(nodes)
    expect(overlays.plotCount).toBe(3)
    expect(lineBatches(root)).toHaveLength(2)
  })

  it('needs two visible children — a hidden one drops out of the line', () => {
    const nodes = plotScene([0, 1, 2])
    nodes[2].hide = 1
    const { overlays } = buildScene(nodes)
    expect(overlays.primitives()[0].vertices.map((v) => v.pos)).toEqual([
      [0, 0, 0],
      [2, 0, 2],
    ])

    nodes[3].hide = 1
    expect(buildScene(nodes).overlays.plotCount).toBe(0)
  })

  it('draws nothing for a hidden plot parent unless Show Hidden Nodes is on', () => {
    const nodes = plotScene([0, 1, 2], { hide: 1 })
    expect(buildScene(nodes).overlays.plotCount).toBe(0)
    expect(buildScene(nodes, { showHidden: true }).overlays.plotCount).toBe(1)
  })

  it('never folds a Link child into the polyline', () => {
    // The desktop's own rule, and the reason the YBCO example wires its axis
    // decoration to the plot anchor with type-7 edges instead of parenting.
    const nodes = plotScene([0, 1])
    nodes.push(
      makeNode({
        id: 99,
        type: NodeType.Link,
        parentId: 1,
        branchLevel: 1,
        geometry: Geometry.Line,
        extras: { child_id: '10' },
      }),
    )
    const { overlays } = buildScene(nodes)
    expect(overlays.primitives()[0].vertices).toHaveLength(2)
  })
})

describe('surface quad meshes', () => {
  it('builds one quad per complete lattice cell, row-major', () => {
    const { root, overlays } = buildScene(surfaceScene(3, 2, () => 0))
    expect(overlays.surfaceCount).toBe(1)
    expect(overlays.quadCount).toBe(2)
    expect(surfaceMeshes(root)).toHaveLength(1)
    const quads = overlays.primitives()
    expect(quads.map((q) => q.vertices[0].pos)).toEqual([
      [0, 0, 0],
      [1, 0, 0],
    ])
    // Corner order n00, n10, n11, n01 — the desktop's GL_QUADS winding.
    expect(quads[0].vertices.map((v) => v.pos)).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
    ])
  })

  it('leaves a hole where a corner is missing rather than skewing the mesh', () => {
    const nodes = surfaceScene(3, 3, () => 0)
    // Drop the middle child (1, 1) — every cell touching it goes away.
    const middle = nodes.findIndex((n) => n.translate.x === 1 && n.translate.y === 1)
    nodes.splice(middle, 1)
    const { overlays } = buildScene(nodes)
    expect(overlays.quadCount).toBe(0)
  })

  it('faces the flat normal of each cell, CCW from its own corners', () => {
    const { overlays } = buildScene(surfaceScene(2, 2, () => 0))
    expect(overlays.primitives()[0].vertices[0].normal).toEqual([0, 0, 1])

    // Tilt the lattice: z rises with x, so the normal leans toward −X.
    const tilted = buildScene(surfaceScene(2, 2, (x) => x))
    const n = tilted.overlays.primitives()[0].vertices[0].normal!
    expect(n[0]).toBeCloseTo(-Math.SQRT1_2, 6)
    expect(n[1]).toBeCloseTo(0, 6)
    expect(n[2]).toBeCloseTo(Math.SQRT1_2, 6)
  })

  it('needs four children and two distinct values on each axis', () => {
    expect(buildScene(surfaceScene(3, 1, () => 0)).overlays.surfaceCount).toBe(0) // one row
    expect(buildScene(surfaceScene(1, 4, () => 0)).overlays.surfaceCount).toBe(0) // one column
    const three = surfaceScene(2, 2, () => 0)
    three.pop()
    expect(buildScene(three).overlays.surfaceCount).toBe(0) // three children
  })

  it('buckets lattice coordinates at 6 decimals, last row winning the cell', () => {
    const nodes = surfaceScene(2, 2, () => 0)
    // A 7th-decimal drift must land in the SAME cell (the spec's warning),
    // and being later in the file it replaces what was there.
    nodes.push(
      makeNode({
        id: 500,
        parentId: 1,
        branchLevel: 1,
        translate: { x: 1.0000001, y: 1, z: 9 },
      }),
    )
    const { overlays } = buildScene(nodes)
    expect(overlays.quadCount).toBe(1)
    expect(overlays.primitives()[0].vertices[2].pos[2]).toBeCloseTo(9, 5)
  })

  it('is one-sided and lit, matching the desktop’s culled, lighting-on pass', () => {
    const { root } = buildScene(surfaceScene(2, 2, () => 0))
    const material = surfaceMeshes(root)[0].material as THREE.MeshLambertMaterial
    expect(material.type).toBe('MeshLambertMaterial')
    expect(material.side).toBe(THREE.FrontSide)
    expect(material.vertexColors).toBe(true)
    expect(material.transparent).toBe(false)
  })

  it('carries per-vertex alpha, unlike the plot lines', () => {
    const nodes = surfaceScene(2, 2, () => 0)
    nodes[1].color = { r: 255, g: 255, b: 255, a: 128 }
    const { root, overlays } = buildScene(nodes)
    const material = surfaceMeshes(root)[0].material as THREE.MeshLambertMaterial
    expect(material.transparent).toBe(true)
    // itemSize 4 is what turns on three's USE_COLOR_ALPHA.
    expect(surfaceMeshes(root)[0].geometry.attributes.color.itemSize).toBe(4)
    expect(overlays.primitives()[0].vertices[0].color[3]).toBeCloseTo(128 / 255, 6)
  })
})

/** A plot and a surface in one scene, using disjoint id ranges. */
function mixedScene(): GvNode[] {
  const surface = surfaceScene(2, 2, () => 0).map((n) =>
    makeNode({ ...n, id: n.id + 100, parentId: n.parentId === 0 ? 0 : 101 }),
  )
  surface[0].translate = { x: 30, y: 0, z: 0 }
  return [...plotScene([0, 0, 0]), ...surface]
}

describe('overlay lifecycle', () => {
  it('follows its nodes when a frame moves, with no scene rebuild', () => {
    const scene = mixedScene()
    const { root, overlays, frames } = buildScene(scene)

    // Drag the plot's middle child up, exactly as the gizmo does: mutate the
    // row, re-apply its frame transform, redraw.
    const byId = new Map(scene.map((n) => [n.id, n]))
    const moved = byId.get(11)!
    moved.translate = { x: 1, y: 0, z: 5 }
    applyFrameTransform(frames.get(11)!, moved, byId.get(1)!)
    // A surface corner too, so its face normal has to be re-derived.
    const corner = byId.get(111)!
    corner.translate = { x: 1, y: 0, z: 1 }
    applyFrameTransform(frames.get(111)!, corner, byId.get(101)!)

    root.updateMatrixWorld(true)
    overlays.update()

    const drawn = overlays.primitives()
    const polyline = drawn.find((p) => p.kind === 'polyline')!
    expect(polyline.vertices[1].pos).toEqual([1, 0, 5])
    const quad = drawn.find((p) => p.kind === 'quad')!
    expect(quad.vertices[1].pos).toEqual([31, 0, 1])
    expect(quad.vertices[0].normal![2]).toBeGreaterThan(0)
    expect(quad.vertices[0].normal![0]).toBeLessThan(0) // tilted toward −X
  })

  it('draws nothing at all for a scene with no Plot or Surface parents', () => {
    const { root, overlays } = buildScene([
      makeNode({ id: 1 }),
      makeNode({ id: 2, parentId: 1, branchLevel: 1 }),
    ])
    expect(overlays.isEmpty).toBe(true)
    expect(overlays.primitives()).toEqual([])
    expect(overlayGroup(root).children).toHaveLength(0)
  })

  it('is never pickable, matching the desktop pick pass drawing glyphs only', () => {
    const { root } = buildScene(mixedScene())
    const raycaster = new THREE.Raycaster()
    raycaster.set(new THREE.Vector3(1, 0, 10), new THREE.Vector3(0, 0, -1))
    const hits: THREE.Intersection[] = []
    for (const object of [...lineBatches(root), ...surfaceMeshes(root)]) {
      object.raycast(raycaster, hits)
    }
    expect(hits).toEqual([])
  })

  it('releases its GPU buffers on dispose', () => {
    const { overlays } = buildScene(mixedScene())
    expect(() => overlays.dispose()).not.toThrow()
  })
})
