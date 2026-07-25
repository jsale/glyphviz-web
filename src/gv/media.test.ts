import { describe, expect, it } from 'vitest'
import { buildMediaIndex, compareMediaNames, stepTextureId, textureChoices } from './media'

describe('compareMediaNames', () => {
  it('sorts zero-padded names lexicographically, as Python does', () => {
    const names = ['map00010.jpg', 'map00009.jpg', 'map00002.jpg']
    expect([...names].sort(compareMediaNames)).toEqual([
      'map00002.jpg',
      'map00009.jpg',
      'map00010.jpg',
    ])
  })

  it('is case-insensitive (Windows desktop behavior)', () => {
    expect([...['beta.png', 'Alpha.png']].sort(compareMediaNames)).toEqual([
      'Alpha.png',
      'beta.png',
    ])
    // Case-sensitive code-point order would put every capital first.
    expect([...['a.png', 'B.png']].sort(compareMediaNames)).toEqual(['a.png', 'B.png'])
  })

  it('keeps underscores before letters, unlike localeCompare', () => {
    expect(compareMediaNames('_a.png', 'ab.png')).toBeLessThan(0)
  })
})

describe('buildMediaIndex', () => {
  it('numbers images from 1 then videos after them', () => {
    // The spec's worked example: alpha.png, beta.jpg, clip.mp4 → 1, 2, 3.
    const index = buildMediaIndex(['clip.mp4', 'beta.jpg', 'alpha.png'])
    expect(index.entries.map((e) => [e.textureId, e.name])).toEqual([
      [1, 'alpha.png'],
      [2, 'beta.jpg'],
      [3, 'clip.mp4'],
    ])
    expect(index.byTextureId.get(3)!.kind).toBe('video')
  })

  it('renumbers videos when an image is added, as the spec warns', () => {
    const index = buildMediaIndex(['clip.mp4', 'beta.jpg', 'alpha.png', 'aaa.png'])
    expect(index.byTextureId.get(4)!.name).toBe('clip.mp4')
  })

  it('reproduces the real Texture_Animation_Example folder', () => {
    // 20 map000NN.jpg frames plus one uppercase-extension video.
    const names = ['IMG_4023.MP4']
    for (let i = 1; i <= 20; i++) names.push(`map${String(i).padStart(5, '0')}.jpg`)
    const index = buildMediaIndex(names)
    expect(index.entries).toHaveLength(21)
    expect(index.byTextureId.get(1)!.name).toBe('map00001.jpg')
    expect(index.byTextureId.get(20)!.name).toBe('map00020.jpg')
    expect(index.byTextureId.get(21)).toEqual({
      textureId: 21,
      name: 'IMG_4023.MP4',
      kind: 'video',
      support: 'native',
    })
  })

  it('reproduces the real Time_Replay folder (png sorts before the jpgs)', () => {
    const index = buildMediaIndex([
      'map00002.jpg',
      'bluemarble-2048.png',
      'map00001.jpg',
      'map00003.jpg',
    ])
    expect(index.entries.map((e) => e.name)).toEqual([
      'bluemarble-2048.png',
      'map00001.jpg',
      'map00002.jpg',
      'map00003.jpg',
    ])
  })

  it('ignores non-media files without consuming an id', () => {
    const index = buildMediaIndex(['cat_scan_all_mono.wav', 'spectrogram.png', 'notes.txt'])
    expect(index.entries.map((e) => [e.textureId, e.name])).toEqual([[1, 'spectrogram.png']])
    expect(index.ignored).toEqual(['cat_scan_all_mono.wav', 'notes.txt'])
  })

  it('reserves ids for files no browser can decode', () => {
    const index = buildMediaIndex(['a.tif', 'b.tga', 'c.png'])
    expect(index.entries.map((e) => [e.textureId, e.support])).toEqual([
      [1, 'unsupported'], // a.tif
      [2, 'addon'], // b.tga — Three.js TGALoader
      [3, 'native'], // c.png
    ])
  })

  it('is empty for an empty folder', () => {
    expect(buildMediaIndex([]).entries).toEqual([])
  })
})

describe('textureChoices', () => {
  const index = buildMediaIndex(['alpha.png', 'clip.mp4', 'scan.tif'])

  it('lists None first, then every media file in id order', () => {
    expect(textureChoices(index, 0).map((c) => [c.id, c.label])).toEqual([
      [0, 'None (0)'],
      [1, '1 · alpha.png'],
      [2, '2 · scan.tif — no decoder'],
      [3, '3 · clip.mp4 — video'],
    ])
  })

  it('offers only None when no media folder was opened', () => {
    expect(textureChoices(null, 0)).toEqual([{ id: 0, label: 'None (0)' }])
  })

  it('keeps an id the media folder never supplied, so an edit cannot lose it', () => {
    const choices = textureChoices(index, 9)
    expect(choices.map((c) => c.id)).toEqual([0, 1, 2, 3, 9])
    expect(choices[4].label).toBe('9 · (not in media folder)')
  })
})

describe('stepTextureId', () => {
  const choices = textureChoices(buildMediaIndex(['a.png', 'b.png']), 0)

  it('steps forward and back through the menu', () => {
    expect(stepTextureId(choices, 0, 1)).toBe(1)
    expect(stepTextureId(choices, 1, 1)).toBe(2)
    expect(stepTextureId(choices, 2, -1)).toBe(1)
  })

  it('wraps at both ends, including through None', () => {
    expect(stepTextureId(choices, 2, 1)).toBe(0)
    expect(stepTextureId(choices, 0, -1)).toBe(2)
  })

  it('lands on the first entry from an id that is not in the menu', () => {
    expect(stepTextureId(choices, 7, 1)).toBe(0)
  })
})
