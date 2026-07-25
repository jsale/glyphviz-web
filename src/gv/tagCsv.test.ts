import { describe, expect, it } from 'vitest'
import { applyTags, deriveTagFilename, parseGvTagCsv, parseTagTitle } from './tagCsv'
import { parseGvNodeCsv } from './nodeCsv'
import { writeGvTagCsv } from './writeTagCsv'
import type { GvNode } from './types'
// The real companion pair authored in the desktop repo
// (examples/Topology_Example/) — 18 labels keyed by record_id, matching the
// node fixture already used by nodeCsv.test.ts and parity.test.ts.
import topologyNodeCsv from './fixtures/topology_example_gv_node.csv?raw'
import topologyTagCsv from './fixtures/topology_example_gv_tag.csv?raw'

function node(id: number, extras: Record<string, string> = {}): GvNode {
  return parseGvNodeCsv(
    [
      'id,type,parent_id,branch_level,translate_x,translate_y,translate_z,rotate_x,rotate_y,rotate_z,scale_x,scale_y,scale_z,color_r,color_g,color_b,color_a,geometry,hide,topo' +
        (Object.keys(extras).length ? ',' + Object.keys(extras).join(',') : ''),
      `${id},5,0,0,0,0,0,0,0,0,1,1,1,255,0,0,255,1,0,0` +
        (Object.keys(extras).length ? ',' + Object.values(extras).join(',') : ''),
    ].join('\r\n'),
  ).nodes[0]
}

describe('deriveTagFilename', () => {
  it('swaps a trailing node stem for tag', () => {
    expect(deriveTagFilename('gv_node.csv')).toBe('gv_tag.csv')
    expect(deriveTagFilename('topology_example_gv_node.csv')).toBe('topology_example_gv_tag.csv')
    expect(deriveTagFilename('antz0001node.csv')).toBe('antz0001tag.csv')
    expect(deriveTagFilename('np_node.csv')).toBe('np_tag.csv')
  })

  it('returns null when no tag name is derivable', () => {
    expect(deriveTagFilename('scene.csv')).toBeNull()
    expect(deriveTagFilename('nodes.csv')).toBeNull()
    // Desktop-loader quirk, deliberately matched: a timestamped save finds no
    // companion on reload even though the saver wrote one.
    expect(deriveTagFilename('gv_node20260725103000.csv')).toBeNull()
  })
})

describe('parseTagTitle', () => {
  it('decodes an HTML anchor into label + link', () => {
    expect(parseTagTitle('<a href="https://example.org/x">Site</a>')).toEqual({
      text: 'Site',
      link: 'https://example.org/x',
    })
  })

  it('accepts single quotes, no quotes, and mixed case in the anchor', () => {
    expect(parseTagTitle("<a href='http://a.b'>Q</a>").link).toBe('http://a.b')
    expect(parseTagTitle('<a href=http://a.b>Q</a>').link).toBe('http://a.b')
    expect(parseTagTitle('<A HREF="http://a.b">Q</A>').text).toBe('Q')
  })

  it('falls back to the raw string when the anchor label is empty', () => {
    const raw = '<a href="http://a.b"></a>'
    expect(parseTagTitle(raw)).toEqual({ text: raw, link: 'http://a.b' })
  })

  it('treats a bare URL as both label and link', () => {
    for (const url of ['http://a.b', 'https://a.b', 'www.a.b', 'ftp://a.b']) {
      expect(parseTagTitle(url)).toEqual({ text: url, link: url })
    }
  })

  it('treats anything else as plain text', () => {
    expect(parseTagTitle('Sphere')).toEqual({ text: 'Sphere', link: '' })
    expect(parseTagTitle('a.b/c')).toEqual({ text: 'a.b/c', link: '' })
    // Divergence from the desktop's pandas NA handling, which yields "nan".
    expect(parseTagTitle('')).toEqual({ text: '', link: '' })
    expect(parseTagTitle('None')).toEqual({ text: 'None', link: '' })
  })
})

