import { describe, expect, it } from 'vitest'
import {
  applyChannelFrame,
  bindChannels,
  channelInputId,
  deriveChannelFilenames,
  parseGvChMap,
  parseGvChTracks,
  resetChannels,
  roundHalfToEven,
} from './channels'
import { parseGvNodeCsv } from './nodeCsv'
import type { GvNode } from './types'

const NODE_HEADER =
  'id,type,parent_id,branch_level,translate_x,translate_y,translate_z,rotate_x,rotate_y,' +
  'rotate_z,scale_x,scale_y,scale_z,color_r,color_g,color_b,color_a,geometry,hide,topo,' +
  'texture_id,ch_input_id'

function nodes(...rows: string[]): GvNode[] {
  const parsed = parseGvNodeCsv([NODE_HEADER, ...rows].join('\n'))
  expect(parsed.errors).toEqual([])
  return parsed.nodes
}

/** id 1, channel `channel`, everything else at a recognizable default. */
function row(id: number, channel: number, overrides: Partial<Record<string, number>> = {}): string {
  const base: Record<string, number> = {
    id,
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
    geometry: 1,
    hide: 0,
    topo: 0,
    texture_id: 0,
    ch_input_id: channel,
    ...overrides,
  }
  return NODE_HEADER.split(',').map((name) => String(base[name])).join(',')
}

const MAP_HEADER = 'id,channel_id,track_id,attribute,track_table_id,ch_map_table_id,record_id'
const mapRow = (channel: number, track: number, attribute: string) =>
  `0,${channel},${track},${attribute},0,0,0`

describe('parseGvChMap', () => {
  it('reads only channel_id / track_id / attribute', () => {
    const result = parseGvChMap(
      [MAP_HEADER, mapRow(1, 1, 'translate_z'), mapRow(1, 2, 'color_a'), mapRow(2, 1, 'scale_x')].join('\n'),
    )
    expect(result.errors).toEqual([])
    expect(result.rowCount).toBe(3)
    expect(result.byChannel.get(1)).toEqual([
      { trackId: 1, attribute: 'translate_z' },
      { trackId: 2, attribute: 'color_a' },
    ])
    expect(result.byChannel.get(2)).toEqual([{ trackId: 1, attribute: 'scale_x' }])
  })

  it('fails when a required column is absent', () => {
    const result = parseGvChMap('channel_id,attribute\n1,color_a')
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].message).toContain('track_id')
  })

  it('skips unreadable rows without failing the file', () => {
    const result = parseGvChMap([MAP_HEADER, '0,x,1,color_a,0,0,0', mapRow(3, 1, 'color_a')].join('\n'))
    expect(result.rowCount).toBe(1)
    expect(result.warnings).toHaveLength(1)
    expect(result.byChannel.has(3)).toBe(true)
  })
})

describe('parseGvChTracks', () => {
  it('takes ch<n> columns as tracks and every row as a frame', () => {
    const result = parseGvChTracks('cyclecount,ch1,ch7,notes\n0,1.5,10,a\n1,2.5,20,b\n2,3.5,30,c\n')
    expect(result.errors).toEqual([])
    expect(result.frameCount).toBe(3)
    expect([...result.columns.keys()].sort((a, b) => a - b)).toEqual([1, 7])
    expect([...result.columns.get(1)!]).toEqual([1.5, 2.5, 3.5])
    expect([...result.columns.get(7)!]).toEqual([10, 20, 30])
  })

  it('ignores cyclecount and other non-track columns', () => {
    const result = parseGvChTracks('cyclecount,channel_id,ch2\n0,99,4\n')
    expect([...result.columns.keys()]).toEqual([2])
  })

  it('fails when there are no track columns at all', () => {
    const result = parseGvChTracks('cyclecount,value\n0,1\n')
    expect(result.errors).toHaveLength(1)
    expect(result.frameCount).toBe(0)
  })

  it('holds the previous value through a blank cell rather than emitting NaN', () => {
    const result = parseGvChTracks('cyclecount,ch1\n0,5\n1,\n2,7\n')
    expect([...result.columns.get(1)!]).toEqual([5, 5, 7])
    expect(result.warnings[0].message).toContain('held the previous')
  })
})

describe('deriveChannelFilenames', () => {
  it('follows the node/companion naming convention', () => {
    expect(deriveChannelFilenames('scene_gv_node.csv')).toEqual({
      map: 'scene_gv_ch-map.csv',
      tracks: 'scene_gv_ch-tracks.csv',
    })
  })

  it('returns null for a name that is not <stem>node.csv', () => {
    expect(deriveChannelFilenames('scene.csv')).toBeNull()
  })
})

describe('channelInputId', () => {
  it('reads ch_input_id out of extras, tolerating a float spelling', () => {
    const [a, b] = nodes(row(1, 3), row(2, 0))
    expect(channelInputId(a)).toBe(3)
    expect(channelInputId(b)).toBe(0)
    a.extras['ch_input_id'] = '7.0'
    expect(channelInputId(a)).toBe(7)
    a.extras['ch_input_id'] = 'nan'
    expect(channelInputId(a)).toBe(0)
  })

  it('accepts the GaiaViz np_ch_in_id spelling', () => {
    const [node] = nodes(row(1, 0))
    delete node.extras['ch_input_id']
    node.extras['np_ch_in_id'] = '4'
    expect(channelInputId(node)).toBe(4)
  })
})

