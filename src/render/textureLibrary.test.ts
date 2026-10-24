import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { applyAudioMode, loadTextures, referencedTextureIds, tickTextures } from './textureLibrary'
import type { TextureLibrary, VideoEntry } from './textureLibrary'
import { buildMediaIndex } from '../gv/media'
import { parseGvNodeCsv } from '../gv/nodeCsv'
import { NodeType } from '../gv/types'
import type { GvNode } from '../gv/types'

function node(id: number, textureId: number, type: number = NodeType.Glyph): GvNode {
  const base = parseGvNodeCsv(
    [
      'id,type,parent_id,branch_level,translate_x,translate_y,translate_z,rotate_x,rotate_y,rotate_z,scale_x,scale_y,scale_z,color_r,color_g,color_b,color_a,geometry,hide,topo',
      `${id},5,0,0,0,0,0,0,0,0,1,1,1,255,0,0,255,1,0,0`,
    ].join('\r\n'),
  ).nodes[0]
  return { ...base, textureId, type }
}

describe('referencedTextureIds', () => {
  it('collects the ids drawable nodes point at, once each', () => {
    const ids = referencedTextureIds([node(1, 3), node(2, 3), node(3, 7)])
    expect([...ids].sort((a, b) => a - b)).toEqual([3, 7])
  })

  it('ignores texture_id 0, the untextured default', () => {
    expect(referencedTextureIds([node(1, 0)]).size).toBe(0)
  })

  it('ignores World and Camera rows, which never draw', () => {
    const ids = referencedTextureIds([
      node(1, 4, NodeType.World),
      node(2, 5, NodeType.Camera),
      node(3, 6, NodeType.WorldGrid),
    ])
    expect([...ids]).toEqual([6])
  })

  it('keeps Link ids — the desktop textures a link prism from the same table', () => {
    expect([...referencedTextureIds([node(1, 9, NodeType.Link)])]).toEqual([9])
  })
})

describe('loadTextures', () => {
  const index = buildMediaIndex(['a.png', 'b.tif', 'c.mp4'])

  it('reserves an id for a format no browser decodes, and says so', async () => {
    // b.tif is texture_id 2 — the id stays taken, it just doesn't decode.
    const library = await loadTextures(index, new Set([2]), async () => null)
    expect(library.byId.size).toBe(0)
    expect(library.warnings).toHaveLength(1)
    expect(library.warnings[0]).toContain('b.tif')
    expect(library.warnings[0]).toContain('no browser can decode')
  })

  it('reports an id the media folder never supplied', async () => {
    const library = await loadTextures(index, new Set([9]), async () => null)
    expect(library.warnings.join(' ')).toContain('texture_id 9')
    expect(library.warnings.join(' ')).toContain('only supplies 3 file(s)')
  })

  it('reports a file the bundle could not hand over', async () => {
    const library = await loadTextures(index, new Set([1]), async () => null)
    expect(library.warnings.join(' ')).toContain('file not available')
  })

  it('does nothing when no id is wanted', async () => {
    const library = await loadTextures(index, new Set(), async () => null)
    expect(library.byId.size).toBe(0)
    expect(library.warnings).toEqual([])
  })
})