describe('parseGvTagCsv', () => {
  it('parses the real Topology_Example tag file', () => {
    const result = parseGvTagCsv(topologyTagCsv)
    expect(result.warnings).toEqual([])
    expect(result.byRecordId.size).toBe(18)
    expect(result.byRecordId.get(1)).toEqual({ text: 'No Topology', link: '' })
    expect(result.byRecordId.get(103)).toEqual({ text: 'Surface', link: '' })
  })

  it('ignores rows whose table_id is not 0', () => {
    const result = parseGvTagCsv(
      ['id,table_id,record_id,title', '0,0,1,Kept', '1,3,2,Dropped'].join('\r\n'),
    )
    expect([...result.byRecordId.keys()]).toEqual([1])
    expect(result.rowCount).toBe(2)
    expect(result.warnings).toHaveLength(1)
  })

  it('defaults table_id to 0 when the column is absent', () => {
    const result = parseGvTagCsv(['record_id,title', '1,Kept'].join('\r\n'))
    expect(result.byRecordId.get(1)).toEqual({ text: 'Kept', link: '' })
  })

  it('loads nothing without a record_id column', () => {
    const result = parseGvTagCsv(['id,table_id,title', '0,0,Orphan'].join('\r\n'))
    expect(result.byRecordId.size).toBe(0)
    expect(result.warnings).toHaveLength(1)
  })

  it('skips rows with a non-numeric record_id but keeps the rest', () => {
    const result = parseGvTagCsv(
      ['id,table_id,record_id,title', '0,0,,Blank', '1,0,x,Bad', '2,0,3,Good'].join('\r\n'),
    )
    expect([...result.byRecordId.keys()]).toEqual([3])
    expect(result.warnings).toHaveLength(2)
  })

  it('keeps the last row on a duplicate record_id, as the desktop dict does', () => {
    const result = parseGvTagCsv(
      ['id,table_id,record_id,title', '0,0,1,First', '1,0,1,Second'].join('\r\n'),
    )
    expect(result.byRecordId.get(1)!.text).toBe('Second')
  })

  it('handles a quoted title containing a comma', () => {
    const result = parseGvTagCsv(['id,table_id,record_id,title', '0,0,1,"Reno, NV"'].join('\r\n'))
    expect(result.byRecordId.get(1)!.text).toBe('Reno, NV')
  })
})

describe('applyTags', () => {
  it('labels the real Topology_Example scene by node id', () => {
    const parsed = parseGvNodeCsv(topologyNodeCsv)
    expect(parsed.hasInlineLabelColumns).toBe(false)
    const tags = parseGvTagCsv(topologyTagCsv).byRecordId
    expect(applyTags(parsed.nodes, tags)).toBe(18)
    expect(parsed.nodes.find((n) => n.id === 1)!.text).toBe('No Topology')
    expect(parsed.nodes.find((n) => n.id === 13)!.text).toBe('Sphere')
    // Untagged nodes stay blank.
    expect(parsed.nodes.find((n) => n.id === 2)!.text).toBe('')
  })

  it('matches by the record_id extra in preference to the node id', () => {
    const nodes = [node(1, { record_id: '42' })]
    applyTags(nodes, new Map([[42, { text: 'By record', link: '' }]]))
    expect(nodes[0].text).toBe('By record')
  })

  it('falls back to the node id when the record_id lookup misses', () => {
    const nodes = [node(7, { record_id: '999' })]
    applyTags(nodes, new Map([[7, { text: 'By id', link: '' }]]))
    expect(nodes[0].text).toBe('By id')
  })

  it('falls back to the node id when record_id is blank or non-numeric', () => {
    const nodes = [node(7, { record_id: '' }), node(8, { record_id: 'x' })]
    applyTags(
      nodes,
      new Map([
        [7, { text: 'Seven', link: '' }],
        [8, { text: 'Eight', link: '' }],
      ]),
    )
    expect(nodes.map((n) => n.text)).toEqual(['Seven', 'Eight'])
  })

  it('leaves nodes untouched when there are no tags', () => {
    const nodes = [node(1)]
    expect(applyTags(nodes, new Map())).toBe(0)
    expect(nodes[0].text).toBe('')
  })
})

describe('writeGvTagCsv', () => {
  it('round-trips the real Topology_Example labels', () => {
    const parsed = parseGvNodeCsv(topologyNodeCsv)
    applyTags(parsed.nodes, parseGvTagCsv(topologyTagCsv).byRecordId)
    const reparsed = parseGvTagCsv(writeGvTagCsv(parsed.nodes))
    expect(reparsed.byRecordId).toEqual(parseGvTagCsv(topologyTagCsv).byRecordId)
  })

  it('writes an anchor for linked nodes and plain text otherwise', () => {
    const a = node(1)
    a.text = 'Site'
    a.link = 'https://example.org'
    const b = node(2)
    b.text = 'Plain'
    const c = node(3) // no label — no row
    const out = writeGvTagCsv([a, b, c])
    expect(out).toBe(
      [
        'id,table_id,record_id,title',
        '0,0,1,"<a href=""https://example.org"">Site</a>"',
        '1,0,2,Plain',
        '',
      ].join('\r\n'),
    )
    const back = parseGvTagCsv(out)
    expect(back.byRecordId.get(1)).toEqual({ text: 'Site', link: 'https://example.org' })
    expect(back.byRecordId.get(2)).toEqual({ text: 'Plain', link: '' })
  })

  it('carries the record_id extra through', () => {
    const n = node(1, { record_id: '77' })
    n.text = 'Tagged'
    expect(writeGvTagCsv([n])).toContain('0,0,77,Tagged')
  })
})
