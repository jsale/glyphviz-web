import { describe, expect, it } from 'vitest'
import {
  findColumn,
  NODE_TABLE_COLUMNS,
  NODE_TABLE_WIDTH,
  packedColor,
  sortNodesForTable,
} from './nodeTableModel'
import type { GvNode } from '../gv/types'
import { Geometry, NodeType, Topo } from '../gv/types'

function makeNode(overrides: Partial<GvNode>): GvNode {
  return {
    id: 1,
    type: NodeType.Glyph,
    parentId: 0,
    branchLevel: 0,
    translate: { x: 0, y: 0, z: 0 },
    rotate: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    color: { r: 200, g: 200, b: 200, a: 255 },
    geometry: Geometry.CubeSolid,
    hide: 0,
    topo: Topo.None,
    ratio: 0,
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

const column = (id: string) => {
  const c = findColumn(id)
  if (!c) throw new Error(`no column ${id}`)
  return c
}

describe('column set', () => {
  it('is the desktop _COLUMNS list, in order', () => {
    expect(NODE_TABLE_COLUMNS.map((c) => c.label)).toEqual([
      'ID', 'Type', 'Parent', 'Level', 'Geo', 'Topo', 'Hide', 'Texture',
      'X', 'Y', 'Z', 'Rx', 'Ry', 'Rz', 'RotMode', 'Sx', 'Sy', 'Sz', 'Ratio', 'Color',
    ])
  })

  it('ends with the colour column, and only that one draws a swatch', () => {
    expect(NODE_TABLE_COLUMNS.filter((c) => c.swatch).map((c) => c.id)).toEqual(['Color'])
    expect(NODE_TABLE_COLUMNS[NODE_TABLE_COLUMNS.length - 1].id).toBe('Color')
  })

  it('sums its own widths', () => {
    expect(NODE_TABLE_WIDTH).toBe(NODE_TABLE_COLUMNS.reduce((s, c) => s + c.width, 0))
  })
})

describe('cell text', () => {
  const node = makeNode({
    id: 42,
    type: NodeType.Link,
    parentId: 7,
    branchLevel: 2,
    geometry: Geometry.SphereSolid,
    topo: Topo.Spiral,
    hide: 1,
    textureId: 3,
    translate: { x: 1.23456, y: -20, z: 0 },
    rotate: { x: 359.9999, y: 0, z: 45.5 },
    rotationMode: 0,
    scale: { x: 2, y: 0.5, z: 1 },
    ratio: 0.125,
    color: { r: 1, g: 171, b: 255, a: 128 },
  })

  it('shows raw integer ids, matching the desktop str(val)', () => {
    expect(column('ID').text(node)).toBe('42')
    expect(column('Type').text(node)).toBe('7')
    expect(column('Parent').text(node)).toBe('7')
    expect(column('Level').text(node)).toBe('2')
    expect(column('Geo').text(node)).toBe('3')
    expect(column('Topo').text(node)).toBe('14')
    expect(column('Hide').text(node)).toBe('1')
    expect(column('Texture').text(node)).toBe('3')
    expect(column('RotMode').text(node)).toBe('0')
  })

  it('shows the float attributes at three decimals, matching f"{val:.3f}"', () => {
    expect(column('X').text(node)).toBe('1.235')
    expect(column('Y').text(node)).toBe('-20.000')
    expect(column('Rx').text(node)).toBe('360.000')
    expect(column('Rz').text(node)).toBe('45.500')
    expect(column('Sy').text(node)).toBe('0.500')
    expect(column('Ratio').text(node)).toBe('0.125')
  })

  it('shows the colour as upper-case #RRGGBB, alpha excluded', () => {
    expect(column('Color').text(node)).toBe('#01ABFF')
  })
})

describe('packed colour key', () => {
  it('packs R<<16|G<<8|B, so ordering runs red then green then blue', () => {
    const c = (r: number, g: number, b: number) => packedColor(makeNode({ color: { r, g, b, a: 255 } }))
    expect(c(1, 171, 255)).toBe(0x01abff)
    expect(c(0, 0, 0)).toBe(0)
    expect(c(255, 255, 255)).toBe(0xffffff)
    expect(c(2, 0, 0)).toBeGreaterThan(c(1, 255, 255))
  })

  it('ignores alpha, as the desktop UserRole does', () => {
    const opaque = makeNode({ color: { r: 10, g: 20, b: 30, a: 255 } })
    const ghost = makeNode({ color: { r: 10, g: 20, b: 30, a: 0 } })
    expect(packedColor(opaque)).toBe(packedColor(ghost))
  })
})

describe('sorting', () => {
  const nodes = [
    makeNode({ id: 3, branchLevel: 1, translate: { x: 5, y: 0, z: 0 } }),
    makeNode({ id: 1, branchLevel: 2, translate: { x: -1, y: 0, z: 0 } }),
    makeNode({ id: 2, branchLevel: 1, translate: { x: 100, y: 0, z: 0 } }),
  ]

  it('orders ascending and descending by the column key', () => {
    expect(sortNodesForTable(nodes, column('ID'), 'asc').map((n) => n.id)).toEqual([1, 2, 3])
    expect(sortNodesForTable(nodes, column('ID'), 'desc').map((n) => n.id)).toEqual([3, 2, 1])
    expect(sortNodesForTable(nodes, column('X'), 'asc').map((n) => n.id)).toEqual([1, 3, 2])
  })

  it('keeps file order for ties in BOTH directions (Python sorted is stable too)', () => {
    // Ids 3 and 2 share branch level 1; neither direction may swap them.
    expect(sortNodesForTable(nodes, column('Level'), 'asc').map((n) => n.id)).toEqual([3, 2, 1])
    expect(sortNodesForTable(nodes, column('Level'), 'desc').map((n) => n.id)).toEqual([1, 3, 2])
  })

  it('never mutates the scene array — that array is the CSV file order', () => {
    const before = nodes.map((n) => n.id)
    sortNodesForTable(nodes, column('ID'), 'desc')
    expect(nodes.map((n) => n.id)).toEqual(before)
  })

  it('handles an empty scene', () => {
    expect(sortNodesForTable([], column('ID'), 'asc')).toEqual([])
  })
})
