import { describe, expect, it } from 'vitest'
import { linkChildId } from './links'
import { Geometry, NodeType } from './types'
import type { GvNode } from './types'

function makeLink(extras: Record<string, string>): GvNode {
  return {
    id: 9,
    type: NodeType.Link,
    parentId: 1,
    branchLevel: 1,
    translate: { x: 0, y: 0, z: 0 },
    rotate: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    color: { r: 230, g: 230, b: 230, a: 255 },
    geometry: Geometry.Line,
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
    extras,
  }
}

describe('linkChildId', () => {
  it('reads the B-end id from extras, tolerating float strings', () => {
    expect(linkChildId(makeLink({ child_id: '42' }))).toBe(42)
    expect(linkChildId(makeLink({ child_id: '42.0' }))).toBe(42)
  })

  it('returns 0 for missing, empty, or junk values', () => {
    expect(linkChildId(makeLink({}))).toBe(0)
    expect(linkChildId(makeLink({ child_id: '' }))).toBe(0)
    expect(linkChildId(makeLink({ child_id: 'abc' }))).toBe(0)
  })
})
