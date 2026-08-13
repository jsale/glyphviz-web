import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { DynamicNodes } from './dynamicNodes'
import { buildScene } from './buildScene'
import { DEFAULT_SCALE_FLOOR, setEnforceScaleFloor } from './baseScale'
import { clearMaterialCache } from './glyphGeometry'
import { RenderMode, applyRenderMode } from './renderMode'
import { parseGvNodeCsv } from '../gv/nodeCsv'
import type { GvNode } from '../gv/types'

const HEADER =
  'id,type,parent_id,branch_level,translate_x,translate_y,translate_z,rotate_x,rotate_y,' +
  'rotate_z,scale_x,scale_y,scale_z,color_r,color_g,color_b,color_a,geometry,hide,topo,texture_id'

function scene(...rows: Array<Partial<Record<string, number>>>): GvNode[] {
  const text = [
    HEADER,
    ...rows.map((overrides, i) => {
      const base: Record<string, number> = {
        id: i + 1,
        type: 5,
        parent_id: 0,
        branch_level: 0,
        translate_x: 0,
        translate_y: 0,
        translate_z: 0,
        rotate_x: 0,
        rotate_y: 0,
        rotate_z: 0,
        scale_x: 1,
        scale_y: 1,
        scale_z: 1,
        color_r: 10,
        color_g: 20,
        color_b: 30,
        color_a: 255,
        geometry: 1, // Cube solid — one mesh, one Lambert material
        hide: 0,
        topo: 0,
        texture_id: 0,
        ...overrides,
      }
      return HEADER.split(',').map((name) => String(base[name])).join(',')
    }),
  ].join('\n')
  const parsed = parseGvNodeCsv(text)
  expect(parsed.errors).toEqual([])
  return parsed.nodes
}

const NO_SETS = { transform: new Set<number>(), appearance: new Set<number>(), scaled: new Set<number>() }

function glyphMaterial(frame: THREE.Object3D): THREE.MeshLambertMaterial {
  const glyph = frame.getObjectByName('glyph') as THREE.Mesh
  return glyph.material as THREE.MeshLambertMaterial
}

