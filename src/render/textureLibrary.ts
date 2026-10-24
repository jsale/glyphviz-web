// Decoding a scene's media/ folder into GPU textures.
//
// src/gv/media.ts already answers "which file is texture_id N"; this module
// answers "what does that file look like". Sampling matches the desktop's
// TextureManager._create_texture: REPEAT wrap on both axes, LINEAR
// magnification, LINEAR_MIPMAP_LINEAR minification with mipmaps generated.
// The desktop uploads its QImage mirrored vertically because GL's origin is
// bottom-left — Three's default flipY does the same thing, so a texture that
// reads right-side-up there reads right-side-up here.
//
// Only ids a node actually references are fetched: a scene folder can hold
// tens of megabytes of media that nothing in the CSV points at.
//
// A multi-frame GIF PLAYS, as it does on the desktop (`_AnimatedGifEntry`):
// decoded by src/io/gifFile.ts rather than the browser, which would hand over
// only the first frame, and advanced by `tickTextures` from the animation loop
// on its own per-frame delays — independent of Channels, exactly as there.

import * as THREE from 'three'
import { GifPlayer, parseGif } from '../io/gifFile'
import type { MediaEntry, MediaIndex } from '../gv/media'
import { NodeType } from '../gv/types'
import type { GvNode } from '../gv/types'

/** Resolves one media entry to its bytes; null when the file isn't available. */
export type MediaBlobSource = (entry: MediaEntry) => Promise<Blob | null>

export interface VideoEntry {
  textureId: number
  name: string
  element: HTMLVideoElement
  /** Object URL backing the element; revoked on dispose. */
  url: string
}

/** A playing multi-frame GIF and the texture its frames are uploaded into. */
export interface AnimatedGifEntry {
  textureId: number
  name: string
  player: GifPlayer
  texture: THREE.DataTexture
  /** The texture's own pixel buffer, BOTTOM row first (see flipRows). */
  pixels: Uint8Array
}

export interface TextureLibrary {
  /** texture_id → texture, for every id that decoded (videos and GIFs included). */
  byId: Map<number, THREE.Texture>
  /** Loaded videos, in texture_id order — the audio controls drive these. */
  videos: VideoEntry[]
  /** Multi-frame GIFs, advanced by tickTextures. */
  gifs: AnimatedGifEntry[]
  warnings: string[]
}

export function emptyTextureLibrary(): TextureLibrary {
  return { byId: new Map(), videos: [], gifs: [], warnings: [] }
}

/**
 * texture_ids referenced by drawable nodes.
 *
 * Link nodes count: the desktop textures a link's prism from the same table.
 * World/Camera rows never draw, so their texture_id is ignored.
 */
export function referencedTextureIds(nodes: readonly GvNode[]): Set<number> {
  const ids = new Set<number>()
  for (const node of nodes) {
    if (node.textureId <= 0) continue
    if (node.type === NodeType.World || node.type === NodeType.Camera) continue
    ids.add(node.textureId)
  }
  return ids
}

function configure(texture: THREE.Texture): THREE.Texture {
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  // No colour-space conversion, matching the desktop: it uploads the file's
  // bytes and GL_MODULATEs them against the node colour with no decode step.
  // The renderer writes raw values too (see lighting.ts), so a texel that
  // arrives as 128 leaves as 128 — decoding to linear here would darken every
  // map instead.
  texture.colorSpace = THREE.NoColorSpace
  texture.needsUpdate = true
  return texture
}

async function decodeImage(blob: Blob): Promise<THREE.Texture> {
  // createImageBitmap decodes off the main thread; flipping here rather than
  // in the sampler keeps the upload a straight copy.
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'flipY' })
  const texture = new THREE.Texture(bitmap)
  texture.flipY = false // already flipped in the bitmap
  return configure(texture)
}

