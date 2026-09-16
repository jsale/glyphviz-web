import * as THREE from 'three'
import { afterEach, describe, expect, it } from 'vitest'
import { Geometry, GEOMETRY_MAX, NodeType, RotationMode, Topo } from '../gv/types'
import type { GvNode } from '../gv/types'
import {
  DEFAULT_BASE_SCALE,
  setBaseScale,
  setEnforceScaleFloor,
} from './baseScale'
import { buildScene } from './buildScene'
import { createGlyphObject, WIRE_GEOMETRIES } from './glyphGeometry'
import { drawsNothing, renderedGlyphScale, scaleIsZero } from './zeroScale'

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

const zero = { x: 0, y: 0, z: 0 }

function glyphOf(root: THREE.Object3D, id: number): THREE.Object3D | undefined {
  return root.getObjectByName(`gv:${id}`)?.children.find((c) => c.userData.isGlyph)
}

afterEach(() => {
  setBaseScale(DEFAULT_BASE_SCALE)
  setEnforceScaleFloor(false)
})

describe('WIRE_GEOMETRIES', () => {
  // The set is a copy of the desktop's `_WIRE_IDS`, so it can only be checked
  // against what this app actually builds — otherwise a wire glyph added here
  // would silently start being culled at zero scale and start taking textures.
  it('is exactly the ids that build as line segments', () => {
    const drawnAsLines = new Set<number>()
    for (let id = 0; id <= GEOMETRY_MAX; id++) {
      const glyph = createGlyphObject(id, {
        color: new THREE.Color(1, 1, 1),
        opacity: 1,
        ratio: 0.1,
      })
      if (glyph instanceof THREE.LineSegments) drawnAsLines.add(id)
    }
    expect([...drawnAsLines].sort((a, b) => a - b)).toEqual(
      [...WIRE_GEOMETRIES].sort((a, b) => a - b),
    )
  })
})

describe('renderedGlyphScale', () => {
  it('is the authored scale at the shipped defaults', () => {
    expect(renderedGlyphScale(makeNode({ scale: { x: 2, y: 0.5, z: 0 } }))).toEqual([2, 0.5, 0])
  })

  it('carries the Global Scale, which cannot zero a live axis or revive a dead one', () => {
    setBaseScale(4)
    expect(renderedGlyphScale(makeNode({ scale: { x: 1, y: 1, z: 1 } }))).toEqual([4, 4, 4])
    expect(renderedGlyphScale(makeNode({ scale: zero }))).toEqual([0, 0, 0])
    setBaseScale(0.1)
    expect(renderedGlyphScale(makeNode({ scale: zero }))).toEqual([0, 0, 0])
  })

  it('carries the Rod factors, which multiply a zero to a zero', () => {
    const rod = makeNode({ topo: Topo.Rod, scale: { x: 1, y: 1, z: 1 } })
    expect(renderedGlyphScale(rod)).toEqual([0.25, 0.25, 5])
    expect(renderedGlyphScale({ ...rod, scale: zero })).toEqual([0, 0, 0])
  })

  it('reads a World Grid off its extents, where neither Global Scale nor the floor applies', () => {
    const grid = makeNode({ type: NodeType.WorldGrid, geometry: Geometry.GridSolid, scale: zero })
    setBaseScale(10)
    setEnforceScaleFloor(true)
    expect(renderedGlyphScale(grid)).toEqual([0, 0, 0])
  })
})

describe('drawsNothing', () => {
  it('culls a zero-scale solid and keeps everything with any extent', () => {
    expect(drawsNothing(makeNode({ scale: zero }))).toBe(true)
    expect(drawsNothing(makeNode({ scale: { x: 0, y: 0, z: 1 } }))).toBe(false)
    // Tiny is not zero: the clamp exists precisely so an author can mean it.
    expect(drawsNothing(makeNode({ scale: { x: 1e-9, y: 1e-9, z: 1e-9 } }))).toBe(false)
    expect(drawsNothing(makeNode({ scale: { x: -0.5, y: -0.5, z: -0.5 } }))).toBe(false)
  })

  it('exempts a Point, any wire and anything textured', () => {
    expect(drawsNothing(makeNode({ scale: zero, geometry: Geometry.Point }))).toBe(false)
    for (const wire of WIRE_GEOMETRIES) {
      expect(drawsNothing(makeNode({ scale: zero, geometry: wire })), `geometry ${wire}`).toBe(false)
    }
    // The raw id, like the desktop — an id the media folder never supplied
    // exempts a node just the same.
    expect(drawsNothing(makeNode({ scale: zero, textureId: 99 }))).toBe(false)
  })

  it('culls anything under a collapsed ancestor, exemptions still winning', () => {
    expect(drawsNothing(makeNode({ scale: { x: 3, y: 3, z: 3 } }), true)).toBe(true)
    expect(drawsNothing(makeNode({ geometry: Geometry.Point }), true)).toBe(false)
    expect(drawsNothing(makeNode({ textureId: 1 }), true)).toBe(false)
  })
})

