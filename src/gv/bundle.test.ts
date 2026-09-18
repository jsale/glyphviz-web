import { describe, expect, it } from 'vitest'
import { findScenes, normalizePath, resolveRelative } from './bundle'

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

describe('resolveRelative', () => {
  it('resolves a manifest path against the scene folder', () => {
    // The real shape: Violin_A_Major_Example_gv_audio.txt holds
    // "media/356437__mtg__violin-a-major.wav".
    expect(resolveRelative('Violin_A_Major_Example', 'media/violin.wav')).toBe(
      'Violin_A_Major_Example/media/violin.wav',
    )
    expect(resolveRelative('', 'media/violin.wav')).toBe('media/violin.wav')
    expect(resolveRelative('a/b', './c.wav')).toBe('a/b/c.wav')
    expect(resolveRelative('a/b', '..\\shared\\c.wav')).toBe('a/shared/c.wav')
  })

  it('drops a climb above the dropped set instead of escaping it', () => {
    expect(resolveRelative('a', '../../outside.wav')).toBe('outside.wav')
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

// Imported models: a web-only convention (the desktop's mesh_ids are import
// order within one session and name no file), so ids come from the sorted file
// name — the same rule media/ → texture_id already follows.
describe('mesh files in a scene folder', () => {
  it('numbers a meshes/ folder 1..N by sorted name, case-SENSITIVELY', () => {
    // Case-sensitive on purpose: the desktop sorts with Python's sorted(), so
    // uppercase precedes lowercase and 'hull' comes before 'antenna'. This
    // used to use compareMediaNames and put Antenna first, which handed the
    // same folder different mesh_ids in the two apps.
    const scenes = findScenes([
      'Ship/Ship_gv_node.csv',
      'Ship/meshes/hull.stl',
      'Ship/meshes/Antenna.obj',
      'Ship/meshes/readme.txt',
    ])
    expect([...scenes[0].meshPathById]).toEqual([
      [1, 'Ship/meshes/Antenna.obj'], // 'A' (0x41) < 'h' (0x68)
      [2, 'Ship/meshes/hull.stl'],
    ])
  })

  it('sorts uppercase before lowercase, as Python does', () => {
    const scenes = findScenes([
      'S/S_gv_node.csv',
      'S/meshes/alpha.obj',
      'S/meshes/Zulu.obj',
      'S/meshes/Beta.obj',
    ])
    expect([...scenes[0].meshPathById.values()]).toEqual([
      'S/meshes/Beta.obj',
      'S/meshes/Zulu.obj',
      'S/meshes/alpha.obj',
    ])
  })

  it('ignores models sitting loose next to the node CSV', () => {
    // Dropped 2026-09-16: the desktop only ever looks in meshes/, so a scene
    // relying on a loose .obj opened here and lost its models there.
    const scenes = findScenes(['Ship/Ship_gv_node.csv', 'Ship/hull.obj'])
    expect(scenes[0].meshPathById.size).toBe(0)
  })

  it('ignores mesh/ and models/, which the desktop does not read', () => {
    const scenes = findScenes([
      'Ship/Ship_gv_node.csv',
      'Ship/mesh/a.obj',
      'Ship/models/b.obj',
    ])
    expect(scenes[0].meshPathById.size).toBe(0)
  })

  it('counts a format only the desktop can read, so the ids still line up', () => {
    // mesh_id is a POSITION, so what matters is which files are counted, not
    // which this app can parse. The desktop's mesh_loader takes .glb/.gltf
    // through trimesh; skipping them here would hand hull.obj id 1 where the
    // desktop calls it 2, and every node in the scene would wear its
    // neighbour's shape. Reading it is a separate question, answered when the
    // scene loads (the id is reserved and the reason reported).
    const scenes = findScenes([
      'Ship/Ship_gv_node.csv',
      'Ship/meshes/bridge.glb',
      'Ship/meshes/hull.obj',
      'Ship/meshes/mast.gltf',
    ])
    expect([...scenes[0].meshPathById]).toEqual([
      [1, 'Ship/meshes/bridge.glb'],
      [2, 'Ship/meshes/hull.obj'],
      [3, 'Ship/meshes/mast.gltf'],
    ])
  })

  it('still ignores a file neither app calls a model', () => {
    const scenes = findScenes([
      'Ship/Ship_gv_node.csv',
      'Ship/meshes/hull.obj',
      'Ship/meshes/notes.md',
      'Ship/meshes/hull.mtl',
    ])
    expect([...scenes[0].meshPathById]).toEqual([[1, 'Ship/meshes/hull.obj']])
  })

  it('leaves a sub-scene’s models to the sub-scene', () => {
    const scenes = findScenes([
      'Parent/Parent_gv_node.csv',
      'Parent/Child/Child_gv_node.csv',
      'Parent/Child/meshes/part.obj',
    ])
    const parent = scenes.find((s) => s.nodePath === 'Parent/Parent_gv_node.csv')!
    const child = scenes.find((s) => s.nodePath === 'Parent/Child/Child_gv_node.csv')!
    expect(parent.meshPathById.size).toBe(0)
    expect(child.meshPathById.get(1)).toBe('Parent/Child/meshes/part.obj')
  })

  it('is empty for a scene that ships none', () => {
    expect(findScenes(TIME_REPLAY)[0].meshPathById.size).toBe(0)
  })
})