async function decodeTga(blob: Blob): Promise<THREE.Texture> {
  const { TGALoader } = await import('three/addons/loaders/TGALoader.js')
  const url = URL.createObjectURL(blob)
  try {
    const texture = await new Promise<THREE.Texture>((resolve, reject) => {
      new TGALoader().load(url, resolve, undefined, reject)
    })
    return configure(texture)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Copy a top-row-first image into a bottom-row-first buffer: GL's origin is the
 * bottom-left, which is why the desktop uploads every frame `mirrored` and why
 * still images are decoded with imageOrientation 'flipY'. Done by hand rather
 * than with the texture's flipY, which WebGL does not promise for typed-array
 * uploads.
 */
function flipRows(src: Uint8Array, dst: Uint8Array, width: number, height: number): void {
  const row = width * 4
  for (let y = 0; y < height; y++) {
    dst.set(src.subarray(y * row, (y + 1) * row), (height - 1 - y) * row)
  }
}

/**
 * A GIF with more than one frame, as a texture that plays; null for a single
 * frame (that takes the ordinary still-image path, mipmaps and all — the
 * desktop's own `imageCount() > 1` split) or a file the parser cannot read, which
 * the browser then gets a chance to decode as a still.
 */
async function decodeAnimatedGif(blob: Blob, entry: MediaEntry): Promise<AnimatedGifEntry | null> {
  let player: GifPlayer
  try {
    const gif = parseGif(new Uint8Array(await blob.arrayBuffer()))
    if (gif.frames.length < 2) return null
    player = new GifPlayer(gif)
  } catch {
    return null
  }
  const { width, height } = player.compositor.gif
  const pixels = new Uint8Array(width * height * 4)
  flipRows(player.rgba, pixels, width, height)
  const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.NoColorSpace // raw, as in configure()
  // The desktop's animated entries skip mipmaps — a frame is re-uploaded every
  // time it changes, and regenerating the chain each time is not worth it.
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return { textureId: entry.textureId, name: entry.name, player, texture, pixels }
}

/**
 * Advance every playing GIF by `dtMs` and upload the frames that changed. Call
 * once per display frame; a still scene with no GIF costs one empty loop.
 */
export function tickTextures(library: TextureLibrary, dtMs: number): void {
  for (const gif of library.gifs) {
    if (!gif.player.advance(dtMs)) continue
    const { width, height } = gif.player.compositor.gif
    flipRows(gif.player.rgba, gif.pixels, width, height)
    gif.texture.needsUpdate = true
  }
}

/**
 * A looping, muted video playing into a texture.
 *
 * Muted is not a preference — browsers refuse to autoplay audible media, and a
 * scene that opened silent-and-playing is better than one that opened paused.
 * The desktop's default is the opposite (every loaded video audible at once);
 * unmuting here needs a user gesture, which is what the Audio control is for.
 */
async function decodeVideo(blob: Blob, entry: MediaEntry): Promise<[THREE.Texture, VideoEntry]> {
  const url = URL.createObjectURL(blob)
  const element = document.createElement('video')
  element.src = url
  element.loop = true
  element.muted = true
  element.playsInline = true
  element.crossOrigin = 'anonymous'
  element.preload = 'auto'

  await new Promise<void>((resolve, reject) => {
    const done = () => {
      element.removeEventListener('loadeddata', done)
      element.removeEventListener('error', fail)
      resolve()
    }
    const fail = () => {
      element.removeEventListener('loadeddata', done)
      element.removeEventListener('error', fail)
      reject(new Error('the browser could not decode this video'))
    }
    element.addEventListener('loadeddata', done)
    element.addEventListener('error', fail)
    element.load()
  })
  void element.play().catch(() => {
    /* A blocked autoplay leaves frame 0 on screen; the Audio control resumes it. */
  })

  const texture = new THREE.VideoTexture(element)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.NoColorSpace // raw, as in configure()
  // VideoTexture must not mipmap: frames arrive continuously and regenerating
  // the chain per frame costs far more than the filtering is worth.
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false

  return [texture, { textureId: entry.textureId, name: entry.name, element, url }]
}

/**
 * Decode the media a scene needs.
 *
 * Ids that fail — an unsupported format, a missing file, a corrupt image —
 * are reported and left out; the node then draws untextured rather than
 * failing the whole scene load. Note the id itself is never reassigned: it
 * belongs to that file's sorted position whether or not it decodes.
 */
export async function loadTextures(
  index: MediaIndex,
  wanted: ReadonlySet<number>,
  getBlob: MediaBlobSource,
): Promise<TextureLibrary> {
  const byId = new Map<number, THREE.Texture>()
  const videos: VideoEntry[] = []
  const gifs: AnimatedGifEntry[] = []
  const warnings: string[] = []
  const missing: number[] = []

  await Promise.all(
    [...wanted].sort((a, b) => a - b).map(async (id) => {
      const entry = index.byTextureId.get(id)
      if (!entry) {
        missing.push(id)
        return
      }
      if (entry.support === 'unsupported') {
        warnings.push(`texture_id ${id} (${entry.name}): no browser can decode this format.`)
        return
      }
      try {
        const blob = await getBlob(entry)
        if (!blob) {
          warnings.push(`texture_id ${id} (${entry.name}): file not available.`)
          return
        }
        if (entry.kind === 'video') {
          const [texture, video] = await decodeVideo(blob, entry)
          byId.set(id, texture)
          videos.push(video)
        } else if (entry.support === 'addon') {
          byId.set(id, await decodeTga(blob))
        } else {
          const gif = /.gif$/i.test(entry.name) ? await decodeAnimatedGif(blob, entry) : null
          if (gif) {
            byId.set(id, gif.texture)
            gifs.push(gif)
          } else {
            byId.set(id, await decodeImage(blob))
          }
        }
      } catch (err: unknown) {
        warnings.push(`texture_id ${id} (${entry.name}): ${String(err)}`)
      }
    }),
  )
  videos.sort((a, b) => a.textureId - b.textureId)
  gifs.sort((a, b) => a.textureId - b.textureId)

  if (missing.length > 0) {
    // The desktop is silent here; saying it out loud is the difference between
    // "the scene is broken" and "this folder is missing a file".
    warnings.push(
      `texture_id ${missing.sort((a, b) => a - b).join(', ')} referenced by nodes, but the ` +
        `media folder only supplies ${index.entries.length} file(s).`,
    )
  }
  return { byId, videos, gifs, warnings }
}

/**
 * Fold a later decode into the scene's live library.
 *
 * Textures arrive in more than one batch: the ids the CSV references at load,
 * then whatever an inspector texture_id edit newly names. The additions are
 * MOVED, not copied — `from` is emptied of everything that transferred, so
 * disposing it afterwards would be wrong and is never done. An id already
 * present wins (it is the one live materials hold); the newcomer is disposed
 * rather than leaked.
 */
export function mergeTextureLibrary(into: TextureLibrary, from: TextureLibrary): void {
  for (const [id, texture] of from.byId) {
    if (into.byId.has(id)) {
      texture.dispose()
      continue
    }
    into.byId.set(id, texture)
  }
  for (const video of from.videos) {
    if (into.videos.some((v) => v.textureId === video.textureId)) {
      releaseVideo(video)
      continue
    }
    into.videos.push(video)
  }
  into.videos.sort((a, b) => a.textureId - b.textureId)
  for (const gif of from.gifs) {
    // Its texture was disposed above if the id was already present.
    if (into.byId.get(gif.textureId) === gif.texture) {
      into.gifs.push(gif)
    }
  }
  into.gifs.sort((a, b) => a.textureId - b.textureId)
  into.warnings.push(...from.warnings)
  from.byId.clear()
  from.videos.length = 0
  from.gifs.length = 0
}

/** Stop a video and give its object URL back to the browser. */
function releaseVideo(video: VideoEntry): void {
  video.element.pause()
  video.element.removeAttribute('src')
  video.element.load()
  URL.revokeObjectURL(video.url)
}

export function disposeTextures(library: TextureLibrary): void {
  for (const texture of library.byId.values()) texture.dispose()
  library.byId.clear()
  for (const video of library.videos) releaseVideo(video)
  library.videos.length = 0
  library.gifs.length = 0 // their textures went with byId
}

/** How a scene's video soundtracks are mixed. */
export type AudioMode = 'muted' | 'all' | 'selected'

/**
 * Apply an audio mode to a scene's videos — the desktop's audio-track
 * dropdown and "Solo Audio to Selection" checkbox (Display panel).
 *
 * Divergence: the desktop's default is every video audible at once, which no
 * browser will do without a user gesture, so 'muted' is the default here and
 * choosing another mode IS the gesture. `isSelected` decides which texture_ids
 * are on selected nodes.
 */
export function applyAudioMode(
  library: TextureLibrary,
  mode: AudioMode,
  isTextureSelected: (textureId: number) => boolean,
): void {
  for (const video of library.videos) {
    const audible =
      mode === 'all' || (mode === 'selected' && isTextureSelected(video.textureId))
    video.element.muted = !audible
    // A gesture-gated autoplay may have been refused at load; retry on demand.
    if (audible && video.element.paused) void video.element.play().catch(() => {})
  }
}
