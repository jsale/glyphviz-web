import { describe, expect, it } from 'vitest'
import { parseGvNodeCsv } from './nodeCsv'
import { writeGvNodeCsv } from './writeNodeCsv'
import topologyExampleCsv from './fixtures/topology_example_gv_node.csv?raw'

describe('writeGvNodeCsv', () => {
  it('round-trips the topology example fixture losslessly', () => {
    const first = parseGvNodeCsv(topologyExampleCsv)
    expect(first.errors).toEqual([])
    const written = writeGvNodeCsv(first.nodes)
    const second = parseGvNodeCsv(written)
    expect(second.errors).toEqual([])
    expect(second.warnings).toEqual([])
    expect(second.nodes).toEqual(first.nodes)
  })

  it('write→parse→write is byte-stable', () => {
    const nodes = parseGvNodeCsv(topologyExampleCsv).nodes
    const once = writeGvNodeCsv(nodes)
    const twice = writeGvNodeCsv(parseGvNodeCsv(once).nodes)
    expect(twice).toBe(once)
  })

  it('uses CRLF, 6-decimal floats, and bare ints', () => {
    const nodes = parseGvNodeCsv(
      'id,type,parent_id,branch_level,translate_x,translate_y,translate_z,rotate_x,rotate_y,rotate_z,scale_x,scale_y,scale_z,color_r,color_g,color_b,color_a,geometry,hide,topo\n' +
        '1,5,0,0,1.5,0,0,0,0,0,1,1,1,10,20,30,255,1,0,0',
    ).nodes
    const written = writeGvNodeCsv(nodes)
    const lines = written.split('\r\n')
    expect(lines).toHaveLength(3) // header, row, trailing empty from final CRLF
    expect(lines[2]).toBe('')
    const row = lines[1].split(',')
    expect(row[0]).toBe('1') // int bare
    expect(row[4]).toBe('1.500000') // float 6dp
    expect(lines[0].startsWith('id,type,parent_id')).toBe(true)
  })

  it('writes facet 1-indexed from subspace', () => {
    const nodes = parseGvNodeCsv(
      'id,type,parent_id,branch_level,translate_x,translate_y,translate_z,rotate_x,rotate_y,rotate_z,scale_x,scale_y,scale_z,color_r,color_g,color_b,color_a,geometry,hide,topo,facet\n' +
        '1,5,0,0,0,0,0,0,0,0,1,1,1,0,0,0,255,1,0,1,5',
    ).nodes
    expect(nodes[0].subspace).toBe(4)
    const header = writeGvNodeCsv(nodes).split('\r\n')[0].split(',')
    const row = writeGvNodeCsv(nodes).split('\r\n')[1].split(',')
    expect(row[header.indexOf('facet')]).toBe('5')
  })

  it('omits extension columns nobody needs, adds them when someone does', () => {
    const base =
      'id,type,parent_id,branch_level,translate_x,translate_y,translate_z,rotate_x,rotate_y,rotate_z,scale_x,scale_y,scale_z,color_r,color_g,color_b,color_a,geometry,hide,topo'
    const plain = writeGvNodeCsv(
      parseGvNodeCsv(`${base}\n1,5,0,0,0,0,0,0,0,0,1,1,1,0,0,0,255,1,0,0`).nodes,
    )
    const header = plain.split('\r\n')[0]
    expect(header).toBe(
      'id,type,parent_id,branch_level,translate_x,translate_y,translate_z,rotate_x,rotate_y,rotate_z,scale_x,scale_y,scale_z,color_r,color_g,color_b,color_a,geometry,hide,topo,ratio,facet',
    )

    const withText = writeGvNodeCsv(
      parseGvNodeCsv(`${base},text\n1,5,0,0,0,0,0,0,0,0,1,1,1,0,0,0,255,1,0,0,Hi`).nodes,
    )
    expect(withText.split('\r\n')[0].endsWith(',text')).toBe(true)
  })

  it('writes rotation_mode whenever any node would misread as HTR', () => {
    const csv =
      'id,type,parent_id,branch_level,translate_x,translate_y,translate_z,rotate_x,rotate_y,rotate_z,scale_x,scale_y,scale_z,color_r,color_g,color_b,color_a,geometry,hide,topo,rotation_mode\n' +
      '1,5,0,0,0,0,0,0,45,0,1,1,1,0,0,0,255,1,0,0,0'
    const written = writeGvNodeCsv(parseGvNodeCsv(csv).nodes)
    const header = written.split('\r\n')[0].split(',')
    const row = written.split('\r\n')[1].split(',')
    expect(row[header.indexOf('rotation_mode')]).toBe('0')
  })

  it('quotes fields containing commas or quotes and preserves extras', () => {
    const csv =
      'id,type,parent_id,branch_level,translate_x,translate_y,translate_z,rotate_x,rotate_y,rotate_z,scale_x,scale_y,scale_z,color_r,color_g,color_b,color_a,geometry,hide,topo,text,note\n' +
      '1,5,0,0,0,0,0,0,0,0,1,1,1,0,0,0,255,1,0,0,"Hello, ""world""",keep-me'
    const parsed = parseGvNodeCsv(csv)
    expect(parsed.nodes[0].text).toBe('Hello, "world"')
    expect(parsed.nodes[0].extras.note).toBe('keep-me')

    const written = writeGvNodeCsv(parsed.nodes)
    expect(written).toContain('"Hello, ""world"""')
    const reparsed = parseGvNodeCsv(written)
    expect(reparsed.nodes[0].text).toBe('Hello, "world"')
    expect(reparsed.nodes[0].extras.note).toBe('keep-me')
  })
})