describe('applyAudioMode', () => {
  function fakeLibrary(...textureIds: number[]): {
    library: TextureLibrary
    elements: Array<{ muted: boolean; paused: boolean; plays: number }>
  } {
    const elements = textureIds.map(() => ({ muted: true, paused: true, plays: 0 }))
    const videos: VideoEntry[] = textureIds.map((textureId, i) => ({
      textureId,
      name: `v${textureId}.mp4`,
      url: 'blob:test',
      element: {
        get muted() {
          return elements[i].muted
        },
        set muted(value: boolean) {
          elements[i].muted = value
        },
        get paused() {
          return elements[i].paused
        },
        play: () => {
          elements[i].plays++
          elements[i].paused = false
          return Promise.resolve()
        },
      } as unknown as HTMLVideoElement,
    }))
    return { library: { byId: new Map(), videos, gifs: [], warnings: [] }, elements }
  }

  it('mutes everything in muted mode', () => {
    const { library, elements } = fakeLibrary(1, 2)
    applyAudioMode(library, 'muted', () => true)
    expect(elements.map((e) => e.muted)).toEqual([true, true])
    expect(elements.map((e) => e.plays)).toEqual([0, 0])
  })

  it('unmutes every track in all mode, resuming a blocked autoplay', () => {
    const { library, elements } = fakeLibrary(1, 2)
    applyAudioMode(library, 'all', () => false)
    expect(elements.map((e) => e.muted)).toEqual([false, false])
    expect(elements.map((e) => e.plays)).toEqual([1, 1])
  })

  it('plays only videos textured on selected nodes in selected mode', () => {
    const { library, elements } = fakeLibrary(1, 2)
    applyAudioMode(library, 'selected', (textureId) => textureId === 2)
    expect(elements.map((e) => e.muted)).toEqual([true, false])
  })

  it('mutes all of them when the selection is empty', () => {
    const { library, elements } = fakeLibrary(1, 2)
    applyAudioMode(library, 'selected', () => false)
    expect(elements.map((e) => e.muted)).toEqual([true, true])
  })
})

describe('animated GIF textures', () => {
  const fixture = (name: string) =>
    new Blob([new Uint8Array(readFileSync(new URL(`../io/fixtures/gif/${name}.gif`, import.meta.url)))])

  /** RGBA of pixel (x, y) in GL order: y counts up from the BOTTOM row. */
  const texel = (pixels: Uint8Array, width: number, x: number, y: number) =>
    [...pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)]

  it('plays a multi-frame GIF as a texture, on its own delays', async () => {
    const index = buildMediaIndex(['anim.gif'])
    const library = await loadTextures(index, new Set([1]), async () => fixture('basic'))
    expect(library.warnings).toEqual([])
    expect(library.gifs).toHaveLength(1)
    const gif = library.gifs[0]
    expect(library.byId.get(1)).toBe(gif.texture)
    // The desktop's animated sampling: no mipmap chain to regenerate per frame.
    expect(gif.texture.generateMipmaps).toBe(false)

    // basic.gif fills the whole frame with palette entry 0, 1, 2 in turn
    // (red, green, blue), held 100 / 200 / 300 ms.
    expect(texel(gif.pixels, 8, 0, 0)).toEqual([255, 0, 0, 255])
    const version = gif.texture.version
    tickTextures(library, 99)
    expect(gif.texture.version).toBe(version) // nothing due, nothing uploaded
    tickTextures(library, 1)
    expect(gif.texture.version).toBe(version + 1)
    expect(texel(gif.pixels, 8, 0, 0)).toEqual([0, 255, 0, 255])
  })

  it('uploads the image bottom row first, as GL expects', async () => {
    // first_frame_subrect: frame 1 paints a 2×2 blue block in the TOP-left
    // corner of a 12 × 10 yellow screen.
    const library = await loadTextures(buildMediaIndex(['a.gif']), new Set([1]), async () =>
      fixture('first_frame_subrect'),
    )
    const gif = library.gifs[0]
    tickTextures(library, 100)
    expect(texel(gif.pixels, 12, 0, 9)).toEqual([0, 0, 255, 255]) // top row, stored last
    expect(texel(gif.pixels, 12, 0, 0)).toEqual([255, 255, 0, 255])
  })

  it('leaves a single-frame GIF to the ordinary still-image path', async () => {
    // That path decodes through createImageBitmap, which plain node lacks, so
    // the attempt is reported as a warning — the point is that it was not
    // claimed as an animation.
    const library = await loadTextures(buildMediaIndex(['still.gif']), new Set([1]), async () =>
      fixture('single_frame'),
    )
    expect(library.gifs).toHaveLength(0)
  })
})