describe('bindChannels', () => {
  const scene = () => nodes(row(1, 1), row(2, 1), row(3, 2), row(4, 0))
  const map = parseGvChMap(
    [MAP_HEADER, mapRow(1, 1, 'translate_z'), mapRow(1, 2, 'color_a'), mapRow(2, 1, 'scale_x')].join('\n'),
  )
  const tracks = parseGvChTracks('cyclecount,ch1,ch2\n0,1,255\n1,2,128\n2,3,0\n')

  it('fans one channel out to every node that opts into it', () => {
    const anim = bindChannels(map, tracks, scene())
    expect(anim.frameCount).toBe(3)
    // nodes 1 and 2 take both channel-1 rows; node 3 takes the channel-2 row.
    expect(anim.bindings).toHaveLength(5)
    expect([...anim.boundNodeIds].sort()).toEqual([1, 2, 3])
    expect([...anim.transformBoundNodeIds].sort()).toEqual([1, 2, 3])
    expect([...anim.appearanceBoundNodeIds].sort()).toEqual([1, 2])
    expect([...anim.scaleBoundNodeIds]).toEqual([3])
  })

  it('applies absolute values, rounding and clamping colour', () => {
    const rows = scene()
    const anim = bindChannels(map, tracks, rows)
    applyChannelFrame(anim, 1)
    expect(rows[0].translate.z).toBe(2)
    expect(rows[0].color.a).toBe(128)
    expect(rows[2].scale.x).toBe(2)
    // ch_input_id 0 never animates.
    expect(rows[3].translate.z).toBe(0)
  })

  it('clamps the frame index into range', () => {
    const rows = scene()
    const anim = bindChannels(map, tracks, rows)
    applyChannelFrame(anim, 99)
    expect(rows[0].translate.z).toBe(3)
    applyChannelFrame(anim, -5)
    expect(rows[0].translate.z).toBe(1)
  })

  it('restores the load-time values on reset, rates included', () => {
    const rows = scene()
    const anim = bindChannels(map, tracks, rows)
    applyChannelFrame(anim, 2)
    expect(rows[0].color.a).toBe(0)
    resetChannels(anim)
    expect(rows[0].translate.z).toBe(0)
    expect(rows[0].color.a).toBe(255)
    expect(rows[2].scale.x).toBe(1)
  })

  it('reports every unmatched piece of the three-way join', () => {
    const brokenMap = parseGvChMap(
      [MAP_HEADER, mapRow(1, 9, 'translate_z'), mapRow(1, 1, 'wobble'), mapRow(5, 1, 'scale_x')].join('\n'),
    )
    const anim = bindChannels(brokenMap, tracks, nodes(row(1, 1), row(2, 7)))
    expect(anim.bindings).toHaveLength(0)
    const text = anim.warnings.join(' ')
    expect(text).toContain('wobble')
    expect(text).toContain('no ch<n> column')
    expect(text).toContain('drive no node')
    expect(text).toContain('no channel map row')
  })

  it('collects every texture_id a flip-book track can produce', () => {
    const flipMap = parseGvChMap([MAP_HEADER, mapRow(1, 1, 'texture_id')].join('\n'))
    const flipTracks = parseGvChTracks('cyclecount,ch1\n0,1\n1,2.4\n2,-3\n3,2.6\n')
    const anim = bindChannels(flipMap, flipTracks, nodes(row(1, 1)))
    expect([...anim.textureIds].sort((a, b) => a - b)).toEqual([1, 2, 3])
  })

  it('floors texture_id at 0 and rounds it', () => {
    const flipMap = parseGvChMap([MAP_HEADER, mapRow(1, 1, 'texture_id')].join('\n'))
    const flipTracks = parseGvChTracks('cyclecount,ch1\n0,2.6\n1,-4\n')
    const rows = nodes(row(1, 1))
    const anim = bindChannels(flipMap, flipTracks, rows)
    applyChannelFrame(anim, 0)
    expect(rows[0].textureId).toBe(3)
    applyChannelFrame(anim, 1)
    expect(rows[0].textureId).toBe(0)
  })

  it('classifies a rate binding as both transform-affecting and rate-driven', () => {
    const rateMap = parseGvChMap([MAP_HEADER, mapRow(1, 1, 'rotate_rate_z')].join('\n'))
    const anim = bindChannels(rateMap, tracks, nodes(row(1, 1)))
    expect([...anim.transformBoundNodeIds]).toEqual([1])
    expect([...anim.rateBoundNodeIds]).toEqual([1])
    expect(anim.appearanceBoundNodeIds.size).toBe(0)
  })
})

describe('roundHalfToEven', () => {
  it("matches Python's round() on exact halves", () => {
    expect(roundHalfToEven(0.5)).toBe(0)
    expect(roundHalfToEven(1.5)).toBe(2)
    expect(roundHalfToEven(2.5)).toBe(2)
    expect(roundHalfToEven(3.5)).toBe(4)
    expect(roundHalfToEven(-0.5)).toBe(0)
    expect(roundHalfToEven(-1.5)).toBe(-2)
    expect(roundHalfToEven(-2.5)).toBe(-2)
  })

  it('rounds everything else the ordinary way', () => {
    expect(roundHalfToEven(2.4)).toBe(2)
    expect(roundHalfToEven(2.6)).toBe(3)
    expect(roundHalfToEven(-2.6)).toBe(-3)
  })
})