describe('DynamicNodes', () => {
  it('re-applies a bound node’s transform without a rebuild', () => {
    const nodes = scene({}, { parent_id: 1, branch_level: 1, translate_x: 1 })
    const built = buildScene(nodes)
    const dynamic = new DynamicNodes(nodes, built.frames, { ...NO_SETS, transform: new Set([2]) }, new Map())

    nodes[1].translate.x = 5
    nodes[1].rotate.z = 90
    dynamic.update()

    const frame = built.frames.get(2)!
    expect(frame.position.x).toBeCloseTo(5, 12)
    expect(frame.quaternion.z).not.toBe(0)
    dynamic.dispose()
  })

  it('gives an appearance-bound node private materials so siblings do not change', () => {
    clearMaterialCache()
    const nodes = scene({}, {}) // identical → one cached material at build time
    const built = buildScene(nodes)
    expect(glyphMaterial(built.frames.get(1)!)).toBe(glyphMaterial(built.frames.get(2)!))

    const dynamic = new DynamicNodes(nodes, built.frames, { ...NO_SETS, appearance: new Set([1]) }, new Map())
    const animated = glyphMaterial(built.frames.get(1)!)
    const untouched = glyphMaterial(built.frames.get(2)!)
    expect(animated).not.toBe(untouched)

    nodes[0].color = { r: 255, g: 0, b: 0, a: 128 }
    dynamic.update()
    expect(animated.color.getHex()).toBe(0xff0000)
    expect(animated.opacity).toBeCloseTo(128 / 255, 6)
    expect(animated.transparent).toBe(true)
    // The other node kept the build-time colour.
    expect(untouched.color.getHex()).not.toBe(0xff0000)
    expect(untouched.opacity).toBe(1)
    dynamic.dispose()
  })

  it('recompiles a built-opaque material when an alpha track fades it out', () => {
    // Breathing_Century: every glyph is authored at its FINAL alpha and a
    // color_a track fades it to 0 until its year arrives. Three bakes
    // transparency into the program (#define OPAQUE forces alpha to 1), so a
    // material built opaque goes on drawing solid at opacity 0 unless the flag
    // flip is followed by a recompile.
    clearMaterialCache()
    const nodes = scene({ color_a: 255 })
    const built = buildScene(nodes)
    const dynamic = new DynamicNodes(nodes, built.frames, { ...NO_SETS, appearance: new Set([1]) }, new Map())
    const material = glyphMaterial(built.frames.get(1)!)
    expect(material.transparent).toBe(false)

    material.needsUpdate = false
    nodes[0].color.a = 0
    dynamic.update()
    expect(material.opacity).toBe(0)
    expect(material.transparent).toBe(true)
    expect(material.version).toBeGreaterThan(0)

    // Still transparent the next frame — no per-frame recompile.
    const version = material.version
    nodes[0].color.a = 100
    dynamic.update()
    expect(material.version).toBe(version)

    // Back to solid: one more flip, and one more recompile.
    nodes[0].color.a = 255
    dynamic.update()
    expect(material.transparent).toBe(false)
    expect(material.version).toBeGreaterThan(version)
    dynamic.dispose()
  })

  it('leaves a render mode’s forced transparency in charge of the flag', () => {
    clearMaterialCache()
    const nodes = scene({ color_a: 255 })
    const built = buildScene(nodes)
    const dynamic = new DynamicNodes(nodes, built.frames, { ...NO_SETS, appearance: new Set([1]) }, new Map())
    const material = glyphMaterial(built.frames.get(1)!)

    // Additive forces transparency on; a fully opaque frame must not undo it.
    applyRenderMode(built.root, RenderMode.Additive)
    expect(material.transparent).toBe(true)
    nodes[0].color.a = 255
    dynamic.update()
    expect(material.transparent).toBe(true)

    // Off ignores alpha outright, so a faded frame must not turn it back on.
    applyRenderMode(built.root, RenderMode.Off)
    nodes[0].color.a = 0
    dynamic.update()
    expect(material.transparent).toBe(false)

    // Back to Normal, which restores what the node itself now asks for.
    applyRenderMode(built.root, RenderMode.Normal)
    expect(material.transparent).toBe(true)
    dynamic.dispose()
  })

  it('swaps the map for a texture_id flip-book, recompiling only on the first bind', () => {
    clearMaterialCache()
    const nodes = scene({})
    const built = buildScene(nodes)
    const first = new THREE.Texture()
    const second = new THREE.Texture()
    const dynamic = new DynamicNodes(
      nodes,
      built.frames,
      { ...NO_SETS, appearance: new Set([1]) },
      new Map([
        [1, first],
        [2, second],
      ]),
    )
    const material = glyphMaterial(built.frames.get(1)!)

    // Untextured → textured flips USE_MAP, which does need the recompile.
    material.needsUpdate = false
    nodes[0].textureId = 1
    dynamic.update()
    expect(material.map).toBe(first)
    expect(material.version).toBeGreaterThan(0)

    // Texture → texture must not: that is what makes a flip-book affordable.
    const version = material.version
    nodes[0].textureId = 2
    dynamic.update()
    expect(material.map).toBe(second)
    expect(material.version).toBe(version)

    // An id the media folder never supplied falls back to untextured.
    nodes[0].textureId = 99
    dynamic.update()
    expect(material.map).toBeNull()
    dynamic.dispose()
  })

  it('re-derives the draw-scale floor from the animated node\'s OWN scale', () => {
    // The floor is opt-in and off by default (desktop Scene.scale_floor), so
    // the case where it does anything has to switch it on.
    setEnforceScaleFloor(true)
    const nodes = scene({ scale_x: 1, scale_y: 1, scale_z: 1 }, { parent_id: 1, branch_level: 1 })
    const built = buildScene(nodes)
    const dynamic = new DynamicNodes(
      nodes,
      built.frames,
      { ...NO_SETS, transform: new Set([1]), scaled: new Set([1]) },
      new Map(),
    )
    const parentGlyph = built.frames.get(1)!.getObjectByName('glyph')!
    const childGlyph = built.frames.get(2)!.getObjectByName('glyph')!
    expect(parentGlyph.scale.x).toBeCloseTo(1, 12)
    expect(childGlyph.scale.x).toBeCloseTo(1, 12)

    // Its own scale under the floor raises its own correction...
    nodes[0].scale = { x: 0.05, y: 0.05, z: 0.05 }
    dynamic.update()
    expect(parentGlyph.scale.x).toBeCloseTo(DEFAULT_SCALE_FLOOR / 0.05, 10)
    // ...and leaves the CHILD's alone. The floor is per node (desktop
    // node_world_matrix's S_child), never on the accumulated world scale, so
    // the child simply shrinks with its parent through the frame chain.
    // Compensating here is what made deeply nested glyphs balloon.
    expect(childGlyph.scale.x).toBeCloseTo(1, 12)
    dynamic.dispose()
    setEnforceScaleFloor(false)
  })

  it('is empty when nothing is registered, and skips ids with no frame', () => {
    const nodes = scene({})
    const built = buildScene(nodes)
    expect(new DynamicNodes(nodes, built.frames, NO_SETS, new Map()).isEmpty).toBe(true)
    const missing = new DynamicNodes(
      nodes,
      built.frames,
      { ...NO_SETS, transform: new Set([404]) },
      new Map(),
    )
    expect(missing.isEmpty).toBe(true)
  })
})

