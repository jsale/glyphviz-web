import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import type { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { applyFrameTransform, buildScene } from './buildScene'
import { pickNodeId } from './picking'
import { parseGvNodeCsv } from '../gv/nodeCsv'
import { Geometry, NodeType, RotationMode, Topo } from '../gv/types'
import type { GvNode } from '../gv/types'
import linkExampleCsv from '../examples/link_example_gv_node.csv?raw'

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

const makeLink = (id: number, aId: number, bId: number, overrides: Partial<GvNode> = {}) =>
  makeNode({
    id,
    type: NodeType.Link,
    parentId: aId,
    branchLevel: 1,
    geometry: Geometry.Line,
    extras: { child_id: String(bId) },
    ...overrides,
  })

function overlayOf(root: THREE.Object3D): THREE.Object3D {
  return root.getObjectByName('link-overlay')!
}

function lineBatches(root: THREE.Object3D): LineSegments2[] {
  return overlayOf(root).children.filter((o): o is LineSegments2 => o.name === 'link-lines')
}

function prismBatches(root: THREE.Object3D): THREE.Mesh[] {
  return overlayOf(root).children.filter((o): o is THREE.Mesh => o.name === 'link-prisms')
}

/** Segment endpoints [a, b] of segment `i` in a batched line object. */
function segmentAt(batch: LineSegments2, i: number): [number[], number[]] {
  const start = batch.geometry.attributes.instanceStart as THREE.InterleavedBufferAttribute
  const end = batch.geometry.attributes.instanceEnd as THREE.InterleavedBufferAttribute
  return [
    [start.getX(i), start.getY(i), start.getZ(i)],
    [end.getX(i), end.getY(i), end.getZ(i)],
  ]
}

function expectVec(actual: ArrayLike<number>, expected: [number, number, number]) {
  for (let i = 0; i < 3; i++) expect(actual[i]).toBeCloseTo(expected[i], 10)
}

describe('link edges', () => {
  it('draws a line between the endpoint nodes’ world positions', () => {
    // B sits under a rotated+scaled parent — endpoints must be WORLD
    // positions, not raw translates. Parent: HTR heading 90 (= Rz(−90)),
    // scale 2 → child offset (1,0,0) lands at (0,−2,0) from (5,0,0).
    const { root, links, warnings } = buildScene([
      makeNode({ id: 1, translate: { x: -3, y: 0, z: 1 } }),
      makeNode({
        id: 2,
        translate: { x: 5, y: 0, z: 0 },
        rotate: { x: 0, y: 90, z: 0 },
        scale: { x: 2, y: 2, z: 2 },
      }),
      makeNode({ id: 3, parentId: 2, branchLevel: 1, translate: { x: 1, y: 0, z: 0 } }),
      makeLink(4, 1, 3),
    ])
    expect(warnings).toEqual([])
    expect(links.count).toBe(1)
    const [a, b] = segmentAt(lineBatches(root)[0], 0)
    expectVec(a, [-3, 0, 1])
    expectVec(b, [5, -2, 0])
  })

  it('tracks endpoint moves on update() without a rebuild (gizmo-drag path)', () => {
    const nodeA = makeNode({ id: 1 })
    const { root, links, frames } = buildScene([
      nodeA,
      makeNode({ id: 2, translate: { x: 10, y: 0, z: 0 } }),
      makeLink(3, 1, 2),
    ])
    nodeA.translate.x = 4
    applyFrameTransform(frames.get(1)!, nodeA, null)
    // update() reads matrixWorld as-is (the render loop's own pass supplies
    // it); tests stand in for the renderer here.
    root.updateMatrixWorld(true)
    links.update()
    const [a] = segmentAt(lineBatches(root)[0], 0)
    expectVec(a, [4, 0, 0])
  })

  it('batches by pixel width max(ratio·20, 1): one draw object per width', () => {
    const { root, links } = buildScene([
      makeNode({ id: 1 }),
      makeNode({ id: 2, translate: { x: 10, y: 0, z: 0 } }),
      makeNode({ id: 3, translate: { x: 0, y: 10, z: 0 } }),
      makeLink(4, 1, 2, { ratio: 0.35 }),
      makeLink(5, 2, 1, { ratio: 0.01 }),
      makeLink(6, 1, 3, { ratio: 0.01 }), // same width as link 5 → same batch
    ])
    expect(links.count).toBe(3)
    const widths = lineBatches(root).map((l) => (l.material as LineMaterial).linewidth)
    expect(widths.sort((x, y) => x - y)).toEqual([1, 7])
  })

  it('renders geometry 28 as a square tube of half-width max(ratio, 0.01)', () => {
    const { root, links } = buildScene([
      makeNode({ id: 1 }),
      makeNode({ id: 2, translate: { x: 10, y: 0, z: 0 } }),
      makeLink(3, 1, 2, { geometry: Geometry.TexturedPrism, ratio: 0.5 }),
    ])
    expect(links.count).toBe(1)
    const mesh = prismBatches(root)[0]
    const pos = mesh.geometry.getAttribute('position')
    expect(pos.count).toBe(8)
    expect(mesh.geometry.index!.count).toBe(24) // 4 faces × 2 triangles
    // Edge along +X, reference up +Z: every corner sits at distance
    // radius·√2 from the axis, rings at x = 0 and x = 10.
    for (let i = 0; i < 8; i++) {
      expect(pos.getX(i)).toBeCloseTo(i < 4 ? 0 : 10, 10)
      expect(Math.hypot(pos.getY(i), pos.getZ(i))).toBeCloseTo(0.5 * Math.SQRT2, 10)
    }
  })

  it('skips hidden links and warns on missing or dangling endpoints', () => {
    const { links, warnings } = buildScene([
      makeNode({ id: 1 }),
      makeNode({ id: 2, translate: { x: 10, y: 0, z: 0 } }),
      makeLink(3, 1, 2, { hide: 1 }),
      makeLink(4, 1, 0), // pending B-end (desktop's in-progress state)
      makeLink(5, 1, 99), // dangling B-end
    ])
    expect(links.count).toBe(0)
    expect(warnings).toHaveLength(2)
    expect(warnings.join(' ')).toContain('Link node 4')
    expect(warnings.join(' ')).toContain('Link node 5')
  })

  it('never draws a glyph or pick proxy at the link node’s own frame', () => {
    const { root, drawnCount, frames } = buildScene([
      makeNode({ id: 1 }),
      makeNode({ id: 2, translate: { x: 10, y: 0, z: 0 } }),
      makeLink(3, 1, 2),
    ])
    expect(drawnCount).toBe(2)
    expect(root.getObjectByName('gv:3')).toBeDefined()
    const frame = frames.get(3)!
    expect(frame.children.find((c) => c.userData.isGlyph)).toBeUndefined()
    let proxies = 0
    frame.traverse((o) => {
      if (o.userData.isPickProxy) proxies++
    })
    expect(proxies).toBe(0)
  })

  it('gives a link with no drawable edge a pick target at its own position', () => {
    // The edge cannot draw (no B-end), so the desktop's fallback sphere is
    // the only thing a click could land on.
    const { frames } = buildScene([makeNode({ id: 1 }), makeLink(2, 1, 0)])
    let proxies = 0
    frames.get(2)!.traverse((o) => {
      if (o.userData.isPickProxy) proxies++
    })
    expect(proxies).toBeGreaterThan(0)
  })

  it('renders the link example scene: 6 ring lines + 6 spoke prisms, no warnings', () => {
    const parsed = parseGvNodeCsv(linkExampleCsv)
    expect(parsed.errors).toEqual([])
    const { root, links, warnings, drawnCount } = buildScene(parsed.nodes)
    expect(warnings).toEqual([])
    expect(drawnCount).toBe(7)
    expect(links.count).toBe(12)
    // Three line batches (thin/thick/translucent) + one prism batch.
    expect(lineBatches(root)).toHaveLength(3)
    expect(prismBatches(root)).toHaveLength(1)
  })
})

// Links are click targets on their EDGE, which is what a user sees — the
// desktop draws each one as a thick line into its pick FBO; here the picker
// runs the equivalent ray-to-segment test (see LinkPicker).
describe('link picking', () => {
  const VIEWPORT = { width: 800, height: 600 }

  function pickCamera(): THREE.PerspectiveCamera {
    const cam = new THREE.PerspectiveCamera(60, VIEWPORT.width / VIEWPORT.height, 0.1, 1000)
    cam.position.set(0, 0, 50)
    cam.lookAt(0, 0, 0)
    cam.updateMatrixWorld(true)
    return cam
  }

  /** Build, size the overlay (pick widths are pixel widths), refresh matrices. */
  function buildForPicking(nodes: GvNode[]) {
    const built = buildScene(nodes)
    built.links.setResolution(VIEWPORT.width, VIEWPORT.height)
    built.root.updateMatrixWorld(true)
    return built
  }

  /** Click at the screen position of `worldPoint`, offset by `dxPx` pixels. */
  function pickAtWorld(
    root: THREE.Object3D,
    cam: THREE.PerspectiveCamera,
    worldPoint: [number, number, number],
    dxPx = 0,
    dyPx = 0,
  ): number | null {
    const ndc = new THREE.Vector3(...worldPoint).project(cam)
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(
      new THREE.Vector2(
        ndc.x + (dxPx * 2) / VIEWPORT.width,
        ndc.y - (dyPx * 2) / VIEWPORT.height,
      ),
      cam,
    )
    return pickNodeId(raycaster, root)
  }

  const spanned = () => [
    makeNode({ id: 1, translate: { x: -10, y: 0, z: 0 } }),
    makeNode({ id: 2, translate: { x: 10, y: 0, z: 0 } }),
    makeLink(3, 1, 2),
  ]

  it('picks a link by clicking the edge it draws, well away from either glyph', () => {
    const { root } = buildForPicking(spanned())
    const cam = pickCamera()
    expect(pickAtWorld(root, cam, [0, 0, 0])).toBe(3)
    // …and the endpoint glyphs still win over their own edge.
    expect(pickAtWorld(root, cam, [-10, 0, 0])).toBe(1)
  })

  it('misses once the click is further off the edge than its pick width', () => {
    const { root } = buildForPicking(spanned())
    const cam = pickCamera()
    // Default ratio 0.1 → max(0.1·20, 5) = 5px wide, so ±2.5px hits.
    expect(pickAtWorld(root, cam, [0, 0, 0], 0, 2)).toBe(3)
    expect(pickAtWorld(root, cam, [0, 0, 0], 0, 30)).toBeNull()
  })

  it('widens the target with ratio, like the drawn line', () => {
    const { root } = buildForPicking([
      makeNode({ id: 1, translate: { x: -10, y: 0, z: 0 } }),
      makeNode({ id: 2, translate: { x: 10, y: 0, z: 0 } }),
      makeLink(3, 1, 2, { ratio: 2 }), // max(2·20, 5) = 40px
    ])
    const cam = pickCamera()
    expect(pickAtWorld(root, cam, [0, 0, 0], 0, 15)).toBe(3)
    expect(pickAtWorld(root, cam, [0, 0, 0], 0, 30)).toBeNull()
  })

  it('picks a Textured Prism link along its axis, like every other link', () => {
    const { root } = buildForPicking([
      makeNode({ id: 1, translate: { x: -10, y: 0, z: 0 } }),
      makeNode({ id: 2, translate: { x: 10, y: 0, z: 0 } }),
      makeLink(3, 1, 2, { geometry: Geometry.TexturedPrism }),
    ])
    expect(pickAtWorld(root, pickCamera(), [0, 0, 0])).toBe(3)
  })

  it('never picks a hidden link', () => {
    const nodes = spanned()
    nodes[2].hide = 1
    const { root } = buildForPicking(nodes)
    expect(pickAtWorld(root, pickCamera(), [0, 0, 0])).toBeNull()
  })

  it('prefers the nearer of two overlapping links', () => {
    const { root } = buildForPicking([
      makeNode({ id: 1, translate: { x: -10, y: 0, z: 0 } }),
      makeNode({ id: 2, translate: { x: 10, y: 0, z: 0 } }),
      makeNode({ id: 3, translate: { x: -10, y: 0, z: 20 } }),
      makeNode({ id: 4, translate: { x: 10, y: 0, z: 20 } }),
      makeLink(5, 1, 2),
      makeLink(6, 3, 4), // 20 units nearer the camera at z = 50
    ])
    expect(pickAtWorld(root, pickCamera(), [0, 0, 20])).toBe(6)
  })
})
