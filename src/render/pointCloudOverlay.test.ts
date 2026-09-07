// Unit coverage for the Point Cloud overlay. Where the points LAND is diffed
// against the real desktop engine in pointCloudOverlay.parity.test.ts; this file
// covers what a position dump cannot see — that a point gets no Object3D at all
// (which is the whole reason the topology exists here), the batching, the
// material state, picking, and the rules a cloud imposes on the rest of the app.

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { buildScene } from './buildScene'
import { DEFAULT_BASE_SCALE, setBaseScale, setEnforceScaleFloor } from './baseScale'
import { pickNodeId, Selection } from './picking'
import { drawLimitPlan } from './drawLimit'
import { nodeIdsInRect } from './rectSelect'
import { placeLabels, taggableNodes } from './labelOverlay'
import { cloudParentIds, drawableChildren, isCloudParent, pointSize } from '../gv/pointCloud'
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
    topoScale: 1,
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
    tagFontSize: 11,
    refGridColor: { r: 56, g: 56, b: 71 },
    extras: {},
    ...overrides,
  }
}

/** A cloud parent plus `count` points laid along +X, one unit apart. */
function cloudScene(count: number, parent: Partial<GvNode> = {}): GvNode[] {
  return [
    makeNode({ id: 1, topo: Topo.PointCloud, ratio: 0.1, ...parent }),
    ...Array.from({ length: count }, (_, i) =>
      makeNode({
        id: 10 + i,
        parentId: 1,
        branchLevel: 1,
        translate: { x: i, y: 0, z: 0 },
        scale: { x: 0.1, y: 0.1, z: 0.1 },
        geometry: Geometry.Point,
        color: { r: 10 * i, g: 20, b: 30, a: 255 },
      }),
    ),
  ]
}

function built(nodes: GvNode[], options = {}) {
  const result = buildScene(nodes, options)
  result.root.updateMatrixWorld(true)
  result.clouds.update()
  return result
}

describe('the data half', () => {
  it('recognises a cloud parent, and never a Link however its topo reads', () => {
    expect(isCloudParent(makeNode({ topo: Topo.PointCloud }))).toBe(true)
    expect(isCloudParent(makeNode({ topo: Topo.Plot }))).toBe(false)
    // A link renders as an edge between two ends; its topo places nothing.
    expect(isCloudParent(makeNode({ topo: Topo.PointCloud, type: NodeType.Link }))).toBe(false)
  })

  it('collects the parents, not the points — the set every hot loop tests', () => {
    expect([...cloudParentIds(cloudScene(3))]).toEqual([1])
  })

  it('converts ratio to pixels and clamps both ends', () => {
    expect(pointSize(makeNode({ ratio: 0.1 }))).toBe(2)
    expect(pointSize(makeNode({ ratio: 0.15 }))).toBe(3)
    // Below MIN and above MAX — GL silently ignores an out-of-range point size,
    // so the clamp is what keeps behaviour the same across drivers.
    expect(pointSize(makeNode({ ratio: 0 }))).toBe(1)
    expect(pointSize(makeNode({ ratio: -5 }))).toBe(1)
    expect(pointSize(makeNode({ ratio: 100 }))).toBe(64)
  })

  it('drops non-visual rows, links and (unless shown) hidden points', () => {
    const kids = [
      makeNode({ id: 2 }),
      makeNode({ id: 3, hide: 1 }),
      makeNode({ id: 4, type: NodeType.Link }),
      makeNode({ id: 5, type: NodeType.World }),
      makeNode({ id: 6, type: NodeType.Camera }),
    ]
    expect(drawableChildren(kids, false).map((n) => n.id)).toEqual([2])
    expect(drawableChildren(kids, true).map((n) => n.id)).toEqual([2, 3])
  })
})

describe('a cloud point gets no Object3D', () => {
  it('builds one Points object for the cloud and no frame for any point', () => {
    const result = built(cloudScene(500))
    expect(result.clouds.cloudCount).toBe(1)
    expect(result.clouds.pointCount).toBe(500)
    // The parent keeps its frame and its glyph; every point has neither. This
    // is the load-bearing assertion of the whole feature — three Object3Ds per
    // point is what makes a six-figure cloud unaffordable.
    expect(result.frames.get(1)).toBeDefined()
    for (let i = 0; i < 500; i++) expect(result.frames.get(10 + i)).toBeUndefined()
    let object3ds = 0
    result.root.traverse(() => object3ds++)
    // root + parent frame + parent glyph + pick proxy + cloud group + Points +
    // picker, and nothing that scales with the point count.
    expect(object3ds).toBeLessThan(20)
  })

  it('does not count points as drawn glyphs', () => {
    // `drawnCount` feeds the scene line, which reports points separately.
    expect(built(cloudScene(50)).drawnCount).toBe(1)
  })

  it('drops a point subtree: a cloud is a flat set of positions', () => {
    const nodes = [
      ...cloudScene(1),
      makeNode({ id: 99, parentId: 10, branchLevel: 2 }),
    ]
    expect(built(nodes).frames.get(99)).toBeUndefined()
  })
})

