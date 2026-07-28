import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { DynamicNodes } from './dynamicNodes'
import { buildScene, RENDER_SCALE_FLOOR } from './buildScene'
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
    expect(parentGlyph.scale.x).toBeCloseTo(RENDER_SCALE_FLOOR / 0.05, 10)
    // ...and leaves the CHILD's alone. The floor is per node (desktop
    // node_world_matrix's S_child), never on the accumulated world scale, so
    // the child simply shrinks with its parent through the frame chain.
    // Compensating here is what made deeply nested glyphs balloon.
    expect(childGlyph.scale.x).toBeCloseTo(1, 12)
    dynamic.dispose()
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
