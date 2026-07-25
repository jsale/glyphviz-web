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

import * as THREE from 'three'
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

export interface TextureLibrary {
  /** texture_id → texture, for every id that decoded (videos included). */
  byId: Map<number, THREE.Texture>
  /** Loaded videos, in texture_id order — the audio controls drive these. */
  videos: VideoEntry[]
  warnings: string[]
}

export function emptyTextureLibrary(): TextureLibrary {
  return { byId: new Map(), videos: [], warnings: [] }
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
  // Media files are authored in sRGB; the renderer's output is sRGB too, so
  // saying so is what keeps a map's colours from washing out.
  texture.colorSpace = THREE.SRGBColorSpace
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
  texture.colorSpace = THREE.SRGBColorSpace
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
        } else {
          byId.set(id, entry.support === 'addon' ? await decodeTga(blob) : await decodeImage(blob))
        }
      } catch (err: unknown) {
        warnings.push(`texture_id ${id} (${entry.name}): ${String(err)}`)
      }
    }),
  )
  videos.sort((a, b) => a.textureId - b.textureId)

  if (missing.length > 0) {
    // The desktop is silent here; saying it out loud is the difference between
    // "the scene is broken" and "this folder is missing a file".
    warnings.push(
      `texture_id ${missing.sort((a, b) => a - b).join(', ')} referenced by nodes, but the ` +
        `media folder only supplies ${index.entries.length} file(s).`,
    )
  }
  return { byId, videos, warnings }
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
  into.warnings.push(...from.warnings)
  from.byId.clear()
  from.videos.length = 0
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