describe('the batch', () => {
  it('carries one id, position and RGBA per point, in file order', () => {
    const batches = built(cloudScene(3)).clouds.batches()
    expect(batches).toHaveLength(1)
    const [batch] = batches
    expect([...batch.ids]).toEqual([10, 11, 12])
    expect(batch.count).toBe(3)
    expect([...batch.positions]).toEqual([0, 0, 0, 1, 0, 0, 2, 0, 0])
    // Raw byte/255 — this app renders in LinearSRGB, so no decode (roadmap 6k).
    expect(batch.colors[4]).toBeCloseTo(10 / 255, 6)
    expect(batch.colors[7]).toBe(1) // alpha
  })

  it('is opaque and depth-writing unless a point is translucent', () => {
    const opaque = built(cloudScene(2)).clouds
    const material = (opaque.group.children[0] as THREE.Points)
      .material as THREE.PointsMaterial
    expect(material.transparent).toBe(false)
    expect(material.depthWrite).toBe(true)
    // alphaToCoverage is what lets an OPAQUE cloud still have a soft round edge:
    // three only emits `#define OPAQUE` (which would flatten it) when neither
    // transparent nor alpha-to-coverage is set.
    expect(material.alphaToCoverage).toBe(true)

    const nodes = cloudScene(2)
    nodes[2].color = { ...nodes[2].color, a: 100 }
    const blended = (built(nodes).clouds.group.children[0] as THREE.Points)
      .material as THREE.PointsMaterial
    expect(blended.transparent).toBe(true)
    expect(blended.depthWrite).toBe(false)
  })

  it('sizes its points from the PARENT ratio, not the points own', () => {
    const nodes = cloudScene(2, { ratio: 0.35 })
    nodes[1].ratio = 5 // a point's own ratio is inert
    const material = (built(nodes).clouds.group.children[0] as THREE.Points)
      .material as THREE.PointsMaterial
    expect(material.size).toBe(7)
  })

  it('is unlit and fogged — scene content, not chrome', () => {
    const material = (built(cloudScene(2)).clouds.group.children[0] as THREE.Points)
      .material as THREE.PointsMaterial
    expect(material.fog).toBe(true)
    expect(material).toBeInstanceOf(THREE.PointsMaterial) // no lighting model
  })

  it('draws nothing for an empty cloud, or a hidden one', () => {
    expect(built(cloudScene(0)).clouds.cloudCount).toBe(0)
    expect(built(cloudScene(3, { hide: 1 })).clouds.cloudCount).toBe(0)
    // Show Hidden Nodes brings it back.
    expect(built(cloudScene(3, { hide: 1 }), { showHidden: true }).clouds.cloudCount).toBe(1)
  })
})

describe('update()', () => {
  it('follows the parent frame, and skips the pass when nothing moved', () => {
    const nodes = cloudScene(3)
    const result = built(nodes)
    const cloud = result.clouds
    expect(cloud.pointPosition(11)!.x).toBeCloseTo(1, 6)

    // A gizmo drag moves the parent frame between rebuilds; the points follow.
    const frame = result.frames.get(1)!
    frame.position.set(100, 0, 0)
    result.root.updateMatrixWorld(true)
    cloud.update()
    expect(cloud.pointPosition(11)!.x).toBeCloseTo(101, 6)

    // And a frame in which nothing moved must not rewrite the buffer — at a few
    // hundred thousand vertices an unconditional pass would put a millisecond
    // floor under a scene standing still. `version` is the readable side of
    // `needsUpdate`, which is a write-only setter.
    const positions = (cloud.group.children[0] as THREE.Points).geometry.getAttribute(
      'position',
    ) as THREE.BufferAttribute
    const version = positions.version
    cloud.update()
    expect(positions.version).toBe(version)
    // …and it does resume the moment something does move.
    frame.position.set(101, 0, 0)
    result.root.updateMatrixWorld(true)
    cloud.update()
    expect(positions.version).toBeGreaterThan(version)
  })

  it('keeps a bounding box in step, so camera framing sees the cloud', () => {
    const result = built(cloudScene(4))
    const box = new THREE.Box3().setFromObject(result.root)
    expect(box.max.x).toBeGreaterThanOrEqual(3)
  })

  it('re-derives a point a channel can move, and only that point', () => {
    const nodes = cloudScene(3)
    const result = built(nodes, { liveNodeIds: new Set([11]) })
    nodes[2].translate = { x: 50, y: 0, z: 0 } // id 11
    nodes[3].translate = { x: 60, y: 0, z: 0 } // id 12 — not live
    result.clouds.update()
    expect(result.clouds.pointPosition(11)!.x).toBeCloseTo(50, 6)
    expect(result.clouds.pointPosition(12)!.x).toBeCloseTo(2, 6)
  })
})

