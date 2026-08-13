import { describe, expect, it } from 'vitest'
import { parseGvNodeCsv, REQUIRED_COLUMNS } from './nodeCsv'
// Real example authored in the desktop GlyphViz repo
// (examples/Topology_Example/topology_example_gv_node.csv) — a 22-column
// minimal-dialect file exercising every topology id. First parity target.
import topologyExampleCsv from './fixtures/topology_example_gv_node.csv?raw'

const HEADER = REQUIRED_COLUMNS.join(',')
// A plain glyph at the origin: scale 1, opaque red cube, no children placement.
const PLAIN_ROW = '1,5,0,0,0,0,0,0,0,0,1,1,1,255,0,0,255,1,0,0'

function csv(lines: string[]): string {
  return lines.join('\r\n')
}

describe('parseGvNodeCsv', () => {
  it('parses a minimal 20-column row with documented defaults', () => {
    const result = parseGvNodeCsv(csv([HEADER, PLAIN_ROW]))
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.nodes).toHaveLength(1)

    const node = result.nodes[0]
    expect(node.id).toBe(1)
    expect(node.type).toBe(5)
    expect(node.parentId).toBe(0)
    expect(node.scale).toEqual({ x: 1, y: 1, z: 1 })
    expect(node.color).toEqual({ r: 255, g: 0, b: 0, a: 255 })
    expect(node.geometry).toBe(1)
    expect(node.topo).toBe(0)
    // Load-time defaults for absent optional columns.
    expect(node.ratio).toBe(0.1)
    // Every file written before the field existed places as it always has.
    expect(node.topoScale).toBe(1)
    expect(node.subspace).toBe(0)
    expect(node.rotationMode).toBe(1) // absent column → Heading/Tilt/Roll
    expect(node.textureId).toBe(0)
    expect(node.translateRate).toEqual({ x: 0, y: 0, z: 0 })
    expect(node.text).toBe('')
    expect(node.link).toBe('')
    expect(node.extras).toEqual({})
    expect(result.hasInlineLabelColumns).toBe(false)
  })

  it('loads the real Topology_Example file cleanly', () => {
    const result = parseGvNodeCsv(topologyExampleCsv)
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.nodes).toHaveLength(109)
    expect(result.hasInlineLabelColumns).toBe(false)

    const first = result.nodes[0]
    expect(first.id).toBe(1)
    expect(first.translate.x).toBe(-102)
    expect(first.ratio).toBe(0.15)
    expect(first.geometry).toBe(22)
    expect(first.color).toEqual({ r: 242, g: 61, b: 61, a: 255 })

    // Cube-topology children select faces via 1-indexed facet → 0-indexed subspace.
    const cubeChild = result.nodes.find((n) => n.id === 9)!
    expect(cubeChild.subspace).toBe(1) // facet 2 on disk

    // Every topology id 0–17 appears among the root nodes.
    const rootTopos = new Set(result.nodes.filter((n) => n.parentId === 0).map((n) => n.topo))
    expect(rootTopos.size).toBe(18)
  })

  it('fails fatally when required columns are missing, listing all of them', () => {
    const header = REQUIRED_COLUMNS.filter((c) => c !== 'hide' && c !== 'topo').join(',')
    const result = parseGvNodeCsv(csv([header, '1,5,0,0,0,0,0,0,0,0,1,1,1,255,0,0,255,1']))
    expect(result.nodes).toEqual([])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].message).toContain('hide')
    expect(result.errors[0].message).toContain('topo')
  })

  it('rejects GaiaViz np_-dialect files with a clear message', () => {
    const result = parseGvNodeCsv(csv(['np_node_id,np_geometry_id', '1,1']))
    expect(result.nodes).toEqual([])
    expect(result.errors[0].message).toContain('GaiaViz')
  })

  it('reports an empty file', () => {
    const result = parseGvNodeCsv('')
    expect(result.nodes).toEqual([])
    expect(result.errors).toHaveLength(1)
  })

  it('rejects duplicate header columns', () => {
    const result = parseGvNodeCsv(csv([`${HEADER},id`, `${PLAIN_ROW},2`]))
    expect(result.nodes).toEqual([])
    expect(result.errors[0].message).toContain('Duplicate column')
  })

  it('skips a row with a bad required value but keeps parsing, with line numbers', () => {
    const bad = PLAIN_ROW.replace('1,5,0,0', '2,oops,0,0')
    const good = PLAIN_ROW.replace(/^1,/, '3,')
    const result = parseGvNodeCsv(csv([HEADER, PLAIN_ROW, bad, good]))
    expect(result.nodes.map((n) => n.id)).toEqual([1, 3])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].line).toBe(3)
    expect(result.errors[0].column).toBe('type')
  })

  it('skips rows whose field count does not match the header', () => {
    const result = parseGvNodeCsv(csv([HEADER, PLAIN_ROW, '4,5,0']))
    expect(result.nodes).toHaveLength(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].line).toBe(3)
  })

  it('prefers subspace over facet when both columns exist', () => {
    const result = parseGvNodeCsv(csv([`${HEADER},facet,subspace`, `${PLAIN_ROW},5,2`]))
    expect(result.nodes[0].subspace).toBe(2)
  })

  it('clips facet 0 (below the 1-indexed range) to subspace 0', () => {
    const result = parseGvNodeCsv(csv([`${HEADER},facet`, `${PLAIN_ROW},0`]))
    expect(result.nodes[0].subspace).toBe(0)
  })

  it('reads inline text/link columns, including quoted commas', () => {
    const result = parseGvNodeCsv(
      csv([`${HEADER},text,link`, `${PLAIN_ROW},"Hello, world",https://example.com`]),
    )
    expect(result.hasInlineLabelColumns).toBe(true)
    expect(result.nodes[0].text).toBe('Hello, world')
    expect(result.nodes[0].link).toBe('https://example.com')
  })

  it('preserves unknown columns verbatim in extras', () => {
    const result = parseGvNodeCsv(csv([`${HEADER},aux_a_x,my_custom`, `${PLAIN_ROW},1.5,keep me`]))
    expect(result.errors).toEqual([])
    expect(result.nodes[0].extras).toEqual({ aux_a_x: '1.5', my_custom: 'keep me' })
  })

  it('clamps out-of-range color channels with a warning', () => {
    const row = PLAIN_ROW.replace('255,0,0,255', '300,0,0,255')
    const result = parseGvNodeCsv(csv([HEADER, row]))
    expect(result.nodes[0].color.r).toBe(255)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0].column).toBe('color_r')
  })

  it('warns on duplicate ids and dangling parent references', () => {
    const dangling = '2,5,99,1,0,0,0,0,0,0,1,1,1,0,255,0,255,1,0,0'
    const result = parseGvNodeCsv(csv([HEADER, PLAIN_ROW, PLAIN_ROW, dangling]))
    expect(result.nodes).toHaveLength(3)
    const messages = result.warnings.map((w) => w.message).join(' ')
    expect(messages).toContain('Duplicate node id 1')
    expect(messages).toContain('missing parent 99')
  })

  it('warns on out-of-range geometry and topology ids', () => {
    const row = PLAIN_ROW.replace(/1,0,0$/, '99,0,44')
    const result = parseGvNodeCsv(csv([HEADER, row]))
    expect(result.nodes).toHaveLength(1)
    expect(result.warnings.map((w) => w.column)).toEqual(['geometry', 'topo'])
  })

  it('reads per-row rotation_mode when the column is present', () => {
    const result = parseGvNodeCsv(csv([`${HEADER},rotation_mode`, `${PLAIN_ROW},0`]))
    expect(result.nodes[0].rotationMode).toBe(0)
  })

  it('applies column defaults to empty optional cells', () => {
    const result = parseGvNodeCsv(csv([`${HEADER},ratio`, `${PLAIN_ROW},`]))
    expect(result.nodes[0].ratio).toBe(0.1)
  })

  it('reads topo_scale as a full-precision float when the column is present', () => {
    const result = parseGvNodeCsv(
      csv([`${HEADER},topo_scale`, `${PLAIN_ROW},0.005555555556`]),
    )
    expect(result.nodes[0].topoScale).toBe(0.005555555556)
    // An unreadable cell is not a reason to place a subtree 180x out.
    expect(parseGvNodeCsv(csv([`${HEADER},topo_scale`, `${PLAIN_ROW},`])).nodes[0].topoScale).toBe(1)
  })

  it('defaults the tag-styling columns to unpinned, uniform, pale yellow', () => {
    const node = parseGvNodeCsv(csv([HEADER, PLAIN_ROW])).nodes[0]
    expect(node.showText).toBe(0)
    expect(node.tagColorMode).toBe(0)
    expect(node.tagColor).toEqual({ r: 255, g: 255, b: 200 })
  })

  it('reads show_text and the World row’s tag colouring', () => {
    const result = parseGvNodeCsv(
      csv([
        `${HEADER},show_text,tag_color_mode,tag_color_r,tag_color_g,tag_color_b`,
        `${PLAIN_ROW},1,1,10,20,30`,
      ]),
    )
    expect(result.nodes[0].showText).toBe(1)
    expect(result.nodes[0].tagColorMode).toBe(1)
    expect(result.nodes[0].tagColor).toEqual({ r: 10, g: 20, b: 30 })
    // Tracked columns, so they must not also land in extras.
    expect(result.nodes[0].extras).toEqual({})
  })
})
