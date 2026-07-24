import { describe, expect, it } from 'vitest'
import { describeNode, nodeCssColor } from './describe'
import { parseGvNodeCsv } from './nodeCsv'

const CSV = [
  'id,type,parent_id,branch_level,translate_x,translate_y,translate_z,rotate_x,rotate_y,rotate_z,scale_x,scale_y,scale_z,color_r,color_g,color_b,color_a,geometry,hide,topo,ratio,facet,text,mystery',
  '7,5,3,1,72.0,0,0.5,0,45,0,0.3,0.3,0.3,242,121,61,255,3,0,2,0.15,5,Hello,42',
].join('\n')

describe('describeNode', () => {
  const node = parseGvNodeCsv(CSV).nodes[0]
  const byLabel = new Map(describeNode(node).map((f) => [f.label, f.value]))

  it('resolves id fields to desktop names', () => {
    expect(byLabel.get('type')).toBe('Glyph (5)')
    expect(byLabel.get('geometry')).toBe('Sphere (3)')
    expect(byLabel.get('topo')).toBe('Sphere (KML) (2)')
  })

  it('formats vectors and rotation mode', () => {
    expect(byLabel.get('translate')).toBe('72, 0, 0.5')
    expect(byLabel.get('rotate')).toBe('0, 45, 0 (Heading/Tilt/Roll)')
    expect(byLabel.get('scale')).toBe('0.3, 0.3, 0.3')
  })

  it('shows facet 1-indexed alongside subspace', () => {
    expect(byLabel.get('facet')).toBe('5 (subspace 4)')
  })

  it('includes optional fields only when set', () => {
    expect(byLabel.get('text')).toBe('Hello')
    expect(byLabel.has('link')).toBe(false)
    expect(byLabel.has('hide')).toBe(false)
    expect(byLabel.get('extras')).toBe('1 column(s): mystery')
  })

  it('renders the color swatch as hex', () => {
    expect(nodeCssColor(node)).toBe('#f2793d')
  })
})