describe('picking', () => {
  /** A camera looking down −Z at the origin, and a ray aimed at one point. */
  function aimAt(target: THREE.Vector3) {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000)
    camera.position.set(0, 0, 40)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld(true)
    const raycaster = new THREE.Raycaster()
    raycaster.camera = camera
    raycaster.set(camera.position, target.clone().sub(camera.position).normalize())
    return raycaster
  }

  it('resolves a ray on a point to that node id', () => {
    const result = built(cloudScene(4))
    result.clouds.setResolution(800, 600)
    const target = result.clouds.pointPosition(12)!
    expect(pickNodeId(aimAt(target), result.root)).toBe(12)
  })

  it('misses when the ray is nowhere near, and never picks behind the camera', () => {
    const result = built(cloudScene(4))
    result.clouds.setResolution(800, 600)
    expect(pickNodeId(aimAt(new THREE.Vector3(500, 500, 0)), result.root)).toBeNull()
    // A cloud behind the camera: distanceSqToPoint measures the infinite line
    // both ways, so without the in-front test this would still hit.
    const behind = built(cloudScene(4, { translate: { x: 0, y: 0, z: 400 } }))
    behind.clouds.setResolution(800, 600)
    expect(pickNodeId(aimAt(new THREE.Vector3(0, 0, -400)), behind.root)).toBeNull()
  })

  it('reports nothing without a sized viewport — a pixel width needs a screen', () => {
    const result = built(cloudScene(4)) // setResolution never called
    const target = result.clouds.pointPosition(12)!
    expect(pickNodeId(aimAt(target), result.root)).toBeNull()
  })
})

describe('the rules a cloud imposes on the rest of the app', () => {
  it('counts as ONE unit under the \\ draw limit and is never decimated', () => {
    // 1 cloud parent + 40 points + 3 ordinary glyphs.
    const nodes = [
      ...cloudScene(40),
      makeNode({ id: 200 }),
      makeNode({ id: 201 }),
      makeNode({ id: 202 }),
    ]
    const plan = drawLimitPlan(nodes, 2)!
    // The limit spends itself on the cloud PARENT and one ordinary glyph; not
    // one point consumes a slot.
    expect([...plan.draw].sort((a, b) => a - b)).toEqual([1, 200])
    for (let i = 0; i < 40; i++) expect(plan.draw.has(10 + i)).toBe(false)
    // …and the cloud still draws whole, because the points were never counted.
    expect(built(nodes, { drawLimit: 2 }).clouds.pointCount).toBe(40)
  })

  it('takes the whole cloud away when the PARENT falls past the limit', () => {
    const nodes = [makeNode({ id: 200 }), ...cloudScene(5)]
    expect(built(nodes, { drawLimit: 1 }).clouds.cloudCount).toBe(0)
  })

  it('sweeps points into a region select at their own centres', () => {
    const result = built(cloudScene(4))
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000)
    camera.position.set(1.5, 0, 40)
    camera.lookAt(1.5, 0, 0)
    camera.updateMatrixWorld(true)
    const nodes = cloudScene(4)
    const rect = { x1: 0, y1: 0, x2: 800, y2: 600 }
    const size = { width: 800, height: 600 }
    // Without the points source a sweep over a cloud selects nothing at all,
    // which would silently break the documented way to grab part of a scan.
    expect(nodeIdsInRect(nodes, result.frames, camera, rect, size, {}).size).toBe(1)
    const withPoints = nodeIdsInRect(nodes, result.frames, camera, rect, size, {
      points: result.clouds,
    })
    expect([...withPoints].sort((a, b) => a - b)).toEqual([1, 10, 11, 12, 13])
  })
})