describe('scaleIsZero', () => {
  it('needs all three axes', () => {
    expect(scaleIsZero({ x: 0, y: 0, z: 0 })).toBe(true)
    expect(scaleIsZero({ x: 0, y: 0, z: 1e-12 })).toBe(false)
  })
})

describe('buildScene with the zero-scale cull', () => {
  // The case the cull exists for: the mesh is the picture and the vertices are
  // not shapes. Authoring them hide=1 would delete them from the mesh and
  // color_a=0 would make the mesh transparent, so scale 0 is the only thing an
  // author can say — and until now it cost three Object3Ds apiece.
  const surfaceScene = (): GvNode[] => [
    makeNode({ id: 1, topo: Topo.Surface, scale: { x: 1, y: 1, z: 1 } }),
    makeNode({ id: 2, parentId: 1, translate: { x: 0, y: 0, z: 0 }, scale: zero }),
    makeNode({ id: 3, parentId: 1, translate: { x: 1, y: 0, z: 1 }, scale: zero }),
    makeNode({ id: 4, parentId: 1, translate: { x: 0, y: 1, z: 2 }, scale: zero }),
    makeNode({ id: 5, parentId: 1, translate: { x: 1, y: 1, z: 3 }, scale: zero }),
  ]

  it('leaves the Surface mesh untouched while its vertices cost a frame apiece', () => {
    const built = buildScene(surfaceScene())
    expect(built.culledCount).toBe(4)
    expect(built.drawnCount).toBe(1) // the parent glyph only
    expect(built.overlays.quadCount).toBe(1)
    for (const id of [2, 3, 4, 5]) {
      expect(built.frames.has(id), `frame for ${id}`).toBe(true)
      expect(glyphOf(built.root, id), `glyph for ${id}`).toBeUndefined()
    }
  })

  it('saves two Object3Ds and a draw call per vertex', () => {
    const count = (nodes: GvNode[]) => {
      let n = 0
      buildScene(nodes).root.traverse(() => n++)
      return n
    }
    const culled = count(surfaceScene())
    const kept = count(surfaceScene().map((n) => (n.id === 1 ? n : { ...n, scale: { x: 1, y: 1, z: 1 } })))
    // 4 vertices x (glyph + pick proxy).
    expect(kept - culled).toBe(8)
  })

  it('never culls a node an animation can grow', () => {
    // The whole divergence from the desktop, whose cull is a per-frame test and
    // so needs no such list (BuildSceneOptions.liveNodeIds).
    const nodes = surfaceScene()
    const built = buildScene(nodes, { liveNodeIds: new Set([3, 5]) })
    expect(built.culledCount).toBe(2)
    expect(glyphOf(built.root, 3)).toBeDefined()
    expect(glyphOf(built.root, 5)).toBeDefined()
    expect(glyphOf(built.root, 2)).toBeUndefined()
  })

  it('does not change what is culled when the Global Scale or the clamp move', () => {
    // Both feed drawScaleCorrection, so the decision has to be re-checked
    // against them — and comes out the same, since neither can move an axis on
    // or off exactly zero. That is what lets the slider keep its in-place
    // rescale (refreshDrawScales) instead of needing a rebuild.
    const nodes = surfaceScene()
    const baseline = buildScene(nodes).culledCount
    for (const scale of [0.1, 2.5, 10]) {
      setBaseScale(scale)
      expect(buildScene(nodes).culledCount, `base scale ${scale}`).toBe(baseline)
    }
    setBaseScale(DEFAULT_BASE_SCALE)
    setEnforceScaleFloor(true)
    expect(buildScene(nodes).culledCount).toBe(baseline)
  })

  it('still spends a draw-limit slot on a culled row', () => {
    // The desktop says so explicitly: its counter increments before the check,
    // so the `\` cap stays a stable prefix of the FILE rather than of whatever
    // happens to draw. Here the limit is planned off the node list, which never
    // consults scale — this pins that the two stay in step.
    const nodes = surfaceScene()
    const built = buildScene(nodes, { drawLimit: 3 })
    // Rows 1-3 are within the cut; the parent draws, its two vertices do not.
    expect(glyphOf(built.root, 1)).toBeDefined()
    expect(built.culledCount).toBe(2)
    // Rows 4 and 5 fell past it, so they are not culled — they were never
    // eligible to draw in the first place.
    expect(built.frames.has(5)).toBe(true)
    expect(glyphOf(built.root, 5)).toBeUndefined()
  })

  it('keeps a zero-scale grid from culling its children', () => {
    // A World Grid's frame is (1, 1, 1) whatever its scale says, so its scale
    // never reaches a child's draw matrix — measured against the desktop, which
    // keeps those children for exactly that reason.
    const built = buildScene([
      makeNode({ id: 1, type: NodeType.WorldGrid, geometry: Geometry.GridSolid, scale: zero }),
      makeNode({ id: 2, parentId: 1, scale: { x: 1, y: 1, z: 1 } }),
    ])
    expect(glyphOf(built.root, 1)).toBeUndefined()
    expect(glyphOf(built.root, 2)).toBeDefined()
  })
})
