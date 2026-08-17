// The Channels companions Save Selection carries along (src/gv/channelExport.ts),
// ported from the desktop's tests for export_channel_subset.

import { describe, expect, it } from 'vitest'
import { channelIdsForNodes, exportChannelSubset } from './channelExport'
import { parseGvChMap, parseGvChTracks } from './channels'
import { parseGvNodeCsv } from './nodeCsv'
import { buildSelection } from './selectionExport'
import fixtureCsv from './fixtures/selection_export_gv_node.csv?raw'

// A 4-channel scene's companions: channel N drives track N.
const MAP_CSV =
  'id,channel_id,track_id,attribute,track_table_id,ch_map_table_id,record_id\n' +
  '0,1,1,translate_z,0,0,0\n' +
  '1,2,2,translate_z,0,0,0\n' +
  '2,3,3,scale_x,0,0,0\n' +
  '3,4,4,color_index,0,0,0\n'
const TRACKS_CSV = 'cyclecount,ch1,ch2,ch3,ch4\n0,0.1,0.2,0.3,0.4\n1,1.1,1.2,1.3,1.4\n'

describe('exportChannelSubset', () => {
  it('keeps only the bound channels, and every scene-level column', () => {
    const subset = exportChannelSubset(MAP_CSV, TRACKS_CSV, new Set([2, 3]))!
    expect(subset).toBeTruthy()
    expect([subset.channels, subset.tracks]).toEqual([2, 2])

    expect([...parseGvChMap(subset.mapText).byChannel.keys()].sort()).toEqual([2, 3])
    expect([...parseGvChTracks(subset.tracksText).columns.keys()].sort()).toEqual([2, 3])
    // cyclecount is not a track column and must survive.
    expect(subset.tracksText.split('\r\n')[0]).toBe('cyclecount,ch2,ch3')
  })

  it('keeps every frame', () => {
    const subset = exportChannelSubset(MAP_CSV, TRACKS_CSV, new Set([1]))!
    expect(parseGvChTracks(subset.tracksText).frameCount).toBe(2)
  })

  it('round-trips a column neither parser reads', () => {
    // The reason the filter is at the FILE level rather than through the two
    // parsers: `id`, `track_table_id` and `record_id` are GaiaViz-tool columns
    // both apps ignore, and losing them would rewrite the file.
    const subset = exportChannelSubset(MAP_CSV, TRACKS_CSV, new Set([2]))!
    expect(subset.mapText.split('\r\n')[0]).toBe(
      'id,channel_id,track_id,attribute,track_table_id,ch_map_table_id,record_id',
    )
    expect(subset.mapText).toContain('1,2,2,translate_z,0,0,0')
    expect(subset.mapText).not.toContain('0,1,1,translate_z')
  })

  it('writes nothing at all when no channel matches', () => {
    // An empty ch-map would still be found as the fragment's companion and
    // would shadow a real one sharing the folder.
    expect(exportChannelSubset(MAP_CSV, TRACKS_CSV, new Set([99]))).toBeNull()
    expect(exportChannelSubset(MAP_CSV, TRACKS_CSV, new Set())).toBeNull()
  })

  it('declines a map with no channel_id/track_id columns', () => {
    expect(exportChannelSubset('a,b\n1,2\n', TRACKS_CSV, new Set([1]))).toBeNull()
  })
})

describe('channelIdsForNodes', () => {
  it('reads the ids off the exported nodes, not off the whole scene', () => {
    // The fixture binds node 5 to channel 7 and node 6 to channel 9; exporting
    // the subtree under 4 takes 5 and not 6.
    const nodes = parseGvNodeCsv(fixtureCsv).nodes
    expect(channelIdsForNodes(nodes)).toEqual(new Set([7, 9]))
    const exported = buildSelection(nodes, [4])
    expect(channelIdsForNodes(exported.nodes)).toEqual(new Set([7]))
  })
})
