import { describe, expect, it } from 'vitest'
import { parseGvNodeCsv } from './nodeCsv'
import { DEFAULT_TOPO_SCALE, REF_GRID_DEFAULT_RGB, TOPO_SCALE_ANTZ } from './types'
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

  // The rate columns became authorable from the Properties panel, so a value
  // typed in this app now has to reach a file the desktop opens — the whole
  // point of the field is that it keeps moving after a save and reload.
  it('writes the rate columns a Properties-panel edit sets, and only those', () => {
    const base =
      'id,type,parent_id,branch_level,translate_x,translate_y,translate_z,rotate_x,rotate_y,rotate_z,scale_x,scale_y,scale_z,color_r,color_g,color_b,color_a,geometry,hide,topo'
    const nodes = parseGvNodeCsv(`${base}\n1,5,0,0,0,0,0,0,0,0,1,1,1,0,0,0,255,1,0,0`).nodes
    expect(writeGvNodeCsv(nodes).split('\r\n')[0]).not.toContain('rate')

    // What the inspector's rateRow does: one axis, on every selected node.
    nodes[0].rotateRate.z = 2.5
    const written = writeGvNodeCsv(nodes)
    const header = written.split('\r\n')[0].split(',')
    const row = written.split('\r\n')[1].split(',')
    // The group travels together (all three axes) but the untouched groups
    // stay out of the file, so a plain scene does not grow nine columns.
    expect(header).toContain('rotate_rate_x')
    expect(row[header.indexOf('rotate_rate_z')]).toBe('2.500000')
    expect(header).not.toContain('translate_rate_x')
    expect(header).not.toContain('scale_rate_x')

    const reparsed = parseGvNodeCsv(written)
    expect(reparsed.errors).toEqual([])
    expect(reparsed.nodes[0].rotateRate).toEqual({ x: 0, y: 0, z: 2.5 })
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

  // topo_scale has no ANTz/GaiaViz slot either, so an omitted column reloads as
  // 1.0 — which is what keeps every file written before the field existed
  // byte-identical through a load → save round trip.
  it('writes topo_scale only for a scene with a retuned parent, at 10 sig figs', () => {
    const base =
      'id,type,parent_id,branch_level,translate_x,translate_y,translate_z,rotate_x,rotate_y,rotate_z,scale_x,scale_y,scale_z,color_r,color_g,color_b,color_a,geometry,hide,topo'
    const nodes = parseGvNodeCsv(
      `${base}\n1,5,0,0,0,0,0,0,0,0,1,1,1,0,0,0,255,1,0,0\n2,5,1,1,0,0,0,0,0,0,1,1,1,0,0,0,255,1,0,0`,
    ).nodes
    expect(nodes[0].topoScale).toBe(DEFAULT_TOPO_SCALE)
    expect(writeGvNodeCsv(nodes).split('\r\n')[0]).not.toContain('topo_scale')

    nodes[0].topoScale = TOPO_SCALE_ANTZ
    const written = writeGvNodeCsv(nodes)
    const header = written.split('\r\n')[0].split(',')
    const rows = written.split('\r\n').slice(1, 3).map((r) => r.split(','))
    const at = header.indexOf('topo_scale')
    expect(at).toBeGreaterThan(-1)
    // Ten significant figures, not the 6 decimal places every other float
    // column takes — which would round this to 0.005556.
    expect(rows[0][at]).toBe('0.005555555556')
    expect(rows[1][at]).toBe('1') // untouched node, trailing zeros stripped
    // And it survives the trip: the desktop reads what we write.
    expect(parseGvNodeCsv(written).nodes[0].topoScale).toBeCloseTo(TOPO_SCALE_ANTZ, 12)
  })

  it('writes show_text only for a scene that pins a label', () => {
    const base =
      'id,type,parent_id,branch_level,translate_x,translate_y,translate_z,rotate_x,rotate_y,rotate_z,scale_x,scale_y,scale_z,color_r,color_g,color_b,color_a,geometry,hide,topo'
    const nodes = parseGvNodeCsv(`${base}\n1,5,0,0,0,0,0,0,0,0,1,1,1,0,0,0,255,1,0,0`).nodes
    expect(writeGvNodeCsv(nodes)).not.toContain('show_text')

    nodes[0].showText = 1
    const written = writeGvNodeCsv(nodes)
    expect(written.split('\r\n')[0]).toContain('show_text')
    expect(parseGvNodeCsv(written).nodes[0].showText).toBe(1)
  })

  it('writes the tag colour and its mode independently, and only when set', () => {
    const base =
      'id,type,parent_id,branch_level,translate_x,translate_y,translate_z,rotate_x,rotate_y,rotate_z,scale_x,scale_y,scale_z,color_r,color_g,color_b,color_a,geometry,hide,topo'
    const nodes = parseGvNodeCsv(`${base}\n1,0,0,0,0,0,0,0,0,0,1,1,1,0,0,0,255,1,0,0`).nodes
    const plain = writeGvNodeCsv(nodes)
    expect(plain).not.toContain('tag_color')

    // Match-node-colour without ever picking a colour: mode only.
    nodes[0].tagColorMode = 1
    const modeOnly = writeGvNodeCsv(nodes)
    expect(modeOnly.split('\r\n')[0]).toContain('tag_color_mode')
    expect(modeOnly).not.toContain('tag_color_r')

    nodes[0].tagColorMode = 0
    nodes[0].tagColor = { r: 10, g: 20, b: 30 }
    const colorOnly = writeGvNodeCsv(nodes)
    expect(colorOnly.split('\r\n')[0]).not.toContain('tag_color_mode')
    const reparsed = parseGvNodeCsv(colorOnly).nodes[0]
    expect(reparsed.tagColor).toEqual({ r: 10, g: 20, b: 30 })
    expect(reparsed.tagColorMode).toBe(0)
  })

  it('writes the reference-grid colour only when it leaves the default', () => {
    const base =
      'id,type,parent_id,branch_level,translate_x,translate_y,translate_z,rotate_x,rotate_y,rotate_z,scale_x,scale_y,scale_z,color_r,color_g,color_b,color_a,geometry,hide,topo'
    const nodes = parseGvNodeCsv(`${base}\n1,0,0,0,0,0,0,0,0,0,1,1,1,0,0,0,255,1,0,0`).nodes
    expect(nodes[0].refGridColor).toEqual(REF_GRID_DEFAULT_RGB)
    expect(writeGvNodeCsv(nodes)).not.toContain('ref_grid_color')

    nodes[0].refGridColor = { r: 90, g: 0, b: 120 }
    const written = writeGvNodeCsv(nodes)
    expect(written.split('\r\n')[0]).toContain('ref_grid_color_r')
    expect(parseGvNodeCsv(written).nodes[0].refGridColor).toEqual({ r: 90, g: 0, b: 120 })
  })
})
