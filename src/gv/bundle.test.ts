import { describe, expect, it } from 'vitest'
import { findScenes, normalizePath } from './bundle'

// The real layouts these tests mirror come from the desktop repo's examples/
// tree (surveyed 2026-07-25): 29 of 36 example scenes carry a companion tag
// file, 12 carry a media/ folder, and Global_Terrorism_Example holds five
// sub-scenes under one parent folder.
const TIME_REPLAY = [
  'Time_Replay/TimeReplay_gv_node.csv',
  'Time_Replay/TimeReplay_gv_tag.csv',
  'Time_Replay/media/bluemarble-2048.png',
  'Time_Replay/media/map00001.jpg',
  'Time_Replay/media/map00002.jpg',
  'Time_Replay/media/map00003.jpg',
]

describe('normalizePath', () => {
  it('accepts Windows separators and relative prefixes', () => {
    expect(normalizePath('a\\b\\c.csv')).toBe('a/b/c.csv')
    expect(normalizePath('./a/b.csv')).toBe('a/b.csv')
    expect(normalizePath('/a/b.csv')).toBe('a/b.csv')
  })
})

describe('findScenes', () => {
  it('resolves a folder with tag file and media', () => {
    const scenes = findScenes(TIME_REPLAY)
    expect(scenes).toHaveLength(1)
    const scene = scenes[0]
    expect(scene.nodePath).toBe('Time_Replay/TimeReplay_gv_node.csv')
    expect(scene.dir).toBe('Time_Replay')
    expect(scene.label).toBe('Time_Replay')
    expect(scene.tagPath).toBe('Time_Replay/TimeReplay_gv_tag.csv')
    expect(scene.mediaDir).toBe('Time_Replay/media')
    expect(scene.media.entries).toHaveLength(4)
    expect(scene.mediaPathById.get(1)).toBe('Time_Replay/media/bluemarble-2048.png')
    expect(scene.mediaPathById.get(4)).toBe('Time_Replay/media/map00003.jpg')
  })

  it('finds a scene at the top of the set', () => {
    const scenes = findScenes(['gv_node.csv', 'gv_tag.csv', 'media/earth.png'])
    expect(scenes[0].dir).toBe('')
    expect(scenes[0].label).toBe('gv_node.csv')
    expect(scenes[0].tagPath).toBe('gv_tag.csv')
    expect(scenes[0].mediaPathById.get(1)).toBe('media/earth.png')
  })

  it('leaves tagPath null when the companion is not in the set', () => {
    const scenes = findScenes(['a/gv_node.csv'])
    expect(scenes[0].tagPath).toBeNull()
    expect(scenes[0].mediaDir).toBeNull()
  })

  it('does not pair a tag file whose name is not the derived one', () => {
    const scenes = findScenes(['a/scene_gv_node.csv', 'a/other_gv_tag.csv'])
    expect(scenes[0].tagPath).toBeNull()
  })

  it('lists every sub-scene of a dropped parent folder, shallowest first', () => {
    const scenes = findScenes([
      'GT/Event_Cloud/EventCloud_gv_node.csv',
      'GT/Event_Cloud/EventCloud_gv_tag.csv',
      'GT/Time_Replay/TimeReplay_gv_node.csv',
      'GT/Campaign_Pulse/CampaignPulse_gv_node.csv',
      'GT/GT_gv_node.csv',
    ])
    expect(scenes.map((s) => s.nodePath)).toEqual([
      'GT/GT_gv_node.csv',
      'GT/Campaign_Pulse/CampaignPulse_gv_node.csv',
      'GT/Event_Cloud/EventCloud_gv_node.csv',
      'GT/Time_Replay/TimeReplay_gv_node.csv',
    ])
  })

  it('scopes media to the node CSV folder and never inherits an ancestor media/', () => {
    const scenes = findScenes([
      'Parent/media/stray.png',
      'Parent/Child/Child_gv_node.csv',
      'Parent/Child/media/own.png',
    ])
    expect(scenes).toHaveLength(1)
    expect(scenes[0].media.entries.map((e) => e.name)).toEqual(['own.png'])
  })

  it('ignores nested folders inside media/', () => {
    const scenes = findScenes(['a/gv_node.csv', 'a/media/ok.png', 'a/media/sub/deep.png'])
    expect(scenes[0].media.entries.map((e) => e.name)).toEqual(['ok.png'])
  })

  it('pairs Channels companions only when exactly one of each is present', () => {
    const one = findScenes([
      'a/scene_gv_node.csv',
      'a/scene_gv_ch-map.csv',
      'a/scene_gv_ch-tracks.csv',
      'a/scene_gv_audio.txt',
    ])[0]
    expect(one.channelMapPath).toBe('a/scene_gv_ch-map.csv')
    expect(one.channelTracksPath).toBe('a/scene_gv_ch-tracks.csv')
    expect(one.audioManifestPath).toBe('a/scene_gv_audio.txt')

    const two = findScenes([
      'a/scene_gv_node.csv',
      'a/scene_gv_ch-map.csv',
      'a/other_gv_ch-map.csv',
      'a/scene_gv_ch-tracks.csv',
    ])[0]
    expect(two.channelMapPath).toBeNull()
    expect(two.channelTracksPath).toBe('a/scene_gv_ch-tracks.csv')
  })

  it('does not mistake a Channels file for a node CSV', () => {
    const scenes = findScenes(['a/scene_gv_ch-map.csv', 'a/scene_gv_ch-tracks.csv'])
    expect(scenes).toEqual([])
  })

  it('offers a plain CSV when no …node.csv is present', () => {
    const scenes = findScenes(['scene.csv'])
    expect(scenes.map((s) => s.nodePath)).toEqual(['scene.csv'])
    // …but its tag name is not derivable, matching the desktop loader.
    expect(scenes[0].tagPath).toBeNull()
  })

  it('prefers …node.csv over other CSVs in the same set', () => {
    const scenes = findScenes(['a/notes.csv', 'a/scene_gv_node.csv'])
    expect(scenes.map((s) => s.nodePath)).toEqual(['a/scene_gv_node.csv'])
  })

  it('tolerates Windows separators and case differences', () => {
    const scenes = findScenes([
      'A\\Scene_GV_Node.CSV',
      'A\\Scene_GV_Tag.CSV',
      'A\\Media\\Earth.PNG',
    ])
    expect(scenes[0].tagPath).toBe('A/Scene_GV_Tag.CSV')
    expect(scenes[0].mediaPathById.get(1)).toBe('A/Media/Earth.PNG')
  })
})