describe('selection', () => {
  it('selects a frameless point and draws it a halo', () => {
    const result = built(cloudScene(3))
    const selection = new Selection()
    selection.setPointSource(result.clouds)
    selection.set(result.frames, [11, 12])
    // Without setPointSource these ids would be dropped as "not in the scene".
    expect([...selection.ids]).toEqual([11, 12])
    expect(selection.haloCount).toBe(2)
    expect(selection.object.visible).toBe(true)
  })

  it('puts each halo at its own point, sized by that point own scale', () => {
    const nodes = cloudScene(3)
    nodes[3].scale = { x: 2, y: 2, z: 2 } // id 12
    const result = built(nodes)
    const selection = new Selection()
    selection.setPointSource(result.clouds)
    selection.set(result.frames, [12])
    const box = new THREE.Box3().setFromBufferAttribute(
      selection.object.geometry.getAttribute('position') as THREE.BufferAttribute,
    )
    // Centred on the point (x = 2), half-extent 1.05 × the point's own scale.
    expect(box.getCenter(new THREE.Vector3()).x).toBeCloseTo(2, 5)
    expect(box.max.x - box.min.x).toBeCloseTo(2 * 1.05 * 2, 5)
  })

  it('follows the Global Scale and the minimum-size setting', () => {
    const result = built(cloudScene(2))
    const selection = new Selection()
    selection.setPointSource(result.clouds)
    selection.set(result.frames, [10])
    const width = () => {
      selection.refreshHalos()
      const box = new THREE.Box3().setFromBufferAttribute(
        selection.object.geometry.getAttribute('position') as THREE.BufferAttribute,
      )
      return box.max.x - box.min.x
    }
    const plain = width() // scale 0.1, no floor
    try {
      setBaseScale(4)
      expect(width()).toBeCloseTo(plain * 4, 5)
      setBaseScale(DEFAULT_BASE_SCALE)
      setEnforceScaleFloor(true)
      expect(width()).toBeCloseTo(plain * 2, 5) // 0.1 floored to 0.2
    } finally {
      setBaseScale(DEFAULT_BASE_SCALE)
      setEnforceScaleFloor(false)
    }
  })

  it('mixes point halos with glyph halos in one batched object', () => {
    const nodes = [...cloudScene(2), makeNode({ id: 200, translate: { x: 0, y: 20, z: 0 } })]
    const result = built(nodes)
    const selection = new Selection()
    selection.setPointSource(result.clouds)
    selection.set(result.frames, [200, 10, 11])
    expect(selection.haloCount).toBe(3)
    expect([...selection.ids]).toEqual([200, 10, 11])
  })
})

describe('labels', () => {
  const state = (over = {}) => ({
    showTags: true,
    selectedOnly: false,
    showHidden: false,
    isSelected: () => false,
    pinned: [] as GvNode[],
    tagColorMode: 0,
    tagColor: { r: 255, g: 255, b: 200 },
    tagFontSize: 11,
    ...over,
  })

  function labelledScene() {
    const nodes = cloudScene(4)
    for (const n of nodes.slice(1)) n.text = `p${n.id}`
    nodes[0].text = 'the cloud'
    return nodes
  }

  it('filters unpinned points out of the walked list entirely', () => {
    const nodes = labelledScene()
    const clouds = new Set([1])
    // The performance rule, and the one the desktop measured at 109 ms of a
    // 111 ms frame: the points are gone BEFORE the loop, not skipped inside it.
    expect(taggableNodes(nodes, clouds).map((n) => n.id)).toEqual([1])
    nodes[2].showText = 1
    expect(taggableNodes(nodes, clouds).map((n) => n.id)).toEqual([1, 11])
    // A scene with no cloud gets its own list back untouched.
    expect(taggableNodes(nodes, new Set())).toBe(nodes)
  })

  it('labels a point only when it is pinned or selected', () => {
    const nodes = labelledScene()
    const result = built(nodes)
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000)
    camera.position.set(1.5, 0, 40)
    camera.lookAt(1.5, 0, 0)
    camera.updateMatrixWorld(true)
    const opts = { points: result.clouds, cloudParents: new Set([1]) }

    const none = placeLabels(nodes, result.frames, camera, state(opts), 800, 600)
    expect(none.map((p) => p.text)).toEqual(['the cloud'])

    const pinned = placeLabels(
      nodes,
      result.frames,
      camera,
      state({ ...opts, isSelected: (id: number) => id === 12 }),
      800,
      600,
    )
    expect(pinned.map((p) => p.text).sort()).toEqual(['p12', 'the cloud'])
  })

  it('anchors a point label at the point, not at its raw translate', () => {
    const nodes = labelledScene()
    nodes[2].showText = 1 // id 11, translate x = 1
    const result = built(nodes, {})
    // Move the whole cloud; the label has to move with it.
    result.frames.get(1)!.position.set(0, 0, 5)
    result.root.updateMatrixWorld(true)
    result.clouds.update()
    expect(result.clouds.pointPosition(11)!.z).toBeCloseTo(5, 6)
  })
})
