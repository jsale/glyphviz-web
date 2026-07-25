import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { DynamicNodes } from './dynamicNodes'
import { buildScene, RENDER_SCALE_FLOOR } from './buildScene'
import { clearMaterialCache } from './glyphGeometry'
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

  it('re-derives the draw-scale floor on a scaled node and its descendants', () => {
    const nodes = scene({ scale_x: 1, scale_y: 1, scale_z: 1 }, { parent_id: 1, branch_level: 1 })
    const built = buildScene(nodes)
    const dynamic = new DynamicNodes(
      nodes,
      built.frames,
      { ...NO_SETS, transform: new Set([1]), scaled: new Set([1]) },
      new Map(),
    )
    const childGlyph = built.frames.get(2)!.getObjectByName('glyph')!
    expect(childGlyph.scale.x).toBeCloseTo(1, 12)

    // Shrinking the PARENT drops the child's cumulative world scale under the
    // 0.2 floor, so the child's glyph correction has to grow to compensate.
    nodes[0].scale = { x: 0.05, y: 0.05, z: 0.05 }
    dynamic.update()
    expect(childGlyph.scale.x).toBeCloseTo(RENDER_SCALE_FLOOR / 0.05, 10)
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