// The shape / visibility / placement half of the fast path (desktop 77d6361's
// expanded Channels set): glyphs swap when — and only when — a bound shape
// value changes, hide toggles visibility on a glyph the build kept alive, and
// a placement-bound parent's children re-place through the fresh field reads.
describe('DynamicNodes shape, hide and placement animation', () => {
  const SETS = (over: Partial<Record<'transform' | 'appearance' | 'scaled' | 'shape' | 'placement' | 'hidden', Set<number>>>) => ({
    ...NO_SETS,
    ...over,
  })

  it('swaps the glyph when a bound geometry changes, and only then', () => {
    const nodes = scene({ geometry: 1 }) // Cube solid — a Mesh
    const built = buildScene(nodes)
    const dynamic = new DynamicNodes(nodes, built.frames, SETS({ shape: new Set([1]) }), new Map())
    const frame = built.frames.get(1)!
    const before = frame.getObjectByName('glyph')!

    // No change: same object, nothing reported.
    expect(dynamic.update()).toMatchObject({ glyphsRebuilt: false })
    expect(frame.getObjectByName('glyph')).toBe(before)

    nodes[0].geometry = 0 // Cube wire — a LineSegments
    const report = dynamic.update()
    expect(report.glyphsRebuilt).toBe(true)
    const after = frame.getObjectByName('glyph')!
    expect(after).not.toBe(before)
    expect((after as THREE.LineSegments).isLineSegments).toBe(true)
    // The new glyph is pickable again.
    expect(after.children.some((c) => c.userData.isPickProxy)).toBe(true)
    dynamic.dispose()
  })

  it('re-applies the Rod draw factors when the node’s own topo animates', () => {
    const nodes = scene({})
    const built = buildScene(nodes)
    const dynamic = new DynamicNodes(nodes, built.frames, SETS({ shape: new Set([1]) }), new Map())
    const frame = built.frames.get(1)!
    nodes[0].topo = 6 // Rod
    dynamic.update()
    const glyph = frame.getObjectByName('glyph')!
    expect(glyph.scale.z).toBeCloseTo(5, 12) // ROD_HEIGHT_FACTOR
    expect(glyph.position.z).toBeCloseTo(glyph.scale.z, 12) // bottom-cap offset
    dynamic.dispose()
  })

  it('toggles glyph visibility for a bound hide, without a rebuild', () => {
    const nodes = scene({})
    const built = buildScene(nodes, { channelHideBound: new Set([1]) })
    const dynamic = new DynamicNodes(nodes, built.frames, SETS({ hidden: new Set([1]) }), new Map())
    const glyph = built.frames.get(1)!.getObjectByName('glyph')!
    expect(glyph.visible).toBe(true)

    nodes[0].hide = 1
    expect(dynamic.update()).toMatchObject({ glyphsRebuilt: false })
    expect(built.frames.get(1)!.getObjectByName('glyph')).toBe(glyph) // same object
    expect(glyph.visible).toBe(false)

    nodes[0].hide = 0
    dynamic.update()
    expect(glyph.visible).toBe(true)
    dynamic.dispose()
  })

  it('builds the glyph for a CSV-hidden node whose hide is bound, starting hidden', () => {
    const nodes = scene({ hide: 1 })
    // Without the option a hidden node gets no glyph at all…
    expect(buildScene(nodes).frames.get(1)!.getObjectByName('glyph')).toBeUndefined()
    // …with it the glyph exists, and registration applies the row's value.
    const built = buildScene(nodes, { channelHideBound: new Set([1]) })
    const glyph = built.frames.get(1)!.getObjectByName('glyph')!
    const dynamic = new DynamicNodes(nodes, built.frames, SETS({ hidden: new Set([1]) }), new Map())
    expect(glyph.visible).toBe(false)
    dynamic.dispose()
  })

  it('reports overlay membership dirty when topo crosses Plot/Surface or an overlay parent hides', () => {
    const nodes = scene({}, { parent_id: 1, branch_level: 1, translate_x: 3 })
    const built = buildScene(nodes)
    const dynamic = new DynamicNodes(
      nodes,
      built.frames,
      SETS({ shape: new Set([1]), hidden: new Set([1]) }),
      new Map(),
    )
    nodes[0].topo = 16 // None → Plot
    expect(dynamic.update().overlayDirty).toBe(true)
    nodes[0].topo = 17 // Plot → Surface: still an overlay topo either side
    expect(dynamic.update().overlayDirty).toBe(false)
    nodes[0].hide = 1 // a hidden Surface parent draws no lattice
    expect(dynamic.update().overlayDirty).toBe(true)
    nodes[0].topo = 4 // Surface → Cylinder
    expect(dynamic.update().overlayDirty).toBe(true)
    dynamic.dispose()
  })

  it('re-places a placement-bound parent’s children from the fresh topo', () => {
    const nodes = scene({ topo: 0 }, { parent_id: 1, branch_level: 1, translate_x: 45, translate_y: 45, translate_z: 1 })
    const built = buildScene(nodes)
    const childFrame = built.frames.get(2)!
    const cartesian = childFrame.position.clone()
    const dynamic = new DynamicNodes(
      nodes,
      built.frames,
      SETS({ placement: new Set([1]) }),
      new Map(),
    )
    nodes[0].topo = 2 // Sphere (KML): the same translate means lon/lat now
    dynamic.update()
    expect(childFrame.position.distanceTo(cartesian)).toBeGreaterThan(0.01)
    dynamic.dispose()
  })

  it('re-privatises appearance clones onto a swapped glyph', () => {
    const nodes = scene({}, {}) // two look-alikes sharing one cached material
    const built = buildScene(nodes)
    const dynamic = new DynamicNodes(
      nodes,
      built.frames,
      SETS({ shape: new Set([1]), appearance: new Set([1]) }),
      new Map(),
    )
    nodes[0].geometry = 3 // swap to Sphere solid
    nodes[0].color.r = 200
    dynamic.update()
    const swapped = glyphMaterial(built.frames.get(1)!)
    const untouched = glyphMaterial(built.frames.get(2)!)
    expect(swapped).not.toBe(untouched)
    expect(swapped.color.r).toBeCloseTo(200 / 255, 6)
    expect(untouched.color.r).toBeCloseTo(10 / 255, 6)
    dynamic.dispose()
  })
})
